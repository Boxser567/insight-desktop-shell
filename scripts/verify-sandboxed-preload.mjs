import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = process.argv[2]
if (!path || process.argv.length !== 3) {
  throw new Error('Usage: verify-sandboxed-preload.mjs <bundled-preload>')
}

const source = await readFile(resolve(path), 'utf8')
const dependencies = [...source.matchAll(/require\(["']([^"']+)["']\)/gu)]
  .map((match) => match[1])
const unsupported = [...new Set(dependencies.filter((name) => name !== 'electron'))]
if (unsupported.length > 0) {
  throw new Error(`Sandboxed preload contains external runtime dependencies: ${unsupported.join(', ')}`)
}
if (
  !source.includes('ipcRenderer.invoke("desktop-secondary-theme:get")') ||
  !source.includes('desktop-secondary-theme:changed')
) {
  throw new Error('Sandboxed About preload bundle is incomplete.')
}
console.log('Sandboxed About preload bundle is self-contained.')
