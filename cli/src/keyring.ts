import { createRequire } from 'node:module'
import { StoreUnavailable, type CredentialStore } from './deps.js'

/** The service the keys are kept under, as the credential store's own screens show it. */
export const SERVICE = 'KeyGrant CLI'

interface AsyncEntry {
  getPassword(): Promise<string | undefined | null>
  setPassword(password: string): Promise<void>
  deletePassword(): Promise<boolean>
}
type EntryClass = new (service: string, account: string, options: typeof ENTRY_OPTIONS) => AsyncEntry

/**
 * On Linux, the Secret Service and nothing else. Left to choose, the module
 * falls back to the kernel keyring without saying so, which keeps a key only in
 * memory until the next restart; required, a missing Secret Service is an error
 * (`StoreUnavailable`), and `login` says to use KEYGRANT_API_KEY instead. Other
 * platforms ignore it.
 */
export const ENTRY_OPTIONS = { linux: { store: 'secret-service' } } as const

/** What a person calls this platform's store. */
export function storeName(platform: string): string {
  if (platform === 'darwin') return 'the macOS Keychain'
  if (platform === 'win32') return 'the Windows Credential Manager'
  return 'the Secret Service keyring'
}

/**
 * The operating system's credential store, through @napi-rs/keyring, loaded
 * only when a command needs a key: an optional dependency, so a machine it
 * cannot be installed on still runs every command with KEYGRANT_API_KEY. A
 * binding that will not load, or a store that cannot be reached (Linux with no
 * Secret Service, a container with no session bus), is `StoreUnavailable`:
 * every entry is made inside `reach`, so one whose constructor refuses is too.
 */
export function osCredentialStore(platform: string, load: () => unknown = defaultLoad): CredentialStore {
  let entryClass: EntryClass | null = null
  const entry = (account: string): AsyncEntry => {
    if (!entryClass) {
      let loaded: unknown
      try {
        loaded = load()
      } catch (error) {
        throw new StoreUnavailable(`the credential store module is not installed for this platform (${reason(error)})`)
      }
      const found = (loaded as { AsyncEntry?: unknown } | null)?.AsyncEntry
      if (typeof found !== 'function') throw new StoreUnavailable('the credential store module has no AsyncEntry')
      entryClass = found as EntryClass
    }
    return new entryClass(SERVICE, account, ENTRY_OPTIONS)
  }
  const reach = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      if (error instanceof StoreUnavailable) throw error
      throw new StoreUnavailable(reason(error))
    }
  }
  return {
    name: storeName(platform),
    get: (account) => reach(async () => (await entry(account).getPassword()) ?? null),
    set: (account, secret) => reach(() => entry(account).setPassword(secret)),
    delete: (account) => reach(() => entry(account).deletePassword()),
  }
}

function defaultLoad(): unknown {
  return createRequire(import.meta.url)('@napi-rs/keyring')
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown'
