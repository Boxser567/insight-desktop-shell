# 本地技能快捷入口纠正计划

状态：主要实现完成，正在最终本地验收；业务代理和全平台验收仍未完成。2026-09-18。
Supersedes: 2026-09-16-insight-skill-picker.md 中的单选、会话持续选择、静态目录及隐藏追加设计。

## 已确认范围

用户确认完整本地链路；服务端技能编码延期。技能只属于当前草稿，多选、再次点击取消，发送成功清空、失败保留。项目 bundled-skills/ 为本次分发源，开发时监听，发布时随包交付，正式客户端随版本升级更新。没有安装后独立维护专属目录、远程下载或技能管理器。普通实现问题由研发决定，重要业务或架构取舍再确认。

已从 insight-desktop-skills/skills 原样复制 12 包、109 文件，逐文件 SHA-256 一致；保留全部相对资源。源仓不修改。包内文档是待加载的技能数据，不作为本次工程任务指令。当前实际目录有 call-insight-api，无 design-enhanced、ppt-maker，不制造缺失项。

## Step 0 / What already exists

[Layer 1] Core skill-filesystem 提供 SKILL.md 解析、custom/bundled 根目录、Chokidar 监听、目录缺失探测、元数据及注册表失效。复用，不新建扫描器。
[Layer 1] skill 注册表负责会话作用域、同名优先级和 skills/change；tool-skill 已按消息中的 /name 去重加载正文并记录 skill-invocation 上下文。
[Layer 1] ui-skill 提供 / 菜单、技能词库和输入框装饰；使用相同词库，不新增独立 chip 数据格式。
[Layer 1] 输入框已有带草稿版本校验的局部编辑原语；成功清理/失败恢复由提交状态机负责。
[Layer 1] Shell 已有 extraResources、资源路径解析和 Host 启动环境；沿用现有 Mac arm64/x64、Windows x64 构建。
复杂度超过 8 文件，用户已接受完整范围；不引入新扫描器、新服务端协议或新的远程技能系统。
TODOS.md 未在已检查的项目根发现；后续项目已明确列入 NOT in scope，无需新建通用待办文件。

## Architecture review

1. [P1, confidence 10/10] SkillPicker.tsx:14 的 input.selectedSkills?.[0] 与 facade.ts:156 的独立 selectedSkills 状态形成旧单选持久行为。撤掉这次功能新增的持续选择与 submissionSkills，菜单勾选从草稿识别，发送仅使用可见内容。
2. [P1, confidence 10/10] skill-catalog.ts:1 静态 import data from '../../../build/insight-skill-catalog.json' 无法反映目录。使用注册表的实际可调用条目，删除静态名单依赖。
3. [P1, confidence 10/10] Core api/session-controller/src/skill-catalog.ts 的 skills.map 只返回 name/description/whenToUse/modelInvocable；types.ts:225 同样缺显示信息。最小增加可选的显示标题、排序和来源标识，来自已选中定义的元数据；不向渲染层暴露绝对路径或整份任意 metadata。专属菜单仅显示来自专属 bundled 根的有效条目；原生 / 菜单继续展示其他来源。同名覆盖沿用注册表，不另定优先级，避免展示一份却加载另一份。
4. [P1, confidence 9/10] ui-skill 当前缓存通过 preset 切换和 connection/reset 失效，目录变化未接到该缓存。将 skills/change 通过现有 Host 事件转发方式发布，消费者重新读取自己的会话目录。两个菜单共享 ui-skill 的目录缓存与订阅能力；同时失效词库。实现时核对作用域转发，不能只通知全局服务而漏掉预设实例。
5. [P1, confidence 10/10] package.json:122 extraResources 尚无 bundled-skills；启动环境也尚未明确指定该目录。添加完整资源目录，开发/生产路径分别解析，Host 使用 DSH_BUNDLED_SKILL_DIR 或现有 bundledSkillDir 配置，确保预设确实挂载该 provider。通过真实 Host 启动验证，而非只检查配置文本。

数据流：

    bundled-skills/<name>/SKILL.md + scripts/references/assets
        | 原生 filesystem provider / watcher
        v
    会话 skill registry --变更通知--> 目录缓存失效
        | 元数据投影                       |
        v                                  v
    原生 / 菜单 <----共享目录与词库----> 因赛专属多选菜单
                                             | 局部草稿编辑
                                             v
    可见 /name + 正文 + 原生文件引用/附件
        | 原生命令判定：系统命令优先
        +--> 系统命令原有路径
        +--> 普通消息 --> tool-skill --> 记录正文加载 --> 模型
        | 成功清空 / 失败恢复

重要语义：清空草稿不删除历史中的技能正文，不承诺模型遗忘上一轮。它只保证不再次自动附加技能引用。

## Code quality review

6. [P1, confidence 10/10] facade.ts:273 setDraft 调用 root.clear() 并重建纯文本节点，不能用 setDraft(替换后的字符串) 实现菜单开关，否则破坏结构化引用。用 editor 原生局部事务及版本守卫修改完整技能 token，保留引用节点、附件、光标和撤销。必要时仅新增一个草稿 toggle 动作，不新增独立选中状态。重复 token 取消时移除该名字所有有效引用，保留无关文字；手动输入和菜单输入不区分来源，遵从原生“文本为准”。
7. [P2, confidence 10/10] SkillPicker.tsx:109/131 仍展示清空按钮和持续生效提示。删除这些文案与无用样式；菜单保持打开供连续多选，Escape/点击外部关闭。默认请选择 Skill，有选中时显示已选数量。列表使用多选语义，标题/描述上下排列，内容区最高400px，窄窗口自适应，键盘和减少动画设置保留。
8. [P2, confidence 10/10] 技能文件目前只有 call-insight-api 包含 metadata.displayName。把已确认的中文标题落到各自 SKILL.md metadata.displayName，描述继续以包中 description 为准；新包缺标题时退回 name，不阻止发现。排序使用可选 metadata.order，否则按名称稳定排序。media-generator 依照用户先前要求仅从专属菜单隐藏，使用 metadata.insightPickerVisible:false；不改 user-invocable 以免误禁其他入口。不编造正文、不静默改 API 脚本。删除技能名单型 JSON。
系统命令名称冲突：构建校验已知冲突，运行时对冲突项禁用并说明原因；不得重写系统命令语义。已进入命令模式时专属插入不可用，普通消息内的手动 token 仍按原生规则处理。
相关过时注释也要修正：tool-skill 的前置注释写“首行开头”，实际正则扫描全部文本；只在触及该调用链文档时同步准确描述。

## Test review / coverage diagram

本次未运行行为测试：这里只审核现有源码与制定新测试，旧测试通过不证明新行为。
框架：Shell Vitest；Core AGENTS 指定 pnpm test/test:coverage 与关键无密钥会话快照。

    [GAP] 目录到菜单 [E2E]
      +-- 新增/删除/重命名/修改元数据 -> 两个菜单和词库更新
      +-- 非法 frontmatter / 空目录 -> 明确空态或诊断，普通输入仍可用
      +-- 同名覆盖 / 隐藏项 / 缺标题 -> 正确来源、可见性及回退
      +-- 断线重连 / 切会话 / 快速变更 -> 旧结果不覆盖新缓存
    [GAP] 草稿多选 [UNIT + E2E]
      +-- 选择A+B/再次点A/手动删B/撤销 -> 文本与勾选一致
      +-- 重复同名 / 路径 / 相邻字符 -> 只操作完整引用
      +-- 文件引用节点 + 图片附件 + 中文IME -> 内容和输入体验不损坏
      +-- 系统命令 / 命令模式 / 提交中 -> 原生行为不变
    [GAP] 提交生命周期 [UNIT + SNAPSHOT]
      +-- 成功 -> 清空，不给下一条偷偷附加
      +-- 失败 -> 原始可见草稿及附件保留，可重试
      +-- 排队/编辑队列/切会话 -> 只使用已捕获消息
      +-- 两个本地技能 -> 两份正文可在 session log 证明加载
    [GAP] 分发 [PACKAGED SMOKE]
      +-- 完整脚本/引用资源 + 带空格路径 -> 实际加载成功
      +-- 干净安装环境无源仓 -> 无硬编码本机路径
      +-- Mac arm64/x64、Windows x64 -> 路径及打包资源校验

此图是4组新增验收要求，不是已测覆盖率统计。现有 watcher、ui-skill、引用提交和状态机测试提供底座，新增组合行为全部需补。
CRITICAL 回归：不能清除文件引用；不能吞掉系统命令；不能在成功后继续注入；旧 selected-skills 测试必须改为新约定而非保留错误行为。
测试文件：Core ui-conversation/tests/selected-skills.client.spec.ts 改为草稿开关与提交测试，补 input-reference-submit 与 submit-machine；ui-skill/tests/browser-plugin.client.spec.ts 补目录订阅和过期请求；api/session-controller 对应 catalog tests 补元数据/来源/权限投影。Shell test/insight-skill-catalog.test.ts 转为真实目录元数据测试，增加菜单组件交互和 bundled-skills 打包检查。不新增测试框架。
模型验收：用固定本地测试技能与无密钥记录会话证明正文注入与去重；真实业务样例由用户整体验收。没有现成的企业内容质量评测基线，不能把模型回答自称“用了技能”当作加载证据。

## Failure modes

| 路径 | 失败场景 | 计划中的处理与验证 |
|---|---|---|
| 目录解析 | 文件损坏 | 显式诊断，单项隔离；有效项与普通输入保留；非法文件测试 |
| 目录刷新 | 旧请求后返回 | 请求代次/取消沿用缓存模式，废弃结果；乱序测试 |
| 草稿切换 | 用户编辑与菜单点击交错 | 同步编辑事务与版本校验，拒绝陈旧位置；引用/IME测试 |
| 技能删除 | 草稿已引用但目录不再存在 | 保留可见草稿，不静默删除；本次发送前提示该专属引用失效，允许用户移除后重试 |
| 技能正文 | 文件读失败 | 不伪装加载成功；原生错误可见且可重试；Host集成测试 |
| 构建资源 | 只有SKILL.md没有脚本 | 完整树比对和隔离安装包smoke阻断交付 |
| 业务脚本 | 企业代理或Python缺失 | 单独报告依赖与错误，不要求用户粘贴凭据，不绕过服务端；不能宣称全技能业务可用 |

关键缺口：真实业务代理链路目前缺少已验证的本分支实现。前端技能加载可单独验收；企业API技能的端到端可用性仍有发布风险，不与“服务端技能托管延期”混为一谈。

## Performance review

9. [P2, confidence 9/10] 不在React render、每个键入或每次勾选扫描文件及加载正文。复用注册表缓存、合并文件变更，前端共享每会话目录的单次在途请求；搜索本地过滤。订阅随销毁释放，重连重新获取，目录变化同时刷新已打开菜单。12项无需虚拟列表、新数据库或新缓存服务。
压力验证：合成数百条目录元数据验证搜索与事件合并；只在打开/变更时发目录请求，正文只按调用加载；监听失败显式日志与恢复测试。

## NOT in scope

- 服务端托管技能协议、接口与后端业务编码：用户明确延期。
- 安装后可写专属目录、覆盖管理和在线更新：用户选择随版本分发。
- 补造 design-enhanced、ppt-maker 或修改技能业务正文：实际包没有，不伪造。
- 自动补装Python、改企业代理、绕过鉴权及收费API试跑：属于独立业务执行依赖，未纳入此次快捷入口计划。
- OSS发布、升级指针、正式客户端替换：本次计划不执行。

## Implementation Tasks

- [ ] T1 (P1) 资源与启动：package.json、src/main/runtime/harness-runtime.ts、相关资源路径解析；打包bundled-skills并接到实际provider。验证隔离包Host读取全部资源。
- [ ] T2 (P1) 目录投影与共享刷新：Core api/session-controller、client/ui-skill；最小字段和变更事件、共享缓存订阅。验证作用域、同名覆盖、断线和乱序。
- [ ] T3 (P1) 草稿行为：Core ui-conversation contract/input.ts、input/facade.ts、旧selected-skills.ts及调用者；撤持续状态，新增最小局部开关能力。验证引用节点/命令/撤销/队列及成功失败路径。
- [ ] T4 (P2) 专属菜单：Shell SkillPicker.tsx、skill-catalog.ts、client/index.tsx、locales/styles；改多选和草稿派生，接共享目录，删除旧JSON、提示和按钮。验证键盘、400px、窄窗口及IME。
- [ ] T5 (P2) 包显示元数据：bundled-skills/*/SKILL.md；只补标题、排序和media-generator的菜单隐藏元数据。验证新增无元数据技能也可发现。
- [ ] T6 (P1) 集成验收与文档：上述对应测试、docs/acceptance/insight-skill-picker.md、本地启动脚本能力检查及Core文档；重建Runtime，验证真实本地客户端，之后由用户整体验收。正式发布前生成三个平台Runtime并更新锁文件，不能沿用旧API锁。

依赖与工作顺序：

| 步骤 | 模块 | 依赖 |
|---|---|---|
| T1/T5 | Shell资源、技能包 | — |
| T2 | Core目录、ui-skill | — |
| T3 | Core输入框 | — |
| T4 | Shell客户端 | T2/T3 |
| T6 | 跨仓验收与文档 | 全部 |

理论上资源、目录、草稿有3条独立工作流；共享Core声明生成与集成阶段必须串行。本次默认顺序实施，不自动启动子代理或额外工作树。

## Review summary

Step 0：完整范围获用户同意，随后明确限定本地包。
架构5项、代码质量3项、性能1项；测试4组缺口已列入任务；不把规划中的测试当作已通过。
NOT in scope / What already exists / 失败模式 / 实施任务：已写。
TODO：已明确延期项写在本计划，不另建TODOS.md。
Outside voice：跳过独立模型审查，当前为直接源码审查。
完整性：用户要求的本地快捷入口全部纳入；远程托管与独立安装后目录按明确决策排除，不属于漏做。
依据：electron-builder官方Application Contents支持extraResources完整资源分发：https://www.electron.build/docs/contents/ 。编辑事务按项目锁定Lexical现有原语实现，不依据新版文档盲加API。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng Review | /plan-eng-review | 本地技能快捷入口纠正 | 1 | DONE_WITH_CONCERNS | 9项实现问题、4组测试要求；业务代理依赖未验证 |
| Outside Voice | — | 未运行 | 0 | SKIPPED | 未声称交叉审查 |

VERDICT: 本地目录、草稿多选与打包方案已确定，可以按任务实施；尚不能宣称业务API技能全部可用。
**UNRESOLVED DECISIONS:**
- 若发布要求全部API技能端到端可用，需要另行确认当前企业代理的正确实现来源与验收环境；本轮不自动新增代理或修改服务端。

## 实施记录（2026-09-18）

Core 本地提交：4227b7ef99、f2a899a014。T1–T5主要代码已实现，T6定向测试、构建、资源校验完成；证据以 docs/acceptance/insight-skill-picker.md 为准，上文测试图保留为审查时目标，不表示全部已执行。技能源复制时109文件一致，随后仅补显示元数据；安装包与最终项目109文件逐一校验一致。

实施边界：系统命令继续由原生命令判定优先处理，命令模式禁用专属入口；未新增同名冲突的构建阻断或逐项禁用机制。技能删除后保留草稿，目录与词库刷新；未新增发送前失效拦截，未知引用沿用原生文本行为。上述两项额外防护仍未实现，不能按原计划声称已覆盖。当前12包未发现系统命令重名；未来增包须纳入验收。

API技能真实执行已发现企业代理环境缺失，本轮未新增代理或修改服务端。Windows/macOS x64和隔离安装环境运行仍待验证，不宣称全功能发行就绪。
