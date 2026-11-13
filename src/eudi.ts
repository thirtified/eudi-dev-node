import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ResolveBinaryOptions, resolveBinary } from './binary.js';
import {
  type CallOptions,
  type DecodeOptions,
  dcql,
  decode,
  type IssueJwtOptions,
  type IssueMdocOptions,
  type IssueResult,
  type IssueSdJwtOptions,
  issueJwt,
  issueMdoc,
  issueSdJwt,
  type ValidateOptions,
  type ValidateResult,
  validate,
  version,
} from './commands/credentials.js';
import { RegistrarCommands } from './commands/registrar.js';
import { TrustCommands } from './commands/trust.js';
import { EudiDevBinaryError } from './errors.js';
import type { Input } from './input.js';
import { Runner, type RunOptions, type RunResult } from './runner.js';
import type { DcqlQuery, DecodeResult, VersionInfo } from './types.js';
import { parseVersion, SUPPORTED_MAJOR } from './version.js';

export interface EudiDevOptions extends ResolveBinaryOptions {
  /**
   * EUDI_DEV_HOME for every call: wallet, CA, templates, registrar state.
   * Default: a new temp directory per instance, removed by {@link EudiDev.dispose}.
   */
  home?: string;
  /** Extra environment variables for every call. `undefined` removes one. */
  env?: Record<string, string | undefined>;
  /** Pass the caller's EUDI_DEV_* variables through. Default `false`. */
  inheritEudiEnv?: boolean;
  /** Default timeout per call in ms. Default 60 000. 0 turns it off. */
  timeoutMs?: number;
  /** Working directory of the child process. */
  cwd?: string;
  /** Accept a binary whose major version isn't {@link SUPPORTED_MAJOR}. Default `false`. */
  allowAnyVersion?: boolean;
}

/**
 * A handle on the eudi-dev CLI with its own state directory.
 *
 * ```ts
 * await using eudi = await EudiDev.create();
 * const { credential } = await eudi.issue.sdjwt({ pid: true });
 * const { valid } = await eudi.validate(credential);
 * ```
 */
export class EudiDev implements AsyncDisposable {
  /** Path of the binary in use. */
  readonly bin: string;
  /** EUDI_DEV_HOME of this instance. */
  readonly home: string;
  /** Version reported by the binary. */
  readonly version: VersionInfo;

  readonly issue: {
    sdjwt(opts?: IssueSdJwtOptions): Promise<IssueResult>;
    jwt(opts?: IssueJwtOptions): Promise<IssueResult>;
    mdoc(opts?: IssueMdocOptions): Promise<IssueResult>;
  };
  readonly trust: TrustCommands;
  readonly registrar: RegistrarCommands;

  private readonly runner: Runner;
  private readonly ownsHome: boolean;
  private disposed = false;

  private constructor(runner: Runner, versionInfo: VersionInfo, ownsHome: boolean) {
    this.runner = runner;
    this.bin = runner.bin;
    this.home = runner.home;
    this.version = versionInfo;
    this.ownsHome = ownsHome;
    this.issue = {
      sdjwt: (opts) => issueSdJwt(this.runner, opts),
      jwt: (opts) => issueJwt(this.runner, opts),
      mdoc: (opts) => issueMdoc(this.runner, opts),
    };
    this.trust = new TrustCommands(runner);
    this.registrar = new RegistrarCommands(runner);
  }

  /** Resolves the binary, checks its version and sets up the home directory. */
  static async create(options: EudiDevOptions = {}): Promise<EudiDev> {
    const bin = await resolveBinary(options);
    const ownsHome = options.home === undefined;
    const home = options.home ?? (await mkdtemp(join(tmpdir(), 'eudi-dev-home-')));
    const config: ConstructorParameters<typeof Runner>[0] = { bin, home };
    if (options.env) config.env = options.env;
    if (options.inheritEudiEnv !== undefined) config.inheritEudiEnv = options.inheritEudiEnv;
    if (options.timeoutMs !== undefined) config.timeoutMs = options.timeoutMs;
    if (options.cwd !== undefined) config.cwd = options.cwd;
    const runner = new Runner(config);

    try {
      const info = await version(runner);
      const parsed = parseVersion(info.version);
      // A "dev" build has no version to check.
      if (parsed && parsed.major !== SUPPORTED_MAJOR && !options.allowAnyVersion) {
        throw new EudiDevBinaryError(
          `${bin} is eudi-dev ${info.version}, but this package supports v${SUPPORTED_MAJOR}.x. Pass allowAnyVersion to use it anyway.`,
        );
      }
      return new EudiDev(runner, info, ownsHome);
    } catch (err) {
      if (ownsHome) await rm(home, { recursive: true, force: true });
      throw err;
    }
  }

  /** Runs any eudi-dev command with `--json` and returns its parsed document. */
  run<T = unknown>(args: readonly string[], opts?: RunOptions): Promise<RunResult<T>> {
    this.assertOpen();
    return this.runner.run<T>(args, opts);
  }

  /** `eudi decode`. */
  decode(input: Input, opts?: DecodeOptions): Promise<DecodeResult> {
    this.assertOpen();
    return decode(this.runner, input, opts);
  }

  /** `eudi validate`. A failing check gives `valid: false` instead of throwing. */
  validate(input: Input, opts?: ValidateOptions): Promise<ValidateResult> {
    this.assertOpen();
    return validate(this.runner, input, opts);
  }

  /** `eudi dcql`. */
  dcql(input: Input, opts?: CallOptions): Promise<DcqlQuery> {
    this.assertOpen();
    return dcql(this.runner, input, opts);
  }

  /** Removes the home directory if this instance created it. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ownsHome) await rm(this.home, { recursive: true, force: true });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('EudiDev instance is disposed');
  }
}
