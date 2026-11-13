/**
 * Input to a command that reads a credential, request or certificate.
 *
 * - A string or bytes is the content itself. It goes to the binary on stdin
 *   (as the `-` argument), so there is no argv length limit.
 * - `{ path }` is a file the binary reads. It must exist: upstream treats a
 *   path that doesn't exist as raw input.
 * - `{ url }` is an http(s) URL the binary fetches.
 */
export type Input = string | Uint8Array | { path: string } | { url: string };

/**
 * A file-valued flag (`--key`, `--trusted-list`, `--csr`, `--dcql`, ...).
 *
 * A string or bytes is the content. The runner writes it to a private temp
 * file and passes that path. `{ path }` passes an existing file and `{ url }`
 * a URL for flags that accept one.
 */
export type FileInput = string | Uint8Array | { path: string } | { url: string };

export function isPathInput(v: unknown): v is { path: string } {
  return typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && typeof (v as { path?: unknown }).path === 'string';
}

export function isUrlInput(v: unknown): v is { url: string } {
  return typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && typeof (v as { url?: unknown }).url === 'string';
}
