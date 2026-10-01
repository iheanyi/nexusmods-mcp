import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Executor } from './operations.js';

export const descriptorSchema = z.object({ version: z.literal(1), port: z.number().int().min(1).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/) });

export function bridgeFileCandidates(env = process.env, platform: NodeJS.Platform = process.platform, home = homedir()) {
  if (env.VORTEX_BRIDGE_FILE) return [env.VORTEX_BRIDGE_FILE];
  const path = platform === 'win32' ? win32 : posix;
  const appData = platform === 'win32'
    ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME || path.join(home, '.config');
  // Windows ignores directory case; POSIX does not. Vortex installations may
  // use either product-name or package-name casing for their userData directory.
  const names = platform === 'win32' ? ['Vortex'] : ['Vortex', 'vortex'];
  return names.map(name => path.join(appData, name, 'nexusmods-mcp', 'bridge.json'));
}

export function defaultBridgeFile(env = process.env) {
  return bridgeFileCandidates(env)[0]!;
}

export function createBridgeClient(file?: string, fetcher = fetch): Executor {
  return async (operation, input, signal) => {
    let descriptor: z.infer<typeof descriptorSchema> | undefined;
    for (const candidate of file ? [file] : bridgeFileCandidates()) {
      try { descriptor = descriptorSchema.parse(JSON.parse(await readFile(candidate, 'utf8'))); break; }
      catch { /* Try the other conventional directory casing. */ }
    }
    if (!descriptor) throw new AppError('bridge_unavailable', 'Start Vortex with the Nexus Mods MCP Bridge extension enabled. For portable, Wine, or sandboxed Vortex, set VORTEX_BRIDGE_FILE.', 503);
    let response: Response;
    try {
      response = await fetcher(`http://127.0.0.1:${descriptor.port}/rpc`, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${descriptor.token}` },
        body: JSON.stringify({ operation, input }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
      });
    } catch { throw new AppError('bridge_unavailable', 'Vortex bridge did not respond. Check that Vortex is running. Do not repeat a mutation until its job state is known.', 503); }
    let result: { result?: unknown; error?: { code: string; message: string } };
    try { result = await response.json() as typeof result; }
    catch { throw new AppError('bridge_invalid_response', 'Invalid response from the Vortex bridge.', 502); }
    if (!response.ok || result.error) {
      throw new AppError(result.error?.code ?? 'bridge_failed', result.error?.message ?? 'Vortex bridge rejected the request.', response.status);
    }
    return result.result;
  };
}
