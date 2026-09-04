import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/update-contracts'

function highlighted(status: UpdateStatus): boolean {
  return status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded' ||
    (status.phase === 'error' && status.required)
}

/** Show a non-blocking update entry on every unauthenticated Shell surface. */
export function UpdateBadge(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle', currentVersion: '—' })
  useEffect(() => {
    let active = true
    const unsubscribe = window.insightDesktopUpdates.subscribe(setStatus)
    void window.insightDesktopUpdates.status().then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <button
      type="button"
      className="update-badge"
      data-active={highlighted(status) ? 'true' : undefined}
      aria-label="打开客户端更新"
      title="检查客户端更新"
      onClick={() => void window.insightDesktopUpdates.open()}
    >
      ↓
    </button>
  )
}
