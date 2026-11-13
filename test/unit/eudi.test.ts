import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parseEphemeralJwk } from '../../src/commands/credentials.js';
import { EudiDev, EudiDevBinaryError, EudiDevError, isDecodedCredential } from '../../src/index.js';
import { callLog, FAKE_BIN } from './helpers.js';

describe('EudiDev.create', () => {
  it('creates and removes its own home', async () => {
    const eudi = await EudiDev.create({ bin: FAKE_BIN });
    assert.equal(eudi.version.version, 'v3.10.1');
    assert.ok((await stat(eudi.home)).isDirectory());
    await eudi.dispose();
    await assert.rejects(stat(eudi.home));
    assert.throws(() => eudi.decode('x'), /disposed/);
  });

  it('keeps a home it was given', async () => {
    const home = await mkdtemp(join(tmpdir(), 'given-home-'));
    try {
      const eudi = await EudiDev.create({ bin: FAKE_BIN, home });
      await eudi.dispose();
      assert.ok((await stat(home)).isDirectory());
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('refuses another major version unless allowed', async () => {
    await assert.rejects(EudiDev.create({ bin: FAKE_BIN, env: { FAKE_EUDI_VERSION: 'v4.0.0' } }), EudiDevBinaryError);
    const eudi = await EudiDev.create({ bin: FAKE_BIN, env: { FAKE_EUDI_VERSION: 'v4.0.0' }, allowAnyVersion: true });
    await eudi.dispose();
    // dev builds have no version to check
    const dev = await EudiDev.create({ bin: FAKE_BIN, env: { FAKE_EUDI_VERSION: 'dev' } });
    await dev.dispose();
  });

  it('supports await using', async () => {
    let home = '';
    {
      await using eudi = await EudiDev.create({ bin: FAKE_BIN });
      home = eudi.home;
    }
    await assert.rejects(stat(home));
  });
});

describe('wrappers', () => {
  const log = callLog();
  let eudi: EudiDev;
  let dir: string;

  before(async () => {
    eudi = await EudiDev.create({ bin: FAKE_BIN, env: { FAKE_EUDI_LOG: log.path } });
    dir = await mkdtemp(join(tmpdir(), 'wrappers-'));
  });
  after(async () => {
    await eudi.dispose();
    await rm(dir, { recursive: true, force: true });
    log.cleanup();
  });

  it('decode sends content on stdin and passes --format', async () => {
    const doc = await eudi.decode('eyJ...~', { format: 'sdjwt' });
    assert.ok(isDecodedCredential(doc));
    assert.equal(doc.format, 'dc+sd-jwt');
    const call = log.last();
    assert.deepEqual(call.argv, ['decode', '--format=sdjwt', '-', '--json', '--no-color']);
    assert.equal(call.stdin, 'eyJ...~');
  });

  it('decode errors carry stderr and exit code', async () => {
    await assert.rejects(eudi.decode('not-a-credential'), (err: unknown) => {
      assert.ok(err instanceof EudiDevError);
      assert.match(err.message, /unable to auto-detect/);
      assert.equal(err.exitCode, 1);
      return true;
    });
  });

  it('validate returns valid:true with the report', async () => {
    const r = await eudi.validate('good~', { key: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, haip: true, statusList: false });
    assert.equal(r.valid, true);
    assert.equal(r.error, undefined);
    assert.equal(r.report.checks.find((c) => c.name === 'signature')?.status, 'pass');
    const call = log.last();
    assert.deepEqual(JSON.parse(call.files.key ?? ''), { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' });
    assert.ok(call.argv.includes('--haip'));
    assert.ok(call.argv.includes('--status-list=false'));
  });

  it('validate returns valid:false instead of throwing when checks fail', async () => {
    const r = await eudi.validate('tampered~', { trustedList: { url: 'http://localhost:8085/api/trustlist' } });
    assert.equal(r.valid, false);
    assert.equal(r.error, 'signature: signature invalid');
    assert.equal(r.report.verification?.signatureValid, false);
    assert.ok(log.last().argv.includes('--trusted-list=http://localhost:8085/api/trustlist'));
  });

  it('treats options set to undefined like omitted options', async () => {
    // Callers with exactOptionalPropertyTypes pass maybe-undefined values,
    // e.g. the README's `{ key: publicJwk }`. They must not reach argv.
    await eudi.validate('good~', {});
    const omitted = log.last().argv;
    await eudi.validate('good~', {
      key: undefined,
      trustedList: undefined,
      haip: undefined,
      statusList: undefined,
      extraArgs: undefined,
      timeoutMs: undefined,
      signal: undefined,
    });
    assert.deepEqual(log.last().argv, omitted);

    await eudi.issue.sdjwt({ pid: true });
    const issueOmitted = log.last().argv;
    await eudi.issue.sdjwt({ pid: true, claims: undefined, key: undefined, vct: undefined, iss: undefined, omit: undefined });
    assert.deepEqual(log.last().argv, issueOmitted);
  });

  it('validate throws when there is no report', async () => {
    await assert.rejects(eudi.validate('unparsable'), /parsing SD-JWT/);
  });

  it('validate writes trusted list content to a temp file that is removed afterwards', async () => {
    await eudi.validate('good~', { trustedList: 'eyJ0bCJ9.e30.sig' });
    const call = log.last();
    assert.equal(call.files['trusted-list'], 'eyJ0bCJ9.e30.sig');
    const flag = call.argv.find((a) => a.startsWith('--trusted-list='));
    assert.ok(flag);
    await assert.rejects(stat(flag.slice('--trusted-list='.length)));
  });

  it('dcql', async () => {
    const q = await eudi.dcql({ path: await writeTmp(dir, 'c.txt', 'cred~') });
    assert.equal(q.credentials[0]?.format, 'dc+sd-jwt');
    assert.match(log.last().argv.at(0) ?? '', /^dcql$/);
  });

  it('issue sdjwt builds flags and returns the ephemeral JWK', async () => {
    const r = await eudi.issue.sdjwt({
      pid: true,
      claims: { given_name: 'Erika', address: { locality: 'Berlin' } },
      omit: ['sex', 'place_of_birth'],
      alwaysDisclosed: ['issuing_country'],
      nbf: '-1h',
      vct: 'urn:eudi:pid:de:1',
      statusListIdx: 0,
    });
    assert.match(r.credential, /~$/);
    assert.equal(r.id, undefined);
    assert.deepEqual(r.publicJwk, { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' });
    const call = log.last();
    assert.deepEqual(JSON.parse(call.files.claims ?? ''), { given_name: 'Erika', address: { locality: 'Berlin' } });
    for (const a of [
      '--pid',
      '--omit=sex,place_of_birth',
      '--always-disclosed=issuing_country',
      '--nbf=-1h',
      '--vct=urn:eudi:pid:de:1',
      '--status-list-idx=0',
    ]) {
      assert.ok(call.argv.includes(a), `missing ${a} in ${call.argv.join(' ')}`);
    }
    assert.ok(call.argv.some((a) => a.startsWith('--claims=@')));
  });

  it('issue with wallet returns the id and passes registration and display flags', async () => {
    const r = await eudi.issue.mdoc({
      wallet: true,
      docType: 'org.example.card',
      key: '-----BEGIN PRIVATE KEY-----',
      display: { name: 'Card', backgroundColor: '#3d59a1' },
      registration: { category: 'eaa', entitlements: ['https://a', 'https://b'] },
    });
    assert.equal(r.id, 'cred-1');
    assert.equal(r.publicJwk, undefined);
    const call = log.last();
    assert.deepEqual(call.argv.slice(0, 2), ['issue', 'mdoc']);
    for (const a of [
      '--wallet',
      '--doc-type=org.example.card',
      '--display-name=Card',
      '--background-color=#3d59a1',
      '--category=eaa',
      '--entitlement=https://a',
      '--entitlement=https://b',
    ]) {
      assert.ok(call.argv.includes(a), `missing ${a}`);
    }
    assert.equal(call.files.key, '-----BEGIN PRIVATE KEY-----');
  });

  it('trust commands unwrap their documents', async () => {
    assert.match(await eudi.trust.caCert(), /BEGIN CERTIFICATE/);
    assert.deepEqual((await eudi.trust.caJwks()).keys.length, 1);
    assert.equal(await eudi.trust.show({ list: 'eaa' }), 'eyJ0eXAiOiJ0bCJ9.e30.sig');
    assert.deepEqual(log.last().argv.slice(0, 3), ['trust', 'show', 'eaa']);
    assert.match(await eudi.trust.url({ port: 9000 }), /^http/);
    assert.ok(log.last().argv.includes('--port=9000'));
    assert.deepEqual((await eudi.trust.list()).entity_lists, ['pid']);
  });

  it('registrar verifiers add writes the DCQL query to a file', async () => {
    const dcql = { credentials: [{ id: 'pid', format: 'dc+sd-jwt', claims: [{ path: ['age_over_18'] }] }] };
    await eudi.registrar.verifiers.add({ name: 'Shop', purpose: 'Age check', dcql });
    const call = log.last();
    assert.deepEqual(call.argv.slice(0, 3), ['registrar', 'verifiers', 'add']);
    assert.ok(call.argv.includes('--name=Shop'));
    assert.ok(call.argv.includes('--purpose=Age check'));
    assert.deepEqual(JSON.parse(call.files.dcql ?? ''), dcql);
  });

  it('registrar extend omits party flags and passes --to', async () => {
    await eudi.registrar.issuers.extend({ to: 'NLTEST.1', attestations: ['dc+sd-jwt:urn:eudi:pid:1'], categories: ['pid'] });
    const call = log.last();
    assert.ok(call.argv.includes('--to=NLTEST.1'));
    assert.ok(call.argv.includes('--attestation=dc+sd-jwt:urn:eudi:pid:1'));
    assert.ok(call.argv.includes('--category=pid'));
    assert.ok(!call.argv.some((a) => a.startsWith('--name=')));
  });

  it('registrar list, revoke, enrol', async () => {
    assert.deepEqual(await eudi.registrar.verifiers.list(), []);
    assert.deepEqual(await eudi.registrar.revoke({ identifier: 'NLTEST.1', intendedUse: 'u1' }), { changed: 2 });
    assert.ok(log.last().argv.includes('--intended-use=u1'));
    await eudi.registrar.enrol({ relyingParty: { tradeName: 'X' } }, { update: true });
    const call = log.last();
    assert.deepEqual(call.argv.slice(0, 4), ['registrar', 'enrol', '--update', '-']);
    assert.deepEqual(JSON.parse(call.stdin), { relyingParty: { tradeName: 'X' } });
  });

  it('run() is an escape hatch for other commands', async () => {
    const { document } = await eudi.run<{ argv: string[] }>(['echo', 'x'], { timeoutMs: 5000 });
    assert.equal(document.argv[0], 'echo');
  });
});

describe('parseEphemeralJwk', () => {
  it('reads the line after the marker', () => {
    assert.deepEqual(parseEphemeralJwk('noise\nEphemeral signing key (public JWK):\n{"kty":"EC"}\n'), { kty: 'EC' });
    // The format upstream prints (json.MarshalIndent), followed by more stderr.
    const indented =
      'Ephemeral signing key (public JWK):\n{\n  "crv": "P-256",\n  "kty": "EC",\n  "x": "AAA",\n  "y": "BBB"\n}\nmore output\n';
    assert.deepEqual(parseEphemeralJwk(indented), { crv: 'P-256', kty: 'EC', x: 'AAA', y: 'BBB' });
    assert.equal(parseEphemeralJwk('nothing here'), undefined);
    assert.equal(parseEphemeralJwk('Ephemeral signing key (public JWK):\nnot json'), undefined);
  });
});

async function writeTmp(dir: string, name: string, content: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, content);
  return p;
}
