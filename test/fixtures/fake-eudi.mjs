#!/usr/bin/env node
// A stand-in for the eudi binary in unit tests. It follows the --json
// contract (one document on stdout, messages on stderr, exit 0/1) and logs
// every call as one JSON line to $FAKE_EUDI_LOG.

import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const positional = argv.filter((a) => !a.startsWith('--'));

let stdin = '';
try {
  if (!process.stdin.isTTY) {
    const st = statSync('/dev/stdin');
    if (st.isFIFO() || st.isFile() || st.isSocket()) stdin = readFileSync(0, 'utf8');
  }
} catch {
  stdin = '';
}

// Contents of file-valued flags, so tests can check what the wrapper wrote.
const files = {};
for (const a of argv) {
  const m = /^--([a-z-]+)=@?(.+)$/.exec(a);
  if (m && existsSync(m[2]) && statSync(m[2]).isFile()) files[m[1]] = readFileSync(m[2], 'utf8');
}

if (process.env.FAKE_EUDI_LOG) {
  appendFileSync(
    process.env.FAKE_EUDI_LOG,
    `${JSON.stringify({
      argv,
      stdin,
      files,
      env: {
        EUDI_DEV_HOME: process.env.EUDI_DEV_HOME,
        NO_COLOR: process.env.NO_COLOR,
        EUDI_DEV_STORAGE: process.env.EUDI_DEV_STORAGE,
        FAKE_EXTRA: process.env.FAKE_EXTRA,
      },
    })}\n`,
  );
}

const out = (doc) => process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);

const check = (name, status, detail) => ({ name, status, detail });

switch (positional[0]) {
  case 'version':
    out({ name: 'eudi', version: process.env.FAKE_EUDI_VERSION ?? 'v3.10.1' });
    break;

  case 'decode':
    if (stdin.includes('not-a-credential')) {
      process.stderr.write('unable to auto-detect format (not a credential, OpenID4VCI/VP request, trusted list or certificate)\n');
      process.exit(1);
    }
    out({
      format: 'dc+sd-jwt',
      header: { alg: 'ES256', typ: 'dc+sd-jwt' },
      payload: { iss: 'https://issuer.example', vct: 'urn:eudi:pid:1', _sd: ['x'] },
      disclosures: [{ name: 'given_name', value: 'Erika', salt: 's', digest: 'x', isArrayEntry: false, referenced: true }],
      resolvedClaims: { given_name: 'Erika' },
      validation: { checks: [check('signature', 'pass', 'ok')] },
    });
    break;

  case 'validate': {
    const tampered = stdin.includes('tampered');
    const report = {
      format: 'dc+sd-jwt',
      header: {},
      payload: {},
      disclosures: [],
      resolvedClaims: {},
      checks: [
        check('type', 'pass', 'dc+sd-jwt'),
        check('signature', tampered ? 'fail' : 'pass', tampered ? 'signature invalid' : 'valid'),
      ],
      verification: { signatureValid: !tampered, expired: false, notYetValid: false },
    };
    if (stdin.includes('unparsable')) {
      process.stderr.write('parsing SD-JWT: bad input\n');
      process.exit(1);
    }
    out(report);
    if (tampered) {
      process.stderr.write('signature: signature invalid\n');
      process.exit(1);
    }
    break;
  }

  case 'dcql':
    out({
      credentials: [
        { id: 'urn_eudi_pid_1', format: 'dc+sd-jwt', meta: { vct_values: ['urn:eudi:pid:1'] }, claims: [{ path: ['given_name'] }] },
      ],
    });
    break;

  case 'issue': {
    const credential = positional[1] === 'mdoc' ? 'a2646e616d65' : 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJ4In0.c2ln~';
    if (!argv.some((a) => a.startsWith('--key='))) {
      process.stderr.write('Ephemeral signing key (public JWK):\n');
      // Indented like upstream's json.MarshalIndent.
      process.stderr.write(`${JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, null, 2)}\n`);
      process.stderr.write('Saved template\n');
    }
    out(argv.includes('--wallet') ? { credential, id: 'cred-1' } : { credential });
    break;
  }

  case 'trust':
    if (positional[1] === 'show') {
      if (argv.includes('--url')) out({ url: 'http://localhost:8085/api/trustlist' });
      else out({ trust_list: 'eyJ0eXAiOiJ0bCJ9.e30.sig' });
    } else if (positional[1] === 'ca-cert') {
      if (argv.includes('--jwks')) out({ keys: [{ kty: 'EC' }] });
      else out({ pem: '-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n' });
    } else {
      out({ entities: [], entity_lists: ['pid'], lists: [], lists_url: 'http://localhost:8085/api/trustlists/lists', trust_lists: [] });
    }
    break;

  case 'registrar':
    if (positional[2] === 'list') out([]);
    else if (positional[1] === 'revoke' || positional[1] === 'activate') out({ changed: 2 });
    else out({ identifier: [{ identifier: 'NLTEST.1' }], services: [] });
    break;

  case 'garbage':
    process.stdout.write('this is not json\n');
    break;

  case 'twodocs':
    process.stdout.write('{}\n{}\n');
    break;

  case 'fail':
    process.stderr.write('Warning: something\n');
    process.stderr.write('the real error\n');
    process.exit(1);
    break;

  case 'sleep':
    setTimeout(() => out({ slept: true }), 5000);
    break;

  case 'wallet': {
    const id = positional.at(-1);
    const summary = { id: 'cred-1', format: 'dc+sd-jwt', claim_count: 1, certificate_status: { status: 'none' }, holder_binding: 'none' };
    if (positional[1] === 'import') out({ ...summary, claims: { given_name: 'Erika' }, raw: stdin || 'raw' });
    else if (positional[1] === 'list') out({ credentials: [summary] });
    else if (positional[1] === 'show' && id === 'deferred-1') {
      out({ id, transaction_id: 'tx-1', issuer: 'https://issuer.example', format: 'dc+sd-jwt', attempts: 0 });
    } else if (positional[1] === 'show') {
      out(
        argv.includes('--decoded')
          ? { format: 'dc+sd-jwt', header: {}, payload: {}, disclosures: [], resolvedClaims: {} }
          : { ...summary, claims: {}, raw: 'raw' },
      );
    } else if (positional[1] === 'remove') {
      if (id === 'missing') {
        process.stderr.write('credential not found\n');
        process.exit(1);
      }
      out(argv.includes('--all') ? { removed: 2, kept_protected: 0 } : { removed: 1, id });
    } else if (positional[1] === 'tls-cert') {
      out(argv.includes('--jwks') ? { keys: [{ kty: 'EC' }] } : { pem: '-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n' });
    } else if (positional[1] === 'logs') out(positional[2] === 'clean' ? { cleared: true } : []);
    else out({ wallet_dir: `${process.env.EUDI_DEV_HOME}/wallet`, storage: 'file' });
    break;
  }

  case 'templates': {
    const tx = positional[1] === 'transactions';
    const sub = tx ? positional[2] : positional[1];
    const name = positional.at(-1);
    if (sub === 'list') out([]);
    else if (sub === 'types') out({ types: [], hash_algs: ['sha-256'] });
    else if (sub === 'delete') out({ deleted: name });
    else if (sub === 'import') {
      // Like upstream: one object for one template, an array for several.
      const text = stdin.trim();
      const input = text.startsWith('[') ? JSON.parse(text) : text.startsWith('{') ? [JSON.parse(text)] : [{}];
      const results = input.map((t, i) => ({ name: t.name ?? argv.find((a) => a.startsWith('--name='))?.slice(7) ?? `t${i}` }));
      out(results.length === 1 ? results[0] : results);
    } else if (sub === 'save') out({ name, path: `/templates/${name}.json` });
    else out({ name, claims: {} });
    break;
  }

  case 'catalog':
    if (positional[1] === 'list') out([]);
    else if (positional[1] === 'rm') out({ removed: positional.at(-1) });
    else out({ name: 'x', credentials: [], schema: { id: 'cat-1' } });
    break;

  case 'echo':
    out({ argv, stdin, json });
    break;

  default:
    process.stderr.write(`unknown command "${positional[0]}" for "eudi"\n`);
    process.exit(1);
}
