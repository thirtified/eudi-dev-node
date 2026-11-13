import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { EudiDevError, lastLine } from '../../src/errors.js';
import { ArgList, buildEnv, positionalInput, Runner, Scratch } from '../../src/runner.js';
import { callLog, FAKE_BIN } from './helpers.js';

describe('buildEnv', () => {
  it('isolates the home and strips EUDI_DEV_* from the parent', () => {
    const env = buildEnv(
      { home: '/h', env: { EXTRA: '1', PATH: undefined } },
      { PATH: '/bin', EUDI_DEV_STORAGE: 'postgres://x', EUDI_DEV_HOME: '/mine', OID4VC_DEV_HOME: '/old', KEEP: 'k' },
    );
    assert.equal(env.EUDI_DEV_HOME, '/h');
    assert.equal(env.NO_COLOR, '1');
    assert.equal(env.EUDI_DEV_STORAGE, undefined);
    assert.equal(env.OID4VC_DEV_HOME, undefined);
    assert.equal(env.KEEP, 'k');
    assert.equal(env.EXTRA, '1');
    assert.equal('PATH' in env, false);
  });

  it('can inherit EUDI_DEV_* but the home still wins', () => {
    const env = buildEnv({ home: '/h', inheritEudiEnv: true }, { EUDI_DEV_STORAGE: 'memory', EUDI_DEV_HOME: '/mine' });
    assert.equal(env.EUDI_DEV_STORAGE, 'memory');
    assert.equal(env.EUDI_DEV_HOME, '/h');
  });
});

describe('ArgList', () => {
  it('uses --name=value so values starting with - stay values', () => {
    const a = new ArgList('issue', 'sdjwt')
      .value('nbf', '-1h')
      .value('skip', undefined)
      .bool('status-list', false)
      .bool('t', true)
      .on('pid', true)
      .on('off', false)
      .repeat('entitlement', ['a', 'b'])
      .csv('omit', ['x', 'y'])
      .csv('empty', []);
    assert.deepEqual(a.args, [
      'issue',
      'sdjwt',
      '--nbf=-1h',
      '--status-list=false',
      '--t',
      '--pid',
      '--entitlement=a',
      '--entitlement=b',
      '--omit=x,y',
    ]);
  });
});

describe('positionalInput / Scratch', () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eudi-input-test-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends content on stdin with "-"', async () => {
    assert.deepEqual(await positionalInput('abc~'), { arg: '-', stdin: 'abc~' });
  });

  it('passes existing paths and http(s) URLs', async () => {
    const file = join(dir, 'cred.txt');
    await writeFile(file, 'x');
    assert.deepEqual(await positionalInput({ path: file }), { arg: file });
    assert.deepEqual(await positionalInput({ url: 'https://x.example/c' }), { arg: 'https://x.example/c' });
  });

  it('rejects missing paths, which upstream would read as raw input', async () => {
    await assert.rejects(positionalInput({ path: join(dir, 'nope') }), /is not a file/);
    await assert.rejects(positionalInput({ url: 'file:///etc/passwd' }), /not an http/);
  });

  it('writes content to private temp files and cleans up', async () => {
    const s = new Scratch();
    const p = await s.file('-----BEGIN PUBLIC KEY-----', 'key');
    assert.equal(((await stat(p)).mode & 0o777).toString(8), '600');
    await assert.rejects(s.file({ url: 'https://x' }, 'key'), /does not accept a URL/);
    assert.equal(await s.file({ url: 'https://x' }, 'tl', { allowUrl: true }), 'https://x');
    await s.cleanup();
    await assert.rejects(stat(p));
  });
});

describe('Runner against the fake binary', () => {
  const log = callLog();
  const runner = new Runner({ bin: FAKE_BIN, home: '/tmp/fake-home', env: { FAKE_EUDI_LOG: log.path, FAKE_EXTRA: 'yes' } });
  after(() => log.cleanup());

  it('adds --json --no-color and parses the document', async () => {
    const { document } = await runner.run<{ argv: string[]; json: boolean }>(['echo', 'a']);
    assert.deepEqual(document.argv, ['echo', 'a', '--json', '--no-color']);
    const call = log.last();
    assert.equal(call.env.EUDI_DEV_HOME, '/tmp/fake-home');
    assert.equal(call.env.NO_COLOR, '1');
    assert.equal(call.env.FAKE_EXTRA, 'yes');
  });

  it('writes stdin', async () => {
    const { document } = await runner.run<{ stdin: string }>(['echo', '-'], { stdin: 'hello~' });
    assert.equal(document.stdin, 'hello~');
  });

  it('turns a non-zero exit into EudiDevError with the last stderr line', async () => {
    await assert.rejects(runner.run(['fail']), (err: unknown) => {
      assert.ok(err instanceof EudiDevError);
      assert.equal(err.message, 'the real error');
      assert.equal(err.exitCode, 1);
      assert.match(err.stderr, /Warning: something/);
      assert.equal(err.document, undefined);
      return true;
    });
  });

  it('refuses stdout that is not one JSON document', async () => {
    await assert.rejects(runner.run(['garbage']), /not one JSON document/);
    await assert.rejects(runner.run(['twodocs']), /not one JSON document/);
  });

  it('times out', async () => {
    await assert.rejects(runner.run(['sleep'], { timeoutMs: 200 }), (err: unknown) => {
      assert.ok(err instanceof EudiDevError);
      assert.equal(err.timedOut, true);
      return true;
    });
  });

  it('aborts', async () => {
    const ac = new AbortController();
    const p = runner.run(['sleep'], { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(p, /aborted/);
  });

  it('reports a missing binary', async () => {
    const r = new Runner({ bin: '/nonexistent/eudi', home: '/tmp' });
    await assert.rejects(r.run(['version']), /Could not run/);
  });

  it('lastLine ignores trailing blank lines', () => {
    assert.equal(lastLine('a\nb\n\n  \n'), 'b');
    assert.equal(lastLine(''), '');
  });
});
