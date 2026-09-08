import type { UpdateStatus } from '../../shared/update-contracts'

export type UpdateViewAction = 'check' | 'download' | 'install' | 'retry' | 'skip' | 'quit'

export interface UpdateViewModel {
  title: string
  detail: string
  primary?: UpdateViewAction
  secondary?: UpdateViewAction
  busy: boolean
}

export function updateViewModel(status: UpdateStatus): UpdateViewModel {
  switch (status.phase) {
    case 'idle':
      return {
        title: '检查客户端更新',
        detail: `当前版本 ${status.currentVersion}`,
        primary: 'check',
        busy: false
      }
    case 'checking':
      return { title: '正在检查更新', detail: '正在读取可信发布记录…', busy: true }
    case 'available':
      return {
        title: status.required ? '需要更新因赛AI' : '新版本的因赛AI已经发布',
        detail: `${status.currentVersion} → ${status.availableVersion}`,
        primary: 'download',
        secondary: status.required ? undefined : 'skip',
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
        title: '更新已经准备好',
        detail: `版本 ${status.availableVersion} 下载并校验完成。`,
        primary: 'install',
        busy: false
      }
    case 'installing':
      return { title: '正在准备安装', detail: '因赛AI 将安全停止当前工作区。', busy: true }
    case 'up-to-date':
      return {
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
        title: status.required ? '必须更新后才能继续' : '更新暂时失败',
        detail: status.message,
        primary: status.retryable ? 'retry' : undefined,
        secondary: status.required ? 'quit' : undefined,
        busy: false
      }
  }
}
