import { Elysia } from 'elysia';
import { node } from '@elysia/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { tokenMatches } from './security.js';
import { createServer } from './mcp.js';
import type { Executor } from './operations.js';

export function localRequestAllowed(request: Request) {
  const host = request.headers.get('host') ?? '';
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
  // Native MCP clients have no Origin. Browser callers are intentionally excluded.
  return request.headers.get('origin') === null;
}

export function createHttpApp(execute: Executor, token: string) {
  if (token.length < 32) throw new Error('MCP_HTTP_TOKEN must be at least 32 characters.');
  const handler = createMcpHandler(() => createServer(execute), { maxRequestBodySize: 64 * 1024 });
  return new Elysia({ adapter: node() })
    .onRequest(({ request }) => {
      if (!localRequestAllowed(request)) return new Response('Forbidden', { status: 403 });
      if (!tokenMatches(request.headers.get('authorization'), token)) return new Response('Unauthorized', { status: 401 });
    })
    .get('/health', () => ({ status: 'ok', server: 'nexusmods-mcp' }))
    .all('/mcp', ({ request }) => handler.fetch(request), { parse: 'none' });
}

export function listenHttp(app: ReturnType<typeof createHttpApp>, port: number) {
  // The published Node adapter supplies the server to the callback but does not
  // assign app.server. Keep Elysia's shutdown API connected to that server.
  app.listen({ port, hostname: '127.0.0.1' }, server => { app.server = server; });
  return app;
}
