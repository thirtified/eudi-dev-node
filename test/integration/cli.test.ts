// Integration tests against the real eudi-dev binary.
//
//   npm run test:integration
//
// The binary comes from EUDI_DEV_BIN or the installed platform package
// (@thirtified/eudi-dev-<os>-<cpu>). Each suite gets its own EUDI_DEV_HOME.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { type DecodedSdJwt, EudiDev, EudiDevError, isDecodedCredential, SUPPORTED_MAJOR } from '../../src/index.js';

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
