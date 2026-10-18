/**
 * Builds the `keygrant` command as one executable file for the machine this runs on, with Node's single executable
 * applications: dist-binary/keygrant-<version>-<os>-<arch>[.exe] and its .sha256 beside it. Nothing to install
 * first, not even Node.js. The publish workflow (.github/workflows/publish.yml) runs it on a runner for each
 * platform and attaches the files to the version's GitHub release; the gate before a release runs it on Linux.
 *
 * The command is bundled whole, zod included, as the one CommonJS script a single executable runs (src/binary.ts);
 * the credential store's native module cannot be loaded from inside one, so the binary keeps no key and every
 * command reads KEYGRANT_API_KEY. The script is injected into a copy of the Node.js running this build (so build
 * with the Node.js 22 the package runs on), then the copy is checked: its version, its help, a lease verified offline,
 * and that it says it keeps no key. On macOS the copy is signed ad hoc, which Apple silicon needs to run it at all. A release's
 * files are signed properly, where at all, by the publish workflow's signing jobs: Developer ID and notarized on macOS,
 * Authenticode on Windows.
 *
 *   node scripts/build-binary.mjs
 */
import { build } from 'esbuild'
import { inject } from 'postject'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripAuthenticode } from './strip-authenticode.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-binary')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = readFileSync(join(root, 'src', 'version.ts'), 'utf8').match(/VERSION = '([^']+)'/)?.[1]
if (version !== pkg.version) throw new Error(`src/version.ts says ${version}, package.json ${pkg.version}: make them the same`)
if (!process.versions.node.startsWith('22.')) throw new Error(`build the binary with Node.js 22, the version the package runs on, not ${process.versions.node}`)

/** The platform as a file name says it. */
const OS = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform]
if (!OS) throw new Error(`no single binary is built for ${process.platform}`)
const exe = process.platform === 'win32' ? '.exe' : ''
const name = `keygrant-${version}-${OS}-${process.arch}${exe}`
const binary = join(out, name)

/** Node's sentinel for a single executable's blob (its documentation, "Single executable applications"). */
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const work = join(out, 'work')
mkdirSync(work)

const script = join(work, 'keygrant.cjs')
await build({
  entryPoints: [join(root, 'src', 'binary.ts')],
  outfile: script,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Never loaded: the binary hands the credential store a loader that says there is none (src/binary.ts).
  external: ['@napi-rs/keyring'],
  // keyring.ts's default loader reads import.meta, empty in CommonJS; the binary never calls it.
  logOverride: { 'empty-import-meta': 'silent' },
  legalComments: 'none',
  logLevel: 'warning',
})

const config = join(work, 'sea-config.json')
const blob = join(work, 'keygrant.blob')

/** Runs the built binary with no API key in its environment, and answers what it printed and its exit code. */
function run(...args) {
  const env = { ...process.env }
  delete env.KEYGRANT_API_KEY
  const res = spawnSync(binary, args, { encoding: 'utf8', env })
  if (res.error) throw res.error
  return { code: res.status, out: res.stdout.trim(), err: res.stderr.trim() }
}

/**
 * Checks the binary does what the release says: its version and help; a lease verified offline, as every SDK
 * verifies the conformance vectors' first (the bundled lease format, its schemas and Ed25519); and, with no key set,
 * exit 3 and the plain reason, never a crash loading the credential store.
 */
function check() {
  const said = run('--version')
  if (said.code !== 0 || said.out !== version) throw new Error(`the binary says ${JSON.stringify(said)}, not ${version}`)
  const help = run('--help')
  if (help.code !== 0 || !help.out.startsWith(`keygrant ${version}:`)) throw new Error(`the binary's help is ${JSON.stringify(help.out.slice(0, 80))}`)
  const vectors = JSON.parse(readFileSync(join(root, '..', 'conformance', 'vectors.json'), 'utf8'))
  const lease = vectors.leases.find((v) => v.expect?.ok === true)
  if (!lease) throw new Error('conformance/vectors.json has no valid lease to verify')
  writeFileSync(join(work, 'key.json'), JSON.stringify(vectors.publicJwk))
  writeFileSync(join(work, 'lease.txt'), lease.token)
  const verified = run('verify', join(work, 'lease.txt'), '--key', join(work, 'key.json'), '--at', String(lease.now))
  if (verified.code !== 0 || !verified.out.startsWith('Valid lease.')) throw new Error(`the binary verifies ${lease.name} as ${JSON.stringify(verified)}`)
  const keyless = run('products', '--api-url', 'http://127.0.0.1:9')
  if (keyless.code !== 3 || !keyless.err.includes('this single binary carries no credential store')) throw new Error(`with no key the binary says ${JSON.stringify(keyless)}`)
}

try {
  writeFileSync(config, JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }))
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' })
  copyFileSync(process.execPath, binary)
  chmodSync(binary, 0o755)
  // Node.js's own signature comes off first (Node's documentation), or the injection corrupts it and no signing tool
  // can sign the file after.
  if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary], { stdio: 'inherit' })
  if (process.platform === 'win32') writeFileSync(binary, stripAuthenticode(readFileSync(binary)))
  await inject(binary, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: SEA_FUSE, ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}) })
  if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary], { stdio: 'inherit' })
  check()
} catch (error) {
  // A file that failed is never left behind named like a release's.
  rmSync(binary, { force: true })
  throw error
} finally {
  rmSync(work, { recursive: true, force: true })
}

const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')
writeFileSync(`${binary}.sha256`, `${sha256}  ${name}\n`)
console.log(`${name}: Node.js ${process.version}, ${(readFileSync(binary).length / 1e6).toFixed(1)} MB, sha256 ${sha256}`)
