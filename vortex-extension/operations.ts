import { AppError } from '../src/errors.js';
import { executeNexus, sanitizeAccount, type NexusAuth, type NexusRequest, requestNexus } from '../src/nexus.js';
import { paginate, parseInput, type Executor, type Operation } from '../src/operations.js';
import { Jobs } from './jobs.js';
import type { EnableMods, Profile, VortexApi, VortexState } from './types.js';

function profile(state: VortexState, id: string, active = false): Profile {
  const found = state.persistent?.profiles?.[id];
  if (!found) throw new AppError('profile_not_found', 'Vortex profile does not exist.', 404);
  // Vortex keeps nextProfileId equal to activeProfileId once a switch settles.
  // A different target (including undefined during deactivation) is in progress.
  if (active && (state.settings?.profiles?.activeProfileId !== id || state.settings?.profiles?.nextProfileId !== id)) {
    throw new AppError('profile_not_active', 'Activate this profile in Vortex and wait for the switch to finish before mutating mods.', 409);
  }
  return found;
}

function installedMod(state: VortexState, gameId: string, modId: string) {
  const mod = state.persistent?.mods?.[gameId]?.[modId];
  if (!mod || mod.state !== 'installed') throw new AppError('mod_not_installed', 'No installed mod with that local ID in this game.', 404);
  return mod;
}

export function accountStatus(api: VortexApi) {
  const state = api.getState();
  const account = state.confidential?.account?.nexus;
  return { authenticated: Boolean(account?.OAuthCredentials?.token || account?.APIKey), source: 'vortex',
    method: account?.OAuthCredentials?.token ? 'oauth' : account?.APIKey ? 'api-key' : null,
    ...sanitizeAccount(state.persistent?.nexus?.userInfo ?? {}) };
}

function tokenExpiresSoon(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now() + 30_000;
  } catch { return false; }
}

async function sessionAuth(api: VortexApi): Promise<NexusAuth> {
  let account = api.getState().confidential?.account?.nexus;
  const token = account?.OAuthCredentials?.token;
  if (token && tokenExpiresSoon(token)) {
    // Ask the owner of the session to refresh it. Never copy/use its refresh token.
    // Vortex's public event is fire-and-forget; observe state rather than invoke private modules.
    api.events.emit('refresh-user-info');
    const deadline = Date.now() + 10_000;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      account = api.getState().confidential?.account?.nexus;
      if (account?.OAuthCredentials?.token !== token) break;
    } while (Date.now() < deadline);
  }
  account = api.getState().confidential?.account?.nexus;
  const fresh = account?.OAuthCredentials?.token;
  if (fresh) {
    if (tokenExpiresSoon(fresh)) throw new AppError('auth_expired', 'Vortex has not refreshed its session. Refresh/sign in inside Vortex, then retry this read.', 401);
    return { bearer: fresh };
  }
  if (account?.APIKey) return { apiKey: account.APIKey };
  throw new AppError('not_authenticated', 'Sign in to Nexus Mods inside Vortex.', 401);
}

function requireEvent(api: VortexApi, event: string) {
  if (!api.events.listenerCount(event)) throw new AppError('unsupported_vortex_version', `Vortex does not provide ${event}. Update Vortex.`, 501);
}

function callbackEvent(api: VortexApi, event: string, argsBefore: unknown[], argsAfter: unknown[] = []): Promise<string | undefined> {
  requireEvent(api, event);
  return new Promise((resolve, reject) => {
    api.events.emit(event, ...argsBefore, (err: unknown, result?: string) => err ? reject(err) : resolve(result), ...argsAfter);
  });
}

export function createVortexExecutor(api: VortexApi, enableMods: EnableMods, upstream: NexusRequest = requestNexus, jobs = new Jobs()): Executor {
  const run = async (operation: Operation, input: unknown, signal?: AbortSignal): Promise<unknown> => {
    // Revalidate at the Vortex boundary as well as in MCP.
    parseInput(operation, input);
    const state = api.getState();
    switch (operation) {
      case 'nexus_account': return accountStatus(api);
      case 'nexus_mod': {
        const a = parseInput(operation, input);
        if (!accountStatus(api).authenticated) throw new AppError('not_authenticated', 'Sign in to Nexus Mods inside Vortex.', 401);
        if (api.ext.nexusGetModInfo) {
          const data = await api.ext.nexusGetModInfo(a.game, a.modId);
          if (!data || typeof data !== 'object' || Object.keys(data).length === 0) throw new AppError('vortex_read_failed', 'Vortex could not retrieve the mod. Check its notifications.', 502);
          return { data, source: 'vortex-client' };
        }
        break;
      }
      case 'nexus_mod_files': {
        const a = parseInput(operation, input);
        if (!accountStatus(api).authenticated) throw new AppError('not_authenticated', 'Sign in to Nexus Mods inside Vortex.', 401);
        if (api.ext.nexusGetModFiles) return { ...paginate(await api.ext.nexusGetModFiles(a.game, a.modId), a.offset, a.limit), source: 'vortex-client' };
        break;
      }
      case 'nexus_mod_feed': {
        const a = parseInput(operation, input);
        if (!accountStatus(api).authenticated) throw new AppError('not_authenticated', 'Sign in to Nexus Mods inside Vortex.', 401);
        if (a.feed === 'trending' && api.ext.nexusGetTrendingMods) return { data: await api.ext.nexusGetTrendingMods(a.game), source: 'vortex-client' };
        if (a.feed === 'latest_added' && api.ext.nexusGetLatestMods) return { data: await api.ext.nexusGetLatestMods(a.game), source: 'vortex-client' };
        break;
      }
      case 'vortex_status': return { ...accountStatus(api), bridgeVersion: '0.1.0', activeProfileId: state.settings?.profiles?.activeProfileId ?? null };
      case 'vortex_games': {
        const known = state.session?.gameMode?.known ?? [];
        return { items: Object.entries(state.settings?.gameMode?.discovered ?? {}).filter(([, g]) => g.path).map(([gameId, g]) => {
          const game = known.find(k => k.id === gameId);
          return { gameId, name: g.name ?? game?.name ?? gameId, nexusDomain: game?.details?.nexusPageId ?? gameId };
        }) };
      }
      case 'vortex_profiles': {
        const a = parseInput(operation, input);
        return { items: Object.entries(state.persistent?.profiles ?? {}).filter(([, p]) => !a.gameId || p.gameId === a.gameId)
          .map(([profileId, p]) => ({ profileId, name: p.name, gameId: p.gameId, active: state.settings?.profiles?.activeProfileId === profileId })) };
      }
      case 'vortex_mods': {
        const a = parseInput(operation, input); const p = profile(state, a.profileId);
        return paginate(Object.entries(state.persistent?.mods?.[p.gameId] ?? {}).map(([modId, mod]) => ({
          modId, name: mod.attributes?.customFileName ?? mod.attributes?.name ?? modId,
          state: mod.state, enabled: p.modState?.[modId]?.enabled ?? false,
          nexusModId: mod.attributes?.modId, nexusFileId: mod.attributes?.fileId, version: mod.attributes?.version,
        })), a.offset, a.limit);
      }
      case 'vortex_downloads': {
        const a = parseInput(operation, input);
        const files = Object.entries(state.persistent?.downloads?.files ?? {}).filter(([, d]) => !a.gameId || (Array.isArray(d.game) ? d.game.includes(a.gameId) : d.game === a.gameId));
        return paginate(files.map(([downloadId, d]) => ({ downloadId, state: d.state, gameIds: d.game,
          size: d.size, received: d.received, nexusModId: d.modInfo?.nexus?.ids?.modId,
          nexusFileId: d.modInfo?.nexus?.ids?.fileId })), a.offset, a.limit);
      }
      case 'vortex_job': return jobs.get(parseInput(operation, input).jobId);
      case 'vortex_download_mod': {
        const a = parseInput(operation, input);
        if (!state.settings?.gameMode?.discovered?.[a.gameId]?.path) throw new AppError('game_not_discovered', 'Discover/manage this game in Vortex first.', 409);
        if (!api.ext.nexusDownload) throw new AppError('unsupported_vortex_version', 'Vortex Nexus integration is unavailable.', 501);
        return jobs.enqueue(operation, async () => {
          const downloadId = await api.ext.nexusDownload!(a.gameId, a.modId, a.fileId, undefined, false);
          if (!downloadId) throw new AppError('download_canceled', 'Vortex did not start a download. Check its dialogs and notifications.');
          return { downloadId, note: 'Check vortex_downloads for completion before installing.' };
        });
      }
      case 'vortex_install_download': {
        const a = parseInput(operation, input);
        const validate = () => {
          const current = api.getState(); const p = profile(current, a.profileId, true);
          const dl = current.persistent?.downloads?.files?.[a.downloadId];
          if (!dl || dl.state !== 'finished') throw new AppError('download_not_finished', 'Download must be finished before installation.', 409);
          if (!(Array.isArray(dl.game) ? dl.game.includes(p.gameId) : dl.game === p.gameId)) throw new AppError('game_mismatch', 'Download belongs to a different game than this profile.', 409);
        };
        validate(); requireEvent(api, 'start-install-download');
        return jobs.enqueue(operation, async () => {
          validate();
          const modId = await callbackEvent(api, 'start-install-download', [a.downloadId, { allowAutoEnable: false, profileId: a.profileId }]);
          if (!modId) throw new AppError('installation_canceled', 'Vortex installer did not return an installed mod ID.');
          return { modId, profileId: a.profileId };
        });
      }
      case 'vortex_set_mod_enabled': {
        const a = parseInput(operation, input);
        const validate = () => { const s = api.getState(); const p = profile(s, a.profileId, true); installedMod(s, p.gameId, a.modId); };
        validate();
        return jobs.enqueue(operation, async () => {
          validate(); await enableMods(api, a.profileId, [a.modId], a.enabled);
          // Vortex's helper can swallow errors; verify the observable result.
          if ((api.getState().persistent?.profiles?.[a.profileId]?.modState?.[a.modId]?.enabled ?? false) !== a.enabled) {
            throw new AppError('state_not_changed', 'Vortex did not change the enabled state. Check its notifications.', 409);
          }
          return { ...a };
        });
      }
      case 'vortex_deploy': {
        const a = parseInput(operation, input); profile(state, a.profileId, true); requireEvent(api, 'deploy-mods');
        return jobs.enqueue(operation, async () => {
          profile(api.getState(), a.profileId, true);
          await callbackEvent(api, 'deploy-mods', [], [a.profileId]);
          return { profileId: a.profileId, deployed: true };
        });
      }
      case 'vortex_remove_mod': {
        const a = parseInput(operation, input);
        const validate = () => { const s = api.getState(); const p = profile(s, a.profileId, true); installedMod(s, p.gameId, a.modId); return p.gameId; };
        validate(); requireEvent(api, 'remove-mod');
        return jobs.enqueue(operation, async () => {
          const gameId = validate();
          await callbackEvent(api, 'remove-mod', [gameId, a.modId]);
          if (api.getState().persistent?.mods?.[gameId]?.[a.modId]) throw new AppError('mod_not_removed', 'Vortex did not remove the mod.', 409);
          return { gameId, modId: a.modId, removed: true, affectsAllProfiles: true };
        });
      }
    }
    if (operation.startsWith('nexus_')) return executeNexus(operation, input, await sessionAuth(api), signal, upstream);
    throw new AppError('unsupported_operation', 'Unsupported operation.');
  };
  return run;
}
