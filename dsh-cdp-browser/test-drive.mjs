#!/usr/bin/env node
// Smoke-test driver for bridge.mjs: exercises the JSON-lines RPC end to end.
import { spawn } from 'node:child_process'
import readline from 'node:readline'

const BRIDGE = new URL('./bridge.mjs', import.meta.url).pathname
const PROFILE_DIR = process.argv[2] || '/tmp/dsh-cdp-test-profile'
const HEADLESS = process.argv[3] !== 'headed'

const child = spawn(process.execPath, [BRIDGE, '--profile-dir', PROFILE_DIR], { stdio: ['pipe', 'pipe', 'inherit'] })
const rl = readline.createInterface({ input: child.stdout })
const pending = new Map()
let nextId = 1
rl.on('line', (line) => {
  const msg = JSON.parse(line)
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  if (msg.ok) p.resolve(msg.result)
  else p.reject(new Error(msg.error))
})

function call(cmd, args = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
  })
}

const timeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + what)), ms))])

const steps = [
  ['open', () => call('open', { headless: HEADLESS, profile: 'clean' })],
  ['navigate', () => call('navigate', { url: 'https://example.com' })],
  ['snapshot', () => call('snapshot', { maxChars: 2000 })],
  ['eval', () => call('eval', { expression: 'document.title + " | h1: " + (document.querySelector("h1")?.innerText || "")' })],
  ['scroll', () => call('scroll', { direction: 'bottom' })],
  ['cookies', () => call('cookies')],
  ['screenshot', () => call('screenshot', { path: '/tmp/dsh-cdp-test-shot.png' })],
  ['close', () => call('close')],
]

let failed = false
for (const [name, fn] of steps) {
  try {
    const result = await timeout(fn(), 90000, name)
    let summary = JSON.stringify(result)
    if (summary.length > 600) summary = summary.slice(0, 600) + '…'
    console.log('PASS', name, '→', summary)
  } catch (e) {
    failed = true
    console.log('FAIL', name, '→', e.message)
    break
  }
}
child.kill()
process.exit(failed ? 1 : 0)
