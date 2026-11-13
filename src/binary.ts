import { access, constants, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { EudiDevBinaryError } from './errors.js';

/**
 * One per-platform npm package that ships the upstream release binary.
 * `scripts/build-platform-packages.mjs` builds them from the same table.
 */
export interface PlatformPackage {
  /** npm package name, e.g. `@thirtified/eudi-dev-linux-x64`. */
  name: string;
  /** Node `process.platform` value (`os` in package.json). */
  os: 'darwin' | 'linux';
  /** Node `process.arch` value (`cpu` in package.json). */
  cpu: 'arm64' | 'x64';
  /** Path of the binary inside the package. */
  binPath: 'bin/eudi';
}

/** The platform packages listed in `optionalDependencies`. */
export const PLATFORM_PACKAGES: readonly PlatformPackage[] = [
  { name: '@thirtified/eudi-dev-darwin-arm64', os: 'darwin', cpu: 'arm64', binPath: 'bin/eudi' },
  { name: '@thirtified/eudi-dev-darwin-x64', os: 'darwin', cpu: 'x64', binPath: 'bin/eudi' },
  { name: '@thirtified/eudi-dev-linux-x64', os: 'linux', cpu: 'x64', binPath: 'bin/eudi' },
  { name: '@thirtified/eudi-dev-linux-arm64', os: 'linux', cpu: 'arm64', binPath: 'bin/eudi' },
];

export interface ResolveBinaryOptions {
  /** Use this binary and skip the lookup. Takes precedence over `EUDI_DEV_BIN`. */
  bin?: string;
  /** Override the detected platform (mainly for tests). Default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Override the detected architecture (mainly for tests). Default `process.arch`. */
  arch?: string;
  /**
   * Resolves a module specifier to a file path (mainly for tests). Default
   * `createRequire(import.meta.url).resolve`.
   */
  resolve?: (specifier: string) => string;
}

/**
 * The platform package for a Node platform and architecture. There is none
 * for Windows yet; `EUDI_DEV_BIN` can point to upstream's `eudi.exe`, untested.
 */
export function platformPackage(platform: NodeJS.Platform = process.platform, arch: string = process.arch): PlatformPackage {
  const pkg = PLATFORM_PACKAGES.find((p) => p.os === platform && p.cpu === arch);
  if (!pkg) {
    throw new EudiDevBinaryError(
      `eudi-dev publishes no binary for ${platform}/${arch}. Set EUDI_DEV_BIN to an eudi binary you built with "go build".`,
    );
  }
  return pkg;
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return false;
    if (process.platform !== 'win32') await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the eudi-dev binary.
 *
 * Order: `options.bin`, `EUDI_DEV_BIN`, then the binary in the platform
 * package (for example `@thirtified/eudi-dev-linux-x64`) that npm installed
 * as an optional dependency.
 */
export async function resolveBinary(options: ResolveBinaryOptions = {}): Promise<string> {
  const explicit = options.bin ?? process.env.EUDI_DEV_BIN;
  if (explicit) {
    if (!(await isExecutableFile(explicit))) {
      const source = options.bin ? 'bin option' : 'EUDI_DEV_BIN';
      throw new EudiDevBinaryError(`${source} points to ${explicit}, which is not an executable file`);
    }
    return explicit;
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const pkg = platformPackage(platform, arch);
  const specifier = `${pkg.name}/${pkg.binPath}`;
  const resolve = options.resolve ?? createRequire(import.meta.url).resolve;

  let path: string;
  try {
    path = resolve(specifier);
  } catch (err) {
    throw new EudiDevBinaryError(
      [
        `The eudi-dev binary package ${pkg.name} is not installed.`,
        `It is an optional dependency of @thirtified/eudi-dev, and npm skips it when:`,
        `  - optional dependencies are left out (--omit=optional, --no-optional, or omit=optional in .npmrc or NPM_CONFIG_OMIT)`,
        `  - package-lock.json was created on another OS or CPU and has no entry for it (npm/cli#4828).`,
        `    Delete node_modules and package-lock.json, then run "npm install" again.`,
        `  - this platform (${platform}/${arch}) is not supported`,
        `Set EUDI_DEV_BIN to an eudi binary to skip the lookup.`,
      ].join('\n'),
      { cause: err },
    );
  }
  if (!(await isExecutableFile(path))) {
    throw new EudiDevBinaryError(
      `${path} from ${pkg.name} is not an executable file. Reinstall the package, or set EUDI_DEV_BIN to an eudi binary.`,
    );
  }
  return path;
}
