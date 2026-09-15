import type { Context } from '@deepseek-ai/cordis'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { desktopServiceEnvironment } from '../../../src/shared/service-environment'
import { ModelCredentialError } from './model-credential-client'

export const MODEL_PROVIDER = 'yinsai-gateway'
export const MODEL_ID = 'deepseek-flash'
export const MODEL_BASE_URL = desktopServiceEnvironment().modelBaseUrl

// Temporary enterprise wire compatibility, verified against the deployed Gateway:
// deepseek-flash returns 403 MODEL_NOT_ALLOWED; this retired alias succeeds.
// Keep the public model and official capabilities canonical. Remove after the
// enterprise service accepts deepseek-flash (not after a client-only rename).
const GATEWAY_WIRE_MODEL = 'deepseek-v4-flash-vision-exp'
function gatewayRequest(options: Parameters<DeepSeekAdapter['stream']>[0]) {
  return [MODEL_ID, 'deepseek-v4-flash', GATEWAY_WIRE_MODEL].includes(options.model)
    ? { ...options, model: GATEWAY_WIRE_MODEL }
    : options
}

/** Keep historical wire IDs usable without advertising retired models as separate products. */
class ModelGatewayAdapter extends DeepSeekAdapter {
  override async prepareCall(...args: Parameters<DeepSeekAdapter['prepareCall']>) {
    const prepared = await super.prepareCall(...args)
    return { ...prepared, stream: (options: Parameters<DeepSeekAdapter['stream']>[0]) =>
      prepared.stream(gatewayRequest(options)) }
  }

  override stream(options: Parameters<DeepSeekAdapter['stream']>[0]) {
    return super.stream(gatewayRequest(options))
  }

  override async listModels(provider: string) {
    return (await super.listModels(provider)).filter(model => model.id === MODEL_ID)
  }
}

/** A fixed service endpoint paired with the signed-in user's short-lived token. */
export function createModelGatewayAdapter(ctx: Context, resolveAccessToken: () => Promise<string>): DeepSeekAdapter {
  const official = resolveAdapterOptions({ baseURL: MODEL_BASE_URL })
  const flash = official.models.find(model => model.id === MODEL_ID)
  if (!flash) throw new Error('The Core Runtime must provide the official deepseek-flash model capabilities.')
  // Capacity, generation budget, image policy and retries belong to the locked official adapter.
  // Keep leading-system semantics until the enterprise endpoint confirms in-history updates.
  const model = { ...flash, name: 'DeepSeek-V4.1-Flash', systemPromptUpdate: undefined }
  const options = { ...official, models: [MODEL_ID, 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
    .map(id => ({ ...model, id })) }
  const configuration: DeepSeekAdapterOptions = {
    options: () => options,
    resolveApiKey: async () => {
      try { return await resolveAccessToken() }
      catch (error) {
        if (error instanceof ModelCredentialError) throw new LlmError(error.message, error.code)
        throw new LlmError('暂时无法验证登录，请检查网络后重试。', 'TRANSPORT')
      }
    },
    resolveUserId: () => getOrCreateAnonymousUserId(),
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref
    ),
    // The Insight Gateway uses the standard request fields, without official-API extensions.
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} })
  }
  return new ModelGatewayAdapter(configuration)
}
