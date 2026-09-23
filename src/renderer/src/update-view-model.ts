import type { UpdateStatus } from '../../shared/update-contracts'

export type UpdateViewAction = 'check' | 'download' | 'download-full-installer' | 'retry' | 'skip' | 'quit'

export interface UpdateViewModel {
  title: string
  detail: string
  badge?: string
  primary?: UpdateViewAction
  secondary?: UpdateViewAction
  recovery?: 'download-full-installer'
  busy: boolean
}

export function updateViewModel(status: UpdateStatus): UpdateViewModel {
  const model = baseUpdateViewModel(status)
  return 'track' in status && status.track === 'candidate'
    ? {
        ...model,
        badge: '内测版本'
      }
    : model
}

function baseUpdateViewModel(status: UpdateStatus): UpdateViewModel {
  switch (status.phase) {
    case 'idle':
      return {
        title: '检查客户端更新',
        detail: `当前版本 ${status.currentVersion}`,
        primary: 'check',
        busy: false
      }
    case 'checking':
      return { title: '正在检查更新…', detail: '正在读取可信发布记录…', busy: true }
    case 'available':
      return {
        title: status.required ? '需要更新因赛AI' : '新版本的因赛AI已经发布',
        detail: `${status.currentVersion} → ${status.availableVersion}`,
        primary: 'download',
        secondary: status.required ? undefined : 'skip',
        recovery: 'download-full-installer',
        busy: false
      }
    case 'downloading':
      return {
        title: '正在下载更新',
        detail: `已完成 ${Math.round(status.percent)}%`,
        busy: true
      }
    case 'downloaded':
      return {
        title: '正在启动安装…',
        detail: `版本 ${status.availableVersion} 已下载并校验完成，因赛AI 将自动重启完成更新。`,
        busy: true
      }
    case 'installing':
      return {
        title: '正在准备安装…',
        detail: '正在安全关闭当前工作区并准备安装文件。完成后因赛AI 将自动退出并重新打开。',
        busy: true
      }
    case 'up-to-date':
      return status.promotedFromCandidate
        ? {
            title: '当前版本已转为正式版',
            detail: `版本 ${status.currentVersion} 无需重新下载。`,
            primary: 'check',
            busy: false
          }
        : {
            title: '已经是最新版本',
            detail: `当前版本 ${status.currentVersion}`,
            primary: 'check',
            busy: false
          }
    case 'unsupported':
      return {
        title: '当前版本不支持真实更新',
        detail: status.reason,
        busy: false
      }
    case 'error':
      return {
        title: status.required
          ? '必须更新后才能继续'
          : status.availableVersion ? '更新暂时中断' : '暂时未能完成更新检查',
        detail: status.required ? status.message : '请稍后重试；若持续出现，请联系支持。',
        primary: status.retryable ? 'retry' : undefined,
        secondary: status.required ? 'quit' : undefined,
        recovery: status.manualInstallerAvailable ? 'download-full-installer' : undefined,
        busy: false
      }
  }
}
