# keygrant

The `keygrant` command works with [KeyGrant](https://keygrant.dev) licenses from a terminal or a build
pipeline: issue, find and change licenses, make test licenses, report a release, fetch a product's public
keys, and verify a lease offline.

```sh
npx @keygrant/cli --help
# or
npm install --global @keygrant/cli
keygrant --help
```

Node.js 22 or later.

## Signing in

The command uses one of your account's secret API keys (`kg_live_...` or `kg_test_...`, from the
dashboard's **API keys** screen), never your dashboard sign-in.

- **On your own machine:** run `keygrant login`, paste the key, and it is checked with KeyGrant and kept
  in the operating system's credential store: the macOS Keychain, the Windows Credential Manager, or the
  Secret Service (GNOME Keyring, KWallet) on Linux. `keygrant logout` removes it.
  On Linux the Secret Service is required: a machine without one (no desktop session, WSL) has no store
  that outlives a restart, so the key is not kept there.
- **In a build pipeline or a container:** set `KEYGRANT_API_KEY` from the pipeline's secrets. Where there
  is no credential store, `keygrant login` says so and keeps nothing.

`KEYGRANT_API_KEY`, when set, is used before a kept key. A `kg_test_` key issues and reaches test licenses
only; a release needs a `kg_live_` key.

## Commands

| Command | Does |
|---|---|
| `keygrant products` | Your products, with their license models and each model's id |
| `keygrant licenses issue --product <id> --model <model id>` | Issue a key (`--count` for several, as one sale) |
| `keygrant licenses get <key>` | One license |
| `keygrant licenses list [--product] [--email] [--status] [--all]` | Licenses, newest first |
| `keygrant licenses checkout <cs_...>` | The license a Stripe checkout made |
| `keygrant licenses extend <key> --to <date>` or `--days <n>` | Move its expiry later |
| `keygrant licenses versions <key> --min <n> --max <n\|none>` | Set the major versions it covers |
| `keygrant licenses device-limit <key> <n>` | Set how many devices it may be active on |
| `keygrant licenses seat-release <key> <days\|off>` | Set how many days an unused device keeps its seat before it is freed, or `off` |
| `keygrant licenses revoke <key> [--reason <reason>]` | Revoke it |
| `keygrant licenses free-device <key> <activation id>` | Free one device |
| `keygrant licenses test --product <id> --scenario <state>` | A test license: `valid`, `trial-ending`, `expired`, `revoked` or `device-limit` |
| `keygrant release <version> --product <id>` | Tell KeyGrant you shipped a version |
| `keygrant pubkey <product id>` | The product's public key set, the JSON your app embeds |
| `keygrant verify <lease> --key <file>` | Verify a lease against a key set, with no network |

`keygrant <command> --help` gives every option of a command.

```sh
# A release script
keygrant release "$VERSION" --product my-app

# The key set to build into the app
keygrant pubkey my-app > src/keygrant-keys.json

# A test license whose device limit is already reached, to see how the app handles it
keygrant licenses test --product my-app --scenario device-limit

# Check a lease the app stored, offline
keygrant verify ./lease.txt --key src/keygrant-keys.json --product my-app
```

Dates are `2027-01-31` (through that whole day, in UTC; for `verify --at`, its first moment), a date and time in ISO 8601 with its offset
(`2027-01-31T12:00:00Z`), or milliseconds since the epoch (13 digits; ten, the seconds habit, are refused). `extend --days` counts from the later of now and the license's current expiry. A timed license still
waiting for its first activation has no expiry to move yet.

## For scripts

Every command takes `--json` and prints what the API answered (a command's `--help` says when it prints an
object of its own: `login`, `logout`, `verify`, a filtered `products`, every page of `licenses list --all`).
When something fails, `--json` prints the error on standard error, as `{ "error": "<code>", ... }` with
`"status"` when KeyGrant answered, and nothing else there; without it, a sentence that starts with the code.

| Exit code | Means |
|---|---|
| 0 | Done |
| 1 | KeyGrant refused the request (the code says why), a lease is not valid, or something else failed |
| 2 | The command line is wrong |
| 3 | No API key, a key KeyGrant does not accept, or no credential store for `login` |
| 4 | Rate limited |
| 5 | KeyGrant could not be reached, or failed |

**Rate limits.** When KeyGrant answers `429`, the command waits as long as the answer says, says so on
standard error (not under `--json`), and tries once more; a second `429` exits 4 with the wait. A `429`
asking for more than two minutes is not waited out: it exits 4 at once. KeyGrant counts a request before it
does anything, so the retry never does a thing twice. `--no-retry` exits 4 at once instead.

**Retries of your own.** `licenses issue` and `licenses test` send an idempotency key: one made for each
run, or yours with `--idempotency-key`, so running the same command again with the same key answers the
license first made instead of making another. When one of them fails in a way that may have made the license
all the same (exit 5: KeyGrant could not be reached, or failed), the error names the key it made
(`idempotencyKey` under `--json`): run the command again with `--idempotency-key` and that key. `licenses
extend` sends the new expiry as an instant, so running it again with `--to` changes nothing more.

## Options every command takes

| Option | |
|---|---|
| `--json` | Print the answer as JSON (see "For scripts") |
| `--api-url <url>` | KeyGrant's address; `KEYGRANT_API_URL` too. `https://` only, or `http://` for `localhost`, `127.0.0.1` or `[::1]` |
| `--no-retry` | Do not wait out a `429` |
| `-h`, `--help` | The command's help |

## License

MIT: see [LICENSE](LICENSE).
