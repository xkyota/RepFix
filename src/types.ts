export type Mode = 'auto' | 'diagnose-only' | 'verify-only';
export type Phase = 'reproduce' | 'verify' | 'regression';
export type Status = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'FAILED' | 'BLOCKED';
export type NoteKind = 'fact' | 'assumption' | 'root-cause' | 'fix' | 'limitation' | 'test-change';
export interface Snapshot { files: Record<string, string>; digest: string; git: boolean }
export interface Artifact { id: string; file: string; sha256: string; kind: string }
export interface Command {
  id: string; phase: Phase; name: string; argv: string[]; cwd: string; fingerprint: string;
  context: string; runtime: string;
  startedAt: string; durationMs: number; exitCode: number | null; signal: string | null;
  error?: string; timedOut: boolean; truncated: boolean; interrupted: boolean;
  before: string; after: string; oracles: Record<string, string>; log: string;
}
export interface Note { kind: NoteKind; text: string; evidence: string[] }
export interface Run {
  version: 1; id: string; root: string; mode: Mode; createdAt: string; summary: string;
  baseline: Snapshot; oracles: string[]; regressions: string[];
  commands: Command[]; artifacts: Artifact[]; notes: Note[];
  confirmations: { command: string; reason: string }[];
}
export interface Assessment { status: Status; reasons: string[]; changedFiles: string[] }
