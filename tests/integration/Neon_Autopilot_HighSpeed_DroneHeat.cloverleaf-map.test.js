#!/usr/bin/env node
/* Pure-Node overview-map regression using a deterministic no-raster Canvas 2D surface. */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = globalThis;
global.innerWidth = 1_440;
global.innerHeight = 900;
global.devicePixelRatio = 1;

require(path.join(PROJECT_ROOT, 'src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.track.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-tiles.js'));
require(path.join(PROJECT_ROOT, 'errors/minimap.js'));
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-map.js'));
const i18nLibrary = require(path.join(
  PROJECT_ROOT,
  'src/ui/Neon_Autopilot_HighSpeed_DroneHeat.i18n.js'
));

const config = globalThis.NeonConfig;
const track = globalThis.NeonTrack;
const tilePool = globalThis.NeonCloverleafTilePool;
const productionMapFactory = globalThis.NeonCloverleafMap;
// Every harness instance mirrors the production DOM's two visible surfaces; no test may silently exercise
// the impossible single-canvas "atomic" path.
const mapFactory = Object.freeze({
  ...productionMapFactory,
  create(options = {}) {
    const primary = options.canvas;
    const standbyCanvas = options.standbyCanvas || createCanvas(
      primary?.clientWidth || primary?.width || 400,
      primary?.clientHeight || primary?.height || 225
    );
    return productionMapFactory.create({ ...options, standbyCanvas });
  }
});
const EXPECTED_TERRAIN_PALETTE = Object.freeze(config.zones.map((zone) => (
  `#${zone.terrain.base.toString(16).padStart(6, '0')}`
)));
const PORTS = Object.freeze(['south', 'west', 'north', 'east']);
const KINDS = Object.freeze(['straight', 'right', 'left']);
const RESOLUTIONS = Object.freeze([
  Object.freeze({ width: 640, height: 360 }),
  Object.freeze({ width: 400, height: 225 }),
  // 1024x600 production CSS yields this exact inner tactical Canvas.
  Object.freeze({ width: 291, height: 163 }),
  Object.freeze({ width: 240, height: 135 }),
  Object.freeze({ width: 160, height: 108 })
]);
const STEADY_FRAMES = 260;
const TERRAIN_CELL_SIZE_M = 96;
const COMPACT_MAX_WIDTH_PX = 240;
const DESKTOP_OVERVIEW_VISIBLE_SPAN_M = 1_800;
const COMPACT_OVERVIEW_VISIBLE_SPAN_M = 1_440;
const DESKTOP_GUIDED_VISIBLE_SPAN_M = 1_350;
const COMPACT_GUIDED_VISIBLE_SPAN_M = 900;
const DESKTOP_ROAD_DETAIL_MIN_SCALE = 0.60;
const DESKTOP_ROAD_DETAIL_MAX_SCALE = 0.72;
const DESKTOP_ROAD_DETAIL_TARGET_AHEAD_M = 440;
const DESKTOP_WORLD_CACHE_SCALE = 0.32;
const PLAYER_ARROW_PX = 11;

const SHARED_TERRAIN_CELLS = Object.freeze(Array.from({ length: 225 }, (_, index) => {
  const row = Math.floor(index / 15) - 7;
  const column = index % 15 - 7;
  return Object.freeze({
    id: `fixture-terrain-${index + 1}`,
    visible: true,
    x: column * TERRAIN_CELL_SIZE_M,
    z: row * TERRAIN_CELL_SIZE_M,
    sizeM: TERRAIN_CELL_SIZE_M,
    zoneIndex: 0,
    nextZoneIndex: null,
    kind: 'biome',
    rotationQuarter: index % 4,
    brightness: 1
  });
}));
const SHARED_SCENERY_ENTITIES = Object.freeze([
  Object.freeze({ id: 'fixture-landmark', category: 'landmark', visible: true,
    x: -90, y: 2, z: 60, heading: 0.2, radiusM: 6, zoneIndex: 0 }),
  Object.freeze({ id: 'fixture-environment', category: 'environment', visible: true,
    x: 80, y: 1, z: 80, heading: -0.4, radiusM: 5, zoneIndex: 0 }),
  Object.freeze({ id: 'fixture-air-traffic', category: 'air-traffic', visible: true,
    x: 40, y: 18, z: -100, heading: 0.8, radiusM: 4, zoneIndex: 0 }),
  Object.freeze({ id: 'fixture-dark-dragon', category: 'dark-dragon', visible: true,
    x: -40, y: 26, z: -80, heading: -1.1, radiusM: 8, zoneIndex: 0 }),
  Object.freeze({ id: 'fixture-hidden-landmark', category: 'landmark', visible: false,
    x: 320, y: 2, z: 320, heading: 0, radiusM: 6, zoneIndex: 0 })
]);
const SHARED_WORLD_FIXTURE = Object.freeze({
  version: 1,
  coordinateMode: 'absolute-world-xz',
  terrainCells: SHARED_TERRAIN_CELLS,
  terrainRevision: 17,
  sceneryEntities: SHARED_SCENERY_ENTITIES,
  sceneryRevision: 23
});

function snapshotHashText(hash, value) {
  let next = hash >>> 0;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index++) {
    next = Math.imul(next ^ text.charCodeAt(index), 0x0100_0193) >>> 0;
  }
  return next;
}

function snapshotHashNumber(hash, value, precision = 1_000) {
  const normalized = Number.isFinite(value) ? Math.round(value * precision) : 0x7fff_ffff;
  return Math.imul((hash >>> 0) ^ normalized, 0x0100_0193) >>> 0;
}

function terrainSnapshotHash(cells) {
  let hash = 0x811c_9dc5;
  for (const cell of cells) {
    if (!cell || cell.visible === false) continue;
    hash = snapshotHashText(hash, cell.id);
    hash = snapshotHashNumber(hash, cell.x);
    hash = snapshotHashNumber(hash, cell.z);
    hash = snapshotHashNumber(hash, cell.sizeM);
    hash = snapshotHashNumber(hash, cell.zoneIndex, 1);
    hash = snapshotHashNumber(hash, Number.isInteger(cell.nextZoneIndex) ? cell.nextZoneIndex : -1, 1);
  }
  return hash >>> 0;
}

function scenerySnapshotHash(entities) {
  let hash = 0x811c_9dc5;
  for (const entity of entities) {
    hash = snapshotHashText(hash, entity?.id);
    hash = snapshotHashText(hash, entity?.category || entity?.kind);
    hash = snapshotHashNumber(hash, entity?.visible === true ? 1 : 0, 1);
    if (entity?.visible) {
      hash = snapshotHashNumber(hash, entity.x);
      hash = snapshotHashNumber(hash, entity.z);
      hash = snapshotHashNumber(hash, entity.heading);
    }
  }
  return hash >>> 0;
}

const EXPECTED_TERRAIN_SNAPSHOT_HASH = terrainSnapshotHash(SHARED_TERRAIN_CELLS);
const EXPECTED_SCENERY_SNAPSHOT_HASH = scenerySnapshotHash(SHARED_SCENERY_ENTITIES);

function check(condition, message, details = null) {
  if (condition) return;
  const suffix = details === null ? '' : `: ${JSON.stringify(details)}`;
  throw new Error(`${message}${suffix}`);
}

function checkNear(actual, expected, tolerance, message) {
  check(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, message, {
    actual,
    expected,
    tolerance
  });
}

class FakeContext2D {
  constructor() {
    this.font = '10px sans-serif';
    this.globalAlpha = 1;
    this.imageSmoothingEnabled = true;
    this.drawImageCount = 0;
    this.failOnClearRect = false;
    this.failOnFillText = false;
    this.failOnDrawImage = false;
    this.fillTextValues = [];
  }

  setTransform() {}
  clearRect() {
    if (this.failOnClearRect) throw new Error('Injected world-cache render failure');
  }
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  closePath() {}
  stroke() {}
  fill() {}
  fillText(text) {
    if (this.failOnFillText) throw new Error('Injected frame-layer failure');
    this.fillTextValues.push(String(text));
  }
  setLineDash() {}
  drawImage() {
    if (this.failOnDrawImage) throw new Error('Injected presentation failure');
    this.drawImageCount++;
  }
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  arc() {}

  measureText(text) {
    const fontSize = Number.parseFloat(this.font) || 10;
    const width = [...String(text)].reduce((total, character) => (
      total + (character.codePointAt(0) > 0xff ? fontSize : fontSize * 0.58)
    ), 0);
    return { width };
  }
}

class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.context = new FakeContext2D();
    this.dataset = {};
    const classes = new Set();
    this.classList = {
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      }
    };
  }

  getContext(kind) {
    return kind === '2d' ? this.context : null;
  }

  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight
    };
  }
}

function createCanvas(width, height) {
  return new FakeCanvas(width, height);
}

/** Resolve the single visible surface from renderer diagnostics instead of assuming the primary stays active. */
function activePresentationSurface(diagnostics, primaryCanvas, standbyCanvas) {
  const surfaces = [primaryCanvas, standbyCanvas];
  const active = surfaces[diagnostics.activePresentationIndex];
  check(Boolean(active), 'Minimap diagnostics identify an unavailable presentation surface', diagnostics);
  check(
    surfaces.filter((surface) => surface.classList.contains('is-presented')
      && surface.dataset.presented === 'true').length === 1,
    'Atomic presenter does not expose exactly one complete surface',
    {
      activePresentationIndex: diagnostics.activePresentationIndex,
      primary: primaryCanvas.dataset.presented,
      standby: standbyCanvas.dataset.presented
    }
  );
  return active;
}

function createGraphFixture() {
  const itinerary = track.createPathPlan({ movementId: 'south-straight' });
  const tile = itinerary.tiles[0];
  const graph = tilePool.graphForTile(track, tile, itinerary, { includeRecovery: false });
  check(
    graph.edges.length === track.graph.edges.length + 4,
    'Tile-local overview omitted one side of a bidirectional arm',
    { actual: graph.edges.length, template: track.graph.edges.length }
  );
  check(graph.bidirectionalVisualEdgeIds.length === 4, 'Overview did not retain four short outbound extensions');
  check(
    graph.bidirectionalVisualEdgeIds.every((edgeId) => (
      track.getEdge(edgeId)?.bidirectionalRole === 'outbound-extension'
    )),
    'Overview included the long inter-tile corridor in fixed-north mode'
  );
  check(graph.bidirectionalPathPlanViolationCount === 0, 'Map-only carriageway entered PathPlan');
  check(graph.bidirectionalSeamAudit.violationCount === 0, 'Map-only carriageway has a visible seam',
    graph.bidirectionalSeamAudit);
  check(graph.crossings.length === 20, 'Tile-local overview omitted declared road crossings', graph.crossings.length);
  check(graph.movements.length === 12, 'Tile-local overview omitted movements', graph.movements.length);
  return graph;
}

/** Both fork roads remain resident in one tile variant; committing a side changes PathPlan only. */
function validateStraightForkTileGraph() {
  const leftPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const tile = leftPlan.tiles[0];
  const movements = track.getRecoveryForkMovementsForTile(tile);
  const leftMovement = movements.find((movement) => movement.forkSide === 'left');
  const rightMovement = movements.find((movement) => movement.forkSide === 'right');
  check(leftMovement && rightMovement, 'Tile graph fixture could not resolve both fork movements');
  const leftGraph = tilePool.graphForTile(track, tile, leftPlan, { includeRecovery: true });
  const branchEdges = leftGraph.edges.filter((edge) => edge.family === 'straight-fork-branch');
  check(branchEdges.length === 2 && leftGraph.recoveryEdgeIds.length === 6,
    'Tile road geometry did not retain both fork branches', {
      branches: branchEdges.map((edge) => edge.id),
      recoveryEdgeIds: leftGraph.recoveryEdgeIds
    });
  check(branchEdges.every((edge) => edge.interchangeClearZone === false),
    'Straight-fork roads inherited the interchange-only map zoom-out boundary');
  check(leftGraph.movements.length === 12,
    'Fork roads polluted the cloverleaf entry movement matrix', leftGraph.movements.length);
  check(leftPlan.edgeIds.includes(leftMovement.edgeIds[0]) && !leftPlan.edgeIds.includes(rightMovement.edgeIds[0]),
    'Default PathPlan did not retain exactly one fork branch');

  const rightPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight',
    committedChoices: Object.freeze({ [rightMovement.decisionNodeId]: rightMovement.id })
  });
  const rightGraph = tilePool.graphForTile(track, rightPlan.tiles[0], rightPlan, { includeRecovery: true });
  check(rightPlan.edgeIds.includes(rightMovement.edgeIds[0]) && !rightPlan.edgeIds.includes(leftMovement.edgeIds[0]),
    'Committed PathPlan did not retain exactly the right fork branch');
  check(rightGraph.recoveryVariantSignature === leftGraph.recoveryVariantSignature,
    'Fork commitment rebuilt physical tile geometry instead of selecting the resident branch', {
      left: leftGraph.recoveryVariantSignature,
      right: rightGraph.recoveryVariantSignature
    });
  check(rightGraph.recoveryEdgeIds.join('|') === leftGraph.recoveryEdgeIds.join('|'),
    'Fork commitment changed the resident recovery edge set');
  return {
    recoveryEdges: leftGraph.recoveryEdgeIds.length,
    branchEdges: branchEdges.length,
    cloverleafMovements: leftGraph.movements.length,
    stableVariantSignature: true,
    selectedBranchesPerPlan: 1
  };
}

/** Verify future visuals are built through the idle queue and reused before they become the next live tile. */
function validateTilePrewarm() {
  const idleTasks = new Map();
  const visuals = new Map();
  const sampleTerrainHeight = (x, z) => x * 0.001 + z * 0.002;
  let idleSerial = 0;
  let fakeNow = 0;
  const runNextIdleTask = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Tile pool did not schedule an idle warmup');
    const [id, callback] = entry;
    idleTasks.delete(id);
    callback({ didTimeout: false, timeRemaining: () => 50 });
  };
  const visualFactory = {
    create({ track: scopedTrack, sampleTerrainHeight: visualTerrainSampler }) {
      check(
        visualTerrainSampler === sampleTerrainHeight,
        'Tile visual did not retain the runtime absolute-world terrain sampler'
      );
      const token = scopedTrack.graph.tile.token;
      const visual = {
        visible: true,
        diagnostics: Object.freeze({ edgeCount: scopedTrack.graph.edges.length }),
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        dispose() { this.disposed = true; }
      };
      visuals.set(token, visual);
      return visual;
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    sampleTerrainHeight,
    maxTiles: 3,
    prepareRecoveryVariants: false,
    requestIdleCallback(callback) {
      const id = ++idleSerial;
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 1; return fakeNow; }
  });
  let pathPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const firstCursor = track.getInitialRouteCursor({ pathPlan });
  const firstFrame = track.sampleRouteCursor(firstCursor, 0, {});
  pool.update({ origin: firstFrame, pathPlan, routeCursor: firstCursor });
  let diagnostics = pool.getDiagnostics();
  const openingMapGraph = pool.getActiveMapGraph(firstFrame, { maximumDistance: 900 });
  check(openingMapGraph?.tileTokens.length === 1
    && openingMapGraph.tileTokens[0] === pathPlan.tiles[0].token,
  'Opening map graph exposed a future interchange outside the 3D camera range', openingMapGraph?.tileTokens);
  const nextTileMapGraph = pool.getActiveMapGraph({
    x: pathPlan.tiles[1].centerX,
    z: pathPlan.tiles[1].centerZ
  }, { maximumDistance: 900 });
  check(nextTileMapGraph?.tileTokens.includes(pathPlan.tiles[1].token),
    'Map graph omitted an active future interchange inside the 3D camera range', nextTileMapGraph?.tileTokens);
  check(nextTileMapGraph.edges.some((edge) => edge.tileToken === pathPlan.tiles[1].token),
    'Visible future tile roads were not merged into the map graph');
  const nextTileGraph = pool.graphForTile(pathPlan.tiles[1], pathPlan);
  const nextTileVisibilityBounds = nextTileGraph.tileBounds || nextTileGraph.bounds;
  const minimumMapEnvelopeOrigin = {
    x: nextTileVisibilityBounds.maxX + 2_100,
    z: (nextTileVisibilityBounds.minZ + nextTileVisibilityBounds.maxZ) * 0.5
  };
  const minimumMapEnvelopeGraph = pool.getActiveMapGraph(minimumMapEnvelopeOrigin, {
    maximumDistance: 900
  });
  check(
    minimumMapEnvelopeGraph?.tileTokens.includes(pathPlan.tiles[1].token)
      && minimumMapEnvelopeGraph.contract.maximumVisibilityDistanceM === 2_200,
    'Short camera far plane collapsed the stable 2.2km map visibility envelope',
    minimumMapEnvelopeGraph?.contract
  );
  // A visible future tile may add topology, but it must never zoom the current decision area back out.
  const tacticalScaleFor = (activeGraph) => {
    const canvas = createCanvas(400, 225);
    const minimap = mapFactory.create({
      canvas,
      track,
      graph: activeGraph,
      width: 400,
      height: 225,
      dpr: 1,
      maxDpr: 1,
      sampleStep: 4,
      createCanvas
    });
    const mapDiagnostics = minimap.update(movementPayload('south-left'));
    minimap.destroy();
    return mapDiagnostics;
  };
  const openingMapDiagnostics = tacticalScaleFor(openingMapGraph);
  const nextTileMapDiagnostics = tacticalScaleFor(nextTileMapGraph);
  checkNear(nextTileMapDiagnostics.mapScalePxPerM, openingMapDiagnostics.mapScalePxPerM, 0.000_001,
    'A distant active tile reduced the current tactical map scale');
  checkNear(nextTileMapDiagnostics.playerViewportX, openingMapDiagnostics.playerViewportX, 0.000_001,
    'A distant active tile shifted the current player horizontally');
  checkNear(nextTileMapDiagnostics.playerViewportY, openingMapDiagnostics.playerViewportY, 0.000_001,
    'A distant active tile shifted the current player vertically');
  check(diagnostics.foregroundBuildCount === 2, 'Current/next tiles were not the only foreground builds', diagnostics);
  check(diagnostics.bidirectionalMinimumHiddenTailPortalDistanceM >= 1_200,
    'Destination-owned opposing road does not cover the hidden tail beyond the visible world', diagnostics);
  check(diagnostics.warmupScheduled === true, 'Next-next tile warmup was not scheduled', diagnostics);

  runNextIdleTask();
  diagnostics = pool.getDiagnostics();
  check(diagnostics.poolSize === 3, 'Idle warmup did not fill the bounded three-tile pool', diagnostics);
  check(diagnostics.warmBuildCount === 1, 'First future tile was not built by the warmup path', diagnostics);
  check(diagnostics.prewarmedTokens.includes(pathPlan.tiles[2].token), 'Next-next tile is missing from warm residents');

  const revisedPathPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'left' });
  pool.update({ origin: firstFrame, pathPlan: revisedPathPlan, routeCursor: firstCursor });
  diagnostics = pool.getDiagnostics();
  check(diagnostics.foregroundBuildCount === 2, 'A revised next tile rebuilt in the route-commit frame', diagnostics);
  check(
    !diagnostics.activeTokens.includes(revisedPathPlan.tiles[1].token),
    'A stale next-tile visual remained active after its route signature changed',
    diagnostics
  );
  check(diagnostics.invalidationCount === 0, 'Route commit invalidated a future visual inside the interchange', diagnostics);
  check(diagnostics.warmupScheduled === false, 'Heavy future rebuild was scheduled before the recovery road');

  const recoveryEdge = revisedPathPlan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => edge?.runtimeKind === 'recovery' && edge.tileIndex === revisedPathPlan.tiles[0].index);
  check(Boolean(recoveryEdge), 'Revised plan omitted the first recovery edge');
  const recoveryCursor = track.RoutePosition({
    edgeId: recoveryEdge.id,
    edgeS: 0,
    tileIndex: recoveryEdge.tileIndex,
    entryPort: revisedPathPlan.tiles[0].entryPort
  });
  const recoveryFrame = track.sampleRouteCursor(recoveryCursor, 0, {});
  pool.update({ origin: recoveryFrame, pathPlan: revisedPathPlan, routeCursor: recoveryCursor });
  diagnostics = pool.getDiagnostics();
  check(diagnostics.warmupScheduled === true, 'Recovery road did not schedule the revised next-tile warmup');
  runNextIdleTask();
  diagnostics = pool.getDiagnostics();
  check(diagnostics.invalidationCount === 1, 'The revised next tile did not replace its stale signature', diagnostics);
  check(
    diagnostics.lastInvalidation?.previousBuildSource === 'foreground',
    'Route revision did not identify the opening next-tile visual',
    diagnostics.lastInvalidation
  );
  check(diagnostics.warmBuildCount === 2, 'The revised next tile was not rebuilt by the warm path', diagnostics);

  pathPlan = revisedPathPlan;
  pool.update({ origin: recoveryFrame, pathPlan, routeCursor: recoveryCursor });
  diagnostics = pool.getDiagnostics();
  check(diagnostics.activeTokens.includes(pathPlan.tiles[1].token), 'Revised next tile did not activate after warmup');
  runNextIdleTask();
  diagnostics = pool.getDiagnostics();
  check(diagnostics.warmBuildCount === 3, 'Revised next-next tile was not warmed', diagnostics);
  check(diagnostics.prewarmedTokens.includes(pathPlan.tiles[2].token), 'Revised next-next tile is not resident');

  const secondTile = pathPlan.tiles[1];
  const secondCursor = track.RoutePosition({
    edgeId: secondTile.edgeIds[0],
    edgeS: 0,
    tileIndex: secondTile.index,
    entryPort: secondTile.entryPort
  });
  const secondFrame = track.sampleRouteCursor(secondCursor, 0, {});
  pool.update({
    origin: secondFrame,
    visibilityOrigin: secondFrame,
    pathPlan,
    routeCursor: secondCursor
  });
  diagnostics = pool.getDiagnostics();
  check(diagnostics.foregroundBuildCount === 2, 'A prewarmed next tile rebuilt on the live transition frame', diagnostics);
  check(diagnostics.activeTokens.includes(pathPlan.tiles[2].token), 'Prewarmed tile did not become the next active visual');
  check(
    diagnostics.cameraRetainedPreviousTokens.includes(pathPlan.tiles[0].token)
      && diagnostics.previousTileReleaseDistanceM === 2_800
      && diagnostics.activeTokens.length <= diagnostics.maxTiles
      && diagnostics.poolSize <= diagnostics.maxTiles,
    'Camera-visible ordinary previous tile was not retained inside the strict three-tile pool',
    diagnostics
  );
  check(diagnostics.bidirectionalMinimumHiddenTailPortalDistanceM >= 1_200,
    'Portal transition exposed a hidden opposing-road tail inside the visible radius', diagnostics);

  // The player remains at the seam while the presentation camera moves deeper into the current tile. Only the
  // camera envelope may release the previous resident and free one slot for speculative next-next warmup.
  const previousGraph = pool.graphForTile(pathPlan.tiles[0], pathPlan);
  pool.update({
    origin: secondFrame,
    visibilityOrigin: {
      x: previousGraph.bounds.maxX + 2_801,
      z: (previousGraph.bounds.minZ + previousGraph.bounds.maxZ) * 0.5
    },
    pathPlan,
    routeCursor: secondCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.cameraRetainedPreviousTokens.length === 0
      && diagnostics.activeTokens.length <= diagnostics.maxTiles,
    'Previous tile did not release after the camera crossed its 2.8km hysteresis envelope',
    diagnostics
  );
  runNextIdleTask();
  diagnostics = pool.getDiagnostics();
  const thirdFutureTile = pathPlan.tiles.find((tile) => tile.index === secondTile.index + 2);
  check(diagnostics.warmBuildCount === 4, 'Warmup did not continue beyond the first transition', diagnostics);
  check(Boolean(thirdFutureTile), 'Warmup did not extend the itinerary topology');
  pool.update({
    origin: secondFrame,
    visibilityOrigin: { x: thirdFutureTile.centerX, z: thirdFutureTile.centerZ },
    pathPlan,
    routeCursor: secondCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.activeTokens.includes(thirdFutureTile.token)
      && diagnostics.prewarmRevealDistanceM === 2_400
      && diagnostics.prewarmReleaseDistanceM === 2_800
      && diagnostics.visibilityOriginX === thirdFutureTile.centerX
      && diagnostics.visibilityOriginZ === thirdFutureTile.centerZ
      && diagnostics.activeTokens.length <= diagnostics.maxTiles
      && diagnostics.poolSize <= diagnostics.maxTiles,
    'Camera visibility origin did not reveal next-next road inside 2.4km while preserving maxTiles=3',
    diagnostics
  );
  const thirdFutureGraph = pool.graphForTile(thirdFutureTile, pathPlan);
  pool.update({
    origin: secondFrame,
    visibilityOrigin: {
      x: thirdFutureGraph.bounds.maxX + 2_600,
      z: (thirdFutureGraph.bounds.minZ + thirdFutureGraph.bounds.maxZ) * 0.5
    },
    pathPlan,
    routeCursor: secondCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.activeTokens.includes(thirdFutureTile.token),
    'An already revealed future road chattered inside the 2.4-2.8km release band',
    diagnostics
  );
  pool.update({
    origin: secondFrame,
    visibilityOrigin: {
      x: thirdFutureGraph.bounds.maxX + 2_801,
      z: (thirdFutureGraph.bounds.minZ + thirdFutureGraph.bounds.maxZ) * 0.5
    },
    pathPlan,
    routeCursor: secondCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    !diagnostics.activeTokens.includes(thirdFutureTile.token)
      && diagnostics.activeTokens.length <= diagnostics.maxTiles
      && diagnostics.poolSize <= diagnostics.maxTiles,
    'Future road survived beyond the 2.8km release edge',
    diagnostics
  );
  pool.dispose();
  return {
    foregroundBuildCount: diagnostics.foregroundBuildCount,
    warmBuildCount: diagnostics.warmBuildCount,
    maximumResidentTiles: diagnostics.maxTiles,
    earlyReveal: true,
    cameraPreviousRetention: true,
    cameraVisibilityOrigin: true,
    routeRevisionIdleRebuild: diagnostics.invalidationCount === 1,
    routeRevisionDeferredToRecovery: true,
    terrainSamplerForwarded: true,
    openingMapTiles: openingMapGraph.tileTokens.length,
    nearFutureMapTiles: nextTileMapGraph.tileTokens.length,
    minimumMapVisibilityDistanceM: minimumMapEnvelopeGraph.contract.maximumVisibilityDistanceM,
    distantTileScaleIndependent: true,
    hiddenTailPortalDistanceM: diagnostics.bidirectionalMinimumHiddenTailPortalDistanceM
  };
}

/**
 * Keep the physical takeoff road presented while a fast ballistic flight advances the logical cursor into the
 * next tile. Landing authority may retain that source tile, so hiding it before touchdown would expose terrain.
 */
function validateAirborneRoadPinning() {
  const visuals = new Map();
  const visualFactory = {
    create({ track: scopedTrack }) {
      const token = scopedTrack.graph.tile.token;
      const visual = {
        visible: true,
        diagnostics: Object.freeze({ edgeCount: scopedTrack.graph.edges.length }),
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        dispose() { this.disposed = true; }
      };
      visuals.set(token, visual);
      return visual;
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    prepareRecoveryVariants: false,
    requestIdleCallback() { return 1; },
    cancelIdleCallback() {}
  });
  const pathPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const sourceTile = pathPlan.tiles[0];
  const destinationTile = pathPlan.tiles[1];
  const sourceCursor = track.getInitialRouteCursor({ pathPlan });
  const sourceOrigin = track.sampleRouteCursor(sourceCursor, 0, {});
  pool.update({ origin: sourceOrigin, pathPlan, routeCursor: sourceCursor });
  check(
    pool.getDiagnostics().activeTokens.includes(sourceTile.token),
    'Airborne pin fixture did not begin with a visible takeoff road'
  );

  const destinationCursor = track.RoutePosition({
    edgeId: destinationTile.edgeIds[0],
    edgeS: 10,
    tileIndex: destinationTile.index,
    entryPort: destinationTile.entryPort
  });
  const destinationOrigin = track.sampleRouteCursor(destinationCursor, 0, {});
  pool.update({
    origin: destinationOrigin,
    pathPlan,
    routeCursor: destinationCursor,
    pinnedTileTokens: [sourceTile.token]
  });
  let diagnostics = pool.getDiagnostics();
  check(
    diagnostics.activeTokens[0] === destinationTile.token
      && diagnostics.activeTokens.includes(sourceTile.token)
      && visuals.get(sourceTile.token)?.visible === true,
    'Cursor transition hid the still-landable takeoff road during flight',
    {
      activeTokens: diagnostics.activeTokens,
      sourceVisible: visuals.get(sourceTile.token)?.visible
    }
  );
  check(
    diagnostics.pinnedVisibleTokens?.join('|') === sourceTile.token,
    'Tile diagnostics did not expose the active flight-road pin',
    diagnostics
  );
  check(
    diagnostics.activeTokens.length <= diagnostics.maxTiles,
    'Flight-road pin exceeded the bounded resident presentation budget',
    diagnostics
  );

  pool.update({
    origin: destinationOrigin,
    visibilityOrigin: destinationOrigin,
    pathPlan,
    routeCursor: destinationCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.pinnedVisibleTokens?.length === 0
      && diagnostics.cameraRetainedPreviousTokens.includes(sourceTile.token),
    'Released flight authority did not hand the still-visible road to camera-only retention',
    diagnostics
  );
  const sourceVisibilityBounds = pool.graphForTile(sourceTile, pathPlan).bounds;
  pool.update({
    origin: destinationOrigin,
    visibilityOrigin: {
      x: sourceVisibilityBounds.maxX + 2_801,
      z: (sourceVisibilityBounds.minZ + sourceVisibilityBounds.maxZ) * 0.5
    },
    pathPlan,
    routeCursor: destinationCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    !diagnostics.activeTokens.includes(sourceTile.token)
      && visuals.get(sourceTile.token)?.visible === false
      && diagnostics.pinnedVisibleTokens?.length === 0,
    'Takeoff road remained after both flight authority and camera retention released it',
    diagnostics
  );
  pool.dispose();
  return {
    sourceTileToken: sourceTile.token,
    destinationTileToken: destinationTile.token,
    retainedDuringFlight: true,
    releasedAfterFlight: true,
    boundedPresentation: true
  };
}

/**
 * Exercise the production sliced-builder branch when current plus two physical corridor pins consume maxTiles.
 * The speculative next road must wait without evicting either landing authority, then claim the released slot.
 */
function validateStagedPinnedRoadPriority() {
  const idleTasks = new Map();
  const visuals = new Map();
  let idleSerial = 0;
  let fakeNow = 0;
  const makeVisual = (scopedTrack) => {
    const token = scopedTrack.graph.tile.token;
    const visual = {
      visible: false,
      disposed: false,
      diagnostics: Object.freeze({ edgeCount: scopedTrack.graph.edges.length }),
      update(payload = {}) { this.visible = payload.visible !== false; },
      setPalette() {},
      dispose() { this.disposed = true; }
    };
    visuals.set(token, visual);
    return visual;
  };
  const visualFactory = {
    create() {
      throw new Error('Staged pin-priority fixture must not use synchronous road construction');
    },
    createBuildJob({ track: scopedTrack }) {
      let steps = 0;
      return {
        step() {
          steps++;
          return steps >= 2;
        },
        finish() {
          check(steps >= 2, 'Staged pin-priority visual finished before its final slice');
          return makeVisual(scopedTrack);
        },
        cancel() {}
      };
    }
  };
  const pool = tilePool.create({
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
    now() { fakeNow += 0.2; return fakeNow; }
  });
  const pathPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const openingCursor = track.getInitialRouteCursor({ pathPlan });
  track.ensureItineraryHorizon(pathPlan, openingCursor, 6);
  const tileAt = (index) => pathPlan.tiles.find((tile) => tile.index === index);
  const updateAt = (tile, pinnedTileTokens = []) => {
    const routeCursor = track.RoutePosition({
      edgeId: tile.edgeIds[0],
      edgeS: 10,
      tileIndex: tile.index,
      entryPort: tile.entryPort
    });
    const origin = track.sampleRouteCursor(routeCursor, 0, {});
    pool.update({
      origin,
      visibilityOrigin: { x: tile.centerX, z: tile.centerZ },
      pathPlan,
      routeCursor,
      pinnedTileTokens
    });
  };
  const runNextBuildSlice = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Staged pin-priority fixture ran out of scheduled build work');
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
  };
  const buildUntil = (tile, predicate, pinnedTileTokens = [], maximumSlices = 48) => {
    updateAt(tile, pinnedTileTokens);
    for (let slice = 0; slice < maximumSlices && !predicate(); slice++) {
      runNextBuildSlice();
      updateAt(tile, pinnedTileTokens);
    }
    check(predicate(), 'Staged pin-priority fixture exceeded its bounded build window', {
      tile: tile.token,
      diagnostics: pool.getDiagnostics()
    });
  };

  const openingTile = tileAt(0);
  const sourceTile = tileAt(1);
  const landingTile = tileAt(2);
  const currentTile = tileAt(3);
  const nextTile = tileAt(4);
  check(
    [openingTile, sourceTile, landingTile, currentTile, nextTile].every(Boolean),
    'Staged pin-priority itinerary did not expose the required five-tile horizon'
  );
  buildUntil(openingTile, () => (
    [openingTile, sourceTile, landingTile].every((tile) => (
      pool.getDiagnostics().tiles.some((resident) => resident.token === tile.token)
    ))
  ));
  const corridorPins = [openingTile.token, sourceTile.token];
  buildUntil(currentTile, () => (
    pool.getDiagnostics().tiles.some((resident) => resident.token === currentTile.token)
  ), corridorPins);
  let diagnostics = pool.getDiagnostics();
  const activeEdgeCount = diagnostics.activeTokens.reduce((count, token) => (
    count + diagnostics.tiles.find((resident) => resident.token === token).edgeCount
  ), 0);
  check(
    diagnostics.activeTokens.join('|')
      === [currentTile.token, openingTile.token, sourceTile.token].join('|')
      && diagnostics.pinnedVisibleTokens.join('|') === corridorPins.join('|')
      && diagnostics.initialNextReady === false
      && diagnostics.warmBuildPending === false
      && diagnostics.poolSize === diagnostics.maxTiles
      && diagnostics.maxTiles === 3
      && !diagnostics.tiles.some((resident) => resident.token === nextTile.token)
      && diagnostics.visibleEdgeCount === activeEdgeCount,
    'Missing next road displaced a physical corridor pin instead of waiting for a free resident slot',
    diagnostics
  );
  check(
    corridorPins.every((token) => visuals.get(token)?.visible === true),
    'A retained staged corridor pin was hidden while all three authority slots were occupied',
    corridorPins.map((token) => ({ token, visible: visuals.get(token)?.visible }))
  );

  const criticalBuildsBeforeRelease = diagnostics.criticalBuildCount;
  buildUntil(currentTile, () => (
    pool.getDiagnostics().tiles.some((resident) => resident.token === nextTile.token)
  ), [openingTile.token]);
  diagnostics = pool.getDiagnostics();
  const finalActiveEdgeCount = diagnostics.activeTokens.reduce((count, token) => (
    count + diagnostics.tiles.find((resident) => resident.token === token).edgeCount
  ), 0);
  check(
    diagnostics.activeTokens.join('|')
      === [currentTile.token, openingTile.token, nextTile.token].join('|')
      && diagnostics.pinnedVisibleTokens.join('|') === openingTile.token
      && diagnostics.initialNextReady === true
      && diagnostics.poolSize === diagnostics.maxTiles
      && diagnostics.maxTiles === 3
      && diagnostics.criticalBuildCount === criticalBuildsBeforeRelease + 1
      && diagnostics.lastCriticalTileToken === nextTile.token
      && diagnostics.visibleEdgeCount === finalActiveEdgeCount,
    'Released authority slot did not atomically admit the critical next road inside maxTiles=3',
    diagnostics
  );
  check(
    visuals.get(sourceTile.token)?.disposed === true
      && visuals.get(nextTile.token)?.visible === true,
    'Critical next-road publication did not evict only the released source resident',
    {
      releasedSourceDisposed: visuals.get(sourceTile.token)?.disposed,
      nextVisible: visuals.get(nextTile.token)?.visible
    }
  );
  pool.dispose();
  return {
    retainedPins: corridorPins.length,
    deferredNextTileToken: nextTile.token,
    strictPoolSize: diagnostics.poolSize,
    criticalAfterRelease: true
  };
}

/** Preserve the last complete road while a production-style sliced builder finishes the newly current tile. */
function validateStagedRoadContinuityHandoff() {
  const idleTasks = new Map();
  const visuals = new Map();
  let idleSerial = 0;
  let fakeNow = 0;
  let sourceToken = null;
  const visualFactory = {
    create() {
      throw new Error('Runtime continuity fixture must not fall back to a synchronous road build');
    },
    createBuildJob({ track: scopedTrack }) {
      const token = scopedTrack.graph.tile.token;
      let steps = 0;
      const targetSteps = token === sourceToken ? 1 : 36;
      return {
        step() {
          steps++;
          return steps >= targetSteps;
        },
        finish() {
          const visual = {
            visible: false,
            diagnostics: Object.freeze({ edgeCount: scopedTrack.graph.edges.length }),
            update(payload = {}) { this.visible = payload.visible !== false; },
            setPalette() {},
            dispose() { this.disposed = true; }
          };
          visuals.set(token, visual);
          return visual;
        },
        cancel() {}
      };
    }
  };
  const pool = tilePool.create({
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
    now() { fakeNow += 0.2; return fakeNow; }
  });
  const runNextBuildSlice = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Runtime continuity fixture ran out of critical build work');
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
  };
  const pathPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const sourceTile = pathPlan.tiles[0];
  const destinationTile = pathPlan.tiles[1];
  sourceToken = sourceTile.token;
  const sourceCursor = track.getInitialRouteCursor({ pathPlan });
  const sourceOrigin = track.sampleRouteCursor(sourceCursor, 0, {});
  pool.update({ origin: sourceOrigin, pathPlan, routeCursor: sourceCursor });
  runNextBuildSlice();
  pool.update({ origin: sourceOrigin, pathPlan, routeCursor: sourceCursor });
  check(
    pool.getDiagnostics().activeTokens.join('|') === sourceTile.token,
    'Runtime continuity fixture did not publish its first complete road'
  );

  const destinationCursor = track.RoutePosition({
    edgeId: destinationTile.edgeIds[0],
    edgeS: 10,
    tileIndex: destinationTile.index,
    entryPort: destinationTile.entryPort
  });
  const destinationOrigin = track.sampleRouteCursor(destinationCursor, 0, {});
  pool.update({ origin: destinationOrigin, pathPlan, routeCursor: destinationCursor });
  let diagnostics = pool.getDiagnostics();
  check(
    diagnostics.activeTokens.join('|') === sourceTile.token
      && diagnostics.continuityHeldTokens.join('|') === sourceTile.token
      && visuals.get(sourceTile.token)?.visible === true,
    'Incomplete current resident cleared the last complete road presentation',
    diagnostics
  );
  const pendingMapGraph = pool.getActiveMapGraph(destinationOrigin, {
    maximumDistance: 900,
    pathPlan,
    routeCursor: destinationCursor
  });
  check(
    pendingMapGraph?.tileTokens[0] === destinationTile.token
      && pendingMapGraph.contract.currentRouteFallback === true
      && pendingMapGraph.contract.residentVisualMissing === true,
    'Map did not retain the authoritative current route during the 3D continuity handoff',
    pendingMapGraph?.contract
  );

  for (let slice = 0; slice < 48; slice++) {
    if (pool.getDiagnostics().tiles.some((tile) => tile.token === destinationTile.token)) break;
    runNextBuildSlice();
  }
  check(
    pool.getDiagnostics().tiles.some((tile) => tile.token === destinationTile.token),
    'Sliced current road did not finish inside the deterministic critical-build window',
    pool.getDiagnostics()
  );
  pool.update({ origin: destinationOrigin, pathPlan, routeCursor: destinationCursor });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.activeTokens[0] === destinationTile.token
      && diagnostics.continuityHeldTokens.length === 0
      && visuals.get(destinationTile.token)?.visible === true
      && diagnostics.cameraRetainedPreviousTokens.includes(sourceTile.token)
      && visuals.get(sourceTile.token)?.visible === true,
    'Completed current road did not atomically transfer the old scene from continuity to camera retention',
    diagnostics
  );
  const sourceVisibilityBounds = pool.graphForTile(sourceTile, pathPlan).bounds;
  pool.update({
    origin: destinationOrigin,
    visibilityOrigin: {
      x: sourceVisibilityBounds.maxX + 2_801,
      z: (sourceVisibilityBounds.minZ + sourceVisibilityBounds.maxZ) * 0.5
    },
    pathPlan,
    routeCursor: destinationCursor
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.cameraRetainedPreviousTokens.length === 0
      && visuals.get(sourceTile.token)?.visible === false,
    'Completed previous scene survived after the camera left its retention envelope',
    diagnostics
  );
  pool.dispose();
  return {
    sourceTileToken: sourceTile.token,
    destinationTileToken: destinationTile.token,
    retainedWhilePending: true,
    authoritativeMapFallback: true,
    atomicReplacement: true
  };
}

/** Prove the opening current/next route is built in bounded slices and published only when complete. */
function validateStagedTileBuild() {
  const idleTasks = new Map();
  const idleTimeouts = [];
  const stepBudgets = [];
  const startedTokens = [];
  const visuals = new Map();
  let idleSerial = 0;
  let fakeNow = 0;
  let finishCount = 0;
  let synchronousCreateCount = 0;
  const makeVisual = (scopedTrack) => {
    const token = scopedTrack.graph.tile.token;
    const visual = {
      visible: true,
      diagnostics: Object.freeze({ edgeCount: scopedTrack.graph.edges.length }),
      update(payload = {}) { this.visible = payload.visible !== false; },
      setPalette() {},
      dispose() { this.disposed = true; }
    };
    visuals.set(token, visual);
    return visual;
  };
  const visualFactory = {
    create() {
      synchronousCreateCount++;
      throw new Error('Opening route must not use the synchronous visual factory');
    },
    createBuildJob({ track: scopedTrack }) {
      const token = scopedTrack.graph.tile.token;
      startedTokens.push(token);
      let completedSteps = 0;
      return {
        step(budgetMs) {
          stepBudgets.push(budgetMs);
          completedSteps++;
          return completedSteps === 3;
        },
        finish() {
          check(completedSteps === 3, 'Staged visual finished before all steps completed', completedSteps);
          finishCount++;
          return makeVisual(scopedTrack);
        },
        cancel() {}
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    prepareRecoveryVariants: false,
    requestIdleCallback(callback, options = {}) {
      const id = ++idleSerial;
      idleTimeouts.push(options.timeout);
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 0.25; return fakeNow; }
  });
  const pathPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const cursor = track.getInitialRouteCursor({ pathPlan });
  const origin = track.sampleRouteCursor(cursor, 0, {});
  pool.update({ origin, pathPlan, routeCursor: cursor });
  let diagnostics = pool.getDiagnostics();
  check(synchronousCreateCount === 0, 'Opening route drained the synchronous visual factory');
  check(diagnostics.foregroundBuildCount === 0 && diagnostics.criticalBuildCount === 0,
    'Opening route published a visual before its first staged slice', diagnostics);
  check(diagnostics.poolSize === 0 && diagnostics.activeTokens.length === 0,
    'Opening route exposed an incomplete resident', diagnostics);
  check(diagnostics.initialRouteReady === false && pool.isInitialRouteReady() === false,
    'Opening route reported ready before either critical tile existed', diagnostics);
  check(diagnostics.warmupScheduled === true, 'Opening current tile did not schedule staged work', diagnostics);

  let callbackCount = 0;
  let currentPublished = false;
  while (finishCount < 2 && callbackCount < 12) {
    callbackCount++;
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Staged builder did not schedule its next idle slice', { callbackCount });
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
    diagnostics = pool.getDiagnostics();
    if (diagnostics.criticalBuildCount === 0) {
      check(diagnostics.warmBuildCount === 0 && diagnostics.poolSize === 0,
        'Partial current visual became resident before atomic finish', { callbackCount, diagnostics });
      check(diagnostics.warmBuildPending === true, 'Partial visual lost its resumable build state', diagnostics);
    }
    if (diagnostics.criticalBuildCount === 1 && !currentPublished) {
      check(startedTokens[0] === pathPlan.tiles[0].token,
        'Opening current tile was not the first staged target', startedTokens);
      check(diagnostics.criticalBuildCount === 1 && diagnostics.poolSize === 1,
        'Completed current tile was not atomically registered', diagnostics);
      check(diagnostics.initialCurrentReady === true && diagnostics.initialNextReady === false,
        'Current completion incorrectly published full opening readiness', diagnostics);
      check(visuals.get(pathPlan.tiles[0].token)?.visible === false,
        'Completed current tile became visible before the pool update boundary');
      pool.update({ origin, pathPlan, routeCursor: cursor });
      diagnostics = pool.getDiagnostics();
      currentPublished = true;
      check(diagnostics.activeTokens.join('|') === pathPlan.tiles[0].token,
        'Completed current tile did not activate atomically on the next pool update', diagnostics);
    } else if (diagnostics.criticalBuildCount === 1) {
      check(diagnostics.poolSize === 1 && diagnostics.warmBuildPending === true,
        'Partial next visual became resident before atomic finish', { callbackCount, diagnostics });
    }
  }
  check(startedTokens.slice(0, 2).join('|') === pathPlan.tiles.slice(0, 2).map((tile) => tile.token).join('|'),
    'Opening critical tiles were not staged current-first then next', startedTokens);
  check(diagnostics.criticalBuildCount === 2 && diagnostics.poolSize === 2,
    'Completed next tile was not atomically registered', diagnostics);
  check(diagnostics.activeTokens.length === 1 && diagnostics.initialRouteReady === true,
    'Next completion changed visibility before the following pool update', diagnostics);
  check(visuals.get(pathPlan.tiles[1].token)?.visible === false,
    'Completed next tile became visible before the pool update boundary');
  pool.update({ origin, pathPlan, routeCursor: cursor });
  diagnostics = pool.getDiagnostics();
  check(diagnostics.activeTokens.join('|') === pathPlan.tiles.slice(0, 2).map((tile) => tile.token).join('|'),
    'Opening current/next tiles did not publish together after both completed', diagnostics);
  check(diagnostics.initialRouteReady === true && pool.isInitialRouteReady() === true,
    'Opening route did not publish its lightweight ready boundary', diagnostics);
  check(diagnostics.foregroundBuildCount === 0 && diagnostics.warmBuildCount === 0,
    'Critical opening work polluted foreground or future-warm counters', diagnostics);
  check(synchronousCreateCount === 0, 'Staged opening fell back to synchronous visual creation');
  check(finishCount === 2, 'Staged visual finish was not called once per critical tile', finishCount);
  check(stepBudgets.length === 6 && stepBudgets.every((budget) => budget > 0 && budget <= 2),
    'Tile pool did not reserve callback headroom around its child builder', stepBudgets);
  check(callbackCount < 6,
    'Opening critical stages were not coalesced within their bounded callback slices', { callbackCount });
  check(idleTimeouts.slice(0, callbackCount).every((timeout) => timeout === 16),
    'Opening critical slices can be starved behind the speculative idle timeout', idleTimeouts);
  pool.dispose();
  return {
    steps: stepBudgets.length,
    callbacks: callbackCount,
    budgetMs: Math.max(...stepBudgets),
    criticalBuildCount: diagnostics.criticalBuildCount,
    synchronousCreateCount,
    initialRouteReady: diagnostics.initialRouteReady,
    atomicReveal: true
  };
}

/** Create deterministic idle/critical/retry queues around the production tile-pool state machine. */
function createWarmBuildSchedulerFixture({
  targetStepsFor,
  failStep = null,
  failFinish = null,
  failSetRenderQuality = null,
  failDisposeVisual = null,
  synchronousCritical = false,
  synchronousIdle = false,
  synchronousRetry = false
} = {}) {
  const idleTasks = new Map();
  const criticalTasks = new Map();
  const retryTasks = new Map();
  const retryDelays = [];
  const jobsByToken = new Map();
  let serial = 0;
  let fakeNow = 0;
  let createdVisualCount = 0;
  let disposedVisualCount = 0;
  let cancelledBuilderCount = 0;
  const schedule = (queue, callback, synchronous, deadline) => {
    const id = ++serial;
    if (synchronous) callback(deadline);
    else queue.set(id, callback);
    return id;
  };
  const runNext = (queue, label, deadline = { didTimeout: false, timeRemaining: () => 50 }) => {
    const entry = queue.entries().next().value;
    check(Boolean(entry), `Warm-build fixture has no scheduled ${label} callback`);
    queue.delete(entry[0]);
    return entry[1](deadline);
  };
  const visualFactory = {
    create() {
      throw new Error('Warm-build scheduler fixture must not use synchronous road construction');
    },
    createBuildJob({ track: scopedTrack }) {
      const token = scopedTrack.graph.tile.token;
      const tokenJobs = jobsByToken.get(token) || [];
      const job = {
        token,
        attempt: tokenJobs.length + 1,
        steps: 0,
        cancelled: false,
        finishedVisual: null,
        visualDisposed: false
      };
      tokenJobs.push(job);
      jobsByToken.set(token, tokenJobs);
      const targetSteps = Math.max(1, Number(targetStepsFor?.(job)) || 1);
      return {
        diagnostics: {
          get completedSteps() { return job.steps; },
          get lastStepLabel() { return `fixture-step-${job.steps}`; }
        },
        step(budgetMs) {
          check(budgetMs > 0 && budgetMs <= 2, 'Warm-build child budget escaped the 2ms contract', budgetMs);
          job.steps++;
          failStep?.(job);
          return job.steps >= targetSteps;
        },
        finish() {
          check(job.steps >= targetSteps, 'Warm-build fixture finished an incomplete builder', job);
          failFinish?.(job);
          createdVisualCount++;
          let disposed = false;
          const visual = {
            visible: false,
            diagnostics: Object.freeze({ edgeCount: scopedTrack.graph.edges.length }),
            update(payload = {}) { this.visible = payload.visible !== false; },
            setRenderQuality(id) { failSetRenderQuality?.(job, id); },
            setPalette() {},
            dispose() {
              check(!disposed, 'Warm-build fixture disposed one visual twice', token);
              disposed = true;
              job.visualDisposed = true;
              disposedVisualCount++;
              failDisposeVisual?.(job);
            }
          };
          job.finishedVisual = visual;
          return visual;
        },
        cancel() {
          if (job.cancelled) return;
          job.cancelled = true;
          cancelledBuilderCount++;
          // Production staged builders retain their finished visual until publication transfers ownership.
          if (job.finishedVisual && !job.visualDisposed) job.finishedVisual.dispose();
        }
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    prepareRecoveryVariants: false,
    requestIdleCallback(callback) {
      return schedule(
        idleTasks,
        callback,
        synchronousIdle,
        { didTimeout: false, timeRemaining: () => 50 }
      );
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    requestCriticalCallback(callback) {
      return schedule(
        criticalTasks,
        callback,
        synchronousCritical,
        { didTimeout: true, timeRemaining: () => 4 }
      );
    },
    cancelCriticalCallback(id) { criticalTasks.delete(id); },
    requestRetryCallback(callback, delayMs) {
      retryDelays.push(delayMs);
      return schedule(retryTasks, callback, synchronousRetry, undefined);
    },
    cancelRetryCallback(id) { retryTasks.delete(id); },
    now() { fakeNow += 0.01; return fakeNow; }
  });
  return {
    pool,
    idleTasks,
    criticalTasks,
    retryTasks,
    retryDelays,
    jobsByToken,
    runIdle() { return runNext(idleTasks, 'idle'); },
    runCritical() { return runNext(criticalTasks, 'critical'); },
    runRetry() { return runNext(retryTasks, 'retry', null); },
    runNextScheduled() {
      if (criticalTasks.size) return runNext(criticalTasks, 'critical');
      if (idleTasks.size) return runNext(idleTasks, 'idle');
      if (retryTasks.size) return runNext(retryTasks, 'retry', null);
      return false;
    },
    get createdVisualCount() { return createdVisualCount; },
    get disposedVisualCount() { return disposedVisualCount; },
    get cancelledBuilderCount() { return cancelledBuilderCount; }
  };
}

/** A +2 warm job must keep its completed stages when route progress makes the same tile next/current. */
function validateWarmBuildCriticalPromotion() {
  let promotedToken = null;
  const fixture = createWarmBuildSchedulerFixture({
    targetStepsFor(job) { return job.token === promotedToken ? 60 : 1; }
  });
  const { pool } = fixture;
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const openingCursor = track.getInitialRouteCursor({ pathPlan });
  track.ensureItineraryHorizon(pathPlan, openingCursor, 5);
  const [openingTile, nextTile, warmTile] = pathPlan.tiles;
  promotedToken = warmTile.token;
  const cursorFor = (tile) => track.RoutePosition({
    edgeId: tile.edgeIds[0],
    edgeS: 10,
    tileIndex: tile.index,
    entryPort: tile.entryPort
  });
  const updateAt = (tile) => {
    const routeCursor = cursorFor(tile);
    const origin = track.sampleRouteCursor(routeCursor, 0, {});
    pool.update({ origin, visibilityOrigin: origin, pathPlan, routeCursor });
    return { origin, routeCursor };
  };

  updateAt(openingTile);
  fixture.runCritical();
  fixture.runCritical();
  updateAt(openingTile);
  check(fixture.idleTasks.size === 1, 'Completed opening pair did not queue the +2 warm builder');
  fixture.runIdle();
  const warmJob = fixture.jobsByToken.get(warmTile.token)?.[0];
  check(warmJob?.steps === 1, 'Speculative +2 builder did not retain one completed warm stage', warmJob);
  check(fixture.idleTasks.size === 1, 'Partial +2 builder did not schedule its next idle slice');
  const staleIdleEntry = fixture.idleTasks.entries().next().value;
  fixture.idleTasks.delete(staleIdleEntry[0]);

  updateAt(nextTile);
  let diagnostics = pool.getDiagnostics();
  check(
    fixture.idleTasks.size === 0
      && fixture.criticalTasks.size === 1
      && diagnostics.warmBuildPendingTarget?.tileToken === warmTile.token
      && diagnostics.warmBuildPendingTarget?.buildSource === 'critical'
      && diagnostics.warmBuildPriorityPromotionCount === 1
      && diagnostics.lastWarmBuildPriorityPromotion?.completedSteps === 1,
    'Next-road promotion restarted the builder or left its callback behind the idle queue',
    diagnostics
  );
  const beforeStaleIdle = JSON.stringify(diagnostics);
  staleIdleEntry[1]({ didTimeout: false, timeRemaining: () => 50 });
  const afterStaleIdle = pool.getDiagnostics();
  check(
    warmJob.steps === 1
      && fixture.criticalTasks.size === 1
      && JSON.stringify(afterStaleIdle) === beforeStaleIdle,
    'Dequeued warm callback advanced the promoted builder or duplicated its critical schedule',
    afterStaleIdle
  );
  const stepsBeforeCriticalSlice = warmJob.steps;
  fixture.runCritical();
  check(
    warmJob.steps - stepsBeforeCriticalSlice === 12
      && fixture.jobsByToken.get(warmTile.token).length === 1,
    'Promoted builder did not consume the bounded 12-step critical slice in place',
    { stepsBeforeCriticalSlice, stepsAfter: warmJob.steps }
  );

  const currentFrame = updateAt(warmTile);
  const degradedMap = pool.getActiveMapGraph(currentFrame.origin, {
    maximumDistance: 900,
    pathPlan,
    routeCursor: currentFrame.routeCursor
  });
  check(
    degradedMap?.contract.presentationDegraded === true
      && degradedMap.contract.presentationDegradationReason === 'current-road-resident-missing'
      && degradedMap.contract.residentVisualMissing === true,
    'Current-road map fallback did not diagnose the missing 3D resident as presentation degradation',
    degradedMap?.contract
  );
  for (let callback = 0; callback < 8; callback++) {
    if (pool.getDiagnostics().tiles.some((tile) => tile.token === warmTile.token)) break;
    fixture.runCritical();
  }
  check(
    pool.getDiagnostics().tiles.some((tile) => tile.token === warmTile.token),
    'Promoted +2/current builder did not finish inside its bounded critical window',
    pool.getDiagnostics()
  );
  updateAt(warmTile);
  diagnostics = pool.getDiagnostics();
  const recoveredMap = pool.getActiveMapGraph(currentFrame.origin, {
    maximumDistance: 900,
    pathPlan,
    routeCursor: currentFrame.routeCursor
  });
  check(
    recoveredMap?.contract.presentationDegraded === false
      && recoveredMap.contract.presentationDegradationReason === null
      && diagnostics.roadPresentationDegraded === false
      && diagnostics.poolSize <= diagnostics.maxTiles,
    'Completed promoted road did not clear fallback degradation inside the strict pool',
    { map: recoveredMap?.contract, diagnostics }
  );
  pool.dispose();
  return {
    tileToken: warmTile.token,
    preservedBuilderCount: fixture.jobsByToken.get(warmTile.token).length,
    promotedCriticalSteps: 12,
    priorityPromotions: diagnostics.warmBuildPriorityPromotionCount,
    degradationCleared: true
  };
}

/** One transient builder exception must cancel corrupt state, retain its original diagnostic, and rebuild once. */
function validateWarmBuildTransientRecovery() {
  const originalError = new Error('injected-transient-road-builder-failure');
  let failureInjected = false;
  let currentToken = null;
  const fixture = createWarmBuildSchedulerFixture({
    failStep(job) {
      if (job.token === currentToken && !failureInjected) {
        failureInjected = true;
        throw originalError;
      }
    }
  });
  const { pool } = fixture;
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  currentToken = pathPlan.tiles[0].token;
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  pool.update({ origin, pathPlan, routeCursor });
  fixture.runCritical();
  let diagnostics = pool.getDiagnostics();
  check(
    diagnostics.warmBuildFailureCount === 1
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.warmBuildRetryPending === true
      && diagnostics.warmupScheduled === true
      && diagnostics.warmupScheduleKind === 'retry-backoff'
      && diagnostics.currentRoadBuildProtected === true
      && diagnostics.lastWarmBuildFailure?.message === originalError.message
      && diagnostics.lastWarmBuildFailure?.stack === originalError.stack
      && fixture.cancelledBuilderCount === 1,
    'Transient builder failure was not captured and rescheduled through bounded backoff',
    diagnostics
  );
  fixture.runRetry();
  fixture.runCritical();
  pool.update({ origin, pathPlan, routeCursor });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.tiles.some((tile) => tile.token === currentToken)
      && fixture.jobsByToken.get(currentToken).length === 2
      && diagnostics.warmBuildFailureCount === 1
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.warmBuildRecoveryCount === 1
      && diagnostics.warmBuildRetryExhaustedCount === 0
      && diagnostics.warmBuildRetryPending === false
      && diagnostics.lastWarmBuildFailure?.recovered === true,
    'Transient builder retry did not publish one recovered current road',
    diagnostics
  );
  check(
    fixture.retryDelays.length === 1
      && fixture.retryDelays[0] > 0
      && fixture.retryDelays[0] <= 32,
    'Transient builder retry did not retain its first bounded delay',
    fixture.retryDelays
  );
  pool.dispose();
  return {
    attempts: fixture.jobsByToken.get(currentToken).length,
    retries: diagnostics.warmBuildRetryCount,
    recoveries: diagnostics.warmBuildRecoveryCount,
    originalDiagnosticPreserved: true
  };
}

/** Persistent corruption gets exactly two retries, then rethrows the first error with no live cache or loop. */
function validateWarmBuildPersistentFailureBoundary() {
  const originalError = new Error('injected-persistent-road-builder-first-failure');
  let currentToken = null;
  const fixture = createWarmBuildSchedulerFixture({
    failStep(job) {
      if (job.token !== currentToken) return;
      if (job.attempt === 1) throw originalError;
      throw new Error(`injected-persistent-road-builder-retry-${job.attempt}`);
    }
  });
  const { pool } = fixture;
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  currentToken = pathPlan.tiles[0].token;
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  pool.update({ origin, pathPlan, routeCursor });
  let escapedError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fixture.runCritical();
    } catch (error) {
      escapedError = error;
    }
    if (attempt < 3) {
      check(escapedError === null, 'Persistent builder escaped before its bounded retries were consumed');
      fixture.runRetry();
    }
  }
  const diagnostics = pool.getDiagnostics();
  check(
    escapedError === originalError
      && fixture.jobsByToken.get(currentToken).length === 3
      && fixture.cancelledBuilderCount === 3
      && diagnostics.warmBuildFailureCount === 3
      && diagnostics.warmBuildRetryCount === 2
      && diagnostics.warmBuildRecoveryCount === 0
      && diagnostics.warmBuildRetryExhaustedCount === 1
      && diagnostics.warmBuildRetryPending === false
      && diagnostics.warmBuildPending === false
      && diagnostics.warmupScheduled === false
      && diagnostics.poolSize === 0
      && diagnostics.lastWarmBuildFailure?.message === originalError.message
      && diagnostics.lastWarmBuildFailure?.exhausted === true
      && fixture.idleTasks.size === 0
      && fixture.criticalTasks.size === 0
      && fixture.retryTasks.size === 0,
    'Persistent builder failure did not fail closed through the existing outer error boundary',
    diagnostics
  );
  check(
    fixture.retryDelays.length === 2
      && fixture.retryDelays[0] > 0
      && fixture.retryDelays[1] > fixture.retryDelays[0]
      && fixture.retryDelays[1] <= 64,
    'Persistent builder retries did not apply bounded exponential backoff',
    fixture.retryDelays
  );
  pool.dispose();
  return {
    attempts: fixture.jobsByToken.get(currentToken).length,
    retries: diagnostics.warmBuildRetryCount,
    exhausted: diagnostics.warmBuildRetryExhaustedCount,
    originalErrorRethrown: escapedError === originalError,
    retainedResources: fixture.createdVisualCount - fixture.disposedVisualCount
  };
}

/** A finish exception releases the damaged job once, then the same live current road rebuilds successfully. */
function validateWarmBuildFinishFailureCleanup() {
  const originalError = new Error('injected-road-builder-finish-failure');
  let currentToken = null;
  let failed = false;
  const fixture = createWarmBuildSchedulerFixture({
    failFinish(job) {
      if (job.token === currentToken && !failed) {
        failed = true;
        throw originalError;
      }
    }
  });
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  currentToken = pathPlan.tiles[0].token;
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  fixture.pool.update({ origin, pathPlan, routeCursor });
  fixture.runCritical();
  let diagnostics = fixture.pool.getDiagnostics();
  check(
    fixture.cancelledBuilderCount === 1
      && fixture.createdVisualCount === 0
      && diagnostics.warmBuildFailureCount === 1
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.lastWarmBuildFailure?.stage === 'finish-tile-build',
    'Builder finish failure did not release its job and enter bounded recovery',
    diagnostics
  );
  fixture.runRetry();
  fixture.runCritical();
  fixture.pool.update({ origin, pathPlan, routeCursor });
  diagnostics = fixture.pool.getDiagnostics();
  check(
    fixture.jobsByToken.get(currentToken).length === 2
      && fixture.createdVisualCount === 1
      && fixture.disposedVisualCount === 0
      && diagnostics.warmBuildRecoveryCount === 1
      && diagnostics.tiles.some((tile) => tile.token === currentToken),
    'Finish retry did not publish exactly one replacement visual',
    diagnostics
  );
  fixture.pool.dispose();
  check(
    fixture.createdVisualCount === 1 && fixture.disposedVisualCount === 1,
    'Finish-failure recovery leaked or double-disposed its published visual'
  );
  return {
    attempts: 2,
    cancelledJobs: fixture.cancelledBuilderCount,
    createdVisuals: fixture.createdVisualCount,
    disposedVisuals: fixture.disposedVisualCount
  };
}

/** A post-finish quality exception remains builder-owned until cancel, with no orphan or second dispose. */
function validateWarmBuildQualityFailureCleanup() {
  const originalError = new Error('injected-road-visual-quality-failure');
  let currentToken = null;
  let failed = false;
  const fixture = createWarmBuildSchedulerFixture({
    failSetRenderQuality(job) {
      if (job.token === currentToken && !failed) {
        failed = true;
        throw originalError;
      }
    }
  });
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  currentToken = pathPlan.tiles[0].token;
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  fixture.pool.update({ origin, pathPlan, routeCursor });
  fixture.runCritical();
  let diagnostics = fixture.pool.getDiagnostics();
  check(
    fixture.createdVisualCount === 1
      && fixture.disposedVisualCount === 1
      && fixture.cancelledBuilderCount === 1
      && diagnostics.poolSize === 0
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.lastWarmBuildFailure?.stage === 'register-tile-record',
    'setRenderQuality failure orphaned its completed visual or bypassed retry',
    diagnostics
  );
  fixture.runRetry();
  fixture.runCritical();
  fixture.pool.update({ origin, pathPlan, routeCursor });
  diagnostics = fixture.pool.getDiagnostics();
  check(
    fixture.createdVisualCount === 2
      && fixture.disposedVisualCount === 1
      && fixture.jobsByToken.get(currentToken).length === 2
      && diagnostics.poolSize === 1
      && diagnostics.warmBuildRecoveryCount === 1,
    'Quality retry did not leave exactly one resident visual',
    diagnostics
  );
  fixture.pool.dispose();
  check(
    fixture.createdVisualCount === fixture.disposedVisualCount,
    'Quality failure cleanup did not release both completed visuals exactly once'
  );
  return {
    attempts: 2,
    beforeDispose: Object.freeze({ created: 2, disposed: 1, resident: 1 }),
    afterDispose: Object.freeze({ created: 2, disposed: 2, resident: 0 })
  };
}

/** Replacement disposal failure removes the old authority first and never retries its non-idempotent disposer. */
function validateWarmBuildReplacementFailureCleanup() {
  const replacementError = new Error('injected-old-road-replacement-dispose-failure');
  let revisedToken = null;
  let oldDisposeFailed = false;
  const fixture = createWarmBuildSchedulerFixture({
    failDisposeVisual(job) {
      if (job.token === revisedToken && job.attempt === 1 && !oldDisposeFailed) {
        oldDisposeFailed = true;
        throw replacementError;
      }
    }
  });
  const initialPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan: initialPlan });
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  revisedToken = initialPlan.tiles[1].token;
  fixture.pool.update({ origin, pathPlan: initialPlan, routeCursor });
  fixture.runCritical();
  fixture.runCritical();
  fixture.pool.update({ origin, pathPlan: initialPlan, routeCursor });
  check(
    fixture.jobsByToken.get(revisedToken)?.length === 1,
    'Replacement fixture did not publish the opening next resident'
  );

  const revisedPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'left' });
  const recoveryEdge = revisedPlan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => edge?.runtimeKind === 'recovery' && edge.tileIndex === revisedPlan.tiles[0].index);
  check(Boolean(recoveryEdge), 'Replacement fixture omitted the recovery scheduling edge');
  const recoveryCursor = track.RoutePosition({
    edgeId: recoveryEdge.id,
    edgeS: 0,
    tileIndex: recoveryEdge.tileIndex,
    entryPort: revisedPlan.tiles[0].entryPort
  });
  const recoveryOrigin = track.sampleRouteCursor(recoveryCursor, 0, {});
  fixture.pool.update({ origin: recoveryOrigin, pathPlan: revisedPlan, routeCursor: recoveryCursor });
  fixture.runNextScheduled();
  let diagnostics = fixture.pool.getDiagnostics();
  check(
    oldDisposeFailed
      && fixture.jobsByToken.get(revisedToken).length === 2
      && fixture.createdVisualCount === 3
      && fixture.disposedVisualCount === 2
      && fixture.cancelledBuilderCount === 1
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.lastWarmBuildFailure?.stage === 'register-tile-record'
      && !diagnostics.tiles.some((tile) => tile.token === revisedToken),
    'Replacement failure retained a disposed authority or leaked the incoming visual',
    diagnostics
  );
  fixture.runRetry();
  fixture.runNextScheduled();
  fixture.pool.update({ origin: recoveryOrigin, pathPlan: revisedPlan, routeCursor: recoveryCursor });
  diagnostics = fixture.pool.getDiagnostics();
  check(
    fixture.jobsByToken.get(revisedToken).length === 3
      && fixture.createdVisualCount === 4
      && fixture.disposedVisualCount === 2
      && diagnostics.poolSize === 2
      && diagnostics.warmBuildRecoveryCount === 1
      && diagnostics.tiles.some((tile) => tile.token === revisedToken),
    'Replacement retry did not publish one clean resident without redisposing the old visual',
    diagnostics
  );
  fixture.pool.dispose();
  check(
    fixture.createdVisualCount === 4 && fixture.disposedVisualCount === 4,
    'Replacement lifecycle did not release all four visuals exactly once'
  );
  return {
    revisedAttempts: 3,
    cancelledIncomingBuilders: 1,
    beforeDispose: Object.freeze({ created: 4, disposed: 2, resident: 2 }),
    afterDispose: Object.freeze({ created: 4, disposed: 4, resident: 0 })
  };
}

/** A dequeued callback cannot resurrect work after pool disposal. */
function validateDisposedLateWarmupCallback() {
  const fixture = createWarmBuildSchedulerFixture();
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  fixture.pool.update({ origin, pathPlan, routeCursor });
  const entry = fixture.criticalTasks.entries().next().value;
  check(Boolean(entry), 'Late-callback fixture did not queue its opening critical callback');
  fixture.criticalTasks.delete(entry[0]);
  fixture.pool.dispose();
  const beforeLateCallback = fixture.pool.getDiagnostics();
  entry[1]({ didTimeout: true, timeRemaining: () => 0 });
  const afterLateCallback = fixture.pool.getDiagnostics();
  check(
    fixture.jobsByToken.size === 0
      && fixture.createdVisualCount === 0
      && fixture.disposedVisualCount === 0
      && fixture.cancelledBuilderCount === 0
      && JSON.stringify(afterLateCallback) === JSON.stringify(beforeLateCallback),
    'Dequeued callback created resources or mutated a disposed pool',
    afterLateCallback
  );
  return Object.freeze({ jobs: 0, createdVisuals: 0, publishedResidents: 0, diagnosticsMutations: 0 });
}

/** Old critical, idle, and retry callbacks cannot consume a new route generation or clear its current handle. */
function validateWarmupEpochIsolation() {
  const routeFrame = (pathPlan) => {
    const routeCursor = track.getInitialRouteCursor({ pathPlan });
    return Object.freeze({
      routeCursor,
      origin: track.sampleRouteCursor(routeCursor, 0, {})
    });
  };
  const totalJobs = (fixture) => [...fixture.jobsByToken.values()].reduce(
    (count, jobs) => count + jobs.length,
    0
  );

  const criticalFixture = createWarmBuildSchedulerFixture();
  const oldCriticalPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const oldCriticalFrame = routeFrame(oldCriticalPlan);
  criticalFixture.pool.update({ ...oldCriticalFrame, pathPlan: oldCriticalPlan });
  const oldCriticalEntry = criticalFixture.criticalTasks.entries().next().value;
  check(Boolean(oldCriticalEntry), 'Epoch fixture omitted the old critical callback');
  criticalFixture.criticalTasks.delete(oldCriticalEntry[0]);
  criticalFixture.pool.update({ origin: oldCriticalFrame.origin, pathPlan: { tiles: [] }, routeCursor: null });
  const newCriticalPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'left' });
  const newCriticalFrame = routeFrame(newCriticalPlan);
  criticalFixture.pool.update({ ...newCriticalFrame, pathPlan: newCriticalPlan });
  const criticalBeforeOld = criticalFixture.pool.getDiagnostics();
  const criticalHandleCount = criticalFixture.criticalTasks.size;
  oldCriticalEntry[1]({ didTimeout: true, timeRemaining: () => 0 });
  const criticalAfterOld = criticalFixture.pool.getDiagnostics();
  check(
    totalJobs(criticalFixture) === 0
      && criticalHandleCount === 1
      && criticalFixture.criticalTasks.size === 1
      && JSON.stringify(criticalAfterOld) === JSON.stringify(criticalBeforeOld),
    'Old critical callback consumed or cleared the new route generation',
    criticalAfterOld
  );
  criticalFixture.runCritical();
  criticalFixture.pool.update({ ...newCriticalFrame, pathPlan: newCriticalPlan });
  check(
    totalJobs(criticalFixture) === 1
      && criticalFixture.pool.getDiagnostics().tiles.some((tile) => tile.token === newCriticalPlan.tiles[0].token),
    'New critical callback did not complete after the stale callback was rejected'
  );
  criticalFixture.pool.dispose();

  const idleFixture = createWarmBuildSchedulerFixture();
  const oldIdlePlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const oldIdleFrame = routeFrame(oldIdlePlan);
  idleFixture.pool.update({ ...oldIdleFrame, pathPlan: oldIdlePlan });
  idleFixture.runCritical();
  idleFixture.runCritical();
  idleFixture.pool.update({ ...oldIdleFrame, pathPlan: oldIdlePlan });
  const oldIdleEntry = idleFixture.idleTasks.entries().next().value;
  check(Boolean(oldIdleEntry), 'Epoch fixture omitted the old idle callback');
  idleFixture.idleTasks.delete(oldIdleEntry[0]);
  idleFixture.pool.update({ origin: oldIdleFrame.origin, pathPlan: { tiles: [] }, routeCursor: null });
  const newIdlePlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const newIdleFrame = routeFrame(newIdlePlan);
  idleFixture.pool.update({ ...newIdleFrame, pathPlan: newIdlePlan });
  const idleBeforeOld = idleFixture.pool.getDiagnostics();
  const idleJobsBeforeOld = totalJobs(idleFixture);
  oldIdleEntry[1]({ didTimeout: false, timeRemaining: () => 50 });
  const idleAfterOld = idleFixture.pool.getDiagnostics();
  check(
    idleJobsBeforeOld === 2
      && totalJobs(idleFixture) === 2
      && idleFixture.idleTasks.size === 1
      && JSON.stringify(idleAfterOld) === JSON.stringify(idleBeforeOld),
    'Old idle callback built a tile or cleared the new route idle handle',
    idleAfterOld
  );
  idleFixture.runIdle();
  idleFixture.pool.update({ ...newIdleFrame, pathPlan: newIdlePlan });
  check(
    totalJobs(idleFixture) === 3 && idleFixture.pool.getDiagnostics().poolSize === 3,
    'New idle callback did not complete after the stale callback was rejected'
  );
  idleFixture.pool.dispose();

  let retryCurrentToken = null;
  const retryFixture = createWarmBuildSchedulerFixture({
    failStep(job) {
      if (job.token === retryCurrentToken && job.attempt <= 2) {
        throw new Error(`injected-epoch-retry-failure-${job.attempt}`);
      }
    }
  });
  const oldRetryPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const oldRetryFrame = routeFrame(oldRetryPlan);
  retryCurrentToken = oldRetryPlan.tiles[0].token;
  retryFixture.pool.update({ ...oldRetryFrame, pathPlan: oldRetryPlan });
  retryFixture.runCritical();
  const oldRetryEntry = retryFixture.retryTasks.entries().next().value;
  check(Boolean(oldRetryEntry), 'Epoch fixture omitted the old retry callback');
  retryFixture.retryTasks.delete(oldRetryEntry[0]);
  retryFixture.pool.update({ origin: oldRetryFrame.origin, pathPlan: { tiles: [] }, routeCursor: null });
  const newRetryPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'left' });
  const newRetryFrame = routeFrame(newRetryPlan);
  retryFixture.pool.update({ ...newRetryFrame, pathPlan: newRetryPlan });
  retryFixture.runCritical();
  const retryBeforeOld = retryFixture.pool.getDiagnostics();
  check(retryFixture.retryTasks.size === 1, 'New route did not own its independent retry handle');
  oldRetryEntry[1]();
  const retryAfterOld = retryFixture.pool.getDiagnostics();
  check(
    totalJobs(retryFixture) === 2
      && retryFixture.retryTasks.size === 1
      && JSON.stringify(retryAfterOld) === JSON.stringify(retryBeforeOld),
    'Old retry callback cleared or consumed the new route retry handle',
    retryAfterOld
  );
  retryFixture.runRetry();
  retryFixture.runCritical();
  retryFixture.pool.update({ ...newRetryFrame, pathPlan: newRetryPlan });
  check(
    totalJobs(retryFixture) === 3
      && retryFixture.pool.getDiagnostics().tiles.some((tile) => tile.token === newRetryPlan.tiles[0].token),
    'New retry callback did not complete after the stale retry was rejected'
  );
  retryFixture.pool.dispose();

  return Object.freeze({
    critical: Object.freeze({ staleJobs: 0, preservedHandles: 1, completedJobs: 1 }),
    idle: Object.freeze({ staleJobs: 0, preservedHandles: 1, completedJobs: 1 }),
    retry: Object.freeze({ staleJobs: 0, preservedHandles: 1, completedJobs: 1 }),
    diagnosticMutations: 0
  });
}

/** Same-stack scheduler adapters must consume sentinel tickets without leaving fake handles after recursion. */
function validateSynchronousWarmupSchedulers() {
  const createRoute = () => {
    const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
    const routeCursor = track.getInitialRouteCursor({ pathPlan });
    return Object.freeze({
      pathPlan,
      routeCursor,
      origin: track.sampleRouteCursor(routeCursor, 0, {})
    });
  };
  const totalJobs = (fixture) => [...fixture.jobsByToken.values()].reduce(
    (count, jobs) => count + jobs.length,
    0
  );

  const criticalFixture = createWarmBuildSchedulerFixture({ synchronousCritical: true });
  const criticalRoute = createRoute();
  criticalFixture.pool.update(criticalRoute);
  let diagnostics = criticalFixture.pool.getDiagnostics();
  check(
    totalJobs(criticalFixture) === 2
      && diagnostics.poolSize === 2
      && diagnostics.initialRouteReady === true
      && diagnostics.warmupScheduled === true
      && diagnostics.warmupScheduleKind === 'idle'
      && criticalFixture.criticalTasks.size === 0
      && criticalFixture.idleTasks.size === 1,
    'Synchronous critical callbacks were rejected or overwrote their recursively scheduled idle successor',
    diagnostics
  );
  criticalFixture.runIdle();
  criticalFixture.pool.update(criticalRoute);
  diagnostics = criticalFixture.pool.getDiagnostics();
  check(
    totalJobs(criticalFixture) === 3
      && diagnostics.poolSize === 3
      && diagnostics.warmupScheduled === false,
    'Synchronous critical scheduling left a pseudo handle after all real work completed',
    diagnostics
  );
  criticalFixture.pool.dispose();

  const idleFixture = createWarmBuildSchedulerFixture({ synchronousIdle: true });
  const idleRoute = createRoute();
  idleFixture.pool.update(idleRoute);
  idleFixture.runCritical();
  idleFixture.runCritical();
  idleFixture.pool.update(idleRoute);
  diagnostics = idleFixture.pool.getDiagnostics();
  check(
    totalJobs(idleFixture) === 3
      && diagnostics.poolSize === 3
      && diagnostics.warmupScheduled === false
      && idleFixture.idleTasks.size === 0
      && idleFixture.criticalTasks.size === 0,
    'Synchronous idle callback was rejected or its returned handle became a permanent fake schedule',
    diagnostics
  );
  idleFixture.pool.dispose();

  let failedCurrentToken = null;
  let failureInjected = false;
  const retryFixture = createWarmBuildSchedulerFixture({
    synchronousCritical: true,
    synchronousRetry: true,
    failStep(job) {
      if (job.token === failedCurrentToken && !failureInjected) {
        failureInjected = true;
        throw new Error('injected-synchronous-retry-failure');
      }
    }
  });
  const retryRoute = createRoute();
  failedCurrentToken = retryRoute.pathPlan.tiles[0].token;
  retryFixture.pool.update(retryRoute);
  diagnostics = retryFixture.pool.getDiagnostics();
  check(
    failureInjected
      && totalJobs(retryFixture) === 3
      && retryFixture.cancelledBuilderCount === 1
      && diagnostics.poolSize === 2
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.warmBuildRecoveryCount === 1
      && diagnostics.warmBuildRetryPending === false
      && diagnostics.warmupScheduled === true
      && diagnostics.warmupScheduleKind === 'idle'
      && retryFixture.retryTasks.size === 0
      && retryFixture.criticalTasks.size === 0
      && retryFixture.idleTasks.size === 1,
    'Synchronous retry callback lost recovery work or overwrote its recursively scheduled successor',
    diagnostics
  );
  retryFixture.runIdle();
  retryFixture.pool.update(retryRoute);
  diagnostics = retryFixture.pool.getDiagnostics();
  check(
    totalJobs(retryFixture) === 4
      && diagnostics.poolSize === 3
      && diagnostics.warmupScheduled === false
      && diagnostics.warmBuildRetryPending === false,
    'Synchronous retry return installed a pseudo retry handle after recovery completed',
    diagnostics
  );
  retryFixture.pool.dispose();

  return Object.freeze({
    critical: Object.freeze({ recursiveCriticalJobs: 2, finalResidents: 3, pseudoHandles: 0 }),
    idle: Object.freeze({ synchronousIdleJobs: 1, finalResidents: 3, pseudoHandles: 0 }),
    retry: Object.freeze({ attempts: 2, recoveries: 1, finalResidents: 3, pseudoHandles: 0 })
  });
}

/** An empty route revokes a pending failure retry before its already-dequeued wake can run. */
function validateEmptyRouteCancelsFailedWarmup() {
  const injectedError = new Error('injected-failure-before-empty-route');
  let currentToken = null;
  let failed = false;
  const fixture = createWarmBuildSchedulerFixture({
    failStep(job) {
      if (job.token === currentToken && !failed) {
        failed = true;
        throw injectedError;
      }
    }
  });
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  currentToken = pathPlan.tiles[0].token;
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  fixture.pool.update({ origin, pathPlan, routeCursor });
  fixture.runCritical();
  const retryEntry = fixture.retryTasks.entries().next().value;
  check(Boolean(retryEntry), 'Failed current road did not queue its bounded retry wake');
  fixture.retryTasks.delete(retryEntry[0]);
  fixture.pool.update({ origin, pathPlan: { tiles: [] }, routeCursor: null });
  const beforeLateRetry = fixture.pool.getDiagnostics();
  retryEntry[1]();
  const afterLateRetry = fixture.pool.getDiagnostics();
  check(
    fixture.jobsByToken.get(currentToken).length === 1
      && fixture.cancelledBuilderCount === 1
      && fixture.createdVisualCount === 0
      && fixture.disposedVisualCount === 0
      && beforeLateRetry.poolSize === 0
      && beforeLateRetry.warmBuildRetryPending === false
      && beforeLateRetry.warmupScheduled === false
      && JSON.stringify(afterLateRetry) === JSON.stringify(beforeLateRetry),
    'Empty route allowed a stale retry wake to rebuild or publish the revoked road',
    afterLateRetry
  );
  fixture.pool.dispose();

  const activeFixture = createWarmBuildSchedulerFixture({ targetStepsFor() { return 48; } });
  activeFixture.pool.update({ origin, pathPlan, routeCursor });
  activeFixture.runCritical();
  const lateCriticalEntry = activeFixture.criticalTasks.entries().next().value;
  check(Boolean(lateCriticalEntry), 'Partial active builder did not queue its next critical slice');
  activeFixture.criticalTasks.delete(lateCriticalEntry[0]);
  activeFixture.pool.update({ origin, pathPlan: { tiles: [] }, routeCursor: null });
  const beforeLateCritical = activeFixture.pool.getDiagnostics();
  lateCriticalEntry[1]({ didTimeout: true, timeRemaining: () => 0 });
  const afterLateCritical = activeFixture.pool.getDiagnostics();
  check(
    activeFixture.jobsByToken.get(currentToken).length === 1
      && activeFixture.cancelledBuilderCount === 1
      && activeFixture.createdVisualCount === 0
      && beforeLateCritical.warmBuildPending === false
      && beforeLateCritical.warmupScheduled === false
      && JSON.stringify(afterLateCritical) === JSON.stringify(beforeLateCritical),
    'Empty route did not cancel its active builder or allowed the late critical slice to resume it',
    afterLateCritical
  );
  activeFixture.pool.dispose();
  return Object.freeze({
    retryAttempts: 1,
    activeAttempts: 1,
    cancelledJobs: 2,
    createdVisuals: 0,
    publishedResidents: 0
  });
}

/** Cross 120 unique route tiles while proving the visual/resource pool and scheduler state remain constant-size. */
function validateLongRunTilePoolBound() {
  const fixture = createWarmBuildSchedulerFixture();
  const { pool } = fixture;
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const openingCursor = track.getInitialRouteCursor({ pathPlan });
  track.ensureItineraryHorizon(pathPlan, openingCursor, 122);
  let maximumPoolSize = 0;
  let maximumRetainedVisuals = 0;
  for (let tileIndex = 0; tileIndex < 120; tileIndex++) {
    const tile = pathPlan.tiles.find((candidate) => candidate.index === tileIndex);
    check(Boolean(tile), 'Long-run itinerary omitted a required unique tile', tileIndex);
    const routeCursor = track.RoutePosition({
      edgeId: tile.edgeIds[0],
      edgeS: 10,
      tileIndex: tile.index,
      entryPort: tile.entryPort
    });
    const origin = track.sampleRouteCursor(routeCursor, 0, {});
    const updateCurrent = () => pool.update({
      origin,
      visibilityOrigin: { x: tile.centerX, z: tile.centerZ },
      pathPlan,
      routeCursor
    });
    updateCurrent();
    for (let work = 0; work < 12; work++) {
      if (!fixture.criticalTasks.size && !fixture.idleTasks.size && !fixture.retryTasks.size) break;
      fixture.runNextScheduled();
      updateCurrent();
    }
    const diagnostics = pool.getDiagnostics();
    const retainedVisuals = fixture.createdVisualCount - fixture.disposedVisualCount;
    maximumPoolSize = Math.max(maximumPoolSize, diagnostics.poolSize);
    maximumRetainedVisuals = Math.max(maximumRetainedVisuals, retainedVisuals);
    check(
      diagnostics.tiles.some((resident) => resident.token === tile.token)
        && diagnostics.poolSize <= 3
        && retainedVisuals === diagnostics.poolSize
        && diagnostics.warmBuildRetryPending === false
        && diagnostics.warmBuildFailureCount === 0,
      'Long-run road transition leaked resources or omitted its current resident',
      { tileIndex, retainedVisuals, diagnostics }
    );
  }
  const finalDiagnostics = pool.getDiagnostics();
  check(
    maximumPoolSize <= 3
      && maximumRetainedVisuals <= 3
      && finalDiagnostics.routeVariantRequirementCount === 0
      && finalDiagnostics.opposingBypassPreflightRetainedCount === 0,
    'Long-run tile pool retained unbounded visual or route-readiness state',
    { maximumPoolSize, maximumRetainedVisuals, finalDiagnostics }
  );
  const createdVisualCount = fixture.createdVisualCount;
  const disposedBeforePoolDispose = fixture.disposedVisualCount;
  pool.dispose();
  check(
    fixture.createdVisualCount === fixture.disposedVisualCount,
    'Long-run pool disposal left visual resources alive',
    { created: fixture.createdVisualCount, disposed: fixture.disposedVisualCount }
  );
  return {
    uniqueTiles: 120,
    maximumPoolSize,
    maximumRetainedVisuals,
    createdVisualCount,
    disposedBeforePoolDispose,
    retainedAfterDispose: fixture.createdVisualCount - fixture.disposedVisualCount
  };
}

/** Prebuild all three current-tile recovery signatures and prove commit only swaps an existing visual. */
function validateAtomicRecoveryVariants() {
  const idleTasks = new Map();
  let idleSerial = 0;
  let fakeNow = 0;
  let templateAlive = false;
  let templateBuildCount = 0;
  let templateHitCount = 0;
  let templateRefCount = 0;
  let createdVisualCount = 0;
  let disposedVisualCount = 0;

  const visualFactory = {
    create({ track: scopedTrack }) {
      if (!templateAlive) {
        templateAlive = true;
        templateBuildCount++;
      } else {
        templateHitCount++;
      }
      templateRefCount++;
      createdVisualCount++;
      let disposed = false;
      const initialSignature = scopedTrack.graph.recoveryVariantSignature;
      check(typeof initialSignature === 'string' && initialSignature.includes('|visual:'),
        'Tile graph omitted the canonical recovery/visual variant signature', scopedTrack.graph);
      const variants = new Set([initialSignature]);
      return {
        visible: true,
        diagnostics: Object.freeze({
          edgeCount: scopedTrack.graph.edges.length,
          baseTemplateBuildCount: templateBuildCount,
          baseTemplateCacheHit: templateHitCount > 0,
          get baseTemplateRefCount() { return templateRefCount; },
          get preparedRecoveryVariantCount() { return variants.size; }
        }),
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        createRecoveryVariantJob({ signature }) {
          return {
            step() { return true; },
            finish() { return { signature, template: {} }; },
            cancel() {}
          };
        },
        hasRecoveryVariant(signature) { return variants.has(signature); },
        installRecoveryVariant(variant) { variants.add(variant.signature); },
        activateRecoveryVariant(signature) { return variants.has(signature); },
        dispose() {
          check(!disposed, 'A shared-template visual was disposed twice');
          disposed = true;
          disposedVisualCount++;
          templateRefCount--;
          if (templateRefCount === 0) templateAlive = false;
        }
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    requestIdleCallback(callback) {
      const id = ++idleSerial;
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 0.2; return fakeNow; }
  });
  const initialPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const cursor = track.getInitialRouteCursor({ pathPlan: initialPlan });
  const origin = track.sampleRouteCursor(cursor, 0, {});
  pool.update({ origin, pathPlan: initialPlan, routeCursor: cursor });

  let diagnostics = pool.getDiagnostics();
  for (let step = 0; diagnostics.preparedRecoveryVariantResidentCount < 2 && step < 24; step++) {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Recovery variants stopped scheduling before all exits were prepared', diagnostics);
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
    diagnostics = pool.getDiagnostics();
  }
  check(diagnostics.preparedRecoveryVariantResidentCount === 2,
    'Current tile did not retain both alternate recovery signatures', diagnostics);
  check(diagnostics.foregroundBuildCount === 2, 'Variant preparation changed opening foreground builds', diagnostics);

  const committedPlan = track.createPathPlan({ movementId: 'south-right', futureMovementKind: 'straight' });
  const expectedGraph = tilePool.graphForTile(track, committedPlan.tiles[0], committedPlan, { includeRecovery: true });
  const expectedSignature = expectedGraph.recoveryVariantSignature;
  pool.update({ origin, pathPlan: committedPlan, routeCursor: cursor });
  diagnostics = pool.getDiagnostics();
  const activeTile = diagnostics.tiles.find((tile) => tile.token === committedPlan.tiles[0].token);
  check(diagnostics.foregroundBuildCount === 2, 'Route commit performed a foreground visual build', diagnostics);
  check(diagnostics.atomicRecoverySwitchCount === 1, 'Route commit did not atomically select a prepared recovery', diagnostics);
  check(activeTile?.signature === expectedSignature, 'Active recovery signature diverged after atomic commit', {
    actual: activeTile?.signature,
    expected: expectedSignature
  });
  const initialGraph = tilePool.graphForTile(track, initialPlan.tiles[0], initialPlan, { includeRecovery: true });
  pool.update({ origin, pathPlan: initialPlan, routeCursor: cursor });
  diagnostics = pool.getDiagnostics();
  const restoredTile = diagnostics.tiles.find((tile) => tile.token === initialPlan.tiles[0].token);
  check(diagnostics.foregroundBuildCount === 2,
    'Returning to the opening exit rebuilt a visual instead of selecting its retained variant', diagnostics);
  check(diagnostics.atomicRecoverySwitchCount === 2,
    'Returning to the opening exit did not reactivate the original paired-road variant', diagnostics);
  check(restoredTile?.signature === initialGraph.recoveryVariantSignature,
    'Returning to the opening exit retained the alternate paired-road layout', {
      actual: restoredTile?.signature,
      expected: initialGraph.recoveryVariantSignature
    });
  check(templateBuildCount === 1 && templateHitCount >= 1, 'Quality template was not shared by resident visuals', {
    templateBuildCount,
    templateHitCount
  });

  pool.dispose();
  check(templateRefCount === 0, 'Shared template references leaked after pool disposal', templateRefCount);
  check(disposedVisualCount === createdVisualCount, 'Pool disposal did not release every visual exactly once', {
    createdVisualCount,
    disposedVisualCount
  });
  return {
    foregroundBuildCount: diagnostics.foregroundBuildCount,
    preparedVariants: diagnostics.preparedRecoveryVariantResidentCount,
    atomicSwitches: diagnostics.atomicRecoverySwitchCount,
    templateBuildCount,
    templateHitCount,
    finalTemplateRefs: templateRefCount
  };
}

/** Recovery-template installation failure cancels exactly one finished job, then retries without double disposal. */
function validateRecoveryVariantInstallFailureCleanup() {
  const idleTasks = new Map();
  const criticalTasks = new Map();
  const retryTasks = new Map();
  let serial = 0;
  let fakeNow = 0;
  let baseVisualCreatedCount = 0;
  let baseVisualDisposedCount = 0;
  let variantJobCreatedCount = 0;
  let variantJobCancelledCount = 0;
  let variantArtifactCreatedCount = 0;
  let variantArtifactDisposedCount = 0;
  let installAttemptCount = 0;
  let installFailureInjected = false;
  const enqueue = (queue, callback) => {
    const id = ++serial;
    queue.set(id, callback);
    return id;
  };
  const runNext = (queue, label, deadline = { didTimeout: false, timeRemaining: () => 50 }) => {
    const entry = queue.entries().next().value;
    check(Boolean(entry), `Recovery-install fixture has no scheduled ${label} callback`);
    queue.delete(entry[0]);
    return entry[1](deadline);
  };
  const releaseVariantArtifact = (artifact) => {
    check(!artifact.disposed, 'Recovery-install fixture disposed one template twice', artifact.signature);
    artifact.disposed = true;
    variantArtifactDisposedCount++;
  };
  const visualFactory = {
    create({ track: scopedTrack }) {
      baseVisualCreatedCount++;
      let disposed = false;
      const variants = new Set([scopedTrack.graph.recoveryVariantSignature]);
      const installedArtifacts = new Map();
      return {
        visible: true,
        diagnostics: {
          edgeCount: scopedTrack.graph.edges.length,
          get preparedRecoveryVariantCount() { return variants.size; }
        },
        update(payload = {}) { this.visible = payload.visible !== false; },
        setRenderQuality() {},
        setPalette() {},
        createRecoveryVariantJob({ signature }) {
          variantJobCreatedCount++;
          let complete = false;
          let cancelled = false;
          let artifact = null;
          return {
            step() {
              complete = true;
              return true;
            },
            finish() {
              check(complete, 'Recovery-install fixture finished an incomplete variant');
              if (!artifact) {
                artifact = { signature, template: {}, disposed: false, installed: false };
                variantArtifactCreatedCount++;
              }
              return artifact;
            },
            cancel() {
              if (cancelled) return;
              cancelled = true;
              variantJobCancelledCount++;
              if (artifact && !artifact.installed && !artifact.disposed) releaseVariantArtifact(artifact);
            }
          };
        },
        hasRecoveryVariant(signature) { return variants.has(signature); },
        installRecoveryVariant(artifact) {
          installAttemptCount++;
          if (!installFailureInjected) {
            installFailureInjected = true;
            throw new Error('injected-recovery-variant-install-failure');
          }
          artifact.installed = true;
          variants.add(artifact.signature);
          installedArtifacts.set(artifact.signature, artifact);
          return true;
        },
        activateRecoveryVariant(signature) { return variants.has(signature); },
        dispose() {
          check(!disposed, 'Recovery-install fixture disposed one resident visual twice');
          disposed = true;
          baseVisualDisposedCount++;
          for (const artifact of installedArtifacts.values()) {
            if (!artifact.disposed) releaseVariantArtifact(artifact);
          }
          installedArtifacts.clear();
        }
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    requestIdleCallback(callback) { return enqueue(idleTasks, callback); },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    requestCriticalCallback(callback) { return enqueue(criticalTasks, callback); },
    cancelCriticalCallback(id) { criticalTasks.delete(id); },
    requestRetryCallback(callback) { return enqueue(retryTasks, callback); },
    cancelRetryCallback(id) { retryTasks.delete(id); },
    now() { fakeNow += 0.01; return fakeNow; }
  });
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const routeCursor = track.getInitialRouteCursor({ pathPlan });
  const origin = track.sampleRouteCursor(routeCursor, 0, {});
  pool.update({ origin, pathPlan, routeCursor });
  for (let work = 0; work < 96 && retryTasks.size === 0; work++) {
    if (criticalTasks.size) runNext(criticalTasks, 'critical');
    else if (idleTasks.size) runNext(idleTasks, 'idle');
    else break;
  }
  let diagnostics = pool.getDiagnostics();
  check(
    installFailureInjected
      && variantJobCreatedCount === 1
      && variantJobCancelledCount === 1
      && variantArtifactCreatedCount === 1
      && variantArtifactDisposedCount === 1
      && diagnostics.warmBuildFailureCount === 1
      && diagnostics.warmBuildRetryCount === 1
      && diagnostics.warmBuildRetryPending === true,
    'Recovery install failure leaked its completed template or skipped bounded retry',
    diagnostics
  );
  runNext(retryTasks, 'retry', null);
  for (let work = 0; work < 32 && pool.getDiagnostics().warmBuildRecoveryCount === 0; work++) {
    if (criticalTasks.size) runNext(criticalTasks, 'critical');
    else if (idleTasks.size) runNext(idleTasks, 'idle');
    else break;
  }
  diagnostics = pool.getDiagnostics();
  check(
    installAttemptCount === 2
      && variantJobCreatedCount === 2
      && variantJobCancelledCount === 1
      && variantArtifactCreatedCount === 2
      && variantArtifactDisposedCount === 1
      && diagnostics.warmBuildRecoveryCount === 1
      && diagnostics.preparedRecoveryVariantCount >= 1,
    'Recovery install retry did not transfer exactly one template into resident ownership',
    diagnostics
  );
  const beforeDispose = Object.freeze({
    baseCreated: baseVisualCreatedCount,
    baseDisposed: baseVisualDisposedCount,
    variantCreated: variantArtifactCreatedCount,
    variantDisposed: variantArtifactDisposedCount,
    residentVariants: variantArtifactCreatedCount - variantArtifactDisposedCount
  });
  pool.dispose();
  check(
    baseVisualCreatedCount === baseVisualDisposedCount
      && variantArtifactCreatedCount === variantArtifactDisposedCount
      && variantJobCancelledCount === 1,
    'Recovery variant lifecycle leaked or double-disposed a job/template',
    { baseVisualCreatedCount, baseVisualDisposedCount, variantArtifactCreatedCount, variantArtifactDisposedCount }
  );
  return {
    installAttempts: installAttemptCount,
    variantJobs: variantJobCreatedCount,
    cancelledVariantJobs: variantJobCancelledCount,
    beforeDispose,
    afterDispose: Object.freeze({
      baseCreated: baseVisualCreatedCount,
      baseDisposed: baseVisualDisposedCount,
      variantCreated: variantArtifactCreatedCount,
      variantDisposed: variantArtifactDisposedCount,
      residentVariants: 0
    })
  };
}

/**
 * Prewarm the next resident's counterflow crossover, require one rendered-frame acknowledgement before arming
 * its landing surface, and retain both ends of the ballistic corridor inside the three-tile presentation budget.
 */
function validateOpposingBypassPrewarmAndCarryOver() {
  check(typeof track.prepareOpposingRecoveryPathPlan === 'function',
    'Track does not expose the opposing-bypass preview contract');
  const idleTasks = new Map();
  const startedVariants = [];
  const installedVariants = [];
  const idleTimeouts = [];
  let idleSerial = 0;
  let fakeNow = 0;
  let bypassSignature = null;
  let bypassBuilderStepCount = 0;
  let activationCount = 0;

  const visualFactory = {
    create({ track: scopedTrack }) {
      const tileToken = scopedTrack.graph.tile.token;
      const variants = new Set([scopedTrack.graph.recoveryVariantSignature]);
      return {
        visible: true,
        diagnostics: {
          edgeCount: scopedTrack.graph.edges.length,
          get preparedRecoveryVariantCount() { return variants.size; }
        },
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        createRecoveryVariantJob({ signature }) {
          startedVariants.push({ tileToken, signature });
          let steps = 0;
          return {
            step() {
              steps++;
              if (signature === bypassSignature) bypassBuilderStepCount++;
              // A deliberately slow destination bridge proves landing promotion remains sliced and non-blocking.
              return signature === bypassSignature ? steps >= 24 : true;
            },
            finish() { return { signature, template: {} }; },
            cancel() {}
          };
        },
        hasRecoveryVariant(signature) { return variants.has(signature); },
        installRecoveryVariant(variant) {
          variants.add(variant.signature);
          installedVariants.push({ tileToken, signature: variant.signature });
        },
        activateRecoveryVariant(signature) {
          activationCount++;
          return variants.has(signature);
        },
        dispose() {}
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    requestIdleCallback(callback, options = {}) {
      const id = ++idleSerial;
      idleTimeouts.push(options.timeout);
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 0.2; return fakeNow; }
  });
  const runIdle = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Opposing-bypass fixture ran out of deterministic idle work');
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
  };
  const initialPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const sourceTile = initialPlan.tiles.find((tile) => tile.index > 0);
  const bypassPlan = track.prepareOpposingRecoveryPathPlan(initialPlan, sourceTile);
  const bypassTile = bypassPlan.tiles.find((tile) => tile.token === sourceTile.token);
  const ordinarySignature = tilePool.graphForTile(track, sourceTile, initialPlan, {
    includeRecovery: true
  }).recoveryVariantSignature;
  const bypassGraph = tilePool.graphForTile(track, sourceTile, bypassPlan, { includeRecovery: true });
  bypassSignature = bypassGraph.recoveryVariantSignature;
  const initialCursor = track.getInitialRouteCursor({ pathPlan: initialPlan });
  const initialOrigin = track.sampleRouteCursor(initialCursor, 0, {});
  pool.update({ origin: initialOrigin, pathPlan: initialPlan, routeCursor: initialCursor });
  const releaseEdge = initialPlan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => (
      edge?.jumpPlatforms?.length
      && edge.tileIndex === sourceTile.index - 1
    ));
  check(releaseEdge, 'Opposing-bypass fixture has no source jump-platform edge', { sourceTile });
  const activeTokensBeforePreflight = pool.getDiagnostics().activeTokens;
  const requestedAtLip = pool.requestOpposingRouteVariantPreflight(initialPlan, releaseEdge.id);
  const repeatedLipRequest = pool.requestOpposingRouteVariantPreflight(initialPlan, releaseEdge.id);
  let diagnostics = pool.getDiagnostics();
  check(
    requestedAtLip?.sourceTileToken === releaseEdge.tileToken
      && requestedAtLip.tileToken === sourceTile.token
      && requestedAtLip.signature === ordinarySignature
      && requestedAtLip.visualReady === true
      && requestedAtLip.collisionReady === true
      && requestedAtLip.presentedReady === false
      && requestedAtLip.ready === false
      && requestedAtLip.landingSurfaceReady === false
      && repeatedLipRequest?.sourceTileToken === requestedAtLip.sourceTileToken
      && repeatedLipRequest.tileToken === requestedAtLip.tileToken
      && repeatedLipRequest.signature === requestedAtLip.signature
      && repeatedLipRequest.ready === false
      && repeatedLipRequest.landingSurfaceReady === false
      && ['visualReady', 'collisionReady', 'presentedReady'].every((key) => (
        typeof requestedAtLip[key] === 'boolean' && typeof repeatedLipRequest[key] === 'boolean'
      ))
      && typeof requestedAtLip.status === 'string'
      && typeof repeatedLipRequest.status === 'string'
      && activationCount === 0
      && bypassBuilderStepCount === 0
      && diagnostics.opposingBypassPreflightRequestCount === 1
      && diagnostics.opposingBypassPreflightPromotionCount === 1
      && diagnostics.opposingBypassPreflightPendingCount === 1
      && diagnostics.activeTokens.join('|') === activeTokensBeforePreflight.join('|'),
    'Platform lip performed route planning, variant work, activation, or resident switching synchronously',
    { requestedAtLip, repeatedLipRequest, activationCount, bypassBuilderStepCount, diagnostics }
  );
  const crossoverEdgeId = bypassTile.opposingCrossoverEdgeId;
  const crossoverCursor = track.RoutePosition({
    edgeId: crossoverEdgeId,
    edgeS: 10,
    tileIndex: sourceTile.index
  });
  const pendingReadiness = pool.ensureRouteVariantReadiness(bypassPlan, crossoverCursor);
  check(
    pendingReadiness.ready === false
      && pendingReadiness.landingSurfaceVisible === false
      && pendingReadiness.stableEdgeId === crossoverEdgeId
      && pendingReadiness.stableUntilEdgeS === 1_080,
    'Landing-before-prewarm did not retain the visible shared alias behind an explicit readiness gate',
    pendingReadiness
  );
  check(bypassBuilderStepCount === 0,
    'Landing readiness synchronously drained destination bridge geometry on the portal frame');
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.routeVariantRequirementCount === 1
      && diagnostics.routeVariantCriticalPromotionCount === 1,
    'Landing did not persist and promote its exact destination signature',
    diagnostics
  );
  runIdle();
  const stillPendingReadiness = pool.ensureRouteVariantReadiness(bypassPlan, crossoverCursor);
  check(
    stillPendingReadiness.ready === false
      && bypassBuilderStepCount > 0
      && bypassBuilderStepCount < 24,
    'Slow-device fixture did not preserve a bounded multi-callback readiness window',
    { stillPendingReadiness, bypassBuilderStepCount }
  );

  for (let step = 0; step < 32; step++) {
    if (installedVariants.some((entry) => (
      entry.tileToken === sourceTile.token && entry.signature === bypassSignature
    ))) {
      break;
    }
    runIdle();
  }
  const readyBeforePresentation = pool.ensureRouteVariantReadiness(bypassPlan, crossoverCursor);
  diagnostics = pool.getDiagnostics();
  check(
    installedVariants.some((entry) => (
      entry.tileToken === sourceTile.token && entry.signature === bypassSignature
    ))
      && startedVariants.some((entry) => (
        entry.tileToken === sourceTile.token && entry.signature === bypassSignature
      ))
      && diagnostics.opposingBypassVariantPreparedCount >= 1,
    'Idle queue did not prewarm the next resident opposing-bypass signature',
    { sourceTile, bypassSignature, startedVariants, installedVariants, diagnostics }
  );
  check(
    readyBeforePresentation.ready === false
      && readyBeforePresentation.landingSurfaceVisible === false
      && activationCount === 1
      && diagnostics.routeVariantRequirementCount === 0
      && diagnostics.routeVariantReadinessActivationCount === 1
      && idleTimeouts.some((timeout) => timeout === 16),
    'Completed landing variant armed before the exact active surface was presented',
    { readyBeforePresentation, activationCount, diagnostics, idleTimeouts }
  );
  check(typeof pool.markPresented === 'function', 'Tile pool does not expose the rendered-frame acknowledgement');
  pool.markPresented();
  const readyAfterPresentation = pool.ensureRouteVariantReadiness(bypassPlan, crossoverCursor);
  check(
    readyAfterPresentation.ready === true
      && readyAfterPresentation.landingSurfaceVisible === true,
    'Exact active destination did not arm after its rendered frame was acknowledged',
    readyAfterPresentation
  );

  const crossoverOrigin = track.sampleRouteCursor(crossoverCursor, 0, {});
  pool.update({ origin: crossoverOrigin, pathPlan: bypassPlan, routeCursor: crossoverCursor });
  diagnostics = pool.getDiagnostics();
  const activatedSource = diagnostics.tiles.find((tile) => tile.token === sourceTile.token);
  check(
    activatedSource?.signature === bypassSignature
      && activatedSource.stale === false
      && activatedSource.routeAuthoritative === true
      && diagnostics.opposingBypassAtomicSwitchCount === 1,
    'Opposing landing did not atomically activate its prepared resident',
    { activatedSource, diagnostics }
  );

  const crossoverIndex = bypassPlan.edgeIds.indexOf(crossoverEdgeId);
  const nextApproachEdgeId = bypassPlan.edgeIds[crossoverIndex + 1];
  const nextApproachEdge = track.getEdge(nextApproachEdgeId);
  for (let step = 0; step < 32; step++) {
    if (pool.getDiagnostics().tiles.some((tile) => tile.index === nextApproachEdge.tileIndex)) break;
    runIdle();
  }
  const nextApproachCursor = track.RoutePosition({
    edgeId: nextApproachEdgeId,
    edgeS: Math.min(10, nextApproachEdge.length),
    tileIndex: nextApproachEdge.tileIndex
  });
  const nextApproachOrigin = track.sampleRouteCursor(nextApproachCursor, 0, {});
  const corridorPins = [requestedAtLip.sourceTileToken, requestedAtLip.tileToken];
  pool.update({
    origin: nextApproachOrigin,
    pathPlan: bypassPlan,
    routeCursor: nextApproachCursor,
    pinnedTileTokens: corridorPins
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.activeTokens[0] !== sourceTile.token
      && diagnostics.activeTokens.includes(sourceTile.token)
      && diagnostics.activeTokens.includes(requestedAtLip.sourceTileToken)
      && corridorPins.every((token) => diagnostics.pinnedVisibleTokens.includes(token))
      && diagnostics.activeTokens.length <= 3
      && diagnostics.tiles.find((tile) => tile.token === sourceTile.token)?.active === true,
    'Cursor advance did not keep both ballistic corridor endpoints inside the bounded presentation set',
    { activeTokens: diagnostics.activeTokens, sourceTile }
  );

  const followingTile = bypassPlan.tiles.find((tile) => tile.index === sourceTile.index + 2);
  const followingEdgeId = followingTile?.edgeIds?.[0];
  const followingEdge = track.getEdge(followingEdgeId);
  check(followingEdge, 'Opposing-bypass fixture has no following-tile route edge', followingTile);
  const followingCursor = track.RoutePosition({
    edgeId: followingEdge.id,
    edgeS: Math.min(10, followingEdge.length),
    tileIndex: followingTile.index
  });
  const followingOrigin = track.sampleRouteCursor(followingCursor, 0, {});
  pool.update({
    origin: followingOrigin,
    pathPlan: bypassPlan,
    routeCursor: followingCursor,
    pinnedTileTokens: corridorPins
  });
  diagnostics = pool.getDiagnostics();
  check(
    corridorPins.every((token) => diagnostics.activeTokens.includes(token))
      && corridorPins.every((token) => diagnostics.pinnedVisibleTokens.includes(token))
      && diagnostics.activeTokens.length <= diagnostics.maxTiles
      && diagnostics.maxTiles === 3,
    'Source/destination pins did not survive the second cursor transition within the three-tile budget',
    diagnostics
  );
  pool.update({ origin: followingOrigin, pathPlan: bypassPlan, routeCursor: followingCursor });
  diagnostics = pool.getDiagnostics();
  check(!diagnostics.activeTokens.includes(sourceTile.token),
    'Crossover source bridge remained active after entering the following tile', {
      activeTokens: diagnostics.activeTokens,
      sourceTile,
      followingTile
    });
  const inactiveReadiness = pool.ensureRouteVariantReadiness(bypassPlan, crossoverCursor);
  check(
    inactiveReadiness.ready === false
      && inactiveReadiness.landingSurfaceVisible === false,
    'An exact but inactive destination remained armed after leaving the presentation set',
    inactiveReadiness
  );

  pool.dispose();
  return {
    sourceTileToken: sourceTile.token,
    prewarmedSignature: bypassSignature,
    queued: diagnostics.opposingBypassVariantQueuedCount,
    prepared: diagnostics.opposingBypassVariantPreparedCount,
    atomicSwitches: diagnostics.opposingBypassAtomicSwitchCount,
    criticalPromotions: diagnostics.routeVariantCriticalPromotionCount,
    readinessActivations: diagnostics.routeVariantReadinessActivationCount,
    slowBuilderSteps: bypassBuilderStepCount,
    renderedFrameRequired: true,
    corridorPinsBounded: true,
    inactiveVariantDisarmed: true,
    carryOverReleased: true
  };
}

/**
 * Keep one lip-triggered destination build authoritative after its tile becomes previous and variant enumeration
 * moves twice. The build target must survive capacity pressure until the complete variant is installed.
 */
function validateOpposingPreflightAcrossCursorReset() {
  const idleTasks = new Map();
  const visuals = new Map();
  const installedVariants = [];
  const cancelledVariants = [];
  let idleSerial = 0;
  let fakeNow = 0;
  let targetSignature = null;
  let targetStepCount = 0;

  const visualFactory = {
    create({ track: scopedTrack }) {
      const tileToken = scopedTrack.graph.tile.token;
      const variants = new Set([scopedTrack.graph.recoveryVariantSignature]);
      const visual = {
        visible: true,
        disposed: false,
        diagnostics: {
          edgeCount: scopedTrack.graph.edges.length,
          get preparedRecoveryVariantCount() { return variants.size; }
        },
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        createRecoveryVariantJob({ signature }) {
          let steps = 0;
          return {
            step() {
              steps++;
              if (signature === targetSignature) targetStepCount++;
              return signature === targetSignature ? steps >= 48 : true;
            },
            finish() { return { signature, template: {} }; },
            cancel() { cancelledVariants.push({ tileToken, signature }); }
          };
        },
        hasRecoveryVariant(signature) { return variants.has(signature); },
        installRecoveryVariant(variant) {
          check(!this.disposed, 'Completed preflight variant installed into a disposed target visual', {
            tileToken,
            signature: variant.signature
          });
          variants.add(variant.signature);
          installedVariants.push({ tileToken, signature: variant.signature });
        },
        activateRecoveryVariant(signature) { return variants.has(signature); },
        dispose() { this.disposed = true; }
      };
      visuals.set(tileToken, visual);
      return visual;
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    requestIdleCallback(callback) {
      const id = ++idleSerial;
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 0.1; return fakeNow; }
  });
  const runIdle = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Persistent preflight fixture ran out of deterministic build work', {
      targetStepCount,
      installedVariants,
      cancelledVariants
    });
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
  };

  const pathPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const openingCursor = track.getInitialRouteCursor({ pathPlan });
  track.ensureItineraryHorizon(pathPlan, openingCursor, 4);
  const destinationTile = pathPlan.tiles.find((tile) => tile.index === 1);
  const bypassPlan = track.prepareOpposingRecoveryPathPlan(pathPlan, destinationTile);
  const ordinarySignature = tilePool.graphForTile(track, destinationTile, pathPlan, {
    includeRecovery: true
  }).recoveryVariantSignature;
  targetSignature = tilePool.graphForTile(track, destinationTile, bypassPlan, {
    includeRecovery: true
  }).recoveryVariantSignature;
  const openingOrigin = track.sampleRouteCursor(openingCursor, 0, {});
  pool.update({ origin: openingOrigin, pathPlan, routeCursor: openingCursor });
  const releaseEdge = pathPlan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => edge?.jumpPlatforms?.length && edge.tileIndex === destinationTile.index - 1);
  check(releaseEdge, 'Persistent preflight fixture has no source jump-platform edge', destinationTile);
  const preflight = pool.requestOpposingRouteVariantPreflight(pathPlan, releaseEdge.id);
  check(
    preflight?.sourceTileToken === releaseEdge.tileToken
      && preflight.tileToken === destinationTile.token
      && preflight.signature === ordinarySignature
      && preflight.visualReady === true
      && preflight.collisionReady === true
      && preflight.presentedReady === false
      && preflight.landingSurfaceReady === false
      && preflight.ready === false,
    'Platform lip did not publish the exact persistent destination handshake',
    preflight
  );

  for (let callback = 0; callback < 8 && targetStepCount === 0; callback++) runIdle();
  check(
    targetStepCount > 0
      && targetStepCount < 48
      && !installedVariants.some((entry) => entry.signature === targetSignature),
    'Persistent preflight fixture did not stop inside an incomplete critical build',
    { targetStepCount, installedVariants }
  );

  const secondTile = pathPlan.tiles.find((tile) => tile.index === destinationTile.index + 1);
  const secondEdge = track.getEdge(secondTile?.edgeIds?.[0]);
  const secondCursor = track.RoutePosition({
    edgeId: secondEdge.id,
    edgeS: Math.min(10, secondEdge.length),
    tileIndex: secondTile.index
  });
  const secondOrigin = track.sampleRouteCursor(secondCursor, 0, {});
  const corridorPins = [preflight.sourceTileToken, preflight.tileToken];
  pool.update({
    origin: secondOrigin,
    pathPlan,
    routeCursor: secondCursor,
    pinnedTileTokens: corridorPins
  });
  let diagnostics = pool.getDiagnostics();
  check(
    corridorPins.every((token) => diagnostics.activeTokens.includes(token))
      && corridorPins.every((token) => diagnostics.pinnedVisibleTokens.includes(token))
      && diagnostics.activeTokens.length <= 3,
    'Destination-as-previous transition lost one pinned ballistic corridor endpoint',
    diagnostics
  );

  const thirdTile = pathPlan.tiles.find((tile) => tile.index === destinationTile.index + 2);
  const thirdEdge = track.getEdge(thirdTile?.edgeIds?.[0]);
  const thirdCursor = track.RoutePosition({
    edgeId: thirdEdge.id,
    edgeS: Math.min(10, thirdEdge.length),
    tileIndex: thirdTile.index
  });
  const thirdOrigin = track.sampleRouteCursor(thirdCursor, 0, {});
  // Release the explicit destination pin while four historical/current residents compete for three slots. The
  // active preflight build itself must retain its destination until finish and may evict only unrelated tiles.
  pool.update({
    origin: thirdOrigin,
    pathPlan,
    routeCursor: thirdCursor,
    pinnedTileTokens: [preflight.sourceTileToken]
  });
  diagnostics = pool.getDiagnostics();
  check(
    diagnostics.tiles.some((tile) => tile.token === destinationTile.token)
      && visuals.get(destinationTile.token)?.disposed === false
      && diagnostics.poolSize <= diagnostics.maxTiles,
    'Variant-plan reset evicted the in-flight preflight build target under bounded capacity pressure',
    diagnostics
  );

  for (let callback = 0; callback < 64; callback++) {
    if (installedVariants.some((entry) => (
      entry.tileToken === destinationTile.token && entry.signature === targetSignature
    ))) break;
    runIdle();
  }
  diagnostics = pool.getDiagnostics();
  check(
    installedVariants.some((entry) => (
      entry.tileToken === destinationTile.token && entry.signature === targetSignature
    ))
      && !cancelledVariants.some((entry) => (
        entry.tileToken === destinationTile.token && entry.signature === targetSignature
      ))
      && diagnostics.tiles.some((tile) => tile.token === destinationTile.token)
      && visuals.get(destinationTile.token)?.disposed === false
      && diagnostics.poolSize <= diagnostics.maxTiles,
    'Completed preflight variant was cancelled or evicted on its finish callback',
    { diagnostics, installedVariants, cancelledVariants, targetStepCount }
  );

  pool.dispose();
  return {
    sourceTileToken: preflight.sourceTileToken,
    destinationTileToken: preflight.tileToken,
    variantPlanResetCount: 2,
    criticalBuildSteps: targetStepCount,
    targetRetainedAtFinish: true,
    boundedPresentation: true
  };
}

/** Complete several destination preflights and prove historical PathPlans leave the live pool after route release. */
function validateOpposingPreflightLifecycleBound() {
  const idleTasks = new Map();
  let idleSerial = 0;
  let fakeNow = 0;
  const installedDestinations = new Set();
  const visualFactory = {
    create({ track: scopedTrack }) {
      const tileToken = scopedTrack.graph.tile.token;
      const variants = new Set([scopedTrack.graph.recoveryVariantSignature]);
      return {
        visible: true,
        diagnostics: {
          edgeCount: scopedTrack.graph.edges.length,
          get preparedRecoveryVariantCount() { return variants.size; }
        },
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        createRecoveryVariantJob({ signature }) {
          let steps = 0;
          return {
            step() { return ++steps >= 2; },
            finish() { return { signature, template: {} }; },
            cancel() {}
          };
        },
        hasRecoveryVariant(signature) { return variants.has(signature); },
        installRecoveryVariant(variant) {
          variants.add(variant.signature);
          installedDestinations.add(tileToken);
        },
        activateRecoveryVariant(signature) { return variants.has(signature); },
        dispose() {}
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    requestIdleCallback(callback) {
      const id = ++idleSerial;
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 0.1; return fakeNow; }
  });
  const pathPlan = track.createPathPlan({
    movementId: 'south-straight',
    futureMovementKind: 'straight'
  });
  const openingCursor = track.getInitialRouteCursor({ pathPlan });
  track.ensureItineraryHorizon(pathPlan, openingCursor, 9);
  const tileAt = (index) => pathPlan.tiles.find((tile) => tile.index === index);
  const updateAt = (tile, visibilityOrigin = null) => {
    const routeCursor = track.RoutePosition({
      edgeId: tile.edgeIds[0],
      edgeS: 10,
      tileIndex: tile.index,
      entryPort: tile.entryPort
    });
    const origin = track.sampleRouteCursor(routeCursor, 0, {});
    pool.update({
      origin,
      visibilityOrigin: visibilityOrigin || { x: tile.centerX, z: tile.centerZ },
      pathPlan,
      routeCursor
    });
  };
  const runIdle = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Preflight lifecycle fixture ran out of bounded work');
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
  };

  const sourceIndices = [0, 2, 4, 6];
  let peakRetainedCount = 0;
  for (const sourceIndex of sourceIndices) {
    const sourceTile = tileAt(sourceIndex);
    const destinationTile = tileAt(sourceIndex + 1);
    const releaseTile = tileAt(sourceIndex + 2);
    const releaseEdge = pathPlan.edgeIds
      .map((edgeId) => track.getEdge(edgeId))
      .find((edge) => edge?.jumpPlatforms?.length && edge.tileIndex === sourceIndex);
    check(sourceTile && destinationTile && releaseTile && releaseEdge,
      'Preflight lifecycle itinerary omitted a required source/destination/release tile', { sourceIndex });

    updateAt(sourceTile);
    let diagnostics = pool.getDiagnostics();
    check(
      diagnostics.opposingBypassPreflightRetainedCount === 0
        && diagnostics.opposingBypassPreflightLiveCount === 0
        && diagnostics.opposingBypassPreflights.length === 0,
      'Released destination PathPlan survived into the next launch segment',
      diagnostics
    );

    const receipt = pool.requestOpposingRouteVariantPreflight(pathPlan, releaseEdge.id);
    diagnostics = pool.getDiagnostics();
    check(
      receipt.destinationTileToken === destinationTile.token
        && diagnostics.opposingBypassPreflightPendingCount === 1
        && diagnostics.opposingBypassPreflightRetainedCount === 1
        && diagnostics.opposingBypassPreflightLiveCount === 1
        && diagnostics.opposingBypassPreflights[0]?.destinationTileToken === destinationTile.token,
      'Outstanding destination preflight lost its sole live PathPlan lease',
      { receipt, diagnostics }
    );
    peakRetainedCount = Math.max(
      peakRetainedCount,
      diagnostics.opposingBypassPreflightRetainedCount
    );

    for (let callback = 0; callback < 32; callback++) {
      if (pool.getDiagnostics().opposingBypassPreflightPendingCount === 0) break;
      runIdle();
    }
    diagnostics = pool.getDiagnostics();
    check(
      diagnostics.opposingBypassPreflightPendingCount === 0
        && diagnostics.opposingBypassPreflightRetainedCount === 1
        && diagnostics.opposingBypassPreflightLiveCount === 1
        && installedDestinations.has(destinationTile.token),
      'Completed current-route preflight was released before its landing presentation lease',
      diagnostics
    );
    peakRetainedCount = Math.max(
      peakRetainedCount,
      diagnostics.opposingBypassPreflightRetainedCount
    );

    const destinationVisibilityBounds = pool.graphForTile(destinationTile, pathPlan).bounds;
    updateAt(releaseTile, {
      x: destinationVisibilityBounds.maxX + 2_801,
      z: (destinationVisibilityBounds.minZ + destinationVisibilityBounds.maxZ) * 0.5
    });
    diagnostics = pool.getDiagnostics();
    check(
      diagnostics.opposingBypassPreflightPendingCount === 0
        && diagnostics.opposingBypassPreflightRetainedCount === 0
        && diagnostics.opposingBypassPreflightLiveCount === 0
        && diagnostics.opposingBypassPreflights.length === 0,
      'Completed historical destination retained its PathPlans after pending, build, and route leases ended',
      diagnostics
    );
  }

  const diagnostics = pool.getDiagnostics();
  pool.dispose();
  return {
    completedDestinations: sourceIndices.length,
    peakRetainedCount,
    finalRetainedCount: diagnostics.opposingBypassPreflightRetainedCount,
    bounded: peakRetainedCount === 1 && diagnostics.opposingBypassPreflightRetainedCount === 0
  };
}

/**
 * Commit the exit whose build was queued last. The authoritative signature must preempt speculative work,
 * while the map immediately publishes the committed graph instead of the stale resident road.
 */
function validateCommittedRecoveryPriority() {
  const idleTasks = new Map();
  const startedSignatures = [];
  const cancelledSignatures = [];
  let idleSerial = 0;
  let fakeNow = 0;

  const visualFactory = {
    create({ track: scopedTrack }) {
      const variants = new Set([scopedTrack.graph.recoveryVariantSignature]);
      return {
        visible: true,
        diagnostics: Object.freeze({
          edgeCount: scopedTrack.graph.edges.length,
          get preparedRecoveryVariantCount() { return variants.size; }
        }),
        update(payload = {}) { this.visible = payload.visible !== false; },
        setPalette() {},
        createRecoveryVariantJob({ signature }) {
          startedSignatures.push(signature);
          let steps = 0;
          let cancelled = false;
          return {
            step() {
              check(!cancelled, 'Cancelled recovery builder continued stepping', signature);
              steps++;
              return steps >= 3;
            },
            finish() {
              check(!cancelled && steps >= 3, 'Recovery builder finished before its bounded steps', {
                signature,
                steps,
                cancelled
              });
              return { signature, template: {} };
            },
            cancel() {
              cancelled = true;
              cancelledSignatures.push(signature);
            }
          };
        },
        hasRecoveryVariant(signature) { return variants.has(signature); },
        installRecoveryVariant(variant) { variants.add(variant.signature); },
        activateRecoveryVariant(signature) { return variants.has(signature); },
        dispose() {}
      };
    }
  };
  const pool = tilePool.create({
    track,
    visualFactory,
    maxTiles: 3,
    requestIdleCallback(callback) {
      const id = ++idleSerial;
      idleTasks.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) { idleTasks.delete(id); },
    now() { fakeNow += 0.2; return fakeNow; }
  });
  const runIdle = () => {
    const entry = idleTasks.entries().next().value;
    check(Boolean(entry), 'Recovery priority fixture ran out of idle work');
    idleTasks.delete(entry[0]);
    entry[1]({ didTimeout: false, timeRemaining: () => 50 });
  };
  const initialPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'straight' });
  const committedPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const opposingTile = initialPlan.tiles.find((tile) => tile.index > 0);
  const opposingPlan = track.prepareOpposingRecoveryPathPlan(initialPlan, opposingTile);
  check(opposingPlan, 'Recovery-priority fixture cannot prepare its destination opposing route', opposingTile);
  const initialGraph = tilePool.graphForTile(track, initialPlan.tiles[0], initialPlan, { includeRecovery: true });
  const opposingGraph = tilePool.graphForTile(
    track,
    opposingTile,
    opposingPlan,
    { includeRecovery: true }
  );
  const committedGraph = tilePool.graphForTile(
    track,
    committedPlan.tiles[0],
    committedPlan,
    { includeRecovery: true }
  );
  const cursor = track.getInitialRouteCursor({ pathPlan: initialPlan });
  const origin = track.sampleRouteCursor(cursor, 0, {});
  pool.update({ origin, pathPlan: initialPlan, routeCursor: cursor });

  // Current/destination opposing roads outrank ordinary exits; let that priority-zero build begin but not finish.
  for (let step = 0; step < 5; step++) runIdle();
  check(startedSignatures[0] === opposingGraph.recoveryVariantSignature,
    'Destination opposing prewarm did not outrank ordinary speculative exits', {
      expected: opposingGraph.recoveryVariantSignature,
      startedSignatures
    });

  pool.update({ origin, pathPlan: committedPlan, routeCursor: cursor });
  let diagnostics = pool.getDiagnostics();
  check(cancelledSignatures.includes(opposingGraph.recoveryVariantSignature),
    'Committed route did not preempt the unrelated recovery build', {
      startedSignatures,
      cancelledSignatures,
      diagnostics
    });

  const fallbackMapGraph = pool.getActiveMapGraph(origin, {
    maximumDistance: 900,
    pathPlan: committedPlan,
    routeCursor: cursor
  });
  diagnostics = pool.getDiagnostics();
  check(fallbackMapGraph?.contract?.currentRouteFallback === true,
    'Map did not publish the committed route while the resident 3D variant was stale', fallbackMapGraph?.contract);
  check(
    committedGraph.recoveryEdgeIds.every((edgeId) => fallbackMapGraph.recoveryEdgeIds.includes(edgeId)),
    'Map fallback omitted committed recovery road edges',
    { expected: committedGraph.recoveryEdgeIds, actual: fallbackMapGraph.recoveryEdgeIds }
  );
  check(
    initialGraph.recoveryEdgeIds.some((edgeId) => (
      !committedGraph.recoveryEdgeIds.includes(edgeId)
      && !fallbackMapGraph.recoveryEdgeIds.includes(edgeId)
    )),
    'Map fallback retained the stale current-tile recovery road',
    { stale: initialGraph.recoveryEdgeIds, actual: fallbackMapGraph.recoveryEdgeIds }
  );
  check(diagnostics.mapGraphRouteFallbackActive && diagnostics.mapGraphRouteFallbackCount === 1,
    'Map route fallback diagnostics did not record the stale-resident handoff', diagnostics);
  const staleTile = diagnostics.tiles.find((tile) => tile.token === committedPlan.tiles[0].token);
  check(
    staleTile?.stale === true
      && staleTile.routeAuthoritative === false
      && staleTile.expectedSignature === committedGraph.recoveryVariantSignature
      && diagnostics.staleActiveVisualCount === 1
      && !diagnostics.activeAuthoritativeTokens.includes(staleTile.token)
      && fallbackMapGraph.contract.residentVisualStale === true
      && fallbackMapGraph.contract.residentVisualAuthoritative === false,
    'Deferred resident visual still claimed route authority',
    { staleTile, diagnostics, mapContract: fallbackMapGraph.contract }
  );

  for (let step = 0; step < 8; step++) {
    runIdle();
    if (pool.getDiagnostics().preparedRecoveryVariantResidentCount >= 1) break;
  }
  pool.update({ origin, pathPlan: committedPlan, routeCursor: cursor });
  diagnostics = pool.getDiagnostics();
  const activeTile = diagnostics.tiles.find((tile) => tile.token === committedPlan.tiles[0].token);
  check(startedSignatures.at(-1) === committedGraph.recoveryVariantSignature,
    'Committed recovery variant was not restarted ahead of speculative exits', startedSignatures);
  check(activeTile?.signature === committedGraph.recoveryVariantSignature,
    'Committed recovery road did not atomically replace the stale resident', {
      activeTile,
      expected: committedGraph.recoveryVariantSignature,
      startedSignatures,
      cancelledSignatures,
      diagnostics
    });
  check(
    activeTile?.stale === false
      && activeTile.routeAuthoritative === true
      && diagnostics.staleActiveVisualCount === 0
      && diagnostics.activeAuthoritativeTokens.includes(activeTile.token),
    'Atomic activation did not restore resident visual authority',
    { activeTile, diagnostics }
  );
  check(diagnostics.prioritizedRecoveryPreemptionCount === 1
    && diagnostics.foregroundBuildCount === 2,
    'Committed recovery priority caused a foreground rebuild or missed its preemption', diagnostics);

  pool.getActiveMapGraph(origin, {
    maximumDistance: 900,
    pathPlan: committedPlan,
    routeCursor: cursor
  });
  diagnostics = pool.getDiagnostics();
  check(diagnostics.mapGraphRouteFallbackActive === false,
    'Map fallback stayed active after the resident road caught up', diagnostics);
  pool.dispose();
  return {
    speculativeStarted: opposingGraph.recoveryVariantSignature,
    committedStarted: committedGraph.recoveryVariantSignature,
    preemptions: diagnostics.prioritizedRecoveryPreemptionCount,
    fallbackCount: diagnostics.mapGraphRouteFallbackCount,
    foregroundBuildCount: diagnostics.foregroundBuildCount
  };
}

/** Hold the current backing store during CSS expansion, then resize exactly once after the transition. */
function validateDeferredResize(graph) {
  const canvas = createCanvas(160, 108);
  const standbyCanvas = createCanvas(160, 108);
  canvas.classList.toggle('is-presented', true);
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const payload = movementPayload('south-left');
  minimap.update(payload);
  const before = minimap.getDiagnostics();
  canvas.clientHeight = 140;
  const deferred = minimap.update({ ...payload, deferResize: true });
  check(deferred.bufferResizeCount === before.bufferResizeCount, 'Deferred map update reallocated its backing store');
  check(deferred.deferredResizeCount > before.deferredResizeCount, 'Deferred resize was not recorded');
  const settled = minimap.update(payload);
  check(settled.bufferResizeCount === before.bufferResizeCount + 1, 'Settled map did not resize exactly once', settled);
  const activeCanvas = activePresentationSurface(settled, canvas, standbyCanvas);
  check(activeCanvas.width === 160 && activeCanvas.height === 140,
    'Settled active map surface does not match its CSS viewport', {
      width: activeCanvas.width,
      height: activeCanvas.height,
      activePresentationIndex: settled.activePresentationIndex
    });
  minimap.destroy();
  return {
    deferredResizeCount: deferred.deferredResizeCount,
    bufferResizeCount: settled.bufferResizeCount
  };
}

/**
 * A failed resized frame must never clear the last complete visible map. The same pending offscreen frame can
 * retry successfully, then publish the new backing size once every layer has finished.
 */
function validateAtomicFramePresentation(graph) {
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  canvas.classList.toggle('is-presented', true);
  const buffers = [];
  let failedFrameWidth = null;
  let failedFrameHeight = null;
  let frameFailureArmed = true;
  const createTrackedCanvas = (width, height) => {
    const buffer = createCanvas(width, height);
    if (frameFailureArmed && width === failedFrameWidth && height === failedFrameHeight) {
      buffer.context.failOnFillText = true;
      frameFailureArmed = false;
    }
    buffers.push(buffer);
    return buffer;
  };
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas: createTrackedCanvas
  });
  const payload = movementPayload('south-left');
  let diagnostics = minimap.update(payload);
  let activeCanvas = standbyCanvas;
  check(activeCanvas.classList.contains('is-presented')
    && canvas.context.drawImageCount + standbyCanvas.context.drawImageCount === 1
    && diagnostics.framePresentationCount === 1
    && diagnostics.attemptedFrameSerial === 1
    && diagnostics.presentedFrameSerial === 1
    && diagnostics.presentationMode === 'dual-canvas-swap',
    'Initial map frame was not published exactly once', diagnostics);

  canvas.clientWidth = 640;
  canvas.clientHeight = 360;
  standbyCanvas.clientWidth = 640;
  standbyCanvas.clientHeight = 360;
  failedFrameWidth = 640;
  failedFrameHeight = 360;
  const bufferCountBeforeFailure = buffers.length;
  let injectedFailure = null;
  try {
    minimap.resize();
  } catch (error) {
    injectedFailure = error;
  }
  diagnostics = minimap.getDiagnostics();
  check(injectedFailure?.name === 'NeonMinimapRecoverableError'
    && injectedFailure?.code === 'minimap-frame-render-failed'
    && injectedFailure?.cause?.message === 'Injected frame-layer failure',
  'Resize fixture did not classify the injected layer failure as recoverable', {
    name: injectedFailure?.name,
    code: injectedFailure?.code,
    cause: injectedFailure?.cause?.message
  });
  check(activeCanvas.classList.contains('is-presented')
    && activeCanvas.width === 400
    && activeCanvas.height === 225,
  'Failed resized frame cleared, resized, or hid the visible map', {
    active: activeCanvas.dataset.presented,
    width: activeCanvas.width,
    height: activeCanvas.height
  });
  check(canvas.context.drawImageCount + standbyCanvas.context.drawImageCount === 1
    && diagnostics.framePresentationCount === 1
    && diagnostics.frameRenderFailureCount === 1
    && diagnostics.attemptedFrameSerial === 2
    && diagnostics.presentedFrameSerial === 1
    && diagnostics.lastFailureCode === 'minimap-frame-render-failed'
    && diagnostics.lastFailurePhase === 'frame-render',
    'Failed frame was partially presented over the last complete map', diagnostics);

  const failedFrame = buffers.findLast((buffer) => (
    buffer.width === failedFrameWidth && buffer.height === failedFrameHeight
  ));
  check(Boolean(failedFrame), 'Atomic presentation fixture could not identify the resized frame buffer');
  diagnostics = minimap.update(payload);
  activeCanvas = canvas;
  check(activeCanvas.classList.contains('is-presented')
    && activeCanvas.width === 640
    && activeCanvas.height === 360,
  'Successful retry did not atomically publish the pending map size', {
    width: activeCanvas.width,
    height: activeCanvas.height
  });
  check(canvas.context.drawImageCount + standbyCanvas.context.drawImageCount === 2
    && diagnostics.framePresentationCount === 2
    && diagnostics.framePresentationSwapCount === 2,
    'Successful retry did not atomically replace the retained frame', diagnostics);
  check(buffers.length > bufferCountBeforeFailure + 2
    && diagnostics.attemptedFrameSerial === 3
    && diagnostics.presentedFrameSerial === 3
    && diagnostics.lastFailureCode === null
    && diagnostics.lastFailurePhase === null,
  'Frame-render recovery reused a polluted private context or failed to commit the retry serial', {
    buffersBeforeFailure: bufferCountBeforeFailure,
    buffersAfterRetry: buffers.length,
    diagnostics
  });

  standbyCanvas.context.failOnDrawImage = true;
  let presentationFailure = null;
  try {
    minimap.update(payload);
  } catch (error) {
    presentationFailure = error;
  }
  diagnostics = minimap.getDiagnostics();
  check(presentationFailure?.name === 'NeonMinimapRecoverableError'
    && presentationFailure?.code === 'minimap-presentation-failed'
    && presentationFailure?.cause?.message === 'Injected presentation failure',
  'Final-copy failure did not remain a recoverable presentation error', {
    name: presentationFailure?.name,
    code: presentationFailure?.code,
    cause: presentationFailure?.cause?.message
  });
  check(canvas.classList.contains('is-presented')
    && canvas.width === 640
    && canvas.height === 360
    && diagnostics.framePresentationCount === 2
    && diagnostics.framePresentationFailureCount === 1
    && diagnostics.attemptedFrameSerial === 4
    && diagnostics.presentedFrameSerial === 3
    && diagnostics.lastFailureCode === 'minimap-presentation-failed'
    && diagnostics.lastFailurePhase === 'presentation',
  'Final-copy failure replaced or resized the active map surface', diagnostics);
  standbyCanvas.context.failOnDrawImage = false;
  diagnostics = minimap.update(payload);
  check(standbyCanvas.classList.contains('is-presented')
    && diagnostics.framePresentationCount === 3
    && diagnostics.framePresentationSwapCount === 3
    && diagnostics.attemptedFrameSerial === 5
    && diagnostics.presentedFrameSerial === 5
    && diagnostics.lastFailureCode === null
    && diagnostics.lastFailurePhase === null,
  'Presentation did not recover on the next complete frame', diagnostics);
  check(diagnostics.framePresentationResizeCount === 1
    && diagnostics.presentedBufferWidth === 640
    && diagnostics.presentedBufferHeight === 360,
  'Atomic presentation diagnostics do not describe the committed backing frame', diagnostics);
  minimap.destroy();
  return {
    retainedWidth: 400,
    retainedHeight: 225,
    presentedWidth: diagnostics.presentedBufferWidth,
    presentedHeight: diagnostics.presentedBufferHeight,
    presentationCount: diagnostics.framePresentationCount,
    presentationResizeCount: diagnostics.framePresentationResizeCount,
    presentationFailures: diagnostics.framePresentationFailureCount,
    renderFailures: diagnostics.frameRenderFailureCount
  };
}

/** A failed world-buffer candidate must leave every live dimension and the last presented frame unchanged. */
function validateTransactionalResizeAllocation(graph) {
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  canvas.classList.toggle('is-presented', true);
  let resizeAllocationIndex = 0;
  let rejectSecondResizeAllocation = false;
  const createTransactionalCanvas = (width, height) => {
    const buffer = createCanvas(width, height);
    if (rejectSecondResizeAllocation) {
      resizeAllocationIndex++;
      if (resizeAllocationIndex === 2) {
        buffer.context = null;
      }
    }
    return buffer;
  };
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas: createTransactionalCanvas
  });
  const payload = movementPayload('south-left');
  let diagnostics = minimap.update(payload);
  const activeBefore = diagnostics.activePresentationIndex;
  const resizeCountBefore = diagnostics.bufferResizeCount;
  canvas.clientWidth = 640;
  canvas.clientHeight = 360;
  standbyCanvas.clientWidth = 640;
  standbyCanvas.clientHeight = 360;
  rejectSecondResizeAllocation = true;
  let allocationFailure = null;
  try {
    minimap.resize();
  } catch (error) {
    allocationFailure = error;
  }
  diagnostics = minimap.getDiagnostics();
  check(allocationFailure?.code === 'minimap-world-buffer-allocation-failed',
    'World-buffer allocation failure was not classified for bounded retry', {
      name: allocationFailure?.name,
      code: allocationFailure?.code
    });
  check(diagnostics.cssWidth === 400
    && diagnostics.cssHeight === 225
    && diagnostics.bufferWidth === 400
    && diagnostics.bufferHeight === 225
    && diagnostics.bufferResizeCount === resizeCountBefore
    && diagnostics.activePresentationIndex === activeBefore,
  'Failed resize allocation partially committed live minimap dimensions', diagnostics);
  rejectSecondResizeAllocation = false;
  diagnostics = minimap.update(payload);
  check(diagnostics.cssWidth === 640
    && diagnostics.cssHeight === 360
    && diagnostics.bufferWidth === 640
    && diagnostics.bufferHeight === 360
    && diagnostics.bufferResizeCount === resizeCountBefore + 1
    && diagnostics.worldBufferAllocationFailureCount === 1,
  'Minimap did not recover transactionally after allocation became available', diagnostics);
  minimap.destroy();
  return {
    retained: '400x225',
    recovered: '640x360',
    worldAllocationFailures: diagnostics.worldBufferAllocationFailureCount
  };
}

/** Static-raster exceptions are recoverable and must rebuild their private cache before the next attempt. */
function validateWorldCacheRenderRecovery(graph) {
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  canvas.classList.toggle('is-presented', true);
  const buffers = [];
  const createTrackedCanvas = (width, height) => {
    const buffer = createCanvas(width, height);
    buffers.push(buffer);
    return buffer;
  };
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas: createTrackedCanvas
  });
  const payload = movementPayload('south-left');
  let diagnostics = minimap.update(payload);
  const presentedBefore = diagnostics.framePresentationCount;
  const serialBefore = diagnostics.presentedFrameSerial;
  const worldBuffer = buffers.find((buffer) => buffer.width !== 400 || buffer.height !== 225);
  check(Boolean(worldBuffer), 'World-cache recovery fixture could not identify the private world raster');
  worldBuffer.context.failOnClearRect = true;
  minimap.invalidate();
  let worldCacheFailure = null;
  try {
    minimap.update(payload);
  } catch (error) {
    worldCacheFailure = error;
  }
  diagnostics = minimap.getDiagnostics();
  check(worldCacheFailure?.code === 'minimap-world-cache-render-failed'
    && worldCacheFailure?.phase === 'world-cache-render'
    && worldCacheFailure?.cause?.message === 'Injected world-cache render failure',
  'Static-raster exception was not classified as a recoverable world-cache failure', {
    name: worldCacheFailure?.name,
    code: worldCacheFailure?.code,
    phase: worldCacheFailure?.phase,
    cause: worldCacheFailure?.cause?.message
  });
  check(diagnostics.worldCacheRenderFailureCount === 1
    && diagnostics.framePresentationCount === presentedBefore
    && diagnostics.presentedFrameSerial === serialBefore
    && diagnostics.lastFailureCode === 'minimap-world-cache-render-failed'
    && diagnostics.lastFailurePhase === 'world-cache-render',
  'World-cache failure leaked a partial frame or lost its failure diagnostics', diagnostics);
  diagnostics = minimap.update(payload);
  check(diagnostics.worldCacheRenderFailureCount === 1
    && diagnostics.framePresentationCount === presentedBefore + 1
    && diagnostics.presentedFrameSerial === diagnostics.attemptedFrameSerial
    && diagnostics.lastFailureCode === null
    && diagnostics.lastFailurePhase === null,
  'World-cache retry did not recover with a rebuilt private raster', diagnostics);
  minimap.destroy();
  return {
    failures: diagnostics.worldCacheRenderFailureCount,
    recoveredSerial: diagnostics.presentedFrameSerial
  };
}

/** A graph refresh publishes geometry, diagnostics, and its matching world raster as one transaction. */
function validateTransactionalGraphRefresh(graph) {
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  canvas.classList.toggle('is-presented', true);
  let rejectNextAllocation = false;
  const createTransactionalCanvas = (width, height) => {
    const buffer = createCanvas(width, height);
    if (rejectNextAllocation) {
      rejectNextAllocation = false;
      buffer.context = null;
    }
    return buffer;
  };
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas: createTransactionalCanvas
  });
  const payload = movementPayload('south-left');
  let diagnostics = minimap.update(payload);
  const before = {
    graphVersion: diagnostics.graphVersion,
    edgeCount: diagnostics.edgeCount,
    crossingCount: diagnostics.crossingCount,
    worldCacheWidth: diagnostics.worldCacheWidth,
    worldCacheHeight: diagnostics.worldCacheHeight,
    activeVisualTileTokens: [...diagnostics.activeVisualTileTokens]
  };
  rejectNextAllocation = true;
  let refreshFailure = null;
  try {
    minimap.refreshGraph({ ...graph, version: 'transaction-must-rollback' });
  } catch (error) {
    refreshFailure = error;
  }
  diagnostics = minimap.getDiagnostics();
  check(refreshFailure?.code === 'minimap-world-buffer-allocation-failed',
    'Graph refresh allocation failure was not classified for retry', {
      name: refreshFailure?.name,
      code: refreshFailure?.code
    });
  check(diagnostics.graphVersion === before.graphVersion
    && diagnostics.edgeCount === before.edgeCount
    && diagnostics.crossingCount === before.crossingCount
    && diagnostics.worldCacheWidth === before.worldCacheWidth
    && diagnostics.worldCacheHeight === before.worldCacheHeight
    && JSON.stringify(diagnostics.activeVisualTileTokens) === JSON.stringify(before.activeVisualTileTokens),
  'Failed graph refresh partially published candidate topology or cache diagnostics', { before, diagnostics });
  diagnostics = minimap.update(payload);
  check(diagnostics.graphVersion === before.graphVersion
    && diagnostics.selectedEdgeCount > 0
    && diagnostics.routeGapCount === 0,
  'Renderer did not remain usable on the previous graph after refresh rollback', diagnostics);
  minimap.destroy();
  return {
    retainedVersion: diagnostics.graphVersion,
    retainedEdges: diagnostics.edgeCount,
    allocationFailures: diagnostics.worldBufferAllocationFailureCount
  };
}

/** Before CSS layout exists, responsive fallbacks outrank stale intrinsic canvas dimensions. */
function validateZeroLayoutFallback(graph) {
  const previousInnerWidth = global.innerWidth;
  const cases = Object.freeze([
    Object.freeze({ viewportWidth: 320, width: 160, height: 108 }),
    Object.freeze({ viewportWidth: 1_440, width: 400, height: 225 })
  ]);
  const results = [];
  try {
    for (const fixture of cases) {
      global.innerWidth = fixture.viewportWidth;
      const canvas = createCanvas(777, 333);
      const standbyCanvas = createCanvas(777, 333);
      canvas.clientWidth = 0;
      canvas.clientHeight = 0;
      standbyCanvas.clientWidth = 0;
      standbyCanvas.clientHeight = 0;
      canvas.classList.toggle('is-presented', true);
      const minimap = mapFactory.create({
        canvas,
        standbyCanvas,
        track,
        graph,
        dpr: 1,
        maxDpr: 1,
        sampleStep: 4,
        createCanvas
      });
      const diagnostics = minimap.update(movementPayload('south-left'));
      const activeCanvas = activePresentationSurface(diagnostics, canvas, standbyCanvas);
      check(diagnostics.cssWidth === fixture.width
        && diagnostics.cssHeight === fixture.height
        && activeCanvas.width === fixture.width
        && activeCanvas.height === fixture.height,
      'Zero-layout minimap reused stale intrinsic dimensions instead of its responsive fallback', {
        fixture,
        diagnostics,
        activeWidth: activeCanvas.width,
        activeHeight: activeCanvas.height
      });
      results.push(`${fixture.viewportWidth}:${fixture.width}x${fixture.height}`);
      minimap.destroy();
    }
  } finally {
    global.innerWidth = previousInnerWidth;
  }
  return results;
}

/** Public diagnostic reads are immutable snapshots and disposal seals every renderer entry point. */
function validateImmutableDiagnosticsAndDestroy(graph) {
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  let reducedMotionEnabled = false;
  canvas.classList.toggle('is-presented', true);
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas,
    isReducedMotionEnabled: () => reducedMotionEnabled,
    allowTestFaults: true
  });
  const payload = movementPayload('south-left');
  const updateSnapshot = minimap.update(payload);
  const diagnosticSnapshot = minimap.getDiagnostics();
  check(Object.isFrozen(updateSnapshot) && Object.isFrozen(diagnosticSnapshot),
    'Minimap exposed mutable internal diagnostics instead of immutable snapshots');
  let mutationRejected = false;
  try {
    diagnosticSnapshot.graphVersion = 'mutated-by-consumer';
  } catch (_error) {
    mutationRejected = true;
  }
  check(mutationRejected && minimap.getDiagnostics().graphVersion !== 'mutated-by-consumer',
    'Consumer mutation changed live minimap diagnostics');
  minimap.destroy();
  minimap.destroy();
  const disposedSnapshot = minimap.update(payload);
  check(Object.isFrozen(disposedSnapshot)
    && disposedSnapshot.activePresentationIndex === -1
    && disposedSnapshot.presentedBufferWidth === 0
    && disposedSnapshot.presentedBufferHeight === 0
    && !canvas.classList.contains('is-presented')
    && !standbyCanvas.classList.contains('is-presented'),
  'Destroy did not clear presentation ownership or return a sealed diagnostic snapshot', disposedSnapshot);
  const beforeDisposedMutations = minimap.getDiagnostics();
  reducedMotionEnabled = true;
  const invalidationResult = minimap.invalidate();
  const motionResult = minimap.syncMotionPreference();
  const afterDisposedMutations = minimap.getDiagnostics();
  check(invalidationResult === false
    && minimap.resize() === false
    && motionResult === false
    && minimap.debugFailNextFrame('presentation') === false,
  'Destroyed minimap still accepted resize, motion, or debug mutations');
  check(JSON.stringify(afterDisposedMutations) === JSON.stringify(beforeDisposedMutations),
    'Destroyed minimap invalidate or motion sync changed diagnostics', {
      beforeDisposedMutations,
      afterDisposedMutations
    });
  const beforeRefresh = minimap.getDiagnostics();
  const afterRefresh = minimap.refreshGraph({ ...graph, version: 'destroyed-refresh-must-not-run' });
  check(Object.isFrozen(afterRefresh)
    && afterRefresh.graphVersion === beforeRefresh.graphVersion
    && minimap.getDiagnostics().graphVersion === beforeRefresh.graphVersion,
  'Destroyed minimap accepted a graph refresh', { beforeRefresh, afterRefresh });
  return {
    immutableSnapshots: true,
    activePresentationIndex: disposedSnapshot.activePresentationIndex,
    sealed: true
  };
}

/** CSS pixels and presentation surfaces must stay sharp at fractional and high device-pixel ratios. */
function validateHighDprPresentation(graph) {
  const dprValues = Object.freeze([1, 1.25, 1.5, 2, 3]);
  const results = [];
  for (const targetDpr of dprValues) {
    const canvas = createCanvas(320, 180);
    const standbyCanvas = createCanvas(320, 180);
    canvas.classList.toggle('is-presented', true);
    const minimap = mapFactory.create({
      canvas,
      standbyCanvas,
      track,
      graph,
      dpr: targetDpr,
      maxDpr: 3,
      sampleStep: 4,
      createCanvas
    });
    const diagnostics = minimap.update(movementPayload('south-left'));
    const activeCanvas = diagnostics.activePresentationIndex === 0 ? canvas : standbyCanvas;
    const expectedWidth = Math.round(320 * targetDpr);
    const expectedHeight = Math.round(180 * targetDpr);
    checkNear(diagnostics.effectiveDpr, targetDpr, 0.000_001,
      'Effective minimap DPR diverged from the supported device ratio');
    check(diagnostics.bufferWidth === expectedWidth
      && diagnostics.bufferHeight === expectedHeight
      && activeCanvas.width === expectedWidth
      && activeCanvas.height === expectedHeight,
    'High-DPR backing store or presented surface has the wrong size', {
      targetDpr,
      diagnostics,
      activeWidth: activeCanvas.width,
      activeHeight: activeCanvas.height
    });
    results.push(`${targetDpr}:${expectedWidth}x${expectedHeight}`);
    minimap.destroy();
  }
  return results;
}

/** Defensive cache signatures prevent an upstream in-place PathPlan edit from leaving a stale selected route. */
function validateMutablePathSourceInvalidation(graph) {
  const sourcePayload = movementPayload('south-left');
  const mutableEdgeIds = [...sourcePayload.pathPlan.edgeIds];
  const pathPlan = { ...sourcePayload.pathPlan, edgeIds: mutableEdgeIds };
  const minimap = mapFactory.create({
    canvas: createCanvas(400, 225),
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  let diagnostics = minimap.update({ ...sourcePayload, pathPlan });
  const selectedBefore = diagnostics.selectedEdgeCount;
  mutableEdgeIds.pop();
  diagnostics = minimap.update({ ...sourcePayload, pathPlan });
  check(diagnostics.selectedEdgeCount === selectedBefore - 1
    && diagnostics.pathSourceMutationCount === 1,
  'In-place PathPlan edit reused a stale route classification', diagnostics);
  minimap.destroy();
  return {
    selectedBefore,
    selectedAfter: diagnostics.selectedEdgeCount,
    mutationInvalidations: diagnostics.pathSourceMutationCount
  };
}

/** Proposal classification must notice in-place collection edits, matching the selected PathPlan contract. */
function validateMutableProposalSourceInvalidation(graph) {
  const sourcePayload = movementPayload('south-left');
  const proposalEdgeIds = [...sourcePayload.pathPlan.edgeIds.slice(0, 2)];
  const proposal = { edgeIds: proposalEdgeIds };
  const minimap = mapFactory.create({
    canvas: createCanvas(400, 225),
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  let diagnostics = minimap.update({ ...sourcePayload, proposal });
  const proposedBefore = diagnostics.proposedEdgeCount;
  proposalEdgeIds.pop();
  diagnostics = minimap.update({ ...sourcePayload, proposal });
  check(diagnostics.proposedEdgeCount === proposedBefore - 1
    && diagnostics.proposalSourceMutationCount === 1,
  'In-place proposal edit reused a stale route classification', diagnostics);
  minimap.destroy();
  return {
    proposedBefore,
    proposedAfter: diagnostics.proposedEdgeCount,
    mutationInvalidations: diagnostics.proposalSourceMutationCount
  };
}

/** Debug-only fault control supports real-browser recovery proof without exposing mutations in normal sessions. */
function validateDebugFaultInjection(graph) {
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  canvas.classList.toggle('is-presented', true);
  const minimap = mapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas,
    allowTestFaults: true
  });
  const payload = movementPayload('south-left');
  let diagnostics = minimap.update(payload);
  const presentationCountBefore = diagnostics.framePresentationCount;
  check(minimap.debugFailNextFrame('presentation') === true,
    'Debug minimap did not arm its one-shot presentation failure');
  let injectedFailure = null;
  try {
    minimap.update(payload);
  } catch (error) {
    injectedFailure = error;
  }
  diagnostics = minimap.getDiagnostics();
  check(injectedFailure?.code === 'minimap-debug-presentation-failed'
    && diagnostics.framePresentationCount === presentationCountBefore
    && diagnostics.debugFaultCount === 1,
  'Debug presentation fault changed the active frame or lost its diagnostic', diagnostics);
  diagnostics = minimap.update(payload);
  check(diagnostics.framePresentationCount === presentationCountBefore + 1,
    'One-shot debug failure did not recover on the next map update', diagnostics);
  minimap.destroy();

  const productionMinimap = mapFactory.create({
    canvas: createCanvas(400, 225),
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  check(productionMinimap.debugFailNextFrame('presentation') === false,
    'Production minimap accepted a debug fault without explicit test authority');
  productionMinimap.destroy();
  return {
    faultCount: diagnostics.debugFaultCount,
    recoveredPresentationCount: diagnostics.framePresentationCount
  };
}

/** Verify local, overview, and guided transforms travel through intermediate states instead of snapping. */
function validateSmoothModeTransitions(graph) {
  const canvas = createCanvas(400, 225);
  let fakeNow = 0;
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas,
    now: () => fakeNow
  });
  const overviewPayload = movementPayload('south-left');
  const localPayload = {
    ...overviewPayload,
    overviewProgress: 0,
    guidedProgress: 0,
    roadDetailProgress: 0
  };
  let diagnostics = minimap.update(localPayload);
  check(diagnostics.mapMode === 'local', 'Transition fixture did not initialize in local mode', diagnostics);

  fakeNow = 1;
  diagnostics = minimap.update(overviewPayload);
  check(diagnostics.overviewProgress === 0 && diagnostics.overviewTargetProgress === 1,
    'Overview transition snapped on its first frame', diagnostics);
  check(diagnostics.modeTransitionActive, 'Overview transition did not report an active handoff', diagnostics);

  fakeNow = 231;
  diagnostics = minimap.update(overviewPayload);
  checkNear(diagnostics.overviewProgress, 0.5, 0.000_001,
    'Overview transition omitted its continuous midpoint');

  fakeNow = 461;
  diagnostics = minimap.update(overviewPayload);
  check(diagnostics.overviewProgress === 1 && diagnostics.northUp,
    'Overview transition did not settle exactly north-up', diagnostics);

  const guidedPayload = { ...overviewPayload, guidedProgress: 1 };
  fakeNow = 462;
  diagnostics = minimap.update(guidedPayload);
  check(diagnostics.guidedProgress === 0 && diagnostics.guidedTargetProgress === 1,
    'Guided transition snapped on its first frame', diagnostics);
  fakeNow = 692;
  diagnostics = minimap.update(guidedPayload);
  checkNear(diagnostics.guidedProgress, 0.5, 0.000_001,
    'Guided transition omitted its continuous midpoint');
  fakeNow = 922;
  diagnostics = minimap.update(guidedPayload);
  check(diagnostics.guidedProgress === 1 && diagnostics.mapMode === 'guided'
    && diagnostics.modeTransitionActive === false,
    'Guided transition did not settle cleanly', diagnostics);
  check(diagnostics.modeTransitionMaximumStep <= 0.5 + 0.000_001,
    'Mode transition retained a full-frame transform jump', diagnostics.modeTransitionMaximumStep);

  minimap.destroy();
  return {
    durationMs: diagnostics.modeTransitionDurationMs,
    maximumStep: diagnostics.modeTransitionMaximumStep,
    finalMode: diagnostics.mapMode
  };
}

/** A live reduced-motion getter must settle the retained map immediately and remain read-only to the renderer. */
function validateReducedMotionModeSettlement(graph) {
  const canvas = createCanvas(400, 225);
  let fakeNow = 0;
  let reducedMotion = false;
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas,
    now: () => fakeNow,
    isReducedMotionEnabled: () => reducedMotion
  });
  const overviewPayload = movementPayload('south-left');
  const localPayload = {
    ...overviewPayload,
    overviewProgress: 0,
    guidedProgress: 0,
    roadDetailProgress: 0
  };
  minimap.update(localPayload);

  fakeNow = 1;
  let diagnostics = minimap.update(overviewPayload);
  check(diagnostics.modeTransitionActive && diagnostics.overviewProgress === 0,
    'Reduced-motion fixture did not begin with the normal eased handoff', diagnostics);

  fakeNow = 100;
  reducedMotion = true;
  check(minimap.syncMotionPreference(), 'Live reduced-motion change did not request an immediate retained redraw');
  diagnostics = minimap.getDiagnostics();
  check(diagnostics.reducedMotion
    && diagnostics.overviewProgress === 1
    && diagnostics.modeTransitionDurationMs === 0
    && diagnostics.modeTransitionActive === false,
  'Reduced motion did not settle the active overview transform', diagnostics);

  const guidedPayload = { ...overviewPayload, guidedProgress: 1 };
  fakeNow = 101;
  diagnostics = minimap.update(guidedPayload);
  check(diagnostics.guidedProgress === 1 && diagnostics.mapMode === 'guided',
    'Reduced motion did not snap a subsequent guided target', diagnostics);

  reducedMotion = false;
  check(minimap.syncMotionPreference() === false,
    'Disabling reduced motion should not force an accessibility redraw');
  fakeNow = 102;
  diagnostics = minimap.update(localPayload);
  check(!diagnostics.reducedMotion
    && diagnostics.overviewProgress === 1
    && diagnostics.guidedProgress === 1
    && diagnostics.modeTransitionActive,
  'Normal easing did not resume for a later mode change', diagnostics);
  fakeNow = 332;
  diagnostics = minimap.update(localPayload);
  checkNear(diagnostics.overviewProgress, 0.5, 0.000_001,
    'Normal overview easing did not resume from the settled target');
  checkNear(diagnostics.guidedProgress, 0.5, 0.000_001,
    'Normal guided easing did not resume from the settled target');

  minimap.destroy();
  return {
    settledDurationMs: 0,
    resumedOverviewProgress: diagnostics.overviewProgress,
    resumedGuidedProgress: diagnostics.guidedProgress
  };
}

function movementPayload(movementId) {
  const pathPlan = track.createPathPlan({ movementId, singleTile: true });
  const cursor = track.getInitialRouteCursor({ pathPlan });
  const entryEdge = track.getEdge(cursor.edgeId);
  cursor.edgeS = entryEdge.length * 0.5;
  cursor.runDistance = cursor.edgeS;
  return Object.freeze({
    routeCursor: cursor,
    pathPlan,
    proposal: null,
    playerFrame: track.sampleRouteCursor(cursor, 0, {}),
    entities: Object.freeze([]),
    world: SHARED_WORLD_FIXTURE,
    overviewProgress: 1,
    guidedProgress: 0
  });
}

/** Moving the local viewport must reuse world topology while retaining live markers and guidance. */
function validateMovingWorldCache(graph) {
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', singleTile: true });
  const cursor = track.getInitialRouteCursor({ pathPlan });
  const edge = track.getEdge(cursor.edgeId);
  const startS = edge.length * 0.12;
  cursor.edgeS = startS;
  cursor.runDistance = startS;
  const hazards = Object.freeze([
    Object.freeze({ kind: 'obstacle', routeRef: Object.freeze({ edgeId: edge.id, edgeS: startS + 48, lateral: 0 }) })
  ]);
  const pickups = Object.freeze([
    Object.freeze({ kind: 'pickup', routeRef: Object.freeze({ edgeId: edge.id, edgeS: startS + 72, lateral: 2 }) })
  ]);
  const ambientFrame = track.sampleEdge(edge.id, startS + 96, -3, {});
  const ambientTraffic = Object.freeze([
    Object.freeze({ kind: 'ambient-traffic', edgeId: edge.id, x: ambientFrame.x, y: ambientFrame.y,
      z: ambientFrame.z, heading: ambientFrame.yaw, opacity: 0.8, visible: true })
  ]);
  const navigation = Object.freeze({
    label: '2A · 北向',
    kind: 'straight',
    distanceM: 300,
    currentSpeed: 84,
    suggestedSpeed: 72,
    braking: true,
    nearestObstacleDistance: 48
  });
  const canvas = createCanvas(640, 360);
  const frameCanvases = [];
  const createTrackedCanvas = (width, height) => {
    const frameCanvas = createCanvas(width, height);
    frameCanvases.push(frameCanvas);
    return frameCanvas;
  };
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    width: 640,
    height: 360,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas: createTrackedCanvas
  });
  const basePayload = {
    routeCursor: cursor,
    pathPlan,
    proposal: null,
    hazards,
    pickups,
    ambientTraffic,
    world: SHARED_WORLD_FIXTURE,
    navigation,
    overviewProgress: 0,
    guidedProgress: 0,
    roadDetailProgress: 0
  };
  let diagnostics = minimap.update({ ...basePayload, playerFrame: track.sampleRouteCursor(cursor, 0, {}) });
  check(diagnostics.navigationDrawCount === 1, 'Decision guidance was not rendered', diagnostics);
  check(
    frameCanvases.some((frameCanvas) => frameCanvas.context.fillTextValues.includes('↑'))
      && frameCanvases.every((frameCanvas) => (
        !frameCanvas.context.fillTextValues.includes('302 km/h · 建议 259 km/h')
      )),
    'Canvas cue did not preserve direction or duplicated the surrounding DOM guidance',
    frameCanvases.flatMap((frameCanvas) => frameCanvas.context.fillTextValues)
  );
  check(diagnostics.hazardDrawCount === 1, 'Stable hazard array was not rendered', diagnostics);
  check(diagnostics.pickupDrawCount === 1, 'Stable pickup array was not rendered', diagnostics);
  check(diagnostics.ambientTrafficDrawCount === 1, 'Ambient traffic marker was not rendered', diagnostics);
  check(diagnostics.scaleBarMeters > 0, 'Functional scale bar is missing', diagnostics);
  check(diagnostics.navigationDistanceM === 300, 'Navigation distance diverged', diagnostics);
  check(diagnostics.navigationCurrentSpeed === 84 && diagnostics.navigationSuggestedSpeed === 72,
    'Navigation speed guidance diverged', diagnostics);
  check(diagnostics.navigationBraking === true, 'Navigation braking state diverged', diagnostics);
  check(diagnostics.nearestObstacleDistance === 48, 'Navigation obstacle distance diverged', diagnostics);
  const before = minimap.getDiagnostics();

  for (let frame = 0; frame < STEADY_FRAMES; frame += 1) {
    cursor.edgeS = startS + edge.length * 0.70 * frame / (STEADY_FRAMES - 1);
    cursor.runDistance = cursor.edgeS;
    diagnostics = minimap.update({ ...basePayload, playerFrame: track.sampleRouteCursor(cursor, 0, {}) });
  }
  const buildDelta = diagnostics.staticCacheBuildCount - before.staticCacheBuildCount;
  const auditDelta = diagnostics.clipAuditCount - before.clipAuditCount;
  const skipDelta = diagnostics.clipAuditSkipCount - before.clipAuditSkipCount;
  check(buildDelta === 0, 'Player movement rebuilt static topology', { buildDelta, diagnostics });
  check(diagnostics.staticCachePanHitCount - before.staticCachePanHitCount >= STEADY_FRAMES - 2,
    'Moving viewport did not hit the world-space cache', diagnostics);
  check(auditDelta <= 3, 'Moving viewport ran full clipping audits too frequently', { auditDelta, frames: STEADY_FRAMES });
  check(skipDelta >= STEADY_FRAMES - 3, 'Moving viewport did not skip low-value clipping audits', {
    skipDelta,
    frames: STEADY_FRAMES
  });
  minimap.destroy();
  return {
    frames: STEADY_FRAMES,
    buildDelta,
    panCacheHits: diagnostics.staticCachePanHitCount - before.staticCachePanHitCount,
    clipAudits: auditDelta,
    clipAuditSkips: skipDelta,
    navigation: true,
    ambientTraffic: true,
    drawP95Ms: diagnostics.drawP95Ms
  };
}

/** Resolve next-tile route references globally and reject malformed entities instead of painting map origin. */
function validateEntityCoordinateContract() {
  const pathPlan = track.createPathPlan({ movementId: 'south-straight', futureMovementKind: 'left' });
  const tile = pathPlan.tiles[0];
  const graph = tilePool.graphForTile(track, tile, pathPlan, { includeRecovery: true });
  const cursor = track.getInitialRouteCursor({ pathPlan });
  const nextEdge = track.getEdge(pathPlan.tiles[1].edgeIds[0]);
  check(Boolean(nextEdge), 'Entity-coordinate fixture omitted its next-tile edge');
  const canvas = createCanvas(400, 225);
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    width: 400,
    height: 225,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const basePayload = {
    routeCursor: cursor,
    pathPlan,
    playerFrame: track.sampleRouteCursor(cursor, 0, {}),
    world: SHARED_WORLD_FIXTURE,
    overviewProgress: 1,
    guidedProgress: 0
  };
  let diagnostics = minimap.update({
    ...basePayload,
    hazards: Object.freeze([Object.freeze({
      kind: 'obstacle',
      routeRef: Object.freeze({ edgeId: nextEdge.id, edgeS: nextEdge.length * 0.25, lateral: 0 })
    })])
  });
  check(diagnostics.externalEntityEdgeResolveCount === 1
    && diagnostics.rejectedEntityCoordinateCount === 0,
  'Map did not resolve the next-tile entity through the global track contract', diagnostics);

  diagnostics = minimap.update({
    ...basePayload,
    hazards: Object.freeze([Object.freeze({
      kind: 'obstacle',
      routeRef: Object.freeze({ edgeId: 'missing-edge', edgeS: 10, lateral: 0 })
    })])
  });
  check(diagnostics.hazardDrawCount === 0 && diagnostics.rejectedEntityCoordinateCount === 1,
    'Malformed entity silently fell back to the map origin', diagnostics);

  let rejectEntitySample = false;
  const brokenSampleTrack = {
    ...track,
    sampleEdge(edgeId, edgeS, lateral, output) {
      if (rejectEntitySample && edgeId === nextEdge.id) return undefined;
      return track.sampleEdge(edgeId, edgeS, lateral, output);
    }
  };
  const brokenSampleMinimap = mapFactory.create({
    canvas: createCanvas(400, 225),
    track: brokenSampleTrack,
    graph,
    width: 400,
    height: 225,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  rejectEntitySample = true;
  diagnostics = brokenSampleMinimap.update({
    ...basePayload,
    hazards: Object.freeze([Object.freeze({
      kind: 'obstacle',
      routeRef: Object.freeze({ edgeId: nextEdge.id, edgeS: nextEdge.length * 0.25, lateral: 0 })
    })])
  });
  check(diagnostics.hazardDrawCount === 0 && diagnostics.rejectedEntityCoordinateCount === 1,
    'Invalid edge-sampler output silently fell back to the map origin', diagnostics);
  brokenSampleMinimap.destroy();

  let invalidSceneContractRejected = false;
  try {
    minimap.update({
      ...basePayload,
      world: Object.freeze({ ...SHARED_WORLD_FIXTURE, coordinateMode: 'render-relative-xz' })
    });
  } catch (error) {
    invalidSceneContractRejected = error instanceof TypeError
      && error.message.includes('absolute-world-xz');
  }
  check(invalidSceneContractRejected,
    'Map accepted a scene payload whose coordinate mode can diverge from 3D');
  minimap.destroy();
  return {
    nextTileEdgeResolved: true,
    malformedCoordinateRejected: true,
    brokenSampleRejected: true,
    invalidSceneContractRejected: true
  };
}

function validateResponsiveStyles() {
  const css = fs.readFileSync(
    path.join(PROJECT_ROOT, 'styles/Neon_Autopilot_HighSpeed_DroneHeat.css'),
    'utf8'
  );
  check(css.includes('clamp(360px, 34vw, 560px)')
    && css.includes('calc(50vw - var(--safe-right) - 96px)'),
  'Desktop minimap does not retain its bounded speed-alert corridor', null);
  check(css.includes('.minimap-panel.is-super-expanded.is-cloverleaf:is(.is-overview, .is-guided)')
    && !css.includes('clamp(560px, 52vw, 720px)'),
  'Desktop map modes do not share one stable shell width', null);
  check(css.includes('--min-flight-gap: clamp(48px, 15vw, 62px)')
    && css.includes('--compact-minimap-width: min('),
  'Compact map does not derive width from the protected flight corridor', null);
  check(css.includes('clamp(160px, 26vw, 220px)')
    && css.includes('calc(50vw - var(--safe-right) - 28px)'),
  'Landscape map does not retain its normal and short-screen corridor caps', null);
  check(css.includes('aspect-ratio: 16 / 9')
    && css.includes('aspect-ratio: 40 / 27'),
  'Responsive minimap aspect contracts are missing', null);
  check(!css.includes('--short-landscape-map-width')
    && !css.includes('height: 108px'),
  'Deprecated fixed expansion rules can still override the stable map shell', null);
  return {
    desktop: 'stable-350-560',
    desktopModes: 'single-shell',
    landscapeMobile: 'corridor-capped-160-220',
    portrait: 'flight-gap-derived',
    aspect: '40:27-compact/16:9-landscape'
  };
}

function validateCompassDiagnostics(diagnostics, resolution, northUp = true) {
  const compact = resolution.width <= COMPACT_MAX_WIDTH_PX;
  const context = { width: resolution.width, height: resolution.height };

  if (!compact) {
    check(diagnostics.compassDrawCount === 0 && diagnostics.compassPlacement === 'external-desktop',
      'Desktop map duplicated the standalone viewport compass', {
        ...context,
        draws: diagnostics.compassDrawCount,
        placement: diagnostics.compassPlacement
      });
    check(diagnostics.compassRadiusPx === 0
      && diagnostics.compassInsetPx === 0
      && diagnostics.compassX === 0
      && diagnostics.compassY === 0,
    'External desktop compass retained stale map geometry', {
      ...context,
      radius: diagnostics.compassRadiusPx,
      inset: diagnostics.compassInsetPx,
      x: diagnostics.compassX,
      y: diagnostics.compassY
    });
  } else {
    const radius = 13;
    const inset = 8;
    check(diagnostics.compassDrawCount === 1
      && diagnostics.compassPlacement === 'compact-map-bottom-right',
    'Compact map did not retain its bottom-right internal compass', {
      ...context,
      draws: diagnostics.compassDrawCount,
      placement: diagnostics.compassPlacement
    });
    checkNear(diagnostics.compassRadiusPx, radius, 0.000_001,
      'Compact compass radius diverges from its responsive contract');
    checkNear(diagnostics.compassInsetPx, inset, 0.000_001,
      'Compact compass inset diverges from its responsive contract');
    checkNear(diagnostics.compassX, resolution.width - inset - radius, 0.000_001,
      'Compact compass horizontal anchor is not bottom-right');
    checkNear(diagnostics.compassY, resolution.height - inset - radius, 0.000_001,
      'Compact compass vertical anchor is not bottom-right');
  }
  check(Number.isFinite(diagnostics.compassBearingDeg)
    && diagnostics.compassBearingDeg >= 0
    && diagnostics.compassBearingDeg < 360,
  'Compass bearing is outside the live 000-359 degree contract', {
    ...context,
    bearing: diagnostics.compassBearingDeg
  });
  if (northUp) {
    checkNear(diagnostics.compassNorthAngleRad, -Math.PI * 0.5, 0.000_001,
      'North-up map did not keep the compass north needle fixed upward');
  }
}

/** Tactical modes deliberately crop distant graph arms so the current road remains readable. */
function validateReadableTacticalViewport(diagnostics, resolution, mode) {
  const compact = resolution.width <= COMPACT_MAX_WIDTH_PX;
  const visibleSpanLimit = mode === 'guided'
    ? (compact ? COMPACT_GUIDED_VISIBLE_SPAN_M : DESKTOP_GUIDED_VISIBLE_SPAN_M)
    : (compact ? COMPACT_OVERVIEW_VISIBLE_SPAN_M : DESKTOP_OVERVIEW_VISIBLE_SPAN_M);
  const context = { mode, width: resolution.width, height: resolution.height };
  check(diagnostics.mapScalePxPerM >= resolution.height / visibleSpanLimit - 0.000_001,
    'Tactical map scale fell below its readability floor', {
      ...context,
      scale: diagnostics.mapScalePxPerM,
      minimum: resolution.height / visibleSpanLimit
    });
  check(diagnostics.visibleWorldHeightM <= visibleSpanLimit + 0.001,
    'Tactical map exposes too much world distance to remain readable', {
      ...context,
      actual: diagnostics.visibleWorldHeightM,
      limit: visibleSpanLimit
    });
  check(diagnostics.scaleBarMeters > 0 && diagnostics.scaleBarMeters <= 200,
    'Tactical scale bar is too coarse for current-road decisions', {
      ...context,
      scaleBarMeters: diagnostics.scaleBarMeters
    });
  check(diagnostics.playerClamped === false,
    'Path-focused tactical transform pushed the player into viewport clamping', {
      ...context,
      x: diagnostics.playerViewportX,
      y: diagnostics.playerViewportY
    });
  check(diagnostics.playerViewportX >= 0 && diagnostics.playerViewportX <= resolution.width
    && diagnostics.playerViewportY >= 0 && diagnostics.playerViewportY <= resolution.height,
  'Projected player is outside the tactical viewport', {
    ...context,
    x: diagnostics.playerViewportX,
    y: diagnostics.playerViewportY
  });
  check(diagnostics.playerDrawCount === 1 && diagnostics.playerClamped === false,
    'Player marker was omitted or forged at the viewport edge', {
      ...context,
      draws: diagnostics.playerDrawCount,
      clamped: diagnostics.playerClamped
    });
  check(Number.isFinite(diagnostics.focusAheadM) && diagnostics.focusAheadM > 0,
    'Tactical transform omitted its path-relative forward focus', {
      ...context,
      focusAheadM: diagnostics.focusAheadM
    });
}

function validateGuidedReadability(graph, resolution) {
  const canvas = createCanvas(resolution.width, resolution.height);
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    width: resolution.width,
    height: resolution.height,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const diagnostics = minimap.update({
    ...movementPayload('south-straight'),
    guidedProgress: 1
  });
  check(diagnostics.mapMode === 'guided' && diagnostics.guidedProgress === 1 && diagnostics.northUp,
    'Guided fixture did not initialize in north-up tactical mode', diagnostics);
  validateReadableTacticalViewport(diagnostics, resolution, 'guided');
  validateCompassDiagnostics(diagnostics, resolution);
  minimap.destroy();
  return {
    visibleWorldHeightM: diagnostics.visibleWorldHeightM,
    scaleBarMeters: diagnostics.scaleBarMeters,
    playerClamped: diagnostics.playerClamped
  };
}

/** Compact maps retain cardinal coverage while desktop delegates rendering to the viewport instrument. */
function validateCompassBearingContract(graph) {
  const resolution = Object.freeze({ width: 240, height: 135 });
  const canvas = createCanvas(resolution.width, resolution.height);
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    width: resolution.width,
    height: resolution.height,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const basePayload = movementPayload('south-straight');
  const cardinalFrames = Object.freeze([
    Object.freeze({ label: 'N', tangentX: 0, tangentZ: -1, bearing: 0 }),
    Object.freeze({ label: 'E', tangentX: 1, tangentZ: 0, bearing: 90 }),
    Object.freeze({ label: 'S', tangentX: 0, tangentZ: 1, bearing: 180 }),
    Object.freeze({ label: 'W', tangentX: -1, tangentZ: 0, bearing: 270 })
  ]);
  const bearings = {};
  for (const cardinal of cardinalFrames) {
    const diagnostics = minimap.update({
      ...basePayload,
      routeCursor: null,
      pathPlan: null,
      playerFrame: {
        x: 0,
        y: 0,
        z: 0,
        tangentX: cardinal.tangentX,
        tangentZ: cardinal.tangentZ
      }
    });
    checkNear(diagnostics.compassBearingDeg, cardinal.bearing, 0.000_001,
      `${cardinal.label} heading produced the wrong live bearing`);
    validateCompassDiagnostics(diagnostics, resolution);
    bearings[cardinal.label] = Math.round(diagnostics.compassBearingDeg);
  }
  minimap.destroy();
  return bearings;
}

/** Coarse-pointer tablets receive a map-local compass when CSS hides the standalone desktop instrument. */
function validateCompassFallbackContract(graph) {
  const canvas = createCanvas(400, 225);
  let externalCompassVisible = false;
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas,
    isExternalCompassVisible: () => externalCompassVisible
  });
  let diagnostics = minimap.update(movementPayload('south-straight'));
  check(diagnostics.compassDrawCount === 1
    && diagnostics.compassPlacement === 'map-bottom-right-fallback'
    && diagnostics.compassRadiusPx === 18
    && diagnostics.compassInsetPx === 12,
  'Wide coarse-pointer map did not draw its internal compass fallback', diagnostics);
  externalCompassVisible = true;
  diagnostics = minimap.update(movementPayload('south-straight'));
  check(diagnostics.compassDrawCount === 0
    && diagnostics.compassPlacement === 'external-desktop',
  'Map duplicated the compass after the external instrument became visible', diagnostics);
  minimap.destroy();
  return {
    hiddenExternal: 'map-bottom-right-fallback',
    visibleExternal: diagnostics.compassPlacement
  };
}

/** A tactical crop may omit distant fixtures, but every shared category inside the viewport must still render. */
function validateViewportSceneDrawing(graph) {
  const resolution = Object.freeze({ width: 240, height: 135 });
  const payload = movementPayload('south-straight');
  const player = payload.playerFrame;
  const sceneryEntities = Object.freeze([
    Object.freeze({ id: 'viewport-landmark', category: 'landmark', visible: true,
      x: player.x - 18, y: 2, z: player.z, heading: 0.2, radiusM: 6, zoneIndex: 0 }),
    Object.freeze({ id: 'viewport-environment', category: 'environment', visible: true,
      x: player.x + 18, y: 1, z: player.z, heading: -0.4, radiusM: 5, zoneIndex: 0 }),
    Object.freeze({ id: 'viewport-air-traffic', category: 'air-traffic', visible: true,
      x: player.x, y: 18, z: player.z - 18, heading: 0.8, radiusM: 4, zoneIndex: 0 }),
    Object.freeze({ id: 'viewport-dark-dragon', category: 'dark-dragon', visible: true,
      x: player.x, y: 26, z: player.z + 18, heading: -1.1, radiusM: 8, zoneIndex: 0 })
  ]);
  const world = Object.freeze({
    ...SHARED_WORLD_FIXTURE,
    sceneryEntities,
    sceneryRevision: 29
  });
  const minimap = mapFactory.create({
    canvas: createCanvas(resolution.width, resolution.height),
    track,
    graph,
    width: resolution.width,
    height: resolution.height,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const diagnostics = minimap.update({ ...payload, world });
  check(diagnostics.sceneSceneryInputCount === 4
    && diagnostics.sceneSceneryVisibleCount === 4
    && diagnostics.sceneSceneryDrawCount === 4
    && diagnostics.sceneLandmarkDrawCount === 1
    && diagnostics.sceneEnvironmentDrawCount === 1
    && diagnostics.sceneAirTrafficDrawCount === 1
    && diagnostics.sceneDarkDragonDrawCount === 1,
  'Shared scenery inside the compact tactical viewport was not rendered by category', diagnostics);
  check(diagnostics.sceneScenerySnapshotHash === scenerySnapshotHash(sceneryEntities)
    && diagnostics.sceneEntityRevision === world.sceneryRevision,
  'Viewport scenery ids or absolute poses diverged before drawing', diagnostics);
  minimap.destroy();
  return {
    inputs: diagnostics.sceneSceneryInputCount,
    draws: diagnostics.sceneSceneryDrawCount,
    snapshotHash: diagnostics.sceneScenerySnapshotHash
  };
}

function validateRoadDetail(resolution) {
  const pathPlan = track.createPathPlan({ movementId: 'south-left', futureMovementKind: 'straight' });
  const tile = pathPlan.tiles[0];
  const graph = tilePool.graphForTile(track, tile, pathPlan, { includeRecovery: true });
  const recoveryEdgeId = graph.recoveryEdgeIds.find((edgeId) => track.getEdge(edgeId)?.family === 'recovery');
  const recoveryEdge = track.getEdge(recoveryEdgeId);
  check(Boolean(recoveryEdge), 'Road-detail fixture could not find a recovery edge');
  const cursor = track.RoutePosition({
    edgeId: recoveryEdge.id,
    edgeS: recoveryEdge.length * 0.32,
    runDistance: recoveryEdge.length * 0.32,
    tileIndex: recoveryEdge.tileIndex,
    entryPort: recoveryEdge.entryPort
  });
  const canvas = createCanvas(resolution.width, resolution.height);
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    width: resolution.width,
    height: resolution.height,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const hazardEdgeS = Math.min(recoveryEdge.length - 12, cursor.edgeS + 80);
  const pickupEdgeS = Math.min(recoveryEdge.length - 12, cursor.edgeS + 180);
  const hazards = Object.freeze([
    Object.freeze({
      id: 'road-detail-hazard',
      kind: 'obstacle',
      routeRef: Object.freeze({ edgeId: recoveryEdge.id, edgeS: hazardEdgeS, lateral: 0 })
    })
  ]);
  const pickups = Object.freeze([
    Object.freeze({
      id: 'road-detail-pickup',
      kind: 'pickup',
      routeRef: Object.freeze({ edgeId: recoveryEdge.id, edgeS: pickupEdgeS, lateral: 1.4 })
    })
  ]);
  const diagnostics = minimap.update({
    routeCursor: cursor,
    pathPlan: { ...pathPlan, edgeIds: [recoveryEdge.id] },
    proposal: null,
    playerFrame: track.sampleRouteCursor(cursor, 0, {}),
    entities: Object.freeze([]),
    hazards,
    pickups,
    world: SHARED_WORLD_FIXTURE,
    overviewProgress: 0,
    guidedProgress: 0,
    roadDetailProgress: 1
  });
  check(diagnostics.mapMode === 'road-detail', 'Recovery map did not enter road-detail mode', diagnostics.mapMode);
  check(diagnostics.roadDetailRoadBandCount === 1, 'Road-detail mode omitted the physical road band');
  const minimumRoadDetailTicks = Math.max(2, Math.floor(diagnostics.roadDetailVisibleAheadM / 100));
  check(diagnostics.roadDetailTickCount >= minimumRoadDetailTicks,
    'Road-detail mode omitted 100m distance ticks', {
      actual: diagnostics.roadDetailTickCount,
      minimum: minimumRoadDetailTicks,
      visibleAheadM: diagnostics.roadDetailVisibleAheadM
    });
  check(diagnostics.hazardDrawCount === 1, 'Road-detail mode omitted the on-road hazard', diagnostics);
  check(diagnostics.pickupDrawCount === 1, 'Road-detail mode omitted the on-road candlelight pickup', diagnostics);
  check(diagnostics.playerClamped === false, 'Road-detail zoom pushed the player marker into clamping', diagnostics);
  if (resolution.width > COMPACT_MAX_WIDTH_PX) {
    const requestedLookAheadM = 155;
    const expectedScale = Math.min(
      DESKTOP_ROAD_DETAIL_MAX_SCALE,
      Math.max(
        DESKTOP_ROAD_DETAIL_MIN_SCALE,
        resolution.height * 0.5 / (DESKTOP_ROAD_DETAIL_TARGET_AHEAD_M - requestedLookAheadM)
      )
    );
    const expectedLookAheadM = Math.min(
      requestedLookAheadM,
      Math.max(0, (resolution.height * 0.5 - (PLAYER_ARROW_PX + 1)) / expectedScale)
    );
    checkNear(diagnostics.roadDetailScale, expectedScale, 0.000_001, 'Desktop road-detail scale is wrong');
    checkNear(
      diagnostics.roadDetailVisibleAheadM,
      resolution.height * 0.5 / expectedScale + expectedLookAheadM,
      1,
      'Desktop road-detail visible distance is outside its projection contract'
    );
    check(diagnostics.roadDetailRoadWidthPx >= 10,
      'Desktop road-detail zoom left the physical road too narrow to read', diagnostics.roadDetailRoadWidthPx);
    checkNear(diagnostics.roadDetailObstacleMarkerWidthPx, 9.2, 0.000_001,
      'Desktop road-detail zoom did not enlarge obstacle markers');
    checkNear(diagnostics.roadDetailPickupMarkerDiameterPx, 7.2, 0.000_001,
      'Desktop road-detail zoom did not enlarge candlelight markers');
    check(diagnostics.roadDetailLegendCount === 0,
      'Desktop road-detail duplicated the persistent DOM obstacle/candlelight legend');
    checkNear(diagnostics.worldCacheScalePxPerM, DESKTOP_WORLD_CACHE_SCALE, 0.000_001,
      'Desktop road-detail zoom inflated the full-world topology cache');
  } else {
    checkNear(diagnostics.roadDetailScale, 0.16, 0.000_001, 'Compact road-detail scale is wrong');
    checkNear(
      diagnostics.roadDetailVisibleAheadM,
      resolution.height * 0.5 / 0.16 + 105,
      1,
      'Compact road-detail visible distance is outside its projection contract'
    );
    checkNear(diagnostics.roadDetailObstacleMarkerWidthPx, 4.6, 0.000_001,
      'Compact road-detail obstacle marker changed with the desktop-only zoom');
    checkNear(diagnostics.roadDetailPickupMarkerDiameterPx, 3.6, 0.000_001,
      'Compact road-detail pickup marker changed with the desktop-only zoom');
    check(diagnostics.roadDetailLegendCount === 0,
      'Compact road-detail duplicated the desktop-only marker legend');
    checkNear(diagnostics.worldCacheScalePxPerM, 0.16, 0.000_001,
      'Compact world-cache scale changed with the desktop-only zoom');
  }
  check(
    diagnostics.roadDetailControlCount === 0,
    'Route-map canvas duplicated controls owned by the persistent viewport tracker'
  );
  const approachEdge = track.getEdge(`approach-${tile.entryPort}`);
  check(Boolean(approachEdge), 'Road-detail fixture could not find a non-interchange approach edge');
  const approachCursor = track.RoutePosition({
    edgeId: approachEdge.id,
    edgeS: approachEdge.length * 0.25,
    runDistance: approachEdge.length * 0.25,
    tileIndex: tile.index,
    entryPort: tile.entryPort
  });
  const approachDiagnostics = minimap.update({
    routeCursor: approachCursor,
    pathPlan: { ...pathPlan, edgeIds: [approachEdge.id] },
    proposal: null,
    playerFrame: track.sampleRouteCursor(approachCursor, 0, {}),
    entities: Object.freeze([]),
    hazards: Object.freeze([]),
    pickups: Object.freeze([]),
    world: SHARED_WORLD_FIXTURE,
    overviewProgress: 0,
    guidedProgress: 0,
    roadDetailProgress: 1
  });
  check(approachDiagnostics.roadDetailRoadBandCount === 1,
    'Non-interchange approach omitted its super-zoom road band', approachDiagnostics);
  check(approachDiagnostics.roadDetailTickCount >= minimumRoadDetailTicks,
    'Non-interchange approach omitted its distance ticks', approachDiagnostics);
  const result = {
    mode: diagnostics.mapMode,
    scale: diagnostics.roadDetailScale,
    visibleAheadM: diagnostics.roadDetailVisibleAheadM,
    roadBands: diagnostics.roadDetailRoadBandCount,
    ticks: diagnostics.roadDetailTickCount,
    controls: diagnostics.roadDetailControlCount,
    approachRoadBands: approachDiagnostics.roadDetailRoadBandCount
  };
  minimap.destroy();
  return result;
}

function validateOverviewDiagnostics(diagnostics, movementId, resolution) {
  const context = { movementId, width: resolution.width, height: resolution.height };
  check(
    diagnostics.cssWidth === resolution.width && diagnostics.cssHeight === resolution.height,
    'Overview CSS size diverges from the responsive contract',
    { ...context, cssWidth: diagnostics.cssWidth, cssHeight: diagnostics.cssHeight }
  );
  check(
    diagnostics.bufferWidth === resolution.width && diagnostics.bufferHeight === resolution.height,
    'Overview backing buffer size diverges at DPR 1',
    { ...context, bufferWidth: diagnostics.bufferWidth, bufferHeight: diagnostics.bufferHeight }
  );
  check(diagnostics.northUp, 'Overview is not north-up', context);
  check(diagnostics.overviewProgress === 1 && diagnostics.guidedProgress === 0, 'Overview transform state is wrong', context);
  validateReadableTacticalViewport(diagnostics, resolution, 'overview');
  validateCompassDiagnostics(diagnostics, resolution);
  check(diagnostics.routeGapCount === 0, 'Overview contains a selected-route discontinuity', {
    ...context,
    routeGapCount: diagnostics.routeGapCount,
    routeGapMaxPx: diagnostics.routeGapMaxPx
  });
  check(diagnostics.routeGapMaxPx <= 0.75, 'Overview route gap exceeds 0.75px', {
    ...context,
    routeGapMaxPx: diagnostics.routeGapMaxPx
  });
  check(diagnostics.chordErrorMaxPx <= 0.25, 'Overview chord error exceeds 0.25px', {
    ...context,
    chordErrorMaxPx: diagnostics.chordErrorMaxPx
  });
  check(diagnostics.arrowTangentErrorDeg <= 0.5, 'Overview arrow diverges from the projected edge tangent', {
    ...context,
    arrowTangentErrorDeg: diagnostics.arrowTangentErrorDeg
  });
  check(diagnostics.labelOverlapCount === 0, 'Rendered overview labels overlap', {
    ...context,
    labelOverlapCount: diagnostics.labelOverlapCount
  });
  check(diagnostics.labelClippedCount === 0, 'Rendered overview labels are clipped', {
    ...context,
    labelClippedCount: diagnostics.labelClippedCount
  });
  check(diagnostics.labelDrawCount >= 1 && diagnostics.selectedLabelDrawCount >= 1,
    'Overview did not retain a readable label for the selected route', {
      ...context,
      labelDrawCount: diagnostics.labelDrawCount,
      selectedLabelDrawCount: diagnostics.selectedLabelDrawCount,
      labelRepositionCount: diagnostics.labelRepositionCount,
      labelClipRejectedCount: diagnostics.labelClipRejectedCount,
      labelOverlapRejectedCount: diagnostics.labelOverlapRejectedCount
    });
  check(diagnostics.bridgeLayerErrorCount === 0, 'Overview bridge layers are inverted or incomplete', {
    ...context,
    bridgeLayerErrorCount: diagnostics.bridgeLayerErrorCount
  });
  check(diagnostics.tunnelSegmentCount === 8, 'Overview did not retain all real tunnel-profile spans', {
    ...context,
    tunnelSegmentCount: diagnostics.tunnelSegmentCount
  });
  check(diagnostics.sceneContractVersion === 1
    && diagnostics.sceneCoordinateMode === 'absolute-world-xz'
    && diagnostics.sceneTerrainSource === 'payload.world.terrainCells'
    && diagnostics.sceneScenerySource === 'payload.world.sceneryEntities',
  'Overview does not consume the shared absolute-world scene contract', {
    ...context,
    coordinateMode: diagnostics.sceneCoordinateMode,
    terrainSource: diagnostics.sceneTerrainSource,
    scenerySource: diagnostics.sceneScenerySource
  });
  check(diagnostics.sceneTerrainPaletteCount === EXPECTED_TERRAIN_PALETTE.length
    && JSON.stringify(diagnostics.sceneTerrainPalette) === JSON.stringify(EXPECTED_TERRAIN_PALETTE),
  'Shared terrain colors diverge from the configured 3D biome bases', {
    ...context,
    expected: EXPECTED_TERRAIN_PALETTE,
    actual: diagnostics.sceneTerrainPalette
  });
  check(diagnostics.sceneTerrainInputCount === SHARED_TERRAIN_CELLS.length
    && diagnostics.sceneTerrainDrawCount > 0
    && diagnostics.sceneTerrainDrawCount <= SHARED_TERRAIN_CELLS.length,
  'Overview did not consume the exact retained 96m terrain-cell set', {
    ...context,
    inputs: diagnostics.sceneTerrainInputCount,
    draws: diagnostics.sceneTerrainDrawCount
  });
  check(diagnostics.sceneTerrainZoneMask === 1
    && diagnostics.sceneTerrainSnapshotHash === EXPECTED_TERRAIN_SNAPSHOT_HASH
    && diagnostics.sceneTerrainRevision === SHARED_WORLD_FIXTURE.terrainRevision,
  'Overview invented terrain zones or changed shared cell coordinates', {
    ...context,
    zoneMask: diagnostics.sceneTerrainZoneMask,
    actualHash: diagnostics.sceneTerrainSnapshotHash,
    expectedHash: EXPECTED_TERRAIN_SNAPSHOT_HASH,
    revision: diagnostics.sceneTerrainRevision
  });
  check(diagnostics.sceneSceneryInputCount === SHARED_SCENERY_ENTITIES.length
    && diagnostics.sceneSceneryVisibleCount === 4
    && diagnostics.sceneScenerySnapshotHash === EXPECTED_SCENERY_SNAPSHOT_HASH
    && diagnostics.sceneEntityRevision === SHARED_WORLD_FIXTURE.sceneryRevision,
  'Overview changed shared scenery ids, visibility, or absolute poses', {
    ...context,
    inputs: diagnostics.sceneSceneryInputCount,
    visible: diagnostics.sceneSceneryVisibleCount,
    actualHash: diagnostics.sceneScenerySnapshotHash,
    expectedHash: EXPECTED_SCENERY_SNAPSHOT_HASH,
    revision: diagnostics.sceneEntityRevision
  });
  const sceneryCategoryDrawCount = diagnostics.sceneLandmarkDrawCount
    + diagnostics.sceneEnvironmentDrawCount
    + diagnostics.sceneAirTrafficDrawCount
    + diagnostics.sceneDarkDragonDrawCount;
  check(diagnostics.sceneSceneryDrawCount <= diagnostics.sceneSceneryVisibleCount
    && sceneryCategoryDrawCount === diagnostics.sceneSceneryDrawCount
    && diagnostics.sceneLandmarkDrawCount <= 1
    && diagnostics.sceneEnvironmentDrawCount <= 1
    && diagnostics.sceneAirTrafficDrawCount <= 1
    && diagnostics.sceneDarkDragonDrawCount <= 1,
  'Overview did not draw the shared scenery records that fall inside its tactical viewport', {
    ...context,
    draws: diagnostics.sceneSceneryDrawCount,
    landmarks: diagnostics.sceneLandmarkDrawCount,
    environments: diagnostics.sceneEnvironmentDrawCount,
    airTraffic: diagnostics.sceneAirTrafficDrawCount,
    darkDragons: diagnostics.sceneDarkDragonDrawCount
  });
  check(diagnostics.sceneSyntheticObjectCount === 0
    && diagnostics.sceneRejectedCoordinateCount === 0
    && diagnostics.rejectedEntityCoordinateCount === 0,
  'Overview retained synthetic scenery or rejected a valid shared coordinate', context);
  check(diagnostics.sceneLayerOrder === 'shared-terrain>shared-scenery>roads>route-navigation',
    'Shared scene layer order changed', diagnostics.sceneLayerOrder);
}

function validateResolution(graph, resolution) {
  const canvas = createCanvas(resolution.width, resolution.height);
  const minimap = mapFactory.create({
    canvas,
    track,
    graph,
    width: resolution.width,
    height: resolution.height,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    createCanvas
  });
  const maxima = {
    routeGapPx: 0,
    chordErrorPx: 0,
    arrowErrorDegrees: 0,
    networkClippedSamples: 0,
    labelOverlapCount: 0,
    labelClippedCount: 0,
    bridgeLayerErrorCount: 0,
    labelOverlapRejectedCount: 0,
    labelClipRejectedCount: 0
  };

  let movementCount = 0;
  for (const entryPort of PORTS) {
    for (const kind of KINDS) {
      const movementId = `${entryPort}-${kind}`;
      const diagnostics = minimap.update(movementPayload(movementId));
      validateOverviewDiagnostics(diagnostics, movementId, resolution);
      movementCount += 1;
      maxima.routeGapPx = Math.max(maxima.routeGapPx, diagnostics.routeGapMaxPx);
      maxima.chordErrorPx = Math.max(maxima.chordErrorPx, diagnostics.chordErrorMaxPx);
      maxima.arrowErrorDegrees = Math.max(maxima.arrowErrorDegrees, diagnostics.arrowTangentErrorDeg);
      maxima.networkClippedSamples = Math.max(maxima.networkClippedSamples, diagnostics.networkClippedSamples);
      maxima.labelOverlapCount = Math.max(maxima.labelOverlapCount, diagnostics.labelOverlapCount);
      maxima.labelClippedCount = Math.max(maxima.labelClippedCount, diagnostics.labelClippedCount);
      maxima.bridgeLayerErrorCount = Math.max(maxima.bridgeLayerErrorCount, diagnostics.bridgeLayerErrorCount);
      maxima.labelOverlapRejectedCount = Math.max(
        maxima.labelOverlapRejectedCount,
        diagnostics.labelOverlapRejectedCount
      );
      maxima.labelClipRejectedCount = Math.max(maxima.labelClipRejectedCount, diagnostics.labelClipRejectedCount);
    }
  }
  check(movementCount === 12, 'Resolution did not exercise all twelve movements', movementCount);

  const steadyPayload = movementPayload('south-left');
  minimap.update(steadyPayload);
  let steadyDiagnostics = null;
  for (let frame = 0; frame < STEADY_FRAMES; frame += 1) {
    steadyDiagnostics = minimap.update(steadyPayload);
  }
  check(steadyDiagnostics.staticCacheHitCount >= STEADY_FRAMES, 'Steady overview did not reuse its static cache', {
    staticCacheHitCount: steadyDiagnostics.staticCacheHitCount,
    frames: STEADY_FRAMES
  });
  validateOverviewDiagnostics(steadyDiagnostics, 'south-left:steady', resolution);

  const result = {
    width: resolution.width,
    height: resolution.height,
    movements: movementCount,
    steadyFrames: STEADY_FRAMES,
    drawP95Ms: steadyDiagnostics.drawP95Ms,
    tunnelSegmentCount: steadyDiagnostics.tunnelSegmentCount,
    sharedTerrainCells: steadyDiagnostics.sceneTerrainInputCount,
    sharedTerrainSnapshotHash: steadyDiagnostics.sceneTerrainSnapshotHash,
    sharedSceneryEntities: steadyDiagnostics.sceneSceneryInputCount,
    sharedScenerySnapshotHash: steadyDiagnostics.sceneScenerySnapshotHash,
    syntheticSceneObjects: steadyDiagnostics.sceneSyntheticObjectCount,
    staticCacheBuildCount: steadyDiagnostics.staticCacheBuildCount,
    staticCacheHitCount: steadyDiagnostics.staticCacheHitCount,
    ...maxima,
    guided: validateGuidedReadability(graph, resolution),
    roadDetail: validateRoadDetail(resolution)
  };
  minimap.destroy();
  return result;
}

/**
 * Reuse the exact deterministic map workloads for non-gating timing observation.
 * The returned wall-clock diagnostics are data only; all assertions above cover
 * cache reuse, draw counts, bounded audits, and map structure rather than speed.
 */
function collectMapDrawPerformanceSample() {
  check(track && tilePool && mapFactory, 'Cloverleaf map benchmark dependencies did not load');
  const graph = createGraphFixture();
  return Object.freeze({
    movingWorldCache: validateMovingWorldCache(graph),
    resolutions: Object.freeze(RESOLUTIONS.map((resolution) => validateResolution(graph, resolution)))
  });
}

/** Prove retained Canvas payloads redraw from stable route data instead of caching one language's labels. */
function validateBilingualCanvasLabels(graph) {
  const internalCanvases = [];
  const i18n = i18nLibrary.createI18n(
    { location: { search: '' } },
    {
      document: null,
      startup: {
        readString() { return 'zh-CN'; },
        writeString() { return true; }
      },
      autoApply: false,
      observe: false
    }
  );
  globalThis.NeonI18n = i18n;
  const canvas = createCanvas(400, 225);
  const standbyCanvas = createCanvas(400, 225);
  const minimap = productionMapFactory.create({
    canvas,
    standbyCanvas,
    track,
    graph,
    width: 400,
    height: 225,
    dpr: 1,
    maxDpr: 1,
    sampleStep: 4,
    isExternalCompassVisible: () => false,
    createCanvas(width, height) {
      const created = createCanvas(width, height);
      internalCanvases.push(created);
      return created;
    }
  });
  const payload = movementPayload('south-left');
  minimap.update(payload);
  const chineseLabels = internalCanvases.flatMap((surface) => surface.context.fillTextValues);
  check(chineseLabels.includes('北'), 'Chinese Canvas compass label is missing', chineseLabels);
  check(chineseLabels.some((label) => /米/u.test(label)), 'Chinese Canvas distance unit is missing', chineseLabels);

  for (const surface of internalCanvases) surface.context.fillTextValues.length = 0;
  i18n.setLanguage('en', { apply: false, persist: false, source: 'map-test' });
  minimap.update(payload);
  const englishLabels = internalCanvases.flatMap((surface) => surface.context.fillTextValues);
  check(englishLabels.includes('N'), 'English Canvas compass label is missing', englishLabels);
  check(englishLabels.some((label) => /\bm\b/u.test(label)), 'English Canvas distance unit is missing', englishLabels);
  check(!englishLabels.some((label) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(label)),
    'English Canvas retained Han text', englishLabels);
  minimap.destroy();
  delete globalThis.NeonI18n;
  return Object.freeze({
    chineseLabels: chineseLabels.length,
    englishLabels: englishLabels.length,
    englishHasHan: false
  });
}

function run() {
  check(track && tilePool && mapFactory, 'Cloverleaf map dependencies did not load');
  const graph = createGraphFixture();
  const straightForkTileGraph = validateStraightForkTileGraph();
  const tilePrewarm = validateTilePrewarm();
  const airborneRoadPinning = validateAirborneRoadPinning();
  const stagedPinnedRoadPriority = validateStagedPinnedRoadPriority();
  const stagedRoadContinuityHandoff = validateStagedRoadContinuityHandoff();
  const stagedTileBuild = validateStagedTileBuild();
  const warmBuildCriticalPromotion = validateWarmBuildCriticalPromotion();
  const warmBuildTransientRecovery = validateWarmBuildTransientRecovery();
  const warmBuildPersistentFailureBoundary = validateWarmBuildPersistentFailureBoundary();
  const warmBuildFinishFailureCleanup = validateWarmBuildFinishFailureCleanup();
  const warmBuildQualityFailureCleanup = validateWarmBuildQualityFailureCleanup();
  const warmBuildReplacementFailureCleanup = validateWarmBuildReplacementFailureCleanup();
  const disposedLateWarmupCallback = validateDisposedLateWarmupCallback();
  const warmupEpochIsolation = validateWarmupEpochIsolation();
  const synchronousWarmupSchedulers = validateSynchronousWarmupSchedulers();
  const emptyRouteCancelsFailedWarmup = validateEmptyRouteCancelsFailedWarmup();
  const longRunTilePoolBound = validateLongRunTilePoolBound();
  const atomicRecoveryVariants = validateAtomicRecoveryVariants();
  const recoveryVariantInstallFailureCleanup = validateRecoveryVariantInstallFailureCleanup();
  const opposingBypassPrewarmAndCarryOver = validateOpposingBypassPrewarmAndCarryOver();
  const opposingPreflightAcrossCursorReset = validateOpposingPreflightAcrossCursorReset();
  const opposingPreflightLifecycleBound = validateOpposingPreflightLifecycleBound();
  const committedRecoveryPriority = validateCommittedRecoveryPriority();
  const deferredResize = validateDeferredResize(graph);
  const atomicFramePresentation = validateAtomicFramePresentation(graph);
  const transactionalResizeAllocation = validateTransactionalResizeAllocation(graph);
  const worldCacheRenderRecovery = validateWorldCacheRenderRecovery(graph);
  const transactionalGraphRefresh = validateTransactionalGraphRefresh(graph);
  const zeroLayoutFallback = validateZeroLayoutFallback(graph);
  const immutableDiagnosticsAndDestroy = validateImmutableDiagnosticsAndDestroy(graph);
  const highDprPresentation = validateHighDprPresentation(graph);
  const mutablePathSourceInvalidation = validateMutablePathSourceInvalidation(graph);
  const mutableProposalSourceInvalidation = validateMutableProposalSourceInvalidation(graph);
  const debugFaultInjection = validateDebugFaultInjection(graph);
  const smoothModeTransitions = validateSmoothModeTransitions(graph);
  const reducedMotionModeSettlement = validateReducedMotionModeSettlement(graph);
  const movingWorldCache = validateMovingWorldCache(graph);
  const entityCoordinateContract = validateEntityCoordinateContract();
  const responsiveStyles = validateResponsiveStyles();
  const compassBearings = validateCompassBearingContract(graph);
  const compassFallback = validateCompassFallbackContract(graph);
  const viewportSceneDrawing = validateViewportSceneDrawing(graph);
  const bilingualCanvasLabels = validateBilingualCanvasLabels(graph);
  const resolutions = RESOLUTIONS.map((resolution) => validateResolution(graph, resolution));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    graphVersion: graph.version,
    movements: 12,
    straightForkTileGraph,
    tilePrewarm,
    airborneRoadPinning,
    stagedPinnedRoadPriority,
    stagedRoadContinuityHandoff,
    stagedTileBuild,
    warmBuildCriticalPromotion,
    warmBuildTransientRecovery,
    warmBuildPersistentFailureBoundary,
    warmBuildFinishFailureCleanup,
    warmBuildQualityFailureCleanup,
    warmBuildReplacementFailureCleanup,
    disposedLateWarmupCallback,
    warmupEpochIsolation,
    synchronousWarmupSchedulers,
    emptyRouteCancelsFailedWarmup,
    longRunTilePoolBound,
    atomicRecoveryVariants,
    recoveryVariantInstallFailureCleanup,
    opposingBypassPrewarmAndCarryOver,
    opposingPreflightAcrossCursorReset,
    opposingPreflightLifecycleBound,
    committedRecoveryPriority,
    deferredResize,
    atomicFramePresentation,
    transactionalResizeAllocation,
    worldCacheRenderRecovery,
    transactionalGraphRefresh,
    zeroLayoutFallback,
    immutableDiagnosticsAndDestroy,
    highDprPresentation,
    mutablePathSourceInvalidation,
    mutableProposalSourceInvalidation,
    debugFaultInjection,
    smoothModeTransitions,
    reducedMotionModeSettlement,
    movingWorldCache,
    entityCoordinateContract,
    responsiveStyles,
    compassBearings,
    compassFallback,
    viewportSceneDrawing,
    bilingualCanvasLabels,
    resolutions
  })}\n`);
}

module.exports = Object.freeze({ collectMapDrawPerformanceSample });

if (require.main === module) {
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
}
