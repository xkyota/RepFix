#!/usr/bin/env node
import { install } from './install.js';
import { clean } from './safety.js';
import { recordCommand } from './runner.js';
import { report } from './report.js';
import { artifactText, attach, init, integrity, locked } from './store.js';
import type { Mode, NoteKind, Phase } from './types.js';

const help = `RepFix — evidence-first debugging (Node.js 22+)

init    --project DIR --summary TEXT [--mode auto|diagnose-only|verify-only]
        [--oracle RELATIVE_FILE ...] [--regression NAME ...]
run     --session DIR --phase reproduce|verify|regression --name NAME
        [--cwd RELATIVE_DIR] [--timeout MS] [--context TEXT] -- EXECUTABLE ARGS...
confirm --session DIR --command ID --reason TEXT
note    --session DIR --kind fact|assumption|root-cause|fix|limitation|test-change
        --text TEXT [--evidence ID ...]
attach  --session DIR --file PATH [--reviewed]
report  --session DIR [--blocked REASON]
install --target codex|claude|both [--scope project|user] [--project DIR]

init prints the session directory. All later commands require it explicitly.
run uses an argument array, never a shell, and returns the child exit code.
report exit codes: 0 VERIFIED, 2 PARTIALLY_VERIFIED/UNVERIFIED, 1 FAILED, 3 BLOCKED.
Errors exit 3. See the bundled references/commands.md for full examples.
`;
const allowed: Record<string, string[]> = {
  init: ['project', 'summary', 'mode', 'oracle', 'regression'],
  run: ['session', 'phase', 'name', 'cwd', 'timeout', 'context'],
  confirm: ['session', 'command', 'reason'], note: ['session', 'kind', 'text', 'evidence'],
  attach: ['session', 'file', 'reviewed'], report: ['session', 'blocked'],
  install: ['target', 'scope', 'project'],
};
async function main(args: string[]): Promise<number> {
  const action = args.shift();
  if (!action || action === '--help' || action === 'help') { process.stdout.write(help); return 0; }
  if (action === '--version') { process.stdout.write('0.1.0\n'); return 0; }
  if (!allowed[action]) throw new Error(`Unknown action: ${action}`);
  const separator = args.indexOf('--');
  const argv = separator < 0 ? [] : args.slice(separator + 1);
  const flags = separator < 0 ? args : args.slice(0, separator);
  if (separator >= 0 && action !== 'run') throw new Error('Only run accepts a command after --');
  const options = new Map<string, string[]>();
  for (let i = 0; i < flags.length; i++) {
    const key = flags[i]!.replace(/^--/, '');
    if (!flags[i]!.startsWith('--') || !allowed[action]!.includes(key)) throw new Error(`Unknown option: ${flags[i]}`);
    const value = key === 'reviewed' ? 'true' : flags[++i];
    if (!value || value.startsWith('--') || !value.trim()) throw new Error(`Missing value for --${key}`);
    if (options.has(key) && !['oracle', 'regression', 'evidence'].includes(key)) throw new Error(`Duplicate --${key}`);
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  const optional = (key: string, fallback = ''): string => options.get(key)?.[0] ?? fallback;
  const required = (key: string): string => {
    const value = optional(key);
    if (!value) throw new Error(`Missing --${key}`);
    return value;
  };
  const many = (key: string): string[] => options.get(key) ?? [];
  const output = (value: unknown): void => { process.stdout.write(`${JSON.stringify(value)}\n`); };
  if (action === 'init') {
    const mode = optional('mode', 'auto');
    if (!['auto', 'diagnose-only', 'verify-only'].includes(mode)) throw new Error('Invalid mode');
    if (many('regression').some(name => !/^[a-zA-Z0-9._-]+$/.test(name))) throw new Error('Regression names must contain only letters, digits, dots, underscores, or hyphens');
    const dir = await init(optional('project', '.'), mode as Mode, required('summary'), many('oracle'), many('regression'));
    process.stdout.write(`${dir}\n`);
    return 0;
  }
  if (action === 'install') { output({ installed: await install(required('target'), optional('scope', 'project'), optional('project', '.')) }); return 0; }
  return locked(required('session'), async (dir, run) => {
    if (action === 'run') {
      const phase = required('phase');
      if (!['reproduce', 'verify', 'regression'].includes(phase)) throw new Error('Invalid phase');
      const timeout = Number(optional('timeout', '120000'));
      if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 3_600_000) throw new Error('--timeout must be 100–3600000 milliseconds');
      const name = required('name');
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Invalid command name');
      const c = await recordCommand(dir, run, phase as Phase, name, argv, optional('cwd', '.'), timeout, optional('context'));
      output({ id: c.id, exitCode: c.exitCode, timedOut: c.timedOut, error: c.error, log: run.artifacts.find(a => a.id === c.log)?.file });
      return c.error || c.timedOut || c.interrupted || c.signal ? 3 : c.exitCode ?? 3;
    }
    if (action === 'confirm') {
      const c = run.commands.find(command => command.id === required('command'));
      if (!c || c.phase !== 'reproduce' || c.exitCode === 0 || c.exitCode === null || c.error || c.timedOut || c.signal || c.interrupted || c.truncated || c.before !== c.after) {
        throw new Error('Only a complete, stable, nonzero reproduction can be confirmed; infrastructure failures are blockers');
      }
      if ((await integrity(dir, run)).length || !(await artifactText(dir, run, c.log)).trim()) throw new Error('Reproduction evidence is missing, empty, or altered');
      if (run.confirmations.some(item => item.command === c.id)) throw new Error('Command already confirmed');
      run.confirmations.push({ command: c.id, reason: clean(required('reason')) });
      output({ confirmed: c.id }); return 0;
    }
    if (action === 'note') {
      const kind = required('kind') as NoteKind;
      if (!['fact', 'assumption', 'root-cause', 'fix', 'limitation', 'test-change'].includes(kind)) throw new Error('Invalid note kind');
      const evidence = many('evidence');
      const ids = new Set([...run.artifacts.map(a => a.id), ...run.commands.map(c => c.id)]);
      if (evidence.some(id => !ids.has(id))) throw new Error('Evidence references must name existing command or artifact IDs');
      if (['fact', 'root-cause'].includes(kind) && !evidence.length) throw new Error('Facts and root causes need --evidence');
      run.notes.push({ kind, text: clean(required('text')), evidence });
      output({ note: run.notes.length }); return 0;
    }
    if (action === 'attach') { output(await attach(dir, run, required('file'), optional('reviewed') === 'true')); return 0; }
    const result = await report(dir, run, optional('blocked') || undefined);
    output({ ...result, report: `${dir}/report.md` });
    return result.status === 'VERIFIED' ? 0 : result.status === 'FAILED' ? 1 : result.status === 'BLOCKED' ? 3 : 2;
  });
}
try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`RepFix: ${clean(error instanceof Error ? error.message : String(error))}\n`); process.exitCode = 3; }
