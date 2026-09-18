'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = globalThis;
require(path.join(
  PROJECT_ROOT,
  'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'
));
const track = globalThis.NeonV23Track;

/** Collect the bounded route/candidate window that mirrors runtime's grounded lease publication. */
function collectPlanWindowTokens(plans, minimumTileIndex, maximumTileIndex) {
  const tokens = new Set();
  for (const plan of plans) {
    for (const tile of plan?.tiles || []) {
      if (tile.index >= minimumTileIndex && tile.index <= maximumTileIndex) {
        tokens.add(tile.token);
      }
    }
  }
  return tokens;
}

test('long-run topology stays bounded without retiring Film, landing, map, or recovery ownership', () => {
  assert.equal(typeof track.pruneRuntimeTopology, 'function');
  assert.equal(typeof track.compactItineraryPlan, 'function');
  assert.equal(typeof track.getRuntimeTopologyDiagnostics, 'function');

  const pathPlan = track.createPathPlan({ entryPort: 'south', kind: 'straight' });
  let cursor = track.getInitialRouteCursor({ pathPlan, entryPort: 'south' });
  let previousCursor = { ...cursor };
  let previousTileIndex = -1;
  let twentyKilometreAudit = null;
  let auditedTileCount = 0;
  let candidatePlanCount = 0;

  // One hundred physical tile changes exceed 600 km and expose both registry growth and token-history growth.
  while ((track.getEdge(cursor.edgeId)?.tileIndex || 0) < 100) {
    previousCursor = { ...cursor };
    cursor = track.advanceRouteCursor(cursor, 6_000, pathPlan).cursor;
    const currentEdge = track.getEdge(cursor.edgeId);
    const currentTileIndex = currentEdge.tileIndex;
    if (currentTileIndex === previousTileIndex) continue;
    previousTileIndex = currentTileIndex;
    auditedTileCount++;
    track.ensureItineraryHorizon(pathPlan, cursor, 3);

    const currentTile = track.getTileForEdge(cursor.edgeId);
    const movements = track.enumerateMovements({
      tileToken: currentTile.token,
      entryPort: currentTile.entryPort
    }).slice(0, 3);
    assert.equal(movements.length, 3, 'The fan-out fixture lost one route family');
    const candidates = movements.map((movement) => track.preparePathPlanCandidate({
      movementId: movement.id,
      decisionId: movement.decisionNodeId,
      committedChoices: {
        ...(pathPlan._committedChoices || {}),
        [movement.decisionNodeId]: movement.id
      },
      futureMovementKind: 'straight'
    }).plan);
    candidatePlanCount += candidates.length;

    const minimumProtectedTileIndex = Math.max(0, currentTileIndex - 1);
    const maximumProtectedTileIndex = currentTileIndex + 3;
    const plans = [pathPlan, ...candidates];
    const liveTileTokens = collectPlanWindowTokens(
      plans,
      minimumProtectedTileIndex,
      maximumProtectedTileIndex
    );
    liveTileTokens.add(track.getEdge(previousCursor.edgeId).tileToken);
    for (const plan of plans) track.compactItineraryPlan(plan, minimumProtectedTileIndex);
    track.pruneRuntimeTopology({
      liveTileTokens,
      minimumProtectedTileIndex,
      maximumProtectedTileIndex
    });

    assert.ok(track.getEdge(cursor.edgeId), 'Current gameplay edge was retired');
    assert.ok(track.getEdge(previousCursor.edgeId), 'Previous-frame/Film edge was retired');
    const currentFrame = track.sampleRouteCursor(cursor, 0, {});
    const filmFrame = track.sampleSignedPathFrame(cursor, -500, pathPlan, 0, {});
    const forwardFrame = track.samplePathFrame(cursor, 500, pathPlan, 0, {});
    for (const frame of [currentFrame, filmFrame, forwardFrame]) {
      assert.ok(Number.isFinite(frame.x) && Number.isFinite(frame.z));
      assert.ok(track.getEdge(frame.edgeId), `Sampled edge was retired: ${frame.edgeId}`);
    }

    const landing = track.queryAirborneLandingSupport(
      currentFrame.x,
      currentFrame.z,
      {
        activeTileTokens: [currentEdge.tileToken],
        pathPlan,
        footprintHalfWidthM: 0.72,
        footprintHalfLengthM: 1.36
      },
      {}
    );
    assert.ok(landing?.edgeId, 'A live road lost its landing authority after pruning');
    const visibleEdges = track.getVisibleEdges({
      bounds: { centerX: currentFrame.x, centerZ: currentFrame.z, radius: 800 },
      pathPlan,
      cursor
    });
    assert.ok(
      visibleEdges.some((edge) => edge.tileToken === currentEdge.tileToken),
      'The bounded map/visibility query omitted the current tile'
    );
    track.queryRoadClearance(currentFrame.x + 20, currentFrame.z, 2, { pathPlan });

    const diagnostics = track.getRuntimeTopologyDiagnostics();
    assert.ok(diagnostics.registeredTileCount <= 30, diagnostics);
    assert.ok(diagnostics.registeredEdgeCount <= 800, diagnostics);
    assert.ok(diagnostics.maximumRegisteredTileCount <= 30, diagnostics);
    assert.ok(diagnostics.maximumRegisteredEdgeCount <= 1_100, diagnostics);
    assert.ok(diagnostics.roadClearanceLastCandidateCount <= 1_100, diagnostics);
    assert.ok(diagnostics.visibleEdgeLastCandidateCount <= 1_100, diagnostics);
    assert.ok(
      diagnostics.maximumRegisteredTokenLength <= diagnostics.maximumTileTokenLengthContract,
      diagnostics
    );
    if (!twentyKilometreAudit && cursor.runDistance >= 20_000) {
      twentyKilometreAudit = {
        distanceM: cursor.runDistance,
        tileIndex: currentTileIndex,
        registeredTileCount: diagnostics.registeredTileCount,
        registeredEdgeCount: diagnostics.registeredEdgeCount,
        maximumRegisteredTokenLength: diagnostics.maximumRegisteredTokenLength
      };
    }
  }

  assert.ok(twentyKilometreAudit, 'The explicit 20 km checkpoint was not reached');
  assert.ok(twentyKilometreAudit.registeredTileCount <= 30, twentyKilometreAudit);
  assert.ok(twentyKilometreAudit.registeredEdgeCount <= 800, twentyKilometreAudit);
  assert.ok(candidatePlanCount >= auditedTileCount * 3);
  const longRunDiagnostics = track.getRuntimeTopologyDiagnostics();
  assert.equal(longRunDiagnostics.tileHistoryDigestHexLength, 32);
  assert.ok(longRunDiagnostics.maximumRegisteredTokenLength <= 55, longRunDiagnostics);
  assert.ok(longRunDiagnostics.registeredTokenCharacterCount <= 1_500, longRunDiagnostics);

  // A detached source lease owns exactly its recovery destination, but must not retain the entire future chain.
  const currentTileIndex = track.getEdge(cursor.edgeId).tileIndex;
  track.ensureItineraryHorizon(pathPlan, cursor, 6);
  const sourceTile = pathPlan.tiles.find((tile) => tile.index === currentTileIndex + 2);
  const destinationTile = pathPlan.tiles.find((tile) => tile.index === currentTileIndex + 3);
  const beyondDestinationTile = pathPlan.tiles.find((tile) => tile.index === currentTileIndex + 4);
  assert.ok(sourceTile && destinationTile && beyondDestinationTile);
  const sourceRecoveryEdges = track.getRecoveryVisualEdgesForTile(sourceTile);
  assert.ok(sourceRecoveryEdges.length > 0, 'The dependency fixture has no recovery seam');
  track.pruneRuntimeTopology({
    liveTileTokens: new Set([sourceTile.token]),
    minimumProtectedTileIndex: 0,
    maximumProtectedTileIndex: 0
  });
  assert.ok(track.getEdge(sourceTile.edgeIds[0]), 'Explicit recovery source lease was retired');
  assert.ok(track.getEdge(destinationTile.edgeIds[0]), 'Recovery dependency destination was retired');
  assert.equal(
    track.getEdge(beyondDestinationTile.edgeIds[0]),
    null,
    'One-hop recovery ownership recursively retained the whole future chain'
  );

  const runtimeSource = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
    'utf8'
  );
  assert.match(runtimeSource, /function publishRuntimeTopologyLeases\(\)/);
  assert.match(runtimeSource, /if \(!state\.grounded\) \{\s*runtimeTopologyPruneDeferredFrameCount\+\+/);
  assert.match(runtimeSource, /cameraRetainedPreviousTokens/);
  assert.match(runtimeSource, /leaseRuntimeTopologyHandshake\(state\.jumpPlatformLandingPreflight\)/);
  assert.match(runtimeSource, /for \(const entity of obstacles\) leaseRuntimeTopologyEntity/);
  assert.match(runtimeSource, /rebaseSceneryAnchorPath\(state\.distance\)/);
});
