import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { boundedRead, clean, hash, inside, noLinks, projectFile } from './safety.js';
import { gitEvidence, snapshot } from './snapshot.js';
import type { Artifact, Mode, Run } from './types.js';

export async function save(runDir: string, run: Run): Promise<void> {
  const temp = join(runDir, `${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temp, join(runDir, 'run.json'));
}
export async function addArtifact(runDir: string, run: Run, content: Buffer | string, kind: string, ext: string): Promise<Artifact> {
  const id = `a${run.artifacts.length + 1}`;
  const file = `${id}.${ext}`;
  await writeFile(join(runDir, file), content, { flag: 'wx', mode: 0o600 });
  const artifact = { id, file, sha256: hash(content), kind };
  run.artifacts.push(artifact);
  return artifact;
}
export async function init(rootPath: string, mode: Mode, summary: string, oracles: string[], regressions: string[]): Promise<string> {
  const root = await realpath(resolve(rootPath));
  const baseline = await snapshot(root);
  oracles = await Promise.all(oracles.map(async path => relative(root, await projectFile(root, path))));
  for (const oracle of oracles) {
    if (!Object.hasOwn(baseline.files, oracle)) throw new Error('Oracle must be a project-relative, non-ignored file');
  }
  const parent = join(root, '.repfix');
  await noLinks(parent);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  // Evidence stays local without modifying the project's existing ignore rules.
  try { await writeFile(join(parent, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = join(parent, id);
  await mkdir(dir, { mode: 0o700 });
  const run: Run = {
    version: 1, id, root, mode, summary: clean(summary), createdAt: new Date().toISOString(),
    baseline, oracles, regressions: [...new Set(regressions)], commands: [], artifacts: [], notes: [], confirmations: [],
  };
  await addArtifact(dir, run, clean(gitEvidence(root)), 'baseline-git', 'txt');
  await save(dir, run);
  return dir;
}
export async function load(runPath: string): Promise<{ dir: string; run: Run }> {
  const dir = resolve(runPath);
  await noLinks(dir);
  const data: unknown = JSON.parse((await boundedRead(join(dir, 'run.json'), 32 * 1024 * 1024)).toString());
  // Reject corrupt/foreign manifests before any command is launched. Artifacts are
  // checked separately on each report. This is a local audit trail, not a signature.
  const run = data as Run;
  if (!run || run.version !== 1 || !['auto', 'diagnose-only', 'verify-only'].includes(run.mode)
    || typeof run.root !== 'string' || run.id !== basename(dir)
    || !Array.isArray(run.commands) || !Array.isArray(run.artifacts) || !Array.isArray(run.notes)
    || !Array.isArray(run.regressions) || !Array.isArray(run.oracles) || !Array.isArray(run.confirmations)
    || !run.baseline?.files || typeof run.baseline.digest !== 'string'
    || run.baseline.digest !== hash(JSON.stringify(run.baseline.files))) throw new Error('Invalid RepFix run manifest');
  if (join(await realpath(run.root), '.repfix', run.id) !== dir) throw new Error('Run is outside its original project');
  for (const a of run.artifacts) {
    if (!/^a\d+$/.test(a.id) || !/^a\d+\.[a-z0-9]+$/.test(a.file) || !/^[a-f0-9]{64}$/.test(a.sha256)) throw new Error('Invalid artifact record');
  }
  for (const c of run.commands) {
    if (!/^c\d+$/.test(c.id) || !['reproduce', 'verify', 'regression'].includes(c.phase)
      || !Array.isArray(c.argv) || typeof c.name !== 'string' || typeof c.fingerprint !== 'string'
      || !c.oracles || typeof c.before !== 'string' || typeof c.after !== 'string'
      || !run.artifacts.some(a => a.id === c.log)) throw new Error('Invalid command record');
  }
  return { dir, run };
}
export async function locked<T>(runPath: string, action: (dir: string, run: Run) => Promise<T>): Promise<T> {
  const dir = resolve(runPath);
  await noLinks(dir);
  const lock = join(dir, '.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Run is locked; wait for the active command. After a crash, remove .lock only after checking its recorded PID.');
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    const { run } = await load(dir);
    const result = await action(dir, run);
    await save(dir, run);
    return result;
  } finally { await handle.close(); await rm(lock); }
}
export async function integrity(dir: string, run: Run): Promise<string[]> {
  const failures: string[] = [];
  for (const a of run.artifacts) {
    try {
      const file = inside(dir, a.file);
      await noLinks(file);
      if (hash(await boundedRead(file, 32 * 1024 * 1024)) !== a.sha256) failures.push(`${a.id}: hash mismatch`);
    } catch { failures.push(`${a.id}: missing or unsafe artifact`); }
  }
  return failures;
}
export async function attach(dir: string, run: Run, file: string, reviewed: boolean): Promise<Artifact> {
  // Text is redacted. Opaque browser evidence is copied only after explicit review.
  const resolved = await realpath(resolve(file));
  const ext = resolved.split('.').at(-1)?.toLowerCase() ?? '';
  const binary = ['png', 'jpg', 'jpeg', 'webp', 'zip'].includes(ext);
  if (binary && !reviewed) throw new Error('Review images/traces for secrets and personal data, then use --reviewed');
  if (!binary && !['txt', 'log', 'json', 'md', 'xml', 'csv'].includes(ext)) throw new Error('Unsupported evidence format');
  const bytes = await boundedRead(resolved, 32 * 1024 * 1024);
  return addArtifact(dir, run, binary ? bytes : clean(bytes.toString('utf8')), binary ? 'reviewed-binary' : 'text-input', ext);
}
export async function artifactText(dir: string, run: Run, id: string): Promise<string> {
  const a = run.artifacts.find(item => item.id === id);
  if (!a) throw new Error('Unknown artifact');
  return readFile(inside(dir, a.file), 'utf8');
}
