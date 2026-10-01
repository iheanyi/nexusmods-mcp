import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeFileCandidates } from '../src/bridge-client.js';

test('Windows discovery uses APPDATA or the user Roaming directory', () => {
  assert.deepEqual(bridgeFileCandidates({ APPDATA: 'D:\\Settings' }, 'win32', 'C:\\Users\\Tester'), [
    'D:\\Settings\\Vortex\\nexusmods-mcp\\bridge.json',
  ]);
  assert.deepEqual(bridgeFileCandidates({}, 'win32', 'C:\\Users\\Tester'), [
    'C:\\Users\\Tester\\AppData\\Roaming\\Vortex\\nexusmods-mcp\\bridge.json',
  ]);
});

test('macOS discovery uses Application Support and checks directory casing', () => {
  assert.deepEqual(bridgeFileCandidates({}, 'darwin', '/Users/tester'), [
    '/Users/tester/Library/Application Support/Vortex/nexusmods-mcp/bridge.json',
    '/Users/tester/Library/Application Support/vortex/nexusmods-mcp/bridge.json',
  ]);
});

test('Linux discovery honors XDG_CONFIG_HOME without using Windows APPDATA', () => {
  assert.deepEqual(bridgeFileCandidates({ XDG_CONFIG_HOME: '/data/config', APPDATA: 'C:\\Windows' }, 'linux', '/home/tester'), [
    '/data/config/Vortex/nexusmods-mcp/bridge.json', '/data/config/vortex/nexusmods-mcp/bridge.json',
  ]);
  assert.deepEqual(bridgeFileCandidates({}, 'linux', '/home/tester'), [
    '/home/tester/.config/Vortex/nexusmods-mcp/bridge.json', '/home/tester/.config/vortex/nexusmods-mcp/bridge.json',
  ]);
});

test('explicit bridge paths work unchanged for custom, Wine, and sandboxed installs', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    assert.deepEqual(bridgeFileCandidates({ VORTEX_BRIDGE_FILE: '/custom path/bridge.json' }, platform, '/ignored'), ['/custom path/bridge.json']);
  }
});
