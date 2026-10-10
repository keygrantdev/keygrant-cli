/**
 * Checks the packed `@keygrant/cli` as npm installs it, before it is published: `pnpm pack`
 * (which builds, `prepack`), then the tarball unpacked and its command run.
 *
 * - The tarball holds the command, its README, its license and its manifest, and nothing else.
 * - The manifest names the `keygrant` bin, Node 22 or later, zod as its one dependency and the
 *   credential store module as its one optional dependency.
 * - The command imports nothing but Node's own modules and those two: everything else is
 *   bundled in.
 * - It runs from the unpacked tarball: its version is the manifest's, its help lists every
 *   command, a conformance lease verifies offline and a tampered one does not.
 *
 * `pnpm --filter @keygrant/cli run check:package`, and `prepublishOnly` runs it.
 * `--tarball <file>` checks a tarball already packed instead (the publish workflow's: the very
 * file it then publishes). It needs no network: zod, which the PACKED manifest names, is linked
 * from this workspace into the unpacked package (so a manifest that dropped it fails here too).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'keygrant-cli-package-'))
const failures = []
const expect = (ok, said) => {
  if (!ok) failures.push(said)
}

try {
  const given = process.argv.indexOf('--tarball')
  const tarball = given >= 0 ? resolve(process.argv[given + 1]) : pack()
  const pkgDir = join(work, 'package')
  untar(gunzipSync(readFileSync(tarball)), pkgDir)
  checkContents(pkgDir)
  checkManifest(pkgDir)
  checkImports(pkgDir)
  checkCommand(pkgDir)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`@keygrant/cli is not fit to publish:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('@keygrant/cli: the package holds the command alone, and it runs.')

function pack() {
  const out = join(work, 'pack')
  mkdirSync(out)
  const pnpm = process.env.npm_execpath
  const ran =
    pnpm && /pnpm/i.test(pnpm)
      ? spawnSync(process.execPath, [pnpm, 'pack', '--pack-destination', out], { cwd: root, encoding: 'utf8' })
      : spawnSync(`pnpm pack --pack-destination "${out}"`, { cwd: root, encoding: 'utf8', shell: true })
  if (ran.status !== 0) throw new Error(`pnpm pack failed:\n${ran.stdout}${ran.stderr}`)
  const [file] = readdirSync(out)
  return join(out, file)
}

function checkContents(pkgDir) {
  const files = walk(pkgDir).map((f) => relative(pkgDir, f).split('\\').join('/')).sort()
  const wanted = ['LICENSE', 'README.md', 'dist/keygrant.js', 'package.json']
  expect(JSON.stringify(files) === JSON.stringify(wanted), `the tarball holds ${files.join(', ')}; it should hold ${wanted.join(', ')}`)
}

function checkManifest(pkgDir) {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  expect(manifest.bin?.keygrant === './dist/keygrant.js', 'the manifest does not name the keygrant bin')
  expect(manifest.engines?.node === '>=22', 'the manifest does not ask for Node 22 or later')
  const deps = Object.keys(manifest.dependencies ?? {})
  expect(JSON.stringify(deps) === '["zod"]', `the dependencies are ${deps.join(', ') || 'none'}, not zod alone`)
  const optional = Object.keys(manifest.optionalDependencies ?? {})
  expect(JSON.stringify(optional) === '["@napi-rs/keyring"]', `the optional dependencies are ${optional.join(', ') || 'none'}, not @napi-rs/keyring alone`)
}

function checkImports(pkgDir) {
  const code = readFileSync(join(pkgDir, 'dist', 'keygrant.js'), 'utf8')
  expect(code.startsWith('#!/usr/bin/env node\n'), 'the command does not start with its #! line')
  const named = new Set()
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) named.add(m[1])
  const allowed = (name) => name === 'zod' || name === '@napi-rs/keyring' || name.startsWith('node:') || builtinModules.includes(name)
  const outside = [...named].filter((name) => !allowed(name))
  expect(outside.length === 0, `the command imports what it should bundle: ${outside.join(', ')}`)
}

/** The dependencies the packed manifest names, linked from this workspace beside the unpacked command, as npm installs them. */
function linkDependencies(pkgDir) {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const require = createRequire(join(root, 'package.json'))
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    const at = join(pkgDir, 'node_modules', dep)
    mkdirSync(dirname(at), { recursive: true })
    // A junction on Windows, which needs no administrator; a plain symlink elsewhere.
    symlinkSync(dirname(require.resolve(`${dep}/package.json`)), at, 'junction')
  }
}

function checkCommand(pkgDir) {
  linkDependencies(pkgDir)
  const command = join(pkgDir, 'dist', 'keygrant.js')
  const run = (...args) => spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } })
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const version = run('--version')
  expect(version.status === 0 && version.stdout.trim() === manifest.version, `--version says "${version.stdout.trim()}" (exit ${version.status}), not ${manifest.version}`)
  const help = run('--help')
  expect(help.status === 0 && help.stdout.includes('licenses issue') && help.stdout.includes('verify'), '--help does not list the commands')

  const vectors = JSON.parse(readFileSync(join(root, '..', 'conformance', 'vectors.json'), 'utf8'))
  const lease = vectors.leases.find((v) => v.verify.valid)
  const keyFile = join(work, 'keys.json')
  writeFileSync(keyFile, JSON.stringify({ keys: [vectors.publicJwk] }))
  const valid = run('verify', lease.token, '--key', keyFile, '--at', String(lease.now), '--json')
  expect(valid.status === 0 && JSON.parse(valid.stdout || '{}').valid === true, `a conformance lease did not verify (exit ${valid.status}): ${valid.stderr}`)
  const [head, payload, signature] = lease.token.split('.')
  const tampered = `${head}.${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
  const refused = run('verify', tampered, '--key', keyFile, '--at', String(lease.now))
  expect(refused.status === 1, `a tampered lease was not refused (exit ${refused.status})`)
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

/** The regular files of a tar archive written under `dest`, the leading `package/` stripped. */
function untar(archive, dest) {
  for (let at = 0; at + 512 <= archive.length; ) {
    const header = archive.subarray(at, at + 512)
    if (header.every((b) => b === 0)) break
    const text = (from, to) => header.subarray(from, to).toString('utf8').replace(/\0.*$/s, '')
    const size = parseInt(text(124, 136).trim() || '0', 8)
    const type = text(156, 157) || '0'
    const prefix = text(345, 500)
    const name = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100)
    if (type === '0') {
      const path = join(dest, name.replace(/^package\//, ''))
      // Never outside the folder it unpacks into, whatever a tarball's names say.
      if (!resolve(path).startsWith(resolve(dest) + sep)) throw new Error(`the tarball names a file outside its package: ${name}`)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, archive.subarray(at + 512, at + 512 + size))
    } else if (type === 'x' || type === 'g') {
      // A PAX header naming a path renames the entry after it for npm, not for this check: refused.
      const records = archive.subarray(at + 512, at + 512 + size).toString('utf8')
      if (/(?:^|\n)\d+ (?:path|linkpath)=/.test(records)) throw new Error(`the tarball renames an entry in a PAX header: ${name}`)
    } else if (type !== '5') {
      // A link, or any other entry the contents check would not see: the package holds files alone.
      throw new Error(`the tarball holds an entry of type ${type}: ${name}`)
    }
    at += 512 + Math.ceil(size / 512) * 512
  }
}
