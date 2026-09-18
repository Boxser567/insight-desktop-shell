import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'
import { createEnterpriseWebSearchOptions } from './web-search-options'

/** Build the first-party search provider without retaining the user's access token. */
export function createWebSearchProvider(
  ctx: Context,
  resolveAccessToken: () => Promise<string>
): DeepSeekSearchProvider {
  return new DeepSeekSearchProvider(() => createEnterpriseWebSearchOptions(ctx, resolveAccessToken))
}
