/*
 * Neon original candlelight factory / Neon 原创烛光实体工厂。
 * This module owns pooled presentation objects only; runtime remains authoritative for placement, collision,
 * collection, progression, routing, cadence, and lifecycle membership.
 */
window.NeonCandlelight = (() => {
  'use strict';

  const REGION_IDS = Object.freeze([
    'dawn-isle',
    'prairie-garden',
    'rainforest-glow',
    'twilight-valley',
    'star-vault',
    'eden-eye'
  ]);
  const ALLOWED_AMBIENT_SCENE_LAYERS = Object.freeze(['roadside', 'terrain']);
  const COLLECTIBLE_HALF_M = 0.62;
  const MAXIMUM_AUTHORED_OPAQUE_RADIUS_M = 0.518_5;
  const MAXIMUM_ANIMATED_OPAQUE_HALF_M = 0.56;
  const MAXIMUM_CORE_SCALE = 1.08;
  const HALO_OUTER_RADIUS_M = 0.96;
  const TRAIL_LENGTH_M = 2.32;
  const AMBIENT_MAXIMUM_BRIGHTNESS_RATIO = 0.45;
  const AMBIENT_FLAME_HEIGHT_M = 0.42;
  const COLLECTIBLE_FLAME_BASE_OPACITY = 0.92;
  const COLLECTIBLE_FLAME_MINIMUM_PULSE_MULTIPLIER = 0.88;
  const AMBIENT_FLAME_BASE_OPACITY = 0.35;
  const AMBIENT_MAXIMUM_FLAME_CHANNEL_RATIO = AMBIENT_FLAME_BASE_OPACITY
    / (COLLECTIBLE_FLAME_BASE_OPACITY * COLLECTIBLE_FLAME_MINIMUM_PULSE_MULTIPLIER);
  const TAU = Math.PI * 2;

  /** Deep-freeze public catalogs while keeping instantiated Three.js objects outside the contract graph. */
  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) {
      return value;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
  }

  // Both candle categories use natural dielectric opaque vessels. Bloom belongs only to explicit emissive
  // effects, so a future material pass cannot reintroduce metallic sci-fi highlights through pooled clones.
  const CANDLELIGHT_ART_CONTRACT = deepFreeze({
    version: 2,
    visualLanguage: 'six-realm-candle-star-memory-reliquaries',
    opaqueSurfaceLanguage: 'matte-natural-dielectric-stone-and-ceramic',
    collectibleOpaqueMetalness: 0,
    ambientOpaqueMetalness: 0,
    effectAuthority: 'transparent-emissive-bloom-only',
    haloRole: 'collision-free-world-space-readability',
    bloomPreserved: true,
    localLightCount: 0,
    modernMechanicalPartCount: 0,
    neonFixtureCount: 0
  });

  const CANDLELIGHT_CONTRACT = deepFreeze({
    version: 2,
    artDirection: CANDLELIGHT_ART_CONTRACT,
    ownership: 'presentation-only',
    regionIds: REGION_IDS,
    collectible: {
      familyCount: 12,
      familiesPerRegion: 2,
      sceneLayer: 'route',
      semanticRole: 'pickup-candle',
      collisionRole: 'gameplay-aabb',
      colliderHalfM: COLLECTIBLE_HALF_M,
      maximumAuthoredOpaqueRadiusM: MAXIMUM_AUTHORED_OPAQUE_RADIUS_M,
      maximumAnimatedOpaqueHalfM: MAXIMUM_ANIMATED_OPAQUE_HALF_M,
      maximumCoreAnimationScale: MAXIMUM_CORE_SCALE,
      authoredFlameBaseOpacity: COLLECTIBLE_FLAME_BASE_OPACITY,
      minimumFlamePulseMultiplier: COLLECTIBLE_FLAME_MINIMUM_PULSE_MULTIPLIER,
      haloOuterRadiusM: HALO_OUTER_RADIUS_M,
      maximumTrailLengthM: 2.4,
      authoredTrailLengthM: TRAIL_LENGTH_M,
      readabilityDistanceM: {
        minimum: 180,
        speedMultiplierSeconds: 1.6,
        atReferenceSpeedMps: 480
      },
      fogParticipation: false,
      minimumCoreRoadContrastRatio: 4.5,
      generationMultiplierByRegion: {
        'dawn-isle': 1,
        'prairie-garden': 1,
        'rainforest-glow': 1,
        'twilight-valley': 1,
        'star-vault': 1,
        'eden-eye': 1
      },
      budget: {
        desktopTrianglesPerFamily: 1_200,
        mobileTrianglesPerFamily: 450,
        maximumDrawGroups: 4,
        maximumMaterials: 4,
        sceneLights: 0
      }
    },
    ambient: {
      familyCount: 6,
      familiesPerRegion: 1,
      category: 'ambient-candlelight',
      sceneLayer: 'roadside',
      allowedSceneLayers: ALLOWED_AMBIENT_SCENE_LAYERS,
      semanticRole: 'ambient-candlelight',
      collisionRole: 'none',
      pickupRole: 'none',
      mapPriority: 0,
      roadClearanceM: 3,
      sameSideGroupClearanceM: 4,
      maximumCollectibleBrightnessRatio: AMBIENT_MAXIMUM_BRIGHTNESS_RATIO,
      authoredFlameBaseOpacity: AMBIENT_FLAME_BASE_OPACITY,
      authoredMaximumFlameChannelRatio: AMBIENT_MAXIMUM_FLAME_CHANNEL_RATIO,
      maximumSingleFlameHeightM: 0.45,
      authoredSingleFlameHeightM: AMBIENT_FLAME_HEIGHT_M,
      fogParticipation: true,
      budget: {
        desktopTrianglesPerCluster: 1_500,
        mobileTrianglesPerCluster: 500,
        maximumDrawGroups: 2,
        maximumMaterials: 2,
        requiresBatchingOrInstancing: true,
        sceneLights: 0
      }
    },
    invariants: {
      independentVisualRandomness: true,
      zeroFrameAssetAllocationsAfterPrewarm: true,
      deepClonedMutableMaterials: true,
      idempotentPoolReset: true,
      reducedMotionStopsDecorationOnly: true,
      haloIsCollectionRange: false,
      presentationWritesOnly: true,
      lightsCreated: 0
    }
  });

  const REGION_STYLE_CATALOG = deepFreeze({
    'dawn-isle': {
      realmId: 'dawn-isle',
      zoneIndex: 0,
      collectibleFamilyIds: ['winged-flame-vessel', 'sun-petal-lantern'],
      ambientFamilyId: 'dawn-pilgrim-flame-circle',
      colors: {
        vessel: 0xd8_bf8b,
        core: 0xff_f0b5,
        glow: 0xff_e5a8,
        trail: 0x9f_e7df,
        ambientStone: 0xa7_8054
      },
      collectibleBrightness: 1.44,
      ambientBrightness: 0.62
    },
    'prairie-garden': {
      realmId: 'prairie-garden',
      zoneIndex: 1,
      collectibleFamilyIds: ['bellflower-flame', 'butterfly-lantern'],
      ambientFamilyId: 'prairie-windbell-candle-grove',
      colors: {
        vessel: 0xa8_c990,
        core: 0xff_f2ae,
        glow: 0xf7_f4b9,
        trail: 0xa6_d7ff,
        ambientStone: 0x83_a574
      },
      collectibleBrightness: 1.38,
      ambientBrightness: 0.58
    },
    'rainforest-glow': {
      realmId: 'rainforest-glow',
      zoneIndex: 2,
      collectibleFamilyIds: ['firefly-pod', 'waterdrop-flame'],
      ambientFamilyId: 'rainforest-rain-shelter-candle-niche',
      colors: {
        vessel: 0x5f_806d,
        core: 0xff_e7a3,
        glow: 0x9f_e7df,
        trail: 0xb8_ef91,
        ambientStone: 0x47_6857
      },
      collectibleBrightness: 1.46,
      ambientBrightness: 0.64
    },
    'twilight-valley': {
      realmId: 'twilight-valley',
      zoneIndex: 3,
      collectibleFamilyIds: ['racing-comet-flame', 'ice-feather-lantern'],
      ambientFamilyId: 'twilight-memory-candleline',
      colors: {
        vessel: 0xc1_9ab4,
        core: 0xff_e0aa,
        glow: 0xff_d884,
        trail: 0xbd_a7ff,
        ambientStone: 0x8d_718c
      },
      collectibleBrightness: 1.42,
      ambientBrightness: 0.61
    },
    'star-vault': {
      realmId: 'star-vault',
      zoneIndex: 4,
      collectibleFamilyIds: ['constellation-flame', 'astrolabe-lantern'],
      ambientFamilyId: 'vault-orbit-candle-ring',
      colors: {
        vessel: 0x68_6784,
        core: 0xff_edb8,
        glow: 0xbd_a7ff,
        trail: 0x9f_e7df,
        ambientStone: 0x4f_4d70
      },
      collectibleBrightness: 1.48,
      ambientBrightness: 0.65
    },
    'eden-eye': {
      realmId: 'eden-eye',
      zoneIndex: 5,
      collectibleFamilyIds: ['shielded-ember-flame', 'fractured-wing-lantern'],
      ambientFamilyId: 'eden-sheltered-ember-vigil',
      colors: {
        vessel: 0x65_5054,
        core: 0xff_d3a2,
        glow: 0xf0_6e76,
        trail: 0xff_b58f,
        ambientStone: 0x43_343b
      },
      collectibleBrightness: 1.52,
      ambientBrightness: 0.66
    }
  });

  function defineCollectible({
    id,
    realmId,
    labelZh,
    labelEn,
    geometrySignature,
    profile,
    desktopSegments,
    mobileSegments,
    haloTiltRad,
    flameLeanRad,
    spinDirection
  }) {
    return {
      id,
      realmId,
      zoneIndex: REGION_IDS.indexOf(realmId),
      category: 'collectible',
      labelZh,
      labelEn,
      sceneLayer: 'route',
      semanticRole: 'pickup-candle',
      collisionRole: 'gameplay-aabb',
      readabilityClass: 'world-candle-cue',
      motionKind: 'decorative-spin-pulse',
      geometrySignature,
      collider: {
        kind: 'aabb',
        half: {
          x: COLLECTIBLE_HALF_M,
          y: COLLECTIBLE_HALF_M,
          z: COLLECTIBLE_HALF_M
        },
        authority: 'runtime'
      },
      visualEnvelope: {
        maximumAuthoredOpaqueRadiusM: MAXIMUM_AUTHORED_OPAQUE_RADIUS_M,
        maximumAnimatedOpaqueHalfM: MAXIMUM_ANIMATED_OPAQUE_HALF_M,
        maximumCoreScale: MAXIMUM_CORE_SCALE,
        haloOuterRadiusM: HALO_OUTER_RADIUS_M,
        trailLengthM: TRAIL_LENGTH_M,
        overflowMustBeCollisionFreeEffect: true
      },
      readability: {
        minimumDistanceM: 180,
        speedMultiplierSeconds: 1.6,
        referenceSpeedMps: 45,
        referenceDistanceM: 180,
        minimumCoreRoadContrastRatio: 4.5,
        cueKind: 'world-space-emissive',
        fogParticipation: false
      },
      presentationOnly: true,
      lightCount: 0,
      recipe: {
        profile,
        desktopSegments,
        mobileSegments,
        haloTiltRad,
        flameLeanRad,
        spinDirection
      }
    };
  }

  const COLLECTIBLE_FAMILY_CATALOG = deepFreeze([
    defineCollectible({
      id: 'winged-flame-vessel',
      realmId: 'dawn-isle',
      labelZh: '翼焰圣盏',
      labelEn: 'Winged Flame Vessel',
      geometrySignature: 'dawn-swept-wing-cup-6',
      profile: [[-0.36, 0.10], [-0.28, 0.29], [-0.08, 0.34], [0.12, 0.25], [0.28, 0.14], [0.37, 0.05]],
      desktopSegments: 18,
      mobileSegments: 9,
      haloTiltRad: 0.26,
      flameLeanRad: -0.12,
      spinDirection: 1
    }),
    defineCollectible({
      id: 'sun-petal-lantern',
      realmId: 'dawn-isle',
      labelZh: '日瓣灯盏',
      labelEn: 'Sun Petal Lantern',
      geometrySignature: 'dawn-sun-petal-bulb-7',
      profile: [[-0.34, 0.13], [-0.24, 0.31], [-0.08, 0.27], [0.05, 0.35], [0.18, 0.28], [0.29, 0.16], [0.36, 0.055]],
      desktopSegments: 20,
      mobileSegments: 10,
      haloTiltRad: -0.20,
      flameLeanRad: 0.08,
      spinDirection: -1
    }),
    defineCollectible({
      id: 'bellflower-flame',
      realmId: 'prairie-garden',
      labelZh: '风铃花焰',
      labelEn: 'Bellflower Flame',
      geometrySignature: 'prairie-bellflower-skirt-6',
      profile: [[-0.37, 0.22], [-0.29, 0.34], [-0.13, 0.31], [0.04, 0.20], [0.24, 0.12], [0.37, 0.045]],
      desktopSegments: 21,
      mobileSegments: 9,
      haloTiltRad: 0.38,
      flameLeanRad: -0.06,
      spinDirection: -1
    }),
    defineCollectible({
      id: 'butterfly-lantern',
      realmId: 'prairie-garden',
      labelZh: '蝶翼灵灯',
      labelEn: 'Butterfly Lantern',
      geometrySignature: 'prairie-butterfly-waist-8',
      profile: [[-0.35, 0.08], [-0.27, 0.25], [-0.15, 0.34], [-0.03, 0.18], [0.09, 0.32], [0.21, 0.26], [0.32, 0.11], [0.38, 0.04]],
      desktopSegments: 16,
      mobileSegments: 8,
      haloTiltRad: -0.42,
      flameLeanRad: 0.14,
      spinDirection: 1
    }),
    defineCollectible({
      id: 'firefly-pod',
      realmId: 'rainforest-glow',
      labelZh: '萤辉荚灯',
      labelEn: 'Firefly Pod',
      geometrySignature: 'rainforest-firefly-pod-7',
      profile: [[-0.38, 0.055], [-0.30, 0.19], [-0.18, 0.31], [0, 0.35], [0.18, 0.28], [0.31, 0.13], [0.37, 0.045]],
      desktopSegments: 17,
      mobileSegments: 8,
      haloTiltRad: 0.14,
      flameLeanRad: -0.15,
      spinDirection: 1
    }),
    defineCollectible({
      id: 'waterdrop-flame',
      realmId: 'rainforest-glow',
      labelZh: '雨滴烛焰',
      labelEn: 'Waterdrop Flame',
      geometrySignature: 'rainforest-inverted-rain-drop-6',
      profile: [[-0.37, 0.045], [-0.25, 0.18], [-0.08, 0.32], [0.12, 0.35], [0.29, 0.19], [0.38, 0.04]],
      desktopSegments: 22,
      mobileSegments: 10,
      haloTiltRad: -0.30,
      flameLeanRad: 0.05,
      spinDirection: -1
    }),
    defineCollectible({
      id: 'racing-comet-flame',
      realmId: 'twilight-valley',
      labelZh: '竞速彗焰',
      labelEn: 'Racing Comet Flame',
      geometrySignature: 'twilight-comet-taper-7',
      profile: [[-0.35, 0.07], [-0.28, 0.27], [-0.13, 0.35], [0.02, 0.30], [0.16, 0.22], [0.29, 0.10], [0.38, 0.035]],
      desktopSegments: 19,
      mobileSegments: 9,
      haloTiltRad: 0.52,
      flameLeanRad: -0.18,
      spinDirection: 1
    }),
    defineCollectible({
      id: 'ice-feather-lantern',
      realmId: 'twilight-valley',
      labelZh: '冰羽灯盏',
      labelEn: 'Ice Feather Lantern',
      geometrySignature: 'twilight-ice-feather-facet-8',
      profile: [[-0.36, 0.12], [-0.30, 0.30], [-0.20, 0.23], [-0.08, 0.35], [0.08, 0.24], [0.20, 0.29], [0.32, 0.12], [0.37, 0.045]],
      desktopSegments: 14,
      mobileSegments: 7,
      haloTiltRad: -0.56,
      flameLeanRad: 0.16,
      spinDirection: -1
    }),
    defineCollectible({
      id: 'constellation-flame',
      realmId: 'star-vault',
      labelZh: '星座烛焰',
      labelEn: 'Constellation Flame',
      geometrySignature: 'vault-constellation-tier-9',
      profile: [[-0.35, 0.09], [-0.29, 0.27], [-0.20, 0.21], [-0.12, 0.34], [-0.01, 0.24], [0.10, 0.33], [0.21, 0.20], [0.31, 0.13], [0.38, 0.04]],
      desktopSegments: 15,
      mobileSegments: 7,
      haloTiltRad: 0.64,
      flameLeanRad: -0.04,
      spinDirection: 1
    }),
    defineCollectible({
      id: 'astrolabe-lantern',
      realmId: 'star-vault',
      labelZh: '星盘灵灯',
      labelEn: 'Astrolabe Lantern',
      geometrySignature: 'vault-astrolabe-disc-7',
      profile: [[-0.34, 0.16], [-0.27, 0.33], [-0.14, 0.25], [0, 0.35], [0.14, 0.25], [0.28, 0.31], [0.37, 0.05]],
      desktopSegments: 24,
      mobileSegments: 11,
      haloTiltRad: -0.68,
      flameLeanRad: 0.10,
      spinDirection: -1
    }),
    defineCollectible({
      id: 'shielded-ember-flame',
      realmId: 'eden-eye',
      labelZh: '护烬烛焰',
      labelEn: 'Shielded Ember Flame',
      geometrySignature: 'eden-shielded-ember-vault-8',
      profile: [[-0.37, 0.11], [-0.31, 0.30], [-0.20, 0.35], [-0.06, 0.29], [0.08, 0.34], [0.20, 0.24], [0.31, 0.14], [0.38, 0.045]],
      desktopSegments: 13,
      mobileSegments: 6,
      haloTiltRad: 0.34,
      flameLeanRad: -0.20,
      spinDirection: -1
    }),
    defineCollectible({
      id: 'fractured-wing-lantern',
      realmId: 'eden-eye',
      labelZh: '裂翼灯盏',
      labelEn: 'Fractured Wing Lantern',
      geometrySignature: 'eden-fractured-wing-spindle-10',
      profile: [[-0.36, 0.07], [-0.30, 0.24], [-0.23, 0.33], [-0.14, 0.22], [-0.05, 0.35], [0.05, 0.20], [0.14, 0.31], [0.24, 0.19], [0.32, 0.11], [0.38, 0.035]],
      desktopSegments: 12,
      mobileSegments: 6,
      haloTiltRad: -0.36,
      flameLeanRad: 0.22,
      spinDirection: 1
    })
  ]);

  function defineAmbient({
    id,
    realmId,
    labelZh,
    labelEn,
    geometrySignature,
    layoutKind,
    candleCount,
    baseRadiusM,
    baseHeightM
  }) {
    return {
      id,
      realmId,
      zoneIndex: REGION_IDS.indexOf(realmId),
      category: 'ambient-candlelight',
      labelZh,
      labelEn,
      placementBand: 'ground-mid',
      clearanceClass: 'ambient-candlelight-ground',
      roadClearanceM: 3,
      sameSideGroupClearanceM: 4,
      sceneLayer: 'roadside',
      allowedSceneLayers: ALLOWED_AMBIENT_SCENE_LAYERS,
      semanticRole: 'ambient-candlelight',
      mapPriority: 0,
      collisionRole: 'none',
      pickupRole: 'none',
      presentationOnly: true,
      geometrySignature,
      brightnessRatioToCollectible: REGION_STYLE_CATALOG[realmId].ambientBrightness
        / REGION_STYLE_CATALOG[realmId].collectibleBrightness,
      singleFlameHeightM: AMBIENT_FLAME_HEIGHT_M,
      lightCount: 0,
      batching: 'instanced-mesh',
      recipe: {
        layoutKind,
        candleCount,
        baseRadiusM,
        baseHeightM
      }
    };
  }

  const AMBIENT_FAMILY_CATALOG = deepFreeze([
    defineAmbient({
      id: 'dawn-pilgrim-flame-circle',
      realmId: 'dawn-isle',
      labelZh: '晨岛旅焰环',
      labelEn: 'Dawn Pilgrim Flame Circle',
      geometrySignature: 'dawn-pilgrim-circle-7',
      layoutKind: 'pilgrim-circle',
      candleCount: 7,
      baseRadiusM: 0.11,
      baseHeightM: 0.18
    }),
    defineAmbient({
      id: 'prairie-windbell-candle-grove',
      realmId: 'prairie-garden',
      labelZh: '云野风铃烛林',
      labelEn: 'Prairie Windbell Candle Grove',
      geometrySignature: 'prairie-windbell-grove-8',
      layoutKind: 'windbell-grove',
      candleCount: 8,
      baseRadiusM: 0.10,
      baseHeightM: 0.20
    }),
    defineAmbient({
      id: 'rainforest-rain-shelter-candle-niche',
      realmId: 'rainforest-glow',
      labelZh: '雨林避雨烛龛',
      labelEn: 'Rainforest Rain Shelter Candle Niche',
      geometrySignature: 'rainforest-shelter-niche-6',
      layoutKind: 'shelter-niche',
      candleCount: 6,
      baseRadiusM: 0.12,
      baseHeightM: 0.16
    }),
    defineAmbient({
      id: 'twilight-memory-candleline',
      realmId: 'twilight-valley',
      labelZh: '霞谷忆光烛列',
      labelEn: 'Twilight Memory Candleline',
      geometrySignature: 'twilight-memory-line-8',
      layoutKind: 'memory-line',
      candleCount: 8,
      baseRadiusM: 0.095,
      baseHeightM: 0.22
    }),
    defineAmbient({
      id: 'vault-orbit-candle-ring',
      realmId: 'star-vault',
      labelZh: '禁阁星轨烛环',
      labelEn: 'Vault Orbit Candle Ring',
      geometrySignature: 'vault-orbit-ring-8',
      layoutKind: 'orbit-ring',
      candleCount: 8,
      baseRadiusM: 0.105,
      baseHeightM: 0.19
    }),
    defineAmbient({
      id: 'eden-sheltered-ember-vigil',
      realmId: 'eden-eye',
      labelZh: '伊甸庇烬守望',
      labelEn: 'Eden Sheltered Ember Vigil',
      geometrySignature: 'eden-sheltered-vigil-7',
      layoutKind: 'sheltered-vigil',
      candleCount: 7,
      baseRadiusM: 0.12,
      baseHeightM: 0.17
    })
  ]);

  const FAMILY_CATALOG = deepFreeze([
    ...COLLECTIBLE_FAMILY_CATALOG,
    ...AMBIENT_FAMILY_CATALOG
  ]);
  const familyById = new Map(FAMILY_CATALOG.map((definition) => [definition.id, definition]));
  const collectibleById = new Map(
    COLLECTIBLE_FAMILY_CATALOG.map((definition) => [definition.id, definition])
  );
  const ambientById = new Map(AMBIENT_FAMILY_CATALOG.map((definition) => [definition.id, definition]));

  function describe(familyId) {
    const definition = familyById.get(familyId);
    if (!definition) throw new RangeError(`Unknown candlelight family: ${familyId}`);
    return definition;
  }

  function getRegionStyle(realmId) {
    const style = REGION_STYLE_CATALOG[realmId];
    if (!style) throw new RangeError(`Unknown candlelight region: ${realmId}`);
    return style;
  }

  /**
   * Validate only the existing config taxonomy. The module's frozen catalog remains sufficient when config is absent,
   * while an explicitly supplied config must match every region/family mapping exactly.
   */
  function validateZones(zonesInput) {
    if (zonesInput === undefined || zonesInput === null) return true;
    const zones = Array.isArray(zonesInput) ? zonesInput : zonesInput.zones;
    if (!Array.isArray(zones) || zones.length !== REGION_IDS.length) {
      throw new Error('Candlelight config must provide the exact six-zone array.');
    }
    for (let zoneIndex = 0; zoneIndex < REGION_IDS.length; zoneIndex++) {
      const zone = zones[zoneIndex];
      const expectedStyle = REGION_STYLE_CATALOG[REGION_IDS[zoneIndex]];
      if (zone?.id !== expectedStyle.realmId) {
        throw new Error(`Candlelight config expected zone ${expectedStyle.realmId} at index ${zoneIndex}.`);
      }
      const configuredFamilies = zone?.pickupStyle?.families;
      if (!Array.isArray(configuredFamilies)
        || configuredFamilies.length !== expectedStyle.collectibleFamilyIds.length
        || configuredFamilies.some(
          (familyId, familyIndex) => familyId !== expectedStyle.collectibleFamilyIds[familyIndex]
        )) {
        throw new Error(`Candlelight config family mapping drifted for ${expectedStyle.realmId}.`);
      }
    }
    return true;
  }

  function hashSeed(input) {
    const text = String(input);
    let hash = 2_166_136_261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0 || 1;
  }

  function createVisualRng(seedInput) {
    let state = hashSeed(seedInput);
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4_294_967_296;
    };
  }

  function triangleCount(geometry) {
    if (!geometry?.isBufferGeometry) return 0;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    return Math.floor((index ? index.count : position?.count || 0) / 3);
  }

  function normalizeConstructionQuality(qualityProfile) {
    const id = typeof qualityProfile === 'string' ? qualityProfile : qualityProfile?.id;
    return id === 'mobile' ? 'mobile' : 'desktop';
  }

  function normalizeRenderQuality(quality) {
    const id = String(typeof quality === 'string' ? quality : quality?.id || 'high').toLowerCase();
    if (!['low', 'medium', 'high'].includes(id)) {
      throw new RangeError(`Unsupported candlelight render quality: ${quality}`);
    }
    return id;
  }

  function renderQualityMultiplier(quality) {
    if (quality === 'low') return 0.70;
    if (quality === 'medium') return 0.84;
    return 1;
  }

  function assertMatchingRealm(definition, options = {}) {
    if (options.realmId !== undefined && options.realmId !== definition.realmId) {
      throw new Error(
        `Candlelight family ${definition.id} belongs to ${definition.realmId}, not ${options.realmId}.`
      );
    }
    if (options.zoneIndex !== undefined && options.zoneIndex !== definition.zoneIndex) {
      throw new Error(
        `Candlelight family ${definition.id} belongs to zoneIndex ${definition.zoneIndex}, not ${options.zoneIndex}.`
      );
    }
  }

  /**
   * Create a renderer adapter without owning a scene. The caller alone adds/removes returned Object3D instances
   * and keeps all simulation arrays authoritative.
   */
  function createFactory(options = {}) {
    const THREE = options.THREE || window.THREE;
    const modeling = options.modeling || window.NeonModeling;
    if (!THREE?.Group || !THREE?.Mesh || !THREE?.InstancedMesh) {
      throw new Error('NeonCandlelight.createFactory requires a complete THREE namespace.');
    }
    if (typeof modeling?.createRadialGeometry !== 'function'
      || typeof modeling?.analyzeTopology !== 'function') {
      throw new Error('NeonCandlelight.createFactory requires NeonModeling geometry and topology helpers.');
    }
    validateZones(options.zones);

    const constructionQuality = normalizeConstructionQuality(options.qualityProfile);
    let renderQuality = normalizeRenderQuality(
      options.renderQuality
        || (constructionQuality === 'mobile' ? 'low' : 'high')
    );
    const visualSeed = String(options.visualSeed ?? options.seed ?? 'neon-candlelight-visual');
    if (visualSeed.trim() === '') throw new Error('Candlelight visualSeed must be non-empty.');
    const mainMarker = options.markMainVisual || modeling.markMainVisual;
    const effectMarker = options.markEffect || modeling.markEffect;
    const tagBloom = typeof options.tagBloom === 'function' ? options.tagBloom : null;
    const collectibleTemplates = new Map();
    const ambientTemplates = new Map();
    const collectiblePools = new Map(
      COLLECTIBLE_FAMILY_CATALOG.map((definition) => [definition.id, []])
    );
    const ambientPools = new Map(
      AMBIENT_FAMILY_CATALOG.map((definition) => [definition.id, []])
    );
    const activeCollectibles = new Set();
    const activeAmbientClusters = new Set();
    const allCollectibleInstances = new Set();
    const allAmbientClusters = new Set();
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    let disposed = false;
    let acquireSerial = 0;
    let prewarmedCollectibles = 0;
    let prewarmedAmbientClusters = 0;
    let prewarmComplete = false;
    let collectibleAssetAllocationsDuringAcquire = 0;
    let ambientAssetAllocationsDuringAcquire = 0;
    let releaseCount = 0;
    let disposalPasses = 0;

    function assertLive(action) {
      if (disposed) throw new Error(`Candlelight factory is disposed; cannot ${action}.`);
    }

    function markMain(object, definition) {
      object.userData.collisionFree = false;
      object.userData.opaqueCore = true;
      object.userData.candlelightFamilyId = definition.id;
      object.userData.candlelightRealmId = definition.realmId;
      if (typeof mainMarker === 'function') {
        mainMarker(object, {
          family: definition.id,
          zoneId: definition.realmId,
          collisionRole: definition.collisionRole,
          semanticRole: definition.semanticRole
        });
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material) material.fog = false;
      }
      return object;
    }

    function markEffectNode(object, reason, fogParticipation = false) {
      object.userData.collisionFree = true;
      object.userData.candlelightEffect = true;
      object.castShadow = false;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.fog = fogParticipation;
      }
      if (typeof effectMarker === 'function') effectMarker(object, reason);
      return object;
    }

    function markBloom(object) {
      object.userData.neonBloom = true;
      if (tagBloom) tagBloom(object, true);
    }

    function makeCollectibleSourceMaterials(style) {
      const core = new THREE.MeshStandardMaterial({
        color: style.colors.vessel,
        emissive: style.colors.core,
        emissiveIntensity: style.collectibleBrightness,
        metalness: CANDLELIGHT_ART_CONTRACT.collectibleOpaqueMetalness,
        roughness: 0.40,
        transparent: false,
        depthWrite: true,
        fog: false
      });
      const flame = new THREE.MeshBasicMaterial({
        color: style.colors.core,
        transparent: true,
        opacity: COLLECTIBLE_FLAME_BASE_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      });
      const halo = new THREE.MeshBasicMaterial({
        color: style.colors.glow,
        transparent: true,
        opacity: 0.54,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      });
      const trail = new THREE.MeshBasicMaterial({
        color: style.colors.trail,
        transparent: true,
        opacity: 0.30,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide
      });
      return { core, flame, halo, trail };
    }

    /**
     * Clone each mutable source material once per instance. The source→clone map preserves intentional sharing
     * inside one instance while isolating uniforms and callbacks from every other live or pooled instance.
     */
    function cloneMaterialSet(sourceMaterials) {
      const clones = new Map();
      const cloneOne = (sourceMaterial) => {
        if (clones.has(sourceMaterial)) return clones.get(sourceMaterial);
        const clone = sourceMaterial.clone();
        clone.onBeforeCompile = sourceMaterial.onBeforeCompile;
        clone.customProgramCacheKey = sourceMaterial.customProgramCacheKey;
        clones.set(sourceMaterial, clone);
        return clone;
      };
      return {
        core: cloneOne(sourceMaterials.core),
        flame: cloneOne(sourceMaterials.flame),
        halo: cloneOne(sourceMaterials.halo),
        trail: cloneOne(sourceMaterials.trail)
      };
    }

    function buildCollectibleTemplate(definition) {
      if (collectibleTemplates.has(definition.id)) return collectibleTemplates.get(definition.id);
      const style = getRegionStyle(definition.realmId);
      const segmentCount = constructionQuality === 'mobile'
        ? definition.recipe.mobileSegments
        : definition.recipe.desktopSegments;
      const coreGeometry = modeling.createRadialGeometry({
        THREE,
        profile: definition.recipe.profile,
        segments: segmentCount,
        axis: 'y',
        capStart: true,
        capEnd: true
      });
      const flameGeometry = modeling.createRadialGeometry({
        THREE,
        profile: [[-0.12, 0.07], [0.015, 0.13], [0.18, 0.075], [0.31, 0.025]],
        segments: constructionQuality === 'mobile' ? 6 : 10,
        axis: 'y',
        capStart: true,
        capEnd: true
      });
      const haloGeometry = new THREE.TorusGeometry(
        0.93,
        0.03,
        constructionQuality === 'mobile' ? 3 : 4,
        constructionQuality === 'mobile' ? 12 : 24
      );
      const trailGeometry = new THREE.ConeGeometry(
        0.085,
        TRAIL_LENGTH_M,
        constructionQuality === 'mobile' ? 5 : 9,
        1,
        false
      );
      for (const geometry of [coreGeometry, flameGeometry, haloGeometry, trailGeometry]) {
        geometry.userData.candlelightImmutableGeometry = true;
        // The shared modeling cache owns the cross-module key; pooled candle instances must not rescan one
        // immutable topology hundreds of times in modelDebug mode.
        geometry.userData.neonImmutableTopology = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
      const maximumAnimatedRadiusM = coreGeometry.boundingSphere.radius * MAXIMUM_CORE_SCALE;
      if (coreGeometry.boundingSphere.radius > MAXIMUM_AUTHORED_OPAQUE_RADIUS_M + 0.000_001
        || maximumAnimatedRadiusM > MAXIMUM_ANIMATED_OPAQUE_HALF_M + 0.000_001) {
        throw new Error(`Collectible opaque envelope exceeds its collider contract: ${definition.id}.`);
      }
      const sourceMaterials = makeCollectibleSourceMaterials(style);
      const triangles = [coreGeometry, flameGeometry, haloGeometry, trailGeometry]
        .reduce((sum, geometry) => sum + triangleCount(geometry), 0);
      const budgetLimit = constructionQuality === 'mobile'
        ? CANDLELIGHT_CONTRACT.collectible.budget.mobileTrianglesPerFamily
        : CANDLELIGHT_CONTRACT.collectible.budget.desktopTrianglesPerFamily;
      if (triangles > budgetLimit) {
        throw new Error(`Collectible triangle budget exceeded for ${definition.id}: ${triangles}.`);
      }
      const topology = modeling.analyzeTopology(coreGeometry);
      if (!topology.isClosed) {
        throw new Error(`Collectible opaque core is not watertight: ${definition.id}.`);
      }
      const template = {
        definition,
        style,
        geometries: {
          core: coreGeometry,
          flame: flameGeometry,
          halo: haloGeometry,
          trail: trailGeometry
        },
        sourceMaterials,
        metrics: {
          triangles,
          drawGroups: 4,
          materials: 4,
          lights: 0,
          maximumAuthoredOpaqueRadiusM: coreGeometry.boundingSphere.radius,
          maximumAnimatedOpaqueRadiusM: maximumAnimatedRadiusM
        },
        topology
      };
      collectibleTemplates.set(definition.id, template);
      return template;
    }

    function instantiateCollectible(definition, poolOrdinal) {
      const template = buildCollectibleTemplate(definition);
      const materials = cloneMaterialSet(template.sourceMaterials);
      const root = new THREE.Group();
      root.name = `Neon.Candlelight.${definition.id}`;
      const core = markMain(
        new THREE.Mesh(template.geometries.core, materials.core),
        definition
      );
      core.name = 'Neon.Candlelight.OpaqueCore';
      core.castShadow = true;
      core.receiveShadow = true;
      const flame = markEffectNode(
        new THREE.Mesh(template.geometries.flame, materials.flame),
        'collectible-flame'
      );
      flame.name = 'Neon.Candlelight.FlameEffect';
      flame.position.y = 0.35;
      flame.rotation.z = definition.recipe.flameLeanRad;
      const halo = markEffectNode(
        new THREE.Mesh(template.geometries.halo, materials.halo),
        'collectible-world-space-halo'
      );
      halo.name = 'Neon.Candlelight.HaloEffect';
      halo.rotation.x = definition.recipe.haloTiltRad;
      halo.userData.outerRadiusM = HALO_OUTER_RADIUS_M;
      halo.userData.collectionRange = false;
      const trail = markEffectNode(
        new THREE.Mesh(template.geometries.trail, materials.trail),
        'collectible-soft-trail'
      );
      trail.name = 'Neon.Candlelight.TrailEffect';
      trail.rotation.x = Math.PI / 2;
      trail.position.z = TRAIL_LENGTH_M / 2;
      trail.userData.lengthM = TRAIL_LENGTH_M;
      root.add(core, flame, halo, trail);
      for (const emitter of [core, flame, halo, trail]) markBloom(emitter);
      const seededRng = createVisualRng(
        `${visualSeed}:collectible:${definition.id}:${poolOrdinal}`
      );
      root.userData = {
        candlelightFactory: true,
        candlelightKind: 'collectible',
        familyId: definition.id,
        realmId: definition.realmId,
        zoneIndex: definition.zoneIndex,
        category: definition.category,
        sceneLayer: definition.sceneLayer,
        semanticRole: definition.semanticRole,
        collisionRole: definition.collisionRole,
        fogParticipation: false,
        geometrySignature: definition.geometrySignature,
        colliderHalfM: COLLECTIBLE_HALF_M,
        haloOuterRadiusM: HALO_OUTER_RADIUS_M,
        trailLengthM: TRAIL_LENGTH_M,
        visualSeedPhaseA: seededRng() * TAU,
        visualSeedPhaseB: seededRng() * TAU,
        visualSpinRate: 0.68 + seededRng() * 0.44,
        released: true,
        handles: {
          core,
          flame,
          halo,
          trail,
          baseCoreEmissiveIntensity: template.style.collectibleBrightness,
          baseFlameOpacity: COLLECTIBLE_FLAME_BASE_OPACITY,
          baseHaloOpacity: 0.54,
          baseTrailOpacity: 0.30,
          haloTiltRad: definition.recipe.haloTiltRad,
          flameLeanRad: definition.recipe.flameLeanRad,
          spinDirection: definition.recipe.spinDirection
        }
      };
      root.visible = false;
      allCollectibleInstances.add(root);
      return root;
    }

    function makeAmbientSourceMaterials(style) {
      const base = new THREE.MeshStandardMaterial({
        color: style.colors.ambientStone,
        emissive: style.colors.core,
        emissiveIntensity: style.ambientBrightness * 0.18,
        metalness: CANDLELIGHT_ART_CONTRACT.ambientOpaqueMetalness,
        roughness: 0.88,
        transparent: false,
        depthWrite: true,
        fog: true
      });
      const flame = new THREE.MeshBasicMaterial({
        color: style.colors.core,
        transparent: true,
        opacity: AMBIENT_FLAME_BASE_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true
      });
      return { base, flame };
    }

    function cloneAmbientMaterialSet(sourceMaterials) {
      const clones = new Map();
      const cloneOne = (sourceMaterial) => {
        if (clones.has(sourceMaterial)) return clones.get(sourceMaterial);
        const clone = sourceMaterial.clone();
        clone.onBeforeCompile = sourceMaterial.onBeforeCompile;
        clone.customProgramCacheKey = sourceMaterial.customProgramCacheKey;
        clones.set(sourceMaterial, clone);
        return clone;
      };
      return {
        base: cloneOne(sourceMaterials.base),
        flame: cloneOne(sourceMaterials.flame)
      };
    }

    function buildAmbientTemplate(definition) {
      if (ambientTemplates.has(definition.id)) return ambientTemplates.get(definition.id);
      const style = getRegionStyle(definition.realmId);
      const radialSegments = constructionQuality === 'mobile' ? 5 : 8;
      const baseGeometry = new THREE.CylinderGeometry(
        definition.recipe.baseRadiusM * 0.72,
        definition.recipe.baseRadiusM,
        definition.recipe.baseHeightM,
        radialSegments,
        1,
        false
      );
      const flameGeometry = modeling.createRadialGeometry({
        THREE,
        profile: [[-0.20, 0.035], [-0.06, 0.070], [0.10, 0.052], [0.22, 0.018]],
        segments: radialSegments,
        axis: 'y',
        capStart: true,
        capEnd: true
      });
      for (const geometry of [baseGeometry, flameGeometry]) {
        geometry.userData.candlelightImmutableGeometry = true;
        geometry.userData.neonImmutableTopology = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
      const sourceMaterials = makeAmbientSourceMaterials(style);
      const candleCount = definition.recipe.candleCount;
      const triangles = (
        triangleCount(baseGeometry) + triangleCount(flameGeometry)
      ) * candleCount;
      const budgetLimit = constructionQuality === 'mobile'
        ? CANDLELIGHT_CONTRACT.ambient.budget.mobileTrianglesPerCluster
        : CANDLELIGHT_CONTRACT.ambient.budget.desktopTrianglesPerCluster;
      if (triangles > budgetLimit) {
        throw new Error(`Ambient candlelight triangle budget exceeded for ${definition.id}: ${triangles}.`);
      }
      const template = {
        definition,
        style,
        geometries: { base: baseGeometry, flame: flameGeometry },
        sourceMaterials,
        metrics: {
          triangles,
          drawGroups: 2,
          materials: 2,
          lights: 0,
          instanceCount: candleCount
        }
      };
      ambientTemplates.set(definition.id, template);
      return template;
    }

    function ambientLayout(definition, index, random) {
      const count = definition.recipe.candleCount;
      const unit = count > 1 ? index / (count - 1) : 0;
      const centered = unit - 0.5;
      const jitter = (random() - 0.5) * 0.08;
      switch (definition.recipe.layoutKind) {
        case 'pilgrim-circle': {
          const angle = index / count * TAU;
          return [Math.cos(angle) * 0.82, 0, Math.sin(angle) * 0.82, 1 + jitter];
        }
        case 'windbell-grove':
          return [
            centered * 1.55,
            0,
            (index % 2 === 0 ? -0.28 : 0.28) + jitter,
            0.90 + (index % 3) * 0.08
          ];
        case 'shelter-niche': {
          const angle = Math.PI * (0.16 + unit * 0.68);
          return [
            Math.cos(angle) * 0.92,
            0,
            Math.sin(angle) * 0.52 - 0.24,
            0.92 + index * 0.025
          ];
        }
        case 'memory-line':
          return [centered * 1.82, 0, Math.sin(unit * Math.PI) * 0.16 + jitter, 0.86 + unit * 0.22];
        case 'orbit-ring': {
          const angle = index / count * TAU + 0.20;
          return [Math.cos(angle) * 0.96, 0, Math.sin(angle) * 0.58, 0.92 + (index % 2) * 0.12];
        }
        case 'sheltered-vigil':
          return [
            centered * 1.44,
            0,
            Math.abs(centered) * 0.74 + jitter,
            0.88 + (1 - Math.abs(centered) * 2) * 0.18
          ];
        default:
          throw new Error(`Unknown ambient candlelight layout: ${definition.recipe.layoutKind}`);
      }
    }

    /** Assemble scaled candles at a shared surface seam before world owns their per-instance terrain binding. */
    function instantiateAmbientCluster(definition, poolOrdinal) {
      const template = buildAmbientTemplate(definition);
      const materials = cloneAmbientMaterialSet(template.sourceMaterials);
      const count = definition.recipe.candleCount;
      const root = new THREE.Group();
      root.name = `Neon.AmbientCandlelight.${definition.id}`;
      const bases = new THREE.InstancedMesh(template.geometries.base, materials.base, count);
      bases.name = 'Neon.AmbientCandlelight.InstancedBases';
      bases.castShadow = true;
      bases.receiveShadow = true;
      bases.userData.collisionFree = true;
      bases.userData.ambientCandlelight = true;
      const flames = markEffectNode(
        new THREE.InstancedMesh(template.geometries.flame, materials.flame, count),
        'ambient-candlelight-instanced-flames',
        true
      );
      flames.name = 'Neon.AmbientCandlelight.InstancedFlames';
      flames.userData.singleFlameHeightM = AMBIENT_FLAME_HEIGHT_M;
      flames.userData.brightnessRatioToCollectible = definition.brightnessRatioToCollectible;
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const baseBounds = template.geometries.base.boundingBox;
      const flameBounds = template.geometries.flame.boundingBox;
      const seededRng = createVisualRng(`${visualSeed}:ambient:${definition.id}:${poolOrdinal}`);
      for (let index = 0; index < count; index++) {
        const [x, y, z, scaleY] = ambientLayout(definition, index, seededRng);
        position.set(x, y - baseBounds.min.y * scaleY, z);
        scale.set(1, scaleY, 1);
        matrix.compose(position, quaternion, scale);
        bases.setMatrixAt(index, matrix);
        const baseTopY = position.y + baseBounds.max.y * scaleY;
        scale.setScalar(0.92 + seededRng() * 0.12);
        // Geometry bounds, not nominal half-heights, own the seam under independent base/flame scaling.
        // Keep the RNG order unchanged; world preserves this authored seam when grounding each instance.
        position.y = baseTopY - flameBounds.min.y * scale.y;
        matrix.compose(position, quaternion, scale);
        flames.setMatrixAt(index, matrix);
      }
      bases.instanceMatrix.needsUpdate = true;
      flames.instanceMatrix.needsUpdate = true;
      root.add(bases, flames);
      markBloom(flames);
      root.userData = {
        candlelightFactory: true,
        candlelightKind: 'ambient',
        familyId: definition.id,
        realmId: definition.realmId,
        zoneIndex: definition.zoneIndex,
        category: definition.category,
        placementBand: definition.placementBand,
        clearanceClass: definition.clearanceClass,
        roadClearanceM: definition.roadClearanceM,
        sameSideGroupClearanceM: definition.sameSideGroupClearanceM,
        sceneLayer: definition.sceneLayer,
        allowedSceneLayers: definition.allowedSceneLayers,
        semanticRole: definition.semanticRole,
        mapPriority: definition.mapPriority,
        collisionRole: definition.collisionRole,
        pickupRole: definition.pickupRole,
        presentationOnly: true,
        geometrySignature: definition.geometrySignature,
        collisionFree: true,
        released: true,
        visualSeedPhaseA: seededRng() * TAU,
        handles: {
          bases,
          flames,
          baseFlameOpacity: AMBIENT_FLAME_BASE_OPACITY,
          brightnessRatioToCollectible: definition.brightnessRatioToCollectible
        }
      };
      root.visible = false;
      allAmbientClusters.add(root);
      return root;
    }

    function applyInstanceSeed(object, seedInput) {
      const familyId = object.userData.familyId;
      const serialSeed = seedInput === undefined
        ? `${visualSeed}:${familyId}:acquire:${acquireSerial}`
        : `${visualSeed}:${familyId}:external:${seedInput}`;
      const random = createVisualRng(serialSeed);
      object.userData.visualSeedPhaseA = random() * TAU;
      object.userData.visualSeedPhaseB = random() * TAU;
      object.userData.visualSpinRate = 0.68 + random() * 0.44;
    }

    function applyQuality(object) {
      const multiplier = renderQualityMultiplier(renderQuality);
      const handles = object.userData.handles;
      if (object.userData.candlelightKind === 'collectible') {
        handles.core.material.emissiveIntensity = handles.baseCoreEmissiveIntensity * multiplier;
        handles.flame.material.opacity = handles.baseFlameOpacity * multiplier;
        handles.halo.material.opacity = handles.baseHaloOpacity * multiplier;
        handles.trail.material.opacity = handles.baseTrailOpacity * multiplier;
        handles.halo.visible = true;
        handles.trail.visible = renderQuality !== 'low';
      } else {
        handles.flames.material.opacity = handles.baseFlameOpacity * multiplier;
        handles.flames.visible = true;
      }
    }

    function settle(object) {
      assertLive('settle an instance');
      if (!object?.userData?.candlelightFactory) {
        throw new TypeError('settle requires a candlelight factory Object3D.');
      }
      const handles = object.userData.handles;
      if (object.userData.candlelightKind === 'collectible') {
        handles.core.rotation.set(0, 0, 0);
        handles.core.scale.set(1, 1, 1);
        handles.flame.rotation.set(0, 0, handles.flameLeanRad);
        handles.flame.scale.set(1, 1, 1);
        handles.halo.rotation.set(handles.haloTiltRad, 0, 0);
        handles.halo.scale.set(1, 1, 1);
        handles.trail.rotation.set(Math.PI / 2, 0, 0);
        handles.trail.scale.set(1, 1, 1);
      }
      applyQuality(object);
      return object;
    }

    function resetRootForPool(object) {
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      object.scale.set(1, 1, 1);
      object.visible = false;
      object.userData.released = true;
    }

    function prewarm({
      familyIds = COLLECTIBLE_FAMILY_CATALOG.map((definition) => definition.id),
      countPerFamily = 1,
      ambientFamilyIds = [],
      ambientClustersPerFamily = 0
    } = {}) {
      assertLive('prewarm');
      if (!Number.isInteger(countPerFamily) || countPerFamily < 0) {
        throw new RangeError('countPerFamily must be a non-negative integer.');
      }
      if (!Number.isInteger(ambientClustersPerFamily) || ambientClustersPerFamily < 0) {
        throw new RangeError('ambientClustersPerFamily must be a non-negative integer.');
      }
      for (const familyId of familyIds) {
        const definition = collectibleById.get(familyId);
        if (!definition) throw new RangeError(`Unknown collectible candlelight family: ${familyId}`);
        const pool = collectiblePools.get(familyId);
        while (pool.length < countPerFamily) {
          const instance = instantiateCollectible(definition, allCollectibleInstances.size);
          resetRootForPool(instance);
          pool.push(instance);
          prewarmedCollectibles++;
        }
      }
      for (const familyId of ambientFamilyIds) {
        const definition = ambientById.get(familyId);
        if (!definition) throw new RangeError(`Unknown ambient candlelight family: ${familyId}`);
        const pool = ambientPools.get(familyId);
        while (pool.length < ambientClustersPerFamily) {
          const cluster = instantiateAmbientCluster(definition, allAmbientClusters.size);
          resetRootForPool(cluster);
          pool.push(cluster);
          prewarmedAmbientClusters++;
        }
      }
      prewarmComplete = true;
      return diagnostics();
    }

    function acquire(acquireOptions = {}) {
      assertLive('acquire');
      if (!prewarmComplete) {
        throw new Error('Candlelight factory must be prewarmed before acquire.');
      }
      const definition = collectibleById.get(acquireOptions.familyId);
      if (!definition) {
        throw new RangeError(`Unknown collectible candlelight family: ${acquireOptions.familyId}`);
      }
      assertMatchingRealm(definition, acquireOptions);
      const pool = collectiblePools.get(definition.id);
      const instance = pool.pop();
      if (!instance) {
        throw new Error(
          `Candlelight pool exhausted for ${definition.id}; prewarm a larger family count.`
        );
      }
      acquireSerial++;
      applyInstanceSeed(instance, acquireOptions.seed);
      instance.userData.released = false;
      instance.position.set(0, 0, 0);
      instance.rotation.set(0, 0, 0);
      instance.scale.set(1, 1, 1);
      instance.visible = true;
      settle(instance);
      activeCollectibles.add(instance);
      return instance;
    }

    function createAmbientCluster(clusterOptions = {}) {
      assertLive('create an ambient cluster');
      if (!prewarmComplete) {
        throw new Error('Candlelight factory must be prewarmed before creating ambient clusters.');
      }
      const definition = ambientById.get(clusterOptions.familyId);
      if (!definition) {
        throw new RangeError(`Unknown ambient candlelight family: ${clusterOptions.familyId}`);
      }
      assertMatchingRealm(definition, clusterOptions);
      if (clusterOptions.count !== undefined
        && clusterOptions.count !== definition.recipe.candleCount) {
        throw new Error(
          `Ambient family ${definition.id} requires its authored count ${definition.recipe.candleCount}.`
        );
      }
      const pool = ambientPools.get(definition.id);
      const cluster = pool.pop();
      if (!cluster) {
        throw new Error(
          `Ambient candlelight pool exhausted for ${definition.id}; prewarm a larger cluster count.`
        );
      }
      acquireSerial++;
      applyInstanceSeed(cluster, clusterOptions.seed);
      cluster.userData.released = false;
      cluster.position.set(0, 0, 0);
      cluster.rotation.set(0, 0, 0);
      cluster.scale.set(1, 1, 1);
      cluster.visible = true;
      settle(cluster);
      activeAmbientClusters.add(cluster);
      return cluster;
    }

    function update(object, frame = {}) {
      assertLive('update an instance');
      if (!object?.userData?.candlelightFactory || object.userData.released) {
        throw new TypeError('update requires an acquired candlelight factory Object3D.');
      }
      const seconds = Number.isFinite(frame.elapsedSeconds)
        ? Math.max(0, frame.elapsedSeconds)
        : Number.isFinite(frame.nowMs)
          ? Math.max(0, frame.nowMs) * 0.001
          : 0;
      if (frame.reducedMotion === true) {
        settle(object);
        return object;
      }
      const handles = object.userData.handles;
      const phaseA = object.userData.visualSeedPhaseA;
      if (object.userData.candlelightKind === 'collectible') {
        const pulse01 = 0.5 + Math.sin(seconds * 2.6 + phaseA) * 0.5;
        const coreScale = 1 + pulse01 * (MAXIMUM_CORE_SCALE - 1);
        handles.core.scale.setScalar(coreScale);
        handles.core.rotation.y = seconds
          * object.userData.visualSpinRate
          * handles.spinDirection;
        handles.flame.scale.set(
          0.92 + pulse01 * 0.08,
          0.94 + pulse01 * 0.18,
          0.92 + pulse01 * 0.08
        );
        handles.halo.rotation.z = seconds * 0.74 * handles.spinDirection;
        handles.trail.scale.x = 0.88 + pulse01 * 0.12;
        handles.trail.scale.z = 0.88 + pulse01 * 0.12;
        applyQuality(object);
        handles.flame.material.opacity *= COLLECTIBLE_FLAME_MINIMUM_PULSE_MULTIPLIER
          + pulse01 * (1 - COLLECTIBLE_FLAME_MINIMUM_PULSE_MULTIPLIER);
        handles.halo.material.opacity *= 0.86 + pulse01 * 0.14;
        handles.trail.material.opacity *= 0.84 + pulse01 * 0.16;
      } else {
        applyQuality(object);
        const pulse01 = 0.5 + Math.sin(seconds * 1.7 + phaseA) * 0.5;
        handles.flames.material.opacity *= 0.90 + pulse01 * 0.10;
      }
      return object;
    }

    function release(object) {
      if (disposed) return false;
      if (!object?.userData?.candlelightFactory) {
        throw new TypeError('release requires a candlelight factory Object3D.');
      }
      if (object.userData.released) return false;
      settle(object);
      resetRootForPool(object);
      if (object.userData.candlelightKind === 'collectible') {
        activeCollectibles.delete(object);
        collectiblePools.get(object.userData.familyId).push(object);
      } else {
        activeAmbientClusters.delete(object);
        ambientPools.get(object.userData.familyId).push(object);
      }
      releaseCount++;
      return true;
    }

    function setRenderQuality(nextQuality) {
      assertLive('set render quality');
      renderQuality = normalizeRenderQuality(nextQuality);
      for (const instance of allCollectibleInstances) applyQuality(instance);
      for (const cluster of allAmbientClusters) applyQuality(cluster);
      return renderQuality;
    }

    function topology() {
      assertLive('inspect topology');
      const reports = [];
      for (const definition of COLLECTIBLE_FAMILY_CATALOG) {
        const template = buildCollectibleTemplate(definition);
        reports.push({
          familyId: definition.id,
          realmId: definition.realmId,
          geometrySignature: definition.geometrySignature,
          triangleCount: template.topology.triangleCount,
          boundaryEdges: template.topology.boundaryEdges,
          nonManifoldEdges: template.topology.nonManifoldEdges,
          degenerateTriangles: template.topology.degenerateTriangles,
          invalidCoordinates: template.topology.invalidCoordinates,
          isClosed: template.topology.isClosed,
          maximumAuthoredOpaqueRadiusM: template.metrics.maximumAuthoredOpaqueRadiusM,
          maximumAnimatedOpaqueRadiusM: template.metrics.maximumAnimatedOpaqueRadiusM
        });
      }
      return deepFreeze(reports);
    }

    function maximumMetrics(templates, fallback) {
      const result = { ...fallback };
      for (const template of templates.values()) {
        result.triangles = Math.max(result.triangles, template.metrics.triangles);
        result.drawGroups = Math.max(result.drawGroups, template.metrics.drawGroups);
        result.materials = Math.max(result.materials, template.metrics.materials);
        result.lights = Math.max(result.lights, template.metrics.lights);
      }
      return result;
    }

    function diagnostics() {
      const collectibleMaximum = maximumMetrics(collectibleTemplates, {
        triangles: 0,
        drawGroups: 0,
        materials: 0,
        lights: 0
      });
      const ambientMaximum = maximumMetrics(ambientTemplates, {
        triangles: 0,
        drawGroups: 0,
        materials: 0,
        lights: 0
      });
      const pooledCollectibles = [...collectiblePools.values()]
        .reduce((sum, pool) => sum + pool.length, 0);
      const pooledAmbientClusters = [...ambientPools.values()]
        .reduce((sum, pool) => sum + pool.length, 0);
      return deepFreeze({
        disposed,
        constructionQuality,
        renderQuality,
        prewarmComplete,
        taxonomy: {
          regions: REGION_IDS.length,
          collectibleFamilies: COLLECTIBLE_FAMILY_CATALOG.length,
          ambientFamilies: AMBIENT_FAMILY_CATALOG.length
        },
        pool: {
          activeCollectibles: activeCollectibles.size,
          pooledCollectibles,
          activeAmbientClusters: activeAmbientClusters.size,
          pooledAmbientClusters,
          prewarmedCollectibles,
          prewarmedAmbientClusters,
          releaseCount
        },
        allocations: {
          collectibleAssetsDuringAcquire: collectibleAssetAllocationsDuringAcquire,
          ambientAssetsDuringAcquire: ambientAssetAllocationsDuringAcquire,
          zeroFrameAssetsAfterPrewarm:
            collectibleAssetAllocationsDuringAcquire === 0
            && ambientAssetAllocationsDuringAcquire === 0
        },
        maximumMeasured: {
          collectible: collectibleMaximum,
          ambientCluster: ambientMaximum
        },
        lightsCreated: 0,
        disposalPasses
      });
    }

    function disposeGeometry(geometry) {
      if (!geometry || disposedGeometries.has(geometry)) return;
      disposedGeometries.add(geometry);
      geometry.dispose();
    }

    function disposeMaterial(material) {
      if (!material || disposedMaterials.has(material)) return;
      disposedMaterials.add(material);
      material.dispose();
    }

    function disposeObjectMaterials(object) {
      object.traverse((node) => {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) disposeMaterial(material);
      });
      object.visible = false;
    }

    function dispose() {
      if (disposed) return false;
      disposed = true;
      disposalPasses++;
      for (const object of allCollectibleInstances) disposeObjectMaterials(object);
      for (const object of allAmbientClusters) disposeObjectMaterials(object);
      for (const template of collectibleTemplates.values()) {
        for (const geometry of Object.values(template.geometries)) disposeGeometry(geometry);
        for (const material of Object.values(template.sourceMaterials)) disposeMaterial(material);
      }
      for (const template of ambientTemplates.values()) {
        for (const geometry of Object.values(template.geometries)) disposeGeometry(geometry);
        for (const material of Object.values(template.sourceMaterials)) disposeMaterial(material);
      }
      activeCollectibles.clear();
      activeAmbientClusters.clear();
      for (const pool of collectiblePools.values()) pool.length = 0;
      for (const pool of ambientPools.values()) pool.length = 0;
      return true;
    }

    return Object.freeze({
      prewarm,
      acquire,
      update,
      settle,
      release,
      createAmbientCluster,
      setRenderQuality,
      topology,
      diagnostics,
      dispose
    });
  }

  return Object.freeze({
    REGION_IDS,
    ALLOWED_AMBIENT_SCENE_LAYERS,
    CANDLELIGHT_ART_CONTRACT,
    CANDLELIGHT_CONTRACT,
    REGION_STYLE_CATALOG,
    COLLECTIBLE_FAMILY_CATALOG,
    AMBIENT_FAMILY_CATALOG,
    FAMILY_CATALOG,
    describe,
    getRegionStyle,
    validateZones,
    createFactory
  });
})();
