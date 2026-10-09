import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { clean, cleanArgs, hash, inside } from './safety.js';
import { snapshot } from './snapshot.js';
import { addArtifact } from './store.js';
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
export async function recordCommand(dir: string, run: Run, phase: Phase, name: string, argv: string[], cwdPath: string, timeoutMs: number, context: string): Promise<Command> {
  if (run.mode === 'diagnose-only' && phase !== 'reproduce') throw new Error('diagnose-only accepts reproduction commands only');
  if (run.mode === 'verify-only' && phase === 'reproduce') throw new Error('verify-only accepts verification and regression commands only');
  if (phase === 'regression' && !run.regressions.includes(name)) throw new Error('Declare this regression with init --regression NAME before running it');
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
    cwd: relative(run.root, cwd) || '.', fingerprint, startedAt, ...metadata,
    before: before.digest, after: afterDigest, oracles, log: log.id,
  };
  run.commands.push(command);
  return command;
}
