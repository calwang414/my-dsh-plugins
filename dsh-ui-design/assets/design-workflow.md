# design-workflow

DeepSeek Harness **设计模式**的可视化设计工作流契约。进入设计模式后、开始任何设计任务前,先读本技能。

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
- Design 视图头部有页面切换器(下拉 + 新建/移除),切换会改写 `entry` 并重载画布;
- **agent 建多页站点的做法**:
  1. 每个页面一个独立 HTML 文件(如 `about.html`),样式统一引用 `design-tokens.css`;
  2. 在 `manifest.json` 的 `pages` 数组注册(id 小写连字符、title 展示名、entry 文件名);
  3. 当前编辑的页面设为 `manifest.entry`(用户切换由 UI 完成);
  4. 页面间可相互链接(相对路径),入口页即预览页;
- 单页项目可无 `pages` 字段(等价 page-1 → entry);建页面前先读 manifest,保持已有页面与令牌契约。

## 工作流

1. **先读后写**:动手前先读 `design/manifest.json` 与入口文件,理解现有设计;
2. **新设计需求**:直接在 `design/` 下创建或改写 `index.html`,并保持 manifest.json、design-tokens.css 与入口文件的契约一致;
3. **保持令牌契约**:新样式一律走 `--ipw-*` 变量,可先扩展 design-tokens.css 再引用;
4. **记录迭代**:完成修改后更新 `design/brief.json`,记录需求与本次改动;
5. **协作**:用户在 Design 视图中可选中元素精调,或点 **Ask AI** 让模型修改选区——Ask AI 草稿会携带文件路径与元素定位,按其要求修改即可;
6. **模板**:用户从模板市场选模板后,项目目录会被模板整体替换,之后按第 1~5 步继续。

## 约束

- 只修改 `{{cwd}}/design/` 内的文件;
- 除非用户要求整体重设计,否则保持现有结构;
- design/ 被所有设计模式会话共享:保存前先读当前文件,避免覆盖他人的最新修改;
- 多会话并发编辑冲突时,优先保留最新内容并向用户说明。

## 能力边界

- 适合:网站、App 原型、海报、信息卡、数据报告、杂志等非幻灯片设计(Design 视图),以及演示文稿/幻灯片(PPT 视图,可导出 .pptx / .pdf);
- 不适合:视频(需要独立的视频插件)。
