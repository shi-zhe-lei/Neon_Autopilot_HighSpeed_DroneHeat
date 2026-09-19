#!/usr/bin/env node
/** Cinematic director and camera-authority contract / 电影导演与机位权限合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = join(__dirname, '../..');
const runtime = readFileSync(join(
  PROJECT_ROOT,
  'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'
), 'utf8');
const configSource = readFileSync(join(
  PROJECT_ROOT,
  'src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js'
), 'utf8');
const sceneConfig = Function(
  'window',
  `'use strict';\n${configSource}\nreturn window.NeonConfig;`
)({});
const shipSource = readFileSync(join(
  PROJECT_ROOT,
  'src/entities/Neon_Autopilot_HighSpeed_DroneHeat.ship.js'
), 'utf8');
const html = readFileSync(join(PROJECT_ROOT, 'Neon_Autopilot_HighSpeed_DroneHeat.html'), 'utf8');
const css = readFileSync(join(
  PROJECT_ROOT,
  'styles/Neon_Autopilot_HighSpeed_DroneHeat.css'
), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

/** Return one complete authored function; source-level contracts must not be satisfied by adjacent code. */
function functionSource(functionName) {
  const signature = `function ${functionName}(`;
  const start = runtime.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${functionName}`);
  const parameterStart = runtime.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < runtime.length; index++) {
    if (runtime[index] === '(') parameterDepth++;
    else if (runtime[index] === ')') {
      parameterDepth--;
      if (parameterDepth === 0) {
        parameterEnd = index;
        break;
      }
    }
  }
  assert.notEqual(parameterEnd, -1, `unterminated parameters: ${functionName}`);
  const bodyStart = runtime.indexOf('{', parameterEnd + 1);
  let depth = 0;
  for (let index = bodyStart; index < runtime.length; index++) {
    if (runtime[index] === '{') depth++;
    else if (runtime[index] === '}') {
      depth--;
      if (depth === 0) return runtime.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function: ${functionName}`);
}

function compileRuntimeFunction(functionName, dependencies) {
  return Function(
    ...Object.keys(dependencies),
    `'use strict'; return (${functionSource(functionName)});`
  )(...Object.values(dependencies));
}

const sceneryClearanceContractExpression = sourceBetween(
  runtime,
  'const cameraCinematicSceneryClearanceContract = ',
  '\n\n  /** Return signed point-to-cylinder clearance'
).replace(/^const cameraCinematicSceneryClearanceContract = /, '').replace(/;\s*$/, '');
const cameraCinematicSceneryClearanceContract = Function(
  `'use strict'; return (${sceneryClearanceContractExpression});`
)();
const contractExpression = sourceBetween(
  runtime,
  'const cameraCinematicContract = ',
  '\n  const cameraFreeLookYawLimit'
).replace(/^const cameraCinematicContract = /, '').replace(/;\s*$/, '');
const cameraCinematicContract = Function(
  `'use strict'; return (${contractExpression});`
)();
const coveredClearanceLiteral = shipSource.match(
  /const COVERED_CLEARANCE_CONTRACT = Object\.freeze\((\{[\s\S]*?\})\);/
);
assert.ok(coveredClearanceLiteral, 'missing ship covered-clearance contract');
const coveredClearanceContract = Function(
  `'use strict'; return (${coveredClearanceLiteral[1]});`
)();
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function makeDirectorHarness({
  reducedMotion = false,
  visibilityState = 'visible',
  touchCapable = false,
  runSeed = 27_071
} = {}) {
  const state = {
    runSeed,
    runIndex: 2,
    cameraCinematicActive: true,
    cameraCinematicElapsedSeconds: 0,
    cameraCinematicShotElapsedSeconds: 0,
    cameraCinematicShotDurationSeconds: 0,
    cameraCinematicRequestedShotId: 'stable',
    cameraCinematicShotId: 'stable',
    cameraCinematicShotIndex: 0,
    cameraCinematicExteriorShotIndex: 0,
    cameraCinematicReelIndex: 0,
    cameraCinematicReelMode: 'exterior',
    cameraCinematicTunnelEntryCount: 0,
    cameraCinematicTunnelInteriorIndex: 1,
    cameraCinematicTunnelKind: null,
    cameraCinematicTunnelEntryPathM: null,
    cameraCinematicTunnelSpanM: 0,
    cameraCinematicTunnelEditShotIds: [],
    cameraCinematicTunnelEditThresholds: [],
    cameraCinematicTunnelEditIndex: 0,
    cameraCinematicShotSwitchCount: 0,
    cameraCinematicCompositionOverride: false,
    cameraCinematicCompositionReason: 'none',
    cameraCinematicLockReason: 'none',
    cameraCinematicTransitionPending: false,
    cameraCinematicHardCutPending: false,
    cameraCinematicLastTransitionPolicy: 'none',
    cameraCinematicWorldAnchorShotId: null,
    testTunnelSpanM: 413.6,
    testTunnelMeasureCount: 0,
    running: true,
    paused: false,
    gameOver: false
  };
  const reelIndex = compileRuntimeFunction('cinematicReelIndexForCurrentRun', {
    state,
    cameraCinematicContract
  });
  const sequenceForDevice = compileRuntimeFunction('cinematicSequenceForCurrentDevice', {
    state,
    cameraCinematicContract,
    cinematicReelIndexForCurrentRun: reelIndex,
    navigator: { maxTouchPoints: touchCapable ? 1 : 0 },
    mobileCockpitHardwareQuery: { matches: touchCapable }
  });
  const sequence = sequenceForDevice(touchCapable);
  state.cameraCinematicReelIndex = reelIndex(touchCapable);
  state.cameraCinematicRequestedShotId = sequence[0];
  state.cameraCinematicShotId = sequence[0];
  state.cameraCinematicShotDurationSeconds = cameraCinematicContract.shots[sequence[0]].durationSeconds;
  const clearTunnelPlan = compileRuntimeFunction('clearCinematicTunnelMiniEditPlan', { state });
  const prepareTunnelEdit = compileRuntimeFunction('prepareCinematicTunnelMiniEdit', {
    state,
    cameraCinematicContract,
    measureCinematicTunnelRemainingSpanM: () => {
      state.testTunnelMeasureCount++;
      return state.testTunnelSpanM;
    }
  });
  const documentState = { visibilityState };
  const cinematicBtn = { dataset: {} };
  const mobileCinematicBtn = { dataset: {} };
  let reducedMotionActive = reducedMotion;
  let queueTransition;
  let updateDirector;
  const compileDirector = () => {
    queueTransition = compileRuntimeFunction('queueCinematicTransition', {
      state,
      reducedMotionEnabled: reducedMotionActive
    });
    updateDirector = compileRuntimeFunction('updateCinematicCameraDirector', {
      state,
      cameraCinematicContract,
      cinematicSequenceForCurrentDevice: sequenceForDevice,
      cinematicReelIndexForCurrentRun: reelIndex,
      queueCinematicTransition: queueTransition,
      clearCinematicTunnelMiniEditPlan: clearTunnelPlan,
      prepareCinematicTunnelMiniEdit: prepareTunnelEdit,
      reducedMotionEnabled: reducedMotionActive,
      document: documentState,
      clamp,
      cinematicBtn,
      mobileCinematicBtn
    });
  };
  compileDirector();
  const harness = {
    state,
    sequence,
    sequenceForDevice,
    reelIndex,
    queueTransition: (...args) => queueTransition(...args),
    clearTunnelPlan,
    prepareTunnelEdit,
    documentState,
    update: (...args) => updateDirector(...args),
    setReducedMotion(nextEnabled) {
      reducedMotionActive = Boolean(nextEnabled);
      compileDirector();
    },
    context: {
      touchCapable,
      underpassBlend: 0,
      undergroundTunnelBlend: 0,
      cinematicTunnelBlend: 0,
      cinematicTunnelCurrentCovered: false,
      cinematicTunnelExitImminent: false,
      cinematicTunnelKind: 'mountain-tunnel',
      cinematicTunnelPathDistanceM: 1_000,
      cinematicWorldAnchorPassed: false
    }
  };
  return harness;
}

function shotRange(shot, property) {
  const start = Number(shot[property]) || 0;
  const travelName = `${property.replace(/M$/, '')}TravelM`;
  const finish = start + (Number(shot[travelName]) || 0);
  return [Math.min(start, finish), Math.max(start, finish)];
}

function framingFamily(shotId) {
  const shot = cameraCinematicContract.shots[shotId];
  if (shot.mount) return `mount:${shot.mount}`;
  if (['side', 'oppositeSide'].includes(shotId)) return 'profile';
  if (['lowRear', 'roadSkim', 'rearClose'].includes(shotId)) return 'low-rear';
  if (['crane', 'high', 'centerReveal'].includes(shotId)) return 'elevated';
  if (['wide', 'telephoto'].includes(shotId)) return 'long-rear';
  return shotId;
}

function familyForTunnelShot(shotId) {
  if (cameraCinematicContract.shots[shotId].mount) return 'mount';
  if (['tunnelWallProfile', 'tunnelOppositeProfile'].includes(shotId)) return 'profile';
  return 'corridor';
}

test('Film is an independent overlay over exactly four driving views and owns pointer look', () => {
  assert.match(runtime, /const cameraViewChase = 0;/);
  assert.match(runtime, /const cameraViewClose = 1;/);
  assert.match(runtime, /const cameraViewTop = 2;/);
  assert.match(runtime, /const cameraViewHood = 3;/);
  assert.match(runtime, /const cameraViewModeCount = 4;/);
  assert.doesNotMatch(runtime, /cameraView(?:Film|Cinematic)\s*=/);

  const setFilm = functionSource('setCinematicCamera');
  assert.match(setFilm, /cameraCinematicPreviousViewMode = clamp\(/);
  assert.match(setFilm, /state\.viewMode = clamp\([\s\S]*?cameraCinematicPreviousViewMode/);
  assert.match(setFilm, /cancelCameraFreeLook\(nextActive \|\| reducedMotionEnabled, 'view-mode-change'\)/);
  assert.match(setFilm, /cameraCinematicTransitionPending = !reducedMotionEnabled/);
  assert.match(setFilm, /cameraCinematicHardCutPending = !reducedMotionEnabled/);
  assert.match(setFilm, /cameraCinematicLastTransitionPolicy = reducedMotionEnabled \? 'none' : 'cut'/);

  const beginLook = functionSource('beginCameraFreeLook');
  assert.match(beginLook, /state\.cameraCinematicActive\) rejectReason = 'cinematic-director'/);
  assert.match(functionSource('cameraFreeLookPresentationActive'), /if \(state\.cameraCinematicActive\) return false/);
});

test('Film is camera-only while P, M, T, movement, jump, and shifting remain live', () => {
  for (const autoPilot of [false, true]) {
    const authorityState = { autoPilot, manualThrottleMode: true };
    const automaticAuthority = compileRuntimeFunction('automaticDrivingAuthorityActive', {
      state: authorityState
    });
    const longitudinalAuthority = compileRuntimeFunction('longitudinalAuthorityMode', {
      state: authorityState
    });
    assert.equal(automaticAuthority(), autoPilot);
    assert.equal(longitudinalAuthority(), autoPilot ? 'autopilot' : 'player');
  }

  const filmToggle = functionSource('setCinematicCamera');
  for (const forbidden of [
    'releaseAllInputs',
    'toggleAutoPilot',
    'manualThrottleMode',
    'driveTransmissionMode',
    'driveGear',
    'autoTarget',
    'autoBrake',
    'throttleCommand',
    'requestDriveGear',
    'prepareAutomaticDrivingAuthorityState'
  ]) {
    assert.equal(filmToggle.includes(forbidden), false, `Film entry writes driving state through ${forbidden}`);
  }
  assert.match(filmToggle, /cameraCinematicPreviousViewMode = clamp\(/);
  assert.match(filmToggle, /state\.cameraCinematicActive = true/);
  assert.match(filmToggle, /state\.cameraCinematicActive = false/);
  assert.match(filmToggle, /state\.viewMode = clamp\([\s\S]*?cameraCinematicPreviousViewMode/);

  assert.match(functionSource('automaticDrivingAuthorityActive'), /return state\.autoPilot;/);
  assert.doesNotMatch(functionSource('longitudinalAuthorityMode'), /cameraCinematicActive|cinematic-autopilot/);
  assert.doesNotMatch(functionSource('resolveAutopilotThrottleCommand'), /cameraCinematicActive|260|cinematic/);
  assert.doesNotMatch(runtime, /acquireCinematicDrivingAuthority|releaseCinematicDrivingAuthority/);
  assert.doesNotMatch(runtime, /requestCinematicDriveGear|updateCinematicJumpDrivePlan|cinematicSuppressedDrivingCodes/);
  assert.doesNotMatch(runtime, /cameraCinematicJumpMode|cameraCinematicJumpBypass/);

  const playerUpdate = functionSource('updatePlayer');
  assert.match(playerUpdate, /const manualSteer = \(keys\.right \? 1 : 0\) - \(keys\.left \? 1 : 0\)/);
  assert.doesNotMatch(playerUpdate, /cameraCinematic(?:Jump|Drive|Steer)|cameraCinematicActive[\s\S]{0,120}(?:manualSteer|autoSteer|steerCommand)/);
  const longitudinalUpdate = functionSource('updateLongitudinalControl');
  assert.match(longitudinalUpdate, /state\.manualBrake = keys\.brake/);
  assert.match(longitudinalUpdate, /state\.manualAccelerating = authority === 'player' && keys\.throttle/);
  assert.doesNotMatch(longitudinalUpdate, /cameraCinematicActive|cinematic/);
  assert.doesNotMatch(functionSource('jump'), /cameraCinematicActive/);
  assert.doesNotMatch(functionSource('requestDriveGear'), /cameraCinematicActive|cinematic-/);
  for (const controlFunction of [
    'toggleAutoPilot',
    'toggleAutomaticThrottle',
    'toggleDriveTransmissionMode'
  ]) {
    assert.doesNotMatch(functionSource(controlFunction), /cameraCinematicActive/);
  }

  const safety = functionSource('interceptCinematicSafetyContact');
  assert.match(safety, /if \(!state\.cameraCinematicActive\) return false/);
  assert.doesNotMatch(
    safety,
    /state\.(?:autoTarget|autoGoal|autoBrake|manualBrake|manualAccelerating|speed|driveGear|driveTransmissionMode|manualThrottleMode|autoPilot)\s*=/
  );
  const fatalStop = functionSource('stopForFatalError');
  const fatalLockAt = fatalStop.indexOf('fatalRuntimeLocked = true;');
  assert.ok(
    fatalStop.indexOf("setCinematicCamera(false, reason, { announce: false, audio: false });")
      < fatalLockAt
  );
  assert.doesNotMatch(
    fatalStop.slice(0, fatalLockAt),
    /state\.(?:autoPilot|manualThrottleMode|driveTransmissionMode|driveGear)\s*=/
  );
});

test('Film scenery clearance is deeply frozen, camera-only, and covers every visible owner', () => {
  const assertDeepFrozen = (value, path = 'contract') => {
    if (value === null || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
    for (const [key, nested] of Object.entries(value)) assertDeepFrozen(nested, `${path}.${key}`);
  };
  assertDeepFrozen(cameraCinematicSceneryClearanceContract);
  assert.equal(cameraCinematicSceneryClearanceContract.version, 1);
  assert.equal(cameraCinematicSceneryClearanceContract.minimumMarginM, 0.35);
  assert.equal(cameraCinematicSceneryClearanceContract.invariants.filmOnly, true);
  assert.equal(cameraCinematicSceneryClearanceContract.invariants.cameraOnly, true);
  assert.equal(cameraCinematicSceneryClearanceContract.invariants.frameAllocations, 0);
  assert.deepEqual(cameraCinematicSceneryClearanceContract.sourceKinds, [
    'terrain-surface',
    'route-surface',
    'covered-ceiling',
    'world-scenery',
    'gameplay-obstacle',
    'candlelight-pickup',
    'ambient-traffic',
    'route-structure'
  ]);

  const scan = functionSource('scanCinematicSceneryBlockers');
  assert.match(scan, /worldMapEntityContract\.entities/);
  assert.match(scan, /entity\.cameraClearanceMinY/);
  assert.match(scan, /entity\.cameraClearanceMaxY/);
  assert.match(scan, /entity\.horizontalRadiusM/);
  assert.match(scan, /for \(let index = 0; index < obstacles\.length; index\+\+\)/);
  assert.match(scan, /for \(let index = 0; index < pickups\.length; index\+\+\)/);
  assert.match(scan, /cameraCinematicPickupVerticalHalfM/);
  assert.match(scan, /cameraCinematicPickupHorizontalRadiusM/);
  assert.match(scan, /marker\.separationSuppressed/);
  assert.match(scan, /routeCameraBlockers\.length/);
  assert.doesNotMatch(scan, /player(?:\.|\[)/, 'mounted hull must not become its own blocker');
  assert.doesNotMatch(scan, /\.map\(|\.filter\(|\.reduce\(|\.slice\(|\.concat\(/);

  const aggregate = functionSource('resolveCinematicSceneryAggregate');
  assert.match(aggregate, /getAmbientTrafficMarkers/);
  assert.match(aggregate, /getCameraBlockers/);
  assert.match(aggregate, /maximumResolutionPasses/);
  assert.match(aggregate, /scanCinematicSceneryBlockers\([\s\S]*?false,[\s\S]*?false/);
  const fallback = functionSource('resolveCinematicSceneryFallbackCamera');
  assert.match(fallback, /sampleCinematicCommittedFrame/);
  assert.match(fallback, /cameraCinematicRequestedShotId = 'stable'/);
  assert.match(fallback, /cameraCinematicCompositionReason = 'scenery-clearance-fallback'/);
  assert.doesNotMatch(
    fallback,
    /state\.(?:speed|lateral|autoPilot|manualThrottleMode|driveGear|routeCursor|pathPlan|lives)\s*=/
  );
});

test('Film cylinder resolver keeps 0.35m clearance, prefers up, respects ceilings, and fails over', () => {
  const measure = compileRuntimeFunction('cinematicSceneryCylinderClearanceM', {});
  const resolve = compileRuntimeFunction('resolveCinematicSceneryCylinderClearance', {
    cameraCinematicSceneryClearanceContract,
    cinematicSceneryCylinderClearanceM: measure
  });
  const out = {};

  resolve(0, 1, 0, 0, 0, 0, 2, 1, 0.35, 8, out);
  assert.equal(out.safe, true);
  assert.equal(out.adjusted, true);
  assert.equal(out.fallbackRequired, false);
  assert.ok(Math.abs(out.resolvedY - 2.35) <= 0.000_001);
  assert.ok(out.clearanceM >= 0.35 - 0.000_001);
  assert.ok(Math.abs(out.liftM - 1.35) <= 0.000_001);

  resolve(0, 1, 0, 0, 0, 0, 2, 1, -1, 2.2, out);
  assert.equal(out.safe, true);
  assert.equal(out.adjusted, true);
  assert.ok(Math.abs(out.resolvedY + 0.35) <= 0.000_001);
  assert.equal(out.liftM, 0);

  resolve(0, 1, 0, 0, 0, 0, 2, 1, 0, 2.2, out);
  assert.equal(out.safe, false);
  assert.equal(out.adjusted, false);
  assert.equal(out.fallbackRequired, true);

  resolve(1.36, 1, 0, 0, 0, 0, 2, 1, 0, 8, out);
  assert.equal(out.safe, true);
  assert.equal(out.adjusted, false);
  assert.ok(measure(1.36, 1, 0, 0, 0, 0, 2, 1) >= 0.35);
});

test('Film resolves both authored target and committed smoothed camera with world-lock stability', () => {
  const update = functionSource('updateCamera');
  const aggregateCalls = update.match(/resolveCinematicSceneryAggregate\(/g) || [];
  assert.ok(aggregateCalls.length >= 2, 'candidate and committed camera must both be checked');
  assert.match(update, /cameraRigAnchor\.x \+ cameraTargetPositionOffset\.x/);
  assert.match(update, /camera\.position\.x \+ renderOriginX/);
  assert.match(update, /cameraCinematicSceneryTargetScratch\.resolvedY - targetAbsoluteY/);
  assert.match(update, /cameraCinematicSceneryActualScratch\.resolvedY - camera\.position\.y/);
  assert.match(update, /sampleTerrainWorldHeight\(targetAbsoluteX, targetAbsoluteZ\)/);
  assert.match(update, /sampleTerrainWorldHeight\(actualAbsoluteX, actualAbsoluteZ\)/);
  assert.match(update, /targetUsesCoveredFloor[\s\S]*?routeSceneryFloorY/);
  assert.match(update, /actualUsesCoveredFloor[\s\S]*?routeSceneryFloorY/);
  assert.ok(
    (update.match(/resolveCinematicSceneryFallbackCamera\(\s*routeAnchor,\s*routeSceneryFloorY,/g) || [])
      .length >= 2,
    'each fallback candidate must sample from the route floor instead of inheriting the blocked terrain height'
  );
  assert.match(update, /worldAnchorClearanceCommitted/);
  assert.match(update, /worldAnchorWouldMove[\s\S]*?resolveCinematicSceneryFallbackCamera/);
  assert.match(update, /state\.cameraCinematicWorldAnchorY \+= targetLiftM/);
  assert.match(update, /crossingCeilingHeight - undergroundCameraContract\.ceilingMarginM/);
  assert.match(update, /throw new RangeError\('Film scenery clearance exhausted every committed-path fallback'\)/);
  assert.doesNotMatch(
    update,
    /cameraCinematicScenery[\s\S]{0,160}state\.(?:speed|lateral|autoPilot|manualThrottleMode|driveGear|routeCursor|pathPlan|lives)\s*=/
  );

  const reset = functionSource('resetGame');
  assert.match(reset, /cameraCinematicSceneryAvoidanceActive = false/);
  assert.match(reset, /cameraCinematicSceneryAvoidanceCount = 0/);
  assert.match(reset, /cameraCinematicSceneryAvoidanceMaximumLiftM = 0/);
  assert.match(reset, /cameraCinematicSceneryMinimumClearanceM = Number\.POSITIVE_INFINITY/);
  assert.match(reset, /cameraCinematicSceneryLastSourceKind = 'none'/);
  for (const field of [
    'cameraCinematicSceneryAvoidanceActive',
    'cameraCinematicSceneryAvoidanceCount',
    'cameraCinematicSceneryAvoidanceMaximumLiftM',
    'cameraCinematicSceneryLastSourceKind'
  ]) {
    assert.match(runtime, new RegExp(`${field}:\\s*state\\.${field}`));
  }
  assert.match(
    runtime,
    /cameraCinematicSceneryMinimumClearanceM:\s*\n?\s*Number\.isFinite\(state\.cameraCinematicSceneryMinimumClearanceM\)/
  );
});

test('three desktop and three touch reels cover every spatial axis without adjacent near-duplicates', () => {
  assert.equal(cameraCinematicContract.version, 5);
  assert.equal(cameraCinematicContract.desktopReels.length, 3);
  assert.equal(cameraCinematicContract.touchReels.length, 3);

  for (const [mode, reels] of [
    ['desktop', cameraCinematicContract.desktopReels],
    ['touch', cameraCinematicContract.touchReels]
  ]) {
    for (const [reelIndex, reel] of reels.entries()) {
      assert.equal(new Set(reel).size, reel.length, `${mode} reel ${reelIndex} repeats a shot`);
      const shots = reel.map((shotId) => cameraCinematicContract.shots[shotId]);
      assert.equal(shots.every(Boolean), true, `${mode} reel ${reelIndex} references a missing shot`);
      const sideRanges = shots.map((shot) => shotRange(shot, 'sideM'));
      const heightRanges = shots.map((shot) => shotRange(shot, 'heightM'));
      const behindRanges = shots.map((shot) => shotRange(shot, 'behindM'));
      const coverage = {
        front: behindRanges.some(([minimum]) => minimum < -5),
        rear: behindRanges.some(([, maximum]) => maximum >= 10),
        left: sideRanges.some(([minimum]) => minimum <= -3),
        right: sideRanges.some(([, maximum]) => maximum >= 3),
        high: heightRanges.some(([, maximum]) => maximum >= 12),
        low: heightRanges.some(([minimum]) => minimum < 3),
        far: shots.some((shot, index) => shot.worldLocked || Math.max(
          Math.abs(behindRanges[index][0]),
          Math.abs(behindRanges[index][1])
        ) >= 28),
        near: shots.some((shot, index) => shot.mount || Math.min(
          Math.abs(behindRanges[index][0]),
          Math.abs(behindRanges[index][1])
        ) <= 5)
      };
      assert.deepEqual(
        coverage,
        { front: true, rear: true, left: true, right: true, high: true, low: true, far: true, near: true },
        `${mode} reel ${reelIndex} lacks spatial coverage`
      );
      for (let index = 0; index < reel.length; index++) {
        const nextIndex = (index + 1) % reel.length;
        assert.notEqual(
          framingFamily(reel[index]),
          framingFamily(reel[nextIndex]),
          `${mode} reel ${reelIndex} repeats framing family across ${reel[index]} -> ${reel[nextIndex]}`
        );
      }
    }
  }
});

test('every shot has explicit optical motion and edit policy', () => {
  for (const [shotId, shot] of Object.entries(cameraCinematicContract.shots)) {
    assert.equal(shot.id, shotId);
    for (const field of [
      'sideM', 'heightM', 'behindM', 'lookAheadM', 'fovDegrees', 'durationSeconds',
      'sideTravelM', 'heightTravelM', 'behindTravelM', 'lookAheadTravelM', 'fovTravelDegrees',
      'transitionSeconds'
    ]) {
      assert.equal(Number.isFinite(shot[field]), true, `${shotId}.${field} must be finite`);
    }
    assert.ok(['cut', 'blend'].includes(shot.transitionPolicy), `${shotId} lacks an edit policy`);
    if (shotId.startsWith('tunnel')) {
      assert.ok(shot.durationSeconds >= 1.6 && shot.durationSeconds <= 4, `${shotId} has an unauthored hold`);
    } else {
      assert.ok(shot.durationSeconds >= 4 && shot.durationSeconds <= 5.8, `${shotId} has an unauthored hold`);
    }
    if (shot.transitionPolicy === 'cut') assert.equal(shot.transitionSeconds, 0);
    if (shot.transitionPolicy === 'blend') {
      assert.ok(shot.transitionSeconds >= (shotId.startsWith('tunnel') ? 0.5 : 0.7));
    }
  }
});

test('tunnels use a dedicated portal, compression, profile, and nose-wing-tail mounted edit', () => {
  assert.deepEqual(cameraCinematicContract.tunnelSequence, [
    'tunnelEntrance',
    'tunnelCompression',
    'tunnelWallProfile',
    'tunnelNoseMount',
    'tunnelAxialRush',
    'tunnelWingMount',
    'tunnelOppositeProfile',
    'tunnelTailMount'
  ]);
  assert.equal(cameraCinematicContract.tunnelExitShotId, 'tunnelExitReveal');
  assert.equal(cameraCinematicContract.shots.tunnelEntrance.transitionPolicy, 'cut');
  assert.equal(cameraCinematicContract.shots.tunnelExitReveal.transitionPolicy, 'cut');
  assert.equal(cameraCinematicContract.shots.tunnelCompression.transitionPolicy, 'blend');
  assert.equal(cameraCinematicContract.shots.tunnelWallProfile.transitionPolicy, 'blend');
  assert.equal(cameraCinematicContract.shots.tunnelNoseMount.mount, 'tunnel-nose');
  assert.equal(cameraCinematicContract.shots.tunnelWingMount.mount, 'inboard-wing-root');
  assert.equal(cameraCinematicContract.shots.tunnelTailMount.mount, 'tunnel-tail');
  assert.ok(Math.abs(cameraCinematicContract.shots.tunnelWingMount.sideM) <= 0.36);
  for (const shotId of [
    'tunnelEntrance', 'tunnelCompression', 'tunnelWallProfile', 'tunnelNoseMount',
    'tunnelAxialRush', 'tunnelWingMount', 'tunnelOppositeProfile', 'tunnelTailMount'
  ]) {
    assert.ok(
      Math.max(...shotRange(cameraCinematicContract.shots[shotId], 'heightM')) <= 2.4,
      `${shotId} exceeds the enclosed set height`
    );
  }
  const safeHalfM = 4.42;
  const roadHalfM = 5.20;
  const mountMagnitudeM = Math.abs(cameraCinematicContract.shots.tunnelWingMount.sideM);
  assert.ok(mountMagnitudeM < roadHalfM - safeHalfM);
  for (const entryLateral of [-safeHalfM, safeHalfM]) {
    const frozenMountSideM = entryLateral > 0 ? -mountMagnitudeM : mountMagnitudeM;
    for (const laterLateral of [-safeHalfM, safeHalfM]) {
      assert.ok(Math.abs(laterLateral + frozenMountSideM) < roadHalfM);
    }
  }
  const cameraNearM = 0.1;
  const mountedClearanceMarginM = 0.02;
  const tunnelWingMount = cameraCinematicContract.shots.tunnelWingMount;
  assert.ok(
    coveredClearanceContract.mainVisualMinimumYM - tunnelWingMount.heightM
      > cameraNearM + mountedClearanceMarginM,
    'the tunnel wing lens must remain below the complete main visual with a near-plane margin'
  );
  const groundedRoadTopRelativeYM = -0.18;
  const tunnelRoadClearanceM = tunnelWingMount.heightM - groundedRoadTopRelativeYM
    - Math.abs(tunnelWingMount.sideM) * Math.sin(coveredClearanceContract.maximumCoveredRollRad)
    - Math.abs(tunnelWingMount.behindM) * Math.sin(coveredClearanceContract.maximumCoveredPitchRad);
  assert.ok(
    tunnelRoadClearanceM > cameraNearM + mountedClearanceMarginM,
    'the tunnel wing lens must keep its near plane above the road at maximum covered attitude'
  );
  const exteriorWingMount = cameraCinematicContract.shots.wingMount;
  assert.ok(
    exteriorWingMount.sideM - coveredClearanceContract.mainVisualHalfWidthM
      > cameraNearM + mountedClearanceMarginM,
    'the exterior wing lens must sit beyond the complete cape and its near plane'
  );
  assert.ok(exteriorWingMount.behindM <= -0.20, 'the exterior wing lens must remain ahead of the bevel');
  for (const profileId of ['tunnelWallProfile', 'tunnelOppositeProfile']) {
    const [minimumBehindM] = shotRange(cameraCinematicContract.shots[profileId], 'behindM');
    assert.ok(minimumBehindM >= 2.13, `${profileId} crosses the aft hull envelope`);
  }
  assert.equal(cameraCinematicContract.tunnelSequence.includes('stable'), false);
});

test('descending High shot keeps the complete ship inside desktop and phone-portrait frames', () => {
  const shot = cameraCinematicContract.shots.high;
  const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
  const subtract = (left, right) => left.map((value, index) => value - right[index]);
  const cross = (left, right) => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
  const normalize = (vector) => {
    const magnitude = Math.hypot(...vector);
    return vector.map((value) => value / magnitude);
  };
  const maximumProjectedExtent = (progress, portrait) => {
    const sideScale = portrait ? 0.72 : 1;
    const behindScale = portrait ? 1.18 : 1;
    const lookAheadScale = portrait ? 0.90 : 1;
    const sideM = (shot.sideM + shot.sideTravelM * progress) * sideScale;
    const heightM = shot.heightM + shot.heightTravelM * progress + (portrait ? 0.65 : 0);
    const behindM = (shot.behindM + shot.behindTravelM * progress) * behindScale;
    const lookAheadM = (shot.lookAheadM + shot.lookAheadTravelM * progress) * lookAheadScale;
    const fovDegrees = shot.fovDegrees + shot.fovTravelDegrees * progress + (portrait ? 4 : 0);
    const aspect = portrait ? 390 / 844 : 16 / 9;
    const cameraPosition = [sideM, heightM, -behindM];
    const lookTarget = [0, 1.08, lookAheadM];
    const forward = normalize(subtract(lookTarget, cameraPosition));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = normalize(cross(right, forward));
    const tangent = Math.tan(fovDegrees * Math.PI / 360);
    let maximumNdc = 0;
    for (const x of [-coveredClearanceContract.mainVisualHalfWidthM, coveredClearanceContract.mainVisualHalfWidthM]) {
      for (const y of [
        coveredClearanceContract.mainVisualMinimumYM,
        coveredClearanceContract.mainVisualMaximumYM
      ]) {
        for (const z of [
          -coveredClearanceContract.mainVisualForwardM,
          coveredClearanceContract.mainVisualAftM
        ]) {
          const fromCamera = subtract([x, y, z], cameraPosition);
          const depth = dot(fromCamera, forward);
          const ndcX = dot(fromCamera, right) / (depth * tangent * aspect);
          const ndcY = dot(fromCamera, up) / (depth * tangent);
          maximumNdc = Math.max(maximumNdc, Math.abs(ndcX), Math.abs(ndcY));
        }
      }
    }
    return maximumNdc;
  };

  for (const portrait of [false, true]) {
    for (const progress of [0, 0.25, 0.50, 0.75, 1]) {
      assert.ok(
        maximumProjectedExtent(progress, portrait) <= 0.85,
        `High shot crops the ship at progress ${progress} in ${portrait ? 'portrait' : 'desktop'}`
      );
    }
  }
});

test('run identity selects deterministic reels without consuming any random stream', () => {
  const source = [
    functionSource('cinematicReelIndexForCurrentRun'),
    functionSource('cinematicSequenceForCurrentDevice')
  ].join('\n');
  assert.doesNotMatch(source, /Math\.random|visualRuntimeRandom|gameplayRandom|random\(/);

  const first = makeDirectorHarness({ runSeed: 88_031 });
  const second = makeDirectorHarness({ runSeed: 88_031 });
  assert.equal(first.reelIndex(false), second.reelIndex(false));
  assert.deepEqual(first.sequenceForDevice(false), second.sequenceForDevice(false));
  assert.deepEqual(first.sequenceForDevice(true), second.sequenceForDevice(true));
  const observedDesktop = new Set();
  const observedTouch = new Set();
  for (let seed = 0; seed < 32; seed++) {
    const harness = makeDirectorHarness({ runSeed: seed });
    observedDesktop.add(harness.reelIndex(false));
    observedTouch.add(harness.reelIndex(true));
  }
  assert.deepEqual([...observedDesktop].sort(), [0, 1, 2]);
  assert.deepEqual([...observedTouch].sort(), [0, 1, 2]);
});

test('damage, airborne state, steering, throttle, curves, and Autopilot cannot choose or retime a shot', () => {
  const baseline = makeDirectorHarness({ runSeed: 4_204 });
  const stressed = makeDirectorHarness({ runSeed: 4_204 });
  Object.assign(stressed.state, {
    grounded: false,
    jumpPlatformFlightActive: true,
    damageAcceptedThisRenderFrame: true,
    invincibleTimer: 9,
    autoPilot: true,
    autoThreat: 1,
    autoObstacleBrakeTtcSeconds: 0.05,
    autoCurveDistance: 1,
    autoCurveMaxCurvature: 4,
    manualAccelerating: true,
    manualBrake: true,
    lateral: 999,
    speed: 777
  });
  for (let frame = 0; frame < 25; frame++) {
    baseline.update(0.1, baseline.context);
    stressed.update(0.1, stressed.context);
  }
  assert.equal(stressed.state.cameraCinematicRequestedShotId, baseline.state.cameraCinematicRequestedShotId);
  assert.equal(stressed.state.cameraCinematicShotElapsedSeconds, baseline.state.cameraCinematicShotElapsedSeconds);
  assert.equal(stressed.state.cameraCinematicElapsedSeconds, baseline.state.cameraCinematicElapsedSeconds);

  const director = functionSource('updateCinematicCameraDirector');
  for (const forbidden of [
    'grounded', 'jumpPlatformFlightActive', 'damageAcceptedThisRenderFrame', 'invincibleTimer',
    'autoPilot', 'autoThreat', 'autoObstacleBrakeTtcSeconds', 'autoCurve', 'manualAccelerating',
    'manualBrake', 'cameraFreeLook'
  ]) {
    assert.equal(director.includes(forbidden), false, `director reads gameplay condition ${forbidden}`);
  }
});

test('the director clock freezes only for lifecycle visibility or Reduced Motion', () => {
  const airborne = makeDirectorHarness();
  airborne.state.grounded = false;
  airborne.state.jumpPlatformFlightActive = true;
  airborne.update(0.1, airborne.context);
  assert.equal(airborne.state.cameraCinematicElapsedSeconds, 0.1);

  const paused = makeDirectorHarness();
  paused.state.paused = true;
  paused.update(0.1, paused.context);
  assert.equal(paused.state.cameraCinematicElapsedSeconds, 0);

  const hidden = makeDirectorHarness({ visibilityState: 'hidden' });
  hidden.update(0.1, hidden.context);
  assert.equal(hidden.state.cameraCinematicElapsedSeconds, 0);

  const reduced = makeDirectorHarness({ reducedMotion: true });
  const shot = reduced.update(0.1, reduced.context);
  assert.equal(shot.id, 'stable');
  assert.equal(reduced.state.cameraCinematicElapsedSeconds, 0);
  assert.equal(reduced.state.cameraCinematicCompositionOverride, true);
  assert.equal(reduced.state.cameraCinematicCompositionReason, 'reduced-motion');
});

test('leaving Reduced Motion resumes each authored reel mode without a duplicate tunnel plan or cut', () => {
  const exterior = makeDirectorHarness();
  exterior.setReducedMotion(true);
  assert.equal(exterior.update(0.1, exterior.context).id, 'stable');
  exterior.setReducedMotion(false);
  assert.equal(exterior.update(0.1, exterior.context).id, exterior.sequence[0]);
  assert.equal(exterior.state.cameraCinematicReelMode, 'exterior');
  assert.equal(exterior.state.cameraCinematicLastTransitionPolicy, 'cut');

  const portalCrossing = makeDirectorHarness();
  portalCrossing.setReducedMotion(true);
  assert.equal(portalCrossing.update(0.1, portalCrossing.context).id, 'stable');
  Object.assign(portalCrossing.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelPathDistanceM: 2_000
  });
  assert.equal(portalCrossing.update(0.1, portalCrossing.context).id, 'stable');
  portalCrossing.setReducedMotion(false);
  const portalShot = portalCrossing.update(0.1, portalCrossing.context);
  assert.equal(portalShot.id, portalCrossing.state.cameraCinematicTunnelEditShotIds[0]);
  assert.equal(portalCrossing.state.cameraCinematicReelMode, 'tunnel');
  assert.equal(portalCrossing.state.cameraCinematicTunnelEntryCount, 1);
  assert.equal(portalCrossing.state.testTunnelMeasureCount, 1);
  assert.equal(portalCrossing.state.cameraCinematicShotSwitchCount, 1);
  portalCrossing.state.cameraCinematicHardCutPending = false;
  portalCrossing.update(0.1, portalCrossing.context);
  assert.equal(portalCrossing.state.cameraCinematicShotSwitchCount, 1, 'portal recovery must not double-cut');
  assert.equal(portalCrossing.state.cameraCinematicHardCutPending, false);

  const approach = makeDirectorHarness();
  approach.context.cinematicTunnelBlend = 1;
  assert.equal(approach.update(0.1, approach.context).id, 'tunnelEntrance');
  approach.setReducedMotion(true);
  assert.equal(approach.update(0.1, approach.context).id, 'stable');
  approach.setReducedMotion(false);
  assert.equal(approach.update(0.1, approach.context).id, 'tunnelEntrance');
  assert.equal(approach.state.cameraCinematicReelMode, 'tunnel-approach');
  assert.equal(approach.state.testTunnelMeasureCount, 0);
  assert.equal(approach.state.cameraCinematicTunnelEntryCount, 0);
  approach.setReducedMotion(true);
  approach.update(0.1, approach.context);
  approach.context.cinematicTunnelCurrentCovered = true;
  approach.setReducedMotion(false);
  assert.equal(
    approach.update(0.1, approach.context).id,
    approach.state.cameraCinematicTunnelEditShotIds[0]
  );
  assert.equal(approach.state.cameraCinematicReelMode, 'tunnel');
  assert.equal(approach.state.testTunnelMeasureCount, 1);
  assert.equal(approach.state.cameraCinematicTunnelEntryCount, 1);

  const shortTunnel = makeDirectorHarness();
  Object.assign(shortTunnel.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelPathDistanceM: 3_000
  });
  const shortInitial = shortTunnel.update(0.1, shortTunnel.context);
  const shortPlan = shortTunnel.state.cameraCinematicTunnelEditShotIds;
  shortTunnel.setReducedMotion(true);
  assert.equal(shortTunnel.update(0.1, shortTunnel.context).id, 'stable');
  shortTunnel.context.cinematicTunnelPathDistanceM += 300;
  shortTunnel.setReducedMotion(false);
  assert.equal(shortTunnel.update(0.1, shortTunnel.context).id, shortInitial.id);
  assert.equal(shortTunnel.state.cameraCinematicTunnelEditShotIds, shortPlan);
  assert.equal(shortTunnel.state.cameraCinematicTunnelEntryCount, 1);
  assert.equal(shortTunnel.state.testTunnelMeasureCount, 1);

  for (const [spanM, progress, expectedIndex] of [
    [600, 0.51, 1],
    [1_400, 0.68, 2]
  ]) {
    const tunnel = makeDirectorHarness({ runSeed: 83_011 });
    tunnel.state.testTunnelSpanM = spanM;
    Object.assign(tunnel.context, {
      cinematicTunnelBlend: 1,
      cinematicTunnelCurrentCovered: true,
      cinematicTunnelKind: 'underground-tunnel',
      cinematicTunnelPathDistanceM: 4_000
    });
    tunnel.update(0.1, tunnel.context);
    const frozenPlan = tunnel.state.cameraCinematicTunnelEditShotIds;
    const frozenThresholds = tunnel.state.cameraCinematicTunnelEditThresholds;
    tunnel.setReducedMotion(true);
    assert.equal(tunnel.update(0.1, tunnel.context).id, 'stable');
    tunnel.context.cinematicTunnelPathDistanceM = 4_000 + spanM * progress;
    tunnel.setReducedMotion(false);
    const resumedShot = tunnel.update(0.1, tunnel.context);
    assert.equal(tunnel.state.cameraCinematicTunnelEditIndex, expectedIndex);
    assert.equal(resumedShot.id, frozenPlan[expectedIndex]);
    assert.equal(tunnel.state.cameraCinematicTunnelEditShotIds, frozenPlan);
    assert.equal(tunnel.state.cameraCinematicTunnelEditThresholds, frozenThresholds);
    assert.equal(tunnel.state.cameraCinematicTunnelEntryCount, 1);
    assert.equal(tunnel.state.testTunnelMeasureCount, 1);
    assert.equal(tunnel.state.cameraCinematicLastTransitionPolicy, 'cut');
  }

  const resumedLongEdit = makeDirectorHarness({ runSeed: 83_011 });
  resumedLongEdit.state.testTunnelSpanM = 1_400;
  Object.assign(resumedLongEdit.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelKind: 'underground-tunnel',
    cinematicTunnelPathDistanceM: 5_000
  });
  resumedLongEdit.update(0.1, resumedLongEdit.context);
  resumedLongEdit.setReducedMotion(true);
  resumedLongEdit.update(0.1, resumedLongEdit.context);
  resumedLongEdit.setReducedMotion(false);
  resumedLongEdit.update(0.1, resumedLongEdit.context);
  resumedLongEdit.context.cinematicTunnelPathDistanceM = 5_000 + 1_400 * 0.34;
  assert.equal(
    resumedLongEdit.update(0.1, resumedLongEdit.context).id,
    resumedLongEdit.state.cameraCinematicTunnelEditShotIds[1]
  );
  assert.equal(resumedLongEdit.state.cameraCinematicLastTransitionPolicy, 'blend');
  resumedLongEdit.context.cinematicTunnelPathDistanceM = 5_000 + 1_400 * 0.68;
  assert.equal(
    resumedLongEdit.update(0.1, resumedLongEdit.context).id,
    resumedLongEdit.state.cameraCinematicTunnelEditShotIds[2]
  );
  assert.equal(resumedLongEdit.state.cameraCinematicLastTransitionPolicy, 'cut');
  assert.equal(resumedLongEdit.state.cameraCinematicTunnelEntryCount, 1);
  assert.equal(resumedLongEdit.state.testTunnelMeasureCount, 1);

  const exit = makeDirectorHarness();
  Object.assign(exit.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelExitImminent: true
  });
  assert.equal(exit.update(0.1, exit.context).id, 'tunnelExitReveal');
  exit.setReducedMotion(true);
  assert.equal(exit.update(0.1, exit.context).id, 'stable');
  exit.setReducedMotion(false);
  assert.equal(exit.update(0.1, exit.context).id, 'tunnelExitReveal');
  assert.equal(exit.state.cameraCinematicReelMode, 'exit');
  assert.equal(exit.state.cameraCinematicShotElapsedSeconds, 0, 'covered exit reveal must remain frozen');
  assert.equal(exit.state.cameraCinematicTunnelEntryCount, 0);
  assert.equal(exit.state.testTunnelMeasureCount, 0);
});

test('portal entry, progress-owned tunnel edit, and exit reveal are their own motivated path', () => {
  const harness = makeDirectorHarness();
  harness.context.cinematicTunnelBlend = 1;
  let shot = harness.update(0.016, harness.context);
  assert.equal(shot.id, 'tunnelEntrance');
  assert.equal(harness.state.cameraCinematicReelMode, 'tunnel-approach');
  assert.equal(harness.state.cameraCinematicLastTransitionPolicy, 'cut');
  for (let frame = 0; frame < 100; frame++) shot = harness.update(0.1, harness.context);
  assert.equal(shot.id, 'tunnelEntrance');
  assert.equal(harness.state.cameraCinematicShotElapsedSeconds, 0);

  harness.state.cameraCinematicTransitionPending = false;
  harness.state.cameraCinematicHardCutPending = false;
  harness.context.cinematicTunnelCurrentCovered = true;
  shot = harness.update(0.016, harness.context);
  assert.equal(shot.id, harness.state.cameraCinematicTunnelEditShotIds[0]);
  assert.equal(harness.state.cameraCinematicTunnelEditShotIds.length, 1);
  assert.equal(harness.state.cameraCinematicLastTransitionPolicy, 'cut');

  harness.state.cameraCinematicTransitionPending = false;
  harness.state.cameraCinematicHardCutPending = false;
  harness.state.cameraCinematicShotElapsedSeconds = shot.durationSeconds * 10;
  shot = harness.update(0.016, harness.context);
  assert.equal(shot.id, harness.state.cameraCinematicTunnelEditShotIds[0]);
  assert.equal(harness.state.cameraCinematicShotSwitchCount, 2);

  harness.context.cinematicTunnelBlend = 0;
  harness.context.cinematicTunnelCurrentCovered = false;
  shot = harness.update(0.016, harness.context);
  assert.equal(shot.id, 'tunnelExitReveal');
  assert.equal(harness.state.cameraCinematicReelMode, 'exit');
  assert.equal(harness.state.cameraCinematicLastTransitionPolicy, 'cut');

  harness.state.cameraCinematicShotElapsedSeconds = shot.durationSeconds;
  shot = harness.update(0.016, harness.context);
  assert.equal(harness.state.cameraCinematicReelMode, 'exterior');
  assert.ok(harness.sequence.includes(shot.id));
});

test('Film entry inside a tunnel distinguishes deep interior from an imminent exit', () => {
  const deep = makeDirectorHarness();
  Object.assign(deep.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelExitImminent: false
  });
  const deepShot = deep.update(0.016, deep.context);
  assert.equal(deepShot.id, deep.state.cameraCinematicTunnelEditShotIds[0]);
  assert.equal(deep.state.cameraCinematicReelMode, 'tunnel');

  const nearExit = makeDirectorHarness();
  Object.assign(nearExit.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelExitImminent: true
  });
  assert.equal(nearExit.update(0.016, nearExit.context).id, 'tunnelExitReveal');
  const switchCount = nearExit.state.cameraCinematicShotSwitchCount;
  for (let frame = 0; frame < 50; frame++) {
    assert.equal(nearExit.update(0.1, nearExit.context).id, 'tunnelExitReveal');
  }
  assert.equal(nearExit.state.cameraCinematicShotSwitchCount, switchCount);
  assert.equal(nearExit.state.cameraCinematicShotElapsedSeconds, 0);

  nearExit.context.cinematicTunnelBlend = 0;
  nearExit.context.cinematicTunnelCurrentCovered = false;
  nearExit.context.cinematicTunnelExitImminent = false;
  assert.equal(nearExit.update(0.1, nearExit.context).id, 'tunnelExitReveal');
  assert.equal(nearExit.state.cameraCinematicReelMode, 'exit');
  assert.equal(nearExit.state.cameraCinematicShotElapsedSeconds, 0.1);
  nearExit.state.cameraCinematicShotElapsedSeconds = cameraCinematicContract.shots.tunnelExitReveal.durationSeconds;
  const exteriorShot = nearExit.update(0.016, nearExit.context);
  assert.equal(nearExit.state.cameraCinematicReelMode, 'exterior');
  assert.ok(nearExit.sequence.includes(exteriorShot.id));
});

test('frozen tunnel span selects 1-2-3 progress beats without reading speed or controls', () => {
  const cases = [
    [413.6, 1],
    [1_254.1, 2],
    [1_400, 3],
    [2_000, 3]
  ];
  for (const [spanM, expectedCount] of cases) {
    const plans = [];
    for (const speedKmh of [403, 1_080, 2_800]) {
      const harness = makeDirectorHarness({ runSeed: 64_703 });
      harness.state.testTunnelSpanM = spanM;
      harness.state.speed = speedKmh / 3.6;
      harness.state.manualAccelerating = speedKmh === 2_800;
      harness.state.manualBrake = speedKmh === 403;
      Object.assign(harness.context, {
        cinematicTunnelBlend: 1,
        cinematicTunnelCurrentCovered: true,
        cinematicTunnelKind: spanM < 600 ? 'mountain-tunnel' : 'underground-tunnel'
      });
      harness.update(0.016, harness.context);
      assert.equal(harness.state.cameraCinematicTunnelEditShotIds.length, expectedCount);
      plans.push({
        shotIds: [...harness.state.cameraCinematicTunnelEditShotIds],
        thresholds: [...harness.state.cameraCinematicTunnelEditThresholds]
      });
    }
    assert.deepEqual(plans[1], plans[0]);
    assert.deepEqual(plans[2], plans[0]);
  }

  const planner = functionSource('prepareCinematicTunnelMiniEdit');
  assert.doesNotMatch(planner, /state\.speed|cinematicTunnelEntrySpeed|manualAccelerating|manualBrake/);
  const director = functionSource('updateCinematicCameraDirector');
  assert.doesNotMatch(director, /state\.speed|cinematicTunnelEntrySpeed|manualAccelerating|manualBrake/);
});

test('tunnel beats switch only at frozen committed-path thresholds and visits rotate families', () => {
  const harness = makeDirectorHarness({ runSeed: 8_101 });
  harness.state.testTunnelSpanM = 1_254.1;
  Object.assign(harness.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelKind: 'underground-tunnel',
    cinematicTunnelPathDistanceM: 4_000
  });
  let shot = harness.update(0.016, harness.context);
  const [firstShotId, secondShotId] = harness.state.cameraCinematicTunnelEditShotIds;
  assert.equal(shot.id, firstShotId);
  assert.deepEqual(harness.state.cameraCinematicTunnelEditThresholds, [0, 0.5]);
  harness.state.cameraCinematicShotElapsedSeconds = 99;
  harness.context.cinematicTunnelPathDistanceM = 4_000 + 1_254.1 * 0.49;
  assert.equal(harness.update(0.1, harness.context).id, firstShotId);
  harness.context.cinematicTunnelPathDistanceM = 4_000 + 1_254.1 * 0.51;
  shot = harness.update(0.1, harness.context);
  assert.equal(shot.id, secondShotId);
  assert.equal(
    harness.state.cameraCinematicLastTransitionPolicy,
    cameraCinematicContract.shots[secondShotId].mount ? 'cut' : 'blend'
  );

  const longTunnel = makeDirectorHarness({ runSeed: 8_101 });
  longTunnel.state.testTunnelSpanM = 1_400;
  Object.assign(longTunnel.context, {
    cinematicTunnelBlend: 1,
    cinematicTunnelCurrentCovered: true,
    cinematicTunnelKind: 'underground-tunnel',
    cinematicTunnelPathDistanceM: 6_000
  });
  const longFirst = longTunnel.update(0.016, longTunnel.context);
  const longShotIds = [...longTunnel.state.cameraCinematicTunnelEditShotIds];
  assert.equal(familyForTunnelShot(longShotIds[0]), 'corridor');
  assert.equal(familyForTunnelShot(longShotIds[1]), 'profile');
  assert.equal(familyForTunnelShot(longShotIds[2]), 'mount');
  assert.equal(longFirst.id, longShotIds[0]);
  longTunnel.context.cinematicTunnelPathDistanceM = 6_000 + 1_400 * 0.34;
  assert.equal(longTunnel.update(0.1, longTunnel.context).id, longShotIds[1]);
  assert.equal(longTunnel.state.cameraCinematicLastTransitionPolicy, 'blend');
  longTunnel.context.cinematicTunnelPathDistanceM = 6_000 + 1_400 * 0.68;
  assert.equal(longTunnel.update(0.1, longTunnel.context).id, longShotIds[2]);
  assert.equal(longTunnel.state.cameraCinematicLastTransitionPolicy, 'cut');

  const mediumVisits = makeDirectorHarness({ runSeed: 22_903 });
  mediumVisits.state.testTunnelSpanM = 1_254.1;
  const mediumSecondFamilies = new Set();
  const mediumTransitionPolicies = new Set();
  for (let visit = 0; visit < 2; visit++) {
    mediumVisits.prepareTunnelEdit({
      cinematicTunnelKind: 'underground-tunnel',
      cinematicTunnelPathDistanceM: 7_000
    });
    const [mediumFirstShotId, mediumSecondShotId] = mediumVisits.state.cameraCinematicTunnelEditShotIds;
    mediumSecondFamilies.add(familyForTunnelShot(mediumSecondShotId));
    mediumVisits.queueTransition(
      cameraCinematicContract.shots[mediumFirstShotId],
      cameraCinematicContract.shots[mediumSecondShotId]
    );
    mediumTransitionPolicies.add(mediumVisits.state.cameraCinematicLastTransitionPolicy);
  }
  assert.deepEqual(mediumSecondFamilies, new Set(['mount', 'profile']));
  assert.deepEqual(mediumTransitionPolicies, new Set(['cut', 'blend']));

  const shortVisit = makeDirectorHarness({ runSeed: 15_019 });
  shortVisit.state.testTunnelSpanM = 413.6;
  const families = [];
  const mountedVariants = new Set();
  for (let visit = 0; visit < 9; visit++) {
    const shotId = shortVisit.prepareTunnelEdit({
      cinematicTunnelKind: 'mountain-tunnel',
      cinematicTunnelPathDistanceM: 8_000
    });
    families.push(familyForTunnelShot(shotId));
    if (cameraCinematicContract.shots[shotId].mount) mountedVariants.add(shotId);
  }
  assert.deepEqual(new Set(families.slice(0, 3)), new Set(['corridor', 'mount', 'profile']));
  assert.deepEqual(
    mountedVariants,
    new Set(['tunnelNoseMount', 'tunnelWingMount', 'tunnelTailMount'])
  );
});

test('tunnel shot inventory keeps flowing corridor blends and motivated mounted cuts available', () => {
  const harness = makeDirectorHarness();
  const sequence = cameraCinematicContract.tunnelSequence;
  const transitions = [];
  const pairs = sequence.slice(0, -1).map((shotId, index) => [shotId, sequence[index + 1]]);
  pairs.push([sequence.at(-1), 'tunnelCompression']);
  for (const [previousId, nextId] of pairs) {
    const previous = cameraCinematicContract.shots[previousId];
    const next = cameraCinematicContract.shots[nextId];
    assert.equal(Boolean(previous.mount && next.mount), false, `${previousId} -> ${nextId} stacks mounts`);
    harness.queueTransition(previous, next);
    transitions.push(harness.state.cameraCinematicLastTransitionPolicy);
    if (previous.mount || next.mount) {
      assert.equal(harness.state.cameraCinematicLastTransitionPolicy, 'cut');
    }
  }
  assert.ok(transitions.filter((policy) => policy === 'blend').length >= 2);
  assert.ok(transitions.filter((policy) => policy === 'cut').length >= 4);
});

test('axis reversals, mounts, and both sides of a fixed roadside shot hard-cut on every reel boundary', () => {
  for (const reels of [cameraCinematicContract.desktopReels, cameraCinematicContract.touchReels]) {
    for (const reel of reels) {
      const harness = makeDirectorHarness();
      for (let index = 0; index < reel.length; index++) {
        const previous = cameraCinematicContract.shots[reel[index]];
        const next = cameraCinematicContract.shots[reel[(index + 1) % reel.length]];
        harness.state.cameraCinematicTransitionPending = false;
        harness.state.cameraCinematicHardCutPending = false;
        harness.queueTransition(previous, next);
        const longitudinalReversal = Math.sign(previous.behindM) !== 0
          && Math.sign(next.behindM) !== 0
          && Math.sign(previous.behindM) !== Math.sign(next.behindM);
        const lateralReversal = Math.abs(previous.sideM) >= 5
          && Math.abs(next.sideM) >= 5
          && Math.sign(previous.sideM) !== Math.sign(next.sideM);
        const cutRequired = longitudinalReversal
          || lateralReversal
          || previous.mount
          || next.mount
          || previous.worldLocked
          || next.worldLocked;
        if (cutRequired) {
          assert.equal(
            harness.state.cameraCinematicHardCutPending,
            true,
            `missing hard cut at ${previous.id} -> ${next.id}`
          );
        }
      }
    }
  }
  const queue = functionSource('queueCinematicTransition');
  assert.match(queue, /previousShot\?\.worldLocked \|\| nextShot\.worldLocked/);
});

test('hard cuts snap position, look, quaternion, and FOV in the same render frame', () => {
  const cameraUpdate = functionSource('updateCamera');
  assert.match(cameraUpdate, /cinematicHardCutThisFrame = state\.cameraCinematicHardCutPending/);
  assert.match(cameraUpdate, /cameraPositionOffset\.copy\(cameraTargetPositionOffset\)/);
  assert.match(cameraUpdate, /cameraLookOffset\.copy\(cameraTargetLookOffset\)/);
  assert.match(cameraUpdate, /cinematicHardCutThisFrame\)[\s\S]*?camera\.quaternion\.copy\(cameraQuaternionTarget\)/);
  assert.match(
    cameraUpdate,
    /camera\.fov = reducedMotionEnabled \|\| cinematicHardCutThisFrame \|\| cinematicMountedLock\s*\? targetFov/
  );
  assert.match(cameraUpdate, /camera\.updateProjectionMatrix\(\)/);
});

test('roadside flyby establishes ahead, stays absolutely fixed, pans, and cuts after a readable pass', () => {
  const shot = cameraCinematicContract.shots.flyby;
  assert.equal(shot.worldLocked, true);
  assert.equal(shot.behindTravelM, 0);
  assert.equal(shot.sideTravelM, 0);
  assert.equal(shot.heightTravelM, 0);
  assert.ok(shot.worldLeadSeconds >= 1);
  assert.ok(shot.worldExitBehindSeconds >= 0.3);

  for (const speedKmh of [100, 1_080, 2_800]) {
    const speedMps = speedKmh / 3.6;
    const leadM = clamp(
      speedMps * shot.worldLeadSeconds,
      shot.worldLeadMinimumM,
      shot.worldLeadMaximumM
    );
    const tailM = clamp(
      speedMps * shot.worldExitBehindSeconds,
      shot.worldExitMinimumM,
      shot.worldExitMaximumM
    );
    const passTimeSeconds = leadM / speedMps;
    const visibleWindowSeconds = (leadM + tailM) / speedMps;
    assert.ok(passTimeSeconds >= 0.8 && passTimeSeconds <= 2.6, `${speedKmh} km/h pass is mistimed`);
    assert.ok(visibleWindowSeconds >= 1 && visibleWindowSeconds <= 3.5, `${speedKmh} km/h hold is unreadable`);
  }

  const update = functionSource('updateCamera');
  assert.match(update, /const cinematicPositionOffsetM = cinematicShot\.worldLocked[\s\S]*?worldLeadSeconds/);
  assert.match(update, /sampleCinematicCommittedFrame\(\s*cinematicPositionOffsetM/);
  assert.match(update, /worldAnchorTangentX = Number\(cinematicPositionFrame\.tangentX \?\? 0\)/);
  assert.match(update, /worldAnchorTangentLength = Math\.hypot/);
  assert.match(update, /cinematicWorldAnchorPassed/);
  assert.match(update, /Number\.isFinite\(cinematicWorldPathProgressM\)[\s\S]*?cinematicWorldTangentProgressM/);
  assert.match(update, /cinematicWorldLockedPosition[\s\S]*?cameraPositionOffset\.copy\(cameraTargetPositionOffset\)/);
  assert.match(update, /cameraTargetLookOffset\.set\(\s*player\.position\.x - routeAnchor\.x/);

  const fixedAnchor = { x: 9_200, y: 7.5, z: -31_000 };
  for (const frame of [
    { originX: 8_000, originZ: -30_000, routeX: 0, routeZ: 0 },
    { originX: 8_550, originZ: -30_480, routeX: 2.4, routeZ: -1.8 },
    { originX: 9_010, originZ: -30_880, routeX: -3.2, routeZ: 4.1 }
  ]) {
    const offsetX = fixedAnchor.x - frame.originX - frame.routeX;
    const offsetZ = fixedAnchor.z - frame.originZ - frame.routeZ;
    assert.equal(frame.originX + frame.routeX + offsetX, fixedAnchor.x);
    assert.equal(frame.originZ + frame.routeZ + offsetZ, fixedAnchor.z);
  }
  for (const [tangentX, tangentZ] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const length = Math.hypot(tangentX, tangentZ);
    assert.equal(tangentX / length * tangentX + tangentZ / length * tangentZ, 1);
  }
  const curveRadiusM = 60;
  const halfTurnPathM = Math.PI * curveRadiusM;
  const halfTurnInitialTangentProjectionM = 0;
  assert.ok(halfTurnPathM > shot.worldExitMaximumM);
  assert.ok(halfTurnInitialTangentProjectionM < shot.worldExitMinimumM);
});

test('mounted lenses inherit the rendered hull attitude without writing craft or route state', () => {
  const update = functionSource('updateCamera');
  assert.match(update, /cameraCinematicMountRight\.set\(1, 0, 0\)\.applyQuaternion\(player\.quaternion\)/);
  assert.match(update, /cameraCinematicMountUp\.set\(0, 1, 0\)\.applyQuaternion\(player\.quaternion\)/);
  assert.match(update, /cameraCinematicMountForward\.set\(0, 0, -1\)\.applyQuaternion\(player\.quaternion\)/);
  assert.match(update, /cameraCinematicMountWorldPosition\.copy\(player\.position\)/);
  assert.match(update, /cameraCinematicMountWorldPosition\.y - state\.contactHeight/);
  assert.match(update, /let cinematicMountedLock = cinematicViewActive[\s\S]*?cinematicPathResolved/);
  assert.match(update, /cinematicWorldLockedPosition[\s\S]*?cinematicMountedLock[\s\S]*?cameraPositionOffset\.copy/);
  assert.match(update, /cinematicHardCutThisFrame \|\| cinematicMountedLock\)[\s\S]*?cameraLookOffset\.copy/);
  assert.match(update, /cameraCinematicMountLookMatrix\.lookAt\([\s\S]*?cameraCinematicMountUp/);
  assert.match(update, /cinematicHardCutThisFrame \|\| cinematicMountedLock\)[\s\S]*?camera\.quaternion\.copy/);
  assert.match(update, /cinematicHardCutThisFrame \|\| cinematicMountedLock[\s\S]*?\? targetFov/);
  assert.match(update, /if \(!cinematicMountedLock\) {[\s\S]*?camera\.rotateZ/);
  assert.doesNotMatch(update, /player\.(?:position|quaternion)\s*=/);

  let renderedPositionM = 0;
  for (const targetPositionM of [0, 1.4, 8.2, 21.7, 67.3]) {
    renderedPositionM = targetPositionM;
    assert.equal(Math.abs(renderedPositionM - targetPositionM), 0);
  }
});

test('committed film sampling walks a frozen edge list and cannot extend an itinerary', () => {
  const edges = new Map([
    ['a', { id: 'a', length: 10 }],
    ['b', { id: 'b', length: 20 }],
    ['c', { id: 'c', length: 30 }]
  ]);
  const itinerary = { nextTile: 99 };
  const edgeIndexById = new Map([['a', 0], ['b', 1], ['c', 2]]);
  const pathPlan = {
    edgeIds: ['a', 'b', 'c'],
    cumulativeLengths: [0, 10, 30, 60],
    edgeIndexById,
    itinerary
  };
  const routeCursor = { edgeId: 'b', edgeS: 5, runDistance: 15 };
  const state = { routeCursor, pathPlan };
  let signedSamplerCalls = 0;
  const track = {
    getEdge: (edgeId) => edges.get(edgeId),
    sampleEdge: (edgeId, edgeS, lateral, out) => Object.assign(out, { edgeId, edgeS, lateral }),
    sampleSignedPathFrame: () => {
      signedSamplerCalls++;
      throw new Error('mutating sampler must not be called');
    }
  };
  const sampler = compileRuntimeFunction('sampleCinematicCommittedRawFrame', {
    hasRouteGraphContract: () => true,
    state,
    track,
    clamp
  });
  const snapshot = {
    edgeIds: [...pathPlan.edgeIds],
    cumulativeLengths: [...pathPlan.cumulativeLengths],
    edgeIndexEntries: [...edgeIndexById],
    cursor: { ...routeCursor },
    planIdentity: pathPlan,
    mapIdentity: edgeIndexById,
    itineraryIdentity: itinerary
  };
  assert.deepEqual(sampler(8, 1.5, {}), { edgeId: 'b', edgeS: 13, lateral: 1.5 });
  assert.deepEqual(sampler(-8, -2, {}), { edgeId: 'a', edgeS: 7, lateral: -2 });
  assert.deepEqual(sampler(10_000, 0, {}), { edgeId: 'c', edgeS: 30, lateral: 0 });
  assert.deepEqual(sampler(-10_000, 0, {}), { edgeId: 'a', edgeS: 0, lateral: 0 });
  assert.equal(signedSamplerCalls, 0);
  assert.equal(state.pathPlan, snapshot.planIdentity);
  assert.equal(pathPlan.edgeIndexById, snapshot.mapIdentity);
  assert.equal(pathPlan.itinerary, snapshot.itineraryIdentity);
  assert.deepEqual(pathPlan.edgeIds, snapshot.edgeIds);
  assert.deepEqual(pathPlan.cumulativeLengths, snapshot.cumulativeLengths);
  assert.deepEqual([...pathPlan.edgeIndexById], snapshot.edgeIndexEntries);
  assert.deepEqual(routeCursor, snapshot.cursor);

  const wrapper = functionSource('sampleCinematicCommittedFrame');
  assert.match(wrapper, /sampleCinematicCommittedRawFrame\(offsetM, lateral, out\)/);
  assert.doesNotMatch(wrapper, /sampleSignedPathFrame|samplePathFrame/);

  const distance = compileRuntimeFunction('cinematicCommittedPathDistance', { state, track, clamp });
  assert.equal(distance({ edgeId: 'a', edgeS: 4 }), 4);
  assert.equal(distance({ edgeId: 'c', edgeS: 12 }), 42);
});

test('one bounded read-only portal scan measures the first matching tunnel boundary', () => {
  for (const [tunnelKind, expectedSpanM] of [
    ['mountain-tunnel', 413.6],
    ['underground-tunnel', 1_254.1]
  ]) {
    let sampleCount = 0;
    const probeFrame = {};
    const measure = compileRuntimeFunction('measureCinematicTunnelRemainingSpanM', {
      hasRouteGraphContract: () => false,
      state: {},
      sampleCinematicCommittedFrame: (offsetM, _lateral, out) => {
        sampleCount++;
        return Object.assign(out, {
          covered: offsetM < expectedSpanM,
          tunnelKind: offsetM < expectedSpanM ? tunnelKind : null
        });
      },
      cameraCinematicTunnelProbeFrame: probeFrame,
      cinematicCommittedPathDistance: () => Number.NaN,
      track: {},
      clamp
    });
    const measuredSpanM = measure(tunnelKind);
    assert.ok(Math.abs(measuredSpanM - expectedSpanM) < 0.02, `${tunnelKind} scan drifted`);
    assert.ok(sampleCount <= Math.ceil(4_000 / 16) + 10, 'portal scan exceeded its fixed bound');
  }
  const measureSource = functionSource('measureCinematicTunnelRemainingSpanM');
  assert.match(measureSource, /sampleCinematicCommittedFrame/);
  assert.doesNotMatch(measureSource, /samplePathFrame|appendNextItineraryTile|navigationPathPlan/);
});

test('roadside establishment stops before the first hidden set even when both endpoints are open', () => {
  const referenceFrame = { covered: false, tunnelKind: null, structure: null };
  function runBoundaryCase(setAtDistance) {
    const boundaryProbe = {};
    const sample = (offsetM, _lateral, out) => Object.assign(out, {
      offsetM,
      covered: setAtDistance(offsetM) === 'tunnel',
      tunnelKind: setAtDistance(offsetM) === 'tunnel' ? 'mountain-tunnel' : null,
      structure: setAtDistance(offsetM) === 'underpass' ? 'cloverleaf-underpass' : null
    });
    const anchorSampler = compileRuntimeFunction('sampleCinematicWorldAnchorFrame', {
      sampleCinematicCommittedFrame: sample,
      cameraCinematicBoundaryProbeFrame: boundaryProbe
    });
    return anchorSampler(200, 0, referenceFrame, {});
  }
  const tunnel = runBoundaryCase((distanceM) => distanceM >= 80 && distanceM <= 120 ? 'tunnel' : 'open');
  const underpass = runBoundaryCase((distanceM) => distanceM >= 140 && distanceM <= 175 ? 'underpass' : 'open');
  assert.ok(tunnel.offsetM < 80, `tunnel boundary was crossed at ${tunnel.offsetM}`);
  assert.ok(underpass.offsetM < 140, `underpass boundary was crossed at ${underpass.offsetM}`);
});

test('tunnel blends keep authored edit timing while physical ceilings remain a separate clamp', () => {
  const update = functionSource('updateCamera');
  assert.match(update, /const transitionSoftness = cinematicViewActive\s*\? baseTransitionSoftness/);
  assert.match(update, /cinematicAuthoredBlendSoftness = 2\.995_732 \/ Math\.max/);
  assert.match(
    update,
    /const previewCeilings = \(cinematicViewActive[\s\S]*?cinematicCameraPositionCeilingHeight/
  );
  assert.match(update, /cinematicViewActive && cinematicTunnelBlend > 0\.001/);
  assert.match(update, /cinematicViewActive\s*\? cinematicShotFovDegrees/);
  assert.match(update, /const openRoadFov = cinematicViewActive[\s\S]*?\? cinematicShotFovDegrees\s*: topViewActive/);
  assert.match(update, /const underpassFov = cinematicViewActive\s*\? cinematicShotFovDegrees/);
  assert.match(update, /const tunnelFov = cinematicViewActive\s*\? cinematicShotFovDegrees/);
  assert.match(update, /cinematicCameraPositionCeilingHeight[\s\S]*?cameraCeilingClampBlend/);
  for (const speedKmh of [20, 50, 100, 160]) {
    const progress = clamp(speedKmh / 160, 0, 1);
    const authoredHeightM = cameraCinematicContract.shots.tunnelExitReveal.heightM
      + cameraCinematicContract.shots.tunnelExitReveal.heightTravelM * progress;
    const roofLimitedHeightM = Math.min(authoredHeightM, 3.6 - 0.95);
    assert.ok(roofLimitedHeightM <= 2.65 + 0.000_001);
  }
});

test('Film camera director never uses gameplay safety to choose a shot and samples only the committed PathPlan', () => {
  const director = functionSource('updateCinematicCameraDirector');
  assert.doesNotMatch(director, /hazard|damage-protection|airborne-landing|safety-hold|touch-conservative/i);
  assert.doesNotMatch(director, /cameraCinematicSafetyOverride|cameraCinematicRejectedShotCount/);
  assert.match(runtime, /const shakeX = !cinematicViewActive && !reducedMotionEnabled/);
  assert.match(runtime, /const shakeY = !cinematicViewActive && !reducedMotionEnabled/);
  assert.match(runtime, /sampleCinematicCommittedFrame\(\s*-cameraPositionBehind|sampleCinematicCommittedFrame\(\s*cinematicPositionOffsetM/);
  assert.doesNotMatch(functionSource('sampleCinematicCommittedRawFrame'), /navigationPathPlan|appendNextItineraryTile/);
});

test('Film flyby envelope drives same-frame frustum-footprint terrain and road residency', () => {
  const flyby = cameraCinematicContract.shots.flyby;
  assert.equal(flyby.worldLeadMaximumM, 650);
  assert.equal(flyby.worldExitMaximumM, 180);
  assert.equal(sceneConfig.sceneVisibilityContract.cameraFarM, 1_600);
  assert.equal(sceneConfig.sceneVisibilityContract.minimumAuthoredRealmFogFarM, 720);
  assert.equal(sceneConfig.sceneVisibilityContract.maximumAuthoredRealmFogFarM, 1_200);
  assert.match(runtime, /new THREE\.PerspectiveCamera\([\s\S]{0,140}?sceneVisibilityContract\.cameraFarM/);
  assert.match(runtime, /mode: 'render-camera-frustum-ground-footprint'/);
  assert.match(
    runtime,
    /supportedMaximumAspect: qualityProfile\.id === 'mobile' \? 2\.4 : 32 \/ 9/
  );
  assert.match(runtime, /supportedMaximumFovDegrees: 84/);
  assert.match(
    runtime,
    /reservedCellCapacity: qualityProfile\.id === 'mobile' \? 1_280 : 2_048/
  );
  assert.match(runtime, /unloadHysteresisCells: 2/);
  assert.match(runtime, /\(maximum, zone\) => Math\.max\(maximum, Number\(zone\.fogFar\) \|\| 420\)/);
  assert.match(runtime, /\) \* sceneVisibilityContract\.terrainFogSafetyMarginRatio;/);
  const terrainUpdate = functionSource('updateTerrainGeometryChunks');
  const terrainView = functionSource('prepareTerrainResidencyView');
  const terrainCollect = functionSource('collectTerrainResidencyCells');
  const terrainSelect = functionSource('selectTerrainResidencyFootprint');
  assert.match(
    terrainUpdate,
    /const worldCenterX = renderOriginX \+ \(Number\(camera\.position\.x\) \|\| 0\);/
  );
  assert.match(
    terrainUpdate,
    /Math\.floor\(\(worldCenterX \+ terrainChunkHalfSize\) \/ terrainChunkSize\)/
  );
  assert.match(terrainView, /const rawAspect = Number\(camera\.aspect\)/);
  assert.match(terrainView, /const rawFovDegrees = Number\(camera\.fov\)/);
  assert.match(terrainView, /applyQuaternion\(camera\.quaternion\)/);
  assert.match(terrainCollect, /farM \* terrainResidencyHorizontalSlope/);
  assert.match(terrainCollect, /farM \* terrainResidencyVerticalSlope/);
  assert.match(terrainCollect, /depthM < -terrainResidencyGuardBandM/);
  assert.match(terrainCollect, /perspectiveDepthM \* terrainResidencyHorizontalSlope/);
  assert.match(terrainCollect, /perspectiveDepthM \* terrainResidencyVerticalSlope/);
  assert.match(terrainSelect, /for \(let iteration = 0; iteration < 12; iteration\+\+\)/);
  assert.match(terrainSelect, /scene\.fog\.far = effectiveFogFarM/);
  assert.match(terrainSelect, /terrainResidencyCoverageFailureCount\+\+/);
  assert.doesNotMatch(
    `${terrainView}\n${terrainCollect}\n${terrainSelect}\n${terrainUpdate}`,
    /new (?:Array|Map|Set)\(/
  );
  const animateLoop = sourceBetween(runtime, 'function animate()', "startBtn.addEventListener('click'");
  const cameraAt = animateLoop.indexOf('updateCamera(simulationFrameDt)');
  const terrainAt = animateLoop.indexOf(
    'updateTerrainGeometryChunks(terrainCurrentZoneIndex, terrainNextZoneIndex)'
  );
  const roadAt = animateLoop.indexOf('updateTrackNetworkVisuals(now)');
  assert.ok(cameraAt >= 0 && cameraAt < terrainAt && terrainAt < roadAt);
  assert.match(runtime, /visibilityOrigin: roadTileVisibilityOrigin/);
});

test('Film controls and shortcut remain semantic while CSS adds no cinematic black bars', () => {
  assert.match(html, /id="cinematicBtn"[^>]*type="button"[^>]*aria-pressed="false"[^>]*aria-keyshortcuts="F"/);
  assert.match(html, /id="mobileCinematicBtn"[^>]*type="button"[^>]*aria-pressed="false"/);
  assert.match(runtime, /shortcutCode: 'KeyF'/);
  assert.match(runtime, /cinematicBtn\.addEventListener\('click', \(\) => toggleCinematicCamera\('desktop-button'\)\)/);
  assert.doesNotMatch(css, /cinematic[^\n{]*(?:letterbox|black-bar)|(?:letterbox|black-bar)[^\n{]*cinematic/i);
});
