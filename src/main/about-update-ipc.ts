import type { IpcMain } from 'electron'
import type { UpdatePreferenceService } from './update/update-preferences'

interface InvokeEvent {
  sender: unknown
  senderFrame: unknown
}

const CHANNELS = [
  'about-updates:preference',
  'about-updates:set-candidate-opt-in',
  'about-updates:open-candidate-check'
] as const

export function registerAboutUpdateIpc(input: {
  ipcMain: IpcMain
  preferences: UpdatePreferenceService
  assertTrusted(event: InvokeEvent): void
  confirmCandidateOptIn(): Promise<boolean>
  openCandidateCheck(): Promise<void>
}): () => void {
  for (const channel of CHANNELS) input.ipcMain.removeHandler(channel)

  input.ipcMain.handle('about-updates:preference', async (event) => {
    input.assertTrusted(event)
    return input.preferences.read()
  })
  input.ipcMain.handle('about-updates:set-candidate-opt-in', async (event, value: unknown) => {
    input.assertTrusted(event)
    if (typeof value !== 'boolean') throw new Error('Candidate preference must be a boolean.')

    const current = await input.preferences.read()
    if (value && !current.candidateOptIn && !(await input.confirmCandidateOptIn())) {
      return current
    }
    await input.preferences.setCandidateOptIn(value)
    return input.preferences.read()
  })
  input.ipcMain.handle('about-updates:open-candidate-check', async (event) => {
    input.assertTrusted(event)
    await input.openCandidateCheck()
  })

  return () => {
    for (const channel of CHANNELS) input.ipcMain.removeHandler(channel)
  }
}
