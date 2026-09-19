#!/usr/bin/env node
/** Resident moving-receiver tunnel bounce / 驻留隧道对移动物体的间接漫反射采样。 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '../..');
const PREFIX = 'Neon_Autopilot_HighSpeed_DroneHeat';
global.window = globalThis;
const THREE = require(path.join(ROOT, 'vendor/three-0.160.0.min.js'));
globalThis.THREE = THREE;
require(path.join(ROOT, `src/rendering/${PREFIX}.modeling.js`));
require(path.join(ROOT, `src/navigation/${PREFIX}.track.js`));
require(path.join(ROOT, `src/navigation/${PREFIX}.cloverleaf.js`));
require(path.join(ROOT, `src/navigation/${PREFIX}.cloverleaf-tiles.js`));
const track = globalThis.NeonTrack;
const visuals = globalThis.NeonCloverleafVisuals;
const poolFactory = globalThis.NeonCloverleafTilePool;
const zero = Object.freeze({ valid: false, enclosure: 0, irradiance: 0, red: 0, green: 0, blue: 0 });

/** Only the sign atlas needs a no-raster Canvas; route sampling, geometry, materials, and pool are production code. */
function installCanvas() {
  const before = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return { width: 0, height: 0, getContext() {
        return { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
          fillRect() {}, strokeRect() {}, fillText() {} };
      } };
    }
  };
  return () => { if (before === undefined) delete globalThis.document; else globalThis.document = before; };
}

test('real tile-zero and runtime-tile frames receive only the authored diffuse floor with exact profile identity and lifecycle', () => {
  const restoreDocument = installCanvas();
  const published = [];
  const idle = new Map();
  let nextIdleId = 0;
  const scene = new THREE.Scene();
  const pool = poolFactory.create({
    THREE, track, scene, modeling: globalThis.NeonModeling,
    qualityProfile: { id: 'mobile' }, prepareRecoveryVariants: false,
    visualFactory: { create(options) {
      const visual = visuals.create(options);
      published.push({ visual, graph: options.track.graph });
      return visual;
    } },
    requestIdleCallback(callback) { const id = ++nextIdleId; idle.set(id, callback); return id; },
    cancelIdleCallback(id) { idle.delete(id); }
  });
  const out = { ...zero };
  try {
    const plan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
    const cursor = track.getInitialRouteCursor({ pathPlan: plan });
    const origin = track.sampleRouteCursor(cursor, 0, {});
    pool.update({ pathPlan: plan, routeCursor: cursor, origin });
    assert.ok(published.some(({ graph }) => graph.tile.index === 0));
    assert.ok(published.some(({ graph }) => graph.tile.index === 1));
    const revision = pool.getTextureRevision();
    const textureObjects = published.map(({ visual }) => visual.roadShell.material);
    let knownFrame = null;
    let knownVisual = null;
    let profileCount = 0;
    for (const { graph, visual } of published) {
      const checkedKinds = new Set();
      const emitterRecords = visual.getCoveredRouteLightEmitters();
      const childCount = visual.group.children.length;
      for (const edge of graph.edges) for (const profile of edge.tunnelProfiles || []) {
        if (checkedKinds.has(profile.kind)) continue;
        checkedKinds.add(profile.kind);
        const floor = profile.kind === 'underground-tunnel' ? 0.10 : 0.08;
        const start = profile.surfaceStartS;
        const end = profile.surfaceEndS;
        const middle = (start + end) * 0.5;
        const frame = track.sampleEdge(edge.id, middle, 0, {});
        assert.equal(frame.tunnelProfileId, profile.id, 'the complete real sampled frame must identify its resident profile');
        assert.equal(pool.sampleTunnelBounce(frame, out), out);
        assert.deepEqual(out, { valid: true, enclosure: 1, irradiance: floor, red: 1, green: 0.74, blue: 0.42 });
        assert.equal(visual.sampleTunnelBounce(edge.id, middle, out), out);
        assert.equal(out.irradiance, floor);
        for (const quality of ['low', 'medium', 'high']) {
          visual.setRenderQuality(quality);
          for (const s of [start + 0.001, start + 10, middle - 5, middle, middle + 5, end - 10, end - 0.001]) {
            const enclosure = visuals.sampleTunnelEnclosure(profile, s);
            const sample = track.sampleEdge(edge.id, s, 0, {});
            pool.sampleTunnelBounce(sample, out);
            assert.equal(out.valid, true);
            assert.equal(out.enclosure, enclosure);
            assert.equal(out.irradiance, floor * enclosure, 'fixture peaks cannot become duplicate direct lighting');
          }
        }
        for (const s of [start - 1, start, end, end + 1, NaN]) {
          visual.sampleTunnelBounce(edge.id, s, out, profile.id);
          assert.deepEqual(out, zero, 'portal/exterior samples clear every field of reused output');
        }
        visual.sampleTunnelBounce(edge.id, middle, out, 'another-profile');
        assert.deepEqual(out, zero);
        for (const invalid of [
          { ...frame, covered: false }, { ...frame, edgeS: NaN },
          { ...frame, tunnelKind: 'cloverleaf-underpass' }, { ...frame, tunnelProfileId: 'another-profile' },
          { ...frame, tileToken: 'wrong-tile' }, { ...frame, tileIndex: 9_999 },
          { ...frame, edgeId: 'missing-edge' }, null
        ]) {
          pool.sampleTunnelBounce(frame, out);
          pool.sampleTunnelBounce(invalid, out);
          assert.deepEqual(out, zero);
        }
        knownFrame = frame;
        knownVisual = visual;
        profileCount++;
      }
      assert.ok(checkedKinds.has('underground-tunnel') && checkedKinds.has('mountain-tunnel'));
      assert.equal(visual.getCoveredRouteLightEmitters(), emitterRecords);
      assert.equal(visual.group.children.length, childCount);
    }
    assert.ok(profileCount >= 4);
    for (let frame = 0; frame < 10_000; frame++) {
      assert.equal(pool.sampleTunnelBounce(knownFrame, out), out);
      assert.equal(out.valid, true);
    }
    assert.equal(pool.getTextureRevision(), revision, 'receiver sampling cannot publish textures');
    published.forEach(({ visual }, index) => {
      visual.setRenderQuality('medium');
      assert.equal(visual.roadShell.material, textureObjects[index]);
    });
    const futureGraph = poolFactory.graphForTile(track, plan.tiles[2], plan, { includeRecovery: false });
    const futureEdge = futureGraph.edges.find((edge) => edge.tunnelProfiles?.length);
    const futureProfile = futureEdge.tunnelProfiles[0];
    const futureFrame = track.sampleEdge(futureEdge.id, (futureProfile.surfaceStartS + futureProfile.surfaceEndS) * 0.5, 0, {});
    pool.sampleTunnelBounce(futureFrame, out);
    assert.deepEqual(out, zero, 'a registered future route is not a visible resident');
    knownVisual.update({ visible: false });
    pool.sampleTunnelBounce(knownFrame, out);
    assert.deepEqual(out, zero);
    knownVisual.sampleTunnelBounce(knownFrame.edgeId, knownFrame.edgeS, out);
    assert.deepEqual(out, zero);
    pool.update({ pathPlan: plan, routeCursor: cursor, origin });
    pool.sampleTunnelBounce(knownFrame, out);
    assert.equal(out.valid, true);
    pool.update({ pathPlan: { tiles: [] } });
    pool.sampleTunnelBounce(knownFrame, out);
    assert.deepEqual(out, zero, 'empty-route invalidation stops retained resident light immediately');
    pool.dispose();
    pool.sampleTunnelBounce(knownFrame, out);
    assert.deepEqual(out, zero);
    knownVisual.sampleTunnelBounce(knownFrame.edgeId, knownFrame.edgeS, out);
    assert.deepEqual(out, zero, 'a disposed visual cannot keep lighting a moving receiver');
    assert.equal(idle.size, 0);
  } finally {
    pool.dispose();
    restoreDocument();
  }
});
