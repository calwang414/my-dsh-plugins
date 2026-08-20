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
 * - `design-workflow`(modes: design):网页设计工作流契约(design/ 项目结构/令牌系统/工作流/约束);
 * - `ppt-workflow`(modes: slides):演示文稿工作流契约(design/ppt/ 项目、1600×900 slide 结构、导出规则);
 * - `frontend-design`(modes: design):来自 anthropics/skills 仓库(Apache-2.0,见
 *   assets/frontend-design/LICENSE.txt),指导有辨识度的视觉设计决策。
 *
 * 后续添加技能:在 CANDIDATES 增加候选并声明 `modes`(`['design']` 仅网页、
 * `['slides']` 仅 PPT、`['design','slides']` 或省略为全模式)。过滤逻辑自动
 * 按当前视图模式生效,无需改动 provider。自定义 provider 也可复用
 * `skillCandidatesForMode()` 与 `getActiveMode()` 做同样的区分。
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

/** 技能候选清单:name 是技能 id,locator 指向包内正文,modes 声明可见模式。 */
const CANDIDATES = [
  {
    name: 'design-workflow',
    modes: ['design'],
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
    modes: ['slides'],
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
    modes: ['design'],
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

/** 候选省略 modes 时的默认可见模式(全模式通用)。 */
const DEFAULT_MODES = ['design', 'slides']

/**
 * 按模式过滤技能候选。
 * @param mode - 视图模式:"design" | "slides" | null(未检测,返回全量)。
 * @returns 该模式下可见的候选列表。
 */
export function skillCandidatesForMode(mode) {
  if (mode === null) return [...CANDIDATES]
  return CANDIDATES.filter((candidate) => (candidate.modes ?? DEFAULT_MODES).includes(mode))
}

/** 当前模式可见的技能名集合(未检测时全量,由 agent 按 manifest 自判)。 */
function visibleSkillNames() {
  return skillCandidatesForMode(getActiveMode()).map((candidate) => candidate.name)
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
