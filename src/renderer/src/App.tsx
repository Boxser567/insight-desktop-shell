import { useEffect, useState } from 'react'
import type { SessionView } from '../../shared/auth-contracts'
import { LoginView } from './LoginView'

function StatusPage(props: {
  title: string
  detail: string
  action?: { label: string; run: () => void }
}): React.JSX.Element {
  return (
    <main className="status-page">
      <div className="status-card">
        <div className="brand-mark" aria-hidden="true">因</div>
        <h1>{props.title}</h1>
        <p>{props.detail}</p>
        {props.action && (
          <button className="primary-button" type="button" onClick={props.action.run}>
            {props.action.label}
          </button>
        )}
      </div>
    </main>
  )
}

/** Root Shell surface driven entirely by the renderer-safe session projection. */
export function App(): React.JSX.Element {
  const [session, setSession] = useState<SessionView>({ kind: 'restoring' })

  useEffect(() => {
    const unsubscribe = window.insightAuth.subscribe(setSession)
    void window.insightAuth.current().then(setSession).catch(() => {
      setSession({ kind: 'offline' })
    })
    return unsubscribe
  }, [])

  let content: React.JSX.Element
  if (session.kind === 'authenticated') {
    content = <main className="authenticated-host" aria-hidden="true" />
  } else if (session.kind === 'restoring') {
    content = <StatusPage title="正在启动因赛AI" detail="正在安全恢复登录状态…" />
  } else if (session.kind === 'offline') {
    content = (
      <StatusPage
        title="暂时无法连接网络"
        detail="登录状态仍被安全保留。网络恢复后请重试。"
        action={{ label: '重新连接', run: () => void window.insightAuth.retry() }}
      />
    )
  } else {
    content = (
      <LoginView
        busy={session.kind === 'authenticating'}
        expired={session.kind === 'expired'}
      />
    )
  }
  return (
    <>
      {session.kind !== 'authenticated' && <div className="app-drag-region" aria-hidden="true" />}
      {content}
    </>
  )
}
