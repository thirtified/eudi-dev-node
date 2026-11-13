import type { FileInput } from '../input.js';
import { ArgList, type Runner, type RunOptions, Scratch } from '../runner.js';
import type {
  AccessCertificateResult,
  DcqlQuery,
  Enrolment,
  EnrolmentResult,
  RegistrationCertificateResult,
  RegistrationExtensionResult,
  RelyingParty,
} from '../types.js';
import type { CallOptions } from './credentials.js';

function runOpts(opts: CallOptions, stdin?: string): RunOptions {
  const r: RunOptions = {};
  if (opts.timeoutMs !== undefined) r.timeoutMs = opts.timeoutMs;
  if (opts.signal !== undefined) r.signal = opts.signal;
  if (stdin !== undefined) r.stdin = stdin;
  return r;
}

/** Registration fields shared by verifiers and issuers. */
export interface PartyOptions {
  /** Trade name. Required for a new registration. */
  name: string;
  /** An EUID or an organizationIdentifier. Default: an assigned EUID. */
  identifier?: string;
  /** Default `name`. */
  legalName?: string;
  /** Country code. Default the identifier's country. */
  country?: string;
  /** Web or email address. */
  supportUri?: string;
  /** Service identifier (the OU in access certificates). */
  serviceId?: string;
}

export interface IntendedUseOptions {
  /** Shown in the consent dialog. */
  purpose: string;
  /** DCQL query with the credentials and claims to register. */
  dcql: DcqlQuery | FileInput;
  /** Privacy policy URL. Default a placeholder page on the wallet. */
  privacyPolicy?: string;
}

export type AddVerifierOptions = PartyOptions & IntendedUseOptions & CallOptions;
export type ExtendVerifierOptions = IntendedUseOptions &
  CallOptions & {
    /** Identifier of the registered relying party to add the intended use to. */
    to: string;
  };

export interface AttestationOptions {
  /** `format:type`, e.g. `dc+sd-jwt:urn:eudi:pid:1` or `mso_mdoc:eu.europa.ec.eudi.pid.1`. */
  attestations: string[];
  /** Provider entitlement categories: pid, qeaa, pub-eaa, eaa. Default from the catalogue. */
  categories?: string[];
}

export type AddIssuerOptions = PartyOptions & AttestationOptions & CallOptions;
export type ExtendIssuerOptions = AttestationOptions & CallOptions & { to: string };

export interface AccessCertOptions extends CallOptions {
  /** Identifier of the registered relying party. */
  identifier: string;
  /** PEM certificate signing request. */
  csr: FileInput;
  serviceId?: string;
  /** Extra DNS names for the x509_san_dns client identifier. */
  dns?: string[];
  /** Go duration, at most one year. */
  validity?: string;
}

export interface RegistrationCertOptions extends CallOptions {
  identifier: string;
  serviceId?: string;
  /** Default the relying party's only intended use. */
  intendedUse?: string;
  /** Certify the attestation provider service instead of an intended use. */
  provider?: boolean;
  /** Issue a new certificate and revoke the current one (`--new`). */
  renew?: boolean;
  /** Validity of a new certificate as a Go duration. Requires `renew` when one exists. */
  validity?: string;
}

export interface RegistrationScopeOptions extends CallOptions {
  identifier: string;
  intendedUse?: string;
  serviceId?: string;
}

function isDcqlObject(v: unknown): v is DcqlQuery {
  return typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && Array.isArray((v as { credentials?: unknown }).credentials);
}

function partyArgs(args: ArgList, p: PartyOptions): ArgList {
  return args
    .value('name', p.name)
    .value('identifier', p.identifier)
    .value('legal-name', p.legalName)
    .value('country', p.country)
    .value('support-uri', p.supportUri)
    .value('service-id', p.serviceId);
}

async function intendedUseArgs(args: ArgList, u: IntendedUseOptions, scratch: Scratch): Promise<ArgList> {
  const dcql = isDcqlObject(u.dcql) ? JSON.stringify(u.dcql) : u.dcql;
  return args
    .value('purpose', u.purpose)
    .value('dcql', await scratch.file(dcql, 'dcql.json'))
    .value('privacy-policy', u.privacyPolicy);
}

function attestationArgs(args: ArgList, a: AttestationOptions): ArgList {
  return args.repeat('attestation', a.attestations).repeat('category', a.categories);
}

export class PartyCommands<AddOpts, ExtendOpts> {
  constructor(
    protected readonly runner: Runner,
    private readonly role: 'verifiers' | 'issuers',
    private readonly build: (args: ArgList, opts: AddOpts | ExtendOpts, scratch: Scratch) => Promise<ArgList>,
  ) {}

  /** `registrar <role> list`. */
  async list(opts: CallOptions = {}): Promise<RelyingParty[]> {
    const { document } = await this.runner.run<RelyingParty[]>(['registrar', this.role, 'list', ...(opts.extraArgs ?? [])], runOpts(opts));
    return document;
  }

  /** `registrar <role> add`: register a new relying party. */
  async add(opts: AddOpts & CallOptions): Promise<RelyingParty> {
    return this.runAdd<RelyingParty>(opts);
  }

  /** `registrar <role> add --to`: extend an existing registration. */
  async extend(opts: ExtendOpts & CallOptions & { to: string }): Promise<RegistrationExtensionResult> {
    return this.runAdd<RegistrationExtensionResult>(opts);
  }

  /** `registrar <role> rm <identifier>`: remove it and revoke its registration certificates. */
  async remove(identifier: string, opts: CallOptions = {}): Promise<{ removed: string }> {
    const { document } = await this.runner.run<{ removed: string }>(
      ['registrar', this.role, 'rm', ...(opts.extraArgs ?? []), identifier],
      runOpts(opts),
    );
    return document;
  }

  private async runAdd<T>(opts: (AddOpts | ExtendOpts) & CallOptions & { to?: string }): Promise<T> {
    const scratch = new Scratch();
    try {
      const args = await this.build(new ArgList('registrar', this.role, 'add'), opts, scratch);
      args.value('to', opts.to).push(...(opts.extraArgs ?? []));
      const { document } = await this.runner.run<T>(args.args, runOpts(opts));
      return document;
    } finally {
      await scratch.cleanup();
    }
  }
}

/**
 * `eudi registrar ...` against the wallet in this instance's EUDI_DEV_HOME.
 * Registrations persist there between calls.
 */
export class RegistrarCommands {
  readonly verifiers: PartyCommands<AddVerifierOptions, ExtendVerifierOptions>;
  readonly issuers: PartyCommands<AddIssuerOptions, ExtendIssuerOptions>;

  constructor(private readonly runner: Runner) {
    this.verifiers = new PartyCommands(runner, 'verifiers', async (args, opts, scratch) => {
      if (!('to' in opts && opts.to)) partyArgs(args, opts as PartyOptions);
      return intendedUseArgs(args, opts, scratch);
    });
    this.issuers = new PartyCommands(runner, 'issuers', async (args, opts) => {
      if (!('to' in opts && opts.to)) partyArgs(args, opts as PartyOptions);
      return attestationArgs(args, opts);
    });
  }

  /** `registrar enrol`: register a relying party and issue its certificates in one step. */
  async enrol(enrolment: Enrolment, opts: CallOptions & { update?: boolean } = {}): Promise<EnrolmentResult> {
    const args = new ArgList('registrar', 'enrol').on('update', opts.update).push(...(opts.extraArgs ?? []), '-');
    const { document } = await this.runner.run<EnrolmentResult>(args.args, runOpts(opts, JSON.stringify(enrolment)));
    return document;
  }

  /** `registrar access-cert`: issue an access certificate for a CSR. */
  async accessCert(opts: AccessCertOptions): Promise<AccessCertificateResult> {
    const scratch = new Scratch();
    try {
      const args = new ArgList('registrar', 'access-cert')
        .value('identifier', opts.identifier)
        .value('csr', await scratch.file(opts.csr, 'request.csr'))
        .value('service-id', opts.serviceId)
        .repeat('dns', opts.dns)
        .value('validity', opts.validity)
        .push(...(opts.extraArgs ?? []));
      const { document } = await this.runner.run<AccessCertificateResult>(args.args, runOpts(opts));
      return document;
    } finally {
      await scratch.cleanup();
    }
  }

  /** `registrar registration-cert`: the current registration certificate, issuing one if needed. */
  async registrationCert(opts: RegistrationCertOptions): Promise<RegistrationCertificateResult> {
    const args = new ArgList('registrar', 'registration-cert')
      .value('identifier', opts.identifier)
      .value('service-id', opts.serviceId)
      .value('intended-use', opts.intendedUse)
      .on('provider', opts.provider)
      .on('new', opts.renew)
      .value('validity', opts.validity)
      .push(...(opts.extraArgs ?? []));
    const { document } = await this.runner.run<RegistrationCertificateResult>(args.args, runOpts(opts));
    return document;
  }

  /** `registrar revoke`: revoke registration certificates. Returns how many changed. */
  async revoke(opts: RegistrationScopeOptions): Promise<{ changed: number }> {
    return this.setStatus('revoke', opts);
  }

  /** `registrar activate`: reactivate revoked registration certificates. */
  async activate(opts: RegistrationScopeOptions): Promise<{ changed: number }> {
    return this.setStatus('activate', opts);
  }

  private async setStatus(cmd: 'revoke' | 'activate', opts: RegistrationScopeOptions): Promise<{ changed: number }> {
    const args = new ArgList('registrar', cmd)
      .value('identifier', opts.identifier)
      .value('intended-use', opts.intendedUse)
      .value('service-id', opts.serviceId)
      .push(...(opts.extraArgs ?? []));
    const { document } = await this.runner.run<{ changed: number }>(args.args, runOpts(opts));
    return document;
  }
}
