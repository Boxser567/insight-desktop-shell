import { open, stat, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveAgentsHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-working-directory'
import { SKILL_INVENTORY_REMOTE, type SkillInventorySnapshot, type SkillOrigin } from './skill-inventory-contract'
import { readSkillInventory, skillPathKey, type InventoryCandidate, type InventoryRoot } from './skill-inventory'
import { parseSkillPresentation, SKILL_UI_MAX_BYTES } from './skill-presentation'

/** Shell owns installation observation; this provider is never registered with ctx.skills. */
export class DesktopSkillCatalog extends TypertRemoteService {
  static inject = ['typert', 'agents', 'sessionQuery', 'workingDirectory']
  private readonly roots: InventoryRoot[]
  private readonly lifetime = new AbortController()
  constructor(ctx: Context, config: { agentsHome?: string } = {}) {
    super(ctx, 'desktopSkillCatalog', { namespace: 'desktopSkills' })
    const home = process.env.DSH_HOME
    if (!home) throw Error('Skill inventory requires the current account DSH_HOME')
    const rootPaths: [SkillOrigin, string | undefined][] = [
      ['platform', process.env.DSH_BUNDLED_SKILL_DIR],
      ['user-account', join(home, 'skills')],
      ['user-shared', join(resolveAgentsHome(config.agentsHome), 'skills')]
    ]
    this.roots = rootPaths.filter((entry): entry is [SkillOrigin, string] => !!entry[1]).map(([origin, rootPath]) => {
      const directory = resolve(rootPath)
      const bundleDirectory = (candidate: { resourceBase?: { kind: string; path?: string } }) => candidate.resourceBase?.kind === 'directory' && candidate.resourceBase.path && skillPathKey(candidate.resourceBase.path) !== skillPathKey(directory) ? candidate.resourceBase.path : undefined
      const provider = new FileSystemSkillProvider(ctx, { signal: this.lifetime.signal, invalidate: () => {} }, {
        includeDefaultRoots: false, watch: false,
        ...(origin === 'platform' ? { bundledSkillDir: directory } : { customSkillDirs: [directory] })
      })
      ctx.effect(() => () => { void provider.dispose() }, 'insight-desktop: read-only skill observer')
      return { origin, checkMissing: async (candidate: InventoryCandidate): Promise<'present' | 'absent' | 'unknown'> => {
        if (!candidate.entryPath) return 'unknown'
        try {
          const fs = ctx.get('fs')
          return (fs ? await fs.stat(await fs.resolve(candidate.entryPath)) : await stat(candidate.entryPath)) ? 'present' : 'absent'
        } catch (error) { return error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'FS_NOT_FOUND', 'FS_NOT_DIRECTORY'].includes(String(error.code)) ? 'absent' : 'unknown' }
      }, list: async () => {
        const observation = await provider.list({ signal: this.lifetime.signal })
        const candidates = Array.isArray(observation) ? observation : observation.candidates
        const fs = ctx.get('fs')
        const flatEntries = new Map<string, string>()
        if (candidates.some(candidate => !bundleDirectory(candidate))) {
          let entries: string[]
          try {
            entries = fs ? (await fs.listDir(await fs.resolve(directory))).filter(e => e.name.endsWith('.md')).map(e => e.target.displayPath)
              : (await readdir(directory)).filter(name => name.endsWith('.md')).map(name => join(directory, name))
          } catch { throw Error('Skill entry observation unavailable') }
          for (const entry of entries) {
            try { flatEntries.set(skillPathKey(fs ? fs.processPath(await fs.resolve(entry)) : await realpath(entry)), entry) } catch { /* Missing link cannot represent an installed entry. */ }
          }
        }
        return { complete: Array.isArray(observation) || observation.complete, candidates: candidates
          .filter(candidate => origin !== 'user-account' || !candidate.resourceBase || candidate.resourceBase.kind !== 'directory' || relative(directory, candidate.resourceBase.path).split(/[\\/]/u)[0] !== '.system')
          .map(candidate => {
            const bundle = bundleDirectory(candidate)
            return { name: candidate.name, description: candidate.description, path: candidate.path, userInvocable: candidate.invocation.userInvocable,
              ...(bundle ? { directory: bundle, entryPath: join(bundle, 'SKILL.md') } : { entryPath: flatEntries.get(skillPathKey(candidate.path)) }) }
          }) }
      } }
    })
    ctx.effect(() => ctx.typert.register({ package: SKILL_INVENTORY_REMOTE.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: SKILL_INVENTORY_REMOTE.descriptors }), 'insight-desktop: skill Remote')
    ctx.effect(() => () => this.lifetime.abort(), 'insight-desktop: skill inventory lifetime')
  }

  async list(request: { sessionId: string }, signal: AbortSignal): Promise<SkillInventorySnapshot> {
    signal.throwIfAborted()
    const sessionId = request.sessionId as SessionId
    using observation = await this.ctx.sessionQuery.observeSession(sessionId)
    if (!observation.projections) throw Error('Session skill observation unavailable')
    const preset = observation.projections.values.agentPreset ?? undefined
    const live = this.ctx.agents.get(sessionId)
    const cwd = live ? await this.ctx.workingDirectory.ensure(live, signal)
      : observation.projections.values.workingDirectory ?? observation.header.cwd ?? this.ctx.workingDirectory.defaultDirectory
    const presets = this.ctx.get('agentPresets')
    const acquire = async () => { try { return await presets?.acquireScope(preset) } catch { return undefined } }
    await using lease = live ? undefined : await acquire()
    const registry = (live ? presets?.serviceFor(live, 'skills') : undefined) ?? this.ctx.get('skills')
    if (!registry) throw Error('Session skill registry unavailable')
    const effective = await registry.snapshot({ cwd, scope: live ?? lease?.key, signal })
    const result = await readSkillInventory(this.roots, { complete: effective.complete,
      skills: effective.skills.map(s => ({ name: s.name, description: s.description, path: s.path, source: s.source, provider: s.provider, userInvocable: s.invocation.userInvocable }))
    }, candidate => this.readPresentation(candidate, signal), signal)
    signal.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    return result
  }

  private async readPresentation(candidate: InventoryCandidate, signal: AbortSignal) {
    if (!candidate.directory) return {}
    const path = join(candidate.directory, 'ui.json')
    const fs = this.ctx.get('fs')
    if (fs) {
      const target = await fs.resolve(path)
      return parseSkillPresentation(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readBytes(target, signal, SKILL_UI_MAX_BYTES + 1)))
    }
    const file = await open(path, 'r')
    try {
      const buffer = new Uint8Array(SKILL_UI_MAX_BYTES + 1)
      const { bytesRead } = await file.read(buffer)
      return parseSkillPresentation(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
    } finally { await file.close() }
  }
}
declare module '@deepseek-ai/cordis' { interface Context { desktopSkillCatalog: DesktopSkillCatalog } }
