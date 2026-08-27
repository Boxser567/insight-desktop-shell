import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop Electron directory picker', () => {
  it('exposes a narrow preload bridge and handles it in the main process', async () => {
    const preload = await readFile('src/preload/index.ts', 'utf8')
    const main = await readFile('src/main/index.ts', 'utf8')

    expect(preload).toContain("contextBridge.exposeInMainWorld('dshDesktopDirectoryPicker'")
    expect(preload).toContain("ipcRenderer.invoke('directory-picker:open')")
    expect(main).toContain("ipcMain.handle('directory-picker:open'")
    expect(main).toContain('event.senderFrame !== mainWindow.webContents.mainFrame')
    expect(main).toContain('dialog.showOpenDialog(mainWindow')
    expect(main).toContain("properties: ['openDirectory']")
    expect(main).toContain("app.commandLine.appendSwitch('lang', harnessLocale() === 'zh' ? 'zh-CN' : 'en-US')")
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
