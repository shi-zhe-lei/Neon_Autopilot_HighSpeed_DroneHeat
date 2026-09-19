/*
 * Neon physical lighting kernel.
 * The module owns presentation-only light derivation and Three.js light objects; gameplay state is never accepted.
 */
'use strict';

const NeonLightingModule = (() => {
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
  const clamp01 = (value) => clamp(value, 0, 1);
  const lerp = (from, to, amount) => from + (to - from) * clamp01(amount);
  const smootherstep = (value) => {
    const t = clamp01(value);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  }

  // Each realm keeps its authored color identity while sharing one physical unit and shadow pipeline.
  const ZONE_LIGHTING = deepFreeze([
    {
      id: 'dawn-isle', daylight: 0.74, sunIntensity: 3.25, moonIntensity: 0.34,
      ambientIntensity: 0.86, exposure: 1.18, sunColor: [1.00, 0.79, 0.55],
      ambientColor: [0.67, 0.79, 0.91], sunDirection: [-0.42, 0.82, 0.38]
    },
    {
      id: 'prairie-garden', daylight: 0.86, sunIntensity: 3.70, moonIntensity: 0.24,
      ambientIntensity: 0.94, exposure: 1.16, sunColor: [1.00, 0.91, 0.68],
      ambientColor: [0.69, 0.87, 0.78], sunDirection: [-0.28, 0.90, 0.33]
    },
    {
      id: 'rainforest-glow', daylight: 0.42, sunIntensity: 2.72, moonIntensity: 0.48,
      ambientIntensity: 0.78, exposure: 1.10, sunColor: [0.83, 0.94, 0.82],
      ambientColor: [0.45, 0.73, 0.69], sunDirection: [-0.50, 0.76, 0.42]
    },
    {
      id: 'twilight-valley', daylight: 0.66, sunIntensity: 3.10, moonIntensity: 0.44,
      ambientIntensity: 0.80, exposure: 1.13, sunColor: [1.00, 0.60, 0.43],
      ambientColor: [0.48, 0.66, 0.91], sunDirection: [-0.57, 0.70, 0.43]
    },
    {
      id: 'star-vault', daylight: 0.18, sunIntensity: 1.28, moonIntensity: 0.92,
      ambientIntensity: 0.58, exposure: 1.22, sunColor: [0.66, 0.76, 1.00],
      ambientColor: [0.31, 0.39, 0.73], sunDirection: [-0.36, 0.86, 0.36]
    },
    {
      id: 'eden-eye', daylight: 0.24, sunIntensity: 2.18, moonIntensity: 0.58,
      ambientIntensity: 0.62, exposure: 1.08, sunColor: [1.00, 0.44, 0.30],
      ambientColor: [0.43, 0.31, 0.42], sunDirection: [-0.63, 0.67, 0.32]
    }
  ]);

  const PHYSICAL_LIGHTING_CONTRACT = deepFreeze({
    version: 13,
    mode: 'physical-hdr-shadowed',
    visualOnly: true,
    realmCount: 6,
    renderer: {
      outputColorSpace: 'srgb',
      toneMapping: 'aces-filmic',
      useLegacyLights: false,
      environment: 'float-data-equirectangular-pmrem'
    },
    shadow: {
      typePreference: ['VSMShadowMap', 'PCFSoftShadowMap'],
      primaryMapSize: 4_096,
      localMapSize: 2_048,
      primarySpanM: 360,
      primaryNearM: 0.5,
      primaryFarM: 620,
      primaryBias: -0.000_08,
      primaryNormalBiasM: 0.045,
      localBias: -0.000_12,
      localNormalBiasM: 0.025,
      anchorMode: 'world-space-shadow-texel-quantized',
      supportedMapSizes: [512, 1_024, 2_048, 4_096, 8_192],
      capabilityFallback: 'largest-supported-power-of-two-not-above-max-texture-size'
    },
    environment: {
      width: 64,
      height: 32,
      maximumRadiance: 12,
      signatureStep: 0.025,
      needsPMREMUpdate: true,
      cacheInvalidation: 'source-dispose-on-signature-change'
    },
    toggle: {
      defaultEnabled: true,
      disabledMode: 'flat-ambient-no-projected-shadows',
      fallbackAmbientIntensity: 1.35,
      disablesHdrEnvironment: true,
      disablesShadowMaps: true
    },
    lights: {
      tunnelSpotCount: 6,
      tunnelShadowSpotCount: 2,
      localShadowPrewarmUpdateCount: 2,
      inverseSquareDecay: 2,
      sunDistanceM: 240,
      moonDistanceM: 220,
      lightningDistanceM: 180,
      tunnelDistanceM: 82,
      fixtureReachMarginM: 2,
      tunnelPhysicalSelectionDistanceM: 112,
      tunnelPreviewMaximumDistanceM: 240,
      tunnelDynamicDetailFadeM: 24,
      tunnelCameraIdentityHysteresisM: 24,
      tunnelSpotHandoffReferenceRate: 0.34,
      tunnelSpotHandoffReferenceHz: 60,
      openUnderpassEnclosureMaximum: 0.32,
      openUnderpassFixtureStartBlend: 0.68,
      openUnderpassDarkSunIntensityRange: [0.85, 2.4],
      openUnderpassSolarDominanceRatio: 0.32,
      openUnderpassFixtureReferenceIntensity: 1_400,
      openUnderpassFixtureRoadDistanceM: 6
    },
    bounds: {
      sunIntensity: [0, 6],
      moonIntensity: [0, 2],
      lightningIntensity: [0, 18],
      ambientIntensity: [0.05, 2.5],
      tunnelFixtureIntensity: [0, 24_000],
      exposure: [0.55, 1.6],
      environmentIntensity: [0.04, 1.6],
      directTransmission: [0, 1]
    },
    invariants: {
      viewIndependent: true,
      deterministicLightningInput: true,
      coveredRoutesAttenuateCelestialLight: true,
      openUnderpassesRetainSkyIllumination: true,
      openUnderpassFixturesNeedShadeAndDarkness: true,
      sunDominatesOpenUnderpassFixtures: true,
      fixtureRecordsMustReachTheViewpointOrVisibleApproach: true,
      fixtureRecordsMustMatchTheActiveRoute: true,
      tunnelFixturesPrewarmAhead: true,
      tunnelFixturesStayAuthoredAndConstant: true,
      tunnelFixtureSelectionUsesRouteAndViewpointDistance: true,
      filmFixtureIdentityUsesNearestExactAuthoredRoute: true,
      tunnelSpotHandoffsFadeWithinTheFixedPool: true,
      tunnelIdentityHandoffsFadeBeforeSlotReuse: true,
      tunnelSpotHandoffsUseElapsedTime: true,
      fixtureSelectionAnchorDefaultsToLightingAnchor: true,
      constantOnFixturePowerIgnoresProximity: true,
      residentTunnelIrradianceHasNoDistanceGate: true,
      tunnelFixtureFallbackProhibited: true,
      localShadowMapsPrewarmBeforeGameplay: true,
      tunnelPortalsTransitionContinuously: true,
      hdrEnvironmentTracksEnclosure: true,
      deepTunnelsUseRealLocalLights: true,
      noCameraFollowingGuideLights: true,
      dynamicLocalFixtureLightsAreHighOnly: true,
      noFpsDrivenQualityDowngrade: true,
      noGameplayAuthority: true
    }
  });

  // Low and Medium retain the static authored lighting response without per-frame local emitter work. High adds the
  // presentation-only dynamic fixture and contrast transform here, outside world, weather, and gameplay authority.
  const LIGHTING_PRESENTATION_TIERS = deepFreeze({
    low: {
      id: 'low',
      exposureMultiplier: 1,
      ambientMultiplier: 1,
      sunMultiplier: 1,
      hdrRadianceMultiplier: 1,
      dynamicLocalFixtureLights: false,
      bakeEnvironmentIntensity: true,
      sunDirectionYScale: 1,
      shadowType: 'vsm',
      primarySpanM: 360,
      primaryFarM: 620,
      primaryBias: -0.000_08,
      primaryNormalBiasM: 0.045,
      localBias: -0.000_12,
      localNormalBiasM: 0.025,
      shadowRadius: 3
    },
    medium: {
      id: 'medium',
      exposureMultiplier: 1,
      ambientMultiplier: 1,
      sunMultiplier: 1,
      hdrRadianceMultiplier: 1,
      dynamicLocalFixtureLights: false,
      bakeEnvironmentIntensity: true,
      sunDirectionYScale: 1,
      shadowType: 'vsm',
      primarySpanM: 360,
      primaryFarM: 620,
      primaryBias: -0.000_08,
      primaryNormalBiasM: 0.045,
      localBias: -0.000_12,
      localNormalBiasM: 0.025,
      shadowRadius: 3
    },
    high: {
      id: 'high',
      exposureMultiplier: 0.78,
      ambientMultiplier: 0.58,
      sunMultiplier: 1.12,
      hdrRadianceMultiplier: 0.56,
      dynamicLocalFixtureLights: true,
      bakeEnvironmentIntensity: true,
      sunDirectionYScale: 0.76,
      shadowType: 'pcf-soft',
      primarySpanM: 288,
      primaryFarM: 480,
      primaryBias: -0.000_04,
      primaryNormalBiasM: 0.018,
      localBias: -0.000_08,
      localNormalBiasM: 0.014,
      shadowRadius: 2
    }
  });

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function normalizeDirection(values, fallback) {
    const x = finite(values?.[0], fallback[0]);
    const y = finite(values?.[1], fallback[1]);
    const z = finite(values?.[2], fallback[2]);
    const length = Math.hypot(x, y, z) || 1;
    return Object.freeze([x / length, y / length, z / length]);
  }

  function normalizeColor(values, fallback) {
    const channel = (value, fallbackValue) => Number.isFinite(Number(value))
      ? clamp(Number(value), 0, 4)
      : fallbackValue;
    return Object.freeze([
      channel(values?.[0], fallback[0]),
      channel(values?.[1], fallback[1]),
      channel(values?.[2], fallback[2])
    ]);
  }

  function mixColor(from, to, amount) {
    const t = clamp01(amount);
    return Object.freeze([
      lerp(from[0], to[0], t),
      lerp(from[1], to[1], t),
      lerp(from[2], to[2], t)
    ]);
  }

  function weatherProfileFrom(input) {
    const weather = input?.weather;
    if (typeof weather === 'string') {
      const root = typeof globalThis === 'object' ? globalThis : {};
      return root.NeonWeather?.types?.[weather]?.profile || {};
    }
    return weather?.profile || weather || {};
  }

  function zoneProfileFrom(input) {
    const zoneIndex = Math.round(clamp(finite(input?.zoneIndex), 0, ZONE_LIGHTING.length - 1));
    const nextZoneIndex = Math.round(clamp(
      finite(input?.nextZoneIndex, (zoneIndex + 1) % ZONE_LIGHTING.length),
      0,
      ZONE_LIGHTING.length - 1
    ));
    const zoneBlend = clamp01(finite(input?.zoneBlend));
    const authoredCurrent = ZONE_LIGHTING[zoneIndex];
    const authoredNext = ZONE_LIGHTING[nextZoneIndex];
    const authored = {
      id: zoneBlend > 0 && nextZoneIndex !== zoneIndex
        ? `${authoredCurrent.id}->${authoredNext.id}`
        : authoredCurrent.id,
      daylight: lerp(authoredCurrent.daylight, authoredNext.daylight, zoneBlend),
      sunIntensity: lerp(authoredCurrent.sunIntensity, authoredNext.sunIntensity, zoneBlend),
      moonIntensity: lerp(authoredCurrent.moonIntensity, authoredNext.moonIntensity, zoneBlend),
      ambientIntensity: lerp(authoredCurrent.ambientIntensity, authoredNext.ambientIntensity, zoneBlend),
      exposure: lerp(authoredCurrent.exposure, authoredNext.exposure, zoneBlend),
      sunColor: mixColor(authoredCurrent.sunColor, authoredNext.sunColor, zoneBlend),
      ambientColor: mixColor(authoredCurrent.ambientColor, authoredNext.ambientColor, zoneBlend),
      sunDirection: normalizeDirection(
        authoredCurrent.sunDirection.map((value, index) => (
          lerp(value, authoredNext.sunDirection[index], zoneBlend)
        )),
        authoredCurrent.sunDirection
      )
    };
    const override = input?.zoneLighting || {};
    return {
      zoneIndex,
      nextZoneIndex,
      zoneBlend,
      id: authored.id,
      daylight: clamp01(finite(override.daylight, authored.daylight)),
      sunIntensity: clamp(finite(override.sunIntensity, authored.sunIntensity), 0, 6),
      moonIntensity: clamp(finite(override.moonIntensity, authored.moonIntensity), 0, 2),
      ambientIntensity: clamp(finite(override.ambientIntensity, authored.ambientIntensity), 0.05, 2.5),
      exposure: clamp(finite(override.exposure, authored.exposure), 0.55, 1.6),
      sunColor: normalizeColor(override.sunColor, authored.sunColor),
      ambientColor: normalizeColor(override.ambientColor, authored.ambientColor),
      sunDirection: normalizeDirection(override.sunDirection, authored.sunDirection)
    };
  }

  /**
   * Derive one immutable lighting snapshot from presentation inputs only.
   * `viewMode` is intentionally ignored: switching cameras may refit shadows, but cannot relight the same world state.
   */
  function deriveLightingState(input = {}) {
    const zone = zoneProfileFrom(input);
    const weather = weatherProfileFrom(input);
    const cloudCover = clamp01(weather.cloudCover);
    const cloudDarkness = clamp01(weather.cloudDarkness);
    const dust = clamp01(weather.dust);
    const snow = clamp01(weather.snow);
    const snowCover = clamp01(weather.snowCover);
    const wetness = clamp01(weather.wetness);
    const fog = clamp01(weather.fog);
    const visibility = clamp01(finite(weather.visibility, 1));
    const lightningPotential = clamp01(weather.lightning);
    const lightningPulse = clamp01(input.lightningPulse);
    const reducedMotionScale = input.reducedMotion ? 0.16 : 1;
    const tunnelKind = typeof input.tunnelKind === 'string' ? input.tunnelKind : null;
    const coveredRoute = input.covered === true || tunnelKind !== null;
    const previewTunnelKind = typeof input.previewTunnelKind === 'string'
      ? input.previewTunnelKind
      : null;
    const previewTunnelDistanceM = clamp(
      finite(input.previewTunnelDistanceM, PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM),
      0,
      PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM
    );
    const underpassBlend = clamp01(finite(input.underpassBlend));
    const portalEnclosureBlend = smootherstep(underpassBlend);
    // Tunnel identity is published at the portal boundary, before the player reaches full enclosure. Scaling every
    // floor by the continuous portal blend avoids the former one-frame sun/exposure collapse at tunnel entry.
    const coveredFloor = input.covered ? 0.52 * portalEnclosureBlend : 0;
    const kindFloor = tunnelKind === 'underground-tunnel'
      ? 0.92 * portalEnclosureBlend
      : tunnelKind === 'mountain-tunnel' ? 0.62 * portalEnclosureBlend : 0;
    // An open bridge already casts a physical shadow. Treating its camera-clearance blend as a sealed tunnel
    // double-attenuates the sun/HDR and can black out the frame, so only conditional local fixtures are allowed.
    const openUnderpassEnclosure = coveredRoute
      ? 0
      : underpassBlend * PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassEnclosureMaximum;
    const enclosure = clamp01(Math.max(
      coveredFloor,
      kindFloor,
      coveredRoute ? underpassBlend : openUnderpassEnclosure
    ));
    const deepTunnel = coveredRoute ? smootherstep((enclosure - 0.44) / 0.56) : 0;
    const cloudTransmission = clamp(1 - cloudCover * 0.58 - cloudDarkness * 0.22 - dust * 0.38, 0.06, 1);
    const enclosureTransmission = lerp(1, tunnelKind === 'underground-tunnel' ? 0.012 : 0.08, deepTunnel);
    const directTransmission = clamp01(cloudTransmission * enclosureTransmission);
    const lightningEnergy = lightningPotential * lightningPulse * reducedMotionScale;
    const snowBounce = snowCover * 0.19 + snow * 0.07;

    const sunIntensity = clamp(
      zone.sunIntensity * directTransmission + lightningEnergy * 0.18,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity
    );
    const moonAvailability = clamp01(1.08 - zone.daylight * 0.92);
    const moonIntensity = clamp(
      zone.moonIntensity * moonAvailability * clamp(1 - cloudCover * 0.48 - dust * 0.24, 0.14, 1)
        * lerp(1, 0.025, deepTunnel),
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.moonIntensity
    );
    const lightningIntensity = clamp(
      lightningEnergy * lerp(13.5, 2.8, deepTunnel),
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.lightningIntensity
    );
    const ambientIntensity = clamp(
      zone.ambientIntensity
        * clamp(1 - cloudDarkness * 0.24 - dust * 0.18, 0.42, 1)
        * lerp(1, 0.14, deepTunnel)
        + snowBounce * lerp(1, 0.12, deepTunnel)
        + lightningEnergy * 0.10,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity
    );
    // Local tunnel receivers need the attenuation already applied by the global rig, including weather,
    // snow/lightning additions and intensity floors; dividing by the matching outdoor state avoids double dimming.
    const outdoorSunIntensity = clamp(
      zone.sunIntensity * cloudTransmission + lightningEnergy * 0.18,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity
    );
    const outdoorMoonIntensity = clamp(
      zone.moonIntensity * moonAvailability * clamp(1 - cloudCover * 0.48 - dust * 0.24, 0.14, 1),
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.moonIntensity
    );
    const outdoorLightningIntensity = clamp(
      lightningEnergy * 13.5,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.lightningIntensity
    );
    const outdoorAmbientIntensity = clamp(
      zone.ambientIntensity * clamp(1 - cloudDarkness * 0.24 - dust * 0.18, 0.42, 1)
        + snowBounce + lightningEnergy * 0.10,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity
    );
    const openUnderpassShade = coveredRoute
      ? 0
      : smootherstep(
        (underpassBlend - PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureStartBlend)
          / (1 - PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureStartBlend)
      );
    const [fullFixtureSunIntensity, noFixtureSunIntensity] =
      PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassDarkSunIntensityRange;
    const openUnderpassDarkness = coveredRoute
      ? 0
      : smootherstep(
        (noFixtureSunIntensity - sunIntensity)
          / (noFixtureSunIntensity - fullFixtureSunIntensity)
      );
    // A bridge's real shadow owns the daylight result. Its authored lamps may assist only near the centre of that
    // shadow and only when natural light is weak; the rig later caps their combined road illuminance below the sun.
    const openUnderpassFixtureActivation = openUnderpassShade * openUnderpassDarkness;
    const openUnderpassFixtureIlluminanceBudget = sunIntensity
      * PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassSolarDominanceRatio
      * openUnderpassFixtureActivation;
    // Preview distance chooses which resident fixture records are eligible; it must never behave like an
    // electrical dimmer. Authored constant-on fixtures keep the same power at every valid approach distance.
    const tunnelApproachActivation = previewTunnelKind ? 1 : 0;
    const previewTunnelDepth = previewTunnelKind === 'underground-tunnel' ? 1 : 0.62;
    /*
     * The diffuser is electrically on for the complete authored tunnel. Portal enclosure may still describe the
     * ambient transition, but constant-on fixture records bypass this scalar in the physical-light pool below.
     */
    const coveredFixtureActivation = Math.max(
      smootherstep(enclosure),
      tunnelApproachActivation
    );
    const coveredFixtureIntensity = coveredFixtureActivation
      * (8_200 + deepTunnel * 10_800 + cloudDarkness * 2_400 + dust * 1_300);
    const previewTunnelFixtureIntensity = tunnelApproachActivation
      * (8_200 + previewTunnelDepth * 10_800 + cloudDarkness * 2_400 + dust * 1_300);
    const openUnderpassFixtureIntensity = openUnderpassFixtureActivation
      * PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureReferenceIntensity;
    const tunnelFixtureIntensity = clamp(
      coveredRoute ? coveredFixtureIntensity : openUnderpassFixtureIntensity,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.tunnelFixtureIntensity
    );
    const exposure = clamp(
      zone.exposure
        * (1 - cloudDarkness * 0.13 - dust * 0.09)
        * lerp(1, 0.84, deepTunnel)
        + lightningEnergy * 0.075
        + snowBounce * 0.035,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.exposure
    );
    const outdoorEnvironmentIntensity = clamp(
      (0.42 + zone.daylight * 0.54)
        * clamp(1 - cloudDarkness * 0.30 - dust * 0.26, 0.22, 1)
        + snowBounce * 0.08,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.environmentIntensity
    );
    const environmentIntensity = clamp(
      outdoorEnvironmentIntensity * lerp(1, 0.07, deepTunnel),
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.environmentIntensity
    );

    const coolWeather = Math.max(snow, snowCover, cloudDarkness * 0.42);
    const warmDust = dust * 0.58;
    const sunColor = mixColor(
      mixColor(zone.sunColor, [0.72, 0.84, 1.00], coolWeather * 0.35),
      [1.00, 0.48, 0.24],
      warmDust
    );
    const ambientColor = mixColor(
      mixColor(zone.ambientColor, [0.55, 0.67, 0.86], cloudDarkness * 0.38),
      [0.72, 0.42, 0.25],
      warmDust * 0.72
    );
    const moonColor = Object.freeze([0.58, 0.72, 1.00]);
    const lightningColor = Object.freeze([0.72, 0.84, 1.00]);
    const fixtureTunnelKind = tunnelKind || previewTunnelKind;
    const tunnelColor = mixColor(
      [1.00, 0.67, 0.36],
      [0.67, 0.82, 1.00],
      fixtureTunnelKind === 'underground-tunnel' ? 0.34 : 0.14
    );
    const environmentSunIntensity = clamp(
      zone.sunIntensity * cloudTransmission,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity
    );
    const environmentSignatureStep = PHYSICAL_LIGHTING_CONTRACT.environment.signatureStep;
    const environmentSignature = [
      environmentSunIntensity,
      outdoorEnvironmentIntensity,
      ...sunColor,
      ...ambientColor
    ].map((value) => Math.round(value / environmentSignatureStep)).join('|');
    const signature = [
      zone.zoneIndex,
      sunIntensity,
      moonIntensity,
      lightningIntensity,
      ambientIntensity,
      tunnelFixtureIntensity,
      previewTunnelFixtureIntensity,
      exposure,
      environmentIntensity,
      directTransmission
    ].map((value, index) => index === 0 ? value : value.toFixed(5)).join('|');

    return deepFreeze({
      mode: PHYSICAL_LIGHTING_CONTRACT.mode,
      visualOnly: true,
      zoneIndex: zone.zoneIndex,
      nextZoneIndex: zone.nextZoneIndex,
      zoneBlend: zone.zoneBlend,
      zoneId: zone.id,
      coveredRoute,
      previewTunnelKind,
      previewTunnelDistanceM,
      tunnelApproachActivation,
      coveredFixtureActivation,
      previewTunnelFixtureIntensity,
      openUnderpassEnclosure,
      openUnderpassShade,
      openUnderpassDarkness,
      openUnderpassFixtureActivation,
      openUnderpassFixtureIlluminanceBudget,
      enclosure,
      deepTunnel,
      cloudTransmission,
      directTransmission,
      sunIntensity,
      moonIntensity,
      lightningIntensity,
      ambientIntensity,
      tunnelFixtureIntensity,
      exposure,
      environmentIntensity,
      outdoorSunIntensity,
      outdoorMoonIntensity,
      outdoorLightningIntensity,
      outdoorAmbientIntensity,
      outdoorEnvironmentIntensity,
      environmentSunIntensity,
      environmentSignature,
      wetness,
      snowCover,
      fog,
      visibility,
      lightningPulse: lightningEnergy,
      reducedMotion: Boolean(input.reducedMotion),
      tunnelKind,
      sunColor,
      ambientColor,
      moonColor,
      lightningColor,
      tunnelColor,
      sunDirection: zone.sunDirection,
      illuminationSignature: signature
    });
  }

  function requireObject(value, label) {
    if (!value || typeof value !== 'object') throw new TypeError(`createPhysicalLightingRig requires ${label}`);
    return value;
  }

  function configureShadow(light, mapSize, contract, radius = 2) {
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = contract.localBias;
    light.shadow.normalBias = contract.localNormalBiasM;
    light.shadow.radius = radius;
  }

  function configureDirectionalShadow(light, mapSize = PHYSICAL_LIGHTING_CONTRACT.shadow.primaryMapSize) {
    const shadow = PHYSICAL_LIGHTING_CONTRACT.shadow;
    configureShadow(light, mapSize, shadow, 3);
    const halfSpan = shadow.primarySpanM * 0.5;
    light.shadow.camera.left = -halfSpan;
    light.shadow.camera.right = halfSpan;
    light.shadow.camera.top = halfSpan;
    light.shadow.camera.bottom = -halfSpan;
    light.shadow.camera.near = shadow.primaryNearM;
    light.shadow.camera.far = shadow.primaryFarM;
    light.shadow.bias = shadow.primaryBias;
    light.shadow.normalBias = shadow.primaryNormalBiasM;
    light.shadow.camera.updateProjectionMatrix();
  }

  function setLinearColor(color, values) {
    color.setRGB(values[0], values[1], values[2]);
  }

  function createHdrEnvironmentTexture(THREE) {
    const { width, height } = PHYSICAL_LIGHTING_CONTRACT.environment;
    const data = new Float32Array(width * height * 4);
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.name = 'Neon.PhysicalLighting.HdrEnvironment';
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace ?? THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    texture.userData.neon = {
      modelClass: 'effect',
      reason: 'Procedural HDR environment used only for physical material illumination.'
    };
    texture.needsUpdate = true;
    texture.needsPMREMUpdate = true;
    return texture;
  }

  function refreshHdrEnvironment(texture, state, presentationTier) {
    const { width, height, maximumRadiance } = PHYSICAL_LIGHTING_CONTRACT.environment;
    const data = texture.image.data;
    const horizon = state.ambientColor;
    const zenith = mixColor(state.ambientColor, [0.10, 0.18, 0.34], 0.72);
    /*
     * Three r160 has no reliable scene-wide environmentIntensity. Every quality tier therefore bakes the resolved
     * enclosure strength into HDR radiance; otherwise an outdoor PMREM uniformly lights tunnel concrete and asphalt.
     */
    const environmentStrength = state.environmentIntensity;
    const hdrRadianceMultiplier = presentationTier.hdrRadianceMultiplier;
    const sunU = 0.36;
    const sunV = 0.32;
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height;
      const skyMix = smootherstep(Math.abs(v - 0.5) * 1.8);
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width;
        const wrappedU = Math.min(Math.abs(u - sunU), 1 - Math.abs(u - sunU));
        const sunDistanceSquared = wrappedU * wrappedU + (v - sunV) * (v - sunV);
        const sunDisc = Math.exp(-sunDistanceSquared / 0.000_55)
          * state.environmentSunIntensity
          * environmentStrength
          * hdrRadianceMultiplier;
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const base = lerp(horizon[channel], zenith[channel], skyMix)
            * environmentStrength
            * hdrRadianceMultiplier;
          data[index + channel] = clamp(base + state.sunColor[channel] * sunDisc, 0, maximumRadiance);
        }
        data[index + 3] = 1;
      }
    }
    texture.needsUpdate = true;
    texture.needsPMREMUpdate = true;
  }

  /**
   * Create the production Three.js lighting rig. The returned updater accepts world-space presentation frames only;
   * it cannot access or mutate route, speed, collision, scoring, or input authority.
   */
  function createPhysicalLightingRig(options = {}) {
    const THREE = requireObject(options.THREE, 'THREE r160');
    const renderer = requireObject(options.renderer, 'a renderer');
    const scene = requireObject(options.scene, 'a scene');
    const camera = requireObject(options.camera, 'a camera');
    if (String(THREE.REVISION) !== '160') {
      throw new RangeError(`createPhysicalLightingRig requires Three.js r160; received ${THREE.REVISION ?? 'unknown'}`);
    }
    if (!renderer.shadowMap || typeof scene.add !== 'function' || !camera.position) {
      throw new TypeError('createPhysicalLightingRig received an incomplete renderer, scene, or camera');
    }

    const previousTunnelLightingUniforms = scene.userData.neonTunnelLightingUniforms;
    const hadPreviousTunnelLightingUniforms = Object.prototype.hasOwnProperty.call(
      scene.userData,
      'neonTunnelLightingUniforms'
    );
    // Receivers retain these exact Three uniform entries when their programs compile. Values change in place;
    // another scene/rig must never share this attenuation state or acquire ownership of this rig's cleanup.
    const tunnelLightingUniforms = Object.freeze({
      neonGlobalAmbientTransmission: { value: 1 },
      neonGlobalEnvironmentTransmission: { value: 1 },
      neonGlobalDirectionalTransmission: { value: 1 }
    });
    const previous = {
      outputColorSpace: renderer.outputColorSpace,
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
      shadowEnabled: renderer.shadowMap.enabled,
      shadowType: renderer.shadowMap.type,
      shadowAutoUpdate: renderer.shadowMap.autoUpdate,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity
    };
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Three r160 uses physically correct light units by default. Reading or writing its deprecated
    // useLegacyLights shim emits console warnings, so the pinned revision is the physical-units authority.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap ?? THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.needsUpdate = true;

    const supportedShadowMapSizes = PHYSICAL_LIGHTING_CONTRACT.shadow.supportedMapSizes;
    const rendererMaximumTextureSize = Math.max(
      1,
      Math.floor(finite(renderer.capabilities?.maxTextureSize, 8_192))
    );
    const resolveShadowMapSize = (requestedSize) => {
      const requested = Number(requestedSize);
      if (!supportedShadowMapSizes.includes(requested)) {
        throw new RangeError('Physical-lighting shadow map sizes must use the supported power-of-two contract');
      }
      const effective = [...supportedShadowMapSizes]
        .reverse()
        .find((size) => size <= requested && size <= rendererMaximumTextureSize);
      if (!effective) {
        throw new RangeError('Renderer maxTextureSize is below the minimum physical-lighting shadow contract');
      }
      return effective;
    };
    let requestedSunShadowMapSize = Number(
      options.initialShadowMapSizes?.sun
        ?? options.initialShadowMapSizes?.primary
        ?? PHYSICAL_LIGHTING_CONTRACT.shadow.primaryMapSize
    );
    let requestedSecondaryDirectionalShadowMapSize = Number(
      options.initialShadowMapSizes?.secondaryDirectional
        ?? options.initialShadowMapSizes?.primary
        ?? PHYSICAL_LIGHTING_CONTRACT.shadow.primaryMapSize
    );
    let requestedLocalShadowMapSize = Number(
      options.initialShadowMapSizes?.local
        ?? PHYSICAL_LIGHTING_CONTRACT.shadow.localMapSize
    );
    let effectiveSunShadowMapSize = resolveShadowMapSize(requestedSunShadowMapSize);
    let effectiveSecondaryDirectionalShadowMapSize = resolveShadowMapSize(
      requestedSecondaryDirectionalShadowMapSize
    );
    let effectiveLocalShadowMapSize = resolveShadowMapSize(requestedLocalShadowMapSize);
    const initialRenderQualityId = String(options.initialRenderQualityId || 'medium');
    if (!LIGHTING_PRESENTATION_TIERS[initialRenderQualityId]) {
      throw new RangeError(`Unknown physical-lighting render quality: ${initialRenderQualityId}`);
    }

    const group = new THREE.Group();
    group.name = 'Neon.PhysicalLightingRig';
    group.userData.neon = {
      modelClass: 'effect',
      reason: 'Presentation-only physical lights and their targets.'
    };

    const ambient = new THREE.HemisphereLight(0xff_ffff, 0x20_2938, 1);
    ambient.name = 'Neon.PhysicalLighting.Ambient';
    group.add(ambient);

    const createDirectional = (name, mapSize) => {
      const light = new THREE.DirectionalLight(0xff_ffff, 0);
      light.name = name;
      const target = new THREE.Object3D();
      target.name = `${name}.Target`;
      light.target = target;
      configureDirectionalShadow(light, mapSize);
      group.add(light, target);
      return { light, target };
    };
    const sun = createDirectional('Neon.PhysicalLighting.Sun', effectiveSunShadowMapSize);
    const moon = createDirectional(
      'Neon.PhysicalLighting.Moon',
      effectiveSecondaryDirectionalShadowMapSize
    );
    const lightning = createDirectional(
      'Neon.PhysicalLighting.Lightning',
      effectiveSecondaryDirectionalShadowMapSize
    );

    const tunnelSpots = Array.from(
      { length: PHYSICAL_LIGHTING_CONTRACT.lights.tunnelSpotCount },
      (_, index) => {
        const light = new THREE.SpotLight(
          0xff_d5a0,
          0,
          PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM,
          Math.PI * 0.28,
          0.86,
          PHYSICAL_LIGHTING_CONTRACT.lights.inverseSquareDecay
        );
        light.name = `Neon.PhysicalLighting.Tunnel.${index}`;
        const target = new THREE.Object3D();
        target.name = `${light.name}.Target`;
        light.target = target;
        if (index < PHYSICAL_LIGHTING_CONTRACT.lights.tunnelShadowSpotCount) {
          configureShadow(light, effectiveLocalShadowMapSize, PHYSICAL_LIGHTING_CONTRACT.shadow, 2);
        } else {
          light.castShadow = false;
        }
        light.shadow.camera.near = 0.2;
        light.shadow.camera.far = PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM;
        light.shadow.camera.updateProjectionMatrix();
        group.add(light, target);
        return { light, target };
      }
    );

    const physicalLights = Object.freeze([
      ambient,
      sun.light,
      moon.light,
      lightning.light,
      ...tunnelSpots.map((item) => item.light)
    ]);
    for (const light of physicalLights) {
      light.userData.neon = {
        modelClass: 'effect',
        reason: 'Real presentation light; never part of collision or gameplay authority.'
      };
    }

    // Disabling the authored rig must not make tunnels unplayably black: this non-directional fallback preserves
    // route readability without HDR reflections, local lights, directional shading, or any shadow-map work.
    const fallbackAmbient = new THREE.AmbientLight(
      0xff_ffff,
      PHYSICAL_LIGHTING_CONTRACT.toggle.fallbackAmbientIntensity
    );
    fallbackAmbient.name = 'Neon.PhysicalLighting.FlatVisibilityFallback';
    fallbackAmbient.visible = false;
    fallbackAmbient.userData.neon = {
      modelClass: 'effect',
      reason: 'Shadow-free visibility floor used only while the player disables physical lighting effects.'
    };

    const environmentTexture = createHdrEnvironmentTexture(THREE);
    scene.environment = environmentTexture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = 1;
    scene.add(group, fallbackAmbient);

    const rawAnchor = new THREE.Vector3();
    const fixtureSelectionAnchor = new THREE.Vector3();
    const quantizedAnchor = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const scratch = new THREE.Vector3();
    const sunDirection = new THREE.Vector3();
    let shadowMapResizeCount = 0;
    let shadowTexelWorldSizeM = PHYSICAL_LIGHTING_CONTRACT.shadow.primarySpanM
      / effectiveSunShadowMapSize;
    let lastState = deriveLightingState();
    let lastEnvironmentSignature = '';
    let environmentRefreshCount = 0;
    let environmentCacheInvalidationCount = 0;
    let environmentSourceTransmission = 1;
    let shadowAnchorErrorM = 0;
    let updateCount = 0;
    let tunnelEmitterMode = 'inactive';
    let scannedFixtureEmitterRecordCount = 0;
    let availableTunnelEmitterRecordCount = 0;
    let eligibleFixtureEmitterRecordCount = 0;
    let reachableFixtureEmitterRecordCount = 0;
    let matchedTunnelEmitterRecordCount = 0;
    let nearestAvailableFixtureDistanceM = Number.POSITIVE_INFINITY;
    let nearestMatchedFixtureDistanceM = Number.POSITIVE_INFINITY;
    let requestedFixtureRouteEdgeId = null;
    let requestedFixtureRouteEdgeS = null;
    let requestedTunnelProfileId = null;
    let tunnelFixtureAlignmentMaximumErrorM = 0;
    let estimatedOpenFixtureRoadIlluminance = 0;
    let maximumOpenFixtureRoadIlluminance = 0;
    let activeTunnelEmitterIds = Object.freeze([]);
    let activeTunnelSpotEmitterIds = Object.freeze([]);
    let activeTunnelSpotIdentityKeys = Object.freeze([]);
    let fixtureSelectionIdentitySource = 'inactive';
    let selectedFixtureIdentityKey = null;
    let tunnelIdentityTransitionPendingKey = null;
    let cameraFixtureIdentityKey = null;
    let cameraFixtureIdentityHandoffCount = 0;
    let tunnelSpotHandoffCount = 0;
    let tunnelSpotPendingEmitterCount = 0;
    const tunnelSpotBindings = tunnelSpots.map(() => ({
      emitterId: null,
      identityKey: null,
      entry: null,
      gain: 0,
      fadingOut: false
    }));
    // Only High pays the two-frame local-shadow warm-up. Low/Medium never expose zero-power spots to the renderer,
    // which prevents a mobile GPU from allocating local shadow targets merely because the reusable pool exists.
    let localShadowPrewarmUpdatesRemaining = LIGHTING_PRESENTATION_TIERS[initialRenderQualityId]
      .dynamicLocalFixtureLights
      ? PHYSICAL_LIGHTING_CONTRACT.lights.localShadowPrewarmUpdateCount
      : 0;
    let localShadowPrewarmScheduledCount = 0;
    let lightingEnabled = PHYSICAL_LIGHTING_CONTRACT.toggle.defaultEnabled;
    let toggleCount = 0;
    let activeRenderQualityId = initialRenderQualityId;
    let renderQualitySwitchCount = 0;
    let disposed = false;

    const copyFiniteVector = (target, value, fallback) => {
      target.set(
        finite(value?.x, fallback.x),
        finite(value?.y, fallback.y),
        finite(value?.z, fallback.z)
      );
      return target;
    };
    const normalizeBasis = (target, value, fallback) => {
      copyFiniteVector(target, value, fallback);
      if (target.lengthSq() < 0.000_001) target.copy(fallback);
      return target.normalize();
    };
    const getPresentationTier = () => LIGHTING_PRESENTATION_TIERS[activeRenderQualityId];
    const getEffectiveExposure = () => clamp(
      lastState.exposure * getPresentationTier().exposureMultiplier,
      ...PHYSICAL_LIGHTING_CONTRACT.bounds.exposure
    );
    const getEffectiveEnvironmentSignature = () => {
      const tier = getPresentationTier();
      const strengthStep = PHYSICAL_LIGHTING_CONTRACT.environment.signatureStep;
      const quantizedStrength = Math.round(lastState.environmentIntensity / strengthStep);
      return [
        lastState.environmentSignature,
        tier.id,
        quantizedStrength,
        tier.hdrRadianceMultiplier.toFixed(5)
      ].join('|');
    };
    const getShadowSizeResult = () => deepFreeze({
      requested: {
        sun: requestedSunShadowMapSize,
        secondaryDirectional: requestedSecondaryDirectionalShadowMapSize,
        local: requestedLocalShadowMapSize
      },
      effective: {
        sun: effectiveSunShadowMapSize,
        secondaryDirectional: effectiveSecondaryDirectionalShadowMapSize,
        local: effectiveLocalShadowMapSize
      },
      // Primary remains a compatibility alias for integrations written before directional shadows were split.
      primary: effectiveSunShadowMapSize,
      sun: effectiveSunShadowMapSize,
      secondaryDirectional: effectiveSecondaryDirectionalShadowMapSize,
      local: effectiveLocalShadowMapSize,
      maxTextureSize: rendererMaximumTextureSize,
      fallbackApplied: effectiveSunShadowMapSize !== requestedSunShadowMapSize
        || effectiveSecondaryDirectionalShadowMapSize !== requestedSecondaryDirectionalShadowMapSize
        || effectiveLocalShadowMapSize !== requestedLocalShadowMapSize
    });

    function clearTunnelSpotBinding(binding) {
      binding.emitterId = null;
      binding.identityKey = null;
      binding.entry = null;
      binding.gain = 0;
      binding.fadingOut = false;
    }

    /**
     * Clear every dynamic-fixture match and extinguish the reusable pool synchronously. This is the quality-tier
     * boundary: Low/Medium must not inherit a High Film identity, handoff, visible zero-power spot, or warm-up job.
     */
    function deactivateDynamicLocalFixtureLights() {
      localShadowPrewarmUpdatesRemaining = 0;
      localShadowPrewarmScheduledCount = 0;
      tunnelEmitterMode = 'inactive';
      scannedFixtureEmitterRecordCount = 0;
      availableTunnelEmitterRecordCount = 0;
      eligibleFixtureEmitterRecordCount = 0;
      reachableFixtureEmitterRecordCount = 0;
      matchedTunnelEmitterRecordCount = 0;
      nearestAvailableFixtureDistanceM = Number.POSITIVE_INFINITY;
      nearestMatchedFixtureDistanceM = Number.POSITIVE_INFINITY;
      requestedFixtureRouteEdgeId = null;
      requestedFixtureRouteEdgeS = null;
      requestedTunnelProfileId = null;
      tunnelFixtureAlignmentMaximumErrorM = 0;
      estimatedOpenFixtureRoadIlluminance = 0;
      maximumOpenFixtureRoadIlluminance = 0;
      activeTunnelEmitterIds = Object.freeze([]);
      activeTunnelSpotEmitterIds = Object.freeze([]);
      activeTunnelSpotIdentityKeys = Object.freeze([]);
      fixtureSelectionIdentitySource = 'inactive';
      selectedFixtureIdentityKey = null;
      tunnelIdentityTransitionPendingKey = null;
      cameraFixtureIdentityKey = null;
      cameraFixtureIdentityHandoffCount = 0;
      tunnelSpotHandoffCount = 0;
      tunnelSpotPendingEmitterCount = 0;
      for (const binding of tunnelSpotBindings) clearTunnelSpotBinding(binding);
      for (const { light } of tunnelSpots) {
        light.intensity = 0;
        light.visible = false;
      }
    }

    /** Release only local spot shadow targets; directional shadows remain owned by their active tier. */
    function releaseLocalShadowTargets() {
      for (const { light } of tunnelSpots) {
        light.shadow.map?.dispose?.();
        light.shadow.mapPass?.dispose?.();
        light.shadow.map = null;
        light.shadow.mapPass = null;
      }
    }

    function applyShadowPresentation() {
      const tier = getPresentationTier();
      renderer.shadowMap.type = tier.shadowType === 'pcf-soft'
        ? THREE.PCFSoftShadowMap ?? THREE.VSMShadowMap
        : THREE.VSMShadowMap ?? THREE.PCFSoftShadowMap;
      const halfSpan = tier.primarySpanM * 0.5;
      for (const { light } of [sun, moon, lightning]) {
        light.shadow.camera.left = -halfSpan;
        light.shadow.camera.right = halfSpan;
        light.shadow.camera.top = halfSpan;
        light.shadow.camera.bottom = -halfSpan;
        light.shadow.camera.near = PHYSICAL_LIGHTING_CONTRACT.shadow.primaryNearM;
        light.shadow.camera.far = tier.primaryFarM;
        light.shadow.bias = tier.primaryBias;
        light.shadow.normalBias = tier.primaryNormalBiasM;
        light.shadow.radius = tier.shadowRadius;
        light.shadow.camera.updateProjectionMatrix();
      }
      for (const { light } of tunnelSpots) {
        light.shadow.bias = tier.localBias;
        light.shadow.normalBias = tier.localNormalBiasM;
        light.shadow.radius = Math.min(tier.shadowRadius, 2);
      }
      shadowTexelWorldSizeM = tier.primarySpanM / effectiveSunShadowMapSize;
    }

    function applyAuthoredLightPresentation() {
      const tier = getPresentationTier();
      sun.light.intensity = clamp(
        lastState.sunIntensity * tier.sunMultiplier,
        ...PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity
      );
      sun.light.visible = sun.light.intensity > 0.000_1;
      ambient.intensity = clamp(
        lastState.ambientIntensity * tier.ambientMultiplier,
        ...PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity
      );
      renderer.toneMappingExposure = getEffectiveExposure();
    }

    /** Publish already-applied global attenuation; local shaders may only attenuate its remaining difference. */
    function updateTunnelLightingUniforms() {
      const tier = getPresentationTier();
      const ratio = (actual, outdoor) => outdoor > 0 ? clamp01(actual / outdoor) : 1;
      const outdoorAmbient = clamp(
        lastState.outdoorAmbientIntensity * tier.ambientMultiplier,
        ...PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity
      );
      const outdoorSun = clamp(
        lastState.outdoorSunIntensity * tier.sunMultiplier,
        ...PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity
      );
      tunnelLightingUniforms.neonGlobalAmbientTransmission.value = lightingEnabled
        ? ratio(ambient.intensity, outdoorAmbient)
        : 1;
      tunnelLightingUniforms.neonGlobalEnvironmentTransmission.value = lightingEnabled
        ? environmentSourceTransmission
        : 1;
      // Sun, moon and lightning have different authored enclosure curves. The lowest existing ratio is
      // conservative: a shared directional factor must not darken any already-enclosed celestial source twice.
      tunnelLightingUniforms.neonGlobalDirectionalTransmission.value = lightingEnabled
        ? Math.min(
            ratio(sun.light.intensity, outdoorSun),
            ratio(lastState.moonIntensity, lastState.outdoorMoonIntensity),
            ratio(lastState.lightningIntensity, lastState.outdoorLightningIntensity)
          )
        : 1;
    }

    /** Apply the player-facing visual mode without mutating authored state or any gameplay authority. */
    function applyEnabledPresentation() {
      group.visible = lightingEnabled;
      fallbackAmbient.visible = !lightingEnabled;
      renderer.shadowMap.enabled = lightingEnabled;
      renderer.shadowMap.autoUpdate = lightingEnabled;
      if (lightingEnabled) {
        const effectiveEnvironmentSignature = getEffectiveEnvironmentSignature();
        if (lastEnvironmentSignature !== effectiveEnvironmentSignature) {
          // r160 caches DataTexture PMREM by source identity, ignoring needsPMREMUpdate on non-render targets.
          // The rig exclusively owns this source. Its disposal event releases the renderer's old source/PMREM;
          // needsUpdate below permits reuse and lazy regeneration with identical Float HDR/filtering quality.
          // Unchanged quantized signatures never dispose or refilter, including repeated paused renders.
          if (lastEnvironmentSignature !== '') {
            environmentTexture.dispose();
            environmentCacheInvalidationCount++;
          }
          refreshHdrEnvironment(environmentTexture, lastState, getPresentationTier());
          // The quantized cache can retain a nearby earlier state; compensate what was actually baked, not
          // an unrendered target value from the newest simulation update.
          environmentSourceTransmission = clamp01(
            lastState.environmentIntensity / lastState.outdoorEnvironmentIntensity
          );
          lastEnvironmentSignature = effectiveEnvironmentSignature;
          environmentRefreshCount++;
        }
        scene.environment = environmentTexture;
        if ('environmentIntensity' in scene) {
          scene.environmentIntensity = getPresentationTier().bakeEnvironmentIntensity
            ? 1
            : lastState.environmentIntensity;
        }
        applyAuthoredLightPresentation();
        renderer.shadowMap.needsUpdate = true;
      } else {
        scene.environment = previous.environment;
        if ('environmentIntensity' in scene) {
          scene.environmentIntensity = finite(previous.environmentIntensity, 1);
        }
        renderer.toneMappingExposure = 1;
        renderer.shadowMap.needsUpdate = false;
      }
      updateTunnelLightingUniforms();
    }

    /** Enable or disable only the expensive physical-lighting presentation; the returned value is the active mode. */
    function setEnabled(enabled) {
      if (disposed) throw new Error('Physical lighting rig has been disposed');
      const nextEnabled = Boolean(enabled);
      if (nextEnabled !== lightingEnabled) {
        lightingEnabled = nextEnabled;
        toggleCount++;
      }
      applyEnabledPresentation();
      return lightingEnabled;
    }

    /**
     * Resize only shadow render targets while the game is paused or still at launch. The main runtime owns that
     * timing guard; this presentation kernel never receives writable gameplay state.
     */
    function setShadowMapSizes(requestedSizes = {}) {
      if (disposed) throw new Error('Physical lighting rig has been disposed');
      const hasRequestedSun = requestedSizes.sun !== undefined
        || requestedSizes.primary !== undefined
        || requestedSizes.sunShadowMapSize !== undefined;
      const nextRequestedSun = Number(
        requestedSizes.sun
          ?? requestedSizes.primary
          ?? requestedSizes.sunShadowMapSize
          ?? requestedSunShadowMapSize
      );
      const nextRequestedSecondary = Number(
        requestedSizes.secondaryDirectional
          ?? requestedSizes.secondaryDirectionalShadowMapSize
          ?? (hasRequestedSun ? nextRequestedSun : requestedSecondaryDirectionalShadowMapSize)
      );
      const nextRequestedLocal = Number(
        requestedSizes.local
          ?? requestedSizes.localShadowMapSize
          ?? requestedLocalShadowMapSize
      );
      const nextEffectiveSun = resolveShadowMapSize(nextRequestedSun);
      const nextEffectiveSecondary = resolveShadowMapSize(nextRequestedSecondary);
      const nextEffectiveLocal = resolveShadowMapSize(nextRequestedLocal);
      requestedSunShadowMapSize = nextRequestedSun;
      requestedSecondaryDirectionalShadowMapSize = nextRequestedSecondary;
      requestedLocalShadowMapSize = nextRequestedLocal;
      const effectiveSizeChanged = effectiveSunShadowMapSize !== nextEffectiveSun
        || effectiveSecondaryDirectionalShadowMapSize !== nextEffectiveSecondary
        || effectiveLocalShadowMapSize !== nextEffectiveLocal;
      if (!effectiveSizeChanged) return getShadowSizeResult();

      const shadowLights = [sun.light, moon.light, lightning.light, ...tunnelSpots.map(({ light }) => light)];
      for (const light of shadowLights) {
        // Three allocates shadow targets lazily. Dispose the previous buffers before changing mapSize so the next
        // render cannot retain the old GPU allocation under a new player-facing quality label.
        light.shadow.map?.dispose?.();
        light.shadow.mapPass?.dispose?.();
        light.shadow.map = null;
        light.shadow.mapPass = null;
      }
      sun.light.shadow.mapSize.set(nextEffectiveSun, nextEffectiveSun);
      for (const light of [moon.light, lightning.light]) {
        light.shadow.mapSize.set(nextEffectiveSecondary, nextEffectiveSecondary);
      }
      for (const { light } of tunnelSpots) {
        light.shadow.mapSize.set(nextEffectiveLocal, nextEffectiveLocal);
      }
      effectiveSunShadowMapSize = nextEffectiveSun;
      effectiveSecondaryDirectionalShadowMapSize = nextEffectiveSecondary;
      effectiveLocalShadowMapSize = nextEffectiveLocal;
      shadowMapResizeCount++;
      shadowTexelWorldSizeM = getPresentationTier().primarySpanM / effectiveSunShadowMapSize;
      renderer.shadowMap.needsUpdate = lightingEnabled;
      return getShadowSizeResult();
    }

    /**
     * Switch the reversible presentation transform. The runtime owns pause/launch timing and passes its requested
     * map sizes; this authority resolves hardware limits but never reads FPS or mutates simulation state.
     */
    function setRenderQuality(renderQualityId, requestedSizes = null) {
      if (disposed) throw new Error('Physical lighting rig has been disposed');
      const nextId = String(renderQualityId || '');
      if (!LIGHTING_PRESENTATION_TIERS[nextId]) {
        throw new RangeError(`Unknown physical-lighting render quality: ${nextId}`);
      }
      const previousTier = getPresentationTier();
      if (nextId !== activeRenderQualityId) {
        activeRenderQualityId = nextId;
        renderQualitySwitchCount++;
      }
      const nextTier = getPresentationTier();
      if (previousTier.dynamicLocalFixtureLights && !nextTier.dynamicLocalFixtureLights) {
        // Quality downgrade is synchronous: no High cone, Film binding, or local shadow allocation may survive the
        // settings transaction and leak one expensive frame into Medium/Low on a constrained device.
        deactivateDynamicLocalFixtureLights();
        releaseLocalShadowTargets();
      } else if (!previousTier.dynamicLocalFixtureLights && nextTier.dynamicLocalFixtureLights) {
        localShadowPrewarmUpdatesRemaining =
          PHYSICAL_LIGHTING_CONTRACT.lights.localShadowPrewarmUpdateCount;
      }
      applyShadowPresentation();
      const sizeResult = requestedSizes && typeof requestedSizes === 'object'
        ? setShadowMapSizes(requestedSizes)
        : getShadowSizeResult();
      applyEnabledPresentation();
      return deepFreeze({
        id: activeRenderQualityId,
        shadow: sizeResult,
        exposureMultiplier: getPresentationTier().exposureMultiplier,
        ambientMultiplier: getPresentationTier().ambientMultiplier,
        hdrRadianceMultiplier: getPresentationTier().hdrRadianceMultiplier,
        dynamicLocalFixtureLights: getPresentationTier().dynamicLocalFixtureLights,
        adaptiveDownscale: false
      });
    }

    /** Advance visual handoffs by active elapsed seconds; zero freezes gains and omitted dt preserves legacy 60 Hz. */
    function update(input = {}) {
      if (disposed) throw new Error('Physical lighting rig has been disposed');
      const referenceHz = PHYSICAL_LIGHTING_CONTRACT.lights.tunnelSpotHandoffReferenceHz;
      const referenceRate = PHYSICAL_LIGHTING_CONTRACT.lights.tunnelSpotHandoffReferenceRate;
      const dtSeconds = Math.max(0, finite(input.dtSeconds, 1 / referenceHz));
      const fadeOutRate = referenceRate * referenceHz;
      const fadeInWeight = (seconds) => 1 - Math.pow(1 - referenceRate, seconds * referenceHz);
      lastState = deriveLightingState(input);
      copyFiniteVector(rawAnchor, input.anchor, camera.position);
      // Film cameras can be far from the player. Local physical cones therefore follow an explicit viewpoint
      // anchor while shadow stabilization and all gameplay-facing route identity continue to use the player anchor.
      copyFiniteVector(fixtureSelectionAnchor, input.fixtureSelectionAnchor, rawAnchor);
      quantizedAnchor.set(
        Math.round(rawAnchor.x / shadowTexelWorldSizeM) * shadowTexelWorldSizeM,
        Math.round(rawAnchor.y / shadowTexelWorldSizeM) * shadowTexelWorldSizeM,
        Math.round(rawAnchor.z / shadowTexelWorldSizeM) * shadowTexelWorldSizeM
      );
      shadowAnchorErrorM = rawAnchor.distanceTo(quantizedAnchor);
      normalizeBasis(forward, input.forward, new THREE.Vector3(0, 0, -1));
      normalizeBasis(up, input.up, new THREE.Vector3(0, 1, 0));
      if (input.right) normalizeBasis(right, input.right, new THREE.Vector3(1, 0, 0));
      else {
        right.crossVectors(forward, up);
        if (right.lengthSq() < 0.000_001) right.set(1, 0, 0);
        else right.normalize();
      }
      up.crossVectors(right, forward).normalize();

      sunDirection.fromArray(lastState.sunDirection);
      sunDirection.y *= getPresentationTier().sunDirectionYScale;
      sunDirection.normalize();
      sun.target.position.copy(quantizedAnchor);
      sun.light.position.copy(quantizedAnchor)
        .addScaledVector(sunDirection, PHYSICAL_LIGHTING_CONTRACT.lights.sunDistanceM);
      moon.target.position.copy(quantizedAnchor);
      moon.light.position.copy(quantizedAnchor)
        .addScaledVector(sunDirection, -PHYSICAL_LIGHTING_CONTRACT.lights.moonDistanceM)
        .addScaledVector(up, PHYSICAL_LIGHTING_CONTRACT.lights.moonDistanceM * 0.42);
      lightning.target.position.copy(quantizedAnchor);
      lightning.light.position.copy(quantizedAnchor)
        .addScaledVector(up, PHYSICAL_LIGHTING_CONTRACT.lights.lightningDistanceM)
        .addScaledVector(right, PHYSICAL_LIGHTING_CONTRACT.lights.lightningDistanceM * 0.16);

      setLinearColor(sun.light.color, lastState.sunColor);
      sun.light.intensity = lastState.sunIntensity;
      sun.light.visible = lastState.sunIntensity > 0.000_1;
      setLinearColor(moon.light.color, lastState.moonColor);
      moon.light.intensity = lastState.moonIntensity;
      moon.light.visible = lastState.moonIntensity > 0.000_1;
      setLinearColor(lightning.light.color, lastState.lightningColor);
      lightning.light.intensity = lastState.lightningIntensity;
      lightning.light.visible = lastState.lightningIntensity > 0.000_1;
      setLinearColor(ambient.color, lastState.ambientColor);
      ambient.groundColor.copy(ambient.color).multiplyScalar(0.34);
      ambient.intensity = lastState.ambientIntensity;

      if (!getPresentationTier().dynamicLocalFixtureLights) {
        // This branch deliberately precedes emitter array access, validation, Set/Map construction, distance
        // ranking, and Film identity work. Static batched fixture irradiance remains the complete mobile path.
        deactivateDynamicLocalFixtureLights();
      } else {
      const renderOriginX = finite(input.renderOrigin?.x);
      const renderOriginY = finite(input.renderOrigin?.y);
      const renderOriginZ = finite(input.renderOrigin?.z);
      const fixtureEmitterInput = Array.isArray(input.fixtureEmitters)
        ? input.fixtureEmitters
        : Array.isArray(input.tunnelEmitters) ? input.tunnelEmitters : [];
      scannedFixtureEmitterRecordCount = fixtureEmitterInput.length;
      const validatedEmitterIds = new Set();
      const validatedEmitterRecords = fixtureEmitterInput.filter((record) => {
        const direction = record?.direction;
        const recordId = typeof record?.id === 'string' ? record.id : '';
        const directionLength = Math.hypot(
          Number(direction?.x),
          Number(direction?.y),
          Number(direction?.z)
        );
        const valid = record?.coordinateMode === 'absolute-world-and-tile-local'
          && recordId.length > 0
          && !validatedEmitterIds.has(recordId)
          && typeof record.edge === 'string'
          && Number.isFinite(Number(record.edgeS))
          && [record.absolutePosition?.x, record.absolutePosition?.y, record.absolutePosition?.z]
            .every((value) => Number.isFinite(Number(value)))
          && [direction?.x, direction?.y, direction?.z]
            .every((value) => Number.isFinite(Number(value)))
          && directionLength > 0.000_001
          && (record.kind !== 'tunnel-ceiling-fixture'
            || (typeof record.profile === 'string' && record.profile.length > 0));
        if (valid) validatedEmitterIds.add(recordId);
        return valid;
      });
      const validatedEmitterRecordById = new Map(
        validatedEmitterRecords.map((record) => [String(record.id), record])
      );
      const tunnelPreviewActive = Boolean(lastState.previewTunnelKind);
      const cameraVisualSelection = input.fixtureSelectionMode === 'camera-visual';
      // Normal driving remains bound to the gameplay route identity. Film instead resolves one nearest authored
      // edge/profile cluster from the camera-visible fixtures, then filters the six-light pool to that exact pair;
      // it never mixes crossing routes or invents a camera-relative emitter.
      let requiredFixtureKind = lastState.coveredRoute || tunnelPreviewActive
        ? 'tunnel-ceiling-fixture'
        : lastState.openUnderpassFixtureActivation > 0.002 ? 'bridge-soffit-fixture' : null;
      let useTunnelPreview = tunnelPreviewActive && !lastState.coveredRoute;
      let cameraVisualTunnelSelection = false;
      const requestedRouteEdgeValue = useTunnelPreview ? input.previewRouteEdgeId : input.routeEdgeId;
      const requestedRouteEdgeSValue = useTunnelPreview ? input.previewRouteEdgeS : input.routeEdgeS;
      const requestedTunnelProfileValue = useTunnelPreview
        ? input.previewTunnelProfileId
        : input.tunnelProfileId;
      requestedFixtureRouteEdgeId = typeof requestedRouteEdgeValue === 'string'
        ? requestedRouteEdgeValue
        : null;
      requestedFixtureRouteEdgeS = Number.isFinite(Number(requestedRouteEdgeSValue))
        ? Number(requestedRouteEdgeSValue)
        : null;
      requestedTunnelProfileId = typeof requestedTunnelProfileValue === 'string'
        ? requestedTunnelProfileValue
        : null;
      fixtureSelectionIdentitySource = requiredFixtureKind ? 'player-route' : 'inactive';

      if (cameraVisualSelection) {
        const groups = new Map();
        for (const record of validatedEmitterRecords) {
          if (record.kind !== 'tunnel-ceiling-fixture') continue;
          const x = Number(record.absolutePosition.x) - renderOriginX;
          const y = Number(record.absolutePosition.y) - renderOriginY;
          const z = Number(record.absolutePosition.z) - renderOriginZ;
          const distanceM = fixtureSelectionAnchor.distanceTo(scratch.set(x, y, z));
          const lightDistance = clamp(
            finite(record.distance, PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM),
            8,
            PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM
          );
          const maximumCameraReachM = PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM
            + lightDistance
            + PHYSICAL_LIGHTING_CONTRACT.lights.fixtureReachMarginM
            + PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDynamicDetailFadeM;
          if (distanceM > maximumCameraReachM) continue;
          const key = `${record.edge}\u0000${record.profile}`;
          const candidate = { record, distanceM };
          const group = groups.get(key);
          if (!group) groups.set(key, { key, nearest: candidate });
          else if (distanceM < group.nearest.distanceM) group.nearest = candidate;
        }
        const rankedGroups = [...groups.values()]
          .sort((left, rightEntry) => left.nearest.distanceM - rightEntry.nearest.distanceM);
        let selectedGroup = rankedGroups[0] || null;
        const previousGroup = cameraFixtureIdentityKey
          ? groups.get(cameraFixtureIdentityKey)
          : null;
        if (selectedGroup && previousGroup
          && previousGroup.nearest.distanceM
            <= selectedGroup.nearest.distanceM
              + PHYSICAL_LIGHTING_CONTRACT.lights.tunnelCameraIdentityHysteresisM) {
          selectedGroup = previousGroup;
        }
        const nextCameraIdentityKey = selectedGroup?.key || null;
        if (cameraFixtureIdentityKey && nextCameraIdentityKey !== cameraFixtureIdentityKey) {
          cameraFixtureIdentityHandoffCount++;
        }
        cameraFixtureIdentityKey = nextCameraIdentityKey;
        if (selectedGroup) {
          const selectedRecord = selectedGroup.nearest.record;
          requiredFixtureKind = 'tunnel-ceiling-fixture';
          useTunnelPreview = false;
          cameraVisualTunnelSelection = true;
          requestedFixtureRouteEdgeId = selectedRecord.edge;
          requestedFixtureRouteEdgeS = Number(selectedRecord.edgeS);
          requestedTunnelProfileId = selectedRecord.profile;
          fixtureSelectionIdentitySource = 'camera-authored-route';
        } else {
          requiredFixtureKind = null;
          requestedFixtureRouteEdgeId = null;
          requestedFixtureRouteEdgeS = null;
          requestedTunnelProfileId = null;
          fixtureSelectionIdentitySource = 'inactive';
        }
      } else {
        cameraFixtureIdentityKey = null;
      }
      const hasRequiredFixtureIdentity = requiredFixtureKind === 'tunnel-ceiling-fixture'
        ? Boolean(requestedFixtureRouteEdgeId && requestedTunnelProfileId)
        : requiredFixtureKind === 'bridge-soffit-fixture'
          ? Boolean(requestedFixtureRouteEdgeId)
          : false;
      const emitterRecords = requiredFixtureKind && hasRequiredFixtureIdentity
        ? validatedEmitterRecords.filter((record) => (
            record.kind === requiredFixtureKind
            && record.edge === requestedFixtureRouteEdgeId
            && (requiredFixtureKind !== 'tunnel-ceiling-fixture'
              || record.profile === requestedTunnelProfileId)
          ))
        : [];
      const rankedEmitterRecords = emitterRecords.map((record) => {
        const x = Number(record.absolutePosition.x) - renderOriginX;
        const y = Number(record.absolutePosition.y) - renderOriginY;
        const z = Number(record.absolutePosition.z) - renderOriginZ;
        const distanceSquared = fixtureSelectionAnchor.distanceToSquared(scratch.set(x, y, z));
        const lightDistance = clamp(
          finite(record.distance, PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM),
          8,
          PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM
        );
        const reach = lightDistance + PHYSICAL_LIGHTING_CONTRACT.lights.fixtureReachMarginM;
        const routeDistanceM = requestedFixtureRouteEdgeS !== null
          && Number.isFinite(Number(record.edgeS))
          ? Math.abs(Number(record.edgeS) - requestedFixtureRouteEdgeS)
          : Number.POSITIVE_INFINITY;
        const tunnelSelectionDistanceM = useTunnelPreview || cameraVisualTunnelSelection
          ? PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM
          : PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPhysicalSelectionDistanceM;
        const distanceM = Math.sqrt(distanceSquared);
        const fadeM = PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDynamicDetailFadeM;
        const distanceWeight = 1 - smootherstep(
          (distanceM - (tunnelSelectionDistanceM + reach)) / fadeM
        );
        const routeWeight = 1 - smootherstep(
          (routeDistanceM - tunnelSelectionDistanceM) / fadeM
        );
        const tunnelDetailWeight = requiredFixtureKind === 'tunnel-ceiling-fixture'
          && Number.isFinite(routeDistanceM)
          ? clamp01(Math.min(distanceWeight, routeWeight))
          : 0;
        return {
          record,
          x,
          y,
          z,
          distanceSquared,
          routeDistanceM,
          lightDistance,
          detailWeight: requiredFixtureKind === 'tunnel-ceiling-fixture' ? tunnelDetailWeight : 1,
          reachable: requiredFixtureKind === 'tunnel-ceiling-fixture'
            ? tunnelDetailWeight > 0.000_1
            : distanceSquared <= reach * reach
        };
      }).sort((left, rightEntry) => {
        // Route/profile identity and reach fail closed above; among those valid fixtures, the six-cone pool is
        // purely viewpoint-near PBR detail so a detached Film camera never exposes a dark nearby luminaire.
        if (left.distanceSquared !== rightEntry.distanceSquared) {
          return left.distanceSquared - rightEntry.distanceSquared;
        }
        return left.routeDistanceM - rightEntry.routeDistanceM;
      });
      nearestAvailableFixtureDistanceM = rankedEmitterRecords.length
        ? Math.sqrt(rankedEmitterRecords[0].distanceSquared)
        : Number.POSITIVE_INFINITY;
      const reachableEmitterRecords = rankedEmitterRecords.filter((entry) => entry.reachable);
      const nearestEmitterRecords = reachableEmitterRecords
        .slice(0, tunnelSpots.length);
      nearestMatchedFixtureDistanceM = nearestEmitterRecords.length
        ? Math.sqrt(nearestEmitterRecords[0].distanceSquared)
        : Number.POSITIVE_INFINITY;
      tunnelEmitterMode = nearestEmitterRecords.length > 0
        ? cameraVisualTunnelSelection
          ? 'authored-fixture-camera-route'
          : useTunnelPreview ? 'authored-fixture-preview' : 'authored-fixture-records'
        : 'inactive';
      availableTunnelEmitterRecordCount = validatedEmitterRecords.length;
      eligibleFixtureEmitterRecordCount = emitterRecords.length;
      reachableFixtureEmitterRecordCount = reachableEmitterRecords.length;
      matchedTunnelEmitterRecordCount = nearestEmitterRecords.length;
      tunnelFixtureAlignmentMaximumErrorM = 0;
      estimatedOpenFixtureRoadIlluminance = 0;
      maximumOpenFixtureRoadIlluminance = 0;
      activeTunnelEmitterIds = Object.freeze(nearestEmitterRecords.map((entry) => String(entry.record.id || 'unnamed')));
      const nextFixtureIdentityKey = requiredFixtureKind && hasRequiredFixtureIdentity
        ? `${requiredFixtureKind}\u0000${requestedFixtureRouteEdgeId}\u0000${requestedTunnelProfileId || ''}`
        : null;
      const previousFixtureIdentityKey = selectedFixtureIdentityKey;
      const fixtureIdentityChanged = nextFixtureIdentityKey !== previousFixtureIdentityKey;
      const crossTunnelIdentityTransition = fixtureIdentityChanged
        && previousFixtureIdentityKey?.startsWith('tunnel-ceiling-fixture\u0000')
        && nextFixtureIdentityKey?.startsWith('tunnel-ceiling-fixture\u0000');
      if (fixtureIdentityChanged) {
        // A real Film cut may choose another exact authored edge/profile. Existing slots remain on their old real
        // records until they have faded out; only a tunnel exit, missing identity, or fixture-kind change clears
        // immediately. This prevents a full-power light and shadow teleport without enlarging the six-slot pool.
        if (crossTunnelIdentityTransition) {
          tunnelIdentityTransitionPendingKey = nextFixtureIdentityKey;
        } else {
          tunnelIdentityTransitionPendingKey = null;
          for (const binding of tunnelSpotBindings) {
            binding.emitterId = null;
            binding.identityKey = null;
            binding.entry = null;
            binding.gain = 0;
            binding.fadingOut = false;
          }
        }
        selectedFixtureIdentityKey = nextFixtureIdentityKey;
      }
      const desiredEmitterById = new Map(
        nearestEmitterRecords.map((entry) => [String(entry.record.id), entry])
      );
      const hadBoundSpot = tunnelSpotBindings.some((binding) => binding.emitterId !== null);
      const retainedEmitterIds = new Set(
        tunnelSpotBindings
          .filter((binding) => binding.identityKey === nextFixtureIdentityKey)
          .map((binding) => binding.emitterId)
          .filter((id) => id !== null && desiredEmitterById.has(id))
      );
      const pendingEmitterRecords = nearestEmitterRecords.filter(
        (entry) => !retainedEmitterIds.has(String(entry.record.id))
      );
      // A cross-route cut shares one time barrier: every old edge/profile must reach zero before any new one
      // emits. Carry remaining seconds across that barrier, so a 30 Hz frame does not add an extra dark frame
      // compared with two 60 Hz or four 120 Hz updates. The same rule applies when a cut is reversed midway.
      const identityFadeOutSeconds = nextFixtureIdentityKey
        ? Math.max(0, ...tunnelSpotBindings.map((binding) => (
            binding.identityKey !== null && binding.identityKey !== nextFixtureIdentityKey
              ? binding.gain / fadeOutRate
              : 0
          )))
        : 0;
      const slotEmitterRecords = tunnelSpotBindings.map((binding) => {
        const desired = binding.emitterId !== null && binding.identityKey === nextFixtureIdentityKey
          ? desiredEmitterById.get(binding.emitterId)
          : null;
        if (desired) {
          const targetGain = desired.detailWeight;
          // Reversing a camera cut can retain the outgoing real record. Resume its current gain instead of
          // snapping it to full power; in particular a zero-time paused cut must not advance illumination.
          binding.gain += (targetGain - binding.gain) * fadeInWeight(dtSeconds);
          binding.fadingOut = false;
          binding.identityKey = nextFixtureIdentityKey;
          binding.entry = desired;
          return { ...desired, transitionGain: binding.gain };
        }

        const outgoingRecord = binding.emitterId !== null
          ? validatedEmitterRecordById.get(binding.emitterId)
          : null;
        const outgoing = outgoingRecord && binding.entry
          ? {
              ...binding.entry,
              record: outgoingRecord,
              x: Number(outgoingRecord.absolutePosition.x) - renderOriginX,
              y: Number(outgoingRecord.absolutePosition.y) - renderOriginY,
              z: Number(outgoingRecord.absolutePosition.z) - renderOriginZ,
              lightDistance: clamp(
                finite(outgoingRecord.distance, PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM),
                8,
                PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDistanceM
              )
            }
          : null;
        let outgoingFadeOutSeconds = 0;
        if (outgoing && binding.gain > 0) {
          if (!binding.fadingOut && pendingEmitterRecords.length > 0) tunnelSpotHandoffCount++;
          binding.fadingOut = true;
          outgoingFadeOutSeconds = binding.gain / fadeOutRate;
          binding.gain = Math.max(
            0,
            binding.gain - fadeOutRate * dtSeconds
          );
          binding.entry = outgoing;
          if (binding.gain > 0) return { ...outgoing, transitionGain: binding.gain };
        }

        binding.emitterId = null;
        binding.identityKey = null;
        binding.entry = null;
        binding.gain = 0;
        binding.fadingOut = false;
        if (identityFadeOutSeconds > dtSeconds) return null;
        const incoming = pendingEmitterRecords.shift() || null;
        if (!incoming) return null;
        binding.emitterId = String(incoming.record.id);
        binding.identityKey = nextFixtureIdentityKey;
        binding.entry = incoming;
        const incomingSeconds = Math.max(0, dtSeconds - Math.max(
          outgoingFadeOutSeconds,
          identityFadeOutSeconds
        ));
        binding.gain = (fixtureIdentityChanged || !hadBoundSpot)
          && tunnelIdentityTransitionPendingKey !== nextFixtureIdentityKey
          ? incoming.detailWeight
          : incoming.detailWeight * fadeInWeight(incomingSeconds);
        return { ...incoming, transitionGain: binding.gain };
      });
      tunnelSpotPendingEmitterCount = pendingEmitterRecords.length;
      if (tunnelIdentityTransitionPendingKey === nextFixtureIdentityKey
        && pendingEmitterRecords.length === 0
        && !tunnelSpotBindings.some((binding) => (
          binding.identityKey !== null && binding.identityKey !== nextFixtureIdentityKey
        ))) {
        tunnelIdentityTransitionPendingKey = null;
      }
      activeTunnelSpotEmitterIds = Object.freeze(slotEmitterRecords
        .filter((entry) => entry && entry.transitionGain > 0.000_1)
        .map((entry) => String(entry.record.id)));
      activeTunnelSpotIdentityKeys = Object.freeze(slotEmitterRecords
        .filter((entry) => entry && entry.transitionGain > 0.000_1)
        .map((entry) => `${entry.record.edge}\u0000${entry.record.profile || ''}`));
      const openFixtureIlluminanceShare = !lastState.coveredRoute
        && !useTunnelPreview
        && !cameraVisualTunnelSelection
        && nearestEmitterRecords.length > 0
        ? lastState.openUnderpassFixtureIlluminanceBudget / nearestEmitterRecords.length
        : 0;
      const openFixtureRoadDistanceSquared =
        PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureRoadDistanceM ** 2;
      const prewarmLocalShadowMaps = lightingEnabled && localShadowPrewarmUpdatesRemaining > 0;
      tunnelSpots.forEach(({ light, target }, index) => {
        const emitter = slotEmitterRecords[index];
        if (emitter) {
          light.position.set(emitter.x, emitter.y, emitter.z);
          normalizeBasis(scratch, emitter.record.direction, new THREE.Vector3(0, -1, 0));
          target.position.copy(light.position).addScaledVector(scratch, 9);
          if (Number.isFinite(Number(emitter.record.color))) light.color.setHex(Number(emitter.record.color));
          else setLinearColor(light.color, lastState.tunnelColor);
          const authoredIntensity = clamp(finite(emitter.record.intensity, 700), 100, 24_000);
          // `constant-on` is an electrical contract, not a hint: neither player/portal proximity nor enclosure may
          // reduce its authored power. Non-constant bridge records retain the daylight-dominance safety budget.
          const fixturePower = emitter.record.powerMode === 'constant-on'
            ? 1
            : lastState.coveredRoute
              ? clamp01(lastState.tunnelFixtureIntensity / 19_000)
              : useTunnelPreview
                ? clamp01(lastState.previewTunnelFixtureIntensity / 19_000)
                : lastState.openUnderpassFixtureActivation;
          const authoredFixtureIntensity = authoredIntensity * fixturePower
            * clamp01(emitter.transitionGain);
          light.intensity = lastState.coveredRoute || useTunnelPreview || cameraVisualTunnelSelection
            ? authoredFixtureIntensity
            : Math.min(
              authoredFixtureIntensity,
              openFixtureIlluminanceShare * openFixtureRoadDistanceSquared
            );
          if (!lastState.coveredRoute && !useTunnelPreview) {
            const roadIlluminance = light.intensity / openFixtureRoadDistanceSquared;
            estimatedOpenFixtureRoadIlluminance += roadIlluminance;
            maximumOpenFixtureRoadIlluminance = Math.max(
              maximumOpenFixtureRoadIlluminance,
              roadIlluminance
            );
          }
          light.distance = emitter.lightDistance;
          if (light.shadow.camera.far !== light.distance) {
            light.shadow.camera.far = light.distance;
            light.shadow.camera.updateProjectionMatrix();
          }
          tunnelFixtureAlignmentMaximumErrorM = Math.max(
            tunnelFixtureAlignmentMaximumErrorM,
            light.position.distanceTo(scratch.set(emitter.x, emitter.y, emitter.z))
          );
        } else {
          light.intensity = 0;
        }
        light.visible = prewarmLocalShadowMaps || (
          light.intensity > 0.000_1
          && Boolean(emitter)
        );
      });
      if (prewarmLocalShadowMaps) {
        localShadowPrewarmUpdatesRemaining--;
        localShadowPrewarmScheduledCount++;
      }
      }
      renderer.toneMappingExposure = lastState.exposure;
      if ('environmentIntensity' in scene) scene.environmentIntensity = lastState.environmentIntensity;
      group.updateMatrixWorld(true);
      applyEnabledPresentation();
      updateCount++;
      return lastState;
    }

    function getDiagnostics() {
      const shadowLights = physicalLights.filter((light) => light.castShadow);
      const physicalLocalLights = physicalLights.filter((light) => light.isPointLight || light.isSpotLight);
      return deepFreeze({
        contractVersion: PHYSICAL_LIGHTING_CONTRACT.version,
        mode: PHYSICAL_LIGHTING_CONTRACT.mode,
        visualOnly: PHYSICAL_LIGHTING_CONTRACT.visualOnly,
        enabled: lightingEnabled,
        presentationMode: lightingEnabled
          ? PHYSICAL_LIGHTING_CONTRACT.mode
          : PHYSICAL_LIGHTING_CONTRACT.toggle.disabledMode,
        renderQualityId: activeRenderQualityId,
        dynamicLocalFixtureLightsEnabled: getPresentationTier().dynamicLocalFixtureLights,
        renderQualitySwitchCount,
        adaptiveDownscale: false,
        toggleCount,
        fallbackLightActive: fallbackAmbient.visible,
        threeRevision: String(THREE.REVISION),
        outputColorSpace: renderer.outputColorSpace,
        toneMapping: renderer.toneMapping === THREE.ACESFilmicToneMapping ? 'aces-filmic' : 'unexpected',
        useLegacyLights: PHYSICAL_LIGHTING_CONTRACT.renderer.useLegacyLights,
        shadowMapEnabled: renderer.shadowMap.enabled,
        shadowType: renderer.shadowMap.type === THREE.VSMShadowMap
          ? 'VSMShadowMap'
          : renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoftShadowMap' : 'unexpected',
        maxTextureSize: rendererMaximumTextureSize,
        requestedSunShadowMapSize,
        requestedSecondaryDirectionalShadowMapSize,
        requestedLocalShadowMapSize,
        effectiveSunShadowMapSize: sun.light.shadow.mapSize.x,
        effectiveSecondaryDirectionalShadowMapSize: moon.light.shadow.mapSize.x,
        effectiveLocalShadowMapSize: tunnelSpots[0].light.shadow.mapSize.x,
        shadowCapabilityFallbackApplied:
          sun.light.shadow.mapSize.x !== requestedSunShadowMapSize
          || moon.light.shadow.mapSize.x !== requestedSecondaryDirectionalShadowMapSize
          || tunnelSpots[0].light.shadow.mapSize.x !== requestedLocalShadowMapSize,
        primaryShadowMapSize: sun.light.shadow.mapSize.x,
        secondaryDirectionalShadowMapSize: moon.light.shadow.mapSize.x,
        localShadowMapSize: tunnelSpots[0].light.shadow.mapSize.x,
        primaryShadowSpanM: getPresentationTier().primarySpanM,
        primaryShadowFarM: sun.light.shadow.camera.far,
        primaryShadowBias: sun.light.shadow.bias,
        primaryShadowNormalBiasM: sun.light.shadow.normalBias,
        localShadowBias: tunnelSpots[0].light.shadow.bias,
        localShadowNormalBiasM: tunnelSpots[0].light.shadow.normalBias,
        localShadowPrewarmUpdatesRemaining,
        localShadowPrewarmScheduledCount,
        shadowMapResizeCount,
        shadowTexelWorldSizeM,
        shadowAnchor: quantizedAnchor.toArray(),
        fixtureSelectionAnchor: fixtureSelectionAnchor.toArray(),
        fixtureSelectionIdentitySource,
        cameraFixtureIdentityHandoffCount,
        shadowAnchorErrorM,
        realLightCount: physicalLights.length,
        shadowLightCount: shadowLights.length,
        activeRealLightCount: lightingEnabled
          ? physicalLights.filter((light) => light.visible && light.intensity > 0).length
          : 0,
        activeShadowLightCount: lightingEnabled
          ? shadowLights.filter((light) => light.visible && light.intensity > 0).length
          : 0,
        activeTunnelLightCount: lightingEnabled
          ? tunnelSpots.filter(({ light }) => light.visible && light.intensity > 0).length
          : 0,
        activeTunnelShadowLightCount: lightingEnabled
          ? tunnelSpots.filter(({ light }) => (
              light.castShadow && light.visible && light.intensity > 0
            )).length
          : 0,
        tunnelSpotCount: tunnelSpots.length,
        tunnelShadowSpotCount: tunnelSpots.filter(({ light }) => light.castShadow).length,
        tunnelDynamicDetailFadeM: PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDynamicDetailFadeM,
        tunnelSpotHandoffCount,
        tunnelSpotPendingEmitterCount,
        tunnelIdentityTransitionPending: tunnelIdentityTransitionPendingKey !== null,
        tunnelFallbackActivationCount: 0,
        fixtureEmitterMode: tunnelEmitterMode,
        tunnelEmitterMode,
        scannedFixtureEmitterRecordCount,
        availableFixtureEmitterRecordCount: availableTunnelEmitterRecordCount,
        availableTunnelEmitterRecordCount,
        eligibleFixtureEmitterRecordCount,
        reachableFixtureEmitterRecordCount,
        matchedFixtureEmitterRecordCount: matchedTunnelEmitterRecordCount,
        matchedTunnelEmitterRecordCount,
        nearestAvailableFixtureDistanceM: Number.isFinite(nearestAvailableFixtureDistanceM)
          ? nearestAvailableFixtureDistanceM : null,
        nearestMatchedFixtureDistanceM: Number.isFinite(nearestMatchedFixtureDistanceM)
          ? nearestMatchedFixtureDistanceM : null,
        tunnelFixtureAlignmentMaximumErrorM,
        openUnderpassShade: lastState.openUnderpassShade,
        openUnderpassDarkness: lastState.openUnderpassDarkness,
        openUnderpassFixtureActivation: lastState.openUnderpassFixtureActivation,
        openUnderpassFixtureIlluminanceBudget: lastState.openUnderpassFixtureIlluminanceBudget,
        estimatedOpenFixtureRoadIlluminance,
        maximumOpenFixtureRoadIlluminance,
        openFixtureToSunRatio: lastState.sunIntensity > 0
          ? estimatedOpenFixtureRoadIlluminance / lastState.sunIntensity
          : 0,
        activeFixtureEmitterIds: activeTunnelEmitterIds,
        activeTunnelEmitterIds,
        activeTunnelSpotEmitterIds,
        activeTunnelSpotIdentityKeys,
        requestedFixtureRouteEdgeId,
        requestedFixtureRouteEdgeS,
        requestedTunnelProfileId,
        cameraFollowingGuideLightCount: 0,
        inverseSquareLocalLightCount: physicalLocalLights.filter((light) => light.decay === 2).length,
        physicalLocalLightCount: physicalLocalLights.length,
        environmentIsDataTexture: environmentTexture.isDataTexture === true,
        environmentMapping: environmentTexture.mapping === THREE.EquirectangularReflectionMapping
          ? 'equirectangular-reflection' : 'unexpected',
        environmentNeedsPMREMUpdate: environmentTexture.needsPMREMUpdate === true,
        environmentRefreshCount,
        environmentCacheInvalidationCount,
        environmentCacheInvalidation: PHYSICAL_LIGHTING_CONTRACT.environment.cacheInvalidation,
        environmentSignature: lastState.environmentSignature,
        effectiveEnvironmentSignature: lastEnvironmentSignature,
        hdrEnvironmentTracksEnclosure:
          PHYSICAL_LIGHTING_CONTRACT.invariants.hdrEnvironmentTracksEnclosure,
        environmentFloatType: environmentTexture.type === THREE.FloatType,
        environmentActive: scene.environment === environmentTexture,
        environmentIntensity: lastState.environmentIntensity,
        sceneEnvironmentIntensity: 'environmentIntensity' in scene ? scene.environmentIntensity : null,
        environmentIntensityBakedIntoHdr: getPresentationTier().bakeEnvironmentIntensity,
        effectiveHdrRadianceMultiplier: getPresentationTier().hdrRadianceMultiplier,
        illuminationSignature: lastState.illuminationSignature,
        tunnelApproachActivation: lastState.tunnelApproachActivation,
        previewTunnelKind: lastState.previewTunnelKind,
        previewTunnelDistanceM: lastState.previewTunnelDistanceM,
        enclosure: lastState.enclosure,
        directTransmission: lastState.directTransmission,
        effectiveSunDirection: sunDirection.toArray(),
        sunIntensity: lightingEnabled ? sun.light.intensity : 0,
        ambientIntensity: lightingEnabled ? ambient.intensity : 0,
        moonIntensity: lightingEnabled ? moon.light.intensity : 0,
        lightningIntensity: lightingEnabled ? lightning.light.intensity : 0,
        tunnelFixtureIntensity: lastState.tunnelFixtureIntensity,
        exposure: renderer.toneMappingExposure,
        updateCount,
        disposed
      });
    }

    function dispose() {
      if (disposed) return false;
      disposed = true;
      scene.remove(group, fallbackAmbient);
      if (scene.environment === environmentTexture) scene.environment = previous.environment;
      if ('environmentIntensity' in scene) scene.environmentIntensity = previous.environmentIntensity;
      environmentTexture.dispose();
      if (scene.userData.neonTunnelLightingUniforms === tunnelLightingUniforms) {
        if (hadPreviousTunnelLightingUniforms) {
          scene.userData.neonTunnelLightingUniforms = previousTunnelLightingUniforms;
        } else {
          delete scene.userData.neonTunnelLightingUniforms;
        }
      }
      renderer.outputColorSpace = previous.outputColorSpace;
      renderer.toneMapping = previous.toneMapping;
      renderer.toneMappingExposure = previous.toneMappingExposure;
      renderer.shadowMap.enabled = previous.shadowEnabled;
      renderer.shadowMap.type = previous.shadowType;
      renderer.shadowMap.autoUpdate = previous.shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = true;
      return true;
    }

    applyShadowPresentation();
    scene.userData.neonTunnelLightingUniforms = tunnelLightingUniforms;
    update(options.initialState || {});
    return Object.freeze({
      contract: PHYSICAL_LIGHTING_CONTRACT,
      group,
      fallbackAmbient,
      environmentTexture,
      update,
      setEnabled,
      setRenderQuality,
      setShadowMapSizes,
      getDiagnostics,
      dispose
    });
  }

  return Object.freeze({
    PHYSICAL_LIGHTING_CONTRACT,
    LIGHTING_PRESENTATION_TIERS,
    ZONE_LIGHTING,
    deriveLightingState,
    createPhysicalLightingRig
  });
})();

if (typeof window === 'object') window.NeonLighting = NeonLightingModule;
if (typeof module === 'object' && module.exports) module.exports = NeonLightingModule;
