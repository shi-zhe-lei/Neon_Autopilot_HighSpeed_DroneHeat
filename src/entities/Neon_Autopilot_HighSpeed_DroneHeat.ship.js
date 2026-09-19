/*
 * Neon watertight ship factory / Neon 闭合飞船工厂。
 * Main meshes are generated only through NeonModeling; effects are explicitly tagged and never join gameplay collision.
 */
window.NeonShip = (() => {
  'use strict';

  const turnThrustGain = 0.18;
  const PROPULSION_CONTRACT = Object.freeze({
    turnThrustGain,
    minimumTurnThrust: 1 - turnThrustGain,
    maximumTurnThrust: 1 + turnThrustGain,
    brakeNozzleCount: 2,
    brakeLayersPerNozzle: 3,
    brakeNozzleX: 0.62,
    brakeNozzleY: 0.61,
    brakeNozzleZ: 0.78,
    brakePlumeAnchorZ: 0.78,
    brakePlumeRootOffsetM: 0,
    brakePlumeLengthM: 0.65,
    // Optic flow stays absent near rest and saturates at the ordinary second-gear road envelope. The manual jump
    // stage may add real forward speed, but it cannot keep widening streaks and manufacture exaggerated velocity.
    speedStreakStartKmh: 70,
    speedStreakFullKmh: 160,
    speedStreakLoopSpanM: 44,
    speedStreakExposureSeconds: 0.028,
    speedStreakMaximumLengthM: 10,
    coreIdleRpm: 1_800,
    coreRpmReference: 12_000,
    // Forward plume energy follows the hotter of delivered thrust and the authoritative energized rotor. The
    // latter already decays analytically at 1.8s⁻¹ after pedal release, so exhaust retains real core heat without
    // a renderer-owned throttle timer or any feedback into physics.
    exhaustEnergyModel: 'maximum-delivered-thrust-or-energized-core',
    exhaustReleaseAuthority: 'propulsion-core-spool',
    exhaustPresentationOnly: true
  });

  // Drivetrain load changes only the visible energy delivery. It cannot add thrust, alter collision, or move the
  // camera; reduced-motion retains the mean attenuation while omitting the low-frequency exhaust surge.
  const PROPULSION_LUGGING_PRESENTATION_CONTRACT = Object.freeze({
    maximumEnergizedSpoolReduction: 0.65,
    maximumPlumeLengthReduction: 0.42,
    maximumPlumeOpacityReduction: 0.52,
    flutterAngularRatePerMillisecond: 0.008_5,
    minimumFlutterScale: 0.86,
    maximumFlutterScale: 0.94,
    ringRateReduction: 0.48,
    presentationOnly: true,
    affectsPhysics: false,
    affectsCollision: false,
    affectsCamera: false
  });

  const CRUISE_DYNAMICS_CONTRACT = Object.freeze({
    minimumSpeedKmh: 20,
    baselineSpeedKmh: 120,
    fullSpeedKmh: 160,
    maximumShipLateralM: 0.10,
    maximumShipLiftM: 0.07,
    maximumShipYawRad: 0.020_944,
    maximumShipRollRad: 0.031_416,
    maximumShipPitchRad: 0.012_217,
    maximumCameraSideM: 0.14,
    maximumCameraHeightM: 0.06,
    maximumCameraLookSideM: 0.25,
    maximumCameraRollRad: 0.007_854
  });

  // Heat is a restrained gear-speed cue, not a second speedometer. First gear receives only a subtle tint, second
  // gear reaches the palette midpoint, and the automatic-capable performance/ramp third gear owns the full response.
  const SHIP_HEAT_PRESENTATION_CONTRACT = Object.freeze({
    minimumSpeedKmh: 0,
    firstGearReferenceSpeedKmh: 110,
    automaticCruiseSpeedKmh: 120,
    secondGearReferenceSpeedKmh: 160,
    thirdGearReferenceSpeedKmh: 280,
    automaticMinimumGear: 1,
    automaticMaximumGear: 3,
    automaticThirdGearEnabled: true,
    heatStartSpeedKmh: 80,
    heatMidpointSpeedKmh: 160,
    heatFullSpeedKmh: 280,
    heatMidpoint: 0.5,
    speedInputUnit: 'kilometers-per-hour',
    extremeHeatCurve: 'smoothed-heat-squared',
    presentationOnly: true
  });

  // Surface deformation reads one local-space authority: visual wings, wakes, and exhaust may never enlarge
  // collision or the belly-pressure sweep. The pressure extents deliberately derive from the fixed player AABB.
  const SURFACE_FOOTPRINT_CONTRACT = (() => {
    const colliderHalf = Object.freeze({ hx: 0.72, hy: 0.58, hz: 1.36 });
    const tailDownwashLocal = Object.freeze({
      left: Object.freeze({ x: -0.62, y: 0.61, z: 0.96 }),
      right: Object.freeze({ x: 0.62, y: 0.61, z: 0.96 })
    });
    return Object.freeze({
      colliderHalf,
      pressureHalfWidthM: colliderHalf.hx,
      pressureHalfLengthM: colliderHalf.hz,
      localForward: Object.freeze({ x: 0, y: 0, z: -1 }),
      // The sealed belly's axial midpoint and lowest authored underside form a stable pressure-projection origin.
      bellyCenterLocal: Object.freeze({ x: 0, y: 0.35, z: 0.14 }),
      // These points coincide with the visible side-pod centers so snow and water response follows authored thrust.
      tailDownwashLocal
    });
  })();

  // The art contract turns official Sky motifs into measurable constraints instead of decorating a modern fighter
  // with glow. The silhouette, cloth construction, face, and restrained relic detailing remain visual-only.
  const SKY_CAPE_ART_CONTRACT = Object.freeze({
    themeId: 'dawn-pilgrim-manta-reliquary-v2',
    healthySpanM: 5.24,
    minimumCapeLayersPerWing: 2,
    capeLobeCountPerWing: 5,
    capePleatCountPerWing: 3,
    spiritMaskEyeCount: 2,
    constellationNodeCount: 9,
    spiritWakeRibbonCount: 4,
    visibleMechanicalPanelCount: 0,
    visibleTurbineCount: 0,
    minimumQuietSurfaceRatio: 0.70,
    maximumCapeBreathRad: 0.020_944,
    healthyMirrorToleranceM: 0.000_001,
    healthyMirroredGlowPaths: true,
    extrudedMirrorWindingPreserved: true,
    roadProjectingLocalLightCount: 0,
    visualOnly: true
  });

  /*
   * Local assembly clearances stop presentation layers from intersecting one another while the smaller gameplay
   * collider stays unchanged. Plumes grow from the aperture plane in one direction; cloth roots sit outside both
   * the hull and fixed side-downwash pods, and the inset floats above the outer cape by an intentional air gap.
   */
  const SHIP_COMPONENT_CLEARANCE_CONTRACT = Object.freeze({
    version: 1,
    capeRootAbsXM: 0.80,
    hullHalfWidthAtCapeM: 0.52,
    sidePodOuterAbsXM: 0.76,
    minimumCapeRootGapM: 0.04,
    maximumCapeRootInwardTravelM: 0.018,
    minimumDynamicCapePodGapM: 0.022,
    outerCapeTopYM: 0.85,
    insetCapeBottomYM: 0.895,
    minimumCapeLayerGapM: 0.045,
    scarfInnerAbsXM: 0.62,
    mainNozzleRadiusM: 0.36,
    minimumScarfNozzleGapM: 0.26,
    mainPlumeRootZM: 1.20,
    sidePlumeRootZM: 1.12,
    brakePlumeRootZM: 0.78,
    plumeRootToleranceM: 0.000_001,
    rootAnchoredPlumes: true,
    effectsAffectCollision: false
  });

  /*
   * Covered-route clearance protects the complete healthy main visual, not only the deliberately smaller hazard
   * collider. The top envelope includes the widest cape corner after bounded tunnel roll/pitch; effects such as
   * exhaust and halos remain visual-only and may fade independently without changing routing or damage authority.
   */
  const COVERED_CLEARANCE_CONTRACT = Object.freeze({
    mainVisualHalfWidthM: 2.62,
    mainVisualForwardM: 1.18,
    mainVisualAftM: 1.78,
    mainVisualMinimumYM: 0.206_8,
    mainVisualMaximumYM: 1.77,
    maximumCoveredRollRad: 0.20,
    maximumCoveredPitchRad: 0.22,
    maximumCoveredTopOffsetM: 2.70,
    maximumCoveredHoverM: 0,
    protectsMainVisual: true,
    affectsHazardCollider: false
  });

  // Selective Bloom consumes this object-level whitelist; material luminance alone never grants eligibility,
  // so white hull paint, glass reflections, and the road cannot leak into the glow buffer.
  const selectiveBloomLayer = Number.isInteger(window.NeonPostProcessing?.BLOOM_LAYER)
    ? window.NeonPostProcessing.BLOOM_LAYER
    : 12;
  const SHIP_ULTRA_PRESENTATION_CONTRACT = Object.freeze({
    qualityId: 'high',
    bloomLayer: selectiveBloomLayer,
    bloomMarker: 'neonBloom',
    contactShadowTextureSize: 128,
    contactShadowAlphaGain: 4.4,
    localLightCount: 0,
    reversible: true,
    presentationOnly: true
  });

  // Runtime supplies only the authored diffuse floor already multiplied by portal enclosure. Direct fixture
  // peaks stay in the High light pool; this receiver calibration is applied once inside the standard PBR path.
  const TUNNEL_BOUNCE_CONTRACT = Object.freeze({
    version: 1,
    uniformName: 'neonShipTunnelBounce',
    receiverGain: 0.72,
    referenceAlbedo: 0.18,
    maximumIrradiance: 1,
    indirectDiffuseOnly: true,
    localLightCount: 0
  });

  // The invulnerability field is a readable Sky-themed ward, not a second collision body. Runtime owns the
  // authoritative timer; this contract only bounds a centre-clear shell, three star-orbit arcs, and five anchors.
  const INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT = Object.freeze({
    version: 2,
    themeId: 'dawn-starward',
    shellCount: 1,
    orbitArcCount: 3,
    anchorCount: 5,
    impactSettleSeconds: 0.18,
    expirationTailSeconds: 0.34,
    minimumFieldOpacity: 0.010,
    maximumFieldOpacity: 0.25,
    minimumScale: 0.985,
    maximumImpactScale: 1.075,
    roadProjectingLocalLightCount: 0,
    centreClear: true,
    fogUniformSource: 'THREE.UniformsLib.fog-clone',
    compileBeforeGameplay: true,
    reducedMotionStatic: true,
    visualOnly: true,
    affectsHazardCollider: false
  });
  const SHIP_BLOOM_EMITTER_PREFIXES = Object.freeze([
    'candle-soul-halo',
    'spirit-eye-',
    'hull-flow-',
    'spirit-scarf-seam-',
    'cape-edge-',
    'cape-rim-',
    'constellation-',
    'cape-rib-',
    'wingtip-light-',
    'damaged-cape-seam-',
    'side-core-',
    'side-flame-',
    'side-inner-flame-',
    'main-flame',
    'inner-flame',
    'thruster-ring-',
    'spirit-wake-',
    'brake-nozzle-',
    'brake-flare-',
    'brake-inner-flare-',
    'speed-streaks',
    'shield-orbit-',
    'shield-anchor-',
    'top-view-halo',
    'canopy-crack-',
    'wing-crack-',
    'damage-spark-'
  ]);

  /**
   * Derive a deterministic shield pose from the remaining authoritative gameplay time.
   * The reusable output keeps the render path allocation-free and cannot extend or consume invulnerability.
   */
  function deriveInvulnerabilityShieldPresentation(
    remainingSeconds,
    totalSeconds,
    impactFeedbackSeconds,
    reducedMotion = false,
    output = {}
  ) {
    const total = Math.max(0.001, Number(totalSeconds) || 0);
    const remaining = Math.max(0, Math.min(total, Number(remainingSeconds) || 0));
    const active = remaining > 0;
    const progress = active ? remaining / total : 0;
    const requestedImpactWindow = Number(impactFeedbackSeconds) || 0;
    const impactWindow = Math.max(
      0.001,
      Math.min(
        requestedImpactWindow > 0
          ? requestedImpactWindow
          : INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.impactSettleSeconds,
        INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.impactSettleSeconds
      )
    );
    const impactLinear = active
      ? 1 - Math.max(0, Math.min(1, (total - remaining) / impactWindow))
      : 0;
    const impact = impactLinear * impactLinear * (3 - 2 * impactLinear);
    const expiryLinear = active
      ? Math.max(
          0,
          Math.min(
            1,
            remaining / INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.expirationTailSeconds
          )
        )
      : 0;
    const expiry = expiryLinear * expiryLinear * (3 - 2 * expiryLinear);
    const opacityRange = INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.maximumFieldOpacity
      - INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.minimumFieldOpacity;
    output.active = active;
    output.progress = progress;
    output.impact = impact;
    output.expiry = expiry;
    output.fieldOpacity = active
      ? INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.minimumFieldOpacity
        + opacityRange * (0.70 * expiry + 0.30 * impact)
      : 0;
    output.orbitOpacity = active ? 0.018 + 0.38 * expiry + 0.20 * impact : 0;
    output.anchorOpacity = active ? 0.024 + 0.54 * expiry + 0.24 * impact : 0;
    output.scale = active
      ? INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.minimumScale
        + 0.015 * expiry
        + (INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.maximumImpactScale - 1) * impact
      : INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.minimumScale;
    output.warmBlend = active
      ? Math.max(0, Math.min(1, 0.24 + impact * 0.66 + (1 - expiry) * 0.10))
      : 0;
    output.orbitRate = reducedMotion ? 0 : 0.22 + progress * 0.12;
    output.reducedMotion = Boolean(reducedMotion);
    return output;
  }

  function isShipBloomEmitterName(name) {
    return SHIP_BLOOM_EMITTER_PREFIXES.some((prefix) => name.startsWith(prefix));
  }

  /** Mirror one extrusion profile without changing its front-face winding or mutating the authored outline. */
  function mirrorExtrudedOutline(side, outline) {
    const direction = side < 0 ? -1 : 1;
    const mirrored = outline.map(([x, y]) => [x * direction, y]);
    return direction < 0 ? mirrored.reverse() : mirrored;
  }

  function smoothStep01(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  /** Resolves the bounded, visual-only cape pulse; reduced-motion frames keep both wings at their authored rest pose. */
  function deriveCapeBreathRad(nowMs, heatInput, reducedMotion = false) {
    if (reducedMotion) return 0;
    const now = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    const heat = Number.isFinite(heatInput) ? Math.max(0, Math.min(1, heatInput)) : 0;
    return Math.sin(now * 0.001_9)
      * SKY_CAPE_ART_CONTRACT.maximumCapeBreathRad
      * (0.72 + heat * 0.28);
  }

  /**
   * Produces deterministic open-road motion without changing route position, collision, steering, or speed.
   * Curves, active lateral input, flight, and covered structures suppress the layer so authored road physics stay legible.
   */
  function deriveCruiseDynamics(elapsedSeconds, speedKmh, context = {}, output = {}) {
    const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    const speed = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
    const launchRange = Math.max(
      1,
      CRUISE_DYNAMICS_CONTRACT.baselineSpeedKmh - CRUISE_DYNAMICS_CONTRACT.minimumSpeedKmh
    );
    const highSpeedRange = Math.max(
      1,
      CRUISE_DYNAMICS_CONTRACT.fullSpeedKmh - CRUISE_DYNAMICS_CONTRACT.baselineSpeedKmh
    );
    const launchBlend = smoothStep01(
      (speed - CRUISE_DYNAMICS_CONTRACT.minimumSpeedKmh) / launchRange
    );
    const highSpeedBlend = smoothStep01(
      (speed - CRUISE_DYNAMICS_CONTRACT.baselineSpeedKmh) / highSpeedRange
    );
    const speedBlend = launchBlend * (0.32 + highSpeedBlend * 0.68);
    const steer = Math.abs(Number(context.steer) || 0);
    const lateralVelocity = Math.abs(Number(context.lateralVelocity) || 0);
    const curvature = Math.abs(Number(context.curvature) || 0);
    const enclosureBlend = Math.max(0, Math.min(1, Number(context.enclosureBlend) || 0));
    const inputSuppression = Math.max(0, Math.min(1, steer * 1.05 + lateralVelocity / 22));
    const curveSuppression = smoothStep01(curvature / 0.001_2);
    const groundedBlend = context.grounded === false ? 0 : 1;
    const reducedMotionBlend = context.reducedMotion === true ? 0 : 1;
    const activity = speedBlend
      * (1 - inputSuppression)
      * (1 - curveSuppression)
      * (1 - enclosureBlend)
      * groundedBlend
      * reducedMotionBlend;

    if (activity <= 0) {
      output.activity = 0;
      output.shipLateralM = 0;
      output.shipLiftM = 0;
      output.shipYawRad = 0;
      output.shipRollRad = 0;
      output.shipPitchRad = 0;
      output.cameraSideM = 0;
      output.cameraHeightM = 0;
      output.cameraLookSideM = 0;
      output.cameraRollRad = 0;
      return output;
    }

    // Incommensurate frequencies prevent the silhouette and camera from repeating as one mechanical bob.
    const slowWave = Math.sin(seconds * 1.17 + 0.42);
    const crossWave = Math.sin(seconds * 0.53 + 2.14);
    const liftWave = Math.sin(seconds * 1.83 + 1.08) * 0.62
      + Math.sin(seconds * 0.71 + 2.72) * 0.38;
    const yawWave = Math.sin(seconds * 0.91 + 1.66) * 0.70
      + Math.sin(seconds * 1.49 + 0.18) * 0.30;
    const rollWave = Math.sin(seconds * 1.07 + 2.48) * 0.66
      + Math.sin(seconds * 0.41 + 0.74) * 0.34;
    const pitchWave = Math.sin(seconds * 1.37 + 0.12) * 0.58
      + Math.sin(seconds * 0.63 + 2.30) * 0.42;

    output.activity = activity;
    output.shipLateralM = CRUISE_DYNAMICS_CONTRACT.maximumShipLateralM
      * activity * (slowWave * 0.72 + crossWave * 0.28);
    // Grounded cruise motion may add lift but never subtract the hull-to-road clearance budget.
    output.shipLiftM = CRUISE_DYNAMICS_CONTRACT.maximumShipLiftM
      * activity * (0.5 + liftWave * 0.5);
    output.shipYawRad = CRUISE_DYNAMICS_CONTRACT.maximumShipYawRad * activity * yawWave;
    output.shipRollRad = CRUISE_DYNAMICS_CONTRACT.maximumShipRollRad * activity * rollWave;
    output.shipPitchRad = CRUISE_DYNAMICS_CONTRACT.maximumShipPitchRad * activity * pitchWave;
    output.cameraSideM = CRUISE_DYNAMICS_CONTRACT.maximumCameraSideM
      * activity * (Math.sin(seconds * 0.73 + 3.28) * 0.68 + slowWave * 0.32);
    output.cameraHeightM = CRUISE_DYNAMICS_CONTRACT.maximumCameraHeightM
      * activity * Math.sin(seconds * 1.11 + 2.06);
    output.cameraLookSideM = CRUISE_DYNAMICS_CONTRACT.maximumCameraLookSideM
      * activity * (Math.sin(seconds * 0.61 + 4.02) * 0.76 + crossWave * 0.24);
    output.cameraRollRad = CRUISE_DYNAMICS_CONTRACT.maximumCameraRollRad
      * activity * Math.sin(seconds * 0.67 + 0.96);
    return output;
  }

  /** Resolve hull heat across the first/second/third-gear speed envelope without creating gameplay authority. */
  function deriveShipHeatTarget(speedKmh) {
    const speed = Number.isFinite(speedKmh)
      ? Math.max(SHIP_HEAT_PRESENTATION_CONTRACT.minimumSpeedKmh, speedKmh)
      : SHIP_HEAT_PRESENTATION_CONTRACT.minimumSpeedKmh;
    const lowerRangeKmh = Math.max(
      1,
      SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpointSpeedKmh
        - SHIP_HEAT_PRESENTATION_CONTRACT.heatStartSpeedKmh
    );
    const upperRangeKmh = Math.max(
      1,
      SHIP_HEAT_PRESENTATION_CONTRACT.heatFullSpeedKmh
        - SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpointSpeedKmh
    );
    const lowerLinear = Math.max(0, Math.min(
      1,
      (speed - SHIP_HEAT_PRESENTATION_CONTRACT.heatStartSpeedKmh) / lowerRangeKmh
    ));
    const upperLinear = Math.max(0, Math.min(
      1,
      (speed - SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpointSpeedKmh) / upperRangeKmh
    ));
    const lowerSmoothed = lowerLinear * lowerLinear * (3 - 2 * lowerLinear);
    const upperSmoothed = upperLinear * upperLinear * (3 - 2 * upperLinear);
    return speed <= SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpointSpeedKmh
      ? lowerSmoothed * SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpoint
      : SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpoint
        + upperSmoothed * (1 - SHIP_HEAT_PRESENTATION_CONTRACT.heatMidpoint);
  }

  /**
   * Resolves mirrored tail-thrust gains from the final steering input without touching gameplay authority.
   * Positive steering turns right, so the left tail plume becomes stronger; callers may reuse `output` per frame.
   */
  function deriveTurnThrustTargets(steerInput, output = {}) {
    const steer = Number.isFinite(steerInput) ? Math.max(-1, Math.min(1, steerInput)) : 0;
    output.leftThrust = 1 + steer * PROPULSION_CONTRACT.turnThrustGain;
    output.rightThrust = 1 - steer * PROPULSION_CONTRACT.turnThrustGain;
    return output;
  }

  /**
   * Maps authoritative propulsion state to presentation targets without inventing another throttle or steering lag.
   * The residual energized spool keeps hot exhaust from collapsing on the release frame while actual thrust remains
   * pedal-gated. Differential side thrust is symmetric around the physical forward-thrust mean, so steering cannot
   * add net power.
   */
  function derivePropulsionVisualTargets(input = {}, output = {}) {
    const coreSpool = Number.isFinite(input.coreSpool)
      ? Math.max(0, Math.min(1, input.coreSpool))
      : 0;
    const coreRpm = Number.isFinite(input.coreRpm) ? Math.max(0, input.coreRpm) : 0;
    const thrustNormalized = Number.isFinite(input.thrustNormalized)
      ? Math.max(0, Math.min(1, input.thrustNormalized))
      : 0;
    const steeringActuator = Number.isFinite(input.steeringActuator)
      ? Math.max(-1, Math.min(1, input.steeringActuator))
      : 0;
    const gearTorqueAvailability = Number.isFinite(input.gearTorqueAvailability)
      ? Math.max(0, Math.min(1, input.gearTorqueAvailability))
      : 1;
    const inferredLuggingSeverity = input.gearStalled
      ? 1
      : input.gearLugging ? 1 - gearTorqueAvailability : 0;
    const gearLuggingSeverity = Number.isFinite(input.gearLuggingSeverity)
      ? Math.max(0, Math.min(1, input.gearLuggingSeverity))
      : inferredLuggingSeverity;
    // Runtime publishes throttle-gated load. Missing load stays neutral so a warning-only or coasting caller cannot
    // manufacture exhaust struggle merely by publishing a tall-gear boolean.
    const gearLoadNormalized = Number.isFinite(input.gearLoadNormalized)
      ? Math.max(0, Math.min(1, input.gearLoadNormalized))
      : 0;
    const energizedSpool = coreSpool * (
      1 - gearLoadNormalized
        * PROPULSION_LUGGING_PRESENTATION_CONTRACT.maximumEnergizedSpoolReduction
    );
    const plumeLengthScale = 1 - gearLoadNormalized
      * PROPULSION_LUGGING_PRESENTATION_CONTRACT.maximumPlumeLengthReduction;
    const plumeOpacityScale = 1 - gearLoadNormalized
      * PROPULSION_LUGGING_PRESENTATION_CONTRACT.maximumPlumeOpacityReduction;
    const exhaustEnergyNormalized = Math.max(thrustNormalized, energizedSpool);

    output.coreSpool = coreSpool;
    output.coreRpm = coreRpm;
    output.thrustNormalized = thrustNormalized;
    output.steeringActuator = steeringActuator;
    output.gearTorqueAvailability = gearTorqueAvailability;
    output.gearLuggingSeverity = gearLuggingSeverity;
    output.gearLoadNormalized = gearLoadNormalized;
    output.energizedSpool = energizedSpool;
    output.exhaustEnergyNormalized = exhaustEnergyNormalized;
    output.plumeLengthScale = plumeLengthScale;
    output.plumeOpacityScale = plumeOpacityScale;
    output.luggingFlutterScale = 1;
    // Compatibility aliases remain read-only presentation values; they no longer smooth raw input demand.
    output.throttleBlend = thrustNormalized;
    output.steerBlend = steeringActuator;
    deriveTurnThrustTargets(steeringActuator, output);
    output.leftThrustNormalized = thrustNormalized * output.leftThrust;
    output.rightThrustNormalized = thrustNormalized * output.rightThrust;
    output.mainPlumeRadius = 0.92 + exhaustEnergyNormalized * 0.15;
    output.mainPlumeLength = (
      0.72 + exhaustEnergyNormalized * 1.06
    ) * plumeLengthScale;
    output.mainPlumeOpacity = (
      0.20 + exhaustEnergyNormalized * 0.48
    ) * plumeOpacityScale;
    output.innerPlumeRadius = 0.68 + exhaustEnergyNormalized * 0.09;
    output.innerPlumeLength = (
      0.52 + exhaustEnergyNormalized * 0.93
    ) * plumeLengthScale;
    output.innerPlumeOpacity = (
      0.12 + exhaustEnergyNormalized * 0.45
    ) * plumeOpacityScale;
    output.sidePlumeRadius = 0.86 + exhaustEnergyNormalized * 0.15;
    output.sidePlumeLength = (
      0.62 + exhaustEnergyNormalized * 0.88
    ) * plumeLengthScale;
    output.sidePlumeOpacity = (
      0.18 + exhaustEnergyNormalized * 0.51
    ) * plumeOpacityScale;
    output.rpmMix = Math.max(0, Math.min(
      1.25,
      coreRpm / PROPULSION_CONTRACT.coreRpmReference
    ));
    return output;
  }

  /**
   * Converts HUD-scale km/h into continuous, physically proportional optic-flow targets.
   * The travel rate converts back to metres per second only at the world-space integration boundary.
   */
  function deriveSpeedCueTargets(speedKmh, throttleInput, output = {}, reducedMotion = false) {
    const speed = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
    const throttle = Number.isFinite(throttleInput)
      ? Math.max(0, Math.min(1, throttleInput))
      : 0;
    if (reducedMotion) {
      output.streakIntensity = 0;
      output.streakTravelKmh = 0;
      output.streakTravelMetersPerSecond = 0;
      output.streakCyclesPerSecond = 0;
      output.streakLengthM = 0;
      return output;
    }
    const visibleRange = Math.max(
      1,
      PROPULSION_CONTRACT.speedStreakFullKmh - PROPULSION_CONTRACT.speedStreakStartKmh
    );
    const visibleRatio = Math.max(0, Math.min(
      1,
      (speed - PROPULSION_CONTRACT.speedStreakStartKmh) / visibleRange
    ));
    const easedVisibility = visibleRatio * visibleRatio * (3 - 2 * visibleRatio);
    const travelMetersPerSecond = speed / 3.6;
    output.streakIntensity = easedVisibility * (0.78 + throttle * 0.22);
    output.streakTravelKmh = speed;
    output.streakTravelMetersPerSecond = travelMetersPerSecond;
    output.streakCyclesPerSecond = travelMetersPerSecond / PROPULSION_CONTRACT.speedStreakLoopSpanM;
    output.streakLengthM = Math.min(
      PROPULSION_CONTRACT.speedStreakMaximumLengthM,
      0.75
        + travelMetersPerSecond * PROPULSION_CONTRACT.speedStreakExposureSeconds
        + throttle * 0.90
    );
    return output;
  }

  /**
   * Builds the visual ship and preserves the fixed player AABB plus every animation handle consumed by the main loop.
   * The caller-owned construction profile stays immutable when the player changes presentation-only render quality.
   * The three life forms swap sealed wing/fin meshes instead of scaling or exposing damaged cross-sections.
   */
  function createShip({
    THREE,
    scene,
    state,
    roadY,
    clamp,
    lerp,
    rand,
    quality,
    renderQualityId
  }) {
    if (!window.NeonModeling) throw new Error('Neon modeling module missing before ship factory');
    const modeling = window.NeonModeling;
    const launchParams = new URLSearchParams(window.location.search);
    const legacyQualityRequest = launchParams.get('quality');
    const constructionQualityRequest = legacyQualityRequest === 'high' || legacyQualityRequest === 'mobile'
      ? legacyQualityRequest
      : 'auto';
    const constructionQuality = quality && typeof quality === 'object'
      && (quality.id === 'high' || quality.id === 'mobile')
      ? quality
      : modeling.resolveQualityProfile(constructionQualityRequest);
    const radialSegments = Math.max(12, constructionQuality.radialSegments);
    const tubularSegments = Math.max(18, constructionQuality.tubularSegments);
    const bevelSegments = Math.max(1, constructionQuality.bevelSegments);
    // Ship detail owns an isolated visual stream so model construction never advances gameplay randomness.
    const visualRng = modeling.createRng(modeling.hashSeed(`ship:${launchParams.get('seed') || 'default'}`));
    const visualRand = (min, max) => visualRng.range(min, max);
    void rand;

    const player = new THREE.Group();
    player.name = 'Neon.WatertightShip';
    player.position.set(0, 0, 0);
    // YXZ keeps road-heading yaw outside local pitch/roll so grade and banking remain aligned on every compass heading.
    player.rotation.order = 'YXZ';
    scene.add(player);

    const tunnelBounceUniform = { value: new THREE.Vector3() };
    const tunnelBounceMaterials = new Set();
    let tunnelBounceValid = false;
    let tunnelBounceEnclosure = 0;
    let tunnelBounceIrradiance = 0;

    /** Consume one caller-owned probe without allocations; enclosure is diagnostic, never multiplied twice. */
    function setTunnelBounce(probe) {
      if (disposed) return false;
      const valid = probe?.valid === true
        && Number.isFinite(probe.enclosure)
        && Number.isFinite(probe.irradiance) && probe.irradiance >= 0
        && Number.isFinite(probe.red) && probe.red >= 0
        && Number.isFinite(probe.green) && probe.green >= 0
        && Number.isFinite(probe.blue) && probe.blue >= 0;
      tunnelBounceValid = valid;
      tunnelBounceEnclosure = valid ? clamp(probe.enclosure, 0, 1) : 0;
      tunnelBounceIrradiance = valid
        ? clamp(probe.irradiance, 0, TUNNEL_BOUNCE_CONTRACT.maximumIrradiance)
        : 0;
      tunnelBounceUniform.value.set(
        valid ? probe.red * tunnelBounceIrradiance : 0,
        valid ? probe.green * tunnelBounceIrradiance : 0,
        valid ? probe.blue * tunnelBounceIrradiance : 0
      );
      return valid;
    }

    /** Compose with existing procedural hooks and preserve one uniform through entity-owned material clones. */
    function installTunnelBounceReceiver(material) {
      if (!material?.isMeshStandardMaterial || material.transparent === true
        || Number(material.transmission) > 0 || material.userData?.neon?.kind === 'glass'
        || tunnelBounceMaterials.has(material)) return material;
      const previousCompile = material.onBeforeCompile;
      const previousCacheKey = material.customProgramCacheKey;
      const previousClone = material.clone;
      material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
        previousCompile.call(this, shader, renderer);
        shader.uniforms[TUNNEL_BOUNCE_CONTRACT.uniformName] = tunnelBounceUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 neonShipTunnelBounce;')
          .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined(RE_IndirectDiffuse)
  irradiance += PI * neonShipTunnelBounce * ${TUNNEL_BOUNCE_CONTRACT.receiverGain} / ${TUNNEL_BOUNCE_CONTRACT.referenceAlbedo};
#endif`);
      };
      material.customProgramCacheKey = function customProgramCacheKey() {
        return `${previousCacheKey.call(this)}|ship-tunnel-bounce-v${TUNNEL_BOUNCE_CONTRACT.version}`;
      };
      material.clone = function clone() {
        const cloned = previousClone.call(this);
        // Three Material.copy omits shader hooks. Restore the original procedural layer before installing the
        // receiver, otherwise a clone either loses its surface detail or double-applies the tunnel contribution.
        cloned.onBeforeCompile = previousCompile;
        cloned.customProgramCacheKey = previousCacheKey;
        return installTunnelBounceReceiver(cloned);
      };
      material.userData.neonTunnelBounceReceiver = TUNNEL_BOUNCE_CONTRACT.version;
      tunnelBounceMaterials.add(material);
      return material;
    }

    const shipMat = modeling.createMaterial({
      THREE,
      kind: 'surface',
      color: 0xf3_e6c8,
      emissive: 0x68_4727,
      emissiveIntensity: 0.035,
      roughness: 0.64,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.58,
      sheen: 0.18,
      sheenRoughness: 0.78,
      ior: 1.46,
      proceduralScale: 8.6,
      proceduralStrength: 0.055,
      seed: 'neon-warm-ivory-reliquary'
    });
    const capeMat = modeling.createMaterial({
      THREE,
      kind: 'organic',
      color: 0xb7_452f,
      emissive: 0x47_1b18,
      emissiveIntensity: 0.028,
      roughness: 0.86,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.88,
      sheen: 0.92,
      sheenRoughness: 0.76,
      sheenColor: 0xff_c39d,
      ior: 1.46,
      proceduralScale: 10.8,
      proceduralStrength: 0.09,
      seed: 'neon-sky-cape-cloth'
    });
    const capeInsetMat = modeling.createMaterial({
      THREE,
      kind: 'organic',
      color: 0xdf_8a5b,
      emissive: 0x66_2e22,
      emissiveIntensity: 0.035,
      roughness: 0.80,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.84,
      sheen: 0.86,
      sheenRoughness: 0.72,
      sheenColor: 0xff_e0ad,
      ior: 1.46,
      proceduralScale: 13.6,
      proceduralStrength: 0.07,
      seed: 'neon-sky-cape-inner-weave'
    });
    const shadowHullMat = modeling.createMaterial({
      THREE,
      kind: 'structure',
      color: 0x3a_2c35,
      emissive: 0x18_1219,
      emissiveIntensity: 0.018,
      roughness: 0.78,
      metalness: 0,
      clearcoat: 0.06,
      clearcoatRoughness: 0.72,
      sheen: 0.12,
      sheenRoughness: 0.82,
      ior: 1.50,
      proceduralScale: 9.2,
      proceduralStrength: 0.16,
      seed: 'neon-shadow-hull'
    });
    const trimMat = modeling.createMaterial({
      THREE,
      kind: 'structure',
      color: 0xe6_c68a,
      emissive: 0x54_391d,
      emissiveIntensity: 0.055,
      roughness: 0.52,
      metalness: 0.14,
      clearcoat: 0.18,
      clearcoatRoughness: 0.52,
      sheen: 0.16,
      sheenRoughness: 0.72,
      ior: 1.50,
      proceduralScale: 11.0,
      proceduralStrength: 0.07,
      seed: 'neon-gilded-trim'
    });
    const glassMat = modeling.createMaterial({
      THREE,
      kind: 'glass',
      color: 0x36_2731,
      emissive: 0x8c_5b35,
      emissiveIntensity: 0.055,
      roughness: 0.22,
      metalness: 0,
      transmission: 0.46,
      transparent: true,
      opacity: 1,
      clearcoat: 0.48,
      clearcoatRoughness: 0.22,
      ior: 1.42,
      thickness: 0.12,
      attenuationColor: 0x72_4c43,
      attenuationDistance: 1.8,
      envMapIntensity: 0.82
    });
    const engineMat = modeling.createMaterial({
      THREE,
      kind: 'effect',
      color: 0xff_d884,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const innerEngineMat = modeling.createMaterial({
      THREE,
      kind: 'effect',
      color: 0xff_f8e8,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const neonStripMat = modeling.createMaterial({
      THREE,
      kind: 'glow',
      color: 0xff_d884,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const panelLineMat = neonStripMat.clone();
    panelLineMat.opacity = 0.38;

    function markMain(mesh, family, name) {
      mesh.name = `Neon.Ship.${name}`;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) installTunnelBounceReceiver(material);
      const hasTransmissiveGlass = materials.some((material) => (
        material?.userData?.neon?.kind === 'glass'
        && (Number(material.transmission) > 0 || material.transparent === true)
      ));
      // Three's ordinary shadow maps treat transparent transmission as opaque. Glass receives the real lighting
      // and environment but does not project a physically false solid silhouette onto the hull or road.
      mesh.castShadow = !hasTransmissiveGlass;
      mesh.receiveShadow = true;
      modeling.markMainVisual(mesh, {
        family,
        zoneId: 'shared',
        analyzeTopology: true,
        watertightContract: true,
        shadowMode: hasTransmissiveGlass ? 'receive-only-transmissive-glass' : 'cast-and-receive'
      });
      return mesh;
    }

    function markEffect(mesh, reason, name) {
      mesh.name = `Neon.ShipEffect.${name}`;
      modeling.markEffect(mesh, reason);
      if (isShipBloomEmitterName(name)) {
        mesh.userData.neonBloom = true;
        mesh.userData.neonBloomSource = 'ship-explicit-emitter';
        if (mesh.layers?.enable) mesh.layers.enable(SHIP_ULTRA_PRESENTATION_CONTRACT.bloomLayer);
      }
      return mesh;
    }

    function ellipseRing({ z, rx, ry, cx = 0, cy = 0, phase = 0 }, segments = radialSegments) {
      const ring = [];
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2 + phase;
        ring.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, z]);
      }
      return ring;
    }

    function loftGeometry(sections, segments = radialSegments) {
      return modeling.createLoftGeometry({
        THREE,
        rings: sections.map((section) => ellipseRing(section, segments)),
        capStart: true,
        capEnd: true
      });
    }

    function prismGeometry(width, height, depth, chamfer = Math.min(width, height) * 0.18) {
      return modeling.createBeveledPrismGeometry({
        THREE,
        width,
        height,
        depth,
        chamfer,
        bevel: Math.min(width, height, depth) * 0.12,
        bevelSegments
      });
    }

    function tubeGeometry(points, radius, closed = false, pathSegments = tubularSegments, sideSegments = 8) {
      return modeling.createTubeGeometry({
        THREE,
        points,
        radius,
        tubularSegments: pathSegments,
        radialSegments: Math.max(6, sideSegments),
        closed,
        capStart: !closed,
        capEnd: !closed
      });
    }

    function loopPoints(radiusX, radiusY, z = 0, segments = radialSegments, ripple = 0) {
      const points = [];
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const modulation = 1 + Math.sin(angle * 6) * ripple;
        points.push([Math.cos(angle) * radiusX * modulation, Math.sin(angle) * radiusY * modulation, z]);
      }
      return points;
    }

    function addMain(mesh, family, name, parent = player) {
      markMain(mesh, family, name);
      parent.add(mesh);
      return mesh;
    }

    function addEffect(mesh, reason, name, parent = player) {
      markEffect(mesh, reason, name);
      parent.add(mesh);
      return mesh;
    }

    // The quiet ivory reliquary is a soft pilgrim/manta body. It keeps the legacy collision centre but avoids the
    // pointed canopy, armour stack, and exposed machinery that would turn the cape silhouette back into a fighter.
    const fuselage = addMain(new THREE.Mesh(loftGeometry([
      { z: -1.18, rx: 0.06, ry: 0.040, cy: 0.90 },
      { z: -1.02, rx: 0.22, ry: 0.15, cy: 0.92 },
      { z: -0.68, rx: 0.43, ry: 0.32, cy: 0.94 },
      { z: -0.16, rx: 0.52, ry: 0.40, cy: 0.90 },
      { z: 0.40, rx: 0.50, ry: 0.37, cy: 0.83 },
      { z: 0.84, rx: 0.41, ry: 0.29, cy: 0.75 },
      { z: 1.12, rx: 0.24, ry: 0.17, cy: 0.70 },
      { z: 1.22, rx: 0.06, ry: 0.040, cy: 0.69 }
    ], radialSegments + 4), shipMat), 'ship-hull', 'streamlined-fuselage');

    const bellyShell = addMain(new THREE.Mesh(loftGeometry([
      { z: -0.82, rx: 0.22, ry: 0.08, cy: 0.58 },
      { z: -0.42, rx: 0.40, ry: 0.16, cy: 0.55 },
      { z: 0.36, rx: 0.43, ry: 0.17, cy: 0.52 },
      { z: 0.94, rx: 0.28, ry: 0.11, cy: 0.54 },
      { z: 1.10, rx: 0.10, ry: 0.05, cy: 0.59 }
    ]), shadowHullMat), 'ship-belly', 'sealed-belly-shell');

    const cockpit = addMain(new THREE.Mesh(loftGeometry([
      { z: -0.96, rx: 0.045, ry: 0.030, cy: 1.04 },
      { z: -0.86, rx: 0.18, ry: 0.12, cy: 1.10 },
      { z: -0.58, rx: 0.27, ry: 0.18, cy: 1.18 },
      { z: -0.27, rx: 0.23, ry: 0.15, cy: 1.19 },
      { z: -0.10, rx: 0.05, ry: 0.035, cy: 1.14 }
    ], radialSegments + 4), shadowHullMat), 'ship-spirit-mask', 'embedded-canopy');

    const nosePearl = addMain(new THREE.Mesh(loftGeometry([
      { z: -1.15, rx: 0.025, ry: 0.018, cy: 1.01 },
      { z: -1.08, rx: 0.10, ry: 0.055, cy: 1.06 },
      { z: -0.92, rx: 0.12, ry: 0.065, cy: 1.08 },
      { z: -0.84, rx: 0.025, ry: 0.018, cy: 1.08 }
    ], Math.max(12, radialSegments - 4)), glassMat), 'ship-canopy', 'nose-lens');

    const dorsalSpine = addMain(new THREE.Mesh(tubeGeometry([
      [0, 1.15, -0.76],
      [0, 1.27, -0.34],
      [0, 1.24, 0.18],
      [0, 1.08, 0.76]
    ], 0.034, false, tubularSegments, 8), trimMat), 'ship-cloth-seam', 'dorsal-spine');

    const canopyFrames = [];
    for (const side of [-1, 1]) {
      const frame = addMain(new THREE.Mesh(tubeGeometry([
        [0.07 * side, 1.09, -0.85],
        [0.20 * side, 1.24, -0.58],
        [0.23 * side, 1.29, -0.30],
        [0.15 * side, 1.18, -0.10]
      ], 0.018, false, Math.max(14, tubularSegments - 4), 7), trimMat), 'ship-hood-seam', side < 0 ? 'canopy-frame-left' : 'canopy-frame-right');
      canopyFrames.push(frame);
    }
    const canopyBridge = addMain(new THREE.Mesh(tubeGeometry([
      [-0.20, 1.19, -0.60],
      [0, 1.23, -0.65],
      [0.20, 1.19, -0.60]
    ], 0.018, false, 12, 7), trimMat), 'ship-hood-seam', 'canopy-bridge');

    const trimParts = [dorsalSpine, canopyBridge, ...canopyFrames];
    const glassParts = [nosePearl];
    const shadowHullParts = [bellyShell, cockpit];
    const hardlineGlowParts = [];

    function addMantleClasp(side, x, y, z, sx, sy, sz, yaw = 0, roll = 0) {
      const clasp = addMain(new THREE.Mesh(prismGeometry(sx, sy, sz), trimMat), 'ship-mantle-clasp', `mantle-clasp-${side < 0 ? 'left' : 'right'}-${trimParts.length}`);
      clasp.position.set(x * side, y, z);
      clasp.rotation.set(-0.04, side * yaw, side * roll);
      trimParts.push(clasp);
      return clasp;
    }

    function addGlowPath(points, radius, opacity, name, parent = player, phase = null) {
      const material = panelLineMat.clone();
      material.opacity = opacity;
      const path = addEffect(new THREE.Mesh(tubeGeometry(points, radius, false, Math.max(10, tubularSegments - 6), 6), material), 'Micro emissive guidance strip; visual-only and collision-free.', name, parent);
      path.userData.baseOpacity = opacity;
      path.userData.phase = Number.isFinite(phase) ? phase : visualRand(0, Math.PI * 2);
      hardlineGlowParts.push(path);
      return path;
    }

    const hullFlowPhase = visualRand(0, Math.PI * 2);
    for (const side of [-1, 1]) {
      addMantleClasp(side, 0.57, 0.89, -0.02, 0.16, 0.07, 0.34, 0.16, 0.10);
      addMantleClasp(side, 0.61, 0.77, 0.48, 0.13, 0.06, 0.30, 0.10, 0.07);
      addGlowPath([
        [0.35 * side, 1.04, -0.42],
        [0.43 * side, 1.04, -0.02],
        [0.34 * side, 0.94, 0.46]
      ], 0.010, 0.22, `hull-flow-${side < 0 ? 'left' : 'right'}`, player, hullFlowPhase);
    }

    // Two warm emissive eyes make the small dark mask read as a quiet living guide without adding road lights.
    const spiritEyeGeometry = loftGeometry([
      { z: -0.025, rx: 0.010, ry: 0.007 },
      { z: 0, rx: 0.040, ry: 0.026 },
      { z: 0.025, rx: 0.010, ry: 0.007 }
    ], 10);
    for (const side of [-1, 1]) {
      const eyeMaterial = neonStripMat.clone();
      eyeMaterial.opacity = 0.78;
      const eye = addEffect(
        new THREE.Mesh(spiritEyeGeometry, eyeMaterial),
        'Spirit-mask eye; emissive-only, visual-only, and collision-free.',
        `spirit-eye-${side < 0 ? 'left' : 'right'}`
      );
      eye.position.set(0.105 * side, 1.115, -0.925);
      eye.userData.baseOpacity = 0.78;
      eye.userData.phase = hullFlowPhase;
      hardlineGlowParts.push(eye);
    }

    function starOutline(outerRadius, innerRadius, pointCount = 6) {
      const points = [];
      for (let index = 0; index < pointCount * 2; index++) {
        const angle = -Math.PI / 2 + index / (pointCount * 2) * Math.PI * 2;
        const radius = index % 2 === 0 ? outerRadius : innerRadius;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
      return points;
    }

    // A candle-shaped soul core replaces a purely mechanical dorsal detail as the dominant close-view focal point.
    const spiritCore = addMain(new THREE.Mesh(loftGeometry([
      { z: -0.22, rx: 0.035, ry: 0.045, cy: 1.46 },
      { z: -0.13, rx: 0.17, ry: 0.20, cy: 1.48 },
      { z: 0.04, rx: 0.21, ry: 0.25, cy: 1.52 },
      { z: 0.22, rx: 0.13, ry: 0.20, cy: 1.57 },
      { z: 0.36, rx: 0.030, ry: 0.060, cy: 1.66 }
    ], radialSegments + 4), glassMat), 'ship-spirit-core', 'candle-soul-core');
    spiritCore.userData.neonBloom = true;
    spiritCore.userData.neonBloomSource = 'ship-explicit-emitter';
    if (spiritCore.layers?.enable) spiritCore.layers.enable(SHIP_ULTRA_PRESENTATION_CONTRACT.bloomLayer);
    glassParts.push(spiritCore);

    const spiritStar = addMain(new THREE.Mesh(modeling.createExtrudedProfileGeometry({
      THREE,
      outline: starOutline(0.25, 0.095, 4),
      depth: 0.052,
      bevel: 0.014,
      bevelSegments
    }), trimMat), 'ship-spirit-core', 'four-point-dawn-mark');
    spiritStar.rotation.x = Math.PI / 2;
    spiritStar.position.set(0, 1.38, 0.15);
    trimParts.push(spiritStar);

    const spiritHaloMaterial = neonStripMat.clone();
    spiritHaloMaterial.opacity = 0.36;
    const spiritHalo = addEffect(
      new THREE.Mesh(
        tubeGeometry(loopPoints(0.38, 0.30, 0, radialSegments + 4, 0.018), 0.020, true, radialSegments + 4, 7),
        spiritHaloMaterial
      ),
      'Candle-core halo; visual-only and collision-free.',
      'candle-soul-halo'
    );
    spiritHalo.position.set(0, 1.50, 0.34);
    spiritHalo.userData.baseOpacity = 0.36;
    spiritHalo.userData.phase = visualRand(0, Math.PI * 2);
    hardlineGlowParts.push(spiritHalo);

    // Five broad scallops per healthy wing read as a hand-cut Sky cape rather than segmented aircraft armour.
    // Every damage variant remains a complete sealed cloth form, so life switching never exposes an open section.
    const fullWingOutline = [
      [0.80, -0.52],
      [1.08, -0.43],
      [1.58, -0.24],
      [2.12, 0.02],
      [2.62, 0.28],
      [2.56, 0.46],
      [2.30, 0.52],
      [2.42, 0.68],
      [2.10, 0.72],
      [2.22, 0.88],
      [1.86, 0.88],
      [1.96, 1.05],
      [1.60, 1.02],
      [1.68, 1.20],
      [1.30, 1.15],
      [1.06, 1.34],
      [0.82, 1.25],
      [0.80, 0.90]
    ];
    const woundedWingOutline = [
      [0.80, -0.50],
      [1.10, -0.40],
      [1.58, -0.20],
      [2.24, 0.22],
      [2.12, 0.43],
      [1.92, 0.50],
      [2.04, 0.67],
      [1.72, 0.72],
      [1.84, 0.89],
      [1.47, 0.91],
      [1.57, 1.08],
      [1.18, 1.16],
      [0.82, 1.20],
      [0.80, 0.88]
    ];
    const criticalWingOutline = [
      [0.80, -0.46],
      [1.06, -0.36],
      [1.40, -0.16],
      [1.58, 0.12],
      [1.42, 0.31],
      [1.52, 0.48],
      [1.22, 0.57],
      [1.32, 0.73],
      [1.04, 0.79],
      [1.14, 0.94],
      [0.82, 1.04],
      [0.80, 0.84]
    ];

    function wingGeometry(side, outline) {
      return modeling.createExtrudedProfileGeometry({
        THREE,
        outline: mirrorExtrudedOutline(side, outline),
        depth: 0.18,
        bevel: 0.040,
        bevelSegments
      });
    }

    function capeInsetGeometry(side, outline) {
      const insetOutline = outline.map(([x, z]) => [
        0.84 + (x - 0.80) * 0.86,
        0.02 + z * 0.88
      ]);
      return modeling.createExtrudedProfileGeometry({
        THREE,
        outline: mirrorExtrudedOutline(side, insetOutline),
        depth: 0.050,
        bevel: 0.012,
        bevelSegments
      });
    }

    function createWing(side, outline, name, parent) {
      const wing = addMain(new THREE.Mesh(wingGeometry(side, outline), capeMat), 'ship-cape-wing', name, parent);
      wing.rotation.x = Math.PI / 2;
      wing.position.y = 0.76;
      return wing;
    }

    function createCapeInset(side, outline, name, parent) {
      const inset = addMain(new THREE.Mesh(capeInsetGeometry(side, outline), capeInsetMat), 'ship-cape-inset', name, parent);
      inset.rotation.x = Math.PI / 2;
      inset.position.y = 0.92;
      return inset;
    }

    const leftCapeGroup = new THREE.Group();
    leftCapeGroup.name = 'Neon.ShipCape.left';
    player.add(leftCapeGroup);
    const lifeFormGroups = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
    lifeFormGroups[0].name = 'Neon.ShipLife.healthy';
    lifeFormGroups[1].name = 'Neon.ShipLife.wounded';
    lifeFormGroups[2].name = 'Neon.ShipLife.critical';
    player.add(...lifeFormGroups);
    const rightCapeGroups = lifeFormGroups.map((lifeGroup, index) => {
      const capeGroup = new THREE.Group();
      capeGroup.name = `Neon.ShipCape.right.${['healthy', 'wounded', 'critical'][index]}`;
      lifeGroup.add(capeGroup);
      return capeGroup;
    });

    const wingL = createWing(-1, fullWingOutline, 'cape-wing-left', leftCapeGroup);
    const capeInsetL = createCapeInset(-1, fullWingOutline, 'cape-inset-left', leftCapeGroup);

    function createVariantWing(outline, name, group, insetName) {
      const wing = createWing(1, outline, name, group);
      createCapeInset(1, outline, insetName, group);
      return wing;
    }

    const wingRHealthy = createVariantWing(fullWingOutline, 'cape-wing-right-healthy', rightCapeGroups[0], 'cape-inset-right-healthy');
    const wingRWounded = createVariantWing(woundedWingOutline, 'cape-wing-right-wounded-sealed', rightCapeGroups[1], 'cape-inset-right-wounded-sealed');
    const wingRCritical = createVariantWing(criticalWingOutline, 'cape-wing-right-critical-sealed', rightCapeGroups[2], 'cape-inset-right-critical-sealed');

    function createWingTip(side, x, name, group = player) {
      const tip = markMain(new THREE.Mesh(loftGeometry([
        { z: 0.14, rx: 0.018, ry: 0.012, cx: x * side },
        { z: 0.22, rx: 0.080, ry: 0.050, cx: x * side },
        { z: 0.34, rx: 0.095, ry: 0.060, cx: x * side },
        { z: 0.46, rx: 0.025, ry: 0.016, cx: x * side }
      ], Math.max(12, radialSegments - 4)), trimMat), 'ship-wingtip', name);
      tip.position.y = 0.82;
      group.add(tip);
      trimParts.push(tip);
      return tip;
    }

    createWingTip(-1, 2.50, 'wingtip-left', leftCapeGroup);
    createWingTip(1, 2.50, 'wingtip-right-healthy', rightCapeGroups[0]);
    createWingTip(1, 2.14, 'wingtip-right-wounded-sealed', rightCapeGroups[1]);
    createWingTip(1, 1.48, 'wingtip-right-critical-stump-sealed', rightCapeGroups[2]);

    function finGeometry(side, form = 'healthy') {
      const outlines = {
        healthy: [[-0.13, 0], [0.15, 0], [0.12, 0.18], [0.02, 0.34], [-0.12, 0.19]],
        wounded: [[-0.13, 0], [0.15, 0], [0.10, 0.15], [-0.02, 0.27], [-0.13, 0.16]],
        critical: [[-0.13, 0], [0.15, 0], [0.08, 0.10], [-0.03, 0.18], [-0.13, 0.11]]
      };
      return modeling.createExtrudedProfileGeometry({
        THREE,
        outline: mirrorExtrudedOutline(side, outlines[form]),
        depth: 0.10,
        bevel: 0.020,
        bevelSegments
      });
    }

    function addFin(side, form, name, group = player) {
      const fin = markMain(new THREE.Mesh(finGeometry(side, form), capeMat), 'ship-tail-fin', name);
      fin.position.set(0.90 * side, 0.87, 0.82);
      group.add(fin);
      return fin;
    }

    const finL = addFin(-1, 'healthy', 'tail-fin-left', leftCapeGroup);
    const finRHealthy = addFin(1, 'healthy', 'tail-fin-right-healthy', rightCapeGroups[0]);
    const finRWounded = addFin(1, 'wounded', 'tail-fin-right-wounded-sealed', rightCapeGroups[1]);
    const finRCritical = addFin(1, 'critical', 'tail-fin-right-critical-sealed', rightCapeGroups[2]);

    // Paired scarf tails carry the cape language through the rear view while leaving the central exhaust readable.
    const scarfSeamPhase = visualRand(0, Math.PI * 2);
    for (const side of [-1, 1]) {
      const tail = addMain(new THREE.Mesh(modeling.createExtrudedProfileGeometry({
        THREE,
        outline: mirrorExtrudedOutline(side, [
          [0.62, 0.60],
          [0.92, 0.68],
          [0.90, 1.30],
          [0.74, 1.72],
          [0.62, 1.40]
        ]),
        depth: 0.08,
        bevel: 0.020,
        bevelSegments
      }), capeInsetMat), 'ship-cape-tail', `spirit-scarf-tail-${side < 0 ? 'left' : 'right'}`);
      tail.rotation.x = Math.PI / 2;
      tail.position.y = 0.79;
      addGlowPath([
        [0.72 * side, 0.85, 0.72],
        [0.78 * side, 0.83, 1.16],
        [0.74 * side, 0.81, 1.56]
      ], 0.011, 0.30, `spirit-scarf-seam-${side < 0 ? 'left' : 'right'}`, player, scarfSeamPhase);
    }

    const wingGlowL = addEffect(new THREE.Mesh(tubeGeometry([
      [-0.82, 0.88, -0.47],
      [-1.18, 0.90, -0.38],
      [-1.70, 0.89, -0.18],
      [-2.18, 0.86, 0.05],
      [-2.58, 0.82, 0.30]
    ], 0.020, false, tubularSegments, 7), neonStripMat.clone()), 'Thin breathing cape hem; visual-only and collision-free.', 'cape-edge-left', leftCapeGroup);
    const wingGlowR = addEffect(new THREE.Mesh(tubeGeometry([
      [0.82, 0.88, -0.47],
      [1.18, 0.90, -0.38],
      [1.70, 0.89, -0.18],
      [2.18, 0.86, 0.05],
      [2.58, 0.82, 0.30]
    ], 0.020, false, tubularSegments, 7), neonStripMat.clone()), 'Healthy right breathing cape hem mirrored from the complete left silhouette.', 'cape-edge-right-healthy', rightCapeGroups[0]);

    const leftCapeRim = addGlowPath([
      [-0.84, 0.955, -0.44],
      [-1.30, 0.960, -0.31],
      [-1.86, 0.935, -0.06],
      [-2.55, 0.870, 0.30]
    ], 0.014, 0.42, 'cape-rim-left', leftCapeGroup);
    for (const [index, rim] of [
      [[0.84, 0.955, -0.44], [1.30, 0.960, -0.31], [1.86, 0.935, -0.06], [2.55, 0.870, 0.30]],
      [[0.84, 0.955, -0.42], [1.24, 0.955, -0.29], [1.68, 0.930, -0.08], [2.18, 0.875, 0.22]],
      [[0.84, 0.955, -0.39], [1.10, 0.945, -0.27], [1.36, 0.920, -0.09], [1.53, 0.880, 0.12]]
    ].entries()) {
      addGlowPath(
        rim,
        0.014,
        0.42,
        `cape-rim-right-${['healthy', 'wounded', 'critical'][index]}`,
        rightCapeGroups[index],
        index === 0 ? leftCapeRim.userData.phase : null
      );
    }

    const constellationStarGeometry = modeling.createExtrudedProfileGeometry({
      THREE,
      outline: starOutline(0.085, 0.034, 4),
      depth: 0.026,
      bevel: 0.006,
      bevelSegments: 1
    });
    const constellationLayout = [[0.94, -0.16], [1.28, 0.05], [1.82, 0.33], [1.48, 0.76]];

    function addCapeConstellation(side, layout, label, parent, pairedPhases = null) {
      const thread = addGlowPath(
        layout.map(([x, z]) => [x * side, 0.970, z]),
        0.011,
        0.34,
        `constellation-thread-${label}`,
        parent,
        pairedPhases?.thread
      );
      const nodePhases = [];
      for (const [index, [x, z]] of layout.entries()) {
        const material = neonStripMat.clone();
        material.opacity = 0.54;
        const node = addEffect(
          new THREE.Mesh(constellationStarGeometry, material),
          'Cape constellation node; visual-only and collision-free.',
          `constellation-node-${label}-${index + 1}`,
          parent
        );
        node.rotation.x = Math.PI / 2;
        node.position.set(x * side, 0.982, z);
        node.userData.baseOpacity = 0.54;
        node.userData.phase = Number.isFinite(pairedPhases?.nodes?.[index])
          ? pairedPhases.nodes[index]
          : visualRand(0, Math.PI * 2);
        nodePhases.push(node.userData.phase);
        hardlineGlowParts.push(node);
      }
      return Object.freeze({
        thread: thread.userData.phase,
        nodes: Object.freeze(nodePhases)
      });
    }

    const leftConstellationPhases = addCapeConstellation(-1, constellationLayout, 'left', leftCapeGroup);
    addCapeConstellation(1, constellationLayout, 'right-healthy', rightCapeGroups[0], leftConstellationPhases);
    addCapeConstellation(1, constellationLayout.slice(0, 3), 'right-wounded', rightCapeGroups[1]);
    addCapeConstellation(1, constellationLayout.slice(0, 2), 'right-critical', rightCapeGroups[2]);

    const leftForwardRib = addGlowPath([[-0.86, 0.972, -0.31], [-1.18, 0.966, 0.02], [-1.48, 0.940, 0.47]], 0.011, 0.34, 'cape-rib-left-forward', leftCapeGroup);
    const leftMiddleRib = addGlowPath([[-0.88, 0.970, 0.10], [-1.24, 0.952, 0.35], [-1.62, 0.920, 0.78]], 0.011, 0.30, 'cape-rib-left-middle', leftCapeGroup);
    const leftAftRib = addGlowPath([[-0.88, 0.960, 0.58], [-1.16, 0.940, 0.73], [-1.44, 0.910, 1.02]], 0.010, 0.26, 'cape-rib-left-aft', leftCapeGroup);
    for (const [index, layout] of [
      [[0.86, 0.972, -0.31], [1.18, 0.966, 0.02], [1.48, 0.940, 0.47]],
      [[0.84, 0.970, -0.29], [1.12, 0.955, 0.01], [1.38, 0.930, 0.36]],
      [[0.83, 0.965, -0.27], [1.02, 0.945, -0.02], [1.22, 0.920, 0.25]]
    ].entries()) {
      addGlowPath(
        layout,
        0.013,
        0.40,
        `cape-rib-right-${['healthy', 'wounded', 'critical'][index]}`,
        rightCapeGroups[index],
        index === 0 ? leftForwardRib.userData.phase : null
      );
    }
    addGlowPath(
      [[0.88, 0.970, 0.10], [1.24, 0.952, 0.35], [1.62, 0.920, 0.78]],
      0.011,
      0.30,
      'cape-rib-right-healthy-middle',
      rightCapeGroups[0],
      leftMiddleRib.userData.phase
    );
    addGlowPath(
      [[0.88, 0.960, 0.58], [1.16, 0.940, 0.73], [1.44, 0.910, 1.02]],
      0.010,
      0.26,
      'cape-rib-right-healthy-aft',
      rightCapeGroups[0],
      leftAftRib.userData.phase
    );

    const damagedSeamGlow = [];
    for (const [index, data] of [
      { group: rightCapeGroups[1], points: [[1.82, 0.91, 0.21], [2.10, 0.87, 0.42], [1.84, 0.84, 0.68]], name: 'wounded-sealed-edge' },
      { group: rightCapeGroups[2], points: [[1.18, 0.91, -0.04], [1.48, 0.87, 0.16], [1.26, 0.84, 0.46]], name: 'critical-sealed-edge' }
    ].entries()) {
      const material = neonStripMat.clone();
      material.color.setHex(index === 0 ? 0xff_b58f : 0xf0_6e76);
      material.opacity = 0.48;
      const seam = markEffect(new THREE.Mesh(tubeGeometry(data.points, 0.018, false, 12, 6), material), 'Emissive outline on a fully capped damage mesh.', data.name);
      data.group.add(seam);
      hardlineGlowParts.push(seam);
      damagedSeamGlow.push(seam);
    }

    const keel = addMain(new THREE.Mesh(modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [[-0.10, -0.82], [0.10, -0.82], [0.14, 0.62], [0.07, 0.92], [-0.07, 0.92], [-0.14, 0.62]],
      depth: 0.10,
      bevel: 0.025,
      bevelSegments
    }), shadowHullMat), 'ship-keel', 'sealed-keel');
    keel.rotation.x = Math.PI / 2;
    keel.position.y = 0.35;
    shadowHullParts.push(keel);

    // A closed flower-heart aperture replaces the exposed turbine vocabulary while retaining every propulsion handle.
    const engineCowl = addMain(new THREE.Mesh(modeling.createExtrudedProfileGeometry({
      THREE,
      outline: starOutline(0.34, 0.25, 6),
      depth: 0.22,
      bevel: 0.025,
      bevelSegments
    }), trimMat), 'ship-light-aperture', 'main-engine-cowl');
    engineCowl.position.set(0, 0.66, 1.04);
    trimParts.push(engineCowl);

    const nozzleCore = addMain(new THREE.Mesh(modeling.createRadialGeometry({
      THREE,
      profile: [[-0.15, 0.14], [-0.04, 0.21], [0.08, 0.23], [0.16, 0.16]],
      axis: 'z',
      segments: radialSegments,
      capStart: true,
      capEnd: true
    }), shadowHullMat), 'ship-thruster', 'sealed-main-nozzle');
    nozzleCore.position.set(0, 0.66, 1.04);
    shadowHullParts.push(nozzleCore);

    const engineRing = addMain(new THREE.Mesh(tubeGeometry(
      starOutline(0.30, 0.245, 6).map(([x, y]) => [x, y, 0]),
      0.024,
      true,
      radialSegments + 4,
      8
    ), trimMat), 'ship-light-aperture', 'engine-collar');
    engineRing.position.set(0, 0.66, SHIP_COMPONENT_CLEARANCE_CONTRACT.mainPlumeRootZM);
    trimParts.push(engineRing);

    const sideFlames = [];
    const sideInnerFlames = [];
    const sideEngineShells = [];
    const sidePodGeometry = loftGeometry([
      { z: -0.28, rx: 0.045, ry: 0.032 },
      { z: -0.16, rx: 0.11, ry: 0.085 },
      { z: 0.13, rx: 0.14, ry: 0.10 },
      { z: 0.30, rx: 0.075, ry: 0.055 }
    ], Math.max(12, radialSegments - 4));
    const sideFlameGeometry = modeling.createRadialGeometry({
      THREE,
      profile: [[0, 0.022], [0.15, 0.066], [0.62, 0.078], [1, 0.010]],
      axis: 'y',
      segments: Math.max(12, radialSegments - 4),
      capStart: true,
      capEnd: true
    });
    const sideInnerFlameGeometry = modeling.createRadialGeometry({
      THREE,
      profile: [[0, 0.012], [0.13, 0.035], [0.58, 0.042], [1, 0.006]],
      axis: 'y',
      segments: Math.max(12, radialSegments - 4),
      capStart: true,
      capEnd: true
    });
    for (const x of [-0.62, 0.62]) {
      const side = x < 0 ? 'left' : 'right';
      const sidePod = addMain(new THREE.Mesh(sidePodGeometry, shadowHullMat), 'ship-thruster', `side-pod-${side}`);
      sidePod.position.set(x, 0.61, 0.96);
      shadowHullParts.push(sidePod);

      const shell = addMain(new THREE.Mesh(tubeGeometry(
        starOutline(0.14, 0.105, 6).map(([px, py]) => [px, py, 0]),
        0.018,
        true,
        12,
        7
      ), trimMat), 'ship-light-aperture', `side-nozzle-shell-${side}`);
      shell.position.set(x, 0.61, SHIP_COMPONENT_CLEARANCE_CONTRACT.sidePlumeRootZM);
      shell.userData.thrustSide = x < 0 ? -1 : 1;
      sideEngineShells.push(shell);
      trimParts.push(shell);

      const lightVent = addMain(new THREE.Mesh(tubeGeometry(
        starOutline(0.095, 0.070, 4).map(([px, py]) => [px, py, 0]),
        0.013,
        true,
        10,
        7
      ), trimMat), 'ship-light-aperture', `side-light-vent-${side}`);
      lightVent.position.set(x, 0.61, 0.78);
      trimParts.push(lightVent);

      const sideCoreMat = neonStripMat.clone();
      sideCoreMat.opacity = 0.42;
      const sideCore = addEffect(new THREE.Mesh(loftGeometry([
        { z: -0.10, rx: 0.04, ry: 0.035 },
        { z: 0, rx: 0.10, ry: 0.085 },
        { z: 0.10, rx: 0.04, ry: 0.035 }
      ], 12), sideCoreMat), 'Small engine aperture glow; visual-only and collision-free.', `side-core-${side}`);
      sideCore.position.set(x, 0.61, SHIP_COMPONENT_CLEARANCE_CONTRACT.sidePlumeRootZM);

      const sideFlame = addEffect(new THREE.Mesh(sideFlameGeometry, engineMat.clone()), 'Animated exhaust plume; visual-only and collision-free.', `side-flame-${side}`);
      sideFlame.rotation.x = Math.PI / 2;
      sideFlame.position.set(x, 0.61, SHIP_COMPONENT_CLEARANCE_CONTRACT.sidePlumeRootZM);
      sideFlame.userData.thrustSide = x < 0 ? -1 : 1;
      sideFlame.userData.flickerPhase = x < 0 ? 0 : Math.PI * 0.68;
      sideFlames.push(sideFlame);

      const sideInnerFlame = addEffect(new THREE.Mesh(sideInnerFlameGeometry, innerEngineMat.clone()), 'White-hot side-exhaust core; visual-only and collision-free.', `side-inner-flame-${side}`);
      sideInnerFlame.rotation.x = Math.PI / 2;
      sideInnerFlame.position.set(x, 0.61, SHIP_COMPONENT_CLEARANCE_CONTRACT.sidePlumeRootZM);
      sideInnerFlame.userData.thrustSide = x < 0 ? -1 : 1;
      sideInnerFlame.userData.flickerPhase = sideFlame.userData.flickerPhase;
      sideInnerFlames.push(sideInnerFlame);
    }

    const flameGeometry = modeling.createRadialGeometry({
      THREE,
      profile: [[0, 0.032], [0.18, 0.13], [0.58, 0.23], [1, 0.020]],
      axis: 'y',
      segments: radialSegments,
      capStart: true,
      capEnd: true
    });
    const flame = addEffect(new THREE.Mesh(flameGeometry, engineMat), 'Animated primary exhaust plume; visual-only and collision-free.', 'main-flame');
    flame.rotation.x = Math.PI / 2;
    flame.position.set(0, 0.66, SHIP_COMPONENT_CLEARANCE_CONTRACT.mainPlumeRootZM);

    const innerFlame = addEffect(new THREE.Mesh(modeling.createRadialGeometry({
      THREE,
      profile: [[0, 0.014], [0.16, 0.055], [0.56, 0.10], [1, 0.010]],
      axis: 'y',
      segments: Math.max(12, radialSegments - 4),
      capStart: true,
      capEnd: true
    }), innerEngineMat), 'Animated inner exhaust plume; visual-only and collision-free.', 'inner-flame');
    innerFlame.rotation.x = Math.PI / 2;
    innerFlame.position.set(0, 0.66, SHIP_COMPONENT_CLEARANCE_CONTRACT.mainPlumeRootZM);

    const thrusterRings = [];
    for (const [x, radius] of [[-0.62, 0.12], [0, 0.27], [0.62, 0.12]]) {
      const ringMaterial = neonStripMat.clone();
      ringMaterial.opacity = 0.50;
      const ring = addEffect(new THREE.Mesh(tubeGeometry(
        starOutline(radius, radius * 0.76, 6).map(([px, py]) => [px, py, 0]),
        0.018,
        true,
        12,
        6
      ), ringMaterial), 'Rotating flower-light energy ring; visual-only and collision-free.', `thruster-ring-${x}`);
      ring.position.set(x, x === 0 ? 0.66 : 0.61, x === 0
        ? SHIP_COMPONENT_CLEARANCE_CONTRACT.mainPlumeRootZM
        : SHIP_COMPONENT_CLEARANCE_CONTRACT.sidePlumeRootZM);
      ring.userData.thrustSide = Math.sign(x);
      thrusterRings.push(ring);
    }

    // Four layered light ribbons turn the propulsion wake into a candle-like trail instead of one opaque rocket cone.
    const spiritWakeRibbons = [];
    for (const [index, ribbonSpec] of [
      { side: -1, spread: 0.18, lift: 0.08, opacity: 0.24 },
      { side: 1, spread: 0.18, lift: 0.08, opacity: 0.24 },
      { side: -1, spread: 0.34, lift: -0.02, opacity: 0.17 },
      { side: 1, spread: 0.34, lift: -0.02, opacity: 0.17 }
    ].entries()) {
      const material = neonStripMat.clone();
      material.opacity = ribbonSpec.opacity;
      const side = ribbonSpec.side;
      const ribbon = addEffect(
        new THREE.Mesh(tubeGeometry([
          [0.14 * side, 0.67, 1.16],
          [(0.22 + ribbonSpec.spread * 0.28) * side, 0.67 + ribbonSpec.lift * 0.25, 1.58],
          [(0.18 + ribbonSpec.spread) * side, 0.70 + ribbonSpec.lift, 2.02],
          [(0.08 + ribbonSpec.spread * 0.34) * side, 0.74 + ribbonSpec.lift * 0.55, 2.48]
        ], index < 2 ? 0.020 : 0.014, false, tubularSegments, 6), material),
        'Layered candle-wake ribbon; visual-only and collision-free.',
        `spirit-wake-ribbon-${index + 1}`
      );
      ribbon.userData.baseOpacity = ribbonSpec.opacity;
      ribbon.userData.phase = index / SKY_CAPE_ART_CONTRACT.spiritWakeRibbonCount * Math.PI * 2;
      spiritWakeRibbons.push(ribbon);
    }

    // Reverse light-breath exits the forward face of each fixed side pod, below and inside the cloth root.
    const brakeFlareMaterial = modeling.createMaterial({
      THREE,
      kind: 'effect',
      color: 0xf0_4654,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const brakeFlareGeometry = modeling.createRadialGeometry({
      THREE,
      profile: [[0, 0.018], [0.08, 0.095], [0.24, 0.120], [0.45, 0.070], [PROPULSION_CONTRACT.brakePlumeLengthM, 0.015]],
      axis: 'y',
      segments: Math.max(12, radialSegments - 4),
      capStart: true,
      capEnd: true
    });
    const brakeInnerMaterial = modeling.createMaterial({
      THREE,
      kind: 'effect',
      color: 0xff_f1d6,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const brakeInnerGeometry = modeling.createRadialGeometry({
      THREE,
      profile: [[0, 0.010], [0.06, 0.048], [0.18, 0.056], [0.42, 0.010]],
      axis: 'y',
      segments: Math.max(12, radialSegments - 4),
      capStart: true,
      capEnd: true
    });
    // Reuse a sealed side-energy-ring geometry; non-uniform aperture scaling avoids another GPU resource.
    const brakeNozzleGeometry = thrusterRings[0].geometry;
    const brakeFlares = [];
    const brakeInnerFlares = [];
    const brakeNozzleGlows = [];
    for (const x of [-PROPULSION_CONTRACT.brakeNozzleX, PROPULSION_CONTRACT.brakeNozzleX]) {
      const side = x < 0 ? 'left' : 'right';
      const nozzleMaterial = neonStripMat.clone();
      nozzleMaterial.color.setHex(0xf0_4654);
      nozzleMaterial.opacity = 0;
      const nozzleGlow = addEffect(
        new THREE.Mesh(brakeNozzleGeometry, nozzleMaterial),
        'Closed reverse-thruster aperture glow; visual-only and collision-free.',
        `brake-nozzle-${side}`
      );
      nozzleGlow.position.set(
        x,
        PROPULSION_CONTRACT.brakeNozzleY,
        PROPULSION_CONTRACT.brakeNozzleZ
      );
      nozzleGlow.scale.set(0.52, 0.39, 0.78);
      nozzleGlow.visible = false;
      nozzleGlow.renderOrder = 10;
      brakeNozzleGlows.push(nozzleGlow);

      const flare = addEffect(
        new THREE.Mesh(brakeFlareGeometry, brakeFlareMaterial.clone()),
        'Animated forward reverse-thrust plume; visual-only and collision-free.',
        `brake-flare-${side}`
      );
      flare.rotation.x = -Math.PI / 2;
      flare.position.set(
        x,
        PROPULSION_CONTRACT.brakeNozzleY,
        PROPULSION_CONTRACT.brakePlumeAnchorZ
      );
      flare.userData.flickerPhase = x < 0 ? 0 : Math.PI * 0.61;
      flare.visible = false;
      flare.renderOrder = 8;
      brakeFlares.push(flare);

      const innerFlare = addEffect(
        new THREE.Mesh(brakeInnerGeometry, brakeInnerMaterial.clone()),
        'White-hot reverse-thrust core; visual-only and collision-free.',
        `brake-inner-flare-${side}`
      );
      innerFlare.rotation.x = -Math.PI / 2;
      innerFlare.position.copy(flare.position);
      innerFlare.visible = false;
      innerFlare.renderOrder = 9;
      brakeInnerFlares.push(innerFlare);
    }

    // One batched line object supplies peripheral optic flow; deterministic visual slots never consume gameplay RNG.
    const speedStreakCount = constructionQuality.id === 'mobile' ? 20 : 36;
    const speedStreakPositions = new Float32Array(speedStreakCount * 6);
    const speedStreakSlots = [];
    for (let index = 0; index < speedStreakCount; index++) {
      const angle = visualRand(0, Math.PI * 2);
      const radius = visualRand(3.2, 9.4);
      speedStreakSlots.push(Object.freeze({
        x: Math.cos(angle) * radius,
        y: 1.1 + Math.abs(Math.sin(angle)) * radius * 0.66,
        phase: visualRand(0, 1)
      }));
    }
    const speedStreakGeometry = new THREE.BufferGeometry();
    const speedStreakPositionAttribute = new THREE.BufferAttribute(speedStreakPositions, 3);
    speedStreakGeometry.setAttribute('position', speedStreakPositionAttribute);
    const speedStreakMaterial = new THREE.LineBasicMaterial({
      color: 0xd8_f4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });
    const speedStreaks = addEffect(
      new THREE.LineSegments(speedStreakGeometry, speedStreakMaterial),
      'Batched peripheral speed streaks; visual-only and collision-free.',
      'speed-streaks'
    );
    speedStreaks.frustumCulled = false;
    speedStreaks.visible = false;
    let speedStreakTravelM = 0;

    // Cold-start visuals use the same idle packet as runtime, HUD, and audio. Paused pre-launch frames freeze
    // this packet, so seeding it here prevents the exhaust from silently presenting a contradictory zero RPM.
    const propulsionFeedback = derivePropulsionVisualTargets({
      coreSpool: 0,
      coreRpm: PROPULSION_CONTRACT.coreIdleRpm,
      thrustNormalized: 0,
      steeringActuator: 0
    }, {
      brakeBlend: 0,
      brakeHold: 0,
      brakeFlareActive: false,
      brakeFlareCount: 0,
      brakePlumeLength: 0,
      brakePlumeOpacity: 0,
      streakIntensity: 0,
      frozen: false
    });
    // A pre-launch frozen frame returns this packet without running the update path, so seed every optic-flow field
    // through the production resolver before runtime diagnostics can observe it.
    deriveSpeedCueTargets(0, 0, propulsionFeedback, true);

    /**
     * Applies forward-exhaust geometry from the already-resolved core and steering state.
     * Flicker remains presentation-only; plume mean length and energy come from authoritative propulsion before
     * the separate life-form layer applies its established speed-color and damage-state presentation modifiers.
     */
    function applyForwardPropulsionVisuals(dt, now, reducedMotion) {
      const forwardSuppression = 1 - propulsionFeedback.brakeBlend * 0.62;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(now * 0.018) * 0.035;
      const radiusPulse = reducedMotion ? 1 : 1 + Math.sin(now * 0.014 + 0.72) * 0.012;
      const luggingPulseProgress = 0.5 + 0.5 * Math.sin(
        now * PROPULSION_LUGGING_PRESENTATION_CONTRACT.flutterAngularRatePerMillisecond
      );
      const fullLoadFlutterScale = PROPULSION_LUGGING_PRESENTATION_CONTRACT.minimumFlutterScale
        + luggingPulseProgress * (
          PROPULSION_LUGGING_PRESENTATION_CONTRACT.maximumFlutterScale
          - PROPULSION_LUGGING_PRESENTATION_CONTRACT.minimumFlutterScale
        );
      const luggingFlutterScale = reducedMotion
        ? 1
        : 1 - propulsionFeedback.gearLoadNormalized * (1 - fullLoadFlutterScale);
      propulsionFeedback.luggingFlutterScale = luggingFlutterScale;
      const luggingOpacityFlutter = 0.84 + luggingFlutterScale * 0.16;
      flame.scale.set(
        propulsionFeedback.mainPlumeRadius * radiusPulse,
        propulsionFeedback.mainPlumeLength * forwardSuppression * pulse * luggingFlutterScale,
        propulsionFeedback.mainPlumeRadius * radiusPulse
      );
      flame.material.opacity = clamp(
        propulsionFeedback.mainPlumeOpacity
          * (1 - propulsionFeedback.brakeBlend * 0.72)
          * luggingOpacityFlutter,
        0.08,
        0.72
      );
      innerFlame.scale.set(
        propulsionFeedback.innerPlumeRadius * radiusPulse,
        propulsionFeedback.innerPlumeLength * forwardSuppression * pulse * luggingFlutterScale,
        propulsionFeedback.innerPlumeRadius * radiusPulse
      );
      innerFlame.material.opacity = clamp(
        propulsionFeedback.innerPlumeOpacity
          * (1 - propulsionFeedback.brakeBlend * 0.70)
          * luggingOpacityFlutter,
        0.06,
        0.60
      );

      for (const sideFlame of sideFlames) {
        const thrustGain = sideFlame.userData.thrustSide < 0
          ? propulsionFeedback.leftThrust
          : propulsionFeedback.rightThrust;
        const thrustDelta = thrustGain - 1;
        const turnFlutter = reducedMotion
          ? 1
          : 1 + Math.sin(now * 0.031 + sideFlame.userData.flickerPhase)
            * Math.abs(propulsionFeedback.steeringActuator) * 0.015;
        const radius = propulsionFeedback.sidePlumeRadius * (1 + thrustDelta / 3);
        sideFlame.scale.set(
          radius,
          propulsionFeedback.sidePlumeLength
            * forwardSuppression * thrustGain * turnFlutter * luggingFlutterScale,
          radius
        );
        sideFlame.rotation.y = sideFlame.userData.thrustSide
          * propulsionFeedback.steeringActuator * 0.035;
        sideFlame.material.opacity = clamp(
          propulsionFeedback.sidePlumeOpacity * (1 - propulsionFeedback.brakeBlend * 0.72)
            * luggingOpacityFlutter
            + thrustDelta * 0.50 + (turnFlutter - 1) * 0.65,
          0.08,
          0.94
        );
      }
      for (const sideInnerFlame of sideInnerFlames) {
        const thrustGain = sideInnerFlame.userData.thrustSide < 0
          ? propulsionFeedback.leftThrust
          : propulsionFeedback.rightThrust;
        const thrustDelta = thrustGain - 1;
        const turnFlutter = reducedMotion
          ? 1
          : 1 + Math.sin(now * 0.037 + sideInnerFlame.userData.flickerPhase)
            * Math.abs(propulsionFeedback.steeringActuator) * 0.012;
        const innerRadius = propulsionFeedback.innerPlumeRadius * (1 + thrustDelta * 0.28);
        sideInnerFlame.scale.set(
          innerRadius,
          propulsionFeedback.sidePlumeLength
            * 0.72 * forwardSuppression * thrustGain * turnFlutter * luggingFlutterScale,
          innerRadius
        );
        sideInnerFlame.rotation.y = sideInnerFlame.userData.thrustSide
          * propulsionFeedback.steeringActuator * 0.028;
        sideInnerFlame.material.opacity = clamp(
          (propulsionFeedback.innerPlumeOpacity + thrustDelta * 0.55)
            * (1 - propulsionFeedback.brakeBlend * 0.70)
            * luggingOpacityFlutter,
          0.06,
          0.86
        );
      }

      // Core rotation follows spool/RPM instead of vehicle speed; coasting can keep airflow without fake engine load.
      const ringAngularRate = (
        propulsionFeedback.coreSpool * 1.40 + propulsionFeedback.rpmMix * 6.80
      ) * (
        1 - propulsionFeedback.gearLoadNormalized
          * PROPULSION_LUGGING_PRESENTATION_CONTRACT.ringRateReduction
      );
      for (const ring of thrusterRings) {
        const thrustGain = ring.userData.thrustSide < 0
          ? propulsionFeedback.leftThrust
          : ring.userData.thrustSide > 0 ? propulsionFeedback.rightThrust : 1;
        if (!reducedMotion) {
          ring.rotation.z += Math.max(0, dt) * ringAngularRate
            * (1 + (thrustGain - 1) * 0.84);
        }
        ring.material.opacity = clamp(
          0.24 + propulsionFeedback.coreSpool * 0.22
            + propulsionFeedback.thrustNormalized * 0.24
            - propulsionFeedback.brakeBlend * 0.18
            + (thrustGain - 1) * 0.24,
          0.16,
          0.86
        );
      }
      for (const shell of sideEngineShells) {
        const thrustGain = shell.userData.thrustSide < 0
          ? propulsionFeedback.leftThrust
          : propulsionFeedback.rightThrust;
        if (!reducedMotion) {
          shell.rotation.z += Math.max(0, dt)
            * propulsionFeedback.rpmMix * 2.60
            * (1 + (thrustGain - 1) * 0.84);
        }
      }
      for (const part of hardlineGlowParts) {
        const baseOpacity = part.userData.baseOpacity ?? 0.44;
        const phase = Number(part.userData.phase) || 0;
        part.material.opacity = clamp(
          baseOpacity
            + (reducedMotion ? 0 : Math.sin(now * 0.010 + phase) * 0.08)
            + propulsionFeedback.coreSpool * 0.08
            + propulsionFeedback.thrustNormalized * 0.06,
          0,
          1
        );
      }
      wingGlowL.material.opacity = clamp(
        0.54 + propulsionFeedback.coreSpool * 0.16
          + propulsionFeedback.thrustNormalized * 0.12
          + (reducedMotion ? 0 : Math.sin(now * 0.012) * 0.08),
        0.32,
        0.90
      );
      wingGlowR.material.opacity = wingGlowL.material.opacity;
      for (const ribbon of spiritWakeRibbons) {
        const sway = reducedMotion ? 0 : Math.sin(now * 0.004_2 + ribbon.userData.phase);
        ribbon.rotation.y = sway * 0.024;
        ribbon.rotation.x = (reducedMotion
          ? 0
          : Math.sin(now * 0.003_1 + ribbon.userData.phase * 0.7)) * 0.012;
        ribbon.material.opacity = ribbon.userData.baseOpacity
          * (0.64 + propulsionFeedback.coreSpool * 0.14
            + propulsionFeedback.thrustNormalized * 0.22)
          * (1 - propulsionFeedback.brakeBlend * 0.58);
      }
    }

    /**
     * Consumes authoritative propulsion/steering state and updates visual-only exhaust, reverse thrust, and optic flow.
     * `frozen` preserves the complete previous frame, including brake flares and animation phases, while paused.
     */
    function updatePropulsionFeedback(
      dt,
      now,
      speed,
      propulsionState = {},
      reducedMotion = false
    ) {
      if (propulsionState.frozen) {
        propulsionFeedback.frozen = true;
        return propulsionFeedback;
      }
      propulsionFeedback.frozen = false;
      derivePropulsionVisualTargets(propulsionState, propulsionFeedback);
      const braking = Boolean(propulsionState.braking);
      propulsionFeedback.brakeHold = braking
        ? 0.55
        : Math.max(0, propulsionFeedback.brakeHold - Math.max(0, dt));
      const brakeTarget = propulsionFeedback.brakeHold > 0 ? 1 : 0;
      const brakeResponse = brakeTarget > propulsionFeedback.brakeBlend ? 14.0 : 3.2;
      propulsionFeedback.brakeBlend = lerp(
        propulsionFeedback.brakeBlend,
        brakeTarget,
        1 - Math.exp(-Math.max(0, dt) * brakeResponse)
      );
      applyForwardPropulsionVisuals(dt, now, reducedMotion);

      const brakeActive = propulsionFeedback.brakeBlend > 0.015;
      propulsionFeedback.brakeFlareActive = brakeActive;
      propulsionFeedback.brakeFlareCount = brakeActive ? PROPULSION_CONTRACT.brakeNozzleCount : 0;
      for (let index = 0; index < brakeFlares.length; index++) {
        const flare = brakeFlares[index];
        const innerFlare = brakeInnerFlares[index];
        const nozzleGlow = brakeNozzleGlows[index];
        const brakePulse = reducedMotion
          ? 0.93
          : 0.93 + Math.sin(now * 0.032 + flare.userData.flickerPhase) * 0.07;
        const plumeLengthScale = (0.50 + propulsionFeedback.brakeBlend * 0.50) * brakePulse;
        const plumeWidthScale = 0.72 + propulsionFeedback.brakeBlend * 0.28;
        flare.visible = brakeActive;
        innerFlare.visible = brakeActive;
        nozzleGlow.visible = brakeActive;
        flare.scale.set(
          plumeWidthScale,
          plumeLengthScale,
          plumeWidthScale
        );
        flare.material.opacity = propulsionFeedback.brakeBlend * (0.34 + brakePulse * 0.14);
        innerFlare.scale.set(
          0.76 + propulsionFeedback.brakeBlend * 0.16,
          (0.54 + propulsionFeedback.brakeBlend * 0.40) * brakePulse,
          0.76 + propulsionFeedback.brakeBlend * 0.16
        );
        innerFlare.material.opacity = propulsionFeedback.brakeBlend * (0.52 + brakePulse * 0.18);
        const nozzlePulse = 0.96 + propulsionFeedback.brakeBlend * 0.04 + (brakePulse - 0.93) * 0.20;
        nozzleGlow.scale.set(0.52 * nozzlePulse, 0.39 * nozzlePulse, 0.78);
        nozzleGlow.material.opacity = propulsionFeedback.brakeBlend * (0.46 + brakePulse * 0.20);
        if (index === 0) {
          propulsionFeedback.brakePlumeLength = PROPULSION_CONTRACT.brakePlumeLengthM * plumeLengthScale;
          propulsionFeedback.brakePlumeOpacity = flare.material.opacity;
        }
      }
      if (!brakeActive) {
        propulsionFeedback.brakePlumeLength = 0;
        propulsionFeedback.brakePlumeOpacity = 0;
      }

      const speedKmh = Math.max(0, Number(speed) || 0) * 3.6;
      deriveSpeedCueTargets(
        speedKmh,
        propulsionFeedback.thrustNormalized,
        propulsionFeedback,
        reducedMotion
      );
      speedStreakTravelM = reducedMotion
        ? 0
        : (
            speedStreakTravelM + propulsionFeedback.streakTravelMetersPerSecond * Math.max(0, dt)
          ) % PROPULSION_CONTRACT.speedStreakLoopSpanM;
      speedStreaks.visible = propulsionFeedback.streakIntensity > 0.015;
      speedStreakMaterial.opacity = clamp(
        propulsionFeedback.streakIntensity * 0.44
          + propulsionFeedback.brakeBlend * propulsionFeedback.streakIntensity * 0.06,
        0,
        0.50
      );
      if (speedStreaks.visible) {
        const travelProgress = speedStreakTravelM / PROPULSION_CONTRACT.speedStreakLoopSpanM;
        for (let index = 0; index < speedStreakCount; index++) {
          const slot = speedStreakSlots[index];
          const progress = (slot.phase + travelProgress) % 1;
          const z = -32 + progress * PROPULSION_CONTRACT.speedStreakLoopSpanM;
          const offset = index * 6;
          speedStreakPositions[offset] = slot.x;
          speedStreakPositions[offset + 1] = slot.y;
          speedStreakPositions[offset + 2] = z;
          speedStreakPositions[offset + 3] = slot.x;
          speedStreakPositions[offset + 4] = slot.y;
          speedStreakPositions[offset + 5] = z + propulsionFeedback.streakLengthM;
        }
        speedStreakPositionAttribute.needsUpdate = true;
      }
      return propulsionFeedback;
    }

    /**
     * Clears retained visual feedback for a new run and seeds it from the caller's authoritative idle packet.
     * The default remains the shared 1,800 RPM idle so reset visuals cannot contradict the HUD or audio core.
     */
    function resetPropulsionFeedback(propulsionState = {}) {
      propulsionFeedback.brakeBlend = 0;
      propulsionFeedback.brakeHold = 0;
      propulsionFeedback.brakeFlareActive = false;
      propulsionFeedback.brakeFlareCount = 0;
      propulsionFeedback.brakePlumeLength = 0;
      propulsionFeedback.brakePlumeOpacity = 0;
      propulsionFeedback.frozen = false;
      speedStreakTravelM = 0;
      return updatePropulsionFeedback(0, 0, 0, {
        coreSpool: Number.isFinite(propulsionState.coreSpool) ? propulsionState.coreSpool : 0,
        coreRpm: Number.isFinite(propulsionState.coreRpm)
          ? propulsionState.coreRpm
          : PROPULSION_CONTRACT.coreIdleRpm,
        thrustNormalized: Number.isFinite(propulsionState.thrustNormalized)
          ? propulsionState.thrustNormalized
          : 0,
        braking: false,
        steeringActuator: Number.isFinite(propulsionState.steeringActuator)
          ? propulsionState.steeringActuator
          : 0
      }, true);
    }

    function addNavigationLight(x, name, parent, phase = null) {
      const tipMaterial = neonStripMat.clone();
      tipMaterial.opacity = 0.46;
      const tip = addEffect(new THREE.Mesh(loftGeometry([
        { z: -0.08, rx: 0.025, ry: 0.018 },
        { z: 0, rx: 0.085, ry: 0.065 },
        { z: 0.08, rx: 0.025, ry: 0.018 }
      ], 10), tipMaterial), 'Small wing navigation light; visual-only and collision-free.', name, parent);
      tip.position.set(x, 0.88, 0.32);
      tip.userData.phase = Number.isFinite(phase) ? phase : visualRand(0, Math.PI * 2);
      tip.userData.baseOpacity = 0.46;
      hardlineGlowParts.push(tip);
      return tip;
    }

    const leftNavigationLight = addNavigationLight(-2.50, 'wingtip-light-left', leftCapeGroup);
    addNavigationLight(2.50, 'wingtip-light-right-healthy', rightCapeGroups[0], leftNavigationLight.userData.phase);
    addNavigationLight(2.14, 'wingtip-light-right-wounded', rightCapeGroups[1]);
    addNavigationLight(1.48, 'wingtip-light-right-critical', rightCapeGroups[2]);
    // Engine, candle, and damage emitters stay emissive-only. Player-following point sources would illuminate
    // the road without visible fixtures and split into camera-locked lobes when the sealed hull blocks them.

    /*
     * The ward uses edge-weighted transparency instead of a tinted bubble, keeping the ship and road readable.
     * Its star orbits and anchors are presentation-only children; no mesh is registered as collision geometry.
     */
    const shield = new THREE.Group();
    markEffect(
      shield,
      'Temporary invulnerability ward; presentation-only and collision-free.',
      'shield'
    );
    player.add(shield);
    /*
     * ShaderMaterial does not inject fog uniforms when `fog` is enabled. Clone Three's canonical fog block into
     * this material so the renderer's refreshFogUniforms path is valid when a first collision reveals the ward.
     */
    const shieldFieldUniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uFieldColor: { value: new THREE.Color(0x9f_e7df) },
        uEdgeColor: { value: new THREE.Color(0xff_e5a8) },
        uOpacity: { value: 0 },
        uTravel: { value: 0 },
        uImpact: { value: 0 },
        uProgress: { value: 0 }
      }
    ]);
    const shieldFieldMaterial = new THREE.ShaderMaterial({
      name: 'Neon.DawnStarwardFieldMaterial',
      uniforms: shieldFieldUniforms,
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec3 vShieldLocalPosition;
        varying vec3 vShieldViewNormal;
        varying vec3 vShieldViewDirection;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vShieldLocalPosition = position;
          vShieldViewNormal = normalize(normalMatrix * normal);
          vShieldViewDirection = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 uFieldColor;
        uniform vec3 uEdgeColor;
        uniform float uOpacity;
        uniform float uTravel;
        uniform float uImpact;
        uniform float uProgress;
        varying vec3 vShieldLocalPosition;
        varying vec3 vShieldViewNormal;
        varying vec3 vShieldViewDirection;
        void main() {
          float facing = abs(dot(normalize(vShieldViewNormal), normalize(vShieldViewDirection)));
          float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), 2.35);
          float starWind = 0.5 + 0.5 * sin(
            vShieldLocalPosition.z * 5.4
            + vShieldLocalPosition.x * 1.7
            - uTravel * 2.2
          );
          float windThread = smoothstep(0.82, 1.0, starWind) * fresnel;
          float impactCrown = pow(fresnel, 0.72) * uImpact;
          float alpha = uOpacity * clamp(
            fresnel * (0.80 + uProgress * 0.12) + windThread * 0.14 + impactCrown * 0.16,
            0.0,
            1.0
          );
          vec3 colour = mix(uFieldColor, uEdgeColor, clamp(fresnel * 0.62 + windThread * 0.38, 0.0, 1.0));
          gl_FragColor = vec4(colour, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      transparent: true,
      opacity: 1,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      fog: true,
      toneMapped: false
    });
    shieldFieldMaterial.userData.neon = {
      kind: 'effect',
      contract: INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.themeId
    };
    const shieldField = addEffect(new THREE.Mesh(loftGeometry([
      { z: -2.48, rx: 0.16, ry: 0.10, cy: 0.88 },
      { z: -1.82, rx: 1.78, ry: 0.74, cy: 0.88 },
      { z: 0, rx: 3.16, ry: 1.18, cy: 0.88 },
      { z: 1.82, rx: 1.78, ry: 0.74, cy: 0.88 },
      { z: 2.48, rx: 0.16, ry: 0.10, cy: 0.88 }
    ], radialSegments + 8), shieldFieldMaterial), 'Centre-clear dawn ward field; visual-only and collision-free.', 'shield-field', shield);
    shieldField.renderOrder = 18;

    function shieldOrbitPoints(kind, segments = radialSegments + 8) {
      const points = [];
      for (let index = 0; index < segments; index++) {
        const fraction = index / Math.max(1, segments - 1);
        const angle = kind === 'horizon'
          ? Math.PI * (0.72 + fraction * 1.56)
          : kind === 'meridian'
            ? Math.PI * (0.28 + fraction * 1.44)
            : Math.PI * (0.15 + fraction * 1.70);
        if (kind === 'horizon') {
          points.push([
            Math.cos(angle) * 3.22,
            0.88 + Math.sin(angle * 2) * 0.055,
            Math.sin(angle) * 2.54
          ]);
        } else if (kind === 'meridian') {
          points.push([
            Math.sin(angle * 2) * 0.34,
            0.88 + Math.sin(angle) * 1.22,
            Math.cos(angle) * 2.56
          ]);
        } else {
          points.push([
            Math.cos(angle) * 3.20,
            0.88 + Math.sin(angle) * 1.21,
            0.08 + Math.sin(angle * 3) * 0.12
          ]);
        }
      }
      return points;
    }

    const shieldOrbitSpecs = [
      ['horizon', 0x9f_e7df, 0.024],
      ['meridian', 0xff_e5a8, 0.022],
      ['crown', 0xbd_a7ff, 0.020]
    ];
    const shieldOrbitArcs = shieldOrbitSpecs.map(([kind, color, radius], index) => {
      const material = modeling.createMaterial({
        THREE,
        kind: 'effect',
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const arc = addEffect(
        new THREE.Mesh(
          tubeGeometry(shieldOrbitPoints(kind), radius, false, radialSegments + 8, 6),
          material
        ),
        `Dawn ward ${kind} orbit; visual-only and collision-free.`,
        `shield-orbit-${kind}`,
        shield
      );
      arc.userData.baseOpacityFactor = 1 - index * 0.12;
      arc.renderOrder = 19 + index;
      return arc;
    });

    const shieldAnchorGeometry = loftGeometry([
      { z: -0.08, rx: 0.012, ry: 0.012 },
      { z: -0.045, rx: 0.055, ry: 0.055 },
      { z: 0, rx: 0.085, ry: 0.085 },
      { z: 0.045, rx: 0.055, ry: 0.055 },
      { z: 0.08, rx: 0.012, ry: 0.012 }
    ], 10);
    const shieldAnchorMaterial = modeling.createMaterial({
      THREE,
      kind: 'effect',
      color: 0xff_f8e8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const shieldAnchorPositions = [
      [0, 0.88, -2.34],
      [-2.80, 0.88, 0],
      [2.80, 0.88, 0],
      [-1.42, 1.45, 1.70],
      [1.42, 1.45, 1.70]
    ];
    const shieldAnchors = addEffect(
      new THREE.InstancedMesh(
        shieldAnchorGeometry,
        shieldAnchorMaterial,
        INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.anchorCount
      ),
      'Instanced dawn ward anchors; visual-only and collision-free.',
      'shield-anchor-array',
      shield
    );
    shieldAnchors.name = 'Neon.ShipEffect.shield-anchor-array';
    shieldAnchors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shieldAnchors.frustumCulled = false;
    shieldAnchors.renderOrder = 23;
    const shieldAnchorMatrix = new THREE.Matrix4();
    const shieldAnchorPosition = new THREE.Vector3();
    const shieldAnchorScale = new THREE.Vector3(1, 1, 1);
    const shieldAnchorRotation = new THREE.Quaternion();
    for (const [index, position] of shieldAnchorPositions.entries()) {
      shieldAnchorPosition.set(...position);
      shieldAnchorMatrix.compose(
        shieldAnchorPosition,
        shieldAnchorRotation,
        shieldAnchorScale
      );
      shieldAnchors.setMatrixAt(index, shieldAnchorMatrix);
    }
    shieldAnchors.instanceMatrix.needsUpdate = true;
    shield.userData.presentation = {
      field: shieldField,
      orbitArcs: shieldOrbitArcs,
      anchors: shieldAnchors
    };
    shield.visible = false;
    let shieldTravelSeconds = 0;
    const shieldPresentationScratch = {};
    const shieldPalette = {
      cyan: new THREE.Color(0x9f_e7df),
      gold: new THREE.Color(0xff_e5a8),
      violet: new THREE.Color(0xbd_a7ff),
      field: new THREE.Color(),
      horizon: new THREE.Color(),
      meridian: new THREE.Color(),
      crown: new THREE.Color()
    };

    /** Restore every shield layer to a hidden, deterministic baseline without changing gameplay state. */
    function resetInvulnerabilityShieldPresentation() {
      shieldTravelSeconds = 0;
      shield.visible = false;
      shield.scale.setScalar(1);
      shield.rotation.set(0, 0, 0);
      shieldFieldUniforms.uOpacity.value = 0;
      shieldFieldUniforms.uTravel.value = 0;
      shieldFieldUniforms.uImpact.value = 0;
      shieldFieldUniforms.uProgress.value = 0;
      for (const arc of shieldOrbitArcs) {
        arc.material.opacity = 0;
        arc.rotation.set(0, 0, 0);
      }
      shieldAnchorMaterial.opacity = 0;
      shieldAnchors.count = INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.anchorCount;
      shieldAnchorScale.set(1, 1, 1);
      for (const [index, position] of shieldAnchorPositions.entries()) {
        shieldAnchorPosition.set(...position);
        shieldAnchorMatrix.compose(
          shieldAnchorPosition,
          shieldAnchorRotation,
          shieldAnchorScale
        );
        shieldAnchors.setMatrixAt(index, shieldAnchorMatrix);
      }
      shieldAnchors.instanceMatrix.needsUpdate = true;
      return true;
    }

    /**
     * Expose every collision-only ward material at zero opacity during startup compilation. The matching reset must
     * run in a `finally` block so neither a successful compile nor a shader failure can leak the ward into gameplay.
     */
    function prepareInvulnerabilityShieldCompilation() {
      resetInvulnerabilityShieldPresentation();
      shield.visible = true;
      shieldField.visible = true;
      for (const arc of shieldOrbitArcs) {
        arc.visible = true;
        arc.material.opacity = 0;
      }
      shieldAnchors.visible = true;
      shieldAnchors.count = INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.anchorCount;
      shieldAnchorMaterial.opacity = 0;
      return true;
    }

    /**
     * Project the caller's authoritative invulnerability remainder into the dawn ward.
     * Paused and Reduced Motion frames preserve a static field; quality only removes secondary decoration.
     */
    function updateInvulnerabilityShieldPresentation({
      remainingSeconds = 0,
      totalSeconds = 0,
      impactFeedbackSeconds = 0,
      presentationDt = 0,
      reducedMotion = false,
      frozen = false,
      viewMode = 'external'
    } = {}) {
      const presentation = deriveInvulnerabilityShieldPresentation(
        remainingSeconds,
        totalSeconds,
        impactFeedbackSeconds,
        reducedMotion,
        shieldPresentationScratch
      );
      if (!presentation.active) {
        resetInvulnerabilityShieldPresentation();
        return presentation;
      }
      if (viewMode === 'hood') {
        resetInvulnerabilityShieldPresentation();
        return presentation;
      }

      const elapsed = Math.max(0, Math.min(0.10, Number(presentationDt) || 0));
      if (!presentation.reducedMotion && !frozen) shieldTravelSeconds += elapsed;
      shield.visible = true;
      shield.scale.setScalar(presentation.reducedMotion ? 1 : presentation.scale);
      shield.rotation.set(0, 0, 0);

      shieldPalette.field.copy(shieldPalette.cyan).lerp(
        shieldPalette.gold,
        presentation.warmBlend * 0.58
      );
      shieldFieldUniforms.uFieldColor.value.copy(shieldPalette.field);
      shieldFieldUniforms.uEdgeColor.value.copy(shieldPalette.gold).lerp(
        shieldPalette.violet,
        (1 - presentation.expiry) * 0.18
      );
      shieldFieldUniforms.uOpacity.value = presentation.fieldOpacity;
      shieldFieldUniforms.uTravel.value = presentation.reducedMotion ? 0 : shieldTravelSeconds;
      shieldFieldUniforms.uImpact.value = presentation.impact;
      shieldFieldUniforms.uProgress.value = presentation.progress;

      shieldPalette.horizon.copy(shieldPalette.cyan).lerp(
        shieldPalette.gold,
        presentation.warmBlend * 0.38
      );
      shieldPalette.meridian.copy(shieldPalette.gold).lerp(
        shieldPalette.cyan,
        0.24 + presentation.progress * 0.18
      );
      shieldPalette.crown.copy(shieldPalette.violet).lerp(
        shieldPalette.gold,
        presentation.warmBlend * 0.52
      );
      const orbitColors = [
        shieldPalette.horizon,
        shieldPalette.meridian,
        shieldPalette.crown
      ];
      const orbitDetail = viewMode === 'top'
        ? 0
        : activeRenderQuality === 'high'
          ? INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.orbitArcCount
          : activeRenderQuality === 'low' ? 1 : 2;
      for (const [index, arc] of shieldOrbitArcs.entries()) {
        arc.visible = index < orbitDetail;
        arc.material.opacity = presentation.orbitOpacity * arc.userData.baseOpacityFactor;
        arc.material.color.copy(orbitColors[index]);
      }
      if (presentation.reducedMotion) {
        shieldOrbitArcs[0].rotation.set(0, 0, 0);
        shieldOrbitArcs[1].rotation.set(0.06, 0, -0.10);
        shieldOrbitArcs[2].rotation.set(-0.08, 0.12, 0);
      } else {
        const travel = shieldTravelSeconds * presentation.orbitRate;
        shieldOrbitArcs[0].rotation.set(0, travel, 0);
        shieldOrbitArcs[1].rotation.set(0.06, -travel * 0.72, -0.10 + travel * 0.18);
        shieldOrbitArcs[2].rotation.set(-0.08 + travel * 0.12, travel * 0.46, travel * 0.24);
      }

      const anchorDetail = viewMode === 'top'
        ? 0
        : activeRenderQuality === 'high'
          ? INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT.anchorCount
          : activeRenderQuality === 'low' ? 1 : 3;
      shieldAnchorMaterial.opacity = presentation.anchorOpacity;
      shieldAnchorMaterial.color.copy(shieldPalette.gold).lerp(
        shieldPalette.cyan,
        presentation.progress * 0.22
      );
      const anchorScale = presentation.reducedMotion
        ? 1
        : 0.82 + presentation.expiry * 0.18 + presentation.impact * 0.22;
      shieldAnchors.count = anchorDetail;
      shieldAnchorScale.setScalar(anchorScale);
      for (let index = 0; index < anchorDetail; index++) {
        shieldAnchorPosition.set(...shieldAnchorPositions[index]);
        shieldAnchorMatrix.compose(
          shieldAnchorPosition,
          shieldAnchorRotation,
          shieldAnchorScale
        );
        shieldAnchors.setMatrixAt(index, shieldAnchorMatrix);
      }
      shieldAnchors.instanceMatrix.needsUpdate = true;
      if (viewMode === 'top') {
        topViewHalo.visible = true;
        topViewHalo.material.color.copy(shieldPalette.field);
        topViewHalo.material.opacity = presentation.orbitOpacity;
        topViewHalo.scale.setScalar(
          presentation.reducedMotion
            ? 1
            : 0.94 + presentation.expiry * 0.08 + presentation.impact * 0.10
        );
        topViewHalo.rotation.z = presentation.reducedMotion
          ? 0
          : shieldTravelSeconds * presentation.orbitRate;
      }
      return presentation;
    }

    const topViewHaloMat = modeling.createMaterial({
      THREE,
      kind: 'effect',
      color: 0xff_e5a8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const haloPoints = [];
    for (let i = 0; i < radialSegments + 4; i++) {
      const angle = i / (radialSegments + 4) * Math.PI * 2;
      haloPoints.push([Math.cos(angle) * 2.72, 0, Math.sin(angle) * 1.30]);
    }
    const topViewHalo = addEffect(new THREE.Mesh(tubeGeometry(haloPoints, 0.038, true, radialSegments + 4, 8), topViewHaloMat), 'Top-view orientation halo; visual-only and collision-free.', 'top-view-halo');
    topViewHalo.position.set(0, 1.72, 0.10);
    topViewHalo.visible = false;

    // Damage overlays are closed solids. They decorate sealed life-form meshes but never punch holes into the hull.
    const damageGroup = new THREE.Group();
    damageGroup.name = 'Neon.Ship.DamageEffects';
    player.add(damageGroup);
    const scorchMat = modeling.createMaterial({ THREE, kind: 'effect', color: 0x2f_1e25, transparent: true, opacity: 0, depthWrite: false });
    const crackMat = modeling.createMaterial({ THREE, kind: 'effect', color: 0xf0_6e76, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparkMat = modeling.createMaterial({ THREE, kind: 'effect', color: 0xff_d884, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const smokeMat = modeling.createMaterial({ THREE, kind: 'effect', color: 0x6b_5f66, transparent: true, opacity: 0, depthWrite: false });

    const scorchPlates = [];
    function addScorchPlate(points, y, name) {
      const plate = markEffect(new THREE.Mesh(modeling.createExtrudedProfileGeometry({
        THREE,
        outline: points,
        depth: 0.026,
        bevel: 0.006,
        bevelSegments: 1
      }), scorchMat.clone()), 'Closed scorch overlay; visual-only and does not cut the hull.', name);
      plate.rotation.x = Math.PI / 2;
      plate.position.y = y;
      plate.visible = false;
      damageGroup.add(plate);
      scorchPlates.push(plate);
      return plate;
    }
    addScorchPlate([[-0.50, -0.92], [-0.05, -0.94], [0.02, -0.55], [-0.42, -0.48]], 1.05, 'scorch-nose');
    addScorchPlate([[0.18, -0.06], [0.62, 0.04], [0.54, 0.62], [0.12, 0.48]], 1.03, 'scorch-hull');
    addScorchPlate([[0.86, 0.26], [1.48, 0.38], [1.36, 0.62], [0.84, 0.50]], 0.960, 'scorch-wing-right');
    addScorchPlate([[-1.52, 0.02], [-0.88, 0.16], [-0.84, 0.40], [-1.44, 0.28]], 0.960, 'scorch-wing-left');

    const crackLines = [];
    function addCrack(points, name) {
      const crack = markEffect(new THREE.Mesh(tubeGeometry(points, 0.014, false, 10, 6), crackMat.clone()), 'Sealed emissive crack applique; visual-only and does not split geometry.', name);
      crack.visible = false;
      damageGroup.add(crack);
      crackLines.push(crack);
      return crack;
    }
    addCrack([[-0.18, 1.31, -0.62], [-0.09, 1.27, -0.43], [-0.22, 1.24, -0.21]], 'canopy-crack-left');
    addCrack([[0.18, 1.29, -0.45], [0.08, 1.25, -0.26], [0.23, 1.20, -0.08]], 'canopy-crack-right');
    addCrack([[0.86, 0.986, 0.38], [1.04, 0.982, 0.60], [0.90, 0.974, 0.82]], 'wing-crack-right');

    const sparkBits = [];
    for (let i = 0; i < 14; i++) {
      const bit = markEffect(new THREE.Mesh(prismGeometry(0.032, 0.026, visualRand(0.16, 0.38), 0.008), sparkMat.clone()), 'Tiny animated damage spark; visual-only and collision-free.', `damage-spark-${i}`);
      bit.userData.base = new THREE.Vector3(visualRand(0.56, 1.42), visualRand(0.52, 1.10), visualRand(0.12, 1.34));
      bit.userData.phase = visualRand(0, Math.PI * 2);
      bit.rotation.set(visualRand(-0.8, 0.8), visualRand(-0.8, 0.8), visualRand(-0.8, 0.8));
      bit.visible = false;
      damageGroup.add(bit);
      sparkBits.push(bit);
    }

    const smokePuffs = [];
    for (let i = 0; i < 7; i++) {
      const size = visualRand(0.08, 0.17);
      const puff = markEffect(new THREE.Mesh(loftGeometry([
        { z: -size, rx: size * 0.34, ry: size * 0.28 },
        { z: -size * 0.42, rx: size * 0.92, ry: size * 0.76 },
        { z: size * 0.34, rx: size, ry: size * 0.84 },
        { z: size, rx: size * 0.30, ry: size * 0.24 }
      ], 10), smokeMat.clone()), 'Small animated smoke puff; visual-only and collision-free.', `damage-smoke-${i}`);
      puff.userData.phase = visualRand(0, Math.PI * 2);
      puff.visible = false;
      damageGroup.add(puff);
      smokePuffs.push(puff);
    }

    const shadowHullMaterials = [shadowHullMat];
    const trimMaterials = [trimMat];
    const glassMaterials = [glassMat];
    const capeMaterials = [capeMat];
    const capeInsetMaterials = [capeInsetMat];

    // Keep the runtime-owned object mutable while copying every dimension from the sole collision authority.
    const playerHalf = { ...SURFACE_FOOTPRINT_CONTRACT.colliderHalf };

    const shadowOutline = [];
    for (let i = 0; i < 28; i++) {
      const angle = i / 28 * Math.PI * 2;
      const radius = 1 + Math.sin(angle * 4) * 0.025;
      shadowOutline.push([Math.cos(angle) * radius, Math.sin(angle) * radius * 0.62]);
    }
    const playerShadowMat = modeling.createMaterial({ THREE, kind: 'effect', color: 0x00_0000, transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.NormalBlending });
    const playerShadowGeometry = modeling.createExtrudedProfileGeometry({
      THREE,
      outline: shadowOutline,
      depth: 0.012,
      bevel: 0,
      bevelSegments: 1
    });
    const playerShadow = markEffect(new THREE.Mesh(
      playerShadowGeometry,
      playerShadowMat
    ), 'Subtle ambient-contact grounding below 0.05 opacity; visual-only and collision-free.', 'contact-shadow');
    playerShadow.rotation.x = -Math.PI / 2;
    playerShadow.position.set(0, roadY + 0.04, 0.22);
    playerShadow.scale.set(2.10, 1.28, 1);
    scene.add(playerShadow);

    // The High-only soft contact mask is generated locally and prewarmed with the ship. Low/Medium continue to
    // use the original closed black silhouette, and neither branch creates a light or a road-facing bright pool.
    const contactSize = SHIP_ULTRA_PRESENTATION_CONTRACT.contactShadowTextureSize;
    const contactPixels = new Uint8Array(contactSize * contactSize * 4);
    for (let y = 0; y < contactSize; y++) {
      for (let x = 0; x < contactSize; x++) {
        const nx = (x + 0.5) / contactSize * 2 - 1;
        const ny = (y + 0.5) / contactSize * 2 - 1;
        const radius = Math.sqrt(nx * nx + ny * ny);
        const core = Math.max(0, 1 - radius);
        const alpha = Math.round(255 * core * core * (3 - 2 * core));
        const offset = (y * contactSize + x) * 4;
        contactPixels[offset] = 0;
        contactPixels[offset + 1] = 0;
        contactPixels[offset + 2] = 0;
        contactPixels[offset + 3] = alpha;
      }
    }
    const ultraContactTexture = new THREE.DataTexture(
      contactPixels,
      contactSize,
      contactSize,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    ultraContactTexture.name = 'Neon.Ship.UltraContactShadow';
    ultraContactTexture.minFilter = THREE.LinearFilter;
    ultraContactTexture.magFilter = THREE.LinearFilter;
    ultraContactTexture.generateMipmaps = false;
    ultraContactTexture.needsUpdate = true;
    const ultraPlayerShadowGeometry = new THREE.PlaneGeometry(2.95, 2.14, 1, 1);
    const ultraPlayerShadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00_0000,
      map: ultraContactTexture,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
      blending: THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false
    });
    ultraPlayerShadowMaterial.name = 'Neon.Ship.UltraContactShadowMaterial';
    ultraPlayerShadowMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n        diffuseColor.a = min(1.0, diffuseColor.a * ${SHIP_ULTRA_PRESENTATION_CONTRACT.contactShadowAlphaGain.toFixed(1)});`
      );
    };
    ultraPlayerShadowMaterial.customProgramCacheKey = () => 'neon-ultra-contact-shadow-v1';

    const pbrKeys = Object.freeze([
      'roughness',
      'metalness',
      'clearcoat',
      'clearcoatRoughness',
      'sheen',
      'sheenRoughness',
      'transmission',
      'thickness',
      'envMapIntensity'
    ]);
    const ultraPbrProfiles = new Map([
      [shipMat, Object.freeze({ roughness: 0.46, metalness: 0, clearcoat: 0.28, clearcoatRoughness: 0.42, sheen: 0.32, sheenRoughness: 0.58, envMapIntensity: 1.18 })],
      [shadowHullMat, Object.freeze({ roughness: 0.64, metalness: 0, clearcoat: 0.14, clearcoatRoughness: 0.56, sheen: 0.20, sheenRoughness: 0.66, envMapIntensity: 1.08 })],
      [trimMat, Object.freeze({ roughness: 0.34, metalness: 0.28, clearcoat: 0.32, clearcoatRoughness: 0.34, sheen: 0.24, sheenRoughness: 0.52, envMapIntensity: 1.34 })],
      [glassMat, Object.freeze({ roughness: 0.11, metalness: 0, clearcoat: 0.72, clearcoatRoughness: 0.10, transmission: 0.64, thickness: 0.16, envMapIntensity: 1.36 })],
      [capeMat, Object.freeze({ roughness: 0.74, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.76, sheen: 1, sheenRoughness: 0.58, envMapIntensity: 1.04 })],
      [capeInsetMat, Object.freeze({ roughness: 0.68, metalness: 0, clearcoat: 0.05, clearcoatRoughness: 0.70, sheen: 0.96, sheenRoughness: 0.54, envMapIntensity: 1.08 })]
    ]);
    const basePbrProfiles = new Map();
    for (const material of ultraPbrProfiles.keys()) {
      const snapshot = {};
      for (const key of pbrKeys) {
        if (key in material) snapshot[key] = material[key];
      }
      basePbrProfiles.set(material, Object.freeze(snapshot));
    }

    // Palette constants and mutable targets are construction-time allocations; the per-frame life update reuses them.
    const lifeColorPalette = {
      cool: new THREE.Color(0xf3_e6c8),
      violet: new THREE.Color(0xbd_a7ff),
      magenta: new THREE.Color(0xff_9f87),
      goldWhite: new THREE.Color(0xff_f8e8),
      heatGlow: new THREE.Color(0xff_d884),
      coolGlow: new THREE.Color(0x9f_e7df),
      heatEngine: new THREE.Color(0xff_b58f),
      capeRed: new THREE.Color(0xb7_452f),
      capeSunset: new THREE.Color(0xdf_8a5b),
      capeAsh: new THREE.Color(0x38_232c),
      candleGold: new THREE.Color(0xf3_e6c8),
      candleViolet: new THREE.Color(0xbd_a7ff),
      candleCyan: new THREE.Color(0x9f_e7df)
    };
    const lifeColorScratch = {
      heatBody: new THREE.Color(),
      heatGlow: new THREE.Color(),
      heatEngine: new THREE.Color(),
      candleBody: new THREE.Color(),
      candleGlow: new THREE.Color(),
      candleCape: new THREE.Color(),
      candleCapeInset: new THREE.Color(),
      shipTarget: new THREE.Color(),
      emissiveTarget: new THREE.Color(),
      glassTarget: new THREE.Color(),
      stripTarget: new THREE.Color(),
      engineTarget: new THREE.Color(),
      innerEngineTarget: new THREE.Color(),
      trimTarget: new THREE.Color(),
      trimEmissiveTarget: new THREE.Color(),
      shadowTarget: new THREE.Color(),
      shadowEmissiveTarget: new THREE.Color(),
      capeTarget: new THREE.Color(),
      capeEmissiveTarget: new THREE.Color(),
      capeInsetTarget: new THREE.Color(),
      capeInsetEmissiveTarget: new THREE.Color(),
      dynamicA: new THREE.Color(),
      dynamicB: new THREE.Color()
    };
    const lifeVisualBaseline = {
      flameScaleY: flame.scale.y,
      flameOpacity: flame.material.opacity,
      playerShadowScaleX: playerShadow.scale.x
    };

    /**
     * Convert an authored 60Hz blend into the same wall-clock response at every accepted render cadence.
     * The bounded elapsed input prevents a resume gap from snapping presentation state to its target.
     */
    function resolveLifeFormBlend(referenceBlend, dt) {
      const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 1 / 60;
      return 1 - Math.pow(1 - referenceBlend, elapsed * 60);
    }

    function updateShipLifeForm(
      now,
      flamePulse = 1,
      reducedMotion = false,
      refreshVisualBaseline = false,
      dt = 1 / 60
    ) {
      if (refreshVisualBaseline) {
        // The active renderer has just written authoritative propulsion/shadow bases; paused frames reuse this snapshot.
        lifeVisualBaseline.flameScaleY = flame.scale.y;
        lifeVisualBaseline.flameOpacity = flame.material.opacity;
        lifeVisualBaseline.playerShadowScaleX = playerShadow.scale.x;
      }
      const lives = Math.max(0, state.lives);
      const damageLevel = lives >= 3 ? 0 : lives === 2 ? 1 : 2;
      state.shipLifeForm = lives;

      const healthy = damageLevel === 0;
      const wounded = damageLevel === 1;
      const critical = damageLevel >= 2;
      const pulse = reducedMotion
        ? 0.5
        : 0.5 + 0.5 * Math.sin(now * (critical ? 0.030 : 0.018));
      const flicker = reducedMotion
        ? 0.5
        : 0.5 + 0.5 * Math.sin(now * 0.047 + Math.sin(now * 0.011) * 1.8);
      // Runtime publishes metres per second; this explicit boundary prevents legacy m/s thresholds from silently
      // turning normal road travel into a high-speed heat display.
      const heatTarget = deriveShipHeatTarget((Number(state.speed) || 0) * 3.6);
      const blend08 = resolveLifeFormBlend(0.08, dt);
      const blend085 = resolveLifeFormBlend(0.085, dt);
      const blend09 = resolveLifeFormBlend(0.09, dt);
      const blend10 = resolveLifeFormBlend(0.10, dt);
      state.shipHeat = lerp(state.shipHeat || 0, heatTarget, blend085);
      const heat = state.shipHeat;
      // Squaring the already-smoothed heat keeps first/second gear restrained and reserves the brightest accent for
      // the manually selected 280km/h third-gear platform run without introducing another hidden speed threshold.
      const extremeHeat = heat * heat;
      const candleColorProgress = clamp(Number(state.handling?.colorProgress) || 0, 0, 1);
      state.shipCandleColorProgress = candleColorProgress;
      const candleGoldToViolet = clamp(candleColorProgress * 2, 0, 1);
      const candleVioletToCyan = clamp((candleColorProgress - 0.5) * 2, 0, 1);
      // Growth tint is continuous for every pickup. It enters before damage so critical red remains the final
      // safety cue, while the hull, cape, engine, and glow still share one gold-to-violet-to-cyan progression.
      const candleBody = lifeColorScratch.candleBody.copy(lifeColorPalette.candleGold)
        .lerp(lifeColorPalette.candleViolet, candleGoldToViolet)
        .lerp(lifeColorPalette.candleCyan, candleVioletToCyan);
      const candleGlow = lifeColorScratch.candleGlow.copy(lifeColorPalette.heatGlow)
        .lerp(lifeColorPalette.candleViolet, candleGoldToViolet)
        .lerp(lifeColorPalette.candleCyan, candleVioletToCyan);
      const candleCape = lifeColorScratch.candleCape.copy(lifeColorPalette.candleGold)
        .lerp(lifeColorPalette.candleViolet, candleGoldToViolet)
        .lerp(lifeColorPalette.candleCyan, candleVioletToCyan);
      const candleCapeInset = lifeColorScratch.candleCapeInset.copy(lifeColorPalette.goldWhite)
        .lerp(lifeColorPalette.candleViolet, candleGoldToViolet)
        .lerp(lifeColorPalette.candleCyan, candleVioletToCyan);
      const heatBody = lifeColorScratch.heatBody.copy(lifeColorPalette.cool)
        .lerp(lifeColorPalette.violet, clamp(heat * 1.15, 0, 1))
        .lerp(lifeColorPalette.magenta, clamp((heat - 0.45) / 0.55, 0, 1))
        .lerp(lifeColorPalette.goldWhite, extremeHeat)
        .lerp(candleBody, candleColorProgress * 0.45);
      const heatGlow = lifeColorScratch.heatGlow.copy(lifeColorPalette.heatGlow)
        .lerp(lifeColorPalette.coolGlow, clamp(heat * 1.2, 0, 1))
        .lerp(lifeColorPalette.goldWhite, extremeHeat)
        .lerp(candleGlow, candleColorProgress * 0.65);
      const heatEngine = lifeColorScratch.heatEngine.copy(lifeColorPalette.heatEngine)
        .lerp(lifeColorPalette.heatGlow, clamp(heat * 1.1, 0, 1))
        .lerp(lifeColorPalette.goldWhite, extremeHeat)
        .lerp(candleGlow, candleColorProgress * 0.65);
      // Critical red remains the final safety language even after a fully grown violet/cyan candle profile.
      const damageMix = wounded ? 0.24 : critical ? 0.78 : 0;
      const shipTarget = lifeColorScratch.shipTarget.copy(heatBody).lerp(
        lifeColorScratch.dynamicA.setHex(critical ? 0x6b_3a45 : wounded ? 0xd8_bf8c : 0xf3_e6c8),
        damageMix
      );
      const emissiveTarget = lifeColorScratch.emissiveTarget.copy(heatGlow).lerp(
        lifeColorScratch.dynamicB.setHex(critical ? 0x5a_1f27 : wounded ? 0x6f_5d38 : 0x68_4727),
        damageMix * 0.75
      );
      const glassTarget = lifeColorScratch.glassTarget.copy(lifeColorPalette.goldWhite)
        .lerp(lifeColorPalette.coolGlow, clamp(heat * 1.1, 0, 1))
        .lerp(lifeColorPalette.goldWhite, extremeHeat)
        .lerp(
          lifeColorScratch.dynamicA.setHex(critical ? 0xf0_6e76 : wounded ? 0xff_d884 : 0xff_f8e8),
          damageMix
        );
      const stripTarget = lifeColorScratch.stripTarget.copy(heatGlow).lerp(
        lifeColorScratch.dynamicB.setHex(critical ? 0xf0_6e76 : wounded ? 0xff_b58f : 0xff_d884),
        damageMix * 0.70
      );
      const engineTarget = lifeColorScratch.engineTarget.copy(heatEngine).lerp(
        lifeColorScratch.dynamicA.setHex(critical ? 0xf0_6e76 : wounded ? 0xff_d884 : 0xff_b58f),
        damageMix * 0.56
      );
      const innerEngineTarget = lifeColorScratch.innerEngineTarget.copy(lifeColorPalette.goldWhite)
        .lerp(engineTarget, 0.32);
      const trimTarget = lifeColorScratch.trimTarget.copy(heatBody)
        .lerp(lifeColorPalette.goldWhite, 0.38)
        .lerp(
          lifeColorScratch.dynamicB.setHex(critical ? 0x8b_5660 : wounded ? 0xe0_c98d : 0xe6_c68a),
          damageMix * 0.42
        );
      const trimEmissiveTarget = lifeColorScratch.trimEmissiveTarget.copy(stripTarget).lerp(
        lifeColorScratch.dynamicA.setHex(critical ? 0x5a_1f27 : 0x5e_472c),
        0.42 + damageMix * 0.30
      );
      const shadowTarget = lifeColorScratch.shadowTarget
        .setHex(healthy ? 0x3a_2c35 : wounded ? 0x3f_303a : 0x29_1e27)
        .lerp(shipTarget, 0.16 + heat * 0.12);
      const shadowEmissiveTarget = lifeColorScratch.shadowEmissiveTarget
        .setHex(critical ? 0x31_131a : 0x18_1219)
        .lerp(stripTarget, heat * 0.16 + damageMix * 0.10);
      const capeTarget = lifeColorScratch.capeTarget
        .copy(critical ? lifeColorPalette.capeAsh : lifeColorPalette.capeRed)
        .lerp(lifeColorPalette.violet, heat * (critical ? 0.10 : 0.22))
        .lerp(lifeColorPalette.goldWhite, extremeHeat * 0.12)
        .lerp(candleCape, candleColorProgress * 0.55)
        .lerp(lifeColorScratch.dynamicA.setHex(wounded ? 0x68_4148 : critical ? 0x38_232c : 0xb7_452f), damageMix * 0.48);
      const capeEmissiveTarget = lifeColorScratch.capeEmissiveTarget
        .setHex(critical ? 0x2b_1119 : 0x47_1b18)
        .lerp(stripTarget, 0.10 + heat * 0.16 + damageMix * 0.08);
      const capeInsetTarget = lifeColorScratch.capeInsetTarget
        .copy(lifeColorPalette.capeSunset)
        .lerp(lifeColorPalette.violet, heat * 0.18)
        .lerp(lifeColorPalette.goldWhite, extremeHeat * 0.20)
        .lerp(candleCapeInset, candleColorProgress * 0.55)
        .lerp(lifeColorScratch.dynamicB.setHex(wounded ? 0x91_5a50 : critical ? 0x58_3039 : 0xdf_8a5b), damageMix * 0.62);
      const capeInsetEmissiveTarget = lifeColorScratch.capeInsetEmissiveTarget
        .setHex(critical ? 0x3f_1820 : 0x66_2e22)
        .lerp(stripTarget, 0.14 + heat * 0.20 + damageMix * 0.10);

      shipMat.color.lerp(shipTarget, blend09);
      shipMat.emissive.lerp(emissiveTarget, blend09);
      shipMat.emissiveIntensity = lerp(
        shipMat.emissiveIntensity,
        (healthy ? 0.035 : wounded ? 0.045 : 0.12 + pulse * 0.06) + heat * 0.06 + extremeHeat * 0.05,
        blend08
      );
      for (const material of capeMaterials) {
        material.color.lerp(capeTarget, blend08);
        if (material.emissive) material.emissive.lerp(capeEmissiveTarget, blend08);
        if ('emissiveIntensity' in material) material.emissiveIntensity = lerp(
          material.emissiveIntensity,
          healthy ? 0.028 + heat * 0.03 : wounded ? 0.03 : 0.06 + flicker * 0.04,
          blend08
        );
      }
      for (const material of capeInsetMaterials) {
        material.color.lerp(capeInsetTarget, blend08);
        if (material.emissive) material.emissive.lerp(capeInsetEmissiveTarget, blend08);
        if ('emissiveIntensity' in material) material.emissiveIntensity = lerp(
          material.emissiveIntensity,
          healthy ? 0.035 + heat * 0.04 : wounded ? 0.04 : 0.08 + flicker * 0.05,
          blend08
        );
      }
      for (const material of shadowHullMaterials) {
        material.color.lerp(shadowTarget, blend08);
        if (material.emissive) material.emissive.lerp(shadowEmissiveTarget, blend08);
        if ('emissiveIntensity' in material) material.emissiveIntensity = lerp(
          material.emissiveIntensity,
          critical ? 0.06 + flicker * 0.03 : 0.018 + heat * 0.025,
          blend08
        );
      }
      for (const material of trimMaterials) {
        material.color.lerp(trimTarget, blend08);
        if (material.emissive) material.emissive.lerp(trimEmissiveTarget, blend08);
        if ('emissiveIntensity' in material) material.emissiveIntensity = lerp(
          material.emissiveIntensity,
          healthy ? 0.055 + heat * 0.06 : wounded ? 0.07 : 0.12 + flicker * 0.06,
          blend08
        );
      }
      for (const material of glassMaterials) {
        material.color.lerp(glassTarget, blend10);
        if (material.emissive) material.emissive.lerp(stripTarget, blend10);
        if ('emissiveIntensity' in material) material.emissiveIntensity = lerp(
          material.emissiveIntensity,
          0.10 + heat * 0.08 + extremeHeat * 0.08,
          blend08
        );
      }
      neonStripMat.color.lerp(stripTarget, blend10);
      engineMat.color.lerp(engineTarget, blend10);
      innerEngineMat.color.lerp(innerEngineTarget, blend10);
      wingGlowL.material.color.lerp(stripTarget, blend10);
      wingGlowR.material.color.lerp(stripTarget, blend10);
      for (const sideFlame of sideFlames) sideFlame.material.color.lerp(engineTarget, blend10);
      for (const sideInnerFlame of sideInnerFlames) {
        sideInnerFlame.material.color.lerp(innerEngineTarget, blend10);
      }
      for (const ring of thrusterRings) ring.material.color.lerp(stripTarget, blend10);
      for (const ribbon of spiritWakeRibbons) ribbon.material.color.lerp(stripTarget, blend10);
      for (const part of hardlineGlowParts) part.material.color.lerp(stripTarget, blend10);

      // Each state owns a complete sealed right wing and fin. Visibility swaps never deform a cut surface.
      lifeFormGroups[0].visible = healthy;
      lifeFormGroups[1].visible = wounded;
      lifeFormGroups[2].visible = critical;
      const capeBreath = deriveCapeBreathRad(now, heat, reducedMotion);
      leftCapeGroup.rotation.z = capeBreath;
      for (const capeGroup of rightCapeGroups) {
        capeGroup.rotation.z = -capeBreath;
      }
      finL.rotation.z = healthy ? 0 : wounded ? -0.08 : -0.14;
      wingGlowR.visible = !critical || flicker > 0.22;
      spiritHalo.rotation.z = reducedMotion ? 0 : now * 0.000_22;
      spiritHalo.scale.setScalar(reducedMotion ? 1 : 0.97 + pulse * 0.06);

      for (const [i, plate] of scorchPlates.entries()) {
        plate.visible = damageLevel > 0;
        plate.material.opacity = damageLevel === 0 ? 0 : wounded ? 0.26 + i * 0.018 : 0.48 + pulse * 0.12 + i * 0.015;
      }
      for (const crack of crackLines) {
        crack.visible = damageLevel > 0;
        crack.material.opacity = wounded ? 0.28 + pulse * 0.12 : 0.58 + pulse * 0.26;
      }
      for (const [i, bit] of sparkBits.entries()) {
        bit.visible = critical || (wounded && i < 5 && pulse > 0.62);
        if (bit.visible) {
          const phase = bit.userData.phase;
          bit.position.set(
            bit.userData.base.x + (reducedMotion ? 0 : Math.sin(now * 0.018 + phase) * 0.18),
            bit.userData.base.y + (reducedMotion ? 0 : Math.sin(now * 0.025 + phase) * 0.10),
            bit.userData.base.z + (reducedMotion ? 0 : Math.cos(now * 0.020 + phase) * 0.16)
          );
          bit.material.opacity = critical ? 0.18 + flicker * 0.70 : 0.12 + pulse * 0.34;
          bit.rotation.y = reducedMotion ? 0 : bit.rotation.y + 0.04 + i * 0.002;
        }
      }
      for (const [i, puff] of smokePuffs.entries()) {
        puff.visible = critical && !reducedMotion;
        if (puff.visible) {
          const phase = (now * 0.00072 + i * 0.17) % 1;
          puff.position.set(
            0.30 + Math.sin(now * 0.003 + i) * 0.32,
            1.10 + phase * 1.05,
            0.92 + phase * 1.75
          );
          puff.scale.setScalar(0.7 + phase * 1.85);
          puff.material.opacity = (1 - phase) * 0.24;
        }
      }
      let flameScaleFactor = 1;
      let flameOpacityFactor = 1;
      if (critical) {
        flameScaleFactor = 0.72 + flicker * 0.42;
        flameOpacityFactor = 0.62 + flicker * 0.50;
      } else if (wounded) {
        flameOpacityFactor = 0.88 + pulse * 0.10;
      }
      flame.scale.y = lifeVisualBaseline.flameScaleY * flameScaleFactor;
      const flameOpacity = lifeVisualBaseline.flameOpacity * flameOpacityFactor;
      flame.material.opacity = critical ? clamp(flameOpacity, 0.20, 0.92) : flameOpacity;
      playerShadow.scale.x = lifeVisualBaseline.playerShadowScaleX * (healthy ? 1 : wounded ? 1.05 : 1.12);
    }

    let activeRenderQuality = 'medium';
    let ultraEnabled = false;
    let disposed = false;

    function applyPbrProfile(profileMap) {
      for (const [material, profile] of profileMap) {
        for (const [key, value] of Object.entries(profile)) material[key] = value;
      }
    }

    /** Switch presentation-only ship materials and contact grounding without touching the fixed collision proxy. */
    function setRenderQuality(id) {
      if (disposed) return false;
      const nextQuality = typeof id === 'string' ? id : id?.id;
      const nextUltraEnabled = nextQuality === SHIP_ULTRA_PRESENTATION_CONTRACT.qualityId;
      activeRenderQuality = nextQuality || 'medium';
      if (nextUltraEnabled === ultraEnabled) return false;
      const currentShadowOpacity = Number(playerShadow.material?.opacity) || 0.04;
      ultraEnabled = nextUltraEnabled;
      applyPbrProfile(ultraEnabled ? ultraPbrProfiles : basePbrProfiles);
      playerShadow.geometry = ultraEnabled ? ultraPlayerShadowGeometry : playerShadowGeometry;
      playerShadow.material = ultraEnabled ? ultraPlayerShadowMaterial : playerShadowMat;
      playerShadow.material.opacity = currentShadowOpacity;
      return true;
    }

    /** Publish only presentation diagnostics; speed, route, life, and collision state remain outside this module. */
    function getRenderQualityDiagnostics() {
      let bloomEmitterCount = 0;
      player.traverse((object) => {
        if (object.userData.neonBloom === true) bloomEmitterCount++;
      });
      return Object.freeze({
        activeQuality: activeRenderQuality,
        ultraEnabled,
        pbrVariantMaterialCount: ultraPbrProfiles.size,
        bloomEmitterCount,
        bloomLayer: SHIP_ULTRA_PRESENTATION_CONTRACT.bloomLayer,
        contactShadowMode: ultraEnabled ? 'radial-gradient-black' : 'legacy-subtle-silhouette',
        localLightCount: SHIP_ULTRA_PRESENTATION_CONTRACT.localLightCount,
        tunnelBounceValid,
        tunnelBounceEnclosure,
        tunnelBounceIrradiance,
        tunnelBounceReceiverGain: TUNNEL_BOUNCE_CONTRACT.receiverGain,
        tunnelBounceReceiverMaterialCount: tunnelBounceMaterials.size,
        disposed
      });
    }

    /** Release only ship-owned visual resources; repeated disposal is an allocation-free no-op. */
    function dispose() {
      if (disposed) return false;
      disposed = true;
      tunnelBounceUniform.value.set(0, 0, 0);
      tunnelBounceValid = false;
      tunnelBounceEnclosure = tunnelBounceIrradiance = 0;
      const geometries = new Set([playerShadowGeometry, ultraPlayerShadowGeometry]);
      const materials = new Set([playerShadowMat, ultraPlayerShadowMaterial]);
      const collect = (object) => {
        if (object.geometry?.dispose) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (material?.dispose) materials.add(material);
        }
      };
      player.traverse(collect);
      collect(playerShadow);
      scene.remove(player, playerShadow);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      ultraContactTexture.dispose();
      return true;
    }

    // Initialize the correct sealed life form before the first animation frame.
    lifeFormGroups[0].visible = true;
    lifeFormGroups[1].visible = false;
    lifeFormGroups[2].visible = false;
    setRenderQuality(renderQualityId || launchParams.get('quality') || 'medium');
    void fuselage;
    void wingL;
    void capeInsetL;
    void wingRHealthy;
    void wingRWounded;
    void wingRCritical;
    void finRHealthy;
    void finRWounded;
    void finRCritical;
    void damagedSeamGlow;

    return {
      player,
      engineMat,
      flame,
      innerFlame,
      wingGlowL,
      wingGlowR,
      sideFlames,
      sideInnerFlames,
      sideEngineShells,
      thrusterRings,
      hardlineGlowParts,
      updatePropulsionFeedback,
      resetPropulsionFeedback,
      shield,
      prepareInvulnerabilityShieldCompilation,
      updateInvulnerabilityShieldPresentation,
      resetInvulnerabilityShieldPresentation,
      topViewHalo,
      updateShipLifeForm,
      setRenderQuality,
      setTunnelBounce,
      getRenderQualityDiagnostics,
      dispose,
      playerHalf,
      playerShadow
    };
  }

  return {
    PROPULSION_CONTRACT,
    PROPULSION_LUGGING_PRESENTATION_CONTRACT,
    CRUISE_DYNAMICS_CONTRACT,
    SHIP_HEAT_PRESENTATION_CONTRACT,
    SURFACE_FOOTPRINT_CONTRACT,
    SKY_CAPE_ART_CONTRACT,
    SHIP_COMPONENT_CLEARANCE_CONTRACT,
    COVERED_CLEARANCE_CONTRACT,
    SHIP_ULTRA_PRESENTATION_CONTRACT,
    TUNNEL_BOUNCE_CONTRACT,
    INVULNERABILITY_SHIELD_PRESENTATION_CONTRACT,
    mirrorExtrudedOutline,
    deriveCapeBreathRad,
    deriveInvulnerabilityShieldPresentation,
    deriveTurnThrustTargets,
    derivePropulsionVisualTargets,
    deriveSpeedCueTargets,
    deriveCruiseDynamics,
    deriveShipHeatTarget,
    createShip
  };
})();
