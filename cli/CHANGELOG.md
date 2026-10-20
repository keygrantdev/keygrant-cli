# Changelog

## 0.5.3

- `keygrant products` says "key pickup on" beside a product whose apps may restore a buyer's keys by an emailed
  code (key pickup); a product with it off prints as before.

## 0.5.2

- The Windows file on the GitHub release is signed with Authenticode. 0.5.1's could not be signed: its build
  injected the command into a copy of Node.js without first taking Node.js's own signature off, and the
  injection corrupted it. So 0.5.1's release has no Windows file. A release's notes now say when a signed
  platform has no file. The command itself is unchanged.

## 0.5.1

- The macOS files on the GitHub release are signed with a Developer ID and notarized by Apple. The Windows file
  could not be signed, so this release has none (0.5.2 has it). Each release after 0.5.0 says in its notes how
  its own files are signed. The command itself is unchanged.

## 0.5.0

- The command as one file for each platform (Linux x64 and arm64 with glibc 2.28 or later, so not Alpine, macOS on Apple silicon
  and Intel, Windows x64),
  with nothing to install: attached to each release on GitHub with its `.sha256`. It keeps no key, so it reads
  `KEYGRANT_API_KEY`.
- `licenses user-lock <key> <off|email|code>` sets who can activate a new device on a key: anyone with the
  key, only the buyer by the email the key was sold to, or only the buyer by that email and a code KeyGrant
  emails to it. Devices already activated are never asked. `--json` prints the API's answer. KeyGrant emails
  no code for a product that sends its own customer email, so use `email` there.
- A license printed in full says who can activate it, and when its lock is not asked (a test license, or a
  key with no email), that anyone can. `products` adds a column saying who can activate each model's keys,
  when any of the product's models locks them. The new row is the longest name, so a printed license's values
  now start four columns further right (`--json` is unchanged).
- `licenses test --scenario used-up` makes a test license whose first meter has no uses left.
- `licenses issue --meter <code=uses,...>` gives a key meters of its own in place of its model's (the uses,
  then any of `period`, `never` and `offline=<n|default>`), and `--no-meters` gives it none.
- `licenses uses` takes `--resets <never|period>` (whether a meter comes back each billing period) and
  `--remove` (takes the meter off the key, discarding its added uses and its count spent; adding it back
  starts it unused, and the app's `use()` of it is then refused as `no-meter`).
- `licenses devices <key>` lists the devices a license is active on: each one's activation id (what
  `licenses free-device` takes), name, platform, app version, last check-in, activation and, when the key
  frees unused seats, the time after which its seat is freed unless it checks in first (FREED AFTER). It
  reads KeyGrant's new `GET /v1/licenses/:key/activations`.
- Everything printed for people, errors included, shows control and direction characters as `?`, and `--json`
  writes the ones JSON leaves raw as escapes (a script parses the same value), so text an app sends (a
  device's name, say) cannot move the cursor or rewrite a row in your terminal.
- A license printed in full says how it was delivered (typed key, key file or license file), and `products`
  says when a model's keys are sent as a file.
- `email-required`, `user-lock-license-file`, `user-lock-test-key`, `no-meters` and
  `license-file-upgrade-protection` are named in a sentence.

## 0.4.0

- `licenses meters <key>` shows what a license counts: each meter's uses left, total, used and added, its
  offline allowance (and whether that is the default), when it resets and, when any meter has some, its
  overage. `--json` prints the API's answer.
- `licenses uses <key> <meter>` changes a meter with exactly one of `--add <n>`, `--set <n>`,
  `--offline <n|default>` and `--reset`. `--add` and `--reset` send an idempotency key (`--idempotency-key`,
  else one made for the run), and an error that may have changed the meter all the same names it.
- `licenses use <key> <meter> [n] [--id <id>]` spends a meter from your backend: exact, whole or none, and
  idempotent by its id (`--id`, else one made for the run, named by an error that may have spent all the
  same).
- A license printed in full shows its meters in a line, `products` lists a product's meters, what each
  license model counts and the uses a top-up adds, and `verify` prints a lease's meters.
- `license-revoked` is worded for a key that is spent from as well as for one that cannot be extended or
  sent a file; `used-up`, `unknown-meter`, `meter-not-periodic`, `license-expired` and the other meter
  refusals are named in a sentence.
- `verify` reads leases that carry meters (the `met` claim a metered license's lease signs). This was
  versioned 0.3.1 and never released on its own.

## 0.3.0

- `licenses file <key> [--out <path>] [--force] [--resign]` saves a key's license file or key file (a
  `.kglicense`) for a license model that delivers one: the file as KeyGrant keeps it while the key says the
  same, otherwise signed again with the current key. It writes `<product>-license.kglicense` in the current
  folder, or `--out`, readable by you alone on macOS and Linux, and refuses to replace a file that is there unless `--force`.
  `--resign` signs it again with the key that signs now, the remedy after a signing key leaked. `--json`
  prints the API's answer with the file's content left out, and the `path` it was saved to.
- `verify` takes a license file or key file too, as a path, its text on standard input or its token alone,
  and verifies it offline as every SDK does (the container, the header and its key id, the signature by that
  key alone, the claims). It prints the file's kind, product, licensee, key, versions, file id and the id of
  the key that signed it. A file never expires, so `--at` does not apply to one.
- `license-revoked` is worded for a key that is sent no file as well as for one that cannot be extended.
- `verify` of a `.kglicense` that cannot be read is exit 2, as an unreadable key set is.

## 0.2.0

- `licenses seat-release <key> <days|off>`: how many days, 1 to 365, a device of the license may go without
  checking in before its seat is freed, or `off` to keep every seat; never fewer than its offline days.
- `licenses issue --seat-release-days <n|off>` sets the same for the key it issues, in place of its model's.
- Every command that prints a license in full (`licenses get`, `checkout` of one key, `extend`, `versions`,
  `device-limit`, `seat-release` and `test`) shows its grace, its unused seats and its offline days.

## 0.1.0

- The first release of `keygrant`: `login` and `logout` (the key kept in the operating system's credential
  store, or `KEYGRANT_API_KEY`), `products`, `licenses issue`, `get`, `list`, `checkout`, `extend`,
  `versions`, `device-limit`, `revoke`, `free-device` and `test`, `release`, `pubkey` and `verify`.
- `--json` on every command prints its answer as JSON, the API's own where it has one; exit codes 0 to 5 say
  how a command ended.
- A `429` asking for up to two minutes is waited out once, unless `--no-retry`; a longer one exits 4 at once.
