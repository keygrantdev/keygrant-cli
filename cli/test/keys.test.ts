import { readFileSync } from 'node:fs'
import { generateKeyPair, importSigningKey, signLease } from '@keygrant/shared'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { harness } from './harness.js'

interface VerifyVector {
  name: string
  token: string
  now: number
  verify: { valid: boolean; reason?: string; claims?: Record<string, unknown> }
}

const vectors = JSON.parse(readFileSync(new URL('../../conformance/vectors.json', import.meta.url), 'utf8')) as {
  publicJwk: JsonWebKey
  leases: VerifyVector[]
  keySets: (VerifyVector & { keys: JsonWebKey[] })[]
}

const SET = { publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'A' }, keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'A', kid: 'k1' }, { kty: 'OKP', crv: 'Ed25519', x: 'B', kid: 'k2' }] }
/** The first lease vector `pick` chooses; the suite stops at once when the vectors have none. */
function leaseVector(pick: (v: VerifyVector) => boolean): VerifyVector {
  const found = vectors.leases.find(pick)
  if (!found) throw new Error('no lease vector of that kind')
  return found
}

const VALID = leaseVector((v) => v.verify.valid)

describe('keygrant pubkey', () => {
  it('prints the key set an app embeds, from the public route, with no API key', async () => {
    const h = harness({ env: {}, answers: [{ status: 200, body: SET }] })
    const res = await h.run('pubkey', 'sluice')
    expect(h.calls[0]).toMatchObject({ method: 'GET', url: 'https://api.keygrant.dev/v1/products/sluice/pubkey' })
    expect(h.calls[0]?.headers.authorization).toBeUndefined()
    expect(JSON.parse(res.out)).toEqual({ keys: SET.keys })
  })

  it('prints the key that signs alone with --signing-only, and the whole answer with --json', async () => {
    const h = harness({ env: {}, answers: [{ status: 200, body: SET }, { status: 200, body: SET }] })
    expect(JSON.parse((await h.run('pubkey', 'sluice', '--signing-only')).out)).toEqual(SET.publicJwk)
    expect(JSON.parse((await h.run('pubkey', 'sluice', '--json')).out)).toEqual(SET)
  })

  it('names a product no one has', async () => {
    const res = await harness({ env: {}, answers: [{ status: 404, body: { error: 'unknown-product' } }] }).run('pubkey', 'nope')
    expect(res).toEqual({ code: EXIT.refused, out: '', err: 'keygrant: unknown-product: no product of yours has that API ID' })
  })
})

describe('keygrant verify, as every SDK verifies', () => {
  const run = async (token: string, keys: unknown, now: number) => {
    const h = harness({ env: {}, files: { 'keys.json': JSON.stringify(keys) } })
    return h.run('verify', token, '--key', 'keys.json', '--at', String(now), '--json')
  }

  it('answers each lease vector as the reference verifier does, offline', async () => {
    for (const v of vectors.leases) {
      const res = await run(v.token, vectors.publicJwk, v.now)
      expect([v.name, res.code, JSON.parse(res.out)]).toEqual([v.name, v.verify.valid ? EXIT.ok : EXIT.refused, v.verify])
    }
  })

  it('answers each key set vector by the key the lease names', async () => {
    for (const v of vectors.keySets) {
      const res = await run(v.token, { keys: v.keys }, v.now)
      expect([v.name, res.code, JSON.parse(res.out)]).toEqual([v.name, v.verify.valid ? EXIT.ok : EXIT.refused, v.verify])
    }
  })

  it('takes the pubkey route\'s whole answer as the key set, and makes no request', async () => {
    const h = harness({ env: {}, files: { 'pubkey.json': JSON.stringify({ publicJwk: vectors.publicJwk, keys: [vectors.publicJwk] }) } })
    expect((await h.run('verify', VALID.token, '--key', 'pubkey.json', '--at', String(VALID.now))).code).toBe(EXIT.ok)
    expect(h.calls).toEqual([])
  })

  it('reads the lease from standard input, or from a file holding the token or the SDK\'s JSON', async () => {
    const files = { 'k.json': JSON.stringify(vectors.publicJwk), 'lease.txt': `${VALID.token}\n`, 'state.json': JSON.stringify({ key: 'X', lease: VALID.token }) }
    const at = String(VALID.now)
    expect((await harness({ env: {}, files, stdin: `${VALID.token}\n` }).run('verify', '-', '--key', 'k.json', '--at', at)).code).toBe(EXIT.ok)
    expect((await harness({ env: {}, files }).run('verify', 'lease.txt', '--key', 'k.json', '--at', at)).code).toBe(EXIT.ok)
    expect((await harness({ env: {}, files }).run('verify', 'state.json', '--key', 'k.json', '--at', at)).code).toBe(EXIT.ok)
    // A file name of two dots is a file, never a token.
    const dotted = { ...files, 'sluice.lease.json': JSON.stringify({ lease: VALID.token }) }
    expect((await harness({ env: {}, files: dotted }).run('verify', 'sluice.lease.json', '--key', 'k.json', '--at', at)).code).toBe(EXIT.ok)
  })

  it('prints what a valid lease grants, for a person', async () => {
    const res = await harness({ env: {}, files: { 'k.json': JSON.stringify(vectors.publicJwk) } }).run('verify', VALID.token, '--key', 'k.json', '--at', String(VALID.now))
    expect(res.out).toBe(
      [
        'Valid lease.',
        '',
        'License       SLUICE-AAAA-BBBB-CCCC-DDDD',
        'Product       sluice',
        'Activation    act_1',
        'Model         perpetual',
        'Devices       3',
        'Majors        1 to 3',
        'Entitlements  none',
        'Device        not bound',
        'Issued        2026-09-20 14:13 UTC',
        'Expires       2026-10-20 14:13 UTC',
      ].join('\n'),
    )
  })

  it('prints each claim a lease carries: an open window, a bound device, grace, a test license, a lowest major, entitlements', async () => {
    const shown = async (pick: (c: Record<string, unknown>) => boolean) => {
      const v = leaseVector((l) => l.verify.valid && pick(l.verify.claims ?? {}))
      return (await harness({ env: {}, files: { 'k.json': JSON.stringify(vectors.publicJwk) } }).run('verify', v.token, '--key', 'k.json', '--at', String(v.now))).out
    }
    const open = await shown((c) => c.major === 1_000_000 && c.upgradeUntil !== undefined)
    expect(open).toMatch(/^Majors +1 and later$/m)
    expect(open).toMatch(/^Upgrades until +2026-12-20 14:13 UTC$/m)
    expect(await shown((c) => c.fpk === 'hostname')).toContain('Device        bound (hostname)')
    expect(await shown((c) => c.grace === true)).toContain('Grace         yes: past its expiry, in its grace')
    expect(await shown((c) => c.test === true)).toContain('Test          yes: a test license')
    expect(await shown((c) => c.minMajor === 2)).toContain('Majors        2 to 3')
    expect(await shown((c) => Object.keys(c.ent as object).length === 3)).toContain('Entitlements  pro=true, seats=5, tier=gold')
  })

  it('prints a single major as itself, and a device bound by a claim of no kind as such', async () => {
    const { publicJwk, privateJwk } = await generateKeyPair()
    const now = 1_790_000_000_000
    const token = await signLease(
      { sub: 'SLUICE-AAAA-BBBB-CCCC-DDDD', product: 'sluice', aid: 'act_1', model: 'perpetual', lim: 3, major: 2, minMajor: 2, ent: {}, ttlSeconds: 86_400 },
      await importSigningKey(privateJwk),
      now,
    )
    const own = await harness({ env: {}, files: { 'k.json': JSON.stringify(publicJwk) } }).run('verify', token, '--key', 'k.json', '--at', String(now))
    expect(own.out).toMatch(/^Majors +2$/m)
    const v = leaseVector((l) => l.verify.valid && typeof l.verify.claims?.fp === 'string' && l.verify.claims.fpk === undefined)
    const unkinded = await harness({ env: {}, files: { 'k.json': JSON.stringify(vectors.publicJwk) } }).run('verify', v.token, '--key', 'k.json', '--at', String(v.now))
    expect(unkinded.out).toMatch(/^Device +bound \(kind not said\)$/m)
  })

  it('says why a lease is not valid, its claims too when it has them, and exits 1', async () => {
    const expired = leaseVector((v) => v.verify.reason === 'expired')
    const res = await harness({ env: {}, files: { 'k.json': JSON.stringify(vectors.publicJwk) } }).run('verify', expired.token, '--key', 'k.json', '--at', String(expired.now))
    expect(res.code).toBe(EXIT.refused)
    expect(res.out.split('\n')[0]).toBe('Not valid: expired: it has expired.')
    expect(res.out).toContain('License ')
    const garbage = await harness({ env: {}, files: { 'k.json': JSON.stringify(vectors.publicJwk) } }).run('verify', 'a.b.c', '--key', 'k.json')
    expect(garbage).toMatchObject({ code: EXIT.refused, out: 'Not valid: malformed: it is not a lease (a JWS of three base64url parts).' })
  })

  it('refuses a valid lease of another product with --product', async () => {
    const files = { 'k.json': JSON.stringify(vectors.publicJwk) }
    const at = String(VALID.now)
    expect((await harness({ env: {}, files }).run('verify', VALID.token, '--key', 'k.json', '--at', at, '--product', 'sluice')).code).toBe(EXIT.ok)
    const other = await harness({ env: {}, files }).run('verify', VALID.token, '--key', 'k.json', '--at', at, '--product', 'atlas', '--json')
    expect(other.code).toBe(EXIT.refused)
    expect(JSON.parse(other.out)).toMatchObject({ valid: false, reason: 'wrong-product', claims: { product: 'sluice' } })
  })

  it('needs a key set it can read, and says what is wrong with one it cannot', async () => {
    const files = { 'bad.json': 'not json', 'empty.json': '{}', 'rsa.json': JSON.stringify({ keys: [{ kty: 'RSA', n: 'x', e: 'AQAB' }] }) }
    const usageOf = async (...args: string[]) => {
      const res = await harness({ env: {}, files }).run('verify', VALID.token, ...args)
      expect(res.code).toBe(EXIT.usage)
      return res.err.split('\n')[0]
    }
    expect(await usageOf()).toBe('keygrant: --key <file> is required: save the key set with `keygrant pubkey <product> > keys.json`')
    expect(await usageOf('--key', 'missing.json')).toBe("keygrant: cannot read the key set from missing.json: ENOENT: no such file, open 'missing.json'")
    expect(await usageOf('--key', 'bad.json')).toBe('keygrant: bad.json is not JSON: give the key set `keygrant pubkey` prints, or a JWK')
    expect(await usageOf('--key', 'empty.json')).toBe('keygrant: empty.json holds no key set ({ "keys": [...] }) and no JWK')
    expect(await usageOf('--key', 'rsa.json')).toContain('keygrant: rsa.json is not an Ed25519 public key set:')
  })
})
