import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REQUIRED_PACKAGE_PATTERNS = [
  "    /^dsh-better-sidebar$/u,",
  "    /^@insight-ai\\/desktop-integration$/u,"
]
const POLICY_MARKER = '// Insight Desktop required capabilities.'

function addProtectedPackagePatterns(source) {
  if (source.includes(POLICY_MARKER)) return source

  const listStart = source.indexOf('const PROTECTED_MODULE_PATTERNS = [')
  const listEnd = source.indexOf('\n];', listStart)
  if (listStart === -1 || listEnd === -1) {
    throw new Error('dshmarket protected-module list was not found; review the pinned market integration before building.')
  }

  const addition = `\n    ${POLICY_MARKER}\n${REQUIRED_PACKAGE_PATTERNS.join('\n')}`
  return `${source.slice(0, listEnd)}${addition}${source.slice(listEnd)}`
}

function protectMutationRoute(source, route) {
  const routeAnchor = `path: '/dsh-market/${route}'`
  const routeStart = source.indexOf(routeAnchor)
  if (routeStart === -1) {
    throw new Error(`dshmarket ${route} route was not found; review the pinned market integration before building.`)
  }

  const nameLine = "                        const name = typeof body.name === 'string' ? body.name : '';"
  const nextRoute = source.indexOf("path: '/dsh-market/", routeStart + routeAnchor.length)
  const routeEnd = nextRoute === -1 ? source.length : nextRoute
  const nameStart = source.indexOf(nameLine, routeStart)
  if (nameStart === -1 || nameStart >= routeEnd) {
    throw new Error(`dshmarket ${route} request parser was not found; review the pinned market integration before building.`)
  }

  const guardMarker = `// Insight Desktop protects required capabilities from market ${route}.`
  if (source.slice(routeStart, routeEnd).includes(guardMarker)) return source

  const guard = `\n                        ${guardMarker}\n                        if (isProtectedModule(name)) {\n                            sendJson(response, 403, { error: \`${'${name}'} is managed by Insight Desktop and cannot be ${route === 'update' ? 'updated' : 'uninstalled'} from the plugin market\` });\n                            return;\n                        }`
  const insertAt = nameStart + nameLine.length
  return `${source.slice(0, insertAt)}${guard}${source.slice(insertAt)}`
}

function hideProtectedListEntries(source, route) {
  const routeAnchor = `path: '/dsh-market/${route}'`
  const routeStart = source.indexOf(routeAnchor)
  if (routeStart === -1) {
    throw new Error(`dshmarket ${route} route was not found; review the pinned market integration before building.`)
  }
  const nextRoute = source.indexOf("path: '/dsh-market/", routeStart + routeAnchor.length)
  const routeEnd = nextRoute === -1 ? source.length : nextRoute
  const marker = `// Insight Desktop hides required capabilities from market ${route}.`
  if (source.slice(routeStart, routeEnd).includes(marker)) return source

  const isInstalledRoute = route === 'installed'
  const responseAnchor = isInstalledRoute
    ? [
        '                sendJson(response, 200, {',
        '                    profile: config.profile,',
        '                    installed,'
      ].join('\n')
    : '                    sendJson(response, 200, { updates });'
  const responseStart = source.indexOf(responseAnchor, routeStart)
  if (responseStart === -1 || responseStart >= routeEnd) {
    throw new Error(`dshmarket ${route} response was not found; review the pinned market integration before building.`)
  }

  const replacement = isInstalledRoute
    ? [
        `                ${marker}`,
        '                const visibleInstalled = Object.fromEntries(',
        '                    Object.entries(installed).filter(([name]) => !isProtectedModule(name)),',
        '                );',
        '                sendJson(response, 200, {',
        '                    profile: config.profile,',
        '                    installed: visibleInstalled,'
      ].join('\n')
    : [
        `                    ${marker}`,
        '                    const visibleUpdates = Object.fromEntries(',
        '                        Object.entries(updates).filter(([name]) => !isProtectedModule(name)),',
        '                    );',
        '                    sendJson(response, 200, { updates: visibleUpdates });'
      ].join('\n')
  return `${source.slice(0, responseStart)}${replacement}${source.slice(responseStart + responseAnchor.length)}`
}

/** Apply the pinned dshmarket host policy to a prepared desktop Profile. */
export async function patchBundledMarket(profileDirectory) {
  const marketRoot = join(profileDirectory, 'node_modules', 'dshmarket', 'lib')
  const patchPath = join(marketRoot, 'patch.js')
  const routesPath = join(marketRoot, 'routes.js')
  const patchSource = addProtectedPackagePatterns(await readFile(patchPath, 'utf8'))
  let routesSource = await readFile(routesPath, 'utf8')
  routesSource = hideProtectedListEntries(routesSource, 'installed')
  routesSource = hideProtectedListEntries(routesSource, 'updates')
  routesSource = protectMutationRoute(routesSource, 'update')
  routesSource = protectMutationRoute(routesSource, 'uninstall')
  await writeFile(patchPath, patchSource, 'utf8')
  await writeFile(routesPath, routesSource, 'utf8')
}
