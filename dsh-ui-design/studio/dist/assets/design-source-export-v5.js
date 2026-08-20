// design-source-export-v1.js
// design 模式导出 Sketch / PSD 设计源文件（纯前端，浏览器内完成）
// 由主 bundle 注入的 window.__dshExportSource(kind) 动态 import 调用。
// 依赖同目录 assets：html2sketch.min.js、ag-psd.bundle.js、html2canvas-pro.esm-*.js、jszip.min-*.js

const HTML2CANVAS_ASSET = "./html2canvas-pro.esm-B_YVa8SZ.js";
const JSZIP_ASSET = "./jszip-standalone.min.js";

const COLOR_PROPS = [
  "color", "background-color", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "outline-color",
  "text-decoration-color", "column-rule-color", "caret-color",
  "fill", "stroke", "stop-color", "flood-color", "lighting-color",
];
const COMPLEX_PROPS = ["background-image", "box-shadow", "text-shadow"];

// CSS Color 4: color(srgb r g b [ / a]) -> rgba()
function normColor(v) {
  const m = v.match(/^color\(\s*(srgb|srgb-linear)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (!m) return null;
  const a = m[5] !== undefined ? (m[5].endsWith("%") ? parseFloat(m[5]) / 100 : parseFloat(m[5])) : 1;
  const f = (x) => Math.round(Math.min(1, Math.max(0, parseFloat(x))) * 255);
  return `rgba(${f(m[2])},${f(m[3])},${f(m[4])},${a})`;
}

// html2sketch/ag-psd 不认识 color-mix 计算后的 color(srgb ...)，
// 遍历元素把现代颜色语法烘焙成 rgba 内联样式。
function bakeColors(doc) {
  let n = 0;
  doc.querySelectorAll("*").forEach((el) => {
    const cs = doc.defaultView.getComputedStyle(el);
    for (const p of COLOR_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v.indexOf("color(") === 0) {
        const r = normColor(v);
        if (r) { el.style.setProperty(p, r, "important"); n++; }
      }
    }
    for (const p of COMPLEX_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v.includes("color(")) {
        const r = v.replace(/color\((srgb|srgb-linear)[^)]*\)/gi, (m) => normColor(m) || m);
        el.style.setProperty(p, r, "important"); n++;
      }
    }
  });
  return n;
}

function waitLoaded(frame) {
  return new Promise((resolve, reject) => {
    if (frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.children.length > 0) {
      resolve();
      return;
    }
    frame.addEventListener("load", () => resolve(), { once: true });
    setTimeout(() => reject(new Error("Timed out waiting for the design preview.")), 15000);
  });
}

function previewInfo() {
  const f = document.querySelector('iframe[title^="Design preview"]');
  if (!f) throw new Error("Design preview not found.");
  const title = (f.getAttribute("title") || "design")
    .replace(/^Design preview:\s*/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim() || "design";
  return { frame: f, src: f.getAttribute("srcdoc") || "", title };
}

function uuid() {
  const h = () => Math.random().toString(16).slice(2, 10);
  return (h() + h() + "-" + h() + "-4" + h().slice(0, 3) + "-a" + h().slice(0, 3) + "-" + h() + h()).toUpperCase();
}

function rand(len) {
  let s = "";
  const chars = "abcdef0123456789";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function loadHtml2canvas() {
  const m = await import(HTML2CANVAS_ASSET);
  return m.default || m;
}

async function loadJSZip() {
  await import(JSZIP_ASSET);
  return window.JSZip;
}

// 重建预览页面到无 sandbox 的隐藏 iframe，返回可操作 DOM
async function prepareFrame() {
  const { frame: preview, src, title } = previewInfo();
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-100000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none";
  document.body.append(frame);
  try {
    frame.srcdoc = src;
    await waitLoaded(frame);
    const doc = frame.contentDocument;
    if (!doc || !doc.body) throw new Error("Could not prepare the design preview.");
    const w = Math.max(preview.offsetWidth, 1);
    const h = Math.max(preview.offsetHeight, 1);
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    doc.documentElement.style.width = w + "px";
    doc.body.style.width = w + "px";
    doc.body.style.margin = "0";
    doc.querySelectorAll("[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next']").forEach((el) => el.remove());
    bakeColors(doc);
    await doc.fonts.ready;
    const win = frame.contentWindow;
    return { frame, doc, win, title, width: Math.max(1, doc.body.scrollWidth), height: Math.max(1, doc.body.scrollHeight) };
  } catch (e) {
    frame.remove();
    throw e;
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---- Sketch ----

async function exportSketch(ctx) {
  await import("./html2sketch.min.js");
  const api = window.html2sketch;
  const group = await api.nodeToGroup(ctx.doc.body);
  const groupJson = group.toSketchJSON();
  const pageId = uuid();
  const page = Object.assign({}, groupJson, {
    _class: "page",
    do_objectID: pageId,
    name: ctx.title,
    frame: { _class: "rect", constrainProportions: false, height: ctx.height, width: ctx.width, x: 0, y: 0 },
  });
  const documentJson = {
    _class: "document",
    do_objectID: uuid(),
    pages: [{ _class: "MSJSONFileReference", _ref_class: "MSImmutablePage", _ref: "pages/" + pageId }],
    assets: {
      _class: "assetCollection",
      colors: [],
      gradients: [],
      imageCollection: { _class: "imageCollection", images: {} },
      images: [],
    },
    colorSpace: 0,
    currentPageIndex: 1,
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    layerStyles: { _class: "sharedStyleContainer", objects: [] },
    layerTextStyles: { _class: "sharedTextStyleContainer", objects: [] },
  };
  const commit = rand(40);
  const metaJson = {
    commit,
    pagesAndArtboards: { [pageId]: { name: ctx.title, artboards: {} } },
    version: 130,
    fonts: [],
    compatibilityVersion: 99,
    app: "com.bohemiancoding.sketch3",
    autosaved: 0,
    variant: "NONAPPSTORE",
    created: {
      commit,
      appVersion: "66.1",
      build: 97080,
      app: "com.bohemiancoding.sketch3",
      compatibilityVersion: 99,
      version: 130,
      variant: "NONAPPSTORE",
    },
    saveHistory: ["NONAPPSTORE.97080"],
    appVersion: "66.1",
    build: 97080,
  };
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file("document.json", JSON.stringify(documentJson));
  zip.file("meta.json", JSON.stringify(metaJson));
  zip.file("user.json", "{}");
  zip.file("pages/" + pageId + ".json", JSON.stringify(page));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, ctx.title + ".sketch");
}

// ---- PSD（P0：分层截图）----

const MAX_LAYERS = 400;

function layerName(el) {
  if (el.id) return el.id;
  const cls = (el.className && typeof el.className === "string" ? el.className : "");
  if (cls) return cls.split(/\s+/).slice(0, 2).join(" ");
  return el.tagName.toLowerCase();
}

function visibleElements(doc) {
  const win = doc.defaultView;
  const out = [];
  doc.querySelectorAll("body *").forEach((el) => {
    if (el.closest("script,style,svg,template")) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    out.push(el);
  });
  return out;
}

async function exportPsd(ctx) {
  const html2canvas = await loadHtml2canvas();
  await import("./ag-psd.bundle.js");
  const agPsd = window.agPsd;
  const win = ctx.win;
  const layers = [];
  // 背景层（html 元素承载页面背景）
  const bgEl = ctx.doc.documentElement;
  const bgRect = bgEl.getBoundingClientRect();
  const bgCanvas = await html2canvas(bgEl, {
    backgroundColor: "#ffffff",
    scale: 1,
    useCORS: true,
    logging: false,
    width: ctx.width,
    height: ctx.height,
    windowWidth: ctx.width,
    windowHeight: ctx.height,
  });
  layers.push({
    name: "background",
    left: Math.round(bgRect.left),
    top: Math.round(bgRect.top),
    right: Math.round(bgRect.left + bgRect.width),
    bottom: Math.round(bgRect.top + bgRect.height),
    canvas: bgCanvas,
    blendMode: "normal",
    opacity: 1,
  });
  const els = visibleElements(ctx.doc);
  const sliced = els.slice(0, MAX_LAYERS);
  for (const el of sliced) {
    const r = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    const canvas = await html2canvas(el, {
      backgroundColor: null,
      scale: 1,
      useCORS: true,
      logging: false,
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(r.height)),
      windowWidth: ctx.width,
      windowHeight: ctx.height,
    });
    layers.push({
      name: layerName(el),
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.left + r.width),
      bottom: Math.round(r.top + r.height),
      canvas,
      blendMode: "normal",
      opacity: cs.opacity === "" ? 1 : parseFloat(cs.opacity),
    });
  }
  const psd = { width: ctx.width, height: ctx.height, children: layers };
  const buffer = agPsd.writePsd(psd, { generateThumbnail: true });
  downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), ctx.title + ".psd");
}

// ---- 入口 ----

export async function exportDesignSource(kind) {
  const ctx = await prepareFrame();
  try {
    if (kind === "sketch") {
      await exportSketch(ctx);
    } else if (kind === "psd") {
      await exportPsd(ctx);
    } else {
      throw new Error("Unknown design source kind: " + kind);
    }
  } finally {
    ctx.frame.remove();
  }
}
