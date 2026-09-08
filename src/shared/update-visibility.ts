import type { UpdateStatus } from './update-contracts'

/** Only expose product update controls after a real release has been verified. */
export function shouldShowUpdateEntry(status: UpdateStatus | undefined): boolean {
  if (!status) return false
  if (
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded' ||
    status.phase === 'installing'
  ) return true
  return status.phase === 'error' && status.manualInstallerAvailable
}
