import type { UpdateChannel } from '../shared/update-contracts'

const supportedChannels = new Set<UpdateChannel>([
  'development',
  'candidate',
  'stable'
])

/** Resolve the immutable channel selected by the Electron build metadata. */
export function resolveApplicationChannel(input: {
  packaged: boolean
  configuredChannel: unknown
  appId: unknown
}): UpdateChannel {
  if (!input.packaged) return 'development'
  if (
    typeof input.configuredChannel === 'string' &&
    supportedChannels.has(input.configuredChannel as UpdateChannel)
  ) {
    return input.configuredChannel as UpdateChannel
  }
  if (input.configuredChannel === undefined && input.appId === 'com.insight.desktop') {
    return 'stable'
  }
  throw new Error('Packaged application metadata contains no supported update channel.')
}
