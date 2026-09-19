/*
 * Neon surface-weather interaction authority.
 * The module owns slow accumulation, stable near-field surface cells, swept contact sampling, and pooled
 * deformation effects. It returns bounded force coefficients to runtime but never writes speed, routing,
 * collision, lives, or the ship pose itself.
 */
window.NeonSurfaceWeather = (() => {
  'use strict';

  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const lerpNumber = (a, b, t) => a + (b - a) * t;
  const SURFACE_RESPONSE_KEYS = Object.freeze(['water', 'snow', 'slush', 'dust']);
  const SURFACE_CELL_CONTRACT = Object.freeze({
    keyMode: 'route-edge-quantized-station',
    waterDisplacementRecoverySeconds: 1.8,
    waterWaveRecoverySeconds: 0.92,
    snowCompactionRecoverySeconds: Object.freeze({ dry: 42, activeSnow: 16 }),
    snowBermRecoverySeconds: Object.freeze({ dry: 48, activeSnow: 18 }),
    cadenceIndependent: true,
    pausableClock: 'weather-motion-time'
  });
  const SURFACE_RENDER_CONTRACT = Object.freeze({
    mobileSurfaceDrawGroupBudget: 6,
    desktopSurfaceDrawGroupBudget: 9,
    mobileSnowRidgeMode: 'encoded-by-compressed-track-edge',
    mobileWaterWaveMode: 'speed-exclusive-ripple-or-wake',
    mobileMixedParticleMode: 'single-dominant-layer',
    snowSheetShadowMode: 'receive-only',
    volumetricSnowShadowMode: 'banks-only',
    snowAlbedoFloorMode: 'neutral-multiple-scattering-fill'
  });
  const SURFACE_LAYOUT_CONTRACT = Object.freeze({
    version: 'Neon-surface-layout-4',
    policy: 'route-stable-long-horizon-buckets',
    fairSpeedMps: 45,
    slotSpacingM: 24,
    stationJitterM: 6.8,
    retainBehindM: 96,
    mobileSlotCapacity: 52,
    desktopSlotCapacity: 68,
    // The lower bound accounts for floor-bucket phase and stays ahead of the expanded realm fog at every distance.
    minimumForwardPreviewM: Object.freeze({ mobile: 1_104, desktop: 1_488 }),
    minimumForwardPreviewSecondsAtFairSpeed: Object.freeze({
      mobile: 1_104 / 45,
      desktop: 1_488 / 45
    }),
    popInBoundary: 'at-or-beyond-effective-weather-fog'
  });
  const SURFACE_FORCE_CONTRACT = Object.freeze({
    authority: 'runtime-applies-bounded-surface-load',
    contactModel: 'swept-open-sky-pressure-footprint',
    maximumDownwashClearanceM: 0.58,
    // Even saturated mixed contact stays below the 3.6m/s² propulsion authority. At 120km/h the 1.2m/s² local
    // ceiling also fits inside the dry full-throttle reserve, so weather can slow the craft without pinning it.
    maximumLongitudinalDecelerationMps2: 1.2,
    minimumLateralAccelerationMultiplier: 0.58,
    minimumLateralDragMultiplier: 0.44,
    minimumLateralSpeedMultiplier: 0.84,
    waterReferenceSpeedMps: 160 / 3.6,
    snowReferenceSpeedMps: 120 / 3.6,
    // Route-density audits reserve at least 75% of the 3.6m/s² drive authority at the 120km/h cruise reference.
    sustainedLoadScale: 0.03,
    referenceCruiseAccelerationMps2: 3.6,
    maximumSustainedAverageDecelerationMps2: 0.9,
    gameplayWriteAuthority: 'runtime-only',
    routeAuthority: false,
    collisionAuthority: false
  });
  const STANDING_WATER_CONTRACT = Object.freeze({
    exposure: 'open-sky-route-only',
    blockedTunnelKinds: Object.freeze(['mountain-tunnel', 'underground-tunnel']),
    materialModel: 'dielectric-physical-water',
    lightingAuthority: 'physical-lighting-state',
    projectedShadowMode: 'receive-only',
    environmentReflection: true,
    directLightReflection: true,
    geometryVisualOnly: true,
    surfaceForceAuthority: SURFACE_FORCE_CONTRACT.authority
  });
  const PUDDLE_OPTICS_CONTRACT = Object.freeze({
    model: 'neutral-dielectric-feathered-micro-normal',
    shorelineAlphaMode: 'radial-feather-with-irregular-geometry',
    microNormalMode: 'deterministic-cross-wave-canvas-texture',
    instanceVariationMode: 'route-bucket-local-rotation',
    deformationMode: 'bounded-depress-and-spread',
    additionalDrawGroups: 0,
    textureSize: Object.freeze({ mobile: 64, desktop: 128 }),
    normalRepeat: Object.freeze({ mobile: 2.2, desktop: 3.2 }),
    ambientRainRippleCadenceSeconds: Object.freeze({ mobile: 0.34, desktop: 0.18 }),
    ambientRainRippleMinimumWater: 0.08,
    // Three millimetres prevents coplanar depth fighting without making the water read as a hovering acrylic sheet.
    visualSurfaceLiftM: 0.003,
    maximumNormalMotionM: 0.001_5,
    minimumRoadClearanceM: 0.001_5
  });
  const SNOW_ACCUMULATION_CONTRACT = Object.freeze({
    exposure: 'open-sky-route-only',
    blockedTunnelKinds: Object.freeze(['mountain-tunnel', 'underground-tunnel']),
    blockedEffects: Object.freeze(['patches', 'banks', 'tracks', 'ridges', 'powder']),
    sheetVisualSurfaceLiftM: 0.004,
    sheetMaximumCompactionDepressionM: 0.002_5,
    sheetMinimumRoadClearanceM: 0.001_5,
    bankVisualSurfaceLiftM: 0.002,
    bankGeometry: 'sealed-flat-bottom-organic-half-hill',
    bankLocalVerticalRange: Object.freeze({ minimum: 0, maximum: 1 }),
    geometryVisualOnly: true,
    surfaceForceAuthority: SURFACE_FORCE_CONTRACT.authority
  });
  const SNOW_POWDER_CONTACT_CONTRACT = Object.freeze({
    trigger: 'swept-pressure-footprint-open-sky-snow-patch',
    minimumSnowAccumulation: 0.06,
    baseParticlesPerBurst: 6,
    maximumParticlesPerBurst: 20,
    maximumBurstsPerUpdate: 4,
    particleLifeSeconds: Object.freeze({ minimum: 0.28, maximum: 0.72 }),
    volumeBounded: true,
    geometryVisualOnly: true
  });
  const SHOULDER_SNOW_INTERACTION_CONTRACT = Object.freeze({
    version: 'Neon-shoulder-snow-1',
    trigger: 'swept-pressure-footprint-open-sky-shoulder-bank',
    layoutMode: 'paired-sampled-road-edge-banks',
    banksPerRouteBucket: 2,
    roadEdgeInsetM: 0.72,
    minimumDeformationEnergy: 0.004,
    minimumPowderEnergy: 0.035,
    maximumHeightLossRatio: 0.56,
    maximumOutwardDisplacementM: 0.42,
    additionalDrawGroups: 0,
    geometryVisualOnly: true,
    surfaceForceAuthority: SURFACE_FORCE_CONTRACT.authority
  });
  const WATER_WAKE_CONTRACT = Object.freeze({
    spatialStepM: 2.4,
    maximumSegmentsPerPatchPerUpdate: 5,
    lifeSeconds: Object.freeze({ minimum: 0.72, maximum: 1.34 }),
    contactPositionAuthority: 'swept-route-intersection',
    geometryVisualOnly: true
  });
  const WATER_LOCAL_SPRAY_CONTRACT = Object.freeze({
    mode: 'per-tail-or-contact-edge-local-jets',
    minimumDeformationEnergy: 0.008,
    minimumRippleEnergy: 0.018,
    minimumWakeEnergy: 0.045,
    minimumSprayEnergy: 0.065,
    maximumParticlesPerContact: 12,
    maximumParticlesPerJet: 8,
    grazingContactCanDisturbWithoutSpray: true,
    wholeFootprintBurst: false,
    geometryVisualOnly: true
  });

  /** Resolve progressive local water energy so a tangent touch cannot trigger a full-footprint spray burst. */
  function resolveLocalWaterResponse(sample = {}, out = {}) {
    const intervalCoverage = clamp01(sample.intervalCoverage);
    const longitudinalPenetration = clamp01(sample.longitudinalPenetration);
    const lateralPenetration = clamp01(sample.lateralPenetration);
    const rawCoverage = Math.sqrt(
      intervalCoverage * longitudinalPenetration * lateralPenetration
    );
    const localCoverage = rawCoverage * rawCoverage * (3 - 2 * rawCoverage);
    const accumulation = clamp01(sample.accumulation);
    const pressureFactor = clamp01(sample.pressureFactor);
    const speedFactor = clamp01(sample.speedFactor);
    const landingEnergy = clamp01(sample.landingEnergy);
    const deformationEnergy = clamp01(
      accumulation
        * pressureFactor
        * (0.22 + speedFactor * 0.58 + landingEnergy * 0.20)
        * localCoverage
    );
    const sprayEnergy = deformationEnergy * clamp01((localCoverage - 0.08) / 0.92);
    const particleCount = sprayEnergy >= WATER_LOCAL_SPRAY_CONTRACT.minimumSprayEnergy
      ? Math.min(
        WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerContact,
        Math.max(1, Math.round(sprayEnergy * 10 + landingEnergy * 2))
      )
      : 0;
    out.localCoverage = localCoverage;
    out.deformationEnergy = deformationEnergy;
    out.rippleEnergy = deformationEnergy;
    out.wakeEnergy = deformationEnergy * (0.34 + speedFactor * 0.66);
    out.sprayEnergy = sprayEnergy;
    out.particleCount = particleCount;
    out.emitRipple = out.rippleEnergy >= WATER_LOCAL_SPRAY_CONTRACT.minimumRippleEnergy;
    out.emitWake = out.wakeEnergy >= WATER_LOCAL_SPRAY_CONTRACT.minimumWakeEnergy;
    out.emitSpray = particleCount > 0;
    return out;
  }

  /** Covered route samples own no standing-water geometry or contact effects, even during heavy rain. */
  function allowsStandingWater(frame = {}) {
    return frame?.covered !== true && !frame?.tunnelKind;
  }

  /** Covered route samples own no settled snow or contact powder, even while outdoor snow remains active. */
  function allowsSnowAccumulation(frame = {}) {
    return frame?.covered !== true && !frame?.tunnelKind;
  }

  /** Resolve only water-material response; sun, moon, lightning, and fixtures still illuminate it as real lights. */
  function resolvePuddleLightingResponse(lightingState = {}, water = 0, out = {}) {
    const rawEnvironmentIntensity = Number(lightingState?.environmentIntensity);
    const environmentIntensity = Number.isFinite(rawEnvironmentIntensity)
      ? Math.max(0, Math.min(2, rawEnvironmentIntensity))
      : 1;
    const sunIntensity = Math.max(0, Number(lightingState?.sunIntensity) || 0);
    const waterStrength = clamp01(water);
    out.environmentIntensity = environmentIntensity;
    out.sunIntensity = sunIntensity;
    out.envMapIntensity = Math.max(
      1.04,
      Math.min(1.15, 1.04 + environmentIntensity * 0.035 + waterStrength * 0.04)
    );
    // Direct lights already enter the dielectric BRDF. Keeping the F0 response at one avoids counting the sun twice.
    out.specularIntensity = 1;
    out.roughness = lerpNumber(0.14, 0.07, waterStrength);
    const coverageInput = clamp01((waterStrength - 0.015) / 0.20);
    const coverage = coverageInput * coverageInput * (3 - coverageInput * 2);
    out.opacity = coverage * (0.38 + waterStrength * 0.14);
    out.normalStrength = lerpNumber(0.035, 0.11, waterStrength);
    return out;
  }

  /** Detect one directional centre crossing so a visible snow patch emits once instead of every distance bucket. */
  function crossesSnowPatch(sweep = {}, patch = {}) {
    const previousDistance = Number(sweep.previousDistance);
    const currentDistance = Number(sweep.currentDistance);
    const previousLateral = Number(sweep.previousLateral);
    const currentLateral = Number(sweep.currentLateral);
    const snowAccumulation = Number(sweep.snowAccumulation);
    const station = Number(patch.station);
    const lateral = Number(patch.lateral);
    const halfWidth = Number(patch.halfWidth);
    if (![previousDistance, currentDistance, previousLateral, currentLateral,
      snowAccumulation, station, lateral, halfWidth].every(Number.isFinite)) return false;
    if (patch.snowAccumulationAllowed !== true
      || snowAccumulation <= SNOW_POWDER_CONTACT_CONTRACT.minimumSnowAccumulation) return false;
    const distanceDelta = currentDistance - previousDistance;
    if (Math.abs(distanceDelta) <= 0.000_001) return false;
    const crossingProgress = (station - previousDistance) / distanceDelta;
    // Excluding progress zero prevents the same patch from firing again on the next render frame.
    if (crossingProgress <= 0 || crossingProgress > 1) return false;
    const crossingLateral = lerpNumber(previousLateral, currentLateral, crossingProgress);
    const footprintHalfWidthM = Math.max(0, Number(sweep.footprintHalfWidthM) || 0);
    return Math.abs(crossingLateral - lateral)
      <= Math.max(0, halfWidth) + footprintHalfWidthM;
  }

  /**
   * Resolve one shoulder-bank sweep into local, bounded deformation energy.
   * The caller supplies the shared continuous solver and a reusable output so the live loop stays allocation-free.
   */
  function resolveShoulderSnowInteraction(
    sweep = {},
    bank = {},
    sweptEllipseInterval,
    out = {}
  ) {
    out.hit = false;
    out.interactive = false;
    out.entryT = null;
    out.exitT = null;
    out.intervalCoverage = 0;
    out.localCoverage = 0;
    out.pressureFactor = 0;
    out.deformationEnergy = 0;
    out.particleCount = 0;
    out.contactProgress = 0;
    out.contactStation = 0;
    out.contactLateral = 0;
    out.side = Math.sign(Number(bank.side) || Number(bank.lateral) || 0);
    if (typeof sweptEllipseInterval !== 'function'
      || sweep.enabled === false
      || bank.snowAccumulationAllowed !== true) return out;

    const previousDistance = Number(sweep.previousDistance);
    const currentDistance = Number(sweep.currentDistance);
    const previousLateral = Number(sweep.previousLateral);
    const currentLateral = Number(sweep.currentLateral);
    const station = Number(bank.station);
    const lateral = Number(bank.lateral);
    const halfLength = Number(bank.halfLength);
    const halfWidth = Number(bank.halfWidth);
    const footprintHalfLengthM = Number(sweep.footprintHalfLengthM);
    const footprintHalfWidthM = Number(sweep.footprintHalfWidthM);
    const snowAccumulation = clamp01(sweep.snowAccumulation);
    if (![previousDistance, currentDistance, previousLateral, currentLateral,
      station, lateral, halfLength, halfWidth, footprintHalfLengthM,
      footprintHalfWidthM].every(Number.isFinite)
      || halfLength <= 0
      || halfWidth <= 0
      || footprintHalfLengthM <= 0
      || footprintHalfWidthM <= 0
      || snowAccumulation <= SNOW_POWDER_CONTACT_CONTRACT.minimumSnowAccumulation) return out;

    const clearanceM = Math.max(0, Number(sweep.clearanceM) || 0);
    const pressureFactor = sweep.grounded === false
      ? clamp01(1 - clearanceM / SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM)
      : 1;
    out.pressureFactor = pressureFactor;
    if (pressureFactor <= 0.000_001) return out;

    sweptEllipseInterval(
      previousDistance - station,
      previousLateral - lateral,
      currentDistance - station,
      currentLateral - lateral,
      halfLength,
      halfWidth,
      footprintHalfLengthM,
      footprintHalfWidthM,
      out
    );
    if (!out.hit) return out;

    const entryT = clamp01(out.entryT);
    const exitT = clamp01(out.exitT);
    const contactProgress = (entryT + exitT) * 0.5;
    const contactStation = lerpNumber(previousDistance, currentDistance, contactProgress);
    const craftLateral = lerpNumber(previousLateral, currentLateral, contactProgress);
    const longitudinalPenetration = clamp01(
      1 - Math.abs(contactStation - station) / (halfLength + footprintHalfLengthM)
    );
    const lateralPenetration = clamp01(
      1 - Math.abs(craftLateral - lateral) / (halfWidth + footprintHalfWidthM)
    );
    const intervalCoverage = Math.max(0, exitT - entryT);
    // A true tangent remains a light graze instead of becoming a full burst or disappearing at one render cadence.
    const rawCoverage = Math.sqrt(
      Math.max(intervalCoverage, 0.012_5)
        * Math.max(longitudinalPenetration, 0.025)
        * Math.max(lateralPenetration, 0.025)
    );
    const localCoverage = clamp01(rawCoverage);
    const smoothedCoverage = localCoverage * localCoverage * (3 - localCoverage * 2);
    const speedFactor = clamp01((Number(sweep.speedMps) || 0) / 180);
    const landingEnergy = clamp01(sweep.landingEnergy);
    const deformationEnergy = clamp01(
      snowAccumulation
        * pressureFactor
        * (0.34 + speedFactor * 0.48 + landingEnergy * 0.18)
        * smoothedCoverage
    );
    const contactOffset = Math.max(
      -footprintHalfWidthM,
      Math.min(footprintHalfWidthM, lateral - craftLateral)
    );
    out.entryT = entryT;
    out.exitT = exitT;
    out.intervalCoverage = intervalCoverage;
    out.localCoverage = localCoverage;
    out.deformationEnergy = deformationEnergy;
    out.interactive =
      deformationEnergy >= SHOULDER_SNOW_INTERACTION_CONTRACT.minimumDeformationEnergy;
    out.contactProgress = contactProgress;
    out.contactStation = contactStation;
    out.contactLateral = craftLateral + contactOffset;
    out.particleCount =
      deformationEnergy >= SHOULDER_SNOW_INTERACTION_CONTRACT.minimumPowderEnergy
        ? Math.min(
          SNOW_POWDER_CONTACT_CONTRACT.maximumParticlesPerBurst,
          Math.max(
            1,
            Math.round(
              SNOW_POWDER_CONTACT_CONTRACT.baseParticlesPerBurst
                + deformationEnergy
                  * (SNOW_POWDER_CONTACT_CONTRACT.maximumParticlesPerBurst
                    - SNOW_POWDER_CONTACT_CONTRACT.baseParticlesPerBurst)
            )
          )
        )
        : 0;
    return out;
  }

  /** Reset one reusable contact response without allocating in the frame loop. */
  function resetSurfaceContactResponse(out = {}) {
    out.active = false;
    out.kind = 'dry';
    out.waterContact = 0;
    out.snowContact = 0;
    out.slushContact = 0;
    out.contactIntensity = 0;
    out.longitudinalDecelerationMps2 = 0;
    out.lateralAccelerationMultiplier = 1;
    out.lateralDragMultiplier = 1;
    out.lateralSpeedMultiplier = 1;
    out.attitudeHeaveM = 0;
    out.attitudePitchRad = 0;
    out.attitudeRollRad = 0;
    out.contactCoverage = 0;
    out.pressureFactor = 0;
    return out;
  }

  /**
   * Convert exact swept coverage into a bounded pressure-load response for the hover craft.
   * Runtime remains the only writer of authoritative velocity; this pure function is shared by player and autopilot.
   */
  function resolveSurfaceForceResponse(contact = {}, motion = {}, out = {}) {
    resetSurfaceContactResponse(out);
    if (motion.openSky === false) return out;
    const clearanceM = Math.max(0, Number(motion.clearanceM) || 0);
    const pressureFactor = motion.grounded === false
      ? clamp01(1 - clearanceM / SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM)
      : 1;
    if (pressureFactor <= 0.000_001) return out;
    const speedMps = Math.max(0, Number(motion.speedMps) || 0);
    const lateralSpeedMps = Number(motion.lateralSpeedMps) || 0;
    const waterCoverage = clamp01(contact.waterCoverage);
    const snowCoverage = clamp01(contact.snowCoverage);
    const slushCoverage = clamp01(contact.slushCoverage);
    const water = clamp01(contact.waterAccumulation) * waterCoverage * pressureFactor;
    const snow = clamp01(contact.snowAccumulation) * snowCoverage * pressureFactor;
    const slush = clamp01(contact.slushAccumulation) * Math.max(
      slushCoverage,
      Math.min(waterCoverage, snowCoverage)
    ) * pressureFactor;
    const contactIntensity = clamp01(Math.max(water, snow, slush));
    if (contactIntensity <= 0.000_001) return out;

    const waterSpeed = clamp01(speedMps / SURFACE_FORCE_CONTRACT.waterReferenceSpeedMps);
    const snowSpeed = clamp01(speedMps / SURFACE_FORCE_CONTRACT.snowReferenceSpeedMps);
    const slipSpeed = clamp01(Math.abs(lateralSpeedMps) / 22);
    const loadScale = SURFACE_FORCE_CONTRACT.sustainedLoadScale;
    const waterLoad = water * (2.4 + waterSpeed * waterSpeed * 18.8) * loadScale;
    const snowLoad = snow * (1.2 + snowSpeed * 6.8) * loadScale;
    const slushLoad = slush * (3.8 + waterSpeed * 13.6) * loadScale;
    const slip = clamp01(
      water * (0.18 + waterSpeed * 0.52)
      + snow * (0.20 + snowSpeed * 0.24)
      + slush * 0.54
      + slipSpeed * contactIntensity * 0.14
    );
    const signedSurfaceWave = Math.sin(
      (Number(motion.distanceM) || 0) * 0.82 + lateralSpeedMps * 0.11
    );

    out.active = true;
    out.kind = slush >= Math.max(water, snow) * 0.72
      ? 'slush'
      : water >= snow ? 'water' : 'snow';
    out.waterContact = water;
    out.snowContact = snow;
    out.slushContact = slush;
    out.contactIntensity = contactIntensity;
    out.contactCoverage = clamp01(Math.max(waterCoverage, snowCoverage, slushCoverage));
    out.pressureFactor = pressureFactor;
    out.longitudinalDecelerationMps2 = Math.min(
      SURFACE_FORCE_CONTRACT.maximumLongitudinalDecelerationMps2,
      waterLoad + snowLoad + slushLoad
    );
    out.lateralAccelerationMultiplier = lerpNumber(
      1,
      SURFACE_FORCE_CONTRACT.minimumLateralAccelerationMultiplier,
      slip
    );
    out.lateralDragMultiplier = lerpNumber(
      1,
      SURFACE_FORCE_CONTRACT.minimumLateralDragMultiplier,
      slip
    );
    out.lateralSpeedMultiplier = lerpNumber(
      1,
      SURFACE_FORCE_CONTRACT.minimumLateralSpeedMultiplier,
      slip
    );
    out.attitudeHeaveM = signedSurfaceWave * contactIntensity * 0.026;
    out.attitudePitchRad = -signedSurfaceWave * contactIntensity * 0.009;
    out.attitudeRollRad = -Math.sign(lateralSpeedMps || signedSurfaceWave)
      * slip * 0.012;
    return out;
  }

  /** Apply one contact-energy packet to a stable surface cell while conserving bounded visual state. */
  function disturbSurfaceCell(current = {}, interaction = {}, out = current) {
    const waterEnergy = clamp01(interaction.waterEnergy);
    const snowEnergy = clamp01(interaction.snowEnergy);
    const signedSlip = Math.max(-1, Math.min(1, Number(interaction.signedSlip) || 0));
    const existingWaterDisplacement = clamp01(current.waterDisplacement);
    const existingWaterWaveEnergy = clamp01(current.waterWaveEnergy);
    const existingSnowCompaction = clamp01(current.snowCompaction);
    const existingSnowCleared = clamp01(current.snowCleared);
    const existingLeftBerm = clamp01(current.snowBermLeft);
    const existingRightBerm = clamp01(current.snowBermRight);
    const existingSnowBankCompaction = clamp01(current.snowBankCompaction);
    const existingSnowBankDisplacement = clamp01(current.snowBankDisplacement);
    const snowBankEnergy = clamp01(interaction.snowBankEnergy);
    const leftShare = clamp01(0.5 - signedSlip * 0.32);
    const rightShare = clamp01(0.5 + signedSlip * 0.32);

    out.waterDisplacement = clamp01(Math.max(
      existingWaterDisplacement,
      waterEnergy * 0.72
    ));
    out.waterWaveEnergy = clamp01(existingWaterWaveEnergy + waterEnergy * 0.64);
    out.snowCompaction = clamp01(existingSnowCompaction + snowEnergy * 0.62);
    out.snowCleared = clamp01(existingSnowCleared + snowEnergy * 0.46);
    out.snowBermLeft = clamp01(existingLeftBerm + snowEnergy * leftShare * 0.48);
    out.snowBermRight = clamp01(existingRightBerm + snowEnergy * rightShare * 0.48);
    out.snowBankCompaction = clamp01(existingSnowBankCompaction + snowBankEnergy * 0.72);
    out.snowBankDisplacement = clamp01(existingSnowBankDisplacement + snowBankEnergy * 0.58);
    return out;
  }

  /** Recover displaced water and compacted snow from the same pausable clock, independent of render cadence. */
  function stepSurfaceCell(current = {}, weatherState = {}, deltaSeconds = 0, out = current) {
    const dt = Math.max(0, Number(deltaSeconds) || 0);
    const snowActivity = clamp01(weatherState.snowAccumulation);
    const snowRecoverySeconds = lerpNumber(
      SURFACE_CELL_CONTRACT.snowCompactionRecoverySeconds.dry,
      SURFACE_CELL_CONTRACT.snowCompactionRecoverySeconds.activeSnow,
      snowActivity
    );
    const bermRecoverySeconds = lerpNumber(
      SURFACE_CELL_CONTRACT.snowBermRecoverySeconds.dry,
      SURFACE_CELL_CONTRACT.snowBermRecoverySeconds.activeSnow,
      snowActivity
    );
    out.waterDisplacement = clamp01(current.waterDisplacement)
      * Math.exp(-dt / SURFACE_CELL_CONTRACT.waterDisplacementRecoverySeconds);
    out.waterWaveEnergy = clamp01(current.waterWaveEnergy)
      * Math.exp(-dt / SURFACE_CELL_CONTRACT.waterWaveRecoverySeconds);
    out.snowCompaction = clamp01(current.snowCompaction) * Math.exp(-dt / snowRecoverySeconds);
    out.snowCleared = clamp01(current.snowCleared) * Math.exp(-dt / snowRecoverySeconds);
    out.snowBermLeft = clamp01(current.snowBermLeft) * Math.exp(-dt / bermRecoverySeconds);
    out.snowBermRight = clamp01(current.snowBermRight) * Math.exp(-dt / bermRecoverySeconds);
    out.snowBankCompaction = clamp01(current.snowBankCompaction)
      * Math.exp(-dt / snowRecoverySeconds);
    out.snowBankDisplacement = clamp01(current.snowBankDisplacement)
      * Math.exp(-dt / bermRecoverySeconds);
    return out;
  }

  /** Map the shared atmospheric snapshot to slower ground-state targets without inventing another weather clock. */
  function resolveSurfaceTargets(weather = {}, out = null) {
    const wetness = clamp01(weather.wetness);
    const snow = clamp01(weather.snowCover);
    const dust = clamp01(weather.dust);
    const slush = Math.min(wetness, snow) * (1 - snow * 0.58);
    const target = out || {};
    target.water = clamp01(wetness * (1 - snow * 0.72) + slush * 0.28);
    target.snow = snow;
    target.slush = clamp01(slush);
    target.dust = clamp01(dust * (1 - wetness * 0.42));
    return out ? target : Object.freeze(target);
  }

  /** Advance accumulation with time-constant smoothing so equal elapsed time is independent of render cadence. */
  function stepSurfaceResponse(current, targets, deltaSeconds, out = current) {
    const boundedDelta = Math.max(0, Number(deltaSeconds) || 0);
    for (const key of SURFACE_RESPONSE_KEYS) {
      const previous = clamp01(current?.[key]);
      const target = clamp01(targets?.[key]);
      const rising = target > previous;
      const seconds = key === 'water'
        ? (rising ? 7 : 30)
        : key === 'snow'
          ? (rising ? 12 : 48)
          : key === 'dust'
            ? (rising ? 10 : 36)
            : (rising ? 9 : 24);
      const blend = boundedDelta > 0 ? 1 - Math.exp(-boundedDelta / seconds) : 0;
      out[key] = lerpNumber(previous, target, blend);
    }
    return out;
  }

  function hashUint(value, salt = 0) {
    let hash = Math.imul((value | 0) ^ (salt | 0), 0x45d9_f3b);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x45d9_f3b);
    hash ^= hash >>> 16;
    return hash >>> 0;
  }

  function hashUnit(value, salt = 0) {
    return hashUint(value, salt) / 0xffff_ffff;
  }

  /** Build a low-poly organic sheet whose XY plane follows the sampled road basis. */
  function createIrregularDiscGeometry(THREE, segments, salt) {
    const count = Math.max(8, Math.floor(segments));
    const positions = new Float32Array((count + 1) * 3);
    const normals = new Float32Array((count + 1) * 3);
    const uvs = new Float32Array((count + 1) * 2);
    const indices = new Uint16Array(count * 3);
    normals[2] = 1;
    uvs[0] = 0.5;
    uvs[1] = 0.5;
    for (let index = 0; index < count; index++) {
      const angle = index / count * Math.PI * 2;
      const radius = 0.82
        + hashUnit(index, salt) * 0.24
        + Math.sin(angle * 3 + salt * 0.17) * 0.06;
      const vertex = index + 1;
      positions[vertex * 3] = Math.cos(angle) * radius;
      positions[vertex * 3 + 1] = Math.sin(angle) * radius;
      normals[vertex * 3 + 2] = 1;
      uvs[vertex * 2] = 0.5 + Math.cos(angle) * 0.5;
      uvs[vertex * 2 + 1] = 0.5 + Math.sin(angle) * 0.5;
      const next = (index + 1) % count + 1;
      indices[index * 3] = 0;
      indices[index * 3 + 1] = vertex;
      indices[index * 3 + 2] = next;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * Build a sealed organic half-hill with a true planar base. Local Z is the sampled road normal, so the complete
   * geometry remains on or above the road after scaling instead of hiding the lower half of a sphere under asphalt.
   */
  function createFlatBottomSnowBankGeometry(THREE, radialSegments, heightSegments) {
    const aroundCount = Math.max(8, Math.floor(radialSegments));
    const verticalCount = Math.max(3, Math.floor(heightSegments));
    const positions = [];
    const indices = [];
    for (let heightIndex = 0; heightIndex <= verticalCount; heightIndex++) {
      const heightT = heightIndex / verticalCount;
      const domeRadius = 0.075 + Math.pow(Math.max(0, 1 - heightT), 0.58) * 0.925;
      for (let radialIndex = 0; radialIndex < aroundCount; radialIndex++) {
        const angle = radialIndex / aroundCount * Math.PI * 2;
        const organicRadius = domeRadius * (
          1
          + Math.sin(angle * 3 + heightT * 1.7) * 0.035
          + Math.sin(angle * 5 - heightT * 2.1) * 0.018
        );
        positions.push(
          Math.cos(angle) * organicRadius,
          Math.sin(angle) * organicRadius,
          heightT
        );
      }
    }
    for (let heightIndex = 0; heightIndex < verticalCount; heightIndex++) {
      const ringStart = heightIndex * aroundCount;
      const nextRingStart = ringStart + aroundCount;
      for (let radialIndex = 0; radialIndex < aroundCount; radialIndex++) {
        const next = (radialIndex + 1) % aroundCount;
        indices.push(
          ringStart + radialIndex,
          ringStart + next,
          nextRingStart + radialIndex,
          ringStart + next,
          nextRingStart + next,
          nextRingStart + radialIndex
        );
      }
    }
    const bottomCenter = positions.length / 3;
    positions.push(0, 0, 0);
    const topCenter = positions.length / 3;
    positions.push(0, 0, 1);
    const topRingStart = verticalCount * aroundCount;
    for (let radialIndex = 0; radialIndex < aroundCount; radialIndex++) {
      const next = (radialIndex + 1) % aroundCount;
      indices.push(bottomCenter, next, radialIndex);
      indices.push(topCenter, topRingStart + radialIndex, topRingStart + next);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.neon = Object.freeze({
      factory: 'createFlatBottomSnowBankGeometry',
      closedExpected: true,
      flatRoadBase: true,
      localMinimumZ: 0,
      localMaximumZ: 1
    });
    return geometry;
  }

  /**
   * Build compact procedural optics once per surface system. The feather map hides polygon seams, the
   * roughness map keeps the shallow shore less mirror-like than the centre, and the normal map supplies
   * sub-centimetre rain/wind structure without adding geometry or another draw group.
   */
  function createPuddleSurfaceTextures(THREE, mobile) {
    const size = mobile
      ? PUDDLE_OPTICS_CONTRACT.textureSize.mobile
      : PUDDLE_OPTICS_CONTRACT.textureSize.desktop;
    const createCanvas = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      return canvas;
    };
    const makeDataTexture = (canvas) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      return texture;
    };

    const alphaCanvas = createCanvas();
    const alphaContext = alphaCanvas.getContext('2d');
    if (!alphaContext) throw new Error('Neon puddle optics requires a two-dimensional canvas context');
    const alphaGradient = alphaContext.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.04,
      size * 0.5,
      size * 0.5,
      size * 0.5
    );
    alphaGradient.addColorStop(0, 'rgb(255,255,255)');
    alphaGradient.addColorStop(0.72, 'rgb(246,246,246)');
    alphaGradient.addColorStop(0.88, 'rgb(154,154,154)');
    alphaGradient.addColorStop(1, 'rgb(0,0,0)');
    alphaContext.fillStyle = alphaGradient;
    alphaContext.fillRect(0, 0, size, size);
    const alphaMap = makeDataTexture(alphaCanvas);
    alphaMap.wrapS = THREE.ClampToEdgeWrapping;
    alphaMap.wrapT = THREE.ClampToEdgeWrapping;

    const roughnessCanvas = createCanvas();
    const roughnessContext = roughnessCanvas.getContext('2d');
    if (!roughnessContext) throw new Error('Neon puddle roughness requires a two-dimensional canvas context');
    const roughnessImage = roughnessContext.createImageData(size, size);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const u = (column + 0.5) / size * 2 - 1;
        const v = (row + 0.5) / size * 2 - 1;
        const radial = Math.hypot(u, v);
        const shoreInput = clamp01((radial - 0.62) / 0.38);
        const shore = shoreInput * shoreInput * (3 - shoreInput * 2);
        const variation = (
          Math.sin(column * 0.71 + row * 0.37)
          + Math.sin(column * -0.29 + row * 0.83 + 1.7)
        ) * 0.018;
        const roughness = clamp01(0.34 + shore * 0.62 + variation);
        const channel = Math.round(roughness * 255);
        const offset = (row * size + column) * 4;
        roughnessImage.data[offset] = channel;
        roughnessImage.data[offset + 1] = channel;
        roughnessImage.data[offset + 2] = channel;
        roughnessImage.data[offset + 3] = 255;
      }
    }
    roughnessContext.putImageData(roughnessImage, 0, 0);
    const roughnessMap = makeDataTexture(roughnessCanvas);
    roughnessMap.wrapS = THREE.ClampToEdgeWrapping;
    roughnessMap.wrapT = THREE.ClampToEdgeWrapping;

    const normalCanvas = createCanvas();
    const normalContext = normalCanvas.getContext('2d');
    if (!normalContext) throw new Error('Neon puddle normal map requires a two-dimensional canvas context');
    const normalImage = normalContext.createImageData(size, size);
    const heights = new Float32Array(size * size);
    const tau = Math.PI * 2;
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const u = (column + 0.5) / size;
        const v = (row + 0.5) / size;
        const ringA = Math.hypot(u - 0.28, v - 0.67);
        const ringB = Math.hypot(u - 0.76, v - 0.31);
        heights[row * size + column] =
          Math.sin((u * 2.3 + v * 0.72) * tau) * 0.46
          + Math.sin((u * -0.58 + v * 2.9) * tau + 1.4) * 0.31
          + Math.sin(ringA * tau * 8.2) * Math.exp(-ringA * 5.8) * 0.13
          + Math.sin(ringB * tau * 7.1 + 0.8) * Math.exp(-ringB * 6.4) * 0.10;
      }
    }
    for (let row = 0; row < size; row++) {
      const rowAbove = (row + size - 1) % size;
      const rowBelow = (row + 1) % size;
      for (let column = 0; column < size; column++) {
        const columnLeft = (column + size - 1) % size;
        const columnRight = (column + 1) % size;
        const dx = heights[row * size + columnRight] - heights[row * size + columnLeft];
        const dy = heights[rowBelow * size + column] - heights[rowAbove * size + column];
        const nx = -dx * 0.78;
        const ny = -dy * 0.78;
        const inverseLength = 1 / Math.hypot(nx, ny, 1);
        const offset = (row * size + column) * 4;
        normalImage.data[offset] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
        normalImage.data[offset + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
        normalImage.data[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
        normalImage.data[offset + 3] = 255;
      }
    }
    normalContext.putImageData(normalImage, 0, 0);
    const normalMap = makeDataTexture(normalCanvas);
    const normalRepeat = mobile
      ? PUDDLE_OPTICS_CONTRACT.normalRepeat.mobile
      : PUDDLE_OPTICS_CONTRACT.normalRepeat.desktop;
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(normalRepeat, normalRepeat * 0.78);

    return Object.freeze({ alphaMap, roughnessMap, normalMap });
  }

  /**
   * Instance colour already carries one effect's lifetime. Mirroring its brightness into alpha lets a lit,
   * normally blended ring or wake disappear cleanly instead of relying on neon-like additive blending.
   */
  function applyInstanceFadeToAlpha(material) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.a *= clamp(max(max(vColor.r, vColor.g), vColor.b), 0.0, 1.0);
#endif`
      );
    };
    material.customProgramCacheKey = () => 'neon-instance-brightness-alpha-1';
    return material;
  }

  /** Build two tapered foam shoulders in the local right/tangent plane for a readable V-shaped wake. */
  function createWaterWakeGeometry(THREE) {
    const positions = new Float32Array([
      -0.08, 0, 0, -0.22, -0.28, 0, -1, -1, 0,
      -0.08, 0, 0, -1, -1, 0, -0.72, -1, 0,
      0.08, 0, 0, 1, -1, 0, 0.22, -0.28, 0,
      0.08, 0, 0, 0.72, -1, 0, 1, -1, 0
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function createParticleTexture(THREE, kind) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Neon surface weather requires a two-dimensional canvas context');
    context.clearRect(0, 0, 64, 64);
    if (kind === 'powder') {
      const glow = context.createRadialGradient(32, 32, 2, 32, 32, 30);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.42, 'rgba(237,247,255,0.82)');
      glow.addColorStop(1, 'rgba(225,240,255,0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, 64, 64);
    } else {
      const glow = context.createRadialGradient(28, 24, 2, 32, 32, 28);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.30, 'rgba(218,228,230,0.82)');
      glow.addColorStop(1, 'rgba(160,176,180,0)');
      context.fillStyle = glow;
      context.beginPath();
      context.ellipse(32, 32, 16, 27, -0.42, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function createParticlePool(THREE, root, capacity, kind, mobile) {
    const positions = new Float32Array(capacity * 3);
    const velocities = new Float32Array(capacity * 3);
    const ages = new Float32Array(capacity);
    const lives = new Float32Array(capacity);
    positions.fill(-10_000);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    const texture = createParticleTexture(THREE, kind);
    const material = new THREE.PointsMaterial({
      color: kind === 'powder' ? 0xe9_f6ff : 0xc8_d6d9,
      size: kind === 'powder' ? (mobile ? 0.68 : 0.86) : (mobile ? 0.30 : 0.38),
      sizeAttenuation: true,
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      alphaTest: kind === 'water' ? 0.008 : 0,
      blending: THREE.NormalBlending
    });
    const object = new THREE.Points(geometry, material);
    object.name = `Neon.SurfaceWeather.${kind === 'powder' ? 'SnowPowder' : 'WaterSpray'}`;
    object.frustumCulled = false;
    object.renderOrder = 6;
    root.add(object);
    return {
      capacity,
      kind,
      positions,
      velocities,
      ages,
      lives,
      geometry,
      material,
      object,
      cursor: 0,
      activeCount: 0,
      texture
    };
  }

  function create(options = {}) {
    const {
      THREE,
      scene,
      state,
      quality,
      sampleSignedFrame,
      getWorldRenderOrigin,
      player,
      sweptEllipseInterval = window.NeonGameplayCore?.sweptEllipseInterval,
      surfaceFootprint = window.NeonShip?.SURFACE_FOOTPRINT_CONTRACT,
      contactTarget = null,
      markEffect = (object) => object,
      clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
      isReducedMotionEnabled = () => false,
      getLightingState = () => null
    } = options;
    if (!THREE || !scene || !state || !player) {
      throw new TypeError('Neon surface weather requires THREE, scene, state, and player');
    }
    if (typeof sampleSignedFrame !== 'function' || typeof getWorldRenderOrigin !== 'function') {
      throw new TypeError('Neon surface weather requires route sampling and render-origin callbacks');
    }
    if (typeof sweptEllipseInterval !== 'function') {
      throw new TypeError('Neon surface weather requires the shared swept-ellipse contact solver');
    }
    const footprintHalfWidthM = Number(surfaceFootprint?.pressureHalfWidthM);
    const footprintHalfLengthM = Number(surfaceFootprint?.pressureHalfLengthM);
    if (!(footprintHalfWidthM > 0) || !(footprintHalfLengthM > 0)) {
      throw new TypeError('Neon surface weather requires the ship surface-footprint contract');
    }
    const leftTailDownwash = surfaceFootprint.tailDownwashLocal?.left
      || Object.freeze({ x: -0.62, z: 0.96 });
    const rightTailDownwash = surfaceFootprint.tailDownwashLocal?.right
      || Object.freeze({ x: 0.62, z: 0.96 });

    const mobile = quality?.id === 'mobile';
    const slotCapacity = mobile
      ? SURFACE_LAYOUT_CONTRACT.mobileSlotCapacity
      : SURFACE_LAYOUT_CONTRACT.desktopSlotCapacity;
    const snowBankCapacity =
      slotCapacity * SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket;
    // Pools cover at least 72m of twin grooves and 58m of wake at mobile quality without frame allocations.
    const trackCapacity = mobile ? 48 : 96;
    const rippleCapacity = mobile ? 12 : 24;
    const wakeCapacity = mobile ? 24 : 48;
    const particleCapacity = mobile ? 80 : 192;
    const slotSpacingM = SURFACE_LAYOUT_CONTRACT.slotSpacingM;
    const defaultRoadHalfM = 8.4;
    const root = new THREE.Group();
    root.name = 'Neon.SurfaceWeather.Root';
    root.frustumCulled = false;
    markEffect(root, 'surface accumulation, persistent deformation, and pooled contact presentation');
    scene.add(root);

    const puddleGeometry = createIrregularDiscGeometry(THREE, mobile ? 20 : 32, 0x0a_71);
    const snowGeometry = createIrregularDiscGeometry(THREE, mobile ? 12 : 18, 0x5a_0f);
    const puddleSurfaceTextures = createPuddleSurfaceTextures(THREE, mobile);
    const puddleMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x94_a0a3,
      emissive: 0x00_0000,
      emissiveIntensity: 0,
      roughness: 0.11,
      metalness: 0,
      clearcoat: 0,
      ior: 1.333,
      specularIntensity: 1,
      envMapIntensity: 1.10,
      transmission: 0,
      thickness: 0,
      alphaMap: puddleSurfaceTextures.alphaMap,
      roughnessMap: puddleSurfaceTextures.roughnessMap,
      normalMap: puddleSurfaceTextures.normalMap,
      normalScale: new THREE.Vector2(0.06, 0.06),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      alphaTest: 0.015,
      depthWrite: false,
      side: THREE.FrontSide,
      dithering: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const snowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xff_ffff,
      emissive: 0xd8_e8ed,
      // This neutral floor approximates high-albedo snow's indirect multiple scattering in the current outdoor rig.
      emissiveIntensity: 0.32,
      roughness: 0.96,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.90,
      sheen: 0.26,
      sheenRoughness: 0.92,
      sheenColor: 0xf4_fbff,
      ior: 1.31,
      envMapIntensity: 1.15,
      vertexColors: true,
      // Geometry growth carries accumulation. Keeping the sheet opaque avoids alpha-compositing white snow into a
      // charcoal overlay on an already snow-brightened road while preserving physical light and shadow reception.
      transparent: false,
      opacity: 1,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const snowBankMaterial = snowMaterial.clone();
    snowBankMaterial.roughness = 0.96;
    const snowTrackMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f_a8b4,
      emissive: 0x25_3540,
      emissiveIntensity: 0.06,
      roughness: 0.78,
      metalness: 0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3
    });
    const puddles = new THREE.InstancedMesh(puddleGeometry, puddleMaterial, slotCapacity);
    puddles.name = 'Neon.SurfaceWeather.Puddles';
    puddles.frustumCulled = false;
    puddles.renderOrder = 2;
    puddles.castShadow = false;
    puddles.receiveShadow = true;
    puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(puddles, 'deterministic dielectric puddles with displacement response');
    root.add(puddles);
    const snowPatches = new THREE.InstancedMesh(snowGeometry, snowMaterial, slotCapacity);
    snowPatches.name = 'Neon.SurfaceWeather.SnowPatches';
    snowPatches.frustumCulled = false;
    snowPatches.renderOrder = 3;
    // A translucent sheet cannot use Three's default opaque depth pass: it creates black oval shadows before
    // optical snow density exists. It still receives real light/shadow; only volumetric shoulder banks cast.
    snowPatches.castShadow = false;
    snowPatches.receiveShadow = true;
    snowPatches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(snowPatches, 'deterministic road snow with compaction and cleared-groove response');
    root.add(snowPatches);
    const snowBanks = new THREE.InstancedMesh(
      createFlatBottomSnowBankGeometry(THREE, mobile ? 8 : 12, mobile ? 4 : 6),
      snowBankMaterial,
      snowBankCapacity
    );
    snowBanks.name = 'Neon.SurfaceWeather.SnowBanks';
    snowBanks.frustumCulled = false;
    snowBanks.castShadow = true;
    snowBanks.receiveShadow = true;
    snowBanks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(snowBanks, 'paired sampled-road-edge snow drifts with persistent local deformation');
    root.add(snowBanks);
    const snowTracks = new THREE.InstancedMesh(snowGeometry, snowTrackMaterial, trackCapacity);
    snowTracks.name = 'Neon.SurfaceWeather.CompressedTracks';
    snowTracks.frustumCulled = false;
    snowTracks.castShadow = false;
    snowTracks.receiveShadow = true;
    snowTracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(snowTracks, 'twin downwash-compressed snow grooves');
    root.add(snowTracks);
    const snowRidgeMaterial = snowBankMaterial.clone();
    snowRidgeMaterial.transparent = true;
    snowRidgeMaterial.opacity = 0;
    snowRidgeMaterial.depthWrite = false;
    snowRidgeMaterial.vertexColors = true;
    const snowRidges = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, mobile ? 7 : 10, mobile ? 4 : 6),
      snowRidgeMaterial,
      trackCapacity
    );
    snowRidges.name = 'Neon.SurfaceWeather.DisplacedSnowRidges';
    snowRidges.frustumCulled = false;
    snowRidges.castShadow = false;
    snowRidges.receiveShadow = true;
    snowRidges.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(snowRidges, 'displaced snow ridges paired with compressed grooves');
    root.add(snowRidges);

    const rippleMaterial = applyInstanceFadeToAlpha(new THREE.MeshStandardMaterial({
      color: 0xb8_c5c8,
      roughness: 0.24,
      metalness: 0,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
      side: THREE.FrontSide
    }));
    const ripples = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.72, 0.88, mobile ? 20 : 32),
      rippleMaterial,
      rippleCapacity
    );
    ripples.name = 'Neon.SurfaceWeather.PuddleRipples';
    ripples.frustumCulled = false;
    ripples.renderOrder = 5;
    ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(ripples, 'exact-contact puddle ripple pool');
    root.add(ripples);

    const wakeMaterial = applyInstanceFadeToAlpha(new THREE.MeshStandardMaterial({
      color: 0xd4_dfe1,
      roughness: 0.52,
      metalness: 0,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
      side: THREE.FrontSide
    }));
    const waterWakes = new THREE.InstancedMesh(
      createWaterWakeGeometry(THREE),
      wakeMaterial,
      wakeCapacity
    );
    waterWakes.name = 'Neon.SurfaceWeather.WaterWakes';
    waterWakes.frustumCulled = false;
    waterWakes.renderOrder = 5;
    waterWakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markEffect(waterWakes, 'swept-contact V-shaped water wakes');
    root.add(waterWakes);

    const waterSpray = createParticlePool(THREE, root, particleCapacity, 'water', mobile);
    const snowPowder = createParticlePool(THREE, root, particleCapacity, 'powder', mobile);
    markEffect(waterSpray.object, 'ship water spray fixed particle pool');
    markEffect(snowPowder.object, 'ship snow powder fixed particle pool');

    const surfaceResponse = { water: 0, snow: 0, slush: 0, dust: 0 };
    const contactResponse = resetSurfaceContactResponse(contactTarget || {});
    const diagnostics = Object.seal({
      visualOnly: false,
      gameplayWriteAuthority: SURFACE_FORCE_CONTRACT.gameplayWriteAuthority,
      forceAuthority: SURFACE_FORCE_CONTRACT.authority,
      contactModel: SURFACE_FORCE_CONTRACT.contactModel,
      clock: 'pausable-weather-motion-time',
      layout: 'distance-bucketed-world-route',
      surfacePreviewPolicy: SURFACE_LAYOUT_CONTRACT.policy,
      surfacePreviewSlotSpacingM: slotSpacingM,
      surfacePreviewBehindM: SURFACE_LAYOUT_CONTRACT.retainBehindM,
      surfacePreviewAheadM: mobile
        ? SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.mobile
        : SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewM.desktop,
      surfacePreviewSecondsAtFairSpeed: mobile
        ? SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewSecondsAtFairSpeed.mobile
        : SURFACE_LAYOUT_CONTRACT.minimumForwardPreviewSecondsAtFairSpeed.desktop,
      surfacePreviewUnavailableSlotCount: 0,
      accumulationSmoothed: true,
      groundedInteractionOnly: false,
      maximumDownwashClearanceM: SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM,
      shipFootprintHalfWidthM: footprintHalfWidthM,
      shipFootprintHalfLengthM: footprintHalfLengthM,
      standingWaterExposure: STANDING_WATER_CONTRACT.exposure,
      coveredStandingWaterSuppression: true,
      puddleMaterialModel: STANDING_WATER_CONTRACT.materialModel,
      puddleLightingAuthority: STANDING_WATER_CONTRACT.lightingAuthority,
      puddleProjectedShadowMode: STANDING_WATER_CONTRACT.projectedShadowMode,
      puddleReceivesProjectedShadow: puddles.receiveShadow,
      puddleCastsProjectedShadow: puddles.castShadow,
      puddleOpticsModel: PUDDLE_OPTICS_CONTRACT.model,
      puddleShorelineAlphaMode: PUDDLE_OPTICS_CONTRACT.shorelineAlphaMode,
      puddleMicroNormalMode: PUDDLE_OPTICS_CONTRACT.microNormalMode,
      puddleAdditionalDrawGroups: PUDDLE_OPTICS_CONTRACT.additionalDrawGroups,
      puddleLightingEnvironmentIntensity: 1,
      puddleEnvironmentReflectionIntensity: puddleMaterial.envMapIntensity,
      puddleDirectSunIntensity: 0,
      puddleOpacity: 0,
      puddleNormalStrength: puddleMaterial.normalScale.x,
      snowAccumulationExposure: SNOW_ACCUMULATION_CONTRACT.exposure,
      coveredSnowAccumulationSuppression: true,
      puddleCapacity: slotCapacity,
      puddleVisibleCount: 0,
      puddleExposedSlotCount: 0,
      puddleCoveredSlotCount: 0,
      coveredPuddleVisibleCount: 0,
      playerStandingWaterAllowed: true,
      playerTunnelKind: null,
      coveredWaterInteractionViolationCount: 0,
      waterSprayVisible: false,
      waterSprayMode: WATER_LOCAL_SPRAY_CONTRACT.mode,
      waterLocalJetCount: 0,
      waterGrazingNoSprayCount: 0,
      waterSprayParticleEmissionCount: 0,
      waterMaximumParticlesPerContact: WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerContact,
      snowPatchCapacity: slotCapacity,
      snowPatchVisibleCount: 0,
      snowPatchExposedSlotCount: 0,
      snowPatchCoveredSlotCount: 0,
      coveredSnowPatchVisibleCount: 0,
      snowBankCapacity,
      snowBankLayoutMode: SHOULDER_SNOW_INTERACTION_CONTRACT.layoutMode,
      snowBankUsesSampledRoadHalf: true,
      snowBankAdditionalDrawGroups:
        SHOULDER_SNOW_INTERACTION_CONTRACT.additionalDrawGroups,
      snowBankVisibleCount: 0,
      snowBankExposedSlotCount: 0,
      snowBankCoveredSlotCount: 0,
      coveredSnowBankVisibleCount: 0,
      snowBankContactThisUpdate: false,
      snowBankInteractionCount: 0,
      disturbedSnowBankCellCount: 0,
      snowBankPowderBurstCount: 0,
      snowTrackCapacity: trackCapacity,
      snowTrackVisibleCount: 0,
      snowRidgeCapacity: trackCapacity,
      snowRidgeVisibleCount: 0,
      snowTrackCoveredRejectCount: 0,
      playerSnowAccumulationAllowed: true,
      coveredSnowInteractionViolationCount: 0,
      rippleCapacity,
      activeRippleCount: 0,
      ambientRainRippleCount: 0,
      waterWakeCapacity: wakeCapacity,
      activeWaterWakeCount: 0,
      waterParticleCapacity: particleCapacity,
      activeWaterParticleCount: 0,
      snowParticleCapacity: particleCapacity,
      activeSnowParticleCount: 0,
      snowPowderVisible: false,
      snowPowderContactRequired: true,
      snowPowderContactThisUpdate: false,
      snowPowderMaximumLifeSeconds: SNOW_POWDER_CONTACT_CONTRACT.particleLifeSeconds.maximum,
      snowPowderLastEmissionMotionTime: -1,
      liveSnowParticleCount: 0,
      surfaceDrawGroupBudget: mobile
        ? SURFACE_RENDER_CONTRACT.mobileSurfaceDrawGroupBudget
        : SURFACE_RENDER_CONTRACT.desktopSurfaceDrawGroupBudget,
      surfaceDrawGroups: 0,
      surfaceDrawGroupBudgetExceeded: false,
      surfaceRenderPolicy: mobile ? 'mobile-bounded' : 'full-detail',
      snowSheetShadowMode: SURFACE_RENDER_CONTRACT.snowSheetShadowMode,
      waterAccumulation: 0,
      snowAccumulation: 0,
      slushAccumulation: 0,
      dustAccumulation: 0,
      surfaceCellCount: 0,
      disturbedWaterCellCount: 0,
      disturbedSnowCellCount: 0,
      currentContactKind: 'dry',
      currentContactIntensity: 0,
      currentWaterContact: 0,
      currentSnowContact: 0,
      currentSlushContact: 0,
      currentContactCoverage: 0,
      currentPressureFactor: 0,
      currentLongitudinalDecelerationMps2: 0,
      currentLateralAccelerationMultiplier: 1,
      currentLateralDragMultiplier: 1,
      currentLateralSpeedMultiplier: 1,
      contactEventSerial: 0,
      contactSampleCount: 0,
      sweptWaterHitCount: 0,
      sweptSnowHitCount: 0,
      sweptSnowBankHitCount: 0,
      landingSurfaceBurstCount: 0,
      layoutRebuildCount: 0,
      puddleCrossingCount: 0,
      waterBurstCount: 0,
      snowPatchCrossingCount: 0,
      snowPowderBurstCount: 0,
      snowPowderBurstLimitCount: 0,
      compressedTrackCount: 0,
      updateCount: 0
    });

    const slotEntries = Array.from({ length: slotCapacity }, () => ({
      bucket: 0,
      station: 0,
      lateral: 0,
      radius: 0,
      halfLength: 0,
      absoluteX: 0,
      absoluteY: 0,
      absoluteZ: 0,
      standingWaterAllowed: true,
      tunnelKind: null,
      waterCell: null,
      waterBaseHalfWidth: 0,
      waterBaseHalfLength: 0,
      waterQuaternion: new THREE.Quaternion(),
      waterRotationRad: 0,
      waterTint: 1,
      waterUpX: 0,
      waterUpY: 1,
      waterUpZ: 0,
      snowLateral: 0,
      snowHalfWidth: 0,
      snowHalfLength: 0,
      snowAccumulationAllowed: true,
      snowCell: null,
      snowBaseHalfWidth: 0,
      snowBaseHalfLength: 0,
      snowAbsoluteX: 0,
      snowAbsoluteY: 0,
      snowAbsoluteZ: 0,
      snowQuaternion: new THREE.Quaternion(),
      snowUpX: 0,
      snowUpY: 1,
      snowUpZ: 0
    }));
    const snowBankEntries = Array.from({ length: snowBankCapacity }, (_, index) => ({
      bucket: 0,
      station: 0,
      side: index % SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket === 0 ? -1 : 1,
      lateral: 0,
      halfWidth: 0,
      halfLength: 0,
      baseHeight: 0,
      snowAccumulationAllowed: false,
      cell: null,
      absoluteX: 0,
      absoluteY: 0,
      absoluteZ: 0,
      quaternion: new THREE.Quaternion(),
      rightX: 1,
      rightY: 0,
      rightZ: 0,
      upX: 0,
      upY: 1,
      upZ: 0
    }));
    const trackEntries = Array.from({ length: trackCapacity }, () => ({
      active: false,
      station: 0,
      lateral: 0,
      bornAt: 0,
      life: 0,
      strength: 0,
      side: 0,
      x: 0,
      y: 0,
      z: 0,
      ridgeX: 0,
      ridgeY: 0,
      ridgeZ: 0,
      quaternion: new THREE.Quaternion()
    }));
    const rippleEntries = Array.from({ length: rippleCapacity }, () => ({
      active: false,
      age: 0,
      life: 0,
      strength: 0,
      radiusStart: 0,
      radiusGrowth: 0,
      x: 0,
      y: 0,
      z: 0,
      quaternion: new THREE.Quaternion()
    }));
    const wakeEntries = Array.from({ length: wakeCapacity }, () => ({
      active: false,
      age: 0,
      life: 0,
      strength: 0,
      width: 0,
      length: 0,
      x: 0,
      y: 0,
      z: 0,
      quaternion: new THREE.Quaternion()
    }));
    const surfaceCells = new Map();
    let trackCursor = 0;
    let rippleCursor = 0;
    let wakeCursor = 0;
    let lastMotionTime = null;
    let lastDistance = Number(state.distance) || 0;
    let lastLateral = Number(state.lateral) || 0;
    let lastLandingCount = Number(state.landingCount) || 0;
    let lastContactKind = 'dry';
    let interactionSerial = 0;
    let lastAmbientRainRippleTick = -1;
    let lastLayoutKey = '';

    const origin = new THREE.Vector3();
    const frameScratch = {};
    const playerFrameScratch = {};
    const right = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const up = new THREE.Vector3();
    const localSurfaceNormal = new THREE.Vector3(0, 0, 1);
    const ambientRippleOffset = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const localSurfaceRotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const instanceColor = new THREE.Color();
    const surfaceTargetScratch = { water: 0, snow: 0, slush: 0, dust: 0 };
    const surfaceCellWeatherScratch = { snowAccumulation: 0 };
    const sweepIntervalScratch = { hit: false, entryT: null, exitT: null };
    const contactCoverageScratch = { waterCoverage: 0, snowCoverage: 0, slushCoverage: 0 };
    const normalizedSweepScratch = {};
    const forceContactScratch = {};
    const forceMotionScratch = {};
    const localWaterSampleScratch = {};
    const localWaterResponseScratch = {};
    const shoulderSnowInteractionScratch = {};
    const shoulderSnowCellInteractionScratch = { snowBankEnergy: 0, signedSlip: 0 };
    const contactPosition = new THREE.Vector3();
    const exactContactScratch = {
      frame: frameScratch,
      station: 0,
      lateral: 0,
      position: contactPosition
    };
    const puddleLightingScratch = {
      environmentIntensity: 1,
      sunIntensity: 0,
      envMapIntensity: puddleMaterial.envMapIntensity,
      specularIntensity: puddleMaterial.specularIntensity,
      roughness: puddleMaterial.roughness,
      opacity: 0,
      normalStrength: puddleMaterial.normalScale.x
    };

    function resolveFrameBasis(frame) {
      const yaw = Number(frame.yaw) || 0;
      tangent.set(
        Number.isFinite(frame.tangentX) ? frame.tangentX : -Math.sin(yaw),
        Number.isFinite(frame.tangentY) ? frame.tangentY : Number(frame.grade) || 0,
        Number.isFinite(frame.tangentZ) ? frame.tangentZ : -Math.cos(yaw)
      ).normalize();
      right.set(
        Number.isFinite(frame.rightX) ? frame.rightX : -tangent.z,
        Number.isFinite(frame.rightY) ? frame.rightY : 0,
        Number.isFinite(frame.rightZ) ? frame.rightZ : tangent.x
      ).normalize();
      if (Number.isFinite(frame.upX) && Number.isFinite(frame.upY) && Number.isFinite(frame.upZ)) {
        up.set(frame.upX, frame.upY, frame.upZ).normalize();
      } else {
        up.crossVectors(right, tangent).normalize();
      }
      basis.makeBasis(right, tangent, up);
      quaternion.setFromRotationMatrix(basis);
      return quaternion;
    }

    function frameAbsolutePosition(frame, lift, target = position) {
      const baseY = Number.isFinite(frame.y) ? frame.y : Number(frame.surfaceHeight) || 0;
      return target.set(
        (Number(frame.x) || 0) + origin.x + up.x * lift,
        baseY + origin.y + up.y * lift,
        (Number(frame.z) || 0) + origin.z + up.z * lift
      );
    }

    function surfaceCellKey(frame, bucket, kind, lateral) {
      const edgeId = frame?.edgeId || state.pathPlan?.id || 'linear-track';
      const quantizedStation = Number.isFinite(frame?.edgeS)
        ? Math.round(frame.edgeS / slotSpacingM)
        : bucket;
      const quantizedLateral = Math.round((Number(lateral) || 0) * 10);
      return `${edgeId}:${quantizedStation}:${quantizedLateral}:${kind}`;
    }

    /** Acquire one route-stable deformation cell; visual slot churn never resets its physical-looking state. */
    function touchSurfaceCell(frame, bucket, kind, lateral) {
      const key = surfaceCellKey(frame, bucket, kind, lateral);
      let cell = surfaceCells.get(key);
      if (!cell) {
        cell = {
          key,
          phase: hashUnit(bucket, kind === 'water' ? 0x7d_31 : 0x2b_93) * Math.PI * 2,
          waterDisplacement: 0,
          waterWaveEnergy: 0,
          snowCompaction: 0,
          snowCleared: 0,
          snowBermLeft: 0,
          snowBermRight: 0,
          snowBankCompaction: 0,
          snowBankDisplacement: 0,
          lastWaterSpatialBucket: null,
          lastSnowSpatialBucket: null,
          lastSnowBankSpatialBucket: null,
          lastSeenLayout: diagnostics.layoutRebuildCount
        };
        surfaceCells.set(key, cell);
      }
      cell.lastSeenLayout = diagnostics.layoutRebuildCount;
      return cell;
    }

    function publishSurfaceCellDiagnostics() {
      let disturbedWaterCellCount = 0;
      let disturbedSnowCellCount = 0;
      let disturbedSnowBankCellCount = 0;
      for (const cell of surfaceCells.values()) {
        if (cell.waterDisplacement > 0.002 || cell.waterWaveEnergy > 0.002) {
          disturbedWaterCellCount++;
        }
        if (cell.snowCompaction > 0.002
          || cell.snowCleared > 0.002
          || cell.snowBermLeft > 0.002
          || cell.snowBermRight > 0.002
          || cell.snowBankCompaction > 0.002
          || cell.snowBankDisplacement > 0.002) {
          disturbedSnowCellCount++;
        }
        if (cell.snowBankCompaction > 0.002 || cell.snowBankDisplacement > 0.002) {
          disturbedSnowBankCellCount++;
        }
      }
      diagnostics.surfaceCellCount = surfaceCells.size;
      diagnostics.disturbedWaterCellCount = disturbedWaterCellCount;
      diagnostics.disturbedSnowCellCount = disturbedSnowCellCount;
      diagnostics.disturbedSnowBankCellCount = disturbedSnowBankCellCount;
    }

    function stepSurfaceCells(deltaSeconds) {
      surfaceCellWeatherScratch.snowAccumulation = surfaceResponse.snow;
      for (const cell of surfaceCells.values()) {
        stepSurfaceCell(cell, surfaceCellWeatherScratch, deltaSeconds, cell);
      }
      publishSurfaceCellDiagnostics();
    }

    /** Recompose dynamic puddle and snow matrices from persistent cell state every weather frame. */
    function renderSurfaceDeformation(motionTime) {
      const textureDrift = motionTime * (isReducedMotionEnabled() ? 0.003 : 0.010);
      puddleSurfaceTextures.normalMap.offset.set(
        (textureDrift * 0.73) % 1,
        (textureDrift * 0.41) % 1
      );
      for (let index = 0; index < slotCapacity; index++) {
        const entry = slotEntries[index];
        const waterCell = entry.waterCell;
        if (entry.standingWaterAllowed && waterCell) {
          const oscillation = (
            Math.sin(motionTime * 2.3 + waterCell.phase) * 0.62
            + Math.sin(motionTime * 3.7 + waterCell.phase * 1.61) * 0.38
          ) * waterCell.waterWaveEnergy;
          // The pool stays registered to the road. Pressure reads as a millimetre ripple plus outward spread,
          // never as the former centimetre-scale whole-sheet breathing motion.
          const waterNormalOffset = oscillation * PUDDLE_OPTICS_CONTRACT.maximumNormalMotionM;
          const displacementSpread = waterCell.waterDisplacement * 0.025;
          position.set(
            entry.absoluteX + entry.waterUpX * waterNormalOffset,
            entry.absoluteY + entry.waterUpY * waterNormalOffset,
            entry.absoluteZ + entry.waterUpZ * waterNormalOffset
          );
          scale.set(
            entry.waterBaseHalfWidth
              * (1 + displacementSpread + Math.abs(oscillation) * 0.006),
            entry.waterBaseHalfLength
              * (1 + waterCell.waterDisplacement * 0.018 + Math.abs(oscillation) * 0.004),
            1
          );
          matrix.compose(position, entry.waterQuaternion, scale);
          const tint = entry.waterTint;
          puddles.setColorAt(index, instanceColor.setRGB(
            tint * (0.94 + waterCell.waterWaveEnergy * 0.025),
            tint * (0.97 + waterCell.waterWaveEnergy * 0.018),
            tint
          ));
        } else {
          matrix.compose(
            position.set(0, -10_000, 0),
            quaternion.identity(),
            scale.set(0, 0, 0)
          );
          puddles.setColorAt(index, instanceColor.setRGB(0, 0, 0));
        }
        puddles.setMatrixAt(index, matrix);

        const snowCell = entry.snowCell;
        if (entry.snowAccumulationAllowed && snowCell) {
          const snowNormalOffset = -snowCell.snowCompaction
            * SNOW_ACCUMULATION_CONTRACT.sheetMaximumCompactionDepressionM;
          position.set(
            entry.snowAbsoluteX + entry.snowUpX * snowNormalOffset,
            entry.snowAbsoluteY + entry.snowUpY * snowNormalOffset,
            entry.snowAbsoluteZ + entry.snowUpZ * snowNormalOffset
          );
          scale.set(
            entry.snowBaseHalfWidth * (1 - snowCell.snowCleared * 0.14),
            entry.snowBaseHalfLength * (1 - snowCell.snowCleared * 0.08),
            1
          );
          matrix.compose(position, entry.snowQuaternion, scale);
          // The sheet stays snow-white; only the actual twin groove material carries the deeper compacted tone.
          const compactShade = 1 - snowCell.snowCompaction * 0.14;
          snowPatches.setColorAt(index, instanceColor.setRGB(
            compactShade * 0.97,
            compactShade * 0.99,
            compactShade
          ));
        } else {
          matrix.compose(
            position.set(0, -10_000, 0),
            quaternion.identity(),
            scale.set(0, 0, 0)
          );
          snowPatches.setColorAt(index, instanceColor.setRGB(0, 0, 0));
        }
        snowPatches.setMatrixAt(index, matrix);
      }
      for (let index = 0; index < snowBankCapacity; index++) {
        const entry = snowBankEntries[index];
        const cell = entry.cell;
        if (entry.snowAccumulationAllowed && cell) {
          const compaction = clamp01(cell.snowBankCompaction);
          const displacement = clamp01(cell.snowBankDisplacement);
          const heightLossRatio =
            compaction * SHOULDER_SNOW_INTERACTION_CONTRACT.maximumHeightLossRatio;
          const outwardOffsetM =
            entry.side
              * displacement
              * SHOULDER_SNOW_INTERACTION_CONTRACT.maximumOutwardDisplacementM;
          position.set(
            entry.absoluteX
              + entry.rightX * outwardOffsetM,
            entry.absoluteY
              + entry.rightY * outwardOffsetM,
            entry.absoluteZ
              + entry.rightZ * outwardOffsetM
          );
          scale.set(
            entry.halfWidth * (1 + displacement * 0.24),
            entry.halfLength * (1 + displacement * 0.10),
            entry.baseHeight * (1 - heightLossRatio)
          );
          matrix.compose(position, entry.quaternion, scale);
          const compactShade = 1 - compaction * 0.18;
          snowBanks.setColorAt(index, instanceColor.setRGB(
            compactShade * 0.95,
            compactShade * 0.98,
            compactShade
          ));
        } else {
          matrix.compose(
            position.set(0, -10_000, 0),
            quaternion.identity(),
            scale.set(0, 0, 0)
          );
          snowBanks.setColorAt(index, instanceColor.setRGB(0, 0, 0));
        }
        snowBanks.setMatrixAt(index, matrix);
      }
      puddles.instanceMatrix.needsUpdate = true;
      snowPatches.instanceMatrix.needsUpdate = true;
      snowBanks.instanceMatrix.needsUpdate = true;
      if (puddles.instanceColor) puddles.instanceColor.needsUpdate = true;
      if (snowPatches.instanceColor) snowPatches.instanceColor.needsUpdate = true;
      if (snowBanks.instanceColor) snowBanks.instanceColor.needsUpdate = true;
    }

    function updateSurfaceLayout(lightingState) {
      const currentDistance = Number(state.distance) || 0;
      const firstBucket = Math.floor(
        (currentDistance - SURFACE_LAYOUT_CONTRACT.retainBehindM) / slotSpacingM
      );
      const water = surfaceResponse.water;
      const snow = surfaceResponse.snow;
      const puddleScaleIn = 0.36 + water * 0.64;
      const snowScaleIn = 0.18 + snow * 0.82;
      const layoutKey = `${firstBucket}:${state.pathPlan?.id || ''}:${state.pathPlan?.version || 0}:${Math.round(water * 20)}:${Math.round(snow * 20)}`;
      if (layoutKey !== lastLayoutKey) {
        lastLayoutKey = layoutKey;
        diagnostics.layoutRebuildCount++;
        let exposedPuddleSlotCount = 0;
        let coveredPuddleSlotCount = 0;
        let exposedSnowPatchSlotCount = 0;
        let coveredSnowPatchSlotCount = 0;
        let exposedSnowBankSlotCount = 0;
        let coveredSnowBankSlotCount = 0;
        let unavailableRouteSlotCount = 0;
        let nearestStationOffsetM = Infinity;
        let farthestStationOffsetM = -Infinity;
        for (let index = 0; index < slotCapacity; index++) {
          const bucket = firstBucket + index;
          const station = bucket * slotSpacingM
            + hashUnit(bucket, 0x11_7a) * SURFACE_LAYOUT_CONTRACT.stationJitterM;
          const stationOffsetM = station - currentDistance;
          const centerBias = Math.abs(bucket % 4) === 1;
          const lateralRange = centerBias ? 1.8 : 6.2;
          let puddleLateral = (hashUnit(bucket, 0x29_3d) * 2 - 1) * lateralRange;
          const puddleRadius = (1.0 + hashUnit(bucket, 0x62_81) * 1.25) * puddleScaleIn;
          const puddleHalfLength = (1.45 + hashUnit(bucket, 0x44_09) * 1.7) * puddleScaleIn;
          const snowLateral = (hashUnit(bucket, 0x73_1f) * 2 - 1) * 6.7;
          const entry = slotEntries[index];
          entry.bucket = bucket;
          entry.station = station;
          // Negative run distance has no authored road. Hiding those two startup buckets prevents signed
          // PathPlan clamping from stacking multiple puddles and snow banks on the launch edge.
          if (station < 0) {
            entry.standingWaterAllowed = false;
            entry.waterCell = null;
            entry.snowAccumulationAllowed = false;
            entry.snowCell = null;
            for (
              let sideIndex = 0;
              sideIndex < SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket;
              sideIndex++
            ) {
              const bankEntry = snowBankEntries[
                index * SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket + sideIndex
              ];
              bankEntry.snowAccumulationAllowed = false;
              bankEntry.cell = null;
            }
            unavailableRouteSlotCount++;
            continue;
          }
          nearestStationOffsetM = Math.min(nearestStationOffsetM, stationOffsetM);
          farthestStationOffsetM = Math.max(farthestStationOffsetM, stationOffsetM);

          let waterFrame = sampleSignedFrame(
            stationOffsetM,
            puddleLateral,
            frameScratch
          );
          const sampledRoadHalf = Number(waterFrame.roadHalf);
          if (Number.isFinite(sampledRoadHalf)) {
            const safeLateral = Math.max(0.35, sampledRoadHalf - puddleRadius - 0.25);
            const clampedLateral = Math.max(-safeLateral, Math.min(safeLateral, puddleLateral));
            if (clampedLateral !== puddleLateral) {
              puddleLateral = clampedLateral;
              waterFrame = sampleSignedFrame(stationOffsetM, puddleLateral, frameScratch);
            }
          }
          entry.standingWaterAllowed = allowsStandingWater(waterFrame);
          entry.tunnelKind = waterFrame.tunnelKind || null;
          entry.lateral = puddleLateral;
          entry.radius = puddleRadius;
          entry.halfLength = puddleHalfLength;
          entry.waterBaseHalfWidth = puddleRadius;
          entry.waterBaseHalfLength = puddleHalfLength;
          entry.waterCell = touchSurfaceCell(waterFrame, bucket, 'water', puddleLateral);
          resolveFrameBasis(waterFrame);
          entry.waterUpX = up.x;
          entry.waterUpY = up.y;
          entry.waterUpZ = up.z;
          entry.waterRotationRad = hashUnit(bucket, 0x4f_29) * Math.PI * 2;
          entry.waterTint = 0.92 + hashUnit(bucket, 0x73_85) * 0.08;
          localSurfaceRotation.setFromAxisAngle(localSurfaceNormal, entry.waterRotationRad);
          entry.waterQuaternion.copy(quaternion).multiply(localSurfaceRotation);
          frameAbsolutePosition(waterFrame, PUDDLE_OPTICS_CONTRACT.visualSurfaceLiftM);
          entry.absoluteX = position.x;
          entry.absoluteY = position.y;
          entry.absoluteZ = position.z;
          if (entry.standingWaterAllowed) exposedPuddleSlotCount++;
          else coveredPuddleSlotCount++;

          const snowFrame = sampleSignedFrame(
            stationOffsetM,
            snowLateral,
            frameScratch
          );
          entry.snowAccumulationAllowed = allowsSnowAccumulation(snowFrame);
          entry.snowLateral = snowLateral;
          entry.snowHalfWidth = (1.4 + hashUnit(bucket, 0x55_b1) * 2.2) * snowScaleIn;
          entry.snowHalfLength = (2.2 + hashUnit(bucket, 0x91_2d) * 3.8) * snowScaleIn;
          entry.snowBaseHalfWidth = entry.snowHalfWidth;
          entry.snowBaseHalfLength = entry.snowHalfLength;
          entry.snowCell = touchSurfaceCell(snowFrame, bucket, 'snow', snowLateral);
          resolveFrameBasis(snowFrame);
          entry.snowUpX = up.x;
          entry.snowUpY = up.y;
          entry.snowUpZ = up.z;
          frameAbsolutePosition(snowFrame, SNOW_ACCUMULATION_CONTRACT.sheetVisualSurfaceLiftM);
          entry.snowAbsoluteX = position.x;
          entry.snowAbsoluteY = position.y;
          entry.snowAbsoluteZ = position.z;
          entry.snowQuaternion.copy(quaternion);
          if (entry.snowAccumulationAllowed) exposedSnowPatchSlotCount++;
          else coveredSnowPatchSlotCount++;

          const sampledSnowRoadHalf = Number(snowFrame.roadHalf);
          const bankRoadHalf = Number.isFinite(sampledSnowRoadHalf) && sampledSnowRoadHalf > 1
            ? sampledSnowRoadHalf
            : defaultRoadHalfM;
          for (
            let sideIndex = 0;
            sideIndex < SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket;
            sideIndex++
          ) {
            const bankIndex =
              index * SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket + sideIndex;
            const bankEntry = snowBankEntries[bankIndex];
            const bankSide = sideIndex === 0 ? -1 : 1;
            const bankHashKey = bucket * SHOULDER_SNOW_INTERACTION_CONTRACT.banksPerRouteBucket
              + sideIndex;
            const bankHalfWidth = 0.78 + hashUnit(bankHashKey, 0x28_a3) * 0.92;
            const bankHalfLength = 1.5 + hashUnit(bankHashKey, 0x38_d1) * 2.3;
            const bankBaseHeight =
              (0.16 + snow * 0.46) * (0.72 + hashUnit(bankHashKey, 0x9a_51) * 0.5);
            const bankLateral = bankSide * Math.max(
              0.8,
              bankRoadHalf - SHOULDER_SNOW_INTERACTION_CONTRACT.roadEdgeInsetM
            );
            const bankFrame = sampleSignedFrame(
              stationOffsetM,
              bankLateral,
              frameScratch
            );
            bankEntry.bucket = bucket;
            bankEntry.station = station;
            bankEntry.side = bankSide;
            bankEntry.lateral = bankLateral;
            bankEntry.halfWidth = bankHalfWidth;
            bankEntry.halfLength = bankHalfLength;
            bankEntry.baseHeight = bankBaseHeight;
            bankEntry.snowAccumulationAllowed = allowsSnowAccumulation(bankFrame);
            bankEntry.cell = touchSurfaceCell(
              bankFrame,
              bucket,
              'snow-bank',
              bankLateral
            );
            resolveFrameBasis(bankFrame);
            bankEntry.rightX = right.x;
            bankEntry.rightY = right.y;
            bankEntry.rightZ = right.z;
            bankEntry.upX = up.x;
            bankEntry.upY = up.y;
            bankEntry.upZ = up.z;
            frameAbsolutePosition(bankFrame, SNOW_ACCUMULATION_CONTRACT.bankVisualSurfaceLiftM);
            bankEntry.absoluteX = position.x;
            bankEntry.absoluteY = position.y;
            bankEntry.absoluteZ = position.z;
            bankEntry.quaternion.copy(quaternion);
            if (bankEntry.snowAccumulationAllowed) exposedSnowBankSlotCount++;
            else coveredSnowBankSlotCount++;
          }
        }
        diagnostics.puddleExposedSlotCount = exposedPuddleSlotCount;
        diagnostics.puddleCoveredSlotCount = coveredPuddleSlotCount;
        diagnostics.snowPatchExposedSlotCount = exposedSnowPatchSlotCount;
        diagnostics.snowPatchCoveredSlotCount = coveredSnowPatchSlotCount;
        diagnostics.snowBankExposedSlotCount = exposedSnowBankSlotCount;
        diagnostics.snowBankCoveredSlotCount = coveredSnowBankSlotCount;
        diagnostics.surfacePreviewUnavailableSlotCount = unavailableRouteSlotCount;
        diagnostics.surfacePreviewBehindM = Number.isFinite(nearestStationOffsetM)
          ? Math.max(0, -nearestStationOffsetM)
          : 0;
        diagnostics.surfacePreviewAheadM = Number.isFinite(farthestStationOffsetM)
          ? Math.max(0, farthestStationOffsetM)
          : 0;
        diagnostics.surfacePreviewSecondsAtFairSpeed =
          diagnostics.surfacePreviewAheadM / SURFACE_LAYOUT_CONTRACT.fairSpeedMps;
        diagnostics.coveredPuddleVisibleCount = 0;
        diagnostics.coveredSnowPatchVisibleCount = 0;
        diagnostics.coveredSnowBankVisibleCount = 0;
        // A small retention window preserves a just-passed deformation while bounding graph-route memory.
        for (const [key, cell] of surfaceCells) {
          if (diagnostics.layoutRebuildCount - cell.lastSeenLayout > 4) surfaceCells.delete(key);
        }
      }
      resolvePuddleLightingResponse(lightingState, water, puddleLightingScratch);
      // Water never self-lights; highlights and projected shadows remain owned by the shared real-light rig.
      puddleMaterial.emissiveIntensity = 0;
      puddleMaterial.opacity = puddleLightingScratch.opacity;
      puddleMaterial.roughness = puddleLightingScratch.roughness;
      puddleMaterial.envMapIntensity = puddleLightingScratch.envMapIntensity;
      puddleMaterial.specularIntensity = puddleLightingScratch.specularIntensity;
      puddleMaterial.normalScale.set(
        puddleLightingScratch.normalStrength,
        puddleLightingScratch.normalStrength * 0.82
      );
      rippleMaterial.opacity = clamp(
        0.10 + puddleLightingScratch.environmentIntensity * 0.045,
        0.10,
        0.18
      );
      wakeMaterial.opacity = clamp(
        0.16 + puddleLightingScratch.environmentIntensity * 0.055,
        0.16,
        0.27
      );
      diagnostics.puddleLightingEnvironmentIntensity = puddleLightingScratch.environmentIntensity;
      diagnostics.puddleEnvironmentReflectionIntensity = puddleLightingScratch.envMapIntensity;
      diagnostics.puddleDirectSunIntensity = puddleLightingScratch.sunIntensity;
      diagnostics.puddleOpacity = puddleMaterial.opacity;
      diagnostics.puddleNormalStrength = puddleMaterial.normalScale.x;
      const snowIndirectFill = clamp(
        0.30
          + puddleLightingScratch.environmentIntensity * 0.06
          + (puddleLightingScratch.sunIntensity
            / (puddleLightingScratch.sunIntensity + 4)) * 0.04,
        0.30,
        0.40
      );
      snowMaterial.emissiveIntensity = snowIndirectFill;
      snowBankMaterial.emissiveIntensity = Math.max(0.27, snowIndirectFill - 0.03);
      // Opaque high-albedo sheets and banks express accumulation through footprint/depth, not dark alpha layering.
      snowMaterial.opacity = 1;
      snowBankMaterial.opacity = 1;
      puddles.visible = water > 0.003 && diagnostics.puddleExposedSlotCount > 0;
      snowPatches.visible = snow > 0.025 && diagnostics.snowPatchExposedSlotCount > 0;
      snowBanks.visible = snow > 0.04 && diagnostics.snowBankExposedSlotCount > 0;
      diagnostics.puddleVisibleCount = puddles.visible ? diagnostics.puddleExposedSlotCount : 0;
      diagnostics.snowPatchVisibleCount = snowPatches.visible ? diagnostics.snowPatchExposedSlotCount : 0;
      diagnostics.snowBankVisibleCount = snowBanks.visible ? diagnostics.snowBankExposedSlotCount : 0;
    }

    function emitParticles(
      pool,
      count,
      frame,
      absoluteContact,
      intensity = 1,
      speedMps = 0,
      lateralSpeedMps = 0,
      preferredSide = 0
    ) {
      const requestedCount = Math.max(0, Math.floor(Number(count) || 0));
      if (requestedCount === 0) return 0;
      resolveFrameBasis(frame);
      const reducedMotion = Boolean(isReducedMotionEnabled());
      const emitCount = Math.max(
        1,
        reducedMotion ? Math.ceil(requestedCount * 0.45) : requestedCount
      );
      const speedFactor = clamp01(speedMps / 180);
      const signedSlip = Math.max(-1, Math.min(1, lateralSpeedMps / 22));
      const preferredJetSide = Math.sign(Number(preferredSide) || 0);
      for (let index = 0; index < emitCount; index++) {
        const particleIndex = pool.cursor;
        pool.cursor = (pool.cursor + 1) % pool.capacity;
        const offset = particleIndex * 3;
        const serial = interactionSerial * 131 + index + (preferredJetSide + 1) * 47;
        const side = preferredJetSide || (hashUnit(serial, 0x19_7f) < 0.5 ? -1 : 1);
        const spread = pool.kind === 'water'
          ? 0.08 + hashUnit(serial, 0x4a_2d) * (0.24 + intensity * 0.38)
          : 0.38 + hashUnit(serial, 0x4a_2d) * (1.10 + intensity * 1.15);
        const behind = pool.kind === 'water'
          ? 0.10 + hashUnit(serial, 0x61_b3) * (0.42 + speedFactor * 0.92)
          : 0.28 + hashUnit(serial, 0x61_b3) * (0.9 + speedFactor * 2.1);
        const lateralOffset = side * spread;
        const tangentOffset = -behind;
        const normalOffset = 0.08;
        pool.positions[offset] = absoluteContact.x
          + right.x * lateralOffset
          + tangent.x * tangentOffset
          + up.x * normalOffset;
        pool.positions[offset + 1] = absoluteContact.y
          + right.y * lateralOffset
          + tangent.y * tangentOffset
          + up.y * normalOffset;
        pool.positions[offset + 2] = absoluteContact.z
          + right.z * lateralOffset
          + tangent.z * tangentOffset
          + up.z * normalOffset;
        if (pool.kind === 'water') {
          const outward = 3.2 + intensity * 5.8 + hashUnit(serial, 0x81_29) * 5.4;
          const lift = 2.8 + intensity * 4.4 + hashUnit(serial, 0x2f_61) * 4.2;
          const outwardVelocity = side * outward + signedSlip * 2.6;
          const tangentVelocity = -(2.0 + speedFactor * 7.4);
          pool.velocities[offset] = right.x * outwardVelocity
            + tangent.x * tangentVelocity
            + up.x * lift;
          pool.velocities[offset + 1] = right.y * outwardVelocity
            + tangent.y * tangentVelocity
            + up.y * lift;
          pool.velocities[offset + 2] = right.z * outwardVelocity
            + tangent.z * tangentVelocity
            + up.z * lift;
          pool.lives[particleIndex] = 0.42 + hashUnit(serial, 0x37_e5) * 0.42;
        } else {
          const outward = 0.7 + intensity * 1.8 + hashUnit(serial, 0x71_25) * 2.3;
          const lift = 1.1 + intensity * 1.9 + hashUnit(serial, 0x67_13) * 2.5;
          const outwardVelocity = side * outward + signedSlip * 1.8;
          const tangentVelocity = -(1.8 + speedFactor * 6.2);
          pool.velocities[offset] = right.x * outwardVelocity
            + tangent.x * tangentVelocity
            + up.x * lift;
          pool.velocities[offset + 1] = right.y * outwardVelocity
            + tangent.y * tangentVelocity
            + up.y * lift;
          pool.velocities[offset + 2] = right.z * outwardVelocity
            + tangent.z * tangentVelocity
            + up.z * lift;
          const powderLife = SNOW_POWDER_CONTACT_CONTRACT.particleLifeSeconds;
          pool.lives[particleIndex] = powderLife.minimum
            + hashUnit(serial, 0x97_41) * (powderLife.maximum - powderLife.minimum);
        }
        pool.ages[particleIndex] = 0.000_1;
      }
      pool.geometry.attributes.position.needsUpdate = true;
      return emitCount;
    }

    function emitRipple(frame, absoluteContact, intensity, landingEnergy = 0) {
      const ripple = rippleEntries[rippleCursor];
      rippleCursor = (rippleCursor + 1) % rippleCapacity;
      resolveFrameBasis(frame);
      ripple.active = true;
      ripple.age = 0.000_1;
      ripple.life = 0.72
        + intensity * 0.30
        + landingEnergy * 0.24
        + hashUnit(interactionSerial, 0x33_91) * 0.28;
      ripple.strength = clamp01(0.48 + intensity * 0.52);
      ripple.radiusStart = 0.65;
      ripple.radiusGrowth = 3.4;
      ripple.x = absoluteContact.x + up.x * 0.018;
      ripple.y = absoluteContact.y + up.y * 0.018;
      ripple.z = absoluteContact.z + up.z * 0.018;
      ripple.quaternion.copy(quaternion);
    }

    /**
     * Reuse the contact-ripple pool for sparse deterministic raindrop rings. This closes the visible rain-to-water
     * loop without allocating per-frame geometry, adding a draw group, or creating gameplay contact.
     */
    function emitAmbientRainRipple(motionTime) {
      const rain = clamp01(state.weather?.rain);
      const water = surfaceResponse.water;
      if (!puddles.visible
        || rain <= 0.03
        || water < PUDDLE_OPTICS_CONTRACT.ambientRainRippleMinimumWater) return false;
      const cadence = mobile
        ? PUDDLE_OPTICS_CONTRACT.ambientRainRippleCadenceSeconds.mobile
        : PUDDLE_OPTICS_CONTRACT.ambientRainRippleCadenceSeconds.desktop;
      const tick = Math.floor(motionTime / cadence);
      if (tick === lastAmbientRainRippleTick) return false;
      lastAmbientRainRippleTick = tick;
      const candidateCount = Math.min(slotCapacity, mobile ? 10 : 14);
      const startIndex = hashUint(tick, 0x35_6b) % candidateCount;
      for (let candidateOffset = 0; candidateOffset < candidateCount; candidateOffset++) {
        const entry = slotEntries[(startIndex + candidateOffset) % candidateCount];
        if (!entry.standingWaterAllowed || !entry.waterCell) continue;
        const radial = Math.sqrt(hashUnit(tick, 0x62_9d)) * 0.72;
        const angle = hashUnit(tick, 0x91_47) * Math.PI * 2;
        ambientRippleOffset.set(
          Math.cos(angle) * entry.waterBaseHalfWidth * radial,
          Math.sin(angle) * entry.waterBaseHalfLength * radial,
          0
        ).applyQuaternion(entry.waterQuaternion);
        const ripple = rippleEntries[rippleCursor];
        rippleCursor = (rippleCursor + 1) % rippleCapacity;
        ripple.active = true;
        ripple.age = 0.000_1;
        ripple.life = 0.42 + hashUnit(tick, 0x42_71) * 0.22;
        ripple.strength = (0.13 + rain * 0.09) * (0.72 + water * 0.28);
        ripple.radiusStart = 0.08;
        ripple.radiusGrowth = 0.56 + water * 0.26;
        ripple.x = entry.absoluteX + ambientRippleOffset.x + entry.waterUpX * 0.016;
        ripple.y = entry.absoluteY + ambientRippleOffset.y + entry.waterUpY * 0.016;
        ripple.z = entry.absoluteZ + ambientRippleOffset.z + entry.waterUpZ * 0.016;
        ripple.quaternion.copy(entry.waterQuaternion);
        diagnostics.ambientRainRippleCount++;
        return true;
      }
      return false;
    }

    function emitWaterWake(frame, absoluteContact, intensity, speedMps) {
      const wake = wakeEntries[wakeCursor];
      wakeCursor = (wakeCursor + 1) % wakeCapacity;
      resolveFrameBasis(frame);
      wake.active = true;
      wake.age = 0.000_1;
      wake.strength = clamp01(intensity);
      wake.life = WATER_WAKE_CONTRACT.lifeSeconds.minimum
        + clamp01(speedMps / 210)
          * (WATER_WAKE_CONTRACT.lifeSeconds.maximum - WATER_WAKE_CONTRACT.lifeSeconds.minimum);
      wake.width = 1.2 + wake.strength * 1.9;
      wake.length = 1.3 + clamp01(speedMps / 180) * 3.8;
      wake.x = absoluteContact.x + up.x * 0.020;
      wake.y = absoluteContact.y + up.y * 0.020;
      wake.z = absoluteContact.z + up.z * 0.020;
      wake.quaternion.copy(quaternion);
    }

    function recordSnowTrack(station, lateral, motionTime, strength, side) {
      const frame = sampleSignedFrame(station - Number(state.distance), lateral, frameScratch);
      if (!allowsSnowAccumulation(frame)) {
        diagnostics.snowTrackCoveredRejectCount++;
        return false;
      }
      const entry = trackEntries[trackCursor];
      trackCursor = (trackCursor + 1) % trackCapacity;
      resolveFrameBasis(frame);
      frameAbsolutePosition(frame, 0.158);
      entry.active = true;
      entry.station = station;
      entry.lateral = lateral;
      entry.bornAt = motionTime;
      entry.life = lerpNumber(36, 18, surfaceResponse.snow);
      entry.strength = clamp01(strength);
      entry.side = side;
      entry.x = position.x;
      entry.y = position.y;
      entry.z = position.z;
      const ridgeOffset = side * (0.30 + entry.strength * 0.18);
      entry.ridgeX = position.x + right.x * ridgeOffset + up.x * 0.055;
      entry.ridgeY = position.y + right.y * ridgeOffset + up.y * 0.055;
      entry.ridgeZ = position.z + right.z * ridgeOffset + up.z * 0.055;
      entry.quaternion.copy(quaternion);
      diagnostics.compressedTrackCount++;
      return true;
    }

    function sampleEntryInterval(sweep, entry, kind, out = sweepIntervalScratch) {
      const snow = kind === 'snow';
      const snowBank = kind === 'snow-bank';
      return sweptEllipseInterval(
        sweep.previousDistance - entry.station,
        sweep.previousLateral - (snow ? entry.snowLateral : entry.lateral),
        sweep.currentDistance - entry.station,
        sweep.currentLateral - (snow ? entry.snowLateral : entry.lateral),
        snow ? entry.snowHalfLength : entry.halfLength,
        snow ? entry.snowHalfWidth : snowBank ? entry.halfWidth : entry.radius,
        footprintHalfLengthM,
        footprintHalfWidthM,
        out
      );
    }

    function normalizedSweep(contactFrame = {}, out = normalizedSweepScratch) {
      const currentDistance = Number.isFinite(contactFrame.currentDistance)
        ? contactFrame.currentDistance
        : Number(state.distance) || 0;
      const previousDistance = Number.isFinite(contactFrame.previousDistance)
        ? contactFrame.previousDistance
        : Number.isFinite(state.previousDistance) ? state.previousDistance : lastDistance;
      const currentLateral = Number.isFinite(contactFrame.currentLateral)
        ? contactFrame.currentLateral
        : Number(state.lateral) || 0;
      const previousLateral = Number.isFinite(contactFrame.previousLateral)
        ? contactFrame.previousLateral
        : Number.isFinite(state.previousLateral) ? state.previousLateral : lastLateral;
      out.previousDistance = previousDistance;
      out.currentDistance = currentDistance;
      out.previousLateral = previousLateral;
      out.currentLateral = currentLateral;
      out.speedMps = Math.max(0, Number(contactFrame.speedMps ?? state.speed) || 0);
      out.lateralSpeedMps = Number(contactFrame.lateralSpeedMps ?? state.lateralVelocity) || 0;
      out.grounded = contactFrame.grounded ?? state.grounded;
      const explicitClearance = Number(contactFrame.clearanceM);
      out.clearanceM = Math.max(
        0,
        Number.isFinite(explicitClearance)
          ? explicitClearance
          : (Number(state.altitude) || 0) - (Number(state.contactHeight) || 0)
      );
      out.enabled = contactFrame.enabled
        ?? Boolean(state.running && !state.paused && !state.gameOver);
      out.footprintHalfWidthM = footprintHalfWidthM;
      out.footprintHalfLengthM = footprintHalfLengthM;
      out.snowAccumulation = surfaceResponse.snow;
      out.landingEnergy = 0;
      return out;
    }

    /**
     * Sample route-local puddles and snow with the shared continuous solver.
     * This function only fills coefficients; it never mutates speed, steering, route, collision, or ship pose.
     */
    function sampleGameplayContact(contactFrame = {}, out = contactResponse) {
      const sweep = normalizedSweep(contactFrame);
      contactCoverageScratch.waterCoverage = 0;
      contactCoverageScratch.snowCoverage = 0;
      contactCoverageScratch.slushCoverage = 0;
      diagnostics.sweptWaterHitCount = 0;
      diagnostics.sweptSnowHitCount = 0;
      diagnostics.sweptSnowBankHitCount = 0;
      if (sweep.enabled) {
        if (surfaceResponse.water > 0.01) {
          for (const entry of slotEntries) {
            if (!entry.standingWaterAllowed) continue;
            const interval = sampleEntryInterval(sweep, entry, 'water');
            if (!interval.hit) continue;
            const coverage = clamp01((interval.exitT ?? 0) - (interval.entryT ?? 0));
            contactCoverageScratch.waterCoverage = 1
              - (1 - contactCoverageScratch.waterCoverage) * (1 - coverage);
            diagnostics.sweptWaterHitCount++;
          }
        }
        if (surfaceResponse.snow > SNOW_POWDER_CONTACT_CONTRACT.minimumSnowAccumulation) {
          for (const entry of slotEntries) {
            if (!entry.snowAccumulationAllowed) continue;
            const interval = sampleEntryInterval(sweep, entry, 'snow');
            if (!interval.hit) continue;
            const coverage = clamp01((interval.exitT ?? 0) - (interval.entryT ?? 0));
            contactCoverageScratch.snowCoverage = 1
              - (1 - contactCoverageScratch.snowCoverage) * (1 - coverage);
            diagnostics.sweptSnowHitCount++;
          }
          for (const entry of snowBankEntries) {
            if (!entry.snowAccumulationAllowed) continue;
            const interval = sampleEntryInterval(sweep, entry, 'snow-bank');
            if (!interval.hit) continue;
            const coverage = clamp01((interval.exitT ?? 0) - (interval.entryT ?? 0));
            contactCoverageScratch.snowCoverage = 1
              - (1 - contactCoverageScratch.snowCoverage) * (1 - coverage);
            diagnostics.sweptSnowHitCount++;
            diagnostics.sweptSnowBankHitCount++;
          }
        }
      }
      contactCoverageScratch.slushCoverage = Math.max(
        contactCoverageScratch.waterCoverage,
        contactCoverageScratch.snowCoverage
      );
      forceContactScratch.waterCoverage = contactCoverageScratch.waterCoverage;
      forceContactScratch.snowCoverage = contactCoverageScratch.snowCoverage;
      forceContactScratch.slushCoverage = contactCoverageScratch.slushCoverage;
      forceContactScratch.waterAccumulation = surfaceResponse.water;
      forceContactScratch.snowAccumulation = surfaceResponse.snow;
      forceContactScratch.slushAccumulation = surfaceResponse.slush;
      forceMotionScratch.grounded = sweep.grounded;
      forceMotionScratch.openSky =
        diagnostics.sweptWaterHitCount + diagnostics.sweptSnowHitCount > 0;
      forceMotionScratch.clearanceM = sweep.clearanceM;
      forceMotionScratch.speedMps = sweep.speedMps;
      forceMotionScratch.lateralSpeedMps = sweep.lateralSpeedMps;
      forceMotionScratch.distanceM = sweep.currentDistance;
      resolveSurfaceForceResponse(forceContactScratch, forceMotionScratch, out);
      if (out.kind !== lastContactKind) {
        lastContactKind = out.kind;
        diagnostics.contactEventSerial++;
      }
      diagnostics.currentContactKind = out.kind;
      diagnostics.currentContactIntensity = out.contactIntensity;
      diagnostics.currentWaterContact = out.waterContact;
      diagnostics.currentSnowContact = out.snowContact;
      diagnostics.currentSlushContact = out.slushContact;
      diagnostics.currentContactCoverage = out.contactCoverage;
      diagnostics.currentPressureFactor = out.pressureFactor;
      diagnostics.currentLongitudinalDecelerationMps2 = out.longitudinalDecelerationMps2;
      diagnostics.currentLateralAccelerationMultiplier = out.lateralAccelerationMultiplier;
      diagnostics.currentLateralDragMultiplier = out.lateralDragMultiplier;
      diagnostics.currentLateralSpeedMultiplier = out.lateralSpeedMultiplier;
      diagnostics.contactSampleCount++;
      return out;
    }

    function sampleRouteContact(station, lateral) {
      const frame = sampleSignedFrame(
        station - Number(state.distance),
        lateral,
        frameScratch
      );
      resolveFrameBasis(frame);
      frameAbsolutePosition(frame, 0.16, contactPosition);
      exactContactScratch.frame = frame;
      exactContactScratch.station = station;
      exactContactScratch.lateral = lateral;
      return exactContactScratch;
    }

    function sampleExactContact(sweep, progress, lateralOffset = 0) {
      const station = lerpNumber(sweep.previousDistance, sweep.currentDistance, progress);
      const lateral = lerpNumber(sweep.previousLateral, sweep.currentLateral, progress) + lateralOffset;
      return sampleRouteContact(station, lateral);
    }

    /** Return how deeply one authored tail-downwash point sits inside the actual puddle ellipse. */
    function waterTailImmersion(entry, station, lateral, tail) {
      const along = (station - (Number(tail.z) || 0) - entry.station)
        / Math.max(0.000_001, entry.halfLength);
      const across = (lateral + (Number(tail.x) || 0) - entry.lateral)
        / Math.max(0.000_001, entry.radius);
      return clamp01(1 - Math.sqrt(along * along + across * across));
    }

    function emitSurfaceInteractions(motionTime, contactFrame = {}) {
      const sweep = normalizedSweep(contactFrame);
      diagnostics.snowPowderContactThisUpdate = false;
      diagnostics.snowBankContactThisUpdate = false;
      if (!sweep.enabled
        || (sweep.grounded === false
          && sweep.clearanceM > SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM)) {
        lastDistance = sweep.currentDistance;
        lastLateral = sweep.currentLateral;
        return;
      }
      const speedFactor = clamp01(sweep.speedMps / 180);
      const pressureFactor = sweep.grounded === false
        ? clamp01(1 - sweep.clearanceM / SURFACE_FORCE_CONTRACT.maximumDownwashClearanceM)
        : 1;
      const landingCount = Number(state.landingCount) || 0;
      const landedThisUpdate = landingCount > lastLandingCount;
      const landingEnergy = landedThisUpdate
        ? clamp01(Math.abs(Number(state.lastLanding?.impactVy) || 0) / 16)
        : 0;
      sweep.landingEnergy = landingEnergy;
      let landingBurstEmitted = false;

      if (surfaceResponse.water > 0.02) {
        for (const entry of slotEntries) {
          if (!entry.standingWaterAllowed) continue;
          const interval = sampleEntryInterval(sweep, entry, 'water');
          if (!interval.hit) continue;
          const entryT = clamp01(interval.entryT);
          const exitT = clamp01(interval.exitT);
          const intervalCoverage = Math.max(0, exitT - entryT);
          const representativeProgress = (entryT + exitT) * 0.5;
          const representativeStation = lerpNumber(
            sweep.previousDistance,
            sweep.currentDistance,
            representativeProgress
          );
          const representativeLateral = lerpNumber(
            sweep.previousLateral,
            sweep.currentLateral,
            representativeProgress
          );
          localWaterSampleScratch.intervalCoverage = intervalCoverage;
          localWaterSampleScratch.longitudinalPenetration = clamp01(
            1 - Math.abs(representativeStation - entry.station)
              / (entry.halfLength + footprintHalfLengthM)
          );
          localWaterSampleScratch.lateralPenetration = clamp01(
            1 - Math.abs(representativeLateral - entry.lateral)
              / (entry.radius + footprintHalfWidthM)
          );
          localWaterSampleScratch.accumulation = surfaceResponse.water;
          localWaterSampleScratch.pressureFactor = pressureFactor;
          localWaterSampleScratch.speedFactor = speedFactor;
          localWaterSampleScratch.landingEnergy = landingEnergy;
          resolveLocalWaterResponse(localWaterSampleScratch, localWaterResponseScratch);
          if (localWaterResponseScratch.deformationEnergy
            < WATER_LOCAL_SPRAY_CONTRACT.minimumDeformationEnergy) {
            diagnostics.waterGrazingNoSprayCount++;
            continue;
          }
          disturbSurfaceCell(entry.waterCell, {
            waterEnergy: localWaterResponseScratch.deformationEnergy,
            signedSlip: sweep.lateralSpeedMps / 22
          }, entry.waterCell);
          diagnostics.puddleCrossingCount++;
          const contactTravel = Math.abs(sweep.currentDistance - sweep.previousDistance)
            * intervalCoverage;
          const segmentCount = Math.max(1, Math.min(
            WATER_WAKE_CONTRACT.maximumSegmentsPerPatchPerUpdate,
            Math.ceil(contactTravel / WATER_WAKE_CONTRACT.spatialStepM)
          ));
          for (let segment = 0; segment < segmentCount; segment++) {
            const progress = lerpNumber(
              entryT,
              exitT,
              (segment + 0.5) / segmentCount
            );
            const exact = sampleExactContact(sweep, progress);
            const exactStation = exact.station;
            const exactLateral = exact.lateral;
            localWaterSampleScratch.longitudinalPenetration = clamp01(
              1 - Math.abs(exactStation - entry.station)
                / (entry.halfLength + footprintHalfLengthM)
            );
            localWaterSampleScratch.lateralPenetration = clamp01(
              1 - Math.abs(exactLateral - entry.lateral)
                / (entry.radius + footprintHalfWidthM)
            );
            resolveLocalWaterResponse(localWaterSampleScratch, localWaterResponseScratch);
            if (localWaterResponseScratch.deformationEnergy
              < WATER_LOCAL_SPRAY_CONTRACT.minimumDeformationEnergy) {
              diagnostics.waterGrazingNoSprayCount++;
              continue;
            }
            const spatialBucket = Math.floor(exact.station / WATER_WAKE_CONTRACT.spatialStepM);
            if (entry.waterCell.lastWaterSpatialBucket === spatialBucket && !landedThisUpdate) continue;
            entry.waterCell.lastWaterSpatialBucket = spatialBucket;
            interactionSerial++;
            let emittedEffect = false;
            if (localWaterResponseScratch.emitRipple) {
              emitRipple(
                exact.frame,
                exact.position,
                localWaterResponseScratch.rippleEnergy,
                landingEnergy
              );
              emittedEffect = true;
            }
            if (localWaterResponseScratch.emitWake) {
              emitWaterWake(
                exact.frame,
                exact.position,
                localWaterResponseScratch.wakeEnergy,
                sweep.speedMps
              );
              emittedEffect = true;
            }
            if (localWaterResponseScratch.emitSpray) {
              const leftImmersion = waterTailImmersion(
                entry,
                exactStation,
                exactLateral,
                leftTailDownwash
              );
              const rightImmersion = waterTailImmersion(
                entry,
                exactStation,
                exactLateral,
                rightTailDownwash
              );
              const immersionSum = leftImmersion + rightImmersion;
              const totalParticleCount = localWaterResponseScratch.particleCount;
              let localJetCount = 0;
              let emittedParticleCount = 0;
              if (immersionSum > 0.000_001) {
                let leftParticleCount = Math.round(
                  totalParticleCount * leftImmersion / immersionSum
                );
                leftParticleCount = Math.min(
                  WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerJet,
                  leftParticleCount
                );
                let rightParticleCount = Math.min(
                  WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerJet,
                  totalParticleCount - leftParticleCount
                );
                if (leftImmersion <= 0.000_001) leftParticleCount = 0;
                if (rightImmersion <= 0.000_001) rightParticleCount = 0;
                if (leftParticleCount > 0) {
                  const leftContact = sampleRouteContact(
                    exactStation - (Number(leftTailDownwash.z) || 0),
                    exactLateral + (Number(leftTailDownwash.x) || 0)
                  );
                  emittedParticleCount += emitParticles(
                    waterSpray,
                    leftParticleCount,
                    leftContact.frame,
                    leftContact.position,
                    localWaterResponseScratch.sprayEnergy * (0.4 + leftImmersion * 0.6),
                    sweep.speedMps,
                    sweep.lateralSpeedMps,
                    -1
                  );
                  localJetCount++;
                }
                if (rightParticleCount > 0) {
                  const rightContact = sampleRouteContact(
                    exactStation - (Number(rightTailDownwash.z) || 0),
                    exactLateral + (Number(rightTailDownwash.x) || 0)
                  );
                  emittedParticleCount += emitParticles(
                    waterSpray,
                    rightParticleCount,
                    rightContact.frame,
                    rightContact.position,
                    localWaterResponseScratch.sprayEnergy * (0.4 + rightImmersion * 0.6),
                    sweep.speedMps,
                    sweep.lateralSpeedMps,
                    1
                  );
                  localJetCount++;
                }
              } else {
                const contactLateralOffset = Math.max(
                  -footprintHalfWidthM,
                  Math.min(footprintHalfWidthM, entry.lateral - exactLateral)
                );
                const edgeContact = sampleRouteContact(
                  exactStation,
                  exactLateral + contactLateralOffset
                );
                emittedParticleCount += emitParticles(
                  waterSpray,
                  Math.min(
                    WATER_LOCAL_SPRAY_CONTRACT.maximumParticlesPerJet,
                    totalParticleCount
                  ),
                  edgeContact.frame,
                  edgeContact.position,
                  localWaterResponseScratch.sprayEnergy,
                  sweep.speedMps,
                  sweep.lateralSpeedMps,
                  Math.sign(contactLateralOffset || sweep.lateralSpeedMps)
                );
                localJetCount++;
              }
              diagnostics.waterLocalJetCount += localJetCount;
              diagnostics.waterSprayParticleEmissionCount += emittedParticleCount;
              emittedEffect = emittedEffect || emittedParticleCount > 0;
            } else {
              diagnostics.waterGrazingNoSprayCount++;
            }
            if (emittedEffect) {
              diagnostics.waterBurstCount++;
              if (landedThisUpdate) landingBurstEmitted = true;
            }
          }
        }
      }

      if (surfaceResponse.snow > SNOW_POWDER_CONTACT_CONTRACT.minimumSnowAccumulation) {
        let snowPowderBurstsThisUpdate = 0;
        for (const entry of snowBankEntries) {
          resolveShoulderSnowInteraction(
            sweep,
            entry,
            sweptEllipseInterval,
            shoulderSnowInteractionScratch
          );
          if (!shoulderSnowInteractionScratch.interactive) continue;
          shoulderSnowCellInteractionScratch.snowBankEnergy =
            shoulderSnowInteractionScratch.deformationEnergy;
          shoulderSnowCellInteractionScratch.signedSlip = sweep.lateralSpeedMps / 22;
          disturbSurfaceCell(
            entry.cell,
            shoulderSnowCellInteractionScratch,
            entry.cell
          );
          diagnostics.snowPowderContactThisUpdate = true;
          diagnostics.snowBankContactThisUpdate = true;
          diagnostics.snowBankInteractionCount++;
          const contactTravel = Math.abs(sweep.currentDistance - sweep.previousDistance)
            * Math.max(
              shoulderSnowInteractionScratch.intervalCoverage,
              0.012_5
            );
          const segmentCount = Math.max(1, Math.min(
            SNOW_POWDER_CONTACT_CONTRACT.maximumBurstsPerUpdate,
            Math.ceil(contactTravel / 3)
          ));
          for (let segment = 0; segment < segmentCount; segment++) {
            const progress = lerpNumber(
              shoulderSnowInteractionScratch.entryT,
              shoulderSnowInteractionScratch.exitT,
              (segment + 0.5) / segmentCount
            );
            const station = lerpNumber(
              sweep.previousDistance,
              sweep.currentDistance,
              progress
            );
            const craftLateral = lerpNumber(
              sweep.previousLateral,
              sweep.currentLateral,
              progress
            );
            const contactLateral = craftLateral + Math.max(
              -footprintHalfWidthM,
              Math.min(footprintHalfWidthM, entry.lateral - craftLateral)
            );
            const spatialBucket = Math.floor(station / 3);
            if (entry.cell.lastSnowBankSpatialBucket === spatialBucket
              && !landedThisUpdate) continue;
            entry.cell.lastSnowBankSpatialBucket = spatialBucket;
            const exact = sampleRouteContact(station, contactLateral);
            interactionSerial++;
            if (shoulderSnowInteractionScratch.particleCount > 0) {
              if (snowPowderBurstsThisUpdate
                < SNOW_POWDER_CONTACT_CONTRACT.maximumBurstsPerUpdate) {
                emitParticles(
                  snowPowder,
                  shoulderSnowInteractionScratch.particleCount,
                  exact.frame,
                  exact.position,
                  shoulderSnowInteractionScratch.deformationEnergy,
                  sweep.speedMps,
                  sweep.lateralSpeedMps,
                  entry.side
                );
                snowPowderBurstsThisUpdate++;
                diagnostics.snowPowderBurstCount++;
                diagnostics.snowBankPowderBurstCount++;
                diagnostics.snowPowderLastEmissionMotionTime = motionTime;
                if (landedThisUpdate) landingBurstEmitted = true;
              } else {
                diagnostics.snowPowderBurstLimitCount++;
              }
            }
            recordSnowTrack(
              station,
              contactLateral,
              motionTime,
              shoulderSnowInteractionScratch.deformationEnergy,
              entry.side
            );
          }
        }
        for (const entry of slotEntries) {
          if (!entry.snowAccumulationAllowed) continue;
          const interval = sampleEntryInterval(sweep, entry, 'snow');
          if (!interval.hit) continue;
          const snowIntensity = clamp01(
            surfaceResponse.snow
              * pressureFactor
              * (0.36 + speedFactor * 0.64 + landingEnergy * 0.38)
          );
          disturbSurfaceCell(entry.snowCell, {
            snowEnergy: snowIntensity,
            signedSlip: sweep.lateralSpeedMps / 22
          }, entry.snowCell);
          diagnostics.snowPowderContactThisUpdate = true;
          diagnostics.snowPatchCrossingCount++;
          const contactTravel = Math.abs(sweep.currentDistance - sweep.previousDistance)
            * Math.max(0, interval.exitT - interval.entryT);
          const segmentCount = Math.max(1, Math.min(
            SNOW_POWDER_CONTACT_CONTRACT.maximumBurstsPerUpdate,
            Math.ceil(contactTravel / 3)
          ));
          for (let segment = 0; segment < segmentCount; segment++) {
            const progress = lerpNumber(
              interval.entryT,
              interval.exitT,
              (segment + 0.5) / segmentCount
            );
            const exact = sampleExactContact(sweep, progress);
            const spatialBucket = Math.floor(exact.station / 3);
            if (entry.snowCell.lastSnowSpatialBucket === spatialBucket && !landedThisUpdate) continue;
            entry.snowCell.lastSnowSpatialBucket = spatialBucket;
            interactionSerial++;
            if (snowPowderBurstsThisUpdate
              < SNOW_POWDER_CONTACT_CONTRACT.maximumBurstsPerUpdate) {
              const particleCount = Math.min(
                SNOW_POWDER_CONTACT_CONTRACT.maximumParticlesPerBurst,
                Math.round(
                  SNOW_POWDER_CONTACT_CONTRACT.baseParticlesPerBurst
                    + snowIntensity
                      * (SNOW_POWDER_CONTACT_CONTRACT.maximumParticlesPerBurst
                        - SNOW_POWDER_CONTACT_CONTRACT.baseParticlesPerBurst)
                    + landingEnergy * 4
                )
              );
              emitParticles(
                snowPowder,
                particleCount,
                exact.frame,
                exact.position,
                snowIntensity,
                sweep.speedMps,
                sweep.lateralSpeedMps
              );
              snowPowderBurstsThisUpdate++;
              diagnostics.snowPowderBurstCount++;
              diagnostics.snowPowderLastEmissionMotionTime = motionTime;
              if (landedThisUpdate) landingBurstEmitted = true;
            } else {
              diagnostics.snowPowderBurstLimitCount++;
            }
            recordSnowTrack(
              exact.station - (Number(leftTailDownwash.z) || 0),
              exact.lateral + (Number(leftTailDownwash.x) || 0),
              motionTime,
              snowIntensity,
              -1
            );
            recordSnowTrack(
              exact.station - (Number(rightTailDownwash.z) || 0),
              exact.lateral + (Number(rightTailDownwash.x) || 0),
              motionTime,
              snowIntensity,
              1
            );
          }
        }
      }
      if (landingBurstEmitted) diagnostics.landingSurfaceBurstCount++;
      lastLandingCount = landingCount;
      lastDistance = sweep.currentDistance;
      lastLateral = sweep.currentLateral;
    }

    function updateParticlePool(pool, deltaSeconds, strength, lifetimeDeltaSeconds = deltaSeconds) {
      let activeCount = 0;
      const gravity = pool.kind === 'water' ? 15.5 : 2.2;
      const ageStep = Math.max(0, Number(lifetimeDeltaSeconds) || 0);
      for (let index = 0; index < pool.capacity; index++) {
        if (pool.ages[index] <= 0) continue;
        // Life consumes the full pausable-clock delta; only displacement stays bounded after a long frame.
        pool.ages[index] += ageStep;
        const offset = index * 3;
        if (pool.ages[index] >= pool.lives[index]) {
          pool.ages[index] = 0;
          pool.positions[offset] = -10_000;
          pool.positions[offset + 1] = -10_000;
          pool.positions[offset + 2] = -10_000;
          continue;
        }
        pool.velocities[offset + 1] -= gravity * deltaSeconds;
        pool.positions[offset] += pool.velocities[offset] * deltaSeconds;
        pool.positions[offset + 1] += pool.velocities[offset + 1] * deltaSeconds;
        pool.positions[offset + 2] += pool.velocities[offset + 2] * deltaSeconds;
        if (pool.kind === 'powder') {
          const drag = Math.exp(-deltaSeconds * 1.8);
          pool.velocities[offset] *= drag;
          pool.velocities[offset + 2] *= drag;
        }
        activeCount++;
      }
      pool.activeCount = activeCount;
      pool.object.visible = activeCount > 0 && strength > 0.003;
      pool.material.opacity = clamp(strength * 0.72, 0, 0.90);
      pool.geometry.attributes.position.needsUpdate = true;
      return pool.object.visible ? activeCount : 0;
    }

    function updateRipples(deltaSeconds) {
      let visibleCount = 0;
      for (let index = 0; index < rippleCapacity; index++) {
        const entry = rippleEntries[index];
        if (!entry.active) {
          scale.set(0, 0, 0);
          matrix.compose(position.set(0, -10_000, 0), quaternion.identity(), scale);
          ripples.setMatrixAt(index, matrix);
          ripples.setColorAt(index, instanceColor.setRGB(0, 0, 0));
          continue;
        }
        entry.age += deltaSeconds;
        const progress = clamp(entry.age / entry.life, 0, 1);
        if (progress >= 1) {
          entry.active = false;
          scale.set(0, 0, 0);
          matrix.compose(position.set(0, -10_000, 0), quaternion.identity(), scale);
          ripples.setMatrixAt(index, matrix);
          ripples.setColorAt(index, instanceColor.setRGB(0, 0, 0));
          continue;
        }
        const radius = entry.radiusStart + progress * entry.radiusGrowth;
        const brightness = (1 - progress) ** 1.8 * entry.strength;
        position.set(entry.x, entry.y, entry.z);
        scale.set(radius, radius, 1);
        matrix.compose(position, entry.quaternion, scale);
        ripples.setMatrixAt(index, matrix);
        ripples.setColorAt(index, instanceColor.setRGB(brightness, brightness, brightness));
        visibleCount++;
      }
      ripples.visible = visibleCount > 0;
      ripples.instanceMatrix.needsUpdate = true;
      if (ripples.instanceColor) ripples.instanceColor.needsUpdate = true;
      diagnostics.activeRippleCount = visibleCount;
    }

    function updateWaterWakes(deltaSeconds) {
      let visibleCount = 0;
      for (let index = 0; index < wakeCapacity; index++) {
        const entry = wakeEntries[index];
        if (!entry.active) {
          matrix.compose(
            position.set(0, -10_000, 0),
            quaternion.identity(),
            scale.set(0, 0, 0)
          );
          waterWakes.setMatrixAt(index, matrix);
          waterWakes.setColorAt(index, instanceColor.setRGB(0, 0, 0));
          continue;
        }
        entry.age += deltaSeconds;
        const progress = clamp(entry.age / entry.life, 0, 1);
        if (progress >= 1) {
          entry.active = false;
          matrix.compose(
            position.set(0, -10_000, 0),
            quaternion.identity(),
            scale.set(0, 0, 0)
          );
          waterWakes.setMatrixAt(index, matrix);
          waterWakes.setColorAt(index, instanceColor.setRGB(0, 0, 0));
          continue;
        }
        const fade = (1 - progress) ** 1.55 * entry.strength;
        position.set(entry.x, entry.y, entry.z);
        scale.set(
          entry.width * (1 + progress * 0.42),
          entry.length * (1 + progress * 0.24),
          1
        );
        matrix.compose(position, entry.quaternion, scale);
        waterWakes.setMatrixAt(index, matrix);
        waterWakes.setColorAt(index, instanceColor.setRGB(fade, fade, fade));
        visibleCount++;
      }
      waterWakes.visible = visibleCount > 0;
      waterWakes.instanceMatrix.needsUpdate = true;
      if (waterWakes.instanceColor) waterWakes.instanceColor.needsUpdate = true;
      diagnostics.activeWaterWakeCount = visibleCount;
    }

    function updateSnowTracks(motionTime) {
      let visibleCount = 0;
      for (let index = 0; index < trackCapacity; index++) {
        const entry = trackEntries[index];
        const age = motionTime - entry.bornAt;
        const distanceBehind = (Number(state.distance) || 0) - entry.station;
        if (!entry.active
          || age < 0
          || age > entry.life
          || distanceBehind < -3
          || distanceBehind > 145) {
          entry.active = false;
          scale.set(0, 0, 0);
          matrix.compose(position.set(0, -10_000, 0), quaternion.identity(), scale);
          snowTracks.setMatrixAt(index, matrix);
          snowRidges.setMatrixAt(index, matrix);
          snowTracks.setColorAt(index, instanceColor.setRGB(0, 0, 0));
          snowRidges.setColorAt(index, instanceColor.setRGB(0, 0, 0));
          continue;
        }
        const fade = clamp(1 - age / entry.life, 0, 1)
          * clamp(1 - distanceBehind / 145, 0, 1)
          * entry.strength;
        position.set(entry.x, entry.y, entry.z);
        scale.set(0.28 + entry.strength * 0.13, 1.65 + entry.strength * 0.75, 1);
        matrix.compose(position, entry.quaternion, scale);
        snowTracks.setMatrixAt(index, matrix);
        snowTracks.setColorAt(index, instanceColor.setRGB(
          0.56 + fade * 0.16,
          0.64 + fade * 0.17,
          0.70 + fade * 0.17
        ));
        position.set(entry.ridgeX, entry.ridgeY, entry.ridgeZ);
        scale.set(
          0.15 + entry.strength * 0.18,
          0.74 + entry.strength * 0.76,
          0.055 + entry.strength * 0.11
        );
        matrix.compose(position, entry.quaternion, scale);
        snowRidges.setMatrixAt(index, matrix);
        snowRidges.setColorAt(index, instanceColor.setRGB(
          0.90 + fade * 0.10,
          0.94 + fade * 0.06,
          1
        ));
        visibleCount++;
      }
      snowTracks.visible = visibleCount > 0 && surfaceResponse.snow > 0.02;
      // Mobile folds ridge contrast into the paired track edge instead of spending a tenth mixed-weather group.
      snowRidges.visible = !mobile && snowTracks.visible;
      snowTrackMaterial.opacity = surfaceResponse.snow * 0.54;
      snowRidgeMaterial.opacity = surfaceResponse.snow * 0.88;
      snowTracks.instanceMatrix.needsUpdate = true;
      snowRidges.instanceMatrix.needsUpdate = true;
      if (snowTracks.instanceColor) snowTracks.instanceColor.needsUpdate = true;
      if (snowRidges.instanceColor) snowRidges.instanceColor.needsUpdate = true;
      diagnostics.snowTrackVisibleCount = snowTracks.visible ? visibleCount : 0;
      diagnostics.snowRidgeVisibleCount = snowRidges.visible ? visibleCount : 0;
    }

    function resetTransientState(motionTime) {
      surfaceResponse.water = 0;
      surfaceResponse.snow = 0;
      surfaceResponse.slush = 0;
      surfaceResponse.dust = 0;
      lastMotionTime = motionTime;
      lastDistance = Number(state.distance) || 0;
      lastLateral = Number(state.lateral) || 0;
      lastLandingCount = Number(state.landingCount) || 0;
      lastContactKind = 'dry';
      lastAmbientRainRippleTick = -1;
      lastLayoutKey = '';
      surfaceCells.clear();
      resetSurfaceContactResponse(contactResponse);
      for (const entry of trackEntries) entry.active = false;
      for (const entry of rippleEntries) entry.active = false;
      for (const entry of wakeEntries) entry.active = false;
      for (const pool of [waterSpray, snowPowder]) {
        pool.positions.fill(-10_000);
        pool.velocities.fill(0);
        pool.ages.fill(0);
        pool.lives.fill(0);
        pool.cursor = 0;
        pool.activeCount = 0;
        pool.geometry.attributes.position.needsUpdate = true;
      }
    }

    /** Advance only from the shared pausable weather clock; ordinary render frames cannot move effects while paused. */
    function update(contactFrame = {}) {
      const originFrame = getWorldRenderOrigin(origin) || origin;
      // Graph frames retain absolute elevation; floating-origin cancellation applies only to horizontal world axes.
      origin.set(Number(originFrame.x) || 0, 0, Number(originFrame.z) || 0);
      root.position.set(-origin.x, 0, -origin.z);
      const motionTime = Number(state.weather?.motionTimeSeconds) || 0;
      if (lastMotionTime === null || motionTime < lastMotionTime) resetTransientState(motionTime);
      const elapsedSeconds = Math.max(0, motionTime - lastMotionTime);
      const deltaSeconds = clamp(elapsedSeconds, 0, 0.10);
      lastMotionTime = motionTime;
      resolveSurfaceTargets(state.weather, surfaceTargetScratch);
      stepSurfaceResponse(surfaceResponse, surfaceTargetScratch, elapsedSeconds);
      const lightingState = getLightingState() || {};
      updateSurfaceLayout(lightingState);
      stepSurfaceCells(elapsedSeconds);
      const playerFrame = sampleSignedFrame(
        0,
        Number(state.lateral) || 0,
        playerFrameScratch
      );
      diagnostics.playerStandingWaterAllowed = allowsStandingWater(playerFrame);
      diagnostics.playerSnowAccumulationAllowed = allowsSnowAccumulation(playerFrame);
      diagnostics.playerTunnelKind = playerFrame.tunnelKind || null;
      sampleGameplayContact(contactFrame, contactResponse);
      emitSurfaceInteractions(motionTime, contactFrame);
      publishSurfaceCellDiagnostics();
      renderSurfaceDeformation(motionTime);
      diagnostics.activeWaterParticleCount = updateParticlePool(
        waterSpray,
        deltaSeconds,
        surfaceResponse.water,
        elapsedSeconds
      );
      diagnostics.activeSnowParticleCount = updateParticlePool(
        snowPowder,
        deltaSeconds,
        surfaceResponse.snow,
        elapsedSeconds
      );
      if (mobile && waterSpray.object.visible && snowPowder.object.visible) {
        const mobilePrefersSnowParticles = contactResponse.kind !== 'water'
          && surfaceResponse.snow >= Math.max(0.06, surfaceResponse.water * 0.82);
        if (mobilePrefersSnowParticles) {
          waterSpray.object.visible = false;
          diagnostics.activeWaterParticleCount = 0;
        } else {
          snowPowder.object.visible = false;
          diagnostics.activeSnowParticleCount = 0;
        }
      }
      diagnostics.waterSprayVisible = waterSpray.object.visible;
      diagnostics.liveSnowParticleCount = snowPowder.activeCount;
      diagnostics.snowPowderVisible = snowPowder.object.visible;
      emitAmbientRainRipple(motionTime);
      updateRipples(elapsedSeconds);
      updateWaterWakes(elapsedSeconds);
      if (mobile && ripples.visible && waterWakes.visible) {
        // Impact rings communicate low-speed displacement; the continuous V wake communicates high-speed flow.
        // Keeping only the speed-appropriate layer preserves both regimes without exceeding the mobile budget.
        const mobilePrefersWake = Math.abs(Number(contactFrame.speedMps) || 0) >= 55;
        if (mobilePrefersWake) {
          ripples.visible = false;
          diagnostics.activeRippleCount = 0;
        } else {
          waterWakes.visible = false;
          diagnostics.activeWaterWakeCount = 0;
        }
      }
      updateSnowTracks(motionTime);
      diagnostics.surfaceDrawGroups = Number(puddles.visible)
        + Number(snowPatches.visible)
        + Number(snowBanks.visible)
        + Number(snowTracks.visible)
        + Number(snowRidges.visible)
        + Number(ripples.visible)
        + Number(waterWakes.visible)
        + Number(waterSpray.object.visible)
        + Number(snowPowder.object.visible);
      diagnostics.surfaceDrawGroupBudgetExceeded = diagnostics.surfaceDrawGroups
        > diagnostics.surfaceDrawGroupBudget;
      diagnostics.waterAccumulation = surfaceResponse.water;
      diagnostics.snowAccumulation = surfaceResponse.snow;
      diagnostics.slushAccumulation = surfaceResponse.slush;
      diagnostics.dustAccumulation = surfaceResponse.dust;
      diagnostics.updateCount++;
      return contactResponse;
    }

    /** Copy a bounded diagnostics snapshot without exposing mutable cells or pooled Three.js objects. */
    function getSnapshot(out = {}) {
      out.kind = contactResponse.kind;
      out.contactIntensity = contactResponse.contactIntensity;
      out.waterContact = contactResponse.waterContact;
      out.snowContact = contactResponse.snowContact;
      out.slushContact = contactResponse.slushContact;
      out.longitudinalDecelerationMps2 = contactResponse.longitudinalDecelerationMps2;
      out.lateralAccelerationMultiplier = contactResponse.lateralAccelerationMultiplier;
      out.lateralDragMultiplier = contactResponse.lateralDragMultiplier;
      out.lateralSpeedMultiplier = contactResponse.lateralSpeedMultiplier;
      out.pressureFactor = contactResponse.pressureFactor;
      out.surfaceCellCount = surfaceCells.size;
      out.activeWaterWakeCount = diagnostics.activeWaterWakeCount;
      out.activeRippleCount = diagnostics.activeRippleCount;
      out.ambientRainRippleCount = diagnostics.ambientRainRippleCount;
      out.activeWaterParticleCount = diagnostics.activeWaterParticleCount;
      out.waterSprayMode = diagnostics.waterSprayMode;
      out.waterLocalJetCount = diagnostics.waterLocalJetCount;
      out.waterGrazingNoSprayCount = diagnostics.waterGrazingNoSprayCount;
      out.waterSprayParticleEmissionCount = diagnostics.waterSprayParticleEmissionCount;
      out.activeSnowParticleCount = diagnostics.activeSnowParticleCount;
      out.snowBankContactThisUpdate = diagnostics.snowBankContactThisUpdate;
      out.snowBankInteractionCount = diagnostics.snowBankInteractionCount;
      out.disturbedSnowBankCellCount = diagnostics.disturbedSnowBankCellCount;
      out.snowBankPowderBurstCount = diagnostics.snowBankPowderBurstCount;
      out.snowTrackVisibleCount = diagnostics.snowTrackVisibleCount;
      out.snowRidgeVisibleCount = diagnostics.snowRidgeVisibleCount;
      out.surfaceDrawGroupBudget = diagnostics.surfaceDrawGroupBudget;
      out.surfaceDrawGroups = diagnostics.surfaceDrawGroups;
      out.surfaceDrawGroupBudgetExceeded = diagnostics.surfaceDrawGroupBudgetExceeded;
      out.surfacePreviewPolicy = diagnostics.surfacePreviewPolicy;
      out.surfacePreviewSlotSpacingM = diagnostics.surfacePreviewSlotSpacingM;
      out.surfacePreviewBehindM = diagnostics.surfacePreviewBehindM;
      out.surfacePreviewAheadM = diagnostics.surfacePreviewAheadM;
      out.surfacePreviewSecondsAtFairSpeed = diagnostics.surfacePreviewSecondsAtFairSpeed;
      out.surfacePreviewUnavailableSlotCount = diagnostics.surfacePreviewUnavailableSlotCount;
      out.puddleOpticsModel = diagnostics.puddleOpticsModel;
      out.puddleOpacity = diagnostics.puddleOpacity;
      out.puddleNormalStrength = diagnostics.puddleNormalStrength;
      out.contactEventSerial = diagnostics.contactEventSerial;
      return out;
    }

    return Object.freeze({
      update,
      sampleGameplayContact,
      getSnapshot,
      contactResponse,
      diagnostics,
      root,
      puddles,
      snowPatches,
      snowBanks,
      snowTracks,
      snowRidges,
      ripples,
      waterWakes
    });
  }

  return Object.freeze({
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
    create,
    disturbSurfaceCell,
    resetSurfaceContactResponse,
    resolvePuddleLightingResponse,
    resolveLocalWaterResponse,
    resolveShoulderSnowInteraction,
    resolveSurfaceForceResponse,
    resolveSurfaceTargets,
    stepSurfaceCell,
    stepSurfaceResponse
  });
})();
