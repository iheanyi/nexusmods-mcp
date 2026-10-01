import type { EventEmitter } from 'node:events';

// Narrow structural boundary; Vortex supplies its own vortex-api module at runtime.
// Do not install the unrelated npm package named vortex-api.
export interface Profile { name?: string; gameId: string; modState?: Record<string, { enabled?: boolean }>; }
export interface Mod { state?: string; attributes?: Record<string, unknown>; }
export interface Download {
  state?: string; game?: string[] | string; localPath?: string; size?: number; received?: number;
  modInfo?: { nexus?: { ids?: Record<string, unknown> } };
}
export interface VortexState {
  confidential?: { account?: { nexus?: { APIKey?: string; OAuthCredentials?: { token: string } } } };
  persistent?: {
    nexus?: { userInfo?: Record<string, unknown> };
    profiles?: Record<string, Profile>;
    mods?: Record<string, Record<string, Mod>>;
    downloads?: { files?: Record<string, Download> };
  };
  settings?: {
    profiles?: { activeProfileId?: string; nextProfileId?: string };
    gameMode?: { discovered?: Record<string, { path?: string; name?: string }> };
  };
  session?: { gameMode?: { known?: Array<{ id: string; name?: string; details?: { nexusPageId?: string } }> } };
}
export interface VortexApi {
  getState(): VortexState;
  getPath(name: string): string;
  events: EventEmitter;
  ext: {
    nexusGetModInfo?: (gameId: string, modId: number) => PromiseLike<unknown>;
    nexusGetModFiles?: (gameId: string, modId: number) => PromiseLike<unknown[]>;
    nexusGetTrendingMods?: (gameId: string) => PromiseLike<unknown>;
    nexusGetLatestMods?: (gameId: string) => PromiseLike<unknown>;
    nexusDownload?: (gameId: string, modId: number, fileId: number, fileName?: string, allowInstall?: boolean) => PromiseLike<string | undefined>;
    getNexusGames?: () => PromiseLike<unknown[]>;
  };
  showErrorNotification(title: string, error: Error, options?: { allowReport: boolean }): void;
  sendNotification(notification: { id: string; type: string; message: string }): void;
}
export interface VortexContext { api: VortexApi; once(callback: () => void): void; }
export type EnableMods = (api: VortexApi, profileId: string, modIds: string[], enabled: boolean) => PromiseLike<void>;
