import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REQUIRED_PACKAGE_PATTERNS = [
  "    /^dshmarket$/u,",
  "    /^dsh-better-sidebar$/u,",
  "    /^@insight-ai\\/desktop-integration$/u,"
]
const POLICY_MARKER = '// Insight Desktop required capabilities.'
const DESKTOP_RESTART_MARKER = '// Insight Desktop delegates Harness restarts to the desktop shell (v2).'
const DESKTOP_RESTART_CAPABILITY_MARKER = '// Insight Desktop exposes the shell restart capability.'
const RESTART_BUSY_MARKER = '// Insight Desktop reports every market mutation as restart-blocking.'
const MARKET_UNINSTALL_MARKER = '// Insight Desktop records an explicit market uninstall.'
const MANAGED_MARKET_MARKER = '// Insight Desktop owns the bundled market version.'

function addProtectedPackagePatterns(source) {
  const listStart = source.indexOf('const PROTECTED_MODULE_PATTERNS = [')
  const listEnd = source.indexOf('\n];', listStart)
  if (listStart === -1 || listEnd === -1) {
    throw new Error('dshmarket protected-module list was not found; review the pinned market integration before building.')
  }

  const missingPatterns = REQUIRED_PACKAGE_PATTERNS.filter(pattern => !source.includes(pattern.trim()))
  if (source.includes(POLICY_MARKER) && missingPatterns.length === 0) return source
  const addition = [
    '',
    ...(source.includes(POLICY_MARKER) ? [] : [`    ${POLICY_MARKER}`]),
    ...missingPatterns
  ].join('\n')
  return `${source.slice(0, listEnd)}${addition}${source.slice(listEnd)}`
}

function hideMarketSelfManagement(source) {
  if (source.includes(MANAGED_MARKET_MARKER)) return source
  const anchor = "                    selfManaged: installed.dshmarket !== undefined || installed['dsh-market'] !== undefined,"
  const anchorStart = source.indexOf(anchor)
  if (anchorStart === -1) {
    throw new Error('dshmarket self-management status was not found; review the pinned market integration before building.')
  }
  const replacement = [
    `                    ${MANAGED_MARKET_MARKER}`,
    '                    selfManaged: false,'
  ].join('\n')
  return `${source.slice(0, anchorStart)}${replacement}${source.slice(anchorStart + anchor.length)}`
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

function reportAllRestartBlockingMutations(source) {
  if (source.includes(RESTART_BUSY_MARKER)) return source

  const anchor = '                    busy: installing,'
  const anchorStart = source.indexOf(anchor)
  if (anchorStart === -1) {
    throw new Error('dshmarket status busy state was not found; review the pinned market integration before building.')
  }

  const replacement = [
    `                    ${RESTART_BUSY_MARKER}`,
    '                    busy: installing || writing,'
  ].join('\n')
  return `${source.slice(0, anchorStart)}${replacement}${source.slice(anchorStart + anchor.length)}`
}

function recordExplicitMarketUninstall(source) {
  if (source.includes(MARKET_UNINSTALL_MARKER)) return source

  const anchor = "                        pendingRollbacks.clear();\n                        const result = await runPlugin(config.profile, ['remove', selfName]);"
  const anchorStart = source.indexOf(anchor)
  if (anchorStart === -1) {
    throw new Error('dshmarket self-uninstall route was not found; review the pinned market integration before building.')
  }
  const successAnchor = '                        // Opt-in cleanup.'
  const successStart = source.indexOf(successAnchor, anchorStart)
  if (successStart === -1) {
    throw new Error('dshmarket self-uninstall success path was not found; review the pinned market integration before building.')
  }

  const addition = [
    `                        ${MARKET_UNINSTALL_MARKER}`,
    "                        writeFileSync(join(activeProfileDir, '.insight-market-uninstalled'), '1\\n', 'utf8');",
    ''
  ].join('\n')
  return `${source.slice(0, successStart)}${addition}${source.slice(successStart)}`
}

function exposeDesktopRestartCapability(source) {
  if (source.includes(DESKTOP_RESTART_CAPABILITY_MARKER)) return source

  const anchor = 'setRestartEnabled(status.restart === true);'
  const anchorStart = source.indexOf(anchor)
  if (anchorStart === -1) {
    throw new Error('dshmarket restart capability state was not found; review the pinned market integration before building.')
  }
  const lineStart = source.lastIndexOf('\n', anchorStart) + 1
  const indentation = source.slice(lineStart, anchorStart)
  const replacement = [
    `${DESKTOP_RESTART_CAPABILITY_MARKER}`,
    'setRestartEnabled(status.restart === true || typeof globalThis.dshDesktop?.restartHarness === "function");'
  ].map(line => `${indentation}${line}`).join('\n')
  return `${source.slice(0, lineStart)}${replacement}${source.slice(anchorStart + anchor.length)}`
}

function delegateRestartToDesktopShell(source) {
  if (source.includes(DESKTOP_RESTART_MARKER)) return source

  const anchor = 'const requestRestart = (attemptsLeft) => {'
  const anchorStart = source.indexOf(anchor)
  if (anchorStart === -1) {
    throw new Error('dshmarket client restart action was not found; review the pinned market integration before building.')
  }
  const fallbackToken = 'fetch(api("/dsh-market/restart")'
  const fallbackStart = source.indexOf(fallbackToken, anchorStart)
  if (fallbackStart === -1) {
    throw new Error('dshmarket fallback restart request was not found; review the pinned market integration before building.')
  }
  const fallbackLineStart = source.lastIndexOf('\n', fallbackStart) + 1

  const lineStart = source.lastIndexOf('\n', anchorStart) + 1
  const indentation = source.slice(lineStart, anchorStart)
  const bodyIndentation = `${indentation}  `
  const addition = [
    '',
    `${bodyIndentation}${DESKTOP_RESTART_MARKER}`,
    `${bodyIndentation}const desktopRestart = globalThis.dshDesktop?.restartHarness;`,
    `${bodyIndentation}const isDesktopShell = navigator.userAgent.includes("Electron/");`,
    `${bodyIndentation}if (isDesktopShell) {`,
    `${bodyIndentation}  if (typeof desktopRestart !== "function") {`,
    `${bodyIndentation}    setRestarting(false);`,
    `${bodyIndentation}    setInstallError(t("restartFail") + ": desktop restart bridge unavailable");`,
    `${bodyIndentation}    return;`,
    `${bodyIndentation}  }`,
    `${bodyIndentation}  void fetch(api("/dsh-market/status"), { cache: "no-store" })`,
    `${bodyIndentation}    .then((response) => response.json())`,
    `${bodyIndentation}    .then((status) => {`,
    `${bodyIndentation}      if (status.busy === true) {`,
    `${bodyIndentation}        if (attemptsLeft > 0) {`,
    `${bodyIndentation}          setTimeout(() => requestRestart(attemptsLeft - 1), 1500);`,
    `${bodyIndentation}          return;`,
    `${bodyIndentation}        }`,
    `${bodyIndentation}        throw new Error("plugin operation is still running");`,
    `${bodyIndentation}      }`,
    `${bodyIndentation}      return desktopRestart();`,
    `${bodyIndentation}    })`,
    `${bodyIndentation}    .then((result) => {`,
    `${bodyIndentation}      if (result === undefined || result?.ok === true) return;`,
    `${bodyIndentation}      throw new Error("desktop restart was rejected");`,
    `${bodyIndentation}    })`,
    `${bodyIndentation}    .catch((error) => {`,
    `${bodyIndentation}      setRestarting(false);`,
    `${bodyIndentation}      setInstallError(t("restartFail") + ": " + String(error));`,
    `${bodyIndentation}    });`,
    `${bodyIndentation}  return;`,
    `${bodyIndentation}}`
  ].join('\n')
  const replaceStart = anchorStart + anchor.length
  return `${source.slice(0, replaceStart)}${addition}\n${source.slice(fallbackLineStart)}`
}

/** Apply the pinned dshmarket host policy to a prepared desktop Profile. */
export async function patchBundledMarket(profileDirectory) {
  const marketRoot = join(profileDirectory, 'node_modules', 'dshmarket')
  const patchPath = join(marketRoot, 'lib', 'patch.js')
  const routesPath = join(marketRoot, 'lib', 'routes.js')
  const clientPath = join(marketRoot, 'client', 'client.js')
  const patchSource = addProtectedPackagePatterns(await readFile(patchPath, 'utf8'))
  let routesSource = await readFile(routesPath, 'utf8')
  let clientSource = await readFile(clientPath, 'utf8')
  routesSource = reportAllRestartBlockingMutations(routesSource)
  routesSource = hideMarketSelfManagement(routesSource)
  routesSource = recordExplicitMarketUninstall(routesSource)
  routesSource = hideProtectedListEntries(routesSource, 'installed')
  routesSource = hideProtectedListEntries(routesSource, 'updates')
  routesSource = protectMutationRoute(routesSource, 'update')
  routesSource = protectMutationRoute(routesSource, 'uninstall')
  clientSource = exposeDesktopRestartCapability(clientSource)
  clientSource = delegateRestartToDesktopShell(clientSource)
  await writeFile(patchPath, patchSource, 'utf8')
  await writeFile(routesPath, routesSource, 'utf8')
  await writeFile(clientPath, clientSource, 'utf8')
}
