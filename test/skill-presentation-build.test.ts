import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { generateSkillPresentations } from '../scripts/generate-skill-presentations.mjs'

it('discovers new platform bundles by native name, accepts directory aliases and validates product labels', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skill-labels-'))
  const bundle = join(dir, 'directory-alias')
  await mkdir(bundle)
  await writeFile(join(bundle, 'SKILL.md'), '---\nname: completely-new-skill\ndescription: Native routing\n---\nBody')
  const ui = {displayName:'新技能',shortDescription:'展示说明'}
  try {
    await writeFile(join(bundle, 'ui.json'), JSON.stringify(ui))
    expect(await generateSkillPresentations(dir)).toEqual({'completely-new-skill':{...ui,entryPath:'directory-alias/SKILL.md'}})
    await writeFile(join(bundle, 'ui.json'), '{"displayName":"bad\\nlabel","shortDescription":"valid"}')
    await expect(generateSkillPresentations(dir)).rejects.toThrow('displayName')
    await writeFile(join(bundle, 'ui.json'), ' '.repeat(8193))
    await expect(generateSkillPresentations(dir)).rejects.toThrow('8 KiB')
    await writeFile(join(bundle, 'ui.json'), JSON.stringify(ui))
    const duplicate = join(dir,'duplicate');await mkdir(duplicate)
    await writeFile(join(duplicate,'SKILL.md'), '---\nname: completely-new-skill\ndescription: Duplicate\n---\nBody')
    await writeFile(join(duplicate,'ui.json'),JSON.stringify(ui))
    await expect(generateSkillPresentations(dir)).rejects.toThrow('Duplicate')
  } finally {await rm(dir,{recursive:true,force:true})}
})
