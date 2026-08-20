/**
 * 设计模式技能提供者:随设计模式组合装载,向该模式作用域层的技能注册表
 * 注册 bundled 技能候选。因为注册发生在预设的 scope 层,只有使用设计模式
 * 的会话能看到/加载它们,其他模式不可见。
 *
 * 形状对齐官方 `@deepseek-ai/dsh-skill-badge` 的 bundled provider;刻意不
 * 引入 @deepseek-ai 运行时依赖(rank 直接用协议常量,见 dsh-skill 的
 * BUNDLED_SKILL_RANK = 600),保证插件从任意安装位置(link 或 tarball)都能加载。
 *
 * 技能清单:
 * - `design-workflow`:网页设计工作流契约(design/ 项目结构/令牌系统/工作流/约束);
 * - `ppt-workflow`:演示文稿工作流契约(design/ppt/ 项目、1600×900 slide 结构、导出规则);
 * - `frontend-design`:来自 anthropics/skills 仓库(Apache-2.0,见
 *   assets/frontend-design/LICENSE.txt),指导有辨识度的视觉设计决策。
 * @module @calwang414/dsh-ui-design/skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getActiveMode } from './active-mode.js'

/** 提供者名(技能目录里以此分组)。 */
const PROVIDER_NAME = 'dsh-ui-design'

/** 技能可用资源:assets/ 目录(覆盖两个技能的正文与附属文件)。 */
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
}

/** 模型与用户都可调用。 */
const INVOCATION = { modelInvocable: true, userInvocable: true }

// dsh-skill 的 BUNDLED_SKILL_RANK 协议常量
const RANK = 600

/** 技能候选清单:name 是技能 id,locator 指向包内正文。 */
const CANDIDATES = [
  {
    name: 'design-workflow',
    description: 'Design-mode workflow contract for DeepSeek Harness: the shared design/ project layout, the --ipw-* design-token system, and how to create and refine websites, app prototypes, posters, info cards, and data reports that the user reviews in the Design view. Load before starting any design task while in design mode; also use when the user asks to create or change a design, page, poster, prototype, or report.',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: RANK,
    locator: new URL('../assets/design-workflow.md', import.meta.url),
  },
  {
    name: 'ppt-workflow',
    description: 'Presentation (PPT) workflow contract for DeepSeek Harness design mode: the shared design/ppt/ project layout, the 1600x900 .slide/.deck structure, the --ipw-* design-token system, and PPTX/PDF export coverage rules. Load before starting any slide-deck task while in design mode; also use when the user asks to create or change a presentation, slide deck, or PPT.',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: RANK,
    locator: new URL('../assets/ppt-workflow.md', import.meta.url),
  },
  {
    name: 'frontend-design',
    description: 'Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don\'t read as templated defaults. (Apache-2.0, from anthropics/skills.)',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: RANK,
    locator: new URL('../assets/frontend-design/SKILL.md', import.meta.url),
  },
]

const byName = new Map(CANDIDATES.map((candidate) => [candidate.name, candidate]))

/** 按当前激活视图模式暴露的技能:网页模式含 frontend-design,PPT 模式只有 ppt-workflow。 */
const SKILLS_BY_MODE = {
  design: ['design-workflow', 'frontend-design'],
  slides: ['ppt-workflow'],
  null: ['design-workflow', 'ppt-workflow', 'frontend-design'],
}

/** 当前模式允许的技能名集合(未检测时全量,由 agent 按 manifest 自判)。 */
function visibleSkillNames() {
  const mode = getActiveMode()
  return SKILLS_BY_MODE[mode] ?? SKILLS_BY_MODE.null
}

const provider = {
  name: PROVIDER_NAME,
  list: () => {
    const allowed = new Set(visibleSkillNames())
    return Promise.resolve(CANDIDATES.filter((candidate) => allowed.has(candidate.name)))
  },
  async get(candidate) {
    const known = byName.get(candidate?.name)
    if (!known) throw new Error(`dsh-ui-design: unknown skill candidate ${candidate?.name}`)
    if (!visibleSkillNames().includes(known.name)) {
      throw new Error(`dsh-ui-design: skill ${known.name} is not available in the current view mode`)
    }
    return {
      name: known.name,
      description: known.description,
      invocation: known.invocation,
      provider: known.provider,
      source: known.source,
      resourceBase: known.resourceBase,
      content: await readFile(known.locator, 'utf8'),
    }
  },
}

/** Cordis 插件名。 */
export const name = 'dsh-ui-design-skill'
/** 技能注册表服务。 */
export const inject = ['skills']

/** 注册 bundled 技能提供者到调用方作用域层(设计模式专属)。 */
export function apply(ctx) {
  ctx.effect(() => ctx.skills.registerProvider(() => provider), 'dsh-ui-design: design-mode skill provider')
}
