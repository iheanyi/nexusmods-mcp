import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import { createVortexExecutor } from '../vortex-extension/operations.js';
import { Jobs, type Job } from '../vortex-extension/jobs.js';
import type { VortexApi, VortexState, EnableMods } from '../vortex-extension/types.js';

function fixture() {
  const state: VortexState = {
    confidential: { account: { nexus: { APIKey: 'PRIVATE_KEY' } } },
    persistent: { nexus: { userInfo: { userId: 7, name: 'Tester', isPremium: true, key: 'PRIVATE_KEY' } },
      profiles: { active: { name: 'Main', gameId: 'skyrimse', modState: { mod: { enabled: false } } }, other: { gameId: 'fallout4' } },
      mods: { skyrimse: { mod: { state: 'installed', attributes: { name: 'Test Mod', modId: 42, fileId: 99, version: '1.0' } } } },
      downloads: { files: { ready: { state: 'finished', game: ['skyrimse'], localPath: 'PRIVATE_PATH', modInfo: { nexus: { ids: { modId: 42, fileId: 99, key: 'PRIVATE_KEY' } } } },
        wrong: { state: 'finished', game: ['fallout4'] }, pending: { state: 'started', game: ['skyrimse'] } } } },
    settings: { profiles: { activeProfileId: 'active', nextProfileId: 'active' }, gameMode: { discovered: { skyrimse: { path: 'PRIVATE_PATH' } } } },
    session: { gameMode: { known: [{ id: 'skyrimse', name: 'Skyrim SE', details: { nexusPageId: 'skyrimspecialedition' } }] } },
  };
  const api: VortexApi = { getState: () => state, getPath: () => '', events: new EventEmitter(), ext: {},
    showErrorNotification: () => {}, sendNotification: () => {} };
  const enable: EnableMods = async (_, profileId, modIds, enabled) => {
    for (const modId of modIds) state.persistent!.profiles![profileId]!.modState![modId] = { enabled };
  };
  return { state, api, execute: createVortexExecutor(api, enable), enable };
}

test('projects Vortex state with local IDs and without keys or filesystem paths', async () => {
  const { execute } = fixture();
  const outputs = await Promise.all([
    execute('nexus_account', {}), execute('vortex_games', {}), execute('vortex_mods', { profileId: 'active' }), execute('vortex_downloads', {}),
  ]);
  const text = JSON.stringify(outputs);
  assert.equal(text.includes('PRIVATE'), false);
  assert.ok(text.includes('skyrimspecialedition'));
  assert.ok(text.includes('Test Mod'));
});

test('reuses Vortex client methods without returning its auth', async () => {
  const { api, execute } = fixture();
  api.ext.nexusGetModInfo = async (game, modId) => ({ name: `${game}/${modId}` });
  const output = await execute('nexus_mod', { game: 'skyrimspecialedition', modId: 42 });
  assert.deepEqual(output, { data: { name: 'skyrimspecialedition/42' }, source: 'vortex-client' });
});

test('API v3 uses live Vortex bearer auth internally and follows refreshed state', async () => {
  const { api, state, enable } = fixture();
  const jwt = (exp: number) => `a.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.b`;
  const old = jwt(1); const fresh = jwt(Date.now() / 1000 + 3600);
  state.confidential!.account!.nexus = { OAuthCredentials: { token: old } };
  api.events.on('refresh-user-info', () => { state.confidential!.account!.nexus!.OAuthCredentials = { token: fresh }; });
  let calls = 0;
  const execute = createVortexExecutor(api, enable, async (path, auth) => {
    calls++; assert.deepEqual(auth, { bearer: fresh }); assert.equal(path, '/v3/games/skyrim/mods/42');
    return { data: { name: 'Mod' }, rateLimit: {} };
  });
  assert.deepEqual(await execute('nexus_v3_mod', { game: 'skyrim', modId: 42 }), { data: { name: 'Mod' }, rateLimit: {} });
  assert.equal(calls, 1);
  state.confidential!.account!.nexus = {};
  await assert.rejects(execute('nexus_v3_mod', { game: 'skyrim', modId: 42 }), { code: 'not_authenticated' });
});

test('rejects profile/game/download mismatches before queuing writes', async () => {
  const { api, execute, state } = fixture();
  api.events.on('start-install-download', () => {});
  await assert.rejects(execute('vortex_install_download', { downloadId: 'wrong', profileId: 'active' }), { code: 'game_mismatch' });
  await assert.rejects(execute('vortex_install_download', { downloadId: 'pending', profileId: 'active' }), { code: 'download_not_finished' });
  await assert.rejects(execute('vortex_set_mod_enabled', { profileId: 'other', modId: 'mod', enabled: true }), { code: 'profile_not_active' });
  state.settings!.profiles!.nextProfileId = 'other';
  await assert.rejects(execute('vortex_set_mod_enabled', { profileId: 'active', modId: 'mod', enabled: true }), { code: 'profile_not_active' });
});

test('download jobs use Vortex ID and disable automatic installation', async () => {
  const { api, execute } = fixture();
  api.ext.nexusDownload = async (...args) => {
    assert.deepEqual(args, ['skyrimse', 42, 99, undefined, false]); return 'ready';
  };
  const job = await execute('vortex_download_mod', { gameId: 'skyrimse', modId: 42, fileId: 99 }) as Job;
  await tick();
  const result = await execute('vortex_job', { jobId: job.jobId }) as Job;
  assert.equal(result.state, 'succeeded');
  assert.equal((result.result as { downloadId: string }).downloadId, 'ready');
});

test('settled Vortex profile accepts mutations while deactivation is blocked', async () => {
  const { execute, state } = fixture();
  const job = await execute('vortex_set_mod_enabled', { profileId: 'active', modId: 'mod', enabled: true }) as Job;
  await tick();
  assert.equal((await execute('vortex_job', { jobId: job.jobId }) as Job).state, 'succeeded');
  state.settings!.profiles!.nextProfileId = undefined;
  await assert.rejects(execute('vortex_set_mod_enabled', { profileId: 'active', modId: 'mod', enabled: false }), { code: 'profile_not_active' });
});

test('installation and deployment pass actual Vortex callback positions', async () => {
  const { api, execute } = fixture();
  api.events.on('start-install-download', (downloadId, options, cb) => {
    assert.equal(downloadId, 'ready'); assert.deepEqual(options, { allowAutoEnable: false, profileId: 'active' }); cb(null, 'new-mod');
  });
  api.events.on('deploy-mods', (cb, profileId) => { assert.equal(typeof cb, 'function'); assert.equal(profileId, 'active'); cb(null); });
  const install = await execute('vortex_install_download', { downloadId: 'ready', profileId: 'active' }) as Job;
  const deploy = await execute('vortex_deploy', { profileId: 'active' }) as Job;
  await tick();
  assert.equal((await execute('vortex_job', { jobId: install.jobId }) as Job).state, 'succeeded');
  assert.equal((await execute('vortex_job', { jobId: deploy.jobId }) as Job).state, 'succeeded');
});

test('verifies enable state and removal completion', async () => {
  const { api, execute, state } = fixture();
  const enabled = await execute('vortex_set_mod_enabled', { profileId: 'active', modId: 'mod', enabled: true }) as Job;
  await tick();
  assert.equal((await execute('vortex_job', { jobId: enabled.jobId }) as Job).state, 'succeeded');
  api.events.on('remove-mod', (gameId, modId, cb) => { assert.equal(gameId, 'skyrimse'); delete state.persistent!.mods![gameId]![modId]; cb(null); });
  const removal = await execute('vortex_remove_mod', { profileId: 'active', modId: 'mod' }) as Job;
  await tick();
  assert.equal((await execute('vortex_job', { jobId: removal.jobId }) as Job).state, 'succeeded');
});

test('queued mutations recheck the active profile after earlier jobs finish', async () => {
  const { api, execute, state } = fixture();
  let finish!: () => void;
  api.ext.nexusDownload = () => new Promise<string>(resolve => { finish = () => resolve('ready'); });
  await execute('vortex_download_mod', { gameId: 'skyrimse', modId: 42, fileId: 99 });
  const second = await execute('vortex_set_mod_enabled', { profileId: 'active', modId: 'mod', enabled: true }) as Job;
  state.settings!.profiles!.activeProfileId = 'other';
  finish(); await tick();
  const result = await execute('vortex_job', { jobId: second.jobId }) as Job;
  assert.equal(result.state, 'failed'); assert.equal(result.error?.code, 'profile_not_active');
});

test('bounded job queue isolates errors and never runs writes in parallel', async () => {
  const jobs = new Jobs(); let finish!: () => void;
  const first = jobs.enqueue('first', () => new Promise(resolve => { finish = () => resolve('done'); }));
  let ran = false;
  const second = jobs.enqueue('second', async () => { ran = true; throw new Error('SECRET_KEY'); });
  await tick(); assert.equal(ran, false); assert.equal(jobs.get(first.jobId).state, 'running');
  finish(); await tick();
  assert.equal(jobs.get(second.jobId).state, 'failed');
  assert.equal(JSON.stringify(jobs.get(second.jobId)).includes('SECRET_KEY'), false);
  const bounded = new Jobs();
  for (let i = 0; i < 20; i++) bounded.enqueue('wait', () => new Promise(() => {}));
  assert.throws(() => bounded.enqueue('extra', async () => null), { code: 'queue_full' });
});
