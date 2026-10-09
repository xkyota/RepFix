import { readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { boundedRead, clean, inside, noLinks } from './safety.js';

export interface Detection {
  root: string;
  status: 'detected' | 'unsupported' | 'incomplete';
  languages: string[];
  frameworks: string[];
  testRunners: string[];
  manifests: string[];
  candidates: { runner: string; argv: string[] }[];
  warnings: string[];
}
const omitted = new Set(['.git', '.repfix', '.agents', '.claude', 'node_modules', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build', 'coverage']);

// Read metadata only. Never import project configuration, execute scripts, or
// follow symlinks. A caller with an existing snapshot can reuse its file list.
export async function detect(project: string, knownFiles?: string[]): Promise<Detection> {
  const root = await realpath(resolve(project));
  const result: Detection = { root, status: 'unsupported', languages: [], frameworks: [], testRunners: [], manifests: [], candidates: [], warnings: [] };
  const files: string[] = [];
  let visited = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (omitted.has(entry.name)) continue;
      if (++visited > 2000) { result.warnings.push('Discovery reached 2,000 entries; select a focused package root.'); return; }
      const path = join(dir, entry.name);
      if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
      else if (entry.isDirectory() && depth < 3) await walk(path, depth + 1);
      if (visited > 2000) return;
    }
  }
  if (knownFiles) {
    const eligible = knownFiles.filter(path => !path.split('/').some(part => omitted.has(part)));
    files.push(...eligible.slice(0, 2000));
    if (eligible.length > 2000) result.warnings.push('Discovery reached 2,000 files; select a focused package root.');
  }
  else await walk(root, 0);
  const has = (file: string): boolean => files.includes(file);
  async function read(file: string): Promise<string> {
    if (!has(file)) return '';
    try {
      const path = inside(root, file);
      await noLinks(path);
      return (await boundedRead(path, 256 * 1024)).toString('utf8');
    } catch { result.warnings.push(`Cannot safely read ${file}; inspect it manually.`); return ''; }
  }
  const language = (name: string): void => { if (!result.languages.includes(name)) result.languages.push(name); };
  const runner = (name: string, argv: string[]): void => {
    if (!result.testRunners.includes(name)) result.testRunners.push(name);
    if (!result.candidates.some(c => c.runner === name)) result.candidates.push({ runner: name, argv });
  };
  for (const [pattern, name] of [[/\.[cm]?tsx?$/, 'TypeScript'], [/\.[cm]?jsx?$/, 'JavaScript'], [/\.py$/, 'Python'], [/\.go$/, 'Go'], [/\.rs$/, 'Rust']] as const) {
    if (files.some(path => pattern.test(path))) language(name);
  }
  result.manifests = ['package.json', 'pyproject.toml', 'requirements.txt', 'setup.cfg', 'pytest.ini', 'go.mod', 'Cargo.toml'].filter(has);
  if (has('package.json')) {
    language('JavaScript');
    try {
      const pkg = JSON.parse(await read('package.json'));
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Invalid package');
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('typescript' in deps || has('tsconfig.json')) language('TypeScript');
      for (const [dep, framework] of [['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['express', 'Express'], ['@nestjs/core', 'NestJS']]) {
        if (dep! in deps) result.frameworks.push(framework!);
      }
      for (const dep of ['vitest', 'jest', 'mocha', '@playwright/test']) {
        if (dep in deps) runner(dep, [join('node_modules', '.bin', dep === '@playwright/test' ? 'playwright' : dep), ...(dep === 'vitest' ? ['run'] : dep === '@playwright/test' ? ['test'] : [])]);
      }
      const scripts = Object.values(pkg.scripts ?? {}).filter((value): value is string => typeof value === 'string');
      if (scripts.some(value => /\bnode\s+(?:--\S+\s+)*--test\b/.test(value))) runner('node:test', ['node', '--test']);
      if (typeof pkg.scripts?.test === 'string') {
        const manager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lock') || has('bun.lockb') ? 'bun' : 'npm';
        result.candidates.unshift({ runner: 'package-script', argv: [manager, 'test'] });
      }
    } catch { result.warnings.push('package.json is invalid or unreadable; no package commands were inferred.'); }
  }
  // Sample only a few test headers when manifests do not identify a runner.
  if (!result.testRunners.includes('node:test')) {
    for (const path of files.filter(path => /\.(test|spec)\.[cm]?js$/.test(path)).slice(0, 3)) {
      if (/(?:from\s*|require\s*\()\s*['"]node:test['"]/.test(await read(path))) { runner('node:test', ['node', '--test']); break; }
    }
  }
  const python = (await Promise.all(['pyproject.toml', 'requirements.txt', 'setup.cfg', 'pytest.ini'].map(read))).join('\n').trim();
  if (python) language('Python');
  for (const [pattern, name] of [[/\bdjango\b/i, 'Django'], [/\bfastapi\b/i, 'FastAPI'], [/\bflask\b/i, 'Flask']] as const) {
    if (pattern.test(python)) result.frameworks.push(name);
  }
  if (/\bpytest\b/.test(python) || has('pytest.ini')) runner('pytest', ['python3', '-B', '-m', 'pytest']);
  else {
    for (const path of files.filter(path => /(^|\/)test[^/]*\.py$/.test(path)).slice(0, 3)) {
      if (/\b(?:import unittest|from unittest import)\b/.test(await read(path))) {
        runner('unittest', ['python3', '-B', '-m', 'unittest', 'discover', '-s', path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.']); break;
      }
    }
  }
  if (has('go.mod')) { language('Go'); runner('go test', ['go', 'test', './...']); }
  if (has('Cargo.toml')) { language('Rust'); runner('cargo test', ['cargo', 'test', '--offline']); }
  if (files.some(path => /\/(package.json|pyproject.toml|go.mod|Cargo.toml)$/.test(path))) {
    result.warnings.push('Nested manifests found; run detect on the affected package. Root-level candidates do not cover a monorepo.');
  }
  if (!result.testRunners.length) result.warnings.push('No supported test runner identified; inspect project instructions before choosing a command.');
  result.status = result.warnings.length ? (result.candidates.length ? 'incomplete' : 'unsupported') : 'detected';
  result.warnings.push('Candidates are hints, never executed. Review scripts/configuration and authorize execution; tools may fetch dependencies.');
  result.languages.sort(); result.frameworks.sort(); result.testRunners.sort();
  result.warnings = result.warnings.map(clean);
  return result;
}
