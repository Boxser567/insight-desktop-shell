import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopServiceEnvironment } from '../src/shared/service-environment'
import { createEnterpriseWebSearchOptions, type WebSearchContext } from '../packages/insight-desktop-integration/src/web-search-options'

afterEach(() => vi.unstubAllGlobals())

function setup(resolveAccessToken = vi.fn(async () => 'user-token')) {
  const append = vi.fn()
  const ctx = {
    get: () => ({ currentInitiator: () => ({ session: { append } }) })
  } as WebSearchContext
  return {
    options: createEnterpriseWebSearchOptions(ctx, resolveAccessToken),
    resolveAccessToken,
    append
  }
}

describe('enterprise web search provider', () => {
  it('uses the shared Gateway endpoint and does not persist the user token in records', async () => {
    const { append, options, resolveAccessToken } = setup()
    expect(options.baseURL).toBe(desktopServiceEnvironment().modelBaseUrl)
    expect(options.model).toBe('enterprise-search')
    expect(options.apiVersion).toBe('2023-06-01')
    expect(options.maxTokens).toBe(4096)
    expect(options.maxUses).toBe(5)
    expect(await options.resolveApiKey()).toBe('user-token')
    options.recordRequest({ query: 'weather' })
    expect(JSON.stringify(append.mock.calls)).not.toContain('user-token')
    expect(resolveAccessToken).toHaveBeenCalledOnce()
  })

  it.skipIf(!existsSync(resolve('build/core-runtime/node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js')))(
    'uses native search parsing, cancellation, and upstream error handling', async () => {
      const { append, options } = setup()
      const { DeepSeekSearchProvider } = await import(pathToFileURL(resolve(
        'build/core-runtime/node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js'
      )).href)
      const fetcher = vi.fn(async () => Response.json({ content: [
        { type: 'web_search_tool_result', content: [
          { type: 'web_search_result', url: 'https://weather.example', title: 'Shanghai', page_age: 'today' }
        ] },
        { type: 'text', text: 'Result', citations: [{ url: 'https://weather.example', cited_text: 'Cloudy' }] }
      ] }))
      vi.stubGlobal('fetch', fetcher)

      const provider = new DeepSeekSearchProvider(() => options)
      expect(provider.id).toBe('deepseek-official')
      const result = await provider.search({ query: 'Shanghai weather' }, new AbortController().signal)

      expect(result.sources[0]).toMatchObject({
        url: 'https://weather.example',
        title: 'Shanghai',
        snippet: 'Cloudy'
      })
      const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe(`${options.baseURL}/messages`)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer user-token')
      expect(init.redirect).toBe('error')
      expect(JSON.parse(init.body as string).tools[0].type).toBe('web_search_20250305')
      expect(JSON.stringify(append.mock.calls)).not.toContain('user-token')

      await provider.search({ query: 'second query' }, new AbortController().signal)
      expect(options.resolveApiKey).toHaveBeenCalledTimes(2)

      const cancelled = setup()
      const cancelledProvider = new DeepSeekSearchProvider(() => cancelled.options)
      await expect(cancelledProvider.search({ query: 'test' }, AbortSignal.abort())).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(2)

      vi.stubGlobal('fetch', vi.fn(async () => Response.json(
        { error: { message: 'search quota exceeded' } },
        { status: 429 }
      )))
      await expect(provider.search({ query: 'test' }, new AbortController().signal)).rejects.toThrow('search quota exceeded')

      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ content: [{ type: 'text', text: 'guessed weather' }] })))
      await expect(provider.search({ query: 'test' }, new AbortController().signal)).rejects.toThrow('no web_search_tool_result')
    }
  )

  it('disables the stock registration in the first-party bundle patch', () => {
    const patch = readFileSync('packages/insight-desktop-integration/cordis.patch.yml', 'utf8')
    expect(patch).toMatch(/id: web-search-deepseek\s+disabled: true/u)
  })
})
