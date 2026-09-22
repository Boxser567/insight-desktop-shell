import type { SkillPresentation } from './skill-presentation'

/**
 * Build-time fallback for first-party Skill labels.
 *
 * The sidecar remains the source of truth and is read at runtime when the
 * native Skill path is available. This map keeps the product-owned picker
 * usable when the Core workspace-files remote cannot read an app resource
 * path (for example, during an isolated or older runtime session).
 */
export const BUNDLED_SKILL_PRESENTATIONS: Readonly<Record<string, SkillPresentation>> = {
  'brand-campaign-monitoring': {
    displayName: '品牌活动监测',
    shortDescription: '跟踪品牌传播与社媒舆情，识别风险并提供优化建议。'
  },
  'call-insight-api': {
    displayName: '因赛多模态',
    shortDescription: '查询可用模型，生成或解析图片、视频、音频和文本。'
  },
  'category-competitor-insight': {
    displayName: '品类与竞品洞察',
    shortDescription: '分析品类机会、竞品内容和用户需求，支持营销决策。'
  },
  'creative-generation-evaluation': {
    displayName: '创意生成与评估',
    shortDescription: '结合洞察和参考案例生成创意，并评估方案质量。'
  },
  'creator-recommendation': {
    displayName: '达人推荐',
    shortDescription: '发现并筛选合适达人，规划预算内的投放组合。'
  },
  'human-needs-insight': {
    displayName: '人性需求洞察',
    shortDescription: '从客户需求中提炼消费者洞察与创意方向。'
  },
  'influencer-integration': {
    displayName: '达人整合营销',
    shortDescription: '制定多平台达人投放、传播与效果评估方案。'
  },
  'influencer-seeding': {
    displayName: '达人种草策划',
    shortDescription: '策划达人种草内容、投放矩阵与传播节奏。'
  },
  'inspiration-api': {
    displayName: '营销灵感库',
    shortDescription: '检索营销案例、查看案例详情与相关标签。'
  },
  'marketing-integrated': {
    displayName: '整合营销策划',
    shortDescription: '制定品牌战略及线上线下全渠道营销方案。'
  },
  'media-generator': {
    displayName: '多媒体创作',
    shortDescription: '生成或编辑图片、视频、音频，解析多媒体内容。'
  },
  'soccor-proposal': {
    displayName: '品牌策略提案',
    shortDescription: '梳理品牌定位、价值主张与创意概念，形成策略提案。'
  }
}

/** Classify the winning native source; a matching name alone is not bundled. */
export function isBundledSkill(name: string, path?: string): boolean {
  if (!path || !Object.hasOwn(BUNDLED_SKILL_PRESENTATIONS, name)) return false
  const parts = path.split(/[\\/]/u)
  return parts.at(-3) === 'bundled-skills' && parts.at(-2) === name && parts.at(-1) === 'SKILL.md'
}

export function bundledSkillPresentation(name: string, path?: string): SkillPresentation {
  if (!isBundledSkill(name, path)) return {}
  return BUNDLED_SKILL_PRESENTATIONS[name] ?? {}
}
