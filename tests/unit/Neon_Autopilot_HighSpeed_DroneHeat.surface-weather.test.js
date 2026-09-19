import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Resolve the production weather module from the project root, independent of test cwd.
const PROJECT_ROOT = new URL('../../', import.meta.url);
const require = createRequire(import.meta.url);
const THREE = require(fileURLToPath(new URL('vendor/three-0.160.0.min.js', PROJECT_ROOT)));
const gameplaySource = readFileSync(
  new URL('src/gameplay/Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js', PROJECT_ROOT),
  'utf8'
);
const source = readFileSync(
  new URL('src/weather/Neon_Autopilot_HighSpeed_DroneHeat.surface-weather.js', PROJECT_ROOT),
  'utf8'
);
const context = vm.createContext({ window: {} });
vm.runInContext(gameplaySource, context, {
  filename: 'Neon_Autopilot_HighSpeed_DroneHeat.gameplay-core.js'
});
vm.runInContext(source, context, {
  filename: 'Neon_Autopilot_HighSpeed_DroneHeat.surface-weather.js'
});
const {
  SURFACE_CELL_CONTRACT,
  SURFACE_FORCE_CONTRACT,
  SURFACE_LAYOUT_CONTRACT,
  SURFACE_RENDER_CONTRACT,
  PUDDLE_OPTICS_CONTRACT,
  SHOULDER_SNOW_INTERACTION_CONTRACT,
  WATER_LOCAL_SPRAY_CONTRACT,
  WATER_WAKE_CONTRACT,
  SNOW_ACCUMULATION_CONTRACT,
  SNOW_POWDER_CONTACT_CONTRACT,
  STANDING_WATER_CONTRACT,
  allowsSnowAccumulation,
  allowsStandingWater,
  crossesSnowPatch,
  createFlatBottomSnowBankGeometry,
  disturbSurfaceCell,
  resetSurfaceContactResponse,
  resolveLocalWaterResponse,
  resolvePuddleLightingResponse,
  resolveShoulderSnowInteraction,
  resolveSurfaceForceResponse,
  resolveSurfaceTargets,
  stepSurfaceCell,
  stepSurfaceResponse
} = context.window.NeonSurfaceWeather;
const { sweptEllipseInterval } = context.window.NeonGameplayCore;
const CHANNELS = Object.freeze(['water', 'snow', 'slush', 'dust']);

/** Copy a cross-realm VM object into this test realm for strict structural comparisons. */
function copyChannels(value) {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, value[channel]]));
}

/** Require every public response channel to remain finite and normalized. */
function assertNormalizedChannels(value, label) {
  for (const channel of CHANNELS) {
    assert.ok(Number.isFinite(value[channel]), `${label}.${channel} must be finite`);
    assert.ok(value[channel] >= 0 && value[channel] <= 1, `${label}.${channel} must stay within 0..1`);
  }
}

/** Integrate one fixed target for an exact duration at the requested render cadence. */
function integrateAtHz(initial, targets, durationSeconds, hz) {
  const state = { ...initial };
  const frameCount = durationSeconds * hz;
  assert.ok(Number.isInteger(frameCount), 'test duration must contain a whole number of frames');
  for (let frame = 0; frame < frameCount; frame++) {
    stepSurfaceResponse(state, targets, 1 / hz);
  }
  return state;
}

function hashUnitForFixture(value, salt = 0) {
  let hash = Math.imul((value | 0) ^ (salt | 0), 0x45d9_f3b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9_f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffff_ffff;
}

/** Reproduce the production straight-route slot geometry and exact coverage union without Three.js. */
function sampleStraightSurfaceCoverage(previousDistance, currentDistance, targets) {
  const firstBucket = Math.floor(
    (currentDistance - SURFACE_LAYOUT_CONTRACT.retainBehindM)
      / SURFACE_LAYOUT_CONTRACT.slotSpacingM
  );
  const puddleScale = 0.36 + targets.water * 0.64;
  const snowScale = 0.18 + targets.snow * 0.82;
  const minimumSweepDistance = Math.min(previousDistance, currentDistance);
  const maximumSweepDistance = Math.max(previousDistance, currentDistance);
  let waterCoverage = 0;
  let snowCoverage = 0;
  for (let index = 0; index < SURFACE_LAYOUT_CONTRACT.mobileSlotCapacity; index++) {
    const bucket = firstBucket + index;
    const station = bucket * SURFACE_LAYOUT_CONTRACT.slotSpacingM
      + hashUnitForFixture(bucket, 0x11_7a) * SURFACE_LAYOUT_CONTRACT.stationJitterM;
    // The largest authored snow half-length plus the ship half-length is below 8m.
    // Skipping farther slots preserves the exact union while keeping the 180s audit inexpensive.
    if (station < minimumSweepDistance - 8 || station > maximumSweepDistance + 8) continue;
    const centerBias = Math.abs(bucket % 4) === 1;
    const puddleLateral = (hashUnitForFixture(bucket, 0x29_3d) * 2 - 1)
      * (centerBias ? 1.8 : 6.2);
    const puddleHalfWidth = (1 + hashUnitForFixture(bucket, 0x62_81) * 1.25)
      * puddleScale;
    const puddleHalfLength = (1.45 + hashUnitForFixture(bucket, 0x44_09) * 1.7)
      * puddleScale;
    const waterInterval = sweptEllipseInterval(
      previousDistance - station,
      -puddleLateral,
      currentDistance - station,
      -puddleLateral,
      puddleHalfLength,
      puddleHalfWidth,
      1.36,
      0.72
    );
    if (waterInterval.hit) {
      const coverage = Math.max(0, Math.min(1, waterInterval.exitT - waterInterval.entryT));
      waterCoverage = 1 - (1 - waterCoverage) * (1 - coverage);
    }

    const snowLateral = (hashUnitForFixture(bucket, 0x73_1f) * 2 - 1) * 6.7;
    const snowHalfWidth = (1.4 + hashUnitForFixture(bucket, 0x55_b1) * 2.2)
      * snowScale;
    const snowHalfLength = (2.2 + hashUnitForFixture(bucket, 0x91_2d) * 3.8)
      * snowScale;
    const snowInterval = sweptEllipseInterval(
      previousDistance - station,
      -snowLateral,
      currentDistance - station,
      -snowLateral,
      snowHalfLength,
      snowHalfWidth,
      1.36,
      0.72
    );
    if (snowInterval.hit) {
      const coverage = Math.max(0, Math.min(1, snowInterval.exitT - snowInterval.entryT));
      snowCoverage = 1 - (1 - snowCoverage) * (1 - coverage);
    }
  }
  return { waterCoverage, snowCoverage };
}

/** Integrate the same one-frame-delayed surface load used by runtime over a deterministic straight cruise. */
function simulateSaturatedCruise(targets, durationSeconds, fixedSpeedMps = null) {
  const hz = 60;
  const dt = 1 / hz;
  const frameCount = Math.round(durationSeconds * hz);
  let speedMps = fixedSpeedMps ?? 0;
  let distanceM = 0;
  let previousDecelerationMps2 = 0;
  let peakSpeedMps = speedMps;
  let accumulatedDecelerationMps = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const previousDistance = distanceM;
    const previousSpeed = speedMps;
    if (fixedSpeedMps === null) {
      speedMps = Math.max(
        0,
        speedMps + (
          SURFACE_FORCE_CONTRACT.referenceCruiseAccelerationMps2
          - previousDecelerationMps2
        ) * dt
      );
    } else {
      speedMps = fixedSpeedMps;
    }
    distanceM += (previousSpeed + speedMps) * 0.5 * dt;
    const coverage = sampleStraightSurfaceCoverage(previousDistance, distanceM, targets);
    const response = resolveSurfaceForceResponse({
      waterCoverage: coverage.waterCoverage,
      snowCoverage: coverage.snowCoverage,
      slushCoverage: Math.max(coverage.waterCoverage, coverage.snowCoverage),
      waterAccumulation: targets.water,
      snowAccumulation: targets.snow,
      slushAccumulation: targets.slush
    }, {
      grounded: true,
      openSky: coverage.waterCoverage > 0 || coverage.snowCoverage > 0,
      speedMps,
      lateralSpeedMps: 0,
      distanceM
    }, {});
    previousDecelerationMps2 = response.longitudinalDecelerationMps2;
    accumulatedDecelerationMps += previousDecelerationMps2 * dt;
    peakSpeedMps = Math.max(peakSpeedMps, speedMps);
  }
  return {
    finalSpeedMps: speedMps,
    peakSpeedMps,
    averageDecelerationMps2: accumulatedDecelerationMps / durationSeconds
  };
}

test('puddles use dielectric physical water and the same-frame physical-lighting state', () => {
  assert.equal(STANDING_WATER_CONTRACT.materialModel, 'dielectric-physical-water');
  assert.equal(STANDING_WATER_CONTRACT.lightingAuthority, 'physical-lighting-state');
  assert.equal(STANDING_WATER_CONTRACT.projectedShadowMode, 'receive-only');
  assert.equal(STANDING_WATER_CONTRACT.environmentReflection, true);
  assert.equal(STANDING_WATER_CONTRACT.directLightReflection, true);
  assert.match(source, /const puddleMaterial = new THREE\.MeshPhysicalMaterial/);
  assert.match(source, /ior: 1\.333,/);
  assert.match(source, /specularIntensity: 1,/);
  assert.match(source, /clearcoat: 0,/);
  assert.match(source, /transmission: 0,/);
  assert.match(source, /getLightingState = \(\) => null/);
  assert.match(source, /getLightingState\(\) \|\| \{\}/);
  assert.match(source, /puddleMaterial\.envMapIntensity =/);
  assert.match(source, /puddleMaterial\.emissiveIntensity = 0;/);
  assert.match(source, /puddles\.castShadow = false;/);
  assert.match(source, /puddles\.receiveShadow = true;/);
  for (const marker of [
    'puddleMaterialModel: STANDING_WATER_CONTRACT.materialModel',
    'puddleLightingAuthority: STANDING_WATER_CONTRACT.lightingAuthority',
    'puddleProjectedShadowMode: STANDING_WATER_CONTRACT.projectedShadowMode',
    'puddleReceivesProjectedShadow: puddles.receiveShadow',
    'puddleCastsProjectedShadow: puddles.castShadow',
    'puddleLightingEnvironmentIntensity: 1',
    'puddleEnvironmentReflectionIntensity: puddleMaterial.envMapIntensity',
    'puddleDirectSunIntensity: 0'
  ]) {
    assert.ok(source.includes(marker), `missing physical-water diagnostic ${marker}`);
  }

  const darkShelter = resolvePuddleLightingResponse(
    { environmentIntensity: 0.2, sunIntensity: 0 },
    0.8
  );
  const brightSun = resolvePuddleLightingResponse(
    { environmentIntensity: 1.4, sunIntensity: 5 },
    0.8
  );
  assert.ok(brightSun.envMapIntensity > darkShelter.envMapIntensity);
  assert.equal(brightSun.specularIntensity, 1);
  assert.equal(darkShelter.specularIntensity, 1);
  assert.equal(brightSun.roughness, darkShelter.roughness);
  assert.equal(brightSun.environmentIntensity, 1.4);
  assert.equal(brightSun.sunIntensity, 5);

  const thinFilm = resolvePuddleLightingResponse(
    { environmentIntensity: 1, sunIntensity: 3 },
    0.03
  );
  const deepPuddle = resolvePuddleLightingResponse(
    { environmentIntensity: 1, sunIntensity: 3 },
    1
  );
  assert.ok(deepPuddle.opacity > thinFilm.opacity);
  assert.ok(deepPuddle.normalStrength > thinFilm.normalStrength);
  assert.ok(deepPuddle.roughness < thinFilm.roughness);
  assert.ok(deepPuddle.opacity <= 0.52);
});

test('puddle optics feather the shore, vary repeated instances, and remove neon water effects', () => {
  assert.equal(Object.isFrozen(PUDDLE_OPTICS_CONTRACT), true);
  assert.equal(Object.isFrozen(PUDDLE_OPTICS_CONTRACT.textureSize), true);
  assert.equal(Object.isFrozen(PUDDLE_OPTICS_CONTRACT.normalRepeat), true);
  assert.equal(Object.isFrozen(PUDDLE_OPTICS_CONTRACT.ambientRainRippleCadenceSeconds), true);
  assert.equal(PUDDLE_OPTICS_CONTRACT.additionalDrawGroups, 0);
  assert.equal(PUDDLE_OPTICS_CONTRACT.textureSize.mobile, 64);
  assert.equal(PUDDLE_OPTICS_CONTRACT.textureSize.desktop, 128);
  assert.equal(PUDDLE_OPTICS_CONTRACT.visualSurfaceLiftM, 0.003);
  assert.equal(PUDDLE_OPTICS_CONTRACT.maximumNormalMotionM, 0.001_5);
  assert.equal(PUDDLE_OPTICS_CONTRACT.minimumRoadClearanceM, 0.001_5);

  for (const marker of [
    'function createPuddleSurfaceTextures(THREE, mobile)',
    'alphaMap: puddleSurfaceTextures.alphaMap',
    'roughnessMap: puddleSurfaceTextures.roughnessMap',
    'normalMap: puddleSurfaceTextures.normalMap',
    'side: THREE.FrontSide',
    'function applyInstanceFadeToAlpha(material)',
    'entry.waterRotationRad = hashUnit(bucket, 0x4f_29) * Math.PI * 2',
    'entry.waterQuaternion.copy(quaternion).multiply(localSurfaceRotation)',
    'puddleSurfaceTextures.normalMap.offset.set(',
    'const displacementSpread = waterCell.waterDisplacement * 0.025',
    'function emitAmbientRainRipple(motionTime)',
    'const rain = clamp01(state.weather?.rain)',
    'diagnostics.ambientRainRippleCount++',
    'emitAmbientRainRipple(motionTime)'
  ]) {
    assert.ok(source.includes(marker), `missing realistic puddle-optics marker ${marker}`);
  }
  assert.doesNotMatch(source, /THREE\.AdditiveBlending/);
  assert.doesNotMatch(source, /waterCell\.waterDisplacement \* 0\.022/);
});

test('water spray scales from local penetration and never treats a grazing touch as a whole burst', () => {
  assert.equal(WATER_LOCAL_SPRAY_CONTRACT.mode, 'per-tail-or-contact-edge-local-jets');
  assert.equal(WATER_LOCAL_SPRAY_CONTRACT.wholeFootprintBurst, false);
  assert.ok(WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerJet
    < WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerContact);

  const tangent = resolveLocalWaterResponse({
    intervalCoverage: 0.01,
    longitudinalPenetration: 0.02,
    lateralPenetration: 0.03,
    accumulation: 1,
    pressureFactor: 1,
    speedFactor: 1,
    landingEnergy: 0
  });
  const shallow = resolveLocalWaterResponse({
    intervalCoverage: 0.15,
    longitudinalPenetration: 0.20,
    lateralPenetration: 0.25,
    accumulation: 1,
    pressureFactor: 1,
    speedFactor: 1,
    landingEnergy: 0
  });
  const deep = resolveLocalWaterResponse({
    intervalCoverage: 0.9,
    longitudinalPenetration: 0.9,
    lateralPenetration: 0.9,
    accumulation: 1,
    pressureFactor: 1,
    speedFactor: 1,
    landingEnergy: 0
  });
  assert.equal(tangent.emitSpray, false);
  assert.equal(tangent.particleCount, 0);
  assert.ok(shallow.deformationEnergy > tangent.deformationEnergy);
  assert.equal(shallow.emitSpray, false);
  assert.ok(deep.deformationEnergy > shallow.deformationEnergy);
  assert.equal(deep.emitRipple, true);
  assert.equal(deep.emitWake, true);
  assert.equal(deep.emitSpray, true);
  assert.ok(deep.particleCount > 0);
  assert.ok(deep.particleCount <= WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerContact);
  for (const marker of [
    'waterTailImmersion(',
    'const leftImmersion = waterTailImmersion(',
    'const rightImmersion = waterTailImmersion(',
    'const contactLateralOffset = Math.max(',
    'waterLocalJetCount += localJetCount',
    'waterGrazingNoSprayCount++',
    'preferredSide = 0'
  ]) {
    assert.ok(source.includes(marker), `missing local-water spray marker ${marker}`);
  }
});

test('snow sheets receive real shadows while only volumetric banks cast them', () => {
  assert.equal(SURFACE_RENDER_CONTRACT.snowSheetShadowMode, 'receive-only');
  assert.equal(SURFACE_RENDER_CONTRACT.volumetricSnowShadowMode, 'banks-only');
  assert.equal(SURFACE_RENDER_CONTRACT.snowAlbedoFloorMode, 'neutral-multiple-scattering-fill');
  assert.match(source, /const snowMaterial = new THREE\.MeshPhysicalMaterial/);
  assert.match(source, /color: 0xff_ffff/);
  assert.match(source, /emissive: 0xd8_e8ed/);
  assert.match(source, /transparent: false/);
  assert.match(source, /depthWrite: true/);
  assert.match(source, /const snowIndirectFill = clamp\(/);
  assert.match(source, /snowPatches\.castShadow = false;/);
  assert.match(source, /snowPatches\.receiveShadow = true;/);
  assert.match(source, /snowPatches\.renderOrder = 3;/);
  assert.match(source, /snowBanks\.castShadow = true;/);
  assert.match(source, /snowBanks\.receiveShadow = true;/);
  assert.match(source, /snowTracks\.receiveShadow = true;/);
  assert.match(source, /snowRidges\.castShadow = false;/);
});

test('surface sheets stay within millimetres of the road and snow banks have a sealed flat base', () => {
  assert.equal(SNOW_ACCUMULATION_CONTRACT.sheetVisualSurfaceLiftM, 0.004);
  assert.equal(SNOW_ACCUMULATION_CONTRACT.sheetMaximumCompactionDepressionM, 0.002_5);
  assert.equal(SNOW_ACCUMULATION_CONTRACT.sheetMinimumRoadClearanceM, 0.001_5);
  assert.equal(SNOW_ACCUMULATION_CONTRACT.bankVisualSurfaceLiftM, 0.002);
  assert.equal(
    SNOW_ACCUMULATION_CONTRACT.bankGeometry,
    'sealed-flat-bottom-organic-half-hill'
  );
  assert.deepEqual(
    { ...SNOW_ACCUMULATION_CONTRACT.bankLocalVerticalRange },
    { minimum: 0, maximum: 1 }
  );
  const waterMinimumM = PUDDLE_OPTICS_CONTRACT.visualSurfaceLiftM
    - PUDDLE_OPTICS_CONTRACT.maximumNormalMotionM;
  const waterMaximumM = PUDDLE_OPTICS_CONTRACT.visualSurfaceLiftM
    + PUDDLE_OPTICS_CONTRACT.maximumNormalMotionM;
  const snowMinimumM = SNOW_ACCUMULATION_CONTRACT.sheetVisualSurfaceLiftM
    - SNOW_ACCUMULATION_CONTRACT.sheetMaximumCompactionDepressionM;
  assert.equal(waterMinimumM, PUDDLE_OPTICS_CONTRACT.minimumRoadClearanceM);
  assert.equal(snowMinimumM, SNOW_ACCUMULATION_CONTRACT.sheetMinimumRoadClearanceM);
  assert.ok(waterMaximumM <= 0.005);
  assert.ok(SNOW_ACCUMULATION_CONTRACT.sheetVisualSurfaceLiftM <= 0.005);

  for (const [radialSegments, heightSegments] of [[8, 4], [12, 6]]) {
    const geometry = createFlatBottomSnowBankGeometry(THREE, radialSegments, heightSegments);
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.min.z) <= 0.000_000_1);
    assert.ok(Math.abs(geometry.boundingBox.max.z - 1) <= 0.000_000_1);
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const edgeCounts = new Map();
    for (let offset = 0; offset < index.count; offset += 3) {
      const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
      const a = new THREE.Vector3().fromBufferAttribute(position, triangle[0]);
      const b = new THREE.Vector3().fromBufferAttribute(position, triangle[1]);
      const c = new THREE.Vector3().fromBufferAttribute(position, triangle[2]);
      assert.ok(new THREE.Triangle(a, b, c).getArea() > 0.000_000_001);
      for (const [left, right] of [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]]
      ]) {
        const key = left < right ? `${left}:${right}` : `${right}:${left}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
    assert.ok([...edgeCounts.values()].every((count) => count === 2));
    assert.equal(geometry.userData.neon.flatRoadBase, true);
    geometry.dispose();
  }
  assert.match(
    source,
    /const snowBanks = new THREE\.InstancedMesh\(\s*createFlatBottomSnowBankGeometry\(/
  );
  assert.doesNotMatch(
    source,
    /const snowBanks = new THREE\.InstancedMesh\(\s*new THREE\.SphereGeometry/
  );
});

test('water and snow are laid out into a stable long horizon before the ship reaches them', () => {
  assert.equal(Object.isFrozen(SURFACE_LAYOUT_CONTRACT), true);
  assert.equal(SURFACE_LAYOUT_CONTRACT.version, 'Neon-surface-layout-4');
  assert.equal(SURFACE_LAYOUT_CONTRACT.policy, 'route-stable-long-horizon-buckets');
  assert.equal(SURFACE_LAYOUT_CONTRACT.fairSpeedMps, 45);
  assert.equal(SURFACE_LAYOUT_CONTRACT.retainBehindM, 96);
  assert.equal(SURFACE_LAYOUT_CONTRACT.mobileSlotCapacity, 52);
  assert.equal(SURFACE_LAYOUT_CONTRACT.desktopSlotCapacity, 68);
  assert.equal(SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.mobile, 1_104);
  assert.equal(SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.desktop, 1_488);
  assert.ok(
    SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.mobile
      >= SURFACE_LAYOUT_CONTRACT.fairSpeedMps * 2.2
  );
  assert.ok(
    SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.desktop
      >= SURFACE_LAYOUT_CONTRACT.fairSpeedMps * 2.8
  );
  assert.ok(
    SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.desktop
      > SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.mobile
  );
  assert.equal(SURFACE_LAYOUT_CONTRACT.popInBoundary, 'at-or-beyond-effective-weather-fog');
  for (const tier of ['mobile', 'desktop']) {
    const capacity = SURFACE_LAYOUT_CONTRACT[`${tier}SlotCapacity`];
    const phaseSafeMinimumM = (capacity - 2) * SURFACE_LAYOUT_CONTRACT.slotSpacingM
      - SURFACE_LAYOUT_CONTRACT.retainBehindM;
    assert.equal(
      phaseSafeMinimumM,
      SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM[tier],
      `${tier} forward preview must include the worst floor-bucket phase`
    );
    assert.equal(
      phaseSafeMinimumM / SURFACE_LAYOUT_CONTRACT.fairSpeedMps,
      SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewSecondsAtFairSpeed[tier]
    );
  }
  for (const marker of [
    'surfacePreviewPolicy: SURFACE_LAYOUT_CONTRACT.policy',
    'diagnostics.surfacePreviewAheadM = Number.isFinite(farthestStationOffsetM)',
    '? Math.max(0, farthestStationOffsetM)',
    'out.surfacePreviewAheadM = diagnostics.surfacePreviewAheadM',
    'hashUnit(bucket, 0x11_7a) * SURFACE_LAYOUT_CONTRACT.stationJitterM',
    'if (station < 0)'
  ]) {
    assert.ok(source.includes(marker), `missing long-horizon surface marker ${marker}`);
  }
});

test('mobile mixed surfaces cap actual participation at six draw groups', () => {
  assert.equal(Object.isFrozen(SURFACE_RENDER_CONTRACT), true);
  assert.equal(SURFACE_RENDER_CONTRACT.mobileSurfaceDrawGroupBudget, 6);
  assert.equal(SURFACE_RENDER_CONTRACT.desktopSurfaceDrawGroupBudget, 9);
  assert.equal(SURFACE_RENDER_CONTRACT.mobileSnowRidgeMode, 'encoded-by-compressed-track-edge');
  assert.equal(SURFACE_RENDER_CONTRACT.mobileWaterWaveMode, 'speed-exclusive-ripple-or-wake');
  assert.equal(SURFACE_RENDER_CONTRACT.mobileMixedParticleMode, 'single-dominant-layer');
  for (const marker of [
    'snowRidges.visible = !mobile && snowTracks.visible',
    'if (mobile && ripples.visible && waterWakes.visible)',
    'if (mobile && waterSpray.object.visible && snowPowder.object.visible)',
    "const mobilePrefersSnowParticles = contactResponse.kind !== 'water'",
    'diagnostics.surfaceDrawGroups = Number(puddles.visible)',
    'diagnostics.surfaceDrawGroupBudgetExceeded = diagnostics.surfaceDrawGroups'
  ]) {
    assert.ok(source.includes(marker), `missing mobile surface-budget marker ${marker}`);
  }
  // Three accumulation meshes + tracks + one water-wave mesh + one contact-particle layer.
  assert.ok(3 + 1 + 1 + 1 <= SURFACE_RENDER_CONTRACT.mobileSurfaceDrawGroupBudget);
});

test('deformation and particles stay attached to the full banked-road basis', () => {
  for (const marker of [
    'entry.waterUpX = up.x',
    'entry.waterUpY = up.y',
    'entry.waterUpZ = up.z',
    'entry.snowUpX = up.x',
    'entry.snowUpY = up.y',
    'entry.snowUpZ = up.z',
    'right.y * lateralOffset',
    'tangent.y * tangentOffset',
    'up.z * normalOffset',
    'ripple.x = absoluteContact.x + up.x',
    'wake.z = absoluteContact.z + up.z'
  ]) {
    assert.ok(source.includes(marker), `missing banked-surface basis marker ${marker}`);
  }
});

test('standing water belongs only to open-sky route samples', () => {
  assert.equal(STANDING_WATER_CONTRACT.exposure, 'open-sky-route-only');
  assert.equal(STANDING_WATER_CONTRACT.geometryVisualOnly, true);
  assert.equal(STANDING_WATER_CONTRACT.surfaceForceAuthority, SURFACE_FORCE_CONTRACT.authority);
  assert.equal(Object.isFrozen(STANDING_WATER_CONTRACT), true);
  assert.equal(Object.isFrozen(STANDING_WATER_CONTRACT.blockedTunnelKinds), true);
  assert.deepEqual(
    [...STANDING_WATER_CONTRACT.blockedTunnelKinds],
    ['mountain-tunnel', 'underground-tunnel']
  );

  assert.equal(allowsStandingWater({}), true);
  assert.equal(allowsStandingWater({ covered: false, tunnelKind: null }), true);
  assert.equal(allowsStandingWater({ covered: true, tunnelKind: null }), false);
  assert.equal(allowsStandingWater({ covered: false, tunnelKind: 'mountain-tunnel' }), false);
  assert.equal(allowsStandingWater({ covered: true, tunnelKind: 'underground-tunnel' }), false);
  assert.equal(allowsStandingWater({ tunnelKind: 'future-covered-route' }), false);
});

test('settled snow and contact powder belong only to open-sky route samples', () => {
  assert.equal(SNOW_ACCUMULATION_CONTRACT.exposure, 'open-sky-route-only');
  assert.equal(SNOW_ACCUMULATION_CONTRACT.geometryVisualOnly, true);
  assert.equal(SNOW_ACCUMULATION_CONTRACT.surfaceForceAuthority, SURFACE_FORCE_CONTRACT.authority);
  assert.equal(Object.isFrozen(SNOW_ACCUMULATION_CONTRACT), true);
  assert.equal(Object.isFrozen(SNOW_ACCUMULATION_CONTRACT.blockedTunnelKinds), true);
  assert.equal(Object.isFrozen(SNOW_ACCUMULATION_CONTRACT.blockedEffects), true);
  assert.deepEqual(
    [...SNOW_ACCUMULATION_CONTRACT.blockedTunnelKinds],
    ['mountain-tunnel', 'underground-tunnel']
  );
  assert.deepEqual(
    [...SNOW_ACCUMULATION_CONTRACT.blockedEffects],
    ['patches', 'banks', 'tracks', 'ridges', 'powder']
  );

  assert.equal(allowsSnowAccumulation({}), true);
  assert.equal(allowsSnowAccumulation({ covered: false, tunnelKind: null }), true);
  assert.equal(allowsSnowAccumulation({ covered: true, tunnelKind: null }), false);
  assert.equal(allowsSnowAccumulation({ covered: false, tunnelKind: 'mountain-tunnel' }), false);
  assert.equal(allowsSnowAccumulation({ covered: true, tunnelKind: 'underground-tunnel' }), false);
  assert.equal(allowsSnowAccumulation({ tunnelKind: 'future-covered-route' }), false);
});

test('powder compatibility helper includes the authored pressure footprint', () => {
  assert.equal(
    SNOW_POWDER_CONTACT_CONTRACT.trigger,
    'swept-pressure-footprint-open-sky-snow-patch'
  );
  assert.equal(SNOW_POWDER_CONTACT_CONTRACT.minimumSnowAccumulation, 0.06);
  assert.equal(SNOW_POWDER_CONTACT_CONTRACT.baseParticlesPerBurst, 6);
  assert.equal(SNOW_POWDER_CONTACT_CONTRACT.maximumParticlesPerBurst, 20);
  assert.equal(SNOW_POWDER_CONTACT_CONTRACT.maximumBurstsPerUpdate, 4);
  assert.equal(SNOW_POWDER_CONTACT_CONTRACT.particleLifeSeconds.maximum, 0.72);
  assert.equal(Object.isFrozen(SNOW_POWDER_CONTACT_CONTRACT), true);
  assert.equal(Object.isFrozen(SNOW_POWDER_CONTACT_CONTRACT.particleLifeSeconds), true);

  const forwardSweep = {
    previousDistance: 100,
    currentDistance: 120,
    previousLateral: -4,
    currentLateral: 4,
    snowAccumulation: 0.8
  };
  const visiblePatch = {
    station: 110,
    lateral: 0,
    halfWidth: 2,
    snowAccumulationAllowed: true
  };
  assert.equal(crossesSnowPatch(forwardSweep, visiblePatch), true);
  assert.equal(crossesSnowPatch({ ...forwardSweep, previousLateral: 6, currentLateral: 6 }, visiblePatch), false);
  assert.equal(crossesSnowPatch(forwardSweep, { ...visiblePatch, station: 121 }), false);
  assert.equal(crossesSnowPatch(forwardSweep, { ...visiblePatch, station: 100 }), false);
  assert.equal(crossesSnowPatch(forwardSweep, { ...visiblePatch, station: 120, lateral: 4 }), true);
  assert.equal(crossesSnowPatch({ ...forwardSweep, previousDistance: 120, currentDistance: 100 }, visiblePatch), true);
  assert.equal(crossesSnowPatch({ ...forwardSweep, currentDistance: 100 }, visiblePatch), false);
  assert.equal(crossesSnowPatch({ ...forwardSweep, snowAccumulation: 0.06 }, visiblePatch), false);
  assert.equal(crossesSnowPatch(forwardSweep, { ...visiblePatch, snowAccumulationAllowed: false }), false);
  assert.equal(crossesSnowPatch({ ...forwardSweep, currentDistance: Number.POSITIVE_INFINITY }, visiblePatch), false);
  assert.equal(
    crossesSnowPatch(
      { ...forwardSweep, previousLateral: 2.6, currentLateral: 2.6, footprintHalfWidthM: 0.72 },
      visiblePatch
    ),
    true
  );
});

test('paired shoulder snow banks respond symmetrically to grazes and low downwash only', () => {
  assert.equal(SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket, 2);
  assert.equal(SHOULDER_SNOW_INTERACTION_CONTRACT.layoutMode, 'paired-sampled-road-edge-banks');
  assert.equal(SHOULDER_SNOW_INTERACTION_CONTRACT.additionalDrawGroups, 0);
  assert.equal(Object.isFrozen(SHOULDER_SNOW_INTERACTION_CONTRACT), true);

  const baseSweep = {
    previousDistance: 106,
    currentDistance: 114,
    previousLateral: 5.2,
    currentLateral: 5.2,
    speedMps: 90,
    grounded: true,
    clearanceM: 0,
    enabled: true,
    snowAccumulation: 0.8,
    footprintHalfLengthM: 1.36,
    footprintHalfWidthM: 0.72,
    landingEnergy: 0
  };
  const rightBank = {
    station: 110,
    lateral: 7,
    halfLength: 2,
    halfWidth: 1.2,
    side: 1,
    snowAccumulationAllowed: true
  };
  const rightGraze = resolveShoulderSnowInteraction(
    baseSweep,
    rightBank,
    sweptEllipseInterval,
    {}
  );
  const leftGraze = resolveShoulderSnowInteraction(
    {
      ...baseSweep,
      previousLateral: -baseSweep.previousLateral,
      currentLateral: -baseSweep.currentLateral
    },
    { ...rightBank, lateral: -rightBank.lateral, side: -1 },
    sweptEllipseInterval,
    {}
  );
  const deepContact = resolveShoulderSnowInteraction(
    { ...baseSweep, previousLateral: 6.6, currentLateral: 6.6 },
    rightBank,
    sweptEllipseInterval,
    {}
  );

  assert.equal(rightGraze.hit, true);
  assert.equal(rightGraze.interactive, true);
  assert.equal(rightGraze.side, 1);
  assert.equal(leftGraze.hit, true);
  assert.equal(leftGraze.interactive, true);
  assert.equal(leftGraze.side, -1);
  assert.ok(Math.abs(rightGraze.deformationEnergy - leftGraze.deformationEnergy) < 0.000_000_001);
  assert.ok(rightGraze.deformationEnergy > 0);
  assert.ok(rightGraze.deformationEnergy < deepContact.deformationEnergy);
  assert.ok(rightGraze.contactLateral > baseSweep.currentLateral);

  const lowDownwash = resolveShoulderSnowInteraction(
    { ...baseSweep, grounded: false, clearanceM: 0.30 },
    rightBank,
    sweptEllipseInterval,
    {}
  );
  assert.equal(lowDownwash.interactive, true);
  assert.ok(lowDownwash.pressureFactor > 0 && lowDownwash.pressureFactor < 1);

  for (const [label, sweep, bank] of [
    ['far from bank', { ...baseSweep, previousLateral: 3, currentLateral: 3 }, rightBank],
    ['above downwash', { ...baseSweep, grounded: false, clearanceM: 0.581 }, rightBank],
    ['disabled', { ...baseSweep, enabled: false }, rightBank],
    ['insufficient snow', { ...baseSweep, snowAccumulation: 0.06 }, rightBank],
    ['covered bank', baseSweep, { ...rightBank, snowAccumulationAllowed: false }]
  ]) {
    const result = resolveShoulderSnowInteraction(sweep, bank, sweptEllipseInterval, {});
    assert.equal(result.interactive, false, label);
  }
});

test('runtime uses continuous footprint contact and exact route positions for both surfaces', () => {
  for (const marker of [
    'entry.snowLateral = snowLateral',
    'entry.snowCell = touchSurfaceCell',
    'entry.waterCell = touchSurfaceCell',
    "touchSurfaceCell(\n              bankFrame,\n              bucket,\n              'snow-bank'",
    "sampleEntryInterval(sweep, entry, 'snow-bank')",
    'resolveShoulderSnowInteraction(',
    'shoulderSnowCellInteractionScratch',
    'snowBanks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)',
    'SHOULDER_SNOW_INTERACTION_CONTRACT.maximumOutwardDisplacementM',
    'snowBankPowderBurstCount',
    'sweptEllipseInterval(',
    'footprintHalfLengthM',
    'footprintHalfWidthM',
    'sampleExactContact(sweep, progress)',
    'snowPowderContactRequired: true',
    'liveSnowParticleCount: 0',
    'snowPatchCrossingCount: 0',
    'waterWakes',
    'snowRidges'
  ]) {
    assert.ok(source.includes(marker), `missing swept-surface marker ${marker}`);
  }
  assert.doesNotMatch(source, /entry\.radius \+ 1\.45/);
  const particleStart = source.indexOf('function emitParticles(');
  const particleEnd = source.indexOf('function emitRipple(', particleStart);
  assert.ok(particleStart >= 0 && particleEnd > particleStart);
  assert.doesNotMatch(source.slice(particleStart, particleEnd), /player\.position/);
  assert.match(source, /contactPositionAuthority: 'swept-route-intersection'/);
  assert.equal(WATER_WAKE_CONTRACT.spatialStepM, 2.4);
  assert.equal(WATER_WAKE_CONTRACT.maximumSegmentsPerPatchPerUpdate, 5);
  assert.match(source, /pool\.ages\[index\] \+= ageStep;/);
  assert.match(source, /const elapsedSeconds = Math\.max\(0, motionTime - lastMotionTime\);/);
});

test('every tunnel snow presentation path uses the sampled open-sky gate', () => {
  assert.match(source, /entry\.snowAccumulationAllowed = allowsSnowAccumulation\(snowFrame\);/);
  assert.match(source, /bankEntry\.snowAccumulationAllowed = allowsSnowAccumulation\(bankFrame\);/);
  assert.match(source, /if \(!allowsSnowAccumulation\(frame\)\) \{/);
  assert.match(source, /surfaceResponse\.snow > SNOW_POWDER_CONTACT_CONTRACT\.minimumSnowAccumulation/);
  assert.match(source, /if \(!entry\.snowAccumulationAllowed\) continue;/);
  assert.match(source, /bank\.snowAccumulationAllowed !== true/);
  assert.match(source, /snowTracks\.visible = visibleCount > 0/);
  assert.doesNotMatch(source, /playerSnowAccumulationAllowed \? surfaceResponse\.snow : 0/);
  for (const marker of [
    'coveredSnowPatchVisibleCount: 0',
    'coveredSnowBankVisibleCount: 0',
    'coveredSnowInteractionViolationCount: 0',
    'snowTrackCoveredRejectCount: 0',
    'snowPowderVisible: false'
  ]) {
    assert.ok(source.includes(marker), `missing covered-snow diagnostic ${marker}`);
  }
});

test('surface response is bounded, speed-sensitive, and disabled above downwash clearance', () => {
  assert.equal(Object.isFrozen(SURFACE_FORCE_CONTRACT), true);
  assert.equal(SURFACE_FORCE_CONTRACT.gameplayWriteAuthority, 'runtime-only');
  assert.equal(SURFACE_FORCE_CONTRACT.maximumLongitudinalDecelerationMps2, 1.2);
  assert.equal(SURFACE_FORCE_CONTRACT.sustainedLoadScale, 0.03);
  assert.equal(SURFACE_FORCE_CONTRACT.waterReferenceSpeedMps, 160 / 3.6);
  assert.equal(SURFACE_FORCE_CONTRACT.snowReferenceSpeedMps, 120 / 3.6);
  assert.equal(SURFACE_FORCE_CONTRACT.referenceCruiseAccelerationMps2, 3.6);
  assert.equal(SURFACE_FORCE_CONTRACT.maximumSustainedAverageDecelerationMps2, 0.9);
  assert.equal(SURFACE_FORCE_CONTRACT.minimumLateralAccelerationMultiplier, 0.58);
  assert.equal(SURFACE_FORCE_CONTRACT.minimumLateralDragMultiplier, 0.44);
  assert.equal(SURFACE_FORCE_CONTRACT.minimumLateralSpeedMultiplier, 0.84);

  const contact = {
    waterCoverage: 1,
    snowCoverage: 0,
    slushCoverage: 0,
    waterAccumulation: 1,
    snowAccumulation: 0,
    slushAccumulation: 0
  };
  const slow = resolveSurfaceForceResponse(contact, {
    grounded: true,
    openSky: true,
    speedMps: 30,
    lateralSpeedMps: 0,
    distanceM: 120
  }, {});
  const fast = resolveSurfaceForceResponse(contact, {
    grounded: true,
    openSky: true,
    speedMps: 300,
    lateralSpeedMps: 18,
    distanceM: 120
  }, {});
  assert.equal(slow.kind, 'water');
  assert.ok(fast.longitudinalDecelerationMps2 > slow.longitudinalDecelerationMps2);
  assert.ok(fast.longitudinalDecelerationMps2 <= 1.2);
  assert.ok(
    fast.longitudinalDecelerationMps2
      < SURFACE_FORCE_CONTRACT.referenceCruiseAccelerationMps2,
    'Even a 300m/s pressure-stress sample must stay below propulsion authority'
  );
  assert.ok(fast.lateralAccelerationMultiplier >= 0.58);
  assert.ok(fast.lateralDragMultiplier >= 0.44);
  assert.ok(fast.lateralSpeedMultiplier >= 0.84);
  assert.ok(fast.lateralAccelerationMultiplier < 1);

  const lowFlight = resolveSurfaceForceResponse(contact, {
    grounded: false,
    openSky: true,
    clearanceM: SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM * 0.5,
    speedMps: 180,
    lateralSpeedMps: 0,
    distanceM: 120
  }, {});
  const highFlight = resolveSurfaceForceResponse(contact, {
    grounded: false,
    openSky: true,
    clearanceM: SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM + 0.01,
    speedMps: 180
  }, {});
  assert.ok(lowFlight.pressureFactor > 0 && lowFlight.pressureFactor < 1);
  assert.equal(highFlight.kind, 'dry');
  assert.equal(highFlight.longitudinalDecelerationMps2, 0);

  const tunnel = resolveSurfaceForceResponse(contact, {
    grounded: true,
    openSky: false,
    speedMps: 300
  }, {});
  assert.equal(tunnel.kind, 'dry');
  assert.equal(tunnel.contactIntensity, 0);
});

test('saturated rain, snow, and slush retain 120km/h propulsion reserve', () => {
  const scenarios = [
    ['rain', resolveSurfaceTargets({ wetness: 1, snowCover: 0, dust: 0 })],
    ['snow', resolveSurfaceTargets({ wetness: 0, snowCover: 1, dust: 0 })],
    ['mixed', resolveSurfaceTargets({ wetness: 1, snowCover: 1, dust: 0 })]
  ];
  for (const [label, targets] of scenarios) {
    const targetSpeedMps = 120 / 3.6;
    const cruise = simulateSaturatedCruise(targets, 30);
    assert.ok(
      cruise.peakSpeedMps >= targetSpeedMps,
      `${label} prevented the 120km/h cruise target: ${JSON.stringify(cruise)}`
    );
    assert.ok(
      cruise.finalSpeedMps >= targetSpeedMps,
      `${label} exhausted propulsion before 120km/h: ${JSON.stringify(cruise)}`
    );

    const saturated = simulateSaturatedCruise(targets, 60, targetSpeedMps);
    assert.ok(
      saturated.averageDecelerationMps2
        <= SURFACE_FORCE_CONTRACT.maximumSustainedAverageDecelerationMps2,
      `${label} exhausted the reserved cruise thrust: ${JSON.stringify(saturated)}`
    );
    assert.ok(
      SURFACE_FORCE_CONTRACT.referenceCruiseAccelerationMps2
        - saturated.averageDecelerationMps2 > 0,
      `${label} left no positive sustained propulsion reserve`
    );
  }
});

test('water displacement and snow compaction conserve bounded state then recover', () => {
  assert.equal(Object.isFrozen(SURFACE_CELL_CONTRACT), true);
  assert.equal(SURFACE_CELL_CONTRACT.cadenceIndependent, true);
  const cell = {
    waterDisplacement: 0,
    waterWaveEnergy: 0,
    snowCompaction: 0,
    snowCleared: 0,
    snowBermLeft: 0,
    snowBermRight: 0,
    snowBankCompaction: 0,
    snowBankDisplacement: 0
  };
  const returned = disturbSurfaceCell(cell, {
    waterEnergy: 0.8,
    snowEnergy: 0.9,
    snowBankEnergy: 0.84,
    signedSlip: 0.75
  });
  assert.strictEqual(returned, cell);
  for (const value of Object.values(cell)) assert.ok(value >= 0 && value <= 1);
  assert.ok(cell.waterDisplacement > 0);
  assert.ok(cell.waterWaveEnergy > 0);
  assert.ok(cell.snowCompaction > 0);
  assert.ok(cell.snowCleared > 0);
  assert.ok(cell.snowBermRight > cell.snowBermLeft);
  assert.ok(cell.snowBankCompaction > 0);
  assert.ok(cell.snowBankDisplacement > 0);

  const disturbed = { ...cell };
  stepSurfaceCell(cell, { snowAccumulation: 0.8 }, 5);
  assert.ok(cell.waterDisplacement < disturbed.waterDisplacement);
  assert.ok(cell.waterWaveEnergy < disturbed.waterWaveEnergy);
  assert.ok(cell.snowCompaction < disturbed.snowCompaction);
  assert.ok(cell.snowBermRight < disturbed.snowBermRight);
  assert.ok(cell.snowBankCompaction < disturbed.snowBankCompaction);
  assert.ok(cell.snowBankDisplacement < disturbed.snowBankDisplacement);
});

test('surface-cell recovery is equal at 30, 60, and 120 Hz and zero delta freezes it', () => {
  const initial = {
    waterDisplacement: 0.82,
    waterWaveEnergy: 0.74,
    snowCompaction: 0.69,
    snowCleared: 0.63,
    snowBermLeft: 0.52,
    snowBermRight: 0.58,
    snowBankCompaction: 0.66,
    snowBankDisplacement: 0.61
  };
  const integrateCell = (hz) => {
    const cell = { ...initial };
    for (let frame = 0; frame < hz * 6; frame++) {
      stepSurfaceCell(cell, { snowAccumulation: 0.72 }, 1 / hz);
    }
    return cell;
  };
  const samples = [30, 60, 120].map(integrateCell);
  for (const key of Object.keys(initial)) {
    const values = samples.map((sample) => sample[key]);
    assert.ok(
      Math.max(...values) - Math.min(...values) <= 0.000_000_001,
      `${key} recovery depends on cadence`
    );
  }
  const frozen = { ...initial };
  stepSurfaceCell(frozen, { snowAccumulation: 1 }, 0);
  assert.deepEqual(frozen, initial);
});

test('reset emits a complete identity response into caller-owned scratch', () => {
  const scratch = {
    kind: 'slush',
    contactIntensity: 1,
    longitudinalDecelerationMps2: 30,
    lateralAccelerationMultiplier: 0
  };
  assert.strictEqual(resetSurfaceContactResponse(scratch), scratch);
  assert.equal(scratch.kind, 'dry');
  assert.equal(scratch.contactIntensity, 0);
  assert.equal(scratch.longitudinalDecelerationMps2, 0);
  assert.equal(scratch.lateralAccelerationMultiplier, 1);
  assert.equal(scratch.lateralDragMultiplier, 1);
  assert.equal(scratch.lateralSpeedMultiplier, 1);
  assert.equal(scratch.pressureFactor, 0);
});

test('pure rain, snow, and dust targets stay isolated while mixed surfaces remain plausible', () => {
  const rain = resolveSurfaceTargets({ wetness: 1, snowCover: 0, dust: 0 });
  const snow = resolveSurfaceTargets({ wetness: 0, snowCover: 1, dust: 0 });
  const dust = resolveSurfaceTargets({ wetness: 0, snowCover: 0, dust: 1 });

  assert.deepEqual(copyChannels(rain), { water: 1, snow: 0, slush: 0, dust: 0 });
  assert.deepEqual(copyChannels(snow), { water: 0, snow: 1, slush: 0, dust: 0 });
  assert.deepEqual(copyChannels(dust), { water: 0, snow: 0, slush: 0, dust: 1 });

  const wetSnow = resolveSurfaceTargets({ wetness: 1, snowCover: 1, dust: 0 });
  assert.ok(wetSnow.slush > 0, 'simultaneous wetness and snow must create slush');
  assert.ok(wetSnow.water < rain.water, 'snow cover must suppress exposed standing water');

  const dryDust = resolveSurfaceTargets({ wetness: 0, snowCover: 0, dust: 1 });
  const dampDust = resolveSurfaceTargets({ wetness: 1, snowCover: 0, dust: 1 });
  assert.ok(dampDust.dust < dryDust.dust, 'wet ground must suppress loose surface dust');
});

test('surface accumulation and dissipation are monotonic without overshoot', () => {
  for (const channel of CHANNELS) {
    const risingState = { water: 0, snow: 0, slush: 0, dust: 0 };
    const risingTargets = { water: 0, snow: 0, slush: 0, dust: 0, [channel]: 1 };
    let previous = risingState[channel];
    for (let step = 0; step < 120; step++) {
      stepSurfaceResponse(risingState, risingTargets, 0.25);
      assert.ok(risingState[channel] >= previous, `${channel} accumulation reversed at step ${step}`);
      assert.ok(risingState[channel] <= 1, `${channel} accumulation overshot its target`);
      previous = risingState[channel];
    }
    assert.ok(risingState[channel] > 0, `${channel} did not accumulate`);

    const fallingState = { water: 1, snow: 1, slush: 1, dust: 1 };
    const fallingTargets = { water: 0, snow: 0, slush: 0, dust: 0 };
    previous = fallingState[channel];
    for (let step = 0; step < 120; step++) {
      stepSurfaceResponse(fallingState, fallingTargets, 0.25);
      assert.ok(fallingState[channel] <= previous, `${channel} dissipation reversed at step ${step}`);
      assert.ok(fallingState[channel] >= 0, `${channel} dissipation undershot zero`);
      previous = fallingState[channel];
    }
    assert.ok(fallingState[channel] < 1, `${channel} did not dissipate`);
  }
});

test('30, 60, and 120 Hz produce cadence-independent responses for equal elapsed time', () => {
  const zero = { water: 0, snow: 0, slush: 0, dust: 0 };
  const accumulationTargets = { water: 0.92, snow: 0.76, slush: 0.38, dust: 0.64 };
  const accumulation = [30, 60, 120].map((hz) => (
    integrateAtHz(zero, accumulationTargets, 12, hz)
  ));

  const saturated = { water: 1, snow: 1, slush: 1, dust: 1 };
  const dryTargets = { water: 0, snow: 0, slush: 0, dust: 0 };
  const dissipation = [30, 60, 120].map((hz) => (
    integrateAtHz(saturated, dryTargets, 12, hz)
  ));

  for (const samples of [accumulation, dissipation]) {
    for (const channel of CHANNELS) {
      const values = samples.map((sample) => sample[channel]);
      assert.ok(
        Math.max(...values) - Math.min(...values) <= 0.000_000_001,
        `${channel} response depends on render cadence: ${values.join(', ')}`
      );
    }
  }
});

test('zero delta freezes every response channel exactly', () => {
  const state = { water: 0.18, snow: 0.37, slush: 0.52, dust: 0.81 };
  const before = { ...state };
  const returned = stepSurfaceResponse(
    state,
    { water: 1, snow: 0, slush: 1, dust: 0 },
    0
  );

  assert.strictEqual(returned, state);
  assert.deepEqual(state, before);
});

test('target resolution and response stepping always emit finite normalized channels', () => {
  const atmosphericValues = [Number.NaN, Number.NEGATIVE_INFINITY, -2, 0, 0.37, 1, 3, Number.POSITIVE_INFINITY];
  let targetIndex = 0;
  for (const wetness of atmosphericValues) {
    for (const snowCover of atmosphericValues) {
      for (const dust of atmosphericValues) {
        const targets = resolveSurfaceTargets({ wetness, snowCover, dust });
        assertNormalizedChannels(targets, `targets[${targetIndex}]`);
        targetIndex++;
      }
    }
  }

  const malformedCases = [
    {
      current: { water: Number.NaN, snow: -4, slush: Number.POSITIVE_INFINITY, dust: 2 },
      targets: { water: Number.POSITIVE_INFINITY, snow: 4, slush: -1, dust: Number.NaN },
      deltaSeconds: Number.POSITIVE_INFINITY
    },
    {
      current: {},
      targets: {},
      deltaSeconds: Number.NaN
    },
    {
      current: { water: 0.1, snow: 0.2, slush: 0.3, dust: 0.4 },
      targets: { water: 0.9, snow: 0.8, slush: 0.7, dust: 0.6 },
      deltaSeconds: 1_000_000
    }
  ];
  malformedCases.forEach((entry, index) => {
    const output = {};
    const returned = stepSurfaceResponse(entry.current, entry.targets, entry.deltaSeconds, output);
    assert.strictEqual(returned, output);
    assertNormalizedChannels(output, `response[${index}]`);
  });
});
