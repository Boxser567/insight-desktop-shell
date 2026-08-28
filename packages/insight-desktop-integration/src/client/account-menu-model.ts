/** Settings capability consumed by the account menu. */
export interface SettingsDialogFace {
  open(sectionId?: string): void
}

/** Sign-out capability consumed by the account menu. */
export interface AccountSignOutFace {
  signOut(): Promise<void>
}

/** Stable account-menu actions independent of the rendered menu state. */
export function accountMenuActions(
  settingsDialog: SettingsDialogFace,
  account: AccountSignOutFace
): { openSettings(): void; signOut(): Promise<void> } {
  return {
    openSettings: () => settingsDialog.open('client'),
    signOut: () => account.signOut()
  }
}
