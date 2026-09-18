import { describe, expect, it } from 'vitest'
import data from '../build/insight-skill-catalog.json'
import { filterSkills, loadSkillCatalog, parseSkillCatalog } from '../packages/insight-desktop-integration/src/skill-catalog'

describe('enterprise skill presentation catalog', () => {
  it('keeps all thirteen entries with twelve visible, independent of local installation', () => {
    const { skills, available } = loadSkillCatalog()
    expect(available).toBe(true)
    expect(skills).toHaveLength(13)
    expect(filterSkills(skills, '')).toHaveLength(12)
    expect(skills.find(skill => skill.id === 'media-generator')?.pickerVisible).toBe(false)
    expect(filterSkills(skills, 'media-generator')).toEqual([])
  })
  it('searches title, description and stable name', () => {
    expect(filterSkills(parseSkillCatalog(data), '人性')[0]?.id).toBe('human-needs-insight')
    expect(filterSkills(parseSkillCatalog(data), ' PPTX ')[0]?.id).toBe('ppt-maker')
    expect(filterSkills(parseSkillCatalog(data), 'creator-recommendation')[0]?.label).toBe('达人发现与筛选')
  })
  it.each([
    { ...data, schemaVersion: 2 }, { ...data, revision: '' },
    { ...data, skills: [data.skills[0], data.skills[0]] },
    ...['id', 'label', 'description'].map(field => ({ ...data, skills: [{ ...data.skills[0], [field]: '' }] })),
    { ...data, skills: [{ ...data.skills[0], pickerVisible: 'yes' }] },
    { ...data, skills: [{ ...data.skills[0], order: Infinity }] },
  ])('rejects an invalid catalog', value => expect(() => parseSkillCatalog(value)).toThrow())
  it('sorts by order then stable id, without modifying source data', () => {
    const source = { ...data, skills: [{ ...data.skills[1], order: 1 }, { ...data.skills[0], order: 0 }] }
    expect(parseSkillCatalog(source)[0]?.id).toBe(data.skills[0]?.id)
    expect(source.skills[0]?.id).toBe(data.skills[1]?.id)
  })
})
