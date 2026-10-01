# Nexus Mods MCP

[![CI](https://github.com/iheanyi/nexusmods-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/iheanyi/nexusmods-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A lightweight TypeScript MCP server for looking up Nexus mods and managing a local Vortex installation. Uses the official MCP SDK v2, stdio by default, and Elysia with its Node adapter for optional Streamable HTTP.

The companion Vortex extension reuses the user's existing Nexus login. OAuth access tokens, API keys, and refresh tokens stay inside Vortex. The MCP process receives account summaries, API responses, and operation results.

This is an independent MIT-licensed project, unaffiliated with Nexus Mods. The initial release has automated integration tests; live Vortex authentication and mod operations have not been verified end to end.

## Platform support

The Node.js MCP server and standalone Nexus API tools are portable across macOS, Linux, and Windows. CI covers Node.js 22 and 24 on all three systems, including actual stdio/HTTP MCP clients, bridge fixtures, builds, and ZIP packaging.

| Platform | Server and Nexus API mode | Vortex local mod management |
| --- | --- | --- |
| Windows | Included in CI | Requires installed Vortex; source signatures checked against 2.7.2, live workflow unverified |
| Linux | Included in CI | Requires a working native Vortex build or Wine installation; live workflow unverified |
| macOS | Included in CI | No native Vortex build documented in the checked upstream sources; use standalone catalogue mode |

The current [Vortex stable release](https://github.com/Nexus-Mods/Vortex/releases/tag/v2.7.2) distributes a Windows installer. Its [contributing guide](https://github.com/Nexus-Mods/Vortex/blob/master/CONTRIBUTING.md) documents Linux source builds. This server does not provide a Vortex runtime, game compatibility layer, or native macOS mod manager. CI does not launch the Vortex desktop app.

## Quick start

Requires Node.js 22+ and a recent Vortex desktop release. Vortex must stay open for session reuse and local mod management.

```sh
git clone https://github.com/iheanyi/nexusmods-mcp.git
cd nexusmods-mcp
npm ci
npm run build
npm run package:extension
```

Install `dist/nexusmods-mcp-bridge.zip` using Vortex's Extensions page, enable **Nexus Mods MCP Bridge**, and restart Vortex. Alternatively, put the contents of `dist/vortex-extension` directly into a dedicated plugin directory under your Vortex user-data directory:

```text
%APPDATA%\Vortex\plugins\nexusmods-mcp-bridge\
  index.js
  info.json
  package.json
```

Sign in to Nexus Mods in Vortex. The bridge reports readiness in a Vortex notification. It creates a connection descriptor at:

```text
%APPDATA%\Vortex\nexusmods-mcp\bridge.json
```

The descriptor contains a randomly generated local bridge token, not Nexus credentials. Treat it as private: possession allows access to the bridge's tools. POSIX permissions are restricted to the owner; on Windows it inherits the user's Vortex directory ACLs. Each Vortex start generates a new token and chooses an available loopback port.

The server searches these conventional locations, checking both `Vortex` and `vortex` casing on macOS/Linux:

| Platform | Connection descriptor |
| --- | --- |
| Windows | `%APPDATA%/Vortex/nexusmods-mcp/bridge.json` |
| macOS | `~/Library/Application Support/Vortex/nexusmods-mcp/bridge.json` |
| Linux | `$XDG_CONFIG_HOME/Vortex/nexusmods-mcp/bridge.json`, or `~/.config/Vortex/nexusmods-mcp/bridge.json` |

These are discovery conventions, not claims that Vortex runs natively on every platform. For portable, Wine, Flatpak, or other custom installations, set `VORTEX_BRIDGE_FILE` to the actual `bridge.json` path shown in the readiness notification. The extension uses Vortex's `api.getPath('userData')` to find the correct directory. A native Linux/macOS MCP process can use a Windows Vortex bridge running through Wine when its connection descriptor and loopback port are accessible.

## Connect a local MCP client

Use your MCP client's stdio configuration, replacing the absolute path:

```json
{
  "mcpServers": {
    "nexusmods": {
      "command": "node",
      "args": ["C:/absolute/path/nexusmods-mcp/dist/cli.js"]
    }
  }
}
```

On macOS/Linux, replace the argument with an absolute path such as `/home/you/nexusmods-mcp/dist/cli.js` or `/Users/you/nexusmods-mcp/dist/cli.js`. Launch the server on the same computer as Vortex for session reuse and local mod operations.

For a custom Vortex directory, add:

```json
"env": {
  "VORTEX_BRIDGE_FILE": "D:/VortexData/nexusmods-mcp/bridge.json"
}
```

Start by asking the agent to call `vortex_status`, `vortex_games`, and `vortex_profiles`. No separate Nexus API key is needed in bridge mode.

To run directly:

```sh
node dist/cli.js
```

This waits for an MCP client on stdin; it is not an interactive shell. Development mode is `npm run dev`. Protocol output goes to stdout; diagnostics go to stderr.

## HTTP transport

On PowerShell:

```powershell
$env:MCP_HTTP_TOKEN = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:MCP_PORT = '7331'
node dist/cli.js --http
```

On macOS/Linux shells:

```sh
export MCP_HTTP_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export MCP_PORT=7331
node dist/cli.js --http
```

Connect a native MCP client to `http://127.0.0.1:7331/mcp` with `Authorization: Bearer <MCP_HTTP_TOKEN>`. The token must contain at least 32 characters. `/health` uses the same authentication.

Both endpoints bind to loopback. HTTP validates Host, rejects browser Origin headers, and requires a bearer token. HTTP is stateless and supports the SDK's current protocol plus compatibility for 2025-era Streamable HTTP clients. It is intended for a local desktop agent, not a public or multi-user service.

## Standalone catalogue mode

If you want Nexus API reads without Vortex, supply your personal API key through `NEXUS_API_KEY`:

```powershell
$env:NEXUS_API_KEY = '<your personal API key>'
node dist/cli.js
```

On macOS/Linux shells:

```sh
export NEXUS_API_KEY='<your personal API key>'
node dist/cli.js
```

This explicitly overrides Vortex auth for `nexus_*` tools. `vortex_*` tools still require the running bridge. `.env.example` documents environment variables; `.env` files are not loaded automatically. Use your shell, MCP client's `env` configuration, or Node's `--env-file` option. Never commit credentials.

## Tools

| Tool | Purpose |
| --- | --- |
| `nexus_account` | Sanitized authentication/account status |
| `nexus_games` | Game domains, with local name filtering and pagination |
| `nexus_mod` | Legacy mod details through Vortex's client when available |
| `nexus_mod_files` | Legacy downloadable file IDs, versions, and categories |
| `nexus_mod_feed` | Trending, latest added, or latest updated feed |
| `nexus_download_links` | Temporary file download links with optional website key/expiry |
| `nexus_v3_mod` | Current API v3 mod details and global mod ID |
| `nexus_v3_files` | API v3 mod files by global mod ID |
| `nexus_v3_file_version` | API v3 file version from a game-scoped file ID |
| `nexus_v3_dependencies` | Raw requirements or resolved version-range candidates |
| `vortex_status` | Bridge/account/active profile status |
| `vortex_games` | Discovered local games and Vortex IDs |
| `vortex_profiles` | Existing local profiles |
| `vortex_mods` | Installed mods and profile enabled state |
| `vortex_downloads` | Download IDs, state, and progress |
| `vortex_download_mod` | Queue download without auto-installation |
| `vortex_install_download` | Queue installation without auto-enabling |
| `vortex_set_mod_enabled` | Queue enable/disable through Vortex's action helper |
| `vortex_deploy` | Queue deployment through Vortex |
| `vortex_remove_mod` | Queue removal through Vortex; affects all profiles in that game |
| `vortex_job` | Poll a queued operation's status/result |

Schemas and detailed descriptions are returned through MCP discovery. Catalogue responses remain untrusted data; descriptions are not agent instructions. Paginated tools return `items`, `total`, and `nextOffset`. Pagination/filtering is local after fetching the upstream catalogue.

### Identifier types

- `game`: Nexus website domain, such as `skyrimspecialedition`.
- `gameId`: Vortex's local game ID, such as `skyrimse`. Obtain it from `vortex_games`.
- Numeric `modId`/`fileId` in Nexus tools: game-scoped IDs from Nexus URLs and the legacy files API.
- `modUid`/`fileVersionId`: global string API v3 IDs. Obtain them from the corresponding v3 detail response. Do not substitute legacy IDs.
- `profileId`, `downloadId`, and `modId` in local profile/mod tools: Vortex local string IDs.

### Example workflow

1. Inspect `vortex_status`, `vortex_games`, and `vortex_profiles`. Activate the intended profile in Vortex.
2. Inspect a mod with `nexus_mod` and choose its file using `nexus_mod_files`. Check its requirements and compatibility before installing. API v3 provides file-version dependency information where authored.
3. Call `vortex_download_mod` with the Vortex game ID and Nexus mod/file IDs. Save the returned `jobId`.
4. Poll `vortex_job`. A successful download job means Vortex returned a download ID; use `vortex_downloads` until the download is `finished`.
5. Call `vortex_install_download` with that download ID and the active profile ID. Poll the job and complete installer dialogs in Vortex if needed.
6. Enable the returned local mod ID with `vortex_set_mod_enabled`, then deploy using `vortex_deploy`. Poll each job and inspect Vortex's conflict/load-order dialogs.

The server rechecks the active profile and game immediately before queued writes. Jobs run one at a time. A pending installer can block later jobs until the user resolves its dialog. A successful enable/disable can trigger Vortex's configured auto-deployment.

## API and integration boundaries

The [current Nexus API documentation](https://api-docs.nexusmods.com/) serves an [OpenAPI v3 specification](https://api.nexusmods.com/openapi.yaml). Selected v3 metadata/dependency routes are currently marked **experimental**. The documented [legacy API](https://app.swaggerhub.com/apis-docs/NexusMods/nexus-mods_public_api_params_in_form_data/1.0) remains useful for games, feeds, downloadable files, and links; Vortex exposes client methods for several of these.

Authentication is reused by a Vortex extension, not by opening its internal database. Legacy metadata reads prefer Vortex's `api.ext.nexusGetModInfo`, `nexusGetModFiles`, and feed methods so Vortex owns token refresh. Other allowlisted reads go directly from inside the extension to `https://api.nexusmods.com`, using the current in-memory OAuth access token or API key. Expiring OAuth sessions request refresh through Vortex's public `refresh-user-info` event and observe updated state for up to ten seconds. The bridge never reads or independently rotates refresh tokens. If Vortex cannot refresh, the read reports `auth_expired`; sign in/refresh in Vortex before retrying.

Local mutations use Vortex's extension APIs: `nexusDownload`, `actions.setModsEnabled`, and the `start-install-download`, `deploy-mods`, and `remove-mod` events. Installation, deployment, dependency handling, conflict detection, and game-specific installers stay in Vortex. The implementation is based on the [official event reference](https://github.com/Nexus-Mods/Vortex/blob/master/packages/vortex-api/docs/EVENTS.md) and [current handlers](https://github.com/Nexus-Mods/Vortex/blob/master/src/renderer/src/extensions/mod_management/index.ts); actual source signatures take precedence over abbreviated event documentation.

Limitations:

- Free accounts require the website-generated NXM key and expiry for direct download links. Vortex may open the website or request interaction. The server respects this restriction.
- There is no documented REST full-text mod search route in the specifications used here. Feed tools do not claim to provide one.
- HTTP errors retain rate-limit/reset headers and are not automatically retried. Vortex-owned methods enforce their own rate limits and may surface failures in notifications; its file-list helper can return an empty list on failure.
- Job success does not mean a running game has verified the mod's compatibility. Jobs are in memory, capped at 20 pending and 100 retained entries, and disappear on restart. An unresolved Vortex callback stays running; inspect Vortex before retrying. There is no cancellation or replay endpoint.
- Local profile mutations require the selected profile to be active. Profile creation/switching, arbitrary shell execution, filesystem/archive editing, mod publishing, and account mutations are outside this server's tool surface.
- Mod removal removes the local mod from all profiles for its game. Use `vortex_set_mod_enabled` for a reversible profile-specific change.
- Vortex bridge compatibility is checked against current source, Vortex 2.7.2's shipped API, and mocked integration fixtures. A real desktop install/download/deploy flow still needs verification with a signed-in Vortex instance and a test game/profile.

## Development

```sh
npm run check
npm run package:extension
npm run smoke
```

Tests cover actual MCP client discovery/calls over stdio and Elysia HTTP, bridge authentication and input validation, credential redaction, API route/ID handling, OAuth state refresh, mutation callback signatures, profile/game checks, serialized jobs, and failure reporting. Tests do not contact Nexus or modify installed games.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [SECURITY.md](SECURITY.md) for private vulnerability reports. The source and extension are available from GitHub; the npm package is not published. Bundled third-party notices ship inside the extension ZIP.

```text
src/                 MCP tools, transport, bridge client, allowlisted Nexus API reads
vortex-extension/    Vortex session adapter, local operations, authenticated bridge, jobs
scripts/             Single-file CommonJS extension build and ZIP packaging
test/                API, Vortex integration, and transport tests
```

The extension bundles its dependencies and relies only on Node built-ins plus the `vortex-api` module supplied by Vortex. Do not install the unrelated unscoped npm package named `vortex-api`.
