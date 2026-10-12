export const workflowSkillContent = `# 工作流操作

当前画布 API 尚未接通：工作流只保存在当前客户端进程中，运行状态和媒体结果都是 mock。不要声称已生成真实文件；进程重启后若找不到旧工作流，应提示重新创建。

## 发现节点和模型

基础节点有 text、image、audio、video；工具节点有 poseTool、highDefinitionTool。先调用 workflow_get_node_definition 确认节点类型及 supportedModelTypes。图像方式有 text_to_image、reference_image_to_image；视频方式有 first_last_frame_to_video、image_to_video、reference_image_to_video、text_to_video；音频方式有 tts、text_to_audio、audio_to_audio。当前 mock 实际可用方式以工具查询结果为准。

模型查询使用 workflow_search_models 的 query.filters.all：必须包含 {field:"nodeType",operator:"eq",value:"image"} 这样的节点类型条件；图像、视频、音频还需包含 modelType 条件。all 中的条件全部满足，any 中的条件至少满足一个；field 可用点路径，例如 data.params.modelType。可用 supports 查询参数是否支持某个值，例如 {field:"parameters.duration",operator:"supports",value:5}。不要猜模型 ID。

选定模型后调用 workflow_get_model_setting。parameters 中的键对应节点 data.params，senoirParameters 中的键对应 data.params.seniorParams；defaultParameters 是默认值。按控件的 choices、min/max/step 等约束组织参数。创建节点只能填写 add_node.node schema 中的字段；没有对应创建字段的普通模型参数，可在后续 update_node 中用 additionalParameters.set 设置。工具 schema 描述具体字段和返回结构。

## 修改与运行

优先使用当前工作流摘要中的 id 作为 workflowId；用户给出其他 ID 时，先用 workflow_get_workflow 验证；没有可用工作流则调用 workflow_create_workflow。修改前按需用 workflow_get_workflow 的 summary、structure 或 full 视图读取现状。用 workflow_apply_workflow_patch 的 operations 按顺序原子提交，任一操作失败则不提交。add_node 的 clientId 是本批次临时引用；后续 add_edge 可用 {kind:"created",clientId:"..."} 引用它，已有节点用 {kind:"existing",nodeId:"..."}。当前 mock 的连线端口省略时分别使用 output/input。永久 ID 从 createdNodes/createdEdges 读取。更新节点时只提交要改的字段；参数补丁 set 替换顶层键，unset 删除顶层键。

提交后可调用 workflow_execute_workflow，并用 workflow_get_workflow_run 查询模拟状态。工具返回 mock=true 时，告知用户尚未生成真实媒体。

## 图片生成示例

无参考图：确认 image 节点支持 text_to_image；按 nodeType=image、modelType=text_to_image 查询模型和设置；再构造 add_node 操作。

有参考图：先确认 image 节点支持 reference_image_to_image；若不支持，直接说明当前模型能力不足。若参考图是当前工作流节点，先用 workflow_get_node 或 workflow_list_nodes 找到 nodeId，再将新图像节点与参考节点用 add_edge 连接。若参考图来自工作流外部，当前 mock 不能导入，应明确说明这一限制。`
