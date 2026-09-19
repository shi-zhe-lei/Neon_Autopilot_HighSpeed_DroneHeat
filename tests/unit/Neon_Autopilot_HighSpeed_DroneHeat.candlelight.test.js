const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(
  PROJECT_ROOT,
  'src/entities/Neon_Autopilot_HighSpeed_DroneHeat.candlelight.js'
);
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
global.window = {
  location: { search: '' },
  innerWidth: 1_440,
  innerHeight: 900,
  devicePixelRatio: 1,
  navigator: { userAgent: 'node-test' }
};
require(path.join(
  PROJECT_ROOT,
  'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.modeling.js'
));
require(path.join(
  PROJECT_ROOT,
  'src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js'
));
require(MODULE_PATH);

const candlelight = global.window.NeonCandlelight;
const modeling = global.window.NeonModeling;
const source = fs.readFileSync(MODULE_PATH, 'utf8');

const EXACT_COLLECTIBLE_IDS_BY_REGION = Object.freeze({
  'dawn-isle': ['winged-flame-vessel', 'sun-petal-lantern'],
  'prairie-garden': ['bellflower-flame', 'butterfly-lantern'],
  'rainforest-glow': ['firefly-pod', 'waterdrop-flame'],
  'twilight-valley': ['racing-comet-flame', 'ice-feather-lantern'],
  'star-vault': ['constellation-flame', 'astrolabe-lantern'],
  'eden-eye': ['shielded-ember-flame', 'fractured-wing-lantern']
});
const EXACT_AMBIENT_IDS_BY_REGION = Object.freeze({
  'dawn-isle': 'dawn-pilgrim-flame-circle',
  'prairie-garden': 'prairie-windbell-candle-grove',
  'rainforest-glow': 'rainforest-rain-shelter-candle-niche',
  'twilight-valley': 'twilight-memory-candleline',
  'star-vault': 'vault-orbit-candle-ring',
  'eden-eye': 'eden-sheltered-ember-vigil'
});

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}

function materialsOf(object) {
  const materials = [];
  object.traverse((node) => {
    if (!node.material) return;
    if (Array.isArray(node.material)) materials.push(...node.material);
    else materials.push(node.material);
  });
  return materials;
}

function triangleCount(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  return Math.floor((index ? index.count : position.count) / 3);
}

function measuredObjectMetrics(object) {
  let triangles = 0;
  let drawGroups = 0;
  const materials = new Set();
  let lights = 0;
  object.traverse((node) => {
    if (node.isLight) lights++;
    if (!node.isMesh) return;
    drawGroups++;
    const multiplier = node.isInstancedMesh ? node.count : 1;
    triangles += triangleCount(node.geometry) * multiplier;
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of nodeMaterials) materials.add(material);
  });
  return { triangles, drawGroups, materials: materials.size, lights };
}

function opaqueMeshesOf(object) {
  const meshes = [];
  object.traverse((node) => {
    if (node.isMesh && node.userData.opaqueCore === true) meshes.push(node);
  });
  return meshes;
}

function geometryDigest(geometry) {
  const position = geometry.getAttribute('position');
  return crypto
    .createHash('sha256')
    .update(Buffer.from(position.array.buffer, position.array.byteOffset, position.array.byteLength))
    .digest('hex');
}

function assertOpaqueMeshInsideHalf(mesh, halfM) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  const transformed = new THREE.Vector3();
  const vertexBox = new THREE.Box3();
  vertexBox.makeEmpty();
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
    transformed
      .fromBufferAttribute(position, vertexIndex)
      .applyMatrix4(mesh.matrixWorld);
    vertexBox.expandByPoint(transformed);
  }
  // `precise=true` transforms authored vertices instead of rotating an already-expanded local AABB.
  const boxFromObject = new THREE.Box3().setFromObject(mesh, true);
  for (const box of [vertexBox, boxFromObject]) {
    assert.ok(box.min.x >= -halfM - 0.000_001 && box.max.x <= halfM + 0.000_001);
    assert.ok(box.min.y >= -halfM - 0.000_001 && box.max.y <= halfM + 0.000_001);
    assert.ok(box.min.z >= -halfM - 0.000_001 && box.max.z <= halfM + 0.000_001);
  }
}

function createFactory(qualityProfile = { id: 'high' }, extra = {}) {
  return candlelight.createFactory({
    THREE,
    modeling,
    zones: global.window.NeonConfig.zones,
    qualityProfile,
    visualSeed: 'candlelight-unit-seed',
    ...extra
  });
}

test('publishes the exact frozen 12 collectible and 6 ambient taxonomy', () => {
  assert.ok(candlelight);
  const art = candlelight.CANDLELIGHT_ART_CONTRACT;
  assert.equal(art.version, 2);
  assert.equal(art.visualLanguage, 'six-realm-candle-star-memory-reliquaries');
  assert.equal(art.opaqueSurfaceLanguage, 'matte-natural-dielectric-stone-and-ceramic');
  assert.equal(art.collectibleOpaqueMetalness, 0);
  assert.equal(art.ambientOpaqueMetalness, 0);
  assert.equal(art.effectAuthority, 'transparent-emissive-bloom-only');
  assert.equal(art.haloRole, 'collision-free-world-space-readability');
  assert.equal(art.bloomPreserved, true);
  assert.equal(art.localLightCount, 0);
  assert.equal(art.modernMechanicalPartCount, 0);
  assert.equal(art.neonFixtureCount, 0);
  assert.equal(candlelight.CANDLELIGHT_CONTRACT.version, 2);
  assert.equal(candlelight.CANDLELIGHT_CONTRACT.artDirection, art);
  assert.deepEqual([...candlelight.REGION_IDS], Object.keys(EXACT_COLLECTIBLE_IDS_BY_REGION));
  assert.equal(candlelight.COLLECTIBLE_FAMILY_CATALOG.length, 12);
  assert.equal(candlelight.AMBIENT_FAMILY_CATALOG.length, 6);
  assert.equal(candlelight.FAMILY_CATALOG.length, 18);
  assert.equal(new Set(candlelight.FAMILY_CATALOG.map(({ id }) => id)).size, 18);

  for (const realmId of candlelight.REGION_IDS) {
    const style = candlelight.REGION_STYLE_CATALOG[realmId];
    assert.deepEqual([...style.collectibleFamilyIds], EXACT_COLLECTIBLE_IDS_BY_REGION[realmId]);
    assert.equal(style.ambientFamilyId, EXACT_AMBIENT_IDS_BY_REGION[realmId]);
    for (const familyId of style.collectibleFamilyIds) {
      const definition = candlelight.describe(familyId);
      assert.equal(definition.realmId, realmId);
      assert.equal(definition.sceneLayer, 'route');
      assert.equal(definition.semanticRole, 'pickup-candle');
      assert.equal(definition.collisionRole, 'gameplay-aabb');
      assert.equal(definition.readabilityClass, 'world-candle-cue');
      assert.match(definition.labelZh, /[\u3400-\u9fff]/u);
      assert.match(definition.labelEn, /^[A-Z][A-Za-z ]+$/);
      assert.deepEqual(
        { ...definition.collider.half },
        { x: 0.62, y: 0.62, z: 0.62 }
      );
      assert.equal(definition.readability.referenceSpeedMps, 45);
      assert.equal(definition.readability.referenceDistanceM, 180);
      assert.equal(definition.readability.minimumCoreRoadContrastRatio, 4.5);
      assert.equal(definition.readability.fogParticipation, false);
    }
  }

  assertDeepFrozen(candlelight.REGION_IDS);
  assertDeepFrozen(candlelight.ALLOWED_AMBIENT_SCENE_LAYERS);
  assertDeepFrozen(candlelight.CANDLELIGHT_ART_CONTRACT);
  assertDeepFrozen(candlelight.CANDLELIGHT_CONTRACT);
  assertDeepFrozen(candlelight.REGION_STYLE_CATALOG);
  assertDeepFrozen(candlelight.COLLECTIBLE_FAMILY_CATALOG);
  assertDeepFrozen(candlelight.AMBIENT_FAMILY_CATALOG);
  assertDeepFrozen(candlelight.FAMILY_CATALOG);
});

test('locks every ambient family to the shared ground integration contract without pickup semantics', () => {
  assert.deepEqual([...candlelight.ALLOWED_AMBIENT_SCENE_LAYERS], ['roadside', 'terrain']);
  assert.ok(candlelight.CANDLELIGHT_CONTRACT.ambient.authoredMaximumFlameChannelRatio <= 0.45);
  for (const definition of candlelight.AMBIENT_FAMILY_CATALOG) {
    assert.equal(definition.category, 'ambient-candlelight');
    assert.equal(definition.placementBand, 'ground-mid');
    assert.equal(definition.clearanceClass, 'ambient-candlelight-ground');
    assert.equal(definition.roadClearanceM, 3);
    assert.equal(definition.sameSideGroupClearanceM, 4);
    assert.equal(definition.sceneLayer, 'roadside');
    assert.deepEqual([...definition.allowedSceneLayers], ['roadside', 'terrain']);
    assert.equal(definition.semanticRole, 'ambient-candlelight');
    assert.equal(definition.mapPriority, 0);
    assert.equal(definition.collisionRole, 'none');
    assert.equal(definition.pickupRole, 'none');
    assert.equal(definition.presentationOnly, true);
    assert.ok(definition.brightnessRatioToCollectible <= 0.45);
    assert.ok(definition.singleFlameHeightM <= 0.45);
    assert.equal(definition.lightCount, 0);
    assert.equal(definition.batching, 'instanced-mesh');
  }
  assert.doesNotMatch(source, /['"]realm-[^'"]*['"]/);
});

test('keeps every family geometry signature and authored profile structurally unique', () => {
  const signatures = candlelight.FAMILY_CATALOG.map(({ geometrySignature }) => geometrySignature);
  assert.equal(new Set(signatures).size, signatures.length);
  const profiles = candlelight.COLLECTIBLE_FAMILY_CATALOG.map(
    ({ recipe }) => JSON.stringify(recipe.profile)
  );
  assert.equal(new Set(profiles).size, 12);
  assert.equal(
    new Set(candlelight.COLLECTIBLE_FAMILY_CATALOG.map(({ labelZh }) => labelZh)).size,
    12
  );
  assert.equal(
    new Set(candlelight.COLLECTIBLE_FAMILY_CATALOG.map(({ labelEn }) => labelEn)).size,
    12
  );
  assert.equal(
    new Set(candlelight.AMBIENT_FAMILY_CATALOG.map(({ recipe }) => recipe.layoutKind)).size,
    6
  );
});

test('validates config mappings when supplied and stays usable without config', () => {
  assert.equal(candlelight.validateZones(), true);
  assert.equal(candlelight.validateZones(global.window.NeonConfig.zones), true);
  const copiedZones = global.window.NeonConfig.zones.map((zone) => ({
    id: zone.id,
    pickupStyle: { families: [...zone.pickupStyle.families] }
  }));
  copiedZones[2].pickupStyle.families.reverse();
  assert.throws(() => candlelight.validateZones(copiedZones), /family mapping drifted/);
  assert.throws(() => candlelight.validateZones(copiedZones.slice(0, 5)), /exact six-zone array/);
  assert.throws(() => candlelight.describe('unknown-candle'), /Unknown candlelight family/);
  assert.throws(() => candlelight.getRegionStyle('unknown-region'), /Unknown candlelight region/);

  const standaloneFactory = candlelight.createFactory({
    THREE,
    modeling,
    qualityProfile: 'mobile',
    seed: 'standalone-catalog'
  });
  standaloneFactory.prewarm({ familyIds: ['firefly-pod'], countPerFamily: 1 });
  const standalone = standaloneFactory.acquire({
    familyId: 'firefly-pod',
    realmId: 'rainforest-glow',
    zoneIndex: 2
  });
  assert.equal(standalone.userData.familyId, 'firefly-pod');
  assert.throws(
    () => standaloneFactory.acquire({
      familyId: 'firefly-pod',
      realmId: 'dawn-isle'
    }),
    /belongs to rainforest-glow/
  );
  standaloneFactory.release(standalone);
  standaloneFactory.dispose();
});

test('prewarms all assets and acquires without geometry or material allocation misses', () => {
  const forbiddenScene = {
    add() {
      throw new Error('Factory attempted to own scene.add');
    },
    remove() {
      throw new Error('Factory attempted to own scene.remove');
    }
  };
  const factory = createFactory({ id: 'high' }, { scene: forbiddenScene });
  assert.throws(
    () => factory.acquire({ familyId: 'winged-flame-vessel' }),
    /must be prewarmed/
  );
  assert.throws(
    () => factory.createAmbientCluster({ familyId: 'dawn-pilgrim-flame-circle' }),
    /must be prewarmed/
  );
  factory.prewarm({
    countPerFamily: 2,
    ambientFamilyIds: candlelight.AMBIENT_FAMILY_CATALOG.map(({ id }) => id),
    ambientClustersPerFamily: 1
  });
  const acquired = [];
  for (const definition of candlelight.COLLECTIBLE_FAMILY_CATALOG) {
    acquired.push(factory.acquire({
      familyId: definition.id,
      realmId: definition.realmId,
      zoneIndex: definition.zoneIndex
    }));
    acquired.push(factory.acquire({
      familyId: definition.id,
      realmId: definition.realmId,
      zoneIndex: definition.zoneIndex
    }));
  }
  const ambientClusters = candlelight.AMBIENT_FAMILY_CATALOG.map((definition) => (
    factory.createAmbientCluster({
      familyId: definition.id,
      realmId: definition.realmId,
      zoneIndex: definition.zoneIndex
    })
  ));
  assert.throws(
    () => factory.acquire({ familyId: 'winged-flame-vessel' }),
    /pool exhausted/
  );
  assert.throws(
    () => factory.createAmbientCluster({ familyId: 'dawn-pilgrim-flame-circle' }),
    /pool exhausted/
  );
  const diagnostics = factory.diagnostics();
  assert.equal(diagnostics.prewarmComplete, true);
  assert.equal(diagnostics.allocations.collectibleAssetsDuringAcquire, 0);
  assert.equal(diagnostics.allocations.ambientAssetsDuringAcquire, 0);
  assert.equal(diagnostics.allocations.zeroFrameAssetsAfterPrewarm, true);
  assert.equal(diagnostics.pool.activeCollectibles, 24);
  assert.equal(diagnostics.pool.activeAmbientClusters, 6);
  for (const object of [...acquired, ...ambientClusters]) {
    let opaqueMaterialCount = 0;
    object.traverse((node) => {
      if (node.isMesh) {
        assert.equal(
          node.geometry.userData.neonImmutableTopology,
          true,
          `${object.userData.familyId || object.name} omitted the shared immutable-topology cache key`
        );
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (!Number.isFinite(material?.metalness)) continue;
          opaqueMaterialCount++;
          assert.equal(
            material.metalness,
            0,
            `${object.userData.familyId || object.name} reintroduced metallic candlelight`
          );
        }
      }
    });
    assert.ok(opaqueMaterialCount >= 1, `${object.userData.familyId || object.name} has no opaque vessel material`);
    factory.release(object);
  }
  assert.equal(factory.diagnostics().pool.activeCollectibles, 0);
  assert.equal(factory.diagnostics().pool.activeAmbientClusters, 0);
  factory.dispose();
});

test('isolates mutable materials across active instances and resets pooled state idempotently', () => {
  const factory = createFactory();
  factory.prewarm({ familyIds: ['winged-flame-vessel'], countPerFamily: 2 });
  const first = factory.acquire({ familyId: 'winged-flame-vessel', seed: 'first' });
  const second = factory.acquire({ familyId: 'winged-flame-vessel', seed: 'second' });
  const firstMaterials = materialsOf(first);
  const secondMaterials = materialsOf(second);
  assert.equal(firstMaterials.length, 4);
  assert.equal(secondMaterials.length, 4);
  assert.equal(new Set(firstMaterials).size, 4);
  assert.equal(new Set(secondMaterials).size, 4);
  assert.ok(firstMaterials.every((material) => !secondMaterials.includes(material)));
  assert.notEqual(first.userData.visualSeedPhaseA, second.userData.visualSeedPhaseA);

  first.userData.handles.core.material.emissiveIntensity = 99;
  first.userData.handles.halo.material.opacity = 0.01;
  first.userData.handles.core.scale.setScalar(1.08);
  first.userData.handles.core.rotation.set(0.4, 0.7, 0.2);
  assert.notEqual(
    second.userData.handles.core.material.emissiveIntensity,
    first.userData.handles.core.material.emissiveIntensity
  );
  assert.notEqual(
    second.userData.handles.halo.material.opacity,
    first.userData.handles.halo.material.opacity
  );
  assert.equal(factory.release(first), true);
  assert.equal(factory.release(first), false);
  const reused = factory.acquire({ familyId: 'winged-flame-vessel', seed: 'reused' });
  assert.equal(reused, first);
  assert.equal(reused.userData.handles.core.material.emissiveIntensity, 1.44);
  assert.equal(reused.userData.handles.halo.material.opacity, 0.54);
  assert.deepEqual(reused.userData.handles.core.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(reused.userData.handles.core.rotation.toArray().slice(0, 3), [0, 0, 0]);
  factory.release(reused);
  factory.release(second);
  factory.dispose();

  assert.match(source, /const clones = new Map\(\);/);
  assert.match(source, /clone\.onBeforeCompile = sourceMaterial\.onBeforeCompile;/);
  assert.match(source, /clone\.customProgramCacheKey = sourceMaterial\.customProgramCacheKey;/);
});

test('keeps actual transformed opaque vertices and per-mesh Box3 inside the 0.56m envelope', () => {
  const factory = createFactory();
  factory.prewarm({ countPerFamily: 1 });
  const rootAngles = [0, Math.PI / 7, Math.PI / 3, Math.PI / 2, Math.PI * 0.83];
  for (const definition of candlelight.COLLECTIBLE_FAMILY_CATALOG) {
    const object = factory.acquire({ familyId: definition.id, seed: 'envelope-domain' });
    const opaqueMeshes = opaqueMeshesOf(object);
    assert.equal(opaqueMeshes.length, 1);
    const core = opaqueMeshes[0];
    core.scale.setScalar(1.08);
    for (const x of rootAngles) {
      for (const y of rootAngles) {
        for (const z of rootAngles) {
          object.rotation.set(x, y, z);
          core.rotation.set(x * 0.31, y * definition.recipe.spinDirection, z * 0.27);
          object.updateMatrixWorld(true);
          assertOpaqueMeshInsideHalf(core, 0.56);
        }
      }
    }
    object.rotation.set(0, 0, 0);
    factory.release(object);
  }
  const topology = factory.topology();
  assert.equal(topology.length, 12);
  assertDeepFrozen(topology);
  for (const report of topology) {
    assert.equal(report.isClosed, true);
    assert.equal(report.boundaryEdges, 0);
    assert.equal(report.nonManifoldEdges, 0);
    assert.equal(report.degenerateTriangles, 0);
    assert.equal(report.invalidCoordinates, 0);
    assert.ok(report.maximumAuthoredOpaqueRadiusM <= 0.518_5 + 0.000_001);
    assert.ok(report.maximumAnimatedOpaqueRadiusM <= 0.56 + 0.000_001);
  }
  factory.dispose();
});

test('tags every non-opaque overflow node as a transparent additive collision-free effect', () => {
  const factory = createFactory();
  factory.prewarm({ countPerFamily: 1 });
  for (const definition of candlelight.COLLECTIBLE_FAMILY_CATALOG) {
    const object = factory.acquire({ familyId: definition.id });
    assert.equal(object.userData.fogParticipation, false);
    for (const material of materialsOf(object)) {
      assert.equal(material.fog, false, `${definition.id} must remain readable through contract-distance fog`);
    }
    const effects = [];
    object.traverse((node) => {
      if (node.isMesh && node.userData.opaqueCore !== true) effects.push(node);
    });
    assert.equal(effects.length, 3);
    for (const effect of effects) {
      assert.equal(effect.userData.collisionFree, true);
      assert.equal(effect.userData.candlelightEffect, true);
      assert.equal(effect.material.transparent, true);
      assert.equal(effect.material.depthWrite, false);
      assert.equal(effect.material.blending, THREE.AdditiveBlending);
      assert.equal(effect.castShadow, false);
      assert.equal(effect.receiveShadow, false);
    }
    const halo = object.userData.handles.halo;
    halo.geometry.computeBoundingBox();
    assert.ok(Math.abs(halo.geometry.boundingBox.max.x - 0.96) <= 0.000_001);
    assert.equal(halo.userData.outerRadiusM, 0.96);
    assert.equal(halo.userData.collectionRange, false);
    const trail = object.userData.handles.trail;
    assert.equal(trail.userData.lengthM, 2.32);
    assert.ok(trail.userData.lengthM < 2.4);
    factory.release(object);
  }
  factory.dispose();
});

test('builds six dim instanced ambient clusters with no halo, trail, pickup, map, or collision role', () => {
  const factory = createFactory();
  factory.prewarm({
    familyIds: candlelight.REGION_IDS.map(
      (realmId) => candlelight.REGION_STYLE_CATALOG[realmId].collectibleFamilyIds[0]
    ),
    countPerFamily: 1,
    ambientFamilyIds: candlelight.AMBIENT_FAMILY_CATALOG.map(({ id }) => id),
    ambientClustersPerFamily: 1
  });
  for (const definition of candlelight.AMBIENT_FAMILY_CATALOG) {
    const cluster = factory.createAmbientCluster({
      familyId: definition.id,
      realmId: definition.realmId
    });
    assert.equal(cluster.userData.category, 'ambient-candlelight');
    assert.equal(cluster.userData.sceneLayer, 'roadside');
    assert.equal(cluster.userData.semanticRole, 'ambient-candlelight');
    assert.equal(cluster.userData.collisionRole, 'none');
    assert.equal(cluster.userData.pickupRole, 'none');
    assert.equal(cluster.userData.mapPriority, 0);
    assert.equal(cluster.userData.collisionFree, true);
    assert.equal(cluster.userData.roadClearanceM, 3);
    assert.equal(cluster.userData.sameSideGroupClearanceM, 4);
    assert.equal(cluster.getObjectByName('Neon.Candlelight.HaloEffect'), undefined);
    assert.equal(cluster.getObjectByName('Neon.Candlelight.TrailEffect'), undefined);
    const metrics = measuredObjectMetrics(cluster);
    assert.equal(metrics.drawGroups, 2);
    assert.equal(metrics.materials, 2);
    assert.equal(metrics.lights, 0);
    const instancedMeshes = [];
    cluster.traverse((node) => {
      if (node.isInstancedMesh) instancedMeshes.push(node);
    });
    assert.equal(instancedMeshes.length, 2);
    assert.ok(instancedMeshes.every(({ count }) => count === definition.recipe.candleCount));
    assert.ok(
      instancedMeshes.every(({ material }) => material.fog === true),
      'Ambient candlelight must stay fog-integrated and subordinate to pickups'
    );
    const flames = cluster.userData.handles.flames;
    assert.equal(flames.userData.singleFlameHeightM, 0.42);
    assert.ok(flames.userData.brightnessRatioToCollectible <= 0.45);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < flames.count; index++) {
      flames.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      assert.ok(0.42 * scale.y <= 0.45 + 0.000_001);
    }
    const pickup = factory.acquire({
      familyId: candlelight.REGION_STYLE_CATALOG[definition.realmId].collectibleFamilyIds[0],
      realmId: definition.realmId
    });
    let maximumMeasuredFlameChannelRatio = 0;
    for (let sampleIndex = 0; sampleIndex <= 480; sampleIndex++) {
      const elapsedSeconds = sampleIndex * 0.25;
      factory.update(cluster, { elapsedSeconds });
      factory.update(pickup, { elapsedSeconds });
      maximumMeasuredFlameChannelRatio = Math.max(
        maximumMeasuredFlameChannelRatio,
        flames.material.opacity / pickup.userData.handles.flame.material.opacity
      );
    }
    assert.ok(
      maximumMeasuredFlameChannelRatio <= 0.45 + 0.000_001,
      `${definition.id} actual additive flame channel must stay subordinate to its collectible`
    );
    factory.release(pickup);
    factory.release(cluster);
  }
  assert.equal(factory.diagnostics().allocations.zeroFrameAssetsAfterPrewarm, true);
  factory.dispose();
});

test('ambient candle attachment uses scaled geometry bounds across seeds, profiles, and pool reuse', () => {
  const matrix = new THREE.Matrix4();
  const baseBox = new THREE.Box3();
  const flameBox = new THREE.Box3();
  const baseScales = new Set();
  const flameScales = new Set();
  const twilightOffsets = new Set();
  for (const qualityProfile of [{ id: 'desktop' }, { id: 'mobile' }]) {
    for (let seedIndex = 0; seedIndex < 12; seedIndex++) {
      // Seed zero reproduces the former > 0.033m startup failure with the world's one-cluster prewarm.
      // Three clusters also exercise the global pool ordinal used when authoring instance transforms.
      const visualSeed = `ambient-seam-regression-${seedIndex}`;
      for (const ambientClustersPerFamily of [1, 3]) {
        const factory = createFactory(qualityProfile, { visualSeed });
        try {
          factory.prewarm({
            familyIds: [],
            countPerFamily: 0,
            ambientFamilyIds: candlelight.AMBIENT_FAMILY_CATALOG.map(({ id }) => id),
            ambientClustersPerFamily
          });
          for (const definition of candlelight.AMBIENT_FAMILY_CATALOG) {
            const clusters = Array.from({ length: ambientClustersPerFamily }, () => (
              factory.createAmbientCluster({ familyId: definition.id })
            ));
            for (const cluster of clusters) {
              const { bases, flames } = cluster.userData.handles;
              for (let index = 0; index < bases.count; index++) {
                const context = `${qualityProfile.id}/${visualSeed}/${definition.id}/${index}`;
                bases.getMatrixAt(index, matrix);
                baseBox.copy(bases.geometry.boundingBox).applyMatrix4(matrix);
                baseScales.add(matrix.elements[5]);
                if (definition.id === 'twilight-memory-candleline') {
                  twilightOffsets.add(matrix.elements[14]);
                }
                flames.getMatrixAt(index, matrix);
                flameBox.copy(flames.geometry.boundingBox).applyMatrix4(matrix);
                flameScales.add(matrix.elements[5]);
                assert.ok(
                  Math.abs(baseBox.min.y) <= 0.000_001,
                  `${context} scaled base must touch its authored ground plane`
                );
                assert.ok(
                  Math.abs(flameBox.min.y - baseBox.max.y) <= 0.000_001,
                  `${context} scaled flame must touch the actual base top`
                );
              }
              const authoredBaseMatrices = bases.instanceMatrix.array.slice();
              const authoredFlameMatrices = flames.instanceMatrix.array.slice();
              factory.update(cluster, { elapsedSeconds: 13.5 });
              factory.settle(cluster);
              factory.release(cluster);
              const reused = factory.createAmbientCluster({ familyId: definition.id });
              assert.equal(reused, cluster);
              assert.deepEqual(bases.instanceMatrix.array, authoredBaseMatrices);
              assert.deepEqual(flames.instanceMatrix.array, authoredFlameMatrices);
              factory.release(reused);
            }
          }
          assert.equal(factory.diagnostics().allocations.zeroFrameAssetsAfterPrewarm, true);
        } finally {
          factory.dispose();
        }
      }
    }
  }
  assert.ok(baseScales.size > 12, 'Grounding must retain authored candle-height variation');
  assert.ok(flameScales.size > 12, 'Flame attachment must retain independent seeded flame-size variation');
  assert.ok(twilightOffsets.size > 12, 'Grounding must retain seeded horizontal layout variation');
});

test('meets actual desktop and mobile triangle, draw-group, material, and light budgets', () => {
  for (const [qualityProfile, collectibleTriangleLimit, ambientTriangleLimit] of [
    [{ id: 'high' }, 1_200, 1_500],
    [{ id: 'mobile' }, 450, 500]
  ]) {
    const factory = createFactory(qualityProfile);
    factory.prewarm({
      countPerFamily: 1,
      ambientFamilyIds: candlelight.AMBIENT_FAMILY_CATALOG.map(({ id }) => id),
      ambientClustersPerFamily: 1
    });
    const geometryDigests = new Set();
    for (const definition of candlelight.COLLECTIBLE_FAMILY_CATALOG) {
      const object = factory.acquire({ familyId: definition.id });
      const metrics = measuredObjectMetrics(object);
      assert.ok(metrics.triangles <= collectibleTriangleLimit);
      assert.ok(metrics.drawGroups <= 4);
      assert.ok(metrics.materials <= 4);
      assert.equal(metrics.lights, 0);
      geometryDigests.add(geometryDigest(object.userData.handles.core.geometry));
      factory.release(object);
    }
    assert.equal(geometryDigests.size, 12, 'Every collectible needs unique actual core geometry');
    for (const definition of candlelight.AMBIENT_FAMILY_CATALOG) {
      const cluster = factory.createAmbientCluster({ familyId: definition.id });
      const metrics = measuredObjectMetrics(cluster);
      assert.ok(metrics.triangles <= ambientTriangleLimit);
      assert.ok(metrics.drawGroups <= 2);
      assert.ok(metrics.materials <= 2);
      assert.equal(metrics.lights, 0);
      factory.release(cluster);
    }
    const diagnostics = factory.diagnostics();
    assert.ok(diagnostics.maximumMeasured.collectible.triangles <= collectibleTriangleLimit);
    assert.ok(diagnostics.maximumMeasured.collectible.drawGroups <= 4);
    assert.ok(diagnostics.maximumMeasured.collectible.materials <= 4);
    assert.equal(diagnostics.maximumMeasured.collectible.lights, 0);
    assert.ok(diagnostics.maximumMeasured.ambientCluster.triangles <= ambientTriangleLimit);
    assert.ok(diagnostics.maximumMeasured.ambientCluster.drawGroups <= 2);
    assert.ok(diagnostics.maximumMeasured.ambientCluster.materials <= 2);
    assert.equal(diagnostics.maximumMeasured.ambientCluster.lights, 0);
    assert.equal(diagnostics.lightsCreated, 0);
    factory.dispose();
  }
});

test('updates decoration only, settles reduced motion, and changes quality without replacing geometry', () => {
  const factory = createFactory();
  factory.prewarm({ familyIds: ['astrolabe-lantern'], countPerFamily: 1 });
  const object = factory.acquire({ familyId: 'astrolabe-lantern', seed: 'motion-test' });
  const coreGeometry = object.userData.handles.core.geometry;
  object.position.set(11, 7, -19);
  object.rotation.set(0.2, 0.7, -0.1);
  factory.update(object, { elapsedSeconds: 3.25, reducedMotion: false });
  assert.ok(object.userData.handles.core.scale.x > 1);
  assert.notEqual(object.userData.handles.halo.rotation.z, 0);
  assert.deepEqual(object.position.toArray(), [11, 7, -19]);
  assert.deepEqual(object.rotation.toArray().slice(0, 3), [0.2, 0.7, -0.1]);

  factory.update(object, { elapsedSeconds: 7.5, reducedMotion: true });
  assert.deepEqual(object.userData.handles.core.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(object.userData.handles.core.rotation.toArray().slice(0, 3), [0, 0, 0]);
  assert.equal(object.userData.handles.halo.rotation.z, 0);
  assert.deepEqual(object.position.toArray(), [11, 7, -19]);
  assert.deepEqual(object.rotation.toArray().slice(0, 3), [0.2, 0.7, -0.1]);

  const highHaloOpacity = object.userData.handles.halo.material.opacity;
  assert.equal(factory.setRenderQuality('low'), 'low');
  assert.ok(object.userData.handles.halo.material.opacity < highHaloOpacity);
  assert.equal(object.userData.handles.trail.visible, false);
  assert.equal(object.userData.handles.core.geometry, coreGeometry);
  assert.equal(factory.setRenderQuality({ id: 'high' }), 'high');
  assert.equal(object.userData.handles.trail.visible, true);
  assert.equal(object.userData.handles.core.geometry, coreGeometry);
  factory.release(object);
  factory.dispose();
});

test('release never disposes assets, while factory disposal is one-shot and terminal', () => {
  const factory = createFactory();
  factory.prewarm({ familyIds: ['shielded-ember-flame'], countPerFamily: 1 });
  const object = factory.acquire({ familyId: 'shielded-ember-flame' });
  const material = object.userData.handles.core.material;
  const geometry = object.userData.handles.core.geometry;
  let materialDisposeCalls = 0;
  let geometryDisposeCalls = 0;
  const originalMaterialDispose = material.dispose.bind(material);
  const originalGeometryDispose = geometry.dispose.bind(geometry);
  material.dispose = () => {
    materialDisposeCalls++;
    originalMaterialDispose();
  };
  geometry.dispose = () => {
    geometryDisposeCalls++;
    originalGeometryDispose();
  };
  assert.equal(factory.release(object), true);
  assert.equal(materialDisposeCalls, 0);
  assert.equal(geometryDisposeCalls, 0);
  assert.equal(factory.dispose(), true);
  assert.equal(materialDisposeCalls, 1);
  assert.equal(geometryDisposeCalls, 1);
  assert.equal(factory.dispose(), false);
  assert.equal(materialDisposeCalls, 1);
  assert.equal(geometryDisposeCalls, 1);
  assert.throws(
    () => factory.acquire({ familyId: 'shielded-ember-flame' }),
    /factory is disposed/
  );
});

test('contains no visual RNG escape, scene light, simulation-owned field, or long unseparated integer', () => {
  assert.doesNotMatch(source, /Math\s*\.\s*random/);
  assert.doesNotMatch(source, /new\s+THREE\.[A-Za-z]*Light\b/);
  assert.doesNotMatch(
    source,
    /\b(?:spawn|cadence|timeToCollision|reward|handling|damage|speedMultiplier)\s*:/
  );
  assert.doesNotMatch(source, /\b(?:1200|1500|2166136261|16777619|4294967296)\b/);
  assert.match(source, /\b1_200\b/);
  assert.match(source, /\b1_500\b/);
  assert.match(source, /\b2_166_136_261\b/);
  assert.match(source, /\b16_777_619\b/);
  assert.match(source, /\b4_294_967_296\b/);
});
