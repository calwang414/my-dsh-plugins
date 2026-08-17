/**
 * platform-paths 跨平台路径解析单测:模拟 win32/darwin/linux 三个平台,
 * 校验 Chrome/Edge 可执行文件与真实配置目录的候选与解析逻辑。
 * 期望路径统一用 path.join 构造,保证在任意平台运行结果一致。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  defaultChromeSrc,
  chromeBinaryCandidates,
  resolveChromeBinary,
  defaultEdgeSrc,
  edgeBinaryCandidates,
  resolveEdgeBinary,
  selectedBrowser,
} from './platform-paths.mjs'

const HOME = '/Users/tester'
const w = (...seg) => path.join(...seg)
const fakeEnv = (extra = {}) => ({
  LOCALAPPDATA: w('C:\\', 'Users', 'tester', 'AppData', 'Local'),
  PROGRAMFILES: w('C:\\', 'Program Files'),
  'PROGRAMFILES(X86)': w('C:\\', 'Program Files (x86)'),
  ...extra,
})

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

// ---- 浏览器选择 ----
check('DSH_CDP_BROWSER=edge 时选择 Edge,默认 chrome', () => {
  assert.equal(selectedBrowser({ env: fakeEnv({ DSH_CDP_BROWSER: 'edge' }) }), 'edge')
  assert.equal(selectedBrowser({ env: fakeEnv({ DSH_CDP_BROWSER: 'Edge' }) }), 'edge')
  assert.equal(selectedBrowser({ env: fakeEnv() }), 'chrome')
  assert.equal(selectedBrowser({ env: fakeEnv({ DSH_CDP_BROWSER: 'xxx' }) }), 'chrome')
})

// ---- Chrome ----
check('win32 默认配置目录 = %LOCALAPPDATA%\\Google\\Chrome\\User Data', () => {
  assert.equal(
    defaultChromeSrc({ platform: 'win32', home: HOME, env: fakeEnv() }),
    w('C:\\', 'Users', 'tester', 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
  )
})
check('win32 Chrome 候选顺序(Program Files → x86 → LOCALAPPDATA)', () => {
  const list = chromeBinaryCandidates({ platform: 'win32', home: HOME, env: fakeEnv() })
  assert.deepEqual(list, [
    w('C:\\', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    w('C:\\', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    w('C:\\', 'Users', 'tester', 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ])
})
check('win32 无 LOCALAPPDATA 时回退 home\\AppData\\Local', () => {
  const env = fakeEnv()
  delete env.LOCALAPPDATA
  const src = defaultChromeSrc({ platform: 'win32', home: HOME, env })
  assert.equal(src, w(HOME, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'))
})
check('darwin 默认配置目录 = ~/Library/Application Support/Google/Chrome', () => {
  assert.equal(
    defaultChromeSrc({ platform: 'darwin', home: HOME, env: fakeEnv() }),
    w(HOME, 'Library', 'Application Support', 'Google', 'Chrome'),
  )
})
check('darwin Chrome 候选保持原路径', () => {
  const list = chromeBinaryCandidates({ platform: 'darwin', home: HOME, env: fakeEnv() })
  assert.deepEqual(list, ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])
})
check('linux 默认配置目录 = ~/.config/google-chrome', () => {
  assert.equal(defaultChromeSrc({ platform: 'linux', home: HOME, env: fakeEnv() }), w(HOME, '.config', 'google-chrome'))
})
check('linux Chrome 候选(google-chrome → chromium)', () => {
  const list = chromeBinaryCandidates({ platform: 'linux', home: HOME, env: fakeEnv() })
  assert.deepEqual(list, ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'])
})
check('DSH_CDP_CHROME 优先于平台候选', () => {
  const list = chromeBinaryCandidates({ platform: 'win32', home: HOME, env: fakeEnv({ DSH_CDP_CHROME: 'D:\\chrome\\chrome.exe' }) })
  assert.equal(list[0], 'D:\\chrome\\chrome.exe')
})
check('DSH_CDP_CHROME_SRC 优先于平台默认', () => {
  const src = defaultChromeSrc({ platform: 'darwin', home: HOME, env: fakeEnv({ DSH_CDP_CHROME_SRC: '/opt/chrome-data' }) })
  assert.equal(src, '/opt/chrome-data')
})

// ---- Edge ----
check('win32 Edge 配置目录 = %LOCALAPPDATA%\\Microsoft\\Edge\\User Data', () => {
  assert.equal(
    defaultEdgeSrc({ platform: 'win32', home: HOME, env: fakeEnv() }),
    w('C:\\', 'Users', 'tester', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
  )
})
check('win32 Edge 候选顺序(x86 → Program Files → LOCALAPPDATA)', () => {
  const list = edgeBinaryCandidates({ platform: 'win32', home: HOME, env: fakeEnv() })
  assert.deepEqual(list, [
    w('C:\\', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    w('C:\\', 'Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    w('C:\\', 'Users', 'tester', 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
})
check('darwin Edge 配置目录与可执行文件', () => {
  assert.equal(
    defaultEdgeSrc({ platform: 'darwin', home: HOME, env: fakeEnv() }),
    w(HOME, 'Library', 'Application Support', 'Microsoft Edge'),
  )
  assert.deepEqual(edgeBinaryCandidates({ platform: 'darwin', home: HOME, env: fakeEnv() }), [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ])
})
check('linux Edge 配置目录与候选', () => {
  assert.equal(defaultEdgeSrc({ platform: 'linux', home: HOME, env: fakeEnv() }), w(HOME, '.config', 'microsoft-edge'))
  assert.deepEqual(edgeBinaryCandidates({ platform: 'linux', home: HOME, env: fakeEnv() }), [
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge-beta',
  ])
})
check('DSH_CDP_EDGE 优先于平台候选', () => {
  const list = edgeBinaryCandidates({ platform: 'darwin', home: HOME, env: fakeEnv({ DSH_CDP_EDGE: '/opt/edge/msedge' }) })
  assert.equal(list[0], '/opt/edge/msedge')
})
check('DSH_CDP_EDGE_SRC 优先于平台默认', () => {
  const src = defaultEdgeSrc({ platform: 'win32', home: HOME, env: fakeEnv({ DSH_CDP_EDGE_SRC: 'D:\\edge-data' }) })
  assert.equal(src, 'D:\\edge-data')
})

// ---- resolve ----
check('resolveChromeBinary 返回首个存在项(本机 darwin)', () => {
  const bin = resolveChromeBinary({ platform: 'darwin', home: HOME, env: fakeEnv() })
  assert.ok(typeof bin === 'string' && bin.length > 0)
})
check('resolveChromeBinary 全不存在时返回首个候选', () => {
  const bin = resolveChromeBinary({ platform: 'win32', home: HOME, env: fakeEnv() })
  assert.equal(bin, w('C:\\', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'))
})
check('resolveEdgeBinary 全不存在时返回首个候选', () => {
  const bin = resolveEdgeBinary({ platform: 'win32', home: HOME, env: fakeEnv() })
  assert.equal(bin, w('C:\\', 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
})

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
