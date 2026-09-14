import { clearDamagedPackageDirectories, hasProfile } from './profile-repair'
import { clearProfileInstallMarker, isProfileInstallComplete, markProfileInstallComplete } from './profile-install-marker'

/** Repair dependency files while stopped; preserve plugin declarations on failure. */
export async function repairProfilePackages(options: {
  dshHome: string
  install: () => Promise<{ ok: boolean; detail?: string }>
  note: (line: string) => void
}): Promise<{ ok: boolean; detail?: string }> {
  const { dshHome, install, note } = options
  try {
    if (!hasProfile(dshHome)) return { ok: true }
    const removed = await clearDamagedPackageDirectories(dshHome)
    // An install that never finished leaves nothing a damage scan can see: the
    // directories it did write are real packages, and the ones it never
    // reached are simply absent. Skipping the install on "nothing damaged" is
    // what let a half-built profile stay half-built across every later launch.
    const complete = await isProfileInstallComplete(dshHome)
    if (removed.length === 0 && complete) return { ok: true }

    note(
      removed.length === 0
        ? '[desktop] repairing profile: the last install did not finish'
        : `[desktop] repairing profile: cleared ${removed.length} damaged package ${
            removed.length === 1 ? 'directory' : 'directories'
          }`
    )
    // Withdrawn first: whatever happens to the run below, an interrupted
    // install must not leave a marker claiming the profile is whole.
    await clearProfileInstallMarker(dshHome)
    const result = await install()
    if (result.ok) await markProfileInstallComplete(dshHome)
    note(
      result.ok
        ? '[desktop] profile repair completed'
        : `[desktop] profile repair failed: ${result.detail ?? 'unknown error'}`
    )
    return result
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    note(`[desktop] profile repair failed: ${detail}`)
    return { ok: false, detail }
  }
}
