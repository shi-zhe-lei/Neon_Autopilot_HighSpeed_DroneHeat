import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderLaunchAgent } from './lan-service.mjs';

test('per-machine LaunchAgent escapes relocated paths and defers network selection to runtime', () => {
  const plist = renderLaunchAgent({
    interfaceName: 'en7',
    logDirectory: '/Users/A & B/Library/Logs/NeonLAN',
    nodePath: '/Users/A & B/.nvm/versions/node/v22.1.0/bin/node',
    port: 8_089,
    projectRoot: '/Users/A & B/Games/Neon Autopilot',
    serverPath: '/Users/A & B/Games/Neon Autopilot/server/lan-static-server.mjs'
  });
  assert.match(plist, /<string>\/Users\/A &amp; B\/Games\/Neon Autopilot<\/string>/);
  assert.match(plist, /<key>NEON_LAN_PORT<\/key><string>8089<\/string>/);
  assert.match(plist, /<key>NEON_LAN_INTERFACE<\/key><string>en7<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.doesNotMatch(plist, /NEON_LAN_HOST|NEON_LAN_NETWORK|192\.168\.100/);
});
