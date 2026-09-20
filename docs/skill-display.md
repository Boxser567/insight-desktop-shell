# 技能自定义展示

技能选择器支持读取技能目录中的 `ui.json`，只改变界面名称和简介，不改变模型识别和执行技能的方式。

```text
creator-recommendation/
  SKILL.md
  ui.json
  scripts/
```

```json
{
  "displayName": "达人推荐",
  "shortDescription": "发现并筛选合适达人，规划预算内的投放组合。"
}
```

## 字段与回退

- `displayName`：界面标题，最多 60 个 Unicode 码点；缺失或无效时显示原来的 `name`。
- `shortDescription`：界面简介，最多 160 个 Unicode 码点；缺失或无效时显示原来的 `description`。
- 两个字段均为单行文本，不渲染 HTML。空值、控制字符、超长或类型不正确的字段独立回退。
- 文件最大 8 KiB，必须是 UTF-8 JSON 对象；文件不存在、格式不正确、读取失败时仍可选择技能。
- 搜索同时匹配自定义名称、简短简介、原始名称和原始说明。

`SKILL.md` 的 `name`、`description` 和正文保持原样。选中“达人推荐”仍向输入框写入 `/creator-recommendation`，由 DSH 原生技能加载器处理，不将界面简介替代模型上下文。

## 插件实现与 DSH 边界

实现位于 `packages/insight-desktop-integration`：

1. `src/skill-catalog.ts` 通过 DSH 公共 `remote.skills.list({ sessionId })` 获取已解析优先级的技能列表。
2. 使用返回的 `SKILL.md` 路径，通过公共 `remote.workspaceFiles.readBytes` 有界读取同目录 `ui.json`，支持 macOS/Linux 和 Windows 路径。
3. `src/skill-presentation.ts` 只提取上述两个展示字段；不允许覆盖技能 ID、正文、排序或可见性。
4. `src/client/SkillPicker.tsx` 通过现有 `conversation.input.left` 插槽展示名称和简介；选择和发送继续使用原始 `name`。

不修改 DSH Core，不新增后端接口，也不扫描另一个固定技能目录。同名技能以 DSH 返回的实际生效路径为准；无文件路径和单文件 `.md` 技能使用原字段回退。文件读取沿用 DSH Host 的会话及文件访问机制。

## 分发与更新

当前 12 个内置技能都提供了 `ui.json`。现有打包配置会把整个 `bundled-skills` 目录作为外部资源分发，无需增加打包规则。

外部技能也可随技能包一起分发 `ui.json`。修改后刷新界面或重新进入会话会重新读取；本改动不新增 `ui.json` 文件监听或自动热更新。无需更改原来的技能调用名称。

## 验证

```sh
npm run build:desktop-integration
npx vitest run test/skill-presentation.test.ts test/insight-skill-catalog.test.ts test/desktop-integration-client.test.ts
```

这里只同步技能展示能力及现有技能的展示配置，不迁入旧 Shell 的企业插件结构、额外 PPT 技能包或后端代理改动。
