# First-party Skill Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅展示因赛 AI 内置技能并收紧选择器布局。

**Architecture:** 沿用原生实际生效目录，以内置 ID 和路径联合判断 bundled 标记。沿用现有 filterSkills 统一控制搜索与选中计数，不改变技能执行。

**Tech Stack:** TypeScript、React、Vitest、Electron。

## Global Constraints

- 保留 LoginView.tsx 用户修改，不纳入本次提交。
- 不修改 Core，不禁用外部技能，不发布安装包。
- 当前无法使用上述 superpowers 执行技能，在当前会话逐项执行。

### Task 1: 来源过滤

Files: packages/insight-desktop-integration/src/bundled-skill-presentations.ts、skill-catalog.ts；test/skill-presentation.test.ts。

- [x] 在目录适配测试中加入 Windows/macOS 内置路径、本机同名路径、未知 ID、无路径及目录名不匹配用例，断言 `filterSkills(await catalog.list(session), '').map(s => s.name)` 只包含实际内置项。
- [x] 运行 `npx vitest run test/skill-presentation.test.ts` 确认新测试失败。
- [x] 导出 `isBundledSkill(name: string, path?: string): boolean`，要求展示表自身包含 ID 且路径最后三个组件严格等于 `bundled-skills/<name>/SKILL.md`。目录适配使用 `bundled: isBundledSkill(skill.name, skill.path)`。
- [x] 将原有将本机技能视为内置的测试调整为外部技能仍有元数据，但不进入菜单。

### Task 2: 布局和验收

Files: packages/insight-desktop-integration/src/client/SkillPicker.tsx、styles.tsx；docs/skill-display.md。

- [x] 弹层定位计算使用 `Math.max(0, Math.min(360, availableSpace))`；搜索框 `height:32px; padding:5px 10px`；条目 `padding:7px 8px`；简介使用 `-webkit-line-clamp:2` 并添加完整简介 title。
- [x] 运行 `npx vitest run test/skill-presentation.test.ts test/insight-skill-catalog.test.ts test/desktop-integration-client.test.ts`，以及 `npm run build:desktop-integration`。
- [x] 更新技能展示文档，检查 diff 和用户文案未改动，再提交本次文件。
- [ ] 用户 dev 手动确认主题、窗口缩小、滚动、悬停、多选和中文搜索。

验证记录：新增过滤断言在实现前出现 7 项预期失败；实现后 37 项针对性测试通过。集成类型检查及构建通过。重新生成本地 bundled profile 后，全量 117 个测试文件、813 项测试通过；首次全量失败仅为旧 profile 构建副本与新插件不一致。
