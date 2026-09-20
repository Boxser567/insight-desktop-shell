# 因赛 AI 本地 Skill 快捷入口验收

2026-09-18：本地多选快捷入口已实现并完成下列验证；旧版单选、持续注入和服务端名称识别验收已废止。本文件不代表全平台或全部业务技能已通过。

## 代码与资源

- 项目 bundled-skills/：12个实际技能包，保留脚本和相对资源；media-generator 从专属菜单隐藏。
- Core 4227b7ef99：toggleSkill 在编辑器内局部修改；skillCatalog 共用目录请求、订阅与词库；skills/change 转发刷新。
- Core f2a899a014：专属菜单严格限定 DSH_BUNDLED_SKILL_DIR 内的技能，不混入其他插件的 bundled 技能。
- build/insight-skill-catalog.json 已移除，标题与排序随SKILL.md元数据维护。
- 当前不修改服务端和企业代理，不发布OSS或升级指针。

## 已验证

- Core 完整 official 构建通过。
- Core 8文件162项定向测试通过：目录监听、目录投影、注册表、技能正文加载、原生提交、多选与引用保留。
- Shell 类型检查通过；目录和本地Runtime入口8项测试通过。
- 来源边界修复后，目录投影和草稿多选15项定向测试通过。
- 真实 Electron 会话：creator-recommendation 出现技能上下文注入，并读取包内 references/report-template.md 与 creator-platform-routing.md；发送后选择入口恢复默认。
- 真实 Electron 目录监听：临时新增技能无需重编即出现在菜单，验证后已移除，不进入交付包。
- 生产菜单组件交互验证：连续选择两项保持菜单打开，草稿包含两项；再次点击只取消对应项。列表实测高度400px、内容1049px，可滚动。
- macOS arm64 开发目录包构建通过，包内12个技能、109个文件与项目目录逐文件 SHA-256 一致，包含正文、脚本和参考资料；Runtime为 f2a899a014。
- 最终 Runtime 重启后需重新登录以补做最终 Electron 连续多选复验；上述组件验证不替代全平台真机验收。

## 整体验收标准

1. 初始请选择 Skill；列表为实际目录项，标题/描述分行，最多400px滚动。
2. 选择人性需求洞察和整合营销策划，草稿出现两个引用；再点其中一个只取消该引用。
3. 手动删除或补入完整技能引用，菜单勾选同步；文件路径和引用附件不被当作技能。
4. 发送成功清空；下一条不自动附加。失败恢复原草稿和附件。
5. 文件引用、图片、撤销、中文IME、系统命令和队列维持原生行为。
6. 开发时增加、修改、移除技能包，菜单与原生斜杠菜单均刷新；不重编前端名单。
7. 会话记录包含本地skill-invocation正文；不得仅凭模型自述判定加载成功。
8. 独立安装包在没有源码仓库的环境仍能读取正文、脚本和参考资料。

## 运行

```bash
cd /Users/boxser.shi/Documents/harness/insight-desktop-shell
npm run dev:local -- /private/tmp/insight-local-skills-runtime
```

需Node 24；本机Node路径为 /private/tmp/node-v24.9.0-darwin-arm64/bin。默认npm run dev仍使用旧发行Runtime，不能验证新接口。

## 待完成的外部验收

Windows及macOS x64真机验收；隔离安装环境运行验收；完整API技能的代理/Python依赖验证。真实 creator-recommendation 会话已暴露 DSH_SKILL_PROXY_NODE / skill-proxy/connection.json 缺失，不能据此宣称业务API可用，不修改服务端或绕过鉴权。

正式发布需生成三平台Runtime产物并更新锁文件。当前默认 build:prepared 会正确拒绝本地Runtime与旧锁文件不匹配，不能直接用于发行。此次开发目录包使用已准备的本地Runtime，单独执行 integration build、electron-vite build 和 electron-builder --dir --publish never --config electron-builder.dev.cjs。
