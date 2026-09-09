import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { createModelCredentialClient, parentCredentialTransport } from './model-credential-client'
import { createModelGatewayAdapter, MODEL_PROVIDER } from './model-gateway'

export const inject = ['llm']

/** First-party Host bridge: model credentials never pass through the renderer. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const credentials = createModelCredentialClient(parentCredentialTransport())
    const unregister = ctx.llm.registerAdapter([MODEL_PROVIDER], createModelGatewayAdapter(ctx, () => credentials.getToken()))
    return () => { unregister(); credentials.dispose() }
  }, 'insight-desktop: model gateway')
}
