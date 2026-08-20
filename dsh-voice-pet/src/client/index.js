/**
 * dsh-voice-pet — Client 半插件入口。
 *  - shell.overlay:悬浮桌宠(React 挂载 mountPet)
 *  - settings.section:设置页「语音桌宠」(自建 /voice-pet/config 通道,settings 服务对第三方 namespace 有白名单限制)
 */
import React from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { IconLoadingOutline16, IconPauseOutline16, IconPlayOutline16, IconStopFill16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { mountPet } from './pet.js'

export const inject = ['slots']

// ---------- 设置页 ----------
// Edge TTS 中文音色(code 为配置存储值,name 用于界面展示)
const EDGE_VOICES = [
  { code: 'zh-CN-XiaoxiaoNeural', name: '晓晓(女声)' },
  { code: 'zh-CN-XiaoyiNeural', name: '晓伊(女声)' },
  { code: 'zh-CN-YunxiNeural', name: '云希(男声)' },
  { code: 'zh-CN-YunjianNeural', name: '云健(男声)' },
  { code: 'zh-CN-XiaochenNeural', name: '晓辰(女声·儿童)' },
  { code: 'zh-CN-XiaohanNeural', name: '晓涵(女声)' },
  { code: 'zh-CN-XiaomengNeural', name: '晓梦(女声·儿童)' },
  { code: 'zh-CN-XiaoshuangNeural', name: '晓双(女声·儿童)' },
]

// ---------- 设置页:四分区卡片(参考「侧边卡片」设置页风格:分组卡片 + 行式设置项) ----------

// 分区卡片:标题 + 行式设置项(标题/描述居左,控件居右)
function Group({ title, children }) {
  return React.createElement('div', {
    style: {
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 16,
      padding: '18px 20px 20px',
    },
  },
    React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: '0 0 6px' } }, title),
    children,
  )
}

// 行:标题+描述在左,控件在右;block 变体让控件独占一行(文本域)
function Row({ title, desc, children, block }) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '12px 2px',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
  }
  if (block) {
    rowStyle.flexDirection = 'column'
    rowStyle.alignItems = 'stretch'
  }
  return React.createElement('div', { style: rowStyle },
    React.createElement('span', { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
      React.createElement('span', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary)' } }, title),
      desc ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' } }, desc) : null),
    React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } }, children),
  )
}

// 开关(复刻设置页 switch:36x20 圆角轨道 + 滑块,选中品牌色)
function Switch({ checked, disabled, onChange, label }) {
  return React.createElement('label', { style: { display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'not-allowed' : 'pointer' } },
    React.createElement('input', {
      type: 'checkbox', checked, disabled, 'aria-label': label, onChange,
      style: { position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' },
    }),
    React.createElement('span', {
      style: {
        width: 36, height: 20, borderRadius: 10, position: 'relative', flexShrink: 0, transition: 'background .15s',
        background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-3)',
        border: '1px solid ' + (checked ? 'transparent' : 'var(--dsw-alias-border-l1)'),
      },
    },
      React.createElement('span', {
        style: {
          position: 'absolute', top: 1, left: checked ? 17 : 1, width: 16, height: 16, borderRadius: 8,
          background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
        },
      })),
  )
}

// 线性小图标(16px 视图,strokeWidth 1.6,与 MicIcon16 同一风格)
function CardIcon({ kind }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg' }
  if (kind === 'off') {
    return React.createElement('svg', common,
      React.createElement('circle', { cx: 8, cy: 8, r: 6 }),
      React.createElement('line', { x1: 4.2, y1: 4.2, x2: 11.8, y2: 11.8 }))
  }
  if (kind === 'page') {
    return React.createElement('svg', common,
      React.createElement('rect', { x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }),
      React.createElement('line', { x1: 2.5, y1: 6, x2: 13.5, y2: 6 }))
  }
  if (kind === 'standalone') {
    return React.createElement('svg', common,
      React.createElement('rect', { x: 2.5, y: 4.5, width: 8.5, height: 8.5, rx: 1.5 }),
      React.createElement('path', { d: 'M8 2.5h5.5V8' }),
      React.createElement('path', { d: 'M13.5 2.5L8.5 7.5' }))
  }
  if (kind === 'local') {
    return React.createElement('svg', common,
      React.createElement('rect', { x: 3, y: 3, width: 10, height: 10, rx: 1.5 }),
      React.createElement('rect', { x: 6, y: 6, width: 4, height: 4, rx: 0.5 }),
      React.createElement('path', { d: 'M6 1.5v3M10 1.5v3M6 11.5v3M10 11.5v3M1.5 6h3M1.5 10h3M11.5 6h3M11.5 10h3' }))
  }
  if (kind === 'voice') {
    return React.createElement('svg', common,
      React.createElement('path', { d: 'M2 6.5v3a1 1 0 0 0 1 1h2l4.5 3.2V2.3L5 5.5H3a1 1 0 0 0-1 1z' }),
      React.createElement('path', { d: 'M11 6.2a3.2 3.2 0 0 1 0 3.6M12.9 4.6a5.6 5.6 0 0 1 0 6.8' }))
  }
  // cloud(在线)
  return React.createElement('svg', common,
    React.createElement('path', { d: 'M4.5 13h7a2.5 2.5 0 0 0 .4-4.97A4 4 0 0 0 4.2 6.3 3 3 0 0 0 4.5 13z' }))
}
// VRM 形象 3D 预览(慢速自转,便于辨认;卸载时释放渲染器)
function VrmPreview({ id, height }) {
  const ref = React.useRef(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    setFailed(false)
    let disposed = false
    let renderer = null
    let raf = 0
    const scene = new THREE.Scene()
    // 与桌宠渲染一致的三点打光(VRM 材质无光时渲染为黑色)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 0.9))
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2)
    mainLight.position.set(1, 2, 3)
    scene.add(mainLight)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6)
    rimLight.position.set(-1, 1, -2)
    scene.add(rimLight)
    const camera = new THREE.PerspectiveCamera(30, el.clientWidth / Math.max(el.clientHeight, 1), 0.1, 20)
    camera.position.set(0.45, 1.05, 2.5)
    camera.lookAt(0, 0.85, 0)
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    fetch(id && id !== 'default' ? '/voice-pet/vrm?id=' + encodeURIComponent(id) : '/voice-pet/vrm?id=default')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('http ' + r.status))))
      .then((buffer) => new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject)))
      .then((gltf) => {
        if (disposed) return
        const vrm = gltf.userData.vrm
        VRMUtils.removeUnnecessaryVertices(vrm.scene)
        VRMUtils.rotateVRM0(vrm)
        scene.add(vrm.scene)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
        renderer.setClearColor(0x000000, 0)
        renderer.setSize(el.clientWidth, el.clientHeight)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        el.appendChild(renderer.domElement)
        const tick = () => {
          if (disposed) return
          vrm.scene.rotation.y += 0.005
          vrm.update(0.016)
          renderer.render(scene, camera)
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
  }, [id])
  return React.createElement('div', {
    ref,
    style: {
      width: '100%', height: height ?? 80,
      background: 'linear-gradient(180deg, var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-layer-1))',
      borderRadius: 6, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--dsw-alias-label-tertiary)', fontSize: 11,
    },
  }, failed ? '预览失败' : null)
}

// 形象选择卡片:VRM 3D 预览 + 名称 + 选中态
function AvatarCard({ active, disabled, name, id, onClick }) {
  return React.createElement('button', {
    type: 'button', disabled, onClick, title: name,
    style: {
      flex: 1, minWidth: 0, padding: 4, borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
      border: '1px solid ' + (active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
      background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1))' : 'var(--dsw-alias-bg-layer-1)',
      opacity: disabled ? 0.45 : 1,
      transition: 'border-color .15s, background .15s',
    },
  },
    React.createElement(VrmPreview, { id: id ?? '', height: 74 }),
    React.createElement('span', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '0 4px 2px' } },
      React.createElement('span', { style: { fontSize: 12, color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
      active ? React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 },
        React.createElement('path', { d: 'M3 8.5L6.5 12L13 4.5' })) : null),
  )
}

// 桌宠显示模式卡片(选中:品牌色边框 + 浅品牌背景 + 勾选)
function ModeCard({ active, disabled, title, desc, icon, onClick }) {
  return React.createElement('button', {
    type: 'button', disabled, onClick, title: disabled ? '独立桌宠仅桌面版可用' : title,
    style: {
      flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start',
      border: '1px solid ' + (active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
      background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1))' : 'var(--dsw-alias-bg-layer-1)',
      opacity: disabled ? 0.45 : 1,
      transition: 'border-color .15s, background .15s',
    },
  },
    React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 6, width: '100%' } },
      React.createElement('span', { style: { display: 'inline-flex', color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)' } },
        React.createElement(CardIcon, { kind: icon })),
      React.createElement('span', { style: { flex: 1, fontSize: 13, fontWeight: 600, color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)' } }, title),
      active ? React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
        React.createElement('path', { d: 'M3 8.5L6.5 12L13 4.5' })) : null),
    React.createElement('span', { style: { fontSize: 11, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)' } }, desc),
  )
}

// 主题变量见 dsh Theme tokens(--dsw-alias-* 系列,浅色/深色自动切换)
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
}

// ---- 与 harness 一致的图标按钮(对齐官方 IconActions:28px 圆角、tertiary 色、hover 高亮) ----
const actionBtnStyle = {
  width: 28,
  height: 28,
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  borderRadius: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 6,
  flexShrink: 0,
}
function actionBtnHover(el) {
  if (!el) return
  el.addEventListener('mouseenter', () => {
    el.style.background = 'var(--dsw-alias-interactive-bg-hover)'
    el.style.color = 'var(--dsw-alias-label-secondary)'
  })
  el.addEventListener('mouseleave', () => {
    el.style.background = 'transparent'
    el.style.color = 'var(--dsw-alias-label-tertiary)'
  })
}

// 麦克风图标(与 calwork 桌面端 ChatInput 语音输入按钮一致:stroke 线性、16px 视图、strokeWidth 1.6)
function MicIcon16({ size = 16, className }) {
  return React.createElement('svg', {
    width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
    xmlns: 'http://www.w3.org/2000/svg',
  },
    React.createElement('rect', { x: 6, y: 2, width: 4, height: 8, rx: 2 }),
    React.createElement('path', { d: 'M4 7.5a4 4 0 0 0 8 0' }),
    React.createElement('line', { x1: 8, y1: 11.5, x2: 8, y2: 14 }),
  )
}

// ---- 语音工具:输入框语音输入 + 消息卡片播报 ----

/** 按住说话采集:AudioWorklet 累积 float32 帧,松开回调完整 samples */
function createMicRecorder(onDone, onError) {
  let ctx = null
  let stream = null
  let workletNode = null
  const frames = []
  let sampleRate = 48000
  const WORKLET = `
const ACCUM = 4096;
class MicCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(ACCUM); this.off = 0; }
  process(inputs) {
    let ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    while (ch.length > 0) {
      const n = Math.min(ch.length, ACCUM - this.off);
      this.buf.set(ch.subarray(0, n), this.off);
      this.off += n;
      ch = ch.subarray(n);
      if (this.off >= ACCUM) { this.port.postMessage(this.buf); this.buf = new Float32Array(ACCUM); this.off = 0; }
    }
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
`
  return {
    async start() {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
        ctx.resume?.().catch(() => {})
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })))
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        sampleRate = ctx.sampleRate
        const source = ctx.createMediaStreamSource(stream)
        workletNode = new AudioWorkletNode(ctx, 'mic-capture')
        workletNode.port.onmessage = (e) => frames.push(e.data)
        source.connect(workletNode)
        frames.length = 0
        return true
      } catch (err) {
        onError?.('麦克风不可用:' + (err?.name ?? err))
        return false
      }
    },
    stop() {
      if (workletNode) workletNode.disconnect()
      if (stream) stream.getTracks().forEach((t) => t.stop())
      if (ctx) ctx.close().catch(() => {})
      workletNode = null
      stream = null
      ctx = null
      const total = frames.reduce((a, f) => a + f.length, 0)
      if (total === 0) return
      const samples = new Float32Array(total)
      let off = 0
      for (const f of frames) {
        samples.set(f, off)
        off += f.length
      }
      frames.length = 0
      onDone(samples, sampleRate)
    },
  }
}

/** 录音转写:POST /voice-pet/transcribe → 文本 */
async function transcribeSamples(samples, sampleRate) {
  const res = await fetch('/voice-pet/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ samples: Array.from(samples), sampleRate }),
  })
  return res.json()
}

/** 文本合成并播放:POST /voice-pet/speak → 音频 → AudioContext */
function playBase64Audio(base64, sampleRate) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const float = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  ctx.resume?.().catch(() => {})
  const buffer = ctx.createBuffer(1, float.length, sampleRate)
  buffer.copyToChannel(float, 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.onended = () => ctx.close().catch(() => {})
  source.start()
}

async function speakAndPlay(text) {
  const res = await fetch('/voice-pet/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json()
  if (data.ok && data.audio) playBase64Audio(data.audio, data.sampleRate)
  return data
}

// 消息文本提取(assistant-actions 按 messageId 找文本)
function assistantText(blocks) {
  return (blocks || []).flatMap((b) => (b && b.kind === 'text' ? [b.text] : [])).join('')
}
function extractMessageText(snapshot, messageId) {
  if (!snapshot) return ''
  const legacy = (snapshot.nodes || []).find((n) => n && n.kind === 'assistant' && n.messageId === messageId)
  if (legacy && legacy.blocks) return assistantText(legacy.blocks)
  const chatNodes = snapshot.chat && typeof snapshot.chat.nodes?.values === 'function' ? snapshot.chat.nodes.values() : []
  for (const n of chatNodes) {
    const closing = n && n.data ? n.data.closing : null
    if (closing && closing.finalNode && closing.finalNode.messageId === messageId && closing.blocks) {
      return assistantText(closing.blocks)
    }
  }
  return ''
}

// 通过 /voice-pet/config 路由读写配置(settings 服务对第三方 namespace 有白名单限制)
async function fetchConfig() {
  const res = await fetch('/voice-pet/config')
  return res.json()
}
async function patchConfig(patch) {
  const res = await fetch('/voice-pet/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return res.json()
}

function VoiceSettingsPage() {
  const [value, setValue] = React.useState(null)
  const [error, setError] = React.useState('')
  const [avatars, setAvatars] = React.useState([])
  const [avatarMsg, setAvatarMsg] = React.useState(null)
  const fileRef = React.useRef(null)
  React.useEffect(() => {
    fetchConfig().then(setValue).catch(() => setError('配置读取失败'))
    fetch('/voice-pet/avatars').then((r) => r.json()).then((d) => {
      if (d.ok) setAvatars(d.avatars)
    }).catch(() => {})
  }, [])
  const wakeWords = Array.isArray(value?.wakeWords) ? value.wakeWords : ['小希小希', '你好小希']
  const writable = true

  const patch = (p) => {
    patchConfig(p).then((res) => {
      if (res?.config) {
        setValue(res.config)
        window.dispatchEvent(new CustomEvent('voice-pet-config', { detail: res.config }))
      }
    }).catch(() => setError('配置保存失败'))
  }
  const refreshAvatars = () => {
    fetch('/voice-pet/avatars').then((r) => r.json()).then((d) => {
      if (d.ok) setAvatars(d.avatars)
    }).catch(() => {})
  }
  const notifyAvatar = (avatarId) => {
    window.dispatchEvent(new CustomEvent('voice-pet-config', { detail: { avatarId } }))
  }
  const onFileChosen = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setAvatarMsg('上传中…')
    const reader = new FileReader()
    reader.onload = async () => {
      const data = String(reader.result)
      const comma = data.indexOf(',')
      const base64 = comma >= 0 ? data.slice(comma + 1) : data
      try {
        const res = await fetch('/voice-pet/vrm-upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ base64, filename: file.name }),
        })
        const d = await res.json()
        if (d.ok) {
          setAvatarMsg('已上传并切换到新形象')
          refreshAvatars()
          notifyAvatar(d.avatarId)
        } else {
          setAvatarMsg('上传失败:' + (d.error || '未知错误'))
        }
      } catch {
        setAvatarMsg('上传失败:网络错误')
      }
    }
    reader.onerror = () => setAvatarMsg('读取文件失败')
    reader.readAsDataURL(file)
  }
  const onAvatar = (e) => {
    const id = e.target.value
    fetch('/voice-pet/avatar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => r.json()).then((d) => {
      if (d.ok) {
        setAvatarMsg(null)
        refreshAvatars()
        notifyAvatar(id === 'default' ? '' : id)
      } else {
        setAvatarMsg('切换失败:' + (d.error || '未知错误'))
      }
    }).catch(() => setAvatarMsg('切换失败'))
  }
  const onDeleteAvatar = () => {
    const id = value?.avatarId
    if (!id) return
    fetch('/voice-pet/avatar-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => r.json()).then((d) => {
      if (d.ok) {
        setAvatarMsg('已删除,恢复默认形象')
        refreshAvatars()
        notifyAvatar('')
      } else {
        setAvatarMsg('删除失败:' + (d.error || '未知错误'))
      }
    }).catch(() => setAvatarMsg('删除失败'))
  }
  const onWakeWords = (e) => {
    const list = e.target.value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
    patch({ wakeWords: list })
  }
  const onNum = (field) => (e) => {
    const n = Number(e.target.value)
    if (Number.isFinite(n)) patch({ [field]: n })
  }
  const onSelect = (field) => (e) => {
    const v = e.target.value
    // 切到独立桌宠时大小超 150% 的自动收敛(独立窗口放不下)
    if (field === 'petMode' && v === 'standalone' && (value.petSize ?? 1) > 1.5) {
      patch({ petMode: v, petSize: 1.5 })
      return
    }
    patch({ [field]: v })
  }
  const onPickMode = (v) => {
    if (v === 'standalone' && (value.petSize ?? 1) > 1.5) {
      patch({ petMode: v, petSize: 1.5 })
      return
    }
    patch({ petMode: v })
  }
  const onPickTts = (v) => patch({ ttsEngine: v })
  const onCheck = (field) => (e) => patch({ [field]: e.target.checked })
  // Tauri 桌面壳暴露 __TAURI__ 全局,浏览器(Web)没有 → 独立桌宠仅桌面端可选
  const isDesktop = typeof window !== 'undefined' && Boolean(window.__TAURI__)
  const petSizePct = Math.round(((value?.petSize) ?? 1) * 100)
  const sizeMax = (value?.petMode ?? 'off') === 'standalone' ? 150 : 200
  const sizeShown = Math.min(petSizePct, sizeMax)

  return React.createElement('div', { style: { maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' } },
    error ? React.createElement('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, margin: 0 } }, error) : null,
    React.createElement('p', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: '20px', margin: 0 } },
      '语音桌宠的显示、唤醒、语音输入与语音合成配置(本地离线优先,需网络的能力已标注)'),
    value === null && !error
      ? React.createElement('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, '加载中…')
      : React.createElement(React.Fragment, null,
          React.createElement(Group, { title: '桌宠设置' },
            React.createElement(Row, { title: '桌宠显示', desc: isDesktop ? '独立桌宠需重启桌面应用后生效' : '独立桌宠仅桌面版可用' },
              React.createElement('div', { style: { display: 'flex', gap: 6, width: 300, flexShrink: 0 } },
                React.createElement(ModeCard, { active: (value.petMode ?? 'off') === 'off', disabled: !writable, title: '关闭', desc: '不显示桌宠', icon: 'off', onClick: () => onPickMode('off') }),
                React.createElement(ModeCard, { active: (value.petMode ?? 'off') === 'page', disabled: !writable, title: '页面桌宠', desc: '悬浮在主界面', icon: 'page', onClick: () => onPickMode('page') }),
                React.createElement(ModeCard, { active: (value.petMode ?? 'off') === 'standalone', disabled: !writable || !isDesktop, title: '独立桌宠', desc: '独立悬浮窗口', icon: 'standalone', onClick: () => onPickMode('standalone') }))),
            React.createElement(Row, { title: '桌宠大小', desc: (value.petMode ?? 'off') === 'standalone' ? '独立窗口上限 150%(超出自动收至 150%)' : '缩放桌宠显示尺寸(50%-200%)' },
              React.createElement('input', { type: 'range', min: 50, max: sizeMax, step: 5, style: { width: 140 }, value: sizeShown, disabled: !writable, onChange: (e) => patch({ petSize: Number(e.target.value) / 100 }) }),
              React.createElement('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', width: 44, textAlign: 'right' } }, sizeShown + '%')),
            React.createElement(Row, { title: '桌宠形象', desc: '上传 VRM 1.0/0.x 模型;动画需标准人形骨骼,非人形模型仅静态展示' },
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, width: 300, flexShrink: 0 } },
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 } },
                  React.createElement(AvatarCard, { active: !value?.avatarId, disabled: !writable, name: '默认形象', id: 'default', onClick: () => onAvatar({ target: { value: '' } }) }),
                  avatars.filter((a) => a.custom).map((a) => React.createElement(AvatarCard, { key: a.id, active: value?.avatarId === a.id, disabled: !writable, name: a.name, id: a.id, onClick: () => onAvatar({ target: { value: a.id } }) }))),
                React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  React.createElement('button', { type: 'button', style: { ...inputStyle, width: 'auto', flexShrink: 0, cursor: 'pointer', padding: '3px 10px' }, onClick: () => fileRef.current && fileRef.current.click() }, '上传新形象'),
                  value?.avatarId ? React.createElement('button', { type: 'button', style: { ...inputStyle, width: 'auto', flexShrink: 0, cursor: 'pointer', padding: '3px 10px', color: 'var(--dsw-alias-state-error-primary)' }, onClick: onDeleteAvatar }, '删除') : null,
                  avatarMsg ? React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, avatarMsg) : null))),
            React.createElement('input', { ref: fileRef, type: 'file', accept: '.vrm', style: { display: 'none' }, onChange: onFileChosen })),
          React.createElement(Group, { title: '唤醒' },
            React.createElement(Row, { title: '唤醒词', desc: '纯中文词命中率更高,如:小希小希' },
              React.createElement('textarea', { style: { ...inputStyle, width: 300, minHeight: 56, resize: 'vertical' }, value: wakeWords.join('\n'), disabled: !writable, onChange: onWakeWords }))),
          React.createElement(Group, { title: '语音输入' },
            React.createElement(Row, { title: '说完判定(VAD)', desc: '说话停顿超过该时长视为说完(2-15 秒)' },
              React.createElement('input', { type: 'number', style: { ...inputStyle, width: 100 }, value: value.vadSilenceSeconds ?? 5, min: 2, max: 15, disabled: !writable, onChange: onNum('vadSilenceSeconds') }))),
          React.createElement(Group, { title: '语音合成' },
            React.createElement(Row, { title: 'TTS 引擎', desc: '选择朗读引擎,Melo 离线、Edge 在线' },
              React.createElement('div', { style: { display: 'flex', gap: 6, width: 300, flexShrink: 0 } },
                React.createElement(ModeCard, { active: (value.ttsEngine ?? 'melo') === 'melo', disabled: !writable, title: 'MeloTTS', desc: '本地离线', icon: 'local', onClick: () => onPickTts('melo') }),
                React.createElement(ModeCard, { active: (value.ttsEngine ?? 'melo') === 'edge', disabled: !writable, title: 'Edge TTS', desc: '在线,需网络', icon: 'cloud', onClick: () => onPickTts('edge') }))),
            React.createElement(Row, { title: '语速', desc: '0.5-1.5' },
              React.createElement('input', { type: 'number', style: { ...inputStyle, width: 100 }, value: value.speed ?? 1, step: 0.1, min: 0.5, max: 1.5, disabled: !writable, onChange: onNum('speed') })),
            React.createElement(Row, { title: 'Edge 音色', desc: '仅 TTS 引擎为 edge 时生效' },
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, width: 300, flexShrink: 0 } },
                EDGE_VOICES.map((v) => React.createElement(ModeCard, {
                  key: v.code,
                  active: (value.edgeVoice ?? 'zh-CN-XiaoxiaoNeural') === v.code,
                  disabled: !writable || (value.ttsEngine ?? 'melo') !== 'edge',
                  title: v.name, desc: v.code, icon: 'voice',
                  onClick: () => patch({ edgeVoice: v.code }),
                })))),
            React.createElement(Row, { title: '语音播报', desc: '开启 voice_speak 与回复朗读' },
              React.createElement(Switch, { label: '语音播报', checked: value.speakEnabled !== false, disabled: !writable, onChange: onCheck('speakEnabled') }))),
        ),
  )
}

// ---------- 输入框语音输入(conversation.input.left) ----------
function MicInputButton(props) {
  const { useInput, inputActions } = props
  const [state, setState] = React.useState('idle') // idle | recording | transcribing | error
  const recorderRef = React.useRef(null)
  const input = typeof useInput === 'function' ? useInput((s) => s) : null
  const inputRef = React.useRef(null)
  inputRef.current = input

  const onStart = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (state === 'recording' || state === 'transcribing') return
    const recorder = createMicRecorder(async (samples, sampleRate) => {
      setState('transcribing')
      try {
        const res = await transcribeSamples(samples, sampleRate)
        if (res.ok && res.text) {
          const draft = (inputRef.current && inputRef.current.draft) || ''
          const sep = draft && !/[\s\u3000]$/.test(draft) ? ' ' : ''
          inputActions.setDraft(draft + sep + res.text)
        } else if (!res.ok) {
          setState('error')
        }
      } catch {
        setState('error')
      }
      setState('idle')
    }, () => setState('error'))
    recorderRef.current = recorder
    const ok = await recorder.start()
    if (ok) setState('recording')
    else setState('error')
  }
  const onEnd = () => {
    if (recorderRef.current) {
      recorderRef.current.stop()
      recorderRef.current = null
    }
    if (state === 'recording') setState('transcribing')
  }

  // 与 harness 图标风格一致的 SVG 图标(官方填充字形;无 Mic 官方图标,用自绘 MicIcon16)
  let icon = null
  let hint = ''
  if (state === 'recording') {
    icon = React.createElement(IconStopFill16, { size: 14 })
    hint = '松开结束'
  } else if (state === 'transcribing') {
    icon = React.createElement(IconLoadingOutline16, { size: 14 })
  } else if (state === 'error') {
    icon = React.createElement(IconWarningOutline16, { size: 14 })
  } else {
    icon = React.createElement(MicIcon16, { size: 14 })
  }
  const style = {
    border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, padding: '2px 6px',
    borderRadius: 6, color: 'var(--dsw-alias-label-secondary)',
    display: 'inline-flex', alignItems: 'center', gap: 4,
    ...(state === 'recording' ? { background: 'var(--dsw-alias-state-error-primary)', color: '#fff', borderRadius: '50%' } : {}),
  }
  return React.createElement('button', {
    type: 'button', title: '按住说话,松开识别', style,
    onPointerDown: onStart, onPointerUp: onEnd, onPointerLeave: onEnd, onPointerCancel: onEnd,
  }, icon, hint ? React.createElement('span', null, hint) : null)
}

// ---------- 消息卡片朗读(conversation.chat.assistant-actions) ----------
function SpeakButton(props) {
  const { messageId, useSession } = props
  const [speaking, setSpeaking] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [enabled, setEnabled] = React.useState(true)
  const snapshot = typeof useSession === 'function' ? useSession((s) => s) : null
  const text = snapshot ? extractMessageText(snapshot, messageId) : ''
  // 语音播报开关:挂载时读取配置,设置页变更时同步(voice-pet-config 事件)
  React.useEffect(() => {
    fetchConfig().then((cfg) => setEnabled(cfg.speakEnabled !== false)).catch(() => {})
    const onCfg = (e) => {
      const c = e.detail || {}
      if (c.speakEnabled !== undefined) setEnabled(c.speakEnabled !== false)
    }
    window.addEventListener('voice-pet-config', onCfg)
    return () => window.removeEventListener('voice-pet-config', onCfg)
  }, [])

  const onClick = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!enabled || speaking || !text) return
    setSpeaking(true)
    setError(false)
    try {
      const res = await speakAndPlay(text)
      if (!res.ok) setError(true)
    } catch {
      setError(true)
    } finally {
      setTimeout(() => setSpeaking(false), 600)
    }
  }

  const usable = enabled && !!text
  const style = {
    border: 'none', background: 'transparent', cursor: usable ? 'pointer' : 'not-allowed',
    fontSize: 14, padding: '2px 5px', borderRadius: 6, color: 'var(--dsw-alias-label-secondary)',
    opacity: usable ? 1 : 0.35,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  return React.createElement('button', {
    type: 'button', title: !enabled ? '语音播报已关闭(设置 → 语音桌宠 → 语音合成)' : text ? '朗读这条回复' : '无文本可朗读', style, onClick,
  },
    speaking
      ? React.createElement(IconPauseOutline16, { size: 14 })
      : error
        ? React.createElement(IconWarningOutline16, { size: 14 })
        : React.createElement(IconPlayOutline16, { size: 14 }))
}

// ---------- 插件入口 ----------
// 桌宠浮层:按配置 petMode(off/page/standalone)、petSize 与 avatarId 动态挂载/卸载/缩放/换形象
function PetOverlay() {
  const hostRef = React.useRef(null)
  const petRef = React.useRef(null)
  const avatarRef = React.useRef('')
  const [mode, setMode] = React.useState('off')
  const [size, setSize] = React.useState(1)
  const [avatarId, setAvatarId] = React.useState('')
  React.useEffect(() => {
    fetchConfig().then((cfg) => {
      setMode(cfg.petMode ?? 'off')
      setSize(cfg.petSize ?? 1)
      setAvatarId(cfg.avatarId ?? '')
    }).catch(() => {})
    const onCfg = (e) => {
      const c = e.detail || {}
      if (c.petMode !== undefined) setMode(c.petMode)
      if (c.petSize !== undefined) setSize(c.petSize)
      if (c.avatarId !== undefined) setAvatarId(c.avatarId)
    }
    window.addEventListener('voice-pet-config', onCfg)
    return () => window.removeEventListener('voice-pet-config', onCfg)
  }, [])
  React.useEffect(() => {
    const want = mode === 'page'
    const avatarChanged = avatarRef.current !== avatarId
    avatarRef.current = avatarId
    if (want && hostRef.current && (!petRef.current || avatarChanged)) {
      // 首次挂载或形象变更:销毁重建(重新拉取 /voice-pet/vrm)
      if (petRef.current) {
        try {
          petRef.current.dispose()
        } catch {}
        petRef.current = null
      }
      petRef.current = mountPet(hostRef.current, { scale: size })
    } else if (!want && petRef.current) {
      try {
        petRef.current.dispose()
      } catch {}
      petRef.current = null
    } else if (want && petRef.current) {
      petRef.current.setScale(size)
    }
  }, [mode, size, avatarId])
  return React.createElement('div', { style: { display: 'contents' }, ref: hostRef })
}

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  // 桌宠浮层(受 petMode 开关控制)
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'voice-pet' },
    () => React.createElement(PetOverlay, null),
  ))

  // 输入框语音输入
  slots.inject('conversation.input.left', () => slots.register(
    { name: 'conversation.input.left', id: 'voice-pet-mic', order: 5 },
    (props) => React.createElement(MicInputButton, props),
  ))

  // 消息卡片朗读
  slots.inject('conversation.chat.assistant-actions', () => slots.register(
    { name: 'conversation.chat.assistant-actions', id: 'voice-pet-speak', order: 5 },
    (props) => React.createElement(SpeakButton, props),
  ))

  // 设置页
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'voice-pet', order: 30, label: '语音桌宠' },
    () => React.createElement(VoiceSettingsPage, null),
  ))
}
