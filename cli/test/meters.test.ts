import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { harness, license, meter, request } from './harness.js'

const KEY = 'SLUICE-AAAA-BBBB-CCCC-DDDD'
const BASE = 'https://api.keygrant.dev'
const METERS_URL = `${BASE}/v1/licenses/${KEY}/meters`

/** The license as the API answers it with these meters. */
const metered = (meters: Record<string, unknown>) => ({ license: license({ meters }) })

/** Two meters: one used for good, and one that comes back each billing period and has gone over. */
const TWO = {
  exports: meter(),
  renders: meter({ uses: 50, extra: 0, used: 55, left: 0, overage: 5, offline: 5, ownOffline: 5, resets: 'period', periodEnd: Date.UTC(2027, 0, 31, 23, 59, 59, 999) }),
}

describe('keygrant licenses meters', () => {
  it('reads the license and prints each meter: what is left, the total, what is used and added, the allowance and when it resets', async () => {
    const h = harness({ answers: [{ status: 200, body: metered({ exports: meter(), renders: meter({ uses: 50, extra: 0, used: 20, left: 30, offline: 5, ownOffline: 5, resets: 'period', periodEnd: Date.UTC(2027, 0, 31, 23, 59, 59, 999) }) }) }] })
    const res = await h.run('licenses', 'meters', KEY)
    expect(h.calls).toHaveLength(1)
    expect(request(h.calls[0])).toMatchObject({ method: 'GET', url: `${BASE}/v1/licenses/${KEY}`, body: undefined })
    expect(res).toEqual({
      code: EXIT.ok,
      err: '',
      out: [
        'METER    LEFT  TOTAL  USED  ADDED  OFFLINE        RESETS',
        'exports  550   1,500  950   500    150 (default)  never',
        'renders  30    50     20    0      5              each period, to 2027-01-31 23:59 UTC',
      ].join('\n'),
    })
  })

  it('shows a way of resetting it does not know as the word KeyGrant gave, rather than refusing the answer', async () => {
    const res = await harness({ answers: [{ status: 200, body: metered({ exports: meter({ resets: 'yearly' }) }) }] }).run('licenses', 'meters', KEY)
    expect(res.code).toBe(EXIT.ok)
    expect(res.out.split('\n')[1]).toMatch(/ {2}yearly$/)
  })

  it('adds the overage column only when a meter has some, and says each period when the end is not known', async () => {
    const res = await harness({ answers: [{ status: 200, body: metered({ ...TWO, hand: meter({ resets: 'period', periodEnd: null }) }) }] }).run('licenses', 'meters', KEY)
    expect(res.out.split('\n')).toEqual([
      'METER    LEFT  TOTAL  USED  ADDED  OFFLINE        OVER  RESETS',
      'exports  550   1,500  950   500    150 (default)        never',
      'renders  0     50     55    0      5              5     each period, to 2027-01-31 23:59 UTC',
      'hand     550   1,500  950   500    150 (default)        each period',
    ])
  })

  it('says so for a license with no meters, and for a KeyGrant that does not report them', async () => {
    for (const body of [metered({}), { license: license() }]) {
      expect(await harness({ answers: [{ status: 200, body }] }).run('licenses', 'meters', KEY)).toEqual({ code: EXIT.ok, out: 'No meters.', err: '' })
    }
  })

  it('prints the API answer under --json', async () => {
    const answer = metered(TWO)
    const res = await harness({ answers: [{ status: 200, body: answer }] }).run('licenses', 'meters', KEY, '--json')
    expect(JSON.parse(res.out)).toEqual(answer)
  })

  it('needs the key and nothing more, and names a key that is not yours', async () => {
    for (const [argv, said] of [
      [['licenses', 'meters'], 'missing the license key'],
      [['licenses', 'meters', KEY, 'exports'], 'unexpected argument "exports"'],
    ] as const) {
      const h = harness()
      expect(await h.run(...argv)).toEqual({ code: EXIT.usage, out: '', err: `keygrant: ${said}\nRun \`keygrant licenses meters --help\`.` })
      expect(h.calls).toEqual([])
    }
    const res = await harness({ answers: [{ status: 404, body: { error: 'unknown-license' } }] }).run('licenses', 'meters', KEY)
    expect(res).toMatchObject({ code: EXIT.refused, err: 'keygrant: unknown-license: no license of yours has that key (a kg_test_ key reaches test licenses only)' })
  })
})

describe('a license in full', () => {
  it('shows its meters in a line each command that prints a license in full uses, and none when it has none', async () => {
    const withMeters = await harness({ answers: [{ status: 200, body: metered(TWO) }] }).run('licenses', 'get', KEY)
    expect(withMeters.out).toContain('Meters        exports 550 of 1,500 left; renders 0 of 50 left, 5 over (each period)\n')
    for (const body of [metered({}), { license: license() }]) {
      expect((await harness({ answers: [{ status: 200, body }] }).run('licenses', 'get', KEY)).out).not.toContain('Meters')
    }
  })

  it('refuses an answer whose meters are not the shape it prints, as something other than KeyGrant', async () => {
    const odd = [
      { exports: { ...meter(), left: '550' } },
      { exports: { ...meter(), resets: 5 } },
      { exports: { ...meter(), periodEnd: undefined } },
      { exports: { ...meter(), uses: 1.5 } },
      { exports: { ...meter(), extra: '500' } },
      { exports: { ...meter(), offline: -1 } },
      { exports: null },
      { exports: { ...meter(), ownOffline: -1 } },
      { exports: { ...meter(), ownOffline: '5' } },
      { exports: { ...meter(), periodEnd: '2027-01-31' } },
      { exports: { ...meter(), used: -1 } },
      { exports: { ...meter(), overage: 1.5 } },
      [],
      'exports',
      null,
    ]
    for (const meters of odd) {
      const res = await harness({ answers: [{ status: 200, body: { license: license({ meters }) } }] }).run('licenses', 'get', KEY)
      expect([meters, res.code, res.err]).toEqual([meters, EXIT.unavailable, "keygrant: https://api.keygrant.dev answered HTTP 200 with something that is not KeyGrant's JSON"])
    }
  })
})

describe('keygrant licenses uses', () => {
  const after = (extra: Record<string, unknown> = {}) => ({ status: 200, body: metered({ exports: meter(extra) }) })

  it('adds uses with the idempotency key it makes for the run, and prints what was done and the license', async () => {
    const h = harness({ answers: [after({ extra: 1000, left: 1050 })] })
    const res = await h.run('licenses', 'uses', KEY, 'exports', '--add', '500')
    expect(request(h.calls[0])).toMatchObject({ method: 'POST', url: `${METERS_URL}/exports/add`, body: { uses: 500 }, headers: expect.objectContaining({ 'idempotency-key': 'cli-run-1' }) })
    expect(res.code).toBe(EXIT.ok)
    expect(res.out.split('\n').slice(0, 3)).toEqual(['Added 500 uses to exports: 1,050 of 2,000 left.', '', `Key           ${KEY}`])
    expect(res.out).toContain('Meters        exports 1,050 of 2,000 left')
  })

  it('sends the idempotency key asked for, so a retry by hand adds nothing more', async () => {
    const h = harness({ answers: [after()] })
    await h.run('licenses', 'uses', KEY, 'exports', '--add', '5', '--idempotency-key', 'topup-77')
    expect(h.calls[0]?.headers['idempotency-key']).toBe('topup-77')
  })

  it('sets the key\'s own uses, which is its own retry and carries no idempotency key', async () => {
    const h = harness({ answers: [after({ uses: 2000, left: 1550 })] })
    const res = await h.run('licenses', 'uses', KEY, 'exports', '--set', '2000')
    expect(request(h.calls[0])).toMatchObject({ method: 'POST', url: `${METERS_URL}/exports`, body: { uses: 2000 } })
    expect(h.calls[0]?.headers['idempotency-key']).toBeUndefined()
    expect(res.out.split('\n')[0]).toBe('Set exports to 2,000 uses: 1,550 of 2,500 left.')
    const zero = harness({ answers: [after({ uses: 0, used: 0, left: 500 })] })
    const none = await zero.run('licenses', 'uses', KEY, 'exports', '--set', '0')
    expect(zero.calls[0]?.body).toEqual({ uses: 0 })
    expect(none.out.split('\n')[0]).toBe('Set exports to 0 uses: 500 of 500 left.')
    const one = harness({ answers: [after({ uses: 1, used: 0, left: 501 })] })
    expect((await one.run('licenses', 'uses', KEY, 'exports', '--set', '1')).out.split('\n')[0]).toBe('Set exports to 1 use: 501 of 501 left.')
  })

  it('sets the offline allowance to a number or back to the default, which the API takes as null', async () => {
    const number = harness({ answers: [after({ offline: 20, ownOffline: 20 })] })
    const set = await number.run('licenses', 'uses', KEY, 'exports', '--offline', '20')
    expect(number.calls[0]?.body).toEqual({ offline: 20 })
    expect(set.out.split('\n')[0]).toBe('Set the offline allowance of exports to 20 a device.')
    const none = harness({ answers: [after({ offline: 0, ownOffline: 0 })] })
    await none.run('licenses', 'uses', KEY, 'exports', '--offline=0')
    expect(none.calls[0]?.body).toEqual({ offline: 0 })
    for (const word of ['default', ' Default ']) {
      const back = harness({ answers: [after()] })
      const res = await back.run('licenses', 'uses', KEY, 'exports', '--offline', word)
      expect(back.calls[0]?.body).toEqual({ offline: null })
      expect(res.out.split('\n')[0]).toBe('Set the offline allowance of exports to the default, 150 a device.')
    }
  })

  it('starts a new period by hand with the idempotency key and no body', async () => {
    const h = harness({ answers: [{ status: 200, body: metered({ renders: meter({ uses: 50, extra: 0, used: 0, left: 50, resets: 'period' }) }) }] })
    const res = await h.run('licenses', 'uses', KEY, 'renders', '--reset', '--idempotency-key', 'monthly-1')
    expect(request(h.calls[0])).toMatchObject({ method: 'POST', url: `${METERS_URL}/renders/reset`, body: undefined, headers: expect.objectContaining({ 'idempotency-key': 'monthly-1' }) })
    expect(res.out.split('\n')[0]).toBe('Reset renders, a new period begins: 50 of 50 left.')
  })

  it('says what it did when the answer does not name the meter, and prints the API answer under --json', async () => {
    const bare = await harness({ answers: [{ status: 200, body: { license: license() } }] }).run('licenses', 'uses', KEY, 'exports', '--add', '5')
    expect(bare.out.split('\n')[0]).toBe('Added 5 uses to exports.')
    // A code is whatever was typed: one every object has is not a meter the key holds, even beside the meters it does hold.
    for (const code of ['constructor', 'toString', '__proto__']) {
      const odd = await harness({ answers: [{ status: 200, body: metered({ exports: meter() }) }] }).run('licenses', 'uses', KEY, code, '--set', '5')
      expect([code, odd.out.split('\n')[0]]).toEqual([code, `Set ${code} to 5 uses.`])
    }
    // One use is one use, not "1 uses".
    const one = await harness({ answers: [{ status: 200, body: metered({ exports: meter({ left: 551 }) }) }] }).run('licenses', 'uses', KEY, 'exports', '--add', '1')
    expect(one.out.split('\n')[0]).toBe('Added 1 use to exports: 551 of 1,500 left.')
    const answer = metered({ exports: meter() })
    const json = await harness({ answers: [{ status: 200, body: answer }] }).run('licenses', 'uses', KEY, 'exports', '--add', '5', '--json')
    expect(JSON.parse(json.out)).toEqual(answer)
  })

  it('writes the meter\'s code and the key as steps of the path', async () => {
    const h = harness({ answers: [after(), after()] })
    await h.run('licenses', 'uses', KEY, 'rendus/é 1', '--set', '1')
    await h.run('licenses', 'uses', ` ${KEY} `, '__proto__', '--add', '1')
    expect(h.calls.map((c) => c.url)).toEqual([`${METERS_URL}/rendus%2F%C3%A9%201`, `${METERS_URL}/__proto__/add`])
  })

  it('refuses what it can tell is wrong before sending anything', async () => {
    const refusals: [string[], string][] = [
      [[KEY, 'exports'], 'give one of --add <n>, --set <n>, --offline <n|default> and --reset'],
      [[KEY, 'exports', '--add', '5', '--set', '5'], 'give one of --add <n>, --set <n>, --offline <n|default> and --reset'],
      [[KEY, 'exports', '--reset', '--offline', 'default'], 'give one of --add <n>, --set <n>, --offline <n|default> and --reset'],
      [[KEY, 'exports', '--add', '0'], '--add must be from 1 to 1,000,000,000'],
      [[KEY, 'exports', '--add', '1000000001'], '--add must be from 1 to 1,000,000,000'],
      [[KEY, 'exports', '--add', '1.5'], '--add must be a whole number, not "1.5"'],
      [[KEY, 'exports', '--set', '-1'], '--set must be from 0 to 1,000,000,000'],
      [[KEY, 'exports', '--offline', 'some'], '--offline must be a whole number, not "some"'],
      [[KEY, 'exports', '--offline', '1000000001'], '--offline must be from 0 to 1,000,000,000'],
      [[KEY, 'exports', '--set', '5', '--idempotency-key', 'x'], '--idempotency-key applies to --add and --reset: --set and --offline can simply be run again'],
      [[KEY, 'exports', '--offline', '5', '--idempotency-key', 'x'], '--idempotency-key applies to --add and --reset: --set and --offline can simply be run again'],
      [[KEY, 'exports', '--add', '5', '--idempotency-key', ' x'], '--idempotency-key must be 1 to 255 visible ASCII characters, with no space at either end'],
      [[KEY], 'missing the meter code'],
      [[], 'missing the license key'],
      [[KEY, 'exports', 'more', '--add', '5'], 'unexpected argument "more"'],
      [['..', 'exports', '--add', '5'], '".." is not a key or an id'],
      [[KEY, ' ', '--add', '5'], 'a key or an id cannot be empty'],
    ]
    for (const [args, said] of refusals) {
      const h = harness()
      expect(await h.run('licenses', 'uses', ...args)).toEqual({ code: EXIT.usage, out: '', err: `keygrant: ${said}\nRun \`keygrant licenses uses --help\`.` })
      expect(h.calls).toEqual([])
    }
  })

  it('names what KeyGrant refused in a sentence', async () => {
    const refused: [number, Record<string, unknown>, string, string][] = [
      [404, { error: 'unknown-meter' }, '--add', "unknown-meter: the key holds no meter with that code, and the product has none to add to it with --set (`keygrant licenses meters <key>` lists a key's meters, `keygrant products` a product's)"],
      [409, { error: 'meter-not-periodic' }, '--reset', 'meter-not-periodic: the meter does not come back each billing period, so there is no period to reset'],
      [400, { error: 'over-cap' }, '--add', 'over-cap: that would take the meter past the most uses one may count (1,000,000,000)'],
      [409, { error: 'idempotency-key-reused' }, '--add', 'idempotency-key-reused: that idempotency key was first used for another request'],
      [409, { error: 'meter-cap' }, '--set', 'meter-cap: the key already holds the most meters a key may (8)'],
      [409, { error: 'edit-busy' }, '--set', 'edit-busy: the meter kept changing while it was edited: try again'],
      [400, { error: 'meter-license-file' }, '--set', 'meter-license-file: a key sent as an offline license file carries no meter'],
      [400, { error: 'meter-period-subscription-only' }, '--set', 'meter-period-subscription-only: a meter that comes back each billing period is for a subscription key only'],
    ]
    for (const [status, body, flag, said] of refused) {
      const argv = flag === '--reset' ? ['--reset'] : [flag, '5']
      const res = await harness({ answers: [{ status, body }] }).run('licenses', 'uses', KEY, 'exports', ...argv)
      expect([body.error, res.code, res.err]).toEqual([body.error, EXIT.refused, `keygrant: ${said}`])
    }
  })

  it('names the idempotency key it made when an add or a reset may have gone through all the same, and not one it was given', async () => {
    const adds = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'uses', KEY, 'exports', '--add', '5')
    expect(adds).toEqual({
      code: EXIT.unavailable,
      out: '',
      err: 'keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed; the uses may have been added all the same: run the command again with --idempotency-key cli-run-1 to get the license as it stands rather than add them again',
    })
    const reset = await harness({ answers: [{ status: 500, body: { error: 'edit-busy' } }] }).run('licenses', 'uses', KEY, 'renders', '--reset', '--json')
    expect(reset.code).toBe(EXIT.unavailable)
    expect(JSON.parse(reset.err)).toMatchObject({ error: 'edit-busy', status: 500, idempotencyKey: 'cli-run-1' })
    const plain = await harness({ answers: [{ status: 500, body: {} }] }).run('licenses', 'uses', KEY, 'renders', '--reset')
    expect(plain.err).toContain('the period may have been reset all the same: run the command again with --idempotency-key cli-run-1 to get the license as it stands rather than reset it again')
    const given = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'uses', KEY, 'exports', '--add', '5', '--idempotency-key', 'mine-1')
    expect(given.err).toBe('keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed')
    // A set repeats on its own: nothing to name.
    const set = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'uses', KEY, 'exports', '--set', '5')
    expect(set.err).toBe('keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed')
  })

  it('says what it did for a reset or an offline allowance the answer does not name the meter of', async () => {
    const bare = { status: 200, body: { license: license() } }
    const reset = await harness({ answers: [bare] }).run('licenses', 'uses', KEY, 'renders', '--reset')
    expect(reset.out.split('\n')[0]).toBe('Reset renders, a new period begins.')
    const unnamed = await harness({ answers: [bare] }).run('licenses', 'uses', KEY, 'exports', '--offline', 'default')
    expect(unnamed.out.split('\n')[0]).toBe('Set the offline allowance of exports to the default.')
  })

  it('takes the most uses the API takes, in an add, a set and an offline allowance', async () => {
    const MOST = '1000000000'
    for (const flag of ['--add', '--set', '--offline']) {
      const h = harness({ answers: [after()] })
      const res = await h.run('licenses', 'uses', KEY, 'exports', flag, MOST)
      expect([flag, res.code]).toEqual([flag, EXIT.ok])
      expect(Object.values(h.calls[0]?.body as Record<string, number>)).toEqual([1_000_000_000])
    }
  })

  it('names the idempotency key it made when KeyGrant answered but the answer is not a license, which may have added or reset all the same', async () => {
    const odd = { status: 200, body: { license: { key: KEY, meters: { exports: { ...meter(), left: '1' } } } } }
    const add = await harness({ answers: [odd] }).run('licenses', 'uses', KEY, 'exports', '--add', '5')
    expect(add.code).toBe(EXIT.unavailable)
    expect(add.err).toContain('the uses may have been added all the same: run the command again with --idempotency-key cli-run-1')
    const reset = await harness({ answers: [odd] }).run('licenses', 'uses', KEY, 'exports', '--reset', '--json')
    expect(reset.code).toBe(EXIT.unavailable)
    expect(JSON.parse(reset.err)).toMatchObject({ error: 'not-json', status: 200, idempotencyKey: 'cli-run-1' })
  })

  it('waits out a 429 and sends the same add again, its idempotency key included', async () => {
    const h = harness({ answers: [{ status: 429, body: { error: 'rate-limited', retryAfter: 5 } }, after()] })
    const res = await h.run('licenses', 'uses', KEY, 'exports', '--add', '5')
    expect(res.code).toBe(EXIT.ok)
    expect(h.sleeps).toEqual([5000])
    expect(request(h.calls[1])).toEqual(request(h.calls[0]))
    expect(h.calls[1]?.headers['idempotency-key']).toBe('cli-run-1')
  })
})

describe('keygrant licenses use', () => {
  const spent = (extra: Record<string, unknown> = {}) => ({ status: 200, body: { meter: meter({ used: 951, left: 549, ...extra }) } })

  it('spends one use by default, with the spend id it makes for the run, and prints what is left and the id', async () => {
    const h = harness({ answers: [spent()] })
    const res = await h.run('licenses', 'use', KEY, 'exports')
    expect(request(h.calls[0])).toMatchObject({ method: 'POST', url: `${METERS_URL}/exports/use`, body: { n: 1, id: 'cli-run-1' } })
    expect(h.calls[0]?.headers['idempotency-key']).toBeUndefined()
    expect(res).toEqual({ code: EXIT.ok, err: '', out: ['Spent     1 of exports', 'Left      549 of 1,500', 'Spend id  cli-run-1'].join('\n') })
  })

  it('spends n at once under the id asked for, and prints the API answer under --json', async () => {
    const h = harness({ answers: [spent({ used: 990, left: 510 })] })
    const res = await h.run('licenses', 'use', KEY, 'exports', '40', '--id', 'render-2026-10-15-00042', '--json')
    expect(h.calls[0]?.body).toEqual({ n: 40, id: 'render-2026-10-15-00042' })
    expect(JSON.parse(res.out)).toEqual({ meter: meter({ used: 990, left: 510 }) })
    const text = await harness({ answers: [spent({ used: 990, left: 510 })] }).run('licenses', 'use', KEY, 'exports', '40', '--id', 'render-2026-10-15-00042')
    expect(text.out).toContain('Spent     40 of exports')
    expect(text.out).toContain('Spend id  render-2026-10-15-00042')
  })

  it('refuses what it can tell is wrong before sending anything', async () => {
    const refusals: [string[], string][] = [
      [[KEY, 'exports', '0'], 'the amount must be from 1 to 1,000,000,000'],
      [[KEY, 'exports', '1000000001'], 'the amount must be from 1 to 1,000,000,000'],
      [[KEY, 'exports', '2.5'], 'the amount must be a whole number, not "2.5"'],
      [[KEY, 'exports', 'many'], 'the amount must be a whole number, not "many"'],
      [[KEY, 'exports', '1', 'extra'], 'unexpected argument "extra"'],
      [[KEY], 'missing the meter code'],
      [[], 'missing the license key'],
      [[KEY, 'exports', '--id', 'short'], '--id must be 16 to 64 letters, digits, hyphens and underscores'],
      [[KEY, 'exports', '--id', 'a'.repeat(65)], '--id must be 16 to 64 letters, digits, hyphens and underscores'],
      [[KEY, 'exports', '--id', 'has a space in it....'], '--id must be 16 to 64 letters, digits, hyphens and underscores'],
    ]
    for (const [args, said] of refusals) {
      const h = harness()
      expect(await h.run('licenses', 'use', ...args)).toEqual({ code: EXIT.usage, out: '', err: `keygrant: ${said}\nRun \`keygrant licenses use --help\`.` })
      expect(h.calls).toEqual([])
    }
  })

  it('says how many are left when fewer than asked, and why a key spends nothing', async () => {
    const used = await harness({ answers: [{ status: 409, body: { error: 'used-up', left: 3 } }] }).run('licenses', 'use', KEY, 'exports', '5')
    expect(used).toEqual({ code: EXIT.refused, out: '', err: 'keygrant: used-up: the meter has 3 uses left, fewer than asked' })
    const json = await harness({ answers: [{ status: 409, body: { error: 'used-up', left: 0 } }] }).run('licenses', 'use', KEY, 'exports', '--json')
    expect(JSON.parse(json.err)).toEqual({ error: 'used-up', left: 0, status: 409 })
    const refused: [number, string, string][] = [
      [409, 'license-revoked', 'the key is revoked (it cannot be extended or spent from, and no file is made for it)'],
      [409, 'license-expired', 'the key has expired, so nothing is spent from it'],
      [404, 'unknown-meter', "the key holds no meter with that code, and the product has none to add to it with --set (`keygrant licenses meters <key>` lists a key's meters, `keygrant products` a product's)"],
      [404, 'unknown-license', 'no license of yours has that key (a kg_test_ key reaches test licenses only)'],
    ]
    for (const [status, error, said] of refused) {
      const res = await harness({ answers: [{ status, body: { error } }] }).run('licenses', 'use', KEY, 'exports')
      expect([error, res.code, res.err]).toEqual([error, EXIT.refused, `keygrant: ${error}: ${said}`])
    }
  })

  it('names the spend id it made when the spend may have gone through all the same, and not one it was given', async () => {
    const made = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'use', KEY, 'exports', '3')
    expect(made.err).toBe(
      'keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed; the spend may have been made all the same: run the command again with --id cli-run-1 to answer as that spend did rather than spend again',
    )
    const json = await harness({ answers: [{ status: 500, body: {} }] }).run('licenses', 'use', KEY, 'exports', '--json')
    expect(json.code).toBe(EXIT.unavailable)
    expect(JSON.parse(json.err)).toMatchObject({ status: 500, id: 'cli-run-1' })
    const given = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'use', KEY, 'exports', '--id', 'render-00000000042')
    expect(given.err).toBe('keygrant: could not reach KeyGrant at https://api.keygrant.dev: fetch failed')
  })

  it('waits out a 429 and sends the same spend again, its id included, so it can never spend twice', async () => {
    const h = harness({ answers: [{ status: 429, body: { error: 'rate-limited', retryAfter: 5 } }, spent()] })
    const res = await h.run('licenses', 'use', KEY, 'exports', '2')
    expect(res.code).toBe(EXIT.ok)
    expect(h.sleeps).toEqual([5000])
    expect(request(h.calls[1])).toEqual(request(h.calls[0]))
    expect(h.calls[1]?.body).toEqual({ n: 2, id: 'cli-run-1' })
  })

  it('takes an id of 16 to 64 characters and the most uses, and refuses an id one short', async () => {
    for (const id of ['a'.repeat(16), 'b'.repeat(64), 'A-b_9'.repeat(10)]) {
      const h = harness({ answers: [spent()] })
      expect([id, (await h.run('licenses', 'use', KEY, 'exports', '1000000000', '--id', id)).code]).toEqual([id, EXIT.ok])
      expect(h.calls[0]?.body).toEqual({ n: 1_000_000_000, id })
    }
    const h = harness()
    const res = await h.run('licenses', 'use', KEY, 'exports', '--id', 'c'.repeat(15))
    expect(res).toMatchObject({ code: EXIT.usage, err: expect.stringContaining('--id must be 16 to 64 letters, digits, hyphens and underscores') })
    expect(h.calls).toEqual([])
  })

  it('names the spend id it made when KeyGrant answered but the answer is not a meter, which may have spent all the same', async () => {
    const res = await harness({ answers: [{ status: 200, body: {} }] }).run('licenses', 'use', KEY, 'exports', '3', '--json')
    expect(res.code).toBe(EXIT.unavailable)
    expect(JSON.parse(res.err)).toMatchObject({ error: 'not-json', status: 200, id: 'cli-run-1' })
    const said = await harness({ answers: [{ status: 200, body: { meter: { left: '1' } } }] }).run('licenses', 'use', KEY, 'exports')
    expect(said.err).toContain('the spend may have been made all the same: run the command again with --id cli-run-1 to answer as that spend did rather than spend again')
  })

  it('takes an answer that is not a meter for something other than KeyGrant, exit 5', async () => {
    for (const body of [{}, { meter: null }, { meter: { left: 1 } }, { meter: meter({ left: -1 }) }]) {
      const res = await harness({ answers: [{ status: 200, body }] }).run('licenses', 'use', KEY, 'exports', '--id', 'render-00000000042')
      expect([body, res.code]).toEqual([body, EXIT.unavailable])
      expect(res.err).toBe("keygrant: https://api.keygrant.dev answered HTTP 200 with something that is not KeyGrant's JSON")
    }
  })
})

describe('the help', () => {
  it('lists the three commands, and each one\'s own help says what it takes', async () => {
    const main = await harness().run('--help')
    for (const name of ['licenses meters', 'licenses uses', 'licenses use']) expect(main.out).toContain(`  ${name} `)
    for (const [name, usage] of [
      ['meters', 'keygrant licenses meters <key>'],
      ['uses', 'keygrant licenses uses <key> <meter> (--add <n> | --set <n> | --offline <n|default> | --reset) [--idempotency-key <key>]'],
      ['use', 'keygrant licenses use <key> <meter> [n] [--id <id>]'],
    ]) {
      const res = await harness().run('licenses', name as string, '--help')
      expect(res.out).toContain(`Usage: ${usage}`)
    }
  })
})
