// Edge TTS 引擎：微软 Edge 在线语音合成（@andresaya/edge-tts）
// 与 Melo 引擎同接口（synthesizeStream/synthesize），VoiceManager 无需改动。
// 流式策略：一次调用 synthesizeStream（整段文本，服务端按句推块）→
// mp3 块累积 ~30KB 解码一批（MPEGDecoder wasm）→ 24kHz PCM → 播放。
// 实测 5 句文本：首块 ~0.9s、总 ~1.2s（此前按句分批每批新建连接，慢数倍）
import { EdgeTTS } from "@andresaya/edge-tts";
import { MPEGDecoder } from "mpg123-decoder";
import { preprocessText } from "./sherpa-engines.js";

// 常用中文音色（getVoices 在线失败时的内置列表；gender 用于男女声分组）
export const EDGE_ZH_VOICES = [
	{ name: "zh-CN-XiaoxiaoNeural", label: "晓晓（女·甜）", gender: "女" },
	{ name: "zh-CN-XiaoyiNeural", label: "晓伊（女·活泼）", gender: "女" },
	{ name: "zh-CN-XiaochenNeural", label: "晓辰（女·成熟）", gender: "女" },
	{ name: "zh-CN-XiaohanNeural", label: "晓涵（女·温婉）", gender: "女" },
	{ name: "zh-CN-XiaomengNeural", label: "晓梦（女·清脆）", gender: "女" },
	{ name: "zh-CN-XiaomoNeural", label: "晓墨（女·知性）", gender: "女" },
	{ name: "zh-CN-XiaoruiNeural", label: "晓睿（女·柔和）", gender: "女" },
	{ name: "zh-CN-XiaoshuangNeural", label: "晓双（童声）", gender: "女" },
	{ name: "zh-CN-XiaoxuanNeural", label: "晓萱（女·甜美）", gender: "女" },
	{ name: "zh-CN-XiaoyanNeural", label: "晓颜（女·亲切）", gender: "女" },
	{ name: "zh-CN-YunxiNeural", label: "云希（男·阳光）", gender: "男" },
	{ name: "zh-CN-YunjianNeural", label: "云健（男·沉稳）", gender: "男" },
	{ name: "zh-CN-YunyangNeural", label: "云扬（男·播报）", gender: "男" },
	{ name: "zh-CN-YunfengNeural", label: "云枫（男·浑厚）", gender: "男" },
	{ name: "zh-CN-YunhaoNeural", label: "云浩（男·温和）", gender: "男" },
	{ name: "zh-CN-YunxiaNeural", label: "云夏（男·磁性）", gender: "男" },
	{ name: "zh-CN-liaoning-XiaobeiNeural", label: "晓北（女·东北）", gender: "女" },
	{ name: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮（女·陕西）", gender: "女" },
	{ name: "zh-HK-HiuGaaiNeural", label: "曉佳（粤语·女）", gender: "女" },
	{ name: "zh-HK-HiuMaanNeural", label: "曉曼（粤语·女）", gender: "女" },
	{ name: "zh-HK-WanLungNeural", label: "雲龍（粤语·男）", gender: "男" },
	{ name: "zh-TW-HsiaoChenNeural", label: "曉臻（台湾·女）", gender: "女" },
	{ name: "zh-TW-HsiaoYuNeural", label: "曉雨（台湾·女）", gender: "女" },
	{ name: "zh-TW-YunJheNeural", label: "雲哲（台湾·男）", gender: "男" },
];

// 获取音色列表：在线拉取官方列表为准（自动过滤已下架音色），
// 中文 label 用内置映射，gender 取官方；在线失败回内置表
export async function listEdgeVoices() {
	try {
		const tts = new EdgeTTS();
		const voices = await tts.getVoices();
		const zh = (voices ?? []).filter((v) => v.Locale?.startsWith("zh"));
		if (zh.length > 0) {
			const labelMap = new Map(EDGE_ZH_VOICES.map((v) => [v.name, v.label]));
			const genderMap = new Map(EDGE_ZH_VOICES.map((v) => [v.name, v.gender]));
			return zh.map((v) => ({
				name: v.ShortName,
				label: labelMap.get(v.ShortName) ?? v.ShortName,
				gender: genderMap.get(v.ShortName) ?? (String(v.Gender ?? "").toLowerCase().includes("female") ? "女" : "男"),
			}));
		}
	} catch {}
	return EDGE_ZH_VOICES;
}

// 流式收集合成块，带整体超时兜底：Edge 服务端偶发挂起（不推块也不关闭）
// 时 Promise.race 强制结束，避免播报/试听态永久卡死；onChunk 返回 false 可终止
async function collectWithTimeout(iterable, onChunk, timeoutMs = 30000) {
	const iterator = iterable[Symbol.asyncIterator]();
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const timeout = new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));
		const next = await Promise.race([iterator.next(), timeout.then(() => ({ done: true, value: undefined }))]);
		if (next.done) break;
		if (onChunk(next.value) === false) break;
	}
}

// Edge TTS 引擎（一次调用流式解码；与 Melo 引擎同接口）
// voice: 默认音色；speed: 语速倍率（0.5-1.5）→ prosody rate
export function createEdgeTtsEngine(voice = "zh-CN-XiaoxiaoNeural", speed = 1.0) {
	const decoder = new MPEGDecoder();
	const decoderReady = decoder.ready;
	const rate = `${speed >= 1 ? "+" : ""}${Math.round((speed - 1) * 100)}%`;
	const ACCUM_BYTES = 30000; // 约 0.7s 音频一批，平衡首字延迟与解码批次

	// 流式合成：一次调用整段（服务端按句推块），mp3 累积到阈值解码一批
	// isLast：末批（generator 结束后剩余）标记
	async function streamInternal(text, voiceName, onChunk, isCancelled) {
		console.log("[EdgeTTS] 发送文本:", JSON.stringify(text));
		const tts = new EdgeTTS();
		let acc = [];
		let accBytes = 0;
		await collectWithTimeout(tts.synthesizeStream(text, voiceName, { rate }), (chunk) => {
			if (isCancelled()) return false; // 取消：终止收集
			acc.push(chunk);
			accBytes += chunk.length;
			if (accBytes >= ACCUM_BYTES) {
				accBytes = 0;
				const toDecode = acc;
				acc = [];
				decoderReady.then(() => decoder.decode(Buffer.concat(toDecode)))
					.then(({ channelData }) => { if (!isCancelled()) onChunk({ samples: channelData[0], sampleRate: 24000 }, false); })
					.catch(() => {});
			}
		});
		if (acc.length > 0) {
			await decoderReady;
			const { channelData } = await decoder.decode(Buffer.concat(acc));
			if (!isCancelled()) onChunk({ samples: channelData[0], sampleRate: 24000 }, true);
		}
	}

	return {
		async synthesizeStream(text, onChunk, isCancelled = () => false) {
			await streamInternal(preprocessText(text), voice, onChunk, isCancelled);
		},
		// 一次性合成（整段，返回完整 PCM）
		async synthesize(text, voiceName) {
			const tts = new EdgeTTS();
			const mp3 = [];
			await collectWithTimeout(tts.synthesizeStream(preprocessText(text), voiceName ?? voice, { rate }), (chunk) => { mp3.push(chunk); });
			await decoderReady;
			const { channelData } = await decoder.decode(Buffer.concat(mp3));
			return { samples: channelData[0], sampleRate: 24000 };
		},
		// 试听：合成固定文案（指定音色）
		preview(voiceName) {
			const tts = new EdgeTTS();
			return (async () => {
				const mp3 = [];
				await collectWithTimeout(tts.synthesizeStream("你好，我是小C，这是我的声音。", voiceName, { rate }), (chunk) => { mp3.push(chunk); });
				await decoderReady;
				const { channelData } = await decoder.decode(Buffer.concat(mp3));
				return { samples: channelData[0], sampleRate: 24000 };
			})();
		},
		warmUp() {},
	};
}
