# dsh-cdp-browser

版本:0.1.0 · 许可:MIT · 环境要求:Node.js `^22.19`、macOS + Google Chrome

让 DeepSeek Harness 的智能体**直接控制浏览器**并**复用你的登录状态**——不安装 Chrome 扩展,不触碰你正在使用的真实浏览器。

## 原理

```
agent (模型)                    Harness 宿主进程                    独立 Chrome 实例
┌─────────────┐   browser_*   ┌──────────────────┐  CDP over   ┌──────────────────────┐
│  browser_open │ ───────────▶ │ 动态 Cordis 插件  │ ──────────▶ │  Chrome (窗口/无头)    │
│  ... 工具     │  JSON lines  │  ⇄ bridge.mjs    │  WebSocket  │  --user-data-dir =     │
│              │ ◀─────────── │  (子进程,零依赖)   │ ◀────────── │  真实配置的副本(登录态) │
└─────────────┘               └──────────────────┘            └──────────────────────┘
```

- **直接控制**:插件通过 `subprocess` 服务启动一个零依赖的 Node 桥接进程(`bridge.mjs`),桥接进程用 Node 22 内置 WebSocket 直连 Chrome 的 DevTools 协议,向模型暴露 `browser_*` 工具。全程不需要 Chrome 扩展。
- **复用登录态**:受控 Chrome 以你**真实 Chrome 配置的副本**启动(`~/Library/Application Support/Google/Chrome` → `~/.dsh/dsh-cdp-profiles/default`,排除缓存与扩展)。macOS 下 Cookie 加密密钥在你的钥匙串里,副本可正常解密,登录态、会话、Cookie 全部带过去;真实浏览器不受影响。
- **纯文本管线**:页面快照是结构化文本 + 编号交互元素清单,模型按编号点击/输入,不依赖截图(也提供截图工具供人工查看)。

## 工具

| 工具 | 说明 |
|---|---|
| `browser_open` | 启动受控 Chrome(默认 `profile: reuse` 复用已有副本;`fresh` 重新从真实配置复制;`clean` 无登录态;`headless` 无窗口) |
| `browser_status` | 运行状态、当前 URL/标题 |
| `browser_snapshot` | 结构化文本快照:正文 + 编号交互元素(索引跨快照稳定;密码/敏感值掩码为 `••••`) |
| `browser_navigate` / `browser_back` / `browser_forward` / `browser_reload` | 页面导航 |
| `browser_click` | 按快照编号点击 |
| `browser_type` | 输入文本(兼容 React/Vue 受控组件,`replace` 清空重填) |
| `browser_press` | 按键(Enter/Tab/Escape/方向键…) |
| `browser_scroll` | 视口滚动 |
| `browser_get_text` | 按 CSS 选择器读取局部文本 |
| `browser_eval` | 在页面执行任意 JS 并返回 JSON 结果 |
| `browser_screenshot` | 截图保存为 PNG |
| `browser_cookies` | 列出 Cookie 名/域名(值不回传) |
| `browser_close` | 关闭受控 Chrome 与桥接进程 |

## 使用(当前会话,动态插件)

插件已在会话内以动态 Cordis 插件形式定义并激活,`browser_*` 工具直接可用:

1. 让模型调用 `browser_open`(首次会自动复制你的 Chrome 配置,耗时约几秒到几十秒)。
2. 用 `browser_snapshot` 查看页面,`browser_navigate` 去任意已登录站点即可看到登录态。
3. 用完调用 `browser_close`。

## 持久安装(重启后仍可用)

通过官方 `dsh plugin` 机制安装到 web profile(内部在 profile 目录执行 `pnpm add`,并把声明了 `dsh.bundle` 的包自动登记进 `dsh.profile.bundles`):

```sh
dsh plugin --profile web add /path/to/plugins/dsh-cdp-browser
```

安装后重启 dsh(production 模式无热更新),`browser_*` 工具自动可用。升级源码后重新执行同一条命令即可(link 依赖实时同步)。卸载:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-cdp-browser
```

不要手工编辑 `~/.dsh/profiles/web/cordis.patch.yml` 或手工创建 `node_modules` 符号链接——插件行由 `dsh plugin` 命令统一维护。

## 独立调试桥接进程

```sh
node bridge.mjs --profile-dir /tmp/cdp-test-profile
```

然后用 JSON 行协议驱动,例如:

```sh
echo '{"id":1,"cmd":"open","args":{"url":"https://example.com","headless":true,"profile":"clean"}}' | node bridge.mjs --profile-dir /tmp/cdp-test-profile
```

## 版本

- 当前版本 `0.1.0`(见 `package.json` 与 `CHANGELOG.md`)。
- 本地锁定安装:插件以 `link:` 依赖安装在 web profile,版本由插件目录内的 `package.json` 决定——源码更新即时生效,无需重新安装。
- 升级元数据(版本号/描述)后重启 dsh 即生效;如需回退,将 `package.json` 版本改回旧值即可。
- 本版本未发布到 npm/GitHub;若将来要分发,先移除 `private: true`,再 `npm publish`(注意 `@deepseek-ai` 为官方 scope,发布需改用自有 scope),或推送到 GitHub 后用 `dsh plugin --profile web add github:<user>/dsh-cdp-browser#v0.1.0` 安装。

## 安全边界

- 激活本插件即授予智能体对一个**携带你 Cookie/登录态副本**的 Chrome 的完全控制权——只批准你信任的运行。
- Cookie 值永不出现在工具结果中(`browser_cookies` 只返回名称与域名;快照对密码/卡号类字段掩码)。
- 受控 Chrome 使用独立配置副本,不写你的真实配置;`SingletonLock` 残留时自动清理。
- 受控 Chrome 关闭后,配置文件副本保留在 `~/.dsh/dsh-cdp-profiles/default`,可删除。

## 实测注意事项

- **登录态是否生效取决于站点**:受控浏览器完整复用了真实配置的 Cookie(值解密正常,如钉钉的 `stayLogin`/`pub_uid`、GitHub 的 `logged_in`),但只有你真实浏览器中**存在有效登录**的站点才会显示已登录;已过期或从未登录的站点不会凭空出现登录态。
- **无头模式的 UA 是 `HeadlessChrome`**,部分站点(GitHub 等)会因此拒绝会话;登录态敏感操作建议用有头模式(`headless: false` 默认)。
- **复制时真实 Chrome 正在运行**:复制的是配置文件的最近写入状态(SQLite WAL 可能未合并),新登录的站点建议先 `browser_close` 再 `browser_open(profile: "fresh")` 重新复制。
- **`browser_navigate` 超时不一定失败**:页面加载慢(尤其网络受限站点)时工具可能先超时,随后用 `browser_status` / `browser_snapshot` 确认实际状态即可。
