import type { Context } from '@deepseek-ai/cordis'
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { PiAiAdapter, resolveProfiles, credentialStoreFrom, authContextFrom } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai'
import { desktopServiceEnvironment } from '../../../src/shared/service-environment'
import { ModelCredentialError } from './model-credential-client'

export const MODEL_PROVIDER = 'yinsai-gateway'
export const MODEL_ID = 'deepseek-flash'
export const MODEL_BASE_URL = desktopServiceEnvironment().modelBaseUrl

/** Keep historical wire IDs usable without advertising retired models as separate products. */
class ModelGatewayAdapter extends PiAiAdapter {
  override async listModels(provider: string) {
    return (await super.listModels(provider)).filter(model => model.id === MODEL_ID)
  }
}

/** A fixed service endpoint paired with the signed-in user's short-lived token. */
export function createModelGatewayAdapter(ctx: Context, resolveAccessToken: () => Promise<string>): PiAiAdapter {
  // The direct DeepSeek adapter only supports Messages; the enterprise endpoint speaks Chat Completions.
  const official = resolveAdapterOptions({})
  const flash = official.models.find(model => model.id === MODEL_ID)
  if (!flash) throw new Error('The Core Runtime must provide the official deepseek-flash model capabilities.')
  const profiles = resolveProfiles({ [MODEL_PROVIDER]: {
    api: 'openai-completions',
    baseURL: MODEL_BASE_URL,
    compat: { thinkingFormat: 'deepseek', maxTokensField: 'max_tokens', supportsDeveloperRole: false, supportsStore: false },
    models: [MODEL_ID, 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].map(id => ({
      id, name: 'DeepSeek-V4.1-Flash', contextWindow: flash.contextWindow,
      maxTokens: flash.maxTokens ?? official.maxTokens, input: [...flash.inputModalities ?? ['text']],
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' }
    })),
    streamIdleTimeoutMs: official.streamIdleTimeoutMs,
    maxRequestImageBytes: official.maxInlineRequestImageBytes,
    requestImageMaxBytes: flash.imageMaxBytes,
    retryPolicy: {
      mode: official.retryPolicy.mode,
      ...(official.retryPolicy.mode === 'normal' ? {
        maxRetries: official.retryPolicy.maxRetries, retryableCodes: [...official.retryPolicy.retryableCodes]
      } : {}),
      backoff: { initialDelayMs: official.retryPolicy.initialDelayMs,
        maxDelayMs: official.retryPolicy.maxDelayMs, jitterRatio: official.retryPolicy.jitterRatio }
    }
  } })
  const configuration: PiAiAdapterOptions = {
    profiles: () => profiles,
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    resolveApiKey: async () => {
      try { return await resolveAccessToken() }
      catch (error) {
        if (error instanceof ModelCredentialError) throw new LlmError(error.message, error.code)
        throw new LlmError('暂时无法验证登录，请检查网络后重试。', 'TRANSPORT')
      }
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref
    )
  }
  return new ModelGatewayAdapter(configuration)
}
