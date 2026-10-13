import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { apply } from '../packages/insight-workflow-op/src/index'

function harness(history: Array<string | { content: unknown[] }> = []) {
  const tools = new Map<string, { description: string; parameters: Record<string, unknown>; output: { schema: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const events = new Map<string, Function>()
  let skillContent = ''
  let context = () => ''
  let agent: { id: string; session: { deriveMessages: () => unknown[] }; ctx: { systemPrompt: { context: (contribution: { text: () => string }) => void } } }
  apply({
    skills: { register: (skill: unknown) => {
      expect(skill).toMatchObject({ name: 'insight-workflow', invocation: { modelInvocable: true, userInvocable: false } })
      skillContent = (skill as { content: string }).content
    } },
    tools: { register: (tool: { name: string; description: string; parameters: Record<string, unknown>; output: { schema: Record<string, unknown> }; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => { tools.set(tool.name, tool) } },
    on: (name: string, listener: Function) => { events.set(name, listener) }
  } as never)
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
  return { tools, call, ask, open, context: () => context(), skillContent }
}

describe('built-in workflow plugin', () => {
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
    expect(addNode.required).toEqual(expect.arrayContaining(['clientId', 'node']))
    const video = addNode.properties.node.oneOf.find((variant: any) => variant.properties.type.const === 'video')
    expect(video.required).toContain('modelType')
    expect(video.properties.duration.description).toContain('秒')
    expect((patch.output.schema.properties as Record<string, any>).createdNodes.items.properties.nodeId.description).toContain('ID')
    expect(validateJsonSchemaValue(patch.parameters, { workflowId: 'w', operations: [{ op: 'add_node', clientId: 'n', node: { type: 'video', model: 'm' } }] })).not.toEqual([])
  })

  it('offers its skill on demand and handles a five-second video request with mock tools', async () => {
    const h = harness()
    expect(h.tools.size).toBe(11)
    expect(h.context()).toBe('')
    expect(h.skillContent).toContain('filters.all')
    expect(h.skillContent).toContain('data.params.seniorParams')
    expect(h.skillContent).toContain('reference_image_to_image')
    expect(h.skillContent).toContain('当前 mock 不能导入')
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
      idempotencyKey: 'video-op',
      operations: [{ op: 'add_node', clientId: 'video-1', node: { type: 'video', model: 'mock-video-5s', modelType: 'text_to_video', prompt: '一段5秒钟的视频' } }]
    }
    const patched = await h.call('apply_workflow_patch', patchInput) as { applied: boolean; createdNodes: Array<{ nodeId: string }> }
    expect(patched.applied).toBe(true)
    expect(patched.createdNodes).toHaveLength(1)
    expect(await h.call('get_workflow', { workflowId: created.workflow.id, view: 'structure' })).toMatchObject({ view: 'structure', nodes: [{ id: patched.createdNodes[0]?.nodeId }] })
    expect(await h.call('get_workflow', { workflowId: created.workflow.id, view: 'full' })).toMatchObject({ view: 'full', workflow: { nodes: [{ data: { params: { duration: 5 } } }] } })
    expect(await h.call('list_nodes', { workflowId: created.workflow.id })).toMatchObject({ view: 'summary', nodes: [{ type: 'video' }] })
    expect(await h.call('list_nodes', { workflowId: created.workflow.id, view: 'full' })).toMatchObject({ view: 'full', nodes: [{ type: 'video' }] })
    expect(await h.call('list_nodes', { workflowId: created.workflow.id, query: { filters: { all: [{ field: 'data.params.modelType', operator: 'eq', value: 'text_to_video' }] } } })).toMatchObject({ nodes: [{ type: 'video' }] })
    expect(await h.call('get_node', { workflowId: created.workflow.id, nodeId: patched.createdNodes[0]!.nodeId })).toMatchObject({ node: { type: 'video' } })
    expect(await h.call('apply_workflow_patch', patchInput)).toEqual(patched)
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
        { op: 'add_node', clientId: 'image', node: { type: 'image', model: 'mock-image', modelType: 'text_to_image', prompt: '一张海报' } },
        { op: 'add_node', clientId: 'text-1', node: { type: 'text', model: 'mock-text', prompt: '标题' } },
        { op: 'add_node', clientId: 'text-2', node: { type: 'text', model: 'mock-text', prompt: '正文' } }
      ]
    }) as { applied: boolean; createdNodes: Array<{ clientId: string }> }
    expect(patched.applied).toBe(true)
    expect(patched.createdNodes.map(node => node.clientId)).toEqual(['image', 'text-1', 'text-2'])
    expect(await h.call('get_workflow', { workflowId: created.workflow.id })).toMatchObject({ workflow: { nodeCount: 3 } })
  })

  it('reloads workflow context and rejects invalid patches without mutation', async () => {
    const h = harness()
    const created = await h.call('create_workflow', {}) as { workflow: { id: string } }
    await expect(h.call('apply_workflow_patch', { workflowId: created.workflow.id, operations: [{ op: 'add_node', clientId: 'x', node: { type: 'video', model: 'wrong' } }] })).rejects.toThrow()
    const invalid = await h.call('apply_workflow_patch', { workflowId: created.workflow.id, operations: [{ op: 'add_node', clientId: 'x', node: { type: 'video', model: 'wrong', modelType: 'text_to_video' } }] })
    expect(invalid).toMatchObject({ applied: false, errors: [{ code: 'INVALID_PATCH' }] })
    expect(await h.call('get_workflow', { workflowId: created.workflow.id })).toMatchObject({ workflow: { nodeCount: 0 } })
    h.open([`继续工作流 ID: ${created.workflow.id}`])
    expect(h.context()).toContain('当前工作流最新摘要')
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
})
