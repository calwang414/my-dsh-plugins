# 集成设计：页面导出为 PSD / Sketch 设计源文件

> **实现状态（2026-08-20，v3）**：P0 已实现并验证 —— design 模式「下载」菜单提供
> 「导出 Sketch」（html2sketch + JSZip 组装）与「导出 PSD」（分层截图 + ag-psd），
> PPT/slides 模式不提供。输出为**固定目录写入**：客户端把生成文件（base64）经
> Host 新增的 `POST /api/design-source` 写入工作区 `design/[projectId]/output/`
> 固定目录（自动创建，覆盖同名文件），不触发浏览器下载。图标与 PPT 模式一致
> （下载箭头）；菜单项文案「导出 Sketch / 导出 PSD」；成功后 toast 显示保存路径。
> 静态资源：`studio/dist/assets/html2sketch.min.js`、`ag-psd.bundle.js`、
> `jszip-standalone.min.js`、`design-source-export-v7.js`。主 bundle `index-EPv20.js`
> （`window.__dshExportSource(kind)` 入口 + WP 菜单注入 + 10 语言 i18n）。
> Host 侧：`lib/index.js` 新增 `/design-source` 路由（需重启应用生效，由用户执行）。
> 未实现：PSD 语义图层映射（P1）、图层命名语义化（P1）、大文档阈值与降级（P1）。


## 1. 背景与目标

dsh-ui-design 目前支持 HTML / PNG / PDF / PPTX 四种导出，全部是**栅格化或文档化**产物：
PDF/PPTX 把每个 slide 用 html2canvas 截图后拼入文档，HTML 是源码包。用户拿到的是「成品」，
无法在设计工具（Photoshop / Sketch）中继续编辑。

目标：新增「设计源文件」导出族，把 Studio 中编辑的网页页面导出为可编辑的
**PSD（Photoshop）** 与 **Sketch** 源文件，供设计师接手精修。

约束（来自既有约定）：

- 不改动 Studio bundle 的构建体系，仍采用「字符串注入 + 独立 asset 文件」的方式扩展；
- 复用现有导出管线（隐藏 iframe 重建页面）与资源处理逻辑，不重复造轮子；
- 导出是**有损近似**（HTML 流式布局 → 设计工具绝对定位图层树），文档需向用户明示还原度边界。

## 2. 现状盘点（导出管线）

Studio bundle（`studio/dist/assets/index-EPv*.js`）中已有完整导出管线，两个导出函数共享同一套骨架：

```
导出触发
  → 校验预览就绪（Q / Te）
  → 创建隐藏 iframe（position:fixed;left:-100000px）
  → pg() 获取页面源码 → Zh() 生成 srcdoc（含资源 objectUrls）
  → 等待加载（Lw）+ 注入脚本（VVe / Xp 等：主题、字号、资源替换）
  → 锁定视口尺寸（PPT 模式 pa×ua=1600×900，overflow:hidden）
  → 收集 slides（zl = "[data-ipw-slide],section.slide,.slide,.slide-frame"）
  → 逐 slide：激活（Bw）→ html2canvas 截图 → 写入目标格式
  → save() 下载（文件名由 Gw() 生成）→ 清理（revokeObjectURL、移除 iframe、复位 loading）
```

已 vendor 的依赖：`html2canvas-pro.esm-*.js`、`jspdf.es.min-*.js`、`pptxgen.es-*.js`、`jszip.min-*.js`。

导出菜单 i18n 键（`design.export.download*`）：`download` / `download_pdf` / `download_pptx`。

## 3. 技术选型

| 能力 | 选型 | 理由 |
|---|---|---|
| HTML → Sketch JSON | [ant-design/html2sketch](https://github.com/ant-design/html2sketch)（MIT） | 社区最成熟的 DOM→Sketch 遍历器；支持伪元素、径向渐变、文本溢出（html-sketchapp 约 80% 还原，html2sketch 约 95%）；输出严格符合 Sketch File Format 的 JSON；有浏览器 UMD 构建（`dist/html2sketch.min.js`，894 kB） |
| Sketch JSON → .sketch 文件 | **直接 jszip 组装**（bundle 已有 jszip） | .sketch 本质是 zip 包（`document.json` + `pages/<uuid>.json` + `meta.json` + `user.json`），用现有 jszip 即可，不必引入 sketch-json-api 新依赖 |
| HTML → PSD | [ag-psd](https://github.com/Agamnentzar/ag-psd)（MIT） | JS 读写 PSD 的唯一活跃库；浏览器可用（`dist/bundle.js` UMD）；支持图层组、像素图层、文本图层（不完整，见 6.4） |
| DOM → PSD 图层遍历器 | 自研（分 P0/P1 两档） | 社区没有 html2sketch 那样的成熟 DOM→PSD 语义转换器，需要自己写；P0 用现有 html2canvas 做分层截图，P1 做语义映射（见 6.4） |

选型结论：**Sketch 走全语义化路线（html2sketch），PSD 走「P0 分层截图先行、P1 语义映射增强」路线**。
两个库都是独立 UMD 文件，与现有 html2canvas-pro 的 vendor 方式一致（放 `studio/dist/assets/`，
动态 `import()` 按需加载，不增大主 bundle 首包）。

## 4. 总体架构

```
导出菜单「下载」下拉
  ├─ Download PDF          （现有）
  ├─ Download PPTX         （现有）
  ├─ Download Sketch       （新增，design 模式 + slides 模式）
  └─ Download PSD          （新增，design 模式 + slides 模式）

公共管线（复用现有骨架）：
  隐藏 iframe 重建页面 → 锁定视口 → 资源/字体就绪
      │
      ├─ Sketch 分支：nodeToGroup(画布根) → toSketchJSON() → jszip 组装 .sketch → Blob 下载
      └─ PSD 分支：   DOM 图层遍历器 → ag-psd writePsd() → Blob 下载
```

新增独立 chunk：`design-source-export`（内容见第 7 节），内含：

- vendor：`html2sketch.min.js`、`ag-psd bundle.js`（各自独立 asset，动态 import）；
- 遍历/序列化逻辑（Sketch 组装器、PSD 遍历器、文件名生成）。

## 5. 导出入口设计

### 5.1 菜单项

在现有「下载」下拉追加两项，i18n 新增键（en / zh / ja 等各语言字典同步补）：

```
design.export.download_sketch: "Download Sketch" / "下载 Sketch"
design.export.download_psd:    "Download PSD"    / "下载 PSD"
```

菜单项文案上可带副标题提示还原度：`"Editable design source (best-effort fidelity)"` /
「可编辑设计源文件（尽力还原）」。

### 5.2 可见性规则

| 模式 | Sketch | PSD |
|---|---|---|
| design（单页面） | ✅ 导出当前页面 | ✅ 导出当前页面 |
| slides（PPT，deck） | ✅ 每个 slide 一个 Artboard，单文件 | ✅ 每个 slide 一个画布/图层组，单文件 |
| 预览未就绪 | 禁用（与 PDF/PPTX 一致，提示 "Preview is still preparing…"） | 同左 |

slides 模式「每个 slide 一个 Artboard」优于 PPTX 的「每 HTML 文件一个演示文稿」：
Sketch 与 PSD 都原生支持多画布，一次导出拿全片，体验更好。单页模式退化为单 Artboard。

## 6. 详细设计

### 6.1 公共准备（复用现有骨架）

与 PDF/PPTX 共用以下步骤，抽成一个可复用函数（`prepareExportFrame`）：

1. 校验预览就绪；置 loading；
2. 创建隐藏 iframe，`pg()` 取源码 → `Zh()` 生成 srcdoc，注入 objectUrls；
3. 等待加载 + 执行注入脚本（主题/字号/资源替换，沿用 VVe/Xp）；
4. 锁定视口：design 模式按当前页面尺寸（固定为画布实际尺寸，不做 16:9 缩放）；
   slides 模式沿用 pa×ua（1600×900）；
5. `await document.fonts.ready`（Sketch/PSD 文本图层需要字体度量就绪）。

差异点：PDF/PPTX 需要 deck 尺寸锁定与逐 slide 截图；源文件导出**不需要截图**，
只需要「视口尺寸确定 + 字体就绪 + 资源可访问」。

### 6.2 Sketch 导出流程

```
1. 准备 iframe（6.1）
2. 确定画布根节点：
   - design 模式：<body>（或 #app 容器）
   - slides 模式：遍历 zl 收集的 slides，逐个处理
3. 对每个画布：layer = await nodeToGroup(root)
   - nodeToGroup 内部递归遍历子树，输出 Group 对象
4. json = layer.toSketchJSON()   // 严格符合 Sketch File Format
5. 组装 .sketch zip（jszip）：
   - document.json：{ pages: [{_class:"MSJSONFileReference", _ref: pages/<uuid>.json 的引用}] }
   - pages/<uuid>.json：Sketch Page 对象（frame 尺寸=画布尺寸，layers=[json]）
   - meta.json：{ appVersion, build, commit, pagesAndArtboards, version: 195 }
   - user.json：{}
6. zip.generateAsync({type:"blob"}) → 触发下载（文件名 Gw() + ".sketch"）
7. 清理：revokeObjectURL、移除 iframe、复位 loading、成功/失败 toast
```

要点：

- Sketch Page 的 `frame` 必须等于锁定后的画布尺寸（design 模式取实际页面尺寸），
  否则打开后画布被裁剪/留白；
- 多 slide：每 slide 一个 Page（Sketch 一文件多 Page），Page 命名沿用 slide 标题
  （现有 deck.title 逻辑）；
- 图片节点：html2sketch 对 `<img>`/背景图生成图片图层，资源需以 dataURL 或可跨域
  URL 形式存在——沿用现有 objectUrls 资源替换，保证 iframe 内图片可读；
- 图层命名：html2sketch 默认用 DOM 结构生成；可传 onLayerCreated 钩子把
  `data-ipw-*` 或 class 名写入图层名，便于设计师定位（增强项，P1）。

### 6.3 PSD 导出流程

#### P0（先行）：分层截图

```
1. 准备 iframe（6.1）
2. 遍历画布内可见元素（skip 无样式/透明/display:none），按 DOM 深度排序
   - 过滤：script/style/svg 内部、data-ipw-deck-control、aria-hidden 控件
3. 每个元素：html2canvas 单独截图（whiteBackground:false → 透明底）
   - 用元素 rect 裁剪，canvas 尺寸 = rect 尺寸
4. 组装 ag-psd 文档：
   psd = {
     width, height（画布尺寸）,
     children: [
       { name, left, top, right, bottom, canvas: 元素截图 canvas,
         blendMode:"normal", opacity, hidden:false },
       ... 按 DOM 顺序（视觉上后绘制的在上）
     ]
   }
5. writePsd(psd, { generateThumbnail:true }) → ArrayBuffer → Blob 下载
6. 清理与 toast（同 6.2）
```

P0 特性：还原度接近像素级（就是截图），但图层不可语义编辑（文本是图片）、
文件大、层数 = 可见元素数（可加「最大层数」上限与合并策略）。

#### P1（增强）：语义图层映射

借鉴 html2sketch 的解析思路自研 `domToPsdLayers(root)`：

- 每个元素 → 一个图层（或按块合并）：
  - `getBoundingClientRect()` → left/top/right/bottom（相对画布原点）；
  - `getComputedStyle()` → 背景色（渐变降级为色块或 P0 截图）、边框（矩形+描边）、
    圆角（ag-psd 形状图层不支持圆角路径，降级为像素或忽略）、阴影（降级）；
  - 文本节点：ag-psd `text` 字段 + TextStyle（字体/字号/颜色/行高），
    `writePsd` 时带 `invalidateTextLayers:true`，Photoshop 打开时按样式重绘文本；
  - `<img>`/背景图：像素图层（canvas 绘制），避免 node-canvas 依赖；
- 图层分组：按 DOM 层级生成图层组（`children` 嵌套），命名用 class/`data-ipw-*`；
- 还原度边界：flex/grid 已拍平成绝对坐标；渐变/滤镜/伪元素/动画不还原（记入文档）。

P1 收益：文本与色块可编辑，文件小；代价：自研遍历器工作量大、还原度需逐模板校准。
**建议先交付 P0，P1 作为后续迭代**（Sketch 因 html2sketch 成熟可直接上语义化）。

### 6.4 资源、字体与主题

- 资源：沿用现有 `objectUrls`（ae 数组）替换逻辑，iframe 内所有图片/字体可本地访问；
  完成后统一 `revokeObjectURL`（现有 finally 已做，源文件导出沿用同一 finally）；
- 字体：`await document.fonts.ready` 后再遍历；Sketch 文本图层需要真实字体度量；
- 主题：沿用注入脚本（Xp/VVe）确保 iframe 内样式与 Studio 预览一致；
  深色 iframe（theme=dark 参数）下导出的图层颜色即所见所得。

### 6.5 文件命名与下载

- 复用 `Gw(xs, U)` 生成基名（标题 + 时间戳），追加 `.sketch` / `.psd` 后缀；
- 下载：Sketch 用 `zip.generateAsync({type:"blob"})`；PSD 用
  `new Blob([writePsd(psd)], {type:"application/octet-stream"})`；
  两者都走现有 `save()` 下载链路（或 a[download] + URL.createObjectURL）。

### 6.6 错误处理与状态

- 与现有导出一致：`try/catch` → `Hs.error(message)`（"Could not export this design source."）；
- 空画布（无可导出内容）→ 抛 "No design content was found in this page."（对应现有
  "No slides were found…" 的语义）；
- loading 标志（Xo）贯穿整个导出，防止重复触发；
- 大页面保护：Sketch JSON 体积 > 阈值（如 50 MB）或 PSD 图层数 > 上限（如 500）
  时提示用户或提供「仅导出首屏/当前 slide」降级选项（P1 增强）。

## 7. 模块与代码位置

| 位置 | 内容 |
|---|---|
| `studio/dist/assets/html2sketch.min.js` | vendor（ant-design/html2sketch@1.0.2，UMD，894 kB） |
| `studio/dist/assets/ag-psd.bundle.js` | vendor（ag-psd，UMD） |
| `studio/dist/assets/design-source-export-*.js` | 新 chunk：`exportSketch()` / `exportPsd()` 两个导出函数 + 公共 `prepareExportFrame` 抽取 + `buildSketchZip()` / `buildPsdDoc()` 序列化器 |
| `studio/dist/index.html` | 无改动（chunk 通过动态 import 引用） |
| `studio/dist/assets/index-EPv*.js` | 字符串注入：①「下载」下拉加两项菜单；② i18n 字典各语言加 `download_sketch`/`download_psd` 键；③ 原 PPTX/PDF 函数体中的公共步骤抽到 `prepareExportFrame`（若抽函数成本高，则新函数内复制公共步骤并保持一致，P0 允许复制） |
| `lib/index.js` | 无改动（导出全部在客户端完成，与 PPTX/PDF 一致） |
| `docs/design-source-export.md` | 本文档；还原度边界说明同步进插件 README |

文件名带内容哈希（沿用 `*-*.js` 命名），改版改名绕缓存（`cache-control: max-age=86400`）。

## 8. 还原度边界（必须对用户明示）

| 能力 | Sketch（html2sketch） | PSD P0（分层截图） | PSD P1（语义映射） |
|---|---|---|---|
| 布局坐标/尺寸 | ✅ 近似还原 | ✅ 像素级 | ✅ 近似还原 |
| 文本可编辑 | ✅ 原生文本图层 | ❌ 图片 | ⚠️ 文本图层（PS 打开时重绘） |
| 渐变/阴影 | ✅ 大部分 | ✅ 像素级 | ❌ 降级为色块/忽略 |
| 伪元素/溢出 | ✅ 支持 | ✅ 像素级 | ❌ 不支持 |
| 图片 | ✅ 图片图层 | ✅ 像素图层 | ✅ 像素图层 |
| flex/grid 语义 | ❌ 拍平为绝对坐标 | ✅ 视觉保留 | ❌ 拍平 |
| 动画/交互 | ❌ | ❌（静态帧） | ❌ |
| 响应式断点 | ❌（按当前视口） | ❌（按当前视口） | ❌（按当前视口） |

通用声明：导出的是**当前视口、当前状态**的静态设计稿；复杂动效、交互、响应式布局
不会出现在源文件中。Sketch 还原度显著高于 PSD P0 的「可编辑性」，但 P0 视觉保真最高。

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| html2sketch 对部分 CSS 解析不准（如复杂 clip-path、混合模式） | Sketch 还原度下降 | 文档声明边界；解析用例对齐 ant-design 的 e2e 用例清单（伪元素/渐变/溢出已覆盖） |
| ag-psd 文本图层不完整（写文本层后 PS 打开有警告提示重绘） | PSD 文本体验 | 默认 `invalidateTextLayers:true` 强制 PS 重绘；P0 阶段文本走截图无此问题 |
| 大页面图层爆炸（PSD 层数、Sketch JSON 体积） | 性能/文件过大 | 图层数/体积阈值 + 降级提示（6.6）；P0 提供「合并子元素」选项 |
| 图片跨域/资源加载失败 | 图层缺图 | 现有 objectUrls 已本地化资源；失败图片回退为占位矩形 + 警告 toast |
| 深色/浅色主题差异导致导出颜色与预期不符 | 颜色偏差 | 导出沿用当前 iframe 主题（所见即所得），文档声明 |
| 多 slide 大 deck 一次导出过慢 | 等待时间长 | loading 态 + 进度提示（P1）；允许「仅当前 slide」导出 |

## 10. 实施阶段

**P0（可交付）**

1. vendor html2sketch / ag-psd 到 `studio/dist/assets/`（acorn 校验语法、确认 UMD 全局名）；
2. 新 chunk `design-source-export`：`prepareExportFrame`（复制现有公共步骤）+ `exportSketch`（html2sketch + jszip 组装）+ `exportPsd`（分层截图）；
3. bundle 注入：导出菜单两项 + i18n 键 + 事件接线；
4. design 模式验证：单页面 → .sketch / .psd 可打开、尺寸正确、文本可编辑（Sketch）；
5. slides 模式验证：deck 多 slide → 多 Page / 多画布；
6. 还原度边界写入 README；
7. 缓存规避：新文件名哈希、bundle 版本号递增。

**P1（增强，视反馈决定）**

1. PSD 语义图层映射（`domToPsdLayers`）：文本/色块/描边可编辑；
2. 图层命名语义化（class / data-ipw-* → 图层名）；
3. 大文档阈值与「仅当前 slide」降级；
4. 多语言菜单文案补全。

## 11. 验收标准

- [ ] design 模式导出的 .sketch 可在 Sketch 打开，画布尺寸 = 页面实际尺寸，文本/图片/色块为可编辑图层；
- [ ] slides 模式导出的 .sketch 每 slide 一个 Page，标题正确；
- [ ] design 模式导出的 .psd（P0）可在 Photoshop 打开，图层顺序与 DOM 顺序一致，缩略图正常；
- [ ] 导出失败（无内容/预览未就绪）有明确 toast，不白屏、不残留 iframe；
- [ ] 导出期间 loading 态阻止重复触发；完成后资源 URL 全部 revoke；
- [ ] 深色模式下导出颜色与预览一致；
- [ ] 新 bundle 文件名带版本哈希，刷新后生效（无缓存旧代码）。
