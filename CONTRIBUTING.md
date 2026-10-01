# Contributing

Issues and pull requests are welcome. Use Node.js 22 or 24 and npm.

```sh
npm ci
npm run check
npm run package:extension
npm run smoke
```

CI runs those commands on Linux, macOS, and Windows. Keep scripts independent
of the user's shell and use Node filesystem/path APIs for portable tooling.
Respect `VORTEX_BRIDGE_FILE`, Linux's `XDG_CONFIG_HOME`, and Vortex's own
`api.getPath('userData')` rather than assuming a particular installation path.

For fixes, describe the problem, the resulting behavior, and how you verified
it. Add focused tests when behavior changes. Tests must not use a real Nexus
account or modify installed games. If you manually test a live Vortex workflow,
use a disposable profile/game installation and report the Vortex version,
platform, steps, and outcome separately from automated test results.

Keep Nexus credentials inside Vortex in bridge mode. Do not add tools that
return tokens, read Vortex's internal database, execute arbitrary commands, or
forward authenticated requests to caller-controlled URLs.

This is an independent project, unaffiliated with Nexus Mods. Contributions are
provided under the [MIT license](LICENSE).
