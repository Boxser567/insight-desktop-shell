# 达人推荐数据契约

## 统一输入

数据工具层应返回可追溯的结构化对象；接口原始字段可变化，但输出字段保持稳定。

```yaml
creator:
  creator_key: "platform:creator_id"
  platform: string
  creator_id: string
  entity_cluster_id: string | null
  identity_confidence: high | medium | low | unverified
  identity_evidence: [string]
  nickname: string
  captured_at: ISO-8601
  source_endpoint: string
  source_version: string
  route_status:
    discovery: live | fallback | catalog | failed | seed_only
    profile: live | fallback | catalog | failed | unavailable
    posts: live | fallback | catalog | failed | unavailable
    comments: live | fallback | catalog | failed | unavailable
    audience: live | catalog | authorized | failed | unavailable
    quote: live | user_provided | authorized | failed | unavailable
    commerce: live | catalog | authorized | failed | unavailable
    conversion: live | catalog | authorized | failed | unavailable
  evidence_coverage:
    available_dimensions: [scene_fit, stable_performance, audience, category_history, price, seeding, conversion]
    missing_dimensions: [string]
    comparable_score_available: true | false
  profile:
    followers: number | null
    followers_captured_at: ISO-8601 | null
    category_labels: [string]
    quote: { min: number | null, max: number | null, currency: string | null }
    quote_source: xingtu | platform_backend | mcn | creator | user | unavailable
    forecast_play: number | null
    forecast_cpm: number | null
    forecast_cpe: number | null
  recent_posts:
    period: latest_10
    posts:
      - item_id: string
        published_at: ISO-8601 | null
        content_age_hours: number | null
        content_format: short_video | long_video | image_text | article | post | other
        title: string | null
        labels: [string]
        views: number | null
        likes: number | null
        comments: number | null
        shares: number | null
        completion_rate: number | null
        interaction_rate: number | null
        metric_basis: views | reads | impressions | followers | unavailable
        available_metrics: [string]
        visible_brands: [string]
        category_tags: [string]
    median_views: number | null
    median_completion_rate: number | null
    median_interaction_rate: number | null
    view_range: { min: number | null, max: number | null }
    title_visible_commercial_density: number | null
    direct_category_density: number | null
  historical_evidence:
    brand_posts: [post_evidence]
    competitor_posts: [post_evidence]
  audience:
    source: xingtu | platform_model | authorized_backend | unavailable
    status: verified | modelled | authorized | unavailable
    gender: [{ label: string, share: number }]
    age: [{ label: string, share: number }]
    city_tier: [{ label: string, share: number }]
    city: [{ label: string, share: number }]
    interests: [{ label: string, share: number }]
    life_stage_labels: [{ label: string, share: number }]
  comments:
    sampled_item_ids: [string]
    purchase_intent_signals: [string]
    product_questions: [string]
    negative_signals: [string]
    ad_fatigue_signals: [string]
    status: verified | unavailable | requires_authorization
  commercial_capability:
    cohort_definition: string | null
    recommendation_fit_score: number | null
    commercial_capability_score: number | null
    risk_adjusted_score: number | null
    commercial_evidence_coverage: number
    strongest_capabilities: [reach | audience_fit | seeding | conversion | cost_efficiency]
    recommended_roles: [声量 | 专业验证 | 场景种草 | 搜索内容 | 转化测试 | 素材资产]
    dimensions:
      reach: { score: number | null, evidence_refs: [string] }
      audience_fit: { score: number | null, evidence_refs: [string] }
      seeding: { score: number | null, evidence_refs: [string] }
      conversion: { score: number | null, evidence_refs: [string] }
      cost_efficiency: { score: number | null, evidence_refs: [string] }
      risk: { level: low | medium | high | unknown, penalty: number | null, evidence_refs: [string] }
    commerce_signals:
      gmv_range: { min: number | null, max: number | null, currency: string | null }
      product_click_range: { min: number | null, max: number | null }
      click_through_rate_range: { min: number | null, max: number | null }
      conversion_rate_range: { min: number | null, max: number | null }
      related_video_count: number | null
      related_product_count: number | null
      representative_video_refs: [string]
      representative_product_refs: [string]
    evidence:
      - evidence_ref: string
        metric: string
        value: number | string | object | null
        evidence_type: observed_public | platform_estimate | authorized_actual | model_derived | missing
        source_endpoint: string | null
        captured_at: ISO-8601 | null
        note: string | null
  limitations: [string]
```

## 投放组合输出

`portfolio` 和 `full_plan` 模式使用以下稳定结构：

```yaml
portfolio_plan:
  plan_id: string
  version: string
  generated_at: ISO-8601
  mode: portfolio | full_plan
  objective: [string]
  total_budget: { amount: number | null, currency: CNY }
  budget_status: closed | partial | not_plannable
  assumptions: [string]
  selected_creators:
    - creator_key: string
      platform: string
      creator_id: string
      entity_cluster_id: string | null
      primary_role: string
      secondary_roles: [string]
      assigned_scenario: string
      content_task: string
      capability_role_basis: [reach | audience_fit | seeding | conversion | cost_efficiency]
      commercial_capability_score: number | null
      commercial_evidence_coverage: number
      creator_fee: number | null
      selection_reason: string
      replacement_creator_id: string | null
      gating_checks: [string]
  coverage:
    roles: [{ label: string, creators: [string], status: covered | gap | overlap }]
    audiences: [{ label: string, creators: [string], status: covered | gap | overlap }]
    scenarios: [{ label: string, creators: [string], status: covered | gap | overlap }]
    formats: [{ label: string, creators: [string], status: covered | gap | overlap }]
  budget_lines:
    - category: creator_fee | production_and_rights | paid_amplification | conversion_and_measurement | contingency
      amount: number | null
      status: quoted | estimated | reserved | unknown
      note: string
  phases:
    - name: string
      creators: [string]
      release_condition: string | null
      observation_window: string | null
      success_rules: [decision_rule]
      stop_rules: [decision_rule]
  risks: [string]
  unresolved_costs: [string]
  monitoring_handoff: monitoring_handoff
```

`decision_rule` 至少记录指标、比较基准、方向和数据来源。缺少有依据的阈值时保留相对规则，不填造数值。

## 投中监测交接

```yaml
monitoring_handoff:
  handoff_id: string
  plan_id: string
  plan_version: string
  generated_at: ISO-8601
  campaign:
    name: string | null
    start_at: ISO-8601 | null
    end_at: ISO-8601 | null
    objectives: [string]
  tracking_registry:
    - tracking_id: string
      platform: string
      creator_id: string
      creator_name: string | null
      profile_url: string | null
      plan_status: planned | confirmed | replaced | cancelled
      primary_role: string
      scenario: string
      message_points: [string]
      deliverables: [string]
      planned_content_count: number | null
      planned_publish_window: { start_at: ISO-8601 | null, end_at: ISO-8601 | null }
      content_ids: [string]
      content_urls: [string]
      replacement_tracking_id: string | null
      allocated_budget: { amount: number | null, currency: CNY }
  kpi_definitions:
    - kpi_id: string
      metric: string
      formula: string
      numerator: string | null
      denominator: string | null
      source: public_api | ad_platform | ecommerce | crm | survey | other
      observation_window: string
      data_lag: string | null
      target_value: number | null
      target_direction: above | below | within | relative
      baseline_ids: [string]
      comparator: gt | gte | lt | lte | between | percentile | null
      baseline_logic: all | any | mean | median | specific | null
      relative_delta: number | null
      relative_delta_unit: absolute | percent | percentile_point | null
      success_action: string
      stop_action: string
      owner: string | null
  baselines:
    - baseline_id: string
      platform: string | null
      tracking_ids: [string]
      metric: string
      scope_type: creator | cohort | brand | campaign | competitor
      scope_id: string | null
      value: number | null
      unit: string | null
      sample_size: number | null
      window: string
      captured_at: ISO-8601 | null
      source_ref: string
  first_party_mapping:
    - metric: string
      source: string
      join_key: string | null
      availability: available | planned | unavailable
  upstream_context:
    insight_handoff_id: string | null
    accepted_learning_return_ids: [string]
    query_manifest: [object]
    risk_watchlist: [object]
    evidence_manifest: [object]
```

`tracking_id` 在计划版本间保持稳定，除非换成不同达人/账号；替补启用时新旧记录通过 `replacement_tracking_id` 关联。`kpi_definitions` 负责锁定同名指标的公式、分母、窗口和数据源，防止投中阶段重新解释“互动率”“搜索提升”或“转化”。

当 `target_direction=relative` 时，`comparator`、`baseline_logic`、`baseline_ids` 与 `relative_delta` 必须共同给出；若没有有依据的相对幅度，将 `relative_delta` 保持 `null` 并把该规则标为观察规则，不得用于自动加投/停止。达人或内容基线必须通过 `tracking_ids` 关联注册表对象；跨平台时同时填写 `platform`。

## 字段解释

- `followers`：抓取时点的原始粉丝数，必须在候选横向表与逐人尽调卡展示；不可仅用“万”或“百万”模糊代替原始值。粉丝数用于判断账号规模，不能作为播放或转化表现的替代指标。
- `followers_captured_at`：粉丝数的获取时间。粉丝数会变化；若该字段缺失，报告应标注“粉丝数时点未确认”。
- `median_views`：最新 10 条有播放数据作品排序后的中位数；偶数样本取中间两项平均值。样本不足时注明有效样本数。
- `completion_rate` / `median_completion_rate`：作品完成播放率及近 10 条中位数。记录接口原始口径；不可与不同视频时长、不同平台口径直接做绝对比较。
- `interaction_rate` / `median_interaction_rate`：接口返回的互动率及近 10 条中位数。点赞、评论、分享须同时保留，以便判断互动构成，不能只展示一个百分比。
- `creator_key` 是账号唯一键；`entity_cluster_id` 只在身份有可验证证据时用于跨平台去重。账号投放位与自然人/机构实体数必须分别统计。
- `evidence_coverage` 显示本平台实际可评分维度。缺失受众或报价不计为零，也不允许用推断补齐；跨平台不得按一个总分排序。
- `recommendation_fit_score` 回答“是否适合本次项目”，`commercial_capability_score` 回答“已有哪些可验证的商业能力”；两者必须分列，不得合并成一个无法解释的推荐分。
- `commercial_evidence_coverage` 按商业能力五个正向维度的原始权重计算。目标关键维度缺失时，综合商业能力分为 `null`，不得通过重归一化掩盖缺口。
- `commerce_signals` 优先保存接口原始区间和对象引用。GMV、点击、转化率等星图字段若为预估或区间，`evidence_type` 必须是 `platform_estimate`；只有授权后台实际结果才可标记 `authorized_actual`。
- `dimensions.*.evidence_refs` 必须指向 `commercial_capability.evidence[].evidence_ref`，使每个分项分数可回溯到原始事实；不能只写“带货能力强”。
- `recommended_roles` 必须由强项、目标适配和风险共同决定，并在组合方案中通过 `capability_role_basis` 保留依据。
- `recent_posts` 使用最多 10 条实际有效样本。没有作品列表路由或字段不足时保留真实样本数；完播率、互动率或播放缺失均为 `null`。
- `audience.source` 必须指向直接数据来源。内容题材、用户名或评论不能用于推断真实年龄、性别、城市级别或人生阶段。
- `followers` 与 `median_views` 应并列展示，用于识别账号规模和近期内容效率的关系；不得据此推导真实流量来源、成交或 ROI。
- `title_visible_commercial_density`：标题、标签或可见品牌字段中能识别为品牌/商品合作的作品占比，是保守近似，不能称为“官方商业内容占比”。
- `direct_category_density`：与本次品类直接相关的作品占比。例如扫地机项目中，扫地机、洗地机、吸尘器等应单列，避免把所有广告混在一起。
- `historical_evidence`：每条需保留作品 ID、可见品牌、发布时间、播放与互动；区分本品、直接竞品、相邻竞争品类。
- `audience`：星图/平台模型标签，须保留原始标签与占比，不将兴趣标签等同于真实家庭身份。
- `comments.status`：没有可访问的逐条评论时必须是 `unavailable` 或 `requires_authorization`，其他评论字段保持空值。
- `budget_status=closed` 时，所有非空 `budget_lines.amount` 合计不得超过 `total_budget.amount`，且未知交易成本已被明确预留；否则使用 `partial`。
- `coverage.status=overlap` 表示多个达人承担高度相似的任务，需要说明保留重复覆盖的理由；没有增量价值的高分达人应进入替补而非机械入选。
- `decision_rule` 的基准优先级为品牌已确认目标、达人自身近期基线、同批同口径中位表现；平台预估与策略阈值必须明确标注，不能写成真实结果。
- `monitoring_handoff` 只能携带已确认值或明确的 `null`。缺少内容 URL 不等于无需监测，应按平台、达人和发布时间窗口执行发现任务。
- 计划改版、替补启用或预算重分配时生成新 `plan_version`；旧版本用于解释历史决策，不得覆盖。
- `upstream_context` 携带可独立消费的完整对象，不能只给无法解析的字符串引用；引用 ID 用于追溯，不替代实际查询、风险和证据字段。

## 结论的证据等级

|等级|含义|可使用的表述|
|---|---|---|
|A|接口或后台的直接数值/作品记录|“近 10 条中位播放为…”|
|B|标题、标签、公开内容中的可见事实|“标题可见近期出现…”|
|C|根据 A/B 得到的运营判断|“适合以…场景测试”|
|D|尚未获取的数据|“需在签约前核验”|
