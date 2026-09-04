import type { UpdateStatus } from './update-contracts'

export interface DesktopUpdateApi {
  status(): Promise<UpdateStatus>
  subscribe(listener: (status: UpdateStatus) => void): () => void
  open(): Promise<void>
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  skip(version: string): Promise<void>
}

export interface DesktopUpdateWindowApi extends DesktopUpdateApi {
  quit(): Promise<void>
}
