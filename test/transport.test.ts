import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createHttpApp, listenHttp } from '../src/http.js';
import { createBridgeClient } from '../src/bridge-client.js';
import { startBridge } from '../vortex-extension/bridge.js';
import { schemas } from '../src/operations.js';

test('bridge authenticates native callers, validates operations, and keeps tokens out of results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-mcp-'));
  const bridge = await startBridge(directory, async (operation, input) => ({ operation, input }));
  try {
    const descriptor = JSON.parse(await readFile(bridge.file, 'utf8')) as { token: string };
    const url = `http://127.0.0.1:${bridge.port}/rpc`;
    const body = JSON.stringify({ operation: 'vortex_status', input: {} });
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${descriptor.token}` };
    assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', body, headers: { ...headers, origin: 'https://evil.test' } })).status, 403);
    // Fetch intentionally rewrites Host; use raw HTTP to test DNS rebinding protection.
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(url, { method: 'POST', headers: { ...headers, host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end(body);
    });
    assert.equal(badHost, 403);
    assert.equal((await fetch(url, { method: 'POST', body: '{', headers })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ payload: 'x'.repeat(65_536) }), headers })).status, 413);
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ operation: 'arbitrary_command', input: {} }), headers })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ operation: 'nexus_mod', input: { game: '../users', modId: 1 } }), headers })).status, 400);
    const result = await createBridgeClient(bridge.file)('vortex_status', {});
    assert.deepEqual(result, { operation: 'vortex_status', input: {} });
    assert.equal(JSON.stringify(result).includes(descriptor.token), false);
  } finally { await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});

test('bridge discovery does not allow an arbitrary outbound URL and reports missing Vortex', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-mcp-'));
  try {
    const file = join(directory, 'bridge.json');
    await writeFile(file, JSON.stringify({ version: 1, url: 'https://evil.test', token: 'a'.repeat(64) }));
    let called = false;
    const client = createBridgeClient(file, async () => { called = true; throw new Error('unexpected'); });
    await assert.rejects(client('vortex_status', {}), { code: 'bridge_unavailable' });
    assert.equal(called, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function freePort() {
  const server = createNetServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

for (const mode of ['legacy', 'auto'] as const) test(`Elysia HTTP serves ${mode} MCP discovery and calls with local bearer protection`, async () => {
  const port = await freePort(); const token = 't'.repeat(40);
  const app = listenHttp(createHttpApp(async (operation, input) => ({ operation, input }), token), port);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode } });
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://evil.test' } })).status, 403);
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
    const actualServer = app.server as unknown as { raw: { node: { server: { address(): AddressInfo } } } };
    assert.equal(actualServer.raw.node.server.address().address, '127.0.0.1');
    const tools = await client.listTools();
    assert.equal(tools.tools.length, Object.keys(schemas).length);
    const result = await client.callTool({ name: 'vortex_status', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]?.type, 'text');
    const invalid = await client.callTool({ name: 'nexus_mod', arguments: { game: '../bad', modId: 1 } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await app.stop(); }
});

for (const mode of ['legacy', 'auto'] as const) test(`stdio serves ${mode} MCP and redacts unavailable bridge errors`, async () => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', resolve('src/cli.ts')], env: { ...process.env as Record<string, string>, NEXUS_API_KEY: '', VORTEX_BRIDGE_FILE: resolve('test/missing-bridge.json') }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' }, { versionNegotiation: { mode } });
  try {
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
    assert.equal((await client.listTools()).tools.length, Object.keys(schemas).length);
    const result = await client.callTool({ name: 'vortex_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.content[0]?.type, 'text');
    if (result.content[0]?.type === 'text') assert.ok(result.content[0].text.includes('bridge_unavailable'));
  } finally { await client.close(); }
});
