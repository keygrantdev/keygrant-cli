/**
 * Builds the `keygrant` command into one file, dist/keygrant.js: what npm installs as the
 * package's bin. The lease format from `shared` is bundled in; its schema library, zod, stays
 * an import, a dependency npm installs beside it (so its version is the package's range, as
 * the Electron SDK's is), and so does the credential store's native module, an optional
 * dependency installed for the platform it runs on.
 *
 *   node scripts/build.mjs
 */
import { build } from 'esbuild'
import { chmodSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = readFileSync(join(root, 'src', 'version.ts'), 'utf8').match(/VERSION = '([^']+)'/)?.[1]
if (version !== pkg.version) throw new Error(`src/version.ts says ${version}, package.json ${pkg.version}: make them the same`)

rmSync(dist, { recursive: true, force: true })
const outfile = join(dist, 'keygrant.js')
await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})],
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
})
chmodSync(outfile, 0o755)
