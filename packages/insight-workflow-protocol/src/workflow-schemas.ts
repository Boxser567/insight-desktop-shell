import { z } from 'zod'
import type { WorkflowToolContracts } from './workflow-agent-tools.type.js'

const object = z.strictObject
const tagged = <T extends string>(value: T, description: string) => z.literal(value).describe(description)
const id = z.string().min(1).describe('服务端生成的非空 ID；不要自行编造。')
const workflowId = id.describe('工作流 ID；来自 create_workflow、list_workflows 或当前会话上下文。')
const nodeId = id.describe('已存在的节点 ID；来自 get_workflow、list_nodes 或 get_node。')
const model = id.describe('模型 ID；先调用 search_models，选定后可调用 get_model_setting。')
const nodeType = z.enum(['text', 'image', 'audio', 'video', 'poseTool', 'highDefinitionTool']).describe('节点类型：四种基础媒体节点或两种工具节点。')
const imageModelType = z.enum(['text_to_image', 'reference_image_to_image']).describe('图像生成方式。')
const videoModelType = z.enum(['first_last_frame_to_video', 'image_to_video', 'reference_image_to_video', 'text_to_video']).describe('视频生成方式；纯文本生成视频使用 text_to_video。')
const audioModelType = z.enum(['tts', 'text_to_audio', 'audio_to_audio']).describe('音频生成方式。')
const modelType = z.enum([...imageModelType.options, ...videoModelType.options, ...audioModelType.options]).describe('模型能力类型，须与节点类型相符。')
const status = z.enum(['running', 'success', 'failed']).describe('节点或工作流当前执行状态。')
const jsonValue = z.json().describe('可序列化的 JSON 值：字符串、数字、布尔值、null、数组或对象。')
const jsonObject = z.record(z.string(), jsonValue).describe('任意 JSON 参数字典；具体键和值由所选模型的配置决定。')

const position = object({
  x: z.number().finite().describe('画布横坐标。'),
  y: z.number().finite().describe('画布纵坐标。')
}).describe('画布位置。')
const size = object({
  width: z.number().positive().describe('期望宽度。'),
  height: z.number().positive().describe('期望高度。')
}).describe('节点尺寸。')
const taskInfo = object({
  status: status.describe('新建节点为 success，生成中为 running，失败为 failed。'),
  errorMsg: z.string().optional().describe('失败原因。')
}).describe('节点任务状态。')
const dataBase = {
  title: z.string().describe('节点显示标题。'),
  value: z.union([z.string(), z.array(z.string())]).optional().describe('生成物或预览图的 URL；尚无资源时可省略。'),
  type: tagged('upload', '已有资源节点，不执行生成。').optional(),
  taskInfo
}
const baseParams = {
  model: model.optional().describe('已选模型 ID；画布中未配置模型的节点可省略。'),
  prompt: z.string().describe('提供给模型的提示词。')
}
const seniorParams = object({
  customMode: z.boolean().optional().describe('是否启用自定义模式。'),
  instrumental: z.boolean().optional().describe('是否仅生成伴奏。'),
  styleWeight: z.number().optional().describe('风格权重；有效范围以模型配置为准。'),
  vocalGender: z.string().optional().describe('人声性别参数；有效取值以模型配置为准。'),
  weirdnessConstraint: z.number().optional().describe('创意程度约束；有效范围以模型配置为准。')
}).describe('音频高级参数。')
const textParams = object({ ...baseParams, search_resource: z.boolean().describe('是否检索资源。') }).describe('已保存的文本节点参数。')
const imageParams = object({
  ...baseParams, modelType: imageModelType.optional(),
  aspect_ratio: z.string().optional().describe('画面比例；可用值由模型配置决定。'),
  gen_count: z.number().int().positive().optional().describe('生成数量；上限由模型配置决定。'),
  quality: z.string().optional().describe('图像质量；可用值由模型配置决定。'),
  resolution: z.string().optional().describe('图像分辨率；可用值由模型配置决定。')
}).describe('已保存的图像节点参数。')
const videoParams = object({
  ...baseParams, modelType: videoModelType.optional(),
  aspect_ratio: z.string().optional().describe('视频画面比例；可用值由模型配置决定。'),
  duration: z.number().positive().optional().describe('视频时长，单位秒；可用范围由模型配置决定。'),
  enableAudio: z.boolean().optional().describe('是否同时生成音轨。'),
  gen_count: z.number().int().positive().optional().describe('生成数量；上限由模型配置决定。'),
  resolution: z.string().optional().describe('视频分辨率；可用值由模型配置决定。')
}).describe('已保存的视频节点参数。')
const audioParams = object({
  ...baseParams, modelType: audioModelType.optional(),
  gen_count: z.number().int().positive().optional().describe('生成数量；上限由模型配置决定。'),
  seniorParams: seniorParams.optional().describe('音频高级参数。')
}).describe('已保存的音频节点参数。')
const nodeBase = {
  id: nodeId,
  position,
  measured: size.optional().describe('画布实际测量尺寸；通常由渲染层维护。')
}
const node = z.discriminatedUnion('type', [
  object({ ...nodeBase, type: tagged('text', '文本节点。'), data: object({ ...dataBase, params: textParams }).describe('文本节点数据。') }),
  object({ ...nodeBase, type: tagged('image', '图像节点。'), data: object({ ...dataBase, params: imageParams }).describe('图像节点数据。') }),
  object({ ...nodeBase, type: tagged('audio', '音频节点。'), data: object({ ...dataBase, params: audioParams }).describe('音频节点数据。') }),
  object({ ...nodeBase, type: tagged('video', '视频节点。'), data: object({ ...dataBase, params: videoParams }).describe('视频节点数据。') }),
  object({ ...nodeBase, type: tagged('poseTool', '姿态工具节点。'), data: object({ ...dataBase, params: jsonObject.optional().describe('姿态工具参数。') }).describe('姿态工具节点数据。') }),
  object({ ...nodeBase, type: tagged('highDefinitionTool', '高清工具节点。'), data: object({ ...dataBase, params: jsonObject.optional().describe('高清工具参数。') }).describe('高清工具节点数据。') })
]).describe('节点完整数据；type 决定 data.params 的结构。')
const edge = object({
  id: id.describe('连线 ID。'),
  source: nodeId.describe('源节点 ID。'),
  sourceHandle: z.string().describe('源节点输出端口名。'),
  target: nodeId.describe('目标节点 ID。'),
  targetHandle: z.string().describe('目标节点输入端口名。')
}).describe('画布连线。')
const workflowSummary = object({
  id: workflowId,
  name: z.string().describe('工作流显示名称。'),
  nodeCount: z.number().int().nonnegative().describe('节点数。'),
  edgeCount: z.number().int().nonnegative().describe('连线数。')
}).describe('工作流摘要，不包含节点配置。')
const workflow = object({
  id: workflowId,
  name: z.string().describe('工作流显示名称。'),
  nodes: z.array(node).describe('完整节点数据。'),
  edges: z.array(edge).describe('完整连线数据。')
}).describe('工作流完整数据。')
const nodeSummary = object({
  id: nodeId,
  type: nodeType,
  title: z.string().describe('节点显示标题。'),
  position,
  model: model.optional().describe('模型节点的模型 ID。'),
  modelType: modelType.optional().describe('图像、视频或音频节点的模型方式。'),
  status
}).describe('节点摘要，不包含完整参数。')

const parameterChoice = object({ value: z.string().describe('提交给模型的选项值。'), label: z.string().describe('展示给用户的选项名。') })
const parameterBase = { label: z.string().describe('参数显示名称。') }
const numberParameter = object({
  ...parameterBase, type: tagged('number', '数值输入控件。'),
  min: z.number().describe('允许的最小值。'),
  max: z.number().describe('允许的最大值。'),
  step: z.number().positive().describe('取值步长。'),
  default: z.number().optional().describe('默认数值。')
})
const switchParameter = object({ ...parameterBase, type: tagged('switch', '布尔开关控件。'), default: z.boolean().optional().describe('默认开关状态。') })
const parameter = z.discriminatedUnion('type', [
  object({ ...parameterBase, type: tagged('choices', '选项控件。'), choices: z.array(parameterChoice).describe('可选值及展示标签。'), default: z.string().optional().describe('默认选项值。') }),
  numberParameter,
  switchParameter
]).describe('业务参数控件定义；不是标准 JSON Schema。')
const parameterSummary = z.discriminatedUnion('type', [
  object({ ...parameterBase, type: tagged('choices', '选项控件。'), choices: z.array(z.string()).describe('可选值，不含展示标签。'), default: z.string().optional().describe('默认选项值。') }),
  numberParameter,
  switchParameter
]).describe('参数控件摘要，保留取值约束。')
const parameterMap = z.record(z.string(), parameter).describe('参数名到控件定义的映射。每个值为 {type:"choices",label,choices:[{value,label}],default?}、{type:"number",label,min,max,step,default?} 或 {type:"switch",label,default?}。')
const capabilityMap = z.record(z.string(), parameterSummary).describe('参数名到控件摘要的映射；结构同完整控件，但 choices 为选项值字符串数组。')
const capability = object({
  nodeType,
  description: z.string().describe('节点用途。'),
  supportedModelTypes: z.array(modelType).optional().describe('该节点支持的模型方式；工具节点可不提供。')
}).describe('节点能力摘要。')
const modelBase = {
  model,
  modelName: z.string().describe('模型显示名称。'),
  description: z.string().describe('模型用途与能力说明。'),
  maxPrompt: z.number().int().nonnegative().describe('提示词最大长度。')
}
const modelDetails = {
  parameters: parameterMap.describe('普通参数名到控件定义的映射；键对应节点 data.params 字段。值为 {type:"choices",label,choices:[{value,label}],default?}、{type:"number",label,min,max,step,default?} 或 {type:"switch",label,default?}。'),
  senoirParameters: parameterMap.optional().describe('高级参数名到控件定义的映射；键对应 data.params.seniorParams 字段，值结构同 parameters，保留 senoirParameters 拼写。'),
  defaultParameters: jsonObject.describe('默认参数字典；键对应 data.params 或 data.params.seniorParams 字段。')
}
const modelSetting = z.discriminatedUnion('nodeType', [
  object({ ...modelBase, nodeType: tagged('text', '适用于文本节点。'), ...modelDetails }),
  object({ ...modelBase, nodeType: tagged('image', '适用于图像节点。'), modelType: imageModelType, ...modelDetails }),
  object({ ...modelBase, nodeType: tagged('audio', '适用于音频节点。'), modelType: audioModelType, ...modelDetails }),
  object({ ...modelBase, nodeType: tagged('video', '适用于视频节点。'), modelType: videoModelType, ...modelDetails })
]).describe('完整模型配置；选定模型后再读取。')
const modelSettingSummary = z.discriminatedUnion('nodeType', [
  object({ ...modelBase, nodeType: tagged('text', '适用于文本节点。'), capabilities: capabilityMap }),
  object({ ...modelBase, nodeType: tagged('image', '适用于图像节点。'), modelType: imageModelType, capabilities: capabilityMap }),
  object({ ...modelBase, nodeType: tagged('audio', '适用于音频节点。'), modelType: audioModelType, capabilities: capabilityMap }),
  object({ ...modelBase, nodeType: tagged('video', '适用于视频节点。'), modelType: videoModelType, capabilities: capabilityMap })
]).describe('模型摘要与参数取值约束。')
const nodeDefinition = capability.describe('节点类型概览与可用模型方式。')

const queryValue = z.union([z.string(), z.number(), z.boolean()]).describe('查询值：字符串、数字或布尔值。')
const queryFilter = z.discriminatedUnion('operator', [
  object({ field: z.string().describe('要比较的字段路径。'), operator: z.enum(['eq', 'ne', 'supports']).describe('相等、不等或能力支持判断。'), value: queryValue.describe('比较值。') }),
  object({ field: z.string().describe('数值字段名。'), operator: z.enum(['gt', 'gte', 'lt', 'lte']).describe('数值范围比较。'), value: z.number().describe('数值阈值。') }),
  object({ field: z.string().describe('要比较的字段路径。'), operator: z.enum(['in', 'not_in']).describe('集合包含或排除。'), value: z.array(queryValue).describe('候选值列表。') }),
  object({ field: z.string().describe('要检查的字段名。'), operator: z.enum(['exists', 'not_exists']).describe('字段存在性判断。') })
]).describe('一条搜索过滤条件；operator 决定 value 是否必需及其类型。')
const query = object({
  filters: object({
    all: z.array(queryFilter).optional().describe('全部条件都要满足，AND。'),
    any: z.array(queryFilter).optional().describe('至少满足一个条件，OR；与 all 同时提供时先 AND(all, OR(any))。')
  }).optional().describe('组合过滤条件；field 可用点路径访问嵌套字段。'),
  limit: z.number().int().positive().optional().describe('本次最多返回多少项。')
}).describe('结构化查询条件；filters.all 为 AND，filters.any 为 OR。')
const modelQuery = query.superRefine((value, ctx) => {
  const conditions = value.filters?.all ?? []
  const node = conditions.find(filter => filter.field === 'nodeType' && (filter.operator === 'eq' || filter.operator === 'in'))
  const types = node?.operator === 'eq' ? [node.value] : node?.operator === 'in' ? node.value : []
  if (!types.length || !types.every(type => ['text', 'image', 'audio', 'video'].includes(String(type)))) {
    ctx.addIssue({ code: 'custom', message: 'filters.all 必须包含基础节点的 nodeType eq 或 in 条件' })
  } else if (types.length === 1 && types[0] !== 'text' && !conditions.some(filter => filter.field === 'modelType' && filter.operator === 'eq')) {
    ctx.addIssue({ code: 'custom', message: '图像、视频、音频模型还需要 modelType eq 条件' })
  }
}).describe('模型查询在 filters.all 中用 nodeType eq 指定单类，非文本类还需 modelType eq；批量发现用 nodeType in 指定多类。')

const createBase = {
  title: z.string().optional().describe('节点显示标题；省略时由服务端生成。'),
  position: position.optional().describe('期望画布位置；省略时由服务端布局。'),
  size: size.optional().describe('期望尺寸；不是持久化的 measured。')
}
const modelCreateBase = {
  ...createBase,
  model,
  prompt: z.string().optional().describe('生成提示词；没有提示词时可省略。'),
  value: z.union([z.string(), z.array(z.string())]).optional().describe('已有资源的 URL；提供时新节点标记为 upload。')
}
const nodeCreate = z.discriminatedUnion('type', [
  object({ ...modelCreateBase, type: tagged('text', '新建文本节点。'), search_resource: z.boolean().optional().describe('是否启用资源检索。') }),
  object({ ...modelCreateBase, type: tagged('image', '新建图像节点。'), modelType: imageModelType, aspect_ratio: z.string().optional().describe('画面比例。'), gen_count: z.number().int().positive().optional().describe('生成数量。'), quality: z.string().optional().describe('图像质量。'), resolution: z.string().optional().describe('分辨率。') }),
  object({ ...modelCreateBase, type: tagged('video', '新建视频节点。'), modelType: videoModelType, aspect_ratio: z.string().optional().describe('画面比例。'), duration: z.number().positive().optional().describe('视频时长，单位秒；例如 5 秒填 5。'), enableAudio: z.boolean().optional().describe('是否生成音轨。'), gen_count: z.number().int().positive().optional().describe('生成数量。'), resolution: z.string().optional().describe('分辨率。') }),
  object({ ...modelCreateBase, type: tagged('audio', '新建音频节点。'), modelType: audioModelType, gen_count: z.number().int().positive().optional().describe('生成数量。'), seniorParams: seniorParams.optional().describe('音频高级参数。') }),
  object({ ...createBase, type: tagged('poseTool', '新建姿态工具节点。'), parameters: jsonObject.optional().describe('姿态工具参数。') }),
  object({ ...createBase, type: tagged('highDefinitionTool', '新建高清工具节点。'), parameters: jsonObject.optional().describe('高清工具参数。') })
]).describe('新节点参数；不填写 id、measured 或 taskInfo。type 决定其余必填字段。')
const parameterPatch = object({
  set: jsonObject.optional().describe('按顶层键设置或替换参数；嵌套值需整体替换。'),
  unset: z.array(z.string()).optional().describe('要删除的顶层参数键；不得同时出现在 set 中。')
}).superRefine((value, ctx) => {
  for (const key of value.unset ?? []) if (key in (value.set ?? {})) ctx.addIssue({ code: 'custom', message: `参数 ${key} 不能同时 set 和 unset` })
}).describe('参数字典局部补丁。')
const changesBase = {
  title: z.string().optional().describe('新的节点标题。'),
  position: position.optional().describe('新的画布位置。'),
  size: size.optional().describe('新的期望尺寸。')
}
const modelChangesBase = {
  ...changesBase,
  model: model.optional().describe('新的模型 ID；须与节点类型匹配。'),
  prompt: z.string().optional().describe('新的提示词。'),
  value: z.union([z.string(), z.array(z.string())]).optional().describe('新的资源 URL，写入节点 data.value。')
}
const nodeChanges = z.discriminatedUnion('type', [
  object({ ...modelChangesBase, type: tagged('text', '修改文本节点。'), search_resource: z.boolean().optional().describe('新的资源检索开关。') }),
  object({ ...modelChangesBase, type: tagged('image', '修改图像节点。'), modelType: imageModelType.optional().describe('新的图像方式。'), aspect_ratio: z.string().optional().describe('新的画面比例。'), gen_count: z.number().int().positive().optional().describe('新的生成数量。'), quality: z.string().optional().describe('新的质量。'), resolution: z.string().optional().describe('新的分辨率。') }),
  object({ ...modelChangesBase, type: tagged('video', '修改视频节点。'), modelType: videoModelType.optional().describe('新的视频方式。'), aspect_ratio: z.string().optional().describe('新的画面比例。'), duration: z.number().positive().optional().describe('新的视频时长，单位秒。'), enableAudio: z.boolean().optional().describe('新的音轨开关。'), gen_count: z.number().int().positive().optional().describe('新的生成数量。'), resolution: z.string().optional().describe('新的分辨率。') }),
  object({ ...modelChangesBase, type: tagged('audio', '修改音频节点。'), modelType: audioModelType.optional().describe('新的音频方式。'), gen_count: z.number().int().positive().optional().describe('新的生成数量。'), seniorParams: seniorParams.optional().describe('整体替换音频高级参数。') }),
  object({ ...changesBase, type: tagged('poseTool', '修改姿态工具节点。'), parameters: parameterPatch.optional().describe('姿态工具参数补丁。') }),
  object({ ...changesBase, type: tagged('highDefinitionTool', '修改高清工具节点。'), parameters: parameterPatch.optional().describe('高清工具参数补丁。') })
]).describe('局部节点修改；type 必须与目标节点一致，未提供字段保持不变。')
const operation = z.discriminatedUnion('op', [
  object({ op: tagged('add_node', '新增节点。'), node: nodeCreate }),
  object({ op: tagged('update_node', '修改已有节点。'), id: nodeId, changes: nodeChanges }),
  object({ op: tagged('delete_node', '删除已有节点。'), id: nodeId }),
  object({ op: tagged('add_edge', '新增连线。'), source: nodeId.describe('已有源节点 ID；本批次新节点须待提交后才能引用。'), target: nodeId.describe('已有目标节点 ID；本批次新节点须待提交后才能引用。') }),
  object({ op: tagged('delete_edge', '删除已有连线。'), id: id.describe('要删除的连线 ID。') }),
  object({ op: tagged('rename_workflow', '重命名工作流。'), name: z.string().min(1).describe('新工作流名称。') })
]).describe('原子补丁中的一项操作；按数组顺序执行，op 决定其余字段。')
const toolError = object({
  code: z.string().describe('机器可识别错误码，例如 REVISION_CONFLICT。'),
  message: z.string().describe('人可读的错误说明。'),
  path: z.string().optional().describe('出错字段的 JSON Pointer 路径。'),
  operationIndex: z.number().int().nonnegative().optional().describe('出错操作在 operations 中的零基索引。'),
  retryable: z.boolean().optional().describe('是否可以重试。')
}).describe('工具错误或警告。')
const getWorkflowOutput = z.discriminatedUnion('view', [
  object({ view: tagged('summary', '仅返回工作流摘要。'), workflow: workflowSummary }),
  object({ view: tagged('structure', '返回摘要及图结构。'), workflow: workflowSummary, nodes: z.array(nodeSummary).describe('节点摘要。'), edges: z.array(edge).describe('连线结构。') }),
  object({ view: tagged('full', '返回完整工作流。'), workflow })
]).describe('按 view 返回摘要、图结构或完整工作流。')
const listNodesOutput = z.discriminatedUnion('view', [
  object({ view: tagged('summary', '返回节点摘要。'), nodes: z.array(nodeSummary).describe('节点摘要列表。') }),
  object({ view: tagged('full', '返回完整节点。'), nodes: z.array(node).describe('完整节点列表。') })
]).describe('按 view 返回摘要或完整节点列表。')

export const workflowSchemas = {
  get_node_definition: {
    input: object({ nodeType: z.union([nodeType, z.array(nodeType).min(1)]).describe('单个节点类型，或要一次查询的节点类型列表；查询所有节点时传入全部 NodeType。') }).describe('按一种或多种节点类型查询。'),
    output: object({ nodeDefinitions: z.array(nodeDefinition).describe('按请求顺序返回的节点概览；单个类型也返回数组。') }).describe('节点概览及支持的模型方式。')
  },
  search_models: {
    input: object({ query: modelQuery }).describe('按节点类型与模型方式查询可用模型。'),
    output: object({ models: z.array(modelSettingSummary).describe('匹配的模型摘要；先选择模型再查完整设置。') }).describe('模型查询结果。')
  },
  get_model_setting: {
    input: object({ query: modelQuery.describe('用 nodeType/modelType 定位模型类别；可再用 field=model 精确选择，省略 model 时取首个匹配项。') }).describe('按条件获取完整模型配置。'),
    output: object({ model: modelSetting }).describe('完整模型控件、取值约束和默认参数。')
  },
  create_workflow: {
    input: object({ name: z.string().optional().describe('工作流显示名称；省略时由服务端命名。') }).describe('新建空工作流参数。'),
    output: object({ workflow: workflowSummary }).describe('新工作流 ID 和节点数量摘要。')
  },
  list_workflows: {
    input: object({ query: query.optional().describe('按 id 或 name 字段筛选。') }).describe('工作流列表查询参数。'),
    output: object({ workflows: z.array(workflowSummary).describe('工作流摘要列表。') }).describe('工作流列表结果。')
  },
  get_workflow: {
    input: object({ workflowId, view: z.enum(['summary', 'structure', 'full']).optional().describe('默认 summary；structure 返回节点摘要和边，full 返回完整节点配置。') }).describe('按 ID 查询工作流。'),
    output: getWorkflowOutput
  },
  list_nodes: {
    input: object({ workflowId, view: z.enum(['summary', 'full']).optional().describe('默认 summary；仅需要参数时选择 full。'), query: query.optional().describe('按 id、type、data.title 或 data.params.modelType 等点路径筛选。') }).describe('工作流内节点列表查询。'),
    output: listNodesOutput
  },
  get_node: {
    input: object({ workflowId, id: nodeId }).describe('查询指定工作流的一个节点。'),
    output: object({ node }).describe('节点完整参数与任务状态。')
  },
  apply_workflow_patch: {
    input: object({
      workflowId,
      operations: z.array(operation).describe('按顺序执行的原子操作；任一失败则不提交。')
    }).describe('原子事务补丁。'),
    output: object({
      applied: z.boolean().describe('只有全部操作真正提交后才为 true。'),
      valid: z.boolean().describe('操作是否全部校验通过。'),
      createdNodes: z.array(object({ id: nodeId })).describe('按 add_node 操作顺序返回新节点 ID。'),
      createdEdges: z.array(object({ id })).describe('按 add_edge 操作顺序返回新连线 ID。'),
      errors: z.array(toolError).describe('阻止提交的错误。'),
      warnings: z.array(toolError).describe('不阻止提交的警告。')
    }).describe('原子修改结果。')
  },
  execute_workflow: {
    input: object({
      workflowId,
      runningNodeIds: z.array(nodeId).describe('本次需要执行的节点 ID。'),
      workflowData: object({
        edges: z.array(edge).describe('执行时的画布连线。'),
        nodes: z.array(node).describe('执行时的完整节点。')
      }).describe('执行时的完整画布快照。')
    }).describe('按节点 ID 和画布快照启动工作流。'),
    output: object({ workflowId, taskId: id.describe('用于后续查询运行状态的任务 ID。') }).describe('新任务的 ID。')
  },
  get_workflow_run: {
    input: object({ workflowId, taskId: id.describe('execute_workflow 返回的任务 ID。') }).describe('查询一次工作流运行。'),
    output: object({ workflowId, status: z.enum(['queued', 'running', 'success', 'failed']).describe('任务已入队、运行中、成功或失败。') }).describe('工作流任务状态。')
  }
} satisfies { [K in keyof WorkflowToolContracts]: {
  input: z.ZodType<WorkflowToolContracts[K]['input']>
  output: z.ZodType<WorkflowToolContracts[K]['output']>
} }

export const workflowResultGuides = {
  get_node_definition: 'nodeDefinitions 按请求顺序列出 nodeType、description 和可选 supportedModelTypes；选模型后再查询配置。',
  search_models: 'models 是含 model ID、nodeType、modelType 和 capabilities 的摘要。',
  get_model_setting: 'model 含完整 parameters、senoirParameters 与 defaultParameters；参数控件不是标准 JSON Schema。',
  create_workflow: 'workflow.id 用于后续调用；nodeCount 和 edgeCount 初始为 0。',
  list_workflows: 'workflows 是 ID、名称及节点/连线数量摘要。',
  get_workflow: 'view=summary 返回 workflow 摘要；structure 还返回 nodes 摘要与 edges；full 返回完整 workflow。',
  list_nodes: 'view=summary 返回 nodes 摘要；full 返回包含 data.params 的完整节点。',
  get_node: 'node 是完整节点；data.value 存放生成物或预览图 URL，data.type=upload 标记上传资源，data.taskInfo 给出执行状态。',
  apply_workflow_patch: 'applied 表示已提交，valid 表示校验通过；createdNodes/createdEdges 按新增操作顺序列出实现方生成的 ID，errors/warnings 给出问题。',
  execute_workflow: '传入 runningNodeIds 和包含 nodes、edges 的 workflowData；返回的 taskId 用于查询状态。',
  get_workflow_run: '传入 workflowId 和 taskId，返回 queued、running、success 或 failed 状态。'
} satisfies Record<keyof WorkflowToolContracts, string>

// Keep the schemas for non-tool DTOs accessible to contract tests and future canvas integration.
export const workflowTypes = {
  nodeType, imageModelType, videoModelType, audioModelType, modelType,
  jsonValue, jsonObject, position, size, taskInfo, textParams, imageParams, videoParams, audioParams,
  node, edge, workflow, workflowSummary, nodeSummary, parameter, parameterSummary,
  capability, modelSetting, modelSettingSummary, nodeDefinition,
  queryValue, queryFilter, query, modelQuery, nodeCreate, parameterPatch, nodeChanges,
  operation, toolError
}
