import { cp, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noLinks } from './safety.js';

export async function install(target: string, scope: string, project: string): Promise<string[]> {
  if (!['codex', 'claude', 'both'].includes(target)) throw new Error('--target must be codex, claude, or both');
  if (!['project', 'user'].includes(scope)) throw new Error('--scope must be project or user');
  const root = await realpath(scope === 'user' ? homedir() : resolve(project));
  const platforms = target === 'both' ? ['codex', 'claude'] : [target];
  const destinations = platforms.map(platform => join(root, platform === 'codex' ? '.agents' : '.claude', 'skills', 'repfix'));
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const destination of destinations) {
    await noLinks(destination);
    try { await lstat(destination); throw new Error(`Install destination already exists: ${destination}. Review and move it aside before upgrading.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const created: string[] = [];
  try {
    for (const destination of destinations) {
      await mkdir(dirname(destination), { recursive: true });
      await mkdir(destination);
      created.push(destination);
      for (const entry of await readdir(source)) {
        await cp(join(source, entry), join(destination, entry), { recursive: true, force: false, errorOnExist: true, dereference: false });
      }
    }
  } catch (error) {
    for (const destination of created) await rm(destination, { recursive: true });
    throw error;
  }
  return destinations;
}
