import { expect, onTestFinished } from 'vitest'
import { StoreUnavailable, type CredentialStore, type Deps } from '../src/deps.js'
import { run } from '../src/run.js'

/** One request the command line made, as the fake fetch saw it. */
export interface Call {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body: unknown
  /** What can abort it: the CLI sends none without one, so no call can hang. */
  signal: AbortSignal | null | undefined
}

/** An answer for the fake fetch: a JSON body and a status, a raw Response, or an error thrown (no network). */
export type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | Response | Error

export const LIVE_KEY = `kg_live_${'a1'.repeat(24)}`
export const TEST_KEY = `kg_test_${'b2'.repeat(24)}`
export const NOW = 1_790_000_000_000

/**
 * The credential store, in memory; or one that is not there, as in a CI
 * container (`missing`); or one that reads but cannot be written (`unwritable`).
 */
export class MemoryStore implements CredentialStore {
  readonly name = 'the test keyring'
  readonly kept = new Map<string, string>()
  constructor(
    private readonly missing: string | null = null,
    private readonly unwritable: Error | null = null,
  ) {}
  private check(): void {
    if (this.missing) throw new StoreUnavailable(this.missing)
  }
  async get(account: string) {
    this.check()
    return this.kept.get(account) ?? null
  }
  async set(account: string, secret: string) {
    this.check()
    if (this.unwritable) throw this.unwritable
    this.kept.set(account, secret)
  }
  async delete(account: string) {
    this.check()
    return this.kept.delete(account)
  }
}

export interface Setup {
  answers?: Answer[]
  env?: Record<string, string | undefined>
  stdin?: string
  terminal?: boolean
  typed?: string
  files?: Record<string, string>
  store?: MemoryStore
  now?: number
}

/**
 * The command line over fakes: `run` it with argv, then read what it asked
 * KeyGrant (`calls`), printed (`out`, `err`) and waited (`sleeps`). The
 * answers are given in order, and the test fails when it ends having made a
 * request past them, or left one unasked: the command made exactly the calls
 * the test scripted.
 */
export function harness(setup: Setup = {}) {
  const answers = [...(setup.answers ?? [])]
  const calls: Call[] = []
  const unscripted: string[] = []
  onTestFinished(() => {
    expect(unscripted, 'requests past the scripted answers').toEqual([])
    expect(answers.length, 'scripted answers never asked for').toBe(0)
  })
  const out: string[] = []
  const err: string[] = []
  const sleeps: number[] = []
  const prompts: string[] = []
  const store = setup.store ?? new MemoryStore()
  const deps: Deps = {
    async fetch(url, init) {
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
      const parsed = new URL(url)
      calls.push({
        method: init.method ?? 'GET',
        url,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        signal: init.signal,
      })
      const answer = answers.shift()
      if (answer === undefined) {
        unscripted.push(`${init.method} ${url}`)
        throw new Error(`no answer scripted for ${init.method} ${url}`)
      }
      if (answer instanceof Error) throw answer
      if (answer instanceof Response) return answer
      return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json', ...answer.headers },
      })
    },
    env: setup.env ?? { KEYGRANT_API_KEY: LIVE_KEY },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    readStdin: async () => setup.stdin ?? '',
    stdinIsTerminal: setup.terminal ?? false,
    promptSecret: async (question) => {
      prompts.push(question)
      return setup.typed ?? ''
    },
    readFile: async (path) => {
      const text = setup.files?.[path]
      if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
      return text
    },
    credentials: store,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    now: () => setup.now ?? NOW,
    randomId: () => 'run-1',
  }
  return {
    deps,
    calls,
    sleeps,
    prompts,
    store,
    /** Runs one command line; what it printed is this run's alone. */
    async run(...argv: string[]) {
      out.length = 0
      err.length = 0
      const code = await run(argv, deps)
      return { code, out: out.join('\n'), err: err.join('\n') }
    },
  }
}

/** A license as the tenant API answers it, with what a test changes. */
export function license(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'SLUICE-AAAA-BBBB-CCCC-DDDD',
    product: 'sluice',
    model: 'subscription',
    modelId: 'mod_annual',
    modelName: 'Annual',
    status: 'active',
    kind: 'active',
    test: false,
    email: 'jo@example.com',
    expiresAt: NOW + 10 * 86_400_000,
    term: null,
    validUntil: NOW + 13 * 86_400_000,
    deviceLimit: 3,
    activeDevices: 1,
    seats: 1,
    leaseDays: null,
    graceDays: 3,
    seatReleaseDays: null,
    createdAt: NOW - 86_400_000,
    revokedAt: null,
    revokedReason: null,
    versions: { minMajor: 1, maxMajor: null, upgradeUntil: null },
    versionRule: null,
    entitlements: { edition: 'pro' },
    ...overrides,
  }
}

/** A request as sent, less its abort signal (a new one each time): to tell a resent request from the first. */
export function request(call: Call | undefined): Omit<Call, 'signal'> | undefined {
  if (!call) return undefined
  const { signal: _signal, ...sent } = call
  return sent
}
