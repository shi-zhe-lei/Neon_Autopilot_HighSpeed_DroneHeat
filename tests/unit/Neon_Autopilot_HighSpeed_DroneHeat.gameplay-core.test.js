#!/usr/bin/env node
/* Pure-Node regression contract for Neon dynamics, swept collision, timer cadence, and route-space motion. */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

// Resolve production gameplay dependencies from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const core = require(path.join(
  PROJECT_ROOT,
  'src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js'
));
global.window = globalThis;
require(path.join(PROJECT_ROOT, 'src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.track.js'));
const track = globalThis.NeonTrack;

function simulateTimer(dt, seconds, options = {}) {
  let timer = options.initialTimer ?? 0.2;
  let elapsed = 0;
  let events = 0;
  while (elapsed < seconds - 0.000_000_001) {
    const step = Math.min(dt, seconds - elapsed);
    const result = core.consumeCooldown(
      timer,
      step * (options.scale ?? 2.78),
      options.cooldown ?? 0.63
    );
    timer = result.timer;
    events += result.eventCount;
    elapsed += step;
  }
  return { timer, events };
}

/** Advance only accepted gameplay time so pause and render cadence cannot shorten damage protection. */
function simulateDamageProtection(dt, activeGameplaySeconds, initialRemainingSeconds) {
  let remainingSeconds = initialRemainingSeconds;
  let elapsedSeconds = 0;
  while (elapsedSeconds < activeGameplaySeconds - 0.000_000_001) {
    const stepSeconds = Math.min(dt, activeGameplaySeconds - elapsedSeconds);
    remainingSeconds = core.advanceDamageInvulnerability(remainingSeconds, stepSeconds);
    elapsedSeconds += stepSeconds;
  }
  return remainingSeconds;
}

function simulateSpawnTimeline(dt, seconds) {
  const channels = [
    { timer: 0.20, scale: 2.78, cooldown: 0.63 },
    { timer: 0.75, scale: 1.91, cooldown: 0.71 },
    { timer: 0.40, scale: 3.24, cooldown: 0.31 }
  ];
  const dueOrder = new Uint8Array(channels.length * core.DEFAULT_MAX_CATCH_UP_EVENTS);
  const eventSequence = [];
  const randomSequence = [];
  let seed = 0x76_23_19_a1;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed;
  };
  let elapsed = 0;
  while (elapsed < seconds - 0.000_000_001) {
    const step = Math.min(dt, seconds - elapsed);
    const eventCount = core.consumeCooldownTimeline(channels, step, dueOrder);
    for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
      const channelIndex = dueOrder[eventIndex];
      eventSequence.push(channelIndex);
      // Different event kinds consume different amounts of the shared stream, matching production spawn behavior.
      for (let drawIndex = 0; drawIndex <= channelIndex; drawIndex++) randomSequence.push(random());
    }
    elapsed += step;
  }
  return { channels, eventSequence, randomSequence };
}

function simulateSweptCollision(dt) {
  const relativeVelocity = 18 - 300;
  let relativeZ = 18;
  let elapsed = 0;
  while (elapsed < 0.12 - 0.000_000_001) {
    const step = Math.min(dt, 0.12 - elapsed);
    const nextRelativeZ = relativeZ + relativeVelocity * step;
    if (core.sweptAabbHit(0, 0, relativeZ, 0, 0, nextRelativeZ, 1.8, 1.4, 2.1)) return true;
    relativeZ = nextRelativeZ;
    elapsed += step;
  }
  return false;
}

function createDeterministicRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function assertApproximatelyEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= 0.000_000_001,
    `${message}: expected ${expected}, received ${actual}`
  );
}

/** Prove every radar input is an immutable measured score, with absence distinct from a real zero. */
function assertFlightRatingDimensionContract(report) {
  assert.deepEqual(
    report.dimensions.map((dimension) => dimension.id),
    ['safety', 'pace', 'endurance', 'collection', 'airborne']
  );
  for (const dimension of report.dimensions) {
    assert.equal(
      Object.isFrozen(dimension),
      true,
      `${dimension.id} dimension must stay immutable after the run is sealed`
    );
    assert.equal(typeof dimension.available, 'boolean');
    if (!dimension.available) {
      assert.equal(dimension.score, null, `${dimension.id} missing evidence must not become zero`);
      assert.equal(dimension.grade, null, `${dimension.id} missing evidence must not receive a grade`);
      continue;
    }
    assert.equal(Number.isFinite(dimension.score), true, `${dimension.id} score must be finite`);
    assert.equal(Number.isInteger(dimension.score), true, `${dimension.id} score must be an integer`);
    assert.ok(
      dimension.score >= 0 && dimension.score <= 100,
      `${dimension.id} score must stay in the authored 0–100 range`
    );
    assert.match(dimension.grade, /^[SABCD]$/, `${dimension.id} must publish a known grade`);
  }
}

/** Integrate a fixed command schedule without allowing cadence boundaries to move command transitions. */
function simulatePropulsionSchedule(cadenceHz, propulsionProfile = {}) {
  const phases = [
    { duration: 1.37, throttleCommand: 1, braking: false },
    { duration: 0.73, throttleCommand: 0, braking: false },
    { duration: 0.41, throttleCommand: 0.62, braking: false },
    { duration: 0.29, throttleCommand: 1, braking: true },
    { duration: 0.52, throttleCommand: 0, braking: false }
  ];
  const frameSeconds = 1 / cadenceHz;
  let spool = 0;
  let rpm = core.PROPULSION_CORE_CONTRACT.idleRpm;
  let deliveredVelocityMps = 0;
  for (const phase of phases) {
    let elapsed = 0;
    while (elapsed < phase.duration - 0.000_000_001) {
      const step = Math.min(frameSeconds, phase.duration - elapsed);
      const resolved = core.resolvePropulsionCoreStep({
        currentSpool: spool,
        currentRpm: rpm,
        throttleCommand: phase.throttleCommand,
        braking: phase.braking,
        maximumRpm: propulsionProfile.maximumRpm,
        spoolUpRatePerSecond: propulsionProfile.spoolUpRatePerSecond
      }, step);
      spool = resolved.nextSpool;
      rpm = resolved.rpm;
      deliveredVelocityMps += resolved.averageAccelerationMps2 * step;
      elapsed += step;
    }
  }
  return { spool, rpm, deliveredVelocityMps };
}

/** Expand a fully spooled core's candle profile without allowing the pickup frame to teleport physical RPM. */
function simulatePropulsionProfileTransition(cadenceHz, propulsionProfile, seconds = 1) {
  const frameSeconds = 1 / cadenceHz;
  let elapsed = 0;
  let spool = 1;
  let rpm = core.PROPULSION_CORE_CONTRACT.maximumRpm;
  while (elapsed < seconds - 0.000_000_001) {
    const step = Math.min(frameSeconds, seconds - elapsed);
    const resolved = core.resolvePropulsionCoreStep({
      currentSpool: spool,
      currentRpm: rpm,
      throttleCommand: 1,
      maximumRpm: propulsionProfile.maximumRpm,
      spoolUpRatePerSecond: propulsionProfile.spoolUpRatePerSecond
    }, step);
    spool = resolved.nextSpool;
    rpm = resolved.rpm;
    elapsed += step;
  }
  return { spool, rpm };
}

/** Replay propulsion and force-balance phases with transitions pinned to authored times, not frame boundaries. */
function simulateLongitudinalSchedule(cadenceHz, phases, options = {}) {
  const frameSeconds = 1 / cadenceHz;
  let speedMps = options.initialSpeedMps ?? 0;
  let spool = options.initialSpool ?? 0;
  let rpm = options.initialRpm ?? core.PROPULSION_CORE_CONTRACT.idleRpm;
  let gear = options.initialGear ?? 2;
  let minimumSpeedMps = speedMps;
  let maximumSpeedMps = speedMps;
  for (const phase of phases) {
    let elapsed = 0;
    while (elapsed < phase.duration - 0.000_000_001) {
      const step = Math.min(frameSeconds, phase.duration - elapsed);
      const throttleCommand = phase.automatic
        ? core.resolveAutomaticThrottleCommand(speedMps, phase.targetSpeedMps, true, 0, phase.gear ?? gear)
        : phase.throttleCommand;
      gear = phase.gear ?? gear;
      const propulsion = core.resolvePropulsionCoreStep({
        currentSpool: spool,
        currentRpm: rpm,
        throttleCommand,
        braking: phase.braking,
        gear,
        shifting: phase.shifting,
        shiftTorqueCutSeconds: phase.shiftTorqueCutSeconds
      }, step);
      const longitudinal = core.resolveLongitudinalDynamicsStep({
        speedMps,
        propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
        brakeDecelerationMps2: phase.braking
          ? core.LONGITUDINAL_DYNAMICS_CONTRACT.serviceBrakeDecelerationMps2
          : 0,
        surfaceDecelerationMps2: phase.surfaceDecelerationMps2 ?? 0,
        grounded: phase.grounded,
        surfaceGrade: phase.surfaceGrade
      }, step);
      speedMps = longitudinal.nextSpeedMps;
      spool = propulsion.nextSpool;
      rpm = propulsion.rpm;
      minimumSpeedMps = Math.min(minimumSpeedMps, speedMps);
      maximumSpeedMps = Math.max(maximumSpeedMps, speedMps);
      elapsed += step;
    }
  }
  return { speedMps, spool, rpm, minimumSpeedMps, maximumSpeedMps };
}

/** Replay the production first-gear idle load without introducing a test-owned minimum-speed clamp. */
function simulateIdleCreep(cadenceHz, durationSeconds, options = {}) {
  const frameSeconds = 1 / cadenceHz;
  let elapsed = 0;
  let speedMps = options.initialSpeedMps ?? 0;
  let spool = options.initialSpool ?? 0;
  let rpm = options.initialRpm ?? core.PROPULSION_CORE_CONTRACT.idleRpm;
  let minimumSpeedMps = speedMps;
  let maximumSpeedMps = speedMps;
  let propulsion = null;
  while (elapsed < durationSeconds - 0.000_000_001) {
    const step = Math.min(frameSeconds, durationSeconds - elapsed);
    propulsion = core.resolvePropulsionCoreStep({
      currentSpool: spool,
      currentRpm: rpm,
      throttleCommand: options.throttleCommand ?? 0,
      braking: options.braking === true,
      gear: options.gear ?? core.IDLE_CREEP_CONTRACT.driveGear,
      speedMps,
      idleCreepEnabled: options.idleCreepEnabled !== false,
      grounded: options.grounded !== false,
      shifting: options.shifting === true,
      shiftTorqueCutSeconds: options.shiftTorqueCutSeconds
    }, step, {});
    const longitudinal = core.resolveLongitudinalDynamicsStep({
      speedMps,
      propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
      brakeDecelerationMps2: options.braking
        ? core.LONGITUDINAL_DYNAMICS_CONTRACT.serviceBrakeDecelerationMps2
        : 0,
      surfaceDecelerationMps2: options.surfaceDecelerationMps2 ?? 0,
      grounded: options.grounded !== false,
      surfaceGrade: options.surfaceGrade ?? 0
    }, step, {});
    speedMps = longitudinal.nextSpeedMps;
    spool = propulsion.nextSpool;
    rpm = propulsion.rpm;
    minimumSpeedMps = Math.min(minimumSpeedMps, speedMps);
    maximumSpeedMps = Math.max(maximumSpeedMps, speedMps);
    elapsed += step;
  }
  return { speedMps, spool, rpm, minimumSpeedMps, maximumSpeedMps, propulsion };
}

/** Exercise the runtime's two-stage automatic launch schedule against the production propulsion and drag cores. */
function simulateAutomaticLaunch(cadenceHz, durationSeconds = 60) {
  const dt = 1 / cadenceHz;
  let elapsed = 0;
  let speedMps = 0;
  let driveGear = 1;
  let pendingDriveGear = null;
  let shiftRemainingSeconds = 0;
  let spool = 0;
  let rpm = core.PROPULSION_CORE_CONTRACT.idleRpm;
  const shiftEvents = [];
  let reached115Seconds = null;
  let reached119Seconds = null;
  while (elapsed < durationSeconds - 0.000_000_001) {
    const step = Math.min(dt, durationSeconds - elapsed);
    if (pendingDriveGear === null) {
      const automaticDecision = core.resolveAutomaticDriveGearDecision({
        currentGear: driveGear,
        speedMps,
        transmissionMode: 'automatic',
        shiftInProgress: false
      });
      if (automaticDecision.shouldShift) {
        const request = core.resolveDriveGearShiftRequest({
          currentGear: driveGear,
          requestedGear: automaticDecision.requestedGear,
          speedMps,
          shiftInProgress: false,
          transmissionMode: automaticDecision.transmissionMode,
          requestAuthority: 'automatic'
        }, {});
        assert.equal(request.accepted, true);
        pendingDriveGear = automaticDecision.requestedGear;
        shiftRemainingSeconds = request.shiftTorqueCutSeconds;
        shiftEvents.push({
          type: 'request',
          from: driveGear,
          to: automaticDecision.requestedGear,
          elapsed,
          speedMps
        });
      }
    }
    const shiftCutSeconds = Math.min(step, shiftRemainingSeconds);
    const propulsionGear = pendingDriveGear ?? driveGear;
    const throttleCommand = core.resolveAutomaticThrottleCommand(
      speedMps,
      core.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps,
      true,
      0,
      propulsionGear
    );
    const propulsion = core.resolvePropulsionCoreStep({
      currentSpool: spool,
      currentRpm: rpm,
      throttleCommand,
      gear: propulsionGear,
      speedMps,
      shifting: shiftCutSeconds > 0,
      shiftTorqueCutSeconds: shiftCutSeconds
    }, step, {});
    speedMps = core.resolveLongitudinalDynamicsStep({
      speedMps,
      propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
      grounded: true,
      surfaceGrade: 0
    }, step, {}).nextSpeedMps;
    spool = propulsion.nextSpool;
    rpm = propulsion.rpm;
    elapsed += step;
    if (reached115Seconds === null && speedMps >= 115 / 3.6) reached115Seconds = elapsed;
    if (reached119Seconds === null && speedMps >= 119 / 3.6) reached119Seconds = elapsed;
    if (shiftCutSeconds > 0) {
      shiftRemainingSeconds = Math.max(0, shiftRemainingSeconds - shiftCutSeconds);
      if (shiftRemainingSeconds <= 0.000_000_001) {
        const previousGear = driveGear;
        driveGear = pendingDriveGear;
        pendingDriveGear = null;
        shiftRemainingSeconds = 0;
        shiftEvents.push({ type: 'engage', from: previousGear, to: driveGear, elapsed, speedMps });
      }
    }
  }
  return { speedMps, driveGear, pendingDriveGear, shiftEvents, reached115Seconds, reached119Seconds };
}

/** Integrate an under-speed high gear so torque, loaded RPM, and resistance stay cadence-independent. */
function simulateLuggingGear(cadenceHz, gear, initialSpeedKmh, durationSeconds, options = {}) {
  const dt = 1 / cadenceHz;
  let elapsed = 0;
  let speedMps = initialSpeedKmh / 3.6;
  let spool = 1;
  const maximumRpm = options.maximumRpm ?? core.PROPULSION_CORE_CONTRACT.maximumRpm;
  let rpm = maximumRpm;
  let maximumDeliveredThrust = 0;
  let rpmMonotonic = true;
  while (elapsed < durationSeconds - 0.000_000_001) {
    const step = Math.min(dt, durationSeconds - elapsed);
    const previousRpm = rpm;
    const propulsion = core.resolvePropulsionCoreStep({
      currentSpool: spool,
      currentRpm: rpm,
      throttleCommand: 1,
      gear,
      speedMps,
      maximumRpm
    }, step);
    const longitudinal = core.resolveLongitudinalDynamicsStep({
      speedMps,
      propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
      grounded: true
    }, step);
    speedMps = longitudinal.nextSpeedMps;
    spool = propulsion.nextSpool;
    rpm = propulsion.rpm;
    maximumDeliveredThrust = Math.max(maximumDeliveredThrust, propulsion.thrustNormalized);
    rpmMonotonic = rpmMonotonic && rpm <= previousRpm + 0.000_000_001;
    elapsed += step;
  }
  return { speedMps, spool, rpm, maximumDeliveredThrust, rpmMonotonic };
}

/** Integrate actuator area because that is the lateral-physics authority consumed by the runtime. */
function simulateSteeringSchedule(cadenceHz, direction = 1) {
  const phases = [
    { duration: 0.37, command: 1 * direction },
    { duration: 0.18, command: 0.35 * direction },
    { duration: 0.46, command: -1 * direction },
    { duration: 0.21, command: 0 },
    { duration: 0.14, command: -0.6 * direction }
  ];
  const frameSeconds = 1 / cadenceHz;
  let actuator = 0;
  let actuatorIntegral = 0;
  for (const phase of phases) {
    let elapsed = 0;
    while (elapsed < phase.duration - 0.000_000_001) {
      const step = Math.min(frameSeconds, phase.duration - elapsed);
      const resolved = core.advanceSteeringActuator(actuator, phase.command, step);
      actuator = resolved.nextActuator;
      actuatorIntegral += resolved.averageActuator * step;
      elapsed += step;
    }
  }
  return { actuator, actuatorIntegral };
}

/** Replay route-space contacts so cadence changes must preserve actual damage/pickup entity IDs across edge seams. */
function simulateSeededContactTimeline(dt, seed) {
  const random = createDeterministicRandom(seed);
  const pathPlan = track.createPathPlan({ entryPort: 'south', kind: 'straight' });
  const initialPlayer = track.getInitialRouteCursor({ pathPlan });
  const firstEdge = track.getEdge(pathPlan.edgeIds[0]);
  const entityOffsets = [
    92, 181, 274, 366, 459, 548, 641, 734, 826, 918,
    firstEdge.length + 1.5,
    1_192, 1_304, 1_427
  ];
  let hazardSerial = 0;
  let pickupSerial = 0;
  const entities = entityOffsets.map((baseOffset, index) => {
    const kind = index === 10 || index % 2 === 0 ? 'hazard' : 'pickup';
    const routeOffset = index === 10 ? baseOffset : baseOffset + (random() - 0.5) * 10;
    const speed = index === 10 ? 0 : 7 + random() * 17;
    return {
      id: kind === 'hazard' ? `hazard-${++hazardSerial}` : `pickup-${++pickupSerial}`,
      kind,
      cursor: track.advanceCursor(initialPlayer, routeOffset, pathPlan),
      speed,
      baseLateral: (random() - 0.5) * 0.34,
      lateralAmplitude: 0.08 + random() * 0.16,
      lateralFrequency: 0.5 + random() * 0.7,
      lateralPhase: random() * Math.PI * 2,
      seamFixture: index === 10,
      active: true
    };
  });
  const damageIds = [];
  const pickupIds = [];
  const movingDamageIds = [];
  const seamContactIds = [];
  let playerCursor = initialPlayer;
  let elapsed = 0;
  const duration = 6;
  while (elapsed < duration - 0.000_000_001) {
    const step = Math.min(dt, duration - elapsed);
    const nextPlayerCursor = track.advanceCursor(playerCursor, 300 * step, pathPlan);
    for (const entity of entities) {
      if (!entity.active) continue;
      const previousEntityCursor = entity.cursor;
      const nextEntityCursor = track.advanceCursor(previousEntityCursor, entity.speed * step, pathPlan);
      const previousLongitudinal = track.distanceAlongPath(playerCursor, previousEntityCursor, pathPlan);
      const currentLongitudinal = track.distanceAlongPath(nextPlayerCursor, nextEntityCursor, pathPlan);
      const previousLateral = entity.baseLateral
        + Math.sin(elapsed * entity.lateralFrequency + entity.lateralPhase) * entity.lateralAmplitude;
      const currentLateral = entity.baseLateral
        + Math.sin((elapsed + step) * entity.lateralFrequency + entity.lateralPhase) * entity.lateralAmplitude;
      const hit = core.sweptAabbHit(
        previousLateral,
        0,
        previousLongitudinal,
        currentLateral,
        0,
        currentLongitudinal,
        entity.kind === 'hazard' ? 1.8 : 1.34,
        entity.kind === 'hazard' ? 1.4 : 1.20,
        entity.kind === 'hazard' ? 2.1 : 1.48
      );
      entity.cursor = nextEntityCursor;
      if (!hit) continue;
      entity.active = false;
      if (entity.kind === 'hazard') {
        damageIds.push(entity.id);
        if (entity.speed > 0) movingDamageIds.push(entity.id);
      } else {
        pickupIds.push(entity.id);
      }
      if (entity.seamFixture && (
        playerCursor.edgeId !== previousEntityCursor.edgeId
          || nextPlayerCursor.edgeId !== nextEntityCursor.edgeId
      )) {
        seamContactIds.push(entity.id);
      }
    }
    playerCursor = nextPlayerCursor;
    elapsed += step;
  }
  return { damageIds, pickupIds, movingDamageIds, seamContactIds };
}

function entityReachableOnPlan(entity, pathPlan) {
  const playerCursor = track.getInitialRouteCursor({ pathPlan });
  return Number.isFinite(track.distanceAlongPath(playerCursor, entity, pathPlan));
}

{
  const contract = core.PROPULSION_CORE_CONTRACT;
  assert.equal(Object.isFrozen(contract), true, 'The propulsion authority must be immutable');
  assert.deepEqual(contract, {
    idleRpm: 1_800,
    maximumRpm: 12_000,
    maximumUpgradedRpm: 15_000,
    spoolUpRatePerSecond: 2.4,
    maximumUpgradedSpoolUpRatePerSecond: 3.6,
    spoolDownRatePerSecond: 1.8,
    fullThrustAccelerationMps2: 3.573_333_333_333_333_3,
    driveGears: core.DRIVE_GEAR_CONTRACT,
    idleCreep: core.IDLE_CREEP_CONTRACT,
    responseModel: 'analytic-first-order',
    brakingCutsForwardThrust: true,
    shiftingCutsForwardThrust: true,
    throttleReleaseCutsExcessForwardThrust: true
  });
  assert.deepEqual(core.IDLE_CREEP_CONTRACT, {
    driveGear: 1,
    targetSpeedMps: 8 / 3.6,
    fadeOutSpeedMps: 16 / 3.6,
    launchThrustNormalized: 0.24,
    equilibriumThrustNormalized: 0.142_948_308_870_453_1,
    responseModel: 'first-gear-torque-converter-equilibrium',
    requiresGrounded: true,
    brakeCutsIdleCreep: true,
    shiftingCutsIdleCreep: true,
    tallerGearsDisconnectIdleCreep: true
  });
  assert.equal(Object.isFrozen(core.IDLE_CREEP_CONTRACT), true);
  assert.equal(contract.idleCreep, core.IDLE_CREEP_CONTRACT);
  assert.deepEqual(core.DRIVE_GEAR_CONTRACT, {
    defaultGear: 1,
    minimumGear: 1,
    maximumGear: 3,
    performanceGear: 3,
    automaticMinimumGear: 1,
    automaticMaximumGear: 3,
    automaticCruiseGear: 2,
    automaticUpshiftSpeedMpsByGear: {
      1: 90 / 3.6,
      2: 140 / 3.6
    },
    automaticDownshiftSpeedMpsByGear: {
      2: 70 / 3.6,
      3: 120 / 3.6
    },
    shiftTorqueCutSeconds: 0.30,
    gears: {
      1: {
        id: 1,
        label: 'drive-1',
        propulsionMode: 'road-drive-stage',
        equilibriumSpeedMps: 110 / 3.6,
        equilibriumSpeedKmh: 110,
        minimumSpeedMps: 0,
        minimumSpeedKmh: 0,
        stallSpeedMps: 0,
        stallSpeedKmh: 0,
        maximumSafeDownshiftSpeedMps: 125 / 3.6,
        maximumSafeDownshiftSpeedKmh: 125,
        lowSpeedTorqueModel: 'full-range',
        fullThrustAccelerationMps2: 1.958_75
      },
      2: {
        id: 2,
        label: 'drive-2',
        propulsionMode: 'road-drive-stage',
        equilibriumSpeedMps: 160 / 3.6,
        equilibriumSpeedKmh: 160,
        minimumSpeedMps: 70 / 3.6,
        minimumSpeedKmh: 70,
        stallSpeedMps: 35 / 3.6,
        stallSpeedKmh: 35,
        maximumSafeDownshiftSpeedMps: 190 / 3.6,
        maximumSafeDownshiftSpeedKmh: 190,
        lowSpeedTorqueModel: 'squared-stall-ramp',
        fullThrustAccelerationMps2: 3.573_333_333_333_333_3
      },
      3: {
        id: 3,
        label: 'performance-3',
        propulsionMode: 'high-performance-road-and-jump-stage',
        equilibriumSpeedMps: 280 / 3.6,
        equilibriumSpeedKmh: 280,
        minimumSpeedMps: 140 / 3.6,
        minimumSpeedKmh: 140,
        stallSpeedMps: 90 / 3.6,
        stallSpeedKmh: 90,
        maximumSafeDownshiftSpeedMps: 320 / 3.6,
        maximumSafeDownshiftSpeedKmh: 320,
        lowSpeedTorqueModel: 'squared-stall-ramp',
        fullThrustAccelerationMps2: 9.573_333_333_333_332
      }
    }
  });
  assert.equal(Object.isFrozen(core.DRIVE_GEAR_CONTRACT.gears[3]), true);
  assert.equal(Object.isFrozen(core.DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear), true);
  assert.equal(Object.isFrozen(core.DRIVE_GEAR_CONTRACT.automaticDownshiftSpeedMpsByGear), true);
  assert.deepEqual(core.DRIVE_TRANSMISSION_CONTRACT, {
    defaultMode: 'manual',
    automaticMode: 'automatic',
    manualMode: 'manual',
    modes: ['automatic', 'manual']
  });
  assert.equal(Object.isFrozen(core.DRIVE_TRANSMISSION_CONTRACT), true);
  assert.equal(Object.isFrozen(core.DRIVE_TRANSMISSION_CONTRACT.modes), true);
  assert.equal(core.resolveDriveTransmissionMode(' AUTOMATIC '), 'automatic');
  assert.equal(core.resolveDriveTransmissionMode('unknown'), 'manual');
  assert.equal(core.resolveDriveTransmissionMode('unknown', 'automatic'), 'automatic');
  for (const [lowerGear, upperGear] of [[1, 2], [2, 3]]) {
    assertApproximatelyEqual(
      (
        core.DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear[lowerGear]
          - core.DRIVE_GEAR_CONTRACT.automaticDownshiftSpeedMpsByGear[upperGear]
      ) * 3.6,
      20,
      `Automatic ${lowerGear}↔${upperGear} schedule must retain a 20km/h anti-chatter band`
    );
    assert.ok(
      core.DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear[lowerGear]
        >= core.DRIVE_GEAR_CONTRACT.gears[upperGear].minimumSpeedMps,
      `Automatic ${lowerGear}→${upperGear} must respect the target gear's physical minimum`
    );
  }

  const automaticUpshift = core.resolveAutomaticDriveGearDecision({
    currentGear: 1,
    speedMps: 90 / 3.6,
    transmissionMode: 'automatic'
  });
  assert.deepEqual(automaticUpshift, {
    transmissionMode: 'automatic',
    currentGear: 1,
    speedMps: 90 / 3.6,
    shiftInProgress: false,
    requestedGear: 2,
    shouldShift: true,
    direction: 1,
    reason: 'upshift-threshold'
  });
  assert.equal(core.resolveAutomaticDriveGearDecision({
    currentGear: 1,
    speedMps: 89.99 / 3.6,
    transmissionMode: 'automatic'
  }).shouldShift, false);
  for (const boundary of [
    { currentGear: 2, speedKmh: 70.01, requestedGear: null, reason: 'within-hysteresis' },
    { currentGear: 2, speedKmh: 70, requestedGear: 1, reason: 'downshift-threshold' },
    { currentGear: 2, speedKmh: 139.99, requestedGear: null, reason: 'within-hysteresis' },
    { currentGear: 2, speedKmh: 140, requestedGear: 3, reason: 'upshift-threshold' },
    { currentGear: 3, speedKmh: 120.01, requestedGear: null, reason: 'within-hysteresis' },
    { currentGear: 3, speedKmh: 120, requestedGear: 2, reason: 'downshift-threshold' }
  ]) {
    const decision = core.resolveAutomaticDriveGearDecision({
      currentGear: boundary.currentGear,
      speedMps: boundary.speedKmh / 3.6,
      transmissionMode: 'automatic'
    });
    assert.equal(
      decision.requestedGear,
      boundary.requestedGear,
      `Automatic gear ${boundary.currentGear} chose the wrong shift at ${boundary.speedKmh}km/h`
    );
    assert.equal(decision.shouldShift, boundary.requestedGear !== null);
    assert.equal(decision.reason, boundary.reason);
    assert.equal(
      decision.direction,
      boundary.requestedGear === null ? 0 : Math.sign(boundary.requestedGear - boundary.currentGear)
    );
  }
  assert.equal(core.resolveAutomaticDriveGearDecision({
    currentGear: 1,
    speedMps: 160 / 3.6,
    transmissionMode: 'manual'
  }).reason, 'manual-mode');
  assert.equal(core.resolveAutomaticDriveGearDecision({
    currentGear: 1,
    speedMps: 100 / 3.6,
    transmissionMode: 'automatic',
    shiftInProgress: true
  }).reason, 'shift-in-progress');

  assert.deepEqual(core.resolveDriveGearTorqueAvailability(1, 0), {
    gear: 1,
    speedMps: 0,
    stallSpeedMps: 0,
    workingMinimumSpeedMps: 0,
    speedCouplingNormalized: 1,
    torqueAvailability: 1,
    luggingSeverity: 0,
    stalled: false,
    lugging: false,
    inWorkingRange: true,
    recommendedRecoveryGear: 1,
    recoveryShiftCount: 0
  });
  assert.equal(core.resolveDriveGearTorqueAvailability(2, 35 / 3.6).torqueAvailability, 0);
  assertApproximatelyEqual(
    core.resolveDriveGearTorqueAvailability(2, 52.5 / 3.6).torqueAvailability,
    0.25,
    'Gear 2 midpoint torque availability changed'
  );
  assert.equal(core.resolveDriveGearTorqueAvailability(2, 70 / 3.6).torqueAvailability, 1);
  assert.equal(core.resolveDriveGearTorqueAvailability(3, 90 / 3.6).torqueAvailability, 0);
  assertApproximatelyEqual(
    core.resolveDriveGearTorqueAvailability(3, 115 / 3.6).torqueAvailability,
    0.25,
    'Gear 3 midpoint torque availability changed'
  );
  assert.equal(core.resolveDriveGearTorqueAvailability(3, 140 / 3.6).torqueAvailability, 1);

  for (const [speedKmh, expectedCoupling, expectedTorque, expectedRecoveryGear, expectedShifts] of [
    [140, 1, 1, 3, 0],
    [115, 0.5, 0.25, 2, 1],
    [100, 0.2, 0.04, 2, 1],
    [90, 0, 0, 2, 1],
    [7, 0, 0, 1, 2]
  ]) {
    const load = core.resolveDriveGearTorqueAvailability(3, speedKmh / 3.6);
    assertApproximatelyEqual(
      load.speedCouplingNormalized,
      expectedCoupling,
      `Gear 3 loaded-RPM coupling changed at ${speedKmh}km/h`
    );
    assertApproximatelyEqual(
      load.torqueAvailability,
      expectedTorque,
      `Gear 3 torque curve changed at ${speedKmh}km/h`
    );
    assert.equal(load.recommendedRecoveryGear, expectedRecoveryGear);
    assert.equal(load.recoveryShiftCount, expectedShifts);
    const propulsion = core.resolvePropulsionCoreStep({
      currentSpool: 1,
      currentRpm: core.PROPULSION_CORE_CONTRACT.maximumRpm,
      throttleCommand: 1,
      gear: 3,
      speedMps: speedKmh / 3.6
    }, 1 / 60);
    assertApproximatelyEqual(
      propulsion.gearRpmCouplingNormalized,
      expectedCoupling,
      `Gear 3 propulsion RPM coupling changed at ${speedKmh}km/h`
    );
    assertApproximatelyEqual(
      propulsion.targetRpmSpool,
      expectedCoupling,
      `Gear 3 loaded RPM target changed at ${speedKmh}km/h`
    );
  }

  const stalledSecondGear = core.resolvePropulsionCoreStep({
    currentSpool: 1,
    currentRpm: core.PROPULSION_CORE_CONTRACT.maximumRpm,
    throttleCommand: 1,
    gear: 2,
    speedMps: 0
  }, 1 / 60);
  assert.equal(stalledSecondGear.commandedThrustNormalized, 1);
  assert.equal(stalledSecondGear.gearTorqueAvailability, 0);
  assert.equal(stalledSecondGear.gearStalled, true);
  assert.equal(stalledSecondGear.thrustNormalized, 0);
  assert.equal(stalledSecondGear.averageAccelerationMps2, 0);
  const stalledThirdGear = core.resolvePropulsionCoreStep({
    currentSpool: 1,
    currentRpm: core.PROPULSION_CORE_CONTRACT.maximumRpm,
    throttleCommand: 1,
    gear: 3,
    speedMps: 0
  }, 1 / 60);
  assert.equal(stalledThirdGear.gearTorqueAvailability, 0);
  assert.equal(stalledThirdGear.gearStalled, true);
  assert.equal(stalledThirdGear.gearLugging, true);
  assert.equal(stalledThirdGear.gearRpmCouplingNormalized, 0);
  assert.equal(stalledThirdGear.targetRpmSpool, 0);
  assert.ok(
    stalledThirdGear.rpm < core.PROPULSION_CORE_CONTRACT.maximumRpm,
    'A stalled high gear must pull loaded core RPM down despite full throttle'
  );
  assert.equal(stalledThirdGear.averageAccelerationMps2, 0);

  for (const [gear, speedKmh] of [[2, 50], [3, 100]]) {
    const propulsion = core.resolvePropulsionCoreStep({
      currentSpool: 1,
      currentRpm: core.PROPULSION_CORE_CONTRACT.maximumRpm,
      throttleCommand: 1,
      gear,
      speedMps: speedKmh / 3.6
    }, 1 / 60);
    const resistance = core.resolveLongitudinalResistance(speedKmh / 3.6);
    assert.ok(propulsion.gearLugging, `Gear ${gear} must publish lugging below its working range`);
    assert.ok(
      propulsion.averageAccelerationMps2 <= resistance.totalResistanceMps2,
      `Gear ${gear} must not accelerate through its low-speed lug range`
    );
  }
  const luggingCadenceResults = [30, 60, 120]
    .map((cadenceHz) => simulateLuggingGear(cadenceHz, 2, 50, 3));
  assert.ok(
    Math.max(...luggingCadenceResults.map((result) => result.speedMps))
      - Math.min(...luggingCadenceResults.map((result) => result.speedMps)) < 0.01,
    `Lugging integration diverged across 30/60/120Hz: ${luggingCadenceResults
      .map((result) => result.speedMps).join(', ')}`
  );

  for (const maximumRpm of [
    core.PROPULSION_CORE_CONTRACT.maximumRpm,
    core.PROPULSION_CORE_CONTRACT.maximumUpgradedRpm
  ]) {
    const stalledCadenceResults = [30, 60, 120]
      .map((cadenceHz) => simulateLuggingGear(cadenceHz, 3, 7, 12, { maximumRpm }));
    for (const result of stalledCadenceResults) {
      assert.equal(result.maximumDeliveredThrust, 0, 'A fully stalled third gear must never leak thrust');
      assert.equal(result.rpmMonotonic, true, 'Loaded RPM must fall monotonically while the stall persists');
      assert.equal(result.speedMps, 0, 'Real passive resistance must bring a stalled craft to rest');
      assert.ok(
        result.rpm < core.PROPULSION_CORE_CONTRACT.idleRpm + 0.01,
        `Stalled RPM did not settle to idle from ${maximumRpm}: ${result.rpm}`
      );
    }
    for (const result of stalledCadenceResults.slice(1)) {
      assertApproximatelyEqual(
        result.rpm,
        stalledCadenceResults[0].rpm,
        'Stalled loaded RPM changed across 30/60/120Hz'
      );
      assertApproximatelyEqual(
        result.speedMps,
        stalledCadenceResults[0].speedMps,
        'Stalled coast-down changed across 30/60/120Hz'
      );
    }
  }

  const automaticLaunch = simulateAutomaticLaunch(120);
  assert.deepEqual(
    automaticLaunch.shiftEvents.map(({ type, from, to }) => `${type}:${from}>${to}`),
    ['request:1>2', 'engage:1>2'],
    'A 120Hz automatic launch must shift once without threshold chatter'
  );
  assert.ok(
    Math.abs(
        automaticLaunch.shiftEvents[1].elapsed
          - automaticLaunch.shiftEvents[0].elapsed
          - core.DRIVE_GEAR_CONTRACT.shiftTorqueCutSeconds
    ) < 0.000_000_001,
    'Automatic launch must retain the exact 300ms torque cut'
  );
  assert.ok(
    automaticLaunch.reached115Seconds > 20 && automaticLaunch.reached115Seconds < 35,
    `Automatic launch reached 115km/h outside the realistic window: ${automaticLaunch.reached115Seconds}`
  );
  assert.ok(
    automaticLaunch.reached119Seconds > automaticLaunch.reached115Seconds
      && automaticLaunch.reached119Seconds < 40,
    `Automatic launch reached 119km/h outside the realistic window: ${automaticLaunch.reached119Seconds}`
  );
  assert.equal(automaticLaunch.driveGear, 2);
  assert.equal(automaticLaunch.pendingDriveGear, null);
  assert.ok(
    Math.abs(
      automaticLaunch.speedMps
        - core.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps
    ) < 0.01,
    `A 120Hz automatic launch did not settle near 120km/h: ${automaticLaunch.speedMps * 3.6}`
  );

  const oneSecond = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    throttleCommand: 1,
    braking: false
  }, 1);
  const expectedSpool = 1 - Math.exp(-contract.spoolUpRatePerSecond);
  const expectedAverageSpool = 1
    - (1 - Math.exp(-contract.spoolUpRatePerSecond)) / contract.spoolUpRatePerSecond;
  assertApproximatelyEqual(oneSecond.nextSpool, expectedSpool, 'Analytic spool-up endpoint changed');
  assertApproximatelyEqual(
    oneSecond.averageSpool,
    expectedAverageSpool,
    'Analytic spool-up integral changed'
  );
  assertApproximatelyEqual(
    oneSecond.averageThrustNormalized,
    expectedAverageSpool,
    'Average thrust must follow the analytic core integral'
  );
  assertApproximatelyEqual(
    oneSecond.averageAccelerationMps2,
    expectedAverageSpool * oneSecond.fullThrustAccelerationMps2,
    'Delivered propulsion impulse changed'
  );
  assertApproximatelyEqual(
    oneSecond.rpm,
    contract.idleRpm + (contract.maximumRpm - contract.idleRpm) * expectedSpool,
    'Core RPM must be derived from authoritative spool'
  );

  const release = core.resolvePropulsionCoreStep({
    currentSpool: oneSecond.nextSpool,
    throttleCommand: 0
  }, 0.4);
  assert.ok(release.nextSpool < oneSecond.nextSpool, 'Released throttle must spool down');
  assert.ok(release.rpm > contract.idleRpm, 'Released throttle must retain visible and audible rotor inertia');
  assert.ok(release.rpm < oneSecond.rpm, 'Released throttle RPM must decay instead of freezing');
  assert.equal(release.thrustNormalized, 0, 'Released throttle must cut forward thrust immediately');
  assert.equal(release.averageThrustNormalized, 0);
  assert.equal(release.accelerationMps2, 0);
  assert.equal(release.averageAccelerationMps2, 0);

  const idleAtRest = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    currentRpm: contract.idleRpm,
    throttleCommand: 0,
    gear: 1,
    speedMps: 0,
    idleCreepEnabled: true,
    grounded: true
  }, 1 / 60, {});
  assert.equal(idleAtRest.throttleCommand, 0, 'Idle creep must not impersonate accelerator input');
  assert.equal(idleAtRest.commandedThrustNormalized, 0);
  assert.equal(idleAtRest.averageCommandedThrustNormalized, 0);
  assert.equal(idleAtRest.idleCreepEnabled, true);
  assert.equal(idleAtRest.idleCreepConnected, true);
  assert.equal(idleAtRest.idleCreepActive, true);
  assert.equal(idleAtRest.idleCreepThrustNormalized, core.IDLE_CREEP_CONTRACT.launchThrustNormalized);
  assert.equal(
    idleAtRest.averageIdleCreepThrustNormalized,
    core.IDLE_CREEP_CONTRACT.launchThrustNormalized
  );
  assert.equal(idleAtRest.idleCreepIntervalFraction, 1);
  assert.equal(idleAtRest.thrustNormalized, core.IDLE_CREEP_CONTRACT.launchThrustNormalized);
  assert.equal(idleAtRest.averageThrustNormalized, idleAtRest.thrustNormalized);
  assert.equal(idleAtRest.nextSpool, 0, 'Torque-converter creep must retain the idle spool');
  assert.equal(idleAtRest.rpm, contract.idleRpm, 'Torque-converter creep must retain physical idle RPM');

  const idleAtTarget = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    currentRpm: contract.idleRpm,
    throttleCommand: 0,
    gear: core.IDLE_CREEP_CONTRACT.driveGear,
    speedMps: core.IDLE_CREEP_CONTRACT.targetSpeedMps,
    idleCreepEnabled: true,
    grounded: true
  }, 1 / 60, {});
  const idleTargetResistance = core.resolveLongitudinalResistance(
    core.IDLE_CREEP_CONTRACT.targetSpeedMps,
    true,
    {}
  );
  assertApproximatelyEqual(
    idleAtTarget.idleCreepThrustNormalized
      * core.DRIVE_GEAR_CONTRACT.gears[1].fullThrustAccelerationMps2,
    idleTargetResistance.totalResistanceMps2,
    'First-gear idle torque must exactly balance dry resistance at 8km/h'
  );
  const balancedIdleTarget = core.resolveLongitudinalDynamicsStep({
    speedMps: core.IDLE_CREEP_CONTRACT.targetSpeedMps,
    propulsionAccelerationMps2: idleAtTarget.averageAccelerationMps2,
    grounded: true
  }, 5, {});
  assertApproximatelyEqual(
    balancedIdleTarget.nextSpeedMps,
    core.IDLE_CREEP_CONTRACT.targetSpeedMps,
    'The 8km/h creep target must be a force equilibrium rather than a speed clamp'
  );

  const idleFadeBoundary = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    currentRpm: contract.idleRpm,
    throttleCommand: 0,
    gear: 1,
    speedMps: core.IDLE_CREEP_CONTRACT.fadeOutSpeedMps,
    idleCreepEnabled: true,
    grounded: true
  }, 1 / 60, {});
  assert.equal(idleFadeBoundary.idleCreepConnected, true);
  assert.equal(idleFadeBoundary.idleCreepActive, false);
  assert.equal(idleFadeBoundary.idleCreepThrustNormalized, 0);
  assert.equal(idleFadeBoundary.thrustNormalized, 0, 'Idle torque must be fully absent at 16km/h');

  const poweredInput = {
    currentSpool: 0.5,
    currentRpm: contract.idleRpm + (contract.maximumRpm - contract.idleRpm) * 0.5,
    throttleCommand: 0.5,
    gear: 1,
    speedMps: 0,
    grounded: true
  };
  const poweredWithIdleOptIn = core.resolvePropulsionCoreStep({
    ...poweredInput,
    idleCreepEnabled: true
  }, 0, {});
  const poweredWithoutIdleOptIn = core.resolvePropulsionCoreStep({
    ...poweredInput,
    idleCreepEnabled: false
  }, 0, {});
  assert.equal(poweredWithIdleOptIn.idleCreepConnected, false);
  assert.equal(poweredWithIdleOptIn.idleCreepActive, false);
  assert.equal(poweredWithIdleOptIn.idleCreepThrustNormalized, 0);
  assert.equal(
    poweredWithIdleOptIn.thrustNormalized,
    poweredWithoutIdleOptIn.thrustNormalized,
    'W propulsion must replace idle creep instead of stacking another drive term'
  );
  assert.equal(
    poweredWithIdleOptIn.averageThrustNormalized,
    poweredWithoutIdleOptIn.averageThrustNormalized
  );

  for (const disabledCase of [
    { label: 'master-disabled', idleCreepEnabled: false, gear: 1, grounded: true },
    { label: 'second-gear', idleCreepEnabled: true, gear: 2, grounded: true },
    { label: 'third-gear', idleCreepEnabled: true, gear: 3, grounded: true },
    { label: 'service-brake', idleCreepEnabled: true, gear: 1, grounded: true, braking: true },
    {
      label: 'full-shift-cut',
      idleCreepEnabled: true,
      gear: 1,
      grounded: true,
      shifting: true,
      shiftTorqueCutSeconds: 1 / 60
    },
    { label: 'airborne', idleCreepEnabled: true, gear: 1, grounded: false }
  ]) {
    const disconnectedIdle = core.resolvePropulsionCoreStep({
      currentSpool: 0,
      currentRpm: contract.idleRpm,
      throttleCommand: 0,
      speedMps: 0,
      ...disabledCase
    }, 1 / 60, {});
    assert.equal(disconnectedIdle.idleCreepActive, false, disabledCase.label);
    assert.equal(disconnectedIdle.idleCreepThrustNormalized, 0, disabledCase.label);
    assert.equal(disconnectedIdle.averageIdleCreepThrustNormalized, 0, disabledCase.label);
    assert.equal(disconnectedIdle.thrustNormalized, 0, disabledCase.label);
    assert.equal(disconnectedIdle.averageThrustNormalized, 0, disabledCase.label);
  }

  const partialShiftDurationSeconds = 0.20;
  const partialShiftCutSeconds = 0.08;
  const partialShiftIdle = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    currentRpm: contract.idleRpm,
    throttleCommand: 0,
    gear: 1,
    speedMps: 0,
    idleCreepEnabled: true,
    grounded: true,
    shifting: true,
    shiftTorqueCutSeconds: partialShiftCutSeconds
  }, partialShiftDurationSeconds, {});
  const partialShiftPoweredFraction = (
    partialShiftDurationSeconds - partialShiftCutSeconds
  ) / partialShiftDurationSeconds;
  assert.equal(partialShiftIdle.shifting, true);
  assert.equal(partialShiftIdle.idleCreepConnected, true);
  assert.equal(partialShiftIdle.idleCreepActive, true);
  assertApproximatelyEqual(
    partialShiftIdle.idleCreepIntervalFraction,
    partialShiftPoweredFraction,
    'A partial shift must reconnect idle torque only for the post-cut interval'
  );
  assertApproximatelyEqual(
    partialShiftIdle.averageIdleCreepThrustNormalized,
    partialShiftIdle.idleCreepThrustNormalized * partialShiftPoweredFraction,
    'A partial shift must not backfill idle impulse into its torque-cut interval'
  );
  assertApproximatelyEqual(
    partialShiftIdle.averageThrustNormalized,
    partialShiftIdle.averageIdleCreepThrustNormalized,
    'Zero-pedal partial-shift drive must contain only interval-scaled idle torque'
  );

  const releasedAboveIdleRange = core.resolvePropulsionCoreStep({
    currentSpool: 1,
    currentRpm: contract.maximumRpm,
    throttleCommand: 0,
    gear: 1,
    speedMps: 40 / 3.6,
    idleCreepEnabled: true,
    grounded: true
  }, 0.4, {});
  assert.ok(releasedAboveIdleRange.nextSpool > 0);
  assert.ok(releasedAboveIdleRange.nextSpool < 1);
  assert.equal(releasedAboveIdleRange.commandedThrustNormalized, 0);
  assert.equal(releasedAboveIdleRange.idleCreepThrustNormalized, 0);
  assert.equal(
    releasedAboveIdleRange.thrustNormalized,
    0,
    'Throttle release above 16km/h must preserve rotor inertia without actual forward thrust'
  );
  assert.equal(releasedAboveIdleRange.averageThrustNormalized, 0);

  const braking = core.resolvePropulsionCoreStep({
    currentSpool: oneSecond.nextSpool,
    throttleCommand: 1,
    braking: true
  }, 0.4);
  assertApproximatelyEqual(
    braking.nextSpool,
    oneSecond.nextSpool * Math.exp(-contract.spoolDownRatePerSecond * 0.4),
    'Braking must naturally spool the core down'
  );
  assert.equal(braking.targetSpool, 0);
  assert.equal(braking.thrustNormalized, 0, 'Braking must cut forward thrust immediately');
  assert.equal(braking.averageThrustNormalized, 0);
  assert.equal(braking.accelerationMps2, 0);
  assert.equal(braking.averageAccelerationMps2, 0);

  const shiftCut = core.resolvePropulsionCoreStep({
    currentSpool: 1,
    currentRpm: contract.maximumRpm,
    throttleCommand: 1,
    gear: 2,
    shifting: true,
    shiftTorqueCutSeconds: core.DRIVE_GEAR_CONTRACT.shiftTorqueCutSeconds
  }, core.DRIVE_GEAR_CONTRACT.shiftTorqueCutSeconds);
  assert.equal(shiftCut.thrustNormalized, 0, 'A shift must cut endpoint thrust for the full 300ms interruption');
  assert.equal(shiftCut.averageAccelerationMps2, 0, 'A shift must deliver no hidden longitudinal impulse');
  assert.ok(shiftCut.rpm < contract.maximumRpm, 'Rotor RPM must fall naturally during the torque cut');
  assert.ok(shiftCut.rpm > contract.idleRpm, 'A shift must not teleport the rotor to idle');
  const recoveredThirdGear = core.resolvePropulsionCoreStep({
    currentSpool: shiftCut.nextSpool,
    currentRpm: shiftCut.rpm,
    throttleCommand: 1,
    gear: 3
  }, 1);
  assert.equal(recoveredThirdGear.gear, 3);
  assert.ok(recoveredThirdGear.accelerationMps2 > contract.fullThrustAccelerationMps2);

  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 1,
    requestedGear: 2,
    speedMps: 69 / 3.6
  }).rejectionReason, 'underspeed');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 2,
    requestedGear: 3,
    speedMps: 150 / 3.6,
    automaticThrottleEnabled: true
  }).rejectionReason, 'automatic');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 2,
    requestedGear: 3,
    speedMps: 150 / 3.6,
    transmissionMode: 'manual',
    automaticThrottleEnabled: true,
    requestAuthority: 'player'
  }).accepted, true, 'Explicit manual transmission must override the legacy automatic-throttle flag');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 1,
    requestedGear: 2,
    speedMps: 90 / 3.6,
    transmissionMode: 'automatic',
    requestAuthority: 'player'
  }).rejectionReason, 'automatic', 'Player Q/E must not override automatic transmission');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 1,
    requestedGear: 2,
    speedMps: 90 / 3.6,
    transmissionMode: 'automatic',
    requestAuthority: 'automatic'
  }).accepted, true);
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 2,
    requestedGear: 3,
    speedMps: 140 / 3.6,
    transmissionMode: 'automatic',
    requestAuthority: 'automatic'
  }).accepted, true, 'Automatic 2→3 must accept the published 140km/h boundary');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 1,
    requestedGear: 2,
    speedMps: 90 / 3.6,
    transmissionMode: 'manual',
    requestAuthority: 'automatic'
  }).rejectionReason, 'manual');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 3,
    requestedGear: 2,
    speedMps: 260 / 3.6
  }).rejectionReason, 'overspeed');
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 3,
    requestedGear: 2,
    speedMps: 190 / 3.6
  }).accepted, true);
  assert.equal(core.resolveDriveGearShiftRequest({
    currentGear: 3,
    requestedGear: 2,
    speedMps: 120 / 3.6,
    transmissionMode: 'automatic',
    requestAuthority: 'automatic'
  }).accepted, true, 'Automatic 3→2 must accept the published 120km/h boundary');

  const fullBoundary = core.resolvePropulsionCoreStep({
    currentSpool: 2,
    throttleCommand: 9
  }, 1);
  assert.equal(fullBoundary.nextSpool, 1);
  assert.equal(fullBoundary.rpm, contract.maximumRpm);
  const idleBoundary = core.resolvePropulsionCoreStep({
    currentSpool: -2,
    throttleCommand: -9
  }, Number.NaN);
  assert.equal(idleBoundary.nextSpool, 0);
  assert.equal(idleBoundary.averageSpool, 0);
  assert.equal(idleBoundary.rpm, contract.idleRpm);
  const nonFiniteElapsed = core.resolvePropulsionCoreStep({
    currentSpool: 0.4,
    throttleCommand: 1
  }, Number.POSITIVE_INFINITY);
  assert.equal(nonFiniteElapsed.nextSpool, 0.4);
  assert.equal(nonFiniteElapsed.averageSpool, 0.4);

  const reusable = {};
  assert.equal(
    core.resolvePropulsionCoreStep({ spool: 0.5, throttle: 0.5 }, 0, reusable),
    reusable,
    'Propulsion resolution must reuse caller-owned storage'
  );
  assert.equal(reusable.nextSpool, 0.5);
  assert.equal(reusable.averageSpool, 0.5);

  const cadenceResults = [30, 60, 120].map(simulatePropulsionSchedule);
  for (const result of cadenceResults.slice(1)) {
    assertApproximatelyEqual(
      result.spool,
      cadenceResults[0].spool,
      'Propulsion endpoint changed across 30/60/120Hz'
    );
    assertApproximatelyEqual(
      result.rpm,
      cadenceResults[0].rpm,
      'Propulsion RPM endpoint changed across 30/60/120Hz'
    );
    assertApproximatelyEqual(
      result.deliveredVelocityMps,
      cadenceResults[0].deliveredVelocityMps,
      'Propulsion impulse changed across 30/60/120Hz'
    );
  }

  const halfGrowthProfile = core.resolveCandleHandling(18);
  const upgradedOneSecond = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    throttleCommand: 1,
    maximumRpm: halfGrowthProfile.maximumRpm,
    spoolUpRatePerSecond: halfGrowthProfile.spoolUpRatePerSecond
  }, 1);
  assert.equal(upgradedOneSecond.maximumRpm, 13_500);
  assert.equal(upgradedOneSecond.spoolUpRatePerSecond, 3);
  assert.ok(
    upgradedOneSecond.nextSpool > oneSecond.nextSpool,
    'Candle growth must raise spool-up response without changing full-thrust authority'
  );
  assert.ok(upgradedOneSecond.rpm > oneSecond.rpm);

  const runningBaseCore = core.resolvePropulsionCoreStep({
    currentSpool: 1,
    currentRpm: contract.maximumRpm,
    throttleCommand: 1
  }, 0);
  const pickupBoundary = core.resolvePropulsionCoreStep({
    currentSpool: runningBaseCore.nextSpool,
    currentRpm: runningBaseCore.rpm,
    throttleCommand: 1,
    maximumRpm: halfGrowthProfile.maximumRpm,
    spoolUpRatePerSecond: halfGrowthProfile.spoolUpRatePerSecond
  }, 0);
  assert.equal(pickupBoundary.nextSpool, 1, 'Pickup must not reduce full-thrust spool');
  assert.equal(
    pickupBoundary.rpm,
    contract.maximumRpm,
    'Expanding the candle RPM ceiling must not teleport the running rotor'
  );
  const pickupAfterOneFrame = core.resolvePropulsionCoreStep({
    currentSpool: pickupBoundary.nextSpool,
    currentRpm: pickupBoundary.rpm,
    throttleCommand: 1,
    maximumRpm: halfGrowthProfile.maximumRpm,
    spoolUpRatePerSecond: halfGrowthProfile.spoolUpRatePerSecond
  }, 1 / 60);
  assert.ok(pickupAfterOneFrame.rpm > contract.maximumRpm);
  assert.ok(pickupAfterOneFrame.rpm < halfGrowthProfile.maximumRpm);
  const pickupCadenceResults = [30, 60, 120]
    .map((cadenceHz) => simulatePropulsionProfileTransition(cadenceHz, halfGrowthProfile));
  for (const result of pickupCadenceResults.slice(1)) {
    assertApproximatelyEqual(
      result.rpm,
      pickupCadenceResults[0].rpm,
      'Pickup-driven RPM growth changed across 30/60/120Hz'
    );
    assert.equal(result.spool, 1, 'Pickup-driven RPM growth must not disturb full-thrust spool');
  }

  const upgradedCadenceResults = [30, 60, 120]
    .map((cadenceHz) => simulatePropulsionSchedule(cadenceHz, halfGrowthProfile));
  for (const result of upgradedCadenceResults.slice(1)) {
    assertApproximatelyEqual(
      result.spool,
      upgradedCadenceResults[0].spool,
      'Upgraded propulsion endpoint changed across 30/60/120Hz'
    );
    assertApproximatelyEqual(
      result.rpm,
      upgradedCadenceResults[0].rpm,
      'Upgraded propulsion RPM endpoint changed across 30/60/120Hz'
    );
    assertApproximatelyEqual(
      result.deliveredVelocityMps,
      upgradedCadenceResults[0].deliveredVelocityMps,
      'Upgraded propulsion impulse changed across 30/60/120Hz'
    );
  }

  const clampedUpgrade = core.resolvePropulsionCoreStep({
    currentSpool: 0,
    throttleCommand: 1,
    maximumRpm: 99_000,
    spoolUpRatePerSecond: 99
  }, 1);
  assert.equal(clampedUpgrade.maximumRpm, contract.maximumUpgradedRpm);
  assert.equal(
    clampedUpgrade.spoolUpRatePerSecond,
    contract.maximumUpgradedSpoolUpRatePerSecond
  );
}

{
  const contract = core.LONGITUDINAL_DYNAMICS_CONTRACT;
  const resistanceDerivedSecondGearTerminalSpeedMps = (
    -contract.linearDragPerSecond
    + Math.sqrt(
      contract.linearDragPerSecond * contract.linearDragPerSecond
      + 4 * contract.aerodynamicDragPerMeter
        * (core.PROPULSION_CORE_CONTRACT.fullThrustAccelerationMps2
          - contract.rollingResistanceMps2)
    )
  ) / (2 * contract.aerodynamicDragPerMeter);
  assertApproximatelyEqual(
    resistanceDerivedSecondGearTerminalSpeedMps,
    160 / 3.6,
    'Second-gear thrust no longer balances the shared resistance curve at 160km/h'
  );
  const expectedTerminalSpeedMps = 160 / 3.6;
  assert.equal(Object.isFrozen(contract), true, 'The longitudinal force-balance contract must be immutable');
  assert.deepEqual(contract, {
    minimumSpeedMps: 0,
    cruiseTargetSpeedMps: 120 / 3.6,
    dryFullThrottleTerminalSpeedMps: expectedTerminalSpeedMps,
    dryGearEquilibriumSpeedMps: {
      1: 110 / 3.6,
      2: 160 / 3.6,
      3: 280 / 3.6
    },
    rollingResistanceMps2: 0.24,
    linearDragPerSecond: 0.015,
    aerodynamicDragPerMeter: 0.001_35,
    serviceBrakeDecelerationMps2: 7.5,
    longitudinalGravityMps2: 9.81,
    automaticThrottleProportionalGainPerMps: 0.065,
    stopSpeedThresholdMps: 0.08,
    impactSpeedRetention: {
      guardrail: 0.78,
      staticObstacle: 0.58,
      movingObstacle: 0.72
    },
    resistanceModel: 'rolling-linear-quadratic',
    integrationModel: 'analytic-constant-interval-force',
    unpoweredThrustMode: 'immediate-pedal-cut-first-gear-idle-creep-rpm-spool-down',
    coastMustDecelerateAboveIdleCreepFadeSpeed: true
  });
  assert.ok(
    contract.dryFullThrottleTerminalSpeedMps * 3.6 > 159
      && contract.dryFullThrottleTerminalSpeedMps * 3.6 < 162,
    'The derived dry-road terminal speed must remain near the authored 160km/h scale'
  );
  assert.equal(Object.isFrozen(contract.impactSpeedRetention), true);
  assert.equal(Object.isFrozen(contract.dryGearEquilibriumSpeedMps), true);
  for (const gear of Object.values(core.DRIVE_GEAR_CONTRACT.gears)) {
    const terminal = core.resolveLongitudinalDynamicsStep({
      speedMps: 0,
      propulsionAccelerationMps2: gear.fullThrustAccelerationMps2
    }, 240);
    assert.ok(
      Math.abs(terminal.nextSpeedMps - gear.equilibriumSpeedMps) < 0.000_001,
      `Gear ${gear.id} did not converge to its resistance-derived equilibrium`
    );
  }
  assertApproximatelyEqual(core.resolveImpactSpeed(100, 'guardrail'), 78, 'Guardrail speed retention changed');
  assertApproximatelyEqual(core.resolveImpactSpeed(100, 'obstacle', 'static'), 58, 'Static impact loss changed');
  assertApproximatelyEqual(core.resolveImpactSpeed(100, 'obstacle', 'moving'), 72, 'Moving impact loss changed');
  assert.equal(core.resolveImpactSpeed(0, 'obstacle', 'static'), 0);

  const resistanceAtTwenty = core.resolveLongitudinalResistance(20);
  assertApproximatelyEqual(resistanceAtTwenty.rollingResistanceMps2, 0.24, 'Rolling loss changed');
  assertApproximatelyEqual(resistanceAtTwenty.linearDragMps2, 0.3, 'Linear drag changed');
  assertApproximatelyEqual(resistanceAtTwenty.aerodynamicDragMps2, 0.54, 'Quadratic drag changed');
  assertApproximatelyEqual(resistanceAtTwenty.totalResistanceMps2, 1.08, 'Total passive drag changed');

  const flatGrade = core.resolveLongitudinalDynamicsStep({ speedMps: 20 }, 1);
  const uphillGrade = core.resolveLongitudinalDynamicsStep({ speedMps: 20, surfaceGrade: 0.1 }, 1);
  const downhillGrade = core.resolveLongitudinalDynamicsStep({ speedMps: 20, surfaceGrade: -0.1 }, 1);
  assert.ok(uphillGrade.nextSpeedMps < flatGrade.nextSpeedMps, 'Uphill grade must consume forward speed');
  assert.ok(downhillGrade.nextSpeedMps > flatGrade.nextSpeedMps, 'Downhill grade must add forward speed');
  assert.ok(uphillGrade.gradeAccelerationMps2 > 0);
  assert.ok(downhillGrade.gradeAccelerationMps2 < 0);
  const airborneGrade = core.resolveLongitudinalDynamicsStep({
    speedMps: 20,
    surfaceGrade: 0.1,
    grounded: false
  }, 1);
  assert.equal(airborneGrade.gradeAccelerationMps2, 0, 'Ground grade must not act while airborne');

  let coastSpeedMps = 35;
  let coastElapsedSeconds = 0;
  while (coastSpeedMps > 0 && coastElapsedSeconds < 120) {
    const coast = core.resolveLongitudinalDynamicsStep({
      speedMps: coastSpeedMps,
      propulsionAccelerationMps2: 0
    }, 1 / 60);
    assert.ok(coast.nextSpeedMps <= coastSpeedMps, 'Released throttle must never increase speed');
    assert.ok(coast.netAccelerationMps2 <= 0, 'Released throttle must publish non-positive acceleration');
    coastSpeedMps = coast.nextSpeedMps;
    coastElapsedSeconds += 1 / 60;
  }
  assert.equal(coastSpeedMps, 0, 'Passive resistance must coast the craft to an exact stop');

  const stopped = core.resolveLongitudinalDynamicsStep({
    speedMps: 0,
    propulsionAccelerationMps2: 0
  }, 10);
  assert.equal(stopped.nextSpeedMps, 0, 'Zero speed must absorb non-positive drive');
  assert.equal(stopped.stopped, true);
  const restarted = core.resolveLongitudinalDynamicsStep({
    speedMps: 0,
    propulsionAccelerationMps2: core.PROPULSION_CORE_CONTRACT.fullThrustAccelerationMps2
  }, 1 / 120);
  assert.ok(restarted.nextSpeedMps > 0, 'Positive drive must restart from zero even at 120Hz');
  const serviceStop = core.resolveLongitudinalDynamicsStep({
    speedMps: 20,
    propulsionAccelerationMps2: 0,
    brakeDecelerationMps2: contract.serviceBrakeDecelerationMps2
  }, 10);
  assert.equal(serviceStop.nextSpeedMps, 0, 'Service braking must stop without reversing');
  for (const cadenceHz of [30, 60, 120]) {
    const thresholdStop = core.resolveLongitudinalDynamicsStep({
      speedMps: 0.10,
      brakeDecelerationMps2: contract.serviceBrakeDecelerationMps2,
      surfaceDecelerationMps2: 1.2,
      surfaceGrade: 0.03
    }, 1 / cadenceHz);
    const reconstructedAcceleration = thresholdStop.propulsionAccelerationMps2
      - thresholdStop.brakeDecelerationMps2
      - thresholdStop.surfaceDecelerationMps2
      - thresholdStop.gradeAccelerationMps2
      - thresholdStop.passiveResistanceMps2;
    assertApproximatelyEqual(
      reconstructedAcceleration,
      thresholdStop.netAccelerationMps2,
      `Stop-boundary force diagnostics failed to reconcile at ${cadenceHz}Hz`
    );
  }

  const idleCreepCadenceResults = [30, 60, 120]
    .map((cadenceHz) => simulateIdleCreep(cadenceHz, 60));
  for (const result of idleCreepCadenceResults) {
    const speedKmh = result.speedMps * 3.6;
    assert.ok(
      speedKmh > 7 && speedKmh <= 8.05,
      `First-gear idle creep must approach the 8km/h force equilibrium without clamping: ${speedKmh}`
    );
    assert.equal(result.minimumSpeedMps, 0, 'Idle creep must launch forward without a hidden speed floor');
    assert.ok(
      result.maximumSpeedMps <= core.IDLE_CREEP_CONTRACT.targetSpeedMps,
      'Idle creep must approach its equilibrium monotonically without overshooting'
    );
    assert.equal(result.spool, 0, 'Idle creep must not masquerade as pedal-driven spool');
    assert.equal(result.rpm, core.PROPULSION_CORE_CONTRACT.idleRpm);
    assert.equal(result.propulsion.idleCreepActive, true);
  }
  for (const result of idleCreepCadenceResults.slice(1)) {
    assert.ok(
      Math.abs(result.speedMps - idleCreepCadenceResults[0].speedMps) * 3.6 < 0.01,
      'Idle-creep equilibrium approach changed materially across 30/60/120Hz'
    );
  }

  const brakeFromIdleCadenceResults = [30, 60, 120].map((cadenceHz) => (
    simulateIdleCreep(cadenceHz, 3, {
      initialSpeedMps: core.IDLE_CREEP_CONTRACT.targetSpeedMps,
      braking: true
    })
  ));
  for (const result of brakeFromIdleCadenceResults) {
    assert.equal(result.speedMps, 0, 'Service brake must bring an idling first gear to an exact stop');
    assert.equal(result.minimumSpeedMps, 0, 'Service brake must stop without creating reverse motion');
    assert.equal(result.propulsion.idleCreepActive, false, 'Held brake must keep idle torque disconnected');
    assert.equal(result.propulsion.idleCreepThrustNormalized, 0);
    assert.equal(result.propulsion.thrustNormalized, 0);
  }

  const terminal = core.resolveLongitudinalDynamicsStep({
    speedMps: 0,
    propulsionAccelerationMps2: core.PROPULSION_CORE_CONTRACT.fullThrustAccelerationMps2
  }, 180);
  assert.ok(
    Math.abs(terminal.nextSpeedMps - contract.dryFullThrottleTerminalSpeedMps) < 0.000_001,
    'Full thrust must converge to the force-balance terminal speed instead of accelerating without bound'
  );
  const aboveTerminal = core.resolveLongitudinalDynamicsStep({
    speedMps: 60,
    propulsionAccelerationMps2: core.PROPULSION_CORE_CONTRACT.fullThrustAccelerationMps2
  }, 30);
  assert.ok(aboveTerminal.nextSpeedMps < 60, 'Drag must slow an overspeed craft under full thrust');
  assert.ok(
    aboveTerminal.nextSpeedMps > contract.dryFullThrottleTerminalSpeedMps,
    'Overspeed decay must approach the terminal continuously without teleporting below it'
  );
  const terminalCadenceResults = [30, 60, 120].map((cadenceHz) => (
    simulateLongitudinalSchedule(cadenceHz, [{ duration: 180, throttleCommand: 1 }])
  ));
  for (const result of terminalCadenceResults) {
    assert.ok(
      Math.abs(result.speedMps - contract.dryFullThrottleTerminalSpeedMps) < 0.000_001,
      'Full-thrust terminal convergence changed across 30/60/120Hz'
    );
  }

  const targetThrottle = core.resolveAutomaticThrottleCommand(contract.cruiseTargetSpeedMps);
  assert.ok(targetThrottle > 0 && targetThrottle < 1, 'Cruise feed-forward must balance resistance at 120km/h');
  const targetResistance = core.resolveLongitudinalResistance(contract.cruiseTargetSpeedMps);
  assertApproximatelyEqual(
    targetThrottle * core.PROPULSION_CORE_CONTRACT.fullThrustAccelerationMps2,
    targetResistance.totalResistanceMps2,
    'Cruise feed-forward no longer balances the target-speed resistance'
  );
  const automaticCruise = simulateLongitudinalSchedule(60, [{
    duration: 120,
    automatic: true,
    targetSpeedMps: contract.cruiseTargetSpeedMps
  }]);
  assert.ok(
    Math.abs(automaticCruise.speedMps - contract.cruiseTargetSpeedMps) < 0.000_001,
    'Automatic throttle must settle at 120km/h rather than commanding permanent full thrust'
  );

  const schedule = [
    { duration: 20, throttleCommand: 1 },
    { duration: 18, throttleCommand: 0 },
    { duration: 4, throttleCommand: 0, braking: true },
    { duration: 12, throttleCommand: 1 },
    { duration: 90, automatic: true, targetSpeedMps: contract.cruiseTargetSpeedMps }
  ];
  const cadenceResults = [30, 60, 120]
    .map((cadenceHz) => simulateLongitudinalSchedule(cadenceHz, schedule));
  for (const result of cadenceResults.slice(1)) {
    assert.ok(
      Math.abs(result.speedMps - cadenceResults[0].speedMps) < 0.000_001,
      'Longitudinal speed changed materially across 30/60/120Hz'
    );
    assert.ok(
      Math.abs(result.spool - cadenceResults[0].spool) < 0.000_001,
      'Longitudinal propulsion state changed materially across 30/60/120Hz'
    );
    assert.ok(result.minimumSpeedMps >= 0, 'Longitudinal integration must never reverse below zero');
  }
}

{
  const contract = core.STEERING_ACTUATOR_CONTRACT;
  assert.equal(Object.isFrozen(contract), true, 'The steering actuator limits must be immutable');
  assert.deepEqual(contract, {
    engageRatePerSecond: 5.5,
    centerRatePerSecond: 7.5,
    reverseRatePerSecond: 8.0,
    responseModel: 'piecewise-linear-slew',
    minimumCommand: -1,
    maximumCommand: 1
  });

  const engage = core.advanceSteeringActuator(0, 1, 0.1);
  assertApproximatelyEqual(engage.nextActuator, 0.55, 'Steering engagement slew changed');
  assertApproximatelyEqual(engage.averageActuator, 0.275, 'Steering engagement integral changed');
  assert.equal(engage.phase, 'engage');
  assert.equal(engage.ratePerSecond, contract.engageRatePerSecond);

  const center = core.advanceSteeringActuator(1, 0, 0.1);
  assertApproximatelyEqual(center.nextActuator, 0.25, 'Steering centering slew changed');
  assertApproximatelyEqual(center.averageActuator, 0.625, 'Steering centering integral changed');
  assert.equal(center.phase, 'center');
  assert.equal(center.ratePerSecond, contract.centerRatePerSecond);

  const reverse = core.advanceSteeringActuator(1, -1, 0.25);
  assertApproximatelyEqual(reverse.nextActuator, -0.6875, 'Steering reversal endpoint changed');
  assertApproximatelyEqual(reverse.averageActuator, 0.078125, 'Steering reversal integral changed');
  const mirroredReverse = core.advanceSteeringActuator(-1, 1, 0.25);
  assertApproximatelyEqual(
    mirroredReverse.nextActuator,
    -reverse.nextActuator,
    'Left/right reversal must remain mirrored'
  );
  assertApproximatelyEqual(
    mirroredReverse.averageActuator,
    -reverse.averageActuator,
    'Left/right reversal impulse must remain mirrored'
  );

  const clamped = core.advanceSteeringActuator(4, -4, -1);
  assert.equal(clamped.command, -1);
  assert.equal(clamped.nextActuator, 1);
  assert.equal(clamped.averageActuator, 1);
  const invalid = core.advanceSteeringActuator(Number.NaN, Number.POSITIVE_INFINITY, 1);
  assert.equal(invalid.command, 0);
  assert.equal(invalid.nextActuator, 0);
  assert.equal(invalid.averageActuator, 0);
  const nonFiniteElapsed = core.advanceSteeringActuator(0.4, 1, Number.POSITIVE_INFINITY);
  assert.equal(nonFiniteElapsed.nextActuator, 0.4);
  assert.equal(nonFiniteElapsed.averageActuator, 0.4);
  const reusable = {};
  assert.equal(
    core.advanceSteeringActuator(0.2, 0.4, 0, reusable),
    reusable,
    'Steering resolution must reuse caller-owned storage'
  );

  const cadenceResults = [30, 60, 120].map((cadenceHz) => simulateSteeringSchedule(cadenceHz));
  for (const result of cadenceResults.slice(1)) {
    assertApproximatelyEqual(
      result.actuator,
      cadenceResults[0].actuator,
      'Steering endpoint changed across 30/60/120Hz'
    );
    assertApproximatelyEqual(
      result.actuatorIntegral,
      cadenceResults[0].actuatorIntegral,
      'Steering impulse changed across 30/60/120Hz'
    );
  }
  const mirroredSchedule = simulateSteeringSchedule(60, -1);
  assertApproximatelyEqual(
    mirroredSchedule.actuator,
    -cadenceResults[1].actuator,
    'Mirrored steering schedule endpoint changed'
  );
  assertApproximatelyEqual(
    mirroredSchedule.actuatorIntegral,
    -cadenceResults[1].actuatorIntegral,
    'Mirrored steering schedule impulse changed'
  );
}

{
  const contract = core.CANDLE_HANDLING_CONTRACT;
  const baseline = core.resolveCandleHandling(0);
  assert.equal(Object.isFrozen(contract), true, 'Candle handling limits must be immutable');
  assert.deepEqual(baseline, {
    candleCount: 0,
    progress: 0,
    displayPercent: contract.baselineDisplayPercent,
    lateralAccelerationMultiplier: 1,
    lateralSpeedMultiplier: 1,
    dragMultiplier: 1,
    maximumRpm: core.PROPULSION_CORE_CONTRACT.maximumRpm,
    spoolUpRatePerSecond: core.PROPULSION_CORE_CONTRACT.spoolUpRatePerSecond,
    colorProgress: 0
  });
  assert.deepEqual(core.resolveCandleHandling(-12), baseline);
  assert.deepEqual(core.resolveCandleHandling(Number.NaN), baseline);
  assert.deepEqual(core.resolveCandleHandling(Number.POSITIVE_INFINITY), baseline);
  assert.deepEqual(core.resolveCandleHandling(Number.NEGATIVE_INFINITY), baseline);

  const halfResponse = core.resolveCandleHandling(contract.halfResponseCandles);
  assert.equal(halfResponse.progress, 0.5);
  assert.equal(
    halfResponse.displayPercent,
    (contract.baselineDisplayPercent + contract.maximumDisplayPercent) * 0.5
  );
  assert.equal(
    halfResponse.lateralAccelerationMultiplier,
    1 + contract.maximumLateralAccelerationGain * 0.5
  );
  assert.equal(halfResponse.maximumRpm, 13_500);
  assert.equal(halfResponse.spoolUpRatePerSecond, 3);
  assert.equal(halfResponse.colorProgress, 0.5);

  let previous = baseline;
  for (let candleCount = 1; candleCount <= 10_000; candleCount++) {
    const current = core.resolveCandleHandling(candleCount);
    assert.ok(current.progress > previous.progress, `Candle ${candleCount} did not improve handling`);
    assert.ok(current.displayPercent > previous.displayPercent);
    assert.ok(current.displayPercent < contract.maximumDisplayPercent);
    assert.ok(current.lateralAccelerationMultiplier > previous.lateralAccelerationMultiplier);
    assert.ok(current.lateralSpeedMultiplier > previous.lateralSpeedMultiplier);
    assert.ok(current.dragMultiplier > previous.dragMultiplier);
    assert.ok(current.maximumRpm > previous.maximumRpm);
    assert.ok(current.maximumRpm < core.PROPULSION_CORE_CONTRACT.maximumUpgradedRpm);
    assert.ok(current.spoolUpRatePerSecond > previous.spoolUpRatePerSecond);
    assert.ok(
      current.spoolUpRatePerSecond
        < core.PROPULSION_CORE_CONTRACT.maximumUpgradedSpoolUpRatePerSecond
    );
    assert.ok(current.colorProgress > previous.colorProgress);
    previous = current;
  }

  const reusable = {};
  assert.equal(core.resolveCandleHandling(7, reusable), reusable, 'Handling derivation must reuse caller storage');
  assert.equal(reusable.candleCount, 7);
  assert.equal(contract.sharedAuthority, true);
  assert.equal(contract.affectsPropulsionResponse, true);
  assert.equal(contract.directlyWritesLongitudinalSpeed, false);
  assert.equal(contract.affectsCollision, false);
  assert.equal(contract.colorSequence, 'warm-gold-violet-cyan');
}

{
  const contract = core.SWEPT_ELLIPSE_INTERVAL_CONTRACT;
  assert.equal(Object.isFrozen(contract), true, 'The swept surface-contact contract must be immutable');
  assert.deepEqual(contract, {
    coordinateSpace: 'route-local-relative-distance-lateral',
    parameterInterval: 'closed-[0,1]',
    footprintExpansion: 'exact-ellipse-minkowski-axis-aligned-rectangle',
    solution: 'piecewise-rounded-rectangle',
    boundaryContact: 'inclusive',
    invalidInput: 'miss',
    resultFields: 'hit,entryT,exitT',
    reusableOutput: true
  });

  const scratch = { hit: false, entryT: null, exitT: null };
  const result = core.sweptEllipseInterval(40, 0, -60, 0, 5, 3, 2, 1, scratch);
  assert.equal(result, scratch, 'Swept ellipse queries must reuse caller-owned output');
  assert.equal(result.hit, true, 'A high-speed frame must not tunnel through a surface ellipse');
  assertApproximatelyEqual(result.entryT, 0.33, 'High-speed ellipse entry changed');
  assertApproximatelyEqual(result.exitT, 0.47, 'High-speed ellipse exit changed');
  assert.equal(Object.isFrozen(result), false, 'Reusable hot-path output must remain mutable');
}

{
  const unexpanded = core.sweptEllipseInterval(20, 3.5, -20, 3.5, 5, 3);
  const expanded = core.sweptEllipseInterval(20, 3.5, -20, 3.5, 5, 3, 0, 1);
  assert.equal(unexpanded.hit, false, 'A ship center outside the patch ellipse must miss without footprint inflation');
  assert.equal(expanded.hit, true, 'The exact ship rectangle must dilate the patch ellipse before the sweep');

  const lateral = core.sweptEllipseInterval(0, 6, 0, -6, 5, 2, 0, 1);
  assert.equal(lateral.hit, true, 'A purely lateral sweep must intersect the expanded ellipse');
  assertApproximatelyEqual(lateral.entryT, 0.25, 'Pure lateral entry changed');
  assertApproximatelyEqual(lateral.exitT, 0.75, 'Pure lateral exit changed');
}

{
  const ellipseDistanceRadius = 1.45;
  const ellipseLateralRadius = 1;
  const footprintDistanceRadius = 1.36;
  const footprintLateralRadius = 0.72;
  const diagonalDistance = footprintDistanceRadius + ellipseDistanceRadius / Math.SQRT2;
  const diagonalLateral = footprintLateralRadius + ellipseLateralRadius / Math.SQRT2;
  const boundary = core.sweptEllipseInterval(
    diagonalDistance,
    diagonalLateral,
    diagonalDistance,
    diagonalLateral,
    ellipseDistanceRadius,
    ellipseLateralRadius,
    footprintDistanceRadius,
    footprintLateralRadius
  );
  assert.deepEqual(
    boundary,
    { hit: true, entryT: 0, exitT: 1 },
    'The exact ellipse-plus-rectangle diagonal boundary must remain inclusive'
  );

  const normalLength = Math.hypot(
    1 / ellipseDistanceRadius,
    1 / ellipseLateralRadius
  );
  const normalDistance = (1 / ellipseDistanceRadius) / normalLength;
  const normalLateral = (1 / ellipseLateralRadius) / normalLength;
  const outsideEpsilon = 0.000_001;
  assert.equal(
    core.sweptEllipseInterval(
      diagonalDistance + normalDistance * outsideEpsilon,
      diagonalLateral + normalLateral * outsideEpsilon,
      diagonalDistance + normalDistance * outsideEpsilon,
      diagonalLateral + normalLateral * outsideEpsilon,
      ellipseDistanceRadius,
      ellipseLateralRadius,
      footprintDistanceRadius,
      footprintLateralRadius
    ).hit,
    false,
    'A diagonal point just outside the Minkowski boundary must miss'
  );
  assert.equal(
    core.sweptEllipseInterval(
      diagonalDistance - normalDistance * outsideEpsilon,
      diagonalLateral - normalLateral * outsideEpsilon,
      diagonalDistance - normalDistance * outsideEpsilon,
      diagonalLateral - normalLateral * outsideEpsilon,
      ellipseDistanceRadius,
      ellipseLateralRadius,
      footprintDistanceRadius,
      footprintLateralRadius
    ).hit,
    true,
    'A diagonal point just inside the Minkowski boundary must hit'
  );

  const tangentDistance = -ellipseDistanceRadius
    / Math.hypot(ellipseDistanceRadius, ellipseLateralRadius);
  const tangentLateral = ellipseLateralRadius
    / Math.hypot(ellipseDistanceRadius, ellipseLateralRadius);
  const diagonalTangent = core.sweptEllipseInterval(
    diagonalDistance - tangentDistance * 10,
    diagonalLateral - tangentLateral * 10,
    diagonalDistance + tangentDistance * 10,
    diagonalLateral + tangentLateral * 10,
    ellipseDistanceRadius,
    ellipseLateralRadius,
    footprintDistanceRadius,
    footprintLateralRadius
  );
  assert.equal(diagonalTangent.hit, true, 'A high-speed diagonal corner tangent must not be missed');
  assertApproximatelyEqual(diagonalTangent.entryT, 0.5, 'Diagonal tangent entry changed');
  assertApproximatelyEqual(diagonalTangent.exitT, 0.5, 'Diagonal tangent exit changed');

  const axial = core.sweptEllipseInterval(
    10,
    0,
    -10,
    0,
    ellipseDistanceRadius,
    ellipseLateralRadius,
    footprintDistanceRadius,
    footprintLateralRadius
  );
  assertApproximatelyEqual(axial.entryT, 0.3595, 'Exact axial entry changed');
  assertApproximatelyEqual(axial.exitT, 0.6405, 'Exact axial exit changed');

  const splitT = 0.37;
  const splitDistance = -12 + (14 - -12) * splitT;
  const splitLateral = -5 + (4 - -5) * splitT;
  const longSweep = core.sweptEllipseInterval(
    -12, -5, 14, 4, 3, 1.7, footprintDistanceRadius, footprintLateralRadius
  );
  const firstSweep = core.sweptEllipseInterval(
    -12, -5, splitDistance, splitLateral, 3, 1.7, footprintDistanceRadius, footprintLateralRadius
  );
  const secondSweep = core.sweptEllipseInterval(
    splitDistance, splitLateral, 14, 4, 3, 1.7, footprintDistanceRadius, footprintLateralRadius
  );
  assert.equal(longSweep.hit && firstSweep.hit && secondSweep.hit, true);
  assertApproximatelyEqual(
    Math.min(firstSweep.entryT * splitT, splitT + secondSweep.entryT * (1 - splitT)),
    longSweep.entryT,
    'Splitting a rounded-rectangle sweep changed its entry'
  );
  assertApproximatelyEqual(
    Math.max(firstSweep.exitT * splitT, splitT + secondSweep.exitT * (1 - splitT)),
    longSweep.exitT,
    'Splitting a rounded-rectangle sweep changed its exit'
  );
}

{
  const startsInside = core.sweptEllipseInterval(0, 0, 10, 0, 5, 2);
  assert.deepEqual(
    startsInside,
    { hit: true, entryT: 0, exitT: 0.5 },
    'A sweep starting inside must expose the remaining in-patch fraction'
  );
  const endsInside = core.sweptEllipseInterval(10, 0, 0, 0, 5, 2);
  assert.deepEqual(
    endsInside,
    { hit: true, entryT: 0.5, exitT: 1 },
    'A sweep ending inside must retain contact through the frame end'
  );
  assert.deepEqual(
    core.sweptEllipseInterval(-2, 0.4, 2, -0.4, 5, 2),
    { hit: true, entryT: 0, exitT: 1 },
    'Convex inside-to-inside travel must cover the complete frame'
  );
}

{
  const forward = core.sweptEllipseInterval(-12, 0, 8, 0, 4, 2);
  const reverse = core.sweptEllipseInterval(8, 0, -12, 0, 4, 2);
  assert.equal(forward.hit, true);
  assertApproximatelyEqual(forward.entryT, 0.4, 'Forward entry changed');
  assertApproximatelyEqual(forward.exitT, 0.8, 'Forward exit changed');
  assertApproximatelyEqual(reverse.entryT, 1 - forward.exitT, 'Reverse entry did not mirror forward exit');
  assertApproximatelyEqual(reverse.exitT, 1 - forward.entryT, 'Reverse exit did not mirror forward entry');

  const tangent = core.sweptEllipseInterval(-10, 3, 10, 3, 5, 3);
  assert.equal(tangent.hit, true, 'Inclusive ellipse boundaries must retain tangent contact');
  assertApproximatelyEqual(tangent.entryT, 0.5, 'Tangent entry changed');
  assertApproximatelyEqual(tangent.exitT, 0.5, 'Tangent exit changed');
  assert.deepEqual(
    core.sweptEllipseInterval(-10, 3.01, 10, 3.01, 5, 3),
    { hit: false, entryT: null, exitT: null },
    'A parallel line beyond the lateral radius must miss'
  );
}

{
  assert.deepEqual(
    core.sweptEllipseInterval(5, 0, 10, 0, 5, 2),
    { hit: true, entryT: 0, exitT: 0 },
    'A boundary start moving outward must report an instantaneous entry contact'
  );
  assert.deepEqual(
    core.sweptEllipseInterval(10, 0, 5, 0, 5, 2),
    { hit: true, entryT: 1, exitT: 1 },
    'A boundary end must report an instantaneous exit contact'
  );
  assert.deepEqual(
    core.sweptEllipseInterval(1, 0.5, 1, 0.5, 5, 2),
    { hit: true, entryT: 0, exitT: 1 },
    'A stationary point inside the ellipse must remain in contact for the frame'
  );
  assert.deepEqual(
    core.sweptEllipseInterval(5, 0, 5, 0, 5, 2),
    { hit: true, entryT: 0, exitT: 1 },
    'A stationary boundary point must honor inclusive contact'
  );
  assert.deepEqual(
    core.sweptEllipseInterval(6, 0, 6, 0, 5, 2),
    { hit: false, entryT: null, exitT: null },
    'A stationary point outside the ellipse must miss'
  );
}

{
  assert.equal(
    core.sweptEllipseInterval(-2, 0, 2, 0, 0, 0, 3, 1).hit,
    true,
    'A zero-size patch expanded by a positive footprint must still form a valid contact ellipse'
  );
  const invalidGeometry = [
    [0, 2],
    [2, 0],
    [-1, 2],
    [2, -1]
  ];
  for (const [distanceRadius, lateralRadius] of invalidGeometry) {
    assert.deepEqual(
      core.sweptEllipseInterval(-1, 0, 1, 0, distanceRadius, lateralRadius),
      { hit: false, entryT: null, exitT: null },
      `Invalid expanded radii ${distanceRadius}/${lateralRadius} must miss safely`
    );
  }
  assert.deepEqual(
    core.sweptEllipseInterval(-1, 0, 1, 0, 2, 2, -0.1, 0),
    { hit: false, entryT: null, exitT: null },
    'Negative footprint extents must not create surface contact'
  );
}

{
  const validArguments = [-10, 0, 10, 0, 5, 3, 1, 0.5];
  for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (let argumentIndex = 0; argumentIndex < validArguments.length; argumentIndex++) {
      const args = [...validArguments];
      args[argumentIndex] = invalidValue;
      const scratch = { hit: true, entryT: 0.25, exitT: 0.75 };
      const result = core.sweptEllipseInterval(...args, scratch);
      assert.equal(result, scratch);
      assert.deepEqual(
        result,
        { hit: false, entryT: null, exitT: null },
        `Non-finite argument ${argumentIndex} left stale contact data`
      );
    }
  }
  assert.deepEqual(
    core.sweptEllipseInterval(0, 0, 1, 0, Number.MAX_VALUE, 1, Number.MAX_VALUE, 0),
    { hit: false, entryT: null, exitT: null },
    'Overflowing expanded radii must miss safely'
  );
  assert.deepEqual(
    core.sweptEllipseInterval(Number.MAX_VALUE, 0, -Number.MAX_VALUE, 0, 1, 1),
    { hit: false, entryT: null, exitT: null },
    'Unrepresentable normalized motion must miss instead of leaking non-finite times'
  );
}

{
  const random = createDeterministicRandom(0x7e_11_25_a3);
  for (let fixtureIndex = 0; fixtureIndex < 2_000; fixtureIndex++) {
    const previousDistance = random() * 80 - 40;
    const previousLateral = random() * 20 - 10;
    const currentDistance = random() * 80 - 40;
    const currentLateral = random() * 20 - 10;
    const ellipseDistanceRadius = 0.2 + random() * 12;
    const ellipseLateralRadius = 0.2 + random() * 6;
    const footprintDistanceRadius = random() * 4;
    const footprintLateralRadius = random() * 2;
    const forward = core.sweptEllipseInterval(
      previousDistance,
      previousLateral,
      currentDistance,
      currentLateral,
      ellipseDistanceRadius,
      ellipseLateralRadius,
      footprintDistanceRadius,
      footprintLateralRadius
    );
    const reverse = core.sweptEllipseInterval(
      currentDistance,
      currentLateral,
      previousDistance,
      previousLateral,
      ellipseDistanceRadius,
      ellipseLateralRadius,
      footprintDistanceRadius,
      footprintLateralRadius
    );
    assert.equal(reverse.hit, forward.hit, `Sweep reversal changed hit fixture ${fixtureIndex}`);
    if (!forward.hit) continue;
    assertApproximatelyEqual(
      reverse.entryT,
      1 - forward.exitT,
      `Sweep reversal changed entry fixture ${fixtureIndex}`
    );
    assertApproximatelyEqual(
      reverse.exitT,
      1 - forward.entryT,
      `Sweep reversal changed exit fixture ${fixtureIndex}`
    );
  }
}

{
  const originalFreeze = Object.freeze;
  let freezeCalls = 0;
  Object.freeze = (value) => {
    freezeCalls++;
    return originalFreeze(value);
  };
  const scratch = {};
  try {
    for (let iteration = 0; iteration < 1_000; iteration++) {
      assert.equal(
        core.sweptEllipseInterval(40, 0, -60, 0, 5, 3, 2, 1, scratch),
        scratch
      );
    }
  } finally {
    Object.freeze = originalFreeze;
  }
  assert.equal(freezeCalls, 0, 'Reusable swept ellipse output must not be frozen or reallocated');
}

{
  const contract = core.SWEPT_VERTICAL_CONTACT_CONTRACT;
  assert.equal(Object.isFrozen(contract), true, 'The swept vertical-contact contract must be immutable');
  assert.deepEqual(contract, {
    maximumRouteSampleStepM: 0.5,
    maximumAdaptiveRouteProbeStepM: 0.05,
    maximumTimeStepSeconds: 1 / 240,
    trajectory: 'constant-gravity-ballistic',
    parameterInterval: 'closed-[0,1]',
    boundaryContact: 'inclusive',
    equalTimePriority: 'ceiling-before-floor',
    invalidInput: 'miss',
    resultFields: 'hit,kind,fraction,time,altitude,velocity,surface,ceiling,endAltitude,endVelocity,endSurface,endCeiling,endGrounded,endGroundedFraction,endImpactVelocity,sampleCount,penetration,overshoot',
    reusableOutput: true
  });

  const sampledDistances = [];
  const sampledFractions = [];
  const miss = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 13.5,
    duration: 0.045,
    startAltitude: 2,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 0.75
  }, (distance, fraction, out) => {
    sampledDistances.push(distance);
    sampledFractions.push(fraction);
    out.surface = 0;
    out.ceiling = Number.POSITIVE_INFINITY;
  });
  assert.equal(miss.hit, false);
  assert.equal(miss.sampleCount, 271, 'A 13.5m sweep must be partitioned into 270 adaptive probe intervals');
  for (let sampleIndex = 1; sampleIndex < sampledDistances.length; sampleIndex++) {
    assert.ok(
      sampledDistances[sampleIndex] - sampledDistances[sampleIndex - 1] <= 0.05 + 0.000_000_001,
      'An adaptive route probe exceeded the frozen 0.05m maximum'
    );
    assert.ok(
      (sampledFractions[sampleIndex] - sampledFractions[sampleIndex - 1]) * 0.045
        <= 1 / 240 + 0.000_000_001,
      'A time sample exceeded the frozen 1/240s maximum'
    );
  }
  assertApproximatelyEqual(miss.endAltitude, miss.altitude, 'A miss must expose its ballistic frame-end altitude');
  assertApproximatelyEqual(miss.endVelocity, miss.velocity, 'A miss must expose its ballistic frame-end velocity');
  assert.equal(miss.endGrounded, false);
}

{
  const jumpHeightM = 4.6;
  const jumpDurationSeconds = 0.78;
  const gravityMps2 = 8 * jumpHeightM / (jumpDurationSeconds * jumpDurationSeconds);
  const launchVelocityMps = gravityMps2 * jumpDurationSeconds * 0.5;
  const speedMps = 32;
  const sampleFlatRoad = (_distance, _fraction, out) => {
    out.surface = 0;
    out.ceiling = Number.POSITIVE_INFINITY;
  };
  const simulateManualLaunch = (framesPerSecond) => {
    const frameSeconds = 1 / framesPerSecond;
    let elapsed = 0;
    let altitude = 0;
    let velocity = launchVelocityMps;
    let maximumAltitude = 0;
    let firstFrame = null;
    let landingTime = null;
    for (let frameIndex = 0; frameIndex < framesPerSecond * 2; frameIndex++) {
      const result = core.sweptVerticalContact({
        startDistance: 0,
        endDistance: speedMps * frameSeconds,
        duration: frameSeconds,
        startAltitude: altitude,
        startVelocity: velocity,
        gravity: gravityMps2,
        bottomOffset: 0,
        topOffset: 0.75
      }, sampleFlatRoad);
      if (frameIndex === 0) firstFrame = { ...result };
      maximumAltitude = Math.max(maximumAltitude, result.endAltitude);
      if (result.endGrounded) {
        landingTime = elapsed + result.time;
        break;
      }
      altitude = result.endAltitude;
      velocity = result.endVelocity;
      elapsed += frameSeconds;
    }
    return { firstFrame, landingTime, maximumAltitude };
  };

  // A manual launch begins exactly on its sampled floor. Its separating t=0 root is contact history, not a new
  // landing, while resting and descending bodies must still resolve immediate contact.
  for (const framesPerSecond of [22, 30, 60, 120]) {
    const flight = simulateManualLaunch(framesPerSecond);
    assert.equal(flight.firstFrame.hit, false, `A ${framesPerSecond}fps launch re-contacted the floor at t=0`);
    assert.equal(flight.firstFrame.endGrounded, false, `A ${framesPerSecond}fps launch stayed grounded`);
    assert.ok(flight.firstFrame.endAltitude > 0, `A ${framesPerSecond}fps launch did not gain altitude`);
    assert.ok(flight.firstFrame.endVelocity > 0, `A ${framesPerSecond}fps launch lost its upward velocity`);
    assert.ok(
      flight.maximumAltitude <= jumpHeightM + 0.000_000_001
        && flight.maximumAltitude >= jumpHeightM - 0.02,
      `A ${framesPerSecond}fps launch no longer reaches the 4.6m jump envelope`
    );
    assertApproximatelyEqual(
      flight.landingTime,
      jumpDurationSeconds,
      `A ${framesPerSecond}fps launch changed its landing time`
    );
  }

  const platformPlan = track.createPathPlan({ movementId: 'south-left' });
  const platformEdge = platformPlan.edgeIds
    .map((edgeId) => track.getEdge(edgeId))
    .find((edge) => edge.jumpPlatformCorridor && edge.jumpPlatforms?.length);
  const platform = platformEdge?.jumpPlatforms?.[0];
  assert.ok(platform?.launchable, 'The route fixture no longer exposes a launchable jump platform');
  const platformLipFrame = track.sampleJumpPlatformSupport(
    platformEdge.id,
    platform.lipS,
    platform.lateral,
    {},
    0.72
  );
  assert.ok(platformLipFrame, 'The complete craft footprint no longer receives support at the platform lip');
  const platformTangentVelocity = 300 * platformLipFrame.grade / Math.hypot(1, platformLipFrame.grade);
  for (const framesPerSecond of [22, 30, 60, 120]) {
    const frameSeconds = 1 / framesPerSecond;
    const routeTravelM = 300 * frameSeconds;
    const expectedAltitude = platformLipFrame.surfaceHeight
      + platformTangentVelocity * frameSeconds
      - 0.5 * gravityMps2 * frameSeconds * frameSeconds;
    const result = core.sweptVerticalContact({
      startDistance: 0,
      endDistance: routeTravelM,
      duration: frameSeconds,
      startAltitude: platformLipFrame.surfaceHeight,
      startVelocity: platformTangentVelocity,
      gravity: gravityMps2,
      bottomOffset: 0,
      topOffset: 0.75
    }, (distance, _fraction, out) => {
      const routeFrame = track.sampleEdge(
        platformEdge.id,
        platform.lipS + distance,
        platform.lateral,
        {}
      );
      out.surface = routeFrame.y;
      out.ceiling = routeFrame.ceilingHeight;
    });
    assert.equal(result.hit, false, `The physical jump platform re-contacted at t=0 under ${framesPerSecond}fps`);
    assert.equal(result.endGrounded, false, `The physical jump platform stayed grounded under ${framesPerSecond}fps`);
    assert.ok(
      result.endAltitude > result.endSurface,
      `The physical jump platform gained no road clearance under ${framesPerSecond}fps`
    );
    assertApproximatelyEqual(
      result.endAltitude,
      expectedAltitude,
      `The physical jump-platform ballistic altitude changed under ${framesPerSecond}fps`
    );
    assertApproximatelyEqual(
      result.endVelocity,
      platformTangentVelocity - gravityMps2 * frameSeconds,
      `The physical jump-platform velocity changed under ${framesPerSecond}fps`
    );
  }

  // Player SPACE is a support-relative separation, not a replacement for the vertical velocity already carried by
  // an uphill bridge or platform. This reproduces AT Gear 2 at 150km/h, where a fixed flat-road velocity alone can
  // be lower than the platform's own rise rate and would therefore be resolved as an immediate re-contact.
  const activeGravityMps2 = 9.81;
  const activeJumpHeightM = 4.6;
  const activeJumpImpulseMps = Math.sqrt(2 * activeGravityMps2 * activeJumpHeightM);
  const activeSpeedMps = 150 / 3.6;
  for (const grade of [0.03, platformLipFrame.grade]) {
    const tangentVelocityMps = activeSpeedMps * grade / Math.hypot(1, grade);
    const projectedImpulseMps = activeJumpImpulseMps / Math.hypot(1, grade);
    const initialVelocityMps = tangentVelocityMps + projectedImpulseMps;
    const sampleMovingGrade = (distance, _fraction, out) => {
      out.surface = distance * grade / Math.hypot(1, grade);
      out.ceiling = Number.POSITIVE_INFINITY;
    };
    for (const framesPerSecond of [22, 30, 60, 120]) {
      const frameSeconds = 1 / framesPerSecond;
      const result = core.sweptVerticalContact({
        startDistance: 0,
        endDistance: activeSpeedMps * frameSeconds,
        duration: frameSeconds,
        startAltitude: 0,
        startVelocity: initialVelocityMps,
        gravity: activeGravityMps2,
        bottomOffset: 0,
        topOffset: 0.75
      }, sampleMovingGrade);
      const expectedClearance = projectedImpulseMps * frameSeconds
        - 0.5 * activeGravityMps2 * frameSeconds * frameSeconds;
      assert.equal(
        result.hit,
        false,
        `A ${Math.round(grade * 100)}% active slope launch re-contacted at ${framesPerSecond}fps`
      );
      assert.equal(result.endGrounded, false);
      assert.ok(
        result.endAltitude > result.endSurface,
        `A ${Math.round(grade * 100)}% active slope launch gained no clearance at ${framesPerSecond}fps`
      );
      assertApproximatelyEqual(
        result.endAltitude - result.endSurface,
        expectedClearance,
        `A ${Math.round(grade * 100)}% active slope launch changed its first-frame separation`
      );
    }
  }

  for (const startVelocity of [0, -1]) {
    const contact = core.sweptVerticalContact({
      startDistance: 0,
      endDistance: speedMps / 60,
      duration: 1 / 60,
      startAltitude: 0,
      startVelocity,
      gravity: gravityMps2,
      bottomOffset: 0,
      topOffset: 0.75
    }, sampleFlatRoad);
    assert.equal(contact.hit, true);
    assert.equal(contact.kind, 'floor', `A ${startVelocity}m/s grounded body lost immediate floor contact`);
    assert.equal(contact.fraction, 0);
    assert.equal(contact.time, 0);
    assertApproximatelyEqual(
      contact.endImpactVelocity,
      startVelocity,
      `A ${startVelocity}m/s grounded body changed its immediate impact velocity`
    );
    assert.equal(contact.endAltitude, 0);
    assert.equal(contact.endVelocity, 0);
    assert.equal(contact.endGrounded, true);
  }
}

{
  const output = {};
  const result = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 13.5,
    duration: 0.045,
    startAltitude: 2,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 0.75
  }, (distance, fraction, out) => {
    out.surface = 0;
    // Both frame endpoints are open sky; only the swept route samples expose this short upper-deck soffit.
    out.ceiling = distance >= 5.25 && distance <= 5.75
      ? 2.6
      : Number.POSITIVE_INFINITY;
  }, output);
  assert.equal(result, output, 'Vertical contact queries must reuse caller-owned output');
  assert.equal(result.hit, true, 'A 300m/s, 45ms sweep must not tunnel through a short finite ceiling');
  assert.equal(result.kind, 'ceiling');
  assertApproximatelyEqual(result.fraction, 5.25 / 13.5, 'Thin-ceiling entry fraction changed');
  assertApproximatelyEqual(result.time, 5.25 / 300, 'Thin-ceiling entry time changed');
  assertApproximatelyEqual(result.altitude, 1.85, 'Ceiling-resolved altitude changed');
  assertApproximatelyEqual(result.velocity, 0, 'Ceiling incoming velocity changed');
  assertApproximatelyEqual(result.surface, 0, 'Ceiling-contact floor sample changed');
  assertApproximatelyEqual(result.ceiling, 2.6, 'Ceiling-contact height changed');
  assertApproximatelyEqual(result.penetration, 0.15, 'Ceiling overlap changed');
  assertApproximatelyEqual(result.overshoot, 0.15, 'Ceiling frame-end overshoot changed');
  assert.ok(
    result.endAltitude + 0.75 <= result.endCeiling || !Number.isFinite(result.endCeiling),
    'The post-contact frame-end pose must remain below every finite ceiling'
  );
  assert.ok(result.sampleCount > 0);
}

{
  const result = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 13.5,
    duration: 0.045,
    startAltitude: 2,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 0.75
  }, (distance, fraction, out) => {
    out.surface = 0;
    // This 0.10m roof is five times narrower than the public coarse route interval.
    out.ceiling = distance >= 5.10 && distance <= 5.20
      ? 2.6
      : Number.POSITIVE_INFINITY;
  });
  assert.equal(result.hit, true, 'The adaptive probe contract must catch a 0.10m collidable roof');
  assert.equal(result.kind, 'ceiling');
  assertApproximatelyEqual(result.fraction, 5.10 / 13.5, 'Narrow-roof entry fraction changed');
  assert.ok(
    !Number.isFinite(result.endCeiling) || result.endAltitude + 0.75 <= result.endCeiling,
    'The narrow-roof remainder ended above its finite ceiling'
  );
}

{
  const boundaryDistanceM = 1.25;
  const result = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 13.5,
    duration: 0.045,
    startAltitude: 5,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 2.75
  }, (distance, fraction, out) => {
    out.surface = 0;
    // Both sides are finite: only an actual-predicate refinement can avoid publishing the high, safe side.
    out.ceiling = distance < boundaryDistanceM ? 9.686 : 3.6;
  });
  assert.equal(result.hit, true, 'A finite-height ceiling step must be treated as a discontinuity');
  assert.equal(result.kind, 'ceiling');
  assertApproximatelyEqual(
    result.fraction,
    boundaryDistanceM / 13.5,
    'Finite-height ceiling contact must resolve on the entered side'
  );
  assertApproximatelyEqual(result.ceiling, 3.6, 'Contact published the safe-side ceiling');
  assertApproximatelyEqual(result.altitude, 0.85, 'Contact did not use the entered ceiling boundary');
  assert.ok(result.endAltitude + 2.75 <= result.endCeiling + 0.000_000_001);
}

{
  const result = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 13.5,
    duration: 0.045,
    startAltitude: 8,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 2.75
  }, (distance, fraction, out) => {
    out.surface = 0;
    out.ceiling = 10.75 - 0.764 * distance / 13.5;
  });
  assert.equal(result.kind, 'ceiling');
  assertApproximatelyEqual(result.altitude, 8, 'Descending-roof first contact moved');
  assertApproximatelyEqual(result.endCeiling, 9.986, 'Descending-roof endpoint sample changed');
  assertApproximatelyEqual(
    result.endAltitude,
    result.endCeiling - 2.75,
    'Post-contact remainder did not follow the descending ceiling'
  );
  assertApproximatelyEqual(result.overshoot, 0.764, 'Remainder ceiling correction was not reported');
}

{
  const duration = 0.4;
  const gravity = 9.8;
  const expectedTime = (Math.sqrt(158.8) - 10) / gravity;
  const result = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 30,
    duration,
    startAltitude: 3,
    startVelocity: -10,
    gravity,
    bottomOffset: 0,
    topOffset: 0.75
  }, (distance, fraction, out) => {
    out.surface = 0;
    out.ceiling = Number.POSITIVE_INFINITY;
  });
  assert.equal(result.hit, true, 'A ballistic descent must publish its first floor contact');
  assert.equal(result.kind, 'floor');
  assertApproximatelyEqual(result.fraction, expectedTime / duration, 'Landing fraction changed');
  assertApproximatelyEqual(result.time, expectedTime, 'Landing time changed');
  assertApproximatelyEqual(result.altitude, 0, 'Landing altitude changed');
  assertApproximatelyEqual(result.velocity, -10 - gravity * expectedTime, 'Landing impact velocity changed');
  assertApproximatelyEqual(result.surface, 0, 'Landing surface changed');
  assert.equal(result.ceiling, Number.POSITIVE_INFINITY);
  assertApproximatelyEqual(result.penetration, 0, 'Exact landing must not report contact penetration');
  assertApproximatelyEqual(result.overshoot, 1.784, 'Landing frame-end overshoot changed');
  assert.equal(result.endGrounded, true);
  assertApproximatelyEqual(result.endAltitude, 0, 'Landing remainder must finish on the floor');
  assertApproximatelyEqual(result.endImpactVelocity, result.velocity, 'Landing impact evidence changed');
}

{
  const speedMps = 300;
  const ceilingStartM = 17.25;
  const ceilingEndM = 17.35;
  const expectedTime = ceilingStartM / speedMps;
  const simulateAtCadence = (framesPerSecond) => {
    let elapsed = 0;
    let traveled = 0;
    let altitude = 2;
    let velocity = 0;
    while (elapsed < 0.12 - 0.000_000_001) {
      const duration = Math.min(1 / framesPerSecond, 0.12 - elapsed);
      const sweepDistance = speedMps * duration;
      const result = core.sweptVerticalContact({
        startDistance: 0,
        endDistance: sweepDistance,
        duration,
        startAltitude: altitude,
        startVelocity: velocity,
        gravity: 0,
        bottomOffset: 0,
        topOffset: 0.75
      }, (distance, fraction, out) => {
        const routeDistance = traveled + distance;
        out.surface = 0;
        out.ceiling = routeDistance >= ceilingStartM && routeDistance <= ceilingEndM
          ? 2.6
          : Number.POSITIVE_INFINITY;
      });
      if (result.hit) {
        return {
          kind: result.kind,
          time: elapsed + result.time,
          distance: traveled + speedMps * result.time
        };
      }
      altitude = result.altitude;
      velocity = result.velocity;
      elapsed += duration;
      traveled += sweepDistance;
    }
    return null;
  };

  const cadenceResults = [22, 30, 60, 120].map(simulateAtCadence);
  for (const result of cadenceResults) {
    assert.ok(result, 'The cadence replay missed the finite ceiling');
    assert.equal(result.kind, 'ceiling');
    assertApproximatelyEqual(result.time, expectedTime, 'Render cadence changed global ceiling-contact time');
    assertApproximatelyEqual(result.distance, ceilingStartM, 'Render cadence changed global ceiling-contact distance');
  }
}

{
  const routeId = 'loop-south-west';
  const startRouteDistanceM = 150;
  // Portal trimming follows the complete structural shell, so collision chronology must read the routed profile
  // rather than freezing a centreline-only margin from an older geometry revision.
  const expectedCoveredEntryM = track.getEdge(routeId).tunnelProfiles[0].surfaceStartS;
  const speedMps = 300;
  const replayActualRouteAtCadence = (framesPerSecond) => {
    let elapsed = 0;
    let traveled = 0;
    let altitude = 5;
    let velocity = 0;
    while (elapsed < 0.12 - 0.000_000_001) {
      const duration = Math.min(1 / framesPerSecond, 0.12 - elapsed);
      const sweepDistance = speedMps * duration;
      const result = core.sweptVerticalContact({
        startDistance: 0,
        endDistance: sweepDistance,
        duration,
        startAltitude: altitude,
        startVelocity: velocity,
        gravity: 0,
        bottomOffset: 0,
        topOffset: 2.75
      }, (distance, fraction, out) => {
        const frame = track.sampleEdge(
          routeId,
          startRouteDistanceM + traveled + distance,
          0,
          {}
        );
        out.surface = frame.y;
        out.ceiling = frame.ceilingHeight;
      });
      if (result.hit) {
        return {
          result,
          routeDistance: startRouteDistanceM + traveled + speedMps * result.time
        };
      }
      altitude = result.endAltitude;
      velocity = result.endVelocity;
      elapsed += duration;
      traveled += sweepDistance;
    }
    return null;
  };

  for (const cadence of [22, 30, 60, 120]) {
    const replay = replayActualRouteAtCadence(cadence);
    assert.ok(replay, `The actual lower-loop roof was missed at ${cadence}fps`);
    assert.equal(replay.result.kind, 'ceiling');
    assertApproximatelyEqual(
      replay.routeDistance,
      expectedCoveredEntryM,
      `Actual-route roof entry changed at ${cadence}fps`
    );
    assertApproximatelyEqual(replay.result.ceiling, 3.6, 'Actual-route hit sampled the open side');
    assert.ok(
      replay.result.endAltitude + 2.75 <= replay.result.endCeiling + 0.000_000_001,
      `Actual-route frame end penetrated the roof at ${cadence}fps`
    );
  }
}

{
  const routeId = 'loop-west-north';
  const startRouteDistanceM = 1_010;
  const routeTravelM = 13.5;
  const startFrame = track.sampleEdge(routeId, startRouteDistanceM, 0, {});
  const endFrame = track.sampleEdge(routeId, startRouteDistanceM + routeTravelM, 0, {});
  const result = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: routeTravelM,
    duration: 0.045,
    startAltitude: startFrame.ceilingHeight - 2.75,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 2.75
  }, (distance, fraction, out) => {
    const frame = track.sampleEdge(routeId, startRouteDistanceM + distance, 0, {});
    out.surface = frame.y;
    out.ceiling = frame.ceilingHeight;
  });
  assert.equal(result.kind, 'ceiling', 'The actual descending upper-loop roof must register contact');
  assert.ok(Number.isFinite(result.endCeiling));
  assertApproximatelyEqual(
    result.endAltitude,
    result.endCeiling - 2.75,
    'The actual-route remainder did not finish on the descending soffit'
  );
  assert.ok(
    result.endAltitude >= result.endSurface - 0.000_000_001,
    'The actual-route ceiling response crossed the lower road'
  );
  const expectedRoofDescent = startFrame.ceilingHeight - endFrame.ceilingHeight;
  assert.ok(expectedRoofDescent > 0.25, 'The actual route sample no longer exercises a descending roof');
  assertApproximatelyEqual(
    result.overshoot,
    expectedRoofDescent,
    'The actual descending-roof correction was not accumulated'
  );
}

{
  const tie = core.sweptVerticalContact({
    startDistance: 0,
    endDistance: 1,
    duration: 0.1,
    startAltitude: 0,
    startVelocity: 0,
    gravity: 0,
    bottomOffset: 0,
    topOffset: 0
  }, (distance, fraction, out) => {
    out.surface = 0;
    out.ceiling = 0;
  });
  assert.equal(tie.kind, 'ceiling', 'A same-time ceiling/floor contact must resolve ceiling first');
  assert.equal(tie.fraction, 0);
}

{
  const result = core.sweptAabb(
    { x: 0, y: 0, z: 6 },
    { x: 0, y: 0, z: -7.5 },
    { x: 1.8, y: 1.4, z: 2.1 }
  );
  assert.equal(result.hit, true, 'A 300m/s, 45ms longitudinal sweep must not tunnel through a small obstacle');
  assert.ok(result.entryTime > 0 && result.entryTime < 1);
}

{
  const result = core.sweptAabb(
    { x: 4, y: 0, z: 6 },
    { x: 4, y: 0, z: -7.5 },
    { x: 1.8, y: 1.4, z: 2.1 }
  );
  assert.equal(result.hit, false, 'A longitudinal crossing must still miss when the lateral slabs never overlap');
}

{
  const playerTravel = 300 * 0.045;
  const obstacleTravel = 18 * 0.045;
  const result = core.sweptAabb(
    { x: 0, y: 0, z: 8 },
    { x: 0, y: 0, z: 8 + obstacleTravel - playerTravel },
    { x: 1.8, y: 1.4, z: 2.1 }
  );
  assert.equal(result.hit, true, 'Moving obstacles must use relative longitudinal travel');
}

{
  const collisionCadences = [1 / 120, 1 / 60, 1 / 30, 1 / 22, 0.045];
  assert.deepEqual(
    collisionCadences.map(simulateSweptCollision),
    collisionCadences.map(() => true),
    'Swept collision must retain the same hit at every audited render cadence'
  );
}

{
  const collisionCadences = [1 / 120, 1 / 60, 1 / 30, 1 / 22, 0.045];
  const replays = collisionCadences.map((dt) => simulateSeededContactTimeline(dt, 0x23_07_16_a1));
  for (const replay of replays.slice(1)) {
    assert.deepEqual(replay, replays[0], 'Seeded damage/pickup IDs changed with render cadence');
  }
  assert.ok(replays[0].damageIds.length >= 7, 'Seeded replay did not exercise enough hazard damage contacts');
  assert.ok(replays[0].pickupIds.length >= 6, 'Seeded replay did not exercise enough pickup collections');
  assert.ok(replays[0].movingDamageIds.length > 0, 'Seeded replay omitted moving relative hazard motion');
  assert.deepEqual(replays[0].seamContactIds, ['hazard-6'], 'Seeded replay did not collide across the first edge seam');
}

{
  let seed = 0x23_5a_17_c9;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let fixtureIndex = 0; fixtureIndex < 2_000; fixtureIndex++) {
    const relativeStart = {
      x: random() * 24 - 12,
      y: random() * 12 - 6,
      z: random() * 40 - 20
    };
    const relativeEnd = {
      x: relativeStart.x + random() * 18 - 9,
      y: relativeStart.y + random() * 10 - 5,
      z: relativeStart.z + random() * 36 - 18
    };
    const half = {
      x: random() * 4,
      y: random() * 3,
      z: random() * 5
    };
    const detailed = core.sweptAabb(relativeStart, relativeEnd, half);
    const scalarHit = core.sweptAabbHit(
      relativeStart.x,
      relativeStart.y,
      relativeStart.z,
      relativeEnd.x,
      relativeEnd.y,
      relativeEnd.z,
      half.x,
      half.y,
      half.z
    );
    assert.equal(scalarHit, detailed.hit, `Scalar sweep diverged at deterministic fixture ${fixtureIndex}`);
  }
}

{
  const originalFreeze = Object.freeze;
  let freezeCalls = 0;
  Object.freeze = (value) => {
    freezeCalls++;
    return originalFreeze(value);
  };
  try {
    for (let iteration = 0; iteration < 1_000; iteration++) {
      assert.equal(
        core.sweptAabbHit(0, 0, 6, 0, 0, -7.5, 1.8, 1.4, 2.1),
        true
      );
    }
  } finally {
    Object.freeze = originalFreeze;
  }
  assert.equal(freezeCalls, 0, 'The scalar hot path must not create and freeze result or nested axis objects');
}

{
  const plan = track.createPathPlan({ entryPort: 'south', kind: 'straight' });
  const firstEdge = track.getEdge(plan.edgeIds[0]);
  const previousPlayer = { edgeId: firstEdge.id, edgeS: firstEdge.length - 1 };
  const entity = track.advanceCursor(previousPlayer, 4, plan);
  const currentPlayer = track.advanceCursor(previousPlayer, 8, plan);
  assert.notEqual(previousPlayer.edgeId, currentPlayer.edgeId, 'The seam fixture did not cross an edge boundary');
  const previousDistance = track.distanceAlongPath(previousPlayer, entity, plan);
  const currentDistance = track.distanceAlongPath(currentPlayer, entity, plan);
  assert.equal(previousDistance, 4);
  assert.equal(currentDistance, -4);
  assert.equal(core.sweptAabb(
    { x: 0, y: 0, z: previousDistance },
    { x: 0, y: 0, z: currentDistance },
    { x: 1.8, y: 1.4, z: 2.1 }
  ).hit, true, 'Adjacent route edges must share one swept longitudinal interval');
}

{
  const plan = track.createPathPlan({ entryPort: 'south', kind: 'straight' });
  const branchEdgeId = plan.edgeIds.find((edgeId) => track.getEdge(edgeId)?.family === 'straight-fork-branch');
  assert.ok(branchEdgeId, 'The itinerary did not publish its straight-fork branch');
  const branchEdge = track.getEdge(branchEdgeId);
  const cursor = { edgeId: branchEdge.id, edgeS: branchEdge.length * 0.42 };
  const placements = track.getReachableTrafficPlacements(cursor, {});
  assert.equal(placements.length, 2, 'An uncommitted straight fork must expose both traffic placements');
  assert.equal(new Set(placements.map((placement) => placement.movementId)).size, 2);
  assert.equal(new Set(placements.map((placement) => placement.cursor.edgeId)).size, 2);
  assert.ok(placements.every((placement) => placement.cursor.edgeS === cursor.edgeS));
  const right = placements.find((placement) => track.getMovement(placement.movementId)?.forkSide === 'right');
  const committed = track.getReachableTrafficPlacements(cursor, {
    [right.decisionId]: right.movementId
  });
  assert.equal(committed.length, 1, 'A committed traffic group must retain only the selected branch');
  assert.equal(committed[0].movementId, right.movementId);
}

{
  const entries = ['south', 'west', 'north', 'east'];
  const kinds = ['straight', 'right', 'left'];
  const branchPressure = { left: 0, right: 0 };
  let successfulTrafficGroups = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const random = createDeterministicRandom(Math.imul(seed, 0x9e_37_79_b1));
    const plan = track.createPathPlan({
      entryPort: entries[Math.floor(random() * entries.length)],
      kind: kinds[Math.floor(random() * kinds.length)]
    });
    const branchEdgeIds = plan.edgeIds.filter(
      (edgeId) => track.getEdge(edgeId)?.family === 'straight-fork-branch'
    );
    const branchEdge = track.getEdge(branchEdgeIds[Math.floor(random() * branchEdgeIds.length)]);
    const groupCount = 2 + Math.floor(random() * 4);
    successfulTrafficGroups += groupCount;
    const groups = Array.from({ length: groupCount }, (_, groupIndex) => {
      const cursor = {
        edgeId: branchEdge.id,
        edgeS: branchEdge.length * (0.12 + random() * 0.76)
      };
      const placements = track.getReachableTrafficPlacements(cursor, {});
      assert.deepEqual(
        placements.map((placement) => track.getMovement(placement.movementId)?.forkSide).sort(),
        ['left', 'right'],
        `Seed ${seed} successful group ${groupIndex} did not cover both reachable branches`
      );
      return {
        id: `seed-${seed}-group-${groupIndex}`,
        cursor,
        placements
      };
    });
    const mirroredEntities = groups.flatMap((group) => group.placements.map((placement) => ({
      id: `${group.id}:${placement.movementId}`,
      trafficGroupId: group.id,
      trafficDecisionId: placement.decisionId,
      trafficMovementId: placement.movementId,
      edgeId: placement.cursor.edgeId,
      edgeS: placement.cursor.edgeS,
      motionKind: random() < 0.5 ? 'laneChange' : 'sweeper'
    })));
    assert.equal(
      core.countReachableTrafficGroups(mirroredEntities, () => true, (entity) => entity.motionKind !== 'static'),
      groupCount,
      `Seed ${seed} counted mirrored branch copies as extra successful traffic groups`
    );

    const firstPlacements = groups[0].placements;
    for (const side of ['left', 'right']) {
      const selected = firstPlacements.find(
        (placement) => track.getMovement(placement.movementId)?.forkSide === side
      );
      const committedChoices = { [selected.decisionId]: selected.movementId };
      const committedPlan = track.createPathPlan({
        movementId: plan.movementId,
        entryPort: plan.entryPort,
        committedChoices
      });
      for (const group of groups) {
        const committedPlacements = track.getReachableTrafficPlacements(group.cursor, committedChoices);
        assert.equal(committedPlacements.length, 1, `Seed ${seed} ${side} commit retained duplicate branch copies`);
        assert.equal(committedPlacements[0].movementId, selected.movementId);
      }
      const wrongPlacement = firstPlacements.find((placement) => placement.movementId !== selected.movementId);
      const wrongRouteDynamic = {
        id: `seed-${seed}:${side}:wrong-route`,
        trafficGroupId: `seed-${seed}:${side}:wrong-route-group`,
        trafficDecisionId: null,
        trafficMovementId: wrongPlacement.movementId,
        edgeId: wrongPlacement.cursor.edgeId,
        edgeS: wrongPlacement.cursor.edgeS,
        motionKind: 'sweeper'
      };
      const residentEntities = [...mirroredEntities, wrongRouteDynamic];
      const isReachable = (entity) => entityReachableOnPlan(entity, committedPlan);
      const dynamic = (entity) => entity.motionKind !== 'static';
      const reachableGroupCount = core.countReachableTrafficGroups(residentEntities, isReachable, dynamic);
      assert.equal(reachableGroupCount, groupCount, `Seed ${seed} ${side} current-path dynamic cap drifted`);
      assert.equal(
        core.countReachableTrafficGroups(residentEntities, () => true, dynamic),
        groupCount + 1,
        `Seed ${seed} wrong-route fixture did not distinguish resident and current-path groups`
      );
      branchPressure[side] += reachableGroupCount;

      for (const group of groups) {
        assert.equal(
          residentEntities.filter((entity) => entity.trafficGroupId === group.id).length,
          2,
          `Seed ${seed} ${side} commit did not preserve both physical-road copies of ${group.id}`
        );
        assert.equal(
          residentEntities.filter((entity) => (
            entity.trafficGroupId === group.id && isReachable(entity)
          )).length,
          1,
          `Seed ${seed} ${side} commit exposed more than one copy of ${group.id} to current-path gameplay`
        );
      }
      assert.equal(
        core.countReachableTrafficGroups(residentEntities, isReachable, dynamic),
        groupCount,
        `Seed ${seed} ${side} preserved wrong-route dynamics consumed the committed cap`
      );
    }
  }
  const pressureDifference = Math.abs(branchPressure.left - branchPressure.right)
    / Math.max(branchPressure.left, branchPressure.right);
  assert.equal(branchPressure.left, successfulTrafficGroups);
  assert.equal(branchPressure.right, successfulTrafficGroups);
  assert.ok(pressureDifference < 0.03, `Mirrored branch pressure differed by ${pressureDifference * 100}%`);
}

{
  const cadences = [1 / 120, 1 / 60, 1 / 30, 1 / 22, 0.045];
  const results = cadences.map((dt) => simulateTimer(dt, 120));
  assert.deepEqual(
    [...new Set(results.map((result) => result.events))],
    [530],
    'Timer overshoot must preserve the same 120-second event count at every audited cadence'
  );
  assert.ok(Math.max(...results.map((result) => result.timer)) - Math.min(...results.map((result) => result.timer)) < 0.000_001);
}

{
  const contract = core.DAMAGE_PROTECTION_CONTRACT;
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(contract.id, 'ordinary-damage-protection-v1');
  assert.equal(contract.invulnerabilitySeconds, 1.32);
  assert.equal(contract.impactFeedbackSeconds, 0.48);
  assert.equal(contract.timerClock, 'active-gameplay');
  assert.equal(contract.maximumAcceptedPerRenderFrame, 1);
  assert.equal(contract.blockedAttemptSideEffects, 'none');
  assert.equal(contract.presentation, 'single-impact-steady-shield-no-blink');

  const cadences = [1 / 120, 1 / 60, 1 / 30, 1 / 22, 0.045];
  for (const cadence of cadences) {
    const protectedRemaining = simulateDamageProtection(
      cadence,
      contract.invulnerabilitySeconds - 0.001,
      contract.invulnerabilitySeconds
    );
    assert.ok(
      protectedRemaining > 0,
      `Damage protection expired early at ${cadence}s cadence`
    );
    assert.equal(
      core.canAcceptOrdinaryDamage(protectedRemaining, false),
      false,
      `Damage was accepted before 1.32 active gameplay seconds at ${cadence}s cadence`
    );

    const expiredRemaining = simulateDamageProtection(
      cadence,
      contract.invulnerabilitySeconds,
      contract.invulnerabilitySeconds
    );
    assert.equal(expiredRemaining, 0);
    assert.equal(core.canAcceptOrdinaryDamage(expiredRemaining, false), true);
  }

  const pausedRemaining = core.advanceDamageInvulnerability(
    contract.invulnerabilitySeconds,
    0
  );
  assert.equal(
    pausedRemaining,
    contract.invulnerabilitySeconds,
    'Paused wall time must not consume active-gameplay damage protection'
  );

  // A long catch-up frame may expire the timer, but its frame latch still prevents a second life charge.
  assert.equal(core.canAcceptOrdinaryDamage(0, false), true);
  assert.equal(core.canAcceptOrdinaryDamage(0, true), false);
  assert.equal(
    core.canAcceptOrdinaryDamage(
      core.advanceDamageInvulnerability(contract.invulnerabilitySeconds, 2),
      true
    ),
    false
  );
  assert.equal(core.canAcceptOrdinaryDamage(0, false), true);

  for (const invalidRemaining of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => core.advanceDamageInvulnerability(invalidRemaining, 0),
      /remaining time must be finite and non-negative/
    );
    assert.throws(
      () => core.canAcceptOrdinaryDamage(invalidRemaining, false),
      /remaining time must be finite and non-negative/
    );
  }
  for (const invalidElapsed of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => core.advanceDamageInvulnerability(0, invalidElapsed),
      /elapsed time must be finite and non-negative/
    );
  }
}

{
  const cadences = [1 / 60, 1 / 30, 0.045];
  const timelines = cadences.map((dt) => simulateSpawnTimeline(dt, 120));
  for (const timeline of timelines.slice(1)) {
    assert.deepEqual(
      timeline.eventSequence,
      timelines[0].eventSequence,
      'Merged obstacle/traffic/pickup due-time order changed with render cadence'
    );
    assert.deepEqual(
      timeline.randomSequence,
      timelines[0].randomSequence,
      'Shared gameplay RNG consumption changed with render cadence'
    );
  }
  for (let channelIndex = 0; channelIndex < timelines[0].channels.length; channelIndex++) {
    const timers = timelines.map((timeline) => timeline.channels[channelIndex].timer);
    assert.ok(Math.max(...timers) - Math.min(...timers) < 0.000_001);
  }
}

{
  const result = core.consumeCooldown(0.02, 2.2, 0.63);
  assert.equal(result.eventCount, 4, 'A bounded catch-up must consume every due interval');
  assert.ok(result.timer > 0 && result.timer <= 0.63);
  assert.equal(result.limited, false);
}

{
  const speedMps = 105 / 3.6;
  const expectedTenSecondDistanceM = speedMps * 10;
  const simulateDistance = (framesPerSecond, seconds = 10) => {
    let distance = 0;
    let elapsed = 0;
    const frameDuration = 1 / framesPerSecond;
    for (let frameIndex = 0; frameIndex < framesPerSecond * seconds; frameIndex++) {
      elapsed += core.consumeBoundedElapsedTime(frameDuration, (step) => {
        distance += core.integrateLongitudinalDistance(speedMps, speedMps, step);
      });
    }
    return { distance, elapsed };
  };
  for (const framesPerSecond of [60, 30, 10, 4, 3, 2, 1]) {
    const result = simulateDistance(framesPerSecond);
    assertApproximatelyEqual(
      result.elapsed,
      10,
      `${framesPerSecond}fps discarded visible wall-clock time`
    );
    assertApproximatelyEqual(
      result.distance,
      expectedTenSecondDistanceM,
      `105km/h changed real travel distance at ${framesPerSecond}fps`
    );
  }

  let longFrameDistance = 0;
  const longFrameElapsed = core.consumeBoundedElapsedTime(2, (step) => {
    longFrameDistance += core.integrateLongitudinalDistance(speedMps, speedMps, step);
  });
  assert.equal(longFrameElapsed, 2);
  assertApproximatelyEqual(
    longFrameDistance,
    speedMps * 2,
    'A visible two-second frame must preserve every authoritative metre'
  );
  assert.throws(
    () => core.integrateLongitudinalDistance(-1, speedMps, 1),
    /non-negative inputs/
  );
  assert.throws(
    () => core.integrateLongitudinalDistance(speedMps, Number.NaN, 1),
    /finite speeds/
  );
}

{
  const input = {
    lateral: -0.01,
    velocity: 0,
    steer: 1,
    steerAcceleration: 93,
    outwardAcceleration: 0,
    dragRate: 9.2,
    maximumSpeed: 35,
    minimum: -6,
    maximum: 6
  };
  const crossing = core.integrateLateralStep(input, 0.045);
  assert.ok(crossing.lateral > 0, 'The current A/D acceleration must affect a zero-boundary portal commit');
}

{
  const motion = {
    baseLateral: 0.4,
    amplitude: 1.1,
    frequency: 0.72,
    phase: 1.3,
    motionTime: -1.3 / 0.72,
    driftRate: 0.16,
    driftTime: 0,
    driftDuration: 1.8,
    limit: 5
  };
  for (let index = 0; index < 180; index++) {
    const dt = 1 / 60;
    const predicted = core.sampleObstacleLateral(motion, dt);
    motion.motionTime += dt;
    motion.driftTime = Math.min(motion.driftDuration, motion.driftTime + dt);
    const actual = core.sampleObstacleLateral(motion, 0);
    assert.ok(Math.abs(predicted - actual) < 0.000_000_001, 'Drift prediction and actual integration diverged');
  }
  assert.ok(Math.abs(motion.driftRate * motion.driftTime - 0.288) < 0.000_000_001);
}

{
  const graphStep = core.resolveObstacleLongitudinalStep(-2.5, 0.045, true);
  const legacyStep = core.resolveObstacleLongitudinalStep(-2.5, 0.045, false);
  assert.equal(graphStep, 0, 'A forward-only graph hazard must not desynchronize at a backward edge seam');
  assert.ok(
    Math.abs(legacyStep + 0.1125) < 0.000_000_001,
    'Legacy analytic routes must retain their representable signed motion'
  );
  assert.ok(Math.abs(core.resolveObstacleLongitudinalStep(18, 0.045, true) - 0.81) < 0.000_000_001);
}

{
  const ratingContract = core.FLIGHT_RATING_CONTRACT;
  assert.equal(Object.values(ratingContract.weights).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(ratingContract.id, 'flight-rating-v2');
  assert.equal(ratingContract.version, 2);
  assert.equal(
    ratingContract.targetSpeedMps,
    core.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps
  );
  assert.equal(Object.isFrozen(ratingContract), true);
  assert.equal(Object.isFrozen(ratingContract.weights), true);
  assert.equal(Object.isFrozen(ratingContract.safetyDamageFreeSegmentAnchorsKm), true);
  assert.equal(Object.isFrozen(ratingContract.collectionRateAnchorsPerKm), true);
  for (const [score, grade] of [
    [0, 'D'],
    [59, 'D'],
    [60, 'C'],
    [69, 'C'],
    [70, 'B'],
    [79, 'B'],
    [80, 'A'],
    [89, 'A'],
    [90, 'S'],
    [100, 'S']
  ]) {
    assert.equal(core.resolveFlightRatingGrade(score), grade, `${score} must resolve to ${grade}`);
  }
}

{
  const empty = core.resolveFlightRating();
  assert.equal(empty.score, 0);
  assert.equal(empty.grade, 'D');
  assert.equal(empty.evidenceLevel, 'limited');
  assert.equal(empty.coveragePercent, 70);
  assert.equal(empty.metrics.averageSpeedMps, 0);
  assert.equal(empty.metrics.collectionRatePerKm, 0);
  assert.equal(empty.dimensions.find((dimension) => dimension.id === 'collection').available, false);
  assert.equal(empty.dimensions.find((dimension) => dimension.id === 'airborne').available, false);
  assert.equal(Object.isFrozen(empty), true);
  assert.equal(Object.isFrozen(empty.metrics), true);
  assert.equal(Object.isFrozen(empty.dimensions), true);
  assertFlightRatingDimensionContract(empty);
  assert.ok(
    Object.values(empty.metrics).every((value) => typeof value !== 'number' || Number.isFinite(value)),
    'zero evidence must never publish NaN or infinity'
  );
}

{
  const input = {
    distanceM: 12_000,
    elapsedSeconds: 80,
    maximumSpeedMps: 300,
    damageCount: 1,
    guardrailDamageCount: 1,
    offRoadCrashCount: 0,
    candleCount: 200,
    takeoffCount: 5,
    landingCount: 4,
    platformTakeoffCount: 4,
    platformLandingCount: 3,
    totalAirTimeSeconds: 7.5,
    successfulAirTimeSeconds: 5.3,
    platformAirTimeSeconds: 6.2,
    successfulPlatformAirTimeSeconds: 4,
    longestAirTimeSeconds: 2.2
  };
  const before = JSON.stringify(input);
  const report = core.resolveFlightRating(input);
  assert.equal(JSON.stringify(input), before, 'rating must not mutate its measured input');
  assertFlightRatingDimensionContract(report);
  assert.equal(report.evidenceLevel, 'complete');
  assert.equal(report.coveragePercent, 100);
  assert.equal(report.metrics.averageSpeedMps, 150);
  assert.equal(report.metrics.damageCount, 1);
  assert.equal(report.metrics.obstacleDamageCount, 0);
  assert.equal(report.metrics.guardrailDamageCount, 1);
  assert.equal(report.metrics.damageFreeSegmentKm, 6);
  assert.equal(
    report.dimensions.find((dimension) => dimension.id === 'safety').score,
    64,
    'the first accepted guardrail hit must lower safety below the damage-free score'
  );
  assert.equal(report.metrics.totalAirTimeSeconds, 7.5);
  assert.equal(report.metrics.longestAirTimeSeconds, 2.2);
  assert.equal(report.metrics.platformLandingRate, 0.75);
  assert.equal(
    report.dimensions.find((dimension) => dimension.id === 'airborne').score,
    73,
    'airborne score must use platform landing reliability and successful platform airtime'
  );
}

{
  const safetyScore = (damageCount, guardrailDamageCount) => {
    const report = core.resolveFlightRating({
      distanceM: 12_000,
      elapsedSeconds: 80,
      damageCount,
      guardrailDamageCount
    });
    return {
      score: report.dimensions.find((dimension) => dimension.id === 'safety').score,
      metrics: report.metrics
    };
  };
  const damageFree = safetyScore(0, 0);
  const obstacleHit = safetyScore(1, 0);
  const guardrailHit = safetyScore(1, 1);
  const mixedHits = safetyScore(2, 1);
  const clampedGuardrail = safetyScore(1, 9);

  assert.deepEqual(
    [damageFree.score, obstacleHit.score, guardrailHit.score, mixedHits.score],
    [84, 64, 64, 53],
    'every accepted hit must split the run into another damage-free segment regardless of source'
  );
  assert.deepEqual(
    [damageFree.metrics.damageFreeSegmentKm, obstacleHit.metrics.damageFreeSegmentKm,
      guardrailHit.metrics.damageFreeSegmentKm, mixedHits.metrics.damageFreeSegmentKm],
    [12, 6, 6, 4]
  );
  assert.deepEqual(
    [mixedHits.metrics.obstacleDamageCount, mixedHits.metrics.guardrailDamageCount],
    [1, 1]
  );
  assert.deepEqual(
    [clampedGuardrail.metrics.obstacleDamageCount, clampedGuardrail.metrics.guardrailDamageCount],
    [0, 1],
    'guardrail evidence must remain a subset of accepted life loss'
  );
}

{
  const common = {
    distanceM: 12_000,
    elapsedSeconds: 80,
    maximumSpeedMps: 300,
    damageCount: 0,
    candleCount: 100,
    takeoffCount: 1,
    landingCount: 0,
    platformTakeoffCount: 1,
    platformLandingCount: 0,
    successfulAirTimeSeconds: 0,
    successfulPlatformAirTimeSeconds: 0
  };
  const briefFailure = core.resolveFlightRating({
    ...common,
    totalAirTimeSeconds: 0.5,
    platformAirTimeSeconds: 0.5,
    longestAirTimeSeconds: 0.5
  });
  const longFailure = core.resolveFlightRating({
    ...common,
    totalAirTimeSeconds: 9,
    platformAirTimeSeconds: 9,
    longestAirTimeSeconds: 9
  });
  assert.equal(
    briefFailure.dimensions.find((dimension) => dimension.id === 'airborne').score,
    0
  );
  assert.equal(
    longFailure.dimensions.find((dimension) => dimension.id === 'airborne').score,
    0,
    'a long failed flight must remain visible in facts without earning airborne credit'
  );
  assert.equal(longFailure.metrics.totalAirTimeSeconds, 9);
}

{
  const offRoad = core.resolveFlightRating({
    distanceM: 60_000,
    elapsedSeconds: 240,
    maximumSpeedMps: 300,
    damageCount: 0,
    offRoadCrashCount: 1,
    candleCount: 1_000,
    takeoffCount: 8,
    landingCount: 7,
    platformTakeoffCount: 8,
    platformLandingCount: 7,
    totalAirTimeSeconds: 14,
    successfulAirTimeSeconds: 12,
    platformAirTimeSeconds: 14,
    successfulPlatformAirTimeSeconds: 12,
    longestAirTimeSeconds: 2
  });
  assert.equal(offRoad.endReason, 'off-road-crash');
  assert.ok(
    offRoad.dimensions.find((dimension) => dimension.id === 'safety').score <= 20,
    'fatal road misses must hard-cap the safety dimension'
  );
}

console.log('Neon gameplay core regression passed');
