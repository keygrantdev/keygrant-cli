# Changelog

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

## 0.3.1

- `verify` reads leases that carry meters (the `met` claim a metered license's lease signs). Nothing else
  changes for its users.

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
