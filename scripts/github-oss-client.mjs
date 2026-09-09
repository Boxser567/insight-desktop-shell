import OSS from 'ali-oss'

const expectedRepository = 'Boxser567/insight-desktop-shell'
const expectedRepositoryId = '1344679131'
const expectedBucket = 'insight-desktop-updates'
const expectedRegion = 'oss-cn-guangzhou'
const expectedEndpoint = 'oss-cn-guangzhou.aliyuncs.com'
const expectedRef = 'refs/heads/main'
const expectedEvent = 'workflow_dispatch'
const expectedWorkflowRef = 'Boxser567/insight-desktop-shell/.github/workflows/publish-update.yml@refs/heads/main'
const gatewayBaseUrl = 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway'
const oidcAudience = 'insight-harness-oss-upload'
const refreshBeforeExpirationMs = 180_000
const requestTimeoutMs = 45_000
const securityTokenErrorCodes = new Set([
  'SecurityTokenExpired',
  'InvalidSecurityToken'
])

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`)
  }
  return value
}

function safeMachineCode(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,80}$/u.test(value)
    ? value
    : 'UNKNOWN_ERROR'
}

function responseErrorCode(value) {
  if (!value || typeof value !== 'object') return 'UNKNOWN_ERROR'
  const detail = value.detail
  const code = detail && typeof detail === 'object' ? detail.code : value.code
  return safeMachineCode(code)
}

function safeOssError(error) {
  const statusValue = error && typeof error === 'object' ? error.status : undefined
  const status = Number.isInteger(statusValue) ? String(statusValue) : 'unknown'
  const code = safeMachineCode(error && typeof error === 'object' ? error.code : undefined)
  const requestIdValue = error && typeof error === 'object'
    ? error.requestId ?? error.request_id
    : undefined
  const requestId = typeof requestIdValue === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(requestIdValue)
    ? requestIdValue
    : 'unknown'
  return new Error(`OSS request failed: status=${status}; code=${code}; requestId=${requestId}.`)
}

function validateHttpsUrl(value, name) {
  let url
  try {
    url = new URL(requiredString(value, name))
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${name} must be a valid HTTPS URL.`)
  }
  return url
}

export function assertGithubPublisherEnvironment(environment) {
  if (environment.GITHUB_ACTIONS !== 'true') {
    throw new Error('The OSS publisher must run in GitHub Actions.')
  }
  if (environment.GITHUB_REPOSITORY !== expectedRepository) {
    throw new Error('GitHub repository is not approved for OSS publishing.')
  }
  if (environment.GITHUB_REPOSITORY_ID !== expectedRepositoryId) {
    throw new Error('GitHub repository ID is not approved for OSS publishing.')
  }
  if (!/^\d+$/u.test(environment.GITHUB_RUN_ID ?? '')) {
    throw new Error('GitHub run ID is invalid.')
  }
  if (environment.GITHUB_REF !== expectedRef) {
    throw new Error('OSS publishing is restricted to refs/heads/main.')
  }
  if (environment.GITHUB_EVENT_NAME !== expectedEvent) {
    throw new Error('OSS publishing requires workflow_dispatch.')
  }
  if (environment.GITHUB_WORKFLOW_REF !== expectedWorkflowRef) {
    throw new Error('GitHub workflow is not approved for OSS publishing.')
  }
  const oidcRequestUrl = validateHttpsUrl(
    environment.ACTIONS_ID_TOKEN_REQUEST_URL,
    'GitHub OIDC request URL'
  )
  if (!oidcRequestUrl.hostname.endsWith('.actions.githubusercontent.com')) {
    throw new Error('GitHub OIDC request host is invalid.')
  }
  const oidcRequestToken = requiredString(
    environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    'GitHub OIDC request token'
  )
  return {
    repositoryId: environment.GITHUB_REPOSITORY_ID,
    runId: environment.GITHUB_RUN_ID,
    oidcRequestUrl,
    oidcRequestToken
  }
}

export function validateStsResponse(value, environment) {
  if (!value || typeof value !== 'object' || value.code !== 'SUCCESS' ||
      !value.data || typeof value.data !== 'object') {
    throw new Error(`STS response failed: code=${responseErrorCode(value)}.`)
  }
  const data = value.data
  for (const name of ['accessKeyId', 'accessKeySecret', 'securityToken', 'expiration']) {
    requiredString(data[name], `STS ${name}`)
  }
  const expirationMs = Date.parse(data.expiration)
  if (!Number.isFinite(expirationMs)) throw new Error('STS expiration is invalid.')
  if (!Number.isSafeInteger(data.durationSeconds) || data.durationSeconds <= 0 ||
      data.durationSeconds > 3600) {
    throw new Error('STS durationSeconds is invalid.')
  }
  if (data.bucket !== expectedBucket) throw new Error('STS bucket is not approved.')
  if (data.region !== expectedRegion) throw new Error('STS region is not approved.')
  if (data.endPoint !== expectedEndpoint) throw new Error('STS endpoint is not approved.')
  if (data.dir !== '') throw new Error('STS directory must be the approved bucket root.')
  if (data.fileType !== 'file') throw new Error('STS fileType is invalid.')
  if (data.url !== null) throw new Error('STS url must be null for directory-level credentials.')
  if (Object.hasOwn(data, 'fileName') || Object.hasOwn(data, 'userId')) {
    throw new Error('STS response still uses a file or user-scoped contract.')
  }
  if (data.repositoryId !== environment.GITHUB_REPOSITORY_ID) {
    throw new Error('STS repository ID does not match this workflow.')
  }
  if (data.runId !== environment.GITHUB_RUN_ID) {
    throw new Error('STS run ID does not match this workflow.')
  }
  return { ...data, expirationMs }
}

async function readJsonResponse(fetchImplementation, url, init, label) {
  let response
  try {
    response = await fetchImplementation(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeoutMs)
    })
  } catch {
    throw new Error(`${label} network request failed.`)
  }
  let value
  try {
    value = await response.json()
  } catch {
    throw new Error(`${label} did not return valid JSON.`)
  }
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}; code=${responseErrorCode(value)}.`)
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} did not return a JSON object.`)
  }
  return value
}

function assertObjectKey(key, kind) {
  if (typeof key !== 'string' || !key.startsWith('desktop/') || key.includes('\\') ||
      key.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`OSS ${kind} is outside the approved desktop prefix.`)
  }
}

function resultSummary(result) {
  const status = result?.res?.status
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    throw new Error('OSS SDK returned an invalid success response.')
  }
  const headers = result?.res?.headers ?? {}
  return {
    status,
    requestId: headers['x-oss-request-id'] ?? headers['x-oss-requestid'] ?? null
  }
}

export function createGithubOssClient({
  environment = process.env,
  fetch: fetchImplementation = globalThis.fetch,
  now = Date.now,
  ossClientFactory = (configuration) => new OSS(configuration)
} = {}) {
  const identity = assertGithubPublisherEnvironment(environment)
  if (typeof fetchImplementation !== 'function') throw new Error('Fetch is unavailable.')
  if (typeof ossClientFactory !== 'function') throw new Error('OSS client factory is unavailable.')
  let session

  async function refreshSession() {
    const oidcUrl = new URL(identity.oidcRequestUrl)
    oidcUrl.searchParams.set('audience', oidcAudience)
    const oidcResponse = await readJsonResponse(fetchImplementation, oidcUrl, {
      headers: {
        authorization: `Bearer ${identity.oidcRequestToken}`,
        accept: 'application/json'
      }
    }, 'GitHub OIDC request')
    const oidcToken = requiredString(oidcResponse.value, 'GitHub OIDC token')
    const stsResponse = await readJsonResponse(fetchImplementation,
      `${gatewayBaseUrl}/v1/upload/sts/token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oidcToken}`,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: '{}'
      }, 'STS request')
    const credentials = validateStsResponse(stsResponse, environment)
    if (credentials.expirationMs <= now()) throw new Error('STS credentials are already expired.')
    const configuration = {
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      stsToken: credentials.securityToken,
      bucket: credentials.bucket,
      region: credentials.region,
      endpoint: `https://${credentials.endPoint}`,
      secure: true,
      authorizationV4: true,
      retryMax: 0,
      timeout: 30 * 60_000,
      refreshSTSToken: async () => ({
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        stsToken: credentials.securityToken
      }),
      refreshSTSTokenInterval: 24 * 60 * 60_000
    }
    session = {
      client: ossClientFactory(configuration),
      expirationMs: credentials.expirationMs
    }
    return session
  }

  async function currentSession() {
    if (!session || session.expirationMs - now() < refreshBeforeExpirationMs) {
      return refreshSession()
    }
    return session
  }

  async function runOperation(operation) {
    let active = await currentSession()
    try {
      return await operation(active.client)
    } catch (error) {
      if (!securityTokenErrorCodes.has(error?.code)) throw safeOssError(error)
    }
    session = undefined
    active = await currentSession()
    try {
      return await operation(active.client)
    } catch (error) {
      throw safeOssError(error)
    }
  }

  return {
    async listObjects(prefix) {
      assertObjectKey(prefix, 'prefix')
      const result = await runOperation((client) => client.listV2({
        prefix,
        'max-keys': 1000
      }))
      if (result?.isTruncated === true) {
        throw new Error('OSS release prefix contains more objects than the publisher permits.')
      }
      const objects = result?.objects ?? []
      if (!Array.isArray(objects)) throw new Error('OSS object listing is invalid.')
      return objects.map((object) => {
        if (typeof object?.name !== 'string' || !Number.isSafeInteger(object?.size) ||
            object.size < 0) {
          throw new Error('OSS object listing is invalid.')
        }
        return { key: object.name, size: object.size }
      })
    },

    async getObject(key, destination) {
      assertObjectKey(key, 'object key')
      requiredString(destination, 'OSS download destination')
      const result = await runOperation((client) => client.get(key, destination))
      return resultSummary(result)
    },

    async putObject(key, source, headers) {
      assertObjectKey(key, 'object key')
      requiredString(source, 'OSS upload source')
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('OSS upload headers are invalid.')
      }
      const result = await runOperation((client) => client.put(key, source, { headers }))
      return resultSummary(result)
    }
  }
}
