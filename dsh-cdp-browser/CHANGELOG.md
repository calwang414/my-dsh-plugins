# Changelog

## 0.1.0 (2026-08-14)

首个版本。

- 智能体直接控制浏览器的 16 个 `browser_*` 模型工具(open / status / snapshot / navigate / click / type / press / scroll / back / forward / reload / get_text / eval / screenshot / cookies / close)。
- 登录态复用:受控 Chrome 运行在真实 Chrome 配置的副本上(`fresh` 重新复制 / `reuse` 复用已有副本 / `clean` 无登录态),无需 Chrome 扩展,不触碰真实浏览器。
- 零依赖桥接进程 `bridge.mjs`:Node 22 内置 WebSocket 直连 Chrome DevTools 协议。
- 纯文本快照管线:编号交互元素跨快照稳定,密码/敏感字段掩码;Cookie 值永不出现在工具结果中。
- 官方安装方式:`dsh plugin --profile web add <插件目录>`。
