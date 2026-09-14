import { gte } from 'semver'

/** Core's loopback cookie exchange was introduced in this prerelease. */
export function coreRequiresLaunchToken(version: string): boolean {
  return gte(version, '0.1.2-alpha.1')
}

/** Accept a launch URL only from the expected local server's stdout announcement. */
export function extractHarnessLaunchToken(line: string, origin: string): string | undefined {
  const match = /\bdsh web:\s*(\S+)/u.exec(line)
  if (!match?.[1]) return undefined
  try {
    const url = new URL(match[1])
    if (url.origin !== origin || url.pathname !== '/') return undefined
    return url.searchParams.get('token') || undefined
  } catch { return undefined }
}

/** Runtime logs and snapshots must not publish the per-process cookie exchange secret. */
export function redactHarnessLaunchToken(line: string): string {
  return line.replace(/([?&]token=)[^\s&#]+/gu, '$1[redacted]')
}
