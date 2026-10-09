import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export function inside(root: string, path: string): string {
  const result = resolve(root, path);
  const rel = relative(root, result);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path escapes its permitted directory');
  return result;
}
export async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let cursor = absolute;
  while (true) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlink paths are not permitted here'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = resolve(cursor, '..');
    if (parent === cursor) break;
    cursor = parent;
  }
}
export async function projectFile(root: string, path: string): Promise<string> {
  const file = inside(root, path);
  const resolved = await realpath(file);
  inside(root, resolved);
  if (!(await lstat(resolved)).isFile()) throw new Error('Expected a regular file');
  return resolved;
}
export async function boundedRead(file: string, max = 2 * 1024 * 1024): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > max) throw new Error('File is not regular or exceeds the size limit');
  return readFile(file);
}
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let result = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 4 && /token|secret|password|credential|api.?key|private.?key/i.test(key)) {
      result = result.split(value).join('[REDACTED]');
    }
  }
  return result
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._~-]+/gi, '[REDACTED AUTH]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]')
    .replace(/(["']?(?:[\w-]*(?:token|secret|password|api[_-]?key|credential))["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(--(?:[\w-]*(?:token|secret|password|api-key|credential))\s+)(\S+)/gi, '$1[REDACTED]');
}
export const clean = (value: string): string => redact(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
export function cleanArgs(argv: string[]): string[] {
  return argv.map((arg, index) => index > 0 && /^--?[\w-]*(?:token|secret|password|api-key|credential)$/i.test(argv[index - 1]!) ? '[REDACTED]' : clean(arg));
}
export const testFile = (path: string): boolean => /(^|\/)(__tests__|tests?|e2e)(\/|$)|\.(test|spec)\.[^/]+$|(^|\/)(jest|vitest|playwright)\.config\./i.test(path);
