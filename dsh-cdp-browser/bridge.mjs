#!/usr/bin/env node
/**
 * dsh-cdp-browser bridge: drives one dedicated Chrome instance over the
 * Chrome DevTools Protocol (CDP) using only Node built-ins (global WebSocket,
 * available since Node 22). No Chrome extension is involved.
 *
 * Login-state reuse: the controlled Chrome runs on a COPY of the user's real
 * Chrome profile (cookies / local storage / login data), so logged-in
 * sessions carry over while the real browser is never touched. On macOS the
 * cookie encryption key lives in the user's own Keychain; on Windows the
 * DPAPI key is per-user, so a copy under the same user decrypts normally.
 *
 * Cross-platform: Chrome binary and real-profile paths are resolved per
 * platform (win32/darwin/linux), overridable via DSH_CDP_CHROME /
 * DSH_CDP_CHROME_SRC or the --chrome / --chrome-src CLI args.
 *
 * Wire protocol — JSON lines on stdin (requests) / stdout (responses):
 *   -> {"id":1,"cmd":"open","args":{...}}
 *   <- {"id":1,"ok":true,"result":{...}}
 *   <- {"id":1,"ok":false,"error":"..."}
 *
 * CLI options:
 *   --profile-dir <path>   where the controlled Chrome profile copy lives
 *                          (default ~/.dsh/dsh-cdp-profiles/default)
 *   --chrome-src <path>    source of the user's real Chrome profile
 *                          (default: per-platform, see platform-paths.mjs)
 *   --chrome <path>        Chrome executable
 *                          (default: per-platform, see platform-paths.mjs)
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { defaultChromeSrc, resolveChromeBinary } from './platform-paths.mjs'

const HOME = os.homedir()
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const PROFILE_DIR = arg('--profile-dir', path.join(HOME, '.dsh', 'dsh-cdp-profiles', 'default'))
const CHROME_SRC = arg('--chrome-src', defaultChromeSrc())
const CHROME_BIN = arg('--chrome', resolveChromeBinary())

let WSImpl = globalThis.WebSocket
if (!WSImpl) {
  try {
    const mod = await import('ws')
    WSImpl = mod.default
  } catch {
    console.error('no WebSocket implementation available (need Node >= 22 or a resolvable ws package)')
    process.exit(1)
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- CDP client

const state = {
  ws: null,
  sessionId: null,
  targetId: null,
  chrome: null,
  chromeAlive: false,
  closing: false,
  profileDir: PROFILE_DIR,
}

let cdpId = 0
const cdpPending = new Map()
const eventWaiters = new Map()

function wireSocket(ws) {
  ws.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.id !== undefined) {
      const p = cdpPending.get(msg.id)
      if (!p) return
      cdpPending.delete(msg.id)
      if (msg.error) p.reject(new Error(String(msg.error.message || msg.error.code || 'CDP error')))
      else p.resolve(msg.result)
    } else if (msg.method) {
      const arr = eventWaiters.get(msg.method)
      if (arr && arr.length) arr.shift().resolve(msg.params)
    }
  })
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    let ws
    try {
      ws = new WSImpl(wsUrl)
    } catch (e) {
      reject(new Error('websocket connect failed: ' + e.message))
      return
    }
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      reject(new Error('CDP connect timeout'))
    }, 10000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('CDP websocket error'))
    })
  })
}

function send(method, params = {}, sessionId) {
  if (!state.ws) throw new Error('browser is not open; call browser_open first')
  const id = ++cdpId
  return new Promise((resolve, reject) => {
    cdpPending.set(id, { resolve, reject })
    state.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

async function evaluate(expression, opts = {}) {
  const res = await send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: !!opts.awaitPromise,
      ...(opts.userGesture ? { userGesture: true } : {}),
    },
    state.sessionId,
  )
  if (res.exceptionDetails) {
    const detail =
      res.exceptionDetails.exception?.description ||
      res.exceptionDetails.exception?.value ||
      res.exceptionDetails.text ||
      'evaluation error'
    throw new Error(String(detail).slice(0, 1000))
  }
  return res.result
}

async function waitForLoad(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await evaluate('document.readyState')
      if (r.value === 'complete') {
        await delay(250)
        return
      }
    } catch {
      // page may be mid-navigation; keep polling
    }
    await delay(200)
  }
}

// ----------------------------------------------------------- Chrome lifecycle

const PROFILE_EXCLUDE = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'Component Updates',
  'OptimizationGuidePredictionModels',
  'SafetyTips',
  'Subresource Filter',
  'Variations',
  'WidevineCdm',
  'FileTypePolicies',
  'Translate',
  'DownloadService',
  'Extensions',
  'Extension State',
  'ExtensionsCached',
  'Local Extension Settings',
  'Managed Extension Settings',
  'Extension Rules',
  'Extension Scripts',
])

function shouldSkip(p) {
  const base = path.basename(p)
  return PROFILE_EXCLUDE.has(base) || base.startsWith('Singleton') || base.endsWith('.lock')
}

function copyProfile(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue
    try {
      fs.cpSync(path.join(src, entry.name), path.join(dest, entry.name), {
        recursive: true,
        filter: (s) => !shouldSkip(s),
      })
    } catch (e) {
      // Chrome may be running and briefly removing files (e.g. RunningChromeVersion);
      // a lost entry only costs that piece of profile state.
      console.error('skipping profile entry (copy failed): ' + entry.name + ' — ' + e.message)
    }
  }
}

function ensureProfileDir(mode) {
  const dir = PROFILE_DIR
  const hasProfile = fs.existsSync(path.join(dir, 'Default'))
  if (mode === 'clean') {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    return
  }
  if (mode === 'reuse' && hasProfile) return
  if (mode === 'fresh' || !hasProfile) {
    if (!fs.existsSync(path.join(CHROME_SRC, 'Default'))) {
      console.error('real Chrome profile not found at ' + CHROME_SRC + '; starting with a clean profile')
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })
      return
    }
    copyProfile(CHROME_SRC, dir)
  }
}

function killChromeUsingProfile() {
  // An orphaned Chrome (from a dead helper) may still hold the profile lock;
  // only processes launched with this exact user-data-dir are affected.
  // pkill is unix-only; on Windows the OS clears the lock when the process
  // exits, so nothing to do there.
  if (process.platform === 'win32') return
  try {
    spawnSync('pkill', ['-f', '--', `--user-data-dir=${PROFILE_DIR}`], { stdio: 'ignore' })
  } catch {
    // best effort
  }
}

function launchChrome(args) {
  if (!fs.existsSync(CHROME_BIN)) throw new Error('Chrome executable not found at ' + CHROME_BIN)
  const flags = [
    `--user-data-dir=${PROFILE_DIR}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-features=Translate,MediaRouter',
  ]
  if (args.headless) flags.push('--headless=new')
  const child = spawn(CHROME_BIN, flags, { stdio: ['ignore', 'ignore', 'pipe'] })
  state.chrome = child
  state.chromeAlive = true
  let stderrBuf = ''
  child.stderr.on('data', (d) => {
    stderrBuf = (stderrBuf + d.toString()).slice(-16000)
  })
  child.on('exit', (code, sig) => {
    state.chromeAlive = false
    if (!state.closing) {
      console.error('Chrome exited unexpectedly code=' + code + ' signal=' + sig)
      failAll('Chrome exited unexpectedly')
      process.exit(1)
    }
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Chrome did not publish a DevTools URL. stderr tail: ' + stderrBuf.slice(-600)))
    }, 20000)
    child.stderr.on('data', (d) => {
      stderrBuf = (stderrBuf + d.toString()).slice(-16000)
      const m = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
  })
}

// ---------------------------------------------------------------- commands

async function cookieSummary() {
  const { cookies } = await send('Network.getAllCookies', {}, state.sessionId)
  const byDomain = {}
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, '')
    byDomain[d] = (byDomain[d] || 0) + 1
  }
  const list = Object.entries(byDomain)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
  return { total: cookies.length, byDomain: list }
}

async function status() {
  let page = { url: '', title: '' }
  if (state.ws && state.sessionId) {
    try {
      const r = await evaluate('({ url: location.href, title: document.title })')
      page = r.value || page
    } catch {}
  }
  return {
    running: !!(state.ws && state.chromeAlive),
    chromeAlive: state.chromeAlive,
    url: page.url,
    title: page.title,
    profileDir: PROFILE_DIR,
  }
}

async function cmdOpen(args) {
  if (state.ws && state.chromeAlive) return status()
  if (fs.existsSync(path.join(PROFILE_DIR, 'SingletonLock'))) killChromeUsingProfile()
  const mode = args.profile || 'reuse'
  ensureProfileDir(mode)
  const wsUrl = await launchChrome(args)
  const ws = await connect(wsUrl)
  state.ws = ws
  wireSocket(ws)
  const { targetId } = await send('Target.createTarget', { url: args.url || 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  state.targetId = targetId
  state.sessionId = sessionId
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  if (args.url) await waitForLoad()
  const result = await status()
  try {
    result.cookies = await cookieSummary()
  } catch {
    result.cookies = null
  }
  result.profileMode = mode
  return result
}

const SNAPSHOT_JS = `
(() => {
  const MAX_ITEMS = 200;
  const SENSITIVE = /password|passwd|pwd|secret|token|card|ccv|cvv|credit|pin/i;
  const seen = new Set();
  const items = [];
  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) return 'editable';
    if (tag === 'a') return 'link';
    if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'password') return 'password';
      if (t === 'submit' || t === 'button' || t === 'image') return 'button';
      return 'input';
    }
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'summary') return 'summary';
    return null;
  };
  const clean = (s, max) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().slice(0, max);
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return clean(aria, 120);
    if (el.labels && el.labels[0]) {
      const t = el.labels[0].innerText;
      if (t && t.trim()) return clean(t, 120);
    }
    for (const attr of ['placeholder', 'name', 'title', 'alt']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) return clean(v, 120);
    }
    if (el.id) return '#' + el.id;
    return '';
  };
  const valueOf = (el, kind) => {
    if (kind === 'password') return '••••';
    const v = el.value;
    if (typeof v === 'string' && SENSITIVE.test(labelOf(el))) return '••••';
    return typeof v === 'string' ? clean(v, 200) : '';
  };
  const root = document.body || document.documentElement;
  const els = root.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], summary');
  for (const el of els) {
    if (items.length >= MAX_ITEMS) break;
    const kind = kindOf(el);
    if (!kind) continue;
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) continue;
    const idx = items.length;
    el.setAttribute('data-dsh-idx', String(idx));
    const item = { idx, kind, tag: el.tagName.toLowerCase(), label: labelOf(el) };
    if (el.href) item.href = el.href.slice(0, 300);
    if (kind === 'checkbox' || kind === 'radio') item.checked = !!el.checked;
    if (kind === 'input' || kind === 'textarea' || kind === 'editable' || kind === 'select') item.value = valueOf(el, kind);
    items.push(item);
  }
  const text = clean(document.body ? document.body.innerText : '', 60000);
  return { url: location.href, title: document.title, text, items };
})()
`

async function cmdSnapshot(args) {
  const r = await evaluate(SNAPSHOT_JS)
  const value = r.value || { url: '', title: '', text: '', items: [] }
  const maxChars = Math.max(500, Number(args.maxChars) || 12000)
  if (typeof value.text === 'string' && value.text.length > maxChars) {
    value.text = value.text.slice(0, maxChars) + '\n…[truncated]'
  }
  return value
}

async function cmdNavigate(args) {
  await send('Page.navigate', { url: args.url }, state.sessionId)
  await waitForLoad(45000)
  return status()
}

async function cmdClick(args) {
  const r = await evaluate(
    `(() => { const el = document.querySelector('[data-dsh-idx="${Number(args.index)}"]'); if (!el) return { ok: false }; el.scrollIntoView({ block: 'center', inline: 'center' }); const rect = el.getBoundingClientRect(); return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()`,
  )
  if (!r.value || !r.value.ok) throw new Error('element index not found on the current page; run browser_snapshot first')
  const { x, y } = r.value
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, state.sessionId)
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
    state.sessionId,
  )
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
    state.sessionId,
  )
  await delay(250)
  return { clicked: true, index: args.index }
}

async function cmdType(args) {
  const text = String(args.text ?? '')
  const replace = !!args.replace
  const r = await evaluate(
    `(() => {
      const el = document.querySelector('[data-dsh-idx="${Number(args.index)}"]');
      if (!el) return { ok: false, err: 'element index not found' };
      el.focus();
      const tag = el.tagName.toLowerCase();
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : tag === 'input' ? HTMLInputElement.prototype : null;
      if (proto) {
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (${replace}) { setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); }
        setter.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        if (${replace}) el.textContent = '';
        el.textContent = ${JSON.stringify(text)};
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(text)} }));
      } else {
        return { ok: false, err: 'element is not an input field' };
      }
      return { ok: true, value: el.value };
    })()`,
  )
  if (!r.value || !r.value.ok) throw new Error(r.value && r.value.err ? r.value.err : 'type failed')
  await delay(120)
  if (r.value.value !== text) {
    // React-style controlled inputs may have re-rendered; retry with trusted input events.
    await evaluate(
      `(() => { const el = document.querySelector('[data-dsh-idx="${Number(args.index)}"]'); if (el) el.focus(); return true; })()`,
    )
    await send('Input.insertText', { text }, state.sessionId)
    await delay(120)
  }
  const v = await evaluate(
    `(() => { const el = document.querySelector('[data-dsh-idx="${Number(args.index)}"]'); return el ? el.value : null; })()`,
  )
  return { typed: true, index: args.index, value: typeof v.value === 'string' ? v.value : null }
}

const KEYMAP = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
}

async function cmdPress(args) {
  const k = KEYMAP[args.key]
  if (!k) throw new Error('unsupported key "' + args.key + '"; supported: ' + Object.keys(KEYMAP).join(', '))
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, ...(k.text !== undefined ? { text: k.text } : {}) },
    state.sessionId,
  )
  if (k.text && k.text !== '\r') {
    await send(
      'Input.dispatchKeyEvent',
      { type: 'char', key: k.key, code: k.code, text: k.text, unmodifiedText: k.text, windowsVirtualKeyCode: k.keyCode },
      state.sessionId,
    )
  }
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode },
    state.sessionId,
  )
  await delay(150)
  return { pressed: args.key }
}

async function cmdScroll(args) {
  const dir = args.direction || 'down'
  const amount = Math.max(50, Number(args.amount) || 400)
  let js
  if (dir === 'top') js = 'window.scrollTo({ top: 0, behavior: "instant" })'
  else if (dir === 'bottom') js = 'window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })'
  else if (dir === 'up') js = 'window.scrollBy({ top: -' + amount + ', behavior: "instant" })'
  else js = 'window.scrollBy({ top: ' + amount + ', behavior: "instant" })'
  await evaluate(js)
  await delay(150)
  const pos = await evaluate('({ top: window.scrollY, max: Math.max(document.body.scrollHeight - window.innerHeight, 0) })')
  return { direction: dir, scrollY: pos.value.top, maxScrollY: pos.value.max }
}

async function cmdBack() {
  await send('Page.goBack', {}, state.sessionId)
  await waitForLoad()
  return status()
}

async function cmdForward() {
  await send('Page.goForward', {}, state.sessionId)
  await waitForLoad()
  return status()
}

async function cmdReload() {
  await send('Page.reload', { ignoreCache: false }, state.sessionId)
  await waitForLoad()
  return status()
}

async function cmdGetText(args) {
  const r = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return { ok: false }; return { ok: true, text: String(el.innerText || el.value || el.textContent || '').slice(0, 20000) }; })()`,
  )
  if (!r.value || !r.value.ok) throw new Error('selector not found: ' + args.selector)
  return { selector: args.selector, text: r.value.text }
}

function sanitize(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
  if (typeof v === 'string') return v.length > 8000 ? v.slice(0, 8000) + '…[truncated]' : v
  if (depth > 5) return '[deep]'
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => sanitize(x, depth + 1))
  if (typeof v === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(v).slice(0, 200)) out[key] = sanitize(val, depth + 1)
    return out
  }
  return String(v)
}

async function cmdEval(args) {
  const r = await evaluate(String(args.expression), { awaitPromise: true, userGesture: true })
  if (r.value === undefined || (r.type === 'undefined')) return { value: null }
  return { value: sanitize(r.value) }
}

async function cmdScreenshot(args) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, state.sessionId)
  const buf = Buffer.from(data, 'base64')
  const target = path.resolve(args.path || 'browser-screenshot.png')
  fs.writeFileSync(target, buf)
  return { path: target, bytes: buf.length }
}

async function cmdCookies(args) {
  const { cookies } = await send('Network.getAllCookies', {}, state.sessionId)
  let list = cookies
  if (args.domain) list = cookies.filter((c) => c.domain.includes(String(args.domain).replace(/^\./, '')))
  const mapped = list
    .map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      size: c.size,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
  return { count: mapped.length, cookies: mapped.slice(0, 500) }
}

async function cmdClose() {
  const wasOpen = !!(state.ws || state.chromeAlive)
  state.closing = true
  if (state.ws) {
    try {
      await send('Browser.close')
    } catch {}
  }
  const deadline = Date.now() + 4000
  while (Date.now() < deadline && state.chromeAlive) await delay(100)
  if (state.chromeAlive && state.chrome) {
    try {
      state.chrome.kill('SIGKILL')
    } catch {}
  }
  try {
    if (state.ws) state.ws.close()
  } catch {}
  state.ws = null
  state.sessionId = null
  state.targetId = null
  return { closed: wasOpen }
}

const HANDLERS = {
  open: cmdOpen,
  status: status,
  snapshot: cmdSnapshot,
  navigate: cmdNavigate,
  click: cmdClick,
  type: cmdType,
  press: cmdPress,
  scroll: cmdScroll,
  back: cmdBack,
  forward: cmdForward,
  reload: cmdReload,
  get_text: cmdGetText,
  eval: cmdEval,
  screenshot: cmdScreenshot,
  cookies: cmdCookies,
  close: cmdClose,
}

function failAll(message) {
  for (const [, p] of cdpPending) p.reject(new Error(message))
  cdpPending.clear()
}

function respond(id, msg) {
  process.stdout.write(JSON.stringify({ id, ...msg }) + '\n')
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  try {
    const fn = HANDLERS[req.cmd]
    if (!fn) throw new Error('unknown command: ' + req.cmd)
    const result = await fn(req.args || {})
    respond(req.id, { ok: true, result })
  } catch (e) {
    respond(req.id, { ok: false, error: String((e && e.message) || e) })
  }
  if (req.cmd === 'close') {
    // The bridge has no purpose once the controlled Chrome is closed; exiting
    // lets the plugin respawn it (fresh code) on the next browser_open.
    setTimeout(() => process.exit(0), 50)
  }
})

process.on('SIGTERM', () => {
  state.closing = true
  try {
    if (state.chrome) state.chrome.kill('SIGKILL')
  } catch {}
  process.exit(0)
})

console.error('dsh-cdp-browser bridge ready (profile: ' + PROFILE_DIR + ')')
