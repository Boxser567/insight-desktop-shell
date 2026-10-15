import { describe, expect, it } from 'vitest'
import { workflowSchemas, workflowTypes } from '../packages/insight-workflow-protocol/src/index'

describe('platform-independent workflow protocol', () => {
  it('keeps the eleven existing tool contracts and validates representative requests', () => {
    expect(Object.keys(workflowSchemas)).toEqual([
      'get_node_definition', 'search_models', 'get_model_setting',
      'create_workflow', 'list_workflows', 'get_workflow', 'list_nodes', 'get_node',
      'apply_workflow_patch', 'execute_workflow', 'get_workflow_run'
    ])
    const patch = {
      workflowId: 'workflow-1',
      operations: [
        {
          op: 'add_node',
          node: { type: 'video', model: 'video-model', modelType: 'text_to_video', prompt: '五秒视频' }
        },
        {
          op: 'add_edge', source: 'existing-source', target: 'existing-target'
        }
      ]
    }
    expect(workflowSchemas.apply_workflow_patch.input.safeParse(patch).success).toBe(true)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({ ...patch, operations: [
      { op: 'add_edge', source: 'existing-source', target: 'existing-target', sourceHandle: 'output' }
    ] }).success).toBe(false)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({ ...patch, dryRun: true }).success).toBe(false)
    const unconfiguredNode = {
      id: 'unconfigured-video', type: 'video', position: { x: 0, y: 0 },
      data: { title: '未配置视频', value: '', taskInfo: { status: 'running' }, params: { prompt: '' } }
    }
    expect(workflowTypes.node.safeParse(unconfiguredNode).success).toBe(true)
    const uploadedNode = {
      ...unconfiguredNode,
      id: 'uploaded-video',
      data: { title: '上传视频', type: 'upload', taskInfo: { status: 'success' }, params: { prompt: '' } }
    }
    expect(workflowTypes.node.safeParse(uploadedNode).success).toBe(true)
    expect(workflowTypes.node.safeParse({
      ...unconfiguredNode, data: { ...unconfiguredNode.data, type: 'other' }
    }).success).toBe(false)
    expect(workflowSchemas.get_workflow.output.safeParse({
      view: 'full', workflow: { id: 'workflow-1', name: '未配置画布', nodes: [unconfiguredNode], edges: [] }
    }).success).toBe(true)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({
      ...patch, operations: [{ ...patch.operations[0], node: { type: 'video', model: 'video-model' } }]
    }).success).toBe(false)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({
      ...patch, operations: [{ ...patch.operations[0], id: 'caller-generated' }]
    }).success).toBe(false)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({
      ...patch, operations: [{ op: 'update_node', id: 'video-1',
        changes: { type: 'video', additionalParameters: { set: { seed: 7 } } } }]
    }).success).toBe(false)
    expect(workflowSchemas.apply_workflow_patch.output.safeParse({
      applied: true, valid: true, createdNodes: [{ id: 'video-1' }], createdEdges: [{ id: 'edge-1' }], errors: [], warnings: []
    }).success).toBe(true)
    const audioPatch = {
      workflowId: 'workflow-1',
      operations: [
        {
          op: 'add_node',
          node: {
            type: 'audio', model: 'audio-model', modelType: 'text_to_audio',
            seniorParams: { vocalGender: 'female' }
          }
        }
      ]
    }
    expect(workflowSchemas.apply_workflow_patch.input.safeParse(audioPatch).success).toBe(true)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({
      ...audioPatch, operations: [{ ...audioPatch.operations[0], node: {
        type: 'audio', model: 'audio-model', modelType: 'text_to_audio', seniorParams: { vocalGender: 1 }
      } }]
    }).success).toBe(false)
    expect(workflowSchemas.get_node.input.safeParse({ workflowId: 'workflow-1', id: 'video-1' }).success).toBe(true)
    expect(workflowSchemas.get_node.input.safeParse({ workflowId: 'workflow-1', nodeId: 'video-1' }).success).toBe(false)
    const execution = {
      workflowId: 'workflow-1', runningNodeIds: ['unconfigured-video'],
      workflowData: { nodes: [unconfiguredNode, uploadedNode], edges: [] }
    }
    expect(workflowSchemas.execute_workflow.input.safeParse(execution).success).toBe(true)
    expect(workflowSchemas.execute_workflow.input.safeParse({ ...execution, idempotencyKey: 'old-key' }).success).toBe(false)
    expect(workflowSchemas.execute_workflow.output.safeParse({ workflowId: 'workflow-1', taskId: 'task-1' }).success).toBe(true)
    expect(workflowSchemas.get_workflow_run.input.safeParse({ workflowId: 'workflow-1', taskId: 'task-1' }).success).toBe(true)
    expect(workflowSchemas.get_workflow_run.output.safeParse({ workflowId: 'workflow-1', status: 'running' }).success).toBe(true)
    expect(workflowSchemas.get_workflow_run.output.safeParse({ workflowId: 'workflow-1', status: 'success' }).success).toBe(true)
    expect(workflowSchemas.get_workflow_run.output.safeParse({ workflowId: 'workflow-1', status: 'failed' }).success).toBe(true)
  })
})
