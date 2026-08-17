/**
 * 引擎冒烟测试:spawn engine.mjs(需 MODELS_DIR 指向就绪的模型目录),
 * 发送 status / set-config / stop-speak,校验 JSON-lines 响应与事件流。
 * 用法:MODELS_DIR=~/.dsh/dsh-voice-pet/models node test-engine.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = process.env.MODELS_DIR || path.join(os.homedir(), '.dsh', 'dsh-voice-pet', 'models')

function modelsReady() {
  const groups = [
    ['kws', 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx'],
    ['asr', 'model.int8.onnx'],
    ['tts', 'model.int8.onnx'],
    ['vad', 'silero_vad.onnx'],
  ]
  return groups.every(([dir, file]) => fs.existsSync(path.join(MODELS_DIR, dir, file)))
}

if (!modelsReady()) {
  console.log('模型未就绪,跳过:', MODELS_DIR)
  process.exit(0)
}

const proc = spawn(process.execPath, [path.join(__dirname, 'engine.mjs')], {
  cwd: __dirname,
  env: {
    ...process.env,
    MODELS_DIR,
    CACHE_DIR: path.join(os.homedir(), '.dsh', 'dsh-voice-pet'),
    WAKE_WORDS: JSON.stringify(['小希小希', '你好小希']),
    VAD_SILENCE_MS: '5',
    TTS_ENGINE: 'melo',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let lineBuf = ''
const received = []
proc.stdout.on('data', (d) => {
  lineBuf += String(d)
  let nl
  while ((nl = lineBuf.indexOf('\n')) >= 0) {
    const line = lineBuf.slice(0, nl)
    lineBuf = lineBuf.slice(nl + 1)
    if (!line.trim()) continue
    received.push(JSON.parse(line))
  }
})
proc.stderr.on('data', (d) => process.stderr.write('[engine] ' + d))

const send = (cmd, args = {}) => {
  const id = 't' + received.length + '-' + Date.now().toString(36)
  proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 20000)
    const check = () => {
      const msg = received.find((m) => m.id === id)
      if (msg) {
        clearTimeout(timer)
        resolve(msg)
      } else {
        setTimeout(check, 100)
      }
    }
    check()
  })
}

setTimeout(async () => {
  const status = await send('status')
  console.log('status →', status && status.ok, status && status.result)
  const cfg = await send('set-config', { engine: 'melo', speed: 1.1 })
  console.log('set-config →', cfg && cfg.ok)
  const stop = await send('stop-speak')
  console.log('stop-speak →', stop && stop.ok)
  const events = received.filter((m) => m.event).map((m) => m.event)
  console.log('事件流:', events.join(','))
  proc.kill('SIGTERM')
  setTimeout(() => process.exit(0), 300)
}, 8000)
