#!/usr/bin/env node
/** Generate the Windows copy-integrity contract from the boot chain and production runtime bytes. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIRECTORY = resolve(TOOL_DIRECTORY, '..');
export const WINDOWS_MANIFEST_FILE = 'server/windows-production-manifest.json';
export const WINDOWS_RELEASE = '23-ipad-road-residency-253';
const PRODUCTION_DIRECTORIES = Object.freeze(['assets', 'errors', 'src', 'styles', 'vendor']);
const PRODUCTION_EXTENSIONS = new Set(['.css', '.js', '.mp3', '.ogg', '.png', '.wav']);
const WINDOWS_BOOT_FILES = Object.freeze([
  'Neon_Autopilot_V23_HighSpeed_DroneHeat.html',
  'Start-V23-Windows.cmd',
  'server/windows-local-server.ps1',
  '启动Windows本地游戏.cmd'
]);

function collectProductionFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectProductionFiles(absolutePath));
    else if (entry.isFile() && PRODUCTION_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return files;
}

/** Hash the Windows boot chain and every externally loaded runtime byte while excluding the recursive manifest. */
export function buildWindowsProductionManifest(projectDirectory = PROJECT_DIRECTORY) {
  const files = [
    ...WINDOWS_BOOT_FILES.map((file) => join(projectDirectory, file)),
    ...PRODUCTION_DIRECTORIES.flatMap((directory) => collectProductionFiles(join(projectDirectory, directory)))
  ]
    .sort()
    .map((absolutePath) => {
      const bytes = readFileSync(absolutePath);
      return Object.freeze({
        path: relative(projectDirectory, absolutePath).split('\\').join('/'),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    });
  return Object.freeze({ schemaVersion: 2, release: WINDOWS_RELEASE, files: Object.freeze(files) });
}

export function serializeWindowsProductionManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputPath = join(PROJECT_DIRECTORY, WINDOWS_MANIFEST_FILE);
  writeFileSync(outputPath, serializeWindowsProductionManifest(buildWindowsProductionManifest()));
  console.log(`[windows-manifest] wrote ${outputPath}`);
}
