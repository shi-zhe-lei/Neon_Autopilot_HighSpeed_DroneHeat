/*
 * Pure gameplay timing, collision, propulsion, and steering contracts / 纯游戏计时、碰撞、动力与转向合同。
 * The browser and server-only Node tests share these functions so frame cadence cannot change their semantics.
 */
(function publishGameplayCore(root) {
  'use strict';

  const EPSILON = 0.000_000_001;
  const DEFAULT_MAX_CATCH_UP_EVENTS = 8;
  const DEFAULT_MAX_FIXED_STEPS = 16;
  const DEFAULT_MAX_RENDER_STEP_SECONDS = 0.045;
  const DEFAULT_DRIFT_DURATION_SECONDS = 1.8;
  const LONGITUDINAL_ROLLING_RESISTANCE_MPS2 = 0.24;
  const LONGITUDINAL_LINEAR_DRAG_PER_SECOND = 0.015;
  const LONGITUDINAL_AERODYNAMIC_DRAG_PER_METER = 0.001_35;

  /** Return the full-throttle acceleration whose shared resistance curve balances at one dry-road speed. */
  function dryRoadEquilibriumAcceleration(speedMps) {
    const speed = Math.max(0, Number(speedMps) || 0);
    return LONGITUDINAL_ROLLING_RESISTANCE_MPS2
      + LONGITUDINAL_LINEAR_DRAG_PER_SECOND * speed
      + LONGITUDINAL_AERODYNAMIC_DRAG_PER_METER * speed * speed;
  }

  // Drive stages change available drive thrust, never authoritative speed. Each advertised terminal is therefore the root
  // of the same rolling + linear + quadratic resistance equation used by the integrator, not a hidden speed clamp.
  const DRIVE_GEAR_CONTRACT = (() => {
    const makeGear = (
      id,
      label,
      equilibriumKmh,
      minimumKmh,
      stallKmh,
      maximumSafeDownshiftKmh
    ) => {
      const equilibriumSpeedMps = equilibriumKmh / 3.6;
      return Object.freeze({
        id,
        label,
        propulsionMode: id === 3 ? 'high-performance-road-and-jump-stage' : 'road-drive-stage',
        equilibriumSpeedMps,
        equilibriumSpeedKmh: equilibriumKmh,
        minimumSpeedMps: minimumKmh / 3.6,
        minimumSpeedKmh: minimumKmh,
        stallSpeedMps: stallKmh / 3.6,
        stallSpeedKmh: stallKmh,
        maximumSafeDownshiftSpeedMps: maximumSafeDownshiftKmh / 3.6,
        maximumSafeDownshiftSpeedKmh: maximumSafeDownshiftKmh,
        lowSpeedTorqueModel: id === 1 ? 'full-range' : 'squared-stall-ramp',
        fullThrustAccelerationMps2: dryRoadEquilibriumAcceleration(equilibriumSpeedMps)
      });
    };
    const gears = Object.freeze({
      1: makeGear(1, 'drive-1', 110, 0, 0, 125),
      2: makeGear(2, 'drive-2', 160, 70, 35, 190),
      3: makeGear(3, 'performance-3', 280, 140, 90, 320)
    });
    return Object.freeze({
      defaultGear: 1,
      minimumGear: 1,
      maximumGear: 3,
      performanceGear: 3,
      automaticMinimumGear: 1,
      automaticMaximumGear: 3,
      automaticCruiseGear: 2,
      // Each automatic pair owns a 20km/h anti-chatter band. The 2↔3 downshift sits near the point where
      // third-stage available tractive effort falls to the full second-stage rating, avoiding a deep lug while
      // preserving enough hysteresis for a stable high-speed re-acceleration.
      automaticUpshiftSpeedMpsByGear: Object.freeze({
        1: 90 / 3.6,
        2: 140 / 3.6
      }),
      automaticDownshiftSpeedMpsByGear: Object.freeze({
        2: 70 / 3.6,
        3: 120 / 3.6
      }),
      shiftTorqueCutSeconds: 0.30,
      gears
    });
  })();
  // Transmission mode is independent from steering/autopilot authority. Runtime may expose any control surface,
  // but it must normalize that value here so "automatic" owns the published 1↔2↔3 schedule while "manual"
  // leaves every adjacent Q/E decision to the player.
  const DRIVE_TRANSMISSION_CONTRACT = Object.freeze({
    defaultMode: 'manual',
    automaticMode: 'automatic',
    manualMode: 'manual',
    modes: Object.freeze(['automatic', 'manual'])
  });
  // First gear retains a small torque-converter load at the shared 1,800 RPM idle. This is real delivered force,
  // not a minimum-speed clamp: dry level ground settles near 8km/h, hills and soft surfaces alter that balance,
  // and the service brake, a shift interruption, airborne motion, or any taller gear disconnects it completely.
  const IDLE_CREEP_CONTRACT = (() => {
    const targetSpeedMps = 8 / 3.6;
    const fadeOutSpeedMps = 16 / 3.6;
    const equilibriumThrustNormalized = dryRoadEquilibriumAcceleration(targetSpeedMps)
      / DRIVE_GEAR_CONTRACT.gears[1].fullThrustAccelerationMps2;
    return Object.freeze({
      driveGear: 1,
      targetSpeedMps,
      fadeOutSpeedMps,
      launchThrustNormalized: 0.24,
      equilibriumThrustNormalized,
      responseModel: 'first-gear-torque-converter-equilibrium',
      requiresGrounded: true,
      brakeCutsIdleCreep: true,
      shiftingCutsIdleCreep: true,
      tallerGearsDisconnectIdleCreep: true
    });
  })();
  // Runtime, HUD, audio, and exhaust effects must consume this one propulsion authority. The analytic response
  // preserves identical delivered impulse when the same throttle history is split across different frame cadences.
  const PROPULSION_CORE_CONTRACT = Object.freeze({
    idleRpm: 1_800,
    maximumRpm: 12_000,
    maximumUpgradedRpm: 15_000,
    spoolUpRatePerSecond: 2.4,
    maximumUpgradedSpoolUpRatePerSecond: 3.6,
    spoolDownRatePerSecond: 1.8,
    // The legacy scalar remains the ordinary second-gear rating; per-step delivery always resolves the selected gear.
    fullThrustAccelerationMps2: DRIVE_GEAR_CONTRACT.gears[2].fullThrustAccelerationMps2,
    driveGears: DRIVE_GEAR_CONTRACT,
    idleCreep: IDLE_CREEP_CONTRACT,
    responseModel: 'analytic-first-order',
    brakingCutsForwardThrust: true,
    shiftingCutsForwardThrust: true,
    throttleReleaseCutsExcessForwardThrust: true
  });
  // Longitudinal speed is a force balance rather than an uncapped accumulator. The dry-road coefficients model
  // low-speed rolling/mechanical loss plus linear and quadratic aerodynamic drag; the published terminal value is
  // derived from those same coefficients so HUD, autopilot, scoring, and tests cannot advertise another speed scale.
  const LONGITUDINAL_DYNAMICS_CONTRACT = (() => {
    const rollingResistanceMps2 = LONGITUDINAL_ROLLING_RESISTANCE_MPS2;
    const linearDragPerSecond = LONGITUDINAL_LINEAR_DRAG_PER_SECOND;
    const aerodynamicDragPerMeter = LONGITUDINAL_AERODYNAMIC_DRAG_PER_METER;
    return Object.freeze({
      minimumSpeedMps: 0,
      cruiseTargetSpeedMps: 120 / 3.6,
      // Compatibility readers treat the ordinary second gear as the dry terminal; all three roots remain published.
      dryFullThrottleTerminalSpeedMps: DRIVE_GEAR_CONTRACT.gears[2].equilibriumSpeedMps,
      dryGearEquilibriumSpeedMps: Object.freeze({
        1: DRIVE_GEAR_CONTRACT.gears[1].equilibriumSpeedMps,
        2: DRIVE_GEAR_CONTRACT.gears[2].equilibriumSpeedMps,
        3: DRIVE_GEAR_CONTRACT.gears[3].equilibriumSpeedMps
      }),
      rollingResistanceMps2,
      linearDragPerSecond,
      aerodynamicDragPerMeter,
      serviceBrakeDecelerationMps2: 7.5,
      longitudinalGravityMps2: 9.81,
      automaticThrottleProportionalGainPerMps: 0.065,
      stopSpeedThresholdMps: 0.08,
      impactSpeedRetention: Object.freeze({
        guardrail: 0.78,
        staticObstacle: 0.58,
        movingObstacle: 0.72
      }),
      resistanceModel: 'rolling-linear-quadratic',
      integrationModel: 'analytic-constant-interval-force',
      unpoweredThrustMode: 'immediate-pedal-cut-first-gear-idle-creep-rpm-spool-down',
      coastMustDecelerateAboveIdleCreepFadeSpeed: true
    });
  })();
  // Steering is an actuator rather than an instantaneous direction switch. Reversal first cancels the existing
  // deflection at the faster reverse rate, then engages the opposite side, which keeps the model Markovian and
  // exactly partition-stable without hidden renderer-owned state.
  const STEERING_ACTUATOR_CONTRACT = Object.freeze({
    engageRatePerSecond: 5.5,
    centerRatePerSecond: 7.5,
    reverseRatePerSecond: 8.0,
    responseModel: 'piecewise-linear-slew',
    minimumCommand: -1,
    maximumCommand: 1
  });
  // The historical handling contract now owns one shared candle-growth profile for steering, propulsion, and ship
  // color. Bounded diminishing returns preserve challenge while every pickup still advances every upgrade channel.
  const CANDLE_HANDLING_CONTRACT = Object.freeze({
    formula: 'bounded-diminishing-returns',
    halfResponseCandles: 18,
    baselineDisplayPercent: 55,
    maximumDisplayPercent: 100,
    maximumLateralAccelerationGain: 0.50,
    maximumLateralSpeedGain: 0.12,
    maximumDragGain: 0.35,
    maximumRpmGain: 0.25,
    maximumSpoolUpRateGain: 0.50,
    colorSequence: 'warm-gold-violet-cyan',
    sharedAuthority: true,
    affectsPropulsionResponse: true,
    directlyWritesLongitudinalSpeed: false,
    affectsCollision: false
  });
  // Every ordinary hazard source shares one active-gameplay timer. The render-frame latch prevents a catch-up
  // frame from charging multiple lives before the player has received even one visual protection frame.
  const DAMAGE_PROTECTION_CONTRACT = Object.freeze({
    id: 'ordinary-damage-protection-v1',
    invulnerabilitySeconds: 1.32,
    impactFeedbackSeconds: 0.48,
    timerClock: 'active-gameplay',
    maximumAcceptedPerRenderFrame: 1,
    blockedAttemptSideEffects: 'none',
    presentation: 'single-impact-steady-shield-no-blink'
  });
  // Surface patches and ship physics share this immutable description so route-local coordinates, footprint
  // inflation, boundary contact, and invalid-data behavior cannot silently diverge between callers.
  const SWEPT_ELLIPSE_INTERVAL_CONTRACT = Object.freeze({
    coordinateSpace: 'route-local-relative-distance-lateral',
    parameterInterval: 'closed-[0,1]',
    footprintExpansion: 'exact-ellipse-minkowski-axis-aligned-rectangle',
    solution: 'piecewise-rounded-rectangle',
    boundaryContact: 'inclusive',
    invalidInput: 'miss',
    resultFields: 'hit,entryT,exitT',
    reusableOutput: true
  });
  // Vertical flight must sample both fast route travel and long render frames finely enough that an upper deck
  // cannot appear and disappear between endpoint-only checks. The sampler owns world-height floor/ceiling data;
  // this core owns the constant-gravity trajectory and earliest closed-boundary contact.
  const SWEPT_VERTICAL_CONTACT_CONTRACT = Object.freeze({
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
  // This is an authored game-performance index, not a population percentile or a claim about real-world piloting.
  // Every scored dimension is backed by run-wide physical counters; dimensions with no defensible sample are
  // excluded and the remaining fixed weights are renormalized instead of treating missing evidence as failure.
  const FLIGHT_RATING_CONTRACT = Object.freeze({
    id: 'flight-rating-v2',
    version: 2,
    targetSpeedMps: LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps,
    minimumCollectionDistanceM: 2_000,
    conservativeCollectionSupplyPerKm: 55,
    successfulPlatformExposureSeconds: 6,
    limitedMinimumDistanceM: 1_000,
    limitedMinimumElapsedSeconds: 30,
    completeMinimumDistanceM: 10_000,
    completeMinimumElapsedSeconds: 60,
    limitedMaximumScore: 69,
    provisionalMaximumScore: 89,
    safetyMetric: 'average-damage-free-segment-km',
    weights: Object.freeze({
      safety: 30,
      pace: 25,
      endurance: 15,
      collection: 15,
      airborne: 15
    }),
    gradeMinimums: Object.freeze({
      S: 90,
      A: 80,
      B: 70,
      C: 60,
      D: 0
    }),
    safetyDamageFreeSegmentAnchorsKm: Object.freeze([
      Object.freeze({ value: 0, score: 0 }),
      Object.freeze({ value: 0.5, score: 20 }),
      Object.freeze({ value: 2, score: 40 }),
      Object.freeze({ value: 5, score: 60 }),
      Object.freeze({ value: 10, score: 80 }),
      Object.freeze({ value: 20, score: 100 })
    ]),
    enduranceAnchorsSeconds: Object.freeze([
      Object.freeze({ value: 0, score: 0 }),
      Object.freeze({ value: 30, score: 25 }),
      Object.freeze({ value: 60, score: 50 }),
      Object.freeze({ value: 120, score: 75 }),
      Object.freeze({ value: 240, score: 100 })
    ]),
    collectionRateAnchorsPerKm: Object.freeze([
      Object.freeze({ value: 0, score: 0 }),
      Object.freeze({ value: 5.5, score: 20 }),
      Object.freeze({ value: 11, score: 40 }),
      Object.freeze({ value: 19.25, score: 60 }),
      Object.freeze({ value: 27.5, score: 80 }),
      Object.freeze({ value: 55, score: 100 })
    ])
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteNonNegative(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  /** Interpolate an authored monotonic score table without pretending that its bands are player percentiles. */
  function scoreFromAnchors(value, anchors) {
    const sample = finiteNonNegative(value);
    if (sample <= anchors[0].value) return anchors[0].score;
    for (let index = 1; index < anchors.length; index++) {
      const upper = anchors[index];
      if (sample > upper.value) continue;
      const lower = anchors[index - 1];
      const span = Math.max(EPSILON, upper.value - lower.value);
      const progress = (sample - lower.value) / span;
      return lower.score + (upper.score - lower.score) * progress;
    }
    return anchors[anchors.length - 1].score;
  }

  /** Map the fixed whole-number engineering score to its published S/A/B/C/D band. */
  function resolveFlightRatingGrade(score) {
    const roundedScore = clamp(Math.round(finiteNonNegative(score)), 0, 100);
    if (roundedScore >= FLIGHT_RATING_CONTRACT.gradeMinimums.S) return 'S';
    if (roundedScore >= FLIGHT_RATING_CONTRACT.gradeMinimums.A) return 'A';
    if (roundedScore >= FLIGHT_RATING_CONTRACT.gradeMinimums.B) return 'B';
    if (roundedScore >= FLIGHT_RATING_CONTRACT.gradeMinimums.C) return 'C';
    return 'D';
  }

  /**
   * Resolve one immutable, reproducible end-of-run rating from recorded run-wide facts.
   *
   * Average speed is mathematically derived from authoritative distance/time, overspeed cannot earn bonus credit,
   * failed airtime is reported but never rewarded, and short/missing samples are labelled and capped explicitly.
   */
  function resolveFlightRating(input = {}) {
    const distanceM = finiteNonNegative(input.distanceM);
    const elapsedSeconds = finiteNonNegative(input.elapsedSeconds);
    const distanceKm = distanceM / 1_000;
    const averageSpeedMps = elapsedSeconds > EPSILON ? distanceM / elapsedSeconds : 0;
    const maximumSpeedMps = elapsedSeconds > EPSILON
      ? Math.max(averageSpeedMps, finiteNonNegative(input.maximumSpeedMps))
      : 0;
    const damageCount = Math.floor(finiteNonNegative(input.damageCount));
    // Guardrail life loss is a labelled subset of accepted ordinary damage, never an additional penalty.
    // Clamping preserves the total = obstacle + guardrail invariant for malformed diagnostic input.
    const guardrailDamageCount = Math.min(
      damageCount,
      Math.floor(finiteNonNegative(input.guardrailDamageCount))
    );
    const obstacleDamageCount = damageCount - guardrailDamageCount;
    const offRoadCrashCount = Math.floor(finiteNonNegative(input.offRoadCrashCount));
    const candleCount = Math.floor(finiteNonNegative(input.candleCount));
    const takeoffCount = Math.floor(finiteNonNegative(input.takeoffCount));
    const landingCount = Math.min(
      takeoffCount,
      Math.floor(finiteNonNegative(input.landingCount))
    );
    const platformTakeoffCount = Math.min(
      takeoffCount,
      Math.floor(finiteNonNegative(input.platformTakeoffCount))
    );
    const platformLandingCount = Math.min(
      platformTakeoffCount,
      Math.floor(finiteNonNegative(input.platformLandingCount))
    );
    const totalAirTimeSeconds = finiteNonNegative(input.totalAirTimeSeconds);
    const successfulAirTimeSeconds = Math.min(
      totalAirTimeSeconds,
      finiteNonNegative(input.successfulAirTimeSeconds)
    );
    const platformAirTimeSeconds = Math.min(
      totalAirTimeSeconds,
      finiteNonNegative(input.platformAirTimeSeconds)
    );
    const successfulPlatformAirTimeSeconds = Math.min(
      platformAirTimeSeconds,
      finiteNonNegative(input.successfulPlatformAirTimeSeconds)
    );
    const longestAirTimeSeconds = Math.min(
      totalAirTimeSeconds,
      finiteNonNegative(input.longestAirTimeSeconds)
    );
    // Start, every accepted life loss, and the terminal boundary split a run into N + 1 uninterrupted segments.
    // Dividing by damageCount alone made the first real hit score identically to a damage-free run.
    const damageFreeSegmentKm = distanceKm / (damageCount + 1);
    let safetyScore = scoreFromAnchors(
      damageFreeSegmentKm,
      FLIGHT_RATING_CONTRACT.safetyDamageFreeSegmentAnchorsKm
    );
    // Missing every real road after a platform flight is a fatal safety outcome regardless of preceding distance.
    if (offRoadCrashCount > 0) safetyScore = Math.min(safetyScore, 20);

    const targetSpeedMps = FLIGHT_RATING_CONTRACT.targetSpeedMps;
    const averageTargetRatio = clamp(averageSpeedMps / targetSpeedMps, 0, 1);
    const maximumTargetRatio = clamp(maximumSpeedMps / targetSpeedMps, 0, 1);
    const paceScore = (averageTargetRatio + maximumTargetRatio) * 50;
    const enduranceScore = scoreFromAnchors(
      elapsedSeconds,
      FLIGHT_RATING_CONTRACT.enduranceAnchorsSeconds
    );
    const collectionRatePerKm = distanceKm > EPSILON ? candleCount / distanceKm : 0;
    const collectionAvailable = distanceM >= FLIGHT_RATING_CONTRACT.minimumCollectionDistanceM;
    const collectionScore = collectionAvailable
      ? scoreFromAnchors(
          collectionRatePerKm,
          FLIGHT_RATING_CONTRACT.collectionRateAnchorsPerKm
        )
      : null;
    const airborneAvailable = platformTakeoffCount > 0;
    const platformLandingRate = airborneAvailable
      ? platformLandingCount / platformTakeoffCount
      : 0;
    const successfulExposureRatio = clamp(
      successfulPlatformAirTimeSeconds
        / FLIGHT_RATING_CONTRACT.successfulPlatformExposureSeconds,
      0,
      1
    );
    // Reliability owns three quarters of the dimension; actual successful seconds establish exposure depth.
    const airborneScore = airborneAvailable
      ? platformLandingRate * 75 + successfulExposureRatio * 25
      : null;
    const authoredDimensions = [
      { id: 'safety', score: safetyScore, available: true },
      { id: 'pace', score: paceScore, available: true },
      { id: 'endurance', score: enduranceScore, available: true },
      { id: 'collection', score: collectionScore, available: collectionAvailable },
      { id: 'airborne', score: airborneScore, available: airborneAvailable }
    ];
    let availableWeight = 0;
    let weightedScore = 0;
    const dimensions = authoredDimensions.map((dimension) => {
      const weight = FLIGHT_RATING_CONTRACT.weights[dimension.id];
      if (dimension.available) {
        availableWeight += weight;
        weightedScore += dimension.score * weight;
      }
      const roundedScore = dimension.available ? clamp(Math.round(dimension.score), 0, 100) : null;
      return Object.freeze({
        id: dimension.id,
        baseWeight: weight,
        available: dimension.available,
        score: roundedScore,
        grade: roundedScore === null ? null : resolveFlightRatingGrade(roundedScore)
      });
    });
    const rawScore = availableWeight > 0 ? weightedScore / availableWeight : 0;
    let evidenceLevel = 'complete';
    let maximumScore = 100;
    if (
      distanceM < FLIGHT_RATING_CONTRACT.limitedMinimumDistanceM
      || elapsedSeconds < FLIGHT_RATING_CONTRACT.limitedMinimumElapsedSeconds
    ) {
      evidenceLevel = 'limited';
      maximumScore = FLIGHT_RATING_CONTRACT.limitedMaximumScore;
    } else if (
      distanceM < FLIGHT_RATING_CONTRACT.completeMinimumDistanceM
      || elapsedSeconds < FLIGHT_RATING_CONTRACT.completeMinimumElapsedSeconds
      || availableWeight < 100
    ) {
      evidenceLevel = 'provisional';
      maximumScore = FLIGHT_RATING_CONTRACT.provisionalMaximumScore;
    }
    const score = Math.min(maximumScore, clamp(Math.round(rawScore), 0, 100));
    const availableDimensions = dimensions.filter((dimension) => dimension.available);
    const weakestDimension = availableDimensions.reduce((weakest, dimension) => (
      !weakest || dimension.score < weakest.score ? dimension : weakest
    ), null);
    const metrics = Object.freeze({
      distanceM,
      elapsedSeconds,
      averageSpeedMps,
      maximumSpeedMps,
      damageCount,
      obstacleDamageCount,
      guardrailDamageCount,
      offRoadCrashCount,
      candleCount,
      collectionRatePerKm,
      takeoffCount,
      landingCount,
      platformTakeoffCount,
      platformLandingCount,
      platformLandingRate,
      totalAirTimeSeconds,
      successfulAirTimeSeconds,
      platformAirTimeSeconds,
      successfulPlatformAirTimeSeconds,
      longestAirTimeSeconds,
      damageFreeSegmentKm
    });
    return Object.freeze({
      contractId: FLIGHT_RATING_CONTRACT.id,
      score,
      rawScore: Number(rawScore.toFixed(2)),
      grade: resolveFlightRatingGrade(score),
      evidenceLevel,
      coveragePercent: availableWeight,
      weakestDimensionId: evidenceLevel === 'limited' ? null : weakestDimension?.id || null,
      endReason: offRoadCrashCount > 0 ? 'off-road-crash' : 'lives-depleted',
      dimensions: Object.freeze(dimensions),
      metrics
    });
  }

  /**
   * Derive the one candle-growth profile consumed by physics, ship color, HUD, diagnostics, and tests.
   * The caller may reuse `target`; no gameplay path needs to allocate when a pickup is collected or a run resets.
   */
  function resolveCandleHandling(candleCount, target = {}) {
    const numericCount = Number(candleCount);
    // Public diagnostics may sample arbitrary input; non-finite values must resolve to the safe gameplay baseline.
    const normalizedCount = Number.isFinite(numericCount)
      ? Math.max(0, Math.floor(numericCount))
      : 0;
    const progress = normalizedCount === 0
      ? 0
      : normalizedCount / (normalizedCount + CANDLE_HANDLING_CONTRACT.halfResponseCandles);
    const displayRange = CANDLE_HANDLING_CONTRACT.maximumDisplayPercent
      - CANDLE_HANDLING_CONTRACT.baselineDisplayPercent;
    target.candleCount = normalizedCount;
    target.progress = progress;
    target.displayPercent = CANDLE_HANDLING_CONTRACT.baselineDisplayPercent + displayRange * progress;
    target.lateralAccelerationMultiplier = 1
      + CANDLE_HANDLING_CONTRACT.maximumLateralAccelerationGain * progress;
    target.lateralSpeedMultiplier = 1
      + CANDLE_HANDLING_CONTRACT.maximumLateralSpeedGain * progress;
    target.dragMultiplier = 1 + CANDLE_HANDLING_CONTRACT.maximumDragGain * progress;
    target.maximumRpm = PROPULSION_CORE_CONTRACT.maximumRpm
      * (1 + CANDLE_HANDLING_CONTRACT.maximumRpmGain * progress);
    target.spoolUpRatePerSecond = PROPULSION_CORE_CONTRACT.spoolUpRatePerSecond
      * (1 + CANDLE_HANDLING_CONTRACT.maximumSpoolUpRateGain * progress);
    target.colorProgress = progress;
    return target;
  }

  /**
   * Intersect one linearly swept relative center with a symmetric slab.
   * Returning the interval keeps the caller able to publish the exact contact fraction for diagnostics.
   */
  function sweptAxisInterval(start, end, halfExtent) {
    const extent = Math.max(0, Number(halfExtent) || 0);
    const from = Number(start) || 0;
    const to = Number(end) || 0;
    const delta = to - from;
    if (Math.abs(delta) <= EPSILON) {
      return Math.abs(from) <= extent
        ? Object.freeze({ hit: true, entryTime: 0, exitTime: 1 })
        : Object.freeze({ hit: false, entryTime: Number.POSITIVE_INFINITY, exitTime: Number.NEGATIVE_INFINITY });
    }
    const first = (-extent - from) / delta;
    const second = (extent - from) / delta;
    return Object.freeze({
      hit: true,
      entryTime: Math.min(first, second),
      exitTime: Math.max(first, second)
    });
  }

  /**
   * Sweep a relative AABB center through route-local lateral, vertical, and longitudinal space.
   * `half` is the summed half-extent of both colliders, not either collider alone.
   */
  function sweptAabb(relativeStart, relativeEnd, half) {
    const axes = [
      sweptAxisInterval(relativeStart?.x, relativeEnd?.x, half?.x),
      sweptAxisInterval(relativeStart?.y, relativeEnd?.y, half?.y),
      sweptAxisInterval(relativeStart?.z, relativeEnd?.z, half?.z)
    ];
    if (axes.some((axis) => !axis.hit)) {
      return Object.freeze({ hit: false, entryTime: null, exitTime: null });
    }
    const entryTime = Math.max(0, ...axes.map((axis) => axis.entryTime));
    const exitTime = Math.min(1, ...axes.map((axis) => axis.exitTime));
    return Object.freeze({
      hit: entryTime <= exitTime + EPSILON,
      entryTime: entryTime <= exitTime + EPSILON ? entryTime : null,
      exitTime: entryTime <= exitTime + EPSILON ? exitTime : null
    });
  }

  /**
   * Return the first normalized contact time, or +Infinity on a miss.
   * The scalar sentinel keeps the per-entity production hot path allocation-free while `sweptAabb` remains the
   * detailed diagnostic contract.
   */
  function sweptAabbEntryTime(
    startX,
    startY,
    startZ,
    endX,
    endY,
    endZ,
    halfX,
    halfY,
    halfZ
  ) {
    let entryTime = 0;
    let exitTime = 1;

    const xExtent = Math.max(0, Number(halfX) || 0);
    const xFrom = Number(startX) || 0;
    const xDelta = (Number(endX) || 0) - xFrom;
    if (Math.abs(xDelta) <= EPSILON) {
      if (Math.abs(xFrom) > xExtent) return Number.POSITIVE_INFINITY;
    } else {
      const xFirst = (-xExtent - xFrom) / xDelta;
      const xSecond = (xExtent - xFrom) / xDelta;
      entryTime = Math.max(entryTime, Math.min(xFirst, xSecond));
      exitTime = Math.min(exitTime, Math.max(xFirst, xSecond));
      if (entryTime > exitTime + EPSILON) return Number.POSITIVE_INFINITY;
    }

    const yExtent = Math.max(0, Number(halfY) || 0);
    const yFrom = Number(startY) || 0;
    const yDelta = (Number(endY) || 0) - yFrom;
    if (Math.abs(yDelta) <= EPSILON) {
      if (Math.abs(yFrom) > yExtent) return Number.POSITIVE_INFINITY;
    } else {
      const yFirst = (-yExtent - yFrom) / yDelta;
      const ySecond = (yExtent - yFrom) / yDelta;
      entryTime = Math.max(entryTime, Math.min(yFirst, ySecond));
      exitTime = Math.min(exitTime, Math.max(yFirst, ySecond));
      if (entryTime > exitTime + EPSILON) return Number.POSITIVE_INFINITY;
    }

    const zExtent = Math.max(0, Number(halfZ) || 0);
    const zFrom = Number(startZ) || 0;
    const zDelta = (Number(endZ) || 0) - zFrom;
    if (Math.abs(zDelta) <= EPSILON) {
      if (Math.abs(zFrom) > zExtent) return Number.POSITIVE_INFINITY;
    } else {
      const zFirst = (-zExtent - zFrom) / zDelta;
      const zSecond = (zExtent - zFrom) / zDelta;
      entryTime = Math.max(entryTime, Math.min(zFirst, zSecond));
      exitTime = Math.min(exitTime, Math.max(zFirst, zSecond));
      if (entryTime > exitTime + EPSILON) return Number.POSITIVE_INFINITY;
    }

    return entryTime <= exitTime + EPSILON
      ? Math.max(0, Math.min(1, entryTime))
      : Number.POSITIVE_INFINITY;
  }

  /** Test the allocation-free entry-time contract as a boolean convenience. */
  function sweptAabbHit(
    startX,
    startY,
    startZ,
    endX,
    endY,
    endZ,
    halfX,
    halfY,
    halfZ
  ) {
    return Number.isFinite(sweptAabbEntryTime(
      startX,
      startY,
      startZ,
      endX,
      endY,
      endZ,
      halfX,
      halfY,
      halfZ
    ));
  }

  /**
   * Intersect a route-local center sweep with the exact Minkowski sum of an ellipse and rectangular footprint.
   * Splitting at the four footprint slab boundaries turns every rounded-rectangle region into a line-vs-circle
   * query, retaining diagonal corner contact that axis-radius inflation misses. The closed result is clamped to
   * `[0, 1]`, and caller-owned `out` keeps the production contact path allocation-free.
   */
  function sweptEllipseInterval(
    previousDistance,
    previousLateral,
    currentDistance,
    currentLateral,
    ellipseDistanceRadius,
    ellipseLateralRadius,
    footprintDistanceRadius = 0,
    footprintLateralRadius = 0,
    out = {}
  ) {
    const target = out && (typeof out === 'object' || typeof out === 'function') ? out : {};
    const fromDistance = Number(previousDistance);
    const fromLateral = Number(previousLateral);
    const toDistance = Number(currentDistance);
    const toLateral = Number(currentLateral);
    const patchDistanceRadius = Number(ellipseDistanceRadius);
    const patchLateralRadius = Number(ellipseLateralRadius);
    const shipDistanceRadius = Number(footprintDistanceRadius);
    const shipLateralRadius = Number(footprintLateralRadius);
    if (
      !Number.isFinite(fromDistance)
      || !Number.isFinite(fromLateral)
      || !Number.isFinite(toDistance)
      || !Number.isFinite(toLateral)
      || !Number.isFinite(patchDistanceRadius)
      || !Number.isFinite(patchLateralRadius)
      || !Number.isFinite(shipDistanceRadius)
      || !Number.isFinite(shipLateralRadius)
      || patchDistanceRadius < 0
      || patchLateralRadius < 0
      || shipDistanceRadius < 0
      || shipLateralRadius < 0
    ) {
      target.hit = false;
      target.entryT = null;
      target.exitT = null;
      return target;
    }

    const outerDistanceRadius = patchDistanceRadius + shipDistanceRadius;
    const outerLateralRadius = patchLateralRadius + shipLateralRadius;
    if (
      !Number.isFinite(outerDistanceRadius)
      || !Number.isFinite(outerLateralRadius)
      || outerDistanceRadius <= 0
      || outerLateralRadius <= 0
    ) {
      target.hit = false;
      target.entryT = null;
      target.exitT = null;
      return target;
    }

    const deltaDistance = toDistance - fromDistance;
    const deltaLateral = toLateral - fromLateral;
    if (!Number.isFinite(deltaDistance) || !Number.isFinite(deltaLateral)) {
      target.hit = false;
      target.entryT = null;
      target.exitT = null;
      return target;
    }

    if (patchDistanceRadius === 0 || patchLateralRadius === 0) {
      if (patchDistanceRadius !== 0 || patchLateralRadius !== 0) {
        // A one-axis collapsed streamed ellipse has no defined area in this contract.
        target.hit = false;
        target.entryT = null;
        target.exitT = null;
        return target;
      }
      // A zero-area patch dilated by the authored footprint is exactly its axis-aligned rectangle.
      let entryT = 0;
      let exitT = 1;
      if (Math.abs(deltaDistance) <= EPSILON) {
        if (Math.abs(fromDistance) > shipDistanceRadius + EPSILON) {
          target.hit = false;
          target.entryT = null;
          target.exitT = null;
          return target;
        }
      } else {
        const first = (-shipDistanceRadius - fromDistance) / deltaDistance;
        const second = (shipDistanceRadius - fromDistance) / deltaDistance;
        entryT = Math.max(entryT, Math.min(first, second));
        exitT = Math.min(exitT, Math.max(first, second));
      }
      if (Math.abs(deltaLateral) <= EPSILON) {
        if (Math.abs(fromLateral) > shipLateralRadius + EPSILON) {
          target.hit = false;
          target.entryT = null;
          target.exitT = null;
          return target;
        }
      } else {
        const first = (-shipLateralRadius - fromLateral) / deltaLateral;
        const second = (shipLateralRadius - fromLateral) / deltaLateral;
        entryT = Math.max(entryT, Math.min(first, second));
        exitT = Math.min(exitT, Math.max(first, second));
      }
      if (entryT > exitT + EPSILON || exitT < -EPSILON || entryT > 1 + EPSILON) {
        target.hit = false;
        target.entryT = null;
        target.exitT = null;
        return target;
      }
      target.hit = true;
      target.entryT = clamp(entryT, 0, 1);
      target.exitT = clamp(exitT, 0, 1);
      return target;
    }

    let contactEntryT = Number.POSITIVE_INFINITY;
    let contactExitT = Number.NEGATIVE_INFINITY;
    let regionStartT = 0;
    // A linear sweep crosses each of ±footprintDistance and ±footprintLateral at most once: five regions suffice.
    for (let regionIndex = 0; regionIndex < 5; regionIndex++) {
      let regionEndT = 1;
      if (Math.abs(deltaDistance) > EPSILON) {
        const negativeDistanceBoundaryT = (-shipDistanceRadius - fromDistance) / deltaDistance;
        const positiveDistanceBoundaryT = (shipDistanceRadius - fromDistance) / deltaDistance;
        if (negativeDistanceBoundaryT > regionStartT + EPSILON
          && negativeDistanceBoundaryT < regionEndT) {
          regionEndT = negativeDistanceBoundaryT;
        }
        if (positiveDistanceBoundaryT > regionStartT + EPSILON
          && positiveDistanceBoundaryT < regionEndT) {
          regionEndT = positiveDistanceBoundaryT;
        }
      }
      if (Math.abs(deltaLateral) > EPSILON) {
        const negativeLateralBoundaryT = (-shipLateralRadius - fromLateral) / deltaLateral;
        const positiveLateralBoundaryT = (shipLateralRadius - fromLateral) / deltaLateral;
        if (negativeLateralBoundaryT > regionStartT + EPSILON
          && negativeLateralBoundaryT < regionEndT) {
          regionEndT = negativeLateralBoundaryT;
        }
        if (positiveLateralBoundaryT > regionStartT + EPSILON
          && positiveLateralBoundaryT < regionEndT) {
          regionEndT = positiveLateralBoundaryT;
        }
      }

      const regionMidT = (regionStartT + regionEndT) * 0.5;
      const midDistance = fromDistance + deltaDistance * regionMidT;
      const midLateral = fromLateral + deltaLateral * regionMidT;
      let distanceSign = 0;
      let lateralSign = 0;
      if (midDistance > shipDistanceRadius) distanceSign = 1;
      else if (midDistance < -shipDistanceRadius) distanceSign = -1;
      if (midLateral > shipLateralRadius) lateralSign = 1;
      else if (midLateral < -shipLateralRadius) lateralSign = -1;

      const startDistanceResidual = distanceSign === 0
        ? 0
        : (distanceSign * (fromDistance + deltaDistance * regionStartT)
          - shipDistanceRadius) / patchDistanceRadius;
      const endDistanceResidual = distanceSign === 0
        ? 0
        : (distanceSign * (fromDistance + deltaDistance * regionEndT)
          - shipDistanceRadius) / patchDistanceRadius;
      const startLateralResidual = lateralSign === 0
        ? 0
        : (lateralSign * (fromLateral + deltaLateral * regionStartT)
          - shipLateralRadius) / patchLateralRadius;
      const endLateralResidual = lateralSign === 0
        ? 0
        : (lateralSign * (fromLateral + deltaLateral * regionEndT)
          - shipLateralRadius) / patchLateralRadius;
      const residualDeltaDistance = endDistanceResidual - startDistanceResidual;
      const residualDeltaLateral = endLateralResidual - startLateralResidual;
      const residualSegmentLength = Math.hypot(residualDeltaDistance, residualDeltaLateral);
      if (
        !Number.isFinite(startDistanceResidual)
        || !Number.isFinite(endDistanceResidual)
        || !Number.isFinite(startLateralResidual)
        || !Number.isFinite(endLateralResidual)
        || !Number.isFinite(residualSegmentLength)
      ) {
        target.hit = false;
        target.entryT = null;
        target.exitT = null;
        return target;
      }

      const regionStartInside = Math.hypot(startDistanceResidual, startLateralResidual)
        <= 1 + EPSILON;
      const regionEndInside = Math.hypot(endDistanceResidual, endLateralResidual)
        <= 1 + EPSILON;
      let regionEntryU = Number.POSITIVE_INFINITY;
      let regionExitU = Number.NEGATIVE_INFINITY;
      if (regionStartInside && regionEndInside) {
        regionEntryU = 0;
        regionExitU = 1;
      } else if (residualSegmentLength <= EPSILON) {
        if (regionStartInside) {
          regionEntryU = 0;
          regionExitU = 1;
        }
      } else {
        // Normalizing the active rounded-corner region to a unit circle avoids high-speed discriminant loss.
        const directionDistance = residualDeltaDistance / residualSegmentLength;
        const directionLateral = residualDeltaLateral / residualSegmentLength;
        const projectedStart = startDistanceResidual * directionDistance
          + startLateralResidual * directionLateral;
        const perpendicularStart = startDistanceResidual * directionLateral
          - startLateralResidual * directionDistance;
        if (Number.isFinite(projectedStart)
          && Number.isFinite(perpendicularStart)
          && Math.abs(perpendicularStart) <= 1 + EPSILON) {
          const halfChord = Math.sqrt(Math.max(0, 1 - perpendicularStart * perpendicularStart));
          const lineEntryU = (-projectedStart - halfChord) / residualSegmentLength;
          const lineExitU = (-projectedStart + halfChord) / residualSegmentLength;
          if (Number.isFinite(lineEntryU)
            && Number.isFinite(lineExitU)
            && lineExitU >= -EPSILON
            && lineEntryU <= 1 + EPSILON) {
            regionEntryU = clamp(lineEntryU, 0, 1);
            regionExitU = clamp(lineExitU, 0, 1);
          }
        }
      }

      if (regionEntryU <= regionExitU + EPSILON) {
        const regionDuration = regionEndT - regionStartT;
        contactEntryT = Math.min(
          contactEntryT,
          regionStartT + regionDuration * regionEntryU
        );
        contactExitT = Math.max(
          contactExitT,
          regionStartT + regionDuration * regionExitU
        );
      }
      if (regionEndT >= 1 - EPSILON) break;
      regionStartT = regionEndT;
    }

    if (!Number.isFinite(contactEntryT) || !Number.isFinite(contactExitT)) {
      target.hit = false;
      target.entryT = null;
      target.exitT = null;
      return target;
    }
    target.hit = true;
    target.entryT = clamp(contactEntryT, 0, 1);
    target.exitT = clamp(contactExitT, 0, 1);
    return target;
  }

  /**
   * Return the earliest local time at which a quadratic safe-clearance polynomial reaches its closed boundary.
   * A zero-time root is ignored only while the body is separating; this lets a launch leave the floor while
   * preserving resting, penetrating, falling, and tangent contact.
   */
  function firstNonPositiveQuadraticTime(quadratic, linear, constant, duration) {
    if (constant < -EPSILON) return 0;
    let minimumTime = 0;
    if (Math.abs(constant) <= EPSILON) {
      if (
        linear < -EPSILON
        || (Math.abs(linear) <= EPSILON && quadratic <= EPSILON)
      ) {
        return 0;
      }
      minimumTime = EPSILON;
    }
    // Only ordinary sweeps accept a tiny negative root as round-off. A separating floor/ceiling boundary must
    // cross the positive time horizon, otherwise the launch's historical t=0 contact immediately cancels takeoff.
    const rootTimeLowerBound = minimumTime > 0 ? minimumTime : -EPSILON;

    if (Math.abs(quadratic) <= EPSILON) {
      if (linear >= -EPSILON) return Number.POSITIVE_INFINITY;
      const root = -constant / linear;
      return root >= rootTimeLowerBound && root <= duration + EPSILON
        ? clamp(root, 0, duration)
        : Number.POSITIVE_INFINITY;
    }

    const discriminant = linear * linear - 4 * quadratic * constant;
    if (!Number.isFinite(discriminant) || discriminant < -EPSILON) {
      return Number.POSITIVE_INFINITY;
    }
    const squareRoot = Math.sqrt(Math.max(0, discriminant));
    const denominator = 2 * quadratic;
    const firstRoot = (-linear - squareRoot) / denominator;
    const secondRoot = (-linear + squareRoot) / denominator;
    const earlierRoot = Math.min(firstRoot, secondRoot);
    const laterRoot = Math.max(firstRoot, secondRoot);
    if (earlierRoot >= rootTimeLowerBound && earlierRoot <= duration + EPSILON) {
      return clamp(earlierRoot, 0, duration);
    }
    if (laterRoot >= rootTimeLowerBound && laterRoot <= duration + EPSILON) {
      return clamp(laterRoot, 0, duration);
    }
    return Number.POSITIVE_INFINITY;
  }

  /**
   * Sweep a constant-gravity vertical trajectory over route-sampled floor and finite-ceiling profiles.
   *
   * `sampleVerticalProfile(distanceM, fraction, sampleOut)` may return its profile or fill `sampleOut` with
   * `{ surface, ceiling }`; `Infinity` means open sky. The caller may reuse `out`. The first-contact fields remain
   * immutable evidence of chronology, while the `end*` fields advance the unused frame time under floor/ceiling
   * constraints. This separation prevents a correct early hit from being reused as an already-stale frame-end pose.
   */
  function sweptVerticalContact(input, sampleVerticalProfile, out = {}) {
    const target = out && (typeof out === 'object' || typeof out === 'function') ? out : {};
    target.hit = false;
    target.kind = null;
    target.fraction = null;
    target.time = null;
    target.altitude = null;
    target.velocity = null;
    target.surface = null;
    target.ceiling = null;
    target.endAltitude = null;
    target.endVelocity = null;
    target.endSurface = null;
    target.endCeiling = null;
    target.endGrounded = false;
    target.endGroundedFraction = null;
    target.endImpactVelocity = null;
    target.sampleCount = 0;
    target.penetration = 0;
    target.overshoot = 0;

    const startDistance = Number(input?.startDistance);
    const endDistance = Number(input?.endDistance);
    const duration = Number(input?.duration);
    const startAltitude = Number(input?.startAltitude);
    const startVelocity = Number(input?.startVelocity);
    const gravity = Number(input?.gravity);
    const bottomOffset = input?.bottomOffset === undefined ? 0 : Number(input.bottomOffset);
    const topOffset = input?.topOffset === undefined ? 0 : Number(input.topOffset);
    if (
      !Number.isFinite(startDistance)
      || !Number.isFinite(endDistance)
      || !Number.isFinite(duration)
      || duration < 0
      || !Number.isFinite(startAltitude)
      || !Number.isFinite(startVelocity)
      || !Number.isFinite(gravity)
      || !Number.isFinite(bottomOffset)
      || bottomOffset < 0
      || !Number.isFinite(topOffset)
      || topOffset < 0
      || typeof sampleVerticalProfile !== 'function'
    ) {
      return target;
    }

    const distanceDelta = endDistance - startDistance;
    if (!Number.isFinite(distanceDelta)) return target;
    const finalAltitude = startAltitude + startVelocity * duration
      - 0.5 * gravity * duration * duration;
    const finalVelocity = startVelocity - gravity * duration;
    if (!Number.isFinite(finalAltitude) || !Number.isFinite(finalVelocity)) return target;

    const samplerScratch = { surface: Number.NaN, ceiling: Number.POSITIVE_INFINITY };
    let sampleCount = 0;
    const sampleAtFraction = (fraction, profile) => {
      samplerScratch.surface = Number.NaN;
      samplerScratch.ceiling = Number.POSITIVE_INFINITY;
      const distance = startDistance + distanceDelta * fraction;
      const returned = sampleVerticalProfile(distance, fraction, samplerScratch);
      const sampled = returned && (typeof returned === 'object' || typeof returned === 'function')
        ? returned
        : samplerScratch;
      const surface = Number(sampled.surface);
      const ceiling = Number(sampled.ceiling);
      profile.fraction = fraction;
      profile.surface = Number.isFinite(surface) ? surface : Number.NaN;
      profile.ceiling = Number.isFinite(ceiling) ? ceiling : Number.POSITIVE_INFINITY;
      sampleCount++;
      return profile;
    };
    const altitudeAtFraction = (fraction) => {
      const time = duration * fraction;
      return startAltitude + startVelocity * time - 0.5 * gravity * time * time;
    };
    const velocityAtFraction = (fraction) => startVelocity - gravity * duration * fraction;
    const startProfile = {};
    const endProfile = {};
    const boundaryProfile = {};
    const contactProfile = {};
    const predicateProfile = {};
    const remainderProfile = {};
    sampleAtFraction(0, startProfile);
    if (!Number.isFinite(startProfile.surface)) {
      target.sampleCount = sampleCount;
      return target;
    }

    const publishEndState = (
      altitude,
      velocity,
      surface,
      ceiling,
      grounded
    ) => {
      target.endAltitude = altitude;
      target.endVelocity = velocity;
      target.endSurface = surface;
      target.endCeiling = ceiling;
      target.endGrounded = grounded;
      target.sampleCount = sampleCount;
    };

    /**
     * Continue from the first chronological contact through the rest of the frame.
     *
     * Contact response is intentionally inelastic: a ceiling redirects upward motion down, and a floor latches the
     * ship to the sampled route. Every remainder interval is re-sampled, so a descending soffit or a second deck
     * transition cannot invalidate the otherwise-correct first-contact result before rendering the frame.
     */
    const resolveRemainingState = (
      kind,
      contactFraction,
      contactAltitude,
      incomingVelocity,
      contactSurface,
      contactCeiling
    ) => {
      let currentFraction = contactFraction;
      let currentAltitude = contactAltitude;
      let currentVelocity = kind === 'ceiling'
        ? Math.min(-0.1, incomingVelocity)
        : 0;
      let currentSurface = contactSurface;
      let currentCeiling = contactCeiling;
      let grounded = kind === 'floor';
      if (grounded) {
        target.endGroundedFraction = contactFraction;
        target.endImpactVelocity = incomingVelocity;
      }
      let maximumCorrection = target.penetration;
      const remainingFraction = Math.max(0, 1 - contactFraction);
      const remainingDistance = Math.abs(distanceDelta) * remainingFraction;
      const remainingDuration = duration * remainingFraction;
      const routeStepCount = Math.ceil(
        remainingDistance / SWEPT_VERTICAL_CONTACT_CONTRACT.maximumAdaptiveRouteProbeStepM
      );
      const timeStepCount = Math.ceil(
        remainingDuration / SWEPT_VERTICAL_CONTACT_CONTRACT.maximumTimeStepSeconds
      );
      const stepCount = Math.max(0, routeStepCount, timeStepCount);
      if (!Number.isSafeInteger(stepCount)) {
        publishEndState(
          currentAltitude,
          currentVelocity,
          currentSurface,
          currentCeiling,
          grounded
        );
        return;
      }

      for (let stepIndex = 1; stepIndex <= stepCount; stepIndex++) {
        const fraction = contactFraction + remainingFraction * stepIndex / stepCount;
        sampleAtFraction(fraction, remainderProfile);
        if (!Number.isFinite(remainderProfile.surface)) break;

        const stepDuration = duration * (fraction - currentFraction);
        const unconstrainedAltitude = altitudeAtFraction(fraction);
        maximumCorrection = Math.max(
          maximumCorrection,
          remainderProfile.surface + bottomOffset - unconstrainedAltitude,
          Number.isFinite(remainderProfile.ceiling)
            ? unconstrainedAltitude + topOffset - remainderProfile.ceiling
            : 0
        );
        const floorRate = stepDuration > EPSILON
          ? (remainderProfile.surface - currentSurface) / stepDuration
          : 0;
        if (grounded) {
          currentAltitude = remainderProfile.surface + bottomOffset;
          currentVelocity = floorRate;
        } else {
          let predictedAltitude = currentAltitude + currentVelocity * stepDuration
            - 0.5 * gravity * stepDuration * stepDuration;
          let predictedVelocity = currentVelocity - gravity * stepDuration;
          const ceilingRate = stepDuration > EPSILON
            && Number.isFinite(currentCeiling)
            && Number.isFinite(remainderProfile.ceiling)
            ? (remainderProfile.ceiling - currentCeiling) / stepDuration
            : 0;
          const ceilingAltitude = remainderProfile.ceiling - topOffset;
          const ceilingOverlap = predictedAltitude - ceilingAltitude;
          if (
            Number.isFinite(remainderProfile.ceiling)
            && (
              ceilingOverlap > EPSILON
              || (
                Math.abs(ceilingOverlap) <= EPSILON
                && predictedVelocity > ceilingRate + EPSILON
              )
            )
          ) {
            maximumCorrection = Math.max(maximumCorrection, Math.max(0, ceilingOverlap));
            predictedAltitude = ceilingAltitude;
            predictedVelocity = Math.min(-0.1, predictedVelocity);
          }

          const floorAltitude = remainderProfile.surface + bottomOffset;
          const floorOverlap = floorAltitude - predictedAltitude;
          if (
            floorOverlap > EPSILON
            || (
              Math.abs(floorOverlap) <= EPSILON
              && predictedVelocity <= floorRate + EPSILON
            )
          ) {
            maximumCorrection = Math.max(maximumCorrection, Math.max(0, floorOverlap));
            target.endGroundedFraction = fraction;
            target.endImpactVelocity = predictedVelocity;
            predictedAltitude = floorAltitude;
            predictedVelocity = floorRate;
            grounded = true;
          }
          currentAltitude = predictedAltitude;
          currentVelocity = predictedVelocity;
        }

        currentFraction = fraction;
        currentSurface = remainderProfile.surface;
        currentCeiling = remainderProfile.ceiling;
      }

      target.overshoot = Math.max(target.overshoot, maximumCorrection);
      publishEndState(
        currentAltitude,
        currentVelocity,
        currentSurface,
        currentCeiling,
        grounded
      );
    };

    const publishContact = (
      kind,
      fraction,
      interpolatedSurface,
      interpolatedCeiling
    ) => {
      const contactFraction = clamp(fraction, 0, 1);
      sampleAtFraction(contactFraction, contactProfile);
      const surface = Number.isFinite(contactProfile.surface)
        ? contactProfile.surface
        : interpolatedSurface;
      const ceiling = Number.isFinite(contactProfile.ceiling)
        ? contactProfile.ceiling
        : interpolatedCeiling;
      const rawAltitude = altitudeAtFraction(contactFraction);
      const boundaryAltitude = kind === 'ceiling'
        ? ceiling - topOffset
        : surface + bottomOffset;
      const rawPenetration = kind === 'ceiling'
        ? rawAltitude + topOffset - ceiling
        : surface + bottomOffset - rawAltitude;
      const rawOvershoot = kind === 'ceiling'
        ? finalAltitude - boundaryAltitude
        : boundaryAltitude - finalAltitude;
      target.hit = true;
      target.kind = kind;
      target.fraction = contactFraction;
      target.time = duration * contactFraction;
      target.altitude = boundaryAltitude;
      target.velocity = velocityAtFraction(contactFraction);
      target.surface = surface;
      target.ceiling = ceiling;
      target.sampleCount = sampleCount;
      target.penetration = Math.max(0, rawPenetration);
      target.overshoot = Math.max(0, rawOvershoot);
      resolveRemainingState(
        kind,
        contactFraction,
        boundaryAltitude,
        target.velocity,
        surface,
        ceiling
      );
      return target;
    };

    const startAltitudeValue = startAltitude;
    const startCeilingClearance = startProfile.ceiling - startAltitudeValue - topOffset;
    const startFloorClearance = startAltitudeValue - bottomOffset - startProfile.surface;
    if (Number.isFinite(startProfile.ceiling) && startCeilingClearance < -EPSILON) {
      return publishContact('ceiling', 0, startProfile.surface, startProfile.ceiling);
    }
    if (startFloorClearance < -EPSILON) {
      return publishContact('floor', 0, startProfile.surface, startProfile.ceiling);
    }
    if (duration <= EPSILON) {
      if (Number.isFinite(startProfile.ceiling) && Math.abs(startCeilingClearance) <= EPSILON) {
        return publishContact('ceiling', 0, startProfile.surface, startProfile.ceiling);
      }
      if (Math.abs(startFloorClearance) <= EPSILON) {
        return publishContact('floor', 0, startProfile.surface, startProfile.ceiling);
      }
      target.fraction = 1;
      target.time = duration;
      target.altitude = finalAltitude;
      target.velocity = finalVelocity;
      target.surface = startProfile.surface;
      target.ceiling = startProfile.ceiling;
      publishEndState(
        finalAltitude,
        finalVelocity,
        startProfile.surface,
        startProfile.ceiling,
        false
      );
      return target;
    }

    const routeStepCount = Math.ceil(
      Math.abs(distanceDelta) / SWEPT_VERTICAL_CONTACT_CONTRACT.maximumAdaptiveRouteProbeStepM
    );
    const timeStepCount = Math.ceil(
      duration / SWEPT_VERTICAL_CONTACT_CONTRACT.maximumTimeStepSeconds
    );
    const stepCount = Math.max(1, routeStepCount, timeStepCount);
    // Unrepresentable partition counts are invalid input rather than permission to enter a non-terminating loop.
    if (!Number.isSafeInteger(stepCount)) return target;
    let previousFraction = 0;
    let previousSurface = startProfile.surface;
    let previousCeiling = startProfile.ceiling;

    // Locate the finite side of an open/covered transition. Keeping the returned sample inside the ceiling span
    // makes an already-overlapping ship contact the exact portal/underpass entry instead of one route sample late.
    const refineFiniteCeilingBoundary = (
      outsideFraction,
      insideFraction,
      insideSurface,
      insideCeiling
    ) => {
      let openFraction = outsideFraction;
      let coveredFraction = insideFraction;
      boundaryProfile.surface = insideSurface;
      boundaryProfile.ceiling = insideCeiling;
      for (let refinement = 0; refinement < 36; refinement++) {
        const midpoint = (openFraction + coveredFraction) * 0.5;
        sampleAtFraction(midpoint, contactProfile);
        if (Number.isFinite(contactProfile.ceiling)) {
          coveredFraction = midpoint;
          boundaryProfile.surface = contactProfile.surface;
          boundaryProfile.ceiling = contactProfile.ceiling;
        } else {
          openFraction = midpoint;
        }
      }
      boundaryProfile.fraction = coveredFraction;
      return boundaryProfile;
    };

    const profileTouchesTrajectory = (kind, fraction, profile) => {
      if (!Number.isFinite(profile.surface)) return false;
      const altitude = altitudeAtFraction(fraction);
      if (kind === 'ceiling') {
        return Number.isFinite(profile.ceiling)
          && altitude + topOffset >= profile.ceiling - EPSILON;
      }
      return altitude - bottomOffset <= profile.surface + EPSILON;
    };

    /**
     * Refine against the sampler's actual collision predicate, not its linearly interpolated height.
     *
     * Finite-to-finite deck steps are discontinuities even though both endpoint values are numbers. A quadratic
     * estimate can therefore land on the safe side of the step; bisection returns the first sampled hit-side point
     * so the published boundary always belongs to the deck that was actually entered.
     */
    const refineActualContact = (
      kind,
      safeFraction,
      estimatedFraction,
      intervalEndFraction
    ) => {
      let safe = clamp(safeFraction, 0, 1);
      let hit = clamp(estimatedFraction, safe, intervalEndFraction);
      sampleAtFraction(hit, predicateProfile);
      if (!profileTouchesTrajectory(kind, hit, predicateProfile)) {
        safe = hit;
        hit = clamp(intervalEndFraction, safe, 1);
        sampleAtFraction(hit, predicateProfile);
        if (!profileTouchesTrajectory(kind, hit, predicateProfile)) {
          return Number.POSITIVE_INFINITY;
        }
      }

      for (let refinement = 0; refinement < 36; refinement++) {
        const midpoint = (safe + hit) * 0.5;
        sampleAtFraction(midpoint, predicateProfile);
        if (profileTouchesTrajectory(kind, midpoint, predicateProfile)) {
          hit = midpoint;
        } else {
          safe = midpoint;
        }
      }
      return hit;
    };

    for (let stepIndex = 1; stepIndex <= stepCount; stepIndex++) {
      const currentFraction = stepIndex / stepCount;
      sampleAtFraction(currentFraction, endProfile);
      if (!Number.isFinite(endProfile.surface)) {
        target.sampleCount = sampleCount;
        return target;
      }
      const intervalFraction = currentFraction - previousFraction;
      const intervalDuration = duration * intervalFraction;
      const intervalStartAltitude = altitudeAtFraction(previousFraction);
      const intervalStartVelocity = velocityAtFraction(previousFraction);
      const floorRate = (endProfile.surface - previousSurface) / intervalDuration;
      const floorTime = firstNonPositiveQuadraticTime(
        -0.5 * gravity,
        intervalStartVelocity - floorRate,
        intervalStartAltitude - bottomOffset - previousSurface,
        intervalDuration
      );
      let floorFraction = Number.POSITIVE_INFINITY;
      if (Number.isFinite(floorTime)) {
        floorFraction = refineActualContact(
          'floor',
          previousFraction,
          previousFraction + floorTime / duration,
          currentFraction
        );
      }

      let ceilingFraction = Number.POSITIVE_INFINITY;
      let ceilingSurface = Number.NaN;
      let ceilingHeight = Number.POSITIVE_INFINITY;
      const previousCeilingFinite = Number.isFinite(previousCeiling);
      const currentCeilingFinite = Number.isFinite(endProfile.ceiling);
      if (previousCeilingFinite || currentCeilingFinite) {
        let coveredStartFraction = previousFraction;
        let coveredEndFraction = currentFraction;
        let coveredStartSurface = previousSurface;
        let coveredEndSurface = endProfile.surface;
        let coveredStartCeiling = previousCeiling;
        let coveredEndCeiling = endProfile.ceiling;
        if (!previousCeilingFinite) {
          const boundary = refineFiniteCeilingBoundary(
            previousFraction,
            currentFraction,
            endProfile.surface,
            endProfile.ceiling
          );
          coveredStartFraction = boundary.fraction;
          coveredStartSurface = boundary.surface;
          coveredStartCeiling = boundary.ceiling;
        } else if (!currentCeilingFinite) {
          const boundary = refineFiniteCeilingBoundary(
            currentFraction,
            previousFraction,
            previousSurface,
            previousCeiling
          );
          coveredEndFraction = boundary.fraction;
          coveredEndSurface = boundary.surface;
          coveredEndCeiling = boundary.ceiling;
        }

        const coveredDuration = duration * (coveredEndFraction - coveredStartFraction);
        if (coveredDuration >= -EPSILON) {
          const coveredStartAltitude = altitudeAtFraction(coveredStartFraction);
          const coveredStartVelocity = velocityAtFraction(coveredStartFraction);
          const ceilingRate = coveredDuration > EPSILON
            ? (coveredEndCeiling - coveredStartCeiling) / coveredDuration
            : 0;
          const localCeilingTime = firstNonPositiveQuadraticTime(
            0.5 * gravity,
            ceilingRate - coveredStartVelocity,
            coveredStartCeiling - coveredStartAltitude - topOffset,
            Math.max(0, coveredDuration)
          );
          if (Number.isFinite(localCeilingTime)) {
            const estimatedCeilingFraction = coveredStartFraction + localCeilingTime / duration;
            ceilingFraction = refineActualContact(
              'ceiling',
              previousFraction,
              estimatedCeilingFraction,
              currentFraction
            );
            const coveredMix = coveredDuration > EPSILON ? localCeilingTime / coveredDuration : 0;
            ceilingSurface = coveredStartSurface
              + (coveredEndSurface - coveredStartSurface) * coveredMix;
            ceilingHeight = coveredStartCeiling
              + (coveredEndCeiling - coveredStartCeiling) * coveredMix;
          }
        }
      }

      if (
        Number.isFinite(ceilingFraction)
        && (!Number.isFinite(floorFraction) || ceilingFraction <= floorFraction + EPSILON)
      ) {
        return publishContact('ceiling', ceilingFraction, ceilingSurface, ceilingHeight);
      }
      if (Number.isFinite(floorFraction)) {
        const floorMix = (floorFraction - previousFraction) / intervalFraction;
        const surface = previousSurface + (endProfile.surface - previousSurface) * floorMix;
        const ceiling = previousCeilingFinite && currentCeilingFinite
          ? previousCeiling + (endProfile.ceiling - previousCeiling) * floorMix
          : Number.POSITIVE_INFINITY;
        return publishContact('floor', floorFraction, surface, ceiling);
      }

      previousFraction = currentFraction;
      previousSurface = endProfile.surface;
      previousCeiling = endProfile.ceiling;
    }

    target.fraction = 1;
    target.time = duration;
    target.altitude = finalAltitude;
    target.velocity = finalVelocity;
    target.surface = endProfile.surface;
    target.ceiling = endProfile.ceiling;
    publishEndState(
      finalAltitude,
      finalVelocity,
      endProfile.surface,
      endProfile.ceiling,
      false
    );
    return target;
  }

  /** Order equal-time contacts by semantic kind and stable logical ID. */
  function compareSweptContactOrder(
    leftEntryTime,
    leftKindOrder,
    leftStableId,
    rightEntryTime,
    rightKindOrder,
    rightStableId
  ) {
    if (leftEntryTime < rightEntryTime - EPSILON) return -1;
    if (leftEntryTime > rightEntryTime + EPSILON) return 1;
    if (leftKindOrder !== rightKindOrder) return leftKindOrder < rightKindOrder ? -1 : 1;
    if (leftStableId === rightStableId) return 0;
    return leftStableId < rightStableId ? -1 : 1;
  }

  /**
   * Preserve negative timer overshoot and report every due event with a bounded catch-up guard.
   * The timer and cooldown use the same scaled-clock units.
   */
  function consumeCooldown(timer, elapsedScaled, cooldown, maxEvents = DEFAULT_MAX_CATCH_UP_EVENTS) {
    const interval = Math.max(EPSILON, Number(cooldown) || 0);
    const eventLimit = Math.max(1, Math.floor(Number(maxEvents) || DEFAULT_MAX_CATCH_UP_EVENTS));
    let nextTimer = (Number(timer) || 0) - Math.max(0, Number(elapsedScaled) || 0);
    let eventCount = 0;
    while (nextTimer <= 0 && eventCount < eventLimit) {
      nextTimer += interval;
      eventCount++;
    }
    const limited = nextTimer <= 0;
    if (limited) {
      // Retain a bounded negative remainder instead of letting a long stall create an unbounded future loop.
      nextTimer = Math.max(nextTimer, -interval);
    }
    return Object.freeze({ timer: nextTimer, eventCount, limited });
  }

  /**
   * Merge several scaled cooldown channels into one wall-time event sequence without allocating per frame.
   * Channel array order is the deterministic tie-break contract. Each mutable channel record owns
   * `{timer, scale, cooldown, eventCount, limited}`; `eventOrder` receives channel indexes in due-time order.
   */
  function consumeCooldownTimeline(
    channels,
    elapsedSeconds,
    eventOrder,
    maxEventsPerChannel = DEFAULT_MAX_CATCH_UP_EVENTS
  ) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const eventLimit = Math.max(
      1,
      Math.floor(Number(maxEventsPerChannel) || DEFAULT_MAX_CATCH_UP_EVENTS)
    );
    const channelCount = Math.max(0, Number(channels?.length) || 0);
    const outputCapacity = Math.max(0, Number(eventOrder?.length) || 0);
    let remaining = elapsed;
    let outputCount = 0;

    for (let index = 0; index < channelCount; index++) {
      const channel = channels[index];
      channel.timer = Number(channel.timer) || 0;
      channel.scale = Math.max(0, Number(channel.scale) || 0);
      channel.cooldown = Math.max(EPSILON, Number(channel.cooldown) || 0);
      channel.eventCount = 0;
      channel.limited = false;
    }

    while (outputCount < outputCapacity) {
      let nextChannelIndex = -1;
      let nextDelaySeconds = Number.POSITIVE_INFINITY;
      for (let index = 0; index < channelCount; index++) {
        const channel = channels[index];
        if (channel.eventCount >= eventLimit || channel.scale <= EPSILON) continue;
        const delaySeconds = Math.max(0, channel.timer) / channel.scale;
        // Retaining the first channel on an epsilon tie makes obstacle -> traffic -> pickup ordering explicit.
        if (delaySeconds < nextDelaySeconds - EPSILON) {
          nextChannelIndex = index;
          nextDelaySeconds = delaySeconds;
        }
      }
      if (nextChannelIndex < 0 || nextDelaySeconds > remaining + EPSILON) break;

      const advanceSeconds = Math.min(remaining, Math.max(0, nextDelaySeconds));
      if (advanceSeconds > 0) {
        for (let index = 0; index < channelCount; index++) {
          channels[index].timer -= advanceSeconds * channels[index].scale;
        }
        remaining -= advanceSeconds;
      }

      const dueChannel = channels[nextChannelIndex];
      dueChannel.timer += dueChannel.cooldown;
      dueChannel.eventCount++;
      eventOrder[outputCount++] = nextChannelIndex;
    }

    if (remaining > 0) {
      for (let index = 0; index < channelCount; index++) {
        channels[index].timer -= remaining * channels[index].scale;
      }
    }
    for (let index = 0; index < channelCount; index++) {
      const channel = channels[index];
      if (channel.timer <= 0 && (channel.eventCount >= eventLimit || outputCount >= outputCapacity)) {
        channel.limited = true;
        // A stall may retain one bounded interval of debt, but it cannot create an unbounded future loop.
        channel.timer = Math.max(channel.timer, -channel.cooldown);
      }
    }
    return outputCount;
  }

  /** Resolve one validated gear without allowing malformed diagnostics to select an unbounded thrust profile. */
  function resolveDriveGearContract(gear) {
    const requested = Math.trunc(Number(gear));
    return DRIVE_GEAR_CONTRACT.gears[requested]
      || DRIVE_GEAR_CONTRACT.gears[DRIVE_GEAR_CONTRACT.defaultGear];
  }

  /** Normalize a transmission authority value without coupling it to automatic steering or throttle state. */
  function resolveDriveTransmissionMode(mode, fallbackMode = DRIVE_TRANSMISSION_CONTRACT.defaultMode) {
    const fallback = String(fallbackMode || '').trim().toLowerCase();
    const normalizedFallback = DRIVE_TRANSMISSION_CONTRACT.modes.includes(fallback)
      ? fallback
      : DRIVE_TRANSMISSION_CONTRACT.defaultMode;
    const requested = String(mode || '').trim().toLowerCase();
    return DRIVE_TRANSMISSION_CONTRACT.modes.includes(requested)
      ? requested
      : normalizedFallback;
  }

  /**
   * Resolve usable drive torque and mechanical RPM coupling at one speed. First gear covers rest; taller stages
   * fall below their useful RPM range as road speed drops. The linear coupling follows the engaged driveline,
   * while its square models the faster torque collapse near stall: gear 2 reaches zero at 35km/h and gear 3 at
   * 90km/h, while both recover full authority at their published 70/140km/h working minima. This changes
   * delivered thrust and loaded core RPM, never authoritative speed or the dry equilibria.
   */
  function resolveDriveGearTorqueAvailability(gear, speedMps, target = {}) {
    const resolvedGear = resolveDriveGearContract(gear);
    const speed = Math.max(0, Number.isFinite(Number(speedMps)) ? Number(speedMps) : 0);
    const workingMinimumSpeedMps = resolvedGear.minimumSpeedMps;
    const stallSpeedMps = resolvedGear.stallSpeedMps;
    let speedCouplingNormalized = 1;
    if (workingMinimumSpeedMps > stallSpeedMps + EPSILON) {
      speedCouplingNormalized = clamp(
        (speed - stallSpeedMps) / (workingMinimumSpeedMps - stallSpeedMps),
        0,
        1
      );
    }
    const availability = speedCouplingNormalized * speedCouplingNormalized;
    let recommendedRecoveryGear = resolvedGear.id;
    while (
      recommendedRecoveryGear > DRIVE_GEAR_CONTRACT.minimumGear
      && speed + EPSILON
        < DRIVE_GEAR_CONTRACT.gears[recommendedRecoveryGear].minimumSpeedMps
    ) {
      recommendedRecoveryGear--;
    }
    target.gear = resolvedGear.id;
    target.speedMps = speed;
    target.stallSpeedMps = stallSpeedMps;
    target.workingMinimumSpeedMps = workingMinimumSpeedMps;
    target.speedCouplingNormalized = speedCouplingNormalized;
    target.torqueAvailability = availability;
    target.luggingSeverity = 1 - availability;
    target.stalled = availability <= EPSILON;
    target.lugging = availability < 1 - EPSILON;
    target.inWorkingRange = availability >= 1 - EPSILON;
    target.recommendedRecoveryGear = recommendedRecoveryGear;
    target.recoveryShiftCount = resolvedGear.id - recommendedRecoveryGear;
    return target;
  }

  /**
   * Resolve the automatic road-gear request from one immutable state packet. Each adjacent pair has its own
   * 20km/h hysteresis band: 1→2 / 2→1 use 90 / 70km/h, while 2→3 / 3→2 use 140 / 120km/h. Manual mode and an
   * active shift always hold the current gear.
   */
  function resolveAutomaticDriveGearDecision(input, target = {}) {
    const currentGear = resolveDriveGearContract(input?.currentGear).id;
    const requestedSpeedMps = Number(input?.speedMps);
    const speedMps = Math.max(0, Number.isFinite(requestedSpeedMps) ? requestedSpeedMps : 0);
    const transmissionMode = resolveDriveTransmissionMode(input?.transmissionMode);
    const shiftInProgress = Boolean(input?.shiftInProgress);
    let requestedGear = null;
    let reason = 'within-hysteresis';
    if (transmissionMode !== DRIVE_TRANSMISSION_CONTRACT.automaticMode) {
      reason = 'manual-mode';
    } else if (shiftInProgress) {
      reason = 'shift-in-progress';
    } else if (
      currentGear < DRIVE_GEAR_CONTRACT.automaticMinimumGear
      || currentGear > DRIVE_GEAR_CONTRACT.automaticMaximumGear
    ) {
      reason = 'outside-automatic-range';
    } else if (
      Number.isFinite(DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear[currentGear])
      && speedMps + EPSILON
        >= DRIVE_GEAR_CONTRACT.automaticUpshiftSpeedMpsByGear[currentGear]
    ) {
      requestedGear = currentGear + 1;
      reason = 'upshift-threshold';
    } else if (
      Number.isFinite(DRIVE_GEAR_CONTRACT.automaticDownshiftSpeedMpsByGear[currentGear])
      && speedMps
        <= DRIVE_GEAR_CONTRACT.automaticDownshiftSpeedMpsByGear[currentGear] + EPSILON
    ) {
      requestedGear = currentGear - 1;
      reason = 'downshift-threshold';
    }
    target.transmissionMode = transmissionMode;
    target.currentGear = currentGear;
    target.speedMps = speedMps;
    target.shiftInProgress = shiftInProgress;
    target.requestedGear = requestedGear;
    target.shouldShift = requestedGear !== null;
    target.direction = requestedGear === null ? 0 : Math.sign(requestedGear - currentGear);
    target.reason = reason;
    return target;
  }

  /**
   * Validate one adjacent shift without mutating speed. Upshifts reject an under-speed target gear; downshifts
   * reject an over-rev entry. Player authority owns manual mode, schedule authority owns automatic mode, and the
   * automatic schedule can select every published stage. The legacy throttle flag is only a mode fallback.
   */
  function resolveDriveGearShiftRequest(input, target = {}) {
    const current = resolveDriveGearContract(input?.currentGear).id;
    const requestedValue = Math.trunc(Number(input?.requestedGear));
    const requested = DRIVE_GEAR_CONTRACT.gears[requestedValue] || null;
    const requestedSpeedMps = Number(input?.speedMps);
    const speedMps = Math.max(0, Number.isFinite(requestedSpeedMps) ? requestedSpeedMps : 0);
    const transmissionMode = resolveDriveTransmissionMode(
      input?.transmissionMode,
      input?.automaticThrottleEnabled
        ? DRIVE_TRANSMISSION_CONTRACT.automaticMode
        : DRIVE_TRANSMISSION_CONTRACT.manualMode
    );
    const requestAuthority = input?.requestAuthority === 'automatic' ? 'automatic' : 'player';
    let rejectionReason = null;
    if (!requested || Math.abs(requestedValue - current) !== 1) rejectionReason = 'invalid-gear';
    else if (input?.shiftInProgress) rejectionReason = 'shift-in-progress';
    else if (
      transmissionMode === DRIVE_TRANSMISSION_CONTRACT.automaticMode
      && requestAuthority !== 'automatic'
    ) {
      rejectionReason = 'automatic';
    } else if (
      transmissionMode === DRIVE_TRANSMISSION_CONTRACT.manualMode
      && requestAuthority === 'automatic'
    ) {
      rejectionReason = 'manual';
    } else if (
      requestAuthority === 'automatic'
      && requestedValue > DRIVE_GEAR_CONTRACT.automaticMaximumGear
    ) {
      rejectionReason = 'automatic';
    } else if (requestedValue > current && speedMps + EPSILON < requested.minimumSpeedMps) {
      rejectionReason = 'underspeed';
    } else if (requestedValue < current && speedMps > requested.maximumSafeDownshiftSpeedMps + EPSILON) {
      rejectionReason = 'overspeed';
    }
    target.accepted = rejectionReason === null;
    target.currentGear = current;
    target.requestedGear = requestedValue;
    target.speedMps = speedMps;
    target.transmissionMode = transmissionMode;
    target.requestAuthority = requestAuthority;
    target.rejectionReason = rejectionReason;
    target.shiftTorqueCutSeconds = target.accepted ? DRIVE_GEAR_CONTRACT.shiftTorqueCutSeconds : 0;
    return target;
  }

  /**
   * Resolve the small first-gear idle load without inventing a speed floor. Below the dry equilibrium, available
   * torque eases from a launch value into the exact resistance-balancing value; above it, smooth falloff lets real
   * drag take over. Runtime must opt in only while grounded, but brake/shift/gear/pedal gates are repeated here so
   * no caller can accidentally make idle creep survive a disconnected driveline.
   */
  function resolveIdleCreepThrustNormalized(input, target = {}) {
    const speedMps = Math.max(0, Number(input?.speedMps) || 0);
    const throttleCommand = clamp(Number(input?.throttleCommand) || 0, 0, 1);
    const gear = resolveDriveGearContract(input?.gear);
    const enabled = input?.idleCreepEnabled === true;
    const connected = enabled
      && input?.grounded !== false
      && gear.id === IDLE_CREEP_CONTRACT.driveGear
      && !Boolean(input?.braking ?? input?.brake)
      && !Boolean(input?.shifting)
      && throttleCommand <= EPSILON;
    let thrustNormalized = 0;
    if (connected && speedMps < IDLE_CREEP_CONTRACT.fadeOutSpeedMps) {
      if (speedMps <= IDLE_CREEP_CONTRACT.targetSpeedMps) {
        const progress = clamp(speedMps / IDLE_CREEP_CONTRACT.targetSpeedMps, 0, 1);
        const launchBlend = (1 - progress) * (1 - progress);
        thrustNormalized = IDLE_CREEP_CONTRACT.equilibriumThrustNormalized
          + (
            IDLE_CREEP_CONTRACT.launchThrustNormalized
              - IDLE_CREEP_CONTRACT.equilibriumThrustNormalized
          ) * launchBlend;
      } else {
        const fadeProgress = clamp(
          (speedMps - IDLE_CREEP_CONTRACT.targetSpeedMps)
            / (IDLE_CREEP_CONTRACT.fadeOutSpeedMps - IDLE_CREEP_CONTRACT.targetSpeedMps),
          0,
          1
        );
        const smoothFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
        thrustNormalized = IDLE_CREEP_CONTRACT.equilibriumThrustNormalized * (1 - smoothFade);
      }
    }
    target.enabled = enabled;
    target.connected = connected;
    target.active = thrustNormalized > EPSILON;
    target.gear = gear.id;
    target.speedMps = speedMps;
    target.targetSpeedMps = IDLE_CREEP_CONTRACT.targetSpeedMps;
    target.fadeOutSpeedMps = IDLE_CREEP_CONTRACT.fadeOutSpeedMps;
    target.thrustNormalized = thrustNormalized;
    return target;
  }

  const idleCreepStepScratch = {};

  /**
   * Resolve one propulsion interval from throttle, gear, and shift state to core speed, thrust, and acceleration.
   * `averageThrustNormalized` and `averageAccelerationMps2` are the authoritative interval integrals for physics;
   * the non-average values describe the end-of-step state for HUD, audio, exhaust, and the next simulation step.
   * Braking, throttle release, or the 300ms shift interruption cuts pedal-requested thrust immediately while the
   * rotor follows its analytic response. A separately published first-gear idle load may remain at zero pedal;
   * it is disconnected by braking, shifting, airborne motion, or a taller gear. When the
   * caller supplies authoritative `speedMps`, taller gears also apply the shared low-speed lug/stall torque curve
   * and its linear loaded-RPM coupling. The thrust spool still follows the pedal independently, preventing the
   * RPM correction from multiplying the existing torque loss twice.
   */
  function resolvePropulsionCoreStep(input, dt, target = {}) {
    const rawSpool = Number.isFinite(Number(input?.currentSpool))
      ? Number(input.currentSpool)
      : Number(input?.spool);
    const currentSpool = clamp(Number.isFinite(rawSpool) ? rawSpool : 0, 0, 1);
    const rawThrottle = Number.isFinite(Number(input?.throttleCommand))
      ? Number(input.throttleCommand)
      : Number(input?.throttle);
    const throttleCommand = clamp(Number.isFinite(rawThrottle) ? rawThrottle : 0, 0, 1);
    const braking = Boolean(input?.braking ?? input?.brake);
    const numericElapsed = Number(dt);
    const elapsed = Number.isFinite(numericElapsed) ? Math.max(0, numericElapsed) : 0;
    const requestedTorqueCutSeconds = Number(input?.shiftTorqueCutSeconds);
    const torqueCutSeconds = braking ? 0 : clamp(
      Number.isFinite(requestedTorqueCutSeconds)
        ? requestedTorqueCutSeconds
        : input?.shifting ? elapsed : 0,
      0,
      elapsed
    );
    const poweredSeconds = Math.max(0, elapsed - torqueCutSeconds);
    const shifting = Boolean(input?.shifting) || torqueCutSeconds > EPSILON;
    const gear = resolveDriveGearContract(input?.gear);
    const requestedSpeedMps = Number(input?.speedMps);
    const speedProvided = Number.isFinite(requestedSpeedMps);
    const propulsionSpeedMps = speedProvided
      ? Math.max(0, requestedSpeedMps)
      : gear.minimumSpeedMps;
    const gearTorque = resolveDriveGearTorqueAvailability(gear.id, propulsionSpeedMps, target);
    // Omitted speed preserves old non-vehicle callers such as isolated spool/audio probes. Production longitudinal
    // authority is contractually required (and runtime-tested) to provide speed before using delivered acceleration.
    const gearTorqueAvailability = speedProvided ? gearTorque.torqueAvailability : 1;
    idleCreepStepScratch.idleCreepEnabled = input?.idleCreepEnabled === true;
    idleCreepStepScratch.grounded = input?.grounded !== false;
    idleCreepStepScratch.braking = braking;
    // A shift may end partway through a catch-up slice. Its cut owns only `torqueCutSeconds`; the endpoint and
    // remaining interval are allowed to reconnect instead of losing one refresh-rate-dependent frame of creep.
    idleCreepStepScratch.shifting = shifting && poweredSeconds <= EPSILON;
    idleCreepStepScratch.throttleCommand = throttleCommand;
    idleCreepStepScratch.gear = gear.id;
    idleCreepStepScratch.speedMps = propulsionSpeedMps;
    const idleCreep = resolveIdleCreepThrustNormalized(
      idleCreepStepScratch,
      idleCreepStepScratch
    );
    const targetSpool = braking || (shifting && poweredSeconds <= EPSILON) ? 0 : throttleCommand;
    // Runtime passes the cached candle profile. Clamp it here as a second authority boundary so diagnostics or a
    // malformed caller cannot exceed the published growth ceiling or weaken the zero-candle baseline.
    const requestedMaximumRpm = Number(input?.maximumRpm);
    const maximumRpm = Number.isFinite(requestedMaximumRpm)
      ? clamp(
          requestedMaximumRpm,
          PROPULSION_CORE_CONTRACT.maximumRpm,
          PROPULSION_CORE_CONTRACT.maximumUpgradedRpm
        )
      : PROPULSION_CORE_CONTRACT.maximumRpm;
    const requestedSpoolUpRate = Number(input?.spoolUpRatePerSecond);
    const spoolUpRatePerSecond = Number.isFinite(requestedSpoolUpRate)
      ? clamp(
          requestedSpoolUpRate,
          PROPULSION_CORE_CONTRACT.spoolUpRatePerSecond,
          PROPULSION_CORE_CONTRACT.maximumUpgradedSpoolUpRatePerSecond
        )
      : PROPULSION_CORE_CONTRACT.spoolUpRatePerSecond;
    const rpmRange = maximumRpm - PROPULSION_CORE_CONTRACT.idleRpm;
    const requestedCurrentRpm = Number(input?.currentRpm);
    // Thrust spool remains continuous independently from the rotor. When a pickup expands the RPM range, derive
    // the rotor's new normalized position from its physical RPM so the cap change cannot teleport it upward.
    const currentRpmSpool = Number.isFinite(requestedCurrentRpm)
      ? clamp(
          (requestedCurrentRpm - PROPULSION_CORE_CONTRACT.idleRpm) / rpmRange,
          0,
          1
        )
      : currentSpool;
    let phaseNext = 0;
    let phaseAverage = 0;
    let phaseRate = 0;
    // `expm1` retains the interval integral for tiny server-test and high-refresh slices.
    const advanceResponse = (initialValue, destination, duration) => {
      phaseRate = destination > initialValue
        ? spoolUpRatePerSecond
        : PROPULSION_CORE_CONTRACT.spoolDownRatePerSecond;
      const responseDuration = phaseRate * duration;
      const remainingResponse = Math.exp(-responseDuration);
      phaseNext = clamp(
        destination + (initialValue - destination) * remainingResponse,
        0,
        1
      );
      const responseIntegral = responseDuration > EPSILON
        ? -Math.expm1(-responseDuration) / responseDuration
        : 1;
      phaseAverage = clamp(
        destination + (initialValue - destination) * responseIntegral,
        0,
        1
      );
    };

    let spoolAfterCut = currentSpool;
    let rpmSpoolAfterCut = currentRpmSpool;
    let spoolIntegral = 0;
    let rpmSpoolIntegral = 0;
    if (torqueCutSeconds > EPSILON) {
      advanceResponse(currentSpool, 0, torqueCutSeconds);
      spoolAfterCut = phaseNext;
      spoolIntegral += phaseAverage * torqueCutSeconds;
      advanceResponse(currentRpmSpool, 0, torqueCutSeconds);
      rpmSpoolAfterCut = phaseNext;
      rpmSpoolIntegral += phaseAverage * torqueCutSeconds;
    }

    let nextSpool = spoolAfterCut;
    let nextRpmSpool = rpmSpoolAfterCut;
    let poweredAverageSpool = spoolAfterCut;
    let poweredAverageRpmSpool = rpmSpoolAfterCut;
    const poweredTargetSpool = braking ? 0 : throttleCommand;
    const gearRpmCouplingNormalized = speedProvided
      ? gearTorque.speedCouplingNormalized
      : 1;
    const poweredTargetRpmSpool = braking
      ? 0
      : throttleCommand * gearRpmCouplingNormalized;
    if (poweredSeconds > EPSILON) {
      advanceResponse(spoolAfterCut, poweredTargetSpool, poweredSeconds);
      nextSpool = phaseNext;
      poweredAverageSpool = phaseAverage;
      spoolIntegral += phaseAverage * poweredSeconds;
      advanceResponse(rpmSpoolAfterCut, poweredTargetRpmSpool, poweredSeconds);
      nextRpmSpool = phaseNext;
      poweredAverageRpmSpool = phaseAverage;
      rpmSpoolIntegral += phaseAverage * poweredSeconds;
    }
    const responseRate = phaseRate;
    const averageSpool = elapsed > EPSILON ? spoolIntegral / elapsed : currentSpool;
    const averageRpmSpool = elapsed > EPSILON ? rpmSpoolIntegral / elapsed : currentRpmSpool;
    // The rotor may keep spinning after the pedal is released, but delivered forward thrust cannot exceed the
    // current pedal command. `min` preserves spool-up lag while making every downward command effective at once.
    const commandedThrustNormalized = braking || poweredSeconds <= EPSILON
      ? 0
      : Math.min(nextSpool, throttleCommand);
    const poweredAverageCommandedThrust = braking
      ? 0
      : Math.min(poweredAverageSpool, throttleCommand);
    const averageCommandedThrustNormalized = elapsed > EPSILON
      ? poweredAverageCommandedThrust * poweredSeconds / elapsed
      : commandedThrustNormalized;
    const idleCreepThrustNormalized = idleCreep.thrustNormalized * gearTorqueAvailability;
    const idleCreepIntervalFraction = elapsed > EPSILON ? poweredSeconds / elapsed : 1;
    const averageIdleCreepThrustNormalized = idleCreepThrustNormalized
      * idleCreepIntervalFraction;
    const thrustNormalized = clamp(
      commandedThrustNormalized * gearTorqueAvailability + idleCreepThrustNormalized,
      0,
      1
    );
    const averageThrustNormalized = clamp(
      averageCommandedThrustNormalized * gearTorqueAvailability
        + averageIdleCreepThrustNormalized,
      0,
      1
    );

    target.throttleCommand = throttleCommand;
    target.braking = braking;
    target.shifting = shifting;
    target.shiftTorqueCutSeconds = torqueCutSeconds;
    target.gear = gear.id;
    target.speedMps = propulsionSpeedMps;
    target.speedProvided = speedProvided;
    target.gearEquilibriumSpeedMps = gear.equilibriumSpeedMps;
    target.fullThrustAccelerationMps2 = gear.fullThrustAccelerationMps2;
    target.availableFullThrustAccelerationMps2 = gear.fullThrustAccelerationMps2
      * gearTorqueAvailability;
    target.gearTorqueAvailability = gearTorqueAvailability;
    target.gearStalled = speedProvided && gearTorque.stalled;
    target.gearLugging = speedProvided && gearTorque.lugging;
    target.gearLuggingSeverity = speedProvided ? gearTorque.luggingSeverity : 0;
    target.gearRpmCouplingNormalized = gearRpmCouplingNormalized;
    target.recommendedRecoveryGear = gearTorque.recommendedRecoveryGear;
    target.recoveryShiftCount = gearTorque.recoveryShiftCount;
    target.targetSpool = targetSpool;
    target.targetRpmSpool = poweredTargetRpmSpool;
    target.nextSpool = nextSpool;
    target.averageSpool = averageSpool;
    target.nextRpmSpool = nextRpmSpool;
    target.averageRpmSpool = averageRpmSpool;
    target.maximumRpm = maximumRpm;
    target.spoolUpRatePerSecond = spoolUpRatePerSecond;
    target.rpm = PROPULSION_CORE_CONTRACT.idleRpm + rpmRange * nextRpmSpool;
    target.averageRpm = PROPULSION_CORE_CONTRACT.idleRpm + rpmRange * averageRpmSpool;
    target.commandedThrustNormalized = commandedThrustNormalized;
    target.averageCommandedThrustNormalized = averageCommandedThrustNormalized;
    target.idleCreepEnabled = idleCreep.enabled;
    target.idleCreepConnected = idleCreep.connected;
    target.idleCreepActive = idleCreep.active;
    target.idleCreepThrustNormalized = idleCreepThrustNormalized;
    target.averageIdleCreepThrustNormalized = averageIdleCreepThrustNormalized;
    target.idleCreepIntervalFraction = idleCreepIntervalFraction;
    target.thrustNormalized = thrustNormalized;
    target.averageThrustNormalized = averageThrustNormalized;
    target.accelerationMps2 = thrustNormalized
      * gear.fullThrustAccelerationMps2;
    target.averageAccelerationMps2 = averageThrustNormalized
      * gear.fullThrustAccelerationMps2;
    return target;
  }

  /** Resolve the dry passive load at one non-negative speed without mutating the caller's output object. */
  function resolveLongitudinalResistance(speedMps, grounded = true, target = {}) {
    const speed = Math.max(0, Number.isFinite(Number(speedMps)) ? Number(speedMps) : 0);
    const rollingResistanceMps2 = grounded && speed > LONGITUDINAL_DYNAMICS_CONTRACT.stopSpeedThresholdMps
      ? LONGITUDINAL_DYNAMICS_CONTRACT.rollingResistanceMps2
      : 0;
    const linearDragMps2 = speed * LONGITUDINAL_DYNAMICS_CONTRACT.linearDragPerSecond;
    const aerodynamicDragMps2 = speed * speed
      * LONGITUDINAL_DYNAMICS_CONTRACT.aerodynamicDragPerMeter;
    target.speedMps = speed;
    target.grounded = Boolean(grounded);
    target.rollingResistanceMps2 = rollingResistanceMps2;
    target.linearDragMps2 = linearDragMps2;
    target.aerodynamicDragMps2 = aerodynamicDragMps2;
    target.totalResistanceMps2 = rollingResistanceMps2 + linearDragMps2 + aerodynamicDragMps2;
    return target;
  }

  /**
   * Integrate `dv/dt = A - Bv - Cv²` exactly for one interval of constant delivered force.
   * Reaching zero is absorbing while net force is non-positive, which prevents numerical creep or reversal.
   */
  function integrateLongitudinalSpeed(initialSpeedMps, constantAccelerationMps2, elapsedSeconds) {
    const initialSpeed = Math.max(0, Number(initialSpeedMps) || 0);
    const acceleration = Number(constantAccelerationMps2) || 0;
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    if (elapsed <= EPSILON) return initialSpeed;

    const linear = LONGITUDINAL_DYNAMICS_CONTRACT.linearDragPerSecond;
    const quadratic = LONGITUDINAL_DYNAMICS_CONTRACT.aerodynamicDragPerMeter;
    if (initialSpeed <= LONGITUDINAL_DYNAMICS_CONTRACT.stopSpeedThresholdMps && acceleration <= 0) return 0;

    const discriminant = linear * linear + 4 * quadratic * acceleration;
    let nextSpeed;
    if (discriminant > EPSILON) {
      const rootSpan = Math.sqrt(discriminant);
      const upperRoot = (-linear + rootSpan) / (2 * quadratic);
      const lowerRoot = (-linear - rootSpan) / (2 * quadratic);
      const initialRatio = (initialSpeed - upperRoot) / (initialSpeed - lowerRoot);
      const nextRatio = initialRatio * Math.exp(-rootSpan * elapsed);
      const denominator = 1 - nextRatio;
      nextSpeed = Math.abs(denominator) > EPSILON
        ? (upperRoot - nextRatio * lowerRoot) / denominator
        : upperRoot;
    } else if (discriminant < -EPSILON) {
      const imaginarySpan = Math.sqrt(-discriminant);
      const offset = linear / (2 * quadratic);
      const radius = imaginarySpan / (2 * quadratic);
      const initialAngle = Math.atan((initialSpeed + offset) / radius);
      const stopAngle = Math.atan(offset / radius);
      const nextAngle = initialAngle - imaginarySpan * elapsed * 0.5;
      nextSpeed = nextAngle <= stopAngle
        ? 0
        : radius * Math.tan(nextAngle) - offset;
    } else {
      const offset = linear / (2 * quadratic);
      const shiftedInitial = initialSpeed + offset;
      const shiftedNext = shiftedInitial / (1 + quadratic * shiftedInitial * elapsed);
      nextSpeed = shiftedNext - offset;
    }
    if (
      !Number.isFinite(nextSpeed)
      || nextSpeed <= 0
      || (
        nextSpeed <= LONGITUDINAL_DYNAMICS_CONTRACT.stopSpeedThresholdMps
        && acceleration <= 0
      )
    ) {
      return 0;
    }
    return Math.max(0, nextSpeed);
  }

  /**
   * Resolve one authoritative speed interval from propulsion, braking, surface load, and passive resistance.
   * The returned resistance components are interval-average accounting values; their sum plus the published net
   * acceleration exactly reconciles the speed endpoints even when the interval reaches the zero-speed boundary.
   */
  function resolveLongitudinalDynamicsStep(input, dt, target = {}) {
    const initialSpeedMps = Math.max(0, Number(input?.speedMps ?? input?.speed) || 0);
    const propulsionAccelerationMps2 = Math.max(
      0,
      Number(input?.propulsionAccelerationMps2 ?? input?.driveAccelerationMps2) || 0
    );
    const brakeDecelerationMps2 = Math.max(0, Number(input?.brakeDecelerationMps2) || 0);
    const surfaceDecelerationMps2 = Math.max(0, Number(input?.surfaceDecelerationMps2) || 0);
    const grounded = input?.grounded !== false;
    const surfaceGrade = grounded && Number.isFinite(Number(input?.surfaceGrade))
      ? Number(input.surfaceGrade)
      : 0;
    // Grade is rise/run along the active route; positive values are uphill and consume forward acceleration.
    const gradeAccelerationMps2 = LONGITUDINAL_DYNAMICS_CONTRACT.longitudinalGravityMps2
      * surfaceGrade / Math.hypot(1, surfaceGrade);
    const elapsedSeconds = Math.max(0, Number(dt) || 0);
    const rollingResistanceMps2 = grounded
      && (
        initialSpeedMps > LONGITUDINAL_DYNAMICS_CONTRACT.stopSpeedThresholdMps
        || propulsionAccelerationMps2 - gradeAccelerationMps2
          > LONGITUDINAL_DYNAMICS_CONTRACT.rollingResistanceMps2
      )
      ? LONGITUDINAL_DYNAMICS_CONTRACT.rollingResistanceMps2
      : 0;
    const constantAccelerationMps2 = propulsionAccelerationMps2
      - brakeDecelerationMps2
      - surfaceDecelerationMps2
      - gradeAccelerationMps2
      - rollingResistanceMps2;
    const nextSpeedMps = integrateLongitudinalSpeed(
      initialSpeedMps,
      constantAccelerationMps2,
      elapsedSeconds
    );
    const netAccelerationMps2 = elapsedSeconds > EPSILON
      ? (nextSpeedMps - initialSpeedMps) / elapsedSeconds
      : 0;
    const requestedAppliedAccelerationMps2 = propulsionAccelerationMps2
      - brakeDecelerationMps2
      - surfaceDecelerationMps2
      - gradeAccelerationMps2;
    // When the zero-speed boundary absorbs the remainder of an interval, brakes/grade/surface forces stop doing
    // longitudinal work at rest. Scale only that diagnostic interval so its components reconcile the unchanged
    // endpoint speed; this never feeds back into the analytic speed or stopping-distance calculation above.
    const forceApplicationFraction = nextSpeedMps === 0
      && requestedAppliedAccelerationMps2 < netAccelerationMps2 - EPSILON
      ? clamp(netAccelerationMps2 / requestedAppliedAccelerationMps2, 0, 1)
      : 1;
    const appliedPropulsionAccelerationMps2 = propulsionAccelerationMps2 * forceApplicationFraction;
    const appliedBrakeDecelerationMps2 = brakeDecelerationMps2 * forceApplicationFraction;
    const appliedSurfaceDecelerationMps2 = surfaceDecelerationMps2 * forceApplicationFraction;
    const appliedGradeAccelerationMps2 = gradeAccelerationMps2 * forceApplicationFraction;
    const passiveResistanceMps2 = Math.max(
      0,
      appliedPropulsionAccelerationMps2
        - appliedBrakeDecelerationMps2
        - appliedSurfaceDecelerationMps2
        - appliedGradeAccelerationMps2
        - netAccelerationMps2
    );
    const initialResistance = resolveLongitudinalResistance(initialSpeedMps, grounded, {});
    const nextResistance = resolveLongitudinalResistance(nextSpeedMps, grounded, {});
    const nonlinearResistanceMps2 = Math.max(0, passiveResistanceMps2 - rollingResistanceMps2);
    const nonlinearEndpointSum = initialResistance.linearDragMps2
      + initialResistance.aerodynamicDragMps2
      + nextResistance.linearDragMps2
      + nextResistance.aerodynamicDragMps2;
    const initialNonlinearResistance = initialResistance.linearDragMps2
      + initialResistance.aerodynamicDragMps2;
    const linearShare = nonlinearEndpointSum > EPSILON
      ? (initialResistance.linearDragMps2 + nextResistance.linearDragMps2) / nonlinearEndpointSum
      : initialNonlinearResistance > EPSILON
        ? initialResistance.linearDragMps2 / initialNonlinearResistance
        : 0;

    target.initialSpeedMps = initialSpeedMps;
    target.nextSpeedMps = nextSpeedMps;
    target.propulsionAccelerationMps2 = appliedPropulsionAccelerationMps2;
    target.brakeDecelerationMps2 = appliedBrakeDecelerationMps2;
    target.surfaceDecelerationMps2 = appliedSurfaceDecelerationMps2;
    target.surfaceGrade = surfaceGrade;
    target.gradeAccelerationMps2 = appliedGradeAccelerationMps2;
    target.forceApplicationFraction = forceApplicationFraction;
    target.rollingResistanceMps2 = Math.min(passiveResistanceMps2, rollingResistanceMps2);
    target.linearDragMps2 = nonlinearResistanceMps2 * linearShare;
    target.aerodynamicDragMps2 = nonlinearResistanceMps2 * (1 - linearShare);
    target.passiveResistanceMps2 = passiveResistanceMps2;
    target.netAccelerationMps2 = netAccelerationMps2;
    target.grounded = grounded;
    target.stopped = nextSpeedMps === 0;
    return target;
  }

  /** Hold the published dry cruise target using the currently engaged gear's actual available thrust. */
  function resolveAutomaticThrottleCommand(
    speedMps,
    targetSpeedMps,
    grounded = true,
    surfaceGrade = 0,
    gear = DRIVE_GEAR_CONTRACT.automaticCruiseGear
  ) {
    const speed = Math.max(0, Number(speedMps) || 0);
    const requestedTarget = Number(targetSpeedMps);
    const targetSpeed = Number.isFinite(requestedTarget)
      ? Math.max(0, requestedTarget)
      : LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps;
    if (targetSpeed <= LONGITUDINAL_DYNAMICS_CONTRACT.stopSpeedThresholdMps) return 0;
    const targetResistance = resolveLongitudinalResistance(targetSpeed, grounded, {});
    const numericSurfaceGrade = grounded && Number.isFinite(Number(surfaceGrade))
      ? Number(surfaceGrade)
      : 0;
    const gradeAccelerationMps2 = LONGITUDINAL_DYNAMICS_CONTRACT.longitudinalGravityMps2
      * numericSurfaceGrade / Math.hypot(1, numericSurfaceGrade);
    const feedForward = (targetResistance.totalResistanceMps2 + gradeAccelerationMps2)
      / resolveDriveGearContract(gear).fullThrustAccelerationMps2;
    const correction = (targetSpeed - speed)
      * LONGITUDINAL_DYNAMICS_CONTRACT.automaticThrottleProportionalGainPerMps;
    return clamp(feedForward + correction, 0, 1);
  }

  /** Resolve the post-impact longitudinal speed without letting an ordinary collision add kinetic energy. */
  function resolveImpactSpeed(speedMps, source = 'obstacle', motionKind = 'static') {
    const speed = Math.max(0, Number(speedMps) || 0);
    const retention = source === 'guardrail'
      ? LONGITUDINAL_DYNAMICS_CONTRACT.impactSpeedRetention.guardrail
      : motionKind && motionKind !== 'static'
        ? LONGITUDINAL_DYNAMICS_CONTRACT.impactSpeedRetention.movingObstacle
        : LONGITUDINAL_DYNAMICS_CONTRACT.impactSpeedRetention.staticObstacle;
    return speed * retention;
  }

  /**
   * Advance the shared manual/autopilot steering actuator and return its exact interval average.
   * Opposite input uses the reverse rate only while cancelling the current side; any remaining interval then uses
   * the normal engagement rate. Integrating both pieces here prevents a frame boundary from changing turn impulse.
   */
  function advanceSteeringActuator(current, command, dt, target = {}) {
    const initial = clamp(
      Number.isFinite(Number(current)) ? Number(current) : 0,
      STEERING_ACTUATOR_CONTRACT.minimumCommand,
      STEERING_ACTUATOR_CONTRACT.maximumCommand
    );
    const requested = clamp(
      Number.isFinite(Number(command)) ? Number(command) : 0,
      STEERING_ACTUATOR_CONTRACT.minimumCommand,
      STEERING_ACTUATOR_CONTRACT.maximumCommand
    );
    const numericElapsed = Number(dt);
    const elapsed = Number.isFinite(numericElapsed) ? Math.max(0, numericElapsed) : 0;
    let remaining = elapsed;
    let value = initial;
    let integral = 0;
    let phase = 'hold';
    let ratePerSecond = 0;

    const advanceToward = (destination, rate, phaseName) => {
      if (remaining <= EPSILON || Math.abs(destination - value) <= EPSILON) {
        value = destination;
        return;
      }
      phase = phaseName;
      ratePerSecond = rate;
      const durationToTarget = Math.abs(destination - value) / rate;
      const activeDuration = Math.min(remaining, durationToTarget);
      const next = value + Math.sign(destination - value) * rate * activeDuration;
      integral += (value + next) * 0.5 * activeDuration;
      value = activeDuration >= durationToTarget - EPSILON ? destination : next;
      remaining -= activeDuration;
    };

    if (elapsed > EPSILON && Math.abs(requested - initial) > EPSILON) {
      if (initial * requested < 0) {
        advanceToward(0, STEERING_ACTUATOR_CONTRACT.reverseRatePerSecond, 'reverse');
      }
      if (remaining > EPSILON && Math.abs(requested - value) > EPSILON) {
        const reducingMagnitude = requested === 0
          || (value * requested > 0 && Math.abs(requested) < Math.abs(value));
        advanceToward(
          requested,
          reducingMagnitude
            ? STEERING_ACTUATOR_CONTRACT.centerRatePerSecond
            : STEERING_ACTUATOR_CONTRACT.engageRatePerSecond,
          reducingMagnitude ? 'center' : 'engage'
        );
      }
    }
    if (remaining > 0) integral += value * remaining;

    target.command = requested;
    target.nextActuator = clamp(
      value,
      STEERING_ACTUATOR_CONTRACT.minimumCommand,
      STEERING_ACTUATOR_CONTRACT.maximumCommand
    );
    target.averageActuator = elapsed > EPSILON ? integral / elapsed : initial;
    target.ratePerSecond = ratePerSecond;
    target.phase = phase;
    return target;
  }

  /**
   * Integrate authoritative metres from the two speed endpoints of one gameplay slice.
   * Runtime must use this exact trapezoid once per slice so HUD km/h, route progress, collisions, and score cannot
   * diverge under acceleration or render-cadence changes.
   */
  function integrateLongitudinalDistance(previousSpeedMps, nextSpeedMps, elapsedSeconds) {
    const previousSpeed = Number(previousSpeedMps);
    const nextSpeed = Number(nextSpeedMps);
    const elapsed = Number(elapsedSeconds);
    if (![previousSpeed, nextSpeed, elapsed].every(Number.isFinite)) {
      throw new TypeError('Longitudinal distance integration requires finite speeds and elapsed time');
    }
    if (previousSpeed < 0 || nextSpeed < 0 || elapsed < 0) {
      throw new RangeError('Longitudinal distance integration requires non-negative inputs');
    }
    return (previousSpeed + nextSpeed) * 0.5 * elapsed;
  }

  /**
   * Preserve every finite visible wall-clock interval while bounding each individual gameplay step.
   * Page hiding and explicit pause are lifecycle boundaries owned by runtime; a visible low-FPS frame must never
   * discard metres while the speedometer continues to show the authoritative speed.
   */
  function consumeBoundedElapsedTime(
    elapsedSeconds,
    onStep,
    context = null,
    maximumStepSeconds = DEFAULT_MAX_RENDER_STEP_SECONDS
  ) {
    if (typeof onStep !== 'function') throw new TypeError('A bounded elapsed-time consumer requires onStep');
    const maximumStep = Math.max(EPSILON, Number(maximumStepSeconds) || DEFAULT_MAX_RENDER_STEP_SECONDS);
    const numericElapsed = Number(elapsedSeconds);
    const acceptedElapsed = Number.isFinite(numericElapsed) ? Math.max(0, numericElapsed) : 0;
    let consumed = 0;
    while (consumed < acceptedElapsed - EPSILON) {
      const step = Math.min(maximumStep, acceptedElapsed - consumed);
      consumed += step;
      onStep(step, context, consumed);
    }
    return acceptedElapsed;
  }

  /** Advance the sole ordinary-damage protection timer without wall-clock, pause, or rendering ownership. */
  function advanceDamageInvulnerability(remainingSeconds, activeGameplaySeconds) {
    const remaining = Number(remainingSeconds);
    const elapsed = Number(activeGameplaySeconds);
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new RangeError('Damage invulnerability remaining time must be finite and non-negative');
    }
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new RangeError('Damage invulnerability elapsed time must be finite and non-negative');
    }
    const nextRemaining = Math.max(0, remaining - elapsed);
    // Cadence subdivision can leave a sub-nanosecond IEEE-754 residue at the exact contract boundary.
    // Canonicalizing only that residue prevents an accidental extra protected gameplay step.
    return nextRemaining <= 0.000_000_001 ? 0 : nextRemaining;
  }

  /** Accept ordinary damage only after the gameplay timer expires and before this render frame charges a life. */
  function canAcceptOrdinaryDamage(remainingSeconds, acceptedThisRenderFrame) {
    const remaining = Number(remainingSeconds);
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new RangeError('Damage invulnerability remaining time must be finite and non-negative');
    }
    return remaining === 0 && acceptedThisRenderFrame !== true;
  }

  /**
   * Partition a render interval onto one persistent fixed simulation lattice.
   * `valueIntegral` carries the exact trapezoidal integral across render boundaries, so the value supplied to each
   * completed step is independent of how that same linear frame history was partitioned by the renderer.
   */
  function consumeFixedSimulationSteps(
    clock,
    elapsedSeconds,
    frameStartValue,
    frameEndValue,
    fixedStepSeconds,
    onStep,
    maxSteps = DEFAULT_MAX_FIXED_STEPS
  ) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const step = Math.max(EPSILON, Number(fixedStepSeconds) || 0);
    const limit = Math.max(1, Math.floor(Number(maxSteps) || DEFAULT_MAX_FIXED_STEPS));
    const startValue = Number(frameStartValue) || 0;
    const endValue = Number(frameEndValue) || 0;
    clock.elapsed = clamp(Number(clock.elapsed) || 0, 0, step);
    clock.valueIntegral = Number(clock.valueIntegral) || 0;
    clock.limited = false;
    let cursor = 0;
    let completedSteps = 0;

    while (cursor < elapsed - EPSILON && completedSteps < limit) {
      const remainingFrame = elapsed - cursor;
      const remainingStep = Math.max(EPSILON, step - clock.elapsed);
      const slice = Math.min(remainingFrame, remainingStep);
      const fromT = elapsed > EPSILON ? cursor / elapsed : 0;
      const toT = elapsed > EPSILON ? (cursor + slice) / elapsed : 1;
      const fromValue = startValue + (endValue - startValue) * fromT;
      const toValue = startValue + (endValue - startValue) * toT;
      clock.valueIntegral += (fromValue + toValue) * 0.5 * slice;
      clock.elapsed += slice;
      cursor += slice;

      if (clock.elapsed >= step - EPSILON) {
        const averageValue = clock.valueIntegral / step;
        clock.elapsed = 0;
        clock.valueIntegral = 0;
        completedSteps++;
        onStep(step, averageValue, cursor);
      }
    }

    if (cursor < elapsed - EPSILON) {
      // Runtime subdivides accepted render time into at most 45ms calls, each below the default 120Hz-step guard.
      // Other callers get an explicit signal if their bounded loop drops an unexpected remainder.
      clock.limited = true;
    }
    return completedSteps;
  }

  /** Advance the same semi-implicit lateral step used by both portal prediction and player physics. */
  function integrateLateralStep(input, dt) {
    const elapsed = Math.max(0, Number(dt) || 0);
    const dragRate = Math.max(0, Number(input?.dragRate) || 0);
    const acceleration = (Number(input?.steer) || 0) * (Number(input?.steerAcceleration) || 0)
      + (Number(input?.outwardAcceleration) || 0);
    const maximumSpeed = Math.max(0, Number(input?.maximumSpeed) || 0);
    const velocity = clamp(
      (Number(input?.velocity) || 0) * Math.exp(-elapsed * dragRate) + acceleration * elapsed,
      -maximumSpeed,
      maximumSpeed
    );
    const minimum = Number.isFinite(input?.minimum) ? input.minimum : Number.NEGATIVE_INFINITY;
    const maximum = Number.isFinite(input?.maximum) ? input.maximum : Number.POSITIVE_INFINITY;
    const lateral = clamp((Number(input?.lateral) || 0) + velocity * elapsed, minimum, maximum);
    return Object.freeze({ lateral, velocity });
  }

  /**
   * Sample the production obstacle lane model. Drift owns a separate non-negative clock because the wave clock
   * intentionally starts before zero to make the spawn frame visually continuous.
   */
  function sampleObstacleLateral(input, timeAhead = 0) {
    const ahead = Math.max(0, Number(timeAhead) || 0);
    const waveTime = (Number(input?.motionTime) || 0) + ahead;
    const driftTime = Math.min(
      Math.max(0, Number(input?.driftDuration) || DEFAULT_DRIFT_DURATION_SECONDS),
      Math.max(0, Number(input?.driftTime) || 0) + ahead
    );
    const lateral = (Number(input?.baseLateral) || 0)
      + Math.sin(waveTime * (Number(input?.frequency) || 0) + (Number(input?.phase) || 0))
        * (Number(input?.amplitude) || 0)
      + (Number(input?.driftRate) || 0) * driftTime;
    const limit = Math.max(0, Number(input?.limit) || 0);
    return clamp(lateral, -limit, limit);
  }

  /**
   * Resolve longitudinal hazard travel against the route-cursor capability.
   * Graph RoutePosition is forward-only, while the legacy analytic route can represent signed travel.
   */
  function resolveObstacleLongitudinalStep(velocity, elapsedSeconds, forwardOnlyRoute) {
    const step = (Number(velocity) || 0) * Math.max(0, Number(elapsedSeconds) || 0);
    return forwardOnlyRoute ? Math.max(0, step) : step;
  }

  /** Count current-path traffic groups once, regardless of how many mirrored branch copies are resident. */
  function countReachableTrafficGroups(entities, isReachable, predicate = () => true) {
    const groups = new Set();
    for (const entity of entities || []) {
      if (!isReachable(entity) || !predicate(entity)) continue;
      groups.add(entity.trafficGroupId ?? entity);
    }
    return groups.size;
  }

  const api = Object.freeze({
    DEFAULT_MAX_CATCH_UP_EVENTS,
    DEFAULT_MAX_FIXED_STEPS,
    DEFAULT_MAX_RENDER_STEP_SECONDS,
    DEFAULT_DRIFT_DURATION_SECONDS,
    DRIVE_GEAR_CONTRACT,
    DRIVE_TRANSMISSION_CONTRACT,
    IDLE_CREEP_CONTRACT,
    PROPULSION_CORE_CONTRACT,
    LONGITUDINAL_DYNAMICS_CONTRACT,
    STEERING_ACTUATOR_CONTRACT,
    CANDLE_HANDLING_CONTRACT,
    DAMAGE_PROTECTION_CONTRACT,
    SWEPT_ELLIPSE_INTERVAL_CONTRACT,
    SWEPT_VERTICAL_CONTACT_CONTRACT,
    FLIGHT_RATING_CONTRACT,
    resolveFlightRating,
    resolveFlightRatingGrade,
    resolveDriveGearContract,
    resolveDriveTransmissionMode,
    resolveDriveGearTorqueAvailability,
    resolveAutomaticDriveGearDecision,
    resolveDriveGearShiftRequest,
    resolveIdleCreepThrustNormalized,
    resolvePropulsionCoreStep,
    resolveLongitudinalResistance,
    integrateLongitudinalSpeed,
    resolveLongitudinalDynamicsStep,
    resolveAutomaticThrottleCommand,
    resolveImpactSpeed,
    advanceSteeringActuator,
    resolveCandleHandling,
    sweptAxisInterval,
    sweptAabb,
    sweptAabbEntryTime,
    sweptAabbHit,
    sweptEllipseInterval,
    sweptVerticalContact,
    compareSweptContactOrder,
    consumeCooldown,
    consumeCooldownTimeline,
    integrateLongitudinalDistance,
    consumeBoundedElapsedTime,
    advanceDamageInvulnerability,
    canAcceptOrdinaryDamage,
    consumeFixedSimulationSteps,
    integrateLateralStep,
    sampleObstacleLateral,
    resolveObstacleLongitudinalStep,
    countReachableTrafficGroups
  });

  root.NeonGameplayCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
