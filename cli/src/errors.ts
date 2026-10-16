/** The exit codes, documented in the README. */
export const EXIT = {
  ok: 0,
  /** KeyGrant refused the request (a 4xx other than 401 and 429), or a lease did not verify. */
  refused: 1,
  /** The command line could not be read. */
  usage: 2,
  /** No API key, a key KeyGrant does not accept, or no credential store to keep one in. */
  auth: 3,
  /** Rate limited, after the one wait and retry. */
  rateLimited: 4,
  /** KeyGrant could not be reached, failed (5xx), or answered something that is not its JSON. */
  unavailable: 5,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/** A failure the command line reports and exits with: a sentence, and for `--json`, what to print. */
export class CliError extends Error {
  constructor(
    readonly exit: ExitCode,
    message: string,
    readonly json: Record<string, unknown> = { error: 'cli', message },
  ) {
    super(message)
  }
}

/** The API's refusal: its status, and its body (`{ error, ... }`). */
export function apiError(status: number, body: Record<string, unknown>): CliError {
  const code = typeof body.error === 'string' ? body.error : `http-${status}`
  const exit = status === 401 ? EXIT.auth : status === 429 ? EXIT.rateLimited : status >= 500 ? EXIT.unavailable : EXIT.refused
  return new CliError(exit, `${code}: ${explain(code, status, body)}`, { ...body, error: code, status })
}

const number = (v: unknown): string => (typeof v === 'number' ? v.toLocaleString('en-US') : '?')

/** What each of the API's codes means, in a sentence. A code this version does not know is shown as it is. */
const SENTENCES: Record<string, (body: Record<string, unknown>) => string> = {
  unauthorized: () => 'KeyGrant did not accept the API key. Check KEYGRANT_API_KEY, or run `keygrant login` again',
  'rate-limited': (b) => `too many requests: try again in ${number(b.retryAfter)} seconds`,
  'invalid-request': () => 'KeyGrant could not read the request (a value out of range, or one it does not know)',
  'invalid-json': () => 'KeyGrant could not read the request body',
  'invalid-versions': () => 'the versions do not hold together: majors are whole numbers from 1 to 99,999, the lowest first',
  'unknown-license': () => 'no license of yours has that key (a kg_test_ key reaches test licenses only)',
  'unknown-product': () => 'no product of yours has that API ID',
  'unknown-model': () => 'that license model is not one of the product\'s (`keygrant products` lists them)',
  'unknown-checkout': () => 'no key from that checkout yet: the webhook that makes it can land a few seconds after the buyer',
  'checkout-upgraded': () => 'that checkout upgraded a key the buyer already held, which the app picks up at its next check-in',
  'checkout-held': () => 'that checkout is held for you to attach or refund (the dashboard\'s Held sales)',
  'checkout-refunded': () => 'that checkout was held, and has been refunded since',
  'product-disabled': () => 'the product is archived, so it issues no keys',
  'plan-limit': (b) =>
    `this would take the account past its plan's limit (${number(b.usage)} of ${number(b.limit)} ${String(b.dimension ?? 'licenses').replace(/_/g, ' ')} on ${String(b.plan ?? 'its plan')})`,
  'test-limit': (b) => `the account already holds ${number(b.usage)} of its ${number(b.limit)} active test licenses`,
  'not-expiring': () => 'the key has no expiry to move (a perpetual key)',
  'term-not-started': () => 'the key is a timed key waiting for its first activation: its term has not started, so it has no end to move yet',
  'license-revoked': () => 'the key is revoked (it cannot be extended or spent from, and no file is made for it)',
  'license-expired': () => 'the key has expired, so nothing is spent from it',
  'used-up': (b) => `the meter has ${number(b.left)} uses left, fewer than asked`,
  'unknown-meter': () =>
    "the key holds no meter with that code, and the product has none to add to it with --set (`keygrant licenses meters <key>` lists a key's meters, `keygrant products` a product's)",
  'meter-not-periodic': () => 'the meter does not come back each billing period, so there is no period to reset',
  'meter-license-file': () => 'a key sent as an offline license file carries no meter',
  'meter-period-subscription-only': () => 'a meter that comes back each billing period is for a subscription key only',
  'meter-cap': () => 'the key already holds the most meters a key may (8)',
  'edit-busy': () => 'the meter kept changing while it was edited: try again',
  'over-cap': () => 'that would take the meter past the most uses one may count (1,000,000,000)',
  'not-a-file-license': () => 'the key is delivered as a typed key, not as a file (the delivery of its license model says which)',
  'no-licensee': () => 'the key has no email address to license a file to',
  'license-expires': () => 'an offline license file never expires, so none is made for a key that ends (a file that carries the key can be made for a key that ends)',
  'test-ceiling-reached': () => 'the test license is past its 30 days, and no extension brings it back',
  'idempotency-key-reused': () => 'that idempotency key was first used for another request',
  'edition-upgrade-model': () => 'that model is an edition upgrade, which changes a key a customer holds and issues none',
  'device-upgrade-model': () => 'that model adds devices to a key a customer holds, so it issues none',
  'term-required': () => 'a timed key with no model needs --expires',
  'term-ended': () => 'the model\'s end date has passed, so a key under it would run out before it was made: give --expires',
  'unknown-entitlement': (b) => `the product's catalog has no entitlement ${JSON.stringify(b.entitlement ?? '?')}`,
  'entitlement-type': (b) => `the entitlement ${JSON.stringify(b.entitlement ?? '?')} is of another type in the product's catalog`,
  'invalid-seat-release': () => 'the seat release days are fewer than the key\'s offline days: a device is never freed while it may still run offline on its lease (`keygrant licenses get <key>` shows a key\'s offline days, and `keygrant products --json` each model\'s as leaseDays, null for its type\'s default)',
  'mint-failed': () => 'KeyGrant failed while making the key',
}

function explain(code: string, status: number, body: Record<string, unknown>): string {
  // The table's own codes only: never a name every object has (`constructor`), whatever a server sends.
  const sentence = Object.hasOwn(SENTENCES, code) ? SENTENCES[code] : undefined
  if (sentence) return sentence(body)
  if (status >= 500) return `KeyGrant failed (HTTP ${status}): try again shortly`
  return `KeyGrant refused the request (HTTP ${status})`
}

/** A refusal the CLI can tell before asking (a key with no end to move), worded as the API words the same code. */
export function refusedLocally(code: string): CliError {
  return new CliError(EXIT.refused, `${code}: ${explain(code, 409, {})}`, { error: code })
}
