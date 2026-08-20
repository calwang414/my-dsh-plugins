/**
 * 设计模式技能提供者:随设计模式组合装载,向该模式作用域层的技能注册表
 * 注册 bundled 技能候选。因为注册发生在预设的 scope 层,只有使用设计模式
 * 的会话能看到/加载它们,其他模式不可见。
 *
 * 技能 = 只注入元数据(name/description)、正文按需加载的知识。**两份工作流
 * (网页/PPT)不是技能**:它们是常驻完整注入的 system-prompt 契约,由
 * lib/preset.js 按当前视图模式整体注入,不在此注册。
 *
 * 形状对齐官方 `@deepseek-ai/dsh-skill-badge` 的 bundled provider;刻意不
 * 引入 @deepseek-ai 运行时依赖(rank 直接用协议常量,见 dsh-skill 的
 * BUNDLED_SKILL_RANK = 600),保证插件从任意安装位置(link 或 tarball)都能加载。
 *
 * 技能清单(模式归属来自技能正文 frontmatter 的 `metadata.modes` 标签):
 * - `frontend-design`(modes: design):来自 anthropics/skills 仓库(Apache-2.0,见
 *   assets/frontend-design/LICENSE.txt),指导有辨识度的视觉设计决策,按需加载。
 *
 * 后续添加技能:把技能正文放进 assets/(或子目录),在文档 frontmatter 声明
 * `metadata.modes` 标签(`- design` 仅网页、`- slides` 仅 PPT、两者或省略为
 * 全模式),并在 CANDIDATES 增加一行注册(name/locator)。过滤逻辑自动按当前
 * 视图模式生效,无需再改代码。
 * @module @calwang414/dsh-ui-design/skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getActiveMode } from './active-mode.js'

/** 提供者名(技能目录里以此分组)。 */
const PROVIDER_NAME = 'dsh-ui-design'

/** 技能可用资源:assets/ 目录(覆盖技能的正文与附属文件)。 */
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
}

/** 模型与用户都可调用。 */
const INVOCATION = { modelInvocable: true, userInvocable: true }

// dsh-skill 的 BUNDLED_SKILL_RANK 协议常量
const RANK = 600

/** 技能候选清单:name 是技能 id,locator 指向包内正文;模式归属读文档 frontmatter。 */
const CANDIDATES = [
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

/** 进程内 frontmatter 解析缓存(locator.href -> { modes?: string[] })。 */
const frontmatterCache = new Map()

/** 从 YAML frontmatter 文本解析 `modes:` 列表(支持内联数组与块式列表,允许缩进)。 */
function parseModesFromYaml(yaml) {
  const inline = /(?:^|\n)[ \t]*modes\s*:\s*\[([^\]]*)\]/.exec(yaml)
  if (inline) return inline[1].split(',').map((value) => value.trim()).filter(Boolean)
  const block = /(?:^|\n)[ \t]*modes\s*:\s*\n((?:[ \t]*-\s*[^\n]+\n?)+)/.exec(yaml)
  if (block) return block[1].split('\n').map((line) => line.trim().replace(/^-\s*/, '')).filter(Boolean)
  return undefined
}

/**
 * 读取技能正文 frontmatter 中的 `metadata.modes` 标签(带进程内缓存)。
 * @param locator - 技能正文文件 URL。
 * @returns modes 标签数组;文档无 frontmatter 或无标签时返回 undefined(视为全模式)。
 */
async function modesFromFrontmatter(locator) {
  const cached = frontmatterCache.get(locator.href)
  if (cached !== undefined) return cached
  const content = await readFile(locator, 'utf8')
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  // metadata 对象下的 modes 与顶层 modes 均可识别。
  const modes = block ? parseModesFromYaml(block[1]) : undefined
  frontmatterCache.set(locator.href, modes)
  return modes
}

/**
 * 按模式过滤技能候选。
 * @param mode - 视图模式:"design" | "slides" | null(未检测,返回全量)。
 * @returns 该模式下可见的候选列表(frontmatter 无 modes 标签视为全模式)。
 */
export async function skillCandidatesForMode(mode) {
  const visible = []
  for (const candidate of CANDIDATES) {
    const modes = await modesFromFrontmatter(candidate.locator)
    if (mode === null || modes === undefined || modes.includes(mode)) visible.push(candidate)
  }
  return visible
}

const provider = {
  name: PROVIDER_NAME,
  list: () => skillCandidatesForMode(getActiveMode()),
  async get(candidate) {
    const known = byName.get(candidate?.name)
    if (!known) throw new Error(`dsh-ui-design: unknown skill candidate ${candidate?.name}`)
    const modes = await modesFromFrontmatter(known.locator)
    const mode = getActiveMode()
    if (mode !== null && modes !== undefined && !modes.includes(mode)) {
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
      ...(modes !== undefined ? { metadata: { modes } } : {}),
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
