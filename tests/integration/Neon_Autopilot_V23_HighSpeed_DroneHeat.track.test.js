#!/usr/bin/env node
/* Pure-Node regression contract for the V23 directed cloverleaf graph, dynamics, itinerary, and launch ramp. */
'use strict';

const path = require('node:path');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const gameplayCore = require(path.join(
  PROJECT_ROOT,
  'src/gameplay/Neon_Autopilot_V23_HighSpeed_DroneHeat.gameplay-core.js'
));
global.window = globalThis;
const originalConsoleWarn = console.warn;
console.warn = () => {};
const vendorThree = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
console.warn = originalConsoleWarn;
globalThis.THREE = vendorThree;
require(path.join(PROJECT_ROOT, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-tiles.js'));

const modeling = globalThis.NeonV23Modeling;
const track = globalThis.NeonV23Track;
const cloverleafVisuals = globalThis.NeonV23CloverleafVisuals;
const cloverleafTilePool = globalThis.NeonV23CloverleafTilePool;
const DEGREES = 180 / Math.PI;
const PORTS = Object.freeze(['south', 'west', 'north', 'east']);
const KINDS = Object.freeze(['straight', 'right', 'left']);
const EXPECTED_EXITS = Object.freeze({
  south: Object.freeze({ straight: 'north', right: 'east', left: 'west' }),
  west: Object.freeze({ straight: 'east', right: 'south', left: 'north' }),
  north: Object.freeze({ straight: 'south', right: 'west', left: 'east' }),
  east: Object.freeze({ straight: 'west', right: 'north', left: 'south' })
});
const EXPECTED_ROUTE_TYPES = Object.freeze({
  straight: 'surface',
  right: 'mountain-tunnel',
  left: 'underground-tunnel'
});
const OPPOSITE_PORTS = Object.freeze({ north: 'south', east: 'west', south: 'north', west: 'east' });
const BIDIRECTIONAL_OUTBOUND_EXTENSION = 'outbound-extension';
const BIDIRECTIONAL_OPPOSING_INTERTILE = 'opposing-intertile';
const BUILD_SLICE_BUDGET_MS = 4;
const DETERMINISTIC_CLOCK_TICK_MS = 0.025;
// PC Ultra adds one bounded road-coordinate authoring pass without relaxing the per-slice time contract.
const MAX_DETERMINISTIC_BUILD_STEPS = 8_192;
const MAX_RUNTIME_SUPPORT_PLANNER_STEPS = 320;
const JUMP_PLATFORM_AUDIT_SPEED_KMH = 260;
const JUMP_PLATFORM_AUDIT_SPEED_MPS = JUMP_PLATFORM_AUDIT_SPEED_KMH / 3.6;
const JUMP_PLATFORM_AUDIT_GRAVITY_MPS2 = 9.81;
const JUMP_PLATFORM_OPPOSING_CENTER_LATERAL_M = -24;
const JUMP_PLATFORM_AUDIT_CADENCES_HZ = Object.freeze([30, 60, 120]);
// This is the runtime's saturated 160km/h lateral endpoint, which remains authoritative at the 260km/h jump speed.
const JUMP_PLATFORM_AUDIT_LATERAL_KINEMATICS = Object.freeze({
  maximumSpeedMps: 10,
  accelerationMps2: 17,
  dragPerSecond: 2.4
});
const AUTO_CURVE_LATERAL_ACCELERATION_MPS2 = 5.5;
const SERVICE_BRAKE_DECELERATION_MPS2 =
  gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.serviceBrakeDecelerationMps2;

function check(condition, message, details = null) {
  if (condition) return;
  const suffix = details === null ? '' : `: ${JSON.stringify(details)}`;
  throw new Error(`${message}${suffix}`);
}

function checkNear(actual, expected, tolerance, message) {
  check(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    message,
    { actual, expected, tolerance }
  );
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Project one point onto a finite XZ segment for independent road-envelope checks. */
function pointSegmentDistanceSquared(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0.000_001
    ? clamp(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0, 1)
    : 0;
  const x = ax + dx * t;
  const z = az + dz * t;
  return { distanceSquared: (px - x) ** 2 + (pz - z) ** 2, t };
}

/**
 * Audit the exact merged attribute consumed by the High shader. Vertical caps may intentionally collapse one
 * texture axis, but every upward-facing road surface must retain a finite two-dimensional coordinate field.
 */
function inspectVisibleRoadCoordinateContract(geometry) {
  const positions = geometry?.getAttribute?.('position');
  const roadCoordinates = geometry?.getAttribute?.('roadCoord');
  const indices = geometry?.index;
  const report = {
    attributeCountMismatch: !positions
      || !roadCoordinates
      || roadCoordinates.itemSize !== 2
      || roadCoordinates.count !== positions.count,
    nonFiniteComponentCount: 0,
    junctionSurfaceRangeCount: geometry?.userData?.junctionSurfaceRanges?.length || 0,
    visibleTopTriangleCount: 0,
    visibleTopDegenerateCoordinateTriangleCount: 0,
    visibleTopConstantCoordinateTriangleCount: 0,
    visibleTopZeroCoordinateTriangleCount: 0
  };
  if (report.attributeCountMismatch) return report;
  for (const value of roadCoordinates.array) {
    if (!Number.isFinite(value)) report.nonFiniteComponentCount++;
  }
  const vertexAt = (offset) => indices ? indices.getX(offset) : offset;
  // Only dedicated top-surface ranges belong in this audit. Falling back to the sealed road batch mixes in
  // intentionally collapsed cap coordinates and falsely treats structural end seals as shader-facing pavement.
  const ranges = geometry?.userData?.junctionSurfaceRanges || [];
  for (const range of ranges) {
    const rangeEnd = range.indexStart + range.indexCount;
    for (let offset = range.indexStart; offset + 2 < rangeEnd; offset += 3) {
      const a = vertexAt(offset);
      const b = vertexAt(offset + 1);
      const c = vertexAt(offset + 2);
      const ax = positions.array[a * 3];
      const ay = positions.array[a * 3 + 1];
      const az = positions.array[a * 3 + 2];
      const abx = positions.array[b * 3] - ax;
      const aby = positions.array[b * 3 + 1] - ay;
      const abz = positions.array[b * 3 + 2] - az;
      const acx = positions.array[c * 3] - ax;
      const acy = positions.array[c * 3 + 1] - ay;
      const acz = positions.array[c * 3 + 2] - az;
      const normalX = aby * acz - abz * acy;
      const normalY = abz * acx - abx * acz;
      const normalZ = abx * acy - aby * acx;
      const normalLength = Math.hypot(normalX, normalY, normalZ);
      if (normalLength <= 0.000_000_000_1 || normalY / normalLength < 0.7) continue;
      report.visibleTopTriangleCount++;
      const au = roadCoordinates.array[a * 2];
      const av = roadCoordinates.array[a * 2 + 1];
      const bu = roadCoordinates.array[b * 2];
      const bv = roadCoordinates.array[b * 2 + 1];
      const cu = roadCoordinates.array[c * 2];
      const cv = roadCoordinates.array[c * 2 + 1];
      const coordinateAreaTwice = Math.abs((bu - au) * (cv - av) - (bv - av) * (cu - au));
      if (coordinateAreaTwice <= 0.000_000_000_1) {
        report.visibleTopDegenerateCoordinateTriangleCount++;
      }
      if (au === bu && au === cu && av === bv && av === cv) {
        report.visibleTopConstantCoordinateTriangleCount++;
        if (au === 0 && av === 0) report.visibleTopZeroCoordinateTriangleCount++;
      }
    }
  }
  return report;
}

/** Prove the authored arrow tip and the production right/up/back mount agree for every road orientation. */
function validateRoadArrowDirection(result) {
  const contract = cloverleafVisuals.roadArrowDirectionContract;
  check(Object.isFrozen(contract)
    && Object.isFrozen(contract.profileForwardAxis)
    && Object.isFrozen(contract.localForwardAxis),
  'Road-arrow direction contract must be immutable');
  checkNear(contract.geometryPitchRadians, Math.PI * 0.5, 0.000_000_001,
    'Road-arrow profile is not mounted with the required positive quarter-turn');

  const authoredForward = new vendorThree.Vector3(
    contract.profileForwardAxis.x,
    contract.profileForwardAxis.y,
    contract.profileForwardAxis.z
  ).applyAxisAngle(new vendorThree.Vector3(1, 0, 0), contract.geometryPitchRadians).normalize();
  checkNear(authoredForward.x, contract.localForwardAxis.x, 0.000_000_001,
    'Road-arrow authored tip has the wrong mounted X axis');
  checkNear(authoredForward.y, contract.localForwardAxis.y, 0.000_000_001,
    'Road-arrow authored tip has the wrong mounted Y axis');
  checkNear(authoredForward.z, contract.localForwardAxis.z, 0.000_000_001,
    'Road-arrow authored tip has the wrong mounted Z axis');

  const baseFrames = [
    { label: 'north', tangent: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
    { label: 'east', tangent: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
    { label: 'south', tangent: [0, 0, 1], right: [-1, 0, 0], up: [0, 1, 0] },
    { label: 'west', tangent: [-1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] }
  ];
  const bankedRotation = new vendorThree.Quaternion().setFromEuler(
    new vendorThree.Euler(0.18, -0.73, 0.24, 'YXZ')
  );
  baseFrames.push({
    label: 'banked-grade',
    tangent: new vendorThree.Vector3(0, 0, -1).applyQuaternion(bankedRotation).toArray(),
    right: new vendorThree.Vector3(1, 0, 0).applyQuaternion(bankedRotation).toArray(),
    up: new vendorThree.Vector3(0, 1, 0).applyQuaternion(bankedRotation).toArray()
  });

  let minimumForwardDot = 1;
  for (const frame of baseFrames) {
    const tangent = new vendorThree.Vector3(...frame.tangent).normalize();
    const basis = new vendorThree.Matrix4().makeBasis(
      new vendorThree.Vector3(...frame.right).normalize(),
      new vendorThree.Vector3(...frame.up).normalize(),
      tangent.clone().multiplyScalar(-1)
    );
    const mountedForward = new vendorThree.Vector3(
      contract.localForwardAxis.x,
      contract.localForwardAxis.y,
      contract.localForwardAxis.z
    ).applyQuaternion(new vendorThree.Quaternion().setFromRotationMatrix(basis)).normalize();
    const forwardDot = mountedForward.dot(tangent);
    minimumForwardDot = Math.min(minimumForwardDot, forwardDot);
    check(forwardDot >= contract.minimumForwardDot,
      `Road arrow points against the ${frame.label} route tangent`, { forwardDot });
  }
  result.frameCount = baseFrames.length;
  result.minimumForwardDot = minimumForwardDot;
  result.geometryPitchRadians = contract.geometryPitchRadians;
}

/**
 * Advance the production slice scheduler with a fixed monotonic clock quantum.
 * This keeps regression coverage on yielding and bounded completion independent
 * of host load; real elapsed time belongs to the separate non-gating benchmark.
 */
function withDeterministicClock(callback) {
  const hostPerformance = globalThis.performance;
  let nowMs = 0;
  globalThis.performance = Object.freeze({
    now() {
      const sampledAt = nowMs;
      nowMs += DETERMINISTIC_CLOCK_TICK_MS;
      return sampledAt;
    }
  });
  try {
    return callback();
  } finally {
    globalThis.performance = hostPerformance;
  }
}

/** Minimal server-only THREE surface exercises the production BufferGeometry builder without WebGL or a DOM. */
function createGeometryAuditThree() {
  let nextGeometryId = 0;
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
    }

    getX(index) {
      return this.array[index * this.itemSize];
    }
  }
  class Float32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize) {
      super(array instanceof Float32Array ? array : new Float32Array(array), itemSize);
    }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }
  class Sphere {
    constructor(center = new Vector3(), radius = 0) {
      this.center = center;
      this.radius = radius;
    }
  }
  class BufferGeometry {
    constructor() {
      this.isBufferGeometry = true;
      this.uuid = `node-audit-${++nextGeometryId}`;
      this.attributes = {};
      this.index = null;
      this.userData = {};
      this.boundingSphere = null;
    }

    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
      return this;
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    setIndex(attribute) {
      this.index = attribute;
      return this;
    }

    computeVertexNormals() {
      const position = this.getAttribute('position');
      if (position && !this.getAttribute('normal')) {
        this.setAttribute('normal', new BufferAttribute(new Float32Array(position.array.length), 3));
      }
      return this;
    }

    computeBoundingSphere() {
      this.boundingSphere = new Sphere();
      return this;
    }

    dispose() {
      this.disposed = true;
    }
  }
  class Color {
    constructor(hex = 0) {
      this.r = ((hex >>> 16) & 255) / 255;
      this.g = ((hex >>> 8) & 255) / 255;
      this.b = (hex & 255) / 255;
    }
  }
  return Object.freeze({
    BufferAttribute,
    Float32BufferAttribute,
    BufferGeometry,
    Vector3,
    Sphere,
    Color
  });
}

function vectorAngleDegrees(a, b) {
  const dot = a.tangentX * b.tangentX + a.tangentY * b.tangentY + a.tangentZ * b.tangentZ;
  return Math.acos(clamp(dot, -1, 1)) * DEGREES;
}

function forEachEdgeSample(edge, step, callback) {
  callback(track.sampleEdge(edge.id, 0, 0, {}), 0);
  for (let edgeS = step; edgeS < edge.length; edgeS += step) {
    callback(track.sampleEdge(edge.id, edgeS, 0, {}), edgeS);
  }
  callback(track.sampleEdge(edge.id, edge.length, 0, {}), edge.length);
}

function accumulatedTurnDegrees(edgeIds) {
  let previousHeading = null;
  let accumulated = 0;
  for (const edgeId of edgeIds) {
    const edge = track.getEdge(edgeId);
    forEachEdgeSample(edge, 1, (sample) => {
      if (previousHeading !== null) accumulated += normalizedAngle(sample.heading - previousHeading);
      previousHeading = sample.heading;
    });
  }
  return accumulated * DEGREES;
}

function validateGraphAndMovements(summary) {
  const graph = track.graph;
  check(graph && graph.version === track.CLOVERLEAF_GRAPH_VERSION, 'Graph version is not public and stable');
  check(graph.nodes.length === 24, 'Unexpected cloverleaf node count', graph.nodes.length);
  check(graph.edges.length === 28, 'Unexpected cloverleaf edge count', graph.edges.length);
  check(graph.movements.length === 12, 'The four-by-three movement matrix is incomplete', graph.movements.length);
  check(new Set(graph.nodes.map((node) => node.id)).size === graph.nodes.length, 'Node ids are not unique');
  check(new Set(graph.edges.map((edge) => edge.id)).size === graph.edges.length, 'Edge ids are not unique');
  check(new Set(graph.movements.map((movement) => movement.id)).size === graph.movements.length, 'Movement ids are not unique');
  check(new Set(graph.edges.map((edge) => edge.surfaceId)).size === graph.edges.length, 'Physical surface ids are not unique');

  let maximumTurnErrorDegrees = 0;
  for (const entryPort of PORTS) {
    const enumerated = track.enumerateMovements(entryPort);
    check(enumerated.length === 3, 'Entry does not expose three movements', { entryPort, count: enumerated.length });
    check(new Set(enumerated.map((movement) => movement.movementId)).size === 3, 'Entry exposes duplicate transitions', entryPort);
    for (const kind of KINDS) {
      const movementId = `${entryPort}-${kind}`;
      const movement = track.getMovement(movementId);
      check(movement !== null, 'Movement is missing', movementId);
      check(movement.entryPort === entryPort, 'Movement entry port is wrong', movementId);
      check(movement.exitPort === EXPECTED_EXITS[entryPort][kind], 'Movement exit port is wrong', movementId);
      check(movement.kind === kind, 'Movement kind is wrong', movementId);
      check(movement.routeType === EXPECTED_ROUTE_TYPES[kind], 'Movement route type is wrong', movementId);
      check(new Set(movement.edgeIds).size === movement.edgeIds.length, 'Movement contains a graph cycle', movementId);
      check(movement.cumulativeLengths.length === movement.edgeIds.length, 'Movement cumulative lengths are incomplete', movementId);

      const firstEdge = track.getEdge(movement.edgeIds[0]);
      const finalEdge = track.getEdge(movement.edgeIds.at(-1));
      check(track.getNode(firstEdge.from)?.kind === 'entry', 'Movement does not start at an entry node', movementId);
      check(track.getNode(finalEdge.to)?.kind === 'exit', 'Movement does not terminate at an exit node', movementId);
      for (let edgeIndex = 0; edgeIndex < movement.edgeIds.length - 1; edgeIndex += 1) {
        const edge = track.getEdge(movement.edgeIds[edgeIndex]);
        const nextEdge = track.getEdge(movement.edgeIds[edgeIndex + 1]);
        check(edge.to === nextEdge.from, 'Movement edges are disconnected', {
          movementId,
          edgeId: edge.id,
          nextEdgeId: nextEdge.id
        });
      }

      const expectedTurnDegrees = kind === 'straight' ? 0 : kind === 'right' ? 90 : 270;
      const actualTurnDegrees = accumulatedTurnDegrees(movement.edgeIds);
      const turnErrorDegrees = Math.abs(actualTurnDegrees - expectedTurnDegrees);
      maximumTurnErrorDegrees = Math.max(maximumTurnErrorDegrees, turnErrorDegrees);
      checkNear(actualTurnDegrees, expectedTurnDegrees, 0.5, 'Movement turn angle is wrong');

      const singleTilePlan = track.createPathPlan({ movementId, singleTile: true });
      check(singleTilePlan.edgeIds.join('|') === movement.edgeIds.join('|'), 'Single-tile plan diverges from movement topology', movementId);
      check(singleTilePlan.edgeIndexById instanceof Map, 'Single-tile PathPlan omits its edge index', movementId);
      singleTilePlan.edgeIds.forEach((edgeId, index) => {
        check(singleTilePlan.edgeIndexById.get(edgeId) === index, 'Single-tile edge index is stale', { movementId, edgeId, index });
      });
      checkNear(singleTilePlan.length, movement.length, 0.000_001, 'Single-tile plan length is inconsistent');
      const itineraryPlan = track.createPathPlan({ movementId, futureMovementKind: 'straight' });
      check(itineraryPlan.edgeIndexById instanceof Map, 'Itinerary PathPlan omits its edge index', movementId);
      itineraryPlan.edgeIds.forEach((edgeId, index) => {
        check(itineraryPlan.edgeIndexById.get(edgeId) === index, 'Initial itinerary edge index is stale', { movementId, edgeId, index });
      });
      check(itineraryPlan.entryPort === entryPort, 'Runtime itinerary reused another entry tile', {
        movementId,
        actualEntryPort: itineraryPlan.entryPort
      });
      check(itineraryPlan.movementId === movementId, 'Runtime itinerary changed the requested first movement', {
        movementId,
        actualMovementId: itineraryPlan.movementId
      });
    }
  }

  summary.movements = graph.movements.length;
  summary.maximumTurnErrorDegrees = maximumTurnErrorDegrees;
}

function validateSeams(summary) {
  let maximumPositionJumpM = 0;
  let maximumBoundaryGapM = 0;
  let maximumTangentJumpDegrees = 0;
  let maximumGradeJumpDegrees = 0;

  for (const movement of track.graph.movements) {
    for (let edgeIndex = 0; edgeIndex < movement.edgeIds.length - 1; edgeIndex += 1) {
      const edge = track.getEdge(movement.edgeIds[edgeIndex]);
      const nextEdge = track.getEdge(movement.edgeIds[edgeIndex + 1]);
      const before = track.sampleEdge(edge.id, edge.length, 0, {});
      const after = track.sampleEdge(nextEdge.id, 0, 0, {});
      const positionJumpM = distance3(before, after);
      const tangentJumpDegrees = vectorAngleDegrees(before, after);
      const gradeJumpDegrees = Math.abs(Math.atan(before.grade) - Math.atan(after.grade)) * DEGREES;
      let boundaryGapM = 0;

      for (const side of [-1, 1]) {
        const beforeBoundary = track.sampleEdge(edge.id, edge.length, side * before.roadHalf, {});
        const afterBoundary = track.sampleEdge(nextEdge.id, 0, side * after.roadHalf, {});
        boundaryGapM = Math.max(boundaryGapM, distance3(beforeBoundary, afterBoundary));
      }

      maximumPositionJumpM = Math.max(maximumPositionJumpM, positionJumpM);
      maximumBoundaryGapM = Math.max(maximumBoundaryGapM, boundaryGapM);
      maximumTangentJumpDegrees = Math.max(maximumTangentJumpDegrees, tangentJumpDegrees);
      maximumGradeJumpDegrees = Math.max(maximumGradeJumpDegrees, gradeJumpDegrees);
      check(positionJumpM <= 0.02, 'Centreline seam exceeds 0.02m', { movementId: movement.id, positionJumpM });
      check(boundaryGapM <= 0.03, 'Road boundary seam exceeds 0.03m', { movementId: movement.id, boundaryGapM });
      check(tangentJumpDegrees <= 0.5, 'Tangent seam exceeds 0.5 degrees', { movementId: movement.id, tangentJumpDegrees });
      check(gradeJumpDegrees <= 0.25, 'Grade seam exceeds 0.25 degrees', { movementId: movement.id, gradeJumpDegrees });
    }
  }

  Object.assign(summary, {
    maximumPositionJumpM,
    maximumBoundaryGapM,
    maximumTangentJumpDegrees,
    maximumGradeJumpDegrees
  });
}

function scopedTemplateEdgeId(tile, baseEdgeId) {
  return tile.index === 0 ? baseEdgeId : `${tile.token}:${baseEdgeId}`;
}

function validateBidirectionalSeam(beforeEdge, afterEdge, context) {
  const before = track.sampleEdge(beforeEdge.id, beforeEdge.length, 0, {});
  const after = track.sampleEdge(afterEdge.id, 0, 0, {});
  const positionJumpM = distance3(before, after);
  const tangentJumpDegrees = vectorAngleDegrees(before, after);
  const gradeJumpDegrees = Math.abs(Math.atan(before.grade) - Math.atan(after.grade)) * DEGREES;
  let boundaryGapM = 0;

  for (const side of [-1, 1]) {
    const beforeBoundary = track.sampleEdge(beforeEdge.id, beforeEdge.length, side * before.roadHalf, {});
    const afterBoundary = track.sampleEdge(afterEdge.id, 0, side * after.roadHalf, {});
    boundaryGapM = Math.max(boundaryGapM, distance3(beforeBoundary, afterBoundary));
  }

  check(positionJumpM <= 0.02, 'Bidirectional visual centreline seam exceeds 0.02m', {
    ...context,
    beforeEdgeId: beforeEdge.id,
    afterEdgeId: afterEdge.id,
    positionJumpM
  });
  check(boundaryGapM <= 0.03, 'Bidirectional visual boundary seam exceeds 0.03m', {
    ...context,
    beforeEdgeId: beforeEdge.id,
    afterEdgeId: afterEdge.id,
    boundaryGapM
  });
  check(tangentJumpDegrees <= 0.5, 'Bidirectional visual tangent seam exceeds 0.5 degrees', {
    ...context,
    beforeEdgeId: beforeEdge.id,
    afterEdgeId: afterEdge.id,
    tangentJumpDegrees
  });
  check(gradeJumpDegrees <= 0.25, 'Bidirectional visual grade seam exceeds 0.25 degrees', {
    ...context,
    beforeEdgeId: beforeEdge.id,
    afterEdgeId: afterEdge.id,
    gradeJumpDegrees
  });
  return { positionJumpM, boundaryGapM, tangentJumpDegrees, gradeJumpDegrees };
}

function validateBidirectionalVisualEdgeContract(edge, pathPlan, context) {
  const ownerTile = pathPlan.tiles.find((tile) => tile.token === edge.tileToken);
  const expectedAirborneLandingSurface = edge.bidirectionalRole === BIDIRECTIONAL_OPPOSING_INTERTILE
    || (
      edge.bidirectionalRole === BIDIRECTIONAL_OUTBOUND_EXTENSION
      && ownerTile?.index > 0
      && edge.bidirectionalPort === ownerTile.entryPort
    );
  check(edge.runtimeKind === track.BIDIRECTIONAL_VISUAL_RUNTIME_KIND, 'Visual carriageway has the wrong runtime kind', {
    ...context,
    edgeId: edge.id,
    runtimeKind: edge.runtimeKind
  });
  check(
    edge.bidirectionalRole === BIDIRECTIONAL_OUTBOUND_EXTENSION
      || edge.bidirectionalRole === BIDIRECTIONAL_OPPOSING_INTERTILE,
    'Visual carriageway has an unknown bidirectional role',
    { ...context, edgeId: edge.id, role: edge.bidirectionalRole }
  );
  check(PORTS.includes(edge.bidirectionalPort), 'Visual carriageway has no stable port ownership', {
    ...context,
    edgeId: edge.id,
    port: edge.bidirectionalPort
  });
  check(edge.visualOnly === true && edge.gameplayReachable === false, 'Visual carriageway became gameplay-reachable', {
    ...context,
    edgeId: edge.id,
    visualOnly: edge.visualOnly,
    gameplayReachable: edge.gameplayReachable
  });
  check(edge.collisionEnabled === false, 'Visual carriageway acquired collision authority', {
    ...context,
    edgeId: edge.id,
    collisionEnabled: edge.collisionEnabled
  });
  check(
    edge.airborneLandingSurface === expectedAirborneLandingSurface,
    'Airborne landing authority does not match the complete destination-owned opposing carriageway',
    {
      ...context,
      edgeId: edge.id,
      role: edge.bidirectionalRole,
      airborneLandingSurface: edge.airborneLandingSurface
    }
  );
  check(edge.gameplayRandom === false, 'Visual carriageway may consume gameplay RNG', {
    ...context,
    edgeId: edge.id,
    gameplayRandom: edge.gameplayRandom
  });
  check(Array.isArray(edge.successors) && edge.successors.length === 0, 'Visual carriageway entered successor routing', {
    ...context,
    edgeId: edge.id,
    successors: edge.successors
  });
  check(
    !pathPlan.edgeIds.includes(edge.id) && !pathPlan.edgeIndexById.has(edge.id),
    'Visual carriageway entered PathPlan',
    { ...context, edgeId: edge.id }
  );
}

/**
 * Audit one itinerary's complete visual road contract. Destination ownership lets the next tile carry the
 * return carriageway, so selecting a new recovery or retiring the previous tile cannot expose a long dead end.
 */
function auditBidirectionalVisualPlan(pathPlan, label) {
  check(typeof track.getBidirectionalVisualEdgesForTile === 'function', 'Bidirectional visual edge API is missing');
  check(pathPlan.edgeIndexById instanceof Map, 'Bidirectional audit requires a PathPlan edge index', label);
  const recordsByToken = new Map();
  const visualEdgeIds = new Set();
  const result = {
    tileCount: 0,
    transitionCount: 0,
    coveredSourceTileCount: 0,
    visualEdgeChecks: 0,
    outboundExtensionChecks: 0,
    destinationConnectorChecks: 0,
    maximumPositionJumpM: 0,
    maximumBoundaryGapM: 0,
    maximumTangentJumpDegrees: 0,
    maximumGradeJumpDegrees: 0
  };

  for (const tile of pathPlan.tiles) {
    const defaultEdges = track.getBidirectionalVisualEdgesForTile(tile);
    const allVisualEdges = track.getBidirectionalVisualEdgesForTile(tile, {
      includeSelectedExit: true,
      includeLongCorridor: true
    });
    const outboundExtensions = defaultEdges.filter(
      (edge) => edge.bidirectionalRole === BIDIRECTIONAL_OUTBOUND_EXTENSION
    );
    const opposingConnectors = defaultEdges.filter(
      (edge) => edge.bidirectionalRole === BIDIRECTIONAL_OPPOSING_INTERTILE
    );
    const allOutboundExtensions = allVisualEdges.filter(
      (edge) => edge.bidirectionalRole === BIDIRECTIONAL_OUTBOUND_EXTENSION
    );

    const expectedDefaultExtensionCount = tile.opposingBypass === true ? 2 : 3;
    const expectedAllExtensionCount = tile.opposingBypass === true ? 3 : 4;
    check(
      outboundExtensions.length === expectedDefaultExtensionCount,
      'Tile does not retain the expected non-duplicated outbound extensions',
      {
      label,
      tileToken: tile.token,
      extensions: outboundExtensions.map((edge) => edge.id)
      }
    );
    check(
      new Set(outboundExtensions.map((edge) => edge.bidirectionalPort)).size
        === expectedDefaultExtensionCount
        && outboundExtensions.every((edge) => (
          edge.bidirectionalPort !== tile.exitPort
          && (tile.opposingBypass !== true || edge.bidirectionalPort !== tile.entryPort)
        )),
      'Default outbound extensions retain a selected or crossover-replaced ribbon',
      { label, tileToken: tile.token, exitPort: tile.exitPort }
    );
    check(
      allOutboundExtensions.length === expectedAllExtensionCount
        && PORTS.every((port) => (
          tile.opposingBypass === true && port === tile.entryPort
            ? !allOutboundExtensions.some((edge) => edge.bidirectionalPort === port)
            : allOutboundExtensions.some((edge) => edge.bidirectionalPort === port)
        )),
      'Full visual selector does not expose the non-duplicated outbound extension set',
      { label, tileToken: tile.token, ports: allOutboundExtensions.map((edge) => edge.bidirectionalPort) }
    );
    check(opposingConnectors.length === (tile.index > 0 ? 1 : 0), 'Destination-owned opposing connector count is wrong', {
      label,
      tileToken: tile.token,
      tileIndex: tile.index,
      connectors: opposingConnectors.map((edge) => edge.id)
    });
    if (tile.index > 0) {
      const connector = opposingConnectors[0];
      check(
        connector.tileToken === tile.token
          && connector.destinationTileIndex === tile.index
          && connector.previousTileIndex === tile.index - 1
          && connector.bidirectionalPort === tile.entryPort,
        'Opposing connector is not owned by its destination tile',
        {
          label,
          tileToken: tile.token,
          connectorId: connector.id,
          destinationTileIndex: connector.destinationTileIndex,
          previousTileIndex: connector.previousTileIndex
        }
      );
      result.destinationConnectorChecks++;
    }

    for (const edge of allVisualEdges) {
      validateBidirectionalVisualEdgeContract(edge, pathPlan, { label, tileToken: tile.token });
      visualEdgeIds.add(edge.id);
      result.visualEdgeChecks++;
    }
    result.tileCount++;
    result.outboundExtensionChecks += outboundExtensions.length;
    recordsByToken.set(tile.token, { outboundExtensions, opposingConnectors });
  }

  for (let tileIndex = 0; tileIndex < pathPlan.tiles.length - 1; tileIndex += 1) {
    const previousTile = pathPlan.tiles[tileIndex];
    const nextTile = pathPlan.tiles[tileIndex + 1];
    const previousRecoveryEdges = pathPlan.edgeIds
      .map((edgeId) => track.getEdge(edgeId))
      .filter((edge) => edge?.runtimeKind === 'recovery' && edge.tileToken === previousTile.token);
    const recoveryPorts = new Set(previousRecoveryEdges.map((edge) => edge.exitPort));
    const extensionPorts = recordsByToken.get(previousTile.token).outboundExtensions
      .map((edge) => edge.bidirectionalPort);
    const coveredPorts = new Set([...extensionPorts, ...recoveryPorts]);

    check(
      previousRecoveryEdges.length > 0
        && recoveryPorts.size === 1
        && recoveryPorts.has(previousTile.exitPort)
        && coveredPorts.size === PORTS.length
        && PORTS.every((port) => coveredPorts.has(port)),
      'Three extensions plus the selected recovery do not cover all four ports',
      {
        label,
        tileToken: previousTile.token,
        extensionPorts,
        recoveryPorts: [...recoveryPorts],
        coveredPorts: [...coveredPorts]
      }
    );
    check(nextTile.entryPort === OPPOSITE_PORTS[previousTile.exitPort], 'Adjacent tile entry does not oppose the selected exit', {
      label,
      previousTile: previousTile.token,
      nextTile: nextTile.token,
      exitPort: previousTile.exitPort,
      entryPort: nextTile.entryPort
    });

    const nextRecord = recordsByToken.get(nextTile.token);
    const nextExtension = nextRecord.outboundExtensions.find(
      (edge) => edge.bidirectionalPort === nextTile.entryPort
    );
    const connector = nextRecord.opposingConnectors[0];
    const nextOutbound = track.getEdge(scopedTemplateEdgeId(nextTile, `outbound-${nextTile.entryPort}`));
    const previousApproach = track.getEdge(
      scopedTemplateEdgeId(previousTile, `approach-${previousTile.exitPort}`)
    );
    check(nextOutbound && nextExtension && connector && previousApproach, 'Bidirectional intertile chain is incomplete', {
      label,
      previousTile: previousTile.token,
      nextTile: nextTile.token,
      nextOutbound: nextOutbound?.id || null,
      nextExtension: nextExtension?.id || null,
      connector: connector?.id || null,
      previousApproach: previousApproach?.id || null
    });

    const chain = [nextOutbound, nextExtension, connector, previousApproach];
    for (let edgeIndex = 0; edgeIndex < chain.length - 1; edgeIndex += 1) {
      const metrics = validateBidirectionalSeam(chain[edgeIndex], chain[edgeIndex + 1], {
        label,
        previousTile: previousTile.token,
        nextTile: nextTile.token,
        seamIndex: edgeIndex
      });
      result.maximumPositionJumpM = Math.max(result.maximumPositionJumpM, metrics.positionJumpM);
      result.maximumBoundaryGapM = Math.max(result.maximumBoundaryGapM, metrics.boundaryGapM);
      result.maximumTangentJumpDegrees = Math.max(
        result.maximumTangentJumpDegrees,
        metrics.tangentJumpDegrees
      );
      result.maximumGradeJumpDegrees = Math.max(result.maximumGradeJumpDegrees, metrics.gradeJumpDegrees);
    }
    result.transitionCount++;
    result.coveredSourceTileCount++;
  }

  const immutableEdgeIds = new Set(track.graph.edges.map((edge) => edge.id));
  check(track.graph.edges.length === 28 && Object.isFrozen(track.graph) && Object.isFrozen(track.graph.edges),
    'Bidirectional visuals mutated the immutable 28-edge gameplay graph');
  check([...visualEdgeIds].every((edgeId) => !immutableEdgeIds.has(edgeId)),
    'Bidirectional visual edge leaked into the immutable gameplay graph');
  for (const edge of [
    ...track.graph.edges,
    ...pathPlan.edgeIds.map((edgeId) => track.getEdge(edgeId)).filter(Boolean)
  ]) {
    check(
      !(edge.successors || []).some((successorId) => visualEdgeIds.has(successorId)),
      'A gameplay edge references a bidirectional visual successor',
      { label, edgeId: edge.id, successors: edge.successors }
    );
  }
  return result;
}

function validateBidirectionalVisualRoads(fiftyKmPlan, summary) {
  const totals = {
    movementPlans: 0,
    movementTransitions: 0,
    fiftyKmTransitions: 0,
    auditedTiles: 0,
    auditedTransitions: 0,
    coveredSourceTiles: 0,
    visualEdgeChecks: 0,
    outboundExtensionChecks: 0,
    destinationConnectorChecks: 0,
    maximumPositionJumpM: 0,
    maximumBoundaryGapM: 0,
    maximumTangentJumpDegrees: 0,
    maximumGradeJumpDegrees: 0,
    immutableGameplayEdges: track.graph.edges.length
  };
  const merge = (audit) => {
    totals.auditedTiles += audit.tileCount;
    totals.auditedTransitions += audit.transitionCount;
    totals.coveredSourceTiles += audit.coveredSourceTileCount;
    totals.visualEdgeChecks += audit.visualEdgeChecks;
    totals.outboundExtensionChecks += audit.outboundExtensionChecks;
    totals.destinationConnectorChecks += audit.destinationConnectorChecks;
    totals.maximumPositionJumpM = Math.max(totals.maximumPositionJumpM, audit.maximumPositionJumpM);
    totals.maximumBoundaryGapM = Math.max(totals.maximumBoundaryGapM, audit.maximumBoundaryGapM);
    totals.maximumTangentJumpDegrees = Math.max(
      totals.maximumTangentJumpDegrees,
      audit.maximumTangentJumpDegrees
    );
    totals.maximumGradeJumpDegrees = Math.max(totals.maximumGradeJumpDegrees, audit.maximumGradeJumpDegrees);
  };

  for (const entryPort of PORTS) {
    for (const kind of KINDS) {
      const movementId = `${entryPort}-${kind}`;
      const audit = auditBidirectionalVisualPlan(
        track.createPathPlan({ movementId, futureMovementKind: 'straight' }),
        movementId
      );
      totals.movementPlans++;
      totals.movementTransitions += audit.transitionCount;
      merge(audit);
    }
  }
  const fiftyKmAudit = auditBidirectionalVisualPlan(fiftyKmPlan, '50km-itinerary');
  totals.fiftyKmTransitions = fiftyKmAudit.transitionCount;
  merge(fiftyKmAudit);
  check(totals.movementPlans === PORTS.length * KINDS.length, 'Bidirectional movement matrix audit is incomplete', totals);
  check(
    totals.fiftyKmTransitions === fiftyKmPlan.tiles.length - 1,
    'Bidirectional 50km audit skipped an adjacent tile pair',
    totals
  );
  Object.assign(summary, totals, {
    defaultOutboundExtensionsPerTile: 3,
    destinationOwnedConnectorsPerNonInitialTile: 1
  });
}

function validateGeometry(summary) {
  const contract = track.graph.contract;
  const expectedContract = {
    portDistance: 840,
    decisionDistance: 840,
    decisionApproach: 1_080,
    collectorLength: 354,
    collectorOffset: 240,
    collectorTangent: 0,
    directRadius: 400,
    loopRadius: 175,
    transitionLength: 120,
    upperHeight: 9.0,
    deckThickness: 1.05,
    bridgeBeamDepth: 0.38,
    bridgePierRadius: 0.92,
    bridgeSupportRadius: 1.24,
    bridgeRoadGap: 1.8,
    bridgeSupportGap: 0.35,
    roadShellOuterMargin: 0.28,
    roadShellShoulderJoin: 0.22,
    tunnelClearance: 3.6,
    undergroundTunnelBasinHeight: -1,
    undergroundTunnelWallInset: 0.49,
    undergroundTunnelWallThickness: 0.54,
    undergroundTunnelRoofInset: 0.84,
    undergroundTunnelRoofOverhang: 0.08,
    undergroundTunnelRoofDepth: 0.46,
    tunnelShellSafetyGap: 0.25,
    tunnelPortalFrameDepth: 2.4,
    mountainTunnelClearance: 7.2,
    mountainTunnelRoofDepth: 1.15,
    mountainTunnelRoofInset: 1.34,
    tunnelLevelSeparation: 6.15,
    flyoverHeight: 13.5,
    maximumGrade: 0.06,
    sharedJunctionThroatLength: 164,
    turnBranchGradeStartDistance: 164,
    mergeGradeEndDistance: 164,
    loopMergeLevelLength: 136,
    collectorGradeStartDistance: 96,
    collectorGradeEndMargin: 16,
    collectorLevelEndLength: 12,
    collectorFeatureEaseLength: 3.5,
    lowerCollectorRiseStartDistance: 164,
    planarIntersectionCount: 20,
    junctionClearMargin: 3,
    tunnelJunctionMargin: 12
  };
  for (const [key, expected] of Object.entries(expectedContract)) {
    checkNear(contract[key], expected, 0.000_001, `Enlarged cloverleaf contract ${key} is wrong`);
  }
  check(contract.junctionSurfaceAuthority === 'level-overlap-edge-shells',
    'Split/merge surface authority drifted back to cosmetic overlap patches', contract.junctionSurfaceAuthority);
  check(
    track.graph.bounds.maxX - track.graph.bounds.minX >= 3_800
      && track.graph.bounds.maxZ - track.graph.bounds.minZ >= 3_800,
    'Enlarged cloverleaf bounds are unexpectedly small',
    track.graph.bounds
  );
  let maximumArcLengthErrorM = 0;
  let maximumAbsGrade = 0;
  let maximumBasisError = 0;
  let bankDirectionViolations = 0;
  const familyMetrics = new Map();

  for (const edge of track.graph.edges) {
    let previous = null;
    let chordLength = 0;
    let maximumCurvature = 0;
    let maximumBank = 0;
    forEachEdgeSample(edge, 0.5, (sample) => {
      if (previous) chordLength += distance3(previous, sample);
      previous = sample;
      maximumAbsGrade = Math.max(maximumAbsGrade, Math.abs(sample.grade));
      maximumCurvature = Math.max(maximumCurvature, Math.abs(sample.curvature));
      maximumBank = Math.max(maximumBank, Math.abs(sample.bank));
      if (Math.abs(sample.curvature) > 0.000_001
        && Math.abs(sample.bank) > 0.000_001
        && sample.curvature * sample.bank >= 0) {
        bankDirectionViolations++;
      }

      const tangentNorm = Math.hypot(sample.tangentX, sample.tangentY, sample.tangentZ);
      const rightNorm = Math.hypot(sample.rightX, sample.rightY, sample.rightZ);
      const upNorm = Math.hypot(sample.upX, sample.upY, sample.upZ);
      const tangentRight = sample.tangentX * sample.rightX + sample.tangentY * sample.rightY + sample.tangentZ * sample.rightZ;
      const tangentUp = sample.tangentX * sample.upX + sample.tangentY * sample.upY + sample.tangentZ * sample.upZ;
      const rightUp = sample.rightX * sample.upX + sample.rightY * sample.upY + sample.rightZ * sample.upZ;
      maximumBasisError = Math.max(
        maximumBasisError,
        Math.abs(tangentNorm - 1),
        Math.abs(rightNorm - 1),
        Math.abs(upNorm - 1),
        Math.abs(tangentRight),
        Math.abs(tangentUp),
        Math.abs(rightUp)
      );
    });

    const arcLengthErrorM = Math.abs(edge.length - chordLength);
    maximumArcLengthErrorM = Math.max(maximumArcLengthErrorM, arcLengthErrorM);
    check(arcLengthErrorM <= 0.05, '3D arc-length error exceeds 0.05m', { edgeId: edge.id, arcLengthErrorM });
    if (edge.family === 'direct-ramp' || edge.family === 'loop-ramp') {
      familyMetrics.set(edge.id, { family: edge.family, maximumCurvature, maximumBank });
    }
  }

  check(maximumAbsGrade <= 0.06 + 0.000_001, 'Maximum grade exceeds 6%', maximumAbsGrade);
  check(maximumBasisError <= 0.000_001, 'Edge local basis is not orthonormal', maximumBasisError);
  check(bankDirectionViolations === 0, 'Turning roads bank away from the inside of the curve', bankDirectionViolations);
  for (const [edgeId, metrics] of familyMetrics) {
    const expectedRadius = metrics.family === 'direct-ramp' ? contract.directRadius : contract.loopRadius;
    const expectedBankDegrees = metrics.family === 'direct-ramp' ? 6 : 10;
    check(metrics.maximumCurvature > 0, 'Turning edge has no curvature', edgeId);
    checkNear(1 / metrics.maximumCurvature, expectedRadius, 0.05, 'Turning radius is wrong');
    checkNear(metrics.maximumBank * DEGREES, expectedBankDegrees, 0.05, 'Maximum bank is wrong');
  }

  const raisedLowerCollectors = track.graph.edges.filter((edge) => (
    edge.family === 'collector'
      && edge.verticalFeatures?.some((feature) => feature.kind === 'tunnel-overpass')
  ));
  check(raisedLowerCollectors.length === 2,
    'Both lower collectors must publish one explicit overpass profile', raisedLowerCollectors);
  let maximumCollectorFeatureGrade = 0;
  let maximumCollectorFeatureBoundaryGrade = 0;
  for (const edge of raisedLowerCollectors) {
    check(edge.verticalFeatures.length === 1,
      'A lower collector has an ambiguous vertical feature stack', edge.id);
    const feature = edge.verticalFeatures[0];
    check(feature.profile === 'grade-limited-c2'
      && feature.startS >= contract.lowerCollectorRiseStartDistance
      && feature.startS < feature.riseEndS
      && feature.riseEndS < feature.fallStartS
      && feature.fallStartS < feature.endS
      && edge.length - feature.endS >= contract.collectorLevelEndLength - 0.000_001,
    'Lower collector overpass does not retain ordered, level junction approaches', { edgeId: edge.id, feature });
    checkNear(feature.transitionLength, contract.collectorFeatureEaseLength, 0.000_001,
      'Lower collector C2 transition length drifted');
    for (let edgeS = feature.startS; edgeS <= feature.endS; edgeS += 0.25) {
      maximumCollectorFeatureGrade = Math.max(
        maximumCollectorFeatureGrade,
        Math.abs(track.sampleEdge(edge.id, edgeS, 0, {}).grade)
      );
    }
    for (const [edgeS, nodeId] of [
      [contract.lowerCollectorRiseStartDistance - 1, edge.from],
      [edge.length - contract.collectorLevelEndLength * 0.5, edge.to]
    ]) {
      const boundary = track.sampleEdge(edge.id, edgeS, 0, {});
      maximumCollectorFeatureBoundaryGrade = Math.max(
        maximumCollectorFeatureBoundaryGrade,
        Math.abs(boundary.grade)
      );
      checkNear(boundary.y, track.getNode(nodeId).elevation,
        0.000_1, 'Lower collector overpass does not return to its junction elevation');
    }
    const plateau = track.sampleEdge(edge.id, feature.centerS, 0, {});
    checkNear(plateau.y, feature.heightDelta, 0.000_001,
      'Lower collector overpass plateau lost its declared height');
  }
  check(maximumCollectorFeatureGrade <= contract.maximumGrade + 0.000_001
    && maximumCollectorFeatureBoundaryGrade <= 0.000_001,
  'Lower collector overpass exceeds grade or boundary-tangent limits', {
    maximumCollectorFeatureGrade,
    maximumCollectorFeatureBoundaryGrade
  });

  const intersectionAudit = track.graph.intersectionAudit;
  check(intersectionAudit?.planarIntersectionCount === 20, 'Planar road-intersection inventory is incomplete', intersectionAudit);
  check(intersectionAudit.declaredIntersectionCount === 20, 'Not every planar intersection has a crossing contract', intersectionAudit);
  check(intersectionAudit.undeclaredIntersectionCount === 0, 'A planar road intersection is undeclared', intersectionAudit);
  check(intersectionAudit.intersections.every((intersection) => intersection.declared && intersection.crossingId),
    'Intersection audit contains an unresolved road pair', intersectionAudit);
  check(track.graph.crossings.length === 20, 'The cloverleaf must declare all twenty grade-separated crossings', track.graph.crossings.length);
  const minimumVerticalClearance = contract.minimumVerticalClearance;
  check(minimumVerticalClearance >= 7.5, 'Structural bridge clearance did not increase enough', minimumVerticalClearance);
  const physicalSpans = new Map();
  const physicalSpanMembership = new Map();
  const physicalSpansByUpperEdge = new Map();
  let minimumFullWidthClearance = Number.POSITIVE_INFINITY;
  let minimumTunnelShellGap = Number.POSITIVE_INFINITY;
  for (const crossing of track.graph.crossings) {
    physicalSpanMembership.set(
      crossing.physicalSpanId,
      (physicalSpanMembership.get(crossing.physicalSpanId) || 0) + 1
    );
    check(typeof crossing.physicalSpanId === 'string' && crossing.physicalSpanId.length > 0, 'Crossing omits physical span identity', crossing.id);
    check(
      crossing.lowerSpanStartS <= crossing.lowerEdgeS && crossing.lowerEdgeS <= crossing.lowerSpanEndS,
      'Lower crossing station falls outside its physical span',
      crossing.id
    );
    check(
      crossing.upperSpanStartS <= crossing.upperEdgeS && crossing.upperEdgeS <= crossing.upperSpanEndS,
      'Upper crossing station falls outside its physical span',
      crossing.id
    );
    const physicalSpan = physicalSpans.get(crossing.physicalSpanId);
    if (physicalSpan) {
      check(physicalSpan.upperEdgeId === crossing.upperEdgeId, 'Physical span aliases two upper edges', crossing.physicalSpanId);
      checkNear(crossing.upperSpanStartS, physicalSpan.startS, 0.000_001, 'Grouped bridge span start is inconsistent');
      checkNear(crossing.upperSpanEndS, physicalSpan.endS, 0.000_001, 'Grouped bridge span end is inconsistent');
    } else {
      const span = {
        upperEdgeId: crossing.upperEdgeId,
        startS: crossing.upperSpanStartS,
        endS: crossing.upperSpanEndS
      };
      physicalSpans.set(crossing.physicalSpanId, span);
      if (!physicalSpansByUpperEdge.has(crossing.upperEdgeId)) physicalSpansByUpperEdge.set(crossing.upperEdgeId, []);
      physicalSpansByUpperEdge.get(crossing.upperEdgeId).push(span);
    }
    check(crossing.soffitPlane && Number.isFinite(crossing.soffitHeight),
      'Crossing omitted its conservative soffit plane', crossing.id);
    check(crossing.clearance >= crossing.requiredClearance - 0.000_001,
      'Declared full-width crossing clearance is below its structural contract', crossing);
    minimumFullWidthClearance = Math.min(minimumFullWidthClearance, crossing.clearance);
    if (Number.isFinite(crossing.minimumTunnelShellGap)) {
      minimumTunnelShellGap = Math.min(
        minimumTunnelShellGap,
        crossing.minimumTunnelShellGap
      );
      check(crossing.minimumTunnelShellGap >= contract.tunnelShellSafetyGap - 0.000_001,
        'A complete tunnel roof shell intersects the upper bridge envelope', crossing);
    }
    const lowerEdge = track.getEdge(crossing.lowerEdgeId);
    const coveredClearance = lowerEdge.family === 'direct-ramp'
      ? contract.mountainTunnelClearance
      : lowerEdge.family === 'loop-ramp' ? contract.tunnelClearance : minimumVerticalClearance;
    for (const longitudinalRatio of [0.01, 0.5, 0.99]) {
      const station = crossing.lowerSpanStartS
        + (crossing.lowerSpanEndS - crossing.lowerSpanStartS) * longitudinalRatio;
      const stationCenter = track.sampleEdge(crossing.lowerEdgeId, station, 0, {});
      for (const lateralRatio of [-1, 0, 1]) {
        const sample = track.sampleEdge(
          crossing.lowerEdgeId,
          station,
          stationCenter.roadHalf * lateralRatio,
          {}
        );
        check(['cloverleaf-underpass', 'mountain-tunnel', 'underground-tunnel'].includes(sample.structure),
          'Crossing mask does not cover the lower road', {
          crossingId: crossing.id,
          station,
          lateralRatio,
          structure: sample.structure
          }
        );
        check(Number.isFinite(sample.ceilingHeight), 'Crossing mask omitted a finite structural ceiling', crossing.id);
        const crossingCeiling = crossing.soffitPlane.originHeight
          + crossing.soffitPlane.gradientX * (sample.x - crossing.soffitPlane.originX)
          + crossing.soffitPlane.gradientZ * (sample.z - crossing.soffitPlane.originZ);
        check(
          crossingCeiling - sample.y >= crossing.requiredClearance - 0.001,
          'Full-width soffit plane violates the crossing structural envelope',
          { crossingId: crossing.id, clearance: crossingCeiling - sample.y, crossing }
        );
        check(
          sample.ceilingHeight - sample.y >= coveredClearance - 0.01,
          'Banked lower-road edge violates structural bridge clearance',
          { crossingId: crossing.id, clearance: sample.ceilingHeight - sample.y, coveredClearance }
        );
      }
    }
  }
  for (const [upperEdgeId, spans] of physicalSpansByUpperEdge) {
    spans.sort((left, right) => left.startS - right.startS);
    for (let index = 1; index < spans.length; index++) {
      check(spans[index - 1].endS < spans[index].startS,
        'Disjoint bridge masks were merged into one physical span', { upperEdgeId, spans });
    }
  }
  check(physicalSpans.size === 16, 'Twenty crossings must cluster into sixteen physical bridge spans', physicalSpans.size);
  check([...physicalSpanMembership.values()].filter((count) => count === 2).length === 4
    && [...physicalSpanMembership.values()].filter((count) => count === 1).length === 12,
  'Physical span clustering did not merge only overlapping masks', physicalSpanMembership);
  check(intersectionAudit.physicalSpanCount === physicalSpans.size,
    'Intersection diagnostics disagree with physical span clustering', intersectionAudit);
  checkNear(
    intersectionAudit.minimumFullWidthClearance,
    minimumFullWidthClearance,
    0.000_001,
    'Intersection diagnostics report the wrong minimum full-width clearance'
  );
  checkNear(
    intersectionAudit.minimumTunnelShellGap,
    minimumTunnelShellGap,
    0.000_001,
    'Intersection diagnostics report the wrong full-shell structural gap'
  );

  const cameraPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const cameraStart = track.getInitialRouteCursor({ pathPlan: cameraPlan });
  const firstLowerCrossing = track.getUpcomingLowerCrossing(cameraStart, cameraPlan, 5_000);
  check(firstLowerCrossing !== null, 'Camera preview cannot find the first committed lower crossing');
  checkNear(
    firstLowerCrossing.ceilingHeight,
    contract.minimumVerticalClearance,
    0.001,
    'Camera preview ceiling diverges from the crossing contract'
  );
  const previewCursor = track.advanceCursor(
    cameraStart,
    Math.max(0, firstLowerCrossing.distance - 300),
    cameraPlan,
    {}
  );
  const previewCrossing = track.getUpcomingLowerCrossing(previewCursor, cameraPlan, 345);
  check(previewCrossing !== null, 'Camera preview disappeared inside the 300m descent envelope');
  checkNear(previewCrossing.distance, 300, 0.01, 'Camera preview distance is not measured along PathPlan');

  Object.assign(summary, {
    maximumArcLengthErrorM,
    maximumAbsGrade,
    maximumBankDegrees: 10,
    bankDirectionViolations,
    raisedLowerCollectors: raisedLowerCollectors.length,
    maximumCollectorFeatureGrade,
    maximumCollectorFeatureBoundaryGrade,
    directRadiusM: contract.directRadius,
    loopRadiusM: contract.loopRadius,
    minimumVerticalClearanceM: minimumVerticalClearance,
    minimumFullWidthClearanceM: minimumFullWidthClearance,
    minimumTunnelShellGapM: minimumTunnelShellGap,
    boundsSpanM: Math.max(
      track.graph.bounds.maxX - track.graph.bounds.minX,
      track.graph.bounds.maxZ - track.graph.bounds.minZ
    ),
    cameraCrossingPreviewDistanceM: previewCrossing.distance,
    crossings: track.graph.crossings.length,
    physicalBridgeSpans: physicalSpans.size
  });
}

function validateTunnelRoutes(summary) {
  const contract = track.graph.contract;
  check(
    contract.selectableRouteTypes.join('|') === 'surface|mountain-tunnel|underground-tunnel',
    'Selectable surface/tunnel contract is incomplete',
    contract.selectableRouteTypes
  );
  const mountainEdges = track.graph.edges.filter((edge) => (
    edge.tunnelProfiles?.some((profile) => profile.kind === 'mountain-tunnel')
  ));
  const undergroundEdges = track.graph.edges.filter((edge) => (
    edge.tunnelProfiles?.some((profile) => profile.kind === 'underground-tunnel')
  ));
  check(mountainEdges.length === 4, 'Every direct ramp must have one mountain tunnel', mountainEdges.length);
  check(undergroundEdges.length === 4, 'Every loop ramp must have one underground tunnel', undergroundEdges.length);
  const flyoverLoops = undergroundEdges.filter((edge) => (
    edge.heightProfile.segments?.some((segment) => segment.kind === 'flyover-level')
  ));
  check(flyoverLoops.length === 2, 'Both upper-to-lower loops must publish a flyover plateau', flyoverLoops);
  for (const edge of flyoverLoops) {
    const plateau = edge.heightProfile.segments.find((segment) => segment.kind === 'flyover-level');
    checkNear(plateau.startHeight, contract.flyoverHeight, 0.000_001, 'Flyover plateau start height drifted');
    checkNear(plateau.endHeight, contract.flyoverHeight, 0.000_001, 'Flyover plateau end height drifted');
  }

  const junctionEnvelopes = track.graph.junctionOverlapEnvelopes;
  check(junctionEnvelopes.length === 16, 'Not every split/merge publishes a junction overlap envelope', junctionEnvelopes.length);
  check(new Set(junctionEnvelopes.map((envelope) => envelope.nodeId)).size === 16,
    'Junction overlap diagnostics duplicate a graph node', junctionEnvelopes);
  const junctionKindCounts = new Map();
  let maximumSiblingOverlapDistance = 0;
  for (const nodeEnvelope of junctionEnvelopes) {
    junctionKindCounts.set(nodeEnvelope.nodeKind, (junctionKindCounts.get(nodeEnvelope.nodeKind) || 0) + 1);
    check(nodeEnvelope.edgeEnvelopes.length === 3,
      'A split/merge junction does not publish all three incident edges', nodeEnvelope);
    for (const edgeEnvelope of nodeEnvelope.edgeEnvelopes) {
      check(edgeEnvelope.overlapPairs.length === 2,
        'An incident edge does not publish both sibling overlap pairs', edgeEnvelope);
      const lastOverlapDistance = Math.max(
        ...edgeEnvelope.overlapPairs.map((pair) => pair.lastOverlapDistance)
      );
      maximumSiblingOverlapDistance = Math.max(maximumSiblingOverlapDistance, lastOverlapDistance);
      checkNear(
        edgeEnvelope.clearPlanarDistance,
        lastOverlapDistance + contract.junctionClearMargin,
        0.000_001,
        'Junction clear station omitted its structural sampling margin'
      );
      check(edgeEnvelope.overlapPairs.every((pair) => (
        pair.lastSurfaceOverlapDistance <= pair.lastOverlapDistance + 0.000_001
      )), 'Surface overlap exceeds the conservative portal plan envelope', edgeEnvelope);
    }
  }
  for (const kind of ['decision', 'collector-decision', 'loop-merge', 'direct-merge']) {
    check(junctionKindCounts.get(kind) === 4, 'Junction envelope kind coverage is incomplete', {
      kind,
      count: junctionKindCounts.get(kind)
    });
  }

  /*
   * The renderer deliberately has no apron/lens covering these nodes. Prove the complete sibling footprint is
   * one level, unbanked deck so independently sampled edge shells cannot scissor through each other at a fork.
   */
  const auditedJunctionPairs = new Set();
  let auditedJunctionPairCount = 0;
  let auditedJunctionStationCount = 0;
  let maximumJunctionHeightDeltaM = 0;
  let maximumJunctionAbsGrade = 0;
  let maximumJunctionAbsBankRadians = 0;
  for (const nodeEnvelope of junctionEnvelopes) {
    const envelopesByEdgeId = new Map(
      nodeEnvelope.edgeEnvelopes.map((edgeEnvelope) => [edgeEnvelope.edgeId, edgeEnvelope])
    );
    for (const edgeEnvelope of nodeEnvelope.edgeEnvelopes) {
      for (const pair of edgeEnvelope.overlapPairs) {
        const pairKey = `${nodeEnvelope.nodeId}:${
          [edgeEnvelope.edgeId, pair.siblingEdgeId].sort().join('|')
        }`;
        if (auditedJunctionPairs.has(pairKey)) continue;
        auditedJunctionPairs.add(pairKey);
        auditedJunctionPairCount++;
        const siblingEnvelope = envelopesByEdgeId.get(pair.siblingEdgeId);
        const edge = track.getEdge(edgeEnvelope.edgeId);
        const siblingEdge = track.getEdge(pair.siblingEdgeId);
        check(siblingEnvelope && edge && siblingEdge,
          'Junction sibling audit cannot resolve both incident edges', { pairKey });
        const sampleAtEndpointDistance = (targetEdge, endpoint, distance) => track.sampleEdge(
          targetEdge.id,
          endpoint === 'from' ? distance : targetEdge.length - distance,
          0,
          {}
        );
        const stationDistances = [];
        for (let distance = 0; distance < pair.lastOverlapDistance; distance += 0.25) {
          stationDistances.push(distance);
        }
        stationDistances.push(pair.lastOverlapDistance);
        for (const distance of stationDistances) {
          const sample = sampleAtEndpointDistance(edge, edgeEnvelope.endpoint, distance);
          const siblingSample = sampleAtEndpointDistance(
            siblingEdge,
            siblingEnvelope.endpoint,
            distance
          );
          maximumJunctionHeightDeltaM = Math.max(
            maximumJunctionHeightDeltaM,
            Math.abs(sample.y - siblingSample.y)
          );
          maximumJunctionAbsGrade = Math.max(
            maximumJunctionAbsGrade,
            Math.abs(sample.grade),
            Math.abs(siblingSample.grade)
          );
          maximumJunctionAbsBankRadians = Math.max(
            maximumJunctionAbsBankRadians,
            Math.abs(sample.bank),
            Math.abs(siblingSample.bank)
          );
          auditedJunctionStationCount++;
        }
      }
    }
  }
  check(auditedJunctionPairCount === 48 && auditedJunctionStationCount > 9_000,
    'Split/merge full-footprint audit skipped an incident pair or station', {
      auditedJunctionPairCount,
      auditedJunctionStationCount
    });
  check(maximumSiblingOverlapDistance <= Math.max(
    contract.sharedJunctionThroatLength,
    contract.loopMergeLevelLength
  )
    && maximumJunctionHeightDeltaM <= 0.000_001
    && maximumJunctionAbsGrade <= 0.000_001
    && maximumJunctionAbsBankRadians <= 0.000_001,
  'A shared split/merge footprint is not one level, unbanked physical deck', {
    maximumSiblingOverlapDistance,
    maximumJunctionHeightDeltaM,
    maximumJunctionAbsGrade,
    maximumJunctionAbsBankRadians
  });

  let minimumCoveredClearance = Number.POSITIVE_INFINITY;
  let minimumUndergroundHeight = Number.POSITIVE_INFINITY;
  let minimumPortalSiblingGap = Number.POSITIVE_INFINITY;
  let maximumPortalBlend = 0;
  for (const edge of [...mountainEdges, ...undergroundEdges]) {
    check(edge.tunnelProfiles.length === 1, 'Tunnel edge publishes an ambiguous covered span', edge.id);
    const profile = edge.tunnelProfiles[0];
    checkNear(profile.portalFrameDepth, contract.tunnelPortalFrameDepth, 0.000_001,
      'Tunnel portal frame depth diverged from the route contract');
    check(Number.isFinite(profile.minimumPortalSiblingGap)
      && profile.minimumPortalSiblingGap >= contract.tunnelShellSafetyGap - 0.000_001,
    'A complete tunnel portal frame intersects a sibling road shell', { edgeId: edge.id, profile });
    minimumPortalSiblingGap = Math.min(
      minimumPortalSiblingGap,
      profile.minimumPortalSiblingGap
    );
    if (profile.kind === 'underground-tunnel') {
      checkNear(profile.basinHeight, contract.undergroundTunnelBasinHeight, 0.000_001,
        'Underground profile lost its bridge-clearance basin');
      checkNear(profile.roadShoulderJoin, contract.roadShellShoulderJoin, 0.000_001,
        'Underground road joint diverged from the rendered shoulder contract');
      checkNear(profile.wallInset, contract.undergroundTunnelWallInset, 0.000_001,
        'Underground wall inset diverged from the renderer contract');
      checkNear(profile.wallThickness, contract.undergroundTunnelWallThickness, 0.000_001,
        'Underground wall thickness diverged from the terrain and renderer contract');
      checkNear(profile.roofInset, contract.undergroundTunnelRoofInset, 0.000_001,
        'Underground roof inset diverged from the renderer contract');
      checkNear(profile.roofOverhang, contract.undergroundTunnelRoofOverhang, 0.000_001,
        'Underground roof overhang diverged from the wall-seal contract');
      checkNear(profile.roofDepth, contract.undergroundTunnelRoofDepth, 0.000_001,
        'Underground roof depth diverged from the renderer contract');
      const wallInnerInset = profile.wallInset - profile.wallThickness * 0.5;
      const wallOuterInset = profile.wallInset + profile.wallThickness * 0.5;
      checkNear(wallInnerInset, contract.roadShellShoulderJoin, 0.000_001,
        'Underground wall foot leaves a lateral gap or penetrates the road shell');
      checkNear(profile.roofInset - wallOuterInset, contract.undergroundTunnelRoofOverhang, 0.000_001,
        'Underground roof no longer seals the outside of the U wall');
    } else {
      checkNear(profile.roofInset, contract.mountainTunnelRoofInset, 0.000_001,
        'Mountain roof inset diverged from the renderer contract');
      checkNear(profile.roofDepth, contract.mountainTunnelRoofDepth, 0.000_001,
        'Mountain roof depth diverged from the renderer contract');
    }
    const fromEnvelope = edge.junctionOverlapEnvelopes.find((envelope) => envelope.endpoint === 'from');
    const toEnvelope = edge.junctionOverlapEnvelopes.find((envelope) => envelope.endpoint === 'to');
    check(fromEnvelope && toEnvelope, 'Tunnel edge omits a connected-junction envelope', edge.id);
    check(
      profile.startS >= fromEnvelope.clearPlanarS + contract.tunnelJunctionMargin - 0.000_001,
      'Tunnel portal begins inside the source sibling-road plan envelope', { edgeId: edge.id, profile, fromEnvelope }
    );
    check(
      profile.endS <= toEnvelope.clearPlanarS - contract.tunnelJunctionMargin + 0.000_001,
      'Tunnel portal ends inside the destination sibling-road plan envelope', { edgeId: edge.id, profile, toEnvelope }
    );
    check(
      profile.surfaceStartS >= fromEnvelope.clearS + contract.tunnelJunctionMargin - 0.01,
      'Tunnel surface start is inside the source structural clear station', { edgeId: edge.id, profile, fromEnvelope }
    );
    check(
      profile.surfaceEndS <= toEnvelope.clearS - contract.tunnelJunctionMargin + 0.01,
      'Tunnel surface end is inside the destination structural clear station', { edgeId: edge.id, profile, toEnvelope }
    );
    check(
      profile.surfaceStartS < profile.surfaceEndS && profile.surfaceEndS < edge.length,
      'Tunnel surface stations are unordered',
      { edgeId: edge.id, profile }
    );
    const middleS = (profile.surfaceStartS + profile.surfaceEndS) * 0.5;
    const middle = track.sampleEdge(edge.id, middleS, 0, {});
    check(middle.covered && middle.structure === profile.kind, 'Tunnel midpoint is not physically covered', edge.id);
    check(middle.tunnelProfileId === profile.id, 'Tunnel sample lost profile identity', edge.id);
    check(Number.isFinite(middle.ceilingHeight), 'Tunnel sample has no finite ceiling', edge.id);
    maximumPortalBlend = Math.max(maximumPortalBlend, middle.underpassBlend);
    if (profile.kind === 'underground-tunnel') {
      check(middle.layer === 'underground', 'Underground sample did not publish its map/physics layer', edge.id);
      minimumUndergroundHeight = Math.min(minimumUndergroundHeight, middle.surfaceHeight);
    }
    for (const lateralRatio of [-1, 0, 1]) {
      const sample = track.sampleEdge(edge.id, middleS, middle.roadHalf * lateralRatio, {});
      minimumCoveredClearance = Math.min(minimumCoveredClearance, sample.ceilingHeight - sample.y);
      check(
        sample.ceilingHeight - sample.y >= profile.clearance - 0.01,
        'Banked tunnel edge violates its declared roof clearance',
        { edgeId: edge.id, lateralRatio, clearance: sample.ceilingHeight - sample.y, profile }
      );
    }
  }
  checkNear(minimumUndergroundHeight, contract.undergroundTunnelBasinHeight, 0.000_001,
    'Underground road lost its structural-clearance basin');
  checkNear(maximumPortalBlend, 1, 0.000_001, 'Tunnel midpoint never reaches full camera blend');

  const decisionPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const decisionCursor = track.getInitialRouteCursor({ pathPlan: decisionPlan });
  const decisions = track.getUpcomingDecisions(decisionCursor, 2_000, decisionPlan);
  check(decisions.length === 1 && decisions[0].outgoing.length === 3, 'Initial tunnel choice is not a real graph decision');
  check(
    new Set(decisions[0].outgoing.map((transition) => transition.routeType)).size === 3,
    'Decision does not expose surface, mountain, and underground route types',
    decisions[0].outgoing
  );

  Object.assign(summary, {
    mountainTunnels: mountainEdges.length,
    undergroundTunnels: undergroundEdges.length,
    minimumCoveredClearanceM: minimumCoveredClearance,
    minimumUndergroundHeightM: minimumUndergroundHeight,
    minimumPortalSiblingGapM: minimumPortalSiblingGap,
    maximumPortalBlend,
    junctionOverlapEnvelopes: junctionEnvelopes.length,
    maximumSiblingOverlapDistanceM: maximumSiblingOverlapDistance,
    auditedJunctionPairCount,
    auditedJunctionStationCount,
    maximumJunctionHeightDeltaM,
    maximumJunctionAbsGrade,
    maximumJunctionAbsBankRadians,
    selectableRouteTypes: [...contract.selectableRouteTypes]
  });
}

/**
 * Reuse one hot-path output across edge families so optional metadata from a tunnel or runtime connector can never
 * survive into the next recovery or translated-template sample.
 */
function validateReusableEdgeSampleContract(summary) {
  const plan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const edges = plan.edgeIds.map((edgeId) => track.getEdge(edgeId));
  const tunnelEdge = edges.find((edge) => edge?.tunnelProfiles?.some(
    (profile) => profile.kind === 'underground-tunnel'
  ));
  const recoveryEdge = edges.find((edge) => edge?.runtimeKind === 'recovery');
  const openTemplateEdge = edges.find((edge) => (
    edge?.runtimeKind === 'template' && !edge.tunnelProfiles?.length
  ));
  const tunnelProfile = tunnelEdge?.tunnelProfiles?.find(
    (profile) => profile.kind === 'underground-tunnel'
  );
  check(tunnelEdge && tunnelProfile && recoveryEdge && openTemplateEdge,
    'Reusable sample regression cannot resolve tunnel, recovery, and open template edges');

  const reusedFrame = {};
  const tunnelFrame = track.sampleEdge(
    tunnelEdge.id,
    (tunnelProfile.surfaceStartS + tunnelProfile.surfaceEndS) * 0.5,
    0,
    reusedFrame
  );
  check(tunnelFrame === reusedFrame, 'Tunnel sampling replaced the caller-owned output object');
  check(
    tunnelFrame.covered === true
      && tunnelFrame.tunnelKind === 'underground-tunnel'
      && tunnelFrame.tunnelProfileId === tunnelProfile.id
      && tunnelFrame.templateEdgeId === tunnelEdge.id
      && tunnelFrame.runtimeKind === null,
    'Tunnel sample did not publish the complete graph-edge metadata contract',
    tunnelFrame
  );

  const recoveryFrame = track.sampleEdge(
    recoveryEdge.id,
    recoveryEdge.length * 0.5,
    0,
    reusedFrame
  );
  check(recoveryFrame === reusedFrame, 'Recovery sampling replaced the caller-owned output object');
  check(
    recoveryFrame.covered === false
      && recoveryFrame.tunnelKind === null
      && recoveryFrame.tunnelProfileId === null
      && recoveryFrame.templateEdgeId === null,
    'Recovery sample inherited tunnel or template identity from the reused output',
    recoveryFrame
  );
  check(
    recoveryFrame.runtimeKind === 'recovery'
      && recoveryFrame.nextTileIndex === recoveryEdge.nextTileIndex
      && recoveryFrame.visualKind === null
      && recoveryFrame.visualOnly === false,
    'Recovery sample omitted its complete runtime-edge metadata contract',
    recoveryFrame
  );

  const openTemplateFrame = track.sampleEdge(
    openTemplateEdge.id,
    openTemplateEdge.length * 0.5,
    0,
    reusedFrame
  );
  check(openTemplateFrame === reusedFrame, 'Template sampling replaced the caller-owned output object');
  check(
    openTemplateFrame.covered === false
      && openTemplateFrame.tunnelKind === null
      && openTemplateFrame.tunnelProfileId === null
      && openTemplateFrame.templateEdgeId === openTemplateEdge.templateEdgeId,
    'Open template sample inherited covered-route identity from the reused output',
    openTemplateFrame
  );
  check(
    openTemplateFrame.runtimeKind === 'template'
      && openTemplateFrame.nextTileIndex === null
      && openTemplateFrame.visualKind === null
      && openTemplateFrame.visualOnly === false
      && openTemplateFrame.verticalCurvature === null
      && openTemplateFrame.spatialCurvature === null
      && openTemplateFrame.straightForkOffsetM === 0
      && openTemplateFrame.straightForkVoidWidthM === 0,
    'Open template sample inherited recovery-only metadata from the reused output',
    openTemplateFrame
  );

  Object.assign(summary, {
    sequence: ['underground-tunnel', 'recovery', 'open-template'],
    reusedObject: true,
    recoveryClearedTunnelIdentity: true,
    templateClearedRecoveryIdentity: true
  });
}

function simulateAutomaticBraking(movementId, initialSpeed, dt) {
  const plan = track.createPathPlan({ movementId, futureMovementKind: 'straight' });
  let cursor = track.getInitialRouteCursor({ pathPlan: plan });
  let speed = initialSpeed;
  let brakeFrames = 0;
  let brakeStartDistanceFromEntryM = null;
  let closestTargetError = Number.POSITIVE_INFINITY;
  let firstCurveViolation = null;
  let maximumHighCurvatureSpeedRatio = 0;
  let driveGear = gameplayCore.DRIVE_GEAR_CONTRACT.automaticMinimumGear;
  while (
    Number.isFinite(gameplayCore.DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear[driveGear])
    && initialSpeed
      >= gameplayCore.DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear[driveGear]
  ) {
    driveGear += 1;
  }
  let pendingDriveGear = null;
  let gearShiftRemainingSeconds = 0;
  let propulsionSpool = 0;
  let propulsionRpm = gameplayCore.PROPULSION_CORE_CONTRACT.idleRpm;
  const kind = track.getMovement(movementId).kind;
  const designCurvature = kind === 'right'
    ? 1 / track.graph.contract.directRadius
    : kind === 'left' ? 1 / track.graph.contract.loopRadius : 0;
  const targetSpeed = designCurvature > 0
    ? 0.92 * Math.sqrt(AUTO_CURVE_LATERAL_ACCELERATION_MPS2 / designCurvature)
    : Number.POSITIVE_INFINITY;

  for (let frame = 0; frame < 60_000; frame += 1) {
    const edge = track.getEdge(cursor.edgeId);
    if (edge.runtimeKind === 'recovery') {
      return {
        brakeFrames,
        brakeStartDistanceFromEntryM,
        closestTargetError,
        firstCurveViolation,
        maximumHighCurvatureSpeedRatio,
        targetSpeed,
        finalSpeed: speed,
        frames: frame
      };
    }

    const lookAhead = clamp(220 + speed * 2.8, 320, 1_200);
    const preview = track.getCurvatureAhead(cursor, plan, lookAhead);
    const turning = kind !== 'straight' && preview.maxCurvature > 0.000_8;
    const speedLimit = turning
      ? 0.92 * Math.sqrt(
          AUTO_CURVE_LATERAL_ACCELERATION_MPS2
            / Math.max(preview.maxCurvature, 0.000_001)
        )
      : Number.POSITIVE_INFINITY;
    const stoppingDistance = Number.isFinite(speedLimit) && speed > speedLimit
      ? (speed * speed - speedLimit * speedLimit) / (2 * SERVICE_BRAKE_DECELERATION_MPS2)
      : 0;
    const brake = turning
      && speed > speedLimit + 1.5
      && preview.distance <= stoppingDistance + Math.max(24, speed * 0.16);

    if (brake && brakeStartDistanceFromEntryM === null) {
      brakeStartDistanceFromEntryM = cursor.runDistance;
    }
    if (brake) brakeFrames += 1;

    if (pendingDriveGear === null) {
      const decision = gameplayCore.resolveAutomaticDriveGearDecision({
        currentGear: driveGear,
        speedMps: speed,
        transmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode,
        shiftInProgress: false
      }, {});
      if (decision.shouldShift) {
        const requestedGear = decision.requestedGear;
        const request = gameplayCore.resolveDriveGearShiftRequest({
          currentGear: driveGear,
          requestedGear,
          speedMps: speed,
          shiftInProgress: false,
          transmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode,
          requestAuthority: 'automatic'
        }, {});
        check(request.accepted, 'Automatic curve fixture produced an unsafe gear request', {
          movementId,
          speed,
          driveGear,
          requestedGear,
          rejectionReason: request.rejectionReason
        });
        pendingDriveGear = requestedGear;
        gearShiftRemainingSeconds = request.shiftTorqueCutSeconds;
      }
    }

    const shiftTorqueCutSeconds = Math.min(dt, gearShiftRemainingSeconds);
    const propulsionGear = pendingDriveGear ?? driveGear;
    const throttleCommand = brake
      ? 0
      : gameplayCore.resolveAutomaticThrottleCommand(
          speed,
          gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps,
          true,
          0,
          propulsionGear
        );
    const propulsion = gameplayCore.resolvePropulsionCoreStep({
      currentSpool: propulsionSpool,
      currentRpm: propulsionRpm,
      throttleCommand,
      braking: brake,
      gear: propulsionGear,
      speedMps: speed,
      shifting: shiftTorqueCutSeconds > 0,
      shiftTorqueCutSeconds
    }, dt, {});
    propulsionSpool = propulsion.nextSpool;
    propulsionRpm = propulsion.rpm;
    const previousSpeed = speed;
    const surface = track.sampleRouteCursor(cursor, 0, {});
    speed = gameplayCore.resolveLongitudinalDynamicsStep({
      speedMps: speed,
      propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
      brakeDecelerationMps2: brake ? SERVICE_BRAKE_DECELERATION_MPS2 : 0,
      grounded: true,
      surfaceGrade: surface.grade || 0
    }, dt, {}).nextSpeedMps;
    cursor = track.advanceCursor(
      cursor,
      gameplayCore.integrateLongitudinalDistance(previousSpeed, speed, dt),
      plan,
      {}
    );
    if (shiftTorqueCutSeconds > 0) {
      gearShiftRemainingSeconds = Math.max(0, gearShiftRemainingSeconds - shiftTorqueCutSeconds);
      if (gearShiftRemainingSeconds <= 0.000_000_001) {
        driveGear = pendingDriveGear;
        pendingDriveGear = null;
        gearShiftRemainingSeconds = 0;
      }
    }

    const sample = track.sampleRouteCursor(cursor, 0, {});
    const absoluteCurvature = Math.abs(sample.curvature);
    if (absoluteCurvature >= 0.9 / track.graph.contract.directRadius && firstCurveViolation === null) {
      const localSuggestedSpeed = 0.92 * Math.sqrt(
        AUTO_CURVE_LATERAL_ACCELERATION_MPS2 / absoluteCurvature
      );
      // One 30Hz service-brake slice may cross the exact curvature sample; retain a tight 7% discrete-step margin.
      const allowedSpeed = localSuggestedSpeed * 1.07;
      maximumHighCurvatureSpeedRatio = Math.max(maximumHighCurvatureSpeedRatio, speed / localSuggestedSpeed);
      if (speed > allowedSpeed) {
        firstCurveViolation = Object.freeze({
          movementId,
          initialSpeed,
          dt,
          distanceFromEntryM: cursor.runDistance,
          edgeId: cursor.edgeId,
          edgeS: cursor.edgeS,
          curvature: sample.curvature,
          speedMps: speed,
          localSuggestedSpeedMps: localSuggestedSpeed,
          allowedSpeedMps: allowedSpeed,
          brakeStartDistanceFromEntryM,
          distanceAfterBrakeStartM: brakeStartDistanceFromEntryM === null
            ? null
            : cursor.runDistance - brakeStartDistanceFromEntryM
        });
      }
    }

    if (designCurvature > 0) {
      if (Math.abs(sample.curvature) >= designCurvature * 0.995) {
        closestTargetError = Math.min(closestTargetError, Math.abs(speed - targetSpeed));
      }
    }
    check(!cursor.exited, 'Automatic-driving simulation exited a live itinerary', { movementId, initialSpeed, dt });
  }
  throw new Error(`Automatic-driving simulation did not leave the first interchange: ${movementId}`);
}

function validateAutomaticBraking(summary) {
  const timeSteps = [1 / 30, 1 / 60, 1 / 120];
  const initialSpeeds = [
    0,
    gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps,
    gameplayCore.DRIVE_GEAR_CONTRACT.gears[2].equilibriumSpeedMps
  ];
  let runs = 0;
  let straightBrakeFrames = 0;
  let turningBrakeRuns = 0;
  let maximumTargetErrorMps = 0;
  let maximumHighCurvatureSpeedRatio = 0;

  for (const dt of timeSteps) {
    for (const initialSpeed of initialSpeeds) {
      for (const entryPort of PORTS) {
        for (const kind of KINDS) {
          const movementId = `${entryPort}-${kind}`;
          const result = simulateAutomaticBraking(movementId, initialSpeed, dt);
          runs += 1;
          maximumHighCurvatureSpeedRatio = Math.max(
            maximumHighCurvatureSpeedRatio,
            result.maximumHighCurvatureSpeedRatio
          );
          if (kind === 'straight') {
            straightBrakeFrames += result.brakeFrames;
            check(result.brakeFrames === 0, 'Straight movement applied automatic braking', { movementId, initialSpeed, dt });
          } else {
            turningBrakeRuns += result.brakeFrames > 0 ? 1 : 0;
            maximumTargetErrorMps = Math.max(maximumTargetErrorMps, result.closestTargetError);
            if (kind === 'left') {
              check(result.brakeFrames > 0, 'High-curvature movement never applied automatic braking', {
                movementId,
                initialSpeed,
                dt
              });
            }
            check(result.firstCurveViolation === null, 'High-curvature speed exceeds the audited local suggestion bound', result.firstCurveViolation);
            check(Number.isFinite(result.closestTargetError),
              'A turning run never reached the design-curvature audit zone', {
                movementId,
                initialSpeed,
                dt,
                targetSpeed: result.targetSpeed,
                closestTargetError: result.closestTargetError
              });
          }
        }
      }
    }
  }

  Object.assign(summary, {
    runs,
    timeSteps,
    initialSpeeds,
    straightBrakeFrames,
    turningBrakeRuns,
    maximumTargetErrorMps,
    maximumHighCurvatureSpeedRatio
  });
}

function sampledCurvaturePreview(cursor, plan, lookAhead) {
  let maxCurvature = 0;
  let signedCurvature = 0;
  let peakDistance = 0;
  let firstCurveDistance = Number.POSITIVE_INFINITY;
  for (let distance = 0; distance <= lookAhead; distance += 4) {
    const sampleCursor = track.advanceCursor(cursor, distance, plan, {});
    const sample = track.sampleRouteCursor(sampleCursor, 0, {});
    if (!Number.isFinite(firstCurveDistance) && Math.abs(sample.curvature) > 0.000_8) {
      firstCurveDistance = distance;
    }
    if (Math.abs(sample.curvature) > maxCurvature) {
      maxCurvature = Math.abs(sample.curvature);
      signedCurvature = sample.curvature;
      peakDistance = distance;
    }
    if (sampleCursor.exited) break;
  }
  return { maxCurvature, signedCurvature, peakDistance, firstCurveDistance };
}

/** Lock the new edge-range scan to the former 4m sampled behavior without retaining that allocation-heavy runtime path. */
function validateCurvaturePreviewOptimization(summary) {
  let maximumCurvatureDifference = 0;
  let maximumCurveOnsetDifferenceM = 0;
  let comparisons = 0;
  for (const entryPort of PORTS) {
    for (const kind of KINDS) {
      const plan = track.createPathPlan({ movementId: `${entryPort}-${kind}`, singleTile: true });
      const initialCursor = track.getInitialRouteCursor({ pathPlan: plan });
      for (const offsetM of [0, 800]) {
        const cursor = track.advanceCursor(initialCursor, offsetM, plan, {});
        const preview = track.getCurvatureAhead(cursor, plan, 1_200);
        const sampled = sampledCurvaturePreview(cursor, plan, 1_200);
        const curvatureDifference = Math.abs(preview.maxCurvature - sampled.maxCurvature);
        maximumCurvatureDifference = Math.max(maximumCurvatureDifference, curvatureDifference);
        // A 4m reference grid can miss the analytic peak after route lengths shift; three micro-curvature units
        // remains below one-thirtieth of one percent at the recovery fork and does not relax the speed contract.
        check(curvatureDifference <= 0.000_003, 'Edge-range curvature maximum diverged from 4m sampling', {
          entryPort,
          kind,
          offsetM,
          preview: preview.maxCurvature,
          sampled: sampled.maxCurvature
        });
        if (Number.isFinite(sampled.firstCurveDistance)) {
          const onsetDifferenceM = Math.abs(preview.distance - sampled.firstCurveDistance);
          maximumCurveOnsetDifferenceM = Math.max(maximumCurveOnsetDifferenceM, onsetDifferenceM);
          check(onsetDifferenceM <= 4.01, 'Edge-range curve onset exceeds the former sample interval', {
            entryPort,
            kind,
            offsetM,
            preview: preview.distance,
            sampled: sampled.firstCurveDistance
          });
        } else {
          check(preview.maxCurvature === 0, 'Straight sampled preview gained curvature', { entryPort, offsetM, preview });
        }
        comparisons += 1;
      }
    }
  }
  Object.assign(summary, {
    comparisons,
    maximumCurvatureDifference,
    maximumCurveOnsetDifferenceM
  });
}

function validateItinerary(summary) {
  const itineraryKinds = Array.from({ length: 24 }, (_, index) => ['left', 'right', 'straight'][index % 3]);
  const plan = track.createPathPlan({ movementId: 'south-left', itineraryKinds });
  let cursor = track.getInitialRouteCursor({ pathPlan: plan });
  let maximumPositionJumpM = 0;
  let maximumHeadingJumpDegrees = 0;
  let maximumGradeJump = 0;
  let transitionCount = 0;

  // 300m/s at the slow-frame regression dt exercises swept transitions without hiding them in large test-only jumps.
  const frameDistance = 300 * 0.045;
  while (cursor.runDistance < 50_000) {
    const report = track.advanceRouteCursor(
      cursor,
      Math.min(frameDistance, 50_000 - cursor.runDistance),
      plan
    );
    cursor = report.cursor;
    maximumPositionJumpM = Math.max(maximumPositionJumpM, report.positionJump);
    maximumHeadingJumpDegrees = Math.max(maximumHeadingJumpDegrees, report.headingJumpDeg);
    maximumGradeJump = Math.max(maximumGradeJump, report.gradeJump);
    transitionCount += report.transitionCount;
    check(!cursor.exited, 'Itinerary exited before 50km', cursor);
  }

  check(cursor.tileIndex >= 8, '50km did not complete at least eight interchanges', cursor);
  check(plan.tiles.length >= 9, 'Itinerary did not retain at least nine tile records', plan.tiles.length);
  check(new Set(plan.edgeIds).size === plan.edgeIds.length, 'Itinerary edge ids alias after a route change');
  check(plan.edgeIndexById.size === plan.edgeIds.length, '50km PathPlan edge index has the wrong size', {
    indexed: plan.edgeIndexById.size,
    edges: plan.edgeIds.length
  });
  plan.edgeIds.forEach((edgeId, index) => {
    check(plan.edgeIndexById.get(edgeId) === index, '50km PathPlan edge index is stale', { edgeId, index });
  });
  check(maximumPositionJumpM <= 0.02, 'Runtime tile transition position jumps', maximumPositionJumpM);
  check(maximumHeadingJumpDegrees <= 0.5, 'Runtime tile transition heading jumps', maximumHeadingJumpDegrees);
  check(Math.atan(maximumGradeJump) * DEGREES <= 0.25, 'Runtime tile transition grade jumps', maximumGradeJump);

  let minimumTileSpacingM = Number.POSITIVE_INFINITY;
  for (let tileIndex = 1; tileIndex < plan.tiles.length; tileIndex += 1) {
    const previous = plan.tiles[tileIndex - 1];
    const tile = plan.tiles[tileIndex];
    const spacingM = Math.hypot(tile.centerX - previous.centerX, tile.centerZ - previous.centerZ);
    minimumTileSpacingM = Math.min(minimumTileSpacingM, spacingM);
    check(spacingM >= 3_000, 'Adjacent interchange centres are too close', { tileIndex, spacingM });
  }

  const currentTileIndex = track.getEdge(cursor.edgeId)?.tileIndex ?? cursor.tileIndex;
  const previousOrdinaryTile = plan.tiles.find((tile) => tile.index === currentTileIndex - 1);
  const previousOrdinaryEdge = plan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => (
      edge?.tileToken === previousOrdinaryTile?.token
      && edge.runtimeKind === 'template'
    ));
  check(
    previousOrdinaryTile?.opposingBypass !== true && previousOrdinaryEdge,
    'Itinerary fixture could not resolve an ordinary previous-tile road',
    { currentTileIndex, previousOrdinaryTile }
  );
  const previousVisibleEdges = track.getVisibleEdges({
    bounds: previousOrdinaryEdge.bounds,
    pathPlan: plan,
    cursor
  });
  check(
    previousVisibleEdges.some((edge) => edge.id === previousOrdinaryEdge.id),
    'Visible-edge filtering removed the ordinary previous tile retained by the presentation camera',
    { currentTileIndex, previousEdgeId: previousOrdinaryEdge.id }
  );

  Object.assign(summary, {
    distanceM: cursor.runDistance,
    completedTileIndex: cursor.tileIndex,
    retainedTiles: plan.tiles.length,
    transitionCount,
    indexedEdges: plan.edgeIndexById.size,
    minimumTileSpacingM,
    ordinaryPreviousTileVisible: true,
    maximumPositionJumpM,
    maximumHeadingJumpDegrees
  });
  return plan;
}

/**
 * Replay one complete platform flight with the production vertical sweep and shared lateral actuator/integrator.
 * Runtime resolves an impact at a fraction of the frame after committing the full lateral step, so the landing
 * coordinate intentionally uses the same previous/current interpolation instead of truncating physics at impact.
 */
function simulateCrossCarriagewayPlatformFlight(platform, framesPerSecond) {
  const frameSeconds = 1 / framesPerSecond;
  const launchVelocityMps = JUMP_PLATFORM_AUDIT_SPEED_MPS * platform.grade
    / Math.hypot(1, platform.grade);
  const expectedAirTimeSeconds = (
    launchVelocityMps
    + Math.sqrt(
      launchVelocityMps * launchVelocityMps
        + 2 * JUMP_PLATFORM_AUDIT_GRAVITY_MPS2 * platform.height
    )
  ) / JUMP_PLATFORM_AUDIT_GRAVITY_MPS2;
  let elapsedSeconds = 0;
  let altitudeM = platform.height;
  let verticalVelocityMps = launchVelocityMps;
  let lateralM = platform.lateral;
  let lateralVelocityMps = 0;
  let steeringActuator = 0;
  let firstFrame = null;
  let opposingCenterCrossingSeconds = null;
  const maximumFrames = Math.ceil((expectedAirTimeSeconds + 1) * framesPerSecond);

  for (let frameIndex = 0; frameIndex < maximumFrames; frameIndex += 1) {
    const previousLateralM = lateralM;
    const steeringStep = gameplayCore.advanceSteeringActuator(
      steeringActuator,
      -1,
      frameSeconds,
      {}
    );
    steeringActuator = steeringStep.nextActuator;
    const lateralStep = gameplayCore.integrateLateralStep({
      lateral: previousLateralM,
      velocity: lateralVelocityMps,
      steer: steeringStep.averageActuator,
      steerAcceleration: JUMP_PLATFORM_AUDIT_LATERAL_KINEMATICS.accelerationMps2,
      outwardAcceleration: 0,
      dragRate: JUMP_PLATFORM_AUDIT_LATERAL_KINEMATICS.dragPerSecond,
      maximumSpeed: JUMP_PLATFORM_AUDIT_LATERAL_KINEMATICS.maximumSpeedMps
    }, frameSeconds);
    lateralM = lateralStep.lateral;
    lateralVelocityMps = lateralStep.velocity;

    const verticalStep = gameplayCore.sweptVerticalContact({
      startDistance: 0,
      endDistance: JUMP_PLATFORM_AUDIT_SPEED_MPS * frameSeconds,
      duration: frameSeconds,
      startAltitude: altitudeM,
      startVelocity: verticalVelocityMps,
      gravity: JUMP_PLATFORM_AUDIT_GRAVITY_MPS2,
      bottomOffset: 0,
      topOffset: 0.75
    }, (_distance, _fraction, out) => {
      out.surface = 0;
      out.ceiling = Number.POSITIVE_INFINITY;
    });
    if (firstFrame === null) {
      firstFrame = Object.freeze({
        hit: verticalStep.hit,
        grounded: verticalStep.endGrounded,
        altitudeM: verticalStep.endAltitude,
        velocityMps: verticalStep.endVelocity
      });
    }
    if (
      opposingCenterCrossingSeconds === null
      && previousLateralM > JUMP_PLATFORM_OPPOSING_CENTER_LATERAL_M
      && lateralM <= JUMP_PLATFORM_OPPOSING_CENTER_LATERAL_M
    ) {
      const crossingFraction = (
        previousLateralM - JUMP_PLATFORM_OPPOSING_CENTER_LATERAL_M
      ) / Math.max(0.000_000_001, previousLateralM - lateralM);
      opposingCenterCrossingSeconds = elapsedSeconds + crossingFraction * frameSeconds;
    }
    if (verticalStep.hit) {
      const landingLateralM = previousLateralM
        + (lateralM - previousLateralM) * verticalStep.fraction;
      return Object.freeze({
        launchVelocityMps,
        expectedAirTimeSeconds,
        landingTimeSeconds: elapsedSeconds + verticalStep.time,
        landingLateralM,
        opposingCenterCrossingSeconds,
        firstFrame,
        contactKind: verticalStep.kind
      });
    }
    altitudeM = verticalStep.endAltitude;
    verticalVelocityMps = verticalStep.endVelocity;
    elapsedSeconds += frameSeconds;
  }
  throw new Error(`Jump-platform flight did not land: ${platform.variant} at ${framesPerSecond}Hz`);
}

function validateJumpPlatforms(plan, summary) {
  check(typeof track.getJumpPlatformsForEdge === 'function', 'Jump-platform edge API is missing');
  check(typeof track.getJumpPlatformsForTile === 'function', 'Jump-platform tile API is missing');
  check(typeof track.sampleJumpPlatformSupport === 'function', 'Jump-platform support API is missing');
  check(typeof track.crossedJumpPlatformLip === 'function', 'Swept jump-platform lip API is missing');
  const recoveryEdges = plan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .filter((candidate) => candidate?.runtimeKind === 'recovery');
  const platformEdges = recoveryEdges.filter((candidate) => candidate.jumpPlatformCorridor);
  const legacyPerEdgePointObjects = recoveryEdges.reduce(
    (total, candidate) => total + Math.ceil(candidate.planarLength / 0.25) + 1,
    0
  );
  check(platformEdges.length >= 4, 'Itinerary did not create enough deterministic jump-platform corridors', {
    count: platformEdges.length
  });
  check(
    recoveryEdges.every((candidate) => candidate.family !== 'launch'),
    'A full-width launch-road family survived the jump-platform migration'
  );
  check(
    platformEdges.every((candidate) => (
      candidate.family === 'recovery'
      && candidate.samplingMode === 'scaled-analytic-line'
      && Math.abs(candidate.length - 324.454_197_356_685_9) <= 0.000_001
      && Math.abs(candidate.planarLength - 324) <= 0.000_001
      && candidate.recoverySamples === null
      && candidate.launchProfileLut === null
      && candidate.ramp === null
      && candidate.rampId === null
    )),
    'A jump-platform corridor retained legacy full-road ramp sampling'
  );
  const analyticRecoveryEdges = recoveryEdges.filter((candidate) => candidate.samplingMode === 'analytic-line');
  check(
    analyticRecoveryEdges.every((candidate) => candidate.samplingMode === 'analytic-line' && candidate.recoverySamples === null),
    'Flat recovery retained sampled point objects'
  );
  const analyticEdge = analyticRecoveryEdges[0];
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    const sample = track.sampleEdge(analyticEdge.id, analyticEdge.length * ratio, 0, {});
    checkNear(
      sample.centerX,
      analyticEdge.recoveryStart.x + (analyticEdge.recoveryEnd.x - analyticEdge.recoveryStart.x) * ratio,
      0.000_001,
      'Analytic recovery X sampling drifted'
    );
    checkNear(
      sample.centerZ,
      analyticEdge.recoveryStart.z + (analyticEdge.recoveryEnd.z - analyticEdge.recoveryStart.z) * ratio,
      0.000_001,
      'Analytic recovery Z sampling drifted'
    );
    checkNear(sample.centerY, analyticEdge.recoveryStart.y, 0.000_001, 'Analytic recovery elevation drifted');
    checkNear(sample.grade, 0, 0.000_001, 'Analytic recovery acquired a grade');
  }

  const platforms = platformEdges.map((edge) => {
    check(edge.jumpPlatforms.length === 1, 'A tile corridor must own exactly one jump platform', {
      edgeId: edge.id,
      count: edge.jumpPlatforms.length
    });
    const [platform] = edge.jumpPlatforms;
    check(Object.isFrozen(edge.jumpPlatforms) && Object.isFrozen(platform),
      'Jump-platform descriptors must be immutable', edge.id);
    check(platform.edgeId === edge.id && platform.tileToken === edge.tileToken,
      'Jump-platform ownership drifted', platform);
    check(platform.launchable === true && edge.launchable === true,
      'Jump-platform corridor is not launchable', edge.id);
    check(
      platform.startS >= 0
      && platform.startS < platform.lipS
      && platform.lipS === platform.endS
      && platform.endS < edge.length,
      'Jump-platform stations are unordered',
      platform
    );
    checkNear(platform.lipS - platform.startS, platform.length, 0.000_001,
      'Jump-platform logical length drifted');
    checkNear(platform.ascent, platform.length, 0.000_001,
      'Jump-platform ascent does not occupy the complete wedge');
    check(platform.width > 0 && platform.height > 0 && platform.grade > 0,
      'Jump-platform dimensions are not physical', platform);
    check(
      Math.abs(platform.lateral) + platform.halfWidth <= edge.roadHalf + 0.000_001,
      'Jump platform extends beyond its road',
      { edgeId: edge.id, platform, roadHalf: edge.roadHalf }
    );
    check(track.getJumpPlatformsForEdge(edge.id) === edge.jumpPlatforms,
      'Edge platform API did not retain descriptor identity', edge.id);
    const ownerTile = plan.tiles.find((tile) => tile.token === edge.tileToken);
    check(track.getJumpPlatformsForTile(ownerTile).includes(platform),
      'Tile platform API omitted its deterministic platform', ownerTile);
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const sample = track.sampleEdge(edge.id, edge.length * ratio, 0, {});
      checkNear(sample.centerY, edge.recoveryStart.y, 0.000_001,
        'Former launch road is no longer flat');
      checkNear(sample.grade, 0, 0.000_001,
        'Former launch road retained a hidden grade');
    }
    return platform;
  });
  const uniqueVariants = new Set(platforms.map((platform) => platform.variant));
  const uniqueLengths = new Set(platforms.map((platform) => platform.length));
  const uniqueWidths = new Set(platforms.map((platform) => platform.width));
  const uniqueHeights = new Set(platforms.map((platform) => platform.height));
  const uniqueLaterals = new Set(platforms.map((platform) => platform.lateral));
  check(
    uniqueVariants.size >= 3
    && uniqueLengths.size >= 3
    && uniqueWidths.size >= 3
    && uniqueHeights.size >= 3
    && uniqueLaterals.size >= 3,
    'Stable tile hashing did not vary jump-platform dimensions and placement',
    {
      variants: [...uniqueVariants],
      lengths: [...uniqueLengths],
      widths: [...uniqueWidths],
      heights: [...uniqueHeights],
      laterals: [...uniqueLaterals]
    }
  );
  const expectedVariants = Object.freeze([
    'compact-left',
    'medium-centre',
    'wide-right',
    'long-offset'
  ]);
  check(
    uniqueVariants.size === expectedVariants.length
      && expectedVariants.every((variant) => uniqueVariants.has(variant)),
    'The itinerary no longer exposes all four physical jump-platform variants',
    { variants: [...uniqueVariants] }
  );
  const crossCarriagewayFlights = {};
  for (const variant of expectedVariants) {
    const variantPlatform = platforms.find((candidate) => candidate.variant === variant);
    const requiredLateralTravelM = variantPlatform.lateral
      - JUMP_PLATFORM_OPPOSING_CENTER_LATERAL_M;
    let minimumReachMarginM = Number.POSITIVE_INFINITY;
    let expectedAirTimeSeconds = 0;
    const landingLateralsByCadence = {};
    for (const framesPerSecond of JUMP_PLATFORM_AUDIT_CADENCES_HZ) {
      const flight = simulateCrossCarriagewayPlatformFlight(variantPlatform, framesPerSecond);
      check(
        flight.firstFrame?.hit === false
          && flight.firstFrame.grounded === false
          && flight.firstFrame.altitudeM > variantPlatform.height
          && flight.firstFrame.velocityMps > 0,
        'A physical jump platform failed to produce genuine airborne separation',
        { variant, framesPerSecond, flight }
      );
      check(flight.contactKind === 'floor', 'A platform trajectory did not finish on the base-road plane', {
        variant,
        framesPerSecond,
        flight
      });
      checkNear(
        flight.landingTimeSeconds,
        flight.expectedAirTimeSeconds,
        0.000_001,
        'Platform landing time diverged from its 9.81m/s2 ballistic solution'
      );
      check(
        Number.isFinite(flight.opposingCenterCrossingSeconds)
          && flight.opposingCenterCrossingSeconds < flight.landingTimeSeconds,
        'Platform flight cannot reach the opposing carriageway centre before landing',
        { variant, framesPerSecond, requiredLateralTravelM, flight }
      );
      const reachMarginM = JUMP_PLATFORM_OPPOSING_CENTER_LATERAL_M - flight.landingLateralM;
      minimumReachMarginM = Math.min(minimumReachMarginM, reachMarginM);
      expectedAirTimeSeconds = flight.expectedAirTimeSeconds;
      landingLateralsByCadence[framesPerSecond] = flight.landingLateralM;
    }
    crossCarriagewayFlights[variant] = Object.freeze({
      grade: variantPlatform.grade,
      heightM: variantPlatform.height,
      requiredLateralTravelM,
      expectedAirTimeSeconds,
      minimumReachMarginM,
      landingLateralsByCadence: Object.freeze(landingLateralsByCadence)
    });
  }

  const edge = platformEdges[0];
  const platform = edge.jumpPlatforms[0];
  const craftHalfWidth = 0.8;
  const supportAtStart = track.sampleJumpPlatformSupport(
    edge.id,
    platform.startS,
    platform.lateral,
    {},
    craftHalfWidth
  );
  const supportAtLip = track.sampleJumpPlatformSupport(
    edge.id,
    platform.lipS,
    platform.lateral,
    {},
    craftHalfWidth
  );
  const baseAtLip = track.sampleEdge(edge.id, platform.lipS, platform.lateral, {});
  checkNear(supportAtStart.height, 0, 0.000_001, 'Jump-platform toe is not flush with the road');
  checkNear(supportAtLip.height, platform.height, 0.000_001, 'Jump-platform lip lost its height');
  checkNear(
    supportAtLip.surfaceHeight,
    baseAtLip.surfaceHeight + platform.height,
    0.000_001,
    'Jump-platform support did not compose over the flat road'
  );
  const fullWidthBoundary = platform.lateral + platform.halfWidth - craftHalfWidth;
  check(
    track.sampleJumpPlatformSupport(
      edge.id,
      platform.lipS,
      fullWidthBoundary,
      {},
      craftHalfWidth
    )?.platformId === platform.id,
    'A complete craft footprint at the platform boundary lost support'
  );
  check(
    track.sampleJumpPlatformSupport(
      edge.id,
      platform.lipS,
      fullWidthBoundary + 0.01,
      {},
      craftHalfWidth
    ) === null,
    'A centre-point overlap incorrectly supported a craft whose width leaves the platform'
  );
  check(
    track.sampleJumpPlatformSupport(
      edge.id,
      platform.lipS + 0.01,
      platform.lateral,
      {},
      craftHalfWidth
    ) === null,
    'Jump-platform support continued beyond the open lip'
  );

  const previousCursor = track.RoutePosition({
    edgeId: edge.id,
    edgeS: platform.lipS - 3,
    runDistance: 0,
    tileIndex: edge.tileIndex
  });
  const currentCursor = track.advanceCursor(previousCursor, 300 * 0.045, plan, {});
  const crossingFraction = 3 / (300 * 0.045);
  const sweptStartLateral = platform.lateral - platform.halfWidth - craftHalfWidth - 1;
  const sweptEndLateral = sweptStartLateral
    + (platform.lateral - sweptStartLateral) / crossingFraction;
  const crossedPlatform = track.crossedJumpPlatformLip(
    previousCursor,
    currentCursor,
    plan,
    sweptStartLateral,
    sweptEndLateral,
    craftHalfWidth
  );
  check(crossedPlatform?.id === platform.id, 'Swept cursor skipped the jump-platform lip', {
    previousEdgeS: previousCursor.edgeS,
    currentEdgeS: currentCursor.edgeS,
    lipS: platform.lipS,
    sweptStartLateral,
    sweptEndLateral
  });
  const partialOverlapLateral = platform.lateral + platform.halfWidth - craftHalfWidth * 0.5;
  check(
    track.crossedJumpPlatformLip(
      previousCursor,
      currentCursor,
      plan,
      partialOverlapLateral,
      partialOverlapLateral,
      craftHalfWidth
    ) === null,
    'Swept lip accepted only a partial craft-width overlap'
  );
  check(
    track.crossedJumpPlatformLip(currentCursor, previousCursor, plan) === null,
    'Backward movement triggered the jump-platform lip'
  );

  Object.assign(summary, {
    edgeId: edge.id,
    platformId: platform.id,
    heightM: platform.height,
    logicalLipS: platform.lipS,
    sweptDistanceM: 300 * 0.045,
    platformCorridors: platformEdges.length,
    variantCount: uniqueVariants.size,
    ballisticAuditSpeedKmh: JUMP_PLATFORM_AUDIT_SPEED_KMH,
    ballisticAuditGravityMps2: JUMP_PLATFORM_AUDIT_GRAVITY_MPS2,
    ballisticAuditCadencesHz: JUMP_PLATFORM_AUDIT_CADENCES_HZ,
    crossCarriagewayFlights: Object.freeze(crossCarriagewayFlights),
    analyticRecoveryEdges: analyticRecoveryEdges.length,
    legacyPointObjectsEliminated: legacyPerEdgePointObjects
  });
}

function validateAirborneLandingSupport(plan, summary) {
  check(typeof track.queryAirborneLandingSupport === 'function',
    'Airborne landing support API is missing');
  check(typeof track.resolveAirborneLandingRoute === 'function',
    'Airborne landing route-adoption API is missing');
  const footprintHalfWidthM = 0.8;
  const footprintHalfLengthM = 1.36;
  const platformEdge = plan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => edge?.jumpPlatformCorridor);
  const platform = platformEdge?.jumpPlatforms?.[0];
  check(platformEdge && platform, 'Airborne landing audit has no jump platform');
  const platformFrame = track.sampleEdge(
    platformEdge.id,
    platform.lipS,
    platform.lateral,
    {}
  );
  const platformLanding = track.queryAirborneLandingSupport(
    platformFrame.x,
    platformFrame.z,
    {
      activeTileTokens: [platformEdge.tileToken],
      pathPlan: plan,
      footprintHalfWidthM,
      footprintHalfLengthM
    },
    {}
  );
  check(
    platformLanding?.edgeId === platformEdge.id
      && platformLanding.platformId === platform.id
      && platformLanding.supportKind === 'jump-platform'
      && platformLanding.routeRelation === 'current-plan',
    'World-XZ query did not select the jump-platform top',
    platformLanding
  );
  checkNear(
    platformLanding.surfaceHeight,
    platformFrame.surfaceHeight + platform.height,
    0.000_001,
    'World-XZ query returned the wrong jump-platform height'
  );

  const edgeBoundaryLateral = platform.lateral + platform.halfWidth - footprintHalfWidthM + 0.01;
  const platformBoundaryFrame = track.sampleEdge(
    platformEdge.id,
    platform.lipS,
    edgeBoundaryLateral,
    {}
  );
  const boundaryLanding = track.queryAirborneLandingSupport(
    platformBoundaryFrame.x,
    platformBoundaryFrame.z,
    {
      activeTileTokens: [platformEdge.tileToken],
      pathPlan: plan,
      footprintHalfWidthM,
      footprintHalfLengthM
    },
    {}
  );
  check(
    boundaryLanding?.supportKind === 'road'
      && boundaryLanding.platformId === null
      && boundaryLanding.routeRelation === 'current-plan',
    'World-XZ query supported a platform using only the craft centre point',
    boundaryLanding
  );

  const continuousPlanSeams = [];
  for (let index = 0; index < plan.edgeIds.length - 1; index++) {
    const beforeEdge = track.getEdge(plan.edgeIds[index]);
    const afterEdge = track.getEdge(plan.edgeIds[index + 1]);
    const before = track.sampleEdge(beforeEdge.id, beforeEdge.length, 0, {});
    const after = track.sampleEdge(afterEdge.id, 0, 0, {});
    if (
      distance3(before, after) <= 0.03
      && Math.abs(before.surfaceHeight - after.surfaceHeight) <= 0.12
      && vectorAngleDegrees(before, after) <= 0.5
    ) continuousPlanSeams.push({ afterEdge, beforeEdge });
  }
  const sameTileSeam = continuousPlanSeams.find(({ afterEdge, beforeEdge }) => (
    afterEdge.tileIndex === beforeEdge.tileIndex
  ));
  const crossTileSeam = continuousPlanSeams.find(({ afterEdge, beforeEdge }) => (
    Number.isInteger(beforeEdge.tileIndex)
      && Number.isInteger(afterEdge.tileIndex)
      && afterEdge.tileIndex !== beforeEdge.tileIndex
  ));
  check(sameTileSeam && crossTileSeam,
    'Airborne landing audit lacks both same-tile and cross-tile continuous road seams');
  const seamDeltasM = [-footprintHalfLengthM + 0.001, -0.5, 0, 0.5, footprintHalfLengthM - 0.001];
  let connectedRoadSeamChecks = 0;
  let exactCrossTileLanding = null;
  for (const seam of [sameTileSeam, crossTileSeam]) {
    const activeTileTokens = [...new Set([
      plan.tiles[0].token,
      seam.beforeEdge.tileToken,
      seam.afterEdge.tileToken,
      ...plan.tiles
        .filter((tile) => (
          tile.index === seam.beforeEdge.tileIndex || tile.index === seam.afterEdge.tileIndex
        ))
        .map((tile) => tile.token)
    ].filter(Boolean))];
    for (const deltaM of seamDeltasM) {
      const landingFrame = deltaM <= 0
        ? track.sampleEdge(seam.beforeEdge.id, seam.beforeEdge.length + deltaM, 0, {})
        : track.sampleEdge(seam.afterEdge.id, deltaM, 0, {});
      const landing = track.queryAirborneLandingSupport(
        landingFrame.x,
        landingFrame.z,
        {
          activeTileTokens,
          pathPlan: plan,
          footprintHalfWidthM,
          footprintHalfLengthM,
          maximumSurfaceHeight: landingFrame.surfaceHeight + 0.08
        },
        {}
      );
      check(
        landing
          && [seam.beforeEdge.id, seam.afterEdge.id].includes(landing.edgeId)
          && landing.routeRelation === 'current-plan'
          && landing.footprintSupportMode === 'connected-road-seam',
        'Continuous road seam became a false off-road landing band',
        {
          beforeEdgeId: seam.beforeEdge.id,
          afterEdgeId: seam.afterEdge.id,
          deltaM,
          landing
        }
      );
      if (seam === crossTileSeam && deltaM === 0) exactCrossTileLanding = landing;
      connectedRoadSeamChecks += 1;
    }
  }
  const seamRouteCursor = track.RoutePosition({
    edgeId: crossTileSeam.beforeEdge.id,
    edgeS: crossTileSeam.beforeEdge.length,
    runDistance: 34_567,
    entryPort: crossTileSeam.beforeEdge.entryPort,
    tileIndex: crossTileSeam.beforeEdge.tileIndex
  });
  const seamResolution = track.resolveAirborneLandingRoute(exactCrossTileLanding, {
    pathPlan: plan,
    routeCursor: seamRouteCursor,
    runDistance: seamRouteCursor.runDistance,
    committedChoices: plan._committedChoices,
    routeChoices: Object.freeze({})
  });
  check(
    seamResolution?.supported === true
      && seamResolution.routeRelation === 'current-plan'
      && seamResolution.continuityErrorM <= 0.001,
    'A supported cross-tile seam landing cannot continue on the authoritative PathPlan',
    seamResolution
  );

  let auditedContinuousLandingSeams = 0;
  let auditedCrossTileLandingSeams = 0;
  for (const entryPort of PORTS) {
    for (const kind of KINDS) {
      const auditPlan = track.createPathPlan({
        movementId: `${entryPort}-${kind}`,
        futureMovementKind: 'straight'
      });
      const activeTileTokens = auditPlan.tiles.map((tile) => tile.token);
      for (let index = 0; index < auditPlan.edgeIds.length - 1; index++) {
        const beforeEdge = track.getEdge(auditPlan.edgeIds[index]);
        const afterEdge = track.getEdge(auditPlan.edgeIds[index + 1]);
        const before = track.sampleEdge(beforeEdge.id, beforeEdge.length, 0, {});
        const after = track.sampleEdge(afterEdge.id, 0, 0, {});
        if (
          distance3(before, after) > 0.03
          || Math.abs(before.surfaceHeight - after.surfaceHeight) > 0.12
          || vectorAngleDegrees(before, after) > 0.5
        ) continue;
        const landing = track.queryAirborneLandingSupport(
          before.x,
          before.z,
          {
            activeTileTokens,
            pathPlan: auditPlan,
            footprintHalfWidthM,
            footprintHalfLengthM,
            maximumSurfaceHeight: before.surfaceHeight + 0.08
          },
          {}
        );
        check(
          landing
            && [beforeEdge.id, afterEdge.id].includes(landing.edgeId)
            && landing.routeRelation === 'current-plan'
            && landing.footprintSupportMode === 'connected-road-seam',
          'A continuous PathPlan seam lacks union-footprint landing support',
          { entryPort, kind, beforeEdgeId: beforeEdge.id, afterEdgeId: afterEdge.id, landing }
        );
        auditedContinuousLandingSeams += 1;
        if (
          Number.isInteger(beforeEdge.tileIndex)
          && Number.isInteger(afterEdge.tileIndex)
          && beforeEdge.tileIndex !== afterEdge.tileIndex
        ) auditedCrossTileLandingSeams += 1;
      }
    }
  }
  check(
    auditedContinuousLandingSeams >= 240 && auditedCrossTileLandingSeams >= 24,
    'Airborne seam matrix did not cover the complete directional route family',
    { auditedContinuousLandingSeams, auditedCrossTileLandingSeams }
  );

  const authorityPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const authorityTile = authorityPlan.tiles[0];
  const authorityForkEdges = track.getRecoveryVisualEdgesForTile(authorityTile)
    .filter((edge) => edge.family === 'straight-fork-branch');
  const currentAuthorityEdge = authorityForkEdges.find((edge) => authorityPlan.edgeIds.includes(edge.id));
  const alternativeAuthorityEdge = authorityForkEdges.find((edge) => !authorityPlan.edgeIds.includes(edge.id));
  check(currentAuthorityEdge && alternativeAuthorityEdge,
    'Route-authority landing audit lacks overlapping selected and alternative fork ribbons');
  const authorityFrame = track.sampleEdge(
    currentAuthorityEdge.id,
    currentAuthorityEdge.length - 0.5,
    3.8,
    {}
  );
  const authorityLanding = track.queryAirborneLandingSupport(
    authorityFrame.x,
    authorityFrame.z,
    {
      activeTileTokens: authorityPlan.tiles.map((tile) => tile.token),
      pathPlan: authorityPlan,
      footprintHalfWidthM,
      footprintHalfLengthM,
      maximumSurfaceHeight: authorityFrame.surfaceHeight + 0.08
    },
    {}
  );
  check(
    authorityLanding?.edgeId === currentAuthorityEdge.id
      && authorityLanding.routeRelation === 'current-plan'
      && authorityLanding.footprintSupportMode === 'connected-road-seam',
    'Microscopic fork-projection noise replaced current route authority at a paved seam',
    {
      currentEdgeId: currentAuthorityEdge.id,
      alternativeEdgeId: alternativeAuthorityEdge.id,
      authorityLanding
    }
  );
  const authorityCursor = track.RoutePosition({
    edgeId: currentAuthorityEdge.id,
    edgeS: currentAuthorityEdge.length - 0.5,
    lateral: 3.8,
    runDistance: 45_678,
    entryPort: currentAuthorityEdge.entryPort,
    tileIndex: currentAuthorityEdge.tileIndex
  });
  const authorityResolution = track.resolveAirborneLandingRoute(authorityLanding, {
    pathPlan: authorityPlan,
    routeCursor: authorityCursor,
    runDistance: authorityCursor.runDistance,
    committedChoices: authorityPlan._committedChoices
  });
  check(
    authorityResolution?.supported === true
      && authorityResolution.routeRelation === 'current-plan'
      && authorityResolution.pathPlan === authorityPlan
      && authorityResolution.cursor.edgeId === currentAuthorityEdge.id,
    'A physically tied seam landing adopted the selectable sibling route',
    authorityResolution
  );

  const inactiveContinuationFrame = track.sampleEdge(
    crossTileSeam.beforeEdge.id,
    crossTileSeam.beforeEdge.length - (footprintHalfLengthM - 0.1),
    0,
    {}
  );
  check(
    track.queryAirborneLandingSupport(
      inactiveContinuationFrame.x,
      inactiveContinuationFrame.z,
      {
        activeTileTokens: [crossTileSeam.beforeEdge.tileToken],
        pathPlan: plan,
        footprintHalfWidthM,
        footprintHalfLengthM,
        maximumSurfaceHeight: inactiveContinuationFrame.surfaceHeight + 0.08
      },
      {}
    ) === null,
    'An inactive next tile created a longitudinal ghost landing surface'
  );

  let complementaryEdge = null;
  let complementaryTile = null;
  for (const tile of plan.tiles) {
    complementaryEdge = track.getRecoveryVisualEdgesForTile(tile)
      .find((edge) => edge?.forkSide && !plan.edgeIds.includes(edge.id));
    if (complementaryEdge) {
      complementaryTile = tile;
      break;
    }
  }
  check(complementaryEdge && complementaryTile,
    'No unselected physical recovery branch exists for airborne landing');
  const complementaryFrame = track.sampleEdge(
    complementaryEdge.id,
    complementaryEdge.length * 0.5,
    0,
    {}
  );
  const complementaryLanding = track.queryAirborneLandingSupport(
    complementaryFrame.x,
    complementaryFrame.z,
    {
      activeTileTokens: [complementaryTile.token],
      pathPlan: plan,
      footprintHalfWidthM,
      footprintHalfLengthM
    },
    {}
  );
  check(
    complementaryLanding?.edgeId === complementaryEdge.id
      && complementaryLanding.supportKind === 'road'
      && complementaryLanding.routeRelation === 'selectable-alternative',
    'Unselected complementary road branch cannot catch an airborne craft',
    complementaryLanding
  );
  check(!plan.edgeIds.includes(complementaryEdge.id),
    'Complementary landing branch unexpectedly entered PathPlan');
  const selectedComplementarySibling = plan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => (
      edge?.family === 'straight-fork-branch'
      && edge.decisionNodeId === complementaryEdge.decisionNodeId
    ));
  check(selectedComplementarySibling,
    'Selected PathPlan has no sibling for the complementary landing branch');
  const complementaryRouteCursor = track.RoutePosition({
    edgeId: selectedComplementarySibling.id,
    edgeS: selectedComplementarySibling.length * 0.5,
    runDistance: 12_345,
    entryPort: selectedComplementarySibling.entryPort,
    tileIndex: selectedComplementarySibling.tileIndex
  });
  const complementaryResolution = track.resolveAirborneLandingRoute(complementaryLanding, {
    pathPlan: plan,
    routeCursor: complementaryRouteCursor,
    runDistance: complementaryRouteCursor.runDistance,
    committedChoices: plan._committedChoices,
    routeChoices: Object.freeze({})
  });
  check(
    complementaryResolution?.supported === true
      && complementaryResolution.routeRelation === 'selectable-alternative'
      && complementaryResolution.pathPlan.edgeIds.includes(complementaryEdge.id)
      && !complementaryResolution.pathPlan.edgeIds.includes(selectedComplementarySibling.id)
      && complementaryResolution.cursor.edgeId === complementaryEdge.id
      && complementaryResolution.cursor.exited === false,
    'Complementary landing did not atomically adopt its physical branch',
    complementaryResolution
  );
  check(complementaryResolution.continuityErrorM <= 0.001,
    'Complementary route adoption moved the craft in world space', complementaryResolution);
  check(complementaryResolution.headingErrorDeg <= 0.5,
    'Complementary route adoption introduced a heading seam', complementaryResolution);
  const complementaryAdoptedFrame = track.sampleRouteCursor(
    complementaryResolution.cursor,
    complementaryResolution.lateral,
    {}
  );
  check(
    Math.hypot(
      complementaryAdoptedFrame.x - complementaryLanding.worldX,
      complementaryAdoptedFrame.z - complementaryLanding.worldZ
    ) <= 0.001,
    'Complementary route cursor does not represent the queried landing point',
    { complementaryLanding, complementaryAdoptedFrame }
  );
  const complementaryContinuation = track.advanceRouteCursor(
    complementaryResolution.cursor,
    complementaryEdge.length - complementaryResolution.cursor.edgeS + 500,
    complementaryResolution.pathPlan
  );
  check(
    complementaryContinuation.cursor.exited === false
      && complementaryContinuation.cursor.edgeId !== complementaryEdge.id,
    'Complementary route adoption cannot continue through the fork merge',
    complementaryContinuation
  );

  const opposingTile = plan.tiles.find((tile) => tile.index > 0);
  const opposingEdge = track.getBidirectionalVisualEdgesForTile(opposingTile)
    .find((edge) => edge.bidirectionalRole === BIDIRECTIONAL_OPPOSING_INTERTILE);
  check(opposingEdge, 'No persistent opposing inter-tile carriageway exists');
  const opposingFrame = track.sampleEdge(opposingEdge.id, opposingEdge.length * 0.5, 0, {});
  const opposingLanding = track.queryAirborneLandingSupport(
    opposingFrame.x,
    opposingFrame.z,
    {
      activeTileTokens: [opposingTile.token],
      pathPlan: plan,
      footprintHalfWidthM,
      footprintHalfLengthM
    },
    {}
  );
  check(
    opposingLanding?.edgeId === opposingEdge.id
      && opposingLanding.supportKind === 'road'
      && opposingLanding.routeRelation === 'opposing-counterflow'
      && opposingLanding.airborneLandingSurface === true,
    'Visual-only opposing carriageway cannot catch an airborne craft',
    opposingLanding
  );
  check(
    opposingEdge.visualOnly === true
      && opposingEdge.gameplaySurface === false
      && opposingEdge.collisionEnabled === false
      && !plan.edgeIds.includes(opposingEdge.id),
    'Opposing landing support leaked into ordinary routing or collision',
    opposingEdge.id
  );
  const opposingRouteCursor = track.RoutePosition({
    edgeId: plan.edgeIds[0],
    edgeS: 0,
    runDistance: 23_456,
    entryPort: plan.entryPort,
    tileIndex: plan.tileBaseIndex
  });
  const opposingResolution = track.resolveAirborneLandingRoute(opposingLanding, {
    pathPlan: plan,
    routeCursor: opposingRouteCursor,
    runDistance: opposingRouteCursor.runDistance,
    committedChoices: plan._committedChoices,
    routeChoices: Object.freeze({})
  });
  check(
    opposingResolution?.supported === true
      && opposingResolution.routeRelation === 'opposing-counterflow'
      && opposingResolution.cursor.exited === false
      && opposingResolution.pathPlan.edgeIds.includes(opposingResolution.cursor.edgeId)
      && opposingResolution.pathPlan.edgeIds.every((edgeId) => track.getEdge(edgeId)?.visualOnly !== true),
    'Opposing-road landing did not become a real gameplay PathPlan',
    opposingResolution
  );
  check(opposingResolution.continuityErrorM <= 0.001,
    'Opposing-road route adoption moved the craft in world space', opposingResolution);
  check(opposingResolution.headingErrorDeg <= 0.5,
    'Opposing-road route adoption introduced a heading seam', opposingResolution);
  const opposingAdoptedFrame = track.sampleRouteCursor(
    opposingResolution.cursor,
    opposingResolution.lateral,
    {}
  );
  check(
    Math.hypot(
      opposingAdoptedFrame.x - opposingLanding.worldX,
      opposingAdoptedFrame.z - opposingLanding.worldZ
    ) <= 0.001,
    'Opposing proxy cursor does not represent the queried landing point',
    { opposingLanding, opposingAdoptedFrame }
  );

  const opposingCursorIndex = opposingResolution.pathPlan.edgeIds
    .indexOf(opposingResolution.cursor.edgeId);
  const opposingChainIds = opposingResolution.pathPlan.edgeIds.slice(
    opposingCursorIndex,
    opposingCursorIndex + 4
  );
  const opposingChainEdges = opposingChainIds.map((edgeId) => track.getEdge(edgeId));
  check(
    opposingChainEdges[0]?.family === 'opposing-recovery-proxy'
      && opposingChainEdges[1]?.family === 'opposing-crossover'
      && opposingChainEdges[2]?.family === 'approach'
      && opposingChainEdges[3]?.runtimeKind === 'template',
    'Opposing recovery does not lead through proxy, long crossover, and the next normal interchange',
    opposingChainEdges.map((edge) => ({
      id: edge?.id,
      family: edge?.family,
      runtimeKind: edge?.runtimeKind
    }))
  );
  let maximumOpposingSeamPositionM = 0;
  let maximumOpposingSeamHeadingDeg = 0;
  for (let index = 0; index < opposingChainEdges.length - 1; index++) {
    const beforeEdge = opposingChainEdges[index];
    const afterEdge = opposingChainEdges[index + 1];
    const before = track.sampleEdge(beforeEdge.id, beforeEdge.length, 0, {});
    const after = track.sampleEdge(afterEdge.id, 0, 0, {});
    const positionErrorM = distance3(before, after);
    const headingErrorDeg = vectorAngleDegrees(before, after);
    maximumOpposingSeamPositionM = Math.max(maximumOpposingSeamPositionM, positionErrorM);
    maximumOpposingSeamHeadingDeg = Math.max(maximumOpposingSeamHeadingDeg, headingErrorDeg);
    check(positionErrorM <= 0.001, 'Opposing recovery has a visible centreline seam', {
      beforeEdgeId: beforeEdge.id,
      afterEdgeId: afterEdge.id,
      positionErrorM
    });
    check(headingErrorDeg <= 0.5, 'Opposing recovery has an unsafe heading seam', {
      beforeEdgeId: beforeEdge.id,
      afterEdgeId: afterEdge.id,
      headingErrorDeg
    });
  }
  for (const edge of opposingChainEdges.slice(0, 3)) {
    check(
      edge.gameplaySurface !== false
        && edge.collisionEnabled !== false
        && track.getEntitySurfaceId(edge.id) === edge.surfaceId,
      'Adopted opposing route edge is not a gameplay/entity surface',
      edge
    );
  }
  const distanceIntoNormalInterchange = (
    opposingChainEdges[0].length - opposingResolution.cursor.edgeS
    + opposingChainEdges[1].length
    + opposingChainEdges[2].length
    + 25
  );
  const opposingContinuation = track.advanceRouteCursor(
    opposingResolution.cursor,
    distanceIntoNormalInterchange,
    opposingResolution.pathPlan
  );
  check(
    opposingContinuation.cursor.exited === false
      && opposingContinuation.cursor.edgeId === opposingChainEdges[3].id,
    'Opposing crossover cannot enter the next normal interchange',
    opposingContinuation
  );
  const entityCursor = track.advanceRouteCursor(
    opposingResolution.cursor,
    Math.min(160, opposingChainEdges[0].length - opposingResolution.cursor.edgeS + 80),
    opposingResolution.pathPlan
  ).cursor;
  const entityDistance = track.distanceAlongPath(
    opposingResolution.cursor,
    entityCursor,
    opposingResolution.pathPlan
  );
  const entityPlacements = track.getReachableTrafficPlacements(
    entityCursor,
    opposingResolution.committedChoices
  );
  check(
    Number.isFinite(entityDistance)
      && entityDistance >= 0
      && entityPlacements.length >= 1
      && entityPlacements.every((placement) => (
        opposingResolution.pathPlan.edgeIds.includes(placement.cursor.edgeId)
      )),
    'Adopted opposing PathPlan cannot drive ordinary entity distance and spawn placement',
    { entityDistance, entityPlacements }
  );

  let unsupportedLanding = null;
  for (const edge of track.graph.edges) {
    if (
      plan.edgeIds.includes(edge.id)
      || edge.gameplaySurface === false
      || edge.length <= footprintHalfLengthM * 2 + 1
    ) continue;
    const edgeFrame = track.sampleEdge(edge.id, edge.length * 0.5, 0, {});
    const candidate = track.queryAirborneLandingSupport(
      edgeFrame.x,
      edgeFrame.z,
      {
        activeTileTokens: [plan.tiles[0].token],
        pathPlan: plan,
        footprintHalfWidthM,
        footprintHalfLengthM,
        maximumSurfaceHeight: edgeFrame.surfaceHeight + 0.01
      },
      {}
    );
    if (candidate?.edgeId === edge.id && candidate.routeRelation === 'unsupported') {
      unsupportedLanding = candidate;
      break;
    }
  }
  check(unsupportedLanding?.routeRelation === 'unsupported',
    'Landing query did not classify a detached physical road as unsupported');
  const unsupportedResolution = track.resolveAirborneLandingRoute(unsupportedLanding, {
    pathPlan: plan,
    routeCursor: opposingRouteCursor,
    runDistance: opposingRouteCursor.runDistance,
    committedChoices: plan._committedChoices,
    routeChoices: Object.freeze({})
  });
  check(
    unsupportedResolution?.supported === false
      && unsupportedResolution.routeRelation === 'unsupported',
    'Unsupported pavement unexpectedly acquired route authority',
    unsupportedResolution
  );

  const unrelatedTile = plan.tiles.find((tile) => tile.token !== opposingTile.token);
  check(
    track.queryAirborneLandingSupport(
      opposingFrame.x,
      opposingFrame.z,
      {
        activeTileTokens: [unrelatedTile.token],
        pathPlan: plan,
        footprintHalfWidthM,
        footprintHalfLengthM
      },
      {}
    ) === null,
    'Inactive tile pavement leaked into airborne landing support'
  );
  const opposingEnd = track.sampleEdge(opposingEdge.id, opposingEdge.length, 0, {});
  const outsideEndDistance = footprintHalfLengthM + 0.5;
  const outsideEnd = {
    x: opposingEnd.centerX + opposingEnd.horizontalTangentX * outsideEndDistance,
    z: opposingEnd.centerZ + opposingEnd.horizontalTangentZ * outsideEndDistance
  };
  check(
    track.queryAirborneLandingSupport(
      outsideEnd.x,
      outsideEnd.z,
      {
        activeTileTokens: [opposingTile.token],
        pathPlan: plan,
        footprintHalfWidthM,
        footprintHalfLengthM
      },
      {}
    ) === null,
    'Road endpoint projection created a longitudinal ghost landing surface'
  );

  Object.assign(summary, {
    platformEdgeId: platformLanding.edgeId,
    complementaryEdgeId: complementaryLanding.edgeId,
    opposingEdgeId: opposingLanding.edgeId,
    opposingSurfaceKind: opposingLanding.supportKind,
    routeRelations: Object.freeze([
      platformLanding.routeRelation,
      complementaryLanding.routeRelation,
      opposingLanding.routeRelation,
      unsupportedLanding.routeRelation
    ]),
    complementaryContinuationEdgeId: complementaryContinuation.cursor.edgeId,
    opposingContinuationEdgeId: opposingContinuation.cursor.edgeId,
    opposingGameplayEntityDistanceM: entityDistance,
    maximumOpposingSeamPositionM,
    maximumOpposingSeamHeadingDeg,
    connectedRoadSeamChecks,
    auditedContinuousLandingSeams,
    auditedCrossTileLandingSeams,
    routeAuthorityTieChecks: 1,
    sameTileLandingSeam: Object.freeze([
      sameTileSeam.beforeEdge.id,
      sameTileSeam.afterEdge.id
    ]),
    crossTileLandingSeam: Object.freeze([
      crossTileSeam.beforeEdge.id,
      crossTileSeam.afterEdge.id
    ]),
    footprintHalfWidthM,
    footprintHalfLengthM,
    endpointOverflowRejected: true
  });
}

/** Audit every entry orientation through the fully supported crossover and the next ordinary route decision. */
function validateOpposingCrossoverSupportAndContinuation(summary) {
  const footprintHalfWidthM = 0.8;
  const footprintHalfLengthM = 1.36;
  const crossoverOverlapLengthM = 1_080;
  const crossoverPointwiseStepM = 1;
  const auditSpeedKmh = 280;
  const standardGravityMps2 = 9.806_65;
  const visibilityBounds = Object.freeze({
    minX: -1_000_000,
    maxX: 1_000_000,
    minZ: -1_000_000,
    maxZ: 1_000_000
  });
  const ordinaryMaximumSupportGapM = 104.01;
  const crossoverMaximumSupportGapM = 176.01;
  const inspectSupport = (runtimeEdges) => {
    const edgesById = Object.freeze(Object.fromEntries(
      runtimeEdges.map((edge) => [edge.id, edge])
    ));
    const scopedTrack = {
      graph: Object.freeze({ contract: track.graph.contract, edgesById }),
      sampleEdge: (...args) => track.sampleEdge(...args),
      getEdge: (edgeId) => edgesById[edgeId] || track.getEdge(edgeId),
      getRuntimeEdgesForTileIndex: (tileIndex) => track.getRuntimeEdgesForTileIndex(tileIndex),
      queryRoadClearance: (...args) => track.queryRoadClearance(...args)
    };
    return cloverleafVisuals.inspectRuntimeSupportLayout(scopedTrack, runtimeEdges);
  };
  let routeExteriorSupportCount = 0;
  let maximumRouteExteriorSupportLateralM = 0;
  let maximumContinuationDistanceM = 0;
  let destinationExtensionLandingChecks = 0;
  let destinationExtensionCacheChecks = 0;
  let crossoverVisibilityLifecycleChecks = 0;
  let crossoverPointwiseOverlapChecks = 0;
  let crossoverHeightAwareClearanceChecks = 0;
  let maximumDestinationLandingPositionErrorM = 0;
  let maximumDestinationLandingHeadingErrorDeg = 0;
  let maximumCrossoverOverlapPositionErrorM = 0;
  let maximumCrossoverOverlapHeadingErrorDeg = 0;
  let maximumCrossoverCurvaturePerM = 0;
  let maximumCrossoverVerticalCurvaturePerM = 0;
  let maximumCrossoverSpatialCurvaturePerM = 0;
  let maximumCrossoverVerticalGAt280Kmh = 0;
  let maximumCrossoverSpatialGAt280Kmh = 0;

  for (const entryPort of PORTS) {
    const sourcePlan = track.createPathPlan({
      entryPort,
      kind: 'straight',
      futureMovementKind: 'straight'
    });
    const ordinaryRecoveryEdges = track.getRecoveryVisualEdgesForTile(sourcePlan.tiles[0]);
    check(
      ordinaryRecoveryEdges.length > 0
        && ordinaryRecoveryEdges.every((edge) => edge.supportSpanContract === null),
      'Ordinary recovery road unexpectedly acquired a long-span structure contract',
      { entryPort, edgeIds: ordinaryRecoveryEdges.map((edge) => edge.id) }
    );
    const ordinaryReport = inspectSupport(ordinaryRecoveryEdges);
    checkNear(
      ordinaryReport.standardMaximumAllowedGap,
      104.01,
      0.000_001,
      'Ordinary bridge-support spacing was relaxed by the crossover contract'
    );
    checkNear(
      ordinaryReport.maximumAllowedGap,
      104.01,
      0.000_001,
      'Ordinary bridge-support audit no longer uses the two-bay maximum'
    );

    const opposingTile = sourcePlan.tiles.find((tile) => tile.index > 0);
    // Prime the ordinary selector before adoption: a later bypass query must not reuse this cached edge set.
    const ordinaryBidirectionalEdges = track.getBidirectionalVisualEdgesForTile(opposingTile);
    const opposingEdge = ordinaryBidirectionalEdges
      .find((edge) => edge.bidirectionalRole === BIDIRECTIONAL_OPPOSING_INTERTILE);
    const destinationEntryExtension = ordinaryBidirectionalEdges.find((edge) => (
      edge.bidirectionalRole === BIDIRECTIONAL_OUTBOUND_EXTENSION
        && edge.bidirectionalPort === opposingTile.entryPort
    ));
    check(opposingEdge, 'Entry orientation has no persistent opposing carriageway', entryPort);
    check(
      destinationEntryExtension?.airborneLandingSurface === true
        && destinationEntryExtension.length >= crossoverOverlapLengthM,
      'Destination-owned entry extension is not a complete airborne landing surface',
      {
        entryPort,
        tileToken: opposingTile.token,
        extension: destinationEntryExtension
      }
    );
    const opposingFrame = track.sampleEdge(opposingEdge.id, opposingEdge.length * 0.5, 0, {});
    const landing = track.queryAirborneLandingSupport(
      opposingFrame.x,
      opposingFrame.z,
      {
        activeTileTokens: [opposingTile.token],
        pathPlan: sourcePlan,
        footprintHalfWidthM,
        footprintHalfLengthM
      },
      {}
    );
    check(
      landing?.edgeId === opposingEdge.id
        && landing.routeRelation === 'opposing-counterflow',
      'Entry orientation cannot resolve its opposing-road landing',
      { entryPort, landing }
    );
    const sourceCursor = track.RoutePosition({
      edgeId: sourcePlan.edgeIds[0],
      edgeS: 0,
      runDistance: 23_456,
      entryPort: sourcePlan.entryPort,
      tileIndex: sourcePlan.tileBaseIndex
    });
    const resolution = track.resolveAirborneLandingRoute(landing, {
      pathPlan: sourcePlan,
      routeCursor: sourceCursor,
      runDistance: sourceCursor.runDistance,
      committedChoices: sourcePlan._committedChoices,
      routeChoices: Object.freeze({})
    });
    check(resolution?.supported === true, 'Opposing landing did not produce an adopted itinerary', {
      entryPort,
      resolution
    });
    const adoptedTile = resolution.pathPlan.tiles[0];
    const recoveryEdges = track.getRecoveryVisualEdgesForTile(adoptedTile);
    check(
      adoptedTile.opposingBypass === true
        && recoveryEdges.length === 1
        && recoveryEdges[0].family === 'opposing-crossover',
      'Opposing bypass still publishes the replaced ordinary recovery corridor',
      { entryPort, adoptedTile, recoveryEdgeIds: recoveryEdges.map((edge) => edge.id) }
    );
    const adoptedBidirectionalEdges = track.getBidirectionalVisualEdgesForTile(adoptedTile, {
      includeSelectedExit: true,
      includeLongCorridor: true
    });
    check(
      !adoptedBidirectionalEdges.some((edge) => (
        edge.bidirectionalRole === BIDIRECTIONAL_OUTBOUND_EXTENSION
          && edge.bidirectionalPort === adoptedTile.entryPort
      )),
      'Opposing bypass reused the cached ordinary entry extension',
      {
        entryPort,
        tileToken: adoptedTile.token,
        edgeIds: adoptedBidirectionalEdges.map((edge) => edge.id)
      }
    );
    destinationExtensionCacheChecks++;
    const proxyEdge = track.getEdge(resolution.pathPlan.edgeIds[0]);
    const crossoverEdge = recoveryEdges[0];
    check(
      proxyEdge?.family === 'opposing-recovery-proxy'
        && proxyEdge.supportSpanContract === null,
      'Reverse proxy unexpectedly acquired a bridge structure contract',
      { entryPort, proxyEdge }
    );
    check(
      crossoverEdge.supportSpanContract?.kind === 'continuous-box-girder'
        && crossoverEdge.supportSpanContract.supportSpacingM === 88
        && crossoverEdge.supportSpanContract.fasciaSegmentM === 24
        && crossoverEdge.supportSpanContract.fasciaDepthM <= track.graph.contract.deckThickness,
      'Opposing crossover lost its bounded continuous box-girder contract',
      { entryPort, contract: crossoverEdge.supportSpanContract }
    );
    maximumCrossoverCurvaturePerM = Math.max(
      maximumCrossoverCurvaturePerM,
      crossoverEdge.curvatureProfile?.maxAbsCurvature || 0
    );
    maximumCrossoverVerticalCurvaturePerM = Math.max(
      maximumCrossoverVerticalCurvaturePerM,
      crossoverEdge.curvatureProfile?.maxAbsVerticalCurvature || 0
    );
    maximumCrossoverSpatialCurvaturePerM = Math.max(
      maximumCrossoverSpatialCurvaturePerM,
      crossoverEdge.curvatureProfile?.maxSpatialCurvature || 0
    );
    check(
      crossoverEdge.curvatureProfile?.maxAbsCurvature <= 0.000_210,
      'Opposing crossover exceeds its 280km/h local-merge curvature contract',
      {
        entryPort,
        maximumCurvaturePerM: crossoverEdge.curvatureProfile?.maxAbsCurvature
      }
    );
    const profile = crossoverEdge.opposingCrossoverProfileLut;
    const profilePointCount = profile.planarStations.length;
    const surfaceStationAtPlanar = (planarS) => {
      const scaledIndex = clamp(planarS / profile.planarLength, 0, 1) * (profilePointCount - 1);
      const low = Math.min(profilePointCount - 2, Math.max(0, Math.floor(scaledIndex)));
      const high = low + 1;
      const blend = scaledIndex - low;
      return profile.surfaceStations[low]
        + (profile.surfaceStations[high] - profile.surfaceStations[low]) * blend;
    };
    check(
      profile.id === 'opposing-crossover-profile-v5-local-merge'
        && profile.lateralStartS === 1_440
        && profile.lateralTransitionLength === 720
        && profile.verticalTransitionLength === 720
        && profile.verticalPlateauLength === 240
        && profile.verticalStartS === crossoverOverlapLengthM
        && profile.verticalRiseEndS === 1_800
        && profile.verticalFallStartS === 2_040
        && profile.verticalFallEndS === 2_760
        && profile.exitStabilizationLength === profile.planarLength - 2_760
        && profile.connectorRoadHalf === 5.6
        && profile.widthNarrowStartS === 1_080
        && profile.widthNarrowEndS === 1_200
        && profile.widthWidenStartS === 2_640
        && profile.widthWidenEndS === 2_760,
      'Opposing crossover lost its localized rise, crest, S-merge, width, or exit-stabilization contract',
      {
        entryPort,
        profileId: profile.id,
        planarLength: profile.planarLength,
        verticalStartS: profile.verticalStartS,
        verticalTransitionLength: profile.verticalTransitionLength,
        verticalRiseEndS: profile.verticalRiseEndS,
        verticalFallStartS: profile.verticalFallStartS,
        verticalFallEndS: profile.verticalFallEndS,
        lateralStartS: profile.lateralStartS,
        lateralTransitionLength: profile.lateralTransitionLength,
        connectorRoadHalf: profile.connectorRoadHalf
      }
    );
    check(
      profile.curvatureProfile.verticalCurvatures.length === profilePointCount
        && profile.curvatureProfile.spatialCurvatures.length === profilePointCount,
      'Crossover profile omitted vertical or spatial curvature diagnostics',
      { entryPort, profilePointCount }
    );
    const widthSamples = [
      [0, 8.4],
      [1_080, 8.4],
      [1_200, 5.6],
      [1_440, 5.6],
      [2_160, 5.6],
      [2_640, 5.6],
      [2_760, 8.4],
      [profile.planarLength, 8.4]
    ];
    for (const [planarS, expectedRoadHalf] of widthSamples) {
      checkNear(
        track.sampleEdge(
          crossoverEdge.id,
          surfaceStationAtPlanar(planarS),
          0,
          {}
        ).roadHalf,
        expectedRoadHalf,
        0.000_001,
        `Opposing crossover road half is wrong at planar station ${planarS}`
      );
    }
    const verticalBoundaryFrames = [
      track.sampleEdge(crossoverEdge.id, surfaceStationAtPlanar(profile.verticalStartS), 0, {}),
      track.sampleEdge(crossoverEdge.id, surfaceStationAtPlanar(profile.verticalRiseEndS), 0, {}),
      track.sampleEdge(crossoverEdge.id, surfaceStationAtPlanar(profile.verticalFallStartS), 0, {}),
      track.sampleEdge(crossoverEdge.id, surfaceStationAtPlanar(profile.verticalFallEndS), 0, {}),
      track.sampleEdge(crossoverEdge.id, crossoverEdge.length, 0, {})
    ];
    check(
      verticalBoundaryFrames.every((frame) => (
        Math.abs(frame.grade) <= 0.000_000_01
          && Math.abs(frame.verticalCurvature) <= 0.000_000_01
      )),
      'C2 vertical profile retained a grade or curvature kink at a flat join',
      {
        entryPort,
        joins: verticalBoundaryFrames.map((frame) => ({
          edgeS: frame.edgeS,
          grade: frame.grade,
          verticalCurvature: frame.verticalCurvature
        }))
      }
    );
    checkNear(
      verticalBoundaryFrames[1].centerY,
      20,
      0.000_001,
      'Opposing crossover did not reach its 20m crest after the localized rise'
    );
    checkNear(
      verticalBoundaryFrames[2].centerY,
      20,
      0.000_001,
      'Opposing crossover did not retain its 20m flat structural crest'
    );
    checkNear(
      verticalBoundaryFrames[3].centerY,
      crossoverEdge.recoveryEnd.y,
      0.000_001,
      'Opposing crossover did not return to destination elevation after its local fall'
    );
    checkNear(
      verticalBoundaryFrames[4].centerY,
      crossoverEdge.recoveryEnd.y,
      0.000_001,
      'Opposing crossover did not return to its destination elevation'
    );
    let sampledMaximumVerticalCurvature = 0;
    let sampledMaximumSpatialCurvature = 0;
    let sampledMaximumHorizontalCurvature = 0;
    for (
      let sampleS = 0;
      sampleS <= crossoverEdge.length + 0.000_001;
      sampleS += 2
    ) {
      const frame = track.sampleEdge(
        crossoverEdge.id,
        Math.min(sampleS, crossoverEdge.length),
        0,
        {}
      );
      sampledMaximumHorizontalCurvature = Math.max(
        sampledMaximumHorizontalCurvature,
        Math.abs(frame.curvature)
      );
      sampledMaximumVerticalCurvature = Math.max(
        sampledMaximumVerticalCurvature,
        Math.abs(frame.verticalCurvature)
      );
      sampledMaximumSpatialCurvature = Math.max(
        sampledMaximumSpatialCurvature,
        frame.spatialCurvature
      );
    }
    checkNear(
      sampledMaximumHorizontalCurvature,
      crossoverEdge.curvatureProfile.maxAbsCurvature,
      0.000_000_01,
      'Sampled horizontal steering curvature diverged from its dedicated profile diagnostic'
    );
    checkNear(
      sampledMaximumVerticalCurvature,
      crossoverEdge.curvatureProfile.maxAbsVerticalCurvature,
      0.000_000_01,
      'Sampled vertical curvature diverged from its dedicated profile diagnostic'
    );
    checkNear(
      sampledMaximumSpatialCurvature,
      crossoverEdge.curvatureProfile.maxSpatialCurvature,
      0.000_000_01,
      'Sampled 3D curvature diverged from its dedicated profile diagnostic'
    );
    const speedMps = auditSpeedKmh / 3.6;
    const verticalG = speedMps ** 2 * sampledMaximumVerticalCurvature / standardGravityMps2;
    const spatialG = speedMps ** 2 * sampledMaximumSpatialCurvature / standardGravityMps2;
    maximumCrossoverVerticalGAt280Kmh = Math.max(
      maximumCrossoverVerticalGAt280Kmh,
      verticalG
    );
    maximumCrossoverSpatialGAt280Kmh = Math.max(
      maximumCrossoverSpatialGAt280Kmh,
      spatialG
    );
    check(
      verticalG <= 0.103 && spatialG <= 0.17,
      'Opposing crossover exceeds its real 280km/h vertical or combined normal-load contract',
      { entryPort, verticalG, spatialG }
    );
    const crossoverSupportS = crossoverEdge.length * 0.62;
    const crossoverSupportCenter = track.sampleEdge(crossoverEdge.id, crossoverSupportS, 0, {});
    const crossoverSupportLateral = crossoverSupportCenter.roadHalf * 0.6;
    const crossoverSupportFrame = track.sampleEdge(
      crossoverEdge.id,
      crossoverSupportS,
      crossoverSupportLateral,
      {}
    );
    const crossoverSupportUndersideY = crossoverSupportFrame.y
      - track.graph.contract.deckThickness / crossoverSupportFrame.upY;
    const crossoverClearanceIgnoreIds = [
      ...track.graph.edges.map((edge) => edge.id),
      ...track.getRuntimeEdgesForTileIndex(crossoverEdge.tileIndex)
        .filter((edge) => edge.id !== crossoverEdge.id)
        .map((edge) => edge.id)
    ];
    const crossoverSupportContact = track.queryRoadClearance(
      crossoverSupportFrame.x,
      crossoverSupportFrame.z,
      0,
      {
        gap: 0,
        ignoreEdgeIds: crossoverClearanceIgnoreIds,
        verticalEnvelope: { minY: -1.18, maxY: crossoverSupportUndersideY }
      }
    );
    const crossoverSupportPenetration = track.queryRoadClearance(
      crossoverSupportFrame.x,
      crossoverSupportFrame.z,
      0,
      {
        gap: 0,
        ignoreEdgeIds: crossoverClearanceIgnoreIds,
        verticalEnvelope: { minY: -1.18, maxY: crossoverSupportUndersideY + 0.08 }
      }
    );
    check(
      crossoverSupportContact.clear,
      'Opposing-crossover slab contact was misclassified as penetration',
      { entryPort, crossoverSupportContact }
    );
    check(
      crossoverSupportPenetration.intersects
        && crossoverSupportPenetration.edgeId === crossoverEdge.id
        && Math.abs(crossoverSupportPenetration.edgeS - crossoverSupportFrame.edgeS) <= 0.002
        && Math.abs(
          crossoverSupportPenetration.roadLateral - crossoverSupportLateral
        ) <= 0.002,
      'Opposing-crossover height-aware projection lost its actual route station or lateral',
      { entryPort, frame: crossoverSupportFrame, crossoverSupportPenetration }
    );
    crossoverHeightAwareClearanceChecks++;

    // The crossover's first 1,080m is the gameplay alias of the visual entry ribbon, traversed in reverse.
    // A one-metre audit catches any horizontal, vertical, or heading divergence that would snap a landing.
    for (
      let crossoverS = 0;
      crossoverS <= crossoverOverlapLengthM;
      crossoverS += crossoverPointwiseStepM
    ) {
      const visualS = destinationEntryExtension.length - crossoverS;
      const crossoverFrame = track.sampleEdge(crossoverEdge.id, crossoverS, 0, {});
      const visualFrame = track.sampleEdge(destinationEntryExtension.id, visualS, 0, {});
      const positionErrorM = distance3(crossoverFrame, visualFrame);
      const headingErrorDeg = Math.abs(normalizedAngle(
        crossoverFrame.heading - visualFrame.heading - Math.PI
      )) * DEGREES;
      maximumCrossoverOverlapPositionErrorM = Math.max(
        maximumCrossoverOverlapPositionErrorM,
        positionErrorM
      );
      maximumCrossoverOverlapHeadingErrorDeg = Math.max(
        maximumCrossoverOverlapHeadingErrorDeg,
        headingErrorDeg
      );
      check(positionErrorM <= 0.001, 'Crossover no longer overlays the reversed entry ribbon pointwise', {
        entryPort,
        crossoverS,
        visualS,
        positionErrorM
      });
      check(headingErrorDeg <= 0.5, 'Crossover overlap heading no longer opposes the visual ribbon', {
        entryPort,
        crossoverS,
        visualS,
        headingErrorDeg
      });
      crossoverPointwiseOverlapChecks++;
    }

    const landingStations = Object.freeze([
      footprintHalfLengthM,
      destinationEntryExtension.length * 0.25,
      destinationEntryExtension.length * 0.5,
      destinationEntryExtension.length * 0.75,
      destinationEntryExtension.length - footprintHalfLengthM
    ]);
    for (let stationIndex = 0; stationIndex < landingStations.length; stationIndex++) {
      const edgeS = landingStations[stationIndex];
      const sourceLateral = stationIndex % 2 === 0 ? 2.4 : -2.4;
      const sourceFrame = track.sampleEdge(
        destinationEntryExtension.id,
        edgeS,
        sourceLateral,
        {}
      );
      const extensionLanding = track.queryAirborneLandingSupport(
        sourceFrame.x,
        sourceFrame.z,
        {
          activeTileTokens: [opposingTile.token],
          pathPlan: sourcePlan,
          footprintHalfWidthM,
          footprintHalfLengthM,
          maximumSurfaceHeight: sourceFrame.surfaceHeight + 0.001
        },
        {}
      );
      check(
        extensionLanding?.edgeId === destinationEntryExtension.id
          && extensionLanding.routeRelation === 'opposing-counterflow',
        'Destination entry-extension station did not retain airborne landing authority',
        { entryPort, edgeS, extensionLanding }
      );
      const extensionResolution = track.resolveAirborneLandingRoute(extensionLanding, {
        pathPlan: sourcePlan,
        routeCursor: sourceCursor,
        runDistance: sourceCursor.runDistance,
        committedChoices: sourcePlan._committedChoices,
        routeChoices: Object.freeze({})
      });
      check(
        extensionResolution?.supported === true
          && extensionResolution.cursor.edgeId === crossoverEdge.id
          && extensionResolution.pathPlan.edgeIds.includes(crossoverEdge.id),
        'Destination entry-extension landing did not resolve directly onto the crossover',
        { entryPort, edgeS, extensionResolution }
      );
      checkNear(
        extensionResolution.lateral,
        -extensionLanding.lateral,
        0.000_001,
        'Destination entry-extension adoption did not flip lateral coordinates'
      );
      const adoptedFrame = track.sampleRouteCursor(
        extensionResolution.cursor,
        extensionResolution.lateral,
        {}
      );
      const positionErrorM = Math.hypot(
        adoptedFrame.x - extensionLanding.worldX,
        adoptedFrame.y - extensionLanding.worldY,
        adoptedFrame.z - extensionLanding.worldZ
      );
      maximumDestinationLandingPositionErrorM = Math.max(
        maximumDestinationLandingPositionErrorM,
        positionErrorM
      );
      maximumDestinationLandingHeadingErrorDeg = Math.max(
        maximumDestinationLandingHeadingErrorDeg,
        extensionResolution.headingErrorDeg
      );
      check(
        positionErrorM <= 0.001 && extensionResolution.continuityErrorM <= 0.001,
        'Destination entry-extension adoption moved the craft by more than 1mm',
        {
          entryPort,
          edgeS,
          positionErrorM,
          continuityErrorM: extensionResolution.continuityErrorM
        }
      );
      check(
        extensionResolution.headingErrorDeg <= 0.5,
        'Destination entry-extension adoption introduced more than 0.5 degrees of heading error',
        { entryPort, edgeS, headingErrorDeg: extensionResolution.headingErrorDeg }
      );
      destinationExtensionLandingChecks++;
    }

    const crossoverReport = inspectSupport(recoveryEdges);
    checkNear(
      crossoverReport.standardMaximumAllowedGap,
      104.01,
      0.000_001,
      'Crossover audit lost the ordinary two-bay reference maximum'
    );
    checkNear(
      crossoverReport.maximumAllowedGapByEdge[crossoverEdge.id],
      crossoverMaximumSupportGapM,
      0.000_001,
      'Crossover edge lost its continuous-box-girder two-bay maximum'
    );
    checkNear(
      crossoverReport.supportSpacingByEdge[crossoverEdge.id],
      88,
      0.000_001,
      'Crossover support planner ignored the authored 88m pier rhythm'
    );
    checkNear(
      crossoverReport.supportClearanceRadius,
      Math.max(track.graph.contract.bridgeSupportRadius, Math.hypot(1.1, 0.525)),
      0.000_001,
      'Crossover support clearance no longer covers the complete footing envelope'
    );
    check(
      crossoverReport.designedLongSpanCount === 0
        && crossoverReport.designedLongSpans.length === 0
        && Object.isFrozen(crossoverReport.designedLongSpans)
        && crossoverReport.gapViolations.every((violation) => (
          violation.reason !== 'insufficient-deck-height'
        )),
      'Low crossover was misrepresented as a cable-stayed bridge',
      {
        entryPort,
        designedLongSpanCount: crossoverReport.designedLongSpanCount,
        designedLongSpans: crossoverReport.designedLongSpans,
        gapViolations: crossoverReport.gapViolations
      }
    );
    let crossoverPortalCount = 0;
    for (const record of crossoverReport.records) {
      if (record.supportKind !== 'route-exterior-portal') continue;
      const laterals = record.supportLaterals || [];
      check(
        record.supportLegs?.length === 2
          && laterals.length === 2
          && laterals[0] < 0
          && laterals[1] > 0
          && laterals.every((lateral) => (
            Math.abs(lateral)
              >= record.roadHalf + record.supportClearanceRadius + 1
          ))
          && record.capWidth <= 70,
        'Route-exterior crossover support is not the smallest bounded clearance-proven two-leg portal',
        { entryPort, record }
      );
      crossoverPortalCount++;
      routeExteriorSupportCount++;
      maximumRouteExteriorSupportLateralM = Math.max(
        maximumRouteExteriorSupportLateralM,
        ...laterals.map((lateral) => Math.abs(Number(lateral) || 0))
      );
    }
    check(
      crossoverReport.maximumGap <= crossoverMaximumSupportGapM + 0.000_001
        && crossoverReport.gapViolationCount === 0
        && crossoverReport.unsupportedEdgeCount === 0
        && crossoverReport.minimumRoadGap >= 1
        && crossoverPortalCount > 0
        && crossoverReport.routeExteriorPortalCount === crossoverPortalCount
        && crossoverReport.maximumRouteExteriorPortalSpan <= 70
        && crossoverReport.pairedSupportCount === crossoverPortalCount
        && crossoverReport.pairedSupportLegCount === crossoverPortalCount * 2,
      'Crossover retains an unsupported or road-intersecting bridge interval',
      {
        entryPort,
        maximumGap: crossoverReport.maximumGap,
        minimumRoadGap: crossoverReport.minimumRoadGap,
        crossoverPortalCount,
        pairedSupportCount: crossoverReport.pairedSupportCount,
        pairedSupportLegCount: crossoverReport.pairedSupportLegCount,
        gapViolations: crossoverReport.gapViolations,
        unsupportedEdgeIds: crossoverReport.unsupportedEdgeIds
      }
    );

    const crossoverIndex = resolution.pathPlan.edgeIds.indexOf(crossoverEdge.id);
    const nextApproachEdge = track.getEdge(resolution.pathPlan.edgeIds[crossoverIndex + 1]);
    const afterNextTileEdge = resolution.pathPlan.edgeIds
      .map((edgeId) => track.getEdge(edgeId))
      .find((edge) => (
        edge?.tileIndex === crossoverEdge.tileIndex + 2
          && edge.family === 'approach'
      ));
    check(afterNextTileEdge, 'Opposing itinerary has no edge in the tile after the next approach', {
      entryPort,
      crossoverTileIndex: crossoverEdge.tileIndex
    });
    const crossoverBeforeSeamCursor = track.RoutePosition({
      edgeId: crossoverEdge.id,
      edgeS: crossoverEdge.length - footprintHalfLengthM,
      runDistance: sourceCursor.runDistance,
      entryPort: crossoverEdge.entryPort,
      tileIndex: crossoverEdge.tileIndex
    });
    const nextApproachCursor = track.RoutePosition({
      edgeId: nextApproachEdge.id,
      edgeS: footprintHalfLengthM,
      runDistance: sourceCursor.runDistance,
      entryPort: nextApproachEdge.entryPort,
      tileIndex: nextApproachEdge.tileIndex
    });
    const afterNextTileCursor = track.RoutePosition({
      edgeId: afterNextTileEdge.id,
      edgeS: footprintHalfLengthM,
      runDistance: sourceCursor.runDistance,
      entryPort: afterNextTileEdge.entryPort,
      tileIndex: afterNextTileEdge.tileIndex
    });
    const crossoverVisibleAt = (cursor) => track.getVisibleEdges({
      bounds: visibilityBounds,
      pathPlan: resolution.pathPlan,
      cursor
    }).some((edge) => edge.id === crossoverEdge.id);
    check(
      crossoverVisibleAt(crossoverBeforeSeamCursor),
      'Crossover disappeared immediately before its seam',
      { entryPort, cursor: crossoverBeforeSeamCursor }
    );
    check(
      crossoverVisibleAt(nextApproachCursor),
      'Crossover disappeared as soon as the craft entered the next approach',
      { entryPort, cursor: nextApproachCursor }
    );
    check(
      !crossoverVisibleAt(afterNextTileCursor),
      'Crossover remained visible after the craft entered the following tile',
      { entryPort, cursor: afterNextTileCursor }
    );
    crossoverVisibilityLifecycleChecks += 3;
    const distanceToNextApproach = (
      proxyEdge.length - resolution.cursor.edgeS
      + crossoverEdge.length
      + Math.min(64, nextApproachEdge.length * 0.25)
    );
    const approachCursor = track.advanceRouteCursor(
      resolution.cursor,
      distanceToNextApproach,
      resolution.pathPlan
    ).cursor;
    check(
      approachCursor.exited === false
        && approachCursor.edgeId === nextApproachEdge.id
        && nextApproachEdge.family === 'approach',
      'Crossover did not reach the next ordinary approach before route planning',
      { entryPort, approachCursor, nextApproachEdgeId: nextApproachEdge.id }
    );
    const decision = track.getUpcomingDecisions(approachCursor, 2_000, resolution.pathPlan)[0];
    const straightTransition = decision?.outgoing.find((transition) => transition.kind === 'straight');
    check(
      decision?.decisionType === 'cloverleaf' && straightTransition,
      'Next ordinary cloverleaf decision is not reachable after the crossover',
      { entryPort, decision }
    );
    const committedChoices = Object.freeze({
      ...resolution.committedChoices,
      [decision.nodeId]: straightTransition.movementId
    });
    const candidate = track.preparePathPlanCandidate({
      movementId: straightTransition.movementId,
      decisionId: decision.nodeId,
      committedChoices,
      entryPort: sourcePlan.entryPort,
      kind: 'straight',
      futureMovementKind: 'straight'
    });
    check(
      candidate.plan.edgeIds.includes(approachCursor.edgeId),
      'Next-decision candidate dropped the live ordinary approach cursor',
      {
        entryPort,
        cursorEdgeId: approachCursor.edgeId,
        candidatePlanId: candidate.plan.id,
        candidateEdgeIds: candidate.plan.edgeIds
      }
    );
    // The former disposable approach remainder threw here because candidate reconstruction omitted its cursor edge.
    const curvaturePreview = track.getCurvatureAhead(
      approachCursor,
      candidate.plan,
      decision.distance + 800
    );
    const continuation = track.advanceRouteCursor(
      approachCursor,
      decision.distance + 400,
      candidate.select()
    );
    const continuationDistance = track.distanceAlongPath(
      approachCursor,
      continuation.cursor,
      candidate.plan
    );
    maximumContinuationDistanceM = Math.max(
      maximumContinuationDistanceM,
      continuationDistance
    );
    check(
      curvaturePreview
        && continuation.cursor.exited === false
        && continuation.cursor.edgeId !== approachCursor.edgeId
        && Number.isFinite(continuationDistance)
        && continuationDistance >= decision.distance,
      'Adopted crossover itinerary cannot continue across the next route decision',
      { entryPort, decision, continuation, continuationDistance }
    );
  }

  Object.assign(summary, {
    auditedEntryPorts: PORTS.length,
    auditedLongSpanCount: 0,
    maximumDesignedSpanM: 0,
    ordinaryMaximumSupportGapM,
    crossoverMaximumSupportGapM,
    maximumUnsupportedSpanM: crossoverMaximumSupportGapM,
    routeExteriorSupportCount,
    maximumRouteExteriorSupportLateralM,
    maximumContinuationDistanceM,
    destinationExtensionLandingChecks,
    destinationExtensionCacheChecks,
    crossoverVisibilityLifecycleChecks,
    crossoverPointwiseOverlapChecks,
    crossoverHeightAwareClearanceChecks,
    maximumDestinationLandingPositionErrorM,
    maximumDestinationLandingHeadingErrorDeg,
    maximumCrossoverOverlapPositionErrorM,
    maximumCrossoverOverlapHeadingErrorDeg,
    maximumCrossoverCurvaturePerM,
    maximumCrossoverVerticalCurvaturePerM,
    maximumCrossoverSpatialCurvaturePerM,
    maximumCrossoverVerticalGAt280Kmh,
    maximumCrossoverSpatialGAt280Kmh,
    minimumDesignedLongSpanDeckY: null,
    unbankedLateralGAt280Kmh: (
      (auditSpeedKmh / 3.6) ** 2
      * maximumCrossoverCurvaturePerM
      / standardGravityMps2
    ),
    nextDecisionContinuation: true
  });
}

/** Lock the recovery fork to two physical roads while retaining one selected gameplay path. */
function validateStraightRoadFork(plan, summary) {
  check(typeof track.getRecoveryVisualEdgesForTile === 'function', 'Straight-fork visual edge API is missing');
  check(typeof track.getRecoveryForkMovementsForTile === 'function', 'Straight-fork movement API is missing');
  const tile = plan.tiles[0];
  const visualEdges = track.getRecoveryVisualEdgesForTile(tile);
  const forkMovements = track.getRecoveryForkMovementsForTile(tile);
  const forkApproach = visualEdges.find((edge) => edge.family === 'straight-fork-approach');
  const recoveryIn = visualEdges.find((edge) => edge.family === 'recovery' && edge.id.includes('recovery-in'));
  const recoveryOut = visualEdges.find((edge) => edge.family === 'recovery' && edge.id.includes('recovery-out'));
  const leftEdge = visualEdges.find((edge) => edge.forkSide === 'left');
  const rightEdge = visualEdges.find((edge) => edge.forkSide === 'right');
  const leftMovement = forkMovements.find((movement) => movement.forkSide === 'left');
  const rightMovement = forkMovements.find((movement) => movement.forkSide === 'right');

  check(visualEdges.length === 6, 'Recovery visual topology does not contain all six contracted edges', {
    edgeIds: visualEdges.map((edge) => edge.id)
  });
  check(forkMovements.length === 2 && leftMovement && rightMovement, 'Straight fork does not expose two choices');
  check(leftEdge && rightEdge && forkApproach && recoveryIn && recoveryOut, 'Straight-fork edge sequence is incomplete');
  check(track.getMovement(leftMovement.id) === leftMovement && track.getMovement(rightMovement.id) === rightMovement,
    'Runtime fork movements are not addressable through getMovement');
  checkNear(recoveryIn.planarLength, 900, 0.000_001, 'Recovery-in length drifted');
  checkNear(forkApproach.planarLength, 500, 0.000_001, 'Fork approach length drifted');
  checkNear(leftEdge.planarLength, 900, 0.000_001, 'Left fork length drifted');
  checkNear(rightEdge.planarLength, 900, 0.000_001, 'Right fork length drifted');
  check(recoveryOut.planarLength >= 376, 'Recovery-out lost its 376m base tail', recoveryOut.planarLength);
  check(
    leftEdge.straightForkProfileLut && rightEdge.straightForkProfileLut,
    'Asymmetric fork branches did not publish their analytic profiles'
  );

  const defaultPlan = track.createPathPlan({ movementId: tile.movementId, futureMovementKind: 'straight' });
  check(defaultPlan.edgeIds.includes(leftEdge.id) && !defaultPlan.edgeIds.includes(rightEdge.id),
    'Default PathPlan did not select only the left fork');
  const decision = track.getUpcomingDecisions(
    track.RoutePosition({ edgeId: recoveryIn.id, edgeS: 0, tileIndex: tile.index }),
    2_000,
    defaultPlan
  )[0];
  check(decision?.decisionType === 'straight-fork' && decision.outgoing.length === 2,
    'Recovery corridor did not publish its upcoming fork', decision);
  check(
    decision.outgoing.some((choice) => choice.movementId === leftMovement.id)
      && decision.outgoing.some((choice) => choice.movementId === rightMovement.id),
    'Upcoming fork omitted a branch movement'
  );

  const candidate = track.preparePathPlanCandidate({
    movementId: rightMovement.id,
    decisionId: decision.nodeId,
    entryPort: defaultPlan.entryPort,
    kind: defaultPlan.kind,
    futureMovementKind: 'straight',
    committedChoices: Object.freeze({ [decision.nodeId]: rightMovement.id })
  });
  check(candidate.movementId === rightMovement.id,
    'Prepared fork candidate reported the enclosing cloverleaf movement instead of its branch transition');
  check(candidate.plan.edgeIds.includes(forkApproach.id), 'Prepared fork candidate lost the shared approach');
  check(candidate.plan.edgeIds.includes(rightEdge.id) && !candidate.plan.edgeIds.includes(leftEdge.id),
    'Prepared fork candidate did not atomically replace the selected branch');
  check(candidate.select() === candidate.plan && candidate.selected, 'Prepared fork candidate did not select in place');

  const laterTile = defaultPlan.tiles[1];
  const laterRightMovement = track.getRecoveryForkMovementsForTile(laterTile)
    .find((movement) => movement.forkSide === 'right');
  const laterCandidate = track.preparePathPlanCandidate({
    movementId: laterRightMovement.id,
    decisionId: laterRightMovement.decisionNodeId,
    entryPort: defaultPlan.entryPort,
    kind: defaultPlan.kind,
    futureMovementKind: 'straight',
    committedChoices: Object.freeze({
      [laterRightMovement.decisionNodeId]: laterRightMovement.id
    })
  });
  check(laterCandidate.plan.edgeIds.includes(laterRightMovement.edgeIds[0]),
    'Later-tile fork candidate was rebuilt from the wrong itinerary origin');

  let maximumSeamPositionM = 0;
  let maximumSeamTangentDegrees = 0;
  for (const branch of [leftEdge, rightEdge]) {
    for (const [beforeEdge, beforeS, afterEdge, afterS] of [
      [forkApproach, forkApproach.length, branch, 0],
      [branch, branch.length, recoveryOut, 0]
    ]) {
      const before = track.sampleEdge(beforeEdge.id, beforeS, 0, {});
      const after = track.sampleEdge(afterEdge.id, afterS, 0, {});
      const positionM = distance3(before, after);
      const tangentDegrees = vectorAngleDegrees(before, after);
      maximumSeamPositionM = Math.max(maximumSeamPositionM, positionM);
      maximumSeamTangentDegrees = Math.max(maximumSeamTangentDegrees, tangentDegrees);
      check(positionM <= 0.000_001, 'Straight-fork centreline endpoint is discontinuous', {
        branch: branch.id,
        positionM
      });
      check(tangentDegrees <= 0.000_01, 'Straight-fork endpoint tangent is discontinuous', {
        branch: branch.id,
        tangentDegrees
      });
      checkNear(before.curvature, 0, 0.000_000_001, 'Straight-fork incoming endpoint curvature is discontinuous');
      checkNear(after.curvature, 0, 0.000_000_001, 'Straight-fork endpoint curvature is discontinuous');
    }
  }

  const leftMiddle = track.sampleEdge(leftEdge.id, leftEdge.length * 0.5, 0, {});
  const rightMiddle = track.sampleEdge(rightEdge.id, rightEdge.length * 0.5, 0, {});
  const branchCenterSeparationM = distance3(leftMiddle, rightMiddle);
  const branchShellGapM = branchCenterSeparationM - leftMiddle.roadHalf - rightMiddle.roadHalf;
  checkNear(leftMiddle.straightForkOffsetM, 2, 0.001,
    'Inner fork branch does not retain its bounded 2m centre offset');
  checkNear(rightMiddle.straightForkOffsetM, 18, 0.001, 'Fork sampling omitted its analytic center offset');
  checkNear(branchCenterSeparationM, 20, 0.001,
    'Asymmetric fork branches do not preserve their 2m inner and 18m outer offsets');
  checkNear(branchShellGapM, 7.2, 0.001, 'Fork central pavement clearance drifted below 7.2m');
  checkNear(rightMiddle.straightForkVoidWidthM, 7.2, 0.001,
    'Fork sampling omitted its 7.2m central pavement clearance');
  const nextTile = defaultPlan.tiles.find((candidateTile) => candidateTile.index === tile.index + 1);
  const opposingEdge = track.getBidirectionalVisualEdgesForTile(nextTile)
    .find((edge) => edge.bidirectionalRole === BIDIRECTIONAL_OPPOSING_INTERTILE);
  check(opposingEdge, 'Straight-fork clearance audit has no persistent opposing carriageway');
  const opposingStart = track.sampleEdge(opposingEdge.id, 0, 0, {});
  const opposingEnd = track.sampleEdge(opposingEdge.id, opposingEdge.length, 0, {});
  const opposingProjection = pointSegmentDistanceSquared(
    leftMiddle.x,
    leftMiddle.z,
    opposingStart.x,
    opposingStart.z,
    opposingEnd.x,
    opposingEnd.z
  );
  const opposingProjectionS = opposingEdge.length * opposingProjection.t;
  const opposingMiddle = track.sampleEdge(opposingEdge.id, opposingProjectionS, 0, {});
  const innerToOpposingPavementClearanceM = Math.hypot(
    leftMiddle.x - opposingMiddle.x,
    leftMiddle.z - opposingMiddle.z
  ) - leftMiddle.roadHalf - opposingMiddle.roadHalf;
  checkNear(innerToOpposingPavementClearanceM, 7.2, 0.001,
    'Inner fork branch no longer preserves 7.2m of pavement clearance from opposing traffic');
  const rightQuarter = track.sampleEdge(rightEdge.id, rightEdge.length * 0.25, 0, {});
  const branchHeadingDeflectionDegrees = Math.abs(normalizedAngle(rightQuarter.heading - rightEdge.heading)) * DEGREES;
  check(branchHeadingDeflectionDegrees >= 4 && branchHeadingDeflectionDegrees <= 4.5,
    'Straight fork is visually too straight or exceeds its intended bend', branchHeadingDeflectionDegrees);
  const centralVoid = rightEdge.straightForkProfileLut.centralVoid;
  check(centralVoid && centralVoid.startS < rightEdge.length * 0.5 && centralVoid.endS > rightEdge.length * 0.5,
    'Straight-fork profile omitted its central no-road interval', centralVoid);
  checkNear(centralVoid.startPlanarS + centralVoid.endPlanarS, rightEdge.planarLength, 0.000_001,
    'Central void is not planar-symmetric');
  checkNear(centralVoid.startS + centralVoid.endS, rightEdge.length, 0.001,
    'Central void is not arc-length symmetric');
  checkNear(centralVoid.maximumWidthM, 7.2, 0.001, 'Central void contract has the wrong maximum width');
  const openingNose = track.sampleEdge(rightEdge.id, centralVoid.noseStartS, 0, {});
  const closingNose = track.sampleEdge(rightEdge.id, centralVoid.noseEndS, 0, {});
  checkNear(openingNose.straightForkVoidWidthM, centralVoid.noseClearWidthM, 0.01,
    'Opening gore nose is not placed on the true void boundary');
  checkNear(closingNose.straightForkVoidWidthM, centralVoid.noseClearWidthM, 0.01,
    'Closing gore nose is not placed on the true void boundary');
  const goreLayout = cloverleafVisuals.inspectStraightForkGoreLayout([leftEdge, rightEdge]);
  check(goreLayout.length === 2
    && goreLayout[0].kind === 'split' && goreLayout[0].tipForwardSign === -1
      && goreLayout[0].reverseLongitudinal === true
    && goreLayout[1].kind === 'merge' && goreLayout[1].tipForwardSign === 1
      && goreLayout[1].reverseLongitudinal === false,
  'Fork gore noses do not point out of the narrowing gap', goreLayout.map((layout) => ({
    kind: layout.kind,
    tipForwardSign: layout.tipForwardSign,
    reverseLongitudinal: layout.reverseLongitudinal
  })));
  const goreBaseMinimumGapM = Math.min(
    track.sampleEdge(rightEdge.id, centralVoid.noseStartS + 1.7, 0, {}).straightForkVoidWidthM,
    track.sampleEdge(rightEdge.id, centralVoid.noseEndS - 1.7, 0, {}).straightForkVoidWidthM
  );
  check(goreBaseMinimumGapM >= 1.44 + 0.18 * 2,
    'Fork gore base intersects a road-edge rail', goreBaseMinimumGapM);
  const boundaryAuditWidthM = 5;
  let boundaryRiseLowS = centralVoid.startS;
  let boundaryRiseHighS = rightEdge.length * 0.5;
  for (let iteration = 0; iteration < 40; iteration++) {
    const middleS = (boundaryRiseLowS + boundaryRiseHighS) * 0.5;
    if (track.sampleEdge(rightEdge.id, middleS, 0, {}).straightForkVoidWidthM < boundaryAuditWidthM) {
      boundaryRiseLowS = middleS;
    } else {
      boundaryRiseHighS = middleS;
    }
  }
  const boundaryRiseLengthM = (boundaryRiseLowS + boundaryRiseHighS) * 0.5 - centralVoid.startS;
  check(boundaryRiseLengthM >= 20 && boundaryRiseLengthM <= 100,
    'Fork void boundary rise is visually abrupt or excessively delayed', boundaryRiseLengthM);
  const branchClearance = track.queryRoadClearance({ x: rightMiddle.x, z: rightMiddle.z }, 0, { gap: 0 });
  check(branchClearance.intersects && branchClearance.edgeId === rightEdge.id,
    'Road clearance does not follow the curved fork branch', branchClearance);
  const forkSupportS = rightEdge.length * 0.57;
  const forkSupportCenter = track.sampleEdge(rightEdge.id, forkSupportS, 0, {});
  const forkSupportLateral = forkSupportCenter.roadHalf * 0.75;
  const forkSupportFrame = track.sampleEdge(rightEdge.id, forkSupportS, forkSupportLateral, {});
  const forkSupportUndersideY = forkSupportFrame.y
    - track.graph.contract.deckThickness / forkSupportFrame.upY;
  const forkClearanceIgnoreIds = [
    ...track.graph.edges.map((edge) => edge.id),
    ...track.getRuntimeEdgesForTileIndex(tile.index)
      .filter((edge) => edge.id !== rightEdge.id)
      .map((edge) => edge.id)
  ];
  const forkSupportContact = track.queryRoadClearance(
    forkSupportFrame.x,
    forkSupportFrame.z,
    0,
    {
      gap: 0,
      ignoreEdgeIds: forkClearanceIgnoreIds,
      verticalEnvelope: { minY: -1.18, maxY: forkSupportUndersideY }
    }
  );
  const forkSupportPenetration = track.queryRoadClearance(
    forkSupportFrame.x,
    forkSupportFrame.z,
    0,
    {
      gap: 0,
      ignoreEdgeIds: forkClearanceIgnoreIds,
      verticalEnvelope: { minY: -1.18, maxY: forkSupportUndersideY + 0.08 }
    }
  );
  check(forkSupportContact.clear, 'Straight-fork slab contact was misclassified as penetration', {
    edgeId: rightEdge.id,
    forkSupportContact
  });
  check(
    forkSupportPenetration.intersects
      && forkSupportPenetration.edgeId === rightEdge.id
      && Math.abs(forkSupportPenetration.edgeS - forkSupportFrame.edgeS) <= 0.001
      && Math.abs(forkSupportPenetration.roadLateral - forkSupportLateral) <= 0.001,
    'Straight-fork height-aware projection lost its actual route station or lateral',
    { frame: forkSupportFrame, forkSupportPenetration }
  );

  const curvaturePreview = track.getCurvatureAhead(
    track.RoutePosition({ edgeId: rightEdge.id, edgeS: 0, tileIndex: tile.index }),
    candidate.plan,
    rightEdge.length
  );
  const maximumSafeCurvatureAt300Mps = 52 / (300 * 300);
  check(curvaturePreview.maxCurvature >= 0.000_5
    && curvaturePreview.maxCurvature <= maximumSafeCurvatureAt300Mps,
  'Straight fork is too straight or exceeds the 300m/s lateral-acceleration contract', curvaturePreview);
  check(curvaturePreview.turnKind === 'straight-fork-right',
    'Curvature preview reports the stale cloverleaf maneuver for a runtime fork', curvaturePreview);

  const tileGraph = cloverleafTilePool.graphForTile(track, tile, defaultPlan, { includeRecovery: true });
  const scopedTrack = Object.freeze({
    ...track,
    graph: tileGraph,
    getEdge(edgeId) { return tileGraph.edgesById[edgeId] || track.getEdge(edgeId); },
    getNode(nodeId) { return tileGraph.nodesById[nodeId] || track.getNode(nodeId); },
    getMovement(movementId) { return tileGraph.movementsById[movementId] || track.getMovement(movementId); },
    enumerateMovements() { return tileGraph.movements; },
    getVisibleEdges() { return tileGraph.edges; }
  });
  const geometryJob = cloverleafVisuals.createGeometryBatchAuditJob({
    THREE: createGeometryAuditThree(),
    track: scopedTrack,
    qualityProfile: Object.freeze({ id: 'mobile' })
  });
  let geometrySteps = 0;
  while (!geometryJob.step(4)) {
    geometrySteps++;
    check(geometrySteps < 1_000_000, 'Straight-fork tile geometry audit stalled');
  }
  const geometryBatch = geometryJob.finish();
  const positions = geometryBatch.roadShellGeometry.getAttribute('position');
  check(positions?.count > 0 && positions.array.every(Number.isFinite),
    'Straight-fork tile produced invalid road-shell geometry');
  const forkRoadCoordinateAudit = inspectVisibleRoadCoordinateContract(geometryBatch.roadShellGeometry);
  check(!forkRoadCoordinateAudit.attributeCountMismatch
    && forkRoadCoordinateAudit.nonFiniteComponentCount === 0
    && forkRoadCoordinateAudit.junctionSurfaceRangeCount === 0
    && forkRoadCoordinateAudit.visibleTopTriangleCount === 0
    && forkRoadCoordinateAudit.visibleTopDegenerateCoordinateTriangleCount === 0,
  'Straight-fork road batch unexpectedly retained cosmetic junction shader ranges', forkRoadCoordinateAudit);
  check(geometryBatch.routeLinePositionsByEdge.has(leftEdge.id)
    && geometryBatch.routeLinePositionsByEdge.has(rightEdge.id),
  'Merged tile geometry omitted a fork branch');
  check(geometryBatch.metrics.junctionApronCount === 0
    && geometryBatch.metrics.junctionLongPairCount === 0
    && geometryBatch.metrics.junctionLensCount === 0
    && geometryBatch.metrics.junctionVerticallySeparatedPairCount === 0
    && geometryBatch.metrics.junctionRaisedBarrierIntrusionCount === 0
    && geometryBatch.metrics.junctionLensResidualOverlapCount === 0
    && geometryBatch.metrics.junctionLensUncoveredStationCount === 0,
  'Straight-fork production geometry restored a cosmetic overlap patch', geometryBatch.metrics);
  check(geometryBatch.metrics.straightForkVoidBoundaryCount === 2
    && geometryBatch.metrics.straightForkVoidBoundarySampleCount > 0
    && geometryBatch.metrics.maximumStraightForkVoidBoundaryHeightM >= 0.77
    && geometryBatch.metrics.straightForkVoidBoundaryFullWidthM === 5,
  'Central no-road interval does not own two continuous raised boundaries', geometryBatch.metrics);

  const productionTemplateJob = cloverleafVisuals.createGeometryBatchAuditJob({
    THREE: createGeometryAuditThree(),
    track: scopedTrack,
    qualityProfile: Object.freeze({ id: 'mobile' }),
    productionTemplate: true
  });
  let productionTemplateSteps = 0;
  while (!productionTemplateJob.step(4)) {
    productionTemplateSteps++;
    check(productionTemplateSteps < 1_000_000, 'Production split-template geometry audit stalled');
  }
  const productionTemplate = productionTemplateJob.finish();
  check(productionTemplate.metrics.straightForkVoidBoundaryCount === 2
    && productionTemplate.metrics.straightForkVoidBoundarySampleCount > 0
    && productionTemplate.metrics.maximumStraightForkVoidBoundaryHeightM >= 0.77
    && productionTemplate.metrics.straightForkVoidBoundaryFullWidthM === 5,
  'Production base/recovery template merge dropped the fork boundary contract', productionTemplate.metrics);
  productionTemplate.releaseBaseTemplate();
  productionTemplate.recoveryTemplate.roadShellGeometry.dispose();
  productionTemplate.recoveryTemplate.staticLineGeometry.dispose();
  productionTemplate.recoveryTemplate.decorativeLaneGeometry.dispose();

  Object.assign(summary, {
    visualEdges: visualEdges.length,
    branchMovements: forkMovements.length,
    branchPlanarLengthM: leftEdge.planarLength,
    branchArcLengthM: leftEdge.length,
    branchCenterSeparationM,
    branchShellGapM,
    innerToOpposingPavementClearanceM,
    branchHeadingDeflectionDegrees,
    centralVoidStartM: centralVoid.startS,
    centralVoidLengthM: centralVoid.endS - centralVoid.startS,
    centralVoidBoundaryCount: geometryBatch.metrics.straightForkVoidBoundaryCount,
    boundaryRiseLengthM,
    goreBaseMinimumGapM,
    productionTemplateSteps,
    maximumSeamPositionM,
    maximumSeamTangentDegrees,
    maximumCurvature: curvaturePreview.maxCurvature,
    maximumSafeCurvatureAt300Mps,
    curvatureTurnKind: curvaturePreview.turnKind,
    candidateSelectedRight: true,
    laterTileCandidateIndex: laterTile.index,
    junctionSurfaceCount: geometryBatch.metrics.junctionApronCount,
    junctionLensCount: geometryBatch.metrics.junctionLensCount,
    junctionLensMaximumRunM: geometryBatch.metrics.junctionLensMaximumRunM,
    raisedBarrierIntrusions: geometryBatch.metrics.junctionRaisedBarrierIntrusionCount,
    heightAwareSupportClearance: true,
    visibleTopRoadCoordinateTriangles: forkRoadCoordinateAudit.visibleTopTriangleCount,
    degenerateVisibleTopRoadCoordinateTriangles:
      forkRoadCoordinateAudit.visibleTopDegenerateCoordinateTriangleCount,
    geometryVertices: positions.count,
    geometrySteps
  });
}

function validateRoadClearance(summary) {
  const edge = track.getEdge('approach-south');
  const centre = track.sampleEdge(edge.id, 100, 0, {});
  const outside = track.sampleEdge(edge.id, 100, centre.roadHalf + 6, {});
  const centreQuery = track.queryRoadClearance({ x: centre.x, z: centre.z }, 0, { gap: 0 });
  const outsideQuery = track.queryRoadClearance({ x: outside.x, z: outside.z }, 1, { gap: 1 });
  const farQuery = track.queryRoadClearance({
    x: track.graph.bounds.maxX + 1_000,
    z: track.graph.bounds.maxZ + 1_000
  }, 3, { gap: 2 });

  check(centreQuery.intersects && !centreQuery.clear, 'Road centre was not rejected by the clearance index', centreQuery);
  check(centreQuery.edgeId === edge.id, 'Road centre matched the wrong indexed edge', centreQuery);
  check(outsideQuery.clear && !outsideQuery.intersects, 'Legal roadside object was rejected', outsideQuery);
  checkNear(outsideQuery.clearance, 4, 0.01, 'Roadside object clearance is wrong');
  check(farQuery.clear && farQuery.edgeId === null, 'Far-field clearance query returned a road', farQuery);

  const deckThickness = track.graph.contract.deckThickness;
  const supportGroundY = -1.18;
  const supportedUndersideY = centre.y - deckThickness / centre.upY;
  const otherTemplateEdgeIds = track.graph.edges
    .filter((candidate) => candidate.id !== edge.id)
    .map((candidate) => candidate.id);
  const supportedDeckContact = track.queryRoadClearance(centre.x, centre.z, 0, {
    gap: 0,
    ignoreEdgeIds: otherTemplateEdgeIds,
    verticalEnvelope: { minY: supportGroundY, maxY: supportedUndersideY }
  });
  const supportedDeckPenetration = track.queryRoadClearance(centre.x, centre.z, 0, {
    gap: 0,
    ignoreEdgeIds: otherTemplateEdgeIds,
    verticalEnvelope: { minY: supportGroundY, maxY: supportedUndersideY + 0.08 }
  });
  check(
    supportedDeckContact.clear && !supportedDeckContact.intersects,
    'A support ending at the carried slab underside was misclassified as penetrating the road',
    supportedDeckContact
  );
  check(
    supportedDeckPenetration.intersects
      && supportedDeckPenetration.edgeId === edge.id
      && supportedDeckPenetration.verticalOverlapM >= 0.079_999,
    'Height-aware clearance failed to reject a support penetrating the carried road slab',
    supportedDeckPenetration
  );

  const crossing = track.graph.crossings[0];
  const upperFrame = track.sampleEdge(crossing.upperEdgeId, crossing.upperEdgeS, 0, {});
  const upperUndersideY = upperFrame.y - deckThickness / upperFrame.upY;
  const nonLowerEdgeIds = track.graph.edges
    .filter((candidate) => candidate.id !== crossing.lowerEdgeId)
    .map((candidate) => candidate.id);
  const lowerRoadPenetration = track.queryRoadClearance(upperFrame.x, upperFrame.z, 0, {
    gap: 0,
    ignoreEdgeIds: nonLowerEdgeIds,
    verticalEnvelope: { minY: supportGroundY, maxY: upperUndersideY }
  });
  check(
    lowerRoadPenetration.intersects
      && lowerRoadPenetration.edgeId === crossing.lowerEdgeId
      && lowerRoadPenetration.verticalOverlapM > 0,
    'Height-aware clearance allowed an upper-deck support to pass through a lower road',
    { crossing, lowerRoadPenetration }
  );

  const junctionNode = track.getNode(edge.to);
  const siblingEdge = track.getEdge(junctionNode.outEdges[0]);
  const junctionFrame = track.sampleEdge(edge.id, edge.length, 0, {});
  const junctionUndersideY = junctionFrame.y - deckThickness / junctionFrame.upY;
  const nonSiblingEdgeIds = track.graph.edges
    .filter((candidate) => candidate.id !== siblingEdge.id)
    .map((candidate) => candidate.id);
  const sameHeightSiblingContact = track.queryRoadClearance(
    junctionFrame.x,
    junctionFrame.z,
    0,
    {
      gap: 0,
      ignoreEdgeIds: nonSiblingEdgeIds,
      verticalEnvelope: { minY: supportGroundY, maxY: junctionUndersideY }
    }
  );
  const sameHeightSiblingPenetration = track.queryRoadClearance(
    junctionFrame.x,
    junctionFrame.z,
    0,
    {
      gap: 0,
      ignoreEdgeIds: nonSiblingEdgeIds,
      verticalEnvelope: { minY: supportGroundY, maxY: junctionUndersideY + 0.08 }
    }
  );
  check(
    sameHeightSiblingContact.clear,
    'A co-planar road continuing through the same junction displaced its valid bearing support',
    { edgeId: edge.id, siblingEdgeId: siblingEdge.id, sameHeightSiblingContact }
  );
  check(
    sameHeightSiblingPenetration.intersects
      && sameHeightSiblingPenetration.edgeId === siblingEdge.id,
    'A support entering a co-planar junction slab escaped height-aware clearance',
    { siblingEdgeId: siblingEdge.id, sameHeightSiblingPenetration }
  );

  Object.assign(summary, {
    centreClearanceM: centreQuery.clearance,
    roadsideClearanceM: outsideQuery.clearance,
    farClear: farQuery.clear,
    supportedDeckContactClear: supportedDeckContact.clear,
    sameHeightJunctionContactClear: sameHeightSiblingContact.clear,
    supportedDeckPenetrationM: supportedDeckPenetration.verticalOverlapM,
    lowerRoadPenetrationM: lowerRoadPenetration.verticalOverlapM
  });
}

function validateInterchangeClearZone(summary) {
  const plan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const tile = plan.tiles[0];
  const tileOnlyPlan = { tiles: [tile] };
  let sampledTemplatePoints = 0;
  for (const edge of track.graph.edges) {
    check(edge.interchangeClearZone === true, 'Template edge omitted the interchange clear-zone contract', edge.id);
    forEachEdgeSample(edge, 100, (frame) => {
      const query = track.queryInterchangeClearZone(frame, 0, { pathPlan: tileOnlyPlan });
      check(query.intersects, 'Template road sample escaped its physical clear-zone footprint', {
        edgeId: edge.id,
        edgeS: frame.edgeS,
        query
      });
      sampledTemplatePoints++;
    });
  }

  const footprint = tile.footprint;
  const centreZ = (footprint.minZ + footprint.maxZ) * 0.5;
  const outsideFive = { x: footprint.maxX + 5, z: centreZ };
  check(
    track.queryInterchangeClearZone(outsideFive, 4, { pathPlan: tileOnlyPlan }).clear,
    'Clear-zone radius rejected an object whose full footprint stays outside'
  );
  check(
    track.queryInterchangeClearZone(outsideFive, 6, { pathPlan: tileOnlyPlan }).intersects,
    'Clear-zone radius failed to catch an object whose footprint crosses the boundary'
  );
  const outsideEighty = { x: footprint.maxX + 80, z: centreZ };
  check(
    track.queryInterchangeClearZone(outsideEighty, 0, { pathPlan: tileOnlyPlan, margin: 79 }).clear,
    'Clear-zone margin rejected a point beyond the requested entity buffer'
  );
  check(
    track.queryInterchangeClearZone(outsideEighty, 0, { pathPlan: tileOnlyPlan, margin: 80 }).intersects,
    'Clear-zone margin failed at the exact entity buffer boundary'
  );
  checkNear(
    track.gateTargetForHalfWidth({ min: 1.6, max: Number.POSITIVE_INFINITY }, 7.8),
    2.4,
    0.000_001,
    'Shared decision-lane target drifted from the gate contract'
  );

  const recoveryEdges = plan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .filter((edge) => edge?.runtimeKind === 'recovery');
  check(recoveryEdges.length >= 3, 'Itinerary omitted its recovery connector sequence');
  check(
    recoveryEdges.every((edge) => edge.interchangeClearZone === false),
    'Recovery edge was mislabeled as a template clear-zone edge'
  );
  const recoveryNear = track.sampleEdge(recoveryEdges[0].id, 10, 0, {});
  const recoveryFar = recoveryEdges
    .flatMap((edge) => [
      track.sampleEdge(edge.id, edge.length * 0.5, 0, {}),
      track.sampleEdge(edge.id, edge.length, 0, {})
    ])
    .find((frame) => track.queryInterchangeClearZone(frame, 0, { pathPlan: tileOnlyPlan }).clear);
  check(
    track.queryInterchangeClearZone(recoveryNear, 0, { pathPlan: tileOnlyPlan }).intersects,
    'Spatial clear-zone query ignored recovery geometry still inside the interchange footprint'
  );
  check(
    recoveryFar && track.queryInterchangeClearZone(recoveryFar, 0, { pathPlan: tileOnlyPlan }).clear,
    'Spatial clear-zone query did not release far recovery geometry'
  );

  Object.assign(summary, {
    sampledTemplatePoints,
    footprintSpanM: footprint.maxX - footprint.minX,
    recoveryNearProtected: true,
    recoveryFarClear: true,
    gateTargetM: 2.4
  });
}

function validateCandidatePreparation(summary) {
  check(typeof track.preparePathPlanCandidate === 'function', 'PathPlan candidate preparation API is missing');
  const candidate = track.preparePathPlanCandidate({
    decisionId: 'decision-south',
    movementId: 'south-left',
    committedChoices: Object.freeze({ 'decision-south': 'south-left' })
  });
  check(Object.isFrozen(candidate), 'Prepared candidate wrapper is mutable');
  check(candidate.selected === false, 'Prepared candidate selected itself before the portal');
  check(candidate.plan?.edgeIndexById instanceof Map, 'Prepared candidate omitted edgeIndexById');
  const selectedPlan = candidate.select();
  check(selectedPlan === candidate.plan && candidate.selected === true,
    'Candidate portal selection rebuilt or replaced its prepared PathPlan');
  Object.assign(summary, {
    candidateApi: true,
    candidateSelectedInPlace: true,
    candidateIndexedEdges: selectedPlan.edgeIndexById.size
  });
}

/** Prove a chase camera can retreat across a collector-to-loop seam without changing the live route cursor. */
function validateSignedPathSampling(summary) {
  check(typeof track.sampleSignedPathFrame === 'function', 'Signed PathPlan sampler is missing');
  const plan = track.createPathPlan({ movementId: 'south-left', singleTile: true });
  const loopIndex = plan.edgeIds.findIndex((edgeId) => track.getEdge(edgeId)?.family === 'loop-ramp');
  check(loopIndex > 0, 'Left movement omitted its collector-to-loop seam');
  const loopEdge = track.getEdge(plan.edgeIds[loopIndex]);
  const previousEdge = track.getEdge(plan.edgeIds[loopIndex - 1]);
  const cursor = track.RoutePosition({ edgeId: loopEdge.id, edgeS: 5, lateral: 0 });
  const cursorSnapshot = JSON.stringify(cursor);
  const retreated = track.sampleSignedPathFrame(cursor, -15, plan, 0, {});
  const expected = track.sampleEdge(previousEdge.id, previousEdge.length - 10, 0, {});
  checkNear(distance3(retreated, expected), 0, 0.000_001, 'Signed camera sample missed the previous edge');
  check(JSON.stringify(cursor) === cursorSnapshot, 'Signed camera sample mutated RoutePosition');
  const forwarded = track.sampleSignedPathFrame(cursor, 15, plan, 0, {});
  const ordinary = track.samplePathFrame(cursor, 15, plan, 0, {});
  checkNear(distance3(forwarded, ordinary), 0, 0.000_001, 'Signed forward sample diverged from PathPlan');
  Object.assign(summary, {
    signedCameraSampling: true,
    retreatDistanceM: 15,
    seamPositionErrorM: distance3(retreated, expected)
  });
}

/** Keep every runtime straight-fork support interval within two nominal 52m bays across retained variants. */
function validateRuntimeSupportLayouts(summary) {
  check(
    cloverleafVisuals && typeof cloverleafVisuals.inspectRuntimeSupportLayout === 'function',
    'Runtime bridge-support audit contract is missing'
  );
  let maximumGapM = 0;
  let inactiveVariantIgnoredEdgeCount = 0;
  let auditedForkEdgeCount = 0;
  let maximumPlannerSpecCount = 0;
  let maximumPlannerStepCount = 0;
  let maximumPlacementCandidateCount = 0;
  let maximumClearanceQueryCount = 0;
  let auditedSupportRecordCount = 0;
  let maximumSingleColumnCapWidthM = 0;
  let maximumInvalidOutwardCapOverhangM = 0;
  let minimumPierCapOverlapM = Number.POSITIVE_INFINITY;
  for (const movement of track.graph.movements) {
    const pathPlan = track.createPathPlan({
      movementId: movement.id,
      futureMovementKind: 'straight'
    });
    const tile = pathPlan.tiles[0];
    const graph = cloverleafTilePool.graphForTile(
      track,
      tile,
      pathPlan,
      { includeRecovery: true }
    );
    const scopedTrack = {
      graph,
      sampleEdge: (...args) => track.sampleEdge(...args),
      getEdge: (edgeId) => graph.edgesById[edgeId] || track.getEdge(edgeId),
      getRuntimeEdgesForTileIndex: (tileIndex) => track.getRuntimeEdgesForTileIndex(tileIndex),
      queryRoadClearance: (...args) => track.queryRoadClearance(...args)
    };
    const report = cloverleafVisuals.inspectRuntimeSupportLayout(scopedTrack, graph.edges);
    maximumGapM = Math.max(maximumGapM, report.maximumGap);
    maximumPlannerSpecCount = Math.max(maximumPlannerSpecCount, report.plannerSpecCount);
    maximumPlannerStepCount = Math.max(maximumPlannerStepCount, report.plannerStepCount);
    maximumPlacementCandidateCount = Math.max(
      maximumPlacementCandidateCount,
      report.placementCandidateCount
    );
    maximumClearanceQueryCount = Math.max(maximumClearanceQueryCount, report.clearanceQueryCount);
    inactiveVariantIgnoredEdgeCount += report.inactiveVariantIgnoredEdgeIds.length;
    auditedSupportRecordCount += report.records.length;
    maximumInvalidOutwardCapOverhangM = Math.max(
      maximumInvalidOutwardCapOverhangM,
      report.maximumInvalidOutwardCapOverhang
    );
    minimumPierCapOverlapM = Math.min(
      minimumPierCapOverlapM,
      report.minimumPierCapOverlap
    );
    for (const [recordIndex, record] of report.records.entries()) {
      check(
        Object.isFrozen(record)
          && Array.isArray(record.supportLegs)
          && record.supportLegs.length >= 1,
        'Runtime support record lost its immutable physical-leg evidence',
        { movementId: movement.id, recordIndex, record }
      );
      for (const [legIndex, leg] of record.supportLegs.entries()) {
        check(
          [leg.x, leg.z, leg.groundY, leg.topY, leg.height].every(Number.isFinite)
            && leg.topY > leg.groundY
            && Math.abs(leg.height - (leg.topY - leg.groundY)) <= 0.000_001,
          'Runtime support leg has an invalid terrain-to-cap load path',
          { movementId: movement.id, recordIndex, legIndex, leg }
        );
      }
      if (record.supportKind === 'single-column') {
        maximumSingleColumnCapWidthM = Math.max(
          maximumSingleColumnCapWidthM,
          record.capWidth
        );
        check(
          record.capWidth < 10
            && record.invalidOutwardCapOverhang <= 0.000_001
            && record.pierCapOverlap > 0,
          'Runtime single-column cap restored the mirrored unloaded cantilever formula',
          { movementId: movement.id, recordIndex, record }
        );
      } else {
        check(
          record.supportKind === 'route-exterior-portal'
            && record.supportLegs.length === 2
            && record.invalidOutwardCapOverhang === 0,
          'Runtime wide crossing is not represented by a clearance-proven two-leg portal',
          { movementId: movement.id, recordIndex, record }
        );
      }
    }
    check(report.maximumGap <= report.maximumAllowedGap, 'Runtime bridge support exceeds two bays', {
      movementId: movement.id,
      maximumGap: report.maximumGap,
      maximumAllowedGap: report.maximumAllowedGap,
      maximumGapEdgeId: report.maximumGapEdgeId,
      maximumGapStations: report.maximumGapStations,
      maximumGapCoverage: report.maximumGapCoverage
    });
    check(report.gapViolationCount === 0 && report.unsupportedEdgeCount === 0,
      'Runtime bridge support diagnostics retain an uncovered edge', {
        movementId: movement.id,
        gapViolations: report.gapViolations,
        unsupportedEdgeIds: report.unsupportedEdgeIds
      });
    const forkEdges = graph.edges.filter((edge) => edge.family === 'straight-fork-branch');
    check(forkEdges.length === 2, 'Runtime support audit omitted a straight-fork branch', movement.id);
    for (const edge of forkEdges) {
      const middle = track.sampleEdge(edge.id, edge.length * 0.5, 0, {});
      const elevated = middle.y - middle.upY * 0.92 - (-1.18) >= 2.2;
      if (!elevated) continue;
      auditedForkEdgeCount++;
      check(
        report.stationsByEdge[edge.id]?.length > 0
          && report.coverageByEdge[edge.id]?.length > 0,
        'Straight-fork support evidence omitted stations or coverage',
        {
          movementId: movement.id,
          edgeId: edge.id,
          stations: report.stationsByEdge[edge.id],
          coverage: report.coverageByEdge[edge.id]
        }
      );
    }
  }
  check(inactiveVariantIgnoredEdgeCount > 0,
    'Retained inactive route variants never exercised the support-clearance exclusion');
  check(
    maximumPlannerStepCount <= MAX_RUNTIME_SUPPORT_PLANNER_STEPS,
    'Runtime support planner exceeded its two-variant readiness share',
    { maximumPlannerStepCount, maximumAllowedSteps: MAX_RUNTIME_SUPPORT_PLANNER_STEPS }
  );
  // The former XZ-only filter discarded vertically separated bearing sites. Height-aware clearance restores
  // those real columns, so the retained 12-movement audit now owns 816 records instead of the stale 606.
  check(auditedSupportRecordCount === 816,
    'Runtime support audit did not inspect every retained movement record',
    { auditedSupportRecordCount, expected: 816 });
  check(maximumInvalidOutwardCapOverhangM <= 0.000_001,
    'A runtime cap retains unloaded outward overhang',
    { maximumInvalidOutwardCapOverhangM });
  Object.assign(summary, {
    auditedMovements: track.graph.movements.length,
    auditedForkEdges: auditedForkEdgeCount,
    maximumGapM,
    maximumAllowedGapM: 104.01,
    inactiveVariantIgnoredEdgeCount,
    maximumPlannerSpecCount,
    maximumPlannerStepCount,
    maximumPlacementCandidateCount,
    maximumClearanceQueryCount,
    auditedSupportRecordCount,
    maximumSingleColumnCapWidthM,
    maximumInvalidOutwardCapOverhangM,
    minimumPierCapOverlapM
  });
}

/** Separate the current standard tile contract from active and resident visual sums. */
function validateTileDiagnosticSemantics(summary) {
  const idleTasks = new Map();
  let idleSerial = 0;
  const standardTileDiagnostics = Object.freeze({
    crossingCount: 20,
    physicalSpanCount: 16,
    mergedCrossingCount: 4,
    bridgeSpanOverlapCount: 0,
    dynamicRoadWidthSamples: 1_200,
    junctionBiasSamples: 640,
    trimmedBarrierSampleCount: 644,
    retainedJunctionBoundaryCount: 56,
    suppressedConnectedCapCount: 56,
    junctionApronCandidateCount: 16,
    junctionApronCount: 0,
    junctionApronCoverageMissCount: 0,
    junctionApronTopologyFailureCount: 0,
    junctionApronMaximumSpanM: 0,
    junctionApronSurfaceLiftM: 0,
    junctionLongPairCount: 0,
    junctionLensCount: 0,
    junctionLensResidualOverlapCount: 0,
    junctionLensMaximumRunM: 0,
    junctionLensMaximumCrossWidthM: 0,
    junctionLensClearanceToleranceM: 0.01,
    junctionLensCoverageStationCount: 0,
    junctionLensUncoveredStationCount: 0,
    junctionLensApronContinuityFailureCount: 0,
    junctionLensClearanceFailureCount: 0,
    junctionLensMaximumEndClearanceErrorM: 0,
    junctionVerticallySeparatedPairCount: 0,
    junctionVerticalSeparationStationCount: 0,
    junctionVerticalSeparationFailureCount: 0,
    junctionMinimumVerticalShellGapM: null,
    junctionLensTopologyFailureCount: 0,
    junctionRaisedBarrierIntrusionCount: 0
  });
  const visualFactory = {
    create({ track: scopedTrack }) {
      const tileToken = scopedTrack.graph.tile?.token || 'fixture-tile';
      const tunnelLightEmitters = Object.freeze([Object.freeze({
        id: `${tileToken}:fixture-light`,
        tileToken,
        coordinateMode: 'absolute-world-and-tile-local',
        absolutePosition: Object.freeze({ x: scopedTrack.graph.origin.x, y: 4, z: scopedTrack.graph.origin.z }),
        tileLocalPosition: Object.freeze({ x: 0, y: 4, z: 0 }),
        direction: Object.freeze({ x: 0, y: -1, z: 0 }),
        color: 0xff_d884,
        intensity: 1_400,
        distance: 30,
        kind: 'tunnel-ceiling-fixture',
        edge: `${tileToken}:fixture-edge`,
        profile: `${tileToken}:fixture-profile`,
        profileKind: 'underground-tunnel',
        edgeS: 40,
        side: 1
      })]);
      return {
        visible: true,
        diagnostics: Object.freeze({
          ...standardTileDiagnostics,
          edgeCount: scopedTrack.graph.edges.length,
          junctionApronCandidateCount: 18,
          junctionApronCount: 0,
          junctionLongPairCount: 0,
          junctionLensCount: 0,
          roadArrowCount: 2,
          roadArrowMinimumForwardDot: 1,
          roadArrowDirectionViolationCount: 0,
          tunnelLightCount: tunnelLightEmitters.length,
          tunnelLightEmitterCount: tunnelLightEmitters.length,
          tunnelLightEmitterMismatchCount: 0,
          standardTileDiagnostics
        }),
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        getTunnelLightEmitters() { return tunnelLightEmitters; },
        dispose() { this.disposed = true; }
      };
    }
  };
  const pool = cloverleafTilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    prepareRecoveryVariants: false,
    requestIdleCallback(callback) {
      const id = ++idleSerial;
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now: (() => {
      let time = 0;
      return () => ++time;
    })()
  });
  const pathPlan = track.createPathPlan({
    movementId: 'south-left',
    futureMovementKind: 'straight'
  });
  const cursor = track.getInitialRouteCursor({ pathPlan });
  const origin = track.sampleRouteCursor(cursor, 0, {});
  pool.update({ origin, pathPlan, routeCursor: cursor });
  const idleEntry = idleTasks.entries().next().value;
  check(Boolean(idleEntry), 'Diagnostic fixture did not schedule the third resident tile');
  idleTasks.delete(idleEntry[0]);
  idleEntry[1]({ didTimeout: false, timeRemaining: () => 50 });
  const diagnostics = pool.getDiagnostics();
  const activeTunnelLightEmitters = pool.getActiveTunnelLightEmitters();
  const activeCoveredRouteLightEmitters = pool.getActiveCoveredRouteLightEmitters();
  check(diagnostics.poolSize === 3 && diagnostics.activeTileDiagnostics.length === 2,
    'Diagnostic fixture did not produce two active and three resident tiles', diagnostics);
  check(Object.isFrozen(activeTunnelLightEmitters)
    && activeTunnelLightEmitters.length === 2
    && activeTunnelLightEmitters.every(Object.isFrozen),
  'Active tunnel emitter aggregation lost its immutable two-tile contract', activeTunnelLightEmitters);
  check(activeTunnelLightEmitters.every((emitter) => diagnostics.activeTokens.includes(emitter.tileToken)),
    'Tunnel light pool exposed a warm resident emitter before its tile became active', activeTunnelLightEmitters);
  check(Object.isFrozen(activeCoveredRouteLightEmitters)
    && activeCoveredRouteLightEmitters.length === 2
    && diagnostics.activeCoveredRouteLightEmitterCount === 2,
  'Covered-route fixture aggregation lost its immutable active-tile contract', activeCoveredRouteLightEmitters);
  check(diagnostics.residentTunnelLightEmitterCount === 3
    && diagnostics.activeTunnelLightEmitterCount === 2
    && diagnostics.activeTunnelLightFixtureCount === 2
    && diagnostics.activeTunnelLightEmitterMismatchCount === 0
    && diagnostics.tunnelLightEmitterMismatchCount === 0,
  'Resident/active tunnel fixture and emitter diagnostics diverged', diagnostics);
  check(
    diagnostics.crossingCount === 20
      && diagnostics.physicalSpanCount === 16
      && diagnostics.suppressedConnectedCapCount === 56
      && diagnostics.junctionApronCandidateCount === 16
      && diagnostics.junctionLongPairCount === 0
      && diagnostics.junctionLensCount === 0
      && diagnostics.junctionVerticallySeparatedPairCount === 0,
    'Flat browser diagnostics no longer represent one current standard tile',
    diagnostics
  );
  check(
    diagnostics.activeStructuralAggregate.crossingCount === 40
      && diagnostics.activeStructuralAggregate.junctionApronCandidateCount === 36
      && diagnostics.activeStructuralAggregate.junctionLensCount === 0,
    'Active visual aggregate has the wrong two-tile semantics',
    diagnostics.activeStructuralAggregate
  );
  check(
    diagnostics.residentStructuralAggregate.crossingCount === 60
      && diagnostics.residentStructuralAggregate.junctionApronCandidateCount === 54
      && diagnostics.residentStructuralAggregate.junctionLensCount === 0,
    'Resident visual aggregate has the wrong three-tile semantics',
    diagnostics.residentStructuralAggregate
  );
  check(
    diagnostics.perTileStructuralInvariant.consistent === true
      && diagnostics.perTileStructuralInvariant.tileCount === 3
      && diagnostics.perTileStructuralInvariant.minimums.junctionApronCandidateCount === 16
      && diagnostics.perTileStructuralInvariant.maximums.junctionApronCandidateCount === 16,
    'Per-tile invariant range drifted with resident pool growth',
    diagnostics.perTileStructuralInvariant
  );
  check(diagnostics.activeTileDiagnostics.every((entry) => (
    entry.standardTile.crossingCount === 20
      && entry.standardTile.junctionLensCount === 0
      && entry.residentVisual.junctionLensCount === 0
  )), 'Active per-tile records mix standard and resident visual contracts', diagnostics.activeTileDiagnostics);
  check(diagnostics.roadArrowCount === 4
    && diagnostics.roadArrowMinimumForwardDot === 1
    && diagnostics.roadArrowDirectionViolationCount === 0,
  'Active road-arrow direction diagnostics were not aggregated across tile visuals', {
    count: diagnostics.roadArrowCount,
    minimumForwardDot: diagnostics.roadArrowMinimumForwardDot,
    directionViolations: diagnostics.roadArrowDirectionViolationCount
  });
  pool.dispose();
  Object.assign(summary, {
    activeTiles: diagnostics.activeTileDiagnostics.length,
    residentTiles: diagnostics.poolSize,
    flatCrossings: diagnostics.crossingCount,
    flatPhysicalSpans: diagnostics.physicalSpanCount,
    flatJunctionLenses: diagnostics.junctionLensCount,
    activeApronCandidates: diagnostics.activeStructuralAggregate.junctionApronCandidateCount,
    residentApronCandidates: diagnostics.residentStructuralAggregate.junctionApronCandidateCount,
    invariantConsistent: diagnostics.perTileStructuralInvariant.consistent
  });
}

/** Lock production junctions to level edge shells; cosmetic slabs must never regain surface authority. */
function validateJunctionSurfaceAuthority(summary) {
  const contract = track.graph.contract;
  const turningEdges = track.graph.edges.filter((edge) => (
    edge.family === 'direct-ramp' || edge.family === 'loop-ramp'
  ));
  check(contract.junctionSurfaceAuthority === 'level-overlap-edge-shells',
    'Junction surface authority no longer belongs to the routed edge shells', contract);
  check(track.graph.junctionOverlapEnvelopes.length === 16 && turningEdges.length === 8,
    'Junction surface contract does not cover every cloverleaf split and merge', {
      junctions: track.graph.junctionOverlapEnvelopes.length,
      turningEdges: turningEdges.length
    });

  let maximumFlatBoundaryBankRadians = 0;
  let minimumPostThroatBankRadians = Number.POSITIVE_INFINITY;
  for (const edge of turningEdges) {
    const expectedStartFlatLength = contract.sharedJunctionThroatLength;
    const expectedEndFlatLength = edge.family === 'loop-ramp'
      ? contract.loopMergeLevelLength
      : contract.sharedJunctionThroatLength;
    checkNear(edge.bankProfile.startFlatLength, expectedStartFlatLength, 0.000_001,
      'Turning edge lost its unbanked split throat');
    checkNear(edge.bankProfile.endFlatLength, expectedEndFlatLength, 0.000_001,
      'Turning edge lost its unbanked merge throat');
    for (const [endpoint, flatLength] of [
      ['from', expectedStartFlatLength],
      ['to', expectedEndFlatLength]
    ]) {
      const boundaryS = endpoint === 'from' ? flatLength : edge.length - flatLength;
      const insideS = endpoint === 'from' ? boundaryS - 0.25 : boundaryS + 0.25;
      const outsideS = endpoint === 'from'
        ? boundaryS + edge.bankProfile.transitionLength
        : boundaryS - edge.bankProfile.transitionLength;
      const inside = track.sampleEdge(edge.id, insideS, 0, {});
      const boundary = track.sampleEdge(edge.id, boundaryS, 0, {});
      const outside = track.sampleEdge(edge.id, outsideS, 0, {});
      maximumFlatBoundaryBankRadians = Math.max(
        maximumFlatBoundaryBankRadians,
        Math.abs(inside.bank),
        Math.abs(boundary.bank)
      );
      if (Math.abs(outside.curvature) > 0.000_001) {
        minimumPostThroatBankRadians = Math.min(
          minimumPostThroatBankRadians,
          Math.abs(outside.bank)
        );
      }
    }
  }
  check(maximumFlatBoundaryBankRadians <= 0.000_001,
    'A turning shell banks before its sibling footprint has separated', maximumFlatBoundaryBankRadians);
  check(Number.isFinite(minimumPostThroatBankRadians) && minimumPostThroatBankRadians > 0,
    'Superelevation did not resume smoothly after the shared junction throat',
    minimumPostThroatBankRadians);

  Object.assign(summary, {
    candidateCount: track.graph.junctionOverlapEnvelopes.length,
    turningEdgeCount: turningEdges.length,
    surfaceAuthority: contract.junctionSurfaceAuthority,
    sharedThroatLengthM: contract.sharedJunctionThroatLength,
    loopMergeLevelLengthM: contract.loopMergeLevelLength,
    maximumFlatBoundaryBankRadians,
    minimumPostThroatBankRadians
  });
}

/** Build the production merged road batch and lock caps, topology, and finite buffers to one contract. */
function validateJunctionBufferGeometry(summary) {
  check(typeof cloverleafVisuals.createGeometryBatchAuditJob === 'function',
    'Server-side cloverleaf BufferGeometry audit hook is missing');
  const { batch, stepCount } = withDeterministicClock(() => {
    const job = cloverleafVisuals.createGeometryBatchAuditJob({
      THREE: createGeometryAuditThree(),
      track,
      qualityProfile: Object.freeze({ id: 'high' })
    });
    let deterministicStepCount = 0;
    while (!job.step(BUILD_SLICE_BUDGET_MS)) {
      deterministicStepCount++;
      check(deterministicStepCount <= MAX_DETERMINISTIC_BUILD_STEPS,
        'Cloverleaf BufferGeometry audit exceeded its deterministic work bound', {
          deterministicStepCount,
          maximum: MAX_DETERMINISTIC_BUILD_STEPS
        });
    }
    return Object.freeze({ batch: job.finish(), stepCount: deterministicStepCount });
  });
  const positions = batch.roadShellGeometry.getAttribute('position');
  const metrics = batch.metrics;
  check(batch.roadShellGeometry.isBufferGeometry
    && positions?.count > 0
    && batch.roadShellGeometry.index?.count > 0,
  'Merged cloverleaf road BufferGeometry is empty');
  check(positions.array.every(Number.isFinite), 'Merged cloverleaf road BufferGeometry has invalid coordinates');
  const roadCoordinateAudit = inspectVisibleRoadCoordinateContract(batch.roadShellGeometry);
  check(!roadCoordinateAudit.attributeCountMismatch
    && roadCoordinateAudit.nonFiniteComponentCount === 0
    && roadCoordinateAudit.junctionSurfaceRangeCount === 0
    && roadCoordinateAudit.visibleTopTriangleCount === 0
    && roadCoordinateAudit.visibleTopDegenerateCoordinateTriangleCount === 0,
  'Merged road batch unexpectedly retained cosmetic junction shader ranges', roadCoordinateAudit);
  check(metrics.suppressedConnectedCapCount === batch.edges.length * 2,
    'A connected road endpoint retained an internal cross-section cap', {
      suppressed: metrics.suppressedConnectedCapCount,
      expected: batch.edges.length * 2
    });
  check(metrics.junctionApronCandidateCount === 16
    && metrics.junctionApronCount === 0
    && metrics.junctionLongPairCount === 0
    && metrics.junctionLensCount === 0
    && metrics.junctionVerticallySeparatedPairCount === 0,
  'Rendered junction geometry restored a raised apron or overlap lens', metrics);
  check(metrics.junctionApronCoverageMissCount === 0
    && metrics.junctionApronTopologyFailureCount === 0
    && metrics.junctionLensResidualOverlapCount === 0
    && metrics.junctionLensUncoveredStationCount === 0
    && metrics.junctionLensApronContinuityFailureCount === 0
    && metrics.junctionLensClearanceFailureCount === 0
    && metrics.junctionVerticalSeparationFailureCount === 0
    && metrics.junctionMinimumVerticalShellGapM === null
    && metrics.junctionLensTopologyFailureCount === 0
    && metrics.junctionRaisedBarrierIntrusionCount === 0
    && metrics.topologyFailureCount === 0,
  'Rendered junction BufferGeometry failed overlap or topology diagnostics', metrics);
  check(metrics.maximumSliceMs <= BUILD_SLICE_BUDGET_MS && metrics.sliceOverrunCount === 0,
    'Synthetic clock exposed an unbounded cloverleaf build slice', metrics);
  Object.assign(summary, {
    bufferVertices: positions.count,
    bufferIndices: batch.roadShellGeometry.index.count,
    suppressedConnectedCaps: metrics.suppressedConnectedCapCount,
    trimmedBarrierSamples: metrics.trimmedBarrierSampleCount,
    syntheticMaximumSliceMs: metrics.maximumSliceMs,
    syntheticSlowestSliceLabel: metrics.slowestSliceLabel,
    syntheticSliceOverruns: metrics.sliceOverrunCount,
    deterministicClockTickMs: DETERMINISTIC_CLOCK_TICK_MS,
    deterministicBuildSteps: stepCount,
    visibleTopRoadCoordinateTriangles: roadCoordinateAudit.visibleTopTriangleCount,
    degenerateVisibleTopRoadCoordinateTriangles:
      roadCoordinateAudit.visibleTopDegenerateCoordinateTriangleCount
  });
}

/** Analyze the exact vendor-THREE road batch so hidden endpoint seals must close real welded topology. */
function validateClosedRoadShellTopology(summary) {
  check(modeling && typeof modeling.analyzeTopology === 'function',
    'Production topology analyzer did not load');
  const job = cloverleafVisuals.createGeometryBatchAuditJob({
    THREE: vendorThree,
    track,
    qualityProfile: Object.freeze({ id: 'mobile' })
  });
  let stepCount = 0;
  while (!job.step(4)) {
    stepCount++;
    check(stepCount < 1_000_000, 'Vendor-THREE road topology build stalled');
  }
  const batch = job.finish();
  const topology = modeling.analyzeTopology(batch.roadShellGeometry);
  check(
    topology.boundaryEdges === 0
      && topology.nonManifoldEdges === 0
      && topology.degenerateTriangles === 0
      && topology.orientedEdgeMismatches === 0
      && topology.invalidCoordinates === 0
      && topology.isClosed === true,
    'Merged road shell is not a closed manifold',
    topology
  );
  check(
    batch.metrics.recessedTopologySealCount === batch.metrics.suppressedConnectedCapCount,
    'A suppressed connected cap has no recessed topology seal',
    {
      suppressedConnectedCaps: batch.metrics.suppressedConnectedCapCount,
      recessedTopologySeals: batch.metrics.recessedTopologySealCount
    }
  );
  Object.assign(summary, {
    vertices: topology.vertexCount,
    triangles: topology.triangleCount,
    boundaryEdges: topology.boundaryEdges,
    nonManifoldEdges: topology.nonManifoldEdges,
    recessedTopologySeals: batch.metrics.recessedTopologySealCount,
    suppressedConnectedCaps: batch.metrics.suppressedConnectedCapCount,
    buildSteps: stepCount
  });
}

function run() {
  check(track && typeof track.sampleEdge === 'function', 'NeonV23Track did not load');
  const summary = {
    ok: true,
    version: track.CLOVERLEAF_GRAPH_VERSION,
    graph: {},
    seams: {},
    geometry: {},
    tunnels: {},
    reusableSamples: {},
    dynamics: {},
    performance: {},
    itinerary: {},
    bidirectional: {},
    jumpPlatforms: {},
    airborneLanding: {},
    opposingCrossover: {},
    straightFork: {},
    clearance: {},
    clearZone: {},
    junctions: {},
    renderGeometry: {},
    roadShellTopology: {},
    runtimeSupports: {},
    tileDiagnostics: {},
    roadArrowDirection: {}
  };

  validateRoadArrowDirection(summary.roadArrowDirection);
  validateGraphAndMovements(summary.graph);
  validateSeams(summary.seams);
  validateGeometry(summary.geometry);
  validateTunnelRoutes(summary.tunnels);
  validateReusableEdgeSampleContract(summary.reusableSamples);
  validateAutomaticBraking(summary.dynamics);
  validateCurvaturePreviewOptimization(summary.performance);
  validateCandidatePreparation(summary.performance);
  validateSignedPathSampling(summary.performance);
  const plan = validateItinerary(summary.itinerary);
  validateBidirectionalVisualRoads(plan, summary.bidirectional);
  validateJumpPlatforms(plan, summary.jumpPlatforms);
  validateAirborneLandingSupport(plan, summary.airborneLanding);
  validateOpposingCrossoverSupportAndContinuation(summary.opposingCrossover);
  validateStraightRoadFork(plan, summary.straightFork);
  validateRoadClearance(summary.clearance);
  validateInterchangeClearZone(summary.clearZone);
  validateRuntimeSupportLayouts(summary.runtimeSupports);
  validateTileDiagnosticSemantics(summary.tileDiagnostics);
  validateJunctionSurfaceAuthority(summary.junctions);
  validateJunctionBufferGeometry(summary.renderGeometry);
  validateClosedRoadShellTopology(summary.roadShellTopology);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    name: error?.name || 'Error',
    message: error?.message || String(error)
  })}\n`);
  process.exitCode = 1;
}
