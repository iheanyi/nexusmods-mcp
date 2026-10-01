import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist/vortex-extension', { recursive: true });
await build({ entryPoints: ['vortex-extension/index.ts'], outfile: 'dist/vortex-extension/index.js',
  platform: 'node', target: 'node18', format: 'cjs', bundle: true, minify: true, external: ['vortex-api'] });
await copyFile('vortex-extension/info.json', 'dist/vortex-extension/info.json');
// The root is ESM; the extension directory is loaded as CommonJS by Vortex.
await copyFile('scripts/extension-package.json', 'dist/vortex-extension/package.json');
await copyFile('LICENSE', 'dist/vortex-extension/LICENSE');
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/vortex-extension/THIRD_PARTY_NOTICES.md');
