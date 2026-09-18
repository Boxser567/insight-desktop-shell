import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'

/** Presentation subset of the native session skill summary. */
export interface InsightSkill {
  readonly name: string
  readonly description: string
  readonly displayName?: string
  readonly order?: number
  readonly pickerVisible?: boolean
  readonly bundled?: boolean
}

/** The small catalog face consumed by the product-owned picker. */
export interface SkillCatalog {
  list(sessionId: SessionId): Promise<readonly InsightSkill[]>
  subscribe(sessionId: SessionId, listener: () => void): () => void
}

/** Adapt alpha.2's Session-addressed Remote catalog to the picker contract. */
export function createSkillCatalog(ctx: ClientContext): SkillCatalog {
  const listeners = new Map<SessionId, Set<() => void>>()
  ctx.on('connection/reset', () => {
    for (const sessionListeners of listeners.values()) {
      for (const listener of sessionListeners) listener()
    }
  })
  return {
    async list(sessionId) {
      const result = await ctx.remote.skills.list({ sessionId })
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value.skills.map((skill, order) => ({
        name: skill.name,
        description: skill.description,
        order,
        bundled: true,
        pickerVisible: true
      }))
    },
    subscribe(sessionId, listener) {
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

/** Visible native gestures in the draft; paths and embedded substrings do not match. */
export function selectedSkillNames(draft: string): readonly string[] {
  return [...new Set([...draft.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)].map(match => match[2]!))]
}

/** Add or remove one native slash skill using the alpha.2 public draft API. */
export function toggleSkillDraft(draft: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const token = new RegExp(`(^|\\s)\\/${escaped}(?=\\s|$)`)
  if (token.test(draft)) return draft.replace(token, '$1').replace(/^\s+/, '')
  return `${draft.trimEnd()}${draft.trim() ? ' ' : ''}/${name} `
}

/** Only winning bundled skills enter this product shortcut menu. */
export function filterSkills(skills: readonly InsightSkill[], query: string): readonly InsightSkill[] {
  const search = query.trim().toLocaleLowerCase()
  return skills.filter(skill => skill.bundled && skill.pickerVisible !== false &&
    `${skill.displayName ?? ''} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
}
