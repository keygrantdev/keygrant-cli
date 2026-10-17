import { StoreUnavailable } from './deps.js'
import { osCredentialStore } from './keyring.js'
import { nodeDeps, quietOnClosedPipe } from './node-deps.js'
import { run } from './run.js'

/**
 * The `keygrant` command as one executable file (scripts/build-binary.mjs): Node's single executable applications,
 * which run one CommonJS script and load no module from disk, so the credential store's native module is not there.
 * Every command that needs a key reads KEYGRANT_API_KEY, and `login` says there is no store to keep one in.
 */

/** Why no key is kept here, as `login` and a command missing its key say it. */
export const NO_STORE = 'this single binary carries no credential store'

quietOnClosedPipe()
const credentials = osCredentialStore(process.platform, () => {
  throw new StoreUnavailable(NO_STORE)
})
void run(process.argv.slice(2), nodeDeps(credentials)).then((code) => {
  process.exitCode = code
})
