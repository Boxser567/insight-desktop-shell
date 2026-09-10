import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Startup page presentation', () => {
  it('uses the minimal page for startup and session restoration without changing offline recovery', async () => {
    const app = await readFile('src/renderer/src/App.tsx', 'utf8')

    expect(app).toContain('<StartupPage detail={startup.detail} />')
    expect(app).toContain('<StartupPage detail="正在安全恢复登录状态…" />')
    expect(app).not.toContain('title="正在启动因赛AI"')
    expect(app).toMatch(/<StatusPage\s+title="暂时无法连接网络"/)
    expect(app).toContain("action={{ label: '重新连接', run: () => void window.insightAuth.retry() }}")
  })

  it('shows only the brand mark and live status text in the startup content', async () => {
    const app = await readFile('src/renderer/src/App.tsx', 'utf8')
    const component = app.match(/function StartupPage\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(component).toContain('className="startup-content"')
    expect(component).toContain('<img src={brandMark} alt="" />')
    expect(component).toContain('<p role="status">{props.detail}</p>')
    expect(component).not.toMatch(/<h1|status-card|<button/)
  })

  it('isolates the undecorated startup layout from the existing status card and login branding', async () => {
    const css = await readFile('src/renderer/src/styles.css', 'utf8')
    const rule = (selector: string): string => css.slice(css.indexOf(`${selector} {`)).split('}')[0] ?? ''
    const content = rule('.startup-content')

    expect(content).toContain('display: grid')
    expect(content).toContain('justify-items: center')
    expect(content).toContain('gap: 24px')
    expect(content).not.toMatch(/background:|border:|box-shadow:/)
    expect(rule('.startup-content .brand-mark')).toMatch(/width: 56px;\s+height: 56px/)
    expect(rule('.startup-content .brand-mark')).toContain('box-shadow: none')
    expect(rule('.startup-content p')).toContain('font-size: 14px')
    expect(rule('.startup-content p')).toContain('color: var(--muted)')
    expect(rule('.status-card')).toContain('background: var(--surface)')
    expect(rule('.brand-mark')).toContain('box-shadow: 0 8px 24px')
  })
})
