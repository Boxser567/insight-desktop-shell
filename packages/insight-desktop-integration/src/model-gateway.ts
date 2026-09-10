import type { Context } from '@deepseek-ai/cordis'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { desktopServiceEnvironment } from '../../../src/shared/service-environment'

export const MODEL_PROVIDER = 'yinsai-gateway'
export const MODEL_ID = 'deepseek-v4-flash-vision-exp'
export const MODEL_BASE_URL = desktopServiceEnvironment().modelBaseUrl

/** A fixed service endpoint paired with the signed-in user's short-lived token. */
export function createModelGatewayAdapter(ctx: Context, resolveAccessToken: () => Promise<string>): DeepSeekAdapter {
  const options = resolveAdapterOptions({
    baseURL: MODEL_BASE_URL,
    thinking: 'enabled',
    reasoningEffort: 'high',
    maxTokens: 8192,
    defaultContextWindow: 128000,
    models: [{ id: MODEL_ID, name: 'DeepSeek-V4-Flash-Vision-Exp', contextWindow: 128000,
      maxTokens: 8192, inputModalities: ['text', 'image'] }]
  })
  return new DeepSeekAdapter({
    options: () => options,
    resolveApiKey: async () => {
      try { return await resolveAccessToken() }
      catch (error) {
        throw new LlmError(error instanceof Error ? error.message : '请登录后继续会话。', 'AUTH')
      }
    },
    resolveUserId: () => getOrCreateAnonymousUserId(),
    resolveAttachments: () => ctx.get('attachments')
  })
}
