---
name: category-competitor-insight
description: Use when 品牌需要新品定位、品类机会、竞品内容、用户需求或达人投放前洞察；不用于持续舆情告警、投中监测、销量、ROI 或市场份额估算。
metadata:
  displayName: "品类竞品洞察"
  order: 7

---
## 企业版数据调用

本技能通过本目录 `scripts/enterprise_proxy.mjs` 调用后台的 `tikhub` 连接。请用插件提供的 `DSH_SKILL_PROXY_NODE`（内置 Node.js 绝对路径）运行，不依赖系统 node/Python；脚本路径有空格时加引号。PowerShell 用 `& $env:DSH_SKILL_PROXY_NODE "<skill>/scripts/enterprise_proxy.mjs" ...`。它使用本地企业插件桥接，不注册新的模型工具。插件自动携带登录态，后台注入 TikHub Key。

以技能加载结果中的实际目录替换 `<skill>`，不要硬编码其他人的 home 路径。路由/参数继续参考本技能 references；以下是调用示例，不代表授权批量采集：

```bash
"$DSH_SKILL_PROXY_NODE" <skill>/scripts/enterprise_proxy.mjs tikhub POST /api/v1/douyin/search/fetch_general_search_v2 --body '{"keyword":"家居","cursor":0}'
"$DSH_SKILL_PROXY_NODE" <skill>/scripts/enterprise_proxy.mjs tikhub GET /api/v1/xiaohongshu/app_v2/search_notes --query '{"keyword":"家居","page":1}'
```

只读查询按原技能的采样、费用授权和数据质量约束执行。不得读取本机用户 Token、Codex 配置、厂商 Key 或直接请求 TikHub。`DSH_HOME` 由客户端提供；未登录/代理不可用时请用户启动更新后的客户端并登录。`SKILL_PROXY_ROUTE_FORBIDDEN` 表示后台尚未开放路由，联系管理员，不尝试绕过。超时/断连不代表上游未执行，不自动重试。


# 品类与竞品洞察

## 目标

把“什么需求和场景值得进入”“竞品如何争夺它”“用户真实认可或质疑什么”串成一份能直接进入内容策略和达人推荐的证据链。主交付是按优先级排序的机会卡片，不是三份彼此独立的报告。

默认使用本技能的企业代理脚本访问 TikHub。不得保存、索取、展示或写入 API Key、Cookie、账号密码等凭证。

## 输入

从上下文提取以下字段。缺少不会改变研究边界的信息时，明确假设后继续；缺少会改变品类、竞品或目标用户定义的信息时再向用户确认。

```yaml
research_brief:
  brand: 品牌名
  product: 产品/型号
  category: 品类
  product_proposition: [产品主张或差异点]
  target_audience: [目标人群或生活场景]
  competitors: [竞品品牌或产品]
  platforms: [auto, douyin, xiaohongshu, bilibili, weibo, zhihu, kuaishou, wechat_search, wechat_mp, wechat_channels, tiktok, instagram, youtube, reddit, twitter, threads, linkedin, lemon8, toutiao, xigua, pipixia]
  platform_policy: core_only | include_partial | known_objects_allowed
  period: 近30天
  objective: 新品定位 | 内容策略 | 达人投放前洞察 | 竞品研究
  mode: quick_scan | full_analysis | deep_dive
  focus_modules: [category, competitor, user_voice] # 仅 deep_dive 使用
  data_research_cap_usd: 可选
  downstream: [creator_recommendation, campaign_monitoring]
  previous_learning_returns: [可选，来自 brand-campaign-monitoring]
```

## 模式

- `quick_scan`：低成本判断是否存在值得深挖的机会；只输出待验证假设与下一步取数建议。
- `full_analysis`：运行品类、竞品、用户讨论三模块，输出已分级的机会卡片、竞品内容矩阵和证据清单。
- `deep_dive`：按 `focus_modules` 运行一个或多个模块；仍遵守同一数据契约和事实边界。

开始前阅读 [数据契约](references/data-contract.md)。涉及平台选择或接口调用时必须读取 [平台路由与可比性规则](references/platform-routing.md)。综合结论前阅读 [机会卡规则](references/opportunity-card.md)，出报告前阅读 [报告模板](references/report-template.md)。

## 工作流

### 1. 建立检索框架

将产品主张拆成三组词，并记录查询意图：

1. 品类词：产品、相邻品类、核心使用场景；
2. 需求/异议词：任务、痛点、顾虑与用户自然说法；
3. 竞争词：本品、竞品、产品型号与可比较卖点。

不要把品牌词、泛类目词和症状/场景词混成单一查询。先用窄查询确认相关性，再扩展同义词。对每个聚合结论抽查样本，剔除同名、无关品类、搬运和明显营销噪声。

若输入包含 `previous_learning_returns`，逐条按 `return_id` 读取并判断采纳、拒绝或待验证。采纳的结果创建新的机会卡/查询集版本并引用原 `return_id`；不得覆盖历史机会卡或把投中观察自动升级为普遍品类事实。

### 2. 品类机会雷达

按 [平台路由与可比性规则](references/platform-routing.md) 选择与目标市场、内容形态和问题相匹配的 `core/fallback` 入口；`partial/known_object` 只回答其明确支持的子问题。用趋势、热榜、内容搜索或已知对象识别需求热度、关联词、典型使用场景和近期内容信号。只有接口直接返回的数值才可称为趋势数据。

输出是“需求—场景—内容信号”而非泛泛的热点词。趋势或搜索信号只能说明公开内容/搜索兴趣，不能等同销量、市场规模或购买意图。

### 3. 竞品内容情报

按竞品和品类词检索公开内容；对相关样本记录标题/正文可见的主张、场景、内容形式、互动、发布时间、话题和来源 ID。比较竞品的叙事占位、展示证据、评论讨论与内容空白。

对比的是内容表达及公开表现，不得将搜索结果量、互动量或单条爆款写成市场份额、销售表现或品牌整体投放规模。若某竞品样本不足，标为“公开样本不足”，不作强弱排序。

原始互动指标只在同平台、同内容形态、相近内容年龄与一致采样方式下比较。跨平台只比较主题覆盖、叙事占位、证据形式、平台内分位或标准化变化；不得把不同平台的绝对播放/阅读/互动相加排名。

### 4. 用户需求与异议聆听

围绕需求/异议词和高相关内容，提取公开正文及可访问的逐条评论。归纳购买触发、使用困扰、比较标准、疑问、反感与用户原生表达；每项必须保留原始内容或评论的 source ID。

评论无法获得、样本不相关或无法覆盖足够上下文时，写“待验证”或“公开样本不足”。不得虚构情绪分布、负面率、真实购买人群或完整评论结论。

TikTok、Instagram 等已知评论路由失败的平台不生成 `user_voice` 评论样本；视频号等发现入口为空的平台仅在已有 URL/ID/账号时进入详情链。

### 5. 机会综合

只在两种及以上独立证据相互支持时，生成可行动机会卡片；例如“趋势/内容”“竞品/用户讨论”或“内容/评论”。只有一种证据、结论冲突或样本显著不足时，只保留为待验证假设。

每张卡片要回答：谁在什么场景下有什么张力、竞品在讲什么、空白在哪里、可如何表达、证据是什么、风险是什么、下一步怎样验证。按 [机会卡规则](references/opportunity-card.md) 标记置信度，不把策略判断伪装成数据事实。

### 6. 输出与衔接

按 [报告模板](references/report-template.md) 输出，并标明数据抓取日期、平台、时间范围、查询词与样本限制。为后续达人推荐提供：优先场景、目标受众、可拍动作证据、禁用/高风险表达和应匹配的达人类型；不得直接把洞察结果当作达人或投放效果保证。

同时按 [数据契约](references/data-contract.md) 输出 `insight_handoff`。该对象是后续 Skill 的正式输入，而不是报告摘要，至少包含：稳定的机会 ID、优先场景与人群、动作证据、达人类型、主张护栏、品牌/产品/竞品/风险查询词、搜索降噪词、投前基线候选和可复用证据清单。

- 交给 `creator-recommendation` 时，将机会场景、人群、动作证据、达人类型和主张护栏映射到 `brand_brief.upstream_insight`；“适合达人类型”只是筛选方向，不是已验证候选。
- 若战役随后需要监测，将查询词、风险主题、竞品和投前证据交给 `brand-campaign-monitoring`；风险主题与搜索降噪词是两个字段，不得混用。
- 下游优先复用仍在有效窗口内的 `evidence_manifest`，只有字段缺失、数据过期或任务窗口改变时才补采，避免重复付费。

## 数据、版本与费用护栏

- 同一接口存在多个版本时，优先使用最近实测成功、业务字段有效的路由；新版失败时使用已验证 fallback。HTTP 或顶层 200 不代表业务数据有效。在证据记录中写入端点、版本和降级状态。
- 只调用完成问题所必需的只读接口：先做小样本相关性验证，再扩大到高相关内容/评论；缓存相同查询与内容详情，避免重复付费。
- 用户指定研究预算时，在扩样前按公开单价估算；预计超限时缩小平台、时间窗或样本量并说明影响。
- 厂商 Key 仅由后台读取；技能不得读取或展示任何用户 Token/厂商凭据。
- 响应中可能包含短期媒体签名 URL、`xsec_token`、`sign`、Cookie 型字段或调试上下文；在进入缓存、模型上下文、证据记录和报告前一律丢弃。`source_url` 仅可保留稳定的公开页面链接，否则置空。
- 不调用登录、私信、下单、邀约、支付或其他改变第三方状态的接口，除非用户在当次请求中明确授权。

## 事实边界

以下内容只可在取得对应授权数据或直接可验证接口后下结论：销售/GMV/ROI、市场份额、真实流量来源、点击率、打开率、真实转化、完整评论情绪分布、真实用户身份与竞品合作合同。对尚未取得的数据使用“待核验”“公开样本显示”或“策略假设”等准确措辞。

## 与持续监测的边界

本 Skill 负责有明确研究窗口的投前策略问题和机会判断。若用户要求持续追踪、定时告警、战役发布后的表现判断或加投/暂停建议，移交 `brand-campaign-monitoring`；可将本 Skill 的 `insight_handoff` 作为其投前查询集与基线输入。
