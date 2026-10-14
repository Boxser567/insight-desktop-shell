import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { WorkflowBackend } from '../packages/insight-workflow-protocol/src/workflow-backend'
import type { CanvasApi } from '../packages/insight-workflow-op/src/canvas-api'
import { RemoteWorkflowBackend } from '../packages/insight-workflow-op/src/remote-workflow'

await import(new URL('../scripts/build-workflow-op.mjs', import.meta.url).href)
const { apply } = await import(new URL('../packages/insight-workflow-op/lib/index.js', import.meta.url).href)

function harness(history: Array<string | { content: unknown[] }> = [], backend: WorkflowBackend = new RemoteWorkflowBackend({ dispose: () => {} } as CanvasApi)) {
  const tools = new Map<string, { description: string; parameters: Record<string, unknown>; output: { schema: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const events = new Map<string, Function>()
  let context = () => ''
  apply({
    skills: { register: (skill: unknown) => {
      expect(skill).toMatchObject({ name: 'insight-workflow', invocation: { modelInvocable: true, userInvocable: false } })
    } },
    tools: { register: (tool: { name: string; description: string; parameters: Record<string, unknown>; output: { schema: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => { tools.set(tool.name, tool) } },
    on: (name: string, listener: Function) => { events.set(name, listener) }
  } as never, backend)
  const open = (messages: Array<string | { content: unknown[] }>, source = 'resume', id = 'session-1') => {
    const agent = {
      id,
      session: { deriveMessages: () => messages.map(message => typeof message === 'string'
        ? { content: [{ type: 'text', text: message }] } : message) },
      ctx: { systemPrompt: { context: (contribution: { text: () => string }) => { context = contribution.text } } }
    }
    events.get('agent/created')?.({ agent, source })
  }
  open(history)
  return { tools, open, context: () => context() }
}

describe('built-in workflow plugin', () => {
  it('uses the remote backend by default and disposes its canvas client', () => {
    const before = process.listenerCount('message')
    const dispose: Array<() => void> = []
    let description = ''
    apply({
      skills: { register: (skill: { description: string }) => { description = skill.description } },
      tools: { register: () => {} },
      on: () => {},
      effect: (install: () => () => void) => { dispose.push(install()) }
    } as never)
    expect(description).toContain('远端画布')
    expect(process.listenerCount('message')).toBe(before + 1)
    dispose.forEach(cleanup => cleanup())
    expect(process.listenerCount('message')).toBe(before)
  })

  it('declares a loadable Harness bundle', async () => {
    const root = new URL('../packages/insight-workflow-op/', import.meta.url)
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(parse(await readFile(new URL(manifest.dsh.bundle.patch, root), 'utf8'))).toEqual([
      { insert: [{ id: 'insight-workflow-op', name: manifest.name }] }
    ])
  })

  it('describes every method, nested operation, parameter and result in dsh schemas', async () => {
    const h = harness()
    expect(h.tools.size).toBe(11)
    const runtimeUrl = new URL('../build/core-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js', import.meta.url).href
    const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(runtimeUrl)
    const undocumented: string[] = []
    const inspect = (schema: any, path: string) => {
      for (const [key, child] of Object.entries(schema.properties ?? {}) as Array<[string, any]>) {
        if (!child.description) undocumented.push(`${path}.${key}`)
        inspect(child, `${path}.${key}`)
      }
      if (schema.items) inspect(schema.items, `${path}[]`)
      for (const [index, variant] of (schema.oneOf ?? []).entries()) inspect(variant, `${path}|${index}`)
    }
    for (const [name, tool] of h.tools) {
      expect(tool.description).toContain('返回：')
      expect(tool.parameters.description).toEqual(expect.any(String))
      expect(tool.output.schema.description).toEqual(expect.any(String))
      expect(() => assertSupportedJsonSchema(tool.parameters)).not.toThrow()
      expect(() => assertSupportedJsonSchema(tool.output.schema)).not.toThrow()
      inspect(tool.parameters, `${name}.input`)
      inspect(tool.output.schema, `${name}.output`)
    }
    expect(undocumented).toEqual([])
    const modelSetting = h.tools.get('workflow_get_model_setting')!.output.schema as any
    expect(modelSetting.properties.model.oneOf[0].properties.parameters.description).toContain('choices:[{value,label}]')
    const modelSearch = h.tools.get('workflow_search_models')!.parameters as any
    expect(modelSearch.required).toContain('query')
    expect(modelSearch.properties.query.properties.filters.properties.all.items.oneOf).toHaveLength(4)
    const definitions = h.tools.get('workflow_get_node_definition')!
    expect((definitions.parameters.properties as Record<string, any>).nodeType.oneOf).toHaveLength(2)
    expect((definitions.output.schema.properties as Record<string, any>).nodeDefinitions.type).toBe('array')
    const patch = h.tools.get('workflow_apply_workflow_patch')!
    const properties = patch.parameters.properties as Record<string, any>
    expect(properties.workflowId.description).toContain('工作流 ID')
    expect(properties).not.toHaveProperty('expectedRevision')
    const operations = properties.operations.items.oneOf as Array<Record<string, any>>
    expect(operations).toHaveLength(6)
    const addNode = operations.find(operation => operation.properties.op.const === 'add_node')!
    expect(addNode.required).toEqual(['op', 'node'])
    const video = addNode.properties.node.oneOf.find((variant: any) => variant.properties.type.const === 'video')
    expect(video.required).toContain('modelType')
    expect(video.properties.duration.description).toContain('秒')
    expect((patch.output.schema.properties as Record<string, any>).createdNodes.items.properties.id.description).toContain('ID')
    expect(validateJsonSchemaValue(patch.parameters, { workflowId: 'w', operations: [{ op: 'add_node', node: { type: 'video', model: 'm' } }] })).not.toEqual([])
  })

  it('restores only verified workflow tool history and retains it across compaction', async () => {
    const h = harness()
    const first = { workflow: { id: 'first', name: 'first', nodeCount: 0, edgeCount: 0 } }
    const second = { workflow: { id: 'second', name: 'second', nodeCount: 0, edgeCount: 0 } }
    h.open([`工作流 ID: ${second.workflow.id}`], 'resume', 'other-session')
    expect(h.context()).toBe('')

    const created = [
      { content: [{ type: 'tool-call', id: 'create', name: 'workflow_create_workflow', arguments: '{}' }] },
      { content: [{ type: 'tool-result', toolCallId: 'create', content: [{ type: 'text', text: JSON.stringify(first) }] }] }
    ]
    const failedSwitch = [
      { content: [{ type: 'tool-call', id: 'switch', name: 'workflow_get_workflow', arguments: JSON.stringify({ workflowId: second.workflow.id }) }] },
      { content: [{ type: 'tool-result', toolCallId: 'switch', isError: true, content: [{ type: 'text', text: 'failed' }] }] }
    ]
    h.open([...created, ...failedSwitch], 'resume', 'other-session')
    expect(h.context()).toContain(first.workflow.id)
    expect(h.context()).not.toContain(second.workflow.id)

    h.open([], 'compact', 'other-session')
    expect(h.context()).toContain(first.workflow.id)
    h.open([`工作流 ID: ${second.workflow.id}`], 'clear', 'other-session')
    expect(h.context()).toBe('')
  })

  it('restores a verified workflow summary with a fresh remote backend', () => {
    const workflow = { id: '42', name: '已保存画布', nodeCount: 2, edgeCount: 1 }
    const history = [
      { content: [{ type: 'tool-call', id: 'create', name: 'workflow_create_workflow', arguments: '{}' }] },
      { content: [{ type: 'tool-result', toolCallId: 'create', content: [{ type: 'text', text: JSON.stringify({ workflow }) }] }] }
    ]
    const backend = new RemoteWorkflowBackend({ dispose: () => {} } as CanvasApi)
    const h = harness(history, backend)
    expect(h.context()).toContain('"id":"42"')
    expect(h.context()).toContain('"nodeCount":2')
    h.open([], 'compact')
    expect(h.context()).toContain('"id":"42"')
  })

  it('recovers the workflow ID when only a successful patch remains in history', () => {
    const history = [
      { content: [{ type: 'tool-call', id: 'patch', name: 'workflow_apply_workflow_patch',
        arguments: JSON.stringify({ workflowId: '42', operations: [] }) }] },
      { content: [{ type: 'tool-result', toolCallId: 'patch', content: [{ type: 'text',
        text: JSON.stringify({ applied: true, valid: true, createdNodes: [], createdEdges: [], errors: [], warnings: [] }) }] }] }
    ]
    const h = harness(history, new RemoteWorkflowBackend({ dispose: () => {} } as CanvasApi))
    expect(h.context()).toContain('当前工作流 ID："42"')
    expect(h.context()).toContain('workflow_get_workflow')
  })
})
