/**
 * 跨平台 Chromium 浏览器路径解析(纯函数,便于单测)。
 *
 * 支持 Chrome 与 Edge(均为 Chromium 内核,CDP 协议一致):
 *  - DSH_CDP_BROWSER = 'chrome' | 'edge' 选择浏览器(默认 chrome);
 *  - DSH_CDP_CHROME / DSH_CDP_EDGE 环境变量显式指定各自可执行文件;
 *  - DSH_CDP_CHROME_SRC / DSH_CDP_EDGE_SRC 显式指定各自真实配置目录;
 *  - 未指定时按平台默认路径探测(win32/darwin/linux)。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PLATFORMS = { chrome: {}, edge: {} }

/** 浏览器选择:DSH_CDP_BROWSER 显式指定,默认 chrome */
export function selectedBrowser({ env = process.env } = {}) {
  const b = String(env.DSH_CDP_BROWSER || 'chrome').toLowerCase()
  return b === 'edge' ? 'edge' : 'chrome'
}

function localDir(home, env) {
  return env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
}
function pfDir(env, key, fallback) {
  return env[key] || fallback
}

/** 真实配置目录(登录态来源);返回第一个候选,不存在时返回平台默认首个 */
export function defaultProfileSrc(kind, { platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const envKey = kind === 'edge' ? 'DSH_CDP_EDGE_SRC' : 'DSH_CDP_CHROME_SRC'
  if (env[envKey]) return env[envKey]
  if (platform === 'win32') {
    const local = localDir(home, env)
    return kind === 'edge'
      ? path.join(local, 'Microsoft', 'Edge', 'User Data')
      : path.join(local, 'Google', 'Chrome', 'User Data')
  }
  if (platform === 'linux') {
    return kind === 'edge' ? path.join(home, '.config', 'microsoft-edge') : path.join(home, '.config', 'google-chrome')
  }
  return kind === 'edge'
    ? path.join(home, 'Library', 'Application Support', 'Microsoft Edge')
    : path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
}

/** 可执行文件候选列表(按平台);env.DSH_CDP_CHROME / DSH_CDP_EDGE 优先 */
export function browserBinaryCandidates(kind, { platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const list = []
  if (kind === 'edge') {
    if (env.DSH_CDP_EDGE) list.push(env.DSH_CDP_EDGE)
  } else if (env.DSH_CDP_CHROME) {
    list.push(env.DSH_CDP_CHROME)
  }
  if (platform === 'win32') {
    const pf = pfDir(env, 'PROGRAMFILES', 'C:\\Program Files')
    const pf86 = pfDir(env, 'PROGRAMFILES(X86)', 'C:\\Program Files (x86)')
    const local = localDir(home, env)
    if (kind === 'edge') {
      // Edge 默认装到 x86 目录;用户级安装在 LOCALAPPDATA
      list.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      list.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      list.push(path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    } else {
      list.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      list.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      list.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
  } else if (platform === 'linux') {
    if (kind === 'edge') {
      list.push('/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge-beta')
    } else {
      list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser')
    }
  } else if (kind === 'edge') {
    list.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  } else {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  }
  return list
}

/** 首个存在的候选;全部不存在时返回第一个(让调用方报出可读路径) */
export function resolveBrowserBinary(kind, opts) {
  const candidates = browserBinaryCandidates(kind, opts)
  return candidates.find((p) => fs.existsSync(p)) || candidates[0]
}

// 兼容导出(Chrome 便捷函数,旧调用方与单测使用)
export const chromeBinaryCandidates = (opts) => browserBinaryCandidates('chrome', opts)
export const resolveChromeBinary = (opts) => resolveBrowserBinary('chrome', opts)
export const defaultChromeSrc = (opts) => defaultProfileSrc('chrome', opts)
export const edgeBinaryCandidates = (opts) => browserBinaryCandidates('edge', opts)
export const resolveEdgeBinary = (opts) => resolveBrowserBinary('edge', opts)
export const defaultEdgeSrc = (opts) => defaultProfileSrc('edge', opts)
