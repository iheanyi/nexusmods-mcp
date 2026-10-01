import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, publicError } from '../src/errors.js';
import { schemas, type Executor, type Operation } from '../src/operations.js';
import { tokenMatches } from '../src/security.js';

const envelope = z.object({ operation: z.enum(Object.keys(schemas) as [Operation, ...Operation[]]), input: z.unknown() });

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new AppError('body_too_large', 'Request exceeded 64 KiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new AppError('invalid_json', 'Request must contain JSON.'); }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function startBridge(userData: string, execute: Executor) {
  const token = randomBytes(32).toString('hex');
  const directory = join(userData, 'nexusmods-mcp');
  const file = join(directory, 'bridge.json');
  const server = createServer((req, res) => {
    void (async () => {
      const host = req.headers.host;
      // No CORS, browser access or DNS-rebinding hostnames.
      if (!host || !/^127\.0\.0\.1:\d+$/.test(host) || req.headers.origin !== undefined) {
        send(res, 403, { error: { code: 'forbidden', message: 'Local native clients only.' } }); return;
      }
      if (!tokenMatches(req.headers.authorization, token)) {
        send(res, 401, { error: { code: 'unauthorized', message: 'Bridge token required.' } }); return;
      }
      if (req.method !== 'POST' || req.url !== '/rpc') {
        send(res, 404, { error: { code: 'not_found', message: 'Use POST /rpc.' } }); return;
      }
      try {
        const body = envelope.safeParse(await readBody(req));
        if (!body.success) throw new AppError('invalid_input', 'Unknown operation or invalid request.');
        const parsed = schemas[body.data.operation].safeParse(body.data.input);
        if (!parsed.success) throw new AppError('invalid_input', 'Invalid operation parameters.');
        const result = await execute(body.data.operation, parsed.data);
        send(res, 200, { result });
      } catch (err) { send(res, err instanceof AppError ? err.status : 500, { error: publicError(err) }); }
    })().catch(() => { if (!res.writableEnded) send(res, 500, { error: publicError(undefined) }); });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No bridge port allocated.');
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, port: address.port, token }), { mode: 0o600 });
    await rename(temporary, file);
  } catch (err) { server.close(); throw err; }
  return {
    port: address.port, file,
    closeOnExit() {
      // Process exit does not run asynchronous filesystem work.
      server.close();
      try { const current = JSON.parse(readFileSync(file, 'utf8')) as { token?: string }; if (current.token === token) unlinkSync(file); }
      catch { /* Already cleaned up or replaced. */ }
    },
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      try { const current = JSON.parse(await readFile(file, 'utf8')) as { token?: string }; if (current.token === token) await unlink(file); }
      catch { /* Already cleaned up or replaced by a new Vortex process. */ }
    },
  };
}
