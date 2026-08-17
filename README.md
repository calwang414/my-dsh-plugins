# my-dsh-plugins

DeepSeek Harness 个人插件集(插件目录独立仓库)。

## 插件

| 插件 | 说明 |
|---|---|
| [dsh-voice-pet](dsh-voice-pet/) | 本地语音 + VRM 桌宠:sherpa-onnx 唤醒词/ASR/TTS 全离线,VRM 虚拟形象随语音说话,支持页面浮层与桌面独立窗口两种形态 |
| [dsh-cdp-browser](dsh-cdp-browser/) | 基于 Chrome DevTools Protocol 的浏览器控制插件 |

## 安装

```sh
# 以 voice-pet 为例
dsh plugin --profile web add <插件目录>
# 重启 dsh
```

各插件目录内均有独立 README 与构建说明。
