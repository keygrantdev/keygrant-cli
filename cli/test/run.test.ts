import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { COMMANDS } from '../src/run.js'
import { VERSION } from '../src/version.js'
import { harness, license, MemoryStore } from './harness.js'

describe('the command line', () => {
  it('prints the help for no command, help, -h and --help, listing every command', async () => {
    for (const argv of [[], ['help'], ['-h'], ['--help']]) {
      const res = await harness().run(...argv)
      expect(res.code).toBe(EXIT.ok)
      expect(res.out.split('\n')[0]).toBe(`keygrant ${VERSION}: KeyGrant licensing from a terminal or a build pipeline.`)
      for (const c of COMMANDS) expect(res.out).toContain(`  ${c.name}`)
    }
  })

  it('prints a command\'s own help for --help and help <command>, and runs nothing', async () => {
    const h = harness()
    const asked = await h.run('licenses', 'extend', '--help')
    expect(asked.out.split('\n')[0]).toBe('Move a license\'s expiry later.')
    expect(asked.out).toContain('Usage: keygrant licenses extend <key> (--to <date> | --days <n>)')
    expect((await h.run('help', 'licenses', 'extend')).out).toBe(asked.out)
    expect((await h.run('licenses')).out).toContain('Commands:')
    expect(h.calls).toEqual([])
  })

  it('prints its version for --version, -v and version, matching the package', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(VERSION).toBe(pkg.version)
    for (const flag of ['--version', '-v', 'version']) expect(await harness().run(flag)).toEqual({ code: EXIT.ok, out: VERSION, err: '' })
  })

  it('refuses a command it does not know with exit 2', async () => {
    expect(await harness().run('licenses', 'frobnicate')).toEqual({ code: EXIT.usage, out: '', err: 'keygrant: unknown command "licenses frobnicate": run `keygrant --help` for the list' })
    expect((await harness().run('deploy')).code).toBe(EXIT.usage)
    expect((await harness().run('prodcts', '--json')).err).toBe(JSON.stringify({ error: 'cli', message: 'unknown command "prodcts": run `keygrant --help` for the list' }, null, 2))
    expect((await harness().run('prodcts', '--no-retry')).err).toBe('keygrant: unknown command "prodcts": run `keygrant --help` for the list')
    const bare = await harness().run('licenses', '--json', 'list')
    expect(bare.code).toBe(EXIT.usage)
    expect(JSON.parse(bare.err)).toEqual({ error: 'cli', message: 'licenses needs a command: keygrant licenses <command> [options] (keygrant --help lists them)' })
    const short = await harness().run('licenses', '-h')
    expect(short.code).toBe(EXIT.ok)
    expect(short.out).toContain('Commands:')
    const json = await harness().run('--json', 'licenses', 'lst')
    expect(JSON.parse(json.err)).toMatchObject({ error: 'cli', message: 'unknown command "licenses lst": run `keygrant --help` for the list' })
  })

  it('refuses an API address it cannot use, with the command\'s help, and takes --api-url=x before the words', async () => {
    const bad = harness()
    expect(await bad.run('licenses', 'get', 'K', '--api-url', 'http://example.com')).toEqual({
      code: EXIT.usage,
      out: '',
      err: 'keygrant: the API URL must be https:// (http:// only for localhost, 127.0.0.1 or [::1]), not "http://example.com"\nRun `keygrant licenses get --help`.',
    })
    expect(bad.calls).toEqual([])
    const h = harness({ answers: [{ status: 200, body: { license: license() } }] })
    expect((await h.run('--api-url=http://127.0.0.1:4660', 'licenses', 'get', 'K')).code).toBe(EXIT.ok)
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:4660/v1/licenses/K')
  })

  it('takes the group as licences or license too, and the options every command takes before its words', async () => {
    const h = harness({ answers: [{ status: 200, body: { license: license() } }, { status: 200, body: { license: license() } }] })
    expect((await h.run('licences', 'get', 'K')).code).toBe(EXIT.ok)
    const res = await h.run('--json', '--api-url', 'http://localhost:4660', 'license', 'get', 'K')
    expect(JSON.parse(res.out)).toEqual({ license: license() })
    expect(h.calls[1]?.url).toBe('http://localhost:4660/v1/licenses/K')
  })

  it('reports an unexpected failure in a sentence, exit 1', async () => {
    const store = new MemoryStore()
    store.get = async () => {
      throw new Error('keychain exploded')
    }
    const res = await harness({ env: {}, store }).run('licenses', 'get', 'K')
    expect(res).toEqual({ code: EXIT.refused, out: '', err: 'keygrant: unexpected error: keychain exploded' })
    const json = await harness({ env: {}, store }).run('licenses', 'get', 'K', '--json')
    expect(JSON.parse(json.err)).toEqual({ error: 'unexpected', message: 'keychain exploded' })
  })

  it('names a code a server sends as it is, even one every object has, and exits by its status', async () => {
    for (const code of ['constructor', 'toString', '__proto__']) {
      const res = await harness({ answers: [{ status: 503, body: { error: code } }] }).run('licenses', 'get', 'K')
      expect([code, res.code, res.err]).toEqual([code, EXIT.unavailable, `keygrant: ${code}: KeyGrant failed (HTTP 503): try again shortly`])
    }
  })

  it('refuses an empty key or id, and . and .., which a URL would read as steps up its path', async () => {
    for (const argv of [['licenses', 'get', '.'], ['licenses', 'revoke', '..'], ['licenses', 'free-device', 'K', '..'], ['licenses', 'get', ' '], ['pubkey', '']]) {
      const h = harness()
      const res = await h.run(...argv)
      expect(res.code).toBe(EXIT.usage)
      expect(res.err).toMatch(/^keygrant: (?:a key or an id cannot be empty|"\.\.?" is not a key or an id)\n/)
      expect(h.calls).toEqual([])
    }
  })

  it('takes an answer that is not the shape a command reads for something other than KeyGrant, exit 5', async () => {
    for (const [argv, body] of [
      [['licenses', 'get', 'K'], { license: null }],
      [['licenses', 'list'], { licenses: [{}], nextCursor: null }],
      [['products'], { products: 'none' }],
      [['licenses', 'revoke', 'K'], { ok: 'yes' }],
      [['pubkey', 'sluice'], { keys: [] }],
      [['licenses', 'checkout', 'cs_test_1'], { license: { key: 'K' }, licenses: [] }],
      [['licenses', 'issue', '--product', 'p', '--type', 'perpetual'], { key: 'K', keys: [] }],
      [['licenses', 'test', '--product', 'p'], { key: 'K' }],
      [['release', '2', '--product', 'p'], { product: 'p', currentMajor: '2' }],
      [['licenses', 'free-device', 'K', 'act_1'], { released: 2 }],
    ] as const) {
      const res = await harness({ answers: [{ status: 200, body }] }).run(...argv)
      // An issue's adds the idempotency key it made, as for any answer it cannot read.
      expect([argv.join(' '), res.code, res.err.split(';')[0]]).toEqual([argv.join(' '), EXIT.unavailable, "keygrant: https://api.keygrant.dev answered HTTP 200 with something that is not KeyGrant's JSON"])
    }
  })
})
