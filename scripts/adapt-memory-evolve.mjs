import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MEMORY_COMPAT_VERSION = '0.1.0-insight.1'

function replaceReviewed(source, before, after) {
  if (source.includes(after)) return source
  if (source.split(before).length !== 2) throw new Error('Review the pinned Memory Evolve integration before adapting it.')
  return source.replace(before, after)
}

const authorization = `// Core's browser authentication also protects community-plugin HTTP routes.
export function authorizeMemoryRequest(ctx, req, res) {
  const connection = ctx.get('connection')
  const rejection = connection ? connection.requestRejection(req) : 401
  if (rejection === undefined) return true
  res.writeHead(rejection)
  res.end()
  return false
}
`

/** Adapt the reviewed upstream package without changing its stores or memory format. */
export async function adaptMemoryEvolvePackage(directory) {
  const manifestPath = join(directory, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.name !== 'dsh-memory-evolve' || !['0.1.0', MEMORY_COMPAT_VERSION].includes(manifest.version)) {
    throw new Error('Review Memory Evolve compatibility for the new plugin version.')
  }
  const clientPath = join(directory, 'lib/client.js')
  let client = await readFile(clientPath, 'utf8')
  client = replaceReviewed(client,
    'var inject = ["slots", "locale", "conversation", "sessions"];',
    'var inject = ["slots", "locale", "uiConversation", "uiWorkspace"];')
  if (client.includes('ctx.sessions.open(')) {
    if (client.split('ctx.sessions.open(').length !== 3) throw new Error('Review Memory Evolve session navigation.')
    client = client.replaceAll('ctx.sessions.open(', 'ctx.uiWorkspace.openSession(')
  }
  const routes = [
    'api.js', 'skills-manager.js', 'notify-web.js', 'canvas.js', 'bookmarks.js',
    'ui-settings.js', 'coi/api.js', 'coi/broadcast-api.js', 'prompts.js', 'advisor/api.js', 'mermaid.js'
  ]
  const adaptedRoutes = []
  for (const file of routes) {
    const path = join(directory, 'lib', file)
    let source = await readFile(path, 'utf8')
    const before = source.includes('const handler = async (req, res) => {')
      ? 'const handler = async (req, res) => {' : 'handler: async (req, res) => {'
    source = replaceReviewed(source, before, `${before}\n        if (!authorizeMemoryRequest(ctx, req, res)) return`)
    const importLine = `import { authorizeMemoryRequest } from '${file.includes('/') ? '../' : './'}insight-auth.js'\n`
    if (!source.startsWith(importLine)) source = importLine + source
    adaptedRoutes.push([path, source])
  }
  manifest.version = MEMORY_COMPAT_VERSION
  manifest.dsh.client.inject = [
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-ui-primitives'
  ]
  manifest.peerDependencies = { '@deepseek-ai/dsh-tools': '0.2.1-rc.2' }
  for (const [path, source] of adaptedRoutes) await writeFile(path, source)
  await writeFile(join(directory, 'lib/insight-auth.js'), authorization)
  await writeFile(clientPath, client)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/adapt-memory-evolve.mjs <extracted-package>')
  await adaptMemoryEvolvePackage(process.argv[2])
}
