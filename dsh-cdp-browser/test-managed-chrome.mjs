/**
 * managed-chrome 单测:固定版本 URL、平台映射、受管二进制路径。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { PINNED_VERSION, chromeForTestingPlatform, managedChromeUrl, managedChromeBinary, managedChromeRoot } from './managed-chrome.mjs'

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log('✓ ' + name)
  } catch (e) {
    failures++
    console.log('✗ FAIL ' + name + ' — ' + e.message)
  }
}

check('固定版本常量存在且为 CfT 稳定版格式', () => {
  assert.match(PINNED_VERSION, /^\d+\.\d+\.\d+\.\d+$/)
})

check('平台映射:darwin-arm64 → mac-arm64', () => {
  assert.equal(chromeForTestingPlatform({ platform: 'darwin', arch: 'arm64' }), 'mac-arm64')
})
check('平台映射:darwin-x64 → mac-x64', () => {
  assert.equal(chromeForTestingPlatform({ platform: 'darwin', arch: 'x64' }), 'mac-x64')
})
check('平台映射:win32-x64 → win64', () => {
  assert.equal(chromeForTestingPlatform({ platform: 'win32', arch: 'x64' }), 'win64')
})
check('平台映射:win32-ia32 → win32', () => {
  assert.equal(chromeForTestingPlatform({ platform: 'win32', arch: 'ia32' }), 'win32')
})
check('平台映射:linux64', () => {
  assert.equal(chromeForTestingPlatform({ platform: 'linux', arch: 'x64' }), 'linux64')
})

check('固定版本下载 URL 构造', () => {
  assert.equal(
    managedChromeUrl('152.0.7977.42', { platform: 'darwin', arch: 'arm64' }),
    'https://storage.googleapis.com/chrome-for-testing-public/152.0.7977.42/mac-arm64/chrome-mac-arm64.zip',
  )
})

check('受管根目录默认 ~/.dsh/dsh-cdp-profiles/chrome', () => {
  assert.equal(managedChromeRoot({ home: '/Users/t', env: {} }), path.join('/Users/t', '.dsh', 'dsh-cdp-profiles', 'chrome'))
})
check('DSH_CDP_CHROME_DIR 覆盖根目录', () => {
  assert.equal(managedChromeRoot({ home: '/Users/t', env: { DSH_CDP_CHROME_DIR: '/opt/chrome-m' } }), '/opt/chrome-m')
})

check('macOS 受管二进制路径(Google Chrome for Testing.app)', () => {
  const bin = managedChromeBinary('1.2.3.4', { platform: 'darwin', arch: 'arm64', home: '/Users/t', env: {} })
  assert.equal(bin, path.join('/Users/t', '.dsh', 'dsh-cdp-profiles', 'chrome', '1.2.3.4', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'))
})

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
