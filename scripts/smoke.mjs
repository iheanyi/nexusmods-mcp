import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const require = createRequire(import.meta.url);
const extension = require('../dist/vortex-extension/index.js');
assert.equal(typeof extension.default, 'function');
const entries = unzipSync(await readFile('dist/nexusmods-mcp-bridge.zip'));
assert.deepEqual(Object.keys(entries).sort(), ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'index.js', 'info.json', 'package.json'].sort());
assert.equal(JSON.parse(Buffer.from(entries['info.json']).toString()).id, 'nexusmods-mcp-bridge');
assert.equal(JSON.parse(Buffer.from(entries['package.json']).toString()).type, 'commonjs');
const cli = spawnSync(process.execPath, ['dist/cli.js', '--help'], { encoding: 'utf8' });
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /nexusmods-mcp \[--http\]/);
console.log('Compiled CLI, Vortex bundle, and extension ZIP smoke checks passed.');
