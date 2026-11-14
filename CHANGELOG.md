# Changelog

All notable changes to `@thirtified/eudi-dev` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

## [Unreleased]

### Fixed

- The type definitions load the Node types themselves (`/// <reference types="node" />`). In TypeScript 6+ projects without `"types": ["node"]`, Node-typed options such as `platform` and `signal` were errors, or silently `any` under `skipLibCheck`. TypeScript users need `@types/node` installed.
- README: the wallet, trust and registrar example now defines `csrPem`, shows how to create the `verifier.csr` it reads, and says that it continues the first example. Both Usage examples typecheck with `strict` and `exactOptionalPropertyTypes` and run against eudi-dev v3.10.1.

## [0.1.1]

### Fixed

- Option types accept an explicit `undefined` for every optional property, so code compiled with `exactOptionalPropertyTypes: true` can pass maybe-undefined values, for example `validate(credential, { key: publicJwk })` from the README. This also covers the inputs `Enrolment`, `AccessCertificateRequest` and the `Dcql*` query types. Passing `undefined` behaves like leaving the option out.

### Added

- `Loose<T>`: like `Partial<T>`, but optional properties also accept `undefined`. `Enrolment.relyingParty` uses it.

## [0.1.0]

First release, for eudi-dev v3.10.1.

### Added

- `EudiDev` with `decode`, `validate`, `dcql`, `issue.{sdjwt,jwt,mdoc}`, `trust.*`, `registrar.*` and `run()`, each with typed `--json` results.
- An isolated `EUDI_DEV_HOME` per instance, and a strip of inherited `EUDI_DEV_*` variables.
- The eudi-dev binary as per-platform optional dependencies: `@thirtified/eudi-dev-{darwin,linux}-{arm64,x64}`.
- `EUDI_DEV_BIN` to use another binary.

[Unreleased]: https://github.com/thirtified/eudi-dev-node/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/thirtified/eudi-dev-node/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thirtified/eudi-dev-node/releases/tag/v0.1.0
