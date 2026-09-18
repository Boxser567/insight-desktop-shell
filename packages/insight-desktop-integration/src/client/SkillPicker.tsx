import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { filterSkills, selectedSkillNames, type InsightSkill } from '../skill-catalog'
import type { SkillCatalog } from '@deepseek-ai/dsh-client-ui-skill/client'

type SkillPickerProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'insightDesktop'> & {
  catalog: SkillCatalog
}

/** Selection is derived from the visible draft, never retained after sending. */
export function SkillPicker({ sessionId, useInput, inputActions, catalog, t }: SkillPickerProps) {
  const draft = useInput(input => {
    let text = input.draft
    // Reference labels can contain slash text; only editable text selects skills.
    for (const occurrence of [...input.occurrences].reverse()) {
      text = text.slice(0, occurrence.offset) + ' '.repeat(occurrence.length) + text.slice(occurrence.offset + occurrence.length)
    }
    return text
  })
  const locked = useInput(input => input.phase !== 'plain')
  const [state, setState] = useState<{ sessionId: string; skills: readonly InsightSkill[]; available: boolean }>({ sessionId, skills: [], available: false })
  useEffect(() => {
    let alive = true
    let request = 0
    const refresh = () => {
      const current = ++request
      catalog.list(sessionId).then(skills => {
        if (alive && current === request) setState({ sessionId, skills, available: true })
      }, () => {
        if (alive && current === request) setState({ sessionId, skills: [], available: false })
      })
    }
    const off = catalog.subscribe(sessionId, refresh)
    refresh()
    return () => { alive = false; off() }
  }, [catalog, sessionId])
  return <SkillPickerMenu key={sessionId} skills={state.sessionId === sessionId ? state.skills : []}
    catalogAvailable={state.sessionId === sessionId && state.available} selected={selectedSkillNames(draft)}
    disabled={locked} onSelect={name => inputActions.toggleSkill(name)} t={t} />
}

type MenuProps = PropsLocale<'insightDesktop'> & {
  skills: readonly InsightSkill[]
  catalogAvailable: boolean
  selected: readonly string[]
  disabled?: boolean
  onSelect(id: string): void
}

/** Searchable draft-backed multiselect, using native skill names. */
export function SkillPickerMenu({ skills, catalogAvailable, selected, disabled, onSelect, t }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<{ left: number; bottom?: number; top?: number; width: number; maxHeight: number }>({ left: 0, bottom: 0, width: 360, maxHeight: 480 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const scrollActive = useRef(false)
  const id = useId()
  const items = filterSkills(skills, query)
  const selectedCount = filterSkills(skills, '').filter(skill => selected.includes(skill.name)).length
  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  const choose = (value: string) => {
    onSelect(value)
    // Native editor mutations focus the composer; retain the menu for another pick.
    setOpen(true)
    search.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(360, window.innerWidth - 24)
      const above = rect.top - 20
      const below = window.innerHeight - rect.bottom - 20
      const placeAbove = above >= 240 || above >= below
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width,
        ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(0, above) }
          : { top: rect.bottom + 8, maxHeight: Math.max(0, below) }) })
    }
    place()
    search.current?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside) }
  }, [open])

  useEffect(() => {
    if (scrollActive.current) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
    scrollActive.current = false
  }, [active, open, query])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => { if (open) search.current?.focus() }, [open, skills])
  useEffect(() => { setActive(index => Math.min(index, Math.max(0, items.length - 1))) }, [items.length])

  const toggle = () => {
    if (open) { close(); return }
    scrollActive.current = true
    setQuery('')
    setActive(Math.max(0, filterSkills(skills, '').findIndex(skill => selected.includes(skill.name))))
    setOpen(true)
  }

  return <>
    <button ref={trigger} type="button" data-insight-skill-trigger aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? `${id}-panel` : undefined} disabled={disabled}
      title={t('skill.title')} onClick={toggle}>
      <span aria-hidden="true">✧</span><span>{selectedCount ? `${t('skill.selected')} ${selectedCount}` : t('skill.placeholder')}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={panel} id={`${id}-panel`} role="dialog" aria-label={t('skill.title')}
      data-insight-skill-panel style={position} onKeyDown={event => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); close() }
        if (event.key === 'Tab') setOpen(false)
      }}>
      <div data-insight-skill-header>
        <span>{t('skill.title')}</span>
      </div>
      <input ref={search} role="combobox" aria-label={t('skill.search')} placeholder={t('skill.search')}
        aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={items[active] ? `${id}-${items[active].name}` : undefined}
        value={query} onChange={event => { scrollActive.current = true; setQuery(event.target.value); setActive(0) }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            scrollActive.current = true
            setActive(index => items.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0)
          } else if (event.key === 'Enter' && items[active]) { event.preventDefault(); choose(items[active].name) }
        }} />
      <div ref={list} id={`${id}-list`} role="listbox" aria-multiselectable="true" aria-label={t('skill.title')} data-insight-skill-list>
        {catalogAvailable && items.map((skill, index) => <div key={skill.name} id={`${id}-${skill.name}`} role="option"
          aria-selected={selected.includes(skill.name)} aria-labelledby={`${id}-${skill.name}-title`} aria-describedby={`${id}-${skill.name}-description`}
          data-active={index === active} onMouseMove={() => { scrollActive.current = false; setActive(index) }} onMouseDown={event => event.preventDefault()} onClick={() => choose(skill.name)}>
          <div data-insight-skill-option-title><span id={`${id}-${skill.name}-title`}>{skill.displayName ?? skill.name}</span><span aria-hidden="true">{selected.includes(skill.name) ? '✓' : ''}</span></div>
          <div id={`${id}-${skill.name}-description`} data-insight-skill-description>{skill.description}</div>
        </div>)}
      </div>
      {(!catalogAvailable || items.length === 0) && <div role="status" data-insight-skill-empty>{t(catalogAvailable ? 'skill.empty' : 'skill.unavailable')}</div>}
    </div>, document.body)}
  </>
}
