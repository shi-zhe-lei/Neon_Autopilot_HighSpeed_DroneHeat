import { createReadStream, realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LanServerConfigurationError } from './errors/configuration.mjs';

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVER_DIRECTORY, '..');
const ENTRY_FILE = 'Neon_Autopilot_V23_HighSpeed_DroneHeat.html';
const DEFAULT_PORT = 8_088;
const MAX_CONNECTIONS = 32;
const MAX_REQUESTS_PER_SOCKET = 128;

const PUBLIC_DIRECTORIES = new Set(['assets', 'errors', 'src', 'styles', 'vendor']);
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.wav': 'audio/wav'
});

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "child-src 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'none'",
    "media-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'none'"
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': [
    'accelerometer=()',
    'autoplay=(self)',
    'camera=()',
    'display-capture=()',
    'encrypted-media=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'picture-in-picture=()',
    'publickey-credentials-get=()',
    'screen-wake-lock=()',
    'usb=()',
    'xr-spatial-tracking=()'
  ].join(', '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0'
});

function parseIPv4(address) {
  if (typeof address !== 'string') return null;
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = ((result * 256) + octet) >>> 0;
  }
  return result;
}

function formatIPv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join('.');
}

function parseIPv4Network(value) {
  if (typeof value !== 'string') {
    throw new LanServerConfigurationError('Allowed network must be an IPv4 CIDR string.');
  }

  const [address, prefixText, extra] = value.split('/');
  const addressValue = parseIPv4(address);
  const prefix = Number(prefixText);
  if (
    extra !== undefined
    || addressValue === null
    || !Number.isInteger(prefix)
    || prefix < 0
    || prefix > 32
  ) {
    throw new LanServerConfigurationError(`Invalid IPv4 network: ${value}`);
  }

  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  const networkValue = (addressValue & mask) >>> 0;
  if (networkValue !== addressValue) {
    throw new LanServerConfigurationError(
      `Allowed network must use its canonical base address: ${formatIPv4(networkValue)}/${prefix}`
    );
  }

  return Object.freeze({
    base: address,
    mask,
    networkValue,
    prefix,
    text: `${address}/${prefix}`
  });
}

function normalizeRemoteIPv4(address) {
  if (typeof address !== 'string') return null;
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function isWithinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * Parse and freeze the security boundary before listen(). The bind address must itself belong to the allowed subnet.
 */
export function parseServerConfig(environment = process.env, overrides = {}) {
  const host = overrides.host ?? environment.NEON_V23_LAN_HOST ?? '10.10.0.250';
  const portText = overrides.port ?? environment.NEON_V23_LAN_PORT ?? DEFAULT_PORT;
  const networkText = overrides.network ?? environment.NEON_V23_LAN_NETWORK ?? '10.10.0.0/24';
  const deniedClientsText = overrides.deniedClients
    ?? environment.NEON_V23_LAN_DENIED_CLIENTS
    ?? '10.10.0.1';
  const staticRootInput = overrides.staticRoot ?? PROJECT_ROOT;
  const port = Number(portText);
  const hostValue = parseIPv4(host);
  const network = parseIPv4Network(networkText);

  if (hostValue === null) {
    throw new LanServerConfigurationError(`Bind host must be one explicit IPv4 address: ${host}`);
  }
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new LanServerConfigurationError(`Port must be an integer from 1024 through 65535: ${portText}`);
  }
  if (((hostValue & network.mask) >>> 0) !== network.networkValue) {
    throw new LanServerConfigurationError(`Bind host ${host} is outside allowed network ${network.text}.`);
  }

  const deniedClientValues = [];
  for (const deniedAddress of String(deniedClientsText).split(',').map((value) => value.trim()).filter(Boolean)) {
    const deniedValue = parseIPv4(deniedAddress);
    if (
      deniedValue === null
      || ((deniedValue & network.mask) >>> 0) !== network.networkValue
    ) {
      throw new LanServerConfigurationError(
        `Denied client ${deniedAddress} must be an IPv4 address inside ${network.text}.`
      );
    }
    if (!deniedClientValues.includes(deniedValue)) deniedClientValues.push(deniedValue);
  }

  let staticRoot;
  try {
    staticRoot = realpathSync(path.resolve(staticRootInput));
  } catch (error) {
    throw new LanServerConfigurationError(`Static root is unavailable: ${staticRootInput}`, { cause: error });
  }

  const entryPath = path.resolve(staticRoot, ENTRY_FILE);
  try {
    if (!statSync(entryPath).isFile()) {
      throw new LanServerConfigurationError(`Entry is not a regular file: ${entryPath}`);
    }
  } catch (error) {
    if (error instanceof LanServerConfigurationError) throw error;
    throw new LanServerConfigurationError(`Entry is unavailable: ${entryPath}`, { cause: error });
  }

  return Object.freeze({
    deniedClientValues: Object.freeze(deniedClientValues),
    entryPath,
    host,
    hostValue,
    network,
    port,
    staticRoot
  });
}

export function isClientAllowed(remoteAddress, config) {
  const addressValue = parseIPv4(normalizeRemoteIPv4(remoteAddress));
  return addressValue !== null
    && !config.deniedClientValues.includes(addressValue)
    && ((addressValue & config.network.mask) >>> 0) === config.network.networkValue;
}

export function isHostAllowed(hostHeader, config) {
  if (typeof hostHeader !== 'string') return false;
  const normalized = hostHeader.trim().toLowerCase();
  return normalized === config.host || normalized === `${config.host}:${config.port}`;
}

/**
 * Publish only the production entry and its runtime asset directories; audits, tests, tools, logs, and dotfiles stay private.
 */
export function resolvePublicPath(encodedPathname, config) {
  let pathname;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return null;
  }

  if (pathname === '/') return config.entryPath;
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('\0')) {
    return null;
  }

  const segments = pathname.slice(1).split('/');
  if (
    segments.length < 2
    || !PUBLIC_DIRECTORIES.has(segments[0])
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
  ) {
    return null;
  }

  const candidate = path.resolve(config.staticRoot, ...segments);
  return isWithinRoot(config.staticRoot, candidate) ? candidate : null;
}

/**
 * Accept one RFC-style byte range so native media can seek without allowing multipart response complexity.
 */
export function parseByteRange(rangeHeader, size) {
  if (rangeHeader === undefined) return null;
  if (typeof rangeHeader !== 'string' || !Number.isSafeInteger(size) || size < 0) {
    return Object.freeze({ unsatisfiable: true });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) {
    return Object.freeze({ unsatisfiable: true });
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return Object.freeze({ unsatisfiable: true });
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || start >= size
      || end < start
    ) {
      return Object.freeze({ unsatisfiable: true });
    }
    end = Math.min(end, size - 1);
  }

  return Object.freeze({ end, length: end - start + 1, start, unsatisfiable: false });
}

export function securityHeaders() {
  return { ...SECURITY_HEADERS };
}

function sendBuffer(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    ...headers
  });
  response.end(body);
}

function sendText(response, statusCode, message, headers = {}) {
  sendBuffer(response, statusCode, Buffer.from(`${message}\n`, 'utf8'), {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers
  });
}

function requestPathname(requestTarget) {
  if (typeof requestTarget !== 'string' || !requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
    return null;
  }
  const queryIndex = requestTarget.indexOf('?');
  return queryIndex === -1 ? requestTarget : requestTarget.slice(0, queryIndex);
}

async function sendStaticFile(request, response, candidate, config) {
  let canonicalPath;
  let fileStats;
  try {
    canonicalPath = await realpath(candidate);
    if (!isWithinRoot(config.staticRoot, canonicalPath)) {
      sendText(response, 404, 'Not found.');
      return;
    }
    fileStats = await stat(canonicalPath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      sendText(response, 404, 'Not found.');
      return;
    }
    throw error;
  }

  const contentType = MIME_TYPES[path.extname(canonicalPath).toLowerCase()];
  if (!fileStats.isFile() || !contentType) {
    sendText(response, 404, 'Not found.');
    return;
  }

  const etag = `"${fileStats.size.toString(16)}-${Math.trunc(fileStats.mtimeMs).toString(16)}"`;
  const range = parseByteRange(request.headers.range, fileStats.size);
  if (range?.unsatisfiable) {
    sendText(response, 416, 'Requested range is not satisfiable.', {
      'Content-Range': `bytes */${fileStats.size}`
    });
    return;
  }

  if (!range && request.headers['if-none-match'] === etag) {
    response.writeHead(304, {
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-cache',
      ETag: etag
    });
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, fileStats.size - 1);
  const contentLength = range?.length ?? fileStats.size;
  const responseHeaders = {
    ...SECURITY_HEADERS,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Content-Length': contentLength,
    'Content-Type': contentType,
    ETag: etag
  };
  if (range) responseHeaders['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`;
  response.writeHead(range ? 206 : 200, responseHeaders);

  if (request.method === 'HEAD' || fileStats.size === 0) {
    response.end();
    return;
  }

  try {
    await pipeline(createReadStream(canonicalPath, { end, start }), response);
  } catch (error) {
    if (error?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
  }
}

async function handleRequest(request, response, config) {
  if (!isClientAllowed(request.socket.remoteAddress, config)) {
    sendText(response, 403, 'LAN access only.');
    return;
  }
  if (!isHostAllowed(request.headers.host, config)) {
    sendText(response, 421, 'Host is not allowed.');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    return;
  }

  const pathname = requestPathname(request.url);
  if (pathname === null) {
    sendText(response, 400, 'Invalid request target.');
    return;
  }

  if (pathname === '/__health') {
    const body = Buffer.from(JSON.stringify({
      allowedNetwork: config.network.text,
      bind: `${config.host}:${config.port}`,
      service: 'neon-v23-lan',
      status: 'ok'
    }), 'utf8');
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'Cache-Control': 'no-store',
        'Content-Length': body.length,
        'Content-Type': 'application/json; charset=utf-8'
      });
      response.end();
      return;
    }
    sendBuffer(response, 200, body, { 'Content-Type': 'application/json; charset=utf-8' });
    return;
  }

  const candidate = resolvePublicPath(pathname, config);
  if (candidate === null) {
    sendText(response, 404, 'Not found.');
    return;
  }
  await sendStaticFile(request, response, candidate, config);
}

/**
 * Build a resource-capped server. Unexpected request failures return 500 and then propagate so launchd can restart cleanly.
 */
export function createLanStaticServer(config, { logger = console } = {}) {
  const server = http.createServer((request, response) => {
    const startedAt = Date.now();
    response.once('finish', () => {
      logger.info?.(JSON.stringify({
        durationMs: Date.now() - startedAt,
        method: request.method,
        path: requestPathname(request.url) ?? '[invalid]',
        remoteAddress: request.socket.remoteAddress,
        statusCode: response.statusCode,
        time: new Date().toISOString()
      }));
    });

    void handleRequest(request, response, config).catch((error) => {
      logger.error?.('[neon-v23-lan] Unexpected request failure.', error);
      if (!response.headersSent) sendText(response, 500, 'Internal server error.');
      else response.destroy();
      setImmediate(() => {
        throw error;
      });
    });
  });

  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = MAX_CONNECTIONS;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
  server.requestTimeout = 15_000;
  return server;
}

export async function startLanStaticServer(config, options = {}) {
  const server = createLanStaticServer(config, options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function runMain() {
  const config = parseServerConfig();
  const server = await startLanStaticServer(config);
  console.info(`[neon-v23-lan] Listening at http://${config.host}:${config.port}/ for ${config.network.text}`);

  const shutdown = (signal) => {
    console.info(`[neon-v23-lan] ${signal} received; closing.`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  await runMain();
}
