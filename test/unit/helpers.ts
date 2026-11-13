import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_BIN = fileURLToPath(new URL('../fixtures/fake-eudi.mjs', import.meta.url));
chmodSync(FAKE_BIN, 0o755);

export interface LoggedCall {
  argv: string[];
  stdin: string;
  files: Record<string, string>;
  env: Record<string, string | undefined>;
}

/** A temp log file the fake binary appends each call to. */
export function callLog(): { path: string; calls(): LoggedCall[]; last(): LoggedCall; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-eudi-log-'));
  const path = join(dir, 'calls.jsonl');
  const calls = (): LoggedCall[] => {
    try {
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LoggedCall);
    } catch {
      return [];
    }
  };
  return {
    path,
    calls,
    last() {
      const all = calls();
      const c = all.at(-1);
      if (!c) throw new Error('no calls logged');
      return c;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
