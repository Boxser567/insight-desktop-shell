const identityPattern = /^\s*\d+\)\s+([0-9a-f]{40})\s+"([^"]+)"\s*$/iu

export function findDeveloperIdApplicationIdentity(output, teamId) {
  const suffix = ` (${teamId})`
  for (const line of output.split('\n')) {
    const match = identityPattern.exec(line)
    if (
      match &&
      match[2].startsWith('Developer ID Application: ') &&
      match[2].endsWith(suffix)
    ) {
      return match[1]
    }
  }
  return undefined
}
