/*
 * V23 visual-only world model pool.
 * Every object created here is scenery: it is never appended to obstacle, pickup, or collision collections.
 */
window.NeonV23World = (() => {
  const configuredWorld = window.NeonV23Config?.world;
  const ZONE_LENGTH = Math.max(1, Number(configuredWorld?.zoneLength) || 2_700);
  const TRANSITION_LENGTH = Math.min(
    ZONE_LENGTH,
    Math.max(1, Number(configuredWorld?.blendSpan) || 72)
  );
  // Region environments and adjacent-realm creature clusters share three fixed-capacity slots inside the exact
  // world blend. Slot centers are measured from the blend start; creature proofs publish the mirrored boundary gap.
  const REALM_TRANSITION_SEGMENT_COUNT = 3;
  const REALM_TRANSITION_SEGMENT_LENGTH_M = TRANSITION_LENGTH / REALM_TRANSITION_SEGMENT_COUNT;
  const REALM_TRANSITION_PREVIEW_CENTER_OFFSETS_M = Object.freeze([
    REALM_TRANSITION_SEGMENT_LENGTH_M * 0.5,
    REALM_TRANSITION_SEGMENT_LENGTH_M * 1.5,
    REALM_TRANSITION_SEGMENT_LENGTH_M * 2.5
  ]);
  const CREATURE_ADJACENT_PREVIEW_POLICY = `adjacent-realm-preview-${TRANSITION_LENGTH}m`;
  const CREATURE_ADJACENT_PREVIEW_BOUNDARY_OFFSETS_M = Object.freeze(
    REALM_TRANSITION_PREVIEW_CENTER_OFFSETS_M.map((offsetM) => TRANSITION_LENGTH - offsetM)
  );
  // One small authored motif is repositioned inside the long active realm, preserving scenery density without
  // multiplying geometry, materials, map records, or draw groups when music-sized realm acreage increases.
  const SCENERY_MOTIF_LENGTH = 280;
  // Preserve the former early/middle/late landmark rhythm inside the shorter 2.7km physical-speed realm.
  const REGION_MAJOR_STATIONS_M = Object.freeze([390, 1_290, 2_190]);
  const REGION_MAJOR_ROAD_GAP_M = 6;
  const REGION_ENVIRONMENT_ROAD_GAP_M = 3;
  const AMBIENT_CANDLELIGHT_ROAD_GAP_M = 3;
  const SCENERY_PEER_EDGE_GAP_M = 4;
  const SCENERY_OUTWARD_SEARCH_ATTEMPTS = 42;
  const SCENERY_OUTWARD_SEARCH_STEP_M = 4;
  const REGION_AIR_DECK_CLEARANCE_M = 8;
  const SCENERY_FORWARD_MAJOR_SURFACE_M = 1_800;
  const SCENERY_FORWARD_OTHER_SURFACE_M = 1_440;
  const SCENERY_REAR_SURFACE_RETENTION_M = 480;
  const REGION_ENVIRONMENT_OFFSETS_M = Object.freeze([28, 84, 140, 196, 252]);
  const REGION_DETAIL_ENTER_M = 260;
  const REGION_DETAIL_EXIT_M = 340;
  const REGION_DETAIL_FADE_SECONDS = 0.36;
  const REGION_DETAIL_VISIBILITY_BAND = 'detail-hysteresis-260m-in-340m-out';
  const BASELINE_TRANSITION_MOTION_ENVELOPE_M = 0.22;
  const TERRAIN_CONTACT_TOLERANCE_M = 0.001;
  // Up to 16mm of hidden flame-root overlap closes precision cracks; positive separation remains under 32mm.
  const AMBIENT_CANDLE_FLAME_SEAM_MINIMUM_M = -0.016;
  const AMBIENT_CANDLE_FLAME_SEAM_MAXIMUM_M = 0.032;
  // These catalog families intentionally live above the terrain. Naming every exception prevents a new ground
  // family from silently inheriting the old bridge-deck placement path merely because it uses a horizon layer.
  const DESIGNED_AIRBORNE_REGION_FAMILY_IDS = Object.freeze([
    'veilcloud-terrace-chain',
    'sunmist-memory-sails',
    'softcloud-pollen-arc',
    'cloudbanner-star-drift',
    'canopy-petal-memory-drift',
    'comet-ribbon-current',
    'sunset-banner-starstream',
    'levitating-script-garden',
    'nebula-lantern-current',
    'memory-petal-orbits',
    'ashveil-wind-corridor',
    'stormtorn-petal-banners'
  ]);
  // Film cameras may leave the craft while route authority stays with the player. A root first prewarms outside
  // all six real planes, then receives a wider six-plane retention envelope and temporal grace. Separating acquire
  // from release is the invariant that prevents both approach pop-in and orbit/cut pop-out without frame allocation.
  const CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M = 320;
  const CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M = 480;
  const CAMERA_RELEVANCE_MINIMUM_GRACE_MS = 1_800;
  const CREATURE_ROAD_GAP_M = 6;
  const CREATURE_DECK_CLEARANCE_M = 6;
  const CREATURE_LARGE_SPACING_M = 120;
  const CREATURE_CLUSTER_SPACING_M = 45;
  const CREATURE_MINIMUM_FORWARD_M = 240;
  const CREATURE_FORWARD_SECONDS = 3.2;
  const CREATURE_REAR_SURFACE_RETENTION_M = 320;
  const CREATURE_REAR_CAMERA_MARGIN_M = 64;
  const CREATURE_WEDGE_MINIMUM_M = 160;
  const CREATURE_WEDGE_SECONDS = 0.8;
  const CREATURE_WEDGE_HALF_ANGLE_DEGREES = 12;
  const CREATURE_SPAWN_MINIMUM_M = 960;
  const CREATURE_SPAWN_MAXIMUM_M = 1_320;
  const LEGACY_CREATURES_ENABLED = false;

  const REGION_SCENERY_INTEGRATION_CONTRACT = Object.freeze({
    version: 2,
    addedFamilies: 48,
    addedRoots: 48,
    familiesPerRegion: 8,
    landmarksPerRegion: 3,
    environmentsPerRegion: 5,
    environmentOffsetsM: REGION_ENVIRONMENT_OFFSETS_M,
    desktopBaselineAndRegionRoots: 90,
    mobileBaselineAndRegionRoots: 84,
    majorStationsM: REGION_MAJOR_STATIONS_M,
    majorRoadGapM: REGION_MAJOR_ROAD_GAP_M,
    environmentRoadGapM: REGION_ENVIRONMENT_ROAD_GAP_M,
    peerEdgeGapM: SCENERY_PEER_EDGE_GAP_M,
    outwardSearchAttempts: SCENERY_OUTWARD_SEARCH_ATTEMPTS,
    outwardSearchStepM: SCENERY_OUTWARD_SEARCH_STEP_M,
    airDeckClearanceM: REGION_AIR_DECK_CLEARANCE_M,
    forwardMajorSurfaceM: SCENERY_FORWARD_MAJOR_SURFACE_M,
    forwardOtherSurfaceM: SCENERY_FORWARD_OTHER_SURFACE_M,
    rearSurfaceRetentionM: SCENERY_REAR_SURFACE_RETENTION_M,
    cameraResidencyAuthority: 'read-only-render-camera-frustum-with-graph-origin',
    cameraPrewarmPlaneMarginM: CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M,
    cameraRetentionPlaneMarginM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
    cameraFarHysteresisM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
    cameraPlaneHysteresisM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
    cameraExpandedPlaneCount: 6,
    cameraMinimumGraceMs: CAMERA_RELEVANCE_MINIMUM_GRACE_MS,
    visibleRootRebindAuthority: 'hide-one-frame-before-anchor-rebind',
    detailEnterM: REGION_DETAIL_ENTER_M,
    detailExitM: REGION_DETAIL_EXIT_M,
    detailFadeSeconds: REGION_DETAIL_FADE_SECONDS,
    detailVisibilityBand: REGION_DETAIL_VISIBILITY_BAND,
    nearVisibilityAuthority: 'render-space-bounds',
    adapterMetricsAuthority: 'real-three-buffer-geometry',
    transitionPreviewAuthority: 'transitionEligible-boolean',
    transitionPreviewLengthM: TRANSITION_LENGTH,
    transitionPreviewSegmentLengthM: REALM_TRANSITION_SEGMENT_LENGTH_M,
    transitionPreviewCenterOffsetsM: REALM_TRANSITION_PREVIEW_CENTER_OFFSETS_M,
    legacyCreaturesEnabled: LEGACY_CREATURES_ENABLED
  });

  const BASELINE_SCENERY_PRESENTATION_CONTRACT = Object.freeze({
    version: 2,
    familyCount: 30,
    familiesPerRealm: 5,
    implementation: 'original-ethereal-pilgrimage-closed-surfaces',
    topologyAuthority: 'measured-closed-buffer-geometry',
    sharedFinisher: 'realm-specific-mask-cape-petal-candle-memory',
    minimumFinisherDetailsPerFamily: 2,
    opaqueMetalnessMaximum: 0,
    glassMaterialsAllowed: false,
    industrialSurfaceLanguageAllowed: false,
    forbiddenVisibleVocabulary: Object.freeze([
      'lens',
      'chevron',
      'grandstand',
      'elevator',
      'rail',
      'panel',
      'aerodrome',
      'neon',
      'industrial',
      'turbine'
    ]),
    organicReplacementRoles: Object.freeze([
      'memory_water_basin',
      'wind_memory_petal',
      'pilgrimage_step_terrace',
      'pilgrimage_cape_veil',
      'constellation_orbit_thread'
    ]),
    transitionMotionEnvelopeM: BASELINE_TRANSITION_MOTION_ENVELOPE_M,
    clearanceRadiusAuthority: 'measured-horizontal-radius-plus-motion-envelope',
    realmDetailIds: Object.freeze([
      'dawn-oculus-pilgrim-petals',
      'prairie-bellseed-cape-bloom',
      'rainforest-leafmask-candle-roots',
      'twilight-sunhalo-racing-capes',
      'vault-constellation-mask-memories',
      'eden-broken-halo-ember-petals'
    ])
  });

  const SCENERY_TERRAIN_CONTACT_CONTRACT = Object.freeze({
    version: 1,
    terrainHeightAuthority: 'runtime-rendered-triangulated-terrain-absolute-world-xz',
    roadFrameHeightMayGroundScenery: false,
    visibleBoundsAuthority: 'complete-visible-three-bounds',
    groundedRootMode: 'terrain-grounded-visible-minimum',
    instancedGroundMode: 'terrain-grounded-per-instance-visible-minimum',
    designedAirborneMode: 'designed-airborne-terrain-relative',
    groundedBaselineFamilies: 30,
    groundedRegionFamilies: 36,
    designedAirborneRegionFamilies: DESIGNED_AIRBORNE_REGION_FAMILY_IDS.length,
    ambientCandleClusters: 6,
    designedAirborneRegionFamilyIds: DESIGNED_AIRBORNE_REGION_FAMILY_IDS,
    designedAirborneMinimumDeckClearanceM: REGION_AIR_DECK_CLEARANCE_M,
    groundedMotionMode: 'yaw-sway-with-stationary-contact-plane',
    contactToleranceM: TERRAIN_CONTACT_TOLERANCE_M,
    ambientCandleGroundingAuthority: 'per-instance-base-lowest-point',
    ambientFlameSeamMinimumM: AMBIENT_CANDLE_FLAME_SEAM_MINIMUM_M,
    ambientFlameSeamMaximumM: AMBIENT_CANDLE_FLAME_SEAM_MAXIMUM_M,
    zeroFrameAssetAllocations: true
  });

  const WORLD_CAMERA_CLEARANCE_ENVELOPE_CONTRACT = Object.freeze({
    version: 1,
    mapContractVersion: 2,
    authority: 'presented-root-complete-visible-bounds-with-motion-envelope',
    coordinateMode: 'absolute-world',
    horizontalField: 'horizontalRadiusM',
    exactVerticalFields: Object.freeze(['absoluteMinY', 'absoluteMaxY', 'centerY', 'halfHeightM']),
    conservativeVerticalFields: Object.freeze([
      'cameraClearanceMinY',
      'cameraClearanceMaxY',
      'cameraClearanceCenterY',
      'cameraClearanceHalfHeightM'
    ]),
    includesBaseline: true,
    includesRegion: true,
    includesAmbientCandlelight: true,
    includesCreatures: true,
    mapCompatibilityRadiusFieldPreserved: true,
    updateAuthority: 'same-frame-as-object-pose',
    frameAllocations: 0
  });

  const CREATURE_WORLD_INTEGRATION_CONTRACT = Object.freeze({
    familyCount: 18,
    pooledRoots: 54,
    mapRecordsPerRoot: 1,
    placementAuthority: 'complete-road-capsule-query-after-committed-frame',
    roadGapM: CREATURE_ROAD_GAP_M,
    deckClearanceM: CREATURE_DECK_CLEARANCE_M,
    largeSpacingM: CREATURE_LARGE_SPACING_M,
    clusterSpacingM: CREATURE_CLUSTER_SPACING_M,
    minimumForwardM: CREATURE_MINIMUM_FORWARD_M,
    forwardSeconds: CREATURE_FORWARD_SECONDS,
    rearSurfaceRetentionM: CREATURE_REAR_SURFACE_RETENTION_M,
    rearCameraMarginM: CREATURE_REAR_CAMERA_MARGIN_M,
    cameraResidencyAuthority: 'read-only-render-camera-frustum-with-graph-origin',
    cameraPrewarmPlaneMarginM: CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M,
    cameraRetentionPlaneMarginM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
    cameraFarHysteresisM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
    cameraPlaneHysteresisM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
    cameraExpandedPlaneCount: 6,
    cameraMinimumGraceMs: CAMERA_RELEVANCE_MINIMUM_GRACE_MS,
    activeLifecycleAuthority: 'acquire-forward-retire-complete-bounds-behind-unless-camera-relevant',
    wedgeMinimumM: CREATURE_WEDGE_MINIMUM_M,
    wedgeSeconds: CREATURE_WEDGE_SECONDS,
    wedgeHalfAngleDegrees: CREATURE_WEDGE_HALF_ANGLE_DEGREES,
    spawnMinimumM: CREATURE_SPAWN_MINIMUM_M,
    spawnMaximumM: CREATURE_SPAWN_MAXIMUM_M,
    adjacentPreviewPolicy: CREATURE_ADJACENT_PREVIEW_POLICY,
    adjacentPreviewLengthM: TRANSITION_LENGTH,
    adjacentPreviewSegmentLengthM: REALM_TRANSITION_SEGMENT_LENGTH_M,
    adjacentPreviewBoundaryOffsetsM: CREATURE_ADJACENT_PREVIEW_BOUNDARY_OFFSETS_M,
    sealedTunnelVisibleRoots: 0,
    legacyMantaEnabled: LEGACY_CREATURES_ENABLED,
    legacyDragonEnabled: LEGACY_CREATURES_ENABLED
  });

  // Dark dragons are visual ecology, not gameplay hazards. Their root follows one constant-speed route-tangent
  // flight line so faster motion never introduces fore/aft, lateral, altitude, pitch, yaw, or roll oscillation.
  const DARK_DRAGON_FLIGHT_CONTRACT = Object.freeze({
    forwardSpeedMps: 72,
    cycleLengthM: 900,
    routeLeadBiasM: -160,
    visibleNearZMaxM: 105,
    visibleFarZMinM: -620,
    longitudinalSwayAmplitudeM: 0,
    lateralSwayAmplitudeM: 0,
    verticalSwayAmplitudeM: 0,
    rootYawSwayRadians: 0,
    rootPitchSwayRadians: 0,
    rootRollSwayRadians: 0,
    headingMode: 'route-tangent',
    articulationMode: 'symmetric-wingbeat',
    presentationOnly: true
  });

  // The resident candle-moon, halo, memory-star petals, and cloud veils are presentation geometry only. Direction,
  // target, intensity, and projected shadows stay with the main physical-lighting rig, so the richer celestial
  // silhouette cannot introduce a second light or become unstable when Film moves away from the craft.
  const LEGACY_MOON_VISUAL_OFFSET = Object.freeze([-112, 88, -360]);
  const MOON_VISUAL_DISTANCE_M = Math.hypot(...LEGACY_MOON_VISUAL_OFFSET);
  const MOON_LIGHTING_CONTRACT = Object.freeze({
    version: 2,
    visualAuthority: 'world-sky-layer',
    visualLanguage: 'distant-candle-moon-memory-star-ring-and-cloud-veils',
    directionAuthority: 'main-physical-lighting-rig',
    targetAuthority: 'main-physical-lighting-rig',
    stateDirectionKey: 'physicalMoonDirection',
    fallbackVisualOffset: LEGACY_MOON_VISUAL_OFFSET,
    residencyMode: 'prewarmed-camera-relative-physical-direction',
    solidMoonMeshCount: 1,
    softHaloSpriteCount: 1,
    memoryStarPetalInstanceCount: 7,
    memoryStarPetalDrawGroups: 1,
    cloudVeilInstanceCount: 2,
    cloudVeilDrawGroups: 1,
    residentVisualObjectCount: 4,
    createsLocalLightCount: 0,
    createsDirectionalLight: false,
    createsIndependentShadow: false,
    visualOnly: true
  });

  // Top view combines a high camera, a long look-ahead, and an upward screen ray. Every finite weather family
  // must enclose that complete envelope without adding transparent volumes, particles, pools, or draw groups.
  const WEATHER_VIEW_VOLUME_CONTRACT = Object.freeze({
    version: 1,
    mode: 'top-camera-enclosing-interleaved-weather-volume',
    maximumSupportedCameraHeightAboveSurfaceM: 26,
    maximumTopViewUpwardRayDeg: 14,
    maximumTopViewSightlineM: 43.5,
    minimumGroundOverlapM: 10,
    minimumCameraOverheadM: 10,
    minimumCameraCenteredVerticalSpanM: 72,
    dustBottomOffsetM: -4,
    dustDenseGroundFraction: 0.72,
    dustDenseGroundHeightM: 32,
    hailUsesDepthBands: true,
    dustUsesDepthBands: true,
    capacity: Object.freeze({
      mobile: Object.freeze({ hail: 72, dust: 140 }),
      desktop: Object.freeze({ hail: 180, dust: 360 })
    }),
    poolCount: 4,
    layerCount: 5,
    additionalDrawGroups: 0,
    preservesPoolCapacity: true,
    presentationOnly: true
  });

  const PRECIPITATION_DEPTH_CONTRACT = Object.freeze({
    version: 2,
    mode: 'interleaved-near-mid-far-within-existing-pools',
    anchorMode: 'absolute-world-periodic-volume',
    bandNames: Object.freeze(['near', 'mid', 'far']),
    // Repeating low-discrepancy patterns keep every low-intensity drawRange prefix representative.
    rainBandPattern: Object.freeze([2, 0, 1, 0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 1, 0]),
    snowBaseBandPattern: Object.freeze([2, 1, 1, 2, 1, 1, 1, 2, 1, 1]),
    rainBandShares: Object.freeze([0.60, 0.25, 0.15]),
    snowBaseBandShares: Object.freeze([0, 0.70, 0.30]),
    capacity: Object.freeze({
      mobile: Object.freeze({ rain: 150, snowBase: 100, snowNear: 28 }),
      desktop: Object.freeze({ rain: 420, snowBase: 280, snowNear: 72 })
    }),
    spansM: Object.freeze({
      mobile: Object.freeze({
        near: Object.freeze({ horizontal: 58, vertical: 72 }),
        mid: Object.freeze({ horizontal: 168, vertical: 96 }),
        far: Object.freeze({ horizontal: 420, vertical: 172 })
      }),
      desktop: Object.freeze({
        near: Object.freeze({ horizontal: 82, vertical: 72 }),
        mid: Object.freeze({ horizontal: 240, vertical: 96 }),
        far: Object.freeze({ horizontal: 600, vertical: 172 })
      })
    }),
    rainDrawGroups: 1,
    snowDrawGroups: 2,
    hailDrawGroups: 1,
    dustDrawGroups: 1,
    preservesPoolCapacity: true,
    presentationOnly: true
  });
  const LOCAL_RAIN_SHELTER_CONTRACT = Object.freeze({
    version: 1,
    mode: 'fresh-route-local-mask-with-open-underpass-exterior',
    innerRadiusM: 12,
    outerRadiusM: 30,
    exteriorExposure: 1,
    cameraPreviewAffectsRain: false,
    preservesPoolCapacity: true,
    additionalDrawGroups: 0,
    presentationOnly: true
  });

  /**
   * Resolve local rain shelter from the committed route only.
   * Open bridge shade may stop rain around the craft while leaving the surrounding storm visible; sealed tunnels
   * retain their portal fade, and a missing blend on a covered frame fails safe to full local shelter.
   */
  function resolveLocalRainShelter(routeFrame = {}, out = null) {
    const target = out || {};
    const weatherClassifier = window.NeonV23Weather?.isSealedTunnelFrame;
    const sealedTunnel = typeof weatherClassifier === 'function'
      ? weatherClassifier(routeFrame)
      : routeFrame?.covered === true || Boolean(routeFrame?.tunnelKind);
    const rawEnclosureBlend = Number(routeFrame?.underpassBlend);
    const enclosureBlend = Number.isFinite(rawEnclosureBlend)
      ? Math.max(0, Math.min(1, rawEnclosureBlend))
      : sealedTunnel ? 1 : 0;
    const shelter = enclosureBlend * enclosureBlend * (3 - 2 * enclosureBlend);
    const localExposure = 1 - shelter;
    target.sealedTunnel = sealedTunnel;
    target.tunnelKind = routeFrame?.tunnelKind || null;
    target.enclosureBlend = enclosureBlend;
    target.shelter = shelter;
    target.localExposure = localExposure;
    target.distantExposure = sealedTunnel
      ? localExposure
      : LOCAL_RAIN_SHELTER_CONTRACT.exteriorExposure;
    return out ? target : Object.freeze(target);
  }

  /** Resolve one deterministic depth band without sorting or allocating in the weather frame loop. */
  function precipitationDepthBandId(family, index) {
    const normalizedIndex = Math.max(0, Math.trunc(Number(index) || 0));
    const pattern = family === 'snow-base'
      ? PRECIPITATION_DEPTH_CONTRACT.snowBaseBandPattern
      : PRECIPITATION_DEPTH_CONTRACT.rainBandPattern;
    return pattern[normalizedIndex % pattern.length];
  }

  /** Resolve the moon sprite offset from the main lighting direction without letting sky art own a light target. */
  function resolveMoonVisualOffset(direction, out = {}) {
    const x = Number(direction?.x ?? direction?.[0]);
    const y = Number(direction?.y ?? direction?.[1]);
    const z = Number(direction?.z ?? direction?.[2]);
    const length = Math.hypot(x, y, z);
    if ([x, y, z].every(Number.isFinite) && Number.isFinite(length) && length > 0.000_001) {
      const scale = MOON_VISUAL_DISTANCE_M / length;
      out.x = x * scale;
      out.y = y * scale;
      out.z = z * scale;
      out.usesPhysicalDirection = true;
      return out;
    }
    out.x = LEGACY_MOON_VISUAL_OFFSET[0];
    out.y = LEGACY_MOON_VISUAL_OFFSET[1];
    out.z = LEGACY_MOON_VISUAL_OFFSET[2];
    out.usesPhysicalDirection = false;
    return out;
  }

  /** Resolve one dragon's wrapped world-route distance without adding any positional oscillation. */
  function darkDragonRouteDistanceM(playerDistanceM, flightElapsedSeconds, offsetM) {
    if (![playerDistanceM, flightElapsedSeconds, offsetM].every(Number.isFinite)) {
      throw new TypeError('Dark-dragon flight requires finite route, time, and offset inputs.');
    }
    if (flightElapsedSeconds < 0) {
      throw new RangeError('Dark-dragon flight time cannot be negative.');
    }
    const contract = DARK_DRAGON_FLIGHT_CONTRACT;
    const unwrappedRouteDistanceM = offsetM + flightElapsedSeconds * contract.forwardSpeedMps;
    const relativeDistanceM = unwrappedRouteDistanceM - playerDistanceM;
    const aheadM = (
      (relativeDistanceM % contract.cycleLengthM) + contract.cycleLengthM
    ) % contract.cycleLengthM;
    return playerDistanceM + aheadM + contract.routeLeadBiasM;
  }

  // Family ids are a public visual contract shared with config, debug tooling, and documentation.
  const fallbackFamilyManifest = Object.freeze([
    Object.freeze({
      id: 'dawn_archipelago',
      landmarks: Object.freeze(['eroded_island', 'sandstone_temple', 'wind_gate']),
      environments: Object.freeze(['cloud_steps', 'dawn_dust_spires'])
    }),
    Object.freeze({
      id: 'prairie_court',
      landmarks: Object.freeze(['meadow_island', 'flower_court', 'bell_tower']),
      environments: Object.freeze(['vine_bridge', 'petal_grove'])
    }),
    Object.freeze({
      id: 'rainforest_gloom',
      landmarks: Object.freeze(['root_cathedral', 'canopy_tower', 'broken_bridge']),
      environments: Object.freeze(['luminous_pool', 'firefly_reeds'])
    }),
    Object.freeze({
      id: 'twilight_valley',
      landmarks: Object.freeze(['ice_canyon', 'race_gate', 'twilight_stand']),
      environments: Object.freeze(['ice_ribbon', 'snow_fan'])
    }),
    Object.freeze({
      id: 'star_vault',
      landmarks: Object.freeze(['floating_library', 'star_platform', 'observatory_tower']),
      environments: Object.freeze(['constellation_tree', 'orbit_lanterns'])
    }),
    Object.freeze({
      id: 'eden_eye',
      landmarks: Object.freeze(['black_ridge', 'red_crystal_vein', 'broken_effigy']),
      environments: Object.freeze(['ash_vortex', 'storm_fangs'])
    })
  ]);

  // Config is loaded before world.js; using its family arrays prevents display metadata from drifting from the theme contract.
  const configuredZones = window.NeonV23Config?.zones;
  const familyManifest = Object.freeze(fallbackFamilyManifest.map((fallback, index) => {
    const configured = configuredZones?.[index];
    return Object.freeze({
      id: configured?.id || fallback.id,
      landmarks: Object.freeze([...(configured?.landmarkFamilies || fallback.landmarks)]),
      environments: Object.freeze([...(configured?.atmosphere?.environmentFamilies || fallback.environments)])
    });
  }));

  const localFamilySlots = Object.freeze([
    Object.freeze({ eroded_island: ['landmarks', 0], sandstone_temple: ['landmarks', 1], wind_gate: ['landmarks', 2], cloud_steps: ['environments', 0], dawn_dust_spires: ['environments', 1] }),
    Object.freeze({ meadow_island: ['landmarks', 0], flower_court: ['landmarks', 2], bell_tower: ['landmarks', 1], vine_bridge: ['environments', 0], petal_grove: ['environments', 1] }),
    Object.freeze({ root_cathedral: ['landmarks', 0], canopy_tower: ['landmarks', 1], broken_bridge: ['landmarks', 2], luminous_pool: ['environments', 0], firefly_reeds: ['environments', 1] }),
    Object.freeze({ ice_canyon: ['landmarks', 0], race_gate: ['landmarks', 2], twilight_stand: ['landmarks', 1], ice_ribbon: ['environments', 0], snow_fan: ['environments', 1] }),
    Object.freeze({ floating_library: ['landmarks', 0], star_platform: ['landmarks', 2], observatory_tower: ['landmarks', 1], constellation_tree: ['environments', 0], orbit_lanterns: ['environments', 1] }),
    Object.freeze({ black_ridge: ['landmarks', 0], red_crystal_vein: ['landmarks', 1], broken_effigy: ['landmarks', 2], ash_vortex: ['environments', 0], storm_fangs: ['environments', 1] })
  ]);

  // Dense weather may enlarge a lobe far beyond its fair-weather silhouette. This presentation-only
  // contract keeps the road deck and active camera corridor readable without changing cloud count or weather.
  const CLOUD_PRESENTATION_CLEARANCE_CONTRACT = Object.freeze({
    roadVerticalClearanceM: 36,
    geometryVerticalRadius: 0.56,
    sightlineStartM: 4,
    sightlineLengthM: 320,
    sightlineNearRadiusM: 7,
    sightlineFarRadiusM: 18,
    sightlineFeatherM: 16,
    cameraBubbleInnerM: 3,
    cameraBubbleOuterM: 24,
    minimumScale: 0.001,
    presentationOnly: true
  });

  // Density partitions the existing cloud-lobe budget across three physical materials. No weather transition may
  // create geometry, multiply instances, or invent a second weather clock.
  const CLOUD_WEATHER_LAYER_CONTRACT = Object.freeze({
    version: 2,
    layerIds: Object.freeze(['high-wisp', 'mid-body', 'low-weather-deck']),
    altitudeRangesM: Object.freeze([
      Object.freeze([68, 92]),
      Object.freeze([48, 70]),
      Object.freeze([30, 54])
    ]),
    weatherAuthority: 'shared-weather-snapshot',
    lightingAuthority: 'physical-lighting-state',
    sharedGeometryCount: 1,
    drawGroupBudget: 3,
    instanceBudgetMode: 'partition-existing-lobes',
    clusterVisualLanguage: 'few-monumental-navigable-cloud-hills-walls-and-high-veils',
    clusterCount: Object.freeze({ mobile: 24, desktop: 48 }),
    lobesPerClusterRange: Object.freeze([2, 3]),
    horizontalScaleRangeM: Object.freeze([28, 62]),
    verticalScaleRangeM: Object.freeze([5, 22]),
    minimumAuthoredWorldBottomM: 45,
    undersideModel: 'physical-normal-shadow-plus-high-quality-density-rolloff',
    projectedShadowMode: 'global-cloud-transmission',
    visualOnly: true
  });
  const CLOUD_LAYER_REALM_COLORS = Object.freeze([
    Object.freeze([0xe2_ebf1, 0xd0_dde5, 0xa8_b8c2]),
    Object.freeze([0xc4_d1dd, 0xb8_c8d4, 0x8f_a1ae])
  ]);
  const CLOUD_LAYER_REALM_EMISSIVES = Object.freeze([
    Object.freeze([0x40_5668, 0x30_4658, 0x20_303d]),
    Object.freeze([0x36_475c, 0x2c_3d50, 0x20_2c38])
  ]);

  // The Ultra environment is a visual shell only: its sky follows the render camera, while a bounded world-space
  // horizon anchor preserves translation parallax without ever writing camera, map, collision, or lighting authority.
  // Three concentric relief bands share one physical mesh per realm, replacing the former unlit ribbon and repeated cones.
  const WORLD_ULTRA_PRESENTATION_CONTRACT = Object.freeze({
    version: 4,
    qualityId: 'high',
    skyDomeRadiusM: 820,
    horizonRadiusM: 640,
    horizonSegments: 96,
    horizonZoneCount: 6,
    horizonDepthLayerCount: 3,
    horizonLayerRadiiM: Object.freeze([468, 554, 640]),
    horizonLayerWidthsM: Object.freeze([96, 112, 128]),
    horizonLayerMinimumCrestM: Object.freeze([4, 3, 2]),
    horizonLayerReliefM: Object.freeze([96, 78, 62]),
    horizonOpenSkyRatioRange: Object.freeze([0.55, 0.75]),
    horizonMonumentalCrestRangeM: Object.freeze([68, 132]),
    horizonSilhouetteLanguage: 'realm-monuments-cloud-mountains-open-pilgrimage-sky',
    horizonTrianglesPerZone: 1_728,
    horizonMeshesPerZone: 1,
    horizonInstancesPerZone: 0,
    horizonMorphTargetsPerZone: 1,
    horizonMaximumVisibleDrawGroups: 1,
    horizonMaximumAnchorLagM: 96,
    horizonGeometryMode: 'deterministic-concentric-relief-bands',
    horizonMaterialModel: 'opaque-physically-lit-standard',
    horizonTransitionMode: 'single-mesh-position-normal-morph-explicit-color-attribute',
    horizonColorTransitionMode: 'webgl1-webgl2-next-color-attribute',
    horizonAnchorMode: 'bounded-world-space-parallax',
    cameraContract: 'read-only-unchanged',
    materialDetailMode: 'world-space-multiscale',
    farSceneryAuthority: 'zone.atmosphere.farScenery',
    lightingAuthority: 'main-physical-lighting-rig',
    createsLightCount: 0,
    registersMapEntityCount: 0,
    reversible: true,
    presentationOnly: true
  });
  const WORLD_ULTRA_SKY_PALETTES = Object.freeze([
    Object.freeze({ zenith: 0x2b_5877, horizon: 0xd0_9b69, lower: 0x6f_6655 }),
    Object.freeze({ zenith: 0x38_7090, horizon: 0xc6_c18a, lower: 0x58_7455 }),
    Object.freeze({ zenith: 0x1b_485e, horizon: 0x9a_9275, lower: 0x2b_4634 }),
    Object.freeze({ zenith: 0x2b_3d6c, horizon: 0xc4_7467, lower: 0x55_526e }),
    Object.freeze({ zenith: 0x13_1b43, horizon: 0x68_527d, lower: 0x29_2948 }),
    Object.freeze({ zenith: 0x12_101c, horizon: 0x59_2d38, lower: 0x20_1920 })
  ]);

  /** Return one deterministic unsigned hash without consuming gameplay or presentation RNG streams. */
  function horizonHash32(seed, sample) {
    let value = (Number(seed) ^ Math.imul(Number(sample) + 1, 0x9e_3779b1)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x85_ebca6b) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 0xc2_b2ae35) >>> 0;
    return (value ^ (value >>> 16)) >>> 0;
  }

  /** Hash authored far-scenery identifiers so every realm receives a stable, independently shaped range. */
  function horizonProfileSeed(zoneIndex, farScenery = []) {
    const source = `${Number(zoneIndex) || 0}:${Array.isArray(farScenery) ? farScenery.join('|') : ''}`;
    let seed = 0x81_1c9dc5;
    for (let index = 0; index < source.length; index++) {
      seed ^= source.charCodeAt(index);
      seed = Math.imul(seed, 0x01_000193) >>> 0;
    }
    return seed;
  }

  /** Sample seamless cyclic value noise; integer knot counts close exactly at the 360-degree seam. */
  function horizonCyclicNoise(sampleIndex, segmentCount, knotCount, seed) {
    const wrappedIndex = ((sampleIndex % segmentCount) + segmentCount) % segmentCount;
    const position = wrappedIndex / segmentCount * knotCount;
    const lowerKnot = Math.floor(position);
    const local = smoothstepUnit(position - lowerKnot);
    const lower = horizonHash32(seed, lowerKnot % knotCount) / 0xff_ff_ffff;
    const upper = horizonHash32(seed, (lowerKnot + 1) % knotCount) / 0xff_ff_ffff;
    return lower + (upper - lower) * local;
  }

  /**
   * Build the immutable data profile behind one realm's three-dimensional horizon.
   * The profile is presentation-only and uses authored realm identifiers rather than gameplay RNG.
   */
  function createUltraHorizonProfile(zoneIndex, farScenery = []) {
    const segmentCount = WORLD_ULTRA_PRESENTATION_CONTRACT.horizonSegments;
    const sceneryIds = Array.isArray(farScenery) ? farScenery : [];
    const seed = horizonProfileSeed(zoneIndex, sceneryIds);
    const monumentProfile = sceneryIds.some((id) => /tower|spire|library|lattice|arch|portal/.test(id));
    const [minimumOpenSkyRatio, maximumOpenSkyRatio] =
      WORLD_ULTRA_PRESENTATION_CONTRACT.horizonOpenSkyRatioRange;
    const openSkyRatioTarget = minimumOpenSkyRatio
      + (horizonHash32(seed, 0x51) / 0xff_ff_ffff)
        * (maximumOpenSkyRatio - minimumOpenSkyRatio);
    const layers = [];
    for (
      let layerIndex = 0;
      layerIndex < WORLD_ULTRA_PRESENTATION_CONTRACT.horizonDepthLayerCount;
      layerIndex++
    ) {
      const samples = [];
      const minimumCrest =
        WORLD_ULTRA_PRESENTATION_CONTRACT.horizonLayerMinimumCrestM[layerIndex];
      const relief = WORLD_ULTRA_PRESENTATION_CONTRACT.horizonLayerReliefM[layerIndex];
      const layerSeed = horizonHash32(seed, layerIndex * 97 + 11);
      const occupiedSamples = segmentCount * (1 - openSkyRatioTarget);
      const monumentHalfWidthSamples = Math.max(4, occupiedSamples * 0.25);
      const monumentCenters = [
        horizonHash32(layerSeed, 0x71) % segmentCount,
        horizonHash32(layerSeed, 0xa7) % segmentCount
      ];
      const monumentalHeightM = WORLD_ULTRA_PRESENTATION_CONTRACT.horizonMonumentalCrestRangeM[0]
        + horizonHash32(layerSeed, 0xc1) / 0xff_ff_ffff
          * (WORLD_ULTRA_PRESENTATION_CONTRACT.horizonMonumentalCrestRangeM[1]
            - WORLD_ULTRA_PRESENTATION_CONTRACT.horizonMonumentalCrestRangeM[0]);
      for (let index = 0; index < segmentCount; index++) {
        const macro = horizonCyclicNoise(
          index,
          segmentCount,
          3 + (zoneIndex + layerIndex) % 3,
          layerSeed
        );
        const middle = horizonCyclicNoise(
          index,
          segmentCount,
          8 + (zoneIndex * 2 + layerIndex) % 4,
          horizonHash32(layerSeed, 29)
        );
        const detail = horizonCyclicNoise(
          index,
          segmentCount,
          19 + (zoneIndex + layerIndex * 3) % 5,
          horizonHash32(layerSeed, 61)
        );
        const profile = macro * 0.54 + middle * 0.31 + detail * 0.15;
        let monumentPulse = 0;
        for (const center of monumentCenters) {
          const directDistance = Math.abs(index - center);
          const cyclicDistance = Math.min(directDistance, segmentCount - directDistance);
          const normalized = Math.max(0, 1 - cyclicDistance / monumentHalfWidthSamples);
          monumentPulse = Math.max(monumentPulse, normalized * normalized * (3 - 2 * normalized));
        }
        const cloudMountainShoulder = Math.pow(profile, 2.6) * relief * 0.34;
        const monumentScale = monumentProfile ? 1 : 0.82;
        const crestHeight = minimumCrest
          + relief * 0.05
          + cloudMountainShoulder
          + monumentPulse * monumentalHeightM * monumentScale * (1 - layerIndex * 0.12);
        const radialOffset = (middle - 0.5) * (18 - layerIndex * 3)
          + (detail - 0.5) * 7;
        const footHeight = -56 - layerIndex * 6 + (detail - 0.5) * 4;
        samples.push(Object.freeze({
          angle: index / segmentCount * Math.PI * 2,
          crestRadius:
            WORLD_ULTRA_PRESENTATION_CONTRACT.horizonLayerRadiiM[layerIndex] + radialOffset,
          crestHeight,
          footHeight,
          shoulderHeight: footHeight + (crestHeight - footHeight) * (0.34 + middle * 0.08),
          tone: macro * 0.42 + middle * 0.38 + detail * 0.20,
          monumentPulse
        }));
      }
      layers.push(Object.freeze(samples));
    }
    return Object.freeze({
      seed,
      monumentProfile,
      openSkyRatioTarget,
      farScenery: Object.freeze([...sceneryIds]),
      layers: Object.freeze(layers)
    });
  }

  function clampUnit(value) {
    return Math.max(0, Math.min(1, value));
  }

  function smoothstepUnit(value) {
    const bounded = clampUnit(value);
    return bounded * bounded * (3 - 2 * bounded);
  }

  /** Resolve high, middle, and precipitation-only low cloud density from the shared weather snapshot. */
  function resolveCloudLayerPresentation(weather = {}, out = {}) {
    const cloudCover = clampUnit(Number(weather.cloudCover) || 0);
    const precipitation = Math.max(
      clampUnit(Number(weather.rain) || 0),
      clampUnit(Number(weather.snow) || 0),
      clampUnit(Number(weather.hail) || 0)
    );
    const precipitationBlend = smoothstepUnit(precipitation);
    out.high = clampUnit(cloudCover * (1 - precipitationBlend * 0.30));
    out.middle = smoothstepUnit((cloudCover - 0.12) / 0.72);
    out.low = smoothstepUnit((cloudCover - 0.52) / 0.48) * precipitationBlend;
    out.precipitation = precipitation;
    return out;
  }

  function requiredCloudLiftUnchecked(currentBottomM, minimumBottomM) {
    return Math.max(0, minimumBottomM - currentBottomM);
  }

  /** Return the upward translation needed to keep a weather lobe above the shared road/deck envelope. */
  function requiredCloudLiftM(currentBottomM, minimumBottomM) {
    if (!Number.isFinite(currentBottomM) || !Number.isFinite(minimumBottomM)) {
      throw new TypeError('Cloud road clearance requires finite bottom heights.');
    }
    return requiredCloudLiftUnchecked(currentBottomM, minimumBottomM);
  }

  function cloudSightlineScaleUnchecked(
    relativeX,
    relativeY,
    relativeZ,
    normalizedForwardX,
    normalizedForwardY,
    normalizedForwardZ,
    lobeRadiusM,
    distanceSquaredM = (
      relativeX * relativeX + relativeY * relativeY + relativeZ * relativeZ
    )
  ) {
    const contract = CLOUD_PRESENTATION_CLEARANCE_CONTRACT;
    const cameraBubbleOuterCenterDistanceM = contract.cameraBubbleOuterM + lobeRadiusM;
    const cameraBubbleScale = distanceSquaredM
        >= cameraBubbleOuterCenterDistanceM * cameraBubbleOuterCenterDistanceM
      ? 1
      : smoothstepUnit(
        (Math.sqrt(distanceSquaredM) - lobeRadiusM - contract.cameraBubbleInnerM)
          / (contract.cameraBubbleOuterM - contract.cameraBubbleInnerM)
      );
    const forwardDistanceM = relativeX * normalizedForwardX
      + relativeY * normalizedForwardY
      + relativeZ * normalizedForwardZ;
    if (forwardDistanceM <= contract.sightlineStartM
      || forwardDistanceM >= contract.sightlineLengthM) {
      return Math.max(contract.minimumScale, cameraBubbleScale);
    }
    const perpendicularDistanceSquaredM = Math.max(
      0,
      distanceSquaredM - forwardDistanceM * forwardDistanceM
    );
    const corridorProgress = clampUnit(
      (forwardDistanceM - contract.sightlineStartM)
        / (contract.sightlineLengthM - contract.sightlineStartM)
    );
    const corridorRadiusM = contract.sightlineNearRadiusM
      + (contract.sightlineFarRadiusM - contract.sightlineNearRadiusM) * corridorProgress;
    const sightlineOuterDistanceM = lobeRadiusM + corridorRadiusM + contract.sightlineFeatherM;
    if (perpendicularDistanceSquaredM >= sightlineOuterDistanceM * sightlineOuterDistanceM) {
      return Math.max(contract.minimumScale, cameraBubbleScale);
    }
    const surfaceDistanceFromRayM = Math.sqrt(perpendicularDistanceSquaredM) - lobeRadiusM;
    const sightlineScale = smoothstepUnit(
      (surfaceDistanceFromRayM - corridorRadiusM) / contract.sightlineFeatherM
    );
    return Math.max(contract.minimumScale, Math.min(cameraBubbleScale, sightlineScale));
  }

  /** Smoothly attenuate only cloud geometry intersecting the active camera bubble or forward sightline. */
  function cloudSightlineScale(
    relativeX,
    relativeY,
    relativeZ,
    forwardX,
    forwardY,
    forwardZ,
    lobeRadiusM
  ) {
    const values = [
      relativeX,
      relativeY,
      relativeZ,
      forwardX,
      forwardY,
      forwardZ,
      lobeRadiusM
    ];
    if (values.some((value) => !Number.isFinite(value)) || lobeRadiusM < 0) {
      throw new TypeError('Cloud sightline clearance requires finite vectors and a non-negative radius.');
    }
    const forwardLength = Math.hypot(forwardX, forwardY, forwardZ);
    if (forwardLength <= 0.000_001) {
      throw new RangeError('Cloud sightline clearance requires a non-zero camera direction.');
    }
    const distanceSquaredM = (
      relativeX * relativeX + relativeY * relativeY + relativeZ * relativeZ
    );
    return cloudSightlineScaleUnchecked(
      relativeX,
      relativeY,
      relativeZ,
      forwardX / forwardLength,
      forwardY / forwardLength,
      forwardZ / forwardLength,
      lobeRadiusM,
      distanceSquaredM
    );
  }

  function createDecorationLayer({
    THREE,
    scene,
    state,
    clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
    lerp = (a, b, t) => a + (b - a) * t,
    roadCenterAt,
    roadSlopeAt,
    localZFromS,
    sampleWorldFrameAtDistance = null,
    sampleCommittedWorldFrameAtDistance = null,
    sampleTerrainHeight = null,
    getWorldRenderOrigin = null,
    camera,
    branchSeparation = 0,
    groundSceneryExclusionHalfWidth = 0,
    groundSceneryGap = 1.2,
    roadClearanceQuery = null,
    maximumDeckHeight = 0,
    zones: providedZones,
    quality,
    renderQualityId,
    zoneAtS,
    visualSeed,
    isReducedMotionEnabled = () => false
  }) {
    const Modeling = window.NeonV23Modeling;
    if (!Modeling) throw new Error('V23 modeling module missing before world module initialization');
    const RegionScenery = window.NeonV23RegionScenery;
    const Creatures = window.NeonV23Creatures;
    const Candlelight = window.NeonV23Candlelight;
    if (!RegionScenery) throw new Error('V23 region-scenery module missing before world module initialization');
    if (!Creatures) throw new Error('V23 creature module missing before world module initialization');
    if (!Candlelight) throw new Error('V23 candlelight module missing before world module initialization');
    const isSealedTunnelFrame = window.NeonV23Weather?.isSealedTunnelFrame;
    if (typeof isSealedTunnelFrame !== 'function') {
      throw new Error('V23 world requires the shared tunnel weather-shelter contract');
    }

    const zones = providedZones || window.NeonV23Config?.zones || [];
    if (zones.length < familyManifest.length) throw new Error('V23 world requires six configured zones');
    RegionScenery.validateConfiguredZones(zones);
    const regionGenerationBudget = RegionScenery.REGION_SCENERY_CONTRACT?.generationBudget;
    const regionPresentationDistance = regionGenerationBudget?.presentationDistanceM;
    if (RegionScenery.REGION_SCENERY_CONTRACT?.version !== REGION_SCENERY_INTEGRATION_CONTRACT.version
      || regionGenerationBudget?.addedFamilyCount !== REGION_SCENERY_INTEGRATION_CONTRACT.addedFamilies
      || regionGenerationBudget?.familiesPerRegion !== REGION_SCENERY_INTEGRATION_CONTRACT.familiesPerRegion
      || regionGenerationBudget?.landmarksPerRegion !== REGION_SCENERY_INTEGRATION_CONTRACT.landmarksPerRegion
      || regionGenerationBudget?.environmentsPerRegion !== REGION_SCENERY_INTEGRATION_CONTRACT.environmentsPerRegion
      || regionGenerationBudget?.majorDetailEnterDistanceM !== REGION_DETAIL_ENTER_M
      || regionGenerationBudget?.majorDetailExitDistanceM !== REGION_DETAIL_EXIT_M
      || regionPresentationDistance?.playerForwardMajorSurfaceM !== SCENERY_FORWARD_MAJOR_SURFACE_M
      || regionPresentationDistance?.playerForwardOtherSurfaceM !== SCENERY_FORWARD_OTHER_SURFACE_M
      || regionPresentationDistance?.playerRearSurfaceM !== SCENERY_REAR_SURFACE_RETENTION_M
      || regionPresentationDistance?.cameraPrewarmPlaneMarginM
        !== CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M
      || regionPresentationDistance?.cameraRetentionPlaneMarginM
        !== CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M
      || regionPresentationDistance?.cameraMinimumGraceMs !== CAMERA_RELEVANCE_MINIMUM_GRACE_MS
      || regionPresentationDistance?.cameraExpandedPlaneCount !== 6) {
      throw new Error('V23 world requires the frozen 48-family region-scenery V2 contract.');
    }
    Creatures.validateConfiguredZones(zones);
    Candlelight.validateZones(zones);
    const creatureTransitionContract = Creatures.CREATURE_VISUAL_CONTRACT?.transition;
    if (creatureTransitionContract?.policy !== CREATURE_ADJACENT_PREVIEW_POLICY
      || creatureTransitionContract.previewLengthM !== TRANSITION_LENGTH
      || creatureTransitionContract.segmentLengthM !== REALM_TRANSITION_SEGMENT_LENGTH_M) {
      throw new Error('V23 creature preview must share the configured world transition length and segmentation.');
    }
    if (typeof isReducedMotionEnabled !== 'function') {
      throw new TypeError('V23 world requires isReducedMotionEnabled to be a read-only callback.');
    }
    if (typeof sampleCommittedWorldFrameAtDistance !== 'function'
      || typeof sampleTerrainHeight !== 'function'
      || typeof roadClearanceQuery !== 'function') {
      throw new TypeError(
        'V23 classified scenery and creatures require committed-frame, rendered-terrain, and complete-road clearance authorities.'
      );
    }

    const search = new URLSearchParams(window.location.search);
    const forcedZoneValue = search.has('zone') ? Number(search.get('zone')) : Number.NaN;
    const forcedZone = Number.isInteger(forcedZoneValue) && forcedZoneValue >= 0 && forcedZoneValue < zones.length
      ? forcedZoneValue
      : null;
    const requestedQuality = typeof quality === 'string' ? quality : search.get('quality') || 'auto';
    const qualityProfile = quality && typeof quality === 'object' && (quality.id === 'high' || quality.id === 'mobile')
      ? quality
      : Modeling.resolveQualityProfile(requestedQuality, {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
        userAgent: window.navigator?.userAgent || ''
      });
    const mobile = qualityProfile.id === 'mobile';
    const normalizeFactoryRenderQuality = (value) => {
      const id = String(typeof value === 'string' ? value : value?.id || '').toLowerCase();
      if (id === 'low' || id === 'medium' || id === 'high') return id;
      if (id === 'mobile') return 'low';
      return mobile ? 'low' : 'high';
    };
    const detail = {
      radial: Math.max(8, qualityProfile.radialSegments),
      tube: Math.max(6, qualityProfile.radialSegments - (mobile ? 2 : 4)),
      path: Math.max(12, qualityProfile.tubularSegments),
      bevel: Math.max(1, qualityProfile.bevelSegments),
      particles: Math.max(80, Math.round(360 * qualityProfile.particleScale)),
      farDensity: qualityProfile.farDensity
    };
    const seedInput = visualSeed ?? search.get('seed') ?? 'v23-world';
    if (typeof seedInput !== 'string') {
      throw new TypeError('V23 world visualSeed must be a string.');
    }
    const seed = seedInput;
    if (!seed.trim()) throw new TypeError('V23 world requires a non-empty string visual seed.');
    const seeded = Modeling.createRng(`${seed}:decorations`);
    const randomUnit = () => {
      if (typeof seeded === 'function') return seeded();
      if (typeof seeded.next === 'function') return seeded.next();
      if (typeof seeded.float === 'function') return seeded.float();
      throw new Error('NeonV23Modeling.createRng returned an unsupported generator');
    };
    const random = (min = 0, max = 1) => min + (max - min) * randomUnit();
    // Sky additions own a separate deterministic stream so clouds and dark creatures never reshuffle authored scenery or gameplay RNG.
    const skySeeded = Modeling.createRng(`${seed}:sky-atmosphere`);
    const skyRandomUnit = () => {
      if (typeof skySeeded === 'function') return skySeeded();
      if (typeof skySeeded.next === 'function') return skySeeded.next();
      if (typeof skySeeded.float === 'function') return skySeeded.float();
      throw new Error('NeonV23Modeling.createRng returned an unsupported sky generator');
    };
    const skyRandom = (min = 0, max = 1) => min + (max - min) * skyRandomUnit();
    // Precipitation owns a third visual stream, so adding drops or flakes cannot reshuffle clouds or authored scenery.
    const weatherSeeded = Modeling.createRng(`${seed}:weather-effects`);
    const weatherRandomUnit = () => {
      if (typeof weatherSeeded === 'function') return weatherSeeded();
      if (typeof weatherSeeded.next === 'function') return weatherSeeded.next();
      if (typeof weatherSeeded.float === 'function') return weatherSeeded.float();
      throw new Error('NeonV23Modeling.createRng returned an unsupported weather generator');
    };
    const weatherRandom = (min = 0, max = 1) => min + (max - min) * weatherRandomUnit();
    const modelDebug = search.get('modelDebug') === '1';
    const topologySeen = new Set();
    const topology = [];
    const deco = [];
    const pooledModels = [];
    const animatedModels = [];
    const regionSceneryRoots = [];
    const ambientCandlelightRoots = [];
    const creaturePoolRoots = [];
    const creatureSlots = [];
    const activeCreatureSlots = new Set();
    const creatureSlotByRoot = new WeakMap();
    const acceptedSceneryPeers = [];
    const regionBuildDiagnostics = [];
    const regionSilhouetteMaterials = [];
    const regionDetailMaterials = [];
    const regionPartKindsSeen = new Set();
    const mapEntities = [];
    const mapEntityByObject = new WeakMap();
    const mapEntityContract = Object.seal({
      version: WORLD_CAMERA_CLEARANCE_ENVELOPE_CONTRACT.mapContractVersion,
      revision: 0,
      coordinateMode: 'absolute-world-xz',
      cameraClearanceEnvelopeVersion: WORLD_CAMERA_CLEARANCE_ENVELOPE_CONTRACT.version,
      cameraClearanceEnvelopeAuthority: WORLD_CAMERA_CLEARANCE_ENVELOPE_CONTRACT.authority,
      entities: mapEntities
    });
    const materialCache = new Map();
    const ultraWorldSurfaceUniforms = [];
    const ultraCloudDetailUniforms = [];
    const scenerySnowColor = new THREE.Color(0xdf_eaf0);
    const sceneryDustColor = new THREE.Color(0xa8_7147);
    const sceneryWeatherMaterialRules = Object.freeze([
      Object.freeze({ key: 'base', snowMix: 0.34 }),
      Object.freeze({ key: 'trim', snowMix: 0.20 }),
      Object.freeze({ key: 'dark', snowMix: 0.14 }),
      Object.freeze({ key: 'accent', snowMix: 0.10 })
    ]);
    const boundsScratch = new THREE.Box3();
    const graphFrameScratch = {};
    const graphOriginScratch = {};
    const weatherSurfaceFrameScratch = { y: 0 };
    const rainShelterScratch = {};
    // Camera residency is presentation-only. Every math object is retained for the lifetime of this layer so Film
    // cuts cannot allocate per root or leak camera state into committed route, weather, map, or gameplay authority.
    const cameraWorldMatrixScratch = new THREE.Matrix4();
    const cameraViewMatrixScratch = new THREE.Matrix4();
    const cameraViewProjectionScratch = new THREE.Matrix4();
    const cameraVisibleFrustumScratch = new THREE.Frustum();
    const cameraPrewarmFrustumScratch = new THREE.Frustum();
    const cameraRetentionFrustumScratch = new THREE.Frustum();
    const cameraResidencySphereScratch = new THREE.Sphere(new THREE.Vector3(), 0);
    const cameraRenderPositionScratch = new THREE.Vector3();
    let cameraResidencyFrameReady = false;
    const clearanceReport = {
      realmLengthM: ZONE_LENGTH,
      realmTransitionLengthM: TRANSITION_LENGTH,
      sceneryMotifLengthM: SCENERY_MOTIF_LENGTH,
      groundSceneryExclusionHalfWidth,
      groundSceneryRequiredGap: groundSceneryGap,
      groundSceneryMinClearance: Number.POSITIVE_INFINITY,
      groundSceneryClearanceViolations: 0,
      groundSceneryClosestFamily: null,
      groundSceneryMaxHorizontalRadius: 0,
      roadCapsuleQueries: 0,
      roadCapsuleClearanceViolations: 0,
      sceneryAnchorEpoch: 0,
      sceneryAnchorRefreshes: 0,
      sceneryAnchorCacheHits: 0,
      sceneryAnchorResetCount: 0,
      sceneryAnchorRejectedWindows: 0,
      sceneryAnchorVisibleClearanceViolations: 0,
      sceneryAnchorMinRoadGap: Number.POSITIVE_INFINITY,
      sceneryAnchorCachedCount: 0,
      sceneryPeerRequiredGapM: SCENERY_PEER_EDGE_GAP_M,
      sceneryPeerMinimumGapM: Number.POSITIVE_INFINITY,
      sceneryPeerClearanceViolations: 0,
      cameraRelevantSceneryRoots: 0,
      cameraVisibleSceneryRoots: 0,
      cameraExpandedPlaneCount: 6,
      cameraPrewarmPlaneMarginM: CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M,
      cameraRetentionPlaneMarginM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
      cameraPlaneHysteresisM: CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M,
      cameraMinimumGraceMs: CAMERA_RELEVANCE_MINIMUM_GRACE_MS,
      visibleRootRebindDeferrals: 0,
      regionAdapterTriangles: 0,
      regionAdapterDrawGroups: 0,
      regionAdapterPartKindCount: 0,
      regionDetailEnterM: REGION_DETAIL_ENTER_M,
      regionDetailExitM: REGION_DETAIL_EXIT_M,
      regionDetailFadingRoots: 0,
      regionAdapterMaximumHorizontalRadiusM: 0,
      regionAdapterMetricsAuthority: REGION_SCENERY_INTEGRATION_CONTRACT.adapterMetricsAuthority,
      regionMajorRoots: 0,
      regionEnvironmentRoots: 0,
      ambientCandlelightRoots: 0,
      ambientCandlelightMinimumRoadGapM: Number.POSITIVE_INFINITY,
      terrainHeightAuthority: SCENERY_TERRAIN_CONTACT_CONTRACT.terrainHeightAuthority,
      terrainHeightSamples: 0,
      terrainGroundedRootBindings: 0,
      terrainDesignedAirborneRootBindings: 0,
      terrainMaximumContactErrorM: 0,
      ambientCandlelightInstanceGroundings: 0,
      ambientCandlelightMaximumContactErrorM: 0,
      ambientCandlelightMinimumFlameSeamM: Number.POSITIVE_INFINITY,
      ambientCandlelightMaximumFlameSeamM: Number.NEGATIVE_INFINITY,
      creaturePoolRoots: 0,
      creatureActiveRoots: 0,
      creatureVisibleRoots: 0,
      cameraRelevantCreatureRoots: 0,
      cameraVisibleCreatureRoots: 0,
      creatureMinimumRoadGapM: Number.POSITIVE_INFINITY,
      creatureMinimumDeckClearanceM: Number.POSITIVE_INFINITY,
      creatureMinimumLargeSpacingM: Number.POSITIVE_INFINITY,
      creatureMinimumClusterSpacingM: Number.POSITIVE_INFINITY,
      creatureMinimumForwardReadM: Number.POSITIVE_INFINITY,
      creatureProofDeferrals: 0,
      creaturePlacementRejects: 0,
      legacyMantaEnabled: LEGACY_CREATURES_ENABLED,
      legacyDragonEnabled: LEGACY_CREATURES_ENABLED,
      airTrafficExcludedFromGroundClearance: true,
      airTrafficMinDeckClearance: Number.POSITIVE_INFINITY,
      airTrafficDeckClearanceViolations: 0,
      starAnchorError: 0,
      moonDirectionSource: 'legacy-visual-offset',
      moonVisualLightDirectionErrorRadians: null
    };

    /**
     * Register one stable read-only-to-consumers map record for an actual 3D object. Numeric pose fields
     * are updated in place beside the matching Object3D update, so the map cannot invent or retain scenery.
     */
    function registerMapEntity(object, category, radiusM) {
      if (!object?.isObject3D || mapEntityByObject.has(object)) {
        throw new Error('World map records require one previously unregistered real Object3D root.');
      }
      const realmId = object.userData.regionSceneryRealmId
        || object.userData.creatureRealmId
        || object.userData.realmId
        || zones[object.userData.visualZone ?? object.userData.zoneIndex]?.id
        || zones[0]?.id;
      const realmZoneIndex = RegionScenery.REGION_IDS.indexOf(realmId);
      const geometryHorizontalRadiusM = Math.max(
        0,
        Number(object.userData.horizontalRadius) || Number(radiusM) || 0
      );
      const horizontalRadiusM = Math.max(1, Number(radiusM) || geometryHorizontalRadiusM || 1);
      const localMinY = Number.isFinite(Number(object.userData.localMinY))
        ? Number(object.userData.localMinY)
        : 0;
      const localMaxY = Number.isFinite(Number(object.userData.localMaxY))
        ? Number(object.userData.localMaxY)
        : localMinY;
      const motionEnvelopeM = Math.max(0, Number(object.userData.motionEnvelopeM) || 0);
      const centerY = (localMinY + localMaxY) * 0.5;
      const halfHeightM = Math.abs(localMaxY - localMinY) * 0.5;
      const record = Object.seal({
        id: `world-scene-${mapEntities.length + 1}`,
        kind: object.userData.kind || category,
        category,
        family: object.userData.regionSceneryFamilyId
          || object.userData.creatureFamilyId
          || object.userData.familyId
          || object.userData.zoneFamily
          || object.name
          || category,
        realmId,
        sceneLayer: object.userData.sceneLayer || (category === 'air-traffic' ? 'air' : 'roadside'),
        semanticRole: object.userData.semanticRole || category,
        mapPriority: Number.isInteger(object.userData.mapPriority) ? object.userData.mapPriority : 0,
        zoneIndex: Number.isInteger(object.userData.creatureZoneIndex)
          ? object.userData.creatureZoneIndex
          : realmZoneIndex >= 0
            ? realmZoneIndex
            : Number.isInteger(object.userData.visualZone)
          ? object.userData.visualZone
          : Number.isInteger(object.userData.zoneIndex) ? object.userData.zoneIndex : 0,
        visible: false,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        // `radiusM` remains the minimap compatibility field; Film uses the explicit complete envelope below.
        radiusM: horizontalRadiusM,
        horizontalRadiusM,
        geometryHorizontalRadiusM,
        motionEnvelopeM,
        absoluteMinY: localMinY,
        absoluteMaxY: localMaxY,
        centerY,
        halfHeightM,
        cameraClearanceMinY: localMinY - motionEnvelopeM,
        cameraClearanceMaxY: localMaxY + motionEnvelopeM,
        cameraClearanceCenterY: centerY,
        cameraClearanceHalfHeightM: halfHeightM + motionEnvelopeM,
        terrainContactMode: object.userData.terrainContactMode || 'not-applicable',
        anchorEpoch: 0
      });
      mapEntities.push(record);
      mapEntityByObject.set(object, record);
      return record;
    }

    function updateMapEntity(object, visible, x, y, z, heading, anchorEpoch = 0) {
      const record = mapEntityByObject.get(object);
      if (!record) return;
      record.visible = Boolean(visible);
      if (!record.visible) return;
      if (![x, y, z, heading].every(Number.isFinite)) {
        throw new RangeError(`World map entity ${record.id} requires a finite absolute pose.`);
      }
      record.x = x;
      record.y = y;
      record.z = z;
      record.heading = heading;
      const localMinY = Number.isFinite(Number(object.userData.localMinY))
        ? Number(object.userData.localMinY)
        : 0;
      const localMaxY = Number.isFinite(Number(object.userData.localMaxY))
        ? Number(object.userData.localMaxY)
        : localMinY;
      const motionEnvelopeM = Math.max(0, Number(object.userData.motionEnvelopeM) || 0);
      const exactMinY = y + localMinY;
      const exactMaxY = y + localMaxY;
      const centerY = (exactMinY + exactMaxY) * 0.5;
      const halfHeightM = Math.abs(exactMaxY - exactMinY) * 0.5;
      record.geometryHorizontalRadiusM = Math.max(
        0,
        Number(object.userData.horizontalRadius) || record.geometryHorizontalRadiusM
      );
      record.horizontalRadiusM = Math.max(
        1,
        Number(object.userData.effectiveHorizontalRadiusM)
          || record.geometryHorizontalRadiusM
          || record.horizontalRadiusM
      );
      record.radiusM = record.horizontalRadiusM;
      record.motionEnvelopeM = motionEnvelopeM;
      record.absoluteMinY = exactMinY;
      record.absoluteMaxY = exactMaxY;
      record.centerY = centerY;
      record.halfHeightM = halfHeightM;
      record.cameraClearanceMinY = exactMinY - motionEnvelopeM;
      record.cameraClearanceMaxY = exactMaxY + motionEnvelopeM;
      record.cameraClearanceCenterY = centerY;
      record.cameraClearanceHalfHeightM = halfHeightM + motionEnvelopeM;
      record.terrainContactMode = object.userData.terrainContactMode || 'not-applicable';
      record.anchorEpoch = Number(anchorEpoch) || 0;
    }

    function registerGeometry(geometry, meta) {
      if (!modelDebug || topologySeen.has(geometry.uuid)) return geometry;
      topologySeen.add(geometry.uuid);
      topology.push({ ...meta, ...Modeling.analyzeTopology(geometry, { tolerance: 0.000_01 }) });
      return geometry;
    }

    function asColor(value, fallback) {
      return Number.isFinite(value) ? value : fallback;
    }

    function zonePalette(zoneIndex) {
      const zone = zones[zoneIndex] || {};
      const palette = zone.palette || {};
      const fallback = [
        [0xc3_9462, 0xf2_c98d, 0x9f_e7df, 0x68_594b, 0xff_e5a8],
        [0x70_a677, 0xc5_d889, 0xff_d884, 0x4f_7058, 0xf7_f4b9],
        [0x3e_6f5d, 0x76_a77f, 0x9f_e7df, 0x24_483e, 0xb8_ef91],
        [0x8a_a8c9, 0xd6_8fa6, 0xff_d884, 0x5e_668b, 0xbd_a7ff],
        [0x5c_5a82, 0x8a_78ad, 0xff_e5a8, 0x2d_3158, 0x9f_e7df],
        [0x3b_3138, 0x74_454b, 0xf0_4654, 0x20_1b24, 0xff_b58f]
      ][zoneIndex];
      return {
        base: asColor(palette.base ?? palette.surface ?? palette.terrain ?? palette.primary ?? zone.floor, fallback[0]),
        trim: asColor(palette.trim ?? palette.structure ?? palette.secondary ?? zone.road, fallback[1]),
        accent: asColor(palette.organic ?? palette.accent ?? zone.accent, fallback[2]),
        dark: asColor(palette.dark ?? palette.shadow ?? palette.roadEmissive ?? zone.roadEmissive, fallback[3]),
        glow: asColor(palette.glow ?? palette.light ?? zone.edge, fallback[4])
      };
    }

    /** Add dormant world-space color, roughness, and micro-normal variation to one physical scenery material. */
    function installUltraWorldSurface(material) {
      if (!material || material.userData.neonV23UltraWorldDetail) {
        return material?.userData?.neonV23UltraWorldDetail || null;
      }
      const detailUniform = { value: 0 };
      const previousCompile = material.onBeforeCompile;
      const previousCacheKey = material.customProgramCacheKey?.bind(material);
      material.userData.neonV23UltraWorldDetail = detailUniform;
      material.onBeforeCompile = (shader, renderer) => {
        if (typeof previousCompile === 'function') previousCompile.call(material, shader, renderer);
        shader.uniforms.uV23UltraWorldDetail = detailUniform;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vV23UltraWorldPosition;'
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvV23UltraWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
uniform float uV23UltraWorldDetail;
varying vec3 vV23UltraWorldPosition;
float v23UltraHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
if (uV23UltraWorldDetail > 0.5) {
  float v23Macro = sin(vV23UltraWorldPosition.x * 0.018 + vV23UltraWorldPosition.z * 0.013) * 0.5
    + sin(vV23UltraWorldPosition.x * 0.071 - vV23UltraWorldPosition.z * 0.063) * 0.25;
  float v23Grain = v23UltraHash(floor(vV23UltraWorldPosition.xz * 3.2)) - 0.5;
  diffuseColor.rgb *= 1.0 + v23Macro * 0.105 + v23Grain * 0.075;
}`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
if (uV23UltraWorldDetail > 0.5) {
  float v23RoughMacro = sin(vV23UltraWorldPosition.x * 0.043 + vV23UltraWorldPosition.z * 0.051);
  float v23RoughGrain = v23UltraHash(floor(vV23UltraWorldPosition.xz * 2.4)) - 0.5;
  roughnessFactor = clamp(roughnessFactor + v23RoughMacro * 0.065 + v23RoughGrain * 0.090, 0.18, 1.0);
}`
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
if (uV23UltraWorldDetail > 0.5) {
  float v23NormalX = sin(vV23UltraWorldPosition.x * 2.7 + vV23UltraWorldPosition.z * 1.9);
  float v23NormalZ = cos(vV23UltraWorldPosition.z * 2.3 - vV23UltraWorldPosition.x * 1.7);
  normal = normalize(normal + mat3(viewMatrix) * vec3(v23NormalX, 0.0, v23NormalZ) * 0.028);
}`
          );
      };
      material.customProgramCacheKey = () => `${previousCacheKey ? previousCacheKey() : ''}|v23-ultra-world-v1`;
      ultraWorldSurfaceUniforms.push(detailUniform);
      return detailUniform;
    }

    /** Add a High-only underside rolloff and density variation without inventing a second cloud-lighting authority. */
    function installUltraCloudDetail(material) {
      const detailUniform = { value: 0 };
      material.userData.neonV23UltraCloudDetail = detailUniform;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uV23UltraCloudDetail = detailUniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vV23UltraCloudLocalY;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvV23UltraCloudLocalY = transformed.y;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
uniform float uV23UltraCloudDetail;
varying float vV23UltraCloudLocalY;`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
if (uV23UltraCloudDetail > 0.5) {
  float v23CloudUnderside = 1.0 - smoothstep(-0.35, 0.42, vV23UltraCloudLocalY);
  float v23CloudDensity = sin(vV23UltraCloudLocalY * 13.0) * 0.025;
  diffuseColor.rgb *= 1.0 - v23CloudUnderside * 0.24 + v23CloudDensity;
}`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
if (uV23UltraCloudDetail > 0.5) roughnessFactor = clamp(roughnessFactor + 0.035, 0.0, 1.0);`
          );
      };
      material.customProgramCacheKey = () => 'v23-ultra-cloud-v1';
      ultraCloudDetailUniforms.push(detailUniform);
      return detailUniform;
    }

    function materialsFor(zoneIndex) {
      if (materialCache.has(zoneIndex)) return materialCache.get(zoneIndex);
      const palette = zonePalette(zoneIndex);
      const materials = {
        // Realm scenery is weathered stone, woven cape cloth, petals, wood, ice, and memory light. Keeping all
        // opaque lobes dielectric removes the former metallic/industrial read under the shared HDR environment.
        base: Modeling.createMaterial({ THREE, kind: 'organic', color: palette.base, emissive: palette.dark, emissiveIntensity: 0.08, roughness: 0.92, metalness: 0, procedural: true }),
        trim: Modeling.createMaterial({ THREE, kind: 'organic', color: palette.trim, emissive: palette.dark, emissiveIntensity: 0.10, roughness: 0.84, metalness: 0, procedural: true }),
        dark: Modeling.createMaterial({ THREE, kind: 'organic', color: palette.dark, emissive: palette.dark, emissiveIntensity: 0.14, roughness: 0.90, metalness: 0, procedural: true }),
        accent: Modeling.createMaterial({ THREE, kind: 'organic', color: palette.accent, emissive: palette.accent, emissiveIntensity: zoneIndex === 5 ? 0.42 : 0.20, roughness: 0.78, metalness: 0, procedural: true }),
        glow: Modeling.createMaterial({ THREE, kind: 'glow', color: palette.glow, transparent: true, opacity: 0.72, depthWrite: false }),
        haze: Modeling.createMaterial({ THREE, kind: 'effect', color: palette.glow, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
      };
      for (const key of ['base', 'trim', 'dark', 'accent']) installUltraWorldSurface(materials[key]);
      // Shared scenery materials keep immutable dry baselines so continuous weather never compounds tint or roughness.
      materials.weatherBase = Object.freeze({
        baseColor: palette.base,
        trimColor: palette.trim,
        darkColor: palette.dark,
        accentColor: palette.accent,
        baseRoughness: materials.base.roughness,
        trimRoughness: materials.trim.roughness,
        darkRoughness: materials.dark.roughness,
        accentRoughness: materials.accent.roughness,
        baseMetalness: materials.base.metalness,
        trimMetalness: materials.trim.metalness,
        darkMetalness: materials.dark.metalness,
        accentMetalness: materials.accent.metalness
      });
      materialCache.set(zoneIndex, materials);
      return materials;
    }

    /** Apply one shared wet/snow/dust response to authored scenery without changing its geometry or collision role. */
    function updateSceneryWeatherMaterials(weatherState) {
      const wetness = clamp(Number(weatherState?.wetness) || 0, 0, 1);
      const snowCover = clamp(Number(weatherState?.snowCover) || 0, 0, 1);
      const dust = clamp(Number(weatherState?.dust) || 0, 0, 1);
      for (const materials of materialCache.values()) {
        const baseline = materials.weatherBase;
        for (const { key, snowMix } of sceneryWeatherMaterialRules) {
          const material = materials[key];
          material.color
            .setHex(baseline[`${key}Color`])
            .lerp(scenerySnowColor, snowCover * snowMix)
            .lerp(sceneryDustColor, dust * (key === 'base' ? 0.24 : 0.14))
            .multiplyScalar(1 - wetness * (key === 'base' ? 0.12 : 0.08));
          material.roughness = clamp(
            lerp(baseline[`${key}Roughness`], 0.46, wetness)
              + snowCover * (key === 'base' ? 0.18 : 0.10),
            0.30,
            0.98
          );
          material.metalness = lerp(baseline[`${key}Metalness`], 0, snowCover);
        }
      }
      for (const entry of regionSilhouetteMaterials) {
        const { material, baseline } = entry;
        material.color
          .setHex(baseline.color)
          .lerp(scenerySnowColor, snowCover * 0.34)
          .lerp(sceneryDustColor, dust * 0.24)
          .multiplyScalar(1 - wetness * 0.12);
        material.roughness = clamp(
          lerp(baseline.roughness, 0.46, wetness) + snowCover * 0.18,
          0.30,
          0.98
        );
        material.metalness = lerp(baseline.metalness, 0, snowCover);
      }
      // Major-detail materials are root-private only for independent fading; their physical weather response still
      // follows the realm's shared dielectric cloth/stone source without compounding the previous frame.
      for (const { material, sharedMaterial } of regionDetailMaterials) {
        material.color.copy(sharedMaterial.color);
        if (material.emissive && sharedMaterial.emissive) material.emissive.copy(sharedMaterial.emissive);
        material.emissiveIntensity = sharedMaterial.emissiveIntensity;
        material.roughness = sharedMaterial.roughness;
        material.metalness = sharedMaterial.metalness;
      }
    }

    function contractFamily(zoneIndex, localFamily) {
      const slot = localFamilySlots[zoneIndex]?.[localFamily];
      return slot ? familyManifest[zoneIndex][slot[0]][slot[1]] : localFamily;
    }

    function visualMesh(geometry, material, zoneIndex, family, role = 'body') {
      const familyId = contractFamily(zoneIndex, family);
      registerGeometry(geometry, { zone: zoneIndex, family: familyId, role });
      const mesh = new THREE.Mesh(geometry, material);
      // Shadow availability is an invariant of an opaque main visual; the quality profile changes resolution, not truth.
      mesh.castShadow = allowsOpaqueShadow(mesh);
      mesh.receiveShadow = true;
      Modeling.markMainVisual(mesh, { module: 'world', zone: zoneIndex, family: familyId, role });
      return mesh;
    }

    /** Exclude transparent and additive effects from opaque shadow maps while retaining every physical caster. */
    function allowsOpaqueShadow(mesh) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return materials.every((material) => {
        const kind = material?.userData?.neonV23?.kind;
        return material
          && !['effect', 'glow', 'glass'].includes(kind)
          && material.transparent !== true
          && !(Number(material.transmission) > 0);
      });
    }

    function attach(group, mesh, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.scale.set(...scale);
      group.add(mesh);
      return mesh;
    }

    function loft(rings, zoneIndex, family, role, material = 'trim') {
      return visualMesh(Modeling.createLoftGeometry({ THREE, rings, capStart: true, capEnd: true }), materialsFor(zoneIndex)[material], zoneIndex, family, role);
    }

    function extrusion(outline, depth, zoneIndex, family, role, material = 'trim', bevel = 0.08) {
      const geometry = Modeling.createExtrudedProfileGeometry({ THREE, outline, depth, bevel, bevelSegments: detail.bevel });
      return visualMesh(geometry, materialsFor(zoneIndex)[material], zoneIndex, family, role);
    }

    function tube(points, radius, zoneIndex, family, role, material = 'trim', radialSegments = detail.tube) {
      const geometry = Modeling.createTubeGeometry({
        THREE,
        points,
        radius,
        tubularSegments: Math.max(points.length * 3, detail.path),
        radialSegments,
        closed: false,
        capStart: true,
        capEnd: true
      });
      return visualMesh(geometry, materialsFor(zoneIndex)[material], zoneIndex, family, role);
    }

    function loopTube(points, radius, zoneIndex, family, role, material = 'trim', radialSegments = detail.tube) {
      const geometry = Modeling.createTubeGeometry({
        THREE,
        points,
        radius,
        tubularSegments: Math.max(points.length * 3, detail.path),
        radialSegments,
        closed: true
      });
      return visualMesh(geometry, materialsFor(zoneIndex)[material], zoneIndex, family, role);
    }

    function rock(seedOffset, zoneIndex, family, role, material = 'base') {
      const geometry = Modeling.createNoiseRockGeometry({
        THREE,
        seed: Modeling.hashSeed(`${seed}:${zoneIndex}:${family}:${seedOffset}`),
        radius: 1,
        height: 2,
        radialSegments: detail.radial,
        heightSegments: mobile ? 5 : 8,
        noise: 0.28,
        flatten: 0.13
      });
      return visualMesh(geometry, materialsFor(zoneIndex)[material], zoneIndex, family, role);
    }

    function radial(profile, zoneIndex, family, role, material = 'trim', segments = detail.radial) {
      const geometry = Modeling.createRadialGeometry({ THREE, profile, segments, axis: 'y', capStart: true, capEnd: true });
      return visualMesh(geometry, materialsFor(zoneIndex)[material], zoneIndex, family, role);
    }

    function polygonRingY(y, radiusX, radiusZ, sides = detail.radial, phase = 0) {
      return Array.from({ length: sides }, (_, index) => {
        const angle = phase + index / sides * Math.PI * 2;
        return [Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ];
      });
    }

    function ellipseRingZ(z, radiusX, radiusY, sides = detail.radial, phase = 0) {
      return Array.from({ length: sides }, (_, index) => {
        const angle = phase + index / sides * Math.PI * 2;
        return [Math.cos(angle) * radiusX, Math.sin(angle) * radiusY, z];
      });
    }

    function addShard(group, zoneIndex, family, position, scale, material = 'accent', lean = 0) {
      const rings = [
        polygonRingY(-1, 0.48, 0.36, 7, 0.12),
        polygonRingY(0.46, 0.72, 0.52, 7, 0.42),
        polygonRingY(1, 0.06, 0.05, 7, 0.18)
      ];
      return attach(group, loft(rings, zoneIndex, family, 'closed_shard', material), position, [lean, 0, lean * 0.32], scale);
    }

    function addTaperedTower(group, zoneIndex, family, position, height, radius, material = 'trim', sides = 8) {
      const rings = [
        polygonRingY(0, radius * 1.18, radius, sides, 0.18),
        polygonRingY(height * 0.58, radius * 0.82, radius * 0.72, sides, 0.06),
        polygonRingY(height, radius * 0.46, radius * 0.42, sides, 0.32)
      ];
      return attach(group, loft(rings, zoneIndex, family, 'tapered_tower', material), position);
    }

    function addArch(group, zoneIndex, family, width, height, depth, position = [0, 0, 0], material = 'trim') {
      const points = [];
      const steps = mobile ? 7 : 11;
      for (let index = 0; index <= steps; index++) {
        const t = index / steps;
        const angle = Math.PI - Math.PI * t;
        points.push([Math.cos(angle) * width * 0.5, Math.sin(angle) * height + 0.2, 0]);
      }
      return attach(group, tube(points, depth, zoneIndex, family, 'closed_arch', material), position);
    }

    function addPetal(group, zoneIndex, family, angle, radius, height, size, material = 'accent') {
      const outline = [[0, -0.05], [0.54, 0.18], [0.82, 0.62], [0.28, 1], [-0.28, 1], [-0.82, 0.62], [-0.54, 0.18]];
      const petal = extrusion(outline, size * 0.20, zoneIndex, family, 'closed_petal', material, 0.05);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      return attach(group, petal, [x, height, z], [Math.PI / 2 - 0.28, -angle + Math.PI / 2, 0], [size, size, size]);
    }

    function makeGroup(zoneIndex, family) {
      const familyId = contractFamily(zoneIndex, family);
      const group = new THREE.Group();
      group.name = `v23-${familyId}`;
      group.userData.zoneFamily = familyId;
      group.userData.zoneIndex = zoneIndex;
      return group;
    }

    function markBaselineFinisherDetail(mesh, detailId, role) {
      mesh.userData.baselineFinisherDetail = true;
      mesh.userData.baselineRealmDetailId = detailId;
      mesh.userData.baselineDetailRole = role;
      return mesh;
    }

    /**
     * Finish every legacy 3+2 family with closed, realm-specific pilgrimage forms. The finisher never adds lights,
     * glass, metal, colliders, or gameplay writes; it enriches the measured template before pooled clones share it.
     */
    function finishBaselineFamily(group, zoneIndex, familyOrdinal) {
      const detailId = BASELINE_SCENERY_PRESENTATION_CONTRACT.realmDetailIds[zoneIndex];
      const family = group.userData.zoneFamily;
      const side = familyOrdinal % 2 === 0 ? -1 : 1;
      const phase = familyOrdinal / BASELINE_SCENERY_PRESENTATION_CONTRACT.familiesPerRealm
        * Math.PI * 2;
      const initialChildCount = group.children.length;
      const maskOutlines = [
        [[-0.82, -0.62], [0.82, -0.62], [0.62, 0.58], [0, 1.05], [-0.62, 0.58]],
        [[-0.92, -0.55], [0.92, -0.55], [0.72, 0.30], [0, 1.12], [-0.72, 0.30]],
        [[-0.78, -0.68], [0.78, -0.68], [0.92, 0.18], [0.24, 1.02], [-0.24, 1.02], [-0.92, 0.18]],
        [[-0.96, -0.48], [0.96, -0.48], [0.52, 0.22], [0.74, 0.88], [0, 1.14], [-0.74, 0.88], [-0.52, 0.22]],
        [[-0.84, -0.72], [0.84, -0.72], [0.62, 0.68], [0, 1.16], [-0.62, 0.68]],
        [[-0.90, -0.68], [0.38, -0.72], [0.88, -0.08], [0.44, 0.82], [-0.18, 1.12], [-0.76, 0.48]]
      ];
      const mask = extrusion(
        maskOutlines[zoneIndex],
        0.16,
        zoneIndex,
        family,
        `${detailId}-abstract-pilgrim-mask`,
        zoneIndex === 5 ? 'dark' : 'base',
        0.05
      );
      attach(
        group,
        markBaselineFinisherDetail(mask, detailId, 'abstract-pilgrim-mask'),
        [side * (1.3 + familyOrdinal * 0.18), 2.4 + familyOrdinal * 0.18, -1.15],
        [0, phase * 0.10, side * 0.08],
        [0.72, 0.72, 0.72]
      );

      if (zoneIndex === 0) {
        const halo = loopTube(
          ellipseRingZ(0, 1.35 + familyOrdinal * 0.08, 1.72, mobile ? 12 : 18, phase),
          0.07,
          zoneIndex,
          family,
          'dawn-memory-oculus',
          'glow',
          mobile ? 6 : 8
        );
        attach(group, markBaselineFinisherDetail(halo, detailId, 'sun-memory-oculus'), [side * 1.9, 3.4, -0.4]);
        const petal = extrusion(
          [[-0.64, -0.12], [0, 0.18], [0.74, 0.82], [0.16, 1.42], [-0.46, 0.92]],
          0.12,
          zoneIndex,
          family,
          'dawn-pilgrim-cape-petal',
          'accent',
          0.04
        );
        attach(group, markBaselineFinisherDetail(petal, detailId, 'pilgrim-cape-petal'), [-side * 2.0, 1.1, 0.9], [0, side * 0.22, side * 0.16]);
      } else if (zoneIndex === 1) {
        const bellSeed = radial(
          [[-0.52, 0.10], [-0.18, 0.48], [0.34, 0.62], [0.72, 0.14]],
          zoneIndex,
          family,
          'prairie-candle-bell-seed',
          'glow',
          mobile ? 8 : 12
        );
        attach(group, markBaselineFinisherDetail(bellSeed, detailId, 'candle-bell-seed'), [side * 2.2, 3.0, 0.8], [0, phase, 0], [0.86, 0.86, 0.86]);
        const bloom = extrusion(
          [[-0.84, 0], [-0.20, -0.20], [0.72, 0.12], [0.38, 0.82], [0, 1.30], [-0.44, 0.72]],
          0.11,
          zoneIndex,
          family,
          'prairie-woven-cape-bloom',
          'accent',
          0.04
        );
        attach(group, markBaselineFinisherDetail(bloom, detailId, 'woven-cape-bloom'), [-side * 2.1, 1.4, -0.5], [0, -phase * 0.12, -side * 0.18]);
      } else if (zoneIndex === 2) {
        const memoryRoot = tube(
          [[-2.4, 0.2, 0], [-1.2, 1.0, 0.2], [-0.3, 2.4, -0.1], [0.8, 3.2, 0.2]],
          0.12,
          zoneIndex,
          family,
          'rainforest-candle-memory-root',
          'trim',
          mobile ? 6 : 8
        );
        attach(group, markBaselineFinisherDetail(memoryRoot, detailId, 'candle-memory-root'), [side * 1.2, 0, 0.6], [0, phase * 0.18, 0]);
        const leaf = extrusion(
          [[-0.92, 0], [-0.28, -0.16], [0.78, 0.22], [0.32, 1.20], [0, 1.48], [-0.54, 0.82]],
          0.13,
          zoneIndex,
          family,
          'rainforest-leaf-cape-veil',
          'accent',
          0.05
        );
        attach(group, markBaselineFinisherDetail(leaf, detailId, 'leaf-cape-veil'), [-side * 2.0, 2.0, -0.6], [0, side * 0.26, side * 0.16]);
      } else if (zoneIndex === 3) {
        const halo = loopTube(
          ellipseRingZ(0, 1.58, 1.18 + familyOrdinal * 0.08, mobile ? 12 : 20, phase),
          0.075,
          zoneIndex,
          family,
          'twilight-afterglow-sun-halo',
          'glow',
          mobile ? 6 : 8
        );
        attach(group, markBaselineFinisherDetail(halo, detailId, 'afterglow-sun-halo'), [side * 1.7, 3.6, -0.7], [0, 0, side * 0.16]);
        const cape = extrusion(
          [[-1.10, -0.20], [0.10, -0.08], [1.08, 0.42], [0.42, 0.82], [0, 1.42], [-0.40, 0.78]],
          0.14,
          zoneIndex,
          family,
          'twilight-racing-cape',
          'accent',
          0.04
        );
        attach(group, markBaselineFinisherDetail(cape, detailId, 'racing-cape'), [-side * 2.1, 1.5, 0.5], [0, side * 0.20, -side * 0.14]);
      } else if (zoneIndex === 4) {
        const constellation = loopTube(
          ellipseRingZ(0, 1.35 + familyOrdinal * 0.10, 1.72, mobile ? 12 : 20, phase),
          0.06,
          zoneIndex,
          family,
          'vault-constellation-memory-loop',
          'glow',
          mobile ? 6 : 8
        );
        attach(group, markBaselineFinisherDetail(constellation, detailId, 'constellation-memory-loop'), [side * 1.6, 4.0, -0.8], [side * 0.18, phase * 0.06, 0]);
        const memory = radial(
          [[-0.62, 0.08], [-0.18, 0.54], [0.28, 0.60], [0.70, 0.08]],
          zoneIndex,
          family,
          'vault-candle-star-memory',
          'accent',
          mobile ? 7 : 11
        );
        attach(group, markBaselineFinisherDetail(memory, detailId, 'candle-star-memory'), [-side * 2.3, 2.3, 0.7], [0, phase, 0], [0.72, 0.72, 0.72]);
      } else {
        const brokenHalo = tube(
          [[-1.65, 0, 0], [-1.1, 0.88, 0], [-0.24, 1.42, 0], [0.54, 1.18, 0]],
          0.09,
          zoneIndex,
          family,
          'eden-stormworn-broken-halo',
          'accent',
          mobile ? 6 : 8
        );
        attach(group, markBaselineFinisherDetail(brokenHalo, detailId, 'stormworn-broken-halo'), [side * 1.7, 3.0, -0.6], [0, phase * 0.12, side * 0.12]);
        const emberPetal = extrusion(
          [[-0.72, -0.12], [0.08, -0.18], [0.84, 0.30], [0.28, 1.14], [-0.18, 1.46], [-0.58, 0.62]],
          0.13,
          zoneIndex,
          family,
          'eden-ember-memory-petal',
          'glow',
          0.04
        );
        attach(group, markBaselineFinisherDetail(emberPetal, detailId, 'ember-memory-petal'), [-side * 2.0, 1.2, 0.8], [0, -side * 0.24, side * 0.18]);
      }

      const finisherDetailCount = group.children.length - initialChildCount;
      if (finisherDetailCount < BASELINE_SCENERY_PRESENTATION_CONTRACT.minimumFinisherDetailsPerFamily) {
        throw new Error(`Baseline family ${family} did not receive its complete realm finisher.`);
      }
      Object.assign(group.userData, {
        baselineImplementationContract: BASELINE_SCENERY_PRESENTATION_CONTRACT.implementation,
        baselineImplementationVersion: BASELINE_SCENERY_PRESENTATION_CONTRACT.version,
        baselineFamilyOrdinal: familyOrdinal,
        baselineRealmDetailId: detailId,
        baselineFinisherDetailCount: finisherDetailCount,
        baselineClosedSurfaceAuthority: BASELINE_SCENERY_PRESENTATION_CONTRACT.topologyAuthority,
        baselineOpaqueMetalnessMaximum: BASELINE_SCENERY_PRESENTATION_CONTRACT.opaqueMetalnessMaximum
      });
      return group;
    }

    const regionRingPartKinds = new Set([
      'open-oculus-ring',
      'inset-halo-ring',
      'elliptic-orbit-bands'
    ]);
    const regionTubePartKinds = new Set([
      'paired-vault-ribs',
      'vault-seam-inlays',
      'terrace-edge-ribs',
      'terrace-soft-inlays',
      'swept-ribbon-bundle',
      'wind-memory-threads',
      'archive-script-inlays',
      'shelf-edge-accents'
    ]);
    const regionColumnPartKinds = new Set([
      'tapered-spire-ring',
      'tuned-spire-array',
      'open-colonnade',
      'merged-organic-stems',
      'well-rim-markers'
    ]);
    const regionClosedPetalAndTerracePartKinds = new Set([
      'woven-sail-canopy-petals',
      'memory-slab-fan',
      'merged-leaf-sails',
      'floating-terrace-stack',
      'merged-terrain-shelves',
      'ridge-or-fern-fans'
    ]);
    const regionRockPartKinds = new Set([
      'current-anchor-stones',
      'orbit-anchor-cluster'
    ]);
    const regionCapPartKinds = new Set([
      'resonance-caps',
      'seed-or-glyph-caps',
      'orbital-motes'
    ]);
    const regionBasePartKinds = new Set([
      'radial-platform',
      'stepped-plinth',
      'stone-choir-base',
      'sealed-radial-basin',
      'recessed-candle-star-carving',
      'archive-terrace'
    ]);

    function regionPartCount(part, qualityKey) {
      const authoredCount = Number(
        part.ribCount
        ?? part.petalCount
        ?? part.seamCount
        ?? part.slabCount
        ?? part.inlayCount
        ?? part.stoneCount
        ?? part.ribbonCount
        ?? part.threadCount
        ?? part.wallCount
        ?? part.markerCount
        ?? part.stemCount
        ?? part.leafCount
        ?? part.capCount
        ?? part.columnCount
        ?? part.lineCount
        ?? part.anchorCount
        ?? part.orbitCount
        ?? part.moteCount
        ?? part.shelfCount
        ?? part.fanCount
        ?? part.accentCount
        ?? part.repetitions
        ?? part.tierCount
        ?? 1
      );
      // V2 landscapes are authored as broad pilgrimage formations. Retain enough repeated closed pieces for side,
      // Top, ultrawide, and portrait Film shots; this cap prevents runaway catalogs, not ordinary richness.
      const cap = qualityKey === 'mobile' ? 6 : 12;
      return Math.max(1, Math.min(cap, Math.round(authoredCount) || 1));
    }

    function regionCirclePoints(radiusM, heightM, zScale, count, phase = 0) {
      const points = [];
      for (let index = 0; index < count; index++) {
        const angle = phase + index / count * Math.PI * 2;
        points.push([
          Math.cos(angle) * radiusM,
          heightM,
          Math.sin(angle) * radiusM * zScale
        ]);
      }
      return points;
    }

    function regionRadialComponent(radiusM, heightM, segments) {
      return Modeling.createRadialGeometry({
        THREE,
        axis: 'y',
        segments,
        profile: [
          [0, radiusM * 0.78],
          [heightM * 0.18, radiusM],
          [heightM * 0.78, radiusM * 0.72],
          [heightM, radiusM * 0.34]
        ],
        capStart: true,
        capEnd: true
      });
    }

    function regionClosedLeafOrTerraceComponent(widthM, heightM, depthM) {
      return Modeling.createExtrudedProfileGeometry({
        THREE,
        outline: [
          [-widthM * 0.50, 0],
          [widthM * 0.50, 0],
          [widthM * 0.38, heightM],
          [-widthM * 0.34, heightM * 0.86]
        ],
        depth: depthM,
        bevel: 0,
        bevelSegments: 1
      });
    }

    /** Build one thin sealed woven petal whose tapered tip and alternating root fold read as cloth, not armour. */
    function regionWovenPetalComponent(widthM, heightM, depthM, edgeTaperRatio) {
      const taper = clamp(Number(edgeTaperRatio) || 0.34, 0.18, 0.48);
      return Modeling.createExtrudedProfileGeometry({
        THREE,
        outline: [
          [-widthM * 0.50, 0],
          [widthM * 0.50, 0],
          [widthM * 0.42, heightM * 0.36],
          [widthM * taper, heightM * 0.72],
          [0, heightM],
          [-widthM * taper * 0.86, heightM * 0.70],
          [-widthM * 0.40, heightM * 0.34]
        ],
        depth: depthM,
        bevel: 0,
        bevelSegments: 1
      });
    }

    function buildRegionPartGeometries(part, context) {
      regionPartKindsSeen.add(part.kind);
      const qualityKey = context.qualityKey;
      const mobilePart = qualityKey === 'mobile';
      const radialSegments = mobilePart ? 5 : 8;
      const tubeSides = mobilePart ? 4 : 6;
      const tubeSegments = mobilePart ? 4 : 6;
      const radiusM = Math.max(0.8, Number(part.radiusM) || 1);
      const heightM = Math.max(0.8, Number(part.heightM) || 1);
      const count = regionPartCount(part, qualityKey);
      const components = [];
      const phase = context.random() * Math.PI * 2;

      if (regionRingPartKinds.has(part.kind)) {
        const ringCount = part.kind === 'elliptic-orbit-bands'
          ? Math.min(count, mobilePart ? 2 : 3)
          : 1;
        for (let index = 0; index < ringCount; index++) {
          const ringRadius = radiusM * (0.54 + index * 0.14);
          const geometry = Modeling.createTubeGeometry({
            THREE,
            points: regionCirclePoints(
              ringRadius,
              heightM * (0.40 + index * 0.09),
              0.72 + index * 0.08,
              mobilePart ? 8 : 12,
              phase + index * 0.44
            ),
            radius: Math.max(0.06, radiusM * (Number(part.thicknessRatio) || 0.035)),
            tubularSegments: mobilePart ? 8 : 12,
            radialSegments: tubeSides,
            closed: true
          });
          geometry.rotateX((index - 1) * 0.14);
          components.push(geometry);
        }
        return components;
      }

      if (regionTubePartKinds.has(part.kind)) {
        for (let index = 0; index < count; index++) {
          const spread = count === 1 ? 0 : index / (count - 1) - 0.5;
          const side = index % 2 === 0 ? -1 : 1;
          const geometry = Modeling.createTubeGeometry({
            THREE,
            points: [
              [-radiusM * 0.72, heightM * (0.18 + spread * 0.10), side * radiusM * 0.18],
              [-radiusM * 0.24, heightM * (0.48 + spread * 0.18), -side * radiusM * 0.08],
              [radiusM * 0.28, heightM * (0.58 - spread * 0.12), side * radiusM * 0.10],
              [radiusM * 0.76, heightM * (0.28 - spread * 0.08), -side * radiusM * 0.16]
            ],
            radius: Math.max(0.045, radiusM * (part.kind.includes('inlay')
              || part.kind === 'wind-memory-threads'
              || part.kind.includes('accent') ? 0.012 : 0.024)),
            tubularSegments: tubeSegments,
            radialSegments: tubeSides,
            closed: false,
            capStart: true,
            capEnd: true
          });
          geometry.rotateY(phase + spread * (Number(part.twistRadians) || 0.4));
          components.push(geometry);
        }
        return components;
      }

      if (regionColumnPartKinds.has(part.kind)) {
        for (let index = 0; index < count; index++) {
          const angle = phase + index / count * Math.PI * 2;
          const columnHeight = heightM * (0.42 + (index % 3) * 0.12);
          const geometry = regionRadialComponent(
            Math.max(0.10, radiusM * (part.kind === 'merged-organic-stems' ? 0.025 : 0.045)),
            columnHeight,
            radialSegments
          );
          geometry.translate(
            Math.cos(angle) * radiusM * (part.kind === 'well-rim-markers' ? 0.72 : 0.62),
            0,
            Math.sin(angle) * radiusM * 0.48
          );
          geometry.rotateZ(Math.sin(angle) * 0.08);
          components.push(geometry);
        }
        return components;
      }

      if (regionClosedPetalAndTerracePartKinds.has(part.kind)) {
        for (let index = 0; index < count; index++) {
          const angle = phase + index / count * Math.PI * 2;
          const isShelf = part.kind === 'floating-terrace-stack'
            || part.kind === 'merged-terrain-shelves';
          const isWovenPetal = part.kind === 'woven-sail-canopy-petals';
          const componentWidthM = isShelf ? radiusM * 1.05 : radiusM * 0.42;
          const componentHeightM = isShelf ? Math.max(0.18, heightM * 0.07) : heightM * 0.32;
          const componentDepthM = Math.max(
            isWovenPetal ? 0.045 : 0.10,
            radiusM * (isShelf ? 0.42 : isWovenPetal ? 0.018 : 0.06)
          );
          const geometry = isWovenPetal
            ? regionWovenPetalComponent(
              componentWidthM,
              componentHeightM,
              componentDepthM,
              part.edgeTaperRatio
            )
            : regionClosedLeafOrTerraceComponent(
              componentWidthM,
              componentHeightM,
              componentDepthM
            );
          if (isShelf) {
            geometry.rotateX(Math.PI / 2);
            geometry.rotateZ(angle * 0.12);
            geometry.translate(
              Math.sin(angle) * radiusM * 0.16,
              index * heightM * 0.12,
              Math.cos(angle) * radiusM * 0.12
            );
          } else {
            geometry.rotateY(-angle + Math.PI / 2);
            geometry.rotateZ(
              (index % 2 ? -1 : 1)
                * (isWovenPetal ? Number(part.clothFoldRatio) || 0.16 : 0.12)
            );
            geometry.translate(
              Math.cos(angle) * radiusM * 0.52,
              heightM * (0.18 + (index % 3) * 0.12),
              Math.sin(angle) * radiusM * 0.44
            );
          }
          components.push(geometry);
        }
        return components;
      }

      if (regionRockPartKinds.has(part.kind)) {
        for (let index = 0; index < count; index++) {
          const angle = phase + index / count * Math.PI * 2;
          const geometry = Modeling.createNoiseRockGeometry({
            THREE,
            seed: Modeling.hashSeed(`${context.familySeed}:${part.kind}:${index}`),
            radius: Math.max(0.24, radiusM * 0.13),
            height: Math.max(0.34, heightM * 0.20),
            radialSegments,
            heightSegments: mobilePart ? 3 : 4,
            noise: 0.20,
            flatten: 0.12
          });
          geometry.translate(
            Math.cos(angle) * radiusM * 0.48,
            heightM * (0.08 + (index % 2) * 0.05),
            Math.sin(angle) * radiusM * 0.36
          );
          components.push(geometry);
        }
        return components;
      }

      if (regionCapPartKinds.has(part.kind)) {
        for (let index = 0; index < count; index++) {
          const angle = phase + index / count * Math.PI * 2;
          const geometry = regionRadialComponent(
            Math.max(0.08, radiusM * 0.035),
            Math.max(0.14, heightM * 0.07),
            radialSegments
          );
          geometry.translate(
            Math.cos(angle) * radiusM * 0.58,
            heightM * (0.48 + (index % 3) * 0.11),
            Math.sin(angle) * radiusM * 0.46
          );
          components.push(geometry);
        }
        return components;
      }

      if (regionBasePartKinds.has(part.kind)) {
        const heightRatio = Number(part.heightRatio)
          || (part.kind === 'recessed-candle-star-carving' ? 0.06 : 0.12);
        const geometry = regionRadialComponent(
          radiusM * (Number(part.radiusRatio) || 0.72),
          Math.max(0.18, heightM * heightRatio),
          radialSegments
        );
        if (part.kind === 'recessed-candle-star-carving') geometry.translate(0, heightM * 0.10, 0);
        components.push(geometry);
        return components;
      }

      throw new RangeError(`Unknown V23 region render part: ${part.kind}`);
    }

    /** Merge one material batch into one real indexed BufferGeometry and dispose only its temporary components. */
    function mergeRegionBatchGeometries(geometries, definition, materialRole) {
      if (!geometries.length) {
        throw new RangeError(`Region adapter produced an empty ${materialRole} batch for ${definition.id}.`);
      }
      const positions = [];
      const indices = [];
      let vertexOffset = 0;
      for (const geometry of geometries) {
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        if (!position || !position.count) {
          throw new TypeError(`Region adapter produced invalid geometry for ${definition.id}.`);
        }
        for (let vertex = 0; vertex < position.count; vertex++) {
          positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
        }
        if (index) {
          for (let offset = 0; offset < index.count; offset++) {
            indices.push(vertexOffset + index.getX(offset));
          }
        } else {
          for (let vertex = 0; vertex < position.count; vertex++) {
            indices.push(vertexOffset + vertex);
          }
        }
        vertexOffset += position.count;
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      merged.setIndex(indices);
      merged.computeVertexNormals();
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      merged.userData.neonV23 = {
        factory: 'region-scenery-real-merged-batch',
        familyId: definition.id,
        materialRole,
        closedExpected: true,
        immutable: true
      };
      for (const geometry of geometries) geometry.dispose();
      return merged;
    }

    function measuredGeometryTriangles(geometry) {
      const index = geometry.getIndex();
      const position = geometry.getAttribute('position');
      return Math.floor((index ? index.count : position.count) / 3);
    }

    /**
     * Convert one frozen renderer-neutral plan into exactly one real mesh per material group. Measurements come
     * only from the finished BufferGeometry and Box3; catalog estimates never enter the reported adapter metrics.
     */
    function instantiateRegionTemplate({ definition, renderPlan, context }) {
      const root = new THREE.Group();
      root.name = `V23.RegionScenery.${definition.id}`;
      let triangles = 0;
      for (const groupPlan of renderPlan.groups) {
        const components = [];
        for (const part of groupPlan.parts) {
          components.push(...buildRegionPartGeometries(part, context));
        }
        const geometry = mergeRegionBatchGeometries(
          components,
          definition,
          groupPlan.materialRole
        );
        triangles += measuredGeometryTriangles(geometry);
        registerGeometry(geometry, {
          zone: context.zoneIndex,
          family: definition.id,
          role: `region-${groupPlan.materialRole}`
        });
        const sharedMaterial = materialsFor(context.zoneIndex)[groupPlan.materialRole];
        let material = sharedMaterial;
        if (definition.semanticRole === 'landmark-major' && groupPlan.materialRole === 'base') {
          material = material.clone();
          material.fog = false;
          regionSilhouetteMaterials.push({
            material,
            baseline: Object.freeze({
              color: material.color.getHex(),
              roughness: material.roughness,
              metalness: material.metalness
            })
          });
        } else if (definition.semanticRole === 'landmark-major') {
          material = material.clone();
          const baseOpacity = Number.isFinite(material.opacity) ? material.opacity : 1;
          material.transparent = true;
          material.opacity = 0;
          material.depthWrite = false;
          regionDetailMaterials.push({ material, sharedMaterial, baseOpacity });
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${root.name}.${groupPlan.materialRole}`;
        mesh.userData.regionVisibilityBand = definition.semanticRole === 'landmark-major'
          && groupPlan.materialRole !== 'base'
          ? REGION_DETAIL_VISIBILITY_BAND
          : groupPlan.visibilityBand;
        mesh.userData.regionMaterialRole = groupPlan.materialRole;
        if (mesh.userData.regionVisibilityBand === REGION_DETAIL_VISIBILITY_BAND) {
          mesh.userData.regionDetailBaseOpacity = regionDetailMaterials.at(-1)?.baseOpacity || 1;
          mesh.visible = false;
        }
        mesh.castShadow = allowsOpaqueShadow(mesh);
        mesh.receiveShadow = mesh.castShadow;
        if (groupPlan.materialRole === 'glow') {
          mesh.userData.neonV23Bloom = true;
          Modeling.markEffect(mesh, 'region-scenery merged glow batch; presentation only');
        } else {
          Modeling.markMainVisual(mesh, {
            module: 'world',
            zone: context.zoneIndex,
            family: definition.id,
            role: groupPlan.materialRole
          });
        }
        root.add(mesh);
      }
      root.updateMatrixWorld(true);
      boundsScratch.setFromObject(root);
      const maximumAbsoluteX = Math.max(Math.abs(boundsScratch.min.x), Math.abs(boundsScratch.max.x));
      const maximumAbsoluteZ = Math.max(Math.abs(boundsScratch.min.z), Math.abs(boundsScratch.max.z));
      root.userData.regionLocalMinY = boundsScratch.min.y;
      root.userData.regionLocalMaxY = boundsScratch.max.y;
      root.userData.regionMeasuredTriangles = triangles;
      root.userData.regionMeasuredDrawGroups = root.children.filter(({ isMesh }) => isMesh).length;
      if (root.userData.regionMeasuredDrawGroups < 2
        || root.userData.regionMeasuredDrawGroups > 3
        || root.userData.regionMeasuredDrawGroups !== renderPlan.groups.length) {
        throw new RangeError(
          `Region adapter ${definition.id} requires exactly one real mesh for each of its 2-3 material groups.`
        );
      }
      return {
        object: root,
        metrics: {
          triangles,
          drawGroups: root.userData.regionMeasuredDrawGroups,
          sceneLights: 0,
          colliders: 0,
          mapEntities: 0,
          gameplayWrites: 0,
          navigationWrites: 0,
          frameAssetAllocations: 0,
          horizontalRadiusM: Math.hypot(maximumAbsoluteX, maximumAbsoluteZ),
          motionEnvelopeM: 0
        }
      };
    }

    const regionSceneryPrimitives = Object.freeze({
      instantiateTemplate: instantiateRegionTemplate
    });

    function buildDawnFamilies() {
      const zoneIndex = 0;
      const families = [];

      let family = 'eroded_island';
      let group = makeGroup(zoneIndex, family);
      attach(group, rock(1, zoneIndex, family, 'wind_eroded_mass'), [0, 2.4, 0], [0, 0.22, 0], [4.8, 1.55, 3.2]);
      attach(group, tube([[-2.8, 1.5, -0.4], [-1.2, -0.8, 0], [0.4, -1.7, 0.5], [2.2, -0.5, 0.1]], 0.22, zoneIndex, family, 'underside_rib', 'dark'), [0, 0.3, 0]);
      addShard(group, zoneIndex, family, [-2.2, 4.3, 0.4], [0.42, 1.3, 0.5], 'trim', -0.18);
      families.push(group);

      family = 'sandstone_temple';
      group = makeGroup(zoneIndex, family);
      attach(group, extrusion([[-3.2, -1.5], [2.8, -1.5], [3.4, -0.5], [2.5, 1.6], [-2.7, 1.8], [-3.5, 0.4]], 0.8, zoneIndex, family, 'stepped_plinth', 'base', 0.14), [0, 0.4, 0], [Math.PI / 2, 0, 0]);
      for (const x of [-2.1, 0, 2.1]) addTaperedTower(group, zoneIndex, family, [x, 0.7, 0], 5.2 - Math.abs(x) * 0.35, 0.58, 'trim', 9);
      attach(group, extrusion([[-2.8, -0.5], [2.8, -0.5], [2.2, 0.35], [0, 1.1], [-2.2, 0.35]], 1.2, zoneIndex, family, 'carved_roof', 'accent', 0.12), [0, 5.2, 0], [0, 0, 0]);
      families.push(group);

      family = 'wind_gate';
      group = makeGroup(zoneIndex, family);
      addArch(group, zoneIndex, family, 7.5, 6.5, 0.30, [0, 0, -0.5], 'trim');
      addArch(group, zoneIndex, family, 5.4, 5.0, 0.17, [0, 0.35, 0.7], 'accent');
      for (const side of [-1, 1]) {
        attach(group, extrusion([[0, -0.2], [1.2, 0], [1.8, 0.65], [0.2, 0.42]], 0.20, zoneIndex, family, 'wind_fin', 'glow', 0.04), [side * 3.1, 2.8, 0], [0, side * 0.38, side * 0.15], [side, 1, 1]);
      }
      families.push(group);

      family = 'cloud_steps';
      group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 6; index++) {
        const outline = [[-1.6, -0.65], [1.25, -0.78], [1.72, -0.15], [1.26, 0.72], [-1.42, 0.82], [-1.82, 0.1]];
        attach(group, extrusion(outline, 0.44, zoneIndex, family, 'wind_step', index % 2 ? 'glow' : 'base', 0.12), [(index - 2.5) * 1.35, 0.35 + index * 0.56, (index % 2) * 0.8], [Math.PI / 2, index * 0.08, 0], [1, 1, 1]);
      }
      families.push(group);

      family = 'dawn_dust_spires';
      group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 7; index++) {
        const x = (index - 3) * 0.85;
        addShard(group, zoneIndex, family, [x, random(0.1, 0.6), random(-1.4, 1.4)], [random(0.28, 0.55), random(0.8, 1.8), random(0.32, 0.68)], index % 3 === 0 ? 'glow' : 'trim', random(-0.18, 0.18));
      }
      families.push(group);
      return families;
    }

    function buildPrairieFamilies() {
      const zoneIndex = 1;
      const families = [];

      let family = 'meadow_island';
      let group = makeGroup(zoneIndex, family);
      attach(group, rock(11, zoneIndex, family, 'lobed_meadow_mass'), [0, 1.7, 0], [0, -0.18, 0], [5.2, 1.25, 3.7]);
      attach(group, extrusion([[-4.2, -2.1], [-1.4, -2.6], [1.8, -2.3], [4.5, -0.7], [3.9, 1.9], [0.8, 2.5], [-2.8, 2.2], [-4.7, 0.4]], 0.36, zoneIndex, family, 'grass_crown', 'accent', 0.16), [0, 3.05, 0], [Math.PI / 2, 0.12, 0]);
      for (let index = 0; index < 5; index++) addPetal(group, zoneIndex, family, index / 5 * Math.PI * 2, 2.5, 3.4, 0.62, index % 2 ? 'glow' : 'accent');
      families.push(group);

      family = 'flower_court';
      group = makeGroup(zoneIndex, family);
      attach(group, radial([[0, 2.8], [0.35, 3.3], [0.75, 2.9], [1.1, 2.2]], zoneIndex, family, 'court_dais', 'base', detail.radial + 4), [0, 0, 0]);
      for (let index = 0; index < 9; index++) addPetal(group, zoneIndex, family, index / 9 * Math.PI * 2, 2.0, 1.1, 1.1, index % 3 === 0 ? 'glow' : 'accent');
      attach(group, tube([[0, 1.0, 0], [0.2, 2.4, 0], [0, 3.8, 0]], 0.18, zoneIndex, family, 'flower_stem', 'trim'), [0, 0, 0]);
      families.push(group);

      family = 'bell_tower';
      group = makeGroup(zoneIndex, family);
      for (const corner of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]]) addTaperedTower(group, zoneIndex, family, [corner[0], 0, corner[1]], 6.5, 0.34, 'trim', 7);
      attach(group, extrusion([[-2.4, -1.5], [2.4, -1.5], [1.8, 0.2], [0, 1.3], [-1.8, 0.2]], 2.6, zoneIndex, family, 'bell_roof', 'accent', 0.14), [0, 6.2, 0]);
      attach(group, radial([[0, 0.18], [0.8, 0.72], [1.35, 0.55], [1.65, 0.12]], zoneIndex, family, 'closed_bell', 'glow', detail.radial), [0, 3.7, 0]);
      families.push(group);

      family = 'vine_bridge';
      group = makeGroup(zoneIndex, family);
      for (const side of [-1, 1]) attach(group, tube([[-4.5, 0, side * 1.1], [-2.2, 1.0, side * 1.3], [0, 0.45, side * 1.1], [2.3, 1.05, side * 1.25], [4.6, 0, side]], 0.16, zoneIndex, family, 'braided_vine', side > 0 ? 'accent' : 'trim'), [0, 0, 0]);
      for (let index = 0; index < 7; index++) {
        attach(group, extrusion([[-0.65, 0], [0, 0.32], [0.7, 0], [0, -0.24]], 0.18, zoneIndex, family, 'leaf_step', index % 2 ? 'base' : 'accent', 0.04), [(index - 3) * 1.25, 0.65 + Math.abs(index - 3) * 0.12, 0], [Math.PI / 2, 0, 0]);
      }
      families.push(group);

      family = 'petal_grove';
      group = makeGroup(zoneIndex, family);
      for (let stem = 0; stem < 5; stem++) {
        const x = (stem - 2) * 1.2;
        attach(group, tube([[x, 0, 0], [x + random(-0.35, 0.35), 1.6, random(-0.4, 0.4)], [x, 3.0 + stem % 2, random(-0.5, 0.5)]], 0.10, zoneIndex, family, 'curved_stem', 'trim'));
        for (let petal = 0; petal < 4; petal++) addPetal(group, zoneIndex, family, petal / 4 * Math.PI * 2, 0.55, 3.0 + stem % 2, 0.55, petal === 0 ? 'glow' : 'accent').position.x += x;
      }
      families.push(group);
      return families;
    }

    function buildRainforestFamilies() {
      const zoneIndex = 2;
      const families = [];

      let family = 'root_cathedral';
      let group = makeGroup(zoneIndex, family);
      for (const side of [-1, 1]) {
        attach(group, tube([[side * 4.2, 0, 0], [side * 2.9, 1.4, 0.4], [side * 2.0, 4.6, -0.2], [side * 0.8, 7.2, 0]], 0.52, zoneIndex, family, 'cathedral_root', side > 0 ? 'base' : 'dark'));
        attach(group, tube([[side * 3.8, 0.1, 1.5], [side * 2.6, 2.0, 0.8], [side * 1.6, 4.8, 0.2]], 0.28, zoneIndex, family, 'root_buttress', 'trim'));
      }
      addArch(group, zoneIndex, family, 5.3, 6.5, 0.42, [0, 0.5, 0], 'accent');
      families.push(group);

      family = 'canopy_tower';
      group = makeGroup(zoneIndex, family);
      attach(group, tube([[0, 0, 0], [0.4, 3.2, 0.2], [-0.3, 6.5, -0.4], [0.2, 9.5, 0]], 0.70, zoneIndex, family, 'twisted_trunk', 'dark'));
      for (const [index, position] of [[0, [-2.2, 8.4, 0]], [1, [1.9, 8.8, 0.4]], [2, [0, 10.1, -0.8]]]) {
        attach(group, rock(20 + index, zoneIndex, family, 'closed_canopy', index === 2 ? 'accent' : 'base'), position, [0, index * 0.55, 0], [2.8, 0.75, 2.3]);
      }
      families.push(group);

      family = 'broken_bridge';
      group = makeGroup(zoneIndex, family);
      for (const side of [-1, 1]) {
        const outline = [[-2.8, -1.0], [2.4, -1.2], [2.8, 0.25], [1.4, 1], [-2.5, 0.82], [-3.0, 0.1]];
        attach(group, extrusion(outline, 0.55, zoneIndex, family, 'broken_deck', 'trim', 0.08), [side * 3.5, 2.2 + side * 0.28, 0], [Math.PI / 2, side * 0.08, side * 0.06], [0.95, 1, 1]);
        attach(group, tube([[side * 6.2, 0, 0], [side * 5.0, 1.8, 0.1], [side * 3.6, 2.5, 0]], 0.34, zoneIndex, family, 'bridge_root', 'base'));
      }
      families.push(group);

      family = 'luminous_pool';
      group = makeGroup(zoneIndex, family);
      attach(group, radial([[0, 3.8], [0.18, 4.2], [0.38, 3.4], [0.55, 2.8]], zoneIndex, family, 'sealed_pool_basin', 'dark', detail.radial + 4));
      // The returning radial profile folds below its outer candle-lit rim, forming a real shallow memory basin
      // rather than a flat luminous disc. Caps preserve the closed-surface and single-mesh pool contract.
      const memoryWaterBasinProfile = [
        [0.08, 2.45],
        [0.16, 3.18],
        [0.38, 3.52],
        [0.62, 3.42],
        [0.44, 3.02],
        [0.34, 2.70]
      ];
      const memoryWaterBasin = radial(
        memoryWaterBasinProfile,
        zoneIndex,
        family,
        'memory_water_basin',
        'glow',
        detail.radial + 4
      );
      memoryWaterBasin.userData.baselineOrganicProfile = 'returning-six-ring-memory-basin';
      memoryWaterBasin.userData.baselineOrganicProfilePointCount = memoryWaterBasinProfile.length;
      attach(group, memoryWaterBasin, [0, 0.5, 0]);
      for (let index = 0; index < 6; index++) addShard(group, zoneIndex, family, [Math.cos(index) * 3.2, 0.8, Math.sin(index) * 2.2], [0.18, 0.65, 0.2], 'accent', random(-0.12, 0.12));
      families.push(group);

      family = 'firefly_reeds';
      group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 9; index++) {
        const x = (index - 4) * 0.75;
        attach(group, tube([[x, 0, 0], [x + 0.18 * (index % 2 ? 1 : -1), 1.5 + index % 3, 0.2], [x - 0.12, 3 + index % 2, -0.1]], 0.055, zoneIndex, family, 'sealed_reed', index % 3 === 0 ? 'accent' : 'base', 7));
        addShard(group, zoneIndex, family, [x - 0.12, 3.1 + index % 2, -0.1], [0.10, 0.22, 0.10], 'glow');
      }
      families.push(group);
      return families;
    }

    function buildTwilightFamilies() {
      const zoneIndex = 3;
      const families = [];

      let family = 'ice_canyon';
      let group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 8; index++) {
        const side = index < 4 ? -1 : 1;
        addShard(group, zoneIndex, family, [side * (2.6 + (index % 4) * 1.1), 1.5, (index % 4 - 1.5) * 1.4], [0.9 + index % 2 * 0.4, 2.4 + (index % 4) * 0.8, 1.2], index % 3 === 0 ? 'glow' : 'base', side * random(0.05, 0.22));
      }
      families.push(group);

      family = 'race_gate';
      group = makeGroup(zoneIndex, family);
      addArch(group, zoneIndex, family, 8.5, 7.2, 0.38, [0, 0, 0], 'accent');
      addArch(group, zoneIndex, family, 6.6, 5.7, 0.16, [0, 0.3, 0.35], 'glow');
      const windMemoryPetalOutline = [
        [-1.20, 0.02],
        [-0.78, -0.26],
        [-0.18, -0.30],
        [0.52, -0.08],
        [1.16, 0.36],
        [0.62, 0.48],
        [0.08, 0.82],
        [-0.54, 0.70],
        [-1.02, 0.38]
      ];
      for (const side of [-1, 1]) {
        addShard(group, zoneIndex, family, [side * 4.4, 1.8, 0], [0.55, 1.7, 0.8], 'trim', side * 0.16);
        const windMemoryPetal = extrusion(
          windMemoryPetalOutline,
          0.18,
          zoneIndex,
          family,
          'wind_memory_petal',
          'glow',
          0.08
        );
        windMemoryPetal.userData.baselineOrganicContour = 'soft-nine-point-wind-petal';
        windMemoryPetal.userData.baselineOrganicContourPointCount = windMemoryPetalOutline.length;
        attach(
          group,
          windMemoryPetal,
          [side * 2.8, 4.1, 0.1],
          [0, 0, side * 0.14],
          [side, 1, 1]
        );
      }
      families.push(group);

      family = 'twilight_stand';
      group = makeGroup(zoneIndex, family);
      for (let tier = 0; tier < 4; tier++) {
        const inset = tier * 0.35;
        const pilgrimageStepOutline = [
          [-4.10 + inset, -1.20],
          [-3.55 + inset, -1.52],
          [2.90 - inset, -1.48],
          [4.08 - inset, -0.72],
          [3.72 - inset, 0.30],
          [1.62 - inset * 0.35, 0.92],
          [-1.82 + inset * 0.35, 0.98],
          [-3.88 + inset, 0.34]
        ];
        const pilgrimageStep = extrusion(
          pilgrimageStepOutline,
          0.42,
          zoneIndex,
          family,
          'pilgrimage_step_terrace',
          tier % 2 ? 'trim' : 'base',
          0.10
        );
        pilgrimageStep.userData.baselineOrganicContour = 'weathered-eight-point-pilgrimage-step';
        pilgrimageStep.userData.baselineOrganicContourPointCount = pilgrimageStepOutline.length;
        attach(
          group,
          pilgrimageStep,
          [0, tier * 0.65, tier * 0.75],
          [Math.PI / 2, 0, 0]
        );
      }
      const pilgrimageCapeVeilOutline = [
        [-4.60, -0.18],
        [-3.44, -0.62],
        [-0.90, -0.42],
        [1.74, -0.66],
        [4.62, -0.10],
        [3.18, 0.78],
        [0.72, 1.16],
        [-1.92, 1.02],
        [-3.72, 0.60]
      ];
      const pilgrimageCapeVeil = extrusion(
        pilgrimageCapeVeilOutline,
        1.7,
        zoneIndex,
        family,
        'pilgrimage_cape_veil',
        'accent',
        0.16
      );
      pilgrimageCapeVeil.userData.baselineOrganicContour = 'soft-nine-point-pilgrimage-cape';
      pilgrimageCapeVeil.userData.baselineOrganicContourPointCount =
        pilgrimageCapeVeilOutline.length;
      attach(group, pilgrimageCapeVeil, [0, 4.2, 1.4], [0, 0, -0.08]);
      families.push(group);

      family = 'ice_ribbon';
      group = makeGroup(zoneIndex, family);
      for (const offset of [-0.75, 0.75]) attach(group, tube([[-5, 0.2, offset], [-2.8, 1.5, -offset], [0, 0.8, offset], [2.7, 2.2, -offset], [5.2, 0.5, offset]], 0.20, zoneIndex, family, 'braided_ice_ribbon', offset > 0 ? 'glow' : 'accent'));
      families.push(group);

      family = 'snow_fan';
      group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 9; index++) {
        const angle = lerp(-1.1, 1.1, index / 8);
        addShard(group, zoneIndex, family, [Math.sin(angle) * 3.8, 0.1, Math.cos(angle) * 0.8], [0.22 + index % 2 * 0.12, 1.2 + (4 - Math.abs(4 - index)) * 0.42, 0.34], index % 3 === 0 ? 'glow' : 'trim', -angle * 0.22);
      }
      families.push(group);
      return families;
    }

    function buildVaultFamilies() {
      const zoneIndex = 4;
      const families = [];

      let family = 'floating_library';
      let group = makeGroup(zoneIndex, family);
      attach(group, radial([[0, 3.6], [0.35, 4.1], [0.7, 3.2], [1.0, 2.8]], zoneIndex, family, 'library_platform', 'dark', detail.radial + 4));
      for (let tier = 0; tier < 5; tier++) {
        const angle = tier * 0.54;
        const shelf = extrusion([[-2.4, -0.65], [2.3, -0.65], [2.6, 0.05], [1.8, 0.72], [-2.1, 0.82], [-2.6, 0.1]], 0.62, zoneIndex, family, 'floating_shelf', tier % 2 ? 'accent' : 'trim', 0.10);
        attach(group, shelf, [Math.cos(angle) * 0.9, 1.4 + tier * 1.05, Math.sin(angle) * 0.9], [0, angle, 0]);
      }
      addTaperedTower(group, zoneIndex, family, [0, 0.8, 0], 7.4, 0.42, 'glow', 10);
      families.push(group);

      family = 'star_platform';
      group = makeGroup(zoneIndex, family);
      attach(group, radial([[0, 3.8], [0.28, 4.4], [0.55, 3.7], [0.88, 2.6]], zoneIndex, family, 'star_dais', 'trim', mobile ? 12 : 18));
      for (let ray = 0; ray < 8; ray++) {
        const angle = ray / 8 * Math.PI * 2;
        attach(group, tube([[0, 1.0, 0], [Math.cos(angle) * 2.2, 1.25, Math.sin(angle) * 2.2], [Math.cos(angle) * 4.5, 1.8 + ray % 2, Math.sin(angle) * 4.5]], 0.075, zoneIndex, family, 'constellation_ray', ray % 2 ? 'accent' : 'glow', 7));
        addShard(group, zoneIndex, family, [Math.cos(angle) * 4.5, 1.8 + ray % 2, Math.sin(angle) * 4.5], [0.16, 0.34, 0.16], 'glow');
      }
      families.push(group);

      family = 'observatory_tower';
      group = makeGroup(zoneIndex, family);
      addTaperedTower(group, zoneIndex, family, [0, 0, 0], 8.8, 1.15, 'dark', 12);
      attach(group, radial([[0, 1.8], [0.35, 2.25], [0.7, 1.9], [1.1, 0.3]], zoneIndex, family, 'sealed_observatory_dome', 'accent', detail.radial + 4), [0, 8.2, 0]);
      for (const [index, radius] of [2.4, 3.1].entries()) {
        const points = Array.from({ length: mobile ? 13 : 21 }, (_, point) => {
          const angle = point / (mobile ? 12 : 20) * Math.PI * 2;
          return [Math.cos(angle) * radius, 7.7 + Math.sin(angle * 2 + index) * 0.45, Math.sin(angle) * radius];
        });
        const constellationOrbitThread = loopTube(
          points,
          0.07,
          zoneIndex,
          family,
          'constellation_orbit_thread',
          index ? 'glow' : 'trim',
          7
        );
        constellationOrbitThread.userData.baselineOrganicContour =
          'closed-constellation-memory-thread';
        attach(
          group,
          constellationOrbitThread,
          [0, 0, 0],
          [index * 0.34, 0, index * 0.22]
        );
      }
      families.push(group);

      family = 'constellation_tree';
      group = makeGroup(zoneIndex, family);
      attach(group, tube([[0, 0, 0], [0.2, 2.6, 0], [-0.2, 5.1, 0], [0, 7.2, 0]], 0.22, zoneIndex, family, 'stellar_trunk', 'dark'));
      for (let branch = 0; branch < 7; branch++) {
        const angle = branch / 7 * Math.PI * 2;
        const end = [Math.cos(angle) * (2.2 + branch % 2), 4.2 + branch % 3, Math.sin(angle) * (2.2 + branch % 2)];
        attach(group, tube([[0, 3.0 + branch * 0.36, 0], [end[0] * 0.45, end[1] - 0.6, end[2] * 0.45], end], 0.08, zoneIndex, family, 'constellation_branch', branch % 2 ? 'accent' : 'glow', 7));
        addShard(group, zoneIndex, family, end, [0.13, 0.3, 0.13], 'glow');
      }
      families.push(group);

      family = 'orbit_lanterns';
      group = makeGroup(zoneIndex, family);
      for (let lantern = 0; lantern < 6; lantern++) {
        const angle = lantern / 6 * Math.PI * 2;
        const radius = 2.1 + lantern % 2 * 1.4;
        attach(group, radial([[-0.7, 0.18], [-0.35, 0.52], [0.3, 0.62], [0.75, 0.16]], zoneIndex, family, 'closed_orbit_lantern', lantern % 2 ? 'accent' : 'glow', 8), [Math.cos(angle) * radius, 2.8 + lantern % 3, Math.sin(angle) * radius], [0, 0, 0], [0.7, 0.7, 0.7]);
      }
      families.push(group);
      return families;
    }

    function buildEdenFamilies() {
      const zoneIndex = 5;
      const families = [];

      let family = 'black_ridge';
      let group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 7; index++) {
        attach(group, rock(50 + index, zoneIndex, family, 'wind_cut_ridge', index % 3 === 0 ? 'base' : 'dark'), [(index - 3) * 1.65, 1.6 + index % 2, random(-1.2, 1.2)], [random(-0.18, 0.18), random(-0.4, 0.4), random(-0.12, 0.12)], [1.5, 2.1 + index % 3, 1.4]);
      }
      families.push(group);

      family = 'red_crystal_vein';
      group = makeGroup(zoneIndex, family);
      attach(group, tube([[-5, 0.2, 0], [-2.5, 0.7, 0.4], [0, 0.3, -0.2], [2.3, 0.9, 0.5], [5, 0.5, 0]], 0.24, zoneIndex, family, 'sealed_magma_vein', 'accent'));
      for (let index = 0; index < 11; index++) {
        addShard(group, zoneIndex, family, [(index - 5) * 0.9, 0.5, random(-1.0, 1.0)], [random(0.28, 0.62), random(0.8, 2.6), random(0.30, 0.72)], index % 4 === 0 ? 'glow' : 'accent', random(-0.22, 0.22));
      }
      families.push(group);

      family = 'broken_effigy';
      group = makeGroup(zoneIndex, family);
      attach(group, extrusion([[-1.8, -1.0], [1.7, -0.8], [2.0, 0.4], [0.8, 1.5], [-1.1, 1.3], [-2.1, 0.2]], 1.6, zoneIndex, family, 'sealed_effigy_torso', 'dark', 0.16), [0, 3.0, 0], [0, 0, -0.08], [1, 1.8, 1]);
      attach(group, rock(72, zoneIndex, family, 'fractured_head', 'base'), [0.5, 7.0, -0.2], [0.18, -0.3, 0.24], [1.1, 1.2, 1.0]);
      attach(group, tube([[-1.2, 4.8, 0], [-3.0, 3.5, 0.2], [-4.2, 2.0, 0]], 0.42, zoneIndex, family, 'remaining_arm', 'dark'));
      for (const position of [[2.8, 0.5, 0.4], [3.9, 0.2, -0.5], [-2.5, 0.4, 1.0]]) addShard(group, zoneIndex, family, position, [0.45, 0.7, 0.48], 'accent', random(-0.3, 0.3));
      families.push(group);

      family = 'ash_vortex';
      group = makeGroup(zoneIndex, family);
      for (let spiral = 0; spiral < 3; spiral++) {
        const points = Array.from({ length: mobile ? 13 : 21 }, (_, index) => {
          const t = index / (mobile ? 12 : 20);
          const angle = t * Math.PI * (3.4 + spiral * 0.6) + spiral * 2.1;
          const radius = lerp(3.8, 0.6, t);
          return [Math.cos(angle) * radius, t * 7.5, Math.sin(angle) * radius];
        });
        attach(group, tube(points, 0.08 + spiral * 0.025, zoneIndex, family, 'sealed_ash_stream', spiral === 1 ? 'accent' : 'dark', 7));
      }
      families.push(group);

      family = 'storm_fangs';
      group = makeGroup(zoneIndex, family);
      for (let index = 0; index < 10; index++) {
        const angle = index / 10 * Math.PI * 2;
        addShard(group, zoneIndex, family, [Math.cos(angle) * random(2.4, 5.0), random(0, 1.3), Math.sin(angle) * random(1.2, 3.0)], [random(0.32, 0.8), random(1.1, 3.2), random(0.35, 0.9)], index % 3 === 0 ? 'accent' : 'dark', random(-0.4, 0.4));
      }
      families.push(group);
      return families;
    }

    const zoneTemplates = [
      buildDawnFamilies(),
      buildPrairieFamilies(),
      buildRainforestFamilies(),
      buildTwilightFamilies(),
      buildVaultFamilies(),
      buildEdenFamilies()
    ].map((families, zoneIndex) => families.map(
      (group, familyOrdinal) => finishBaselineFamily(group, zoneIndex, familyOrdinal)
    ));
    if (zoneTemplates.flat().length !== BASELINE_SCENERY_PRESENTATION_CONTRACT.familyCount) {
      throw new Error('V23 baseline scenery requires all 30 finished 3+2 realm families.');
    }

    function clonePooled(template, anchorZone, visualZone, offset, slot, transitionPreview = false) {
      // Group.clone shares immutable geometries/materials; only transforms are updated, so the render loop allocates no assets.
      const object = template.clone(true);
      // Pool roots have no committed route pose yet. Keeping all six realms hidden prevents the first shader
      // pass from compiling and drawing every landmark at the origin before update() selects the live realm.
      object.visible = false;
      const side = (anchorZone + slot) % 2 === 0 ? -1 : 1;
      const landmark = slot < 3;
      object.userData.kind = 'zoneModel';
      object.userData.anchorZone = anchorZone;
      object.userData.visualZone = visualZone;
      object.userData.offset = offset;
      object.userData.slot = slot;
      // Consume the historical seeded draw so grounding cannot reshuffle any later authored variation.
      object.userData.baseY = landmark ? random(-0.3, 1.3) : random(-0.2, 0.6);
      // Preserve seeded draw order while deferring lateral placement until the scaled model bounds are known.
      const lateralUnit = randomUnit();
      object.userData.baseYaw = random(-0.28, 0.28) + (side < 0 ? 0.08 : -0.08);
      object.userData.phase = random(0, Math.PI * 2);
      object.userData.transitionPreview = transitionPreview;
      const scalar = random(landmark ? 0.84 : 0.72, landmark ? 1.24 : 1.05);
      object.scale.setScalar(scalar);
      object.updateMatrixWorld(true);
      boundsScratch.setFromObject(object);
      const radiusX = Math.max(Math.abs(boundsScratch.min.x), Math.abs(boundsScratch.max.x));
      const radiusZ = Math.max(Math.abs(boundsScratch.min.z), Math.abs(boundsScratch.max.z));
      const horizontalRadius = Math.hypot(radiusX, radiusZ);
      const motionEnvelopeM = transitionPreview ? BASELINE_TRANSITION_MOTION_ENVELOPE_M : 0;
      const effectiveHorizontalRadiusM = horizontalRadius + motionEnvelopeM;
      const forkClearance = Math.max(0, branchSeparation);
      const authoredMinimum = (landmark ? 18 : 14) + forkClearance;
      const authoredMaximum = (landmark ? 34 : 27) + forkClearance;
      const safeMinimum = Math.max(
        authoredMinimum,
        groundSceneryExclusionHalfWidth + effectiveHorizontalRadiusM + groundSceneryGap
      );
      const safeMaximum = Math.max(authoredMaximum, safeMinimum + (landmark ? 8 : 6));
      const authoredS = anchorZone * ZONE_LENGTH + offset;
      let centerDistance = lerp(safeMinimum, safeMaximum, lateralUnit);
      let graphClearance = null;
      if (typeof roadClearanceQuery === 'function') {
        // Search outward in deterministic steps so a full graph edge, not only the selected spine, owns scenery clearance.
        for (let attempt = 0; attempt < 42; attempt++) {
          const query = roadClearanceQuery({
            s: authoredS,
            lateral: side * centerDistance,
            horizontalRadius: effectiveHorizontalRadiusM,
            minimumGap: groundSceneryGap
          });
          clearanceReport.roadCapsuleQueries++;
          const clear = typeof query === 'boolean' ? query : Boolean(query?.clear);
          // Track clearance is measured after subtracting minimumGap; convert it back to physical road-to-model gap.
          graphClearance = Number.isFinite(query?.clearance)
            ? query.clearance + groundSceneryGap
            : graphClearance;
          if (clear) {
            if (!Number.isFinite(query?.clearance)) graphClearance = groundSceneryGap;
            break;
          }
          centerDistance += 4;
        }
      }
      const legacyClearance = centerDistance
        - groundSceneryExclusionHalfWidth
        - effectiveHorizontalRadiusM;
      const clearance = Number.isFinite(graphClearance) ? Math.min(legacyClearance, graphClearance) : legacyClearance;
      object.userData.lateral = side * centerDistance;
      // Every reuse window restarts from this deterministic authored offset; a crowded old tile cannot push later tiles outward forever.
      object.userData.authoredLateral = object.userData.lateral;
      object.userData.horizontalRadius = horizontalRadius;
      object.userData.motionEnvelopeM = motionEnvelopeM;
      object.userData.effectiveHorizontalRadiusM = effectiveHorizontalRadiusM;
      object.userData.localMinY = boundsScratch.min.y;
      object.userData.localMaxY = boundsScratch.max.y;
      object.userData.baseY = -object.userData.localMinY;
      object.userData.placementBand = 'ground-mid';
      object.userData.sceneLayer = 'roadside';
      object.userData.terrainContactMode = SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode;
      object.userData.requiredRoadGapM = groundSceneryGap;
      object.userData.motionEnvelopeClearanceAuthority =
        BASELINE_SCENERY_PRESENTATION_CONTRACT.clearanceRadiusAuthority;
      object.userData.groundClearance = clearance;
      clearanceReport.groundSceneryMaxHorizontalRadius = Math.max(
        clearanceReport.groundSceneryMaxHorizontalRadius,
        horizontalRadius
      );
      // With committed-route anchoring enabled, this authored probe only seeds lateral distance; final diagnostics belong to cached poses.
      if (typeof sampleCommittedWorldFrameAtDistance !== 'function') {
        if (clearance < clearanceReport.groundSceneryMinClearance) {
          clearanceReport.groundSceneryMinClearance = clearance;
          clearanceReport.groundSceneryClosestFamily = object.userData.zoneFamily || object.name || 'unknown';
        }
        if (clearance < groundSceneryGap - 0.000_1) clearanceReport.groundSceneryClearanceViolations++;
        if (typeof roadClearanceQuery === 'function' && clearance < groundSceneryGap - 0.000_1) {
          clearanceReport.roadCapsuleClearanceViolations++;
        }
      }
      scene.add(object);
      deco.push(object);
      pooledModels.push(object);
      registerMapEntity(object, landmark ? 'landmark' : 'environment', effectiveHorizontalRadiusM);
    }

    const offsets = [68, 246, 426, 132, 326, 492];
    for (let anchorZone = 0; anchorZone < zones.length; anchorZone++) {
      const current = zoneTemplates[anchorZone];
      for (let slot = 0; slot < 5; slot++) clonePooled(current[slot], anchorZone, anchorZone, offsets[slot], slot);
      if (!mobile) clonePooled(current[3], anchorZone, anchorZone, offsets[5], 5);
      // The next-zone environment is deliberately introduced inside the configured transition instead of hard-swapping at the boundary.
      const nextZone = (anchorZone + 1) % zones.length;
      clonePooled(zoneTemplates[nextZone][4], anchorZone, nextZone, ZONE_LENGTH - TRANSITION_LENGTH + 42, 6, true);
    }

    /**
     * Install one externally classified scenery root without granting the catalog any scene, map, route, or
     * collision ownership. Every final distance gate consumes measured geometry bounds from the adapter.
     */
    function installRegionSceneryEntry(entry, zoneIndex, familyOrdinal) {
      const { object, definition, metrics } = entry;
      const landmark = definition.category === 'landmark';
      const requiredRoadGapM = landmark ? REGION_MAJOR_ROAD_GAP_M : REGION_ENVIRONMENT_ROAD_GAP_M;
      const effectiveRadiusM = metrics.horizontalRadiusM + metrics.motionEnvelopeM;
      const side = (zoneIndex + familyOrdinal) % 2 === 0 ? -1 : 1;
      const localMinY = Number(object.userData.regionLocalMinY);
      const airFar = definition.placementBand === 'air-far';
      const explicitlyDesignedAirborne = DESIGNED_AIRBORNE_REGION_FAMILY_IDS.includes(definition.id);
      if (airFar !== explicitlyDesignedAirborne) {
        throw new Error(
          `Region scenery ${definition.id} must explicitly match the designed-airborne terrain contract.`
        );
      }
      const authoredCenterDistanceM = groundSceneryExclusionHalfWidth
        + Math.max(0, branchSeparation)
        + effectiveRadiusM
        + requiredRoadGapM
        + (landmark ? 12 : 8);
      Object.assign(object.userData, {
        kind: landmark ? 'regionLandmark' : 'regionEnvironment',
        anchorZone: zoneIndex,
        visualZone: zoneIndex,
        zoneIndex,
        realmId: definition.realmId,
        zoneFamily: definition.id,
        placementMode: landmark ? 'region-major' : 'region-environment',
        offset: landmark
          ? definition.preferredStationM
          : REGION_ENVIRONMENT_OFFSETS_M[familyOrdinal],
        slot: familyOrdinal,
        phase: familyOrdinal / (landmark
          ? REGION_SCENERY_INTEGRATION_CONTRACT.landmarksPerRegion
          : REGION_SCENERY_INTEGRATION_CONTRACT.environmentsPerRegion) * Math.PI * 2,
        baseYaw: side * (0.04 + familyOrdinal * 0.025),
        lateral: side * authoredCenterDistanceM,
        authoredLateral: side * authoredCenterDistanceM,
        horizontalRadius: metrics.horizontalRadiusM,
        motionEnvelopeM: metrics.motionEnvelopeM,
        effectiveHorizontalRadiusM: effectiveRadiusM,
        requiredRoadGapM,
        sameSidePeerGapM: SCENERY_PEER_EDGE_GAP_M,
        baseY: airFar
          ? REGION_AIR_DECK_CLEARANCE_M + metrics.motionEnvelopeM - localMinY
          : -localMinY,
        localMinY,
        localMaxY: Number(object.userData.regionLocalMaxY),
        terrainContactMode: airFar
          ? SCENERY_TERRAIN_CONTACT_CONTRACT.designedAirborneMode
          : SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode,
        designedAirborneClearanceM: airFar ? REGION_AIR_DECK_CLEARANCE_M : 0,
        transitionPreview: false,
        transitionEligible: definition.transitionEligible === true,
        motifRepeat: definition.motifRepeat === true,
        regionDetailEngaged: false,
        regionDetailFade: 0,
        regionDetailLastUpdateMs: null
      });
      object.visible = false;
      scene.add(object);
      deco.push(object);
      pooledModels.push(object);
      regionSceneryRoots.push(object);
      registerMapEntity(object, landmark ? 'landmark' : 'environment', effectiveRadiusM);
      clearanceReport.regionAdapterTriangles += metrics.triangles;
      clearanceReport.regionAdapterDrawGroups += metrics.drawGroups;
      clearanceReport.regionAdapterMaximumHorizontalRadiusM = Math.max(
        clearanceReport.regionAdapterMaximumHorizontalRadiusM,
        effectiveRadiusM
      );
      if (landmark) clearanceReport.regionMajorRoots++;
      else clearanceReport.regionEnvironmentRoots++;
    }

    for (let zoneIndex = 0; zoneIndex < RegionScenery.REGION_IDS.length; zoneIndex++) {
      const realmId = RegionScenery.REGION_IDS[zoneIndex];
      const built = RegionScenery.createRegionTemplates({
        realmId,
        zoneIndex,
        qualityProfile,
        seed,
        primitives: regionSceneryPrimitives
      });
      regionBuildDiagnostics.push(built.diagnostics);
      built.landmarks.forEach((entry, familyOrdinal) => {
        if (entry.definition.preferredStationM !== REGION_MAJOR_STATIONS_M[familyOrdinal]) {
          throw new Error(`Region landmark station drifted for ${entry.definition.id}.`);
        }
        installRegionSceneryEntry(entry, zoneIndex, familyOrdinal);
      });
      built.environments.forEach((entry, familyOrdinal) => {
        if (entry.definition.motifRepeat !== true) {
          throw new Error(`Region environment ${entry.definition.id} must use the 280m motif pool.`);
        }
        if (!Number.isFinite(REGION_ENVIRONMENT_OFFSETS_M[familyOrdinal])) {
          throw new Error(`Region environment ${entry.definition.id} has no V2 five-slot offset.`);
        }
        installRegionSceneryEntry(entry, zoneIndex, familyOrdinal);
      });
    }
    const expectedRegionPoolRoots = regionGenerationBudget.addedFamilyCount;
    if (regionSceneryRoots.length !== expectedRegionPoolRoots) {
      throw new Error(`Region scenery expected ${expectedRegionPoolRoots} real roots.`);
    }
    const expectedPooledRegionTotal = (mobile ? 36 : 42) + expectedRegionPoolRoots;
    if (pooledModels.length !== expectedPooledRegionTotal) {
      throw new Error(`Region scenery pool expected ${expectedPooledRegionTotal} roots before ambient candles.`);
    }
    clearanceReport.regionAdapterPartKindCount = regionPartKindsSeen.size;
    clearanceReport.regionAdapterPartKinds = Object.freeze([...regionPartKindsSeen].sort());

    const initialFactoryRenderQuality = normalizeFactoryRenderQuality(
      renderQualityId || search.get('quality') || requestedQuality
    );
    const candlelightFactory = Candlelight.createFactory({
      THREE,
      modeling: Modeling,
      zones,
      qualityProfile,
      renderQuality: initialFactoryRenderQuality,
      visualSeed: `${seed}:ambient-candlelight`,
      markMainVisual: Modeling.markMainVisual,
      markEffect: Modeling.markEffect,
      tagBloom: (object) => {
        object.userData.neonV23Bloom = true;
      }
    });
    const ambientFamilyIds = Candlelight.AMBIENT_FAMILY_CATALOG.map(({ id }) => id);
    candlelightFactory.prewarm({
      familyIds: [],
      countPerFamily: 0,
      ambientFamilyIds,
      ambientClustersPerFamily: 1
    });

    /**
     * Capture immutable per-candle transforms during prewarm. Runtime anchor binding rewrites only retained matrix
     * arrays, so every base can sample its own terrain point without allocating a Matrix4 or Vector3 in a frame.
     */
    function prepareAmbientCandleTerrainContact(cluster) {
      const handles = cluster.userData.handles;
      const bases = handles?.bases;
      const flames = handles?.flames;
      if (!bases?.isInstancedMesh || !flames?.isInstancedMesh || bases.count !== flames.count) {
        throw new TypeError(`Ambient candlelight ${cluster.name} requires paired instanced bases and flames.`);
      }
      bases.geometry.computeBoundingBox();
      bases.geometry.computeBoundingSphere();
      flames.geometry.computeBoundingBox();
      flames.geometry.computeBoundingSphere();
      bases.computeBoundingBox();
      bases.computeBoundingSphere();
      flames.computeBoundingBox();
      flames.computeBoundingSphere();
      const baseBounds = bases.geometry.boundingBox;
      const flameBounds = flames.geometry.boundingBox;
      const count = bases.count;
      const localX = new Float64Array(count);
      const localZ = new Float64Array(count);
      const baseScaleY = new Float64Array(count);
      const flameScaleY = new Float64Array(count);
      const authoredFlameSeamM = new Float64Array(count);
      const baseMatrix = bases.instanceMatrix.array;
      const flameMatrix = flames.instanceMatrix.array;
      for (let index = 0; index < count; index++) {
        const offset = index * 16;
        localX[index] = baseMatrix[offset + 12];
        localZ[index] = baseMatrix[offset + 14];
        baseScaleY[index] = Math.hypot(
          baseMatrix[offset + 4],
          baseMatrix[offset + 5],
          baseMatrix[offset + 6]
        );
        flameScaleY[index] = Math.hypot(
          flameMatrix[offset + 4],
          flameMatrix[offset + 5],
          flameMatrix[offset + 6]
        );
        const baseTopY = baseMatrix[offset + 13] + baseBounds.max.y * baseScaleY[index];
        const flameBottomY = flameMatrix[offset + 13]
          + flameBounds.min.y * flameScaleY[index];
        const seamM = flameBottomY - baseTopY;
        if (seamM < AMBIENT_CANDLE_FLAME_SEAM_MINIMUM_M - TERRAIN_CONTACT_TOLERANCE_M
          || seamM > AMBIENT_CANDLE_FLAME_SEAM_MAXIMUM_M + TERRAIN_CONTACT_TOLERANCE_M) {
          throw new RangeError(
            `Ambient candlelight ${cluster.name} authored flame seam ${seamM}m exceeds the terrain contract.`
          );
        }
        authoredFlameSeamM[index] = seamM;
      }
      return Object.seal({
        count,
        bases,
        flames,
        baseMatrix,
        flameMatrix,
        baseBoundsMinY: baseBounds.min.y,
        baseBoundsMaxY: baseBounds.max.y,
        flameBoundsMinY: flameBounds.min.y,
        flameBoundsMaxY: flameBounds.max.y,
        localX,
        localZ,
        baseScaleY,
        flameScaleY,
        authoredFlameSeamM
      });
    }

    /** Align every candle base to its own rendered-terrain sample while preserving the authored flame/base seam. */
    function alignAmbientCandleTerrainContact(cluster, anchorX, anchorZ, rootY, rootYaw) {
      const contact = cluster.userData.terrainContactInstances;
      if (!contact) throw new Error(`Ambient candlelight ${cluster.name} has no retained terrain-contact data.`);
      const cosine = Math.cos(rootYaw);
      const sine = Math.sin(rootYaw);
      let localMinY = Number.POSITIVE_INFINITY;
      let localMaxY = Number.NEGATIVE_INFINITY;
      let maximumContactErrorM = 0;
      let minimumFlameSeamM = Number.POSITIVE_INFINITY;
      let maximumFlameSeamM = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < contact.count; index++) {
        const offset = index * 16;
        const localX = contact.localX[index];
        const localZ = contact.localZ[index];
        const worldX = anchorX + cosine * localX + sine * localZ;
        const worldZ = anchorZ - sine * localX + cosine * localZ;
        const terrainY = sampleRenderedTerrainHeight(worldX, worldZ);
        const baseScaleY = contact.baseScaleY[index];
        const flameScaleY = contact.flameScaleY[index];
        const baseCenterLocalY = terrainY - rootY - contact.baseBoundsMinY * baseScaleY;
        contact.baseMatrix[offset + 13] = baseCenterLocalY;
        const baseTopLocalY = baseCenterLocalY + contact.baseBoundsMaxY * baseScaleY;
        const flameSeamM = contact.authoredFlameSeamM[index];
        const flameCenterLocalY = baseTopLocalY + flameSeamM
          - contact.flameBoundsMinY * flameScaleY;
        contact.flameMatrix[offset + 13] = flameCenterLocalY;

        const writtenBaseBottomWorldY = rootY + contact.baseMatrix[offset + 13]
          + contact.baseBoundsMinY * baseScaleY;
        const writtenBaseTopLocalY = contact.baseMatrix[offset + 13]
          + contact.baseBoundsMaxY * baseScaleY;
        const writtenFlameBottomLocalY = contact.flameMatrix[offset + 13]
          + contact.flameBoundsMinY * flameScaleY;
        const writtenFlameTopLocalY = contact.flameMatrix[offset + 13]
          + contact.flameBoundsMaxY * flameScaleY;
        const writtenFlameSeamM = writtenFlameBottomLocalY - writtenBaseTopLocalY;
        maximumContactErrorM = Math.max(
          maximumContactErrorM,
          Math.abs(writtenBaseBottomWorldY - terrainY)
        );
        minimumFlameSeamM = Math.min(minimumFlameSeamM, writtenFlameSeamM);
        maximumFlameSeamM = Math.max(maximumFlameSeamM, writtenFlameSeamM);
        localMinY = Math.min(
          localMinY,
          contact.baseMatrix[offset + 13] + contact.baseBoundsMinY * baseScaleY,
          writtenFlameBottomLocalY
        );
        localMaxY = Math.max(
          localMaxY,
          writtenBaseTopLocalY,
          writtenFlameTopLocalY
        );
      }
      contact.bases.instanceMatrix.needsUpdate = true;
      contact.flames.instanceMatrix.needsUpdate = true;
      contact.bases.computeBoundingBox();
      contact.bases.computeBoundingSphere();
      contact.flames.computeBoundingBox();
      contact.flames.computeBoundingSphere();
      cluster.userData.localMinY = localMinY;
      cluster.userData.localMaxY = localMaxY;
      cluster.userData.terrainContactSampleCount = contact.count;
      cluster.userData.terrainContactMaximumErrorM = maximumContactErrorM;
      cluster.userData.ambientFlameSeamMinimumM = minimumFlameSeamM;
      cluster.userData.ambientFlameSeamMaximumM = maximumFlameSeamM;
      clearanceReport.ambientCandlelightInstanceGroundings += contact.count;
      clearanceReport.ambientCandlelightMaximumContactErrorM = Math.max(
        clearanceReport.ambientCandlelightMaximumContactErrorM,
        maximumContactErrorM
      );
      clearanceReport.ambientCandlelightMinimumFlameSeamM = Math.min(
        clearanceReport.ambientCandlelightMinimumFlameSeamM,
        minimumFlameSeamM
      );
      clearanceReport.ambientCandlelightMaximumFlameSeamM = Math.max(
        clearanceReport.ambientCandlelightMaximumFlameSeamM,
        maximumFlameSeamM
      );
      clearanceReport.terrainMaximumContactErrorM = Math.max(
        clearanceReport.terrainMaximumContactErrorM,
        maximumContactErrorM
      );
    }

    for (let zoneIndex = 0; zoneIndex < Candlelight.AMBIENT_FAMILY_CATALOG.length; zoneIndex++) {
      const definition = Candlelight.AMBIENT_FAMILY_CATALOG[zoneIndex];
      const cluster = candlelightFactory.createAmbientCluster({
        familyId: definition.id,
        realmId: definition.realmId,
        zoneIndex,
        seed: `${seed}:ambient-candlelight:${definition.realmId}:${definition.id}`
      });
      cluster.traverse((child) => {
        if (child.isInstancedMesh && typeof child.computeBoundingBox === 'function') {
          child.computeBoundingBox();
        }
        if (child.isMesh) {
          registerGeometry(child.geometry, {
            zone: zoneIndex,
            family: definition.id,
            role: 'ambient-candlelight'
          });
        }
      });
      cluster.updateMatrixWorld(true);
      boundsScratch.setFromObject(cluster, true);
      const horizontalRadiusM = Math.hypot(
        Math.max(Math.abs(boundsScratch.min.x), Math.abs(boundsScratch.max.x)),
        Math.max(Math.abs(boundsScratch.min.z), Math.abs(boundsScratch.max.z))
      );
      const side = zoneIndex % 2 === 0 ? 1 : -1;
      const authoredCenterDistanceM = groundSceneryExclusionHalfWidth
        + Math.max(0, branchSeparation)
        + horizontalRadiusM
        + AMBIENT_CANDLELIGHT_ROAD_GAP_M
        + 7;
      Object.assign(cluster.userData, {
        kind: 'ambientCandlelight',
        anchorZone: zoneIndex,
        visualZone: zoneIndex,
        zoneIndex,
        realmId: definition.realmId,
        zoneFamily: definition.id,
        placementMode: 'ambient-environment',
        offset: 392,
        slot: 0,
        phase: zoneIndex / Candlelight.AMBIENT_FAMILY_CATALOG.length * Math.PI * 2,
        baseYaw: side * 0.08,
        lateral: side * authoredCenterDistanceM,
        authoredLateral: side * authoredCenterDistanceM,
        horizontalRadius: horizontalRadiusM,
        motionEnvelopeM: 0,
        effectiveHorizontalRadiusM: horizontalRadiusM,
        requiredRoadGapM: AMBIENT_CANDLELIGHT_ROAD_GAP_M,
        sameSidePeerGapM: SCENERY_PEER_EDGE_GAP_M,
        baseY: -boundsScratch.min.y,
        localMinY: boundsScratch.min.y,
        localMaxY: boundsScratch.max.y,
        terrainContactMode: SCENERY_TERRAIN_CONTACT_CONTRACT.instancedGroundMode,
        terrainContactInstances: prepareAmbientCandleTerrainContact(cluster),
        transitionPreview: false,
        transitionEligible: false,
        motifRepeat: true,
        sceneLayer: definition.sceneLayer,
        semanticRole: definition.semanticRole,
        mapPriority: definition.mapPriority
      });
      cluster.visible = false;
      scene.add(cluster);
      pooledModels.push(cluster);
      ambientCandlelightRoots.push(cluster);
      registerMapEntity(cluster, 'ambient-candlelight', horizontalRadiusM);
    }
    if (ambientCandlelightRoots.length !== Candlelight.AMBIENT_FAMILY_CATALOG.length) {
      throw new Error('World requires exactly one real ambient candlelight cluster per realm.');
    }
    clearanceReport.ambientCandlelightRoots = ambientCandlelightRoots.length;
    // Candidate records are allocated once. Each frame reuses their placement and render-distance fields so
    // physical-distance ordering never adds transient scene objects, geometry, materials, or map records.
    const sceneryFrameCandidates = pooledModels.map((item, stableIndex) => ({
      item,
      stableIndex,
      placement: {
        eligible: false,
        transitionPreview: false,
        repeat: 'unresolved',
        s: Number.NaN
      },
      active: false,
      retainedCachedAnchor: false,
      renderX: 0,
      renderZ: 0,
      surfaceDistanceM: Number.POSITIVE_INFINITY,
      cameraVisible: false,
      cameraRelevant: false,
      cameraAnchor: null,
      cameraGraceUntilMs: Number.NEGATIVE_INFINITY,
      cameraSurfaceDistanceM: Number.POSITIVE_INFINITY,
      wasVisibleAtFrameStart: false,
      rebindDeferred: false,
      maximumForwardSurfaceM: 0
    }));

    const creatureFactory = Creatures.createFactory({
      THREE,
      modeling: Modeling,
      qualityProfile: initialFactoryRenderQuality,
      zonesById: zones,
      visualSeed: `${seed}:creatures`,
      markMainVisual: Modeling.markMainVisual,
      markEffect: Modeling.markEffect,
      tagBloom: (object) => {
        object.userData.neonV23Bloom = true;
      }
    });
    let creatureRenderQualityId = initialFactoryRenderQuality;
    creatureFactory.prewarm();
    for (const topologyRoot of creatureFactory.getTopologyRoots()) {
      topologyRoot.traverse((child) => {
        if (!child.isMesh) return;
        registerGeometry(child.geometry, {
          zone: child.parent?.parent?.userData?.creatureZoneIndex ?? 0,
          family: child.userData.creatureFamilyId,
          role: `creature-${child.userData.creatureQualityId}`
        });
      });
    }
    for (const root of creatureFactory.getPoolRoots()) {
      const definition = Creatures.CREATURE_CATALOG.find(
        ({ id }) => id === root.userData.creatureFamilyId
      );
      if (!definition) throw new Error(`Creature pool returned an unknown family root ${root.name}.`);
      const metrics = creatureFactory.getPlacementMetrics(definition.realmId, definition.id);
      Object.assign(root.userData, {
        realmId: definition.realmId,
        zoneFamily: definition.id,
        sceneLayer: definition.sceneLayer,
        semanticRole: definition.semanticRole,
        mapPriority: definition.mapPriority,
        horizontalRadius: metrics.horizontalRadiusM,
        motionEnvelopeM: metrics.motionEnvelopeM,
        effectiveHorizontalRadiusM: metrics.horizontalRadiusM + metrics.motionEnvelopeM,
        localMinY: metrics.localMinY,
        localMaxY: metrics.localMaxY,
        terrainContactMode: definition.sceneLayer === 'air'
          ? SCENERY_TERRAIN_CONTACT_CONTRACT.designedAirborneMode
          : SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode,
        designedAirborneClearanceM: definition.sceneLayer === 'air' ? CREATURE_DECK_CLEARANCE_M : 0
      });
      root.visible = false;
      scene.add(root);
      creaturePoolRoots.push(root);
      registerMapEntity(
        root,
        'creature-ambient',
        metrics.horizontalRadiusM + metrics.motionEnvelopeM
      );
    }
    const expectedCreaturePoolRoots = Creatures.CREATURE_CATALOG.length
      * Creatures.CREATURE_VISUAL_CONTRACT.poolInstancesPerFamily;
    if (creaturePoolRoots.length !== expectedCreaturePoolRoots) {
      throw new Error(`Creature factory expected ${expectedCreaturePoolRoots} real pooled roots.`);
    }
    for (const definition of Creatures.CREATURE_CATALOG) {
      const metrics = creatureFactory.getPlacementMetrics(definition.realmId, definition.id);
      const familyOrdinal = Creatures.CREATURE_CATALOG
        .filter(({ realmId }) => realmId === definition.realmId)
        .findIndex(({ id }) => id === definition.id);
      for (let instanceIndex = 0;
        instanceIndex < Creatures.CREATURE_VISUAL_CONTRACT.poolInstancesPerFamily;
        instanceIndex++) {
        creatureSlots.push({
          definition,
          metrics,
          familyOrdinal,
          instanceIndex,
          activeRoot: null,
          s: Number.NaN,
          lateral: 0,
          anchor: null,
          transitionPreview: null,
          cameraVisible: false,
          cameraRelevant: false,
          cameraAnchor: null,
          cameraGraceUntilMs: Number.NEGATIVE_INFINITY,
          cameraSurfaceDistanceM: Number.POSITIVE_INFINITY
        });
      }
    }
    clearanceReport.creaturePoolRoots = creaturePoolRoots.length;

    function buildMantaTemplate() {
      const zoneIndex = 0;
      const family = 'sky_manta';
      const group = makeGroup(zoneIndex, family);
      const bodyRings = [
        ellipseRingZ(-2.2, 0.12, 0.09, detail.radial),
        ellipseRingZ(-1.45, 0.72, 0.35, detail.radial),
        ellipseRingZ(0.2, 0.92, 0.28, detail.radial),
        ellipseRingZ(1.65, 0.32, 0.16, detail.radial),
        ellipseRingZ(2.15, 0.08, 0.06, detail.radial)
      ];
      attach(group, loft(bodyRings, zoneIndex, family, 'closed_body', 'trim'));
      const wingOutline = [[0.15, -1.35], [3.5, -0.55], [4.6, 0.4], [2.1, 1.25], [0.2, 0.9], [-0.35, 0.1]];
      for (const side of [-1, 1]) {
        const wing = extrusion(wingOutline, 0.20, zoneIndex, family, 'closed_wing', 'base', 0.08);
        wing.position.set(side * 0.35, 0, -0.25);
        wing.rotation.set(Math.PI / 2, 0, side * -0.08);
        wing.scale.x = side;
        wing.userData.mantaWing = side;
        group.add(wing);
      }
      attach(group, tube([[0, 0, 1.4], [0.2, 0, 3.4], [-0.12, -0.05, 5.2]], 0.10, zoneIndex, family, 'sealed_tail', 'accent', 7));
      const lens = addShard(group, zoneIndex, family, [0, 0.02, -2.12], [0.22, 0.22, 0.22], 'glow');
      lens.userData.mantaGlow = true;
      return group;
    }

    const mantaTemplate = LEGACY_CREATURES_ENABLED ? buildMantaTemplate() : null;
    const mantaCount = LEGACY_CREATURES_ENABLED ? (mobile ? 5 : 10) : 0;
    for (let index = 0; index < mantaCount; index++) {
      const manta = mantaTemplate.clone(true);
      manta.userData.kind = 'airTraffic';
      manta.userData.offset = 80 + index * (820 / mantaCount) + random(-24, 24);
      manta.userData.lateral = (index % 2 ? -1 : 1) * random(26, 58);
      manta.userData.phase = random(0, Math.PI * 2);
      manta.userData.speedWave = random(0.000_25, 0.000_52);
      manta.userData.drift = random(2.5, 7.5);
      manta.scale.setScalar(random(0.42, 0.88));
      manta.updateMatrixWorld(true);
      boundsScratch.setFromObject(manta);
      // Height derives from the scaled lower silhouette so enlarged decks cannot pass through airborne traffic.
      const minimumMantaHeight = Math.max(
        12,
        maximumDeckHeight + 1.5 + 0.9 - boundsScratch.min.y
      );
      manta.userData.height = random(minimumMantaHeight, Math.max(28, minimumMantaHeight + 12));
      manta.userData.minimumDeckClearance = manta.userData.height - 0.9
        + boundsScratch.min.y - maximumDeckHeight;
      manta.userData.horizontalRadius = Math.hypot(
        Math.max(Math.abs(boundsScratch.min.x), Math.abs(boundsScratch.max.x)),
        Math.max(Math.abs(boundsScratch.min.z), Math.abs(boundsScratch.max.z))
      );
      clearanceReport.airTrafficMinDeckClearance = Math.min(
        clearanceReport.airTrafficMinDeckClearance,
        manta.userData.minimumDeckClearance
      );
      if (manta.userData.minimumDeckClearance < 1.5) clearanceReport.airTrafficDeckClearanceViolations++;
      scene.add(manta);
      deco.push(manta);
      animatedModels.push(manta);
      registerMapEntity(manta, 'air-traffic', manta.userData.horizontalRadius);
    }

    // Closed overlapping hills form a few navigable cloud walls and high veils instead of many tiny puffs.
    // All three weather-owned layers remain prewarmed InstancedMeshes, so scale and spacing change without frame assets.
    const cloudSides = mobile ? 10 : 16;
    const cloudGeometry = Modeling.createLoftGeometry({
      THREE,
      rings: [
        ellipseRingZ(-1.0, 0.08, 0.04, cloudSides),
        ellipseRingZ(-0.76, 0.72, 0.22, cloudSides, 0.14),
        ellipseRingZ(-0.24, 1.0, 0.46, cloudSides, 0.02),
        ellipseRingZ(0.34, 0.96, 0.40, cloudSides, 0.16),
        ellipseRingZ(0.78, 0.64, 0.20, cloudSides, 0.06),
        ellipseRingZ(1.0, 0.08, 0.04, cloudSides)
      ],
      capStart: true,
      capEnd: true
    });
    registerGeometry(cloudGeometry, { zone: 'shared', family: 'sky_cloud_layer', role: 'closed_navigable_cloud_hill' });
    const cloudLayerMaterials = [
      { color: 0xe0_eaf0, emissive: 0x42_5260, opacity: 0.42, roughness: 0.96 },
      { color: 0xd0_dce5, emissive: 0x34_4658, opacity: 0.64, roughness: 0.98 },
      { color: 0xa8_b6c2, emissive: 0x24_303d, opacity: 0.78, roughness: 1 }
    ].map((profile) => new THREE.MeshStandardMaterial({
      color: profile.color,
      emissive: profile.emissive,
      emissiveIntensity: 0.025,
      roughness: profile.roughness,
      metalness: 0,
      transparent: true,
      opacity: profile.opacity,
      depthWrite: false,
      flatShading: false
    }));
    for (const material of cloudLayerMaterials) installUltraCloudDetail(material);
    const cloudLobePatterns = Object.freeze([
      Object.freeze({ x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }),
      Object.freeze({ x: -0.72, y: -0.10, z: 0.16, scaleX: 0.88, scaleY: 0.72, scaleZ: 0.92 }),
      Object.freeze({ x: 0.70, y: -0.06, z: -0.12, scaleX: 0.92, scaleY: 0.78, scaleZ: 0.86 })
    ]);
    // A broad 1,800m torus gives side and aerial Film shots parallax through a small number of monumental masses.
    const cloudWrapSpan = 1_800;
    const cloudWrapHalf = cloudWrapSpan * 0.5;
    const cloudGridColumns = mobile ? 4 : 8;
    const cloudGridRows = 6;
    const cloudClusterCount = cloudGridColumns * cloudGridRows;
    if (cloudClusterCount !== CLOUD_WEATHER_LAYER_CONTRACT.clusterCount[mobile ? 'mobile' : 'desktop']) {
      throw new Error('V23 cloud lattice drifted from the monumental three-layer pool contract.');
    }
    const cloudGridCellWidth = cloudWrapSpan / cloudGridColumns;
    const cloudGridCellHeight = cloudWrapSpan / cloudGridRows;
    const cloudGridRowStaggerM = cloudGridCellWidth * 0.5;
    const cloudAnchorJitterM = 2;
    const cloudMaximumMeanderM = 6;
    const cloudMinimumWorldBottomM = maximumDeckHeight
      + CLOUD_PRESENTATION_CLEARANCE_CONTRACT.roadVerticalClearanceM;
    const minimumCloudFogFarM = Math.min(
      ...zones.map((zone) => Number(zone.atmosphere?.fogFar) || 380)
    );
    // A staggered periodic lattice guarantees coverage at every torus coordinate; the conservative radius
    // includes anchor jitter and bounded local meander, so even Eden's shortest fog range cannot expose a hole.
    const cloudMaximumCoverageGapM = Math.sqrt(
      (cloudGridCellHeight * cloudGridCellHeight
        + cloudGridRowStaggerM * cloudGridRowStaggerM)
      * (cloudGridCellHeight * cloudGridCellHeight
        + (cloudGridCellWidth - cloudGridRowStaggerM)
          * (cloudGridCellWidth - cloudGridRowStaggerM))
    ) / (2 * cloudGridCellHeight)
      + Math.hypot(cloudAnchorJitterM, cloudAnchorJitterM)
      + cloudMaximumMeanderM;
    const cloudClusters = [];
    const cloudLayerCount = CLOUD_WEATHER_LAYER_CONTRACT.layerIds.length;
    const cloudClustersPerLayer = cloudClusterCount / cloudLayerCount;
    const cloudLayerLobeCapacities = new Uint16Array(cloudLayerCount);
    const cloudLayerClusterCounts = new Uint16Array(cloudLayerCount);
    const fullCircle = Math.PI * 2;
    const prevailingWindHeading = skyRandom(0, fullCircle);
    const prevailingWindX = Math.cos(prevailingWindHeading);
    const prevailingWindZ = Math.sin(prevailingWindHeading);
    const prevailingWindRightX = -prevailingWindZ;
    const prevailingWindRightZ = prevailingWindX;
    let cloudInstanceCount = 0;
    let cloudMaximumMeanderSpeedMps = 0;
    for (let index = 0; index < cloudClusterCount; index++) {
      const layerIndex = index % cloudLayerCount;
      const nearBand = layerIndex !== 0;
      const column = index % cloudGridColumns;
      const row = Math.floor(index / cloudGridColumns);
      const stagger = row * cloudGridRowStaggerM;
      const latticeX = -cloudWrapHalf + (column + 0.5) * cloudGridCellWidth + stagger;
      const latticeZ = -cloudWrapHalf + (row + 0.5) * cloudGridCellHeight;
      const lobeCount = 2 + index % 2;
      let minimumPatternY = Number.POSITIVE_INFINITY;
      let maximumPatternScaleY = 0;
      for (let lobeIndex = 0; lobeIndex < lobeCount; lobeIndex++) {
        const pattern = cloudLobePatterns[(lobeIndex + index % 3) % cloudLobePatterns.length];
        minimumPatternY = Math.min(minimumPatternY, pattern.y);
        maximumPatternScaleY = Math.max(maximumPatternScaleY, pattern.scaleY);
      }
      const lateralMeanderM = skyRandom(3, 4);
      const alongMeanderM = skyRandom(1, 2);
      const lateralMeanderRate = skyRandom(0.025, 0.050);
      const alongMeanderRate = skyRandom(0.018, 0.036);
      // A coprime rank spreads every density layer independently across the torus instead of revealing one block.
      const layerOrdinal = Math.floor(index / cloudLayerCount);
      const coverageRank = (layerOrdinal * 7) % cloudClustersPerLayer;
      const layerInstanceOffset = cloudLayerLobeCapacities[layerIndex];
      cloudMaximumMeanderSpeedMps = Math.max(
        cloudMaximumMeanderSpeedMps,
        Math.hypot(
          lateralMeanderM * lateralMeanderRate,
          alongMeanderM * alongMeanderRate
        )
      );
      cloudClusters.push({
        anchorX: latticeX + skyRandom(-cloudAnchorJitterM, cloudAnchorJitterM),
        anchorZ: latticeZ + skyRandom(-cloudAnchorJitterM, cloudAnchorJitterM),
        altitude: skyRandom(
          CLOUD_WEATHER_LAYER_CONTRACT.altitudeRangesM[layerIndex][0],
          CLOUD_WEATHER_LAYER_CONTRACT.altitudeRangesM[layerIndex][1]
        ),
        scaleX: skyRandom(
          layerIndex === 0 ? 34 : layerIndex === 1 ? 28 : 38,
          layerIndex === 0 ? 58 : layerIndex === 1 ? 48 : 62
        ),
        scaleY: skyRandom(
          layerIndex === 0 ? 5 : layerIndex === 1 ? 10 : 13,
          layerIndex === 0 ? 9 : layerIndex === 1 ? 17 : 22
        ),
        scaleZ: skyRandom(
          layerIndex === 0 ? 20 : layerIndex === 1 ? 22 : 28,
          layerIndex === 0 ? 36 : layerIndex === 1 ? 38 : 48
        ),
        heading: skyRandom(0, fullCircle),
        lateralMeanderM,
        alongMeanderM,
        lateralMeanderRate,
        alongMeanderRate,
        phase: skyRandom(0, fullCircle),
        profile: index % 3,
        coverageThreshold: (coverageRank + 0.5) / cloudClustersPerLayer,
        layerIndex,
        layerInstanceOffset,
        lobeCount,
        nearBand,
        minimumPatternY,
        maximumPatternScaleY,
        baselineX: null,
        baselineZ: null,
        baselineRelativeX: null,
        baselineRelativeZ: null,
        baselineWrapX: null,
        baselineWrapZ: null,
        currentX: 0,
        currentZ: 0,
        wrapX: 0,
        wrapZ: 0
      });
      cloudLayerClusterCounts[layerIndex]++;
      cloudLayerLobeCapacities[layerIndex] += lobeCount;
      cloudInstanceCount += lobeCount;
    }
    const cloudLayers = CLOUD_WEATHER_LAYER_CONTRACT.layerIds.map((layerId, layerIndex) => {
      const mesh = new THREE.InstancedMesh(
        cloudGeometry,
        cloudLayerMaterials[layerIndex],
        cloudLayerLobeCapacities[layerIndex]
      );
      mesh.name = `V23.Sky.CloudLayer.${layerId}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = -3 + layerIndex * 0.01;
      // Transparent lobes receive the shared physical light but never enter VSM as opaque silhouettes; broad cloud
      // shadowing is already represented once by the lighting kernel's global cloud transmission.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      Modeling.markMainVisual(mesh, {
        module: 'world',
        zone: 'shared',
        family: 'sky_cloud_layer',
        role: `closed-instanced-cloud-${layerId}`,
        nonColliding: true
      });
      scene.add(mesh);
      deco.push(mesh);
      return { id: layerId, mesh, material: cloudLayerMaterials[layerIndex] };
    });
    const cloudColor = new THREE.Color();
    const cloudPaletteA = new THREE.Color();
    const cloudPaletteB = new THREE.Color();
    const cloudEmissiveA = new THREE.Color();
    const cloudEmissiveB = new THREE.Color();
    const cloudMatrix = new THREE.Matrix4();
    const cloudPosition = new THREE.Vector3();
    const cloudScale = new THREE.Vector3();
    const cloudQuaternion = new THREE.Quaternion();
    const cloudEuler = new THREE.Euler();
    const cloudCameraForward = new THREE.Vector3();
    const cloudLayerColorIndices = new Uint16Array(cloudLayerCount);
    for (const cluster of cloudClusters) {
      for (let lobeIndex = 0; lobeIndex < cluster.lobeCount; lobeIndex++) {
        const shade = skyRandom(-0.035, 0.045) + lobeIndex * 0.008;
        cloudColor.setRGB(0.82 + shade, 0.87 + shade, Math.min(1, 0.94 + shade));
        const layer = cloudLayers[cluster.layerIndex].mesh;
        layer.setColorAt(cloudLayerColorIndices[cluster.layerIndex], cloudColor);
        cloudLayerColorIndices[cluster.layerIndex]++;
      }
    }
    for (const { mesh } of cloudLayers) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const cloudNearClusterCount = cloudClusters.reduce(
      (count, cluster) => count + (cluster.nearBand ? 1 : 0),
      0
    );
    const cloudTopologyEntry = topology.find((entry) => entry.family === 'sky_cloud_layer');
    let cloudAuditStartedAtSeconds = null;
    let cloudAuditStartCameraX = 0;
    let cloudAuditStartCameraZ = 0;
    let cloudLastAuditPublishSeconds = Number.NEGATIVE_INFINITY;
    let cloudPreviousSkySeconds = null;
    let cloudPreviousReferenceX = null;
    let cloudPreviousReferenceZ = null;
    let cloudPreviousCameraX = null;
    let cloudPreviousCameraZ = null;
    let cloudPreviousWindSkySeconds = null;
    let cloudWindDistanceM = 0;
    let cloudLastMatrixSkySeconds = null;
    let cloudLastMatrixRenderOriginX = null;
    let cloudLastMatrixRenderOriginZ = null;
    let cloudLastMatrixReducedMotion = null;
    let cloudLastMatrixCameraX = null;
    let cloudLastMatrixCameraY = null;
    let cloudLastMatrixCameraZ = null;
    let cloudLastMatrixForwardX = null;
    let cloudLastMatrixForwardY = null;
    let cloudLastMatrixForwardZ = null;
    let cloudLastMatrixWeatherCover = null;
    let cloudLastMatrixPrecipitationMass = null;
    let cloudLastMatrixHorizontalScale = null;
    let cloudLastMatrixVerticalScale = null;
    let cloudLastMatrixAltitudeDropM = null;
    const cloudLayerPresentationScratch = {};
    const cloudLayerCovers = new Float32Array(cloudLayerCount);
    const cloudLayerHorizontalScales = new Float32Array(cloudLayerCount);
    const cloudLayerVerticalScales = new Float32Array(cloudLayerCount);
    const cloudLayerAltitudeDropScales = new Float32Array([0.28, 0.62, 1]);

    Object.assign(clearanceReport, {
      cloudAnchorMode: 'world-space-wind',
      cloudUsesSkyClock: true,
      cloudVisualLanguage: CLOUD_WEATHER_LAYER_CONTRACT.clusterVisualLanguage,
      cloudCameraAnchorCopyCount: 0,
      cloudParentOriginErrorM: 0,
      cloudClusterCount,
      cloudNearClusterCount,
      cloudFarClusterCount: cloudClusterCount - cloudNearClusterCount,
      cloudLobeInstanceCount: cloudInstanceCount,
      cloudLayerCount,
      cloudLayerIds: CLOUD_WEATHER_LAYER_CONTRACT.layerIds,
      cloudLayerClusterCounts: Object.freeze(Array.from(cloudLayerClusterCounts)),
      cloudLayerLobeCapacities: Object.freeze(Array.from(cloudLayerLobeCapacities)),
      cloudLayerVisibleEquivalentClusters: [0, 0, 0],
      cloudLayerOpacities: [0, 0, 0],
      cloudLayerAltitudeRangesM: CLOUD_WEATHER_LAYER_CONTRACT.altitudeRangesM,
      cloudSharedGeometryCount: CLOUD_WEATHER_LAYER_CONTRACT.sharedGeometryCount,
      cloudShadowCasterCount: 0,
      cloudLightingAuthority: CLOUD_WEATHER_LAYER_CONTRACT.lightingAuthority,
      cloudWeatherAuthority: CLOUD_WEATHER_LAYER_CONTRACT.weatherAuthority,
      cloudInstanceBudgetMode: CLOUD_WEATHER_LAYER_CONTRACT.instanceBudgetMode,
      cloudProjectedShadowMode: CLOUD_WEATHER_LAYER_CONTRACT.projectedShadowMode,
      cloudMatrixWriteCount: 0,
      cloudShapeVariantCount: 3,
      cloudProfileSignatureCount: 3,
      cloudMinimumLobeCount: CLOUD_WEATHER_LAYER_CONTRACT.lobesPerClusterRange[0],
      cloudMaximumLobeCount: CLOUD_WEATHER_LAYER_CONTRACT.lobesPerClusterRange[1],
      cloudHorizontalScaleRangeM: CLOUD_WEATHER_LAYER_CONTRACT.horizontalScaleRangeM,
      cloudVerticalScaleRangeM: CLOUD_WEATHER_LAYER_CONTRACT.verticalScaleRangeM,
      cloudUndersideModel: CLOUD_WEATHER_LAYER_CONTRACT.undersideModel,
      cloudTopologyFailureCount: cloudTopologyEntry?.isClosed === false ? 1 : 0,
      cloudDrawGroupCount: cloudLayers.length,
      cloudWrapSpanM: cloudWrapSpan,
      cloudGridColumns,
      cloudGridRows,
      cloudMaximumCoverageGapM,
      cloudCoverageMarginM: minimumCloudFogFarM - cloudMaximumCoverageGapM,
      cloudMinimumWindSpeedMps: 0,
      cloudMaximumWindSpeedMps: 0,
      cloudMorphScaleAmplitude: 0.045,
      cloudAuditSeconds: 0,
      cloudMinimumDriftM: 0,
      cloudStationaryClusterCount: 0,
      cloudAuditCameraTravelM: 0,
      cloudMedianCameraRelativeDisplacementM: 0,
      cloudNearFarAngularParallaxRatio: 0,
      cloudWorldDriftM: 0,
      cloudRelativeMotionM: 0,
      cloudPausedMotionM: 0,
      cloudWindDistanceM: 0,
      cloudReferenceWorldX: 0,
      cloudReferenceWorldZ: 0,
      cloudCameraLockViolationCount: 0,
      cloudWrapCount: 0,
      cloudMatrixUpdateCount: 0,
      cloudWeatherCover: 0,
      cloudPrecipitationMass: 0,
      cloudHorizontalScale: 1,
      cloudVerticalScale: 1,
      cloudVisibleEquivalentClusterCount: 0,
      cloudWeatherAltitudeDropM: 0,
      cloudRoadVerticalClearanceM: CLOUD_PRESENTATION_CLEARANCE_CONTRACT.roadVerticalClearanceM,
      cloudMinimumWorldBottomM,
      cloudMinimumObservedBottomM: cloudMinimumWorldBottomM,
      cloudRoadClearanceViolationCount: 0,
      cloudViewCorridorLengthM: CLOUD_PRESENTATION_CLEARANCE_CONTRACT.sightlineLengthM,
      cloudCameraBubbleOuterM: CLOUD_PRESENTATION_CLEARANCE_CONTRACT.cameraBubbleOuterM,
      cloudViewAttenuatedLobeCount: 0,
      cloudViewMinimumScale: 1,
      cloudClosestCameraSurfaceDistanceM: 0,
      cloudCameraOcclusionProtection: true,
      cloudClearanceVisualOnly: true
    });

    function cloudCoveragePresence(cloudCover, threshold) {
      const rawPresence = clamp((cloudCover - threshold + 0.09) / 0.18, 0, 1);
      return rawPresence * rawPresence * rawPresence * (rawPresence * (rawPresence * 6 - 15) + 10);
    }

    function cloudAngleDelta(current, baseline) {
      return Math.abs(Math.atan2(Math.sin(current - baseline), Math.cos(current - baseline)));
    }

    function currentCloudWindSpeedMps() {
      const skyZoneIndex = Number.isInteger(state.skyZoneIndex) && state.skyZoneIndex >= 0
        ? state.skyZoneIndex
        : 0;
      const nextSkyZoneIndex = (skyZoneIndex + 1) % zones.length;
      const blend = clamp(Number(state.skyBlend) || 0, 0, 1);
      const currentWind = Number(zones[skyZoneIndex]?.atmosphere?.wind) || 0.34;
      const nextWind = Number(zones[nextSkyZoneIndex]?.atmosphere?.wind) || currentWind;
      const weatherWind = clamp(Number(state.weather?.wind) || 0, 0, 1);
      return (1.5 + lerp(currentWind, nextWind, blend) * 4.5) * lerp(0.82, 1.48, weatherWind);
    }

    /** Update one deterministic world-space weather field; recycling happens only beyond the camera far plane. */
    function updateCloudInstances(
      skyTimeSeconds,
      renderOrigin = null,
      recordAudit = true,
      reducedMotion = Boolean(isReducedMotionEnabled())
    ) {
      const timeSeconds = Math.max(0, Number(skyTimeSeconds) || 0);
      const renderOriginX = Number(renderOrigin?.x) || 0;
      const renderOriginZ = Number(renderOrigin?.z) || 0;
      const cameraWorldX = renderOriginX + camera.position.x;
      const cameraWorldZ = renderOriginZ + camera.position.z;
      camera.getWorldDirection(cloudCameraForward);
      const weatherCloudCover = clamp(Number(state.weather?.cloudCover) || 0, 0, 1);
      const weatherRain = clamp(Number(state.weather?.rain) || 0, 0, 1);
      const weatherSnow = clamp(Number(state.weather?.snow) || 0, 0, 1);
      const weatherHail = clamp(Number(state.weather?.hail) || 0, 0, 1);
      const precipitationCloudMass = Math.max(weatherRain, weatherSnow, weatherHail);
      const cloudLayerPresentation = resolveCloudLayerPresentation(
        state.weather,
        cloudLayerPresentationScratch
      );
      cloudLayerCovers[0] = cloudLayerPresentation.high;
      cloudLayerCovers[1] = cloudLayerPresentation.middle;
      cloudLayerCovers[2] = cloudLayerPresentation.low;
      // Rain, snow, and hail share one continuous mass, but only the low deck receives the full storm expansion;
      // high wisps stay thin instead of turning every weather type into one homogeneous ceiling.
      const precipitationCloudBlend = precipitationCloudMass * precipitationCloudMass
        * (3 - 2 * precipitationCloudMass);
      const weatherCloudHorizontalScale = lerp(0.72, 1.26, weatherCloudCover)
        * lerp(1, 2.50, precipitationCloudBlend);
      const weatherCloudVerticalScale = lerp(0.92, 1.10, weatherCloudCover)
        * lerp(1, 1.60, precipitationCloudBlend);
      cloudLayerHorizontalScales[0] = lerp(0.82, 1.10, weatherCloudCover)
        * lerp(1, 1.12, precipitationCloudBlend);
      cloudLayerHorizontalScales[1] = lerp(0.78, 1.24, weatherCloudCover)
        * lerp(1, 1.65, precipitationCloudBlend);
      cloudLayerHorizontalScales[2] = weatherCloudHorizontalScale;
      cloudLayerVerticalScales[0] = lerp(0.88, 1.04, weatherCloudCover)
        * lerp(1, 1.08, precipitationCloudBlend);
      cloudLayerVerticalScales[1] = lerp(0.90, 1.08, weatherCloudCover)
        * lerp(1, 1.28, precipitationCloudBlend);
      cloudLayerVerticalScales[2] = weatherCloudVerticalScale;
      const weatherCloudAltitudeDropM = clamp(
        (Number(state.weather?.cloudDarkness) || 0) * 12
          + weatherRain * 4
          + weatherSnow * 6
          + weatherHail * 5
          + (Number(state.weather?.dust) || 0) * 6,
        0,
        24
      );
      const skyClockReset = cloudPreviousWindSkySeconds !== null
        && timeSeconds < cloudPreviousWindSkySeconds;
      // A paused frame may still rotate/switch the camera or receive a manual weather override. Reuse matrices
      // only when every presentation input is identical, so the safety corridor cannot lag behind user action.
      if (recordAudit
        && timeSeconds === cloudLastMatrixSkySeconds
        && renderOriginX === cloudLastMatrixRenderOriginX
        && renderOriginZ === cloudLastMatrixRenderOriginZ
        && reducedMotion === cloudLastMatrixReducedMotion
        && camera.position.x === cloudLastMatrixCameraX
        && camera.position.y === cloudLastMatrixCameraY
        && camera.position.z === cloudLastMatrixCameraZ
        && cloudCameraForward.x === cloudLastMatrixForwardX
        && cloudCameraForward.y === cloudLastMatrixForwardY
        && cloudCameraForward.z === cloudLastMatrixForwardZ
        && weatherCloudCover === cloudLastMatrixWeatherCover
        && precipitationCloudMass === cloudLastMatrixPrecipitationMass
        && weatherCloudHorizontalScale === cloudLastMatrixHorizontalScale
        && weatherCloudVerticalScale === cloudLastMatrixVerticalScale
        && weatherCloudAltitudeDropM === cloudLastMatrixAltitudeDropM) return;
      const cameraAnchorReset = cloudPreviousCameraX !== null && Math.hypot(
        cameraWorldX - cloudPreviousCameraX,
        cameraWorldZ - cloudPreviousCameraZ
      ) > cloudWrapHalf * 0.5;
      if (recordAudit && (cloudAuditStartedAtSeconds === null || skyClockReset || cameraAnchorReset)) {
        cloudAuditStartedAtSeconds = timeSeconds;
        cloudAuditStartCameraX = cameraWorldX;
        cloudAuditStartCameraZ = cameraWorldZ;
        cloudLastAuditPublishSeconds = Number.NEGATIVE_INFINITY;
        cloudPreviousSkySeconds = null;
        cloudPreviousReferenceX = null;
        cloudPreviousReferenceZ = null;
        cloudPreviousCameraX = null;
        cloudPreviousCameraZ = null;
        if (skyClockReset || cloudPreviousWindSkySeconds === null) {
          cloudPreviousWindSkySeconds = timeSeconds;
          cloudWindDistanceM = 0;
        }
        for (const cluster of cloudClusters) {
          cluster.baselineX = null;
          cluster.baselineZ = null;
          cluster.baselineRelativeX = null;
          cluster.baselineRelativeZ = null;
          cluster.baselineWrapX = null;
          cluster.baselineWrapZ = null;
        }
        clearanceReport.cloudWorldDriftM = 0;
        clearanceReport.cloudRelativeMotionM = 0;
        clearanceReport.cloudPausedMotionM = 0;
        clearanceReport.cloudWrapCount = 0;
        clearanceReport.cloudCameraLockViolationCount = 0;
      }
      const windStepSeconds = cloudPreviousWindSkySeconds === null
        ? 0
        : Math.max(0, timeSeconds - cloudPreviousWindSkySeconds);
      const baseWindSpeedMps = currentCloudWindSpeedMps();
      if (!reducedMotion) cloudWindDistanceM += windStepSeconds * baseWindSpeedMps;
      cloudPreviousWindSkySeconds = timeSeconds;
      clearanceReport.cloudMinimumWindSpeedMps = reducedMotion
        ? 0
        : Math.max(0, baseWindSpeedMps - cloudMaximumMeanderSpeedMps);
      clearanceReport.cloudMaximumWindSpeedMps = reducedMotion
        ? 0
        : baseWindSpeedMps + cloudMaximumMeanderSpeedMps;
      clearanceReport.cloudWindDistanceM = cloudWindDistanceM;

      let referenceX = 0;
      let referenceZ = 0;
      const sharedWindX = prevailingWindX * cloudWindDistanceM;
      const sharedWindZ = prevailingWindZ * cloudWindDistanceM;
      let visibleEquivalentClusterCount = 0;
      let matrixWriteCount = 0;
      const layerVisibleEquivalentClusters = clearanceReport.cloudLayerVisibleEquivalentClusters;
      layerVisibleEquivalentClusters.fill(0);
      let minimumObservedBottomM = Number.POSITIVE_INFINITY;
      let roadClearanceViolationCount = 0;
      let viewAttenuatedLobeCount = 0;
      let viewMinimumScale = 1;
      let closestCameraSurfaceDistanceM = Number.POSITIVE_INFINITY;
      for (let clusterIndex = 0; clusterIndex < cloudClusters.length; clusterIndex++) {
        const cluster = cloudClusters[clusterIndex];
        const layerIndex = cluster.layerIndex;
        const layerHorizontalScale = cloudLayerHorizontalScales[layerIndex];
        const layerVerticalScale = cloudLayerVerticalScales[layerIndex];
        const layerAltitudeDropM = weatherCloudAltitudeDropM
          * cloudLayerAltitudeDropScales[layerIndex];
        const cloudPresence = cloudCoveragePresence(
          cloudLayerCovers[layerIndex],
          cluster.coverageThreshold
        );
        const cloudPresenceScale = 0.001 + cloudPresence * 0.999;
        visibleEquivalentClusterCount += cloudPresence;
        layerVisibleEquivalentClusters[layerIndex] += cloudPresence;
        const lateralMeander = reducedMotion
          ? 0
          : Math.sin(timeSeconds * cluster.lateralMeanderRate + cluster.phase) * cluster.lateralMeanderM;
        const alongMeander = reducedMotion
          ? 0
          : Math.sin(timeSeconds * cluster.alongMeanderRate + cluster.phase * 1.73) * cluster.alongMeanderM;
        const rawX = cluster.anchorX + sharedWindX
          + prevailingWindRightX * lateralMeander + prevailingWindX * alongMeander;
        const rawZ = cluster.anchorZ + sharedWindZ
          + prevailingWindRightZ * lateralMeander + prevailingWindZ * alongMeander;
        const wrapX = Math.floor((rawX - cameraWorldX + cloudWrapHalf) / cloudWrapSpan);
        const wrapZ = Math.floor((rawZ - cameraWorldZ + cloudWrapHalf) / cloudWrapSpan);
        const clusterX = rawX - wrapX * cloudWrapSpan;
        const clusterZ = rawZ - wrapZ * cloudWrapSpan;
        const altitudeWave = reducedMotion ? 0 : Math.sin(timeSeconds * 0.11 + cluster.phase) * 0.42;
        const headingWave = reducedMotion ? 0 : Math.sin(timeSeconds * 0.07 + cluster.phase) * 0.045;
        const heading = cluster.heading + headingWave;
        const cosHeading = Math.cos(heading);
        const sinHeading = Math.sin(heading);
        // One conservative cluster lift covers every constituent lobe at its maximum breath, avoiding
        // per-lobe vertical shearing while severe weather still forms one coherent lowered cloud deck.
        const conservativeRelativeBottomM = cluster.minimumPatternY * cluster.scaleY + altitudeWave
          - CLOUD_PRESENTATION_CLEARANCE_CONTRACT.geometryVerticalRadius
            * cluster.scaleY
            * cluster.maximumPatternScaleY
            * (1 + clearanceReport.cloudMorphScaleAmplitude)
            * layerVerticalScale
            * cloudPresenceScale;
        const cloudRoadLiftM = requiredCloudLiftUnchecked(
          cluster.altitude - layerAltitudeDropM + conservativeRelativeBottomM,
          cloudMinimumWorldBottomM
        );
        cluster.currentX = clusterX;
        cluster.currentZ = clusterZ;
        cluster.wrapX = wrapX;
        cluster.wrapZ = wrapZ;
        if (clusterIndex === 0) {
          referenceX = clusterX;
          referenceZ = clusterZ;
        }
        if (cluster.baselineX === null) {
          cluster.baselineX = clusterX;
          cluster.baselineZ = clusterZ;
          cluster.baselineRelativeX = clusterX - cameraWorldX;
          cluster.baselineRelativeZ = clusterZ - cameraWorldZ;
          cluster.baselineWrapX = wrapX;
          cluster.baselineWrapZ = wrapZ;
        }

        for (let lobeIndex = 0; lobeIndex < cluster.lobeCount; lobeIndex++) {
          const pattern = cloudLobePatterns[(lobeIndex + cluster.profile) % cloudLobePatterns.length];
          const shapePhase = cluster.phase + lobeIndex * 1.37;
          const breath = reducedMotion
            ? 1
            : 1 + Math.sin(timeSeconds * (0.13 + lobeIndex * 0.012) + shapePhase) * 0.045;
          const shear = reducedMotion
            ? 0
            : Math.sin(timeSeconds * 0.09 + shapePhase) * cluster.scaleX * 0.05;
          const localX = pattern.x * cluster.scaleX * 0.92 + shear;
          const localZ = pattern.z * cluster.scaleZ * 0.84;
          const lobeScaleX = cluster.scaleX * pattern.scaleX * breath
            * layerHorizontalScale * cloudPresenceScale;
          const lobeScaleY = cluster.scaleY * pattern.scaleY * (2 - breath)
            * layerVerticalScale * cloudPresenceScale;
          const lobeScaleZ = cluster.scaleZ * pattern.scaleZ * (1 + (breath - 1) * 0.55)
            * layerHorizontalScale * cloudPresenceScale;
          cloudPosition.set(
            clusterX - renderOriginX + localX * cosHeading - localZ * sinHeading,
            cluster.altitude - layerAltitudeDropM + cloudRoadLiftM
              + pattern.y * cluster.scaleY + altitudeWave,
            clusterZ - renderOriginZ + localX * sinHeading + localZ * cosHeading
          );
          cloudEuler.set(
            0,
            -heading,
            reducedMotion ? 0 : Math.sin(timeSeconds * 0.08 + shapePhase) * 0.018
          );
          cloudQuaternion.setFromEuler(cloudEuler);
          const lobeRadiusM = Math.max(
            lobeScaleX,
            lobeScaleY * CLOUD_PRESENTATION_CLEARANCE_CONTRACT.geometryVerticalRadius,
            lobeScaleZ
          );
          const relativeX = cloudPosition.x - camera.position.x;
          const relativeY = cloudPosition.y - camera.position.y;
          const relativeZ = cloudPosition.z - camera.position.z;
          // Keep squared center distance on the hot path; roots are needed only for a nearby/corridor lobe
          // or when that lobe can improve the exact closest-surface diagnostic.
          const lobeDistanceSquaredM = (
            relativeX * relativeX + relativeY * relativeY + relativeZ * relativeZ
          );
          const viewScale = cloudPresence > 0.02
            ? cloudSightlineScaleUnchecked(
              relativeX,
              relativeY,
              relativeZ,
              cloudCameraForward.x,
              cloudCameraForward.y,
              cloudCameraForward.z,
              lobeRadiusM,
              lobeDistanceSquaredM
            )
            : 1;
          cloudScale.set(
            lobeScaleX * viewScale,
            lobeScaleY * viewScale,
            lobeScaleZ * viewScale
          );
          cloudMatrix.compose(cloudPosition, cloudQuaternion, cloudScale);
          cloudLayers[layerIndex].mesh.setMatrixAt(
            cluster.layerInstanceOffset + lobeIndex,
            cloudMatrix
          );
          matrixWriteCount++;
          if (cloudPresence > 0.02) {
            const lobeBottomM = cloudPosition.y
              - lobeScaleY * CLOUD_PRESENTATION_CLEARANCE_CONTRACT.geometryVerticalRadius;
            minimumObservedBottomM = Math.min(minimumObservedBottomM, lobeBottomM);
            if (lobeBottomM < cloudMinimumWorldBottomM - 0.001) roadClearanceViolationCount++;
            const closestCandidateCenterM = closestCameraSurfaceDistanceM + lobeRadiusM;
            if (!Number.isFinite(closestCameraSurfaceDistanceM)
              || (closestCandidateCenterM > 0
                && lobeDistanceSquaredM
                  < closestCandidateCenterM * closestCandidateCenterM)) {
              closestCameraSurfaceDistanceM = Math.min(
                closestCameraSurfaceDistanceM,
                Math.sqrt(lobeDistanceSquaredM) - lobeRadiusM
              );
            }
            viewMinimumScale = Math.min(viewMinimumScale, viewScale);
            if (viewScale < 0.999) viewAttenuatedLobeCount++;
          }
        }
      }
      for (let layerIndex = 0; layerIndex < cloudLayers.length; layerIndex++) {
        const cloudLayer = cloudLayers[layerIndex].mesh;
        cloudLayer.visible = cloudLayerCovers[layerIndex] > 0.002;
        cloudLayer.instanceMatrix.needsUpdate = true;
      }
      clearanceReport.cloudMatrixUpdateCount++;
      clearanceReport.cloudMatrixWriteCount = matrixWriteCount;
      clearanceReport.cloudWeatherCover = weatherCloudCover;
      clearanceReport.cloudPrecipitationMass = precipitationCloudMass;
      clearanceReport.cloudHorizontalScale = weatherCloudHorizontalScale;
      clearanceReport.cloudVerticalScale = weatherCloudVerticalScale;
      clearanceReport.cloudVisibleEquivalentClusterCount = visibleEquivalentClusterCount;
      clearanceReport.cloudWeatherAltitudeDropM = weatherCloudAltitudeDropM;
      clearanceReport.cloudMinimumObservedBottomM = Number.isFinite(minimumObservedBottomM)
        ? minimumObservedBottomM
        : cloudMinimumWorldBottomM;
      clearanceReport.cloudRoadClearanceViolationCount = roadClearanceViolationCount;
      clearanceReport.cloudViewAttenuatedLobeCount = viewAttenuatedLobeCount;
      clearanceReport.cloudViewMinimumScale = viewMinimumScale;
      clearanceReport.cloudClosestCameraSurfaceDistanceM = Number.isFinite(closestCameraSurfaceDistanceM)
        ? closestCameraSurfaceDistanceM
        : 0;
      cloudLastMatrixSkySeconds = timeSeconds;
      cloudLastMatrixRenderOriginX = renderOriginX;
      cloudLastMatrixRenderOriginZ = renderOriginZ;
      cloudLastMatrixReducedMotion = reducedMotion;
      cloudLastMatrixCameraX = camera.position.x;
      cloudLastMatrixCameraY = camera.position.y;
      cloudLastMatrixCameraZ = camera.position.z;
      cloudLastMatrixForwardX = cloudCameraForward.x;
      cloudLastMatrixForwardY = cloudCameraForward.y;
      cloudLastMatrixForwardZ = cloudCameraForward.z;
      cloudLastMatrixWeatherCover = weatherCloudCover;
      cloudLastMatrixPrecipitationMass = precipitationCloudMass;
      cloudLastMatrixHorizontalScale = weatherCloudHorizontalScale;
      cloudLastMatrixVerticalScale = weatherCloudVerticalScale;
      cloudLastMatrixAltitudeDropM = weatherCloudAltitudeDropM;
      let cloudParentOriginErrorM = 0;
      for (const { mesh } of cloudLayers) {
        cloudParentOriginErrorM = Math.max(cloudParentOriginErrorM, mesh.position.length());
      }
      clearanceReport.cloudParentOriginErrorM = cloudParentOriginErrorM;
      clearanceReport.cloudReferenceWorldX = referenceX;
      clearanceReport.cloudReferenceWorldZ = referenceZ;
      if (!recordAudit) return;

      if (cloudPreviousReferenceX !== null) {
        const referenceStep = Math.hypot(
          referenceX - cloudPreviousReferenceX,
          referenceZ - cloudPreviousReferenceZ
        );
        if (referenceStep < cloudWrapHalf * 0.5) {
          if (cloudPreviousSkySeconds === timeSeconds) {
            clearanceReport.cloudPausedMotionM = Math.max(
              clearanceReport.cloudPausedMotionM,
              referenceStep
            );
          } else {
            clearanceReport.cloudWorldDriftM += referenceStep;
            const relativeStep = Math.hypot(
              (referenceX - cameraWorldX)
                - (cloudPreviousReferenceX - cloudPreviousCameraX),
              (referenceZ - cameraWorldZ)
                - (cloudPreviousReferenceZ - cloudPreviousCameraZ)
            );
            clearanceReport.cloudRelativeMotionM = Math.max(
              clearanceReport.cloudRelativeMotionM,
              relativeStep
            );
          }
        } else {
          clearanceReport.cloudWrapCount++;
        }
      }
      cloudPreviousReferenceX = referenceX;
      cloudPreviousReferenceZ = referenceZ;
      cloudPreviousCameraX = cameraWorldX;
      cloudPreviousCameraZ = cameraWorldZ;
      cloudPreviousSkySeconds = timeSeconds;

      if (timeSeconds - cloudLastAuditPublishSeconds < 0.5) return;
      cloudLastAuditPublishSeconds = timeSeconds;
      const auditSeconds = Math.max(0, timeSeconds - cloudAuditStartedAtSeconds);
      const cameraTravelM = Math.hypot(
        cameraWorldX - cloudAuditStartCameraX,
        cameraWorldZ - cloudAuditStartCameraZ
      );
      const relativeDisplacements = [];
      const angularSamples = [];
      let minimumObservedDriftM = Number.POSITIVE_INFINITY;
      let stationaryClusterCount = 0;
      for (const cluster of cloudClusters) {
        if (cluster.wrapX !== cluster.baselineWrapX || cluster.wrapZ !== cluster.baselineWrapZ) continue;
        const relativeX = cluster.currentX - cameraWorldX;
        const relativeZ = cluster.currentZ - cameraWorldZ;
        const observedDriftM = Math.hypot(
          cluster.currentX - cluster.baselineX,
          cluster.currentZ - cluster.baselineZ
        );
        minimumObservedDriftM = Math.min(minimumObservedDriftM, observedDriftM);
        if (auditSeconds >= 0.5 && observedDriftM <= 0.05) stationaryClusterCount++;
        relativeDisplacements.push(Math.hypot(
          relativeX - cluster.baselineRelativeX,
          relativeZ - cluster.baselineRelativeZ
        ));
        const baselineAngle = Math.atan2(cluster.baselineRelativeX, cluster.baselineRelativeZ);
        const currentAngle = Math.atan2(relativeX, relativeZ);
        angularSamples.push({
          distanceM: Math.hypot(cluster.baselineRelativeX, cluster.baselineRelativeZ),
          angleDelta: cloudAngleDelta(currentAngle, baselineAngle)
        });
      }
      if (relativeDisplacements.length < Math.ceil(cloudClusterCount * 0.5)) {
        cloudAuditStartedAtSeconds = timeSeconds;
        cloudAuditStartCameraX = cameraWorldX;
        cloudAuditStartCameraZ = cameraWorldZ;
        for (const cluster of cloudClusters) {
          cluster.baselineX = cluster.currentX;
          cluster.baselineZ = cluster.currentZ;
          cluster.baselineRelativeX = cluster.currentX - cameraWorldX;
          cluster.baselineRelativeZ = cluster.currentZ - cameraWorldZ;
          cluster.baselineWrapX = cluster.wrapX;
          cluster.baselineWrapZ = cluster.wrapZ;
        }
        clearanceReport.cloudAuditSeconds = 0;
        clearanceReport.cloudMinimumDriftM = 0;
        clearanceReport.cloudStationaryClusterCount = 0;
        clearanceReport.cloudAuditCameraTravelM = 0;
        clearanceReport.cloudMedianCameraRelativeDisplacementM = 0;
        clearanceReport.cloudNearFarAngularParallaxRatio = 0;
        clearanceReport.cloudCameraLockViolationCount = 0;
        return;
      }
      relativeDisplacements.sort((a, b) => a - b);
      angularSamples.sort((a, b) => a.distanceM - b.distanceM);
      const medianIndex = Math.floor(relativeDisplacements.length * 0.5);
      const medianRelativeM = relativeDisplacements[medianIndex] || 0;
      const angularSplit = Math.max(1, Math.floor(angularSamples.length * 0.5));
      let nearAngularMotion = 0;
      let farAngularMotion = 0;
      for (let index = 0; index < angularSamples.length; index++) {
        if (index < angularSplit) nearAngularMotion += angularSamples[index].angleDelta;
        else farAngularMotion += angularSamples[index].angleDelta;
      }
      const nearAverage = nearAngularMotion / angularSplit;
      const farAngularCount = angularSamples.length - angularSplit;
      const farAverage = farAngularCount ? farAngularMotion / farAngularCount : 0;
      clearanceReport.cloudAuditSeconds = auditSeconds;
      clearanceReport.cloudMinimumDriftM = Number.isFinite(minimumObservedDriftM)
        ? minimumObservedDriftM
        : 0;
      clearanceReport.cloudStationaryClusterCount = stationaryClusterCount;
      clearanceReport.cloudAuditCameraTravelM = cameraTravelM;
      clearanceReport.cloudMedianCameraRelativeDisplacementM = medianRelativeM;
      clearanceReport.cloudNearFarAngularParallaxRatio = farAverage > 0.000_001
        ? nearAverage / farAverage
        : 0;
      clearanceReport.cloudCameraLockViolationCount =
        cameraTravelM > 1 && medianRelativeM < cameraTravelM * 0.25 ? 1 : 0;
    }

    updateCloudInstances(
      Number(state.skyElapsedSeconds) || 0,
      typeof getWorldRenderOrigin === 'function' ? getWorldRenderOrigin(graphOriginScratch) : null,
      false
    );

    let activeRenderQuality = 'medium';
    let ultraEnabled = false;
    let worldDisposed = false;
    const ultraSkyUniforms = {
      zenithColor: { value: new THREE.Color(WORLD_ULTRA_SKY_PALETTES[0].zenith) },
      horizonColor: { value: new THREE.Color(WORLD_ULTRA_SKY_PALETTES[0].horizon) },
      lowerColor: { value: new THREE.Color(WORLD_ULTRA_SKY_PALETTES[0].lower) },
      hazeStrength: { value: 0.22 }
    };
    const ultraSkyMaterial = new THREE.ShaderMaterial({
      name: 'V23.World.UltraSkyGradientMaterial',
      uniforms: ultraSkyUniforms,
      vertexShader: `
varying vec3 vV23SkyDirection;
void main() {
  vV23SkyDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 lowerColor;
uniform float hazeStrength;
varying vec3 vV23SkyDirection;
void main() {
  vec3 direction = normalize(vV23SkyDirection);
  float upper = smoothstep(-0.05, 0.78, direction.y);
  float lower = smoothstep(0.08, -0.42, direction.y);
  float horizonBand = pow(max(0.0, 1.0 - abs(direction.y)), 5.0);
  vec3 color = mix(horizonColor, zenithColor, upper);
  color = mix(color, lowerColor, lower * 0.86);
  color += horizonColor * horizonBand * hazeStrength;
  gl_FragColor = vec4(color, 1.0);
}`,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    const ultraSkyGeometry = new THREE.SphereGeometry(
      WORLD_ULTRA_PRESENTATION_CONTRACT.skyDomeRadiusM,
      48,
      24
    );
    const ultraSkyDome = new THREE.Mesh(ultraSkyGeometry, ultraSkyMaterial);
    ultraSkyDome.name = 'V23.World.UltraSkyGradientDome';
    ultraSkyDome.frustumCulled = false;
    ultraSkyDome.renderOrder = -100;
    ultraSkyDome.visible = false;
    Modeling.markEffect(ultraSkyDome, 'High-only camera-centered gradient sky; no lighting, collision, or map authority.');
    scene.add(ultraSkyDome);
    deco.push(ultraSkyDome);

    /**
     * Merge three concentric mountain slopes into one realm-owned physical mesh.
     * Real radial depth and computed face normals keep a high camera from revealing a flat billboard ring.
     */
    function createUltraHorizonReliefGeometry(zoneIndex, farScenery) {
      const positions = [];
      const colors = [];
      const layerRanges = [];
      const profile = createUltraHorizonProfile(zoneIndex, farScenery);
      const palette = WORLD_ULTRA_SKY_PALETTES[zoneIndex];
      const horizonColor = new THREE.Color(palette.horizon);
      const depthBlends = [0.14, 0.38, 0.64];
      const colorScratch = new THREE.Color();

      function reliefPoint(sample, radius, height) {
        return [
          Math.cos(sample.angle) * radius,
          height,
          Math.sin(sample.angle) * radius
        ];
      }

      function reliefColor(baseColor, sample, lift) {
        colorScratch.copy(baseColor).offsetHSL(0, 0, lift + (sample.tone - 0.5) * 0.045);
        return [colorScratch.r, colorScratch.g, colorScratch.b];
      }

      function appendTriangle(pointA, pointB, pointC, colorA, colorB, colorC) {
        positions.push(...pointA, ...pointB, ...pointC);
        colors.push(...colorA, ...colorB, ...colorC);
      }

      for (let layerIndex = 0; layerIndex < profile.layers.length; layerIndex++) {
        const samples = profile.layers[layerIndex];
        const width = WORLD_ULTRA_PRESENTATION_CONTRACT.horizonLayerWidthsM[layerIndex];
        const baseColor = new THREE.Color(palette.lower)
          .lerp(horizonColor, depthBlends[layerIndex]);
        const startVertex = positions.length / 3;
        let minimumRadius = Number.POSITIVE_INFINITY;
        let maximumRadius = Number.NEGATIVE_INFINITY;
        let minimumY = Number.POSITIVE_INFINITY;
        let maximumY = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < samples.length; index++) {
          const current = samples[index];
          const next = samples[(index + 1) % samples.length];
          const currentRadii = [
            current.crestRadius - width * 0.72,
            current.crestRadius - width * 0.27,
            current.crestRadius,
            current.crestRadius + width * 0.46
          ];
          const nextRadii = [
            next.crestRadius - width * 0.72,
            next.crestRadius - width * 0.27,
            next.crestRadius,
            next.crestRadius + width * 0.46
          ];
          const currentHeights = [
            current.footHeight,
            current.shoulderHeight,
            current.crestHeight,
            current.footHeight - 3
          ];
          const nextHeights = [
            next.footHeight,
            next.shoulderHeight,
            next.crestHeight,
            next.footHeight - 3
          ];
          minimumRadius = Math.min(minimumRadius, ...currentRadii);
          maximumRadius = Math.max(maximumRadius, ...currentRadii);
          minimumY = Math.min(minimumY, ...currentHeights);
          maximumY = Math.max(maximumY, ...currentHeights);
          for (let strip = 0; strip < 3; strip++) {
            const currentLower = reliefPoint(
              current,
              currentRadii[strip],
              currentHeights[strip]
            );
            const nextLower = reliefPoint(next, nextRadii[strip], nextHeights[strip]);
            const currentUpper = reliefPoint(
              current,
              currentRadii[strip + 1],
              currentHeights[strip + 1]
            );
            const nextUpper = reliefPoint(
              next,
              nextRadii[strip + 1],
              nextHeights[strip + 1]
            );
            const lowerLift = -0.055 + strip * 0.025;
            const upperLift = -0.03 + strip * 0.028;
            const currentLowerColor = reliefColor(baseColor, current, lowerLift);
            const nextLowerColor = reliefColor(baseColor, next, lowerLift);
            const currentUpperColor = reliefColor(baseColor, current, upperLift);
            const nextUpperColor = reliefColor(baseColor, next, upperLift);
            appendTriangle(
              currentLower,
              nextLower,
              currentUpper,
              currentLowerColor,
              nextLowerColor,
              currentUpperColor
            );
            appendTriangle(
              currentUpper,
              nextLower,
              nextUpper,
              currentUpperColor,
              nextLowerColor,
              nextUpperColor
            );
          }
        }
        layerRanges.push(Object.freeze({
          layerIndex,
          startVertex,
          vertexCount: positions.length / 3 - startVertex,
          minimumRadius,
          maximumRadius,
          minimumY,
          maximumY,
          profileSignature: samples
            .map((sample) => Math.round(sample.crestHeight * 1_000))
            .join(':')
        }));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.userData.neonV23Horizon = Object.freeze({
        seed: profile.seed,
        segmentCount: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonSegments,
        layerRanges: Object.freeze(layerRanges)
      });
      return geometry;
    }

    /**
     * Build one opaque material whose realm-colour transition works identically on WebGL1 and WebGL2.
     * Three r160 ignores morph colour attributes on its WebGL1 fallback, so an explicit immutable next-colour
     * attribute and one shader uniform own colour interpolation while native morphing continues to own shape.
     */
    function createUltraHorizonMaterial() {
      const colorBlendUniform = { value: 0 };
      const material = new THREE.MeshStandardMaterial({
        color: 0xff_ffff,
        vertexColors: true,
        emissive: 0x00_0000,
        emissiveIntensity: 0,
        roughness: 0.96,
        metalness: 0,
        flatShading: true,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        // Per-layer vertex colour owns bounded aerial perspective; realm fog would erase the outer 640m relief.
        fog: false,
        side: THREE.DoubleSide,
        toneMapped: true,
        dithering: true
      });
      material.userData.neonV23HorizonColorBlend = colorBlendUniform;
      material.onBeforeCompile = (shader) => {
        const colorParsToken = '#include <color_pars_vertex>';
        const colorVertexToken = '#include <color_vertex>';
        if (!shader.vertexShader.includes(colorParsToken)
          || !shader.vertexShader.includes(colorVertexToken)) {
          throw new Error('V23 Ultra horizon shader is missing the required colour chunks');
        }
        shader.uniforms.neonV23HorizonColorBlend = colorBlendUniform;
        shader.vertexShader = shader.vertexShader
          .replace(
            colorParsToken,
            `${colorParsToken}
#ifdef USE_COLOR
attribute vec3 neonV23NextHorizonColor;
uniform float neonV23HorizonColorBlend;
#endif`
          )
          .replace(
            colorVertexToken,
            `${colorVertexToken}
#if defined( USE_COLOR ) && ! defined( USE_COLOR_ALPHA )
vColor = mix(
  vColor,
  neonV23NextHorizonColor,
  clamp(neonV23HorizonColorBlend, 0.0, 1.0)
);
#endif`
          );
      };
      material.customProgramCacheKey = () => 'neon-v23-ultra-horizon-color-transition-v1';
      return material;
    }

    function createUltraHorizonGroup(zoneIndex) {
      const group = new THREE.Group();
      const farScenery = Object.freeze([...(zones[zoneIndex]?.atmosphere?.farScenery || [])]);
      group.name = `V23.World.UltraHorizon.${zoneIndex}`;
      group.userData.neonV23FarScenery = farScenery;
      group.userData.neonV23 = {
        modelClass: 'effect',
        collisionIndependent: true,
        mapIndependent: true,
        reason: 'High-only physically lit horizon relief sourced from zone.atmosphere.farScenery.',
        geometryMode: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonGeometryMode,
        depthLayerCount: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonDepthLayerCount
      };
      const reliefMaterial = createUltraHorizonMaterial();
      const relief = new THREE.Mesh(
        createUltraHorizonReliefGeometry(zoneIndex, farScenery),
        reliefMaterial
      );
      relief.name = `V23.World.UltraHorizonRelief.${zoneIndex}`;
      relief.frustumCulled = false;
      relief.castShadow = false;
      relief.receiveShadow = true;
      relief.renderOrder = -12 + zoneIndex * 0.001;
      Modeling.markEffect(
        relief,
        'High-only three-depth physical horizon relief; no collision or map registration.'
      );
      group.add(relief);
      group.visible = false;
      scene.add(group);
      deco.push(group);
      return group;
    }

    const ultraHorizonGroups = zones.map((_, zoneIndex) => createUltraHorizonGroup(zoneIndex));
    // All six geometries share identical vertex topology. Position and normal use one native absolute morph target;
    // the explicit next-colour attribute covers Three r160's WebGL1 colour-morph omission in the same opaque draw.
    // No transparent overlap, second mesh, geometry rebuild, or per-frame buffer write is permitted.
    for (let zoneIndex = 0; zoneIndex < ultraHorizonGroups.length; zoneIndex++) {
      const currentRelief = ultraHorizonGroups[zoneIndex].children.find((object) => object.isMesh);
      const nextRelief = ultraHorizonGroups[
        (zoneIndex + 1) % ultraHorizonGroups.length
      ].children.find((object) => object.isMesh);
      if (!currentRelief || !nextRelief) {
        throw new Error(`V23 Ultra horizon morph topology is missing realm ${zoneIndex}`);
      }
      for (const attributeName of ['position', 'normal', 'color']) {
        const currentAttribute = currentRelief.geometry.getAttribute(attributeName);
        const nextAttribute = nextRelief.geometry.getAttribute(attributeName);
        if (!currentAttribute || !nextAttribute || currentAttribute.count !== nextAttribute.count) {
          throw new Error(
            `V23 Ultra horizon ${attributeName} topology differs at realm ${zoneIndex}`
          );
        }
        if (attributeName === 'color') {
          currentRelief.geometry.setAttribute('neonV23NextHorizonColor', nextAttribute);
        } else {
          currentRelief.geometry.morphAttributes[attributeName] = [nextAttribute];
        }
      }
      currentRelief.geometry.morphTargetsRelative = false;
      currentRelief.geometry.computeBoundingSphere();
      currentRelief.updateMorphTargets();
      currentRelief.userData.neonV23NextHorizonZoneIndex =
        (zoneIndex + 1) % ultraHorizonGroups.length;
    }
    let ultraHorizonAnchorWorldX = Number.NaN;
    let ultraHorizonAnchorWorldZ = Number.NaN;
    let ultraHorizonAnchorLagM = 0;
    let ultraHorizonMorphWeight = 0;
    const ultraSkyColorA = new THREE.Color();
    const ultraWeatherTint = new THREE.Color();

    /** Measure the real resident meshes and materials instead of reporting the authored budget as observed truth. */
    function auditUltraHorizonPresentation() {
      let residentMeshCount = 0;
      let visibleDrawGroupCount = 0;
      let instancedMeshCount = 0;
      let morphTargetCount = 0;
      let emissiveViolationCount = 0;
      const profileSignatures = new Set();
      for (const group of ultraHorizonGroups) {
        group.traverse((object) => {
          if (object.isInstancedMesh) instancedMeshCount++;
          if (!object.isMesh) return;
          residentMeshCount++;
          morphTargetCount += object.geometry?.morphAttributes?.position?.length || 0;
          if (group.visible && object.visible) {
            visibleDrawGroupCount += Math.max(1, object.geometry?.groups?.length || 0);
          }
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ((material?.emissive?.getHex?.() || 0) !== 0
              || (Number(material?.emissiveIntensity) || 0) !== 0) {
              emissiveViolationCount++;
            }
          }
          for (const layer of object.geometry?.userData?.neonV23Horizon?.layerRanges || []) {
            profileSignatures.add(layer.profileSignature);
          }
        });
      }
      return {
        residentMeshCount,
        visibleDrawGroupCount,
        instancedMeshCount,
        morphTargetCount,
        emissiveViolationCount,
        profileSignatureCount: profileSignatures.size
      };
    }

    function updateUltraEnvironment(
      activeZoneIndex,
      nextZoneIndex,
      blend,
      daylight,
      weatherState,
      renderOrigin = null
    ) {
      if (!ultraEnabled) return;
      ultraSkyDome.position.copy(camera.position);
      const renderOriginX = Number(renderOrigin?.x) || 0;
      const renderOriginY = Number(renderOrigin?.y) || 0;
      const renderOriginZ = Number(renderOrigin?.z) || 0;
      const cameraWorldX = renderOriginX + camera.position.x;
      const cameraWorldZ = renderOriginZ + camera.position.z;
      if (!Number.isFinite(ultraHorizonAnchorWorldX)
        || !Number.isFinite(ultraHorizonAnchorWorldZ)) {
        ultraHorizonAnchorWorldX = cameraWorldX;
        ultraHorizonAnchorWorldZ = cameraWorldZ;
      }
      const anchorDeltaX = cameraWorldX - ultraHorizonAnchorWorldX;
      const anchorDeltaZ = cameraWorldZ - ultraHorizonAnchorWorldZ;
      const anchorDistance = Math.hypot(anchorDeltaX, anchorDeltaZ);
      const maximumAnchorLag = WORLD_ULTRA_PRESENTATION_CONTRACT.horizonMaximumAnchorLagM;
      if (anchorDistance > maximumAnchorLag) {
        const retainedScale = maximumAnchorLag / anchorDistance;
        ultraHorizonAnchorWorldX = cameraWorldX - anchorDeltaX * retainedScale;
        ultraHorizonAnchorWorldZ = cameraWorldZ - anchorDeltaZ * retainedScale;
      }
      ultraHorizonAnchorLagM = Math.min(anchorDistance, maximumAnchorLag);
      const activePalette = WORLD_ULTRA_SKY_PALETTES[activeZoneIndex] || WORLD_ULTRA_SKY_PALETTES[0];
      const nextPalette = WORLD_ULTRA_SKY_PALETTES[nextZoneIndex] || activePalette;
      ultraSkyUniforms.zenithColor.value
        .setHex(activePalette.zenith)
        .lerp(ultraSkyColorA.setHex(nextPalette.zenith), blend);
      ultraSkyUniforms.horizonColor.value
        .setHex(activePalette.horizon)
        .lerp(ultraSkyColorA.setHex(nextPalette.horizon), blend);
      ultraSkyUniforms.lowerColor.value
        .setHex(activePalette.lower)
        .lerp(ultraSkyColorA.setHex(nextPalette.lower), blend);
      const cloudDarkness = clamp(Number(weatherState?.cloudDarkness) || 0, 0, 1);
      const dust = clamp(Number(weatherState?.dust) || 0, 0, 1);
      ultraSkyUniforms.zenithColor.value.lerp(
        ultraWeatherTint.setHex(0x18_202b), cloudDarkness * 0.42
      );
      ultraSkyUniforms.horizonColor.value
        .lerp(ultraWeatherTint.setHex(0x58_6572), cloudDarkness * 0.30)
        .lerp(ultraWeatherTint.setHex(0xb0_7545), dust * 0.46);
      ultraSkyUniforms.hazeStrength.value = clamp(
        0.14 + daylight * 0.12 + cloudDarkness * 0.05 + dust * 0.14,
        0.10,
        0.42
      );
      ultraHorizonMorphWeight = blend;
      for (let zoneIndex = 0; zoneIndex < ultraHorizonGroups.length; zoneIndex++) {
        const group = ultraHorizonGroups[zoneIndex];
        group.visible = zoneIndex === activeZoneIndex;
        if (!group.visible) continue;
        // X/Z retain a bounded world anchor for parallax; Y stays on the world ground plane and never follows Top camera.
        group.position.set(
          ultraHorizonAnchorWorldX - renderOriginX,
          -renderOriginY,
          ultraHorizonAnchorWorldZ - renderOriginZ
        );
        const relief = group.children.find((object) => object.isMesh);
        if (relief?.morphTargetInfluences?.length) {
          relief.morphTargetInfluences[0] = blend;
        }
        const colorBlendUniform = relief?.material?.userData?.neonV23HorizonColorBlend;
        if (colorBlendUniform) colorBlendUniform.value = blend;
      }
    }

    // A real sphere carries the distant candle-moon surface; separate prewarmed halo, memory-petal, and cloud-veil
    // layers add restrained depth. They remain camera-relative presentation objects and never create a local light.
    const moonSurfaceCanvas = document.createElement('canvas');
    moonSurfaceCanvas.width = mobile ? 128 : 192;
    moonSurfaceCanvas.height = moonSurfaceCanvas.width / 2;
    const moonSurfaceContext = moonSurfaceCanvas.getContext('2d');
    if (!moonSurfaceContext) {
      throw new Error('V23 sky requires a two-dimensional canvas context for the candle-moon surface');
    }
    const moonSurfaceGradient = moonSurfaceContext.createLinearGradient(
      0,
      0,
      moonSurfaceCanvas.width,
      moonSurfaceCanvas.height
    );
    moonSurfaceGradient.addColorStop(0, '#9fb4c5');
    moonSurfaceGradient.addColorStop(0.38, '#edf2e8');
    moonSurfaceGradient.addColorStop(0.68, '#c9d8df');
    moonSurfaceGradient.addColorStop(1, '#8ea6ba');
    moonSurfaceContext.fillStyle = moonSurfaceGradient;
    moonSurfaceContext.fillRect(0, 0, moonSurfaceCanvas.width, moonSurfaceCanvas.height);
    moonSurfaceContext.globalCompositeOperation = 'multiply';
    for (const crater of [
      [0.20, 0.38, 0.070, 0.10, -0.28],
      [0.46, 0.64, 0.095, 0.07, 0.18],
      [0.73, 0.34, 0.060, 0.09, -0.12],
      [0.86, 0.70, 0.045, 0.06, 0.32]
    ]) {
      moonSurfaceContext.fillStyle = 'rgba(80, 99, 122, 0.16)';
      moonSurfaceContext.beginPath();
      moonSurfaceContext.ellipse(
        moonSurfaceCanvas.width * crater[0],
        moonSurfaceCanvas.height * crater[1],
        moonSurfaceCanvas.width * crater[2],
        moonSurfaceCanvas.height * crater[3],
        crater[4],
        0,
        Math.PI * 2
      );
      moonSurfaceContext.fill();
    }
    const moonSurfaceTexture = new THREE.CanvasTexture(moonSurfaceCanvas);
    if (THREE.SRGBColorSpace !== undefined) moonSurfaceTexture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) moonSurfaceTexture.encoding = THREE.sRGBEncoding;

    const moonHaloCanvas = document.createElement('canvas');
    moonHaloCanvas.width = mobile ? 96 : 160;
    moonHaloCanvas.height = moonHaloCanvas.width;
    const moonHaloContext = moonHaloCanvas.getContext('2d');
    if (!moonHaloContext) {
      throw new Error('V23 sky requires a two-dimensional canvas context for the candle-moon halo');
    }
    const moonHaloGradient = moonHaloContext.createRadialGradient(
      moonHaloCanvas.width * 0.5,
      moonHaloCanvas.height * 0.5,
      moonHaloCanvas.width * 0.14,
      moonHaloCanvas.width * 0.5,
      moonHaloCanvas.height * 0.5,
      moonHaloCanvas.width * 0.5
    );
    moonHaloGradient.addColorStop(0, 'rgba(232, 242, 255, 0.62)');
    moonHaloGradient.addColorStop(0.42, 'rgba(181, 210, 239, 0.28)');
    moonHaloGradient.addColorStop(1, 'rgba(126, 163, 208, 0)');
    moonHaloContext.fillStyle = moonHaloGradient;
    moonHaloContext.fillRect(0, 0, moonHaloCanvas.width, moonHaloCanvas.height);
    const moonHaloTexture = new THREE.CanvasTexture(moonHaloCanvas);
    if (THREE.SRGBColorSpace !== undefined) moonHaloTexture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) moonHaloTexture.encoding = THREE.sRGBEncoding;

    const moonDiscGeometry = new THREE.SphereGeometry(18, mobile ? 16 : 24, mobile ? 10 : 16);
    const moonDiscMaterial = new THREE.MeshStandardMaterial({
      map: moonSurfaceTexture,
      color: 0xee_f5ff,
      emissive: 0x7d_91aa,
      emissiveMap: moonSurfaceTexture,
      emissiveIntensity: 0.16,
      roughness: 0.96,
      metalness: 0,
      fog: false
    });
    const moonHaloMaterial = new THREE.SpriteMaterial({
      map: moonHaloTexture,
      color: 0xa8_ccff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    const moonStarPetalGeometry = Modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [
        [0, -0.85],
        [0.42, -0.24],
        [0.76, 0.18],
        [0.26, 0.92],
        [0, 1.16],
        [-0.26, 0.92],
        [-0.76, 0.18],
        [-0.42, -0.24]
      ],
      depth: 0.12,
      bevel: 0.04,
      bevelSegments: 1
    });
    registerGeometry(moonStarPetalGeometry, {
      zone: 'sky',
      family: 'distant_candle_moon',
      role: 'closed_memory_star_petal'
    });
    const moonStarPetalMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9_e4ff,
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    const moonStarPetals = new THREE.InstancedMesh(
      moonStarPetalGeometry,
      moonStarPetalMaterial,
      MOON_LIGHTING_CONTRACT.memoryStarPetalInstanceCount
    );
    moonStarPetals.name = 'V23.Sky.MemoryStarPetals';
    const moonLayerMatrix = new THREE.Matrix4();
    const moonLayerPosition = new THREE.Vector3();
    const moonLayerRotation = new THREE.Quaternion();
    const moonLayerScale = new THREE.Vector3();
    const moonLayerAxis = new THREE.Vector3(0, 0, 1);
    for (let index = 0; index < MOON_LIGHTING_CONTRACT.memoryStarPetalInstanceCount; index++) {
      const angle = index / MOON_LIGHTING_CONTRACT.memoryStarPetalInstanceCount * Math.PI * 2 + 0.18;
      const radius = index % 2 === 0 ? 30 : 34;
      moonLayerPosition.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 2.2);
      moonLayerRotation.setFromAxisAngle(moonLayerAxis, angle - Math.PI / 2);
      const petalScale = index % 3 === 0 ? 2.4 : 1.7;
      moonLayerScale.set(petalScale, petalScale, petalScale);
      moonLayerMatrix.compose(moonLayerPosition, moonLayerRotation, moonLayerScale);
      moonStarPetals.setMatrixAt(index, moonLayerMatrix);
    }
    moonStarPetals.instanceMatrix.needsUpdate = true;
    moonStarPetals.frustumCulled = false;
    moonStarPetals.renderOrder = -1;
    Modeling.markEffect(moonStarPetals, 'Sparse closed memory-star petals; visual-only and collision-free.');

    const moonCloudVeilGeometry = Modeling.createExtrudedProfileGeometry({
      THREE,
      outline: [
        [-18, -1.2],
        [-13, -2.5],
        [-6, -1.7],
        [1, -2.3],
        [9, -1.2],
        [18, -1.6],
        [14, 1.0],
        [7, 1.6],
        [-1, 1.1],
        [-9, 1.7],
        [-16, 0.8]
      ],
      depth: 0.10,
      bevel: 0.05,
      bevelSegments: 1
    });
    registerGeometry(moonCloudVeilGeometry, {
      zone: 'sky',
      family: 'distant_candle_moon',
      role: 'closed_memory_cloud_veil'
    });
    const moonCloudVeilMaterial = new THREE.MeshBasicMaterial({
      color: 0xb9_d0e1,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide
    });
    const moonCloudVeils = new THREE.InstancedMesh(
      moonCloudVeilGeometry,
      moonCloudVeilMaterial,
      MOON_LIGHTING_CONTRACT.cloudVeilInstanceCount
    );
    moonCloudVeils.name = 'V23.Sky.MemoryCloudVeils';
    moonLayerPosition.set(-9, -15, 3.2);
    moonLayerRotation.setFromAxisAngle(moonLayerAxis, -0.08);
    moonLayerScale.set(1.18, 1.18, 1.18);
    moonLayerMatrix.compose(moonLayerPosition, moonLayerRotation, moonLayerScale);
    moonCloudVeils.setMatrixAt(0, moonLayerMatrix);
    moonLayerPosition.set(10, 12, -2.4);
    moonLayerRotation.setFromAxisAngle(moonLayerAxis, 0.16);
    moonLayerScale.set(0.92, 0.92, 0.92);
    moonLayerMatrix.compose(moonLayerPosition, moonLayerRotation, moonLayerScale);
    moonCloudVeils.setMatrixAt(1, moonLayerMatrix);
    moonCloudVeils.instanceMatrix.needsUpdate = true;
    moonCloudVeils.frustumCulled = false;
    moonCloudVeils.renderOrder = -2;
    Modeling.markEffect(moonCloudVeils, 'Layered closed cloud veils around the candle-moon; visual-only.');

    const moonAnchor = new THREE.Group();
    moonAnchor.name = 'V23.Sky.MoonAnchor';
    moonAnchor.userData.neonV23 = {
      modelClass: 'effect',
      collisionIndependent: true,
      lightingAuthority: MOON_LIGHTING_CONTRACT.directionAuthority,
      residencyMode: MOON_LIGHTING_CONTRACT.residencyMode,
      reason: 'Resident candle-moon layers follow the physical direction; the main rig exclusively owns illumination and shadows.'
    };
    const moonHalo = new THREE.Sprite(moonHaloMaterial);
    moonHalo.name = 'V23.Sky.CandleMoonHalo';
    moonHalo.scale.set(76, 76, 1);
    moonHalo.renderOrder = -2;
    Modeling.markEffect(moonHalo, 'Soft candle-moon halo; visual-only and collision-free.');
    const moonDisc = new THREE.Mesh(moonDiscGeometry, moonDiscMaterial);
    moonDisc.name = 'V23.Sky.CandleMoonDisc';
    moonDisc.renderOrder = 0;
    moonDisc.castShadow = false;
    moonDisc.receiveShadow = false;
    Modeling.markMainVisual(moonDisc, {
      module: 'world',
      family: 'distant-candle-moon',
      role: 'solid-candle-moon-disc',
      lightingAuthority: MOON_LIGHTING_CONTRACT.directionAuthority
    });
    const moonVisual = new THREE.Group();
    moonVisual.name = 'V23.Sky.CandleMoonMemoryLayers';
    moonVisual.position.set(...LEGACY_MOON_VISUAL_OFFSET);
    moonVisual.add(moonHalo, moonCloudVeils, moonStarPetals, moonDisc);
    moonAnchor.add(moonVisual);
    scene.add(moonAnchor);
    deco.push(moonAnchor);
    const moonVisualOffset = {
      x: LEGACY_MOON_VISUAL_OFFSET[0],
      y: LEGACY_MOON_VISUAL_OFFSET[1],
      z: LEGACY_MOON_VISUAL_OFFSET[2],
      usesPhysicalDirection: false
    };

    const darkDragonBodyMaterial = LEGACY_CREATURES_ENABLED ? Modeling.createMaterial({
      THREE,
      kind: 'hazard',
      color: 0x4b_2834,
      emissive: 0x58_1828,
      emissiveIntensity: 0.34,
      roughness: 0.78,
      metalness: 0.08,
      procedural: true
    }) : null;
    const darkDragonWingMaterial = LEGACY_CREATURES_ENABLED ? Modeling.createMaterial({
      THREE,
      kind: 'hazard',
      color: 0x31_1c2b,
      emissive: 0x45_1424,
      emissiveIntensity: 0.28,
      roughness: 0.84,
      metalness: 0.04,
      procedural: true
    }) : null;

    function buildDarkDragonTemplate() {
      const zoneIndex = 5;
      const family = 'dark_dragon';
      const group = makeGroup(zoneIndex, family);
      const body = loft([
        ellipseRingZ(-3.9, 0.48, 0.42, detail.radial, 0.10),
        ellipseRingZ(-1.5, 1.05, 0.72, detail.radial, 0.22),
        ellipseRingZ(1.8, 0.82, 0.56, detail.radial, 0.04),
        ellipseRingZ(4.0, 0.38, 0.30, detail.radial, 0.18),
        ellipseRingZ(5.4, 0.08, 0.06, detail.radial)
      ], zoneIndex, family, 'sealed-serpentine-body', 'dark');
      body.material = darkDragonBodyMaterial;
      body.userData.darkDragonBody = true;
      attach(group, body, [0, 0.4, 0]);

      // Overlapping closed head and tail sections create safe articulation without opening the silhouette mesh at either joint.
      const headPivot = new THREE.Group();
      headPivot.position.set(0, 0.4, -3.6);
      headPivot.userData.darkDragonHead = true;
      const head = loft([
        ellipseRingZ(-1.8, 0.16, 0.13, detail.radial),
        ellipseRingZ(-1.1, 0.76, 0.60, detail.radial, 0.12),
        ellipseRingZ(0.15, 0.62, 0.48, detail.radial, 0.04),
        ellipseRingZ(0.50, 0.42, 0.34, detail.radial)
      ], zoneIndex, family, 'sealed-articulated-head', 'dark');
      head.material = darkDragonBodyMaterial;
      headPivot.add(head);
      group.add(headPivot);

      const wingOutline = [[0.25, -2.5], [4.7, -1.35], [7.1, 0.55], [5.3, 1.62], [2.0, 1.0], [0.18, 2.85], [-0.45, 0.35]];
      for (const side of [-1, 1]) {
        const wing = extrusion(wingOutline, 0.26, zoneIndex, family, 'sealed-shadow-wing', 'dark', 0.08);
        wing.material = darkDragonWingMaterial;
        wing.position.set(side * 0.58, 0.46, -0.4);
        wing.rotation.set(Math.PI / 2, 0, side * -0.10);
        wing.scale.x = side;
        wing.userData.darkDragonWing = side;
        group.add(wing);
      }

      const tail = tube([[0, 0, 0], [0.22, -0.08, 3.3], [-0.32, -0.24, 6.3]], 0.17, zoneIndex, family, 'sealed-whip-tail', 'dark', 7);
      tail.material = darkDragonBodyMaterial;
      tail.userData.darkDragonTail = true;
      attach(group, tail, [0, 0.42, 3.5]);
      for (const side of [-1, 1]) {
        const horn = tube([
          [0.38 * side, 0.34, -0.65],
          [0.72 * side, 0.72, -1.15],
          [1.05 * side, 1.00, -0.95]
        ], 0.10, zoneIndex, family, 'sealed-horn', 'trim', 7);
        attach(headPivot, horn);
        const eye = addShard(headPivot, zoneIndex, family, [0.38 * side, 0.16, -1.4], [0.12, 0.12, 0.12], 'accent');
        eye.userData.darkDragonEye = true;
      }
      for (const z of [-2.8, -0.8, 1.2, 3.0]) {
        addShard(group, zoneIndex, family, [0, 1.0, z], [0.16, 0.50, 0.28], 'accent', 0.06);
      }
      return group;
    }

    const darkDragonTemplate = LEGACY_CREATURES_ENABLED ? buildDarkDragonTemplate() : null;
    const darkDragons = [];
    const darkDragonRigs = [];
    const darkDragonCount = LEGACY_CREATURES_ENABLED ? (mobile ? 1 : 2) : 0;
    for (let index = 0; index < darkDragonCount; index++) {
      const dragon = darkDragonTemplate.clone(true);
      dragon.userData.kind = 'darkDragon';
      dragon.userData.offset = 100
        + index * (DARK_DRAGON_FLIGHT_CONTRACT.cycleLengthM / darkDragonCount)
        + skyRandom(-20, 20);
      dragon.userData.lateral = (index % 2 ? -1 : 1) * skyRandom(34, 58);
      dragon.userData.height = Math.max(maximumDeckHeight + 18, skyRandom(58, 78));
      dragon.userData.phase = skyRandom(0, Math.PI * 2);
      dragon.scale.setScalar(skyRandom(mobile ? 1.60 : 2.00, mobile ? 2.00 : 2.60));
      dragon.updateMatrixWorld(true);
      boundsScratch.setFromObject(dragon);
      dragon.userData.horizontalRadius = Math.hypot(
        Math.max(Math.abs(boundsScratch.min.x), Math.abs(boundsScratch.max.x)),
        Math.max(Math.abs(boundsScratch.min.z), Math.abs(boundsScratch.max.z))
      );
      // Hide until the first world update resolves a dark-zone flight anchor; this prevents an origin flash during startup.
      dragon.visible = false;
      const rig = { dragon, body: null, head: null, tail: null, wings: [], eyes: [] };
      dragon.traverse((child) => {
        if (child.userData.darkDragonBody) rig.body = child;
        if (child.userData.darkDragonHead) rig.head = child;
        if (child.userData.darkDragonTail) rig.tail = child;
        if (child.userData.darkDragonWing) rig.wings.push(child);
        if (child.userData.darkDragonEye) rig.eyes.push(child);
      });
      scene.add(dragon);
      deco.push(dragon);
      darkDragons.push(dragon);
      darkDragonRigs.push(rig);
      registerMapEntity(dragon, 'dark-dragon', dragon.userData.horizontalRadius);
    }

    // Stars, dawn motes, snow and ash use a camera-centered 360-degree shell so route turns cannot expose an empty hemisphere.
    const particleGeometry = new THREE.BufferGeometry();
    const particleVertices = new Float32Array(detail.particles * 3);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let index = 0; index < detail.particles; index++) {
      const azimuth = index * goldenAngle + skyRandom(-0.025, 0.025);
      const radius = skyRandom(20, 760);
      particleVertices[index * 3] = Math.sin(azimuth) * radius;
      particleVertices[index * 3 + 1] = skyRandom(8, 118);
      particleVertices[index * 3 + 2] = -Math.cos(azimuth) * radius;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particleVertices, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0xff_f3cf, size: mobile ? 0.38 : 0.52, transparent: true, opacity: 0.64, depthWrite: false, blending: THREE.AdditiveBlending });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.userData.kind = 'atmosphereParticles';
    // The camera sits inside this shell; disabling object-level culling prevents a stale bounding sphere from hiding every point.
    particles.frustumCulled = false;
    Modeling.markEffect(particles, 'micro-particle atmosphere; no collision or silhouette role');
    scene.add(particles);
    deco.push(particles);

    // Rain, snow, hail, and dust keep separate preallocated pools because their motion and silhouettes differ.
    // The local volume follows the viewer, while every particle pose is derived from the pausable sky clock.
    const weatherVolume = new THREE.Group();
    weatherVolume.name = 'V23.Weather.LocalVolume';
    weatherVolume.frustumCulled = false;
    Modeling.markEffect(weatherVolume, 'visual-only local weather volume; no gameplay or collision authority');
    const weatherSpanX = mobile ? 46 : 66;
    const weatherSpanY = WEATHER_VIEW_VOLUME_CONTRACT.minimumCameraCenteredVerticalSpanM;
    const weatherSpanZ = mobile ? 58 : 82;
    const precipitationDepthProfile = mobile
      ? PRECIPITATION_DEPTH_CONTRACT.spansM.mobile
      : PRECIPITATION_DEPTH_CONTRACT.spansM.desktop;
    const precipitationCapacity = mobile
      ? PRECIPITATION_DEPTH_CONTRACT.capacity.mobile
      : PRECIPITATION_DEPTH_CONTRACT.capacity.desktop;
    const topViewUpwardRaySlope = Math.tan(
      WEATHER_VIEW_VOLUME_CONTRACT.maximumTopViewUpwardRayDeg * Math.PI / 180
    );
    const weatherTopRayVerticalMarginM = Math.min(
      ...PRECIPITATION_DEPTH_CONTRACT.bandNames.map((bandName) => {
        const span = precipitationDepthProfile[bandName];
        return span.vertical * 0.5 - span.horizontal * 0.5 * topViewUpwardRaySlope;
      })
    );
    const weatherCapacities = Object.freeze({
      rain: precipitationCapacity.rain,
      snow: precipitationCapacity.snowBase,
      hail: mobile
        ? WEATHER_VIEW_VOLUME_CONTRACT.capacity.mobile.hail
        : WEATHER_VIEW_VOLUME_CONTRACT.capacity.desktop.hail,
      dust: mobile
        ? WEATHER_VIEW_VOLUME_CONTRACT.capacity.mobile.dust
        : WEATHER_VIEW_VOLUME_CONTRACT.capacity.desktop.dust
    });
    // The near layer belongs to the snow family rather than becoming a fifth weather authority.
    // It adds readable flakes close to the camera while weatherPoolCount keeps its four-family contract.
    const snowNearCapacity = precipitationCapacity.snowNear;
    const weatherParticleCanvas = document.createElement('canvas');
    weatherParticleCanvas.width = 32;
    weatherParticleCanvas.height = 32;
    const weatherParticleContext = weatherParticleCanvas.getContext('2d');
    if (!weatherParticleContext) {
      throw new Error('V23 weather particles require a two-dimensional canvas context');
    }
    const weatherParticleGradient = weatherParticleContext.createRadialGradient(16, 16, 1, 16, 16, 15);
    weatherParticleGradient.addColorStop(0, 'rgba(255,255,255,1)');
    weatherParticleGradient.addColorStop(0.52, 'rgba(255,255,255,0.88)');
    weatherParticleGradient.addColorStop(1, 'rgba(255,255,255,0)');
    weatherParticleContext.fillStyle = weatherParticleGradient;
    weatherParticleContext.fillRect(0, 0, 32, 32);
    const weatherParticleTexture = new THREE.CanvasTexture(weatherParticleCanvas);
    weatherParticleTexture.colorSpace = THREE.SRGBColorSpace;
    weatherParticleTexture.needsUpdate = true;

    // A dedicated six-branched texture prevents snow from reading as recolored hail. The asset is authored
    // once during construction and shared by both snow layers; no Canvas or Texture work occurs in a frame.
    const snowflakeCanvas = document.createElement('canvas');
    snowflakeCanvas.width = 64;
    snowflakeCanvas.height = 64;
    const snowflakeContext = snowflakeCanvas.getContext('2d');
    if (!snowflakeContext) {
      throw new Error('V23 snowflakes require a two-dimensional canvas context');
    }
    snowflakeContext.translate(32, 32);
    snowflakeContext.strokeStyle = 'rgba(244, 251, 255, 0.98)';
    snowflakeContext.lineCap = 'round';
    snowflakeContext.lineJoin = 'round';
    snowflakeContext.shadowColor = 'rgba(188, 224, 255, 0.72)';
    snowflakeContext.shadowBlur = 3;
    for (let armIndex = 0; armIndex < 6; armIndex++) {
      snowflakeContext.save();
      snowflakeContext.rotate(armIndex * Math.PI / 3);
      snowflakeContext.lineWidth = 2.1;
      snowflakeContext.beginPath();
      snowflakeContext.moveTo(0, 1);
      snowflakeContext.lineTo(0, -25);
      snowflakeContext.stroke();
      for (const branchY of [-9, -15, -21]) {
        const branchLength = 4.4 + Math.abs(branchY) * 0.12;
        snowflakeContext.lineWidth = 1.45;
        snowflakeContext.beginPath();
        snowflakeContext.moveTo(0, branchY);
        snowflakeContext.lineTo(-branchLength, branchY + branchLength * 0.68);
        snowflakeContext.moveTo(0, branchY);
        snowflakeContext.lineTo(branchLength, branchY + branchLength * 0.68);
        snowflakeContext.stroke();
      }
      snowflakeContext.restore();
    }
    snowflakeContext.shadowBlur = 0;
    snowflakeContext.fillStyle = 'rgba(255, 255, 255, 1)';
    snowflakeContext.beginPath();
    snowflakeContext.arc(0, 0, 2.5, 0, Math.PI * 2);
    snowflakeContext.fill();
    const snowflakeTexture = new THREE.CanvasTexture(snowflakeCanvas);
    snowflakeTexture.colorSpace = THREE.SRGBColorSpace;
    snowflakeTexture.needsUpdate = true;

    function createWeatherSeeds(capacity, spanX = weatherSpanX, spanZ = weatherSpanZ) {
      const seeds = new Float32Array(capacity * 4);
      for (let index = 0; index < capacity; index++) {
        const offset = index * 4;
        seeds[offset] = weatherRandom(-spanX * 0.5, spanX * 0.5);
        seeds[offset + 1] = weatherRandomUnit();
        seeds[offset + 2] = weatherRandom(-spanZ * 0.5, spanZ * 0.5);
        seeds[offset + 3] = weatherRandom(-1, 1);
      }
      return seeds;
    }

    /**
     * Precompute world-periodic rain/snow seeds in interleaved depth bands.
     * The frame loop performs no sorting, allocation, or reseeding.
     */
    function createDepthWeatherSeeds(capacity, family) {
      const seeds = new Float32Array(capacity * 4);
      const bandIds = new Uint8Array(capacity);
      const bandCounts = new Uint16Array(3);
      for (let index = 0; index < capacity; index++) {
        const offset = index * 4;
        const bandId = precipitationDepthBandId(family, index);
        const bandName = PRECIPITATION_DEPTH_CONTRACT.bandNames[bandId];
        const span = precipitationDepthProfile[bandName];
        seeds[offset] = weatherRandom(-span.horizontal * 0.5, span.horizontal * 0.5);
        seeds[offset + 1] = weatherRandomUnit();
        seeds[offset + 2] = weatherRandom(-span.horizontal * 0.5, span.horizontal * 0.5);
        seeds[offset + 3] = weatherRandom(-1, 1);
        bandIds[index] = bandId;
        bandCounts[bandId]++;
      }
      return Object.freeze({ seeds, bandIds, bandCounts });
    }

    const rainDepthSeeds = createDepthWeatherSeeds(weatherCapacities.rain, 'rain');
    const rainSeeds = rainDepthSeeds.seeds;
    const rainBandIds = rainDepthSeeds.bandIds;
    const rainPositions = new Float32Array(weatherCapacities.rain * 6);
    const rainColors = new Float32Array(weatherCapacities.rain * 6);
    const rainStyles = new Float32Array(weatherCapacities.rain * 3);
    const rainStyleContract = Object.freeze({
      minimumLengthScale: 0.68,
      maximumLengthScale: 1.40,
      minimumBrightness: 0.52,
      maximumBrightness: 1,
      maximumAngleJitter: 1
    });
    for (let index = 0; index < weatherCapacities.rain; index++) {
      const seedOffset = index * 4;
      const styleOffset = index * 3;
      const colorOffset = index * 6;
      const phase = rainSeeds[seedOffset + 1];
      const drift = rainSeeds[seedOffset + 3];
      const lengthScale = rainStyleContract.minimumLengthScale
        + phase * (rainStyleContract.maximumLengthScale - rainStyleContract.minimumLengthScale);
      const brightnessPhase = ((phase * 7.31 + drift * 3.17) % 1 + 1) % 1;
      const brightness = rainStyleContract.minimumBrightness
        + brightnessPhase * (rainStyleContract.maximumBrightness - rainStyleContract.minimumBrightness);
      rainStyles[styleOffset] = lengthScale;
      rainStyles[styleOffset + 1] = brightness;
      rainStyles[styleOffset + 2] = drift * rainStyleContract.maximumAngleJitter;
      // The falling endpoint is brighter than its upper tail, giving each line a tapered luminous read
      // without allocating textured quads or changing the absolute-world motion contract.
      rainColors[colorOffset] = 0.72 * brightness;
      rainColors[colorOffset + 1] = 0.87 * brightness;
      rainColors[colorOffset + 2] = brightness;
      rainColors[colorOffset + 3] = 0.42 * brightness;
      rainColors[colorOffset + 4] = 0.58 * brightness;
      rainColors[colorOffset + 5] = 0.72 * brightness;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(rainPositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    rainGeometry.setAttribute('color', new THREE.BufferAttribute(rainColors, 3));
    rainGeometry.setDrawRange(0, 0);
    const rainMaterial = new THREE.LineBasicMaterial({
      color: 0xff_ffff,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    const rainShelterUniforms = {
      localExposure: { value: 1 },
      distantExposure: { value: 1 },
      innerRadiusM: { value: LOCAL_RAIN_SHELTER_CONTRACT.innerRadiusM },
      outerRadiusM: { value: LOCAL_RAIN_SHELTER_CONTRACT.outerRadiusM }
    };
    rainMaterial.userData.neonV23LocalRainShelter = rainShelterUniforms;
    rainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uV23RainLocalExposure = rainShelterUniforms.localExposure;
      shader.uniforms.uV23RainDistantExposure = rainShelterUniforms.distantExposure;
      shader.uniforms.uV23RainShelterInnerM = rainShelterUniforms.innerRadiusM;
      shader.uniforms.uV23RainShelterOuterM = rainShelterUniforms.outerRadiusM;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec2 vV23RainLocalXZ;'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvV23RainLocalXZ = transformed.xz;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uV23RainLocalExposure;
uniform float uV23RainDistantExposure;
uniform float uV23RainShelterInnerM;
uniform float uV23RainShelterOuterM;
varying vec2 vV23RainLocalXZ;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float v23RainExteriorBlend = smoothstep(
  uV23RainShelterInnerM,
  uV23RainShelterOuterM,
  length(vV23RainLocalXZ)
);
diffuseColor.a *= mix(uV23RainLocalExposure, uV23RainDistantExposure, v23RainExteriorBlend);`
        );
    };
    rainMaterial.customProgramCacheKey = () => 'v23-local-rain-shelter-v1';
    const rainPool = new THREE.LineSegments(rainGeometry, rainMaterial);
    rainPool.name = 'V23.Weather.Rain';
    rainPool.frustumCulled = false;
    rainPool.renderOrder = 4;
    Modeling.markEffect(rainPool, 'visual-only rain streak pool');
    weatherVolume.add(rainPool);

    function createWeatherPointPool(name, capacity, color, size, options = {}) {
      const spanX = Number(options.spanX) || weatherSpanX;
      const spanY = Number(options.spanY) || weatherSpanY;
      const spanZ = Number(options.spanZ) || weatherSpanZ;
      const depthFamily = options.depthFamily || null;
      const depthSeeds = depthFamily
        ? createDepthWeatherSeeds(capacity, depthFamily)
        : null;
      const positions = new Float32Array(capacity * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
      );
      geometry.setDrawRange(0, 0);
      const material = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: true,
        map: options.map || weatherParticleTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      const object = new THREE.Points(geometry, material);
      object.name = `V23.Weather.${name}`;
      object.frustumCulled = false;
      object.renderOrder = 4;
      Modeling.markEffect(object, `visual-only ${name.toLowerCase()} particle pool`);
      weatherVolume.add(object);
      return Object.freeze({
        capacity,
        seeds: depthSeeds?.seeds || createWeatherSeeds(capacity, spanX, spanZ),
        depthBandIds: depthSeeds?.bandIds || null,
        depthBandCounts: depthSeeds?.bandCounts || null,
        positions,
        geometry,
        material,
        object,
        spanX,
        spanY,
        spanZ,
        opacityScale: Number.isFinite(options.opacityScale) ? options.opacityScale : 1,
        fallSpeedScale: Number.isFinite(options.fallSpeedScale) ? options.fallSpeedScale : 1,
        swayScale: Number.isFinite(options.swayScale) ? options.swayScale : 1,
        windScale: Number.isFinite(options.windScale) ? options.windScale : 1,
        driftScale: Number.isFinite(options.driftScale) ? options.driftScale : 1
      });
    }

    // The base layer uses a soft particle across mid/far bands; only the near layer resolves authored
    // six-branch flakes. Both remain below one world metre so perspective never creates screen-sized icons.
    const snowPool = createWeatherPointPool(
      'Snow',
      weatherCapacities.snow,
      0xf1_f8ff,
      mobile ? 0.30 : 0.42,
      {
        map: weatherParticleTexture,
        opacityScale: 0.72,
        depthFamily: 'snow-base'
      }
    );
    const hailPool = createWeatherPointPool(
      'Hail',
      weatherCapacities.hail,
      0xe8_f6ff,
      mobile ? 0.34 : 0.46,
      { depthFamily: 'rain' }
    );
    const dustPool = createWeatherPointPool(
      'Dust',
      weatherCapacities.dust,
      0xd6_9a5b,
      mobile ? 0.54 : 0.76,
      { depthFamily: 'rain' }
    );
    const snowNearPool = createWeatherPointPool(
      'SnowNear',
      snowNearCapacity,
      0xf7_fbff,
      mobile ? 0.48 : 0.68,
      {
        map: snowflakeTexture,
        spanX: weatherSpanX * 0.46,
        spanY: WEATHER_VIEW_VOLUME_CONTRACT.minimumCameraCenteredVerticalSpanM,
        spanZ: weatherSpanZ * 0.50,
        opacityScale: 0.86,
        fallSpeedScale: 0.82,
        swayScale: 1.34,
        windScale: 0.88,
        driftScale: 1.42
      }
    );
    snowNearPool.object.renderOrder = 5;
    // The pool follows the camera only as a floating render container. Particle coordinates subtract the
    // absolute camera anchor, so forward travel produces real relative motion instead of carrying snow with the ship.
    const weatherAnchor = Object.seal({ worldX: 0, worldY: 0, worldZ: 0, surfaceWorldY: 0 });
    let previousWeatherCameraWorldX = null;
    let previousWeatherCameraWorldZ = null;
    let previousSnowReferenceX = null;
    let previousSnowReferenceY = null;
    let previousSnowReferenceZ = null;
    scene.add(weatherVolume);
    deco.push(weatherVolume);

    Object.assign(clearanceReport, {
      weatherVisualOnly: true,
      weatherSelector: 'pausable-time-with-locked-realm-stage-goals',
      weatherMotionClock: 'pausable-sky-elapsed-seconds',
      weatherAnchorMode: 'absolute-world-periodic-volume',
      weatherWorldAnchored: true,
      weatherPrecipitationDepthMode: PRECIPITATION_DEPTH_CONTRACT.mode,
      weatherPrecipitationDepthVersion: PRECIPITATION_DEPTH_CONTRACT.version,
      weatherViewVolumeContractVersion: WEATHER_VIEW_VOLUME_CONTRACT.version,
      weatherViewVolumeMode: WEATHER_VIEW_VOLUME_CONTRACT.mode,
      weatherMaximumSupportedCameraHeightAboveSurfaceM:
        WEATHER_VIEW_VOLUME_CONTRACT.maximumSupportedCameraHeightAboveSurfaceM,
      weatherMaximumTopViewUpwardRayDeg:
        WEATHER_VIEW_VOLUME_CONTRACT.maximumTopViewUpwardRayDeg,
      weatherMaximumTopViewSightlineM: WEATHER_VIEW_VOLUME_CONTRACT.maximumTopViewSightlineM,
      weatherMinimumGroundOverlapM: WEATHER_VIEW_VOLUME_CONTRACT.minimumGroundOverlapM,
      weatherMinimumCameraOverheadM: WEATHER_VIEW_VOLUME_CONTRACT.minimumCameraOverheadM,
      weatherMinimumCameraCenteredVerticalSpanM:
        WEATHER_VIEW_VOLUME_CONTRACT.minimumCameraCenteredVerticalSpanM,
      weatherTopRayVerticalMarginM,
      weatherDustBottomOffsetM: WEATHER_VIEW_VOLUME_CONTRACT.dustBottomOffsetM,
      weatherDustDenseGroundFraction: WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundFraction,
      weatherDustDenseGroundHeightM: WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundHeightM,
      weatherHailUsesDepthBands: WEATHER_VIEW_VOLUME_CONTRACT.hailUsesDepthBands,
      weatherDustUsesDepthBands: WEATHER_VIEW_VOLUME_CONTRACT.dustUsesDepthBands,
      weatherAdditionalDrawGroups: WEATHER_VIEW_VOLUME_CONTRACT.additionalDrawGroups,
      weatherViewVolumeVisualOnly: WEATHER_VIEW_VOLUME_CONTRACT.presentationOnly,
      weatherPoolCount: 4,
      weatherLayerCount: 5,
      weatherRainLayerCount: 1,
      weatherSnowLayerCount: 2,
      weatherRainCapacity: weatherCapacities.rain,
      weatherSnowCapacity: weatherCapacities.snow + snowNearCapacity,
      weatherSnowBaseCapacity: weatherCapacities.snow,
      weatherSnowNearCapacity: snowNearCapacity,
      weatherRainNearBandCapacity: rainDepthSeeds.bandCounts[0],
      weatherRainMidBandCapacity: rainDepthSeeds.bandCounts[1],
      weatherRainFarBandCapacity: rainDepthSeeds.bandCounts[2],
      weatherSnowMidBandCapacity: snowPool.depthBandCounts[1],
      weatherSnowFarBandCapacity: snowPool.depthBandCounts[2],
      weatherHailNearBandCapacity: hailPool.depthBandCounts[0],
      weatherHailMidBandCapacity: hailPool.depthBandCounts[1],
      weatherHailFarBandCapacity: hailPool.depthBandCounts[2],
      weatherDustNearBandCapacity: dustPool.depthBandCounts[0],
      weatherDustMidBandCapacity: dustPool.depthBandCounts[1],
      weatherDustFarBandCapacity: dustPool.depthBandCounts[2],
      weatherPrecipitationNearHorizontalSpanM: precipitationDepthProfile.near.horizontal,
      weatherPrecipitationMidHorizontalSpanM: precipitationDepthProfile.mid.horizontal,
      weatherPrecipitationFarHorizontalSpanM: precipitationDepthProfile.far.horizontal,
      weatherPrecipitationNearVerticalSpanM: precipitationDepthProfile.near.vertical,
      weatherPrecipitationMidVerticalSpanM: precipitationDepthProfile.mid.vertical,
      weatherPrecipitationFarVerticalSpanM: precipitationDepthProfile.far.vertical,
      weatherHailCapacity: weatherCapacities.hail,
      weatherDustCapacity: weatherCapacities.dust,
      weatherRainDrawCount: 0,
      weatherRainBaseDrawCount: 0,
      weatherRainActiveLayerCount: 0,
      weatherSnowDrawCount: 0,
      weatherSnowBaseDrawCount: 0,
      weatherSnowNearDrawCount: 0,
      weatherSnowActiveLayerCount: 0,
      weatherHailDrawCount: 0,
      weatherDustDrawCount: 0,
      weatherRainMinimumLengthScale: rainStyleContract.minimumLengthScale,
      weatherRainMaximumLengthScale: rainStyleContract.maximumLengthScale,
      weatherRainMinimumBrightness: rainStyleContract.minimumBrightness,
      weatherRainMaximumBrightness: rainStyleContract.maximumBrightness,
      weatherRainMaximumAngleJitter: rainStyleContract.maximumAngleJitter,
      weatherLocalRainShelterContractVersion: LOCAL_RAIN_SHELTER_CONTRACT.version,
      weatherLocalRainShelterMode: LOCAL_RAIN_SHELTER_CONTRACT.mode,
      weatherRainShelterInnerM: LOCAL_RAIN_SHELTER_CONTRACT.innerRadiusM,
      weatherRainShelterOuterM: LOCAL_RAIN_SHELTER_CONTRACT.outerRadiusM,
      weatherRainCameraPreviewIgnored: !LOCAL_RAIN_SHELTER_CONTRACT.cameraPreviewAffectsRain,
      weatherRainLocalExposure: 1,
      weatherRainDistantExposure: 1,
      weatherSnowTextureBranchCount: 6,
      weatherExposure: 1,
      weatherSealedTunnel: false,
      weatherTunnelKind: null,
      weatherShelterAuthority: 'fresh-committed-route-frame',
      weatherMotionTimeSeconds: 0,
      weatherCameraTravelM: 0,
      weatherSnowRelativeMotionM: 0,
      weatherSnowPausedMotionM: 0,
      weatherSnowReferenceX: 0,
      weatherSnowReferenceY: 0,
      weatherSnowReferenceZ: 0,
      weatherCameraHeightAboveSurfaceM: 0,
      weatherGroundOverlapMarginM: weatherSpanY * 0.5,
      weatherCoverageViolationCount: 0,
      weatherUpdateCount: 0
    });

    function wrapWeatherCoordinate(value, span) {
      return ((value + span * 0.5) % span + span) % span - span * 0.5;
    }

    function updateRainPool(weatherState, localExposure, distantExposure, reducedMotion) {
      const intensity = clamp(Number(weatherState?.rain) || 0, 0, 1);
      const activeCount = intensity > 0.002
        ? Math.max(1, Math.ceil(weatherCapacities.rain * intensity))
        : 0;
      rainGeometry.setDrawRange(0, activeCount * 2);
      rainPool.visible = activeCount > 0;
      rainMaterial.opacity = intensity * 0.82;
      rainShelterUniforms.localExposure.value = localExposure;
      rainShelterUniforms.distantExposure.value = distantExposure;
      if (!activeCount) return 0;
      const time = Number(weatherState.motionTimeSeconds) || 0;
      const wind = Number(weatherState.wind) || 0;
      const gust = reducedMotion ? 0 : Number(weatherState.gust) || 0;
      const fallSpeed = 24 + intensity * 18;
      const baseStreakLength = 1.2 + intensity * 3.4;
      for (let index = 0; index < activeCount; index++) {
        const seedOffset = index * 4;
        const vertexOffset = index * 6;
        const styleOffset = index * 3;
        const depthBandName = PRECIPITATION_DEPTH_CONTRACT.bandNames[rainBandIds[index]];
        const depthSpan = precipitationDepthProfile[depthBandName];
        const phase = rainSeeds[seedOffset + 1];
        const streakLength = baseStreakLength * rainStyles[styleOffset];
        const angleJitter = rainStyles[styleOffset + 2];
        const lateralAngle = angleJitter * (0.035 + wind * 0.075 + gust * 0.065);
        const depthAngle = angleJitter * (0.025 + wind * 0.035 + gust * 0.055);
        const x = wrapWeatherCoordinate(
          rainSeeds[seedOffset] + time * wind * 2.8 + rainSeeds[seedOffset + 3] * gust * 4
            - weatherAnchor.worldX,
          depthSpan.horizontal
        );
        const y = wrapWeatherCoordinate(
          phase * depthSpan.vertical - time * fallSpeed - weatherAnchor.worldY,
          depthSpan.vertical
        );
        const z = wrapWeatherCoordinate(
          rainSeeds[seedOffset + 2] + time * wind * 0.62 - weatherAnchor.worldZ,
          depthSpan.horizontal
        );
        rainPositions[vertexOffset] = x;
        rainPositions[vertexOffset + 1] = y;
        rainPositions[vertexOffset + 2] = z;
        rainPositions[vertexOffset + 3] = x - streakLength * (wind * 0.22 + lateralAngle);
        rainPositions[vertexOffset + 4] = y + streakLength;
        rainPositions[vertexOffset + 5] = z - streakLength * (gust * 0.10 + depthAngle);
      }
      rainGeometry.attributes.position.needsUpdate = true;
      return activeCount;
    }

    function updateWeatherPointPool(pool, weatherState, intensityKey, kind, exposure, reducedMotion) {
      const intensity = clamp(Number(weatherState?.[intensityKey]) || 0, 0, 1);
      const activeCount = intensity > 0.002 ? Math.max(1, Math.ceil(pool.capacity * intensity)) : 0;
      const renderedCount = exposure > 0.002 ? activeCount : 0;
      pool.geometry.setDrawRange(0, renderedCount);
      pool.object.visible = renderedCount > 0;
      pool.material.opacity = intensity * exposure
        * (kind === 'dust' ? 0.52 : kind === 'snow' ? 0.88 : 0.96)
        * pool.opacityScale;
      if (!renderedCount) return 0;
      const time = Number(weatherState.motionTimeSeconds) || 0;
      const wind = Number(weatherState.wind) || 0;
      const gust = reducedMotion ? 0 : Number(weatherState.gust) || 0;
      for (let index = 0; index < renderedCount; index++) {
        const seedOffset = index * 4;
        const vertexOffset = index * 3;
        const phase = pool.seeds[seedOffset + 1];
        const drift = pool.seeds[seedOffset + 3];
        const depthBandId = pool.depthBandIds?.[index];
        const depthBandName = depthBandId === undefined
          ? null
          : PRECIPITATION_DEPTH_CONTRACT.bandNames[depthBandId];
        const depthSpan = depthBandName ? precipitationDepthProfile[depthBandName] : null;
        const horizontalSpanX = depthSpan?.horizontal || pool.spanX;
        const horizontalSpanZ = depthSpan?.horizontal || pool.spanZ;
        const verticalSpan = depthSpan?.vertical || pool.spanY;
        let x;
        let y;
        let z;
        if (kind === 'snow') {
          x = wrapWeatherCoordinate(
            pool.seeds[seedOffset] + time * wind * 0.58 * pool.windScale
              + (reducedMotion ? 0 : Math.sin(time * 0.62 + phase * Math.PI * 2)
                * (1.2 + gust * 2.8) * pool.swayScale)
              - weatherAnchor.worldX,
            horizontalSpanX
          );
          y = wrapWeatherCoordinate(
            phase * verticalSpan - time * (2.1 + intensity * 2.6) * pool.fallSpeedScale
              - weatherAnchor.worldY,
            verticalSpan
          );
          z = wrapWeatherCoordinate(
            pool.seeds[seedOffset + 2] + time * drift * 0.24 * pool.driftScale
              - weatherAnchor.worldZ,
            horizontalSpanZ
          );
        } else if (kind === 'hail') {
          x = wrapWeatherCoordinate(
            pool.seeds[seedOffset] + time * wind * 2.2 + drift * gust * 2.5 - weatherAnchor.worldX,
            horizontalSpanX
          );
          y = wrapWeatherCoordinate(
            phase * verticalSpan - time * (30 + intensity * 15) - weatherAnchor.worldY,
            verticalSpan
          );
          z = wrapWeatherCoordinate(
            pool.seeds[seedOffset + 2] + time * gust * 0.48 - weatherAnchor.worldZ,
            horizontalSpanZ
          );
        } else {
          x = wrapWeatherCoordinate(
            pool.seeds[seedOffset] + time * (5 + wind * 10) + drift * gust * 7
              - weatherAnchor.worldX,
            horizontalSpanX
          );
          // Most dust remains dense near the surface while a low-discrepancy upper fraction fills the complete
          // Top-view ray envelope. Both bands stay surface-anchored, so flight height cannot reveal a moving slab.
          const dustHeightM = phase < WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundFraction
            ? phase / WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundFraction
              * WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundHeightM
            : (phase - WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundFraction)
              / (1 - WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundFraction) * verticalSpan;
          y = weatherAnchor.surfaceWorldY - weatherAnchor.worldY
            + WEATHER_VIEW_VOLUME_CONTRACT.dustBottomOffsetM + dustHeightM
            + (reducedMotion ? 0 : Math.sin(time * 0.94 + phase * Math.PI * 4) * (1.1 + gust * 2.2));
          z = wrapWeatherCoordinate(
            pool.seeds[seedOffset + 2] + time * drift * (1.2 + gust * 2.6)
              - weatherAnchor.worldZ,
            horizontalSpanZ
          );
        }
        pool.positions[vertexOffset] = x;
        pool.positions[vertexOffset + 1] = y;
        pool.positions[vertexOffset + 2] = z;
      }
      pool.geometry.attributes.position.needsUpdate = true;
      return renderedCount;
    }

    function updateWeatherVolume(reducedMotion, renderOrigin = null, surfacePoint = null) {
      const weatherState = state.weather;
      if (!weatherState) return;
      weatherVolume.position.copy(camera.position);
      weatherAnchor.worldX = (Number(renderOrigin?.x) || 0) + camera.position.x;
      weatherAnchor.worldY = (Number(renderOrigin?.y) || 0) + camera.position.y;
      weatherAnchor.worldZ = (Number(renderOrigin?.z) || 0) + camera.position.z;
      weatherAnchor.surfaceWorldY = (Number(renderOrigin?.y) || 0) + (Number(surfacePoint?.y) || 0);
      const cameraHeightAboveSurfaceM = weatherAnchor.worldY - weatherAnchor.surfaceWorldY;
      const groundOverlapMarginM = weatherSpanY * 0.5
        - Math.max(0, cameraHeightAboveSurfaceM);
      clearanceReport.weatherCameraHeightAboveSurfaceM = cameraHeightAboveSurfaceM;
      clearanceReport.weatherGroundOverlapMarginM = groundOverlapMarginM;
      clearanceReport.weatherCoverageViolationCount = (
        cameraHeightAboveSurfaceM
          > WEATHER_VIEW_VOLUME_CONTRACT.maximumSupportedCameraHeightAboveSurfaceM + 0.001
        || groundOverlapMarginM < WEATHER_VIEW_VOLUME_CONTRACT.minimumGroundOverlapM - 0.001
        || weatherTopRayVerticalMarginM
          < WEATHER_VIEW_VOLUME_CONTRACT.minimumCameraOverheadM - 0.001
      ) ? 1 : 0;
      if (previousWeatherCameraWorldX !== null) {
        clearanceReport.weatherCameraTravelM += Math.hypot(
          weatherAnchor.worldX - previousWeatherCameraWorldX,
          weatherAnchor.worldZ - previousWeatherCameraWorldZ
        );
      }
      previousWeatherCameraWorldX = weatherAnchor.worldX;
      previousWeatherCameraWorldZ = weatherAnchor.worldZ;
      // Camera preview may prepare framing and lamps, but only the fresh committed route can shelter precipitation.
      // Open bridge shade masks the craft-local radius while the surrounding rain field remains visible.
      const rainShelter = resolveLocalRainShelter(surfacePoint, rainShelterScratch);
      const exposure = rainShelter.localExposure;
      clearanceReport.weatherSealedTunnel = rainShelter.sealedTunnel;
      clearanceReport.weatherTunnelKind = rainShelter.tunnelKind;
      clearanceReport.weatherRainLocalExposure = exposure;
      clearanceReport.weatherRainDistantExposure = rainShelter.distantExposure;
      const rainDrawCount = updateRainPool(
        weatherState,
        exposure,
        rainShelter.distantExposure,
        reducedMotion
      );
      clearanceReport.weatherRainBaseDrawCount = rainDrawCount;
      clearanceReport.weatherRainDrawCount = rainDrawCount;
      clearanceReport.weatherRainActiveLayerCount = rainDrawCount > 0 ? 1 : 0;
      const snowBaseDrawCount = updateWeatherPointPool(
        snowPool,
        weatherState,
        'snow',
        'snow',
        exposure,
        reducedMotion
      );
      const snowNearDrawCount = updateWeatherPointPool(
        snowNearPool,
        weatherState,
        'snow',
        'snow',
        exposure,
        reducedMotion
      );
      clearanceReport.weatherSnowBaseDrawCount = snowBaseDrawCount;
      clearanceReport.weatherSnowNearDrawCount = snowNearDrawCount;
      clearanceReport.weatherSnowDrawCount = snowBaseDrawCount + snowNearDrawCount;
      clearanceReport.weatherSnowActiveLayerCount = (snowBaseDrawCount > 0 && exposure > 0.002 ? 1 : 0)
        + (snowNearDrawCount > 0 && exposure > 0.002 ? 1 : 0);
      clearanceReport.weatherHailDrawCount = updateWeatherPointPool(
        hailPool,
        weatherState,
        'hail',
        'hail',
        exposure,
        reducedMotion
      );
      clearanceReport.weatherDustDrawCount = updateWeatherPointPool(
        dustPool,
        weatherState,
        'dust',
        'dust',
        exposure,
        reducedMotion
      );
      if (clearanceReport.weatherSnowDrawCount > 0) {
        const referenceX = snowPool.positions[0];
        const referenceY = snowPool.positions[1];
        const referenceZ = snowPool.positions[2];
        if (previousSnowReferenceX !== null) {
          const referenceStep = Math.hypot(
            referenceX - previousSnowReferenceX,
            referenceY - previousSnowReferenceY,
            referenceZ - previousSnowReferenceZ
          );
          if (referenceStep < Math.max(weatherSpanX, weatherSpanY, weatherSpanZ) * 0.5) {
            if (state.paused || !state.running) {
              clearanceReport.weatherSnowPausedMotionM = Math.max(
                clearanceReport.weatherSnowPausedMotionM,
                referenceStep
              );
            } else {
              clearanceReport.weatherSnowRelativeMotionM += referenceStep;
            }
          }
        }
        previousSnowReferenceX = referenceX;
        previousSnowReferenceY = referenceY;
        previousSnowReferenceZ = referenceZ;
        clearanceReport.weatherSnowReferenceX = referenceX;
        clearanceReport.weatherSnowReferenceY = referenceY;
        clearanceReport.weatherSnowReferenceZ = referenceZ;
      }
      clearanceReport.weatherExposure = exposure;
      clearanceReport.weatherMotionTimeSeconds = Number(weatherState.motionTimeSeconds) || 0;
      clearanceReport.weatherUpdateCount++;
    }

    function resolveZoneIndex(s) {
      if (forcedZone !== null) return forcedZone;
      if (typeof zoneAtS === 'function') {
        const resolved = zoneAtS(s);
        if (Number.isInteger(resolved)) return ((resolved % zones.length) + zones.length) % zones.length;
        if (Number.isInteger(resolved?.index)) return ((resolved.index % zones.length) + zones.length) % zones.length;
        const byIdentity = zones.indexOf(resolved);
        if (byIdentity >= 0) return byIdentity;
      }
      const themed = s + (Number.isFinite(state.themeOffset) ? state.themeOffset : 0);
      return ((Math.floor(themed / ZONE_LENGTH) % zones.length) + zones.length) % zones.length;
    }

    function sceneryHorizontalRadiusM(item) {
      return Number(item.userData.effectiveHorizontalRadiusM)
        || Number(item.userData.horizontalRadius)
        || 0;
    }

    /**
     * Route distance is only a broad-phase/repeat hint. Adding the measured radius keeps the complete horizontal
     * outline inside the shared 480m rear surface window instead of retiring a large root by its center point.
     */
    function sceneryRearCenterRetentionM(item) {
      return SCENERY_REAR_SURFACE_RETENTION_M + sceneryHorizontalRadiusM(item);
    }

    function sceneryMaximumForwardSurfaceM(item) {
      const maximumFarDistanceM = item.userData.placementMode === 'region-major'
        ? SCENERY_FORWARD_MAJOR_SURFACE_M
        : SCENERY_FORWARD_OTHER_SURFACE_M;
      return maximumFarDistanceM;
    }

    /**
     * Rebuild read-only camera visibility from runtime-owned matrices. A 320m six-plane volume acquires/prewarms
     * presentation before it enters the real view, while an independently retained 480m volume plus 1.8s grace
     * prevents Film orbits and cuts from dropping an acquired anchor. No camera property is written here.
     */
    function prepareCameraResidencyFrame() {
      cameraResidencyFrameReady = Boolean(
        camera?.projectionMatrix?.isMatrix4
        && camera?.position?.isVector3
        && camera?.quaternion?.isQuaternion
        && camera?.scale?.isVector3
      );
      if (!cameraResidencyFrameReady) return false;
      if (camera.matrixAutoUpdate === false && camera.matrixWorld?.isMatrix4) {
        cameraWorldMatrixScratch.copy(camera.matrixWorld);
      } else {
        // Runtime camera cuts settle position/quaternion before world presentation, but renderer matrix publication
        // may occur later in the frame. Compose a private current matrix rather than mutating camera.updateMatrixWorld().
        cameraWorldMatrixScratch.compose(camera.position, camera.quaternion, camera.scale);
        if (camera.parent?.matrixWorld?.isMatrix4) {
          cameraWorldMatrixScratch.premultiply(camera.parent.matrixWorld);
        }
      }
      cameraViewMatrixScratch.copy(cameraWorldMatrixScratch).invert();
      cameraViewProjectionScratch.multiplyMatrices(
        camera.projectionMatrix,
        cameraViewMatrixScratch
      );
      cameraVisibleFrustumScratch.setFromProjectionMatrix(cameraViewProjectionScratch);
      cameraPrewarmFrustumScratch.copy(cameraVisibleFrustumScratch);
      cameraRetentionFrustumScratch.copy(cameraVisibleFrustumScratch);
      for (const plane of cameraPrewarmFrustumScratch.planes) {
        plane.constant += CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M;
      }
      for (const plane of cameraRetentionFrustumScratch.planes) {
        plane.constant += CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M;
      }
      cameraRenderPositionScratch.setFromMatrixPosition(cameraWorldMatrixScratch);
      return true;
    }

    /** Resolve one preallocated root record against the actual camera without changing its world anchor. */
    function measureCameraRelevance(
      record,
      anchor,
      renderX,
      renderZ,
      horizontalRadiusM,
      nowMs,
      previousCameraRelevant = record.cameraRelevant,
      previousCameraAnchor = record.cameraAnchor
    ) {
      const localMinY = Number(record.item?.userData?.localMinY
        ?? record.metrics?.localMinY
        ?? record.activeRoot?.userData?.localMinY) || 0;
      const localMaxY = Number(record.item?.userData?.localMaxY
        ?? record.metrics?.localMaxY
        ?? record.activeRoot?.userData?.localMaxY) || 0;
      const motionEnvelopeM = Math.max(0, Number(record.item?.userData?.motionEnvelopeM
        ?? record.metrics?.motionEnvelopeM
        ?? record.activeRoot?.userData?.motionEnvelopeM) || 0);
      const centerY = anchor.y + (localMinY + localMaxY) * 0.5;
      const verticalHalfM = Math.abs(localMaxY - localMinY) * 0.5 + motionEnvelopeM;
      const sphereRadiusM = Math.hypot(Math.max(0, horizontalRadiusM), verticalHalfM);
      const sphere = cameraResidencySphereScratch;
      sphere.center.set(renderX, centerY, renderZ);
      sphere.radius = sphereRadiusM;
      record.cameraSurfaceDistanceM = Math.max(
        0,
        sphere.center.distanceTo(cameraRenderPositionScratch) - sphereRadiusM
      );
      record.cameraVisible = cameraResidencyFrameReady
        && cameraVisibleFrustumScratch.intersectsSphere(sphere);
      const sameRetainedAnchor = previousCameraRelevant && previousCameraAnchor === anchor;
      const insidePrewarmFrustum = cameraResidencyFrameReady
        && cameraPrewarmFrustumScratch.intersectsSphere(sphere);
      const insideRetentionFrustum = cameraResidencyFrameReady
        && cameraRetentionFrustumScratch.intersectsSphere(sphere);
      if (insidePrewarmFrustum || (sameRetainedAnchor && insideRetentionFrustum)) {
        record.cameraGraceUntilMs = Math.max(
          Number(record.cameraGraceUntilMs) || Number.NEGATIVE_INFINITY,
          nowMs + CAMERA_RELEVANCE_MINIMUM_GRACE_MS
        );
      }
      const insideTemporalGrace = sameRetainedAnchor
        && nowMs <= (Number(record.cameraGraceUntilMs) || Number.NEGATIVE_INFINITY);
      record.cameraRelevant = insidePrewarmFrustum || (
        cameraResidencyFrameReady
        && sameRetainedAnchor
        && insideRetentionFrustum
      ) || insideTemporalGrace;
      record.cameraAnchor = anchor;
      return record.cameraRelevant;
    }

    /** Fade major detail with one 260m entry / 340m exit hysteresis contract for both ship and Film camera. */
    function updateRegionDetailPresentation(item, candidate, nowMs) {
      const nearestSurfaceM = Math.min(
        candidate.surfaceDistanceM,
        candidate.cameraSurfaceDistanceM
      );
      let engaged = Boolean(item.userData.regionDetailEngaged);
      if (engaged) {
        if (nearestSurfaceM > REGION_DETAIL_EXIT_M) engaged = false;
      } else if (nearestSurfaceM <= REGION_DETAIL_ENTER_M) {
        engaged = true;
      }
      const previousNowMs = Number(item.userData.regionDetailLastUpdateMs);
      const deltaSeconds = Number.isFinite(previousNowMs)
        ? clamp((nowMs - previousNowMs) * 0.001, 0, 0.25)
        : 1 / 60;
      const previousFade = clamp(Number(item.userData.regionDetailFade) || 0, 0, 1);
      const fadeStep = deltaSeconds / REGION_DETAIL_FADE_SECONDS;
      const nextFade = engaged
        ? Math.min(1, previousFade + fadeStep)
        : Math.max(0, previousFade - fadeStep);
      item.userData.regionDetailEngaged = engaged;
      item.userData.regionDetailFade = nextFade;
      item.userData.regionDetailLastUpdateMs = nowMs;
      if (nextFade > 0.000_1 && nextFade < 0.999_9) {
        clearanceReport.regionDetailFadingRoots++;
      }
      item.traverse((child) => {
        if (!child.isMesh || child.userData.regionVisibilityBand !== REGION_DETAIL_VISIBILITY_BAND) return;
        const baseOpacity = Number(child.userData.regionDetailBaseOpacity) || 1;
        child.material.opacity = baseOpacity * nextFade;
        child.visible = nextFade > 0.000_1;
      });
      return nextFade;
    }

    /** Measure the actual root surface around the ship after the committed anchor enters render space. */
    function measureSceneryCandidate(candidate, anchor, graphOrigin, currentCenter) {
      const originX = anchor.graphSpace && graphOrigin ? graphOrigin.x : currentCenter;
      const originZ = anchor.graphSpace && graphOrigin ? graphOrigin.z : -state.distance;
      candidate.renderX = anchor.x - originX;
      candidate.renderZ = anchor.z - originZ;
      candidate.surfaceDistanceM = Math.max(
        0,
        Math.hypot(candidate.renderX, candidate.renderZ)
          - sceneryHorizontalRadiusM(candidate.item)
      );
      return candidate.surfaceDistanceM;
    }

    /**
     * Same-side spacing is dynamic presentation arbitration: the real camera-visible root wins first, followed by
     * camera surface distance and then player surface distance. Static road/air validity remains independently cached.
     */
    function compareSceneryCandidates(left, right) {
      if (left.active !== right.active) return left.active ? -1 : 1;
      if (left.cameraVisible !== right.cameraVisible) return left.cameraVisible ? -1 : 1;
      const cameraDistanceDifference = left.cameraSurfaceDistanceM - right.cameraSurfaceDistanceM;
      if (Math.abs(cameraDistanceDifference) > 0.000_1) return cameraDistanceDifference;
      const distanceDifference = left.surfaceDistanceM - right.surfaceDistanceM;
      if (Math.abs(distanceDifference) > 0.000_1) return distanceDifference;
      const priorityDifference = (Number(right.item.userData.mapPriority) || 0)
        - (Number(left.item.userData.mapPriority) || 0);
      return priorityDifference || left.stableIndex - right.stableIndex;
    }

    /**
     * Resolve classified extensions against the current absolute realm window. Major landmarks use only their
     * frozen station; environment and ambient roots alone may enter the 560m motif cadence.
     */
    function classifiedSceneryPlacementFor(item, out) {
      const themeOffset = Number.isFinite(state.themeOffset) ? state.themeOffset : 0;
      const themedPlayer = state.distance + themeOffset;
      const absoluteRealmIndex = Math.floor(themedPlayer / ZONE_LENGTH);
      const currentRealmStart = absoluteRealmIndex * ZONE_LENGTH;
      const activeRealmIndex = forcedZone === null
        ? ((absoluteRealmIndex % zones.length) + zones.length) % zones.length
        : forcedZone;
      const visualZone = item.userData.visualZone;
      out.eligible = false;
      out.transitionPreview = false;
      out.repeat = 'classified-hidden';
      out.s = state.distance + 1_000_000;

      if (item.userData.placementMode === 'region-major') {
        if (visualZone !== activeRealmIndex) return out;
        const stationM = Number(item.userData.offset);
        if (!REGION_MAJOR_STATIONS_M.includes(stationM)) {
          throw new RangeError(`Region major ${item.name} has an unauthorized station.`);
        }
        out.eligible = true;
        out.repeat = `major:${absoluteRealmIndex}:${stationM}`;
        out.s = currentRealmStart + stationM - themeOffset;
        return out;
      }

      if (visualZone === activeRealmIndex) {
        const motifOffset = ((Number(item.userData.offset) || 0) % SCENERY_MOTIF_LENGTH
          + SCENERY_MOTIF_LENGTH) % SCENERY_MOTIF_LENGTH;
        let motifRepeat = Math.max(0, Math.ceil(
          (themedPlayer - currentRealmStart - motifOffset) / SCENERY_MOTIF_LENGTH
        ));
        const themedS = currentRealmStart + motifOffset + motifRepeat * SCENERY_MOTIF_LENGTH;
        if (themedS < currentRealmStart + ZONE_LENGTH - TRANSITION_LENGTH) {
          out.eligible = true;
          out.repeat = `classified:${absoluteRealmIndex}:motif:${motifRepeat}`;
          out.s = themedS - themeOffset;
          return out;
        }
      }

      const nextZone = (activeRealmIndex + 1) % zones.length;
      if (forcedZone === null
        && item.userData.placementMode === 'region-environment'
        && item.userData.transitionEligible === true
        && visualZone === nextZone) {
        const previewSlot = Number(item.userData.slot) % REALM_TRANSITION_SEGMENT_COUNT;
        const previewOffset = REALM_TRANSITION_PREVIEW_CENTER_OFFSETS_M[previewSlot];
        out.eligible = true;
        out.transitionPreview = true;
        out.repeat = `classified-transition:${absoluteRealmIndex}:${previewOffset}`;
        out.s = currentRealmStart + ZONE_LENGTH - TRANSITION_LENGTH + previewOffset - themeOffset;
      }
      return out;
    }

    /** Recycle one authored scenery motif within its matching long realm without leaking it into adjacent biomes. */
    function thematicPlacementFor(item, out) {
      if (item.userData.placementMode === 'region-major'
        || item.userData.placementMode === 'region-environment'
        || item.userData.placementMode === 'ambient-environment') {
        return classifiedSceneryPlacementFor(item, out);
      }
      const themeOffset = Number.isFinite(state.themeOffset) ? state.themeOffset : 0;
      const themedPlayer = state.distance + themeOffset;
      const offset = Number(item.userData.offset) || 0;
      const motifOffset = ((offset % SCENERY_MOTIF_LENGTH) + SCENERY_MOTIF_LENGTH)
        % SCENERY_MOTIF_LENGTH;

      if (forcedZone !== null && !item.userData.transitionPreview) {
        let motifRepeat = Math.floor(
          (themedPlayer - motifOffset) / SCENERY_MOTIF_LENGTH
        );
        let themedS = motifOffset + motifRepeat * SCENERY_MOTIF_LENGTH;
        if (themedS < themedPlayer) {
          themedS += SCENERY_MOTIF_LENGTH;
          motifRepeat += 1;
        }
        out.repeat = `forced:${motifRepeat}`;
        out.s = themedS - themeOffset;
        out.eligible = true;
        out.transitionPreview = false;
        return out;
      }

      const cycle = ZONE_LENGTH * zones.length;
      const baseZoneStart = item.userData.anchorZone * ZONE_LENGTH;
      let realmRepeat = Math.floor((themedPlayer - baseZoneStart) / cycle);
      let realmStart = baseZoneStart + realmRepeat * cycle;

      if (item.userData.transitionPreview) {
        let themedS = realmStart + offset;
        if (themedS < themedPlayer) {
          realmRepeat += 1;
          realmStart += cycle;
          themedS = realmStart + offset;
        }
        out.repeat = `transition:${realmRepeat}`;
        out.s = themedS - themeOffset;
        out.eligible = true;
        out.transitionPreview = true;
        return out;
      }

      let motifRepeat = Math.max(0, Math.ceil(
        (themedPlayer - realmStart - motifOffset) / SCENERY_MOTIF_LENGTH
      ));
      let themedS = realmStart + motifOffset + motifRepeat * SCENERY_MOTIF_LENGTH;
      const stableRealmEnd = realmStart + ZONE_LENGTH - TRANSITION_LENGTH;
      if (themedS >= stableRealmEnd) {
        realmRepeat += 1;
        realmStart += cycle;
        motifRepeat = 0;
        themedS = realmStart + motifOffset;
      }
      out.repeat = `realm:${realmRepeat}:motif:${motifRepeat}`;
      out.s = themedS - themeOffset;
      out.eligible = true;
      out.transitionPreview = false;
      return out;
    }

    /** Sample the exact rendered terrain authority; invalid output is a placement failure, never a road-height fallback. */
    function sampleRenderedTerrainHeight(worldX, worldZ) {
      const terrainY = Number(sampleTerrainHeight(worldX, worldZ));
      if (!Number.isFinite(terrainY)) {
        throw new RangeError(
          `V23 terrain height authority returned a non-finite value at ${worldX}, ${worldZ}.`
        );
      }
      clearanceReport.terrainHeightSamples++;
      return terrainY;
    }

    /** Normalize either graph sampler into X/Z/yaw; rendered terrain exclusively owns the vertical pose. */
    function sampleAbsoluteSceneryAnchor(s, lateral, out) {
      let frame = null;
      let lateralAlreadyApplied = false;
      if (typeof sampleCommittedWorldFrameAtDistance === 'function') {
        frame = sampleCommittedWorldFrameAtDistance(s, lateral, graphFrameScratch);
        lateralAlreadyApplied = true;
        // A configured committed sampler returning null means route state is not ready; anchoring to its legacy fallback would be permanent.
        if (!frame) return null;
      } else if (typeof sampleWorldFrameAtDistance === 'function') {
        frame = sampleWorldFrameAtDistance(s, graphFrameScratch);
      }

      if (frame) {
        const rightX = Number.isFinite(frame.rightX) ? frame.rightX : 1;
        const rightY = Number.isFinite(frame.rightY) ? frame.rightY : 0;
        const rightZ = Number.isFinite(frame.rightZ) ? frame.rightZ : 0;
        out.x = (Number(frame.x) || 0) + (lateralAlreadyApplied ? 0 : rightX * lateral);
        out.z = (Number(frame.z) || 0) + (lateralAlreadyApplied ? 0 : rightZ * lateral);
        out.terrainY = sampleRenderedTerrainHeight(out.x, out.z);
        out.y = out.terrainY;
        out.rightX = rightX;
        out.rightY = rightY;
        out.rightZ = rightZ;
        out.tangentX = Number.isFinite(frame.tangentX) ? frame.tangentX : -rightZ;
        out.tangentY = Number.isFinite(frame.tangentY) ? frame.tangentY : 0;
        out.tangentZ = Number.isFinite(frame.tangentZ) ? frame.tangentZ : rightX;
        out.yaw = Number.isFinite(frame.yaw) ? frame.yaw : Math.atan2(-out.tangentX, -out.tangentZ);
        out.graphSpace = true;
        out.sealedTunnel = Boolean(isSealedTunnelFrame(frame));
        out.tunnelKind = frame.tunnelKind || null;
        return out;
      }

      const slope = roadSlopeAt(s);
      const inverseTangentLength = 1 / Math.hypot(1, slope);
      const rightX = inverseTangentLength;
      const rightZ = slope * inverseTangentLength;
      out.x = roadCenterAt(s) + rightX * lateral;
      out.z = -s + rightZ * lateral;
      out.terrainY = sampleRenderedTerrainHeight(out.x, out.z);
      out.y = out.terrainY;
      out.rightX = rightX;
      out.rightY = 0;
      out.rightZ = rightZ;
      out.tangentX = -rightZ;
      out.tangentY = 0;
      out.tangentZ = rightX;
      out.yaw = -Math.atan(slope);
      out.graphSpace = false;
      out.sealedTunnel = false;
      out.tunnelKind = null;
      return out;
    }

    function sceneryPeerClearance(item, candidate, lateral) {
      const radiusM = Number(item.userData.effectiveHorizontalRadiusM)
        || Number(item.userData.horizontalRadius)
        || 0;
      const requiredGapM = Number(item.userData.sameSidePeerGapM) || 0;
      let minimumGapM = Number.POSITIVE_INFINITY;
      for (const peer of acceptedSceneryPeers) {
        if (peer.lateral * lateral <= 0) continue;
        const requiredPairGapM = Math.max(requiredGapM, peer.requiredGapM);
        if (requiredPairGapM <= 0) continue;
        const edgeGapM = Math.hypot(candidate.x - peer.x, candidate.z - peer.z)
          - radiusM - peer.radiusM;
        minimumGapM = Math.min(minimumGapM, edgeGapM);
        if (edgeGapM < requiredPairGapM - 0.000_1) {
          return { clear: false, minimumGapM: edgeGapM };
        }
      }
      return { clear: true, minimumGapM };
    }

    function acceptSceneryPeer(item, anchor) {
      const peerCheck = sceneryPeerClearance(item, anchor, anchor.lateral);
      if (!peerCheck.clear) {
        clearanceReport.sceneryPeerClearanceViolations++;
        return false;
      }
      if (Number.isFinite(peerCheck.minimumGapM)) {
        clearanceReport.sceneryPeerMinimumGapM = Math.min(
          clearanceReport.sceneryPeerMinimumGapM,
          peerCheck.minimumGapM
        );
      }
      acceptedSceneryPeers.push({
        x: anchor.x,
        z: anchor.z,
        lateral: anchor.lateral,
        radiusM: Number(item.userData.effectiveHorizontalRadiusM)
          || Number(item.userData.horizontalRadius)
          || 0,
        requiredGapM: Number(item.userData.sameSidePeerGapM) || 0
      });
      return true;
    }

    /** Resolve one root's exact Y from its explicit terrain-contact semantic and complete visible local bounds. */
    function sceneryRootYForTerrain(item, terrainY) {
      const mode = item.userData.terrainContactMode;
      if (mode === SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode) {
        return terrainY - Number(item.userData.localMinY);
      }
      if (mode === SCENERY_TERRAIN_CONTACT_CONTRACT.instancedGroundMode) return terrainY;
      if (mode === SCENERY_TERRAIN_CONTACT_CONTRACT.designedAirborneMode) {
        return Math.max(terrainY, maximumDeckHeight)
          + Number(item.userData.designedAirborneClearanceM || REGION_AIR_DECK_CLEARANCE_M)
          + Number(item.userData.motionEnvelopeM || 0)
          - Number(item.userData.localMinY);
      }
      throw new RangeError(`Scenery root ${item.name} has no explicit terrain-contact semantic.`);
    }

    function cacheSceneryAnchor(item, s, repeat, epoch) {
      // A repeated slot is only rebound once it is in front of the player; the committed sampler intentionally rejects negative travel.
      if (s < state.distance - 0.000_1) return false;
      const authoredLateral = Number.isFinite(item.userData.authoredLateral)
        ? item.userData.authoredLateral
        : item.userData.lateral;
      const side = authoredLateral < 0 ? -1 : 1;
      let centerDistance = Math.abs(authoredLateral);
      let candidate = null;
      let candidateLateral = authoredLateral;
      let query = null;
      let clear = false;
      const requiredRoadGapM = Number(item.userData.requiredRoadGapM) || groundSceneryGap;
      const effectiveHorizontalRadiusM = Number(item.userData.effectiveHorizontalRadiusM)
        || Number(item.userData.horizontalRadius)
        || 0;
      for (let attempt = 0; attempt < SCENERY_OUTWARD_SEARCH_ATTEMPTS; attempt++) {
        const lateral = side * centerDistance;
        candidateLateral = lateral;
        candidate = sampleAbsoluteSceneryAnchor(s, lateral, graphFrameScratch);
        if (!candidate) return false;
        query = roadClearanceQuery({
          s,
          lateral,
          horizontalRadius: effectiveHorizontalRadiusM,
          minimumGap: requiredRoadGapM
        });
        clearanceReport.roadCapsuleQueries++;
        const roadClear = typeof query === 'boolean' ? query : Boolean(query?.clear);
        const proposedRootY = sceneryRootYForTerrain(item, candidate.terrainY);
        const airLowerEdgeM = proposedRootY
          + Number(item.userData.localMinY || 0)
          - Number(item.userData.motionEnvelopeM || 0);
        const airClear = item.userData.terrainContactMode
            !== SCENERY_TERRAIN_CONTACT_CONTRACT.designedAirborneMode
          || airLowerEdgeM >= maximumDeckHeight + REGION_AIR_DECK_CLEARANCE_M - 0.000_1;
        clear = roadClear && airClear;
        if (clear) break;
        centerDistance += SCENERY_OUTWARD_SEARCH_STEP_M;
      }

      const key = `${epoch}:${repeat}`;
      const lateral = candidateLateral;
      const resolvedBaseY = sceneryRootYForTerrain(item, candidate.terrainY);
      if (item.userData.terrainContactMode
        === SCENERY_TERRAIN_CONTACT_CONTRACT.instancedGroundMode) {
        alignAmbientCandleTerrainContact(
          item,
          candidate.x,
          candidate.z,
          resolvedBaseY,
          candidate.yaw + Number(item.userData.baseYaw || 0)
        );
      }
      const contactErrorM = item.userData.terrainContactMode
          === SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode
        ? Math.abs(resolvedBaseY + Number(item.userData.localMinY) - candidate.terrainY)
        : Number(item.userData.terrainContactMaximumErrorM) || 0;
      item.userData.terrainContactTerrainY = candidate.terrainY;
      item.userData.terrainContactErrorM = contactErrorM;
      clearanceReport.terrainMaximumContactErrorM = Math.max(
        clearanceReport.terrainMaximumContactErrorM,
        contactErrorM
      );
      if (item.userData.terrainContactMode
        === SCENERY_TERRAIN_CONTACT_CONTRACT.designedAirborneMode) {
        clearanceReport.terrainDesignedAirborneRootBindings++;
      } else {
        clearanceReport.terrainGroundedRootBindings++;
      }
      const clearance = Number.isFinite(query?.clearance)
        ? query.clearance + requiredRoadGapM
        : clear ? requiredRoadGapM : Number.NEGATIVE_INFINITY;
      const previousAnchorKey = item.userData.worldAnchorKey;
      item.userData.worldAnchorKey = key;
      item.userData.worldAnchor = Object.freeze({
        key,
        epoch,
        repeat,
        s,
        x: candidate.x,
        y: resolvedBaseY,
        z: candidate.z,
        surfaceY: candidate.terrainY,
        terrainY: candidate.terrainY,
        terrainContactMode: item.userData.terrainContactMode,
        rightX: candidate.rightX,
        rightY: candidate.rightY,
        rightZ: candidate.rightZ,
        tangentX: candidate.tangentX,
        tangentY: candidate.tangentY,
        tangentZ: candidate.tangentZ,
        yaw: candidate.yaw,
        lateral,
        graphSpace: candidate.graphSpace,
        clear,
        clearance
      });
      item.userData.lateral = lateral;
      item.userData.groundClearance = clearance;
      if (item.userData.placementMode === 'region-major' && previousAnchorKey !== key) {
        item.userData.regionDetailEngaged = false;
        item.userData.regionDetailFade = 0;
        item.userData.regionDetailLastUpdateMs = null;
      }
      clearanceReport.sceneryAnchorRefreshes++;
      if (clear) {
        clearanceReport.sceneryAnchorMinRoadGap = Math.min(
          clearanceReport.sceneryAnchorMinRoadGap,
          clearance
        );
        if (clearance < clearanceReport.groundSceneryMinClearance) {
          clearanceReport.groundSceneryMinClearance = clearance;
          clearanceReport.groundSceneryClosestFamily = item.userData.zoneFamily || item.name || 'unknown';
        }
        if (item.userData.placementMode === 'ambient-environment') {
          clearanceReport.ambientCandlelightMinimumRoadGapM = Math.min(
            clearanceReport.ambientCandlelightMinimumRoadGapM,
            clearance
          );
        }
      } else {
        // Only structural road/deck failure stays cached. Dynamic peer state is never read by this function.
        clearanceReport.sceneryAnchorRejectedWindows++;
      }
      return true;
    }

    function releaseCreatureSlot(slot) {
      const root = slot.activeRoot;
      if (!root) return false;
      updateMapEntity(root, false, 0, 0, 0, 0, sceneryAnchorEpoch);
      root.visible = false;
      creatureSlotByRoot.delete(root);
      activeCreatureSlots.delete(slot);
      creatureFactory.release(root);
      slot.activeRoot = null;
      slot.s = Number.NaN;
      slot.lateral = 0;
      slot.anchor = null;
      slot.transitionPreview = null;
      slot.cameraVisible = false;
      slot.cameraRelevant = false;
      slot.cameraAnchor = null;
      slot.cameraGraceUntilMs = Number.NEGATIVE_INFINITY;
      slot.cameraSurfaceDistanceM = Number.POSITIVE_INFINITY;
      return true;
    }

    function creatureSpacingM(candidate, scaleClass) {
      let minimumM = 1_000_000;
      for (const slot of activeCreatureSlots) {
        if (slot.definition.scaleClass !== scaleClass || !slot.anchor) continue;
        minimumM = Math.min(
          minimumM,
          Math.hypot(candidate.x - slot.anchor.x, candidate.z - slot.anchor.z)
        );
      }
      return minimumM;
    }

    /**
     * Resolve one lazy creature placement from a successful committed sample. The returned proof contains every
     * explicit boolean and numeric certificate consumed by the visual factory; no catalog or root can infer it.
     */
    function resolveCreatureCandidate(slot, activeZoneIndex, velocityMps) {
      const { definition, metrics } = slot;
      const targetZoneIndex = Creatures.REALM_IDS.indexOf(definition.realmId);
      const themeOffset = Number.isFinite(state.themeOffset) ? state.themeOffset : 0;
      const themedPlayer = state.distance + themeOffset;
      const absoluteRealmIndex = Math.floor(themedPlayer / ZONE_LENGTH);
      const realmStartM = absoluteRealmIndex * ZONE_LENGTH;
      const realmEndM = realmStartM + ZONE_LENGTH;
      const nextZoneIndex = (activeZoneIndex + 1) % zones.length;
      const requiredForwardM = Math.max(
        CREATURE_MINIMUM_FORWARD_M,
        CREATURE_FORWARD_SECONDS * velocityMps
      );
      const spawnMinimumM = Math.max(CREATURE_SPAWN_MINIMUM_M, requiredForwardM);
      let themedS = Number.NaN;
      let transitionPreview = null;
      if (targetZoneIndex === activeZoneIndex) {
        const phaseM = (
          slot.familyOrdinal * 3 + slot.instanceIndex
        ) * 73 % Math.max(1, CREATURE_SPAWN_MAXIMUM_M - spawnMinimumM);
        themedS = themedPlayer + spawnMinimumM + phaseM;
        if (themedS >= realmEndM - TRANSITION_LENGTH) return null;
      } else if (targetZoneIndex === nextZoneIndex
        && definition.scaleClass === 'small-cluster'
        && definition.transitionPolicy === CREATURE_ADJACENT_PREVIEW_POLICY) {
        const previewSlot = slot.instanceIndex % REALM_TRANSITION_SEGMENT_COUNT;
        const distanceFromBoundaryM = CREATURE_ADJACENT_PREVIEW_BOUNDARY_OFFSETS_M[previewSlot];
        themedS = realmEndM - distanceFromBoundaryM;
        transitionPreview = {
          fromRealmId: zones[activeZoneIndex].id,
          distanceFromBoundaryM
        };
      } else {
        return null;
      }

      const s = themedS - themeOffset;
      const forwardClearanceM = s - state.distance;
      if (forwardClearanceM < requiredForwardM
        || forwardClearanceM < CREATURE_SPAWN_MINIMUM_M
        || forwardClearanceM > CREATURE_SPAWN_MAXIMUM_M) {
        return null;
      }

      const side = (targetZoneIndex + slot.familyOrdinal + slot.instanceIndex) % 2 === 0 ? -1 : 1;
      const effectiveRadiusM = metrics.horizontalRadiusM + metrics.motionEnvelopeM;
      let centerDistanceM = definition.sceneLayer === 'roadside'
        ? groundSceneryExclusionHalfWidth + Math.max(0, branchSeparation)
          + effectiveRadiusM + CREATURE_ROAD_GAP_M + 10
        : 20 + slot.familyOrdinal * 6 + slot.instanceIndex * 4;
      let sampled = null;
      let query = null;
      let roadClear = definition.sceneLayer !== 'roadside';
      const attemptCount = definition.sceneLayer === 'roadside'
        ? SCENERY_OUTWARD_SEARCH_ATTEMPTS
        : 1;
      for (let attempt = 0; attempt < attemptCount; attempt++) {
        const lateral = side * centerDistanceM;
        sampled = sampleAbsoluteSceneryAnchor(s, lateral, graphFrameScratch);
        if (!sampled) {
          clearanceReport.creatureProofDeferrals++;
          return null;
        }
        if (sampled.sealedTunnel) {
          clearanceReport.creaturePlacementRejects++;
          return null;
        }
        if (definition.sceneLayer === 'roadside') {
          query = roadClearanceQuery({
            s,
            lateral,
            horizontalRadius: effectiveRadiusM,
            minimumGap: CREATURE_ROAD_GAP_M
          });
          clearanceReport.roadCapsuleQueries++;
          roadClear = typeof query === 'boolean' ? query : Boolean(query?.clear);
        }
        if (roadClear) break;
        centerDistanceM += SCENERY_OUTWARD_SEARCH_STEP_M;
      }
      if (!sampled || !roadClear) {
        clearanceReport.creaturePlacementRejects++;
        return null;
      }

      const lateral = side * centerDistanceM;
      const baseY = definition.sceneLayer === 'air'
        ? Math.max(sampled.terrainY, maximumDeckHeight)
          + CREATURE_DECK_CLEARANCE_M + 0.001 + metrics.motionEnvelopeM - metrics.localMinY
        : sampled.terrainY - metrics.localMinY;
      const completeLowerEdgeM = baseY + metrics.localMinY - metrics.motionEnvelopeM;
      const completeHorizontalRoadCapsuleGapM = Number.isFinite(query?.clearance)
        ? query.clearance + CREATURE_ROAD_GAP_M
        : definition.sceneLayer === 'roadside'
          ? CREATURE_ROAD_GAP_M
          : 1_000_000;
      const anchor = Object.freeze({
        s,
        x: sampled.x,
        y: baseY,
        z: sampled.z,
        yaw: sampled.yaw,
        lateral,
        terrainY: sampled.terrainY,
        terrainContactMode: definition.sceneLayer === 'air'
          ? SCENERY_TERRAIN_CONTACT_CONTRACT.designedAirborneMode
          : SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode,
        graphSpace: sampled.graphSpace,
        sealedTunnel: false
      });
      const centerSpacingM = creatureSpacingM(anchor, 'large');
      const clusterSpacingM = creatureSpacingM(anchor, 'small-cluster');
      if (definition.scaleClass === 'large' && centerSpacingM < CREATURE_LARGE_SPACING_M) {
        clearanceReport.creaturePlacementRejects++;
        return null;
      }
      if (definition.scaleClass === 'small-cluster'
        && clusterSpacingM < CREATURE_CLUSTER_SPACING_M) {
        clearanceReport.creaturePlacementRejects++;
        return null;
      }
      const bearingDegrees = Math.atan2(lateral, forwardClearanceM) * 180 / Math.PI;
      const highContrastLowAltitude = definition.sceneLayer === 'roadside';
      return {
        anchor,
        transitionPreview,
        placement: {
          authority: 'complete-road-capsule-query',
          realmId: definition.realmId,
          sealedTunnel: false,
          crossesRoad: definition.sceneLayer === 'air',
          completeLowerEdgeM,
          maximumDeckHeightM: maximumDeckHeight,
          completeHorizontalRoadCapsuleGapM,
          centerSpacingM,
          clusterSpacingM,
          velocityMps,
          forwardClearanceM,
          highContrastLowAltitude,
          bearingDegrees
        }
      };
    }

    function acquireCreatureSlot(slot, activeZoneIndex, velocityMps) {
      const visibleCap = Creatures.CREATURE_VISUAL_CONTRACT
        .qualityBudgets[creatureRenderQualityId].maximumVisibleRootsPerRealm;
      const visibleInRealm = [...activeCreatureSlots].reduce((count, activeSlot) => (
        count + (
          activeSlot.definition.realmId === slot.definition.realmId
          && activeSlot.activeRoot?.visible ? 1 : 0
        )
      ), 0);
      if (visibleInRealm >= visibleCap) return false;
      const candidate = resolveCreatureCandidate(slot, activeZoneIndex, velocityMps);
      if (!candidate) return false;
      const definition = slot.definition;
      const root = creatureFactory.acquire({
        realmId: definition.realmId,
        familyId: definition.id,
        seed: `${sceneryAnchorEpoch}:${slot.instanceIndex}:${Math.round(candidate.anchor.s)}`,
        zoneIndex: Creatures.REALM_IDS.indexOf(definition.realmId),
        transitionPreview: candidate.transitionPreview,
        placement: candidate.placement
      });
      if (!root) return false;
      slot.activeRoot = root;
      slot.s = candidate.anchor.s;
      slot.lateral = candidate.anchor.lateral;
      slot.anchor = candidate.anchor;
      slot.transitionPreview = candidate.transitionPreview;
      creatureSlotByRoot.set(root, slot);
      activeCreatureSlots.add(slot);
      root.visible = true;
      if (definition.sceneLayer === 'roadside') {
        clearanceReport.creatureMinimumRoadGapM = Math.min(
          clearanceReport.creatureMinimumRoadGapM,
          candidate.placement.completeHorizontalRoadCapsuleGapM
        );
      } else {
        clearanceReport.creatureMinimumDeckClearanceM = Math.min(
          clearanceReport.creatureMinimumDeckClearanceM,
          candidate.placement.completeLowerEdgeM - maximumDeckHeight
        );
      }
      if (definition.scaleClass === 'large') {
        clearanceReport.creatureMinimumLargeSpacingM = Math.min(
          clearanceReport.creatureMinimumLargeSpacingM,
          candidate.placement.centerSpacingM
        );
      }
      if (definition.scaleClass === 'small-cluster') {
        clearanceReport.creatureMinimumClusterSpacingM = Math.min(
          clearanceReport.creatureMinimumClusterSpacingM,
          candidate.placement.clusterSpacingM
        );
      }
      clearanceReport.creatureMinimumForwardReadM = Math.min(
        clearanceReport.creatureMinimumForwardReadM,
        candidate.placement.forwardClearanceM
      );
      return true;
    }

    /** Commit one active creature's render-space pose and matching map record in the same frame it is acquired. */
    function presentCreatureSlot(slot, now, reducedMotion, graphOrigin, currentCenter) {
      const root = slot.activeRoot;
      const anchor = slot.anchor;
      if (!root || !anchor) return false;
      const originX = anchor.graphSpace && graphOrigin ? graphOrigin.x : currentCenter;
      const originZ = anchor.graphSpace && graphOrigin ? graphOrigin.z : -state.distance;
      root.position.set(anchor.x - originX, anchor.y, anchor.z - originZ);
      root.rotation.set(0, anchor.yaw, 0);
      root.userData.terrainContactTerrainY = anchor.terrainY;
      root.userData.terrainContactErrorM = root.userData.terrainContactMode
          === SCENERY_TERRAIN_CONTACT_CONTRACT.groundedRootMode
        ? Math.abs(anchor.y + Number(root.userData.localMinY) - anchor.terrainY)
        : 0;
      creatureFactory.update(root, {
        timeSeconds: Math.max(0, Number(now) || 0) * 0.001,
        reducedMotion,
        paused: Boolean(state.paused || !state.running)
      });
      updateMapEntity(
        root,
        root.visible,
        anchor.x,
        anchor.y,
        anchor.z,
        anchor.yaw,
        sceneryAnchorEpoch
      );
      return true;
    }

    /**
     * Keep root placement and map pose in world ownership. CreatureFactory.update receives only presentation time
     * and motion preferences, so it can animate motionPivot without altering the certified root transform.
     */
    function updateCreatures(now, reducedMotion, activeZoneIndex, graphOrigin, currentCenter, currentFrame) {
      const velocityMps = Number.isFinite(state.speed) ? Math.max(0, state.speed) : 0;
      // Missing current committed evidence fails closed exactly like a sealed tunnel; no cached creature stays visible.
      const currentSealedTunnel = !currentFrame || Boolean(isSealedTunnelFrame(currentFrame));
      for (const slot of [...activeCreatureSlots]) {
        const root = slot.activeRoot;
        const aheadM = slot.s - state.distance;
        const anchor = slot.anchor;
        const originX = anchor.graphSpace && graphOrigin ? graphOrigin.x : currentCenter;
        const originZ = anchor.graphSpace && graphOrigin ? graphOrigin.z : -state.distance;
        const renderX = anchor.x - originX;
        const renderZ = anchor.z - originZ;
        const completeSurfaceDistanceM = Math.max(
          0,
          Math.hypot(renderX, renderZ)
            - slot.metrics.horizontalRadiusM
            - slot.metrics.motionEnvelopeM
        );
        measureCameraRelevance(
          slot,
          anchor,
          renderX,
          renderZ,
          slot.metrics.horizontalRadiusM + slot.metrics.motionEnvelopeM,
          now
        );
        // Forward readability is an acquisition certificate, never a lifetime threshold. Once acquired, the exact
        // root and anchor survive passage until both the player rear bound and the read-only camera residency release.
        const completeBoundsRetired = aheadM < 0
          && completeSurfaceDistanceM
            > CREATURE_REAR_SURFACE_RETENTION_M + CREATURE_REAR_CAMERA_MARGIN_M;
        if (currentSealedTunnel
          || (!slot.cameraRelevant && (
            completeBoundsRetired
            || aheadM > CREATURE_SPAWN_MAXIMUM_M + 80
          ))) {
          releaseCreatureSlot(slot);
          continue;
        }
        presentCreatureSlot(slot, now, reducedMotion, graphOrigin, currentCenter);
      }

      if (!currentSealedTunnel) {
        const candidates = creatureSlots
          .filter((slot) => !slot.activeRoot)
          .sort((left, right) => (
            left.instanceIndex - right.instanceIndex
            || left.familyOrdinal - right.familyOrdinal
            || left.definition.id.localeCompare(right.definition.id)
          ));
        for (const slot of candidates) {
          if (acquireCreatureSlot(slot, activeZoneIndex, velocityMps)) {
            presentCreatureSlot(slot, now, reducedMotion, graphOrigin, currentCenter);
          }
        }
      }
      clearanceReport.creatureActiveRoots = activeCreatureSlots.size;
      clearanceReport.creatureVisibleRoots = [...activeCreatureSlots].reduce(
        (count, slot) => count + (slot.activeRoot?.visible ? 1 : 0),
        0
      );
      clearanceReport.cameraRelevantCreatureRoots = 0;
      clearanceReport.cameraVisibleCreatureRoots = 0;
      for (const slot of activeCreatureSlots) {
        if (slot.cameraRelevant) clearanceReport.cameraRelevantCreatureRoots++;
        if (slot.cameraVisible) clearanceReport.cameraVisibleCreatureRoots++;
      }
    }

    let sceneryAnchorEpoch = 0;
    let lastSceneryDistance = Number(state.distance) || 0;
    let lastDecorationNow = 0;
    let lastPhysicalLightingState = null;
    let hasDecorationFrame = false;

    /** Update weather art from the shared clock and the same physical-light state used by roads and scenery. */
    function updateDecoration(now, physicalLightingState = null) {
      lastDecorationNow = Number.isFinite(now) ? now : lastDecorationNow;
      now = lastDecorationNow;
      if (physicalLightingState) lastPhysicalLightingState = physicalLightingState;
      const reducedMotion = Boolean(isReducedMotionEnabled());
      const currentCenter = roadCenterAt(state.distance);
      const currentSurfaceFrame = typeof sampleCommittedWorldFrameAtDistance === 'function'
        ? sampleCommittedWorldFrameAtDistance(state.distance, 0, weatherSurfaceFrameScratch)
        : null;
      const graphOrigin = typeof getWorldRenderOrigin === 'function'
        ? getWorldRenderOrigin(graphOriginScratch) || graphOriginScratch
        : null;
      const daylight = Number.isFinite(state.activeDaylight) ? state.activeDaylight : 0;
      const starOpacity = Number.isFinite(state.activeStarOpacity) ? state.activeStarOpacity : 0.72;
      const activeZoneIndex = resolveZoneIndex(state.distance);
      const activeSkyZoneIndex = Number.isInteger(state.skyZoneIndex) && state.skyZoneIndex >= 0
        ? state.skyZoneIndex
        : activeZoneIndex;
      const weatherState = state.weather;
      updateSceneryWeatherMaterials(weatherState);
      const nightStrength = clamp(starOpacity * (1 - daylight * 0.72), 0.08, 1);
      if (state.distance < lastSceneryDistance - 1) {
        sceneryAnchorEpoch++;
        clearanceReport.sceneryAnchorResetCount++;
      }
      lastSceneryDistance = state.distance;
      clearanceReport.sceneryAnchorEpoch = sceneryAnchorEpoch;

      // Cancel camera translation without inheriting its rotation, so forks keep a stable sky while normal look direction still matters.
      particles.position.copy(camera.position);
      clearanceReport.starAnchorError = particles.position.distanceTo(camera.position);
      particles.material.color.setHex(zonePalette(activeSkyZoneIndex).glow);
      particles.material.opacity = clamp(
        (starOpacity * 0.72 + (1 - daylight) * 0.10)
          * (1 - (Number(weatherState?.cloudCover) || 0) * 0.72)
          * (1 - (Number(weatherState?.dust) || 0) * 0.48),
        0.02,
        0.72
      );

      // The pausable clock animates weather motion only; its palette comes from the shared route realm selected by main.
      updateCloudInstances(Number(state.skyElapsedSeconds) || 0, graphOrigin, true, reducedMotion);
      const nextSkyZoneIndex = (activeSkyZoneIndex + 1) % zones.length;
      const skyBlend = clamp(Number(state.skyBlend) || 0, 0, 1);
      updateUltraEnvironment(
        activeSkyZoneIndex,
        nextSkyZoneIndex,
        skyBlend,
        daylight,
        weatherState,
        graphOrigin
      );
      const physicalSunStrength = clamp(
        (Number(lastPhysicalLightingState?.sunIntensity) || 0) / 4,
        0,
        1
      );
      const physicalAmbientStrength = clamp(
        (Number(lastPhysicalLightingState?.ambientIntensity) || 0) / 2,
        0,
        1
      );
      const physicalSkyStrength = clamp(
        physicalSunStrength * 0.72 + physicalAmbientStrength * 0.28,
        0,
        1
      );
      const cloudDarkness = clamp(Number(weatherState?.cloudDarkness) || 0, 0, 1);
      const cloudDust = clamp(Number(weatherState?.dust) || 0, 0, 1);
      const cloudSnow = clamp(Number(weatherState?.snow) || 0, 0, 1);
      for (let layerIndex = 0; layerIndex < cloudLayers.length; layerIndex++) {
        const { material } = cloudLayers[layerIndex];
        const currentRealmPalette = CLOUD_LAYER_REALM_COLORS[activeSkyZoneIndex >= 4 ? 1 : 0];
        const nextRealmPalette = CLOUD_LAYER_REALM_COLORS[nextSkyZoneIndex >= 4 ? 1 : 0];
        const currentRealmEmissive = CLOUD_LAYER_REALM_EMISSIVES[activeSkyZoneIndex >= 4 ? 1 : 0];
        const nextRealmEmissive = CLOUD_LAYER_REALM_EMISSIVES[nextSkyZoneIndex >= 4 ? 1 : 0];
        cloudPaletteA.setHex(currentRealmPalette[layerIndex]);
        cloudPaletteB.setHex(nextRealmPalette[layerIndex]);
        material.color.copy(cloudPaletteA).lerp(cloudPaletteB, skyBlend);
        cloudEmissiveA.setHex(currentRealmEmissive[layerIndex]);
        cloudEmissiveB.setHex(nextRealmEmissive[layerIndex]);
        material.emissive.copy(cloudEmissiveA).lerp(cloudEmissiveB, skyBlend);
        const darknessStrength = layerIndex === 0 ? 0.28 : layerIndex === 1 ? 0.50 : 0.72;
        const dustStrength = layerIndex === 0 ? 0.16 : layerIndex === 1 ? 0.28 : 0.38;
        const snowStrength = layerIndex === 0 ? 0.08 : layerIndex === 1 ? 0.12 : 0.16;
        material.color
          .lerp(cloudPaletteA.setHex(0x58_6572), cloudDarkness * darknessStrength)
          .lerp(cloudPaletteB.setHex(0xb0_7d4f), cloudDust * dustStrength)
          .lerp(cloudPaletteA.setHex(0xde_eaf0), cloudSnow * snowStrength);
        material.emissive
          .lerp(cloudEmissiveA.setHex(0x1d_2530), cloudDarkness * darknessStrength)
          .lerp(cloudEmissiveB.setHex(0x5a_3827), cloudDust * dustStrength * 0.72);
        // Clouds remain physically lit: this tiny night readability floor never approaches sun or fixture output.
        material.emissiveIntensity = lerp(0.025, 0.075, 1 - physicalSkyStrength)
          * (layerIndex === 0 ? 0.72 : layerIndex === 1 ? 0.86 : 1);
        const layerCover = cloudLayerCovers[layerIndex];
        const baseOpacity = layerIndex === 0
          ? lerp(0.28, 0.62, layerCover)
          : layerIndex === 1
            ? lerp(0.40, 0.82, layerCover)
            : lerp(0.54, 0.92, layerCover);
        material.opacity = clamp(
          baseOpacity + cloudDarkness * (layerIndex === 2 ? 0.07 : 0.035),
          0.24,
          0.96
        );
        clearanceReport.cloudLayerOpacities[layerIndex] = material.opacity;
      }

      updateWeatherVolume(reducedMotion, graphOrigin, currentSurfaceFrame || weatherSurfaceFrameScratch);

      // The complete celestial root is camera-relative and permanently resident; only restrained material response
      // changes with daylight. Copying the settled render-camera quaternion keeps Film side/Top views coherent.
      moonAnchor.position.copy(camera.position);
      moonAnchor.visible = true;
      moonDiscMaterial.color.setHex(daylight > 0.55 ? 0x9b_b1bd : 0xee_f5ff);
      moonDiscMaterial.emissive.setHex(daylight > 0.55 ? 0x43_5869 : 0x8d_a4bd);
      moonDiscMaterial.emissiveIntensity = lerp(0.08, 0.24, nightStrength);
      moonHaloMaterial.opacity = clamp(0.03 + nightStrength * 0.27, 0.03, 0.30);
      moonStarPetalMaterial.opacity = clamp(0.10 + nightStrength * 0.48, 0.10, 0.58);
      moonCloudVeilMaterial.opacity = clamp(0.05 + nightStrength * 0.10, 0.05, 0.15);
      const moonPulse = reducedMotion ? 1 : 1 + Math.sin(now * 0.000_18) * 0.012;
      moonVisual.scale.setScalar(moonPulse);
      resolveMoonVisualOffset(state.physicalMoonDirection, moonVisualOffset);
      moonVisual.position.set(moonVisualOffset.x, moonVisualOffset.y, moonVisualOffset.z);
      moonVisual.quaternion.copy(camera.quaternion);
      clearanceReport.moonDirectionSource = moonVisualOffset.usesPhysicalDirection
        ? MOON_LIGHTING_CONTRACT.directionAuthority
        : 'legacy-visual-offset';
      if (moonVisualOffset.usesPhysicalDirection) {
        const physicalDirection = state.physicalMoonDirection;
        const physicalX = Number(physicalDirection?.x ?? physicalDirection?.[0]);
        const physicalY = Number(physicalDirection?.y ?? physicalDirection?.[1]);
        const physicalZ = Number(physicalDirection?.z ?? physicalDirection?.[2]);
        const physicalLength = Math.hypot(physicalX, physicalY, physicalZ);
        const visualLength = Math.hypot(moonVisualOffset.x, moonVisualOffset.y, moonVisualOffset.z);
        const alignmentDot = clamp(
          (moonVisualOffset.x * physicalX
            + moonVisualOffset.y * physicalY
            + moonVisualOffset.z * physicalZ) / (visualLength * physicalLength),
          -1,
          1
        );
        clearanceReport.moonVisualLightDirectionErrorRadians = Math.acos(alignmentDot);
      } else {
        clearanceReport.moonVisualLightDirectionErrorRadians = null;
      }
      prepareCameraResidencyFrame();
      clearanceReport.cameraRelevantSceneryRoots = 0;
      clearanceReport.cameraVisibleSceneryRoots = 0;
      clearanceReport.regionDetailFadingRoots = 0;
      acceptedSceneryPeers.length = 0;
      for (const candidate of sceneryFrameCandidates) {
        const { item, placement } = candidate;
        const previousCameraRelevant = candidate.cameraRelevant;
        const previousCameraAnchor = candidate.cameraAnchor;
        candidate.wasVisibleAtFrameStart = item.visible;
        candidate.rebindDeferred = false;
        updateMapEntity(item, false, 0, 0, 0, 0, sceneryAnchorEpoch);
        item.visible = false;
        candidate.active = false;
        candidate.retainedCachedAnchor = false;
        candidate.surfaceDistanceM = Number.POSITIVE_INFINITY;
        candidate.cameraVisible = false;
        candidate.cameraRelevant = false;
        candidate.cameraSurfaceDistanceM = Number.POSITIVE_INFINITY;
        if (
          forcedZone !== null
          && (item.userData.visualZone !== forcedZone || item.userData.transitionPreview)
        ) {
          continue;
        }
        thematicPlacementFor(item, placement);
        const proposedPlacementEligible = placement.eligible !== false;
        const currentAnchor = item.userData.worldAnchor;
        if (currentAnchor?.clear
          && currentAnchor.epoch === sceneryAnchorEpoch
          && currentAnchor.s < state.distance - 0.000_1) {
          measureSceneryCandidate(candidate, currentAnchor, graphOrigin, currentCenter);
          measureCameraRelevance(
            candidate,
            currentAnchor,
            candidate.renderX,
            candidate.renderZ,
            sceneryHorizontalRadiusM(item),
            now,
            previousCameraRelevant,
            previousCameraAnchor
          );
          // A passed root that remains physically close on a curve or branch keeps its real anchor. Route progress
          // may choose the next motif only after both player residency and the Film camera frustum release it.
          if (candidate.surfaceDistanceM <= SCENERY_REAR_SURFACE_RETENTION_M + 0.000_1
            || candidate.cameraRelevant) {
            placement.s = currentAnchor.s;
            placement.repeat = currentAnchor.repeat;
            candidate.retainedCachedAnchor = true;
          }
        }
        // A realm-end proposal may already be ineligible while its old physical root is still beside the ship.
        if (!proposedPlacementEligible && !candidate.retainedCachedAnchor) continue;

        const s = placement.s;
        const routeLongitudinalM = localZFromS(s);
        const horizontalRadiusM = sceneryHorizontalRadiusM(item);
        candidate.maximumForwardSurfaceM = sceneryMaximumForwardSurfaceM(item);
        const routeBroadPhase = routeLongitudinalM < sceneryRearCenterRetentionM(item)
          && routeLongitudinalM
            > -(candidate.maximumForwardSurfaceM + horizontalRadiusM);
        // Fixed major stations are few and may be spatially near across a loop even when their route delta is large.
        if (!candidate.retainedCachedAnchor
          && item.userData.placementMode !== 'region-major'
          && !routeBroadPhase) {
          continue;
        }

        const anchorKey = `${sceneryAnchorEpoch}:${placement.repeat}`;
        if (item.userData.worldAnchorKey !== anchorKey) {
          // A root that contributed to the previous presented frame must first become hidden before the pool may
          // overwrite its absolute anchor. Film therefore never sees one visible object teleport between motifs.
          if (candidate.wasVisibleAtFrameStart && item.userData.worldAnchor) {
            candidate.rebindDeferred = true;
            clearanceReport.visibleRootRebindDeferrals++;
            continue;
          }
          if (!cacheSceneryAnchor(item, s, placement.repeat, sceneryAnchorEpoch)) {
            continue;
          }
        } else {
          clearanceReport.sceneryAnchorCacheHits++;
        }
        const anchor = item.userData.worldAnchor;
        if (!anchor?.clear) continue;
        measureSceneryCandidate(candidate, anchor, graphOrigin, currentCenter);
        measureCameraRelevance(
          candidate,
          anchor,
          candidate.renderX,
          candidate.renderZ,
          sceneryHorizontalRadiusM(item),
          now,
          previousCameraRelevant,
          previousCameraAnchor
        );
        const passedPlayer = anchor.s < state.distance - 0.000_1;
        const surfaceLimitM = passedPlayer
          ? SCENERY_REAR_SURFACE_RETENTION_M
          : candidate.maximumForwardSurfaceM;
        const playerRelevant = candidate.surfaceDistanceM <= surfaceLimitM + 0.000_1;
        candidate.active = playerRelevant || candidate.cameraRelevant;
      }

      sceneryFrameCandidates.sort(compareSceneryCandidates);
      for (const candidate of sceneryFrameCandidates) {
        if (candidate.cameraRelevant) clearanceReport.cameraRelevantSceneryRoots++;
        if (candidate.cameraVisible) clearanceReport.cameraVisibleSceneryRoots++;
        if (!candidate.active) continue;
        const { item } = candidate;
        const anchor = item.userData.worldAnchor;
        if (!anchor?.clear) continue;
        // Camera-visible and camera-near roots arbitrate first so Film cannot lose the object it frames. A rejected
        // peer keeps its certified static anchor untouched and recovers immediately when the competing root leaves.
        if (!acceptSceneryPeer(item, anchor)) continue;

        item.visible = true;
        // Cached absolute coordinates never react to proposal/commit/camera changes; only the shared translation-only origin changes.
        // Transition motion now sways around Y while the measured lowest point remains on terrain in every frame.
        const transitionYawSway = !reducedMotion && item.userData.transitionPreview
          ? Math.sin(now * 0.000_7 + item.userData.phase) * 0.018
          : 0;
        item.position.set(
          candidate.renderX,
          anchor.y,
          candidate.renderZ
        );
        item.rotation.y = anchor.yaw + item.userData.baseYaw + transitionYawSway;
        if (item.userData.placementMode === 'region-major') {
          updateRegionDetailPresentation(item, candidate, now);
        }
        updateMapEntity(
          item,
          true,
          anchor.x,
          anchor.y,
          anchor.z,
          item.rotation.y,
          anchor.epoch
        );
        // The primary shadow camera performs distance/frustum rejection. Mobile and distant physical meshes retain
        // truthful cast/receive behavior; transparent effects remain exempt from opaque projection.
        item.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = allowsOpaqueShadow(child);
          if (child.castShadow) child.receiveShadow = true;
        });
        if (item.userData.placementMode === 'ambient-environment') {
          candlelightFactory.update(item, {
            nowMs: now,
            reducedMotion
          });
        }
      }
      clearanceReport.sceneryAnchorCachedCount = pooledModels.reduce((count, item) => (
        count + (item.userData.worldAnchorKey?.startsWith(`${sceneryAnchorEpoch}:`) ? 1 : 0)
      ), 0);

      updateCreatures(
        now,
        reducedMotion,
        activeZoneIndex,
        graphOrigin,
        currentCenter,
        currentSurfaceFrame
      );

      for (const manta of animatedModels) {
        const cycle = 820;
        const ahead = ((manta.userData.offset - state.distance % cycle) + cycle) % cycle;
        const s = state.distance + ahead - 90 + (reducedMotion
          ? 0
          : Math.sin(now * manta.userData.speedWave + manta.userData.phase) * 22);
        const z = localZFromS(s);
        const graphFrame = typeof sampleWorldFrameAtDistance === 'function'
          ? sampleWorldFrameAtDistance(s, graphFrameScratch)
          : null;
        const center = graphFrame && graphOrigin
          ? graphFrame.x - graphOrigin.x
          : roadCenterAt(s) - currentCenter;
        const centerZ = graphFrame && graphOrigin ? graphFrame.z - graphOrigin.z : z;
        const lateral = manta.userData.lateral + (reducedMotion
          ? 0
          : Math.sin(now * 0.000_42 + manta.userData.phase) * manta.userData.drift);
        const rightX = graphFrame?.rightX ?? 1;
        const rightZ = graphFrame?.rightZ ?? 0;
        manta.position.set(
          center + rightX * lateral,
          manta.userData.height + daylight * 1.6 + (reducedMotion
            ? 0
            : Math.sin(now * 0.001_4 + manta.userData.phase) * 0.9),
          centerZ + rightZ * lateral
        );
        manta.rotation.y = (graphFrame?.yaw ?? -Math.atan(roadSlopeAt(s)))
          + (reducedMotion ? 0 : Math.sin(now * 0.000_8 + manta.userData.phase) * 0.16);
        manta.rotation.z = reducedMotion ? 0 : Math.sin(now * 0.001_1 + manta.userData.phase) * 0.08;
        manta.traverse((child) => {
          if (child.userData.mantaWing) {
            child.rotation.z = child.userData.mantaWing * (reducedMotion
              ? -0.08
              : -0.08 + Math.sin(now * 0.002_3 + manta.userData.phase) * 0.14);
          }
          if (child.userData.mantaGlow) {
            child.scale.setScalar(reducedMotion
              ? 0.20
              : 0.20 + Math.sin(now * 0.004 + manta.userData.phase) * 0.025);
          }
        });
        manta.visible = z < 95 && z > -740;
        updateMapEntity(
          manta,
          manta.visible,
          graphFrame ? graphFrame.x + rightX * lateral : roadCenterAt(s) + rightX * lateral,
          manta.position.y,
          graphFrame ? graphFrame.z + rightZ * lateral : -s + rightZ * lateral,
          manta.rotation.y,
          sceneryAnchorEpoch
        );
      }

      // Dark dragons remain remote silhouettes: their path never enters gameplay collections and is enabled only in darker skies.
      const darkDragonSky = activeSkyZoneIndex >= 4 || daylight < 0.30;
      const darkDragonFlightElapsedSeconds = reducedMotion
        ? 0
        : Math.max(0, Number(state.skyElapsedSeconds) || 0);
      const darkDragonTravelDistanceM = darkDragonFlightElapsedSeconds
        * DARK_DRAGON_FLIGHT_CONTRACT.forwardSpeedMps;
      for (const rig of darkDragonRigs) {
        const dragon = rig.dragon;
        const phase = dragon.userData.phase;
        const wingPhase = now * 0.004_2 + phase;
        const s = darkDragonRouteDistanceM(
          state.distance,
          darkDragonFlightElapsedSeconds,
          dragon.userData.offset
        );
        const z = localZFromS(s);
        const graphFrame = typeof sampleWorldFrameAtDistance === 'function'
          ? sampleWorldFrameAtDistance(s, graphFrameScratch)
          : null;
        const center = graphFrame && graphOrigin
          ? graphFrame.x - graphOrigin.x
          : roadCenterAt(s) - currentCenter;
        const centerZ = graphFrame && graphOrigin ? graphFrame.z - graphOrigin.z : z;
        const lateral = dragon.userData.lateral;
        const rightX = graphFrame?.rightX ?? 1;
        const rightZ = graphFrame?.rightZ ?? 0;
        dragon.position.set(
          center + rightX * lateral,
          dragon.userData.height,
          centerZ + rightZ * lateral
        );
        dragon.rotation.y = graphFrame?.yaw ?? -Math.atan(roadSlopeAt(s));
        dragon.rotation.x = 0;
        dragon.rotation.z = 0;

        // Cached rig references keep the silhouette stable while symmetric wingbeats preserve readable flight energy.
        if (rig.head) {
          rig.head.rotation.x = 0;
          rig.head.rotation.y = 0;
          rig.head.rotation.z = 0;
        }
        if (rig.tail) {
          rig.tail.rotation.x = 0;
          rig.tail.rotation.y = 0;
          rig.tail.rotation.z = 0;
        }
        if (rig.body) {
          const breath = reducedMotion ? 0 : Math.sin(now * 0.002_1 + phase);
          rig.body.scale.set(1 + breath * 0.018, 1 + breath * 0.035, 1);
        }
        const flap = reducedMotion ? 0 : Math.sin(wingPhase);
        for (const wing of rig.wings) {
          const side = wing.userData.darkDragonWing;
          wing.rotation.x = Math.PI / 2;
          wing.rotation.y = 0;
          wing.rotation.z = side * (-0.10 + flap * 0.40);
          wing.position.y = 0.46;
        }
        for (const eye of rig.eyes) {
          const eyePulse = reducedMotion ? 1 : 0.92 + Math.sin(now * 0.004_6 + phase) * 0.16;
          eye.scale.setScalar(eyePulse);
        }
        dragon.visible = darkDragonSky
          && z < DARK_DRAGON_FLIGHT_CONTRACT.visibleNearZMaxM
          && z > DARK_DRAGON_FLIGHT_CONTRACT.visibleFarZMinM;
        updateMapEntity(
          dragon,
          dragon.visible,
          graphFrame ? graphFrame.x + rightX * lateral : roadCenterAt(s) + rightX * lateral,
          dragon.position.y,
          graphFrame ? graphFrame.z + rightZ * lateral : -s + rightZ * lateral,
          dragon.rotation.y,
          sceneryAnchorEpoch
        );
      }

      // One monotonic revision covers the complete scene snapshot consumed after this function returns.
      mapEntityContract.revision++;

      if (modelDebug) {
        const ultraHorizonAudit = auditUltraHorizonPresentation();
        state.modelDebug = state.modelDebug || {};
        state.modelDebug.world = {
          quality: qualityProfile.id,
          renderQuality: activeRenderQuality,
          ultraEnabled,
          ultraSkyDomeVisible: ultraSkyDome.visible,
          ultraHorizonGroupCount: ultraHorizonGroups.length,
          ultraVisibleHorizonGroupCount: ultraHorizonGroups.reduce(
            (count, group) => count + (group.visible ? 1 : 0),
            0
          ),
          ultraHorizonLayerCount: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonDepthLayerCount,
          ultraHorizonSegmentCount: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonSegments,
          ultraHorizonResidentMeshCount: ultraHorizonAudit.residentMeshCount,
          ultraHorizonVisibleDrawGroupCount: ultraHorizonAudit.visibleDrawGroupCount,
          ultraHorizonInstancedMeshCount: ultraHorizonAudit.instancedMeshCount,
          ultraHorizonMorphTargetCount: ultraHorizonAudit.morphTargetCount,
          ultraHorizonProfileSignatureCount: ultraHorizonAudit.profileSignatureCount,
          ultraHorizonEmissiveViolationCount: ultraHorizonAudit.emissiveViolationCount,
          ultraHorizonAnchorLagM,
          ultraHorizonMorphWeight,
          ultraFarScenery: zones[activeSkyZoneIndex]?.atmosphere?.farScenery || [],
          ultraCreatesLightCount: WORLD_ULTRA_PRESENTATION_CONTRACT.createsLightCount,
          ultraRegistersMapEntityCount: WORLD_ULTRA_PRESENTATION_CONTRACT.registersMapEntityCount,
          zone: activeZoneIndex,
          skyZone: activeSkyZoneIndex,
          skyElapsedSeconds: Number(state.skyElapsedSeconds || 0),
          weatherCurrent: weatherState?.currentId || 'clear',
          weatherNext: weatherState?.nextId || 'clear',
          weatherPhase: weatherState?.phase || 'steady',
          weatherBlend: Number(weatherState?.blend || 0),
          weatherRain: Number(weatherState?.rain || 0),
          weatherSnow: Number(weatherState?.snow || 0),
          weatherHail: Number(weatherState?.hail || 0),
          weatherDust: Number(weatherState?.dust || 0),
          weatherExposure: clearanceReport.weatherExposure,
          weatherPoolCount: clearanceReport.weatherPoolCount,
          weatherActiveParticleCount: clearanceReport.weatherRainDrawCount
            + clearanceReport.weatherSnowDrawCount
            + clearanceReport.weatherHailDrawCount
            + clearanceReport.weatherDustDrawCount,
          pooledModels: pooledModels.length,
          baselineAndRegionPoolContract: mobile
            ? REGION_SCENERY_INTEGRATION_CONTRACT.mobileBaselineAndRegionRoots
            : REGION_SCENERY_INTEGRATION_CONTRACT.desktopBaselineAndRegionRoots,
          regionSceneryRoots: regionSceneryRoots.length,
          regionBuildDiagnostics,
          ambientCandlelightRoots: ambientCandlelightRoots.length,
          ambientCandlelightDiagnostics: candlelightFactory.diagnostics(),
          creaturePoolRoots: creaturePoolRoots.length,
          creatureDiagnostics: creatureFactory.getDiagnostics(),
          legacyMantaEnabled: LEGACY_CREATURES_ENABLED,
          legacyDragonEnabled: LEGACY_CREATURES_ENABLED,
          legacyCreatureFallback: {
            enabled: LEGACY_CREATURES_ENABLED,
            darkDragonMotion: reducedMotion ? 'static-pose' : 'stable-forward-flight'
          },
          mapEntityCount: mapEntities.length,
          animatedModels: animatedModels.length,
          particles: detail.particles,
          cloudInstances: cloudInstanceCount,
          cloudClusters: cloudClusterCount,
          cloudLayerCount: clearanceReport.cloudLayerCount,
          cloudLayerIds: clearanceReport.cloudLayerIds,
          cloudLayerVisibleEquivalentClusters:
            clearanceReport.cloudLayerVisibleEquivalentClusters,
          cloudLayerOpacities: clearanceReport.cloudLayerOpacities,
          cloudSharedGeometryCount: clearanceReport.cloudSharedGeometryCount,
          cloudShadowCasterCount: clearanceReport.cloudShadowCasterCount,
          cloudLightingAuthority: clearanceReport.cloudLightingAuthority,
          nearCloudClusters: cloudNearClusterCount,
          farCloudClusters: cloudClusterCount - cloudNearClusterCount,
          cloudAnchorMode: clearanceReport.cloudAnchorMode,
          cloudMinimumDriftM: clearanceReport.cloudMinimumDriftM,
          cloudMedianCameraRelativeDisplacementM:
            clearanceReport.cloudMedianCameraRelativeDisplacementM,
          cloudNearFarAngularParallaxRatio: clearanceReport.cloudNearFarAngularParallaxRatio,
          cloudPausedMotionM: clearanceReport.cloudPausedMotionM,
          skyCoverageDegrees: 360,
          moonVisible: moonAnchor.visible,
          moonVisualLanguage: MOON_LIGHTING_CONTRACT.visualLanguage,
          moonResidentVisualObjectCount: MOON_LIGHTING_CONTRACT.residentVisualObjectCount,
          moonSolidMeshCount: MOON_LIGHTING_CONTRACT.solidMoonMeshCount,
          moonMemoryStarPetalInstanceCount:
            MOON_LIGHTING_CONTRACT.memoryStarPetalInstanceCount,
          moonCloudVeilInstanceCount: MOON_LIGHTING_CONTRACT.cloudVeilInstanceCount,
          moonCreatesLocalLightCount: MOON_LIGHTING_CONTRACT.createsLocalLightCount,
          moonResidencyMode: MOON_LIGHTING_CONTRACT.residencyMode,
          moonLightingAuthority: MOON_LIGHTING_CONTRACT.directionAuthority,
          moonDirectionSource: clearanceReport.moonDirectionSource,
          moonVisualLightDirectionErrorRadians:
            clearanceReport.moonVisualLightDirectionErrorRadians,
          darkDragons: darkDragons.length,
          visibleDarkDragons: darkDragons.reduce((count, dragon) => count + (dragon.visible ? 1 : 0), 0),
          reducedMotion,
          darkDragonMotion: LEGACY_CREATURES_ENABLED
            ? reducedMotion ? 'static-pose' : 'stable-forward-flight'
            : 'disabled-replaced-by-creature-factory',
          darkDragonForwardSpeedMps: reducedMotion ? 0 : DARK_DRAGON_FLIGHT_CONTRACT.forwardSpeedMps,
          darkDragonTravelDistanceM: Number(darkDragonTravelDistanceM.toFixed(3)),
          darkDragonHeadingMode: DARK_DRAGON_FLIGHT_CONTRACT.headingMode,
          darkDragonArticulationMode: reducedMotion
            ? 'static-pose'
            : DARK_DRAGON_FLIGHT_CONTRACT.articulationMode,
          darkDragonLongitudinalSwayAmplitudeM:
            DARK_DRAGON_FLIGHT_CONTRACT.longitudinalSwayAmplitudeM,
          darkDragonLateralSwayAmplitudeM: DARK_DRAGON_FLIGHT_CONTRACT.lateralSwayAmplitudeM,
          darkDragonVerticalSwayAmplitudeM: DARK_DRAGON_FLIGHT_CONTRACT.verticalSwayAmplitudeM,
          darkDragonRootYawSwayRadians: DARK_DRAGON_FLIGHT_CONTRACT.rootYawSwayRadians,
          darkDragonRootPitchSwayRadians: DARK_DRAGON_FLIGHT_CONTRACT.rootPitchSwayRadians,
          darkDragonRootRollSwayRadians: DARK_DRAGON_FLIGHT_CONTRACT.rootRollSwayRadians,
          darkDragonVisualOnly: DARK_DRAGON_FLIGHT_CONTRACT.presentationOnly,
          skyVisualOnly: true,
          clearance: clearanceReport,
          topology
        };
      }
      hasDecorationFrame = true;
    }

    /** Reapply the last visual frame when a live preference change requires every ambient rig to settle now. */
    function syncMotionPreference() {
      if (!Boolean(isReducedMotionEnabled()) || !hasDecorationFrame) return false;
      updateDecoration(lastDecorationNow, lastPhysicalLightingState);
      return true;
    }

    /** Toggle the prebuilt Ultra sky, horizon, cloud depth, and scenery micro-detail as one reversible transaction. */
    function setRenderQuality(id) {
      if (worldDisposed) return false;
      const nextQuality = typeof id === 'string' ? id : id?.id;
      const nextUltraEnabled = nextQuality === WORLD_ULTRA_PRESENTATION_CONTRACT.qualityId;
      const nextFactoryQuality = normalizeFactoryRenderQuality(nextQuality);
      creatureRenderQualityId = nextFactoryQuality;
      const creatureQualityChanged = creatureFactory.setRenderQuality(nextFactoryQuality);
      candlelightFactory.setRenderQuality(nextFactoryQuality);
      activeRenderQuality = nextQuality || 'medium';
      clearanceReport.ultraEnabled = nextUltraEnabled;
      clearanceReport.ultraActiveQuality = activeRenderQuality;
      if (nextUltraEnabled === ultraEnabled) return Boolean(creatureQualityChanged);
      ultraEnabled = nextUltraEnabled;
      for (const uniform of ultraWorldSurfaceUniforms) uniform.value = ultraEnabled ? 1 : 0;
      for (const uniform of ultraCloudDetailUniforms) uniform.value = ultraEnabled ? 1 : 0;
      ultraSkyDome.visible = ultraEnabled;
      if (!ultraEnabled) {
        for (const group of ultraHorizonGroups) group.visible = false;
      } else if (hasDecorationFrame) {
        updateDecoration(lastDecorationNow, lastPhysicalLightingState);
      }
      return true;
    }

    function getRenderQualityDiagnostics() {
      const ultraHorizonAudit = auditUltraHorizonPresentation();
      return Object.freeze({
        activeQuality: activeRenderQuality,
        ultraEnabled,
        skyDomeVisible: ultraSkyDome.visible,
        horizonGroupCount: ultraHorizonGroups.length,
        visibleHorizonGroupCount: ultraHorizonGroups.reduce(
          (count, group) => count + (group.visible ? 1 : 0),
          0
        ),
        horizonLayerCount: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonDepthLayerCount,
        horizonSegmentCount: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonSegments,
        horizonResidentMeshCount: ultraHorizonAudit.residentMeshCount,
        horizonVisibleDrawGroupCount: ultraHorizonAudit.visibleDrawGroupCount,
        horizonInstancedMeshCount: ultraHorizonAudit.instancedMeshCount,
        horizonMorphTargetCount: ultraHorizonAudit.morphTargetCount,
        horizonProfileSignatureCount: ultraHorizonAudit.profileSignatureCount,
        horizonEmissiveViolationCount: ultraHorizonAudit.emissiveViolationCount,
        horizonAnchorLagM: ultraHorizonAnchorLagM,
        horizonMorphWeight: ultraHorizonMorphWeight,
        horizonAnchorMode: WORLD_ULTRA_PRESENTATION_CONTRACT.horizonAnchorMode,
        horizonWorldBaseY: 0,
        worldDetailMaterialCount: ultraWorldSurfaceUniforms.length,
        cloudDetailMaterialCount: ultraCloudDetailUniforms.length,
        regionScenery: Object.freeze({
          roots: regionSceneryRoots.length,
          adapterTriangles: clearanceReport.regionAdapterTriangles,
          adapterDrawGroups: clearanceReport.regionAdapterDrawGroups
        }),
        ambientCandlelight: candlelightFactory.diagnostics(),
        creatures: creatureFactory.getDiagnostics(),
        createsLightCount: WORLD_ULTRA_PRESENTATION_CONTRACT.createsLightCount,
        registersMapEntityCount: WORLD_ULTRA_PRESENTATION_CONTRACT.registersMapEntityCount,
        disposed: worldDisposed
      });
    }

    if (modelDebug) {
      // Keep the console summary aligned with the shared analyzer's full manifold contract.
      const invalid = topology.filter((entry) => !entry.isClosed);
      console.info('[V23 modelDebug] world topology', {
        quality: qualityProfile.id,
        checked: topology.length,
        invalid: invalid.length,
        familyCounts: familyManifest.map((entry) => entry.landmarks.length + entry.environments.length)
      });
      if (invalid.length) console.warn('[V23 modelDebug] invalid world geometries', invalid);
    }

    Object.freeze(mapEntities);

    /** Return the retained absolute-coordinate scene snapshot; callers must treat every record as read-only. */
    function getMapEntities() {
      return mapEntityContract;
    }

    /** Release world-owned render resources without touching lighting, route, weather, or gameplay state. */
    function dispose() {
      if (worldDisposed) return false;
      worldDisposed = true;
      const geometries = new Set();
      const materials = new Set();
      const collect = (object) => {
        if (object.geometry?.dispose) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (material?.dispose) materials.add(material);
        }
      };
      for (const object of deco) {
        object.traverse(collect);
        scene.remove(object);
      }
      // Factory roots stay out of deco so their shared geometries and private mutable materials have one disposer.
      for (const root of ambientCandlelightRoots) scene.remove(root);
      for (const root of creaturePoolRoots) scene.remove(root);
      candlelightFactory.dispose();
      creatureFactory.dispose();
      for (const cached of materialCache.values()) {
        for (const key of ['base', 'trim', 'dark', 'accent', 'glow', 'haze']) {
          if (cached[key]?.dispose) materials.add(cached[key]);
        }
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      moonSurfaceTexture.dispose();
      moonHaloTexture.dispose();
      weatherParticleTexture.dispose();
      snowflakeTexture.dispose();
      return true;
    }

    setRenderQuality(renderQualityId || search.get('quality') || 'medium');

    return {
      updateDecoration,
      syncMotionPreference,
      setRenderQuality,
      getRenderQualityDiagnostics,
      dispose,
      getMapEntities,
      deco,
      familyManifest,
      qualityProfile,
      clearanceReport,
      topologyReport: topology
    };
  }

  return {
    createDecorationLayer,
    familyManifest,
    DARK_DRAGON_FLIGHT_CONTRACT,
    MOON_LIGHTING_CONTRACT,
    WEATHER_VIEW_VOLUME_CONTRACT,
    PRECIPITATION_DEPTH_CONTRACT,
    LOCAL_RAIN_SHELTER_CONTRACT,
    resolveLocalRainShelter,
    resolveMoonVisualOffset,
    darkDragonRouteDistanceM,
    precipitationDepthBandId,
    CLOUD_PRESENTATION_CLEARANCE_CONTRACT,
    CLOUD_WEATHER_LAYER_CONTRACT,
    WORLD_ULTRA_PRESENTATION_CONTRACT,
    BASELINE_SCENERY_PRESENTATION_CONTRACT,
    REGION_SCENERY_INTEGRATION_CONTRACT,
    SCENERY_TERRAIN_CONTACT_CONTRACT,
    WORLD_CAMERA_CLEARANCE_ENVELOPE_CONTRACT,
    CREATURE_WORLD_INTEGRATION_CONTRACT,
    WORLD_ULTRA_SKY_PALETTES,
    createUltraHorizonProfile,
    resolveCloudLayerPresentation,
    requiredCloudLiftM,
    cloudSightlineScale
  };
})();
