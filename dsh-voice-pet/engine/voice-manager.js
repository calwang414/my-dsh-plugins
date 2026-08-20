// VoiceManager：语音管线状态机（main 进程）
// 状态：idle → listening(KWS 常驻) → woken(倾听指令) → processing → speaking
// 引擎（KWS/VAD/ASR/TTS）通过构造函数注入——生产用 sherpa-onnx 真实实现，
// 单测注入 fake 引擎；识别/唤醒/超时/防重复逻辑在此统一管理
export class VoiceManager {
	// 注入：kws{v feed,start,stop,onKeyword}, vad{feed,onSegment,stop},
	//       asr{recognize,stop}, tts{synthesize,stop}
	// 配置：wakeWords, timeoutMs(唤醒后无指令超时), manualTimeoutMs(按钮路径超时),
	//       debounceMs(防重复唤醒), returnDelayMs(指令处理完回 listening 的延迟)
	// 事件：onEvent(name, data) — wake/command/timeout/speaking
	constructor({ kws, vad, asr, tts, wakeWords = [], timeoutMs = 5000, manualTimeoutMs = 5000, debounceMs = 5000, returnDelayMs = 2000, onEvent = () => {} }) {
		this.kws = kws;
		this.vad = vad;
		this.asr = asr;
		this.tts = tts;
		this.wakeWords = wakeWords;
		this.timeoutMs = timeoutMs;
		this.manualTimeoutMs = manualTimeoutMs; // 按钮路径超时（与唤醒路径一致，默认 5s）
		this.debounceMs = debounceMs;
		this.returnDelayMs = returnDelayMs;
		this.onEvent = onEvent;
		this.onAudio = null; // TTS 合成音频回调（播放端注入）
		this.onSpeakError = null; // 合成失败回调（播放端/按钮还原）

		this.state = "idle"; // idle | listening | woken | processing | speaking
		this.manual = false; // 当前倾听是否由按钮触发（vs 唤醒词）
		this.kwsRunning = false; // KWS 常驻监听是否在跑（按钮路径可脱离常驻独立使用）
		this.timeoutTimer = null;
		this.returnTimer = null;
		this.lastWakeAt = 0;
		this.speakQueue = []; // 播报队列（正文串行播放）
		this.segmentHeard = false; // 本次倾听是否已收到语音段（开始说指令则不超时取消）
		this.dialogue = false; // 连续对话模式（仅唤醒路径进入：回复播完自动续听）

	// 引擎回调绑定
	this.kws.onKeyword = (keyword) => this.#onWake(keyword);
	this.vad.onSegment = (seg) => this.#onSegment(seg);
	}

	// 热替换 VAD 引擎（说完判定秒数变更时重建；保持 onSegment 绑定；null 表示关闭）
	setVad(vad) {
		this.vad = vad;
		if (vad) vad.onSegment = (seg) => this.#onSegment(seg);
	}

	// 热替换 KWS 引擎（唤醒词变更时重建；保持 onKeyword 绑定；null 表示关闭）
	setKws(kws) {
		this.kws = kws;
		if (kws) kws.onKeyword = (keyword) => this.#onWake(keyword);
	}

	// 热替换 ASR 引擎（输入能力开关变化时增减；null 表示关闭）
	setAsr(asr) {
		this.asr = asr;
	}

	// 开始常驻监听（桌宠开启时调用；KWS 未加载时保持 idle）
	startListening() {
		if (!this.kws) return;
		if (this.state !== "idle") this.stopListening();
		this.state = "listening";
		this.kwsRunning = true;
		this.kws.start();
		console.log("[语音] KWS 常驻监听已启动");
	}

	// 停止监听并释放（桌宠关闭时调用）
	stopListening() {
		this.#clearTimers();
		this.state = "idle";
		this.kwsRunning = false;
		this.kws?.stop();
		this.vad?.stop();
	}

	// 按钮路径：进入倾听态听一句（不进 KWS 命中流程）
	// 与唤醒开关解耦：关闭常驻监听（idle）时按钮路径仍可用（临时采集）
	triggerManual() {
		if (!this.vad || !this.asr) return; // 识别能力未加载时按钮路径不可用
		if (this.state === "woken" || this.state === "processing" || this.state === "speaking") return;
		this.manual = true;
		this.dialogue = false; // 按钮路径单次提问（播完不续听）
		this.#enterWoken(this.manualTimeoutMs);
	}

	// 取消按钮倾听
	cancelManual() {
		if (this.state === "woken" && this.manual) {
			this.manual = false;
			this.#backToListening();
		}
	}

	// 采集端流式喂入音频帧（float32 @16k）
	feedAudio(samples) {
		// speaking（播报中）也喂 KWS：喊唤醒词可打断播报并提新问题
		if ((this.state === "listening" || this.state === "speaking") && this.kws) this.kws.feed(samples);
		else if (this.state === "woken" && this.vad) this.vad.feed(samples);
	}

	// 文本 → 流式 TTS 合成（每块音频经 onAudio 回调交给播放端）。
	// 队列化：任务正文连续到达时串行播放（上一段播完再播下一段），
	// 避免多段同时合成/打断造成音频块交错；stopSpeak 可清队列取消。
	// onDone：该段播完（队列清空）时回调（如唤醒反馈播完再进入倾听）
	speak(text, onDone = null) {
		if (!this.tts) {
			this.onSpeakError?.();
			return;
		}
		this.speakQueue.push({ text, onDone });
		if (this.state !== "speaking") this.#drainSpeakQueue();
	}

	// 播放队列空且无播报 → 取队首合成播放
	#drainSpeakQueue() {
		if (this.state === "speaking" || this.speakQueue.length === 0) return;
		const item = this.speakQueue.shift();
		this.currentOnDone = item.onDone;
		this.#startSpeak(item.text);
	}

	// 开始合成并播放一段（队列取出的文本）
	#startSpeak(text) {
		this.state = "speaking";
		this.speakToken = (this.speakToken ?? 0) + 1;
		const token = this.speakToken;
		this.onEvent("speaking", { text });
		try {
			if (this.tts.synthesizeStream) {
				this.tts.synthesizeStream(text, (chunk, isLast) => this.onAudio?.(chunk, isLast), () => token !== this.speakToken);
			} else if (this.tts.synthesize) {
				// 兼容：非流式引擎（测试 fake）
				const audio = this.tts.synthesize(text);
				if (audio && audio.samples.length > 0) this.onAudio?.(audio, true);
			}
		} catch {
			// 合成异常：通知播放端结束（按钮即时还原）；队列剩余由 finishSpeaking 继续
			this.onSpeakError?.();
		}
	}

	// 播放端播完回调：队列还有 → 播下一段；否则触发本段 onDone 并处理状态
	finishSpeaking() {
		if (this.state !== "speaking") return;
		if (this.speakQueue.length > 0) {
			// 当前段已播完，直接取队首续播（drain 的 state 检查会挡住本调用）
			const item = this.speakQueue.shift();
			this.currentOnDone = item.onDone;
			this.#startSpeak(item.text);
		} else {
			const onDone = this.currentOnDone;
			this.currentOnDone = null;
			// 唤醒反馈 onDone → 进入倾听；连续对话中回复播完 → 自动续听下一句；
			// 非对话（按钮/历史播放）→ 回常驻监听
			if (onDone) onDone();
			else if (this.dialogue) this.#enterWoken();
			else this.#backToListening();
		}
	}

	// 停止当前播报：递增 token 取消进行中的合成（后续块不再回调）+ 清空队列
	stopSpeak() {
		this.speakToken = (this.speakToken ?? 0) + 1;
		this.speakQueue = [];
		this.finishSpeaking();
	}

	// —— 内部实现 ——

	#onWake(keyword) {
		// 防重复：5s 内同一次命中只响应一次
		if (Date.now() - this.lastWakeAt < this.debounceMs) return;
		this.lastWakeAt = Date.now();
		this.manual = false;
		this.dialogue = true; // 唤醒路径进入连续对话（回复播完自动续听）
		this.onEvent("wake", { keyword });
		// 打断：播报中喊唤醒词 → 停止当前播报（含队列），转入新指令倾听
		if (this.state === "speaking") this.stopSpeak();
		// 播完"我在"反馈后再进入倾听（按钮高亮时机 = 反馈播报完成）。
		// 兜底：反馈播报卡死（TTS 异常）时 10s 后强制取消，避免永久 speaking
		this.wakeDoneTimer = setTimeout(() => {
			if (this.state === "speaking" && !this.segmentHeard) this.#backToListening();
		}, 10000);
		this.speak("我在", () => {
			clearTimeout(this.wakeDoneTimer);
			this.#enterWoken();
		});
	}

	#onSegment(seg) {
		console.log("[语音] VAD 弹出语音段:", seg.samples.length, "采样");
		this.segmentHeard = true;
		const text = (this.asr.recognize(seg) ?? "").trim();
		console.log("[语音] ASR 识别结果:", JSON.stringify(text));
		if (!text) return;
		this.#clearTimers();
		this.state = "processing";
		// 唤醒词路径：去除句首唤醒词后作为指令；按钮路径：原文
		const cleaned = this.manual ? text : this.#stripWakeWord(text);
		this.onEvent("command", { text: cleaned, source: this.manual ? "button" : "wakeword" });
		// 指令处理完（gohermes 约定 2s）回到常驻监听
		this.returnTimer = setTimeout(() => this.#backToListening(), this.returnDelayMs);
	}

	#enterWoken(timeoutMs) {
		this.state = "woken";
		this.segmentHeard = false;
		this.#clearTimers();
		// 立即同步按钮为语音输入态（唤醒/按钮两条路径进入倾听即高亮）
		this.onEvent("state", { state: "woken" });
		this.timeoutTimer = setTimeout(() => {
			// 超时取消：woken（没说话）或 speaking（"我在"反馈播报卡住）且
			// 尚未开始说指令——已弹出语音段（processing 后）不打断。
			// 超时窗口由 refreshTimeout 按语音活动刷新（连续 5s 完全静音才取消）
			if (!this.segmentHeard && (this.state === "woken" || this.state === "speaking")) {
				this.manual = false;
				this.onEvent("timeout", {});
				this.#backToListening();
			}
		}, timeoutMs ?? this.timeoutMs);
	}

	// 麦克风检测到语音活动时刷新超时窗口（连续静音时长重新累计）；
	// 由采集侧（index.js 帧能量）调用——说话中（含停顿）不取消
	refreshTimeout() {
		if (this.state !== "woken" || this.segmentHeard) return;
		this.#clearTimers();
		this.timeoutTimer = setTimeout(() => {
			if (!this.segmentHeard && (this.state === "woken" || this.state === "speaking")) {
				this.manual = false;
				this.onEvent("timeout", {});
				this.#backToListening();
			}
		}, this.manual ? this.manualTimeoutMs : this.timeoutMs);
	}

	#backToListening() {
		this.#clearTimers();
		if (this.state === "idle") return;
		this.dialogue = false; // 退出连续对话
		// 按钮路径（常驻监听未启动）→ 直接回 idle，避免 KWS 空流
		if (!this.kwsRunning) {
			this.state = "idle";
			this.onEvent("state", { state: this.state });
			return;
		}
		this.state = "listening";
		this.onEvent("state", { state: this.state });
	}

	#stripWakeWord(text) {
		for (const w of this.wakeWords) {
			if (text.startsWith(w)) return text.slice(w.length).trim();
		}
		return text;
	}

	#clearTimers() {
		if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
		if (this.returnTimer) clearTimeout(this.returnTimer);
		if (this.wakeDoneTimer) clearTimeout(this.wakeDoneTimer);
		this.timeoutTimer = null;
		this.returnTimer = null;
		this.wakeDoneTimer = null;
	}
}
