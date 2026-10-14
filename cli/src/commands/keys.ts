import { importVerifyingKeys, LICENSE_FILE_EXTENSION, OPEN_MAJOR, verifyLease, type LeaseClaims, type VerifyingKey } from '@keygrant/shared'
import { instant, usage, value } from '../args.js'
import { answers, request, type Context } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { EXIT, type ExitCode } from '../errors.js'
import { asJson, entitlementsText, fields, when } from '../output.js'
import { fileFields, fileHead, isLicenseFile, verifyFileBytes, type FileVerdict } from './file-view.js'

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
 * What `verify` is asked to check: its bytes (a license file is judged by
 * them, strictly), the same read as text (a lease is), and the file it was
 * read from (null for standard input or the argument itself).
 */
interface Subject {
  bytes: Uint8Array
  text: string
  path: string | null
}

function subjectOf(bytes: Uint8Array, path: string | null): Subject {
  return { bytes, text: new TextDecoder().decode(bytes), path }
}

/**
 * The text to check: standard input for `-`, the argument itself when it is a
 * JWS, else the file it names (one named `.kglicense` that cannot be read is a
 * usage error). An argument that is neither is checked as it is, and is no lease.
 */
async function readSubject(ctx: Context, arg: string): Promise<Subject> {
  if (arg === '-') return subjectOf(await ctx.deps.readStdinBytes(), null)
  if (JWS.test(arg.trim())) return subjectOf(new TextEncoder().encode(arg.trim()), null)
  try {
    return subjectOf(await ctx.deps.readFileBytes(arg), arg)
  } catch (error) {
    // A name that says it is a license file is one to find, not a text to check.
    if (arg.toLowerCase().endsWith(LICENSE_FILE_EXTENSION)) throw usage(`cannot read the license file from ${arg}: ${error instanceof Error ? error.message : String(error)}`)
    return subjectOf(new TextEncoder().encode(arg), null)
  }
}

/** The lease in a subject: its text, or, in a file, the `lease` of JSON that holds one. */
function leaseOf(subject: Subject): string {
  const text = subject.text.trim()
  if (subject.path === null) return text
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
  malformed: 'it is not a lease (a JWS of three base64url parts); a license file is read as one by a name ending .kglicense',
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
  summary: 'Verify a lease, a license file or a key file against a public key set, offline.',
  help: `keygrant verify <lease | license file | - | file> --key <file> [--product <id>] [--at <time>]

  <lease>          the lease itself, - for standard input, or a file holding it (the token,
                   or JSON with a "lease")
  <license file>   a license file or key file (.kglicense), as the buyer is sent it: its path, or - for
                   its text on standard input (the file's token alone is read too). A file named
                   .kglicense, or a token whose header says it is a license file's, is read as one
  --key <file>     the key set \`keygrant pubkey\` prints, the pubkey route's answer, or one JWK
  --product <id>   also require it to be this product's
  --at <time>      judge a lease's expiry at this time instead of now: a date (its first moment, UTC), an
                   ISO time with its offset, or ms. A license file never expires, so it is not read

Exactly as an SDK does, with no network. A lease: the signature by the key it names (each key in
turn for a lease that names none), its claims, then its expiry. A license file: its container (one
token, notes on lines starting with #), its header and key id, the signature by that key alone, then
its claims; the key set must hold every key that ever signed a file (\`keygrant pubkey\` prints them).
Prints what it grants (a file: its kind, product, licensee, key, versions, id, and the key that
signed it). Exits 0 for a valid one and 1 for one that is not; --json prints { "valid", "reason"?,
"claims"? }, and for a file the "kid" its header names.`,
  options: { key: { type: 'value' }, product: { type: 'value' }, at: { type: 'value' } },
  async run(ctx, args) {
    const [arg] = positionals(args, 'the lease or license file')
    const keyFile = value(args, 'key')
    if (!keyFile) throw usage('--key <file> is required: save the key set with `keygrant pubkey <product> > keys.json`')
    const at = value(args, 'at')
    const now = at === undefined ? ctx.deps.now() : instant(at, '--at', false)
    const keys = await keysOf(await readText(ctx, keyFile, 'the key set'), keyFile)
    const subject = await readSubject(ctx, arg as string)
    const product = value(args, 'product')
    if (isLicenseFile(subject.bytes, subject.path)) return verifyFile(ctx, subject.bytes, keys, product)
    const result = await verifyLease(leaseOf(subject), keys, now)
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

/** `verify` of a license file or key file: offline, by the strict reader, the product checked when asked. */
async function verifyFile(ctx: Context, bytes: Uint8Array, keys: VerifyingKey[], product: string | undefined): Promise<ExitCode> {
  const read = await verifyFileBytes(bytes, keys)
  const verdict: FileVerdict = read.valid && product !== undefined && read.claims.product !== product ? { ...read, valid: false, reason: 'wrong-product' } : read
  emit(ctx, verdict, () => {
    const head = fileHead(verdict)
    return verdict.claims ? `${head}\n\n${fileFields(verdict.claims, verdict.kid)}` : head
  })
  return verdict.valid ? EXIT.ok : EXIT.refused
}
