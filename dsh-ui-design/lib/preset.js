/**
 * 设计模式会话行:挂在设计模式的 agent.cordis.yml 组合里,随预设的 standing
 * scope 装载一次。两个职责:
 *
 * 1. 向 system-prompt 注册「设计工作流」段,让该模式下的模型知道共享设计项目
 *    的契约(design/ 目录、manifest/入口/令牌文件、工作流与约束);
 * 2. 监听 `agent/created`,当新 agent 的会话以设计模式创建时,确保其工作区
 *    根目录下存在 `design/` 目录(「选择设计模式即自动建目录」)。
 *
 * 目录只负责 mkdir:初始文件(index.html / design-tokens.css / manifest.json /
 * brief.json)由 host 端在 Design 视图首次打开时播种,避免两处维护同一份模板。
 * @module @calwang414/dsh-ui-design/preset
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 设计模式预设 id:与 .agent-presets 下的目录名一致。 */
export const DESIGN_PRESET_ID = 'dsh-ui-design'

/** system-prompt 段名与排序(persona 之后、运行时上下文之前)。 */
export const WORKFLOW_SECTION = 'dsh-ui-design.workflow'
export const WORKFLOW_ORDER = 90

export const WORKFLOW_TEXT = [
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
  '',
  '每次设计/修改完成后先自查再交付:令牌一致性(无硬编码颜色/字体/间距)、',
  '令牌完整性(引用的 --ipw-* 变量都已定义)、布局无溢出且响应式可用、文案',
  '无占位符残留、多页面已注册且 entry 正确、未意外改动 design-tokens.css;',
  '发现问题修复后再交付。',
].join('\n')

/**
 * 设计模式会话行插件。
 * @param ctx - standing scope 上下文(组合装载一次,加入的 agent 通过作用域继承)。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: WORKFLOW_SECTION,
    order: WORKFLOW_ORDER,
    text: WORKFLOW_TEXT,
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
