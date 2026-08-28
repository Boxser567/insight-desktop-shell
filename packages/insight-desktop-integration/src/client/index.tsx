import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { accountMenuActions } from './account-menu-model'
import { AccountFooter, BrandMark, BrandName, ClientSettings, HiddenSettingsTrigger, MacDragOverlay } from './components'
import { en, zh } from './locales'
import { installStyles } from './styles'

const NS = 'insightDesktop'

/** Services required by the product integration. */
export const inject = ['slots', 'locale', 'settingsDialog']

/** Register product UI only through the public Harness extension seats. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'insight-desktop: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'insight-desktop: dictionaries')
  const t = ctx.locale.bind(NS)
  const actions = accountMenuActions(ctx.settingsDialog, window.insightDesktopAccount)

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
    }))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'insight-account',
    order: 100,
    locale: NS,
    inject: () => actions
  }, AccountFooter))
  ctx.slots.inject('settings.trigger', () => ctx.slots.register({
    name: 'settings.trigger',
    priority: -100
  }, HiddenSettingsTrigger))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'client',
    order: 90,
    label: () => t('settings.nav'),
    locale: NS
  }, ClientSettings))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'insight-mac-drag',
    order: 100
  }, MacDragOverlay))
}
