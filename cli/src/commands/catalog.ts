import { usage, value } from '../args.js'
import { answers, request, secretKey } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { CliError, EXIT } from '../errors.js'
import { entitlementsText, table } from '../output.js'
import { idempotencyKeyOf, minting } from './licenses-write.js'
import { licenseBlock, termText, type License } from './license-view.js'

/** A license model as `GET /v1/products` answers it (only what the CLI prints is named). */
interface Model {
  id: string
  name: string
  type: string
  archived: boolean
  deviceLimit: number
  entitlements: Record<string, unknown>
  upgradesExisting: boolean
  addsDevices: number
  termLength: number | null
  termUnit: 'days' | 'months' | null
  endsAt: number | null
}

interface Product {
  slug: string
  name: string
  keyPrefix: string
  currentMajor: number
  archived: boolean
  models: Model[]
}

/** What a model sells, in a word or two: its type, and what makes it more than that. */
function modelKind(m: Model): string {
  if (m.addsDevices > 0) return 'device upgrade'
  if (m.upgradesExisting) return `${m.type} upgrade`
  if (m.type === 'timed' && m.termLength && m.termUnit) {
    return `timed, ${termText(m.termUnit === 'months' ? { months: m.termLength, days: 0 } : { months: 0, days: m.termLength })}`
  }
  if (m.type === 'timed' && m.endsAt) return `timed, to ${new Date(m.endsAt).toISOString().slice(0, 10)}`
  return m.type
}

export const products: Command = {
  name: 'products',
  summary: 'List your products and their license models.',
  help: `keygrant products [--product <id>]

  --product <id>   one product, by its API ID

Prints each product (its API ID, key prefix and current version) with its license models'
ids, which --model takes. --json prints the API's answer, { "products": [ ... ] }, with --product
only that product in it.`,
  options: { product: { type: 'value' } },
  async run(ctx, args) {
    positionals(args)
    const body = await request(ctx, 'GET', '/v1/products', { key: await secretKey(ctx), expect: answers.products })
    const only = value(args, 'product')
    const all = body.products as Product[]
    const shown = only === undefined ? all : all.filter((p) => p.slug === only)
    if (only !== undefined && shown.length === 0) throw new CliError(EXIT.refused, `unknown-product: no product of yours has the API ID "${only}"`, { error: 'unknown-product' })
    emit(ctx, only === undefined ? body : { products: shown }, () => {
      if (shown.length === 0) return 'No products yet: make one on the dashboard.'
      return shown
        .map((p) => {
          const head = `${p.slug}  ${p.name}  (keys ${p.keyPrefix}-..., current version ${p.currentMajor}${p.archived ? ', archived' : ''})`
          if (!p.models.length) return `${head}\n  no license models`
          const rows = p.models.map((m) => [m.id, m.name, modelKind(m), String(m.deviceLimit), entitlementsText(m.entitlements), m.archived ? 'archived' : ''])
          return `${head}\n${table(['MODEL', 'NAME', 'SELLS', 'DEVICES', 'ENTITLEMENTS', ''], rows).replace(/^/gm, '  ')}`
        })
        .join('\n\n')
    })
  },
}

const SCENARIOS = ['valid', 'trial-ending', 'expired', 'revoked', 'device-limit']

export const testLicense: Command = {
  name: 'licenses test',
  summary: 'Make a test license in a state your app must handle.',
  help: `keygrant licenses test --product <id> [--scenario <state>] [--model <model id>] [--version <version>]
                       [--idempotency-key <key>]

  --scenario <state>       valid (the default), trial-ending, expired, revoked or device-limit
  --model <model id>       its license model, else the product's first that issues keys (trial-ending
                           always takes the product's trial model)
  --version <version>      the version it is for; else its first activation's
  --idempotency-key <key>  the same key on a retry answers the license first made

As the dashboard's Create test license: signed with the product's real key and marked as a
test, so it works in the build you ship; it lasts 30 days at most, is never emailed, and your
account holds 25 at once. device-limit fills its one seat, so your machine is refused.
Prints the key on its first line, then the license. --json prints the API's answer,
{ "key", "scenario", "license" }.`,
  options: {
    product: { type: 'value' },
    scenario: { type: 'value' },
    model: { type: 'value' },
    version: { type: 'value' },
    'idempotency-key': { type: 'value' },
  },
  async run(ctx, args) {
    positionals(args)
    const product = value(args, 'product')
    if (!product) throw usage('--product is required')
    const scenario = value(args, 'scenario') ?? 'valid'
    if (!SCENARIOS.includes(scenario)) throw usage(`--scenario must be one of ${SCENARIOS.join(', ')}`)
    const body: Record<string, unknown> = { product, scenario }
    const model = value(args, 'model')
    // A trial ending is a trial whatever model is named: the product's trial model, else the bare type.
    if (model !== undefined && scenario === 'trial-ending') throw usage("--model does not apply to trial-ending, which takes the product's trial model")
    if (model !== undefined) body.modelId = model
    const version = value(args, 'version')
    if (version !== undefined) body.version = version
    const token = idempotencyKeyOf(args)
    const key = await secretKey(ctx)
    const answer = await minting(ctx, token, (idempotency) =>
      request(ctx, 'POST', '/v1/test-licenses', { key, body, headers: { 'idempotency-key': idempotency }, expect: answers.testLicense }),
    )
    emit(ctx, answer, () => `${String(answer.key)}\n\n${licenseBlock(answer.license as License, ctx.deps.now())}`)
  },
}

export const release: Command = {
  name: 'release',
  summary: 'Tell KeyGrant you shipped a version (the product\'s current version).',
  help: `keygrant release <version> --product <id>

Moves the product's current version up to this version's major ("2.4.0" is 2), never down,
so a build script may run it on every release, a hotfix on an old line included. The current
version caps what upgrade protection keeps. Needs a kg_live_ key. Prints the current version
after the call; --json prints the API's answer, { "product", "currentMajor" }.`,
  options: { product: { type: 'value' } },
  async run(ctx, args) {
    const [version] = positionals(args, 'the version')
    const product = value(args, 'product')
    if (!product) throw usage('--product is required')
    const key = await secretKey(ctx)
    // KeyGrant answers a test key's release as an unknown product: say why instead.
    if (!key.startsWith('kg_live_')) throw new CliError(EXIT.auth, "a release needs a kg_live_ key: a kg_test_ key reaches no product's current version", { error: 'live-key-required' })
    const answer = await request(ctx, 'POST', `/v1/products/${segment(product)}/releases`, { key, body: { version }, expect: answers.release })
    emit(ctx, answer, () => `${String(answer.product)} is at version ${String(answer.currentMajor)}.`)
  },
}
