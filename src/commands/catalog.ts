import type { FileInput } from '../input.js';
import { ArgList, type Runner, Scratch } from '../runner.js';
import type { CatalogAttestation } from '../types.js';
import { runOpts, type WalletCallOptions, walletArgs } from './wallet.js';

export interface CatalogAddOptions extends WalletCallOptions {
  /** Name of the attestation type. */
  name: string;
  /** Format and type, such as `dc+sd-jwt:urn:example:diploma:1` or `mso_mdoc:org.example.diploma.1`. */
  types: string[];
  /** Format and claim, such as `dc+sd-jwt:address.locality` or `mso_mdoc:degree`. */
  claims?: string[] | undefined;
  /** Credential category. Default `eaa` upstream. */
  category?: 'pid' | 'qeaa' | 'pub-eaa' | 'eaa' | undefined;
  /** Level of security. Default `high`, and `basic` for `eaa`. */
  los?: 'basic' | 'enhanced-basic' | 'moderate' | 'high' | undefined;
  /** How the attestation is bound to its holder. Default `key`. */
  binding?: 'key' | 'claim' | 'biometric' | 'none' | undefined;
  /** URL of the rulebook. Default a placeholder page on the wallet. */
  rulebook?: string | undefined;
  /** URL of the trusted list of its issuers (ETSI TS 119 602). Default the category's list on the wallet. Not with `issuerCa`. */
  trustedList?: string | undefined;
  /** Credential Issuer Identifier of an issuer of this type. */
  credentialIssuer?: string | undefined;
  /** CA of your issuer in PEM. The wallet adds it to the trusted list of the category. Not with `trustedList`. */
  issuerCa?: FileInput | undefined;
}

/** `eudi catalog ...`: the wallet's catalogue of attestation types (EC TS11). */
export class CatalogCommands {
  constructor(private readonly runner: Runner) {}

  /** `catalog list`: every entry, including those of the predefined templates. */
  async list(opts: WalletCallOptions = {}): Promise<CatalogAttestation[]> {
    const args = walletArgs(new ArgList('catalog', 'list'), opts).push(...(opts.extraArgs ?? []));
    return (await this.runner.run<CatalogAttestation[]>(args.args, runOpts(opts))).document;
  }

  /** `catalog add`. The new entry's `schema.id` is what {@link remove} takes. */
  async add(opts: CatalogAddOptions): Promise<CatalogAttestation> {
    const scratch = new Scratch();
    try {
      const args = walletArgs(new ArgList('catalog', 'add'), opts)
        .value('name', opts.name)
        .repeat('type', opts.types)
        .repeat('claim', opts.claims)
        .value('category', opts.category)
        .value('los', opts.los)
        .value('binding', opts.binding)
        .value('rulebook', opts.rulebook)
        .value('trusted-list', opts.trustedList)
        .value('credential-issuer', opts.credentialIssuer);
      if (opts.issuerCa !== undefined) args.value('issuer-ca', await scratch.file(opts.issuerCa, 'issuer-ca.pem'));
      args.push(...(opts.extraArgs ?? []));
      return (await this.runner.run<CatalogAttestation>(args.args, runOpts(opts))).document;
    } finally {
      await scratch.cleanup();
    }
  }

  /** `catalog rm <id>`: removes an entry you added. Entries of predefined templates can't be removed. */
  async remove(id: string, opts: WalletCallOptions = {}): Promise<{ removed: string }> {
    const args = walletArgs(new ArgList('catalog', 'rm'), opts).push(...(opts.extraArgs ?? []), id);
    return (await this.runner.run<{ removed: string }>(args.args, runOpts(opts))).document;
  }
}
