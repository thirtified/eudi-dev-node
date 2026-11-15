// Argument building for the wallet store, templates and catalog commands,
// against the fake binary. test/integration/cli.test.ts runs the same
// commands against the real one.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { EudiDev, EudiDevError, isDeferredIssuance } from '../../src/index.js';
import { callLog, FAKE_BIN } from './helpers.js';

/** The arguments that aren't flags: the command and its positional arguments. */
const positional = (argv: string[]): string[] => argv.filter((a) => !a.startsWith('--'));

describe('wallet, templates and catalog', () => {
  const log = callLog();
  let eudi: EudiDev;
  let dir: string;

  before(async () => {
    eudi = await EudiDev.create({ bin: FAKE_BIN, env: { FAKE_EUDI_LOG: log.path } });
    dir = await mkdtemp(join(tmpdir(), 'store-'));
  });
  after(async () => {
    await eudi.dispose();
    await rm(dir, { recursive: true, force: true });
    log.cleanup();
  });

  describe('wallet', () => {
    it('import sends content on stdin and a path as the argument', async () => {
      const imported = await eudi.wallet.import('eyJ.cred~', { mode: 'strict', seed: 's1' });
      assert.equal(imported.raw, 'eyJ.cred~');
      const call = log.last();
      assert.deepEqual(positional(call.argv), ['wallet', 'import', '-']);
      assert.ok(call.argv.includes('--mode=strict'));
      assert.ok(call.argv.includes('--seed=s1'));
      assert.equal(call.stdin, 'eyJ.cred~');

      const path = join(dir, 'cred.txt');
      await writeFile(path, 'eyJ.file~');
      await eudi.wallet.import({ path });
      assert.deepEqual(positional(log.last().argv), ['wallet', 'import', path]);
    });

    it('import refuses a URL, which upstream would store as raw text', async () => {
      const calls = log.calls().length;
      await assert.rejects(eudi.wallet.import({ url: 'https://example.com/c' } as never), TypeError);
      await assert.rejects(eudi.wallet.import({ path: join(dir, 'missing') }), TypeError);
      assert.equal(log.calls().length, calls, 'the binary was not called');
    });

    it('list, show and showDecoded', async () => {
      assert.equal((await eudi.wallet.list({ walletDir: '/w', storage: 'file', templatesDir: '/t' })).credentials[0]?.id, 'cred-1');
      const listCall = log.last().argv;
      for (const flag of ['--wallet-dir=/w', '--storage=file', '--templates-dir=/t']) assert.ok(listCall.includes(flag), flag);

      const shown = await eudi.wallet.show('cred-1');
      assert.ok(!isDeferredIssuance(shown));
      assert.deepEqual(positional(log.last().argv), ['wallet', 'show', 'cred-1']);

      const deferred = await eudi.wallet.show('deferred-1');
      assert.ok(isDeferredIssuance(deferred));
      assert.equal(deferred.transaction_id, 'tx-1');

      assert.equal((await eudi.wallet.showDecoded('cred-1')).format, 'dc+sd-jwt');
      assert.deepEqual(log.last().argv.slice(0, 3), ['wallet', 'show', '--decoded']);
    });

    it('remove, removeAll and errors', async () => {
      assert.deepEqual(await eudi.wallet.remove('cred-1'), { removed: 1, id: 'cred-1' });
      assert.deepEqual(await eudi.wallet.removeAll(), { removed: 2, kept_protected: 0 });
      assert.deepEqual(log.last().argv.slice(0, 3), ['wallet', 'remove', '--all']);
      await assert.rejects(
        eudi.wallet.remove('missing'),
        (err: unknown) => err instanceof EudiDevError && err.message === 'credential not found',
      );
    });

    it('info, TLS certificate and logs', async () => {
      assert.equal((await eudi.wallet.info()).storage, 'file');
      assert.match(await eudi.wallet.tlsCert({ port: 9000, baseUrl: 'https://wallet.test' }), /BEGIN CERTIFICATE/);
      const tls = log.last().argv;
      assert.ok(tls.includes('--port=9000'));
      assert.ok(tls.includes('--base-url=https://wallet.test'));
      assert.equal((await eudi.wallet.tlsJwks({ docker: true })).keys.length, 1);
      assert.ok(log.last().argv.includes('--docker'));
      assert.deepEqual(await eudi.wallet.logs(), []);
      assert.deepEqual(await eudi.wallet.clearLogs(), { cleared: true });
      assert.deepEqual(log.last().argv.slice(0, 3), ['wallet', 'logs', 'clean']);
    });
  });

  describe('templates', () => {
    it('save writes claims and a template object to temp files', async () => {
      const from = { vct: 'urn:x', claims: { a: 1 } };
      const saved = await eudi.templates.save('mine', {
        claims: { given_name: 'Erika' },
        from,
        format: 'sdjwt',
        vct: 'urn:example:mine',
        alwaysDisclosed: ['a', 'b.c'],
        exp: '24h',
      });
      assert.deepEqual(saved, { name: 'mine', path: '/templates/mine.json' });
      const call = log.last();
      assert.deepEqual(positional(call.argv), ['templates', 'save', 'mine']);
      assert.deepEqual(JSON.parse(call.files.claims ?? ''), { given_name: 'Erika' });
      assert.deepEqual(JSON.parse(call.files.from ?? ''), from);
      for (const flag of ['--format=sdjwt', '--vct=urn:example:mine', '--always-disclosed=a,b.c', '--exp=24h'])
        assert.ok(call.argv.includes(flag), flag);

      await eudi.templates.save('copy', { from: 'mine' });
      assert.ok(log.last().argv.includes('--from=mine'));
    });

    it('import always returns a list', async () => {
      assert.deepEqual(await eudi.templates.import({ claims: {} }, { name: 'one' }), [{ name: 'one' }]);
      assert.ok(log.last().argv.includes('--name=one'));
      assert.deepEqual(JSON.parse(log.last().stdin), { claims: {} });
      assert.deepEqual(
        await eudi.templates.import([
          { name: 'a', claims: {} },
          { name: 'b', claims: {} },
        ]),
        [{ name: 'a' }, { name: 'b' }],
      );
      const yaml = 'name: y\nclaims: {}\n';
      await eudi.templates.import(yaml);
      assert.equal(log.last().stdin, yaml);
    });

    it('list, show, delete and the transaction templates', async () => {
      assert.deepEqual(await eudi.templates.list(), []);
      assert.equal((await eudi.templates.show('pid')).name, 'pid');
      assert.deepEqual(await eudi.templates.delete('mine'), { deleted: 'mine' });

      const tx = eudi.templates.transactions;
      assert.deepEqual(await tx.list(), []);
      assert.deepEqual(log.last().argv.slice(0, 3), ['templates', 'transactions', 'list']);
      await tx.show('payment');
      assert.deepEqual(positional(log.last().argv), ['templates', 'transactions', 'show', 'payment']);
      assert.deepEqual(await tx.import({ name: 'p', transaction_data: { type: 'urn:x' } }), [{ name: 'p' }]);
      assert.deepEqual(await tx.delete('p'), { deleted: 'p' });
      assert.deepEqual((await tx.types()).hash_algs, ['sha-256']);
    });
  });

  describe('catalog', () => {
    it('add passes repeatable types and claims and writes the issuer CA to a file', async () => {
      const pem = '-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n';
      const added = await eudi.catalog.add({
        name: 'Diploma',
        types: ['dc+sd-jwt:urn:example:diploma:1', 'mso_mdoc:org.example.diploma.1'],
        claims: ['dc+sd-jwt:degree'],
        category: 'qeaa',
        los: 'moderate',
        issuerCa: pem,
      });
      assert.equal(added.schema.id, 'cat-1');
      const call = log.last();
      for (const flag of [
        '--name=Diploma',
        '--type=dc+sd-jwt:urn:example:diploma:1',
        '--type=mso_mdoc:org.example.diploma.1',
        '--claim=dc+sd-jwt:degree',
        '--category=qeaa',
        '--los=moderate',
      ]) {
        assert.ok(call.argv.includes(flag), flag);
      }
      assert.equal(call.files['issuer-ca'], pem);
    });

    it('list and remove', async () => {
      assert.deepEqual(await eudi.catalog.list(), []);
      assert.deepEqual(await eudi.catalog.remove('cat-1'), { removed: 'cat-1' });
      assert.deepEqual(positional(log.last().argv), ['catalog', 'rm', 'cat-1']);
    });
  });
});
