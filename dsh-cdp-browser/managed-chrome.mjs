/**
 * 受管 Chrome(Chrome for Testing):系统未安装 Chrome/Edge 时,
 * 自动下载固定版本 CfT Chrome 到用户目录并解压,供 bridge 驱动。
 *
 * - 版本固定:PINNED_VERSION(可用 DSH_CDP_CHROME_VERSION 覆盖);
 *   CfT 保留所有历史版本,固定后可长期下载。
 * - 下载目录:默认 ~/.dsh/dsh-cdp-profiles/chrome/<version>/
 *   (可用 DSH_CDP_CHROME_DIR 覆盖)。
 * - 解压:macOS 用 ditto,Windows/Linux 用 tar(bsdtar,Windows 10+ 自带)。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

/** 固定版本(CfT Stable,2026-08-15);可用 DSH_CDP_CHROME_VERSION 覆盖 */
export const PINNED_VERSION = '152.0.7977.42'

/** 受管 Chrome 根目录 */
export function managedChromeRoot({ home = os.homedir(), env = process.env } = {}) {
  return env.DSH_CDP_CHROME_DIR || path.join(home, '.dsh', 'dsh-cdp-profiles', 'chrome')
}

/** Chrome for Testing 平台 key:win32/win64/mac-x64/mac-arm64/linux64 */
export function chromeForTestingPlatform({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'win32') return arch === 'x64' || arch === 'arm64' ? 'win64' : 'win32'
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  return 'linux64'
}

/** 固定版本下载 URL(storage.googleapis.com 官方分发) */
export function managedChromeUrl(version = PINNED_VERSION, opts) {
  const pf = chromeForTestingPlatform(opts)
  return `https://storage.googleapis.com/chrome-for-testing-public/${version}/${pf}/chrome-${pf}.zip`
}

/** 受管 Chrome 可执行文件路径(未下载时是期望路径) */
export function managedChromeBinary(version = PINNED_VERSION, opts) {
  const root = managedChromeRoot(opts)
  const pf = chromeForTestingPlatform(opts)
  const dir = path.join(root, version, `chrome-${pf}`)
  if (process.platform === 'win32') return path.join(dir, 'chrome.exe')
  if (process.platform === 'darwin') {
    return path.join(dir, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
  }
  return path.join(dir, 'chrome')
}

/** 解压 zip(平台自带工具;失败返回 false) */
function extractZip(zipPath, destDir) {
  if (process.platform === 'darwin') {
    const r = spawnSync('ditto', ['-x', '-k', zipPath, destDir], { stdio: 'pipe' })
    return r.status === 0
  }
  // win32 / linux:bsdtar(tar) 支持 zip,Windows 10 1803+ 自带
  const r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'pipe' })
  return r.status === 0
}

/** 确保受管 Chrome 就绪(已下载则直接返回;否则下载+解压),返回可执行文件路径 */
export async function ensureManagedChrome(version = PINNED_VERSION, opts) {
  const bin = managedChromeBinary(version, opts)
  if (fs.existsSync(bin)) return bin
  const root = managedChromeRoot(opts)
  const dir = path.join(root, version)
  const pf = chromeForTestingPlatform(opts)
  fs.mkdirSync(dir, { recursive: true })
  const url = managedChromeUrl(version, opts)
  const zipPath = path.join(root, `chrome-${version}-${pf}.zip`)
  if (!fs.existsSync(zipPath)) {
    console.error(`[managed-chrome] 下载 Chrome for Testing ${version} (${pf})…`)
    const res = await fetch(url)
    if (!res.ok || !res.body) {
      throw new Error(`Chrome for Testing 下载失败: HTTP ${res.status} — ${url}\n可设置 DSH_CDP_CHROME_VERSION 换版本,或手动安装 Chrome/Edge 后重试`)
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipPath))
  }
  console.error(`[managed-chrome] 解压 ${path.basename(zipPath)}…`)
  if (!extractZip(zipPath, dir)) {
    throw new Error('Chrome for Testing 解压失败(macOS 需要 ditto;Windows 10+ / Linux 需要 tar)')
  }
  try {
    fs.rmSync(zipPath, { force: true })
  } catch {}
  if (!fs.existsSync(bin)) {
    throw new Error(`受管 Chrome 解压后未找到可执行文件: ${bin}`)
  }
  return bin
}
