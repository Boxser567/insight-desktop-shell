/** Product integration dictionary keys. */
export type InsightDesktopKey =
  | 'skill.loading'
  | 'skill.selectionUnavailable'
  | 'skill.sources'
  | 'skill.platform'
  | 'skill.user'
  | 'skill.incomplete'
  | 'skill.unsupported'
  | 'skill.noUserSkills'
  | 'skill.placeholder'
  | 'skill.title'
  | 'skill.selected'
  | 'skill.search'
  | 'skill.empty'
  | 'skill.unavailable'
  | 'skill.historyUnavailable'
  | 'skill.unavailableLabel'
  | 'account.handbook'
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
  'skill.loading': '正在读取技能…',
  'skill.selectionUnavailable': '所选技能当前不可用；执行时若仍不可用，将按普通消息处理。',
  'skill.sources': '技能来源',
  'skill.platform': '平台预置',
  'skill.user': '用户自定义',
  'skill.incomplete': '部分目录暂未确认，请稍后重试。',
  'skill.unsupported': '当前运行环境不支持用户技能列表。',
  'skill.noUserSkills': '尚未发现全局安装的用户技能',
  'skill.placeholder': '专家技能',
  'skill.title': 'Skill',
  'skill.selected': '已选技能',
  'skill.search': '搜索技能',
  'skill.empty': '没有匹配的技能',
  'skill.unavailable': '技能目录暂不可用',
  'skill.historyUnavailable': '会话历史未成功加载，专家技能暂不可用。请先恢复历史或重新打开会话。',
  'skill.unavailableLabel': '专家技能（暂不可用）',
  'account.handbook': '客户端使用手册',
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
  'skill.loading': 'Loading skills…',
  'skill.selectionUnavailable': 'A selected skill is currently unavailable. If still unavailable at execution, its text is handled as a normal message.',
  'skill.sources': 'Skill sources',
  'skill.platform': 'Platform',
  'skill.user': 'Custom',
  'skill.incomplete': 'Some skill directories could not be confirmed. Try again.',
  'skill.unsupported': 'This runtime does not support custom skill inventory.',
  'skill.noUserSkills': 'No globally installed custom skills found',
  'skill.placeholder': 'Expert Skills',
  'skill.title': 'Skill',
  'skill.selected': 'Selected skills',
  'skill.search': 'Search skills',
  'skill.empty': 'No matching skills',
  'skill.unavailable': 'Skill catalog unavailable',
  'skill.historyUnavailable': 'Session history failed to load, so expert skills are unavailable. Restore history or reopen the conversation first.',
  'skill.unavailableLabel': 'Expert Skills (unavailable)',
  'account.handbook': 'User Guide',
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
