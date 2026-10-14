# 插件内独立契约模块：步骤 1–2 Implementation Plan

> 状态更新（2026-10-14）：用户后续已授权编码，步骤1–2已完成，C01–C11通过；结果见[实施、Review与验收归档](../implementation/2026-10-14-plugin-tool-contracts.md)。插件开发前快照7965b07，测试提交04f002c，抽取提交a86115c。未合并 Overu 分支、发包、安装或操作真实账号；M01–M06仍待后续安装时执行。

**Goal:** 将现有七工具的公开声明集中到插件内纯数据模块，保持输入、输出、校验顺序、调用链与原生行为等价。

**Architecture:** 公开工具声明归插件 `src/shared/canvas-tool-contracts.ts`；三处 Host 注册器引用声明，继续执行原有函数。业务 DTO/parser、v3 通信、Client 服务、原生 Store 与持久化队列均保持原位。新模块与插件一起构建交付，本期不发布独立协议包。

**Tech Stack:** 现有 TypeScript 5.9.2、Harness `defineTool`、Node test runner、tsx、esbuild；不新增依赖、不引入 Zod、不升级 SDK。

## 全局约束

- 用户已确认插件内独立契约模块；本期范围仅“七工具映射”和“公共声明等价集中”。
- 以当前 alpha.13 源码为开发基线，保留冷上下文、配置故障、刷新指导修复；不退回 alpha.12。实际客户端安装版本与源码版本分开记录。
- 保持七个工具名称、注册顺序、字段路径、默认值、描述文案、Schema、超时、JSON 字符串返回及 renderer。
- 后端不改；原生 UI、Client 运行方式、SSE/HTTP 通信、Store/队列、生成监听不改；关闭画布视图仍可通过既有服务工作。
- 不做结构化对象输出、action 判别 Schema 改造、新能力目录、批量 patch、生成、模板、完整版 Skill、会话恢复或业务参数扩展。
- 不把内部 position 暴露为公共字段，不改 node.changes，不新增 requestId/sessionId 等模型输入。
- 不升级桥版本，不增加第二个写入器，不把新协议或工具注册移入 Shell/Core，不增加分发/内置发布改动。
- 保留既有未提交改动；检查只覆盖本任务差异，不清理其他文件，不用类型断言掩盖 SDK 不兼容。

## 阅读与交付文件

1. [七工具契约映射](2026-10-14-plugin-tool-contracts-map.md)：逐分支输入、结果形态、原生命令/方法、失败边界。
2. [冻结工具目录与源哈希](../preflight/2026-10-14-canvas-tool-contracts-baseline.json)：本轮从当前注册器实际采集的完整模型可见 Schema、文案、超时、顺序、输出 Schema；23份源文件哈希。
3. [完整声明提取参考](2026-10-14-plugin-tool-contracts-reference/canvas-tool-contracts.ts.txt)：从当前三份源文件 AST 提取的七工具声明和共用参数常量，可在编码阶段复制为新增模块。
4. [完整兼容测试参考](2026-10-14-plugin-tool-contracts-reference/canvas-tool-contracts.test.mjs.txt)：编码阶段复制到插件 test 目录，固定整理前目录和字符串渲染行为。

两个 `.txt` 保留为计划编写时的审阅参考；后续已按计划在插件内落地源码和测试，实际实现以插件提交为准。原冻结目录只注册工具，未调用 execute，业务 API 调用为0。

## 一、文件边界

插件根目录：`/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`。

| 文件 | 操作 | 责任和修改范围 |
| --- | --- | --- |
| `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/shared/canvas-tool-contracts.ts` | 新增 | 七工具 name/description/timeoutMs/parameters，以及共用字符串输出 Schema；纯数据，无执行/鉴权/网络/Store |
| [canvas-tools.ts](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-tools.ts>) | 修改 | 三工具引用新声明；迁出参数常量；输出 schema 引用新常量，renderer 和 execute 原样保留 |
| [canvas-graph-tools.ts](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-graph-tools.ts>) | 修改 | edges/models 引用新声明；execute、错误处理、桥调用原样保留 |
| [canvas-asset-tools.ts](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-asset-tools.ts>) | 修改 | assets/import 引用新声明；移除 nodePlacementParameterSpec 的旧 Host import；输出 schema 引用新常量；parseArgs/importImage/cache 原样保留 |
| `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/test/canvas-tool-contracts.test.mjs` | 新增 | 七工具已注册 Schema 与整理前基线相等；文本 renderer 不变；步骤2补纯模块构建检查 |
| `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/test/fixtures/canvas-tool-contracts.alpha13.json` | 新增 | 复制已冻结基线，不在测试运行中重新生成期望值 |
| [插件 README](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/README.md>) | 修改文档 | 只增加契约维护位置与先改基线评审、再改行为的说明；不宣称新增能力 |

现有测试 `canvas-tools.test.mjs`、`canvas-graph-tools.test.mjs`、`canvas-asset-tools.test.mjs` 直接复用，不因源码移动重写预期。只有实际执行时发现覆盖缺口才补具体用例，不复制已有的每项行为测试。

**明确不修改：** `canvas-agent-protocol.ts`、`canvas-bridge-protocol.ts`、`canvas-service-runtime.ts`、`protocol.ts`、`src/host/index.ts`、`src/host/canvas-bridge.ts`、`src/client/**`、`canvas-app/**`、业务 API/素材 SDK 文件、package/lock/exports/build 脚本、Shell/Core 业务文件。当前 Host 构建本来会 bundle 导入模块，无需为新模块改发布逻辑。

## 二、目标模块接口与依赖

新增模块只有两个公开值：

```ts
export const canvasToolOutputSchema = { type: 'string' } as const

// 各成员均为 { name, timeoutMs, description, parameters }；键为现有工具名。
// 完整实现见同目录参考文本，不含任何 execute 或 render 函数。
export const canvasToolContracts = {
  canvas_create: {
    name: 'canvas_create',
    timeoutMs: 90000,
    description: '创建空画布并准备当前对话的画布服务，无需打开画布。名称可省略，默认新画布。只创建，不生成素材。created即已有真实画布ID；runtime:not_ready时保留该ID，待服务恢复后操作同画布，勿重建。create_unknown时先核对画布列表，不能自动重试。',
    parameters: { name: { type: 'string', description: '可选画布名称，1–100字符。' } },
  },
} as const
```

上面仅展示 create 的完整接口样例；**开发使用包含全部七工具的[完整参考文本](2026-10-14-plugin-tool-contracts-reference/canvas-tool-contracts.ts.txt)**，不能只交付示例一项。

模块内部保留 `nodePlacementParameterSpec`、`parameterValues`、`nodeChangesParameterSpec` 三个共用常量，供声明复用；不再从 Host 导出。现有业务类型及返回定义继续引用其现有文件，不为了凑齐七份类型另外复制 DTO；素材的局部类型本期也不迁移。

这里保存的是当前 Harness ParameterSchemaSpec 形式的纯数据，例如属性上的 `required:true`；**不是完整标准 JSON Schema，也不是新增的通用协议框架**。新模块不 import Harness；Host 中原有 `defineTool` 继续负责投影和类型检查。不得把 required 改成另一种语法、给开放根对象补 additionalProperties:false，或引入额外 parser。

## 三、步骤 1：固定七工具映射与整理前验收基线

**目标：** 开发者能追踪每个字段从 Agent 到原生方法；有独立于新模块的旧行为基线，防止整理后“测试跟着新实现一起变”。此步先不移动生产声明。

**输入：** 三个既有注册器、共享 parser、七工具映射文档、alpha.13 目录基线。

**输出：** 插件内固定 fixture + 两项目录/渲染兼容测试；基线差异清单必须为空，或在编码前明确记录新的合法基线。

- [x] **1.1 检查源基线。** 按冻结 JSON 的 sourceSha256 核对实际源码。若期间已有其他功能修改，先逐项更新映射与基线，不把新差异当作本次可顺手修复的内容。保护用户已有工作。
- [x] **1.2 阅读映射。** 逐项核对3种 get view、4种 node action、4种 edge action、2种 import source；确认 summary 无 Agent 例外、nodeIds 去重、SDK 与 Host 双错误通道。
- [x] **1.3 添加 fixture 和两项测试。** 从本计划参考复制到上表两个目标位置。fixture 必须来源于整理前捕获，不能从新模块导入常量生成期望值。
- [x] **1.4 运行兼容测试和已有三个工具测试。** 此处属于行为刻画，整理前就应通过，不人为制造失败。
- [x] **1.5 检查本步差异。** 除 fixture/test 外没有生产文件变更，记录实际测试结果；通过后才进入步骤2。

执行目录为插件根目录，使用工作区实际 Node：

```sh
TASK_NODE=/Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/node/bin/node
"$TASK_NODE" --import tsx --test test/canvas-tool-contracts.test.mjs test/canvas-tools.test.mjs test/canvas-graph-tools.test.mjs test/canvas-asset-tools.test.mjs
```

**验收：** 注册恰好七项、顺序不变，所有描述/嵌套 Schema/超时/输出 Schema 深比较相等，renderer 原样返回 JSON 字符串；注册过程没有 API/桥业务调用；现有工具测试通过。若失败是原有问题，先记录阻断原因，不能自动修改旧 fixture 掩盖。

## 四、步骤 2：集中公共声明，接回原有 Host 注册器

**目标：** 每个工具声明只维护一处；Host 保留实际调用、校验和状态逻辑。所有模型可见信息与步骤1完全相等。

**输入：** 步骤1通过的固定基线、完整七项声明参考。

**输出：** 一个新共享模块，三处 Host 引用；无新业务命令、无第二套模型 Schema、无新的运行时服务。

- [x] **2.1 新增纯数据模块。** 将完整声明参考复制到 `src/shared/canvas-tool-contracts.ts`。不增加 import、副作用、环境判断、动态可用模型值、SDK 注册或缓存。
- [x] **2.2 修改基础工具注册。** 在 canvas-tools.ts 引入两个导出，将三个 defineTool 的 name/timeoutMs/description/parameters 原地替换成对应成员展开；保留同一个 output 变量及 execute 代码。删除已迁出的三个旧参数常量。

```ts
import { canvasToolContracts, canvasToolOutputSchema } from '../shared/canvas-tool-contracts'

export const canvasToolOutput = {
  schema: canvasToolOutputSchema,
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}
const output = canvasToolOutput
```

create 注册修改后的完整形态：

```ts
ctx.tools.register(defineTool({
  ...canvasToolContracts.canvas_create,
  output,
  async execute(input, exec) {
    const request = requestId('canvas_create', exec)
    try { const args = argumentsObject(input, ['name']); return JSON.stringify(await create(canvasName(args.name), exec, request)) }
    catch (cause) { return JSON.stringify(reject(request, cause)) }
  },
}))
```

get/node_edit 只将相同四项元数据替换为 `...canvasToolContracts.canvas_get` / `...canvasToolContracts.canvas_node_edit`，对应 execute 整块从旧代码原样保留。不要把三项注册改成通用循环，否则会引入不必要的类型/执行映射。

- [x] **2.3 修改图工具注册。** import canvasToolContracts；分别用 `...canvasToolContracts.canvas_edges` 和 `...canvasToolContracts.canvas_models` 替换四项声明。仍用原 canvasToolOutput；不改 action→operation 构造、分页、配置、dispatchCanvasWrite 或结果拼装。
- [x] **2.4 修改素材工具注册。** import 两个导出；移除旧 nodePlacementParameterSpec import；assets/import 分别展开对应成员。仅将本地 output.schema 改为 canvasToolOutputSchema，renderer 不动。完整保留 parseArgs、importImage、上传/回执缓存及调用顺序。
- [x] **2.5 增加纯模块检查。** 在新测试文件追加下列测试；它验证新模块可被浏览器单独构建，且没有引入 Host/SDK/Store 依赖，不增加新的业务模拟。

```js
test('public tool contract data has no runtime dependency or Host import', async () => {
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const entry = fileURLToPath(new URL('../src/shared/canvas-tool-contracts.ts', import.meta.url))
  const result = await build({
    entryPoints: [entry], bundle: true, write: false,
    platform: 'browser', format: 'esm', metafile: true,
  })
  const inputs = Object.keys(result.metafile.inputs)
  assert.equal(inputs.length, 1)
  assert(inputs[0].endsWith('src/shared/canvas-tool-contracts.ts'))
  assert.equal(result.outputFiles.length, 1)
})
```

- [x] **2.6 执行等价校验。** 先跑步骤1命令，再跑插件全部测试和 Host 类型检查。SDK 参数推导若不兼容，修正 const/导入使用方式；不能用 any 跳过检查，也不能修改契约内容迎合类型报错。
- [x] **2.7 验证实际 Core 类型与 Host 构建。** 使用下节命令；产物放临时目录，不覆盖已打包文件、不安装客户端。新模块自动被 Host bundle 包含。
- [x] **2.8 更新插件 README、归档和 review。** README 只说明声明位置、现有业务 parser 与桥仍是原边界；审查三个 execute/素材流水线均未变化、七项声明没有第二份。记录检查结果与未做的手测，不把计划中的预期写成已通过。

**验收：** 新模块两个导出由三个 Host 文件消费；七工具目录与冻结 fixture 完全一致，实际输出仍为 string；原生方法/通信/错误/重试/权限行为不变；未改变列表以源码差异核对。

## 五、验证命令与范围

以下命令已在实施阶段执行：插件全量176项通过，默认/实际Core类型检查通过，Host构建只输出临时目录。首次受限环境的两项本地监听EPERM及完整重跑结果见验收归档；未完整重建或打包插件。

在插件根目录：

```sh
TASK_NODE=/Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/node/bin/node
"$TASK_NODE" --import tsx --test test/*.test.mjs
"$TASK_NODE" node_modules/typescript/bin/tsc --noEmit
```

实际 Shell Core 的类型检查：下列配置仅写到临时目录，避免修改项目 tsconfig。

```sh
"$TASK_NODE" --input-type=module <<'JS'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const plugin = '/Users/boxser.shi/Documents/harness/desktop-canvas-plugin'
const runtime = '/Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules'
const directory = mkdtempSync('/private/tmp/canvas-contract-types-')
const config = directory + '/tsconfig.json'
writeFileSync(config, JSON.stringify({
  extends: plugin + '/tsconfig.json',
  compilerOptions: {
    baseUrl: plugin,
    paths: { '@deepseek-ai/*': [runtime + '/@deepseek-ai/*'] },
    typeRoots: [plugin + '/node_modules/@types'],
  },
}, null, 2))
const result = spawnSync(process.execPath, [plugin + '/node_modules/typescript/bin/tsc', '--noEmit', '-p', config], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
JS
```

Host 打包检查（不重建 canvas-app，不覆盖 lib）：

```sh
"$TASK_NODE" --input-type=module <<'JS'
import { build } from 'esbuild'
import { mkdtemp } from 'node:fs/promises'
const directory = await mkdtemp('/private/tmp/canvas-contract-host-')
await build({
  entryPoints: ['src/host/index.ts'], outfile: directory + '/index.js',
  bundle: true, format: 'esm', platform: 'node', target: 'node22',
  external: ['@deepseek-ai/*'], legalComments: 'none',
})
console.log('Host build completed:', directory)
JS
```

本次生产差异限定在三个 Host 文件与新增声明文件，无需默认重复 Web 全量测试、媒体生成、上传真实素材或完整安装流程。若实现越界改动 Client/Web，则停止按“等价集中”验收，另行评估范围。正式发行版本、构建完整 tgz 和安装属于后续明确交付任务，不顺带执行。

## 六、必须保留的行为验收矩阵

| 编号 | 可验证目标 | 证据来源/通过条件 |
| --- | --- | --- |
| C01 | 七工具目录相等 | 新 test 对冻结 fixture 做 deepEqual，含全部文案、必填字段、oneOf、嵌套 properties、超时、顺序 |
| C02 | 输出方式相等 | 七项 string Schema 和 renderer 测试；不双重 JSON 编码、不返回对象 |
| C03 | summary 保持旧格式 | 既有 canvas-tools 测试：无需 Agent/Client，只调用摘要 API，不添加 status/version/requestId |
| C04 | 读取/写入映射保持 | 既有三组工具测试：payload、expectedVersion、分页、signal、prepare/read/write 请求 ID 后缀一致 |
| C05 | 无效参数无副作用 | 现有 SDK/Host 测试：错误分支、position、危险参数、伪造 routing 在原检查层拒绝；不提前上传/dispatch |
| C06 | 原生回执保留 | 既有测试：saved 真实版本/ID、warnings/edge IDs；unknown=never_auto；rejected 不被误报 unknown |
| C07 | 素材分阶段结果 | 既有 asset tests：上传复用、账号变化、多产物 needs_input、登记失败仍 saved、同 call 不重复写 |
| C08 | 正常编辑不强制刷新 | alpha.13 既有工具测试：refresh:false 指导、node.changes 示例、失败停步文案保留 |
| C09 | 纯模块可独立构建 | 新 esbuild 测试只包含一个输入文件，无 Host/SDK/React/Store 运行时依赖 |
| C10 | 不改变执行与运输 | 23份源文件基线对照和最终diff；允许改变的生产文件仅新增模块+三个 Host 工具文件 |
| C11 | 实际 SDK 可消费 | 插件默认类型检查、实际 Core 类型检查与 Host bundle 均通过；不得仅凭 JSON 内容正确声称集成完成 |

现有请求 guard、保存队列、SSE 路由、完整节点/边原生规则由既有测试及不变源码覆盖，不新建一组镜像业务测试。若其他工作已经改变基线文件，C10 只归因本次差异并记录新基线，不能回退对方改动。

## 七、交付后的最小人工冒烟（后续安装时执行）

源码整理完成的本轮验收以自动化及差异审查为准。实际安装新包时，再用专用测试画布完成以下短流程；本计划不授权当前账号写入，不重复整套历史手测。

共同约束：只使用七工具，不生成、不运行模板、不自动打开画布；每次保存使用刚读取的 confirmed 版本；失败停在原步骤，不自动换参数重试。有真实图片的步骤使用用户已提供给该会话的图片。

| 步骤 | 操作 | 目标 |
| --- | --- | --- |
| M01 | canvas_create 建立专用“契约整理验收”画布；canvas_get summary 与 nodes | 有真实 ID，created.runtime 状态如实；摘要仍为旧结构，详情提供版本与一致性 |
| M02 | canvas_node_edit 添加文本“契约整理验收”，再修改正文并回读 | 字段仍用 node.changes/changes；同节点 ID 修改、版本递进，不生成 |
| M03 | canvas_assets 列当前图片；canvas_asset_import 按 attachmentId 导入 | 当前会话授权不变，saved 与 assetRegistration 独立；图中只有一次新增 |
| M04 | canvas_node_edit 新建空 image；canvas_models 读可用值；configure 保存已有合法配置 | 不需要用户猜模型；无新字段要求，创建和配置不触发生成 |
| M05 | canvas_get graph → canvas_edges 连接原图到空 image → 回读确认真实边 → 删除该测试边 | 默认原生端口解析不变，outputs 不当连线；边 ID/版本真实 |
| M06 | 用户主动打开该测试画布查看布局和文本，再通过 Agent 修改测试文本 | 节点位置/内容正确；正常读取不自动强制重载，原生 UI 行为不变 |

手测记录工具原始入参、JSON 字符串解码结果和失败阶段。手测未执行时标为 pending，不影响说明“源码等价检查完成”，也不将其写为真实账号验收通过。

## 八、开发停止线与计划自审

当步骤2完成并通过 C01–C11，即停止本项。下一步公开契约改进需另立变更：结构化对象输出、条件入参优化、能力目录、批量 patch 等不能混入本次提交。

计划编写阶段已做：核对当前七工具/共享 parser/原生方法；采集真实注册目录（0业务调用）；准备完整声明及测试参考；核对文档链接和参考声明与冻结目录的一致性。当时未改生产代码或执行开发步骤；后续获准实施结果见顶部状态和验收归档。

[计划参考检查记录](../preflight/2026-10-14-canvas-tool-contracts-plan-checks.json)：七项声明经现有 defineTool 投影后与冻结目录完全一致；两项测试参考在隔离临时目录通过；23份源文件哈希无变化。此结果只证明计划参考与当前源码一致，不代表上述开发步骤或真实账号验收已完成。

采用 karpathy-guidelines 的具体约束：只新增一个生产模块；不引入抽象执行器、第三种 Schema 语言或发布包；保留所有既有校验与业务状态；依赖已有测试加少量迁移兼容断言。计划自审由当前任务完成，不要求额外代理或未安装技能才能实施。
