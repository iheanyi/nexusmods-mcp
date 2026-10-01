import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Enumerate files in Node so test discovery does not depend on shell globbing.
const files = (await readdir('test')).filter(name => name.endsWith('.test.ts')).sort().map(name => join('test', name));
if (!files.length) throw new Error('No test files found.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
