# Contributing

Thanks for helping. Bug reports, fixes and support for new upstream flags are all welcome.

## Scope

This package wraps the eudi-dev **CLI commands** with `--json`. It doesn't start `wallet serve` and has no HTTP client for the wallet API. Please open an issue to discuss anything outside that scope before writing code.

## Setup

You need macOS or Linux, Node.js 22 or newer, and pnpm. The pnpm version is pinned in `packageManager`; `corepack enable` picks it up.

```bash
pnpm install
pnpm run lint          # Biome: lint and format check (pnpm run lint:fix to fix)
pnpm run typecheck
pnpm test              # unit tests against a fake binary
```

The integration tests need the real binary. Build your platform's package from the pinned upstream release into `node_modules`, then run them:

```bash
node scripts/build-platform-packages.mjs --only current --out node_modules/@thirtified
pnpm run test:integration
```

Or set `EUDI_DEV_BIN` to an `eudi` binary you have already.

## Pull requests

- Keep changes focused, and add or update tests. Unit tests use `test/fixtures/fake-eudi.mjs`, which logs each call so tests can check argv, stdin, temp files and the environment.
- New options and result fields follow the upstream Go structs at the pinned version. Mention the upstream source in the PR.
- Add a line under "Unreleased" in `CHANGELOG.md` for user-visible changes.
- The `ts` examples under "Usage" in `README.md` are tested (`test/integration/readme.test.ts`). They run as one script, in order, and are typechecked with `strict` and `exactOptionalPropertyTypes`. Keep each `import` on one line, and say so when an example continues an earlier one.
- CI (lint, typecheck, `lint:package`, and unit and integration tests on Linux and macOS) has to pass.

By contributing you agree that your contribution is licensed under the Apache License 2.0, like the rest of the project.

## Security issues

Please don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
