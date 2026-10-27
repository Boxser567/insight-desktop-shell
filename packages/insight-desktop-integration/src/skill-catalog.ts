import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import { BUNDLED_SKILL_PRESENTATIONS, bundledSkillPresentation, isBundledSkill } from './bundled-skill-presentations'
import { parseSkillPresentation, SKILL_UI_MAX_BYTES } from './skill-presentation'
import { SKILL_INVENTORY_REMOTE, parseInventorySnapshot, type SkillOrigin, type SkillAvailability } from './skill-inventory-contract'

/** Presentation subset of the native session skill summary. */
export interface InsightSkill {
  readonly origin?: SkillOrigin
  readonly availability?: SkillAvailability
  readonly entryId?: string
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
  snapshot?(sessionId: SessionId): Promise<{ skills: readonly InsightSkill[]; complete: boolean; userSupported: boolean }>
  subscribe(sessionId: SessionId, listener: () => void): () => void
}

interface NativeSkill extends InsightSkill {
  readonly path?: string
}

interface SharedSkillCatalog {
  list(sessionId: SessionId): Promise<readonly NativeSkill[]>
  subscribe(sessionId: SessionId, listener: () => void): () => void
}

/** Prefer the Shell inventory, retaining the legacy API when dynamic mounting is absent. */
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
  let mounted: Promise<() => Promise<void>> | undefined
  if (typeof ctx.effect === 'function') ctx.effect(() => () => { void mounted?.then(dispose => dispose()).catch(() => {}) }, 'insight-desktop: skill Remote client')
  const loadSnapshot = async (sessionId: SessionId) => {
    if (typeof ctx.remote.$mount === 'function') {
      mounted ??= ctx.remote.$mount(SKILL_INVENTORY_REMOTE)
      await mounted
      const remote = ctx.get('remote.desktopSkills')
      if (!remote) throw new Error('Skill inventory service unavailable')
      const result = await remote.list({ sessionId })
      if (!result.ok) throw new Error('Skill inventory unavailable')
      const snapshot = parseInventorySnapshot(result.value)
      const skills: InsightSkill[] = snapshot.skills.map(skill => ({
        ...skill,
        ...(skill.origin === 'platform' ? { ...BUNDLED_SKILL_PRESENTATIONS[skill.name], ...('displayName' in skill ? { displayName: skill.displayName } : {}), ...('shortDescription' in skill ? { shortDescription: skill.shortDescription } : {}) } : {}),
        bundled: skill.origin === 'platform'
      }))
      return { skills, complete: snapshot.complete, userSupported: true }
    }
    return { skills: await readLegacy(sessionId), complete: true, userSupported: false }
  }
  const readLegacy = async (sessionId: SessionId) => {
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
        pickerVisible: skill.pickerVisible
      })))
  }
  const pending = new Map<SessionId, ReturnType<typeof loadSnapshot>>()
  const readSnapshot = (sessionId: SessionId) => {
    let operation = pending.get(sessionId)
    if (!operation) {
      operation = loadSnapshot(sessionId).finally(() => { pending.delete(sessionId) })
      pending.set(sessionId, operation)
    }
    return operation
  }
  return {
    list: async sessionId => (await readSnapshot(sessionId)).skills,
    snapshot: readSnapshot,
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
    const result = await ctx.remote.workspaceFiles.readBytes(sessionId, uiPath, { range: { offset: 0, length: SKILL_UI_MAX_BYTES + 1 } })
    if (!result.ok || !result.value.eof || result.value.offset !== 0 || (result.value.bytes ?? 0) > SKILL_UI_MAX_BYTES) return {}
    const bytes = result.value.data
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

/** Filter the selected product source while preserving disabled installation rows. */
export function filterSkills(skills: readonly InsightSkill[], query: string, group: 'platform' | 'user' = 'platform'): readonly InsightSkill[] {
  const search = query.trim().toLocaleLowerCase()
  return skills.filter(skill => (group === 'platform' ? skill.origin === 'platform' || skill.bundled : skill.origin === 'user-account' || skill.origin === 'user-shared') && skill.pickerVisible !== false &&
    `${skill.displayName ?? ''} ${skill.shortDescription ?? ''} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
}

/** Availability describes current Core resolution, never overrides it. */
export function isSkillSelectable(skill: InsightSkill): boolean {
  return skill.availability === undefined || skill.availability === 'callable'
}
