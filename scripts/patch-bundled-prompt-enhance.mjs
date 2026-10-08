import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Core stores all composer attachments in attachmentIds and exposes the
// resolved Harness theme through data-ds-dark-theme.
export function adaptPromptEnhanceClient(source) {
  const before = 'const imageCount = useInput((state) => state.imageIds.length);'
  const after = 'const imageCount = useInput((state) => state.attachmentIds.length);'
  let adapted = source
  if (!adapted.includes(after)) {
    if (adapted.split(before).length !== 2) throw new Error('Review the pinned prompt-enhance composer integration before building.')
    adapted = adapted.replace(before, after)
  }

  if (adapted.includes('settingsScope')) {
    for (const [legacy, current] of [
      ['var inject = ["slots", "settingsScope", "locale"];', 'var inject = ["slots", "configForms", "locale"];'],
      ['ctx.inject(["settingsScope"], (settingsCtx) => {', 'ctx.inject(["configForms"], (settingsCtx) => {'],
      ['const scope = settingsCtx.settingsScope.bind({ namespace: NS, decode: decodeClientSettings });', 'const scope = settingsCtx.configForms.get(NS);'],
      ['setClientSettings(scope.getSnapshot().value ?? decodeClientSettings(void 0));', 'setClientSettings(decodeClientSettings(scope.getSnapshot().value));']
    ]) {
      if (adapted.split(legacy).length !== 2) throw new Error('Review the pinned prompt-enhance settings integration before building.')
      adapted = adapted.replace(legacy, current)
    }
  }

  const mediaOpening = '@media (prefers-color-scheme: light) {\n  .dsh-pe-panel {'
  const scopedOpening = 'body:not([data-ds-dark-theme]) .dsh-pe-panel {'
  if (!adapted.includes(scopedOpening)) {
    // Older compatibility fixtures may contain only the composer code. The
    // packaged 0.2.1 client is checked by patchBundledPromptEnhance below.
    if (!adapted.includes(mediaOpening)) return adapted
    const mediaClosing = '\n  }\n}\n.dsh-pe-head'
    if (adapted.split(mediaClosing).length !== 2) throw new Error('Review the pinned prompt-enhance theme block before building.')
    adapted = adapted
      .replace(mediaOpening, scopedOpening)
      .replace(mediaClosing, '\n  }\n.dsh-pe-head')
  }
  return adapted
}

export async function patchBundledPromptEnhance(profile) {
  const directory = join(profile, 'node_modules', 'dsh-prompt-enhance')
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (manifest.version !== '0.2.1') throw new Error('Review prompt-enhance compatibility for the new plugin version.')
  const client = join(directory, 'lib', 'client.js')
  const adapted = adaptPromptEnhanceClient(await readFile(client, 'utf8'))
  if (!adapted.includes('body:not([data-ds-dark-theme]) .dsh-pe-panel')) {
    throw new Error('Review the pinned prompt-enhance theme integration before building.')
  }
  if (!adapted.includes('settingsCtx.configForms.get(NS)') || adapted.includes('settingsScope')) {
    throw new Error('Review the pinned prompt-enhance settings integration before building.')
  }
  await writeFile(client, adapted)
}
