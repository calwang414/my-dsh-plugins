/**
 * 设计模式会话行:挂在设计模式的 agent.cordis.yml 组合里,随预设的 standing
 * scope 装载一次。三个职责:
 *
 * 1. 向 system-prompt 注册「设计工作流」段:两份工作流(网页设计 / 演示文稿)
 *    是**常驻完整注入**的提示词契约,不是按需加载的技能。host 端记录用户
 *    当前打开的是 Design 视图还是 PPT 视图,每次组装提示词时按模式注入
 *    对应的完整工作流(项目结构、令牌系统、画布契约、步骤与自查清单);
 * 2. 未检测到视图时注入极简引导(按 manifest 自判,视图打开后自动切换);
 * 3. 监听 agent/created,当新 agent 的会话以设计模式创建时,确保其工作区
 *    根目录下存在 design/ 目录(「选择设计模式即自动建目录」)。
 *
 * 目录只负责 mkdir:初始文件(index.html / design-tokens.css / manifest.json /
 * brief.json)由 host 端在 Design 视图首次打开时播种,避免两处维护同一份模板。
 * @module @calwang414/dsh-ui-design/preset
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getActiveMode } from './active-mode.js'

/** 设计模式预设 id:与 .agent-presets 下的目录名一致。 */
export const DESIGN_PRESET_ID = 'dsh-ui-design'

/** system-prompt 段名与排序(persona 之后、运行时上下文之前)。 */
export const WORKFLOW_SECTION = 'dsh-ui-design.workflow'
export const WORKFLOW_ORDER = 90

/** 网页设计项目的完整工作流契约(Design 视图激活时整体注入)。 */
const DESIGN_WORKFLOW_TEXT = [
  "",
  "## 设计工作流:网页设计(Design 视图)",
  "",
  "本节是 **Design 视图(网页设计项目,`{{cwd}}/design/`)** 的常驻工作流契约,每次网页设计任务都必须遵守;演示文稿(PPT)项目的工作流在 PPT 视图激活时注入。",
  "",
  "## 概念:设计规范 ≠ 模板(布局)",
  "",
  "- **设计规范(品牌主题)** = 整体视觉语言:颜色、字体、圆角、间距、阴影等,全部集中在 `design/design-tokens.css` 的 `--ipw-*` 变量;",
  "- **模板(布局)** = 页面结构与组件样式的 HTML,**不携带品牌规范**——颜色字体一律引用 `var(--ipw-*)`;",
  "- **布局引入不改变规范**:用模板创建新页面时,只引入模板的 HTML 结构,项目的 design-tokens.css **保持不变**(除非用户明确要求换规范);",
  "- 规范随时可通过 Design 视图顶部的**「设计规范」按钮**全局切换(写入 design-tokens.css,全站生效)。",
  "",
  "## 项目结构",
  "",
  "当前工作区有一个**共享网页设计项目**,位于 `{{cwd}}/design/` 目录。所有使用设计模式的会话共享它;用户在对话旁的 **Design 视图**中查看与精调。",
  "",
  "```text",
  "design/",
  "├── manifest.json        项目清单(id、版本、入口、设计令牌声明)",
  "├── index.html           设计入口文件(manifest.entry 指向它)",
  "├── design-tokens.css    设计令牌(--ipw-* CSS 变量),主题统一从这里改",
  "└── brief.json           需求说明,可随迭代更新",
  "```",
  "",
  "## 设计令牌系统",
  "",
  "- 颜色、字体、圆角、阴影、间距等一律通过 `design-tokens.css` 的 `--ipw-*` 变量控制;",
  "- 页面样式引用变量(`var(--ipw-color-primary)` 等),**不要**把具体值硬编码散落在页面里;",
  "- 换主题 = 改令牌,而不是逐元素改样式。",
  "",
  "### 样式必须内联(画布只加载内联样式)",
  "",
  "网页画布用 iframe 渲染页面,**只内联 `design-tokens.css`**(带 `data-ipw-design-tokens` 的 link),其他外部 CSS 一律不加载(相对路径会 404):",
  "",
  "- 页面**所有样式必须写在 HTML 的 `<style>` 内**,不要创建 `app.css` 等额外 CSS 文件;",
  "- 多个页面需要共享样式时,把相同 `<style>` 复制到每个页面;",
  "- 外部资源(图片/字体)用绝对 URL,不要用相对路径(画布 iframe 的基准路径不是项目目录)。",
  "",
  "### 画布注入的类名规则(会被 !important 强制覆盖)",
  "",
  "Studio 会向画布注入主题规则,以下类名/标签的样式会被 token 值**强制覆盖**(无论页面怎么写):",
  "",
  "| 命中元素 | 被强制为 |",
  "|---|---|",
  "| `body[data-ipw-theme-role=\"page\"]` / `.page` / `.shell` / `.app-shell` | 左右内边距 `--ipw-page-padding`、文字色 `--ipw-color-text` |",
  "| `article` / `.card` / `.panel` / `.tile` / `.task` / `[data-ipw-theme-role=\"card\"]` | 卡片底色/边框/阴影/圆角(`--ipw-card-*`) |",
  "| `.primary` / `.cta-primary` / `.button-primary` / `.btn-primary` | 主色底 + `--ipw-color-on-primary` 文字 |",
  "| `.muted` / `.subtle` / `.lede` / `.subtitle` / `.description` | 弱化文字色 `--ipw-color-muted` |",
  "| `.eyebrow` / `.kicker` | 强调色 `--ipw-color-accent` |",
  "",
  "应对:**直接用 token 变量设计这些元素**(被覆盖后视觉一致),或改用不冲突的类名(如 `agent-card`、`hero-title`)。注意 `btn--primary`(双连字符)不匹配 `.btn-primary`,不受影响。`--ipw-color-on-primary` 若未在 tokens 定义,按钮文字色会失效——设计含按钮的页面时在 tokens.css 里定义它。",
  "",
  "## 多页面",
  "",
  "一个项目可以包含多个页面,注册表在 `design/manifest.json` 的 `pages` 字段:",
  "",
  "```json",
  "{",
  "  \"pages\": [",
  "    { \"id\": \"page-1\", \"title\": \"Page 1\", \"entry\": \"index.html\" },",
  "    { \"id\": \"about\", \"title\": \"关于我们\", \"entry\": \"about.html\" }",
  "  ],",
  "  \"entry\": \"index.html\"",
  "}",
  "```",
  "",
  "- `manifest.entry` 恒为**当前活动页**入口,Studio 画布只渲染它;",
  "- Design 视图头部有**页面缩略图条**(横向滚动,点击切换)+ 末尾「+」新建(可空白或选模板布局)+ 编辑模式下可重命名/删除;切换会改写 `entry` 并重载画布;",
  "- **agent 建多页站点的做法**:",
  "  1. 每个页面一个独立 HTML 文件(如 `about.html`),样式统一引用 `design-tokens.css`;",
  "  2. 在 `manifest.json` 的 `pages` 数组注册(id 小写连字符、title 展示名、entry 文件名);",
  "  3. 当前编辑的页面设为 `manifest.entry`(用户切换由 UI 完成);",
  "  4. 页面间可相互链接(相对路径),入口页即预览页;",
  "- 单页项目可无 `pages` 字段(等价 page-1 → entry);建页面前先读 manifest,保持已有页面与令牌契约。",
  "",
  "## 工作流",
  "",
  "0. **先定规范,再谈设计**:动手前先检查 `design/design-tokens.css`——",
  "   - 项目已有规范:直接使用,不修改;",
  "   - 项目还没有规范(新项目):**先向用户推荐一个设计规范**(如 Element+ 企业、自建品牌主题,或从「设计规范」按钮的主题列表中选择一个),确认后写入 design-tokens.css,再开始设计;",
  "   - 用户要求整体换风格时,才更新 design-tokens.css(全站跟随);",
  "1. **先读后写**:动手前先读 `design/manifest.json` 与入口文件,理解现有设计;",
  "2. **新设计需求**:直接在 `design/` 下创建或改写页面 HTML,并保持 manifest.json、design-tokens.css 与入口文件的契约一致;",
  "3. **保持令牌契约**:新样式一律走 `--ipw-*` 变量,可先扩展 design-tokens.css 再引用;",
  "4. **记录迭代**:完成修改后更新 `design/brief.json`,记录需求与本次改动;",
  "5. **协作**:用户在 Design 视图中可选中元素精调,或点 **Ask AI** 让模型修改选区——Ask AI 草稿会携带文件路径与元素定位,按其要求修改即可;",
  "6. **模板(布局)**:用户在顶部「+」选择模板后,会**新增一个页面**(输入页面名称),该页面的 HTML 来自模板布局,**项目的 design-tokens.css 保持不变**;之后按第 1~5 步继续;",
  "7. **完成后自查(review)**:每次设计/修改完成、向用户交付前,按以下清单自查并修复(与 system-prompt 中当前视图注入的清单一致):",
  "   - **令牌一致性**:颜色、字体、圆角、间距、阴影是否全部通过 `var(--ipw-*)` 引用,有没有硬编码的具体值散落在页面里;",
  "   - **令牌完整性**:页面引用的 `--ipw-*` 变量是否都在 design-tokens.css 中定义(缺的补上);",
  "   - **布局与溢出**:页面无横向溢出,移动端(窄视口)布局可用,元素不错位;",
  "   - **文案与占位**:示例文案/占位符(lorem、New Page、Untitled 等)是否已替换为用户需求内容;",
  "   - **多页面一致性**:新增/修改的页面是否已注册在 manifest.pages,`manifest.entry` 是否指向当前活动页;",
  "   - **规范未动**:确认本次修改没有改动 design-tokens.css(除非用户明确要求换规范);",
  "   - 自查发现的问题修复后再交付,并在 brief.json 记录本次改动。",
  "",
  "## 约束",
  "",
  "- `manifest.json` 的 `style` 字段必须是以下枚举之一:`minimal`、`editorial`、`newsprint`、`swiss`、`bold`、`soft`、`pastel`、`glass`、`dark`、`cyber`、`technical`、`playful`、`cinematic`、`data`、`brutalist`、`retro`、`sketch`、`custom`(写其他值会导致 Design 页面加载失败);",
  "- 只修改 `{{cwd}}/design/` 内的文件;",
  "- 除非用户要求整体重设计,否则保持现有结构;",
  "- design/ 被所有设计模式会话共享:保存前先读当前文件,避免覆盖他人的最新修改;",
  "- 多会话并发编辑冲突时,优先保留最新内容并向用户说明。",
  "",
  "## 能力边界",
  "",
  "- 适合:网站、App 原型、海报、信息卡、数据报告、杂志等**非幻灯片**设计(Design 视图);",
  "- 演示文稿/幻灯片(可导出 .pptx/.pdf)的工作流在 PPT 视图激活时注入;",
  "- 不适合:视频(需要独立的视频插件)。"
].join('\n')

/** 演示文稿(PPT)项目的完整工作流契约(PPT 视图激活时整体注入)。 */
const SLIDES_WORKFLOW_TEXT = [
  "",
  "## 设计工作流:演示文稿(PPT 视图)",
  "",
  "本节是 **PPT 视图(演示文稿项目,`{{cwd}}/design/ppt/`,可导出 .pptx/.pdf)** 的常驻工作流契约,每次幻灯片任务都必须遵守;网页设计项目的工作流在 Design 视图激活时注入。",
  "",
  "## 概念:设计规范 ≠ 模板(布局)",
  "",
  "- **设计规范(品牌主题)** = 整体视觉语言:颜色、字体、圆角、间距、阴影等,全部集中在 `design/ppt/design-tokens.css` 的 `--ipw-*` 变量;",
  "- **模板(布局)** = 幻灯片结构与组件样式的 HTML,**不携带品牌规范**——颜色字体一律引用 `var(--ipw-*)`;",
  "- **布局引入不改变规范**:用模板创建新页面时,只引入模板的 HTML 结构,项目的 design-tokens.css **保持不变**(除非用户明确要求换规范);",
  "- 规范随时可通过 PPT 视图顶部的**「设计规范」按钮**全局切换(写入 design-tokens.css,演示全局生效)。",
  "",
  "## 项目结构",
  "",
  "当前工作区有一个**共享演示文稿项目**,位于 `{{cwd}}/design/ppt/` 目录。所有使用设计模式的会话共享它;用户在对话旁的 **PPT 视图**中查看、精调与导出。",
  "",
  "```text",
  "design/ppt/",
  "├── manifest.json        项目清单(id、版本、入口;category 为 slides)",
  "├── index.html           入口文件(manifest.entry 指向它;内含全部幻灯片)",
  "├── design-tokens.css    设计令牌(--ipw-* CSS 变量),主题统一从这里改",
  "└── brief.json           需求说明,可随迭代更新",
  "```",
  "",
  "## 幻灯片结构",
  "",
  "- 画布固定 **1600×900**;每页幻灯片是一个 `.slide`,所有幻灯片放在入口 HTML 的 `.deck` 结构内(Studio 据此渲染上一页/下一页导航);",
  "- 新建幻灯片页面也要保持 slide 结构:1600×900、`data-ipw-slide`,不要用普通网页布局;",
  "- 演示字号保证投影可读(标题、正文、标注层次分明);",
  "- 同一份 deck 中保持视觉语言一致(同色、同字体层级、同留白节奏)。",
  "",
  "## 设计令牌系统",
  "",
  "- 颜色、字体、圆角、阴影、间距等一律通过 `design-tokens.css` 的 `--ipw-*` 变量控制;",
  "- 页面样式引用变量(`var(--ipw-color-primary)` 等),**不要**把具体值硬编码散落在页面里;",
  "- 换主题 = 改令牌,而不是逐元素改样式。",
  "",
  "### 样式必须内联(画布只加载内联样式)",
  "",
  "PPT 画布用 iframe 渲染页面,**只内联 `design-tokens.css`**(带 `data-ipw-design-tokens` 的 link),其他外部 CSS 一律不加载(相对路径会 404):",
  "",
  "- 页面**所有样式必须写在 HTML 的 `<style>` 内**,不要创建 `app.css` 等额外 CSS 文件;",
  "- 外部资源(图片/字体)用绝对 URL,不要用相对路径(画布 iframe 的基准路径不是项目目录)。",
  "",
  "### 画布注入的类名规则(会被 !important 强制覆盖)",
  "",
  "Studio 会向画布注入主题规则,以下类名/标签的样式会被 token 值**强制覆盖**(无论页面怎么写):",
  "",
  "| 命中元素 | 被强制为 |",
  "|---|---|",
  "| `body[data-ipw-theme-role=\"page\"]` / `.page` / `.shell` / `.app-shell` | 左右内边距 `--ipw-page-padding`、文字色 `--ipw-color-text` |",
  "| `article` / `.card` / `.panel` / `.tile` / `.task` / `[data-ipw-theme-role=\"card\"]` | 卡片底色/边框/阴影/圆角(`--ipw-card-*`) |",
  "| `.primary` / `.cta-primary` / `.button-primary` / `.btn-primary` | 主色底 + `--ipw-color-on-primary` 文字 |",
  "| `.muted` / `.subtle` / `.lede` / `.subtitle` / `.description` | 弱化文字色 `--ipw-color-muted` |",
  "| `.eyebrow` / `.kicker` | 强调色 `--ipw-color-accent` |",
  "",
  "应对:**直接用 token 变量设计这些元素**(被覆盖后视觉一致),或改用不冲突的类名。`--ipw-color-on-primary` 若未在 tokens 定义,按钮文字色会失效——设计含按钮的幻灯片时在 tokens.css 里定义它。",
  "",
  "## 导出",
  "",
  "- 演示可导出 **.pptx**(原生可编辑)与 **.pdf**;",
  "- **PPTX 导出要求每个可见元素都被导出计划覆盖**:文字/形状/图片会被转为可编辑的 PowerPoint 对象,未覆盖的可视元素(如不被支持的动效效果)会**阻止导出**而非降级为截图;",
  "- 导出前自查:所有可见元素均可被导出计划覆盖;导出完成后确认文件生成无误。",
  "",
  "## 工作流",
  "",
  "0. **先定规范,再谈设计**:动手前先检查 `design/ppt/design-tokens.css`——",
  "   - 项目已有规范:直接使用,不修改;",
  "   - 项目还没有规范(新项目):**先向用户推荐一个设计规范**(如 Element+ 企业、自建品牌主题,或从「设计规范」按钮的主题列表中选择一个),确认后写入 design-tokens.css,再开始设计;",
  "   - 用户要求整体换风格时,才更新 design-tokens.css(演示全局跟随);",
  "1. **先读后写**:动手前先读 `design/ppt/manifest.json` 与入口文件,理解现有演示结构与设计;",
  "2. **新演示需求**:在 `design/ppt/` 下创建或改写幻灯片 HTML,保持 `.deck`/`.slide` 结构、manifest.json、design-tokens.css 与入口文件的契约一致;",
  "3. **保持令牌契约**:新样式一律走 `--ipw-*` 变量,可先扩展 design-tokens.css 再引用;",
  "4. **记录迭代**:完成修改后更新 `design/ppt/brief.json`,记录需求与本次改动;",
  "5. **协作**:用户在 PPT 视图中可选中元素精调,或点 **Ask AI** 让模型修改选区——Ask AI 草稿会携带文件路径与元素定位,按其要求修改即可;",
  "6. **模板(布局)**:用户在顶部「+」选择模板后,会**新增一个页面**(输入页面名称),该页面的 HTML 来自模板布局,**项目的 design-tokens.css 保持不变**;之后按第 1~5 步继续;",
  "7. **完成后自查(review)**:每次设计/修改完成、向用户交付前,按以下清单自查并修复(与 system-prompt 中当前视图注入的清单一致):",
  "   - **幻灯片结构**:每页均为 `.slide` 结构且 1600×900 无溢出;",
  "   - **令牌一致性/完整性**:颜色、字体、圆角、间距全部通过 `var(--ipw-*)` 引用,无硬编码,引用的变量均已定义;",
  "   - **文案与占位**:示例文案/占位符已替换为演示内容,与 brief 一致;",
  "   - **deck 导航**:上一页/下一页正常,无多余空页,首末页完整;",
  "   - **导出检查**:所有可见元素已被导出计划覆盖,PPTX 导出不会被阻止;",
  "   - **规范未动**:确认本次修改没有改动 design-tokens.css(除非用户明确要求换规范);",
  "   - 自查发现的问题修复后再交付,并在 brief.json 记录本次改动。",
  "",
  "## 约束",
  "",
  "- `manifest.json` 的 `style` 字段必须是以下枚举之一:`minimal`、`editorial`、`newsprint`、`swiss`、`bold`、`soft`、`pastel`、`glass`、`dark`、`cyber`、`technical`、`playful`、`cinematic`、`data`、`brutalist`、`retro`、`sketch`、`custom`(写其他值会导致 PPT 页面加载失败);",
  "- 只修改 `{{cwd}}/design/ppt/` 内的文件(以及共享的令牌/结构契约);",
  "- 除非用户要求整体重设计,否则保持现有结构;",
  "- design/ppt/ 被所有设计模式会话共享:保存前先读当前文件,避免覆盖他人的最新修改;",
  "- 多会话并发编辑冲突时,优先保留最新内容并向用户说明。",
  "",
  "## 能力边界",
  "",
  "- 适合:演示文稿/幻灯片(PPT 视图,可导出 .pptx/.pdf);",
  "- 网站、App 原型、海报、信息卡、数据报告、杂志等非幻灯片设计的工作流在 Design 视图激活时注入;",
  "- 不适合:视频(需要独立的视频插件)。"
].join('\n')

/** 尚未检测到视图时的极简引导(视图打开后由完整契约替换)。 */
const SELF_DETECT_TEXT = [
  "## 设计工作流(设计模式)",
  "",
  "你在设计模式下工作。当前工作区有两个共享项目:普通设计项目位于 {{cwd}}/design/,",
  "幻灯片(PPT)项目位于 {{cwd}}/design/ppt/;所有设计模式会话共享它们。",
  "",
  "当前尚未检测到已打开的视图。开始任务前先读 {{cwd}}/design/manifest.json 与",
  "{{cwd}}/design/ppt/manifest.json 的 category 字段,判断目标项目:网页项目按",
  "「Design 视图」的网页工作流契约执行(Design 视图打开后自动注入完整契约),",
  "演示文稿项目按「PPT 视图」的演示工作流契约执行(PPT 视图打开后自动注入)。",
  "",
  "核心不变量:只修改 {{cwd}}/design/ 内的文件;样式一律通过 design-tokens.css",
  "的 --ipw-* 变量控制;保存前先读当前文件,避免覆盖其他设计模式会话的最新修改。"
].join('\n')

/**
 * 按当前激活视图模式组装工作流提示词:模式确定时注入该模式的完整契约。
 * @param mode - "design" | "slides" | null(未记录)。
 * @returns 完整的工作流段文本。
 */
export function buildWorkflowText(mode) {
  if (mode === 'slides') return SLIDES_WORKFLOW_TEXT
  if (mode === 'design') return DESIGN_WORKFLOW_TEXT
  return SELF_DETECT_TEXT
}

/**
 * 设计模式会话行插件。
 * @param ctx - standing scope 上下文(组合装载一次,加入的 agent 通过作用域继承)。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: WORKFLOW_SECTION,
    order: WORKFLOW_ORDER,
    // 每次模型步骤组装提示词时求值:按用户当前打开的视图注入对应完整工作流。
    text: () => buildWorkflowText(getActiveMode()),
  }), 'dsh-ui-design: workflow prompt section')

  ctx.on('agent/created', ({ agent }) => {
    const header = agent?.session?.header
    const cwd = header?.cwd
    if (!cwd || header?.agentPreset !== DESIGN_PRESET_ID) return
    void mkdir(join(cwd, 'design'), { recursive: true }).catch((error) => {
      ctx.logger.warn?.(`dsh-ui-design: cannot create design dir under ${cwd}: ${String(error)}`)
    })
  })
}

export const inject = ['systemPrompt']
