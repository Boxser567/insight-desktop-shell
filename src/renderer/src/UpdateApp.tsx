import { useEffect, useState } from 'react'
import brandMark from '../../../build/brand-mark.svg'
import { updateViewModel, type UpdateViewAction } from './update-view-model'
import type { DesktopUpdateWindowApi } from '../../shared/update-api'
import type { UpdateStatus } from '../../shared/update-contracts'

const actionLabels: Record<UpdateViewAction, string> = {
  check: '检查更新',
  download: '下载更新',
  install: '安装并重启',
  retry: '重试',
  skip: '跳过这个版本',
  quit: '退出因赛AI'
}

function runAction(api: DesktopUpdateWindowApi, action: UpdateViewAction, status: UpdateStatus): Promise<void> {
  switch (action) {
    case 'check':
    case 'retry':
      return api.check()
    case 'download':
      return api.download()
    case 'install':
      return api.install()
    case 'skip':
      return status.phase === 'available'
        ? api.skip(status.availableVersion)
        : Promise.resolve()
    case 'quit':
      return api.quit()
  }
}

export function UpdateApp(): React.JSX.Element {
  const api = window.insightDesktopUpdates as DesktopUpdateWindowApi
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle', currentVersion: '—' })
  const [commandError, setCommandError] = useState<string>()

  useEffect(() => {
    let active = true
    const unsubscribe = api.subscribe(setStatus)
    void api.status().then((value) => {
      if (active) setStatus(value)
    }).catch((error: unknown) => {
      if (active) setCommandError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const model = updateViewModel(status)
  const execute = (action: UpdateViewAction): void => {
    setCommandError(undefined)
    void runAction(api, action, status).catch((error: unknown) => {
      setCommandError(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <main className="update-page">
      <header className="update-brand">
        <span><img src={brandMark} alt="" /></span>
        <strong>因赛AI</strong>
      </header>
      <section className="update-copy" aria-live="polite">
        <h1>{model.title}</h1>
        <p>{model.detail}</p>
        {commandError && <p className="update-error">{commandError}</p>}
        {status.phase === 'downloading' && (
          <progress max="100" value={status.percent}>{status.percent}%</progress>
        )}
      </section>
      <footer className="update-actions">
        {status.phase === 'available' && !status.required && (
          <button type="button" className="quiet" onClick={() => window.close()}>稍后提醒我</button>
        )}
        <span />
        {model.secondary && (
          <button type="button" className="secondary" onClick={() => execute(model.secondary!)}>
            {actionLabels[model.secondary]}
          </button>
        )}
        {model.primary && (
          <button type="button" className="primary" onClick={() => execute(model.primary!)}>
            {actionLabels[model.primary]}
          </button>
        )}
      </footer>
    </main>
  )
}
