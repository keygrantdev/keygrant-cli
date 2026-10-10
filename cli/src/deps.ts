/**
 * Everything the command line reaches outside itself, handed in, so the same
 * commands run in Node (main.ts) and under test with a fetch of the test's own.
 */
export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  env: Readonly<Record<string, string | undefined>>
  /** Standard output and standard error, a whole line or block at a time. */
  out: (text: string) => void
  err: (text: string) => void
  /** Standard input, read to its end. */
  readStdin: () => Promise<string>
  /** Whether a person is at standard input (a terminal), not a pipe. */
  stdinIsTerminal: boolean
  /** Asks a person for a secret on the terminal, without echoing it. */
  promptSecret: (question: string) => Promise<string>
  /** A file's text; rejects when it cannot be read. */
  readFile: (path: string) => Promise<string>
  credentials: CredentialStore
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** A random id, for the idempotency key a run sends. */
  randomId: () => string
}

/**
 * The operating system's credential store, holding one API key per KeyGrant
 * address. Every method rejects with `StoreUnavailable` where there is none.
 */
export interface CredentialStore {
  /** What a person calls it: "the macOS Keychain". */
  readonly name: string
  get(account: string): Promise<string | null>
  set(account: string, secret: string): Promise<void>
  /** True when a key was there to remove. */
  delete(account: string): Promise<boolean>
}

/** There is no credential store to use here (a CI container, a Linux machine without a Secret Service). */
export class StoreUnavailable extends Error {}
