import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-web'
import { createModelCredentialClient, parentCredentialTransport } from './model-credential-client'
import { createModelGatewayAdapter, MODEL_PROVIDER } from './model-gateway'
import { createWebSearchProvider } from './web-search'
import { skillProxyServiceBaseUrl } from '../../../src/shared/service-environment'
import { createSkillProxyRequest } from './skill-proxy-http'
import { startSkillProxy } from './skill-proxy'
import { registerSkillProxyEnvironment, skillProxyRuntimePaths } from './skill-proxy-environment'

export const inject = ['llm', 'web']

/** First-party Host bridge: model credentials never pass through the renderer. */
export function apply(ctx: Context): void {
  const credentials = createModelCredentialClient(parentCredentialTransport())
  ctx.effect(() => () => credentials.dispose(), 'insight-desktop: credentials')
  ctx.effect(() => {
    const resolveAccessToken = () => credentials.getToken()
    const unregisterModel = ctx.llm.registerAdapter([MODEL_PROVIDER], createModelGatewayAdapter(ctx, resolveAccessToken))
    const unregisterSearch = ctx.web.registerSearchProvider(createWebSearchProvider(ctx, resolveAccessToken))
    return () => {
      unregisterSearch()
      unregisterModel()
    }
  }, 'insight-desktop: model gateway')

  // Isolate the optional skill bridge lifecycle from the existing model adapter.
  ctx.inject(['shellEnv'], async proxyCtx => {
    const paths = skillProxyRuntimePaths()
    const home = process.env.DSH_HOME
    if (!home) throw new Error('Skill proxy requires the active account DSH_HOME')
    let disposed = false
    let stop: (() => Promise<void>) | undefined
    proxyCtx.effect(() => () => { disposed = true; void stop?.() }, 'insight-desktop: skill proxy')
    const close = await startSkillProxy(createSkillProxyRequest(skillProxyServiceBaseUrl(), () => credentials.getToken()), home)
    if (disposed) { await close(); return }
    stop = close
    registerSkillProxyEnvironment(proxyCtx, paths)
  })
}
