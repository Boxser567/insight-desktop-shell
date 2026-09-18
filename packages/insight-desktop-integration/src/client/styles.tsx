const STYLE_ID = 'insight-desktop-integration-styles'

const stylesheet = `
[data-insight-skill-trigger] { display:flex; align-items:center; gap:6px; border:0; border-radius:8px; padding:6px 8px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; cursor:pointer; max-width:220px; min-width:0; transition:background 140ms ease,color 140ms ease; }
[data-insight-skill-trigger] > span:nth-child(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-insight-skill-trigger]:hover, [data-insight-skill-trigger][aria-expanded="true"] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
[data-insight-skill-trigger]:disabled { opacity:.5; cursor:default; }
[data-insight-skill-panel] { position:fixed; z-index:1000; display:flex; flex-direction:column; box-sizing:border-box; border:1px solid var(--dsw-alias-border-primary, #7775); border-radius:14px; background:var(--dsw-alias-bg-layer-2, #202024); color:var(--dsw-alias-label-primary); box-shadow:0 12px 36px #0003; padding:8px; font-size:13px; overflow:hidden; }
[data-insight-skill-header] { display:flex; align-items:center; justify-content:space-between; padding:4px 6px 8px; flex:none; }
[data-insight-skill-header] button { font:inherit; border:0; border-radius:6px; padding:4px 8px; color:inherit; background:transparent; cursor:pointer; }
[data-insight-skill-header] button:disabled { opacity:.4; cursor:default; }
[data-insight-skill-panel] input { box-sizing:border-box; flex:none; width:100%; margin-bottom:6px; padding:9px 10px; border:1px solid var(--dsw-alias-border-primary, #7775); border-radius:8px; background:transparent; color:inherit; font:inherit; }
[data-insight-skill-list] { max-height:400px; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
[data-insight-skill-list] [role="option"] { padding:10px; border-radius:8px; cursor:pointer; transition:background 140ms ease,color 140ms ease; }
[data-insight-skill-list] [role="option"][data-active="true"] { background:var(--dsw-alias-interactive-bg-hover, #8882); }
[data-insight-skill-option-title] { display:flex; justify-content:space-between; gap:8px; font-weight:500; line-height:20px; }
[data-insight-skill-list] [aria-selected="true"] [data-insight-skill-option-title] { color:var(--insight-primary); }
[data-insight-skill-description] { margin-top:3px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; overflow-wrap:anywhere; }
[data-insight-skill-empty], [data-insight-skill-hint] { padding:8px 6px; color:var(--dsw-alias-label-secondary); font-size:12px; flex:none; }
[data-insight-skill-panel] :focus-visible, [data-insight-skill-trigger]:focus-visible { outline:2px solid var(--insight-primary); outline-offset:2px; }
@media (prefers-reduced-motion:reduce) { [data-insight-skill-trigger], [data-insight-skill-list] [role="option"] { transition:none; } }

:root {
  --insight-primary: #315dfb;
}
[data-insight-desktop-brand-mark] {
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 7px;
  background: var(--insight-primary);
}
[data-insight-desktop-brand-mark] > img {
  display: block;
  width: 68%;
  height: 68%;
  object-fit: contain;
}
[data-insight-desktop-hero-title] {
  text-align: center;
  text-wrap: balance;
  font-size: clamp(20px, 2.5vw, 26px);
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
[data-insight-desktop-account-row] {
  display: flex;
  align-items: center;
  gap: 4px;
}
[data-insight-desktop-account-button] {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
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
[data-insight-desktop-update-button] {
  appearance: none;
  flex: none;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
[data-insight-desktop-update-button]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-insight-desktop-update-button][data-active="true"] {
  color: #fff;
  background: var(--insight-primary);
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
  background: var(--insight-primary);
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
