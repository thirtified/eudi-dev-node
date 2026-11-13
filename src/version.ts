/**
 * The eudi-dev release this package is written and tested against.
 *
 * The `--json` documents only gain fields within a major version (upstream
 * ADR 0020), so any v3.x binary works. A different major version is refused
 * unless `allowAnyVersion` is set.
 */
export const EUDI_DEV_VERSION = 'v3.10.1';

/** The upstream major version whose JSON contract the types describe. */
export const SUPPORTED_MAJOR = 3;

/** GitHub repository that publishes the release binaries. */
export const UPSTREAM_REPO = 'eudi-dev/eudi-dev';

/**
 * Parses a version tag such as `v3.10.1` or `v3.0.0-beta.1`. Returns
 * `undefined` for `dev` builds and anything else that isn't semver-like.
 */
export function parseVersion(tag: string): { major: number; minor: number; patch: number; prerelease?: string } | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag.trim());
  if (!m) return undefined;
  const result: { major: number; minor: number; patch: number; prerelease?: string } = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
  if (m[4] !== undefined) result.prerelease = m[4];
  return result;
}

/** Normalises `3.10.1` to `v3.10.1`. */
export function normaliseTag(version: string): string {
  const v = version.trim();
  return v.startsWith('v') ? v : `v${v}`;
}
