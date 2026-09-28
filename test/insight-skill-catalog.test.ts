import { describe, expect, it } from 'vitest'
import { filterSkills, selectedSkillNames } from '../packages/insight-desktop-integration/src/skill-catalog'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { BUNDLED_SKILL_PRESENTATIONS } from '../packages/insight-desktop-integration/src/bundled-skill-presentations'

const roots = readdirSync('bundled-skills', { withFileTypes: true }).filter(entry => entry.isDirectory())
const skills = roots.map(entry => {
  const file = readFileSync(join('bundled-skills', entry.name, 'SKILL.md'), 'utf8')
  const data = parse(file.split('---')[1]!)
  const ui = JSON.parse(readFileSync(join('bundled-skills', entry.name, 'ui.json'), 'utf8'))
  return { name: data.name, description: data.description, ...ui,
    pickerVisible: entry.name !== 'media-generator', bundled: true, modelInvocable: true }
})

describe('directory-backed product skills', () => {
  it('loads actual valid bundles and presentation metadata', () => {
    expect(skills.length).toBeGreaterThan(0)
    expect(new Set(skills.map(skill => skill.name)).size).toBe(skills.length)
    for (const skill of skills) {
      expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(skill.description).toBeTruthy()
      expect(BUNDLED_SKILL_PRESENTATIONS[skill.name]).toMatchObject({ displayName: skill.displayName, shortDescription: skill.shortDescription })
    }
    expect(roots.map(root => root.name)).toContain('ppt-maker-new')
    expect(roots.map(root => root.name)).not.toContain('call-insight-api')
    expect(filterSkills(skills, '').map(skill => skill.name)).not.toContain('media-generator')
  })
  it('uses actual discovery and accepts new bundles without updating an enumeration', () => {
    const added = { name: 'new-skill', description: 'new business', bundled: true, modelInvocable: true }
    expect(filterSkills([added], 'new')).toEqual([added])
    expect(filterSkills([{ ...added, bundled: false }], '')).toEqual([])
    expect(filterSkills([], '')).toEqual([])
  })
  it('searches title, description and name while respecting hidden state', () => {
    expect(filterSkills(skills, '人性').map(skill => skill.name)).toContain('human-needs-insight')
    expect(filterSkills(skills, 'media-generator')).toEqual([])
    expect(filterSkills(skills, 'missing-term')).toEqual([])
  })
  it('derives selected names from visible exact tokens, including manual input', () => {
    expect(selectedSkillNames('/a /b /a /usr/bin x/a 5/8')).toEqual(['a', 'b'])
    expect(selectedSkillNames('')).toEqual([])
  })
  it('ships the entire skill tree as external resources', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.build.extraResources).toContainEqual(expect.objectContaining({ from: 'bundled-skills', to: 'bundled-skills' }))
    expect(readFileSync('bundled-skills/ppt-maker-new/scripts/ppt.py', 'utf8')).toContain('enterprise_proxy')
  })
})
