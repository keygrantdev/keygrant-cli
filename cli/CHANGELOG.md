# Changelog

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
