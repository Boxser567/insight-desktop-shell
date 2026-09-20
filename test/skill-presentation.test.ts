import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSkillCatalog, filterSkills, toggleSkillDraft } from '../packages/insight-desktop-integration/src/skill-catalog'
import { BUNDLED_SKILL_PRESENTATIONS } from '../packages/insight-desktop-integration/src/bundled-skill-presentations'
import { parseSkillPresentation, skillDisplayName, skillShortDescription } from '../packages/insight-desktop-integration/src/skill-presentation'
import { en, zh } from '../packages/insight-desktop-integration/src/client/locales'

const native = { name: 'creator-recommendation', description: 'Original model-facing instructions', path: '/skills/creator-recommendation/SKILL.md' }
const presentation = { displayName: '达人推荐', shortDescription: '发现并筛选合适达人。' }
const windowOf = (text: string) => ({ ok: true, value: {
  absolutePath: '/skills/creator-recommendation/ui.json', version: '1', offset: 0,
  eof: true, bytes: Buffer.byteLength(text), data: Buffer.from(text).toString('base64')
} })

function setup(entries: { name: string; description: string; path?: string }[] = [native]) {
  const readBytes = vi.fn().mockResolvedValue(windowOf(JSON.stringify(presentation)))
  const ctx = { on: vi.fn(), remote: {
    skills: { list: vi.fn().mockResolvedValue({ ok: true, value: { skills: entries } }) },
    workspaceFiles: { readBytes }
  } }
  const catalog = createSkillCatalog(ctx as unknown as Parameters<typeof createSkillCatalog>[0])
  const session = 'session-test' as Parameters<typeof catalog.list>[0]
  return { ctx, readBytes, catalog, session }
}

describe('skill UI-only metadata', () => {
  it('uses the product-facing expert skills label when none are selected', () => {
    expect(zh['skill.placeholder']).toBe('专家技能')
    expect(en['skill.placeholder']).toBe('Expert Skills')
  })

  it('whitelists presentation fields without accepting identity or instructions', () => {
    expect(parseSkillPresentation(JSON.stringify({ ...presentation, name: 'override', description: 'override', pickerVisible: false }))).toEqual(presentation)
    expect(parseSkillPresentation('{"displayName":" 名称 ","shortDescription":" 简介 "}')).toEqual({ displayName: '名称', shortDescription: '简介' })
  })

  it.each(['{', 'null', '[]', '42', '{}', ' '.repeat(8193)])('falls back for malformed or oversized metadata: %s', text => {
    expect(parseSkillPresentation(text)).toEqual({})
  })

  it('rejects invalid fields independently', () => {
    for (const value of ['', '  ', 3, {}, 'x'.repeat(61), 'a\nb', 'a\u0085b', 'a\u2028b', 'a\u2029b']) {
      expect(parseSkillPresentation(JSON.stringify({ displayName: value, shortDescription: 'valid' }))).toEqual({ shortDescription: 'valid' })
    }
    expect(parseSkillPresentation(JSON.stringify({ displayName: 'valid', shortDescription: 'x'.repeat(161) }))).toEqual({ displayName: 'valid' })
    expect(skillDisplayName({ name: 'native', displayName: ' ' })).toBe('native')
    expect(skillShortDescription({ description: 'original' })).toBe('original')
  })

  it('ships valid UI sidecars for every current bundle', () => {
    for (const entry of readdirSync('bundled-skills', { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const text = readFileSync(join('bundled-skills', entry.name, 'ui.json'), 'utf8')
      const ui = parseSkillPresentation(text)
      expect(ui).toEqual(JSON.parse(text))
      expect(ui.displayName).toBeTruthy()
      expect(ui.shortDescription).toBeTruthy()
      expect(BUNDLED_SKILL_PRESENTATIONS[entry.name]).toEqual(ui)
    }
  })
})

describe('native catalog presentation adapter', () => {
  it('reads the winning path via public Remote and keeps invocation/model metadata intact', async () => {
    const { readBytes, catalog, session } = setup()
    const [skill] = await catalog.list(session)
    expect(readBytes).toHaveBeenCalledWith(session, '/skills/creator-recommendation/ui.json', { offset: 0, length: 8193 })
    expect(skill).toMatchObject({ name: native.name, description: native.description, ...presentation })
    expect(skillDisplayName(skill!)).toBe(presentation.displayName)
    expect(skillShortDescription(skill!)).toBe(presentation.shortDescription)
    expect(toggleSkillDraft('', skill!.name)).toBe('/creator-recommendation ')
    for (const query of ['达人推荐', '筛选', native.name, 'model-facing']) expect(filterSkills([skill!], query)).toEqual([skill])
  })

  it('handles Windows paths and does not use metadata from a shadowed bundle', async () => {
    const { readBytes, catalog, session } = setup([{ ...native, path: 'C:\\Users\\user\\skills\\creator-recommendation\\SKILL.md' }])
    await catalog.list(session)
    expect(readBytes).toHaveBeenCalledExactlyOnceWith(session, 'C:\\Users\\user\\skills\\creator-recommendation\\ui.json', { offset: 0, length: 8193 })
  })

  it('skips pathless and flat-file skills', async () => {
    const { readBytes, catalog, session } = setup([
      { name: 'native', description: 'native' }, { ...native, path: '/skills/creator-recommendation.md' }
    ])
    expect(await catalog.list(session)).toHaveLength(2)
    expect(readBytes).not.toHaveBeenCalled()
  })

  it('isolates a missing or failed sidecar from other skills', async () => {
    const { readBytes, catalog, session } = setup([native, { ...native, name: 'second', path: '/skills/second/SKILL.md' }])
    readBytes.mockRejectedValueOnce(new Error('not found'))
    const skills = await catalog.list(session)
    expect(skillDisplayName(skills[0]!)).toBe(native.name)
    expect(skillShortDescription(skills[0]!)).toBe(native.description)
    expect(skills[1]).toMatchObject(presentation)
  })

  it('uses the bundled presentation when the runtime sidecar read is unavailable', async () => {
    const { readBytes, catalog, session } = setup([{
      ...native,
      path: '/Users/app/bundled-skills/creator-recommendation/SKILL.md'
    }])
    readBytes.mockRejectedValue(new Error('workspace resource unavailable'))
    const [skill] = await catalog.list(session)
    expect(skill).toMatchObject(BUNDLED_SKILL_PRESENTATIONS['creator-recommendation']!)
    expect(filterSkills([skill!], '达人推荐')).toEqual([skill])
  })

  it('rejects unsuccessful, partial, oversized, malformed base64 and invalid UTF-8 responses', async () => {
    const { readBytes, catalog, session } = setup()
    const valid = windowOf(JSON.stringify(presentation))
    for (const response of [
      { ok: false, error: { code: 'workspace-file/not-found' } },
      { ...valid, value: { ...valid.value, eof: false } },
      { ...valid, value: { ...valid.value, offset: 1 } },
      { ...valid, value: { ...valid.value, bytes: 8193 } },
      { ...valid, value: { ...valid.value, bytes: undefined, data: Buffer.alloc(8193).toString('base64') } },
      { ...valid, value: { ...valid.value, data: '!!!' } },
      { ...valid, value: { ...valid.value, data: Buffer.from([0xff]).toString('base64') } }
    ]) {
      readBytes.mockResolvedValueOnce(response)
      expect((await catalog.list(session))[0]?.displayName).toBeUndefined()
    }
  })

  it('reloads metadata on catalog refresh instead of caching stale labels', async () => {
    const { readBytes, catalog, session } = setup()
    await catalog.list(session)
    readBytes.mockResolvedValue(windowOf('{"displayName":"更新名称"}'))
    expect((await catalog.list(session))[0]?.displayName).toBe('更新名称')
    expect(readBytes).toHaveBeenCalledTimes(2)
  })

  it('still propagates native catalog failures', async () => {
    const { ctx, catalog, session } = setup()
    ctx.remote.skills.list.mockResolvedValueOnce({ ok: false, error: { code: 'session/not-found', message: 'missing' } })
    await expect(catalog.list(session)).rejects.toThrow('session/not-found: missing')
  })
})
