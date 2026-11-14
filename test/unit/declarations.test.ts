// The published index.d.ts must load the Node types itself: since TypeScript 6
// a project's "types" defaults to [], so without the directive NodeJS.* in our
// declarations becomes an error, or silently `any` under skipLibCheck.
// TypeScript only keeps a hand-written directive with preserve="true", so this
// compiles the package the way `pnpm run build` does and checks the output.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

it('index.d.ts references the Node types', { timeout: 60_000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'eudi-dts-'));
  try {
    await promisify(execFile)(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.build.json', '--outDir', out], { cwd: ROOT });
    const dts = await readFile(join(out, 'index.d.ts'), 'utf8');
    assert.match(dts.split('\n')[0] ?? '', /^\/\/\/ <reference types="node"/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
