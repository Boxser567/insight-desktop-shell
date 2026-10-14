import { randomUUID } from 'node:crypto'
import { workflowSkillContent } from './workflow-skill'
import type {
  ApplyWorkflowPatchInput, ApplyWorkflowPatchOutput, Edge, ModelSetting, Node, NodeCreateInput,
  NodeSummary, Query, QueryFilter, Workflow, WorkflowBackend, WorkflowOperation, WorkflowSummary, WorkflowToolContracts
} from '@insight-ai/insight-workflow-protocol'

export function take<T>(items: T[], limit?: number): T[] {
  if (limit === undefined) return items
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit 必须为正整数')
  return items.slice(0, limit)
}

export function matchesQuery(value: unknown, query?: Query): boolean {
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

export const NODE_TYPES = ['text', 'image', 'audio', 'video', 'poseTool', 'highDefinitionTool'] as const
export const VIDEO_MODEL: ModelSetting = {
  model: 'mock-video-5s', modelName: '模拟视频模型', description: '仅用于工作流工具联调，不生成视频',
  maxPrompt: 2000, nodeType: 'video', modelType: 'text_to_video',
  parameters: { duration: { type: 'number', label: '时长（秒）', min: 1, max: 10, step: 1, default: 5 } },
  defaultParameters: { duration: 5 }
}
export const MODELS: ModelSetting[] = [
  { model: 'mock-text', modelName: '模拟文本模型', description: '仅供联调', maxPrompt: 2000, nodeType: 'text', parameters: {}, defaultParameters: {} },
  { model: 'mock-image', modelName: '模拟图像模型', description: '仅供联调', maxPrompt: 2000, nodeType: 'image', modelType: 'text_to_image', parameters: {}, defaultParameters: {} },
  { model: 'mock-audio', modelName: '模拟音频模型', description: '仅供联调', maxPrompt: 2000, nodeType: 'audio', modelType: 'text_to_audio', parameters: {}, defaultParameters: {} },
  VIDEO_MODEL
]

export const NODE_DEFINITIONS = NODE_TYPES.map(nodeType => ({
  nodeType,
  description: ({ text: '文本', image: '图像', audio: '音频', video: '视频', poseTool: '姿态工具', highDefinitionTool: '高清工具' })[nodeType],
  ...(nodeType === 'video' ? { supportedModelTypes: ['text_to_video' as const] } :
    nodeType === 'image' ? { supportedModelTypes: ['text_to_image' as const] } :
    nodeType === 'audio' ? { supportedModelTypes: ['text_to_audio' as const] } : {})
}))

export function summary(workflow: Workflow): WorkflowSummary {
  return { id: workflow.id, name: workflow.name, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length }
}

export function nodeSummary(node: Node): NodeSummary {
  return {
    id: node.id, type: node.type, title: node.data.title, position: node.position,
    ...(node.type === 'text' || node.type === 'image' || node.type === 'audio' || node.type === 'video' ? { model: node.data.params.model } : {}),
    ...(node.type === 'image' || node.type === 'audio' || node.type === 'video' ? { modelType: node.data.params.modelType } : {}),
    status: node.data.taskInfo.status
  }
}

export class MockWorkflowBackend implements WorkflowBackend {
  readonly skillDescription = '当前仅提供 mock，不能产出真实媒体。'
  readonly toolNotice = '当前返回 mock 数据，不执行真实画布或媒体任务。'
  readonly skillContent = workflowSkillContent

  readonly workflows = new Map<string, Workflow>()
  readonly runs = new Map<string, { runId: string; workflowId: string; status: 'running'; nodes: [] }>()
  readonly executed = new Map<string, string>()

  constructor(private readonly models: ModelSetting[] = MODELS, private readonly validateAllModels = true) {}

  async execute<K extends keyof WorkflowToolContracts>(name: K, input: WorkflowToolContracts[K]['input']): Promise<WorkflowToolContracts[K]['output']> {
    const args = input as Record<string, unknown>
    let output: unknown
    switch (name) {
      case 'get_node_definition': {
        const types = Array.isArray(args.nodeType) ? args.nodeType : [args.nodeType]
        const nodeDefinitions = types.map(type => NODE_DEFINITIONS.find(node => node.nodeType === type))
        if (nodeDefinitions.some(node => !node)) throw new Error('未知节点类型')
        output = { nodeDefinitions }; break
      }
      case 'search_models': {
        const query = args.query as Query
        const models = this.models.filter(model => matchesQuery(model, query))
          .map(({ parameters, defaultParameters: _defaults, senoirParameters: _senior, ...model }) => ({
            ...model,
            capabilities: Object.fromEntries(Object.entries(parameters).map(([key, parameter]) =>
              [key, parameter.type === 'choices' ? { ...parameter, choices: parameter.choices.map(choice => choice.value) } : parameter]))
          }))
        output = { models: take(models, query.limit) }
        break
      }
      case 'get_model_setting': {
        const model = this.models.find(model => matchesQuery(model, args.query as Query))
        if (!model) throw new Error('模型不存在')
        output = { model }; break
      }
      case 'create_workflow': output = { workflow: this.create(args.name as string | undefined) }; break
      case 'list_workflows': {
        const query = args.query as Query | undefined
        const workflows = [...this.workflows.values()].filter(workflow => matchesQuery(workflow, query)).map(summary)
        output = { workflows: take(workflows, query?.limit) }; break
      }
      case 'get_workflow': {
        const workflow = this.get(args.workflowId as string)
        output = args.view === 'full' ? { view: 'full', workflow } : args.view === 'structure'
          ? { view: 'structure', workflow: summary(workflow), nodes: workflow.nodes.map(nodeSummary), edges: workflow.edges }
          : { view: 'summary', workflow: summary(workflow) }
        break
      }
      case 'list_nodes': {
        const query = args.query as Query | undefined
        const found = this.get(args.workflowId as string).nodes.filter(node => matchesQuery(node, query))
        const nodes = take(found, query?.limit)
        output = args.view === 'full' ? { view: 'full', nodes } : { view: 'summary', nodes: nodes.map(nodeSummary) }
        break
      }
      case 'get_node': {
        const node = this.get(args.workflowId as string).nodes.find(node => node.id === args.id)
        if (!node) throw new Error('节点不存在')
        output = { node }; break
      }
      case 'apply_workflow_patch': output = this.patch(input as ApplyWorkflowPatchInput); break
      case 'execute_workflow': {
        const workflow = this.get(args.workflowId as string)
        const key = typeof args.idempotencyKey === 'string' && `${workflow.id}:${args.idempotencyKey}`
        const previous = key && this.executed.get(key)
        if (previous) {
          const run = this.runs.get(previous)!
          output = { runId: run.runId, workflowId: run.workflowId, status: run.status, mock: true }
          break
        }
        if (!workflow.nodes.length) throw new Error('空工作流不能执行')
        const run = { runId: randomUUID(), workflowId: workflow.id, status: 'running' as const, nodes: [] as [] }
        this.runs.set(run.runId, run)
        if (key) this.executed.set(key, run.runId)
        output = { runId: run.runId, workflowId: run.workflowId, status: run.status, mock: true }; break
      }
      case 'get_workflow_run': {
        const run = this.runs.get(args.runId as string)
        if (!run) throw new Error('运行记录不存在')
        output = { run: { ...run, mock: true } }; break
      }
    }
    return output as WorkflowToolContracts[K]['output']
  }

  create(name = '未命名工作流'): WorkflowSummary {
    const workflow: Workflow = { id: randomUUID(), name, nodes: [], edges: [] }
    this.workflows.set(workflow.id, workflow)
    return summary(workflow)
  }

  get(id: string): Workflow {
    const workflow = this.workflows.get(id)
    if (!workflow) throw new Error(`工作流不存在：${id}（mock 数据仅在当前运行期间可用）`)
    return workflow
  }

  currentSummary(id: string): WorkflowSummary | undefined {
    const workflow = this.workflows.get(id)
    return workflow && summary(workflow)
  }

  patch(input: ApplyWorkflowPatchInput): ApplyWorkflowPatchOutput {
    const current = this.get(input.workflowId)
    const result: ApplyWorkflowPatchOutput = {
      applied: false, valid: false,
      createdNodes: [], createdEdges: [], errors: [], warnings: []
    }
    // shortcut: mock uses JSON cloning and process memory; replace with the canvas transaction API when available.
    const draft = structuredClone(current)
    try {
      for (const operation of input.operations) this.applyOperation(draft, operation, result)
      for (const node of draft.nodes) {
        if (this.validateAllModels && (node.type === 'text' || node.type === 'image' || node.type === 'audio' || node.type === 'video') &&
          !this.models.some(model => model.nodeType === node.type && model.model === node.data.params.model)) {
          throw new Error('模型与节点类型不匹配')
        }
        if (this.models === MODELS && node.type === 'video' && (node.data.params.modelType !== 'text_to_video' ||
          (node.data.params.duration !== undefined && (!Number.isInteger(node.data.params.duration) || node.data.params.duration < 1 || node.data.params.duration > 10)))) {
          throw new Error('mock 视频仅支持 text_to_video，时长为 1～10 秒')
        }
      }
    } catch (error) {
      result.createdNodes = []
      result.createdEdges = []
      result.errors.push({ code: 'INVALID_PATCH', message: error instanceof Error ? error.message : String(error) })
      return result
    }
    result.valid = true
    this.workflows.set(draft.id, draft)
    result.applied = true
    return result
  }

  private applyOperation(workflow: Workflow, operation: WorkflowOperation, result: ApplyWorkflowPatchOutput): void {
    switch (operation.op) {
      case 'add_node': {
        const node = this.createNode(operation.node)
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
            if (key === 'parameters') {
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

  private createNode(input: NodeCreateInput): Node {
    if (!NODE_TYPES.includes(input.type)) throw new Error('未知节点类型')
    const selectedModel = 'model' in input && this.models.find(model => model.model === input.model && model.nodeType === input.type &&
      (!('modelType' in input) || !('modelType' in model) || input.modelType === model.modelType))
    if ('model' in input && !selectedModel) {
      throw new Error('模型与节点类型不匹配，请先查询可用模型')
    }
    if (this.models === MODELS && input.type === 'video' && (input.modelType !== 'text_to_video' ||
      (input.duration !== undefined && (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 10)))) {
      throw new Error('mock 视频仅支持 text_to_video，时长为 1～10 秒')
    }
    const base = {
      id: randomUUID(), position: input.position ?? { x: 0, y: 0 }, ...(input.size ? { measured: input.size } : {}),
      data: { title: input.title ?? `${input.type} 节点`, value: '', taskInfo: { status: 'running' as const } }
    }
    if (input.type === 'poseTool' || input.type === 'highDefinitionTool') return { ...base, type: input.type, data: { ...base.data, params: input.parameters ?? {} } } as Node
    const { type, title: _title, position: _position, size: _size, ...params } = input
    return { ...base, type, data: { ...base.data, params: { ...(selectedModel ? selectedModel.defaultParameters : {}), ...params, prompt: input.prompt ?? '', ...(type === 'text' ? { search_resource: input.search_resource ?? false } : {}) } } } as Node
  }
}
