#!/usr/bin/env node
/** Moving-ship tunnel-light wiring / 移动船体隧道间接受光链。 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const runtime = fs.readFileSync(path.resolve(__dirname,
  '../../src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'), 'utf8');
const start = runtime.indexOf('function updateShipTunnelBounce()');
const end = runtime.indexOf('\n  }', start) + 4;
assert.ok(start > 0 && end > start);
const body = runtime.slice(start, end);

/** Execute the production bridge with frozen route authority and caller-owned presentation storage. */
function bridge(visuals, frame, ship, out) {
  return Function('cloverleafVisuals', 'playerFrameScratch', 'shipVisuals', 'shipTunnelBounce',
    `return (${body});`)(visuals, frame, ship, out);
}

test('every tier forwards the resolved road frame and reuses one probe without scanning dynamic fixtures', () => {
  const frame = Object.freeze({ edgeId: 'tile:1:loop', edgeS: 32, tunnelProfileId: 'loop-shell', covered: true });
  const out = {};
  let samples = 0;
  let writes = 0;
  const visuals = {
    getActiveCoveredRouteLightEmitters() { assert.fail('diffuse bounce cannot enumerate High-only emitters'); },
    sampleTunnelBounce(receivedFrame, receivedOut) {
      assert.equal(receivedFrame, frame);
      assert.equal(receivedOut, out);
      receivedOut.valid = true;
      receivedOut.enclosure = 0.5;
      receivedOut.irradiance = 0.05;
      receivedOut.red = 1;
      receivedOut.green = 0.74;
      receivedOut.blue = 0.42;
      samples++;
      return receivedOut;
    }
  };
  const update = bridge(visuals, frame, {
    setTunnelBounce(probe) {
      assert.equal(probe, out);
      assert.equal(probe.irradiance, 0.05, 'reference-albedo calibration belongs only in the ship shader');
      writes++;
    }
  }, out);
  for (let index = 0; index < 600; index++) update();
  assert.equal(samples, 600);
  assert.equal(writes, 600);
});

test('leaving a resident tunnel clears prior illumination even when the visual sampler disappears', () => {
  const out = { valid: true, enclosure: 1, irradiance: 0.10, red: 1, green: 0.74, blue: 0.42 };
  const cleared = { valid: false, enclosure: 0, irradiance: 0, red: 0, green: 0, blue: 0 };
  for (const visuals of [null, {}, { sampleTunnelBounce() {} }]) {
    Object.assign(out, { valid: true, enclosure: 1, irradiance: 0.10, red: 1, green: 0.74, blue: 0.42 });
    bridge(visuals, Object.freeze({ covered: false }), {
      setTunnelBounce(probe) { assert.deepEqual(probe, cleared); }
    }, out)();
    assert.deepEqual(out, cleared);
  }
});

test('the physical-lighting frame publishes bounce independently of local-light quality selection', () => {
  const lightingStart = runtime.indexOf('function updatePhysicalLighting(');
  const lightingEnd = runtime.indexOf('return lastPhysicalLightingState;', lightingStart);
  const lighting = runtime.slice(lightingStart, lightingEnd);
  assert.ok(lighting.indexOf('physicalLightingRig.update(') < lighting.indexOf('updateShipTunnelBounce();'));
  assert.doesNotMatch(body, /activeRenderQuality|new THREE|state\.[\w]+\s*=|camera\.|getActive.*Emitters/);
  assert.match(runtime, /shipTunnelBounce: \{ \.\.\.shipTunnelBounce \}/);
});
