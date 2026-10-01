#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createBridgeClient } from './bridge-client.js';
import { createServer } from './mcp.js';
import { executeNexus } from './nexus.js';
import { parseInput, type Executor } from './operations.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('nexusmods-mcp [--http]\nDefault: stdio, reusing Vortex. Optional NEXUS_API_KEY enables standalone Nexus catalogue access.\nHTTP: loopback only; requires MCP_HTTP_TOKEN (32+ characters), optional MCP_PORT (default 7331).');
} else {
  if (args.some(a => a !== '--http')) throw new Error('Unknown argument. Use --help.');
  const bridge = createBridgeClient();
  const execute: Executor = async (operation, input, signal) => {
    const validated = parseInput(operation, input);
    if (operation.startsWith('nexus_') && process.env.NEXUS_API_KEY) {
      return executeNexus(operation, validated, { apiKey: process.env.NEXUS_API_KEY }, signal);
    }
    return bridge(operation, validated, signal);
  };
  if (args.includes('--http')) {
    const token = process.env.MCP_HTTP_TOKEN;
    if (!token) throw new Error('Set MCP_HTTP_TOKEN to a random secret of at least 32 characters.');
    const port = Number(process.env.MCP_PORT ?? 7331);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MCP_PORT must be between 1 and 65535.');
    const { createHttpApp, listenHttp } = await import('./http.js');
    const app = listenHttp(createHttpApp(execute, token), port);
    console.error(`Nexus Mods MCP listening at http://127.0.0.1:${port}/mcp`);
    const stop = async () => { await app.stop(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else {
    const handle = serveStdio(() => createServer(execute));
    const stop = async () => { await handle.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
}
