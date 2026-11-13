import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { PLATFORMS } from '../../scripts/build-platform-packages.mjs';
import { PLATFORM_PACKAGES, platformPackage, resolveBinary } from '../../src/binary.js';
import { EudiDevBinaryError } from '../../src/errors.js';

describe('platformPackage', () => {
  it('maps Node platforms to package names', () => {
    assert.equal(platformPackage('darwin', 'arm64').name, '@thirtified/eudi-dev-darwin-arm64');
    assert.equal(platformPackage('darwin', 'x64').name, '@thirtified/eudi-dev-darwin-x64');
    assert.equal(platformPackage('linux', 'x64').name, '@thirtified/eudi-dev-linux-x64');
    assert.equal(platformPackage('linux', 'arm64').name, '@thirtified/eudi-dev-linux-arm64');
  });

  it('rejects unsupported platforms and suggests EUDI_DEV_BIN', () => {
    assert.throws(
      () => platformPackage('freebsd', 'x64'),
      (err: unknown) => {
        assert.ok(err instanceof EudiDevBinaryError);
        assert.match(err.message, /freebsd\/x64/);
        assert.match(err.message, /EUDI_DEV_BIN/);
        return true;
      },
    );
    assert.throws(() => platformPackage('linux', 'ia32'), EudiDevBinaryError);
    // Not packaged yet.
    assert.throws(() => platformPackage('win32', 'x64'), /no binary for win32\/x64/);
  });

  it('matches the table in the build script and the optionalDependencies', async () => {
    assert.deepEqual(
      PLATFORMS.map(({ name, os, cpu, binPath }) => ({ name, os, cpu, binPath })),
      PLATFORM_PACKAGES.map(({ name, os, cpu, binPath }) => ({ name, os, cpu, binPath })),
    );
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
      optionalDependencies?: Record<string, string>;
    };
    const deps = pkg.optionalDependencies ?? {};
    assert.deepEqual(Object.keys(deps).sort(), PLATFORM_PACKAGES.map((p) => p.name).sort());
    for (const v of Object.values(deps)) assert.match(v, /^\d+\.\d+\.\d+(-\d+)?$/, 'exact version');
  });
});

describe('resolveBinary', () => {
  let dir: string;
  let bin: string;
  const savedBin = process.env.EUDI_DEV_BIN;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eudi-bin-test-'));
    bin = join(dir, 'eudi');
    await writeFile(bin, '#!/bin/sh\necho fake\n');
    await chmod(bin, 0o755);
    delete process.env.EUDI_DEV_BIN;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    if (savedBin === undefined) delete process.env.EUDI_DEV_BIN;
    else process.env.EUDI_DEV_BIN = savedBin;
  });

  const noResolve = (): string => {
    throw new Error('resolve must not be called');
  };

  it('prefers the bin option over EUDI_DEV_BIN', async () => {
    process.env.EUDI_DEV_BIN = join(dir, 'missing');
    assert.equal(await resolveBinary({ bin, resolve: noResolve }), bin);
  });

  it('uses EUDI_DEV_BIN', async () => {
    process.env.EUDI_DEV_BIN = bin;
    assert.equal(await resolveBinary({ resolve: noResolve }), bin);
    process.env.EUDI_DEV_BIN = join(dir, 'missing');
    await assert.rejects(resolveBinary({ resolve: noResolve }), /EUDI_DEV_BIN points to .*missing/);
  });

  it('refuses a bin option that is not an executable file', async () => {
    await assert.rejects(resolveBinary({ bin: dir }), /bin option points to/);
    if (process.platform !== 'win32') {
      await chmod(bin, 0o644);
      await assert.rejects(resolveBinary({ bin }), /not an executable file/);
    }
  });

  it('resolves the binary in the platform package', async () => {
    const asked: string[] = [];
    const resolve = (spec: string): string => {
      asked.push(spec);
      return bin;
    };
    assert.equal(await resolveBinary({ platform: 'linux', arch: 'arm64', resolve }), bin);
    assert.equal(await resolveBinary({ platform: 'darwin', arch: 'x64', resolve }), bin);
    assert.deepEqual(asked, ['@thirtified/eudi-dev-linux-arm64/bin/eudi', '@thirtified/eudi-dev-darwin-x64/bin/eudi']);
  });

  it('explains a missing platform package', async () => {
    const resolve = (spec: string): string => {
      throw Object.assign(new Error(`Cannot find module '${spec}'`), { code: 'MODULE_NOT_FOUND' });
    };
    await assert.rejects(resolveBinary({ platform: 'linux', arch: 'x64', resolve }), (err: unknown) => {
      assert.ok(err instanceof EudiDevBinaryError);
      assert.match(err.message, /@thirtified\/eudi-dev-linux-x64 is not installed/);
      assert.match(err.message, /--omit=optional/);
      assert.match(err.message, /--no-optional/);
      assert.match(err.message, /npm\/cli#4828/);
      assert.match(err.message, /not supported/);
      assert.match(err.message, /EUDI_DEV_BIN/);
      assert.match(String((err.cause as Error).message), /Cannot find module/);
      return true;
    });
  });

  it('uses require.resolve by default', async () => {
    // A platform that is supported but whose package is certainly not in
    // node_modules here, so the real resolver fails with our message.
    const other = process.platform === 'linux' ? { platform: 'darwin', arch: 'arm64' } : { platform: 'linux', arch: 'arm64' };
    await assert.rejects(
      resolveBinary({ platform: other.platform as NodeJS.Platform, arch: other.arch }),
      /eudi-dev-(darwin|linux)-arm64 is not installed/,
    );
  });

  it('rejects an unsupported platform before resolving', async () => {
    await assert.rejects(resolveBinary({ platform: 'aix', arch: 'ppc64', resolve: noResolve }), /no binary for aix\/ppc64/);
  });
});
