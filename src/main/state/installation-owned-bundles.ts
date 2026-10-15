/** Product integration bundle installed and repaired with the desktop app. */
export const DESKTOP_INTEGRATION_PACKAGE = '@insight-ai/desktop-integration'
export const WORKFLOW_PACKAGE = '@insight-ai/insight-workflow-op'

/** Whether a profile package is owned by the desktop installation. */
export function isInstallationOwnedBundle(packageName: string): boolean {
  return packageName === DESKTOP_INTEGRATION_PACKAGE || packageName === WORKFLOW_PACKAGE
}
