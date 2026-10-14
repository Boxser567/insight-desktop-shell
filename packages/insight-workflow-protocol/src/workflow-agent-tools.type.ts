/** 工作流操作协议的类型源文件；维护规范见 ../README.md。 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. 基础领域类型
// ─────────────────────────────────────────────────────────────────────────────
/** 支持的节点类型 */
export type NodeType =
  | BasicNodeType
  | ToolNodeType;
/** 基础节点 */
export type BasicNodeType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video';
/** 工具节点 */
export type ToolNodeType =
  | 'poseTool'
  | 'highDefinitionTool';
export type ImageModelType = 'text_to_image' | 'reference_image_to_image';
export type VideoModelType =
  | 'first_last_frame_to_video'
  | 'image_to_video'
  | 'reference_image_to_video'
  | 'text_to_video';
export type AudioModelType = 'tts' | 'text_to_audio' | 'audio_to_audio';
export type ModelType = ImageModelType | VideoModelType | AudioModelType;
/** 可序列化的 JSON 值；工具入参和出参中避免使用 `any` 或 `unknown`。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 持久化与查询数据模型（不直接用作 Agent 创建参数）
// ─────────────────────────────────────────────────────────────────────────────
/** 节点新建时为 success；开始生成后进入 running。 */
export type ExecutionStatus = 'running' | 'success' | 'failed';
export interface NodeTaskInfo {
  status: ExecutionStatus;
  errorMsg?: string;
}

export interface NodeDataBase {
  title: string;
  /** 生成物或预览图的 URL；尚无资源时可省略。 */
  value?: string | string[];
  taskInfo: NodeTaskInfo;
}
/** 模型节点的通用已保存参数；画布中尚未选模型的节点可缺少 model。 */
export interface BasicNodeParams {
  model?: string;
  prompt: string;
}

/** 文本节点沿用通用的 model/prompt，并增加资源搜索开关。 */
export interface TextNodeParams extends BasicNodeParams {
  search_resource: boolean;
}

export interface ImageNodeParams extends BasicNodeParams {
  modelType?: ImageModelType;
  aspect_ratio?: string;
  gen_count?: number;
  quality?: string;
  resolution?: string;
}

/** 视频节点参数 */
export interface VideoNodeParams extends BasicNodeParams {
  modelType?: VideoModelType;
  aspect_ratio?: string;
  duration?: number;
  enableAudio?: boolean;
  gen_count?: number;
  resolution?: string;
}

/** 音频节点参数 */
export interface AudioNodeParams extends BasicNodeParams {
  modelType?: AudioModelType;
  gen_count?: number;
  seniorParams?: {
    customMode?: boolean;
    instrumental?: boolean;
    styleWeight?: number;
    vocalGender?: string;
    weirdnessConstraint?: number;
  };
}

export interface NodeBase {
  id: string;
  position: Position;
  /** 由画布渲染层维护的测量尺寸，默认 400 × 400。 */
  measured?: Size;
}

/** 标记用户上传的资源节点；适用于图像、视频和音频节点。 */
export type NonGenerationNode = { type?: 'upload' };

export interface TextNode extends NodeBase {
  type: 'text';
  data: NodeDataBase & { params: TextNodeParams };
}

export interface ImageNode extends NodeBase {
  type: 'image';
  data: NodeDataBase & NonGenerationNode & { params: ImageNodeParams };
}

export interface VideoNode extends NodeBase {
  type: 'video';
  data: NodeDataBase & NonGenerationNode & { params: VideoNodeParams };
}

export interface AudioNode extends NodeBase {
  type: 'audio';
  data: NodeDataBase & NonGenerationNode & { params: AudioNodeParams };
}

export interface PoseToolNode extends NodeBase {
  type: 'poseTool';
  data: NodeDataBase & { params?: JsonObject };
}

export interface HighDefinitionToolNode extends NodeBase {
  type: 'highDefinitionTool';
  data: NodeDataBase & { params?: JsonObject };
}
/** 节点判别联合类型；根据 `type` 识别对应的数据结构。 */
export type Node =
  | TextNode
  | ImageNode
  | VideoNode
  | AudioNode
  | PoseToolNode
  | HighDefinitionToolNode;
export interface Edge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
}

export interface NodeSummary {
  id: string;
  type: NodeType;
  title: string;
  position: Position;
  /** 可使用模型的基础节点可能具有 model（text 也定义了该字段）。 */
  model?: string;
  /** 仅图像、视频、音频节点定义了 modelType；具体取值需与节点类型匹配。 */
  modelType?: ModelType;
  status: ExecutionStatus;
}
// ─────────────────────────────────────────────────────────────────────────────
// 3. 节点能力发现与模型配置
// ─────────────────────────────────────────────────────────────────────────────
/** 参数控件元数据；服务端仍须校验模型特有的条件规则。 */
interface ParameterSchemaBase {
  label: string;
}

export interface ChoicesParameterSchema extends ParameterSchemaBase {
  type: 'choices';
  choices: Array<{ value: string; label: string }>;
  default?: string;
}

export interface NumberParameterSchema extends ParameterSchemaBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default?: number;
}

export interface SwitchParameterSchema extends ParameterSchemaBase {
  type: 'switch';
  default?: boolean;
}
export type ParameterSchema =
  | ChoicesParameterSchema
  | NumberParameterSchema
  | SwitchParameterSchema;
/** 摘要保留取值约束，只省略选项的展示标签。 */
export interface ChoicesParameterSchemaSummary extends ParameterSchemaBase {
  type: 'choices';
  choices: string[];
  default?: string;
}

export type NumberParameterSchemaSummary = NumberParameterSchema;
export type SwitchParameterSchemaSummary = SwitchParameterSchema;
export type ParameterSchemaSummary =
  | ChoicesParameterSchemaSummary
  | NumberParameterSchemaSummary
  | SwitchParameterSchemaSummary;
export interface NodeDefinition {
  nodeType: NodeType;
  description: string;
  /** 使用模型的基础节点可提供支持的模型类型；工具节点可省略。 */
  supportedModelTypes?: ModelType[];
}

interface ModelSettingBase {
  model: string;
  modelName: string;
  description: string;
  maxPrompt: number;
}
export type BaseModelSetting = ModelSettingBase & (
  | { nodeType: 'text'; modelType?: never }
  | { nodeType: 'image'; modelType: ImageModelType }
  | { nodeType: 'video'; modelType: VideoModelType }
  | { nodeType: 'audio'; modelType: AudioModelType }
);
/** 模型基本信息、参数控件和默认值。 */
export type ModelSetting = BaseModelSetting & {
  /**
   * 普通参数名到控件定义的映射；键对应 Node.data.params 中的字段。
   */
  parameters: Record<string, ParameterSchema>;
  /**
   * 高级参数名到控件定义的映射；键对应 Node.data.params.seniorParams 中的字段。
   */
  senoirParameters?: Record<string, ParameterSchema>;
  /**
   * 一组合法默认值；键对应 data.params 或 data.params.seniorParams 中的字段。
   */
  defaultParameters: JsonObject;
};

/** 模型简要信息；capabilities 保留参数的取值约束。 */
export type ModelSettingSummary = BaseModelSetting & {
  capabilities: Record<string, ParameterSchemaSummary>;
};
/** 一次查询一种或多种节点的概览及支持的模型方式。 */
export interface GetNodeDefinitionInput {
  /** 单个节点类型或需要批量查询的节点类型列表。 */
  nodeType: NodeType | NodeType[];
}

export interface GetNodeDefinitionOutput {
  /** 按请求顺序返回节点概览；单个类型也返回数组。 */
  nodeDefinitions: NodeDefinition[];
}

/** 搜索条件支持的基础值类型 */
export type QueryValue = string | number | boolean;

/**
 * 通用搜索过滤条件。
 *
 * - field: 对象访问语法，如 'a.b.c'
 *
 * 不同操作符对应不同的值类型：
 * - eq / ne：相等、不相等
 * - gt / gte / lt / lte：数值比较
 * - in / not_in：集合包含、不包含
 * - exists / not_exists：字段是否存在
 * - supports：目标是否支持指定值，由业务层定义支持规则
 */
export type QueryFilter =
  | {
      field: string;
      operator: 'eq' | 'ne' | 'supports';
      value: QueryValue;
    }
  | {
      field: string;
      operator: 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    }
  | {
      field: string;
      operator: 'in' | 'not_in';
      value: QueryValue[];
    }
  | {
      field: string;
      operator: 'exists' | 'not_exists';
    };

/** 结构化查询；filters.all 为 AND，filters.any 为 OR，field 支持点路径。 */
export interface Query {
  filters?: {
    all?: QueryFilter[];
    any?: QueryFilter[];
  };

  limit?: number;
}

export interface QueryModelsInput {
  /** 单类查询使用 nodeType eq，非文本类还需 modelType eq；批量发现使用 nodeType in。 */
  query: Query;
}

export interface QueryModelsOutput {
  models: ModelSettingSummary[];
}
export interface GetModelSettingInput {
  /** 选定模型后用 nodeType/modelType/model 精确定位；无 model 条件时返回首个匹配设置。 */
  query: Query;
}

export interface GetModelSettingOutput {
  model: ModelSetting;
}
// ─────────────────────────────────────────────────────────────────────────────
// 4. 工作流与节点查询（默认返回精简视图）
// ─────────────────────────────────────────────────────────────────────────────
export interface CreateWorkflowInput {
  /** 工作流展示名称；未传入时由服务端提供默认名称。 */
  name?: string;
}

export interface CreateWorkflowOutput {
  workflow: WorkflowSummary;
}

export interface ListWorkflowsInput {
  /** 仅按 id、name 字段过滤。 */
  query?: Query;
}

export interface ListWorkflowsOutput {
  workflows: WorkflowSummary[];
}

export interface GetWorkflowInput {
  workflowId: string;
  /** 默认使用 `summary`；只有确实需要时才请求 `full`。 */
  view?: 'summary' | 'structure' | 'full';
}

export interface GetWorkflowSummaryOutput {
  view: 'summary';
  workflow: WorkflowSummary;
}

export interface GetWorkflowStructureOutput {
  view: 'structure';
  workflow: WorkflowSummary;
  nodes: NodeSummary[];
  edges: Edge[];
}

export interface GetWorkflowFullOutput {
  view: 'full';
  workflow: Workflow;
}

export type GetWorkflowOutput =
  | GetWorkflowSummaryOutput
  | GetWorkflowStructureOutput
  | GetWorkflowFullOutput;

export interface ListNodesInput {
  workflowId: string;
  /** 默认返回 `summary` 摘要视图。 */
  view?: 'summary' | 'full';
  /** 可按节点字段或 data.params.modelType 等点路径过滤。 */
  query?: Query;
}

export interface ListNodesSummaryOutput {
  view: 'summary';
  nodes: NodeSummary[];
}

export interface ListNodesFullOutput {
  view: 'full';
  nodes: Node[];
}

export type ListNodesOutput = ListNodesSummaryOutput | ListNodesFullOutput;

export interface GetNodeInput {
  workflowId: string;
  id: string;
}

export interface GetNodeOutput {
  node: Node;
}
// ─────────────────────────────────────────────────────────────────────────────
// 5. Agent 节点创建参数（不要求填写 id、measured 或 taskInfo）
// ─────────────────────────────────────────────────────────────────────────────
export interface NodeCreateBase {
  title?: string;
  /** 未指定位置时，由服务端自动选择布局位置。 */
  position?: Position;
  /** 创建时指定的期望尺寸；与渲染层测得的 measured 并非同一字段，映射由服务端决定。 */
  size?: Size;
}
/** 模型节点通用创建字段。 */
interface BasicCreateBase extends NodeCreateBase {
  model: string;
  prompt?: string;
}

/** 文本节点创建参数。 */
export interface TextNodeCreateInput extends BasicCreateBase {
  type: 'text';
  search_resource?: boolean;
}

/** 图像节点创建参数。 */
export interface ImageNodeCreateInput extends BasicCreateBase {
  type: 'image';
  modelType: ImageModelType;
  aspect_ratio?: string;
  gen_count?: number;
  quality?: string;
  resolution?: string;
}

/** 视频节点创建参数。 */
export interface VideoNodeCreateInput extends BasicCreateBase {
  type: 'video';
  modelType: VideoModelType;
  aspect_ratio?: string;
  duration?: number;
  enableAudio?: boolean;
  gen_count?: number;
  resolution?: string;
}

/** 音频节点创建参数。 */
export interface AudioNodeCreateInput extends BasicCreateBase {
  type: 'audio';
  modelType: AudioModelType;
  gen_count?: number;
  seniorParams?: {
    customMode?: boolean;
    instrumental?: boolean;
    styleWeight?: number;
    vocalGender?: string;
    weirdnessConstraint?: number;
  };
}

export interface PoseToolNodeCreateInput extends NodeCreateBase {
  type: 'poseTool';
  parameters?: JsonObject;
}

export interface HighDefinitionToolNodeCreateInput extends NodeCreateBase {
  type: 'highDefinitionTool';
  parameters?: JsonObject;
}

export type NodeCreateInput =
  | TextNodeCreateInput
  | ImageNodeCreateInput
  | VideoNodeCreateInput
  | AudioNodeCreateInput
  | PoseToolNodeCreateInput
  | HighDefinitionToolNodeCreateInput;

/**
 * `set` 替换参数字典中指定的顶层键，`unset` 删除指定的顶层键；
 * 修改某个嵌套键时，需要提交其所在顶层键的完整替换值。
 * 仅用于工具节点的 params。
 * 同一个键不能同时出现在 set 与 unset 中。
 */
export interface ParameterPatch {
  set?: JsonObject;
  unset?: string[];
}
/**
 * 未提供的字段保持不变。type 必须与目标节点一致；参数补丁只修改指定键。
 */
interface NodeChangesBase {
  title?: string;
  position?: Position;
  size?: Size;
}

interface ModelNodeChangesBase extends NodeChangesBase {
  model?: string;
  prompt?: string;
}

export type NodeChanges =
  | (ModelNodeChangesBase & { type: 'text'; search_resource?: boolean })
  | (ModelNodeChangesBase & {
      type: 'image';
      modelType?: ImageModelType;
      aspect_ratio?: string;
      gen_count?: number;
      quality?: string;
      resolution?: string;
    })
  | (ModelNodeChangesBase & {
      type: 'video';
      modelType?: VideoModelType;
      aspect_ratio?: string;
      duration?: number;
      enableAudio?: boolean;
      gen_count?: number;
      resolution?: string;
    })
  | (ModelNodeChangesBase & {
      type: 'audio';
      modelType?: AudioModelType;
      gen_count?: number;
      /** 提供时整体替换 seniorParams。 */
      seniorParams?: AudioNodeParams['seniorParams'];
    })
  | (NodeChangesBase & { type: 'poseTool'; parameters?: ParameterPatch })
  | (NodeChangesBase & { type: 'highDefinitionTool'; parameters?: ParameterPatch });

// ─────────────────────────────────────────────────────────────────────────────
// 6. 工作流原子化批量修改操作
// ─────────────────────────────────────────────────────────────────────────────
/** 创建时不传 ID；实现方生成后在结果中返回。 */
export interface AddNodeOperation {
  op: 'add_node';
  node: NodeCreateInput;
}

export interface UpdateNodeOperation {
  op: 'update_node';
  id: string;
  changes: NodeChanges;
}
/** 删除节点时，服务端必须在同一事务中一并删除相关连线。 */
export interface DeleteNodeOperation {
  op: 'delete_node';
  id: string;
}

/** 创建时不传 ID；实现方生成后在结果中返回。 */
export interface AddEdgeOperation {
  op: 'add_edge';
  /** 已存在节点的 ID；本批次新节点的 ID 要在提交后才能获取。 */
  source: string;
  /** 已存在节点的 ID；本批次新节点的 ID 要在提交后才能获取。 */
  target: string;
  /** 可省略；由后端解析并校验源端口。 */
  sourceHandle?: string;
  /** 可省略；由后端解析并校验目标端口。 */
  targetHandle?: string;
}

export interface DeleteEdgeOperation {
  op: 'delete_edge';
  id: string;
}

export interface RenameWorkflowOperation {
  op: 'rename_workflow';
  name: string;
}
/** 操作判别联合类型；通过不同的 `op` 字段确定操作结构。 */
export type WorkflowOperation =
  | AddNodeOperation
  | UpdateNodeOperation
  | DeleteNodeOperation
  | AddEdgeOperation
  | DeleteEdgeOperation
  | RenameWorkflowOperation;
/** 所有操作以事务方式提交；任一校验失败都不得修改原工作流。 */
export interface ApplyWorkflowPatchInput {
  workflowId: string;
  operations: WorkflowOperation[];
}

export interface ToolError {
  /** 供程序识别的错误码，例如 MODEL_NOT_FOUND、INVALID_PORT。 */
  code: string;
  message: string;
  /** 错误字段的 JSON Pointer 路径（如适用）。 */
  path?: string;
  /** 发生错误的操作在 `operations` 数组中的索引，从 0 开始。 */
  operationIndex?: number;
  retryable?: boolean;
}

export interface ApplyWorkflowPatchOutput {
  /** 仅全部操作实际提交成功时为 `true`。 */
  applied: boolean;
  /** 操作是否全部校验通过。 */
  valid: boolean;
  /** 按 add_node 操作顺序返回实现方生成的 ID。 */
  createdNodes: Array<{ id: string }>;
  /** 按 add_edge 操作顺序返回实现方生成的 ID。 */
  createdEdges: Array<{ id: string }>;
  errors: ToolError[];
  warnings: ToolError[];
}
// ─────────────────────────────────────────────────────────────────────────────
// 7. 校验与执行生命周期
// ─────────────────────────────────────────────────────────────────────────────
export interface ExecuteWorkflowInput {
  workflowId: string;
  /** 本次需要执行的节点 ID。 */
  runningNodeIds: string[];
  /** 执行时的完整画布快照。 */
  workflowData: {
    edges: Edge[];
    nodes: Node[];
  };
}

export interface ExecuteWorkflowOutput {
  workflowId: string;
  /** 用于后续查询运行状态。 */
  taskId: string;
}

export interface GetWorkflowRunInput {
  taskId: string;
  workflowId: string;
}

export interface GetWorkflowRunOutput {
  workflowId: string;
  status: 'queued' | ExecutionStatus;
}
// ─────────────────────────────────────────────────────────────────────────────
// 8. Agent 工具契约
// ─────────────────────────────────────────────────────────────────────────────
export interface WorkflowToolContracts {
  get_node_definition: { input: GetNodeDefinitionInput; output: GetNodeDefinitionOutput };
  search_models: { input: QueryModelsInput; output: QueryModelsOutput };
  get_model_setting: { input: GetModelSettingInput; output: GetModelSettingOutput };
  create_workflow: { input: CreateWorkflowInput; output: CreateWorkflowOutput };
  list_workflows: { input: ListWorkflowsInput; output: ListWorkflowsOutput };
  get_workflow: { input: GetWorkflowInput; output: GetWorkflowOutput };
  list_nodes: { input: ListNodesInput; output: ListNodesOutput };
  get_node: { input: GetNodeInput; output: GetNodeOutput };
  apply_workflow_patch: { input: ApplyWorkflowPatchInput; output: ApplyWorkflowPatchOutput };
  execute_workflow: { input: ExecuteWorkflowInput; output: ExecuteWorkflowOutput };
  get_workflow_run: { input: GetWorkflowRunInput; output: GetWorkflowRunOutput };
}
/** 工具注册时使用的描述文本，供 Agent 理解功能；应保持简洁明确。 */
export const WORKFLOW_TOOL_DESCRIPTIONS = {
  get_node_definition: '按一个或多个节点类型批量查询节点概览及支持的模型方式。',
  search_models: '按查询条件获取一个或多个基础节点类型的可用模型列表。',
  get_model_setting: '按 query 获取模型的参数控件和默认值；无 model 条件时选择首个匹配模型。',
  create_workflow: '创建空工作流，返回工作流 id。',
  list_workflows: '按id/名称获取指定工作流的摘要数据。',
  get_workflow: '获取指定工作流的摘要、图结构或完整数据。',
  list_nodes: '按查询条件获取指定工作流的节点摘要或完整节点。',
  get_node: '获取指定工作流节点的完整配置。',
  apply_workflow_patch: '批量新增、局部更新、删除节点和连线，或重命名工作流。',
  execute_workflow: '按节点 ID 和画布快照启动工作流，返回任务 ID。',
  get_workflow_run: '按工作流 ID 和任务 ID 查询执行状态。',
} as const satisfies Record<keyof WorkflowToolContracts, string>;
