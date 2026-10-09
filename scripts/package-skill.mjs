import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('skills/repfix/scripts/package.json', `${JSON.stringify({ type: 'module', version })}\n`);
await copyFile('LICENSE', 'skills/repfix/scripts/LICENSE');
await chmod('skills/repfix/scripts/cli.js', 0o755);
