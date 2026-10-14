// TODO 画布请求的 api 应该做到 host 中，目前临时写到这里
import { desktopServiceEnvironment } from '../../../src/shared/service-environment'
import {
  createCanvasCredentialClient,
  parentCanvasCredentialTransport,
  type CanvasCredentialTransport
} from './canvas-credential'
import type { ModelType, ParameterSchema } from '@insight-ai/insight-workflow-protocol'

export type CanvasVersionNumber = number | string

export interface CanvasData {
  id?: string
  temp?: boolean
  favorite?: boolean
  name?: string
  data?: string
  thumbnailUrl?: string
  templateId?: number
  version: string
  versionNumber?: CanvasVersionNumber
  canvasType?: 0 | 1
}

export interface CanvasUpdate {
  id: string
  /** 节点序列化数据 */
  updateNodes?: string[]
  /** 节点序列化数据 */
  addNodes?: string[]
  deleteNodeIds?: string[]
  edges?: CanvasGraphEdge[]
  versionNumber?: CanvasVersionNumber
}

export interface FlowParams {
  id?: string
}

export interface FlowListParams {
  page: number
  size: number
  name?: string
  version?: "comfyui"
  canvasType?: [0]
  sort_type?: 'time_asc' | 'time_desc'
}

export interface CanvasApiResponse<T = unknown> {
  code: string | number
  data?: T
  msg?: string
  message?: string
}

export interface FlowListRecord {
  id: number
  favorite: boolean
  temp: boolean
  name: string
  updateTime: string
  version: string
  thumbnailUrl: string
  folderId: number
  canvasType: 0 | 1
}

export interface FlowListData {
  records: FlowListRecord[]
  total: number
}

export type GetFlowsListResponse = CanvasApiResponse<FlowListData>

export interface CanvasGraphNode {
  id: string
  type: string
  position: { x: number; y: number }
  measured?: { width: number; height: number }
  data: {
    params?: Record<string, unknown>
    title: string
    value?: string | string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface CanvasGraphEdge {
  id: string
  className?: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
  [key: string]: unknown
}

export interface CanvasGraph {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
}

export interface FlowData {
  id: number
  conversationId: string | number | null
  data: CanvasGraph
  taskStatus: string
  favorite: boolean
  temp: boolean
  name: string
  updateTime: string
  version: string
  versionNumber: CanvasVersionNumber
  thumbnailUrl: string
  templateId: number
  folderId: number
  canvasType: 0 | 1
}

type ModelParams = {
  model_name: string
  description: string
  maxPrompt?: number
  parameters: Record<string, ParameterSchema>
  senoir_parameters?: Record<string, ParameterSchema>
  sort: number
}

type ModelParamsData = {
  [key in string]: Partial<Record<ModelType, {
    name: string;
    models: Record<string, ModelParams>
  }>> | ModelParams | {
    models: Record<string, ModelParams>
  }
}

export type GetFlowDataResponse = CanvasApiResponse<FlowData>
type RawFlowData = Omit<FlowData, 'data'> & { data: string }

export interface SaveFlowResult {
  id: string | number
  versionNumber?: CanvasVersionNumber
}

export interface CanvasApi {
  saveFlow(params: CanvasData): Promise<CanvasApiResponse<SaveFlowResult>>
  getFlowData(params: FlowParams): Promise<GetFlowDataResponse>
  getModelParams(): Promise<ModelParamsData>
  updateCanvas(params: CanvasUpdate): Promise<CanvasApiResponse<{ id: number /** canvas id */ }>>
  getFlowsList(params: FlowListParams): Promise<GetFlowsListResponse>
  dispose(): void
}

export class CanvasRequestError extends Error {
  constructor(readonly code: 'LOGIN_REQUIRED' | 'REQUEST_FAILED' | 'INVALID_RESPONSE' | 'INVALID_REQUEST', readonly status?: number) {
    super(code)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseModelParams(value: unknown): ModelParamsData {
  let config: unknown = value
  if (Array.isArray(value)) {
    if (!isRecord(value[0]) || typeof value[0].config !== 'string') throw new CanvasRequestError('INVALID_RESPONSE')
    try { config = JSON.parse(value[0].config) }
    catch { throw new CanvasRequestError('INVALID_RESPONSE') }
  }
  if (!isRecord(config)) throw new CanvasRequestError('INVALID_RESPONSE')
  return config as ModelParamsData
}

function parseCanvasGraph(value: unknown): CanvasGraph {
  if (typeof value !== 'string') throw new CanvasRequestError('INVALID_RESPONSE')
  let graph: unknown
  try { graph = JSON.parse(value) }
  catch { throw new CanvasRequestError('INVALID_RESPONSE') }
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
    !graph.nodes.every(node => isRecord(node) && typeof node.id === 'string' &&
      typeof node.type === 'string' && isRecord(node.position) &&
      typeof node.position.x === 'number' && typeof node.position.y === 'number' &&
      isRecord(node.data) && typeof node.data.title === 'string') ||
    !graph.edges.every(edge => isRecord(edge) && typeof edge.id === 'string' &&
      typeof edge.source === 'string' && typeof edge.target === 'string')) {
    throw new CanvasRequestError('INVALID_RESPONSE')
  }
  return graph as unknown as CanvasGraph
}

/** First-party Host client. Main validates the current account before issuing each token. */
export function createCanvasApi(
  transport: CanvasCredentialTransport = parentCanvasCredentialTransport(),
  fetchRequest: typeof fetch = fetch
): CanvasApi {
  const credentials = createCanvasCredentialClient(transport)
  const origin = desktopServiceEnvironment().authOrigin
  const controllers = new Set<AbortController>()
  async function request<T>(path: string, params: unknown): Promise<CanvasApiResponse<T>> {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      let body: string
      try { body = JSON.stringify(params) }
      catch { throw new CanvasRequestError('INVALID_REQUEST') }
      if (!body || Buffer.byteLength(body) > 8 * 1024 * 1024) throw new CanvasRequestError('INVALID_REQUEST')
      let token: string
      try { token = await credentials.getToken() }
      catch (error) {
        throw new CanvasRequestError(error instanceof Error && 'code' in error && error.code === 'AUTH'
          ? 'LOGIN_REQUIRED' : 'REQUEST_FAILED')
      }
      if (controller.signal.aborted) throw new CanvasRequestError('REQUEST_FAILED')
      let response: Response
      try {
        response = await fetchRequest(`${origin}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'accept-language': 'zh_CN', token },
          redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
          body
        })
      } catch { throw new CanvasRequestError('REQUEST_FAILED') }
      let envelope: CanvasApiResponse<T>
      try { envelope = await response.json() as CanvasApiResponse<T> }
      catch { throw new CanvasRequestError(response.status === 401 ? 'LOGIN_REQUIRED' : 'INVALID_RESPONSE', response.status) }
      if (response.status === 401 || envelope?.code === 'USER_NOT_LOGIN' ||
        envelope?.code === 'USER_SESSION_EXPIRED' || envelope?.code === -1) {
        throw new CanvasRequestError('LOGIN_REQUIRED', response.status)
      }
      if (!response.ok || !['SUCCESS', 200, 0, '0'].includes(envelope?.code)) {
        throw new CanvasRequestError('REQUEST_FAILED', response.status)
      }
      return envelope
    } finally {
      controllers.delete(controller)
    }
  }
  return {
    saveFlow: params => request('game-ai-editor-center/api/canvas/saveOrUpdate', params),
    getFlowData: async params => {
      const response = await request<RawFlowData>(
        'game-ai-editor-center/api/canvas/get', params
      )
      const { data, ...envelope } = response
      if (!data) throw new CanvasRequestError('INVALID_RESPONSE')
      const parse = (value: RawFlowData): FlowData => ({ ...value, data: parseCanvasGraph(value.data) })
      return {
        ...envelope,
        data: parse(data),
      }
    },
    getModelParams: async () => {
      const controller = new AbortController()
      controllers.add(controller)
      try {
        let response: Response
        try {
          response = await fetchRequest('https://game-ai-admin-test-cdn.idealead.com/model_node_setting/model_params_with_sort.json', {
            method: 'GET', redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
          })
        } catch { throw new CanvasRequestError('REQUEST_FAILED') }
        if (!response.ok) throw new CanvasRequestError('REQUEST_FAILED', response.status)
        let value: unknown
        value = await response.json()
        return value as ModelParamsData
      } finally {
        controllers.delete(controller)
      }
    },
    updateCanvas: params => request('game-ai-editor-center/api/canvas/partialUpdate', params),
    getFlowsList: params => request<FlowListData>('game-ai-editor-center/api/canvas/list', {
      canvasType: [0], version: 'comfyui', sort_type: 'time_desc',  ...params,
    }),
    dispose: () => {
      credentials.dispose()
      for (const controller of controllers) controller.abort()
      controllers.clear()
    }
  }
}
