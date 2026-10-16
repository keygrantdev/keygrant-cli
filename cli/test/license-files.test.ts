import { readFileSync } from 'node:fs'
import { OPEN_MAJOR, generateKeyPair, importSigningKey, importVerifyingKeys, keyId, licenseFileText, signLease, signLicenseFile, verifyLicenseFile } from '@keygrant/shared'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { harness, LIVE_KEY, NOW } from './harness.js'

/**
 * `keygrant licenses file`, and `keygrant verify` of a license file or a key
 * file (integration.md sections 15 and 17): the file saved as the API hands it
 * over, and read back offline by the strict reader every SDK follows.
 */

interface FileVector {
  name: string
  keys: JsonWebKey[]
  token: string
  verify: { valid: boolean; reason?: string; claims?: Record<string, unknown> }
}
interface ContainerVector {
  name: string
  bytes: string
  expect: string | null
}

const vectors = JSON.parse(readFileSync(new URL('../../conformance/vectors.json', import.meta.url), 'utf8')) as {
  licenseFiles: FileVector[]
  licenseFileContainers: ContainerVector[]
}

const KEY = 'SLUICE-AAAA-BBBB-CCCC-DDDD'
/** An instant as the commands print it. */
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const FILE_PATH = `/v1/licenses/${KEY}/file`

/** A license file as `POST /v1/licenses/:key/file` answers it. */
function answer(overrides: Record<string, unknown> = {}) {
  return {
    file: {
      id: 'lf_abc',
      kind: 'offline',
      kid: 'kid-one',
      issuedAt: NOW - 86_400_000,
      signedAt: NOW,
      filename: 'sluice-license.kglicense',
      mediaType: 'application/vnd.keygrant.license',
      content: '# KeyGrant license file\nTOKEN\n',
      ...overrides,
    },
  }
}

describe('keygrant licenses file', () => {
  it('saves the file under the name the API gives it, in the current folder, and says what it is', async () => {
    const h = harness({ answers: [{ status: 200, body: answer() }] })
    const res = await h.run('licenses', 'file', KEY)
    expect(h.calls[0]).toMatchObject({ method: 'POST', url: `https://api.keygrant.dev${FILE_PATH}`, body: undefined })
    expect(h.calls[0]?.headers.authorization).toBe(`Bearer ${LIVE_KEY}`)
    expect(h.written.get('sluice-license.kglicense')).toEqual({ text: '# KeyGrant license file\nTOKEN\n', overwrite: false })
    expect(res).toEqual({
      code: EXIT.ok,
      err: '',
      out: ['Saved      sluice-license.kglicense', 'Kind       license file (works offline, for good)', 'File id    lf_abc', 'Signed by  kid-one', `Signed     ${utc(NOW)}`].join('\n'),
    })
  })

  it('says a key file is a key file, saves it where --out says, and takes the license form of the command (licences)', async () => {
    const h = harness({ answers: [{ status: 200, body: answer({ kind: 'key', filename: 'sluice-license-2.kglicense' }) }] })
    const res = await h.run('licences', 'file', KEY, '--out', 'out/key.kglicense')
    expect([...h.written.keys()]).toEqual(['out/key.kglicense'])
    expect(res.out).toContain('Saved      out/key.kglicense')
    expect(res.out).toContain('Kind       key file (activates the key online)')
  })

  it('asks for a new signature with --resign, and sends nothing else', async () => {
    const h = harness({ answers: [{ status: 200, body: answer() }, { status: 200, body: answer() }] })
    await h.run('licenses', 'file', KEY, '--resign')
    expect(h.calls[0]?.body).toEqual({ resign: true })
    await h.run('licenses', 'file', KEY, '--out', 'again.kglicense')
    expect(h.calls[1]?.body).toBeUndefined()
  })

  it('prints the API\'s answer under --json, the content left out and the path saved to added', async () => {
    const h = harness({ answers: [{ status: 200, body: answer() }] })
    const res = await h.run('licenses', 'file', KEY, '--json')
    const { content: _content, ...file } = answer().file
    expect(JSON.parse(res.out)).toEqual({ file: { ...file, path: 'sluice-license.kglicense' } })
    expect(res.out).not.toContain('TOKEN')
    expect(h.written.get('sluice-license.kglicense')?.text).toContain('TOKEN')
  })

  it('refuses to replace a file that is there, saying how to, and replaces it with --force', async () => {
    const h = harness({ answers: [{ status: 200, body: answer() }, { status: 200, body: answer() }, { status: 200, body: answer() }], taken: ['sluice-license.kglicense'] })
    const refused = await h.run('licenses', 'file', KEY)
    expect(refused).toEqual({
      code: EXIT.usage,
      out: '',
      err: "keygrant: sluice-license.kglicense already exists: use --force to replace it, or --out to save the file elsewhere (the download is already in the license's history)\nRun `keygrant licenses file --help`.",
    })
    expect(h.written.size).toBe(0)
    const json = await h.run('licenses', 'file', KEY, '--json')
    expect(json.code).toBe(EXIT.usage)
    expect(JSON.parse(json.err)).toMatchObject({ error: 'file-exists', path: 'sluice-license.kglicense' })
    const forced = await h.run('licenses', 'file', KEY, '--force')
    expect(forced.code).toBe(EXIT.ok)
    expect(h.written.get('sluice-license.kglicense')?.overwrite).toBe(true)
  })

  it('names the download as already recorded when the save is refused, and after --resign that the file was signed again', async () => {
    const h = harness({ answers: [{ status: 200, body: answer() }, { status: 200, body: answer({ filename: 'package.json' }) }, { status: 200, body: answer({ filename: 'package.json' }) }], taken: ['sluice-license.kglicense'] })
    const taken = await h.run('licenses', 'file', KEY, '--resign')
    expect(taken.err).toContain("(the download is already in the license's history, and the file was signed again and kept: run the command again without --resign to save it)")
    const json = await h.run('licenses', 'file', KEY, '--resign', '--json')
    expect(json.code).toBe(EXIT.unavailable)
    expect(JSON.parse(json.err)).toMatchObject({ error: 'unsafe-file-name', filename: 'package.json', resigned: true, downloaded: true })
    // The unsafe name comes again on a run without --out: the remedy says so.
    expect((await h.run('licenses', 'file', KEY, '--resign')).err).toContain('run the command again without --resign and with --out <path> to save it')
  })

  it('says a path it cannot write is one, exit 2', async () => {
    const h = harness({ answers: [{ status: 200, body: answer() }], writeError: new Error('EACCES: permission denied') })
    const res = await h.run('licenses', 'file', KEY, '--out', '/root/x.kglicense')
    expect(res).toMatchObject({ code: EXIT.usage, out: '' })
    expect(res.err).toContain('keygrant: cannot write /root/x.kglicense: EACCES: permission denied')
    const again = harness({ answers: [{ status: 200, body: answer() }], writeError: new Error('EACCES: permission denied') })
    const asJson = await again.run('licenses', 'file', KEY, '--out', '/root/x.kglicense', '--json')
    expect(JSON.parse(asJson.err)).toMatchObject({ error: 'cannot-write', path: '/root/x.kglicense', message: 'EACCES: permission denied', downloaded: true })
  })

  it('names each reason the API has no file to give, exit 1, and writes nothing', async () => {
    const reasons: [number, string, string][] = [
      [409, 'license-revoked', 'the key is revoked (it cannot be extended or spent from, and no file is made for it)'],
      [409, 'not-a-file-license', 'the key is delivered as a typed key, not as a file (the delivery of its license model says which)'],
      [409, 'no-licensee', 'the key has no email address to license a file to'],
      [409, 'license-expires', 'an offline license file never expires, so none is made for a key that ends (a file that carries the key can be made for a key that ends)'],
      [404, 'unknown-license', 'no license of yours has that key (a kg_test_ key reaches test licenses only)'],
    ]
    const h = harness({ answers: reasons.map(([status, error]) => ({ status, body: { error } })) })
    for (const [, code, sentence] of reasons) {
      const res = await h.run('licenses', 'file', KEY)
      expect(res, code).toEqual({ code: EXIT.refused, out: '', err: `keygrant: ${code}: ${sentence}` })
    }
    expect(h.written.size).toBe(0)
  })

  it('asks KeyGrant nothing, and saves nothing, without an API key', async () => {
    const none = harness({ env: {} })
    expect((await none.run('licenses', 'file', KEY)).code).toBe(EXIT.auth)
    expect(none.calls).toEqual([])
    expect(none.written.size).toBe(0)
  })

  it('writes nothing for a name that is not a plain file name, exit 5, until --out says where', async () => {
    const names = ['../escape.kglicense', '..\\escape.kglicense', 'a/b.kglicense', 'C:evil.kglicense', '.hidden.kglicense', '-rf.kglicense', '', 'x\u0000y.kglicense', 'with space.kglicense', 'na\u00efve.kglicense', 'package.json', 'Makefile', 'sluice-license.kglicense.', 'CON.kglicense', 'nul.kglicense', 'com1.kglicense', 'lpt9.kglicense', 'aux.kglicense', 'prn.kglicense', 'x'.repeat(120) + '.kglicense']
    const h = harness({ answers: names.map((filename) => ({ status: 200, body: answer({ filename }) })) })
    for (const name of names) {
      const res = await h.run('licenses', 'file', KEY)
      expect([name, res.code, res.out], name).toEqual([name, EXIT.unavailable, ''])
      expect(res.err).toContain('is not the name of a license file')
    }
    expect(h.written.size).toBe(0)
    const rescued = harness({ answers: [{ status: 200, body: answer({ filename: '../escape.kglicense' }) }] })
    expect((await rescued.run('licenses', 'file', KEY, '--out', 'mine.kglicense')).code).toBe(EXIT.ok)
    expect([...rescued.written.keys()]).toEqual(['mine.kglicense'])
  })

  it('saves under any name of the shape the route gives, a device name inside a longer word and the longest one included', async () => {
    const names = ['sluice-license.kglicense', 'sluice-license-12.kglicense', 'console-license.kglicense', 'auxiliary-license.kglicense', 'a'.repeat(119) + '.kglicense']
    const h = harness({ answers: names.map((filename) => ({ status: 200, body: answer({ filename }) })) })
    for (const name of names) expect((await h.run('licenses', 'file', KEY)).code, name).toBe(EXIT.ok)
    expect([...h.written.keys()]).toEqual(names)
  })

  it('does not take as KeyGrant\'s an answer with no file in it, or one cut short', async () => {
    const without = (name: string) => ({ file: Object.fromEntries(Object.entries(answer().file).filter(([k]) => k !== name)) })
    const bodies = [
      {},
      { file: {} },
      { file: { ...answer().file, content: 7 } },
      { file: { ...answer().file, signedAt: 'now' } },
      { file: { ...answer().file, kind: 'constructor' } },
      { file: { ...answer().file, kind: 'other' } },
      ...['id', 'kind', 'kid', 'issuedAt', 'signedAt', 'filename', 'mediaType', 'content'].map(without),
    ]
    for (const body of bodies) {
      const h = harness({ answers: [{ status: 200, body }] })
      const res = await h.run('licenses', 'file', KEY)
      expect(res.code, JSON.stringify(body)).toBe(EXIT.unavailable)
      expect(h.written.size).toBe(0)
    }
  })

  it('needs the key, takes one only, and an --out that is a path', async () => {
    const h = harness()
    expect((await h.run('licenses', 'file')).err).toContain('missing the license key')
    expect((await h.run('licenses', 'file', KEY, 'extra')).code).toBe(EXIT.usage)
    expect((await h.run('licenses', 'file', KEY, '--out', ' ')).err).toContain('--out needs a path')
    expect((await h.run('licenses', 'file', '..')).code).toBe(EXIT.usage)
    expect(h.calls).toEqual([])
  })

  it('is in the help', async () => {
    const main = await harness().run('--help')
    expect(main.out).toContain('licenses file')
    const own = await harness().run('licenses', 'file', '--help')
    expect(own.out).toContain('keygrant licenses file <key> [--out <path>] [--force] [--resign]')
  })
})

/** A key pair, its key set as `keygrant pubkey` prints it, and the id of its key. */
async function signer() {
  const { publicJwk, privateJwk } = await generateKeyPair()
  return { key: await importSigningKey(privateJwk), kid: await keyId(publicJwk), set: JSON.stringify({ keys: [publicJwk] }), publicJwk }
}

const OFFLINE = { kind: 'offline', fid: 'lf_1', sub: KEY, product: 'sluice', name: 'Ada Lovelace', email: 'ada@example.com', major: 4, minMajor: 2, ent: { edition: 'pro' } } as const
const KEYFILE = { kind: 'key', fid: 'lf_2', sub: KEY, product: 'sluice', email: 'ada@example.com' } as const

describe('keygrant verify of a license file', () => {
  it('answers each conformance vector as the reference reader does, offline', async () => {
    expect(vectors.licenseFiles.length).toBeGreaterThan(50)
    for (const v of vectors.licenseFiles) {
      const h = harness({ env: {}, files: { 'f.kglicense': v.token, 'k.json': JSON.stringify({ keys: v.keys }) } })
      const res = await h.run('verify', 'f.kglicense', '--key', 'k.json', '--json')
      const { kid: _kid, ...printed } = JSON.parse(res.out) as Record<string, unknown>
      expect([v.name, res.code, printed]).toEqual([v.name, v.verify.valid ? EXIT.ok : EXIT.refused, v.verify])
      expect(h.calls).toEqual([])
    }
  })

  it('reads each conformance container as every SDK does: the one token, or no file', async () => {
    expect(vectors.licenseFileContainers.length).toBeGreaterThan(15)
    const reference = vectors.licenseFiles[0] as FileVector
    const keys = await importVerifyingKeys(reference.keys)
    for (const c of vectors.licenseFileContainers) {
      const bytes = new Uint8Array(Buffer.from(c.bytes, 'base64url'))
      const h = harness({ env: {}, fileBytes: { 'f.kglicense': bytes }, files: { 'k.json': JSON.stringify({ keys: reference.keys }) } })
      const res = await h.run('verify', 'f.kglicense', '--key', 'k.json', '--json')
      const { kid: _kid, ...printed } = JSON.parse(res.out) as Record<string, unknown>
      const expected = c.expect === null ? { valid: false, reason: 'malformed' } : await verifyLicenseFile(c.expect, keys)
      expect([c.name, printed]).toEqual([c.name, JSON.parse(JSON.stringify(expected))])
    }
  })

  it('prints what an offline file grants, for a person, and the key that signed it', async () => {
    const s = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const h = harness({ env: {}, files: { 'sluice.kglicense': licenseFileText(token), 'k.json': s.set } })
    const res = await h.run('verify', 'sluice.kglicense', '--key', 'k.json')
    expect(res).toEqual({
      code: EXIT.ok,
      err: '',
      out: [
        'Valid license file.',
        '',
        'Kind          license file (offline, for good)',
        'Product       sluice',
        'Licensed to   Ada Lovelace <ada@example.com>',
        'License key   SLUICE-AAAA-BBBB-CCCC-DDDD',
        'Versions      2 to 4',
        'Entitlements  edition=pro',
        'File id       lf_1',
        `Signed by     ${s.kid}`,
        `Signed        ${utc(NOW)}`,
      ].join('\n'),
    })
    expect(h.calls).toEqual([])
  })

  it('prints a key file by its key, with no versions or entitlements, a test one marked', async () => {
    const s = await signer()
    const token = await signLicenseFile({ ...KEYFILE, test: true }, s.key, s.kid, NOW)
    const res = await harness({ env: {}, files: { 'k.kglicense': licenseFileText(token), 'k.json': s.set } }).run('verify', 'k.kglicense', '--key', 'k.json')
    expect(res.out.split('\n')[0]).toBe('Valid key file.')
    expect(res.out).toMatch(/^Kind +key file \(activates the key online\)$/m)
    expect(res.out).toMatch(/^Licensed to +<ada@example.com>$/m)
    expect(res.out).toMatch(/^License key +SLUICE-AAAA-BBBB-CCCC-DDDD$/m)
    expect(res.out).toMatch(/^Test +yes: a test license$/m)
    expect(res.out).not.toMatch(/Versions|Entitlements/)
  })

  it('says who a file is licensed to by the name alone, and no entitlements for an offline file that grants none', async () => {
    const s = await signer()
    const named = await signLicenseFile({ ...KEYFILE, email: undefined, name: 'Ada Lovelace' }, s.key, s.kid, NOW)
    const key = await harness({ env: {}, files: { 'k.kglicense': licenseFileText(named), 'k.json': s.set } }).run('verify', 'k.kglicense', '--key', 'k.json')
    expect(key.out).toMatch(/^Licensed to +Ada Lovelace$/m)
    const bare = await signLicenseFile({ ...OFFLINE, ent: {} } as typeof OFFLINE, s.key, s.kid, NOW)
    const offline = await harness({ env: {}, files: { 'o.kglicense': licenseFileText(bare), 'k.json': s.set } }).run('verify', 'o.kglicense', '--key', 'k.json')
    expect(offline.out).toMatch(/^Entitlements +none$/m)
  })

  it('says every version for an open file, and N and later for one that starts above 1', async () => {
    const s = await signer()
    const read = async (over: Record<string, unknown>) => {
      const token = await signLicenseFile({ ...OFFLINE, ...over } as typeof OFFLINE, s.key, s.kid, NOW)
      return (await harness({ env: {}, files: { 'f.kglicense': licenseFileText(token), 'k.json': s.set } }).run('verify', 'f.kglicense', '--key', 'k.json')).out
    }
    expect(await read({ major: OPEN_MAJOR, minMajor: undefined })).toMatch(/^Versions +every version$/m)
    expect(await read({ major: OPEN_MAJOR, minMajor: 3 })).toMatch(/^Versions +3 and later$/m)
    // No lowest major means 1: the file covers 1 to 5, as its own notes say.
    expect(await read({ major: 5, minMajor: undefined })).toMatch(/^Versions +1 to 5$/m)
    expect(await read({ major: 1, minMajor: undefined })).toMatch(/^Versions +1$/m)
    expect(await read({ major: 5, minMajor: 2 })).toMatch(/^Versions +2 to 5$/m)
    expect(await read({ major: 5, minMajor: 5 })).toMatch(/^Versions +5$/m)
  })

  it('takes the text on standard input, and a token alone, by what its header says, whatever the name', async () => {
    const s = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const files = { 'k.json': s.set, 'licence.txt': licenseFileText(token), 'token.txt': token }
    for (const [argv, setup] of [
      [['-'], { stdin: licenseFileText(token) }],
      [['-'], { stdin: token }],
      [['licence.txt'], {}],
      [['token.txt'], {}],
      [[token], {}],
    ] as const) {
      const res = await harness({ env: {}, files, ...setup }).run('verify', ...argv, '--key', 'k.json')
      expect([argv, res.code, res.out.split('\n')[0]]).toEqual([argv, EXIT.ok, 'Valid license file.'])
    }
  })

  it('still reads a lease as a lease, and judges its expiry', async () => {
    const s = await signer()
    const lease = await signLease({ sub: KEY, product: 'sluice', aid: 'act_1', model: 'perpetual', lim: 3, major: 2, ent: {}, ttlSeconds: 60 }, s.key, NOW)
    const res = await harness({ env: {}, files: { 'k.json': s.set }, stdin: lease }).run('verify', '-', '--key', 'k.json', '--at', String(NOW))
    expect(res.out.split('\n')[0]).toBe('Valid lease.')
    const late = await harness({ env: {}, files: { 'k.json': s.set }, stdin: lease }).run('verify', '-', '--key', 'k.json', '--at', String(NOW + 3_600_000))
    expect(late.out.split('\n')[0]).toBe('Not valid: expired: it has expired.')
  })

  it('reads a file named .kglicense, in any case, as a license file: a lease given as one is refused as not a file', async () => {
    const s = await signer()
    const lease = await signLease({ sub: KEY, product: 'sluice', aid: 'act_1', model: 'perpetual', lim: 3, major: 2, ent: {}, ttlSeconds: 60 }, s.key, NOW)
    for (const name of ['x.kglicense', 'X.KGLICENSE']) {
      const named = await harness({ env: {}, files: { 'k.json': s.set, [name]: lease } }).run('verify', name, '--key', 'k.json')
      expect([name, named.code, named.out]).toEqual([name, EXIT.refused, "Not valid: not-a-license-file: it holds a token, but not a license file's (a lease, say)."])
    }
    const file = licenseFileText(await signLicenseFile(OFFLINE, s.key, s.kid, NOW))
    const upper = await harness({ env: {}, files: { 'k.json': s.set, 'F.KGLICENSE': file } }).run('verify', 'F.KGLICENSE', '--key', 'k.json')
    expect(upper.out.split('\n')[0]).toBe('Valid license file.')
  })

  it('words the claims a file fails on, from a vector the reference reader refuses for them', async () => {
    const v = vectors.licenseFiles.find((f) => f.verify.reason === 'bad-claims')
    if (!v) throw new Error('no bad-claims vector')
    const res = await harness({ env: {}, files: { 'f.kglicense': v.token, 'k.json': JSON.stringify({ keys: v.keys }) } }).run('verify', 'f.kglicense', '--key', 'k.json')
    expect([res.code, res.out]).toEqual([EXIT.refused, "Not valid: bad-claims: its claims are not a KeyGrant license file's."])
  })

  it('never judges a file by time: --at is not read for one, and nothing makes it expire', async () => {
    const s = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const h = harness({ env: {}, files: { 'f.kglicense': licenseFileText(token), 'k.json': s.set } })
    expect((await h.run('verify', 'f.kglicense', '--key', 'k.json', '--at', '2099-01-01')).code).toBe(EXIT.ok)
    expect((await h.run('verify', 'f.kglicense', '--key', 'k.json', '--at', '1990-01-01')).code).toBe(EXIT.ok)
  })

  it('names the signing key of a file the set does not hold, and exits 1', async () => {
    const s = await signer()
    const other = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const res = await harness({ env: {}, files: { 'f.kglicense': licenseFileText(token), 'k.json': other.set } }).run('verify', 'f.kglicense', '--key', 'k.json')
    expect(res.code).toBe(EXIT.refused)
    expect(res.out).toBe(
      `Not valid: unknown-key: it names a signing key the key set does not hold: update the key set (\`keygrant pubkey\`); a key that signed a file stays in the set for good. It names the signing key ${s.kid}.`,
    )
    const json = await harness({ env: {}, files: { 'f.kglicense': licenseFileText(token), 'k.json': other.set } }).run('verify', 'f.kglicense', '--key', 'k.json', '--json')
    expect(JSON.parse(json.out)).toEqual({ valid: false, reason: 'unknown-key', kid: s.kid })
  })

  it('says a file whose payload or signature was changed is not signed by its key', async () => {
    const s = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const forged = await signLicenseFile({ ...OFFLINE, major: 9 }, s.key, s.kid, NOW)
    const [header, , signature] = token.split('.') as [string, string, string]
    const swapped = `${header}.${forged.split('.')[1]}.${signature}`
    const res = await harness({ env: {}, files: { 'f.kglicense': licenseFileText(swapped), 'k.json': s.set } }).run('verify', 'f.kglicense', '--key', 'k.json')
    expect(res.code).toBe(EXIT.refused)
    expect(res.out).toBe(`Not valid: bad-signature: its signature is not by the key it names. It names the signing key ${s.kid}.`)
  })

  it('says why a file is not one: no token, two tokens, not UTF-8', async () => {
    const s = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const run = (setup: Parameters<typeof harness>[0]) => harness({ env: {}, ...setup, files: { 'k.json': s.set, ...setup?.files } }).run('verify', 'f.kglicense', '--key', 'k.json')
    const sentence = 'Not valid: malformed: it is not a license file (a text file holding one token, and notes on lines starting with #).'
    expect(await run({ files: { 'f.kglicense': '# only notes\n' } })).toMatchObject({ code: EXIT.refused, out: sentence })
    expect(await run({ files: { 'f.kglicense': `${token}\n${token}\n` } })).toMatchObject({ code: EXIT.refused, out: sentence })
    const withBadByte = new Uint8Array([...new TextEncoder().encode('# note '), 0xff, 0x0a, ...new TextEncoder().encode(`${token}\n`)])
    expect(await run({ fileBytes: { 'f.kglicense': withBadByte } })).toMatchObject({ code: EXIT.refused, out: sentence })
    // Piped in with no name to say what it is, the same damaged file is still a license file (a line of it is one's token), not a lease.
    const piped = await harness({ env: {}, files: { 'k.json': s.set }, stdinBytes: withBadByte }).run('verify', '-', '--key', 'k.json')
    expect([piped.code, piped.out]).toEqual([EXIT.refused, sentence])
    const twice = await harness({ env: {}, files: { 'k.json': s.set }, stdin: `${token}\n${token}\n` }).run('verify', '-', '--key', 'k.json')
    expect([twice.code, twice.out]).toEqual([EXIT.refused, sentence])
    // A license file that is not there is one to find, not a text to check.
    const missing = await harness({ env: {}, files: { 'k.json': s.set } }).run('verify', 'gone.kglicense', '--key', 'k.json')
    expect(missing.code).toBe(EXIT.usage)
    expect(missing.err).toContain("keygrant: cannot read the license file from gone.kglicense: ENOENT: no such file, open 'gone.kglicense'")
  })

  it('refuses a file of another product with --product, its claims shown', async () => {
    const s = await signer()
    const token = await signLicenseFile(OFFLINE, s.key, s.kid, NOW)
    const files = { 'f.kglicense': licenseFileText(token), 'k.json': s.set }
    expect((await harness({ env: {}, files }).run('verify', 'f.kglicense', '--key', 'k.json', '--product', 'sluice')).code).toBe(EXIT.ok)
    const other = await harness({ env: {}, files }).run('verify', 'f.kglicense', '--key', 'k.json', '--product', 'atlas')
    expect(other.code).toBe(EXIT.refused)
    expect(other.out.split('\n')[0]).toBe('Not valid: wrong-product: it is for another product.')
    expect(other.out).toContain('Product       sluice')
    const json = await harness({ env: {}, files }).run('verify', 'f.kglicense', '--key', 'k.json', '--product', 'atlas', '--json')
    expect(JSON.parse(json.out)).toMatchObject({ valid: false, reason: 'wrong-product', claims: { product: 'sluice', kind: 'offline' }, kid: s.kid })
  })

  it('needs the key set, as it does for a lease', async () => {
    const s = await signer()
    const res = await harness({ env: {}, files: { 'f.kglicense': licenseFileText(await signLicenseFile(OFFLINE, s.key, s.kid, NOW)) } }).run('verify', 'f.kglicense')
    expect(res.code).toBe(EXIT.usage)
    expect(res.err).toContain('--key <file> is required')
  })
})
