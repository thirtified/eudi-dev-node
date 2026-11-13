// Types for tests that import build-platform-packages.mjs.

export interface Platform {
  name: string;
  os: 'darwin' | 'linux';
  cpu: 'arm64' | 'x64';
  goos: 'darwin' | 'linux';
  goarch: 'amd64' | 'arm64';
  label: string;
  binPath: 'bin/eudi';
}

export interface BuildOptions {
  root?: string;
  tag?: string;
  out?: string;
  packageVersion?: string;
  only?: string[];
  baseUrl?: string;
  license?: string;
  repository?: string;
  mainPackageJson?: string;
  syncMain?: boolean;
  verifyMain?: boolean;
  log?: (message: string) => void;
}

export interface BuiltPackage {
  name: string;
  dir: string;
  asset: string;
  sha256: string;
}

export const UPSTREAM_REPO: string;
export const DEFAULT_BASE_URL: string;
export const PLATFORMS: readonly Platform[];
export function assetName(tag: string, platform: Pick<Platform, 'goos' | 'goarch'>): string;
export function parseChecksums(text: string): Map<string, string>;
export function pinnedTag(root?: string): Promise<string>;
export function selectPlatforms(only?: string[], platform?: string, arch?: string): readonly Platform[];
export function checkPackageVersion(version: string, tag: string): void;
export function buildPlatformPackages(options?: BuildOptions): Promise<BuiltPackage[]>;
