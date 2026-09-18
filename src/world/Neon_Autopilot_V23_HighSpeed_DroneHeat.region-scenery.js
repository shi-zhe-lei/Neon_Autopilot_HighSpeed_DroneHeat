/*
 * V23 original region-scenery catalog and renderer-neutral drawing blueprints.
 * This module owns presentation metadata only; world placement remains authoritative for route clearance and maps.
 */
window.NeonV23RegionScenery = (() => {
  'use strict';

  const REGION_IDS = Object.freeze([
    'dawn-isle',
    'prairie-garden',
    'rainforest-glow',
    'twilight-valley',
    'star-vault',
    'eden-eye'
  ]);
  const CATEGORY_IDS = Object.freeze(['landmark', 'environment', 'ambient-candlelight']);
  const SCALE_CLASSES = Object.freeze(['hero', 'major', 'ambient']);
  const PLACEMENT_BANDS = Object.freeze(['ground-mid', 'ground-far', 'air-far']);
  const ALLOWED_SCENE_LAYERS = Object.freeze(['horizon', 'terrain', 'roadside', 'air', 'route']);
  const VISIBILITY_BANDS = Object.freeze([
    'silhouette-and-detail',
    'detail-hysteresis-260m-in-340m-out',
    'standard'
  ]);
  const TRANSITION_POLICY_BY_ELIGIBILITY = deepFreeze({
    true: 'adjacent-72m-allowed',
    false: 'current-realm-only'
  });
  const PLACEMENT_BAND_SCENE_LAYER = deepFreeze({
    'ground-mid': 'roadside',
    'ground-far': 'terrain',
    'air-far': 'horizon'
  });
  const MAJOR_STATIONS_M = Object.freeze([390, 1_290, 2_190]);
  const majorFamilyCountByRegion = Object.create(null);
  const V2_ENVIRONMENT_ADDITIONS_BY_REGION = deepFreeze({
    'dawn-isle': ['firstlight-petal-waystones', 'sunmist-memory-sails'],
    'prairie-garden': ['meadow-mask-bloom-rings', 'cloudbanner-star-drift'],
    'rainforest-glow': ['rainveil-candle-root-court', 'canopy-petal-memory-drift'],
    'twilight-valley': ['rosewind-mask-snowfield', 'sunset-banner-starstream'],
    'star-vault': ['quiet-mask-candle-steps', 'memory-petal-orbits'],
    'eden-eye': ['ember-memory-waystones', 'stormtorn-petal-banners']
  });
  const SUBTYPE_IDS = Object.freeze([
    'gateway',
    'sanctuary',
    'memorial',
    'civic',
    'waypoint',
    'archive',
    'terrace',
    'monument',
    'observatory',
    'sky-formation',
    'wind-formation',
    'light-phenomenon',
    'flora-colony',
    'flora-formation',
    'water-feature',
    'weather-flora',
    'flora-terrain',
    'terrain-formation',
    'wind-light',
    'artifact-field',
    'light-current',
    'stone-formation',
    'crystal-formation',
    'light-terrain'
  ]);

  /** Freeze every nested contract object while leaving instantiated Three.js objects outside this data graph. */
  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) {
      return value;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
  }

  // Clearance classes publish placement requests only. The world layer must measure the finished template and
  // enforce these values against the complete committed road graph before exposing an instance.
  const CLEARANCE_CLASSES = deepFreeze({
    'landmark-ground': {
      category: 'landmark',
      placementBands: ['ground-mid', 'ground-far'],
      minimumRoadGapM: 6,
      minimumPeerEdgeGapM: 4,
      minimumDeckClearanceM: 0,
      requiresCompleteRoadCapsuleQuery: true,
      forbidsDrivingCorridorCrossing: true
    },
    'landmark-air-far': {
      category: 'landmark',
      placementBands: ['air-far'],
      minimumRoadGapM: 6,
      minimumPeerEdgeGapM: 4,
      minimumDeckClearanceM: 8,
      requiresCompleteRoadCapsuleQuery: true,
      forbidsDrivingCorridorCrossing: true
    },
    'environment-ground': {
      category: 'environment',
      placementBands: ['ground-mid', 'ground-far'],
      minimumRoadGapM: 3,
      minimumPeerEdgeGapM: 4,
      minimumDeckClearanceM: 0,
      requiresCompleteRoadCapsuleQuery: true,
      forbidsDrivingCorridorCrossing: true
    },
    'environment-air-far': {
      category: 'environment',
      placementBands: ['air-far'],
      minimumRoadGapM: 3,
      minimumPeerEdgeGapM: 4,
      minimumDeckClearanceM: 8,
      requiresCompleteRoadCapsuleQuery: true,
      forbidsDrivingCorridorCrossing: true
    },
    'ambient-candlelight-ground': {
      category: 'ambient-candlelight',
      placementBands: ['ground-mid', 'ground-far'],
      minimumRoadGapM: 3,
      minimumPeerEdgeGapM: 4,
      minimumDeckClearanceM: 0,
      requiresCompleteRoadCapsuleQuery: true,
      forbidsDrivingCorridorCrossing: true
    }
  });

  // Another task may later contribute one non-pickup ambient candlelight family per realm. This frozen slot
  // reserves only cross-task classification and clearance metadata; no provider API or template is required here.
  const EXTERNAL_CATEGORY_SLOTS = deepFreeze({
    'ambient-candlelight': {
      optional: true,
      provider: 'external-task',
      expectedFamiliesPerRegion: 1,
      clearanceClass: 'ambient-candlelight-ground',
      semanticRole: 'ambient-candlelight',
      allowedSceneLayers: ['roadside', 'terrain'],
      mapPriority: 0,
      collisionRole: 'none',
      pickupRole: 'none',
      presentationOnly: true
    }
  });

  // V2 keeps every procedural family readable at journey scale: one tall primary mass, deliberate voids, and
  // restrained symbolic accents. The grammar is original and explicitly excludes modern hard-surface machinery.
  const ETHEREAL_PILGRIMAGE_LANGUAGE_V2 = deepFreeze({
    silhouetteRole: 'monumental-readable-profile',
    silhouetteHeightScale: 1.16,
    negativeSpaceRole: 'mass-void-mass',
    minimumNegativeSpaceRatio: 0.58,
    decorationDensityScale: 1,
    textileRole: 'cloth-banner-or-petal',
    spiritRole: 'abstract-spirit-mask',
    memoryLightRole: 'candle-star-memory',
    nearDetailRole: 'carved-relief-and-inlay',
    depthLayerRole: 'foreground-midground-horizon',
    realmDifferentiationRole: 'realm-specific-material-weather-botany',
    decorativeDensity: 'restrained',
    originalityRule: 'original-composite-forms-only',
    copiesSpecificThirdPartyAssets: false,
    modernScienceFictionElementsAllowed: false,
    prohibitedModernElements: [
      'hard-surface-greebles',
      'exposed-propulsion-machinery',
      'circuit-surface-lines',
      'industrial-signage'
    ],
    prohibitedVocabularyTokens: ['lens', 'tracer', 'circuit', 'neon', 'industrial', 'turbine']
  });
  const BLUEPRINT_LANGUAGE_ROLES = Object.freeze([
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.silhouetteRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.negativeSpaceRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.textileRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.spiritRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.memoryLightRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.nearDetailRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.depthLayerRole,
    ETHEREAL_PILGRIMAGE_LANGUAGE_V2.realmDifferentiationRole
  ]);
  const REALM_SCENE_PROFILES = deepFreeze({
    'dawn-isle': {
      palette: ['sun-ivory', 'sand-gold', 'mist-blue'],
      groundLanguage: 'wind-rounded-stone-and-shallow-dunes',
      airLanguage: 'immense-clear-sky-and-thin-sun-veils',
      silhouetteGesture: 'low-procession-rising-to-one-tall-overtone'
    },
    'prairie-garden': {
      palette: ['spring-green', 'cloud-cream', 'open-sky-blue'],
      groundLanguage: 'rolling-grass-mounds-and-bloom-islands',
      airLanguage: 'buoyant-cloud-arches-and-pollen-drift',
      silhouetteGesture: 'wide-friendly-arcs-with-deep-center-voids'
    },
    'rainforest-glow': {
      palette: ['wet-jade', 'deep-teal', 'rain-silver'],
      groundLanguage: 'rooted-wet-stone-and-reflective-basins',
      airLanguage: 'layered-canopy-mist-and-vertical-rain-shafts',
      silhouetteGesture: 'sheltering-root-vaults-cut-by-light-gaps'
    },
    'twilight-valley': {
      palette: ['rose-amber', 'ice-blue', 'violet-shadow'],
      groundLanguage: 'swept-snow-ridges-and-polished-ice-shelves',
      airLanguage: 'long-valley-currents-and-sunset-afterimages',
      silhouetteGesture: 'fast-diagonals-balanced-by-broad-arches'
    },
    'star-vault': {
      palette: ['night-indigo', 'soft-violet', 'warm-starlight'],
      groundLanguage: 'quiet-ascending-steps-and-memory-slabs',
      airLanguage: 'vertical-darkness-floating-orbits-and-star-fields',
      silhouetteGesture: 'slender-ascents-surrounded-by-large-dark-voids'
    },
    'eden-eye': {
      palette: ['storm-charcoal', 'ember-crimson', 'ash-white'],
      groundLanguage: 'fractured-stone-and-sealed-ember-fissures',
      airLanguage: 'torn-storm-veils-and-sparse-ash-streams',
      silhouetteGesture: 'broken-monoliths-with-protective-inner-hollows'
    }
  });

  const GENERATION_BUDGET = deepFreeze({
    addedFamilyCount: 48,
    familiesPerRegion: 8,
    landmarksPerRegion: 3,
    environmentsPerRegion: 5,
    addedPooledGroups: 48,
    totalPooledGroups: {
      desktop: 90,
      mobile: 84
    },
    maximumTrianglesPerFamily: {
      desktop: 5_000,
      mobile: 1_800
    },
    maximumTrianglesPerActiveRegion: {
      desktop: 32_000,
      mobile: 11_200
    },
    maximumDrawGroupsPerFamily: 3,
    maximumSceneLightsPerFamily: 0,
    maximumCollidersPerFamily: 0,
    maximumMapEntitiesPerLiveGroup: 1,
    maximumFrameAssetAllocations: 0,
    realmLengthM: 2_700,
    environmentMotifLengthM: 280,
    majorStationsM: MAJOR_STATIONS_M,
    minimumMajorStationIntervalM: 900,
    authoredMajorStationIntervalM: 900,
    maximumVisibleNewMajors: 1,
    maximumVisibleNewEnvironments: 5,
    visibleBudget: {
      desktopTriangles: 18_300,
      mobileTriangles: 6_300,
      drawGroups: 18
    },
    majorSilhouetteRangeM: {
      near: 700,
      far: 1_500
    },
    majorDetailEnterDistanceM: 260,
    majorDetailExitDistanceM: 340,
    // This complete presentation envelope is consumed as one contract by world placement. Keeping forward
    // prewarm, rear retention, Film-plane hysteresis, and grace together prevents a single raised cull constant
    // from merely moving the pop to another lifecycle gate.
    presentationDistanceM: {
      playerForwardMajorSurfaceM: 1_800,
      playerForwardOtherSurfaceM: 1_440,
      playerRearSurfaceM: 480,
      cameraPrewarmPlaneMarginM: 320,
      cameraRetentionPlaneMarginM: 480,
      cameraMinimumGraceMs: 1_800,
      cameraExpandedPlaneCount: 6
    },
    majorSilhouetteWidthRangeM: {
      minimum: 16,
      maximum: 60
    }
  });

  // Authored estimates leave headroom below the hard caps. The future Three.js adapter must report measured
  // triangle and draw-group totals, which createRegionTemplates validates before returning any template.
  const BUDGET_PROFILES = deepFreeze({
    hero: {
      desktopTriangles: 4_600,
      mobileTriangles: 1_600,
      drawGroups: 3
    },
    major: {
      desktopTriangles: 3_800,
      mobileTriangles: 1_300,
      drawGroups: 3
    },
    field: {
      desktopTriangles: 3_300,
      mobileTriangles: 1_100,
      drawGroups: 3
    },
    ambient: {
      desktopTriangles: 2_600,
      mobileTriangles: 900,
      drawGroups: 3
    }
  });

  function recipe(pattern, {
    radiusM,
    heightM,
    repetitions,
    openness = 0.5,
    twistRadians = 0,
    tierCount = 3,
    materialRoles = ['base', 'trim', 'glow']
  }) {
    // V2 promotes legacy two-batch ambient recipes so carved trim remains independently shaded at close range.
    const v2MaterialRoles = materialRoles.includes('trim')
      ? materialRoles
      : ['base', 'trim', 'glow'];
    return {
      pattern,
      radiusM,
      heightM,
      repetitions,
      openness,
      twistRadians,
      tierCount,
      materialRoles: v2MaterialRoles,
      negativeSpaceRatio: Math.max(
        openness,
        ETHEREAL_PILGRIMAGE_LANGUAGE_V2.minimumNegativeSpaceRatio
      ),
      sceneLanguage: ETHEREAL_PILGRIMAGE_LANGUAGE_V2,
      languageRoles: BLUEPRINT_LANGUAGE_ROLES
    };
  }

  function defineFamily({
    id,
    realmId,
    category,
    subtype,
    labelZh,
    labelEn,
    scaleClass,
    placementBand,
    clearanceClass,
    transitionEligible,
    motifs,
    budgetProfile,
    drawingRecipe
  }) {
    const clearance = CLEARANCE_CLASSES[clearanceClass];
    const budget = BUDGET_PROFILES[budgetProfile];
    if (!REGION_IDS.includes(realmId)) throw new RangeError(`Unknown region-scenery realm: ${realmId}`);
    if (!CATEGORY_IDS.includes(category)) throw new RangeError(`Unknown region-scenery category: ${category}`);
    if (!SUBTYPE_IDS.includes(subtype)) throw new RangeError(`Unknown region-scenery subtype: ${subtype}`);
    if (!SCALE_CLASSES.includes(scaleClass)) {
      throw new RangeError(`Unknown region-scenery scale class: ${scaleClass}`);
    }
    if (!PLACEMENT_BANDS.includes(placementBand)) {
      throw new RangeError(`Unknown region-scenery placement band: ${placementBand}`);
    }
    if (!clearance || clearance.category !== category
      || !clearance.placementBands.includes(placementBand)) {
      throw new RangeError(`Region-scenery clearance class mismatches ${id}`);
    }
    if (!budget) throw new RangeError(`Unknown region-scenery budget profile: ${budgetProfile}`);
    if (transitionEligible && category !== 'environment') {
      throw new RangeError(`Only environment scenery can preview a region transition: ${id}`);
    }
    const semanticRole = category === 'landmark' ? 'landmark-major' : 'environment-cluster';
    const sceneLayer = PLACEMENT_BAND_SCENE_LAYER[placementBand];
    const mapPriority = category === 'landmark' ? 3 : scaleClass === 'major' ? 1 : 0;
    const transitionPolicy = TRANSITION_POLICY_BY_ELIGIBILITY[String(Boolean(transitionEligible))];
    const motifRepeat = category === 'environment';
    const stationIndex = category === 'landmark'
      ? majorFamilyCountByRegion[realmId] || 0
      : -1;
    const preferredStationM = category === 'landmark' ? MAJOR_STATIONS_M[stationIndex] : null;
    if (category === 'landmark' && !Number.isFinite(preferredStationM)) {
      throw new RangeError(`Region scenery defines more than three major landmarks for ${realmId}.`);
    }
    if (category === 'landmark') majorFamilyCountByRegion[realmId] = stationIndex + 1;
    const silhouetteWidthM = category === 'landmark'
      ? Math.max(
        GENERATION_BUDGET.majorSilhouetteWidthRangeM.minimum,
        Math.min(
          GENERATION_BUDGET.majorSilhouetteWidthRangeM.maximum,
          drawingRecipe.radiusM * 2.4
        )
      )
      : null;
    return deepFreeze({
      id,
      realmId,
      category,
      subtype,
      labelZh,
      labelEn,
      scaleClass,
      placementBand,
      clearanceClass,
      transitionEligible: Boolean(transitionEligible),
      transitionPolicy,
      sceneLayer,
      semanticRole,
      realmSceneProfile: REALM_SCENE_PROFILES[realmId],
      motifRepeat,
      preferredStationM,
      mapPriority,
      collisionRole: 'none',
      horizontalRadiusM: null,
      motionEnvelopeM: null,
      silhouetteWidthM,
      silhouetteRevealRangeM: category === 'landmark'
        ? {
          near: GENERATION_BUDGET.majorSilhouetteRangeM.near,
          far: GENERATION_BUDGET.majorSilhouetteRangeM.far
        }
        : null,
      detailVisibilityHysteresisM: category === 'landmark'
        ? {
          enter: GENERATION_BUDGET.majorDetailEnterDistanceM,
          exit: GENERATION_BUDGET.majorDetailExitDistanceM
        }
        : null,
      motifs: [...motifs],
      presentationOnly: true,
      collisionAuthority: 'none',
      lightCount: 0,
      gameplayWrites: 0,
      navigationWrites: 0,
      mapEntityLimitPerLiveGroup: 1,
      budget: {
        desktopTriangles: budget.desktopTriangles,
        mobileTriangles: budget.mobileTriangles,
        drawGroups: budget.drawGroups
      },
      recipe: drawingRecipe
    });
  }

  const familyCatalog = Object.freeze([
    defineFamily({
      id: 'aurora-pilgrim-oculus',
      realmId: 'dawn-isle',
      category: 'landmark',
      subtype: 'gateway',
      labelZh: '曙辉旅者天眼',
      labelEn: 'Aurora Pilgrim Oculus',
      scaleClass: 'hero',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['sun-disc', 'weathered-stone', 'open-sky'],
      budgetProfile: 'hero',
      drawingRecipe: recipe('ring-spires', {
        radiusM: 6.8,
        heightM: 10.4,
        repetitions: 7,
        openness: 0.72,
        twistRadians: 0.12
      })
    }),
    defineFamily({
      id: 'sunwake-sail-sanctuary',
      realmId: 'dawn-isle',
      category: 'landmark',
      subtype: 'sanctuary',
      labelZh: '日迹帆影圣所',
      labelEn: 'Sunwake Sail Sanctuary',
      scaleClass: 'major',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['sail-vault', 'dawn-stone', 'soft-gold'],
      budgetProfile: 'major',
      drawingRecipe: recipe('vault-canopy', {
        radiusM: 6.2,
        heightM: 8.8,
        repetitions: 5,
        openness: 0.64,
        twistRadians: -0.16
      })
    }),
    defineFamily({
      id: 'whispering-stone-choir',
      realmId: 'dawn-isle',
      category: 'landmark',
      subtype: 'memorial',
      labelZh: '风语石歌阵',
      labelEn: 'Whispering Stone Choir',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['singing-stones', 'wind-gaps', 'rising-notes'],
      budgetProfile: 'major',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 5.8,
        heightM: 7.6,
        repetitions: 9,
        openness: 0.58,
        twistRadians: 0.22
      })
    }),
    defineFamily({
      id: 'veilcloud-terrace-chain',
      realmId: 'dawn-isle',
      category: 'environment',
      subtype: 'sky-formation',
      labelZh: '薄云浮阶群',
      labelEn: 'Veilcloud Terrace Chain',
      scaleClass: 'major',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['floating-terraces', 'cloud-veils', 'open-horizon'],
      budgetProfile: 'field',
      drawingRecipe: recipe('terrace-chain', {
        radiusM: 8.4,
        heightM: 6.4,
        repetitions: 6,
        openness: 0.82,
        twistRadians: 0.18,
        tierCount: 4
      })
    }),
    defineFamily({
      id: 'aeolian-ribbon-field',
      realmId: 'dawn-isle',
      category: 'environment',
      subtype: 'wind-formation',
      labelZh: '风弦飘带原',
      labelEn: 'Aeolian Ribbon Field',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['wind-ribbons', 'sand-lines', 'directional-flow'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 7.2,
        heightM: 4.8,
        repetitions: 5,
        openness: 0.76,
        twistRadians: 0.34,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'horizon-lightwell',
      realmId: 'dawn-isle',
      category: 'environment',
      subtype: 'light-phenomenon',
      labelZh: '地平柔光井',
      labelEn: 'Horizon Lightwell',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['recessed-basin', 'soft-halo', 'sunward-axis'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('lightwell', {
        radiusM: 5.4,
        heightM: 3.8,
        repetitions: 6,
        openness: 0.88,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'firstlight-petal-waystones',
      realmId: 'dawn-isle',
      category: 'environment',
      subtype: 'stone-formation',
      labelZh: '初光花瓣路石群',
      labelEn: 'Firstlight Petal Waystones',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['monumental-waystones', 'petal-banners', 'mask-voids', 'candle-memory-dots'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 7.6,
        heightM: 6.8,
        repetitions: 7,
        openness: 0.76,
        twistRadians: 0.16,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'sunmist-memory-sails',
      realmId: 'dawn-isle',
      category: 'environment',
      subtype: 'wind-formation',
      labelZh: '晨雾忆光帆群',
      labelEn: 'Sunmist Memory Sails',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['high-cloth-sails', 'open-sky-voids', 'spirit-mask-cutouts', 'star-memory-trails'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 9.6,
        heightM: 7.4,
        repetitions: 6,
        openness: 0.92,
        twistRadians: 0.38,
        materialRoles: ['base', 'glow']
      })
    }),

    defineFamily({
      id: 'windbell-orchard-rotunda',
      realmId: 'prairie-garden',
      category: 'landmark',
      subtype: 'civic',
      labelZh: '风铃果园圆庭',
      labelEn: 'Windbell Orchard Rotunda',
      scaleClass: 'hero',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['open-rotunda', 'bell-seeds', 'orchard-canopy'],
      budgetProfile: 'hero',
      drawingRecipe: recipe('ring-spires', {
        radiusM: 7.2,
        heightM: 9.2,
        repetitions: 8,
        openness: 0.68,
        twistRadians: -0.08
      })
    }),
    defineFamily({
      id: 'petal-vault-pavilion',
      realmId: 'prairie-garden',
      category: 'landmark',
      subtype: 'sanctuary',
      labelZh: '花瓣穹顶亭',
      labelEn: 'Petal Vault Pavilion',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['petal-vault', 'woven-stems', 'pollen-glow'],
      budgetProfile: 'major',
      drawingRecipe: recipe('vault-canopy', {
        radiusM: 5.8,
        heightM: 7.4,
        repetitions: 7,
        openness: 0.74,
        twistRadians: 0.24
      })
    }),
    defineFamily({
      id: 'meadow-compass-monument',
      realmId: 'prairie-garden',
      category: 'landmark',
      subtype: 'waypoint',
      labelZh: '草海风向碑',
      labelEn: 'Meadow Compass Monument',
      scaleClass: 'major',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['cardinal-stones', 'wind-needle', 'grass-ring'],
      budgetProfile: 'major',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 5.6,
        heightM: 8.2,
        repetitions: 8,
        openness: 0.62,
        twistRadians: -0.20
      })
    }),
    defineFamily({
      id: 'seedglow-grass-sea',
      realmId: 'prairie-garden',
      category: 'environment',
      subtype: 'flora-colony',
      labelZh: '种辉草海',
      labelEn: 'Seedglow Grass Sea',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['luminous-seeds', 'grass-waves', 'low-glow'],
      budgetProfile: 'field',
      drawingRecipe: recipe('grove-field', {
        radiusM: 8.6,
        heightM: 3.6,
        repetitions: 12,
        openness: 0.80,
        twistRadians: 0.18
      })
    }),
    defineFamily({
      id: 'ribbonvine-canopy',
      realmId: 'prairie-garden',
      category: 'environment',
      subtype: 'flora-formation',
      labelZh: '绸藤云冠',
      labelEn: 'Ribbonvine Canopy',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['arching-vines', 'leaf-sails', 'porous-shade'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('vault-canopy', {
        radiusM: 6.8,
        heightM: 6.2,
        repetitions: 5,
        openness: 0.84,
        twistRadians: 0.30,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'softcloud-pollen-arc',
      realmId: 'prairie-garden',
      category: 'environment',
      subtype: 'sky-formation',
      labelZh: '柔云花粉弧',
      labelEn: 'Softcloud Pollen Arc',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['cloud-arc', 'pollen-points', 'pastel-drift'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('orbit-field', {
        radiusM: 7.8,
        heightM: 4.4,
        repetitions: 9,
        openness: 0.90,
        twistRadians: 0.26,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'meadow-mask-bloom-rings',
      realmId: 'prairie-garden',
      category: 'environment',
      subtype: 'flora-formation',
      labelZh: '草海面纹花环',
      labelEn: 'Meadow Mask Bloom Rings',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['broad-meadow-voids', 'petal-banners', 'abstract-mask-rings', 'candle-seed-memories'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('grove-field', {
        radiusM: 8.8,
        heightM: 5.8,
        repetitions: 10,
        openness: 0.86,
        twistRadians: -0.22,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'cloudbanner-star-drift',
      realmId: 'prairie-garden',
      category: 'environment',
      subtype: 'sky-formation',
      labelZh: '云旗星忆流',
      labelEn: 'Cloudbanner Star Drift',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['monumental-cloud-arc', 'cloth-banner-drift', 'mask-shaped-gaps', 'candle-star-memory'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('orbit-field', {
        radiusM: 10.2,
        heightM: 7.0,
        repetitions: 9,
        openness: 0.94,
        twistRadians: 0.42,
        materialRoles: ['base', 'glow']
      })
    }),

    defineFamily({
      id: 'rain-archive-colonnade',
      realmId: 'rainforest-glow',
      category: 'landmark',
      subtype: 'archive',
      labelZh: '雨痕档案柱廊',
      labelEn: 'Rain Archive Colonnade',
      scaleClass: 'hero',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['water-script', 'root-columns', 'open-archive'],
      budgetProfile: 'hero',
      drawingRecipe: recipe('archive-colonnade', {
        radiusM: 7.6,
        heightM: 10.8,
        repetitions: 8,
        openness: 0.60,
        twistRadians: 0.10,
        tierCount: 4
      })
    }),
    defineFamily({
      id: 'hollowroot-listening-hall',
      realmId: 'rainforest-glow',
      category: 'landmark',
      subtype: 'sanctuary',
      labelZh: '空根听雨堂',
      labelEn: 'Hollowroot Listening Hall',
      scaleClass: 'major',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['hollow-roots', 'rain-vault', 'listening-niches'],
      budgetProfile: 'major',
      drawingRecipe: recipe('vault-canopy', {
        radiusM: 7.0,
        heightM: 9.6,
        repetitions: 6,
        openness: 0.56,
        twistRadians: -0.32
      })
    }),
    defineFamily({
      id: 'mistwater-step-shrine',
      realmId: 'rainforest-glow',
      category: 'landmark',
      subtype: 'terrace',
      labelZh: '雾水层阶祠',
      labelEn: 'Mistwater Step Shrine',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['water-steps', 'mist-gates', 'root-plinth'],
      budgetProfile: 'major',
      drawingRecipe: recipe('terrace-chain', {
        radiusM: 6.4,
        heightM: 7.8,
        repetitions: 5,
        openness: 0.66,
        twistRadians: 0.14,
        tierCount: 5
      })
    }),
    defineFamily({
      id: 'lantern-moss-basin',
      realmId: 'rainforest-glow',
      category: 'environment',
      subtype: 'water-feature',
      labelZh: '灯苔水盆',
      labelEn: 'Lantern Moss Basin',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['moss-basin', 'still-water-mirror', 'low-lanterns'],
      budgetProfile: 'field',
      drawingRecipe: recipe('lightwell', {
        radiusM: 6.8,
        heightM: 3.4,
        repetitions: 10,
        openness: 0.78,
        twistRadians: 0.12
      })
    }),
    defineFamily({
      id: 'silverrain-thread-grove',
      realmId: 'rainforest-glow',
      category: 'environment',
      subtype: 'weather-flora',
      labelZh: '银雨丝林',
      labelEn: 'Silverrain Thread Grove',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: true,
      motifs: ['silver-rain', 'thread-stems', 'mist-canopy'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('grove-field', {
        radiusM: 7.6,
        heightM: 7.2,
        repetitions: 11,
        openness: 0.72,
        twistRadians: -0.18,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'fogfern-cascade',
      realmId: 'rainforest-glow',
      category: 'environment',
      subtype: 'flora-terrain',
      labelZh: '雾蕨叠瀑',
      labelEn: 'Fogfern Cascade',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['fern-fans', 'tiered-mist', 'wet-stone'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('terrain-shelves', {
        radiusM: 7.2,
        heightM: 5.8,
        repetitions: 7,
        openness: 0.70,
        twistRadians: 0.20,
        tierCount: 4,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'rainveil-candle-root-court',
      realmId: 'rainforest-glow',
      category: 'environment',
      subtype: 'weather-flora',
      labelZh: '雨幕烛根庭',
      labelEn: 'Rainveil Candle Root Court',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['monumental-root-arches', 'rain-cloth-veils', 'spirit-mask-hollows', 'candle-memory-stars'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('vault-canopy', {
        radiusM: 8.4,
        heightM: 8.6,
        repetitions: 6,
        openness: 0.72,
        twistRadians: -0.28,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'canopy-petal-memory-drift',
      realmId: 'rainforest-glow',
      category: 'environment',
      subtype: 'sky-formation',
      labelZh: '林冠花瓣忆流',
      labelEn: 'Canopy Petal Memory Drift',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['high-canopy-silhouette', 'petal-drift', 'mask-shaped-voids', 'rainlit-star-memories'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('orbit-field', {
        radiusM: 9.8,
        heightM: 8.2,
        repetitions: 10,
        openness: 0.90,
        twistRadians: -0.44,
        materialRoles: ['base', 'glow']
      })
    }),

    defineFamily({
      id: 'sunset-pilgrim-wind-ring',
      realmId: 'twilight-valley',
      category: 'landmark',
      subtype: 'gateway',
      labelZh: '暮霞朝圣风环',
      labelEn: 'Sunset Pilgrim Wind Ring',
      scaleClass: 'hero',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['pilgrim-wind-ring', 'woven-sunset-petals', 'open-sky-oculus'],
      budgetProfile: 'hero',
      drawingRecipe: recipe('ring-spires', {
        radiusM: 8.0,
        heightM: 11.2,
        repetitions: 8,
        openness: 0.78,
        twistRadians: -0.24
      })
    }),
    defineFamily({
      id: 'echo-ice-organ',
      realmId: 'twilight-valley',
      category: 'landmark',
      subtype: 'monument',
      labelZh: '回声冰风琴',
      labelEn: 'Echo Ice Organ',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['ice-pipes', 'echo-gaps', 'rose-light'],
      budgetProfile: 'major',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 6.2,
        heightM: 10.2,
        repetitions: 11,
        openness: 0.54,
        twistRadians: 0.16
      })
    }),
    defineFamily({
      id: 'roseglass-bridge-crown',
      realmId: 'twilight-valley',
      category: 'landmark',
      subtype: 'civic',
      labelZh: '蔷霞琉璃桥冠',
      labelEn: 'Roseglass Bridge Crown',
      scaleClass: 'major',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['bridge-crown', 'rose-glass', 'wind-cut-piers'],
      budgetProfile: 'major',
      drawingRecipe: recipe('terrace-chain', {
        radiusM: 7.8,
        heightM: 8.6,
        repetitions: 6,
        openness: 0.76,
        twistRadians: -0.12,
        tierCount: 3
      })
    }),
    defineFamily({
      id: 'prismatic-snow-dune',
      realmId: 'twilight-valley',
      category: 'environment',
      subtype: 'terrain-formation',
      labelZh: '棱彩雪丘',
      labelEn: 'Prismatic Snow Dune',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['snow-fans', 'ice-prisms', 'long-shadow'],
      budgetProfile: 'field',
      drawingRecipe: recipe('terrain-shelves', {
        radiusM: 8.8,
        heightM: 4.6,
        repetitions: 9,
        openness: 0.84,
        twistRadians: 0.28,
        tierCount: 4
      })
    }),
    defineFamily({
      id: 'comet-ribbon-current',
      realmId: 'twilight-valley',
      category: 'environment',
      subtype: 'wind-light',
      labelZh: '彗光飘带流',
      labelEn: 'Comet Ribbon Current',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['comet-ribbons', 'air-current', 'afterglow'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 9.0,
        heightM: 6.4,
        repetitions: 6,
        openness: 0.92,
        twistRadians: -0.36,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'afterglow-ice-shelf',
      realmId: 'twilight-valley',
      category: 'environment',
      subtype: 'terrain-formation',
      labelZh: '余晖冰台',
      labelEn: 'Afterglow Ice Shelf',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['ice-shelf', 'warm-edge', 'snow-lip'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('terrace-chain', {
        radiusM: 7.4,
        heightM: 5.2,
        repetitions: 5,
        openness: 0.82,
        twistRadians: 0.10,
        tierCount: 3,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'rosewind-mask-snowfield',
      realmId: 'twilight-valley',
      category: 'environment',
      subtype: 'terrain-formation',
      labelZh: '蔷风面纹雪原',
      labelEn: 'Rosewind Mask Snowfield',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['monumental-snow-fans', 'petal-banner-ridges', 'spirit-mask-voids', 'candle-star-reflections'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('terrain-shelves', {
        radiusM: 9.2,
        heightM: 6.4,
        repetitions: 8,
        openness: 0.88,
        twistRadians: 0.30,
        tierCount: 4,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'sunset-banner-starstream',
      realmId: 'twilight-valley',
      category: 'environment',
      subtype: 'wind-light',
      labelZh: '暮霞布旗星流',
      labelEn: 'Sunset Banner Starstream',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['high-sunset-arc', 'long-cloth-banners', 'mask-shaped-gaps', 'candle-star-afterimages'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 10.4,
        heightM: 8.8,
        repetitions: 7,
        openness: 0.94,
        twistRadians: -0.52,
        materialRoles: ['base', 'glow']
      })
    }),

    defineFamily({
      id: 'orbital-memory-archive',
      realmId: 'star-vault',
      category: 'landmark',
      subtype: 'archive',
      labelZh: '环轨记忆档案馆',
      labelEn: 'Orbital Memory Archive',
      scaleClass: 'hero',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['open-archive', 'orbit-rings', 'memory-slabs'],
      budgetProfile: 'hero',
      drawingRecipe: recipe('archive-colonnade', {
        radiusM: 7.8,
        heightM: 11.6,
        repetitions: 9,
        openness: 0.70,
        twistRadians: 0.30,
        tierCount: 5
      })
    }),
    defineFamily({
      id: 'star-gaze-ascension-tower',
      realmId: 'star-vault',
      category: 'landmark',
      subtype: 'observatory',
      labelZh: '星镜升阶塔',
      labelEn: 'Star Gaze Ascension Tower',
      scaleClass: 'major',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['star-crown', 'ascending-steps', 'violet-stone'],
      budgetProfile: 'major',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 6.4,
        heightM: 12.4,
        repetitions: 7,
        openness: 0.62,
        twistRadians: 0.42
      })
    }),
    defineFamily({
      id: 'silent-constellation-court',
      realmId: 'star-vault',
      category: 'landmark',
      subtype: 'civic',
      labelZh: '静默星图庭',
      labelEn: 'Silent Constellation Court',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['star-court', 'quiet-pillars', 'constellation-lines'],
      budgetProfile: 'major',
      drawingRecipe: recipe('ring-spires', {
        radiusM: 7.0,
        heightM: 8.4,
        repetitions: 10,
        openness: 0.86,
        twistRadians: -0.10
      })
    }),
    defineFamily({
      id: 'levitating-script-garden',
      realmId: 'star-vault',
      category: 'environment',
      subtype: 'artifact-field',
      labelZh: '悬字花园',
      labelEn: 'Levitating Script Garden',
      scaleClass: 'major',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: false,
      motifs: ['floating-glyphs', 'stone-petals', 'vertical-garden'],
      budgetProfile: 'field',
      drawingRecipe: recipe('grove-field', {
        radiusM: 8.2,
        heightM: 8.8,
        repetitions: 12,
        openness: 0.88,
        twistRadians: 0.46
      })
    }),
    defineFamily({
      id: 'nebula-lantern-current',
      realmId: 'star-vault',
      category: 'environment',
      subtype: 'light-current',
      labelZh: '星云灯流',
      labelEn: 'Nebula Lantern Current',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['lantern-current', 'nebula-ribbon', 'soft-orbits'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 9.4,
        heightM: 7.2,
        repetitions: 7,
        openness: 0.94,
        twistRadians: 0.52,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'gravityless-stone-orbit',
      realmId: 'star-vault',
      category: 'environment',
      subtype: 'stone-formation',
      labelZh: '无重石环',
      labelEn: 'Gravityless Stone Orbit',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['floating-stones', 'elliptic-orbit', 'quiet-glow'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('orbit-field', {
        radiusM: 7.8,
        heightM: 6.6,
        repetitions: 10,
        openness: 0.90,
        twistRadians: -0.38,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'quiet-mask-candle-steps',
      realmId: 'star-vault',
      category: 'environment',
      subtype: 'artifact-field',
      labelZh: '静面烛星阶',
      labelEn: 'Quiet Mask Candle Steps',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['monumental-open-steps', 'petal-cloth-tabs', 'abstract-mask-slabs', 'candle-star-memories'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('terrace-chain', {
        radiusM: 8.6,
        heightM: 7.8,
        repetitions: 6,
        openness: 0.90,
        twistRadians: 0.26,
        tierCount: 5,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'memory-petal-orbits',
      realmId: 'star-vault',
      category: 'environment',
      subtype: 'light-current',
      labelZh: '忆光花瓣星环',
      labelEn: 'Memory Petal Orbits',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['monumental-orbit-silhouette', 'cloth-petal-arcs', 'spirit-mask-negative-space', 'candle-star-memory'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('orbit-field', {
        radiusM: 10.6,
        heightM: 9.4,
        repetitions: 11,
        openness: 0.96,
        twistRadians: 0.58,
        materialRoles: ['base', 'glow']
      })
    }),

    defineFamily({
      id: 'stormworn-covenant-ring',
      realmId: 'eden-eye',
      category: 'landmark',
      subtype: 'memorial',
      labelZh: '风蚀誓约环',
      labelEn: 'Stormworn Covenant Ring',
      scaleClass: 'hero',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['broken-ring', 'storm-scars', 'ember-seams'],
      budgetProfile: 'hero',
      drawingRecipe: recipe('ring-spires', {
        radiusM: 8.2,
        heightM: 11.0,
        repetitions: 7,
        openness: 0.48,
        twistRadians: -0.30
      })
    }),
    defineFamily({
      id: 'embershield-pilgrim-vault',
      realmId: 'eden-eye',
      category: 'landmark',
      subtype: 'sanctuary',
      labelZh: '余烬护行穹',
      labelEn: 'Embershield Pilgrim Vault',
      scaleClass: 'major',
      placementBand: 'ground-far',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['shield-vault', 'ember-core', 'wind-break'],
      budgetProfile: 'major',
      drawingRecipe: recipe('vault-canopy', {
        radiusM: 7.4,
        heightM: 9.8,
        repetitions: 6,
        openness: 0.46,
        twistRadians: 0.22
      })
    }),
    defineFamily({
      id: 'fractured-dawn-obelisk',
      realmId: 'eden-eye',
      category: 'landmark',
      subtype: 'monument',
      labelZh: '裂晓方尖碑',
      labelEn: 'Fractured Dawn Obelisk',
      scaleClass: 'major',
      placementBand: 'ground-mid',
      clearanceClass: 'landmark-ground',
      transitionEligible: false,
      motifs: ['split-obelisk', 'dawn-fissure', 'fallen-fragments'],
      budgetProfile: 'major',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 6.0,
        heightM: 12.8,
        repetitions: 6,
        openness: 0.52,
        twistRadians: -0.18
      })
    }),
    defineFamily({
      id: 'ashveil-wind-corridor',
      realmId: 'eden-eye',
      category: 'environment',
      subtype: 'wind-formation',
      labelZh: '灰幕风廊',
      labelEn: 'Ashveil Wind Corridor',
      scaleClass: 'major',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['ash-veils', 'wind-corridor', 'sheltered-gaps'],
      budgetProfile: 'field',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 9.2,
        heightM: 7.8,
        repetitions: 8,
        openness: 0.68,
        twistRadians: -0.48
      })
    }),
    defineFamily({
      id: 'crimson-geode-bloom',
      realmId: 'eden-eye',
      category: 'environment',
      subtype: 'crystal-formation',
      labelZh: '绯晶地心花',
      labelEn: 'Crimson Geode Bloom',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['geode-petals', 'sealed-crystal', 'low-ember'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('grove-field', {
        radiusM: 6.8,
        heightM: 5.6,
        repetitions: 9,
        openness: 0.56,
        twistRadians: 0.30,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'stormlight-fissure-field',
      realmId: 'eden-eye',
      category: 'environment',
      subtype: 'light-terrain',
      labelZh: '风暴光隙原',
      labelEn: 'Stormlight Fissure Field',
      scaleClass: 'ambient',
      placementBand: 'ground-far',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['sealed-fissures', 'stormlight', 'blackstone-shelves'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('lightwell', {
        radiusM: 8.0,
        heightM: 4.2,
        repetitions: 11,
        openness: 0.62,
        twistRadians: -0.20,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'ember-memory-waystones',
      realmId: 'eden-eye',
      category: 'environment',
      subtype: 'stone-formation',
      labelZh: '余烬忆光路石',
      labelEn: 'Ember Memory Waystones',
      scaleClass: 'ambient',
      placementBand: 'ground-mid',
      clearanceClass: 'environment-ground',
      transitionEligible: false,
      motifs: ['monumental-storm-stones', 'torn-petal-tabs', 'spirit-mask-fissures', 'ember-candle-memories'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('chorus-spires', {
        radiusM: 8.4,
        heightM: 8.2,
        repetitions: 7,
        openness: 0.68,
        twistRadians: -0.34,
        materialRoles: ['base', 'glow']
      })
    }),
    defineFamily({
      id: 'stormtorn-petal-banners',
      realmId: 'eden-eye',
      category: 'environment',
      subtype: 'wind-formation',
      labelZh: '风蚀残瓣旗群',
      labelEn: 'Stormtorn Petal Banners',
      scaleClass: 'ambient',
      placementBand: 'air-far',
      clearanceClass: 'environment-air-far',
      transitionEligible: true,
      motifs: ['high-storm-silhouette', 'torn-cloth-petals', 'mask-shaped-voids', 'candle-star-embers'],
      budgetProfile: 'ambient',
      drawingRecipe: recipe('ribbon-current', {
        radiusM: 10.0,
        heightM: 9.0,
        repetitions: 7,
        openness: 0.86,
        twistRadians: -0.60,
        materialRoles: ['base', 'glow']
      })
    })
  ]);

  for (const realmId of REGION_IDS) {
    const realmFamilies = familyCatalog.filter((definition) => definition.realmId === realmId);
    const landmarks = realmFamilies.filter((definition) => definition.category === 'landmark');
    const environments = realmFamilies.filter((definition) => definition.category === 'environment');
    if (majorFamilyCountByRegion[realmId] !== GENERATION_BUDGET.landmarksPerRegion
      || landmarks.length !== GENERATION_BUDGET.landmarksPerRegion) {
      throw new RangeError(`Region scenery requires three major landmark stations for ${realmId}.`);
    }
    if (realmFamilies.length !== GENERATION_BUDGET.familiesPerRegion
      || environments.length !== GENERATION_BUDGET.environmentsPerRegion) {
      throw new RangeError(`Region scenery requires a 3+5 family catalog for ${realmId}.`);
    }
    const v2Additions = V2_ENVIRONMENT_ADDITIONS_BY_REGION[realmId].map(
      (familyId) => realmFamilies.find((definition) => definition.id === familyId)
    );
    if (v2Additions.some((definition) => !definition || definition.category !== 'environment')) {
      throw new RangeError(`Region scenery is missing a V2 environment addition for ${realmId}.`);
    }
    if (!v2Additions.some(({ placementBand }) => placementBand.startsWith('ground-'))
      || !v2Additions.some(({ placementBand }) => placementBand === 'air-far')) {
      throw new RangeError(`Region scenery V2 additions must cover ground and air for ${realmId}.`);
    }
  }

  const familyById = Object.freeze(Object.fromEntries(
    familyCatalog.map((definition) => [definition.id, definition])
  ));
  const familiesByRegion = deepFreeze(Object.fromEntries(REGION_IDS.map((realmId) => [
    realmId,
    familyCatalog.filter((definition) => definition.realmId === realmId)
  ])));

  /** Resolve one catalog entry without silently accepting a cross-thread taxonomy typo. */
  function getFamily(familyId) {
    if (typeof familyId !== 'string' || !familyById[familyId]) {
      throw new RangeError(`Unknown region-scenery family: ${String(familyId)}`);
    }
    return familyById[familyId];
  }

  /** Return the frozen eight-family extension for one exact configured realm. */
  function getRegionFamilies(realmId) {
    if (typeof realmId !== 'string' || !familiesByRegion[realmId]) {
      throw new RangeError(`Unknown region-scenery realm: ${String(realmId)}`);
    }
    return familiesByRegion[realmId];
  }

  /**
   * Validate the six existing realm records before any template build. Baseline family values remain config-owned,
   * but their 3+2 shape and global uniqueness are required for the frozen 30+48 classification total.
   */
  function validateConfiguredZones(zones) {
    if (!Array.isArray(zones)) {
      throw new TypeError('Region scenery requires the configured zones array.');
    }
    if (zones.length !== REGION_IDS.length) {
      throw new RangeError(`Region scenery requires exactly ${REGION_IDS.length} configured zones.`);
    }
    const baselineIds = new Set();
    zones.forEach((zone, index) => {
      if (!zone || typeof zone !== 'object') {
        throw new TypeError(`Region scenery requires a configured zone object at index ${index}.`);
      }
      if (zone.id !== REGION_IDS[index]) {
        throw new RangeError(
          `Region scenery expected zone ${REGION_IDS[index]} at index ${index}, received ${String(zone.id)}.`
        );
      }
      if (!Array.isArray(zone.landmarkFamilies) || zone.landmarkFamilies.length !== 3) {
        throw new RangeError(`Region scenery requires three baseline landmarks for ${zone.id}.`);
      }
      if (!Array.isArray(zone.atmosphere?.environmentFamilies)
        || zone.atmosphere.environmentFamilies.length !== 2) {
        throw new RangeError(`Region scenery requires two baseline environments for ${zone.id}.`);
      }
      for (const familyId of [
        ...zone.landmarkFamilies,
        ...zone.atmosphere.environmentFamilies
      ]) {
        if (typeof familyId !== 'string' || !familyId.trim()) {
          throw new TypeError(`Region scenery found an invalid baseline family in ${zone.id}.`);
        }
        if (baselineIds.has(familyId) || familyById[familyId]) {
          throw new RangeError(`Region scenery family ID is not globally unique: ${familyId}`);
        }
        baselineIds.add(familyId);
      }
    });
    return true;
  }

  // FNV-1a and Mulberry32 are local presentation streams. Neither function consumes or exposes gameplay RNG state.
  function hashSeed(value) {
    let hash = 0x811c_9dc5;
    const text = String(value);
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x0100_0193);
    }
    return hash >>> 0;
  }

  function createPresentationRng(seed) {
    let state = hashSeed(seed);
    return () => {
      state = (state + 0x6d2b_79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
      return ((mixed ^ mixed >>> 14) >>> 0) / 4_294_967_296;
    };
  }

  function resolveQualityKey(qualityProfile) {
    const qualityId = typeof qualityProfile === 'string' ? qualityProfile : qualityProfile?.id;
    if (qualityId === 'mobile') return 'mobile';
    if (qualityId === 'high' || qualityId === 'desktop') return 'desktop';
    throw new RangeError(`Region scenery requires a high/desktop or mobile quality profile, received ${String(qualityId)}.`);
  }

  function part(kind, parameters) {
    return deepFreeze({ kind, ...parameters });
  }

  /**
   * Convert an authored motif into at most three material batches. The adapter must merge or instance every part
   * within one group; it may not turn repeated elements back into one draw call per child.
   */
  function createRenderPlan(definition, qualityKey) {
    const authored = definition.recipe;
    const language = authored.sceneLanguage;
    const mobile = qualityKey === 'mobile';
    const repetitions = Math.max(3, Math.round(
      authored.repetitions * (mobile ? 0.62 : 1) * language.decorationDensityScale
    ));
    const tierCount = Math.max(2, Math.round(
      authored.tierCount * (mobile ? 0.72 : 1) * language.decorationDensityScale
    ));
    const baseParts = [];
    const trimParts = [];
    const glowParts = [];
    const shared = {
      radiusM: authored.radiusM,
      heightM: authored.heightM * language.silhouetteHeightScale,
      repetitions,
      openness: authored.negativeSpaceRatio,
      twistRadians: authored.twistRadians,
      tierCount
    };

    switch (authored.pattern) {
      case 'ring-spires':
        baseParts.push(part('radial-platform', { ...shared, heightRatio: 0.12 }));
        trimParts.push(part('open-oculus-ring', { ...shared, thicknessRatio: 0.08 }));
        trimParts.push(part('tapered-spire-ring', { ...shared, heightRatio: 0.72 }));
        glowParts.push(part('inset-halo-ring', { ...shared, radiusRatio: 0.74 }));
        break;
      case 'vault-canopy':
        baseParts.push(part('stepped-plinth', { ...shared, heightRatio: 0.16 }));
        trimParts.push(part('paired-vault-ribs', { ...shared, ribCount: repetitions }));
        trimParts.push(part('woven-sail-canopy-petals', {
          ...shared,
          petalCount: repetitions,
          surfaceLanguage: 'woven-cloth-petal',
          clothFoldRatio: 0.16,
          edgeTaperRatio: 0.34
        }));
        glowParts.push(part('vault-seam-inlays', { ...shared, seamCount: repetitions }));
        break;
      case 'chorus-spires':
        baseParts.push(part('stone-choir-base', { ...shared, heightRatio: 0.10 }));
        trimParts.push(part('tuned-spire-array', { ...shared, spireCount: repetitions }));
        glowParts.push(part('resonance-caps', { ...shared, capCount: repetitions }));
        break;
      case 'terrace-chain':
        baseParts.push(part('floating-terrace-stack', { ...shared, slabCount: tierCount }));
        trimParts.push(part('terrace-edge-ribs', { ...shared, ribCount: tierCount * 2 }));
        glowParts.push(part('terrace-soft-inlays', { ...shared, inlayCount: tierCount }));
        break;
      case 'ribbon-current':
        baseParts.push(part('current-anchor-stones', { ...shared, stoneCount: tierCount }));
        trimParts.push(part('swept-ribbon-bundle', { ...shared, ribbonCount: repetitions }));
        glowParts.push(part('wind-memory-threads', { ...shared, threadCount: repetitions }));
        break;
      case 'lightwell':
        baseParts.push(part('sealed-radial-basin', { ...shared, wallCount: repetitions }));
        trimParts.push(part('well-rim-markers', { ...shared, markerCount: repetitions }));
        glowParts.push(part('recessed-candle-star-carving', { ...shared, radiusRatio: 0.72 }));
        break;
      case 'grove-field':
        baseParts.push(part('merged-organic-stems', { ...shared, stemCount: repetitions }));
        trimParts.push(part('merged-leaf-sails', { ...shared, leafCount: repetitions * 2 }));
        glowParts.push(part('seed-or-glyph-caps', { ...shared, capCount: repetitions }));
        break;
      case 'archive-colonnade':
        baseParts.push(part('archive-terrace', { ...shared, heightRatio: 0.18 }));
        trimParts.push(part('open-colonnade', { ...shared, columnCount: repetitions }));
        trimParts.push(part('memory-slab-fan', { ...shared, slabCount: repetitions }));
        glowParts.push(part('archive-script-inlays', { ...shared, lineCount: repetitions }));
        break;
      case 'orbit-field':
        baseParts.push(part('orbit-anchor-cluster', { ...shared, anchorCount: tierCount }));
        trimParts.push(part('elliptic-orbit-bands', { ...shared, orbitCount: tierCount }));
        glowParts.push(part('orbital-motes', { ...shared, moteCount: repetitions }));
        break;
      case 'terrain-shelves':
        baseParts.push(part('merged-terrain-shelves', { ...shared, shelfCount: tierCount }));
        trimParts.push(part('ridge-or-fern-fans', { ...shared, fanCount: repetitions }));
        glowParts.push(part('shelf-edge-accents', { ...shared, accentCount: tierCount }));
        break;
      default:
        throw new RangeError(`Unknown region-scenery drawing pattern: ${authored.pattern}`);
    }

    // These shared close-range forms stay inside the existing trim/glow batches: layered petal cloth, one abstract
    // mask oculus, shallow memory reliefs, and candle-star inscriptions. They add real geometry without new lights.
    trimParts.push(part('woven-sail-canopy-petals', {
      ...shared,
      radiusM: shared.radiusM * 0.78,
      heightM: shared.heightM * 0.64,
      petalCount: mobile ? 2 : 4,
      surfaceLanguage: 'woven-cloth-petal',
      clothFoldRatio: 0.16,
      edgeTaperRatio: 0.34,
      languageRoles: [language.textileRole, language.depthLayerRole]
    }));
    trimParts.push(part('open-oculus-ring', {
      ...shared,
      radiusM: shared.radiusM * 0.54,
      heightM: shared.heightM * 0.72,
      thicknessRatio: 0.05,
      languageRoles: [language.spiritRole, language.nearDetailRole]
    }));
    trimParts.push(part('memory-slab-fan', {
      ...shared,
      radiusM: shared.radiusM * 0.62,
      heightM: shared.heightM * 0.48,
      slabCount: mobile ? 2 : 4,
      languageRoles: [language.nearDetailRole, language.realmDifferentiationRole]
    }));
    glowParts.push(part('archive-script-inlays', {
      ...shared,
      radiusM: shared.radiusM * 0.66,
      heightM: shared.heightM * 0.52,
      lineCount: mobile ? 2 : 4,
      languageRoles: [language.memoryLightRole, language.nearDetailRole]
    }));

    // Attach the full V2 visual grammar to geometry merged into at most three material batches. The annotations
    // remain renderer-neutral and require no scene light, collider, per-child draw call, or per-frame allocation.
    const annotatePart = (parts, index, languageRoles) => {
      const authoredPart = parts[index];
      const mergedRoles = [...new Set([
        ...(authoredPart.languageRoles || []),
        ...languageRoles
      ])];
      parts[index] = deepFreeze({ ...authoredPart, languageRoles: mergedRoles });
    };
    annotatePart(baseParts, 0, [
      language.silhouetteRole,
      language.negativeSpaceRole,
      language.depthLayerRole,
      language.realmDifferentiationRole
    ]);
    annotatePart(trimParts, 0, [language.textileRole, language.nearDetailRole]);
    annotatePart(trimParts, trimParts.length - 1, [language.spiritRole]);
    annotatePart(glowParts, 0, [language.memoryLightRole]);

    const authoredRoles = authored.materialRoles;
    const groups = [];
    const addGroup = (materialRole, parts) => {
      if (!parts.length) return;
      const visibilityBand = definition.semanticRole === 'landmark-major'
        ? materialRole === 'base'
          ? 'silhouette-and-detail'
          : 'detail-hysteresis-260m-in-340m-out'
        : 'standard';
      groups.push(deepFreeze({ materialRole, visibilityBand, parts: [...parts] }));
    };
    if (!authoredRoles.includes('trim')) baseParts.push(...trimParts);
    addGroup('base', baseParts);
    if (authoredRoles.includes('trim')) addGroup('trim', trimParts);
    addGroup('glow', glowParts);

    if (groups.length !== definition.budget.drawGroups) {
      throw new RangeError(
        `Region-scenery drawing plan for ${definition.id} produced ${groups.length} groups; expected ${definition.budget.drawGroups}.`
      );
    }
    return deepFreeze({
      familyId: definition.id,
      qualityKey,
      sceneLanguage: language,
      realmSceneProfile: definition.realmSceneProfile,
      languageRoles: authored.languageRoles,
      groups
    });
  }

  function requireMetric(metrics, key) {
    const value = metrics?.[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`Region-scenery adapter must report a non-negative integer ${key}.`);
    }
    return value;
  }

  function requireFiniteMetric(metrics, key, { positive = false } = {}) {
    const value = metrics?.[key];
    if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
      const range = positive ? 'positive' : 'non-negative';
      throw new TypeError(`Region-scenery adapter must report a finite ${range} ${key}.`);
    }
    return value;
  }

  function validateTemplateMetrics(definition, qualityKey, metrics) {
    const normalized = {
      triangles: requireMetric(metrics, 'triangles'),
      drawGroups: requireMetric(metrics, 'drawGroups'),
      sceneLights: requireMetric(metrics, 'sceneLights'),
      colliders: requireMetric(metrics, 'colliders'),
      mapEntities: requireMetric(metrics, 'mapEntities'),
      gameplayWrites: requireMetric(metrics, 'gameplayWrites'),
      navigationWrites: requireMetric(metrics, 'navigationWrites'),
      frameAssetAllocations: requireMetric(metrics, 'frameAssetAllocations'),
      horizontalRadiusM: requireFiniteMetric(metrics, 'horizontalRadiusM', { positive: true }),
      motionEnvelopeM: requireFiniteMetric(metrics, 'motionEnvelopeM')
    };
    const authoredTriangleCap = qualityKey === 'mobile'
      ? definition.budget.mobileTriangles
      : definition.budget.desktopTriangles;
    const hardTriangleCap = GENERATION_BUDGET.maximumTrianglesPerFamily[qualityKey];
    if (normalized.triangles > authoredTriangleCap || normalized.triangles > hardTriangleCap) {
      throw new RangeError(`Region-scenery template ${definition.id} exceeded its triangle budget.`);
    }
    if (normalized.drawGroups > definition.budget.drawGroups
      || normalized.drawGroups > GENERATION_BUDGET.maximumDrawGroupsPerFamily) {
      throw new RangeError(`Region-scenery template ${definition.id} exceeded its draw-group budget.`);
    }
    for (const key of [
      'sceneLights',
      'colliders',
      'mapEntities',
      'gameplayWrites',
      'navigationWrites',
      'frameAssetAllocations'
    ]) {
      if (normalized[key] !== 0) {
        throw new RangeError(`Region-scenery template ${definition.id} illegally reported ${key}.`);
      }
    }
    return Object.freeze(normalized);
  }

  /**
   * Build the eight extension templates for one realm through a caller-owned renderer adapter. The adapter receives
   * frozen drawing batches and an isolated seeded random stream, then returns one mutable Object3D plus measured
   * metrics. This module never attaches the object to a scene or registers it with maps, collision, or navigation.
   */
  function createRegionTemplates({
    realmId,
    zoneIndex,
    qualityProfile,
    seed,
    primitives
  }) {
    const definitions = getRegionFamilies(realmId);
    const expectedZoneIndex = REGION_IDS.indexOf(realmId);
    if (!Number.isInteger(zoneIndex) || zoneIndex !== expectedZoneIndex) {
      throw new RangeError(
        `Region scenery expected zoneIndex ${expectedZoneIndex} for ${realmId}, received ${String(zoneIndex)}.`
      );
    }
    if (typeof seed !== 'string' || !seed.trim()) {
      throw new TypeError('Region scenery requires a non-empty independent visual seed.');
    }
    if (!primitives || typeof primitives.instantiateTemplate !== 'function') {
      throw new TypeError('Region scenery requires primitives.instantiateTemplate.');
    }
    const qualityKey = resolveQualityKey(qualityProfile);
    const built = definitions.map((definition) => {
      const renderPlan = createRenderPlan(definition, qualityKey);
      const familySeed = `${seed}:region-scenery:${realmId}:${definition.id}`;
      const random = createPresentationRng(familySeed);
      const result = primitives.instantiateTemplate({
        definition,
        renderPlan,
        context: Object.freeze({
          realmId,
          zoneIndex,
          qualityKey,
          familySeed,
          random
        })
      });
      if (!result || (typeof result !== 'object' && typeof result !== 'function')
        || !result.object || typeof result.object !== 'object') {
        throw new TypeError(`Region-scenery adapter did not return an object for ${definition.id}.`);
      }
      const metrics = validateTemplateMetrics(definition, qualityKey, result.metrics);
      const userData = result.object.userData && typeof result.object.userData === 'object'
        ? result.object.userData
        : (result.object.userData = {});
      Object.assign(userData, {
        regionSceneryFamilyId: definition.id,
        regionSceneryRealmId: definition.realmId,
        sceneryCategory: definition.category,
        scenerySubtype: definition.subtype,
        clearanceClass: definition.clearanceClass,
        placementBand: definition.placementBand,
        transitionEligible: definition.transitionEligible,
        transitionPolicy: definition.transitionPolicy,
        sceneLayer: definition.sceneLayer,
        semanticRole: definition.semanticRole,
        motifRepeat: definition.motifRepeat,
        preferredStationM: definition.preferredStationM,
        mapPriority: definition.mapPriority,
        presentationOnly: true,
        collisionAuthority: 'none',
        collisionRole: 'none',
        horizontalRadiusM: metrics.horizontalRadiusM,
        motionEnvelopeM: metrics.motionEnvelopeM
      });
      const measuredFamily = Object.freeze({
        ...definition,
        horizontalRadiusM: metrics.horizontalRadiusM,
        motionEnvelopeM: metrics.motionEnvelopeM
      });
      return Object.freeze({
        object: result.object,
        definition,
        measuredFamily,
        renderPlan,
        metrics
      });
    });

    const landmarks = Object.freeze(built.filter(({ definition }) => definition.category === 'landmark'));
    const environments = Object.freeze(
      built.filter(({ definition }) => definition.category === 'environment')
    );
    const diagnostics = deepFreeze({
      realmId,
      zoneIndex,
      qualityKey,
      familyCount: built.length,
      landmarkCount: landmarks.length,
      environmentCount: environments.length,
      triangles: built.reduce((sum, entry) => sum + entry.metrics.triangles, 0),
      drawGroups: built.reduce((sum, entry) => sum + entry.metrics.drawGroups, 0),
      maximumHorizontalRadiusM: built.reduce(
        (maximum, entry) => Math.max(maximum, entry.metrics.horizontalRadiusM),
        0
      ),
      maximumMotionEnvelopeM: built.reduce(
        (maximum, entry) => Math.max(maximum, entry.metrics.motionEnvelopeM),
        0
      ),
      sceneLights: 0,
      colliders: 0,
      mapEntities: 0,
      gameplayWrites: 0,
      navigationWrites: 0,
      frameAssetAllocations: 0
    });
    if (diagnostics.triangles > GENERATION_BUDGET.maximumTrianglesPerActiveRegion[qualityKey]) {
      throw new RangeError(`Region-scenery templates for ${realmId} exceeded the active-region triangle budget.`);
    }
    return Object.freeze({
      landmarks,
      environments,
      diagnostics
    });
  }

  const authoredBudgetByRegion = deepFreeze(Object.fromEntries(REGION_IDS.map((realmId) => {
    const definitions = getRegionFamilies(realmId);
    return [realmId, {
      desktopTriangles: definitions.reduce(
        (sum, definition) => sum + definition.budget.desktopTriangles,
        0
      ),
      mobileTriangles: definitions.reduce(
        (sum, definition) => sum + definition.budget.mobileTriangles,
        0
      ),
      drawGroups: definitions.reduce((sum, definition) => sum + definition.budget.drawGroups, 0)
    }];
  })));

  const REGION_SCENERY_CONTRACT = deepFreeze({
    version: 2,
    artDirection: 'original-ethereal-pilgrimage-v2',
    inspirationBoundary: {
      copiesSpecificThirdPartyAssets: false,
      copiesSpecificThirdPartyCharacters: false,
      copiesSpecificThirdPartyArchitecture: false
    },
    regionIds: REGION_IDS,
    categoryIds: CATEGORY_IDS,
    subtypeIds: SUBTYPE_IDS,
    scaleClasses: SCALE_CLASSES,
    placementBands: PLACEMENT_BANDS,
    visibilityBands: VISIBILITY_BANDS,
    transitionPolicyByEligibility: TRANSITION_POLICY_BY_ELIGIBILITY,
    allowedSceneLayers: ALLOWED_SCENE_LAYERS,
    placementBandSceneLayer: PLACEMENT_BAND_SCENE_LAYER,
    sceneLanguage: ETHEREAL_PILGRIMAGE_LANGUAGE_V2,
    realmSceneProfiles: REALM_SCENE_PROFILES,
    blueprintLanguageRoles: BLUEPRINT_LANGUAGE_ROLES,
    v2EnvironmentAdditionsByRegion: V2_ENVIRONMENT_ADDITIONS_BY_REGION,
    clearanceClasses: CLEARANCE_CLASSES,
    externalCategorySlots: EXTERNAL_CATEGORY_SLOTS,
    generationBudget: GENERATION_BUDGET,
    authoredBudgetByRegion,
    invariants: {
      presentationOnly: true,
      collisionAuthority: 'none',
      routeAuthority: 'committed-world-path',
      clearanceAuthority: 'complete-road-capsule-query',
      clearanceRadiusMode: 'horizontal-radius-plus-motion-envelope',
      peerClearanceAuthority: 'same-side-visible-bounding-circles',
      transitionLandmarksAllowed: false,
      transitionPolicyAuthority: 'transitionEligible-boolean',
      majorSemanticRole: 'landmark-major',
      environmentSemanticRole: 'environment-cluster',
      allowedSceneLayers: ALLOWED_SCENE_LAYERS,
      placementBandSceneLayer: PLACEMENT_BAND_SCENE_LAYER,
      majorMotifRepeatAllowed: false,
      environmentMotifRepeatAllowed: true,
      maximumVisibleNewMajors: 1,
      maximumVisibleNewEnvironments: 5,
      familyBlueprintLanguageRoles: BLUEPRINT_LANGUAGE_ROLES,
      modernScienceFictionElementsAllowed: false,
      specificAssetCopiesAllowed: false,
      majorStationMode: 'three-even-stations-per-2_700m-realm',
      majorDetailEnterDistanceM: 260,
      majorDetailExitDistanceM: 340,
      presentationDistanceAuthority: 'forward-prewarm-rear-retention-six-plane-film-hysteresis',
      visibilityBandsAddDrawGroups: false,
      deterministicOutwardSearchRequired: true,
      originFallbackAllowed: false,
      radiusShrinkFallbackAllowed: false,
      gameplayRngWrites: 0,
      sceneLights: 0,
      colliders: 0,
      frameAssetAllocations: 0
    }
  });

  return Object.freeze({
    REGION_SCENERY_CONTRACT,
    REGION_IDS,
    familyCatalog,
    getRegionFamilies,
    getFamily,
    validateConfiguredZones,
    createRegionTemplates
  });
})();
