/** Install and control a per-machine LaunchAgent without baking this checkout's paths into the repository. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LanServiceError } from './errors/service.mjs';
import { discoverMacLanBinding } from './lan-machine.mjs';

const SERVICE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SERVICE_DIRECTORY, '..');
const SERVER_PATH = join(SERVICE_DIRECTORY, 'lan-static-server.mjs');
const LABEL = 'com.gary.neon-lan';
const FIRST_PORT = 8_088;
const LAST_PORT = 8_098;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

/** The generated agent uses absolute paths for launchd, while the server resolves the current LAN on every run. */
export function renderLaunchAgent({ interfaceName, logDirectory, nodePath, port, projectRoot, serverPath }) {
  const environmentItems = [
    `      <key>NEON_LAN_PORT</key><string>${escapeXml(port)}</string>`
  ];
  if (interfaceName) {
    environmentItems.push(`      <key>NEON_LAN_INTERFACE</key><string>${escapeXml(interfaceName)}</string>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(nodePath)}</string>
      <string>${escapeXml(serverPath)}</string>
    </array>
    <key>WorkingDirectory</key><string>${escapeXml(projectRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${environmentItems.join('\n')}
    </dict>
    <key>StandardOutPath</key><string>${escapeXml(join(logDirectory, 'server.log'))}</string>
    <key>StandardErrorPath</key><string>${escapeXml(join(logDirectory, 'server-error.log'))}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>ProcessType</key><string>Background</string>
  </dict>
</plist>
`;
}

function command(binary, arguments_) {
  try {
    return execFileSync(binary, arguments_, { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new LanServiceError(`${binary} ${arguments_.join(' ')} failed.`, { cause: error });
  }
}

function serviceLoaded(target) {
  return spawnSync('/bin/launchctl', ['print', target], { stdio: 'ignore' }).status === 0;
}

function inspectExistingAgent(plistPath) {
  if (!existsSync(plistPath)) return;
  const label = command('/usr/bin/plutil', ['-extract', 'Label', 'raw', '-o', '-', plistPath]);
  const serverPath = command('/usr/bin/plutil', ['-extract', 'ProgramArguments.1', 'raw', '-o', '-', plistPath]);
  if (label !== LABEL
    || !serverPath.endsWith('/server/lan-static-server.mjs')
    || (serverPath !== SERVER_PATH && existsSync(serverPath))) {
    throw new LanServiceError(`Existing LaunchAgent belongs to another live checkout: ${plistPath}`);
  }
}

function writeAgent(plistPath, contents) {
  const temporaryPath = `${plistPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, { mode: 0o644 });
    command('/usr/bin/plutil', ['-lint', temporaryPath]);
    renameSync(temporaryPath, plistPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath);
  }
}

async function portAvailable(host, port) {
  const probe = createServer();
  return await new Promise((resolvePromise, rejectPromise) => {
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolvePromise(false);
      else rejectPromise(error);
    });
    probe.listen(port, host, () => probe.close(() => resolvePromise(true)));
  });
}

async function selectPort(host, requestedPort) {
  if (requestedPort !== undefined) {
    const port = Number(requestedPort);
    if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
      throw new LanServiceError('NEON_LAN_PORT must be an integer from 1024 through 65535.');
    }
    if (!await portAvailable(host, port)) throw new LanServiceError(`LAN port ${port} is already in use.`);
    return port;
  }
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    if (await portAvailable(host, port)) return port;
  }
  throw new LanServiceError(`No available LAN port from ${FIRST_PORT} through ${LAST_PORT}.`);
}

async function waitForHealth(url, binding, port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}__health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const health = await response.json();
        if (health.service === 'neon-lan'
          && health.bind === `${binding.host}:${port}`
          && health.allowedNetwork === binding.network) return;
      }
    } catch {
      // A newly bootstrapped agent may not have opened its socket yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new LanServiceError('LAN service did not pass its health check; inspect ~/Library/Logs/NeonLAN/server-error.log.');
}

async function startService(domain, target, plistPath, logDirectory) {
  const binding = discoverMacLanBinding();
  inspectExistingAgent(plistPath);
  if (serviceLoaded(target)) command('/bin/launchctl', ['bootout', domain, plistPath]);

  const port = await selectPort(binding.host, process.env.NEON_LAN_PORT);
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(logDirectory, { recursive: true });
  writeAgent(plistPath, renderLaunchAgent({
    interfaceName: process.env.NEON_LAN_INTERFACE,
    logDirectory,
    nodePath: process.execPath,
    port,
    projectRoot: PROJECT_ROOT,
    serverPath: SERVER_PATH
  }));
  command('/bin/launchctl', ['enable', target]);
  command('/bin/launchctl', ['bootstrap', domain, plistPath]);

  const url = `http://${binding.host}:${port}/`;
  await waitForHealth(url, binding, port);
  console.log(`LAN game ready on ${binding.interfaceName}: ${url}`);
  if (process.env.NEON_SKIP_OPEN !== '1') {
    try {
      command('/usr/bin/open', [url]);
    } catch (error) {
      console.warn(`Open the game URL manually: ${url}`, error.message);
    }
  }
}

function stopService(domain, target, plistPath) {
  inspectExistingAgent(plistPath);
  if (!existsSync(plistPath)) {
    console.log('LAN service is not installed for this checkout.');
    return;
  }
  command('/bin/launchctl', ['disable', target]);
  if (serviceLoaded(target)) command('/bin/launchctl', ['bootout', domain, plistPath]);
  if (serviceLoaded(target)) throw new LanServiceError('LAN service is still loaded after bootout.');
  console.log('LAN game stopped. Start-Neon-LAN.command can restart it.');
}

async function runMain() {
  if (process.platform !== 'darwin') throw new LanServiceError('LaunchAgent control requires macOS.');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new LanServiceError('Node.js 20 or newer is required.');
  const action = process.argv[2];
  if (action !== 'start' && action !== 'stop') throw new LanServiceError('Use start or stop.');
  const userDirectory = homedir();
  const plistPath = join(userDirectory, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  const logDirectory = join(userDirectory, 'Library', 'Logs', 'NeonLAN');
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${LABEL}`;
  if (action === 'start') await startService(domain, target, plistPath, logDirectory);
  else stopService(domain, target, plistPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runMain();
}
