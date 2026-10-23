export function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:' || parsed.protocol === 'dsh-recovery:') return true
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  topLevelUrl?: string,
  harnessUrl?: string
): boolean {
  if (permission === 'fullscreen') {
    if (
      requestingUrl === undefined ||
      topLevelUrl === undefined ||
      harnessUrl === undefined ||
      !isHarnessUrl(harnessUrl)
    ) {
      return false
    }
    try {
      const origin = new URL(harnessUrl).origin
      return new URL(topLevelUrl).origin === origin && new URL(requestingUrl).origin === origin
    } catch {
      return false
    }
  }

  return (
    permission === 'clipboard-sanitized-write' &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isHarnessUrl(requestingUrl)
  )
}
