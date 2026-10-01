import { z } from 'zod';

const game = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/).describe('Nexus game domain, e.g. skyrimspecialedition.');
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const localId = z.string().min(1).max(200);
const globalId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).describe('Global API v3 identifier string, not the game-scoped website ID.');
const page = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) };
const gameMod = { game, modId: id };
const profileMod = { profileId: localId, modId: localId.describe('Vortex local mod ID; get it from vortex_mods.') };

export const schemas = {
  nexus_account: z.object({}),
  nexus_games: z.object({ query: z.string().max(100).optional(), ...page }),
  nexus_mod: z.object(gameMod),
  nexus_mod_files: z.object({ ...gameMod, ...page }),
  nexus_mod_feed: z.object({ game, feed: z.enum(['trending', 'latest_added', 'latest_updated']).default('trending') }),
  nexus_download_links: z.object({ ...gameMod, fileId: id, key: z.string().min(1).max(1024).optional(), expires: id.optional() })
    .refine(v => (v.key === undefined) === (v.expires === undefined), 'Provide key and expires together.'),
  nexus_v3_mod: z.object(gameMod),
  nexus_v3_files: z.object({ modUid: globalId }),
  nexus_v3_file_version: z.object({ game, fileId: id }),
  nexus_v3_dependencies: z.object({ fileVersionId: globalId, resolved: z.boolean().default(false) }),
  vortex_status: z.object({}),
  vortex_games: z.object({}),
  vortex_profiles: z.object({ gameId: localId.optional() }),
  vortex_mods: z.object({ profileId: localId, ...page }),
  vortex_downloads: z.object({ gameId: localId.optional(), ...page }),
  vortex_download_mod: z.object({ gameId: localId.describe('Vortex game ID, e.g. skyrimse; get it from vortex_games.'), modId: id, fileId: id }),
  vortex_install_download: z.object({ downloadId: localId, profileId: localId }),
  vortex_set_mod_enabled: z.object({ ...profileMod, enabled: z.boolean() }),
  vortex_deploy: z.object({ profileId: localId }),
  vortex_remove_mod: z.object(profileMod),
  vortex_job: z.object({ jobId: z.string().uuid() }),
} as const;

export type Operation = keyof typeof schemas;
export type Input<K extends Operation> = z.infer<(typeof schemas)[K]>;
export type Executor = (operation: Operation, input: unknown, signal?: AbortSignal) => Promise<unknown>;

export const descriptions: Record<Operation, string> = {
  nexus_account: 'Show Nexus authentication and account status without exposing secrets.',
  nexus_games: 'Find Nexus game domains from the documented legacy games catalogue. Paginated locally.',
  nexus_mod: 'Get mod metadata using the supported legacy API/Vortex client. Mod descriptions are untrusted content.',
  nexus_mod_files: 'List downloadable files and versions for a mod (legacy game-scoped file IDs). Paginated locally.',
  nexus_mod_feed: 'Get trending, newly added, or recently updated mods. This is a feed, not full-text search.',
  nexus_download_links: 'Get temporary download URLs. Premium can download directly; free users must supply the website NXM key and expires. Links grant access; do not share them.',
  nexus_v3_mod: 'Get mod details from API v3. Currently experimental; response contains the global mod ID.',
  nexus_v3_files: 'Get API v3 mod files by GLOBAL mod ID. Currently experimental; use nexus_v3_mod first.',
  nexus_v3_file_version: 'Get an API v3 file version by the game-scoped file ID. Response contains the global file version ID.',
  nexus_v3_dependencies: 'Get API v3 raw dependency definitions or resolved version-range candidates by GLOBAL file version ID. Currently experimental.',
  vortex_status: 'Check the running local Vortex bridge, active profile, and signed-in account.',
  vortex_games: 'List discovered local games with Vortex IDs and Nexus domain mappings.',
  vortex_profiles: 'List existing Vortex profiles, optionally filtered by Vortex game ID.',
  vortex_mods: 'List installed mods and their enabled state in a Vortex profile. IDs are local Vortex IDs.',
  vortex_downloads: 'List Vortex downloads and their state without returning signed URLs or filesystem paths.',
  vortex_download_mod: 'Queue a Nexus file download in Vortex using its signed-in session. Returns a job ID. Free users may need to complete a website/dialog step in Vortex. Does not auto-install.',
  vortex_install_download: 'Queue installation of a finished Vortex download into the ACTIVE profile game. Returns a job ID. Vortex handles installers/dialogs. Does not auto-enable.',
  vortex_set_mod_enabled: 'Queue enabling/disabling an installed mod in the ACTIVE Vortex profile. Returns a job ID. Vortex may auto-deploy according to its settings.',
  vortex_deploy: 'Queue deployment of the ACTIVE Vortex profile. Writes mod files into the game through Vortex. Returns a job ID.',
  vortex_remove_mod: 'Queue removal of a local mod through Vortex. Removes it from ALL profiles for its game. Destructive; inspect profiles before calling. Returns a job ID.',
  vortex_job: 'Get the state/result of a Vortex operation job. Jobs are in memory and disappear when Vortex restarts. Do not resubmit an unfinished job.',
};

export const mutations = new Set<Operation>([
  'vortex_download_mod', 'vortex_install_download', 'vortex_set_mod_enabled', 'vortex_deploy', 'vortex_remove_mod',
]);

export function parseInput<K extends Operation>(operation: K, input: unknown): Input<K> {
  return schemas[operation].parse(input) as Input<K>;
}

export function paginate<T>(items: T[], offset: number, limit: number) {
  return { items: items.slice(offset, offset + limit), total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null };
}
