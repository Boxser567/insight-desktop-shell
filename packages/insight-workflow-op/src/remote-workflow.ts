import type {
  ApplyWorkflowPatchInput, ApplyWorkflowPatchOutput, ModelSetting, ModelType, Node, NodeSummary,
  NodeType, ParameterSchema, Query, Workflow, WorkflowBackend, WorkflowSummary, WorkflowToolContracts
} from '@insight-ai/insight-workflow-protocol'
import { workflowTypes } from '../../insight-workflow-protocol/src/workflow-schemas'
import { createCanvasApi, type CanvasApi, type CanvasGraphNode, type FlowData } from './canvas-api'
import { matchesQuery, MockWorkflowBackend, NODE_DEFINITIONS, NODE_TYPES, nodeSummary, summary, take } from './mock-workflows'
import { workflowSkillContent } from './workflow-skill'

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
    selected.prompt ??= ''
    if (raw.type === 'text') selected.search_resource ??= false
  }
  const rawTask = record(raw.data.taskInfo) ? raw.data.taskInfo : {}
  const status = rawTask.status === 'success' || rawTask.status === 'SUCCESS' ? 'success'
    : rawTask.status === 'failed' || rawTask.status === 'failure' || rawTask.status === 'FAILURE' ? 'failed' : 'running'
  const candidate = {
    id: raw.id, type: raw.type, position: raw.position,
    ...(raw.measured ? { measured: raw.measured } : {}),
    data: {
      title: raw.data.title,
      value: typeof raw.data.value === 'string' || Array.isArray(raw.data.value) ? raw.data.value : '',
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
          const definition = required(NODE_DEFINITIONS.find(node => node.nodeType === type))
          const types = [...new Set(models.filter(model => model.nodeType === type && 'modelType' in model)
            .map(model => model.modelType))]
          return { nodeType: definition.nodeType, description: definition.description,
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
    const draftBackend = new MockWorkflowBackend(models, false)
    draftBackend.workflows.set(before.id, before)
    const result = draftBackend.patch(input)
    if (!result.valid) return result
    const after = draftBackend.get(before.id)
    const touched = new Set([
      ...result.createdNodes.map(item => item.id),
      ...input.operations.filter(operation => operation.op === 'update_node').map(operation => operation.id)
    ])
    for (const node of after.nodes.filter(node => touched.has(node.id))) {
      if (!(node.type in PARAM_KEYS)) continue
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
          data: { ...original.data, title: node.data.title, params } })
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
