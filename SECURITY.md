# Security policy

## Supported versions

Only the latest `0.x` release of `@thirtified/eudi-dev` and its platform packages gets fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on [thirtified/eudi-dev-node](https://github.com/thirtified/eudi-dev-node/security/advisories/new).
Don't open a public issue.

You can expect a first reply within a week. Once a fix is released, the advisory is published with credit, unless you'd rather stay anonymous.

## Scope

In scope:

- the TypeScript wrapper (`src/`), for example argument or environment handling that lets input escape its intended use
- the packaging: `scripts/build-platform-packages.mjs`, the platform packages and the release workflow (checksum verification, provenance)

Out of scope:

- vulnerabilities in the eudi-dev binary itself. Report those to [eudi-dev/eudi-dev](https://github.com/eudi-dev/eudi-dev). If a fixed upstream release exists, open an issue here so the pinned version gets bumped.
- eudi-dev is a **test** wallet, issuer and verifier. Test keys, demo trust anchors and the missing hardening of a production wallet are expected. Don't use this package outside tests and development.
