import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = new URL('../../', import.meta.url);
const moduleUrl = new URL(
  'src/entities/Neon_Autopilot_HighSpeed_DroneHeat.obstacles.js',
  PROJECT_ROOT
);
const modelingUrl = new URL(
  'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.modeling.js',
  PROJECT_ROOT
);
const configUrl = new URL(
  'src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js',
  PROJECT_ROOT
);
const source = readFileSync(moduleUrl, 'utf8');
const modelingSource = readFileSync(modelingUrl, 'utf8');
const configSource = readFileSync(configUrl, 'utf8');
const THREE = require(new URL('vendor/three-0.160.0.min.js', PROJECT_ROOT).pathname);

function loadModule() {
  const window = {
    THREE,
    innerWidth: 1_280,
    innerHeight: 720,
    devicePixelRatio: 1,
    navigator: { userAgent: 'node-unit-test' }
  };
  const context = vm.createContext({ console, window });
  vm.runInContext(modelingSource, context, {
    filename: 'Neon_Autopilot_HighSpeed_DroneHeat.modeling.js'
  });
  vm.runInContext(source, context, {
    filename: 'Neon_Autopilot_HighSpeed_DroneHeat.obstacles.js'
  });
  return { obstacles: context.window.NeonObstacles, window };
}

const { obstacles } = loadModule();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}

function loadConfiguredZones() {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(configSource, context, {
    filename: 'Neon_Autopilot_HighSpeed_DroneHeat.config.js'
  });
  return context.window.NeonConfig.zones;
}

function acquireOptions(definition, overrides = {}) {
  return {
    familyId: definition.id,
    realmId: definition.realmId,
    motionKind: definition.motionKind,
    half: { x: 3.25, y: 2.40, z: 4.10 },
    visualKey: `${definition.id}-unit`,
    ...overrides
  };
}

function meshWorldBox(mesh, target = new THREE.Box3()) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  const vertex = new THREE.Vector3();
  target.makeEmpty();
  for (let index = 0; index < position.count; index++) {
    vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    target.expandByPoint(vertex);
  }
  return target;
}

function combinedMeshWorldBox(meshes, target = new THREE.Box3()) {
  const meshBox = new THREE.Box3();
  target.makeEmpty();
  for (const mesh of meshes) target.union(meshWorldBox(mesh, meshBox));
  return target;
}

function collectMeshes(root) {
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  return meshes;
}

test('publishes the exact ordered 6x(3 static + 2 dynamic) taxonomy', () => {
  const expected = {
    'dawn-isle': {
      static: ['sandstone-fin', 'sealed-ruin-buttress', 'wind-carved-monolith'],
      dynamic: ['sweeping-wind-arch', 'migrating-cloud-sentinel']
    },
    'prairie-garden': {
      static: ['blooming-stone-fan', 'vine-wrapped-bell', 'terraced-garden-wall'],
      dynamic: ['swaying-vine-bridge', 'butterfly-petal-guardian']
    },
    'rainforest-glow': {
      static: ['root-knot-bulwark', 'sealed-bridge-ruin', 'canopy-drop-pillar'],
      dynamic: ['swinging-root-lattice', 'rain-orbit-sentinel']
    },
    'twilight-valley': {
      static: ['ice-blade-cluster', 'pilgrim-terrace-pier', 'racing-banner-buttress'],
      dynamic: ['gliding-ice-veil', 'orbiting-memory-ribbon']
    },
    'star-vault': {
      static: ['sealed-book-arc', 'astrolabe-buttress', 'constellation-pillar'],
      dynamic: ['circling-constellation-arch', 'ascending-memory-archive']
    },
    'eden-eye': {
      static: ['sealed-fracture-slab', 'red-crystal-crown', 'storm-carved-idol'],
      dynamic: ['ash-storm-veil', 'orbiting-shard-guardian']
    }
  };
  assert.deepEqual(plain(obstacles.EXPECTED_FAMILY_IDS_BY_REALM), expected);
  assert.equal(obstacles.familyCatalog.length, 30);
  assert.equal(new Set(obstacles.familyCatalog.map(({ id }) => id)).size, 30);
  assert.equal(new Set(obstacles.familyCatalog.map(({ geometrySignature }) => geometrySignature)).size, 30);
  assert.deepEqual(plain(obstacles.DYNAMIC_MOTION_KINDS), [
    'wind-sweep-cue',
    'cloud-drift-cue',
    'vine-sway-cue',
    'butterfly-orbit-cue',
    'root-pendulum-cue',
    'rain-orbit-cue',
    'ice-veil-glide-cue',
    'memory-ribbon-orbit-cue',
    'constellation-arch-circle-cue',
    'memory-archive-rise-cue',
    'ash-veil-sweep-cue',
    'shard-orbit-cue'
  ]);

  for (const realmId of obstacles.REALM_IDS) {
    const families = obstacles.getRealmFamilies(realmId);
    assert.equal(families.length, 5);
    assert.deepEqual(
      plain(families.filter(({ category }) => category === 'static').map(({ id }) => id)),
      expected[realmId].static
    );
    assert.deepEqual(
      plain(families.filter(({ category }) => category === 'dynamic').map(({ id }) => id)),
      expected[realmId].dynamic
    );
    for (const definition of families) {
      assert.equal(definition.realmId, realmId);
      assert.match(definition.labelZh, /[\u3400-\u9fff]/u);
      assert.match(definition.labelEn, /^[A-Z][A-Za-z -]+$/);
      assert.equal(definition.sceneLayer, 'route');
      assert.ok(obstacles.SCENE_LAYER_IDS.includes(definition.sceneLayer));
      assert.equal(
        definition.semanticRole,
        definition.category === 'static' ? 'hazard-static' : 'hazard-dynamic'
      );
      assert.equal(definition.collisionRole, 'gameplay-aabb');
      assert.equal(typeof definition.readabilityClass, 'string');
      assert.ok(definition.readabilityClass.length > 0);
      assert.equal(
        definition.category === 'static',
        definition.motionKind === obstacles.STATIC_MOTION_KIND
      );
      if (definition.category === 'dynamic') {
        assert.ok(obstacles.DYNAMIC_MOTION_KINDS.includes(definition.motionKind));
      }
      assert.equal(definition.geometryRecipe.pattern, 'sealed-realm-contour-with-relief-and-memory-cue');
      assert.equal(typeof definition.geometryRecipe.coreMotif, 'string');
      assert.equal(typeof definition.geometryRecipe.reliefMotif, 'string');
      assert.match(definition.geometryRecipe.cueMotif, /-variant-[1-5]$/);
      assert.equal(obstacles.getFamily(definition.id), definition);
    }
  }
});

test('matches the current config taxonomy without importing config into the entity module', () => {
  assert.equal(obstacles.validateConfiguredZones(loadConfiguredZones()), true);
  assert.doesNotMatch(source, /NeonConfig|src\/config|obstacleFamilies\s*=/);
  const drifted = plain(loadConfiguredZones());
  [drifted[0].obstacleFamilies.static[0], drifted[0].obstacleFamilies.static[1]] = [
    drifted[0].obstacleFamilies.static[1],
    drifted[0].obstacleFamilies.static[0]
  ];
  assert.throws(() => obstacles.validateConfiguredZones(drifted), /taxonomy drifted/);
  assert.throws(() => obstacles.validateConfiguredZones(drifted.slice(1)), /exactly 6 configured zones/);
  assert.throws(() => obstacles.getFamily('unknown-obstacle'), /Unknown obstacle family/);
  assert.throws(() => obstacles.getRealmFamilies('unknown-realm'), /Unknown obstacle realm/);
  const retiredTaxonomy = [
    'butterfly-wheel',
    'sealed-grandstand-pier',
    'sliding-ice-gate',
    'orbiting-ribbon-racer',
    'rotating-orbit-gate',
    'ascending-library-lift',
    'ash-storm-shutter',
    'ice-slide-cue',
    'ribbon-orbit-cue',
    'orbit-spin-cue',
    'library-rise-cue',
    'ash-shutter-cue'
  ];
  for (const retired of retiredTaxonomy) {
    assert.equal(source.includes(`'${retired}'`), false, `${retired} remains in production taxonomy`);
    assert.equal(configSource.includes(`'${retired}'`), false, `${retired} remains in config taxonomy`);
  }
  for (const definition of obstacles.familyCatalog) {
    assert.doesNotMatch(
      `${definition.id} ${definition.labelEn} ${definition.readabilityClass} ${definition.silhouette}`,
      /\b(?:wheel|gate|grandstand|lift|shutter)\b/i
    );
  }
});

test('deep-freezes taxonomy, geometry recipes, safety domains, gates, and budgets', () => {
  assertDeepFrozen(obstacles.REALM_IDS);
  assertDeepFrozen(obstacles.SCENE_LAYER_IDS);
  assertDeepFrozen(obstacles.EXPECTED_FAMILY_IDS_BY_REALM);
  assertDeepFrozen(obstacles.OBSTACLE_PRESENTATION_CONTRACT);
  assertDeepFrozen(obstacles.familyCatalog);
  for (const realmId of obstacles.REALM_IDS) assertDeepFrozen(obstacles.getRealmFamilies(realmId));

  const contract = obstacles.OBSTACLE_PRESENTATION_CONTRACT;
  assert.equal(contract.version, 3);
  assert.deepEqual(plain(contract.artDirection), {
    silhouetteLanguage: 'six-realm-organic-relic-motifs',
    insetLanguage: 'realm-specific-sealed-memory-relief',
    effectLanguage: 'sealed-memory-petals-and-constellation-stitches',
    surfaceLanguage: 'natural-dielectric-stone-ice-root-and-woven-cloth',
    realmMotifs: {
      'dawn-isle': {
        core: 'wind-wing-and-sun-aperture',
        relief: 'sun-petal-oculus',
        cue: 'wind-stitch-star-ring',
        cueGeometry: 'closed-memory-thread'
      },
      'prairie-garden': {
        core: 'bell-flower-and-butterfly-petal',
        relief: 'butterfly-petal-knot',
        cue: 'butterfly-memory-petal',
        cueGeometry: 'sealed-memory-petal'
      },
      'rainforest-glow': {
        core: 'root-arch-and-rain-drop',
        relief: 'rain-drop-root-carving',
        cue: 'rain-stitch-root-ring',
        cueGeometry: 'closed-memory-thread'
      },
      'twilight-valley': {
        core: 'ice-fan-and-woven-wind-banner',
        relief: 'woven-wind-petal',
        cue: 'woven-wind-memory-petal',
        cueGeometry: 'sealed-memory-petal'
      },
      'star-vault': {
        core: 'book-page-and-constellation-ring',
        relief: 'page-star-carving',
        cue: 'constellation-stitch-ring',
        cueGeometry: 'closed-memory-thread'
      },
      'eden-eye': {
        core: 'fractured-stone-and-ember-crown',
        relief: 'ember-crown-carving',
        cue: 'ember-memory-star-ring',
        cueGeometry: 'closed-memory-thread'
      }
    },
    materialProof: {
      blockingMetalness: 0,
      minimumBlockingRoughness: 0.84,
      cueShadingModel: 'unlit-emissive-no-metal-channel',
      localLightCount: 0
    },
    modernMechanicalPartCount: 0,
    neonFixtureCount: 0,
    inheritedByEveryFamily: true
  });
  assert.equal(contract.safePose.publicRootTransform, 'translation-only');
  assert.equal(contract.safePose.invalidPublicRootTransform, 'fail-fast-on-update');
  assert.equal(contract.safePose.blockingRootRotation, 'identity');
  assert.equal(contract.safePose.redirectLegacyTiltAndSpinTo, 'collision-free-effect-rig');
  assert.equal(contract.colliderFit.gameplayHalfFactor, 0.52);
  assert.equal(contract.colliderFit.opaqueBaseHalfFactor, 0.50);
  assert.deepEqual(plain(contract.colliderFit.minimumOpaqueCoverage), { x: 0.80, y: 0.65, z: 0.80 });
  assert.deepEqual(plain(contract.distanceGates.integration), {
    minimumM: 180,
    velocityCoefficient: 3.2,
    referenceVelocityMps: 45,
    referenceDistanceM: 180
  });
  assert.deepEqual(plain(contract.distanceGates.readability), {
    minimumM: 240,
    velocityCoefficient: 2,
    referenceVelocityMps: 45,
    referenceDistanceM: 240
  });
  assert.equal(contract.readability.minimumObstacleToRoadContrastRatio, 3);
  assert.equal(contract.readability.hudCue, false);
  assert.equal(contract.readability.fogParticipation, false);
  assert.ok(Object.values(contract.realmAvailabilityMultiplier).every((value) => value === 1));
});

test('prewarms before acquire and strictly validates family-to-realm-to-motion mapping', () => {
  const { obstacles: fresh } = loadModule();
  assert.throws(
    () => fresh.createFactory({
      THREE,
      modeling: null,
      quality: 'desktop'
    }),
    /requires the Neon modeling/
  );
});

test('requires dependency injection, rejects external state, and returns a direct Object3D root', () => {
  const loaded = loadModule();
  const factory = loaded.obstacles.createFactory({
    THREE,
    modeling: loaded.window.NeonModeling,
    qualityProfile: { id: 'high' },
    visualSeed: 'strict-interface'
  });
  assert.throws(
    () => loaded.obstacles.createFactory({
      THREE,
      modeling: loaded.window.NeonModeling,
      scene: {}
    }),
    /does not accept external state field: scene/
  );
  const definition = loaded.obstacles.familyCatalog[0];
  assert.throws(() => factory.availableCount(definition.id), /prewarmed/);
  assert.throws(() => factory.acquire(acquireOptions(definition)), /prewarmed/);
  factory.prewarm({ familyIds: [definition.id], countPerFamily: 1 });
  assert.equal(factory.availableCount(definition.id), 1);
  assert.throws(() => factory.availableCount('unknown-family'), /Unknown obstacle family/);
  assert.throws(
    () => factory.acquire(acquireOptions(definition, { realmId: 'eden-eye' })),
    /belongs to dawn-isle/
  );
  assert.throws(
    () => factory.acquire(acquireOptions(definition, { motionKind: 'wind-sweep-cue' })),
    /requires motionKind/
  );
  assert.throws(
    () => factory.acquire({ ...acquireOptions(definition), scene: {} }),
    /does not accept external state field: scene/
  );
  const root = factory.acquire(acquireOptions(definition));
  assert.equal(factory.availableCount(definition.id), 0);
  assert.equal(root.isObject3D, true);
  assert.equal(root.definition, definition);
  assert.equal(root.userData.neonObstacle.publicRootTransform, 'translation-only');
  assert.equal(root.userData.neonObstacle.blockingRootRotation, 'identity');
  assert.equal(root.userData.neonObstacle.fogParticipation, false);
  assert.equal(root.blockingRoot.rotation.x, 0);
  assert.equal(root.blockingRoot.rotation.y, 0);
  assert.equal(root.blockingRoot.rotation.z, 0);
  root.rotation.x = 0.20;
  assert.throws(
    () => factory.update(root, 1),
    /public root is translation-only/
  );
  root.rotation.set(0, 0, 0);
  root.scale.z = 1.05;
  assert.throws(
    () => factory.update(root, 1),
    /public root is translation-only/
  );
  root.scale.set(1, 1, 1);
  assert.throws(
    () => factory.update(root, 1, { velocityMps: 300 }),
    /does not accept external state field/
  );
  factory.release(root);
  assert.equal(factory.availableCount(definition.id), 1);
  factory.dispose();
});

test('injects marking hooks and separates blocking opaque meshes from collision-free effects', () => {
  const loaded = loadModule();
  const opaqueMarks = [];
  const effectMarks = [];
  const factory = loaded.obstacles.createFactory({
    THREE,
    modeling: loaded.window.NeonModeling,
    quality: 'desktop',
    visualSeed: 'marker-hooks',
    markOpaque(node, metadata) {
      opaqueMarks.push([node.name, metadata.role]);
    },
    markEffect(node, reason, metadata) {
      effectMarks.push([node.name, reason, metadata.role]);
    }
  });
  const definition = loaded.obstacles.getFamily('sweeping-wind-arch');
  factory.prewarm({ familyIds: [definition.id], countPerFamily: 1 });
  const root = factory.acquire(acquireOptions(definition));
  assert.equal(opaqueMarks.length, 2);
  assert.equal(effectMarks.length, 1);
  assert.equal(root.blockingRoot.userData.blockingOpaque, true);
  assert.equal(root.effectRoot.userData.collisionFree, true);

  const blockingMeshes = collectMeshes(root.blockingRoot);
  const effectMeshes = collectMeshes(root.effectRoot);
  assert.equal(blockingMeshes.length, 2);
  assert.equal(effectMeshes.length, 1);
  for (const mesh of blockingMeshes) {
    assert.equal(mesh.userData.blockingOpaque, true);
    assert.equal(mesh.userData.collisionFree, false);
    assert.equal(mesh.userData.collisionRole, 'gameplay-aabb');
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.fog, false);
  }
  for (const mesh of effectMeshes) {
    assert.equal(mesh.userData.blockingOpaque, false);
    assert.equal(mesh.userData.collisionFree, true);
    assert.equal(mesh.userData.collisionRole, 'none');
    assert.equal(mesh.material.transparent, true);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.blending, THREE.AdditiveBlending);
    assert.equal(mesh.material.fog, false);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
  }
  factory.release(root);
  factory.dispose();
});

test('keeps transformed blocking vertices inside 0.52 half and covers the collider without fake openings', () => {
  for (const quality of ['desktop', 'mobile']) {
    const loaded = loadModule();
    const factory = loaded.obstacles.createFactory({
      THREE,
      modeling: loaded.window.NeonModeling,
      quality,
      visualSeed: `box-domain-${quality}`
    });
    factory.prewarm();
    for (const definition of loaded.obstacles.familyCatalog) {
      const half = {
        x: 1.40 + definition.signatureIndex % 4 * 0.63,
        y: 1.15 + definition.signatureIndex % 5 * 0.41,
        z: 1.70 + definition.signatureIndex % 3 * 0.77
      };
      const root = factory.acquire(acquireOptions(definition, { half }));
      for (const seconds of [0, 0.125, 1.5, 9.75, 80]) {
        factory.update(root, seconds, { reducedMotion: false });
        root.updateMatrixWorld(true);
        const blockingMeshes = collectMeshes(root.blockingRoot);
        assert.ok(
          blockingMeshes.every(({ material }) => material.fog === false),
          `${definition.id} opaque contrast must survive contract-distance fog`
        );
        assert.ok(
          blockingMeshes.every(({ material }) => material.metalness === 0 && material.roughness >= 0.84),
          `${definition.id} blocking surfaces must remain natural dielectrics`
        );
        const box = combinedMeshWorldBox(blockingMeshes);
        const epsilon = 0.000_01;
        assert.ok(box.min.x >= -half.x - epsilon, `${definition.id} min x escaped`);
        assert.ok(box.max.x <= half.x + epsilon, `${definition.id} max x escaped`);
        assert.ok(box.min.y >= -half.y - epsilon, `${definition.id} min y escaped`);
        assert.ok(box.max.y <= half.y + epsilon, `${definition.id} max y escaped`);
        assert.ok(box.min.z >= -half.z - epsilon, `${definition.id} min z escaped`);
        assert.ok(box.max.z <= half.z + epsilon, `${definition.id} max z escaped`);
        const size = box.getSize(new THREE.Vector3());
        assert.ok(size.x / (half.x * 2) >= 0.80, `${definition.id} x coverage is misleading`);
        assert.ok(size.y / (half.y * 2) >= 0.65, `${definition.id} y coverage is misleading`);
        assert.ok(size.z / (half.z * 2) >= 0.80, `${definition.id} z coverage is misleading`);
        assert.equal(root.blockingRoot.rotation.x, 0);
        assert.equal(root.blockingRoot.rotation.y, 0);
        assert.equal(root.blockingRoot.rotation.z, 0);
        assert.equal(root.blockingRoot.scale.x, 1);
        assert.equal(root.blockingRoot.scale.y, 1);
        assert.equal(root.blockingRoot.scale.z, 1);
      }
      // The complete cue spin/scale domain may move only tagged transparent effects.
      for (const rotation of [-Math.PI * 2, -Math.PI, 0, Math.PI, Math.PI * 2]) {
        root.effectRoot.rotation.set(rotation, rotation * 0.5, -rotation * 0.25);
        root.effectRoot.scale.setScalar(1.02);
        root.updateMatrixWorld(true);
        for (const mesh of collectMeshes(root.effectRoot)) {
          assert.equal(mesh.userData.collisionFree, true);
          assert.equal(mesh.material.transparent, true);
          assert.equal(mesh.material.depthWrite, false);
          assert.equal(mesh.material.fog, false);
          assert.equal(mesh.castShadow, false);
          assert.equal(mesh.receiveShadow, false);
          assert.equal(mesh.material.depthTest, true);
          assert.equal(mesh.material.isMeshBasicMaterial, true);
          assert.equal(mesh.material.metalness, undefined);
          assert.equal(mesh.userData.motif, definition.geometryRecipe.cueMotif);
        }
        const effectBox = combinedMeshWorldBox(collectMeshes(root.effectRoot));
        const effectEpsilon = 0.000_01;
        assert.ok(effectBox.min.x >= -half.x - effectEpsilon, `${definition.id} cue min x escaped`);
        assert.ok(effectBox.max.x <= half.x + effectEpsilon, `${definition.id} cue max x escaped`);
        assert.ok(effectBox.min.y >= -half.y - effectEpsilon, `${definition.id} cue min y escaped`);
        assert.ok(effectBox.max.y <= half.y + effectEpsilon, `${definition.id} cue max y escaped`);
        assert.ok(effectBox.min.z >= -half.z - effectEpsilon, `${definition.id} cue min z escaped`);
        assert.ok(effectBox.max.z <= half.z + effectEpsilon, `${definition.id} cue max z escaped`);
      }
      factory.release(root);
    }
    factory.dispose();
  }
});

test('measures sealed realm contours, reliefs, family cues, and rendering budgets for both qualities', () => {
  const hashesByQuality = new Map();
  for (const quality of ['desktop', 'mobile']) {
    const loaded = loadModule();
    const factory = loaded.obstacles.createFactory({
      THREE,
      modeling: loaded.window.NeonModeling,
      quality,
      visualSeed: `topology-${quality}`
    });
    factory.prewarm();
    const reports = factory.getTopologyReport();
    assert.equal(reports.length, 30);
    const geometryHashes = new Set();
    const coreHashes = new Set();
    const reliefHashes = new Set();
    const cueHashes = new Set();
    const cueRoles = new Set();
    for (const report of reports) {
      assert.equal(report.allBlockingMeshesClosed, true, `${report.familyId} blocking mesh is open`);
      assert.equal(report.allRenderableMeshesClosed, true, `${report.familyId} cue mesh is open`);
      assert.equal(report.blockingMeshes.length, 2);
      for (const meshReport of report.blockingMeshes) {
        assert.equal(meshReport.isClosed, true);
        assert.equal(meshReport.boundaryEdges, 0);
        assert.equal(meshReport.nonManifoldEdges, 0);
        assert.equal(meshReport.degenerateTriangles, 0);
        assert.equal(meshReport.invalidCoordinates, 0);
      }
      assert.equal(report.cueMesh.role, 'memory-cue');
      assert.equal(report.cueMesh.isClosed, true);
      assert.equal(report.cueMesh.boundaryEdges, 0);
      assert.equal(report.cueMesh.nonManifoldEdges, 0);
      assert.equal(report.cueMesh.degenerateTriangles, 0);
      assert.equal(report.cueMesh.invalidCoordinates, 0);
      assert.ok(report.triangles <= (quality === 'mobile' ? 800 : 2_200));
      assert.ok(report.drawGroups <= 4);
      assert.ok(report.materials <= 3);
      assert.match(report.blockingGeometryHash, /^[0-9a-f]{8}$/);
      assert.match(report.coreGeometryHash, /^[0-9a-f]{8}$/);
      assert.match(report.reliefGeometryHash, /^[0-9a-f]{8}$/);
      assert.match(report.cueGeometryHash, /^[0-9a-f]{8}$/);
      geometryHashes.add(report.blockingGeometryHash);
      coreHashes.add(report.coreGeometryHash);
      reliefHashes.add(report.reliefGeometryHash);
      cueHashes.add(report.cueGeometryHash);
      cueRoles.add(report.cueMotif);
    }
    assert.equal(geometryHashes.size, 30);
    assert.equal(coreHashes.size, 30);
    assert.equal(reliefHashes.size, 30);
    assert.equal(cueHashes.size, 30);
    assert.equal(cueRoles.size, 30);
    for (const realmId of loaded.obstacles.REALM_IDS) {
      const realmReports = reports.filter(
        ({ familyId }) => loaded.obstacles.getFamily(familyId).realmId === realmId
      );
      assert.equal(new Set(realmReports.map(({ coreGeometryHash }) => coreGeometryHash)).size, 5);
      assert.equal(new Set(realmReports.map(({ reliefGeometryHash }) => reliefGeometryHash)).size, 5);
      assert.equal(new Set(realmReports.map(({ cueGeometryHash }) => cueGeometryHash)).size, 5);
      assert.equal(new Set(realmReports.map(({ coreMotif }) => coreMotif)).size, 1);
      assert.equal(new Set(realmReports.map(({ reliefMotif }) => reliefMotif)).size, 1);
    }
    hashesByQuality.set(quality, geometryHashes);
    const diagnostics = factory.getDiagnostics();
    assert.equal(diagnostics.builtFamilyCount, 30);
    assert.ok(diagnostics.maximumMeasuredTriangles <= (quality === 'mobile' ? 800 : 2_200));
    assert.ok(diagnostics.maximumMeasuredDrawGroups <= 4);
    assert.ok(diagnostics.maximumMeasuredMaterials <= 3);
    assert.equal(diagnostics.sceneLights, 0);
    assert.equal(diagnostics.gameplayWrites, 0);
    factory.dispose();
  }
  assert.equal(hashesByQuality.get('desktop').size, hashesByQuality.get('mobile').size);
});

test('keeps instance materials deeply isolated while preserving intra-instance source sharing semantics', () => {
  const loaded = loadModule();
  const factory = loaded.obstacles.createFactory({
    THREE,
    modeling: loaded.window.NeonModeling,
    quality: 'desktop',
    visualSeed: 'material-isolation'
  });
  const definition = loaded.obstacles.getFamily('butterfly-petal-guardian');
  factory.prewarm({ familyIds: [definition.id], countPerFamily: 2 });
  const first = factory.acquire(acquireOptions(definition, { visualKey: 'first' }));
  const second = factory.acquire(acquireOptions(definition, { visualKey: 'second' }));
  const firstMaterials = collectMeshes(first).map(({ material }) => material);
  const secondMaterials = collectMeshes(second).map(({ material }) => material);
  assert.equal(firstMaterials.length, 3);
  assert.equal(secondMaterials.length, 3);
  assert.equal(firstMaterials[0].roughness, 0.84);
  assert.equal(firstMaterials[0].metalness, 0);
  assert.equal(firstMaterials[1].roughness, 0.88);
  assert.equal(firstMaterials[1].metalness, 0);
  for (let index = 0; index < firstMaterials.length; index++) {
    assert.notEqual(firstMaterials[index], secondMaterials[index]);
    assert.notEqual(firstMaterials[index].userData, secondMaterials[index].userData);
    assert.notEqual(firstMaterials[index].userData.neon, secondMaterials[index].userData.neon);
    assert.equal(firstMaterials[index].onBeforeCompile, secondMaterials[index].onBeforeCompile);
    assert.equal(
      firstMaterials[index].customProgramCacheKey(),
      secondMaterials[index].customProgramCacheKey()
    );
  }
  const secondOpacity = secondMaterials[2].opacity;
  firstMaterials[2].opacity = 0.01;
  firstMaterials[2].userData.neon.mutated = true;
  assert.equal(secondMaterials[2].opacity, secondOpacity);
  assert.equal(secondMaterials[2].userData.neon.mutated, undefined);
  factory.release(first);
  factory.release(second);
  factory.dispose();
});

test('uses deterministic independent visual seeds and allocates no frame assets after prewarm', () => {
  const loaded = loadModule();
  const create = () => loaded.obstacles.createFactory({
    THREE,
    modeling: loaded.window.NeonModeling,
    quality: 'mobile',
    visualSeed: 'independent-stream'
  });
  const definition = loaded.obstacles.getFamily('rain-orbit-sentinel');
  const firstFactory = create();
  const secondFactory = create();
  firstFactory.prewarm({ familyIds: [definition.id], countPerFamily: 1 });
  secondFactory.prewarm({ familyIds: [definition.id], countPerFamily: 1 });
  const before = firstFactory.getDiagnostics();
  const first = firstFactory.acquire(acquireOptions(definition, { visualKey: 'same-key' }));
  const second = secondFactory.acquire(acquireOptions(definition, { visualKey: 'same-key' }));
  assert.equal(
    first.userData.neonObstacle.visualSeedHash,
    second.userData.neonObstacle.visualSeedHash
  );
  firstFactory.update(first, 7.25);
  secondFactory.update(second, 7.25);
  assert.equal(first.effectRoot.rotation.y, second.effectRoot.rotation.y);
  assert.equal(first.effectRoot.rotation.z, second.effectRoot.rotation.z);
  const after = firstFactory.getDiagnostics();
  assert.equal(after.objectAllocationCount, before.objectAllocationCount);
  assert.equal(after.assetBuildCount, before.assetBuildCount);
  assert.equal(after.frameAssetAllocations, 0);
  firstFactory.release(first);
  secondFactory.release(second);
  firstFactory.dispose();
  secondFactory.dispose();
});

test('settle/release are idempotent, release keeps assets, and render/shadow changes exclude effects', () => {
  const loaded = loadModule();
  const factory = loaded.obstacles.createFactory({
    THREE,
    modeling: loaded.window.NeonModeling,
    quality: 'desktop',
    visualSeed: 'lifecycle'
  });
  const definition = loaded.obstacles.getFamily('ash-storm-veil');
  factory.prewarm({ familyIds: [definition.id], countPerFamily: 1 });
  const root = factory.acquire(acquireOptions(definition));
  factory.update(root, 14);
  const highCueOpacity = collectMeshes(root.effectRoot)[0].material.opacity;
  assert.equal(factory.setRenderQuality('low'), true);
  assert.ok(collectMeshes(root.effectRoot)[0].material.opacity < highCueOpacity);
  assert.equal(factory.setRenderQuality('low'), false);
  assert.equal(factory.shadow(false), false);
  for (const mesh of collectMeshes(root.blockingRoot)) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
  }
  for (const mesh of collectMeshes(root.effectRoot)) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
  }
  const settled = factory.settle(root);
  assert.equal(settled, root);
  assert.equal(factory.settle(root), root);
  assert.equal(root.effectRoot.scale.x, 1);
  const materials = collectMeshes(root).map(({ material }) => material);
  assert.equal(factory.release(root), true);
  assert.equal(factory.release(root), false);
  assert.ok(materials.every(({ uuid }) => typeof uuid === 'string' && uuid.length > 0));
  const reacquired = factory.acquire(acquireOptions(definition));
  assert.equal(reacquired, root);
  assert.equal(reacquired.visible, true);
  assert.equal(factory.release(reacquired), true);
  assert.equal(factory.dispose(), true);
  assert.equal(factory.dispose(), false);
  assert.throws(() => factory.acquire(acquireOptions(definition)), /disposed/);
});

test('authors real six-realm geometry and never falls back to the retired generic halo or duplicate hook', () => {
  assert.doesNotMatch(source, /sealed-faceted-loft-with-inset-sigil|soft-memory-halo|TorusGeometry/);
  for (const realmId of obstacles.REALM_IDS.slice(0, -1)) {
    assert.ok(
      source.includes(`definition.realmId === '${realmId}'`),
      `${realmId} requires its own production contour branch`
    );
  }
  assert.match(source, /createMemoryPetalCueGeometry/);
  assert.match(source, /createMemoryThreadCueGeometry/);
  assert.match(source, /modeling\.createTubeGeometry/);
  assert.match(source, /modeling\.createExtrudedProfileGeometry/);
  assert.equal(source.match(/markEffect\s*=\s*null/g)?.length, 1);
});

test('contains no unseeded randomness, scene light construction, gameplay authority, or unseparated large literals', () => {
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /THREE\.(?:Ambient|Directional|Hemisphere|Point|RectArea|Spot)Light/);
  assert.doesNotMatch(source, /\b(?:reward|damage|handling|timeToCollision|plannedRoute|spawnCadence)\b/i);
  assert.doesNotMatch(source, /\b(?:2200|4294967296)\b/);
  assert.ok(source.includes('2_200'));
  assert.ok(source.includes('4_294_967_296'));
  assert.ok(source.includes("sceneLayer: 'route'"));
  assert.ok(source.includes("collisionRole: 'gameplay-aabb'"));
});
