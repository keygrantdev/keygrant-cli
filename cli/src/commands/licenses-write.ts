import { instant, usage, value, wholeNumber, type Parsed } from '../args.js'
import { answers, request, secretKey, type Context } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { CliError, EXIT, refusedLocally } from '../errors.js'
import { when } from '../output.js'
import { licenseBlock, type License } from './license-view.js'

const DAY_MS = 86_400_000
const TYPES = ['perpetual', 'subscription', 'trial', 'timed']
const REASONS = ['refund', 'chargeback', 'subscription_canceled', 'manual']

/** What a request that carries a key says when it fails in a way that may have done its work all the same. */
export interface Retry {
  /** What may have happened: "it may have been made all the same". */
  may: string
  /** What running the command again with the key gets: "to get it rather than make another". */
  rather: string
  /** The option that takes the key, and the member of the `--json` error that names it. */
  flag: string
  field: string
}

/** A request that mints: its key is the `--idempotency-key`. */
const MINTS: Retry = { may: 'it may have been made all the same', rather: 'to get it rather than make another', flag: '--idempotency-key', field: 'idempotencyKey' }

/**
 * A request that mints (or, with `retry`, adds or spends), sent with a key: the
 * one asked for, else one made for this run, so its own retry never does the
 * work twice. When it fails in a way that may have done it all the same
 * (KeyGrant unreachable, or failing), and the key was the run's own, the error
 * names it, so the work can be asked for again with it rather than done a
 * second time.
 */
export async function minting<T>(ctx: Context, given: string | undefined, send: (idempotencyKey: string) => Promise<T>, retry: Retry = MINTS): Promise<T> {
  const key = given ?? `cli-${ctx.deps.randomId()}`
  try {
    return await send(key)
  } catch (error) {
    if (given !== undefined || !(error instanceof CliError) || error.exit !== EXIT.unavailable) throw error
    const again = `${retry.may}: run the command again with ${retry.flag} ${key} ${retry.rather}`
    throw new CliError(error.exit, `${error.message}; ${again}`, { ...error.json, [retry.field]: key })
  }
}

/**
 * The `--idempotency-key` asked for, held to what KeyGrant takes (1 to 255
 * visible ASCII characters, sent exactly as typed); read before anything else
 * is, so a bad one is a usage error whatever else is wrong.
 */
export function idempotencyKeyOf(args: Parsed): string | undefined {
  const given = value(args, 'idempotency-key')
  if (given !== undefined && !/^[\x21-\x7e](?:[\x20-\x7e]{0,253}[\x21-\x7e])?$/.test(given)) {
    throw usage('--idempotency-key must be 1 to 255 visible ASCII characters, with no space at either end')
  }
  return given
}

/** A major from an option: a whole number from 1 to 99,999, or `none` (and later) where `none` is allowed. */
function major(text: string, what: string, noneAllowed: boolean): number | null {
  if (noneAllowed && text.trim().toLowerCase() === 'none') return null
  return wholeNumber(text, what, 1, 99_999)
}

/** Seat release days as typed: a whole number of days from 1 to 365, or `off` (null) for none. */
function seatReleaseDays(text: string, what: string): number | null {
  if (text.trim().toLowerCase() === 'off') return null
  if (!/^\d+$/.test(text.trim())) throw usage(`${what} must be a whole number of days or off, not "${text}"`)
  return wholeNumber(text, what, 1, 365)
}

/** An entitlement's value as typed: `true` or `false`, a number, or else text. */
function entitlementValue(raw: string): boolean | number | string {
  if (raw === 'true' || raw === 'false') return raw === 'true'
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw
}

/**
 * Entitlements from `--entitlement code=value` (`entitlementValue`), or none at
 * all for `--no-entitlements`. Neither leaves the model's.
 */
export function entitlementsOf(args: Parsed): Record<string, boolean | number | string> | undefined {
  const given = args.values.get('entitlement') ?? []
  if (args.flags.has('no-entitlements')) {
    if (given.length) throw usage('--entitlement and --no-entitlements cannot be given together')
    return {}
  }
  if (!given.length) return undefined
  const pairs = given.map((pair): [string, boolean | number | string] => {
    const at = pair.indexOf('=')
    const code = at < 0 ? '' : pair.slice(0, at).trim()
    if (!code) throw usage(`--entitlement takes code=value, not "${pair}"`)
    return [code, entitlementValue(pair.slice(at + 1).trim())]
  })
  const twice = pairs.find(([code], i) => pairs.findIndex(([other]) => other === code) !== i)
  if (twice) throw usage(`--entitlement ${twice[0]} is given twice`)
  // Defined as own properties, so a code no object takes as one (`__proto__`) still reaches KeyGrant to judge.
  return Object.fromEntries(pairs)
}

/** What the issue sells: the product, and the model by its id or a bare type. */
function soldAs(args: Parsed): Record<string, unknown> {
  const product = value(args, 'product')
  if (!product) throw usage('--product is required')
  const modelId = value(args, 'model')
  const type = value(args, 'type')
  if (!modelId && !type) throw usage('--model <id> or --type <type> is required (`keygrant products` lists the models)')
  if (modelId && type) throw usage('give one of --model and --type, not both')
  if (type !== undefined && !TYPES.includes(type)) throw usage(`--type must be one of ${TYPES.join(', ')}`)
  return { product, ...(modelId ? { modelId } : { model: type }) }
}

/** The versions it covers, in place of the model's: the version sold, a range, the months of protection. */
function versionsAsked(args: Parsed): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const version = value(args, 'version')
  if (version !== undefined) out.version = version
  const min = value(args, 'min-major')
  const max = value(args, 'max-major')
  if ((min === undefined) !== (max === undefined)) throw usage('--min-major and --max-major go together')
  if (min !== undefined && max !== undefined) Object.assign(out, { minMajor: major(min, '--min-major', false), maxMajor: major(max, '--max-major', true) })
  const months = value(args, 'upgrade-months')
  if (months !== undefined) out.upgradeMonths = wholeNumber(months, '--upgrade-months', 0, 120)
  return out
}

/** The issue's body, from its options. */
function issueBody(args: Parsed): Record<string, unknown> {
  const body: Record<string, unknown> = { ...soldAs(args), ...versionsAsked(args) }
  const email = value(args, 'email')
  if (email !== undefined) body.email = email
  const devices = value(args, 'device-limit')
  if (devices !== undefined) body.deviceLimit = wholeNumber(devices, '--device-limit', 1, 1000)
  const release = value(args, 'seat-release-days')
  if (release !== undefined) body.seatReleaseDays = seatReleaseDays(release, '--seat-release-days')
  const expires = value(args, 'expires')
  if (expires !== undefined) body.expiresAt = instant(expires, '--expires', true)
  const entitlements = entitlementsOf(args)
  if (entitlements !== undefined) body.entitlements = entitlements
  const count = value(args, 'count')
  if (count !== undefined) body.count = wholeNumber(count, '--count', 1, 100)
  if (args.flags.has('send-email')) body.sendEmail = true
  return body
}

export const issue: Command = {
  name: 'licenses issue',
  summary: 'Issue a license key (or several, as one sale).',
  help: `keygrant licenses issue --product <id> (--model <model id> | --type <type>) [options]

  --product <id>              the product's API ID
  --model <model id>          the license model sold (its terms: expiry, devices, entitlements, versions)
  --type <type>               perpetual, subscription, trial or timed, for a key sold under no model
  --email <address>           the customer's address
  --send-email                email the key with the product's delivery mail
  --device-limit <n>          1 to 1,000, in place of the model's
  --seat-release-days <n|off> days, 1 to 365, an unused device keeps its seat before it is freed,
                              in place of the model's (never fewer than its offline days); off for never
  --expires <date>            when it ends: 2027-01-31 (through that day, UTC), an ISO time with its
                              offset (2027-01-31T12:00:00Z), or 13 digits of ms
  --version <version>         the version sold, "2.4.1"; only its major counts
  --min-major <n> --max-major <n|none>   the majors it covers, in place of the model's
  --upgrade-months <n>        0 to 120 months of upgrade protection, in place of the model's
  --entitlement <code=value>  what it grants, in place of the model's (repeat for each; true, false,
                              a number, or text)
  --no-entitlements           grant none, whatever the model grants
  --count <n>                 1 to 100 keys, as one sale
  --idempotency-key <key>     the same key on a retry answers the key first issued (one is made for
                              each run otherwise)

Prints each key on a line of its own. --json prints the API's answer, { "key", "emailed" }
(and "keys" with --count). A kg_test_ key issues test licenses.`,
  options: {
    product: { type: 'value' },
    model: { type: 'value' },
    type: { type: 'value' },
    email: { type: 'value' },
    'send-email': { type: 'flag' },
    'device-limit': { type: 'value' },
    'seat-release-days': { type: 'value' },
    expires: { type: 'value' },
    version: { type: 'value' },
    'min-major': { type: 'value' },
    'max-major': { type: 'value' },
    'upgrade-months': { type: 'value' },
    entitlement: { type: 'value', many: true },
    'no-entitlements': { type: 'flag' },
    count: { type: 'value' },
    'idempotency-key': { type: 'value' },
  },
  async run(ctx, args) {
    positionals(args)
    const token = idempotencyKeyOf(args)
    const body = issueBody(args)
    const key = await secretKey(ctx)
    const answer = await minting(ctx, token, (idempotency) => request(ctx, 'POST', '/v1/licenses', { key, body, headers: { 'idempotency-key': idempotency }, expect: answers.issued }))
    const keys = (answer.keys as string[] | undefined) ?? [answer.key as string]
    emit(ctx, answer, () => keys.join('\n'))
    if (!ctx.json && answer.emailed === true) ctx.deps.err(keys.length > 1 ? 'Emailed the keys to the customer.' : 'Emailed the key to the customer.')
  },
}

/** The expiry `--days` asks for: that many days from the later of now and the license's end, as the dashboard's Extend. */
function extendedBy(license: License, days: number, now: number): number {
  if (license.expiresAt === null) throw refusedLocally(license.term ? 'term-not-started' : 'not-expiring')
  return Math.max(license.expiresAt, now) + days * DAY_MS
}

export const extend: Command = {
  name: 'licenses extend',
  summary: 'Move a license\'s expiry later.',
  help: `keygrant licenses extend <key> (--to <date> | --days <n>)

  --to <date>    the new expiry: 2027-01-31 (through that day, UTC), an ISO time with its
                 offset (2027-01-31T12:00:00Z), or 13 digits of ms
  --days <n>     1 to 36,500 days from the later of now and its expiry

Never shortens, and never reinstates a revoked key. A timed key still waiting for its first
activation has no end to move yet (term-not-started), and a perpetual key none at all
(not-expiring). The new expiry is sent as an instant, so running the command again with
--to changes nothing more. Prints the license as it now stands; --json prints the API's answer.`,
  options: { to: { type: 'value' }, days: { type: 'value' } },
  async run(ctx, args) {
    const [licenseKey] = positionals(args, 'the license key')
    const to = value(args, 'to')
    const days = value(args, 'days')
    if ((to === undefined) === (days === undefined)) throw usage('give one of --to <date> and --days <n>')
    // Both read before anything is asked, so a bad one is a usage error whatever else is wrong.
    const target = to === undefined ? null : instant(to, '--to', true)
    const dayCount = days === undefined ? null : wholeNumber(days, '--days', 1, 36_500)
    const key = await secretKey(ctx)
    const path = `/v1/licenses/${segment(licenseKey as string)}`
    let expiresAt: number
    if (target !== null) {
      expiresAt = target
    } else {
      const read = await request(ctx, 'GET', path, { key, expect: answers.license })
      expiresAt = extendedBy(read.license as License, dayCount as number, ctx.deps.now())
    }
    const answer = await request(ctx, 'POST', `${path}/extend`, { key, body: { expiresAt }, expect: answers.license })
    const license = answer.license as License
    emit(ctx, answer, () => `Expires ${when(license.expiresAt)}.\n\n${licenseBlock(license, ctx.deps.now())}`)
  },
}

export const versions: Command = {
  name: 'licenses versions',
  summary: 'Set the majors a license covers.',
  help: `keygrant licenses versions <key> --min <n> --max <n|none> [--upgrade-until <date|none>]

  --min <n>                    its lowest major, 1 to 99,999
  --max <n|none>               its highest, or none for "and every later one"
  --upgrade-until <date|none>  where its upgrade window ends (every major runs until then), or none

The whole range, every time. Prints the license as it now stands; --json prints the API's answer.`,
  options: { min: { type: 'value' }, max: { type: 'value' }, 'upgrade-until': { type: 'value' } },
  async run(ctx, args) {
    const [licenseKey] = positionals(args, 'the license key')
    const min = value(args, 'min')
    const max = value(args, 'max')
    if (min === undefined || max === undefined) throw usage('--min and --max are both required')
    const body: Record<string, unknown> = { minMajor: major(min, '--min', false), maxMajor: major(max, '--max', true) }
    const until = value(args, 'upgrade-until')
    if (until !== undefined) body.upgradeUntil = until.trim().toLowerCase() === 'none' ? null : instant(until, '--upgrade-until', true)
    const answer = await request(ctx, 'POST', `/v1/licenses/${segment(licenseKey as string)}/versions`, { key: await secretKey(ctx), body, expect: answers.license })
    emit(ctx, answer, () => licenseBlock(answer.license as License, ctx.deps.now()))
  },
}

export const deviceLimit: Command = {
  name: 'licenses device-limit',
  summary: 'Set how many devices a license may be active on.',
  help: `keygrant licenses device-limit <key> <n>

Sets the limit to n, 1 to 1,000, in place of its model's. Lowering it frees no device: a new
device is refused until fewer than n are active. Prints the license as it now stands; --json
prints the API's answer.`,
  options: {},
  async run(ctx, args) {
    const [licenseKey, n] = positionals(args, 'the license key', 'the device limit')
    const body = { deviceLimit: wholeNumber(n as string, 'the device limit', 1, 1000) }
    const answer = await request(ctx, 'POST', `/v1/licenses/${segment(licenseKey as string)}/devices`, { key: await secretKey(ctx), body, expect: answers.license })
    emit(ctx, answer, () => licenseBlock(answer.license as License, ctx.deps.now()))
  },
}

export const seatRelease: Command = {
  name: 'licenses seat-release',
  summary: 'Set when an unused device of a license frees its seat.',
  help: `keygrant licenses seat-release <key> <days|off>

Sets how many days, 1 to 365, a device of the license may go without checking in before the
nightly pass frees its seat, in place of its model's; off keeps every seat. Never fewer than its
offline days, how long a device may run on its lease without checking in (invalid-seat-release).
A device already unseen that long is freed the next night. Prints the license as it now stands;
--json prints the API's answer.`,
  options: {},
  async run(ctx, args) {
    const [licenseKey, days] = positionals(args, 'the license key', 'the seat release days (or off)')
    const body = { seatReleaseDays: seatReleaseDays(days as string, 'the seat release days') }
    const answer = await request(ctx, 'POST', `/v1/licenses/${segment(licenseKey as string)}/seat-release`, { key: await secretKey(ctx), body, expect: answers.license })
    emit(ctx, answer, () => licenseBlock(answer.license as License, ctx.deps.now()))
  },
}

export const revoke: Command = {
  name: 'licenses revoke',
  summary: 'Revoke a license.',
  help: `keygrant licenses revoke <key> [--reason <reason>]

  --reason <reason>   refund, chargeback, subscription_canceled or manual (the default)

The app stops at its next check-in, or when its lease runs out offline. --json prints the
API's answer, { "ok": true }.`,
  options: { reason: { type: 'value' } },
  async run(ctx, args) {
    const [licenseKey] = positionals(args, 'the license key')
    const reason = value(args, 'reason')
    if (reason !== undefined && !REASONS.includes(reason)) throw usage(`--reason must be one of ${REASONS.join(', ')}`)
    const body = reason ? { reason } : {}
    const answer = await request(ctx, 'POST', `/v1/licenses/${segment(licenseKey as string)}/revoke`, { key: await secretKey(ctx), body, expect: answers.revoked })
    emit(ctx, answer, () => `Revoked ${(licenseKey as string).trim()}.`)
  },
}

export const freeDevice: Command = {
  name: 'licenses free-device',
  summary: 'Free one device from a license, by its activation id.',
  help: `keygrant licenses free-device <key> <activation id>

Frees the seat so another device can take it. The activation id is the SDK's, and the
device.activated webhook's. --json prints the API's answer, { "released": 0 | 1 }.`,
  options: {},
  async run(ctx, args) {
    const [licenseKey, given] = positionals(args, 'the license key', 'the activation id')
    const activation = (given as string).trim()
    const path = `/v1/licenses/${segment(licenseKey as string)}/activations/${segment(activation)}`
    const answer = await request(ctx, 'DELETE', path, { key: await secretKey(ctx), expect: answers.released })
    emit(ctx, answer, () =>
      answer.released === 1 ? `Freed ${activation} from ${(licenseKey as string).trim()}.` : `No active device ${activation} on ${(licenseKey as string).trim()}: nothing to free.`,
    )
  },
}
