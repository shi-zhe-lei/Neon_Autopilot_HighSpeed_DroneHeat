#!/usr/bin/env node
/* Local tunnel sky occlusion must follow authored surfaces without changing fixtures, exterior art, or residency. */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PREFIX = 'Neon_Autopilot_HighSpeed_DroneHeat';
global.window = globalThis;
const previousWarn = console.warn;
let THREE;
try {
  console.warn = () => {};
  THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
} finally {
  console.warn = previousWarn;
}
globalThis.THREE = THREE;
require(path.join(PROJECT_ROOT, `src/rendering/${PREFIX}.modeling.js`));
require(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.track.js`));
require(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.cloverleaf-tiles.js`));
require(path.join(PROJECT_ROOT, `src/navigation/${PREFIX}.cloverleaf.js`));
const visuals = globalThis.NeonCloverleafVisuals;
const track = globalThis.NeonTrack;
const modeling = globalThis.NeonModeling;
const tilePool = globalThis.NeonCloverleafTilePool;

/** Drive the public scheduler so these checks cover the same publication path used during flight. */
function finishJob(job) {
  for (let index = 0; index < 100_000; index++) {
    if (job.step(4)) return job.finish();
  }
  assert.fail('Tunnel enclosure production build exceeded its finite work bound');
}

/** The atlas needs Canvas2D stubs; geometry, material, and variant checks use the real bundled Three objects. */
function installCanvasDocumentStub() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(contextId) {
          assert.equal(contextId, '2d');
          return {
            beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
            fillRect() {}, strokeRect() {}, fillText() {}
          };
        }
      };
    }
  };
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

/** Assert the GPU-facing scalar contract, including an empty recovery slot before its first publication. */
function enclosureAttribute(geometry, expectedCount = geometry.getAttribute('position').count) {
  const attribute = geometry.getAttribute('tunnelEnclosure');
  assert.ok(attribute, 'A tunnel receiver has no local enclosure attribute');
  assert.equal(attribute.itemSize, 1);
  assert.equal(attribute.count, expectedCount);
  assert.equal(geometry.userData.tunnelEnclosureContractVersion, 1);
  for (const value of attribute.array) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  return attribute;
}

function disposeBatch(batch) {
  batch.roadShellGeometry.dispose();
  batch.staticLineGeometry.dispose();
  batch.decorativeLaneGeometry.dispose();
}

test('authored tunnel portals have continuous sky masks independent of fixture phase and open bridges', () => {
  const profile = Object.freeze({
    kind: 'underground-tunnel', startS: 0, endS: 300,
    surfaceStartS: 100, surfaceEndS: 700, portalBlend: 42
  });
  const sample = visuals.sampleTunnelEnclosure;
  assert.equal(Object.isFrozen(visuals.tunnelEnclosureContract), true);
  assert.equal(visuals.tunnelEnclosureContract.attribute, 'tunnelEnclosure');
  assert.equal(visuals.tunnelEnclosureContract.additionalDrawGroupCount, 0);
  assert.equal(visuals.tunnelEnclosureContract.fixtureDistanceGated, false);
  for (const s of [0, 99, 100, 700, 701, NaN]) assert.equal(sample(profile, s), 0);
  for (const [distance, expected] of [[0, 0], [21, 0.103_515_625], [42, 0.5], [63, 0.896_484_375], [84, 1]]) {
    assert.equal(sample(profile, 100 + distance), expected);
    assert.equal(sample(profile, 700 - distance), expected);
  }
  assert.ok(sample(profile, 100.001) < 0.000_001);
  assert.ok(sample(profile, 699.999) < 0.000_001);
  for (const s of [121, 142, 400, 679]) {
    assert.equal(sample({ ...profile, kind: 'cloverleaf-underpass', underpassBlend: 1 }, s), 0);
    assert.equal(sample({ ...profile, luminaireStations: [121, 149], lampIntensity: 24_000 }, s), sample(profile, s));
    assert.equal(sample({ ...profile, luminaireStations: [], lampIntensity: 0 }, s), sample(profile, s));
  }
});

test('production road merges preserve enclosure scalars and fill missing-source attributes with outdoor sky access', () => {
  for (const qualityId of ['desktop', 'mobile']) {
    const captured = [];
    const setAttribute = THREE.BufferGeometry.prototype.setAttribute;
    let batch = null;
    let missingSource = null;
    THREE.BufferGeometry.prototype.setAttribute = function captureEnclosure(name, attribute) {
      if (name === 'tunnelEnclosure') captured.push(this);
      const result = setAttribute.call(this, name, attribute);
      // Exercise the optional-source merge path with real nonzero neighboring buffers. Current track templates
      // intentionally contain no junction apron, so merely inspecting their empty apron list would be vacuous.
      if (qualityId === 'mobile' && name === 'tunnelEnclosure' && !missingSource
        && attribute.array.some((value) => value > 0)) {
        missingSource = this;
        this.deleteAttribute(name);
      }
      return result;
    };
    try {
      batch = finishJob(visuals.createGeometryBatchAuditJob({
        THREE, track, qualityProfile: { id: qualityId }
      }));
    } finally {
      THREE.BufferGeometry.prototype.setAttribute = setAttribute;
    }
    try {
      const merged = enclosureAttribute(batch.roadShellGeometry);
      const sourceRoads = captured.filter((geometry) => geometry.userData.maximumRoadHalfError !== undefined);
      assert.equal(sourceRoads.length, batch.edges.length);
      let mergedOffset = 0;
      let deepRoadRows = 0;
      const deepIrradianceValues = new Set();
      for (let edgeIndex = 0; edgeIndex < batch.edges.length; edgeIndex++) {
        const edge = batch.edges[edgeIndex];
        const geometry = sourceRoads[edgeIndex];
        if (geometry === missingSource) {
          const count = geometry.getAttribute('position').count;
          assert.equal(geometry.hasAttribute('tunnelEnclosure'), false);
          assert.ok(geometry.getAttribute('staticTunnelIrradiance').array.some((value) => value > 0));
          assert.equal(merged.array.subarray(mergedOffset, mergedOffset + count)
            .every((value) => value === 0), true, 'An absent source mask inherited neighboring enclosure values');
          mergedOffset += count;
          continue;
        }
        const enclosure = enclosureAttribute(geometry);
        const irradiance = geometry.getAttribute('staticTunnelIrradiance');
        assert.deepEqual(merged.array.subarray(mergedOffset, mergedOffset + enclosure.count), enclosure.array);
        mergedOffset += enclosure.count;
        const rows = Math.max(6, Math.ceil(edge.length / batch.sampleStep));
        for (let row = 0; row <= rows; row++) {
          const s = edge.length * row / rows;
          const expected = Math.fround(Math.max(0, ...(edge.tunnelProfiles || []).map(
            (profile) => visuals.sampleTunnelEnclosure(profile, s)
          )));
          for (let side = 0; side < 12; side++) {
            assert.equal(enclosure.getX(row * 12 + side), side >= 3 && side <= 6 ? expected : 0,
              `${qualityId} ${edge.id} row ${row} side ${side}`);
          }
          if (expected === 1) {
            deepRoadRows++;
            deepIrradianceValues.add(irradiance.getX(row * 12 + 4).toFixed(4));
          }
        }
      }
      assert.ok(deepRoadRows > 100);
      assert.ok(deepIrradianceValues.size > 10, 'Local enclosure began following the pulsed fixture envelope');
      if (qualityId === 'mobile') assert.ok(missingSource);
    } finally {
      disposeBatch(batch);
    }
  }
});

test('real tunnel shells occlude only the interior with smooth portals and a stable deep-tunnel floor', () => {
  for (const qualityId of ['desktop', 'mobile']) {
    for (const kind of ['underground-tunnel', 'mountain-tunnel']) {
      const edge = track.graph.edges.find((candidate) => candidate.tunnelProfiles.some((profile) => profile.kind === kind));
      const profile = edge.tunnelProfiles.find((candidate) => candidate.kind === kind);
      const audit = visuals.createTunnelShellGeometryAudit({
        THREE, track, qualityProfile: { id: qualityId }, edges: [{ ...edge, tunnelProfiles: [profile] }]
      });
      try {
        const enclosure = enclosureAttribute(audit.geometry);
        const irradiance = audit.geometry.getAttribute('staticTunnelIrradiance');
        const ringSize = kind === 'mountain-tunnel' ? 4 : 12;
        const interiorCount = kind === 'mountain-tunnel' ? 2 : 4;
        assert.equal(enclosure.count % ringSize, 0);
        let previous = 0;
        let maximum = 0;
        let partialRows = 0;
        const deepIrradianceValues = new Set();
        for (let start = 0; start < enclosure.count; start += ringSize) {
          const value = enclosure.getX(start);
          assert.ok(Math.abs(value - previous) < 0.12, 'Portal sky mask contains a discontinuity');
          previous = value;
          maximum = Math.max(maximum, value);
          if (value > 0 && value < 1) partialRows++;
          if (value === 1) deepIrradianceValues.add(irradiance.getX(start).toFixed(4));
          for (let side = 0; side < ringSize; side++) {
            assert.equal(enclosure.getX(start + side), side < interiorCount ? value : 0);
          }
        }
        assert.equal(enclosure.getX(0), 0);
        assert.equal(enclosure.getX(enclosure.count - ringSize), 0);
        assert.equal(maximum, 1);
        assert.ok(partialRows > 10);
        assert.ok(deepIrradianceValues.size > 10);
      } finally {
        audit.geometry.dispose();
      }
    }
  }
});

test('all three receiver families and atomic recovery swaps retain local enclosure without another draw', () => {
  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  try {
    const plan = track.createPathPlan({ movementId: 'west-straight', futureMovementKind: 'straight' });
    const tile = plan.tiles[1];
    const graph = tilePool.graphForTile(track, tile, plan, { includeRecovery: true });
    const scopedTrack = Object.freeze({ ...track, graph });
    const scene = new THREE.Scene();
    visual = finishJob(visuals.createBuildJob({
      THREE, track: scopedTrack, modeling, scene, qualityProfile: { id: 'mobile' }, renderQualityId: 'high'
    }));
    const childCount = visual.group.children.length;
    enclosureAttribute(visual.roadShell.geometry);
    enclosureAttribute(visual.recoveryRoadShell.geometry);
    enclosureAttribute(visual.tunnelShells.geometry);
    const beamMask = enclosureAttribute(visual.beams.geometry, visual.beams.instanceMatrix.count);
    assert.equal(beamMask.isInstancedBufferAttribute, true);
    assert.ok(beamMask.array.some((value) => value === 1));
    let bridgeCount = 0;
    for (const blocker of visual.getCameraBlockers()) {
      if (blocker.kind !== 'carved-bridge-crossbeam') continue;
      bridgeCount++;
      assert.equal(beamMask.getX(blocker.instanceIndex), 0, 'An open bridge became a sealed tunnel receiver');
    }
    assert.ok(bridgeCount > 0);
    const opposingPlan = track.prepareOpposingRecoveryPathPlan(plan, tile);
    const opposingTile = opposingPlan.tiles.find((entry) => entry.token === tile.token);
    const opposingGraph = tilePool.graphForTile(track, opposingTile, opposingPlan, { includeRecovery: true });
    const opposingTrack = Object.freeze({ ...track, graph: opposingGraph });
    const variant = finishJob(visual.createRecoveryVariantJob({
      track: opposingTrack, signature: opposingGraph.recoveryVariantSignature
    }));
    const variantMask = enclosureAttribute(variant.template.roadShellGeometry);
    assert.ok(variantMask.count > 0);
    assert.equal(variantMask.array.every((value) => value === 0), true,
      'The elevated recovery crossover inherited a tunnel mask');
    assert.equal(visual.installRecoveryVariant(variant), true);
    assert.equal(visual.activateRecoveryVariant(variant.signature, opposingGraph, opposingTrack), true);
    assert.equal(visual.recoveryRoadShell.geometry.getAttribute('tunnelEnclosure'), variantMask);
    for (const quality of ['low', 'medium', 'high']) {
      visual.setRenderQuality(quality);
      assert.equal(visual.recoveryRoadShell.geometry.getAttribute('tunnelEnclosure'), variantMask);
      assert.equal(visual.group.children.length, childCount);
    }
    let localLightCount = 0;
    visual.group.traverse((object) => { if (object.isLight) localLightCount++; });
    assert.equal(localLightCount, 0);
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});
