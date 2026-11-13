# Changelog

All notable changes to `@thirtified/eudi-dev` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes.

## [Unreleased]

## [0.1.0]

First release, for eudi-dev v3.10.1.

### Added

- `EudiDev` with `decode`, `validate`, `dcql`, `issue.{sdjwt,jwt,mdoc}`, `trust.*`, `registrar.*` and `run()`, each with typed `--json` results.
- An isolated `EUDI_DEV_HOME` per instance, and a strip of inherited `EUDI_DEV_*` variables.
- The eudi-dev binary as per-platform optional dependencies: `@thirtified/eudi-dev-{darwin,linux}-{arm64,x64}`.
- `EUDI_DEV_BIN` to use another binary.

[Unreleased]: https://github.com/thirtified/eudi-dev-node/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thirtified/eudi-dev-node/releases/tag/v0.1.0
