import { useEffect, useRef, useState } from 'react'
import type { AccountSummary } from '../../../../src/shared/auth-contracts'
import type { DesktopClientInfo } from '../../../../src/shared/harness-account-api'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import appIcon from '../../../../build/app-icon.png'
import type { InsightDesktopKey } from './locales'

type ProductLocaleProps = PropsLocale<'insightDesktop'>

export interface AccountFooterActions {
  openSettings(): void
  signOut(): Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    insightDesktop: InsightDesktopKey
  }
}

/** Render the installed application icon in the brand mark seat. */
export function BrandMark({ size }: PropsRuntime<'sidebar.brand.mark'>) {
  return <img data-insight-desktop-brand-mark src={appIcon} width={size} height={size} alt="" />
}

/** Render the product name in the brand name seat. */
export function BrandName() {
  return <span data-insight-desktop-brand-name>因赛AI</span>
}

/** Hide the redundant sidebar trigger without disabling the settings service. */
export function HiddenSidebarSettings(_props: PropsRuntime<'sidebar.settings'>) {
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
export function AccountFooter({ wide, t, openSettings, signOut }: PropsRuntime<'sidebar.footer.action'> & ProductLocaleProps & AccountFooterActions) {
  const account = useAccount()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
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
      {open && (
        <div data-insight-desktop-account-menu role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); openSettings() }}>
            {t('account.settings')}
          </button>
          <button type="button" role="menuitem" disabled={signingOut} onClick={() => void executeSignOut()}>
            {t('account.signOut')}
          </button>
        </div>
      )}
      <button
        type="button"
        data-insight-desktop-account-button
        data-rail={wide ? undefined : 'true'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={account?.displayName || t('account.unavailable')}
        onClick={() => setOpen(value => !value)}
      >
        <Avatar account={account} />
        {wide && (
          <span data-insight-desktop-account-copy>
            <span data-insight-desktop-account-name>{account?.displayName || t('account.unavailable')}</span>
            {account && <span data-insight-desktop-account-phone>{account.maskedPhone}</span>}
          </span>
        )}
      </button>
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
