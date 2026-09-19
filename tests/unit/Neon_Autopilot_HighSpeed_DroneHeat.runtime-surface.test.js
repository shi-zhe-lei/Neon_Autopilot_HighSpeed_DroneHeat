import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PROJECT_ROOT = new URL('../../', import.meta.url);
const runtimeSource = readFileSync(
  new URL('src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js', PROJECT_ROOT),
  'utf8'
);
const surfaceSource = readFileSync(
  new URL('src/weather/Neon_Autopilot_HighSpeed_DroneHeat.surface-weather.js', PROJECT_ROOT),
  'utf8'
);
const htmlSource = readFileSync(
  new URL('Neon_Autopilot_HighSpeed_DroneHeat.html', PROJECT_ROOT),
  'utf8'
);
const styleSource = readFileSync(
  new URL('styles/Neon_Autopilot_HighSpeed_DroneHeat.css', PROJECT_ROOT),
  'utf8'
);
const requireFromTest = createRequire(import.meta.url);
const gameplayCore = requireFromTest(fileURLToPath(
  new URL('src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js', PROJECT_ROOT)
));

/** Extract one authored declaration without evaluating the browser-only runtime bootstrap. */
function declarationSource(name, nextMarker) {
  const start = runtimeSource.indexOf(`function ${name}(`);
  const end = runtimeSource.indexOf(nextMarker, start);
  assert.ok(start >= 0, `runtime is missing function ${name}`);
  assert.ok(end > start, `runtime is missing the boundary after function ${name}`);
  return runtimeSource.slice(start, end).trim();
}

/** Evaluate a self-contained runtime function against an explicit authority fixture. */
function evaluateDeclaration(name, nextMarker, context) {
  return vm.runInNewContext(
    `(${declarationSource(name, nextMarker)})`,
    vm.createContext(context),
    { filename: `runtime:${name}` }
  );
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

test('terrain grounding inverts quarter-turn cells and samples the rendered triangle plane', () => {
  const terrainLocalPointForWorldCell = evaluateDeclaration(
    'terrainLocalPointForWorldCell',
    '\n\n  /**\n   * Sample the exact two-triangle plane',
    { Math, terrainChunkSize: 96 }
  );
  const reusablePoint = {};
  const expectedByQuarter = [
    [7, -11],
    [11, 7],
    [-7, 11],
    [-11, -7]
  ];
  for (let quarter = 0; quarter < expectedByQuarter.length; quarter++) {
    const result = terrainLocalPointForWorldCell(103, -203, 1, -2, quarter, reusablePoint);
    assert.equal(result, reusablePoint, 'terrain sampling must reuse its caller-owned point');
    assert.deepEqual(
      [result.x, result.z],
      expectedByQuarter[quarter],
      `quarter-turn ${quarter} did not invert the rendered cell transform`
    );
  }

  const vertexHeights = new Map([
    ['-48,-48', 0],
    ['0,-48', 4],
    ['-48,0', 8],
    ['0,0', 20]
  ]);
  const sampleTerrainChunkTriangulatedHeight = evaluateDeclaration(
    'sampleTerrainChunkTriangulatedHeight',
    '\n\n  function pushTerrainVertex',
    {
      Math,
      terrainChunkSize: 96,
      terrainChunkHalfSize: 48,
      terrainSurfaceSegments: 2,
      terrainChunkHeightAt(_primary, _secondary, x, z) {
        const height = vertexHeights.get(`${x},${z}`);
        assert.notEqual(height, undefined, `unexpected triangle vertex ${x},${z}`);
        return height;
      }
    }
  );
  assert.equal(
    sampleTerrainChunkTriangulatedHeight({}, null, -36, -36, 0),
    3,
    'lower triangle must match the first emitted terrain face'
  );
  assert.equal(
    sampleTerrainChunkTriangulatedHeight({}, null, -12, -12, 0),
    13,
    'upper triangle must match the second emitted terrain face'
  );
});

test('runtime exclusively applies the bounded surface speed load and clamps it to 1.2m/s²', () => {
  const state = {
    speed: 100,
    cameraCinematicActive: false,
    manualThrottleMode: true,
    manualBrake: false,
    manualAccelerating: false,
    driveGear: 1,
    pendingDriveGear: null,
    gearShiftRemainingSeconds: 0,
    gearShiftTorqueCutActive: false,
    gearShiftCount: 0,
    autoBrake: false,
    propulsionCoreSpool: 0,
    propulsionCoreRpm: 1_800,
    propulsionThrustNormalized: 0,
    idleCreepEnabled: false,
    idleCreepConnected: false,
    idleCreepActive: false,
    idleCreepThrustNormalized: 0,
    grounded: true,
    currentSurfaceGrade: 0,
    handling: {
      maximumRpm: 12_000,
      spoolUpRatePerSecond: 2.4
    },
    surfaceContact: { longitudinalDecelerationMps2: 9_999 }
  };
  const propulsionInputs = [];
  const gameplayCore = {
    resolveDriveGearTorqueAvailability(_gear, _speedMps, target) {
      Object.assign(target, {
        torqueAvailability: 1,
        lugging: false,
        stalled: false
      });
      return target;
    },
    resolvePropulsionCoreStep(input, dt, target) {
      propulsionInputs.push({
        idleCreepEnabled: input.idleCreepEnabled,
        grounded: input.grounded
      });
      Object.assign(target, {
        nextSpool: input.currentSpool,
        rpm: 1_800,
        thrustNormalized: 0,
        idleCreepEnabled: input.idleCreepEnabled,
        idleCreepConnected: input.idleCreepEnabled && input.grounded,
        idleCreepActive: false,
        idleCreepThrustNormalized: 0,
        accelerationMps2: 0,
        averageAccelerationMps2: 0
      });
      return target;
    },
    resolveLongitudinalDynamicsStep(input, dt, target) {
      Object.assign(target, {
        nextSpeedMps: Math.max(0, input.speedMps - input.surfaceDecelerationMps2 * dt),
        rollingResistanceMps2: 0,
        linearDragMps2: 0,
        aerodynamicDragMps2: 0,
        passiveResistanceMps2: 0,
        gradeAccelerationMps2: 0,
        propulsionAccelerationMps2: input.propulsionAccelerationMps2,
        brakeDecelerationMps2: input.brakeDecelerationMps2,
        surfaceDecelerationMps2: input.surfaceDecelerationMps2,
        netAccelerationMps2: -input.surfaceDecelerationMps2
      });
      return target;
    }
  };
  const updateLongitudinalControl = evaluateDeclaration(
    'updateLongitudinalControl',
    '\n\n  const autoPlannerTargetHz',
    {
      state,
      keys: { brake: false, throttle: false },
      updateCinematicJumpDrivePlan() { return false; },
      updateCurveDynamics() {},
      requestCinematicDriveGear() { return false; },
      requestAutomaticDriveGear() { return false; },
      longitudinalAuthorityMode() { return 'player'; },
      automaticDrivingAuthorityActive() { return false; },
      resolveAutopilotThrottleCommand() { return 0; },
      opposingVariantReadinessRequiresBoundaryBrake() { return false; },
      clamp,
      minimumDriveSpeed: 0,
      sharedBrakeDeceleration: 80,
      fairAutopilotContractSpeed: 120 / 3.6,
      gameplayCore,
      driveGearContract: {
        automaticMaximumGear: 3,
        gears: { 1: { fullThrustAccelerationMps2: 1 } }
      },
      propulsionCoreStepScratch: {},
      driveGearTorqueStateScratch: {},
      longitudinalDynamicsStepScratch: {},
      surfaceForceContract: { maximumLongitudinalDecelerationMps2: 1.2 },
      syncGearControlPresentation() {},
      resolvePropulsionCoreState() { return 'idle'; }
    }
  );

  updateLongitudinalControl(0.5);
  assert.equal(state.speed, 99.4, '9_999m/s² input must still apply only the authored 1.2m/s² load');
  assert.deepEqual(propulsionInputs[0], { idleCreepEnabled: true, grounded: true });
  assert.equal(state.idleCreepEnabled, true);
  assert.equal(state.idleCreepConnected, true);
  assert.equal(state.idleCreepActive, false);
  assert.equal(state.idleCreepThrustNormalized, 0);

  state.surfaceContact.longitudinalDecelerationMps2 = -50;
  updateLongitudinalControl(0.5);
  assert.equal(state.speed, 99.4, 'negative surface load must clamp to zero');

  const controlSource = declarationSource(
    'updateLongitudinalControl',
    '\n\n  const autoPlannerTargetHz'
  );
  assert.match(
    controlSource,
    /clamp\([\s\S]*?state\.surfaceContact\.longitudinalDecelerationMps2[\s\S]*?0,\s*surfaceForceContract\.maximumLongitudinalDecelerationMps2\s*\)/
  );
  assert.match(controlSource, /idleCreepEnabled:\s*state\.grounded/);
  assert.match(controlSource, /grounded:\s*state\.grounded/);
  for (const field of [
    'idleCreepEnabled',
    'idleCreepConnected',
    'idleCreepActive',
    'idleCreepThrustNormalized'
  ]) {
    assert.match(
      controlSource,
      new RegExp(`state\\.${field} = propulsionStep\\.${field}`),
      `${field} must remain an independent propulsion-core output`
    );
  }
  assert.equal(
    runtimeSource.match(/state\.surfaceContact\.longitudinalDecelerationMps2/g)?.length,
    1,
    'longitudinal control must be the sole runtime reader of the surface deceleration'
  );
  assert.match(runtimeSource, /surfaceContact:\s*\{[\s\S]*?longitudinalDecelerationMps2:\s*0/);
  assert.match(runtimeSource, /contactTarget:\s*state\.surfaceContact/);
  assert.doesNotMatch(
    surfaceSource,
    /\bstate\.(?:speed|distance|lateral|lateralVelocity)\s*(?:=|\+=|-=|\*=|\/=)/,
    'surface sampling may return coefficients but must not write authoritative motion'
  );
});

test('manual flight and autopilot consume the same surface-limited lateral profile', () => {
  const cruiseSpeedMps = 120 / 3.6;
  const terminalSpeedMps = 160 / 3.6;
  const jumpSpeedMps = 280 / 3.6;
  const lateralKinematicsContract = {
    stopped: { maximumSpeedMps: 7, accelerationMps2: 12, dragPerSecond: 2 },
    cruise: { maximumSpeedMps: 9, accelerationMps2: 15, dragPerSecond: 2.2 },
    terminal: { maximumSpeedMps: 10, accelerationMps2: 17, dragPerSecond: 2.4 }
  };
  const state = {
    handling: {
      lateralSpeedMultiplier: 1,
      lateralAccelerationMultiplier: 1,
      dragMultiplier: 1
    },
    surfaceContact: {
      lateralSpeedMultiplier: 1,
      lateralAccelerationMultiplier: 1,
      lateralDragMultiplier: 1
    }
  };
  const getPlayerKinematics = evaluateDeclaration(
    'getPlayerKinematics',
    '\n\n  function getAutoKinematics',
    {
      state,
      clamp,
      lerp: (start, end, progress) => start + (end - start) * progress,
      fairAutopilotContractSpeed: cruiseSpeedMps,
      verifiedAutoPilotSpeed: terminalSpeedMps,
      lateralKinematicsContract
    }
  );
  const stopped = getPlayerKinematics(0);
  const baseline = getPlayerKinematics(cruiseSpeedMps);
  const terminal = getPlayerKinematics(terminalSpeedMps);
  const jump = getPlayerKinematics(jumpSpeedMps);
  assert.deepEqual(
    [stopped.maxLatSpeed, stopped.maxLatAccel, stopped.dragRate],
    [7, 12, 2]
  );
  assert.deepEqual(
    [baseline.maxLatSpeed, baseline.maxLatAccel, baseline.dragRate],
    [9, 15, 2.2]
  );
  assert.deepEqual(
    [terminal.maxLatSpeed, terminal.maxLatAccel, terminal.dragRate],
    [10, 17, 2.4]
  );
  assert.deepEqual(
    [jump.maxLatSpeed, jump.maxLatAccel, jump.dragRate],
    [10, 17, 2.4],
    'jump gear must retain the audited 160km/h lateral endpoint'
  );

  state.surfaceContact.lateralSpeedMultiplier = 0.84;
  state.surfaceContact.lateralAccelerationMultiplier = 0.58;
  state.surfaceContact.lateralDragMultiplier = 0.44;
  const surfaceLimited = getPlayerKinematics(cruiseSpeedMps);

  assert.ok(Math.abs(surfaceLimited.maxLatSpeed - baseline.maxLatSpeed * 0.84) < 0.000_000_001);
  assert.ok(Math.abs(surfaceLimited.maxLatAccel - baseline.maxLatAccel * 0.58) < 0.000_000_001);
  assert.ok(Math.abs(surfaceLimited.dragRate - baseline.dragRate * 0.44) < 0.000_000_001);

  const getAutoKinematicsSource = declarationSource(
    'getAutoKinematics',
    '\n\n  function sampleGameplaySurfaceAhead'
  );
  assert.match(getAutoKinematicsSource, /return getPlayerKinematics\(speed\);/);
  assert.doesNotMatch(getAutoKinematicsSource, /surfaceContact/);

  const integrateSource = declarationSource(
    'integratePlayerLateralStep',
    '\n\n  function currentPortalSteer'
  );
  assert.match(integrateSource, /const kin = getPlayerKinematics\(Math\.max\(1, state\.speed\)\);/);
  assert.match(integrateSource, /steerAcceleration:\s*kin\.maxLatAccel/);
  assert.match(integrateSource, /dragRate:\s*kin\.dragRate/);
  assert.match(integrateSource, /maximumSpeed:\s*kin\.maxLatSpeed/);

  const playerUpdateSource = declarationSource(
    'updatePlayer',
    '\n\n  function isDynamicObstacle'
  );
  assert.match(
    playerUpdateSource,
    /const steerCommand = manualSteer !== 0 \? manualSteer : autoSteer;[\s\S]*?advanceSteeringActuator\([\s\S]*?integratePlayerLateralStep\(dt, steeringStep\.averageActuator\)/
  );
});

test('shared 120km/h lane-change response remains stable at 30/60/120Hz', () => {
  const crossingTimes = [];
  for (const cadenceHz of [30, 60, 120]) {
    const dt = 1 / cadenceHz;
    let actuator = 0;
    let lateral = 0;
    let velocity = 0;
    let elapsed = 0;
    let previousLateral = 0;
    while (lateral < 3.8 && elapsed < 3) {
      previousLateral = lateral;
      const actuatorStep = gameplayCore.advanceSteeringActuator(actuator, 1, dt, {});
      actuator = actuatorStep.nextActuator;
      const lateralStep = gameplayCore.integrateLateralStep({
        lateral,
        velocity,
        steer: actuatorStep.averageActuator,
        steerAcceleration: 15,
        dragRate: 2.2,
        maximumSpeed: 9
      }, dt);
      lateral = lateralStep.lateral;
      velocity = lateralStep.velocity;
      elapsed += dt;
    }
    const crossedDistance = lateral - previousLateral;
    const crossingFraction = crossedDistance > 0 ? (3.8 - previousLateral) / crossedDistance : 1;
    crossingTimes.push(elapsed - dt + crossingFraction * dt);
  }
  assert.ok(crossingTimes[0] > 0.6 && crossingTimes[0] < 1.5);
  assert.ok(
    Math.max(...crossingTimes) - Math.min(...crossingTimes) < 1 / 30,
    `lane-change cadence drifted: ${crossingTimes.join(', ')}`
  );
});

test('surface attitude stays inside reduced-motion-aware ship presentation', () => {
  const attitudeReads = [
    ...runtimeSource.matchAll(
      /state\.surfaceContact\.(attitudeHeaveM|attitudePitchRad|attitudeRollRad)/g
    )
  ];
  assert.deepEqual(
    attitudeReads.map((match) => match[1]).sort(),
    ['attitudeHeaveM', 'attitudePitchRad', 'attitudeRollRad'],
    'each response attitude component must have exactly one runtime read'
  );

  const visualStart = runtimeSource.indexOf(
    'const surfaceAttitudeScale = reducedMotionEnabled || coveredRouteActive ? 0 : 1;'
  );
  const visualEnd = runtimeSource.indexOf('state.currentSurfaceGrade =', visualStart);
  assert.ok(visualStart >= 0 && visualEnd > visualStart);
  const visualSource = runtimeSource.slice(visualStart, visualEnd);
  for (const field of ['attitudeHeaveM', 'attitudePitchRad', 'attitudeRollRad']) {
    assert.match(visualSource, new RegExp(`state\\.surfaceContact\\.${field}`));
  }
  assert.match(visualSource, /player\.position\.set\(/);
  assert.match(visualSource, /const requestedRelativeRoll =/);
  assert.match(visualSource, /const targetPitch = coveredRouteActive/);
  assert.doesNotMatch(
    visualSource,
    /state\.(?:altitude|verticalVelocity|lateral|lateralVelocity|speed|distance)\s*(?:=|\+=|-=|\*=|\/=)/
  );

  const longitudinalSource = declarationSource(
    'updateLongitudinalControl',
    '\n\n  const autoPlannerTargetHz'
  );
  const lateralSource = declarationSource(
    'integratePlayerLateralStep',
    '\n\n  function currentPortalSteer'
  );
  assert.doesNotMatch(`${longitudinalSource}\n${lateralSource}`, /attitude(?:Heave|Pitch|Roll)/);
});

test('raised platform grade reduces full-thrust energy and owns the grounded visual pitch', () => {
  const playerUpdateSource = declarationSource(
    'updatePlayer',
    '\n\n  function isDynamicObstacle'
  );
  assert.match(
    playerUpdateSource,
    /const playerFrame = sampleGameplaySurfaceAhead\(0, playerFrameScratch, state\.lateral\)/
  );
  assert.match(
    playerUpdateSource,
    /const groundedSurfaceGrade = state\.grounded \? Number\(playerFrame\.grade\) \|\| 0 : 0/
  );
  assert.match(
    playerUpdateSource,
    /const physicsPitch = resolveSurfacePhysicsPitch\(\s*groundedSurfaceGrade,\s*state\.grounded,/
  );
  assert.match(playerUpdateSource, /state\.currentSurfaceGrade = groundedSurfaceGrade/);

  const resolveSurfacePhysicsPitch = evaluateDeclaration(
    'resolveSurfacePhysicsPitch',
    '\n\n  function updatePlayer',
    { clamp }
  );
  const platformGrade = 0.277_054_510_088_528_05;
  const groundedPitch = resolveSurfacePhysicsPitch(platformGrade, true, 0, 260 / 3.6);
  assert.ok(groundedPitch > 0.25, 'the physical platform slope must produce a visible nose-up pitch');
  assert.ok(Math.abs(groundedPitch - Math.atan(platformGrade)) < 0.000_000_001);

  const thirdGear = gameplayCore.DRIVE_GEAR_CONTRACT.gears[3];
  const input = {
    speedMps: 260 / 3.6,
    propulsionAccelerationMps2: thirdGear.fullThrustAccelerationMps2,
    grounded: true
  };
  const flat = gameplayCore.resolveLongitudinalDynamicsStep({ ...input, surfaceGrade: 0 }, 0.5, {});
  const ramp = gameplayCore.resolveLongitudinalDynamicsStep(
    { ...input, surfaceGrade: platformGrade },
    0.5,
    {}
  );
  assert.ok(ramp.nextSpeedMps < flat.nextSpeedMps, 'full thrust must still pay the platform grade load');
  assert.ok(
    ramp.nextSpeedMps * ramp.nextSpeedMps < flat.nextSpeedMps * flat.nextSpeedMps,
    'platform traversal must retain less specific kinetic energy than flat-road traversal'
  );
});

test('Film remains camera-only across physical support and every player actuator', () => {
  const surfaceSampler = declarationSource(
    'sampleGameplaySurfaceAhead',
    '\n\n  /** Autopilot follows physical grades passively'
  );
  assert.match(
    surfaceSampler,
    /const encounterKeepsFlatRoadSupport = state\.jumpPlatformSupportEncounterId[\s\S]*?state\.jumpPlatformSupportEncounterUsesFlatSupport === true/
  );
  assert.doesNotMatch(surfaceSampler, /cameraCinematic/);

  const automaticAuthority = declarationSource(
    'automaticDrivingAuthorityActive',
    '\n\n  /** Resolve the one effective longitudinal owner'
  );
  assert.match(automaticAuthority, /return state\.autoPilot;/);
  assert.doesNotMatch(automaticAuthority, /cameraCinematic/);

  const longitudinal = declarationSource(
    'updateLongitudinalControl',
    '\n\n  const autoPlannerTargetHz'
  );
  assert.match(longitudinal, /state\.manualBrake = keys\.brake;/);
  assert.match(
    longitudinal,
    /state\.manualAccelerating = authority === 'player' && keys\.throttle && !keys\.brake;/
  );
  assert.doesNotMatch(longitudinal, /cameraCinematic|cinematicSafety/);

  const shift = declarationSource(
    'requestDriveGear',
    '\n\n  /** Automatic transmission owns'
  );
  assert.doesNotMatch(shift, /cameraCinematic|cinematic-/);

  const jumpSource = declarationSource(
    'jump',
    '\n\n  /** Keep the pause action'
  );
  assert.doesNotMatch(jumpSource, /cameraCinematic/);

  const playerSource = declarationSource(
    'updatePlayer',
    '\n\n  function updateEntities'
  );
  assert.match(playerSource, /const manualSteer = \(keys\.right \? 1 : 0\) - \(keys\.left \? 1 : 0\);/);
  assert.match(playerSource, /const steerCommand = manualSteer !== 0 \? manualSteer : autoSteer;/);
  assert.doesNotMatch(playerSource, /cameraCinematicJump|cameraCinematic.*(?:autoTarget|manualBrake)/);

  const filmToggle = declarationSource(
    'setCinematicCamera',
    '\n\n  function toggleCinematicCamera'
  );
  assert.match(filmToggle, /state\.cameraCinematicActive = true;/);
  assert.match(filmToggle, /state\.cameraCinematicActive = false;/);
  assert.doesNotMatch(
    filmToggle,
    /state\.(?:autoPilot|manualThrottleMode|driveTransmissionMode|driveGear|pendingDriveGear|speed|lateral|autoTarget|manualBrake|autoBrake|throttleCommand)\s*=/
  );
  assert.doesNotMatch(filmToggle, /releaseAllInputs|prepareAutomaticDrivingAuthorityState/);
  assert.doesNotMatch(
    runtimeSource,
    /function (?:updateCinematicJumpDrivePlan|requestCinematicDriveGear|acquireCinematicDrivingAuthority|releaseCinematicDrivingAuthority)\(/
  );
});

test('Film safety removes only an accepted contact and never drives for the player', () => {
  const obstacle = { trafficGroupId: 71, routeId: 'traffic-east' };
  const obstacles = [obstacle];
  const events = [];
  const state = {
    cameraCinematicActive: true,
    autoPilot: false,
    manualThrottleMode: true,
    driveTransmissionMode: 'manual',
    driveGear: 3,
    throttleCommand: 1,
    manualBrake: false,
    autoBrake: false,
    autoTarget: 4.5,
    lateral: 2.25,
    speed: 180 / 3.6,
    lives: 3,
    cinematicSafetyIntervenedThisRenderFrame: false,
    cinematicSafetyInterventionCount: 0,
    cinematicSafetyLastSource: 'none',
    routeCursor: { edgeId: 'trunk-east' },
    activeRouteId: 'trunk-east'
  };
  const statusEl = { textContent: '' };
  const interceptCinematicSafetyContact = evaluateDeclaration(
    'interceptCinematicSafetyContact',
    '\n\n  /**\n   * Apply every ordinary life loss',
    {
      Number,
      state,
      obstacles,
      releaseObstacleTrafficGroup(candidate) {
        assert.equal(candidate, obstacle);
        obstacles.splice(0, obstacles.length);
        return 1;
      },
      recordTrackEvent(type, detail) { events.push([type, detail]); },
      statusEl,
      uiText(key) { return key; }
    }
  );

  const drivingSnapshot = {
    autoPilot: state.autoPilot,
    manualThrottleMode: state.manualThrottleMode,
    driveTransmissionMode: state.driveTransmissionMode,
    driveGear: state.driveGear,
    throttleCommand: state.throttleCommand,
    manualBrake: state.manualBrake,
    autoBrake: state.autoBrake,
    autoTarget: state.autoTarget,
    lateral: state.lateral,
    speed: state.speed
  };
  assert.equal(interceptCinematicSafetyContact(0, 'obstacle'), true);
  assert.equal(state.lives, 3);
  assert.deepEqual(
    {
      autoPilot: state.autoPilot,
      manualThrottleMode: state.manualThrottleMode,
      driveTransmissionMode: state.driveTransmissionMode,
      driveGear: state.driveGear,
      throttleCommand: state.throttleCommand,
      manualBrake: state.manualBrake,
      autoBrake: state.autoBrake,
      autoTarget: state.autoTarget,
      lateral: state.lateral,
      speed: state.speed
    },
    drivingSnapshot
  );
  assert.equal(state.cinematicSafetyInterventionCount, 1);
  assert.equal(state.cinematicSafetyLastSource, 'obstacle');
  assert.equal(obstacles.length, 0);
  assert.equal(events.length, 1);
  assert.equal(statusEl.textContent, 'cinematic.safetyStatus');
  assert.equal(interceptCinematicSafetyContact(-1, 'guardrail'), true);
  assert.equal(state.cinematicSafetyInterventionCount, 1);

  const safetySource = declarationSource(
    'interceptCinematicSafetyContact',
    '\n\n  /**\n   * Apply every ordinary life loss'
  );
  assert.doesNotMatch(
    safetySource,
    /state\.(?:autoPilot|manualThrottleMode|driveTransmissionMode|driveGear|speed|lateral|autoTarget|manualBrake|autoBrake|throttleCommand)\s*=/
  );

  const damageState = { running: true, gameOver: false, paused: false, lives: 3 };
  let ordinaryGateCalls = 0;
  const takeDamage = evaluateDeclaration(
    'takeDamage',
    '\n\n  /**\n   * Clear damage-only presentation state',
    {
      state: damageState,
      interceptCinematicSafetyContact() { return true; },
      gameplayCore: {
        canAcceptOrdinaryDamage() {
          ordinaryGateCalls++;
          throw new Error('ordinary damage gate must not run after a Film interception');
        }
      }
    }
  );
  assert.equal(takeDamage(0), false);
  assert.equal(damageState.lives, 3);
  assert.equal(ordinaryGateCalls, 0);
});

test('platform support freezes from readiness and ignores camera changes', () => {
  assert.match(
    runtimeSource,
    /jumpPlatformSupportEncounterId:\s*null[\s\S]*?jumpPlatformSupportEncounterUsesFlatSupport:\s*false/
  );
  assert.doesNotMatch(runtimeSource, /jumpPlatformSupportEncounterCinematicBypass/);

  const verticalSource = declarationSource(
    'updateVerticalPhysics',
    '\n\n  function digitalSteerFromTarget'
  );
  assert.match(
    verticalSource,
    /state\.jumpPlatformSupportEncounterUsesFlatSupport = !jumpPlatformLandingSurfaceReady\(routeId\);/
  );
  assert.doesNotMatch(verticalSource, /cameraCinematic/);

  for (const source of [
    declarationSource('resetGame', '\n\n  function endGame'),
    declarationSource(
      'crashFromOffRoadLanding',
      '\n\n  /**\n   * Apply one core sweep'
    ),
    declarationSource(
      'applySweptVerticalResult',
      '\n\n  /** Integrates the vertical rigid-body state'
    )
  ]) {
    assert.match(source, /state\.jumpPlatformSupportEncounterId = null;/);
    assert.match(source, /state\.jumpPlatformSupportEncounterUsesFlatSupport = false;/);
  }

  assert.match(
    runtimeSource,
    /jumpSupportEncounterUsesFlatSupport: state\.jumpPlatformSupportEncounterUsesFlatSupport === true/
  );
  assert.doesNotMatch(runtimeSource, /jumpSupportEncounterCinematicBypass/);
});

test('vertical runtime sweeps platform release, validates real landing support, and retains ceiling chronology', () => {
  const samplerSource = declarationSource(
    'sampleSweptVerticalProfile',
    '\n\n  function predictedJumpYAfter'
  );
  assert.match(
    samplerSource,
    /verticalSweepFrameFractionStart \+ verticalSweepFrameFractionSpan \* fraction/
  );
  assert.match(
    samplerSource,
    /lerp\(state\.previousLateral, state\.lateral, frameFraction\)/
  );

  const applySource = declarationSource(
    'applySweptVerticalResult',
    '\n\n  \/** Integrates the vertical rigid-body state'
  );
  assert.match(applySource, /state\.altitude = Number\.isFinite\(verticalContact\.endAltitude\)/);
  assert.match(applySource, /state\.verticalVelocity = Number\.isFinite\(verticalContact\.endVelocity\)/);
  assert.match(applySource, /if \(verticalContact\.endGrounded\)/);
  assert.match(applySource, /verticalContact\.endGroundedFraction/);
  assert.match(applySource, /verticalContact\.endImpactVelocity/);
  assert.ok(
    applySource.indexOf('resolveAirborneLandingSupport(')
      < applySource.indexOf('state.grounded = true'),
    'A platform landing must resolve real world support before committing grounded state'
  );
  assert.ok(
    applySource.indexOf('adoptAirborneLandingRoute(')
      > applySource.indexOf('resolveAirborneLandingSupport(')
      && applySource.indexOf('adoptAirborneLandingRoute(')
        < applySource.indexOf('state.grounded = true'),
    'A platform landing must adopt route authority before committing grounded state'
  );
  assert.match(applySource, /crashFromOffRoadLanding\(/);
  assert.match(applySource, /if \(!routeAdoption\.supported\)[\s\S]*?crashFromOffRoadLanding\(/);
  assert.match(applySource, /state\.groundSupportCenterLateral = 0/);
  assert.doesNotMatch(applySource, /groundSupportCenterLateral = landingSupport\.centerLateral/);

  const landingSource = declarationSource(
    'resolveAirborneLandingSupport',
    '\n\n  function clearAirborneRoutePlanningState'
  );
  assert.match(landingSource, /track\.samplePathFrame\(/);
  assert.match(landingSource, /track\.queryAirborneLandingSupport\(\s*frame\.x,\s*frame\.z/);
  assert.match(landingSource, /footprintHalfWidthM = playerHalf\.hx/);
  assert.match(landingSource, /footprintHalfLengthM = playerHalf\.hz/);
  assert.match(landingSource, /maximumSurfaceHeight = landingSurfaceHeight \+ 0\.08/);
  assert.match(landingSource, /Math\.abs\(support\.surfaceHeight - landingSurfaceHeight\) > 0\.12/);

  const adoptionSource = declarationSource(
    'adoptAirborneLandingRoute',
    '\n\n  /**\n   * Commit one completed physical flight'
  );
  assert.match(adoptionSource, /track\.resolveAirborneLandingRoute\(landingSupport/);
  assert.match(adoptionSource, /relation === 'current-plan'/);
  assert.match(adoptionSource, /const nextPathPlan =/);
  assert.match(adoptionSource, /const nextPreviousCursor =/);
  assert.match(adoptionSource, /const resolvedEndCursor =/);
  const routeAuthorityAssignments = [
    'state.pathPlan = nextPathPlan',
    'state.previousRouteCursor = nextPreviousCursor',
    'state.routeCursor = resolvedEndCursor',
    'state.previousLateral = nextLateral',
    'state.lateral = nextLateral',
    'state.routeChoices = nextRouteChoices'
  ];
  let precedingAssignmentIndex = -1;
  for (const assignment of routeAuthorityAssignments) {
    const assignmentIndex = adoptionSource.indexOf(assignment);
    assert.ok(
      assignmentIndex > precedingAssignmentIndex,
      `Airborne route transaction is missing or reorders ${assignment}`
    );
    precedingAssignmentIndex = assignmentIndex;
  }
  assert.match(adoptionSource, /clearAirborneRoutePlanningState\(\)/);
  assert.match(adoptionSource, /refreshGraphRenderOrigin\(\)/);
  assert.match(adoptionSource, /minimapNeedsDraw = true/);
  assert.doesNotMatch(adoptionSource, /groundSupportCenterLateral = landingSupport\.centerLateral/);

  const playerSource = declarationSource(
    'updatePlayer',
    '\n\n  function isDynamicObstacle'
  );
  assert.match(playerSource, /const lateralMinimum = freePlatformFlight\s*\?\s*-jumpPlatformAirborneLateralHalf\s*:\s*-roadSafeHalf/);
  assert.match(playerSource, /const lateralMaximum = freePlatformFlight\s*\?\s*jumpPlatformAirborneLateralHalf\s*:\s*roadSafeHalf/);
  assert.doesNotMatch(playerSource, /supportedOffRoute|supportCenter|groundSupportCenterLateral/);

  const crashSource = declarationSource(
    'crashFromOffRoadLanding',
    '\n\n  /**\n   * Apply one core sweep'
  );
  assert.match(crashSource, /recordTrackEvent\('off-road-crash'/);
  assert.match(crashSource, /state\.lastCrashReason = 'off-road-landing'/);
  assert.match(crashSource, /endGame\(\);/);

  const updateSource = declarationSource(
    'updateVerticalPhysics',
    '\n\n  function digitalSteerFromTarget'
  );
  const platformStart = updateSource.indexOf(
    'if (crossedPlatform && crossedPlatform.id !== state.lastJumpPlatformId)'
  );
  const platformSweep = updateSource.indexOf('gameplayCore.sweptVerticalContact({', platformStart);
  const platformReturn = updateSource.indexOf('\n        return;', platformSweep);
  assert.ok(platformStart >= 0 && platformSweep > platformStart && platformReturn > platformSweep);
  const platformSource = updateSource.slice(platformStart, platformReturn);
  assert.match(updateSource, /track\.crossedJumpPlatformLip\(/);
  assert.match(platformSource, /track\.sampleJumpPlatformSupport\(/);
  assert.match(platformSource, /startDistance:\s*lipDistance/);
  assert.match(platformSource, /endDistance:\s*sweepDistance/);
  assert.match(platformSource, /duration:\s*remainingDt/);
  assert.match(platformSource, /releaseFromJumpPlatform\(tangentVy/);
  assert.match(platformSource, /startVelocity:\s*tangentVy/);
  assert.doesNotMatch(platformSource, /launchVertical\('jump-platform'/);
  assert.match(platformSource, /verticalSweepFrameFractionStart = crossingFraction/);
  assert.match(platformSource, /applySweptVerticalResult\(/);
  assert.doesNotMatch(
    platformSource,
    /state\.altitude = surfaceScratch\.height \+ tangentVy \* remainingDt/,
    'Platform release must not bypass the swept ceiling solver with a raw ballistic endpoint'
  );
  assert.equal(
    (updateSource.match(/gameplayCore\.sweptVerticalContact\(\{/g) || []).length,
    2,
    'Platform remainders and already-airborne frames must both use the vertical sweep'
  );
});

test('only platform flight receives the finite cross-carriageway lateral envelope', () => {
  const playerUpdateSource = declarationSource(
    'updatePlayer',
    '\n\n  function isDynamicObstacle'
  );
  assert.match(
    playerUpdateSource,
    /const freePlatformFlight = state\.jumpPlatformFlightActive && !state\.grounded;/
  );
  assert.match(
    playerUpdateSource,
    /const lateralMinimum = freePlatformFlight[\s\S]*?-jumpPlatformAirborneLateralHalf/
  );
  assert.match(
    playerUpdateSource,
    /const lateralMaximum = freePlatformFlight[\s\S]*?jumpPlatformAirborneLateralHalf/
  );
  assert.match(playerUpdateSource, /:\s*-roadSafeHalf;/);
  assert.match(playerUpdateSource, /:\s*roadSafeHalf;/);
  assert.doesNotMatch(
    playerUpdateSource,
    /supportCenter|supportedOffRoute|groundSupportCenterLateral/,
    'Grounded travel must stay route-local after an airborne PathPlan adoption'
  );
  assert.match(runtimeSource, /const jumpPlatformAirborneLateralHalf = 42;/);

  const manualLaunchSource = declarationSource(
    'launchVertical',
    '\n\n  /**\n   * End raised-platform support'
  );
  assert.match(manualLaunchSource, /state\.jumpPlatformFlightActive = false/);
  assert.doesNotMatch(manualLaunchSource, /jumpPlatformAirborneLateralHalf/);
});

test('runtime forwards the unified surface packet to audio with no writable return path', () => {
  const audioStart = runtimeSource.indexOf('const audioMix = audio.update({');
  const audioEnd = runtimeSource.indexOf('\n\n    updateTrail(now);', audioStart);
  assert.ok(audioStart >= 0 && audioEnd > audioStart);
  const audioSource = runtimeSource.slice(audioStart, audioEnd);

  for (const field of ['waterContact', 'snowContact', 'slushContact', 'contactIntensity']) {
    assert.match(
      audioSource,
      new RegExp(`${field}: state\\.surfaceContact\\.${field}`)
    );
  }
  assert.doesNotMatch(
    audioSource,
    /state\.(?:speed|distance|lateral|lateralVelocity|surfaceContact)\s*(?:=|\+=|-=|\*=|\/=)/
  );
});

test('weather HUD projects dry, water, snow, and slush without live-region intensity chatter', () => {
  assert.match(
    htmlSource,
    /id="surfaceContactStatus"[\s\S]*?data-surface-kind="dry"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/
  );
  assert.match(htmlSource, /id="surfaceContactText">干燥</);
  for (const kind of ['dry', 'water', 'snow', 'slush']) {
    assert.match(runtimeSource, new RegExp(`${kind}: 'weather\\.surface\\.${kind}'`));
  }
  assert.match(runtimeSource, /const SURFACE_CONTACT_HOLD_MS = 850;/);
  assert.match(runtimeSource, /function updateSurfaceContactStatus\(now\)/);
  assert.match(runtimeSource, /updateSurfaceContactStatus\(now\);/);
  assert.match(runtimeSource, /const label = uiText\(SURFACE_CONTACT_KEYS\[nextKind\]\);/);
  assert.match(runtimeSource, /surfaceContactStatus\.dataset\.contactIntensity = intensityText;/);
  assert.match(
    runtimeSource,
    /uiText\('weather\.surfaceContactAria', \{ surface: label \}\)/
  );
  assert.doesNotMatch(
    runtimeSource,
    /surfaceContactStatus\.setAttribute\('aria-label',[\s\S]{0,120}contactIntensity/
  );
  assert.match(styleSource, /\.surface-contact-status\s*\{/);
  for (const kind of ['water', 'snow', 'slush']) {
    assert.match(
      styleSource,
      new RegExp(`\\.surface-contact-status\\[data-surface-kind="${kind}"\\]`)
    );
  }
});

test('runtime diagnostics expose surface authority, forces, persistent change, and event evidence', () => {
  const expectedMappings = {
    weatherSurfaceVisualOnly: 'visualOnly',
    weatherSurfaceGameplayWriteAuthority: 'gameplayWriteAuthority',
    weatherSurfaceForceAuthority: 'forceAuthority',
    weatherSurfaceContactModel: 'contactModel',
    weatherSurfaceContactKind: 'currentContactKind',
    weatherSurfaceContactIntensity: 'currentContactIntensity',
    weatherSurfaceContactCoverage: 'currentContactCoverage',
    weatherSurfacePressureFactor: 'currentPressureFactor',
    weatherSurfaceLongitudinalDecelerationMps2: 'currentLongitudinalDecelerationMps2',
    weatherSurfaceLateralAccelerationMultiplier: 'currentLateralAccelerationMultiplier',
    weatherSurfaceLateralDragMultiplier: 'currentLateralDragMultiplier',
    weatherSurfaceLateralSpeedMultiplier: 'currentLateralSpeedMultiplier',
    weatherSurfaceContactEventSerial: 'contactEventSerial',
    weatherSurfaceContactSampleCount: 'contactSampleCount',
    weatherSurfaceCellCount: 'surfaceCellCount',
    weatherDisturbedWaterCellCount: 'disturbedWaterCellCount',
    weatherDisturbedSnowCellCount: 'disturbedSnowCellCount',
    weatherSnowBankContactThisUpdate: 'snowBankContactThisUpdate',
    weatherSnowBankInteractionCount: 'snowBankInteractionCount',
    weatherDisturbedSnowBankCellCount: 'disturbedSnowBankCellCount',
    weatherSnowBankPowderBurstCount: 'snowBankPowderBurstCount',
    weatherSweptSnowBankHitCount: 'sweptSnowBankHitCount'
  };

  for (const [publishedField, sourceField] of Object.entries(expectedMappings)) {
    assert.match(
      runtimeSource,
      new RegExp(`${publishedField}:[\\s\\S]{0,90}surfaceWeatherDiagnostics\\.${sourceField}`)
    );
  }

  for (const frameField of [
    'previousDistance',
    'currentDistance',
    'previousLateral',
    'currentLateral',
    'speedMps',
    'lateralSpeedMps',
    'grounded',
    'clearanceM',
    'enabled'
  ]) {
    assert.match(
      runtimeSource,
      new RegExp(`surfaceContactFrameScratch\\.${frameField}\\s*=`)
    );
  }
  assert.match(runtimeSource, /updateSurfaceWeather\(surfaceContactFrameScratch\);/);
  assert.match(
    runtimeSource,
    /surfaceWeather:\s*\{\s*enumerable: true,\s*get: \(\) => freezeDiagnosticSnapshot\(getSurfaceWeatherSnapshot\(\{\}\)\)/
  );
});
