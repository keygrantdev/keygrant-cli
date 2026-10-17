# keygrant

The `keygrant` command works with [KeyGrant](https://keygrant.dev) licenses from a terminal or a build
pipeline: issue, find and change licenses, show and change what a license counts (its meters), spend a
meter from your backend, make test licenses, report a release, fetch a product's public keys, save a key's
license file or key file, and verify a lease, a license file or a key file offline.

```sh
npx @keygrant/cli --help
# or
npm install --global @keygrant/cli
keygrant --help
```

Node.js 22 or later.

## A single file

From 0.5.0 each release also has the command as one file for each platform, with nothing to install, not
even Node.js: Linux (x64 and arm64, glibc 2.28 or later, so not Alpine), macOS (Apple silicon and Intel)
and Windows (x64), on the release page of
[keygrantdev/keygrant-cli](https://github.com/keygrantdev/keygrant-cli/releases). Download the one for your
machine and its `.sha256`, check one against the other, and put the file on your PATH as `keygrant`:

```sh
# Linux (the file for 0.5.0 on x64; use the version and machine you downloaded)
sha256sum -c keygrant-0.5.0-linux-x64.sha256
mkdir -p ~/.local/bin && install -m 755 keygrant-0.5.0-linux-x64 ~/.local/bin/keygrant

# macOS
shasum -a 256 -c keygrant-0.5.0-macos-arm64.sha256
mkdir -p ~/.local/bin && install -m 755 keygrant-0.5.0-macos-arm64 ~/.local/bin/keygrant
```

`~/.local/bin` must be on your PATH (add `export PATH="$HOME/.local/bin:$PATH"` to your shell's profile if
it is not); any other folder on your PATH works as well.

On Windows, compare `Get-FileHash keygrant-0.5.0-windows-x64.exe` with the `.sha256`, rename the file to
`keygrant.exe` and put it in a folder on your PATH.

It does everything the npm package does but keep a key: it carries no credential store, so set
`KEYGRANT_API_KEY`, as a build pipeline does (`keygrant login` says so). The macOS file is signed ad hoc,
not notarized: if macOS stops it the first time, `xattr -d com.apple.quarantine <file>` lets it run. The
Windows file is not signed, so Windows may ask before running it.

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
| `keygrant licenses user-lock <key> <off\|email\|code>` | Set who can activate a new device on it: anyone with the key, or only the buyer |
| `keygrant licenses file <key> [--out <path>] [--force] [--resign]` | Save the key's license file or key file (a `.kglicense`), for a license model that delivers a file |
| `keygrant licenses meters <key>` | What the license counts: each meter's uses left, total, used, offline allowance and period |
| `keygrant licenses uses <key> <meter> --add <n>` (or `--set <n>`, `--offline <n\|default>`, `--resets <never\|period>`, `--reset`, `--remove`) | Add uses to a meter, set its uses, its offline allowance or whether it comes back each period, start a new period, or take it off the key |
| `keygrant licenses use <key> <meter> [n] [--id <id>]` | Spend a meter from your backend |
| `keygrant licenses revoke <key> [--reason <reason>]` | Revoke it |
| `keygrant licenses devices <key>` | The devices it is active on, with each one's activation id |
| `keygrant licenses free-device <key> <activation id>` | Free one device (`licenses devices` lists the ids) |
| `keygrant licenses test --product <id> --scenario <state>` | A test license: `valid`, `trial-ending`, `expired`, `revoked`, `device-limit` or `used-up` |
| `keygrant release <version> --product <id>` | Tell KeyGrant you shipped a version |
| `keygrant pubkey <product id>` | The product's public key set, the JSON your app embeds |
| `keygrant verify <lease \| license file> --key <file>` | Verify a lease, a license file or a key file against a key set, with no network |

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

# Save the license file of a key sold as a file, to send it yourself
keygrant licenses file MYAPP-AAAA-BBBB-CCCC-DDDD --out ./files/ada.kglicense

# Check a license file or key file a buyer was sent, offline: its kind, product, licensee, versions,
# file id and the key that signed it (the key set must hold every key that ever signed a file)
keygrant verify ./my-app-license.kglicense --key src/keygrant-keys.json --product my-app

# Give a customer 500 more exports, once, however often the command runs
keygrant licenses uses MYAPP-AAAA-BBBB-CCCC-DDDD exports --add 500 --idempotency-key support-ticket-4812

# Spend 3 renders for a customer from your own server, once per render
keygrant licenses use MYAPP-AAAA-BBBB-CCCC-DDDD renders 3 --id render-9f2c1a77-0001
```

## Metered licenses

A license model can count uses of what it sells: 1,000 exports for good, or 50 renders each month a
subscription is paid. Each thing counted is a **meter**, with a code your app passes to `use()`. Your app
spends its own meters through the SDK; the command line is for you.

- `keygrant licenses meters <key>` prints each meter of a license: what is **left**, the **total** (the uses
  it holds, added ones included), what is **used** and what was **added** on top, the **offline** allowance
  a device may spend while KeyGrant cannot be reached (`(default)` when the key sets none of its own), when
  it **resets** (`never`, or each billing period and where this one ends), and the **overage** (spent past
  the total, which only reports from offline can make) when any meter has some. `keygrant licenses get` shows
  the same in a line, and `keygrant products` lists a product's meters, what each model counts (`exports
  1,000`, `renders 50 a period`) and the uses a top-up adds (`+500 exports`).
- `keygrant licenses uses <key> <meter>` changes one meter with exactly one of `--add <n>` (more uses on
  top of the key's own, a top-up by hand), `--set <n>` (the key's own uses; a meter the key lacks but its
  product has is added), `--offline <n|default>` (the most a device may spend with no answer from KeyGrant),
  `--resets <never|period>` (used up for good, or back each billing period on a subscription key), `--reset`
  (a new period now, on a meter that comes back each billing period) and `--remove` (the meter off the key,
  discarding the uses added on top and the count of what was spent; adding it back starts it unused,
  offline spends a device reports while the meter is off the key are not counted, and the app's `use()` of
  it is then refused as `no-meter`). `--add` and `--reset`
  send an idempotency key, one made for each run or yours with `--idempotency-key`, so running the same
  command again with the same key changes nothing more; when one of them fails in a way that may have gone
  through all the same (exit 5), the error names the key it made. A set is its own retry; a removal run again
  answers `unknown-meter`, the meter being gone already. The app sees a change at its next check-in.
- `keygrant licenses issue --meter <code=uses,...>` gives the new key meters of its own in place of its
  model's, one `--meter` each: the uses, then any of `period`, `never` and `offline=<n|default>`
  (`--meter renders=50,period,offline=5`); `--no-meters` gives it none.
- `keygrant licenses use <key> <meter> [n]` spends `n` uses (1 by default) from your own backend, a cloud
  render the key pays for: your secret key is the proof, so no device is asked. It is exact and whole or
  none: when fewer than `n` are left it exits 1 with `used-up` and how many are. `--id` is the spend's id
  (16 to 64 letters, digits, hyphens and underscores), one made for each run otherwise: the same id again
  answers as the first spend did and spends nothing more, and an error that may have spent all the same
  (exit 5) names the id it made. It prints the spend's id, which `--json` does not.
- `keygrant verify` prints a lease's meters, what was left of each when the lease was signed.
- `keygrant licenses test --scenario used-up` makes a test license whose first meter has no uses left, from
  the product's first model that issues keys, is not archived and counts uses (or `--model`); a model that
  counts nothing is `no-meters`.

## Who can activate

A license model can lock its keys to the buyer, known by the email on the key: `email` asks a new device for
that email, and `code` also for a six-digit code KeyGrant emails to it. Only a new device is ever asked:
devices already activated keep working, offline too. Your app sends the email and the code when it
activates, `activate(key, { email, code })` in `@keygrant/electron` 0.7.0 and later, the same in each other
KeyGrant SDK's own form from 0.6.0.

- `keygrant licenses get` shows who can activate a key, and says when its lock is never asked: a test
  license, or a key with no email, activates as anyone's. `keygrant products` adds a column saying who can
  activate each model's keys, when any of the product's models locks them.
- `keygrant licenses user-lock <key> <off|email|code>` sets it for one key, in place of its model's. A key
  with no email (`email-required`), a test license (`user-lock-test-key`) and a key sent as an offline
  license file (`user-lock-license-file`) cannot be locked; `off` is always allowed. Issuing a live key
  under a model that locks needs `--email`.
- KeyGrant emails no code for a product that sends its own customer email: a new device on a `code` key is
  told `try-again` and cannot activate, so use `email` there, or let KeyGrant send the product's email. A
  key file carries the buyer's email, so whoever has the file has it: where KeyGrant sends the product's
  email, use `code` for a key sent as a key file.

## License files and key files

A license model can deliver a key as a file (`.kglicense`) instead of typed text. A **key file** carries the
key, and an app that takes it activates the key online as it would a typed one; a **license file** licenses
the app offline, for good, on any number of computers. The buyer is emailed the file when they buy.

`keygrant licenses file <key>` saves the same file: as it was kept while the key says the same, otherwise
signed again with the current signing key. It writes `<product>-license.kglicense` in the current folder
(`--out <path>` for another place), readable by you alone on macOS and Linux, and refuses to replace a file that is there unless
you add `--force`. `--resign` signs it again with the key that signs now (its id kept while it grants the
same): the remedy after a signing key leaked, and the file must then be sent to the buyer again. Each call is
in the license's history. KeyGrant refuses a key delivered typed (`not-a-file-license`), a key with no email
address (`no-licensee`), a revoked key (`license-revoked`) and an offline file's key that ends
(`license-expires`). `--json` prints the answer with the file's content left out, and the `path` it was saved to.

`keygrant verify` reads a license file or key file as an app does, with no network: the file as a path, its
text on standard input (`-`), or its token alone. A file named `.kglicense`, or whose token says in its header
that it is a license file's, is read as one. The text must be valid UTF-8 with one token (notes on lines
starting with `#` are ignored), then the key id it names must be in the key set, its signature must be by that
key, and its claims must be a license file's. It prints the file's kind, product, licensee, key, versions (an
offline file), file id and the id of the key that signed it, and exits 0 for a valid file and 1 for one that
is not. `--at` does not apply: a file never expires. The key set from `keygrant pubkey <product>` holds every
key that ever signed a file, so a file signed before a key rotation still verifies.

Dates are `2027-01-31` (through that whole day, in UTC; for `verify --at`, its first moment), a date and time in ISO 8601 with its offset
(`2027-01-31T12:00:00Z`), or milliseconds since the epoch (13 digits; ten, the seconds habit, are refused). `extend --days` counts from the later of now and the license's current expiry. A timed license still
waiting for its first activation has no expiry to move yet.

## For scripts

Every command takes `--json` and prints what the API answered (a command's `--help` says when it prints an
object of its own: `login`, `logout`, `verify`, `licenses file`, a filtered `products`, every page of `licenses list --all`).
When something fails, `--json` prints the error on standard error, as `{ "error": "<code>", ... }` with
`"status"` when KeyGrant answered, and nothing else there; without it, a sentence that starts with the code.

| Exit code | Means |
|---|---|
| 0 | Done |
| 1 | KeyGrant refused the request (the code says why), a lease or license file is not valid, or something else failed |
| 2 | The command line is wrong, a file it names cannot be read or written, or `licenses file` would replace a file without `--force` |
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
