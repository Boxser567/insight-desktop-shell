# 工作流工具协议

本包只定义工作流工具的类型、运行时校验、Agent 可见的描述和 `WorkflowBackend` 接口，不依赖 Harness、Electron 或具体 API 实现。后端提供工具执行、当前已知工作流摘要和能力提示。当前 Harness 插件仍在 `../insight-workflow-op/`，其中的 mock、skill 和 dsh Schema 投影不属于协议包。

维护契约时，以 `src/workflow-agent-tools.type.ts` 中的 `WorkflowToolContracts` 为类型源，同步修改 `src/workflow-schemas.ts` 的 Zod schema 和工具描述。类型检查核对输入、输出的双向兼容性；运行时测试覆盖典型请求和拒绝无效请求。
