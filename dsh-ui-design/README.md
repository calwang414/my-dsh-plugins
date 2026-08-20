# dsh-ui-design

可视化设计工作室插件:在 DeepSeek Harness 对话中生成并精调设计作品(网站、App 原型、海报、信息卡、数据报告、杂志等)。

本项目**参照 `deepseek-idesign@0.2.0`(MIT)重新实现**。注意:

- `deepseek-idesign` 从 `0.2.1` 起改用 iPolloWork Source Available 协议,**只有 `0.2.0` 及更早版本是 MIT**;
- 本插件的 `lib/` 与 `studio/` 来自 `deepseek-idesign@0.2.0`(npm tarball,未经修改的基线代码);
- 不要从 `0.2.1+`(Source Available)版本拷贝代码进来。

## 目录结构

```text
dsh-ui-design/
├── package.json      包元数据:dsh.bundle / dsh.client 清单、peer 依赖、./preset ./skill 导出
├── cordis.patch.yml  插入 profile 层栈的入口(id + name)
├── LICENSE           MIT(保留上游版权声明 + 本项目修改声明)
├── README.md
├── lib/              Host 端:index.js(可读,非压缩)+ client.js + preset.js(设计模式会话行)+ skill.js(技能提供者)+ templates/(模板市场)
├── assets/           design-workflow 技能正文(design-workflow.md)
├── presets/          设计模式的 agent.cordis.yml / preset.yml 模板(安装时写入 ~/.dsh/.agent-presets/)
└── studio/dist/      Studio 前端(编译产物)
```

## 设计模式（会话模式）

插件激活时自动在 harness 用户预设根目录创建**设计模式**:

```text
~/.dsh/.agent-presets/dsh-ui-design/
├── preset.yml        显示名「设计模式」,与标准/创造等模式并列(顺序 5)
└── agent.cordis.yml  模式组合:完整编码工具 + 设计工作流
```

- 模式选择器里出现「设计模式」,选中后会话按该组合装载;
- 组合里的两个会话行(安装时以插件绝对 file URL 写入):
  - `lib/preset.js`:注册「设计工作流」system-prompt 段(精简版,指向技能)+ 监听 `agent/created` 自动创建 `design/` 目录;
  - `lib/skill.js`:向**本模式作用域层**注册技能提供者,只有设计模式会话能在技能目录看到并加载,其他模式不可见;
- 组合文件只写一次;插件移动位置后自动重写路径行,用户手工编辑保留。

## 技能(设计模式专属)

| 技能 | 内容 | 许可 |
|---|---|---|
| `design-workflow` | 本插件的工作流契约:共享 design/ 项目结构、`--ipw-*` 令牌系统、工作流与约束(`assets/design-workflow.md`) | MIT(本项目) |
| `frontend-design` | Anthropic 官方前端设计指导:有辨识度的视觉设计决策、排版、避免模板化(`assets/frontend-design/SKILL.md`,来自 [anthropics/skills](https://github.com/anthropics/skills)) | **Apache-2.0**(随包保留 `assets/frontend-design/LICENSE.txt`) |

两个技能都随插件打包,仅在设计模式的技能目录中可见;模型接到设计任务时按需加载。

## 工作区级共享项目

与原版「每个会话一个 `design/<sessionId>/`」不同,本项目改为**工作区级共享**:

- 所有会话(无论哪个 sessionId)的 Design 视图都指向 `<工作区>/design/` 这一个项目;
- 项目文件直接放在 `design/` 根:index.html、design-tokens.css、manifest.json、brief.json;
- **PPT 视图**指向 `<工作区>/design/ppt/`(独立共享项目,入口 html 内每页是一个 .slide,1600×900 画布);
- 多会话并发编辑由 host 的 mtime 版本冲突检测(409)与操作锁保护;
- 应用模板时 staging/backup 移到 `design/` 外(`.dsh-ui-design.<uuid>/`),避免整体换目录时被带走。

## 工作原理

- **Host 端**(`lib/index.js`):同一工厂注册**两个 studio 实例**——Design(`mode: "design"`,路由 `/dsh-ui-design`,模板 `lib/templates/`)与 PPT(`mode: "slides"`,路由 `/dsh-ui-design-ppt`,模板 `lib/templates-ppt/`);都只访问工作区 `design/` 对应共享目录,写入带版本冲突检查、原子替换;启动时同步安装设计模式预设;
- **客户端**(`lib/client.js`):注册 **Design** 与 **PPT** 两个对话视图标签,各自以 `?sessionId=...&workspaceId=...` 加载对应 Studio iframe(会话 id 只用于定位工作区,不绑定项目)。两个门控:
  - **动态注册(跟随当前会话)**:标签跟随「当前活动会话」——只有当前会话是设计模式(`agentPreset === "dsh-ui-design"`)时才注册视图;切到其他模式的会话、回到首页、或设计模式会话被关闭时立即注销(标签整体消失);
  - **内容门控**:视图组件按当前会话的预设判断——非设计模式会话打开标签只显示提示页,不加载 Studio;
- **会话行**(`lib/preset.js`):设计模式组合内装载,注册工作流提示段 + 自动创建 `design/` 目录;
- **模板市场**:Design 29 个模板 + PPT 5 个幻灯片模板(`templates-ppt/`,来自 deepseek-ippt@0.1.0 MIT,含 LICENSE/NOTICE)。

## 多页面(Design)

一个设计项目可含多个页面,注册表在 `design/manifest.json` 的 `pages` 字段(`{id, title, entry}`),`manifest.entry` 恒为活动页:

- **页面 API**(host):`POST /api/page` 支持 `create` / `switch` / `remove`,带操作锁与原子写盘,失败不落盘;创建时自动播种基础项目文件;最后一页不可移除(409);
- **页面切换器**(client):Design 视图头部下拉列出页面,`+` 新建(输入标题,自动 slug 命名文件)、`−` 移除当前页;切换后重载 Studio 画布(画布只渲染 `manifest.entry`);
- **agent 协作**:模型可直接编辑 manifest.json 增删页面(见 `design-workflow` 技能),与 UI 切换器共用同一注册表;
- 单页项目兼容:无 `pages` 字段时按 `page-1 → entry` 归一化,旧项目不受影响。

## 设计源文件导出（PSD / Sketch）

网页设计（design）模式的「下载」菜单提供 **导出 Sketch** 与 **导出 PSD**，
把当前页面导出为可编辑的设计源文件（纯浏览器内完成，无服务端改动）：

- **Sketch**：基于 [html2sketch](https://github.com/ant-design/html2sketch)（Ant Design，MIT）解析 DOM
  为 Sketch 图层树，再用 JSZip 组装 `.sketch` 文件（document.json / pages / meta.json / user.json）。
  文本、图片、色块为可编辑图层，支持伪元素、渐变、溢出等（还原度约 95%）。
- **PSD**：基于 [ag-psd](https://github.com/Agamnentzar/ag-psd)（MIT），P0 方案为「分层截图」——
  每个可见元素用 html2canvas 单独截图生成一个图层（像素级保真、图层与 DOM 顺序一致），
  文本暂为图片层（可编辑文本层的语义映射为后续增强）。
- **固定目录输出**（不是浏览器下载）：首次导出时浏览器弹出目录选择器，
  选一次输出目录（建议工作区 `design/output/`），目录句柄存入 IndexedDB，
  之后每次导出直接写入该固定目录（覆盖同名文件），不再询问。
- 两者复用同一导出骨架：隐藏 iframe 重建预览页面（无 sandbox）→ 锁定与预览一致的视口 →
  颜色烘焙（`color-mix`/`oklab` 等 CSS Color 4 语法计算值归一化为 rgba）→ 字体就绪 → 生成文件。
- 新增静态资源：`studio/dist/assets/html2sketch.min.js`、`ag-psd.bundle.js`、`jszip-standalone.min.js`、
  `design-source-export-v6.js`（导出逻辑，由主 bundle 动态 import）。

**还原度边界**（设计源文件是绝对定位图层树，与 HTML 流式布局语义不同，导出为有损近似）：

- 布局按**当前视口**拍平为绝对坐标；flex/grid、响应式断点不保留；
- 动画、交互、伪元素状态不导出（静态帧）；
- PSD 文本暂不可编辑（Sketch 文本为原生文本图层）；
- 复杂滤镜 / clip-path / 混合模式可能降级。

## 内部标识改名（已完成）
| 位置 | 上游值 | 现在的值 |
|---|---|---|
| `cordis.patch.yml` entry id | `ipollowork-design-studio` | `dsh-ui-design` |
| 视图 slot id（`lib/client.js`） | `ipollowork-design-studio` | `dsh-ui-design-studio` |
| Studio 路由（`lib/client.js`/`lib/index.js`） | `/ipollowork-design` | `/dsh-ui-design` |
| host↔studio RPC 通道 | `ipollowork-design-studio-host-v1` | `dsh-ui-design-studio-host-v1` |
| 鉴权请求头 | `x-ipollowork-design-token` | `x-dsh-ui-design-token` |
| 鉴权令牌占位符 | `__IPOLLOWORK_DESIGN_STUDIO_TOKEN_VALUE__` | `__DSH_UI_DESIGN_STUDIO_TOKEN_VALUE__` |
| 插件显示名 / 默认模板 id | `iPolloWork` / `ipollowork.deepseek-harness.design` | `dsh-ui-design` / `dsh-ui-design.deepseek-harness.design` |
| 模板 id（manifest + curated 列表 + 目录名） | `ipollowork.*`（29 个） | `dsh-ui-design.*`（29 个） |

改动同步覆盖了 `lib/index.js`、`lib/client.js`、`studio/dist/index.html` 和 studio 主 bundle（接口字符串两端一致）。`node --check` 语法校验通过。

### 有意保留的内容

- **`--ipw-*` 设计令牌变量**（`design-tokens.css`/模板/Studio 共用契约，改名会破坏模板体系）
- **Studio 前端内部的运行时标识**（`ipollowork-design-html-v1`、`ipollowork-design-runtime`、`data-ipw-*` 等 DOM id——bundle 内自洽，不与外部交互）
- **MIT 署名**：模板 `NOTICE` 文件与 manifest 的 `source.attribution` 保留 iPolloWork 声明（MIT 要求保留版权声明）
- **展示文本**：模板 `entry.html` 示例内容与 Studio 界面里的 "iPolloWork" 字样（纯外观，可按需替换）

> 注意:若与 `deepseek-idesign` 同时安装,两者会注册**相同的视图 slot id 与路由**,产生冲突。使用本插件时应先移除 `deepseek-idesign`。

> ⚠️ `lib/client.js` 顶部 `__ModuleLoader__.load({ id: ... })` 的 id **必须等于 package.json 的完整包名**(如 `@calwang414/dsh-ui-design`),否则客户端模块加载器报 "loaded without registering"。改包名时务必同步。

## 安装

```sh
# 从源码目录安装到 web profile
cd <my-dsh-plugins 仓库根目录>
dsh plugin --profile web add ./dsh-ui-design
# 或打包后安装:pnpm pack && dsh plugin --profile web add ./dsh-ui-design-0.1.0.tgz
# 重启 dsh
```

## 使用

1. 在工作区目录启动 dsh web,新建对话;
2. 在会话模式选择器(「即将开始的这个会话所用的 Agent 预设」)选择**设计模式**——选择后该工作区根目录会自动创建 `design/` 目录;
3. 对话视图切换到 **Design**,查看/编辑共享设计项目;
4. 在对话里指挥智能体设计(描述需求、改配色、调布局),或点 `+` 选模板,或在画布选中元素精调 / 点 **Ask AI**;
5. 项目文件保存在工作区 `design/` 根(真实 HTML/CSS 文件,所有设计模式会话共享)。

## 构建与开发

- `lib/` 与 `studio/dist/` 是可直接运行的产物,改完即生效(重启 dsh);
- `lib/preset.js` 与 `presets/` 是设计模式特有的新增部分(上游没有),改动后重新激活插件即可刷新 `~/.dsh/.agent-presets/dsh-ui-design/`;
- 需要 TypeScript 源码时,可重新从 npm 拉取 `deepseek-idesign@0.2.0`(MIT) 解包,或参照上游 GitHub 仓库结构自行重建构建链;
- 本插件按 `plugins/` 目录约定发布:GitHub Releases 分发 tarball,`dsh plugin --profile web add <url>` 安装。
