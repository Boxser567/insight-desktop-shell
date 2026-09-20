import configuration from '../../build/client-service-environment.json'

export type DesktopServiceEnvironmentName = 'test' | 'production'

export interface DesktopServiceEnvironment {
  readonly name: DesktopServiceEnvironmentName
  readonly authOrigin: string
  readonly modelBaseUrl: string
}

/** Return the repository-selected pair of desktop business services. */
export function desktopServiceEnvironment(
  name?: DesktopServiceEnvironmentName
): DesktopServiceEnvironment {
  const configured = configuration.releaseEnvironment as DesktopServiceEnvironmentName
  const runtime = (globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env?.INSIGHT_DESKTOP_SERVICE_ENVIRONMENT
  const selected: DesktopServiceEnvironmentName = name ?? (
    runtime === 'test' || runtime === 'production' ? runtime : configured
  )
  const value = configuration.environments[selected]
  if (!value) throw new Error(`Unsupported desktop service environment: ${selected}`)
  return Object.freeze({ name: selected, ...value })
}

/** Skill proxy follows the selected Gateway origin, not the LLM /v1 endpoint. */
export function skillProxyServiceBaseUrl(name?: DesktopServiceEnvironmentName): string {
  return desktopServiceEnvironment(name).authOrigin + '/insight-harness-service'
}
