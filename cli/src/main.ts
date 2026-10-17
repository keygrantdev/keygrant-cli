import { osCredentialStore } from './keyring.js'
import { nodeDeps, quietOnClosedPipe } from './node-deps.js'
import { run } from './run.js'

/** The `keygrant` command as npm installs it: the operating system's credential store keeps a key `login` is given. */

quietOnClosedPipe()
process.exitCode = await run(process.argv.slice(2), nodeDeps(osCredentialStore(process.platform)))
