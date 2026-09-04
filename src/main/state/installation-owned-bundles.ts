/** Product integration bundle installed and repaired with the desktop app. */
export const DESKTOP_INTEGRATION_PACKAGE = '@insight-ai/desktop-integration'

/** Required file and workspace UI bundled with the desktop app. */
export const REQUIRED_SIDEBAR_PACKAGE = 'dsh-better-sidebar'

/** Whether a profile package is owned by the desktop installation. */
export function isInstallationOwnedBundle(packageName: string): boolean {
  return packageName === DESKTOP_INTEGRATION_PACKAGE || packageName === REQUIRED_SIDEBAR_PACKAGE
}
