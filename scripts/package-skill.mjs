import { chmod, copyFile, writeFile } from 'node:fs/promises';
await writeFile('skills/repfix/scripts/package.json', '{"type":"module"}\n');
await copyFile('LICENSE', 'skills/repfix/scripts/LICENSE');
await chmod('skills/repfix/scripts/cli.js', 0o755);
