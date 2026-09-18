import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-web'
import { createModelCredentialClient, parentCredentialTransport } from './model-credential-client'
import { createModelGatewayAdapter, MODEL_PROVIDER } from './model-gateway'
import { createWebSearchProvider } from './web-search'

export const inject = ['llm', 'web']

/** First-party Host bridge: model credentials never pass through the renderer. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const credentials = createModelCredentialClient(parentCredentialTransport())
    const resolveAccessToken = () => credentials.getToken()
    const unregisterModel = ctx.llm.registerAdapter([MODEL_PROVIDER], createModelGatewayAdapter(ctx, resolveAccessToken))
    const unregisterSearch = ctx.web.registerSearchProvider(createWebSearchProvider(ctx, resolveAccessToken))
    return () => {
      unregisterSearch()
      unregisterModel()
      credentials.dispose()
    }
  }, 'insight-desktop: model gateway')
}
