import { randomUUID } from 'node:crypto'
import type {
  ApplyWorkflowPatchInput, ApplyWorkflowPatchOutput, Edge, ModelSetting, ModelType, Node, NodeCreateInput,
  NodeSummary, NodeType, ParameterSchema, Query, QueryFilter, Workflow, WorkflowBackend,
  WorkflowOperation, WorkflowSummary, WorkflowToolContracts
} from '@insight-ai/insight-workflow-protocol'
import { workflowSkillContent, workflowTypes } from '../../insight-workflow-protocol/src'
import { createCanvasApi, type CanvasApi, type CanvasGraphNode, type FlowData } from './canvas-api'

const NODE_TYPES = ['text', 'image', 'audio', 'video', 'poseTool', 'highDefinitionTool'] as const
const NODE_DESCRIPTIONS = {
  text: '文本', image: '图像', audio: '音频', video: '视频', poseTool: '姿态工具', highDefinitionTool: '高清工具'
} as const

function take<T>(items: T[], limit?: number): T[] {
  if (limit === undefined) return items
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit 必须为正整数')
  return items.slice(0, limit)
}

function matchesQuery(value: unknown, query?: Query): boolean {
  const matches = (filter: QueryFilter): boolean => {
    const actual = filter.field.split('.').reduce<unknown>((part, key) =>
      part && typeof part === 'object' && Object.hasOwn(part, key) ? (part as Record<string, unknown>)[key] : undefined, value)
    switch (filter.operator) {
      case 'eq': return actual === filter.value
      case 'ne': return actual !== filter.value
      case 'gt': return typeof actual === 'number' && actual > filter.value
      case 'gte': return typeof actual === 'number' && actual >= filter.value
      case 'lt': return typeof actual === 'number' && actual < filter.value
      case 'lte': return typeof actual === 'number' && actual <= filter.value
      case 'in': return filter.value.includes(actual as never)
      case 'not_in': return !filter.value.includes(actual as never)
      case 'exists': return actual !== undefined
      case 'not_exists': return actual === undefined
      case 'supports': {
        if (Array.isArray(actual)) return actual.includes(filter.value)
        if (actual !== null && typeof actual === 'object') {
          if ('choices' in actual && Array.isArray(actual.choices))
            return actual.choices.some(choice => typeof choice === 'object' && choice !== null && 'value' in choice ? choice.value === filter.value : choice === filter.value)
          if ('min' in actual && 'max' in actual && 'step' in actual && typeof filter.value === 'number' &&
            typeof actual.min === 'number' && typeof actual.max === 'number' && typeof actual.step === 'number') {
            const steps = (filter.value - actual.min) / actual.step
            return filter.value >= actual.min && filter.value <= actual.max && Math.abs(steps - Math.round(steps)) < 1e-9
          }
          if ('type' in actual && actual.type === 'switch') return typeof filter.value === 'boolean'
        }
        return actual === filter.value
      }
    }
  }
  return (query?.filters?.all ?? []).every(matches) &&
    (!query?.filters?.any?.length || query.filters.any.some(matches))
}

function summary(workflow: Workflow): WorkflowSummary {
  return { id: workflow.id, name: workflow.name, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length }
}

function nodeSummary(node: Node): NodeSummary {
  return {
    id: node.id, type: node.type, title: node.data.title, position: node.position,
    ...(node.type === 'text' || node.type === 'image' || node.type === 'audio' || node.type === 'video' ? { model: node.data.params.model } : {}),
    ...(node.type === 'image' || node.type === 'audio' || node.type === 'video' ? { modelType: node.data.params.modelType } : {}),
    status: node.data.taskInfo.status
  }
}

const MODEL_TYPES: Record<string, readonly ModelType[]> = {
  image: ['text_to_image', 'reference_image_to_image'],
  audio: ['tts', 'text_to_audio', 'audio_to_audio'],
  video: ['first_last_frame_to_video', 'image_to_video', 'reference_image_to_video', 'text_to_video']
}
const PARAM_KEYS: Record<string, readonly string[]> = {
  text: ['model', 'prompt', 'search_resource'],
  image: ['model', 'prompt', 'modelType', 'aspect_ratio', 'gen_count', 'quality', 'resolution'],
  video: ['model', 'prompt', 'modelType', 'aspect_ratio', 'duration', 'enableAudio', 'gen_count', 'resolution'],
  audio: ['model', 'prompt', 'modelType', 'gen_count', 'seniorParams']
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('画布服务返回了无效数据')
  return value
}

function projectedNode(raw: CanvasGraphNode): Node | undefined {
  if (!NODE_TYPES.includes(raw.type as NodeType)) return undefined
  const params = record(raw.data.params) ? raw.data.params : {}
  const selected = PARAM_KEYS[raw.type]
    ? Object.fromEntries(Object.entries(params).filter(([key]) => PARAM_KEYS[raw.type]!.includes(key)))
    : params
  if (PARAM_KEYS[raw.type]) {
    if (selected.model == null || selected.model === '') delete selected.model
    if (selected.modelType == null || selected.modelType === '') delete selected.modelType
    selected.prompt ??= ''
    if (raw.type === 'text') selected.search_resource ??= false
  }
  const rawTask = record(raw.data.taskInfo) ? raw.data.taskInfo : {}
  const isUpload = raw.data.type === 'upload'
  const status = rawTask.status === 'success' || rawTask.status === 'SUCCESS' ? 'success'
    : rawTask.status === 'failed' || rawTask.status === 'failure' || rawTask.status === 'FAILURE' ? 'failed'
      : isUpload ? 'success' : 'running'
  const candidate = {
    id: raw.id, type: raw.type, position: raw.position,
    ...(raw.measured ? { measured: raw.measured } : {}),
    data: {
      title: raw.data.title,
      ...(typeof raw.data.value === 'string' || Array.isArray(raw.data.value) ? { value: raw.data.value } : {}),
      ...(isUpload ? { type: 'upload' as const } : {}),
      taskInfo: { status, ...(typeof rawTask.errorMsg === 'string' ? { errorMsg: rawTask.errorMsg } : {}) },
      params: selected
    }
  }
  const parsed = workflowTypes.node.safeParse(candidate)

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')).filter(Boolean))].slice(0, 5)
    throw new Error(`画布节点 ${raw.id} 与工作流协议不兼容：${fields.join(', ') || '节点结构'}`)
  }
  return parsed.data
}

function project(flow: FlowData): Workflow {
  const nodes = flow.data.nodes.map(projectedNode).filter((node): node is Node => node !== undefined)
  const ids = new Set(nodes.map(node => node.id))
  const edges = flow.data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? 'output', targetHandle: edge.targetHandle ?? 'input' }))
  return { id: String(flow.id), name: flow.name, nodes, edges }
}

function flowSummary(flow: FlowData): WorkflowSummary {
  const ids = new Set(flow.data.nodes.filter(node => NODE_TYPES.includes(node.type as NodeType)).map(node => node.id))
  return { id: String(flow.id), name: flow.name, nodeCount: ids.size,
    edgeCount: flow.data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).length }
}

function settings(data: unknown): ModelSetting[] {
  if (!record(data)) throw new Error('模型服务返回了无效数据')
  const models: ModelSetting[] = []
  for (const nodeType of ['text', 'image', 'audio', 'video'] as const) {
    const root = data[nodeType]
    const collect = (value: unknown, modelType?: ModelType, modelId?: string): void => {
      if (!record(value)) return
      if (typeof value.model_name === 'string' && modelId) {
        if (nodeType !== 'text' && !modelType) return
        const parameters = parameterMap(value.parameters)
        const senoirParameters = parameterMap(value.senoir_parameters)
        const defaults: Record<string, string | number | boolean | Record<string, string | number | boolean>> = {}
        for (const [key, parameter] of Object.entries(parameters)) {
          if (parameter.default !== undefined) defaults[key] = parameter.default
        }
        const seniorDefaults = Object.fromEntries(Object.entries(senoirParameters)
          .filter(([, parameter]) => parameter.default !== undefined)
          .map(([key, parameter]) => [key, parameter.default!]))
        if (Object.keys(seniorDefaults).length) defaults.seniorParams = seniorDefaults
        models.push({
          nodeType, ...(modelType ? { modelType } : {}), model: modelId,
          modelName: value.model_name, description: typeof value.description === 'string' ? value.description : '',
          maxPrompt: Number.isSafeInteger(value.maxPrompt) && (value.maxPrompt as number) >= 0 ? value.maxPrompt as number : 0,
          parameters, ...(Object.keys(senoirParameters).length ? { senoirParameters } : {}), defaultParameters: defaults
        } as ModelSetting)
        return
      }
      if (record(value.models)) { collect(value.models, modelType); return }
      for (const [key, child] of Object.entries(value)) {
        if (key === 'name') continue
        if (MODEL_TYPES[nodeType]?.includes(key as ModelType)) collect(child, key as ModelType)
        else collect(child, modelType, key)
      }
    }
    collect(root)
  }
  return models
}

function parameterMap(value: unknown): Record<string, ParameterSchema> {
  if (!record(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => workflowTypes.parameter.safeParse(item).success)) as Record<string, ParameterSchema>
}

function modelSummary(model: ModelSetting) {
  const { parameters, defaultParameters: _defaults, senoirParameters: _senior, ...base } = model
  return { ...base, capabilities: Object.fromEntries(Object.entries(parameters).map(([key, parameter]) =>
    [key, parameter.type === 'choices'
      ? { ...parameter, choices: parameter.choices.map(choice => choice.value) } : parameter])) }
}

function createNode(input: NodeCreateInput, models: ModelSetting[], nodes: Array<Node | CanvasGraphNode>): Node {
  if (!NODE_TYPES.includes(input.type)) throw new Error('未知节点类型')
  const selectedModel = 'model' in input && models.find(model => model.model === input.model && model.nodeType === input.type &&
    (!('modelType' in input) || !('modelType' in model) || input.modelType === model.modelType))
  if ('model' in input && !selectedModel) throw new Error('模型与节点类型不匹配，请先查询可用模型')
  const position = input.position ?? {
    x: nodes.reduce((right, node) => {
      const width = node.measured?.width
      return Math.max(right, node.position.x + (typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 400) + 40)
    }, 0),
    y: 0
  }
  const base = {
    id: randomUUID(), position, ...(input.size ? { measured: input.size } : {}),
    data: { title: input.title ?? `${input.type} 节点`, taskInfo: { status: 'success' as const } }
  }
  if (input.type === 'poseTool' || input.type === 'highDefinitionTool') return { ...base, type: input.type, data: { ...base.data, params: input.parameters ?? {} } } as Node
  const { type, title: _title, position: _position, size: _size, value, ...params } = input
  return { ...base, type, data: { ...base.data,
    ...(value !== undefined ? { value, type: 'upload' as const } : {}),
    params: { ...(selectedModel ? selectedModel.defaultParameters : {}), ...params, prompt: input.prompt ?? '', ...(type === 'text' ? { search_resource: input.search_resource ?? false } : {}) } } } as Node
}

function applyOperation(workflow: Workflow, operation: WorkflowOperation, result: ApplyWorkflowPatchOutput,
  models: ModelSetting[], canvasNodes: CanvasGraphNode[]): void {
  switch (operation.op) {
    case 'add_node': {
      const node = createNode(operation.node, models, [...canvasNodes, ...workflow.nodes])
      workflow.nodes.push(node)
      result.createdNodes.push({ id: node.id })
      return
    }
    case 'update_node': {
      const node = workflow.nodes.find(item => item.id === operation.id)
      if (!node || node.type !== operation.changes.type) throw new Error('目标节点不存在或类型不匹配')
      const { title, position, size, type: _type, ...params } = operation.changes
      if (title !== undefined) node.data.title = title
      if (position !== undefined) node.position = position
      if (size !== undefined) node.measured = size
      const target = node.data.params as Record<string, unknown> | undefined
      if (target) {
        for (const [key, value] of Object.entries(params)) {
          if (key === 'value') {
            node.data.value = value as Node['data']['value']
          } else if (key === 'parameters') {
            const patch = value as { set?: Record<string, unknown>; unset?: string[] }
            const next = { ...target, ...patch.set }
            for (const unset of patch.unset ?? []) delete next[unset]
            node.data.params = next as never
          } else target[key] = value
        }
      }
      return
    }
    case 'delete_node': {
      const before = workflow.nodes.length
      workflow.nodes = workflow.nodes.filter(node => node.id !== operation.id)
      if (before === workflow.nodes.length) throw new Error('目标节点不存在')
      workflow.edges = workflow.edges.filter(edge => edge.source !== operation.id && edge.target !== operation.id)
      return
    }
    case 'add_edge': {
      const { source, target } = operation
      if (!source || !target || source === target || !workflow.nodes.some(node => node.id === source) || !workflow.nodes.some(node => node.id === target)) throw new Error('连线节点无效')
      const edge: Edge = { id: randomUUID(), source, target, sourceHandle: operation.sourceHandle ?? 'output', targetHandle: operation.targetHandle ?? 'input' }
      workflow.edges.push(edge)
      result.createdEdges.push({ id: edge.id })
      return
    }
    case 'delete_edge': {
      const before = workflow.edges.length
      workflow.edges = workflow.edges.filter(edge => edge.id !== operation.id)
      if (before === workflow.edges.length) throw new Error('目标连线不存在')
      return
    }
    case 'rename_workflow':
      if (!operation.name.trim()) throw new Error('工作流名称不能为空')
      workflow.name = operation.name
      return
    default: throw new Error('未知工作流操作')
  }
}

function draftPatch(before: Workflow, input: ApplyWorkflowPatchInput, models: ModelSetting[], canvasNodes: CanvasGraphNode[]):
  { result: ApplyWorkflowPatchOutput; after?: Workflow } {
  const result: ApplyWorkflowPatchOutput = {
    applied: false, valid: false, createdNodes: [], createdEdges: [], errors: [], warnings: []
  }
  const after = structuredClone(before)
  try {
    for (const operation of input.operations) applyOperation(after, operation, result, models, canvasNodes)
  } catch (error) {
    result.createdNodes = []
    result.createdEdges = []
    result.errors.push({ code: 'INVALID_PATCH', message: error instanceof Error ? error.message : String(error) })
    return { result }
  }
  result.valid = true
  result.applied = true
  return { result, after }
}

export class RemoteWorkflowBackend implements WorkflowBackend {
  readonly skillDescription = '工作流保存在远端画布；当前画布 API 不支持执行工作流。'
  readonly toolNotice = '画布操作使用远端数据；执行与运行查询暂不可用。'
  readonly skillContent = workflowSkillContent
  private readonly summaries = new Map<string, WorkflowSummary>()

  constructor(private readonly canvas: CanvasApi = createCanvasApi()) {}

  dispose(): void { this.canvas.dispose() }

  currentSummary(id: string): WorkflowSummary | undefined { return this.summaries.get(id) }

  private async flow(id: string): Promise<FlowData> {
    const flow = required((await this.canvas.getFlowData({ id })).data)
    this.summaries.set(id, flowSummary(flow))
    return flow
  }

  private async models(): Promise<ModelSetting[]> {
    return settings(required((await this.canvas.getModelParams())))
  }

  async execute<K extends keyof WorkflowToolContracts>(name: K, input: WorkflowToolContracts[K]['input']): Promise<WorkflowToolContracts[K]['output']> {
    const args = input as Record<string, unknown>
    let output: unknown
    switch (name) {
      case 'get_node_definition': {
        const requested = Array.isArray(args.nodeType) ? args.nodeType : [args.nodeType]
        const models = await this.models()
        output = { nodeDefinitions: requested.map(type => {
          const description = required(NODE_DESCRIPTIONS[type as NodeType])
          const types = [...new Set(models.filter(model => model.nodeType === type && 'modelType' in model)
            .map(model => model.modelType))]
          return { nodeType: type, description,
            ...(types.length ? { supportedModelTypes: types } : {}) }
        }) }
        break
      }
      case 'search_models': {
        const query = args.query as Query
        output = { models: take((await this.models()).filter(model => matchesQuery(model, query)).map(modelSummary), query.limit) }
        break
      }
      case 'get_model_setting': {
        const model = (await this.models()).find(model => matchesQuery(model, args.query as Query))
        if (!model) throw new Error('模型不存在')
        output = { model }; break
      }
      case 'create_workflow': {
        const name = typeof args.name === 'string' ? args.name : '未命名工作流'
        const saved = required((await this.canvas.saveFlow({
          name, version: 'comfyui', canvasType: 0, data: JSON.stringify({ nodes: [], edges: [] })
        })).data)
        if (saved.id === undefined || saved.id === null) throw new Error('画布服务未返回工作流 ID')
        const workflow = { id: String(saved.id), name, nodeCount: 0, edgeCount: 0 }
        this.summaries.set(workflow.id, workflow)
        output = { workflow }; break
      }
      case 'list_workflows': {
        const query = args.query as Query | undefined
        const workflows: WorkflowSummary[] = []
        for (let page = 1; ; page++) {
          const data = required((await this.canvas.getFlowsList({ page, size: 100 })).data)
          for (const entry of data.records) {
            if (!matchesQuery({ id: String(entry.id), name: entry.name }, query)) continue
            workflows.push(flowSummary(await this.flow(String(entry.id))))
            if (query?.limit && workflows.length >= query.limit) break
          }
          if (query?.limit && workflows.length >= query.limit || page * 100 >= data.total || !data.records.length) break
        }
        output = { workflows }; break
      }
      case 'get_workflow': {
        const flow = await this.flow(args.workflowId as string)
        if (args.view === undefined || args.view === 'summary') {
          output = { view: 'summary', workflow: flowSummary(flow) }
          break
        }
        const workflow = project(flow)
        output = args.view === 'full' ? { view: 'full', workflow }
          : { view: 'structure', workflow: flowSummary(flow),
            nodes: workflow.nodes.map(nodeSummary), edges: workflow.edges }
        break
      }
      case 'list_nodes': {
        const workflow = project(await this.flow(args.workflowId as string))
        const query = args.query as Query | undefined
        const nodes = take(workflow.nodes.filter(node => matchesQuery(node, query)), query?.limit)
        output = args.view === 'full' ? { view: 'full', nodes } : { view: 'summary', nodes: nodes.map(nodeSummary) }
        break
      }
      case 'get_node': {
        const node = project(await this.flow(args.workflowId as string)).nodes.find(node => node.id === args.id)
        if (!node) throw new Error('节点不存在')
        output = { node }; break
      }
      case 'apply_workflow_patch': output = await this.patch(input as ApplyWorkflowPatchInput); break
      case 'execute_workflow':
      case 'get_workflow_run': throw new Error('画布 API 暂不支持工作流执行与运行查询')
    }
    return output as WorkflowToolContracts[K]['output']
  }

  private async patch(input: ApplyWorkflowPatchInput): Promise<ApplyWorkflowPatchOutput> {
    const flow = await this.flow(input.workflowId)
    const before = project(flow)
    const models = await this.models()
    if (input.operations.some(operation => operation.op === 'add_edge' &&
      (!operation.sourceHandle?.trim() || !operation.targetHandle?.trim()))) return {
      applied: false, valid: false, createdNodes: [], createdEdges: [], warnings: [],
      errors: [{ code: 'INVALID_PATCH', message: '远端画布缺少端口定义，请显式提供 sourceHandle 和 targetHandle' }]
    }
    const { result, after } = draftPatch(before, input, models, flow.data.nodes)
    if (!after) return result
    const touched = new Set([
      ...result.createdNodes.map(item => item.id),
      ...input.operations.filter(operation => operation.op === 'update_node').map(operation => operation.id)
    ])
    for (const node of after.nodes.filter(node => touched.has(node.id))) {
      if (node.type === 'poseTool' || node.type === 'highDefinitionTool') continue
      if ((node.type === 'image' || node.type === 'audio' || node.type === 'video') && node.data.type === 'upload') continue
      if (!node.data.params.model) continue
      const selected = models.find(model => model.nodeType === node.type && model.model === node.data.params.model &&
        (node.type === 'text' || model.modelType === node.data.params.modelType))
      if (!selected) return { applied: false, valid: false, createdNodes: [], createdEdges: [], warnings: [],
        errors: [{ code: 'MODEL_NOT_FOUND', message: `节点 ${node.id} 的模型与生成方式不匹配` }] }
    }
    const renamed = after.name !== before.name
    const graphChanged = JSON.stringify({ nodes: after.nodes, edges: after.edges }) !==
      JSON.stringify({ nodes: before.nodes, edges: before.edges })
    if (renamed && graphChanged) return {
      applied: false, valid: false, createdNodes: [], createdEdges: [], warnings: [],
      errors: [{ code: 'UNSUPPORTED_PATCH', message: '画布 API 不支持在同一事务中同时重命名和修改图结构' }]
    }
    if (graphChanged) {
      const prior = new Map(before.nodes.map(node => [node.id, node]))
      const current = new Map(after.nodes.map(node => [node.id, node]))
      const added = after.nodes.filter(node => !prior.has(node.id))
      const updated = after.nodes.filter(node => prior.has(node.id) && JSON.stringify(node) !== JSON.stringify(prior.get(node.id)))
      const deleted = before.nodes.filter(node => !current.has(node.id)).map(node => node.id)
      const raw = new Map(flow.data.nodes.map(node => [node.id, node]))
      const serialize = (node: Node): string => {
        const original = raw.get(node.id)
        const previous = prior.get(node.id)
        if (!original || !previous) return JSON.stringify(node)
        const params = { ...original.data.params }
        const beforeParams = previous.data.params as Record<string, unknown>
        const afterParams = node.data.params as Record<string, unknown>
        for (const key of new Set([...Object.keys(beforeParams), ...Object.keys(afterParams)])) {
          if (JSON.stringify(beforeParams[key]) === JSON.stringify(afterParams[key])) continue
          if (Object.hasOwn(afterParams, key)) params[key] = afterParams[key]
          else delete params[key]
        }
        return JSON.stringify({ ...original, position: node.position,
          ...(node.measured ? { measured: node.measured } : {}),
          data: { ...original.data, title: node.data.title, params,
            ...(JSON.stringify(node.data.value) !== JSON.stringify(previous.data.value) ? { value: node.data.value } : {}) } })
      }
      const visibleEdgeIds = new Set(before.edges.map(edge => edge.id))
      await this.canvas.updateCanvas({ id: before.id, versionNumber: flow.versionNumber,
        ...(added.length ? { addNodes: added.map(serialize) } : {}),
        ...(updated.length ? { updateNodes: updated.map(serialize) } : {}),
        ...(deleted.length ? { deleteNodeIds: deleted } : {}),
        edges: [
          ...flow.data.edges.filter(edge => !visibleEdgeIds.has(edge.id) &&
            !deleted.includes(edge.source) && !deleted.includes(edge.target)),
          ...after.edges.map(edge => flow.data.edges.find(item => item.id === edge.id) ?? { ...edge })
        ] })
    } else if (renamed) {
      await this.canvas.saveFlow({ id: before.id, version: flow.version,
        versionNumber: flow.versionNumber, name: after.name, canvasType: flow.canvasType })
    }
    this.summaries.set(before.id, summary(after))
    return result
  }
}
