import semver from 'semver'
import { z } from 'zod'
import type {
  ReleaseUpdateChannel,
  UpdateTargetId,
  UpdateTrack
} from '../../shared/update-contracts'

const distributionSchema = z.object({
  schema: z.literal(1),
  updateOrigin: z.string().min(1)
}).strict()

const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u

export interface UpdateDistribution {
  updateOrigin: URL
  currentPointerUrl(channel: ReleaseUpdateChannel): URL
  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL
  artifactUrl(channel: ReleaseUpdateChannel, version: string, name: string): URL
  v2PointerUrl(track: UpdateTrack, target?: UpdateTargetId): URL
  v2ReleaseBaseUrl(version: string): URL
  v2TargetBaseUrl(version: string, target: UpdateTargetId): URL
  v2ReleaseArtifactUrl(version: string, name: string): URL
  v2TargetArtifactUrl(version: string, target: UpdateTargetId, name: string): URL
}

export function parseUpdateDistribution(value: unknown): UpdateDistribution {
  const config = distributionSchema.parse(value)
  const updateOrigin = parseOrigin(config.updateOrigin)
  const releaseBaseUrl = (
    channel: ReleaseUpdateChannel,
    version: string
  ): URL => {
    assertReleaseVersion(channel, version)
    return new URL(`desktop/releases/v${version}/`, updateOrigin)
  }

  return {
    updateOrigin,
    currentPointerUrl(channel) {
      assertChannel(channel)
      return new URL(`desktop/${channel}/current.json`, updateOrigin)
    },
    releaseBaseUrl,
    artifactUrl(channel, version, name) {
      assertArtifactName(name)
      return new URL(name, releaseBaseUrl(channel, version))
    },
    v2PointerUrl(track, target) {
      if (track === 'stable') {
        if (target !== undefined) throw new Error('Stable 更新指针不能指定单一目标。')
        return new URL('desktop/stable/current.json', updateOrigin)
      }
      if (track !== 'candidate' || target === undefined) {
        throw new Error('Candidate 更新指针必须指定目标。')
      }
      assertTargetId(target)
      return new URL(`desktop/candidate-v2/${target}/current.json`, updateOrigin)
    },
    v2ReleaseBaseUrl(version) {
      assertFinalReleaseVersion(version)
      return new URL(`desktop/releases/v${version}/`, updateOrigin)
    },
    v2TargetBaseUrl(version, target) {
      assertFinalReleaseVersion(version)
      assertTargetId(target)
      return new URL(`desktop/releases/v${version}/targets/${target}/`, updateOrigin)
    },
    v2ReleaseArtifactUrl(version, name) {
      assertArtifactName(name)
      assertFinalReleaseVersion(version)
      return new URL(name, new URL(`desktop/releases/v${version}/`, updateOrigin))
    },
    v2TargetArtifactUrl(version, target, name) {
      assertArtifactName(name)
      assertFinalReleaseVersion(version)
      assertTargetId(target)
      return new URL(
        name,
        new URL(`desktop/releases/v${version}/targets/${target}/`, updateOrigin)
      )
    }
  }
}

function parseOrigin(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('更新 Origin 无效。')
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('更新 Origin 必须是无路径、参数或凭证的 HTTPS Origin。')
  }
  return url
}

function assertChannel(channel: string): asserts channel is ReleaseUpdateChannel {
  if (channel !== 'candidate' && channel !== 'stable') {
    throw new Error('更新渠道无效。')
  }
}

function assertReleaseVersion(channel: ReleaseUpdateChannel, version: string): void {
  assertChannel(channel)
  const pattern = channel === 'candidate'
    ? /^\d+\.\d+\.\d+-rc\.\d+$/u
    : /^\d+\.\d+\.\d+$/u
  if (!pattern.test(version) || semver.valid(version) !== version) {
    throw new Error('更新版本与渠道不一致。')
  }
}

function assertArtifactName(name: string): void {
  if (!artifactNamePattern.test(name) || name === '.' || name === '..') {
    throw new Error('更新产物文件名无效。')
  }
}

function assertFinalReleaseVersion(version: string): void {
  const parsed = semver.parse(version)
  if (
    semver.valid(version) !== version ||
    !parsed ||
    parsed.prerelease.length > 0 ||
    parsed.build.length > 0
  ) {
    throw new Error('v2 更新版本必须是最终语义版本。')
  }
}

function assertTargetId(target: string): asserts target is UpdateTargetId {
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) {
    throw new Error('v2 更新目标无效。')
  }
}
