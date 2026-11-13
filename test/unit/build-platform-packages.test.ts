import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  assetName,
  buildPlatformPackages,
  checkPackageVersion,
  PLATFORMS,
  parseChecksums,
  pinnedTag,
  selectPlatforms,
} from '../../scripts/build-platform-packages.mjs';
import { EUDI_DEV_VERSION } from '../../src/version.js';

const TAG = 'v3.10.1';
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

describe('build-platform-packages helpers', () => {
  it('builds asset names like upstream release.yml', () => {
    assert.equal(assetName(TAG, { goos: 'linux', goarch: 'amd64' }), 'eudi-v3.10.1-linux-amd64');
    assert.equal(assetName(TAG, { goos: 'darwin', goarch: 'arm64' }), 'eudi-v3.10.1-darwin-arm64');
  });

  it('parses sha256sum output', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const sums = parseChecksums(`${a}  eudi-v3.10.1-linux-amd64\n${b} *eudi-v3.10.1-windows-amd64.exe\n\njunk\n`);
    assert.equal(sums.get('eudi-v3.10.1-linux-amd64'), a);
    assert.equal(sums.get('eudi-v3.10.1-windows-amd64.exe'), 'b'.repeat(64));
    assert.equal(sums.size, 2);
  });

  it('reads the pinned tag from src/version.ts', async () => {
    assert.equal(await pinnedTag(), EUDI_DEV_VERSION);
  });

  it('selects packages', () => {
    assert.equal(selectPlatforms().length, 4);
    assert.deepEqual(
      selectPlatforms(['linux-arm64', '@thirtified/eudi-dev-darwin-x64']).map((p) => p.name),
      ['@thirtified/eudi-dev-linux-arm64', '@thirtified/eudi-dev-darwin-x64'],
    );
    assert.equal(selectPlatforms(['current'], 'linux', 'arm64')[0]?.name, '@thirtified/eudi-dev-linux-arm64');
    assert.throws(() => selectPlatforms(['current'], 'win32', 'x64'), /win32\/x64/);
    assert.throws(() => selectPlatforms(['current'], 'freebsd', 'x64'), /freebsd\/x64/);
  });

  it('accepts the upstream version or a repackaging suffix', () => {
    checkPackageVersion('3.10.1', TAG);
    checkPackageVersion('3.10.1-2', TAG);
    assert.throws(() => checkPackageVersion('3.10.2', TAG), /must be 3\.10\.1 or 3\.10\.1-<n>/);
    assert.throws(() => checkPackageVersion('3.10.1-beta', TAG));
    assert.throws(() => checkPackageVersion('3.10.1+1', TAG));
  });
});

describe('buildPlatformPackages against a local release', () => {
  let dir: string;
  let release: string;
  let out: string;
  let mainJson: string;
  const assets = new Map<string, Buffer>();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eudi-build-test-'));
    release = join(dir, 'release');
    out = join(dir, 'npm');
    await mkdir(join(release, TAG), { recursive: true });
    const lines: string[] = [];
    for (const p of PLATFORMS) {
      const name = assetName(TAG, p);
      const data = Buffer.from(`fake binary ${name}\n`);
      assets.set(name, data);
      await writeFile(join(release, TAG, name), data);
      lines.push(`${sha256(data)}  ${name}`);
    }
    await writeFile(join(release, TAG, 'checksums.txt'), `${lines.join('\n')}\n`);
    await writeFile(join(release, 'LICENSE'), 'Apache License 2.0 (fake)\n');
    mainJson = join(dir, 'package.json');
    await writeFile(
      mainJson,
      `${JSON.stringify({ name: '@thirtified/eudi-dev', version: '0.1.0', author: 'Jane Doe', repository: { type: 'git', url: 'git+https://github.com/example/x.git' } }, null, 2)}\n`,
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const opts = () => ({
    tag: TAG,
    out,
    baseUrl: pathToFileURL(release).href,
    license: join(release, 'LICENSE'),
    mainPackageJson: mainJson,
    log: () => {},
  });

  it('writes every package with a verified binary', async () => {
    const built = await buildPlatformPackages({ ...opts(), syncMain: true });
    assert.equal(built.length, 4);
    assert.deepEqual((await readdir(out)).sort(), PLATFORMS.map((p) => p.name.split('/')[1]).sort());

    for (const p of PLATFORMS) {
      const pkgDir = join(out, p.name.split('/')[1]!);
      const asset = assetName(TAG, p);
      const binFile = join(pkgDir, p.binPath);
      assert.deepEqual(await readFile(binFile), assets.get(asset));
      assert.equal((await stat(binFile)).mode & 0o777, 0o755);

      const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, p.name);
      assert.equal(pkg.version, '3.10.1');
      assert.deepEqual(pkg.os, [p.os]);
      assert.deepEqual(pkg.cpu, [p.cpu]);
      assert.equal(pkg.license, 'Apache-2.0');
      assert.equal(pkg.preferUnplugged, true);
      assert.deepEqual(pkg.files, ['bin/']);
      assert.equal(pkg.repository.url, 'git+https://github.com/example/x.git');
      assert.equal(pkg.author, 'Jane Doe');
      assert.equal(pkg.eudiDev.sha256, sha256(assets.get(asset)!));

      assert.equal(await readFile(join(pkgDir, 'LICENSE'), 'utf8'), 'Apache License 2.0 (fake)\n');
      const readme = await readFile(join(pkgDir, 'README.md'), 'utf8');
      assert.ok(readme.includes(`https://github.com/eudi-dev/eudi-dev/releases/tag/${TAG}`));
      assert.ok(readme.includes(pkg.eudiDev.sha256));
    }

    const main = JSON.parse(await readFile(mainJson, 'utf8'));
    for (const p of PLATFORMS) assert.equal(main.optionalDependencies[p.name], '3.10.1');
    // --verify-main now passes, and fails for another version.
    await buildPlatformPackages({ ...opts(), only: ['linux-x64'], verifyMain: true });
    await assert.rejects(buildPlatformPackages({ ...opts(), packageVersion: '3.10.1-1', verifyMain: true }), /must pin 3\.10\.1-1 exactly/);
  });

  it('builds only the selected package', async () => {
    const built = await buildPlatformPackages({ ...opts(), only: ['darwin-arm64'] });
    assert.deepEqual(
      built.map((b) => b.name),
      ['@thirtified/eudi-dev-darwin-arm64'],
    );
    assert.deepEqual(await readdir(out), ['eudi-dev-darwin-arm64']);
  });

  it('fails hard on a checksum mismatch and writes no package', async () => {
    await writeFile(join(release, TAG, assetName(TAG, PLATFORMS[3]!)), 'tampered\n');
    await assert.rejects(buildPlatformPackages(opts()), /Checksum mismatch for eudi-v3\.10\.1-linux-arm64/);
    assert.deepEqual(await readdir(out), []);
  });

  it('fails when checksums.txt has no entry for an asset', async () => {
    await writeFile(join(release, TAG, 'checksums.txt'), `${'0'.repeat(64)}  other\n`);
    await assert.rejects(buildPlatformPackages(opts()), /lists no checksum for eudi-v3\.10\.1-darwin-arm64/);
  });

  it('fails when an asset is missing', async () => {
    await rm(join(release, TAG, assetName(TAG, PLATFORMS[0]!)));
    await assert.rejects(buildPlatformPackages(opts()), /Reading .* failed/);
    assert.deepEqual(await readdir(out), []);
  });
});
