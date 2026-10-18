# The KeyGrant command line

`@keygrant/cli` is the `keygrant` command: it works with [KeyGrant](https://keygrant.dev) licenses from a
terminal or a build pipeline. Issue, find and change licenses and the meters they count, make test licenses,
report a release, fetch a product's public keys, and verify a lease offline.

```sh
npx @keygrant/cli --help
```

How to use it is in [cli/README.md](cli/README.md), and the full guide is at https://keygrant.dev/docs.

## Building from source

```sh
corepack enable
pnpm install
pnpm test
pnpm run typecheck
pnpm run check:package
```

- `cli/` is the package.
- `shared/` is the lease format it bundles.
- `conformance/vectors.json` is the behavior every KeyGrant SDK reproduces; `keygrant verify` is tested
  against it.

## Releases

Each release is a version tag (`0.1.0`). The tag runs `.github/workflows/publish.yml`, which builds and
checks the package and publishes it to npm through npm's trusted publishing, with provenance, and from
0.5.0 builds the command as one file for each platform and attaches the files, with their `.sha256`, to the
tag's release here (the Linux files need glibc 2.28 or later, so not Alpine). From 0.5.1 the macOS files
are signed with a Developer ID and notarized by Apple, and from 0.5.2 the Windows file is signed with
Authenticode.
Each release after 0.5.0 says in its notes how its own files are signed. A file keeps no key: it reads `KEYGRANT_API_KEY`.

## License

MIT: see [LICENSE](LICENSE).
