// Integration tests against the real eudi-dev binary.
//
//   npm run test:integration
//
// The binary comes from EUDI_DEV_BIN or the installed platform package
// (@thirtified/eudi-dev-<os>-<cpu>). Each suite gets its own EUDI_DEV_HOME.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type DecodedSdJwt, EudiDev, EudiDevError, isDecodedCredential, isDeferredIssuance, SUPPORTED_MAJOR } from '../../src/index.js';

const TIMEOUT = 120_000;

/** Flips the first character of the issuer JWT's signature. */
function tamperSignature(sdjwt: string): string {
  const [jwt, ...rest] = sdjwt.split('~');
  const parts = (jwt ?? '').split('.');
  const sig = parts[2] ?? '';
  parts[2] = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  return [parts.join('.'), ...rest].join('~');
}

describe('stateless tools', { timeout: TIMEOUT }, () => {
  let eudi: EudiDev;
  before(async () => {
    eudi = await EudiDev.create();
  });
  after(async () => {
    await eudi?.dispose();
  });

  it('reports a supported version', () => {
    assert.match(eudi.version.version, new RegExp(`^v${SUPPORTED_MAJOR}\\.`));
  });

  it('issue sdjwt → decode', async () => {
    const { credential, publicJwk } = await eudi.issue.sdjwt({ pid: true, omit: ['sex'] });
    assert.ok(publicJwk, 'ephemeral public JWK is reported');
    const doc = await eudi.decode(credential);
    assert.ok(isDecodedCredential(doc));
    assert.equal(doc.format, 'dc+sd-jwt');
    const sd = doc as DecodedSdJwt;
    assert.ok('given_name' in sd.resolvedClaims);
    assert.ok(!('sex' in sd.resolvedClaims));
    assert.ok(Array.isArray(doc.validation.checks));
  });

  it('issue sdjwt with custom claims and always-disclosed claims', async () => {
    const { credential } = await eudi.issue.sdjwt({
      vct: 'urn:example:card',
      claims: { given_name: 'Erika', address: { locality: 'Berlin', country: 'DE' } },
      alwaysDisclosed: ['address.country'],
    });
    const doc = (await eudi.decode(credential)) as DecodedSdJwt;
    assert.equal(doc.payload.vct, 'urn:example:card');
    assert.deepEqual(doc.resolvedClaims.address, { locality: 'Berlin', country: 'DE' });
  });

  it('validate passes for a valid credential and fails for a tampered one', async () => {
    const { credential, publicJwk } = await eudi.issue.sdjwt({ pid: true });
    assert.ok(publicJwk);

    const ok = await eudi.validate(credential, { key: publicJwk });
    assert.equal(ok.valid, true, String(ok.error));
    assert.equal(ok.report.checks.find((c) => c.name === 'signature')?.status, 'pass');
    assert.equal(ok.report.verification?.signatureValid, true);

    const bad = await eudi.validate(tamperSignature(credential), { key: publicJwk });
    assert.equal(bad.valid, false);
    assert.match(bad.error ?? '', /^signature/);
    assert.equal(bad.report.checks.find((c) => c.name === 'signature')?.status, 'fail');
  });

  it('validate --haip reports findings without failing', async () => {
    const { credential, publicJwk } = await eudi.issue.sdjwt({ pid: true });
    const r = await eudi.validate(credential, { key: publicJwk, haip: true });
    assert.equal(r.valid, true, String(r.error));
    // An ephemeral key has no x5c, which HAIP 1.0 §6.1.1 requires.
    assert.ok(Array.isArray(r.report.haipFindings));
    assert.ok((r.report.haipFindings ?? []).length > 0);
  });

  it('issue jwt → decode', async () => {
    const { credential } = await eudi.issue.jwt({ pid: true });
    const doc = await eudi.decode(credential, { format: 'jwt' });
    assert.equal((doc as { format: string }).format, 'jwt');
  });

  it('issue mdoc → dcql', async () => {
    const { credential } = await eudi.issue.mdoc({ pid: true });
    const query = await eudi.dcql(credential);
    const cq = query.credentials[0];
    assert.equal(cq?.format, 'mso_mdoc');
    assert.equal(cq?.meta?.doctype_value, 'eu.europa.ec.eudi.pid.1');
    assert.ok((cq?.claims ?? []).length > 0);
  });

  it('dcql for an SD-JWT matches the documented example', async () => {
    const { credential } = await eudi.issue.sdjwt({
      vct: 'urn:example:card',
      claims: { given_name: 'Erika', address: { locality: 'Berlin' } },
    });
    const query = await eudi.dcql(credential);
    assert.equal(query.credentials[0]?.id, 'urn_example_card');
    assert.deepEqual(query.credentials[0]?.meta?.vct_values, ['urn:example:card']);
    const paths = (query.credentials[0]?.claims ?? []).map((c) => c.path.join('.'));
    assert.ok(paths.includes('given_name'));
    assert.ok(paths.includes('address.locality'));
  });

  it('rejects input it cannot detect', async () => {
    await assert.rejects(eudi.decode('definitely not a credential'), (err: unknown) => {
      assert.ok(err instanceof EudiDevError);
      assert.equal(err.exitCode, 1);
      assert.ok(err.message.length > 0);
      return true;
    });
  });
});

describe('wallet, trust and registrar (local state)', { timeout: TIMEOUT }, () => {
  let eudi: EudiDev;
  before(async () => {
    eudi = await EudiDev.create();
  });
  after(async () => {
    await eudi?.dispose();
  });

  it('exports the wallet CA', async () => {
    assert.match(await eudi.trust.caCert(), /-----BEGIN CERTIFICATE-----/);
    const jwks = await eudi.trust.caJwks();
    assert.ok(jwks.keys.length >= 1);
  });

  it('lists the trusted lists', async () => {
    const overview = await eudi.trust.list();
    assert.ok(overview.trust_lists.length > 0);
    assert.ok(overview.entity_lists.includes('pid'));
  });

  it('issues into the wallet and validates against its trusted list', async () => {
    const issued = await eudi.issue.sdjwt({ pid: true, wallet: true });
    assert.ok(issued.id, 'wallet credential id');
    const trustedList = await eudi.trust.show({ vct: 'urn:eudi:pid:1' });
    assert.match(trustedList, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    // The status list is served by `wallet serve`, which isn't running here.
    const r = await eudi.validate(issued.credential, { trustedList, statusList: false });
    assert.equal(r.valid, true, String(r.error));
    assert.ok((r.report.certificates ?? []).length > 0, 'x5c chain decoded');
  });

  it('registers a verifier and issues its registration certificate', async () => {
    const { credential } = await eudi.issue.sdjwt({ pid: true });
    const dcql = await eudi.dcql(credential);

    const rp = await eudi.registrar.verifiers.add({ name: 'Integration Shop', purpose: 'Age check', dcql });
    const identifier = rp.identifier[0]?.identifier;
    assert.ok(identifier);

    const listed = await eudi.registrar.verifiers.list();
    assert.ok(listed.some((p) => p.identifier[0]?.identifier === identifier));

    const cert = await eudi.registrar.registrationCert({ identifier });
    assert.match(cert.registrationCertificate, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(cert.verifierInfo);

    const revoked = await eudi.registrar.revoke({ identifier });
    assert.ok(revoked.changed >= 1);
    const activated = await eudi.registrar.activate({ identifier });
    assert.ok(activated.changed >= 1);

    assert.deepEqual(await eudi.registrar.verifiers.remove(identifier), { removed: identifier });
  });
});

describe('wallet store, templates and catalog (local state)', { timeout: TIMEOUT }, () => {
  let eudi: EudiDev;
  before(async () => {
    eudi = await EudiDev.create();
  });
  after(async () => {
    await eudi?.dispose();
  });

  it('keeps issued and imported credentials between calls', async () => {
    const issued = await eudi.issue.sdjwt({ pid: true, wallet: true });
    assert.ok(issued.id);
    const mdoc = await eudi.issue.mdoc({ pid: true, wallet: true });
    assert.ok(mdoc.id);
    const { credential } = await eudi.issue.sdjwt({ vct: 'urn:example:card', claims: { given_name: 'Erika' } });
    const imported = await eudi.wallet.import(credential);
    assert.equal(imported.format, 'dc+sd-jwt');
    assert.equal(imported.vct, 'urn:example:card');
    assert.equal(imported.raw, credential);
    assert.equal(imported.claims.given_name, 'Erika');

    const { credentials } = await eudi.wallet.list();
    const ids = credentials.map((c) => c.id);
    for (const id of [issued.id, mdoc.id, imported.id]) assert.ok(ids.includes(id), `${id} is listed`);
    const listedMdoc = credentials.find((c) => c.id === mdoc.id);
    assert.equal(listedMdoc?.format, 'mso_mdoc');
    assert.equal(listedMdoc?.doctype, 'eu.europa.ec.eudi.pid.1');
    assert.equal(listedMdoc?.holder_binding, 'this_wallet');
    assert.ok(listedMdoc?.certificate_status.status);
    assert.ok(!('raw' in (listedMdoc ?? {})), 'a listing has no raw credential');

    const shown = await eudi.wallet.show(issued.id);
    assert.ok(!isDeferredIssuance(shown));
    assert.equal(shown.raw, issued.credential);
    assert.equal(shown.claim_count > 0, true);
    assert.equal(shown.status?.managed, true, 'the wallet keeps the status of what it issued');

    const decoded = await eudi.wallet.showDecoded(issued.id);
    assert.equal(decoded.format, 'dc+sd-jwt');
    assert.ok(!('validation' in decoded));
  });

  it('removes credentials and rejects unknown ids', async () => {
    const { credential } = await eudi.issue.sdjwt({ vct: 'urn:example:gone' });
    const { id } = await eudi.wallet.import({ path: await writeTemp('gone.txt', credential) });
    assert.deepEqual(await eudi.wallet.remove(id), { removed: 1, id });
    await assert.rejects(eudi.wallet.remove(id), (err: unknown) => err instanceof EudiDevError && /not found/.test(err.message));
    await assert.rejects(eudi.wallet.import({ url: 'https://example.com/x' } as never), TypeError);

    const all = await eudi.wallet.removeAll();
    assert.equal(typeof all.removed, 'number');
    assert.equal(typeof all.kept_protected, 'number');
    assert.deepEqual((await eudi.wallet.list()).credentials, []);
  });

  it('reports its configuration, TLS certificate and activity log', async () => {
    const info = await eudi.wallet.info();
    assert.ok(info.wallet_dir.startsWith(eudi.home));
    assert.equal(info.storage, 'file');
    assert.match(await eudi.wallet.tlsCert(), /-----BEGIN CERTIFICATE-----/);
    assert.ok((await eudi.wallet.tlsJwks({ port: 9000 })).keys.length >= 1);

    const logs = await eudi.wallet.logs();
    assert.ok(logs.length > 0, 'the earlier tests left log entries');
    assert.equal(typeof logs[0]?.success, 'boolean');
    assert.deepEqual(await eudi.wallet.clearLogs(), { cleared: true });
    assert.deepEqual(await eudi.wallet.logs(), []);
  });

  it('saves, imports, shows and deletes credential templates', async () => {
    const predefined = await eudi.templates.list();
    assert.ok(predefined.some((t) => t.predefined));

    const saved = await eudi.templates.save('card', {
      format: 'sdjwt',
      vct: 'urn:example:card:1',
      claims: { given_name: 'Erika', level: 3 },
      description: 'A test card',
    });
    assert.equal(saved.name, 'card');
    assert.ok(saved.path.startsWith(eudi.home));
    const shown = await eudi.templates.show('card');
    assert.equal(shown.vct, 'urn:example:card:1');
    assert.deepEqual(shown.claims, { given_name: 'Erika', level: 3 });

    const copy = await eudi.templates.save('card-copy', { from: 'card', description: 'Copied' });
    assert.equal(copy.name, 'card-copy');
    assert.equal((await eudi.templates.show('card-copy')).vct, 'urn:example:card:1');

    const imported = await eudi.templates.import([
      { name: 'a', vct: 'urn:example:a', claims: { x: 1 } },
      { name: 'b', vct: 'urn:example:b', claims: { y: 2 } },
    ]);
    assert.deepEqual(
      imported.map((t) => t.name),
      ['a', 'b'],
    );
    assert.deepEqual(
      (await eudi.templates.import({ vct: 'urn:example:c', claims: { z: 3 } }, { name: 'c' })).map((t) => t.name),
      ['c'],
    );

    // A saved template issues like a predefined one.
    const { credential } = await eudi.issue.sdjwt({ template: 'card' });
    const doc = (await eudi.decode(credential)) as DecodedSdJwt;
    assert.equal(doc.resolvedClaims.given_name, 'Erika');

    for (const name of ['card', 'card-copy', 'a', 'b', 'c']) assert.deepEqual(await eudi.templates.delete(name), { deleted: name });
    await assert.rejects(eudi.templates.show('card'), EudiDevError);
  });

  it('manages transaction templates and lists the transaction types', async () => {
    const list = await eudi.templates.transactions.list();
    const first = list[0];
    assert.ok(first, 'predefined transaction templates exist');
    assert.equal(typeof first.transaction_data.type, 'string');
    const shown = await eudi.templates.transactions.show(first.name);
    assert.deepEqual(shown.transaction_data, first.transaction_data);

    assert.deepEqual(await eudi.templates.transactions.import({ ...shown, name: 'mine', predefined: undefined }), [{ name: 'mine' }]);
    assert.equal((await eudi.templates.transactions.show('mine')).transaction_data.type, first.transaction_data.type);
    assert.deepEqual(await eudi.templates.transactions.delete('mine'), { deleted: 'mine' });

    const { types, hash_algs } = await eudi.templates.transactions.types();
    assert.ok(types.some((t) => t.ts12 && t.fields.some((f) => f.required)));
    assert.ok(hash_algs.length > 0);
  });

  it('adds and removes catalogue entries', async () => {
    const entries = await eudi.catalog.list();
    assert.ok(
      entries.some((e) => e.template),
      'predefined templates are in the catalogue',
    );

    const added = await eudi.catalog.add({
      name: 'Diploma',
      types: ['dc+sd-jwt:urn:example:diploma:1'],
      claims: ['dc+sd-jwt:degree'],
      los: 'moderate',
    });
    assert.equal(added.name, 'Diploma');
    assert.deepEqual(added.credentials[0]?.claims, [['degree']]);
    assert.equal(added.schema.attestationLoS, 'iso_18045_moderate');
    const id = added.schema.id;
    assert.ok(id);
    assert.ok((await eudi.catalog.list()).some((e) => e.schema.id === id));
    assert.deepEqual(await eudi.catalog.remove(id), { removed: id });
    assert.ok(!(await eudi.catalog.list()).some((e) => e.schema.id === id));
  });
});

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function writeTemp(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eudi-int-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}
