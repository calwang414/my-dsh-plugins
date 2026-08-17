/**
 * 跨平台 Chrome 路径解析(纯函数,便于单测)。
 *
 * 约定:
 *  - DSH_CDP_CHROME 环境变量显式指定 Chrome 可执行文件;
 *  - DSH_CDP_CHROME_SRC 环境变量显式指定真实 Chrome 配置目录;
 *  - 未指定时按平台默认路径探测(win32/darwin/linux)。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 真实 Chrome 配置目录(登录态来源);返回第一个候选,不存在时返回平台默认首个 */
export function defaultChromeSrc({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (env.DSH_CDP_CHROME_SRC) return env.DSH_CDP_CHROME_SRC
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return path.join(local, 'Google', 'Chrome', 'User Data')
  }
  if (platform === 'linux') return path.join(home, '.config', 'google-chrome')
  return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
}

/** Chrome 可执行文件候选列表(按平台);env.DSH_CDP_CHROME 优先 */
export function chromeBinaryCandidates({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const list = []
  if (env.DSH_CDP_CHROME) list.push(env.DSH_CDP_CHROME)
  if (platform === 'win32') {
    const pf = env.PROGRAMFILES || 'C:\\Program Files'
    const pf86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    list.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    list.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    list.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  } else if (platform === 'linux') {
    list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser')
  } else {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  }
  return list
}

/** 首个存在的候选;全部不存在时返回第一个(让调用方报出可读路径) */
export function resolveChromeBinary(opts) {
  const candidates = chromeBinaryCandidates(opts)
  return candidates.find((p) => fs.existsSync(p)) || candidates[0]
}
