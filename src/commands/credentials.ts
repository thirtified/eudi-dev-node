import { EudiDevError } from '../errors.js';
import { type FileInput, type Input, isPathInput } from '../input.js';
import { ArgList, positionalInput, type Runner, type RunOptions, Scratch } from '../runner.js';
import type { DcqlQuery, DecodeCredentialResult, DecodeResult, IssueDocument, JsonObject, ValidateReport, VersionInfo } from '../types.js';

/** Per-call options shared by every wrapper. */
export type CallOptions = Pick<RunOptions, 'timeoutMs' | 'signal'> & {
  /** Appended to the generated arguments, for flags this package doesn't wrap. */
  extraArgs?: string[] | undefined;
};

function runOpts(opts: CallOptions, stdin?: string | Uint8Array): RunOptions {
  const r: RunOptions = {};
  if (opts.timeoutMs !== undefined) r.timeoutMs = opts.timeoutMs;
  if (opts.signal !== undefined) r.signal = opts.signal;
  if (stdin !== undefined) r.stdin = stdin;
  return r;
}

// ── version ───────────────────────────────────────────────────────────────

export async function version(runner: Runner, opts: CallOptions = {}): Promise<VersionInfo> {
  const { document } = await runner.run<VersionInfo>(['version', ...(opts.extraArgs ?? [])], runOpts(opts));
  return document;
}

// ── decode ────────────────────────────────────────────────────────────────

export type DecodeFormat = 'sdjwt' | 'jwt' | 'mdoc' | 'vci' | 'vp' | 'trusted-list' | 'x509';

export interface DecodeOptions extends CallOptions {
  /** Skip auto-detection (`--format`). */
  format?: DecodeFormat | undefined;
}

/**
 * `eudi decode`: inspects a credential, certificate, OpenID4VCI offer,
 * OpenID4VP request or trusted list. For credentials and certificates the
 * document also holds the decoder's checks under `validation.checks`.
 */
export async function decode(runner: Runner, input: Input, opts: DecodeOptions = {}): Promise<DecodeResult> {
  const { arg, stdin } = await positionalInput(input);
  const args = new ArgList('decode').value('format', opts.format).push(...(opts.extraArgs ?? []), arg);
  const { document } = await runner.run<DecodeResult>(args.args, runOpts(opts, stdin));
  return document;
}

/** True when a decode result is a credential or certificate (it carries `validation`). */
export function isDecodedCredential(doc: DecodeResult): doc is DecodeCredentialResult {
  const format = (doc as { format?: unknown }).format;
  return (
    typeof doc === 'object' &&
    doc !== null &&
    typeof (doc as { validation?: unknown }).validation === 'object' &&
    (format === 'dc+sd-jwt' || format === 'jwt' || format === 'mso_mdoc' || format === 'x509')
  );
}

// ── validate ──────────────────────────────────────────────────────────────

export interface ValidateOptions extends CallOptions {
  /** Issuer public key, PEM or JWK (`--key`). A JWK object is serialised. */
  key?: FileInput | JsonObject | undefined;
  /** ETSI trusted list JWT: content, `{ path }` or `{ url }` (`--trusted-list`). */
  trustedList?: FileInput | undefined;
  /** Check the status list when the credential references one. Default `true` upstream. */
  statusList?: boolean | undefined;
  /** Don't fail on a credential outside its validity period. */
  allowExpired?: boolean | undefined;
  /** Also report HAIP 1.0 findings (informational, they don't fail validation). */
  haip?: boolean | undefined;
}

export interface ValidateResult {
  /** False when a type, expiry, integrity, signature, certificate revocation or status check failed. */
  valid: boolean;
  /** The first failing check as `"<name>: <detail>"`, as eudi-dev reports it. */
  error?: string;
  report: ValidateReport;
  stderr: string;
}

/**
 * `eudi validate`. A failing check does not throw: the result has
 * `valid: false` and the full report. It throws {@link EudiDevError} when
 * there is no report, for example for input that doesn't parse.
 */
export async function validate(runner: Runner, input: Input, opts: ValidateOptions = {}): Promise<ValidateResult> {
  const scratch = new Scratch();
  try {
    const { arg, stdin } = await positionalInput(input);
    const args = new ArgList('validate');
    if (opts.key !== undefined) {
      const key = isJsonObject(opts.key) ? JSON.stringify(opts.key) : opts.key;
      args.value('key', await scratch.file(key, 'key'));
    }
    if (opts.trustedList !== undefined) {
      args.value('trusted-list', await scratch.file(opts.trustedList, 'trusted-list.jwt', { allowUrl: true }));
    }
    args
      .bool('status-list', opts.statusList)
      .on('allow-expired', opts.allowExpired)
      .on('haip', opts.haip)
      .push(...(opts.extraArgs ?? []), arg);

    try {
      const { document, stderr } = await runner.run<ValidateReport>(args.args, runOpts(opts, stdin));
      return { valid: true, report: document, stderr };
    } catch (err) {
      if (err instanceof EudiDevError && isReport(err.document)) {
        return { valid: false, error: err.message, report: err.document, stderr: err.stderr };
      }
      throw err;
    }
  } finally {
    await scratch.cleanup();
  }
}

function isReport(doc: unknown): doc is ValidateReport {
  return typeof doc === 'object' && doc !== null && Array.isArray((doc as { checks?: unknown }).checks);
}

function isJsonObject(v: unknown): v is JsonObject {
  return (
    typeof v === 'object' &&
    v !== null &&
    !(v instanceof Uint8Array) &&
    !('path' in v && typeof (v as { path: unknown }).path === 'string') &&
    !('url' in v && typeof (v as { url: unknown }).url === 'string')
  );
}

// ── dcql ──────────────────────────────────────────────────────────────────

/** `eudi dcql`: a DCQL query asking for every claim of the credential. */
export async function dcql(runner: Runner, input: Input, opts: CallOptions = {}): Promise<DcqlQuery> {
  const { arg, stdin } = await positionalInput(input);
  const { document } = await runner.run<DcqlQuery>(['dcql', ...(opts.extraArgs ?? []), arg], runOpts(opts, stdin));
  return document;
}

// ── issue ─────────────────────────────────────────────────────────────────

export type CredentialCategory = 'pid' | 'qeaa' | 'pub-eaa' | 'eaa' | 'unlisted';

/** Card display flags, used with `wallet: true`. */
export interface IssueDisplayOptions {
  name?: string | undefined;
  description?: string | undefined;
  backgroundColor?: string | undefined;
  textColor?: string | undefined;
  /** File path, data URI or http(s) URL. */
  logo?: string | undefined;
  logoAlt?: string | undefined;
  /** File path, data URI or http(s) URL. */
  backgroundImage?: string | undefined;
  /** Take unset display values from this template. */
  template?: string | undefined;
}

/** Trust and issuer metadata stored for the credential type with `wallet: true`. */
export interface IssueRegistrationOptions {
  category?: CredentialCategory | undefined;
  entitlements?: string[] | undefined;
  trustedListType?: string | undefined;
  statusDeterminationApproach?: string | undefined;
  schemeCommunityRule?: string | undefined;
  schemeTerritory?: string | undefined;
  trustedEntityName?: string | undefined;
  issuanceServiceType?: string | undefined;
  revocationServiceType?: string | undefined;
  issuanceServiceName?: string | undefined;
  revocationServiceName?: string | undefined;
}

export interface IssueCommonOptions extends CallOptions {
  /** Claims as an object (written to a temp file) or `{ path }` to a JSON file. Overrides top-level template claims. */
  claims?: JsonObject | { path: string } | undefined;
  /** Private signing key, PEM or JWK. Ephemeral P-256 if omitted. */
  key?: FileInput | JsonObject | undefined;
  /** Certificate chain PEM, leaf first, embedded as x5c / x5chain. Requires `key`. */
  cert?: FileInput | undefined;
  /** Expiration as a Go duration, default `720h`. */
  exp?: string | undefined;
  /** Not-before: RFC 3339 time or a duration such as `-1h`. */
  nbf?: string | undefined;
  /** Use the full EUDI PID Rulebook claim set. */
  pid?: boolean | undefined;
  /** Claim names to leave out. */
  omit?: string[] | undefined;
  /** Template name, or `{ path }` to a template file. */
  template?: string | { path: string } | undefined;
  /** Save the issued claims and settings as a template with this name. */
  saveTemplate?: string | undefined;
  statusListUri?: string | undefined;
  statusListIdx?: number | undefined;
  /** Import into the wallet under the instance's EUDI_DEV_HOME. */
  wallet?: boolean | undefined;
  walletDir?: string | undefined;
  templatesDir?: string | undefined;
  /** With `wallet`: `file`, `memory`, `auto` or a `postgres://` URL. */
  storage?: string | undefined;
  /** With `wallet`: derive generated keys from this string. */
  seed?: string | undefined;
  display?: IssueDisplayOptions | undefined;
  registration?: IssueRegistrationOptions | undefined;
  /** With `saveTemplate`: add the template to the attestation catalogue with this entry. */
  catalog?: JsonObject | undefined;
}

export interface IssueSdJwtOptions extends IssueCommonOptions {
  iss?: string | undefined;
  vct?: string | undefined;
  /** Claims issued plainly instead of selectively disclosable (dotted paths for nested claims). */
  alwaysDisclosed?: string[] | undefined;
  /** With `wallet`: issue this many copies with separate holder keys (max 8). */
  batch?: number | undefined;
  /** With `wallet`: issue without a holder key. */
  unbound?: boolean | undefined;
}

export interface IssueJwtOptions extends IssueCommonOptions {
  iss?: string | undefined;
  vct?: string | undefined;
}

export interface IssueMdocOptions extends IssueCommonOptions {
  docType?: string | undefined;
  namespace?: string | undefined;
  batch?: number | undefined;
  unbound?: boolean | undefined;
}

export interface IssueResult {
  /** The credential: SD-JWT / JWT compact form, or base64url / hex mdoc. */
  credential: string;
  /** Wallet credential id, set when `wallet: true` stored it. */
  id?: string;
  /** Public JWK of the ephemeral signing key, when no `key` was given. */
  publicJwk?: JsonObject;
  stderr: string;
}

const EPHEMERAL_MARKER = 'Ephemeral signing key (public JWK):';

/** Extracts the ephemeral public JWK that `issue` prints to stderr. Exported for tests. */
export function parseEphemeralJwk(stderr: string): JsonObject | undefined {
  const lines = stderr.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === EPHEMERAL_MARKER);
  if (start < 0) return undefined;
  // Upstream prints the JWK with json.MarshalIndent, so it spans several
  // lines. Grow the candidate line by line until it parses.
  let candidate = '';
  for (const line of lines.slice(start + 1, start + 1 + 64)) {
    candidate += `${line}\n`;
    try {
      const jwk: unknown = JSON.parse(candidate);
      return typeof jwk === 'object' && jwk !== null && !Array.isArray(jwk) ? (jwk as JsonObject) : undefined;
    } catch {
      // incomplete, keep reading
    }
  }
  return undefined;
}

async function commonIssueArgs(args: ArgList, opts: IssueCommonOptions, scratch: Scratch): Promise<void> {
  if (opts.claims !== undefined) {
    const path = isPathInput(opts.claims)
      ? await scratch.file(opts.claims, 'claims.json')
      : await scratch.write('claims.json', JSON.stringify(opts.claims));
    args.value('claims', `@${path}`);
  }
  if (opts.key !== undefined) {
    const key = isJsonObject(opts.key) ? JSON.stringify(opts.key) : opts.key;
    args.value('key', await scratch.file(key, 'key'));
  }
  if (opts.cert !== undefined) args.value('cert', await scratch.file(opts.cert, 'cert.pem'));
  if (opts.template !== undefined) {
    args.value('template', typeof opts.template === 'string' ? opts.template : await scratch.file(opts.template, 'template.json'));
  }
  args
    .value('exp', opts.exp)
    .value('nbf', opts.nbf)
    .on('pid', opts.pid)
    .csv('omit', opts.omit)
    .value('save-template', opts.saveTemplate)
    .value('status-list-uri', opts.statusListUri)
    .value('status-list-idx', opts.statusListIdx)
    .on('wallet', opts.wallet)
    .value('wallet-dir', opts.walletDir)
    .value('templates-dir', opts.templatesDir)
    .value('storage', opts.storage)
    .value('seed', opts.seed);

  const d = opts.display;
  if (d) {
    args
      .value('display-name', d.name)
      .value('display-description', d.description)
      .value('background-color', d.backgroundColor)
      .value('text-color', d.textColor)
      .value('logo', d.logo)
      .value('logo-alt', d.logoAlt)
      .value('background-image', d.backgroundImage)
      .value('display-template', d.template);
  }
  const r = opts.registration;
  if (r) {
    args
      .value('category', r.category)
      .repeat('entitlement', r.entitlements)
      .value('trusted-list-type', r.trustedListType)
      .value('status-determination-approach', r.statusDeterminationApproach)
      .value('scheme-community-rule', r.schemeCommunityRule)
      .value('scheme-territory', r.schemeTerritory)
      .value('trusted-entity-name', r.trustedEntityName)
      .value('issuance-service-type', r.issuanceServiceType)
      .value('revocation-service-type', r.revocationServiceType)
      .value('issuance-service-name', r.issuanceServiceName)
      .value('revocation-service-name', r.revocationServiceName);
  }
  if (opts.catalog !== undefined) {
    args.value('catalog', await scratch.write('catalog.json', JSON.stringify(opts.catalog)));
  }
}

async function runIssue(runner: Runner, args: ArgList, opts: IssueCommonOptions, scratch: Scratch): Promise<IssueResult> {
  try {
    args.push(...(opts.extraArgs ?? []));
    const { document, stderr } = await runner.run<IssueDocument>(args.args, runOpts(opts));
    const result: IssueResult = { credential: document.credential, stderr };
    if (document.id !== undefined) result.id = document.id;
    const jwk = parseEphemeralJwk(stderr);
    if (jwk) result.publicJwk = jwk;
    return result;
  } finally {
    await scratch.cleanup();
  }
}

export async function issueSdJwt(runner: Runner, opts: IssueSdJwtOptions = {}): Promise<IssueResult> {
  const scratch = new Scratch();
  const args = new ArgList('issue', 'sdjwt');
  try {
    await commonIssueArgs(args, opts, scratch);
  } catch (err) {
    await scratch.cleanup();
    throw err;
  }
  args
    .value('iss', opts.iss)
    .value('vct', opts.vct)
    .csv('always-disclosed', opts.alwaysDisclosed)
    .value('batch', opts.batch)
    .on('unbound', opts.unbound);
  return runIssue(runner, args, opts, scratch);
}

export async function issueJwt(runner: Runner, opts: IssueJwtOptions = {}): Promise<IssueResult> {
  const scratch = new Scratch();
  const args = new ArgList('issue', 'jwt');
  try {
    await commonIssueArgs(args, opts, scratch);
  } catch (err) {
    await scratch.cleanup();
    throw err;
  }
  args.value('iss', opts.iss).value('vct', opts.vct);
  return runIssue(runner, args, opts, scratch);
}

export async function issueMdoc(runner: Runner, opts: IssueMdocOptions = {}): Promise<IssueResult> {
  const scratch = new Scratch();
  const args = new ArgList('issue', 'mdoc');
  try {
    await commonIssueArgs(args, opts, scratch);
  } catch (err) {
    await scratch.cleanup();
    throw err;
  }
  args.value('doc-type', opts.docType).value('namespace', opts.namespace).value('batch', opts.batch).on('unbound', opts.unbound);
  return runIssue(runner, args, opts, scratch);
}
