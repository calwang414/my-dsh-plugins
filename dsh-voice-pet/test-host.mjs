/**
 * Host 半集成测试(临时 CACHE_DIR,不触碰真实配置):
 * mock ctx(tools/webServer) → apply → 真实 HTTP 服务 → 验证全部路由。
 * 覆盖:config 读写、形象上传/列表/切换/删除、/voice-pet/vrm 动态解析、
 * petMode 门控。
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-voice-pet-test-'))
process.env.DSH_VOICE_PET_CACHE_DIR = TMP

const { apply } = await import('./lib/index.js')

// ---- mock ctx ----
const routes = []
const disposers = []
const ctx = {
  tools: {
    register(tool) {
      disposers.push(() => {})
      return () => {}
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      const d = () => {}
      disposers.push(d)
      return d
    },
    registerUpgrade() {
      const d = () => {}
      disposers.push(d)
      return d
    },
  },
  effect(fn) {
    const d = fn()
    disposers.push(d)
  },
}

apply(ctx)

// ---- 真实 HTTP 服务 ----
const server = http.createServer((req, res) => {
  const url = req.url ?? ''
  const route = routes.find((r) => {
    if (r.kind === 'exact') return r.path === url.split('?')[0]
    if (r.kind === 'prefix') return url.startsWith(r.path)
    return false
  })
  if (!route) {
    res.writeHead(404).end('no route')
    return
  }
  route.handler(req, res)
})

const PORT = 39000 + Math.floor(Math.random() * 1000)
await new Promise((resolve) => server.listen(PORT, resolve))
const base = `http://127.0.0.1:${PORT}`

const getJson = async (p) => {
  const res = await fetch(base + p)
  return res.json()
}
const postJson = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}
const getBuffer = async (p) => {
  const res = await fetch(base + p)
  return Buffer.from(await res.arrayBuffer())
}

let failures = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? '✓' : '✗ FAIL') + ' ' + name + (cond ? '' : ' — ' + extra))
  if (!cond) failures++
}

try {
  // 1. 配置读写 + 规范化
  const cfg = await getJson('/voice-pet/config')
  check('config 默认值含 avatarId/petMode', cfg.avatarId === '' && cfg.petMode !== undefined)
  const patched = await postJson('/voice-pet/config', { petMode: 'page', petSize: 1.5, avatarId: '../evil' })
  check('avatarId 路径注入被规范化', patched.data.config.avatarId === '')

  // 2. 非法上传
  const bad = await postJson('/voice-pet/vrm-upload', { base64: Buffer.from('not a vrm').toString('base64'), filename: 'x.vrm' })
  check('非法文件被拒', bad.status === 400 && !bad.data.ok)

  // 3. 上传合法 VRM(用内置 cal-vrm.vrm 做样本)
  const sample = fs.readFileSync(path.join(__dirname, 'assets', 'cal-vrm.vrm'))
  const up = await postJson('/voice-pet/vrm-upload', {
    base64: sample.toString('base64'),
    filename: '我的形象.vrm',
  })
  check('上传成功', up.data.ok === true && /^\d+$/.test(up.data.avatarId))
  const avatarId = up.data.avatarId

  // 4. /voice-pet/vrm 现在应返回上传的形象(逐字节)
  const served = await getBuffer('/voice-pet/vrm')
  check('vrm 路由返回上传形象(逐字节)', served.equals(sample))

  // 5. 形象列表
  const list = await getJson('/voice-pet/avatars')
  check('形象列表含默认+自定义', list.ok && list.avatars.length === 2 && list.avatars[0].id === 'default')
  check('自定义形象名称正确', list.avatars[1].name === '我的形象')

  // 6. 切回默认
  const back = await postJson('/voice-pet/avatar', { id: 'default' })
  check('切回默认形象', back.data.ok === true)
  const servedDefault = await getBuffer('/voice-pet/vrm')
  check('vrm 路由回到默认形象', servedDefault.equals(fs.readFileSync(path.join(__dirname, 'assets', 'cal-vrm.vrm'))))

  // 7. 删除形象
  const del = await postJson('/voice-pet/avatar-delete', { id: avatarId })
  check('删除形象', del.data.ok === true)
  const list2 = await getJson('/voice-pet/avatars')
  check('删除后只剩默认', list2.avatars.length === 1)

  // 8. petMode 门控
  await postJson('/voice-pet/config', { petMode: 'page' })
  const page404 = await fetch(base + '/voice-pet/pet')
  check('page 模式 pet 页 404', page404.status === 404)
  await postJson('/voice-pet/config', { petMode: 'standalone' })
  const page200 = await fetch(base + '/voice-pet/pet')
  check('standalone 模式 pet 页 200', page200.status === 200)
  const b404 = await fetch(base + '/voice-pet/pet-standalone.js')
  check('standalone bundle 200(文件存在)', b404.status === 200)
} catch (e) {
  console.error('测试异常:', e)
  failures++
} finally {
  server.close()
  for (const d of disposers.reverse()) {
    try {
      d()
    } catch {}
  }
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
