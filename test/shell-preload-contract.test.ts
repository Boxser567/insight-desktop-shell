import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Shell preload contract', () => {
  it('exposes only session commands and renderer-safe workspace actions', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'src', 'preload', 'shell.ts'),
      'utf8'
    )

    expect(source).toContain("exposeInMainWorld('insightAuth'")
    expect(source).toContain("exposeInMainWorld('insightWorkspace'")
    expect(source).toContain("ipcRenderer.invoke('auth:current')")
    expect(source).toContain("ipcRenderer.invoke('auth:login-sms'")
    expect(source).toContain("ipcRenderer.invoke('auth:login-password'")
    expect(source).toContain("ipcRenderer.invoke('workspace:set-bounds'")
    expect(source).not.toMatch(/getToken|readToken|getCookie|readCookie|getUserId/)
  })

  it('keeps deferred account flows out of the first login surface', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'LoginView.tsx'),
      'utf8'
    )

    expect(source).not.toMatch(/注册|忘记密码|邀请码/)
    expect(source).not.toMatch(/localStorage|sessionStorage|\bfetch\s*\(/)
  })
})
