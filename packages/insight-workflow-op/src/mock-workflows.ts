import { randomUUID } from 'node:crypto'
import type {
  ApplyWorkflowPatchInput, ApplyWorkflowPatchOutput, Edge, ModelSetting, Node, NodeCreateInput,
  NodeSummary, Workflow, WorkflowOperation, WorkflowSummary
} from './workflow-agent-tools.type'

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

export class MockWorkflows {
  readonly workflows = new Map<string, Workflow>()
  readonly runs = new Map<string, { runId: string; workflowId: string; status: 'running'; nodes: [] }>()
  readonly patches = new Map<string, ApplyWorkflowPatchOutput>()
  readonly executed = new Map<string, string>()

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

  patch(input: ApplyWorkflowPatchInput): ApplyWorkflowPatchOutput {
    const current = this.get(input.workflowId)
    const key = input.idempotencyKey && `${input.workflowId}:${input.idempotencyKey}`
    if (key && this.patches.has(key)) return this.patches.get(key)!
    const result: ApplyWorkflowPatchOutput = {
      applied: false, valid: false,
      createdNodes: [], createdEdges: [], errors: [], warnings: []
    }
    // shortcut: mock uses JSON cloning and process memory; replace with the canvas transaction API when available.
    const draft = structuredClone(current)
    const created = new Map<string, string>()
    try {
      for (const operation of input.operations) this.applyOperation(draft, operation, created, result)
      for (const node of draft.nodes) {
        if ((node.type === 'text' || node.type === 'image' || node.type === 'audio' || node.type === 'video') &&
          !MODELS.some(model => model.nodeType === node.type && model.model === node.data.params.model)) {
          throw new Error('模型与节点类型不匹配')
        }
        if (node.type === 'video' && (node.data.params.modelType !== 'text_to_video' ||
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
    if (!input.dryRun) {
      this.workflows.set(draft.id, draft)
      result.applied = true
      if (key) this.patches.set(key, result)
    } else {
      result.createdNodes = []
      result.createdEdges = []
    }
    return result
  }

  private applyOperation(workflow: Workflow, operation: WorkflowOperation, created: Map<string, string>, result: ApplyWorkflowPatchOutput): void {
    switch (operation.op) {
      case 'add_node': {
        if (created.has(operation.clientId)) throw new Error('clientId 重复')
        const node = this.createNode(operation.node)
        workflow.nodes.push(node)
        created.set(operation.clientId, node.id)
        result.createdNodes.push({ clientId: operation.clientId, nodeId: node.id })
        return
      }
      case 'update_node': {
        const node = workflow.nodes.find(item => item.id === operation.nodeId)
        if (!node || node.type !== operation.changes.type) throw new Error('目标节点不存在或类型不匹配')
        const { title, position, size, type: _type, ...params } = operation.changes
        if (title !== undefined) node.data.title = title
        if (position !== undefined) node.position = position
        if (size !== undefined) node.measured = size
        const target = node.data.params as Record<string, unknown> | undefined
        if (target) {
          for (const [key, value] of Object.entries(params)) {
            if (key === 'additionalParameters' || key === 'parameters') {
              const patch = value as { set?: Record<string, unknown>; unset?: string[] }
              const name = key === 'parameters' ? 'params' : key
              const existing = (name === 'params' ? target : target[name]) as Record<string, unknown> | undefined
              const next = { ...existing, ...patch.set }
              for (const unset of patch.unset ?? []) delete next[unset]
              if (name === 'params') node.data.params = next as never
              else target[name] = next
            } else target[key] = value
          }
        }
        return
      }
      case 'delete_node': {
        const before = workflow.nodes.length
        workflow.nodes = workflow.nodes.filter(node => node.id !== operation.nodeId)
        if (before === workflow.nodes.length) throw new Error('目标节点不存在')
        workflow.edges = workflow.edges.filter(edge => edge.source !== operation.nodeId && edge.target !== operation.nodeId)
        return
      }
      case 'add_edge': {
        const resolve = (reference: typeof operation.source) => reference.kind === 'existing' ? reference.nodeId : created.get(reference.clientId)
        const source = resolve(operation.source)
        const target = resolve(operation.target)
        if (!source || !target || source === target || !workflow.nodes.some(node => node.id === source) || !workflow.nodes.some(node => node.id === target)) throw new Error('连线节点无效')
        const edge: Edge = { id: randomUUID(), source, target, sourceHandle: operation.sourceHandle ?? 'output', targetHandle: operation.targetHandle ?? 'input' }
        workflow.edges.push(edge)
        result.createdEdges.push({ clientId: operation.clientId, edgeId: edge.id })
        return
      }
      case 'delete_edge': {
        const before = workflow.edges.length
        workflow.edges = workflow.edges.filter(edge => edge.id !== operation.edgeId)
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
    const selectedModel = 'model' in input && MODELS.find(model => model.model === input.model && model.nodeType === input.type &&
      (!('modelType' in input) || !('modelType' in model) || input.modelType === model.modelType))
    if ('model' in input && !selectedModel) {
      throw new Error('模型与节点类型不匹配，请先查询可用模型')
    }
    if (input.type === 'video' && (input.modelType !== 'text_to_video' ||
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
