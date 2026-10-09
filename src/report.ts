import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clean, noLinks, testFile } from './safety.js';
import { changed, gitEvidence, snapshot } from './snapshot.js';
import { integrity } from './store.js';
import type { Assessment, Command, Run, Snapshot } from './types.js';

const passed = (c: Command): boolean => c.exitCode === 0 && !c.error && !c.signal && !c.timedOut && !c.interrupted && !c.truncated && c.before === c.after;
const blocked = (c: Command): boolean => !!c.error || c.timedOut || c.interrupted || !!c.signal;
export function assess(run: Run, current: Snapshot, broken: string[] = [], blocker?: string): Assessment {
  const changedFiles = changed(run.baseline, current);
  const result = (status: Assessment['status'], ...reasons: string[]): Assessment => ({ status, reasons, changedFiles });
  if (broken.length) return result('BLOCKED', ...broken);
  if (blocker) return result('BLOCKED', clean(blocker));
  if (run.mode !== 'auto' && (changedFiles.length || run.commands.some(c => c.before !== run.baseline.digest || c.after !== run.baseline.digest))) {
    return result('FAILED', `${run.mode} observed project changes; read-only mode was violated. Review the changes; RepFix does not revert them.`);
  }
  const latest = new Map<string, Command>();
  for (const c of run.commands) latest.set(`${c.phase}:${c.name}`, c);
  const active = [...latest.values()];
  const checks = active.filter(c => c.phase !== 'reproduce');
  if (checks.some(c => !blocked(c) && c.exitCode !== 0)) return result('FAILED', 'A current verification or regression command failed.');
  if (active.some(blocked)) return result('BLOCKED', 'A current command could not complete (spawn, timeout, signal, or interruption).');
  if (run.mode === 'diagnose-only') return result('UNVERIFIED', 'Diagnosis only; no fix was applied or verified.');
  const verifications = run.commands.filter(c => c.phase === 'verify');
  const verification = verifications.at(-1);
  if (!verification || !passed(verification)) return result('UNVERIFIED', 'No complete, stable, successful verification run.');
  const reasons: string[] = [];
  if (verification.after !== current.digest) reasons.push('Project changed after verification; rerun the original scenario.');
  const reproduction = run.commands.filter(c => c.phase === 'reproduce'
    && run.commands.indexOf(c) < run.commands.indexOf(verification)
    && c.fingerprint === verification.fingerprint
    && run.confirmations.some(item => item.command === c.id)).at(-1);
  if (!reproduction) reasons.push('No confirmed original failure with the same command, environment, cwd, timeout, and context.');
  else {
    if (reproduction.after === verification.before) reasons.push('No project change separates the failure and success; a fix has not been demonstrated.');
    if (reproduction.exitCode === 0 || reproduction.exitCode === null || blocked(reproduction) || reproduction.truncated || reproduction.before !== reproduction.after) {
      reasons.push('Original failure evidence is incomplete or the reproduction changed project files.');
    }
    if (!run.oracles.length || run.oracles.some(path => reproduction.oracles[path] === 'MISSING' || reproduction.oracles[path] !== verification.oracles[path])) {
      reasons.push('Original test/assertion files were not pinned or changed between reproduction and verification.');
    }
  }
  if (!run.regressions.length) reasons.push('No regression checks were declared.');
  for (const name of run.regressions) {
    const c = latest.get(`regression:${name}`);
    if (!c || !passed(c) || c.after !== current.digest || run.commands.indexOf(c) < run.commands.indexOf(verification)) {
      reasons.push(`Regression ${name} has not passed on the final project state after verification.`);
    }
  }
  if (!run.notes.some(n => n.kind === 'root-cause' && n.evidence.length)) reasons.push('No root cause recorded with evidence references.');
  if (changedFiles.some(testFile) && !run.notes.some(n => n.kind === 'test-change')) reasons.push('Test changes need an explicit explanation; review assertions and skips.');
  if (run.notes.some(n => n.kind === 'limitation')) reasons.push('Recorded limitations remain; review them before claiming completion.');
  if (run.mode === 'verify-only') reasons.push('verify-only establishes current behavior; it does not establish a before/after fix.');
  return reasons.length ? result('PARTIALLY_VERIFIED', ...reasons) : result('VERIFIED', 'Confirmed original failure now passes with unchanged test oracles; all declared regressions pass on the final project state.');
}
const cell = (text: string): string => clean(text).replace(/[|`<>]/g, char => `&#${char.charCodeAt(0)};`).replace(/\r?\n/g, ' ');
export async function report(dir: string, run: Run, blocker?: string): Promise<Assessment> {
  let current: Snapshot | undefined;
  let snapshotError = '';
  try { current = await snapshot(run.root); }
  catch (error) { snapshotError = clean(`Project snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  const assessment: Assessment = current
    ? assess(run, current, await integrity(dir, run), blocker)
    : { status: 'BLOCKED', reasons: [snapshotError], changedFiles: [] };
  const lines = [
    '# RepFix report', '', `**${assessment.status}** · ${run.mode} · ${run.id}`, '', cell(run.summary), '',
    '## Result', '', ...assessment.reasons.map(reason => `- ${cell(reason)}`), '',
    '## Findings', '', ...run.notes.map(n => `- **${n.kind}**: ${cell(n.text)}${n.evidence.length ? ` (evidence: ${n.evidence.join(', ')})` : ''}`), '',
    '## Failure confirmation', '', ...run.confirmations.map(c => `- ${c.command}: ${cell(c.reason)}`), '',
    '## Commands', '', '| ID | Phase / name | Command | Exit | Duration | Evidence |', '| --- | --- | --- | --- | --- | --- |',
    ...run.commands.map(c => {
      const log = run.artifacts.find(a => a.id === c.log)!;
      const flags = [c.timedOut && 'timeout', c.truncated && 'truncated', c.interrupted && 'interrupted', c.error, c.signal].filter(Boolean).join(', ');
      return `| ${c.id} | ${c.phase} / ${cell(c.name)} | ${cell(JSON.stringify(c.argv))} (cwd: ${cell(c.cwd)}; runtime: ${cell(c.runtime)}; context: ${cell(c.context)}) | ${c.exitCode ?? 'none'} ${cell(flags)} | ${c.durationMs}ms | [${log.id}](${log.file}) |`;
    }), '', '## Changes since start', '',
    ...(!current ? ['Project snapshot unavailable; changes could not be assessed.'] : assessment.changedFiles.length ? assessment.changedFiles.map(path => `- ${cell(path)}${testFile(path) ? ' (test-related)' : ''}`) : ['No project content changes detected.']), '',
    'Baseline Git status and diffs preserve evidence of pre-existing changes. Inspect final-git.txt before accepting edits; fingerprints do not prove preservation of intent.', '',
    '## Artifacts', '', ...run.artifacts.map(a => `- [${a.id}: ${cell(a.kind)}](${a.file}) · SHA-256: ${a.sha256}`), '',
    '## Scope', '',
    'Local evidence, not a signed attestation. Commands run with the caller’s permissions. A human or agent must confirm that assertions exercise the reported bug. Git-ignored files and external services are outside the project fingerprint; Node/runtime and inherited environment are fingerprinted per command. Binary attachments require privacy review.', '',
  ];
  for (const name of ['report.md', 'report.json', 'final-git.txt']) await noLinks(join(dir, name));
  await writeFile(join(dir, 'report.md'), lines.join('\n'), { mode: 0o600 });
  await writeFile(join(dir, 'report.json'), JSON.stringify({ ...assessment, mode: run.mode, run: run.id, generatedAt: new Date().toISOString(), commands: run.commands, notes: run.notes, artifacts: run.artifacts }, null, 2) + '\n', { mode: 0o600 });
  await writeFile(join(dir, 'final-git.txt'), clean(gitEvidence(run.root)), { mode: 0o600 });
  return assessment;
}
