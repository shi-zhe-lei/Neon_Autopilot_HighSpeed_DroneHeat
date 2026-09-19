#!/usr/bin/env node
/* Production build slicing must preserve geometry and release every unpublished resource on cancellation. */
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = globalThis;
const originalConsoleWarn = console.warn;
let THREE;
try {
  console.warn = () => {};
  THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
} finally {
  console.warn = originalConsoleWarn;
}
globalThis.THREE = THREE;
require(path.join(PROJECT_ROOT, 'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.modeling.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.track.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf.js'));

const visuals = globalThis.NeonCloverleafVisuals;
const track = globalThis.NeonTrack;
const modeling = globalThis.NeonModeling;
const MAXIMUM_BUILD_STEPS = 100_000;
const SLICE_BUDGET_MS = 0.1;

// Captured from the original synchronous production builder before slicing. Comparing only two new callers
// would miss a shared regression in station order, winding, Float32 normal accumulation, or authored lighting.
const ORIGINAL_TUNNEL_BUFFERS = Object.freeze({
  desktop: Object.freeze({
    position: '16eb368fb6772f47802337530138f0c1367b789cce540cf6c832b50698d58504',
    color: 'dba6c126a39c7162f3c454e88253f27bfb82ea022abd51a1535d3cd47ebe3627',
    staticTunnelIrradiance: 'b6963bbc5d90e8b60e769d803f435e6f8c3a1b8bd09376aa65549c9968d74d8f',
    normal: 'bb5cebb6e5bd2b51ac6ea117e323b92f878c2c49f8c5541a8e494a52897b00ed',
    index: '5cf7fda0cb974408a8f0112eb70f5aaa025acd60fd90bab20f4afd630cb5a7e9',
    radius: 651.597_412_348_310_4
  }),
  mobile: Object.freeze({
    position: 'dea51c9c194d6a508cdd31b74f6329035fee5d2444e59b4319c451e946497f47',
    color: 'c8a5f706d29d5a4fbb89ecc851edfcaf59e2fa343fe42050c914751e9b3425e5',
    staticTunnelIrradiance: '3e8b493f0f28d7b4d0a4b39ad6730fc4dfac50b7f9b5be64b03660763f46ff9c',
    normal: 'f0cc6da718cf21370d1e4315677d8a3d43af781da30db0fd69740c220f20bfbf',
    index: '3869961f44004ba1a306da4d18cd7d84fbd2eb3a75634d9f802982056873e34c',
    radius: 651.596_355_989_548_3
  })
});

/** Supply only exit-atlas raster calls; no renderer or WebGL context participates in this CPU regression. */
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

/** Make time-budget exits deterministic without turning host performance or GC delays into CI requirements. */
function withDeterministicClock(callback) {
  const previousPerformance = globalThis.performance;
  let elapsedMs = 0;
  const previousAttributeReaders = new Map();
  // Normals and bounds perform real attribute reads. Charge those reads a deterministic work cost so removing
  // the deadline check fails even if the microstep-count ceiling remains and performance.now() is called less.
  for (const name of ['getX', 'getY', 'getZ']) {
    const original = THREE.BufferAttribute.prototype[name];
    previousAttributeReaders.set(name, original);
    THREE.BufferAttribute.prototype[name] = function measuredAttributeRead(...args) {
      elapsedMs += 0.000_005;
      return original.apply(this, args);
    };
  }
  globalThis.performance = Object.freeze({
    now() {
      const sampledAt = elapsedMs;
      elapsedMs += 0.025;
      return sampledAt;
    }
  });
  try {
    return callback(() => elapsedMs);
  } finally {
    globalThis.performance = previousPerformance;
    for (const [name, original] of previousAttributeReaders) {
      THREE.BufferAttribute.prototype[name] = original;
    }
  }
}

function buildOptions(scene, qualityProfileId = 'desktop', three = THREE) {
  return {
    THREE: three,
    track,
    modeling,
    scene,
    qualityProfile: Object.freeze({ id: qualityProfileId }),
    renderQualityId: 'medium'
  };
}

/** Keep the existing road-template scheduler's normal budget; exercise the newly sliced assembly at its minimum. */
function advanceBuild(job) {
  return job.step(job.diagnostics.lastStepLabel?.startsWith('visual-') ? SLICE_BUDGET_MS : 4);
}

/** Observe only public build steps; no generator internals are driven independently of the production job. */
function finishBuild(job, scene, readClock = null) {
  const labels = new Map();
  for (let stepIndex = 0; stepIndex < MAXIMUM_BUILD_STEPS; stepIndex++) {
    const previousLabel = job.diagnostics.lastStepLabel;
    const startedAt = readClock?.();
    const complete = advanceBuild(job);
    const label = job.diagnostics.lastStepLabel;
    if (readClock && previousLabel?.startsWith('visual-tunnel-shell-')
      && previousLabel !== 'visual-tunnel-shell-finalize' && label?.startsWith('visual-tunnel-shell-')) {
      // Allow the indivisible final microstep and clock-read overhead; running to the count ceiling instead of
      // honoring the 0.1 ms deadline exceeds this bound during the actual normal/bounds buffer traversal.
      assert.ok(
        readClock() - startedAt <= 0.25 + 0.000_001,
        `${previousLabel} ignored its ${SLICE_BUDGET_MS} ms deadline before ${label}`
      );
    }
    labels.set(label, (labels.get(label) || 0) + 1);
    if (complete) return { visual: job.finish(), labels };
    assert.equal(scene.children.length, 0, `${label} published an incomplete visual`);
  }
  assert.fail('Production visual build failed to complete within its deterministic work bound');
}

function bufferHash(attribute) {
  const array = attribute.array;
  return createHash('sha256')
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest('hex');
}

/** Lock visible surfaces, material attributes, winding, and culling to the original production geometry. */
function assertOriginalTunnelGeometry(geometry, qualityProfileId) {
  const expected = ORIGINAL_TUNNEL_BUFFERS[qualityProfileId];
  for (const name of ['position', 'color', 'staticTunnelIrradiance', 'normal']) {
    assert.equal(bufferHash(geometry.getAttribute(name)), expected[name], `${qualityProfileId} ${name}`);
  }
  assert.equal(bufferHash(geometry.index), expected.index, `${qualityProfileId} index`);
  assert.deepEqual(geometry.boundingSphere.center.toArray(), [0, 9.943_853_139_877_32, 0]);
  assert.equal(geometry.boundingSphere.radius, expected.radius);
}

/** Snapshot ownership rather than cache-hit counters, which legitimately increase on every attempted build. */
function sharedTemplateOwnership() {
  return visuals.getSharedTemplateDiagnostics().entries.map(({ key, state, refCount, waiterCount }) => (
    { key, state, refCount, waiterCount }
  )).sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Observe resources created through public Three constructors and clone paths, including intermediate geometry
 * disposed by modeling helpers. Existing shared buffers are deliberately outside the owned allocation set.
 */
function trackDisposableResources() {
  const allocations = new Set();
  const disposalCounts = new Map();
  const restorers = [];
  const roots = [THREE.BufferGeometry, THREE.Material, THREE.Texture];
  const remember = (resource) => {
    allocations.add(resource);
    return resource;
  };
  for (const Resource of roots) {
    const prototype = Resource.prototype;
    const originalDispose = prototype.dispose;
    const originalClone = prototype.clone;
    prototype.dispose = function observedDispose(...args) {
      disposalCounts.set(this, (disposalCounts.get(this) || 0) + 1);
      return originalDispose.apply(this, args);
    };
    prototype.clone = function observedClone(...args) {
      return remember(originalClone.apply(this, args));
    };
    restorers.push(() => {
      prototype.dispose = originalDispose;
      prototype.clone = originalClone;
    });
  }
  const observedThree = { ...THREE };
  for (const [name, Constructor] of Object.entries(THREE)) {
    if (typeof Constructor !== 'function' || !Constructor.prototype) continue;
    if (!roots.some((Root) => Constructor === Root || Constructor.prototype instanceof Root)) continue;
    observedThree[name] = new Proxy(Constructor, {
      construct(Target, args) {
        return remember(Reflect.construct(Target, args));
      }
    });
  }
  return {
    three: observedThree,
    allocations,
    disposalCounts,
    restore() {
      for (const restore of restorers.reverse()) restore();
    }
  };
}

test('budgeted production assembly preserves both original tunnel geometries and exposes resumable stages', () => {
  const restoreDocument = installCanvasDocumentStub();
  try {
    withDeterministicClock((readClock) => {
      for (const qualityProfileId of ['desktop', 'mobile']) {
        const scene = new THREE.Scene();
        const job = visuals.createBuildJob(buildOptions(scene, qualityProfileId));
        let visual;
        let audit;
        try {
          assert.throws(() => job.finish(), /not complete/);
          const built = finishBuild(job, scene, readClock);
          visual = built.visual;
          for (const stage of [
            'bridge-support-allocation', 'bridge-cap-allocation', 'bridge-profile-allocation',
            'bridge-beam-allocation', 'bridge-light-allocation',
            'tunnel-shell-refine', 'tunnel-shell-alignment', 'tunnel-shell-vertices', 'tunnel-shell-indices',
            'tunnel-shell-attributes', 'tunnel-shell-normals', 'tunnel-shell-normalize',
            'tunnel-shell-bounds', 'tunnel-shell-radius', 'tunnel-shell-finalize'
          ]) {
            assert.ok(built.labels.has(`visual-${stage}`), `${qualityProfileId} omitted ${stage}`);
          }
          for (const stage of ['refine', 'vertices', 'indices', 'normals', 'normalize', 'bounds', 'radius']) {
            assert.ok(
              built.labels.get(`visual-tunnel-shell-${stage}`) > 1,
              `${qualityProfileId} ${stage} never returned control before completing its work`
            );
          }
          assert.equal(scene.children.length, 1);
          assert.equal(scene.children[0], visual.group);
          assert.equal(job.step(SLICE_BUDGET_MS), true);
          assert.equal(job.finish(), visual);
          assertOriginalTunnelGeometry(visual.tunnelShells.geometry, qualityProfileId);
          audit = visuals.createTunnelShellGeometryAudit({
            THREE, track, qualityProfile: { id: qualityProfileId }
          });
          assertOriginalTunnelGeometry(audit.geometry, qualityProfileId);
          assert.deepEqual(
            visual.tunnelShells.geometry.userData.tunnelShellDiagnostics,
            audit.diagnostics
          );
        } finally {
          audit?.geometry.dispose();
          if (visual) visual.dispose();
          else job.cancel();
        }
        assert.equal(scene.children.length, 0);
      }
    });
  } finally {
    restoreDocument();
  }
});

test('cancelled bridge and tunnel slices release every owned resource once without retiring a shared road', () => {
  const restoreDocument = installCanvasDocumentStub();
  const donorScene = new THREE.Scene();
  let donor;
  try {
    withDeterministicClock(() => {
      // Keeping one completed visual alive reuses the expensive immutable road batch for all cancellation points.
      const donorJob = visuals.createBuildJob(buildOptions(donorScene));
      ({ visual: donor } = finishBuild(donorJob, donorScene));
      const baselineOwnership = sharedTemplateOwnership();
      for (const stage of [
        'bridge-light-allocation', 'tunnel-shell-refine', 'tunnel-shell-normals', 'tunnel-shell-finalize'
      ]) {
        const observed = trackDisposableResources();
        const scene = new THREE.Scene();
        let job;
        try {
          job = visuals.createBuildJob(buildOptions(scene, 'desktop', observed.three));
          let reachedStage = false;
          for (let stepIndex = 0; stepIndex < MAXIMUM_BUILD_STEPS; stepIndex++) {
            assert.equal(advanceBuild(job), false, `${stage} was skipped before publication`);
            assert.equal(scene.children.length, 0, `${stage} leaked a partially built group`);
            if (job.diagnostics.lastStepLabel === `visual-${stage}`) {
              reachedStage = true;
              break;
            }
          }
          assert.ok(reachedStage, `Cancellation target ${stage} was never reached`);
          assert.ok(observed.allocations.size > 10, `${stage} did not observe production allocations`);
          job.cancel();
          assert.equal(job.diagnostics.cancelled, true);
          assert.equal(scene.children.length, 0);
          assert.equal(donorScene.children[0], donor.group);
          assert.deepEqual(sharedTemplateOwnership(), baselineOwnership, `${stage} retained a template lease`);
          for (const resource of observed.allocations) {
            assert.equal(
              observed.disposalCounts.get(resource), 1,
              `${stage}: ${resource.type || resource.constructor.name} ${resource.id} was leaked or disposed twice`
            );
          }
          const disposalSnapshot = new Map(observed.disposalCounts);
          assert.equal(observed.disposalCounts.has(donor.roadShell.geometry), false);
          job.cancel();
          assert.equal(job.step(SLICE_BUDGET_MS), false);
          assert.throws(() => job.finish(), /not complete/);
          assert.deepEqual(observed.disposalCounts, disposalSnapshot, `${stage} repeated cancellation disposed again`);
          assert.deepEqual(sharedTemplateOwnership(), baselineOwnership);
        } finally {
          job?.cancel();
          observed.restore();
        }
      }
    });
  } finally {
    donor?.dispose();
    restoreDocument();
  }
  assert.equal(donorScene.children.length, 0);
});
