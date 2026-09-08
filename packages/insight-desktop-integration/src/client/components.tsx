import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { AccountSummary } from '../../../../src/shared/auth-contracts'
import type { DesktopClientInfo } from '../../../../src/shared/harness-account-api'
import type { DesktopUpdateApi } from '../../../../src/shared/update-api'
import type { UpdateStatus } from '../../../../src/shared/update-contracts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import brandMark from '../../../../build/brand-mark.svg'
import type { InsightDesktopKey } from './locales'

type ProductLocaleProps = PropsLocale<'insightDesktop'>

export interface AccountFooterActions {
  openSettings(): void
  signOut(): Promise<void>
  updates: DesktopUpdateApi
}

function updateHighlighted(status: UpdateStatus | undefined): boolean {
  return status?.phase === 'available' ||
    status?.phase === 'downloading' ||
    status?.phase === 'downloaded' ||
    (status?.phase === 'error' && status.required)
}

/** Render the authenticated update entry without inspecting Harness DOM. */
export function UpdateButton({ updates }: { updates: DesktopUpdateApi }) {
  const [status, setStatus] = useState<UpdateStatus>()
  useEffect(() => {
    let active = true
    const unsubscribe = updates.subscribe(setStatus)
    void updates.status().then(value => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [updates])
  return (
    <button
      type="button"
      data-insight-desktop-update-button
      data-active={updateHighlighted(status) ? 'true' : undefined}
      aria-label="打开客户端更新"
      title="检查客户端更新"
      onClick={() => void updates.open()}
    >
      ↓
    </button>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    insightDesktop: InsightDesktopKey
  }
}

/** Render the product mark in the brand mark seat. */
export function BrandMark({ size }: PropsRuntime<'sidebar.brand.mark'>) {
  return (
    <span data-insight-desktop-brand-mark style={{ width: size, height: size }}>
      <img src={brandMark} alt="" />
    </span>
  )
}

/** Render the product name in the brand name seat. */
export function BrandName() {
  return <span data-insight-desktop-brand-name>因赛AI</span>
}

/** Hide the redundant settings trigger while preserving the mounted settings shell. */
export function HiddenSettingsTrigger(_props: PropsRuntime<'settings.trigger'>) {
  return null
}

function useAccount(): AccountSummary | undefined {
  const [account, setAccount] = useState<AccountSummary>()
  useEffect(() => {
    let active = true
    void window.insightDesktopAccount.current().then(value => {
      if (active) setAccount(value)
    })
    const unsubscribe = window.insightDesktopAccount.subscribe(value => setAccount(value))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return account
}

function Avatar({ account }: { account: AccountSummary | undefined }) {
  const initial = account?.displayName.trim().slice(0, 1) || '因'
  return (
    <span data-insight-desktop-avatar aria-hidden="true">
      {account?.avatarUrl ? <img src={account.avatarUrl} alt="" /> : initial}
    </span>
  )
}

/** Render the current account and its two product-level actions. */
export function AccountFooter({ wide, t, openSettings, signOut, updates }: PropsRuntime<'sidebar.footer.action'> & ProductLocaleProps & AccountFooterActions) {
  const account = useAccount()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      if (!button.current || !menu.current) return
      const anchor = button.current.getBoundingClientRect()
      const width = menu.current.offsetWidth
      const height = menu.current.offsetHeight
      const margin = 12
      const gap = 6
      setMenuPosition({
        left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)),
        top: Math.max(margin, Math.min(anchor.top - height - gap, window.innerHeight - height - margin)),
        visibility: 'visible'
      })
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const executeSignOut = async (): Promise<void> => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
      setOpen(false)
    }
  }

  return (
    <div ref={root} data-insight-desktop-account>
      {open && createPortal(
        <div
          ref={menu}
          data-insight-desktop-account-menu
          role="menu"
          style={menuPosition ?? { left: 0, top: 0, visibility: 'hidden' }}
        >
          <button type="button" role="menuitem" onClick={() => { setOpen(false); openSettings() }}>
            {t('account.settings')}
          </button>
          <button type="button" role="menuitem" disabled={signingOut} onClick={() => void executeSignOut()}>
            {t('account.signOut')}
          </button>
        </div>,
        document.body
      )}
      <div data-insight-desktop-account-row>
        <button
          ref={button}
          type="button"
          data-insight-desktop-account-button
          data-rail={wide ? undefined : 'true'}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={account?.displayName || t('account.unavailable')}
          onClick={() => {
            if (!open) setMenuPosition(undefined)
            setOpen(value => !value)
          }}
        >
          <Avatar account={account} />
          {wide && (
            <span data-insight-desktop-account-copy>
              <span data-insight-desktop-account-name>{account?.displayName || t('account.unavailable')}</span>
              {account && <span data-insight-desktop-account-phone>{account.maskedPhone}</span>}
            </span>
          )}
        </button>
        {wide && <UpdateButton updates={updates} />}
      </div>
    </div>
  )
}

function useClientInfo(): DesktopClientInfo | undefined {
  const [info, setInfo] = useState<DesktopClientInfo>()
  useEffect(() => {
    let active = true
    void window.insightDesktopAccount.info().then(value => {
      if (active) setInfo(value)
    })
    return () => { active = false }
  }, [])
  return info
}

/** Render installation metadata in the unified system settings panel. */
export function ClientSettings({ t }: PropsRuntime<'settings.section'> & ProductLocaleProps) {
  const info = useClientInfo()
  return (
    <section data-insight-desktop-client-settings>
      <h2>{t('settings.title')}</h2>
      <dl data-insight-desktop-client-info>
        <div><dt>{t('settings.version')}</dt><dd>{info?.version ?? '—'}</dd></div>
        <div><dt>{t('settings.environment')}</dt><dd>{info ? t(`settings.environment.${info.environment}`) : '—'}</dd></div>
        <div><dt>{t('settings.platform')}</dt><dd>{info ? t(`settings.platform.${info.platform}`) : '—'}</dd></div>
      </dl>
    </section>
  )
}

/** Add a native drag strip only when the host reports macOS. */
export function MacDragOverlay() {
  const info = useClientInfo()
  return info?.platform === 'darwin' ? <div data-insight-desktop-mac-drag aria-hidden="true" /> : null
}
