import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { filterSkills, isSkillSelectable, selectedSkillNames, type InsightSkill, type SkillCatalog } from '../skill-catalog'
import { skillDisplayName, skillShortDescription } from '../skill-presentation'

type SkillPickerProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'insightDesktop'> & {
  catalog: SkillCatalog
}

/** Selection is derived from the visible draft, never retained after sending. */
export function SkillPicker({ sessionId, useSession, useInput, inputActions, catalog, t }: SkillPickerProps) {
  const historyFailed = useSession(session => session.openState === 'error')
  const draft = useInput((input: InputState) => {
    let text = input.draft
    // Reference labels can contain slash text; only editable text selects skills.
    for (const occurrence of [...input.occurrences].reverse()) {
      text = text.slice(0, occurrence.offset) + ' '.repeat(occurrence.length) + text.slice(occurrence.offset + occurrence.length)
    }
    return text
  })
  const locked = useInput((input: InputState) => input.phase !== 'plain')
  const [state, setState] = useState<{ sessionId: string; skills: readonly InsightSkill[]; available: boolean; loading: boolean; complete: boolean; userSupported: boolean }>({ sessionId, skills: [], available: false, loading: true, complete: false, userSupported: true })
  const request = useRef(0)
  const refresh = useCallback(() => {
    const current = ++request.current
    const pending = catalog.snapshot ? catalog.snapshot(sessionId) : catalog.list(sessionId).then(skills => ({ skills, complete: true, userSupported: false }))
    void pending.then(snapshot => {
      if (current === request.current) setState({ sessionId, ...snapshot, available: true, loading: false })
    }, () => {
      if (current === request.current) setState(previous => ({ ...previous, sessionId, skills: previous.sessionId === sessionId ? previous.skills.map(skill => ({ ...skill, availability: 'unconfirmed' })) : [], available: false, loading: false, complete: false }))
    })
  }, [catalog, sessionId])
  useEffect(() => {
    const off = catalog.subscribe(sessionId, refresh)
    refresh()
    window.addEventListener('focus', refresh)
    return () => { request.current++; off(); window.removeEventListener('focus', refresh) }
  }, [catalog, sessionId, refresh])
  return <SkillPickerMenu key={sessionId} skills={!historyFailed && state.sessionId === sessionId ? state.skills : []}
    catalogAvailable={!historyFailed && state.sessionId === sessionId && state.available} selected={selectedSkillNames(draft)}
    loading={state.sessionId !== sessionId || state.loading} complete={state.complete} userSupported={state.userSupported} onRefresh={refresh}
    historyFailed={historyFailed} disabled={locked} onSelect={name => inputActions.toggleSkill(name)} t={t} />
}

type MenuProps = PropsLocale<'insightDesktop'> & {
  skills: readonly InsightSkill[]
  loading?: boolean
  complete?: boolean
  userSupported?: boolean
  onRefresh?: () => void
  catalogAvailable: boolean
  selected: readonly string[]
  disabled?: boolean
  historyFailed?: boolean
  onSelect(id: string): void
}

/** Searchable draft-backed multiselect, using native skill names. */
export function SkillPickerMenu({ skills, catalogAvailable, selected, disabled, historyFailed, onSelect, t, loading = false, complete = true, userSupported = true, onRefresh }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [group, setGroup] = useState<'platform' | 'user'>('platform')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<{ left: number; bottom?: number; top?: number; width: number; maxHeight: number }>({ left: 0, bottom: 0, width: 360, maxHeight: 360 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const scrollActive = useRef(false)
  const id = useId()
  const items = filterSkills(skills, query, group)
  const unavailablePicks = picked.filter(name => selected.includes(name) && !skills.some(skill => skill.name === name && isSkillSelectable(skill)))
  const selectedCount = new Set([...filterSkills(skills, ''), ...filterSkills(skills, '', 'user')].filter(skill => isSkillSelectable(skill) && selected.includes(skill.name)).map(skill => skill.name)).size
  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  const choose = (value: string) => {
    if (!items.some(skill => skill.name === value && isSkillSelectable(skill))) return
    setPicked(names => selected.includes(value) ? names.filter(name => name !== value) : [...new Set([...names, value])])
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
        ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(0, Math.min(360, above)) }
          : { top: rect.bottom + 8, maxHeight: Math.max(0, Math.min(360, below)) }) })
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
  }, [active, open, query, group])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (!open || !onRefresh) return
    onRefresh()
    const timer = window.setInterval(onRefresh, 2000)
    return () => window.clearInterval(timer)
  }, [open, onRefresh])
  useEffect(() => { setActive(index => Math.min(index, Math.max(0, items.length - 1))) }, [items.length])

  const toggle = () => {
    if (open) { close(); return }
    scrollActive.current = true
    setQuery('')
    setGroup('platform')
    setActive(Math.max(0, filterSkills(skills, '').findIndex(skill => selected.includes(skill.name))))
    setOpen(true)
  }

  return <>
    <button ref={trigger} type="button" data-insight-skill-trigger aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? `${id}-panel` : undefined} disabled={disabled}
      title={t(historyFailed ? 'skill.historyUnavailable' : 'skill.title')} onClick={toggle}>
      <span data-insight-skill-icon aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 9.8 6.2 14.5 8 9.8 9.8 8 14.5 6.2 9.8 1.5 8 6.2 6.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg></span>
      <span data-insight-skill-label>{historyFailed ? t('skill.unavailableLabel') : selectedCount ? `${t('skill.selected')} ${selectedCount}` : t('skill.placeholder')}</span>
      <span data-insight-skill-chevron aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5.25 7 9.25 11 5.25" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></span>
    </button>
    {open && createPortal(<div ref={panel} id={`${id}-panel`} role="dialog" aria-label={t('skill.title')}
      data-insight-skill-panel style={{ ...position, minHeight: position.maxHeight }} onKeyDown={event => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); close() }
      }}>
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
      <div role="tablist" aria-label={t('skill.sources')} data-insight-skill-tabs>
        {(['platform', 'user'] as const).map(tab => <button key={tab} type="button" role="tab" id={`${id}-tab-${tab}`}
          aria-selected={group === tab} aria-controls={`${id}-tabpanel`} tabIndex={group === tab ? 0 : -1}
          onClick={() => { setGroup(tab); setActive(0); scrollActive.current = true; onRefresh?.() }}
          onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'platform' : event.key === 'End' ? 'user' : group === 'platform' ? 'user' : 'platform'; setGroup(next); setActive(0); (event.currentTarget.parentElement?.querySelector(`#${CSS.escape(id)}-tab-${next}`) as HTMLElement | null)?.focus(); onRefresh?.() } }}>
          {t(tab === 'platform' ? 'skill.platform' : 'skill.user')}
        </button>)}
      </div>
      {unavailablePicks.length > 0 && <div role="status" data-insight-skill-notice>{t('skill.selectionUnavailable')}</div>}
      {!loading && !complete && <div role="status" data-insight-skill-notice>{t('skill.incomplete')}</div>}
      {group === 'user' && !userSupported && <div role="status" data-insight-skill-notice>{t('skill.unsupported')}</div>}
      <div role="tabpanel" aria-busy={loading} id={`${id}-tabpanel`} aria-labelledby={`${id}-tab-${group}`} data-insight-skill-tabpanel>
      <div ref={list} id={`${id}-list`} role="listbox" aria-multiselectable="true" aria-label={t('skill.title')} data-insight-skill-list>
        {items.map((skill, index) => <div key={skill.entryId ?? skill.name} id={`${id}-${skill.name}`} role="option"
          aria-selected={isSkillSelectable(skill) && selected.includes(skill.name)} aria-disabled={!isSkillSelectable(skill)} aria-labelledby={`${id}-${skill.name}-title`} aria-describedby={`${id}-${skill.name}-description`}
          data-active={index === active} onMouseMove={() => { scrollActive.current = false; setActive(index) }} onMouseDown={event => event.preventDefault()} onClick={() => choose(skill.name)}>
          <div data-insight-skill-option-title><span id={`${id}-${skill.name}-title`}>{skillDisplayName(skill)}</span><span aria-hidden="true">{isSkillSelectable(skill) && selected.includes(skill.name) ? '✓' : ''}</span></div>
          <div id={`${id}-${skill.name}-description`} data-insight-skill-description title={skillShortDescription(skill)}>{skillShortDescription(skill)}</div>
        </div>)}
      </div>
      </div>
      {!(group === 'user' && !userSupported) && (!catalogAvailable || items.length === 0) && <div role="status" data-insight-skill-empty>{t(historyFailed ? 'skill.historyUnavailable' : loading ? 'skill.loading' : catalogAvailable && complete ? group === 'user' && !query.trim() ? 'skill.noUserSkills' : 'skill.empty' : 'skill.unavailable')}</div>}
    </div>, document.body)}
  </>
}
