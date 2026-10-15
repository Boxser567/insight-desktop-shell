# 工作流 Agent 工具调用用例

用这些请求观察 Agent 是否识别画布意图、选择合适的工具，并按工作流协议构造参数。逐条在新的会话中运行，避免上一条用例留下的工作流上下文影响结果。记录实际工具名、入参、返回结果和最终答复。

## 统一模拟数据

除特别说明外，系统上下文提供当前工作流摘要：`{"id":"wf-42","name":"当前画布","nodeCount":1,"edgeCount":0}`。

测试环境的工具返回以下 ID，Agent 只能在收到对应结果后使用它们：

| 工具结果 | 测试值 |
| --- | --- |
| `workflow_search_models`：文生图模型 | `img-t2i-1`，`nodeType=image`，`modelType=text_to_image` |
| `workflow_search_models`：参考图生图模型 | `img-ref-1`，`nodeType=image`，`modelType=reference_image_to_image` |
| `workflow_search_models`：文本模型 | `txt-1`，`nodeType=text` |
| `workflow_search_models`：文生视频模型 | `vid-1`，`nodeType=video`，`modelType=text_to_video` |
| `workflow_get_node`：现有参考图 | `id=source-image-1`，`type=image` |
| 首次 `workflow_apply_workflow_patch`：新增节点 | `createdNodes[0].id=new-image-1` |

`workflow_get_node_definition` 的正常返回包含所查询的 `supportedModelTypes`；`workflow_get_model_setting` 返回与上述模型一致的设置。下面写的是关键调用和必要字段，允许为了读取现状而额外调用 `workflow_get_workflow`。所有 `workflow_apply_workflow_patch` 调用都应检查 `applied` 和 `errors`，不能仅凭工具调用成功宣称已保存。

## 1. 当前画布添加文生图节点

**用户请求：**「在当前画布加一个文生图节点，提示词是『雨夜的上海街道，电影感』。」

**预期调用：**

1. `workflow_get_node_definition`：`{"nodeType":"image"}`。
2. `workflow_search_models`：`query.filters.all` 同时包含 `nodeType eq image` 和 `modelType eq text_to_image`。
3. `workflow_get_model_setting`：`query.filters.all` 同时包含 `nodeType eq image`、`modelType eq text_to_image`、`model eq img-t2i-1`。
4. `workflow_apply_workflow_patch`：

   ```json
   {"workflowId":"wf-42","operations":[{"op":"add_node","node":{"type":"image","model":"img-t2i-1","modelType":"text_to_image","prompt":"雨夜的上海街道，电影感"}}]}
   ```

**判定重点：**使用当前工作流 ID；不猜模型 ID；`add_node` 不传节点 ID；不调用执行工具，也不声称图片已经生成。

## 2. 新建画布并批量添加三种节点

**前置条件：**没有当前工作流摘要。

**用户请求：**「新建『产品灵感』画布，放一个图像节点和两个文本节点。图像提示词是『极简台灯』；两个文本提示词分别是『写一句标题』和『写三条卖点』。」

**预期调用：**

1. `workflow_create_workflow`：`{"name":"产品灵感"}`，后续使用返回的 `workflow.id`，这里假设为 `wf-new-1`。
2. 一次 `workflow_get_node_definition`：`{"nodeType":["image","text"]}`。
3. 一次 `workflow_search_models`：`query.filters.all` 包含 `{"field":"nodeType","operator":"in","value":["image","text"]}`；从结果中分别选择模型。
4. 分别调用 `workflow_get_model_setting`，精确查询所选图像、文本模型。文本模型的查询不带 `modelType`。
5. 一次 `workflow_apply_workflow_patch`，三个 `add_node` 放入同一 `operations`：

   ```json
   {"workflowId":"wf-new-1","operations":[{"op":"add_node","node":{"type":"image","model":"img-t2i-1","modelType":"text_to_image","prompt":"极简台灯"}},{"op":"add_node","node":{"type":"text","model":"txt-1","prompt":"写一句标题"}},{"op":"add_node","node":{"type":"text","model":"txt-1","prompt":"写三条卖点"}}]}
   ```

**判定重点：**模型发现调用能批量；三个节点一次提交；文本节点不填 `modelType`；不为工具节点查询模型。

## 3. 使用当前画布的参考图

**用户请求：**「用当前画布的 `source-image-1` 作为参考图，再加一个图像节点，提示词是『改成水彩风格』。」

**预期调用：**先用 `workflow_get_node` 验证参考节点；确认 image 支持 `reference_image_to_image`；按 `nodeType=image`、`modelType=reference_image_to_image` 搜索模型，并按 `model=img-ref-1` 读取设置。随后分两次提交：

```json
{"workflowId":"wf-42","operations":[{"op":"add_node","node":{"type":"image","model":"img-ref-1","modelType":"reference_image_to_image","prompt":"改成水彩风格"}}]}
```

```json
{"workflowId":"wf-42","operations":[{"op":"add_edge","source":"source-image-1","target":"new-image-1"}]}
```

**判定重点：**第二次提交必须等待第一次返回 `createdNodes[0].id`；不能预先编造 `new-image-1`。端口名由实现方根据节点类型填充。

## 4. 使用外部 URL 作为参考图

**用户请求：**「用 `https://example.com/reference.png` 做参考图，在当前画布增加一张水彩风格图片。」

**预期调用：**确认 image 支持 `reference_image_to_image`；查询并选定 `img-ref-1` 及其设置。先在一次 patch 中创建带 `value` 的参考图节点和新图像节点：

```json
{"workflowId":"wf-42","operations":[{"op":"add_node","node":{"type":"image","model":"img-ref-1","modelType":"reference_image_to_image","value":"https://example.com/reference.png"}},{"op":"add_node","node":{"type":"image","model":"img-ref-1","modelType":"reference_image_to_image","prompt":"水彩风格"}}]}
```

假设返回的 `createdNodes` 依次是 `ref-upload-1`、`new-image-1`，再提交：

```json
{"workflowId":"wf-42","operations":[{"op":"add_edge","source":"ref-upload-1","target":"new-image-1"}]}
```

**判定重点：**把 URL 放在节点的 `value`，不放进 `data.value` 或 `parameters`；不调用本地文件上传；不在同一次 patch 中引用尚未返回的节点 ID。

## 5. 指定其他工作流并修改现有视频节点

**前置条件：**当前摘要仍指向 `wf-42`；`workflow_get_workflow` 查询 `wf-99` 成功；`workflow_get_node` 返回 `id=video-1`、`type=video`、`model=vid-1`、`modelType=text_to_video`；模型设置允许 `duration=5`。

**用户请求：**「把工作流 `wf-99` 中 `video-1` 的时长改成 5 秒。」

**预期调用：**先用 `workflow_get_workflow` 验证 `wf-99`，读取 `video-1` 及 `vid-1` 的模型设置，再提交：

```json
{"workflowId":"wf-99","operations":[{"op":"update_node","id":"video-1","changes":{"type":"video","duration":5}}]}
```

**判定重点：**不误改 `wf-42`；时长为数字 `5`；`update_node` 使用 `id` 和带 `type` 的 `changes`，不重新创建节点。

## 6. 不支持的参考图生成方式

**前置条件：**`workflow_get_node_definition` 对 image 仅返回 `supportedModelTypes=["text_to_image"]`。

**用户请求：**「用当前画布的产品图做参考，再加一个参考图生图节点。」

**预期行为：**调用 `workflow_get_node_definition` 后说明当前能力不足；不搜索不存在的参考图模型，也不提交 patch。

## 7. 请求执行工作流

**用户请求：**「运行当前工作流，并告诉我最终生成的图片 URL。」

**预期行为：**明确当前不能执行或查询运行结果；不调用 `workflow_execute_workflow`、`workflow_get_workflow_run`，也不编造产物 URL。

## 记录结果

每条用例分别记录：意图是否正确、工具顺序是否正确、关键参数是否符合 `workflowSchemas[工具名].input`、是否使用真实返回的 ID、是否遵守当前限制。将问题分成 **意图识别错误**、**调用顺序错误**、**参数不符合 schema** 和 **skill 指引不足** 四类。

当前 skill 的“单类模型查询”文字未明确写出图像、视频、音频还需 `modelType eq`，而 `modelQuery` schema 要求它；用例 1 和 3 专门检查 Agent 能否从工具 schema 补齐这一条件。含参考图的连线还依赖端口名；用例 3 和 4 在用户请求中明确给出端口，以便单独测试节点引用和两次提交。
