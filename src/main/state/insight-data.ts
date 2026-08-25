import { join } from 'node:path'

/** Returns the directory Insight owns inside Electron user data. */
export function insightDataPath(userDataPath: string): string {
  return join(userDataPath, 'insight')
}
