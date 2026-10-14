# 插件内契约模块：步骤1–2实施、Review与验收

日期：2026-10-14。以 `desktop-canvas-plugin@0.3.0-alpha.13` 当前源码为基线，完成七工具兼容测试和插件内声明抽取。源码版本仍为 alpha.13；本轮未发包、安装或操作真实账号。此前客户端安装版本及真实账号验收结论不因本次源码提交而改变。

## 结果与范围

- 七工具的名称、完整文案、入参 Schema、超时、注册顺序和字符串输出格式与抽取前一致。
- 新增一个纯数据模块，三个 Host 注册器引用它；七个 execute 函数原文保持一致。
- 共享业务 DTO/parser、v3 SSE/HTTP 桥、Client 服务、原生 Store、保存队列、编辑保护和 UI 均未修改。
- 未合并 Overu 分支、未添加 Shell/Core 协议层、未增加独立协议包，也未扩展生成、模板或 Skill 能力。

开发依据：[实施计划](../plans/2026-10-14-plugin-tool-contracts-phase-1-2-plan.md)、[七工具映射](../plans/2026-10-14-plugin-tool-contracts-map.md)。完整检查记录见 [checks.json](2026-10-14-plugin-tool-contracts-checks.json)。

## Git检查点

开发直接在插件仓库进行；插件与 Shell 均建立本地 `codex/canvas-tool-contracts` 分支。开发前先提交现有工作树，再提交本次改动，未推送远端。

| 仓库 | 提交 | 用途 |
| --- | --- | --- |
| desktop-canvas-plugin | `7965b077613a643813022976cb8effc075a55b9f` | 开发前 alpha.13 快照；保存此前尚未提交的113个文件变更，不属于本次契约抽取差异 |
| desktop-canvas-plugin | `04f002cc912d7167550c8f58aa4be12d773d7f93` | 步骤1：固定 fixture 和两项兼容测试；此时生产代码尚未变更 |
| desktop-canvas-plugin | `a86115cdc277b00bf9fbab656cc42435e7192ec9` | 步骤2：纯声明模块、三处 Host 引用、纯模块测试和 README |
| insight-desktop-shell | `8c900e28502c9c06bd640d6c507c4b85c33453dd` | 开发前文档快照；保存既有专项归档及根 README 改动，共124个文件 |
| insight-desktop-shell | 包含本文件的归档提交 | 本次实施结果、计划完成状态和阅读入口；无 Shell 业务代码改动 |

插件原分支为 `codex/desktop-canvas-plugin-init`，原 HEAD 为 `bd2a7b6`；Shell 原分支为 `main`，原 HEAD 为 `eb4fb89`。快照只记录原有内容，不代表本轮重新审查了所有历史改动；本轮 review 的生产差异基准为插件 `7965b07`。

回滚本次源码抽取、保留兼容测试时，在插件仓库执行：

```sh
git revert --no-edit a86115cdc277b00bf9fbab656cc42435e7192ec9
```

如果连本次新增测试也需撤销，再执行：

```sh
git revert --no-edit 04f002cc912d7167550c8f58aa4be12d773d7f93
```

以上为可用操作说明，本轮未执行回滚；无需撤销开发前快照。Shell 的归档可以保留为历史记录，不影响插件行为。

## 实际文件与职责

| 文件（相对插件仓库） | 本次变更 |
| --- | --- |
| `src/shared/canvas-tool-contracts.ts` | 新增110行；仅导出 canvasToolContracts 和 canvasToolOutputSchema，内部复用放置/变化字段常量；无 import、执行函数或副作用 |
| `src/host/canvas-tools.ts` | create/get/node_edit 展开对应声明；输出 Schema 引用公共常量；移除迁出的声明常量 |
| `src/host/canvas-graph-tools.ts` | edges/models 展开对应声明 |
| `src/host/canvas-asset-tools.ts` | assets/asset_import 展开声明；移除旧放置常量 import；共用输出 Schema |
| `test/canvas-tool-contracts.test.mjs` | 新增3项：完整目录冻结、字符串 renderer、纯模块独立构建 |
| `test/fixtures/canvas-tool-contracts.alpha13.json` | 从抽取前已归档的完整目录复制；包含七工具声明、注册顺序及23份源哈希，不从新模块生成期望值 |
| `README.md` | 补充声明维护位置、契约与运行时责任、fixture 变更要求 |

工具入口仍在原 Host：create/get/node_edit → registerCanvasTools，edges/models → registerCanvasGraphTools，assets/asset_import → registerCanvasAssetTools。新模块不接管注册、鉴权、请求关联、调用缓存、上传、连线判断或保存。

## 验收结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 整理前源基线 | 23/23哈希相等，版本为alpha.13 | 编码前核对冻结目录 |
| 步骤1：新增兼容测试及三组既有工具测试 | 38/38通过 | [整理前定向日志](evidence/2026-10-14-tool-contracts-before.tap) |
| 步骤2：增加纯模块测试后的定向检查 | 39/39通过 | [整理后定向日志](evidence/2026-10-14-tool-contracts-after.tap) |
| 插件全部测试 | 176/176通过，0失败/跳过 | [全量日志](evidence/2026-10-14-tool-contracts-full.tap) |
| 插件默认 SDK 类型检查 | 通过，0诊断 | checks.types.plugin |
| Shell 实际 Core SDK 类型检查 | 通过，0诊断；临时 tsconfig 指向现有 Core | checks.types.actualShellCore |
| Host 构建 | 通过，0 warning/error；确认新模块进入 bundle | checks.hostBuild；仅输出临时目录 |
| 七工具完整目录 | 与整理前固定 fixture 完全相等 | 新兼容测试 |
| 业务函数差异 | 7个 execute 原文一致；剔除声明迁移后，3个 Host 文件规范化 AST 相等 | checks.review.hostResults |
| 未变边界 | 其余20份基线文件哈希相等；Git 差异只含上表7个文件 | checks.review |
| 差异格式检查 | git diff --check通过 | 最终差异检查 |

全量测试首次在受限沙箱运行时，174项通过，2项因 `listen EPERM: operation not permitted 127.0.0.1` 失败，分别是 Host 本地 HTTP/SSE 与 Client SSE/POST 测试。获得本地监听权限后按原命令重跑，176项全部通过。未修改测试、跳过用例或改业务代码来处理环境限制。

### 计划验收项对应

| 编号 | 结果与覆盖 |
| --- | --- |
| C01 | 通过：七工具全部字段、描述、超时、注册顺序和嵌套 Schema 与固定目录深比较相等 |
| C02 | 通过：输出仍为 string；renderer原样返回text，不双重编码 |
| C03 | 通过：复用summary旧输出及无需Agent/Client上下文的既有测试 |
| C04 | 通过：节点/边/模型读取与写入的payload、版本、请求ID、signal及分页既有测试 |
| C05 | 通过：无效分支、裸position、危险配置和伪造routing在原检查层拒绝，未提前调用桥/上传 |
| C06 | 通过：saved/unknown/rejected、真实ID/版本、warnings及边ID保持既有处理 |
| C07 | 通过：上传复用、身份变化、多产物needs_input、保存/登记分离和同call去重既有测试 |
| C08 | 通过：alpha.13的confirmed普通读取、node.changes示例和失败停步文案保留 |
| C09 | 通过：纯模块浏览器构建仅一个输入文件，无Host/SDK/Store运行时依赖 |
| C10 | 通过：3份Host业务逻辑相等；其余20份源基线不变；Client/Web/协议等未修改 |
| C11 | 通过：默认及实际Core类型检查、Host bundle均成功 |

## Review结论

由当前任务完成最终差异人工审查，并结合目录对比、源码哈希、TypeScript AST 比较和回归测试。未发现需要修复的本次引入问题；没有另派代理进行独立 review。

审查重点及判断：

1. **契约只有一个维护位置。** 参数声明迁出后，Host 只引用对应成员，保留原有7个独立注册调用；没有通用分发器、第二套parser或类型断言逃避SDK检查。
2. **没有把协议整理变成业务改造。** 输入裁剪、版本检查、鉴权、上传与回执缓存、异常分类、去重及信号传递均保持原逻辑；新模块只含静态数据。SDK仍投影并校验原有ParameterSchemaSpec。
3. **兼容测试的期望值独立。** fixture在移动生产声明前落地且通过；整理后未改fixture和旧行为测试的预期，避免“新实现与新期望一起出错”。
4. **原生与通信路径保留。** 未触碰v3桥、原生Store/保存队列或UI；本地HTTP/SSE回归通过。字符串输出、summary旧格式及条件字段校验时机仍按当前契约保留。

当前仍使用JSON字符串输出及原有分层检查，这是本次明确保留的兼容边界。未来结构化对象输出、判别入参、能力目录等应作为独立行为变更评审，不能从本次完成状态推断其已经实现。

## 未执行与后续验收

本轮未重跑Web全量测试，因为没有Web源码变化；未完整重建插件、修改版本号、生成tgz、发包、安装、合并分支或推送远端。Host构建只写入临时目录，没有覆盖既有lib或已安装插件。

真实账号 M01–M06 仍为 **pending**，待后续明确交付安装时按[计划中的最小人工冒烟](../plans/2026-10-14-plugin-tool-contracts-phase-1-2-plan.md#七交付后的最小人工冒烟后续安装时执行)执行。本次结论是“源码抽取及自动兼容验收完成”，不是“已安装或已通过真实账号验证”。
