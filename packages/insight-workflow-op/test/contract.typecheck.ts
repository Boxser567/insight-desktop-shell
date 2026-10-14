import type {
  AddEdgeOperation,
  ApplyWorkflowPatchInput,
  ModelSettingSummary,
  NodeChanges,
  ParameterSchema,
  VideoNodeCreateInput,
} from '@insight-ai/insight-workflow-protocol';

const video = {
  type: 'video',
  model: 'video-model',
  modelType: 'text_to_video',
} satisfies VideoNodeCreateInput;

const change = {
  type: 'video',
  duration: 5,
} satisfies NodeChanges;

const patch = {
  workflowId: 'workflow-1',
  operations: [{ op: 'update_node', id: 'node-1', changes: change }],
} satisfies ApplyWorkflowPatchInput;

const summary = {
  model: video.model,
  modelName: 'Video model',
  description: '',
  maxPrompt: 1000,
  nodeType: 'video',
  modelType: video.modelType,
  capabilities: { duration: { type: 'number', label: 'Duration', min: 1, max: 10, step: 1 } },
} satisfies ModelSettingSummary;

// @ts-expect-error A video node cannot use an audio model type.
const invalidVideo: VideoNodeCreateInput = { type: 'video', model: 'audio-model', modelType: 'tts' };
// @ts-expect-error Number parameters must include their range and step.
const invalidParameter: ParameterSchema = { type: 'number', label: 'Duration' };
// @ts-expect-error A model summary must match its node and model types.
const invalidSummary: ModelSettingSummary = { ...summary, modelType: 'tts' };
const invalidEdge: AddEdgeOperation = {
  op: 'add_edge',
  // @ts-expect-error Edge endpoints are node IDs, not reference objects.
  source: { kind: 'existing', nodeId: 'node-1' },
  target: 'node-2',
};
// @ts-expect-error Updates require an operations array.
const invalidPatch: ApplyWorkflowPatchInput = { workflowId: 'workflow-1' };

void [patch, summary, invalidVideo, invalidParameter, invalidSummary, invalidEdge, invalidPatch];
