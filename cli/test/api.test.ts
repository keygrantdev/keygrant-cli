import { describe, expect, it } from 'vitest'
import { apiOrigin, DEFAULT_API_URL, MAX_RETRY_WAIT_S, retryWait } from '../src/api.js'
import { CliError, EXIT } from '../src/errors.js'
import { VERSION } from '../src/version.js'
import { harness, license, LIVE_KEY, MemoryStore, request, TEST_KEY } from './harness.js'

const KEY = 'SLUICE-AAAA-BBBB-CCCC-DDDD'
const ok = { status: 200, body: { license: license() } }

describe('where KeyGrant is', () => {
  it('is the production API unless told, an https URL, or a worker on this machine over http', () => {
    expect(apiOrigin(undefined)).toBe(DEFAULT_API_URL)
    expect(apiOrigin(' ')).toBe(DEFAULT_API_URL)
    expect(apiOrigin('https://api.example.test/some/path')).toBe('https://api.example.test')
    for (const local of ['http://localhost:4660', 'http://127.0.0.1:4660', 'http://[::1]:4660']) {
      expect(apiOrigin(local)).toBe(new URL(local).origin)
    }
  })

  it('never sends a key in the clear across a network, and says what it cannot read', () => {
    const refused = (raw: string) => {
      try {
        apiOrigin(raw)
      } catch (error) {
        return [(error as CliError).exit, (error as CliError).message]
      }
      return null
    }
    expect(refused('http://api.keygrant.dev')).toEqual([EXIT.usage, 'the API URL must be https:// (http:// only for localhost, 127.0.0.1 or [::1]), not "http://api.keygrant.dev"'])
    expect(refused('ftp://localhost')?.[0]).toBe(EXIT.usage)
    // A name under .localhost is whatever a resolver answers: no key goes there in the clear.
    expect(refused('http://api.keygrant.localhost')?.[0]).toBe(EXIT.usage)
    expect(refused('not a url')).toEqual([EXIT.usage, 'the API URL "not a url" is not a URL'])
  })

  it('takes --api-url over KEYGRANT_API_URL, and the variable over the default', async () => {
    const h = harness({ env: { KEYGRANT_API_KEY: LIVE_KEY, KEYGRANT_API_URL: 'http://localhost:4660' }, answers: [ok, ok] })
    await h.run('licenses', 'get', KEY)
    await h.run('licenses', 'get', KEY, '--api-url', 'https://staging.example.test')
    expect(h.calls.map((c) => c.url)).toEqual([`http://localhost:4660/v1/licenses/${KEY}`, `https://staging.example.test/v1/licenses/${KEY}`])
  })
})

describe('the API key', () => {
  it('is KEYGRANT_API_KEY when set, before a kept one, sent as a bearer token with the CLI named', async () => {
    const store = new MemoryStore()
    store.kept.set(DEFAULT_API_URL, TEST_KEY)
    const h = harness({ env: { KEYGRANT_API_KEY: ` ${LIVE_KEY} ` }, store, answers: [ok] })
    expect((await h.run('licenses', 'get', KEY)).code).toBe(EXIT.ok)
    expect(h.calls[0]?.headers).toEqual({ accept: 'application/json', 'user-agent': `keygrant-cli/${VERSION}`, authorization: `Bearer ${LIVE_KEY}` })
    // Every request carries a timeout, so none waits on KeyGrant for ever.
    expect(h.calls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(h.calls[0]?.signal?.aborted).toBe(false)
  })

  it('is the key kept for this address otherwise', async () => {
    const store = new MemoryStore()
    store.kept.set('http://localhost:4660', TEST_KEY)
    const h = harness({ env: {}, store, answers: [ok] })
    await h.run('licenses', 'get', KEY, '--api-url', 'http://localhost:4660')
    expect(h.calls[0]?.headers.authorization).toBe(`Bearer ${TEST_KEY}`)
  })

  it('is exit 3 when there is none, saying how to give one: only the variable where the store cannot be used', async () => {
    const none = await harness({ env: {} }).run('licenses', 'get', KEY)
    expect(none).toEqual({ code: EXIT.auth, out: '', err: 'keygrant: no API key: set KEYGRANT_API_KEY, or run `keygrant login`' })
    const local = await harness({ env: { KEYGRANT_API_URL: 'http://localhost:4660' } }).run('licenses', 'get', KEY)
    expect(local.err).toBe('keygrant: no API key for http://localhost:4660: set KEYGRANT_API_KEY, or run `keygrant login`')
    const noStore = await harness({ env: {}, store: new MemoryStore('no session bus') }).run('licenses', 'get', KEY)
    expect(noStore.err).toBe('keygrant: no API key: set KEYGRANT_API_KEY (the test keyring cannot be used here: no session bus)')
    const json = await harness({ env: {} }).run('licenses', 'get', KEY, '--json')
    expect(JSON.parse(json.err)).toEqual({ error: 'no-api-key' })
  })

  it('refuses a kept entry that is no KeyGrant secret key, before sending it anywhere, and trims one that is', async () => {
    const store = new MemoryStore()
    store.kept.set(DEFAULT_API_URL, 'kg_live_ab\r\nX-Injected: 1')
    const bad = harness({ env: {}, store })
    expect(await bad.run('licenses', 'get', KEY)).toEqual({ code: EXIT.auth, out: '', err: 'keygrant: the API key kept is not a KeyGrant secret key: run `keygrant login` again' })
    expect(bad.calls).toEqual([])
    store.kept.set(DEFAULT_API_URL, ` ${LIVE_KEY}\n`)
    const padded = harness({ env: {}, store, answers: [ok] })
    await padded.run('licenses', 'get', KEY)
    expect(padded.calls[0]?.headers.authorization).toBe(`Bearer ${LIVE_KEY}`)
  })

  it('refuses a variable that is no KeyGrant secret key, before sending it anywhere', async () => {
    const h = harness({ env: { KEYGRANT_API_KEY: 'sk_live_stripe' } })
    expect(await h.run('licenses', 'get', KEY)).toEqual({ code: EXIT.auth, out: '', err: 'keygrant: KEYGRANT_API_KEY is not a KeyGrant secret key (kg_live_... or kg_test_...)' })
    expect(h.calls).toEqual([])
  })
})

describe('an answer that is not a license', () => {
  it('names the API reason and exits by its kind: 1 refused, 3 a key refused, 5 KeyGrant failing', async () => {
    const cases: [number, unknown, number, string][] = [
      [404, { error: 'unknown-license' }, EXIT.refused, 'unknown-license: no license of yours has that key (a kg_test_ key reaches test licenses only)'],
      [401, { error: 'unauthorized' }, EXIT.auth, 'unauthorized: KeyGrant did not accept the API key. Check KEYGRANT_API_KEY, or run `keygrant login` again'],
      [409, { error: 'brand-new-code' }, EXIT.refused, 'brand-new-code: KeyGrant refused the request (HTTP 409)'],
      [503, { error: 'unavailable' }, EXIT.unavailable, 'unavailable: KeyGrant failed (HTTP 503): try again shortly'],
    ]
    for (const [status, body, exit, said] of cases) {
      expect(await harness({ answers: [{ status, body }] }).run('licenses', 'get', KEY)).toEqual({ code: exit, out: '', err: `keygrant: ${said}` })
    }
  })

  it('words a plan limit and an entitlement of another type from what the body carries', async () => {
    const said = async (body: Record<string, unknown>, status = 402) => (await harness({ answers: [{ status, body }] }).run('licenses', 'get', KEY)).err
    expect(await said({ error: 'plan-limit', dimension: 'active_licenses', limit: 100, usage: 100, plan: 'free' })).toBe(
      "keygrant: plan-limit: this would take the account past its plan's limit (100 of 100 active licenses on free)",
    )
    expect(await said({ error: 'plan-limit' })).toBe("keygrant: plan-limit: this would take the account past its plan's limit (? of ? licenses on its plan)")
    expect(await said({ error: 'entitlement-type', entitlement: 'seats' }, 400)).toBe(
      'keygrant: entitlement-type: the entitlement "seats" is of another type in the product\'s catalog',
    )
  })

  it('words each code it knows in a sentence of its own, never the fallback', async () => {
    const codes = [
      'invalid-request', 'invalid-json', 'invalid-versions', 'unknown-license', 'unknown-product', 'unknown-model', 'unknown-checkout',
      'checkout-upgraded', 'checkout-held', 'checkout-refunded', 'product-disabled', 'not-expiring', 'term-not-started', 'license-revoked',
      'test-ceiling-reached', 'idempotency-key-reused', 'edition-upgrade-model', 'device-upgrade-model', 'term-required', 'term-ended',
      'unknown-entitlement', 'mint-failed', 'not-a-file-license', 'no-licensee', 'license-expires',
    ]
    const seen = new Set<string>()
    for (const code of codes) {
      const err = (await harness({ answers: [{ status: 409, body: { error: code } }] }).run('licenses', 'get', KEY)).err
      expect(err.startsWith(`keygrant: ${code}: `), code).toBe(true)
      expect(err, code).not.toContain('KeyGrant refused the request (HTTP')
      seen.add(err.slice(`keygrant: ${code}: `.length))
    }
    // No two codes share a sentence.
    expect(seen.size).toBe(codes.length)
  })

  it('prints the API body, with its status, as JSON on standard error under --json', async () => {
    const res = await harness({ answers: [{ status: 402, body: { error: 'test-limit', limit: 25, usage: 25 } }] }).run('licenses', 'get', KEY, '--json')
    expect(res.code).toBe(EXIT.refused)
    expect(res.out).toBe('')
    expect(JSON.parse(res.err)).toEqual({ error: 'test-limit', limit: 25, usage: 25, status: 402 })
  })

  it('reads a page that is not JSON: a refusal as its status, a failure as KeyGrant failing', async () => {
    const page = (status: number) => new Response('<html>nope</html>', { status, headers: { 'content-type': 'text/html' } })
    expect(await harness({ answers: [page(403)] }).run('licenses', 'get', KEY)).toMatchObject({ code: EXIT.refused, err: 'keygrant: http-403: KeyGrant refused the request (HTTP 403)' })
    expect(await harness({ answers: [page(502)] }).run('licenses', 'get', KEY)).toMatchObject({
      code: EXIT.unavailable,
      err: `keygrant: ${DEFAULT_API_URL} answered HTTP 502 with something that is not KeyGrant's JSON`,
    })
    expect(await harness({ answers: [page(200)] }).run('licenses', 'get', KEY)).toEqual({
      code: EXIT.unavailable,
      out: '',
      err: `keygrant: ${DEFAULT_API_URL} answered HTTP 200 with something that is not KeyGrant's JSON`,
    })
  })

  it('is exit 5 when KeyGrant cannot be reached', async () => {
    const res = await harness({ answers: [new TypeError('fetch failed')] }).run('licenses', 'get', KEY)
    expect(res).toEqual({ code: EXIT.unavailable, out: '', err: `keygrant: could not reach KeyGrant at ${DEFAULT_API_URL}: fetch failed` })
  })
})

describe('a 429', () => {
  const limited = (headers: Record<string, string> = {}, body: unknown = { error: 'rate-limited', retryAfter: 60 }) => ({ status: 429, body, headers })

  it('is waited out once, as long as it says, saying so, then the call is made again', async () => {
    const h = harness({ answers: [limited(), ok] })
    const res = await h.run('licenses', 'get', KEY)
    expect(res.code).toBe(EXIT.ok)
    expect(res.err).toBe('Rate limited by KeyGrant (429): waiting 60 s, then trying once more.')
    expect(h.sleeps).toEqual([60_000])
    expect(h.calls).toHaveLength(2)
    expect(request(h.calls[1])).toEqual(request(h.calls[0]))
  })

  it('is exit 4 the second time, naming the wait', async () => {
    const h = harness({ answers: [limited(), limited()] })
    expect(await h.run('licenses', 'get', KEY)).toEqual({
      code: EXIT.rateLimited,
      out: '',
      err: 'Rate limited by KeyGrant (429): waiting 60 s, then trying once more.\nkeygrant: rate-limited: too many requests: try again in 60 seconds',
    })
  })

  it('is exit 4 at once under --no-retry, the wait read from Retry-After when the body has none', async () => {
    const h = harness({ answers: [limited({ 'retry-after': '30' }, { error: 'rate-limited' })] })
    const res = await h.run('licenses', 'get', KEY, '--no-retry', '--json')
    expect(res.code).toBe(EXIT.rateLimited)
    expect(JSON.parse(res.err)).toEqual({ error: 'rate-limited', retryAfter: 30, status: 429 })
    expect(h.sleeps).toEqual([])
  })

  it('waits what it says, else Retry-After, else a minute, and not at all past two minutes', () => {
    expect(retryWait({ retryAfter: 12.2 }, '30')).toBe(13)
    expect(retryWait({}, '30')).toBe(30)
    expect(retryWait({}, 'Wed, 21 Oct 2026 07:28:00 GMT')).toBe(60)
    expect(retryWait({}, null)).toBe(60)
    expect(retryWait({ retryAfter: 0 }, null)).toBe(60)
    expect(retryWait({ retryAfter: MAX_RETRY_WAIT_S }, null)).toBe(MAX_RETRY_WAIT_S)
    expect(retryWait({ retryAfter: MAX_RETRY_WAIT_S + 1 }, null)).toBeNull()
    expect(retryWait({}, '3600')).toBeNull()
  })

  it('is exit 4 at once, waiting nothing, when it asks for longer than two minutes', async () => {
    const h = harness({ answers: [limited({}, { error: 'rate-limited', retryAfter: 86_000 })] })
    expect(await h.run('licenses', 'get', KEY)).toEqual({ code: EXIT.rateLimited, out: '', err: 'keygrant: rate-limited: too many requests: try again in 86,000 seconds' })
    expect(h.sleeps).toEqual([])
    expect(h.calls).toHaveLength(1)
  })

  it('says nothing of its wait under --json, whose standard error is the one JSON error', async () => {
    const h = harness({ answers: [limited(), limited()] })
    const res = await h.run('licenses', 'get', KEY, '--json')
    expect(h.sleeps).toEqual([60_000])
    expect(JSON.parse(res.err)).toEqual({ error: 'rate-limited', retryAfter: 60, status: 429 })
  })

  it('is retried after a page that is not JSON too, by its Retry-After', async () => {
    const page = new Response('Too many requests', { status: 429, headers: { 'retry-after': '5' } })
    const h = harness({ answers: [page, ok] })
    expect((await h.run('licenses', 'get', KEY)).code).toBe(EXIT.ok)
    expect(h.sleeps).toEqual([5000])
  })
})
