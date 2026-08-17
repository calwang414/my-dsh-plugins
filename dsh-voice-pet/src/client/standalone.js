/**
 * 独立页面入口:桌宠独立页面(无 dsh ModuleLoader 环境)。
 * 打包为普通 IIFE(全局 DshVoicePet.mount),HTML 直接引用。
 * mountPet 已内置全部能力:VRM 渲染、WS 连接、按住说话、TTS 播放、拖动。
 * 挂载前读取 /voice-pet/config,应用 petSize 缩放。
 */
import { mountPet } from './pet.js'

export async function mount(container) {
  let scale = 1
  try {
    const res = await fetch('/voice-pet/config')
    const cfg = await res.json()
    // 独立窗口固定 360×480,最大放得下 150%
    scale = Math.min(Number(cfg.petSize) || 1, 1.5)
  } catch {}
  return mountPet(container, { scale })
}
