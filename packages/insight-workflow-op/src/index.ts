import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import { WORKFLOW_TOOL_DESCRIPTIONS, workflowResultGuides, workflowSchemas } from '@insight-ai/insight-workflow-protocol'
import type { WorkflowBackend, WorkflowToolContracts } from '@insight-ai/insight-workflow-protocol'
import { dshSchema } from './dsh-schema'
import { MockWorkflowBackend } from './mock-workflows'

export const inject = ['tools', 'skills', 'systemPrompt']
export const name = 'insight-workflow-op'

export function apply(ctx: Context): void {
  const backend: WorkflowBackend = new MockWorkflowBackend()
  const skill = {
    name: 'insight-workflow',
    description: `用户要创建、查看、修改或运行工作流，或请求生成图像、音频、视频时使用。${backend.skillDescription}`,
    source: 'runtime' as const,
    invocation: { modelInvocable: true, userInvocable: false },
    content: backend.skillContent
  }
  const active = new WeakMap<object, { workflowId?: string }>()
  const remembered = new Map<string, string>()

  ctx.skills.register(skill)
  ctx.on('agent/created', ({ agent, source }) => {
    if (source === 'clear') remembered.delete(agent.id)
    let workflowId = remembered.get(agent.id)
    if (!workflowId || backend.currentSummary(workflowId) === undefined) {
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
            if (id && backend.currentSummary(id) !== undefined) workflowId = id
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
        const current = state.workflowId && backend.currentSummary(state.workflowId)
        return current ? `当前工作流最新摘要：${JSON.stringify(current)}` : ''
      }
    })
    return undefined
  })

  for (const name of Object.keys(workflowSchemas) as Array<keyof WorkflowToolContracts>) {
    const contract = workflowSchemas[name]
    const definition: ToolDefinition = {
      name: `workflow_${name}`,
      description: `${WORKFLOW_TOOL_DESCRIPTIONS[name]} 返回：${workflowResultGuides[name]} ${backend.toolNotice}`,
      parameters: { ...dshSchema(contract.input) },
      output: { schema: dshSchema(contract.output), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const parsed = contract.input.parse(args)
        const result = contract.output.parse(await backend.execute(name, parsed as never))
        const state = exec.agent && active.get(exec.agent)
        if (state) {
          const id = (result as { workflow?: { id?: string } }).workflow?.id ?? (args as { workflowId?: string }).workflowId
          if (id && backend.currentSummary(id) !== undefined) {
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
