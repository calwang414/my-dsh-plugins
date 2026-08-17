# dsh-voice-pet

本地语音 + VRM 桌宠的 [DeepSeek Harness](https://github.com/deepseek-ai) 插件。

- **本地语音**:sherpa-onnx 唤醒词(KWS)/语音识别(ASR)/TTS 全离线,Edge TTS 可选在线;
- **VRM 桌宠**:three.js 渲染 VRM 模型,说话口型/眨眼/表情/动画联动;
- **两种形态**:页面浮层(主界面右下角)或独立悬浮窗口(桌面端);
- **融入对话**:输入框按住说话识别、消息卡片一键朗读、`voice_speak` 等模型工具。

## 结构

- **Host**(`lib/index.js`):模型管理(优先复用本机 calwork 模型目录,否则 hf-mirror 下载)、引擎子进程托管(崩溃自动重启)、WebSocket 桥、静态资源路由、`voice_speak` / `voice_stop` / `voice_status` 工具。
- **引擎**(`engine/engine.mjs` + 复用 calwork 引擎代码):独立 node 进程加载 sherpa-onnx,协议为 JSON-lines stdio。
- **Client**(`src/client/pet.js` → `lib/client.js`):`shell.overlay` 悬浮桌宠、口型/眨眼/表情/说话动画、按住说话、TTS 播放。

## 安装

```sh
# 1. 构建 client bundle(需要 node_modules 已安装)
cd plugins/dsh-voice-pet
npm install          # 构建依赖(three/vrm/vite);引擎依赖在 engine/ 下另行安装
(cd engine && npm install)
npx vite build && cp dist/client.js lib/client.js
npx vite build --config vite.standalone.config.js   # 独立页 bundle(dist/pet-standalone.js)

# 2. 安装进 web profile
dsh plugin --profile web add <本目录>

# 3. 重启 dsh
```

首次启动:插件自动把模型准备到 `~/.dsh/dsh-voice-pet/models`(若本机存在 calwork 的 `assets/models` 则直接复用,否则从 hf-mirror 下载约 320MB)。就绪后按「桌宠显示」配置显示桌宠。

> 注意:`vite build` 与 standalone 构建共用 `dist/`,两个配置均已设 `emptyOutDir: false`,构建顺序任意、互不覆盖。

## 两种形态

**1. 页面桌宠(嵌入浮层)**:设置中「桌宠显示」选「页面桌宠」后,桌宠以 `shell.overlay` 浮层出现在 dsh 页面右下角。

**2. 独立桌宠(独立页面/窗口)**:设置中「桌宠显示」选「独立桌宠」(仅桌面端)后,桌面应用启动时自动创建独立悬浮窗口(无边框、透明、置顶、右下角)。该模式仅桌面版生效:

```
http://127.0.0.1:<端口>/voice-pet/pet
```

- 独立页面(透明背景、可拖动、按住 🎤 说话)通过 WebSocket 与宿主引擎通信,唤醒/识别/TTS 全功能不变;
- **关掉 dsh 主页面不影响桌宠**(只要 dsh 进程在运行);
- 独立页路由仅在 `petMode === 'standalone'` 时提供(桌面壳启动时探测,404 则不建独立窗口),切换模式后需重启桌面应用生效;
- 独立窗口固定 360×480,桌宠大小上限 150%(超出自动收敛)。

## 融入对话:输入框语音输入 + 消息卡片播报

- **🎤 输入框麦克风**(`conversation.input.left`):按住说话,松开后本地 ASR 识别,文本自动填入输入框草稿。
- **🔈 消息卡片朗读**(`conversation.chat.assistant-actions`):每条 assistant 回复旁有朗读按钮,点击本地 TTS 合成并播放该条回复。
- 与桌宠的流式播报相互独立(一次性接口 `/voice-pet/transcribe` 与 `/voice-pet/speak`)。

## 使用

- **按住 🎤**:按住说话,松开识别(按钮路径,不依赖唤醒)。
- **唤醒词**:对麦克风说「小希小希」→ 桌宠回应「我在」→ 直接说指令;说完停顿 5 秒(可配)后识别。
- **模型工具**:`voice_speak {text}` 让桌宠朗读;`voice_status` 查状态。
- 拖动桌宠移动位置;单击桌宠触发互动动画。

## 设置菜单

重启 dsh 后,侧边栏 →「设置」→「语音桌宠」页签,提供:

| 设置项 | 说明 |
|---|---|
| 唤醒词 | 逗号/换行分隔,修改后 KWS 即时重建 |
| 说完判定(VAD 静音秒数) | 2-15 秒,修改后 VAD 即时重建 |
| TTS 引擎 | melo(本地离线)/ edge(微软免费在线) |
| 语速 | 0.5-1.5 |
| Edge 音色 | 8 个中文音色(界面显示中文名,仅 edge 引擎生效) |
| 语音播报 | voice_speak 总开关 |
| 桌宠显示 | 关闭 / 页面桌宠(主界面浮层)/ 独立桌宠(独立窗口,仅桌面端,切换后需重启桌面应用) |
| 桌宠大小 | 50%-200% 缩放,页面浮层即时生效,独立窗口下次打开生效 |

修改即时生效(保存到 `~/.dsh/dsh-voice-pet/config.json` 并下发引擎),无需重启。

> 说明:dsh 的 settings 服务对 Web 客户端有**白名单限制**(`WEB_SETTINGS_NAMESPACES`,官方注释:让插件自行暴露是 deferred work),第三方 namespace 会返回 `settings-not-exposed`。因此本插件使用自建配置通道(`/voice-pet/config` 路由 + config.json),设置 UI 注册在标准 `settings.section` 页签。

## 配置

`~/.dsh/dsh-voice-pet/` 下:

- `config.json` 设置(上述菜单读写)
- `models/` 语音模型(KWS/ASR/TTS/VAD)
- `wake-cache/` 「我在」唤醒反馈缓存(毫秒级响应)

## 故障排查

- **语音工具报「语音引擎未就绪」**:检查 `~/.dsh/dsh-voice-pet/models` 是否就绪(四组模型齐全),或重启应用让引擎重启。
- **独立桌宠窗口空白**:确认 `dist/pet-standalone.js` 存在(重新执行 standalone 构建),且配置为「独立桌宠」(`/voice-pet/pet` 应返回 200)。
- **放大后模糊**:桌宠渲染分辨率随缩放系数提升(backing = 尺寸 × dpr × scale),旧 bundle 需刷新/重启后生效。
