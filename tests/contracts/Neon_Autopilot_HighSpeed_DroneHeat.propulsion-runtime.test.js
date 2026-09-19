import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = new URL('../../', import.meta.url);
const runtimeSource = readFileSync(
  new URL('src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js', PROJECT_ROOT),
  'utf8'
);
const gameplayCoreSource = readFileSync(
  new URL('src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js', PROJECT_ROOT),
  'utf8'
);
const requireFromTest = createRequire(import.meta.url);
const gameplayCore = requireFromTest(fileURLToPath(
  new URL('src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js', PROJECT_ROOT)
));

/** Return one bounded authored section so assertions follow data flow without snapshotting the runtime. */
function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('runtime routes exclusive manual, full-throttle, autopilot, and braking authority through one force balance', () => {
  assert.match(runtimeSource, /typeof gameplayCore\.resolvePropulsionCoreStep === 'function'/);
  assert.match(runtimeSource, /typeof gameplayCore\.resolveIdleCreepThrustNormalized === 'function'/);
  assert.match(runtimeSource, /typeof gameplayCore\.resolveLongitudinalDynamicsStep === 'function'/);
  assert.match(runtimeSource, /typeof gameplayCore\.resolveAutomaticThrottleCommand === 'function'/);
  assert.match(runtimeSource, /propulsionCoreContract\.fullThrustAccelerationMps2 === normalAcceleration/);
  assert.match(runtimeSource, /driveTransmissionMode:\s*state\.driveTransmissionMode/);
  assert.match(runtimeSource, /automaticTransmissionEnabled:\s*automaticTransmissionEnabled\(\)/);
  assert.match(runtimeSource, /gearTorqueAvailability:\s*state\.gearTorqueAvailability/);
  assert.match(runtimeSource, /gearRpmCouplingNormalized:\s*state\.gearRpmCouplingNormalized/);
  assert.match(runtimeSource, /luggingSeverity:\s*state\.luggingSeverity/);
  assert.match(runtimeSource, /gearLugging:\s*state\.gearLugging/);
  assert.match(runtimeSource, /gearStalled:\s*state\.gearStalled/);
  assert.match(runtimeSource, /recommendedRecoveryGear:\s*state\.recommendedRecoveryGear/);
  assert.match(runtimeSource, /recoveryShiftCount:\s*state\.recoveryShiftCount/);
  assert.match(
    runtimeSource,
    /const propulsionCoreStateIds = Object\.freeze\(\[[\s\S]*?'idle'[\s\S]*?'creep'[\s\S]*?'shifting'[\s\S]*?'stalled'[\s\S]*?\]\)/
  );
  assert.match(runtimeSource, /if \(state\.gearStalled\) return 'stalled'/);
  assert.match(runtimeSource, /if \(state\.idleCreepActive\) return 'creep'/);
  assert.match(runtimeSource, /gearLoadNormalized:\s*state\.throttleCommand \* state\.luggingSeverity/);
  assert.match(runtimeSource, /speedLimitAlertEl\.dataset\.alertKind = alertKind/);
  assert.match(runtimeSource, /const gearAlertVisible = Boolean\(/);
  const propulsionStateSource = sourceBetween(
    runtimeSource,
    'function resolvePropulsionCoreState()',
    'const propulsionCoreStepScratch'
  );
  const propulsionState = {
    gearShiftTorqueCutActive: false,
    manualBrake: false,
    autoBrake: false,
    throttleCommand: 1,
    gearStalled: true,
    gearLugging: true,
    idleCreepActive: false,
    propulsionCoreSpool: 1,
    speed: 7 / 3.6
  };
  const classifyPropulsionState = new Function(
    'state',
    'longitudinalDynamicsContract',
    `'use strict';\n${propulsionStateSource}\nreturn resolvePropulsionCoreState;`
  )(propulsionState, gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT);
  assert.equal(classifyPropulsionState(), 'stalled');
  propulsionState.gearStalled = false;
  assert.equal(classifyPropulsionState(), 'lugging');
  propulsionState.throttleCommand = 0;
  propulsionState.gearLugging = false;
  propulsionState.idleCreepActive = true;
  propulsionState.speed = 0;
  assert.equal(classifyPropulsionState(), 'creep');
  propulsionState.manualBrake = true;
  assert.equal(classifyPropulsionState(), 'braking', 'braking must take precedence over idle creep');
  propulsionState.manualBrake = false;

  const longitudinal = sourceBetween(
    runtimeSource,
    'function updateLongitudinalControl(dt)',
    'const autoPlannerTargetHz'
  );
  assert.match(longitudinal, /gameplayCore\.resolvePropulsionCoreStep\(/);
  assert.match(longitudinal, /currentRpm:\s*state\.propulsionCoreRpm/);
  assert.match(longitudinal, /speedMps:\s*state\.speed/);
  assert.match(longitudinal, /throttleCommand/);
  assert.match(longitudinal, /braking/);
  assert.match(longitudinal, /idleCreepEnabled:\s*state\.grounded/);
  assert.match(longitudinal, /grounded:\s*state\.grounded/);
  assert.match(longitudinal, /maximumRpm:\s*state\.handling\.maximumRpm/);
  assert.match(
    longitudinal,
    /spoolUpRatePerSecond:\s*state\.handling\.spoolUpRatePerSecond/
  );
  assert.match(longitudinal, /averageAccelerationMps2/);
  assert.match(longitudinal, /const authority = longitudinalAuthorityMode\(\)/);
  assert.match(
    longitudinal,
    /state\.throttleCommand = braking[\s\S]*?\? 0[\s\S]*?: authority === 'player'[\s\S]*?: authority === 'full-throttle'[\s\S]*?\? 1[\s\S]*?: resolveAutopilotThrottleCommand\(propulsionGear\)/
  );
  assert.doesNotMatch(longitudinal, /gameplayCore\.resolveAutomaticThrottleCommand\(/);
  assert.match(longitudinal, /gameplayCore\.resolveLongitudinalDynamicsStep\(/);
  assert.match(longitudinal, /surfaceGrade:\s*state\.currentSurfaceGrade/);
  assert.match(longitudinal, /state\.rollingResistanceMps2 = longitudinalStep\.rollingResistanceMps2/);
  assert.match(longitudinal, /state\.linearDragMps2 = longitudinalStep\.linearDragMps2/);
  assert.match(longitudinal, /state\.aerodynamicDragMps2 = longitudinalStep\.aerodynamicDragMps2/);
  assert.match(longitudinal, /state\.gradeAccelerationMps2 = longitudinalStep\.gradeAccelerationMps2/);
  for (const idleField of [
    'idleCreepEnabled',
    'idleCreepConnected',
    'idleCreepActive',
    'idleCreepThrustNormalized'
  ]) {
    assert.match(
      longitudinal,
      new RegExp(`state\\.${idleField} = propulsionStep\\.${idleField}`),
      `runtime must publish the independent ${idleField} field from the propulsion core`
    );
  }
  assert.match(longitudinal, /opposingVariantReadinessRequiresBoundaryBrake\(\)/);
  assert.match(longitudinal, /\? 'opposing-boundary'/);
  assert.match(longitudinal, /\? 'obstacle'/);
  assert.match(longitudinal, /\? 'curve'/);
  assert.match(longitudinal, /state\.opposingVariantBoundaryStopped/);
  assert.match(longitudinal, /integratedSpeed > 0/);
  assert.match(longitudinal, /state\.speed = state\.opposingVariantBoundaryStopped \? 0 : integratedSpeed/);
  assert.doesNotMatch(longitudinal, /Boolean\(state\.opposingVariantReadinessGate\)/);
  assert.doesNotMatch(longitudinal, /opposing-variant-readiness'/);
  assert.doesNotMatch(longitudinal, /minimumDriveSpeed/);
  assert.doesNotMatch(longitudinal, /const minimumSpeed/);
  assert.doesNotMatch(longitudinal, /state\.speed\s*\+=\s*normalAcceleration\s*\*\s*dt/);
  assert.doesNotMatch(longitudinal, /state\.speed\s*-=\s*sharedBrakeDeceleration\s*\*\s*dt/);

  const state = {
    speed: 20,
    autoPilot: false,
    manualThrottleMode: true,
    cameraCinematicActive: false,
    driveTransmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode,
    manualBrake: false,
    manualAccelerating: false,
    driveGear: 1,
    pendingDriveGear: null,
    gearShiftRemainingSeconds: 0,
    gearShiftTorqueCutActive: false,
    gearShiftCount: 0,
    gearShiftRejectReason: null,
    gearShiftRejectPresentationUntil: 0,
    lastGearShiftRejectReason: null,
    autoBrake: false,
    autoBrakeReason: 'none',
    autoCurveBrakeRequest: false,
    autoCurveSpeedLimit: Number.POSITIVE_INFINITY,
    autoCurveDistance: Number.POSITIVE_INFINITY,
    autoObstacleBrakeRequest: false,
    throttleCommand: 0,
    propulsionCoreSpool: 0.8,
    propulsionCoreRpm: 10_000,
    propulsionThrustNormalized: 0,
    idleCreepEnabled: false,
    idleCreepConnected: false,
    idleCreepActive: false,
    idleCreepThrustNormalized: 0,
    gearTorqueAvailability: 1,
    gearRpmCouplingNormalized: 1,
    luggingSeverity: 0,
    gearLugging: false,
    gearStalled: false,
    recommendedRecoveryGear: 1,
    recoveryShiftCount: 0,
    opposingVariantReadinessGate: null,
    opposingVariantBoundaryStopped: false,
    opposingVariantReadinessBoundaryBrakeCount: 0,
    grounded: true,
    currentSurfaceGrade: 0,
    handling: {
      maximumRpm: 12_000,
      spoolUpRatePerSecond: 2.4
    },
    surfaceContact: { longitudinalDecelerationMps2: 0 }
  };
  let readinessBoundaryBraking = false;
  let curveBrakeRequest = false;
  const keys = { brake: false, throttle: false };
  const longitudinalAuthoritySource = sourceBetween(
    runtimeSource,
    'function longitudinalAuthorityMode()',
    '/** Report the actuator'
  );
  const autopilotThrottleSource = sourceBetween(
    runtimeSource,
    'function resolveAutopilotThrottleCommand(propulsionGear)',
    'const driveGearShiftRequestScratch'
  );
  const longitudinalHelpers = new Function(
    'state',
    'gameplayCore',
    'fairAutopilotContractSpeed',
    'cinematicAutopilotTargetSpeedMps',
    `'use strict';\n${longitudinalAuthoritySource}\n${autopilotThrottleSource}\n`
      + 'return { longitudinalAuthorityMode, resolveAutopilotThrottleCommand };'
  )(
    state,
    gameplayCore,
    gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps,
    260 / 3.6
  );
  const updateLongitudinalControl = new Function(
    'state',
    'keys',
    'updateCinematicJumpDrivePlan',
    'updateCurveDynamics',
    'requestCinematicDriveGear',
    'requestAutomaticDriveGear',
    'longitudinalAuthorityMode',
    'automaticDrivingAuthorityActive',
    'opposingVariantReadinessRequiresBoundaryBrake',
    'resolveAutopilotThrottleCommand',
    'gameplayCore',
    'propulsionCoreStepScratch',
    'longitudinalDynamicsStepScratch',
    'sharedBrakeDeceleration',
    'longitudinalDynamicsContract',
    'clamp',
    'surfaceForceContract',
    'driveGearContract',
    'driveGearTorqueStateScratch',
    'syncGearControlPresentation',
    'resolvePropulsionCoreState',
    `'use strict';\n${longitudinal}\nreturn updateLongitudinalControl;`
  )(
    state,
    keys,
    () => false,
    () => {
      state.autoCurveBrakeRequest = state.autoPilot && curveBrakeRequest;
    },
    () => false,
    () => false,
    longitudinalHelpers.longitudinalAuthorityMode,
    () => state.cameraCinematicActive || state.autoPilot,
    () => readinessBoundaryBraking,
    longitudinalHelpers.resolveAutopilotThrottleCommand,
    gameplayCore,
    {},
    {},
    gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.serviceBrakeDecelerationMps2,
    gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    { maximumLongitudinalDecelerationMps2: 1.2 },
    gameplayCore.DRIVE_GEAR_CONTRACT,
    {},
    () => {},
    () => 'test'
  );

  const speedBeforeCoast = state.speed;
  updateLongitudinalControl(1 / 60);
  assert.ok(state.speed < speedBeforeCoast, 'manual throttle release must coast under passive resistance');
  assert.ok(state.speed > 0, 'ordinary coasting must not teleport to zero');
  assert.equal(state.throttleCommand, 0);
  assert.ok(state.passiveResistanceMps2 > 0);
  assert.ok(state.longitudinalRequestedAccelerationMps2 < 0);
  assert.equal(state.autoBrake, false);
  assert.equal(state.autoBrakeReason, 'none');
  assert.equal(state.opposingVariantReadinessBoundaryBrakeCount, 0);

  const speedBeforeBoundaryBrake = state.speed;
  readinessBoundaryBraking = true;
  updateLongitudinalControl(1 / 60);
  assert.ok(state.speed < speedBeforeBoundaryBrake);
  assert.ok(state.speed > 0, 'entering the boundary envelope must brake physically, not teleport to zero');
  assert.equal(state.throttleCommand, 0);
  assert.equal(state.autoBrake, true);
  assert.equal(state.autoBrakeReason, 'opposing-boundary');
  assert.equal(
    state.brakeDecelerationMps2,
    gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.serviceBrakeDecelerationMps2
  );
  assert.equal(state.opposingVariantReadinessBoundaryBrakeCount, 1);

  readinessBoundaryBraking = false;
  state.speed = 0;
  state.propulsionCoreSpool = 0;
  state.propulsionCoreRpm = gameplayCore.PROPULSION_CORE_CONTRACT.idleRpm;
  state.opposingVariantBoundaryStopped = true;
  keys.throttle = true;
  updateLongitudinalControl(1 / 120);
  assert.ok(state.speed > 0, 'positive drive must release a stopped readiness boundary at 120Hz');
  assert.equal(state.opposingVariantBoundaryStopped, false);
  assert.ok(state.longitudinalRequestedAccelerationMps2 > 0);

  state.speed = 0;
  state.manualThrottleMode = true;
  state.propulsionCoreSpool = 0;
  state.propulsionCoreRpm = gameplayCore.PROPULSION_CORE_CONTRACT.idleRpm;
  state.opposingVariantBoundaryStopped = true;
  keys.throttle = false;
  updateLongitudinalControl(1 / 60);
  assert.ok(state.speed > 0, 'grounded Gear 1 must resume with real idle creep after readiness releases');
  assert.equal(state.throttleCommand, 0);
  assert.equal(state.opposingVariantBoundaryStopped, false);
  assert.equal(state.idleCreepEnabled, true);
  assert.equal(state.idleCreepConnected, true);
  assert.equal(state.idleCreepActive, true);
  assert.ok(state.idleCreepThrustNormalized > 0);
  assert.ok(state.propulsionThrustNormalized > 0);
  assert.ok(state.longitudinalRequestedAccelerationMps2 > 0);

  /** Reset only longitudinal controls so each driveline gate starts from the same true-zero packet. */
  const resetIdleGateCase = ({
    transmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode,
    gear = 1,
    grounded = true,
    braking = false
  } = {}) => {
    state.autoPilot = false;
    state.manualThrottleMode = true;
    state.driveTransmissionMode = transmissionMode;
    state.driveGear = gear;
    state.pendingDriveGear = null;
    state.gearShiftRemainingSeconds = 0;
    state.gearShiftTorqueCutActive = false;
    state.speed = 0;
    state.propulsionCoreSpool = 0;
    state.propulsionCoreRpm = gameplayCore.PROPULSION_CORE_CONTRACT.idleRpm;
    state.opposingVariantReadinessGate = null;
    state.opposingVariantBoundaryStopped = false;
    state.autoObstacleBrakeRequest = false;
    state.autoCurveBrakeRequest = false;
    state.grounded = grounded;
    readinessBoundaryBraking = false;
    curveBrakeRequest = false;
    keys.throttle = false;
    keys.brake = braking;
  };

  resetIdleGateCase({
    transmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode
  });
  updateLongitudinalControl(1 / 60);
  assert.equal(state.throttleCommand, 0, 'AT Gear 1 creep must remain independent from pedal command');
  assert.equal(state.idleCreepActive, true, 'AT and MT must share the same grounded Gear 1 idle load');
  assert.ok(state.speed > 0);

  resetIdleGateCase({ braking: true });
  updateLongitudinalControl(1 / 60);
  assert.equal(state.speed, 0, 'service braking must hold true zero against idle creep');
  assert.equal(state.propulsionThrustNormalized, 0);
  assert.equal(state.idleCreepConnected, false);
  assert.equal(state.idleCreepActive, false);
  assert.equal(state.idleCreepThrustNormalized, 0);

  resetIdleGateCase({ grounded: false });
  updateLongitudinalControl(1 / 60);
  assert.equal(state.speed, 0, 'airborne zero-pedal motion must not receive a hidden idle drive');
  assert.equal(state.idleCreepEnabled, false);
  assert.equal(state.idleCreepConnected, false);
  assert.equal(state.idleCreepActive, false);
  assert.equal(state.idleCreepThrustNormalized, 0);

  for (const gear of [2, 3]) {
    resetIdleGateCase({ gear });
    updateLongitudinalControl(1 / 60);
    assert.equal(state.speed, 0, `Gear ${gear} must remain stopped without pedal input`);
    assert.equal(state.idleCreepEnabled, true);
    assert.equal(state.idleCreepConnected, false);
    assert.equal(state.idleCreepActive, false);
    assert.equal(state.idleCreepThrustNormalized, 0);
    assert.equal(state.propulsionThrustNormalized, 0);
  }

  const cruiseTargetMps = gameplayCore.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps;
  const cruiseThrottle = gameplayCore.resolveAutomaticThrottleCommand(
    cruiseTargetMps,
    cruiseTargetMps,
    true,
    0,
    2
  );
  const resetAuthorityCase = ({ autoPilot, manualThrottleMode, throttle = false, speed = cruiseTargetMps }) => {
    state.autoPilot = autoPilot;
    state.manualThrottleMode = manualThrottleMode;
    state.cameraCinematicActive = false;
    state.grounded = true;
    state.speed = speed;
    state.driveTransmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode;
    state.driveGear = 2;
    state.pendingDriveGear = null;
    state.gearShiftRemainingSeconds = 0;
    state.opposingVariantReadinessGate = null;
    state.opposingVariantBoundaryStopped = false;
    state.autoObstacleBrakeRequest = false;
    state.autoCurveBrakeRequest = false;
    state.autoCurveSpeedLimit = Number.POSITIVE_INFINITY;
    state.autoCurveDistance = Number.POSITIVE_INFINITY;
    state.propulsionCoreSpool = cruiseThrottle;
    state.propulsionCoreRpm = gameplayCore.PROPULSION_CORE_CONTRACT.idleRpm
      + (gameplayCore.PROPULSION_CORE_CONTRACT.maximumRpm
        - gameplayCore.PROPULSION_CORE_CONTRACT.idleRpm) * cruiseThrottle;
    readinessBoundaryBraking = false;
    curveBrakeRequest = false;
    keys.brake = false;
    keys.throttle = throttle;
  };

  const authorityCases = [
    {
      label: 'P off / M off keeps W as the sole throttle owner',
      autoPilot: false,
      manualThrottleMode: true,
      authority: 'player',
      expectedThrottle: 0
    },
    {
      label: 'P off / M on holds uncapped full throttle',
      autoPilot: false,
      manualThrottleMode: false,
      authority: 'full-throttle',
      expectedThrottle: 1
    },
    {
      label: 'P on / M off gives propulsion to autopilot',
      autoPilot: true,
      manualThrottleMode: true,
      authority: 'autopilot',
      expectedThrottle: cruiseThrottle
    },
    {
      label: 'P on / M on leaves the same autopilot owner',
      autoPilot: true,
      manualThrottleMode: false,
      authority: 'autopilot',
      expectedThrottle: cruiseThrottle
    }
  ];
  for (const authorityCase of authorityCases) {
    resetAuthorityCase(authorityCase);
    assert.equal(longitudinalHelpers.longitudinalAuthorityMode(), authorityCase.authority);
    updateLongitudinalControl(1 / 60);
    assert.ok(
      Math.abs(state.throttleCommand - authorityCase.expectedThrottle) < 0.000_000_001,
      authorityCase.label
    );
  }

  resetAuthorityCase({ autoPilot: false, manualThrottleMode: true, throttle: true });
  updateLongitudinalControl(1 / 60);
  assert.equal(state.throttleCommand, 1, 'W must still command full throttle under sole player authority');

  resetAuthorityCase({
    autoPilot: false,
    manualThrottleMode: false,
    speed: 200 / 3.6
  });
  updateLongitudinalControl(1 / 60);
  assert.equal(
    state.throttleCommand,
    1,
    'P-off M throttle must remain fully pressed above the old 120km/h controller target'
  );

  for (const authorityCase of authorityCases) {
    resetAuthorityCase(authorityCase);
    state.throttleCommand = 1;
    keys.brake = true;
    updateLongitudinalControl(1 / 60);
    assert.equal(state.throttleCommand, 0, `${authorityCase.label}: braking must cut throttle first`);
    assert.equal(state.manualBrake, true);
    assert.equal(state.propulsionThrustNormalized, 0);
    assert.equal(state.idleCreepActive, false);
    assert.equal(state.idleCreepThrustNormalized, 0);
  }

  for (const manualThrottleMode of [true, false]) {
    resetAuthorityCase({ autoPilot: true, manualThrottleMode });
    state.autoObstacleBrakeRequest = true;
    curveBrakeRequest = true;
    updateLongitudinalControl(1 / 60);
    assert.equal(state.autoBrake, true);
    assert.equal(state.autoBrakeReason, 'obstacle');
    assert.equal(state.throttleCommand, 0, 'P obstacle braking must pre-empt either stored M preference');
    assert.equal(state.brakeDecelerationMps2, 7.5);
  }

  resetAuthorityCase({ autoPilot: true, manualThrottleMode: true });
  curveBrakeRequest = true;
  updateLongitudinalControl(1 / 60);
  assert.equal(state.autoBrake, true);
  assert.equal(state.autoBrakeReason, 'curve');
  assert.equal(state.throttleCommand, 0);

  resetAuthorityCase({ autoPilot: true, manualThrottleMode: false });
  state.autoObstacleBrakeRequest = true;
  curveBrakeRequest = true;
  readinessBoundaryBraking = true;
  updateLongitudinalControl(1 / 60);
  assert.equal(state.autoBrakeReason, 'opposing-boundary');
  assert.equal(state.throttleCommand, 0);

  resetAuthorityCase({ autoPilot: false, manualThrottleMode: false });
  state.autoObstacleBrakeRequest = true;
  curveBrakeRequest = true;
  updateLongitudinalControl(1 / 60);
  assert.equal(state.autoBrake, false, 'stale P evidence must not brake after P releases authority');
  assert.equal(state.autoBrakeReason, 'none');
  assert.equal(state.throttleCommand, 1);

  // MT + M holds full throttle in Gear 3, but it may neither secretly return to Gear 2 nor bypass lugging.
  state.autoPilot = false;
  state.driveTransmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode;
  state.manualThrottleMode = false;
  state.driveGear = 3;
  state.pendingDriveGear = null;
  state.gearShiftRemainingSeconds = 0;
  state.speed = 100 / 3.6;
  state.propulsionCoreSpool = 1;
  state.propulsionCoreRpm = gameplayCore.PROPULSION_CORE_CONTRACT.maximumRpm;
  keys.throttle = false;
  const speedBeforeManualTransmissionLug = state.speed;
  updateLongitudinalControl(1 / 60);
  assert.equal(state.driveGear, 3);
  assert.equal(state.pendingDriveGear, null);
  assert.equal(state.throttleCommand, 1, 'M throttle must remain full without acquiring MT shift authority');
  assert.equal(state.gearLugging, true);
  assert.ok(state.gearRpmCouplingNormalized > 0 && state.gearRpmCouplingNormalized < 1);
  assert.ok(state.luggingSeverity > 0 && state.luggingSeverity < 1);
  assert.equal(state.recommendedRecoveryGear, 2);
  assert.equal(state.recoveryShiftCount, 1);
  assert.ok(state.speed < speedBeforeManualTransmissionLug);

  // A hard third-gear stall keeps the manual selection but cuts drive, loads RPM, and recommends both Q shifts.
  state.autoPilot = false;
  state.manualThrottleMode = true;
  state.driveGear = 3;
  state.speed = 7 / 3.6;
  state.propulsionCoreSpool = 1;
  state.propulsionCoreRpm = gameplayCore.PROPULSION_CORE_CONTRACT.maximumRpm;
  keys.throttle = true;
  const hardStallSpeed = state.speed;
  updateLongitudinalControl(1 / 60);
  assert.equal(state.gearTorqueAvailability, 0);
  assert.equal(state.gearRpmCouplingNormalized, 0);
  assert.equal(state.luggingSeverity, 1);
  assert.equal(state.gearLugging, true);
  assert.equal(state.gearStalled, true);
  assert.equal(state.recommendedRecoveryGear, 1);
  assert.equal(state.recoveryShiftCount, 2);
  assert.equal(state.propulsionThrustNormalized, 0);
  assert.equal(state.idleCreepConnected, false);
  assert.equal(state.idleCreepActive, false);
  assert.equal(state.idleCreepThrustNormalized, 0);
  assert.ok(state.propulsionCoreRpm < gameplayCore.PROPULSION_CORE_CONTRACT.maximumRpm);
  assert.ok(state.speed < hardStallSpeed);

  // Automatic Gear 3 is a normal performance gear: player W keeps full propulsion above the downshift band.
  state.driveTransmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode;
  state.manualThrottleMode = true;
  state.driveGear = 3;
  state.pendingDriveGear = null;
  state.gearShiftRemainingSeconds = 0;
  state.speed = 260 / 3.6;
  keys.throttle = true;
  const speedBeforeAutomaticThirdGearDrive = state.speed;
  updateLongitudinalControl(1 / 60);
  assert.equal(state.throttleCommand, 1);
  assert.equal(state.driveGear, 3);
  assert.equal(state.pendingDriveGear, null);
  assert.ok(state.speed > speedBeforeAutomaticThirdGearDrive);
  keys.throttle = false;

  state.manualThrottleMode = true;
  state.driveTransmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode;
  state.speed = 70 / 3.6;
  state.driveGear = 1;
  state.pendingDriveGear = 2;
  state.gearShiftRemainingSeconds = 1 / 60;
  state.gearShiftRejectReason = 'shift-in-progress';
  state.gearShiftRejectPresentationUntil = 9_999;
  state.lastGearShiftRejectReason = 'shift-in-progress';
  updateLongitudinalControl(1 / 60);
  assert.equal(state.driveGear, 2);
  assert.equal(state.pendingDriveGear, null);
  assert.equal(state.gearShiftRejectReason, null, 'completed shift must clear the live rejected state');
  assert.equal(state.gearShiftRejectPresentationUntil, 0);
  assert.equal(
    state.lastGearShiftRejectReason,
    'shift-in-progress',
    'completed shift must retain historical rejection evidence separately'
  );

  const coreStep = sourceBetween(
    gameplayCoreSource,
    'function resolvePropulsionCoreStep(input, dt, target = {})',
    'function resolveLongitudinalResistance(speedMps, grounded = true, target = {})'
  );
  assert.match(coreStep, /const braking = Boolean\(/);
  assert.match(coreStep, /const targetSpool = braking \|\| \(shifting && poweredSeconds <= EPSILON\) \? 0 : throttleCommand/);
  assert.match(
    coreStep,
    /const idleCreepThrustNormalized = idleCreep\.thrustNormalized \* gearTorqueAvailability/
  );
  assert.match(
    coreStep,
    /const averageIdleCreepThrustNormalized = idleCreepThrustNormalized[\s\S]*?\* idleCreepIntervalFraction/
  );
  assert.match(
    coreStep,
    /const thrustNormalized = clamp\([\s\S]*?commandedThrustNormalized \* gearTorqueAvailability \+ idleCreepThrustNormalized/
  );
  assert.match(
    coreStep,
    /const averageThrustNormalized = clamp\([\s\S]*?averageCommandedThrustNormalized \* gearTorqueAvailability[\s\S]*?\+ averageIdleCreepThrustNormalized/
  );
  assert.match(coreStep, /target\.averageAccelerationMps2 = averageThrustNormalized/);
  assert.match(coreStep, /target\.gearLugging = speedProvided && gearTorque\.lugging/);

  const accelerationPublisherSource = sourceBetween(
    runtimeSource,
    'function publishLongitudinalNetAcceleration(previousSpeed, dt)',
    '/**\n   * Keep longitudinal authority exclusive'
  );
  const publishLongitudinalNetAcceleration = new Function(
    'state',
    `'use strict';\n${accelerationPublisherSource}\nreturn publishLongitudinalNetAcceleration;`
  )(state);
  state.speed = 0;
  assert.ok(
    Math.abs(publishLongitudinalNetAcceleration(120, 0.045) + 2_666.666_666_666_666_5)
      < 0.000_000_001
  );
  const gameplayStep = sourceBetween(
    runtimeSource,
    'function advanceGameplayStep(dt, now)',
    'function animate()'
  );
  assert.ok(
    gameplayStep.indexOf('updatePlayer(dt, now)')
      < gameplayStep.lastIndexOf('publishLongitudinalNetAcceleration(previousSpeed, dt)'),
    'the final substep speed constraint must republish truthful net acceleration'
  );
});

test('shift rejection HUD lease expires on wall-clock time without erasing diagnostics', () => {
  const expirySource = sourceBetween(
    runtimeSource,
    'function expireGearShiftRejectPresentation(now)',
    'function syncGearControlPresentation()'
  );
  const state = {
    gearShiftRejectReason: 'underspeed',
    gearShiftRejectPresentationUntil: 2_600,
    lastGearShiftRejectReason: 'underspeed',
    gearShiftRejectCount: 1
  };
  let presentationSyncCount = 0;
  const expirePresentation = new Function(
    'state',
    'syncGearControlPresentation',
    `'use strict';\n${expirySource}\nreturn expireGearShiftRejectPresentation;`
  )(state, () => { presentationSyncCount++; });

  assert.equal(expirePresentation(2_599.999), false);
  assert.equal(state.gearShiftRejectReason, 'underspeed');
  assert.equal(presentationSyncCount, 0);
  assert.equal(expirePresentation(2_600), true);
  assert.equal(state.gearShiftRejectReason, null);
  assert.equal(state.gearShiftRejectPresentationUntil, 0);
  assert.equal(state.lastGearShiftRejectReason, 'underspeed');
  assert.equal(state.gearShiftRejectCount, 1);
  assert.equal(presentationSyncCount, 1);
  assert.equal(expirePresentation(9_000), false, 'an expired notice must not resync every frame');
  assert.equal(presentationSyncCount, 1);

  const animationSource = sourceBetween(
    runtimeSource,
    'function animate()',
    "startBtn.addEventListener('click'"
  );
  assert.equal(
    (animationSource.match(/expireGearShiftRejectPresentation\(now\)/g) || []).length,
    1,
    'every RAF, including pause frames, must expire the wall-clock presentation lease once'
  );
});

test('MT/AT gear authority stays independent from both M throttle states', () => {
  const gearControlSource = sourceBetween(
    runtimeSource,
    'function requestDriveGear(requestedGear, source = \'manual\')',
    '/**\n   * Classify the same end-of-step propulsion state'
  );
  const state = {
    speed: 70 / 3.6,
    manualThrottleMode: true,
    driveTransmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode,
    driveGear: 1,
    pendingDriveGear: null,
    gearShiftRemainingSeconds: 0,
    gearShiftTorqueCutActive: false,
    gearShiftSource: 'reset',
    gearShiftRejectReason: null,
    gearShiftRejectPresentationUntil: 0,
    lastGearShiftRejectReason: null,
    gearShiftRejectCount: 0
  };
  let presentationNow = 10_000;
  let presentationSyncCount = 0;
  const controls = new Function(
    'state',
    'gameplayCore',
    'driveGearContract',
    'driveGearShiftRequestScratch',
    'automaticDriveGearDecisionScratch',
    'automaticTransmissionEnabled',
    'syncGearControlPresentation',
    'gearShiftRejectPresentationMilliseconds',
    'performance',
    `'use strict';\n${gearControlSource}\nreturn { requestDriveGear, requestAutomaticDriveGear };`
  )(
    state,
    gameplayCore,
    gameplayCore.DRIVE_GEAR_CONTRACT,
    {},
    {},
    () => state.driveTransmissionMode === gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode,
    () => { presentationSyncCount++; },
    1_600,
    { now: () => presentationNow }
  );

  const resetShiftState = ({
    transmissionMode,
    manualThrottleMode,
    driveGear = 1,
    speedKmh = 70
  }) => Object.assign(state, {
    speed: speedKmh / 3.6,
    manualThrottleMode,
    driveTransmissionMode: transmissionMode,
    driveGear,
    pendingDriveGear: null,
    gearShiftRemainingSeconds: 0,
    gearShiftTorqueCutActive: false,
    gearShiftSource: 'reset',
    gearShiftRejectReason: null,
    gearShiftRejectPresentationUntil: 0
  });

  const manualMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode;
  const automaticMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode;

  // M changes longitudinal throttle authority only: MT accepts the same Q/E request with M off or on.
  for (const manualThrottleMode of [true, false]) {
    resetShiftState({ transmissionMode: manualMode, manualThrottleMode });
    const speedBeforeShift = state.speed;
    assert.equal(controls.requestDriveGear(2, 'manual-keyboard'), true);
    assert.equal(state.speed, speedBeforeShift, 'accepted MT upshift must not teleport speed');
    assert.equal(state.pendingDriveGear, 2);
    assert.equal(state.manualThrottleMode, manualThrottleMode);
  }

  // AT rejects player Q/E in both throttle modes; its schedule remains the only road-gear authority.
  for (const manualThrottleMode of [true, false]) {
    resetShiftState({ transmissionMode: automaticMode, manualThrottleMode });
    assert.equal(controls.requestDriveGear(2, 'manual-keyboard'), false);
    assert.equal(state.pendingDriveGear, null);
    assert.equal(state.gearShiftRejectReason, 'automatic');
    assert.equal(state.gearShiftRejectPresentationUntil, presentationNow + 1_600);
    assert.equal(state.manualThrottleMode, manualThrottleMode);
  }

  // The four MT/AT × M combinations therefore make identical transmission decisions within each T mode.
  for (const manualThrottleMode of [true, false]) {
    resetShiftState({
      transmissionMode: manualMode,
      manualThrottleMode,
      speedKmh: 90
    });
    assert.equal(controls.requestAutomaticDriveGear(), false);
    assert.equal(state.pendingDriveGear, null);

    resetShiftState({
      transmissionMode: automaticMode,
      manualThrottleMode,
      speedKmh: 90
    });
    assert.equal(controls.requestAutomaticDriveGear(), true);
    assert.equal(state.pendingDriveGear, 2);
    assert.equal(state.gearShiftSource, 'automatic-upshift');
  }

  resetShiftState({ transmissionMode: manualMode, manualThrottleMode: true });
  assert.equal(controls.requestDriveGear(2, 'manual-keyboard'), true);
  assert.equal(state.gearShiftRemainingSeconds, 0.3);
  assert.equal(controls.requestDriveGear(2, 'manual-keyboard'), false);
  assert.equal(state.gearShiftRejectReason, 'shift-in-progress');
  assert.equal(state.gearShiftRejectPresentationUntil, presentationNow + 1_600);
  assert.equal(state.lastGearShiftRejectReason, 'shift-in-progress');
  assert.equal(state.speed, 70 / 3.6, 'rejected in-progress shift must preserve speed');

  resetShiftState({
    transmissionMode: manualMode,
    manualThrottleMode: false,
    driveGear: 2,
    speedKmh: 139
  });
  assert.equal(controls.requestDriveGear(3, 'manual-keyboard'), false);
  assert.equal(state.gearShiftRejectReason, 'underspeed');
  assert.equal(state.gearShiftRejectPresentationUntil, presentationNow + 1_600);
  assert.equal(state.speed, 139 / 3.6);
  presentationNow += 450;
  assert.equal(controls.requestDriveGear(3, 'manual-keyboard'), false);
  assert.equal(
    state.gearShiftRejectPresentationUntil,
    presentationNow + 1_600,
    'a new rejected action must restart the full readable lease'
  );
  state.speed = 140 / 3.6;
  assert.equal(controls.requestDriveGear(3, 'manual-keyboard'), true);
  assert.equal(state.speed, 140 / 3.6);
  assert.equal(state.gearShiftRejectPresentationUntil, 0);

  resetShiftState({
    transmissionMode: manualMode,
    manualThrottleMode: false,
    driveGear: 3,
    speedKmh: 191
  });
  assert.equal(controls.requestDriveGear(2, 'manual-keyboard'), false);
  assert.equal(state.gearShiftRejectReason, 'overspeed');
  assert.equal(state.gearShiftRejectPresentationUntil, presentationNow + 1_600);
  assert.equal(state.speed, 191 / 3.6, 'unsafe downshift rejection must preserve speed');

  resetShiftState({
    transmissionMode: automaticMode,
    manualThrottleMode: false,
    driveGear: 1,
    speedKmh: 0
  });
  const automaticUpshift = gameplayCore.DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear;
  const automaticDownshift = gameplayCore.DRIVE_GEAR_CONTRACT.automaticDownshiftSpeedMpsByGear;
  state.speed = automaticUpshift[1] - 0.001;
  assert.equal(controls.requestAutomaticDriveGear(), false);
  assert.equal(state.pendingDriveGear, null);
  state.speed = automaticUpshift[1];
  assert.equal(controls.requestAutomaticDriveGear(), true);
  assert.equal(state.pendingDriveGear, 2);
  assert.equal(state.gearShiftSource, 'automatic-upshift');
  state.driveGear = 2;
  state.pendingDriveGear = null;
  state.gearShiftRemainingSeconds = 0;
  state.speed = automaticUpshift[2] - 0.001;
  assert.equal(controls.requestAutomaticDriveGear(), false);
  assert.equal(state.pendingDriveGear, null);
  state.speed = automaticUpshift[2];
  assert.equal(controls.requestAutomaticDriveGear(), true);
  assert.equal(state.pendingDriveGear, 3);
  assert.equal(state.gearShiftSource, 'automatic-upshift');
  state.driveGear = 3;
  state.pendingDriveGear = null;
  state.gearShiftRemainingSeconds = 0;
  state.speed = automaticDownshift[3] + 0.001;
  assert.equal(controls.requestAutomaticDriveGear(), false);
  assert.equal(state.pendingDriveGear, null);
  state.speed = automaticDownshift[3];
  assert.equal(controls.requestAutomaticDriveGear(), true);
  assert.equal(state.pendingDriveGear, 2);
  assert.equal(state.gearShiftSource, 'automatic-downshift');
  state.driveGear = 2;
  state.pendingDriveGear = null;
  state.gearShiftRemainingSeconds = 0;
  state.speed = automaticDownshift[2] + 0.001;
  assert.equal(controls.requestAutomaticDriveGear(), false);
  assert.equal(state.pendingDriveGear, null);
  state.speed = automaticDownshift[2];
  assert.equal(controls.requestAutomaticDriveGear(), true);
  assert.equal(state.pendingDriveGear, 1);
  assert.equal(state.gearShiftSource, 'automatic-downshift');
  assert.ok(presentationSyncCount >= 10);

  assert.doesNotMatch(gearControlSource, /manualThrottleMode/);
  assert.match(
    runtimeSource,
    /function automaticTransmissionEnabled\(\)[\s\S]*?state\.driveTransmissionMode === driveTransmissionContract\.automaticMode/
  );
});

test('desktop and touch gear indicators expose shifting, rejection, automatic Gear 3, and MT lugging', () => {
  const presentationSource = sourceBetween(
    runtimeSource,
    'function syncGearControlPresentation()',
    '/** Request one adjacent physical shift'
  );
  const document = { activeElement: null, documentElement: { dataset: {} } };
  const makeElement = () => ({
    textContent: '',
    dataset: {},
    disabled: false,
    hidden: false,
    inert: false,
    clickCount: 0,
    focusCount: 0,
    lastFocusOptions: null,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    click() {
      // The harness models native activation eligibility; AT-hidden and disabled controls must be inert.
      if (!this.hidden && !this.inert && !this.disabled) this.clickCount++;
    },
    focus(options) {
      this.focusCount++;
      this.lastFocusOptions = options;
      document.activeElement = this;
    }
  });
  const gearIndicator = makeElement();
  const mobileGearIndicator = makeElement();
  const gearDownBtn = makeElement();
  const mobileGearDownBtn = makeElement();
  const gearUpBtn = makeElement();
  const mobileGearUpBtn = makeElement();
  const transmissionModeBtn = makeElement();
  const mobileTransmissionModeBtn = makeElement();
  const transmissionSelector = makeElement();
  const transmissionRangePanel = makeElement();
  const mobileTransmissionSelector = makeElement();
  const gearOperatingRange = makeElement();
  const mobileGearOperatingRange = makeElement();
  const state = {
    driveGear: 1,
    pendingDriveGear: null,
    gearShiftRemainingSeconds: 0,
    gearShiftRejectReason: null,
    lastGearShiftRejectReason: null,
    driveTransmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode,
    gearTorqueAvailability: 1,
    gearRpmCouplingNormalized: 1,
    luggingSeverity: 0,
    gearLugging: false,
    gearStalled: false,
    recommendedRecoveryGear: 1,
    recoveryShiftCount: 0
  };
  const localizedText = {
    'gear.shiftState.engaged': '已接合',
    'gear.rejection.underspeed': '速度不足，拒绝升挡',
    'gear.rejectionShort.underspeed': '速度不足',
    'gear.operatingRange.1': '1挡 · 推荐 0–90 · E→2 ≥70',
    'gear.operatingRange.2': '2挡 · 推荐 70–140 · Q→1 ≤125 · E→3 ≥140',
    'gear.operatingRange.3': '3挡 · 推荐 140–280 · Q→2 ≤190',
    'gear.performanceLabel': '{gear}挡 · 高速/跳台',
    'gear.automaticRange.3': 'AT · 3挡 · ≤120 自动降2',
    'gear.operatingRangeAria.1': '1挡工作范围',
    'gear.operatingRangeAria.2': '2挡工作范围',
    'gear.operatingRangeAria.3': '3挡工作范围',
    'gear.automaticRangeAria.3': '自动变速箱3挡；降至每小时120公里时自动回2挡',
    'gear.luggingLabel': '拖挡 · Q→{gear}挡',
    'gear.luggingAria': '高挡速度过低，请按 Q 降至{gear}挡',
    'gear.stalledLabel.single': '失速 · Q→{gear}挡',
    'gear.stalledLabel.multiple': '失速 · Q×{count}→{gear}挡',
    'gear.stalledAria.single': '高挡失速，请按 Q 降至{gear}挡',
    'gear.stalledAria.multiple': '高挡失速，请连续按 Q {count} 次降至{gear}挡'
  };
  const syncPresentation = new Function(
    'state',
    'driveGearContract',
    'uiText',
    'uiNumber',
    'clamp',
    'automaticTransmissionEnabled',
    'gearIndicator',
    'mobileGearIndicator',
    'transmissionSelector',
    'transmissionRangePanel',
    'mobileTransmissionSelector',
    'gearOperatingRange',
    'mobileGearOperatingRange',
    'gearDownBtn',
    'mobileGearDownBtn',
    'gearUpBtn',
    'mobileGearUpBtn',
    'transmissionModeBtn',
    'mobileTransmissionModeBtn',
    'document',
    `'use strict';\n${presentationSource}\nreturn syncGearControlPresentation;`
  )(
    state,
    gameplayCore.DRIVE_GEAR_CONTRACT,
    (key, parameters, fallback) => {
      if (key === 'gear.label') return `${parameters.gear}挡`;
      if (key === 'gear.shiftState.shifting') return `${parameters.from} → ${parameters.to}`;
      if (key === 'gear.indicatorAria') return `挡位${parameters.gear}，${parameters.state}`;
      const template = localizedText[key] ?? fallback;
      return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => (
        parameters?.[name] ?? ''
      ));
    },
    (value) => String(value),
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    () => state.driveTransmissionMode === gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode,
    gearIndicator,
    mobileGearIndicator,
    transmissionSelector,
    transmissionRangePanel,
    mobileTransmissionSelector,
    gearOperatingRange,
    mobileGearOperatingRange,
    gearDownBtn,
    mobileGearDownBtn,
    gearUpBtn,
    mobileGearUpBtn,
    transmissionModeBtn,
    mobileTransmissionModeBtn,
    document
  );

  assert.equal(syncPresentation(), 'engaged');
  assert.equal(document.documentElement.dataset.driveTransmissionMode, 'manual');
  assert.equal(gearIndicator.textContent, '1挡');
  assert.equal(mobileGearIndicator.textContent, '1挡');
  assert.equal(gearOperatingRange.textContent, '1挡 · 推荐 0–90 · E→2 ≥70');
  assert.equal(mobileGearOperatingRange.textContent, '1挡 · 推荐 0–90 · E→2 ≥70');
  for (const button of [gearDownBtn, mobileGearDownBtn, gearUpBtn, mobileGearUpBtn]) {
    assert.equal(button.hidden, false, 'MT must keep both adjacent-shift controls in layout');
    assert.equal(button.inert, false, 'MT must keep both adjacent-shift controls interactive when eligible');
    assert.equal(button.attributes['aria-hidden'], 'false');
  }

  state.pendingDriveGear = 2;
  state.gearShiftRemainingSeconds = 0.3;
  assert.equal(syncPresentation(), 'shifting');
  assert.equal(gearIndicator.textContent, '1→2');
  assert.equal(mobileGearIndicator.textContent, '1→2');
  assert.equal(gearIndicator.dataset.shiftState, 'shifting');

  state.pendingDriveGear = null;
  state.gearShiftRemainingSeconds = 0;
  state.gearShiftRejectReason = 'underspeed';
  assert.equal(syncPresentation(), 'rejected');
  assert.equal(gearIndicator.textContent, '1挡 · 速度不足');
  assert.equal(mobileGearIndicator.textContent, '1挡 · 速度不足');
  assert.equal(gearIndicator.dataset.shiftState, 'rejected');

  state.lastGearShiftRejectReason = 'underspeed';
  state.gearShiftRejectReason = null;
  assert.equal(syncPresentation(), 'engaged');
  assert.equal(document.documentElement.dataset.driveTransmissionMode, 'manual');
  assert.equal(gearIndicator.textContent, '1挡');
  assert.equal(mobileGearIndicator.textContent, '1挡');
  assert.doesNotMatch(gearIndicator.attributes['aria-label'], /速度不足|拒绝/);

  state.driveGear = 3;
  state.driveTransmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode;
  document.activeElement = mobileGearUpBtn;
  assert.equal(syncPresentation(), 'engaged');
  assert.equal(document.documentElement.dataset.driveTransmissionMode, 'automatic');
  assert.equal(gearIndicator.textContent, '3挡 · 高速/跳台');
  assert.equal(mobileGearIndicator.textContent, '3挡 · 高速/跳台');
  assert.equal(gearIndicator.dataset.shiftState, 'engaged');
  assert.equal(gearOperatingRange.textContent, 'AT · 3挡 · ≤120 自动降2');
  assert.equal(gearDownBtn.disabled, true);
  assert.equal(gearUpBtn.disabled, true);
  assert.equal(document.activeElement, mobileTransmissionModeBtn);
  assert.equal(mobileTransmissionModeBtn.focusCount, 1);
  assert.deepEqual(mobileTransmissionModeBtn.lastFocusOptions, { preventScroll: true });
  assert.equal(transmissionModeBtn.focusCount, 0);
  for (const button of [gearDownBtn, mobileGearDownBtn, gearUpBtn, mobileGearUpBtn]) {
    assert.equal(button.hidden, true, 'AT must remove manual Q/E controls from layout');
    assert.equal(button.inert, true, 'AT-hidden Q/E controls must not receive pointer activation');
    assert.equal(button.attributes['aria-hidden'], 'true');
    button.click();
    assert.equal(button.clickCount, 0, 'AT-hidden Q/E controls must not synthesize a shift click');
  }
  const automaticLayoutSignature = [
    transmissionSelector.dataset.transmissionMode,
    transmissionRangePanel.dataset.transmissionMode,
    mobileTransmissionSelector.dataset.transmissionMode,
    gearDownBtn.hidden,
    mobileGearDownBtn.hidden,
    gearUpBtn.hidden,
    mobileGearUpBtn.hidden
  ];
  assert.equal(syncPresentation(), 'engaged');
  assert.deepEqual([
    transmissionSelector.dataset.transmissionMode,
    transmissionRangePanel.dataset.transmissionMode,
    mobileTransmissionSelector.dataset.transmissionMode,
    gearDownBtn.hidden,
    mobileGearDownBtn.hidden,
    gearUpBtn.hidden,
    mobileGearUpBtn.hidden
  ], automaticLayoutSignature, 'repeated AT projection must be idempotent');

  state.driveGear = 2;
  state.driveTransmissionMode = gameplayCore.DRIVE_TRANSMISSION_CONTRACT.manualMode;
  const secondGearLugging = gameplayCore.resolveDriveGearTorqueAvailability(
    2,
    50 / 3.6,
    {}
  );
  state.gearTorqueAvailability = secondGearLugging.torqueAvailability;
  state.gearRpmCouplingNormalized = secondGearLugging.speedCouplingNormalized;
  state.luggingSeverity = secondGearLugging.luggingSeverity;
  state.gearLugging = secondGearLugging.lugging;
  state.gearStalled = secondGearLugging.stalled;
  state.recommendedRecoveryGear = secondGearLugging.recommendedRecoveryGear;
  state.recoveryShiftCount = secondGearLugging.recoveryShiftCount;
  assert.equal(syncPresentation(), 'lugging');
  assert.equal(document.documentElement.dataset.driveTransmissionMode, 'manual');
  assert.equal(gearIndicator.textContent, '2挡 · 拖挡 · Q→1挡');
  assert.equal(mobileGearIndicator.textContent, '2挡 · 拖挡 · Q→1挡');
  assert.equal(
    gearOperatingRange.textContent,
    '2挡 · 推荐 70–140 · Q→1 ≤125 · E→3 ≥140 · 拖挡 · Q→1挡'
  );
  assert.equal(gearIndicator.dataset.shiftState, 'lugging');
  assert.equal(transmissionSelector.dataset.lugging, 'true');
  assert.equal(transmissionRangePanel.dataset.lugging, 'true');
  assert.equal(mobileTransmissionSelector.dataset.lugging, 'true');
  assert.equal(gearIndicator.dataset.recommendedRecoveryGear, '1');
  assert.equal(gearIndicator.dataset.recoveryShiftCount, '1');
  assert.equal(
    gearIndicator.dataset.gearRpmCouplingNormalized,
    secondGearLugging.speedCouplingNormalized.toFixed(6)
  );
  assert.equal(gearDownBtn.disabled, false, 'MT must keep Q available so the player can recover from lugging');
  assert.equal(gearUpBtn.disabled, false, 'MT must restore E when the next gear is physically available');
  for (const button of [gearDownBtn, mobileGearDownBtn, gearUpBtn, mobileGearUpBtn]) {
    assert.equal(button.hidden, false, 'returning to MT must restore Q/E to layout');
    assert.equal(button.inert, false, 'returning to MT must restore eligible Q/E pointer ownership');
    assert.equal(button.attributes['aria-hidden'], 'false');
  }
  assert.doesNotMatch(presentationSource, /addEventListener/, 'presentation replay must not bind duplicate handlers');
  for (const binding of [
    "gearDownBtn.addEventListener('click', () => requestDriveGear(state.driveGear - 1, 'desktop-button'))",
    "mobileGearDownBtn.addEventListener('click', () => requestDriveGear(state.driveGear - 1, 'touch-button'))",
    "gearUpBtn.addEventListener('click', () => requestDriveGear(state.driveGear + 1, 'desktop-button'))",
    "mobileGearUpBtn.addEventListener('click', () => requestDriveGear(state.driveGear + 1, 'touch-button'))"
  ]) {
    assert.equal(runtimeSource.split(binding).length - 1, 1, `${binding} must bind exactly once`);
  }

  const thirdGearStall = gameplayCore.resolveDriveGearTorqueAvailability(3, 7 / 3.6, {});
  state.driveGear = 3;
  state.gearTorqueAvailability = thirdGearStall.torqueAvailability;
  state.gearRpmCouplingNormalized = thirdGearStall.speedCouplingNormalized;
  state.luggingSeverity = thirdGearStall.luggingSeverity;
  state.gearLugging = thirdGearStall.lugging;
  state.gearStalled = thirdGearStall.stalled;
  state.recommendedRecoveryGear = thirdGearStall.recommendedRecoveryGear;
  state.recoveryShiftCount = thirdGearStall.recoveryShiftCount;
  assert.equal(syncPresentation(), 'stalled');
  assert.equal(gearIndicator.textContent, '3挡 · 高速/跳台 · 失速 · Q×2→1挡');
  assert.equal(gearIndicator.dataset.shiftState, 'stalled');
  assert.equal(gearIndicator.dataset.stalled, 'true');
  assert.equal(gearIndicator.dataset.recommendedRecoveryGear, '1');
  assert.equal(gearIndicator.dataset.recoveryShiftCount, '2');
  assert.match(gearIndicator.attributes['aria-label'], /连续按 Q 2 次降至1挡/);
});

test('high-gear stall preempts curve advice in the shared desktop and mobile centre alert', () => {
  const alertSource = sourceBetween(
    runtimeSource,
    'function updateSpeedLimitAlert()',
    '/** Attribute each live command'
  );
  const makeClassList = () => {
    const values = new Set();
    return {
      remove(...names) { for (const name of names) values.delete(name); },
      toggle(name, force) {
        if (force) values.add(name);
        else values.delete(name);
      },
      contains(name) { return values.has(name); }
    };
  };
  const makeElement = () => {
    let textContent = '';
    return {
      textWriteCount: 0,
      get textContent() { return textContent; },
      set textContent(value) {
        textContent = String(value);
        this.textWriteCount++;
      },
      hidden: true,
      dataset: {},
      classList: makeClassList(),
      attributes: new Map(),
      toggleAttribute(name, force) {
        if (force) this.attributes.set(name, '');
        else this.attributes.delete(name);
      },
      setAttribute(name, value) { this.attributes.set(name, String(value)); }
    };
  };
  const state = {
    running: true,
    gameOver: false,
    paused: false,
    driveTransmissionMode: 'manual',
    driveGear: 3,
    gearLugging: true,
    gearStalled: true,
    gearShiftRemainingSeconds: 0,
    recommendedRecoveryGear: 1,
    recoveryShiftCount: 2,
    speed: 7 / 3.6,
    autoCurveSpeedLimit: 25,
    autoCurveDistance: 20
  };
  const alertLabel = makeElement();
  const speedLimitAlertEl = makeElement();
  const speedLimitAlertLabelEl = alertLabel;
  const cloverleafSuggestedSpeedText = makeElement();
  const mobileNavigationBtn = makeElement();
  const mobileRouteIcon = makeElement();
  const mobileRouteLabel = makeElement();
  const mobileRouteInstruction = makeElement();
  const mobileRouteMeta = makeElement();
  const mobileRouteAnnouncement = makeElement();
  const localizedText = {
    'navigation.speedLimitAhead': '前方限速',
    'gear.alert.luggingTitle': '高挡拖挡',
    'gear.alert.stalledTitle': '高挡完全失速',
    'gear.alert.luggingMeta': '推进受限 · 转速正在下沉',
    'gear.alert.stalledMeta': '推力归零 · 立即降至安全挡',
    'gear.luggingLabel': '拖挡 · Q→{gear}挡',
    'gear.stalledLabel.multiple': '完全失速 · Q×{count}→{gear}挡'
  };
  const updateAlert = new Function(
    'state',
    'speedLimitAlertEl',
    'speedLimitAlertLabelEl',
    'cloverleafSuggestedSpeedText',
    'mobileCockpitState',
    'mobileNavigationBtn',
    'mobileRouteIcon',
    'mobileRouteLabel',
    'mobileRouteInstruction',
    'mobileRouteMeta',
    'mobileRouteAnnouncement',
    'lastMobileSpeedLimitAnnouncementSignature',
    'clamp',
    'uiText',
    'uiMeters',
    'formatSpeedKmh',
    'minimumDriveSpeed',
    'commitMobileRouteText',
    'syncMobileRouteNavigationCue',
    `'use strict';\n${alertSource}\nreturn updateSpeedLimitAlert;`
  )(
    state,
    speedLimitAlertEl,
    speedLimitAlertLabelEl,
    cloverleafSuggestedSpeedText,
    { active: true },
    mobileNavigationBtn,
    mobileRouteIcon,
    mobileRouteLabel,
    mobileRouteInstruction,
    mobileRouteMeta,
    mobileRouteAnnouncement,
    '',
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    (key, parameters = {}, fallback = key) => String(localizedText[key] ?? fallback)
      .replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => parameters[name] ?? ''),
    (value) => `${value}米`,
    (value) => `${Math.round(value * 3.6)}km/h`,
    0,
    (element, value) => {
      if (element && element.textContent !== value) element.textContent = value;
    },
    () => {}
  );

  updateAlert();
  assert.equal(speedLimitAlertEl.hidden, false, 'mobile drivetrain faults must retain the centre alert');
  assert.equal(speedLimitAlertEl.dataset.alertKind, 'stalled');
  assert.equal(alertLabel.textContent, '高挡完全失速');
  assert.equal(cloverleafSuggestedSpeedText.textContent, '完全失速 · Q×2→1挡');
  assert.equal(speedLimitAlertEl.classList.contains('is-danger'), true);
  assert.equal(mobileNavigationBtn.dataset.alertKind, 'stalled');
  assert.equal(mobileNavigationBtn.dataset.alertLevel, 'danger');
  assert.equal(mobileRouteInstruction.textContent, '完全失速 · Q×2→1挡');
  assert.match(mobileRouteAnnouncement.textContent, /推力归零/);
  const stableDesktopWriteCounts = [alertLabel.textWriteCount, cloverleafSuggestedSpeedText.textWriteCount];
  const stableMobileAnnouncementWriteCount = mobileRouteAnnouncement.textWriteCount;
  updateAlert();
  assert.deepEqual(
    [alertLabel.textWriteCount, cloverleafSuggestedSpeedText.textWriteCount],
    stableDesktopWriteCounts,
    'a stable drivetrain fault must not recreate the desktop polite live-region text every frame'
  );
  assert.equal(
    mobileRouteAnnouncement.textWriteCount,
    stableMobileAnnouncementWriteCount,
    'a stable drivetrain fault must not repeat the mobile announcement every frame'
  );

  state.gearStalled = false;
  state.recommendedRecoveryGear = 2;
  state.recoveryShiftCount = 1;
  updateAlert();
  assert.equal(speedLimitAlertEl.dataset.alertKind, 'lugging');
  assert.equal(cloverleafSuggestedSpeedText.textContent, '拖挡 · Q→2挡');
  assert.equal(speedLimitAlertEl.classList.contains('is-warning'), true);

  state.gearLugging = false;
  state.autoCurveSpeedLimit = Number.POSITIVE_INFINITY;
  state.autoCurveDistance = Number.POSITIVE_INFINITY;
  updateAlert();
  assert.equal(speedLimitAlertEl.hidden, true);
  assert.equal(speedLimitAlertEl.dataset.alertKind, 'speed');
  assert.equal(mobileNavigationBtn.dataset.alertLevel, 'none');
});

test('manual high gears lose delivered thrust below their working ranges instead of driving normally', () => {
  const propulsionInput = {
    currentSpool: 1,
    currentRpm: gameplayCore.PROPULSION_CORE_CONTRACT.maximumRpm,
    throttleCommand: 1,
    braking: false,
    shifting: false
  };
  const fullThirdGear = gameplayCore.resolvePropulsionCoreStep({
    ...propulsionInput,
    gear: 3,
    speedMps: 140 / 3.6
  }, 1 / 60, {});
  const luggingThirdGear = gameplayCore.resolvePropulsionCoreStep({
    ...propulsionInput,
    gear: 3,
    speedMps: 100 / 3.6
  }, 1 / 60, {});
  const stalledThirdGear = gameplayCore.resolvePropulsionCoreStep({
    ...propulsionInput,
    gear: 3,
    speedMps: 90 / 3.6
  }, 1 / 60, {});

  assert.equal(fullThirdGear.gearTorqueAvailability, 1);
  assert.equal(fullThirdGear.gearLugging, false);
  assert.ok(luggingThirdGear.gearTorqueAvailability > 0);
  assert.ok(luggingThirdGear.gearTorqueAvailability < 0.05);
  assert.equal(luggingThirdGear.gearLugging, true);
  assert.ok(
    luggingThirdGear.averageAccelerationMps2 < fullThirdGear.averageAccelerationMps2 * 0.05,
    '100km/h in gear 3 must deliver only a small fraction of working-range thrust'
  );
  assert.equal(stalledThirdGear.gearTorqueAvailability, 0);
  assert.equal(stalledThirdGear.gearStalled, true);
  assert.equal(stalledThirdGear.averageAccelerationMps2, 0);

  const luggingSpeed = 100 / 3.6;
  const luggingDynamics = gameplayCore.resolveLongitudinalDynamicsStep({
    speedMps: luggingSpeed,
    propulsionAccelerationMps2: luggingThirdGear.averageAccelerationMps2,
    grounded: true,
    surfaceGrade: 0
  }, 1 / 60, {});
  assert.ok(
    luggingDynamics.nextSpeedMps < luggingSpeed,
    'full throttle in a badly lugging high gear must still lose speed under real resistance'
  );

  const secondGearAt50 = gameplayCore.resolveDriveGearTorqueAvailability(2, 50 / 3.6, {});
  assert.ok(secondGearAt50.torqueAvailability > 0 && secondGearAt50.torqueAvailability < 1);
  assert.equal(secondGearAt50.lugging, true);
  assert.equal(
    gameplayCore.resolveDriveGearTorqueAvailability(1, 0, {}).torqueAvailability,
    1,
    'gear 1 must retain restart authority at zero speed'
  );
});

test('AT delivers Gear-3 thrust and coasts through the 120/70km/h downshift schedule', () => {
  const state = {
    speed: 140 / 3.6,
    driveGear: 2,
    pendingDriveGear: 3,
    gearShiftRemainingSeconds: gameplayCore.DRIVE_GEAR_CONTRACT.shiftTorqueCutSeconds,
    propulsionCoreSpool: 1,
    propulsionCoreRpm: gameplayCore.PROPULSION_CORE_CONTRACT.maximumRpm
  };
  const dt = 1 / 120;
  const shiftEvents = [];
  const requestSpeedsKmh = {};
  let thirdGearPeakSpeed = state.speed;
  let thirdGearForwardThrustFrames = 0;
  for (let stepIndex = 0; stepIndex < 120 * 90; stepIndex++) {
    if (state.gearShiftRemainingSeconds <= 0 && state.pendingDriveGear === null) {
      const decision = gameplayCore.resolveAutomaticDriveGearDecision({
        currentGear: state.driveGear,
        speedMps: state.speed,
        transmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode,
        shiftInProgress: false
      }, {});
      if (decision.shouldShift) {
        const request = gameplayCore.resolveDriveGearShiftRequest({
          currentGear: state.driveGear,
          requestedGear: decision.requestedGear,
          speedMps: state.speed,
          shiftInProgress: false,
          transmissionMode: gameplayCore.DRIVE_TRANSMISSION_CONTRACT.automaticMode,
          requestAuthority: 'automatic'
        }, {});
        assert.equal(request.accepted, true);
        state.pendingDriveGear = decision.requestedGear;
        state.gearShiftRemainingSeconds = request.shiftTorqueCutSeconds;
        const event = `request:${state.driveGear}>${decision.requestedGear}`;
        shiftEvents.push(event);
        requestSpeedsKmh[event] = state.speed * 3.6;
      }
    }

    const shiftCutSeconds = Math.min(dt, state.gearShiftRemainingSeconds);
    const propulsionGear = state.pendingDriveGear ?? state.driveGear;
    const throttleCommand = stepIndex < 120 * 8 ? 1 : 0;
    const propulsion = gameplayCore.resolvePropulsionCoreStep({
      currentSpool: state.propulsionCoreSpool,
      currentRpm: state.propulsionCoreRpm,
      throttleCommand,
      braking: false,
      gear: propulsionGear,
      speedMps: state.speed,
      shifting: shiftCutSeconds > 0,
      shiftTorqueCutSeconds: shiftCutSeconds
    }, dt, {});
    if (propulsionGear === 3 && propulsion.averageAccelerationMps2 > 0.000_000_001) {
      thirdGearForwardThrustFrames++;
    }
    const previousSpeed = state.speed;
    state.speed = gameplayCore.resolveLongitudinalDynamicsStep({
      speedMps: state.speed,
      propulsionAccelerationMps2: propulsion.averageAccelerationMps2,
      grounded: true,
      surfaceGrade: 0
    }, dt, {}).nextSpeedMps;
    state.propulsionCoreSpool = propulsion.nextSpool;
    state.propulsionCoreRpm = propulsion.rpm;
    thirdGearPeakSpeed = Math.max(thirdGearPeakSpeed, state.speed);
    assert.ok(Number.isFinite(previousSpeed) && Number.isFinite(state.speed));

    if (shiftCutSeconds > 0) {
      state.gearShiftRemainingSeconds = Math.max(0, state.gearShiftRemainingSeconds - shiftCutSeconds);
      if (state.gearShiftRemainingSeconds <= 0.000_000_001) {
        const previousGear = state.driveGear;
        state.driveGear = state.pendingDriveGear;
        state.pendingDriveGear = null;
        state.gearShiftRemainingSeconds = 0;
        shiftEvents.push(`engage:${previousGear}>${state.driveGear}`);
      }
    }
    if (state.driveGear === 1 && state.pendingDriveGear === null && stepIndex > 120 * 8) break;
  }

  assert.deepEqual(
    shiftEvents,
    ['engage:2>3', 'request:3>2', 'engage:3>2', 'request:2>1', 'engage:2>1'],
    'AT must complete the physical 2→3→2→1 schedule without a special return path'
  );
  assert.ok(thirdGearForwardThrustFrames > 0, 'automatic Gear 3 must receive real forward thrust');
  assert.ok(thirdGearPeakSpeed > 160 / 3.6, 'automatic Gear 3 must accelerate beyond Gear 2 road speed');
  assert.ok(requestSpeedsKmh['request:3>2'] <= 120 + 0.000_001);
  assert.ok(requestSpeedsKmh['request:2>1'] <= 70 + 0.000_001);
  assert.equal(state.driveGear, 1);
  assert.equal(state.pendingDriveGear, null);
});

test('selected survival evidence requests fair obstacle braking with bounded release hysteresis', () => {
  const obstacleBrakeHelpersSource = sourceBetween(
    runtimeSource,
    'function autoObstacleStoppingEnvelopeM(speed)',
    '/** Allocate the three fixed trajectory buffers once'
  );
  const state = {
    autoObstacleBrakeRequest: false,
    autoObstacleBrakeDistanceM: null,
    autoObstacleBrakeTtcSeconds: null,
    autoObstacleBrakeReleaseRemainingSeconds: 0
  };
  const createHelpers = new Function(
    'state',
    'autoPlannerMaximumHoldSeconds',
    'gameplayCore',
    'sharedBrakeDeceleration',
    'normalAcceleration',
    'opposingVariantReadinessBoundaryMarginM',
    'autoObstacleBrakeReleaseHysteresisSeconds',
    'clamp',
    'isVerticallyClearAt',
    'autoObstacleBrakeCollisionThreshold',
    `'use strict';\n${obstacleBrakeHelpersSource}\n`
      + 'return {\n'
      + '  autoObstacleStoppingEnvelopeM,\n'
      + '  clearAutoObstacleBrakeRequest,\n'
      + '  updateAutoObstacleBrakeRequest,\n'
      + '  corridorSliceContactTime,\n'
      + '  obstacleBlocksCorridorSlice,\n'
      + '  obstacleOccupiesCorridorSlice,\n'
      + '  autoObstacleSevereEvidenceReason,\n'
      + '  retainAutoObstacleBrakeEvidence,\n'
      + '  selectAutoObstacleBrakeEvidenceTrajectory,\n'
      + '  evaluateAutoObstacleBrakeRequest\n'
      + '};'
  );
  let verticallyClearAfterSeconds = Number.POSITIVE_INFINITY;
  const helpers = createHelpers(
    state,
    1 / 30 + 0.045,
    { DEFAULT_MAX_RENDER_STEP_SECONDS: 0.045 },
    7.5,
    3.6,
    2,
    0.22,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    (_item, timeAhead) => timeAhead >= verticallyClearAfterSeconds,
    0.72
  );

  const ctx = { speed: 100 };
  const scratch = {};
  const selectedSurvival = {
    hard: true,
    collision: 0.44,
    severeEvidenceForwardM: 50,
    severeEvidenceTtcSeconds: 0.5,
    severeEvidenceReason: 'hard-obstacle'
  };
  const envelopeM = helpers.autoObstacleStoppingEnvelopeM(ctx.speed);
  assert.ok(envelopeM > 680 && envelopeM < 682);
  assert.equal(
    helpers.selectAutoObstacleBrakeEvidenceTrajectory(selectedSurvival, false),
    null,
    'an unselected primary trajectory must not gain longitudinal authority'
  );
  assert.equal(
    helpers.selectAutoObstacleBrakeEvidenceTrajectory(selectedSurvival, true),
    selectedSurvival,
    'the selected survival trajectory remains authoritative under either stored M preference'
  );
  assert.equal(
    helpers.evaluateAutoObstacleBrakeRequest(ctx, null, scratch).active,
    false,
    'a hard primary trajectory cannot request braking unless the survival trajectory was selected'
  );
  assert.equal(
    helpers.evaluateAutoObstacleBrakeRequest(ctx, selectedSurvival, scratch).active,
    true
  );
  assert.deepEqual(
    [scratch.distanceM, scratch.ttcSeconds, scratch.evidenceKind],
    [50, 0.5, 'hard-obstacle']
  );

  selectedSurvival.severeEvidenceForwardM = envelopeM;
  selectedSurvival.severeEvidenceTtcSeconds = selectedSurvival.severeEvidenceForwardM / ctx.speed;
  assert.equal(
    helpers.evaluateAutoObstacleBrakeRequest(ctx, selectedSurvival, scratch).active,
    true,
    'the physical stopping-envelope boundary is inclusive'
  );
  selectedSurvival.severeEvidenceForwardM = envelopeM + 0.001;
  selectedSurvival.severeEvidenceTtcSeconds = selectedSurvival.severeEvidenceForwardM / ctx.speed;
  assert.equal(
    helpers.evaluateAutoObstacleBrakeRequest(ctx, selectedSurvival, scratch).active,
    false
  );

  const evidence = {
    severeEvidenceForwardM: Number.POSITIVE_INFINITY,
    severeEvidenceTtcSeconds: Number.POSITIVE_INFINITY,
    severeEvidenceReason: 'none'
  };
  assert.equal(
    helpers.autoObstacleSevereEvidenceReason(false, 0.719, 'obstacle'),
    'none'
  );
  assert.equal(
    helpers.autoObstacleSevereEvidenceReason(false, 0.72, 'obstacle'),
    'high-collision-obstacle'
  );
  assert.equal(
    helpers.retainAutoObstacleBrakeEvidence(evidence, 12, 0.12, 'none'),
    false
  );
  assert.equal(
    helpers.retainAutoObstacleBrakeEvidence(
      evidence,
      80,
      0.8,
      helpers.autoObstacleSevereEvidenceReason(false, 0.72, 'corridor')
    ),
    true
  );
  assert.deepEqual(
    [evidence.severeEvidenceForwardM, evidence.severeEvidenceTtcSeconds, evidence.severeEvidenceReason],
    [80, 0.8, 'high-collision-corridor']
  );
  assert.equal(
    helpers.retainAutoObstacleBrakeEvidence(evidence, 10, 0.1, 'none'),
    false,
    'a nearer light event must not replace the severe event evidence'
  );
  assert.equal(
    helpers.retainAutoObstacleBrakeEvidence(evidence, 60, 0.6, 'hard-obstacle'),
    true
  );
  assert.deepEqual(
    [evidence.severeEvidenceForwardM, evidence.severeEvidenceTtcSeconds, evidence.severeEvidenceReason],
    [60, 0.6, 'hard-obstacle'],
    'distance, TTC, and reason must move together from one earlier severe event'
  );

  const globalSeverityWithoutEvidence = {
    hard: true,
    collision: 1,
    severeEvidenceForwardM: 10,
    severeEvidenceTtcSeconds: 0.1,
    severeEvidenceReason: 'none'
  };
  assert.equal(
    helpers.evaluateAutoObstacleBrakeRequest(ctx, globalSeverityWithoutEvidence, scratch).active,
    false,
    'trajectory-wide severity is not evidence'
  );

  assert.equal(helpers.updateAutoObstacleBrakeRequest(true, 20, 0.2, 0), true);
  assert.deepEqual(
    [state.autoObstacleBrakeDistanceM, state.autoObstacleBrakeTtcSeconds],
    [20, 0.2]
  );
  assert.equal(helpers.updateAutoObstacleBrakeRequest(false, null, null, 0.219), true);
  assert.ok(
    Math.abs(state.autoObstacleBrakeReleaseRemainingSeconds - 0.001) < 0.000_000_001
  );
  assert.equal(helpers.updateAutoObstacleBrakeRequest(false, null, null, 0.001_000_001), false);
  assert.equal(helpers.updateAutoObstacleBrakeRequest(true, 18, 0.18, 0.01), true);
  assert.equal(state.autoObstacleBrakeReleaseRemainingSeconds, 0.22);
  assert.equal(helpers.updateAutoObstacleBrakeRequest(false, null, null, 0.221), false);
  assert.deepEqual(
    [state.autoObstacleBrakeRequest, state.autoObstacleBrakeDistanceM, state.autoObstacleBrakeTtcSeconds],
    [false, null, null]
  );

  const item = { contact: { start: 0, end: 3 } };
  verticallyClearAfterSeconds = 2;
  assert.equal(helpers.corridorSliceContactTime(item, 50, 100), 0.5);
  assert.equal(helpers.obstacleBlocksCorridorSlice(item, 50, 100), true);
  assert.equal(helpers.corridorSliceContactTime(item, 250, 100), 2.5);
  assert.equal(helpers.obstacleBlocksCorridorSlice(item, 250, 100), false);
  const mixedSliceItem = {
    entryForward: 0,
    exitForward: 300,
    contact: { start: 0, end: 3 }
  };
  assert.equal(helpers.obstacleOccupiesCorridorSlice(mixedSliceItem, 50, 24, 100), true);
  assert.equal(
    helpers.obstacleOccupiesCorridorSlice(mixedSliceItem, 250, 24, 100),
    false,
    'one obstacle may block an early slice and vertically clear a later slice'
  );
  const clampedItem = { contact: { start: 1, end: 2 } };
  assert.equal(helpers.corridorSliceContactTime(clampedItem, 10, 100), 1);
  assert.equal(helpers.corridorSliceContactTime(clampedItem, 300, 100), 2);
  assert.equal(
    helpers.corridorSliceContactTime({ contact: { start: 2, end: 1 } }, 150, 100),
    2,
    'a malformed reversed contact range must fail closed at its entry boundary'
  );

  const planner = sourceBetween(
    runtimeSource,
    'const autoPilotPlanner = {',
    'function markAutoPilotCollision()'
  );
  const buildCorridors = sourceBetween(
    planner,
    'buildCorridors(ctx, perception)',
    'addCandidate(candidates, ctx, x)'
  );
  const plan = sourceBetween(planner, 'plan(frame)', 'emergencyGuard(frame)');
  assert.match(buildCorridors, /obstacleOccupiesCorridorSlice\(item, cp, band, ctx\.speed\)/);
  assert.match(buildCorridors, /corridorSliceContactTime\(item, cp, ctx\.speed\)/);
  assert.match(
    plan,
    /selectAutoObstacleBrakeEvidenceTrajectory\([\s\S]*?best,[\s\S]*?selectedSurvivalTrajectory[\s\S]*?\)/
  );
  assert.doesNotMatch(plan, /state\.manualThrottleMode/);
  assert.doesNotMatch(planner, /state\.(?:speed|lives|autoBrake)\s*=/);

  state.autoPilot = true;
  state.cameraCinematicActive = false;
  state.manualThrottleMode = false;
  state.manualAccelerating = false;
  state.autoBrake = true;
  state.autoBrakeReason = 'obstacle';
  state.autoCurveBrakeRequest = true;
  state.gearShiftRejectReason = 'automatic';
  state.gearShiftRejectPresentationUntil = 12_345;
  state.lastGearShiftRejectReason = 'automatic';
  helpers.updateAutoObstacleBrakeRequest(true, 18, 0.18, 0);
  const throttleToggleSource = sourceBetween(
    runtimeSource,
    'function toggleAutomaticThrottle(force)',
    'function takeCurveGuardrailDamage()'
  );
  const toggleAutomaticThrottle = new Function(
    'state',
    'clearAutoObstacleBrakeRequest',
    'syncAutomaticThrottleButtonPresentation',
    'syncGearControlPresentation',
    'playAudio',
    `'use strict';\nconst fatalRuntimeLocked = false;\n${throttleToggleSource}\n`
      + 'return toggleAutomaticThrottle;'
  )(
    state,
    helpers.clearAutoObstacleBrakeRequest,
    () => {},
    () => {},
    () => true
  );
  assert.equal(toggleAutomaticThrottle(false), false);
  assert.equal(state.manualThrottleMode, true);
  assert.equal(state.gearShiftRejectReason, null);
  assert.equal(state.gearShiftRejectPresentationUntil, 0);
  assert.equal(state.lastGearShiftRejectReason, 'automatic');
  assert.deepEqual(
    [
      state.autoBrake,
      state.autoBrakeReason,
      state.autoCurveBrakeRequest,
      state.autoObstacleBrakeRequest,
      state.autoObstacleBrakeDistanceM,
      state.autoObstacleBrakeTtcSeconds,
      state.autoObstacleBrakeReleaseRemainingSeconds
    ],
    [true, 'obstacle', true, true, 18, 0.18, 0.22],
    'changing the stored M preference must not revoke live longitudinal requests while P owns the core'
  );

  state.autoPilot = false;
  assert.equal(toggleAutomaticThrottle(true), true);
  assert.equal(toggleAutomaticThrottle(false), false);
  assert.deepEqual(
    [
      state.autoBrake,
      state.autoBrakeReason,
      state.autoCurveBrakeRequest,
      state.autoObstacleBrakeRequest,
      state.autoObstacleBrakeDistanceM,
      state.autoObstacleBrakeTtcSeconds,
      state.autoObstacleBrakeReleaseRemainingSeconds
    ],
    [false, 'none', false, false, null, null, 0],
    'P-off manual throttle takeover must revoke every autonomous longitudinal request immediately'
  );
});

test('candle pickup refreshes the shared growth profile without directly writing speed or RPM', () => {
  const pickup = sourceBetween(
    runtimeSource,
    'function collectPickupAtIndex(index)',
    '/**\n   * Resolve the logical contact timeline'
  );
  assert.match(pickup, /state\.expCount \+= 1/);
  assert.match(pickup, /syncCandleHandling\(\)/);
  assert.match(pickup, /state\.score \+=/);
  assert.doesNotMatch(pickup, /state\.speed/);
  assert.doesNotMatch(pickup, /state\.propulsionCoreRpm/);
});

test('manual and autopilot steering share one actuator and lateral physics consumes its interval average', () => {
  assert.match(runtimeSource, /typeof gameplayCore\.advanceSteeringActuator === 'function'/);
  const playerUpdate = sourceBetween(
    runtimeSource,
    'function updatePlayer(dt, now)',
    'function isDynamicObstacle'
  );
  assert.match(playerUpdate, /const steerCommand = manualSteer !== 0 \? manualSteer : autoSteer/);
  assert.match(playerUpdate, /gameplayCore\.advanceSteeringActuator\(/);
  assert.match(playerUpdate, /state\.steeringActuator/);
  assert.match(playerUpdate, /averageActuator/);
  assert.match(playerUpdate, /integratePlayerLateralStep\(\s*dt,[\s\S]*?averageActuator/);
  assert.doesNotMatch(playerUpdate, /integratePlayerLateralStep\(dt,\s*steer\)/);
});

test('planner rollout and portal crossing prediction are steering-actuator aware', () => {
  const rollout = sourceBetween(
    runtimeSource,
    'rollout(ctx, target, trajectory)',
    'sample(ctx, arr, t, sampleCount)'
  );
  assert.match(rollout, /gameplayCore\.advanceSteeringActuator\(/);
  assert.match(rollout, /averageActuator/);
  assert.match(
    rollout,
    /steeringStep\.averageActuator \* ctx\.kin\.maxLatAccel/
  );
  assert.match(rollout, /actuator = steeringStep\.nextActuator/);
  assert.doesNotMatch(
    rollout,
    /u \* ctx\.kin\.maxLatAccel \+ ctx\.curveOutwardAcceleration/
  );

  const portalPrediction = sourceBetween(
    runtimeSource,
    'function updateGraphRouteChoice(crossingDistance = 0, frameDt = 0)',
    'const routePreviousFrameScratch'
  );
  assert.match(portalPrediction, /gameplayCore\.advanceSteeringActuator\(/);
  assert.match(portalPrediction, /crossingSteering\.averageActuator/);
  assert.match(portalPrediction, /integratePlayerLateralStep\(/);
  assert.match(
    portalPrediction,
    /Prediction is side-effect free:[\s\S]*?same actuator from this initial state/
  );

  const portalCommand = sourceBetween(
    runtimeSource,
    'function currentPortalSteer()',
    'const portalSteeringStepScratch'
  );
  assert.match(portalCommand, /state\.resolvedSteerCommand/);
  assert.doesNotMatch(portalCommand, /state\.autoVirtualSteer/);
  const playerUpdate = sourceBetween(
    runtimeSource,
    'function updatePlayer(dt, now)',
    'function isDynamicObstacle'
  );
  assert.match(playerUpdate, /state\.autoVirtualSteer = autoSteer/);
});

test('guardian projection replays the production bounded lateral lattice', () => {
  const guardian = sourceBetween(
    runtimeSource,
    'guardianSteer(baseSteer, frame)',
    'let critical = null'
  );
  assert.match(
    guardian,
    /Math\.min\(remaining,\s*gameplayCore\.DEFAULT_MAX_RENDER_STEP_SECONDS\)/
  );
  assert.match(guardian, /while \(remaining > 0\.000_000_001\)/);
  assert.match(guardian, /gameplayCore\.advanceSteeringActuator\(/);
  assert.match(guardian, /steeringStep\.averageActuator \* ctx\.kin\.maxLatAccel/);
  assert.match(guardian, /actuator = steeringStep\.nextActuator/);
  assert.doesNotMatch(guardian, /const projectedVelocity[\s\S]*?\* time/);
});

test('locked portal gates contain left and right drift symmetrically', () => {
  const reachDistance = sourceBetween(
    runtimeSource,
    'function graphGateReachDistance(gate)',
    '/** Portal prediction'
  );
  assert.match(reachDistance, /const target = graphGateTarget\(gate\)/);
  assert.doesNotMatch(reachDistance, /\(gate\.min \+ gate\.max\) \* 0\.5/);
  assert.match(reachDistance, /Math\.abs\(state\.lateralVelocity\) > 0\.82/);
  assert.match(
    reachDistance,
    /Math\.sign\(target - state\.lateral\) \|\| -Math\.sign\(state\.lateralVelocity\)/
  );

  const enforcement = sourceBetween(
    runtimeSource,
    'function enforceAutoForkPhysicalInput(steer)',
    'const playerFrameScratch'
  );
  assert.match(enforcement, /const gateTarget = graphGateTarget\(gate\)/);
  assert.doesNotMatch(enforcement, /\(gate\.min \+ gate\.max\) \* 0\.5/);
  assert.match(enforcement, /const remainingMargin = velocityDirection > 0/);
  assert.match(enforcement, /gate\.max - state\.lateral/);
  assert.match(enforcement, /state\.lateral - gate\.min/);
  assert.match(enforcement, /const stoppingDistance = state\.lateralVelocity \* state\.lateralVelocity/);
  assert.match(enforcement, /return mustContainDrift \? -velocityDirection : steer/);
  assert.doesNotMatch(enforcement, /Math\.sign\(target - state\.lateral \|\| 1\)/);
});

test('paused presentation freezes propulsion feedback instead of decaying authoritative state', () => {
  const animate = sourceBetween(
    runtimeSource,
    'function animate()',
    "startBtn.addEventListener('click'"
  );
  const pausedBranch = sourceBetween(
    animate,
    '} else {',
    '// Audio consumes the already-smoothed propulsion'
  );
  assert.match(pausedBranch, /updatePropulsionFeedback\(/);
  assert.match(pausedBranch, /frozen:\s*true/);
  assert.match(pausedBranch, /coreSpool:\s*state\.propulsionCoreSpool/);
  assert.match(pausedBranch, /steeringActuator:\s*state\.steeringActuator/);
  assert.match(
    pausedBranch,
    /if \(!state\.paused\) \{\s*updateShipLifeForm\(now, 1, reducedMotionEnabled, false, presentationDt\);\s*\}/
  );
  assert.doesNotMatch(pausedBranch, /state\.steeringActuator\s*=\s*0/);
  assert.doesNotMatch(pausedBranch, /state\.propulsionCoreSpool\s*=\s*0/);

  const reset = sourceBetween(
    runtimeSource,
    'function resetGame({ allowDuringStartup = false } = {})',
    '/** Guarantee branch entry'
  );
  assert.match(reset, /state\.propulsionCoreRpm = propulsionCoreContract\.idleRpm/);
  assert.match(reset, /state\.gearShiftRejectPresentationUntil = 0/);
  assert.match(reset, /resetPropulsionFeedback\(\{[\s\S]*?coreRpm:\s*state\.propulsionCoreRpm/);
});

test('visible wall-clock simulation integrates every metre before the readiness boundary', () => {
  assert.match(gameplayCoreSource, /const DEFAULT_MAX_RENDER_STEP_SECONDS = 0\.045;/);
  assert.match(gameplayCoreSource, /function integrateLongitudinalDistance\(/);
  assert.doesNotMatch(gameplayCoreSource, /DEFAULT_MAX_RENDER_CATCH_UP_SECONDS/);
  assert.doesNotMatch(gameplayCoreSource, /maximumCatchUpSeconds/);
  const animate = sourceBetween(
    runtimeSource,
    'function advanceGameplayStep(dt, now)',
    "startBtn.addEventListener('click'"
  );
  assert.match(
    animate,
    /const integratedDistanceStep = gameplayCore\.integrateLongitudinalDistance\(previousSpeed, state\.speed, dt\);/
  );
  assert.match(
    animate,
    /const distanceStep = constrainOpposingVariantDistance\(integratedDistanceStep\);/
  );
  assert.equal((animate.match(/state\.distance \+= distanceStep/g) || []).length, 1);
  assert.match(animate, /gameplayCore\.consumeBoundedElapsedTime\(\s*rawFrameDt,\s*advanceGameplayStep,\s*now/);
  assert.doesNotMatch(animate, /Math\.min\(clock\.getDelta\(\),\s*0\.045\)/);
  const visibilityBoundary = sourceBetween(
    runtimeSource,
    "document.addEventListener('visibilitychange'",
    'let presentationResourcesDisposed'
  );
  assert.match(visibilityBoundary, /document\.visibilityState !== 'visible'/);
  assert.match(visibilityBoundary, /if \(shouldPause\) setPaused\(true\)/);
  const pauseBoundary = sourceBetween(
    runtimeSource,
    'function setPaused(force)',
    '/** Toggle the shared persisted preference'
  );
  assert.match(pauseBoundary, /if \(!state\.paused\) clock\.getDelta\(\)/);
});
