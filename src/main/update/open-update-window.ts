interface ManualUpdateChecker {
  check(track: 'stable' | 'candidate', manual: boolean): Promise<void>
}

interface UpdateWindowOpener {
  open(): Promise<void>
}

/** Start a manual check before the status window reads its initial state. */
export async function openUpdateWindowAndCheck(
  manager: ManualUpdateChecker,
  window: UpdateWindowOpener,
  track: 'stable' | 'candidate' = 'stable'
): Promise<void> {
  const check = manager.check(track, true)
  await Promise.all([check, window.open()])
}
