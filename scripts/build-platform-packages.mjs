#!/usr/bin/env node
// Builds the per-platform npm packages (@thirtified/eudi-dev-<os>-<cpu>) from
// an upstream eudi-dev GitHub release.
//
//   node scripts/build-platform-packages.mjs [options]
//
//   Builds darwin-arm64, darwin-x64, linux-x64 and linux-arm64.
//
//   --tag <tag>              upstream release tag (default: EUDI_DEV_VERSION in src/version.ts)
//   --out <dir>              output dir (default: npm/). Each package goes to <dir>/eudi-dev-<os>-<cpu>,
//                            so "--out node_modules/@thirtified" gives an installed layout.
//   --package-version <ver>  version of the platform packages (default: tag without "v").
//                            For a repackaging fix of the same upstream release use "<ver>-<n>", e.g. 3.10.1-1.
//   --only <pkg>             build only this package (repeatable): a full name, "linux-x64" or "current"
//   --base-url <url>         serves <tag>/<asset> and <tag>/checksums.txt (default: GitHub releases; file: URLs work)
//   --license <url|path>     upstream LICENSE (default: raw.githubusercontent.com at the tag)
//   --repository <url>       "repository" of the packages (default: the main package's, else $GITHUB_REPOSITORY)
//   --sync-main              write the exact package version into the main package's optionalDependencies
//   --verify-main            fail unless the main package's optionalDependencies pin exactly this version
//
// Every asset is checked against the release's checksums.txt (SHA-256). A
// mismatch or a missing entry fails the build and writes nothing.
//
// Node only, no dependencies. Node's fetch ignores HTTPS_PROXY; behind a proxy
// run with NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24).

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const UPSTREAM_REPO = 'eudi-dev/eudi-dev';
export const DEFAULT_BASE_URL = `https://github.com/${UPSTREAM_REPO}/releases/download`;

/** Keep in sync with PLATFORM_PACKAGES in src/binary.ts (a unit test checks it). */
export const PLATFORMS = [
  { name: '@thirtified/eudi-dev-darwin-arm64', os: 'darwin', cpu: 'arm64', goos: 'darwin', goarch: 'arm64', label: 'macOS arm64' },
  { name: '@thirtified/eudi-dev-darwin-x64', os: 'darwin', cpu: 'x64', goos: 'darwin', goarch: 'amd64', label: 'macOS x64' },
  { name: '@thirtified/eudi-dev-linux-x64', os: 'linux', cpu: 'x64', goos: 'linux', goarch: 'amd64', label: 'Linux x64' },
  { name: '@thirtified/eudi-dev-linux-arm64', os: 'linux', cpu: 'arm64', goos: 'linux', goarch: 'arm64', label: 'Linux arm64' },
].map((p) => ({ ...p, binPath: 'bin/eudi' }));
// Upstream also publishes windows-amd64 (eudi-<tag>-windows-amd64.exe). It is
// left out until the wrapper is tested on Windows.

/** `eudi-v3.10.1-linux-amd64`. */
export function assetName(tag, platform) {
  return `eudi-${tag}-${platform.goos}-${platform.goarch}`;
}

/** Parses `sha256sum` output (`<hex>  <name>` or `<hex> *<name>`) into name → lowercase hex. */
export function parseChecksums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) sums.set(m[2], m[1].toLowerCase());
  }
  return sums;
}

/** Reads EUDI_DEV_VERSION from src/version.ts. */
export async function pinnedTag(root = ROOT) {
  const src = await readFile(join(root, 'src', 'version.ts'), 'utf8');
  const m = /EUDI_DEV_VERSION\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('EUDI_DEV_VERSION not found in src/version.ts');
  return m[1];
}

function normaliseTag(tag) {
  return tag.startsWith('v') ? tag : `v${tag}`;
}

/** Selects packages by full name, "<os>-<cpu>" or "current". */
export function selectPlatforms(only, platform = process.platform, arch = process.arch) {
  if (!only || only.length === 0) return PLATFORMS;
  return only.map((sel) => {
    let key = sel;
    if (sel === 'current') key = `${platform}-${arch}`;
    const p = PLATFORMS.find((x) => x.name === key || `${x.os}-${x.cpu}` === key);
    if (!p) throw new Error(`No platform package for "${sel}"${sel === 'current' ? ` (${platform}/${arch})` : ''}`);
    return p;
  });
}

async function open(url) {
  const u = new URL(url);
  if (u.protocol === 'file:') {
    try {
      // Opening first surfaces ENOENT here rather than mid-pipeline.
      const stream = createReadStream(fileURLToPath(u));
      await new Promise((ok, fail) => stream.once('open', ok).once('error', fail));
      return stream;
    } catch (err) {
      throw new Error(`Reading ${url} failed: ${err.message}`, { cause: err });
    }
  }
  let res;
  try {
    res = await fetch(u, { redirect: 'follow' });
  } catch (err) {
    throw new Error(`Fetching ${url} failed: ${err.message}. Behind a proxy, set NODE_USE_ENV_PROXY=1.`, { cause: err });
  }
  if (!res.ok || !res.body) throw new Error(`Fetching ${url} failed: HTTP ${res.status} ${res.statusText}`);
  return Readable.fromWeb(res.body);
}

async function getText(url) {
  const chunks = [];
  for await (const chunk of await open(url)) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Streams `url` to `dest` and returns its SHA-256. */
async function download(url, dest) {
  const hash = createHash('sha256');
  const hasher = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  await pipeline(await open(url), hasher, createWriteStream(dest));
  return hash.digest('hex');
}

function toUrl(pathOrUrl) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('file:') ? pathOrUrl : pathToFileURL(resolve(pathOrUrl)).href;
}

function repositoryOf(mainPkg, explicit) {
  if (explicit) return { type: 'git', url: explicit };
  if (mainPkg.repository) return mainPkg.repository;
  if (process.env.GITHUB_REPOSITORY) return { type: 'git', url: `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git` };
  return undefined;
}

function packageJson(p, version, tag, asset, sha256, repository, author) {
  const pkg = {
    name: p.name,
    version,
    description: `The eudi-dev ${tag} binary for ${p.label}, used by @thirtified/eudi-dev`,
    license: 'Apache-2.0',
    // The repackager. Upstream is named in the description, README and homepage.
    ...(author ? { author } : {}),
    homepage: `https://github.com/${UPSTREAM_REPO}`,
  };
  if (repository) pkg.repository = repository;
  Object.assign(pkg, {
    os: [p.os],
    cpu: [p.cpu],
    files: ['bin/'],
    preferUnplugged: true,
    eudiDev: { upstreamTag: tag, asset, sha256 },
  });
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function readme(p, version, tag, asset, sha256) {
  const releaseUrl = `https://github.com/${UPSTREAM_REPO}/releases/tag/${tag}`;
  return `# ${p.name}

The [eudi-dev](https://github.com/${UPSTREAM_REPO}) CLI binary for ${p.label}, repackaged unchanged for npm.
You don't install this package yourself: [@thirtified/eudi-dev](https://www.npmjs.com/package/@thirtified/eudi-dev)
lists it as an optional dependency and npm picks the one for your platform.

| | |
|---|---|
| Upstream release | [${tag}](${releaseUrl}) |
| Asset | \`${asset}\` |
| SHA-256 | \`${sha256}\` |
| File | \`${p.binPath}\` |
| Package version | \`${version}\` |

The SHA-256 matches the release's \`checksums.txt\`. eudi-dev is © Dominik Schlosser and licensed under
Apache-2.0; see \`LICENSE\`, copied from the upstream tag.
`;
}

/** Checks a platform-package version: `<tag without v>` or `<tag without v>-<n>`. */
export function checkPackageVersion(version, tag) {
  const base = tag.replace(/^v/, '');
  const repack = version.startsWith(`${base}-`) && /^\d+$/.test(version.slice(base.length + 1));
  if (version !== base && !repack) {
    throw new Error(`Package version ${version} must be ${base} or ${base}-<n> for upstream ${tag}`);
  }
}

/**
 * Builds the packages. Returns `[{ name, dir, asset, sha256 }]`.
 * Nothing is written to `out` unless every selected asset verifies.
 */
export async function buildPlatformPackages(options = {}) {
  const root = options.root ?? ROOT;
  const tag = normaliseTag(options.tag ?? (await pinnedTag(root)));
  const version = options.packageVersion ?? tag.slice(1);
  checkPackageVersion(version, tag);
  const out = resolve(options.out ?? join(root, 'npm'));
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const licenseUrl = toUrl(options.license ?? `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${tag}/LICENSE`);
  const mainPath = options.mainPackageJson ?? join(root, 'package.json');
  const mainPkg = JSON.parse(await readFile(mainPath, 'utf8'));
  const platforms = selectPlatforms(options.only);
  const log = options.log ?? ((m) => console.error(m));

  if (options.verifyMain) {
    const deps = mainPkg.optionalDependencies ?? {};
    const wrong = PLATFORMS.filter((p) => deps[p.name] !== version);
    if (wrong.length) {
      throw new Error(
        `${mainPath} optionalDependencies must pin ${version} exactly; wrong or missing: ${wrong.map((p) => `${p.name}@${deps[p.name] ?? '-'}`).join(', ')}`,
      );
    }
  }

  const sumsUrl = `${base}/${tag}/checksums.txt`;
  const sums = parseChecksums(await getText(sumsUrl));
  const license = await getText(licenseUrl);
  const repository = repositoryOf(mainPkg, options.repository);

  await mkdir(out, { recursive: true });
  const staging = await mkdtemp(join(out, '.staging-'));
  const built = [];
  try {
    for (const p of platforms) {
      const asset = assetName(tag, p);
      const expected = sums.get(asset);
      if (!expected) throw new Error(`${sumsUrl} lists no checksum for ${asset}`);
      const dirName = p.name.split('/')[1];
      const dir = join(staging, dirName);
      await mkdir(join(dir, 'bin'), { recursive: true });
      const bin = join(dir, p.binPath);
      log(`Downloading ${base}/${tag}/${asset}`);
      const actual = await download(`${base}/${tag}/${asset}`, bin);
      if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
      await chmod(bin, 0o755);
      await writeFile(join(dir, 'package.json'), packageJson(p, version, tag, asset, actual, repository, mainPkg.author));
      await writeFile(join(dir, 'LICENSE'), license);
      await writeFile(join(dir, 'README.md'), readme(p, version, tag, asset, actual));
      log(`Verified ${asset} (sha256 ${actual})`);
      built.push({ name: p.name, dirName, asset, sha256: actual });
    }
    for (const b of built) {
      b.dir = join(out, b.dirName);
      await rm(b.dir, { recursive: true, force: true });
      await rename(join(staging, b.dirName), b.dir);
      delete b.dirName;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  if (options.syncMain) {
    mainPkg.optionalDependencies = { ...(mainPkg.optionalDependencies ?? {}) };
    for (const p of PLATFORMS) mainPkg.optionalDependencies[p.name] = version;
    await writeFile(mainPath, `${JSON.stringify(mainPkg, null, 2)}\n`);
    log(`Pinned optionalDependencies in ${mainPath} to ${version}`);
  }
  return built;
}

async function main() {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      out: { type: 'string' },
      'package-version': { type: 'string' },
      only: { type: 'string', multiple: true },
      'base-url': { type: 'string' },
      license: { type: 'string' },
      repository: { type: 'string' },
      'sync-main': { type: 'boolean' },
      'verify-main': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    const src = await readFile(fileURLToPath(import.meta.url), 'utf8');
    console.log(
      src
        .split('\n')
        .slice(1)
        .filter((l) => l.startsWith('//'))
        .map((l) => l.slice(3))
        .join('\n'),
    );
    return;
  }
  const built = await buildPlatformPackages({
    tag: values.tag,
    out: values.out,
    packageVersion: values['package-version'],
    only: values.only,
    baseUrl: values['base-url'],
    license: values.license,
    repository: values.repository,
    syncMain: values['sync-main'],
    verifyMain: values['verify-main'],
  });
  for (const b of built) console.log(b.dir);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`build-platform-packages: ${err.message}`);
    process.exit(1);
  });
}
