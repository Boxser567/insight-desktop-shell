export const workflowSkillContent = `# 工作流操作

工作流的保存能力以当前工具说明和返回结果为准。

## 基础

- nodeType 表示节点类型。基础节点有 text、image、audio、video；工具节点有 poseTool、highDefinitionTool。工具节点没有模型。
- modelType 表示基础节点的生成方式。图像方式有 text_to_image、reference_image_to_image；视频方式有 first_last_frame_to_video、image_to_video、reference_image_to_video、text_to_video；音频方式有 tts、text_to_audio、audio_to_audio。文本节点不填写 modelType。实际可用方式以工具查询结果为准。
- model 是模型 ID，须从查询结果中选择，不要猜测。

## 确定工作流

优先使用当前工作流摘要中的 id 作为 workflowId。用户给出其他 ID 时，先用 workflow_get_workflow 验证；没有可用工作流时，调用 workflow_create_workflow。修改前按需用 workflow_get_workflow 的 summary、structure 或 full 视图读取现状。

## 操作手册

### 发现节点配置

1. 调用 workflow_get_node_definition 确认节点类型及 supportedModelTypes。nodeType 可传单个类型或类型数组，返回的 nodeDefinitions 始终是数组。
2. 用 workflow_search_models 查询基础节点模型。单类查询在 query.filters.all 中加入 nodeType eq 条件，例如 {field:"nodeType",operator:"eq",value:"image"}。批量发现多类模型时，用 nodeType in 条件，例如 {field:"nodeType",operator:"in",value:["image","text"]}，再按 nodeType 和 modelType 从结果中选择。
3. 查询条件中，all 表示全部满足，any 表示至少满足一个；field 可用点路径，例如 data.params.modelType。supports 可查询参数是否支持某个值，例如 {field:"parameters.duration",operator:"supports",value:5}。
4. 选定模型后，按 nodeType、modelType 和 model 精确查询 workflow_get_model_setting。parameters 的键对应节点 data.params，senoirParameters 的键对应 data.params.seniorParams，defaultParameters 是默认值。按控件的 choices、min/max/step 等约束组织参数；创建和修改模型节点只填写对应 schema 声明的字段。具体字段和返回结构以工具 schema 为准。

### 批量操作

需要多种基础节点模型时，可用一个组合 Query 调用 workflow_search_models。例如创建一个图像节点和两个文本节点：先批量查询 image、text 的节点定义和模型，按所选模型读取设置，再将三个 add_node 放入同一次 workflow_apply_workflow_patch 的 operations。

- workflow_apply_workflow_patch 的 operations 按顺序原子提交，任一操作失败则不提交。
- 新增节点和连线的 ID 由实现方生成，按操作顺序从 createdNodes、createdEdges 的 id 读取。add_edge 只填已有节点的 source、target ID；端口名由实现方根据节点类型填充。要连接本次新增的节点，先提交节点，再用返回的 ID 提交连线。更新或删除节点、连线时使用 id 字段。

### 构造有/无参考图的图像节点

- 无参考图：确认 image 节点支持 text_to_image；按 nodeType=image、modelType=text_to_image 查询模型和设置，再构造 add_node 操作。
- 有参考图：先确认 image 节点支持 reference_image_to_image；若不支持，直接说明当前模型能力不足。参考图在当前工作流中时，先用 workflow_get_node 或 workflow_list_nodes 找到其 id；新图像节点创建成功后，用返回的 id 和参考节点 id 提交 add_edge。参考图来自工作流外且已有资源 URL 时，先创建带 value 的 image 节点，再建立连线。工具只保存已有 URL，不负责上传本地文件。

### 约束

- 节点的 data.value 保存生成物或预览资源 URL；更新节点的 value 会写入 data.value。
- 除非信息不足，非必要不要调用 workflow_list_workflows 和 workflow_list_nodes。

### 当前限制

不要调用 workflow_execute_workflow 或 workflow_get_workflow_run；远端画布 API 尚未提供这两个能力。`
