/**
 * dsh-voice-pet — Host 半。
 *
 * 本地语音(唤醒词/ASR/TTS, sherpa-onnx)+ VRM 桌宠的 dsh 插件。
 *
 * Host 职责:
 *  1. 模型管理:首次运行确保 ~/.dsh/dsh-voice-pet/models 就绪
 *     (优先复用本机 calwork 模型目录,否则从 hf-mirror 下载);
 *  2. 引擎子进程:spawn 独立 node 运行 engine/engine.mjs(sherpa 本地引擎),
 *     JSON-lines stdio 通信,崩溃自动重启;
 *  3. WebSocket /voice-pet/ws:浏览器麦克风音频帧上行 → 引擎,
 *     引擎事件/唤醒反馈/TTS 音频块下行 → 浏览器;
 *  4. 静态路由:/voice-pet/vrm(VRM 模型)、/voice-pet/clips/<file>(动画);
 *  5. 模型工具:voice_speak / voice_stop / voice_status。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_DIR = path.resolve(__dirname, '..')
const ENGINE_MAIN = path.join(PKG_DIR, 'engine', 'engine.mjs')
const FETCH_MODELS = path.join(PKG_DIR, 'fetch-models.mjs')
const ASSETS_DIR = path.join(PKG_DIR, 'assets')
const MODELS_DIR = path.join(os.homedir(), '.dsh', 'dsh-voice-pet', 'models')
/** 用户数据目录(配置/形象库/唤醒缓存);测试可用 DSH_VOICE_PET_CACHE_DIR 覆盖 */
const CACHE_DIR = process.env.DSH_VOICE_PET_CACHE_DIR || path.join(os.homedir(), '.dsh', 'dsh-voice-pet')
/** 用户上传的形象库(默认形象在 assets/cal-vrm.vrm) */
const AVATARS_DIR = path.join(CACHE_DIR, 'avatars')
/** 本机 calwork 现成模型(存在则直接复用,省去 320MB 下载) */
const CALWORK_MODELS = '/Users/calwang/dev/code/calwork/desktop-agent/assets/models'
const CONFIG_FILE = path.join(CACHE_DIR, 'config.json')
const CONFIG_DEFAULTS = {
  wakeWords: ['小希小希', '你好小希'],
  vadSilenceSeconds: 5,
  ttsEngine: 'melo',
  speed: 1,
  edgeVoice: 'zh-CN-XiaoxiaoNeural',
  speakEnabled: true,
  /** off | page(主界面浮层) | standalone(桌面独立窗口) */
  petMode: 'page',
  /** 桌宠缩放 0.5-2.0 */
  petSize: 1,
  /** 用户形象 id('' = 默认形象 assets/cal-vrm.vrm) */
  avatarId: '',
  /** 形象 id → 上传文件名 */
  avatarNames: {},
}

export const name = 'dsh-voice-pet'
export const inject = ['tools', 'webServer']

const MODEL_GROUPS = [
  { dir: 'kws', required: ['encoder-epoch-12-avg-2-chunk-16-left-64.onnx', 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx', 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx', 'tokens.txt'] },
  { dir: 'asr', required: ['model.int8.onnx', 'tokens.txt'] },
  { dir: 'tts', required: ['model.int8.onnx', 'tokens.txt', 'lexicon.txt'] },
  { dir: 'vad', required: ['silero_vad.onnx'] },
]

function modelsReady() {
  return MODEL_GROUPS.every((g) => g.required.every((f) => fs.existsSync(path.join(MODELS_DIR, g.dir, f))))
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true })
}

/** VRM 校验:glTF magic + JSON 可解析 + 含 VRMC_vrm(v1)/VRM(0.x) 扩展(移植自 calwork) */
function isValidVrm(buffer) {
  if (!buffer || buffer.length < 20) return false
  // glb magic: "glTF"
  if (buffer.readUInt32LE(0) !== 0x46546c67) return false
  try {
    const jsonLen = buffer.readUInt32LE(12)
    const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLen))
    return !!(json.extensions && (json.extensions.VRMC_vrm || json.extensions.VRM))
  } catch {
    return false
  }
}

export function apply(ctx) {
  const consoleLog = console.log
  const consoleError = console.error

  // 当前生效配置(来自 ~/.dsh/dsh-voice-pet/config.json,默认值合并)
  let voiceConfig = { ...CONFIG_DEFAULTS }
  /** 旧字段 petEnabled → petMode 迁移 */
  function migratePetMode(raw) {
    if (raw && typeof raw === 'object' && raw.petMode === undefined && raw.petEnabled !== undefined) {
      raw.petMode = raw.petEnabled ? 'page' : 'off'
    }
    return raw
  }
  function normalizeConfig(cfg) {
    const next = { ...CONFIG_DEFAULTS, ...(cfg || {}) }
    if (!['off', 'page', 'standalone'].includes(next.petMode)) next.petMode = 'page'
    const size = Number(next.petSize)
    // 独立桌宠窗口固定 360×480,最大放得下 150%
    const maxSize = next.petMode === 'standalone' ? 1.5 : 2
    next.petSize = Number.isFinite(size) ? Math.min(maxSize, Math.max(0.5, size)) : 1
    // avatarId 只允许纯数字或空(路径安全)
    if (typeof next.avatarId !== 'string' || !/^\d*$/.test(next.avatarId)) next.avatarId = ''
    if (!next.avatarNames || typeof next.avatarNames !== 'object' || Array.isArray(next.avatarNames)) next.avatarNames = {}
    return next
  }
  function loadConfigFile() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
        voiceConfig = normalizeConfig(migratePetMode(raw))
      }
    } catch (e) {
      consoleError('dsh-voice-pet: 配置文件读取失败:', e.message)
    }
  }
  function saveConfigFile(patch) {
    voiceConfig = normalizeConfig({ ...voiceConfig, ...(patch || {}) })
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(voiceConfig, null, 2) + '\n')
    } catch (e) {
      consoleError('dsh-voice-pet: 配置文件写入失败:', e.message)
    }
  }
  const readConfig = () => voiceConfig

  // ---------------- 模型管理 ----------------
  let modelState = 'checking' // checking | copying | downloading | ready | error
  let engine = null // { proc, wakeWords }

  function ensureModels() {
    if (modelsReady()) {
      modelState = 'ready'
      startEngine()
      return
    }
    if (fs.existsSync(path.join(CALWORK_MODELS, 'kws')) && fs.existsSync(path.join(CALWORK_MODELS, 'asr'))) {
      modelState = 'copying'
      consoleLog('dsh-voice-pet: 复用本机 calwork 语音模型…')
      try {
        fs.mkdirSync(MODELS_DIR, { recursive: true })
        for (const g of MODEL_GROUPS) copyDir(path.join(CALWORK_MODELS, g.dir), path.join(MODELS_DIR, g.dir))
        modelState = modelsReady() ? 'ready' : 'error'
      } catch (e) {
        consoleError('dsh-voice-pet: 模型复制失败:', e.message)
        modelState = 'error'
      }
      if (modelState === 'ready') startEngine()
      return
    }
    modelState = 'downloading'
    consoleLog('dsh-voice-pet: 下载语音模型(hf-mirror)…')
    const child = spawn(process.execPath, [FETCH_MODELS, MODELS_DIR], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })
    child.on('exit', (code) => {
      if (modelsReady()) {
        modelState = 'ready'
        startEngine()
      } else {
        modelState = 'error'
        consoleError('dsh-voice-pet: 模型下载失败(exit ' + code + '):', out.slice(-500))
      }
    })
  }

  // ---------------- 引擎子进程 ----------------
  const enginePending = new Map()
  let engineLineBuf = ''
  let engineRestartTimer = null

  function engineSend(cmd, args = {}) {
    if (!engine || !engine.proc || engine.proc.exitCode !== null) throw new Error('语音引擎未就绪')
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    return new Promise((resolve, reject) => {
      enginePending.set(id, { resolve, reject })
      engine.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
    })
  }

  function startEngine() {
    if (engine && engine.proc && engine.proc.exitCode === null) return
    const cfg = readConfig()
    const proc = spawn(process.execPath, [ENGINE_MAIN], {
      cwd: path.join(PKG_DIR, 'engine'),
      env: {
        ...process.env,
        MODELS_DIR,
        CACHE_DIR,
        WAKE_WORDS: JSON.stringify(cfg.wakeWords),
        VAD_SILENCE_MS: String(cfg.vadSilenceSeconds),
        TTS_ENGINE: cfg.ttsEngine,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    engine = { proc, wakeWords: cfg.wakeWords }
    engineLineBuf = ''
    proc.stdout.on('data', (chunk) => {
      engineLineBuf += String(chunk)
      let nl
      while ((nl = engineLineBuf.indexOf('\n')) >= 0) {
        const line = engineLineBuf.slice(0, nl)
        engineLineBuf = engineLineBuf.slice(nl + 1)
        if (!line.trim()) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id !== undefined) {
          const p = enginePending.get(msg.id)
          if (!p) continue
          enginePending.delete(msg.id)
          if (msg.ok) p.resolve(msg.result)
          else p.reject(new Error(msg.error || 'engine error'))
        } else if (msg.event) {
          broadcastToClients(msg)
        }
      }
    })
    proc.stderr.on('data', (d) => {
      const t = String(d).trim()
      if (t) consoleLog('[voice-engine] ' + t)
    })
    proc.on('exit', (code, sig) => {
      const wasEngine = engine && engine.proc === proc
      for (const [, p] of enginePending) p.reject(new Error('语音引擎退出 (' + (sig ?? code) + ')'))
      enginePending.clear()
      if (wasEngine && modelState === 'ready') {
        engine = null
        consoleError('dsh-voice-pet: 语音引擎退出(' + (sig ?? code) + '),5s 后重启')
        clearTimeout(engineRestartTimer)
        engineRestartTimer = setTimeout(startEngine, 5000)
      }
    })
    consoleLog('dsh-voice-pet: 语音引擎已启动 (pid ' + proc.pid + ')')
    applyEngineConfig()
  }

  // ---------------- WebSocket(浏览器 ⇄ 引擎) ----------------
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set()

  function broadcastToClients(msg) {
    if (msg.event === 'audio') {
      const buf = Buffer.from(msg.data, 'base64')
      for (const ws of clients) {
        if (ws.readyState === 1) {
          ws.send(buf, { binary: true })
          ws.send(JSON.stringify({ type: 'audio-meta', sampleRate: msg.sampleRate, isLast: msg.isLast }))
        }
      }
      return
    }
    const text = JSON.stringify({ type: 'event', event: msg.event, ...(msg.keyword ? { keyword: msg.keyword } : {}), ...(msg.text !== undefined ? { text: msg.text } : {}), ...(msg.source ? { source: msg.source } : {}), ...(msg.state ? { state: msg.state } : {}) })
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(text)
    }
  }

  async function handleClientMessage(ws, raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    try {
      switch (msg.type) {
        case 'audio':
          await engineSend('feed', { samples: msg.samples, sampleRate: msg.sampleRate ?? 48000 })
          break
        case 'speak':
          await engineSend('speak', { text: String(msg.text ?? '') })
          ws.send(JSON.stringify({ type: 'ack', ok: true }))
          break
        case 'stop':
          await engineSend('stop-speak')
          break
        case 'trigger-manual':
          await engineSend('trigger-manual')
          ws.send(JSON.stringify({ type: 'ack', ok: true }))
          break
        case 'status':
          try {
            const st = await engineSend('status')
            ws.send(JSON.stringify({ type: 'status', ok: true, modelState, engine: st }))
          } catch (e) {
            ws.send(JSON.stringify({ type: 'status', ok: false, error: e.message, modelState }))
          }
          break
        default:
          ws.send(JSON.stringify({ type: 'error', message: 'unknown message type: ' + msg.type }))
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }))
    }
  }

  const disposeUpgrade = ctx.webServer.registerUpgrade({
    path: '/voice-pet/ws',
    handler: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws)
        ws.on('message', (data) => {
          void handleClientMessage(ws, data.toString())
        })
        ws.on('close', () => clients.delete(ws))
        ws.on('error', () => clients.delete(ws))
        ws.send(JSON.stringify({ type: 'status', ok: true, modelState, ready: engine !== null }))
      })
    },
  })

  // ---------------- 静态路由 ----------------
  const CLIP_WHITELIST = new Set(fs.existsSync(path.join(ASSETS_DIR, 'clips')) ? fs.readdirSync(path.join(ASSETS_DIR, 'clips')) : [])

  // 当前生效的 VRM 路径:用户上传形象优先,否则默认形象
  function resolveVrmPath() {
    const cfg = readConfig()
    if (cfg.avatarId) {
      const p = path.join(AVATARS_DIR, cfg.avatarId + '.vrm')
      if (fs.existsSync(p)) return p
    }
    return path.join(ASSETS_DIR, 'cal-vrm.vrm')
  }

  // 形象列表:默认 + 已上传(名称取自上传文件名)
  function listAvatars() {
    const cfg = readConfig()
    const list = [{ id: 'default', name: '默认形象', custom: false }]
    try {
      const dir = AVATARS_DIR
      if (fs.existsSync(dir)) {
        const names = cfg.avatarNames || {}
        for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.vrm'))) {
          const id = f.replace(/\.vrm$/i, '')
          list.push({ id, name: names[id] || '形象 ' + id.slice(-4), custom: true })
        }
      }
    } catch {}
    return list
  }

  const disposeVrm = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/vrm',
    handler: (req, res) => {
      const file = resolveVrmPath()
      if (!fs.existsSync(file)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' })
      fs.createReadStream(file).pipe(res)
    },
  })
  // ---------------- 独立页面路由(桌宠可脱离 dsh 主界面单独打开) ----------------
  // 仅 petMode === 'standalone' 时提供,桌面壳启动时探测该页,404 则不建独立窗口
  const petPageEnabled = () => readConfig().petMode === 'standalone'
  const STANDALONE_BUNDLE = path.join(PKG_DIR, 'dist', 'pet-standalone.js')
  const PET_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>语音桌宠</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  #host { position: fixed; inset: 0; }
  /* Desktop shell: invisible top strip that drags the frameless window; the pet area below keeps its own drag/poke/talk interactions. */
  #drag-strip { position: fixed; top: 0; left: 0; right: 0; height: 20px; cursor: grab; z-index: 100; -webkit-user-select: none; user-select: none; }
</style>
</head>
<body>
<div id="drag-strip" data-tauri-drag-region></div>
<div id="host"></div>
<script src="/voice-pet/pet-standalone.js"></script>
<script>DshVoicePet.mount(document.getElementById('host'))</script>
</body>
</html>`

  const disposePetPage = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/pet',
    handler: (req, res) => {
      if (!petPageEnabled()) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(PET_PAGE_HTML)
    },
  })
  const disposeStandaloneBundle = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/pet-standalone.js',
    handler: (req, res) => {
      if (!petPageEnabled()) {
        res.writeHead(404).end()
        return
      }
      if (!fs.existsSync(STANDALONE_BUNDLE)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      fs.createReadStream(STANDALONE_BUNDLE).pipe(res)
    },
  })

  const disposeClips = ctx.webServer.register({
    kind: 'prefix',
    path: '/voice-pet/clips',
    handler: (req, res) => {
      const name = decodeURIComponent((req.url ?? '').split('?')[0].split('/').pop() ?? '')
      if (!CLIP_WHITELIST.has(name)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' })
      fs.createReadStream(path.join(ASSETS_DIR, 'clips', name)).pipe(res)
    },
  })

  // ---------------- 模型工具 ----------------
  const textRender = (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  const disposers = []
  const register = (tool) => disposers.push(ctx.tools.register(tool))
  register({
    name: 'voice_speak',
    description: '让语音桌宠用本地 TTS 朗读一段文本(同步触发;播放不阻塞工具返回)。',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '要朗读的文本' } }, required: ['text'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
    async execute(args) {
      await engineSend('speak', { text: String(args.text) })
      return { ok: true, text: String(args.text) }
    },
  })
  register({
    name: 'voice_stop',
    description: '停止当前语音播报。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
    async execute() {
      await engineSend('stop-speak')
      return { ok: true }
    },
  })
  register({
    name: 'voice_status',
    description: '查询语音引擎与模型状态。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
    async execute() {
      try {
        const st = await engineSend('status')
        return { modelState, ...st }
      } catch (e) {
        return { modelState, error: e.message }
      }
    },
  })

  // ---------------- 配置(自持:config.json + GET/POST 路由;settings 服务
  // 的 Web 暴露有白名单限制,第三方 namespace 不可达) ----------------
  function applyEngineConfig() {
    const cfg = readConfig()
    consoleLog('dsh-voice-pet: 配置生效', JSON.stringify(cfg))
    if (engine && engine.proc && engine.proc.exitCode === null) {
      engineSend('set-config', {
        wakeWords: cfg.wakeWords,
        vadSilenceSeconds: cfg.vadSilenceSeconds,
        engine: cfg.ttsEngine,
        speed: cfg.speed,
        edgeVoice: cfg.edgeVoice,
        speakEnabled: cfg.speakEnabled,
      }).catch((e) => consoleError('dsh-voice-pet: 配置下发失败:', e.message))
    }
  }

  const disposeConfig = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/config',
    handler: (req, res) => {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (d) => { body += d })
        req.on('end', () => {
          try {
            const patch = JSON.parse(body || '{}')
            if (typeof patch !== 'object' || patch === null) throw new Error('patch must be an object')
            saveConfigFile(patch)
            applyEngineConfig()
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, config: readConfig() }))
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: e.message }))
          }
        })
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(readConfig()))
    },
  })

  // ---------------- 用户形象库(上传/列表/切换/删除) ----------------
  const disposeAvatarUpload = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/vrm-upload',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      let body = ''
      req.on('data', (d) => { body += d })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}')
          const base64 = payload.base64
          if (typeof base64 !== 'string' || base64.length === 0) {
            sendJson(res, 400, { ok: false, error: '文件内容为空' })
            return
          }
          const buffer = Buffer.from(base64, 'base64')
          if (buffer.length > 64 * 1024 * 1024) {
            sendJson(res, 400, { ok: false, error: '文件过大(上限 64MB)' })
            return
          }
          if (!isValidVrm(buffer)) {
            sendJson(res, 400, { ok: false, error: '不是有效的 VRM 文件(需为 VRM 1.0/0.x 格式)' })
            return
          }
          const id = String(Date.now())
          fs.mkdirSync(AVATARS_DIR, { recursive: true })
          fs.writeFileSync(path.join(AVATARS_DIR, id + '.vrm'), buffer)
          const rawName = String(payload.filename ?? '').replace(/\.vrm$/i, '').trim()
          const names = { ...(readConfig().avatarNames || {}) }
          if (rawName) names[id] = rawName
          saveConfigFile({ avatarId: id, avatarNames: names })
          sendJson(res, 200, { ok: true, avatarId: id, avatars: listAvatars() })
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message })
        }
      })
    },
  })

  const disposeAvatarList = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/avatars',
    handler: (req, res) => {
      sendJson(res, 200, { ok: true, avatars: listAvatars() })
    },
  })

  const disposeAvatarSet = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/avatar',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const id = String(body.id ?? '')
        if (id === 'default' || id === '') {
          saveConfigFile({ avatarId: '' })
        } else if (/^\d+$/.test(id) && fs.existsSync(path.join(AVATARS_DIR, id + '.vrm'))) {
          saveConfigFile({ avatarId: id })
        } else {
          sendJson(res, 400, { ok: false, error: '形象不存在' })
          return
        }
        sendJson(res, 200, { ok: true, avatars: listAvatars() })
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message })
      }
    },
  })

  const disposeAvatarDelete = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/avatar-delete',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const id = String(body.id ?? '')
        if (!/^\d+$/.test(id)) {
          sendJson(res, 400, { ok: false, error: '非法形象 id' })
          return
        }
        fs.rmSync(path.join(AVATARS_DIR, id + '.vrm'), { force: true })
        const cfg = readConfig()
        const patch = { avatarNames: { ...(cfg.avatarNames || {}) } }
        delete patch.avatarNames[id]
        if (cfg.avatarId === id) patch.avatarId = ''
        saveConfigFile(patch)
        sendJson(res, 200, { ok: true, avatars: listAvatars() })
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message })
      }
    },
  })

  // ---------------- 一次性接口(输入框语音输入 / 消息卡片播报) ----------------
  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (d) => { body += d })
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'))
        } catch (e) {
          reject(new Error('invalid JSON body'))
        }
      })
      req.on('error', reject)
    })
  }
  function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }

  const disposeTranscribe = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/transcribe',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const samples = body.samples
        if (!Array.isArray(samples) || samples.length === 0) {
          sendJson(res, 400, { ok: false, error: 'samples required' })
          return
        }
        const result = await engineSend('transcribe', { samples, sampleRate: body.sampleRate ?? 48000 })
        sendJson(res, 200, { ok: true, text: result.text ?? '' })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e.message })
      }
    },
  })
  const disposeSpeak = ctx.webServer.register({
    kind: 'exact',
    path: '/voice-pet/speak',
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        if (!body.text) {
          sendJson(res, 400, { ok: false, error: 'text required' })
          return
        }
        const result = await engineSend('speak-sync', { text: String(body.text) })
        sendJson(res, 200, { ok: true, ...result })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e.message })
      }
    },
  })

  // ---------------- 生命周期 ----------------
  loadConfigFile()
  ensureModels()
  ctx.effect(() => {
    return () => {
      disposeUpgrade()
      disposeVrm()
      disposeClips()
      disposePetPage()
      disposeStandaloneBundle()
      disposeConfig()
      disposeAvatarUpload()
      disposeAvatarList()
      disposeAvatarSet()
      disposeAvatarDelete()
      disposeTranscribe()
      disposeSpeak()
      for (const d of disposers) {
        try {
          d()
        } catch {}
      }
      for (const ws of clients) {
        try {
          ws.close()
        } catch {}
      }
      wss.close()
      clearTimeout(engineRestartTimer)
      if (engine && engine.proc && engine.proc.exitCode === null) {
        engine.proc.kill('SIGTERM')
      }
      consoleLog('dsh-voice-pet: stopped')
    }
  })
}
