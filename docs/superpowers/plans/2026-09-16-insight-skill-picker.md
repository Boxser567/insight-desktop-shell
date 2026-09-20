# 因赛 AI 专属 Skill 菜单研发计划

状态：2026-09-18 用户授权开发；已按最新服务端技能说明调整方案。功能实现与本地回归已完成，尚待 Runtime 打包及整包联调，未发布。

## 已确认需求

- 输入框权限控件右侧单选，默认「请选择 Skill」，可替换、清空。
- 当前会话持续保留选择，每条后续普通消息生效；新会话未选，切回恢复。不跨客户端重启持久化。
- 菜单单选不限制系统与手动技能；不删除用户手动输入的引用，同名不重复添加。
- 每项上方标题、下方描述；轻微 hover/focus 过渡；内容区最大 400px，视口不足时缩小。
- 技能目录独立 JSON 维护。13 项中 12 项可见，media-generator 隐藏仅影响菜单。
- 用户于 2026-09-18 明确：技能正文封闭保存在业务服务端，客户端仅传名称，不要求本地 SKILL.md，也不新增服务端字段或修改服务端。

## 接口调查结论

Codeup 提交 e22c4bae50721cae53811fae8d2c9c1e23e45d66 已通过已登录 Chrome 读取，参考文件为 packages/insight-enterprise-plugin/src/client/composer-skills.ts、index.tsx 和 test/composer-skills.test.ts。其实际输出形如 `/call-insight-api 生成一张小狗图片`。本次复用 `/技能名` 文本格式，不照搬其发送后清空选择、删除其他已知技能引用的逻辑。

现有 Core 的 conversation.input.left 槽位满足位置要求，但现有输入动作没有持续选择接口。最小扩展落在 ui-conversation 的 contract/input.ts、input/facade.ts 和新增 input/selected-skills.ts。不修改 Gateway、Host RPC、消息格式或业务服务端。

## 最终调用顺序

1. 菜单通过 inputActions.setSelectedSkills 设置当前输入实例的技能名称；integration 限制单选，Core 通用接口允许多个名称。
2. 按发送时先固定选择，再执行原有命令判定。/compact 等命令不附加技能。
3. 普通消息完成原有引用序列化后，对文本中没有的选中技能添加 `/技能名` 前缀；保留原文、手动引用与附件。
4. 最终文本进入现有普通消息出口、队列和历史；后续菜单变化不回写已提交消息。队列编辑沿用已有队列操作，不重新读取菜单选择。
5. 发送成功保留选择；失败沿用原机制恢复原始草稿及附件，不将自动前缀写回草稿。
6. 服务端按既有规则识别名称并提供封闭技能。客户端不宣称本地已加载正文；服务端识别、权限和错误处理需联调确认。

历史中显示最终 `/技能名` 文本，首版不增加菜单来源元数据或历史徽标。清空只停止后续自动附加，不删除历史引用，也不删除用户手动引用。

## 交付步骤

- [x] 接口调查及 Codeup 实现核对。
- [x] build/insight-skill-catalog.json，目录解析、排序、搜索及 13/12 项校验。
- [x] Core 会话选择接口与提交快照；保留原有命令、附件、队列链路。
- [x] integration 菜单、上下排版、搜索、清空、键盘操作、400px 滚动及 reduced-motion。
- [x] Core 定向回归和独立浏览器菜单交互验收。
- [ ] 新 Core Runtime 全平台打包并更新 Shell 锁文件，随后执行标准完整构建。
- [ ] 真实服务端技能识别验收。
- [ ] Windows 客户端与 macOS 完整客户端验收。

## 发布边界

当前锁文件仍为 rc11 使用的 insight-runtime-v0.1.5-rc.2-insight.1，其没有 setSelectedSkills 接口。只合并 Shell 不能交付本功能。需先打包本次 Core 改动，并以真实产物哈希更新三个平台锁项。现有已安装客户端、服务端、OSS 和升级指针均不在本次本地开发操作范围内。

验收记录见 ../../acceptance/insight-skill-picker.md。
