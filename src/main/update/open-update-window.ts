interface ManualUpdateChecker {
  check(manual: boolean): Promise<void>
}

interface UpdateWindowOpener {
  open(): Promise<void>
}

/** Start a manual check before the status window reads its initial state. */
export async function openUpdateWindowAndCheck(
  manager: ManualUpdateChecker,
  window: UpdateWindowOpener
): Promise<void> {
  const check = manager.check(true)
  await Promise.all([check, window.open()])
}
