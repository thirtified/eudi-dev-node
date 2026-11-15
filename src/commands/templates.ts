import { isPathInput } from '../input.js';
import { ArgList, positionalInput, type Runner, Scratch } from '../runner.js';
import type { CredentialTemplate, JsonObject, SavedTemplate, TransactionTemplate, TransactionTypes } from '../types.js';
import { runOpts, type StoreOptions, storeArgs } from './wallet.js';

/**
 * What `import()` reads: template objects, JSON or YAML content as a string,
 * or `{ path }` to a JSON or YAML file. A file without a `name` is named
 * after the file.
 */
export type TemplateImportInput<T> = T | T[] | string | { path: string };

export interface TemplateImportOptions extends StoreOptions {
  /** Name for a single imported template. */
  name?: string | undefined;
}

export interface TemplateSaveOptions extends StoreOptions {
  /** Claims of the template. Required unless `from` gives them. */
  claims?: JsonObject | { path: string } | undefined;
  /** Start from this template: a template name, a template object, or `{ path }` to a JSON or YAML file. */
  from?: string | CredentialTemplate | { path: string } | undefined;
  description?: string | undefined;
  /** `sdjwt`, `jwt` or `mdoc`. Empty: any. */
  format?: 'sdjwt' | 'jwt' | 'mdoc' | undefined;
  /** SD-JWT and JWT. */
  vct?: string | undefined;
  /** mdoc. */
  docType?: string | undefined;
  /** mdoc. */
  namespace?: string | undefined;
  /** Default expiry, a Go duration such as `720h`. */
  exp?: string | undefined;
  /** Claims issued plainly instead of selectively disclosable (dotted paths for nested claims). */
  alwaysDisclosed?: string[] | undefined;
}

async function importArgs<T>(
  command: string[],
  input: TemplateImportInput<T>,
  opts: TemplateImportOptions,
): Promise<{ args: string[]; stdin?: string }> {
  const args = storeArgs(new ArgList(...command), opts)
    .value('name', opts.name)
    .push(...(opts.extraArgs ?? []));
  if (isPathInput(input)) {
    args.push((await positionalInput(input)).arg);
    return { args: args.args };
  }
  args.push('-');
  return { args: args.args, stdin: typeof input === 'string' ? input : JSON.stringify(input) };
}

function asList<T>(doc: T | T[]): T[] {
  return Array.isArray(doc) ? doc : [doc];
}

/** `eudi templates transactions ...`: example transaction data entries for presentation requests. */
export class TransactionTemplateCommands {
  constructor(private readonly runner: Runner) {}

  /** `templates transactions list`: the predefined and saved transaction templates. */
  async list(opts: StoreOptions = {}): Promise<TransactionTemplate[]> {
    return this.simple(['templates', 'transactions', 'list'], opts);
  }

  /** `templates transactions show <name>`. */
  async show(name: string, opts: StoreOptions = {}): Promise<TransactionTemplate> {
    return this.simple(['templates', 'transactions', 'show'], opts, name);
  }

  /** `templates transactions import`. Each template needs a name, from the input or `name`. */
  async import(input: TemplateImportInput<TransactionTemplate>, opts: TemplateImportOptions = {}): Promise<{ name: string }[]> {
    const { args, stdin } = await importArgs(['templates', 'transactions', 'import'], input, opts);
    return asList((await this.runner.run<{ name: string } | { name: string }[]>(args, runOpts(opts, stdin))).document);
  }

  /** `templates transactions delete <name>`. Predefined templates can't be deleted. */
  async delete(name: string, opts: StoreOptions = {}): Promise<{ deleted: string }> {
    return this.simple(['templates', 'transactions', 'delete'], opts, name);
  }

  /** `templates transactions types`: the transaction data types the wallet knows, with their fields. */
  async types(opts: StoreOptions = {}): Promise<TransactionTypes> {
    return this.simple(['templates', 'transactions', 'types'], opts);
  }

  private async simple<T>(command: string[], opts: StoreOptions, positional?: string): Promise<T> {
    const args = storeArgs(new ArgList(...command), opts).push(...(opts.extraArgs ?? []));
    if (positional !== undefined) args.push(positional);
    return (await this.runner.run<T>(args.args, runOpts(opts))).document;
  }
}

/** `eudi templates ...`: credential templates for `issue.*({ template })` and the wallet. */
export class TemplateCommands {
  readonly transactions: TransactionTemplateCommands;

  constructor(private readonly runner: Runner) {
    this.transactions = new TransactionTemplateCommands(runner);
  }

  /** `templates list`: the predefined and saved credential templates. */
  async list(opts: StoreOptions = {}): Promise<CredentialTemplate[]> {
    return this.simple(['templates', 'list'], opts);
  }

  /** `templates show <name>`. */
  async show(name: string, opts: StoreOptions = {}): Promise<CredentialTemplate> {
    return this.simple(['templates', 'show'], opts, name);
  }

  /**
   * `templates save <name>`: creates or replaces a saved template. Upstream
   * replaces the whole template, so pass the claims (or `from`) every time.
   */
  async save(name: string, opts: TemplateSaveOptions = {}): Promise<SavedTemplate> {
    const scratch = new Scratch();
    try {
      const args = storeArgs(new ArgList('templates', 'save'), opts);
      if (opts.claims !== undefined) {
        const path = isPathInput(opts.claims)
          ? await scratch.file(opts.claims, 'claims.json')
          : await scratch.write('claims.json', JSON.stringify(opts.claims));
        args.value('claims', `@${path}`);
      }
      if (opts.from !== undefined) {
        args.value(
          'from',
          typeof opts.from === 'string'
            ? opts.from
            : isPathInput(opts.from)
              ? await scratch.file(opts.from, 'template.json')
              : await scratch.write('template.json', JSON.stringify(opts.from)),
        );
      }
      args
        .value('description', opts.description)
        .value('format', opts.format)
        .value('vct', opts.vct)
        .value('doc-type', opts.docType)
        .value('namespace', opts.namespace)
        .value('exp', opts.exp)
        .csv('always-disclosed', opts.alwaysDisclosed)
        .push(...(opts.extraArgs ?? []), name);
      return (await this.runner.run<SavedTemplate>(args.args, runOpts(opts))).document;
    } finally {
      await scratch.cleanup();
    }
  }

  /**
   * `templates import`: saves one or more templates. With several, each needs
   * a `name`. Returns one entry per saved template.
   */
  async import(input: TemplateImportInput<CredentialTemplate>, opts: TemplateImportOptions = {}): Promise<SavedTemplate[]> {
    const { args, stdin } = await importArgs(['templates', 'import'], input, opts);
    return asList((await this.runner.run<SavedTemplate | SavedTemplate[]>(args, runOpts(opts, stdin))).document);
  }

  /** `templates delete <name>`. Predefined templates can't be deleted. */
  async delete(name: string, opts: StoreOptions = {}): Promise<{ deleted: string }> {
    return this.simple(['templates', 'delete'], opts, name);
  }

  private async simple<T>(command: string[], opts: StoreOptions, positional?: string): Promise<T> {
    const args = storeArgs(new ArgList(...command), opts).push(...(opts.extraArgs ?? []));
    if (positional !== undefined) args.push(positional);
    return (await this.runner.run<T>(args.args, runOpts(opts))).document;
  }
}
