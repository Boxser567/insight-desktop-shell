import { useEffect, useRef, useState } from 'react'
import type { AccountSummary } from '../../shared/auth-contracts'
import type { ShellInfo } from '../../shared/shell-api'

/** Authenticated Shell chrome surrounding the Harness WebContentsView. */
export function AuthenticatedShell(props: { account: AccountSummary }): React.JSX.Element {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [info, setInfo] = useState<ShellInfo>()

  useEffect(() => {
    const element = workspaceRef.current
    if (!element) return
    const report = (): void => {
      const rect = element.getBoundingClientRect()
      void window.insightWorkspace.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    report()
    return () => {
      observer.disconnect()
      void window.insightWorkspace.setBounds(null)
    }
  }, [])

  const openSettings = (): void => {
    setMenuOpen(false)
    setSettingsOpen(true)
    void window.insightWorkspace.info().then(setInfo).catch(() => setInfo(undefined))
  }

  return (
    <main className="shell-layout">
      <aside className="shell-rail">
        <div className="brand-mark small" title="因赛AI">因</div>
        <div className="account-area">
          {menuOpen && (
            <div className="account-menu">
              <button type="button" onClick={openSettings}>设置</button>
              <button type="button" className="danger" onClick={() => void window.insightAuth.signOut()}>退出</button>
            </div>
          )}
          <button className="account-trigger" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
            {props.account.avatarUrl ? <img src={props.account.avatarUrl} alt="用户头像" /> : <span className="avatar-fallback">{props.account.displayName.slice(0, 1) || '用'}</span>}
            <span><strong>{props.account.displayName}</strong><small>{props.account.maskedPhone}</small></span>
          </button>
        </div>
      </aside>
      <div ref={workspaceRef} className="workspace-slot" aria-label="Harness 工作区" />
      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
            <header><h2>设置</h2><button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button></header>
            <dl><div><dt>账号</dt><dd>{props.account.maskedPhone || props.account.displayName}</dd></div><div><dt>版本</dt><dd>{info?.version ?? '—'}</dd></div><div><dt>环境</dt><dd>{info?.environment === 'production' ? '生产环境' : '测试环境'}</dd></div></dl>
            <button className="secondary-button" type="button" onClick={() => void window.insightWorkspace.openAccountConfig()}>打开当前账号配置文件</button>
          </section>
        </div>
      )}
    </main>
  )
}
