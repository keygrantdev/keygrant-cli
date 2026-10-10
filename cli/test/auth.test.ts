import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { StoreUnavailable } from '../src/deps.js'
import { harness, LIVE_KEY, MemoryStore, TEST_KEY } from './harness.js'

const PRODUCTS = { status: 200, body: { products: [{ slug: 'sluice', models: [] }, { slug: 'atlas', models: [] }] } }

describe('keygrant login', () => {
  it('asks a person for the key without echoing it, checks it with KeyGrant, and keeps it for that address', async () => {
    const h = harness({ env: {}, terminal: true, typed: ` ${LIVE_KEY} `, answers: [PRODUCTS] })
    const res = await h.run('login')
    expect(h.prompts).toEqual(['API key (kg_live_... or kg_test_...): '])
    expect(h.calls[0]).toMatchObject({ method: 'GET', url: 'https://api.keygrant.dev/v1/products', headers: { authorization: `Bearer ${LIVE_KEY}` } })
    expect(h.store.kept).toEqual(new Map([['https://api.keygrant.dev', LIVE_KEY]]))
    expect(res).toEqual({
      code: EXIT.ok,
      out: 'Signed in to https://api.keygrant.dev with a live key (kg_live_a1a1...), kept in the test keyring. The account has 2 products.',
      err: '',
    })
  })

  it('reads the key from standard input in a pipe, keeps a local worker\'s apart, and says so as JSON', async () => {
    const store = new MemoryStore()
    store.kept.set('https://api.keygrant.dev', LIVE_KEY)
    const h = harness({ env: { KEYGRANT_API_URL: 'http://localhost:4660' }, stdin: `${TEST_KEY}\n`, store, answers: [{ status: 200, body: { products: [{ slug: 'sluice', models: [] }] } }] })
    const res = await h.run('login', '--json')
    expect(JSON.parse(res.out)).toEqual({ origin: 'http://localhost:4660', mode: 'test', key: 'kg_test_b2b2...', store: 'the test keyring', products: 1, envKeyUsedFirst: false })
    expect(store.kept.get('http://localhost:4660')).toBe(TEST_KEY)
    expect(store.kept.get('https://api.keygrant.dev')).toBe(LIVE_KEY)
  })

  it('notes that KEYGRANT_API_KEY, when set, comes first', async () => {
    const h = harness({ env: { KEYGRANT_API_KEY: TEST_KEY }, stdin: LIVE_KEY, answers: [PRODUCTS] })
    const res = await h.run('login')
    expect(res.err).toBe('Note: KEYGRANT_API_KEY is set here, and is used before the kept key.')
    // The key given is the one checked and kept, never the variable's.
    expect(h.calls[0]?.headers.authorization).toBe(`Bearer ${LIVE_KEY}`)
    expect(h.store.kept.get('https://api.keygrant.dev')).toBe(LIVE_KEY)
    const json = await harness({ env: { KEYGRANT_API_KEY: TEST_KEY }, stdin: LIVE_KEY, answers: [PRODUCTS] }).run('login', '--json')
    expect(json.err).toBe('')
    expect(JSON.parse(json.out)).toMatchObject({ envKeyUsedFirst: true })
  })

  it('keeps nothing for a key KeyGrant refuses, or that is no secret key at all', async () => {
    const refused = harness({ env: {}, stdin: LIVE_KEY, answers: [{ status: 401, body: { error: 'unauthorized' } }] })
    expect(await refused.run('login')).toEqual({ code: EXIT.auth, out: '', err: 'keygrant: unauthorized: KeyGrant did not accept the API key. Check KEYGRANT_API_KEY, or run `keygrant login` again' })
    expect(refused.store.kept.size).toBe(0)
    const publishable = harness({ env: {}, stdin: 'pk_live_123' })
    expect(await publishable.run('login')).toEqual({ code: EXIT.auth, out: '', err: 'keygrant: that is not a KeyGrant secret key (kg_live_... or kg_test_...)' })
    expect(publishable.calls).toEqual([])
    expect((await harness({ env: {}, stdin: '\n' }).run('login')).err).toBe('keygrant: no API key given')
  })

  it('says at once, before asking for anything, where there is no credential store, and what to do instead', async () => {
    const h = harness({ env: {}, terminal: true, typed: LIVE_KEY, store: new MemoryStore('no D-Bus session') })
    const res = await h.run('login')
    expect(res).toEqual({
      code: EXIT.auth,
      out: '',
      err: 'keygrant: there is no credential store to keep the key in here (no D-Bus session). Set KEYGRANT_API_KEY in this environment instead, as a build pipeline does; nothing was kept',
    })
    expect(h.prompts).toEqual([])
    expect(h.calls).toEqual([])
    const json = await harness({ env: {}, store: new MemoryStore('no D-Bus session') }).run('login', '--json')
    expect(JSON.parse(json.err)).toEqual({ error: 'no-credential-store', message: 'no D-Bus session', store: 'the test keyring' })
  })
})

describe('keygrant login, when the key checks out but cannot be kept', () => {
  it('is exit 3 naming the missing store, after one check, keeping nothing', async () => {
    const store = new MemoryStore(null, new StoreUnavailable('the keyring is locked'))
    const h = harness({ env: {}, stdin: LIVE_KEY, store, answers: [PRODUCTS] })
    const res = await h.run('login', '--json')
    expect(res.code).toBe(EXIT.auth)
    expect(JSON.parse(res.err)).toEqual({ error: 'no-credential-store', message: 'the keyring is locked', store: 'the test keyring' })
    expect(h.calls).toHaveLength(1)
    expect(store.kept.size).toBe(0)
  })

  it('reports any other fault of the store as unexpected, exit 1', async () => {
    const store = new MemoryStore(null, new Error('access denied'))
    const res = await harness({ env: {}, stdin: LIVE_KEY, store, answers: [PRODUCTS] }).run('login')
    expect(res).toEqual({ code: EXIT.refused, out: '', err: 'keygrant: unexpected error: access denied' })
  })

  it('keeps nothing when the check answers something that is not KeyGrant\'s, exit 5', async () => {
    const h = harness({ env: {}, stdin: LIVE_KEY, answers: [{ status: 200, body: { products: 'none' } }] })
    expect((await h.run('login')).code).toBe(EXIT.unavailable)
    expect(h.store.kept.size).toBe(0)
  })
})

describe('keygrant logout', () => {
  it('removes the key kept for this address, and says when there was none', async () => {
    const store = new MemoryStore()
    store.kept.set('https://api.keygrant.dev', LIVE_KEY)
    const h = harness({ env: {}, store })
    expect((await h.run('logout')).out).toBe('Removed the key kept for https://api.keygrant.dev.')
    expect(store.kept.size).toBe(0)
    expect(JSON.parse((await h.run('logout', '--json')).out)).toEqual({ origin: 'https://api.keygrant.dev', removed: false })
    expect((await h.run('logout')).out).toBe('No key was kept for https://api.keygrant.dev.')
  })

  it('is exit 3 where there is no credential store', async () => {
    const res = await harness({ env: {}, store: new MemoryStore('locked') }).run('logout', '--json')
    expect(res.code).toBe(EXIT.auth)
    expect(JSON.parse(res.err)).toEqual({ error: 'no-credential-store', message: 'locked', store: 'the test keyring' })
  })
})
