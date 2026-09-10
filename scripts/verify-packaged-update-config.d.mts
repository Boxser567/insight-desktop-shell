export interface PackagedUpdateConfigVerification {
  configPath: string
  provider: 'generic'
  url: string
}

export function verifyPackagedUpdateConfig(
  resourcesDirectory: string
): Promise<PackagedUpdateConfigVerification>
