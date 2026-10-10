import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { harness, license, NOW, request } from './harness.js'

const KEY = 'SLUICE-AAAA-BBBB-CCCC-DDDD'
const DAY = 86_400_000
const BASE = 'https://api.keygrant.dev'

describe('licenses issue', () => {
  it('sends the issue as the API takes it, with an idempotency key for the run, and prints the key', async () => {
    const h = harness({ answers: [{ status: 201, body: { key: KEY, emailed: false } }] })
    const res = await h.run(
      'licenses', 'issue', '--product', 'sluice', '--model', 'mod_annual', '--email', 'jo@example.com',
      '--device-limit', '5', '--seat-release-days', '30', '--expires', '2027-01-31', '--version', '2.4.1', '--min-major', '2', '--max-major', 'none',
      '--upgrade-months', '12', '--entitlement', 'edition=pro', '--entitlement', 'seats=5', '--entitlement', 'beta=true',
      '--send-email',
    )
    expect(res).toEqual({ code: EXIT.ok, out: KEY, err: '' })
    expect(h.calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: `${BASE}/v1/licenses`,
        headers: expect.objectContaining({ 'idempotency-key': 'cli-run-1', 'content-type': 'application/json' }),
        body: {
          product: 'sluice',
          modelId: 'mod_annual',
          email: 'jo@example.com',
          deviceLimit: 5,
          seatReleaseDays: 30,
          expiresAt: Date.UTC(2027, 0, 31, 23, 59, 59, 999),
          version: '2.4.1',
          minMajor: 2,
          maxMajor: null,
          upgradeMonths: 12,
          entitlements: { edition: 'pro', seats: 5, beta: true },
          sendEmail: true,
        },
      }),
    ])
  })

  it('says when it emailed the one key it issued', async () => {
    const res = await harness({ answers: [{ status: 201, body: { key: KEY, emailed: true } }] }).run('licenses', 'issue', '--product', 'sluice', '--type', 'perpetual', '--email', 'jo@example.com', '--send-email')
    expect(res).toEqual({ code: EXIT.ok, out: KEY, err: 'Emailed the key to the customer.' })
  })

  it('issues a bare type, none of the model\'s entitlements, several keys, and the idempotency key asked for', async () => {
    const h = harness({ answers: [{ status: 201, body: { key: 'K-1', keys: ['K-1', 'K-2'], emailed: true } }] })
    const res = await h.run('licenses', 'issue', '--product', 'sluice', '--type', 'perpetual', '--no-entitlements', '--seat-release-days', 'Off', '--count', '2', '--idempotency-key', 'order-9')
    expect(res).toEqual({ code: EXIT.ok, out: 'K-1\nK-2', err: 'Emailed the keys to the customer.' })
    expect(h.calls[0]?.body).toEqual({ product: 'sluice', model: 'perpetual', entitlements: {}, seatReleaseDays: null, count: 2 })
    expect(h.calls[0]?.headers['idempotency-key']).toBe('order-9')
  })

  it('prints the API answer under --json, a replay included', async () => {
    const answer = { key: KEY, emailed: false }
    const res = await harness({ answers: [{ status: 200, body: answer }] }).run('licenses', 'issue', '--product', 'sluice', '--type', 'trial', '--json')
    expect(res.code).toBe(EXIT.ok)
    expect(JSON.parse(res.out)).toEqual(answer)
  })

  it('refuses what the API would, before sending anything', async () => {
    const refusals: [string[], string][] = [
      [['--type', 'perpetual'], '--product is required'],
      [['--product', 'sluice'], '--model <id> or --type <type> is required (`keygrant products` lists the models)'],
      [['--product', 'sluice', '--type', 'lifetime'], '--type must be one of perpetual, subscription, trial, timed'],
      [['--product', 'sluice', '--type', 'perpetual', '--min-major', '2'], '--min-major and --max-major go together'],
      [['--product', 'sluice', '--type', 'perpetual', '--entitlement', 'pro'], '--entitlement takes code=value, not "pro"'],
      [['--product', 'sluice', '--type', 'perpetual', '--entitlement', 'a=1', '--no-entitlements'], '--entitlement and --no-entitlements cannot be given together'],
      [['--product', 'sluice', '--type', 'perpetual', '--count', '101'], '--count must be from 1 to 100'],
      [['--product', 'sluice', '--type', 'perpetual', '--seat-release-days', '0'], '--seat-release-days must be from 1 to 365'],
      [['--product', 'sluice', '--type', 'perpetual', '--seat-release-days', 'never'], '--seat-release-days must be a whole number of days or off, not "never"'],
      [['--product', 'sluice', '--type', 'perpetual', 'extra'], 'unexpected argument "extra"'],
      [['--product', 'sluice', '--type', 'perpetual', '--model', 'mod_annual'], 'give one of --model and --type, not both'],
      [['--product', 'sluice', '--type', 'perpetual', '--entitlement', 'edition=pro', '--entitlement', 'edition=basic'], '--entitlement edition is given twice'],
      [['--product', 'sluice', '--type', 'perpetual', '--idempotency-key='], '--idempotency-key must be 1 to 255 visible ASCII characters, with no space at either end'],
      [['--product', 'sluice', '--type', 'perpetual', '--idempotency-key', ' order-9'], '--idempotency-key must be 1 to 255 visible ASCII characters, with no space at either end'],
      [['--product', 'sluice', '--type', 'perpetual', '--idempotency-key', 'commande-n°9'], '--idempotency-key must be 1 to 255 visible ASCII characters, with no space at either end'],
      [['--product', 'sluice', '--type', 'perpetual', '--idempotency-key', 'x'.repeat(256)], '--idempotency-key must be 1 to 255 visible ASCII characters, with no space at either end'],
    ]
    for (const [args, said] of refusals) {
      const h = harness()
      expect(await h.run('licenses', 'issue', ...args)).toEqual({
        code: EXIT.usage,
        out: '',
        err: `keygrant: ${said}\nRun \`keygrant licenses issue --help\`.`,
      })
      expect(h.calls).toEqual([])
    }
  })

  it('reads an entitlement value as a flag, a number, or text', async () => {
    const h = harness({ answers: [{ status: 201, body: { key: KEY, emailed: false } }] })
    await h.run('licenses', 'issue', '--product', 'p', '--type', 'perpetual', '--entitlement', 'on=false', '--entitlement', 'share=0.5', '--entitlement', 'tier=gold=1', '--entitlement', 'v=1.2.3')
    expect((h.calls[0]?.body as { entitlements: unknown }).entitlements).toEqual({ on: false, share: 0.5, tier: 'gold=1', v: '1.2.3' })
    // A code no object takes as its own still reaches KeyGrant, to be judged there.
    const odd = harness({ answers: [{ status: 400, body: { error: 'unknown-entitlement', entitlement: '__proto__' } }] })
    const refused = await odd.run('licenses', 'issue', '--product', 'p', '--type', 'perpetual', '--entitlement', '__proto__=x')
    expect(Object.keys((odd.calls[0]?.body as { entitlements: object }).entitlements)).toEqual(['__proto__'])
    expect(refused).toEqual({ code: EXIT.refused, out: '', err: 'keygrant: unknown-entitlement: the product\'s catalog has no entitlement "__proto__"' })
  })

  it('names the idempotency key it made when the issue may have minted all the same, so a rerun gets that key', async () => {
    const failed = await harness({ answers: [{ status: 500, body: { error: 'mint-failed' } }] }).run('licenses', 'issue', '--product', 'sluice', '--type', 'perpetual')
    expect(failed.err).toBe(
      'keygrant: mint-failed: KeyGrant failed while making the key; it may have been made all the same: run the command again with --idempotency-key cli-run-1 to get it rather than make another',
    )
    for (const answer of [new TypeError('fetch failed'), { status: 500, body: { error: 'mint-failed' } }]) {
      const h = harness({ answers: [answer] })
      const res = await h.run('licenses', 'issue', '--product', 'sluice', '--type', 'perpetual', '--json')
      expect(res.code).toBe(EXIT.unavailable)
      expect(JSON.parse(res.err)).toMatchObject({ idempotencyKey: 'cli-run-1' })
      // Never sent again on its own: only a 429 is.
      expect(h.calls).toHaveLength(1)
    }
    const said = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'issue', '--product', 'sluice', '--type', 'perpetual')
    expect(said.err).toBe(
      'keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed; it may have been made all the same: run the command again with --idempotency-key cli-run-1 to get it rather than make another',
    )
  })

  it('names it too when KeyGrant answered but its answer could not be read, which may have minted', async () => {
    const broken = new Response(new ReadableStream({ start: (controller) => controller.error(new Error('connection reset')) }), { status: 201 })
    const res = await harness({ answers: [broken] }).run('licenses', 'issue', '--product', 'sluice', '--type', 'perpetual', '--json')
    expect(res.code).toBe(EXIT.unavailable)
    expect(JSON.parse(res.err)).toEqual({ error: 'unreadable', status: 201, message: 'connection reset', idempotencyKey: 'cli-run-1' })
  })

  it('waits out a 429 on an issue and on a test license, then sends the same request, its idempotency key included', async () => {
    const limited = { status: 429, body: { error: 'rate-limited', retryAfter: 5 } }
    for (const [argv, made] of [
      [['licenses', 'issue', '--product', 'sluice', '--type', 'perpetual'], { key: KEY, emailed: false }],
      [['licenses', 'test', '--product', 'sluice'], { key: KEY, scenario: 'valid', license: license() }],
    ] as const) {
      const h = harness({ answers: [limited, { status: 201, body: made }] })
      const res = await h.run(...argv)
      expect(res.code).toBe(EXIT.ok)
      expect(res.out.split('\n')[0]).toBe(KEY)
      expect(h.sleeps).toEqual([5000])
      expect(h.calls).toHaveLength(2)
      expect(request(h.calls[1])).toEqual(request(h.calls[0]))
      expect(h.calls[0]?.headers['idempotency-key']).toBe('cli-run-1')
    }
  })

  it('names no key for a refusal, which made nothing, or for a key the run was given', async () => {
    const refused = await harness({ answers: [{ status: 404, body: { error: 'unknown-product' } }] }).run('licenses', 'issue', '--product', 'p', '--type', 'perpetual', '--json')
    expect(JSON.parse(refused.err)).toEqual({ error: 'unknown-product', status: 404 })
    const given = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'issue', '--product', 'p', '--type', 'perpetual', '--idempotency-key', 'order-9')
    expect(given.err).toBe('keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed')
  })
})

describe('reading licenses', () => {
  it('shows one license, a field per line', async () => {
    const shown = license({ revokedReason: 'subscription_canceled', revokedAt: NOW, sale: { id: 'sale_1', index: 2, size: 5 }, seatReleaseDays: 30 })
    const h = harness({ answers: [{ status: 200, body: { license: shown } }] })
    const res = await h.run('licenses', 'get', KEY)
    expect(h.calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/v1/licenses/${KEY}` })
    expect(res.out).toBe(
      [
        `Key           ${KEY}`,
        'Product       sluice',
        'Model         Annual (subscription, mod_annual)',
        'State         active (subscription canceled)',
        'Email         jo@example.com',
        'Expires       2026-10-01 14:13 UTC',
        'Valid until   2026-10-04 14:13 UTC',
        'Grace         3 days',
        'Devices       1 of 3 active',
        'Unused seats  freed after 30 days unseen',
        "Offline days  7 days (its type's default)",
        'Versions      1 and later',
        'Entitlements  edition=pro',
        'Sale          key 2 of 5 (sale_1)',
        'Created       2026-09-20 14:13 UTC',
        'Revoked       2026-09-21 14:13 UTC',
      ].join('\n'),
    )
  })

  it('shows a single major as itself, and an upgrade window that has closed not at all', async () => {
    const shown = async (versions: Record<string, unknown>) => (await harness({ answers: [{ status: 200, body: { license: license({ versions }) } }] }).run('licenses', 'get', KEY)).out
    expect(await shown({ minMajor: 2, maxMajor: 2, upgradeUntil: null })).toMatch(/^Versions +2$/m)
    expect(await shown({ minMajor: 2, maxMajor: 3, upgradeUntil: NOW })).toMatch(/^Versions +2 to 3$/m)
    expect(await shown({ minMajor: 2, maxMajor: 3, upgradeUntil: NOW - 1 })).toMatch(/^Versions +2 to 3$/m)
  })

  it('shows a test license, a timed key waiting for its first use, an unbound key and an open upgrade window as such', async () => {
    const waiting = license({ test: true, model: 'timed', expiresAt: null, validUntil: null, term: { months: 12, days: 30 }, versionRule: 'at_purchase', email: null, seats: 3 })
    const res = await harness({ answers: [{ status: 200, body: { license: waiting } }] }).run('licenses', 'get', KEY)
    expect(res.out).toContain('State         active, test license')
    expect(res.out).toContain('Expires       12 months and 30 days from its first activation')
    expect(res.out).toContain('Versions      bound by its first activation (at purchase)')
    expect(res.out).toContain('Devices       1 of 3 active, 3 seats')
    expect(res.out).not.toContain('Email')
    expect(res.out).not.toContain('Valid until')
    const open = license({ versions: { minMajor: 2, maxMajor: 3, upgradeUntil: NOW + DAY } })
    expect((await harness({ answers: [{ status: 200, body: { license: open } }] }).run('licenses', 'get', KEY)).out).toContain(
      'Versions      2 to 3; every major from 2 up until 2026-09-22 14:13 UTC',
    )
  })

  it('shows unused seats kept, a key\'s own offline days or its type\'s, and no grace; and none of the three from a KeyGrant that does not say', async () => {
    const shown = async (fields: Record<string, unknown>, drop: string[] = []) => {
      const answered = license(fields)
      for (const name of drop) delete answered[name]
      return (await harness({ answers: [{ status: 200, body: { license: answered } }] }).run('licenses', 'get', KEY)).out
    }
    const own = await shown({ seatReleaseDays: null, leaseDays: 1, graceDays: 0, validUntil: NOW + 10 * DAY })
    expect(own).toContain('Unused seats  kept')
    expect(own).toContain('Offline days  1 day\n')
    expect(own).toContain('Grace         none')
    expect(await shown({ seatReleaseDays: 1 })).toContain('Unused seats  freed after 1 day unseen')
    for (const [model, days] of [['perpetual', 30], ['subscription', 7], ['trial', 7], ['timed', 7], ['lifetime', 30]] as const) {
      expect(await shown({ model, leaseDays: null }), model).toContain(`Offline days  ${days} days (its type's default)`)
    }
    const older = await shown({}, ['leaseDays', 'graceDays', 'seatReleaseDays'])
    expect(older).not.toMatch(/^(Grace|Unused seats|Offline days) /m)
    expect(older).toContain('Devices       1 of 3 active')
  })

  it('puts a key typed with odd characters into the path safely', async () => {
    const h = harness({ answers: [{ status: 404, body: { error: 'unknown-license' } }] })
    await h.run('licenses', 'get', ' a/b?c ')
    expect(h.calls[0]?.url).toBe(`${BASE}/v1/licenses/a%2Fb%3Fc`)
  })

  it('lists a page as a table, with the cursor of the next', async () => {
    const page = { licenses: [license(), license({ key: 'SLUICE-EEEE-FFFF-GGGG-HHHH', modelName: null, model: 'perpetual', expiresAt: null, email: null, kind: 'revoked', status: 'revoked', revokedReason: 'refund' })], nextCursor: 'c1' }
    const h = harness({ answers: [{ status: 200, body: page }] })
    const res = await h.run('licenses', 'list', '--product', 'sluice', '--email', 'jo@example.com', '--status', 'active', '--limit', '2')
    expect(h.calls[0]?.url).toBe(`${BASE}/v1/licenses?product=sluice&email=jo%40example.com&status=active&limit=2`)
    expect(res.out).toBe(
      [
        'KEY                         PRODUCT  MODEL      STATE             EXPIRES               DEVICES  EMAIL',
        `${KEY}  sluice   Annual     active            2026-10-01 14:13 UTC  1/3      jo@example.com`,
        'SLUICE-EEEE-FFFF-GGGG-HHHH  sluice   perpetual  revoked (refund)  never                 1/3',
        '',
        'More: --cursor c1 (or --all for every page)',
      ].join('\n'),
    )
  })

  it('follows every page with --all, and prints them as one under --json', async () => {
    const h = harness({
      answers: [
        { status: 200, body: { licenses: [license({ key: 'K-1' })], nextCursor: 'c1' } },
        { status: 200, body: { licenses: [license({ key: 'K-2' })], nextCursor: null } },
      ],
    })
    const res = await h.run('licenses', 'list', '--all', '--cursor', 'c0', '--json')
    expect(h.calls.map((c) => c.path)).toEqual(['/v1/licenses?cursor=c0', '/v1/licenses?cursor=c1'])
    const printed = JSON.parse(res.out)
    expect(printed.licenses.map((l: { key: string }) => l.key)).toEqual(['K-1', 'K-2'])
    expect(printed.nextCursor).toBeNull()
  })

  it('says when there are none, and refuses a status or a limit the API would', async () => {
    expect((await harness({ answers: [{ status: 200, body: { licenses: [], nextCursor: null } }] }).run('licenses', 'list')).out).toBe('No licenses.')
    expect((await harness().run('licenses', 'list', '--status', 'lapsed')).err).toContain('--status must be one of all, active, trial, expired, revoked')
    const zero = harness()
    expect((await zero.run('licenses', 'list', '--limit', '0')).err).toContain('--limit must be from 1 to 100')
    expect(zero.calls).toEqual([])
  })

  it('shows what a checkout made: one license, or the keys of a sale', async () => {
    const one = harness({ answers: [{ status: 200, body: { license: license() } }] })
    expect((await one.run('licenses', 'checkout', 'cs_test_1')).out).toContain(`Key           ${KEY}`)
    expect(one.calls[0]?.url).toBe(`${BASE}/v1/checkouts/cs_test_1/license`)
    const sale = harness({ answers: [{ status: 200, body: { license: license(), licenses: [license(), license({ key: 'K-2' })] } }] })
    const rows = (await sale.run('licenses', 'checkout', 'cs_test_1')).out.split('\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]?.startsWith(KEY)).toBe(true)
    expect(rows[2]?.startsWith('K-2 ')).toBe(true)
    const pending = await harness({ answers: [{ status: 404, body: { error: 'unknown-checkout' } }] }).run('licenses', 'checkout', 'cs_test_1')
    expect(pending).toMatchObject({ code: EXIT.refused, err: 'keygrant: unknown-checkout: no key from that checkout yet: the webhook that makes it can land a few seconds after the buyer' })
  })
})

describe('licenses extend', () => {
  it('sends the date asked for, through its last millisecond', async () => {
    const h = harness({ answers: [{ status: 200, body: { license: license({ expiresAt: Date.UTC(2027, 0, 31, 23, 59, 59, 999) }) } }] })
    const res = await h.run('licenses', 'extend', KEY, '--to', '2027-01-31')
    expect(h.calls).toEqual([expect.objectContaining({ method: 'POST', url: `${BASE}/v1/licenses/${KEY}/extend`, body: { expiresAt: Date.UTC(2027, 0, 31, 23, 59, 59, 999) } })])
    expect(res.out.split('\n')[0]).toBe('Expires 2027-01-31 23:59 UTC.')
  })

  it('counts --days from its expiry, or from now for a key that has run out', async () => {
    const running = harness({ answers: [{ status: 200, body: { license: license({ expiresAt: NOW + 10 * DAY }) } }, { status: 200, body: { license: license() } }] })
    await running.run('licenses', 'extend', KEY, '--days', '30')
    expect(running.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', `/v1/licenses/${KEY}`, undefined],
      ['POST', `/v1/licenses/${KEY}/extend`, { expiresAt: NOW + 40 * DAY }],
    ])
    const lapsed = harness({ answers: [{ status: 200, body: { license: license({ expiresAt: NOW - 5 * DAY }) } }, { status: 200, body: { license: license() } }] })
    await lapsed.run('licenses', 'extend', KEY, '--days', '30')
    expect(lapsed.calls[1]?.body).toEqual({ expiresAt: NOW + 30 * DAY })
  })

  it('refuses a timed key waiting for its first use and a key with no expiry by the API code, sending no extension', async () => {
    const waiting = harness({ answers: [{ status: 200, body: { license: license({ model: 'timed', expiresAt: null, term: { months: 12, days: 0 } }) } }] })
    expect(await waiting.run('licenses', 'extend', KEY, '--days', '30')).toEqual({
      code: EXIT.refused,
      out: '',
      err: 'keygrant: term-not-started: the key is a timed key waiting for its first activation: its term has not started, so it has no end to move yet',
    })
    expect(waiting.calls).toHaveLength(1)
    const perpetual = harness({ answers: [{ status: 200, body: { license: license({ model: 'perpetual', expiresAt: null }) } }] })
    const res = await perpetual.run('licenses', 'extend', KEY, '--days', '30', '--json')
    expect(JSON.parse(res.err)).toEqual({ error: 'not-expiring' })
  })

  it('passes on the API refusing a --to that would shorten it, or a revoked key', async () => {
    const res = await harness({ answers: [{ status: 409, body: { error: 'license-revoked' } }] }).run('licenses', 'extend', KEY, '--to', '2027-01-31')
    expect(res).toMatchObject({ code: EXIT.refused, err: 'keygrant: license-revoked: the key is revoked, and extending does not reinstate it' })
  })

  it('reads --days and --to before asking anything, so a bad one is a usage error with no key and no network', async () => {
    for (const args of [['--days', 'abc'], ['--to', 'soon']]) {
      const h = harness({ env: {} })
      expect((await h.run('licenses', 'extend', KEY, ...args)).code).toBe(EXIT.usage)
      expect(h.calls).toEqual([])
    }
    const badToken = harness({ env: {} })
    expect((await badToken.run('licenses', 'issue', '--product', 'p', '--type', 'perpetual', '--idempotency-key=')).code).toBe(EXIT.usage)
    expect((await badToken.run('licenses', 'test', '--product', 'p', '--idempotency-key=')).code).toBe(EXIT.usage)
  })

  it('takes exactly one of --to and --days', async () => {
    for (const args of [[], ['--to', '2027-01-31', '--days', '3']]) {
      expect((await harness().run('licenses', 'extend', KEY, ...args)).err).toContain('give one of --to <date> and --days <n>')
    }
  })
})

describe('changing a license', () => {
  it('sets the whole versions range, the upgrade window too', async () => {
    const h = harness({ answers: [{ status: 200, body: { license: license() } }, { status: 200, body: { license: license() } }] })
    await h.run('licenses', 'versions', KEY, '--min', '2', '--max', '3', '--upgrade-until', '2027-06-30')
    await h.run('licenses', 'versions', KEY, '--min', '2', '--max', 'none', '--upgrade-until', 'none')
    expect(h.calls.map((c) => [c.path, c.body])).toEqual([
      [`/v1/licenses/${KEY}/versions`, { minMajor: 2, maxMajor: 3, upgradeUntil: Date.UTC(2027, 5, 30, 23, 59, 59, 999) }],
      [`/v1/licenses/${KEY}/versions`, { minMajor: 2, maxMajor: null, upgradeUntil: null }],
    ])
    expect((await harness().run('licenses', 'versions', KEY, '--min', '2')).err).toContain('--min and --max are both required')
    expect((await harness().run('licenses', 'versions', KEY, '--min', '0', '--max', '2')).err).toContain('--min must be from 1 to 99,999')
  })

  it('sets the device limit', async () => {
    const h = harness({ answers: [{ status: 200, body: { license: license({ deviceLimit: 5 }) } }] })
    const res = await h.run('licenses', 'device-limit', KEY, '5')
    expect(h.calls[0]).toMatchObject({ method: 'POST', path: `/v1/licenses/${KEY}/devices`, body: { deviceLimit: 5 } })
    expect(res.out).toContain('Devices       1 of 5 active')
    expect((await harness().run('licenses', 'device-limit', KEY)).err).toContain('missing the device limit')
  })

  it('sets when an unused device frees its seat, or turns it off, and prints the license as it now stands', async () => {
    const h = harness({ answers: [{ status: 200, body: { license: license({ seatReleaseDays: 30 }) } }, { status: 200, body: { license: license({ seatReleaseDays: null }) } }] })
    const on = await h.run('licenses', 'seat-release', KEY, '30')
    const off = await h.run('licenses', 'seat-release', KEY, ' OFF ')
    expect(h.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', `/v1/licenses/${KEY}/seat-release`, { seatReleaseDays: 30 }],
      ['POST', `/v1/licenses/${KEY}/seat-release`, { seatReleaseDays: null }],
    ])
    expect(on).toMatchObject({ code: EXIT.ok, err: '' })
    expect(on.out).toMatch(new RegExp(`^Key +${KEY}$`, 'm'))
    expect(on.out).toContain('Unused seats  freed after 30 days unseen')
    expect(off.out).toContain('Unused seats  kept')
    const answer = { license: license({ seatReleaseDays: 365 }) }
    const json = await harness({ answers: [{ status: 200, body: answer }] }).run('licenses', 'seat-release', KEY, '365', '--json')
    expect(JSON.parse(json.out)).toEqual(answer)
  })

  it('refuses days the API would not take before asking anything, with no key and no network', async () => {
    const refusals: [string[], string][] = [
      [[KEY, '0'], 'the seat release days must be from 1 to 365'],
      [[KEY, '366'], 'the seat release days must be from 1 to 365'],
      [[KEY, '-1'], 'the seat release days must be a whole number of days or off, not "-1"'],
      [[KEY, '7.5'], 'the seat release days must be a whole number of days or off, not "7.5"'],
      [[KEY, 'none'], 'the seat release days must be a whole number of days or off, not "none"'],
      [[KEY], 'missing the seat release days (or off)'],
      [[KEY, '30', 'extra'], 'unexpected argument "extra"'],
    ]
    for (const [args, said] of refusals) {
      const h = harness({ env: {} })
      expect(await h.run('licenses', 'seat-release', ...args)).toEqual({ code: EXIT.usage, out: '', err: `keygrant: ${said}\nRun \`keygrant licenses seat-release --help\`.` })
      expect(h.calls).toEqual([])
    }
  })

  it('names the API refusing the days: fewer than the key\'s offline days, or a key it does not reach', async () => {
    const short = await harness({ answers: [{ status: 400, body: { error: 'invalid-seat-release' } }] }).run('licenses', 'seat-release', KEY, '3')
    expect(short).toEqual({
      code: EXIT.refused,
      out: '',
      err: 'keygrant: invalid-seat-release: the seat release days are fewer than the key\'s offline days: a device is never freed while it may still run offline on its lease (`keygrant licenses get <key>` shows a key\'s offline days, and `keygrant products --json` each model\'s as leaseDays, null for its type\'s default)',
    })
    const unknown = await harness({ answers: [{ status: 404, body: { error: 'unknown-license' } }] }).run('licenses', 'seat-release', KEY, '30', '--json')
    expect(unknown.code).toBe(EXIT.refused)
    expect(JSON.parse(unknown.err)).toEqual({ error: 'unknown-license', status: 404 })
  })

  it('revokes, with a reason when given one', async () => {
    const h = harness({ answers: [{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }] })
    expect((await h.run('licenses', 'revoke', KEY)).out).toBe(`Revoked ${KEY}.`)
    expect(JSON.parse((await h.run('licenses', 'revoke', KEY, '--reason', 'refund', '--json')).out)).toEqual({ ok: true })
    expect(h.calls.map((c) => c.body)).toEqual([{}, { reason: 'refund' }])
    expect((await harness().run('licenses', 'revoke', KEY, '--reason', 'angry')).err).toContain('--reason must be one of refund, chargeback, subscription_canceled, manual')
  })

  it('frees a device, and says when there was none to free', async () => {
    const h = harness({ answers: [{ status: 200, body: { released: 1 } }, { status: 200, body: { released: 0 } }] })
    expect((await h.run('licenses', 'free-device', KEY, 'act_1')).out).toBe(`Freed act_1 from ${KEY}.`)
    expect((await h.run('licenses', 'free-device', KEY, 'act_1')).out).toBe(`No active device act_1 on ${KEY}: nothing to free.`)
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', path: `/v1/licenses/${KEY}/activations/act_1`, body: undefined })
    const padded = harness({ answers: [{ status: 200, body: { released: 1 } }] })
    expect((await padded.run('licenses', 'free-device', KEY, ' act_1 ')).out).toBe(`Freed act_1 from ${KEY}.`)
  })
})
