# 因赛 AI Skill 菜单：本地研发验收

日期：2026-09-18。状态：功能代码与本地回归已完成；未发布，尚不具备整包发布验收结论。

## 代码与数据

- Shell 分支：codex/insight-skill-picker-20260918。
- 目录：build/insight-skill-catalog.json。修改名称、描述、排序、可见性仅改此文件并修订 revision；变更仍随客户端构建发布。
- 菜单：packages/insight-desktop-integration/src/client/SkillPicker.tsx，通过公开 conversation.input.left 槽位注册。
- Core 本地提交：8d8a55d972（输入能力）、16df11824f（Runtime 分发所需的 client-store 类型依赖）；分支 codex/insight-skill-picker-20260918。
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
| 完整本机 Runtime 联调入口 | 完整 Core build:official + runtime:assemble 成功；dev:local 的标准 integration 类型检查、插件构建、profile 准备成功，Electron 实际显示登录页 |
| 本地启动回归 | dev-local / runtime-manifest / skill-catalog 共 17 项通过；Shell typecheck 与 electron-vite build 通过 |

独立浏览器验收页模拟会话容器，未冒充完整 Electron 应用或真实服务端验收。Core 用例验证实际输入状态机，未调用付费模型。

## 必须保留的限制

1. 当前 core-runtime.lock.json 尚未升级。已完整构建本机 darwin-arm64 Runtime，标准 npm run typecheck:desktop-integration 和集成构建通过。dev:local 可启动真实客户端；正式发布仍需生成并锁定全平台 Runtime，不能使用旧锁发布此功能。
2. 本机真实 Electron 已启动至登录页；登录后的槽位、最小窗口排布及 Windows / macOS 整包仍需验收。
3. 真实服务端应验证 `/human-needs-insight` 等名称识别、不同技能共存、无效技能反馈。客户端不会假定服务端已成功加载技能正文。
4. 选择不跨重启持久化。清空不会擦除历史中的技能引用。历史显示 `/技能名`，不区分手动与菜单来源。
5. Core doc-sync 的本次 JSDoc、README 与双语配对问题已修正并复验；尚有既有客户端槽位生成目录过期问题，差异仅涉及先前品牌标题槽位，未混入本次改动。
6. 未推送发行、未修改 OSS / Candidate / Stable 指针，未覆盖本机已安装客户端。

## 本机完整客户端启动

已准备的 Runtime 为 `/private/tmp/insight-skill-runtime`，来源 Core 提交 `16df11824f10015d0565dfaf13a8436f598ec202`。这是完整构建产物，不是浏览器模拟页；临时目录被清理后需按 README 重新组装。

```bash
cd /Users/boxser.shi/Documents/harness/insight-desktop-shell
PATH="/private/tmp/node-v24.9.0-darwin-arm64/bin:/usr/bin:/bin:$PATH" \
  npm run dev:local -- /private/tmp/insight-skill-runtime
```

打开的是开发 Electron 窗口，使用 `insight-desktop-dev` 独立数据目录，需要自行登录。关闭开发进程可在终端按 Ctrl+C。不要用 `npm run dev` 测试此次功能：它会恢复尚未升级的发行 Runtime。`dev:local` 会拒绝平台不匹配、缺少技能接口或不完整的 Runtime；不会更改服务端配置。

## 服务联调步骤

1. 新建会话，默认未选；选择人性需求洞察，输入 Brief，确认请求的最新用户消息为 `/human-needs-insight <原文>`，并由服务端确认对应技能识别。
2. 在同会话继续发送第二条消息，仍传该名称；手动输入另一个技能，两者均保留；同名引用只出现一次自动调用标记。
3. 清空后再发一条，客户端不再自动附加名称；用户手动引用仍保留。
4. 模型运行期间选 A 排队，再改 B 发另一条，第一条仍为 A，第二条为 B。编辑或 steer 原排队项不自动叠加当前 B。
5. 断网或拒绝请求后检查草稿、附件和菜单选择；恢复后重新提交没有重复前缀。
6. 切换会话，确认不串选；检查权限、模型、输入法 Enter、/compact 等原功能。
