#!/usr/bin/env node
/* Deterministic regression contract for resumable cloverleaf support-placement searches. */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const cloverleafPath = path.join(
  PROJECT_ROOT,
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js'
);
const trackPath = path.join(
  PROJECT_ROOT,
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'
);
global.window = globalThis;
const originalConsoleWarn = console.warn;
console.warn = () => {};
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
console.warn = originalConsoleWarn;
globalThis.THREE = THREE;
require(path.join(
  PROJECT_ROOT,
  'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js'
));
require(trackPath);
require(path.join(
  PROJECT_ROOT,
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js'
));
require(cloverleafPath);

const cloverleafVisuals = globalThis.NeonV23CloverleafVisuals;
const cloverleafTilePool = globalThis.NeonV23CloverleafTilePool;
const productionTrack = globalThis.NeonV23Track;
const modeling = globalThis.NeonV23Modeling;
const source = readFileSync(require.resolve(cloverleafPath), 'utf8');
const SUPPORT_FOOTING_WIDTH = 2.2;
const SUPPORT_FOOTING_DEPTH = 1.05;
const SUPPORT_FOOTING_CLEARANCE_RADIUS = Math.hypot(
  SUPPORT_FOOTING_WIDTH * 0.5,
  SUPPORT_FOOTING_DEPTH * 0.5
);

/** Supply only the raster methods used by the exit-sign atlas; support audits never need a browser renderer. */
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
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
            font: '',
            textAlign: '',
            textBaseline: '',
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            fill() {},
            stroke() {},
            fillRect() {},
            strokeRect() {},
            fillText() {}
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

/** Build the production cloverleaf visual through its resumable public job for material and emitter audits. */
function buildProductionVisual(options = {}) {
  const scene = new THREE.Scene();
  const visualTrack = options.track || productionTrack;
  const buildJob = cloverleafVisuals.createBuildJob({
    THREE,
    track: visualTrack,
    modeling,
    scene,
    qualityProfile: Object.freeze({ id: options.qualityProfileId || 'desktop' }),
    renderQualityId: options.renderQualityId || 'medium'
  });
  let stepCount = 0;
  while (!buildJob.step(4)) {
    stepCount++;
    assert.ok(stepCount < 100_000, 'Production cloverleaf visual build stalled');
  }
  return buildJob.finish();
}

/** Recursively prove that a public contract cannot be mutated one nested field at a time. */
function assertDeepFrozen(value, label = 'contract') {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  assert.equal(Object.isFrozen(value), true, `${label} is not frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${label}.${key}`);
}

/** Count indexed triangle edge use; a sealed production primitive must use every edge exactly twice. */
function indexedTopologyReport(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  assert.ok(position?.count > 0, 'Geometry has no positions');
  assert.ok(index?.count > 0 && index.count % 3 === 0, 'Geometry has no triangle index');
  const edgeUses = new Map();
  let degenerateTriangleCount = 0;
  const recordEdge = (left, right) => {
    const low = Math.min(left, right);
    const high = Math.max(left, right);
    const key = `${low}:${high}`;
    edgeUses.set(key, (edgeUses.get(key) || 0) + 1);
  };
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    assert.ok(a >= 0 && a < position.count);
    assert.ok(b >= 0 && b < position.count);
    assert.ok(c >= 0 && c < position.count);
    if (a === b || b === c || c === a) degenerateTriangleCount++;
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
  return Object.freeze({ boundaryEdgeCount, nonManifoldEdgeCount, degenerateTriangleCount });
}

/** Require the real Box3 to fill, but never exceed, the unit-envelope metadata consumed by instance matrices. */
function assertDeclaredLocalEnvelope(geometry, tolerance = 0.000_001) {
  geometry.computeBoundingBox();
  const actual = geometry.boundingBox;
  const declared = geometry.userData.neonV23SkyRouteScenery?.localEnvelope;
  assert.ok(declared, 'Geometry published no local scenery envelope');
  for (const [actualValue, declaredValue, label] of [
    [actual.min.x, declared.minX, 'minX'],
    [actual.max.x, declared.maxX, 'maxX'],
    [actual.min.y, declared.minY, 'minY'],
    [actual.max.y, declared.maxY, 'maxY'],
    [actual.min.z, declared.minZ, 'minZ'],
    [actual.max.z, declared.maxZ, 'maxZ']
  ]) {
    assert.ok(
      Math.abs(actualValue - declaredValue) <= tolerance,
      `${label} ${actualValue} diverged from declared ${declaredValue}`
    );
  }
}

/** Prove one retained Film cylinder contains all eight corners of its exact published instance AABB. */
function assertCameraBlockerContainsInstance(blocker, mesh, tileOrigin, tolerance = 0.000_001) {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const matrix = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  mesh.getMatrixAt(blocker.instanceIndex, matrix);
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).applyMatrix4(matrix);
        const absoluteX = corner.x + tileOrigin.x;
        const absoluteZ = corner.z + tileOrigin.z;
        assert.ok(
          Math.hypot(absoluteX - blocker.x, absoluteZ - blocker.z)
            <= blocker.radiusM + tolerance,
          `${blocker.id} does not contain transformed X/Z corner`
        );
        assert.ok(
          corner.y >= blocker.minY - tolerance && corner.y <= blocker.maxY + tolerance,
          `${blocker.id} does not contain transformed Y corner`
        );
      }
    }
  }
}

/** Mirror the tile pool's read-only track projection so a test exercises the exact resident/variant graph pair. */
function createScopedVisualTrack(graph) {
  return Object.freeze({
    graph,
    sampleEdge(edgeId, edgeS, lateral, out) {
      return productionTrack.sampleEdge(edgeId, edgeS, lateral, out);
    },
    getEdge(edgeId) {
      return graph.edgesById[edgeId] || productionTrack.getEdge(edgeId);
    },
    getRuntimeEdgesForTileIndex(tileIndex) {
      return productionTrack.getRuntimeEdgesForTileIndex(tileIndex);
    },
    getNode(nodeId) {
      return graph.nodesById[nodeId] || productionTrack.getNode(nodeId);
    },
    getMovement(movementId) {
      return graph.movementsById[movementId] || productionTrack.getMovement(movementId);
    },
    enumerateMovements() {
      return graph.movements;
    },
    gateTargetForHalfWidth(gate, halfWidth) {
      return productionTrack.gateTargetForHalfWidth(gate, halfWidth);
    },
    getVisibleEdges() {
      return graph.edges;
    },
    queryRoadClearance(x, z, radius, options) {
      return productionTrack.queryRoadClearance(x, z, radius, options);
    }
  });
}

function createRuntimeSupportFixture(options = {}) {
  const edge = Object.freeze({
    id: 'runtime-edge',
    templateEdgeId: 'template-edge',
    runtimeKind: 'recovery',
    family: 'recovery',
    tileIndex: 7,
    tileToken: 'tile:7:n',
    length: 52,
    roadHalf: 5
  });
  const samples = [];
  const track = {
    graph: { edges: [edge] },
    sampleEdge(edgeId, edgeS, lateral) {
      samples.push(Object.freeze({ edgeId, edgeS, lateral }));
      return typeof options.sampleFrame === 'function'
        ? options.sampleFrame(edgeId, edgeS, lateral)
        : { x: edgeS, y: 10, z: lateral, upY: 1 };
    },
    sampleTerrainHeight: options.sampleTerrainHeight,
    queryRoadClearance: options.queryRoadClearance,
    getEdge: options.getEdge,
    getRuntimeEdgesForTileIndex: options.getRuntimeEdgesForTileIndex
  };
  const job = cloverleafVisuals.createRuntimeSupportPlacementJob({
    runtimeTrack: track,
    runtimeEdges: [edge],
    supportGroundY: options.supportGroundY,
    permanentSupportCenters: options.permanentSupportCenters || [],
    composeRecord: options.composeRecord
  });
  return { edge, job, samples };
}

function extractFunctionDeclaration(functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.ok(start >= 0, `Missing production function ${functionName}`);
  const bodyStart = source.indexOf('{', start);
  assert.ok(bodyStart > start, `Missing production function body ${functionName}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated production function ${functionName}`);
}

function createRuntimeSupportRecordComposer(overrides = {}) {
  const composeSource = extractFunctionDeclaration('composeRuntimeSupportRecord');
  const undersideSource = extractFunctionDeclaration('verticalSupportDeckUndersideY');
  const verticalSupportDeckUndersideY = new Function(
    `${undersideSource}\nreturn verticalSupportDeckUndersideY;`
  )();
  const transferCapSource = extractFunctionDeclaration('supportTransferCapLayout');
  const supportTransferCapLayout = new Function(
    `${transferCapSource}\nreturn supportTransferCapLayout;`
  )();
  const fallbackGroundY = Number.isFinite(overrides.supportGroundY)
    ? overrides.supportGroundY
    : -1.18;
  const dependencies = {
    tileOrigin: { x: 0, z: 0 },
    deckThickness: 0.92,
    supportGroundY: fallbackGroundY,
    supportGroundHeightResolver: {
      sample() { return fallbackGroundY; }
    },
    verticalSupportDeckUndersideY,
    supportTransferCapLayout,
    supportFootingCenterOffsetY: 0.04,
    supportFootingHeight: 0.36,
    supportFootingWidth: SUPPORT_FOOTING_WIDTH,
    supportFootingDepth: SUPPORT_FOOTING_DEPTH,
    supportRadius: 1.24,
    supportClearanceRadius: 1.24,
    routeExteriorPortalClearHeight: 7.2,
    routeExteriorPortalMaximumSpanDepthRatio: 24,
    routeExteriorPortalMinimumCapDepth: 1.2,
    routeExteriorPortalMaximumCapDepth: 4.2,
    routeExteriorPortalHangerWidth: 0.28,
    routeExteriorPortalHangerDepth: 0.42,
    clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, value));
    },
    ...overrides,
    supportMatrix: new THREE.Matrix4(),
    supportPosition: new THREE.Vector3(),
    supportScale: new THREE.Vector3(),
    supportQuaternion: new THREE.Quaternion(),
    yAxis: new THREE.Vector3(0, 1, 0),
    detailRight: new THREE.Vector3(),
    detailUp: new THREE.Vector3(),
    detailBack: new THREE.Vector3(),
    detailBasis: new THREE.Matrix4(),
    detailQuaternion: new THREE.Quaternion()
  };
  const composeRuntimeSupportRecord = new Function(
    'dependencies',
    `${[
      'const {',
      '  tileOrigin, deckThickness, supportGroundHeightResolver, verticalSupportDeckUndersideY,',
      '  supportTransferCapLayout, supportFootingCenterOffsetY, supportFootingHeight,',
      '  supportFootingWidth, supportFootingDepth, supportRadius, supportClearanceRadius,',
      '  routeExteriorPortalClearHeight, routeExteriorPortalMaximumSpanDepthRatio,',
      '  routeExteriorPortalMinimumCapDepth, routeExteriorPortalMaximumCapDepth,',
      '  routeExteriorPortalHangerWidth, routeExteriorPortalHangerDepth, clamp,',
      '  supportMatrix, supportPosition, supportScale, supportQuaternion, yAxis,',
      '  detailRight, detailUp, detailBack, detailBasis, detailQuaternion',
      '} = dependencies;',
      composeSource,
      'return composeRuntimeSupportRecord;'
    ].join('\n')}`
  )(dependencies);
  return Object.freeze({ composeRuntimeSupportRecord, dependencies });
}

/** Extract the production route-structure composer with an explicit resident instance budget. */
function createRuntimeStructureComposer(capacity) {
  const composeSource = extractFunctionDeclaration('composeRuntimeLongSpanStructureMatrices');
  return new Function(
    'THREE',
    'tileOrigin',
    'deckThickness',
    'clamp',
    'sample',
    'sampledRoadHalf',
    'RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY',
    `${composeSource}; return composeRuntimeLongSpanStructureMatrices;`
  )(
    THREE,
    { x: 0, z: 0 },
    0.92,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    (track, edgeId, edgeS, lateral, scratch, target = null) => Object.assign(
      target || {},
      track.sampleEdge(edgeId, edgeS, lateral, scratch)
    ),
    (frame, edge) => Number.isFinite(frame?.roadHalf)
      ? frame.roadHalf
      : Number(edge?.roadHalf || edge?.halfWidth || 5.2),
    capacity
  );
}

function inspectEndpointSupportedSpan(options = {}) {
  const edgeLength = Number(options.edgeLength) || 389;
  const deckY = Number.isFinite(options.deckY) ? options.deckY : 20;
  const edge = Object.freeze({
    id: options.edgeId || 'runtime-long-span-edge',
    templateEdgeId: 'template-long-span-edge',
    runtimeKind: 'recovery',
    family: 'recovery',
    tileIndex: 11,
    tileToken: 'tile:11:n',
    length: edgeLength,
    roadHalf: 6,
    supportSpanContract: options.supportSpanContract || null
  });
  const supportedEndpoints = new Set(options.supportedEndpoints || [0, edgeLength]);
  const endpointToleranceM = 0.000_001;
  const runtimeTrack = {
    graph: { edges: [edge] },
    sampleEdge(edgeId, edgeS, lateral) {
      assert.equal(edgeId, edge.id);
      return {
        x: edgeS,
        y: deckY,
        z: lateral,
        tangentX: 1,
        tangentY: 0,
        tangentZ: 0,
        rightX: 0,
        rightY: 0,
        rightZ: 1,
        upX: 0,
        upY: 1,
        upZ: 0
      };
    },
    queryRoadClearance(x, z) {
      const supported = z === 0 && [...supportedEndpoints].some(
        (station) => Math.abs(x - station) <= endpointToleranceM
      );
      return supported
        ? { clear: true, edgeId: null, clearance: 4 }
        : { clear: false, edgeId: 'active-road', clearance: -1 };
    },
    getEdge(edgeId) {
      return edgeId === 'active-road'
        ? { id: edgeId, runtimeKind: 'template', tileIndex: 11 }
        : edgeId === edge.id
          ? edge
          : null;
    }
  };
  const job = cloverleafVisuals.createRuntimeSupportPlacementJob({
    runtimeTrack,
    runtimeEdges: [edge]
  });
  while (!job.step(4)) {
    // Drain the exact bounded production state machine; each endpoint is reachable at the fifth search station.
  }
  return Object.freeze({ edge, runtimeTrack, report: job.finish() });
}

test('independent jump-platform wedges preserve authored variety inside the existing recovery shell budget', () => {
  const edgeLength = 60;
  const planarLength = 54;
  const horizontalScale = planarLength / edgeLength;
  const jumpPlatforms = Object.freeze([
    Object.freeze({
      id: 'jump-edge:compact-left',
      edgeId: 'jump-edge',
      tileToken: 'tile:jump',
      variant: 'compact-left',
      startS: 5,
      lipS: 17,
      endS: 17,
      length: 12,
      ascent: 12,
      width: 4,
      halfWidth: 2,
      lateral: -1.5,
      height: 1.8,
      grade: 1.8 / (12 * horizontalScale),
      launchable: true
    }),
    Object.freeze({
      id: 'jump-edge:wide-right',
      edgeId: 'jump-edge',
      tileToken: 'tile:jump',
      variant: 'wide-right',
      startS: 25,
      lipS: 43,
      endS: 43,
      length: 18,
      ascent: 18,
      width: 6,
      halfWidth: 3,
      lateral: 1.5,
      height: 3,
      grade: 3 / (18 * horizontalScale),
      launchable: true
    })
  ]);
  const edge = Object.freeze({
    id: 'jump-edge',
    family: 'recovery',
    runtimeKind: 'recovery',
    length: edgeLength,
    planarLength,
    roadHalf: 6,
    jumpPlatforms
  });
  const samples = [];
  const track = {
    sampleEdge(edgeId, edgeS, lateral) {
      samples.push({ edgeId, edgeS, lateral });
      return {
        x: 100 + edgeS * horizontalScale,
        y: 5,
        z: 200 + lateral,
        tangentX: 1,
        tangentY: 0,
        tangentZ: 0,
        rightX: 0,
        rightY: 0,
        rightZ: 1,
        upX: 0,
        upY: 1,
        upZ: 0
      };
    }
  };

  const geometry = cloverleafVisuals.createJumpPlatformBatchGeometry({
    THREE,
    track,
    edges: [edge],
    tileOrigin: { x: 100, z: 200 }
  });
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const normal = geometry.getAttribute('normal');
  const roadCoordinate = geometry.getAttribute('roadCoord');
  assert.equal(geometry.userData.jumpPlatformCount, 2);
  assert.equal(geometry.userData.jumpPlatformEdgeCount, 1);
  assert.equal(geometry.userData.jumpPlatformVariantCount, 2);
  assert.equal(geometry.userData.jumpPlatformDimensionSignatureCount, 2);
  assert.equal(geometry.userData.jumpPlatformMinimumWidthM, 4);
  assert.equal(geometry.userData.jumpPlatformMaximumWidthM, 6);
  assert.equal(geometry.userData.jumpPlatformMinimumHeightM, 1.8);
  assert.equal(geometry.userData.jumpPlatformMaximumHeightM, 3);
  assert.equal(geometry.userData.jumpPlatformMinimumLengthM, 12);
  assert.equal(geometry.userData.jumpPlatformMaximumLengthM, 18);
  assert.equal(geometry.userData.jumpPlatformMaximumAbsLateralM, 1.5);
  assert.equal(geometry.userData.jumpPlatformAdditionalDrawGroupCount, 0);
  assert.equal(geometry.userData.jumpPlatformAdditionalObjectCount, 0);
  assert.equal(position.count, 48);
  assert.equal(color.count, position.count);
  assert.equal(normal.count, position.count);
  assert.equal(roadCoordinate.count, position.count);
  assert.equal(roadCoordinate.itemSize, 2);
  assert.equal(geometry.index.count, 72);
  assert.equal(geometry.userData.jumpPlatformTriangleCount, 24);
  assert.equal(samples.length, 8, 'Each platform endpoint must sample both authored lateral sides exactly once');

  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let minimumRoadX = Number.POSITIVE_INFINITY;
  let maximumRoadX = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index++) {
    for (const value of [
      position.getX(index),
      position.getY(index),
      position.getZ(index),
      normal.getX(index),
      normal.getY(index),
      normal.getZ(index),
      roadCoordinate.getX(index),
      roadCoordinate.getY(index)
    ]) assert.ok(Number.isFinite(value), 'Jump-platform geometry contains a non-finite GPU component');
    minimumY = Math.min(minimumY, position.getY(index));
    maximumY = Math.max(maximumY, position.getY(index));
    minimumRoadX = Math.min(minimumRoadX, roadCoordinate.getX(index));
    maximumRoadX = Math.max(maximumRoadX, roadCoordinate.getX(index));
  }
  assert.ok(Math.abs(minimumY - 5.094) <= 0.000_001, 'Platform underside lost the road-crown overlap');
  assert.ok(Math.abs(maximumY - 8.1) <= 0.000_001, 'Platform lip no longer represents authored height');
  assert.ok(Math.abs(minimumRoadX - (-3.5 / 6)) <= 0.000_001);
  assert.ok(Math.abs(maximumRoadX - (4.5 / 6)) <= 0.000_001);
  geometry.dispose();
});

test('jump-platform geometry merges into variant-owned recovery buffers without adding scene objects', () => {
  const batchStart = source.indexOf('function createGeometryBatchJob(options, explicitEdges = null)');
  const batchEnd = source.indexOf('function resumeGeometryJobWithinSafeBudget(', batchStart);
  const generatorStart = source.indexOf('function* createGenerator(options)');
  const generatorEnd = source.indexOf('function createBuildJob(options)', generatorStart);
  assert.ok(batchStart >= 0 && batchEnd > batchStart);
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
  const batchSource = source.slice(batchStart, batchEnd);
  const generatorSource = source.slice(generatorStart, generatorEnd);

  assert.match(batchSource, /stage = 'jump-platforms';/);
  assert.match(batchSource, /createJumpPlatformBatchGeometry\(\{ THREE, track, edges, tileOrigin \}\)/);
  assert.match(batchSource, /shellGeometries\.push\(jumpPlatformGeometry\)/);
  assert.match(batchSource, /jumpPlatformAdditionalDrawGroupCount: metrics\.jumpPlatformAdditionalDrawGroupCount/);
  assert.match(generatorSource, /recoveryRoadShell\.geometry = nextTemplate\.roadShellGeometry;/);
  assert.match(generatorSource, /roadShellDrawGroupCount: 2,/);
  assert.match(generatorSource, /jumpPlatformUnderlyingRoadRemainsFlat: true,/);
  assert.doesNotMatch(generatorSource, /new THREE\.Mesh\(jumpPlatformGeometry/);
});

test('support placement evaluates at most one historical-order candidate per resume', () => {
  const candidates = [];
  const job = cloverleafVisuals.createSupportPlacementSearchJob({
    edgeLength: 100,
    initialS: 50,
    searchDirection: 1,
    attemptCount: 5,
    searchStep: 10,
    symmetric: true,
    lateralOffsets: [0, 2],
    evaluateCandidate(supportS, lateral, searchIndex, attempt) {
      candidates.push({ supportS, lateral, searchIndex, attempt });
      return supportS === 40 && lateral === 0 ? 'installed:40:0' : undefined;
    }
  });

  assert.throws(() => job.finish(), /not complete/);
  let complete = false;
  while (!complete) {
    const before = candidates.length;
    complete = job.step();
    assert.equal(candidates.length - before, 1, 'One resume evaluated more than one clearance candidate');
  }

  assert.equal(job.finish(), 'installed:40:0');
  assert.equal(job.diagnostics.candidateCount, 5);
  assert.equal(job.diagnostics.exhausted, false);
  assert.deepEqual(candidates, [
    { supportS: 50, lateral: 0, searchIndex: 0, attempt: 0 },
    { supportS: 50, lateral: 2, searchIndex: 0, attempt: 0 },
    { supportS: 60, lateral: 0, searchIndex: 1, attempt: 1 },
    { supportS: 60, lateral: 2, searchIndex: 1, attempt: 1 },
    { supportS: 40, lateral: 0, searchIndex: -1, attempt: 2 }
  ]);
  assert.equal(job.step(), true, 'A completed search reran its terminal candidate');
  assert.equal(candidates.length, 5);
});

test('support placement preserves clamped exhaustion and terminal-null semantics', () => {
  const exhaustedCandidates = [];
  const exhaustedJob = cloverleafVisuals.createSupportPlacementSearchJob({
    edgeLength: 100,
    initialS: 95,
    searchDirection: 1,
    attemptCount: 3,
    searchStep: 10,
    lateralOffsets: [0],
    evaluateCandidate(supportS) {
      exhaustedCandidates.push(supportS);
      return undefined;
    }
  });
  assert.equal(exhaustedJob.step(), false);
  assert.equal(exhaustedJob.step(), false);
  assert.equal(exhaustedJob.step(), true);
  assert.deepEqual(exhaustedCandidates, [95, 100, 100]);
  assert.equal(exhaustedJob.finish(), null);
  assert.equal(exhaustedJob.diagnostics.exhausted, true);

  let terminalCalls = 0;
  const terminalJob = cloverleafVisuals.createSupportPlacementSearchJob({
    edgeLength: 10,
    attemptCount: 24,
    evaluateCandidate() {
      terminalCalls++;
      return null;
    }
  });
  assert.equal(terminalJob.step(), true);
  assert.equal(terminalJob.finish(), null);
  assert.equal(terminalJob.diagnostics.exhausted, false);
  assert.equal(terminalCalls, 1, 'A terminal installation failure fell through into later candidates');
});

test('support placement propagates candidate errors without converting them into rejection', () => {
  const expected = new Error('clearance-query-failed');
  const job = cloverleafVisuals.createSupportPlacementSearchJob({
    edgeLength: 10,
    evaluateCandidate() {
      throw expected;
    }
  });
  assert.throws(() => job.step(), (error) => error === expected);
  assert.equal(job.diagnostics.complete, false);
  assert.throws(() => job.finish(), /not complete/);
});

test('production crossing and elevated supports delegate to the resumable search', () => {
  const placementStart = source.indexOf('function* placeSupportOnDeck(');
  const placementEnd = source.indexOf('function segmentChordError(', placementStart);
  assert.ok(placementStart >= 0 && placementEnd > placementStart);
  const placementSource = source.slice(placementStart, placementEnd);
  assert.match(placementSource, /createSupportPlacementSearchJob\(\{/);
  assert.match(placementSource, /yield stageLabel;\s*if \(placementJob\.step\(\)\) break;/);
  assert.doesNotMatch(placementSource, /for \(let attempt = 0;/);
  assert.equal(
    (source.match(/yield\* placeSupportOnDeck\(/g) || []).length,
    3,
    'A production support path bypasses the resumable placement search'
  );
  assert.match(
    source,
    /for \(const stationOffset of \[-beamOffset, 0, beamOffset\]\) \{\s*[\s\S]*?yield 'crossing-supports';/
  );
  assert.match(
    source,
    /yield 'crossing-supports';\s*const centralCrossing =/
  );
  const installSource = extractFunctionDeclaration('installSupport');
  assert.match(installSource, /verticalSupportDeckUndersideY\(frame, deckThickness\)/);
  assert.match(installSource, /supportGroundHeightResolver\.sample\(frame\.x, frame\.z,/);
  assert.match(
    installSource,
    /supportTransferCapLayout\(supportLateral, roadHalf, supportRadius\)/
  );
  assert.match(installSource, /detailRight\.x \* capCenterLateralOffset/);
  assert.match(installSource, /supportMaximumInvalidOutwardCapOverhang = Math\.max\(/);
  assert.match(installSource, /supportMinimumPierCapOverlap = Math\.min\(/);
  assert.doesNotMatch(installSource, /2\.2 \+ cantileverReach \* 2/);
});

test('runtime support retries one clearance query per resume and finalizes one edge per later resume', () => {
  const queries = [];
  const composed = [];
  const blockerIds = ['inactive-a', 'inactive-b'];
  const fixture = createRuntimeSupportFixture({
    queryRoadClearance(x, z, radius, queryOptions) {
      queries.push({ x, z, radius, ignoreEdgeIds: [...queryOptions.ignoreEdgeIds] });
      const blockerId = blockerIds[queries.length - 1];
      return blockerId
        ? { clear: false, edgeId: blockerId, clearance: -1 }
        : { clear: true, edgeId: null, clearance: 2.25 };
    },
    getEdge(edgeId) {
      return blockerIds.includes(edgeId)
        ? { id: edgeId, runtimeKind: 'recovery', tileIndex: 7 }
        : null;
    },
    composeRecord(frame, edgeId, edgeS) {
      composed.push({ edgeId, edgeS, lateral: frame.supportLateral });
      return Object.freeze({ edgeId, edgeS, x: frame.x, z: frame.z, height: 9 });
    }
  });

  assert.equal(fixture.job.step(4), false, 'Nominal spec initialization must yield before clearance');
  assert.equal(queries.length, 0);
  assert.equal(fixture.job.step(4), false);
  assert.equal(queries.length, 1);
  assert.equal(fixture.samples.length, 1);
  assert.equal(composed.length, 0);
  assert.equal(fixture.job.step(4), false);
  assert.equal(queries.length, 2);
  assert.equal(fixture.samples.length, 1, 'A clearance retry resampled the placement frame');
  assert.equal(composed.length, 0);
  assert.equal(fixture.job.step(4), false);
  assert.equal(queries.length, 3);
  assert.equal(composed.length, 1, 'Terminal clearance yielded before detached-record commit');
  assert.equal(fixture.job.step(4), false, 'Final edge aggregation was not isolated from the last candidate');
  assert.equal(fixture.job.diagnostics.lastStepLabel, 'finalize-edge');
  assert.equal(fixture.job.step(4), true, 'Report publication was not isolated from edge aggregation');
  assert.equal(fixture.job.diagnostics.lastStepLabel, 'finalize-publish');

  assert.deepEqual(queries.map((query) => query.ignoreEdgeIds), [
    ['runtime-edge', 'template-edge'],
    ['runtime-edge', 'template-edge', 'inactive-a'],
    ['runtime-edge', 'template-edge', 'inactive-a', 'inactive-b']
  ]);
  assert.deepEqual(composed, [{ edgeId: 'runtime-edge', edgeS: 26, lateral: 0 }]);
  const report = fixture.job.finish();
  assert.equal(report.plannerSpecCount, 1);
  assert.equal(report.plannerStepCount, 6);
  assert.equal(report.placementCandidateCount, 1);
  assert.equal(report.clearanceQueryCount, 3);
  assert.equal(report.clearanceRetryYieldCount, 2);
  assert.deepEqual(report.inactiveVariantIgnoredEdgeIds, ['inactive-a', 'inactive-b']);
  assert.equal(report.minimumRoadGap, 3.25);
});

test('runtime support pre-excludes registered same-tile variants without changing placement', () => {
  const knownInactiveId = 'alternate-runtime-edge';
  const queryIgnoreIds = [];
  const fixture = createRuntimeSupportFixture({
    queryRoadClearance(x, z, radius, queryOptions) {
      queryIgnoreIds.push([...queryOptions.ignoreEdgeIds]);
      return queryOptions.ignoreEdgeIds.includes(knownInactiveId)
        ? { clear: true, clearance: 3 }
        : { clear: false, edgeId: knownInactiveId, clearance: -1 };
    },
    getRuntimeEdgesForTileIndex(tileIndex) {
      assert.equal(tileIndex, 7);
      return [{
        id: knownInactiveId,
        runtimeKind: 'recovery',
        tileIndex: 7,
        tileToken: 'tile:7:other'
      }];
    },
    composeRecord(frame, edgeId, edgeS) {
      return Object.freeze({ edgeId, edgeS, x: frame.x, z: frame.z, height: 9 });
    }
  });

  while (!fixture.job.step(4)) {
    // The job owns its recovery points; this test drains the exact production state machine.
  }
  const report = fixture.job.finish();
  assert.equal(report.plannerStepCount, 4);
  assert.equal(report.clearanceQueryCount, 1);
  assert.equal(report.clearanceRetryYieldCount, 0);
  assert.ok(queryIgnoreIds[0].includes(knownInactiveId));
  assert.deepEqual(report.inactiveVariantIgnoredEdgeIds, [knownInactiveId]);
  assert.deepEqual(report.stationsByEdge['runtime-edge'], [26]);
  assert.equal(report.maximumGap, 26);
});

test('support-height clearance treats a banked slab underside as contact while preserving planar callers', () => {
  const edge = productionTrack.graph.edges.find((candidate) => candidate.family === 'direct-ramp');
  assert.ok(edge, 'Production graph omitted its banked direct-ramp fixture');
  const centre = productionTrack.sampleEdge(edge.id, edge.length * 0.5, 0, {});
  const frame = productionTrack.sampleEdge(edge.id, edge.length * 0.5, centre.roadHalf, {});
  assert.ok(Math.abs(frame.rightY) > 0.01, 'Height-aware fixture is not banked at its sampled edge');
  const ignoredEdgeIds = productionTrack.graph.edges
    .filter((candidate) => candidate.id !== edge.id)
    .map((candidate) => candidate.id);
  const queryOptions = {
    gap: 0,
    ignoreEdgeIds: ignoredEdgeIds
  };
  const legacy = productionTrack.queryRoadClearance(frame.x, frame.z, 0, queryOptions);
  const deckThickness = productionTrack.graph.contract.deckThickness;
  const undersideY = frame.y - deckThickness / frame.upY;
  const contact = productionTrack.queryRoadClearance(frame.x, frame.z, 0, {
    ...queryOptions,
    verticalEnvelope: { minY: -1.18, maxY: undersideY }
  });
  const penetration = productionTrack.queryRoadClearance(frame.x, frame.z, 0, {
    ...queryOptions,
    verticalEnvelope: { minY: -1.18, maxY: undersideY + 0.08 }
  });
  const legacyAfterHeightQuery = productionTrack.queryRoadClearance(
    frame.x,
    frame.z,
    0,
    queryOptions
  );

  assert.equal(legacy.intersects, true, 'Omitting verticalEnvelope changed the historical XZ query');
  assert.equal(legacyAfterHeightQuery.clearance, legacy.clearance);
  assert.equal(legacyAfterHeightQuery.roadMinimumY, null);
  assert.equal(legacyAfterHeightQuery.roadMaximumY, null);
  assert.equal(legacyAfterHeightQuery.roadLateral, null);
  assert.equal(legacyAfterHeightQuery.roadSurfaceY, null);
  assert.equal(legacyAfterHeightQuery.verticalOverlapM, null);
  assert.equal(contact.clear, true, 'A column ending at the banked slab underside was rejected');
  assert.equal(penetration.edgeId, edge.id);
  assert.ok(Math.abs(penetration.roadMaximumY - frame.y) <= 0.02);
  assert.ok(Math.abs(penetration.roadMinimumY - undersideY) <= 0.02);
  assert.ok(penetration.verticalOverlapM >= 0.069_999);
  assert.throws(
    () => productionTrack.queryRoadClearance(frame.x, frame.z, 0, {
      ...queryOptions,
      verticalEnvelope: { minY: Number.NaN, maxY: undersideY }
    }),
    TypeError
  );
  assert.throws(
    () => productionTrack.queryRoadClearance(frame.x, frame.z, 0, {
      ...queryOptions,
      verticalEnvelope: { minY: undersideY, maxY: -1.18 }
    }),
    RangeError
  );
});

test('runtime support preserves lateral-first symmetric search order across resumes', () => {
  const queries = [];
  const sideOffset = 5 - SUPPORT_FOOTING_CLEARANCE_RADIUS - 0.9;
  const outerOffset = 5 + SUPPORT_FOOTING_CLEARANCE_RADIUS + 1 + 3;
  const nearPortalOffset = outerOffset + 5 * 0.65;
  const middlePortalOffset = outerOffset + 5 * 1.85;
  const farPortalOffset = outerOffset + 5 * 3.25;
  const fixture = createRuntimeSupportFixture({
    queryRoadClearance(x, z) {
      queries.push([x, z]);
      return x === 39 && z === -sideOffset
        ? { clear: true, clearance: 4 }
        : { clear: false, edgeId: 'permanent-road', clearance: -1 };
    },
    getEdge() { return null; },
    composeRecord(frame, edgeId, edgeS) {
      return Object.freeze({ edgeId, edgeS, x: frame.x, z: frame.z, height: 9 });
    }
  });

  let complete = false;
  let resumeCount = 0;
  while (!complete) {
    const before = queries.length;
    complete = fixture.job.step(0.25);
    assert.ok(queries.length - before <= 1, 'One planner resume crossed into a second clearance candidate');
    resumeCount++;
  }

  assert.deepEqual(queries, [
    [26, 0],
    [26, sideOffset],
    [26, -sideOffset],
    [26, outerOffset],
    [26, -outerOffset],
    [26, -nearPortalOffset],
    [26, -middlePortalOffset],
    [26, -nearPortalOffset],
    [26, -middlePortalOffset],
    [26, -farPortalOffset],
    [26, -nearPortalOffset],
    [26, -farPortalOffset],
    [26, -middlePortalOffset],
    [26, -farPortalOffset],
    [39, 0],
    [39, sideOffset],
    [39, -sideOffset]
  ]);
  const report = fixture.job.finish();
  assert.equal(resumeCount, 36);
  assert.equal(report.plannerStepCount, 36);
  assert.equal(report.placementCandidateCount, 17);
  assert.equal(report.clearanceQueryCount, 17);
  assert.deepEqual(report.stationsByEdge['runtime-edge'], [39]);
});

test('runtime support chooses the shortest clearance-proven asymmetric portal before declaring a low long span', () => {
  const queriedLaterals = [];
  const sideOffset = 5 - SUPPORT_FOOTING_CLEARANCE_RADIUS - 0.9;
  const outerOffset = 5 + SUPPORT_FOOTING_CLEARANCE_RADIUS + 1 + 3;
  const nearPortalOffset = outerOffset + 5 * 0.65;
  const middlePortalOffset = outerOffset + 5 * 1.85;
  const farPortalOffset = outerOffset + 5 * 3.25;
  const fixture = createRuntimeSupportFixture({
    queryRoadClearance(x, z, radius, queryOptions) {
      queriedLaterals.push(z);
      assert.equal(radius, SUPPORT_FOOTING_CLEARANCE_RADIUS);
      assert.ok(queryOptions.ignoreEdgeIds.includes('runtime-edge'));
      // The left leg must reach the far zone while the right leg clears at the near zone. The planner must
      // therefore stop at the first valid asymmetric pair instead of continuing to a needlessly wider roof.
      return z <= -farPortalOffset || z >= nearPortalOffset
        ? { clear: true, clearance: 2.4 }
        : { clear: false, edgeId: 'active-road', clearance: -1 };
    },
    getEdge(edgeId) {
      return edgeId === 'active-road'
        ? { id: edgeId, runtimeKind: 'template', tileIndex: 7 }
        : null;
    }
  });

  while (!fixture.job.step(4)) {
    // Drain the bounded production search; every ordinary support position is deliberately occupied.
  }
  const report = fixture.job.finish();
  assert.deepEqual(queriedLaterals, [
    0,
    sideOffset,
    -sideOffset,
    outerOffset,
    -outerOffset,
    -nearPortalOffset,
    -middlePortalOffset,
    -nearPortalOffset,
    -middlePortalOffset,
    -farPortalOffset,
    nearPortalOffset
  ]);
  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].supportKind, 'route-exterior-portal');
  assert.deepEqual(report.records[0].supportLaterals, [-farPortalOffset, nearPortalOffset]);
  assert.equal(report.records[0].supportLegs.length, 2);
  assert.equal(report.records[0].roadHalf, 5);
  assert.ok(
    report.maximumRouteExteriorPortalSpan < farPortalOffset * 2,
    'The accepted asymmetric portal retained the discarded far-to-far span'
  );
  assert.equal(report.routeExteriorPortalCount, 1);
  assert.equal(report.maximumGap, 26);
  assert.equal(report.gapViolationCount, 0);
  assert.equal(report.designedLongSpanCount, 0);
  assert.equal(report.minimumRoadGap, 3.4);
  assert.equal(report.pairedSupportCount, 1);
  assert.equal(report.pairedSupportLegCount, 2);
  assert.equal(report.pairedSupportClearanceYieldCount, 1);
  assert.equal(report.clearanceQueryCount, 11);
  assert.equal(report.supportClearanceRadius, SUPPORT_FOOTING_CLEARANCE_RADIUS);
});

test('continuous box girder owns an 88 metre rhythm without relaxing ordinary 52 metre supports', () => {
  const ordinaryEdge = Object.freeze({
    id: 'ordinary-rhythm-edge',
    templateEdgeId: 'ordinary-rhythm-template',
    runtimeKind: 'recovery',
    family: 'recovery',
    tileIndex: 9,
    tileToken: 'tile:9:n',
    length: 352,
    roadHalf: 5
  });
  const crossoverEdge = Object.freeze({
    ...ordinaryEdge,
    id: 'continuous-box-girder-edge',
    templateEdgeId: 'continuous-box-girder-template',
    supportSpanContract: Object.freeze({
      kind: 'continuous-box-girder',
      supportSpacingM: 88,
      fasciaSegmentM: 24,
      fasciaWidthM: 0.34,
      fasciaDepthM: 0.72,
      diaphragmDepthM: 0.20
    })
  });
  const edges = Object.freeze([ordinaryEdge, crossoverEdge]);
  const edgesById = Object.freeze(Object.fromEntries(edges.map((edge) => [edge.id, edge])));
  const runtimeTrack = {
    graph: { edges },
    sampleEdge(edgeId, edgeS, lateral) {
      return {
        x: edgeS,
        y: 10,
        z: (edgeId === crossoverEdge.id ? 100 : 0) + lateral,
        upY: 1,
        roadHalf: 5
      };
    },
    queryRoadClearance() {
      return { clear: true, clearance: 4 };
    },
    getEdge(edgeId) {
      return edgesById[edgeId] || null;
    }
  };
  const job = cloverleafVisuals.createRuntimeSupportPlacementJob({
    runtimeTrack,
    runtimeEdges: edges
  });
  while (!job.step(4)) {
    // Drain both edge-local rhythms through the same production planner.
  }
  const report = job.finish();

  assert.equal(report.standardMaximumAllowedGap, 104.01);
  assert.equal(report.supportSpacingByEdge[ordinaryEdge.id], 52);
  assert.equal(report.maximumAllowedGapByEdge[ordinaryEdge.id], 104.01);
  assert.equal(report.supportSpacingByEdge[crossoverEdge.id], 88);
  assert.equal(report.maximumAllowedGapByEdge[crossoverEdge.id], 176.01);
  assert.equal(report.maximumAllowedGap, 176.01);
  assert.equal(Object.isFrozen(report.supportSpacingByEdge), true);
  assert.equal(Object.isFrozen(report.maximumAllowedGapByEdge), true);
  assert.equal(report.plannerSpecCount, 11);
  assert.equal(report.records.length, 11);
  assert.deepEqual(
    report.stationsByEdge[crossoverEdge.id].map((station) => Number(station.toFixed(6))),
    [44, 132, 220, 308]
  );
  assert.deepEqual(
    report.stationsByEdge[ordinaryEdge.id].map((station) => Number(station.toFixed(6))),
    [25.142_857, 75.428_571, 125.714_286, 176, 226.285_714, 276.571_429, 326.857_143]
  );
  assert.equal(report.designedLongSpanCount, 0);
  assert.equal(report.gapViolationCount, 0);
  assert.equal(report.unsupportedEdgeCount, 0);
});

test('runtime support resolves every column against its own terrain height with an explicit flat fallback', () => {
  const terrainSamples = [];
  const fixture = createRuntimeSupportFixture({
    sampleTerrainHeight(x, z, context) {
      const groundY = -1.8 + z * 0.015;
      terrainSamples.push(Object.freeze({ x, z, context, groundY }));
      return { worldY: groundY };
    },
    queryRoadClearance(x, z) {
      return Math.abs(z) >= 25
        ? { clear: true, clearance: 2.4 }
        : { clear: false, edgeId: 'active-road', clearance: -1 };
    },
    getEdge(edgeId) {
      return edgeId === 'active-road'
        ? { id: edgeId, runtimeKind: 'template', tileIndex: 7 }
        : null;
    }
  });
  while (!fixture.job.step(4)) {
    // Drain the bounded placement job until the two-leg exterior portal is committed.
  }
  const report = fixture.job.finish();
  const record = report.records[0];
  assert.equal(report.supportGroundHeightSource, 'runtimeTrack.sampleTerrainHeight');
  assert.equal(report.supportGroundHeightFallbackCount, 0);
  assert.equal(report.supportGroundHeightSampleCount, terrainSamples.length);
  assert.equal(report.minimumSupportGroundY, Math.min(...terrainSamples.map((sample) => sample.groundY)));
  assert.equal(report.maximumSupportGroundY, Math.max(...terrainSamples.map((sample) => sample.groundY)));
  assert.equal(report.groundContactError, 0);
  assert.equal(record.supportLegs.length, 2);
  assert.notEqual(record.supportLegs[0].groundY, record.supportLegs[1].groundY);
  for (const leg of record.supportLegs) {
    assert.ok(Math.abs(leg.height - (leg.topY - leg.groundY)) <= 0.000_001);
  }
  assert.ok(
    terrainSamples.every((sample) => (
      sample.context.edgeId === 'runtime-edge'
      && Number.isFinite(sample.context.edgeS)
      && Number.isFinite(sample.context.lateral)
    )),
    'Terrain sampler lost the owning edge/station/column context'
  );

  const fallbackFixture = createRuntimeSupportFixture({
    supportGroundY: -3.25,
    queryRoadClearance() { return { clear: true, clearance: 2 }; }
  });
  while (!fallbackFixture.job.step(4)) {
    // Legacy hosts have no terrain API; the declared flat datum remains deterministic and diagnosed.
  }
  const fallbackReport = fallbackFixture.job.finish();
  assert.equal(fallbackReport.supportGroundHeightSource, 'fallback.supportGroundY');
  assert.equal(
    fallbackReport.supportGroundHeightSampleCount,
    fallbackReport.supportGroundHeightFallbackCount
  );
  assert.equal(fallbackReport.minimumSupportGroundY, -3.25);
  assert.equal(fallbackReport.maximumSupportGroundY, -3.25);
  assert.equal(fallbackReport.records[0].supportLegs[0].groundY, -3.25);

  const invalidSamplerFixture = createRuntimeSupportFixture({
    sampleTerrainHeight() { return Number.NaN; },
    queryRoadClearance() { return { clear: true, clearance: 2 }; }
  });
  assert.throws(
    () => invalidSamplerFixture.job.step(4),
    /must return a finite terrain world height/,
    'An installed terrain authority must not silently degrade to the flat compatibility datum'
  );
});

test('route-exterior two-leg portal clears pavement and preserves a suspended load path', () => {
  const { composeRuntimeSupportRecord, dependencies } = createRuntimeSupportRecordComposer();
  const roadY = 20;
  const roadHalf = 8.4;
  const supportLateral = 41.74;
  const makeFrame = (lateral) => ({
    x: 100,
    y: roadY,
    z: lateral,
    yaw: 0,
    tangentX: 1,
    tangentY: 0,
    tangentZ: 0,
    rightX: 0,
    rightY: 0,
    rightZ: 1,
    upX: 0,
    upY: 1,
    upZ: 0,
    roadHalf,
    supportLateral: lateral,
    supportGroundY: dependencies.supportGroundY
  });
  const leftFrame = makeFrame(-supportLateral);
  const rightFrame = makeFrame(supportLateral);
  leftFrame.supportPairFrames = [leftFrame, rightFrame];
  const record = composeRuntimeSupportRecord(leftFrame, 'route-exterior-edge', 2_480);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  record.capMatrix.decompose(position, quaternion, scale);
  const capMinimumLateral = position.z - scale.x * 0.5;
  const capMaximumLateral = position.z + scale.x * 0.5;
  const capMinimumY = position.y - scale.y * 0.5;
  const capMaximumY = position.y + scale.y * 0.5;
  const girderLateral = roadHalf - 0.48;

  assert.equal(record.supportKind, 'route-exterior-portal');
  assert.equal(record.structuralMode, 'overhead-suspended-portal');
  assert.equal(record.pierMatrices.length, 2);
  assert.equal(record.capMatrices.length, 3);
  assert.equal(record.footingMatrices.length, 2);
  assert.ok(record.capPierTopAlignmentError <= 0.000_001);
  assert.ok(record.groundContactError <= 0.000_001);
  assert.deepEqual(record.supportLaterals, [-supportLateral, supportLateral]);
  assert.ok(
    record.capWidth / record.capDepth <= dependencies.routeExteriorPortalMaximumSpanDepthRatio
      + 0.000_001,
    'Portal transfer beam reverted to an implausible paper-thin span'
  );
  assert.ok(
    capMinimumLateral < -girderLateral && capMaximumLateral > girderLateral,
    'Portal crossbeam does not continuously reach both deep side box girders'
  );
  assert.ok(
    capMinimumLateral < -supportLateral && capMaximumLateral > supportLateral,
    'Portal crossbeam no longer overlaps both clearance-proven legs'
  );
  assert.ok(
    capMinimumY >= roadY + dependencies.routeExteriorPortalClearHeight - 0.000_001,
    'Portal transfer beam dropped into the driveable or airborne clearance envelope'
  );

  for (let index = 0; index < record.pierMatrices.length; index++) {
    record.pierMatrices[index].decompose(position, quaternion, scale);
    const pierTopY = position.y + scale.y * 0.5;
    assert.ok(
      pierTopY >= capMinimumY - 0.000_001 && pierTopY <= capMaximumY + 0.000_001,
      `Portal leg ${index} and crossbeam lost their vertical load-path overlap`
    );
    const pierZ = position.z;
    record.footingMatrices[index].decompose(position, quaternion, scale);
    const footingClearanceRadius = Math.hypot(scale.x * 0.5, scale.z * 0.5);
    assert.ok(
      Math.abs(position.z - pierZ) <= 0.000_001
        && position.y - scale.y * 0.5 <= dependencies.supportGroundY + 0.23
        && footingClearanceRadius <= dependencies.supportClearanceRadius + 0.000_001,
      `Portal footing ${index} is detached from its clearance-proven leg centre`
    );
  }
  for (const hangerMatrix of record.capMatrices.slice(1)) {
    hangerMatrix.decompose(position, quaternion, scale);
    const hangerMinimumY = position.y - scale.y * 0.5;
    const hangerMaximumY = position.y + scale.y * 0.5;
    assert.ok(
      Math.abs(position.z) > roadHalf
        && hangerMinimumY <= roadY - dependencies.deckThickness + 0.000_001
        && hangerMaximumY >= capMinimumY - 0.000_001,
      'Portal hanger no longer joins an exterior side girder to the overhead transfer beam'
    );
  }
});

test('a ten-degree bank keeps each vertical pier, terrain footing, and one-sided transfer cap joined', () => {
  const supportRadius = 0.62;
  const { composeRuntimeSupportRecord, dependencies } = createRuntimeSupportRecordComposer({
    supportRadius,
    supportClearanceRadius: SUPPORT_FOOTING_CLEARANCE_RADIUS
  });
  const bankRadians = 10 * Math.PI / 180;
  const bankSin = Math.sin(bankRadians);
  const bankCos = Math.cos(bankRadians);
  const supportLateral = 14.42;
  const roadHalf = 7.76;
  const frame = {
    x: 100,
    y: 20 + bankSin * supportLateral,
    z: bankCos * supportLateral,
    yaw: -Math.PI * 0.5,
    tangentX: 1,
    tangentY: 0,
    tangentZ: 0,
    rightX: 0,
    rightY: bankSin,
    rightZ: bankCos,
    upX: 0,
    upY: bankCos,
    upZ: -bankSin,
    roadHalf,
    supportLateral,
    supportGroundY: -2.35
  };
  const record = composeRuntimeSupportRecord(frame, 'banked-support-edge', 640);
  const expectedTopY = frame.y - dependencies.deckThickness / bankCos;
  const projectedTopY = frame.y - dependencies.deckThickness * bankCos;
  assert.ok(
    Math.abs(expectedTopY - projectedTopY) > 0.027,
    'Ten-degree fixture no longer exposes the projected-thickness pier-top regression'
  );
  assert.ok(Math.abs(record.supportLegs[0].topY - expectedTopY) <= 0.000_001);
  assert.equal(record.supportLegs[0].groundY, frame.supportGroundY);
  assert.ok(record.groundContactError <= 0.000_001);
  assert.ok(record.capPierTopAlignmentError <= 0.000_001);

  const nearestGirderLateral = roadHalf - 0.48;
  const expectedTransferReach = supportLateral - nearestGirderLateral;
  assert.ok(Math.abs(record.transferReach - expectedTransferReach) <= 0.000_001);
  assert.ok(Math.abs(record.capCenterLateralOffset + expectedTransferReach * 0.5) <= 0.000_001);
  assert.ok(
    Math.abs(record.capWidth - (expectedTransferReach + record.capEndOverlap * 2))
      <= 0.000_001
  );
  assert.ok(record.invalidOutwardCapOverhang <= 0.000_001);
  assert.ok(Math.abs(record.pierCapOverlap - supportRadius * 2) <= 0.000_001);
  for (const lateral of [-14.42, -7.5, -2, 0, 2, 7.5, 14.42]) {
    const layout = dependencies.supportTransferCapLayout(lateral, roadHalf, supportRadius);
    assert.ok(layout.invalidOutwardOverhang <= 0.000_001);
    assert.ok(Math.abs(layout.pierOverlap - supportRadius * 2) <= 0.000_001);
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  record.pierMatrix.decompose(position, quaternion, scale);
  assert.ok(Math.abs(position.y - scale.y * 0.5 - frame.supportGroundY) <= 0.000_001);
  assert.ok(Math.abs(position.y + scale.y * 0.5 - expectedTopY) <= 0.000_001);
  record.footingMatrix.decompose(position, quaternion, scale);
  assert.ok(Math.abs(position.y - (frame.supportGroundY + 0.04)) <= 0.000_001);

  const columnTopInCap = new THREE.Vector3(frame.x, expectedTopY, frame.z)
    .applyMatrix4(record.capMatrix.clone().invert());
  assert.ok(Math.abs(columnTopInCap.y - 0.5) <= 0.000_001);
  assert.ok(Math.abs(columnTopInCap.x) <= 0.5 + 0.000_001);
  assert.ok(Math.abs(columnTopInCap.z) <= 0.5 + 0.000_001);

  const innerLateral = 2;
  const innerRecord = composeRuntimeSupportRecord({
    ...frame,
    y: 20 + bankSin * innerLateral,
    z: bankCos * innerLateral,
    supportLateral: innerLateral
  }, 'banked-inner-support-edge', 640);
  assert.equal(innerRecord.transferReach, 0);
  assert.equal(Math.abs(innerRecord.capCenterLateralOffset), 0);
  assert.ok(Math.abs(innerRecord.capWidth - innerRecord.capEndOverlap * 2) <= 0.000_001);

  const diagnosticFixture = createRuntimeSupportFixture({
    queryRoadClearance() { return { clear: true, clearance: 2 }; },
    composeRecord() { return record; }
  });
  while (!diagnosticFixture.job.step(4)) {
    // The planner must publish the per-instance transfer-cap audit, not only retain it on the matrix record.
  }
  const diagnosticReport = diagnosticFixture.job.finish();
  assert.ok(diagnosticReport.maximumInvalidOutwardCapOverhang <= 0.000_001);
  assert.ok(
    Math.abs(diagnosticReport.minimumPierCapOverlap - supportRadius * 2) <= 0.000_001
  );
});

test('every production bridge support retains joined terrain, footing, shaft, and cap matrices', () => {
  const restoreDocument = installCanvasDocumentStub();
  const scene = new THREE.Scene();
  const sampleTerrainHeight = (x, z) => (
    -1.18 + Math.sin(x * 0.011) * 0.17 + Math.cos(z * 0.013) * 0.11
  );
  let visual = null;
  try {
    const buildJob = cloverleafVisuals.createBuildJob({
      THREE,
      track: productionTrack,
      modeling,
      scene,
      qualityProfile: Object.freeze({ id: 'mobile' }),
      renderQualityId: 'medium',
      sampleTerrainHeight
    });
    let stepCount = 0;
    while (!buildJob.step(4)) {
      stepCount++;
      assert.ok(stepCount < 100_000, 'Production support visual build stalled');
    }
    visual = buildJob.finish();

    const supportCount = visual.supports.count;
    const tileOrigin = visual.diagnostics.tileOrigin;
    // Height-aware clearance restores two valid bearing sites that the former plan-view-only query rejected.
    assert.equal(supportCount, 239);
    assert.equal(visual.diagnostics.expectedSupportCount, supportCount);
    assert.equal(visual.diagnostics.supportFootingCount, supportCount);
    assert.equal(visual.supportCaps.count, supportCount * 2);
    assert.equal(visual.diagnostics.supportGroundHeightFallbackCount, 0);
    assert.equal(visual.diagnostics.supportGroundHeightSource, 'options.sampleTerrainHeight');
    assert.ok(visual.diagnostics.supportGroundContactError <= 0.000_001);
    assert.ok(visual.diagnostics.supportCapAlignmentError <= 0.000_001);
    assert.ok(visual.diagnostics.supportMaximumInvalidOutwardCapOverhang <= 0.000_001);
    assert.ok(visual.diagnostics.supportMinimumPierCapOverlap >= 1.239_999);

    const pierMatrix = new THREE.Matrix4();
    const capMatrix = new THREE.Matrix4();
    const footingMatrix = new THREE.Matrix4();
    const pierPosition = new THREE.Vector3();
    const capPosition = new THREE.Vector3();
    const footingPosition = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const pierScale = new THREE.Vector3();
    const capScale = new THREE.Vector3();
    const footingScale = new THREE.Vector3();
    const localPierTop = new THREE.Vector3();
    // InstancedMesh stores matrices in Float32Array; this tolerance is below one hundredth of a millimetre.
    const instanceMatrixToleranceM = 0.000_01;
    let maximumCapWidthM = 0;

    for (let index = 0; index < supportCount; index++) {
      visual.supports.getMatrixAt(index, pierMatrix);
      visual.supportCaps.getMatrixAt(index * 2, capMatrix);
      visual.supportCaps.getMatrixAt(index * 2 + 1, footingMatrix);
      pierMatrix.decompose(pierPosition, quaternion, pierScale);
      capMatrix.decompose(capPosition, quaternion, capScale);
      footingMatrix.decompose(footingPosition, quaternion, footingScale);

      const worldX = pierPosition.x + tileOrigin.x;
      const worldZ = pierPosition.z + tileOrigin.z;
      const expectedGroundY = sampleTerrainHeight(worldX, worldZ);
      const pierBottomY = pierPosition.y - pierScale.y * 0.5;
      const pierTopY = pierPosition.y + pierScale.y * 0.5;
      assert.ok(
        Math.abs(pierBottomY - expectedGroundY) <= instanceMatrixToleranceM,
        `Support ${index} shaft does not land on its sampled terrain`
      );
      assert.ok(
        Math.abs(footingPosition.x - pierPosition.x) <= instanceMatrixToleranceM
          && Math.abs(footingPosition.z - pierPosition.z) <= instanceMatrixToleranceM,
        `Support ${index} footing moved away from its shaft`
      );
      assert.ok(
        footingPosition.y - footingScale.y * 0.5 <= expectedGroundY
          && footingPosition.y + footingScale.y * 0.5 >= expectedGroundY,
        `Support ${index} footing no longer straddles the terrain surface`
      );

      localPierTop
        .set(pierPosition.x, pierTopY, pierPosition.z)
        .applyMatrix4(capMatrix.clone().invert());
      assert.ok(
        Math.abs(localPierTop.y - 0.5) <= instanceMatrixToleranceM
          && Math.abs(localPierTop.x) <= 0.5 + instanceMatrixToleranceM
          && Math.abs(localPierTop.z) <= 0.5 + instanceMatrixToleranceM,
        `Support ${index} shaft top is outside its real cap matrix: `
          + `${JSON.stringify(localPierTop.toArray())}`
      );
      maximumCapWidthM = Math.max(maximumCapWidthM, capScale.x);
    }

    // The previous symmetric formula produced 16.76m caps with a 14.42m unloaded outer arm. The repaired
    // single-sided transfer members remain below the ten-metre structural envelope across every production pier.
    assert.ok(maximumCapWidthM < 10, `Abnormally wide support cap remains: ${maximumCapWidthM}m`);
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});

test('real outward-facing petal-cap triangles retain finite contact at short and wide portal legs', () => {
  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  let material = null;
  try {
    visual = buildProductionVisual({ qualityProfileId: 'mobile' });
    material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
    const cap = new THREE.Mesh(visual.supportCaps.geometry, material);
    cap.matrixAutoUpdate = false;
    const ray = new THREE.Raycaster();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const pierTop = new THREE.Vector3();
    const capMatrix = new THREE.Matrix4();
    const pierMatrix = new THREE.Matrix4();
    const toleranceM = 0.000_01;
    const { composeRuntimeSupportRecord } = createRuntimeSupportRecordComposer();

    // Every closed stone primitive must present its nearest exterior wall under the actual FrontSide contract.
    // Manifold edge counts alone also accept an inside-out shell whose far interior is all that remains visible.
    for (const geometry of [visual.supports.geometry, visual.supportCaps.geometry]) {
      const stone = new THREE.Mesh(geometry, material);
      stone.updateMatrixWorld(true);
      for (const axis of [0, 1, 2]) {
        for (const side of [-1, 1]) {
          const origin = new THREE.Vector3().setComponent(axis, side * 2);
          ray.set(origin, origin.clone().normalize().negate());
          const hit = ray.intersectObject(stone)[0];
          assert.ok(
            hit && hit.point.getComponent(axis) * side > 0,
            `${geometry.userData.neonV23SkyRouteScenery.role}: axis ${axis}/${side} faces inward`
          );
        }
      }
    }

    /** Match production face culling: a unit box or DoubleSide ray hides recessed and inward-facing bearings. */
    function assertBearingContact(point, towardFace, label) {
      ray.set(point.clone().addScaledVector(towardFace, -0.01), towardFace);
      const hit = ray.intersectObject(cap)[0];
      assert.ok(hit, `${label}: the bearing face is absent`);
      assert.ok(
        hit.point.distanceTo(point) <= toleranceM,
        `${label}: the real bearing surface has a ${hit.point.distanceTo(point)}m seam`
      );
    }

    // Permanent single-column capitals use the upper face; portal crossbeams rest on their lower face.
    for (let index = 0; index < visual.supports.count; index++) {
      visual.supports.getMatrixAt(index, pierMatrix);
      visual.supportCaps.getMatrixAt(index * 2, capMatrix);
      pierTop.set(0, 0.5, 0).applyMatrix4(pierMatrix);
      cap.matrix.copy(capMatrix);
      cap.updateMatrixWorld(true);
      assertBearingContact(pierTop, worldUp.clone().negate(), `Permanent pier ${index}`);
    }

    let portalLegCount = 0;
    let bearingSampleCount = 0;
    for (const spanM of [12, 32, 83.48]) {
      for (const bankDegrees of [-10, 0, 10]) {
        for (const heading of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
          const bank = bankDegrees * Math.PI / 180;
          const tangent = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
          const flatRight = new THREE.Vector3(-Math.sin(heading), 0, Math.cos(heading));
          const right = flatRight.clone().multiplyScalar(Math.cos(bank))
            .addScaledVector(worldUp, Math.sin(bank));
          const up = worldUp.clone().multiplyScalar(Math.cos(bank))
            .addScaledVector(flatRight, -Math.sin(bank));
          const makeFrame = (lateral) => ({
            x: 100 + right.x * lateral,
            y: 20 + right.y * lateral,
            z: 50 + right.z * lateral,
            yaw: heading,
            tangentX: tangent.x, tangentY: tangent.y, tangentZ: tangent.z,
            rightX: right.x, rightY: right.y, rightZ: right.z,
            upX: up.x, upY: up.y, upZ: up.z,
            roadHalf: 8.4,
            supportLateral: lateral,
            supportGroundY: -1.18
          });
          const first = makeFrame(-spanM * 0.5);
          first.supportPairFrames = [first, makeFrame(spanM * 0.5)];
          const record = composeRuntimeSupportRecord(first, 'bearing-contact-fixture', 2_480);
          cap.matrix.copy(record.capMatrix);
          cap.updateMatrixWorld(true);
          for (const matrix of record.pierMatrices) {
            portalLegCount++;
            pierTop.set(0, 0.5, 0).applyMatrix4(matrix);
            // A 0.4m-long contact strip lies on both the real shaft top and the cap's bearing plane.
            // Sampling its ends prevents a pointed petal tip from passing with only one coincident axis hit.
            for (const longitudinalOffsetM of [-0.2, 0, 0.2]) {
              const samplePoint = pierTop.clone().addScaledVector(tangent, longitudinalOffsetM);
              assertBearingContact(samplePoint, worldUp, `${spanM}m/${bankDegrees}deg portal leg`);
              bearingSampleCount++;
            }
          }
        }
      }
    }
    assert.equal(portalLegCount, 72);
    assert.equal(bearingSampleCount, 216);
    assert.equal(visual.supportCaps.geometry.getAttribute('position').count, 98);
    assert.equal(visual.supportCaps.geometry.index.count / 3, 192);
    assert.deepEqual(indexedTopologyReport(visual.supportCaps.geometry), {
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      degenerateTriangleCount: 0
    });
    assertDeclaredLocalEnvelope(visual.supportCaps.geometry);
    assert.equal(visual.group.children.length, 19);
  } finally {
    material?.dispose();
    visual?.dispose();
    restoreDocument();
  }
});

test('runtime portal activation publishes both legs and removes every variant-owned matrix on switch', () => {
  const capacitySource = extractFunctionDeclaration('assertRuntimeSupportLayoutCapacity');
  const activateSource = extractFunctionDeclaration('activateRuntimeSupportLayout');
  const residentPiers = new Map();
  const residentCaps = new Map();
  const createResidentMesh = (residentMatrices) => ({
    count: 0,
    instanceMatrix: { needsUpdate: false },
    setMatrixAt(index, matrix) {
      residentMatrices.set(index, matrix);
    },
    computeBoundingSphere() {
      this.boundingSphereRefreshCount = (this.boundingSphereRefreshCount || 0) + 1;
    }
  });
  const supports = createResidentMesh(residentPiers);
  const supportCaps = createResidentMesh(residentCaps);
  const activation = new Function(
    'supports',
    'supportCaps',
    'supportCapacity',
    'permanentSupportCount',
    'permanentSupportCapCount',
    `${[
      'let supportIndex = permanentSupportCount;',
      'let supportCapIndex = permanentSupportCapCount;',
      'let activeRuntimeSupportLayout = null;',
      capacitySource,
      activateSource,
      'return Object.freeze({',
      '  activateRuntimeSupportLayout,',
      '  get activeLayout() { return activeRuntimeSupportLayout; }',
      '});'
    ].join('\n')}`
  )(supports, supportCaps, 8, 3, 14);
  const portalLayout = Object.freeze({
    records: Object.freeze([Object.freeze({
      pierMatrices: Object.freeze([
        new THREE.Matrix4().makeTranslation(10, 4, -30),
        new THREE.Matrix4().makeTranslation(10, 4, 30)
      ]),
      capMatrices: Object.freeze([
        new THREE.Matrix4().makeTranslation(10, 8, 0),
        new THREE.Matrix4().makeTranslation(10, 4, -8),
        new THREE.Matrix4().makeTranslation(10, 4, 8)
      ]),
      footingMatrices: Object.freeze([
        new THREE.Matrix4().makeTranslation(10, 0, -30),
        new THREE.Matrix4().makeTranslation(10, 0, 30)
      ])
    })])
  });

  activation.activateRuntimeSupportLayout(portalLayout);
  assert.equal(supports.count, 5);
  assert.equal(supportCaps.count, 19);
  assert.deepEqual([...residentPiers.keys()], [3, 4]);
  assert.deepEqual([...residentCaps.keys()], [14, 15, 16, 17, 18]);
  assert.equal(activation.activeLayout, portalLayout);

  supports.instanceMatrix.needsUpdate = false;
  supportCaps.instanceMatrix.needsUpdate = false;
  const emptyLayout = Object.freeze({ records: Object.freeze([]) });
  activation.activateRuntimeSupportLayout(emptyLayout);
  assert.equal(supports.count, 3, 'An empty route variant retained one or both portal legs in draw count');
  assert.equal(supportCaps.count, 14, 'An empty route variant retained a portal beam, hanger, or footing');
  assert.equal(supports.instanceMatrix.needsUpdate, true);
  assert.equal(supportCaps.instanceMatrix.needsUpdate, true);
  assert.equal(supports.boundingSphereRefreshCount, 2);
  assert.equal(supportCaps.boundingSphereRefreshCount, 2);
  assert.equal(activation.activeLayout, emptyLayout);
});

test('runtime support yields exactly 15 times before the sixteenth inactive-variant retry limit', () => {
  let queryCount = 0;
  const fixture = createRuntimeSupportFixture({
    queryRoadClearance(x, z) {
      queryCount++;
      return z === 0
        ? { clear: false, edgeId: 'inactive-repeat', clearance: -1 }
        : { clear: true, clearance: 3 };
    },
    getEdge(edgeId) {
      return edgeId === 'inactive-repeat'
        ? { id: edgeId, runtimeKind: 'recovery', tileIndex: 7 }
        : null;
    },
    composeRecord(frame, edgeId, edgeS) {
      return Object.freeze({ edgeId, edgeS, x: frame.x, z: frame.z, height: 9 });
    }
  });

  let complete = false;
  let resumeCount = 0;
  while (!complete) {
    const before = queryCount;
    complete = fixture.job.step(4);
    assert.ok(queryCount - before <= 1);
    resumeCount++;
  }
  const report = fixture.job.finish();
  assert.equal(queryCount, 17, 'Retry limit queried too few or too many times before the next lateral');
  assert.equal(report.clearanceRetryYieldCount, 15);
  assert.equal(report.placementCandidateCount, 2);
  assert.equal(report.plannerStepCount, 21);
  assert.equal(resumeCount, 21);
  assert.deepEqual(report.inactiveVariantIgnoredEdgeIds, ['inactive-repeat']);
  assert.deepEqual(report.stationsByEdge['runtime-edge'], [26]);
});

test('runtime support propagates clearance and compose failures by identity', () => {
  const clearanceError = new Error('runtime-clearance-failed');
  const clearanceFixture = createRuntimeSupportFixture({
    queryRoadClearance() { throw clearanceError; },
    composeRecord() { throw new Error('compose-must-not-run'); }
  });
  assert.equal(clearanceFixture.job.step(), false);
  assert.throws(() => clearanceFixture.job.step(), (error) => error === clearanceError);
  assert.throws(() => clearanceFixture.job.finish(), /not complete/);

  const composeError = new Error('runtime-compose-failed');
  const composeFixture = createRuntimeSupportFixture({
    queryRoadClearance() { return { clear: true, clearance: 2 }; },
    composeRecord() { throw composeError; }
  });
  assert.equal(composeFixture.job.step(), false);
  assert.throws(() => composeFixture.job.step(), (error) => error === composeError);
  assert.throws(() => composeFixture.job.finish(), /not complete/);
});

test('runtime support accepts only a raised endpoint-supported cable-stayed span within 420 metres', () => {
  const longSpanContract = Object.freeze({
    kind: 'cable-stayed-box-girder',
    maximumUnsupportedSpanM: 420,
    requireSupportedEndpoints: true,
    minimumDeckSurfaceY: 18
  });
  const accepted = inspectEndpointSupportedSpan({
    edgeLength: 389,
    deckY: 20,
    supportSpanContract: longSpanContract
  }).report;
  assert.equal(accepted.standardMaximumAllowedGap, 104.01);
  assert.equal(accepted.maximumAllowedGapByEdge['runtime-long-span-edge'], 420);
  assert.equal(accepted.maximumGap, 389);
  assert.equal(accepted.gapViolationCount, 0);
  assert.equal(accepted.designedLongSpanCount, 1);
  assert.deepEqual(accepted.stationsByEdge['runtime-long-span-edge'], [0, 389]);
  assert.deepEqual(
    {
      gap: accepted.designedLongSpans[0].gap,
      startSupported: accepted.designedLongSpans[0].startSupported,
      endSupported: accepted.designedLongSpans[0].endSupported,
      structureKind: accepted.designedLongSpans[0].structureKind,
      minimumSampledDeckSurfaceY: accepted.designedLongSpans[0].minimumSampledDeckSurfaceY
    },
    {
      gap: 389,
      startSupported: true,
      endSupported: true,
      structureKind: 'cable-stayed-box-girder',
      minimumSampledDeckSurfaceY: 20
    }
  );

  const ordinary = inspectEndpointSupportedSpan({
    edgeId: 'ordinary-runtime-edge',
    edgeLength: 389,
    deckY: 20
  }).report;
  assert.equal(ordinary.designedLongSpanCount, 0);
  assert.equal(ordinary.gapViolationCount, 1);
  assert.equal(ordinary.gapViolations[0].reason, 'missing-long-span-contract');
  assert.equal(ordinary.maximumAllowedGapByEdge['ordinary-runtime-edge'], 104.01);

  const missingEndpoint = inspectEndpointSupportedSpan({
    edgeId: 'missing-endpoint-edge',
    edgeLength: 389,
    deckY: 20,
    supportedEndpoints: [0],
    supportSpanContract: longSpanContract
  }).report;
  assert.equal(missingEndpoint.designedLongSpanCount, 0);
  assert.equal(missingEndpoint.gapViolationCount, 1);
  assert.equal(missingEndpoint.gapViolations[0].reason, 'missing-supported-endpoint');

  const lowDeck = inspectEndpointSupportedSpan({
    edgeId: 'low-deck-edge',
    edgeLength: 389,
    deckY: 17.5,
    supportSpanContract: longSpanContract
  }).report;
  assert.equal(lowDeck.designedLongSpanCount, 0);
  assert.equal(lowDeck.gapViolationCount, 1);
  assert.equal(lowDeck.gapViolations[0].reason, 'insufficient-deck-height');

  const overLimit = inspectEndpointSupportedSpan({
    edgeId: 'over-limit-edge',
    edgeLength: 421,
    deckY: 20,
    supportSpanContract: longSpanContract
  }).report;
  assert.equal(overLimit.maximumGap, 421);
  assert.equal(overLimit.designedLongSpanCount, 0);
  assert.equal(overLimit.gapViolationCount, 1);
  assert.equal(overLimit.gapViolations[0].reason, 'span-limit');
});

test('continuous box girder composes paired fascia and station diaphragms entirely inside the sealed deck', () => {
  const composeRuntimeLongSpanStructureMatrices = createRuntimeStructureComposer(768);
  const edge = Object.freeze({
    id: 'continuous-box-girder-fixture',
    length: 96,
    roadHalf: 6,
    supportSpanContract: Object.freeze({
      kind: 'continuous-box-girder',
      supportSpacingM: 88,
      fasciaSegmentM: 24,
      fasciaWidthM: 0.34,
      fasciaDepthM: 0.72,
      diaphragmDepthM: 0.20
    })
  });
  const runtimeTrack = {
    getEdge(edgeId) {
      return edgeId === edge.id ? edge : null;
    },
    sampleEdge(edgeId, edgeS, lateral) {
      assert.equal(edgeId, edge.id);
      return {
        x: edgeS,
        y: 20,
        z: lateral,
        tangentX: 1,
        tangentY: 0,
        tangentZ: 0,
        rightX: 0,
        rightY: 0,
        rightZ: 1,
        upX: 0,
        upY: 1,
        upZ: 0,
        roadHalf: 6
      };
    }
  };
  const matrices = composeRuntimeLongSpanStructureMatrices(runtimeTrack, {
    coverageByEdge: Object.freeze({ [edge.id]: Object.freeze([Object.freeze([0, 96])]) }),
    stationsByEdge: Object.freeze({ [edge.id]: Object.freeze([0, 48, 96]) }),
    designedLongSpans: Object.freeze([])
  });

  assert.equal(matrices.length, 11, 'Four paired fascia bays plus three diaphragms must share one batch');
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let fasciaCount = 0;
  let diaphragmCount = 0;
  let minimumStructureY = Number.POSITIVE_INFINITY;
  let maximumStructureY = Number.NEGATIVE_INFINITY;
  for (const matrix of matrices) {
    matrix.decompose(position, quaternion, scale);
    minimumStructureY = Math.min(minimumStructureY, position.y - scale.y * 0.5);
    maximumStructureY = Math.max(maximumStructureY, position.y + scale.y * 0.5);
    if (
      Math.abs(scale.x - 0.34) <= 0.000_001
      && Math.abs(scale.y - 0.72) <= 0.000_001
      && Math.abs(scale.z - 24.12) <= 0.000_001
    ) fasciaCount++;
    if (
      Math.abs(scale.x - 12.36) <= 0.000_001
      && Math.abs(scale.y - 0.20) <= 0.000_001
      && Math.abs(scale.z - 0.62) <= 0.000_001
    ) diaphragmCount++;
  }
  assert.equal(fasciaCount, 8);
  assert.equal(diaphragmCount, 3);
  assert.ok(Math.abs(minimumStructureY - (20 - 0.92)) <= 0.000_001);
  assert.ok(maximumStructureY <= 20 + 0.000_001);
});

test('runtime long-span composition physically joins endpoint supports, deep girders, and pylons below the road', () => {
  const composeRuntimeLongSpanStructureMatrices = createRuntimeStructureComposer(256);
  const edge = Object.freeze({
    id: 'composed-long-span-edge',
    length: 600,
    roadHalf: 6,
    supportSpanContract: Object.freeze({
      kind: 'cable-stayed-box-girder',
      maximumUnsupportedSpanM: 420,
      girderDepthM: 2,
      girderSegmentM: 16,
      pylonHeightRatio: 0.09,
      minimumPylonHeightM: 28,
      maximumPylonHeightM: 36,
      stayPanelM: 32,
      backStayCount: 1
    })
  });
  const runtimeTrack = {
    getEdge(edgeId) {
      return edgeId === edge.id ? edge : null;
    },
    sampleEdge(edgeId, edgeS, lateral) {
      assert.equal(edgeId, edge.id);
      return {
        x: edgeS,
        y: 20,
        z: lateral,
        tangentX: 1,
        tangentY: 0,
        tangentZ: 0,
        rightX: 0,
        rightY: 0,
        rightZ: 1,
        upX: 0,
        upY: 1,
        upZ: 0,
        roadHalf: 6
      };
    }
  };
  const endpointSupports = Object.freeze([
    Object.freeze({ edgeId: edge.id, edgeS: 100, x: 100, z: -10.62 }),
    Object.freeze({ edgeId: edge.id, edgeS: 489, x: 489, z: 10.62 })
  ]);
  const matrices = composeRuntimeLongSpanStructureMatrices(runtimeTrack, {
    records: endpointSupports,
    designedLongSpans: [{
      edgeId: edge.id,
      startS: 100,
      endS: 489,
      gap: 389,
      structureKind: 'cable-stayed-box-girder'
    }]
  });
  assert.ok(matrices.length > 0);
  assert.ok(matrices.length <= 256);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const forward = new THREE.Vector3();
  let deepGirderCount = 0;
  let endpointTransferBeamCount = 0;
  let verticalPylonCount = 0;
  let diagonalStayCount = 0;
  const endpointTransferBeams = [];
  const pylons = [];
  for (const matrix of matrices) {
    matrix.decompose(position, quaternion, scale);
    if (Math.abs(scale.x - 0.62) <= 0.000_001
      && Math.abs(scale.y - 2) <= 0.000_001
      && scale.z > 10) {
      deepGirderCount++;
    }
    if (Math.abs(scale.y - 1.2) <= 0.000_001
      && Math.abs(scale.z - 1.4) <= 0.000_001) {
      endpointTransferBeamCount++;
      endpointTransferBeams.push({
        x: position.x,
        y: position.y,
        z: position.z,
        width: scale.x,
        height: scale.y,
        depth: scale.z
      });
    }
    if (Math.abs(scale.x - 0.92) <= 0.000_001
      && scale.y > 28
      && Math.abs(scale.z - 0.92) <= 0.000_001
      && quaternion.angleTo(new THREE.Quaternion()) <= 0.000_001) {
      verticalPylonCount++;
      pylons.push({
        x: position.x,
        y: position.y,
        z: position.z,
        width: scale.x,
        height: scale.y,
        depth: scale.z
      });
    }
    if ((Math.abs(scale.x - 0.11) <= 0.000_001 || Math.abs(scale.x - 0.10) <= 0.000_001)
      && Math.abs(scale.x - scale.y) <= 0.000_001) {
      forward.set(0, 0, 1).applyQuaternion(quaternion);
      if (Math.abs(forward.y) > 0.1 && Math.abs(forward.y) < 0.95) diagonalStayCount++;
    }
  }
  assert.equal(deepGirderCount, 50, 'A 389m span lost one of its paired segmented deep box girders');
  assert.equal(endpointTransferBeamCount, 2, 'Each supported span endpoint needs one continuous transfer beam');
  assert.equal(verticalPylonCount, 4, 'Each supported endpoint needs paired world-vertical pylons');
  assert.ok(diagonalStayCount >= 20, 'The two pylon pairs lost their fan and back-stay directions');

  for (const beam of endpointTransferBeams) {
    const beamMinimumLateral = beam.z - beam.width * 0.5;
    const beamMaximumLateral = beam.z + beam.width * 0.5;
    const beamMinimumY = beam.y - beam.height * 0.5;
    const beamMaximumY = beam.y + beam.height * 0.5;
    assert.ok(
      beamMaximumY <= 20 - 0.8,
      'An endpoint transfer beam escaped the solid deck and entered the driveable road corridor'
    );
    const endpointSupport = endpointSupports.find(
      (record) => Math.abs(record.x - beam.x) <= beam.depth * 0.5
    );
    assert.ok(endpointSupport, 'An endpoint transfer beam lost its route-owned support record');
    assert.ok(
      endpointSupport.z - 0.5 < beamMaximumLateral
        && endpointSupport.z + 0.5 > beamMinimumLateral,
      'An endpoint support column does not overlap its transfer beam laterally'
    );
    assert.ok(
      20 - 0.92 < beamMaximumY && 20 - 0.92 > beamMinimumY,
      'An endpoint support column does not overlap its transfer beam vertically'
    );
    const endpointPylons = pylons.filter(
      (pylon) => Math.abs(pylon.x - beam.x) <= beam.depth * 0.5 + pylon.depth * 0.5
    );
    assert.equal(endpointPylons.length, 2, 'An endpoint transfer beam lost one of its paired tower feet');
    for (const pylon of endpointPylons) {
      const pylonMinimumY = pylon.y - pylon.height * 0.5;
      assert.ok(
        pylon.z - pylon.width * 0.5 < beamMaximumLateral
          && pylon.z + pylon.width * 0.5 > beamMinimumLateral,
        'A tower foot does not overlap its endpoint transfer beam laterally'
      );
      assert.ok(
        pylonMinimumY < beamMaximumY && pylon.y + pylon.height * 0.5 > beamMinimumY,
        'A tower foot does not overlap its endpoint transfer beam vertically'
      );
    }
    for (const girderLateral of [-5.52, 5.52]) {
      assert.ok(
        girderLateral - 0.31 < beamMaximumLateral
          && girderLateral + 0.31 > beamMinimumLateral,
        'An endpoint transfer beam no longer reaches one of the paired deep box girders'
      );
      assert.ok(
        20 - 0.92 - 2 < beamMaximumY && 20 - 0.92 > beamMinimumY,
        'An endpoint transfer beam no longer overlaps a deep box girder vertically'
      );
    }
  }
});

test('runtime long-span activation restores the permanent mesh count when switching to an empty variant', () => {
  const capacitySource = extractFunctionDeclaration('assertRuntimeRouteStructureCapacity');
  const activateSource = extractFunctionDeclaration('activateRuntimeLongSpanStructures');
  const residentMatrices = new Map();
  const structuralDetails = {
    count: 0,
    instanceMatrix: { count: 263, needsUpdate: false },
    setMatrixAt(index, matrix) {
      residentMatrices.set(index, matrix);
    },
    computeBoundingSphere() {
      this.boundingSphereRefreshCount = (this.boundingSphereRefreshCount || 0) + 1;
    }
  };
  const activation = new Function(
    'structuralDetails',
    'permanentStructuralDetailCount',
    'capacity',
    `${[
      'const RUNTIME_LONG_SPAN_STRUCTURE_CAPACITY = capacity;',
      'let activeRuntimeLongSpanStructureCount = 0;',
      capacitySource,
      activateSource,
      'return Object.freeze({',
      '  activateRuntimeLongSpanStructures,',
      '  get activeCount() { return activeRuntimeLongSpanStructureCount; }',
      '});'
    ].join('\n')}`
  )(structuralDetails, 7, 256);
  const matrices = [new THREE.Matrix4(), new THREE.Matrix4().makeTranslation(12, 5, -3)];

  activation.activateRuntimeLongSpanStructures(matrices);
  assert.equal(activation.activeCount, 2);
  assert.equal(structuralDetails.count, 9);
  assert.deepEqual([...residentMatrices.keys()], [7, 8]);
  assert.equal(structuralDetails.instanceMatrix.needsUpdate, true);

  structuralDetails.instanceMatrix.needsUpdate = false;
  activation.activateRuntimeLongSpanStructures([]);
  assert.equal(activation.activeCount, 0);
  assert.equal(structuralDetails.count, 7, 'An empty route variant retained hidden long-span instances in draw count');
  assert.equal(structuralDetails.instanceMatrix.needsUpdate, true);
  assert.equal(structuralDetails.boundingSphereRefreshCount, 2);
});

test('all entry and movement families reserve the larger normal decision topology for opposing recovery', () => {
  const decisionCount = (graph) => graph.nodes.filter((node) => (
    node.kind === 'decision' || node.kind === 'collector-decision'
  )).length;
  const goreRequirement = (graph) => {
    const branchesByDecision = new Map();
    for (const edge of graph.edges) {
      if (edge.family !== 'straight-fork-branch' || !edge.decisionNodeId) continue;
      if (!branchesByDecision.has(edge.decisionNodeId)) branchesByDecision.set(edge.decisionNodeId, []);
      branchesByDecision.get(edge.decisionNodeId).push(edge);
    }
    return graph.nodes
      .filter((node) => node.kind === 'decision' || node.kind === 'collector-decision')
      .reduce((count, node) => {
        if (node.decisionType !== 'straight-fork') return count + 1;
        const branches = branchesByDecision.get(node.id) || [];
        return count + (
          branches.some((edge) => edge.forkSide === 'left')
          && branches.some((edge) => edge.forkSide === 'right')
            ? 2
            : 0
        );
      }, 0);
  };

  for (const entryPort of ['south', 'west', 'north', 'east']) {
    for (const kind of ['straight', 'right', 'left']) {
      const residentPlan = productionTrack.createPathPlan({ entryPort, kind });
      const residentTile = residentPlan.tiles[1];
      const residentGraph = cloverleafTilePool.graphForTile(
        productionTrack,
        residentTile,
        residentPlan,
        { includeRecovery: true }
      );
      const opposingPlan = productionTrack.prepareOpposingRecoveryPathPlan(residentPlan, residentTile);
      const opposingTile = opposingPlan.tiles.find((tile) => tile.token === residentTile.token);
      const opposingGraph = cloverleafTilePool.graphForTile(
        productionTrack,
        opposingTile,
        opposingPlan,
        { includeRecovery: true }
      );
      const label = `${entryPort}:${kind}`;

      assert.equal(decisionCount(residentGraph), 9, `${label} normal decision count drifted`);
      assert.equal(decisionCount(opposingGraph), 8, `${label} opposing decision count drifted`);
      assert.equal(goreRequirement(residentGraph), 10, `${label} normal gore count drifted`);
      assert.equal(goreRequirement(opposingGraph), 8, `${label} opposing gore count drifted`);
      assert.equal(opposingGraph.contract.decisionStructureNodeCapacity, 9, `${label} node capacity shrank`);
      assert.equal(opposingGraph.contract.goreNoseCapacity, 10, `${label} gore capacity shrank`);
    }
  }
});

test('largest opposing crossover atomically fits continuous structure and decision capacities in both directions', () => {
  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  try {
    const residentPlan = productionTrack.createPathPlan({
      // West/east keep the complete crossover elevated and therefore exercise the 546-instance active worst case.
      movementId: 'west-straight',
      futureMovementKind: 'straight'
    });
    const residentTile = residentPlan.tiles[1];
    const residentGraph = cloverleafTilePool.graphForTile(
      productionTrack,
      residentTile,
      residentPlan,
      { includeRecovery: true }
    );
    const opposingPlan = productionTrack.prepareOpposingRecoveryPathPlan(residentPlan, residentTile);
    const opposingTile = opposingPlan.tiles.find((tile) => tile.token === residentTile.token);
    const opposingGraph = cloverleafTilePool.graphForTile(
      productionTrack,
      opposingTile,
      opposingPlan,
      { includeRecovery: true }
    );
    const decisionCount = (graph) => graph.nodes.filter((node) => (
      node.kind === 'decision' || node.kind === 'collector-decision'
    )).length;

    assert.equal(decisionCount(residentGraph), 9);
    assert.equal(
      decisionCount(opposingGraph),
      8,
      'The opposing crossover fixture must retain the production one-node cardinality reduction'
    );
    assert.equal(residentGraph.contract.decisionStructureNodeCapacity, 9);
    assert.equal(opposingGraph.contract.decisionStructureNodeCapacity, 9);
    assert.equal(residentGraph.contract.goreNoseCapacity, 10);
    assert.equal(opposingGraph.contract.goreNoseCapacity, 10);
    const residentTrack = createScopedVisualTrack(residentGraph);
    visual = buildProductionVisual({ track: residentTrack });
    const retainedRouteBlockers = visual.getCameraBlockers();
    const retainedRouteBlockerReferences = [...retainedRouteBlockers];
    const visibleBlockersForMesh = (meshName) => retainedRouteBlockers.filter(
      (blocker) => blocker.visible && blocker.meshName === meshName
    ).length;
    const visibleBlockersOfKind = (kind) => retainedRouteBlockers.filter(
      (blocker) => blocker.visible && blocker.kind === kind
    ).length;
    const variantTrack = createScopedVisualTrack(opposingGraph);
    const signature = opposingGraph.recoveryVariantSignature;
    const variantJob = visual.createRecoveryVariantJob({ track: variantTrack, signature });
    let variantSteps = 0;
    while (!variantJob.step(4)) {
      variantSteps++;
      assert.ok(variantSteps < 10_000, 'Opposing recovery variant preparation stalled');
    }
    const preparedVariant = variantJob.finish();
    assert.equal(visual.installRecoveryVariant(preparedVariant), true);
    const portalCapMesh = new THREE.Mesh(visual.supportCaps.geometry, visual.supportCaps.material);
    portalCapMesh.matrixAutoUpdate = false;
    const portalBearingRay = new THREE.Raycaster();
    const portalBearingUp = new THREE.Vector3(0, 1, 0);
    let checkedPortalLegCount = 0;
    for (const record of preparedVariant.template.supportLayout.records) {
      if (record.supportKind !== 'route-exterior-portal') continue;
      portalCapMesh.matrix.copy(record.capMatrix);
      portalCapMesh.updateMatrixWorld(true);
      for (const matrix of record.pierMatrices) {
        const shaftTop = new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix);
        portalBearingRay.set(shaftTop.clone().addScaledVector(portalBearingUp, -0.01), portalBearingUp);
        const hit = portalBearingRay.intersectObject(portalCapMesh)[0];
        assert.ok(
          hit && hit.point.distanceTo(shaftTop) <= 0.000_01,
          `${record.edgeId}@${record.edgeS}: real portal triangles detach from their support shaft`
        );
        checkedPortalLegCount++;
      }
    }
    assert.equal(checkedPortalLegCount, 6, 'The real opposing route no longer exercises its three portal bents');
    const sourceDecision = opposingGraph.nodes.find((node) => node.kind === 'decision');
    const overflowTrack = Object.freeze({
      ...variantTrack,
      graph: Object.freeze({
        ...opposingGraph,
        nodes: Object.freeze([
          ...opposingGraph.nodes,
          Object.freeze({ ...sourceDecision, id: 'overflow-decision-a' }),
          Object.freeze({ ...sourceDecision, id: 'overflow-decision-b' })
        ])
      })
    });
    const residentRecoveryGeometry = visual.recoveryRoadShell.geometry;
    const residentGoreCount = visual.goreNoses.count;
    const residentSignature = visual.diagnostics.activeRecoverySignature;
    assert.throws(
      () => visual.activateRecoveryVariant(signature, opposingGraph, overflowTrack),
      /exceeds the reserved decision-structure capacity/
    );
    assert.equal(
      visual.recoveryRoadShell.geometry,
      residentRecoveryGeometry,
      'A rejected over-capacity variant swapped road geometry before validation'
    );
    assert.equal(visual.goreNoses.count, residentGoreCount);
    assert.equal(visual.diagnostics.activeRecoverySignature, residentSignature);
    assert.doesNotThrow(
      () => visual.activateRecoveryVariant(signature, opposingGraph, variantTrack),
      'A valid opposing jump landing must not be rejected because it intentionally has no straight-fork node'
    );
    assert.equal(visual.diagnostics.activeRecoverySignature, signature);
    assert.equal(visual.diagnostics.activeDecisionStructureNodeCount, 8);
    assert.equal(visual.diagnostics.decisionPylonCount, 16);
    assert.equal(visual.diagnostics.decisionPylonCapacity, 18);
    assert.equal(visual.goreNoses.count, 8);
    assert.equal(visual.diagnostics.goreCapacity, 10);
    assert.equal(visual.diagnostics.runtimeLongSpanStructureInstanceCount, 546);
    assert.equal(visual.diagnostics.runtimeLongSpanStructureCapacity, 768);
    assert.equal(visual.getCameraBlockers(), retainedRouteBlockers);
    assert.equal(visibleBlockersOfKind('runtime-long-span-structure'), 546);
    assert.equal(visibleBlockersOfKind('physical-gore-nose'), 8);
    assert.equal(visibleBlockersOfKind('wind-eroded-decision-pylon'), 16);
    assert.equal(visibleBlockersForMesh(visual.supports.name), visual.supports.count);
    assert.equal(visibleBlockersForMesh(visual.supportCaps.name), visual.supportCaps.count);
    assert.equal(
      visibleBlockersForMesh(visual.structuralDetails.name),
      visual.structuralDetails.count - visual.diagnostics.decisionPylonCapacity
    );
    for (let index = 0; index < retainedRouteBlockers.length; index++) {
      assert.equal(
        retainedRouteBlockers[index],
        retainedRouteBlockerReferences[index],
        'Variant publication replaced a retained Film blocker record'
      );
    }
    assert.equal(visual.diagnostics.designedLongSpanCount, 0);
    assert.equal(visual.diagnostics.elevatedSupportMaximumAllowedGap, 176.01);
    assert.ok(
      visual.diagnostics.elevatedSupportMaximumGap
        <= visual.diagnostics.elevatedSupportMaximumAllowedGap,
      'The active 88m crossover rhythm exceeded its edge-owned two-bay limit'
    );

    for (let offset = 1; offset <= 2; offset++) {
      const hiddenPylonMatrix = new THREE.Matrix4();
      const hiddenReflectorMatrix = new THREE.Matrix4();
      visual.structuralDetails.getMatrixAt(
        visual.diagnostics.structuralDetailCount - offset,
        hiddenPylonMatrix
      );
      visual.underpassLights.getMatrixAt(
        visual.underpassLights.count - offset,
        hiddenReflectorMatrix
      );
      assert.equal(hiddenPylonMatrix.determinant(), 0, 'Removed straight-fork pylons remained visible');
      assert.equal(hiddenReflectorMatrix.determinant(), 0, 'Removed straight-fork reflectors remained visible');
    }

    assert.equal(
      visual.activateRecoveryVariant(
        residentGraph.recoveryVariantSignature,
        residentGraph,
        residentTrack
      ),
      true
    );
    assert.equal(visual.diagnostics.activeDecisionStructureNodeCount, 9);
    assert.equal(visual.diagnostics.decisionPylonCount, 18);
    assert.equal(visual.goreNoses.count, 10);
    assert.equal(visual.diagnostics.runtimeLongSpanStructureInstanceCount, 0);
    assert.equal(visibleBlockersOfKind('runtime-long-span-structure'), 0);
    assert.equal(visibleBlockersOfKind('physical-gore-nose'), 10);
    assert.equal(visibleBlockersOfKind('wind-eroded-decision-pylon'), 18);
    for (let offset = 1; offset <= 2; offset++) {
      const restoredPylonMatrix = new THREE.Matrix4();
      const restoredReflectorMatrix = new THREE.Matrix4();
      visual.structuralDetails.getMatrixAt(
        visual.diagnostics.structuralDetailCount - offset,
        restoredPylonMatrix
      );
      visual.underpassLights.getMatrixAt(
        visual.underpassLights.count - offset,
        restoredReflectorMatrix
      );
      assert.notEqual(restoredPylonMatrix.determinant(), 0, 'Straight-fork pylon slot did not restore');
      assert.notEqual(restoredReflectorMatrix.determinant(), 0, 'Straight-fork reflector slot did not restore');
    }

    visual.update({ visible: false });
    const hiddenVariantSweepCount = visual.diagnostics.routeCameraBlockerVisibilitySweepCount;
    assert.equal(visual.activateRecoveryVariant(signature, opposingGraph, variantTrack), true);
    assert.equal(retainedRouteBlockers.some((blocker) => blocker.visible), false);
    visual.update({ visible: false });
    assert.equal(visual.diagnostics.routeCameraBlockerVisibilitySweepCount, hiddenVariantSweepCount);
    visual.update({ origin: { x: 800, z: -400 }, time: 250, visible: true });
    assert.equal(visual.diagnostics.routeCameraBlockerVisibilitySweepCount, hiddenVariantSweepCount + 1);
    assert.equal(visibleBlockersForMesh(visual.supports.name), visual.supports.count);
    assert.equal(visibleBlockersForMesh(visual.supportCaps.name), visual.supportCaps.count);
    assert.equal(visibleBlockersOfKind('wind-eroded-decision-pylon'), visual.diagnostics.decisionPylonCount);
    assert.equal(visibleBlockersOfKind('physical-gore-nose'), visual.goreNoses.count);

    visual.dispose();
    visual = null;
    visual = buildProductionVisual({ track: variantTrack });
    assert.equal(visual.diagnostics.activeDecisionStructureNodeCount, 8);
    assert.equal(visual.diagnostics.decisionPylonCount, 16);
    assert.equal(visual.diagnostics.decisionStructureNodeCapacity, 9);
    assert.equal(visual.diagnostics.goreCapacity, 10);
    assert.equal(visual.diagnostics.runtimeLongSpanStructureInstanceCount, 546);
    assert.equal(visual.diagnostics.runtimeLongSpanStructureCapacity, 768);
    const residentVariantJob = visual.createRecoveryVariantJob({
      track: residentTrack,
      signature: residentGraph.recoveryVariantSignature
    });
    let residentVariantSteps = 0;
    while (!residentVariantJob.step(4)) {
      residentVariantSteps++;
      assert.ok(residentVariantSteps < 10_000, 'Normal recovery variant preparation stalled');
    }
    assert.equal(visual.installRecoveryVariant(residentVariantJob.finish()), true);
    assert.doesNotThrow(
      () => visual.activateRecoveryVariant(
        residentGraph.recoveryVariantSignature,
        residentGraph,
        residentTrack
      ),
      'An opposing-base resident must reserve enough decision and gore slots for the larger normal route'
    );
    assert.equal(visual.diagnostics.activeDecisionStructureNodeCount, 9);
    assert.equal(visual.diagnostics.decisionPylonCount, 18);
    assert.equal(visual.goreNoses.count, 10);
    assert.equal(visual.diagnostics.runtimeLongSpanStructureInstanceCount, 0);
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});

test('road, tunnel enclosure, structural traffic, and transparent overlays retain physical shadow contracts', () => {
  const generatorStart = source.indexOf('function* createGenerator(options)');
  const generatorEnd = source.indexOf('function createBuildJob(options)', generatorStart);
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
  const generatorSource = source.slice(generatorStart, generatorEnd);
  const roadMaterialSource = generatorSource.slice(
    generatorSource.indexOf('const roadMaterial ='),
    generatorSource.indexOf('const edgeMaterial =')
  );
  const tunnelAllocationSource = generatorSource.slice(
    generatorSource.indexOf('const underpassLightMaterial ='),
    generatorSource.indexOf("yield 'bridge-mesh-allocation'")
  );
  const paletteSource = generatorSource.slice(
    generatorSource.indexOf('function setPalette('),
    generatorSource.indexOf('const opaqueShadowMeshes =')
  );

  assert.match(roadMaterialSource, /new THREE\.MeshPhysicalMaterial\(\{/);
  assert.match(roadMaterialSource, /metalness: 0,/);
  assert.match(roadMaterialSource, /clearcoat: 0,/);
  assert.doesNotMatch(roadMaterialSource, /emissive/);
  assert.match(paletteSource, /roadMaterial\.clearcoat = clamp\(exposedWetness \* 0\.74/);
  assert.match(paletteSource, /roadMaterial\.clearcoatRoughness = clamp\(/);
  assert.match(paletteSource, /roadMaterial\.metalness = 0;/);
  assert.match(paletteSource, /lowRoadMaterial\.color\.copy\(roadMaterial\.color\);/);
  assert.match(paletteSource, /lowRoadMaterial\.roughness = roadMaterial\.roughness;/);
  assert.match(paletteSource, /lowRoadMaterial\.metalness = 0;/);
  assert.match(paletteSource, /lowRoadMaterial\.clearcoat = roadMaterial\.clearcoat;/);
  assert.doesNotMatch(paletteSource, /roadMaterial\.emissive/);
  assert.doesNotMatch(paletteSource, /lowRoadMaterial\.emissive/);

  assert.match(tunnelAllocationSource, /const tunnelShells = new THREE\.Mesh\(tunnelShellGeometry, tunnelShellMaterial\);/);
  assert.match(
    tunnelAllocationSource,
    /const tunnelShellMaterial = markSkyRouteMaterial\(new THREE\.MeshPhysicalMaterial\(\{/
  );
  assert.match(tunnelAllocationSource, /vertexColors: true,/);
  assert.match(tunnelAllocationSource, /tunnelShells\.castShadow = true;/);
  assert.match(tunnelAllocationSource, /tunnelShells\.receiveShadow = true;/);
  assert.doesNotMatch(tunnelAllocationSource, /tunnelWallCapacity|undergroundWalls/);
  assert.doesNotMatch(generatorSource, /installDetailBox\(\s*undergroundWalls|undergroundWallIndex\+\+/);
  assert.doesNotMatch(generatorSource, /const beamMaterial = qualityProfile\?\.id === 'mobile'/);

  for (const meshName of [
    'roadShell',
    'recoveryRoadShell',
    'supports',
    'supportCaps',
    'beams',
    'tunnelShells',
    'structuralDetails',
    'goreNoses',
    'traffic'
  ]) {
    assert.match(generatorSource, new RegExp(`${meshName}\\.castShadow = true;`));
    assert.match(generatorSource, new RegExp(`${meshName}\\.receiveShadow = true;`));
  }
  assert.match(generatorSource, /markShadowExempt\(\s*underpassLights,/);
  assert.match(generatorSource, /markShadowExempt\(roadArrows,/);
  assert.match(generatorSource, /transparentShadowExemptionViolationCount/);
});

test('Sky route scenery v2 freezes wind-stone topology, unit envelopes, matte finishes, and constant candle-stars', () => {
  const contract = cloverleafVisuals.skyRouteSceneryContract;
  assertDeepFrozen(contract, 'skyRouteSceneryContract');
  assert.equal(contract.version, 2);
  assert.match(contract.intent.zhCN, /风蚀暖石/);
  assert.match(contract.intent.zhCN, /花瓣与菱形柱冠/);
  assert.match(contract.intent.zhCN, /恒亮烛星/);
  assert.match(contract.intent.en, /wind-eroded warm stone/i);
  assert.match(contract.intent.en, /petal-diamond capitals/i);
  assert.match(contract.intent.en, /constant candle-stars/i);
  assert.deepEqual(contract.materials, {
    family: 'matte-warm-dielectric-stone',
    maximumMetalness: 0.03,
    minimumRoughness: 0.78,
    maximumClearcoat: 0.04,
    chromeAllowed: false,
    steelTrussAllowed: false,
    baseStructureEmissiveAllowed: false,
    luminaireDiffuserOnlyEmissive: true
  });
  assert.deepEqual(contract.lighting, {
    fixture: 'paired-candle-star',
    powerMode: 'constant-on',
    distanceGated: false,
    approachSensorAllowed: false,
    stationAuthority: 'authored-route-profile',
    additionalDrawGroupCount: 0,
    additionalObjectCount: 0
  });
  assert.equal(contract.invariants.roadGeometryAuthority, 'unchanged-track-graph');
  assert.equal(contract.invariants.collisionAuthority, 'unchanged-sampleEdge-and-road-clearance');
  assert.equal(contract.invariants.instanceCapacity, 'unchanged-prepared-batches');
  assert.equal(contract.invariants.clearanceAuthority, 'unchanged-proven-instance-matrices');
  assert.equal(contract.invariants.runtimeAllocation, 'no-per-frame-scenery-allocation');

  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  try {
    visual = buildProductionVisual({ qualityProfileId: 'desktop' });
    assert.equal(visual.diagnostics.skyRouteSceneryContractVersion, 2);
    assert.equal(
      visual.diagnostics.skyRouteSceneryMaterialFamily,
      contract.materials.family
    );
    assert.equal(
      visual.diagnostics.skyRouteSceneryRuntimeAllocation,
      contract.invariants.runtimeAllocation
    );

    const geometryCases = [
      {
        mesh: visual.supports,
        role: 'wind-eroded-bridge-pier',
        spec: contract.geometry.pier,
        expectedVertexCount:
          contract.geometry.pier.profileRingCount * contract.geometry.pier.radialSegments + 2
      },
      {
        mesh: visual.supportCaps,
        role: 'petal-diamond-capital-and-foundation',
        spec: contract.geometry.capitalAndFoundation,
        expectedVertexCount:
          contract.geometry.capitalAndFoundation.outlinePointCount
            * contract.geometry.capitalAndFoundation.axialRingCount + 2
      },
      {
        mesh: visual.beams,
        role: 'carved-warm-stone-portal-and-rib',
        spec: contract.geometry.portalAndRib,
        expectedVertexCount:
          contract.geometry.portalAndRib.outlinePointCount
            * contract.geometry.portalAndRib.axialRingCount + 2
      },
      {
        mesh: visual.underpassLights,
        role: 'constant-on-candle-star-diffuser',
        spec: contract.geometry.candleStar,
        expectedVertexCount:
          contract.geometry.candleStar.outlinePointCount
            * contract.geometry.candleStar.axialRingCount + 2
      }
    ];
    for (const { mesh, role, spec, expectedVertexCount } of geometryCases) {
      const metadata = mesh.geometry.userData.neonV23SkyRouteScenery;
      assert.equal(metadata.contractVersion, 2);
      assert.equal(metadata.role, role);
      assert.equal(metadata.topology, spec.topology);
      assert.equal(mesh.geometry.getAttribute('position').count, expectedVertexCount);
      assert.deepEqual(indexedTopologyReport(mesh.geometry), {
        boundaryEdgeCount: 0,
        nonManifoldEdgeCount: 0,
        degenerateTriangleCount: 0
      });
      assertDeclaredLocalEnvelope(mesh.geometry);
    }

    const pierBox = visual.supports.geometry.boundingBox;
    assert.ok(Math.abs(pierBox.max.x - visual.diagnostics.bridgePierRadius) <= 0.000_001);
    assert.ok(Math.abs(pierBox.max.z - visual.diagnostics.bridgePierRadius) <= 0.000_001);
    assert.equal(contract.geometry.pier.radiusScaleMaximum, 1);

    const tunnelMetadata = visual.tunnelShells.geometry.userData.neonV23SkyRouteScenery;
    assert.equal(tunnelMetadata.contractVersion, 2);
    assert.equal(tunnelMetadata.role, 'continuous-wind-eroded-tunnel-shell');
    assert.equal(tunnelMetadata.topology, contract.geometry.tunnelShell.topology);
    assert.ok(visual.tunnelShells.geometry.index?.count > 0);
    assert.equal(visual.diagnostics.tunnelShellSharedLongitudinalRows, true);
    assert.equal(visual.diagnostics.tunnelSafeCorridorViolationCount, 0);
    assert.ok(visual.diagnostics.tunnelShellMaximumRoadJoinGapM <= 0.000_001);
    assert.ok(visual.diagnostics.tunnelShellMaximumRoadJoinPenetrationM <= 0.000_001);
    const tunnelColors = visual.tunnelShells.geometry.getAttribute('color');
    const distinctTunnelColors = new Set();
    for (let index = 0; index < tunnelColors.count; index++) {
      distinctTunnelColors.add([
        tunnelColors.getX(index).toFixed(4),
        tunnelColors.getY(index).toFixed(4),
        tunnelColors.getZ(index).toFixed(4)
      ].join(':'));
    }
    assert.ok(distinctTunnelColors.size > 16, 'Tunnel shell lost its bounded wind-stone patina');

    const structuralMeshes = [
      visual.supports,
      visual.supportCaps,
      visual.beams,
      visual.tunnelShells,
      visual.structuralDetails
    ];
    const preparedCapacities = Object.freeze(structuralMeshes.map((mesh) => (
      mesh.isInstancedMesh ? mesh.instanceMatrix.count : null
    )));
    const reservedDrawGroupCount = visual.group.children.length;
    const sceneryMaterials = new Set([visual.underpassLights.material]);
    for (const renderQualityId of ['low', 'medium', 'high', 'medium']) {
      visual.setRenderQuality(renderQualityId);
      assert.equal(visual.group.children.length, reservedDrawGroupCount);
      assert.deepEqual(
        structuralMeshes.map((mesh) => (mesh.isInstancedMesh ? mesh.instanceMatrix.count : null)),
        preparedCapacities
      );
      for (const mesh of structuralMeshes) {
        const material = mesh.material;
        sceneryMaterials.add(material);
        const metadata = material.userData.neonV23SkyRouteScenery;
        assert.equal(metadata.contractVersion, 2, `${mesh.name} lost its scenery material tag`);
        assert.equal(metadata.family, contract.materials.family);
        assert.ok(material.roughness >= contract.materials.minimumRoughness);
        assert.ok((Number(material.metalness) || 0) <= contract.materials.maximumMetalness);
        assert.ok((Number(material.clearcoat) || 0) <= contract.materials.maximumClearcoat);
        assert.equal(material.emissive?.getHex() || 0, 0);
        assert.equal(Number(material.emissiveIntensity) || 0, 0);
      }
    }

    assert.equal(
      visual.underpassLights.material.userData.neonV23.kind,
      'constant-on-candle-star-diffuser'
    );
    assert.equal(visual.diagnostics.tunnelLuminairePowerMode, contract.lighting.powerMode);
    assert.equal(visual.diagnostics.tunnelLuminaireDistanceGated, false);
    assert.equal(visual.diagnostics.tunnelLuminaireApproachSensorAllowed, false);
    assert.equal(Object.isFrozen(visual.getTunnelLightEmitters()), true);
    for (const emitter of visual.getTunnelLightEmitters()) {
      assert.equal(emitter.powerMode, contract.lighting.powerMode);
      assert.ok(emitter.visualInstanceIndex < visual.underpassLights.instanceMatrix.count);
      assert.ok(emitter.housingInstanceIndex < visual.beams.instanceMatrix.count);
    }

    const sceneryResources = [
      visual.supports.geometry,
      visual.supportCaps.geometry,
      visual.beams.geometry,
      visual.underpassLights.geometry,
      visual.tunnelShells.geometry,
      ...sceneryMaterials
    ];
    const disposalCounts = new Map(sceneryResources.map((resource) => [resource, 0]));
    for (const resource of sceneryResources) {
      resource.addEventListener('dispose', () => {
        disposalCounts.set(resource, disposalCounts.get(resource) + 1);
      });
    }
    visual.dispose();
    for (const count of disposalCounts.values()) assert.equal(count, 1);
    visual.dispose();
    for (const count of disposalCounts.values()) assert.equal(count, 1);
    visual = null;
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});

test('ambient companions and route wayfinding use sealed Sky forms without changing traffic or decision authority', () => {
  const trafficContract = cloverleafVisuals.ambientTrafficArtContract;
  const wayfindingContract = cloverleafVisuals.skyRouteWayfindingArtContract;
  assertDeepFrozen(trafficContract, 'ambientTrafficArtContract');
  assertDeepFrozen(wayfindingContract, 'skyRouteWayfindingArtContract');
  assert.equal(trafficContract.version, 3);
  assert.match(trafficContract.intent.zhCN, /披风灵鸟与朝圣同行者/);
  assert.match(trafficContract.intent.en, /cape-spirit pilgrimage companions/i);
  assert.deepEqual(trafficContract.geometry.inventory, {
    capeWingPairCount: 1,
    spiritBodyCount: 1,
    abstractMaskCount: 1,
    eyeCount: 2,
    tailClothPetalCount: 2,
    memoryRibbonCount: 2,
    engineCount: 0,
    nozzleCount: 0,
    turbineCount: 0,
    mechanicalPanelCount: 0
  });
  assert.deepEqual(trafficContract.materials, {
    family: 'matte-woven-natural-dielectric',
    metalness: 0,
    minimumRoughness: 0.80,
    maximumClearcoat: 0.025,
    baseEmissiveAllowed: false
  });
  assert.deepEqual(trafficContract.spacing, {
    minimumSurfaceGapM: 0.60,
    sameEdgeAuthority: 'shared-speed-even-phase-cohort',
    crossingAuthority: 'preallocated-world-sphere-submission-guard',
    suppressionPolicy: 'later-slot-hidden-before-instance-submit',
    diagnosticAuthority: 'submitted-instance-world-space-spheres'
  });
  assert.equal(trafficContract.geometry.noseAxisZ, -1);
  assert.equal(trafficContract.geometry.topology, 'single-merged-indexed-sealed-organic-components');
  assert.equal(trafficContract.invariants.mergedGeometryCount, 1);
  assert.equal(trafficContract.invariants.instanceCapacity, 'unchanged-quality-profile-capacity');
  assert.equal(trafficContract.invariants.placementAuthority, 'safe-edge-road-frame-phased-slots');
  assert.equal(trafficContract.invariants.collisionAuthority, 'non-colliding-decoration');
  assert.equal(trafficContract.invariants.runtimeAllocation, 'no-per-frame-traffic-allocation');

  assert.equal(wayfindingContract.version, 2);
  assert.deepEqual(wayfindingContract.decisionStructure.localScale, { x: 0.28, y: 3.8, z: 0.28 });
  assert.equal(wayfindingContract.decisionStructure.verticalOffsetM, 1.9);
  assert.deepEqual(wayfindingContract.decisionInscription.localScale, { x: 0.32, y: 0.18, z: 0.12 });
  assert.equal(wayfindingContract.decisionInscription.verticalOffsetM, 0.62);
  assert.equal(wayfindingContract.decisionInscription.additionalLightCount, 0);
  assert.equal(wayfindingContract.gore.collision, false);
  assert.equal(wayfindingContract.materials.goreMetalness, 0);
  assert.equal(wayfindingContract.exitSign.style, 'woven-scroll-with-candle-star-frame');
  assert.equal(wayfindingContract.exitSign.additionalDrawGroupCount, 0);

  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  try {
    visual = buildProductionVisual({ qualityProfileId: 'desktop' });
    const traffic = visual.traffic;
    const trafficGeometry = traffic.geometry;
    const trafficMaterial = traffic.material;
    const trafficShape = trafficGeometry.userData.neonV23TrafficShape;
    const trafficArt = trafficGeometry.userData.neonV23AmbientTrafficArt;
    trafficGeometry.computeBoundingBox();
    assert.equal(trafficArt.contractVersion, 3);
    assert.equal(trafficArt.role, 'cape-spirit-pilgrimage-companion');
    assert.equal(trafficContract.productionFamily, 'ambient-cape-spirit-companion');
    assert.equal(traffic.userData.neonV23.family, trafficContract.productionFamily);
    assert.equal(trafficArt.topology, trafficContract.geometry.topology);
    assert.deepEqual(trafficArt.componentRoles, trafficContract.geometry.componentRoles);
    assert.equal(trafficArt.envelopeViolationCount, 0);
    assert.deepEqual(trafficShape.componentRoles, trafficContract.geometry.componentRoles);
    assert.equal(trafficShape.componentCount, 9);
    assert.equal(trafficShape.mergedGeometryCount, 1);
    assert.equal(trafficShape.capeWingPairCount, 1);
    assert.equal(trafficShape.spiritBodyCount, 1);
    assert.equal(trafficShape.maskCount, 1);
    assert.equal(trafficShape.eyeCount, 2);
    assert.equal(trafficShape.tailClothPetalCount, 2);
    assert.equal(trafficShape.memoryRibbonCount, 2);
    assert.equal(trafficShape.canopyCount, 0);
    assert.equal(trafficShape.engineCount, 0);
    assert.equal(trafficShape.nozzleCount, 0);
    assert.equal(trafficShape.turbineCount, 0);
    assert.equal(trafficShape.mechanicalPanelCount, 0);
    assert.equal(trafficShape.tailFinCount, 0);
    assert.equal(trafficShape.noseAxisZ, -1);
    for (const role of trafficShape.componentRoles) {
      assert.doesNotMatch(role, /engine|nozzle|turbine|panel|canopy|fuselage|tail-fin/i);
    }
    assert.deepEqual(indexedTopologyReport(trafficGeometry), {
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      degenerateTriangleCount: 0
    });
    assert.equal(visual.diagnostics.ambientTrafficGeometryClosed, true);
    assert.equal(visual.diagnostics.ambientTrafficGeometryBoundaryEdges, 0);
    assert.equal(visual.diagnostics.ambientTrafficGeometryNonManifoldEdges, 0);
    assert.equal(visual.diagnostics.ambientTrafficGeometryDegenerateTriangles, 0);
    assert.equal(visual.diagnostics.ambientTrafficGeometryZeroAreaTriangles, 0);
    const maximumTrafficEnvelope = trafficContract.geometry.maximumLocalEnvelope;
    for (const [actual, maximum, label] of [
      [trafficGeometry.boundingBox.min.x, maximumTrafficEnvelope.minX, 'traffic minX'],
      [trafficGeometry.boundingBox.max.x, maximumTrafficEnvelope.maxX, 'traffic maxX'],
      [trafficGeometry.boundingBox.min.y, maximumTrafficEnvelope.minY, 'traffic minY'],
      [trafficGeometry.boundingBox.max.y, maximumTrafficEnvelope.maxY, 'traffic maxY'],
      [trafficGeometry.boundingBox.min.z, maximumTrafficEnvelope.minZ, 'traffic minZ'],
      [trafficGeometry.boundingBox.max.z, maximumTrafficEnvelope.maxZ, 'traffic maxZ']
    ]) {
      assert.ok(label.includes('min') ? actual >= maximum - 0.000_001 : actual <= maximum + 0.000_001, label);
    }
    assert.ok(Math.abs(trafficGeometry.boundingBox.min.x + 2.82) <= 0.000_001);
    assert.ok(Math.abs(trafficGeometry.boundingBox.max.x - 2.82) <= 0.000_001);
    assert.ok(Math.abs(trafficGeometry.boundingBox.min.z + 2.82) <= 0.000_001);
    assert.ok(trafficShape.heightM >= 0.90 && trafficShape.lengthM >= 4.60);
    assert.equal(trafficMaterial.isMeshPhysicalMaterial, true);
    assert.equal(trafficMaterial.metalness, 0);
    assert.ok(trafficMaterial.roughness >= trafficContract.materials.minimumRoughness);
    assert.ok(trafficMaterial.clearcoat <= trafficContract.materials.maximumClearcoat);
    assert.equal(trafficMaterial.emissive.getHex(), 0);
    assert.equal(trafficMaterial.emissiveIntensity, 0);
    assert.equal(traffic.instanceMatrix.count, 48);
    assert.equal(visual.getAmbientTrafficMarkers().length, 48);
    assert.ok(visual.getAmbientTrafficMarkers().every((marker) => marker.nonColliding === true));
    assert.equal(visual.diagnostics.ambientTrafficArtRuntimeAllocation, 'no-per-frame-traffic-allocation');

    const goreGeometry = visual.goreNoses.geometry;
    const goreArt = goreGeometry.userData.neonV23SkyWayfindingArt;
    goreGeometry.computeBoundingBox();
    assert.equal(goreArt.role, wayfindingContract.gore.role);
    assert.equal(goreArt.topology, wayfindingContract.gore.topology);
    assert.equal(goreArt.collision, false);
    assert.equal(goreArt.envelopeViolationCount, 0);
    assert.deepEqual(indexedTopologyReport(goreGeometry), {
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      degenerateTriangleCount: 0
    });
    assert.equal(visual.goreNoses.material.metalness, 0);
    assert.ok(visual.goreNoses.material.roughness >= wayfindingContract.materials.goreMinimumRoughness);
    assert.equal(visual.goreNoses.material.emissive.getHex(), 0);
    assert.equal(visual.goreNoses.instanceMatrix.count, visual.diagnostics.goreCapacity);
    assert.equal(visual.goreNoses.count, visual.diagnostics.goreCount);

    const decisionGeometry = visual.structuralDetails.geometry;
    assert.equal(
      decisionGeometry.userData.neonV23SkyWayfindingArt.role,
      wayfindingContract.decisionStructure.role
    );
    assert.equal(
      decisionGeometry.userData.neonV23SkyWayfindingArt.topology,
      wayfindingContract.decisionStructure.topology
    );
    assert.equal(
      decisionGeometry.getAttribute('position').count,
      wayfindingContract.decisionStructure.outlinePointCount
        * wayfindingContract.decisionStructure.axialRingCount + 2
    );
    assert.deepEqual(indexedTopologyReport(decisionGeometry), {
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      degenerateTriangleCount: 0
    });
    assertDeclaredLocalEnvelope(decisionGeometry);
    assert.equal(visual.structuralDetails.material.metalness, 0);
    assert.equal(visual.diagnostics.decisionPylonCount, visual.diagnostics.activeDecisionStructureNodeCount * 2);
    assert.equal(visual.diagnostics.decisionReflectorCount, visual.diagnostics.activeDecisionStructureNodeCount * 2);
    assert.equal(visual.diagnostics.decisionPylonCapacity, visual.diagnostics.decisionStructureNodeCapacity * 2);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let offset = 0; offset < visual.diagnostics.decisionPylonCount; offset++) {
      visual.structuralDetails.getMatrixAt(visual.diagnostics.decisionPylonInstanceStart + offset, matrix);
      matrix.decompose(position, quaternion, scale);
      assert.ok(scale.distanceTo(new THREE.Vector3(0.28, 3.8, 0.28)) <= 0.000_001);
    }
    for (let offset = 0; offset < visual.diagnostics.decisionReflectorCount; offset++) {
      visual.underpassLights.getMatrixAt(
        visual.diagnostics.decisionReflectorInstanceStart + offset,
        matrix
      );
      matrix.decompose(position, quaternion, scale);
      assert.ok(scale.distanceTo(new THREE.Vector3(0.32, 0.18, 0.12)) <= 0.000_001);
    }
    assert.equal(
      visual.underpassLights.userData.neonV23SkyWayfindingArt.role,
      wayfindingContract.decisionInscription.role
    );
    assert.equal(visual.diagnostics.decisionStructureAdditionalLightCount, 0);
    assert.equal(visual.group.children.length, 19);

    const routeCameraBlockers = visual.getCameraBlockers();
    const filmBlockerContract = cloverleafVisuals.filmRouteStructureBlockerContract;
    assertDeepFrozen(filmBlockerContract, 'filmRouteStructureBlockerContract');
    assert.equal(filmBlockerContract.version, 1);
    assert.equal(filmBlockerContract.coordinateMode, 'absolute-world-cylinder');
    assert.equal(filmBlockerContract.invariants.stableFrameAllocations, 0);
    assert.equal(filmBlockerContract.continuousTunnelShellDuplicatedAsCylinders, false);
    assert.equal(
      filmBlockerContract.continuousTunnelShellAuthority,
      'sampleEdge-finite-floor-and-ceiling'
    );
    assert.ok(Object.isFrozen(routeCameraBlockers));
    assert.equal(new Set(routeCameraBlockers.map((blocker) => blocker.id)).size, routeCameraBlockers.length);
    assert.equal(routeCameraBlockers.length, visual.diagnostics.routeCameraBlockerCapacity);
    assert.equal(visual.diagnostics.filmRouteStructureBlockerContractVersion, 1);
    assert.equal(visual.diagnostics.filmRouteStructureStableFrameAllocations, 0);
    assert.equal(visual.diagnostics.continuousTunnelShellCameraCylinderCount, 0);
    assert.equal(
      routeCameraBlockers.some((blocker) => /continuous-tunnel-shell/.test(blocker.kind)),
      false,
      'Continuous shell duplicated the route floor/ceiling authority as coarse cylinders'
    );
    const decisionCameraBlockers = routeCameraBlockers.filter(
      (blocker) => blocker.kind === 'wind-eroded-decision-pylon'
    );
    assert.equal(decisionCameraBlockers.length, visual.diagnostics.decisionPylonCapacity);
    assert.equal(
      decisionCameraBlockers.filter((blocker) => blocker.visible).length,
      visual.diagnostics.decisionPylonCount
    );
    for (const blocker of routeCameraBlockers) {
      assert.ok(Number.isFinite(blocker.x), `${blocker.id} x must stay finite`);
      assert.ok(Number.isFinite(blocker.y), `${blocker.id} y must stay finite`);
      assert.ok(Number.isFinite(blocker.z), `${blocker.id} z must stay finite`);
      assert.ok(Number.isFinite(blocker.radiusM) && blocker.radiusM > 0, `${blocker.id} radius invalid`);
      assert.ok(Number.isFinite(blocker.minY), `${blocker.id} minY must stay finite`);
      assert.ok(Number.isFinite(blocker.maxY), `${blocker.id} maxY must stay finite`);
      assert.ok(blocker.maxY >= blocker.minY, `${blocker.id} vertical envelope inverted`);
      assert.equal(blocker.coordinateMode, filmBlockerContract.coordinateMode);
    }
    const blockerMeshByName = new Map([
      [visual.supports.name, visual.supports],
      [visual.supportCaps.name, visual.supportCaps],
      [visual.beams.name, visual.beams],
      [visual.structuralDetails.name, visual.structuralDetails],
      [visual.goreNoses.name, visual.goreNoses]
    ]);
    const requiredVisibleKinds = new Set([
      'wind-eroded-bridge-pier',
      'petal-bridge-capital-or-footing',
      'carved-bridge-crossbeam',
      'carved-tunnel-rib-portal-or-housing',
      'layered-bridge-detail',
      'bridge-rail-post',
      'physical-gore-nose',
      'wind-eroded-decision-pylon'
    ]);
    for (const blocker of routeCameraBlockers) {
      if (!blocker.visible) continue;
      requiredVisibleKinds.delete(blocker.kind);
      if (!blocker.meshName) continue;
      const mesh = blockerMeshByName.get(blocker.meshName);
      assert.ok(mesh, `${blocker.id} refers to an unpublished instance batch`);
      assert.ok(blocker.instanceIndex < mesh.count, `${blocker.id} points beyond the visible draw count`);
      assertCameraBlockerContainsInstance(blocker, mesh, visual.diagnostics.tileOrigin);
    }
    assert.deepEqual([...requiredVisibleKinds], [], 'A visible structural family published no Film blocker');
    assert.equal(
      routeCameraBlockers.filter((blocker) => blocker.visible).length,
      visual.diagnostics.routeCameraBlockerVisibleCount
    );
    const stableBlockerReferences = [...routeCameraBlockers];
    visual.update({ origin: { x: 0, z: 0 }, time: 0, visible: true });
    assert.equal(visual.getCameraBlockers(), routeCameraBlockers);
    for (let index = 0; index < routeCameraBlockers.length; index++) {
      assert.equal(routeCameraBlockers[index], stableBlockerReferences[index]);
    }
    const persistentVisibleBlockerCount = routeCameraBlockers.filter((blocker) => blocker.visible).length;
    const stableVisibility = routeCameraBlockers.map((blocker) => blocker.visible);
    const visibilitySweepsBefore = visual.diagnostics.routeCameraBlockerVisibilitySweepCount;
    for (const time of [16, 32, 48]) {
      visual.update({ origin: { x: time, z: -time }, time, visible: true });
      assert.deepEqual(routeCameraBlockers.map((blocker) => blocker.visible), stableVisibility);
    }
    assert.equal(
      visual.diagnostics.routeCameraBlockerVisibilitySweepCount,
      visibilitySweepsBefore,
      'Moving the player origin must not walk the complete absolute-world blocker pool'
    );
    visual.update({ origin: { x: 0, z: 0 }, time: 0, visible: false });
    assert.equal(routeCameraBlockers.some((blocker) => blocker.visible), false);
    assert.equal(visual.diagnostics.routeCameraBlockerVisibilitySweepCount, visibilitySweepsBefore + 1);
    const boundsUpdatesWhileHidden = visual.diagnostics.ambientTrafficBoundsUpdateCount;
    for (let frame = 0; frame < 3; frame++) visual.update({ visible: false });
    assert.equal(visual.diagnostics.routeCameraBlockerVisibilitySweepCount, visibilitySweepsBefore + 1);
    assert.equal(visual.diagnostics.ambientTrafficBoundsUpdateCount, boundsUpdatesWhileHidden);
    visual.update({ origin: { x: 0, z: 0 }, time: 0, visible: true });
    assert.equal(visual.diagnostics.routeCameraBlockerVisibilitySweepCount, visibilitySweepsBefore + 2);
    assert.equal(
      routeCameraBlockers.filter((blocker) => blocker.visible).length,
      persistentVisibleBlockerCount,
      'Tile re-entry failed to restore the exact persistent structural blocker set'
    );
    assert.equal(
      decisionCameraBlockers.filter((blocker) => blocker.visible).length,
      visual.diagnostics.decisionPylonCount
    );

    const pylonMatricesBeforeQualitySwitch = Array.from(visual.structuralDetails.instanceMatrix.array.slice(
      visual.diagnostics.decisionPylonInstanceStart * 16,
      (visual.diagnostics.decisionPylonInstanceStart + visual.diagnostics.decisionPylonCount) * 16
    ));
    const reflectorMatricesBeforeQualitySwitch = Array.from(visual.underpassLights.instanceMatrix.array.slice(
      visual.diagnostics.decisionReflectorInstanceStart * 16,
      (visual.diagnostics.decisionReflectorInstanceStart + visual.diagnostics.decisionReflectorCount) * 16
    ));
    const goreMatricesBeforeQualitySwitch = Array.from(visual.goreNoses.instanceMatrix.array);
    for (const renderQualityId of ['high', 'low', 'medium']) visual.setRenderQuality(renderQualityId);
    assert.deepEqual(Array.from(visual.structuralDetails.instanceMatrix.array.slice(
      visual.diagnostics.decisionPylonInstanceStart * 16,
      (visual.diagnostics.decisionPylonInstanceStart + visual.diagnostics.decisionPylonCount) * 16
    )), pylonMatricesBeforeQualitySwitch);
    assert.deepEqual(Array.from(visual.underpassLights.instanceMatrix.array.slice(
      visual.diagnostics.decisionReflectorInstanceStart * 16,
      (visual.diagnostics.decisionReflectorInstanceStart + visual.diagnostics.decisionReflectorCount) * 16
    )), reflectorMatricesBeforeQualitySwitch);
    assert.deepEqual(Array.from(visual.goreNoses.instanceMatrix.array), goreMatricesBeforeQualitySwitch);
    assert.equal(visual.structuralDetails.material.metalness, 0);

    assert.equal(
      visual.exitSigns.userData.neonV23SkyWayfindingArt.style,
      wayfindingContract.exitSign.style
    );
    assert.equal(
      visual.exitSigns.material.userData.neonV23SkyWayfindingArt.textAuthority,
      wayfindingContract.exitSign.textAuthority
    );

    const submittedPositions = Array.from(
      { length: visual.diagnostics.ambientTrafficCapacity },
      () => new THREE.Vector3()
    );
    const submittedRadii = new Float64Array(visual.diagnostics.ambientTrafficCapacity);
    const submittedMatrix = new THREE.Matrix4();
    const submittedQuaternion = new THREE.Quaternion();
    const submittedScale = new THREE.Vector3();
    const localTrafficRadiusM = visual.traffic.geometry.boundingSphere.radius;
    for (const time of [0, 1_000, 7_500, 31_000, 95_000]) {
      visual.update({ origin: { x: 0, z: 0 }, time, visible: true });
      const submittedCount = visual.traffic.count;
      assert.ok(
        submittedCount >= Math.ceil(visual.diagnostics.ambientTrafficCapacity * 0.70),
        `Traffic separation suppressed too much scenery at ${time}ms`
      );
      assert.equal(
        submittedCount + visual.diagnostics.ambientTrafficSeparationSuppressedCount,
        visual.diagnostics.ambientTrafficCapacity
      );
      assert.equal(visual.diagnostics.ambientTrafficSeparationViolationCount, 0);
      assert.ok(
        visual.diagnostics.ambientTrafficMinimumSubmittedSurfaceGapM
          >= trafficContract.spacing.minimumSurfaceGapM - 0.000_001
      );
      for (let index = 0; index < submittedCount; index++) {
        visual.traffic.getMatrixAt(index, submittedMatrix);
        submittedMatrix.decompose(
          submittedPositions[index],
          submittedQuaternion,
          submittedScale
        );
        submittedRadii[index] = localTrafficRadiusM * Math.max(
          Math.abs(submittedScale.x),
          Math.abs(submittedScale.y),
          Math.abs(submittedScale.z)
        );
      }
      for (let left = 0; left < submittedCount; left++) {
        for (let right = left + 1; right < submittedCount; right++) {
          const surfaceGapM = submittedPositions[left].distanceTo(submittedPositions[right])
            - submittedRadii[left] - submittedRadii[right];
          assert.ok(
            surfaceGapM >= trafficContract.spacing.minimumSurfaceGapM - 0.000_001,
            `Submitted traffic ${left}/${right} intersects by ${-surfaceGapM}m at ${time}ms`
          );
        }
      }
      for (const marker of visual.getAmbientTrafficMarkers()) {
        assert.equal(marker.visible && marker.separationSuppressed, false);
        if (marker.separationSuppressed) assert.equal(marker.opacity, 0);
      }
    }

    const updateStart = source.indexOf('function update({ origin, pathPlan, proposal, navigation, time = 0, visible = true } = {})');
    const trafficLoopStart = source.indexOf('let count = 0;', updateStart);
    const trafficLoopEnd = source.indexOf('traffic.count = count;', trafficLoopStart);
    const trafficLoopSource = source.slice(trafficLoopStart, trafficLoopEnd);
    assert.doesNotMatch(trafficLoopSource, /\bnew\s+|Array\.from|\.map\(|\.filter\(/);

    const trafficGeometryResource = visual.traffic.geometry;
    const trafficMaterialResource = visual.traffic.material;
    const goreGeometryResource = visual.goreNoses.geometry;
    const goreMaterialResource = visual.goreNoses.material;
    const disposalCounts = new Map([
      [trafficGeometryResource, 0],
      [trafficMaterialResource, 0],
      [goreGeometryResource, 0],
      [goreMaterialResource, 0]
    ]);
    for (const resource of disposalCounts.keys()) {
      resource.addEventListener('dispose', () => {
        disposalCounts.set(resource, disposalCounts.get(resource) + 1);
      });
    }
    visual.dispose();
    visual.dispose();
    for (const count of disposalCounts.values()) assert.equal(count, 1);
    visual = null;
  } finally {
    visual?.dispose();
    restoreDocument();
  }

  const signStart = source.indexOf('function drawExitSignCandleStar(');
  const signEnd = source.indexOf('/** Create cached network meshes', signStart);
  const signSource = source.slice(signStart, signEnd);
  assert.match(signSource, /style: SKY_ROUTE_WAYFINDING_ART_CONTRACT\.exitSign\.style/);
  assert.equal((signSource.match(/drawExitSignCandleStar\(/g) || []).length, 3);
  assert.match(signSource, /woven scroll without gradients/);
  assert.match(signSource, /context\.fillText\(specs\[index\]\.text/);
  assert.ok(
    signSource.indexOf('drawExitSignCandleStar(context')
      < signSource.indexOf('context.fillText(specs[index].text')
  );
});

test('moving ambient traffic bounds contain every submitted vertex and preserve independent shadow culling', () => {
  const restoreDocument = installCanvasDocumentStub();
  try {
    for (const qualityProfileId of ['mobile', 'desktop']) {
      const visual = buildProductionVisual({ qualityProfileId });
      try {
        const traffic = visual.traffic;
        const retainedSphere = traffic.boundingSphere;
        const retainedGeometry = traffic.geometry;
        const position = traffic.geometry.getAttribute('position');
        const instanceMatrix = new THREE.Matrix4();
        const vertex = new THREE.Vector3();
        const frustum = new THREE.Frustum();
        const projectionView = new THREE.Matrix4();
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 50_000);
        const lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50_000);
        const worldSphere = new THREE.Sphere();
        const originalDrawGroups = visual.group.children.length;

        /** Use the same projection/view multiplication as Three's main and shadow rendering passes. */
        function intersectsFrom(view) {
          view.updateMatrixWorld(true);
          projectionView.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
          frustum.setFromProjectionMatrix(projectionView);
          return frustum.intersectsObject(traffic);
        }

        for (const [index, time] of [0, 12_000, 1_000_000].entries()) {
          visual.setRenderQuality(['low', 'medium', 'high'][index]);
          visual.update({ origin: { x: 37_000 + time * 0.01, z: -19_000 }, time, visible: true });
          visual.group.updateMatrixWorld(true);
          assert.equal(traffic.boundingSphere, retainedSphere, 'A moving frame allocated a replacement sphere');
          assert.equal(traffic.geometry, retainedGeometry);
          assert.equal(traffic.frustumCulled, true);
          assert.equal(traffic.visible, true);
          assert.equal(traffic.castShadow, true);
          assert.equal(traffic.receiveShadow, true);
          assert.equal(visual.group.children.length, originalDrawGroups);
          assert.equal(visual.diagnostics.ambientTrafficBoundsUpdateCount, index + 1);
          assert.ok(traffic.count > 0);
          for (let instance = 0; instance < traffic.count; instance++) {
            traffic.getMatrixAt(instance, instanceMatrix);
            for (let point = 0; point < position.count; point++) {
              vertex.fromBufferAttribute(position, point).applyMatrix4(instanceMatrix);
              assert.ok(
                vertex.distanceTo(traffic.boundingSphere.center) <= traffic.boundingSphere.radius + 0.000_1,
                `${qualityProfileId}@${time}: instance ${instance} vertex ${point} escapes the submitted bound`
              );
            }
          }

          worldSphere.copy(traffic.boundingSphere).applyMatrix4(traffic.matrixWorld);
          camera.position.copy(worldSphere.center).add(new THREE.Vector3(0, 0, worldSphere.radius + 100));
          camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0, 1)));
          assert.equal(intersectsFrom(camera), false, 'An entirely rearward batch should leave the main view');
          lightCamera.left = -worldSphere.radius - 1;
          lightCamera.right = worldSphere.radius + 1;
          lightCamera.top = worldSphere.radius + 1;
          lightCamera.bottom = -worldSphere.radius - 1;
          lightCamera.updateProjectionMatrix();
          lightCamera.position.copy(camera.position);
          lightCamera.lookAt(worldSphere.center);
          assert.equal(intersectsFrom(lightCamera), true, 'Main-view culling removed a light-visible shadow caster');
          assert.equal(traffic.visible, true, 'Spatial rejection must stay pass-local instead of hiding the object');
          camera.lookAt(worldSphere.center);
          assert.equal(intersectsFrom(camera), true, 'Turning back failed to recover the complete current batch');
        }
      } finally {
        visual.dispose();
      }
    }
  } finally {
    restoreDocument();
  }
});

test('tunnel base structure remains non-emissive in both standard and high physical materials', () => {
  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  try {
    visual = buildProductionVisual({ qualityProfileId: 'desktop' });
    const structuralMeshes = [
      visual.supports,
      visual.supportCaps,
      visual.beams,
      visual.tunnelShells,
      visual.structuralDetails
    ];
    for (const renderQualityId of ['medium', 'high']) {
      visual.setRenderQuality(renderQualityId);
      for (const mesh of structuralMeshes) {
        const material = mesh.material;
        assert.equal(
          material.emissive?.getHex() || 0,
          0,
          `${mesh.name} ${renderQualityId} material emits light without a luminaire`
        );
        assert.equal(
          Number(material.emissiveIntensity) || 0,
          0,
          `${mesh.name} ${renderQualityId} material retains emissive energy`
        );
      }
    }
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});

test('tunnel roofs and underground U walls share indexed curved stations within geometric tolerances', () => {
  const helperStart = source.indexOf('const TUNNEL_SHELL_MAXIMUM_SEGMENT_M =');
  const helperEnd = source.indexOf('function directionLabel(port)', helperStart);
  const generatorStart = source.indexOf('function* createGenerator(options)');
  const generatorEnd = source.indexOf('function createBuildJob(options)', generatorStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
  const helperSource = source.slice(helperStart, helperEnd);
  const generatorSource = source.slice(generatorStart, generatorEnd);

  assert.match(helperSource, /TUNNEL_SHELL_MAXIMUM_SEGMENT_M = 2;/);
  assert.match(helperSource, /TUNNEL_SHELL_MAXIMUM_CHORD_ERROR_M = 0\.005;/);
  assert.match(helperSource, /UNDERGROUND_PORTAL_RIB_ROAD_CLEARANCE_M = 0\.02;/);
  assert.match(
    helperSource,
    /function createTunnelSharedStations\(startS, endS, ribSegmentCount, roadStations = \[\]\)/
  );
  assert.match(helperSource, /Math\.ceil\(\(nextRibS - ribS\) \/ TUNNEL_SHELL_MAXIMUM_SEGMENT_M\)/);
  assert.match(helperSource, /mergedShellStations\.push\(roadS\)/);
  assert.match(helperSource, /ribStations: Object\.freeze\(ribStations\)/);
  assert.match(helperSource, /shellStations: Object\.freeze\(uniqueShellStations\)/);
  assert.match(helperSource, /function inspectUndergroundTunnelRoadJoin\(/);
  assert.match(helperSource, /function tunnelShellCrossSection\(/);
  assert.match(helperSource, /profile\.kind === 'mountain-tunnel'/);
  assert.match(helperSource, /function createContinuousTunnelShellGeometry\(/);
  assert.match(helperSource, /function roadJoinAtRow\(rowIndex, side\)/);
  assert.match(helperSource, /function roadJoinAt\(edgeS, side\)/);
  assert.match(helperSource, /points\[pointIndex\] = exactRoadJoin;/);
  assert.match(helperSource, /appendRefinedRange\(startS, midpointS, depth \+ 1\)/);
  assert.match(helperSource, /error > TUNNEL_SHELL_MAXIMUM_CHORD_ERROR_M/);
  assert.match(helperSource, /indices\.push\(a, nextA, b, b, nextA, nextB\);/);
  assert.match(helperSource, /geometry\.setIndex\(new THREE\.BufferAttribute\(new IndexArray\(indices\), 1\)\);/);
  assert.match(helperSource, /sharedLongitudinalRows: true/);

  assert.match(helperSource, /function createTunnelProfileSpecs\(/);
  assert.match(helperSource, /const roadRowCount = Math\.max\(6, Math\.ceil\(edge\.length \/ sampleStep\)\);/);
  assert.match(helperSource, /const stationContract = createTunnelSharedStations\(/);
  assert.match(helperSource, /segmentCount,\s+roadStations/);
  assert.match(helperSource, /ribStations: stationContract\.ribStations/);
  assert.match(helperSource, /shellStations: stationContract\.shellStations/);
  assert.match(generatorSource, /const tunnelProfileSpecs = createTunnelProfileSpecs\(/);
  assert.match(generatorSource, /const edgeS = ribStations\[index\];/);
  assert.match(generatorSource, /tunnelShellMaximumSegmentLengthM:/);
  assert.match(generatorSource, /tunnelShellMaximumChordErrorM:/);
  assert.match(generatorSource, /tunnelShellRibAlignmentErrorM:/);
  assert.match(generatorSource, /tunnelShellPortalAlignmentErrorM:/);
  assert.match(generatorSource, /tunnelShellMaximumRoadJoinGapM:/);
  assert.match(generatorSource, /tunnelShellMaximumRoadJoinPenetrationM:/);
  assert.match(generatorSource, /tunnelMinimumUndergroundPortalRoadClearanceM:/);
  assert.match(
    generatorSource,
    /profile\.kind === 'mountain-tunnel' \? 0\.82 : undergroundWallThickness/
  );
  assert.match(
    generatorSource,
    /undergroundWallInset \+ UNDERGROUND_PORTAL_RIB_ROAD_CLEARANCE_M/
  );
  assert.match(generatorSource, /tunnelShellPanelCount:/);
  assert.doesNotMatch(generatorSource, /tunnelWallSpacing|wallSegmentCount|tunnelWallCapacity/);
  assert.doesNotMatch(generatorSource, /nextS - edgeS \+ 1\.2/);
  assert.doesNotMatch(generatorSource, /new THREE\.InstancedMesh\(\s*undergroundWallGeometry/);

  const join = cloverleafVisuals.inspectUndergroundTunnelRoadJoin(
    {
      kind: 'underground-tunnel',
      roadShoulderJoin: 0.22,
      wallInset: 0.49,
      wallThickness: 0.54,
      roofInset: 0.84
    },
    5.2,
    0.49,
    0.84,
    0.22,
    0.54
  );
  assert.equal(join.roadJoinGapM, 0);
  assert.equal(join.roadJoinPenetrationM, 0);
  assert.equal(join.roofWallGapM, 0);
  assert.ok(Math.abs(join.wallInner - 5.42) <= 0.000_001);
  assert.ok(Math.abs(join.wallOuter - 5.96) <= 0.000_001);
  assert.ok(Math.abs(join.roofHalf - 6.04) <= 0.000_001);
  assert.ok(Math.abs(join.roofOverhangM - 0.08) <= 0.000_001);

  let coveredShellStationCount = 0;
  let minimumPublishedCeilingClearanceM = Number.POSITIVE_INFINITY;
  for (const edge of productionTrack.graph.edges) {
    for (const profile of edge.tunnelProfiles || []) {
      const startS = Number(profile.surfaceStartS);
      const endS = Number(profile.surfaceEndS);
      if (!(endS > startS)) continue;
      const segmentCount = Math.max(1, Math.ceil((endS - startS) / 2));
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        const edgeS = startS + (endS - startS) * (segmentIndex + 0.5) / segmentCount;
        const center = productionTrack.sampleEdge(edge.id, edgeS, 0, {});
        for (const lateralRatio of [-0.92, 0, 0.92]) {
          const frame = productionTrack.sampleEdge(
            edge.id,
            edgeS,
            lateralRatio * center.roadHalf,
            {}
          );
          assert.equal(frame.covered, true, `${edge.id}@${edgeS} omitted covered authority`);
          assert.equal(frame.tunnelKind, profile.kind, `${edge.id}@${edgeS} changed tunnel kind`);
          assert.ok(Number.isFinite(frame.y), `${edge.id}@${edgeS} omitted finite route floor`);
          assert.ok(
            Number.isFinite(frame.ceilingHeight),
            `${edge.id}@${edgeS} omitted finite Film ceiling`
          );
          minimumPublishedCeilingClearanceM = Math.min(
            minimumPublishedCeilingClearanceM,
            frame.ceilingHeight - frame.y
          );
          coveredShellStationCount++;
        }
      }
    }
  }
  assert.ok(coveredShellStationCount > 1_000, 'Tunnel shell audit sampled too little of the real route');
  assert.ok(
    minimumPublishedCeilingClearanceM >= 3.39,
    `Tunnel Film floor/ceiling clearance collapsed to ${minimumPublishedCeilingClearanceM}m`
  );

  for (const qualityProfile of [{ id: 'desktop' }, { id: 'mobile' }]) {
    const audit = cloverleafVisuals.createTunnelShellGeometryAudit({
      THREE,
      track: productionTrack,
      qualityProfile,
      tileOrigin: productionTrack.graph.origin
    });
    const diagnostics = audit.diagnostics;
    assert.ok(diagnostics.roadJoinSharedVertexCount > 0);
    assert.ok(diagnostics.maximumRoadJoinGapM <= 0.000_001);
    assert.ok(diagnostics.maximumRoadJoinPenetrationM <= 0.000_001);
    assert.ok(diagnostics.maximumRoofWallGapM <= 0.000_001);
    assert.ok(diagnostics.safeCorridorViolationCount === 0);
    assert.ok(diagnostics.maximumSegmentLengthM <= 2.000_001);
    assert.ok(diagnostics.maximumChordErrorM <= 0.005_001);
    assert.ok(
      diagnostics.maximumRoadJoinAlignmentAdjustmentM
        <= (qualityProfile.id === 'mobile' ? 0.055_001 : 0.018_001)
    );
    const positions = audit.geometry.getAttribute('position');
    const indices = audit.geometry.index;
    assert.ok(positions?.count > 0 && indices?.count > 0);
    for (let index = 0; index < positions.array.length; index++) {
      assert.ok(Number.isFinite(positions.array[index]));
    }
    audit.geometry.dispose();
  }
});

test('tile draw-group diagnostics separate visible work from reserved batches', () => {
  const generatorStart = source.indexOf('function* createGenerator(options)');
  const generatorEnd = source.indexOf('function createBuildJob(options)', generatorStart);
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
  const generatorSource = source.slice(generatorStart, generatorEnd);
  const guidanceStart = generatorSource.indexOf('function updateGuidanceVisibility(navigation)');
  const guidanceEnd = generatorSource.indexOf('/** Retain the exact shared DecisionGuidance reference', guidanceStart);
  const diagnosticsStart = generatorSource.indexOf('diagnostics: Object.freeze({');
  const diagnosticsSource = generatorSource.slice(diagnosticsStart);

  // One authored group.add site is the static-line helper, which is invoked for base and recovery batches.
  assert.equal((generatorSource.match(/\bgroup\.add\(/g) || []).length, 18);
  assert.match(generatorSource, /const staticGeneralLines = createStaticLineBatch\(/);
  assert.match(generatorSource, /const recoveryStaticLines = createStaticLineBatch\(/);
  assert.match(generatorSource, /function currentVisibleDrawGroupCount\(\)/);
  assert.match(generatorSource, /if \(!group\.visible\) return 0;/);
  assert.match(
    generatorSource,
    /child\.visible && \(!child\.isInstancedMesh \|\| child\.count > 0\)/
  );
  assert.match(diagnosticsSource, /reservedDrawGroupCount: group\.children\.length/);
  assert.match(diagnosticsSource, /get tileDrawGroupCount\(\) \{ return currentVisibleDrawGroupCount\(\); \}/);
  assert.match(diagnosticsSource, /get drawGroupCount\(\) \{ return currentVisibleDrawGroupCount\(\); \}/);

  const guidanceSource = generatorSource.slice(guidanceStart, guidanceEnd);
  assert.match(guidanceSource, /exitSigns\.visible = guidanceApplies\(navigation\) && turning/);
  assert.match(guidanceSource, /roadArrows\.visible = guidanceApplies\(navigation\) && roadArrows\.count > 0;/);
  assert.match(
    guidanceSource,
    /decorativeLaneGuides\.visible = !\(exitSigns\.visible && roadArrows\.visible\);/
  );
});

test('exit-sign atlas swaps localized text without rebuilding route geometry', () => {
  const signStart = source.indexOf('function directionLabel(port)');
  const signEnd = source.indexOf('/** Create cached network meshes', signStart);
  assert.ok(signStart >= 0 && signEnd > signStart);
  const signSource = source.slice(signStart, signEnd);

  assert.match(signSource, /i18n\.t\(`direction\.\$\{direction\}`/);
  assert.match(signSource, /i18n\.t\('common\.meters'/);
  assert.match(signSource, /function localizedExitSignSpecs\(specs\)/);
  assert.match(signSource, /window\.NeonV23I18n\.subscribe\(syncLanguage\)/);
  assert.match(signSource, /mesh\.material = activeAtlas\.material;/);
  assert.match(signSource, /releaseExitSignAtlas\(previousAtlas\);/);
  assert.match(signSource, /unsubscribeLanguage\?\.\(\);/);
  assert.doesNotMatch(signSource, /\$\{spec\.distanceM\}m/);
});

test('each real bridge or tunnel fixture publishes one frozen world and tile-local light emitter record', () => {
  const emitterStart = source.indexOf('function createCoveredRouteLightEmitter(');
  const emitterEnd = source.indexOf('for (const crossing of crossings)', emitterStart);
  assert.ok(emitterStart >= 0 && emitterEnd > emitterStart);
  const emitterSource = source.slice(emitterStart, emitterEnd);

  assert.match(emitterSource, /return Object\.freeze\(\{/);
  assert.match(emitterSource, /tunnelLightEmitters\.push\(createCoveredRouteLightEmitter\(\{/);
  assert.match(emitterSource, /bridgeLightEmitters\.push\(createCoveredRouteLightEmitter\(\{/);
  for (const field of [
    'tileToken',
    'coordinateMode',
    'absolutePosition',
    'tileLocalPosition',
    'direction',
    'color',
    'intensity',
    'distance',
    'kind',
    'edge',
    'fixtureEdge',
    'profile',
    'visualInstanceIndex',
    'housingInstanceIndex',
    'powerMode'
  ]) {
    assert.match(emitterSource, new RegExp(`\\b${field}[,:]`));
  }
  assert.match(emitterSource, /powerMode: 'constant-on'/);
  assert.match(source, /captureBridgeLightEmitter\(\{[\s\S]*?bridgeLightCount\+\+;/);
  assert.match(source, /captureTunnelLightEmitter\([\s\S]*?tunnelLightCount\+\+;/);
  assert.match(source, /const frozenBridgeLightEmitters = Object\.freeze\(bridgeLightEmitters\);/);
  assert.match(source, /const frozenTunnelLightEmitters = Object\.freeze\(tunnelLightEmitters\);/);
  assert.match(source, /const frozenCoveredRouteLightEmitters = Object\.freeze\(\[/);
  assert.match(source, /if \(frozenBridgeLightEmitters\.length !== bridgeLightCount\)/);
  assert.match(source, /if \(frozenTunnelLightEmitters\.length !== tunnelLightCount\)/);
  assert.match(source, /function getCoveredRouteLightEmitters\(\) \{\s*return frozenCoveredRouteLightEmitters;/);
  assert.match(source, /function getTunnelLightEmitters\(\) \{\s*return frozenTunnelLightEmitters;/);
  assert.match(source, /bridgeLightEmitterMismatchCount: Math\.abs\(bridgeLightCount - frozenBridgeLightEmitters\.length\)/);
  assert.match(source, /tunnelLightEmitterMismatchCount: Math\.abs\(tunnelLightCount - frozenTunnelLightEmitters\.length\)/);
});

test('tunnel luminaires use rib-independent fixed spacing and preserve a one-to-one visual emitter contract', () => {
  assert.match(
    source,
    /const TUNNEL_LUMINAIRE_SPACING_M = Object\.freeze\(\{\s*underground:\s*22,\s*mountain:\s*28\s*\}\);/
  );

  const restoreDocument = installCanvasDocumentStub();
  const visuals = [];
  try {
    const stationSignaturesByQuality = new Map();
    for (const qualityProfileId of ['desktop', 'mobile']) {
      const visual = buildProductionVisual({ qualityProfileId });
      visuals.push(visual);
      const emitters = visual.getTunnelLightEmitters();

      assert.ok(emitters.length > 0, `${qualityProfileId} build published no tunnel emitters`);
      assert.equal(visual.diagnostics.tunnelLightCount, emitters.length);
      assert.equal(visual.diagnostics.tunnelLightEmitterCount, emitters.length);
      assert.equal(visual.diagnostics.tunnelLightEmitterMismatchCount, 0);

      const visualInstanceIndices = new Set();
      const housingInstanceIndices = new Set();
      const emittersByEdgeAndSide = new Map();
      const sidesByStation = new Map();
      for (const emitter of emitters) {
        assert.equal(Object.isFrozen(emitter), true);
        assert.equal(emitter.powerMode, 'constant-on');
        assert.ok(Number.isInteger(emitter.visualInstanceIndex) && emitter.visualInstanceIndex >= 0);
        assert.ok(Number.isInteger(emitter.housingInstanceIndex) && emitter.housingInstanceIndex >= 0);
        assert.equal(
          visualInstanceIndices.has(emitter.visualInstanceIndex),
          false,
          `Tunnel luminaire visual instance ${emitter.visualInstanceIndex} was reused`
        );
        assert.equal(
          housingInstanceIndices.has(emitter.housingInstanceIndex),
          false,
          `Tunnel luminaire housing instance ${emitter.housingInstanceIndex} was reused`
        );
        visualInstanceIndices.add(emitter.visualInstanceIndex);
        housingInstanceIndices.add(emitter.housingInstanceIndex);

        const edgeSideKey = `${emitter.edge}:${emitter.side}`;
        if (!emittersByEdgeAndSide.has(edgeSideKey)) emittersByEdgeAndSide.set(edgeSideKey, []);
        emittersByEdgeAndSide.get(edgeSideKey).push(emitter);
        const stationKey = `${emitter.edge}:${emitter.edgeS.toFixed(6)}`;
        if (!sidesByStation.has(stationKey)) sidesByStation.set(stationKey, []);
        sidesByStation.get(stationKey).push(emitter.side);
      }
      assert.equal(visualInstanceIndices.size, emitters.length);
      assert.equal(housingInstanceIndices.size, emitters.length);
      for (const [stationKey, sides] of sidesByStation) {
        assert.deepEqual(
          [...sides].sort((left, right) => left - right),
          [-1, 1],
          `Tunnel station ${stationKey} does not own exactly two paired luminaires`
        );
      }

      const stationSignature = [];
      const orderedEmitterGroups = [...emittersByEdgeAndSide.entries()]
        .sort(([left], [right]) => left.localeCompare(right));
      for (const [edgeSideKey, edgeEmitters] of orderedEmitterGroups) {
        edgeEmitters.sort((left, right) => left.edgeS - right.edgeS);
        const maximumSpacingM = edgeEmitters[0].profileKind === 'underground-tunnel' ? 22 : 28;
        for (let index = 1; index < edgeEmitters.length; index++) {
          assert.ok(
            edgeEmitters[index].edgeS - edgeEmitters[index - 1].edgeS
              <= maximumSpacingM + 0.000_001,
            `${edgeSideKey} exceeds its ${maximumSpacingM}m luminaire spacing contract`
          );
        }
        stationSignature.push([
          edgeSideKey,
          ...edgeEmitters.map((emitter) => Number(emitter.edgeS.toFixed(6)))
        ]);
      }
      stationSignaturesByQuality.set(qualityProfileId, stationSignature);
    }

    assert.deepEqual(
      stationSignaturesByQuality.get('mobile'),
      stationSignaturesByQuality.get('desktop'),
      'Tunnel luminaire stations changed with quality-tier rib density'
    );
  } finally {
    for (const visual of visuals) visual.dispose();
    restoreDocument();
  }
});

test('resident tunnel road, shell, wall, ceiling, and rib irradiance stay in existing draw budgets', () => {
  const restoreDocument = installCanvasDocumentStub();
  let visual = null;
  try {
    visual = buildProductionVisual({ qualityProfileId: 'desktop' });
    const geometry = visual.roadShell.geometry;
    const position = geometry.getAttribute('position');
    const irradiance = geometry.getAttribute('staticTunnelIrradiance');
    assert.ok(irradiance, 'Resident road geometry published no tunnel irradiance attribute');
    assert.equal(irradiance.itemSize, 1);
    assert.equal(irradiance.count, position.count);

    let positiveVertexCount = 0;
    let zeroVertexCount = 0;
    let maximum = 0;
    for (const value of irradiance.array) {
      assert.ok(Number.isFinite(value));
      assert.ok(value >= 0);
      if (value > 0) positiveVertexCount++;
      else zeroVertexCount++;
      maximum = Math.max(maximum, value);
    }
    assert.ok(positiveVertexCount > 0, 'No resident tunnel road vertex receives authored light');
    assert.ok(zeroVertexCount > 0, 'Open road incorrectly receives tunnel light');
    assert.ok(maximum >= 0.29 && maximum <= 0.381);
    assert.equal(visual.diagnostics.staticTunnelIrradianceContractVersion, 2);
    assert.equal(visual.diagnostics.staticTunnelIrradianceAttribute, true);
    assert.equal(visual.diagnostics.staticTunnelIrradianceDistanceGated, false);
    assert.equal(visual.diagnostics.staticTunnelIrradiancePositiveVertexCount, positiveVertexCount);
    assert.ok(Math.abs(visual.diagnostics.staticTunnelIrradianceMaximum - maximum) <= 0.000_001);
    assert.equal(visual.diagnostics.staticTunnelIrradianceAdditionalDrawGroupCount, 0);
    assert.equal(visual.diagnostics.staticTunnelIrradianceAdditionalObjectCount, 0);
    assert.equal(visual.diagnostics.staticTunnelIrradianceReceiverMeshCount, 3);

    const shellPosition = visual.tunnelShells.geometry.getAttribute('position');
    const shellIrradiance = visual.tunnelShells.geometry.getAttribute('staticTunnelIrradiance');
    assert.ok(shellIrradiance, 'Continuous tunnel shell published no resident irradiance');
    assert.equal(shellIrradiance.itemSize, 1);
    assert.equal(shellIrradiance.count, shellPosition.count);
    assert.equal(
      [...shellIrradiance.array].every((value) => Number.isFinite(value) && value > 0),
      true,
      'A resident tunnel wall or ceiling vertex still switches completely dark'
    );
    assert.equal(visual.diagnostics.tunnelShellStaticIrradianceContractVersion, 2);
    assert.equal(visual.diagnostics.tunnelShellStaticIrradianceAttribute, true);
    assert.equal(visual.diagnostics.tunnelShellStaticIrradianceDistanceGated, false);
    assert.equal(
      visual.diagnostics.tunnelShellStaticIrradiancePositiveVertexCount,
      shellIrradiance.count
    );
    assert.ok(visual.diagnostics.tunnelShellStaticIrradianceMinimumReceiver > 0);
    assert.ok(visual.diagnostics.tunnelShellStaticIrradianceMaximum <= 0.38 * 0.72 + 0.000_001);

    const structureIrradiance = visual.beams.geometry.getAttribute('staticTunnelIrradiance');
    assert.ok(structureIrradiance?.isInstancedBufferAttribute);
    let positiveStructureInstanceCount = 0;
    let maximumStructureIrradiance = 0;
    for (let index = 0; index < visual.beams.count; index++) {
      const value = structureIrradiance.getX(index);
      assert.ok(Number.isFinite(value) && value >= 0);
      if (value > 0) positiveStructureInstanceCount++;
      maximumStructureIrradiance = Math.max(maximumStructureIrradiance, value);
    }
    assert.ok(positiveStructureInstanceCount > visual.diagnostics.tunnelRibCount * 3);
    assert.equal(visual.diagnostics.tunnelStructureStaticIrradianceAttribute, true);
    assert.equal(
      visual.diagnostics.tunnelStructureStaticIrradiancePositiveInstanceCount,
      positiveStructureInstanceCount
    );
    assert.ok(visual.diagnostics.tunnelStructureStaticIrradianceMinimumReceiver > 0);
    assert.ok(Math.abs(
      visual.diagnostics.tunnelStructureStaticIrradianceMaximum - maximumStructureIrradiance
    ) <= 0.000_001);

    const reservedDrawGroupCount = visual.group.children.length;
    let spotLightCount = 0;
    visual.group.traverse((object) => {
      if (object.isSpotLight) spotLightCount++;
    });
    assert.equal(spotLightCount, 0, 'Static tunnel road light added an unbudgeted SpotLight');
    for (const renderQualityId of ['low', 'medium', 'high', 'medium']) {
      visual.setRenderQuality(renderQualityId);
      assert.equal(visual.group.children.length, reservedDrawGroupCount);
      assert.equal(visual.roadShell.geometry, geometry);
      assert.equal(visual.roadShell.material.emissive.getHex(), 0);
      assert.equal(visual.roadShell.material.emissiveIntensity, 1);
      assert.equal(visual.roadShell.material.userData.neonV23StaticTunnelIrradiance, 2);
      assert.equal(visual.tunnelShells.material.emissive.getHex(), 0);
      assert.equal(visual.tunnelShells.material.userData.neonV23StaticTunnelIrradiance, 2);
      assert.equal(visual.beams.material.emissive.getHex(), 0);
      assert.equal(visual.beams.material.userData.neonV23StaticTunnelIrradiance, 2);
    }

    const irradianceHelper = extractFunctionDeclaration('sampleEdgeStaticTunnelIrradiance');
    assert.doesNotMatch(irradianceHelper, /player|camera|portal|frameTime|distanceToSquared/);
    assert.doesNotMatch(source, /totalEmissiveRadiance \+=/);
    assert.match(source, /irradiance \+= PI \* vec3\(/);
    assert.match(source, /includeStaticTunnelIrradiance: true/);
  } finally {
    visual?.dispose();
    restoreDocument();
  }
});

test('Low, Medium, and High road PBR stay prebuilt, reversible, and outside route authority', () => {
  for (const marker of [
    "geometry.setAttribute('roadCoord'",
    'function createProceduralRoadTextureSet(',
    'function installStandardRoadShader(',
    'function installUltraRoadShader(',
    'function installUltraStructureShader(',
    'neon-v23-standard-road-coordinate-v4',
    'neon-v23-low-road-static-tunnel-irradiance-v3',
    'neon-v23-ultra-road-coordinate-v6',
    "low-physical-without-coordinate-shader",
    'neonV23RoadMicroLengthSquared',
    'step(1.0e-10, neonV23RoadMicroLengthSquared)',
    'inversesqrt(max(neonV23RoadMicroLengthSquared',
    'mainline: 0xa9_aaa5',
    'collector: 0xa3_a6_a2',
    "'direct-ramp': 0xa6_a7_a2",
    "'loop-ramp': 0xad_aca6",
    "'opposing-crossover': 0xa3_a8_a6",
    "'opposing-recovery-proxy': 0xa3_a8_a6",
    'texture.repeat.set(1.25, 0.162_5)',
    'ultraRoadMaterial.normalScale.set(0.085, 0.085)',
    '0.58 + (heights[index] - 0.5) * 0.102',
    'roadCoord.y / 45.0',
    'smoothstep(0.06, 0.18, distanceToJoint)',
    'vec2(24.0, 0.7)',
    'diffuseColor.rgb *= vec3(0.88)',
    '0.02375 * neonV23RoadDetailFade',
    'vec2(32.0, 1.0)',
    '0.054 * neonV23RoadDetailFade',
    'mix(neonV23RoadGeometricNormal, normal, neonV23RoadDetailFade)',
    'vec2(45.75, 1.75)',
    '0.03 * neonV23RoadDetailFade',
    'width = 0.19, lift = 0.006',
    'height: 0.112',
    'polygonOffsetFactor: -1',
    'polygonOffsetUnits: -1',
    'road-coordinate-contract-invalid',
    'activeRoadCoordinate.itemSize === 2',
    'includeStaticTunnelIrradiance: true',
    'createRoadMarkingRibbonGeometry',
    'ultraStaticMarkings.visible = highEnabled',
    "const normalizedId = id === 'high' ? 'high' : id === 'low' ? 'low' : 'medium'"
  ]) {
    assert.ok(source.includes(marker), `High road contract is missing ${marker}`);
  }
  assert.match(source, /roadCoordinates\[roadCoordinateOffset\] = rowState\.halfWidth > 0[\s\S]*?lateral \/ rowState\.halfWidth/);
  assert.doesNotMatch(source, /roadCoordinates\[roadCoordinateOffset\] = halfWidth > 0/);
  assert.doesNotMatch(source, /= normalize\(cross\(neonV23RoadDx, neonV23RoadDy\)\)/);
  const ultraRoadShaderStart = source.indexOf('function installUltraRoadShader(THREE, material, tunnelLightingUniforms)');
  const ultraRoadShaderEnd = source.indexOf(
    'function installUltraStructureShader(',
    ultraRoadShaderStart
  );
  assert.ok(ultraRoadShaderStart >= 0 && ultraRoadShaderEnd > ultraRoadShaderStart);
  const ultraRoadShader = source.slice(ultraRoadShaderStart, ultraRoadShaderEnd);
  assert.doesNotMatch(ultraRoadShader, /vec2\(96\.0, 2\.8\)|vec2\(128\.0, 4\.0\)|vec2\(183\.0, 7\.0\)/);
  assert.doesNotMatch(ultraRoadShader, /roadCoord\.y \/ 18\.0|neonV23RoadJointMask \* 0\.24/);

  const qualitySwitchStart = source.indexOf('function setRenderQuality(id)');
  const qualitySwitchEnd = source.indexOf('function dispose()', qualitySwitchStart);
  assert.ok(qualitySwitchStart >= 0 && qualitySwitchEnd > qualitySwitchStart);
  const qualitySwitch = source.slice(qualitySwitchStart, qualitySwitchEnd);
  assert.match(
    qualitySwitch,
    /const selectedRoadMaterial = highEnabled[\s\S]*?\? ultraRoadMaterial[\s\S]*?: normalizedId === 'low' \? lowRoadMaterial : roadMaterial;/
  );
  assert.match(qualitySwitch, /roadShell\.material = selectedRoadMaterial;/);
  assert.match(qualitySwitch, /recoveryRoadShell\.material = selectedRoadMaterial;/);
  assert.match(qualitySwitch, /supports\.material = highEnabled \? ultraSupportMaterial : supportMaterial/);
  assert.match(
    qualitySwitch,
    /tunnelShells\.material = highEnabled \? ultraTunnelShellMaterial : tunnelShellMaterial/
  );
  assert.doesNotMatch(qualitySwitch, /PathPlan|collision|successor|routeCursor|state\./);
});
