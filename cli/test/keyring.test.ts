import { describe, expect, it } from 'vitest'
import { StoreUnavailable } from '../src/deps.js'
import { ENTRY_OPTIONS, osCredentialStore, SERVICE, storeName } from '../src/keyring.js'

/** A stand-in for @napi-rs/keyring: AsyncEntry over a map, each entry recording what it was made for; `refuse` makes its constructor throw, as a required store that is missing does. */
function fakeModule(fail: Error | null = null, refuse: Error | null = null) {
  const kept = new Map<string, string>()
  const made: [string, string, unknown][] = []
  class AsyncEntry {
    constructor(
      private readonly service: string,
      private readonly account: string,
      options: unknown,
    ) {
      if (refuse) throw refuse
      made.push([service, account, options])
    }
    private get id() {
      return `${this.service}|${this.account}`
    }
    async getPassword() {
      if (fail) throw fail
      return kept.get(this.id)
    }
    async setPassword(password: string) {
      if (fail) throw fail
      kept.set(this.id, password)
    }
    async deletePassword() {
      if (fail) throw fail
      return kept.delete(this.id)
    }
  }
  return { module: { AsyncEntry }, kept, made }
}

describe('the operating system\'s credential store', () => {
  it('keeps, reads and removes a key under the KeyGrant CLI service and the address as its account', async () => {
    const fake = fakeModule()
    const store = osCredentialStore('darwin', () => fake.module)
    expect(await store.get('https://api.keygrant.dev')).toBeNull()
    await store.set('https://api.keygrant.dev', 'kg_live_1')
    expect(await store.get('https://api.keygrant.dev')).toBe('kg_live_1')
    expect(await store.delete('https://api.keygrant.dev')).toBe(true)
    expect(await store.delete('https://api.keygrant.dev')).toBe(false)
    const entry = [SERVICE, 'https://api.keygrant.dev', ENTRY_OPTIONS]
    expect(fake.made).toEqual([entry, entry, entry, entry, entry])
    // On Linux, the Secret Service required: never the kernel keyring, which forgets at a restart.
    expect(ENTRY_OPTIONS).toEqual({ linux: { store: 'secret-service' } })
  })

  it('loads the module once, and only when a key is asked for', async () => {
    let loads = 0
    const fake = fakeModule()
    const store = osCredentialStore('win32', () => {
      loads++
      return fake.module
    })
    expect(loads).toBe(0)
    await store.get('a')
    await store.set('a', 'k')
    expect(loads).toBe(1)
  })

  it('is unavailable, with the first line of why, when the module will not load, has no AsyncEntry, or the store cannot be reached', async () => {
    const reasonOf = async (work: Promise<unknown>) => {
      const error = await work.then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(StoreUnavailable)
      return (error as Error).message
    }
    const missing = osCredentialStore('linux', () => {
      throw new Error('Cannot find module @napi-rs/keyring-linux-x64-musl\nRequire stack: ...')
    })
    expect(await reasonOf(missing.get('a'))).toBe('the credential store module is not installed for this platform (Cannot find module @napi-rs/keyring-linux-x64-musl)')
    expect(await reasonOf(osCredentialStore('linux', () => ({})).get('a'))).toBe('the credential store module has no AsyncEntry')
    const noBus = osCredentialStore('linux', () => fakeModule(new Error('Platform secure storage failure: DBus error')).module)
    expect(await reasonOf(noBus.set('a', 'k'))).toBe('Platform secure storage failure: DBus error')
    expect(await reasonOf(noBus.delete('a'))).toBe('Platform secure storage failure: DBus error')
    const noSecretService = osCredentialStore('linux', () => fakeModule(null, new Error('No Secret Service on this machine')).module)
    expect(await reasonOf(noSecretService.get('a'))).toBe('No Secret Service on this machine')
    expect(await reasonOf(noSecretService.set('a', 'k'))).toBe('No Secret Service on this machine')
  })

  it('says a loader\'s own reason when it knows why there is no store, as the single binary\'s does', async () => {
    const binary = osCredentialStore('win32', () => {
      throw new StoreUnavailable('this single binary carries no credential store')
    })
    for (const work of [binary.get('a'), binary.set('a', 'k'), binary.delete('a')]) {
      const error = await work.then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(StoreUnavailable)
      expect((error as Error).message).toBe('this single binary carries no credential store')
    }
  })

  it('names the store as each platform calls it', () => {
    expect(storeName('darwin')).toBe('the macOS Keychain')
    expect(storeName('win32')).toBe('the Windows Credential Manager')
    expect(storeName('linux')).toBe('the Secret Service keyring')
  })
})
