import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'

export function skillProxyRuntimePaths(environment: NodeJS.ProcessEnv = process.env) {
  // On macOS process.execPath is Electron Helper, not the packaged Node binary.
  const node = environment.INSIGHT_BUNDLED_NODE_PATH
  const client = fileURLToPath(new URL('../resources/skill-proxy-client.mjs', import.meta.url))
  if (!node || !isAbsolute(node) || !existsSync(node)) throw new Error('Bundled skill proxy Node runtime is missing')
  if (!existsSync(client)) throw new Error('Bundled skill proxy client is missing')
  return { node, client }
}

export function registerSkillProxyEnvironment(ctx: Context, paths = skillProxyRuntimePaths()): () => void {
  return ctx.shellEnv.register({
    name: 'insight-skill-proxy',
    variables: {
      DSH_SKILL_PROXY_NODE: { description: '内置 Node.js 绝对路径，用于调用技能代理，无需安装系统 Node/Python。' },
      DSH_SKILL_PROXY_CLIENT: { description: '内置技能代理 JS 路径。用 "$DSH_SKILL_PROXY_NODE" "$DSH_SKILL_PROXY_CLIENT" CONNECTION GET|POST PATH --body-file file.json 调用，自动携带登录态。' }
    },
    resolve: () => ({ DSH_SKILL_PROXY_NODE: paths.node, DSH_SKILL_PROXY_CLIENT: paths.client })
  })
}
