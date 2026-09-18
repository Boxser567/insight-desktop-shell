import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  desktopServiceEnvironment,
  skillProxyServiceBaseUrl,
  type DesktopServiceEnvironmentName
} from '../src/shared/service-environment'

describe('desktop service environment', () => {
  it('routes skills to the enterprise service in the selected environment, not LLM /v1', () => {
    expect(skillProxyServiceBaseUrl('test')).toBe('https://gapi-test.insight-aigc.com/insight-harness-service')
    expect(skillProxyServiceBaseUrl('production')).toBe('https://gapi.insight-aigc.com/insight-harness-service')
  })
  it('selects the test services for RC2', () => {
    expect(desktopServiceEnvironment()).toEqual({
      name: 'test',
      authOrigin: 'https://gapi-test.insight-aigc.com',
      modelBaseUrl: 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1'
    })
  })

  it.each<[DesktopServiceEnvironmentName, string, string]>([
    [
      'test',
      'https://gapi-test.insight-aigc.com',
      'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1'
    ],
    [
      'production',
      'https://gapi.insight-aigc.com',
      'https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1'
    ]
  ])('keeps auth and model services in the same %s environment', (
    name,
    authOrigin,
    modelBaseUrl
  ) => {
    expect(desktopServiceEnvironment(name)).toEqual({ name, authOrigin, modelBaseUrl })
  })

  it('keeps endpoint literals out of both runtime consumers', async () => {
    const [authSource, modelSource] = await Promise.all([
      readFile(new URL('../src/main/auth/auth-environment.ts', import.meta.url), 'utf8'),
      readFile(new URL(
        '../packages/insight-desktop-integration/src/model-gateway.ts',
        import.meta.url
      ), 'utf8')
    ])

    expect(authSource).toContain('desktopServiceEnvironment(')
    expect(modelSource).toContain('desktopServiceEnvironment().modelBaseUrl')
    expect(`${authSource}\n${modelSource}`).not.toContain('gapi-test.insight-aigc.com')
    expect(`${authSource}\n${modelSource}`).not.toContain('gapi.insight-aigc.com')
  })
})
