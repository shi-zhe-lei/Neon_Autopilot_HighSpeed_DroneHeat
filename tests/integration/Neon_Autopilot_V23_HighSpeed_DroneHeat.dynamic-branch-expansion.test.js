'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = globalThis;
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'));
const track = globalThis.NeonV23Track;

/** Cross one shared straight-fork approach using the itinerary's default physical branch. */
function crossSharedApproach() {
  const pathPlan = track.createPathPlan({ entryPort: 'south', kind: 'straight' });
  const approachEdgeId = pathPlan.edgeIds.find(
    (edgeId) => track.getEdge(edgeId)?.family === 'straight-fork-approach'
  );
  assert.ok(approachEdgeId, 'The route did not publish a shared fork approach');
  const approachEdge = track.getEdge(approachEdgeId);
  const previousCursor = {
    edgeId: approachEdge.id,
    edgeS: approachEdge.length - 0.20
  };
  const currentCursor = track.advanceCursor(previousCursor, 0.45, pathPlan);
  assert.equal(track.getEdge(currentCursor.edgeId)?.family, 'straight-fork-branch');
  return { pathPlan, previousCursor, currentCursor };
}

test('dynamic group expands once on the approach-to-branch transition', () => {
  const { previousCursor, currentCursor } = crossSharedApproach();
  const placements = track.getReachableTrafficPlacements(currentCursor, {});
  assert.equal(placements.length, 2);
  assert.equal(new Set(placements.map((placement) => placement.decisionId)).size, 1);
  assert.equal(new Set(placements.map((placement) => placement.movementId)).size, 2);
  assert.equal(new Set(placements.map((placement) => placement.cursor.edgeId)).size, 2);
  assert.ok(placements.every((placement) => placement.cursor.edgeS === currentCursor.edgeS));

  const trafficGroupId = 7_301;
  const copies = placements.map((placement) => ({
    trafficGroupId,
    trafficDecisionId: placement.decisionId,
    trafficMovementId: placement.movementId,
    edgeId: placement.cursor.edgeId,
    edgeS: placement.cursor.edgeS
  }));
  assert.ok(copies.every((copy) => copy.trafficGroupId === trafficGroupId));
  assert.equal(track.getEdge(previousCursor.edgeId).family, 'straight-fork-approach');
  assert.ok(copies.every((copy) => track.getEdge(copy.edgeId).family === 'straight-fork-branch'));

  // Both copies start on a branch, so the transition predicate cannot expand either one again next frame.
  assert.ok(copies.every((copy) => (
    track.getEdge(copy.edgeId).family !== 'straight-fork-approach'
  )));
});

test('an already committed movement remaps the stale default cursor to one current-plan copy', () => {
  const { pathPlan, currentCursor } = crossSharedApproach();
  const uncommitted = track.getReachableTrafficPlacements(currentCursor, {});
  const selected = uncommitted.find(
    (placement) => placement.cursor.edgeId !== currentCursor.edgeId
  );
  assert.ok(selected, 'The fixture did not select the non-default physical branch');
  const committedChoices = { [selected.decisionId]: selected.movementId };
  const committed = track.getReachableTrafficPlacements(currentCursor, committedChoices);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].decisionId, selected.decisionId);
  assert.equal(committed[0].movementId, selected.movementId);
  assert.equal(committed[0].cursor.edgeId, selected.cursor.edgeId);
  assert.notEqual(committed[0].cursor.edgeId, currentCursor.edgeId);
  assert.equal(committed[0].cursor.edgeS, currentCursor.edgeS);

  const committedPlan = track.createPathPlan({
    entryPort: pathPlan.entryPort,
    kind: 'straight',
    committedChoices
  });
  assert.ok(committedPlan.edgeIds.includes(committed[0].cursor.edgeId));
});

test('production transition uses pooled visuals and has one motion-path expansion call', () => {
  const source = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
    'utf8'
  );
  const helperStart = source.indexOf('function expandDynamicObstacleAtStraightFork(');
  const helperEnd = source.indexOf('\n  function sampleEntityPathFrame(', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.match(helperSource, /previousEdge\?\.family !== 'straight-fork-approach'/);
  assert.match(helperSource, /currentEdge\?\.family !== 'straight-fork-branch'/);
  assert.match(helperSource, /_straightForkExpansionDecisionId === currentEdge\.decisionNodeId/);
  assert.doesNotMatch(helperSource, /\|\| entity\._straightForkExpansionDecisionId\) return 0/);
  assert.match(helperSource, /const trafficGroupId = entity\.trafficGroupId/);
  assert.match(helperSource, /acquireObstacleVisual\(/);
  assert.match(helperSource, /acquireObstacleShadow\(\)/);
  assert.match(helperSource, /obstacles\.push\(pair\)/);
  assert.doesNotMatch(helperSource, /clone\(true\)/);

  const motionStart = source.indexOf('function updateObstacleMotion(');
  const motionEnd = source.indexOf('\n  function localZFromS(', motionStart);
  const motionSource = source.slice(motionStart, motionEnd);
  assert.match(motionSource, /const previousEdgeId = entityEdgeId\(obj\)/);
  assert.match(motionSource, /expandDynamicObstacleAtStraightFork\(obj, previousEdgeId\)/);
  assert.equal((source.match(/expandDynamicObstacleAtStraightFork\(/g) || []).length, 2);

  const planStart = source.indexOf('function trafficPathPlanForPlacement(');
  const planEnd = source.indexOf('\n  /** Expand only', planStart);
  assert.match(
    source.slice(planStart, planEnd),
    /state\.routeChoices\[placement\.decisionId\] === placement\.movementId\) return state\.pathPlan/
  );
});
