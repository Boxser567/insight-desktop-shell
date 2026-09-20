/** UI-only sidecar data. Never override native skill names, descriptions or instructions. */
export interface SkillPresentation {
  readonly displayName?: string
  readonly shortDescription?: string
}

export const SKILL_UI_MAX_BYTES = 8192

function label(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || [...text].length > limit || /[\u0000-\u001f\u007f]/.test(text)) return undefined
  return text
}

export function parseSkillPresentation(text: string): SkillPresentation {
  try {
    if (new TextEncoder().encode(text).length > SKILL_UI_MAX_BYTES) return {}
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const fields = data as Record<string, unknown>
    const displayName = label(fields.displayName, 60)
    const shortDescription = label(fields.shortDescription, 160)
    return { ...(displayName ? { displayName } : {}), ...(shortDescription ? { shortDescription } : {}) }
  } catch {
    return {}
  }
}

export function skillDisplayName(skill: SkillPresentation & { name: string }): string {
  return skill.displayName?.trim() || skill.name
}

export function skillShortDescription(skill: SkillPresentation & { description: string }): string {
  return skill.shortDescription?.trim() || skill.description
}
