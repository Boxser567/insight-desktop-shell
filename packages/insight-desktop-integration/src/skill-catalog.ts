/** Presentation subset of the native session skill summary. */
export interface InsightSkill {
  readonly name: string
  readonly description: string
  readonly displayName?: string
  readonly order?: number
  readonly pickerVisible?: boolean
  readonly bundled?: boolean
}

/** Visible native gestures in the draft; paths and embedded substrings do not match. */
export function selectedSkillNames(draft: string): readonly string[] {
  return [...new Set([...draft.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)].map(match => match[2]!))]
}

/** Only winning bundled skills enter this product shortcut menu. */
export function filterSkills(skills: readonly InsightSkill[], query: string): readonly InsightSkill[] {
  const search = query.trim().toLocaleLowerCase()
  return skills.filter(skill => skill.bundled && skill.pickerVisible !== false &&
    `${skill.displayName ?? ''} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
}
