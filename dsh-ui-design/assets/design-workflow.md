# design-workflow

DeepSeek Harness **设计模式**的可视化设计工作流契约。进入设计模式后、开始任何设计任务前,先读本技能。

## 概念:设计规范 ≠ 模板(布局)

- **设计规范(品牌主题)** = 整体视觉语言:颜色、字体、圆角、间距、阴影等,全部集中在 `design/design-tokens.css` 的 `--ipw-*` 变量;
- **模板(布局)** = 页面结构与组件样式的 HTML,**不携带品牌规范**——颜色字体一律引用 `var(--ipw-*)`;
- **布局引入不改变规范**:用模板创建新页面时,只引入模板的 HTML 结构,项目的 design-tokens.css **保持不变**(除非用户明确要求换规范);
- 规范随时可通过 Design 视图顶部的**「设计规范」按钮**全局切换(写入 design-tokens.css,全站生效)。

## 项目结构

当前工作区有一个**共享设计项目**,位于 `{{cwd}}/design/` 目录。所有使用设计模式的会话共享它;用户在对话旁的 **Design 视图**中查看与精调。

```text
design/
├── manifest.json        项目清单(id、版本、入口、设计令牌声明)
├── index.html           设计入口文件(manifest.entry 指向它)
├── design-tokens.css    设计令牌(--ipw-* CSS 变量),主题统一从这里改
└── brief.json           需求说明,可随迭代更新
```

幻灯片(PPT)是独立的**共享演示项目**,位于 `{{cwd}}/design/ppt/`,结构同上(manifest 的 surface 为 slides,入口 html 内每页是一个 .slide,1600×900 画布),用户在对话旁的 **PPT 视图**中查看、精调与导出。

## 设计令牌系统

- 颜色、字体、圆角、阴影、间距等一律通过 `design-tokens.css` 的 `--ipw-*` 变量控制;
- 页面样式引用变量(`var(--ipw-color-primary)` 等),**不要**把具体值硬编码散落在页面里;
- 换主题 = 改令牌,而不是逐元素改样式。

### 样式必须内联(画布只加载内联样式)

Design/PPT 画布用 iframe 渲染页面,**只内联 `design-tokens.css`**(带 `data-ipw-design-tokens` 的 link),其他外部 CSS 一律不加载(相对路径会 404):

- 页面**所有样式必须写在 HTML 的 `<style>` 内**,不要创建 `app.css` 等额外 CSS 文件;
- 多个页面需要共享样式时,把相同 `<style>` 复制到每个页面;
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

应对:**直接用 token 变量设计这些元素**(被覆盖后视觉一致),或改用不冲突的类名(如 `agent-card`、`hero-title`)。注意 `btn--primary`(双连字符)不匹配 `.btn-primary`,不受影响。`--ipw-color-on-primary` 若未在 tokens 定义,按钮文字色会失效——设计含按钮的页面时在 tokens.css 里定义它。

## 多页面

一个项目可以包含多个页面,注册表在 `design/manifest.json` 的 `pages` 字段:

```json
{
  "pages": [
    { "id": "page-1", "title": "Page 1", "entry": "index.html" },
    { "id": "about", "title": "关于我们", "entry": "about.html" }
  ],
  "entry": "index.html"
}
```

- `manifest.entry` 恒为**当前活动页**入口,Studio 画布只渲染它;
- Design 视图头部有**页面缩略图条**(横向滚动,点击切换)+ 末尾「+」新建(可空白或选模板布局)+「−」移除;切换会改写 `entry` 并重载画布;
- **agent 建多页站点的做法**:
  1. 每个页面一个独立 HTML 文件(如 `about.html`),样式统一引用 `design-tokens.css`;
  2. 在 `manifest.json` 的 `pages` 数组注册(id 小写连字符、title 展示名、entry 文件名);
  3. 当前编辑的页面设为 `manifest.entry`(用户切换由 UI 完成);
  4. 页面间可相互链接(相对路径),入口页即预览页;
- 单页项目可无 `pages` 字段(等价 page-1 → entry);建页面前先读 manifest,保持已有页面与令牌契约。

## 工作流

0. **先定规范,再谈设计**:动手前先检查 `design/design-tokens.css`——
   - 项目已有规范:直接使用,不修改;
   - 项目还没有规范(新项目):**先向用户推荐一个设计规范**(如 Element+ 企业、自建品牌主题,或从「设计规范」按钮的主题列表中选择一个),确认后写入 design-tokens.css,再开始设计;
   - 用户要求整体换风格时,才更新 design-tokens.css(全站跟随);
1. **先读后写**:动手前先读 `design/manifest.json` 与入口文件,理解现有设计;
2. **新设计需求**:直接在 `design/` 下创建或改写页面 HTML,并保持 manifest.json、design-tokens.css 与入口文件的契约一致;
3. **保持令牌契约**:新样式一律走 `--ipw-*` 变量,可先扩展 design-tokens.css 再引用;
4. **记录迭代**:完成修改后更新 `design/brief.json`,记录需求与本次改动;
5. **协作**:用户在 Design 视图中可选中元素精调,或点 **Ask AI** 让模型修改选区——Ask AI 草稿会携带文件路径与元素定位,按其要求修改即可;
6. **模板(布局)**:用户在顶部「+」选择模板后,会**新增一个页面**(输入页面名称),该页面的 HTML 来自模板布局,**项目的 design-tokens.css 保持不变**;之后按第 1~5 步继续;
7. **完成后自查(review)**:每次设计/修改完成、向用户交付前,按以下清单自查并修复:
   - **令牌一致性**:颜色、字体、圆角、间距、阴影是否全部通过 `var(--ipw-*)` 引用,有没有硬编码的具体值散落在页面里;
   - **令牌完整性**:页面引用的 `--ipw-*` 变量是否都在 design-tokens.css 中定义(缺的补上);
   - **布局与溢出**:页面无横向溢出,移动端(窄视口)布局可用,元素不错位;
   - **文案与占位**:示例文案/占位符(lorem、New Page、Untitled 等)是否已替换为用户需求内容;
   - **多页面一致性**:新增/修改的页面是否已注册在 manifest.pages,`manifest.entry` 是否指向当前活动页;
   - **规范未动**:确认本次修改没有改动 design-tokens.css(除非用户明确要求换规范);
   - 自查发现的问题修复后再交付,并在 brief.json 记录本次改动。

## 约束

- `manifest.json` 的 `style` 字段必须是以下枚举之一:`minimal`、`editorial`、`newsprint`、`swiss`、`bold`、`soft`、`pastel`、`glass`、`dark`、`cyber`、`technical`、`playful`、`cinematic`、`data`、`brutalist`、`retro`、`sketch`、`custom`(写其他值会导致 Design 页面加载失败);
- 只修改 `{{cwd}}/design/` 内的文件;
- 除非用户要求整体重设计,否则保持现有结构;
- design/ 被所有设计模式会话共享:保存前先读当前文件,避免覆盖他人的最新修改;
- 多会话并发编辑冲突时,优先保留最新内容并向用户说明。

## 能力边界

- 适合:网站、App 原型、海报、信息卡、数据报告、杂志等非幻灯片设计(Design 视图),以及演示文稿/幻灯片(PPT 视图,可导出 .pptx / .pdf);
- 不适合:视频(需要独立的视频插件)。
