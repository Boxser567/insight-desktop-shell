import { useEffect, useRef, useState } from 'react'
import brandMark from '../../../build/brand-mark.svg'
import { updateViewModel, type UpdateViewAction } from './update-view-model'
import type { DesktopUpdateWindowApi } from '../../shared/update-api'
import type { UpdateStatus } from '../../shared/update-contracts'

const actionLabels: Record<UpdateViewAction, string> = {
  check: '检查更新',
  download: '下载更新',
  'download-full-installer': '下载完整安装包',
  retry: '重试',
  skip: '跳过这个版本',
  quit: '退出因赛AI'
}

function runAction(api: DesktopUpdateWindowApi, action: UpdateViewAction, status: UpdateStatus): Promise<void> {
  switch (action) {
    case 'check':
    case 'retry':
      return 'track' in status && status.track === 'candidate'
        ? api.checkCandidate()
        : api.checkStable()
    case 'download':
      return api.download()
    case 'download-full-installer':
      return api.downloadFullInstaller()
    case 'skip':
      return status.phase === 'available'
        ? api.skip(status.availableVersion)
        : Promise.resolve()
    case 'quit':
      return api.quit()
  }
}

function actionLabel(action: UpdateViewAction, status: UpdateStatus): string {
  return action === 'download-full-installer' &&
    'track' in status && status.track === 'candidate'
    ? '下载正式版完整安装包'
    : actionLabels[action]
}

export function UpdateApp(): React.JSX.Element {
  const api = window.insightDesktopUpdates as DesktopUpdateWindowApi
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle', currentVersion: '—' })
  const [commandError, setCommandError] = useState<string>()
  const logoClicks = useRef({ count: 0, startedAt: 0, pending: false })

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

  const clickLogo = (): void => {
    const clicks = logoClicks.current
    if (clicks.pending) return
    const now = Date.now()
    if (now - clicks.startedAt > 3_000) {
      clicks.count = 0
      clicks.startedAt = now
    }
    clicks.count += 1
    if (clicks.count < 5) return
    clicks.count = 0
    clicks.pending = true
    setCommandError(undefined)
    void api.checkCandidate().catch((error: unknown) => {
      setCommandError(error instanceof Error ? error.message : String(error))
    }).finally(() => { clicks.pending = false })
  }

  return (
    <main className="update-page">
      <section className="update-summary" aria-live="polite">
        <button type="button" className={model.busy ? 'update-logo update-logo--busy' : 'update-logo'} onClick={clickLogo} aria-label="因赛AI 标志">
          <img src={brandMark} alt="" />
        </button>
        <div className="update-content">
          <div className="update-title-row">
            <h1>{model.title}</h1>
            {model.badge && <span className="update-track-badge">{model.badge}</span>}
          </div>
          <p>{model.detail}</p>
          {commandError && <p className="update-error">{commandError}</p>}
          {model.recovery && (
            <button type="button" className="update-recovery" onClick={() => execute(model.recovery!)}>
              {actionLabel(model.recovery, status)}
            </button>
          )}
          {(status.phase === 'checking' || status.phase === 'installing') && (
            <progress
              className="update-progress update-progress--checking"
              aria-label={status.phase === 'installing' ? '正在准备安装' : '正在检查更新'}
            />
          )}
          {status.phase === 'downloading' && (
            <progress className="update-progress" max="100" value={status.percent}>
              {status.percent}%
            </progress>
          )}
        </div>
      </section>
      <footer className="update-actions">
        {model.secondary && (
          <button type="button" className="secondary" onClick={() => execute(model.secondary!)}>
            {actionLabel(model.secondary, status)}
          </button>
        )}
        <span />
        {status.phase === 'available' && !status.required && (
          <button type="button" className="secondary" onClick={() => window.close()}>稍后提醒我</button>
        )}
        {model.primary && (
          <button type="button" className="primary" onClick={() => execute(model.primary!)}>
            {actionLabel(model.primary, status)}
          </button>
        )}
      </footer>
    </main>
  )
}
