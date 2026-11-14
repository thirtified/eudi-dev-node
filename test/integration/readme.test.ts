// The TypeScript examples under "## Usage" in README.md, run as one script
// against the real binary and typechecked as strict user code.
//
// The blocks are joined in order (later ones continue earlier ones), with
// their imports hoisted to the top. `@thirtified/eudi-dev` is mapped to src/
// through tsconfig "paths", which both tsc and tsx honour, so no build is
// needed. The registrar example reads verifier.csr, which openssl creates.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');
const TSX = import.meta.resolve('tsx');
const TIMEOUT = 180_000;

/** The ```ts blocks of the "## Usage" section, up to the next "## " heading. */
export function usageBlocks(readme: string): string[] {
  const start = readme.indexOf('\n## Usage\n');
  assert.ok(start >= 0, 'README has a "## Usage" section');
  const next = readme.indexOf('\n## ', start + 1);
  const section = readme.slice(start, next < 0 ? undefined : next);
  return [...section.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((m) => m[1] ?? '');
}

/** Joins the blocks into one module, with single-line imports hoisted and deduplicated. */
export function toModule(blocks: string[]): string {
  const imports = new Set<string>();
  const body: string[] = [];
  for (const line of blocks.join('\n').split('\n')) {
    if (/^import\s/.test(line)) {
      assert.match(line, /;\s*$/, `README imports must fit on one line: ${line}`);
      imports.add(line);
    } else {
      body.push(line);
    }
  }
  return `${[...imports].join('\n')}\n\n${body.join('\n')}\nexport {};\n`;
}

async function hasOpenssl(): Promise<boolean> {
  try {
    await run('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
}

describe('README usage examples', { timeout: TIMEOUT, skip: !(await hasOpenssl()) && 'openssl is not installed' }, () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eudi-readme-'));
    const blocks = usageBlocks(await readFile(join(ROOT, 'README.md'), 'utf8'));
    assert.ok(blocks.length >= 2, `expected the Usage examples, found ${blocks.length} ts blocks`);
    await writeFile(join(dir, 'readme.mts'), toModule(blocks));
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2022', 'ESNext.Disposable'],
          types: ['node'],
          typeRoots: [join(ROOT, 'node_modules', '@types')],
          // Strict user code: what users with these flags get to see.
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          noEmit: true,
          paths: { '@thirtified/eudi-dev': [join(ROOT, 'src', 'index.ts')] },
        },
        files: ['readme.mts'],
      }),
    );
    // The CSR the registrar example reads, as the README tells users to create it.
    await run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'verifier.key'], { cwd: dir });
    await run('openssl', ['req', '-new', '-key', 'verifier.key', '-subj', '/CN=shop.example', '-out', 'verifier.csr'], { cwd: dir });
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('typechecks as strict user code', async () => {
    try {
      await run(TSC, ['-p', 'tsconfig.json'], { cwd: dir });
    } catch (err) {
      const { stdout = '', stderr = '' } = err as { stdout?: string; stderr?: string };
      assert.fail(`README examples don't typecheck:\n${stdout}${stderr}`);
    }
  });

  it('runs against the real binary', async () => {
    try {
      await run(process.execPath, ['--import', TSX, 'readme.mts'], { cwd: dir, timeout: TIMEOUT });
    } catch (err) {
      const { stdout = '', stderr = '' } = err as { stdout?: string; stderr?: string };
      assert.fail(`README examples failed:\n${stdout}${stderr}`);
    }
  });
});
