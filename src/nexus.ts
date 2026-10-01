import { request } from 'node:https';
import { AppError } from './errors.js';
import { paginate, parseInput, type Operation } from './operations.js';

export type NexusAuth = { apiKey: string } | { bearer: string };
export interface NexusResponse { data: unknown; rateLimit: Record<string, string>; }
export type NexusRequest = (path: string, auth?: NexusAuth, signal?: AbortSignal) => Promise<NexusResponse>;

// Fixed upstream, no redirects: session credentials can never be sent to another host.
export const requestNexus: NexusRequest = (path, auth, signal) => new Promise((resolve, reject) => {
  const headers: Record<string, string> = {
    accept: 'application/json', 'user-agent': `nexusmods-mcp/0.1.0 (${process.platform}; ${process.arch}) Node/${process.versions.node}`,
    application_name: 'nexusmods-mcp', application_version: '0.1.0',
  };
  if (auth) {
    if ('apiKey' in auth) headers.apikey = auth.apiKey;
    else headers.authorization = `Bearer ${auth.bearer}`;
  }
  const req = request({ hostname: 'api.nexusmods.com', port: 443, path, method: 'GET', headers, signal }, res => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) req.destroy(new AppError('response_too_large', 'Nexus response exceeded 8 MiB.', 502));
      else chunks.push(chunk);
    });
    res.on('error', () => reject(new AppError('upstream_unavailable', 'Nexus response was interrupted.', 502)));
    res.on('end', () => {
      const rateLimit: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if ((key.startsWith('x-rl-') || key === 'retry-after') && typeof value === 'string') rateLimit[key] = value;
      }
      const status = res.statusCode ?? 502;
      if (status < 200 || status >= 300) {
        const messages: Record<number, string> = {
          401: 'Nexus authentication expired or is invalid. Sign in again in Vortex or check your API key.',
          403: 'Nexus denied access. Downloads may require Premium or a website-generated NXM key and expiry.',
          404: 'Nexus resource was not found. Check the game domain and identifier type.',
          410: 'The website download link expired. Obtain a new NXM link.',
          429: 'Nexus rate limit reached. Wait until the reported reset; no automatic retry was attempted.',
        };
        reject(new AppError(`nexus_http_${status}`, messages[status] ?? `Nexus returned HTTP ${status}.`, status, { rateLimit }));
        return;
      }
      try { resolve({ data: JSON.parse(Buffer.concat(chunks).toString('utf8')), rateLimit }); }
      catch { reject(new AppError('invalid_upstream_response', 'Nexus returned invalid JSON.', 502)); }
    });
  });
  req.setTimeout(30_000, () => req.destroy(new AppError('upstream_timeout', 'Nexus request timed out.', 504)));
  req.on('error', err => reject(err instanceof AppError ? err : new AppError('upstream_unavailable', 'Could not reach Nexus Mods.', 502)));
  req.end();
});

// Paths are constructed only from validated IDs. No generic request or arbitrary URL tool.
export function nexusPath(operation: Operation, input: unknown): string {
  switch (operation) {
    case 'nexus_account': return '/v1/users/validate.json';
    case 'nexus_games': return '/v1/games.json';
    case 'nexus_mod': { const a = parseInput(operation, input); return `/v1/games/${a.game}/mods/${a.modId}.json`; }
    case 'nexus_mod_files': { const a = parseInput(operation, input); return `/v1/games/${a.game}/mods/${a.modId}/files.json`; }
    case 'nexus_mod_feed': { const a = parseInput(operation, input); return `/v1/games/${a.game}/mods/${a.feed === 'trending' ? 'trending' : a.feed}.json`; }
    case 'nexus_download_links': {
      const a = parseInput(operation, input);
      const query = a.key ? `?${new URLSearchParams({ key: a.key, expires: String(a.expires) })}` : '';
      return `/v1/games/${a.game}/mods/${a.modId}/files/${a.fileId}/download_link.json${query}`;
    }
    case 'nexus_v3_mod': { const a = parseInput(operation, input); return `/v3/games/${a.game}/mods/${a.modId}`; }
    case 'nexus_v3_files': { const a = parseInput(operation, input); return `/v3/mods/${a.modUid}/files`; }
    case 'nexus_v3_file_version': { const a = parseInput(operation, input); return `/v3/games/${a.game}/mod-file-versions/${a.fileId}`; }
    case 'nexus_v3_dependencies': {
      const a = parseInput(operation, input);
      return `/v3/mod-file-versions/${a.fileVersionId}/dependencies${a.resolved ? '/ranges/materialized' : ''}`;
    }
    default: throw new AppError('unsupported_operation', 'This operation requires the Vortex bridge.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_upstream_response', 'Unexpected Nexus response shape.', 502);
  return value as Record<string, unknown>;
}

export function sanitizeAccount(value: unknown) {
  const user = record(value);
  return { userId: user.user_id ?? user.userId, name: user.name ?? user.username,
    premium: user.is_premium ?? user.isPremium, supporter: user.is_supporter ?? user.isSupporter };
}

export function projectNexus(operation: Operation, input: unknown, response: NexusResponse) {
  const { data, rateLimit } = response;
  if (operation === 'nexus_account') return { authenticated: true, source: 'api-key', ...sanitizeAccount(data), rateLimit };
  if (operation === 'nexus_games') {
    const a = parseInput(operation, input);
    if (!Array.isArray(data)) throw new AppError('invalid_upstream_response', 'Expected a Nexus games array.', 502);
    const query = a.query?.toLowerCase();
    const games = data.filter(v => !query || `${v.name} ${v.domain_name}`.toLowerCase().includes(query));
    return { ...paginate(games, a.offset, a.limit), rateLimit };
  }
  if (operation === 'nexus_mod_files') {
    const a = parseInput(operation, input);
    const result = record(data);
    if (!Array.isArray(result.files)) throw new AppError('invalid_upstream_response', 'Expected a Nexus files array.', 502);
    return { ...paginate(result.files, a.offset, a.limit), fileUpdates: result.file_updates, rateLimit };
  }
  return { data, rateLimit };
}

export async function executeNexus(operation: Operation, input: unknown, auth?: NexusAuth, signal?: AbortSignal, upstream = requestNexus) {
  const path = nexusPath(operation, input);
  // Only the documented v3 trending/DLC feeds are public; none of our selected routes are.
  if (!auth) throw new AppError('not_authenticated', 'Sign in to Nexus in Vortex or set NEXUS_API_KEY.', 401);
  return projectNexus(operation, input, await upstream(path, auth, signal));
}
