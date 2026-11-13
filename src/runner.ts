import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EudiDevError, lastLine } from './errors.js';
import { type FileInput, type Input, isPathInput, isUrlInput } from './input.js';

export interface RunOptions {
  /** Written to the process's stdin. Without it stdin is closed (/dev/null). */
  stdin?: string | Uint8Array | undefined;
  /** Kill the process after this many milliseconds. Default: the runner's timeout. */
  timeoutMs?: number | undefined;
  /** Aborts the process. */
  signal?: AbortSignal | undefined;
  /** Add `--json` and parse stdout as one JSON document. Default `true`. */
  json?: boolean | undefined;
}

export interface RunResult<T = unknown> {
  /** The parsed stdout document (`undefined` with `json: false` or empty stdout). */
  document: T;
  stdout: string;
  /** Progress, hints and warnings. With `--json` nothing else goes to stdout. */
  stderr: string;
}

export interface RunnerConfig {
  bin: string;
  /** Becomes EUDI_DEV_HOME. */
  home: string;
  /** Extra environment for every call. `undefined` removes a variable. */
  env?: Record<string, string | undefined> | undefined;
  /**
   * Pass the caller's EUDI_DEV_* variables through to the binary. Default
   * `false`: they are removed so that a developer's shell setup
   * (EUDI_DEV_STORAGE, EUDI_DEV_SEED, ...) can't change test results.
   */
  inheritEudiEnv?: boolean | undefined;
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  /** Upper bound for captured stdout plus stderr. Default 64 MiB. */
  maxBufferBytes?: number | undefined;
}

const STRIPPED_LEGACY_VARS = ['OID4VC_DEV_HOME', 'EUDI_REMOTE_TIMEOUT'];

/** Builds the environment for a child process. Exported for tests. */
export function buildEnv(
  config: Pick<RunnerConfig, 'home' | 'env' | 'inheritEudiEnv'>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (!config.inheritEudiEnv && (key.startsWith('EUDI_DEV_') || STRIPPED_LEGACY_VARS.includes(key))) continue;
    env[key] = value;
  }
  env.EUDI_DEV_HOME = config.home;
  env.NO_COLOR = '1';
  for (const [key, value] of Object.entries(config.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Collects flags as `--name=value`, so a value starting with `-` is never read as a flag. */
export class ArgList {
  readonly args: string[];

  constructor(...command: string[]) {
    this.args = [...command];
  }

  /** `true` → `--name`, `false` → `--name=false`, `undefined` → nothing. */
  bool(name: string, value: boolean | undefined): this {
    if (value === true) this.args.push(`--${name}`);
    else if (value === false) this.args.push(`--${name}=false`);
    return this;
  }

  /** Only adds `--name` when `value` is true. For flags that default to false. */
  on(name: string, value: boolean | undefined): this {
    if (value) this.args.push(`--${name}`);
    return this;
  }

  value(name: string, value: string | number | undefined | null): this {
    if (value !== undefined && value !== null) this.args.push(`--${name}=${value}`);
    return this;
  }

  /** A repeatable flag: one `--name=value` per entry. */
  repeat(name: string, values: readonly (string | number)[] | undefined): this {
    for (const v of values ?? []) this.args.push(`--${name}=${v}`);
    return this;
  }

  /** A comma-separated single flag. */
  csv(name: string, values: readonly string[] | undefined): this {
    if (values && values.length > 0) this.args.push(`--${name}=${values.join(',')}`);
    return this;
  }

  push(...args: string[]): this {
    this.args.push(...args);
    return this;
  }
}

/** Temp files for one call. */
export class Scratch {
  private dir: string | undefined;
  private n = 0;

  /** Writes `content` to a private temp file and returns its path. */
  async write(name: string, content: string | Uint8Array): Promise<string> {
    this.dir ??= await mkdtemp(join(tmpdir(), 'eudi-dev-input-'));
    const path = join(this.dir, `${++this.n}-${name}`);
    await writeFile(path, content, { mode: 0o600 });
    return path;
  }

  /**
   * Turns a file-valued option into a flag value. Content is written to a temp
   * file. `{ url }` is only allowed when `allowUrl` is set.
   */
  async file(input: FileInput, name: string, opts: { allowUrl?: boolean } = {}): Promise<string> {
    if (isPathInput(input)) {
      await assertFile(input.path);
      return input.path;
    }
    if (isUrlInput(input)) {
      if (!opts.allowUrl) throw new TypeError(`${name} does not accept a URL`);
      assertHttpUrl(input.url);
      return input.url;
    }
    return this.write(name, input);
  }

  async cleanup(): Promise<void> {
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
    this.dir = undefined;
  }
}

async function assertFile(path: string): Promise<void> {
  let ok = false;
  try {
    ok = (await stat(path)).isFile();
  } catch {
    ok = false;
  }
  // eudi-dev treats a path that doesn't exist as raw input, which hides typos.
  if (!ok) throw new TypeError(`${path} is not a file`);
}

function assertHttpUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) throw new TypeError(`${url} is not an http(s) URL`);
}

/** Maps an {@link Input} to the positional argument and the stdin content. */
export async function positionalInput(input: Input): Promise<{ arg: string; stdin?: string | Uint8Array }> {
  if (isPathInput(input)) {
    await assertFile(input.path);
    return { arg: input.path };
  }
  if (isUrlInput(input)) {
    assertHttpUrl(input.url);
    return { arg: input.url };
  }
  if (typeof input !== 'string' && !(input instanceof Uint8Array)) {
    throw new TypeError('input must be a string, bytes, { path } or { url }');
  }
  return { arg: '-', stdin: input };
}

/** Spawns the eudi-dev binary with an isolated environment. */
export class Runner {
  readonly bin: string;
  readonly home: string;
  private readonly config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
    this.bin = config.bin;
    this.home = config.home;
  }

  /**
   * Runs `eudi <args> --json --no-color` and parses stdout as exactly one
   * JSON document. Rejects with {@link EudiDevError} on a non-zero exit, a
   * timeout, or stdout that is not one JSON document.
   */
  async run<T = unknown>(args: readonly string[], opts: RunOptions = {}): Promise<RunResult<T>> {
    const json = opts.json ?? true;
    const fullArgs = json ? [...args, '--json', '--no-color'] : [...args, '--no-color'];
    const { exitCode, signal, stdout, stderr, timedOut, spawnError } = await this.spawn(fullArgs, opts);

    const base = { args: fullArgs, exitCode, signal, stdout, stderr };
    if (spawnError) {
      const message =
        spawnError.name === 'AbortError' ? `eudi ${args[0] ?? ''} was aborted` : `Could not run ${this.bin}: ${spawnError.message}`;
      throw new EudiDevError(message, { ...base, cause: spawnError });
    }

    let document: unknown;
    let parseError: unknown;
    if (json && stdout.trim() !== '') {
      try {
        document = JSON.parse(stdout);
      } catch (err) {
        parseError = err;
      }
    }

    if (timedOut) {
      throw new EudiDevError(`eudi ${args[0] ?? ''} timed out`, { ...base, document, timedOut: true });
    }
    if (exitCode !== 0) {
      const reason = lastLine(stderr) || (signal ? `killed by ${signal}` : `exit code ${exitCode}`);
      throw new EudiDevError(reason, { ...base, document });
    }
    if (parseError) {
      throw new EudiDevError(`eudi ${args.join(' ')} printed stdout that is not one JSON document`, {
        ...base,
        cause: parseError,
      });
    }
    return { document: document as T, stdout, stderr };
  }

  private spawn(
    args: string[],
    opts: RunOptions,
  ): Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError?: Error;
  }> {
    const maxBytes = this.config.maxBufferBytes ?? 64 * 1024 * 1024;
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs ?? 60_000;

    return new Promise((resolve) => {
      const child = spawn(this.bin, args, {
        cwd: this.config.cwd,
        env: buildEnv(this.config),
        stdio: [opts.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });

      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let bytes = 0;
      let timedOut = false;
      let overflow = false;
      let spawnError: Error | undefined;

      const collect = (sink: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          if (!overflow) {
            overflow = true;
            child.kill('SIGKILL');
          }
          return;
        }
        sink.push(chunk);
      };
      child.stdout?.on('data', collect(out));
      child.stderr?.on('data', collect(err));

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGKILL');
            }, timeoutMs)
          : undefined;

      child.on('error', (e) => {
        spawnError = e;
      });
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        let stderr = Buffer.concat(err).toString('utf8');
        if (overflow) stderr += `\n[eudi-dev] output exceeded ${maxBytes} bytes, process killed`;
        const result = {
          exitCode: code,
          signal,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr,
          timedOut,
        };
        resolve(spawnError ? { ...result, spawnError } : result);
      });

      if (opts.stdin !== undefined && child.stdin) {
        // The process may exit before it reads stdin (for example on a flag error).
        child.stdin.on('error', () => {});
        child.stdin.end(opts.stdin);
      }
    });
  }
}
