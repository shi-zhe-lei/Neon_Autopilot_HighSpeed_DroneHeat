import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  buildWindowsProductionManifest,
  PROJECT_DIRECTORY,
  serializeWindowsProductionManifest,
  WINDOWS_MANIFEST_FILE,
  WINDOWS_RELEASE
} from '../tools/generate-windows-production-manifest.mjs';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function assertCrlfOnly(bytes, label) {
  assert.ok(bytes.includes(0x0a), `${label} must contain line endings`);
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      assert.equal(bytes[index - 1], 0x0d, `${label} contains a bare LF at byte ${index}`);
    }
    if (bytes[index] === 0x0d) {
      assert.equal(bytes[index + 1], 0x0a, `${label} contains a lone CR at byte ${index}`);
    }
  }
}

describe('Windows local launcher contracts', () => {
  const launcherBytes = readFileSync(join(PROJECT_DIRECTORY, 'Start-Neon-Windows.cmd'));
  const aliasBytes = readFileSync(join(PROJECT_DIRECTORY, '启动Windows本地游戏.cmd'));
  const serverBytes = readFileSync(join(PROJECT_DIRECTORY, 'server/windows-local-server.ps1'));
  const launcher = launcherBytes.toString('ascii');
  const alias = aliasBytes.toString('ascii');
  const server = new TextDecoder('utf-8', { fatal: true })
    .decode(serverBytes.subarray(UTF8_BOM.length));
  const manifestSource = readFileSync(join(PROJECT_DIRECTORY, WINDOWS_MANIFEST_FILE), 'utf8');

  test('ships native Windows text bytes for cmd.exe and Windows PowerShell 5.1', () => {
    for (const [label, bytes] of [['canonical CMD', launcherBytes], ['Chinese-name CMD alias', aliasBytes]]) {
      assert.equal(bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM), false, `${label} must not have a BOM`);
      assert.ok([...bytes].every((byte) => byte < 0x80), `${label} must stay ASCII-only`);
      assertCrlfOnly(bytes, label);
    }
    assert.ok(serverBytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM), 'PowerShell must have a UTF-8 BOM');
    assertCrlfOnly(serverBytes, 'PowerShell');
  });

  test('uses a dependency-free loopback HTTP boundary without broad browser file permissions', () => {
    assert.match(alias, /call "%Neon_CANONICAL%"/);
    assert.match(launcher, /Neon_LAUNCHER=.*windows-local-server\.ps1/);
    assert.match(launcher, /Neon_POWERSHELL=%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
    assert.match(launcher, /"%Neon_POWERSHELL%" .* -NonInteractive .* -File "%Neon_LAUNCHER%"/);
    assert.match(server, /System\.Net\.Sockets\.TcpListener/);
    assert.match(server, /System\.Net\.IPAddress\]::Loopback/);
    assert.match(server, /127\.0\.0\.1/);
    assert.doesNotMatch(`${launcher}\n${alias}\n${server}`, /allow-file-access-from-files/i);
  });

  test('keeps every launcher return visible and writes persistent diagnostics', () => {
    assert.match(launcher, /set "Neon_EXIT_CODE=%ERRORLEVEL%"[\s\S]*:finish/);
    assert.match(launcher, /:finish[\s\S]*pause >nul[\s\S]*exit \/b %Neon_EXIT_CODE%/);
    assert.match(launcher, /Neon_LAUNCH_LOG=%TEMP%\\Neon-Windows-launch\.log/);
    assert.match(launcher, /echo Neon Windows local launcher preflight>"%Neon_LAUNCH_LOG%"/);
    assert.match(alias, /echo Neon Windows launcher alias preflight>"%Neon_LAUNCH_LOG%"/);
    assert.match(server, /Initialize-LaunchLog/);
    assert.match(server, /Write-LauncherDiagnostic/);
    assert.match(server, /Open-GameBrowser/);
    assert.match(server, /explorer\.exe/);
  });

  test('limits methods, hosts, paths, and native-media ranges', () => {
    assert.match(server, /'GET'.*'HEAD'/s);
    assert.match(server, /Loopback Host header required/);
    assert.match(server, /AllowedDirectories = @\('assets', 'errors', 'src', 'styles', 'vendor'\)/);
    assert.match(server, /Range Not Satisfiable/);
    assert.match(server, /Content-Range/);
    assert.match(server, /X-Content-Type-Options/);
  });

  test('ships an exact manifest for the current Windows release', () => {
    const expected = serializeWindowsProductionManifest(buildWindowsProductionManifest());
    assert.equal(manifestSource, expected);
    const manifest = JSON.parse(manifestSource);
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.release, WINDOWS_RELEASE);
    assert.ok(manifest.files.length >= 54);
    assert.ok(manifest.files.every((file) => /^[a-f\d]{64}$/.test(file.sha256)));
    for (const bootPath of [
      'Neon_Autopilot_HighSpeed_DroneHeat.html',
      'Start-Neon-Windows.cmd',
      'server/windows-local-server.ps1',
      '启动Windows本地游戏.cmd'
    ]) {
      assert.equal(manifest.files.filter((file) => file.path === bootPath).length, 1);
    }
  });
});
