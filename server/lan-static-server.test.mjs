import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLanStaticServer,
  isClientAllowed,
  isHostAllowed,
  parseByteRange,
  parseServerConfig,
  resolvePublicPath,
  securityHeaders
} from './lan-static-server.mjs';

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVER_DIRECTORY, '..');
const silentLogger = Object.freeze({ error() {}, info() {} });

describe('LAN boundary contracts', () => {
  const config = parseServerConfig({}, {
    deniedClients: '10.10.0.1',
    host: '10.10.0.250',
    network: '10.10.0.0/24',
    port: 8_088,
    staticRoot: PROJECT_ROOT
  });

  test('accepts only clients in the configured IPv4 subnet', () => {
    assert.equal(isClientAllowed('10.10.0.1', config), false);
    assert.equal(isClientAllowed('10.10.0.197', config), true);
    assert.equal(isClientAllowed('::ffff:10.10.0.250', config), true);
    assert.equal(isClientAllowed('10.10.1.1', config), false);
    assert.equal(isClientAllowed('203.0.113.9', config), false);
    assert.equal(isClientAllowed('::1', config), false);
  });

  test('accepts only the explicit bind host with its configured port', () => {
    assert.equal(isHostAllowed('10.10.0.250', config), true);
    assert.equal(isHostAllowed('10.10.0.250:8088', config), true);
    assert.equal(isHostAllowed('10.10.0.250:8089', config), false);
    assert.equal(isHostAllowed('game.example', config), false);
  });

  test('publishes production assets while keeping private material unavailable', () => {
    assert.equal(resolvePublicPath('/', config), config.entryPath);
    assert.equal(
      resolvePublicPath('/src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js', config),
      path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js')
    );
    assert.equal(resolvePublicPath('/README.md', config), null);
    assert.equal(resolvePublicPath('/docs/audits/AUDIT_REPORT_2026-07-16.md', config), null);
    assert.equal(resolvePublicPath('/tests/browser/layout-test.html', config), null);
    assert.equal(resolvePublicPath('/%2e%2e/README.md', config), null);
    assert.equal(resolvePublicPath('/src/.DS_Store', config), null);
  });

  test('parses one bounded media range and rejects malformed or multipart ranges', () => {
    assert.deepEqual(parseByteRange(undefined, 100), null);
    assert.deepEqual(parseByteRange('bytes=10-19', 100), {
      end: 19,
      length: 10,
      start: 10,
      unsatisfiable: false
    });
    assert.deepEqual(parseByteRange('bytes=-10', 100), {
      end: 99,
      length: 10,
      start: 90,
      unsatisfiable: false
    });
    assert.equal(parseByteRange('bytes=100-101', 100).unsatisfiable, true);
    assert.equal(parseByteRange('bytes=0-1,4-5', 100).unsatisfiable, true);
  });

  test('publishes the restrictive browser policy required by the LAN service', () => {
    const headers = securityHeaders();
    assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
    assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
    assert.match(headers['Permissions-Policy'], /camera=\(\)/);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  });
});

describe('HTTP behavior', () => {
  const config = parseServerConfig({}, {
    deniedClients: '',
    host: '127.0.0.1',
    network: '127.0.0.0/8',
    port: 8_088,
    staticRoot: PROJECT_ROOT
  });
  const server = createLanStaticServer(config, { logger: silentLogger });
  let port;

  before(async () => {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections?.();
    });
  });

  function request(pathname, { headers = {}, method = 'GET' } = {}) {
    return new Promise((resolve, reject) => {
      const requestHandle = http.request({
        headers: { Host: '127.0.0.1', ...headers },
        host: '127.0.0.1',
        method,
        path: pathname,
        port
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          body: Buffer.concat(chunks),
          headers: response.headers,
          statusCode: response.statusCode
        }));
      });
      requestHandle.once('error', reject);
      requestHandle.end();
    });
  }

  test('serves the game entry with security headers', async () => {
    const response = await request('/');
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /^text\/html/);
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
    assert.match(response.body.toString('utf8'), /3D CC Runner · Neon/);
  });

  test('supports native-media byte ranges', async () => {
    const response = await request('/assets/audio/music_dawn_first_light.ogg', {
      headers: { Range: 'bytes=0-15' }
    });
    assert.equal(response.statusCode, 206);
    assert.equal(response.body.length, 16);
    assert.match(response.headers['content-range'], /^bytes 0-15\//);
  });

  test('rejects writes, unexpected Host values, and private files', async () => {
    const writeResponse = await request('/', { method: 'POST' });
    const hostResponse = await request('/', { headers: { Host: 'example.test' } });
    const privateResponse = await request('/README.md');
    assert.equal(writeResponse.statusCode, 405);
    assert.equal(writeResponse.headers.allow, 'GET, HEAD');
    assert.equal(hostResponse.statusCode, 421);
    assert.equal(privateResponse.statusCode, 404);
  });
});
