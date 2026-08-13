import { readFile } from 'node:fs/promises'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it } from 'vitest'

const PI_AI_ONBOARDING_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'xai',
  'moonshotai-cn',
  'minimax-cn',
  'zai-coding-cn',
  'mistral',
  'groq',
  'together'
] as const

describe('desktop provider onboarding patch', () => {
  it.each(PI_AI_ONBOARDING_PROVIDERS)('%s has a bundled model catalog', (provider) => {
    expect(getBuiltinModels(provider).length).toBeGreaterThan(0)
  })

  it('is captured as a reproducible dependency patch', async () => {
    const patch = await readFile(
      'patches/@deepseek-ai+dsh-client-ui-settings-models+0.1.0-rc.6.patch',
      'utf8'
    )
    expect(patch).toContain('ONBOARDING_PROVIDERS')
    expect(patch).toContain('openrouter')
    expect(patch).toContain('接入模型提供方')
  })
})
