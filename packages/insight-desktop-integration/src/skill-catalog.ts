import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import { bundledSkillPresentation, isBundledSkill } from './bundled-skill-presentations'
import { parseSkillPresentation, SKILL_UI_MAX_BYTES } from './skill-presentation'

/** Presentation subset of the native session skill summary. */
export interface InsightSkill {
  readonly name: string
  readonly description: string
  readonly displayName?: string
  readonly shortDescription?: string
  readonly order?: number
  readonly pickerVisible?: boolean
  readonly bundled?: boolean
}

/** The small catalog face consumed by the product-owned picker. */
export interface SkillCatalog {
  list(sessionId: SessionId): Promise<readonly InsightSkill[]>
  subscribe(sessionId: SessionId, listener: () => void): () => void
}

interface NativeSkill extends InsightSkill {
  readonly path?: string
}

interface SharedSkillCatalog {
  list(sessionId: SessionId): Promise<readonly NativeSkill[]>
  subscribe(sessionId: SessionId, listener: () => void): () => void
}

/** Adapt the Core shared catalog, retaining an alpha.2 Remote fallback. */
export function createSkillCatalog(ctx: ClientContext): SkillCatalog {
  const shared = typeof ctx.get === 'function'
    ? ctx.get('skillCatalog') as SharedSkillCatalog | undefined
    : undefined
  const listeners = new Map<SessionId, Set<() => void>>()
  if (!shared) {
    ctx.on('connection/reset', () => {
      for (const sessionListeners of listeners.values()) {
        for (const listener of sessionListeners) listener()
      }
    })
  }
  return {
    async list(sessionId) {
      const skills = shared
        ? await shared.list(sessionId)
        : await ctx.remote.skills.list({ sessionId }).then(result => {
            if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
            return result.value.skills as readonly NativeSkill[]
          })
      return Promise.all(skills.map(async (skill, order) => ({
        name: skill.name,
        description: skill.description,
        ...bundledSkillPresentation(skill.name, skill.path),
        ...await readSkillPresentation(ctx, sessionId, skill.path),
        order: skill.order ?? order,
        bundled: isBundledSkill(skill.name, skill.path),
        pickerVisible: skill.pickerVisible ?? true
      })))
    },
    subscribe(sessionId, listener) {
      if (shared) return shared.subscribe(sessionId, listener)
      const sessionListeners = listeners.get(sessionId) ?? new Set<() => void>()
      sessionListeners.add(listener)
      listeners.set(sessionId, sessionListeners)
      return () => {
        sessionListeners.delete(listener)
        if (sessionListeners.size === 0) listeners.delete(sessionId)
      }
    }
  }
}

/** Read only the winning native skill's sidecar through the public Host filesystem API. */
async function readSkillPresentation(ctx: ClientContext, sessionId: SessionId, path?: string) {
  if (!path || !/[\\/]SKILL\.md$/.test(path)) return {}
  const uiPath = path.replace(/SKILL\.md$/, 'ui.json')
  try {
    const result = await ctx.remote.workspaceFiles.readBytes(sessionId, uiPath, { offset: 0, length: SKILL_UI_MAX_BYTES + 1 })
    if (!result.ok || !result.value.eof || result.value.offset !== 0 || (result.value.bytes ?? 0) > SKILL_UI_MAX_BYTES) return {}
    const bytes = Uint8Array.from(atob(result.value.data), character => character.charCodeAt(0))
    if (bytes.length > SKILL_UI_MAX_BYTES) return {}
    return parseSkillPresentation(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // Optional metadata must never prevent native skills from being selected.
    return {}
  }
}

/** Visible native gestures in the draft; paths and embedded substrings do not match. */
export function selectedSkillNames(draft: string): readonly string[] {
  return [...new Set([...draft.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)].map(match => match[2]!))]
}

/** Only winning bundled skills enter this product shortcut menu. */
export function filterSkills(skills: readonly InsightSkill[], query: string): readonly InsightSkill[] {
  const search = query.trim().toLocaleLowerCase()
  return skills.filter(skill => skill.bundled && skill.pickerVisible !== false &&
    `${skill.displayName ?? ''} ${skill.shortDescription ?? ''} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
}
