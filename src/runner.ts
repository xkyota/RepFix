import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { approveCommand, clean, cleanArgs, evidenceIssue, hash, inside, testFile } from './safety.js';
import { changed, snapshot } from './snapshot.js';
import { addArtifact } from './store.js';
import { escalate, securityConcern, sensitivePath } from './adaptive.js';
import type { Command, Phase, Run } from './types.js';

interface Result {
  output: string; exitCode: number | null; signal: string | null; durationMs: number;
  timedOut: boolean; truncated: boolean; interrupted: boolean; error?: string;
}
export function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Inherited node:test IPC context makes nested `node --test` skip tests and exit zero.
  delete env.NODE_TEST_CONTEXT;
  return env;
}
export async function execute(argv: string[], cwd: string, timeoutMs: number, maxBytes = 1024 * 1024): Promise<Result> {
  if (!argv.length || !argv[0] || argv.some(arg => arg.includes('\0'))) throw new Error('A valid executable and argument array are required');
  const start = Date.now();
  return new Promise(resolve => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: childEnvironment(), shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0, truncated = false, timedOut = false, interrupted = false;
    let error: string | undefined;
    let escalation: NodeJS.Timeout | undefined;
    let emergency: NodeJS.Timeout | undefined;
    let done = false;
    function kill(signal: NodeJS.Signals): void {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Process already exited. */ }
    }
    function stop(): void {
      kill('SIGTERM');
      escalation ??= setTimeout(() => kill('SIGKILL'), 300);
      // A descendant may retain pipes even after its parent exits.
      emergency ??= setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, 'SIGKILL'); }, 1500);
    }
    const onInterrupt = (): void => { interrupted = true; stop(); };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const collect = (chunk: Buffer): void => {
      const remaining = maxBytes - size;
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); size += Math.min(chunk.length, remaining); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', cause => { error = clean(cause.message); });
    function finish(exitCode: number | null, signal: string | null): void {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(escalation); clearTimeout(emergency);
      process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt);
      // Commands may not leave background services behind.
      kill('SIGKILL');
      const output = clean(Buffer.concat(chunks).toString('utf8')) + (truncated ? '\n[OUTPUT TRUNCATED]\n' : '');
      resolve({ output, exitCode, signal, durationMs: Date.now() - start, timedOut, truncated, interrupted, ...(error ? { error } : {}) });
    }
    child.on('close', finish);
  });
}
export async function recordCommand(dir: string, run: Run, phase: Phase, name: string, argv: string[], cwdPath: string, timeoutMs: number, context: string, approval = ''): Promise<Command> {
  approval = approveCommand(argv, approval);
  if (run.mode === 'diagnose-only' && phase !== 'reproduce') throw new Error('diagnose-only accepts reproduction commands only');
  if (run.mode === 'verify-only' && phase === 'reproduce') throw new Error('verify-only accepts verification and regression commands only');
  if (phase === 'regression' && !run.regressions.includes(name)) throw new Error('Declare this regression with init --regression NAME or plan --regression NAME before running it');
  const cwd = await realpath(inside(run.root, cwdPath));
  inside(run.root, cwd);
  const before = await snapshot(run.root);
  const oracles: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const path of run.oracles) oracles[path] = before.files[path] ?? 'MISSING';
  const environment = Object.entries(childEnvironment()).filter(([key]) => !['_', 'PWD', 'OLDPWD', 'SHLVL'].includes(key)).sort(([a], [b]) => a.localeCompare(b));
  const fingerprint = hash(JSON.stringify({ argv, cwd, timeoutMs, context, node: process.version, platform: process.platform, environment }));
  const startedAt = new Date().toISOString();
  const result = await execute(argv, cwd, timeoutMs);
  const log = await addArtifact(dir, run, result.output, 'command-log', 'log');
  let afterDigest = 'UNAVAILABLE';
  try { afterDigest = (await snapshot(run.root)).digest; }
  catch (error) { result.error = clean(`Post-command snapshot failed: ${error instanceof Error ? error.message : String(error)}`); }
  const { output: _output, ...metadata } = result;
  const command: Command = {
    id: `c${run.commands.length + 1}`, phase, name: clean(name), argv: cleanArgs(argv),
    context: clean(context), runtime: `${process.version} ${process.platform}/${process.arch}`,
    approval, evidenceIssue: evidenceIssue(result.output),
    cwd: relative(run.root, cwd) || '.', fingerprint, startedAt, ...metadata,
    before: before.digest, after: afterDigest, oracles, log: log.id,
  };
  run.commands.push(command);
  if (phase === 'reproduce' && (command.exitCode === 0 || command.evidenceIssue || command.error || command.timedOut || command.truncated)) {
    escalate(run, 'ambiguous-reproduction', `Reproduction ${command.id} did not provide a complete, stable original failure.`);
  }
  if (phase !== 'reproduce' && (command.exitCode !== 0 || command.error || command.timedOut || command.evidenceIssue)) {
    escalate(run, 'unexpected-test-failure', `${phase} ${command.id} did not pass completely.`);
  }
  if (phase === 'verify' && !run.notes.some(note => note.kind === 'root-cause')) {
    escalate(run, 'uncertain-root-cause', `Verification ${command.id} began without a recorded causal finding.`);
  }
  const prior = run.commands.slice(0, -1).find(c => c.fingerprint === command.fingerprint && c.before === command.before && c.exitCode !== command.exitCode);
  if (prior) escalate(run, 'unstable-tests', `${prior.id} and ${command.id} returned different exit codes on the same project state.`);
  const changedFiles = changed(run.baseline, before);
  const sourceFiles = changedFiles.filter(path => !testFile(path));
  if (sourceFiles.length > 1) escalate(run, 'additional-components', `Changes span ${sourceFiles.length} files: ${sourceFiles.slice(0, 5).join(', ')}.`);
  if (sourceFiles.some(sensitivePath)) escalate(run, 'security-or-data-integrity', 'Changed source paths identify a sensitive component.');
  if (securityConcern(context)) escalate(run, 'security-or-data-integrity', `Command context for ${command.id} identifies a sensitive path.`);
  return command;
}
