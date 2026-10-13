import { describe, expect, it } from 'vitest'
import { workflowSchemas } from '../packages/insight-workflow-protocol/src/index'

describe('platform-independent workflow protocol', () => {
  it('keeps the eleven existing tool contracts and validates representative requests', () => {
    expect(Object.keys(workflowSchemas)).toEqual([
      'get_node_definition', 'search_models', 'get_model_setting',
      'create_workflow', 'list_workflows', 'get_workflow', 'list_nodes', 'get_node',
      'apply_workflow_patch', 'execute_workflow', 'get_workflow_run'
    ])
    const patch = {
      workflowId: 'workflow-1',
      idempotencyKey: 'request-1',
      operations: [{
        op: 'add_node', clientId: 'video-1',
        node: { type: 'video', model: 'video-model', modelType: 'text_to_video', prompt: '五秒视频' }
      }]
    }
    expect(workflowSchemas.apply_workflow_patch.input.safeParse(patch).success).toBe(true)
    expect(workflowSchemas.apply_workflow_patch.input.safeParse({
      ...patch, operations: [{ ...patch.operations[0], node: { type: 'video', model: 'video-model' } }]
    }).success).toBe(false)
    expect(workflowSchemas.execute_workflow.output.safeParse({
      runId: 'run-1', workflowId: 'workflow-1', status: 'running', mock: true
    }).success).toBe(true)
  })
})
