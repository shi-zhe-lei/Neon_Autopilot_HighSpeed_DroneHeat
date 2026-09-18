const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Resolve production entity dependencies from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
global.window = { location: { search: '' } };
require(path.join(PROJECT_ROOT, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js'));
require(path.join(PROJECT_ROOT, 'src/entities/Neon_Autopilot_V23_HighSpeed_DroneHeat.ship.js'));

const shipModule = global.window.NeonV23Ship;
assert.ok(shipModule, 'Ship module did not publish its browser contract');
assert.equal(typeof shipModule.createShip, 'function');
assert.equal(typeof shipModule.deriveTurnThrustTargets, 'function');
assert.equal(typeof shipModule.derivePropulsionVisualTargets, 'function');
assert.equal(typeof shipModule.deriveSpeedCueTargets, 'function');
assert.equal(typeof shipModule.deriveCruiseDynamics, 'function');
assert.equal(typeof shipModule.deriveShipHeatTarget, 'function');
assert.equal(typeof shipModule.deriveCapeBreathRad, 'function');
assert.equal(typeof shipModule.deriveInvulnerabilityShieldPresentation, 'function');
assert.equal(typeof shipModule.mirrorExtrudedOutline, 'function');
assert.ok(Object.isFrozen(shipModule.PROPULSION_CONTRACT), 'Propulsion contract must be immutable');
assert.ok(
  Object.isFrozen(shipModule.PROPULSION_LUGGING_PRESENTATION_CONTRACT),
  'Lugging presentation contract must be immutable'
);
assert.ok(Object.isFrozen(shipModule.CRUISE_DYNAMICS_CONTRACT), 'Cruise dynamics contract must be immutable');
assert.ok(
  Object.isFrozen(shipModule.SHIP_HEAT_PRESENTATION_CONTRACT),
  'Ship heat presentation contract must be immutable'
);
assert.ok(Object.isFrozen(shipModule.SURFACE_FOOTPRINT_CONTRACT), 'Surface footprint contract must be immutable');
assert.ok(Object.isFrozen(shipModule.SKY_CAPE_ART_CONTRACT), 'Sky cape art contract must be immutable');
assert.ok(
  Object.isFrozen(shipModule.SHIP_COMPONENT_CLEARANCE_CONTRACT),
  'Ship component-clearance contract must be immutable'
);
assert.ok(Object.isFrozen(shipModule.COVERED_CLEARANCE_CONTRACT), 'Covered clearance contract must be immutable');
assert.ok(Object.isFrozen(shipModule.SHIP_ULTRA_PRESENTATION_CONTRACT), 'Ultra ship presentation contract must be immutable');
assert.ok(
  Object.isFrozen(shipModule.INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT),
  'Invulnerability shield presentation contract must be immutable'
);
assert.equal(shipModule.SHIP_ULTRA_PRESENTATION_CONTRACT.qualityId, 'high');
assert.equal(shipModule.SHIP_ULTRA_PRESENTATION_CONTRACT.bloomLayer, 12);
assert.equal(shipModule.SHIP_ULTRA_PRESENTATION_CONTRACT.localLightCount, 0);
assert.equal(shipModule.SHIP_ULTRA_PRESENTATION_CONTRACT.presentationOnly, true);
assert.ok(Object.isFrozen(shipModule.TUNNEL_BOUNCE_CONTRACT));
assert.equal(shipModule.TUNNEL_BOUNCE_CONTRACT.indirectDiffuseOnly, true);
assert.equal(shipModule.TUNNEL_BOUNCE_CONTRACT.localLightCount, 0);

const luggingPresentationContract = shipModule.PROPULSION_LUGGING_PRESENTATION_CONTRACT;
assert.equal(luggingPresentationContract.maximumEnergizedSpoolReduction, 0.65);
assert.equal(luggingPresentationContract.maximumPlumeLengthReduction, 0.42);
assert.equal(luggingPresentationContract.maximumPlumeOpacityReduction, 0.52);
assert.equal(luggingPresentationContract.flutterAngularRatePerMillisecond, 0.008_5);
assert.equal(luggingPresentationContract.minimumFlutterScale, 0.86);
assert.equal(luggingPresentationContract.maximumFlutterScale, 0.94);
assert.equal(luggingPresentationContract.presentationOnly, true);
assert.equal(luggingPresentationContract.affectsPhysics, false);
assert.equal(luggingPresentationContract.affectsCollision, false);
assert.equal(luggingPresentationContract.affectsCamera, false);

const shieldContract = shipModule.INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT;
assert.equal(shieldContract.version, 2);
assert.equal(shieldContract.themeId, 'dawn-starward');
assert.equal(shieldContract.shellCount, 1);
assert.equal(shieldContract.orbitArcCount, 3);
assert.equal(shieldContract.anchorCount, 5);
assert.equal(shieldContract.impactSettleSeconds, 0.18);
assert.equal(shieldContract.expirationTailSeconds, 0.34);
assert.equal(shieldContract.roadProjectingLocalLightCount, 0);
assert.equal(shieldContract.centreClear, true);
assert.equal(shieldContract.fogUniformSource, 'THREE.UniformsLib.fog-clone');
assert.equal(shieldContract.compileBeforeGameplay, true);
assert.equal(shieldContract.reducedMotionStatic, true);
assert.equal(shieldContract.visualOnly, true);
assert.equal(shieldContract.affectsHazardCollider, false);

const shieldPresentationScratch = {};
assert.equal(
  shipModule.deriveInvulnerabilityShieldPresentation(
    1.32,
    1.32,
    0.48,
    false,
    shieldPresentationScratch
  ),
  shieldPresentationScratch,
  'Shield derivation must reuse caller-owned output on the render path'
);
const shieldPresentationSamples = [1.32, 0.84, 0.34, 0.17, 0.000_001, 0].map(
  (remainingSeconds) => ({
    ...shipModule.deriveInvulnerabilityShieldPresentation(
      remainingSeconds,
      1.32,
      0.48,
      false,
      {}
    )
  })
);
for (const sample of shieldPresentationSamples) {
  for (const key of [
    'progress',
    'impact',
    'expiry',
    'fieldOpacity',
    'orbitOpacity',
    'anchorOpacity',
    'scale',
    'warmBlend',
    'orbitRate'
  ]) {
    assert.ok(Number.isFinite(sample[key]), `Shield ${key} must remain finite`);
  }
}
assert.equal(shieldPresentationSamples[0].active, true);
assert.equal(shieldPresentationSamples.at(-1).active, false);
assert.equal(shieldPresentationSamples[0].fieldOpacity, shieldContract.maximumFieldOpacity);
assert.ok(shieldPresentationSamples[0].scale <= shieldContract.maximumImpactScale);
assert.ok(shieldPresentationSamples[4].fieldOpacity <= 0.011, 'Shield tail must not hard-cut a bright shell');
assert.ok(shieldPresentationSamples[4].orbitOpacity <= 0.019, 'Shield tail must not hard-cut a bright orbit');
assert.ok(shieldPresentationSamples[4].anchorOpacity <= 0.025, 'Shield tail must not hard-cut bright anchors');
assert.equal(shieldPresentationSamples.at(-1).fieldOpacity, 0);
assert.equal(shieldPresentationSamples.at(-1).orbitOpacity, 0);
assert.equal(shieldPresentationSamples.at(-1).anchorOpacity, 0);
assert.ok(
  shieldPresentationSamples[0].impact > shieldPresentationSamples[1].impact,
  'The formation surge must settle once instead of looping through the protection window'
);
const reducedShieldPresentation = shipModule.deriveInvulnerabilityShieldPresentation(
  0.84,
  1.32,
  0.48,
  true,
  {}
);
assert.equal(reducedShieldPresentation.orbitRate, 0);
assert.equal(reducedShieldPresentation.reducedMotion, true);

const surfaceFootprintContract = shipModule.SURFACE_FOOTPRINT_CONTRACT;
for (const nestedContract of [
  surfaceFootprintContract.colliderHalf,
  surfaceFootprintContract.localForward,
  surfaceFootprintContract.bellyCenterLocal,
  surfaceFootprintContract.tailDownwashLocal,
  surfaceFootprintContract.tailDownwashLocal.left,
  surfaceFootprintContract.tailDownwashLocal.right
]) {
  assert.ok(Object.isFrozen(nestedContract), 'Every nested surface-footprint object must be immutable');
}
assert.deepEqual(surfaceFootprintContract.colliderHalf, { hx: 0.72, hy: 0.58, hz: 1.36 });
assert.equal(
  surfaceFootprintContract.pressureHalfWidthM,
  surfaceFootprintContract.colliderHalf.hx,
  'Belly pressure width must derive from the fixed collision proxy'
);
assert.equal(
  surfaceFootprintContract.pressureHalfLengthM,
  surfaceFootprintContract.colliderHalf.hz,
  'Belly pressure length must derive from the fixed collision proxy'
);
assert.deepEqual(surfaceFootprintContract.localForward, { x: 0, y: 0, z: -1 });
assert.deepEqual(surfaceFootprintContract.bellyCenterLocal, { x: 0, y: 0.35, z: 0.14 });
assert.deepEqual(surfaceFootprintContract.tailDownwashLocal.left, { x: -0.62, y: 0.61, z: 0.96 });
assert.deepEqual(surfaceFootprintContract.tailDownwashLocal.right, { x: 0.62, y: 0.61, z: 0.96 });
assert.equal(
  surfaceFootprintContract.tailDownwashLocal.left.x,
  -surfaceFootprintContract.tailDownwashLocal.right.x,
  'Tail downwash anchors must remain mirrored'
);

const capeContract = shipModule.SKY_CAPE_ART_CONTRACT;
assert.equal(capeContract.themeId, 'dawn-pilgrim-manta-reliquary-v2');
assert.equal(capeContract.healthySpanM, 5.24, 'Healthy cape span changed without an art-contract update');
assert.equal(capeContract.minimumCapeLayersPerWing, 2, 'Each healthy wing needs shell and woven inset layers');
assert.equal(capeContract.capeLobeCountPerWing, 5, 'Each healthy cape wing needs five broad cloth lobes');
assert.equal(capeContract.capePleatCountPerWing, 3, 'Each healthy cape wing needs three restrained cloth pleats');
assert.equal(capeContract.spiritMaskEyeCount, 2, 'The spirit mask must retain its paired living eyes');
assert.equal(capeContract.constellationNodeCount, 9, 'Healthy silhouette needs eight cape stars plus the central dawn star');
assert.equal(capeContract.spiritWakeRibbonCount, 4, 'The candle wake must remain a balanced four-ribbon stack');
assert.equal(capeContract.visibleMechanicalPanelCount, 0, 'The Sky reliquary must not expose aircraft panels');
assert.equal(capeContract.visibleTurbineCount, 0, 'The Sky reliquary must not expose modern turbines');
assert.equal(capeContract.minimumQuietSurfaceRatio, 0.70, 'At least 70% of the surface must remain visually quiet');
assert.equal(capeContract.healthyMirrorToleranceM, 0.000_001);
assert.equal(capeContract.healthyMirroredGlowPaths, true);
assert.equal(capeContract.extrudedMirrorWindingPreserved, true);
assert.equal(capeContract.roadProjectingLocalLightCount, 0);
assert.equal(capeContract.visualOnly, true, 'Cape art must not become gameplay authority');

const componentClearanceContract = shipModule.SHIP_COMPONENT_CLEARANCE_CONTRACT;
assert.equal(componentClearanceContract.version, 1);
assert.equal(componentClearanceContract.capeRootAbsXM, 0.80);
assert.equal(componentClearanceContract.hullHalfWidthAtCapeM, 0.52);
assert.equal(componentClearanceContract.sidePodOuterAbsXM, 0.76);
assert.equal(componentClearanceContract.minimumCapeRootGapM, 0.04);
assert.equal(componentClearanceContract.maximumCapeRootInwardTravelM, 0.018);
assert.equal(componentClearanceContract.minimumDynamicCapePodGapM, 0.022);
assert.equal(componentClearanceContract.outerCapeTopYM, 0.85);
assert.equal(componentClearanceContract.insetCapeBottomYM, 0.895);
assert.equal(componentClearanceContract.minimumCapeLayerGapM, 0.045);
assert.equal(componentClearanceContract.scarfInnerAbsXM, 0.62);
assert.equal(componentClearanceContract.mainNozzleRadiusM, 0.36);
assert.equal(componentClearanceContract.minimumScarfNozzleGapM, 0.26);
assert.equal(componentClearanceContract.mainPlumeRootZM, 1.20);
assert.equal(componentClearanceContract.sidePlumeRootZM, 1.12);
assert.equal(componentClearanceContract.brakePlumeRootZM, 0.78);
assert.equal(componentClearanceContract.plumeRootToleranceM, 0.000_001);
assert.equal(componentClearanceContract.rootAnchoredPlumes, true);
assert.equal(componentClearanceContract.effectsAffectCollision, false);
assert.ok(
  componentClearanceContract.capeRootAbsXM - componentClearanceContract.hullHalfWidthAtCapeM
    >= componentClearanceContract.minimumCapeRootGapM,
  'Cape roots must stay outside the central reliquary hull'
);
assert.ok(
  componentClearanceContract.capeRootAbsXM - componentClearanceContract.sidePodOuterAbsXM
    >= componentClearanceContract.minimumCapeRootGapM,
  'Cape roots must stay outside the fixed side pods'
);
assert.ok(
  componentClearanceContract.minimumCapeRootGapM
    - componentClearanceContract.maximumCapeRootInwardTravelM
    >= componentClearanceContract.minimumDynamicCapePodGapM,
  'Maximum cape breathing must retain a positive side-pod gap'
);
assert.ok(
  componentClearanceContract.insetCapeBottomYM - componentClearanceContract.outerCapeTopYM
    >= componentClearanceContract.minimumCapeLayerGapM,
  'Cape inset must float above the outer cloth instead of z-fighting through it'
);
assert.ok(
  componentClearanceContract.scarfInnerAbsXM - componentClearanceContract.mainNozzleRadiusM
    >= componentClearanceContract.minimumScarfNozzleGapM,
  'Paired scarf tails must leave the primary light-breath aperture clear'
);

const coveredClearanceContract = shipModule.COVERED_CLEARANCE_CONTRACT;
assert.equal(coveredClearanceContract.mainVisualHalfWidthM, 2.62);
assert.equal(coveredClearanceContract.mainVisualForwardM, 1.18);
assert.equal(coveredClearanceContract.mainVisualAftM, 1.78);
assert.equal(coveredClearanceContract.mainVisualMinimumYM, 0.206_8);
assert.equal(coveredClearanceContract.mainVisualMaximumYM, 1.77);
assert.equal(coveredClearanceContract.maximumCoveredRollRad, 0.20);
assert.equal(coveredClearanceContract.maximumCoveredPitchRad, 0.22);
assert.equal(coveredClearanceContract.maximumCoveredTopOffsetM, 2.70);
assert.equal(coveredClearanceContract.maximumCoveredHoverM, 0);
assert.equal(coveredClearanceContract.protectsMainVisual, true);
assert.equal(coveredClearanceContract.affectsHazardCollider, false);
const conservativeCoveredTopM = coveredClearanceContract.mainVisualMaximumYM
    * Math.cos(coveredClearanceContract.maximumCoveredRollRad)
    * Math.cos(coveredClearanceContract.maximumCoveredPitchRad)
  + coveredClearanceContract.mainVisualHalfWidthM
    * Math.sin(coveredClearanceContract.maximumCoveredRollRad)
  + coveredClearanceContract.mainVisualAftM
    * Math.sin(coveredClearanceContract.maximumCoveredPitchRad);
assert.ok(
  conservativeCoveredTopM <= coveredClearanceContract.maximumCoveredTopOffsetM,
  'Covered top envelope no longer contains the rotated healthy main visual'
);

const authoredMirrorOutline = [[0.80, -0.52], [1.58, -0.24], [2.12, 0.02], [2.62, 0.28]];
const rightMirrorOutline = shipModule.mirrorExtrudedOutline(1, authoredMirrorOutline);
const leftMirrorOutline = shipModule.mirrorExtrudedOutline(-1, authoredMirrorOutline);
const signedArea = (outline) => outline.reduce((area, point, index) => {
  const next = outline[(index + 1) % outline.length];
  return area + point[0] * next[1] - next[0] * point[1];
}, 0) / 2;
assert.deepEqual(rightMirrorOutline, authoredMirrorOutline);
assert.deepEqual(
  leftMirrorOutline,
  authoredMirrorOutline.map(([x, y]) => [-x, y]).reverse(),
  'Left profiles must reverse after mirroring so their front faces keep the authored winding'
);
assert.ok(
  Math.abs(signedArea(leftMirrorOutline) - signedArea(rightMirrorOutline)) <= Number.EPSILON,
  'Mirrored profiles must retain the authored signed winding area'
);
assert.deepEqual(authoredMirrorOutline, [[0.80, -0.52], [1.58, -0.24], [2.12, 0.02], [2.62, 0.28]]);
assert.equal(shipModule.deriveCapeBreathRad(1_250, 0.8, true), 0, 'Reduced motion must suppress cape breathing');
for (const nowMs of [0, 250, 1_000, 2_500, 9_000]) {
  assert.ok(
    Math.abs(shipModule.deriveCapeBreathRad(nowMs, 1, false)) <= capeContract.maximumCapeBreathRad,
    'Cape breathing exceeded its visual-only angle envelope'
  );
}
assert.equal(shipModule.deriveCapeBreathRad(Number.NaN, Number.NaN, false), 0);

const reusedOutput = {};
const neutral = shipModule.deriveTurnThrustTargets(0, reusedOutput);
assert.equal(neutral, reusedOutput, 'Hot-path callers must be able to reuse one output object');
assert.deepEqual(neutral, { leftThrust: 1, rightThrust: 1 });

const rightTurn = shipModule.deriveTurnThrustTargets(1, {});
const leftTurn = shipModule.deriveTurnThrustTargets(-1, {});
assert.equal(rightTurn.leftThrust, shipModule.PROPULSION_CONTRACT.maximumTurnThrust);
assert.equal(rightTurn.rightThrust, shipModule.PROPULSION_CONTRACT.minimumTurnThrust);
assert.equal(leftTurn.leftThrust, rightTurn.rightThrust, 'Left/right steering must be mirrored');
assert.equal(leftTurn.rightThrust, rightTurn.leftThrust, 'Left/right steering must be mirrored');
assert.ok(
  rightTurn.leftThrust / rightTurn.rightThrust >= 1.30
    && rightTurn.leftThrust / rightTurn.rightThrust <= 1.50,
  'Full-steer tail-plume ratio must stay readable without looking broken'
);

assert.deepEqual(
  shipModule.deriveTurnThrustTargets(9, {}),
  rightTurn,
  'Steering inputs above the public range must clamp'
);
assert.deepEqual(
  shipModule.deriveTurnThrustTargets(Number.NaN, {}),
  { leftThrust: 1, rightThrust: 1 },
  'Invalid steering must safely return to neutral visuals'
);

const contract = shipModule.PROPULSION_CONTRACT;
assert.equal(contract.coreIdleRpm, 1_800);
assert.equal(contract.coreRpmReference, 12_000);
assert.equal(contract.brakeNozzleCount, 2, 'Reverse thrust must remain a mirrored pair');
assert.equal(contract.brakeLayersPerNozzle, 3, 'Each reverse thruster needs aperture, outer plume, and inner core');
assert.equal(
  contract.brakePlumeAnchorZ + contract.brakePlumeRootOffsetM,
  contract.brakeNozzleZ,
  'Reverse-thrust plume roots must meet their wing-shoulder apertures'
);
assert.equal(contract.brakePlumeLengthM, 0.65, 'Reverse-thrust outer plume length changed unexpectedly');
assert.equal(contract.speedStreakStartKmh, 70, 'Near-rest travel must not look like hyperspace');
assert.equal(contract.speedStreakFullKmh, 160, 'Optic flow must saturate at the ordinary second-gear envelope');
assert.equal(shipModule.CRUISE_DYNAMICS_CONTRACT.minimumSpeedKmh, 20);
assert.equal(shipModule.CRUISE_DYNAMICS_CONTRACT.baselineSpeedKmh, 120);
assert.equal(shipModule.CRUISE_DYNAMICS_CONTRACT.fullSpeedKmh, 160);
const heatContract = shipModule.SHIP_HEAT_PRESENTATION_CONTRACT;
assert.equal(heatContract.minimumSpeedKmh, 0);
assert.equal(heatContract.firstGearReferenceSpeedKmh, 110);
assert.equal(heatContract.automaticCruiseSpeedKmh, 120);
assert.equal(heatContract.secondGearReferenceSpeedKmh, 160);
assert.equal(heatContract.thirdGearReferenceSpeedKmh, 280);
assert.equal(heatContract.automaticMinimumGear, 1);
assert.equal(heatContract.automaticMaximumGear, 3);
assert.equal(heatContract.automaticThirdGearEnabled, true);
assert.equal(heatContract.heatStartSpeedKmh, 80);
assert.equal(heatContract.heatMidpointSpeedKmh, 160);
assert.equal(heatContract.heatFullSpeedKmh, 280);
assert.equal(heatContract.heatMidpoint, 0.5);
assert.equal(heatContract.speedInputUnit, 'kilometers-per-hour');
assert.equal(heatContract.extremeHeatCurve, 'smoothed-heat-squared');
assert.equal(heatContract.presentationOnly, true);
assert.equal(shipModule.deriveShipHeatTarget(0), 0);
assert.equal(shipModule.deriveShipHeatTarget(79.999), 0);
assert.equal(shipModule.deriveShipHeatTarget(80), 0);
assert.equal(shipModule.deriveShipHeatTarget(110), 0.158_203_125);
assert.equal(shipModule.deriveShipHeatTarget(120), 0.25);
assert.equal(shipModule.deriveShipHeatTarget(160), 0.5);
assert.equal(shipModule.deriveShipHeatTarget(220), 0.75);
assert.equal(shipModule.deriveShipHeatTarget(280), 1);
assert.equal(shipModule.deriveShipHeatTarget(360), 1);
assert.equal(shipModule.deriveShipHeatTarget(Number.NaN), 0);

const authoritativeVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: 0.72,
  coreRpm: 9_144,
  thrustNormalized: 0.64,
  steeringActuator: 0.75
}, {});
assert.equal(authoritativeVisual.coreSpool, 0.72);
assert.equal(authoritativeVisual.coreRpm, 9_144);
assert.equal(authoritativeVisual.energizedSpool, 0.72);
assert.equal(authoritativeVisual.exhaustEnergyNormalized, 0.72);
assert.equal(authoritativeVisual.throttleBlend, 0.64);
assert.equal(authoritativeVisual.steerBlend, 0.75);
assert.equal(
  (authoritativeVisual.leftThrustNormalized + authoritativeVisual.rightThrustNormalized) / 2,
  authoritativeVisual.thrustNormalized,
  'Differential steering must preserve the shared authoritative thrust mean'
);
const zeroPowerVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: 0,
  coreRpm: 0,
  thrustNormalized: 0,
  steeringActuator: 0
}, {});
assert.equal(zeroPowerVisual.energizedSpool, 0);
assert.equal(zeroPowerVisual.exhaustEnergyNormalized, 0);
assert.ok(authoritativeVisual.mainPlumeLength > zeroPowerVisual.mainPlumeLength);
assert.ok(authoritativeVisual.mainPlumeOpacity > zeroPowerVisual.mainPlumeOpacity);

const fullPowerVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: 1,
  coreRpm: 12_000,
  thrustNormalized: 1,
  steeringActuator: 0
}, {});
const releaseDecayRatePerSecond = 1.8;
const releaseTimesSeconds = [1 / 60, 0.4, 1, 2];
const releasedVisuals = releaseTimesSeconds.map((elapsedSeconds) => {
  const residualSpool = Math.exp(-releaseDecayRatePerSecond * elapsedSeconds);
  return shipModule.derivePropulsionVisualTargets({
    coreSpool: residualSpool,
    coreRpm: 1_800 + (12_000 - 1_800) * residualSpool,
    thrustNormalized: 0,
    steeringActuator: 0
  }, {});
});
const firstReleaseVisual = releasedVisuals[0];
assert.equal(firstReleaseVisual.thrustNormalized, 0);
assert.equal(firstReleaseVisual.throttleBlend, 0);
assert.equal(firstReleaseVisual.leftThrustNormalized, 0);
assert.equal(firstReleaseVisual.rightThrustNormalized, 0);
assert.equal(firstReleaseVisual.exhaustEnergyNormalized, firstReleaseVisual.energizedSpool);
assert.ok(
  firstReleaseVisual.mainPlumeLength > fullPowerVisual.mainPlumeLength * 0.97,
  'The first throttle-release frame must retain hot-core plume length instead of snapping to idle'
);
assert.ok(
  firstReleaseVisual.mainPlumeOpacity > fullPowerVisual.mainPlumeOpacity * 0.97,
  'The first throttle-release frame must retain hot-core plume opacity instead of snapping to idle'
);
for (let index = 0; index < releasedVisuals.length; index++) {
  const releasedVisual = releasedVisuals[index];
  const previousVisual = index === 0 ? fullPowerVisual : releasedVisuals[index - 1];
  assert.equal(releasedVisual.thrustNormalized, 0, 'Residual exhaust must never become physical thrust');
  assert.equal(releasedVisual.throttleBlend, 0, 'Residual exhaust must not impersonate pedal demand');
  assert.equal(releasedVisual.exhaustEnergyNormalized, releasedVisual.energizedSpool);
  assert.ok(
    releasedVisual.exhaustEnergyNormalized < previousVisual.exhaustEnergyNormalized,
    'Released exhaust energy must decay monotonically with the authoritative core spool'
  );
  assert.ok(
    releasedVisual.mainPlumeLength < previousVisual.mainPlumeLength,
    'Released main-plume length must decay monotonically with the authoritative core spool'
  );
  assert.ok(
    releasedVisual.mainPlumeOpacity < previousVisual.mainPlumeOpacity,
    'Released main-plume opacity must decay monotonically with the authoritative core spool'
  );
  assert.ok(releasedVisual.mainPlumeLength > zeroPowerVisual.mainPlumeLength);
  assert.ok(releasedVisual.mainPlumeOpacity > zeroPowerVisual.mainPlumeOpacity);
}
const unloadedZeroThrustVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: 1,
  coreRpm: 13_962,
  thrustNormalized: 0,
  steeringActuator: 0,
  gearTorqueAvailability: 0,
  gearLuggingSeverity: 1,
  gearLoadNormalized: 0,
  gearLugging: true,
  gearStalled: true
}, {});
const stalledUnderLoadVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: 1,
  coreRpm: 13_962,
  thrustNormalized: 0,
  steeringActuator: 0,
  gearTorqueAvailability: 0,
  gearLuggingSeverity: 1,
  gearLoadNormalized: 1,
  gearLugging: true,
  gearStalled: true
}, {});
assert.equal(stalledUnderLoadVisual.gearTorqueAvailability, 0);
assert.equal(stalledUnderLoadVisual.gearLuggingSeverity, 1);
assert.equal(stalledUnderLoadVisual.gearLoadNormalized, 1);
assert.ok(stalledUnderLoadVisual.energizedSpool < unloadedZeroThrustVisual.energizedSpool);
assert.equal(unloadedZeroThrustVisual.exhaustEnergyNormalized, 1);
assert.equal(
  stalledUnderLoadVisual.exhaustEnergyNormalized,
  stalledUnderLoadVisual.energizedSpool
);
assert.ok(
  stalledUnderLoadVisual.mainPlumeLength < unloadedZeroThrustVisual.mainPlumeLength * 0.50,
  'A fully loaded stalled gear must visibly shorten the mean main plume'
);
assert.ok(
  stalledUnderLoadVisual.mainPlumeOpacity < unloadedZeroThrustVisual.mainPlumeOpacity * 0.40,
  'A fully loaded stalled gear must visibly darken the mean main plume'
);
assert.ok(stalledUnderLoadVisual.innerPlumeLength < unloadedZeroThrustVisual.innerPlumeLength);
assert.ok(stalledUnderLoadVisual.sidePlumeOpacity < unloadedZeroThrustVisual.sidePlumeOpacity);
const clampedVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: 9,
  coreRpm: Number.NaN,
  thrustNormalized: -4,
  steeringActuator: Number.POSITIVE_INFINITY
}, {});
assert.equal(clampedVisual.coreSpool, 1);
assert.equal(clampedVisual.coreRpm, 0);
assert.equal(clampedVisual.thrustNormalized, 0);
assert.equal(clampedVisual.steeringActuator, 0);
assert.equal(clampedVisual.energizedSpool, 1);
assert.equal(clampedVisual.exhaustEnergyNormalized, 1);
assert.equal(clampedVisual.leftThrustNormalized, 0);
assert.equal(clampedVisual.rightThrustNormalized, 0);
for (const value of Object.values(clampedVisual)) {
  assert.ok(Number.isFinite(value), 'Invalid authoritative fields must resolve to finite visual targets');
}
const independentlyClampedVisual = shipModule.derivePropulsionVisualTargets({
  coreSpool: -9,
  coreRpm: Number.POSITIVE_INFINITY,
  thrustNormalized: 9,
  steeringActuator: Number.NEGATIVE_INFINITY,
  gearTorqueAvailability: -2,
  gearLuggingSeverity: 8,
  gearLoadNormalized: 3
}, {});
assert.equal(independentlyClampedVisual.coreSpool, 0);
assert.equal(independentlyClampedVisual.coreRpm, 0);
assert.equal(independentlyClampedVisual.thrustNormalized, 1);
assert.equal(independentlyClampedVisual.steeringActuator, 0);
assert.equal(independentlyClampedVisual.gearTorqueAvailability, 0);
assert.equal(independentlyClampedVisual.gearLuggingSeverity, 1);
assert.equal(independentlyClampedVisual.gearLoadNormalized, 1);
assert.equal(independentlyClampedVisual.energizedSpool, 0);
assert.equal(independentlyClampedVisual.exhaustEnergyNormalized, 1);
for (const value of Object.values(independentlyClampedVisual)) {
  assert.ok(Number.isFinite(value), 'Every independently clamped visual field must remain finite');
}

const stoppedSpeedCue = shipModule.deriveSpeedCueTargets(0, 0, {});
const lowSpeedCue = shipModule.deriveSpeedCueTargets(60, 0.62, {});
const automaticCruiseCue = shipModule.deriveSpeedCueTargets(120, 0.62, {});
const maximumSpeedCue = shipModule.deriveSpeedCueTargets(160, 1, {});
assert.equal(stoppedSpeedCue.streakIntensity, 0, 'A stationary craft must not invent optic flow');
assert.equal(lowSpeedCue.streakIntensity, 0, 'Low-speed travel must rely on world parallax, not fake streaks');
assert.ok(
  automaticCruiseCue.streakIntensity > 0
    && automaticCruiseCue.streakIntensity < maximumSpeedCue.streakIntensity
);
assert.equal(maximumSpeedCue.streakTravelKmh, 160);
assert.ok(Math.abs(maximumSpeedCue.streakTravelMetersPerSecond - 160 / 3.6) <= 0.000_000_001);
assert.ok(
  Math.abs(
    maximumSpeedCue.streakCyclesPerSecond * contract.speedStreakLoopSpanM
      - maximumSpeedCue.streakTravelMetersPerSecond
  ) <= 0.000_000_001,
  'Optic-flow travel must equal the HUD speed after the km/h conversion boundary'
);
assert.ok(maximumSpeedCue.streakLengthM > 0);
assert.ok(maximumSpeedCue.streakLengthM <= contract.speedStreakMaximumLengthM);
const reducedSpeedCueOutput = { streakIntensity: 99 };
assert.equal(
  shipModule.deriveSpeedCueTargets(160, 1, reducedSpeedCueOutput, true),
  reducedSpeedCueOutput,
  'Reduced-motion optic-flow suppression must preserve the reusable output contract'
);
assert.deepEqual(reducedSpeedCueOutput, {
  streakIntensity: 0,
  streakTravelKmh: 0,
  streakTravelMetersPerSecond: 0,
  streakCyclesPerSecond: 0,
  streakLengthM: 0
});

const cruiseOutput = {};
const launchCruise = shipModule.deriveCruiseDynamics(8.25, 120, {
  steer: 0,
  lateralVelocity: 0,
  curvature: 0,
  enclosureBlend: 0,
  grounded: true
}, cruiseOutput);
assert.equal(launchCruise, cruiseOutput, 'Cruise dynamics must support one reusable hot-path output');
assert.ok(launchCruise.activity > 0, 'Automatic cruise must already have subtle open-road motion');
assert.ok(
  Math.abs(launchCruise.shipLateralM) <= shipModule.CRUISE_DYNAMICS_CONTRACT.maximumShipLateralM
    && Math.abs(launchCruise.shipLiftM) <= shipModule.CRUISE_DYNAMICS_CONTRACT.maximumShipLiftM,
  'Cruise translation must remain inside its visual-only envelope'
);
assert.ok(launchCruise.shipLiftM >= 0, 'Grounded cruise motion must not consume road-clearance height');
assert.ok(
  Math.abs(launchCruise.shipYawRad) <= shipModule.CRUISE_DYNAMICS_CONTRACT.maximumShipYawRad
    && Math.abs(launchCruise.shipRollRad) <= shipModule.CRUISE_DYNAMICS_CONTRACT.maximumShipRollRad
    && Math.abs(launchCruise.shipPitchRad) <= shipModule.CRUISE_DYNAMICS_CONTRACT.maximumShipPitchRad,
  'Cruise attitude must remain inside its visual-only envelope'
);
assert.deepEqual(
  shipModule.deriveCruiseDynamics(8.25, 120, {
    steer: 0,
    lateralVelocity: 0,
    curvature: 0,
    enclosureBlend: 0,
    grounded: true
  }, {}),
  launchCruise,
  'Cruise dynamics must be deterministic for replayable browser validation'
);
const reducedCruise = shipModule.deriveCruiseDynamics(8.25, 160, {
  steer: 0,
  lateralVelocity: 0,
  curvature: 0,
  enclosureBlend: 0,
  grounded: true,
  reducedMotion: true
}, {});
assert.equal(reducedCruise.activity, 0);
assert.equal(reducedCruise.shipLateralM, 0);
assert.equal(reducedCruise.shipLiftM, 0);
assert.equal(reducedCruise.cameraSideM, 0);
assert.equal(reducedCruise.cameraRollRad, 0);
for (const context of [
  { steer: 1, lateralVelocity: 0, curvature: 0, enclosureBlend: 0, grounded: true },
  { steer: 0, lateralVelocity: 22, curvature: 0, enclosureBlend: 0, grounded: true },
  { steer: 0, lateralVelocity: 0, curvature: 0.001_2, enclosureBlend: 0, grounded: true },
  { steer: 0, lateralVelocity: 0, curvature: 0, enclosureBlend: 1, grounded: true },
  { steer: 0, lateralVelocity: 0, curvature: 0, enclosureBlend: 0, grounded: false }
]) {
  const suppressed = shipModule.deriveCruiseDynamics(8.25, 160, context, {});
  assert.equal(suppressed.activity, 0, 'Authored steering, curves, cover, and flight must suppress cruise motion');
  assert.equal(suppressed.shipLateralM, 0);
  assert.equal(suppressed.cameraSideM, 0);
}

const source = fs.readFileSync(
  path.join(PROJECT_ROOT, 'src/entities/Neon_Autopilot_V23_HighSpeed_DroneHeat.ship.js'),
  'utf8'
);
assert.match(
  source,
  /const playerHalf = \{ \.\.\.SURFACE_FOOTPRINT_CONTRACT\.colliderHalf \};/,
  'The runtime collision proxy must copy the sole surface-footprint authority'
);
assert.match(
  source,
  /\[2\.62, 0\.28\]/,
  'The healthy manta-cape silhouette no longer reaches the contracted 5.24m span'
);
assert.match(source, /const capeInsetMat = modeling\.createMaterial/, 'The woven second cape layer is missing');
assert.match(source, /const spiritWakeRibbons = \[\];/, 'The layered candle wake is missing');
assert.match(source, /transmission: 0\.46,/, 'The restrained nose pearl must retain physical transmission');
assert.match(source, /ior: 1\.42,/, 'The nose pearl must retain its dielectric index of refraction');
assert.match(source, /attenuationDistance: 1\.8,/, 'The nose pearl requires bounded volumetric attenuation');
assert.match(source, /mesh\.receiveShadow = true;/, 'Every sealed ship surface must receive real shadows');
assert.match(
  source,
  /mesh\.castShadow = !hasTransmissiveGlass;/,
  'Transmissive glass must not cast an opaque shadow-map silhouette'
);
assert.doesNotMatch(source, /new THREE\.(?:PointLight|SpotLight)/, 'Ship emitters must not project player-following pools onto the road');
assert.doesNotMatch(source, /configureLocalPointLight|setPhysicalLightingEnabled/);
assert.match(
  source,
  /opacity: 0\.04, depthWrite: false/,
  'The visual contact grounding layer must remain below 0.05 opacity'
);
assert.match(
  source,
  /deriveSpeedCueTargets\(0, 0, propulsionFeedback, true\);/,
  'The cold-start frozen propulsion packet must contain finite optic-flow diagnostics'
);

const lifeFormStart = source.indexOf('function updateShipLifeForm(');
const lifeFormEnd = source.indexOf('// Initialize the correct sealed life form', lifeFormStart);
assert.ok(lifeFormStart >= 0 && lifeFormEnd > lifeFormStart, 'Life-form update source contract is missing');
const lifeFormSource = source.slice(lifeFormStart, lifeFormEnd);
assert.doesNotMatch(
  lifeFormSource,
  /new THREE\.Color/,
  'The per-frame life-form update must reuse its construction-time color palette and targets'
);
assert.doesNotMatch(
  lifeFormSource,
  /(?:flame\.scale\.y|flame\.material\.opacity|playerShadow\.scale\.x)\s*\*=/,
  'Paused or ended frames must not multiply a previously modulated visual value again'
);
assert.match(lifeFormSource, /refreshVisualBaseline/);
assert.match(lifeFormSource, /lifeVisualBaseline\.playerShadowScaleX \* \(healthy/);
assert.match(lifeFormSource, /deriveShipHeatTarget\(\(Number\(state\.speed\) \|\| 0\) \* 3\.6\)/);
assert.match(lifeFormSource, /const extremeHeat = heat \* heat;/);
assert.doesNotMatch(lifeFormSource, /normalStartSpeed|\+ 16|\/ 96|speed - 122|\/ 58/);
assert.match(source, /function resolveLifeFormBlend\(referenceBlend, dt\)/);
assert.match(source, /1 - Math\.pow\(1 - referenceBlend, elapsed \* 60\)/);

const shipScene = new THREE.Scene();
const shipConstructionQuality = global.window.NeonV23Modeling.resolveQualityProfile('high');
const shipState = {
  lives: 3,
  speed: 0,
  handling: { colorProgress: 0 }
};
global.window.location.search = '?quality=medium';
const createdShip = shipModule.createShip({
  THREE,
  scene: shipScene,
  state: shipState,
  roadY: 0,
  clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
  lerp: (start, end, amount) => start + (end - start) * amount,
  rand: () => 0.5,
  quality: shipConstructionQuality
});
assert.ok(createdShip.player);
assert.deepEqual(createdShip.playerHalf, surfaceFootprintContract.colliderHalf);
assert.notEqual(
  createdShip.playerHalf,
  surfaceFootprintContract.colliderHalf,
  'createShip must return a runtime-owned copy rather than exposing the frozen contract object'
);
shipScene.updateMatrixWorld(true);

function requireSceneObject(name) {
  const object = shipScene.getObjectByName(name);
  assert.ok(object, `${name} is missing`);
  return object;
}

const runtimeFunctionInventory = [
  'updatePropulsionFeedback',
  'resetPropulsionFeedback',
  'prepareInvulnerabilityShieldCompilation',
  'updateInvulnerabilityShieldPresentation',
  'resetInvulnerabilityShieldPresentation',
  'updateShipLifeForm',
  'setRenderQuality',
  'setTunnelBounce',
  'getRenderQualityDiagnostics',
  'dispose'
];
for (const functionName of runtimeFunctionInventory) {
  assert.equal(typeof createdShip[functionName], 'function', `createShip lost ${functionName}`);
}
for (const objectName of [
  'V23.Ship.streamlined-fuselage',
  'V23.Ship.sealed-belly-shell',
  'V23.Ship.embedded-canopy',
  'V23.Ship.nose-lens',
  'V23.Ship.candle-soul-core',
  'V23.Ship.four-point-dawn-mark',
  'V23.Ship.cape-wing-left',
  'V23.Ship.cape-inset-left',
  'V23.Ship.cape-wing-right-healthy',
  'V23.Ship.cape-inset-right-healthy',
  'V23.Ship.cape-wing-right-wounded-sealed',
  'V23.Ship.cape-inset-right-wounded-sealed',
  'V23.Ship.cape-wing-right-critical-sealed',
  'V23.Ship.cape-inset-right-critical-sealed',
  'V23.Ship.spirit-scarf-tail-left',
  'V23.Ship.spirit-scarf-tail-right',
  'V23.Ship.main-engine-cowl',
  'V23.Ship.sealed-main-nozzle',
  'V23.Ship.side-pod-left',
  'V23.Ship.side-pod-right',
  'V23.ShipEffect.main-flame',
  'V23.ShipEffect.inner-flame',
  'V23.ShipEffect.side-flame-left',
  'V23.ShipEffect.side-flame-right',
  'V23.ShipEffect.side-inner-flame-left',
  'V23.ShipEffect.side-inner-flame-right',
  'V23.ShipEffect.brake-nozzle-left',
  'V23.ShipEffect.brake-nozzle-right',
  'V23.ShipEffect.brake-flare-left',
  'V23.ShipEffect.brake-flare-right',
  'V23.ShipEffect.brake-inner-flare-left',
  'V23.ShipEffect.brake-inner-flare-right',
  'V23.ShipEffect.spirit-wake-ribbon-1',
  'V23.ShipEffect.spirit-wake-ribbon-2',
  'V23.ShipEffect.spirit-wake-ribbon-3',
  'V23.ShipEffect.spirit-wake-ribbon-4',
  'V23.ShipEffect.speed-streaks',
  'V23.ShipEffect.shield',
  'V23.ShipEffect.shield-field',
  'V23.ShipEffect.shield-anchor-array',
  'V23.ShipEffect.top-view-halo',
  'V23.Ship.DamageEffects',
  'V23.ShipEffect.scorch-nose',
  'V23.ShipEffect.canopy-crack-left',
  'V23.ShipEffect.damage-spark-0'
]) {
  requireSceneObject(objectName);
}
assert.equal(createdShip.sideFlames.length, 2, 'Mirrored forward side plumes must remain available');
assert.equal(createdShip.sideInnerFlames.length, 2, 'Mirrored side-plume cores must remain available');
assert.equal(createdShip.sideEngineShells.length, 2, 'Mirrored side apertures must remain available');
assert.equal(createdShip.thrusterRings.length, 3, 'Primary and paired side energy rings must remain available');

const allShipObjects = [];
createdShip.player.traverse((object) => allShipObjects.push(object));
const spiritEyes = allShipObjects.filter((object) => object.name.startsWith('V23.ShipEffect.spirit-eye-'));
assert.equal(spiritEyes.length, capeContract.spiritMaskEyeCount);
const leftCapePleats = allShipObjects.filter((object) => object.name.startsWith('V23.ShipEffect.cape-rib-left-'));
const healthyRightCapePleats = allShipObjects.filter((object) => (
  object.name === 'V23.ShipEffect.cape-rib-right-healthy'
  || object.name.startsWith('V23.ShipEffect.cape-rib-right-healthy-')
));
assert.equal(leftCapePleats.length, capeContract.capePleatCountPerWing);
assert.equal(healthyRightCapePleats.length, capeContract.capePleatCountPerWing);
const visibleMechanicalPanels = allShipObjects.filter((object) => /(?:body|armo(?:u)?r)-panel/i.test(object.name));
const visibleTurbines = allShipObjects.filter((object) => /(?:turbine|intake)/i.test(object.name));
assert.equal(visibleMechanicalPanels.length, capeContract.visibleMechanicalPanelCount);
assert.equal(visibleTurbines.length, capeContract.visibleTurbineCount);

/** Return whether an object and every parent up to the ship root participates in the current life form. */
function isVisibleWithinShip(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
    if (current === createdShip.player) return true;
  }
  return false;
}

/** Measure authored vertices in ship-local space so rotated child bounds cannot create false clearance failures. */
function measureActiveMainVisualBounds() {
  shipScene.updateMatrixWorld(true);
  const shipWorldInverse = createdShip.player.matrixWorld.clone().invert();
  const bounds = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  let meshCount = 0;
  let vertexCount = 0;
  createdShip.player.traverse((object) => {
    if (
      !object.isMesh
      || object.userData.neonV23?.modelClass !== 'main-visual'
      || !isVisibleWithinShip(object)
    ) return;
    const positions = object.geometry?.getAttribute?.('position');
    assert.ok(positions, `${object.name} main geometry has no position attribute`);
    const objectToShip = shipWorldInverse.clone().multiply(object.matrixWorld);
    meshCount++;
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(objectToShip);
      bounds.expandByPoint(point);
      vertexCount++;
    }
  });
  assert.ok(meshCount > 0 && vertexCount > 0, 'Active life form must contain measurable main geometry');
  return bounds;
}

const lifeFormBounds = new Map();
for (const [label, lives] of [['healthy', 3], ['wounded', 2], ['critical', 1]]) {
  shipState.lives = lives;
  createdShip.updateShipLifeForm(0, 1, true, false, 1 / 60);
  const bounds = measureActiveMainVisualBounds();
  lifeFormBounds.set(label, bounds.clone());
  const tolerance = capeContract.healthyMirrorToleranceM * 10;
  assert.ok(
    bounds.min.x >= -coveredClearanceContract.mainVisualHalfWidthM - tolerance
      && bounds.max.x <= coveredClearanceContract.mainVisualHalfWidthM + tolerance,
    `${label} main visual exceeds the declared lateral envelope: ${bounds.min.x}..${bounds.max.x}`
  );
  assert.ok(
    bounds.min.y >= coveredClearanceContract.mainVisualMinimumYM - tolerance
      && bounds.max.y <= coveredClearanceContract.mainVisualMaximumYM + tolerance,
    `${label} main visual exceeds the declared vertical envelope: ${bounds.min.y}..${bounds.max.y}`
  );
  assert.ok(
    bounds.min.z >= -coveredClearanceContract.mainVisualForwardM - tolerance
      && bounds.max.z <= coveredClearanceContract.mainVisualAftM + tolerance,
    `${label} main visual exceeds the declared longitudinal envelope: ${bounds.min.z}..${bounds.max.z}`
  );
}
const healthyMainBounds = lifeFormBounds.get('healthy');
assert.ok(
  Math.abs(healthyMainBounds.min.x + coveredClearanceContract.mainVisualHalfWidthM)
      <= capeContract.healthyMirrorToleranceM * 10
    && Math.abs(healthyMainBounds.max.x - coveredClearanceContract.mainVisualHalfWidthM)
      <= capeContract.healthyMirrorToleranceM * 10,
  'Healthy main geometry must realize the complete declared 5.24m cape span'
);
assert.ok(
  lifeFormBounds.get('wounded').max.x < healthyMainBounds.max.x
    && lifeFormBounds.get('critical').max.x < lifeFormBounds.get('wounded').max.x,
  'Damage silhouettes must remain sealed while visibly shortening the right cape'
);
shipState.lives = 3;
createdShip.updateShipLifeForm(0, 1, true, false, 1 / 60);
shipScene.updateMatrixWorld(true);

/** Measure a plume from its fixed local origin along its transformed local +Y growth axis. */
function measurePlumeAxis(objectName) {
  const plume = requireSceneObject(objectName);
  shipScene.updateMatrixWorld(true);
  const objectToShip = createdShip.player.matrixWorld.clone().invert().multiply(plume.matrixWorld);
  const root = new THREE.Vector3(0, 0, 0).applyMatrix4(objectToShip);
  const axis = new THREE.Vector3(0, 1, 0).applyMatrix4(objectToShip).sub(root).normalize();
  const positions = plume.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  let minimumAxialM = Infinity;
  let maximumAxialM = -Infinity;
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).applyMatrix4(objectToShip);
    const axialM = point.sub(root).dot(axis);
    minimumAxialM = Math.min(minimumAxialM, axialM);
    maximumAxialM = Math.max(maximumAxialM, axialM);
  }
  return { objectName, root, axis, minimumAxialM, maximumAxialM };
}

function assertRootAnchoredPlume(sample, rootZM, growthDirectionZ) {
  const tolerance = componentClearanceContract.plumeRootToleranceM;
  assert.ok(
    Math.abs(sample.root.z - rootZM) <= tolerance,
    `${sample.objectName} root drifted from ${rootZM}m to ${sample.root.z}m`
  );
  assert.ok(
    sample.minimumAxialM >= -tolerance && sample.minimumAxialM <= tolerance,
    `${sample.objectName} must touch, but never penetrate ahead of, its aperture plane`
  );
  assert.ok(sample.maximumAxialM > tolerance, `${sample.objectName} has no one-way tail extension`);
  assert.ok(
    sample.axis.z * growthDirectionZ > 0.99,
    `${sample.objectName} grew toward the hull instead of away from its aperture`
  );
}

function assertUnchangedPlumeRoot(before, after) {
  assert.ok(
    before.root.distanceTo(after.root) <= componentClearanceContract.plumeRootToleranceM,
    `${after.objectName} root moved while its tail length or steering changed`
  );
}

assert.equal(typeof createdShip.updateInvulnerabilityShieldPresentation, 'function');
assert.equal(typeof createdShip.resetInvulnerabilityShieldPresentation, 'function');
assert.equal(typeof createdShip.prepareInvulnerabilityShieldCompilation, 'function');
const shield = requireSceneObject('V23.ShipEffect.shield');
const shieldField = requireSceneObject('V23.ShipEffect.shield-field');
const shieldOrbits = [
  requireSceneObject('V23.ShipEffect.shield-orbit-horizon'),
  requireSceneObject('V23.ShipEffect.shield-orbit-meridian'),
  requireSceneObject('V23.ShipEffect.shield-orbit-crown')
];
const shieldAnchors = requireSceneObject('V23.ShipEffect.shield-anchor-array');
assert.equal(shield.isGroup, true);
assert.equal(shield.visible, false);
assert.equal(shieldField.material.isShaderMaterial, true);
assert.equal(shieldField.material.transparent, true);
assert.equal(shieldField.material.depthWrite, false);
assert.equal(shieldField.material.side, THREE.FrontSide);
assert.equal(shieldField.material.fog, true);
for (const fogUniformName of ['fogColor', 'fogDensity', 'fogNear', 'fogFar']) {
  assert.ok(
    shieldField.material.uniforms[fogUniformName],
    `Fog-aware shield shader must own ${fogUniformName}`
  );
  assert.notEqual(
    shieldField.material.uniforms[fogUniformName],
    THREE.UniformsLib.fog[fogUniformName],
    `${fogUniformName} must be cloned instead of sharing Three's library uniform`
  );
}
assert.notEqual(
  shieldField.material.uniforms.fogColor.value,
  THREE.UniformsLib.fog.fogColor.value,
  'Fog colour must use a material-owned Color instance'
);
assert.notEqual(shieldField.userData.neonV23Bloom, true, 'The broad field must not enter selective Bloom');
assert.equal(shieldAnchors.isInstancedMesh, true);
assert.equal(shieldAnchors.count, shieldContract.anchorCount);
for (const effect of [shield, shieldField, ...shieldOrbits, shieldAnchors]) {
  assert.equal(effect.userData.neonV23.modelClass, 'effect');
  assert.equal(effect.userData.neonV23.collisionIndependent, true);
  assert.notEqual(effect.castShadow, true);
  assert.notEqual(effect.receiveShadow, true);
}
for (const emitter of [...shieldOrbits, shieldAnchors]) {
  assert.equal(emitter.userData.neonV23Bloom, true, `${emitter.name} must be an explicit narrow Bloom emitter`);
  assert.equal(emitter.layers.isEnabled(12), true);
}
const shieldFieldTopology = global.window.NeonV23Modeling.analyzeTopology(shieldField.geometry);
assert.equal(shieldFieldTopology.isClosed, true);
assert.equal(shieldFieldTopology.invalidCoordinates, 0);
assert.equal(shieldFieldTopology.degenerateTriangles, 0);
shieldField.geometry.computeBoundingBox();
assert.ok(shieldField.geometry.boundingBox.min.x <= -coveredClearanceContract.mainVisualHalfWidthM);
assert.ok(shieldField.geometry.boundingBox.max.x >= coveredClearanceContract.mainVisualHalfWidthM);
assert.ok(shieldField.geometry.boundingBox.min.y <= coveredClearanceContract.mainVisualMinimumYM);
assert.ok(shieldField.geometry.boundingBox.max.y >= coveredClearanceContract.mainVisualMaximumYM);
assert.ok(shieldField.geometry.boundingBox.min.z <= -coveredClearanceContract.mainVisualForwardM);
assert.ok(shieldField.geometry.boundingBox.max.z >= coveredClearanceContract.mainVisualAftM);

createdShip.prepareInvulnerabilityShieldCompilation();
assert.equal(shield.visible, true, 'Startup compilation must traverse the hidden collision ward');
assert.equal(shieldField.material.uniforms.uOpacity.value, 0);
assert.equal(shieldOrbits.every((orbit) => orbit.visible && orbit.material.opacity === 0), true);
assert.equal(shieldAnchors.visible, true);
assert.equal(shieldAnchors.count, shieldContract.anchorCount);
assert.equal(shieldAnchors.material.opacity, 0);
createdShip.resetInvulnerabilityShieldPresentation();
assert.equal(shield.visible, false, 'Startup compilation cleanup must restore the hidden baseline');

const gameplayStateBeforeShieldPreview = JSON.stringify(shipState);
const deployedShield = createdShip.updateInvulnerabilityShieldPresentation({
  remainingSeconds: 1.32,
  totalSeconds: 1.32,
  impactFeedbackSeconds: 0.48,
  presentationDt: 1 / 60,
  reducedMotion: false,
  frozen: false,
  viewMode: 'external'
});
assert.equal(deployedShield.active, true);
assert.equal(shield.visible, true);
assert.ok(shieldField.material.uniforms.uOpacity.value > 0);
assert.equal(shieldOrbits.filter((orbit) => orbit.visible).length, 2, 'Medium keeps two readable orbit arcs');
assert.equal(shieldAnchors.count, 3, 'Medium keeps three instanced anchors');
const movingTravel = shieldField.material.uniforms.uTravel.value;
createdShip.updateInvulnerabilityShieldPresentation({
  remainingSeconds: 1.20,
  totalSeconds: 1.32,
  impactFeedbackSeconds: 0.48,
  presentationDt: 1 / 30,
  reducedMotion: false,
  frozen: true,
  viewMode: 'external'
});
assert.equal(
  shieldField.material.uniforms.uTravel.value,
  movingTravel,
  'Paused protection must freeze the ward phase without hiding it'
);
createdShip.updateInvulnerabilityShieldPresentation({
  remainingSeconds: 1.10,
  totalSeconds: 1.32,
  impactFeedbackSeconds: 0.48,
  presentationDt: 1 / 30,
  reducedMotion: true,
  frozen: false,
  viewMode: 'external'
});
assert.equal(shieldField.material.uniforms.uTravel.value, 0);
assert.deepEqual(shield.rotation.toArray().slice(0, 3), [0, 0, 0]);
assert.deepEqual(shield.scale.toArray(), [1, 1, 1], 'Reduced Motion must keep the ward envelope static');
createdShip.updateInvulnerabilityShieldPresentation({
  remainingSeconds: 0.90,
  totalSeconds: 1.32,
  impactFeedbackSeconds: 0.48,
  presentationDt: 1 / 60,
  viewMode: 'hood'
});
assert.equal(shield.visible, false, 'Hood view must not put a world shell against the camera lens');
createdShip.updateInvulnerabilityShieldPresentation({
  remainingSeconds: 0.80,
  totalSeconds: 1.32,
  impactFeedbackSeconds: 0.48,
  presentationDt: 1 / 60,
  viewMode: 'top'
});
assert.equal(shield.visible, true);
assert.equal(shieldOrbits.some((orbit) => orbit.visible), false, 'Top view reuses its existing halo');
assert.equal(shieldAnchors.count, 0);
assert.equal(createdShip.topViewHalo.visible, true);
createdShip.updateInvulnerabilityShieldPresentation({ remainingSeconds: 0, totalSeconds: 1.32 });
assert.equal(shield.visible, false);
assert.equal(shieldField.material.uniforms.uOpacity.value, 0);
assert.equal(JSON.stringify(shipState), gameplayStateBeforeShieldPreview, 'Shield presentation cannot mutate gameplay');

function capCenterWorldNormal(objectName, endCap = false) {
  const mesh = requireSceneObject(objectName);
  const normals = mesh.geometry.getAttribute('normal');
  const index = normals.count - (endCap ? 1 : 2);
  return new THREE.Vector3()
    .fromBufferAttribute(normals, index)
    .transformDirection(mesh.matrixWorld);
}

for (const name of [
  'V23.Ship.cape-wing-left',
  'V23.Ship.cape-wing-right-healthy',
  'V23.Ship.cape-inset-left',
  'V23.Ship.cape-inset-right-healthy',
  'V23.Ship.spirit-scarf-tail-left',
  'V23.Ship.spirit-scarf-tail-right'
]) {
  assert.ok(capCenterWorldNormal(name).y > 0.99, `${name} top cap must face upward`);
}
for (const name of ['V23.Ship.tail-fin-left', 'V23.Ship.tail-fin-right-healthy']) {
  assert.ok(capCenterWorldNormal(name, true).z > 0.99, `${name} rear cap must face the chase camera`);
}

function assertMirroredGeometryBounds(leftName, rightName) {
  const left = requireSceneObject(leftName).geometry;
  const right = requireSceneObject(rightName).geometry;
  left.computeBoundingBox();
  right.computeBoundingBox();
  const close = (actual, expected, label) => assert.ok(
    Math.abs(actual - expected) <= capeContract.healthyMirrorToleranceM,
    `${label}: expected ${expected}, received ${actual}`
  );
  close(left.boundingBox.min.x, -right.boundingBox.max.x, `${leftName} minX`);
  close(left.boundingBox.max.x, -right.boundingBox.min.x, `${leftName} maxX`);
  for (const axis of ['y', 'z']) {
    close(left.boundingBox.min[axis], right.boundingBox.min[axis], `${leftName} min${axis}`);
    close(left.boundingBox.max[axis], right.boundingBox.max[axis], `${leftName} max${axis}`);
  }
}

for (const [leftName, rightName] of [
  ['V23.Ship.cape-wing-left', 'V23.Ship.cape-wing-right-healthy'],
  ['V23.Ship.cape-inset-left', 'V23.Ship.cape-inset-right-healthy'],
  ['V23.Ship.tail-fin-left', 'V23.Ship.tail-fin-right-healthy'],
  ['V23.Ship.spirit-scarf-tail-left', 'V23.Ship.spirit-scarf-tail-right'],
  ['V23.ShipEffect.cape-edge-left', 'V23.ShipEffect.cape-edge-right-healthy']
]) {
  assertMirroredGeometryBounds(leftName, rightName);
}

const healthyRightEdge = requireSceneObject('V23.ShipEffect.cape-edge-right-healthy');
assert.equal(healthyRightEdge.parent.name, 'V23.ShipCape.right.healthy');
for (const [leftName, rightName] of [
  ['V23.ShipEffect.hull-flow-left', 'V23.ShipEffect.hull-flow-right'],
  ['V23.ShipEffect.spirit-scarf-seam-left', 'V23.ShipEffect.spirit-scarf-seam-right'],
  ['V23.ShipEffect.cape-rim-left', 'V23.ShipEffect.cape-rim-right-healthy'],
  ['V23.ShipEffect.constellation-thread-left', 'V23.ShipEffect.constellation-thread-right-healthy'],
  ['V23.ShipEffect.cape-rib-left-forward', 'V23.ShipEffect.cape-rib-right-healthy'],
  ['V23.ShipEffect.cape-rib-left-aft', 'V23.ShipEffect.cape-rib-right-healthy-aft'],
  ['V23.ShipEffect.wingtip-light-left', 'V23.ShipEffect.wingtip-light-right-healthy']
]) {
  assert.equal(
    requireSceneObject(leftName).userData.phase,
    requireSceneObject(rightName).userData.phase,
    `${leftName} and ${rightName} must animate in phase`
  );
}
for (let index = 1; index <= 4; index++) {
  assert.equal(
    requireSceneObject(`V23.ShipEffect.constellation-node-left-${index}`).userData.phase,
    requireSceneObject(`V23.ShipEffect.constellation-node-right-healthy-${index}`).userData.phase
  );
}

const shipLights = [];
createdShip.player.traverse((object) => {
  if (object.isLight) shipLights.push(object);
});
assert.equal(shipLights.length, capeContract.roadProjectingLocalLightCount);

assert.equal(typeof createdShip.setRenderQuality, 'function');
assert.equal(typeof createdShip.getRenderQualityDiagnostics, 'function');
assert.equal(typeof createdShip.updatePropulsionFeedback, 'function');
assert.equal(typeof createdShip.resetPropulsionFeedback, 'function');
assert.equal(typeof createdShip.dispose, 'function');
const mainFlame = requireSceneObject('V23.ShipEffect.main-flame');
const innerMainFlame = requireSceneObject('V23.ShipEffect.inner-flame');
const leftSideFlame = requireSceneObject('V23.ShipEffect.side-flame-left');
const rightSideFlame = requireSceneObject('V23.ShipEffect.side-flame-right');
const forwardPlumeRoots = new Map([
  [mainFlame.name, componentClearanceContract.mainPlumeRootZM],
  [innerMainFlame.name, componentClearanceContract.mainPlumeRootZM],
  [leftSideFlame.name, componentClearanceContract.sidePlumeRootZM],
  [rightSideFlame.name, componentClearanceContract.sidePlumeRootZM],
  ['V23.ShipEffect.side-inner-flame-left', componentClearanceContract.sidePlumeRootZM],
  ['V23.ShipEffect.side-inner-flame-right', componentClearanceContract.sidePlumeRootZM]
]);

function captureForwardPlumes() {
  return new Map([...forwardPlumeRoots].map(([objectName, rootZM]) => {
    const sample = measurePlumeAxis(objectName);
    assertRootAnchoredPlume(sample, rootZM, 1);
    return [objectName, sample];
  }));
}

const coldStartFeedback = createdShip.updatePropulsionFeedback(0, 0, 0, { frozen: true }, true);
assert.equal(coldStartFeedback.coreSpool, 0);
assert.equal(
  coldStartFeedback.coreRpm,
  1_800,
  'Frozen pre-launch exhaust must share the runtime, HUD, and audio idle RPM'
);
assert.equal(coldStartFeedback.thrustNormalized, 0);
assert.equal(coldStartFeedback.energizedSpool, 0);
assert.equal(coldStartFeedback.exhaustEnergyNormalized, 0);
assert.equal(coldStartFeedback.steeringActuator, 0);
createdShip.resetPropulsionFeedback();
const idlePlumeSamples = captureForwardPlumes();
const fullPowerFeedback = createdShip.updatePropulsionFeedback(1 / 60, 0, 32, {
  coreSpool: 1,
  coreRpm: 12_000,
  thrustNormalized: 1,
  braking: false,
  steeringActuator: 0
}, true);
const fullPowerPlumeSamples = captureForwardPlumes();
for (const [objectName, fullPowerSample] of fullPowerPlumeSamples) {
  const idleSample = idlePlumeSamples.get(objectName);
  assertUnchangedPlumeRoot(idleSample, fullPowerSample);
  assert.ok(
    fullPowerSample.maximumAxialM > idleSample.maximumAxialM,
    `${objectName} full-power tail must extend aft while its aperture root stays fixed`
  );
}
const fullPowerFlame = {
  exhaustEnergyNormalized: fullPowerFeedback.exhaustEnergyNormalized,
  scaleY: mainFlame.scale.y,
  opacity: mainFlame.material.opacity
};
const firstReleaseSpool = Math.exp(-releaseDecayRatePerSecond / 60);
const firstReleaseFeedback = createdShip.updatePropulsionFeedback(1 / 60, 1_000 / 60, 32, {
  coreSpool: firstReleaseSpool,
  coreRpm: 1_800 + (12_000 - 1_800) * firstReleaseSpool,
  thrustNormalized: 0,
  braking: false,
  steeringActuator: 0
}, true);
assert.equal(fullPowerFlame.exhaustEnergyNormalized, 1);
assert.equal(firstReleaseFeedback.thrustNormalized, 0);
assert.equal(firstReleaseFeedback.throttleBlend, 0);
assert.equal(firstReleaseFeedback.exhaustEnergyNormalized, firstReleaseSpool);
assert.ok(
  mainFlame.scale.y > fullPowerFlame.scaleY * 0.97,
  'Rendered main exhaust must not collapse on the first throttle-release frame'
);
assert.ok(
  mainFlame.material.opacity > fullPowerFlame.opacity * 0.97,
  'Rendered main exhaust brightness must not collapse on the first throttle-release frame'
);
const poweredState = {
  coreSpool: 0.82,
  coreRpm: 10_164,
  thrustNormalized: 0.76,
  braking: false,
  steeringActuator: 0
};
createdShip.updatePropulsionFeedback(1 / 60, 1_000, 32, poweredState, true);
const lowSpeedPoweredFlame = {
  scaleX: mainFlame.scale.x,
  scaleY: mainFlame.scale.y,
  opacity: mainFlame.material.opacity
};
createdShip.updatePropulsionFeedback(1 / 60, 1_000, 300, poweredState, true);
assert.deepEqual(
  {
    scaleX: mainFlame.scale.x,
    scaleY: mainFlame.scale.y,
    opacity: mainFlame.material.opacity
  },
  lowSpeedPoweredFlame,
  'Vehicle speed may drive optic flow but must not stretch or brighten authoritative forward exhaust'
);
const stalledUnderLoadState = {
  coreSpool: 1,
  coreRpm: 13_962,
  thrustNormalized: 0,
  braking: false,
  steeringActuator: 0,
  gearTorqueAvailability: 0,
  gearLuggingSeverity: 1,
  gearLoadNormalized: 1,
  gearLugging: true,
  gearStalled: true
};
createdShip.updatePropulsionFeedback(1 / 60, 0, 7 / 3.6, {
  ...stalledUnderLoadState,
  gearLoadNormalized: 0
}, true);
const unloadedStalledPlume = {
  scaleY: mainFlame.scale.y,
  opacity: mainFlame.material.opacity
};
const reducedMotionLugging = createdShip.updatePropulsionFeedback(
  1 / 60,
  0,
  7 / 3.6,
  stalledUnderLoadState,
  true
);
const staticLuggingPlume = {
  scaleY: mainFlame.scale.y,
  opacity: mainFlame.material.opacity
};
assert.equal(reducedMotionLugging.luggingFlutterScale, 1);
assert.ok(staticLuggingPlume.scaleY < unloadedStalledPlume.scaleY * 0.50);
assert.ok(staticLuggingPlume.opacity < unloadedStalledPlume.opacity * 0.40);
createdShip.updatePropulsionFeedback(1 / 60, 900, 7 / 3.6, stalledUnderLoadState, true);
assert.deepEqual(
  { scaleY: mainFlame.scale.y, opacity: mainFlame.material.opacity },
  staticLuggingPlume,
  'Reduced motion must keep the authoritative static lugging attenuation without exhaust pulsing'
);
const dynamicLuggingA = createdShip.updatePropulsionFeedback(
  1 / 60,
  0,
  7 / 3.6,
  stalledUnderLoadState,
  false
);
const dynamicScaleA = mainFlame.scale.y;
const dynamicFlutterA = dynamicLuggingA.luggingFlutterScale;
const dynamicLuggingB = createdShip.updatePropulsionFeedback(
  1 / 60,
  Math.PI / (2 * luggingPresentationContract.flutterAngularRatePerMillisecond),
  7 / 3.6,
  stalledUnderLoadState,
  false
);
assert.ok(dynamicFlutterA >= luggingPresentationContract.minimumFlutterScale);
assert.ok(dynamicFlutterA <= luggingPresentationContract.maximumFlutterScale);
assert.ok(dynamicLuggingB.luggingFlutterScale >= luggingPresentationContract.minimumFlutterScale);
assert.ok(dynamicLuggingB.luggingFlutterScale <= luggingPresentationContract.maximumFlutterScale);
assert.notEqual(dynamicLuggingB.luggingFlutterScale, dynamicFlutterA);
assert.notEqual(mainFlame.scale.y, dynamicScaleA);
assert.ok(mainFlame.scale.y < staticLuggingPlume.scaleY);
const turnedFeedback = createdShip.updatePropulsionFeedback(1 / 60, 1_000, 300, {
  ...poweredState,
  steeringActuator: 1
}, true);
assert.equal(turnedFeedback.steerBlend, 1, 'Tail steering must consume the actuator without another smoothing stage');
assert.equal(
  (turnedFeedback.leftThrustNormalized + turnedFeedback.rightThrustNormalized) / 2,
  poweredState.thrustNormalized
);
assert.ok(leftSideFlame.scale.y > rightSideFlame.scale.y);
assert.ok(
  Math.abs(
    (leftSideFlame.scale.y + rightSideFlame.scale.y) / 2 - turnedFeedback.sidePlumeLength
  ) <= 1e-12,
  'Mirrored tail-plume lengths must preserve mean forward exhaust'
);
const fullSteerPlumeSamples = captureForwardPlumes();
for (const [objectName, fullSteerSample] of fullSteerPlumeSamples) {
  assertUnchangedPlumeRoot(idlePlumeSamples.get(objectName), fullSteerSample);
}
assert.ok(
  fullSteerPlumeSamples.get('V23.ShipEffect.side-flame-left').maximumAxialM
    > fullSteerPlumeSamples.get('V23.ShipEffect.side-flame-right').maximumAxialM,
  'Full-right steering must lengthen only the left outer tail from its fixed aperture'
);
assert.ok(
  fullSteerPlumeSamples.get('V23.ShipEffect.side-inner-flame-left').maximumAxialM
    > fullSteerPlumeSamples.get('V23.ShipEffect.side-inner-flame-right').maximumAxialM,
  'Full-right steering must lengthen only the left inner tail from its fixed aperture'
);
const brakingFeedback = createdShip.updatePropulsionFeedback(1 / 30, 1_100, 300, {
  coreSpool: 0.70,
  coreRpm: 8_940,
  thrustNormalized: 0,
  braking: true,
  steeringActuator: 0.25
}, true);
assert.equal(brakingFeedback.brakeFlareActive, true);
const brakingForwardPlumeSamples = captureForwardPlumes();
for (const [objectName, brakingSample] of brakingForwardPlumeSamples) {
  assertUnchangedPlumeRoot(idlePlumeSamples.get(objectName), brakingSample);
}
for (const side of ['left', 'right']) {
  const outerBrake = measurePlumeAxis(`V23.ShipEffect.brake-flare-${side}`);
  const innerBrake = measurePlumeAxis(`V23.ShipEffect.brake-inner-flare-${side}`);
  assertRootAnchoredPlume(outerBrake, componentClearanceContract.brakePlumeRootZM, -1);
  assertRootAnchoredPlume(innerBrake, componentClearanceContract.brakePlumeRootZM, -1);
  const expectedX = side === 'left'
    ? -shipModule.PROPULSION_CONTRACT.brakeNozzleX
    : shipModule.PROPULSION_CONTRACT.brakeNozzleX;
  assert.ok(
    Math.abs(outerBrake.root.x - expectedX) <= componentClearanceContract.plumeRootToleranceM,
    `${outerBrake.objectName} detached laterally from its reverse-light aperture`
  );
  assertUnchangedPlumeRoot(outerBrake, innerBrake);
}
const frozenSnapshot = {
  coreSpool: brakingFeedback.coreSpool,
  exhaustEnergyNormalized: brakingFeedback.exhaustEnergyNormalized,
  steeringActuator: brakingFeedback.steeringActuator,
  brakeBlend: brakingFeedback.brakeBlend,
  flameScaleY: mainFlame.scale.y,
  flameOpacity: mainFlame.material.opacity,
  leftScaleY: leftSideFlame.scale.y
};
createdShip.updatePropulsionFeedback(1, 9_000, 0, {
  coreSpool: 0,
  coreRpm: 0,
  thrustNormalized: 0,
  braking: false,
  steeringActuator: -1,
  frozen: true
}, false);
assert.deepEqual(
  {
    coreSpool: brakingFeedback.coreSpool,
    exhaustEnergyNormalized: brakingFeedback.exhaustEnergyNormalized,
    steeringActuator: brakingFeedback.steeringActuator,
    brakeBlend: brakingFeedback.brakeBlend,
    flameScaleY: mainFlame.scale.y,
    flameOpacity: mainFlame.material.opacity,
    leftScaleY: leftSideFlame.scale.y
  },
  frozenSnapshot,
  'Paused propulsion feedback must freeze the complete prior visual frame'
);
const resetFeedback = createdShip.resetPropulsionFeedback();
assert.equal(resetFeedback.coreSpool, 0);
assert.equal(resetFeedback.coreRpm, 1_800);
assert.equal(resetFeedback.thrustNormalized, 0);
assert.equal(resetFeedback.energizedSpool, 0);
assert.equal(resetFeedback.exhaustEnergyNormalized, 0);
assert.equal(resetFeedback.steeringActuator, 0);
assert.equal(resetFeedback.brakeFlareActive, false);
assert.equal(mainFlame.scale.y, resetFeedback.mainPlumeLength);
assert.equal(mainFlame.material.opacity, resetFeedback.mainPlumeOpacity);
const hull = requireSceneObject('V23.Ship.streamlined-fuselage');
const leftCape = requireSceneObject('V23.Ship.cape-wing-left');
const leftWingGlow = requireSceneObject('V23.ShipEffect.cape-edge-left');

/** Settle the deliberately smoothed material response without advancing any gameplay authority. */
function settleCandleColor(progress, lives = 3) {
  shipState.handling.colorProgress = progress;
  shipState.lives = lives;
  for (let frame = 0; frame < 180; frame++) {
    createdShip.updateShipLifeForm(0, 1, true, frame === 0, 1 / 60);
  }
  return {
    hull: hull.material.color.getHex(),
    cape: leftCape.material.color.getHex(),
    glow: leftWingGlow.material.color.getHex()
  };
}

const baselineCandleColors = settleCandleColor(0);
const halfCandleColors = settleCandleColor(0.5);
const fullCandleColors = settleCandleColor(1);
for (const channel of ['hull', 'cape', 'glow']) {
  assert.notEqual(
    halfCandleColors[channel],
    baselineCandleColors[channel],
    `${channel} must visibly change by the half-growth candle profile`
  );
  assert.notEqual(
    fullCandleColors[channel],
    halfCandleColors[channel],
    `${channel} must continue changing toward the candle-cyan profile`
  );
}
assert.equal(shipState.shipCandleColorProgress, 1);

/** Compare one wall-clock second of growth-color response rather than a fixed number of rendered frames. */
function sampleCandleColorCadence(cadenceHz) {
  shipState.lives = 3;
  shipState.handling.colorProgress = 0;
  for (let frame = 0; frame < 360; frame++) {
    createdShip.updateShipLifeForm(0, 1, true, frame === 0, 1 / 60);
  }
  shipState.handling.colorProgress = 1;
  for (let frame = 0; frame < cadenceHz; frame++) {
    createdShip.updateShipLifeForm(0, 1, true, false, 1 / cadenceHz);
  }
  return [
    hull.material.color.r,
    hull.material.color.g,
    hull.material.color.b,
    leftCape.material.color.r,
    leftCape.material.color.g,
    leftCape.material.color.b,
    leftWingGlow.material.color.r,
    leftWingGlow.material.color.g,
    leftWingGlow.material.color.b
  ];
}

const candleColorCadenceSamples = [30, 60, 120].map(sampleCandleColorCadence);
for (const sample of candleColorCadenceSamples.slice(1)) {
  sample.forEach((value, index) => {
    assert.ok(
      Math.abs(value - candleColorCadenceSamples[0][index]) <= 0.000_000_001,
      'Candle growth color must have the same one-second response at 30/60/120Hz'
    );
  });
}

const criticalCandleColors = settleCandleColor(1, 1);
const criticalHullColor = new THREE.Color(criticalCandleColors.hull);
assert.ok(
  criticalHullColor.r > criticalHullColor.g && criticalHullColor.r > criticalHullColor.b,
  'Critical red damage must remain the final safety cue above candle growth color'
);
assert.notEqual(criticalCandleColors.hull, fullCandleColors.hull);

// Use Three's production shader template: the bounce must reach its normal PBR diffuse integration while
// retaining the existing paint/roughness patterns, so the craft gains received light instead of self-emission.
function compileShipMaterialForTest(material) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

const bounceUniformName = shipModule.TUNNEL_BOUNCE_CONTRACT.uniformName;
const hullBounceShader = compileShipMaterialForTest(hull.material);
const sharedBounceUniform = hullBounceShader.uniforms[bounceUniformName];
assert.ok(sharedBounceUniform?.value.isVector3);
const sharedBounceVector = sharedBounceUniform.value;
assert.deepEqual(sharedBounceVector.toArray(), [0, 0, 0]);
const originalOpaqueMaterials = new Set();
let bounceBaselineMeshCount = 0;
createdShip.player.traverse((object) => {
  if (!object.isMesh) return;
  bounceBaselineMeshCount++;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (material.isMeshStandardMaterial && !material.transparent && !(material.transmission > 0)) {
      originalOpaqueMaterials.add(material);
    } else {
      assert.equal(compileShipMaterialForTest(material).uniforms[bounceUniformName], undefined,
        `${object.name}: glass and explicit emitters must not receive an opaque diffuse floor`);
    }
  }
});
assert.equal(originalOpaqueMaterials.size, 5, 'Hull, belly, trim, cape, and cape inset all receive tunnel bounce');
for (const material of originalOpaqueMaterials) {
  const shader = compileShipMaterialForTest(material);
  assert.equal(shader.uniforms[bounceUniformName], sharedBounceUniform);
  assert.match(shader.fragmentShader, /neonV23DiffusePattern/);
  assert.match(shader.fragmentShader, /neonV23RoughnessPattern/);
  const bounceLine = 'irradiance += PI * neonV23ShipTunnelBounce * 0.72 / 0.18;';
  assert.equal(shader.fragmentShader.split(bounceLine).length - 1, 1);
  assert.ok(shader.fragmentShader.indexOf(bounceLine) > shader.fragmentShader.indexOf('#include <lights_fragment_maps>'));
  assert.ok(shader.fragmentShader.indexOf(bounceLine) < shader.fragmentShader.indexOf('#include <lights_fragment_end>'));
  assert.match(shader.fragmentShader, /#if defined\(RE_IndirectDiffuse\)\s+irradiance \+=/);
  assert.doesNotMatch(shader.fragmentShader, /\b(?:totalEmissiveRadiance|radiance|directDiffuse|directSpecular)\s*\+=?[^;]*neonV23ShipTunnelBounce/);
}
assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceReceiverMaterialCount, originalOpaqueMaterials.size);

const clonedBounceHull = hull.material.clone();
const secondGenerationBounceHull = clonedBounceHull.clone();
for (const material of [clonedBounceHull, secondGenerationBounceHull]) {
  const shader = compileShipMaterialForTest(material);
  assert.equal(shader.uniforms[bounceUniformName], sharedBounceUniform);
  assert.match(shader.fragmentShader, /neonV23DiffusePattern/);
  assert.match(shader.fragmentShader, /neonV23RoughnessPattern/);
  assert.equal(shader.fragmentShader.split('irradiance += PI * neonV23ShipTunnelBounce').length - 1, 1);
  assert.equal(material.customProgramCacheKey(), hull.material.customProgramCacheKey());
}
const bounceProbe = { valid: true, enclosure: 1, irradiance: 0.10, red: 1, green: 0.74, blue: 0.42 };
const hullColorBeforeBounce = hull.material.color.clone();
const hullEmissiveBeforeBounce = hull.material.emissive.clone();
const hullEmissiveIntensityBeforeBounce = hull.material.emissiveIntensity;
assert.equal(createdShip.setTunnelBounce(bounceProbe), true);
assert.equal(sharedBounceUniform.value, sharedBounceVector);
sharedBounceVector.toArray().forEach((value, index) => {
  assert.ok(Math.abs(value - [0.10, 0.074, 0.042][index]) < 0.000_000_001);
});
assert.ok(hull.material.color.equals(hullColorBeforeBounce));
assert.ok(hull.material.emissive.equals(hullEmissiveBeforeBounce));
assert.equal(hull.material.emissiveIntensity, hullEmissiveIntensityBeforeBounce);
bounceProbe.enclosure = 0.5;
bounceProbe.irradiance = 0.05;
assert.equal(createdShip.setTunnelBounce(bounceProbe), true);
assert.equal(sharedBounceVector.x, 0.05, 'Navigation already applied the portal blend; do not square it on the receiver');
assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceEnclosure, 0.5);
assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceIrradiance, 0.05);
assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceReceiverGain, 0.72);
for (const invalidProbe of [undefined, { ...bounceProbe, valid: false }, { ...bounceProbe, irradiance: NaN },
  { ...bounceProbe, green: Infinity }, { ...bounceProbe, red: -1 }, { ...bounceProbe, enclosure: NaN }]) {
  assert.equal(createdShip.setTunnelBounce(invalidProbe), false);
  assert.equal(sharedBounceUniform.value, sharedBounceVector);
  assert.deepEqual(sharedBounceVector.toArray(), [0, 0, 0]);
  assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceValid, false);
  assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceIrradiance, 0);
  createdShip.setTunnelBounce(bounceProbe);
}

const legacyShadowGeometry = createdShip.playerShadow.geometry;
const legacyShadowMaterial = createdShip.playerShadow.material;
const baselineHullRoughness = hull.material.roughness;
assert.equal(createdShip.getRenderQualityDiagnostics().ultraEnabled, false);
assert.equal(createdShip.setRenderQuality('high'), true);
const ultraDiagnostics = createdShip.getRenderQualityDiagnostics();
assert.equal(ultraDiagnostics.ultraEnabled, true);
assert.equal(ultraDiagnostics.activeQuality, 'high');
assert.equal(ultraDiagnostics.contactShadowMode, 'radial-gradient-black');
assert.equal(ultraDiagnostics.localLightCount, 0);
assert.equal(compileShipMaterialForTest(hull.material).uniforms[bounceUniformName], sharedBounceUniform);
assert.equal(ultraDiagnostics.tunnelBounceIrradiance, 0.05);
assert.ok(ultraDiagnostics.bloomEmitterCount > 0);
assert.ok(hull.material.roughness < baselineHullRoughness);
assert.notEqual(createdShip.playerShadow.geometry, legacyShadowGeometry);
assert.notEqual(createdShip.playerShadow.material, legacyShadowMaterial);
assert.ok(createdShip.playerShadow.material.map?.isDataTexture);
assert.equal(requireSceneObject('V23.ShipEffect.main-flame').userData.neonV23Bloom, true);
assert.equal(requireSceneObject('V23.ShipEffect.main-flame').layers.isEnabled(12), true);
assert.equal(requireSceneObject('V23.Ship.candle-soul-core').userData.neonV23Bloom, true);
assert.notEqual(createdShip.playerShadow.userData.neonV23Bloom, true);
assert.notEqual(hull.userData.neonV23Bloom, true);
assert.equal(createdShip.setRenderQuality('medium'), true);
assert.equal(hull.material.roughness, baselineHullRoughness);
assert.equal(createdShip.playerShadow.geometry, legacyShadowGeometry);
assert.equal(createdShip.playerShadow.material, legacyShadowMaterial);
assert.equal(createdShip.getRenderQualityDiagnostics().ultraEnabled, false);
assert.equal(compileShipMaterialForTest(hull.material).uniforms[bounceUniformName], sharedBounceUniform);
assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceIrradiance, 0.05);
let bounceFinalMeshCount = 0;
createdShip.player.traverse((object) => {
  if (object.isMesh) bounceFinalMeshCount++;
  assert.notEqual(object.isLight, true, 'Tunnel reception must not add player-following lights');
});
assert.equal(bounceFinalMeshCount, bounceBaselineMeshCount);
clonedBounceHull.dispose();
secondGenerationBounceHull.dispose();

assert.equal(createdShip.dispose(), true);
assert.deepEqual(sharedBounceVector.toArray(), [0, 0, 0]);
assert.equal(createdShip.setTunnelBounce(bounceProbe), false);
assert.equal(createdShip.getRenderQualityDiagnostics().tunnelBounceValid, false);
assert.equal(createdShip.dispose(), false);
assert.equal(shipScene.getObjectByName('V23.WatertightShip'), undefined);

console.log('V23 ship propulsion regression passed');
