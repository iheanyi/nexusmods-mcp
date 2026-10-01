import { createVortexExecutor } from './operations.js';
import { startBridge } from './bridge.js';
import type { EnableMods, VortexContext } from './types.js';

export default function init(context: VortexContext) {
  context.once(() => {
    // Supplied by Vortex's extension loader, deliberately external to the bundle.
    const sdk = require('vortex-api') as { actions: { setModsEnabled: EnableMods } };
    if (typeof sdk.actions.setModsEnabled !== 'function') {
      context.api.showErrorNotification('Nexus Mods MCP Bridge', new Error('This Vortex version does not expose actions.setModsEnabled. Update Vortex.'), { allowReport: false });
      return;
    }
    void startBridge(context.api.getPath('userData'), createVortexExecutor(context.api, sdk.actions.setModsEnabled))
      .then(bridge => {
        context.api.sendNotification({ id: 'nexusmods-mcp-bridge', type: 'info', message: `Nexus Mods MCP Bridge is ready. Local agents can manage mods while Vortex is running. Connection file: ${bridge.file}` });
        process.once('exit', () => bridge.closeOnExit());
      })
      .catch(() => context.api.showErrorNotification('Nexus Mods MCP Bridge', new Error('Could not start the local bridge. Check write access to the Vortex userData directory.'), { allowReport: false }));
  });
  return true;
}
