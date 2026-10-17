import { apiError, CliError, EXIT } from './errors.js'
import { StoreUnavailable, type Deps } from './deps.js'
import { VERSION } from './version.js'

export const DEFAULT_API_URL = 'https://api.keygrant.dev'

/** How long one request may take before it counts as KeyGrant unreachable. */
const REQUEST_TIMEOUT_MS = 30_000

/** The longest a 429 is waited out before the one retry; one asking for longer is reported at once. */
export const MAX_RETRY_WAIT_S = 120

/** A run's settings: its dependencies, how it prints, where KeyGrant is, and whether a 429 is retried. */
export interface Context {
  deps: Deps
  json: boolean
  origin: string
  retry: boolean
}

/**
 * KeyGrant's address from `--api-url` or KEYGRANT_API_URL, else the
 * production API. Only https, but for a worker on this machine: an API key
 * never crosses a network in the clear.
 */
export function apiOrigin(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return DEFAULT_API_URL
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new CliError(EXIT.usage, `the API URL "${raw}" is not a URL`)
  }
  // The loopback names alone: another name is whatever a resolver answers for it.
  const local = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin
  throw new CliError(EXIT.usage, `the API URL must be https:// (http:// only for localhost, 127.0.0.1 or [::1]), not "${raw}"`)
}

const SECRET_KEY = /^kg_(?:live|test)_[A-Za-z0-9]+$/

/** Whether `text` reads as a KeyGrant secret API key. */
export const isSecretKey = (text: string): boolean => SECRET_KEY.test(text)

/** The account an API key is kept under in the credential store: the address it is for. */
export const storeAccount = (origin: string): string => origin

/**
 * The API key for this run: KEYGRANT_API_KEY when set, else the one `keygrant
 * login` kept for this address. None is exit 3, saying how to give one: where
 * the credential store cannot be used, only the variable.
 */
export async function secretKey(ctx: Context): Promise<string> {
  const fromEnv = ctx.deps.env.KEYGRANT_API_KEY?.trim()
  if (fromEnv) {
    if (!isSecretKey(fromEnv)) throw new CliError(EXIT.auth, 'KEYGRANT_API_KEY is not a KeyGrant secret key (kg_live_... or kg_test_...)')
    return fromEnv
  }
  const where = ctx.origin === DEFAULT_API_URL ? '' : ` for ${ctx.origin}`
  let stored: string | null
  try {
    stored = await ctx.deps.credentials.get(storeAccount(ctx.origin))
  } catch (error) {
    if (!(error instanceof StoreUnavailable)) throw error
    const why = `${ctx.deps.credentials.name} cannot be used here: ${error.message}`
    throw new CliError(EXIT.auth, `no API key${where}: set KEYGRANT_API_KEY (${why})`, { error: 'no-api-key' })
  }
  if (stored) {
    // Held to what a key is, as KEYGRANT_API_KEY is: an entry changed outside the CLI is never sent as one.
    if (!isSecretKey(stored.trim())) throw new CliError(EXIT.auth, `the API key kept${where} is not a KeyGrant secret key: run \`keygrant login\` again`, { error: 'no-api-key' })
    return stored.trim()
  }
  throw new CliError(EXIT.auth, `no API key${where}: set KEYGRANT_API_KEY, or run \`keygrant login\``, { error: 'no-api-key' })
}

export interface RequestOptions {
  /** The JSON body to send. */
  body?: unknown
  /** The API key; omitted for a public route. */
  key?: string
  headers?: Record<string, string>
  /** Whether a successful answer has the shape the command reads; one that does not is not KeyGrant's (exit 5). */
  expect?: (body: Record<string, unknown>) => boolean
}

/**
 * One call to KeyGrant: its JSON answer, or a CliError naming the API's reason.
 * A 429 is waited out once (`retryWait`), saying so on standard error (but
 * under `--json`, whose standard error is the one JSON error), unless the run
 * said `--no-retry`: KeyGrant meters a key before a route does anything, so the
 * retry can never do a thing twice.
 */
export async function request(ctx: Context, method: string, path: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
  for (let attempt = 1; ; attempt++) {
    const res = await send(ctx, method, path, options)
    const body = await readJson(res, ctx.origin)
    if (res.ok) return shaped(ctx, body, options.expect)
    const wait = res.status === 429 ? retryWait(body, res.headers.get('retry-after')) : null
    if (wait === null || !ctx.retry || attempt > 1) throw apiError(res.status, withRetryAfter(res, body))
    if (!ctx.json) ctx.deps.err(`Rate limited by KeyGrant (429): waiting ${wait} s, then trying once more.`)
    await ctx.deps.sleep(wait * 1000)
  }
}

async function send(ctx: Context, method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': `keygrant-cli/${VERSION}`, ...options.headers }
  if (options.key) headers.authorization = `Bearer ${options.key}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  try {
    return await ctx.deps.fetch(`${ctx.origin}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new CliError(EXIT.unavailable, `could not reach KeyGrant at ${ctx.origin}: ${why}`, { error: 'unreachable', message: why })
  }
}

async function readJson(res: Response, origin: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await res.text()
  } catch (error) {
    // KeyGrant answered, then the body was cut off or timed out: what it did is not known, as when it cannot be reached.
    const why = error instanceof Error ? error.message : String(error)
    throw new CliError(EXIT.unavailable, `${origin} answered HTTP ${res.status}, but its answer could not be read: ${why}`, { error: 'unreadable', status: res.status, message: why })
  }
  try {
    const parsed: unknown = text === '' ? {} : JSON.parse(text)
    if (has.object(parsed)) return parsed
  } catch {
    // Not JSON: a proxy's page, or not KeyGrant at all.
  }
  if (!res.ok && res.status < 500) return {}
  throw notKeyGrant(origin, res.status)
}

function notKeyGrant(origin: string, status: number): CliError {
  return new CliError(EXIT.unavailable, `${origin} answered HTTP ${status} with something that is not KeyGrant's JSON`, { error: 'not-json', status })
}

/** A successful answer, held to the shape the command reads. */
function shaped(ctx: Context, body: Record<string, unknown>, expect: RequestOptions['expect']): Record<string, unknown> {
  if (expect && !expect(body)) throw notKeyGrant(ctx.origin, 200)
  return body
}

/** A 429's body, with the wait its Retry-After header says when the body says none. */
function withRetryAfter(res: Response, body: Record<string, unknown>): Record<string, unknown> {
  if (res.status !== 429 || body.retryAfter !== undefined) return body
  const header = Number(res.headers.get('retry-after'))
  return Number.isFinite(header) && header > 0 ? { ...body, retryAfter: header } : body
}

/**
 * Seconds to wait out a 429 before the one retry: what it says (its
 * `retryAfter`, else its Retry-After header), else a minute. Null when it asks
 * for longer than MAX_RETRY_WAIT_S: a window that long (a tenant's daily
 * count) is not waited out, it is reported at once.
 */
export function retryWait(body: Record<string, unknown>, header: string | null): number | null {
  const said = typeof body.retryAfter === 'number' ? body.retryAfter : Number(header ?? NaN)
  const seconds = Number.isFinite(said) && said > 0 ? Math.ceil(said) : 60
  return seconds > MAX_RETRY_WAIT_S ? null : seconds
}

/** Shapes the commands' answers are held to (`RequestOptions.expect`). */
export const has = {
  object: (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v),
  /** A whole number of uses, as a meter counts them. */
  uses: (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
  /** A key's meter as a licence shows it, the members the CLI prints. */
  meter: (v: unknown): boolean =>
    has.object(v) &&
    ['uses', 'extra', 'used', 'left', 'overage', 'offline'].every((name) => has.uses(v[name])) &&
    (v.ownOffline === null || has.uses(v.ownOffline)) &&
    typeof v.resets === 'string' &&
    (v.periodEnd === null || typeof v.periodEnd === 'number'),
  /** A licence's meters (`{}` for none), by code; a KeyGrant from before meters says none, which is as good as `{}`. */
  meters: (v: unknown): boolean => v === undefined || (has.object(v) && Object.values(v).every(has.meter)),
  /** A product's meters, as `GET /v1/products` lists them. */
  catalog: (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.every((m) => has.object(m) && typeof m.code === 'string' && typeof m.name === 'string')),
  /** A model's meters and the uses a top-up adds, as `GET /v1/products` lists them. */
  modelMeters: (m: unknown): boolean =>
    has.object(m) &&
    (m.meters === undefined ||
      (Array.isArray(m.meters) &&
        m.meters.every((x) => has.object(x) && typeof x.code === 'string' && has.uses(x.uses) && typeof x.resets === 'string' && (x.offline === null || x.offline === undefined || has.uses(x.offline))))) &&
    (m.addsUses === undefined || (has.object(m.addsUses) && Object.values(m.addsUses).every(has.uses))),
  license: (v: unknown): boolean => has.object(v) && typeof v.key === 'string' && has.meters(v.meters),
  licenses: (v: unknown): boolean => Array.isArray(v) && v.every(has.license),
  /** One device a licence is active on, as `GET /v1/licenses/:key/activations` lists it. */
  activation: (v: unknown): boolean =>
    has.object(v) &&
    typeof v.id === 'string' &&
    typeof v.createdAt === 'number' &&
    [v.lastSeen, v.releaseAt].every((t) => t === null || t === undefined || typeof t === 'number') &&
    [v.name, v.platform, v.appVersion].every((t) => t === null || t === undefined || typeof t === 'string'),
  /** A license file as the file route answers it: its facts, and its content to save under its name. */
  file: (v: unknown): boolean =>
    has.object(v) &&
    ['id', 'kid', 'filename', 'mediaType', 'content'].every((name) => typeof v[name] === 'string') &&
    (v.kind === 'key' || v.kind === 'offline') &&
    typeof v.issuedAt === 'number' &&
    typeof v.signedAt === 'number',
}

type Answer = (body: Record<string, unknown>) => boolean

/** What each route answers, as far as a command reads it. */
export const answers = {
  license: ((b) => has.license(b.license)) as Answer,
  page: ((b) => has.licenses(b.licenses) && (b.nextCursor === null || typeof b.nextCursor === 'string')) as Answer,
  checkout: ((b) => has.license(b.license) && (b.licenses === undefined || (has.licenses(b.licenses) && (b.licenses as unknown[]).length > 0))) as Answer,
  issued: ((b) => typeof b.key === 'string' && (b.keys === undefined || (Array.isArray(b.keys) && b.keys.length > 0 && b.keys.every((k) => typeof k === 'string')))) as Answer,
  testLicense: ((b) => typeof b.key === 'string' && has.license(b.license)) as Answer,
  products: ((b) =>
    Array.isArray(b.products) &&
    b.products.every((p) => has.object(p) && typeof p.slug === 'string' && Array.isArray(p.models) && has.catalog(p.meters) && p.models.every(has.modelMeters))) as Answer,
  release: ((b) => typeof b.currentMajor === 'number') as Answer,
  file: ((b) => has.file(b.file)) as Answer,
  keySet: ((b) => Array.isArray(b.keys) && has.object(b.publicJwk)) as Answer,
  /** A meter after a backend's spend: `{ meter }`, the meter as a licence shows it. */
  spent: ((b) => has.meter(b.meter)) as Answer,
  revoked: ((b) => b.ok === true) as Answer,
  released: ((b) => b.released === 0 || b.released === 1) as Answer,
  /** The devices a licence is active on: `{ activations: [ ... ] }`. */
  devices: ((b) => Array.isArray(b.activations) && b.activations.every(has.activation)) as Answer,
}
