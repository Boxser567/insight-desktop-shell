import type {
  UpdateArch,
  UpdateChannel,
  UpdatePlatform,
  UpdateTarget
} from '../../shared/update-contracts'

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000
export const AUTO_INSTALL_ON_APP_QUIT = false

export interface UpdateEnvironment {
  packaged: boolean
  channel: UpdateChannel
  platform: string
  arch: string
}

export type UpdateSupport =
  | { supported: true; target: UpdateTarget }
  | { supported: false; reason: string }

export function resolveUpdateSupport(input: UpdateEnvironment): UpdateSupport {
  if (!input.packaged) {
    return { supported: false, reason: '未打包的开发客户端不支持真实更新。' }
  }
  if (input.channel === 'development') {
    return { supported: false, reason: '开发渠道不连接候选或正式更新源。' }
  }
  if (!isSupportedPlatform(input.platform) || !isSupportedArchitecture(input.arch)) {
    return { supported: false, reason: `当前平台不支持更新：${input.platform}-${input.arch}。` }
  }
  if (input.platform === 'win32' && input.arch !== 'x64') {
    return { supported: false, reason: `当前平台不支持更新：${input.platform}-${input.arch}。` }
  }
  return {
    supported: true,
    target: {
      channel: input.channel,
      platform: input.platform,
      arch: input.arch
    }
  }
}

export function isUpdateCheckDue(
  lastCheckedAt: number | undefined,
  now: number
): boolean {
  return lastCheckedAt === undefined || now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}

export function startupCheckDelay(random: () => number = Math.random): number {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('更新启动延迟随机数必须位于 0（含）到 1（不含）之间。')
  }
  return UPDATE_STARTUP_DELAY_MS + Math.floor(value * UPDATE_STARTUP_JITTER_MS)
}

export interface SkippedUpdateDecision {
  availableVersion: string
  skippedVersion: string | undefined
  manual: boolean
  required: boolean
}

export function shouldSuppressSkippedUpdate(input: SkippedUpdateDecision): boolean {
  return !input.manual && !input.required && input.skippedVersion === input.availableVersion
}

function isSupportedPlatform(value: string): value is UpdatePlatform {
  return value === 'darwin' || value === 'win32'
}

function isSupportedArchitecture(value: string): value is UpdateArch {
  return value === 'arm64' || value === 'x64'
}
