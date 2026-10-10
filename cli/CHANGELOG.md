# Changelog

## 0.1.0

- The first release of `keygrant`: `login` and `logout` (the key kept in the operating system's credential
  store, or `KEYGRANT_API_KEY`), `products`, `licenses issue`, `get`, `list`, `checkout`, `extend`,
  `versions`, `device-limit`, `revoke`, `free-device` and `test`, `release`, `pubkey` and `verify`.
- `--json` on every command prints its answer as JSON, the API's own where it has one; exit codes 0 to 5 say
  how a command ended.
- A `429` asking for up to two minutes is waited out once, unless `--no-retry`; a longer one exits 4 at once.
