#!/usr/bin/env node
/** HUD-safe camera layout and unchanged texture quality / HUD 相机安全布局与原始纹理画质。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const runtime = readFileSync(path.join(__dirname,
  '../../src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'), 'utf8');

/** Extract production functions rather than duplicating the rectangle or texture-filter implementation. */
function functionSource(name) {
  const start = runtime.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = runtime.indexOf('\n  }', start);
  assert.ok(end > start);
  return runtime.slice(start, end + 4);
}

const resolveSafeRect = new Function(`${functionSource('resolveCameraHudSafeRect')}; return resolveCameraHudSafeRect;`)();

test('HUD safe rectangles avoid measured controls and preserve a usable center on phone, small desktop, and tablet', () => {
  for (const [width, height] of [[320, 568], [390, 844], [568, 320], [640, 480], [800, 450], [900, 700], [834, 1_194]]) {
    const boxes = [
      { left: 8, top: 8, right: width * 0.48, bottom: 96 },
      { left: width - 108, top: 8, right: width - 8, bottom: 108 },
      { left: width * 0.18, top: height - 56, right: width * 0.84, bottom: height - 8 }
    ];
    for (const withDrawer of [false, true]) {
      const occluders = withDrawer
        ? [...boxes, { left: 8, top: 112, right: width * 0.38, bottom: height - 64 }]
        : boxes;
      const result = resolveSafeRect(width, height, occluders);
      assert.equal(result.blocked, false);
      assert.ok(result.left >= 0 && result.top >= 0 && result.right <= width && result.bottom <= height);
      assert.ok(result.right - result.left >= width * 0.48, 'do not choose a tall but unusable side gutter');
      assert.ok(result.bottom - result.top >= height * 0.30);
      for (const box of occluders) {
        assert.ok(result.right <= box.left || result.left >= box.right
          || result.bottom <= box.top || result.top >= box.bottom, 'the chosen flight area must not overlap HUD');
      }
    }
  }
  assert.equal(resolveSafeRect(640, 480, [{ left: -1, top: -1, right: 641, bottom: 481 }]).blocked, true);
  assert.deepEqual(resolveSafeRect(640, 480, []), {
    left: 6, top: 6, right: 634, bottom: 474, width: 640, height: 480, blocked: false
  });
});

test('layout signals coalesce into one measurement and update the same camera object only after a real layout change', () => {
  let reads = 0;
  const callbacks = [];
  const box = { left: 28, top: 38, right: 240, bottom: 110, width: 212, height: 72 };
  const visible = { closest: () => null, getBoundingClientRect: () => { reads++; return box; } };
  const hidden = { closest: () => ({}), getBoundingClientRect: () => { throw new Error('hidden HUD must not be measured'); } };
  const state = new Function('document', 'window', 'renderer', 'getComputedStyle', `
    let fatalRuntimeLocked = false;
    let presentationResourcesDisposed = false;
    let cameraHudSafeRectFrameId = null;
    let cameraHudMeasurementCount = 0;
    const cameraHudSafeRect = { revision: 0 };
    ${functionSource('resolveCameraHudSafeRect')}
    ${functionSource('measureCameraHudSafeRect')}
    ${functionSource('queueCameraHudSafeRectSync')}
    return { queue: queueCameraHudSafeRectSync, rect: cameraHudSafeRect,
      count: () => cameraHudMeasurementCount, stop: () => { presentationResourcesDisposed = true; } };
  `)(
    { querySelectorAll: () => [visible, hidden] },
    { requestAnimationFrame: (callback) => callbacks.push(callback) },
    { domElement: { getBoundingClientRect: () => ({ left: 20, top: 30, width: 640, height: 480 }) } },
    () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  );
  for (let index = 0; index < 100; index++) state.queue();
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(reads, 1);
  assert.equal(state.rect.measuredOccluders, 1);
  assert.equal(state.rect.revision, 1);
  const stable = { ...state.rect };
  state.queue(); callbacks.shift()();
  assert.equal(state.rect.revision, 1);
  assert.deepEqual(state.rect, stable);
  box.bottom += 80; box.height += 80;
  state.queue(); callbacks.shift()();
  assert.equal(state.rect.revision, 2);
  assert.equal(state.count(), 3);
  state.stop(); state.queue(); callbacks.shift()();
  assert.equal(state.count(), 3, 'unload must not access disposed presentation');
});

test('Low and Medium streaming skip texture scans while explicit High transitions preserve authored filtering', () => {
  let scans = 0;
  const stone = { anisotropy: 2, needsUpdate: false };
  const road = { anisotropy: 4, needsUpdate: false };
  const textures = new Set([stone, road]);
  const rig = new Function('authoredSceneTextures', `
    const anisotropyOriginalValues = new WeakMap();
    let activeRenderQuality = { maximumAnisotropy: false };
    const renderer = { info: { memory: { textures: 2 } } };
    let anisotropyTextureMemoryCount = -1;
    let anisotropyTextureRevision = -1;
    let textureRevision = 0;
    const cloverleafVisuals = { getTextureRevision: () => textureRevision };
    let maximumRendererAnisotropy = 16;
    let effectiveTextureAnisotropy = 1;
    let anisotropicTextureCount = 0;
    ${functionSource('syncTextureAnisotropy')}
    return { frame(count) { renderer.info.memory.textures = count; syncTextureAnisotropy(); },
      publishTextures() { textureRevision++; },
      quality(high) { activeRenderQuality.maximumAnisotropy = high ? 'renderer-maximum' : false; syncTextureAnisotropy(true); } };
  `)(() => { scans++; return textures; });
  for (let frame = 0; frame < 600; frame++) rig.frame(frame % 5);
  assert.equal(scans, 0);
  assert.equal(stone.anisotropy, 2);
  rig.quality(true);
  assert.equal(stone.anisotropy, 16);
  assert.equal(road.anisotropy, 16);
  rig.quality(false);
  assert.equal(stone.anisotropy, 2);
  assert.equal(road.anisotropy, 4);
  const newTile = { anisotropy: 8, needsUpdate: false };
  textures.add(newTile);
  rig.frame(3);
  assert.equal(scans, 2);
  assert.equal(newTile.needsUpdate, false);
  rig.quality(true); rig.quality(false);
  assert.equal(newTile.anisotropy, 8);
  rig.quality(true);
  const replacement = { anisotropy: 2, needsUpdate: false };
  textures.delete(newTile);
  textures.add(replacement);
  rig.publishTextures();
  rig.frame(3);
  assert.equal(replacement.anisotropy, 16, 'same-count tile replacements must have High filtering before their first draw');
  rig.quality(false);
  assert.equal(replacement.anisotropy, 2);
  assert.match(runtime, /const anisotropyOriginalValues = new WeakMap\(\)/,
    'quality metadata cannot own disposed tile textures');
});
