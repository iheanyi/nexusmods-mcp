# Security reports

Report vulnerabilities privately through [GitHub security advisories](https://github.com/iheanyi/nexusmods-mcp/security/advisories/new).
Do not include real Nexus API keys, OAuth tokens, signed download URLs, or
`bridge.json` contents in issues or pull requests.

The bridge and HTTP transport are local services. Possession of a bridge token
allows the holder to request local mod operations as the desktop user. Keep
the Vortex user-data directory private, especially in custom shared locations.

The initial release has automated integration tests and source-level Vortex
compatibility checks. Live mod-management workflows have not yet been
verified end to end. Platform CI verifies the server, bridge fixtures, and
packaging; it does not run the Vortex desktop app.
