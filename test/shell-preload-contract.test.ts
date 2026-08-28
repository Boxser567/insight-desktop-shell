import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Shell preload contract', () => {
  it('exposes only session commands to the unauthenticated Shell renderer', async () => {
    const source = await readFile(
      join(import.meta.dirname, '..', 'src', 'preload', 'shell.ts'),
      'utf8'
    )

    expect(source).toContain("exposeInMainWorld('insightAuth'")
    expect(source).toContain("ipcRenderer.invoke('auth:current')")
    expect(source).toContain("ipcRenderer.invoke('auth:login-sms'")
    expect(source).toContain("ipcRenderer.invoke('auth:login-password'")
    expect(source).not.toContain('insightWorkspace')
    expect(source).not.toContain('workspace:set-bounds')
    expect(source).not.toMatch(/getToken|readToken|getCookie|readCookie|getUserId/)
  })

  it('keeps authenticated navigation and settings out of the Shell renderer', async () => {
    const app = await readFile(join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const styles = await readFile(join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'styles.css'), 'utf8')

    expect(app).toContain('authenticated-host')
    expect(app).not.toContain('AuthenticatedShell')
    expect(styles).not.toMatch(/shell-rail|workspace-slot|account-menu|settings-panel/)
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
