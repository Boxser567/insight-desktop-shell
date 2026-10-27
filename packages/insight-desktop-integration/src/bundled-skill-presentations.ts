import type { SkillPresentation } from './skill-presentation'
import manifest from '../../../build/skill-presentations.json'

/** Generated from product-owned ui.json; never a manually maintained allowlist. */
export const BUNDLED_SKILL_PRESENTATIONS: Readonly<Record<string, SkillPresentation>> = Object.fromEntries(
  Object.entries(manifest).map(([name, entry]) => [name, { displayName: entry.displayName, shortDescription: entry.shortDescription }])
)
export const BUNDLED_SKILL_ENTRIES: Readonly<Record<string, { entryPath: string } & SkillPresentation>> = manifest

/** Legacy path-only classification for old Runtime presentation fallback. */
export function isBundledSkill(name: string, path?: string): boolean {
  const entry = BUNDLED_SKILL_ENTRIES[name]
  return !!entry && !!path && path.replace(/\\/gu, '/').endsWith(`/bundled-skills/${entry.entryPath}`)
}
export function bundledSkillPresentation(name: string, path?: string): SkillPresentation {
  return isBundledSkill(name, path) ? BUNDLED_SKILL_PRESENTATIONS[name] ?? {} : {}
}
