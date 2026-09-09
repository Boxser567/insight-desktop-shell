export interface SyspolicyResult {
  status: number
  stdout?: string
  stderr?: string
}

export interface MacosDistributionVerificationOptions {
  run?: (appPath: string) => Promise<SyspolicyResult>
  delay?: (milliseconds: number) => Promise<unknown>
  writeOutput?: (stdout: string, stderr: string) => void
  writeWarning?: (message: string) => void
}

export function isInternalXprotectFailure(status: number, output: string): boolean

export function verifyMacosDistribution(
  appPath: string,
  options?: MacosDistributionVerificationOptions
): Promise<{ degraded: boolean; attempts: number }>
