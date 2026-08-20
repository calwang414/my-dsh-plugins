/**
 * 设计模式会话行:挂在设计模式的 agent.cordis.yml 组合里,随预设的 standing
 * scope 装载一次。三个职责:
 *
 * 1. 向 system-prompt 注册「设计工作流」段,让该模式下的模型知道共享设计项目
 *    的契约(design/ 目录、manifest/入口/令牌文件、工作流与约束);
 * 2. 按「当前激活视图模式」动态注入差异化约束与自查清单:host 端记录用户
 *    正在查看 Design 视图还是 PPT 视图,每次组装提示词时读取并按模式分支
 *    (网页项目:多页面/响应式;PPT 项目:1600×900 slide 结构/导出限制);
 * 3. 监听 `agent/created`,当新 agent 的会话以设计模式创建时,确保其工作区
 *    根目录下存在 `design/` 目录(「选择设计模式即自动建目录」)。
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

/** 双项目通用基础段:项目位置、令牌契约、先读后写、规范与布局分离。 */
const COMMON_WORKFLOW_TEXT = [
  '## 设计工作流(设计模式)',
  '',
  '你在设计模式下工作。当前工作区有两个共享项目:普通设计项目位于 {{cwd}}/design/,',
  '幻灯片(PPT)项目位于 {{cwd}}/design/ppt/;所有使用设计模式的会话共享它们,',
  '用户在对话旁的 Design 视图(普通设计)与 PPT 视图(幻灯片,可导出 .pptx/.pdf)',
  '中查看与精调。',
  '',
  '开始任何设计任务前,先加载技能目录中的 `design-workflow` 技能,按其中的',
  '项目结构、设计令牌与工作流契约执行。核心不变量:只修改 {{cwd}}/design/ 内',
  '的文件;样式一律通过 design-tokens.css 的 --ipw-* 变量控制;保存前先读',
  '当前文件,避免覆盖其他设计模式会话的最新修改。',
  '',
  '设计规范与布局分离:design-tokens.css 是全局设计规范(品牌主题),模板只是',
  '页面布局。新项目没有设计规范时,先向用户推荐并写入一个设计规范,再开始',
  '设计;引入模板布局时不得改动 design-tokens.css。',
].join('\n')

/** 网页设计项目的差异化约束(Design 视图,manifest.category 非 slides)。 */
const DESIGN_PROJECT_TEXT = [
  '',
  '## 当前项目:网页设计(Design 视图)',
  '你正在处理 {{cwd}}/design/ 下的网页设计项目(manifest.category 非 slides)。',
  '',
  '网页项目专属约束:',
  '- 页面为普通网页 HTML,需要响应式适配窄视口(移动端布局可用);',
  '- 多页面:每页一个独立 HTML 文件,注册到 manifest.pages,',
  '  manifest.entry 恒为当前活动页入口;',
  '- 页面之间可相对链接,入口页即预览页。',
].join('\n')

/** 网页设计项目的完成后自查(review)清单。 */
const DESIGN_REVIEW_TEXT = [
  '',
  '网页项目完成后自查(review):',
  '- 令牌一致性:颜色、字体、圆角、间距、阴影全部通过 var(--ipw-*) 引用,无硬编码;',
  '- 令牌完整性:页面引用的 --ipw-* 变量都已在 design-tokens.css 中定义;',
  '- 布局无横向溢出,窄视口下不错位;',
  '- 文案无占位符残留(lorem、New Page、Untitled 等);',
  '- 新增/修改的页面已注册在 manifest.pages,entry 指向当前活动页;',
  '- 未意外改动 design-tokens.css(除非用户明确要求换规范)。',
  '- 发现问题修复后再交付,并在 brief.json 记录本次改动。',
].join('\n')

/** 演示文稿(PPT)项目的差异化约束(PPT 视图,manifest.category 为 slides)。 */
const SLIDES_PROJECT_TEXT = [
  '',
  '## 当前项目:演示文稿(PPT 视图)',
  '你正在处理 {{cwd}}/design/ppt/ 下的演示文稿项目(manifest.category 为 slides)。',
  '',
  'PPT 项目专属约束:',
  '- 画布固定 1600×900,每页是一个 .slide,所有幻灯片放在入口 HTML 的',
  '  .deck 结构内(Studio 据此渲染 deck 导航);',
  '- 新建幻灯片页面也要保持 slide 结构(1600×900,data-ipw-slide),',
  '  不要用普通网页布局;',
  '- 内容可导出 .pptx/.pdf;PPTX 导出要求每个可见元素都被导出计划覆盖,',
  '  未覆盖的可视元素会阻止导出,需先自查覆盖情况;',
  '- 保持每页 1600×900 无溢出,演示字号保证投影可读。',
].join('\n')

/** 演示文稿(PPT)项目的完成后自查(review)清单。 */
const SLIDES_REVIEW_TEXT = [
  '',
  'PPT 项目完成后自查(review):',
  '- 每页均为 .slide 结构且 1600×900 无溢出;',
  '- 令牌一致性/完整性:颜色、字体、圆角、间距全部通过 var(--ipw-*) 引用,',
  '  引用的变量都已定义;',
  '- 文案无占位符残留,演示内容与 brief 一致;',
  '- deck 导航正常(上一页/下一页无多余空页),首末页完整;',
  '- 导出检查:所有可见元素已被导出计划覆盖,PPTX 导出不会被阻止;',
  '- 未意外改动 design-tokens.css(除非用户明确要求换规范)。',
  '- 发现问题修复后再交付,并在 brief.json 记录本次改动。',
].join('\n')

/** 尚未检测到视图时的引导段:按 manifest 自行判断目标项目。 */
const SELF_DETECT_TEXT = [
  '',
  '当前尚未检测到已打开的视图。开始任务前先读 {{cwd}}/design/manifest.json 与',
  '{{cwd}}/design/ppt/manifest.json 的 category 字段,判断目标项目后,按对应项目',
  '的约束与自查清单执行:网页项目按「多页面/响应式」要求,PPT 项目按',
  '「1600×900 slide 结构/导出覆盖」要求。',
].join('\n')

/**
 * 按当前激活视图模式组装工作流提示词。
 * @param mode - "design" | "slides" | null(未记录)。
 * @returns 完整的工作流段文本。
 */
export function buildWorkflowText(mode) {
  const parts = [COMMON_WORKFLOW_TEXT]
  if (mode === 'slides') {
    parts.push(SLIDES_PROJECT_TEXT, SLIDES_REVIEW_TEXT)
  } else if (mode === 'design') {
    parts.push(DESIGN_PROJECT_TEXT, DESIGN_REVIEW_TEXT)
  } else {
    parts.push(SELF_DETECT_TEXT)
  }
  return parts.join('\n')
}

/**
 * 设计模式会话行插件。
 * @param ctx - standing scope 上下文(组合装载一次,加入的 agent 通过作用域继承)。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: WORKFLOW_SECTION,
    order: WORKFLOW_ORDER,
    // 每次模型步骤组装提示词时求值:按用户当前打开的视图动态注入差异化约束。
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
