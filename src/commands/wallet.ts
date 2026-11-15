import { type Input, isUrlInput } from '../input.js';
import { ArgList, positionalInput, type Runner, type RunOptions } from '../runner.js';
import type {
  DecodedCredential,
  DeferredIssuance,
  Jwks,
  WalletCredential,
  WalletCredentialList,
  WalletInfo,
  WalletLogEntry,
} from '../types.js';
import type { CallOptions } from './credentials.js';

export function runOpts(opts: CallOptions, stdin?: string | Uint8Array): RunOptions {
  const r: RunOptions = {};
  if (opts.timeoutMs !== undefined) r.timeoutMs = opts.timeoutMs;
  if (opts.signal !== undefined) r.signal = opts.signal;
  if (stdin !== undefined) r.stdin = stdin;
  return r;
}

/** Where the wallet state lives. Every `wallet`, `templates` and `catalog` command takes these. */
export interface StoreOptions extends CallOptions {
  /** Default `<home>/wallet`. */
  walletDir?: string | undefined;
  /** `file`, `memory`, `auto` or a `postgres://` URL. Default `auto`, which uses files under the instance's home. */
  storage?: string | undefined;
  /** Default `<walletDir>/templates`. */
  templatesDir?: string | undefined;
}

/** Options of the `wallet` and `catalog` commands. */
export interface WalletCallOptions extends StoreOptions {
  /** Validation mode. Default `debug` upstream. */
  mode?: 'debug' | 'strict' | undefined;
  /** Derive the wallet's generated keys from this string. */
  seed?: string | undefined;
}

export function storeArgs(args: ArgList, opts: StoreOptions): ArgList {
  return args.value('wallet-dir', opts.walletDir).value('storage', opts.storage).value('templates-dir', opts.templatesDir);
}

export function walletArgs(args: ArgList, opts: WalletCallOptions): ArgList {
  return storeArgs(args, opts).value('mode', opts.mode).value('seed', opts.seed);
}

/** A credential to import: its content (string or bytes) or `{ path }` to a file. */
export type CredentialInput = Exclude<Input, { url: string }>;

export interface WalletTlsCertOptions extends WalletCallOptions {
  /** Wallet server port the certificate is made for. It covers the HTTPS endpoints on port+1. Default 8085 upstream. */
  port?: number | undefined;
  /** Base URL the HTTPS host is derived from. */
  baseUrl?: string | undefined;
  /** Name the host `host.docker.internal` instead of `localhost`. Only changes the certificate, it opens nothing. */
  docker?: boolean | undefined;
}

/** True when `wallet.show()` returned a deferred issuance rather than a stored credential. */
export function isDeferredIssuance(doc: WalletCredential | DeferredIssuance): doc is DeferredIssuance {
  return typeof (doc as { transaction_id?: unknown }).transaction_id === 'string' && !('raw' in doc);
}

/**
 * `eudi wallet ...` on the local wallet store under the instance's
 * EUDI_DEV_HOME. These commands work offline and open no port.
 */
export class WalletCommands {
  constructor(private readonly runner: Runner) {}

  /** `wallet import`: stores an SD-JWT VC, JWT VC or mdoc credential. */
  async import(credential: CredentialInput, opts: WalletCallOptions = {}): Promise<WalletCredential> {
    if (isUrlInput(credential)) throw new TypeError('wallet import does not fetch URLs: pass the credential or { path }');
    const { arg, stdin } = await positionalInput(credential);
    const args = walletArgs(new ArgList('wallet', 'import'), opts).push(...(opts.extraArgs ?? []), arg);
    return (await this.runner.run<WalletCredential>(args.args, runOpts(opts, stdin))).document;
  }

  /** `wallet list`: the stored credentials (a batch once), and the deferred ones. */
  async list(opts: WalletCallOptions = {}): Promise<WalletCredentialList> {
    return this.simple(['wallet', 'list'], opts);
  }

  /**
   * `wallet show <id>`: a stored credential with its claims and raw form. For
   * the id of a deferred issuance it returns that instead; tell them apart
   * with {@link isDeferredIssuance}.
   */
  async show(id: string, opts: WalletCallOptions = {}): Promise<WalletCredential | DeferredIssuance> {
    return this.simple(['wallet', 'show'], opts, id);
  }

  /** `wallet show --decoded <id>`: the credential decoded like `decode`, without its checks. */
  async showDecoded(id: string, opts: WalletCallOptions = {}): Promise<DecodedCredential> {
    return this.simple(['wallet', 'show', '--decoded'], opts, id);
  }

  /** `wallet remove <id>`. Throws for an unknown id. */
  async remove(id: string, opts: WalletCallOptions = {}): Promise<{ removed: number; id: string }> {
    return this.simple(['wallet', 'remove'], opts, id);
  }

  /** `wallet remove --all`. Protected credentials stay. */
  async removeAll(opts: WalletCallOptions = {}): Promise<{ removed: number; kept_protected: number }> {
    return this.simple(['wallet', 'remove', '--all'], opts);
  }

  /** `wallet info`: the wallet's configuration. */
  async info(opts: WalletCallOptions = {}): Promise<WalletInfo> {
    return this.simple(['wallet', 'info'], opts);
  }

  /** `wallet tls-cert`: the wallet's TLS certificate as PEM. */
  async tlsCert(opts: WalletTlsCertOptions = {}): Promise<string> {
    return (await this.simple<{ pem: string }>(['wallet', 'tls-cert'], opts, undefined, tlsArgs(opts))).pem;
  }

  /** `wallet tls-cert --jwks`: its public key with the x5c chain. */
  async tlsJwks(opts: WalletTlsCertOptions = {}): Promise<Jwks> {
    return this.simple(['wallet', 'tls-cert', '--jwks'], opts, undefined, tlsArgs(opts));
  }

  /** `wallet logs`: the activity log, oldest first. */
  async logs(opts: WalletCallOptions = {}): Promise<WalletLogEntry[]> {
    return this.simple(['wallet', 'logs'], opts);
  }

  /** `wallet logs clean`. */
  async clearLogs(opts: WalletCallOptions = {}): Promise<{ cleared: boolean }> {
    return this.simple(['wallet', 'logs', 'clean'], opts);
  }

  private async simple<T>(command: string[], opts: WalletCallOptions, positional?: string, extra: string[] = []): Promise<T> {
    const args = walletArgs(new ArgList(...command), opts).push(...extra, ...(opts.extraArgs ?? []));
    if (positional !== undefined) args.push(positional);
    return (await this.runner.run<T>(args.args, runOpts(opts))).document;
  }
}

function tlsArgs(opts: WalletTlsCertOptions): string[] {
  return new ArgList().value('port', opts.port).value('base-url', opts.baseUrl).on('docker', opts.docker).args;
}
