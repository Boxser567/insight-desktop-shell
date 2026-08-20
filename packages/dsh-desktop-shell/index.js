/**
 * Host half of the desktop shell plugin. Everything this plugin does lives in
 * the browser (sidebar slot fills), so the Host side only has to exist for the
 * composed profile to resolve the package and load its client module.
 */
export const name = 'dsh-desktop-shell'

export function apply() {}
