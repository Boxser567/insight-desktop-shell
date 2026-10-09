import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillPickerMenu } from '../src/client/SkillPicker'
import { zh } from '../src/client/locales'
const dictionary: Readonly<Record<string, string>> = zh

describe('expert skills after history failure', () => {
  it('keeps the entry visible and explains history unavailability', () => {
    const html = renderToString(createElement(SkillPickerMenu, {
      skills: [], catalogAvailable: false, selected: [], historyFailed: true,
      onSelect: () => {}, t: key => dictionary[key] ?? key,
    }))
    expect(html).toContain('专家技能（暂不可用）')
    expect(html).toContain('会话历史未成功加载，专家技能暂不可用。请先恢复历史或重新打开会话。')
  })

  it('retains the ordinary entry after history becomes available', () => {
    const html = renderToString(createElement(SkillPickerMenu, {
      skills: [], catalogAvailable: true, selected: [], historyFailed: false,
      onSelect: () => {}, t: key => dictionary[key] ?? key,
    }))
    expect(html).toContain('专家技能</span>')
    expect(html).not.toContain('会话历史未成功加载')
  })
})
