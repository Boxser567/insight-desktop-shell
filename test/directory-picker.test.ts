import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke }
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('desktop Electron directory picker', () => {
  it('exposes a narrow preload bridge and handles it in the main process', async () => {
    const preload = await readFile('src/preload/harness.ts', 'utf8')
    const main = await readFile('src/main/index.ts', 'utf8')

    expect(preload).toContain("contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__'")
    expect(preload).toContain("ipcRenderer.invoke('directory-picker:open')")
    expect(main).toContain("ipcMain.handle('directory-picker:open'")
    expect(main).toContain('event.senderFrame !== mainWindow.webContents.mainFrame')
    expect(main).toContain('dialog.showOpenDialog(mainWindow')
    expect(main).toContain("properties: ['openDirectory']")
    expect(main).toContain("app.commandLine.appendSwitch('lang', harnessLocale() === 'zh' ? 'zh-CN' : 'en-US')")
  })

  it('exposes the Core picker hook and preserves selections, cancellation and IPC failures', async () => {
    vi.stubGlobal('document', { readyState: 'loading' })
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    await import('../src/preload/harness')
    const bridge = electron.exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_DIRECTORY_PICKER__')?.[1] as {
      pick(): Promise<string | null>
    }
    expect(bridge).toBeDefined()
    electron.invoke.mockResolvedValueOnce('/workspace')
    await expect(bridge.pick()).resolves.toBe('/workspace')
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('directory-picker:open')
    electron.invoke.mockResolvedValueOnce(null)
    await expect(bridge.pick()).resolves.toBeNull()
    electron.invoke.mockRejectedValueOnce(new Error('dialog unavailable'))
    await expect(bridge.pick()).rejects.toThrow('dialog unavailable')
  })

  it('keeps native Chinese resources for both macOS and Windows locale names', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      build?: { electronLanguages?: string[] }
    }

    expect(packageJson.build?.electronLanguages).toEqual(
      expect.arrayContaining(['zh-CN', 'zh_CN', 'zh-TW', 'zh_TW'])
    )
  })

  it('keeps the stock picker composition: the seam comes from the stock auto row', async () => {
    const desktopPatch = await readFile('build/dsh-desktop.patch.yml', 'utf8')

    // No picker rows at all - the stock auto row mounts the native backend.
    expect(desktopPatch).not.toMatch(/id:\s*directory-picker/)
    expect(desktopPatch).not.toContain('dsh-client-ui-directory-picker-native')
  })

  it('keeps the bridge in the Shell instead of restoring registry dependency patches', async () => {
    const packageJson = await readFile('package.json', 'utf8')

    expect(packageJson).not.toContain('@deepseek-ai/dsh-host-apiproxy')
    expect(packageJson).not.toContain('@deepseek-ai/dsh-client-ui-directory-picker-native')
  })
})
