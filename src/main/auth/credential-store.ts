import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface CredentialFile {
  version: 1
  ciphertext: string
}

/** Encryption operations supplied by Electron safeStorage in production. */
export interface CredentialCipher {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

/** Raised when the host cannot encrypt a credential safely. */
export class CredentialStorageUnavailableError extends Error {
  constructor() {
    super('The operating system secure storage is unavailable.')
    this.name = 'CredentialStorageUnavailableError'
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

/** Persist one access token as safeStorage ciphertext. */
export class CredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: CredentialCipher
  ) {}

  async load(): Promise<string | undefined> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return undefined
      throw error
    }

    if (!this.cipher.available()) return undefined

    try {
      const parsed = JSON.parse(raw) as Partial<CredentialFile>
      if (parsed.version !== 1 || typeof parsed.ciphertext !== 'string') {
        throw new Error('Unsupported credential file.')
      }
      const token = this.cipher.decrypt(Buffer.from(parsed.ciphertext, 'base64'))
      if (!token) throw new Error('Empty credential.')
      return token
    } catch {
      await this.clear()
      return undefined
    }
  }

  async save(token: string): Promise<void> {
    if (!this.cipher.available()) throw new CredentialStorageUnavailableError()
    const encrypted: CredentialFile = {
      version: 1,
      ciphertext: this.cipher.encrypt(token).toString('base64')
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(encrypted)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
  }
}
