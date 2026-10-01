# Desktop validation

Tested on October 1, 2026, using Node.js 24.14.1 and an authenticated Windows desktop running Vortex 2.7.2. These checks used the built CLI through an actual MCP SDK stdio client and the installed, bundled companion extension. No standalone Nexus API key was supplied. Authentication remained inside Vortex.

## Verified live

- Installed the bridge in Vortex's user plugin directory, restarted Vortex, and observed its ready notification.
- Discovered all 21 MCP tools and confirmed an authenticated OAuth account through `vortex_status` and `nexus_account`.
- Read discovered games, existing profiles, installed mods, and completed downloads through MCP.
- Read the Nexus legacy game catalogue, mod metadata, file list, and latest-updated feed. Retrieved Premium download links without logging their signed URLs.
- Read API v3 mod details, mod files, file-version details, raw dependencies, and materialized dependency ranges using the IDs returned by the API.
- Downloaded a new, 989-byte Nexus archive for The Witcher 3 through `vortex_download_mod`. Polled its successful job and observed the finished download in Vortex.
- Installed that archive through `vortex_install_download`. Its job returned a local mod ID, and Vortex showed it disabled, confirming that installation did not auto-enable it.
- Removed that newly installed mod through `vortex_remove_mod` and verified the successful job.
- Imported an inert archive containing a single text marker and installed it through MCP without auto-enabling it.
- Connected an actual MCP client over the Elysia Streamable HTTP transport to the live Vortex bridge. Discovered 21 tools, read the authenticated OAuth account status, and confirmed that HTTP requests without a bearer token receive 401.
- Removed the inert test mod through MCP and deleted only the two archives introduced by these checks. Read back the active profile, mod inventory, enabled states, and download inventory, and compared them with the baseline: the original profile, nine installed mods, and eleven download records matched exactly. The marker was absent from the game directory. The bridge remains installed and running.

## Defect found and fixed

The first real installation attempt was incorrectly rejected as `profile_not_active`. Vortex retains `nextProfileId` equal to `activeProfileId` after a switch finishes. The original guard rejected any nonempty `nextProfileId`.

The guard now requires both IDs to match the requested profile. It accepts a settled profile and rejects a different pending target or deactivation. Fixtures now model Vortex's retained target ID, and a regression test checks both settled and deactivating states. Retesting the real installation and removal succeeded after updating and restarting the installed extension.

## Coverage limits

Enable/disable and deployment have not yet been exercised on this desktop. The active profile had existing disabled mods whose files remained in the game folder, so a full deployment could reconcile existing files. The download/install/removal test used only a newly downloaded mod; existing installed mods were not selected for mutation.

Desktop tests have not covered Linux or macOS Vortex runtimes, free-account website download handoffs, expired OAuth renewal, interactive installers, conflict resolution, game launch, or in-game mod behavior. Automated fixtures cover callback signatures, profile changes while jobs wait, and session refresh. CI covers the server, transports, builds, and packaging on all three operating systems.
