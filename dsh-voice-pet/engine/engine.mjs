/**
 * dsh-voice-pet 语音引擎子进程。
 *
 * 由 Host(lib/index.js)spawn,JSON-lines stdio 通信:
 *  - stdin 命令:{id, cmd, args} → stdout 响应 {id, ok, result?} / {id, ok:false, error}
 *  - stdout 事件(无 id):{event} — audio(二进制 base64)/wake/command/speaking/
 *    speaking-done/timeout/state
 *
 * 环境变量:MODELS_DIR(模型根)、CACHE_DIR(「我在」唤醒缓存)、
 * WAKE_WORDS(JSON 数组)、VAD_SILENCE_MS(说完判定秒数)、TTS_ENGINE(melo|edge)。
 *
 * 管线复用 calwork 桌面端的 VoiceManager(状态机)+ sherpa-onnx 引擎层,
 * 播放端从 Electron 替换为 WebSocket 下行音频块(浏览器 AudioContext 播放)。
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import pkg from 'sherpa-onnx-node'
import { VoiceManager } from './voice-manager.js'
import { modelsRoot, createTtsEngine, preprocessText, createVadEngine, createKwsEngine, createAsrEngine } from './sherpa-engines.js'
import { createEdgeTtsEngine } from './edge-tts-engine.js'
import { writeKeywordsFile } from './wake-words.js'

const MODELS_DIR = process.env.MODELS_DIR
const CACHE_DIR = process.env.CACHE_DIR || ''
const WAKE_TEXT = '我在'

// stdout 是纯 JSON-lines 协议流:引擎内(含 calwork 模块)所有 console.log 改道 stderr
console.log = (...args) => console.error(...args)

function defaultWakeWords() {
  try {
    const w = JSON.parse(process.env.WAKE_WORDS || '[]')
    if (Array.isArray(w) && w.length > 0) return w
  } catch {}
  return ['小希小希', '你好小希']
}

// 当前生效配置(初始来自 env,set-config 命令热更新)
let config = {
  engine: process.env.TTS_ENGINE === 'edge' ? 'edge' : 'melo',
  edgeVoice: 'zh-CN-XiaoxiaoNeural',
  speed: 1,
  speakEnabled: true,
  enableWakeword: true,
  enableMicInput: true,
  vadSilenceSeconds: Math.max(2, Math.min(15, Number(process.env.VAD_SILENCE_MS) || 5)),
  wakeWords: defaultWakeWords(),
}

// ---------------- 「我在」唤醒反馈离线音频缓存 ----------------
// 固定文案按当前引擎/音色合成一次落盘,唤醒时直接读缓存播放(毫秒级响应)
const WAKE_DIR = path.join(CACHE_DIR, 'wake-cache')
const WAKE_PCM = path.join(WAKE_DIR, 'wake.f32')
const WAKE_META = path.join(WAKE_DIR, 'wake.json')

function loadWakeCache() {
  try {
    const info = JSON.parse(fs.readFileSync(WAKE_META, 'utf8'))
    const buf = fs.readFileSync(WAKE_PCM)
    return { samples: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), sampleRate: info.sampleRate }
  } catch {
    return null
  }
}

function saveWakeCache(samples, sampleRate) {
  try {
    fs.mkdirSync(WAKE_DIR, { recursive: true })
    fs.writeFileSync(WAKE_PCM, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    fs.writeFileSync(WAKE_META, JSON.stringify({ sampleRate }))
  } catch {}
}

function invalidateWakeCache() {
  try {
    fs.rmSync(WAKE_PCM, { force: true })
    fs.rmSync(WAKE_META, { force: true })
  } catch {}
}

// 引擎包装:拦截「我在」→ 读缓存播放;无缓存时委托原引擎合成并落盘
function buildWakeCachedTts(engine) {
  const origStream = engine.synthesizeStream.bind(engine)
  engine.synthesizeStream = async (text, onChunk, isCancelled = () => false) => {
    const isWake = text === WAKE_TEXT
    if (isWake) {
      const cache = loadWakeCache()
      if (cache) {
        const CHUNK = 8192
        for (let i = 0; i < cache.samples.length; i += CHUNK) {
          if (isCancelled()) return
          const end = Math.min(i + CHUNK, cache.samples.length)
          onChunk({ samples: cache.samples.slice(i, end), sampleRate: cache.sampleRate }, end >= cache.samples.length)
        }
        return
      }
    }
    const chunks = []
    await origStream(text, (chunk, isLast) => {
      chunks.push(chunk)
      onChunk(chunk, isLast)
    }, isCancelled)
    if (isWake && chunks.length > 0) {
      const total = chunks.reduce((a, c) => a + c.samples.length, 0)
      const merged = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        merged.set(c.samples, off)
        off += c.samples.length
      }
      saveWakeCache(merged, chunks[0].sampleRate)
    }
  }
  return engine
}

function buildTtsEngine(cfg) {
  if (cfg.engine === 'edge') return createEdgeTtsEngine(cfg.edgeVoice ?? 'zh-CN-XiaoxiaoNeural', cfg.speed ?? 1)
  return createTtsEngine(path.join(modelsRoot(), 'tts'), cfg.speed ?? 1)
}

// ---------------- 输出 ----------------
function out(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function respond(id, ok, result, error) {
  out({ id, ok, ...(result !== undefined ? { result } : {}), ...(error ? { error } : {}) })
}

function broadcastAudio(audio, isLast) {
  const base64 = Buffer.from(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength).toString('base64')
  out({ event: 'audio', data: base64, sampleRate: audio.sampleRate, isLast: !!isLast })
}

// ---------------- 管线 ----------------
let vm = null
const resamplers = new Map()

function getResampler(sampleRate) {
  if (!resamplers.has(sampleRate)) {
    resamplers.set(sampleRate, new pkg.LinearResampler(sampleRate, 16000))
  }
  return resamplers.get(sampleRate)
}

// 浏览器音频帧(任意采样率)→ 16k + 增益 ×4 + 语音活动感知
function prepareSamples(samples, sampleRate) {
  const resampled = getResampler(sampleRate ?? 48000).resample(Float32Array.from(samples))
  const rebuilt = new Float32Array(resampled.length)
  for (let i = 0; i < resampled.length; i++) rebuilt[i] = resampled[i] * 4
  return rebuilt
}

function initVoice() {
  // 按配置按需加载模型:唤醒关 → 不加载 KWS/VAD;语音输入关且唤醒关 → 不加载 ASR;
  // 播报关 → 不加载 TTS(Melo)。控制应用启动时的内存与 CPU 占用。
  const engines = { kws: null, vad: null, asr: null, tts: null }
  if (config.enableWakeword) {
    try {
      writeKeywordsFile(path.join(modelsRoot(), 'kws'), config.wakeWords)
      engines.kws = createKwsEngine(path.join(modelsRoot(), 'kws'))
      engines.vad = createVadEngine(path.join(modelsRoot(), 'vad', 'silero_vad.onnx'), config.vadSilenceSeconds)
    } catch (e) {
      console.error('[voice-engine] 唤醒组件初始化失败:', e.message)
    }
  }
  if (config.enableWakeword || config.enableMicInput) {
    try {
      engines.asr = createAsrEngine(path.join(modelsRoot(), 'asr'))
    } catch (e) {
      console.error('[voice-engine] 识别组件初始化失败:', e.message)
    }
  }
  if (config.speakEnabled) {
    engines.tts = buildWakeCachedTts(buildTtsEngine(config))
  }
  vm = new VoiceManager({
    ...engines,
    wakeWords: config.wakeWords,
    timeoutMs: 5000,
    manualTimeoutMs: 5000,
    debounceMs: 5000,
    onEvent: (name, data) => {
      if (name === 'wake') {
        out({ event: 'wake', keyword: data.keyword })
      } else if (name === 'command') {
        out({ event: 'command', text: data.text, source: data.source })
      } else if (name === 'speaking') {
        out({ event: 'speaking', text: data.text })
      } else if (name === 'timeout') {
        out({ event: 'timeout' })
      } else if (name === 'state') {
        out({ event: 'state', state: data.state })
      }
    },
  })
  vm.onAudio = (audio, isLast) => {
    broadcastAudio(audio, isLast)
    if (isLast) {
      // 客户端自行播放,引擎无法感知播放结束:末块发出即推进状态机
      out({ event: 'speaking-done' })
      setTimeout(() => vm?.finishSpeaking(), 0)
    }
  }
  vm.onSpeakError = () => out({ event: 'speaking-done' })
  if (config.enableWakeword && engines.kws) vm.startListening()
  setTimeout(() => engines.tts?.warmUp?.(), 1000)
  out({ event: 'state', state: vm.state })
  return vm
}

// 配置热更新(与 calwork setTtsConfig 同逻辑:重建 KWS/VAD/TTS)
let appliedConfig = null

function applyConfig(patch) {
  const next = { ...config, ...(patch || {}) }
  next.engine = next.engine === 'edge' ? 'edge' : 'melo'
  next.speed = Math.max(0.5, Math.min(1.5, Number(next.speed) || 1))
  next.vadSilenceSeconds = Math.max(2, Math.min(15, Number(next.vadSilenceSeconds) || 5))
  next.wakeWords = Array.isArray(next.wakeWords) && next.wakeWords.length > 0 ? next.wakeWords : defaultWakeWords()
  next.speakEnabled = next.speakEnabled !== false
  next.enableWakeword = next.enableWakeword !== false
  next.enableMicInput = next.enableMicInput !== false
  const changed = JSON.stringify(next) !== JSON.stringify(config)
  config = next
  if (!changed || !vm) return
  invalidateWakeCache()
  // TTS:播报关 → 置空(释放 Melo 模型);开 → 重建(引擎切换也走这里)
  vm.tts = config.speakEnabled ? buildWakeCachedTts(buildTtsEngine(config)) : null
  const wasRunning = vm.kwsRunning
  if (wasRunning) vm.stopListening()
  // 唤醒开关:KWS + VAD 按 enableWakeword 增减(唤醒词/说完秒数变更也走这里)
  if (config.enableWakeword) {
    try {
      writeKeywordsFile(path.join(modelsRoot(), 'kws'), config.wakeWords)
      vm.setKws(createKwsEngine(path.join(modelsRoot(), 'kws')))
    } catch (e) {
      console.error('[voice-engine] 唤醒词重建失败:', e.message)
    }
    try {
      vm.setVad(createVadEngine(path.join(modelsRoot(), 'vad', 'silero_vad.onnx'), config.vadSilenceSeconds))
    } catch (e) {
      console.error('[voice-engine] VAD 重建失败:', e.message)
    }
  } else {
    vm.setKws(null)
    vm.setVad(null)
  }
  // 语音输入/唤醒任一开启时确保 ASR 就绪,否则释放
  if (config.enableWakeword || config.enableMicInput) {
    if (!vm.asr) {
      try {
        vm.setAsr(createAsrEngine(path.join(modelsRoot(), 'asr')))
      } catch (e) {
        console.error('[voice-engine] ASR 加载失败:', e.message)
      }
    }
  } else {
    vm.setAsr(null)
  }
  if (wasRunning && config.enableWakeword) vm.startListening()
}

// ---------------- 命令循环 ----------------
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', async (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, cmd, args = {} } = msg
  try {
    switch (cmd) {
      case 'feed': {
        const samples = args.samples
        if (vm && Array.isArray(samples) && samples.length > 0) {
          const rebuilt = prepareSamples(samples, args.sampleRate)
          // 语音活动感知:帧能量超过阈值刷新倾听超时(说话中停顿不取消)
          let energy = 0
          for (let i = 0; i < rebuilt.length; i++) energy += rebuilt[i] * rebuilt[i]
          if (Math.sqrt(energy / rebuilt.length) > 0.03) vm.refreshTimeout()
          vm.feedAudio(rebuilt)
        }
        respond(id, true)
        break
      }
      case 'speak': {
        if (!vm) throw new Error('语音引擎未就绪')
        if (!config.speakEnabled) {
          out({ event: 'speaking-done' })
          respond(id, true)
          break
        }
        vm.speak(String(args.text ?? ''))
        respond(id, true)
        break
      }
      case 'stop-speak':
        vm?.stopSpeak()
        out({ event: 'speaking-done' })
        respond(id, true)
        break
      case 'trigger-manual':
        vm?.triggerManual()
        respond(id, true)
        break
      case 'status':
        respond(id, true, { ready: vm !== null, state: vm?.state ?? 'idle' })
        break
      case 'set-config':
        applyConfig(args)
        respond(id, true, { config })
        break
      case 'transcribe': {
        if (!vm) throw new Error('语音引擎未就绪')
        if (!config.enableMicInput) throw new Error('语音输入已关闭')
        if (!vm.asr) throw new Error('语音识别模型未加载')
        const samples = Array.isArray(args.samples) ? args.samples : []
        if (samples.length === 0) throw new Error('samples required')
        const rebuilt = prepareSamples(samples, args.sampleRate)
        const text = (vm.asr.recognize({ samples: rebuilt, sampleRate: 16000 }) ?? '').trim()
        respond(id, true, { text })
        break
      }
      case 'speak-sync': {
        if (!config.speakEnabled) throw new Error('语音播报已关闭')
        if (!vm?.tts) throw new Error('语音引擎未就绪')
        const text = preprocessText(String(args.text ?? ''))
        if (!text.trim()) {
          respond(id, true, { audio: '', sampleRate: 44100 })
          break
        }
        const audio = await vm.tts.synthesize(text)
        const base64 = Buffer.from(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength).toString('base64')
        respond(id, true, { audio: base64, sampleRate: audio.sampleRate })
        break
      }
      default:
        respond(id, false, undefined, 'unknown command: ' + cmd)
    }
  } catch (e) {
    respond(id, false, undefined, e.message)
  }
})

// ---------------- 启动 ----------------
try {
  initVoice()
  console.error('[voice-engine] 引擎就绪,模型目录:', MODELS_DIR)
} catch (e) {
  console.error('[voice-engine] 引擎初始化失败:', e.message)
  process.exit(1)
}
