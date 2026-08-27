import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CredentialStore,
  CredentialStorageUnavailableError,
  type CredentialCipher
} from '../src/main/auth/credential-store'

const testDir = join(import.meta.dirname, '.temp-credential-store-test')

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decrypt: (value) => value.toString('utf8').replace(/^encrypted:/, '')
}

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('desktop credential store', () => {
  it('round-trips a token without writing plaintext', async () => {
    const file = join(testDir, 'test.json')
    const store = new CredentialStore(file, cipher)

    await store.save('access-secret')

    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('access-secret')
    await expect(store.load()).resolves.toBe('access-secret')
  })

  it('refuses persistence when encryption is unavailable', async () => {
    const store = new CredentialStore(join(testDir, 'test.json'), {
      ...cipher,
      available: () => false
    })

    await expect(store.save('secret')).rejects.toBeInstanceOf(
      CredentialStorageUnavailableError
    )
  })

  it('clears a corrupt credential file without throwing', async () => {
    const file = join(testDir, 'test.json')
    await mkdir(testDir, { recursive: true })
    await writeFile(file, '{broken', 'utf8')
    const store = new CredentialStore(file, cipher)

    await expect(store.load()).resolves.toBeUndefined()
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
