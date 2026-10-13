import { clean } from './safety.js';
import type { Classification, EscalationEvent, Profile, Run } from './types.js';

const rank: Record<Profile, number> = { FAST: 0, STANDARD: 1, DEEP: 2 };
const risk = /\b(security|auth(?:entication|orization)?|permission|secret|credential|encryption|injection|xss|csrf|data[- ]?integrity|data loss|corrupt(?:ion)?|payment|migration)\b/i;
const russianRisk = /(?:безопасност|авторизац|аутентификац|прав[ао] доступа|секрет|парол|учетн|платеж|платёж|целостност|потер[яю] данн|миграц)/i;
const complex = /\b(concurren\w*|race condition|deadlock|distributed|cross[- ]component|cross[- ]service|multi[- ]file|monorepo|flak\w*|intermittent|sometimes|occasionally|sporadic(?:ally)?|nondeterministic|unknown cause|unclear cause|cannot reproduce)\b/i;
const broad = /\b(api|public interface|schema|database|shared|framework|browser|end[- ]to[- ]end|integration)\b/i;
const ambiguous = /\b(?:sometimes|occasionally|sporadic(?:ally)?|maybe|perhaps|possibly|might|unsure|unclear|unknown|seems?|appears?|random(?:ly)?|does(?:n’t|n't| not) work|broken|wrong|fails?)\b|[?]|(?:иногда|непонятно|возможно|кажется|периодически|случайно)/i;
const sensitiveSegment = /^(?:auth|authn|authz|authentication|authorization|login|session|permission|permissions|access|acl|secret|secrets|credential|credentials|password|passwords|token|tokens|payment|payments|billing|invoice|invoices|migration|migrations|schema|database|db|crypto|encryption|security)$/i;

export function sensitivePath(path: string): boolean {
  return path.replace(/([a-z])([A-Z])/g, '$1/$2').split(/[/\\._-]+/).some(part => sensitiveSegment.test(part));
}
export function securityConcern(text: string): boolean { return risk.test(text) || russianRisk.test(text); }

// This is intentionally a bounded, explainable heuristic. Unknowns increase depth;
// no profile can relax the evidence gate in report.ts.
export function classify(run: Pick<Run, 'summary' | 'detection' | 'oracles' | 'regressions'>): Classification {
  const text = run.summary ?? '';
  const warnings = run.detection?.warnings.filter(w => !w.startsWith('Candidates are hints')) ?? [];
  const nested = warnings.some(w => /nested manifests|focused package root/i.test(w));
  const nonEnglish = /[\u0400-\u04ff]/u.test(text);
  const vague = ambiguous.test(text);
  const sensitiveOracle = run.oracles.some(sensitivePath);
  const dimensions: Classification['dimensions'] = {
    complexity: complex.test(text) ? 2 : broad.test(text) || vague ? 1 : 0,
    scope: nested || /cross[- ]component|cross[- ]service|multi[- ]file|monorepo/i.test(text) ? 2 : /\b(multiple|several|shared)\b/i.test(text) ? 1 : 0,
    risk: securityConcern(text) || sensitiveOracle ? 2 : 0,
    tests: !run.oracles.length || !run.regressions.length || !run.detection?.testRunners.length ? 2 : run.oracles.length > 1 ? 1 : 0,
    environment: warnings.length ? (nested || run.detection?.status === 'unsupported' ? 2 : 1) : 0,
    regressionImpact: /\b(migration|schema|public interface|shared|cross[- ]component|monorepo)\b/i.test(text) ? 2 : broad.test(text) ? 1 : 0,
  };
  const reasons: string[] = [];
  const uncertainty: string[] = [];
  for (const [name, score] of Object.entries(dimensions)) if (score) reasons.push(`${name}: ${score === 2 ? 'high' : 'moderate'}`);
  if (!run.oracles.length) uncertainty.push('No pinned test oracle was declared.');
  if (!run.regressions.length) uncertainty.push('No relevant regression was declared.');
  if (!run.detection?.testRunners.length) uncertainty.push('No test runner was detected.');
  if (warnings.length) uncertainty.push(...warnings);
  if (text.trim().length < 24) uncertainty.push('The task summary has little diagnostic detail.');
  if (nonEnglish) uncertainty.push('The summary uses a language with limited classification keywords; host assessment is needed.');
  if (vague) uncertainty.push('The summary uses uncertain or nonspecific behavior language.');
  if (sensitiveOracle) reasons.push('A pinned oracle path names a sensitive component.');
  const scores = Object.values(dimensions);
  const selected: Profile = [dimensions.risk, dimensions.scope, dimensions.complexity, dimensions.regressionImpact].some(value => value === 2)
    ? 'DEEP' : scores.some(Boolean) || uncertainty.length ? 'STANDARD' : 'FAST';
  const confidence = Math.max(0.2, Math.min(1, 1 - uncertainty.length * 0.13 - (text.trim().length < 24 ? 0.15 : 0)));
  if (!reasons.length) reasons.push('One localized scenario with a pinned oracle and declared regression.');
  return { selected, current: selected, reasons, confidence, uncertainty, dimensions, needsHostAssessment: uncertainty.length > 0 || confidence < 0.7, escalations: [] };
}

export function classification(run: Run): Classification {
  return run.classification ??= classify(run);
}

export function escalate(run: Run, event: EscalationEvent, explanation: string): void {
  const state = classification(run);
  const to: Profile = ['additional-components', 'security-or-data-integrity', 'unstable-tests'].includes(event) ? 'DEEP' : rank[state.current] < rank.STANDARD ? 'STANDARD' : 'DEEP';
  const reason = clean(explanation);
  if (!reason.trim()) throw new Error('Escalation requires a concrete reason');
  if (state.escalations.some(item => item.event === event && item.reason === reason)) return;
  const from = state.current;
  if (rank[to] > rank[from]) state.current = to;
  state.escalations.push({ event, reason, at: new Date().toISOString(), afterCommand: run.commands.length, from, to: state.current });
}

export function telemetry(run: Run, now = Date.now()) {
  const phaseDurationsMs = { reproduce: 0, verify: 0, regression: 0 };
  for (const command of run.commands) phaseDurationsMs[command.phase] += command.durationMs;
  const totalDurationMs = Math.max(0, now - Date.parse(run.createdAt));
  const elapsedOutsideRecordedCommandsMs = Math.max(0, totalDurationMs - phaseDurationsMs.reproduce - phaseDurationsMs.verify - phaseDurationsMs.regression);
  return { selectedProfile: classification(run).selected, currentProfile: classification(run).current,
    classificationReasons: classification(run).reasons, confidence: classification(run).confidence,
    uncertainty: classification(run).uncertainty, escalationEvents: classification(run).escalations,
    totalDurationMs, phaseDurationsMs, elapsedOutsideRecordedCommandsMs, recordedCommandCount: run.commands.length,
    verificationOutcomes: run.commands.map(c => ({ id: c.id, phase: c.phase, name: c.name, exitCode: c.exitCode,
      complete: !c.error && !c.timedOut && !c.interrupted && !c.truncated && !c.evidenceIssue })) };
}
