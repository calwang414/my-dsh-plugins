// sherpa-onnx 真实引擎适配层：把 Node 绑定 API 封装成 VoiceManager 注入的接口
// kws: { feed, start, stop, onKeyword }   vad: { feed, stop, onSegment }
// asr: { recognize }                      tts: { synthesize }
// 模型路径：assets/models（开发态）/ resources/models（打包态）
import fs from "node:fs";
import path from "node:path";
import pkg from "sherpa-onnx-node";
const { KeywordSpotter, Vad, OfflineRecognizer, OfflineTts } = pkg;

// 自动探测 int8/非 int8 变体
function findModel(dir, prefix) {
	const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".onnx"));
	const int8 = files.find((f) => f.includes("int8"));
	return path.join(dir, int8 ?? files[0]);
}

// 阿拉伯数字转中文数字（Melo 模型读中文数字更准；gohermes 同款逻辑）
const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
function arabicToChinese(s) {
	if (s.length > 4) return s;
	if (s.length >= 3) {
		return s.split("").map((c) => CN_DIGITS[c.charCodeAt(0) - 48]).join("");
	}
	const n = parseInt(s, 10);
	if (n < 10) return CN_DIGITS[n];
	if (n < 20) return n === 10 ? "十" : "十" + CN_DIGITS[n % 10];
	const h = Math.floor(n / 10);
	const l = n % 10;
	return CN_DIGITS[h] + "十" + (l > 0 ? CN_DIGITS[l] : "");
}
function digitsToChinese(text) {
	return text.replace(/\d+/g, (m) => arabicToChinese(m));
}

// 按句末标点/换行切分文本（保留标点；preprocessText 已把换行转句号）
export function splitSentences(text) {
	return text.match(/[^。！？；]+[。！？；]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

// 文本预处理：markdown 符号清理 + emoji 过滤 + 换行转停顿 + 阿拉伯数字转中文
// （导出供 Edge TTS 引擎复用）
export function preprocessText(text) {
	let t = text
		// 表格不播报：HTML 表格块与 markdown 表格（锚定行首的连续 | 行，
		// 每行都要求 | 开头——只吞表格本身，不吞表格后内容；末行可不带换行）
		.replace(/<table[\s\S]*?<\/table>/gi, "（详情见表格）。")
		.replace(/(?:^|\n)\|(?:[^\n]*\n?)(?:\|[^\n]*\n?)*/g, "（详情见表格）。")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`/g, "")
		.replace(/\*\*/g, "")
		.replace(/##?/g, "")
		.replace(/[|>]/g, " ")
		.replace(/\*/g, "")
		// 特殊字符清理：箭头/项目符号等符号 Edge TTS 服务端可能截断合成
		// （如 "设置 → 高级" 只播到箭头前），统一替换为空格跳过
		.replace(/[→←↑↓⇒⇐⇔↔•◦‣▪▫]/g, " ")
		// emoji/符号过滤：避免 TTS 读成怪音或描述文字
		.replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
		// 换行/段落 → 句号停顿（Melo 对裸换行不停顿，列表项/分段需停顿感）
		.replace(/\n+/g, "。");
	return digitsToChinese(t).trim();
}

// 组装完整 KWS 引擎：流式喂入 + decode 循环 + 命中判定
export function createKwsEngine(modelDir) {
	const spotter = new KeywordSpotter({
		featConfig: { sampleRate: 16000, featureDim: 80 },
		modelConfig: {
			transducer: {
				encoder: findModel(modelDir, "encoder"),
				decoder: findModel(modelDir, "decoder"),
				joiner: findModel(modelDir, "joiner"),
			},
			tokens: path.join(modelDir, "tokens.txt"),
			numThreads: 2,
			provider: "cpu",
		},
		keywordsFile: path.join(modelDir, "keywords.txt"),
		// 灵敏度（官方默认 keyword-spotter.h: threshold=0.25, score=1.0；
		// 0.25 已是最灵敏档，配合 score 加分命中；调高会变钝）
		keywordsThreshold: 0.25,
		keywordsScore: 1.0,
	});
	let stream = null;
	return {
		feed(samples) {
			// 流式：每块喂入后 decode 到耗尽，命中即回调（持续流自然 flush，无需 tail padding）
			stream.acceptWaveform({ samples, sampleRate: 16000 });
			while (spotter.isReady(stream)) {
				spotter.decode(stream);
				const keyword = spotter.getResult(stream).keyword;
				if (keyword) {
					// 官方要求：检测到关键词后立即 reset（否则流状态污染，
					// 已匹配的 token 序列残留，后续唤醒检测失效/重复触发）
					spotter.reset(stream);
					this.onKeyword?.(keyword);
				}
			}
		},
		start() {
			stream = spotter.createStream();
		},
		stop() {
			stream = null;
		},
		onKeyword: null,
	};
}

// VAD 引擎：分块喂入，静音判定由模型完成，弹出语音段即回调
// minSilenceSeconds：说完判定（连续 N 秒静音弹段；可配置，默认 5）
export function createVadEngine(modelPath, minSilenceSeconds = 5) {
	const vad = new Vad({
		sileroVad: {
			model: modelPath,
			// 说完判定：连续 N 秒静音才算说话结束（说话中停顿/思考不被切断；
			// 识别延迟 = 说完后 N 秒，用户可在语音设置中调整）
			minSilenceDuration: minSilenceSeconds,
			// 阈值 0.2：低能量语音也能触发（配合输入增益）
			threshold: 0.2,
			windowSize: 512,
			maxSpeechDuration: 60, // 单段最长 60s（防长句被默认 20s 强制切断）
		},
		sampleRate: 16000,
		numThreads: 1,
		provider: "cpu",
	});
	return {
		feed(samples) {
			vad.acceptWaveform(samples);
			while (!vad.isEmpty()) {
				// front(false)：内部 buffer——默认 true 返回外部 ArrayBuffer，
				// Electron V8 sandbox 拒绝（"External buffers are not allowed"，
				// 与 TTS enableExternalBuffer 同源）
				const seg = vad.front(false);
				vad.pop();
				if (seg && seg.samples.length > 0) {
					this.onSegment?.({
						samples: seg.samples,
						sampleRate: seg.sampleRate ?? 16000,
						text: "",
					});
				}
			}
		},
		stop() {
			vad.reset();
		},
		onSegment: null,
	};
}

// 离线 ASR 引擎（Paraformer）
export function createAsrEngine(modelDir) {
	const recognizer = new OfflineRecognizer({
		featConfig: { sampleRate: 16000, featureDim: 80 },
		modelConfig: {
			paraformer: {
				model: path.join(modelDir, "model.int8.onnx"),
				useInverseTextNormalization: true,
			},
			tokens: path.join(modelDir, "tokens.txt"),
			numThreads: 1,
			provider: "cpu",
		},
	});
	return {
		recognize(seg) {
			const stream = recognizer.createStream();
			stream.acceptWaveform({ samples: seg.samples, sampleRate: seg.sampleRate ?? 16000 });
			recognizer.decode(stream);
			return recognizer.getResult(stream).text ?? "";
		},
	};
}

// TTS 引擎（MeloTTS 中英混读）
// TTS 引擎（MeloTTS 中英混读）；speed: 语速倍率（0.5-1.5）
export function createTtsEngine(modelDir, speed = 1.0) {
	const tts = new OfflineTts({
		// maxNumSentences: 2 → 每块 2 句（首块延迟 ~1.5s 可接受，播放缓冲足
		// 不卡顿；1 句/块时生成慢于播放会句间断流，3 句/块首延迟太长）
		maxNumSentences: 2,
		model: {
			vits: {
				model: path.join(modelDir, "model.int8.onnx"),
				tokens: path.join(modelDir, "tokens.txt"),
				lexicon: path.join(modelDir, "lexicon.txt"),
			},
		},
	});
	// 音量归一化：MeloTTS 合成峰值仅 ~0.1（-20dB），放大到 0.9 目标峰值
	// （上限 8 倍，防静音段噪声被过度放大）
	function normalize(samples) {
		let max = 0;
		for (let i = 0; i < samples.length; i++) {
			const a = Math.abs(samples[i]);
			if (a > max) max = a;
		}
		if (max === 0) return samples;
		const gain = Math.min(0.9 / max, 8);
		if (gain <= 1) return samples;
		const out = new Float32Array(samples.length);
		for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
		return out;
	}
	return {
		synthesize(text) {
			// enableExternalBuffer: false → 内部 ArrayBuffer + 拷贝，
			// 规避 Electron V8 sandbox 对外部 buffer 的拒绝
			const audio = tts.generate({ text, sid: 0, speed, enableExternalBuffer: false });
			audio.samples = normalize(audio.samples);
			return audio;
		},
		// 流式合成（外部驱动）：文本预切句 → 首批 1 句（快出声），
		// 后续 2 句/批（播放缓冲足，句间不断流）；isCancelled 返回 true 停止
		async synthesizeStream(text, onChunk, isCancelled = () => false) {
			const GAIN = 4; // MeloTTS 输出峰值 ~0.1-0.19，×4 → 0.4-0.76，安全无削波
			const sentences = splitSentences(preprocessText(text));
			if (sentences.length === 0) return;
			let batch = [];
			let done = false;
			const flush = async (isLast) => {
				const segText = batch.join("。");
				batch = [];
				await tts.generateAsync({
					text: segText, sid: 0, speed, enableExternalBuffer: false,
					// silenceScale 0.1：句间停顿约 0.1s（短促自然，不拖沓）
					generationConfig: { silenceScale: 0.1, speed, sid: 0 },
					onProgress: (info) => {
						if (isCancelled()) return false;
						const s = info.samples;
						if (!s || !s.length) return true;
						const out = new Float32Array(s.length);
						for (let i = 0; i < s.length; i++) out[i] = s[i] * GAIN;
						onChunk({ samples: out, sampleRate: 44100 }, isLast && info.progress >= 1);
						return true;
					},
				});
			};
			for (let i = 0; i < sentences.length; i++) {
				if (isCancelled()) return;
				batch.push(sentences[i]);
				const batchSize = i === 0 ? 1 : 2; // 首批 1 句快出声，后续 2 句/批
				const isLast = i === sentences.length - 1;
				if (batch.length >= batchSize || isLast) {
					await flush(isLast);
					if (isLast) return;
				}
			}
		},
		// 预热：模型与推理图首次加载（后续播报即时响应）
		warmUp() {
			try {
				tts.generate({ text: "你好", sid: 0, speed, enableExternalBuffer: false });
			} catch {}
		},
	};
}

// 语音模型目录根:dsh 插件由 Host 通过 MODELS_DIR 环境变量注入
export function modelsRoot() {
	return process.env.MODELS_DIR;
}

// 加载全部真实引擎（任一缺失即抛错，由调用方降级）
export function loadSherpaEngines(root = modelsRoot()) {
	return {
		kws: createKwsEngine(path.join(root, "kws")),
		vad: createVadEngine(path.join(root, "vad", "silero_vad.onnx")),
		asr: createAsrEngine(path.join(root, "asr")),
		// TTS 不在此创建：由 buildTtsEngine 按配置懒创建（Edge 模式不加载 Melo 模型，
		// 避免 ~50MB 模型文件白白进内存；Melo 首次播报前由 warmUp 预热推理图）
		tts: null,
	};
}
