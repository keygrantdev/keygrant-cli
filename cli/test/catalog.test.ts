import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/errors.js'
import { harness, license, TEST_KEY } from './harness.js'

const model = (overrides: Record<string, unknown>) => ({
  id: 'mod_annual',
  name: 'Annual',
  type: 'subscription',
  archived: false,
  deviceLimit: 3,
  entitlements: {},
  upgradesExisting: false,
  addsDevices: 0,
  termLength: null,
  termUnit: null,
  endsAt: null,
  ...overrides,
})

const PRODUCTS = {
  products: [
    {
      slug: 'sluice',
      name: 'Sluice',
      keyPrefix: 'SLUICE',
      currentMajor: 3,
      archived: false,
      models: [
        model({ entitlements: { edition: 'pro' } }),
        model({ id: 'mod_pass', name: 'Pass', type: 'timed', termLength: 30, termUnit: 'days' }),
        model({ id: 'mod_year', name: 'Year', type: 'timed', termLength: 1, termUnit: 'months' }),
        model({ id: 'mod_event', name: 'Event', type: 'timed', endsAt: Date.UTC(2027, 2, 31, 23, 59, 59, 999) }),
        model({ id: 'mod_pro', name: 'Pro upgrade', type: 'perpetual', upgradesExisting: true, archived: true }),
        model({ id: 'mod_seats', name: 'Two more', type: 'perpetual', upgradesExisting: true, addsDevices: 2 }),
      ],
    },
    { slug: 'atlas', name: 'Atlas', keyPrefix: 'ATLAS', currentMajor: 1, archived: true, models: [] },
  ],
}

describe('keygrant products', () => {
  it('lists each product with its models, what each sells, and their ids', async () => {
    const h = harness({ answers: [{ status: 200, body: PRODUCTS }] })
    const res = await h.run('products')
    expect(h.calls[0]).toMatchObject({ method: 'GET', url: 'https://api.keygrant.dev/v1/products' })
    expect(res.out).toBe(
      [
        'sluice  Sluice  (keys SLUICE-..., current version 3)',
        '  MODEL       NAME         SELLS                 DEVICES  ENTITLEMENTS',
        '  mod_annual  Annual       subscription          3        edition=pro',
        '  mod_pass    Pass         timed, 30 days        3        none',
        '  mod_year    Year         timed, 1 month        3        none',
        '  mod_event   Event        timed, to 2027-03-31  3        none',
        '  mod_pro     Pro upgrade  perpetual upgrade     3        none          archived',
        '  mod_seats   Two more     device upgrade        3        none',
        '',
        'atlas  Atlas  (keys ATLAS-..., current version 1, archived)',
        '  no license models',
      ].join('\n'),
    )
  })

  it('shows one product with --product, prints the API answer under --json, and says when there are none', async () => {
    const one = await harness({ answers: [{ status: 200, body: PRODUCTS }] }).run('products', '--product', 'atlas', '--json')
    expect(JSON.parse(one.out)).toEqual({ products: [PRODUCTS.products[1]] })
    const all = await harness({ answers: [{ status: 200, body: PRODUCTS }] }).run('products', '--json')
    expect(JSON.parse(all.out)).toEqual(PRODUCTS)
    const missing = await harness({ answers: [{ status: 200, body: PRODUCTS }] }).run('products', '--product', 'nope')
    expect(missing).toMatchObject({ code: EXIT.refused, err: 'keygrant: unknown-product: no product of yours has the API ID "nope"' })
    expect((await harness({ answers: [{ status: 200, body: { products: [] } }] }).run('products')).out).toBe('No products yet: make one on the dashboard.')
  })
})

describe('keygrant products, for a product that counts uses', () => {
  const metered = {
    products: [
      {
        slug: 'render',
        name: 'Render',
        keyPrefix: 'RENDER',
        currentMajor: 2,
        archived: false,
        meters: [
          { code: 'exports', name: 'Exports', description: null },
          { code: 'renders', name: 'Cloud renders', description: 'Rendered on our servers' },
        ],
        models: [
          model({ id: 'mod_free', name: 'Free', type: 'trial' }),
          model({ id: 'mod_pack', name: 'Pack', type: 'perpetual', meters: [{ code: 'exports', uses: 1000, resets: 'never', offline: null }] }),
          model({
            id: 'mod_monthly',
            name: 'Monthly',
            type: 'subscription',
            meters: [
              { code: 'exports', uses: 1000000, resets: 'never', offline: 0 },
              { code: 'renders', uses: 50, resets: 'period', offline: 5 },
            ],
          }),
          model({ id: 'mod_more', name: 'More exports', type: 'perpetual', upgradesExisting: true, addsUses: { exports: 500, renders: 10 } }),
        ],
      },
      { slug: 'plain', name: 'Plain', keyPrefix: 'PLAIN', currentMajor: 1, archived: false, meters: [], models: [model({ id: 'mod_one', name: 'One', meters: [], addsUses: {} })] },
    ],
  }

  it('lists the meters its apps spend, what each model counts and the uses a top-up adds, and the column only where a model counts', async () => {
    const h = harness({ answers: [{ status: 200, body: metered }] })
    const res = await h.run('products')
    expect(res.out).toBe(
      [
        'render  Render  (keys RENDER-..., current version 2)',
        '  meters: exports (Exports), renders (Cloud renders)',
        '  MODEL        NAME          SELLS         DEVICES  ENTITLEMENTS  METERS',
        '  mod_free     Free          trial         3        none',
        '  mod_pack     Pack          perpetual     3        none          exports 1,000',
        '  mod_monthly  Monthly       subscription  3        none          exports 1,000,000 (offline 0); renders 50 a period (offline 5)',
        '  mod_more     More exports  uses upgrade  3        none          +500 exports; +10 renders',
        '',
        'plain  Plain  (keys PLAIN-..., current version 1)',
        '  MODEL    NAME  SELLS         DEVICES  ENTITLEMENTS',
        '  mod_one  One   subscription  3        none',
      ].join('\n'),
    )
  })

  it('calls a model that adds uses a uses upgrade, and a product with meters but no models says so', async () => {
    const body = {
      products: [
        {
          slug: 'render',
          name: 'Render',
          keyPrefix: 'RENDER',
          currentMajor: 2,
          archived: false,
          meters: [{ code: 'exports', name: 'Exports', description: null }],
          models: [model({ id: 'mod_more', name: 'More', type: 'perpetual', upgradesExisting: true, addsUses: { exports: 500 } })],
        },
        { slug: 'empty', name: 'Empty', keyPrefix: 'EMPTY', currentMajor: 1, archived: false, meters: [{ code: 'x', name: 'X', description: null }], models: [] },
      ],
    }
    const res = await harness({ answers: [{ status: 200, body }] }).run('products')
    expect(res.out).toContain('mod_more  More  uses upgrade  3        none          +500 exports')
    expect(res.out).toContain('empty  Empty  (keys EMPTY-..., current version 1)\n  meters: x (X)\n  no license models')
  })

  it('lists a meter with no allowance of its own as its uses alone, and calls a device upgrade that also adds uses a device upgrade', async () => {
    const body = {
      products: [
        {
          ...metered.products[0],
          models: [
            model({ id: 'mod_both', name: 'Both', meters: [{ code: 'exports', uses: 10, resets: 'never' }] }),
            model({ id: 'mod_dev', name: 'Devices', type: 'perpetual', upgradesExisting: true, addsDevices: 2, addsUses: { exports: 1 } }),
          ],
        },
      ],
    }
    const res = await harness({ answers: [{ status: 200, body }] }).run('products')
    expect(res.out).toContain('mod_both  Both     subscription    3        none          exports 10')
    expect(res.out).toContain('mod_dev   Devices  device upgrade  3        none          +1 exports')
  })

  it('prints the API answer under --json, and takes a meter it cannot read for something other than KeyGrant', async () => {
    const json = await harness({ answers: [{ status: 200, body: metered }] }).run('products', '--json')
    expect(JSON.parse(json.out)).toEqual(metered)
    const odd = [
      { meters: 'exports' },
      { meters: [{ code: 'exports' }] },
      { models: [model({ meters: [{ code: 'exports', uses: '5', resets: 'never', offline: null }] })] },
      { models: [model({ meters: [{ code: 'exports', uses: 5, resets: 5, offline: null }] })] },
      { models: [model({ meters: [{ code: 'exports', uses: 5, resets: 'never', offline: -1 }] })] },
      { models: [model({ addsUses: { exports: 'a lot' } })] },
      { models: [model({ addsUses: [500] })] },
      { models: [model({ meters: 'exports' })] },
      { models: [model({ meters: [{ uses: 5, resets: 'never', offline: null }] })] },
      { meters: [{ code: 5, name: 'Exports' }] },
    ]
    for (const change of odd) {
      const body = { products: [{ ...metered.products[0], ...change }] }
      const res = await harness({ answers: [{ status: 200, body }] }).run('products')
      expect([change, res.code]).toEqual([change, EXIT.unavailable])
    }
  })
})

describe('keygrant licenses test', () => {
  it('makes a valid test license unless told, with an idempotency key, and prints the key then the license', async () => {
    const made = { key: 'SLUICE-TEST-AAAA-BBBB-CCCC', scenario: 'valid', license: license({ key: 'SLUICE-TEST-AAAA-BBBB-CCCC', test: true }) }
    const h = harness({ env: { KEYGRANT_API_KEY: TEST_KEY }, answers: [{ status: 201, body: made }] })
    const res = await h.run('licenses', 'test', '--product', 'sluice')
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.keygrant.dev/v1/test-licenses',
      headers: { 'idempotency-key': 'cli-run-1', authorization: `Bearer ${TEST_KEY}` },
      body: { product: 'sluice', scenario: 'valid' },
    })
    expect(res.out.split('\n')[0]).toBe('SLUICE-TEST-AAAA-BBBB-CCCC')
    expect(res.out).toContain('State         active, test license')
  })

  it('takes a scenario, a model and a version, and prints the API answer under --json', async () => {
    const made = { key: 'K', scenario: 'device-limit', license: license() }
    const h = harness({ answers: [{ status: 201, body: made }] })
    const res = await h.run('licenses', 'test', '--product', 'sluice', '--scenario', 'device-limit', '--model', 'mod_annual', '--version', '3', '--json')
    expect(h.calls[0]?.body).toEqual({ product: 'sluice', scenario: 'device-limit', modelId: 'mod_annual', version: '3' })
    expect(JSON.parse(res.out)).toEqual(made)
  })

  it('names the idempotency key it made when the test license may have been made all the same', async () => {
    const h = harness({ answers: [{ status: 503, body: { error: 'unavailable' } }] })
    const res = await h.run('licenses', 'test', '--product', 'sluice', '--json')
    expect(res.code).toBe(EXIT.unavailable)
    expect(JSON.parse(res.err)).toEqual({ error: 'unavailable', status: 503, idempotencyKey: 'cli-run-1' })
    expect(h.calls).toHaveLength(1)
  })

  it('refuses a scenario it does not know, or no product, and passes on the account at its test licenses', async () => {
    expect((await harness().run('licenses', 'test', '--product', 'sluice', '--scenario', 'broken')).err).toContain(
      '--scenario must be one of valid, trial-ending, expired, revoked, device-limit',
    )
    expect((await harness().run('licenses', 'test')).err).toContain('--product is required')
    const trial = harness()
    expect((await trial.run('licenses', 'test', '--product', 'sluice', '--scenario', 'trial-ending', '--model', 'mod_annual')).err).toContain(
      "--model does not apply to trial-ending, which takes the product's trial model",
    )
    expect(trial.calls).toEqual([])
    const full = await harness({ answers: [{ status: 402, body: { error: 'test-limit', limit: 25, usage: 25 } }] }).run('licenses', 'test', '--product', 'sluice')
    expect(full).toMatchObject({ code: EXIT.refused, err: 'keygrant: test-limit: the account already holds 25 of its 25 active test licenses' })
  })
})

describe('keygrant release', () => {
  it('reports the version shipped and prints where the product now is', async () => {
    const h = harness({ answers: [{ status: 200, body: { product: 'sluice', currentMajor: 2 } }] })
    const res = await h.run('release', '2.4.0', '--product', 'sluice')
    expect(h.calls[0]).toMatchObject({ method: 'POST', url: 'https://api.keygrant.dev/v1/products/sluice/releases', body: { version: '2.4.0' } })
    expect(res).toEqual({ code: EXIT.ok, out: 'sluice is at version 2.', err: '' })
  })

  it('needs a product, a version and a live key, and passes on an unknown product', async () => {
    expect((await harness().run('release', '2.4.0')).err).toContain('--product is required')
    expect((await harness().run('release', '--product', 'sluice')).err).toContain('missing the version')
    const withTestKey = harness({ env: { KEYGRANT_API_KEY: TEST_KEY } })
    expect(await withTestKey.run('release', '2', '--product', 'sluice')).toEqual({
      code: EXIT.auth,
      out: '',
      err: "keygrant: a release needs a kg_live_ key: a kg_test_ key reaches no product's current version",
    })
    expect(withTestKey.calls).toEqual([])
    const unknown = await harness({ answers: [{ status: 404, body: { error: 'unknown-product' } }] }).run('release', '2', '--product', 'sluice')
    expect(unknown).toMatchObject({ code: EXIT.refused, err: 'keygrant: unknown-product: no product of yours has that API ID' })
  })
})
