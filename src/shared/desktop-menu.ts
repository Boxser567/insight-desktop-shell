export const WINDOWS_TITLEBAR_HEIGHT = 36

export const desktopMenuCommands = [
  'restart-harness',
  'show-harness-log',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'select-all',
  'reload',
  'toggle-devtools',
  'zoom-reset',
  'zoom-in',
  'zoom-out',
  'toggle-fullscreen',
  'quit'
] as const

export type DesktopMenuCommand = (typeof desktopMenuCommands)[number]

const desktopMenuCommandSet = new Set<string>(desktopMenuCommands)

export function isDesktopMenuCommand(value: unknown): value is DesktopMenuCommand {
  return typeof value === 'string' && desktopMenuCommandSet.has(value)
}
