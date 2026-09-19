import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = new URL('../../', import.meta.url);
const moduleUrl = new URL(
  'src/world/Neon_Autopilot_HighSpeed_DroneHeat.creatures.js',
  PROJECT_ROOT
);
const source = readFileSync(moduleUrl, 'utf8');
const THREE = require(fileURLToPath(new URL('vendor/three-0.160.0.min.js', PROJECT_ROOT)));
global.window = { THREE };
require(fileURLToPath(new URL(
  'src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.modeling.js',
  PROJECT_ROOT
)));
require(fileURLToPath(moduleUrl));
const modeling = global.window.NeonModeling;
const creatures = global.window.NeonCreatures;

const EXPECTED_IDS = Object.freeze({
  'dawn-isle': Object.freeze([
    'triwing-mist-sail',
    'windseed-swallow-flock',
    'ringtail-cloud-worm'
  ]),
  'prairie-garden': Object.freeze([
    'bellwing-pollinator-flock',
    'petal-sail-grazer',
    'moss-orb-skydrifter'
  ]),
  'rainforest-glow': Object.freeze([
    'leaf-skiff-bird',
    'rainlamp-frog',
    'sixfin-glow-snail'
  ]),
  'twilight-valley': Object.freeze([
    'ice-shuttle-swift',
    'ringtail-snow-runner',
    'prism-glide-bird'
  ]),
  'star-vault': Object.freeze([
    'spiral-script-finch',
    'polyhedral-star-mite',
    'orbit-dust-shoal'
  ]),
  'eden-eye': Object.freeze([
    'ash-corvid-flock',
    'four-sail-storm-beast',
    'cracked-shell-drifter'
  ])
});

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}

function configuredZones({ includeFamilies = false } = {}) {
  return creatures.REALM_IDS.map((id) => ({
    id,
    ...(includeFamilies ? { creatureFamilies: [...EXPECTED_IDS[id]] } : {})
  }));
}

function safePlacement(definition, velocityMps = 300) {
  const common = {
    authority: 'complete-road-capsule-query',
    realmId: definition.realmId,
    sealedTunnel: false,
    velocityMps,
    forwardClearanceM: Math.max(120, 2 * velocityMps),
    centerSpacingM: 120,
    clusterSpacingM: 45,
    highContrastLowAltitude: false,
    bearingDegrees: 30
  };
  if (definition.sceneLayer === 'air') {
    return {
      ...common,
      crossesRoad: true,
      maximumDeckHeightM: 9,
      completeLowerEdgeM: 15
    };
  }
  return {
    ...common,
    crossesRoad: false,
    completeHorizontalRoadCapsuleGapM: 6
  };
}

function createFactory(overrides = {}) {
  return creatures.createFactory({
    THREE,
    modeling,
    qualityProfile: 'high',
    visualSeed: 'creature-unit-visual-seed',
    ...overrides
  });
}

function activeVariant(root) {
  return root.children[0].children.find(({ visible }) => visible);
}

function geometrySignature(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  let checksum = 0;
  for (let vertex = 0; vertex < position.count; vertex++) {
    checksum += position.getX(vertex) * (vertex + 1);
    checksum += position.getY(vertex) * (vertex + 3);
    checksum += position.getZ(vertex) * (vertex + 7);
  }
  return [
    position.count,
    index?.count || 0,
    box.min.x.toFixed(5),
    box.max.y.toFixed(5),
    box.max.z.toFixed(5),
    checksum.toFixed(5)
  ].join(':');
}

/** Return one merged component's exact local AABB from its retained vertex range. */
function componentBounds(geometry, component) {
  const position = geometry.getAttribute('position');
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  box.makeEmpty();
  for (
    let vertex = component.vertexStart;
    vertex < component.vertexStart + component.vertexCount;
    vertex++
  ) {
    box.expandByPoint(point.fromBufferAttribute(position, vertex));
  }
  return box;
}

function rangesMayUseHiddenAttachmentSeam(left, right) {
  const kinds = new Set([left.kind, right.kind]);
  const sameMember = left.memberIndex === right.memberIndex;
  if (sameMember && kinds.has('body') && kinds.has('mask')) return true;
  if (sameMember && kinds.has('mask') && kinds.has('eye')) return true;
  if (left.memberIndex === 0 && right.memberIndex === 0) {
    if (kinds.has('body') && kinds.has('appendage')) return true;
    if (kinds.has('body') && kinds.has('tail')) return true;
  }
  return false;
}

/** Moller-Trumbore segment/triangle test; coplanar attachment faces intentionally return false. */
function segmentCrossesTriangle(start, end, a, b, c) {
  const epsilon = 0.000_000_1;
  const direction = new THREE.Vector3().subVectors(end, start);
  const edgeA = new THREE.Vector3().subVectors(b, a);
  const edgeB = new THREE.Vector3().subVectors(c, a);
  const p = new THREE.Vector3().crossVectors(direction, edgeB);
  const determinant = edgeA.dot(p);
  if (Math.abs(determinant) <= epsilon) return false;
  const inverse = 1 / determinant;
  const fromA = new THREE.Vector3().subVectors(start, a);
  const u = fromA.dot(p) * inverse;
  if (u < -epsilon || u > 1 + epsilon) return false;
  const q = new THREE.Vector3().crossVectors(fromA, edgeA);
  const v = direction.dot(q) * inverse;
  if (v < -epsilon || u + v > 1 + epsilon) return false;
  const distance = edgeB.dot(q) * inverse;
  return distance > epsilon && distance < 1 - epsilon;
}

function triangleCrossesTriangle(left, right) {
  return segmentCrossesTriangle(left[0], left[1], ...right)
    || segmentCrossesTriangle(left[1], left[2], ...right)
    || segmentCrossesTriangle(left[2], left[0], ...right)
    || segmentCrossesTriangle(right[0], right[1], ...left)
    || segmentCrossesTriangle(right[1], right[2], ...left)
    || segmentCrossesTriangle(right[2], right[0], ...left);
}

/** Count real non-coplanar crossings between retained production triangle ranges, stopping at the contract cap. */
function forbiddenTriangleCrossings(geometry, left, right, maximum = 1) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const readTriangle = (triangleIndex) => {
    const offset = triangleIndex * 3;
    return [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(
      position,
      index ? index.getX(offset + corner) : offset + corner
    ));
  };
  let crossings = 0;
  for (
    let leftTriangle = left.triangleStart;
    leftTriangle < left.triangleStart + left.triangleCount;
    leftTriangle++
  ) {
    const leftPoints = readTriangle(leftTriangle);
    const leftBox = new THREE.Box3().setFromPoints(leftPoints);
    for (
      let rightTriangle = right.triangleStart;
      rightTriangle < right.triangleStart + right.triangleCount;
      rightTriangle++
    ) {
      const rightPoints = readTriangle(rightTriangle);
      if (!leftBox.intersectsBox(new THREE.Box3().setFromPoints(rightPoints))) continue;
      if (!triangleCrossesTriangle(leftPoints, rightPoints)) continue;
      crossings++;
      if (crossings >= maximum) return crossings;
    }
  }
  return crossings;
}

test('publishes the exact ordered 18-family bilingual taxonomy with three families per realm', () => {
  assert.ok(Object.isFrozen(creatures));
  assert.deepEqual([...creatures.REALM_IDS], [
    'dawn-isle',
    'prairie-garden',
    'rainforest-glow',
    'twilight-valley',
    'star-vault',
    'eden-eye'
  ]);
  assert.equal(creatures.CREATURE_CATALOG.length, 18);
  assert.equal(new Set(creatures.CREATURE_CATALOG.map(({ id }) => id)).size, 18);

  for (const realmId of creatures.REALM_IDS) {
    const definitions = creatures.CREATURE_CATALOG.filter(
      (definition) => definition.realmId === realmId
    );
    assert.deepEqual(definitions.map(({ id }) => id), EXPECTED_IDS[realmId]);
    assert.equal(definitions.length, 3);
    for (const definition of definitions) {
      assert.equal(creatures.describe(realmId, definition.id), definition);
      assert.match(definition.labelZh, /[\u3400-\u9fff]/u);
      assert.match(definition.labelEn, /^[A-Z][A-Za-z ]+$/);
      assert.ok(['air', 'roadside'].includes(definition.sceneLayer));
      assert.equal(definition.semanticRole, 'creature-ambient');
      assert.equal(definition.collisionRole, 'none');
      assert.ok(definition.mapPriority === 0 || definition.mapPriority === 1);
      assert.equal(definition.presentationOnly, true);
      assert.equal(definition.lightCount, 0);
      assert.equal(definition.tunnelPolicy, 'hidden');
      assert.ok(definition.motionEnvelopeM > 0);
    }
  }
});

test('deep-freezes every contract, label, recipe, palette, alias, and region array', () => {
  assertDeepFrozen(creatures.CREATURE_VISUAL_CONTRACT);
  assertDeepFrozen(creatures.REALM_IDS);
  assertDeepFrozen(creatures.CREATURE_CATALOG);
  assertDeepFrozen(creatures.CREATURE_VISUAL_CONTRACT.legacyReplacementAliases);
  assert.equal(
    creatures.CREATURE_VISUAL_CONTRACT.legacyReplacementAliases.sky_manta,
    'triwing-mist-sail'
  );
  assert.equal(
    creatures.CREATURE_VISUAL_CONTRACT.legacyReplacementAliases.dark_dragon,
    'four-sail-storm-beast'
  );
  assert.equal(creatures.CREATURE_CATALOG.some(({ id }) => id === 'sky_manta'), false);
  assert.equal(creatures.CREATURE_CATALOG.some(({ id }) => id === 'dark_dragon'), false);
});

test('locks transition previews to adjacent small families and three 24m segments', () => {
  const contract = creatures.CREATURE_VISUAL_CONTRACT;
  assert.equal(contract.transition.policy, 'adjacent-realm-preview-72m');
  assert.equal(contract.transition.previewLengthM, 72);
  assert.equal(contract.transition.segmentLengthM, 24);
  assert.deepEqual(contract.transition.segments.map(({ id }) => id), ['front', 'middle', 'back']);
  assert.deepEqual(
    contract.transition.segments.map(({ startM, endM }) => [startM, endM]),
    [[0, 24], [24, 48], [48, 72]]
  );
  for (const definition of creatures.CREATURE_CATALOG) {
    const previewAllowed = definition.transitionPolicy === contract.transition.policy;
    assert.equal(previewAllowed, definition.scaleClass === 'small-cluster');
  }

  const factory = createFactory();
  factory.prewarm();
  const definition = creatures.describe('dawn-isle', 'windseed-swallow-flock');
  const root = factory.acquire({
    realmId: definition.realmId,
    familyId: definition.id,
    zoneIndex: 0,
    seed: 'transition',
    transitionPreview: {
      fromRealmId: 'prairie-garden',
      distanceFromBoundaryM: 36,
      segmentId: 'middle'
    },
    placement: safePlacement(definition)
  });
  assert.equal(root.userData.transitionPreviewSegment, 'middle');
  assert.equal(root.userData.creatureRealmId, 'dawn-isle');
  assert.equal(root.userData.creatureZoneIndex, 0);
  assert.equal(root.userData.zoneIndex, 0);
  assert.equal(root.userData.visualZone, 0);
  factory.release(root);

  const large = creatures.describe('dawn-isle', 'triwing-mist-sail');
  assert.throws(() => factory.acquire({
    realmId: large.realmId,
    familyId: large.id,
    transitionPreview: {
      fromRealmId: 'prairie-garden',
      distanceFromBoundaryM: 12
    },
    placement: safePlacement(large)
  }), /may not preview/);
  assert.throws(() => factory.acquire({
    realmId: definition.realmId,
    familyId: definition.id,
    transitionPreview: {
      fromRealmId: 'rainforest-glow',
      distanceFromBoundaryM: 12
    },
    placement: safePlacement(definition)
  }), /must be adjacent/);
  assert.throws(() => factory.acquire({
    realmId: definition.realmId,
    familyId: definition.id,
    transitionPreview: {
      fromRealmId: 'prairie-garden',
      distanceFromBoundaryM: 73
    },
    placement: safePlacement(definition)
  }), /0\.\.72m/);
  factory.dispose();
});

test('validates current ordered zones and rejects family, order, count, and identity drift', () => {
  assert.equal(creatures.validateConfiguredZones(configuredZones()), true);
  assert.equal(creatures.validateConfiguredZones(configuredZones({ includeFamilies: true })), true);
  assert.throws(() => creatures.validateConfiguredZones(), /must be an array/);
  assert.throws(() => creatures.validateConfiguredZones(configuredZones().slice(1)), /exactly 6 zones/);

  const swapped = configuredZones();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.throws(() => creatures.validateConfiguredZones(swapped), /expected zone dawn-isle/);

  const missing = configuredZones({ includeFamilies: true });
  missing[2].creatureFamilies.pop();
  assert.throws(() => creatures.validateConfiguredZones(missing), /exactly three creature families/);

  const reordered = configuredZones({ includeFamilies: true });
  [reordered[4].creatureFamilies[0], reordered[4].creatureFamilies[1]] = [
    reordered[4].creatureFamilies[1],
    reordered[4].creatureFamilies[0]
  ];
  assert.throws(() => creatures.validateConfiguredZones(reordered), /order does not match/);
  assert.throws(() => creatures.describe('unknown', 'triwing-mist-sail'), /Unknown creature realm/);
  assert.throws(
    () => creatures.describe('eden-eye', 'triwing-mist-sail'),
    /Unknown creature family/
  );
});

test('publishes zero-authority presentation budgets and uses no random, light, or route-writing dependency', () => {
  const contract = creatures.CREATURE_VISUAL_CONTRACT;
  assert.equal(contract.version, 3);
  assert.deepEqual(contract.artDirection, {
    silhouetteLanguage: 'living-woven-cloth',
    faceLanguage: 'quiet-two-eye-spirit-mask',
    surfaceLanguage: 'matte-pigment-and-soft-memory-glow',
    spiritMasksPerVisibleMember: 1,
    maskEyesPerVisibleMember: 2,
    modernMechanicalPartCount: 0,
    singleMergedDrawGeometry: true
  });
  assert.equal(contract.presentationOnly, true);
  assert.equal(contract.collisionRole, 'none');
  assert.equal(contract.lightCount, 0);
  assert.equal(contract.colliderCount, 0);
  assert.equal(contract.routeWrites, 0);
  assert.equal(contract.maximumMapRecordsPerRoot, 1);
  assert.equal(contract.clusterMembersReceiveMapRecords, false);
  assert.equal(contract.maximumDrawGroupsPerFamily, 3);
  assert.equal(contract.maximumMaterialsPerFamily, 3);
  assert.equal(contract.qualityBudgets.high.maximumVisibleRootsPerRealm, 8);
  assert.equal(contract.qualityBudgets.low.maximumVisibleRootsPerRealm, 4);
  assert.equal(contract.qualityBudgets.high.maximumTrianglesPerFamily, 2_200);
  assert.equal(contract.qualityBudgets.low.maximumTrianglesPerFamily, 800);
  assert.equal(contract.qualityBudgets.high.maximumVisibleTrianglesPerRealm, 15_000);
  assert.equal(contract.qualityBudgets.low.maximumVisibleTrianglesPerRealm, 5_000);
  assert.equal(contract.sealedTunnelVisibleRoots, 0);
  assert.equal(contract.frameGeometryAllocations, 0);
  assert.equal(contract.frameMaterialAllocations, 0);
  assert.equal(
    contract.visibleIntersection.policy,
    'closed-components-with-hidden-attachment-seams-only'
  );
  assert.equal(contract.visibleIntersection.maximumForbiddenTriangleCrossingsPerQuality, 0);
  assert.equal(contract.visibleIntersection.minimumClusterMemberSurfaceGapM, 0.06);
  assert.deepEqual(contract.visibleIntersection.separatedAppendageFamilyIds, [
    'moss-orb-skydrifter',
    'polyhedral-star-mite',
    'cracked-shell-drifter'
  ]);
  assert.deepEqual(contract.visibleIntersection.clusterClearanceFamilyIds, [
    'windseed-swallow-flock',
    'bellwing-pollinator-flock',
    'leaf-skiff-bird',
    'spiral-script-finch',
    'orbit-dust-shoal',
    'ash-corvid-flock'
  ]);

  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /new THREE\.(?:AmbientLight|DirectionalLight|HemisphereLight|PointLight|RectAreaLight|SpotLight)/);
  assert.doesNotMatch(source, /\b(?:score|lives)\b/);
  assert.doesNotMatch(source, /options\.(?:state|route|collision)/);
  assert.match(source, /templateMaterial\.clone\(\)/);
});

test('prewarms unique closed finite nondegenerate geometry within every quality budget', () => {
  const factory = createFactory();
  assert.throws(() => factory.getPoolRoots(), /explicit prewarm/);
  assert.throws(
    () => factory.getPlacementMetrics('dawn-isle', 'triwing-mist-sail'),
    /explicit prewarm/
  );
  assert.equal(factory.prewarm(), true);
  assert.equal(factory.prewarm(), false);
  const diagnostics = factory.getDiagnostics();
  assert.equal(diagnostics.familyCount, 18);
  assert.equal(diagnostics.topologyRootCount, 18);
  assert.equal(diagnostics.pooledRootCount, 54);
  assert.equal(diagnostics.geometryAllocations, 54);
  assert.equal(diagnostics.materialAllocations, 216);
  assert.equal(diagnostics.sceneLights, 0);
  assert.equal(diagnostics.colliders, 0);
  const poolRoots = factory.getPoolRoots();
  assert.equal(Object.isFrozen(poolRoots), true);
  assert.equal(poolRoots.length, 54);
  assert.equal(new Set(poolRoots).size, 54);

  const signatures = new Set();
  for (const definition of creatures.CREATURE_CATALOG) {
    const measured = diagnostics.measuredByFamily[definition.id];
    for (const qualityId of ['low', 'medium', 'high']) {
      const quality = measured[qualityId];
      const cap = creatures.CREATURE_VISUAL_CONTRACT
        .qualityBudgets[qualityId].maximumTrianglesPerFamily;
      assert.ok(quality.triangles > 0 && quality.triangles <= cap);
      assert.equal(quality.drawGroups, 1);
      assert.equal(quality.materials, 1);
      assert.equal(quality.topology.isClosed, true);
      assert.equal(quality.topology.invalidCoordinates, 0);
      assert.equal(quality.topology.degenerateTriangles, 0);
      assert.equal(quality.topology.zeroAreaTriangles, 0);
      assert.equal(quality.topology.nonManifoldEdges, 0);
      assert.equal(quality.topology.boundaryEdges, 0);
    }
  }

  for (const root of factory.getTopologyRoots()) {
    const high = root.children[0].children.find(
      ({ userData }) => userData.creatureQualityId === 'high'
    );
    const definition = creatures.describe(
      root.userData.creatureRealmId,
      root.userData.creatureFamilyId
    );
    signatures.add(geometrySignature(high.geometry));
    assert.equal(high.userData.topology.isClosed, true);
    assert.equal(high.userData.artDirectionVersion, 3);
    assert.equal(high.userData.spiritMaskCount, definition.geometry.clusterCount);
    assert.equal(high.userData.maskEyeCount, definition.geometry.clusterCount * 2);
    assert.equal(high.userData.modernMechanicalPartCount, 0);
    assert.equal(high.geometry.userData.neon.spiritMaskCount, definition.geometry.clusterCount);
    assert.equal(high.geometry.userData.neon.maskEyeCount, definition.geometry.clusterCount * 2);
    high.geometry.computeBoundingBox();
    assert.ok(
      high.geometry.boundingBox.min.z < -definition.geometry.bodyLengthM * 0.50,
      `${definition.id} needs a real forward-relief spirit mask, not metadata alone`
    );
    assert.equal(high.material.roughness, 0.84);
    assert.equal(high.material.metalness, 0);
    assert.equal(high.material.clearcoat, 0.02);
    assert.equal(high.material.clearcoatRoughness, 0.86);
    assert.equal(root.userData.presentationOnly, true);
    assert.equal(root.userData.collisionRole, 'none');
    assert.equal(root.userData.lightCount, 0);
    assert.equal(root.userData.mapRecordLimit, 1);
    assert.equal(root.userData.artDirectionVersion, 3);
    assert.equal(root.userData.silhouetteLanguage, 'living-woven-cloth');
    assert.equal(root.userData.modernMechanicalPartCount, 0);
  }
  assert.equal(signatures.size, 18, 'Every family needs a distinct authored geometry signature');

  for (const definition of creatures.CREATURE_CATALOG) {
    const root = poolRoots.find(
      ({ userData }) => userData.creatureFamilyId === definition.id
    );
    let localMinY = Number.POSITIVE_INFINITY;
    let localMaxY = Number.NEGATIVE_INFINITY;
    let maximumAbsoluteX = 0;
    let maximumAbsoluteZ = 0;
    for (const mesh of root.children[0].children) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      localMinY = Math.min(localMinY, box.min.y);
      localMaxY = Math.max(localMaxY, box.max.y);
      maximumAbsoluteX = Math.max(
        maximumAbsoluteX,
        Math.abs(box.min.x),
        Math.abs(box.max.x)
      );
      maximumAbsoluteZ = Math.max(
        maximumAbsoluteZ,
        Math.abs(box.min.z),
        Math.abs(box.max.z)
      );
    }
    const metrics = factory.getPlacementMetrics(definition.realmId, definition.id);
    assert.equal(Object.isFrozen(metrics), true);
    assert.equal(metrics.localMinY, localMinY);
    assert.equal(metrics.localMaxY, localMaxY);
    assert.equal(metrics.horizontalRadiusM, Math.hypot(maximumAbsoluteX, maximumAbsoluteZ));
    assert.equal(metrics.motionEnvelopeM, definition.motionEnvelopeM);
  }

  const identityDefinition = creatures.describe('dawn-isle', 'triwing-mist-sail');
  const acquired = factory.acquire({
    realmId: identityDefinition.realmId,
    familyId: identityDefinition.id,
    placement: safePlacement(identityDefinition)
  });
  assert.ok(poolRoots.includes(acquired), 'acquire must return the same root identity registered by world');
  factory.release(acquired);
  factory.dispose();
});

test('real production triangles cross only inside the four declared hidden attachment seams', () => {
  const factory = createFactory();
  factory.prewarm();
  const maximumCrossings = creatures.CREATURE_VISUAL_CONTRACT
    .visibleIntersection.maximumForbiddenTriangleCrossingsPerQuality;
  for (const root of factory.getTopologyRoots()) {
    for (const mesh of root.children[0].children) {
      const geometry = mesh.geometry;
      const components = geometry.userData.neon.componentRanges;
      assert.ok(Object.isFrozen(components));
      assert.ok(components.length >= 6);
      const position = geometry.getAttribute('position');
      const index = geometry.getIndex();
      const exactTriangleKeys = new Set();
      for (let offset = 0; offset < index.count; offset += 3) {
        const corners = [0, 1, 2].map((corner) => {
          const vertex = index.getX(offset + corner);
          return [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
            .map((value) => value.toFixed(7))
            .join(',');
        }).sort();
        const key = corners.join('|');
        assert.equal(
          exactTriangleKeys.has(key),
          false,
          `${root.userData.creatureFamilyId}/${mesh.userData.creatureQualityId} duplicates triangle ${key}`
        );
        exactTriangleKeys.add(key);
      }
      const bounds = components.map((component) => componentBounds(geometry, component));
      const appendageBounds = new THREE.Box3();
      appendageBounds.makeEmpty();
      for (let index = 0; index < components.length; index++) {
        if (components[index].kind === 'appendage') appendageBounds.union(bounds[index]);
      }
      for (let index = 0; index < components.length; index++) {
        const component = components[index];
        if (component.kind !== 'body' || component.memberIndex === 0) continue;
        const bodyBounds = bounds[index];
        const actualGapM = bodyBounds.min.x >= 0
          ? bodyBounds.min.x - appendageBounds.max.x
          : appendageBounds.min.x - bodyBounds.max.x;
        assert.ok(
          actualGapM + 0.000_001 >= creatures.CREATURE_VISUAL_CONTRACT
            .visibleIntersection.minimumClusterMemberSurfaceGapM,
          `${root.userData.creatureFamilyId}/${mesh.userData.creatureQualityId} `
            + `member ${component.memberIndex} has only ${actualGapM}m of visible wing clearance`
        );
      }
      for (let leftIndex = 0; leftIndex < components.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex++) {
          const left = components[leftIndex];
          const right = components[rightIndex];
          if (rangesMayUseHiddenAttachmentSeam(left, right)) continue;
          if (!bounds[leftIndex].intersectsBox(bounds[rightIndex])) continue;
          const crossings = forbiddenTriangleCrossings(
            geometry,
            left,
            right,
            maximumCrossings + 1
          );
          assert.equal(
            crossings,
            maximumCrossings,
            `${root.userData.creatureFamilyId}/${mesh.userData.creatureQualityId} `
              + `${left.kind}[${left.memberIndex}:${left.partIndex}] crosses `
              + `${right.kind}[${right.memberIndex}:${right.partIndex}]`
          );
        }
      }
    }
  }
  factory.dispose();
});

test('actual animated vertices remain inside the placement motion envelope at every quality', () => {
  const factory = createFactory();
  factory.prewarm();
  const point = new THREE.Vector3();
  for (const qualityId of ['low', 'medium', 'high']) {
    factory.setRenderQuality(qualityId);
    for (const definition of creatures.CREATURE_CATALOG) {
      const root = factory.acquire({
        realmId: definition.realmId,
        familyId: definition.id,
        placement: safePlacement(definition),
        seed: `envelope-${qualityId}-${definition.id}`
      });
      const metrics = factory.getPlacementMetrics(definition.realmId, definition.id);
      for (let sample = 0; sample <= 240; sample++) {
        factory.update(root, {
          timeSeconds: sample * 0.5,
          paused: false,
          reducedMotion: false
        });
        root.updateMatrixWorld(true);
        const mesh = activeVariant(root);
        const position = mesh.geometry.getAttribute('position');
        let minimumY = Number.POSITIVE_INFINITY;
        let maximumY = Number.NEGATIVE_INFINITY;
        let maximumHorizontalRadiusM = 0;
        for (let vertex = 0; vertex < position.count; vertex++) {
          point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
          minimumY = Math.min(minimumY, point.y);
          maximumY = Math.max(maximumY, point.y);
          maximumHorizontalRadiusM = Math.max(
            maximumHorizontalRadiusM,
            Math.hypot(point.x, point.z)
          );
        }
        assert.ok(
          minimumY >= metrics.localMinY - metrics.motionEnvelopeM - 0.000_001
            && maximumY <= metrics.localMaxY + metrics.motionEnvelopeM + 0.000_001,
          `${definition.id}/${qualityId} escapes the vertical motion envelope at sample ${sample}`
        );
        assert.ok(
          maximumHorizontalRadiusM
            <= metrics.horizontalRadiusM + metrics.motionEnvelopeM + 0.000_001,
          `${definition.id}/${qualityId} escapes the horizontal motion envelope at sample ${sample}`
        );
      }
      factory.release(root);
    }
  }
  factory.dispose();
});

test('enforces deck, road-capsule, spacing, tunnel, forward, and reading-wedge placement proofs', () => {
  const factory = createFactory();
  factory.prewarm();
  const air = creatures.describe('eden-eye', 'four-sail-storm-beast');
  const roadside = creatures.describe('rainforest-glow', 'rainlamp-frog');
  const small = creatures.describe('twilight-valley', 'ice-shuttle-swift');

  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id
  }), /placement proof/);
  const missingSealedTunnel = safePlacement(air);
  delete missingSealedTunnel.sealedTunnel;
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: missingSealedTunnel
  }), /explicitly declare sealedTunnel/);
  const missingCrossesRoad = safePlacement(air);
  delete missingCrossesRoad.crossesRoad;
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: missingCrossesRoad
  }), /explicitly declare crossesRoad/);
  const missingContrastFlag = safePlacement(air);
  delete missingContrastFlag.highContrastLowAltitude;
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: missingContrastFlag
  }), /explicitly declare highContrastLowAltitude/);
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: {
      ...safePlacement(air),
      highContrastLowAltitude: true,
      bearingDegrees: Number.NaN
    }
  }), /finite bearingDegrees/);
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: { ...safePlacement(air), completeLowerEdgeM: 14.999 }
  }), /clear the highest deck by 6m/);
  assert.throws(() => factory.acquire({
    realmId: roadside.realmId,
    familyId: roadside.id,
    placement: { ...safePlacement(roadside), completeHorizontalRoadCapsuleGapM: 5.999 }
  }), /at least 6m/);
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: { ...safePlacement(air), centerSpacingM: 119.999 }
  }), /at least 120m/);
  assert.throws(() => factory.acquire({
    realmId: small.realmId,
    familyId: small.id,
    placement: { ...safePlacement(small), clusterSpacingM: 44.999 }
  }), /at least 45m/);
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: { ...safePlacement(air), sealedTunnel: true }
  }), /hidden in sealed tunnels/);
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    placement: { ...safePlacement(air), forwardClearanceM: 599.999 }
  }), /at least 600m/);
  assert.throws(() => factory.acquire({
    realmId: roadside.realmId,
    familyId: roadside.id,
    placement: {
      ...safePlacement(roadside, 50),
      forwardClearanceM: 150,
      highContrastLowAltitude: true,
      bearingDegrees: 11.9
    }
  }), /forward reading wedge/);
  assert.throws(() => factory.acquire({
    realmId: air.realmId,
    familyId: air.id,
    zoneIndex: 4,
    placement: safePlacement(air)
  }), /requires zoneIndex 5/);
  factory.dispose();
});

test('deep-clones mutable pool materials and idempotently resets realm, pose, phase, and material state', () => {
  const factory = createFactory();
  factory.prewarm();
  const definition = creatures.describe('prairie-garden', 'moss-orb-skydrifter');
  const request = {
    realmId: definition.realmId,
    familyId: definition.id,
    zoneIndex: 1,
    placement: safePlacement(definition)
  };
  const first = factory.acquire({ ...request, seed: 'first' });
  const second = factory.acquire({ ...request, seed: 'second' });
  assert.ok(first && second && first !== second);
  const firstMaterial = activeVariant(first).material;
  const secondMaterial = activeVariant(second).material;
  assert.notEqual(firstMaterial, secondMaterial);
  const baselineColor = secondMaterial.color.getHex();
  const baselineMaterial = {
    roughness: secondMaterial.roughness,
    metalness: secondMaterial.metalness,
    clearcoat: secondMaterial.clearcoat,
    clearcoatRoughness: secondMaterial.clearcoatRoughness,
    sheen: secondMaterial.sheen,
    sheenRoughness: secondMaterial.sheenRoughness,
    envMapIntensity: secondMaterial.envMapIntensity,
    specularIntensity: secondMaterial.specularIntensity,
    depthTest: secondMaterial.depthTest,
    wireframe: secondMaterial.wireframe
  };
  firstMaterial.color.setHex(0x12_3456);
  firstMaterial.opacity = 0.2;
  firstMaterial.roughness = 0.01;
  firstMaterial.metalness = 0.99;
  firstMaterial.clearcoat = 0.91;
  firstMaterial.clearcoatRoughness = 0.02;
  firstMaterial.sheen = 0.97;
  firstMaterial.sheenRoughness = 0.03;
  firstMaterial.envMapIntensity = 7;
  firstMaterial.specularIntensity = 0.04;
  firstMaterial.depthTest = false;
  firstMaterial.wireframe = true;
  first.position.set(9, 8, 7);
  first.rotation.set(0.4, 0.3, 0.2);
  first.scale.set(2, 3, 4);
  factory.update(first, { timeSeconds: 12, reducedMotion: false, paused: false });
  assert.equal(secondMaterial.color.getHex(), baselineColor);

  assert.equal(factory.release(first), true);
  const reused = factory.acquire({ ...request, seed: 'reused' });
  assert.equal(reused, first);
  assert.deepEqual(reused.position.toArray(), [0, 0, 0]);
  assert.deepEqual([reused.rotation.x, reused.rotation.y, reused.rotation.z], [0, 0, 0]);
  assert.deepEqual(reused.scale.toArray(), [1, 1, 1]);
  assert.equal(activeVariant(reused).material.color.getHex(), baselineColor);
  assert.equal(activeVariant(reused).material.opacity, 1);
  for (const [field, value] of Object.entries(baselineMaterial)) {
    assert.equal(activeVariant(reused).material[field], value, `${field} leaked across pool reuse`);
  }
  assert.equal(reused.userData.creatureRealmId, 'prairie-garden');
  assert.equal(reused.userData.creatureZoneIndex, 1);
  assert.equal(reused.userData.zoneIndex, 1);
  assert.equal(reused.userData.visualZone, 1);
  assert.equal(reused.userData.transitionPreviewSegment, null);
  assert.equal(reused.userData.active, true);
  factory.release(reused);
  factory.release(second);
  assert.equal(factory.release(second), false);
  factory.dispose();
});

test('pause freezes presentation and reduced motion resets only decorative transforms', () => {
  const factory = createFactory();
  factory.prewarm();
  const definition = creatures.describe('star-vault', 'orbit-dust-shoal');
  const root = factory.acquire({
    realmId: definition.realmId,
    familyId: definition.id,
    placement: safePlacement(definition),
    seed: 'motion'
  });
  const pivot = root.children[0];
  factory.update(root, { timeSeconds: 9, paused: false, reducedMotion: false });
  const animated = {
    y: pivot.position.y,
    x: pivot.rotation.x,
    yaw: pivot.rotation.y,
    z: pivot.rotation.z,
    emissive: activeVariant(root).material.emissiveIntensity
  };
  assert.notEqual(animated.y, 0);
  factory.update(root, { timeSeconds: 99, paused: true, reducedMotion: false });
  assert.deepEqual({
    y: pivot.position.y,
    x: pivot.rotation.x,
    yaw: pivot.rotation.y,
    z: pivot.rotation.z,
    emissive: activeVariant(root).material.emissiveIntensity
  }, animated);

  const authoritativeMetadata = {
    realmId: root.userData.creatureRealmId,
    zoneIndex: root.userData.creatureZoneIndex,
    familyId: root.userData.creatureFamilyId
  };
  factory.update(root, { timeSeconds: 100, paused: false, reducedMotion: true });
  assert.deepEqual(
    [pivot.position.y, pivot.rotation.x, pivot.rotation.y, pivot.rotation.z],
    [0, 0, 0, 0]
  );
  assert.deepEqual({
    realmId: root.userData.creatureRealmId,
    zoneIndex: root.userData.creatureZoneIndex,
    familyId: root.userData.creatureFamilyId
  }, authoritativeMetadata);
  factory.release(root);
  factory.dispose();
});

test('quality switching is reversible and enforces 8 desktop or 4 mobile visible roots', () => {
  const factory = createFactory();
  factory.prewarm();
  const definitions = creatures.CREATURE_CATALOG.filter(
    ({ realmId }) => realmId === 'dawn-isle'
  );
  const roots = [];
  for (let index = 0; index < 8; index++) {
    const definition = definitions[index % definitions.length];
    roots.push(factory.acquire({
      realmId: definition.realmId,
      familyId: definition.id,
      seed: `visible-${index}`,
      placement: safePlacement(definition)
    }));
  }
  assert.ok(roots.every(Boolean));
  const ninthDefinition = definitions[2];
  assert.equal(factory.acquire({
    realmId: ninthDefinition.realmId,
    familyId: ninthDefinition.id,
    seed: 'ninth',
    placement: safePlacement(ninthDefinition)
  }), null);
  assert.equal(factory.getDiagnostics().visibleByRealm['dawn-isle'], 8);

  assert.equal(factory.setRenderQuality('low'), true);
  assert.equal(factory.getDiagnostics().activeQualityId, 'low');
  assert.equal(factory.getDiagnostics().visibleByRealm['dawn-isle'], 4);
  assert.equal(roots.filter(({ visible }) => visible).length, 4);
  assert.ok(roots.filter(({ visible }) => visible).every(
    (root) => activeVariant(root).userData.creatureQualityId === 'low'
  ));
  assert.equal(factory.setRenderQuality('medium'), true);
  assert.equal(factory.getDiagnostics().visibleByRealm['dawn-isle'], 8);
  assert.ok(roots.every(
    (root) => activeVariant(root).userData.creatureQualityId === 'medium'
  ));
  assert.equal(factory.setRenderQuality('high'), true);
  assert.ok(roots.every(
    (root) => activeVariant(root).userData.creatureQualityId === 'high'
  ));
  assert.equal(factory.setRenderQuality('high'), false);
  assert.throws(() => factory.setRenderQuality('cinematic'), /Unknown creature render quality/);
  for (const root of roots) factory.release(root);
  factory.dispose();
});

test('settle resets only decorations and cannot overwrite world placement or bypass the low cap', () => {
  const factory = createFactory();
  factory.prewarm();
  const definitions = creatures.CREATURE_CATALOG.filter(
    ({ realmId }) => realmId === 'prairie-garden'
  );
  const roots = [];
  for (let index = 0; index < 8; index++) {
    const definition = definitions[index % definitions.length];
    roots.push(factory.acquire({
      realmId: definition.realmId,
      familyId: definition.id,
      seed: `settle-${index}`,
      placement: safePlacement(definition)
    }));
  }
  factory.setRenderQuality('low');
  const hidden = roots.find(({ visible }) => !visible);
  const shown = roots.find(({ visible }) => visible);
  hidden.position.set(31, 17, -42);
  hidden.rotation.set(0.31, -0.27, 0.14);
  hidden.scale.set(1.4, 0.8, 1.2);
  factory.update(hidden, { timeSeconds: 12, reducedMotion: false, paused: false });
  assert.equal(factory.settle(hidden), true);
  assert.deepEqual(hidden.position.toArray(), [31, 17, -42]);
  assert.deepEqual(
    [hidden.rotation.x, hidden.rotation.y, hidden.rotation.z],
    [0.31, -0.27, 0.14]
  );
  assert.deepEqual(hidden.scale.toArray(), [1.4, 0.8, 1.2]);
  assert.equal(hidden.visible, false);
  assert.equal(factory.getDiagnostics().visibleByRealm['prairie-garden'], 4);

  shown.position.set(-8, 19, 23);
  shown.visible = true;
  assert.equal(factory.settle(shown), true);
  assert.deepEqual(shown.position.toArray(), [-8, 19, 23]);
  assert.equal(shown.visible, true);

  factory.release(hidden);
  assert.deepEqual(hidden.position.toArray(), [0, 0, 0]);
  assert.deepEqual([hidden.rotation.x, hidden.rotation.y, hidden.rotation.z], [0, 0, 0]);
  assert.deepEqual(hidden.scale.toArray(), [1, 1, 1]);
  for (const root of roots) {
    if (root !== hidden) factory.release(root);
  }
  factory.dispose();
});

test('frame updates preserve construction allocation counters and dispose is idempotent', () => {
  const factory = createFactory({ qualityProfile: 'mobile' });
  const rootDefinition = creatures.describe('eden-eye', 'ash-corvid-flock');
  const root = factory.acquire({
    realmId: rootDefinition.realmId,
    familyId: rootDefinition.id,
    placement: safePlacement(rootDefinition),
    seed: 'allocation'
  });
  const before = factory.getDiagnostics();
  for (let frame = 0; frame < 600; frame++) {
    factory.update(root, {
      timeSeconds: frame / 60,
      paused: false,
      reducedMotion: frame % 120 === 0
    });
  }
  const after = factory.getDiagnostics();
  assert.equal(after.geometryAllocations, before.geometryAllocations);
  assert.equal(after.materialAllocations, before.materialAllocations);
  assert.equal(after.frameGeometryAllocations, 0);
  assert.equal(after.frameMaterialAllocations, 0);
  assert.equal(factory.settle(root), true);
  assert.equal(factory.dispose(), true);
  assert.equal(factory.dispose(), false);
  assert.equal(factory.update(root, { timeSeconds: 1 }), false);
  assert.equal(factory.release(root), false);
});

test('keeps large JavaScript numeric literals visibly separated in source', () => {
  for (const literal of ['2_200', '15_000', '5_000', '4_294_967_296']) {
    assert.ok(source.includes(literal), `missing separated numeric literal ${literal}`);
  }
  assert.doesNotMatch(source, /\b(?:2200|15000|5000|4294967296)\b/);
});
