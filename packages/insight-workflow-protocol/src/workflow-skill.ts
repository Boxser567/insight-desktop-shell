export const workflowSkillContent = `# 工作流操作

工作流的保存能力以当前工具说明和返回结果为准。

## 操作示例

### 发现节点和模型

基础节点有 text、image、audio、video；工具节点有 poseTool、highDefinitionTool。先调用 workflow_get_node_definition 确认节点类型及 supportedModelTypes；nodeType 可传单个类型或类型数组，返回的 nodeDefinitions 始终是数组。图像方式有 text_to_image、reference_image_to_image；视频方式有 first_last_frame_to_video、image_to_video、reference_image_to_video、text_to_video；音频方式有 tts、text_to_audio、audio_to_audio。实际可用方式以工具查询结果为准。

模型查询使用 workflow_search_models 的 query.filters.all：查询单类时包含 {field:"nodeType",operator:"eq",value:"image"} 这样的条件；图像、视频、音频单类查询还需 modelType eq。批量发现多类模型时使用 {field:"nodeType",operator:"in",value:["image","text"]}，从结果中按 nodeType 和 modelType 选择。all 中的条件全部满足，any 中的条件至少满足一个；field 可用点路径，例如 data.params.modelType。可用 supports 查询参数是否支持某个值，例如 {field:"parameters.duration",operator:"supports",value:5}。不要猜模型 ID。

选定模型后按 nodeType、modelType（文本节点省略）和 model 精确查询 workflow_get_model_setting。parameters 中的键对应节点 data.params，senoirParameters 中的键对应 data.params.seniorParams；defaultParameters 是默认值。按控件的 choices、min/max/step 等约束组织参数。创建和修改模型节点只填写对应 schema 中声明的字段；工具 schema 描述具体字段和返回结构。

### 批量操作

需要查看全部可用节点时，一次将全部 NodeType 传给 workflow_get_node_definition；仅需几种节点时传所需类型数组。需要多种基础节点模型时，用一个组合 Query 调用 workflow_search_models。比如创建一个图像节点和两个文本节点，可先批量查询 image、text 的节点定义和模型，再按所选模型读取设置，最后把三个 add_node 放在同一次 workflow_apply_workflow_patch 的 operations 中。工具节点没有模型，不要把它们放入 search_models 的 nodeType 条件。

### 修改与运行

优先使用当前工作流摘要中的 id 作为 workflowId；用户给出其他 ID 时，先用 workflow_get_workflow 验证；没有可用工作流则调用 workflow_create_workflow。修改前按需用 workflow_get_workflow 的 summary、structure 或 full 视图读取现状。workflow_apply_workflow_patch 只传 workflowId 和 operations，不要传 dryRun；该工具不支持预检。operations 按顺序原子提交，任一操作失败则不提交。新增节点和连线的 ID 由实现方生成，按操作顺序从 createdNodes/createdEdges 的 id 读取；add_edge 的 source/target 填已有节点 ID。要连接本次新增的节点，先提交节点，再用返回的 ID 提交连线。更新或删除节点、连线时用 id 字段。远端画布尚无端口定义，新增连线须显式提供 sourceHandle 和 targetHandle。模型节点只能修改具名参数；工具节点的参数补丁 set 替换顶层键，unset 删除顶层键。远端画布不支持在同一次提交中同时重命名和修改图结构，需要分别提交。

当前不要调用 workflow_execute_workflow 或 workflow_get_workflow_run；远端画布 API 尚未提供这两个能力。节点的 data.value 保存生成物或预览资源 URL。新建基础节点提供 value 时会写入 data.value 并标记 data.type=upload；更新节点的 value 会写入 data.value。创建节点仍需填写所选模型及对应的 modelType。

### 图片生成

无参考图：确认 image 节点支持 text_to_image；按 nodeType=image、modelType=text_to_image 查询模型和设置；再构造 add_node 操作。

有参考图：先确认 image 节点支持 reference_image_to_image；若不支持，直接说明当前模型能力不足。若参考图是当前工作流节点，先用 workflow_get_node 或 workflow_list_nodes 找到其 id；新图像节点创建成功后，用返回的 id 和参考节点 id 提交 add_edge。若参考图来自工作流外部且已有资源 URL，应将参考图创建为一个带 value 的 image 节点，然后建立连线。工具只保存已有 URL，不负责上传本地文件。`
