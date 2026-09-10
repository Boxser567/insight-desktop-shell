import configuration from '../../build/client-service-environment.json'

export type DesktopServiceEnvironmentName = 'test' | 'production'

export interface DesktopServiceEnvironment {
  readonly name: DesktopServiceEnvironmentName
  readonly authOrigin: string
  readonly modelBaseUrl: string
}

/** Return the repository-selected pair of desktop business services. */
export function desktopServiceEnvironment(
  name: DesktopServiceEnvironmentName =
    configuration.releaseEnvironment as DesktopServiceEnvironmentName
): DesktopServiceEnvironment {
  const value = configuration.environments[name]
  if (!value) throw new Error(`Unsupported desktop service environment: ${name}`)
  return Object.freeze({ name, ...value })
}
