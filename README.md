# @thirtified/eudi-dev

[![CI](https://github.com/thirtified/eudi-dev-node/actions/workflows/ci.yml/badge.svg)](https://github.com/thirtified/eudi-dev-node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@thirtified/eudi-dev)](https://www.npmjs.com/package/@thirtified/eudi-dev)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Typed Node.js wrapper for the [eudi-dev](https://github.com/eudi-dev/eudi-dev) CLI (Apache-2.0). It is built for integration tests that need to issue, decode and validate EUDI credentials (SD-JWT VC, JWT VC, mdoc) and work with the wallet's trusted lists and registrar.

The package does not bind to the Go code. It runs the CLI with `--json`, which upstream treats as a stable interface (ADR 0020): exactly one JSON document on stdout, messages on stderr, and within a major version fields are only added, never removed.

**Scope:** CLI commands only. It does not start `wallet serve` and has no HTTP client for the wallet API.

Targets eudi-dev **v3.10.1**. Any v3.x binary is accepted. No runtime dependencies besides the platform package with the binary.

## Install

```bash
pnpm add -D @thirtified/eudi-dev
# or: npm install --save-dev @thirtified/eudi-dev
```

The eudi-dev binary comes in one npm package per platform, listed as `optionalDependencies` with exact versions. The package manager installs only the one that matches your OS and CPU. Nothing is downloaded at install time or at runtime, and there is no install script.

| Platform | Package | Upstream asset |
|---|---|---|
| macOS arm64 | `@thirtified/eudi-dev-darwin-arm64` | `eudi-v3.10.1-darwin-arm64` |
| macOS x64 | `@thirtified/eudi-dev-darwin-x64` | `eudi-v3.10.1-darwin-amd64` |
| Linux x64 | `@thirtified/eudi-dev-linux-x64` | `eudi-v3.10.1-linux-amd64` |
| Linux arm64 | `@thirtified/eudi-dev-linux-arm64` | `eudi-v3.10.1-linux-arm64` |

Windows isn't supported yet. Upstream publishes `eudi-v3.10.1-windows-amd64.exe`, and you can point `EUDI_DEV_BIN` at it, but the wrapper is untested on Windows.

Each package contains the upstream release binary unchanged, checked against the release's `checksums.txt` (SHA-256) when it was built, plus upstream's Apache-2.0 `LICENSE`. Its README and the `eudiDev` field in its `package.json` record the release and the hash.

The binary is found in this order:

1. the `bin` option of `EudiDev.create()`
2. the `EUDI_DEV_BIN` environment variable, for example a binary from `go build` or Homebrew
3. the platform package

### If the platform package is missing

`EudiDev.create()` throws an `EudiDevBinaryError` that names the package. The usual causes:

- Optional dependencies were left out (npm `--omit=optional`, pnpm `--no-optional`, or `omit=optional` in `.npmrc`). Install without leaving them out.
- `package-lock.json` was created on another OS and has no entry for your platform's package ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). Delete `node_modules` and `package-lock.json` and run `npm install` again. pnpm's lockfile lists every platform, so this doesn't happen with pnpm.
- `node_modules` was installed on another platform than the one it runs on, for example on a Mac and then mounted into a Linux container. With pnpm, list both platforms under `supportedArchitectures` in `pnpm-workspace.yaml`. With npm, install inside the container.
- Your platform isn't one of the four above. Set `EUDI_DEV_BIN`.

With Yarn PnP the packages are unplugged (`preferUnplugged`), so the binary is a real file on disk.

The macOS binaries are ad-hoc signed by the Go linker, not notarised. Files installed by npm or pnpm carry no quarantine attribute, so they run.

## Usage

```ts
import { EudiDev } from '@thirtified/eudi-dev';

await using eudi = await EudiDev.create(); // own temp EUDI_DEV_HOME, removed on dispose

// Issue with an ephemeral key, then decode and validate
const { credential, publicJwk } = await eudi.issue.sdjwt({ pid: true, omit: ['sex'] });
const decoded = await eudi.decode(credential);
const result = await eudi.validate(credential, { key: publicJwk, haip: true });
result.valid;               // false when a type/expiry/integrity/signature/status check fails
result.error;               // "signature: ..." for the first failing check
result.report.checks;       // every check, typed
result.report.haipFindings; // informational

// DCQL query for every claim of a credential
const query = await eudi.dcql(credential);

// mdoc and plain JWT VC
await eudi.issue.mdoc({ pid: true, docType: 'eu.europa.ec.eudi.pid.1' });
await eudi.issue.jwt({ claims: { name: 'Test', age: 30 } });
```

A failing `validate` does **not** throw. It returns `valid: false` along with the report. Everything else throws `EudiDevError` when the command fails.

### Inputs

Commands that read a credential take an `Input`:

- `string | Uint8Array`: the content itself, sent on stdin, so there is no argv length limit
- `{ path }`: a file. It must exist, because upstream would read a missing path as raw input.
- `{ url }`: an http(s) URL that eudi-dev fetches

File-valued options (`key`, `trustedList`, `cert`, `csr`, `dcql`, `claims`, `ca`) take the content, `{ path }`, or `{ url }` where upstream accepts one. Content is written to a private temp file for the duration of the call. JSON options (`claims`, a JWK `key`, a DCQL `dcql`) also accept plain objects.

### Wallet, trust and registrar (local state)

These commands work on the wallet in the instance's `EUDI_DEV_HOME`, which is created on first use. Pass `home` to keep state between instances.

```ts
const issued = await eudi.issue.sdjwt({ pid: true, wallet: true }); // issued.id
const trustedList = await eudi.trust.show({ vct: 'urn:eudi:pid:1' }); // signed JWT
await eudi.validate(issued.credential, { trustedList, statusList: false });

const caPem = await eudi.trust.caCert();
const caJwks = await eudi.trust.caJwks();

const rp = await eudi.registrar.verifiers.add({ name: 'Shop', purpose: 'Age check', dcql: query });
const id = rp.identifier[0]!.identifier;
const { registrationCertificate, verifierInfo } = await eudi.registrar.registrationCert({ identifier: id });
await eudi.registrar.revoke({ identifier: id });
await eudi.registrar.issuers.add({ name: 'Diplomas Inc', attestations: ['dc+sd-jwt:urn:example:diploma:1'] });
await eudi.registrar.accessCert({ identifier: id, csr: { path: 'verifier.csr' } });
await eudi.registrar.enrol({ relyingParty: { tradeName: 'X' }, access: { csr: csrPem } });
```

A wallet-issued credential points to the wallet's own status list, which only `wallet serve` serves. Without a running server, validate it with `statusList: false`.

### Escape hatches

- Every wrapper takes `extraArgs` for flags it doesn't model, plus `timeoutMs` and `signal`.
- `eudi.run<T>(['templates', 'list'])` runs any command with `--json` and returns `{ document, stdout, stderr }`.
- `new Runner({ bin, home })` gives the bare runner without the version check.
- `resolveBinary()` returns the binary path the lookup above finds, and `platformPackage()` the package for a platform.

### Isolation

Each call runs with:

- `EUDI_DEV_HOME` set to the instance's home
- `NO_COLOR=1` and `--no-color`
- every inherited `EUDI_DEV_*` variable removed, so a developer's `EUDI_DEV_STORAGE` or `EUDI_DEV_SEED` cannot change results. Opt out with `inheritEudiEnv: true`. Add variables with `env`.

`EudiDev.create()` runs `eudi version` and refuses a major version other than 3 unless you pass `allowAnyVersion: true`. `dev` builds are accepted.

### Errors

`EudiDevError` has `message` (the last stderr line, which is the error cobra printed), `stderr`, `stdout`, `exitCode` (eudi-dev uses only 0 and 1), `signal`, `timedOut`, `args`, and `document` (the JSON document, if one was printed before the failure). `EudiDevBinaryError` covers a missing or non-executable binary and an unsupported major version.

## Types

The `--json` document types (`ValidateReport`, `DecodedSdJwt`, `DecodedMdoc`, `Check`, `StatusResult`, `RelyingParty`, `TrustOverview`, …) are written by hand from the Go structs at v3.10.1. Upstream publishes no schema for them. Every object type also accepts unknown keys, so fields added in later v3 releases still type-check. `decode` of OpenID4VCI offers, OpenID4VP requests and trusted lists returns a plain `JsonObject`.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull requests. In short:

```bash
pnpm install
pnpm run typecheck
pnpm test                  # unit tests against a fake binary (node:test, Node 22+)
pnpm run test:integration  # real binary: EUDI_DEV_BIN or the platform package
pnpm run lint             # Biome (lint:fix to fix); lint:package runs publint and attw
pnpm run build
```

The pnpm version is pinned in `packageManager` (enable it with `corepack enable`, or install that version). `pnpm-workspace.yaml` denies esbuild's install script (`allowBuilds`). tsx doesn't need it, and pnpm otherwise stops the install to ask.

Before the platform packages are on npm, or to test a new upstream release, build your own platform's package into `node_modules`. If a later `pnpm install` prunes it, run it again:

```bash
node scripts/build-platform-packages.mjs --only current --out node_modules/@thirtified
```

## Platform packages

`scripts/build-platform-packages.mjs` builds them (Node only, no dependencies):

```bash
node scripts/build-platform-packages.mjs            # all four into npm/, upstream tag from src/version.ts
node scripts/build-platform-packages.mjs --help     # all options
```

It downloads the release's `checksums.txt` and the four assets, fails on any SHA-256 mismatch without writing anything, and writes `npm/eudi-dev-<os>-<cpu>/` with `bin/eudi` (mode 0755), `package.json`, `LICENSE` (from the upstream tag) and `README.md`. `--base-url` points it at a mirror (`file:` URLs work). Node's `fetch` ignores `HTTPS_PROXY`; behind a proxy run it with `NODE_USE_ENV_PROXY=1` (Node 22.21+ / 24).

### Versions

- A platform package has the upstream version without the `v`: `3.10.1` for `v3.10.1`.
- To fix the packaging of the same upstream release, add `-<n>`: `3.10.1-1`, `3.10.1-2`. npm can't republish a version, and it ignores `+build` metadata. Being a semver prerelease, `3.10.1-1` sorts below `3.10.1`, which doesn't matter because the main package pins exact versions.
- The main package has its own version and pins the platform packages exactly in `optionalDependencies`. `--sync-main` writes those pins.

### Releasing

`.github/workflows/release.yml` runs on a tag `v<package.json version>` or by hand:

1. It builds the platform packages at the version pinned in `optionalDependencies`, and checks that all four pins agree (`--verify-main`).
2. It stages each one with `npm stage publish --provenance`, skipping versions already published or staged.
3. Then it tests, builds and stages `@thirtified/eudi-dev`.
4. You approve the staged versions with 2FA, on npmjs.com or with `npm stage list <pkg>` and `npm stage approve <id>`. The job summary lists them. **Approve the four platform packages first, then the main package.** npm skips a missing optional dependency silently, so a live main package without its platform packages installs without a binary.

Nothing goes live without that 2FA approval. Both jobs run in the `npm` GitHub environment, which holds `NPM_TOKEN`: a granular token limited to staging. You can later replace it with npm trusted publishing, allowing only staging: `npm trust github <pkg> --repo thirtified/eudi-dev-node --file release.yml --env npm --allow-stage-publish`. `package.json` needs a `repository` field that matches the GitHub repo, for provenance. The platform packages take theirs from it, falling back to `$GITHUB_REPOSITORY`.

The repo uses pnpm (the version is pinned in `packageManager`) for installing, building and testing. Publishing uses the npm CLI (`npm stage publish`), because provenance, staging and trusted publishing are defined for it. pnpm skips an optional dependency it can't fetch, so `pnpm install --frozen-lockfile` passes even while a platform package isn't on npm yet. After the platform packages are published, run `pnpm update '@thirtified/eudi-dev-*'` and commit the updated `pnpm-lock.yaml`. A plain `pnpm install` isn't enough: it treats the skipped packages as resolved and leaves them out. `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` exempts these packages from the one-day wait, so this works right after a release.

The unit tests use `test/fixtures/fake-eudi.mjs`, which follows the same JSON contract and logs each call, so the tests can check argument building, temp files, stdin and the environment. The fake binary is a shebang script, so the tests need macOS or Linux.

### First release

npm can stage versions only of packages that already exist, so publish the first version of all five packages from your machine, with 2FA:

```bash
pnpm install && pnpm run lint && pnpm test
node scripts/build-platform-packages.mjs --verify-main     # all four into npm/, checksum-verified
for dir in npm/*/; do npm publish "$dir" --access public --provenance=false; done
npm publish --provenance=false                             # the main package, last
```

`--provenance=false` is needed because provenance can only be generated in CI, and `publishConfig` turns it on. These first versions therefore carry no provenance. Every later release goes through the workflow and has it.

## Updating upstream

The [upstream watch](.github/workflows/upstream-watch.yml) workflow opens an issue with these steps when eudi-dev publishes a new release.

1. Bump `EUDI_DEV_VERSION` in `src/version.ts`.
2. Run `node scripts/build-platform-packages.mjs --only current --out node_modules/@thirtified --sync-main`. This pins the new version in `optionalDependencies` and installs your platform's package locally.
3. Check `CHANGELOG.md` upstream for new flags and fields, and add them to the option and result types.
4. Run `pnpm run test:integration`.
5. Bump the main package version and update `CHANGELOG.md`, then tag and push to release. Afterwards run `pnpm update '@thirtified/eudi-dev-*'` and commit the lockfile.

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately, not as public issues.

## License

[Apache-2.0](LICENSE) © Julian Dreissig.

The platform packages contain the unmodified [eudi-dev](https://github.com/eudi-dev/eudi-dev) release binaries, © Dominik Schlosser, also under Apache-2.0. Each package carries upstream's `LICENSE`.

This project isn't affiliated with or endorsed by the eudi-dev project or the European Commission. "EUDI" refers to the EU Digital Identity Wallet framework.
