# 因赛AI Desktop

因赛AI Desktop is a cross-platform Electron host for the pinned Insight Harness Core Runtime.

## Runtime policy

The application does not install or upgrade `@deepseek-ai/dsh` from the npm registry at runtime. `core-runtime.lock.json` pins an independently released Core Runtime, and packaged builds embed that artifact together with the default Better Sidebar profile.

Profiles, plugins, workspaces, and Harness sessions are stored outside the application installation directory. The product application data directory is stable across upgrades.

## Local development

```bash
npm install
npm run dev
```

Development prepares the locked Core Runtime, its manifest, and the bundled profile before starting Electron.

For the Skill picker feature, use a locally assembled Core containing the selected-skill input API until its release is pinned:

```bash
# In the Core repository, using Node 24 with development headers:
pnpm run runtime:assemble --target darwin-arm64 --output /absolute/path/to/local-runtime
# In this Shell repository:
npm run dev:local -- /absolute/path/to/local-runtime
```

Select the current host target (`darwin-arm64`, `darwin-x64`, or `win32-x64`). `dev:local` validates and copies that Runtime into the ignored development cache, checks and builds the integration, refreshes the bundled profile, and starts Electron. The manifest labels it as local development. It does not change `core-runtime.lock.json`; normal builds still download and verify the locked release. Development uses the separate `insight-desktop-dev` data directory and requires its own login. Stop with Ctrl+C.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

## Packaging

```bash
npm run package:mac:arm64
npm run package:mac:x64
npm run package:win
```

Each target must be built on its matching operating system and architecture. The GitHub Actions release workflow builds the Windows installer on `windows-2022`.

macOS builds require macOS 13 or later on both Intel and Apple Silicon, using Electron 44.0.0. Release metadata enforces Darwin 22.0.0 as the minimum kernel version. A macOS 12 installation that already cannot open RC13–RC15 must upgrade macOS or manually restore a previously compatible installer; the incompatible app cannot repair itself through an in-app update.

Managed profiles migrate to generation 8 before plugin startup and remove retired GenUI/Market references, packages and stale install locks. The offline login page offers a local authentication reset (encrypted credentials and the isolated authentication session), without requiring the logout server to respond. Network diagnostics in `harness.log` contain endpoint origins and error/status codes, never credentials or request bodies.

## Reference upstream

This repository treats `dataelement/dsh-desktop` as a reference upstream. Changes are reviewed by upstream commit range and accepted through selective adoption; whole-repository merges are not the normal upgrade path. Every adoption must preserve the independently locked Core Runtime, bundled profile, product identity, account isolation, and first-party integrations. See [Upstream intake](docs/upstream-intake.md) for the review record.

## 本地专属技能

`bundled-skills/<name>/SKILL.md` 是专属技能入口，脚本、引用资料和素材与正文一同保留。开发模式监听项目目录；安装包包含完整目录，正式客户端随版本升级更新。新增技能不需要修改前端名单。

技能的 `name`、`description` 使用原生格式；`metadata.displayName` 为可选中文标题，缺省显示名称；`metadata.order` 控制排序；`metadata.insightPickerVisible: false` 仅隐藏专属快捷菜单。`media-generator` 保持隐藏但可被其他技能使用。

菜单支持多选并把 `/name` 写入当前草稿；再次点击取消。成功发送随草稿清空，失败保留，不持续作用下一轮。技能正文由本地原生加载器处理；技能内的外部 API、Python 等依赖需单独验收。
