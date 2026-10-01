import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeNexus, nexusPath, projectNexus, sanitizeAccount } from '../src/nexus.js';
import { AppError, publicError } from '../src/errors.js';
import { schemas } from '../src/operations.js';

test('builds documented v1 and v3 paths with distinct ID scopes', () => {
  assert.equal(nexusPath('nexus_mod', { game: 'skyrimspecialedition', modId: 42 }), '/v1/games/skyrimspecialedition/mods/42.json');
  assert.equal(nexusPath('nexus_v3_mod', { game: 'fallout4', modId: 42 }), '/v3/games/fallout4/mods/42');
  assert.equal(nexusPath('nexus_v3_files', { modUid: '900001' }), '/v3/mods/900001/files');
  assert.equal(nexusPath('nexus_v3_dependencies', { fileVersionId: '900002', resolved: true }), '/v3/mod-file-versions/900002/dependencies/ranges/materialized');
  assert.equal(nexusPath('nexus_v3_dependencies', { fileVersionId: 'version_abc-123' }), '/v3/mod-file-versions/version_abc-123/dependencies');
  assert.throws(() => nexusPath('nexus_mod', { game: '../users', modId: 1 }));
  assert.throws(() => nexusPath('nexus_mod', { game: 'https://evil.test', modId: 1 }));
  assert.throws(() => nexusPath('nexus_v3_files', { modUid: '../users' }));
});

test('free-user download parameters are paired and encoded', () => {
  assert.equal(schemas.nexus_download_links.safeParse({ game: 'skyrim', modId: 1, fileId: 2, key: 'a' }).success, false);
  assert.equal(nexusPath('nexus_download_links', { game: 'skyrim', modId: 1, fileId: 2, key: 'a&b', expires: 123 }), '/v1/games/skyrim/mods/1/files/2/download_link.json?key=a%26b&expires=123');
});

test('account projection drops the API key and personal fields', () => {
  const input = { user_id: 5, name: 'test', is_premium: true, key: 'SECRET', email: 'private@example.test', APIKey: 'SECRET' };
  const projected = projectNexus('nexus_account', {}, { data: input, rateLimit: {} });
  assert.equal(JSON.stringify(projected).includes('SECRET'), false);
  assert.equal(JSON.stringify(projected).includes('private@'), false);
  assert.equal(sanitizeAccount(input).userId, 5);
});

test('paginates and filters catalogues without inventing an upstream search endpoint', () => {
  const data = [{ name: 'Skyrim', domain_name: 'skyrim' }, { name: 'Skyrim SE', domain_name: 'skyrimspecialedition' }, { name: 'Fallout 4', domain_name: 'fallout4' }];
  const result = projectNexus('nexus_games', { query: 'skyrim', offset: 0, limit: 1 }, { data, rateLimit: { 'x-rl-daily-remaining': '99' } });
  assert.deepEqual(result, { items: [data[0]], total: 2, nextOffset: 1, rateLimit: { 'x-rl-daily-remaining': '99' } });
});

test('uses authenticated fixed upstream operations and preserves rate limit failures without retry', async () => {
  let calls = 0;
  const upstream = async (path: string) => {
    calls++;
    assert.equal(path, '/v3/games/skyrim/mods/1');
    throw new AppError('nexus_http_429', 'Rate limited', 429, { rateLimit: { 'retry-after': '60' } });
  };
  await assert.rejects(executeNexus('nexus_v3_mod', { game: 'skyrim', modId: 1 }, undefined, undefined, upstream), { code: 'not_authenticated' });
  assert.equal(calls, 0);
  await assert.rejects(executeNexus('nexus_v3_mod', { game: 'skyrim', modId: 1 }, { apiKey: 'secret' }, undefined, upstream), { code: 'nexus_http_429' });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(publicError(new Error('apikey=SECRET'))).includes('SECRET'), false);
});
