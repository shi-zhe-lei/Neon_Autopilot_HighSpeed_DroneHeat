/* A texture identity publication clock must precede GPU upload and exclude private or retired visual work. */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
global.window = globalThis;
const previousWarn = console.warn;
console.warn = () => {};
const THREE = require(path.join(root, 'vendor/three-0.160.0.min.js'));
console.warn = previousWarn;
global.THREE = THREE;
require(path.join(root, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js'));
require(path.join(root, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'));
require(path.join(root, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js'));
require(path.join(root, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js'));
const { createI18n } = require(path.join(root, 'src/ui/Neon_Autopilot_V23_HighSpeed_DroneHeat.i18n.js'));
const track = global.NeonV23Track;
const visualsFactory = global.NeonV23CloverleafVisuals;
const tilePoolFactory = global.NeonV23CloverleafTilePool;

/** Labels need only Canvas 2D drawing methods; production mesh and texture ownership remain real. */
function installCanvasStub() {
  const previous = global.document;
  global.document = {
    createElement() {
      return {
        width: 0, height: 0,
        getContext() {
          return { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
            fillRect() {}, strokeRect() {}, fillText() {} };
        }
      };
    }
  };
  return () => {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  };
}

/** Hold scheduler callbacks so tests can inspect publication before any renderer or later prewarm task runs. */
function createScheduler() {
  const critical = new Map();
  const idle = new Map();
  let serial = 0;
  return {
    requestCriticalCallback(callback) { const id = ++serial; critical.set(id, callback); return id; },
    cancelCriticalCallback(id) { critical.delete(id); },
    requestIdleCallback(callback) { const id = ++serial; idle.set(id, callback); return id; },
    cancelIdleCallback(id) { idle.delete(id); },
    runCritical() {
      const item = critical.entries().next().value;
      assert.ok(item, 'A required resident has no critical callback');
      critical.delete(item[0]);
      item[1]({ didTimeout: true, timeRemaining: () => 4 });
    }
  };
}

test('real resident and atlas identity publication changes revision before GPU upload, while geometry and disposal do not', () => {
  const restoreDocument = installCanvasStub();
  const previousI18n = global.NeonV23I18n;
  const i18n = createI18n({}, { document: null, autoApply: false });
  global.NeonV23I18n = i18n;
  const scheduler = createScheduler();
  const created = [];
  const callbacks = [];
  const scene = new THREE.Scene();
  let pool = null;
  try {
    pool = tilePoolFactory.create({
      THREE, track, modeling: global.NeonV23Modeling, scene,
      qualityProfile: { id: 'mobile' }, renderQualityId: 'high', prepareRecoveryVariants: false,
      ...scheduler,
      visualFactory: {
        create: visualsFactory.create,
        createBuildJob(options) {
          const before = pool.getTextureRevision();
          assert.equal(options.onPresentationTexturesChanged(), false);
          assert.equal(pool.getTextureRevision(), before, 'An unregistered builder dirtied texture publication');
          callbacks.push(options.onPresentationTexturesChanged);
          const job = visualsFactory.createBuildJob(options);
          let finished = null;
          return {
            ...job,
            finish() {
              const visual = job.finish();
              if (!finished) created.push({ visual, scopedTrack: options.track });
              finished = visual;
              return visual;
            }
          };
        }
      }
    });
    assert.equal(pool.getTextureRevision(), 0);
    const plan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
    const cursor = track.getInitialRouteCursor({ pathPlan: plan });
    const origin = track.sampleRouteCursor(cursor, 0, {});
    const update = () => pool.update({ origin, pathPlan: plan, routeCursor: cursor });
    update();
    let steps = 0;
    while (!pool.isInitialRouteReady()) {
      assert.ok(++steps < 10_000);
      scheduler.runCritical();
      update();
    }
    assert.equal(created.length, 2);
    assert.equal(pool.getTextureRevision(), created.length, 'Each complete registered tile publishes exactly once');
    const initialRevision = pool.getTextureRevision();
    for (let frame = 0; frame < 60; frame++) update();
    assert.equal(pool.getTextureRevision(), initialRevision, 'Resident reuse or stable frames republished textures');

    const tile = plan.tiles[1];
    const resident = created.find((item) => item.scopedTrack.graph.tile.token === tile.token);
    assert.ok(resident, 'The opening next resident was not published');
    const opposingPlan = track.prepareOpposingRecoveryPathPlan(plan, tile);
    const opposingTile = opposingPlan.tiles.find((item) => item.token === tile.token);
    const opposingGraph = tilePoolFactory.graphForTile(track, opposingTile, opposingPlan, { includeRecovery: true });
    const opposingTrack = {
      ...resident.scopedTrack,
      graph: opposingGraph,
      getEdge(id) { return opposingGraph.edgesById[id] || track.getEdge(id); },
      getNode(id) { return opposingGraph.nodesById[id] || track.getNode(id); },
      getMovement(id) { return opposingGraph.movementsById[id] || track.getMovement(id); },
      enumerateMovements() { return opposingGraph.movements; }
    };
    const variant = resident.visual.createRecoveryVariantJob({
      track: opposingTrack, signature: opposingGraph.recoveryVariantSignature
    });
    let variantSteps = 0;
    while (!variant.step(4)) assert.ok(++variantSteps < 100_000);
    assert.equal(resident.visual.installRecoveryVariant(variant.finish()), true);
    const opposingCursor = track.RoutePosition({
      edgeId: opposingTile.edgeIds[0], edgeS: 10, tileIndex: opposingTile.index
    });
    pool.update({
      origin: track.sampleRouteCursor(opposingCursor, 0, {}),
      pathPlan: opposingPlan, routeCursor: opposingCursor
    });
    assert.equal(resident.visual.diagnostics.activeRecoverySignature, opposingGraph.recoveryVariantSignature);
    assert.equal(pool.getTextureRevision(), initialRevision, 'A geometry-only variant falsely published a texture');

    const oldAtlases = created.map(({ visual }) => visual.exitSigns.material.map);
    assert.equal(i18n.setLanguage('en', { apply: false, persist: false }), true);
    assert.equal(pool.getTextureRevision(), initialRevision + created.length);
    for (const [index, { visual }] of created.entries()) {
      assert.notEqual(visual.exitSigns.material.map, oldAtlases[index]);
      assert.equal(visual.exitSigns.userData.syncLanguage(), false, 'Same atlas identity did not reuse its lease');
    }
    const translatedRevision = pool.getTextureRevision();
    i18n.setLanguage('en', { apply: false, persist: false });
    const hdr = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    scene.environment = hdr;
    hdr.needsUpdate = true;
    hdr.needsUpdate = true;
    assert.equal(pool.getTextureRevision(), translatedRevision, 'Unrelated texture content versions entered navigation identity state');
    hdr.dispose();
    scene.environment = null;
    pool.dispose();
    i18n.setLanguage('zh-CN', { apply: false, persist: false });
    for (const callback of callbacks) assert.equal(callback(), false);
    for (const { visual } of created) assert.equal(visual.exitSigns.userData.syncLanguage(), false);
    assert.equal(pool.getTextureRevision(), translatedRevision, 'A disposed visual retained its publication listener');
  } finally {
    pool?.dispose();
    i18n.disconnect();
    if (previousI18n === undefined) delete global.NeonV23I18n;
    else global.NeonV23I18n = previousI18n;
    restoreDocument();
  }
});

test('a failed visual registration cannot publish through its retained atlas callback', () => {
  const scheduler = createScheduler();
  const failure = new Error('Texture publication registration fixture');
  let failedCallback = null;
  let disposeCount = 0;
  const pool = tilePoolFactory.create({
    track, prepareRecoveryVariants: false, ...scheduler,
    visualFactory: {
      create(options) {
        failedCallback = options.onPresentationTexturesChanged;
        return {
          setRenderQuality() { throw failure; },
          dispose() { disposeCount++; },
          update() {}, setPalette() {}
        };
      }
    }
  });
  try {
    const plan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
    const cursor = track.getInitialRouteCursor({ pathPlan: plan });
    assert.throws(() => pool.update({
      origin: track.sampleRouteCursor(cursor, 0, {}), pathPlan: plan, routeCursor: cursor
    }), (error) => error === failure);
    assert.equal(disposeCount, 1);
    assert.equal(pool.getTextureRevision(), 0);
    assert.equal(failedCallback(), false);
    assert.equal(pool.getTextureRevision(), 0);
  } finally {
    pool.dispose();
  }
});
