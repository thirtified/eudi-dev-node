import type { FileInput } from '../input.js';
import { ArgList, type Runner, type RunOptions, Scratch } from '../runner.js';
import type { Jwks, TrustEntity, TrustListLink, TrustOverview } from '../types.js';
import type { CallOptions } from './credentials.js';

function runOpts(opts: CallOptions): RunOptions {
  const r: RunOptions = {};
  if (opts.timeoutMs !== undefined) r.timeoutMs = opts.timeoutMs;
  if (opts.signal !== undefined) r.signal = opts.signal;
  return r;
}

/** The wallet's own lists, or the `tl-` id of a custom list. */
export type TrustListId = 'pid' | 'qeaa' | 'pub-eaa' | 'eaa' | 'wallet-provider' | 'access-ca' | 'registrar' | 'lists' | (string & {});

export interface TrustShowOptions extends CallOptions {
  /** List id. Default: the PID provider list. */
  list?: TrustListId;
  /** Select the list covering this SD-JWT VCT. */
  vct?: string;
  /** Select the list covering this mdoc docType. */
  doctype?: string;
}

export interface TrustUrlOptions extends TrustShowOptions {
  /** Wallet server port the URL is built for. Default 8085 upstream. */
  port?: number;
  /** Use host.docker.internal instead of localhost. */
  docker?: boolean;
}

export interface TrustAddCaOptions extends CallOptions {
  /** One of `TrustOverview.entity_lists`, e.g. `pid`, `eaa`, `trusted-list-ca`. */
  list: string;
  /** PEM with the CA certificates. */
  ca: FileInput;
  /** Provider name on the list. Default the CA's common name. */
  name?: string;
}

/**
 * `eudi trust ...` against the wallet in this instance's EUDI_DEV_HOME. The
 * wallet (with its CA) is created on first use.
 */
export class TrustCommands {
  constructor(private readonly runner: Runner) {}

  /** `trust list`: the wallet's trusted lists and the CAs and lists you added. */
  async list(opts: CallOptions = {}): Promise<TrustOverview> {
    const { document } = await this.runner.run<TrustOverview>(['trust', 'list', ...(opts.extraArgs ?? [])], runOpts(opts));
    return document;
  }

  /** `trust show`: one of the wallet's trusted lists as a signed JWT. */
  async show(opts: TrustShowOptions = {}): Promise<string> {
    const args = new ArgList('trust', 'show')
      .value('vct', opts.vct)
      .value('doctype', opts.doctype)
      .push(...(opts.extraArgs ?? []));
    if (opts.list) args.push(opts.list);
    const { document } = await this.runner.run<{ trust_list: string }>(args.args, runOpts(opts));
    return document.trust_list;
  }

  /** `trust show --url`: where a wallet server on `port` would serve the list. */
  async url(opts: TrustUrlOptions = {}): Promise<string> {
    const args = new ArgList('trust', 'show', '--url')
      .value('port', opts.port)
      .on('docker', opts.docker)
      .value('vct', opts.vct)
      .value('doctype', opts.doctype)
      .push(...(opts.extraArgs ?? []));
    if (opts.list) args.push(opts.list);
    const { document } = await this.runner.run<{ url: string }>(args.args, runOpts(opts));
    return document.url;
  }

  /** `trust ca-cert`: the shared wallet CA as PEM. */
  async caCert(opts: CallOptions = {}): Promise<string> {
    const { document } = await this.runner.run<{ pem: string }>(['trust', 'ca-cert', ...(opts.extraArgs ?? [])], runOpts(opts));
    return document.pem;
  }

  /** `trust ca-cert --jwks`: the shared wallet CA as a JWKS with x5c. */
  async caJwks(opts: CallOptions = {}): Promise<Jwks> {
    const { document } = await this.runner.run<Jwks>(['trust', 'ca-cert', '--jwks', ...(opts.extraArgs ?? [])], runOpts(opts));
    return document;
  }

  /** `trust add-ca`: put a CA on one of the wallet's lists. */
  async addCa(opts: TrustAddCaOptions): Promise<TrustEntity> {
    const scratch = new Scratch();
    try {
      const args = new ArgList('trust', 'add-ca')
        .value('list', opts.list)
        .value('ca', await scratch.file(opts.ca, 'ca.pem'))
        .value('name', opts.name)
        .push(...(opts.extraArgs ?? []));
      const { document } = await this.runner.run<TrustEntity>(args.args, runOpts(opts));
      return document;
    } finally {
      await scratch.cleanup();
    }
  }

  /** `trust rm-ca <id>`. */
  async removeCa(id: string, opts: CallOptions = {}): Promise<{ removed: string }> {
    const { document } = await this.runner.run<{ removed: string }>(['trust', 'rm-ca', ...(opts.extraArgs ?? []), id], runOpts(opts));
    return document;
  }

  /** `trust add-list <url>`: add an external list to the list of trusted lists. */
  async addList(url: string, opts: CallOptions = {}): Promise<TrustListLink> {
    const { document } = await this.runner.run<TrustListLink>(['trust', 'add-list', ...(opts.extraArgs ?? []), url], runOpts(opts));
    return document;
  }

  /** `trust rm-list <url>`. */
  async removeList(url: string, opts: CallOptions = {}): Promise<{ removed: string }> {
    const { document } = await this.runner.run<{ removed: string }>(['trust', 'rm-list', ...(opts.extraArgs ?? []), url], runOpts(opts));
    return document;
  }
}
