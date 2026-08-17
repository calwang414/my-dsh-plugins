# my-dsh-plugins

DeepSeek Harness 个人插件集(插件目录独立仓库)。

## 插件

| 插件 | 说明 |
|---|---|
| [dsh-voice-pet](dsh-voice-pet/) | 本地语音 + VRM 桌宠:sherpa-onnx 唤醒词/ASR/TTS 全离线,VRM 虚拟形象随语音说话,支持页面浮层与桌面独立窗口两种形态 |
| [dsh-cdp-browser](dsh-cdp-browser/) | 基于 Chrome DevTools Protocol 的浏览器控制插件 |

## 安装

**方式 A(推荐):预编译安装包(GitHub Releases,免构建)**

```sh
dsh plugin --profile web add https://github.com/calwang414/my-dsh-plugins/releases/download/v0.1.0/dsh-voice-pet-0.1.0.tgz
dsh plugin --profile web add https://github.com/calwang414/my-dsh-plugins/releases/download/v0.1.0/dsh-cdp-browser-0.1.0.tgz
# 重启 dsh
```

- voice-pet 首次启动会自动安装引擎依赖(原生 sherpa 库,按平台自动选择)与语音模型(~320MB,hf-mirror);
- cdp-browser 需 macOS + Google Chrome。

**方式 B:从源码安装**

```sh
git clone https://github.com/calwang414/my-dsh-plugins.git
cd my-dsh-plugins
cd dsh-voice-pet && npm install && (cd engine && npm install) && \
  npx vite build && cp dist/client.js lib/client.js && \
  npx vite build --config vite.standalone.config.js && cd ..
dsh plugin --profile web add ./dsh-voice-pet
dsh plugin --profile web add ./dsh-cdp-browser
# 重启 dsh
```

各插件目录内均有独立 README 与构建说明。
