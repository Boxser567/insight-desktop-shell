import { readFileSync } from 'node:fs'

export interface RuntimeManifest {
  schemaVersion: 1
  core: {
    source: 'release'
    repository: string
    version: string
    commit: string
    releaseTag: string
  }
  harness: {
    entry: string
  }
  node: {
    version: string
  }
  target: {
    platform: string
    arch: string
  }
  checksums: {
    archiveSha256: string
  }
}

/** Reads and verifies the generated runtime identity bundled with the desktop app. */
export function readRuntimeManifest(path: string): RuntimeManifest {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRuntimeManifest(value)) throw new Error(`Invalid runtime manifest: ${path}`)
  return value
}

function isRuntimeManifest(value: unknown): value is RuntimeManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Record<string, unknown>
  const core = manifest.core as Record<string, unknown> | undefined
  const harness = manifest.harness as Record<string, unknown> | undefined
  const node = manifest.node as Record<string, unknown> | undefined
  const target = manifest.target as Record<string, unknown> | undefined
  const checksums = manifest.checksums as Record<string, unknown> | undefined

  return (
    manifest.schemaVersion === 1 &&
    core?.source === 'release' &&
    typeof core.repository === 'string' &&
    typeof core.version === 'string' &&
    typeof core.commit === 'string' &&
    typeof core.releaseTag === 'string' &&
    typeof harness?.entry === 'string' &&
    typeof node?.version === 'string' &&
    typeof target?.platform === 'string' &&
    typeof target.arch === 'string' &&
    typeof checksums?.archiveSha256 === 'string'
  )
}
