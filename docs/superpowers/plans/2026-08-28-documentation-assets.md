# 登录基线文档资产整理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将知识库提交 `71cdeb5` 之后的登录、单侧栏、设置和品牌统一成果分别沉淀为 Shell 工程资产与知识库协作资产。

**Architecture:** Shell 保存完整工程事实、维护规则、提交映射和验证门禁；BoxserObsidian-Canvas 只保存阶段过程、用户可见结果、前端职责和跨角色依赖。两个仓库使用既有来源 ID 建立引用，不互相复制正文。

**Tech Stack:** Markdown、Obsidian Wiki Link、Git、Shell 项目现有文档约束。

## Global Constraints

- 增量起点是知识库提交 `71cdeb5`，不得重复整理此前 rc.9 归档。
- Shell 是客户端实现、构建和维护细节的权威来源；知识库不镜像命令或内部故障时间线。
- 知识库按 `role===frontEnd` 维护，不替 Product 或 Backend 接受正式契约。
- 只记录已经实现、自动验证或经用户手工确认的事实；开发模式验收不得写成安装包验收。
- 不新增个人绝对路径、构建产物、用户数据、令牌、验证码、Cookie 或测试账号。
- 保留 `build/splash.html` 等与本轮文档无关的工作区修改，不得捎带提交。

---

### Task 1: 收口本地组合开发文档资产

**Files:**
- Create: `docs/local-composed-development.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `docs/client-build-runbook.md`

**Interfaces:**
- Consumes: 已批准的 Runtime lock、派生 DEV Runtime/Profile 和正式构建回归边界。
- Produces: Shell/Core/插件联合调试可引用的详细开发架构与 Runbook 入口。

- [ ] **Step 1: 审查当前命令与目标命令**

运行：

```bash
rg -n "dev:shell|dev:core|dev:plugin|待实现|正式 build|锁定 Runtime" docs/local-composed-development.md docs/development.md docs/client-build-runbook.md
```

预期：尚未进入 `package.json` 的命令明确标记为待实现；正式 build/package 必须回到锁定 Runtime。

- [ ] **Step 2: 校验引用和工作区差异**

```bash
test -f docs/local-composed-development.md
rg -n "local-composed-development.md" docs/architecture.md docs/development.md docs/client-build-runbook.md
git diff --check -- docs/local-composed-development.md docs/architecture.md docs/development.md docs/client-build-runbook.md
```

- [ ] **Step 3: 提交独立开发文档资产**

```bash
git add docs/local-composed-development.md docs/architecture.md docs/development.md docs/client-build-runbook.md
git commit -m "docs: define local composed development workflow"
```

### Task 2: 建立 Shell 登录客户端阶段基线

**Files:**
- Create: `docs/authenticated-client-baseline.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: 三份 2026-08-28 approved 设计文档和对应 Git 提交。
- Produces: 当前结构、验证证据、升级约束、已知缺口和下一阶段入口的工程交接页。

- [ ] **Step 1: 记录当前实现与提交映射**

在基线文档中记录认证 Main/Renderer/IPC、账号目录、全窗口 Harness View、第一方桌面集成插件、设置控制、品牌源与图标生成；提交按能力分组。

- [ ] **Step 2: 记录证据分级**

使用 `passed-automatic`、`passed-by-user`、`not-yet-verified`，明确登录、恢复、退出、多账号隔离、单侧栏、设置、Better Sidebar 和品牌 DEV 验收已通过，安装包品牌回归尚未完成。

- [ ] **Step 3: 记录升级顺序和下一阶段入口**

Shell upstream、Core Runtime、第一方插件和品牌资源一次只改变一个输入；先定向测试和 DEV 人工验收，再做目录包、DMG 与 GitHub 平台包。下一阶段进入业务能力，不继续扩张通用架构。

- [ ] **Step 4: 挂到架构入口并校验**

```bash
rg -n "passed-automatic|passed-by-user|not-yet-verified|下一阶段|upstream" docs/authenticated-client-baseline.md
rg -n "authenticated-client-baseline.md" docs/architecture.md
git diff --check -- docs/authenticated-client-baseline.md docs/architecture.md
```

- [ ] **Step 5: 提交 Shell 基线**

```bash
git add docs/authenticated-client-baseline.md docs/architecture.md
git commit -m "docs: archive authenticated client baseline"
```

### Task 3: 建立知识库前端实施记录

**Files:**
- Create: `05_Execution/前端研发/INSIGHT-FE-003 因赛AI客户端登录与单侧栏实施记录.md`
- Modify: `03_Tech/前端架构/前端架构与研发落地索引.md`

**Interfaces:**
- Consumes: `SRC_INSAI_DESKTOP_SHELL:docs/authenticated-client-baseline.md` 和 Shell 2026-08-28 Git 提交。
- Produces: 知识库中的前端阶段成果，不替代 Shell 工程文档。

- [ ] **Step 1: 按前端实施记录规范创建 FE-003**

记录目标、产品映射、架构映射、用户可见行为、验证证据、数据/权限/安全/迁移影响、偏差、风险和知识库回写。提交哈希按能力分组，不复制文件级实现过程。

- [ ] **Step 2: 更新前端研发索引**

将 FE-003 加入客户端实施记录入口，并标记登录切片已由用户手工验收。

- [ ] **Step 3: 校验实施记录边界**

```bash
rg -n "/Users/|~/Downloads|access.?token|Cookie" '05_Execution/前端研发/INSIGHT-FE-003 因赛AI客户端登录与单侧栏实施记录.md'
rg -n "SRC_INSAI_DESKTOP_SHELL|passed-by-user|draft|下一阶段" '05_Execution/前端研发/INSIGHT-FE-003 因赛AI客户端登录与单侧栏实施记录.md'
```

预期：第一条无输出；第二条能定位来源、证据、契约边界和下一阶段。

### Task 4: 回写知识库路线图、契约和阶段问题

**Files:**
- Modify: `05_Execution/路线图/因赛AI业务阶段启动与登录体系前置清单.md`
- Modify: `02_Contracts/客户端登录、会话与业务数据隔离前端接入需求.md`
- Modify: `02_Contracts/Contract Hub.md`
- Modify: `01_Product/研发追踪/产品输入到研发交接清单.md`
- Modify: `00_System/open-questions.md`

**Interfaces:**
- Consumes: FE-003 的已实现事实和手工验收证据。
- Produces: 登录切片当前状态、仍需 Product/Backend 确认的正式契约和业务阶段入口。

- [ ] **Step 1: 更新路线图状态**

把登录与会话前端切片更新为前端已实现并验收；保留账号禁用、权限变化、跨设备和安装包回归为后续依赖。下一步收敛到首个真实业务能力。

- [ ] **Step 2: 在 draft 契约中加入实现证据**

增加“前端实现基线”，明确 API 接入、状态机和隔离已落地，但最终字段、服务端权限、禁用语义、跨设备和长期兼容仍未由 Backend/Product 接受；状态保持 `draft`。

- [ ] **Step 3: 更新 D17、D18 和入口摘要**

D17 收敛为正式协议与异常生命周期；D18 记录当前设置入口已收敛，但首个业务场景的 Harness/插件/模型可见范围仍待决定。Contract Hub 和产品交接清单只更新证据链接，不提升契约状态。

### Task 5: 更新知识库事实、索引和日志

**Files:**
- Modify: `07_Raw_Sources/因赛AI客户端工程执行记录-2026-08/对话执行事实摘要-2026-08.md`
- Modify: `00_System/index.md`
- Modify: `00_System/log.md`

**Interfaces:**
- Consumes: FE-003、路线图和 draft 契约更新。
- Produces: 从上次续接标记后的最小事实摘要与可发现入口。

- [ ] **Step 1: 只追加 2026-08-28 增量事实**

记录登录实现、单侧栏合并、设置入口修复、品牌统一和用户手工验收，不重述 rc.9 构建复盘。

- [ ] **Step 2: 更新索引与日志**

把 FE-003 加入客户端工程入口；日志说明双层职责、未复制 Shell 详细文档，并列出仍未关闭的跨角色问题。

- [ ] **Step 3: 运行知识库污染和一致性检查**

```bash
git diff --check
rg -n "/Users/|~/Downloads|file://" 00_System 01_Product 02_Contracts 03_Tech 05_Execution 07_Raw_Sources/因赛AI客户端工程执行记录-2026-08 --glob '*.md'
rg -n "INSIGHT-FE-003|客户端登录、会话与业务数据隔离前端接入需求" 00_System/index.md 00_System/log.md '02_Contracts/Contract Hub.md' '03_Tech/前端架构/前端架构与研发落地索引.md'
git diff --stat
```

- [ ] **Step 4: 提交知识库增量资产**

仅暂存本计划列出的知识库文件，提交信息为：

```bash
git commit -m "execution: archive authenticated desktop baseline"
```

### Task 6: 最终交叉核验

**Files:**
- Verify: Shell and BoxserObsidian-Canvas repositories.

**Interfaces:**
- Consumes: 两个仓库的已提交文档资产。
- Produces: 可交付的提交边界与未提交文件清单。

- [ ] **Step 1: 检查两个仓库提交和剩余工作区**

```bash
git status --short
git -C ../../BoxserObsidian-Canvas status --short
git log --oneline -4
git -C ../../BoxserObsidian-Canvas log --oneline -2
```

预期：知识库干净；Shell 只保留本轮明确排除的无关修改，例如 `build/splash.html`。

- [ ] **Step 2: 报告资产关系和下一阶段入口**

最终交付说明 Shell 的详细工程入口、知识库的协作入口、提交 ID、未纳入提交的文件，以及下一阶段应先规划的业务能力。
