import type { Detection } from './detect.js';
export type Mode = 'auto' | 'diagnose-only' | 'verify-only';
export type Phase = 'reproduce' | 'verify' | 'regression';
export type Status = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'FAILED' | 'BLOCKED';
export type NoteKind = 'fact' | 'assumption' | 'root-cause' | 'fix' | 'limitation' | 'test-change';
export type Profile = 'FAST' | 'STANDARD' | 'DEEP';
export type EscalationEvent = 'ambiguous-reproduction' | 'uncertain-root-cause' | 'unexpected-test-failure' | 'additional-components' | 'security-or-data-integrity' | 'unstable-tests';
export interface Classification {
  selected: Profile;
  current: Profile;
  reasons: string[];
  confidence: number;
  uncertainty: string[];
  dimensions: Record<'complexity' | 'scope' | 'risk' | 'tests' | 'environment' | 'regressionImpact', number>;
  needsHostAssessment: boolean;
  escalations: { event: EscalationEvent; reason: string; at: string; afterCommand: number; from: Profile; to: Profile }[];
}
export interface Snapshot { files: Record<string, string>; digest: string; git: boolean }
export interface Artifact { id: string; file: string; sha256: string; kind: string }
export interface Command {
  id: string; phase: Phase; name: string; argv: string[]; cwd: string; fingerprint: string;
  context: string; runtime: string;
  startedAt: string; durationMs: number; exitCode: number | null; signal: string | null;
  error?: string; timedOut: boolean; truncated: boolean; interrupted: boolean;
  approval?: string; evidenceIssue?: string;
  before: string; after: string; oracles: Record<string, string>; log: string;
}
export interface Note { kind: NoteKind; text: string; evidence: string[] }
export interface Run {
  version: 1; id: string; root: string; mode: Mode; createdAt: string; summary: string;
  baseline: Snapshot; oracles: string[]; regressions: string[];
  commands: Command[]; artifacts: Artifact[]; notes: Note[];
  confirmations: { command: string; reason: string }[];
  detection?: Detection;
  classification?: Classification;
}
export interface Assessment { status: Status; reasons: string[]; changedFiles: string[] }
