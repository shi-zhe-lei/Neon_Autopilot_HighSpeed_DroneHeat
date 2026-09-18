#!/usr/bin/env node
/* Fixed-step production-policy regression / 固定步长生产生成策略回归。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Resolve production dependencies from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = join(__dirname, '../..');
const core = require(join(
  PROJECT_ROOT,
  'src/gameplay/Neon_Autopilot_V23_HighSpeed_DroneHeat.gameplay-core.js'
));

const fixedStepSeconds = 1 / 120;
const durationSeconds = 120;
const fairAutopilotContractSpeed = core.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps;
const verifiedTerminalSpeed = core.LONGITUDINAL_DYNAMICS_CONTRACT.dryFullThrottleTerminalSpeedMps;
const jumpGearTerminalSpeed = core.DRIVE_GEAR_CONTRACT.gears[3].equilibriumSpeedMps;
const spawnTravelReferenceSpeed = 24;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Reproduce the scalar production pressure policy so cadence tests cover every nonlinear speed ramp. */
function configureProductionChannels(channels, speed) {
  const high = clamp(
    (speed - fairAutopilotContractSpeed * 0.62) / (fairAutopilotContractSpeed * 0.30),
    0,
    1
  );
  const terminalRatio = clamp(speed / Math.max(1, verifiedTerminalSpeed), 0, 1.4);
  const densityRamp = clamp(
    (speed - fairAutopilotContractSpeed * 0.55) / (fairAutopilotContractSpeed * 0.45),
    0,
    1
  );
  const finalDensityRamp = clamp(
    (speed - verifiedTerminalSpeed * 0.88) / Math.max(1, verifiedTerminalSpeed * 0.12),
    0,
    1
  );
  const travelScale = clamp(speed / spawnTravelReferenceSpeed, 0, 1);

  channels[0].scale = clamp(
    0.94 + terminalRatio * 0.18 + densityRamp * 0.08 + finalDensityRamp * 0.10,
    0.94,
    1.34
  ) * travelScale;
  channels[0].cooldown = Math.max(
    0.82,
    1.08 - Math.min(1, terminalRatio) * 0.12 - high * 0.035 - finalDensityRamp * 0.035
  );
  channels[1].scale = clamp(
    0.72 + terminalRatio * 0.16 + densityRamp * 0.07 + high * 0.04,
    0.72,
    1.08
  ) * travelScale;
  channels[1].cooldown = Math.max(
    1.42,
    2.08 - Math.min(1, terminalRatio) * 0.24 - high * 0.10 - finalDensityRamp * 0.08
  );
  channels[2].scale = Math.min(6.4, 1.08 + speed * 0.0105) * travelScale;
  channels[2].cooldown = Math.max(0.14, 0.54 - Math.min(speed, 210) * 0.00155);
}

/**
 * Build one production-core 1→2→3 pressure trajectory. Shift requests occur only at each target gear's minimum
 * speed, and each accepted request owns the real 300ms torque cut before the new gear engages. Sampling this one
 * fixed trajectory from different render cadences isolates spawn-clock determinism from render frame boundaries.
 */
function buildDriveTrajectory() {
  const stepCount = Math.round(durationSeconds / fixedStepSeconds);
  const speeds = new Float64Array(stepCount + 1);
  const gears = new Uint8Array(stepCount + 1);
  const shiftEvents = [];
  let speed = 0;
  let driveGear = core.DRIVE_GEAR_CONTRACT.defaultGear;
  let pendingDriveGear = null;
  let shiftRemainingSeconds = 0;
  let propulsionSpool = 0;
  let propulsionRpm = core.PROPULSION_CORE_CONTRACT.idleRpm;
  gears[0] = driveGear;

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const elapsed = stepIndex * fixedStepSeconds;
    if (pendingDriveGear === null && driveGear < core.DRIVE_GEAR_CONTRACT.maximumGear) {
      const requestedGear = driveGear + 1;
      if (speed >= core.DRIVE_GEAR_CONTRACT.gears[requestedGear].minimumSpeedMps) {
        const request = core.resolveDriveGearShiftRequest({
          currentGear: driveGear,
          requestedGear,
          speedMps: speed,
          shiftInProgress: false,
          automaticThrottleEnabled: false
        }, {});
        assert.equal(request.accepted, true, `fixture shift ${driveGear}→${requestedGear} was rejected`);
        pendingDriveGear = requestedGear;
        shiftRemainingSeconds = request.shiftTorqueCutSeconds;
        shiftEvents.push({ type: 'request', from: driveGear, to: requestedGear, elapsed });
      }
    }

    const torqueCutSeconds = Math.min(fixedStepSeconds, shiftRemainingSeconds);
    const propulsionGear = pendingDriveGear ?? driveGear;
    const propulsion = core.resolvePropulsionCoreStep({
      currentSpool: propulsionSpool,
      currentRpm: propulsionRpm,
      throttleCommand: 1,
      braking: false,
      gear: propulsionGear,
      shifting: torqueCutSeconds > 0,
      shiftTorqueCutSeconds: torqueCutSeconds
    }, fixedStepSeconds, {});
    propulsionSpool = propulsion.nextSpool;
    propulsionRpm = propulsion.rpm;
    speed = core.resolveLongitudinalDynamicsStep({
      speedMps: speed,
      propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
      brakeDecelerationMps2: 0,
      surfaceDecelerationMps2: 0,
      grounded: true,
      surfaceGrade: 0
    }, fixedStepSeconds, {}).nextSpeedMps;

    if (torqueCutSeconds > 0) {
      shiftRemainingSeconds = Math.max(0, shiftRemainingSeconds - torqueCutSeconds);
      if (shiftRemainingSeconds <= 0.000_000_001) {
        const previousGear = driveGear;
        driveGear = pendingDriveGear;
        pendingDriveGear = null;
        shiftRemainingSeconds = 0;
        shiftEvents.push({
          type: 'engage',
          from: previousGear,
          to: driveGear,
          elapsed: (stepIndex + 1) * fixedStepSeconds
        });
      }
    }
    speeds[stepIndex + 1] = speed;
    gears[stepIndex + 1] = driveGear;
  }
  return Object.freeze({ speeds, gears, shiftEvents: Object.freeze(shiftEvents) });
}

const driveTrajectory = buildDriveTrajectory();

function speedAt(seconds) {
  const boundedStep = clamp(
    Math.max(0, Number(seconds) || 0) / fixedStepSeconds,
    0,
    driveTrajectory.speeds.length - 1
  );
  const lowerIndex = Math.floor(boundedStep);
  const upperIndex = Math.min(driveTrajectory.speeds.length - 1, lowerIndex + 1);
  const progress = boundedStep - lowerIndex;
  return driveTrajectory.speeds[lowerIndex]
    + (driveTrajectory.speeds[upperIndex] - driveTrajectory.speeds[lowerIndex]) * progress;
}

function simulate(renderStepSeconds) {
  const channels = [
    { timer: 0.2, scale: 1, cooldown: 1, eventCount: 0, limited: false },
    { timer: 0.75, scale: 1, cooldown: 1, eventCount: 0, limited: false },
    { timer: 0.4, scale: 1, cooldown: 1, eventCount: 0, limited: false }
  ];
  const clock = { elapsed: 0, valueIntegral: 0, distance: 0, limited: false };
  const dueOrder = new Uint8Array(channels.length * core.DEFAULT_MAX_CATCH_UP_EVENTS);
  const eventSequence = [];
  const eventSeedSequence = [];
  let eventSerial = 0;
  let elapsed = 0;
  let fixedStepLimitCount = 0;

  while (elapsed < durationSeconds - 0.000_000_001) {
    const frameSeconds = Math.min(renderStepSeconds, durationSeconds - elapsed);
    core.consumeFixedSimulationSteps(
      clock,
      frameSeconds,
      speedAt(elapsed),
      speedAt(elapsed + frameSeconds),
      fixedStepSeconds,
      (stepSeconds, sampledSpeed) => {
        clock.distance += sampledSpeed * stepSeconds;
        configureProductionChannels(channels, sampledSpeed);
        const dueCount = core.consumeCooldownTimeline(channels, stepSeconds, dueOrder);
        for (let index = 0; index < dueCount; index++) {
          const channelIndex = dueOrder[index];
          eventSequence.push(channelIndex);
          // Production keys the local stream by these values, so internal conditional draws cannot shift the next seed.
          eventSeedSequence.push(`${eventSerial++}:${channelIndex}`);
        }
      }
    );
    if (clock.limited) fixedStepLimitCount++;
    elapsed += frameSeconds;
  }

  return {
    channels: channels.map(({ timer, eventCount }) => ({ timer, eventCount })),
    clock: { elapsed: clock.elapsed, valueIntegral: clock.valueIntegral, distance: clock.distance },
    eventSequence,
    eventSeedSequence,
    fixedStepLimitCount
  };
}

test('1→2→3 accelerating production pressure remains invariant across render cadences', () => {
  const cadences = [1 / 120, 1 / 60, 1 / 30, 1 / 22, 0.045];
  const baseline = simulate(cadences[0]);
  assert.deepEqual(
    driveTrajectory.shiftEvents.map(({ type, from, to }) => `${type}:${from}>${to}`),
    ['request:1>2', 'engage:1>2', 'request:2>3', 'engage:2>3']
  );
  for (let index = 0; index < driveTrajectory.shiftEvents.length; index += 2) {
    assert.ok(
      Math.abs(
        driveTrajectory.shiftEvents[index + 1].elapsed
          - driveTrajectory.shiftEvents[index].elapsed
          - core.DRIVE_GEAR_CONTRACT.shiftTorqueCutSeconds
      ) < 0.000_000_001,
      'each fixture shift must preserve the authored 300ms torque interruption'
    );
  }
  assert.equal(driveTrajectory.gears.at(-1), 3, 'fixture must sustain manual jump gear');
  assert.ok(
    speedAt(durationSeconds) > jumpGearTerminalSpeed * 0.999,
    'fixture must reach the third-gear natural-equilibrium pressure ramp'
  );
  assert.ok(
    speedAt(durationSeconds) > verifiedTerminalSpeed * 1.7,
    'third-gear pressure must materially exceed the former second-gear fixture'
  );
  assert.ok(baseline.eventSequence.length > 300, 'fixture must exercise sustained nonlinear spawn pressure');
  for (const cadence of cadences.slice(1)) {
    const actual = simulate(cadence);
    assert.deepEqual(actual.eventSequence, baseline.eventSequence, `event order drifted at ${cadence}s`);
    assert.deepEqual(actual.eventSeedSequence, baseline.eventSeedSequence, `event seed order drifted at ${cadence}s`);
    assert.equal(actual.fixedStepLimitCount, 0, `fixed-step guard fired at ${cadence}s`);
    assert.ok(Math.abs(actual.clock.elapsed - baseline.clock.elapsed) < 0.000_000_01);
    assert.ok(Math.abs(actual.clock.valueIntegral - baseline.clock.valueIntegral) < 0.000_000_01);
    assert.ok(
      Math.abs(actual.clock.distance - baseline.clock.distance) < 0.001,
      `distance drift ${actual.clock.distance - baseline.clock.distance}m at ${cadence}s`
    );
    for (let channelIndex = 0; channelIndex < baseline.channels.length; channelIndex++) {
      assert.ok(
        Math.abs(actual.channels[channelIndex].timer - baseline.channels[channelIndex].timer) < 0.000_1,
        `channel ${channelIndex} timer drifted by ${actual.channels[channelIndex].timer - baseline.channels[channelIndex].timer} at ${cadence}s`
      );
      assert.equal(actual.channels[channelIndex].eventCount, baseline.channels[channelIndex].eventCount);
    }
  }
});

test('stationary spawn clocks freeze and low-speed pressure follows real travel', () => {
  const parkedChannels = [
    { timer: 0.2, scale: 1, cooldown: 1, eventCount: 0, limited: false },
    { timer: 0.75, scale: 1, cooldown: 1, eventCount: 0, limited: false },
    { timer: 0.4, scale: 1, cooldown: 1, eventCount: 0, limited: false }
  ];
  configureProductionChannels(parkedChannels, 0);
  assert.deepEqual(parkedChannels.map(({ scale }) => scale), [0, 0, 0]);
  const parkedTimers = parkedChannels.map(({ timer }) => timer);
  const dueOrder = new Uint8Array(parkedChannels.length * core.DEFAULT_MAX_CATCH_UP_EVENTS);
  assert.equal(core.consumeCooldownTimeline(parkedChannels, 600, dueOrder), 0);
  assert.deepEqual(parkedChannels.map(({ timer }) => timer), parkedTimers);

  const lowChannels = parkedChannels.map((channel) => ({ ...channel }));
  const openingChannels = parkedChannels.map((channel) => ({ ...channel }));
  configureProductionChannels(lowChannels, 16);
  configureProductionChannels(openingChannels, 32);
  for (let index = 0; index < lowChannels.length; index++) {
    assert.ok(lowChannels[index].scale > 0, `channel ${index} did not resume with travel`);
    assert.ok(
      lowChannels[index].scale < openingChannels[index].scale,
      `channel ${index} did not reduce low-speed wall-clock pressure`
    );
  }
});

test('production wiring captures frame-start speed and resets every fixed-clock field', () => {
  const source = readFileSync(
    join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
    'utf8'
  );
  assert.match(source, /state\.previousSpeed = previousSpeed;\s+updateLongitudinalControl\(dt\);/);
  assert.match(source, /gameplayCore\.consumeFixedSimulationSteps\([\s\S]*?completeSpawnSimulationStep[\s\S]*?\);/);
  assert.match(source, /spawnSimulationClock\.distance \+= speed \* stepSeconds;/);
  assert.match(source, /spawnEventRandomState = modeling\.hashSeed\(`spawn-event:\$\{state\.runSeed\}:\$\{serial\}:\$\{channelIndex\}`\)/);
  assert.match(source, /function spawnTravelScale\(speed\)[\s\S]*?finiteSpeed \/ spawnTravelReferenceSpeed/);
  assert.match(source, /const travelScale = spawnTravelScale\(speed\);/);
  assert.match(source, /spawnChannel\.scale = trafficPolicy\.spawnScale \* travelScale;/);
  assert.match(source, /trafficChannel\.scale = trafficPolicy\.trafficScale \* travelScale;/);
  assert.match(source, /pickupChannel\.scale = Math\.min\(6\.4, 1\.08 \+ speed \* 0\.0105\) \* travelScale;/);
  assert.doesNotMatch(source, /const speed = Math\.max\(1, sampledSpeed \|\| 32\);/);
  for (const field of ['elapsed', 'valueIntegral', 'distance', 'limited']) {
    assert.match(source, new RegExp(`spawnSimulationClock\\.${field} = `), `reset must own ${field}`);
  }
});
