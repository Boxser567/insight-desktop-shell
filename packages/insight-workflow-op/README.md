# 工作流操作插件

这个插件为 dsh 注册 `insight-workflow` 内置 skill 和 `workflow_*` 工具。默认后端通过 `createCanvasApi()` 访问远端画布；调用时通过现有私有通道取得当前登录令牌。画布 API 暂无工作流执行与运行查询接口，相关工具会明确报错。远端画布读取、查询和补丁逻辑位于 `remote-workflow.ts`。测试环境的模型配置从 CDN 获取，生产环境沿用画布服务接口。

调用方在插件清理时应调用 `dispose()`，以中止尚未结束的请求。

## 协议维护规范

1. 工作流工具契约位于 [`../insight-workflow-protocol/`](../insight-workflow-protocol/)；修改工具、字段或领域类型时，先更新协议包的类型和 Zod schema。
2. 本插件的 [`src/dsh-schema.ts`](src/dsh-schema.ts) 仅将协议 Schema 投影成 dsh 支持的 JSON Schema；远端工具执行由 [`src/remote-workflow.ts`](src/remote-workflow.ts) 负责。
3. 同步 [`src/remote-workflow.ts`](src/remote-workflow.ts) 的远端实现、[`src/workflow-skill.ts`](src/workflow-skill.ts) 的 Agent 操作指导，以及测试。当前没有自动从 TypeScript 类型生成 Zod schema 的步骤，因此只改类型文件不会更新运行时契约。
4. 类型文件保留数据结构及字段语义；调用顺序、场景示例和批量调用策略放在 skill 中。README 记录维护约定，避免把操作步骤重复写进类型注释。

## Agent 调用约定

- 优先使用当前会话的工作流 ID；没有可用工作流时调用 `workflow_create_workflow`。修改前按需读取当前结构，选定模型后读取参数设置，再用 `workflow_apply_workflow_patch` 原子提交。
- `workflow_get_node_definition` 的 `nodeType` 可传一个类型或类型数组，`nodeDefinitions` 总是数组。查询全部可用节点时一次传入全部 `NodeType`；查询部分节点时传所需类型即可。
- `workflow_search_models` 单类查询在 `query.filters.all` 中使用 `nodeType eq`，非文本类还需 `modelType eq`。批量发现多种基础节点模型时使用 `nodeType in`，例如 `value: ["image", "text"]`，再按返回的类型与能力选择模型。工具节点没有模型。
- 一次创建多个节点时，把多个 `add_node` 放入同一个 `workflow_apply_workflow_patch.operations`。实现方生成节点 ID 并按操作顺序返回在 `createdNodes[].id`；需要连接新节点时，取得 ID 后再提交 `add_edge`。连线 ID 同样由实现方生成并返回在 `createdEdges[].id`；远端实现根据源节点和目标节点类型填充端口名。任一操作失败则整批不提交。远端画布不支持在一次提交中同时重命名和修改图结构，需要分别提交。
- 无参考图生成图片时，确认 `image` 支持 `text_to_image`，查询对应模型和设置，再新增图像节点。有参考图时，先确认 `reference_image_to_image` 能力；工作流内参考节点可用 `get_node` 或 `list_nodes` 定位并连线。当前工具不能导入外部参考图。

这些 Agent 步骤的运行时版本维护在 [`src/workflow-skill.ts`](src/workflow-skill.ts)，应与工具 schema 和远端能力保持一致。
