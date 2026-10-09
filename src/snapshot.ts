import { execFileSync } from 'node:child_process';
import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { hash, inside } from './safety.js';
import type { Snapshot } from './types.js';

const omitted = new Set(['.git', '.repfix', 'node_modules', '.next', 'coverage', 'test-results', 'playwright-report']);
function git(root: string, args: string[]): string {
  return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
}
export async function snapshot(root: string): Promise<Snapshot> {
  let paths: string[] = [];
  let isGit = false;
  try { git(root, ['rev-parse', '--show-toplevel']); isGit = true; }
  catch { /* Plain directories are supported. */ }
  if (isGit) paths = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  else {
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (omitted.has(entry.name)) continue;
        const file = join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else paths.push(relative(root, file));
        if (paths.length > 20_000) throw new Error('Snapshot exceeds 20,000 files; use a smaller project root');
      }
    }
    await walk(root);
  }
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let total = 0, count = 0;
  for (const path of [...new Set(paths)].sort()) {
    if (path.split('/').includes('.repfix')) continue;
    const file = inside(root, path);
    let stat;
    try { stat = await lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) files[path] = hash(`link:${await readlink(file)}`);
    else if (stat.isFile()) {
      inside(root, await realpath(file));
      total += stat.size;
      if (stat.size > 32 * 1024 * 1024 || total > 256 * 1024 * 1024 || ++count > 20_000) {
        throw new Error('Snapshot size limit reached; use a smaller project root or ignore generated files');
      }
      files[path] = hash(Buffer.concat([Buffer.from(`${stat.mode & 0o111}:`), await readFile(file)]));
    } else throw new Error(`Unsupported snapshot entry (for example, submodule): ${path}`);
  }
  return { files, digest: hash(JSON.stringify(files)), git: isGit };
}
export function gitEvidence(root: string): string {
  try {
    const status = git(root, ['status', '--short']);
    const diff = git(root, ['diff', '--no-ext-diff', '--no-textconv']);
    const staged = git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv']);
    return `STATUS\n${status}\nUNSTAGED\n${diff}\nSTAGED\n${staged}`;
  } catch { return 'Git evidence unavailable; content fingerprints are recorded.\n'; }
}
export function changed(before: Snapshot, after: Snapshot): string[] {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter(path => before.files[path] !== after.files[path]).sort();
}
