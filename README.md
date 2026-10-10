# The KeyGrant command line

`@keygrant/cli` is the `keygrant` command: it works with [KeyGrant](https://keygrant.dev) licenses from a
terminal or a build pipeline. Issue, find and change licenses, make test licenses, report a release, fetch a
product's public keys, and verify a lease offline.

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
checks the package and publishes it to npm through npm's trusted publishing, with provenance.

## License

MIT: see [LICENSE](LICENSE).
