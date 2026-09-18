#!/usr/bin/env node
/* Cross-batch visible-scenery clearance acceptance / 跨批次可见景物净空验收。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const runtimePath = path.join(
  PROJECT_ROOT,
  'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'
);
const runtimeSource = readFileSync(runtimePath, 'utf8');
const FIXED_VISUAL_SEED = 'scenery-clearance-integration-v1';
const EPSILON_M = 0.000_001;

/** Canvas-only production assets need pixels, never a browser rasterizer, in this geometry acceptance. */
function installCanvasDocumentStub() {
  const gradient = Object.freeze({ addColorStop() {} });
  const context = new Proxy({
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 })
  }, {
    get(target, key) {
      return key in target ? target[key] : () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    }
  });
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      return {
        width: 1,
        height: 1,
        getContext(contextId) {
          assert.equal(contextId, '2d');
          return context;
        }
      };
    }
  };
}

globalThis.window = globalThis;
globalThis.location = { search: '?modelDebug=1' };
globalThis.innerWidth = 1_440;
globalThis.innerHeight = 900;
globalThis.devicePixelRatio = 1;
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node-scenery-clearance-test' };
installCanvasDocumentStub();
const originalConsoleWarn = console.warn;
console.warn = () => {};
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
console.warn = originalConsoleWarn;
globalThis.THREE = THREE;

for (const relativePath of [
  'src/config/Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js',
  'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js',
  'src/gameplay/Neon_Autopilot_V23_HighSpeed_DroneHeat.gameplay-core.js',
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js',
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js',
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js',
  'src/weather/Neon_Autopilot_V23_HighSpeed_DroneHeat.weather.js',
  'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.region-scenery.js',
  'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.creatures.js',
  'src/entities/Neon_Autopilot_V23_HighSpeed_DroneHeat.candlelight.js',
  'src/entities/Neon_Autopilot_V23_HighSpeed_DroneHeat.ship.js',
  'src/weather/Neon_Autopilot_V23_HighSpeed_DroneHeat.surface-weather.js',
  'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.world.js'
]) require(path.join(PROJECT_ROOT, relativePath));

const config = globalThis.NeonV23Config;
const modeling = globalThis.NeonV23Modeling;
const gameplayCore = globalThis.NeonV23GameplayCore;
const productionTrack = globalThis.NeonV23Track;
const cloverleafVisuals = globalThis.NeonV23CloverleafVisuals;
const world = globalThis.NeonV23World;
const creatures = globalThis.NeonV23Creatures;
const candlelight = globalThis.NeonV23Candlelight;
const surfaceWeather = globalThis.NeonV23SurfaceWeather;
const ship = globalThis.NeonV23Ship;

// Transparent effects are excluded only by exact production identity; solid snow, terrain, roots, and blockers
// never enter this whitelist merely because their material later becomes translucent.
const TRANSPARENT_EFFECT_NAME_WHITELIST = Object.freeze(new Set([
  'V23.SurfaceWeather.Puddles',
  'V23.SurfaceWeather.CompressedTracks',
  'V23.SurfaceWeather.DisplacedSnowRidges',
  'V23.SurfaceWeather.PuddleRipples',
  'V23.SurfaceWeather.WaterWakes',
  'V23.SurfaceWeather.WaterSpray',
  'V23.SurfaceWeather.SnowPowder'
]));

/** Extract the exact production declaration so the browser runtime remains the single geometry implementation. */
function extractFunctionDeclaration(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.ok(start >= 0, `Missing production function ${functionName}`);
  const parameterStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < source.length; index++) {
    if (source[index] === '(') parameterDepth++;
    else if (source[index] === ')') parameterDepth--;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  assert.ok(parameterEnd > parameterStart, `Unterminated parameters for ${functionName}`);
  const bodyStart = source.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated production function ${functionName}`);
}

function evaluateSkyTerrainArtContract() {
  const start = runtimeSource.indexOf('const SKY_TERRAIN_ART_CONTRACT = Object.freeze({');
  const end = runtimeSource.indexOf('\n\n  function terrainCellHash(', start);
  assert.ok(start >= 0 && end > start, 'Sky terrain art contract is missing');
  return new Function(`${runtimeSource.slice(start, end)}\nreturn SKY_TERRAIN_ART_CONTRACT;`)();
}

function evaluateTerrainRoadFeatureExclusionContract(artContract) {
  const start = runtimeSource.indexOf(
    'const terrainRoadFeatureExclusionContract = Object.freeze({'
  );
  const end = runtimeSource.indexOf('\n\n  function terrainCellHash(', start);
  assert.ok(start >= 0 && end > start, 'Terrain road-feature exclusion contract is missing');
  return new Function(
    'SKY_TERRAIN_ART_CONTRACT',
    `${runtimeSource.slice(start, end)}\nreturn terrainRoadFeatureExclusionContract;`
  )(artContract);
}

function evaluateCinematicSceneryClearanceContract() {
  const start = runtimeSource.indexOf(
    'const cameraCinematicSceneryClearanceContract = Object.freeze({'
  );
  const end = runtimeSource.indexOf(
    '\n\n  /** Return signed point-to-cylinder clearance',
    start
  );
  assert.ok(start >= 0 && end > start, 'Film scenery-clearance contract is missing');
  return new Function(
    `${runtimeSource.slice(start, end)}\nreturn cameraCinematicSceneryClearanceContract;`
  )();
}

/**
 * Run the frozen Film cylinder and aggregate functions with retained production-shaped records. The injected arrays
 * replace only the browser-owned pools; every numerical clearance and convergence branch is exact production code.
 */
function createCinematicSceneryClearanceFactory(collections = {}) {
  const contract = evaluateCinematicSceneryClearanceContract();
  const functionSource = [
    'cinematicSceneryCylinderClearanceM',
    'resolveCinematicSceneryCylinderClearance',
    'resetCinematicSceneryAggregate',
    'considerCinematicSceneryBlocker',
    'scanCinematicSceneryBlockers',
    'resolveCinematicSceneryAggregate'
  ].map((name) => extractFunctionDeclaration(runtimeSource, name)).join('\n');
  return new Function(
    'cameraCinematicSceneryClearanceContract',
    'collections',
    `'use strict';
const graphRenderOrigin = Object.freeze({ x: 0, z: 0 });
const hasRouteGraphContract = () => true;
const cinematicSceneryRenderOriginX = () => 0;
const cinematicSceneryRenderOriginZ = () => 0;
const worldMapEntityContract = Object.freeze({ entities: collections.worldEntities || [] });
const obstacles = collections.obstacles || [];
const pickups = collections.pickups || [];
const cameraCinematicPickupHorizontalRadiusM = Math.max(
  ${candlelight.CANDLELIGHT_CONTRACT.collectible.colliderHalfM},
  ${candlelight.CANDLELIGHT_CONTRACT.collectible.haloOuterRadiusM},
  ${candlelight.CANDLELIGHT_CONTRACT.collectible.maximumTrailLengthM}
);
const cameraCinematicPickupVerticalHalfM = Math.max(
  ${candlelight.CANDLELIGHT_CONTRACT.collectible.colliderHalfM},
  ${candlelight.CANDLELIGHT_CONTRACT.collectible.maximumAnimatedOpaqueHalfM},
  ${candlelight.CANDLELIGHT_CONTRACT.collectible.haloOuterRadiusM}
);
const cameraCinematicSceneryEmptyRecords = Object.freeze([]);
const cloverleafVisuals = Object.freeze({
  getAmbientTrafficMarkers: () => collections.ambientTrafficMarkers || cameraCinematicSceneryEmptyRecords,
  getCameraBlockers: () => collections.routeCameraBlockers || cameraCinematicSceneryEmptyRecords
});
const cameraCinematicSceneryCylinderScratch = Object.seal({
  safe: true,
  adjusted: false,
  fallbackRequired: false,
  resolvedY: 0,
  liftM: 0,
  candidateClearanceM: Number.POSITIVE_INFINITY,
  clearanceM: Number.POSITIVE_INFINITY,
  horizontalDistanceM: Number.POSITIVE_INFINITY
});
${functionSource}
return Object.freeze({
  contract: cameraCinematicSceneryClearanceContract,
  clearanceM: cinematicSceneryCylinderClearanceM,
  resolveCylinder: resolveCinematicSceneryCylinderClearance,
  resolveAggregate: resolveCinematicSceneryAggregate
});`
  )(contract, collections);
}

/** Instantiate the exact High16 or Mobile10 production terrain builder with immutable build dependencies. */
function createTerrainGeometryFactory(artContract, qualityProfileId) {
  const functionNames = [
    'terrainCellHash',
    'terrainFeatureUnit',
    'terrainEcotoneWeight',
    'terrainHeightAt',
    'terrainChunkHeightAt',
    'pushTerrainVertex',
    'pushTerrainTriangle',
    'pushTerrainQuad',
    'appendTerrainOutlinePrism',
    'appendTerrainBlade',
    'appendTerrainRibbon',
    'appendTerrainMound',
    'appendTerrainCandleStar',
    'appendTerrainArcBand',
    'appendTerrainRootArch',
    'appendTerrainBasin',
    'appendTerrainWindStone',
    'inspectTerrainFeatureTopology',
    'buildTerrainFeatureClusterMetadata',
    'createTerrainChunkGeometry'
  ];
  const functionSource = functionNames.map((name) => (
    extractFunctionDeclaration(runtimeSource, name)
  )).join('\n');
  return new Function(
    'THREE',
    'terrainChunkSize',
    'terrainChunkHalfSize',
    'terrainSurfaceSegments',
    'terrainFeatureDensityScale',
    'qualityProfile',
    'SKY_TERRAIN_ART_CONTRACT',
    'clamp',
    'lerp',
    'NeonV23RenderingError',
    `${functionSource}\nreturn createTerrainChunkGeometry;`
  )(
    THREE,
    96,
    48,
    qualityProfileId === 'mobile' ? 10 : 16,
    0.55,
    Object.freeze({ id: qualityProfileId }),
    artContract,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    (start, end, amount) => start + (end - start) * amount,
    class NeonV23RenderingError extends Error {}
  );
}

/** Execute the production two-bit visibility decision against the production graph-wide road query. */
function createTerrainRoadFeatureMaskFactory(exclusionContract) {
  const envelopeSource = extractFunctionDeclaration(
    runtimeSource,
    'writeTerrainFeatureClusterWorldEnvelope'
  );
  const maskSource = extractFunctionDeclaration(runtimeSource, 'terrainRoadFeatureMaskForCell');
  return new Function(
    'track',
    'terrainRoadFeatureExclusionContract',
    'terrainSurfaceElevation',
    `let terrainRoadFeatureClearanceQueryCount = 0;
let terrainRoadFeatureClearanceQueryFrameCount = 0;
const terrainRoadFeatureCenterScratch = Object.seal({ x: 0, z: 0 });
const terrainRoadFeatureVerticalEnvelopeScratch = Object.seal({ minY: 0, maxY: 0 });
const terrainRoadFeatureClearanceOptionsScratch = Object.seal({
  minimumGap: terrainRoadFeatureExclusionContract.minimumRoadGapM,
  verticalEnvelope: terrainRoadFeatureVerticalEnvelopeScratch
});
const hasRouteGraphContract = () => true;
${envelopeSource}
${maskSource}
return Object.freeze({
  maskForCell: terrainRoadFeatureMaskForCell,
  writeEnvelope: writeTerrainFeatureClusterWorldEnvelope,
  getQueryCount: () => terrainRoadFeatureClearanceQueryCount
});`
  )(productionTrack, exclusionContract, -1.20);
}

/** Build the exact triangulated absolute-world sampler injected into production world scenery. */
function createProductionTerrainSampler(state, qualityProfileId = 'high') {
  const functionNames = [
    'terrainCellHash',
    'terrainEcotoneWeight',
    'terrainHeightAt',
    'terrainChunkHeightAt',
    'terrainLocalPointForWorldCell',
    'sampleTerrainChunkTriangulatedHeight',
    'terrainLayerIndexForWorldCell',
    'sampleTerrainWorldHeight'
  ];
  const functionSource = functionNames.map((name) => (
    extractFunctionDeclaration(runtimeSource, name)
  )).join('\n');
  return new Function(
    'zones',
    'state',
    'terrainSurfaceSegments',
    'NeonV23RenderingError',
    `const terrainChunkSize = 96;
const terrainChunkHalfSize = 48;
const terrainSurfaceElevation = -1.20;
const terrainPureGeometryCount = zones.length;
const terrainEcotoneJitterM = terrainChunkSize * 0.42;
const terrainSampleProjectionScratch = Object.seal({
  renderOriginX: 0,
  renderOriginZ: 0,
  routeDistance: 0,
  routeForwardX: 0,
  routeForwardZ: -1
});
const terrainSampleLocalPointScratch = Object.seal({ x: 0, z: 0 });
const launchOptions = Object.freeze({ zone: null });
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
function zoneStateAtS(distanceM) {
  const realmLengthM = 2_700;
  const totalLengthM = realmLengthM * zones.length;
  const normalizedM = ((Number(distanceM) % totalLengthM) + totalLengthM) % totalLengthM;
  const index = Math.floor(normalizedM / realmLengthM);
  const localM = normalizedM - index * realmLengthM;
  return {
    index,
    nextIndex: (index + 1) % zones.length,
    blend: clamp((localM - (realmLengthM - 72)) / 72, 0, 1)
  };
}
function resolveTerrainWorldProjection(out) {
  out.renderOriginX = 0;
  out.renderOriginZ = -state.distance;
  out.routeDistance = state.distance;
  out.routeForwardX = 0;
  out.routeForwardZ = -1;
  return out;
}
${functionSource}
return sampleTerrainWorldHeight;`
  )(
    config.zones,
    state,
    qualityProfileId === 'mobile' ? 10 : 16,
    class NeonV23RenderingError extends Error {}
  );
}

function buildProductionCloverleafVisual() {
  const scene = new THREE.Scene();
  const buildJob = cloverleafVisuals.createBuildJob({
    THREE,
    track: productionTrack,
    modeling,
    scene,
    qualityProfile: Object.freeze({ id: 'desktop' }),
    renderQualityId: 'medium'
  });
  let stepCount = 0;
  while (!buildJob.step(4)) {
    stepCount++;
    assert.ok(stepCount < 100_000, 'Production cloverleaf visual build stalled');
  }
  return buildJob.finish();
}

/** Return one retained creature component's exact local bounds. */
function componentBounds(geometry, component) {
  const position = geometry.getAttribute('position');
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  box.makeEmpty();
  for (
    let vertex = component.vertexStart;
    vertex < component.vertexStart + component.vertexCount;
    vertex++
  ) box.expandByPoint(point.fromBufferAttribute(position, vertex));
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

/** Moller-Trumbore segment/triangle test; coplanar hidden mounting faces do not count as visible crossings. */
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

function trianglesCross(left, right) {
  return segmentCrossesTriangle(left[0], left[1], ...right)
    || segmentCrossesTriangle(left[1], left[2], ...right)
    || segmentCrossesTriangle(left[2], left[0], ...right)
    || segmentCrossesTriangle(right[0], right[1], ...left)
    || segmentCrossesTriangle(right[1], right[2], ...left)
    || segmentCrossesTriangle(right[2], right[0], ...left);
}

/** Stop after the first forbidden production-triangle crossing; the public contract allows exactly zero. */
function hasForbiddenTriangleCrossing(geometry, left, right) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const readTriangle = (triangleIndex) => {
    const offset = triangleIndex * 3;
    return [0, 1, 2].map((corner) => new THREE.Vector3().fromBufferAttribute(
      position,
      index ? index.getX(offset + corner) : offset + corner
    ));
  };
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
      if (trianglesCross(leftPoints, rightPoints)) return true;
    }
  }
  return false;
}

function safeCreaturePlacement(definition) {
  const common = {
    authority: 'complete-road-capsule-query',
    realmId: definition.realmId,
    sealedTunnel: false,
    velocityMps: 300,
    forwardClearanceM: 600,
    centerSpacingM: 120,
    clusterSpacingM: 45,
    highContrastLowAltitude: false,
    bearingDegrees: 30
  };
  return definition.sceneLayer === 'air'
    ? { ...common, crossesRoad: true, maximumDeckHeightM: 9, completeLowerEdgeM: 15 }
    : { ...common, crossesRoad: false, completeHorizontalRoadCapsuleGapM: 6 };
}

test('High16/Mobile10 six-realm feature solids leave zero visible penetration across the complete road-capsule union', () => {
  const artContract = evaluateSkyTerrainArtContract();
  const exclusionContract = evaluateTerrainRoadFeatureExclusionContract(artContract);
  const productionQuerySource = String(productionTrack.queryRoadClearance);
  assert.equal(exclusionContract.mode, 'full-graph-road-capsule-per-feature-cluster');
  assert.match(
    productionQuerySource,
    /const candidateEdges = \[\.\.\.graphEdges, \.\.\.runtimeEdgesById\.values\(\)\];/
  );
  productionTrack.createPathPlan({
    entryPort: 'south',
    kind: 'straight',
    futureMovementKind: 'left'
  });
  const audit = createTerrainRoadFeatureMaskFactory(exclusionContract);
  const cellCenters = Object.freeze([
    Object.freeze({ x: 0, z: 0 }),
    Object.freeze({ x: 0, z: 11 * 96 }),
    Object.freeze({ x: 96, z: 0 })
  ]);
  let auditedEnvelopeCount = 0;
  let hiddenIntersectingEnvelopeCount = 0;
  let visibleIntersectingEnvelopeCount = 0;
  for (const qualityProfileId of ['high', 'mobile']) {
    const createGeometry = createTerrainGeometryFactory(artContract, qualityProfileId);
    for (let zoneIndex = 0; zoneIndex < config.zones.length; zoneIndex++) {
      for (const secondaryZone of [null, config.zones[(zoneIndex + 1) % config.zones.length]]) {
        const geometry = createGeometry(config.zones[zoneIndex], zoneIndex, secondaryZone);
        assert.equal(
          geometry.userData.surfaceVertexCount,
          (qualityProfileId === 'mobile' ? 10 : 16) ** 2 * 6
        );
        const layer = { geometry };
        for (const cell of cellCenters) {
          for (let rotationQuarter = 0; rotationQuarter < 4; rotationQuarter++) {
            for (const reliefScale of [0.88, 1.12]) {
              const mask = audit.maskForCell(
                layer,
                cell.x,
                cell.z,
                rotationQuarter,
                reliefScale
              );
              for (const cluster of geometry.userData.skyTerrainFeatureClusters) {
                const center = { x: 0, z: 0 };
                const verticalEnvelope = { minY: 0, maxY: 0 };
                audit.writeEnvelope(
                  cluster,
                  cell.x,
                  cell.z,
                  rotationQuarter,
                  reliefScale,
                  center,
                  verticalEnvelope
                );
                const clearance = productionTrack.queryRoadClearance(
                  center,
                  cluster.maximumHorizontalRadiusM,
                  {
                    minimumGap: exclusionContract.minimumRoadGapM,
                    verticalEnvelope
                  }
                );
                const visible = Boolean(mask & (1 << cluster.clusterIndex));
                auditedEnvelopeCount++;
                if (!clearance.intersects) continue;
                if (visible) visibleIntersectingEnvelopeCount++;
                else hiddenIntersectingEnvelopeCount++;
              }
            }
          }
        }
        geometry.dispose();
      }
    }
  }
  assert.equal(auditedEnvelopeCount, 2 * 6 * 2 * 3 * 4 * 2 * 2);
  assert.ok(hiddenIntersectingEnvelopeCount > 0, 'Fixed road fixture exercised no terrain carve');
  assert.equal(visibleIntersectingEnvelopeCount, 0);
  assert.equal(audit.getQueryCount(), auditedEnvelopeCount);
});

test('fixed-seed real world roots have zero non-semantic terrain float or burial', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(63, 16 / 9, 0.15, 1_800);
  const state = {
    distance: 1_300,
    speed: 300,
    themeOffset: 0,
    skyZoneIndex: 0,
    skyBlend: 0.37,
    activeDaylight: 0.72,
    activeStarOpacity: 0.28,
    running: true,
    paused: false,
    weather: {
      rain: 1,
      snow: 0,
      hail: 0,
      dust: 0,
      wind: 0.4,
      gust: 0.2,
      motionTimeSeconds: 0
    }
  };
  const sampleTerrainHeight = createProductionTerrainSampler(state, 'high');
  const sampleCommitted = (s, lateral, out = {}) => Object.assign(out, {
    x: lateral,
    y: 48,
    surfaceHeight: 48,
    z: -s,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    tangentX: 0,
    tangentY: 0,
    tangentZ: -1,
    yaw: 0,
    tunnelKind: null,
    covered: false,
    underpassBlend: 0
  });
  let layer = null;
  const previousInfo = console.info;
  const previousWarn = console.warn;
  try {
    console.info = () => {};
    console.warn = () => {};
    layer = world.createDecorationLayer({
      THREE,
      scene,
      state,
      roadCenterAt: () => 0,
      roadSlopeAt: () => 0,
      localZFromS: (s) => state.distance - s,
      sampleWorldFrameAtDistance: (s, out = {}) => sampleCommitted(s, 0, out),
      sampleCommittedWorldFrameAtDistance: sampleCommitted,
      sampleTerrainHeight,
      getWorldRenderOrigin: (out = {}) => Object.assign(out, {
        x: 0,
        y: 0,
        z: -state.distance
      }),
      camera,
      branchSeparation: 12,
      groundSceneryExclusionHalfWidth: 9,
      groundSceneryGap: 1.2,
      roadClearanceQuery: () => ({ clear: true, clearance: 8 }),
      maximumDeckHeight: 9,
      zones: config.zones,
      quality: 'high',
      renderQualityId: 'high',
      zoneAtS: (s) => ((Math.floor(s / 2_700) % 6) + 6) % 6,
      visualSeed: FIXED_VISUAL_SEED,
      isReducedMotionEnabled: () => false
    });

    let nowMs = 10_000;
    for (let zoneIndex = 0; zoneIndex < 6; zoneIndex++) {
      state.skyZoneIndex = zoneIndex;
      for (const distance of [zoneIndex * 2_700 + 1, zoneIndex * 2_700 + 2_620]) {
        state.distance = distance;
        layer.updateDecoration(nowMs++, { sunIntensity: 2, ambientIntensity: 1 });
        layer.updateDecoration(nowMs++, { sunIntensity: 2, ambientIntensity: 1 });
      }
    }

    const contract = world.SCENERY_TERRAIN_CONTACT_CONTRACT;
    const baselineRoots = scene.children.filter(({ userData }) => userData?.kind === 'zoneModel');
    const regionRoots = scene.children.filter(
      ({ userData }) => typeof userData?.regionSceneryFamilyId === 'string'
    );
    const ambientRoots = scene.children.filter(
      ({ userData }) => userData?.placementMode === 'ambient-environment'
    );
    assert.equal(baselineRoots.length, 42);
    assert.equal(regionRoots.length, 48);
    assert.equal(ambientRoots.length, 6);
    const designedAirborneIds = new Set(contract.designedAirborneRegionFamilyIds);
    let nonSemanticContactCount = 0;
    let auditedGroundContactCount = 0;
    let designedAirborneCount = 0;

    for (const root of baselineRoots) {
      const anchor = root.userData.worldAnchor;
      assert.ok(anchor, `${root.name} has no terrain anchor`);
      const contactErrorM = Math.abs(
        anchor.y + root.userData.localMinY - sampleTerrainHeight(anchor.x, anchor.z)
      );
      if (contactErrorM > contract.contactToleranceM) nonSemanticContactCount++;
      auditedGroundContactCount++;
    }

    for (const root of regionRoots) {
      const anchor = root.userData.worldAnchor;
      assert.ok(anchor, `${root.name} has no terrain anchor`);
      if (designedAirborneIds.has(root.userData.regionSceneryFamilyId)) {
        designedAirborneCount++;
        const lowerEnvelopeM = anchor.y + root.userData.localMinY - root.userData.motionEnvelopeM;
        assert.ok(
          lowerEnvelopeM >= Math.max(anchor.terrainY, 9)
            + contract.designedAirborneMinimumDeckClearanceM - 0.000_1
        );
        continue;
      }
      const contactErrorM = Math.abs(
        anchor.y + root.userData.localMinY - sampleTerrainHeight(anchor.x, anchor.z)
      );
      if (contactErrorM > contract.contactToleranceM) nonSemanticContactCount++;
      auditedGroundContactCount++;
    }

    for (const root of ambientRoots) {
      const anchor = root.userData.worldAnchor;
      const contact = root.userData.terrainContactInstances;
      assert.ok(anchor && contact);
      const cosine = Math.cos(anchor.yaw + root.userData.baseYaw);
      const sine = Math.sin(anchor.yaw + root.userData.baseYaw);
      for (let index = 0; index < contact.count; index++) {
        const offset = index * 16;
        const worldX = anchor.x + cosine * contact.localX[index] + sine * contact.localZ[index];
        const worldZ = anchor.z - sine * contact.localX[index] + cosine * contact.localZ[index];
        const bottomWorldY = anchor.y + contact.baseMatrix[offset + 13]
          + contact.baseBoundsMinY * contact.baseScaleY[index];
        const contactErrorM = Math.abs(bottomWorldY - sampleTerrainHeight(worldX, worldZ));
        if (contactErrorM > contract.contactToleranceM) nonSemanticContactCount++;
        auditedGroundContactCount++;
      }
    }

    assert.equal(designedAirborneCount, contract.designedAirborneRegionFamilies);
    assert.equal(auditedGroundContactCount, 42 + contract.groundedRegionFamilies + 44);
    assert.equal(nonSemanticContactCount, 0);
    assert.ok(layer.clearanceReport.roadCapsuleQueries > 0);
    assert.equal(layer.clearanceReport.roadCapsuleClearanceViolations, 0);
    assert.ok(layer.clearanceReport.terrainMaximumContactErrorM <= contract.contactToleranceM);

    const visibleMapRecords = layer.getMapEntities().entities.filter(({ visible }) => visible);
    assert.ok(visibleMapRecords.length > 0);
    for (const record of visibleMapRecords) {
      assert.ok(record.horizontalRadiusM >= record.geometryHorizontalRadiusM);
      assert.ok(record.cameraClearanceMinY <= record.absoluteMinY);
      assert.ok(record.cameraClearanceMaxY >= record.absoluteMaxY);
      assert.ok(record.cameraClearanceHalfHeightM >= record.halfHeightM);
    }
  } finally {
    layer?.dispose();
    console.info = previousInfo;
    console.warn = previousWarn;
  }
});

test('submitted companions keep spacing and every visible route structure resolves to Film margin', () => {
  let visual = null;
  try {
    visual = buildProductionCloverleafVisual();
    const trafficContract = cloverleafVisuals.ambientTrafficArtContract;
    const filmClearance = createCinematicSceneryClearanceFactory();
    const filmResolution = {};
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const submittedPositions = Array.from(
      { length: visual.diagnostics.ambientTrafficCapacity },
      () => new THREE.Vector3()
    );
    const submittedRadii = new Float64Array(visual.diagnostics.ambientTrafficCapacity);
    const localTrafficRadiusM = visual.traffic.geometry.boundingSphere.radius;
    let minimumTrafficSurfaceGapM = Number.POSITIVE_INFINITY;
    let resolvedRouteBlockerCount = 0;
    const visibleRouteBlockerKinds = new Set();

    for (const time of [0, 1_000, 7_500, 31_000, 95_000]) {
      visual.update({ origin: { x: 0, z: 0 }, time, visible: true });
      const submittedCount = visual.traffic.count;
      for (let index = 0; index < submittedCount; index++) {
        visual.traffic.getMatrixAt(index, matrix);
        matrix.decompose(submittedPositions[index], quaternion, scale);
        submittedRadii[index] = localTrafficRadiusM * Math.max(
          Math.abs(scale.x),
          Math.abs(scale.y),
          Math.abs(scale.z)
        );
      }
      for (let left = 0; left < submittedCount; left++) {
        for (let right = left + 1; right < submittedCount; right++) {
          minimumTrafficSurfaceGapM = Math.min(
            minimumTrafficSurfaceGapM,
            submittedPositions[left].distanceTo(submittedPositions[right])
              - submittedRadii[left] - submittedRadii[right]
          );
        }
      }

      const blockers = visual.getCameraBlockers().filter(({ visible }) => visible);
      assert.ok(blockers.length > 0);
      assert.equal(new Set(blockers.map(({ id }) => id)).size, blockers.length);
      for (const blocker of blockers) {
        assert.equal(typeof blocker.id, 'string');
        assert.equal(typeof blocker.kind, 'string');
        assert.ok(Number.isFinite(blocker.x));
        assert.ok(Number.isFinite(blocker.y));
        assert.ok(Number.isFinite(blocker.z));
        assert.ok(Number.isFinite(blocker.radiusM) && blocker.radiusM > 0);
        assert.ok(blocker.maxY >= blocker.minY);
        const resolved = filmClearance.resolveCylinder(
          blocker.x,
          (blocker.minY + blocker.maxY) * 0.5,
          blocker.z,
          blocker.x,
          blocker.z,
          blocker.minY,
          blocker.maxY,
          blocker.radiusM,
          Number.NEGATIVE_INFINITY,
          Number.POSITIVE_INFINITY,
          filmResolution
        );
        assert.strictEqual(resolved, filmResolution);
        assert.equal(resolved.safe, true);
        assert.equal(resolved.fallbackRequired, false);
        assert.ok(
          resolved.clearanceM >= filmClearance.contract.minimumMarginM - EPSILON_M
        );
        visibleRouteBlockerKinds.add(blocker.kind);
        resolvedRouteBlockerCount++;
      }
      assert.equal(visual.diagnostics.ambientTrafficSeparationViolationCount, 0);
    }

    assert.ok(
      minimumTrafficSurfaceGapM >= trafficContract.spacing.minimumSurfaceGapM - EPSILON_M
    );
    assert.ok(resolvedRouteBlockerCount > 0);
    for (const requiredKind of [
      'wind-eroded-bridge-pier',
      'petal-bridge-capital-or-footing',
      'carved-bridge-crossbeam',
      'carved-tunnel-rib-portal-or-housing',
      'layered-bridge-detail',
      'bridge-rail-post',
      'physical-gore-nose',
      'wind-eroded-decision-pylon'
    ]) {
      assert.equal(visibleRouteBlockerKinds.has(requiredKind), true, requiredKind);
    }
  } finally {
    visual?.dispose();
  }
});

test('weather water/snow sheets stay millimetres above road and sealed snow banks keep a flat non-penetrating base', () => {
  const roadY = 12;
  const scene = new THREE.Scene();
  const state = {
    distance: 500,
    previousDistance: 500,
    lateral: 0,
    previousLateral: 0,
    lateralVelocity: 0,
    speed: 0,
    altitude: roadY,
    contactHeight: roadY,
    grounded: true,
    landingCount: 0,
    running: true,
    paused: false,
    gameOver: false,
    pathPlan: { id: 'fixed-weather-route', version: 1 },
    weather: { wetness: 1, snowCover: 1, dust: 0, motionTimeSeconds: 0 }
  };
  const sampleSignedFrame = (stationOffsetM, lateralM, out = {}) => Object.assign(out, {
    x: lateralM,
    y: roadY,
    surfaceHeight: roadY,
    z: -stationOffsetM,
    edgeId: 'fixed-weather-edge',
    edgeS: state.distance + stationOffsetM,
    roadHalf: 8.4,
    tangentX: 0,
    tangentY: 0,
    tangentZ: -1,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    upX: 0,
    upY: 1,
    upZ: 0,
    yaw: 0,
    covered: false,
    tunnelKind: null
  });
  const layer = surfaceWeather.create({
    THREE,
    scene,
    state,
    quality: Object.freeze({ id: 'mobile' }),
    sampleSignedFrame,
    getWorldRenderOrigin: (out = {}) => Object.assign(out, { x: 0, y: 0, z: 0 }),
    player: new THREE.Group(),
    sweptEllipseInterval: gameplayCore.sweptEllipseInterval,
    surfaceFootprint: ship.SURFACE_FOOTPRINT_CONTRACT,
    markEffect: (object) => object,
    getLightingState: () => ({ environmentIntensity: 1, sunIntensity: 1 })
  });
  layer.update({
    previousDistance: state.distance,
    currentDistance: state.distance,
    previousLateral: 0,
    currentLateral: 0,
    speedMps: 0,
    grounded: true,
    clearanceM: 0
  });
  state.weather.motionTimeSeconds = 60;
  layer.update({
    previousDistance: state.distance,
    currentDistance: state.distance,
    previousLateral: 0,
    currentLateral: 0,
    speedMps: 0,
    grounded: true,
    clearanceM: 0
  });

  const puddleContract = surfaceWeather.PUDDLE_OPTICS_CONTRACT;
  const snowContract = surfaceWeather.SNOW_ACCUMULATION_CONTRACT;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let puddleCount = 0;
  let snowSheetCount = 0;
  let snowBankCount = 0;
  for (let index = 0; index < layer.puddles.count; index++) {
    layer.puddles.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    if (Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) <= EPSILON_M) continue;
    const clearanceM = position.y - roadY;
    assert.ok(clearanceM >= puddleContract.minimumRoadClearanceM - EPSILON_M);
    assert.ok(
      clearanceM <= puddleContract.visualSurfaceLiftM
        + puddleContract.maximumNormalMotionM + EPSILON_M
    );
    puddleCount++;
  }
  for (let index = 0; index < layer.snowPatches.count; index++) {
    layer.snowPatches.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    if (Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) <= EPSILON_M) continue;
    const clearanceM = position.y - roadY;
    assert.ok(clearanceM >= snowContract.sheetMinimumRoadClearanceM - EPSILON_M);
    assert.ok(clearanceM <= snowContract.sheetVisualSurfaceLiftM + EPSILON_M);
    snowSheetCount++;
  }

  const bankGeometry = layer.snowBanks.geometry;
  bankGeometry.computeBoundingBox();
  assert.equal(bankGeometry.userData.neonV23.flatRoadBase, true);
  assert.ok(Math.abs(bankGeometry.boundingBox.min.z) <= EPSILON_M);
  assert.ok(Math.abs(bankGeometry.boundingBox.max.z - 1) <= EPSILON_M);
  const localBox = bankGeometry.boundingBox;
  const worldBox = new THREE.Box3();
  for (let index = 0; index < layer.snowBanks.count; index++) {
    layer.snowBanks.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    if (Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) <= EPSILON_M) continue;
    worldBox.copy(localBox).applyMatrix4(matrix);
    assert.ok(
      worldBox.min.y >= roadY + snowContract.bankVisualSurfaceLiftM - EPSILON_M
    );
    snowBankCount++;
  }
  assert.ok(puddleCount > 0 && snowSheetCount > 0 && snowBankCount > 0);

  const unexpectedTransparentObjects = [];
  layer.root.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some((material) => material?.transparent === true)) return;
    if (!TRANSPARENT_EFFECT_NAME_WHITELIST.has(object.name)) {
      unexpectedTransparentObjects.push(object.name || '(unnamed)');
    }
  });
  assert.deepEqual(unexpectedTransparentObjects, []);
});

test('all 18 creature families have zero non-attachment production-triangle crossings', () => {
  const factory = creatures.createFactory({
    THREE,
    modeling,
    qualityProfile: 'high',
    visualSeed: FIXED_VISUAL_SEED
  });
  try {
    factory.prewarm();
    const contract = creatures.CREATURE_VISUAL_CONTRACT.visibleIntersection;
    assert.equal(contract.maximumForbiddenTriangleCrossingsPerQuality, 0);
    let auditedQualityGeometryCount = 0;
    let forbiddenCrossingCount = 0;
    for (const root of factory.getTopologyRoots()) {
      for (const mesh of root.children[0].children) {
        const geometry = mesh.geometry;
        const components = geometry.userData.neonV23.componentRanges;
        const bounds = components.map((component) => componentBounds(geometry, component));
        const appendageBounds = new THREE.Box3().makeEmpty();
        for (let index = 0; index < components.length; index++) {
          if (components[index].kind === 'appendage') appendageBounds.union(bounds[index]);
        }
        for (let index = 0; index < components.length; index++) {
          const component = components[index];
          if (component.kind !== 'body' || component.memberIndex === 0) continue;
          const bodyBounds = bounds[index];
          const surfaceGapM = bodyBounds.min.x >= 0
            ? bodyBounds.min.x - appendageBounds.max.x
            : appendageBounds.min.x - bodyBounds.max.x;
          assert.ok(surfaceGapM >= contract.minimumClusterMemberSurfaceGapM - EPSILON_M);
        }
        for (let left = 0; left < components.length; left++) {
          for (let right = left + 1; right < components.length; right++) {
            if (rangesMayUseHiddenAttachmentSeam(components[left], components[right])) continue;
            if (!bounds[left].intersectsBox(bounds[right])) continue;
            if (hasForbiddenTriangleCrossing(geometry, components[left], components[right])) {
              forbiddenCrossingCount++;
            }
          }
        }
        auditedQualityGeometryCount++;
      }
    }
    assert.equal(auditedQualityGeometryCount, 18 * 3);
    assert.equal(forbiddenCrossingCount, 0);

    // Acquire once through the placement-proof API so topology roots cannot silently diverge from pooled gameplay roots.
    for (const definition of creatures.CREATURE_CATALOG) {
      const root = factory.acquire({
        realmId: definition.realmId,
        familyId: definition.id,
        placement: safeCreaturePlacement(definition),
        seed: `${FIXED_VISUAL_SEED}:${definition.id}`
      });
      assert.equal(root.userData.creatureFamilyId, definition.id);
      factory.release(root);
    }
  } finally {
    factory.dispose();
  }
});

test('Film blocker clearance is pure across its input matrix and aggregate converges without authority side effects', () => {
  const numerical = createCinematicSceneryClearanceFactory();
  assert.equal(numerical.contract.version, 1);
  assert.equal(numerical.contract.minimumMarginM, 0.35);
  assert.equal(numerical.contract.invariants.filmOnly, true);
  assert.equal(numerical.contract.invariants.cameraOnly, true);
  assert.equal(numerical.contract.invariants.frameAllocations, 0);

  const clearanceCases = Object.freeze([
    Object.freeze({
      label: 'horizontal-outside',
      input: Object.freeze([5, 1, 0, 0, 0, 0, 2, 1]),
      expectedM: 4
    }),
    Object.freeze({
      label: 'vertical-outside',
      input: Object.freeze([0, 4, 0, 0, 0, 0, 2, 1]),
      expectedM: 2
    }),
    Object.freeze({
      label: 'corner-outside',
      input: Object.freeze([4, 5, 0, 0, 0, 0, 2, 1]),
      expectedM: Math.hypot(3, 3)
    }),
    Object.freeze({
      label: 'inside-cylinder',
      input: Object.freeze([0, 1, 0, 0, 0, 0, 2, 1]),
      expectedM: -1
    })
  ]);
  const clearanceInputsBefore = clearanceCases.map(({ input }) => [...input]);
  for (const { label, input, expectedM } of clearanceCases) {
    assert.ok(
      Math.abs(numerical.clearanceM(...input) - expectedM) <= EPSILON_M,
      `${label} signed clearance drifted`
    );
  }
  assert.deepEqual(clearanceCases.map(({ input }) => [...input]), clearanceInputsBefore);

  const resolveCases = Object.freeze([
    Object.freeze({
      label: 'already-safe',
      input: Object.freeze([5, 1, 0, 0, 0, 0, 2, 1, 0, 10]),
      expected: Object.freeze({ safe: true, adjusted: false, fallbackRequired: false, y: 1 })
    }),
    Object.freeze({
      label: 'upward-preferred',
      input: Object.freeze([0, 1, 0, 0, 0, 0, 2, 1, 0, 10]),
      expected: Object.freeze({ safe: true, adjusted: true, fallbackRequired: false, y: 2.35 })
    }),
    Object.freeze({
      label: 'downward-when-ceiling-blocks',
      input: Object.freeze([0, 1, 0, 0, 0, 0, 2, 1, -1, 2.2]),
      expected: Object.freeze({ safe: true, adjusted: true, fallbackRequired: false, y: -0.35 })
    }),
    Object.freeze({
      label: 'fallback-when-floor-and-ceiling-block',
      input: Object.freeze([0, 1, 0, 0, 0, 0, 2, 1, 0, 2.2]),
      expected: Object.freeze({ safe: false, adjusted: false, fallbackRequired: true, y: 1 })
    }),
    Object.freeze({
      label: 'normalizes-inverted-vertical-envelope',
      input: Object.freeze([0, 1, 0, 0, 0, 2, 0, 1, 0, 10]),
      expected: Object.freeze({ safe: true, adjusted: true, fallbackRequired: false, y: 2.35 })
    })
  ]);
  const callerOwnedOut = {};
  const resolveInputsBefore = resolveCases.map(({ input }) => [...input]);
  for (const { label, input, expected } of resolveCases) {
    const resolved = numerical.resolveCylinder(...input, callerOwnedOut);
    assert.strictEqual(resolved, callerOwnedOut, `${label} replaced caller-owned output`);
    assert.equal(resolved.safe, expected.safe, `${label}.safe`);
    assert.equal(resolved.adjusted, expected.adjusted, `${label}.adjusted`);
    assert.equal(resolved.fallbackRequired, expected.fallbackRequired, `${label}.fallbackRequired`);
    assert.ok(Math.abs(resolved.resolvedY - expected.y) <= EPSILON_M, `${label}.resolvedY`);
  }
  assert.deepEqual(resolveCases.map(({ input }) => [...input]), resolveInputsBefore);

  const collections = Object.freeze({
    worldEntities: Object.freeze([Object.freeze({
      visible: true,
      x: 0,
      z: 0,
      cameraClearanceMinY: 0,
      cameraClearanceMaxY: 2,
      horizontalRadiusM: 1.4
    })]),
    obstacles: Object.freeze([Object.freeze({
      mesh: Object.freeze({ visible: true, position: Object.freeze({ x: 0, y: 2.6, z: 0 }) }),
      half: Object.freeze({ hx: 0.9, hy: 0.6, hz: 0.7 })
    })]),
    pickups: Object.freeze([Object.freeze({
      mesh: Object.freeze({ visible: true, position: Object.freeze({ x: 0, y: 3.6, z: 0 }) }),
      half: Object.freeze({ hx: 0.4, hy: 0.4, hz: 0.4 })
    })]),
    ambientTrafficMarkers: Object.freeze([Object.freeze({
      visible: true,
      separationSuppressed: false,
      x: 0,
      y: 4.5,
      z: 0,
      radiusM: 0.5
    })]),
    routeCameraBlockers: Object.freeze([Object.freeze({
      visible: true,
      x: 0,
      z: 0,
      minY: 4.8,
      maxY: 5.4,
      radiusM: 0.8
    })])
  });
  const aggregateApi = createCinematicSceneryClearanceFactory(collections);
  const aggregateOut = {};
  const authoritySentinel = Object.seal({
    routeRevision: 17,
    speedMps: 42,
    gear: 3,
    autopilot: false,
    lives: 2,
    score: 9_001
  });
  const authorityBefore = { ...authoritySentinel };
  const aggregate = aggregateApi.resolveAggregate(0, 1, 0, -1, 10, aggregateOut);
  assert.strictEqual(aggregate, aggregateOut);
  assert.equal(aggregate.safe, true);
  assert.equal(aggregate.adjusted, true);
  assert.equal(aggregate.fallbackRequired, false);
  assert.ok(Math.abs(aggregate.resolvedY - 5.75) <= EPSILON_M);
  assert.equal(aggregate.visibleBlockerCount, 5);
  assert.ok(aggregate.minimumClearanceM >= aggregateApi.contract.minimumMarginM - EPSILON_M);
  assert.deepEqual(authoritySentinel, authorityBefore);

  const aggregateAgain = aggregateApi.resolveAggregate(0, 1, 0, -1, 10, aggregateOut);
  assert.strictEqual(aggregateAgain, aggregateOut);
  assert.deepEqual(aggregateAgain, aggregate);

  const ceilingLimitedOut = {};
  const ceilingLimited = aggregateApi.resolveAggregate(0, 1, 0, 0, 2.2, ceilingLimitedOut);
  assert.equal(ceilingLimited.safe, false);
  assert.equal(ceilingLimited.fallbackRequired, true);
  assert.equal(ceilingLimited.sourceKind, 'world-scenery');
  assert.deepEqual(authoritySentinel, authorityBefore);
});
