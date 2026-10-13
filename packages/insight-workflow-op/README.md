# 工作流操作插件

这个插件为 dsh 注册 `insight-workflow` 内置 skill 和 `workflow_*` 工具。当前画布 API 尚未接通，工具使用进程内 mock 数据；执行结果不代表真实媒体已生成。

## 协议维护规范

1. 以 [`src/workflow-agent-tools.type.ts`](src/workflow-agent-tools.type.ts) 作为工作流操作协议的类型源文件。变更工具、字段或领域类型时，先修改这里；每个工具都在 `WorkflowToolContracts` 中用明确的 `input` 和 `output` 类型声明，不用泛型入参或无说明的 `any`。
2. 同步 [`src/workflow-schemas.ts`](src/workflow-schemas.ts) 中对应的 Zod schema，为方法、每个入参及返回字段写明用途、取值和必要的调用前提。Zod 负责运行时校验，并投影成 dsh 支持的 JSON Schema，供 Agent 组织工具调用。
3. 同步 [`src/index.ts`](src/index.ts) 的工具实现和描述、[`src/workflow-skill.ts`](src/workflow-skill.ts) 的 Agent 操作指导，以及 mock 和测试。当前没有自动从 TypeScript 类型生成 Zod schema 的步骤，因此只改类型文件不会更新运行时契约。
4. 类型文件保留数据结构及字段语义；调用顺序、场景示例和批量调用策略放在 skill 中。README 记录维护约定，避免把操作步骤重复写进类型注释。

## Agent 调用约定

- 优先使用当前会话的工作流 ID；没有可用工作流时调用 `workflow_create_workflow`。修改前按需读取当前结构，选定模型后读取参数设置，再用 `workflow_apply_workflow_patch` 原子提交。
- `workflow_get_node_definition` 的 `nodeType` 可传一个类型或类型数组，`nodeDefinitions` 总是数组。查询全部可用节点时一次传入全部 `NodeType`；查询部分节点时传所需类型即可。
- `workflow_search_models` 单类查询在 `query.filters.all` 中使用 `nodeType eq`，非文本类还需 `modelType eq`。批量发现多种基础节点模型时使用 `nodeType in`，例如 `value: ["image", "text"]`，再按返回的类型与能力选择模型。工具节点没有模型。
- 一次创建多个节点时，把多个 `add_node` 放入同一个 `workflow_apply_workflow_patch.operations`。需要连线时，在同一批次后续 `add_edge` 中通过 `clientId` 引用新节点；任一操作失败则整批不提交。
- 无参考图生成图片时，确认 `image` 支持 `text_to_image`，查询对应模型和设置，再新增图像节点。有参考图时，先确认 `reference_image_to_image` 能力；工作流内参考节点可用 `get_node` 或 `list_nodes` 定位并连线。当前 mock 不支持导入外部参考图，且目前没有可用的参考图模型，应向用户说明。

这些 Agent 步骤的运行时版本维护在 [`src/workflow-skill.ts`](src/workflow-skill.ts)，应与工具 schema 和 mock 能力保持一致。
