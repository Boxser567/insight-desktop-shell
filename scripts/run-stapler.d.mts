export interface StaplerResult {
  status: number
  stdout?: string
  stderr?: string
}

export function runStapler(action: string, path: string, options?: {
  run?: (action: string, path: string) => Promise<StaplerResult>
  delay?: (milliseconds: number) => Promise<unknown>
  writeOutput?: (stdout: string, stderr: string) => void
  writeWarning?: (message: string) => void
}): Promise<void>
