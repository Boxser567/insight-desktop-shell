import { desktopServiceEnvironment } from '../../../src/shared/service-environment'

export interface WebSearchContext {
  get(key: 'agents'): {
    currentInitiator(): { session: { append(type: string, request: unknown): void } } | undefined
  } | undefined
}

export interface EnterpriseWebSearchOptions {
  baseURL: string
  resolveApiKey: () => Promise<string>
  model: string
  apiVersion: string
  maxTokens: number
  maxUses: number
  recordRequest(request: unknown): void
}

/** Keep search configuration on the same authenticated service plane as model calls. */
export function createEnterpriseWebSearchOptions(
  ctx: WebSearchContext,
  resolveAccessToken: () => Promise<string>
): EnterpriseWebSearchOptions {
  return {
    baseURL: desktopServiceEnvironment().modelBaseUrl.replace(/\/$/u, ''),
    resolveApiKey: resolveAccessToken,
    model: 'enterprise-search',
    apiVersion: '2023-06-01',
    maxTokens: 4096,
    maxUses: 5,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
    }
  }
}
