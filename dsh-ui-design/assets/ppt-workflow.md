# ppt-workflow

DeepSeek Harness **设计模式**的演示文稿(PPT)工作流契约。进入设计模式后、在 **PPT 视图**下开始任何幻灯片任务前,先读本技能。本技能对应 **PPT 视图(演示文稿项目,`{{cwd}}/design/ppt/`,可导出 .pptx/.pdf)**;网页设计项目的工作流见 `design-workflow` 技能。

## 概念:设计规范 ≠ 模板(布局)

- **设计规范(品牌主题)** = 整体视觉语言:颜色、字体、圆角、间距、阴影等,全部集中在 `design/ppt/design-tokens.css` 的 `--ipw-*` 变量;
- **模板(布局)** = 幻灯片结构与组件样式的 HTML,**不携带品牌规范**——颜色字体一律引用 `var(--ipw-*)`;
- **布局引入不改变规范**:用模板创建新页面时,只引入模板的 HTML 结构,项目的 design-tokens.css **保持不变**(除非用户明确要求换规范);
- 规范随时可通过 PPT 视图顶部的**「设计规范」按钮**全局切换(写入 design-tokens.css,演示全局生效)。

## 项目结构

当前工作区有一个**共享演示文稿项目**,位于 `{{cwd}}/design/ppt/` 目录。所有使用设计模式的会话共享它;用户在对话旁的 **PPT 视图**中查看、精调与导出。

```text
design/ppt/
├── manifest.json        项目清单(id、版本、入口;category 为 slides)
├── index.html           入口文件(manifest.entry 指向它;内含全部幻灯片)
├── design-tokens.css    设计令牌(--ipw-* CSS 变量),主题统一从这里改
└── brief.json           需求说明,可随迭代更新
```

## 幻灯片结构

- 画布固定 **1600×900**;每页幻灯片是一个 `.slide`,所有幻灯片放在入口 HTML 的 `.deck` 结构内(Studio 据此渲染上一页/下一页导航);
- 新建幻灯片页面也要保持 slide 结构:1600×900、`data-ipw-slide`,不要用普通网页布局;
- 演示字号保证投影可读(标题、正文、标注层次分明);
- 同一份 deck 中保持视觉语言一致(同色、同字体层级、同留白节奏)。

## 设计令牌系统

- 颜色、字体、圆角、阴影、间距等一律通过 `design-tokens.css` 的 `--ipw-*` 变量控制;
- 页面样式引用变量(`var(--ipw-color-primary)` 等),**不要**把具体值硬编码散落在页面里;
- 换主题 = 改令牌,而不是逐元素改样式。

### 样式必须内联(画布只加载内联样式)

PPT 画布用 iframe 渲染页面,**只内联 `design-tokens.css`**(带 `data-ipw-design-tokens` 的 link),其他外部 CSS 一律不加载(相对路径会 404):

- 页面**所有样式必须写在 HTML 的 `<style>` 内**,不要创建 `app.css` 等额外 CSS 文件;
- 外部资源(图片/字体)用绝对 URL,不要用相对路径(画布 iframe 的基准路径不是项目目录)。

### 画布注入的类名规则(会被 !important 强制覆盖)

Studio 会向画布注入主题规则,以下类名/标签的样式会被 token 值**强制覆盖**(无论页面怎么写):

| 命中元素 | 被强制为 |
|---|---|
| `body[data-ipw-theme-role="page"]` / `.page` / `.shell` / `.app-shell` | 左右内边距 `--ipw-page-padding`、文字色 `--ipw-color-text` |
| `article` / `.card` / `.panel` / `.tile` / `.task` / `[data-ipw-theme-role="card"]` | 卡片底色/边框/阴影/圆角(`--ipw-card-*`) |
| `.primary` / `.cta-primary` / `.button-primary` / `.btn-primary` | 主色底 + `--ipw-color-on-primary` 文字 |
| `.muted` / `.subtle` / `.lede` / `.subtitle` / `.description` | 弱化文字色 `--ipw-color-muted` |
| `.eyebrow` / `.kicker` | 强调色 `--ipw-color-accent` |

应对:**直接用 token 变量设计这些元素**(被覆盖后视觉一致),或改用不冲突的类名。`--ipw-color-on-primary` 若未在 tokens 定义,按钮文字色会失效——设计含按钮的幻灯片时在 tokens.css 里定义它。

## 导出

- 演示可导出 **.pptx**(原生可编辑)与 **.pdf**;
- **PPTX 导出要求每个可见元素都被导出计划覆盖**:文字/形状/图片会被转为可编辑的 PowerPoint 对象,未覆盖的可视元素(如不被支持的动效效果)会**阻止导出**而非降级为截图;
- 导出前自查:所有可见元素均可被导出计划覆盖;导出完成后确认文件生成无误。

## 工作流

0. **先定规范,再谈设计**:动手前先检查 `design/ppt/design-tokens.css`——
   - 项目已有规范:直接使用,不修改;
   - 项目还没有规范(新项目):**先向用户推荐一个设计规范**(如 Element+ 企业、自建品牌主题,或从「设计规范」按钮的主题列表中选择一个),确认后写入 design-tokens.css,再开始设计;
   - 用户要求整体换风格时,才更新 design-tokens.css(演示全局跟随);
1. **先读后写**:动手前先读 `design/ppt/manifest.json` 与入口文件,理解现有演示结构与设计;
2. **新演示需求**:在 `design/ppt/` 下创建或改写幻灯片 HTML,保持 `.deck`/`.slide` 结构、manifest.json、design-tokens.css 与入口文件的契约一致;
3. **保持令牌契约**:新样式一律走 `--ipw-*` 变量,可先扩展 design-tokens.css 再引用;
4. **记录迭代**:完成修改后更新 `design/ppt/brief.json`,记录需求与本次改动;
5. **协作**:用户在 PPT 视图中可选中元素精调,或点 **Ask AI** 让模型修改选区——Ask AI 草稿会携带文件路径与元素定位,按其要求修改即可;
6. **模板(布局)**:用户在顶部「+」选择模板后,会**新增一个页面**(输入页面名称),该页面的 HTML 来自模板布局,**项目的 design-tokens.css 保持不变**;之后按第 1~5 步继续;
7. **完成后自查(review)**:每次设计/修改完成、向用户交付前,按以下清单自查并修复(与 system-prompt 中当前视图注入的清单一致):
   - **幻灯片结构**:每页均为 `.slide` 结构且 1600×900 无溢出;
   - **令牌一致性/完整性**:颜色、字体、圆角、间距全部通过 `var(--ipw-*)` 引用,无硬编码,引用的变量均已定义;
   - **文案与占位**:示例文案/占位符已替换为演示内容,与 brief 一致;
   - **deck 导航**:上一页/下一页正常,无多余空页,首末页完整;
   - **导出检查**:所有可见元素已被导出计划覆盖,PPTX 导出不会被阻止;
   - **规范未动**:确认本次修改没有改动 design-tokens.css(除非用户明确要求换规范);
   - 自查发现的问题修复后再交付,并在 brief.json 记录本次改动。

## 约束

- `manifest.json` 的 `style` 字段必须是以下枚举之一:`minimal`、`editorial`、`newsprint`、`swiss`、`bold`、`soft`、`pastel`、`glass`、`dark`、`cyber`、`technical`、`playful`、`cinematic`、`data`、`brutalist`、`retro`、`sketch`、`custom`(写其他值会导致 PPT 页面加载失败);
- 只修改 `{{cwd}}/design/ppt/` 内的文件(以及共享的令牌/结构契约);
- 除非用户要求整体重设计,否则保持现有结构;
- design/ppt/ 被所有设计模式会话共享:保存前先读当前文件,避免覆盖他人的最新修改;
- 多会话并发编辑冲突时,优先保留最新内容并向用户说明。

## 能力边界

- 适合:演示文稿/幻灯片(PPT 视图,可导出 .pptx/.pdf);
- 网站、App 原型、海报、信息卡、数据报告、杂志等非幻灯片设计见 `design-workflow` 技能;
- 不适合:视频(需要独立的视频插件)。
