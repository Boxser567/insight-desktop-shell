import { generateKeyPairSync } from 'node:crypto'
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!['--private-key', '--public-key'].includes(name) || !value || values.has(name)) {
      throw new Error(
        'Usage: generate-update-signing-keypair.mjs --private-key <path> --public-key <path>'
      )
    }
    values.set(name, resolve(value))
  }
  if (values.size !== 2) {
    throw new Error(
      'Usage: generate-update-signing-keypair.mjs --private-key <path> --public-key <path>'
    )
  }
  return {
    privateKeyPath: values.get('--private-key'),
    publicKeyPath: values.get('--public-key')
  }
}

function isInside(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function assertMissing(path) {
  try {
    await access(path)
  } catch {
    return
  }
  throw new Error(`Refusing to overwrite an existing signing key: ${path}`)
}

async function main() {
  const { privateKeyPath, publicKeyPath } = parseArguments(process.argv.slice(2))
  if (privateKeyPath === publicKeyPath) {
    throw new Error('Private and public signing key paths must differ.')
  }
  if (isInside(repositoryRoot, privateKeyPath)) {
    throw new Error('The update signing private key must be stored outside the repository.')
  }

  await Promise.all([assertMissing(privateKeyPath), assertMissing(publicKeyPath)])
  await Promise.all([
    mkdir(dirname(privateKeyPath), { recursive: true }),
    mkdir(dirname(publicKeyPath), { recursive: true })
  ])

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  await writeFile(privateKeyPath, privateKeyPem, { mode: 0o600, flag: 'wx' })
  await chmod(privateKeyPath, 0o600)
  await writeFile(publicKeyPath, publicKeyPem, { mode: 0o644, flag: 'wx' })
}

await main()
