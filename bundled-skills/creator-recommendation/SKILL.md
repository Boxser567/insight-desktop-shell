---
name: creator-recommendation
description: Use when 品牌需要达人发现、二次背调、候选筛选，或在总预算内规划达人组合、角色分工和分阶段测试；不用于直接下单、投中监测或投后复盘。
metadata:
  displayName: "达人发现与筛选"
  order: 5

---
## 企业版数据调用

本技能通过本目录 `scripts/enterprise_proxy.mjs` 调用后台的 `tikhub` 连接。请用插件提供的 `DSH_SKILL_PROXY_NODE`（内置 Node.js 绝对路径）运行，不依赖系统 node/Python；脚本路径有空格时加引号。PowerShell 用 `& $env:DSH_SKILL_PROXY_NODE "<skill>/scripts/enterprise_proxy.mjs" ...`。它使用本地企业插件桥接，不注册新的模型工具。插件自动携带登录态，后台注入 TikHub Key。

以技能加载结果中的实际目录替换 `<skill>`，不要硬编码其他人的 home 路径。路由/参数继续参考本技能 references；以下是调用示例，不代表授权批量采集：

```bash
"$DSH_SKILL_PROXY_NODE" <skill>/scripts/enterprise_proxy.mjs tikhub POST /api/v1/douyin/search/fetch_general_search_v2 --body '{"keyword":"家居","cursor":0}'
"$DSH_SKILL_PROXY_NODE" <skill>/scripts/enterprise_proxy.mjs tikhub GET /api/v1/xiaohongshu/app_v2/search_notes --query '{"keyword":"家居","page":1}'
```

只读查询按原技能的采样、费用授权和数据质量约束执行。不得读取本机用户 Token、Codex 配置、厂商 Key 或直接请求 TikHub。`DSH_HOME` 由客户端提供；未登录/代理不可用时请用户启动更新后的客户端并登录。`SKILL_PROXY_ROUTE_FORBIDDEN` 表示后台尚未开放路由，联系管理员，不尝试绕过。超时/断连不代表上游未执行，不自动重试。


# 达人推荐与二次背调

## 目标

把品牌需求转化为一份可执行、可复核的达人投放建议。输出必须区分：

- 已由数据验证的事实；
- 基于事实做出的判断；
- 下单前仍须由品牌、MCN 或达人后台核验的事项。

默认使用本技能的企业代理脚本访问 TikHub。Skill 不保存、索取、展示或写入任何 API Key、Cookie、达人账号密码或其他凭证。

## 输入

先收集或从上下文提取以下信息；缺失且不会改变结论的项目可作明确假设，缺失且会显著影响选择时才向用户确认：

```yaml
brand_brief:
  mode: shortlist | portfolio | full_plan
  brand: 品牌名
  product: 产品/型号
  category: 品类
  platforms: [抖音, 小红书, B站, 微博, 快手, 视频号, TikTok, Instagram, YouTube, X, Threads, Lemon8]
  conditional_platforms: [公众号, 知乎, Reddit, LinkedIn, 西瓜视频, 皮皮虾, 今日头条]
  objective: 种草 | 搜索提升 | 转化 | 内容资产 | 上市声量
  target_audience:
    city_tier: [一线, 新一线]
    gender: 女性为主
    age: [25-40]
    life_stage: [养宠, 带娃, 装修, 大户型]
  product_scenarios: [宠物毛发, 地毯, 低矮家具底部]
  competitors: [竞品品牌]
  exclusions: [不可合作的品类或达人类型]
  upstream_insight:
    handoff_id: 可选，来自 category-competitor-insight
    opportunity_inputs: [按 opportunity_id 成组的场景、人群、动作证据、达人类型和主张护栏]
    query_manifest: [可选，完整查询对象]
    risk_watchlist: [可选，完整风险对象]
    evidence_manifest: [可选，完整证据对象]
  previous_learning_returns: [可选，来自 brand-campaign-monitoring]
  budget:
    total: 可选
    per_creator: 可选
    currency: CNY
    includes_platform_fees: true | false | unknown
    data_research_cap_usd: 可选
  portfolio:
    desired_creator_count: 可选
    required_roles: [声量, 专业验证, 场景种草, 搜索内容, 转化测试]
    campaign_phases: [首测, 放量]
    deliverables: [原生视频, 素材授权, 白名单]
    risk_preference: conservative | balanced | aggressive
    paid_amplification_allowed: true | false | unknown
    first_party_metrics_available: [搜索, 点击, 加购, 成交]
  period: 近30天
```

## 模式

- `shortlist`：发现、背调和排序候选；总预算缺失时默认使用该模式。
- `portfolio`：已有候选池，在总预算内完成角色分工、组合去重、预算闭合和分阶段测试。
- `full_plan`：从产品场景化开始，连续完成候选发现、背调、组合与测试方案。

用户明确要求“组合、预算、投放矩阵或怎么搭配”时选择 `portfolio`；同时要求重新找达人时选择 `full_plan`。`portfolio` 或 `full_plan` 必须读取 [投放组合规划规则](references/portfolio-planning.md)。

涉及平台选择、候选发现或账号背调时必须读取 [达人平台路由与字段能力](references/creator-platform-routing.md)。

## 工作流

### 1. 产品场景化

将产品能力翻译成达人可以自然演示的生活任务，而不是只以泛类目筛选。每个场景至少写清：

- 用户痛点、产品能力、可拍的动作证据；
- 适合的达人类型；
- 对应的受众特征；
- 不适配的表达方式或风险。

例如，扫地机器人应拆成养宠毛发、带娃碎屑、装修入住、大户型/复杂地面、技术测评等不同任务；不得将“家居达人”作为充分推荐依据。

若输入带有 `upstream_insight`，先按 `handoff_id` 和 `opportunity_inputs[].opportunity_id` 逐组复用场景、人群、动作证据和主张护栏，只对缺口补充研究。不得把 `creator_archetypes` 当作已验证达人，也不得在没有新证据时改写上游禁用表达。仍在有效期内的 `evidence_manifest` 优先复用。

若输入包含 `previous_learning_returns`，按 `return_id` 记录采纳、拒绝或待验证。采纳达人任务、替补或 KPI 建议时生成新 `plan_version` 并引用原 `return_id`，不覆盖旧计划或自动重写历史评分。

### 2. 候选发现

按 [达人平台路由与字段能力](references/creator-platform-routing.md) 选择每个平台已验证的“商业搜索、内容导向发现、账号搜索或 seed-only”入口。筛选条件优先级为：产品场景相关性 → 可验证的目标受众证据 → 平台内近期内容表现 → 已验证报价与预算 → 标题可见商业密度 → 竞品冲突。

- 同一能力有多版接口时，选择最近实测成功且业务字段有效的路由；新版失败时使用已验证 fallback，不能仅凭 HTTP/顶层成功判定可用。
- 记录数据抓取日期、平台和主要筛选条件。
- 粉丝数是**必保留、必展示**的达人规模指标；同时保留近 10 条中位播放或等价的稳定性指标。两者必须并读，不得用粉丝数替代内容表现。
- 初筛阶段保留足够候选，不把单条爆款直接视为保量能力。

视频号、LinkedIn、今日头条等 `seed_only` 平台只有用户提供已知账号/URL/ID 时进入背调，不能据此承诺“发现一批新达人”。`catalog` 路由先对一个对象做业务健康检查，成功后才能扩样。

### 3. 二次背调

对进入候选名单的每位达人统一富集，字段与可用性按 [数据契约](references/data-contract.md) 执行。若任务涉及达人价值判断、邀约优先级、预算分配或投放角色，必须同时建立 `commercial_capability` 商业能力画像。

按平台字段可用性尽量完成：

1. 最多最近 10 条有效作品：保留实际样本数、内容形态、内容年龄和接口明确返回的播放/阅读、点赞、评论、分享、收藏、完播率或互动率；只对存在且口径一致的字段计算中位数和波动范围。
2. 达人粉丝数：记录抓取时点的原始粉丝数，并与近 10 条中位播放共同判断账号规模、内容效率和放量风险。
3. 标题可见的商业内容密度、同品类内容密度，以及近期本品/品牌/竞品合作证据。
4. 只有直接接口或授权后台实际返回时，才比较性别、年龄、城市级别、兴趣或人生阶段；目前已实测主来源是抖音星图 V2。
5. 报价、预估播放、CPM/CPE 只有抖音星图已实测；其他平台在用户、MCN 或后台提供前保持 `null`，不估算。
6. 只在逐条评论链路实际有效时抽查购买意向、产品疑问、负面体验和广告反感。TikTok、Instagram 等已知失败平台标记 `unavailable`，不可用评论数替代评论文本。
7. 商业能力画像必须拆分为内容传播力、人群匹配度、种草能力、带货转化力、商业性价比，以及单列的稳定与风险。每个维度都引用原始证据并标记为公开事实、平台估算、授权实际、模型计算或缺失。
8. 抖音优先使用星图 V2 的报价、人群、传播、转化能力、历史转化视频/商品和商业效果预估路由；除已实测 `live` 路由外，`catalog` 路由先做单达人业务健康检查。TikTok Creator 电商分析只用于账号所有者授权的数据，不能拿来公开背调竞品达人。

### 4. 评分与分层

按 [评分规则](references/scoring.md) 在同平台、同内容形态的可比 cohort 内分别计算 `recommendation_fit_score` 与 `commercial_capability`，并同时给出 `evidence_coverage` 和 `commercial_evidence_coverage`。前者回答“是否适合本项目”，后者回答“适合承担什么商业任务”；不得合并成一个分数。跨平台组合不用一个总分机械排序。输出层级：

- **优先邀约**：场景、受众、稳定性及历史证据均成立；
- **小额测试**：有潜力但缺少转化/品类验证，或稳定性不足；
- **条件型补充**：只适合细分人群、技术背书或素材资产；
- **素材复用优先**：已有品牌内容表现好，但新拍不具备性价比或品类已饱和；
- **淘汰/暂缓**：存在明确冲突、受众偏离或无法支撑预算。

分数不能掩盖一票否决风险：有效竞品排他、明显的广告疲劳、无法接受的报价、品牌安全问题，应单独置顶。粉丝数不单独加权，避免与播放规模重复计分；它必须作为名单和单卡中的规模诊断字段展示。完播率和互动率只在口径、样本期和数据来源可比时横向比较。

商业能力综合分只在五个正向维度证据完整，或覆盖率达到评分规则门槛且目标关键维度不缺失时生成。风险作为扣分或硬门槛单列；缺少 GMV、点击或转化数据时，不得从播放、点赞或评论意向反推成交能力。

同一自然人/机构的多个平台账号分别保留 `creator_key`，只有可验证互链或用户确认时才合并到 `entity_cluster_id`。组合覆盖和预算集中度同时按账号与实体查看，避免重复计算增量覆盖。

### 5. 形成可执行建议

`shortlist` 模式直接进入输出。`portfolio` 和 `full_plan` 模式按 [投放组合规划规则](references/portfolio-planning.md) 将入围达人组成预算闭合的投前方案；组合选择看角色、场景、人群和内容形式的增量覆盖，不按单达人分数机械取前 N 名。

组合规划必须给出：

- 每位达人的主任务、选择理由和可替补对象；
- 每位达人的商业能力强项、证据覆盖率，以及强项与主任务的对应关系；
- 场景、人群、内容形式与投放目标的覆盖及重叠；
- 达人费、制作/授权、加热测试、承接/归因和机动预留的预算口径；
- 首测、观察、放量或停止的条件；
- 尚未报价或没有第一方数据时的预算情景与待核项。

阈值优先使用品牌目标、达人自身近期基线或同批可比内容。没有依据时只定义指标和决策方式，不自行发明固定增长百分比、CPA 或 ROI 目标。

### 6. 输出

使用 [报告模板](references/report-template.md) 输出。每位达人必须有：平台与 `creator_key`、可选跨平台实体归并、各能力路由状态、粉丝数及抓取时点、实际有效作品样本数、接口真实返回的可比指标、`evidence_coverage`、商业能力五维分项、稳定与风险、`commercial_evidence_coverage`、推荐角色、结论、内容命题和签约前待核事项。缺失完播率、受众、报价、GMV或转化时保留 `null`，不补估。

最后给出：

- 达人组合及各自任务；
- 适用模式下的预算闭合、测试方式和有依据的加投阈值；
- 合同/排期/素材/评论运营/归因的投前清单；
- 数据能力边界。

`portfolio` 和 `full_plan` 还必须按 [数据契约](references/data-contract.md) 输出 `monitoring_handoff`，供 `brand-campaign-monitoring` 直接消费。交接包至少包括：计划 ID/版本、带平台的达人监测注册表、发布窗口与交付数量、角色/场景/信息点、预算分配、指标公式与阈值、逐指标基线、一方数据映射、查询/风险清单引用和计划状态。

内容 URL 在投前未知时保持空值，并以 `platform + creator_id + planned_publish_window` 作为发现任务；上线后补入内容 ID/URL。替补启用、达人取消或计划改版时递增版本并保留旧版本，不静默覆盖。

本 Skill 的终点是投前方案。发布后的持续采集、动态调预算属于投中监测；对实际传播或销售结果的评价属于投后复盘，不在本 Skill 中执行。

## 数据与费用护栏

- 只调用完成当前问题所必需的只读接口；先检索、再对入围候选深取。
- 研究预算被指定时，调用前按端点公开价估算，并在可能超额时停止并报告。
- 缓存同一达人、同一时间窗口的原始结果，避免重复付费调用。
- 厂商 Key 仅由后台读取；技能不得读取或展示任何用户 Token/厂商凭据。
- 不调用下单、邀约、私信、登录、支付或改变第三方状态的接口，除非用户在当次请求中明确授权。

## 事实边界

公开作品数据通常可支持内容表现、标题可见品牌合作与公开互动的判断。以下信息必须有相应授权数据或可验证接口才可下结论：

- 推荐/搜索/关注/主页/付费等真实流量来源；
- 商业内容的官方精确占比；
- 评论的完整负面率与情绪分布；
- 星图订单、排他合同、实际成交与 ROI；
- 用户是否真实养宠、带娃或购买过产品。

对于以上字段，使用“待核验”“平台模型标签”“标题可见推断”等准确措辞，不将推断包装为事实。
