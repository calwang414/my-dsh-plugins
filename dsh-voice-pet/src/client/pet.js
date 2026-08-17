/**
 * dsh-voice-pet — Client 半。
 *
 * VRM 桌宠 + 语音面板:
 *  - shell.overlay 注入悬浮桌宠(three.js 渲染 cal-vrm.vrm,clips 动画,
 *    口型/眨眼/表情/说话动画);
 *  - 麦克风 AudioWorklet 采集 → WebSocket /voice-pet/ws 上行;
 *  - WS 下行:唤醒/状态事件、TTS 音频块 → AudioContext 播放 + 桌宠说话动画。
 *
 * 构建:vite lib 模式打包(three/@pixiv/three-vrm 等全部内联),
 * 输出 window.__ModuleLoader__.load({ id, factory }) 格式。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { retargetAnimation } from 'vrm-mixamo-retarget'

// ---------------- 样式 ----------------
const STYLE = `
#dsh-voice-pet-root { position: fixed; right: 16px; bottom: 16px; width: 220px; height: 260px; z-index: 2147483000; pointer-events: none; }
#dsh-voice-pet-root .pet-canvas { width: 100%; height: 100%; pointer-events: auto; cursor: grab; }
#dsh-voice-pet-root .pet-canvas.dragging { cursor: grabbing; }
`

// ---------------- 资源获取(Host 路由) ----------------
function fetchBuffer(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error('fetch ' + url + ' → ' + r.status)
    return r.arrayBuffer()
  })
}

// ---------------- 动画配置(与 calwork pet.js 一致) ----------------
const PET_ANIMS = {
  idle: { files: ['idle.fbx'], loop: true, expression: 'neutral', strength: 1, mouth: false },
  thinking: { file: 'thinking.fbx', loop: true, expression: 'angry', strength: 0.3, mouth: false },
  working: { file: 'working.fbx', loop: true, expression: 'happy', strength: 0.4, mouth: false },
  happy: { file: 'happy.fbx', loop: true, expression: 'happy', strength: 1, mouth: false },
  laughing: { file: 'laughing.fbx', loop: true, expression: 'happy', strength: 1, mouth: true },
  excited: { file: 'excited.fbx', loop: true, expression: 'happy', strength: 1, mouth: false, extraExpression: 'surprised', extraStrength: 0.5 },
  talking: { file: 'talking1.fbx', loop: false, expression: 'happy', strength: 1, mouth: true },
  talking2: { file: 'talking2.fbx', loop: false, expression: 'happy', strength: 1, mouth: true },
  wave: { file: 'wave.fbx', loop: false, expression: 'happy', strength: 1, mouth: 0.4 },
  nod: { file: 'nod.fbx', loop: false, expression: 'relaxed', strength: 0.6, mouth: false },
  dancing: { file: 'dancing.fbx', loop: false, expression: 'happy', strength: 1, mouth: false },
  'falling-down': { file: 'falling-down.fbx', loop: false, expression: 'surprised', strength: 1, mouth: false, then: 'standup' },
  standup: { file: 'standup.fbx', loop: false, expression: 'neutral', strength: 1, mouth: false },
  shrugging: { file: 'shrugging.fbx', loop: false, expression: 'relaxed', strength: 0.4, mouth: false },
  sad: { file: 'sad.fbx', loop: false, expression: 'sad', strength: 0.8, mouth: false },
}
const POKE_ANIMS = ['wave', 'dancing', 'falling-down', 'laughing']
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh']
const TARGET_EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh']

function mouthInterval(r) {
  return 0.15 + r * 0.15
}
function mouthTriggerChance(r) {
  return r < 0.4
}

// ---------------- 桌宠渲染(移植自 calwork browser/pet/pet.js) ----------------
export function mountPet(container, { onStatus, onSay, scale = 1 } = {}) {
  if (!container) return null
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'dsh-voice-pet-root'
  // 锚定右下角,缩放从右下角展开
  root.style.transformOrigin = 'bottom right'
  root.style.transform = scale !== 1 ? 'scale(' + scale + ')' : 'none'
  container.appendChild(root)
  const canvas = document.createElement('canvas')
  canvas.className = 'pet-canvas'
  root.appendChild(canvas)

  // ---- three.js 场景 ----
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  // 渲染分辨率随缩放系数提升(backing = CSS 尺寸 × dpr × scale),放大后依然清晰
  let petScale = scale
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 0.9))
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.2)
  mainLight.position.set(1, 2, 3)
  scene.add(mainLight)
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.6)
  rimLight.position.set(-1, 1, -2)
  scene.add(rimLight)
  const camera = new THREE.PerspectiveCamera(32, 0.8, 0.1, 100)
  camera.position.set(0, 1.35, 3.6)
  camera.lookAt(0, 0.9, 0)
  const modelRoot = new THREE.Group()
  modelRoot.position.y = 0
  scene.add(modelRoot)

  let vrm = null
  let animMixer = null
  const animActions = new Map()
  let loopName = null
  let activeLoopKey = null
  let activeOnce = null
  let onceTimer = null
  let mouthOverride = 0
  let mouthViseme = null
  let mouthTimer = 0
  let speakingAnimActive = false
  let speakingLoopTimer = null
  let squeezeTime = 1
  const expressionValues = {}

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

  function stripHipMovement(clip) {
    const track = clip.tracks.find((t) => t.name.toLowerCase().includes('hips.position'))
    if (track) {
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = 0
        track.values[i + 2] = 0
      }
    }
    return clip
  }

  async function loadAnimFile(actionName, fileName, cfg) {
    try {
      const buffer = await fetchBuffer('/voice-pet/clips/' + fileName)
      const fbx = new FBXLoader().parse(buffer, fileName)
      const clip = retargetAnimation(fbx, vrm, { logWarnings: false })
      if (!clip) throw new Error('重定向失败')
      stripHipMovement(clip)
      registerAnimAction(actionName, clip, cfg.loop)
      return
    } catch (error) {
      try {
        const base = fileName.replace(/\.fbx$/i, '')
        const buffer = await fetchBuffer('/voice-pet/clips/' + base + '.vrma')
        const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject))
        const vrmAnimation = gltf.userData?.vrmAnimations?.[0]
        if (!vrmAnimation) throw new Error('文件不含 VRM 动画')
        const clip = createVRMAnimationClip(vrmAnimation, vrm)
        registerAnimAction(actionName, clip, cfg.loop)
      } catch (e) {
        console.warn('[voice-pet] 动画 ' + fileName + ' 加载失败:', e?.message ?? e)
      }
    }
  }

  function registerAnimAction(name, clip, loop) {
    animMixer ??= new THREE.AnimationMixer(vrm.scene)
    const action = animMixer.clipAction(clip)
    action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce
    if (!loop) action.clampWhenFinished = true
    animActions.set(name, action)
  }

  async function loadVrm() {
    try {
      const buffer = await fetchBuffer('/voice-pet/vrm')
      loader.parse(buffer, '', (gltf) => {
        vrm = gltf.userData.vrm
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        modelRoot.add(gltf.scene)
        if (vrm.lookAt) vrm.lookAt.autoUpdate = false
        modelRoot.visible = false
        loadAllAnims()
      }, (err) => {
        console.error('[voice-pet] VRM 解析失败:', err)
      })
    } catch (err) {
      console.error('[voice-pet] VRM 读取失败:', err)
    }
  }

  async function loadAllAnims() {
    await Promise.all(Object.keys(PET_ANIMS).map((n) => loadAnim(n)))
    if (!loopName) {
      setLoop('idle')
      modelRoot.visible = true
    }
  }

  async function loadAnim(name) {
    const cfg = PET_ANIMS[name]
    if (!cfg || animActions.has(name)) return
    const fileList = cfg.files ?? [cfg.file]
    for (let i = 0; i < fileList.length; i++) {
      const actionName = fileList.length > 1 ? `${name}_${i}` : name
      await loadAnimFile(actionName, fileList[i], cfg)
    }
  }

  function pickVariant(name) {
    const cfg = PET_ANIMS[name]
    const variants = cfg?.files?.length ?? 1
    return variants > 1 ? `${name}_0` : name
  }

  function setLoop(name) {
    const actionName = pickVariant(name)
    const action = animActions.get(actionName)
    if (!action || activeLoopKey === actionName) return
    const prev = activeLoopKey ? animActions.get(activeLoopKey) : null
    if (prev) prev.fadeOut(0.3)
    action.reset().fadeIn(0.3).play()
    loopName = name
    activeLoopKey = actionName
  }

  function playOnce(name, after) {
    const cfg = PET_ANIMS[name]
    const action = animActions.get(name)
    if (!cfg || !action) return
    clearTimeout(onceTimer)
    const cur = activeLoopKey ? animActions.get(activeLoopKey) : null
    if (cur) cur.fadeOut(0.35)
    action.reset().fadeIn(0.35).play()
    activeOnce = name
    const until = performance.now() + action.getClip().duration * 1000 + 800
    if (cfg.mouth === true || (typeof cfg.mouth === 'number' && mouthTriggerChance(Math.random()))) {
      mouthOverride = until
    }
    const recover = () => {
      activeOnce = null
      if (after) {
        action.fadeOut(0.35)
        after()
      } else if (cfg.then) {
        action.fadeOut(0.35)
        playOnce(cfg.then)
      } else if (cur) {
        action.fadeOut(0.35)
        cur.reset().fadeIn(0.35).play()
      } else {
        action.fadeOut(0.35)
      }
    }
    onceTimer = setTimeout(recover, action.getClip().duration * 1000 + 800)
  }

  // ---- 说话动画(与 TTS 播报联动) ----
  function playSpeakingAnim() {
    if (!speakingAnimActive) return
    const prev = activeOnce ? animActions.get(activeOnce) : null
    const next = Math.random() < 0.5 ? 'talking' : 'talking2'
    const cfg = PET_ANIMS[next]
    const action = animActions.get(next)
    if (!cfg || !action) return
    clearTimeout(onceTimer)
    if (prev && prev !== action) prev.fadeOut(0.2)
    action.reset().fadeIn(0.2).play()
    activeOnce = next
    speakingLoopTimer = setTimeout(playSpeakingAnim, action.getClip().duration * 1000 + 200)
  }

  function stopSpeakingAnim() {
    speakingAnimActive = false
    clearTimeout(onceTimer)
    clearTimeout(speakingLoopTimer)
    const raw = loopName ?? 'idle'
    const base = PET_ANIMS[raw] ? raw : raw.replace(/_\d+$/, '')
    const action = animActions.get(pickVariant(base))
    if (!action) return
    const spk = activeOnce ? animActions.get(activeOnce) : null
    if (spk && spk !== action) spk.fadeOut(0.25)
    const cur = activeLoopKey ? animActions.get(activeLoopKey) : null
    if (cur && cur !== action) cur.fadeOut(0.25)
    action.reset().fadeIn(0.25).play()
    activeLoopKey = pickVariant(base)
    loopName = base
    activeOnce = null
  }

  function poke() {
    if (speakingAnimActive) return
    if (activeOnce) return
    const animName = POKE_ANIMS[Math.floor(Math.random() * POKE_ANIMS.length)]
    playOnce(animName)
    if (mouthTriggerChance(Math.random())) mouthOverride = performance.now() + 1500
    squeezeTime = 0
  }

  function setExpressionValue(name, value) {
    expressionValues[name] = value
    if (vrm) {
      const expr = vrm.expressionManager?.getExpression(name)
      if (expr) expr.value = value
    }
  }

  // ---- 主循环 ----
  const clock = new THREE.Clock()
  let blinkTimer = 4 + Math.random() * 3
  let blinkPhase = -1
  let lastViewW = 0
  let lastViewH = 0

  function resizeRenderer() {
    const w = canvas.clientWidth || 220
    const h = canvas.clientHeight || 260
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * petScale)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    const now = performance.now()
    if (canvas.clientWidth !== lastViewW || canvas.clientHeight !== lastViewH) {
      lastViewW = canvas.clientWidth
      lastViewH = canvas.clientHeight
      resizeRenderer()
    }
    if (!vrm) {
      renderer.render(scene, camera)
      return
    }
    if (squeezeTime < 0.4) {
      squeezeTime += delta
      const k = squeezeTime / 0.4
      const s = k < 0.5 ? 0.05 * (2 * k) : 0.05 * (2 - 2 * k)
      modelRoot.scale.set(1 - s, 1 + s, 1 - s)
    } else {
      modelRoot.scale.lerp(new THREE.Vector3(1, 1, 1), 0.3)
    }
    blinkTimer -= delta
    if (blinkTimer <= 0 && blinkPhase < 0) blinkPhase = 0
    if (blinkPhase >= 0) {
      blinkPhase += delta * 8
      if (blinkPhase >= 1) {
        blinkPhase = -1
        blinkTimer = 4 + Math.random() * 3
      } else {
        setExpressionValue('blink', Math.sin(blinkPhase * Math.PI))
      }
    } else {
      setExpressionValue('blink', 0)
    }
    const mouthActive = now < mouthOverride || (speakingAnimActive && now >= mouthOverride)
    mouthTimer -= delta
    if (mouthActive && mouthTimer <= 0) {
      mouthViseme = VISEMES[Math.floor(Math.random() * VISEMES.length)]
      mouthTimer = mouthInterval(Math.random())
    }
    if (!mouthActive) mouthViseme = null
    VISEMES.forEach((v) => setExpressionValue(v, mouthViseme === v ? 0.8 : 0))
    TARGET_EXPRESSIONS.forEach((name) => {
      const target = name === 'happy' && speakingAnimActive ? 1 : 0
      const current = expressionValues[name] ?? 0
      setExpressionValue(name, current + (target - current) * 0.1)
    })
    if (animMixer) animMixer.update(delta)
    vrm.update(delta)
    renderer.render(scene, camera)
  }

  // ---- 拖动/点击 ----
  let dragState = null
  // 独立窗口(Tauri)无边框:拖动桌宠 = 拖动整个窗口
  const tauriWindow = window.__TAURI__ ? window.__TAURI__.window.getCurrentWindow() : null
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (tauriWindow) {
      tauriWindow.outerPosition().then((pos) => {
        const data = pos && pos.data ? pos.data : pos
        dragState = {
          x: e.screenX,
          y: e.screenY,
          origin: data,
          moved: false,
        }
        canvas.setPointerCapture(e.pointerId)
      })
      return
    }
    dragState = { x: e.clientX, y: e.clientY, moved: false }
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!dragState) return
    const dx = e.screenX - dragState.x
    const dy = e.screenY - dragState.y
    if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      dragState.moved = true
      canvas.classList.add('dragging')
    }
    if (dragState.moved && tauriWindow && dragState.origin) {
      tauriWindow.setPosition({
        type: 'Physical',
        x: Math.round(dragState.origin.x + dx),
        y: Math.round(dragState.origin.y + dy),
      })
      return
    }
    if (dragState.moved) {
      const rect = root.getBoundingClientRect()
      root.style.left = Math.min(Math.max(8, rect.left + dx), window.innerWidth - rect.width - 8) + 'px'
      root.style.right = 'auto'
      root.style.top = Math.min(Math.max(8, rect.top + dy), window.innerHeight - rect.height - 8) + 'px'
      root.style.bottom = 'auto'
      dragState.x = e.clientX
      dragState.y = e.clientY
    }
  })
  canvas.addEventListener('pointerup', () => {
    if (!dragState) return
    const wasDrag = dragState.moved
    dragState = null
    canvas.classList.remove('dragging')
    if (!wasDrag) poke()
  })

  // ---- 语音:状态/事件 ----
  function setStatus(text) {
    // 桌宠浮层不显示状态徽标;状态仅供外部回调
    if (onStatus) onStatus(text)
  }

  const api = {
    setStatus,
    poke,
    setSpeaking(on) {
      speakingAnimActive = on
      clearTimeout(speakingLoopTimer)
      if (on) playSpeakingAnim()
      else stopSpeakingAnim()
    },
    setScale(s) {
      petScale = s
      root.style.transform = s !== 1 ? 'scale(' + s + ')' : 'none'
      resizeRenderer()
    },
    dispose() {
      cancelAnimationFrame(animate)
      clearTimeout(onceTimer)
      clearTimeout(speakingLoopTimer)
      renderer.dispose()
      root.remove()
      style.remove()
    },
  }

  // ---- 音频播放(TTS 块) ----
  let playbackCtx = null
  let playbackSource = null

  function playAudioChunk(float32, sampleRate) {
    playbackCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    playbackCtx.resume?.().catch(() => {})
    const buffer = playbackCtx.createBuffer(1, float32.length, sampleRate)
    buffer.copyToChannel(float32, 0)
    playbackSource = playbackCtx.createBufferSource()
    playbackSource.buffer = buffer
    playbackSource.connect(playbackCtx.destination)
    playbackSource.start()
  }

  // ---- WebSocket(与 Host/引擎通信) ----
  let ws = null
  let wsQueue = []

  function wsSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    else wsQueue.push(msg)
  }

  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/voice-pet/ws`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      setStatus('已连接')
      for (const m of wsQueue) ws.send(JSON.stringify(m))
      wsQueue = []
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        // TTS 音频块(二进制)
        if (ev.data.byteLength > 0) {
          api.setSpeaking(true)
          playAudioChunk(new Float32Array(ev.data), 44100)
        }
        return
      }
      const msg = JSON.parse(ev.data)
      if (msg.type === 'event') {
        if (msg.event === 'wake') {
          setStatus('👂 在听', 'woken')
        } else if (msg.event === 'command') {
          setStatus('🗣️ ' + (msg.text ?? '').slice(0, 12), 'woken')
          if (onSay) onSay(msg.text)
        } else if (msg.event === 'speaking') {
          setStatus('🔊 播报中', 'speaking')
        } else if (msg.event === 'speaking-done') {
          api.setSpeaking(false)
          setStatus('已连接')
        } else if (msg.event === 'timeout') {
          setStatus('已连接')
        } else if (msg.event === 'state' && msg.state === 'listening') {
          setStatus('已连接')
        }
      } else if (msg.type === 'status') {
        if (msg.modelState !== 'ready') setStatus('模型: ' + msg.modelState)
      } else if (msg.type === 'audio-meta') {
        if (msg.isLast) {
          setTimeout(() => {
            api.setSpeaking(false)
            setStatus('已连接')
          }, 300)
        }
      }
    }
    ws.onclose = () => {
      setStatus('已断开')
      setTimeout(connectWs, 3000)
    }
  }

  loadVrm()
  resizeRenderer()
  animate()
  connectWs()
  return api
}
