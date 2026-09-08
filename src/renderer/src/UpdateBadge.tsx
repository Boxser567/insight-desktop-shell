import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/update-contracts'
import { shouldShowUpdateEntry } from '../../shared/update-visibility'

/** Show a non-blocking update entry on every unauthenticated Shell surface. */
export function UpdateBadge(): React.JSX.Element | null {
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

  if (!shouldShowUpdateEntry(status)) return null

  const version = 'availableVersion' in status ? status.availableVersion : undefined

  return (
    <button
      type="button"
      className="update-badge"
      data-active="true"
      aria-label="打开客户端更新"
      title={version ? `发现客户端 ${version} 更新` : '客户端更新'}
      onClick={() => void window.insightDesktopUpdates.open()}
    >
      ↓
    </button>
  )
}
