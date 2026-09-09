import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authCredentialPath,
  createElectronAuth
} from '../src/main/auth/electron-auth'
import type { AuthEnvironmentConfig } from '../src/main/auth/auth-environment'

const testDir = join(import.meta.dirname, '.temp-electron-auth-test')
const environment: AuthEnvironmentConfig = {
  name: 'test',
  baseUrl: 'https://gapi-test.insight-aigc.com',
  partition: 'insight-auth-test'
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('Electron auth dependencies', () => {
  it('separates test and production credential files', () => {
    expect(authCredentialPath('/user-data/insight', 'test')).toBe(
      join('/user-data/insight', 'auth', 'test.json')
    )
    expect(authCredentialPath('/user-data/insight', 'production')).toBe(
      join('/user-data/insight', 'auth', 'production.json')
    )
  })

  it('keeps development auth in memory without touching persisted credentials', async () => {
    const credentialPath = authCredentialPath(testDir, 'test')
    const staleCredential = '{"version":1,"ciphertext":"stale-keychain-entry"}\n'
    await mkdir(join(testDir, 'auth'), { recursive: true })
    await writeFile(credentialPath, staleCredential, 'utf8')
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        code: 'SUCCESS',
        data: { accessToken: 'development-token' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'SUCCESS',
        data: { id: 42, userName: 'Alice', phoneNo: '13800138000' }
      }))
    const manager = createElectronAuth({
      environment,
      insightRoot: testDir,
      fetch,
      persistCredentials: false
    })

    await manager.restore()

    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
    expect(fetch).not.toHaveBeenCalled()
    await expect(
      manager.loginSms({ phone: '13800138000', code: '123456' })
    ).resolves.toEqual({ ok: true })
    expect(manager.current().kind).toBe('authenticated')
    await expect(readFile(credentialPath, 'utf8')).resolves.toBe(staleCredential)

    const restartedManager = createElectronAuth({
      environment,
      insightRoot: testDir,
      fetch: vi.fn(),
      persistCredentials: false
    })
    await restartedManager.restore()
    expect(restartedManager.current()).toEqual({ kind: 'unauthenticated' })
  })
})
