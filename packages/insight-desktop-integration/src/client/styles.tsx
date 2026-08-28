const STYLE_ID = 'insight-desktop-integration-styles'

const stylesheet = `
[data-insight-desktop-brand-mark] {
  display: block;
  border-radius: 7px;
  object-fit: cover;
}
[data-insight-desktop-brand-name] {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: 0;
  white-space: nowrap;
}
[data-insight-desktop-account] {
  position: relative;
  width: 100%;
  min-width: 0;
}
[data-insight-desktop-account-button] {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 50px;
  padding: 5px 8px;
  border: 0;
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-insight-desktop-account-button]:hover,
[data-insight-desktop-account-button][aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-insight-desktop-account-button][data-rail="true"] {
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
}
[data-insight-desktop-avatar] {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border-radius: 50%;
  color: #fff;
  background: #6c63ff;
  font-size: 13px;
  font-weight: 600;
}
[data-insight-desktop-avatar] > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
[data-insight-desktop-account-copy] {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
}
[data-insight-desktop-account-name],
[data-insight-desktop-account-phone] {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
[data-insight-desktop-account-name] {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
[data-insight-desktop-account-phone] {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
[data-insight-desktop-account-menu] {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  width: 176px;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-shadow-lv2);
}
[data-insight-desktop-account-menu] > button {
  appearance: none;
  min-height: 34px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-insight-desktop-account-menu] > button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-insight-desktop-account-menu] > button:last-child {
  color: var(--dsw-alias-state-error-primary);
}
[data-insight-desktop-account-menu] > button:disabled {
  opacity: .55;
  cursor: default;
}
[data-insight-desktop-client-settings] {
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: var(--dsw-alias-label-primary);
}
[data-insight-desktop-client-settings] > h2 {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}
[data-insight-desktop-client-info] {
  display: grid;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-border-l2);
}
[data-insight-desktop-client-info] > div {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 16px;
  padding: 13px 16px;
  background: var(--dsw-alias-bg-layer-2);
}
[data-insight-desktop-client-info] dt {
  color: var(--dsw-alias-label-secondary);
}
[data-insight-desktop-client-info] dd {
  margin: 0;
}
[data-insight-desktop-mac-drag] {
  position: fixed;
  top: 0;
  right: 24px;
  left: 76px;
  height: 28px;
  pointer-events: none;
  -webkit-app-region: drag;
}
`

/** Install the product integration stylesheet for this plugin lifetime. */
export function installStyles(): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing) return () => undefined
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = '@insight-ai/desktop-integration'
  style.textContent = stylesheet
  document.head.appendChild(style)
  return () => style.remove()
}
