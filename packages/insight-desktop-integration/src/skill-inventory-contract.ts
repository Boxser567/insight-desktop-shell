import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type SkillOrigin = 'platform' | 'user-shared' | 'user-account'
export type SkillAvailability = 'callable' | 'shadowed' | 'outside-composition' | 'user-disabled' | 'unconfirmed' | 'invalid'
export interface InventorySkill {
  readonly entryId: string
  readonly name: string
  readonly description: string
  readonly displayName?: string
  readonly shortDescription?: string
  readonly origin: SkillOrigin
  readonly availability: SkillAvailability
  readonly order: number
}
export interface SkillInventorySnapshot {
  readonly skills: readonly InventorySkill[]
  readonly complete: boolean
}
export function parseInventoryRequest(value: unknown): { sessionId: string } {
  const sessionId = value && typeof value === 'object' && 'sessionId' in value ? value.sessionId : undefined
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || /[\u0000-\u001f]/u.test(sessionId)) throw Error('Invalid skill session')
  return { sessionId }
}
export function parseInventorySnapshot(value: unknown): SkillInventorySnapshot {
  if (!value || typeof value !== 'object' || !('skills' in value) || !Array.isArray(value.skills) || !('complete' in value) || typeof value.complete !== 'boolean') throw Error('Invalid skill inventory')
  const skills = value.skills.map((row: unknown): InventorySkill => {
    if (!row || typeof row !== 'object') throw Error('Invalid skill entry')
    const r = row as Record<string, unknown>
    if (typeof r.entryId !== 'string' || typeof r.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(r.name) || typeof r.description !== 'string' || typeof r.order !== 'number' || !Number.isFinite(r.order) || !['platform', 'user-shared', 'user-account'].includes(r.origin as string) || !['callable', 'shadowed', 'outside-composition', 'user-disabled', 'unconfirmed', 'invalid'].includes(r.availability as string)) throw Error('Invalid skill entry')
    if ((r.displayName !== undefined && typeof r.displayName !== 'string') || (r.shortDescription !== undefined && typeof r.shortDescription !== 'string')) throw Error('Invalid skill presentation')
    return { entryId: r.entryId, name: r.name, description: r.description, origin: r.origin as SkillOrigin, availability: r.availability as SkillAvailability, order: r.order,
      ...(typeof r.displayName === 'string' ? { displayName: r.displayName } : {}), ...(typeof r.shortDescription === 'string' ? { shortDescription: r.shortDescription } : {}) }
  })
  return { skills, complete: value.complete }
}
const descriptor: InvocationDescriptor = {
  id: 'insight.desktopSkills.list', service: 'desktopSkillCatalog', namespace: 'desktopSkills', method: 'list',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'InventoryRequest', create: () => ({ parse: parseInventoryRequest }) } }],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: 'SkillInventorySnapshot', create: () => ({ parse: parseInventorySnapshot }) }
}
/** Both ends explicitly mount the same public Typert descriptor, no Core generation required. */
export const SKILL_INVENTORY_REMOTE: TypertRemoteContribution = { package: '@insight-ai/desktop-integration', descriptors: [descriptor] }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    desktopSkills: { list(request: { sessionId: string }, signal?: AbortSignal): Promise<RemoteResult<SkillInventorySnapshot>> }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { 'remote.desktopSkills': { list(request: { sessionId: string }, signal?: AbortSignal): Promise<RemoteResult<SkillInventorySnapshot>> } }
}
