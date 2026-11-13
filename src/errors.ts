/** Details of a failed eudi-dev invocation. */
export interface EudiDevErrorDetails {
  /** Arguments passed to the binary (without the binary path). */
  args: readonly string[];
  /** Exit code, or `null` when the process was killed by a signal. */
  exitCode: number | null;
  /** Signal that killed the process, if any. */
  signal: NodeJS.Signals | null;
  /** Everything the process wrote to stderr. */
  stderr: string;
  /** Everything the process wrote to stdout. */
  stdout: string;
  /**
   * The JSON document from stdout, if one was printed. `validate` prints its
   * report even when a check fails (upstream ADR 0020).
   */
  document?: unknown;
  /** Set when the process did not finish in time. */
  timedOut?: boolean;
  /** Underlying error (spawn failure, invalid JSON, ...). */
  cause?: unknown;
}

/**
 * Thrown when eudi-dev exits non-zero, cannot be started, times out, or
 * breaks the one-JSON-document contract.
 *
 * eudi-dev only uses exit codes 0 and 1, so the reason is in {@link stderr}.
 * {@link message} holds its last non-empty line, which is the error cobra
 * printed.
 */
export class EudiDevError extends Error {
  override readonly name = 'EudiDevError';
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly document: unknown;
  readonly timedOut: boolean;

  constructor(message: string, details: EudiDevErrorDetails) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.args = details.args;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.stderr = details.stderr;
    this.stdout = details.stdout;
    this.document = details.document;
    this.timedOut = details.timedOut ?? false;
  }
}

/** Thrown when the eudi-dev binary cannot be located, is not executable, or has an unsupported version. */
export class EudiDevBinaryError extends Error {
  override readonly name = 'EudiDevBinaryError';
}

/** Returns the last non-empty line of a stderr dump. */
export function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
}
