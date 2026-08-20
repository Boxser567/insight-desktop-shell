window.__ModuleLoader__.load({
  id: 'dsh-desktop-shell',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'desktopShell'
    const STYLE_ID = 'dsh-desktop-shell-styles'
    const LIGHT_LOGO_URL = '/dsh-desktop-logo-light.png'
    const DARK_LOGO_URL = '/dsh-desktop-logo-dark.png'

    // The logo art is a single wide lockup; these are its intrinsic bounds.
    const LOGO_VIEW_BOX = { x: 150, y: 330, width: 1030, height: 590 }
    const LOGO_ASPECT = LOGO_VIEW_BOX.width / LOGO_VIEW_BOX.height

    const en = {
      connect: 'Connect phone',
      manage: 'Manage phone connection'
    }
    const zh = {
      connect: '连接手机',
      manage: '管理手机连接'
    }

    const styles = `
      .dshDesktopLogoDark { display: none; }
      body[data-ds-dark-theme] .dshDesktopLogoLight { display: none; }
      body[data-ds-dark-theme] .dshDesktopLogoDark { display: inline; }
      .dshDesktopPhoneButton {
        appearance: none; position: relative; width: 32px; height: 32px;
        color: var(--dsw-alias-label-secondary, #73777f); background: transparent;
        border: 0; border-radius: 9px; display: inline-flex; align-items: center;
        justify-content: center; cursor: pointer;
      }
      .dshDesktopPhoneButton:hover {
        color: var(--dsw-alias-label-primary, #202124);
        background: var(--dsw-alias-interactive-bg-hover, rgba(32, 33, 36, .08));
      }
      .dshDesktopPhoneButton:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 1px; }
      .dshDesktopPhoneButton[hidden] { display: none; }
      .dshDesktopPhoneDot {
        position: absolute; top: 4px; right: 4px; width: 7px; height: 7px;
        border: 1.5px solid var(--dsw-specific-sidebar-fill, #fff);
        border-radius: 50%; background: #4da66d; opacity: 0;
      }
      .dshDesktopPhoneButton.is-connected .dshDesktopPhoneDot { opacity: 1; }
    `

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = styles
      document.head.appendChild(tag)
    }

    /**
     * The dark and light artwork ship as separate PNGs. Both are drawn and CSS
     * picks one, so the swap costs no re-render when the theme attribute flips.
     */
    function DshDesktopLogo({ height = 18 }) {
      const image = (className, href) =>
        React.createElement('image', {
          key: className,
          className,
          href,
          x: LOGO_VIEW_BOX.x,
          y: LOGO_VIEW_BOX.y,
          width: LOGO_VIEW_BOX.width,
          height: LOGO_VIEW_BOX.height,
          preserveAspectRatio: 'xMidYMid meet'
        })
      return React.createElement(
        'svg',
        {
          width: Math.round(height * LOGO_ASPECT),
          height,
          viewBox: `${LOGO_VIEW_BOX.x} ${LOGO_VIEW_BOX.y} ${LOGO_VIEW_BOX.width} ${LOGO_VIEW_BOX.height}`,
          fill: 'none',
          'aria-hidden': 'true'
        },
        image('dshDesktopLogoLight', LIGHT_LOGO_URL),
        image('dshDesktopLogoDark', DARK_LOGO_URL)
      )
    }

    /**
     * `sidebar.brand.mark` renders in both the expanded lockup and the collapsed
     * rail, and hands us the icon box it expects. The lockup is wider than it is
     * tall, so scale off the height rather than filling the square.
     */
    function BrandMark({ size = 24 }) {
      return React.createElement(DshDesktopLogo, { height: Math.round(size * 0.75) })
    }

    function BrandName() {
      return React.createElement(primitives.BrandWordmark, {})
    }

    const phoneIcon = () =>
      React.createElement(
        'svg',
        { viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', 'aria-hidden': 'true' },
        React.createElement('rect', {
          x: 7,
          y: 2.75,
          width: 10,
          height: 18.5,
          rx: 2.25,
          stroke: 'currentColor',
          strokeWidth: 1.7
        }),
        React.createElement('path', {
          d: 'M10.2 5.5h3.6M10.5 18.35h3',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round'
        })
      )

    function usePhoneConnected() {
      const [connected, setConnected] = React.useState(false)
      React.useEffect(() => {
        const bridge = window.dshDesktop
        if (bridge === undefined) return
        let cancelled = false
        const read = async () => {
          try {
            const status = await bridge.phoneStatus()
            if (!cancelled) setConnected(status.connected === true)
          } catch (error) {
            console.warn('[mobile] unable to read connection status', error)
          }
        }
        void read()
        const timer = window.setInterval(() => void read(), 1000)
        return () => {
          cancelled = true
          window.clearInterval(timer)
        }
      }, [])
      return connected
    }

    /**
     * Collapsed to a rail, the entry only earns its slot once a phone is
     * actually paired; expanded, it is always offered.
     */
    function PhoneAction({ wide, t }) {
      const connected = usePhoneConnected()
      if (!wide && !connected) return null
      const label = connected ? t('manage') : t('connect')
      return React.createElement(
        'button',
        {
          type: 'button',
          className: `dshDesktopPhoneButton${connected ? ' is-connected' : ''}`,
          'aria-label': label,
          title: label,
          onClick: () => {
            const bridge = window.dshDesktop
            if (bridge === undefined) return
            void bridge.openPhonePairing().catch((error) => {
              console.error('[mobile] unable to open pairing window', error)
            })
          }
        },
        phoneIcon(),
        React.createElement('span', { className: 'dshDesktopPhoneDot', 'aria-hidden': 'true' })
      )
    }

    const inject = ['slots', 'locale']
    function apply(ctx) {
      installStyles()
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-desktop-shell: copy dictionaries'
      )
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.register({ name: 'sidebar.brand.mark', id: 'desktop-brand-mark' }, BrandMark)
      )
      ctx.slots.inject('sidebar.brand.name', () =>
        ctx.slots.register({ name: 'sidebar.brand.name', id: 'desktop-brand-name' }, BrandName)
      )
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'desktop-phone-pairing',
            order: 10,
            inject: () => ({ t })
          },
          PhoneAction
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
