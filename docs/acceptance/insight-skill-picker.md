# 因赛 AI Skill 菜单：本地研发验收

日期：2026-09-18。状态：功能代码与本地回归已完成；未发布，尚不具备整包发布验收结论。

## 代码与数据

- Shell 分支：codex/insight-skill-picker-20260918。
- 目录：build/insight-skill-catalog.json。修改名称、描述、排序、可见性仅改此文件并修订 revision；变更仍随客户端构建发布。
- 菜单：packages/insight-desktop-integration/src/client/SkillPicker.tsx，通过公开 conversation.input.left 槽位注册。
- Core 本地提交：8d8a55d972；分支 codex/insight-skill-picker-20260918。
- Core 工作树：/private/tmp/insight-core-upgrade-20260914。新增公开输入动作 setSelectedSkills，原有会话输入生命周期负责隔离与清理。
- 没有创建本地 SKILL.md，没有修改 insight-harness-service、Gateway 或服务端协议。

## 已验证

| 项目 | 证据 |
| --- | --- |
| 目录 13 项、12 项可见、搜索及非法数据校验 | Shell 新增 11 项测试通过 |
| 连续发送、清空、会话隔离、手动同名去重 | Core selected-skills.client.spec.ts |
| 失败恢复草稿及附件、附件单独发送 | 同上，真实 SessionInputShell |
| 异步命令判定、/compact 分流 | 同上及现有 input-scenarios.client.spec.tsx |
| 引用序列化期间切换技能，原消息仍携带原选择 | 新增异步回归通过 |
| 受影响 Core 输入、附件、聊天、轨迹、问题、工作流回归 | 8 文件、222 测试通过 |
| 独立菜单浏览器验收 | Chrome 实际渲染生产 SkillPickerMenu 组件：搜索 PPT、Enter 选择、焦点返回、发送后保留、切换 A/B、清空恢复默认 |
| 列表最大高度 | 浏览器 DOM 实测约 400px，scrollHeight 732px，12 个选项 |
| Shell 完整回归 | 709 项中首次 708 通过，1 项因预制 profile 缓存陈旧失败；运行 prepare:bundled-profile 后该文件 6 项复验通过 |
| 本地 Shell 构建 | npm run typecheck、integration esbuild、electron-vite build 通过 |
| Core 客户端全量类型检查 | tsc -b tsconfig.client.json 通过 |
| 与新 Core 的 integration 类型检查 | 临时 tsconfig 仅将 ui-conversation 类型指向本次构建结果后通过 |

独立浏览器验收页模拟会话容器，未冒充完整 Electron 应用或真实服务端验收。Core 用例验证实际输入状态机，未调用付费模型。

## 必须保留的限制

1. 当前 core-runtime.lock.json 尚未升级。标准 npm run typecheck:desktop-integration 对旧 Runtime 会报告缺少 setSelectedSkills；不能跳过这个检查发布。已用新 Core 构建类型验证功能，但尚未生成并锁定全平台 Runtime。
2. 待新 Runtime 锁定后运行标准 npm run build，验证实际桌面槽位加载和最小窗口排布，再执行 Windows / macOS 整包验收。
3. 真实服务端应验证 `/human-needs-insight` 等名称识别、不同技能共存、无效技能反馈。客户端不会假定服务端已成功加载技能正文。
4. 选择不跨重启持久化。清空不会擦除历史中的技能引用。历史显示 `/技能名`，不区分手动与菜单来源。
5. Core doc-sync 的本次 JSDoc、README 与双语配对问题已修正并复验；尚有既有客户端槽位生成目录过期问题，差异仅涉及先前品牌标题槽位，未混入本次改动。
6. 未推送发行、未修改 OSS / Candidate / Stable 指针，未覆盖本机已安装客户端。

## 服务联调步骤

1. 新建会话，默认未选；选择人性需求洞察，输入 Brief，确认请求的最新用户消息为 `/human-needs-insight <原文>`，并由服务端确认对应技能识别。
2. 在同会话继续发送第二条消息，仍传该名称；手动输入另一个技能，两者均保留；同名引用只出现一次自动调用标记。
3. 清空后再发一条，客户端不再自动附加名称；用户手动引用仍保留。
4. 模型运行期间选 A 排队，再改 B 发另一条，第一条仍为 A，第二条为 B。编辑或 steer 原排队项不自动叠加当前 B。
5. 断网或拒绝请求后检查草稿、附件和菜单选择；恢复后重新提交没有重复前缀。
6. 切换会话，确认不串选；检查权限、模型、输入法 Enter、/compact 等原功能。
