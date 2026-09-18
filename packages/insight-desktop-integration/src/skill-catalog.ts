import data from '../../../build/insight-skill-catalog.json'

/** Presentation data only. Skill implementations remain on the enterprise service. */
export interface InsightSkill {
  id: string
  label: string
  description: string
  pickerVisible: boolean
  order: number
}

/** Validate the bundled catalog without requiring local SKILL.md resources. */
export function parseSkillCatalog(value: unknown): readonly InsightSkill[] {
  if (!value || typeof value !== 'object') throw new Error('Invalid skill catalog')
  const catalog = value as Record<string, unknown>
  if (catalog.schemaVersion !== 1 || typeof catalog.revision !== 'string' || !catalog.revision.trim() || !Array.isArray(catalog.skills)) {
    throw new Error('Unsupported skill catalog')
  }
  const ids = new Set<string>()
  const skills = catalog.skills.map((entry: unknown): InsightSkill => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid skill entry')
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id)
      || typeof item.label !== 'string' || !item.label.trim()
      || typeof item.description !== 'string' || !item.description.trim()
      || typeof item.pickerVisible !== 'boolean' || !Number.isSafeInteger(item.order)) throw new Error('Invalid skill entry')
    ids.add(item.id)
    return { id: item.id, label: item.label, description: item.description, pickerVisible: item.pickerVisible, order: item.order as number }
  })
  return skills.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Invalid catalog disables this menu, never the ordinary composer. */
export function loadSkillCatalog(): { skills: readonly InsightSkill[]; available: boolean } {
  try { return { skills: parseSkillCatalog(data), available: true } }
  catch { return { skills: [], available: false } }
}

/** Match title, description and stable name; hidden entries never enter the picker. */
export function filterSkills(skills: readonly InsightSkill[], query: string): readonly InsightSkill[] {
  const search = query.trim().toLocaleLowerCase()
  return skills.filter(skill => skill.pickerVisible && `${skill.label} ${skill.description} ${skill.id}`.toLocaleLowerCase().includes(search))
}
