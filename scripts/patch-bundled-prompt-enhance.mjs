import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Core 0.1.5 stores all composer attachments in attachmentIds.
export function adaptPromptEnhanceClient(source) {
  const before = 'const imageCount = useInput((state) => state.imageIds.length);'
  const after = 'const imageCount = useInput((state) => state.attachmentIds.length);'
  if (source.includes(after)) return source
  if (source.split(before).length !== 2) throw new Error('Review the pinned prompt-enhance composer integration before building.')
  return source.replace(before, after)
}

export async function patchBundledPromptEnhance(profile) {
  const directory = join(profile, 'node_modules', 'dsh-prompt-enhance')
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (manifest.version !== '0.1.9') throw new Error('Review prompt-enhance compatibility for the new plugin version.')
  const client = join(directory, 'lib', 'client.js')
  await writeFile(client, adaptPromptEnhanceClient(await readFile(client, 'utf8')))
}
