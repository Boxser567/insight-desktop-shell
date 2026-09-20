/** Product integration dictionary keys. */
export type InsightDesktopKey =
  | 'skill.placeholder'
  | 'skill.title'
  | 'skill.selected'
  | 'skill.search'
  | 'skill.empty'
  | 'skill.unavailable'
  | 'account.settings'
  | 'account.signOut'
  | 'account.unavailable'
  | 'settings.nav'
  | 'settings.title'
  | 'settings.version'
  | 'settings.environment'
  | 'settings.environment.test'
  | 'settings.environment.production'
  | 'settings.platform'
  | 'settings.platform.darwin'
  | 'settings.platform.win32'
  | 'settings.platform.linux'

export const zh: Record<InsightDesktopKey, string> = {
  'skill.placeholder': '专家技能',
  'skill.title': 'Skill',
  'skill.selected': '已选技能',
  'skill.search': '搜索技能',
  'skill.empty': '没有匹配的技能',
  'skill.unavailable': '技能目录暂不可用',
  'account.settings': '设置',
  'account.signOut': '退出登录',
  'account.unavailable': '账号信息不可用',
  'settings.nav': '客户端',
  'settings.title': '因赛AI 客户端',
  'settings.version': '版本',
  'settings.environment': '服务环境',
  'settings.environment.test': '测试环境',
  'settings.environment.production': '生产环境',
  'settings.platform': '系统平台',
  'settings.platform.darwin': 'macOS',
  'settings.platform.win32': 'Windows',
  'settings.platform.linux': 'Linux'
}

export const en: Record<InsightDesktopKey, string> = {
  'skill.placeholder': 'Expert Skills',
  'skill.title': 'Skill',
  'skill.selected': 'Selected skills',
  'skill.search': 'Search skills',
  'skill.empty': 'No matching skills',
  'skill.unavailable': 'Skill catalog unavailable',
  'account.settings': 'Settings',
  'account.signOut': 'Sign Out',
  'account.unavailable': 'Account unavailable',
  'settings.nav': 'Desktop',
  'settings.title': 'Insight AI Desktop',
  'settings.version': 'Version',
  'settings.environment': 'Service environment',
  'settings.environment.test': 'Test',
  'settings.environment.production': 'Production',
  'settings.platform': 'Platform',
  'settings.platform.darwin': 'macOS',
  'settings.platform.win32': 'Windows',
  'settings.platform.linux': 'Linux'
}
