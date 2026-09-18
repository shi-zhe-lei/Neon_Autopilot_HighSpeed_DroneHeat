#!/usr/bin/env node
/* Regression contract for the renderer-only DPR budget; gameplay dimensions and quality ownership stay outside this test. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = globalThis;
require(path.join(PROJECT_ROOT, 'src/config/Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js'));
require(path.join(PROJECT_ROOT, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'));

const {
  DEFAULT_QUALITY_PROFILES,
  createMaterial,
  resolveRendererPixelRatio
} = globalThis.NeonV23Modeling;

class FakeMaterial {
  constructor(parameters) {
    Object.assign(this, parameters);
    this.userData = {};
  }
}

class FakeBasicMaterial extends FakeMaterial {}

class FakeStandardMaterial extends FakeMaterial {
  constructor(parameters) {
    super(parameters);
    this.isMeshStandardMaterial = true;
  }
}

class FakePhysicalMaterial extends FakeStandardMaterial {
  constructor(parameters) {
    super(parameters);
    this.isMeshPhysicalMaterial = true;
  }
}

const fakeThree = Object.freeze({
  AdditiveBlending: 2,
  FrontSide: 0,
  MeshBasicMaterial: FakeBasicMaterial,
  MeshPhysicalMaterial: FakePhysicalMaterial,
  MeshStandardMaterial: FakeStandardMaterial
});

const mainSource = fs.readFileSync(
  path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
  'utf8'
);
const cloverleafSource = fs.readFileSync(
  path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js'),
  'utf8'
);
const lightingSource = fs.readFileSync(
  path.join(PROJECT_ROOT, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.lighting.js'),
  'utf8'
);
const track = globalThis.NeonV23Track;
const originalConsoleWarn = console.warn;
console.warn = () => {};
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
console.warn = originalConsoleWarn;

function extractFunctionDeclaration(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.ok(start >= 0, `Missing production function ${functionName}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated production function ${functionName}`);
}

function assertDeepFrozen(value, label = 'contract') {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  assert.equal(Object.isFrozen(value), true, `${label} is not frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${label}.${key}`);
}

function evaluateSkyTerrainArtContract() {
  const start = mainSource.indexOf('const SKY_TERRAIN_ART_CONTRACT = Object.freeze({');
  const end = mainSource.indexOf('\n\n  function terrainCellHash(', start);
  assert.ok(start >= 0 && end > start, 'Sky terrain art contract is missing');
  return new Function(`${mainSource.slice(start, end)}\nreturn SKY_TERRAIN_ART_CONTRACT;`)();
}

function evaluateTerrainRoadFeatureExclusionContract(artContract) {
  const start = mainSource.indexOf('const terrainRoadFeatureExclusionContract = Object.freeze({');
  const end = mainSource.indexOf('\n\n  function terrainCellHash(', start);
  assert.ok(start >= 0 && end > start, 'Terrain road-feature exclusion contract is missing');
  return new Function(
    'SKY_TERRAIN_ART_CONTRACT',
    `${mainSource.slice(start, end)}\nreturn terrainRoadFeatureExclusionContract;`
  )(artContract);
}

function evaluateSkyRouteSceneryContract() {
  const start = cloverleafSource.indexOf('const SKY_ROUTE_SCENERY_CONTRACT = Object.freeze({');
  const end = cloverleafSource.indexOf('\n\n  /*', start);
  assert.ok(start >= 0 && end > start, 'Sky route scenery contract is missing');
  return new Function(`${cloverleafSource.slice(start, end)}\nreturn SKY_ROUTE_SCENERY_CONTRACT;`)();
}

/** Execute the exact startup bridge-art block without booting DOM, gameplay, or renderer state. */
function evaluateRuntimeFallbackInterchangeArt() {
  const start = mainSource.indexOf('const runtimeSkyRouteSceneryContract =');
  const end = mainSource.indexOf('\n  const bridgePiers =', start);
  assert.ok(start >= 0 && end > start, 'Runtime fallback interchange art block is missing');
  const contract = evaluateSkyRouteSceneryContract();
  return new Function(
    'window',
    'THREE',
    'modeling',
    'bridgePierRadius',
    `${mainSource.slice(start, end)}\nreturn { bridgeSupportMat, bridgePierGeo, bridgeBeamGeo };`
  )(
    { NeonV23CloverleafVisuals: { skyRouteSceneryContract: contract } },
    THREE,
    globalThis.NeonV23Modeling,
    0.65
  );
}

/** Execute the exact production geometry builder with only its immutable build-time dependencies. */
function createTerrainGeometryAuditFactory(contract, qualityProfileId) {
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
    extractFunctionDeclaration(mainSource, name)
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
    contract,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    (start, end, amount) => start + (end - start) * amount,
    class NeonV23RenderingError extends Error {}
  );
}

/** Run the production cell-envelope transform and full-graph mask without constructing the browser runtime. */
function createTerrainRoadFeatureMaskAuditFactory(exclusionContract) {
  const envelopeSource = extractFunctionDeclaration(
    mainSource,
    'writeTerrainFeatureClusterWorldEnvelope'
  );
  const maskSource = extractFunctionDeclaration(mainSource, 'terrainRoadFeatureMaskForCell');
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
  )(track, exclusionContract, -1.20);
}

/** Independently weld the non-indexed feature suffix and require every triangle edge exactly twice. */
function inspectMergedFeatureTopology(geometry) {
  const position = geometry.getAttribute('position');
  const startVertex = geometry.userData.surfaceVertexCount;
  const edgeUses = new Map();
  const triangleUses = new Map();
  let nonFiniteComponentCount = 0;
  let degenerateTriangleCount = 0;
  let duplicatedTriangleCount = 0;
  const keyAt = (index) => [
    position.getX(index),
    position.getY(index),
    position.getZ(index)
  ].map((component) => {
    if (!Number.isFinite(component)) nonFiniteComponentCount++;
    return Number(component).toFixed(4);
  }).join(':');
  const recordEdge = (left, right) => {
    const key = left < right ? `${left}|${right}` : `${right}|${left}`;
    edgeUses.set(key, (edgeUses.get(key) || 0) + 1);
  };
  for (let index = startVertex; index < position.count; index += 3) {
    const a = keyAt(index);
    const b = keyAt(index + 1);
    const c = keyAt(index + 2);
    if (a === b || b === c || c === a) degenerateTriangleCount++;
    const triangleKey = [a, b, c].sort().join('|');
    const previousTriangleUseCount = triangleUses.get(triangleKey) || 0;
    if (previousTriangleUseCount > 0) duplicatedTriangleCount++;
    triangleUses.set(triangleKey, previousTriangleUseCount + 1);
    recordEdge(a, b);
    recordEdge(b, c);
    recordEdge(c, a);
  }
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const useCount of edgeUses.values()) {
    if (useCount === 1) boundaryEdgeCount++;
    else if (useCount !== 2) nonManifoldEdgeCount++;
  }
  return Object.freeze({
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    duplicatedTriangleCount,
    nonFiniteComponentCount
  });
}

test('launch construction profiles retain compatibility metadata while render tiers own live budgets', () => {
  assert.equal(globalThis.NeonV23Config.qualityProfiles.high.shadowMapSize, 4_096);
  assert.equal(globalThis.NeonV23Config.qualityProfiles.mobile.shadowMapSize, 2_048);
  assert.equal(DEFAULT_QUALITY_PROFILES.high.shadowMapSize, 4_096);
  assert.equal(DEFAULT_QUALITY_PROFILES.mobile.shadowMapSize, 2_048);
  const { renderQualityContract, renderQualityProfiles } = globalThis.NeonV23Config;
  assert.equal(Object.isFrozen(renderQualityContract), true);
  assert.equal(renderQualityContract.version, 3);
  assert.equal(renderQualityContract.defaultId, 'medium');
  assert.deepEqual(renderQualityContract.ids, ['low', 'medium', 'high']);
  assert.equal(renderQualityContract.changePolicy, 'launch-or-paused');
  assert.equal(renderQualityContract.invariants.presentationOnly, true);
  assert.equal(renderQualityContract.invariants.stableWorldGeometry, true);
  assert.equal(renderQualityContract.invariants.dynamicLocalFixtureLightsAreHighOnly, true);
  assert.deepEqual(
    renderQualityContract.ids.map((id) => renderQualityProfiles[id].pixelRatioCap),
    [1, 1.5, 3]
  );
  assert.deepEqual(
    renderQualityContract.ids.map((id) => renderQualityProfiles[id].maxRenderPixels),
    [1_300_000, 2_800_000, 24_000_000]
  );
  assert.deepEqual(
    renderQualityContract.ids.map((id) => renderQualityProfiles[id].primaryShadowMapSize),
    [1_024, 2_048, 8_192]
  );
  assert.deepEqual(
    renderQualityContract.ids.map((id) => renderQualityProfiles[id].secondaryDirectionalShadowMapSize),
    [1_024, 2_048, 4_096]
  );
  assert.deepEqual(
    renderQualityContract.ids.map((id) => renderQualityProfiles[id].localShadowMapSize),
    [512, 1_024, 4_096]
  );
  assert.equal(renderQualityProfiles.high.maximumAnisotropy, 'renderer-maximum');
  assert.equal(renderQualityProfiles.high.msaaSamples, 4);
  assert.equal(renderQualityProfiles.high.ambientOcclusion, 'depth-gtao-compatible');
  assert.equal(renderQualityProfiles.high.bloom, 'explicit-emissive-only');
  assert.equal(renderQualityProfiles.high.postProcessingEnabled, true);
  assert.equal(renderQualityProfiles.high.dynamicLocalFixtureLights, true);
  assert.equal(renderQualityProfiles.high.adaptiveDownscale, false);
  for (const id of ['low', 'medium']) {
    assert.equal(renderQualityProfiles[id].postProcessingEnabled, false);
    assert.equal(renderQualityProfiles[id].maximumAnisotropy, false);
    assert.equal(renderQualityProfiles[id].dynamicLocalFixtureLights, false);
  }
});

test('v5 continuous crossover fits its reserved structural batch in every entry orientation', () => {
  const capacityMatch = cloverleafSource.match(
    /const RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY = (\d[\d_]*)\s*;/
  );
  assert.ok(capacityMatch, 'The shared runtime route-structure capacity is missing');
  const structureCapacity = Number(capacityMatch[1].replaceAll('_', ''));
  assert.equal(structureCapacity, 768);

  const upperBounds = [];
  for (const entryPort of ['south', 'west', 'north', 'east']) {
    const sourcePlan = track.createPathPlan({
      entryPort,
      kind: 'straight',
      futureMovementKind: 'straight'
    });
    const destinationTile = sourcePlan.tiles.find((tile) => tile.index > 0);
    const opposingPlan = track.prepareOpposingRecoveryPathPlan(sourcePlan, destinationTile);
    const crossoverEdge = opposingPlan.edgeIds
      .map((edgeId) => track.getEdge(edgeId))
      .find((edge) => edge?.family === 'opposing-crossover');
    assert.ok(crossoverEdge, `${entryPort} omitted the v5 opposing crossover`);
    assert.equal(crossoverEdge.opposingCrossoverProfileLut.id, 'opposing-crossover-profile-v5-local-merge');
    assert.deepEqual(crossoverEdge.supportSpanContract, {
      kind: 'continuous-box-girder',
      supportSpacingM: 88,
      fasciaSegmentM: 24,
      fasciaWidthM: 0.34,
      fasciaDepthM: 0.72,
      diaphragmDepthM: 0.20
    });

    // Full-edge coverage is stricter than production's height-aware coverage. It budgets both fascia sides and
    // one diaphragm at every possible 88m support station, including the longest 3D orientation.
    const fullCoverageUpperBound = Math.ceil(
      crossoverEdge.length / crossoverEdge.supportSpanContract.fasciaSegmentM
    ) * 2 + Math.ceil(
      crossoverEdge.length / crossoverEdge.supportSpanContract.supportSpacingM
    );
    upperBounds.push(fullCoverageUpperBound);
    assert.ok(
      fullCoverageUpperBound <= structureCapacity,
      `${entryPort} needs ${fullCoverageUpperBound} route-structure instances`
    );
  }
  assert.deepEqual(upperBounds, [548, 548, 548, 548]);

  const allocationStart = cloverleafSource.indexOf(
    'const RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY = 768;'
  );
  const allocationEnd = cloverleafSource.indexOf('const ultraSupportMaterial =', allocationStart);
  const allocationSource = cloverleafSource.slice(allocationStart, allocationEnd);
  assert.equal(
    (allocationSource.match(/new THREE\.InstancedMesh\(/g) || []).length,
    1,
    'Continuous fascia allocated a second structural draw batch'
  );
  assert.match(
    allocationSource,
    /structuralDetailCapacity \+ railPostCapacity \+ RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY/
  );
  assert.equal((allocationSource.match(/group\.add\(structuralDetails\);/g) || []).length, 1);

  const composeStart = cloverleafSource.indexOf(
    'function composeRuntimeLongSpanStructureMatrices('
  );
  const composeEnd = cloverleafSource.indexOf('function installSupport(', composeStart);
  const composeSource = cloverleafSource.slice(composeStart, composeEnd);
  assert.match(composeSource, /contract\?\.kind !== 'continuous-box-girder'/);
  assert.doesNotMatch(composeSource, /new THREE\.(?:Mesh|InstancedMesh)\b/);
});

test('non-emitting material kinds prefer physical BRDF defaults', () => {
  for (const kind of ['surface', 'structure', 'organic', 'road']) {
    const material = createMaterial({ THREE: fakeThree, kind, color: 0x80_90a0 });
    assert.equal(material.isMeshPhysicalMaterial, true, `${kind} must use MeshPhysicalMaterial`);
    assert.ok(material.clearcoat > 0, `${kind} requires a clearcoat response`);
    assert.ok(material.sheen > 0, `${kind} requires a grazing-angle sheen response`);
    assert.ok(material.ior >= 1.3 && material.ior <= 1.6, `${kind} requires a dielectric IOR`);
    assert.equal(material.userData.neonV23.physical, true);
  }
  const glass = createMaterial({ THREE: fakeThree, kind: 'glass', color: 0xff_ffff });
  assert.equal(glass.transmission, 0.82);
  assert.equal(glass.ior, 1.45);
  assert.equal(glass.clearcoat, 1);
});

test('procedural variation modifies linear diffuse and roughness inputs before dithering', () => {
  const material = createMaterial({
    THREE: fakeThree,
    kind: 'surface',
    color: 0x80_90a0,
    procedural: true,
    seed: 'linear-brdf-test'
  });
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <dithering_fragment>',
      '}'
    ].join('\n')
  };
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb \*=/);
  assert.match(shader.fragmentShader, /roughnessFactor = clamp/);
  assert.doesNotMatch(shader.fragmentShader, /gl_FragColor\.rgb \*=/);
  assert.ok(
    shader.fragmentShader.indexOf('diffuseColor.rgb *=')
      < shader.fragmentShader.indexOf('#include <dithering_fragment>')
  );
  assert.match(material.customProgramCacheKey(), /procedural-linear-v2/);
});

test('renderer DPR gives PC Ultra 3x raster at Full HD and caps a 1440p backing buffer at 24M pixels', () => {
  const profile = { dpr: 3, pixelRatioCap: 3, maxRenderPixels: 24_000_000 };
  const fullHdRatio = resolveRendererPixelRatio({ width: 1_920, height: 1_080, ...profile });
  const ultra1440pRatio = resolveRendererPixelRatio({ width: 2_560, height: 1_440, ...profile });

  assert.equal(fullHdRatio, 3);
  assert.ok(ultra1440pRatio < 3 && ultra1440pRatio > 2.5);
  assert.ok((2_560 * 1_440 * ultra1440pRatio ** 2) <= profile.maxRenderPixels + 0.001);
});

test('renderer DPR honors device/profile caps and degrades safely for invalid optional budgets', () => {
  assert.equal(resolveRendererPixelRatio({
    width: 390,
    height: 844,
    dpr: 3,
    pixelRatioCap: 1.5,
    maxRenderPixels: 2_400_000
  }), 1.5);
  assert.equal(resolveRendererPixelRatio({
    width: 1_024,
    height: 768,
    dpr: 1,
    pixelRatioCap: 2,
    maxRenderPixels: 5_200_000
  }), 1);
  assert.equal(resolveRendererPixelRatio({
    width: 1_024,
    height: 768,
    dpr: 2,
    pixelRatioCap: 1.25,
    maxRenderPixels: 0
  }), 1.25);
});

test('WebGL creation retries the default Windows adapter without changing the rendering contract', () => {
  const rendererStart = mainSource.indexOf('const rendererCreationFailures = [];');
  const rendererEnd = mainSource.indexOf('/** Preserve driver diagnostics', rendererStart);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'renderer fallback block must be present');
  const rendererSource = mainSource.slice(rendererStart, rendererEnd);

  assert.match(rendererSource, /\['high-performance', 'default'\]/);
  assert.match(rendererSource, /antialias: true/);
  assert.match(rendererSource, /alpha: false/);
  assert.match(rendererSource, /powerPreference/);
  assert.match(rendererSource, /webgl-renderer-create-failed/);
  assert.match(rendererSource, /startup\.showError\(renderingError/);
  assert.match(rendererSource, /throw renderingError;/);
  assert.doesNotMatch(rendererSource, /activeRenderQuality|applyRenderQuality|state\.|setPixelRatio|setSize/);
});

test('large terrain layers receive physical shadows without entering any quality shadow-map pass', () => {
  const terrainStart = mainSource.indexOf('function createTerrainChunkLayer(');
  const terrainEnd = mainSource.indexOf('const terrainPureChunkLayers =', terrainStart);
  assert.ok(terrainStart >= 0 && terrainEnd > terrainStart, 'terrain layer factory must be present');
  const terrainFactory = mainSource.slice(terrainStart, terrainEnd);

  assert.match(terrainFactory, /layer\.castShadow = false;/);
  assert.match(terrainFactory, /layer\.receiveShadow = true;/);
  assert.match(
    terrainFactory,
    /layer\.userData\.shadowContract = 'large-opaque-receiver-only';/
  );
  assert.doesNotMatch(terrainFactory, /castShadow\s*=\s*(?:!mobile|quality|renderQuality)/);
});

test('Sky terrain art v2 builds six grouped sealed scenes and six sealed ecotones without runtime batches', () => {
  const contract = evaluateSkyTerrainArtContract();
  assertDeepFrozen(contract, 'SKY_TERRAIN_ART_CONTRACT');
  assert.equal(contract.version, 2);
  assert.deepEqual(contract.intent, {
    zhCN: '以成组自然遗迹塑造六境，在景物簇之间保留安静留白；精致、温柔、古老且不复制现成资产。',
    en: 'Shape six realms with grouped natural relics and quiet fields between clusters; refined, gentle, ancient, and original.'
  });
  assert.deepEqual(contract.composition, {
    rhythm: 'cluster-empty-cluster',
    clusterCount: 2,
    minimumEmptySpaceRatio: 0.60,
    authoredEmptySpaceRatio: 0.64,
    emptyCorridorHalfWidthM: 10,
    maximumClusterRadiusM: 14
  });
  assert.deepEqual(contract.geometry, {
    mergeMode: 'one-merged-buffer-per-biome-or-ecotone',
    featureTopology: 'sealed-finite-triangle-solids',
    surfaceAuthority: 'unchanged-heightfield-triangles',
    tunnelCutoutAuthority: 'unchanged-committed-underground-path-segments'
  });
  assert.deepEqual(contract.materials, {
    family: 'matte-natural-dielectric',
    maximumMetalness: 0,
    modernIndustrialAllowed: false,
    neonLanguageAllowed: false,
    emissiveCrackLanguageAllowed: false
  });
  assert.deepEqual(contract.invariants, {
    prebuiltInstancedMeshCount: 12,
    runtimeSceneryAllocationCount: 0,
    terrainHeightAuthority: 'unchanged-terrainHeightAt',
    roadAndCollisionAuthority: 'unchanged-track-and-runtime-physics',
    gameplayRngUse: false,
    poolCapacityAuthority: 'terrainResidencyContract.reservedCellCapacity'
  });

  const expectedScenes = Object.freeze({
    ocean: Object.freeze({
      sceneId: 'wide-water-ripples-sandbar-candle-star-etchings',
      zhCN: '宽缓水纹与沙洲烛星刻痕',
      en: 'wide gentle water ripples and candle-star etchings on sandbars',
      featureFamilies: ['water-ripple', 'sandbar', 'candle-star-etching']
    }),
    grassland: Object.freeze({
      sceneId: 'flower-hills-clustered-petals',
      zhCN: '花丘与成簇花瓣',
      en: 'flower hills and clustered petals',
      featureFamilies: ['flower-hill', 'petal-cluster']
    }),
    wetland: Object.freeze({
      sceneId: 'root-arches-shallow-basins-rain-curtain-reeds',
      zhCN: '根拱、浅水盆与雨帘芦苇',
      en: 'root arches, shallow basins, and rain-curtain reeds',
      featureFamilies: ['root-arch', 'shallow-basin', 'rain-curtain-reed']
    }),
    tundra: Object.freeze({
      sceneId: 'wind-swept-snow-ridges-ice-silk',
      zhCN: '风扫雪脊与冰丝',
      en: 'wind-swept snow ridges and ice silk',
      featureFamilies: ['snow-ridge', 'ice-silk']
    }),
    astral: Object.freeze({
      sceneId: 'memory-steps-constellation-stones',
      zhCN: '记忆台阶与星座石',
      en: 'memory steps and constellation stones',
      featureFamilies: ['memory-step', 'constellation-stone', 'constellation-thread']
    }),
    volcanic: Object.freeze({
      sceneId: 'wind-eroded-boulders-closed-ember-fissures',
      zhCN: '风蚀巨石与封闭余烬裂隙',
      en: 'wind-eroded boulders and closed ember fissures',
      featureFamilies: ['wind-eroded-boulder', 'closed-ember-fissure']
    })
  });
  assert.deepEqual(Object.keys(contract.patterns), Object.keys(expectedScenes));
  for (const [pattern, expected] of Object.entries(expectedScenes)) {
    assert.deepEqual(contract.patterns[pattern], expected, `${pattern} art intent drifted`);
  }

  const zones = globalThis.NeonV23Config.zones;
  assert.deepEqual(zones.map((zone) => zone.terrain.pattern), Object.keys(expectedScenes));
  for (const zone of zones) {
    assert.equal(zone.terrain.metalness, 0, `${zone.terrain.pattern} became metallic`);
  }

  const zeroTopology = Object.freeze({
    boundaryEdgeCount: 0,
    nonManifoldEdgeCount: 0,
    degenerateTriangleCount: 0,
    duplicatedTriangleCount: 0,
    nonFiniteComponentCount: 0
  });
  for (const qualityProfileId of ['high', 'mobile']) {
    const createGeometry = createTerrainGeometryAuditFactory(contract, qualityProfileId);
    for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
      const zone = zones[zoneIndex];
      const nextZone = zones[(zoneIndex + 1) % zones.length];
      for (const secondaryZone of [null, nextZone]) {
        const label = `${qualityProfileId}:${zone.terrain.pattern}:${secondaryZone ? 'ecotone' : 'pure'}`;
        const geometry = createGeometry(zone, zoneIndex, secondaryZone);
        const position = geometry.getAttribute('position');
        const color = geometry.getAttribute('color');
        const normal = geometry.getAttribute('normal');
        const featureCluster = geometry.getAttribute('neonV23TerrainFeatureCluster');
        const expectedSurfaceSegments = qualityProfileId === 'mobile' ? 10 : 16;
        assert.equal(geometry.index, null, `${label} must remain one merged non-indexed buffer`);
        assert.equal(position.count, color.count, `${label} color vertex count drifted`);
        assert.equal(position.count, normal.count, `${label} normal vertex count drifted`);
        assert.equal(position.count, featureCluster.count, `${label} feature-cluster count drifted`);
        assert.equal(
          geometry.userData.surfaceVertexCount,
          expectedSurfaceSegments * expectedSurfaceSegments * 6,
          `${label} did not use its production surface tessellation`
        );
        assert.equal(position.count % 3, 0, `${label} emitted an incomplete triangle`);
        assert.ok(
          position.count > geometry.userData.surfaceVertexCount,
          `${label} omitted its grouped scenery suffix`
        );
        for (const [attributeName, attribute] of Object.entries({ position, color, normal })) {
          for (const component of attribute.array) {
            assert.equal(Number.isFinite(component), true, `${label} has non-finite ${attributeName}`);
          }
        }
        assert.equal(geometry.userData.skyTerrainArtContractVersion, 2);
        assert.equal(geometry.userData.skyTerrainSceneId, expectedScenes[zone.terrain.pattern].sceneId);
        assert.deepEqual(
          geometry.userData.skyTerrainFeatureFamilies,
          expectedScenes[zone.terrain.pattern].featureFamilies
        );
        assert.equal(geometry.userData.skyTerrainClusterRhythm, 'cluster-empty-cluster');
        assert.equal(geometry.userData.skyTerrainClusterCount, 2);
        assert.ok(geometry.userData.skyTerrainMinimumEmptySpaceRatio >= 0.60);
        assert.equal(geometry.userData.skyTerrainAuthoredEmptySpaceRatio, 0.64);
        assert.equal(
          geometry.userData.featureCount,
          geometry.userData.skyTerrainScenePrimitiveCount
        );
        assert.ok(geometry.userData.skyTerrainScenePrimitiveCount >= 10, `${label} is under-authored`);
        assert.equal(geometry.userData.skyTerrainFeatureTopology, 'sealed-finite-triangle-solids');
        assert.equal(geometry.userData.skyTerrainUsesGameplayRng, false);
        assert.equal(geometry.userData.skyTerrainFeatureClusters.length, 2);
        assert.equal(Object.isFrozen(geometry.userData.skyTerrainFeatureClusters), true);
        for (const cluster of geometry.userData.skyTerrainFeatureClusters) {
          assert.equal(Object.isFrozen(cluster), true);
          assert.ok(cluster.vertexCount > 0, `${label} cluster ${cluster.clusterIndex} is empty`);
          assert.ok(
            cluster.maximumHorizontalRadiusM
              <= contract.composition.maximumClusterRadiusM + 0.000_001,
            `${label} cluster ${cluster.clusterIndex} escaped its road envelope`
          );
        }
        assert.deepEqual(inspectMergedFeatureTopology(geometry), zeroTopology, label);
        assert.deepEqual({
          boundaryEdgeCount: geometry.userData.skyTerrainFeatureBoundaryEdgeCount,
          nonManifoldEdgeCount: geometry.userData.skyTerrainFeatureNonManifoldEdgeCount,
          degenerateTriangleCount: geometry.userData.skyTerrainFeatureDegenerateTriangleCount,
          duplicatedTriangleCount: geometry.userData.skyTerrainFeatureDuplicatedTriangleCount,
          nonFiniteComponentCount: geometry.userData.skyTerrainNonFiniteComponentCount
        }, zeroTopology, `${label} production topology diagnostic drifted`);

        let minimumFeatureAbsoluteX = Infinity;
        for (let vertex = geometry.userData.surfaceVertexCount; vertex < position.count; vertex++) {
          minimumFeatureAbsoluteX = Math.min(minimumFeatureAbsoluteX, Math.abs(position.getX(vertex)));
          const clusterId = featureCluster.getX(vertex);
          assert.ok(clusterId === 1 || clusterId === 2, `${label} feature has no road-mask cluster`);
          const cluster = geometry.userData.skyTerrainFeatureClusters[clusterId - 1];
          assert.ok(
            Math.hypot(
              position.getX(vertex) - cluster.centerX,
              position.getZ(vertex) - cluster.centerZ
            ) <= cluster.maximumHorizontalRadiusM + 0.000_001,
            `${label} feature escaped its measured horizontal envelope`
          );
          assert.ok(
            position.getY(vertex) >= cluster.minimumY - 0.000_001
              && position.getY(vertex) <= cluster.maximumY + 0.000_001,
            `${label} feature escaped its measured vertical envelope`
          );
        }
        for (let vertex = 0; vertex < geometry.userData.surfaceVertexCount; vertex++) {
          assert.equal(featureCluster.getX(vertex), 0, `${label} road mask would remove terrain surface`);
        }
        assert.ok(
          minimumFeatureAbsoluteX >= contract.composition.emptyCorridorHalfWidthM,
          `${label} invaded the authored quiet corridor`
        );
        assert.equal(geometry.boundingBox.min.x, -48);
        assert.equal(geometry.boundingBox.max.x, 48);
        assert.equal(geometry.boundingBox.min.z, -48);
        assert.equal(geometry.boundingBox.max.z, 48);
        assert.equal(Number.isFinite(geometry.boundingSphere.radius), true);
        geometry.dispose();
      }
    }
  }

  const terrainFactoryStart = mainSource.indexOf('function createTerrainChunkLayer(');
  const terrainFactoryEnd = mainSource.indexOf('function terrainTunnelCutoutRadius(', terrainFactoryStart);
  const terrainFactorySource = mainSource.slice(terrainFactoryStart, terrainFactoryEnd);
  assert.equal((terrainFactorySource.match(/new THREE\.InstancedMesh\(/g) || []).length, 1);
  assert.match(terrainFactorySource, /const terrainPureChunkLayers = zones\.map/);
  assert.match(terrainFactorySource, /const terrainEcotoneChunkLayers = zones\.map/);
  assert.match(mainSource, /terrainChunkCapacity = terrainResidencyContract\.reservedCellCapacity/);
  assert.match(terrainFactorySource, /forbids metallic terrain materials/);

  const geometryBuilderSource = extractFunctionDeclaration(mainSource, 'createTerrainChunkGeometry');
  const terrainHeightSource = extractFunctionDeclaration(mainSource, 'terrainChunkHeightAt');
  assert.doesNotMatch(geometryBuilderSource, /Math\.random\s*\(/);
  assert.match(geometryBuilderSource, /terrainChunkHeightAt\(/);
  assert.doesNotMatch(terrainHeightSource, /SKY_TERRAIN_ART_CONTRACT/);
  const updateStart = mainSource.indexOf('function updateTerrainGeometryChunks(');
  const updateEnd = mainSource.indexOf('const roadMat =', updateStart);
  const updateSource = mainSource.slice(updateStart, updateEnd);
  assert.doesNotMatch(
    updateSource,
    /createTerrainChunkGeometry|new THREE\.(?:BufferGeometry|InstancedMesh|Mesh)|new Float32Array|Array\.from/
  );
  assert.match(mainSource, /skyTerrainArtRuntimeSceneryAllocationCount/);
  assert.match(mainSource, /skyTerrainArtTopologyViolationCount/);
  assert.match(mainSource, /skyTerrainArtGeometryDiagnostics/);
});

test('High16 and Mobile10 terrain feature clusters are masked by every graph road capsule in all rotations', () => {
  const artContract = evaluateSkyTerrainArtContract();
  const exclusionContract = evaluateTerrainRoadFeatureExclusionContract(artContract);
  assertDeepFrozen(exclusionContract, 'terrainRoadFeatureExclusionContract');
  assert.deepEqual(exclusionContract, {
    version: 1,
    mode: 'full-graph-road-capsule-per-feature-cluster',
    clusterCount: 2,
    minimumRoadGapM: 0.75,
    geometryQuantizationMarginM: 0.000_1,
    verticalMode: 'feature-envelope-versus-banked-road-slab',
    instanceAttribute: 'neonV23TerrainRoadFeatureMask',
    shaderDiscard: true,
    additionalDrawGroups: 0,
    runtimeOwnedAllocationCount: 0,
    visualOnly: true
  });

  const shaderStart = mainSource.indexOf('function installTerrainWorldShader(');
  const factoryStart = mainSource.indexOf('function createTerrainChunkLayer(', shaderStart);
  const shaderSource = mainSource.slice(shaderStart, factoryStart);
  assert.match(shaderSource, /attribute float neonV23TerrainFeatureCluster;/);
  assert.match(shaderSource, /attribute vec2 neonV23TerrainRoadFeatureMask;/);
  assert.match(shaderSource, /vNeonV23TerrainRoadFeatureVisible < 0\.5\) discard;/);
  assert.match(shaderSource, /uNeonV23TerrainTunnelCutoutCount/);
  const maskSource = extractFunctionDeclaration(mainSource, 'terrainRoadFeatureMaskForCell');
  assert.match(maskSource, /track\.queryRoadClearance\(/);
  assert.match(maskSource, /terrainRoadFeatureClearanceOptionsScratch/);
  assert.doesNotMatch(maskSource, /emptyCorridorHalfWidthM|Math\.abs\([^)]*x[^)]*\)\s*[<>]=?\s*10/);
  assert.match(
    String(track.queryRoadClearance),
    /const candidateEdges = \[\.\.\.graphEdges, \.\.\.runtimeEdgesById\.values\(\)\];/,
    'terrain mask authority no longer covers immutable and runtime roads together'
  );
  const updateSource = extractFunctionDeclaration(mainSource, 'updateTerrainGeometryChunks');
  assert.match(updateSource, /terrainPreviousCellRoadFeatureMask/);
  assert.match(updateSource, /terrainRoadNetworkUnchanged/);
  assert.doesNotMatch(
    updateSource,
    /new THREE\.(?:BufferGeometry|InstancedBufferAttribute|InstancedMesh)|new Float32Array|Array\.from/
  );

  // Register repeated runtime tiles before auditing; queryRoadClearance then owns mainline, forks, recovery roads,
  // opposing crossover aliases, direct/loop ramps, bridges, and underground surfaces in one immutable API.
  track.createPathPlan({ entryPort: 'south', kind: 'straight', futureMovementKind: 'left' });
  const audit = createTerrainRoadFeatureMaskAuditFactory(exclusionContract);
  const zones = globalThis.NeonV23Config.zones;
  let intersectingEnvelopeCount = 0;
  let auditedEnvelopeCount = 0;
  for (const qualityProfileId of ['high', 'mobile']) {
    const createGeometry = createTerrainGeometryAuditFactory(artContract, qualityProfileId);
    for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
      for (const secondaryZone of [null, zones[(zoneIndex + 1) % zones.length]]) {
        const geometry = createGeometry(zones[zoneIndex], zoneIndex, secondaryZone);
        const layer = { geometry };
        for (let rotationQuarter = 0; rotationQuarter < 4; rotationQuarter++) {
          for (const reliefScale of [0.88, 1.12]) {
            const mask = audit.maskForCell(layer, 0, 11 * 96, rotationQuarter, reliefScale);
            assert.ok(mask >= 0 && mask <= 3, 'road feature mask escaped its two-bit range');
            for (const cluster of geometry.userData.skyTerrainFeatureClusters) {
              const center = { x: 0, z: 0 };
              const verticalEnvelope = { minY: 0, maxY: 0 };
              audit.writeEnvelope(
                cluster,
                0,
                11 * 96,
                rotationQuarter,
                reliefScale,
                center,
                verticalEnvelope
              );
              const clearance = track.queryRoadClearance(
                center,
                cluster.maximumHorizontalRadiusM,
                {
                  minimumGap: exclusionContract.minimumRoadGapM,
                  verticalEnvelope
                }
              );
              auditedEnvelopeCount++;
              if (!clearance.intersects) continue;
              intersectingEnvelopeCount++;
              assert.equal(
                mask & (1 << cluster.clusterIndex),
                0,
                `${qualityProfileId}:${zoneIndex}:${secondaryZone ? 'ecotone' : 'pure'}:`
                  + `q${rotationQuarter} left a road-intersecting cluster visible`
              );
            }
          }
        }
        geometry.dispose();
      }
    }
  }
  assert.equal(auditedEnvelopeCount, 2 * 6 * 2 * 4 * 2 * 2);
  assert.ok(intersectingEnvelopeCount > 0, 'production south road regression fixture found no overlap');
  assert.equal(audit.getQueryCount(), auditedEnvelopeCount);
  assert.match(mainSource, /terrainRoadFeatureRuntimeOwnedAllocationCount:/);
  assert.match(mainSource, /terrainRoadFeatureAdditionalDrawGroups:/);
});

test('world ground scenery receives the exact rotated production terrain-height authority', () => {
  const samplerSource = extractFunctionDeclaration(mainSource, 'sampleTerrainWorldHeight');
  assert.match(samplerSource, /terrainLocalPointForWorldCell\(/);
  assert.match(samplerSource, /sampleTerrainChunkTriangulatedHeight\(/);
  assert.match(samplerSource, /const reliefScale = 0\.88/);
  const decorationStart = mainSource.indexOf(
    'const decorationLayer = window.NeonV23World.createDecorationLayer({'
  );
  const decorationEnd = mainSource.indexOf('\n  });', decorationStart);
  assert.ok(decorationStart >= 0 && decorationEnd > decorationStart);
  const decorationSource = mainSource.slice(decorationStart, decorationEnd);
  assert.match(decorationSource, /sampleTerrainHeight: sampleTerrainWorldHeight/);
  assert.ok(
    decorationSource.indexOf('sampleTerrainHeight: sampleTerrainWorldHeight')
      < decorationSource.indexOf('maximumDeckHeight:'),
    'terrain-height authority must be committed with the world construction options'
  );
});

test('High terrain detail restores absolute world coordinates after floating-origin rebasing', () => {
  const shaderStart = mainSource.indexOf('function installTerrainWorldShader(');
  const terrainStart = mainSource.indexOf('function createTerrainChunkLayer(');
  const terrainEnd = mainSource.indexOf('const terrainPureChunkLayers =', terrainStart);
  const updateStart = mainSource.indexOf('function updateTerrainGeometryChunks(');
  const updateEnd = mainSource.indexOf('const roadMat =', updateStart);
  assert.ok(shaderStart >= 0 && terrainStart > shaderStart, 'terrain shader installer must be present');
  assert.ok(terrainStart >= 0 && terrainEnd > terrainStart, 'terrain layer factory must be present');
  assert.ok(updateStart >= 0 && updateEnd > updateStart, 'terrain floating-origin update must be present');
  const terrainFactory = mainSource.slice(terrainStart, terrainEnd);
  const terrainShader = mainSource.slice(shaderStart, terrainStart);
  const terrainUpdate = mainSource.slice(updateStart, updateEnd);

  assert.match(
    mainSource,
    /const terrainProceduralWorldOriginUniform = \{ value: new THREE\.Vector2\(\) \};/
  );
  assert.match(
    terrainShader,
    /shader\.uniforms\.uNeonV23TerrainWorldOrigin = terrainProceduralWorldOriginUniform;/
  );
  assert.match(terrainShader, /uniform vec2 uNeonV23TerrainWorldOrigin;/);
  assert.match(
    terrainShader,
    /neonV23TerrainRenderPosition\.x \+ uNeonV23TerrainWorldOrigin\.x/
  );
  assert.match(
    terrainShader,
    /neonV23TerrainRenderPosition\.z \+ uNeonV23TerrainWorldOrigin\.y/
  );
  assert.doesNotMatch(
    terrainShader,
    /vNeonV23TerrainWorldPosition = \(modelMatrix \* neonV23TerrainInstancePosition\)\.xyz;/
  );
  assert.match(terrainFactory, /installTerrainWorldShader\(material, zoneIndex, secondaryTerrain, false\);/);
  assert.match(terrainFactory, /installTerrainWorldShader\(ultraMaterial, zoneIndex, secondaryTerrain, true\);/);
  assert.match(terrainUpdate, /proceduralOrigin\.set\(renderOriginX, renderOriginZ\);/);
  assert.match(mainSource, /mode: 'render-camera-frustum-ground-footprint'/);
  assert.match(
    mainSource,
    /supportedMaximumAspect: qualityProfile\.id === 'mobile' \? 2\.4 : 32 \/ 9/
  );
  assert.match(mainSource, /supportedMaximumFovDegrees: 84/);
  assert.match(mainSource, /unloadHysteresisCells: 2/);
  assert.match(
    mainSource,
    /reservedCellCapacity: qualityProfile\.id === 'mobile' \? 1_280 : 2_048/
  );
  assert.match(mainSource, /const terrainChunkCapacity = terrainResidencyContract\.reservedCellCapacity;/);
  assert.match(mainSource, /const terrainSelectedCellX = new Int32Array\(terrainChunkCapacity\);/);
  assert.match(mainSource, /const terrainSelectedCellZ = new Int32Array\(terrainChunkCapacity\);/);
  assert.match(mainSource, /terrainResidencySelectionAllocationCount: 0/);
  assert.match(
    terrainUpdate,
    /const worldCenterX = renderOriginX \+ \(Number\(camera\.position\.x\) \|\| 0\);/
  );
  assert.match(
    terrainUpdate,
    /const centerCellX = Math\.floor\(\(worldCenterX \+ terrainChunkHalfSize\) \/ terrainChunkSize\);/
  );
  assert.match(mainSource, /terrainResidencyMode: terrainResidencyContract\.mode/);
  assert.match(mainSource, /terrainResidencyCameraCentered: true/);
  assert.match(mainSource, /terrainResidencyCameraAnchored: true/);
  assert.match(mainSource, /terrainResidencyOverflowPolicy: terrainResidencyContract\.overflowPolicy/);
  assert.match(mainSource, /terrainResidencyCoverageComplete: terrainResidencyCoverageFailureCount === 0/);
  const zoneUpdate = mainSource.slice(
    mainSource.indexOf('function updateZone(now)'),
    mainSource.indexOf('const physicalLightingAnchor', mainSource.indexOf('function updateZone(now)'))
  );
  assert.doesNotMatch(zoneUpdate, /updateTerrainGeometryChunks\(/);
  const animateLoop = mainSource.slice(
    mainSource.indexOf('function animate()'),
    mainSource.indexOf("startBtn.addEventListener('click'")
  );
  const cameraAt = animateLoop.indexOf('updateCamera(simulationFrameDt)');
  const terrainAt = animateLoop.indexOf(
    'updateTerrainGeometryChunks(terrainCurrentZoneIndex, terrainNextZoneIndex)'
  );
  const trackAt = animateLoop.indexOf('updateTrackNetworkVisuals(now)');
  assert.ok(cameraAt >= 0 && cameraAt < terrainAt && terrainAt < trackAt);
  assert.match(mainSource, /terrainProceduralCoordinateMode: 'absolute-world-xz'/);
  assert.match(mainSource, /terrainProceduralCameraLocked: false/);
});

test('base and High terrain clip only the committed underground tunnel corridor', () => {
  const contractStart = mainSource.indexOf('const terrainTunnelCutoutContract = Object.freeze({');
  const shaderStart = mainSource.indexOf('function installTerrainWorldShader(', contractStart);
  const factoryStart = mainSource.indexOf('function createTerrainChunkLayer(', shaderStart);
  const cutoutUpdateStart = mainSource.indexOf('function updateTerrainTunnelCutouts()', factoryStart);
  const cutoutUpdateEnd = mainSource.indexOf(
    '/** Swap the already-built terrain material only;',
    cutoutUpdateStart
  );
  assert.ok(contractStart >= 0 && shaderStart > contractStart, 'terrain cutout contract must be present');
  assert.ok(factoryStart > shaderStart, 'terrain shader installer must precede the layer factory');
  assert.ok(cutoutUpdateStart > factoryStart && cutoutUpdateEnd > cutoutUpdateStart);

  const contractSource = mainSource.slice(contractStart, shaderStart);
  const shaderSource = mainSource.slice(shaderStart, factoryStart);
  const factorySource = mainSource.slice(factoryStart, cutoutUpdateStart);
  const cutoutUpdateSource = mainSource.slice(cutoutUpdateStart, cutoutUpdateEnd);

  assert.match(contractSource, /version: 2/);
  assert.match(contractSource, /mode: 'committed-underground-path-segments'/);
  assert.match(contractSource, /maximumSegments: 16/);
  assert.match(contractSource, /sampleSpacingM: 12/);
  assert.match(contractSource, /lookBehindM: 36/);
  assert.match(contractSource, /lookAheadM: 156/);
  assert.match(contractSource, /wallOverlapM: 0\.18/);
  assert.doesNotMatch(contractSource, /minimumRadiusM/);
  assert.match(contractSource, /additionalDrawGroups: 0/);
  assert.match(contractSource, /visualOnly: true/);
  assert.match(
    shaderSource,
    /shader\.uniforms\.uNeonV23TerrainTunnelCutoutCount = terrainTunnelCutoutCountUniform;/
  );
  assert.match(
    shaderSource,
    /uniform vec4 uNeonV23TerrainTunnelCutoutStart\[\$\{terrainTunnelCutoutContract\.maximumSegments\}\];/
  );
  assert.match(
    shaderSource,
    /shader\.uniforms\.uNeonV23TerrainTunnelCutoutEnd = terrainTunnelCutoutEndUniform;/
  );
  assert.match(shaderSource, /\.replace\('#include <clipping_planes_fragment>'/);
  assert.match(
    shaderSource,
    /neonV23TunnelSegment < \$\{terrainTunnelCutoutContract\.maximumSegments\}/
  );
  assert.match(
    shaderSource,
    /neonV23TunnelSegment >= uNeonV23TerrainTunnelCutoutCount\) break;/
  );
  assert.match(
    shaderSource,
    /vNeonV23TerrainWorldPosition\.xz - neonV23TunnelStart\.xy/
  );
  assert.match(shaderSource, /float neonV23TunnelRadius = mix\(/);
  assert.match(shaderSource, /neonV23TunnelRadius > 0\.001[\s\S]*?\) discard;/);
  assert.match(factorySource, /installTerrainWorldShader\(material, zoneIndex, secondaryTerrain, false\);/);
  assert.match(factorySource, /installTerrainWorldShader\(ultraMaterial, zoneIndex, secondaryTerrain, true\);/);
  assert.match(
    factorySource,
    /if \(frame\?\.tunnelKind !== 'underground-tunnel'\) return 0;/
  );
  assert.match(
    factorySource,
    /track\.graph\?\.contract\?\.undergroundTunnelWallThickness/
  );
  assert.match(
    factorySource,
    /roadHalf \+ wallInset - wallThickness \* 0\.5[\s\S]*?\+ terrainTunnelCutoutContract\.wallOverlapM/
  );
  assert.match(cutoutUpdateSource, /sampleSurfaceWeatherFrame\(/);
  assert.doesNotMatch(cutoutUpdateSource, /samplePlannedFrame|navigationPathPlan/);
  assert.doesNotMatch(cutoutUpdateSource, /\bnew\s+|Array\.from/);
  assert.match(cutoutUpdateSource, /terrainTunnelCutoutRadius\(startFrame\)/);
  assert.match(cutoutUpdateSource, /terrainTunnelCutoutRadius\(endFrame\)/);
  assert.match(cutoutUpdateSource, /Number\(startFrame\.absoluteX\)/);
  assert.match(cutoutUpdateSource, /Number\(startFrame\.absoluteZ\)/);
  assert.match(cutoutUpdateSource, /Number\(endFrame\.absoluteX\)/);
  assert.match(cutoutUpdateSource, /Number\(endFrame\.absoluteZ\)/);
  assert.match(
    mainSource,
    /updateCamera\(simulationFrameDt\);[\s\S]{0,520}?updateTerrainGeometryChunks\(terrainCurrentZoneIndex, terrainNextZoneIndex\);\s*updateTrackNetworkVisuals\(now\);[\s\S]{0,240}?updateTerrainTunnelCutouts\(\);\s*updatePhysicalLighting\(state\.running && !state\.paused && !state\.gameOver \? simulationFrameDt : 0\);/
  );
  assert.match(
    mainSource,
    /updateCamera\(0\);\s*updateTerrainGeometryChunks\(terrainCurrentZoneIndex, terrainNextZoneIndex\);\s*updateTrackNetworkVisuals\(now\);[\s\S]{0,240}?updateTerrainTunnelCutouts\(\);\s*updatePhysicalLighting\(\);/
  );
  for (const marker of [
    'terrainTunnelCutoutContractVersion: terrainTunnelCutoutContract.version',
    'terrainTunnelCutoutMode: terrainTunnelCutoutContract.mode',
    'terrainTunnelCutoutActive',
    'terrainTunnelCutoutSegmentCount: terrainTunnelCutoutCount',
    'terrainTunnelCutoutMaximumSegments: terrainTunnelCutoutContract.maximumSegments',
    'terrainTunnelCutoutSampleSpacingM: terrainTunnelCutoutContract.sampleSpacingM',
    'terrainTunnelCutoutLookBehindM: terrainTunnelCutoutContract.lookBehindM',
    'terrainTunnelCutoutLookAheadM: terrainTunnelCutoutContract.lookAheadM',
    'terrainTunnelCutoutMaximumRadiusM:',
    'terrainTunnelCutoutAdditionalDrawGroups: terrainTunnelCutoutContract.additionalDrawGroups',
    'terrainTunnelCutoutVisualOnly: terrainTunnelCutoutContract.visualOnly'
  ]) {
    assert.ok(mainSource.includes(marker), `missing terrain cutout diagnostic ${marker}`);
  }
});

test('runtime fallback interchange uses sealed Sky-route v2 stone without changing its fixed capacities', () => {
  const contract = evaluateSkyRouteSceneryContract();
  const { bridgeSupportMat, bridgePierGeo, bridgeBeamGeo } = evaluateRuntimeFallbackInterchangeArt();
  assert.equal(contract.version, 2);
  assert.equal(bridgeSupportMat.userData.neonV23SkyRouteScenery.contractVersion, 2);
  assert.equal(bridgeSupportMat.metalness, 0.01);
  assert.equal(bridgeSupportMat.roughness, 0.94);
  assert.equal(bridgeSupportMat.clearcoat, 0.02);
  assert.equal(bridgeSupportMat.emissive.getHex(), 0x00_0000);
  assert.equal(bridgeSupportMat.emissiveIntensity, 0);
  assert.ok(bridgeSupportMat.metalness <= contract.materials.maximumMetalness);
  assert.ok(bridgeSupportMat.roughness >= contract.materials.minimumRoughness);
  assert.ok(bridgeSupportMat.clearcoat <= contract.materials.maximumClearcoat);
  assert.deepEqual(
    bridgePierGeo.userData.neonV23SkyRouteScenery,
    {
      contractVersion: 2,
      role: 'wind-eroded-fallback-bridge-pier',
      topology: contract.geometry.pier.topology,
      profileRingCount: 16,
      radialSegments: 32
    }
  );
  assert.equal(bridgeBeamGeo.userData.neonV23SkyRouteScenery.outlinePointCount, 16);
  assert.equal(bridgeBeamGeo.userData.neonV23SkyRouteScenery.axialRingCount, 6);
  for (const [label, geometry] of [
    ['pier', bridgePierGeo],
    ['beam', bridgeBeamGeo]
  ]) {
    const topology = globalThis.NeonV23Modeling.analyzeTopology(geometry);
    assert.equal(topology.isClosed, true, `${label} must be sealed`);
    assert.equal(topology.boundaryEdges, 0, `${label} must have zero boundary edges`);
    assert.equal(topology.nonManifoldEdges, 0, `${label} must have zero non-manifold edges`);
  }
  bridgePierGeo.computeBoundingBox();
  bridgeBeamGeo.computeBoundingBox();
  assert.ok(bridgePierGeo.boundingBox.min.y >= -0.5 - 0.000_001);
  assert.ok(bridgePierGeo.boundingBox.max.y <= 0.5 + 0.000_001);
  assert.ok(bridgeBeamGeo.boundingBox.min.x >= -0.5 - 0.000_001);
  assert.ok(bridgeBeamGeo.boundingBox.max.x <= 0.5 + 0.000_001);
  assert.ok(bridgeBeamGeo.boundingBox.min.y >= -0.38 - 0.000_001);
  assert.ok(bridgeBeamGeo.boundingBox.max.y <= 0.38 + 0.000_001);
  assert.match(mainSource, /new THREE\.InstancedMesh\(bridgePierGeo, bridgeSupportMat, 4\)/);
  assert.match(mainSource, /new THREE\.InstancedMesh\(bridgeBeamGeo, bridgeSupportMat, 2\)/);
  assert.doesNotMatch(mainSource, /bridgeSupportMat\.emissive\.copy\(/);
  bridgePierGeo.dispose();
  bridgeBeamGeo.dispose();
  bridgeSupportMat.dispose();
});

test('runtime-owned fallback bridge and contact shadows dispose by identity exactly once', () => {
  const functionSource = extractFunctionDeclaration(mainSource, 'disposeRuntimeOwnedSceneResources');
  const counter = () => ({ count: 0, dispose() { this.count++; } });
  const sharedBridgeMaterial = counter();
  const sourceShadowMaterial = counter();
  const bridgePierGeometry = counter();
  const bridgeBeamGeometry = counter();
  const sharedShadowGeometry = counter();
  const activeShadowMaterial = counter();
  const pooledShadowMaterial = counter();
  const bridgePiers = { count: 4 };
  const bridgeBeams = { count: 2 };
  const activeShadow = {
    geometry: sharedShadowGeometry,
    material: activeShadowMaterial,
    visible: true
  };
  const pooledShadow = {
    geometry: sharedShadowGeometry,
    material: pooledShadowMaterial,
    visible: false
  };
  const obstacles = [{ shadow: activeShadow }];
  const obstacleShadowPool = [pooledShadow, pooledShadow];
  const removed = [];
  const dispose = new Function(
    'scene',
    'bridgePiers',
    'bridgeBeams',
    'bridgePierGeo',
    'bridgeBeamGeo',
    'bridgeSupportMat',
    'obstacleShadowGeo',
    'obstacleShadowMat',
    'obstacles',
    'obstacleShadowPool',
    `let runtimeOwnedSceneResourcesDisposed = false;\n${functionSource}\nreturn disposeRuntimeOwnedSceneResources;`
  )(
    { remove: (...objects) => removed.push(...objects) },
    bridgePiers,
    bridgeBeams,
    bridgePierGeometry,
    bridgeBeamGeometry,
    sharedBridgeMaterial,
    sharedShadowGeometry,
    sourceShadowMaterial,
    obstacles,
    obstacleShadowPool
  );
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.equal(bridgePiers.count, 0);
  assert.equal(bridgeBeams.count, 0);
  assert.equal(obstacles[0].shadow, null);
  assert.equal(obstacleShadowPool.length, 0);
  for (const resource of [
    sharedBridgeMaterial,
    sourceShadowMaterial,
    bridgePierGeometry,
    bridgeBeamGeometry,
    sharedShadowGeometry,
    activeShadowMaterial,
    pooledShadowMaterial
  ]) assert.equal(resource.count, 1);
  assert.ok(removed.includes(bridgePiers));
  assert.ok(removed.includes(bridgeBeams));
  assert.ok(removed.includes(activeShadow));
  assert.ok(removed.includes(pooledShadow));
  const disposer = mainSource.slice(
    mainSource.indexOf('function disposePresentationResources()'),
    mainSource.indexOf("window.addEventListener('pagehide'")
  );
  assert.match(disposer, /disposeRuntimeOwnedSceneResources\(\);/);
  const legacyMaterialSection = mainSource.slice(
    mainSource.indexOf('const zonePaletteColor ='),
    mainSource.indexOf('function obstacleLateralLimit(')
  );
  assert.doesNotMatch(legacyMaterialSection, /const (?:obstacleMats|trafficAccentMats|pickupMats)\s*=/);
  assert.match(legacyMaterialSection, /function createLegacyObstacleMaterial\(/);
  assert.match(legacyMaterialSection, /function createLegacyPickupMaterial\(/);
});

test('continuous tunnel receivers and smooth Film detail stay inside existing mesh, draw, and six-spot budgets', () => {
  assert.match(cloverleafSource, /const staticTunnelIrradiance = \[\];/);
  assert.match(
    cloverleafSource,
    /tunnelShellGeometry[\s\S]*?STATIC_TUNNEL_IRRADIANCE_CONTRACT\.attribute/
  );
  assert.match(cloverleafSource, /new THREE\.InstancedBufferAttribute\(/);
  assert.match(cloverleafSource, /beamGeometry\.setAttribute\(/);
  assert.match(cloverleafSource, /staticTunnelIrradianceAdditionalDrawGroupCount:[\s\S]*?0/);
  assert.match(cloverleafSource, /staticTunnelIrradianceAdditionalObjectCount:[\s\S]*?0/);
  assert.doesNotMatch(cloverleafSource, /new THREE\.SpotLight/);
  assert.match(lightingSource, /tunnelSpotCount: 6/);
  assert.match(lightingSource, /tunnelShadowSpotCount: 2/);
  assert.match(lightingSource, /tunnelDynamicDetailFadeM: 24/);
  assert.match(lightingSource, /tunnelSpotHandoffReferenceRate: 0\.34/);
  assert.match(lightingSource, /tunnelSpotHandoffReferenceHz: 60/);
  assert.match(mainSource, /function updatePhysicalLighting\(dtSeconds = 0\)/);
  assert.match(mainSource, /physicalLightingRig\.update\(\{[\s\S]*?dtSeconds,/);
  assert.match(
    mainSource,
    /updatePhysicalLighting\(state\.running && !state\.paused && !state\.gameOver \? simulationFrameDt : 0\)/
  );
  assert.match(lightingSource, /fixtureSelectionMode === 'camera-visual'/);
  assert.match(mainSource, /fixtureSelectionMode: state\.cameraCinematicActive \? 'camera-visual'/);
  assert.match(mainSource, /const disabledDynamicLocalFixtureEmitters = Object\.freeze\(\[\]\);/);
  assert.match(
    mainSource,
    /const fixtureEmitters = dynamicLocalFixtureLightsProfileEnabled\s*\? \(cloverleafVisuals\?\.getActiveCoveredRouteLightEmitters\?\.\(\)/
  );
  assert.match(mainSource, /: disabledDynamicLocalFixtureEmitters;/);
});
