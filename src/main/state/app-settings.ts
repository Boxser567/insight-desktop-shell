import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

interface PersistedSettings {
  version: 1
  lastWorkspace?: string
  recentWorkspaces: string[]
}

const EMPTY_SETTINGS: PersistedSettings = {
  version: 1,
  recentWorkspaces: []
}

export class AppSettingsStore {
  private settings: PersistedSettings = structuredClone(EMPTY_SETTINGS)

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<PersistedSettings>
      this.settings = {
        version: 1,
        lastWorkspace:
          typeof parsed.lastWorkspace === 'string' ? resolve(parsed.lastWorkspace) : undefined,
        recentWorkspaces: Array.isArray(parsed.recentWorkspaces)
          ? parsed.recentWorkspaces
              .filter((value): value is string => typeof value === 'string')
              .map((value) => resolve(value))
              .slice(0, 8)
          : []
      }
    } catch {
      this.settings = structuredClone(EMPTY_SETTINGS)
    }

    await this.removeMissingWorkspaces()
  }

  get lastWorkspace(): string | undefined {
    return this.settings.lastWorkspace
  }

  get recentWorkspaces(): string[] {
    return [...this.settings.recentWorkspaces]
  }

  async rememberWorkspace(workspace: string): Promise<void> {
    const normalized = resolve(workspace)
    this.settings.lastWorkspace = normalized
    this.settings.recentWorkspaces = [
      normalized,
      ...this.settings.recentWorkspaces.filter((entry) => entry !== normalized)
    ].slice(0, 8)
    await this.persist()
  }

  private async removeMissingWorkspaces(): Promise<void> {
    const checked = await Promise.all(
      this.settings.recentWorkspaces.map(async (workspace) => {
        try {
          return (await stat(workspace)).isDirectory() ? workspace : undefined
        } catch {
          return undefined
        }
      })
    )
    this.settings.recentWorkspaces = checked.filter(
      (workspace): workspace is string => workspace !== undefined
    )
    if (
      this.settings.lastWorkspace &&
      !this.settings.recentWorkspaces.includes(this.settings.lastWorkspace)
    ) {
      this.settings.lastWorkspace = undefined
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}
