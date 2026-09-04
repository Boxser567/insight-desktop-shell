import type { UpdateStatus } from '../../shared/update-contracts'

export type UpdateStateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'available'; version: string; required: boolean; manual: boolean }
  | { type: 'progress'; version: string; required: boolean; percent: number; manual: boolean }
  | { type: 'downloaded'; version: string; required: boolean; manual: boolean }
  | { type: 'installing'; version: string; required: boolean; manual: boolean }
  | { type: 'up-to-date' }
  | { type: 'unsupported'; reason: string; manual: boolean }
  | { type: 'error'; version?: string; required: boolean; message: string; retryable: boolean; manual: boolean }
  | { type: 'reset' }

export function initialUpdateStatus(
  currentVersion: string,
  lastCheckedAt?: string
): UpdateStatus {
  return lastCheckedAt === undefined
    ? { phase: 'idle', currentVersion }
    : { phase: 'idle', currentVersion, lastCheckedAt }
}

export function reduceUpdateState(
  state: UpdateStatus,
  event: UpdateStateEvent
): UpdateStatus {
  if (event.type === 'reset') return initialUpdateStatus(state.currentVersion)

  switch (event.type) {
    case 'check':
      assertPhase(state, event.type, ['idle', 'available', 'up-to-date', 'unsupported', 'error'])
      return { phase: 'checking', currentVersion: state.currentVersion, manual: event.manual }
    case 'available':
      assertPhase(state, event.type, ['checking'])
      requireVersion(event.version)
      assertManual(state, event.manual)
      return updateVersionStatus('available', state.currentVersion, event)
    case 'progress':
      assertPhase(state, event.type, ['available', 'downloading'])
      requireVersion(event.version)
      assertUpdateContext(state, event)
      if (!Number.isFinite(event.percent)) throw new Error('更新下载进度必须是有限数字。')
      return {
        ...updateVersionStatus('downloading', state.currentVersion, event),
        percent: Math.min(100, Math.max(0, event.percent))
      }
    case 'downloaded':
      assertPhase(state, event.type, ['available', 'downloading'])
      requireVersion(event.version)
      assertUpdateContext(state, event)
      return updateVersionStatus('downloaded', state.currentVersion, event)
    case 'installing':
      assertPhase(state, event.type, ['downloaded'])
      requireVersion(event.version)
      assertUpdateContext(state, event)
      return updateVersionStatus('installing', state.currentVersion, event)
    case 'up-to-date':
      assertPhase(state, event.type, ['checking'])
      return state.manual
        ? { phase: 'up-to-date', currentVersion: state.currentVersion, manual: true }
        : initialUpdateStatus(state.currentVersion)
    case 'unsupported':
      assertPhase(state, event.type, ['checking'])
      assertManual(state, event.manual)
      return {
        phase: 'unsupported',
        currentVersion: state.currentVersion,
        reason: event.reason,
        manual: event.manual
      }
    case 'error': {
      assertPhase(state, event.type, ['checking', 'available', 'downloading', 'downloaded', 'installing'])
      if (state.phase === 'checking') {
        assertManual(state, event.manual)
        if (event.required) requireVersion(event.version)
      } else {
        requireVersion(event.version)
        assertErrorContext(state, event)
      }
      const base = {
        phase: 'error' as const,
        currentVersion: state.currentVersion,
        required: event.required,
        message: event.message,
        manual: event.manual,
        retryable: event.retryable
      }
      return event.version === undefined
        ? base
        : { ...base, availableVersion: event.version }
    }
  }
}

interface VersionEvent {
  version: string
  required: boolean
  manual: boolean
}

function updateVersionStatus<Phase extends 'available' | 'downloading' | 'downloaded' | 'installing'>(
  phase: Phase,
  currentVersion: string,
  event: VersionEvent
): {
  phase: Phase
  currentVersion: string
  availableVersion: string
  required: boolean
  manual: boolean
} {
  return {
    phase,
    currentVersion,
    availableVersion: event.version,
    required: event.required,
    manual: event.manual
  }
}

function requireVersion(version: string | undefined): asserts version is string {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('更新状态事件缺少版本。')
  }
}

function assertPhase<Phase extends UpdateStatus['phase']>(
  state: UpdateStatus,
  event: UpdateStateEvent['type'],
  allowed: readonly Phase[]
): asserts state is Extract<UpdateStatus, { phase: Phase }> {
  const allowedPhases: readonly UpdateStatus['phase'][] = allowed
  if (!allowedPhases.includes(state.phase)) {
    throw new Error(`不允许从 ${state.phase} 状态转换到 ${event}。`)
  }
}

function assertManual(
  state: Extract<UpdateStatus, { phase: 'checking' }>,
  manual: boolean
): void {
  if (state.manual !== manual) throw new Error('更新状态事件与当前检查上下文不一致。')
}

function assertUpdateContext(
  state: Extract<UpdateStatus, { phase: 'available' | 'downloading' | 'downloaded' }>,
  event: VersionEvent
): void {
  if (
    state.availableVersion !== event.version ||
    state.required !== event.required ||
    state.manual !== event.manual
  ) {
    throw new Error('更新状态事件与当前更新上下文不一致。')
  }
}

function assertErrorContext(
  state: Extract<UpdateStatus, { phase: 'available' | 'downloading' | 'downloaded' | 'installing' }>,
  event: Extract<UpdateStateEvent, { type: 'error' }>
): void {
  if (
    (event.version !== undefined && state.availableVersion !== event.version) ||
    state.required !== event.required ||
    state.manual !== event.manual
  ) {
    throw new Error('更新错误事件与当前更新上下文不一致。')
  }
}
