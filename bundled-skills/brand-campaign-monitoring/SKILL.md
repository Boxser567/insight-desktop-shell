---
name: brand-campaign-monitoring
description: Use when a brand needs cross-platform reputation and risk monitoring, in-flight campaign tracking, anomaly detection, or evidence-backed optimization across public social content. Not for pre-launch creator selection, direct media buying, or post-campaign attribution alone.
metadata:
  displayName: "品牌舆情监测"
  order: 6

---
## 企业版数据调用

本技能通过本目录 `scripts/enterprise_proxy.mjs` 调用后台的 `tikhub` 连接。请用插件提供的 `DSH_SKILL_PROXY_NODE`（内置 Node.js 绝对路径）运行，不依赖系统 node/Python；脚本路径有空格时加引号。PowerShell 用 `& $env:DSH_SKILL_PROXY_NODE "<skill>/scripts/enterprise_proxy.mjs" ...`。它使用本地企业插件桥接，不注册新的模型工具。插件自动携带登录态，后台注入 TikHub Key。

以技能加载结果中的实际目录替换 `<skill>`，不要硬编码其他人的 home 路径。路由/参数继续参考本技能 references；以下是调用示例，不代表授权批量采集：

```bash
"$DSH_SKILL_PROXY_NODE" <skill>/scripts/enterprise_proxy.mjs tikhub POST /api/v1/douyin/search/fetch_general_search_v2 --body '{"keyword":"家居","cursor":0}'
"$DSH_SKILL_PROXY_NODE" <skill>/scripts/enterprise_proxy.mjs tikhub GET /api/v1/xiaohongshu/app_v2/search_notes --query '{"keyword":"家居","page":1}'
```

只读查询按原技能的采样、费用授权和数据质量约束执行。不得读取本机用户 Token、Codex 配置、厂商 Key 或直接请求 TikHub。`DSH_HOME` 由客户端提供；未登录/代理不可用时请用户启动更新后的客户端并登录。`SKILL_PROXY_ROUTE_FORBIDDEN` 表示后台尚未开放路由，联系管理员，不尝试绕过。超时/断连不代表上游未执行，不自动重试。


# 品牌口碑与战役投中监测

## 目标

把“品牌口碑与风险雷达”和“营销战役投中监测”合并为一个连续判断流程：同一批跨平台公开内容，同时用于判断口碑、风险、声量、内容效率和投放调整。

- 厂商 Key 仅由后台读取；技能不得读取或展示任何用户 Token/厂商凭据。

## 选择模式

- `reputation_radar`：持续观察品牌、产品、竞品和风险话题，输出声量、情绪、议题、异常与证据。
- `campaign_monitor`：针对正在投放的战役、达人或内容清单，输出节奏、目标完成度、异常和可执行调整。
- `combined`：默认模式。把自然口碑、品牌自有内容、达人内容和竞品动态放在同一时间轴上判断。

如果用户要求“监控、每日检查、定时跟进或发生时通知”，使用产品提供的自动化/心跳机制；Skill 文本本身不代表已经建立定时任务。

## 输入

从上下文提取或请用户提供：

```yaml
monitoring_brief:
  mode: combined
  upstream_plan:
    monitoring_handoff_id: 可选，来自 creator-recommendation
    plan_id: 可选
    plan_version: 可选
    monitoring_handoff: 可选，完整交接对象
  previous_run:
    snapshot_id: 可选
    action_log: [可选]
    learning_return_id: 可选
  brand: 品牌名
  products: [产品/型号]
  competitors: [竞品]
  campaign:
    name: 可选
    start_at: 可选
    end_at: 可选
    objectives: [声量, 搜索, 互动, 引流, 转化]
    tracked_creators: [可选]
    tracked_content_urls: [可选]
  platforms: [抖音, 小红书, B站, 公众号, TikTok]
  queries:
    brand_terms: []
    product_terms: []
    campaign_terms: []
    risk_terms: []
    search_exclusions: []
  upstream_insight:
    insight_handoff_id: 可选，来自 category-competitor-insight
    query_manifest: [可选，完整查询对象]
    risk_watchlist: [可选，完整风险对象]
    evidence_manifest: [可选，完整证据对象]
  window: 近24小时 | 近7天 | 自定义
  baseline: 上一周 | 投放前 | 同批内容 | 用户指定
  first_party_metrics: [展现, 点击, 搜索, 加购, 成交]
  research_budget_usd: 可选
```

缺少投放后台或一方转化数据时，仍可做公开传播监测，但不得把公开互动推断为 ROI、销量或真实归因。

## 执行流程

### 1. 建立监测实体和查询集

将品牌名、型号、活动名、口号、达人、竞品、常见错别字和风险词拆开。记录每个查询的用途，不用一个宽泛关键词代替全部监测。

若输入包含 `creator-recommendation` 产出的 `monitoring_handoff`，先锁定 `plan_id + plan_version`，直接导入达人监测注册表、发布窗口、应发数量、角色/场景/信息点、预算、KPI 定义和逐指标基线；不要把这些字段压缩成只有达人名与内容 URL 的清单。内容 URL 尚未产生时，按 `platform + creator_id + planned_publish_window` 建立发现任务。

若输入包含 `category-competitor-insight` 的 `insight_handoff`，复用其查询、风险和有效证据清单。`risk_terms` 用于主动检索和告警，`search_exclusions` 只用于降噪；兼容旧输入 `queries.exclusions` 时，必须先确认其语义再映射。

若存在 `previous_run`，导入上一轮快照和动作日志。对仍有效且证据/触发条件未变化的建议复用原 `action_id`，更新状态或复核结果，不重复生成新建议。新一轮快照记录 `previous_snapshot_id`。

### 2. 按平台能力路由

读取 [跨平台能力与降级矩阵](references/platform-capability-matrix.md)，选择已实测的主路由和 fallback。

- 搜索/发现用于建立样本；详情用于校验内容、作者和发布时间；评论用于异议、购买意向和风险主题。
- 不得把空列表直接写成“全网无声量”。先区分真实零结果、路由失效、权限不足、上游超时和参数语义错误。
- 需要 Cookie、账号授权或特定 Token scope 的能力必须显式标记，不得绕过。

### 3. 归一化和去重

按 [监测数据契约](references/data-contract.md) 保留原始平台标识、发布时间、采集时间和字段可用性。用内容 ID、规范化 URL、作者和时间窗去重；转发、转载和原帖保留关系，不简单合并。

优先复用仍在有效期内且查询、平台、对象和时间窗一致的上游证据/缓存。补采生成新抓取记录，不覆盖投前基线；投前值与投中实际值通过 `baseline_id` 和 `tracking_id` 关联。

### 4. 口碑与风险判断

具体算法和输出见 [监测与告警规则](references/monitoring-playbook.md)。至少区分：

- 负面情绪、具体产品问题、广告反感、售后/安全/合规问题；
- 单个高传播事件与多条独立证据累积；
- 内容增长、负面占比变化、高影响作者介入和主题突变。

情绪分类必须保留证据样本和不确定性；反讽、转述、问句和无关评论不得强行归入正负面。

### 5. 战役投中判断

将实际结果与投放前基线、同批内容、达人自身近期基线和品牌目标对比。同时看：

- 发布/审核/投放节奏与覆盖缺口；
- 播放、互动、评论质量、搜索需求、负面反馈和内容迭代信号；
- 内容与人群/场景/信息点的增量覆盖，不只看单条排名；
- 一方点击、搜索、加购、成交与归因数据（如果获得）。

加投、暂停、换题、换达人或危机响应阈值优先使用用户 KPI 或历史基线。没有依据时，定义指标和决策方式，不自行发明固定百分比。

### 6. 输出

默认输出：

1. 一页状态结论：正常、观察、预警或事件级；
2. 跨平台指标与变化，附时间窗、样本量、基线和数据新鲜度；
3. 主题/口碑/风险聚类，附原始内容 ID 或可追溯 URL；
4. 战役节奏和内容/达人分层；
5. 建议动作、触发条件、责任方和复核时点；
6. 数据缺口、接口降级、权限限制和置信度。

同时输出 [监测数据契约](references/data-contract.md) 中的 `action_log` 与 `learning_return`：记录动作 ID、所依据的计划版本、建议/执行状态、实际调整、复核结果，以及对机会卡、达人任务、替补状态、查询词、风险词和下一版 KPI 的回传建议。没有获得执行确认时状态只能是 `recommended`，不得假设建议已经落地。

## 数据、费用与安全护栏

- 只调用当前问题必需的只读接口；先宽搜索，再对入选内容取详情和评论。
- 付费探测或大批量采集前估算费用；缓存相同平台、查询和时间窗的结果。
- 只保留业务字段。授权头、Cookie、Token、xsec、媒体签名和短期播放地址不进入报告或长期存储。
- 不执行投放、加热、下单、私信、删帖、评论或其他改变第三方状态的操作，除非用户在当次任务中明确授权。
- `scripts/tikhub_probe.py` 仅用于端点验收和回归探测；运行会产生实际 API 费用，调用前必须有当次任务授权并展示估算费用。

## 边界

- 投放前达人发现、背调和组合规划由 `creator-recommendation` 执行；本 Skill 可接收其输出作为投中监测清单。
- 有明确研究窗口的投前品类、竞品和用户需求问题由 `category-competitor-insight` 执行；本 Skill 的 `reputation_radar` 用于持续/重复观测、操作性告警或已上线战役的风险判断。
- 传播评估不等于增量归因。要评价 ROI、转化或品牌提升，必须引入对应的一方数据、实验设计或投放后台。
- 法务、合规或产品安全事件可由本 Skill 发现和分级，但最终定性必须由有权团队确认。
