import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { filterSkills, type InsightSkill } from '../skill-catalog'

type SkillPickerProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'insightDesktop'> & {
  skills: readonly InsightSkill[]
  catalogAvailable: boolean
}

/** Session input owns selection; remounting the menu never resets it. */
export function SkillPicker({ sessionId, useInput, inputActions, skills, catalogAvailable, t }: SkillPickerProps) {
  const selected = useInput(input => input.selectedSkills?.[0])
  const locked = useInput(input => input.phase === 'adjudicating' || input.phase === 'submitting')
  return <SkillPickerMenu key={sessionId} skills={skills} catalogAvailable={catalogAvailable} selected={selected}
    disabled={locked} onSelect={id => inputActions.setSelectedSkills(id ? [id] : [])} t={t} />
}

type MenuProps = PropsLocale<'insightDesktop'> & {
  skills: readonly InsightSkill[]
  catalogAvailable: boolean
  selected: string | undefined
  disabled?: boolean
  onSelect(id: string | undefined): void
}

/** Searchable single-select menu; the selected skill survives each successful send. */
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
  const selectedItem = skills.find(skill => skill.id === selected)
  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  const choose = (value: string | undefined) => { onSelect(value); close() }

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
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside) }
  }, [open])

  useEffect(() => {
    if (scrollActive.current) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
    scrollActive.current = false
  }, [active, open, query])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const toggle = () => {
    if (open) { close(); return }
    scrollActive.current = true
    setQuery('')
    setActive(Math.max(0, filterSkills(skills, '').findIndex(skill => skill.id === selected)))
    setOpen(true)
  }

  return <>
    <button ref={trigger} type="button" data-insight-skill-trigger aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? `${id}-panel` : undefined} disabled={disabled}
      title={selectedItem?.description ?? t('skill.hint')} onClick={toggle}>
      <span aria-hidden="true">✧</span><span>{selectedItem?.label ?? selected ?? t('skill.placeholder')}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={panel} id={`${id}-panel`} role="dialog" aria-label={t('skill.title')}
      data-insight-skill-panel style={position} onKeyDown={event => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); close() }
      }}>
      <div data-insight-skill-header>
        <span>{t('skill.title')}</span>
        <button type="button" onClick={() => choose(undefined)} disabled={!selected}>{t('skill.clear')}</button>
      </div>
      <input ref={search} role="combobox" aria-label={t('skill.search')} placeholder={t('skill.search')}
        aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={items[active] ? `${id}-${items[active].id}` : undefined}
        value={query} onChange={event => { scrollActive.current = true; setQuery(event.target.value); setActive(0) }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            scrollActive.current = true
            setActive(index => items.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : 0)
          } else if (event.key === 'Enter' && items[active]) { event.preventDefault(); choose(items[active].id) }
        }} />
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={t('skill.title')} data-insight-skill-list>
        {catalogAvailable && items.map((skill, index) => <div key={skill.id} id={`${id}-${skill.id}`} role="option"
          aria-selected={skill.id === selected} aria-labelledby={`${id}-${skill.id}-title`} aria-describedby={`${id}-${skill.id}-description`}
          data-active={index === active} onMouseMove={() => { scrollActive.current = false; setActive(index) }} onMouseDown={event => event.preventDefault()} onClick={() => choose(skill.id)}>
          <div data-insight-skill-option-title><span id={`${id}-${skill.id}-title`}>{skill.label}</span><span aria-hidden="true">{skill.id === selected ? '✓' : ''}</span></div>
          <div id={`${id}-${skill.id}-description`} data-insight-skill-description>{skill.description}</div>
        </div>)}
      </div>
      {(!catalogAvailable || items.length === 0) && <div role="status" data-insight-skill-empty>{t(catalogAvailable ? 'skill.empty' : 'skill.unavailable')}</div>}
      <div data-insight-skill-hint>{t('skill.hint')}</div>
    </div>, document.body)}
  </>
}
