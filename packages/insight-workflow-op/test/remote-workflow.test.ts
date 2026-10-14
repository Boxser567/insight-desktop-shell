import { describe, expect, it, vi } from 'vitest'
import type { CanvasApi, CanvasGraph, FlowData } from '../src/canvas-api'
import { RemoteWorkflowBackend } from '../src/remote-workflow'

function canvas() {
  const graph: CanvasGraph = {
    nodes: [
      { id: 'group', type: 'group', position: { x: 0, y: 0 }, data: { title: '分组' } },
      { id: 'video', type: 'video', position: { x: 20, y: 20 }, data: {
        title: '视频', value: '', taskInfo: { status: 'success' },
        params: { model: 'real-video', modelType: 'text_to_video', prompt: '原始提示词' }
      } }
    ],
    edges: [{ id: 'group-edge', source: 'group', target: 'video', sourceHandle: 'output', targetHandle: 'input', animated: true }]
  }
  const flow: FlowData = {
    id: 42, name: '远端工作流', version: 'comfyui', versionNumber: 3, data: graph,
    conversationId: null, taskStatus: 'SUCCESS', favorite: false, temp: false,
    updateTime: '', thumbnailUrl: '', templateId: 0, folderId: 0, canvasType: 0
  }
  const api: CanvasApi = {
    saveFlow: vi.fn(async params => ({ code: 'SUCCESS', data: { id: params.id ?? 43 } })),
    getFlowData: vi.fn(async () => ({ code: 'SUCCESS', data: flow })),
    getFlowsList: vi.fn(async () => ({ code: 'SUCCESS', data: { total: 1, records: [{
      id: 42, name: flow.name, favorite: false, temp: false, updateTime: '', version: 'comfyui',
      thumbnailUrl: '', folderId: 0, canvasType: 0 as const
    }] } })),
    getModelParams: vi.fn(async () => ({ video: { text_to_video: {
      name: '文生视频', models: { 'real-video': {
        model_name: '真实视频模型', description: '视频', maxPrompt: 2000, sort: 1,
        parameters: { duration: { type: 'number' as const, label: '秒', min: 1, max: 10, step: 1, default: 5 } }
      } }
    } } })),
    updateCanvas: vi.fn(async update => {
      graph.nodes.push(...(update.addNodes ?? []).map((value: string) => JSON.parse(value)))
      for (const value of update.updateNodes ?? []) {
        const node = JSON.parse(value)
        const index = graph.nodes.findIndex(item => item.id === node.id)
        graph.nodes[index] = node
      }
      graph.nodes = graph.nodes.filter(node => !(update.deleteNodeIds ?? []).includes(node.id))
      if (update.edges) graph.edges = update.edges
      flow.versionNumber = 4
      return { code: 'SUCCESS', data: { id: 42 } }
    }),
    dispose: vi.fn()
  }
  return { api, flow, graph }
}

describe('remote workflow backend', () => {
  it('reads an unconfigured model node and can select its model later', async () => {
    const { api, graph } = canvas()
    graph.nodes.push({ id: 'unconfigured-video', type: 'video', position: { x: 40, y: 40 },
      data: { title: '未配置视频', params: { model: null, modelType: null, prompt: '待选择模型' } } })
    const backend = new RemoteWorkflowBackend(api)
    expect(await backend.execute('get_workflow', { workflowId: '42', view: 'full' })).toMatchObject({
      view: 'full', workflow: { nodes: [expect.objectContaining({ id: 'video' }),
        expect.objectContaining({ id: 'unconfigured-video', data: expect.objectContaining({ params: { prompt: '待选择模型' } }) })] }
    })
    expect(await backend.execute('list_nodes', { workflowId: '42' })).toMatchObject({
      nodes: [expect.objectContaining({ id: 'video' }), expect.objectContaining({ id: 'unconfigured-video' })]
    })
    expect(api.updateCanvas).not.toHaveBeenCalled()
    expect(await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'update_node', id: 'unconfigured-video',
        changes: { type: 'video', model: 'real-video', modelType: 'text_to_video' } }
    ] })).toMatchObject({ applied: true, valid: true })
    expect(api.updateCanvas).toHaveBeenCalledOnce()
  })

  it('lists canvases even when an existing node cannot be parsed as a full workflow node', async () => {
    const { api, graph } = canvas()
    graph.nodes.push({ id: 'legacy-image', type: 'image', position: { x: 1, y: 2 },
      data: { title: '旧图像节点', params: { model: 'retired-model' } } })
    const backend = new RemoteWorkflowBackend(api)
    expect(await backend.execute('search_models', { query: { filters: { all: [
      { field: 'nodeType', operator: 'eq', value: 'video' },
      { field: 'modelType', operator: 'eq', value: 'text_to_video' }
    ] } } })).toMatchObject({ models: [{ model: 'real-video' }] })
    expect(api.getFlowData).not.toHaveBeenCalled()
    expect(await backend.execute('list_workflows', {})).toEqual({
      workflows: [{ id: '42', name: '远端工作流', nodeCount: 2, edgeCount: 0 }]
    })
    expect(await backend.execute('get_workflow', { workflowId: '42' })).toEqual({
      view: 'summary', workflow: { id: '42', name: '远端工作流', nodeCount: 2, edgeCount: 0 }
    })
  })

  it('uses canvas data and model settings for discovery and reads', async () => {
    const { api } = canvas()
    const backend = new RemoteWorkflowBackend(api)
    expect(await backend.execute('get_node_definition', { nodeType: 'video' })).toEqual({
      nodeDefinitions: [{ nodeType: 'video', description: '视频', supportedModelTypes: ['text_to_video'] }]
    })
    const query = { filters: { all: [
      { field: 'nodeType', operator: 'eq' as const, value: 'video' },
      { field: 'modelType', operator: 'eq' as const, value: 'text_to_video' }
    ] } }
    expect(await backend.execute('search_models', { query })).toMatchObject({ models: [{ model: 'real-video' }] })
    expect(await backend.execute('get_model_setting', { query })).toMatchObject({
      model: { model: 'real-video', defaultParameters: { duration: 5 } }
    })
    expect(await backend.execute('list_workflows', {})).toEqual({
      workflows: [{ id: '42', name: '远端工作流', nodeCount: 1, edgeCount: 0 }]
    })
    expect(await backend.execute('get_workflow', { workflowId: '42', view: 'full' })).toMatchObject({
      workflow: { nodes: [{ id: 'video', data: { taskInfo: { status: 'success' } } }], edges: [] }
    })
    expect(await backend.execute('get_node', { workflowId: '42', id: 'video' })).toMatchObject({ node: { id: 'video' } })
    expect(backend.currentSummary('42')?.nodeCount).toBe(1)
    expect(await backend.execute('create_workflow', { name: '新画布' })).toEqual({
      workflow: { id: '43', name: '新画布', nodeCount: 0, edgeCount: 0 }
    })
    expect(api.saveFlow).toHaveBeenCalledWith({ name: '新画布', version: 'comfyui', canvasType: 0,
      data: '{"nodes":[],"edges":[]}' })
    backend.dispose()
    expect(api.dispose).toHaveBeenCalledOnce()
  })

  it('returns generated IDs for sequential node and edge patches and preserves unsupported graph data', async () => {
    const { api, graph } = canvas()
    const backend = new RemoteWorkflowBackend(api)
    const input = { workflowId: '42', operations: [
      { op: 'add_node' as const, node: {
        type: 'video' as const, model: 'real-video', modelType: 'text_to_video' as const, prompt: '新视频'
      } }
    ] }
    const result = await backend.execute('apply_workflow_patch', input)
    expect(result).toMatchObject({ applied: true, valid: true, createdNodes: [{ id: expect.any(String) }], createdEdges: [] })
    expect(api.updateCanvas).toHaveBeenCalledTimes(1)
    expect(api.updateCanvas).toHaveBeenCalledWith(expect.objectContaining({ id: '42', versionNumber: 3,
      edges: expect.arrayContaining([expect.objectContaining({ id: 'group-edge', animated: true })]) }))
    const added = JSON.parse(vi.mocked(api.updateCanvas).mock.calls[0]![0].addNodes![0]!)
    expect(added.data).toMatchObject({ taskInfo: { status: 'success' } })
    expect(added.data).not.toHaveProperty('value')
    expect(added.data).not.toHaveProperty('type')
    const missingHandles = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'add_edge', source: 'video', target: result.createdNodes[0]!.id }
    ] })
    expect(missingHandles).toMatchObject({ applied: false, valid: false, errors: [{ code: 'INVALID_PATCH' }] })
    expect(api.updateCanvas).toHaveBeenCalledTimes(1)
    const edgeResult = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'add_edge', source: 'video', target: result.createdNodes[0]!.id,
        sourceHandle: 'output', targetHandle: 'input' }
    ] })
    expect(edgeResult).toMatchObject({ applied: true, createdNodes: [], createdEdges: [{ id: expect.any(String) }] })
    expect(api.updateCanvas).toHaveBeenCalledTimes(2)
    expect(api.updateCanvas).toHaveBeenLastCalledWith(expect.objectContaining({ versionNumber: 4 }))
    expect(graph.nodes.some(node => node.id === 'group')).toBe(true)
    expect(graph.edges).toHaveLength(2)
    expect(backend.currentSummary('42')?.nodeCount).toBe(2)
  })

  it('saves a new artifact on data and marks the node as uploaded', async () => {
    const { api } = canvas()
    const backend = new RemoteWorkflowBackend(api)
    const result = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'add_node', node: { type: 'video', model: 'real-video', modelType: 'text_to_video',
        value: 'https://example.com/reference.mp4' } }
    ] })
    expect(result).toMatchObject({ applied: true, valid: true })
    const saved = JSON.parse(vi.mocked(api.updateCanvas).mock.calls[0]![0].addNodes![0]!)
    expect(saved.data).toMatchObject({ type: 'upload', value: 'https://example.com/reference.mp4' })
    expect(saved.data.params).not.toHaveProperty('value')
    expect(await backend.execute('get_node', { workflowId: '42', id: saved.id })).toMatchObject({
      node: { data: { type: 'upload', value: 'https://example.com/reference.mp4' } }
    })
  })

  it('does not write a partially applied patch when a later operation is invalid', async () => {
    const { api, graph } = canvas()
    const backend = new RemoteWorkflowBackend(api)
    const result = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'update_node', id: 'video', changes: { type: 'video', prompt: '不能保存' } },
      { op: 'delete_node', id: 'missing' }
    ] })
    expect(result).toMatchObject({ applied: false, valid: false, createdNodes: [], createdEdges: [], errors: [{ code: 'INVALID_PATCH' }] })
    expect(api.updateCanvas).not.toHaveBeenCalled()
    expect(graph.nodes[1]!.data.params).toMatchObject({ prompt: '原始提示词' })
  })

  it('places multiple new nodes without overlapping when position is omitted', async () => {
    const { api, graph } = canvas()
    graph.nodes[0]!.position.x = 1000 // Group nodes are not part of the protocol projection.
    graph.nodes[0]!.measured = { width: 0, height: 400 }
    const backend = new RemoteWorkflowBackend(api)
    const result = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'add_node', node: { type: 'poseTool' } },
      { op: 'add_node', node: { type: 'highDefinitionTool' } }
    ] })
    expect(result).toMatchObject({ applied: true, valid: true })
    const added = vi.mocked(api.updateCanvas).mock.calls[0]![0].addNodes!.map(value => JSON.parse(value))
    expect(added[0].position.x).toBeGreaterThanOrEqual(1400)
    expect(added[1].position.x).toBeGreaterThanOrEqual(added[0].position.x + 400)
  })

  it('preserves raw task metadata when updating a projected node', async () => {
    const { api, graph } = canvas()
    graph.nodes[1]!.data.taskInfo = { status: 'PENDING', taskId: 'task-7', artifact: { id: 'asset-2' } }
    const backend = new RemoteWorkflowBackend(api)
    const result = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'update_node', id: 'video', changes: { type: 'video', prompt: '修改后的提示词' } }
    ] })
    expect(result.applied).toBe(true)
    const update = vi.mocked(api.updateCanvas).mock.calls[0]![0]
    const saved = JSON.parse(update.updateNodes![0]!)
    expect(saved.data.params.prompt).toBe('修改后的提示词')
    expect(saved.data.taskInfo).toEqual({ status: 'PENDING', taskId: 'task-7', artifact: { id: 'asset-2' } })
  })

  it('requires explicit remote handles and preserves existing edges exactly', async () => {
    const { api, graph } = canvas()
    graph.nodes.push({ id: 'image', type: 'image', position: { x: 10, y: 10 },
      data: { title: '图片', params: { model: 'legacy-image', modelType: 'text_to_image', prompt: '' } } })
    graph.edges.push({ id: 'image-edge', source: 'image', target: 'group', sourceHandle: 'image_source' })
    const backend = new RemoteWorkflowBackend(api)
    const missing = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'add_edge', source: 'image', target: 'video' }
    ] })
    expect(missing).toMatchObject({ applied: false, valid: false, errors: [{ code: 'INVALID_PATCH' }] })
    expect(api.updateCanvas).not.toHaveBeenCalled()
    const result = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'add_edge', source: 'image', target: 'video', sourceHandle: 'image_source', targetHandle: 'input' }
    ] })
    expect(result.applied).toBe(true)
    const update = vi.mocked(api.updateCanvas).mock.calls[0]![0]
    expect(update.edges).toContainEqual({ id: 'image-edge', source: 'image', target: 'group', sourceHandle: 'image_source' })
    expect(update.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'image', target: 'video', sourceHandle: 'image_source', targetHandle: 'input' })
    ]))
  })

  it('rejects mixed rename and graph writes and does not claim to execute media', async () => {
    const { api } = canvas()
    const backend = new RemoteWorkflowBackend(api)
    const result = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'rename_workflow', name: '新名称' },
      { op: 'delete_node', id: 'video' }
    ] })
    expect(result).toMatchObject({ applied: false, valid: false, errors: [{ code: 'UNSUPPORTED_PATCH' }] })
    expect(api.saveFlow).not.toHaveBeenCalled()
    expect(api.updateCanvas).not.toHaveBeenCalled()
    const invalid = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'update_node', id: 'video', changes: { type: 'video', modelType: 'image_to_video' } }
    ] })
    expect(invalid).toMatchObject({ applied: false, valid: false, errors: [{ code: 'MODEL_NOT_FOUND' }] })
    await expect(backend.execute('execute_workflow', {
      workflowId: '42', runningNodeIds: ['video'], workflowData: {
        nodes: [{ id: 'video', type: 'video', position: { x: 20, y: 20 }, data: {
          title: '视频', taskInfo: { status: 'success' },
          params: { model: 'real-video', modelType: 'text_to_video', prompt: '原始提示词' }
        } }],
        edges: []
      }
    })).rejects.toThrow('暂不支持')
    await expect(backend.execute('get_workflow_run', { workflowId: '42', taskId: 'task-1' })).rejects.toThrow('暂不支持')
  })

  it('projects uploaded media nodes without inventing an artifact value', async () => {
    const { api, graph } = canvas()
    graph.nodes.push({
      id: 'a1c33110-f357-4efe-bbe0-e10c4f33e17a',
      position: { x: 1473.44, y: -1009.93 },
      measured: { width: 400, height: 400 },
      type: 'image',
      data: {
        title: '用户产品上传',
        type: 'upload',
        taskInfo: {},
        params: { model: 'real-image', modelType: 'text_to_image', prompt: '产品图片' }
      }
    })
    const backend = new RemoteWorkflowBackend(api)
    const result = await backend.execute('get_workflow', { workflowId: '42', view: 'full' })
    expect(result).toMatchObject({
      view: 'full',
      workflow: {
        nodes: [
          expect.objectContaining({ id: 'video' }),
          expect.objectContaining({
            id: 'a1c33110-f357-4efe-bbe0-e10c4f33e17a',
            data: { title: '用户产品上传', type: 'upload', taskInfo: { status: 'success' },
              params: { model: 'real-image', modelType: 'text_to_image', prompt: '产品图片' } }
          })
        ]
      }
    })
    expect(await backend.execute('list_nodes', { workflowId: '42' })).toMatchObject({
      nodes: [expect.objectContaining({ id: 'video' }),
        expect.objectContaining({ id: 'a1c33110-f357-4efe-bbe0-e10c4f33e17a', status: 'success' })]
    })
    const patched = await backend.execute('apply_workflow_patch', { workflowId: '42', operations: [
      { op: 'update_node', id: 'a1c33110-f357-4efe-bbe0-e10c4f33e17a',
        changes: { type: 'image', title: '更新后的上传资源', value: 'https://example.com/reference.png' } }
    ] })
    expect(patched.errors).toEqual([])
    expect(patched).toMatchObject({ applied: true, valid: true })
    const saved = JSON.parse(vi.mocked(api.updateCanvas).mock.calls[0]![0].updateNodes![0]!)
    expect(saved.data).toMatchObject({ title: '更新后的上传资源', type: 'upload',
      value: 'https://example.com/reference.png' })
    expect(saved.data.params).not.toHaveProperty('value')
  })
})
