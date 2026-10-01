import { readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const entries = {};
for (const name of ['index.js', 'info.json', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  entries[name] = new Uint8Array(await readFile(`dist/vortex-extension/${name}`));
}
await writeFile('dist/nexusmods-mcp-bridge.zip', zipSync(entries, { level: 9 }));
console.log('Created dist/nexusmods-mcp-bridge.zip');
