import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('bundled login legal documents', () => {
  it.each([
    ['PrivacyPolicy', '隐私政策', '九、联系我们'],
    ['ServiceAgreement', '软件许可及服务协议', '第二十章']
  ])('%s contains the reviewed document without executable or external content', async (name, title, lastSection) => {
    const html = await readFile(`src/renderer/src/legal/${name}.html`, 'utf8')
    expect(html).toContain(title)
    expect(html.replace(/<[^>]*>/gu, '')).toContain('2026年10月27日')
    expect(html).toContain(lastSection)
    expect(html).toContain('<b>')
    const tags = [...html.matchAll(/<\/?([\w:-]+)\b([^>]*)>/gu)]
    const allowed = new Set(['div', 'p', 'b', 'strong', 'span', 'table', 'tbody', 'tr', 'td', 'th', 'br', 'i', 'u', 'sup', 'sub'])
    for (const [, tag, attributes] of tags) {
      expect(allowed.has(tag!)).toBe(true)
      expect(attributes!.replace(/\s+(?:colspan|rowspan)="\d+"/gu, '').trim()).toBe('')
    }
    expect(html).not.toMatch(/<!--|<script|<style|(?:src|href|style|on\w+)\s*=/iu)
    expect(html).not.toContain('WPS_')
  })
})
