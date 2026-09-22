import type { UpdateStatus } from './update-contracts'

export interface DesktopUpdateApi {
  status(): Promise<UpdateStatus>
  subscribe(listener: (status: UpdateStatus) => void): () => void
  open(): Promise<void>
  checkStable(): Promise<void>
  download(): Promise<void>
  downloadFullInstaller(): Promise<void>
  install(): Promise<void>
  skip(version: string): Promise<void>
}

export interface DesktopUpdateWindowApi extends DesktopUpdateApi {
  checkCandidate(): Promise<void>
  quit(): Promise<void>
}
