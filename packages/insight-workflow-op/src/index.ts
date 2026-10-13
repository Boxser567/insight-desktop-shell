import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import { WORKFLOW_TOOL_DESCRIPTIONS } from './workflow-agent-tools.type'
import type { ApplyWorkflowPatchInput, Query, QueryFilter, WorkflowToolContracts } from './workflow-agent-tools.type'
import { dshSchema, workflowResultGuides, workflowSchemas } from './workflow-schemas'
import { workflowSkillContent } from './workflow-skill'
import { MockWorkflows, MODELS, NODE_DEFINITIONS, nodeSummary, summary } from './mock-workflows'

export const inject = ['tools', 'skills', 'systemPrompt']
export const name = 'insight-workflow-op'

const skill = {
  name: 'insight-workflow',
  description: '用户要创建、查看、修改或运行工作流，或请求生成图像、音频、视频时使用。当前仅提供 mock，不能产出真实媒体。',
  source: 'runtime' as const,
  invocation: { modelInvocable: true, userInvocable: false },
  content: workflowSkillContent
}

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

export function apply(ctx: Context): void {
  const store = new MockWorkflows()
  const active = new WeakMap<object, { workflowId?: string }>()
  const remembered = new Map<string, string>()

  ctx.skills.register(skill)
  ctx.on('agent/created', ({ agent, source }) => {
    if (source === 'clear') remembered.delete(agent.id)
    let workflowId = remembered.get(agent.id)
    if (!workflowId || !store.workflows.has(workflowId)) {
      const calls = new Map<string, string | null>()
      for (const message of agent.session.deriveMessages()) {
        for (const block of message.content) {
          if (block.type === 'tool-call') {
            if (block.name === 'workflow_create_workflow') calls.set(block.id, null)
            else if (block.name.startsWith('workflow_')) {
              try {
                const input = JSON.parse(block.arguments)
                if (typeof input?.workflowId === 'string') calls.set(block.id, input.workflowId)
              } catch { /* Ignore malformed historical tool arguments. */ }
            }
          } else if ((block as { type: string }).type === 'tool-result') {
            // Persisted tool results are present at runtime but omitted from deriveMessages' block type.
            const resultBlock = block as unknown as { toolCallId: string; isError?: boolean; content: Array<{ type: string; text?: string }> }
            if (!calls.has(resultBlock.toolCallId)) continue
            const requestedId = calls.get(resultBlock.toolCallId)
            calls.delete(resultBlock.toolCallId)
            if (resultBlock.isError) continue
            let id = requestedId
            if (id === null) {
              try {
                const result = JSON.parse(resultBlock.content.find(part => part.type === 'text')?.text ?? '')
                id = typeof result?.workflow?.id === 'string' ? result.workflow.id : undefined
              } catch { /* Ignore malformed historical tool results. */ }
            }
            if (id && store.workflows.has(id)) workflowId = id
          }
        }
      }
    }
    const state = { workflowId }
    if (workflowId) remembered.set(agent.id, workflowId)
    active.set(agent, state)
    agent.ctx.systemPrompt.context({
      name: 'insight-workflow', order: 500,
      text: () => {
        const current = state.workflowId && store.workflows.get(state.workflowId)
        return current ? `当前工作流最新摘要：${JSON.stringify(summary(current))}` : ''
      }
    })
    return undefined
  })
  async function call<K extends keyof WorkflowToolContracts>(name: K, input: WorkflowToolContracts[K]['input']): Promise<WorkflowToolContracts[K]['output']> {
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
        const models = MODELS.filter(model => matchesQuery(model, query))
          .map(({ parameters, defaultParameters: _defaults, senoirParameters: _senior, ...model }) => ({
            ...model,
            capabilities: Object.fromEntries(Object.entries(parameters).map(([key, parameter]) =>
              [key, parameter.type === 'choices' ? { ...parameter, choices: parameter.choices.map(choice => choice.value) } : parameter]))
          }))
        output = { models: take(models, query.limit) }
        break
      }
      case 'get_model_setting': {
        const model = MODELS.find(model => matchesQuery(model, args.query as Query))
        if (!model) throw new Error('模型不存在')
        output = { model }; break
      }
      case 'create_workflow': output = { workflow: store.create(args.name as string | undefined) }; break
      case 'list_workflows': {
        const query = args.query as Query | undefined
        const workflows = [...store.workflows.values()].filter(workflow => matchesQuery(workflow, query)).map(summary)
        output = { workflows: take(workflows, query?.limit) }; break
      }
      case 'get_workflow': {
        const workflow = store.get(args.workflowId as string)
        output = args.view === 'full' ? { view: 'full', workflow } : args.view === 'structure'
          ? { view: 'structure', workflow: summary(workflow), nodes: workflow.nodes.map(nodeSummary), edges: workflow.edges }
          : { view: 'summary', workflow: summary(workflow) }
        break
      }
      case 'list_nodes': {
        const query = args.query as Query | undefined
        const found = store.get(args.workflowId as string).nodes.filter(node => matchesQuery(node, query))
        const nodes = take(found, query?.limit)
        output = args.view === 'full' ? { view: 'full', nodes } : { view: 'summary', nodes: nodes.map(nodeSummary) }
        break
      }
      case 'get_node': {
        const node = store.get(args.workflowId as string).nodes.find(node => node.id === args.nodeId)
        if (!node) throw new Error('节点不存在')
        output = { node }; break
      }
      case 'apply_workflow_patch': output = store.patch(input as ApplyWorkflowPatchInput); break
      case 'execute_workflow': {
        const workflow = store.get(args.workflowId as string)
        const key = typeof args.idempotencyKey === 'string' && `${workflow.id}:${args.idempotencyKey}`
        const previous = key && store.executed.get(key)
        if (previous) {
          const run = store.runs.get(previous)!
          output = { runId: run.runId, workflowId: run.workflowId, status: run.status, mock: true }
          break
        }
        if (!workflow.nodes.length) throw new Error('空工作流不能执行')
        const run = { runId: randomUUID(), workflowId: workflow.id, status: 'running' as const, nodes: [] as [] }
        store.runs.set(run.runId, run)
        if (key) store.executed.set(key, run.runId)
        output = { runId: run.runId, workflowId: run.workflowId, status: run.status, mock: true }; break
      }
      case 'get_workflow_run': {
        const run = store.runs.get(args.runId as string)
        if (!run) throw new Error('运行记录不存在')
        output = { run: { ...run, mock: true } }; break
      }
    }
    return output as WorkflowToolContracts[K]['output']
  }

  for (const name of Object.keys(workflowSchemas) as Array<keyof WorkflowToolContracts>) {
    const contract = workflowSchemas[name]
    const definition: ToolDefinition = {
      name: `workflow_${name}`,
      description: `${WORKFLOW_TOOL_DESCRIPTIONS[name]} 返回：${workflowResultGuides[name]} 当前返回 mock 数据，不执行真实画布或媒体任务。`,
      parameters: { ...dshSchema(contract.input) },
      output: { schema: dshSchema(contract.output), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const parsed = contract.input.parse(args)
        const result = contract.output.parse(await call(name, parsed as never))
        const state = exec.agent && active.get(exec.agent)
        if (state) {
          const id = (result as { workflow?: { id?: string } }).workflow?.id ?? (args as { workflowId?: string }).workflowId
          if (id && store.workflows.has(id)) {
            state.workflowId = id
            remembered.set(exec.agent.id, id)
          }
        }
        return result
      }
    }
    ctx.tools.register(definition)
  }
}
