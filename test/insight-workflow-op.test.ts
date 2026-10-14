import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { WorkflowBackend } from '../packages/insight-workflow-protocol/src/workflow-backend'
import type { CanvasApi } from '../packages/insight-workflow-op/src/canvas-api'
import { MockWorkflowBackend } from '../packages/insight-workflow-op/src/mock-workflows'
import { RemoteWorkflowBackend } from '../packages/insight-workflow-op/src/remote-workflow'

await import(new URL('../scripts/build-workflow-op.mjs', import.meta.url).href)
const { apply } = await import(new URL('../packages/insight-workflow-op/lib/index.js', import.meta.url).href)

function harness(history: Array<string | { content: unknown[] }> = [], backend: WorkflowBackend = new MockWorkflowBackend()) {
  const tools = new Map<string, { description: string; parameters: Record<string, unknown>; output: { schema: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const events = new Map<string, Function>()
  let skillDescription = ''
  let skillContent = ''
  let context = () => ''
  let agent: { id: string; session: { deriveMessages: () => unknown[] }; ctx: { systemPrompt: { context: (contribution: { text: () => string }) => void } } }
  apply({
    skills: { register: (skill: unknown) => {
      expect(skill).toMatchObject({ name: 'insight-workflow', invocation: { modelInvocable: true, userInvocable: false } })
      skillDescription = (skill as { description: string }).description
      skillContent = (skill as { content: string }).content
    } },
    tools: { register: (tool: { name: string; description: string; parameters: Record<string, unknown>; output: { schema: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => { tools.set(tool.name, tool) } },
    on: (name: string, listener: Function) => { events.set(name, listener) }
  } as never, backend)
  const open = (messages: Array<string | { content: unknown[] }>, source = 'resume', id = 'session-1') => {
    agent = {
      id,
      session: { deriveMessages: () => messages.map(message => typeof message === 'string'
        ? { content: [{ type: 'text', text: message }] } : message) },
      ctx: { systemPrompt: { context: (contribution: { text: () => string }) => { context = contribution.text } } }
    }
    events.get('agent/created')?.({ agent, source })
  }
  open(history)
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(`workflow_${name}`)
    if (!tool) throw new Error(`missing ${name}`)
    return tool.execute(args, { agent })
  }
  const ask = async (text: string) => {
    events.get('agent/inbox/inserted')?.({ agent, message: { content: [{ type: 'text', text }] } })
  }
  return { tools, call, ask, open, context: () => context(), skillDescription, skillContent }
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

  it('offers its skill on demand and handles a five-second video request with mock tools', async () => {
    const h = harness()
    expect(h.tools.size).toBe(11)
    expect(h.context()).toBe('')
    expect(h.skillDescription).toContain('当前仅提供 mock')
    expect(h.tools.get('workflow_execute_workflow')?.description).toContain('当前返回 mock 数据')
    expect(h.skillContent).toContain('filters.all')
    expect(h.skillContent).toContain('data.params.seniorParams')
    expect(h.skillContent).toContain('reference_image_to_image')
    expect(h.skillContent).toContain('当前工具不能导入')
    await h.ask('帮我生成一段5秒钟的视频')
    expect(h.context()).toBe('')
    expect(await h.call('get_node_definition', { nodeType: 'video' })).toMatchObject({ nodeDefinitions: [{ nodeType: 'video', description: '视频', supportedModelTypes: ['text_to_video'] }] })
    const videoQuery = { filters: { all: [{ field: 'nodeType', operator: 'eq', value: 'video' }, { field: 'modelType', operator: 'eq', value: 'text_to_video' }] } }
    expect(await h.call('search_models', { query: videoQuery })).toMatchObject({ models: [{ model: 'mock-video-5s' }] })
    expect(await h.call('search_models', { query: { filters: { all: [...videoQuery.filters.all, { field: 'parameters.duration', operator: 'supports', value: 5 }] } } })).toMatchObject({ models: [{ model: 'mock-video-5s' }] })
    await expect(h.call('search_models', { query: { filters: { all: [{ field: 'nodeType', operator: 'eq', value: 'video' }] } } })).rejects.toThrow()
    expect(await h.call('get_model_setting', { query: videoQuery })).toMatchObject({ model: { model: 'mock-video-5s', defaultParameters: { duration: 5 } } })
    expect(await h.call('get_model_setting', { query: { filters: { all: [{ field: 'nodeType', operator: 'eq', value: 'text' }] } } })).toMatchObject({ model: { model: 'mock-text' } })
    const created = await h.call('create_workflow', { name: '5秒视频' }) as { workflow: { id: string } }
    expect(await h.call('list_workflows', { query: { filters: { all: [{ field: 'name', operator: 'eq', value: '5秒视频' }] } } })).toMatchObject({ workflows: [{ id: created.workflow.id }] })
    const patchInput = {
      workflowId: created.workflow.id,
      operations: [{ op: 'add_node', node: { type: 'video', model: 'mock-video-5s', modelType: 'text_to_video', prompt: '一段5秒钟的视频' } }]
    }
    const patched = await h.call('apply_workflow_patch', patchInput) as { applied: boolean; createdNodes: Array<{ id: string }> }
    expect(patched.applied).toBe(true)
    expect(patched.createdNodes).toHaveLength(1)
    expect(await h.call('get_workflow', { workflowId: created.workflow.id, view: 'structure' })).toMatchObject({ view: 'structure', nodes: [{ id: patched.createdNodes[0]?.id }] })
    expect(await h.call('get_workflow', { workflowId: created.workflow.id, view: 'full' })).toMatchObject({ view: 'full', workflow: { nodes: [{ data: { params: { duration: 5 } } }] } })
    expect(await h.call('list_nodes', { workflowId: created.workflow.id })).toMatchObject({ view: 'summary', nodes: [{ type: 'video' }] })
    expect(await h.call('list_nodes', { workflowId: created.workflow.id, view: 'full' })).toMatchObject({ view: 'full', nodes: [{ type: 'video' }] })
    expect(await h.call('list_nodes', { workflowId: created.workflow.id, query: { filters: { all: [{ field: 'data.params.modelType', operator: 'eq', value: 'text_to_video' }] } } })).toMatchObject({ nodes: [{ type: 'video' }] })
    expect(await h.call('get_node', { workflowId: created.workflow.id, id: patched.createdNodes[0]!.id })).toMatchObject({ node: { type: 'video' } })
    const executeInput = { workflowId: created.workflow.id, idempotencyKey: 'run-video' }
    const run = await h.call('execute_workflow', executeInput) as { runId: string; mock: boolean }
    expect(run.mock).toBe(true)
    expect(await h.call('execute_workflow', executeInput)).toEqual(run)
    expect(await h.call('get_workflow_run', { runId: run.runId })).toMatchObject({ run: { status: 'running', mock: true } })
    expect(h.context()).toContain('"nodeCount":1')
    h.open([JSON.stringify({ workflowId: created.workflow.id })])
    expect(h.context()).toContain('"nodeCount":1')
  })

  it('batches node discovery, model discovery and three node additions', async () => {
    const h = harness()
    expect(h.skillContent).toContain('operator:"in"')
    const allTypes = ['text', 'image', 'audio', 'video', 'poseTool', 'highDefinitionTool']
    expect(await h.call('get_node_definition', { nodeType: allTypes })).toMatchObject({
      nodeDefinitions: allTypes.map(nodeType => ({ nodeType }))
    })
    expect(await h.call('get_node_definition', { nodeType: ['image', 'text'] })).toMatchObject({
      nodeDefinitions: [{ nodeType: 'image' }, { nodeType: 'text' }]
    })
    const query = { filters: { all: [{ field: 'nodeType', operator: 'in', value: ['image', 'text'] }] } }
    expect(await h.call('search_models', { query })).toMatchObject({
      models: [{ model: 'mock-text' }, { model: 'mock-image' }]
    })
    await expect(h.call('search_models', { query: { filters: { all: [{ field: 'nodeType', operator: 'in', value: ['poseTool', 'image'] }] } } })).rejects.toThrow()
    const created = await h.call('create_workflow', { name: '图文工作流' }) as { workflow: { id: string } }
    const patched = await h.call('apply_workflow_patch', {
      workflowId: created.workflow.id,
      operations: [
        { op: 'add_node', node: { type: 'image', model: 'mock-image', modelType: 'text_to_image', prompt: '一张海报' } },
        { op: 'add_node', node: { type: 'text', model: 'mock-text', prompt: '标题' } },
        { op: 'add_node', node: { type: 'text', model: 'mock-text', prompt: '正文' } }
      ]
    }) as { applied: boolean; createdNodes: Array<{ id: string }> }
    expect(patched.applied).toBe(true)
    expect(patched.createdNodes).toHaveLength(3)
    expect(new Set(patched.createdNodes.map(node => node.id)).size).toBe(3)
    expect(await h.call('get_workflow', { workflowId: created.workflow.id })).toMatchObject({ workflow: { nodeCount: 3 } })
    const linked = await h.call('apply_workflow_patch', { workflowId: created.workflow.id, operations: [
      { op: 'add_edge', source: patched.createdNodes[0]!.id, target: patched.createdNodes[1]!.id }
    ] })
    expect(linked).toMatchObject({ applied: true, createdEdges: [{ id: expect.any(String) }] })
  })

  it('reloads workflow context and rejects invalid patches without mutation', async () => {
    const h = harness()
    const created = await h.call('create_workflow', {}) as { workflow: { id: string } }
    await expect(h.call('apply_workflow_patch', { workflowId: created.workflow.id, operations: [{ op: 'add_node', node: { type: 'video', model: 'wrong' } }] })).rejects.toThrow()
    const invalid = await h.call('apply_workflow_patch', { workflowId: created.workflow.id, operations: [{ op: 'add_node', node: { type: 'video', model: 'wrong', modelType: 'text_to_video' } }] })
    expect(invalid).toMatchObject({ applied: false, errors: [{ code: 'INVALID_PATCH' }] })
    expect(await h.call('get_workflow', { workflowId: created.workflow.id })).toMatchObject({ workflow: { nodeCount: 0 } })
    h.open([`继续工作流 ID: ${created.workflow.id}`])
    expect(h.context()).toContain('当前工作流摘要')
  })

  it('restores only verified workflow tool history and retains it across compaction', async () => {
    const h = harness()
    const first = await h.call('create_workflow', { name: 'first' }) as { workflow: { id: string } }
    const second = await h.call('create_workflow', { name: 'second' }) as { workflow: { id: string } }
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
