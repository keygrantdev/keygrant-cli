import { importVerifyingKeys, OPEN_MAJOR, verifyLease, type LeaseClaims, type VerifyingKey } from '@keygrant/shared'
import { instant, usage, value } from '../args.js'
import { answers, request } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { EXIT } from '../errors.js'
import { asJson, entitlementsText, fields, when } from '../output.js'

export const pubkey: Command = {
  name: 'pubkey',
  summary: 'Print a product\'s public key set, the JSON an app embeds.',
  help: `keygrant pubkey <product id> [--signing-only]

Prints { "keys": [ ... ] }: every key a build should carry, each with its id (kid): the key
that signs, a staged next key, and a previous key until its retire date. Embed the whole set
(publicJwks in TypeScript and .NET; the set's JSON as publicJwk in Rust, Swift and C++), so a
lease verifies on either side of a key switch.

  --signing-only   the key that signs, alone: what a build carries after a signing key leaked

Needs no API key. --json prints the API's answer, { "publicJwk", "keys" }.`,
  options: { 'signing-only': { type: 'flag' } },
  async run(ctx, args) {
    const [product] = positionals(args, 'the product id')
    const body = await request(ctx, 'GET', `/v1/products/${segment(product as string)}/pubkey`, { expect: answers.keySet })
    if (ctx.json) ctx.deps.out(asJson(body))
    else ctx.deps.out(asJson(args.flags.has('signing-only') ? body.publicJwk : { keys: body.keys }))
  },
}

/**
 * A JWS compact serialization: three base64url parts, the first a JSON
 * header (`eyJ`, base64url of `{"`), so a file name of two dots is never one.
 */
const JWS = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/

/**
 * The lease to check: standard input for `-`, the argument itself when it is a
 * JWS, else the file it names (holding the token, or JSON with a `lease`). An
 * argument that is neither is checked as it is, and is no lease.
 */
async function readLease(ctx: Parameters<Command['run']>[0], arg: string): Promise<string> {
  if (arg === '-') return (await ctx.deps.readStdin()).trim()
  if (JWS.test(arg.trim())) return arg.trim()
  let text: string
  try {
    text = (await ctx.deps.readFile(arg)).trim()
  } catch {
    return arg
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { lease?: unknown }).lease === 'string') return (parsed as { lease: string }).lease
  } catch {
    // A bare token, not JSON.
  }
  return text
}

async function readText(ctx: Parameters<Command['run']>[0], path: string, what: string): Promise<string> {
  try {
    return await ctx.deps.readFile(path)
  } catch (error) {
    throw usage(`cannot read ${what} from ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The verifying keys in a key file: a key set (`{ "keys": [...] }`, what
 * `keygrant pubkey` prints), the pubkey route's whole answer, or one JWK.
 */
export async function keysOf(text: string, where: string): Promise<VerifyingKey[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw usage(`${where} is not JSON: give the key set \`keygrant pubkey\` prints, or a JWK`)
  }
  const doc = (parsed && typeof parsed === 'object' ? parsed : {}) as { keys?: unknown; kty?: unknown }
  const jwks = Array.isArray(doc.keys) ? doc.keys : doc.kty !== undefined ? [doc] : null
  if (!jwks) throw usage(`${where} holds no key set ({ "keys": [...] }) and no JWK`)
  try {
    return await importVerifyingKeys(jwks as JsonWebKey[])
  } catch (error) {
    throw usage(`${where} is not an Ed25519 public key set: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const REASONS: Record<string, string> = {
  malformed: 'it is not a lease (a JWS of three base64url parts)',
  'unknown-key': 'it names a signing key the key set does not hold: update the key set (`keygrant pubkey`)',
  'bad-signature': 'its signature is not by any key of the key set',
  'bad-claims': 'its claims are not a KeyGrant lease\'s',
  expired: 'it has expired',
  'wrong-product': 'it is for another product',
}

/** The majors a lease's claims cover, as people read them. */
function majors(c: LeaseClaims): string {
  const low = c.minMajor ?? 1
  if (c.major >= OPEN_MAJOR) return `${low} and later`
  return c.major === low ? String(low) : `${low} to ${c.major}`
}

function claimFields(c: LeaseClaims): string {
  return fields([
    ['License', c.sub],
    ['Product', c.product],
    ['Activation', c.aid],
    ['Model', c.model],
    ['Devices', String(c.lim)],
    ['Majors', majors(c)],
    ['Upgrades until', c.upgradeUntil ? when(c.upgradeUntil * 1000) : null],
    ['Entitlements', entitlementsText(c.ent)],
    ['Device', c.fp ? `bound (${c.fpk ?? 'kind not said'})` : 'not bound'],
    ['Issued', when(c.iat * 1000)],
    ['Expires', when(c.exp * 1000)],
    ['Grace', c.grace ? 'yes: past its expiry, in its grace' : null],
    ['Test', c.test ? 'yes: a test license' : null],
  ])
}

export const verify: Command = {
  name: 'verify',
  summary: 'Verify a lease against a public key set, offline.',
  help: `keygrant verify <lease | - | file> --key <file> [--product <id>] [--at <time>]

  <lease>          the lease itself, - for standard input, or a file holding it (the token,
                   or JSON with a "lease")
  --key <file>     the key set \`keygrant pubkey\` prints, the pubkey route's answer, or one JWK
  --product <id>   also require the lease to be this product's
  --at <time>      judge its expiry at this time instead of now: a date (its first moment, UTC), an
                   ISO time with its offset, or ms

Exactly as an SDK does, with no network: the signature by the key the lease names (each key in
turn for a lease that names none), its claims, then its expiry. Prints what it grants. Exits 0
for a valid lease and 1 for one that is not; --json prints { "valid", "reason"?, "claims"? }.`,
  options: { key: { type: 'value' }, product: { type: 'value' }, at: { type: 'value' } },
  async run(ctx, args) {
    const [arg] = positionals(args, 'the lease')
    const keyFile = value(args, 'key')
    if (!keyFile) throw usage('--key <file> is required: save the key set with `keygrant pubkey <product> > keys.json`')
    const at = value(args, 'at')
    const now = at === undefined ? ctx.deps.now() : instant(at, '--at', false)
    const keys = await keysOf(await readText(ctx, keyFile, 'the key set'), keyFile)
    const result = await verifyLease(await readLease(ctx, arg as string), keys, now)
    const product = value(args, 'product')
    const verdict =
      result.valid && product !== undefined && result.claims.product !== product
        ? { valid: false as const, reason: 'wrong-product', claims: result.claims }
        : result
    emit(ctx, verdict, () => {
      const head = verdict.valid ? 'Valid lease.' : `Not valid: ${verdict.reason}: ${REASONS[verdict.reason] ?? verdict.reason}.`
      return verdict.claims ? `${head}\n\n${claimFields(verdict.claims)}` : head
    })
    return verdict.valid ? EXIT.ok : EXIT.refused
  },
}
