import { answers, isSecretKey, request, storeAccount, type Context } from '../api.js'
import { emit, positionals, type Command } from '../command.js'
import { StoreUnavailable } from '../deps.js'
import { CliError, EXIT } from '../errors.js'

/** A secret key as it may be shown: its prefix and four characters. */
export const masked = (key: string): string => `${key.slice(0, 12)}...`

/** The refusal where there is no credential store: say what to do instead. */
function noStore(ctx: Context, error: StoreUnavailable): CliError {
  return new CliError(
    EXIT.auth,
    `there is no credential store to keep the key in here (${error.message}). Set KEYGRANT_API_KEY in this environment instead, as a build pipeline does; nothing was kept`,
    { error: 'no-credential-store', message: error.message, store: ctx.deps.credentials.name },
  )
}

/** Runs `work` against the credential store, turning "there is none" into what to do instead. */
async function withStore<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof StoreUnavailable) throw noStore(ctx, error)
    throw error
  }
}

export const login: Command = {
  name: 'login',
  summary: 'Keep an API key in this machine\'s credential store.',
  help: `keygrant login

Asks for a secret API key (kg_live_... or kg_test_..., from the dashboard's API keys screen),
or reads it from standard input, checks it with KeyGrant, and keeps it in the operating
system's credential store (the macOS Keychain, the Windows Credential Manager, or the Secret
Service on Linux) for the KeyGrant address it was checked with. KEYGRANT_API_KEY, when set,
is used before it.

Where there is no credential store (a CI container, a server without a desktop session),
login says so and keeps nothing: set KEYGRANT_API_KEY there instead. --json prints
{ "origin", "mode", "key" (its first characters), "store", "products", "envKeyUsedFirst" }.`,
  options: {},
  async run(ctx, args) {
    positionals(args)
    const account = storeAccount(ctx.origin)
    // Before asking for anything: a machine with no store is told so at once.
    await withStore(ctx, () => ctx.deps.credentials.get(account))
    const key = (ctx.deps.stdinIsTerminal ? await ctx.deps.promptSecret('API key (kg_live_... or kg_test_...): ') : await ctx.deps.readStdin()).trim()
    if (!key) throw new CliError(EXIT.auth, 'no API key given', { error: 'no-api-key' })
    if (!isSecretKey(key)) throw new CliError(EXIT.auth, 'that is not a KeyGrant secret key (kg_live_... or kg_test_...)', { error: 'not-a-secret-key' })
    const checked = await request(ctx, 'GET', '/v1/products', { key, expect: answers.products })
    await withStore(ctx, () => ctx.deps.credentials.set(account, key))
    const mode = key.startsWith('kg_live_') ? 'live' : 'test'
    const count = Array.isArray(checked.products) ? checked.products.length : 0
    const envFirst = !!ctx.deps.env.KEYGRANT_API_KEY?.trim()
    emit(ctx, { origin: ctx.origin, mode, key: masked(key), store: ctx.deps.credentials.name, products: count, envKeyUsedFirst: envFirst }, () =>
      `Signed in to ${ctx.origin} with a ${mode} key (${masked(key)}), kept in ${ctx.deps.credentials.name}. The account has ${count} product${count === 1 ? '' : 's'}.`,
    )
    if (envFirst && !ctx.json) ctx.deps.err('Note: KEYGRANT_API_KEY is set here, and is used before the kept key.')
  },
}

export const logout: Command = {
  name: 'logout',
  summary: 'Remove the kept API key.',
  help: `keygrant logout

Removes the key \`keygrant login\` kept for this KeyGrant address. It leaves the key itself
working: revoke it on the dashboard's API keys screen to stop it. --json prints { "origin", "removed" }.`,
  options: {},
  async run(ctx, args) {
    positionals(args)
    const removed = await withStore(ctx, () => ctx.deps.credentials.delete(storeAccount(ctx.origin)))
    emit(ctx, { origin: ctx.origin, removed }, () => (removed ? `Removed the key kept for ${ctx.origin}.` : `No key was kept for ${ctx.origin}.`))
  },
}
