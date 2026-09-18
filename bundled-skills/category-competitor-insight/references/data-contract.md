# 数据契约

所有事实都应先转为可追溯记录；允许接口字段随平台变化，但不可丢失来源、时间、查询和证据等级。

```yaml
evidence_record:
  evidence_id: string
  type: trend | content | comment | creator | ad
  platform: douyin | xiaohongshu | bilibili | weibo | zhihu | kuaishou | wechat_search | wechat_mp | wechat_channels | tiktok | instagram | youtube | reddit | twitter | threads | linkedin | lemon8 | toutiao | xigua | pipixia | other
  endpoint: string
  endpoint_version: string | null
  route_status: core | fallback | partial | known_object | authorized | unavailable
  discovery_mode: keyword | feed | trend | account | known_url | known_id
  identifier_type: string | null
  business_status: valid | empty_valid | degraded | unauthorized | timeout | invalid
  fallback_from: string | null
  query: string | null
  captured_at: ISO-8601
  published_at: ISO-8601 | null
  source_id: string | null
  source_url: string | null
  fact: string
  evidence_level: A | B | C | D
  relevance: high | medium | low
  limitation: string | null
```

```yaml
category_signal:
  theme: string
  scenario: string
  signal_type: trend | related_query | hot_topic | content_cluster
  observation: string
  evidence_ids: [string]
  period: string

competitor_content:
  competitor: string
  content_id: string
  platform: string
  published_at: ISO-8601 | null
  captured_at: ISO-8601
  content_age_hours: number | null
  content_format: video | image_text | livestream_clip | unknown
  visible_proposition: string | null
  visible_scenario: string | null
  proof_mechanism: string | null
  visible_metrics:
    views: number | null
    likes: number | null
    comments: number | null
    shares: number | null
    saves: number | null
    metric_basis: views | reads | impressions | followers | unavailable
    metric_definition: string
    available_fields: [string]
  within_platform_percentile: number | null
  evidence_id: string

user_voice:
  source_id: string
  platform: string
  source_type: post | comment
  theme: need | objection | comparison_criterion | purchase_trigger | language
  paraphrase: string
  original_excerpt: string | null
  evidence_id: string
```

## 下游交接对象

`full_analysis` 和产生可执行机会卡的 `deep_dive` 应输出以下稳定对象：

```yaml
insight_handoff:
  handoff_id: string
  version: string
  generated_at: ISO-8601
  brand: string
  product: string
  category: string
  research_window: { start_at: ISO-8601 | null, end_at: ISO-8601 | null }
  opportunity_inputs:
    - opportunity_id: string
      priority: high | medium | hypothesis
      scenarios: [string]
      target_audiences: [string]
      user_tensions: [string]
      action_proofs: [string]
      creator_archetypes: [string]
      unsuitable_expressions: [string]
      claim_guardrails: [string]
      evidence_ids: [string]
  query_manifest:
    - query_id: string
      query_type: brand | product | category | competitor | campaign_seed | risk | search_exclusion
      terms: [string]
      purpose: string
      platforms: [string]
  risk_watchlist:
    - risk_id: string
      theme: string
      severity_hint: low | medium | high
      trigger_terms: [string]
      evidence_ids: [string]
  baseline_candidates:
    - baseline_id: string
      metric: string
      scope: brand | competitor | category | topic
      value: number | null
      unit: string | null
      sample_size: number | null
      window: string
      evidence_ids: [string]
  evidence_manifest:
    - evidence_id: string
      cache_key: string | null
      captured_at: ISO-8601
      valid_until: ISO-8601 | null
      reusable_for: [creator_recommendation, campaign_monitoring]
```

`risk` 是需要主动检索和告警的主题；`search_exclusion` 只用于消除同名、无关品类或噪声。两者不得共用同一字段。`baseline_candidates` 只是投前候选基线，下游采用时仍须检查指标口径、窗口和样本是否可比。

## 证据等级

|等级|含义|允许的写法|
|---|---|---|
|A|接口直接返回的数值、内容或评论记录|“样本中出现…”、“接口显示…”|
|B|标题、正文、标签等公开可见事实的保守归纳|“公开内容可见…”|
|C|由 A/B 推出的策略判断|“建议以…测试”|
|D|尚未获得或需授权核验的信息|“待核验”|

`A/B` 可以支撑事实层，`C` 必须指向对应的 `evidence_id`，`D` 不能被写作已证实结论。评论、标题和标签只能代表抽取到的公开样本；不用于推导完整情绪占比、全体用户偏好或实际购买。

## 采样与相关性

- 内容先按标题、正文、话题、品牌/产品词和场景判断相关性；`low` 相关样本不得参与核心结论。
- 同一内容、同一查询、同一抓取周期只保留一条标准化记录；不同查询命中同一内容时合并查询来源。
- 引用内容必须保留 `source_id`；如平台提供稳定可访问链接，同时保留 `source_url`。短期签名媒体链接、`xsec_token`、`sign`、Cookie 型字段和调试上下文一律丢弃，不得进入缓存、模型上下文或报告。
- 缺失播放、评论或发布时间时保留 `null`，不得补造或用其他平台数据替代。
- 下游使用相同 `cache_key` 且仍在 `valid_until` 内时复用现有证据；重采后生成新证据记录，不覆盖旧抓取时点。
- `route_status` 与 `business_status` 分开：平台可能整体为 `partial`，但某条已知对象详情仍是 `valid`。
- 原始互动只在同平台、同内容形态、相近 `content_age_hours` 和一致采样方式下比较；跨平台比较使用主题、平台内分位或标准化变化，不直接汇总绝对值。
- 评论接口不可用时不得创建 `user_voice` 评论记录；内容级评论数字段可保留，但不能替代评论文本。

## 禁止推导

不可由本契约中的公开数据直接推出：销量、GMV、ROI、市场份额、真实流量来源、打开率、点击率、实际转化、完整负面率、真实用户身份或合同排他。
