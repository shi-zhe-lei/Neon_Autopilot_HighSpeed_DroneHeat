/*
 * V23 ethereal route-obstacle catalog and pooled visual factory / V23 空灵道路障碍目录与池化视觉工厂。
 * Gameplay owns placement and the AABB; this module owns only collider-bounded opaque art and collision-free cues.
 */
window.NeonV23Obstacles = (() => {
  'use strict';

  const REALM_IDS = Object.freeze([
    'dawn-isle',
    'prairie-garden',
    'rainforest-glow',
    'twilight-valley',
    'star-vault',
    'eden-eye'
  ]);
  const SCENE_LAYER_IDS = Object.freeze(['horizon', 'terrain', 'roadside', 'air', 'route']);
  const STATIC_MOTION_KIND = 'fixed-safe-pose';
  const DYNAMIC_MOTION_KINDS = Object.freeze([
    'wind-sweep-cue',
    'cloud-drift-cue',
    'vine-sway-cue',
    'butterfly-orbit-cue',
    'root-pendulum-cue',
    'rain-orbit-cue',
    'ice-veil-glide-cue',
    'memory-ribbon-orbit-cue',
    'constellation-arch-circle-cue',
    'memory-archive-rise-cue',
    'ash-veil-sweep-cue',
    'shard-orbit-cue'
  ]);
  const ACQUIRE_OPTION_KEYS = Object.freeze([
    'familyId',
    'realmId',
    'motionKind',
    'half',
    'visualKey',
    'reducedMotion'
  ]);
  const UPDATE_OPTION_KEYS = Object.freeze(['reducedMotion']);
  const RENDER_QUALITY_PROFILES = deepFreeze({
    low: { emissive: 0.64, cueOpacity: 0.66 },
    medium: { emissive: 0.82, cueOpacity: 0.82 },
    high: { emissive: 1, cueOpacity: 1 }
  });

  /** Recursively freezes public data without ever placing instantiated Three.js objects in the frozen graph. */
  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) {
      return value;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
  }

  const EXPECTED_FAMILY_IDS_BY_REALM = deepFreeze({
    'dawn-isle': {
      static: ['sandstone-fin', 'sealed-ruin-buttress', 'wind-carved-monolith'],
      dynamic: ['sweeping-wind-arch', 'migrating-cloud-sentinel']
    },
    'prairie-garden': {
      static: ['blooming-stone-fan', 'vine-wrapped-bell', 'terraced-garden-wall'],
      dynamic: ['swaying-vine-bridge', 'butterfly-petal-guardian']
    },
    'rainforest-glow': {
      static: ['root-knot-bulwark', 'sealed-bridge-ruin', 'canopy-drop-pillar'],
      dynamic: ['swinging-root-lattice', 'rain-orbit-sentinel']
    },
    'twilight-valley': {
      static: ['ice-blade-cluster', 'pilgrim-terrace-pier', 'racing-banner-buttress'],
      dynamic: ['gliding-ice-veil', 'orbiting-memory-ribbon']
    },
    'star-vault': {
      static: ['sealed-book-arc', 'astrolabe-buttress', 'constellation-pillar'],
      dynamic: ['circling-constellation-arch', 'ascending-memory-archive']
    },
    'eden-eye': {
      static: ['sealed-fracture-slab', 'red-crystal-crown', 'storm-carved-idol'],
      dynamic: ['ash-storm-veil', 'orbiting-shard-guardian']
    }
  });

  // Each realm owns a materially different sealed contour, relief, and collision-free memory cue. Family variants
  // inherit the realm language but change real vertices and topology density, never only labels or palette values.
  const REALM_MOTIF_PROFILES = deepFreeze({
    'dawn-isle': {
      core: 'wind-wing-and-sun-aperture',
      relief: 'sun-petal-oculus',
      cue: 'wind-stitch-star-ring',
      cueGeometry: 'closed-memory-thread'
    },
    'prairie-garden': {
      core: 'bell-flower-and-butterfly-petal',
      relief: 'butterfly-petal-knot',
      cue: 'butterfly-memory-petal',
      cueGeometry: 'sealed-memory-petal'
    },
    'rainforest-glow': {
      core: 'root-arch-and-rain-drop',
      relief: 'rain-drop-root-carving',
      cue: 'rain-stitch-root-ring',
      cueGeometry: 'closed-memory-thread'
    },
    'twilight-valley': {
      core: 'ice-fan-and-woven-wind-banner',
      relief: 'woven-wind-petal',
      cue: 'woven-wind-memory-petal',
      cueGeometry: 'sealed-memory-petal'
    },
    'star-vault': {
      core: 'book-page-and-constellation-ring',
      relief: 'page-star-carving',
      cue: 'constellation-stitch-ring',
      cueGeometry: 'closed-memory-thread'
    },
    'eden-eye': {
      core: 'fractured-stone-and-ember-crown',
      relief: 'ember-crown-carving',
      cue: 'ember-memory-star-ring',
      cueGeometry: 'closed-memory-thread'
    }
  });

  // Blocking geometry stays in an identity pose below the conservative 0.50 base boundary. The public root is
  // translation-only: integrations must redirect every legacy tilt/spin animation to the collision-free cue rig.
  const OBSTACLE_PRESENTATION_CONTRACT = deepFreeze({
    version: 3,
    artDirection: {
      silhouetteLanguage: 'six-realm-organic-relic-motifs',
      insetLanguage: 'realm-specific-sealed-memory-relief',
      effectLanguage: 'sealed-memory-petals-and-constellation-stitches',
      surfaceLanguage: 'natural-dielectric-stone-ice-root-and-woven-cloth',
      realmMotifs: REALM_MOTIF_PROFILES,
      materialProof: {
        blockingMetalness: 0,
        minimumBlockingRoughness: 0.84,
        cueShadingModel: 'unlit-emissive-no-metal-channel',
        localLightCount: 0
      },
      modernMechanicalPartCount: 0,
      neonFixtureCount: 0,
      inheritedByEveryFamily: true
    },
    familyCount: 30,
    familiesPerRealm: 5,
    staticFamiliesPerRealm: 3,
    dynamicFamiliesPerRealm: 2,
    sceneLayer: 'route',
    semanticRoles: ['hazard-static', 'hazard-dynamic'],
    collisionRole: 'gameplay-aabb',
    safePose: {
      publicRootTransform: 'translation-only',
      invalidPublicRootTransform: 'fail-fast-on-update',
      blockingRootRotation: 'identity',
      blockingRootScale: 1,
      blockingRootOffset: 0,
      redirectLegacyTiltAndSpinTo: 'collision-free-effect-rig'
    },
    colliderFit: {
      factoryInput: 'runtime-collider-half-extents',
      gameplayHalfFactor: 0.52,
      opaqueBaseHalfFactor: 0.50,
      maximumOpaqueToColliderHalfRatio: 0.961_539,
      authoredMaximumRadialHalfFactor: 0.48,
      authoredMaximumVerticalHalfFactor: 0.44,
      minimumOpaqueCoverage: {
        x: 0.80,
        y: 0.65,
        z: 0.80
      },
      effectMaximumToColliderHalfRatio: 1,
      ordinaryEffectMaximumExpansionM: 0.35,
      ordinaryEffectMaximumExpansionFactor: 0.18,
      scanConeAndSoftTrailMaximumM: 3
    },
    distanceGates: {
      integration: {
        minimumM: 180,
        velocityCoefficient: 3.2,
        referenceVelocityMps: 45,
        referenceDistanceM: 180
      },
      readability: {
        minimumM: 240,
        velocityCoefficient: 2,
        referenceVelocityMps: 45,
        referenceDistanceM: 240
      }
    },
    readability: {
      minimumObstacleToRoadContrastRatio: 3,
      cueMode: 'world-space-attached-emissive',
      hudCue: false,
      nearConvergence: 'entity-bounded',
      fogParticipation: false
    },
    realmAvailabilityMultiplier: {
      'dawn-isle': 1,
      'prairie-garden': 1,
      'rainforest-glow': 1,
      'twilight-valley': 1,
      'star-vault': 1,
      'eden-eye': 1
    },
    budgets: {
      desktopTrianglesPerFamily: 2_200,
      mobileTrianglesPerFamily: 800,
      maximumDrawGroupsPerFamily: 4,
      maximumMaterialsPerFamily: 3,
      sceneLightsPerFamily: 0,
      frameAssetAllocationsAfterPrewarm: 0
    },
    invariants: {
      gameplayAuthority: 'external',
      routeSelectionAuthority: 'external',
      collisionAuthority: 'external-aabb',
      familyAvailabilityIsUniform: true,
      visualRngIsIndependent: true,
      pooledMaterialsAreInstanceIsolated: true,
      releaseDisposesAssets: false,
      reducedMotionStopsBlockingMotion: false,
      reducedMotionStopsDecorativeMotion: true
    }
  });

  const REALM_PALETTES = deepFreeze({
    'dawn-isle': {
      structure: 0xb8_8a57,
      hazard: 0xc5_7659,
      glow: 0xff_e5a8,
      accent: 0x9f_e7df
    },
    'prairie-garden': {
      structure: 0x79_9972,
      hazard: 0xb0_6c58,
      glow: 0xff_efaf,
      accent: 0x92_d9a8
    },
    'rainforest-glow': {
      structure: 0x42_6655,
      hazard: 0x91_4f55,
      glow: 0xb7_f5c2,
      accent: 0x68_bf9d
    },
    'twilight-valley': {
      structure: 0x77_82a8,
      hazard: 0xb8_586f,
      glow: 0xd8_e9ff,
      accent: 0x91_bfff
    },
    'star-vault': {
      structure: 0x68_638f,
      hazard: 0x9f_5d91,
      glow: 0xe5_ddff,
      accent: 0x9f_a8ff
    },
    'eden-eye': {
      structure: 0x5b_5557,
      hazard: 0xc5_3f4d,
      glow: 0xff_b19d,
      accent: 0xe5_766f
    }
  });

  function defineFamily({
    id,
    realmId,
    category,
    labelZh,
    labelEn,
    motionKind,
    readabilityClass,
    silhouette,
    signatureIndex
  }) {
    if (!REALM_IDS.includes(realmId)) throw new RangeError(`Unknown obstacle realm: ${realmId}`);
    if (!['static', 'dynamic'].includes(category)) {
      throw new RangeError(`Unknown obstacle category: ${category}`);
    }
    const expectedMotion = category === 'static'
      ? motionKind === STATIC_MOTION_KIND
      : DYNAMIC_MOTION_KINDS.includes(motionKind);
    if (!expectedMotion) throw new RangeError(`Obstacle motion kind mismatches ${id}`);
    if (!Number.isInteger(signatureIndex) || signatureIndex < 0 || signatureIndex >= 30) {
      throw new RangeError(`Obstacle geometry signature index is invalid for ${id}`);
    }
    const motif = REALM_MOTIF_PROFILES[realmId];
    const familyVariant = signatureIndex % 5;
    const sideCount = 18 + familyVariant;
    const ringCount = 7 + signatureIndex % 3;
    const realmIndex = REALM_IDS.indexOf(realmId);
    const lobeCount = 3 + realmIndex + familyVariant % 3;
    return deepFreeze({
      id,
      realmId,
      category,
      labelZh,
      labelEn,
      sceneLayer: 'route',
      semanticRole: category === 'static' ? 'hazard-static' : 'hazard-dynamic',
      collisionRole: 'gameplay-aabb',
      motionKind,
      readabilityClass,
      silhouette,
      geometrySignature: `${id}:${motif.core}:${motif.relief}:${motif.cue}:variant-${familyVariant + 1}`,
      signatureIndex,
      geometryRecipe: {
        pattern: 'sealed-realm-contour-with-relief-and-memory-cue',
        coreMotif: motif.core,
        reliefMotif: motif.relief,
        cueMotif: `${motif.cue}-variant-${familyVariant + 1}`,
        cueGeometry: motif.cueGeometry,
        familyVariant,
        sideCount,
        ringCount,
        lobeCount,
        phaseRadians: signatureIndex * 0.381_966,
        twistRadians: 0.08 + signatureIndex % 6 * 0.027,
        reliefVertices: 10 + familyVariant * 2,
        reliefDepth: 0.025 + familyVariant * 0.002,
        reliefOffsetZ: 0.928 + familyVariant * 0.004
      },
      blockingTransformDomain: {
        rotationX: [0, 0],
        rotationY: [0, 0],
        rotationZ: [0, 0],
        uniformScale: [1, 1],
        normalizedOffsetX: [0, 0],
        normalizedOffsetY: [0, 0],
        normalizedOffsetZ: [0, 0]
      },
      cueTransformDomain: {
        rotationRadians: [-Math.PI * 2, Math.PI * 2],
        uniformScale: [1, 1.02]
      },
      lightCount: 0,
      gameplayWrites: 0,
      presentationOnly: true
    });
  }

  const familyCatalog = Object.freeze([
    defineFamily({
      id: 'sandstone-fin',
      realmId: 'dawn-isle',
      category: 'static',
      labelZh: '晨砂石翼',
      labelEn: 'Sandstone Fin',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'broad-rising-fin',
      silhouette: 'wind-smoothed-dorsal-ridge',
      signatureIndex: 0
    }),
    defineFamily({
      id: 'sealed-ruin-buttress',
      realmId: 'dawn-isle',
      category: 'static',
      labelZh: '封印遗迹扶壁',
      labelEn: 'Sealed Ruin Buttress',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'stepped-wide-mass',
      silhouette: 'sealed-stair-buttress',
      signatureIndex: 1
    }),
    defineFamily({
      id: 'wind-carved-monolith',
      realmId: 'dawn-isle',
      category: 'static',
      labelZh: '风刻独石',
      labelEn: 'Wind-carved Monolith',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'tall-faceted-mass',
      silhouette: 'weathered-wind-monolith',
      signatureIndex: 2
    }),
    defineFamily({
      id: 'sweeping-wind-arch',
      realmId: 'dawn-isle',
      category: 'dynamic',
      labelZh: '横扫风弧',
      labelEn: 'Sweeping Wind Arch',
      motionKind: 'wind-sweep-cue',
      readabilityClass: 'sealed-wide-sweep',
      silhouette: 'filled-wind-arc',
      signatureIndex: 3
    }),
    defineFamily({
      id: 'migrating-cloud-sentinel',
      realmId: 'dawn-isle',
      category: 'dynamic',
      labelZh: '迁云守望石',
      labelEn: 'Migrating Cloud Sentinel',
      motionKind: 'cloud-drift-cue',
      readabilityClass: 'rounded-guardian-mass',
      silhouette: 'cloud-crowned-sentinel',
      signatureIndex: 4
    }),
    defineFamily({
      id: 'blooming-stone-fan',
      realmId: 'prairie-garden',
      category: 'static',
      labelZh: '绽放石扇',
      labelEn: 'Blooming Stone Fan',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'radial-petal-mass',
      silhouette: 'closed-stone-petal-fan',
      signatureIndex: 5
    }),
    defineFamily({
      id: 'vine-wrapped-bell',
      realmId: 'prairie-garden',
      category: 'static',
      labelZh: '藤缠石钟',
      labelEn: 'Vine-wrapped Bell',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'bell-shaped-mass',
      silhouette: 'vine-bound-bell',
      signatureIndex: 6
    }),
    defineFamily({
      id: 'terraced-garden-wall',
      realmId: 'prairie-garden',
      category: 'static',
      labelZh: '叠庭石墙',
      labelEn: 'Terraced Garden Wall',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'layered-wide-mass',
      silhouette: 'terraced-garden-bulwark',
      signatureIndex: 7
    }),
    defineFamily({
      id: 'swaying-vine-bridge',
      realmId: 'prairie-garden',
      category: 'dynamic',
      labelZh: '摇藤封桥',
      labelEn: 'Swaying Vine Bridge',
      motionKind: 'vine-sway-cue',
      readabilityClass: 'sealed-lateral-span',
      silhouette: 'filled-vine-bridge',
      signatureIndex: 8
    }),
    defineFamily({
      id: 'butterfly-petal-guardian',
      realmId: 'prairie-garden',
      category: 'dynamic',
      labelZh: '蝶瓣守护障',
      labelEn: 'Butterfly-petal Guardian',
      motionKind: 'butterfly-orbit-cue',
      readabilityClass: 'radial-petal-guardian',
      silhouette: 'folded-butterfly-petals',
      signatureIndex: 9
    }),
    defineFamily({
      id: 'root-knot-bulwark',
      realmId: 'rainforest-glow',
      category: 'static',
      labelZh: '根结壁垒',
      labelEn: 'Root-knot Bulwark',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'knotted-wide-mass',
      silhouette: 'interlocked-root-knot',
      signatureIndex: 10
    }),
    defineFamily({
      id: 'sealed-bridge-ruin',
      realmId: 'rainforest-glow',
      category: 'static',
      labelZh: '封桥遗构',
      labelEn: 'Sealed Bridge Ruin',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'sealed-ruin-span',
      silhouette: 'rainworn-bridge-block',
      signatureIndex: 11
    }),
    defineFamily({
      id: 'canopy-drop-pillar',
      realmId: 'rainforest-glow',
      category: 'static',
      labelZh: '冠雨垂柱',
      labelEn: 'Canopy Drop Pillar',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'tall-droplet-mass',
      silhouette: 'canopy-water-pillar',
      signatureIndex: 12
    }),
    defineFamily({
      id: 'swinging-root-lattice',
      realmId: 'rainforest-glow',
      category: 'dynamic',
      labelZh: '摆根封栅',
      labelEn: 'Swinging Root Lattice',
      motionKind: 'root-pendulum-cue',
      readabilityClass: 'sealed-lattice-mass',
      silhouette: 'filled-root-weave',
      signatureIndex: 13
    }),
    defineFamily({
      id: 'rain-orbit-sentinel',
      realmId: 'rainforest-glow',
      category: 'dynamic',
      labelZh: '雨轨守卫',
      labelEn: 'Rain Orbit Sentinel',
      motionKind: 'rain-orbit-cue',
      readabilityClass: 'orbital-guardian-mass',
      silhouette: 'rain-ring-sentinel',
      signatureIndex: 14
    }),
    defineFamily({
      id: 'ice-blade-cluster',
      realmId: 'twilight-valley',
      category: 'static',
      labelZh: '冰刃簇障',
      labelEn: 'Ice Blade Cluster',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'faceted-blade-mass',
      silhouette: 'bound-ice-blade-cluster',
      signatureIndex: 15
    }),
    defineFamily({
      id: 'pilgrim-terrace-pier',
      realmId: 'twilight-valley',
      category: 'static',
      labelZh: '朝圣阶台桥墩',
      labelEn: 'Pilgrim Terrace Pier',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'tiered-pier-mass',
      silhouette: 'pilgrim-terrace-pier',
      signatureIndex: 16
    }),
    defineFamily({
      id: 'racing-banner-buttress',
      realmId: 'twilight-valley',
      category: 'static',
      labelZh: '竞旗扶壁',
      labelEn: 'Racing Banner Buttress',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'banner-backed-mass',
      silhouette: 'folded-banner-buttress',
      signatureIndex: 17
    }),
    defineFamily({
      id: 'gliding-ice-veil',
      realmId: 'twilight-valley',
      category: 'dynamic',
      labelZh: '滑行冰纱',
      labelEn: 'Gliding Ice Veil',
      motionKind: 'ice-veil-glide-cue',
      readabilityClass: 'sealed-ice-veil-mass',
      silhouette: 'folded-gliding-ice-veil',
      signatureIndex: 18
    }),
    defineFamily({
      id: 'orbiting-memory-ribbon',
      realmId: 'twilight-valley',
      category: 'dynamic',
      labelZh: '环游记忆飘带',
      labelEn: 'Orbiting Memory Ribbon',
      motionKind: 'memory-ribbon-orbit-cue',
      readabilityClass: 'ribbon-crowned-mass',
      silhouette: 'memory-ribbon-guardian',
      signatureIndex: 19
    }),
    defineFamily({
      id: 'sealed-book-arc',
      realmId: 'star-vault',
      category: 'static',
      labelZh: '封页书弧',
      labelEn: 'Sealed Book Arc',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'layered-book-mass',
      silhouette: 'closed-page-arc',
      signatureIndex: 20
    }),
    defineFamily({
      id: 'astrolabe-buttress',
      realmId: 'star-vault',
      category: 'static',
      labelZh: '星盘扶壁',
      labelEn: 'Astrolabe Buttress',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'disc-backed-mass',
      silhouette: 'astrolabe-stone-buttress',
      signatureIndex: 21
    }),
    defineFamily({
      id: 'constellation-pillar',
      realmId: 'star-vault',
      category: 'static',
      labelZh: '星图柱障',
      labelEn: 'Constellation Pillar',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'tall-star-pillar',
      silhouette: 'constellation-inlaid-pillar',
      signatureIndex: 22
    }),
    defineFamily({
      id: 'circling-constellation-arch',
      realmId: 'star-vault',
      category: 'dynamic',
      labelZh: '环星拱障',
      labelEn: 'Circling Constellation Arch',
      motionKind: 'constellation-arch-circle-cue',
      readabilityClass: 'sealed-constellation-arch',
      silhouette: 'filled-constellation-arch',
      signatureIndex: 23
    }),
    defineFamily({
      id: 'ascending-memory-archive',
      realmId: 'star-vault',
      category: 'dynamic',
      labelZh: '升星记忆书库',
      labelEn: 'Ascending Memory Archive',
      motionKind: 'memory-archive-rise-cue',
      readabilityClass: 'ascending-page-mass',
      silhouette: 'rising-memory-archive',
      signatureIndex: 24
    }),
    defineFamily({
      id: 'sealed-fracture-slab',
      realmId: 'eden-eye',
      category: 'static',
      labelZh: '封裂石板',
      labelEn: 'Sealed Fracture Slab',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'fractured-wide-mass',
      silhouette: 'sealed-fissure-slab',
      signatureIndex: 25
    }),
    defineFamily({
      id: 'red-crystal-crown',
      realmId: 'eden-eye',
      category: 'static',
      labelZh: '赤晶冠障',
      labelEn: 'Red Crystal Crown',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'crowned-faceted-mass',
      silhouette: 'bound-crystal-crown',
      signatureIndex: 26
    }),
    defineFamily({
      id: 'storm-carved-idol',
      realmId: 'eden-eye',
      category: 'static',
      labelZh: '风暴刻像',
      labelEn: 'Storm-carved Idol',
      motionKind: STATIC_MOTION_KIND,
      readabilityClass: 'tall-idol-mass',
      silhouette: 'storm-weathered-idol',
      signatureIndex: 27
    }),
    defineFamily({
      id: 'ash-storm-veil',
      realmId: 'eden-eye',
      category: 'dynamic',
      labelZh: '灰暴余烬纱',
      labelEn: 'Ash-storm Veil',
      motionKind: 'ash-veil-sweep-cue',
      readabilityClass: 'sealed-ember-veil-mass',
      silhouette: 'ash-storm-ember-veil',
      signatureIndex: 28
    }),
    defineFamily({
      id: 'orbiting-shard-guardian',
      realmId: 'eden-eye',
      category: 'dynamic',
      labelZh: '环晶守卫',
      labelEn: 'Orbiting Shard Guardian',
      motionKind: 'shard-orbit-cue',
      readabilityClass: 'shard-crowned-mass',
      silhouette: 'bound-shard-guardian',
      signatureIndex: 29
    })
  ]);

  const familiesById = new Map(familyCatalog.map((definition) => [definition.id, definition]));
  const familiesByRealm = deepFreeze(Object.fromEntries(REALM_IDS.map((realmId) => [
    realmId,
    familyCatalog.filter((definition) => definition.realmId === realmId)
  ])));

  /** Resolves one exact family ID; fuzzy aliases would make config drift invisible. */
  function getFamily(familyId) {
    const definition = familiesById.get(familyId);
    if (!definition) throw new RangeError(`Unknown obstacle family: ${familyId}`);
    return definition;
  }

  /** Returns the frozen five-family realm slice in canonical static-then-dynamic order. */
  function getRealmFamilies(realmId) {
    const definitions = familiesByRealm[realmId];
    if (!definitions) throw new RangeError(`Unknown obstacle realm: ${realmId}`);
    return definitions;
  }

  /**
   * Checks a supplied config snapshot without importing it, keeping the catalog independently testable.
   * The exact ordered 3+2 taxonomy is the only accepted gameplay-facing selection surface.
   */
  function validateConfiguredZones(zones) {
    if (!Array.isArray(zones) || zones.length !== REALM_IDS.length) {
      throw new TypeError('Obstacle taxonomy requires exactly 6 configured zones.');
    }
    for (let index = 0; index < REALM_IDS.length; index++) {
      const realmId = REALM_IDS[index];
      const zone = zones[index];
      if (zone?.id !== realmId) {
        throw new RangeError(`Obstacle taxonomy expected zone ${realmId} at index ${index}.`);
      }
      const expected = EXPECTED_FAMILY_IDS_BY_REALM[realmId];
      for (const category of ['static', 'dynamic']) {
        const actual = zone?.obstacleFamilies?.[category];
        if (!Array.isArray(actual)
          || actual.length !== expected[category].length
          || actual.some((id, familyIndex) => id !== expected[category][familyIndex])) {
          throw new RangeError(`Obstacle taxonomy drifted for ${realmId} ${category}.`);
        }
      }
    }
    return true;
  }

  function hashSeed(value) {
    const source = typeof value === 'string' ? value : JSON.stringify(value ?? 0);
    let hash = 0x811c_9dc5;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x0100_0193);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85eb_ca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2_ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
  }

  function normalizeQuality(quality) {
    const requested = typeof quality === 'object' ? quality?.id : quality;
    const normalized = String(requested || 'desktop').toLowerCase();
    if (normalized === 'desktop' || normalized === 'high') return 'desktop';
    if (normalized === 'mobile') return 'mobile';
    throw new RangeError(`Obstacle construction quality must be desktop/high or mobile, received ${requested}.`);
  }

  function normalizeHalf(half, target) {
    const x = Number(half?.x ?? half?.hx);
    const y = Number(half?.y ?? half?.hy);
    const z = Number(half?.z ?? half?.hz);
    if (!(x > 0 && y > 0 && z > 0)) {
      throw new TypeError('Obstacle acquire requires positive collider half extents {x,y,z}.');
    }
    target.set(x, y, z);
    return target;
  }

  function countTriangles(geometry) {
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    return Math.floor((index ? index.count : position?.count || 0) / 3);
  }

  /** Hashes quantized authored vertices so geometry identity cannot be satisfied by labels or color changes alone. */
  function hashGeometryPositions(geometries) {
    let hash = 0x811c_9dc5;
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position');
      for (let index = 0; index < position.count; index++) {
        for (const value of [position.getX(index), position.getY(index), position.getZ(index)]) {
          hash ^= Math.round(value * 1_000_000);
          hash = Math.imul(hash, 0x0100_0193);
        }
      }
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Resolves a realm-authored point on a normalized sealed mass. The six branches intentionally use different
   * contour mathematics; variant terms then separate all five families without changing the gameplay AABB.
   */
  function resolveRealmCorePoint(definition, angle, sideIndex, t, heightHalf) {
    const recipe = definition.geometryRecipe;
    const variant = recipe.familyVariant;
    const phase = recipe.phaseRadians;
    const middle = Math.sin(Math.PI * t);
    const baseY = (t * 2 - 1) * heightHalf;
    let x;
    let y = baseY;
    let z;

    if (definition.realmId === 'dawn-isle') {
      // Bilateral wind wings retain a broad sunward face while the upper and lower seams curl in opposite directions.
      const radius = 0.885 * (0.965 + middle * 0.035) * (
        1 + Math.cos(angle * (2 + variant % 2) + phase) * 0.025
          + Math.sin(angle * 3 - t * 1.4 + phase) * 0.010
      );
      x = Math.cos(angle) * radius * 1.015;
      z = Math.sin(angle) * radius * 0.975;
      y += Math.cos(angle * 2 + phase) * 0.018 * (0.35 + Math.abs(t - 0.5));
    } else if (definition.realmId === 'prairie-garden') {
      // A five-petal bell broadens toward its lower lip; the sealed body avoids a deceptive hollow collision opening.
      const bell = 0.975 + (1 - t) * 0.018 + middle * 0.018;
      const petals = 1 + Math.cos(angle * (5 + variant % 2) + phase) * 0.030;
      const radius = 0.885 * bell * petals;
      x = Math.cos(angle) * radius * 0.985;
      z = Math.sin(angle) * radius;
      y += Math.sin(angle * 5 + phase) * 0.012 * middle;
    } else if (definition.realmId === 'rainforest-glow') {
      // Root buttresses twist around a rain-smoothed core, giving an arch language without cutting fake traversable holes.
      const rootTwist = angle * (3 + variant % 3) + phase + t * recipe.twistRadians * Math.PI * 2;
      const radius = 0.895 * (0.965 + middle * 0.035) * (
        1 + Math.cos(rootTwist) * 0.026 + Math.cos(angle * 2 - phase) * 0.009
      );
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius * 0.985;
      y += Math.sin(rootTwist) * 0.014 * middle;
    } else if (definition.realmId === 'twilight-valley') {
      // Faceted ice fans alternate long and short woven-banner folds instead of reading as a mechanical barrier.
      const fanFold = Math.abs(Math.cos(angle * (4 + variant % 3) + phase));
      const radius = 0.865 * (0.975 + middle * 0.025) * (1.018 + fanFold * 0.045);
      x = Math.cos(angle) * radius * 1.010;
      z = Math.sin(angle) * radius;
      y += Math.cos(angle + phase) * 0.024 * (t - 0.5);
    } else if (definition.realmId === 'star-vault') {
      // Rounded superellipse pages provide a visibly planar book silhouette with softened constellation-era corners.
      const pagePower = 0.54 + variant * 0.025;
      const taper = 0.965 + middle * 0.035;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      x = Math.sign(cosine) * Math.abs(cosine) ** pagePower * 0.910 * taper;
      z = Math.sign(sine) * Math.abs(sine) ** pagePower * 0.875 * taper;
      y += Math.sin(angle * 2 + phase) * 0.010 * middle;
    } else {
      // Eden facets are deterministically fractured per side while the closed stone mass remains collider-honest.
      const fracture = Math.sin((sideIndex + 1) * (2.13 + variant * 0.17) + phase) * 0.020;
      const crown = Math.max(0, Math.cos(angle * (5 + variant % 2) + phase)) * 0.020;
      const radius = 0.890 * (0.965 + middle * 0.035) * (1 + fracture + crown);
      const fracturedAngle = angle + fracture * 0.48;
      x = Math.cos(fracturedAngle) * radius;
      z = Math.sin(fracturedAngle) * radius * 0.985;
      y += fracture * 0.55 * middle;
    }
    return [x, y, z];
  }

  /**
   * Creates the realm-specific sealed blocking contour. Geometry stays normalized to the injected collider half,
   * and every branch retains the conservative coverage margin frozen by OBSTACLE_PRESENTATION_CONTRACT.
   */
  function createBlockingCoreGeometry(THREE, modeling, definition, qualityKey) {
    const mobile = qualityKey === 'mobile';
    const sideCount = mobile ? 12 + definition.geometryRecipe.familyVariant % 3 : definition.geometryRecipe.sideCount;
    const ringCount = mobile ? 5 + definition.signatureIndex % 2 : definition.geometryRecipe.ringCount;
    // Geometry is normalized to the injected collider half, not to the authored full width/height/depth.
    // 0.50 / 0.52 = 0.9615..., so these ranges retain margin while covering at least 80%/65% of the AABB.
    const heightHalf = 0.735
      + definition.geometryRecipe.familyVariant * 0.018
      + REALM_IDS.indexOf(definition.realmId) * 0.004;
    const rings = [];
    for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
      const t = ringIndex / (ringCount - 1);
      const ring = [];
      for (let sideIndex = 0; sideIndex < sideCount; sideIndex++) {
        const angle = sideIndex / sideCount * Math.PI * 2;
        ring.push(resolveRealmCorePoint(definition, angle, sideIndex, t, heightHalf));
      }
      rings.push(ring);
    }
    const geometry = modeling.createLoftGeometry({ THREE, rings, capStart: true, capEnd: true });
    geometry.name = `${definition.id}-blocking-core-geometry`;
    geometry.userData.neonV23ImmutableTopology = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Builds one non-self-intersecting sealed relief outline in the realm's native visual language. */
  function createRealmReliefOutline(definition, vertexCount) {
    const recipe = definition.geometryRecipe;
    const variant = recipe.familyVariant;
    const phase = recipe.phaseRadians * 0.37;
    const outline = [];
    for (let index = 0; index < vertexCount; index++) {
      const angle = index / vertexCount * Math.PI * 2;
      let x;
      let y;
      if (definition.realmId === 'dawn-isle') {
        const ray = index % 2 === 0 ? 1 : 0.68 + variant * 0.018;
        x = Math.cos(angle + phase) * 0.255 * ray;
        y = Math.sin(angle + phase) * 0.285 * ray;
      } else if (definition.realmId === 'prairie-garden') {
        const petal = 0.76 + (0.5 + 0.5 * Math.cos(angle * 4 + phase)) * 0.24;
        x = Math.cos(angle) * 0.270 * petal;
        y = Math.sin(angle) * 0.300 * petal;
      } else if (definition.realmId === 'rainforest-glow') {
        const fullness = 0.80 + (1 - Math.cos(angle)) * 0.10;
        x = Math.sin(angle) * 0.215 * fullness;
        y = Math.cos(angle) * 0.275 - Math.cos(angle * 2 + phase) * 0.025;
      } else if (definition.realmId === 'twilight-valley') {
        const fold = 1 + Math.sin(angle * 3 + phase) * 0.085;
        x = Math.cos(angle) * 0.260 * fold + Math.sin(angle * 2) * 0.018;
        y = Math.sin(angle) * 0.300 * (0.92 + variant * 0.015);
      } else if (definition.realmId === 'star-vault') {
        const starPoint = index % 2 === 0 ? 1 : 0.64 + variant * 0.016;
        x = Math.cos(angle + phase) * 0.260 * starPoint;
        y = Math.sin(angle + phase) * 0.285 * starPoint;
      } else {
        const emberPoint = index % 2 === 0 ? 1 : 0.70 + variant * 0.014;
        const crownLift = Math.max(0, Math.sin(angle)) * 0.026;
        x = Math.cos(angle + phase) * 0.260 * emberPoint;
        y = Math.sin(angle + phase) * 0.275 * emberPoint + crownLift;
      }
      outline.push([x * (1 + variant * 0.012), y]);
    }
    return outline;
  }

  /** Builds one sealed, shallow raised carving that remains inside the authoritative gameplay AABB. */
  function createBlockingAccentGeometry(THREE, modeling, definition, qualityKey) {
    const vertexCount = qualityKey === 'mobile'
      ? Math.max(8, Math.floor(definition.geometryRecipe.reliefVertices * 0.67))
      : definition.geometryRecipe.reliefVertices;
    const outline = createRealmReliefOutline(definition, vertexCount);
    const geometry = modeling.createExtrudedProfileGeometry({
      THREE,
      outline,
      depth: definition.geometryRecipe.reliefDepth,
      bevel: qualityKey === 'mobile' ? 0.003 : 0.005,
      bevelSegments: qualityKey === 'mobile' ? 1 : 2
    });
    geometry.name = `${definition.id}-${definition.geometryRecipe.reliefMotif}-geometry`;
    geometry.userData.neonV23ImmutableTopology = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Builds a large but sealed memory petal used by Prairie and Twilight instead of a generic circular lens. */
  function createMemoryPetalCueGeometry(THREE, modeling, definition, qualityKey) {
    const variant = definition.geometryRecipe.familyVariant;
    const pointCount = (qualityKey === 'mobile' ? 10 : 14) + variant;
    const phase = definition.geometryRecipe.phaseRadians * 0.29;
    const outline = [];
    for (let index = 0; index < pointCount; index++) {
      const angle = index / pointCount * Math.PI * 2;
      if (definition.realmId === 'prairie-garden') {
        const butterflyPetal = 0.70 + (0.5 + 0.5 * Math.cos(angle * 4 + phase)) * 0.18;
        outline.push([
          Math.cos(angle) * butterflyPetal,
          Math.sin(angle) * butterflyPetal * (0.94 + variant * 0.008)
        ]);
      } else {
        const wovenFold = 0.73 + Math.sin(angle * 3 + phase) * 0.075;
        outline.push([
          Math.cos(angle) * wovenFold * (1.04 + variant * 0.006),
          Math.sin(angle) * 0.875 + Math.sin(angle * 2 + phase) * 0.025
        ]);
      }
    }
    return modeling.createExtrudedProfileGeometry({
      THREE,
      outline,
      depth: 0.022 + variant * 0.002,
      bevel: qualityKey === 'mobile' ? 0.002 : 0.004,
      bevelSegments: 1
    });
  }

  /**
   * Combines disconnected but individually sealed cue pieces into one immutable draw geometry. This preserves real
   * gaps in a star-stitch ring without adding Object3D nodes, materials, draw groups, colliders, or frame allocations.
   */
  function mergeSealedCuePieces(THREE, geometries) {
    const positions = [];
    const indices = [];
    let vertexOffset = 0;
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position');
      const index = geometry.getIndex();
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
        positions.push(
          position.getX(vertexIndex),
          position.getY(vertexIndex),
          position.getZ(vertexIndex)
        );
      }
      if (index) {
        for (let indexOffset = 0; indexOffset < index.count; indexOffset++) {
          indices.push(index.getX(indexOffset) + vertexOffset);
        }
      } else {
        for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
          indices.push(vertexIndex + vertexOffset);
        }
      }
      vertexOffset += position.count;
      geometry.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setIndex(indices);
    merged.computeVertexNormals();
    merged.userData.neonV23 = {
      factory: 'merged-sealed-memory-stitches',
      closedExpected: true,
      sealedPieceCount: geometries.length
    };
    return merged;
  }

  /** Builds actually separated sealed star-stitch arcs whose lobe rhythm is realm- and family-specific. */
  function createMemoryThreadCueGeometry(THREE, modeling, definition, qualityKey) {
    const mobile = qualityKey === 'mobile';
    const variant = definition.geometryRecipe.familyVariant;
    const realmIndex = REALM_IDS.indexOf(definition.realmId);
    const phase = definition.geometryRecipe.phaseRadians * 0.23;
    const stitchCount = 3 + (realmIndex + variant) % 3;
    const sampleCount = (mobile ? 4 : 6) + variant % 2;
    const arcSpan = Math.PI * 2 / stitchCount * (0.62 + variant * 0.025);
    const pieces = [];
    for (let stitchIndex = 0; stitchIndex < stitchCount; stitchIndex++) {
      const centerAngle = stitchIndex / stitchCount * Math.PI * 2 + phase;
      const points = [];
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const sampleT = sampleIndex / (sampleCount - 1);
        const angle = centerAngle + (sampleT - 0.5) * arcSpan;
        const lobeCount = 3 + realmIndex + variant % 3;
        const starPulse = Math.cos(angle * lobeCount + phase) * (0.023 + realmIndex * 0.002);
        const stitchTaper = Math.sin(Math.PI * sampleT) * 0.018;
        // Preserve the former cue's near-collider outer reach even though real gaps now replace a full generic ring.
        const radius = 0.870 + starPulse + stitchTaper + variant * 0.004;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, 0]);
      }
      pieces.push(modeling.createTubeGeometry({
        THREE,
        points,
        radius: 0.018 + variant * 0.001,
        tubularSegments: mobile ? 4 + variant % 2 : 7 + variant,
        radialSegments: mobile ? 5 : 7,
        closed: false,
        capStart: true,
        capEnd: true
      }));
    }
    return mergeSealedCuePieces(THREE, pieces);
  }

  /** Creates a bounded, depth-tested world-space cue with real realm geometry and no scene light authority. */
  function createCueGeometry(THREE, modeling, definition, qualityKey) {
    const geometry = definition.geometryRecipe.cueGeometry === 'sealed-memory-petal'
      ? createMemoryPetalCueGeometry(THREE, modeling, definition, qualityKey)
      : createMemoryThreadCueGeometry(THREE, modeling, definition, qualityKey);
    geometry.name = `${definition.id}-collision-free-cue-geometry`;
    geometry.userData.neonV23ImmutableTopology = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function cloneMaterialGraph(sourceMaterials) {
    const clones = new Map();
    const cloneOne = (source) => {
      if (!source) return source;
      if (clones.has(source)) return clones.get(source);
      const clone = source.clone();
      // Three.js clone behavior has varied for shader hooks; copy both hooks explicitly and isolate nested metadata.
      clone.onBeforeCompile = source.onBeforeCompile;
      clone.customProgramCacheKey = source.customProgramCacheKey;
      clone.userData = {
        ...(source.userData || {}),
        neonV23: {
          ...(source.userData?.neonV23 || {})
        }
      };
      clones.set(source, clone);
      return clone;
    };
    return {
      materials: sourceMaterials.map(cloneOne),
      uniqueMaterials: [...clones.values()]
    };
  }

  /**
   * Builds a scene-independent pool. Call prewarm before acquire; once prewarmed, exhausted pools fail loudly
   * instead of allocating geometry, materials, or Object3D nodes during a frame.
   */
  function createFactory({
    THREE: providedThree = window.THREE,
    modeling: providedModeling = window.NeonV23Modeling,
    quality = undefined,
    qualityProfile = undefined,
    visualSeed = 'neon-v23-obstacle-visuals',
    markOpaque = null,
    markEffect = null,
    ...unsupportedOptions
  } = {}) {
    const THREE = providedThree;
    const modeling = providedModeling;
    if (!THREE?.Group
      || !THREE?.Mesh
      || !THREE?.Vector3
      || !THREE?.BufferGeometry
      || !THREE?.Float32BufferAttribute
      || !THREE?.CatmullRomCurve3) {
      throw new TypeError('Obstacle factory requires a complete THREE namespace.');
    }
    if (!modeling?.createLoftGeometry
      || !modeling?.createExtrudedProfileGeometry
      || !modeling?.createTubeGeometry
      || !modeling?.createMaterial
      || !modeling?.analyzeTopology) {
      throw new TypeError('Obstacle factory requires the V23 modeling geometry, material, and topology APIs.');
    }
    if (typeof visualSeed !== 'string' && typeof visualSeed !== 'number') {
      throw new TypeError('Obstacle factory visualSeed must be a string or number.');
    }
    if (markOpaque !== null && typeof markOpaque !== 'function') {
      throw new TypeError('Obstacle factory markOpaque hook must be a function.');
    }
    if (markEffect !== null && typeof markEffect !== 'function') {
      throw new TypeError('Obstacle factory markEffect hook must be a function.');
    }
    const unsupportedKeys = Object.keys(unsupportedOptions);
    if (unsupportedKeys.length > 0) {
      throw new TypeError(`Obstacle factory does not accept external state field: ${unsupportedKeys[0]}`);
    }

    const qualityKey = normalizeQuality(qualityProfile ?? quality ?? 'desktop');
    const pools = new Map(familyCatalog.map(({ id }) => [id, []]));
    const assetsByFamily = new Map();
    const records = new Set();
    const recordsByRoot = new WeakMap();
    const activeRecords = new Set();
    const familyAllocationCount = new Map(familyCatalog.map(({ id }) => [id, 0]));
    let renderQualityId = qualityKey === 'desktop' ? 'high' : 'medium';
    let shadowEnabled = true;
    let prewarmComplete = false;
    let disposed = false;
    let objectAllocationCount = 0;
    let assetBuildCount = 0;

    function assertUsable() {
      if (disposed) throw new Error('Obstacle factory is disposed.');
    }

    function makePrototypeMaterials(definition) {
      const palette = REALM_PALETTES[definition.realmId];
      const seed = hashSeed(`${visualSeed}:${definition.id}:materials`);
      const core = modeling.createMaterial({
        THREE,
        palette,
        kind: 'hazard',
        color: palette.hazard,
        emissive: palette.glow,
        emissiveIntensity: 0.16,
        roughness: 0.84,
        metalness: 0,
        proceduralScale: 1.55,
        proceduralStrength: 0.16,
        fog: false,
        seed
      });
      const accent = modeling.createMaterial({
        THREE,
        palette,
        kind: 'structure',
        color: palette.structure,
        emissive: palette.accent,
        emissiveIntensity: 0.08,
        roughness: 0.88,
        metalness: 0,
        proceduralScale: 1.90,
        proceduralStrength: 0.13,
        fog: false,
        seed: seed ^ 0x9e37_79b9
      });
      const cue = modeling.createMaterial({
        THREE,
        palette,
        kind: 'effect',
        color: palette.glow,
        opacity: 0.48,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        fog: false,
        seed: seed ^ 0x85eb_ca6b
      });
      return [core, accent, cue];
    }

    function buildFamilyAsset(definition) {
      if (assetsByFamily.has(definition.id)) return assetsByFamily.get(definition.id);
      const coreGeometry = createBlockingCoreGeometry(THREE, modeling, definition, qualityKey);
      const accentGeometry = createBlockingAccentGeometry(THREE, modeling, definition, qualityKey);
      const cueGeometry = createCueGeometry(THREE, modeling, definition, qualityKey);
      const prototypeMaterials = makePrototypeMaterials(definition);
      const coreTopology = modeling.analyzeTopology(coreGeometry);
      const accentTopology = modeling.analyzeTopology(accentGeometry);
      const cueTopology = modeling.analyzeTopology(cueGeometry);
      if (!coreTopology.isClosed || !accentTopology.isClosed || !cueTopology.isClosed) {
        throw new Error(`Obstacle ${definition.id} produced an open sealed mesh.`);
      }
      const triangles = countTriangles(coreGeometry)
        + countTriangles(accentGeometry)
        + countTriangles(cueGeometry);
      const drawGroups = 3;
      const materials = new Set(prototypeMaterials).size;
      const triangleLimit = qualityKey === 'mobile'
        ? OBSTACLE_PRESENTATION_CONTRACT.budgets.mobileTrianglesPerFamily
        : OBSTACLE_PRESENTATION_CONTRACT.budgets.desktopTrianglesPerFamily;
      if (triangles > triangleLimit
        || drawGroups > OBSTACLE_PRESENTATION_CONTRACT.budgets.maximumDrawGroupsPerFamily
        || materials > OBSTACLE_PRESENTATION_CONTRACT.budgets.maximumMaterialsPerFamily) {
        throw new Error(`Obstacle ${definition.id} exceeded its ${qualityKey} rendering budget.`);
      }
      const topology = deepFreeze({
        familyId: definition.id,
        geometrySignature: definition.geometrySignature,
        coreMotif: definition.geometryRecipe.coreMotif,
        reliefMotif: definition.geometryRecipe.reliefMotif,
        cueMotif: definition.geometryRecipe.cueMotif,
        cueGeometryKind: definition.geometryRecipe.cueGeometry,
        coreGeometryHash: hashGeometryPositions([coreGeometry]),
        reliefGeometryHash: hashGeometryPositions([accentGeometry]),
        cueGeometryHash: hashGeometryPositions([cueGeometry]),
        blockingGeometryHash: hashGeometryPositions([coreGeometry, accentGeometry]),
        blockingMeshes: [
          { role: 'core', ...coreTopology },
          { role: 'relief', ...accentTopology }
        ],
        cueMesh: { role: 'memory-cue', ...cueTopology },
        allBlockingMeshesClosed: coreTopology.isClosed && accentTopology.isClosed,
        allRenderableMeshesClosed: coreTopology.isClosed && accentTopology.isClosed && cueTopology.isClosed,
        triangles,
        drawGroups,
        materials
      });
      const asset = {
        definition,
        coreGeometry,
        accentGeometry,
        cueGeometry,
        prototypeMaterials,
        topology,
        metrics: Object.freeze({ triangles, drawGroups, materials })
      };
      assetsByFamily.set(definition.id, asset);
      assetBuildCount++;
      return asset;
    }

    function markBlockingNode(node, definition, role) {
      const metadata = {
        familyId: definition.id,
        realmId: definition.realmId,
        role,
        motif: role === 'blocking-core'
          ? definition.geometryRecipe.coreMotif
          : definition.geometryRecipe.reliefMotif,
        sceneLayer: 'route',
        semanticRole: definition.semanticRole,
        collisionRole: 'gameplay-aabb',
        fogParticipation: false,
        blockingOpaque: true,
        collisionFree: false
      };
      if (markOpaque) markOpaque(node, metadata);
      node.userData = node.userData || {};
      Object.assign(node.userData, metadata);
      node.material.fog = false;
      node.castShadow = shadowEnabled;
      node.receiveShadow = shadowEnabled;
    }

    function markCueNode(node, definition) {
      const reason = 'World-space emissive obstacle cue; transparent, collision-free, and excluded from shadows.';
      const metadata = {
        familyId: definition.id,
        realmId: definition.realmId,
        role: 'readability-cue',
        motif: definition.geometryRecipe.cueMotif,
        sceneLayer: 'route',
        semanticRole: definition.semanticRole,
        collisionRole: 'none',
        fogParticipation: false,
        blockingOpaque: false,
        collisionFree: true,
        presentationOnly: true
      };
      if (markEffect) markEffect(node, reason, metadata);
      node.userData = node.userData || {};
      Object.assign(node.userData, metadata);
      node.castShadow = false;
      node.receiveShadow = false;
      node.material.transparent = true;
      node.material.depthWrite = false;
      node.material.blending = THREE.AdditiveBlending;
      node.material.fog = false;
    }

    function applyRenderQuality(record) {
      const profile = RENDER_QUALITY_PROFILES[renderQualityId];
      const [core, accent, cue] = record.materials;
      core.emissiveIntensity = record.materialBaselines[0].emissiveIntensity * profile.emissive;
      accent.emissiveIntensity = record.materialBaselines[1].emissiveIntensity * profile.emissive;
      cue.opacity = record.materialBaselines[2].opacity * profile.cueOpacity;
    }

    function createRecord(definition) {
      const asset = buildFamilyAsset(definition);
      const cloned = cloneMaterialGraph(asset.prototypeMaterials);
      const root = new THREE.Group();
      const fitRoot = new THREE.Group();
      const blockingRoot = new THREE.Group();
      const effectRoot = new THREE.Group();
      const core = new THREE.Mesh(asset.coreGeometry, cloned.materials[0]);
      const accent = new THREE.Mesh(asset.accentGeometry, cloned.materials[1]);
      const cue = new THREE.Mesh(asset.cueGeometry, cloned.materials[2]);
      root.name = `obstacle-${definition.id}`;
      fitRoot.name = `${definition.id}-collider-fit`;
      blockingRoot.name = `${definition.id}-blocking-opaque`;
      effectRoot.name = `${definition.id}-collision-free-effects`;
      core.name = `${definition.id}-blocking-core`;
      accent.name = `${definition.id}-blocking-relief`;
      cue.name = `${definition.id}-readability-cue`;
      accent.position.z = definition.geometryRecipe.reliefOffsetZ;
      accent.rotation.z = (definition.geometryRecipe.familyVariant - 2) * 0.035;
      effectRoot.rotation.x = Math.PI * (0.18 + definition.signatureIndex % 5 * 0.07);
      blockingRoot.add(core, accent);
      effectRoot.add(cue);
      fitRoot.add(blockingRoot, effectRoot);
      root.add(fitRoot);
      markBlockingNode(core, definition, 'blocking-core');
      markBlockingNode(accent, definition, 'blocking-relief');
      markCueNode(cue, definition);
      blockingRoot.userData.blockingOpaque = true;
      blockingRoot.userData.collisionFree = false;
      effectRoot.userData.blockingOpaque = false;
      effectRoot.userData.collisionFree = true;
      root.userData.neonV23Obstacle = {
        familyId: definition.id,
        realmId: definition.realmId,
        category: definition.category,
        motionKind: definition.motionKind,
        sceneLayer: 'route',
        semanticRole: definition.semanticRole,
        collisionRole: 'gameplay-aabb',
        fogParticipation: false,
        publicRootTransform: 'translation-only',
        blockingRootRotation: 'identity',
        coreMotif: definition.geometryRecipe.coreMotif,
        reliefMotif: definition.geometryRecipe.reliefMotif,
        cueMotif: definition.geometryRecipe.cueMotif,
        effectRigName: effectRoot.name,
        active: false,
        reducedMotion: false,
        visualSeedHash: 0,
        colliderHalf: { x: 1, y: 1, z: 1 }
      };
      root.definition = definition;
      root.blockingRoot = blockingRoot;
      root.opaqueRoot = blockingRoot;
      root.effectRoot = effectRoot;
      root.colliderFitRoot = fitRoot;
      root.metrics = asset.metrics;
      root.visible = false;

      const record = {
        definition,
        asset,
        root,
        fitRoot,
        blockingRoot,
        effectRoot,
        blockingMeshes: [core, accent],
        effectMeshes: [cue],
        materials: cloned.materials,
        uniqueMaterials: cloned.uniqueMaterials,
        materialBaselines: cloned.materials.map((material) => ({
          opacity: Number(material.opacity),
          emissiveIntensity: Number(material.emissiveIntensity) || 0
        })),
        half: new THREE.Vector3(1, 1, 1),
        slotIndex: familyAllocationCount.get(definition.id),
        phase: 0,
        active: false
      };
      familyAllocationCount.set(definition.id, record.slotIndex + 1);
      records.add(record);
      recordsByRoot.set(root, record);
      objectAllocationCount++;
      applyRenderQuality(record);
      return record;
    }

    function resolveRecord(candidate) {
      const root = candidate?.isObject3D ? candidate : candidate?.root;
      const record = recordsByRoot.get(root);
      if (!record) throw new TypeError('Obstacle factory received a foreign root or handle.');
      return record;
    }

    function normalizePrewarmRequest(request) {
      if (request === undefined) {
        return { familyIds: familyCatalog.map(({ id }) => id), countPerFamily: 1, countsByFamily: null };
      }
      if (Number.isInteger(request) && request >= 0) {
        return {
          familyIds: familyCatalog.map(({ id }) => id),
          countPerFamily: request,
          countsByFamily: null
        };
      }
      if (!request || typeof request !== 'object') {
        throw new TypeError('Obstacle prewarm request must be a count or options object.');
      }
      const familyIds = request.familyIds === undefined
        ? familyCatalog.map(({ id }) => id)
        : [...request.familyIds];
      if (familyIds.length === 0 || new Set(familyIds).size !== familyIds.length) {
        throw new RangeError('Obstacle prewarm familyIds must be a non-empty unique list.');
      }
      familyIds.forEach(getFamily);
      const countPerFamily = request.countPerFamily ?? 1;
      if (!Number.isInteger(countPerFamily) || countPerFamily < 0) {
        throw new RangeError('Obstacle prewarm countPerFamily must be a non-negative integer.');
      }
      const countsByFamily = request.countsByFamily || null;
      if (countsByFamily && typeof countsByFamily !== 'object') {
        throw new TypeError('Obstacle prewarm countsByFamily must be an object.');
      }
      return { familyIds, countPerFamily, countsByFamily };
    }

    /** Allocates immutable geometry and isolated mutable material instances before frame-time acquisition begins. */
    function prewarm(request) {
      assertUsable();
      const normalized = normalizePrewarmRequest(request);
      for (const familyId of normalized.familyIds) {
        const definition = getFamily(familyId);
        const requestedCount = normalized.countsByFamily?.[familyId] ?? normalized.countPerFamily;
        if (!Number.isInteger(requestedCount) || requestedCount < 0) {
          throw new RangeError(`Obstacle prewarm count is invalid for ${familyId}.`);
        }
        let existing = familyAllocationCount.get(familyId);
        while (existing < requestedCount) {
          pools.get(familyId).push(createRecord(definition));
          existing++;
        }
      }
      prewarmComplete = true;
      return getDiagnostics();
    }

    /**
     * Returns the immediately available roots for one family without exposing or mutating its pool.
     * Runtime uses this before a synchronous multi-copy spawn so no branch/opposing group can be half-created.
     */
    function availableCount(familyId) {
      assertUsable();
      if (!prewarmComplete) throw new Error('Obstacle factory must be prewarmed before capacity queries.');
      const definition = getFamily(familyId);
      return pools.get(definition.id).length;
    }

    /**
     * Acquires a direct Object3D root. Realm and motion kind are mandatory cross-component checks; transforms,
     * placement, collision response, and scene ownership deliberately remain outside this factory.
     */
    function acquire(options = {}) {
      assertUsable();
      if (!prewarmComplete) throw new Error('Obstacle factory must be prewarmed before acquire.');
      for (const key in options) {
        if (!ACQUIRE_OPTION_KEYS.includes(key)) {
          throw new TypeError(`Obstacle acquire does not accept external state field: ${key}`);
        }
      }
      const definition = getFamily(options.familyId);
      if (options.realmId !== definition.realmId) {
        throw new RangeError(`Obstacle ${definition.id} belongs to ${definition.realmId}, not ${options.realmId}.`);
      }
      if (options.motionKind !== definition.motionKind) {
        throw new RangeError(
          `Obstacle ${definition.id} requires motionKind ${definition.motionKind}, not ${options.motionKind}.`
        );
      }
      const pool = pools.get(definition.id);
      const record = pool.pop();
      if (!record) {
        throw new Error(`Obstacle pool exhausted for ${definition.id}; prewarm a larger family count.`);
      }
      normalizeHalf(options.half, record.half);
      record.fitRoot.scale.copy(record.half);
      record.root.position.set(0, 0, 0);
      record.root.rotation.set(0, 0, 0);
      record.root.scale.set(1, 1, 1);
      record.blockingRoot.position.set(0, 0, 0);
      record.blockingRoot.rotation.set(0, 0, 0);
      record.blockingRoot.scale.set(1, 1, 1);
      record.effectRoot.position.set(0, 0, 0);
      record.effectRoot.rotation.set(
        Math.PI * (0.18 + definition.signatureIndex % 5 * 0.07),
        0,
        0
      );
      record.effectRoot.scale.set(1, 1, 1);
      const visualKey = options.visualKey ?? record.slotIndex;
      const seedHash = hashSeed(`${visualSeed}:${definition.id}:${visualKey}`);
      record.phase = seedHash / 4_294_967_296 * Math.PI * 2;
      record.active = true;
      record.root.visible = true;
      activeRecords.add(record);
      const metadata = record.root.userData.neonV23Obstacle;
      metadata.active = true;
      metadata.reducedMotion = options.reducedMotion === true;
      metadata.visualSeedHash = seedHash;
      metadata.colliderHalf.x = record.half.x;
      metadata.colliderHalf.y = record.half.y;
      metadata.colliderHalf.z = record.half.z;
      applyRenderQuality(record);
      update(record.root, 0, { reducedMotion: metadata.reducedMotion });
      return record.root;
    }

    /**
     * Animates only the collision-free cue. Blocking meshes remain at identity even for dynamic families,
     * preserving the runtime AABB while the gameplay layer moves the public root as its own authority.
     */
    function update(candidate, elapsedSeconds, options = {}) {
      assertUsable();
      const record = resolveRecord(candidate);
      if (!record.active) throw new Error(`Obstacle ${record.definition.id} is not acquired.`);
      const root = record.root;
      const unsafeRootTransform = Math.abs(root.rotation.x) > 0.000_001
        || Math.abs(root.rotation.y) > 0.000_001
        || Math.abs(root.rotation.z) > 0.000_001
        || Math.abs(root.scale.x - 1) > 0.000_001
        || Math.abs(root.scale.y - 1) > 0.000_001
        || Math.abs(root.scale.z - 1) > 0.000_001;
      if (unsafeRootTransform) {
        throw new Error(
          `Obstacle ${record.definition.id} public root is translation-only; `
          + 'route tilt/spin/scale must target the collision-free effectRoot.'
        );
      }
      for (const key in options) {
        if (!UPDATE_OPTION_KEYS.includes(key)) {
          throw new TypeError(`Obstacle update does not accept external state field: ${key}`);
        }
      }
      const seconds = Number(elapsedSeconds);
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new TypeError('Obstacle update requires a finite non-negative elapsedSeconds value.');
      }
      const reducedMotion = options.reducedMotion === true;
      const metadata = record.root.userData.neonV23Obstacle;
      metadata.reducedMotion = reducedMotion;
      // Reassert the safe pose so no pooled legacy transform can leak into a new blocking instance.
      record.blockingRoot.position.set(0, 0, 0);
      record.blockingRoot.rotation.set(0, 0, 0);
      record.blockingRoot.scale.set(1, 1, 1);

      const phase = record.phase + seconds * (0.42 + record.definition.signatureIndex % 5 * 0.035);
      const cueScale = reducedMotion ? 1 : 1 + (Math.sin(phase * 1.7) * 0.5 + 0.5) * 0.02;
      record.effectRoot.scale.set(cueScale, cueScale, cueScale);
      if (reducedMotion) {
        record.effectRoot.rotation.y = 0;
        record.effectRoot.rotation.z = 0;
      } else {
        const direction = record.definition.signatureIndex % 2 === 0 ? 1 : -1;
        record.effectRoot.rotation.y = phase * direction;
        record.effectRoot.rotation.z = Math.sin(phase * 0.73) * 0.28;
      }
      return record.root;
    }

    /** Restores the authored safe pose without hiding, releasing, reallocating, or changing the runtime position. */
    function settle(candidate) {
      assertUsable();
      const record = resolveRecord(candidate);
      record.blockingRoot.position.set(0, 0, 0);
      record.blockingRoot.rotation.set(0, 0, 0);
      record.blockingRoot.scale.set(1, 1, 1);
      record.effectRoot.position.set(0, 0, 0);
      record.effectRoot.rotation.set(
        Math.PI * (0.18 + record.definition.signatureIndex % 5 * 0.07),
        0,
        0
      );
      record.effectRoot.scale.set(1, 1, 1);
      applyRenderQuality(record);
      return record.root;
    }

    /** Returns one instance to its family pool; materials survive for reuse and are disposed only by factory.dispose. */
    function release(candidate) {
      assertUsable();
      const record = resolveRecord(candidate);
      if (!record.active) return false;
      settle(record.root);
      record.root.position.set(0, 0, 0);
      record.root.rotation.set(0, 0, 0);
      record.root.scale.set(1, 1, 1);
      record.root.visible = false;
      record.active = false;
      record.root.userData.neonV23Obstacle.active = false;
      activeRecords.delete(record);
      pools.get(record.definition.id).push(record);
      return true;
    }

    /**
     * Applies shadow participation only to blocking opaque meshes. Calling shadow(boolean) updates the factory
     * default and every pooled/live record; shadow(root, boolean) changes one record without touching effects.
     */
    function shadow(candidateOrEnabled, maybeEnabled) {
      assertUsable();
      if (typeof candidateOrEnabled === 'boolean') {
        shadowEnabled = candidateOrEnabled;
        for (const record of records) {
          for (const mesh of record.blockingMeshes) {
            mesh.castShadow = shadowEnabled;
            mesh.receiveShadow = shadowEnabled;
          }
          for (const mesh of record.effectMeshes) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
          }
        }
        return shadowEnabled;
      }
      const record = resolveRecord(candidateOrEnabled);
      const enabled = maybeEnabled !== false;
      for (const mesh of record.blockingMeshes) {
        mesh.castShadow = enabled;
        mesh.receiveShadow = enabled;
      }
      for (const mesh of record.effectMeshes) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
      return enabled;
    }

    /** Switches presentation-only material intensity without rebuilding geometry or changing the AABB fit. */
    function setRenderQuality(id) {
      assertUsable();
      const normalized = String(id || '').toLowerCase();
      if (!['low', 'medium', 'high'].includes(normalized)) {
        throw new RangeError(`Unsupported obstacle render quality: ${id}`);
      }
      if (renderQualityId === normalized) return false;
      renderQualityId = normalized;
      for (const record of records) applyRenderQuality(record);
      return true;
    }

    /** Returns one frozen measured topology report, building immutable family assets only outside acquire. */
    function getTopologyReport(familyId) {
      assertUsable();
      if (familyId !== undefined) return buildFamilyAsset(getFamily(familyId)).topology;
      return Object.freeze(familyCatalog.map(
        (definition) => buildFamilyAsset(definition).topology
      ));
    }

    /** Publishes pool and measured budget evidence without exposing mutable material or Object3D internals. */
    function getDiagnostics() {
      const triangles = [...assetsByFamily.values()].map(({ metrics }) => metrics.triangles);
      const drawGroups = [...assetsByFamily.values()].map(({ metrics }) => metrics.drawGroups);
      const materials = [...assetsByFamily.values()].map(({ metrics }) => metrics.materials);
      return Object.freeze({
        disposed,
        qualityKey,
        renderQualityId,
        familyCount: familyCatalog.length,
        builtFamilyCount: assetsByFamily.size,
        objectAllocationCount,
        assetBuildCount,
        pooledCount: [...pools.values()].reduce((sum, pool) => sum + pool.length, 0),
        activeCount: activeRecords.size,
        prewarmComplete,
        frameAssetAllocations: 0,
        maximumMeasuredTriangles: triangles.length > 0 ? Math.max(...triangles) : 0,
        maximumMeasuredDrawGroups: drawGroups.length > 0 ? Math.max(...drawGroups) : 0,
        maximumMeasuredMaterials: materials.length > 0 ? Math.max(...materials) : 0,
        sceneLights: 0,
        gameplayWrites: 0
      });
    }

    /** Disposes all factory-owned materials and shared geometries exactly once; no scene is accepted or mutated. */
    function dispose() {
      if (disposed) return false;
      disposed = true;
      for (const record of records) {
        record.root.visible = false;
        record.active = false;
        for (const material of record.uniqueMaterials) material.dispose();
      }
      for (const asset of assetsByFamily.values()) {
        asset.coreGeometry.dispose();
        asset.accentGeometry.dispose();
        asset.cueGeometry.dispose();
        for (const material of new Set(asset.prototypeMaterials)) material.dispose();
      }
      activeRecords.clear();
      for (const pool of pools.values()) pool.length = 0;
      return true;
    }

    return Object.freeze({
      qualityKey,
      prewarm,
      availableCount,
      acquire,
      update,
      settle,
      release,
      shadow,
      setShadow: shadow,
      setRenderQuality,
      getTopologyReport,
      topology: getTopologyReport,
      getDiagnostics,
      diagnostics: getDiagnostics,
      dispose
    });
  }

  const api = Object.freeze({
    REALM_IDS,
    SCENE_LAYER_IDS,
    STATIC_MOTION_KIND,
    DYNAMIC_MOTION_KINDS,
    EXPECTED_FAMILY_IDS_BY_REALM,
    OBSTACLE_PRESENTATION_CONTRACT,
    familyCatalog,
    getFamily,
    getRealmFamilies,
    validateConfiguredZones,
    createFactory
  });
  // The singular alias supports integrators that name the factory surface, while both globals share one frozen API.
  window.NeonV23ObstacleFactory = api;
  return api;
})();
