/*
 * V23 original ambient-creature catalog and pooled visual factory.
 * Placement certificates remain external authority; this module owns presentation-only meshes and motion.
 */
window.NeonV23Creatures = (() => {
  'use strict';

  const REALM_IDS = Object.freeze([
    'dawn-isle',
    'prairie-garden',
    'rainforest-glow',
    'twilight-valley',
    'star-vault',
    'eden-eye'
  ]);
  const QUALITY_IDS = Object.freeze(['low', 'medium', 'high']);
  // Adjacent-realm ecology is confined to the same final 72m owned by the world blend. Three equal segments retain
  // the existing per-instance lifecycle and capacity while removing the former 480m early-preview scale.
  const TRANSITION_PREVIEW_LENGTH_M = 72;
  const TRANSITION_PREVIEW_SEGMENT_COUNT = 3;
  const TRANSITION_PREVIEW_SEGMENT_LENGTH_M = (
    TRANSITION_PREVIEW_LENGTH_M / TRANSITION_PREVIEW_SEGMENT_COUNT
  );
  const TRANSITION_POLICY = Object.freeze({
    currentOnly: 'current-realm-only',
    adjacentPreview: `adjacent-realm-preview-${TRANSITION_PREVIEW_LENGTH_M}m`
  });
  const SCALE_CLASSES = Object.freeze(['small-cluster', 'medium', 'large']);
  const CLEARANCE_CLASSES = Object.freeze({
    'air-complete-road-clearance': Object.freeze({
      sceneLayer: 'air',
      eitherCompleteLowerEdgeAboveDeckM: 6,
      orCompleteHorizontalRoadCapsuleGapM: 6
    }),
    'roadside-complete-road-clearance': Object.freeze({
      sceneLayer: 'roadside',
      eitherCompleteLowerEdgeAboveDeckM: 6,
      orCompleteHorizontalRoadCapsuleGapM: 6
    })
  });
  const QUALITY_BUDGETS = Object.freeze({
    high: Object.freeze({
      maximumVisibleRootsPerRealm: 8,
      maximumTrianglesPerFamily: 2_200,
      maximumVisibleTrianglesPerRealm: 15_000
    }),
    medium: Object.freeze({
      maximumVisibleRootsPerRealm: 8,
      maximumTrianglesPerFamily: 2_200,
      maximumVisibleTrianglesPerRealm: 15_000
    }),
    low: Object.freeze({
      maximumVisibleRootsPerRealm: 4,
      maximumTrianglesPerFamily: 800,
      maximumVisibleTrianglesPerRealm: 5_000
    })
  });
  const PREVIEW_SEGMENTS = Object.freeze([
    Object.freeze({ id: 'front', startM: 0, endM: TRANSITION_PREVIEW_SEGMENT_LENGTH_M }),
    Object.freeze({
      id: 'middle',
      startM: TRANSITION_PREVIEW_SEGMENT_LENGTH_M,
      endM: TRANSITION_PREVIEW_SEGMENT_LENGTH_M * 2
    }),
    Object.freeze({
      id: 'back',
      startM: TRANSITION_PREVIEW_SEGMENT_LENGTH_M * 2,
      endM: TRANSITION_PREVIEW_LENGTH_M
    })
  ]);

  /** Freeze nested public metadata without freezing live Three.js resources. */
  function deepFreeze(value, seen = new WeakSet()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) {
      return value;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
  }

  function defineFamily({
    id,
    realmId,
    labelZh,
    labelEn,
    sceneLayer,
    mapPriority,
    scaleClass,
    transitionPolicy,
    motionEnvelopeM,
    geometryCode,
    bodyLengthM,
    bodyRadiusM,
    appendageCount,
    clusterCount,
    wingStyle,
    tailBend,
    palette
  }) {
    if (!REALM_IDS.includes(realmId)) throw new RangeError(`Unknown creature realm: ${realmId}`);
    if (!['air', 'roadside'].includes(sceneLayer)) {
      throw new RangeError(`Unknown creature scene layer: ${sceneLayer}`);
    }
    if (!SCALE_CLASSES.includes(scaleClass)) {
      throw new RangeError(`Unknown creature scale class: ${scaleClass}`);
    }
    if (!Object.values(TRANSITION_POLICY).includes(transitionPolicy)) {
      throw new RangeError(`Unknown creature transition policy: ${transitionPolicy}`);
    }
    if (transitionPolicy === TRANSITION_POLICY.adjacentPreview && scaleClass !== 'small-cluster') {
      throw new RangeError(`Only small creature families may preview transitions: ${id}`);
    }
    return deepFreeze({
      id,
      realmId,
      labelZh,
      labelEn,
      sceneLayer,
      semanticRole: 'creature-ambient',
      collisionRole: 'none',
      mapPriority,
      scaleClass,
      transitionPolicy,
      motionEnvelopeM,
      clearanceClass: `${sceneLayer}-complete-road-clearance`,
      presentationOnly: true,
      lightCount: 0,
      tunnelPolicy: 'hidden',
      geometry: {
        geometryCode,
        bodyLengthM,
        bodyRadiusM,
        appendageCount,
        clusterCount,
        wingStyle,
        tailBend,
        palette
      }
    });
  }

  const CREATURE_CATALOG = Object.freeze([
    defineFamily({
      id: 'triwing-mist-sail',
      realmId: 'dawn-isle',
      labelZh: '三翼雾帆兽',
      labelEn: 'Triwing Mist Sail',
      sceneLayer: 'air',
      mapPriority: 1,
      scaleClass: 'large',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 2.4,
      geometryCode: 1,
      bodyLengthM: 4.8,
      bodyRadiusM: 0.62,
      appendageCount: 3,
      clusterCount: 1,
      wingStyle: 0,
      tailBend: 0.44,
      palette: [0xff_d6a1, 0x9f_dff3]
    }),
    defineFamily({
      id: 'windseed-swallow-flock',
      realmId: 'dawn-isle',
      labelZh: '风籽燕群',
      labelEn: 'Windseed Swallow Flock',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'small-cluster',
      transitionPolicy: TRANSITION_POLICY.adjacentPreview,
      motionEnvelopeM: 1.2,
      geometryCode: 2,
      bodyLengthM: 1.8,
      bodyRadiusM: 0.26,
      appendageCount: 4,
      clusterCount: 3,
      wingStyle: 1,
      tailBend: -0.28,
      palette: [0xf4_e5b8, 0x76_cce0]
    }),
    defineFamily({
      id: 'ringtail-cloud-worm',
      realmId: 'dawn-isle',
      labelZh: '环尾云蠕兽',
      labelEn: 'Ringtail Cloud Worm',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'medium',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 1.8,
      geometryCode: 3,
      bodyLengthM: 3.6,
      bodyRadiusM: 0.48,
      appendageCount: 5,
      clusterCount: 1,
      wingStyle: 2,
      tailBend: 0.72,
      palette: [0xd7_c9a2, 0x80_bcd6]
    }),
    defineFamily({
      id: 'bellwing-pollinator-flock',
      realmId: 'prairie-garden',
      labelZh: '铃翼授粉群',
      labelEn: 'Bellwing Pollinator Flock',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'small-cluster',
      transitionPolicy: TRANSITION_POLICY.adjacentPreview,
      motionEnvelopeM: 1.1,
      geometryCode: 4,
      bodyLengthM: 1.6,
      bodyRadiusM: 0.30,
      appendageCount: 6,
      clusterCount: 3,
      wingStyle: 3,
      tailBend: 0.18,
      palette: [0xff_c964, 0xc7_75d8]
    }),
    defineFamily({
      id: 'petal-sail-grazer',
      realmId: 'prairie-garden',
      labelZh: '瓣帆牧游兽',
      labelEn: 'Petal Sail Grazer',
      sceneLayer: 'roadside',
      mapPriority: 1,
      scaleClass: 'large',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 0.8,
      geometryCode: 5,
      bodyLengthM: 4.4,
      bodyRadiusM: 0.76,
      appendageCount: 5,
      clusterCount: 1,
      wingStyle: 4,
      tailBend: -0.36,
      palette: [0x92_c76c, 0xf2_9fc3]
    }),
    defineFamily({
      id: 'moss-orb-skydrifter',
      realmId: 'prairie-garden',
      labelZh: '苔球浮游兽',
      labelEn: 'Moss Orb Skydrifter',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'medium',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 1.6,
      geometryCode: 6,
      bodyLengthM: 2.7,
      bodyRadiusM: 0.86,
      appendageCount: 7,
      clusterCount: 1,
      wingStyle: 5,
      tailBend: 0.52,
      palette: [0x77_a65b, 0xcf_e789]
    }),
    defineFamily({
      id: 'leaf-skiff-bird',
      realmId: 'rainforest-glow',
      labelZh: '叶舟鸟',
      labelEn: 'Leaf Skiff Bird',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'small-cluster',
      transitionPolicy: TRANSITION_POLICY.adjacentPreview,
      motionEnvelopeM: 1.3,
      geometryCode: 7,
      bodyLengthM: 2.0,
      bodyRadiusM: 0.34,
      appendageCount: 3,
      clusterCount: 2,
      wingStyle: 0,
      tailBend: -0.62,
      palette: [0x4f_a66f, 0xa9_e6b5]
    }),
    defineFamily({
      id: 'rainlamp-frog',
      realmId: 'rainforest-glow',
      labelZh: '雨灯蛙',
      labelEn: 'Rainlamp Frog',
      sceneLayer: 'roadside',
      mapPriority: 1,
      scaleClass: 'medium',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 0.6,
      geometryCode: 8,
      bodyLengthM: 2.4,
      bodyRadiusM: 0.72,
      appendageCount: 4,
      clusterCount: 1,
      wingStyle: 2,
      tailBend: 0.12,
      palette: [0x2f_7757, 0x9d_f1cd]
    }),
    defineFamily({
      id: 'sixfin-glow-snail',
      realmId: 'rainforest-glow',
      labelZh: '六鳍辉蜗',
      labelEn: 'Sixfin Glow Snail',
      sceneLayer: 'roadside',
      mapPriority: 0,
      scaleClass: 'large',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 0.4,
      geometryCode: 9,
      bodyLengthM: 3.8,
      bodyRadiusM: 0.90,
      appendageCount: 6,
      clusterCount: 1,
      wingStyle: 5,
      tailBend: 0.86,
      palette: [0x5e_806b, 0x52_edc7]
    }),
    defineFamily({
      id: 'ice-shuttle-swift',
      realmId: 'twilight-valley',
      labelZh: '冰梭雨燕',
      labelEn: 'Ice Shuttle Swift',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'small-cluster',
      transitionPolicy: TRANSITION_POLICY.adjacentPreview,
      motionEnvelopeM: 1.5,
      geometryCode: 10,
      bodyLengthM: 2.1,
      bodyRadiusM: 0.28,
      appendageCount: 4,
      clusterCount: 2,
      wingStyle: 1,
      tailBend: -0.48,
      palette: [0x9b_cfea, 0xf5_a8c7]
    }),
    defineFamily({
      id: 'ringtail-snow-runner',
      realmId: 'twilight-valley',
      labelZh: '环尾雪行兽',
      labelEn: 'Ringtail Snow Runner',
      sceneLayer: 'roadside',
      mapPriority: 1,
      scaleClass: 'medium',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 0.9,
      geometryCode: 11,
      bodyLengthM: 3.2,
      bodyRadiusM: 0.58,
      appendageCount: 5,
      clusterCount: 1,
      wingStyle: 3,
      tailBend: 0.94,
      palette: [0xca_dcea, 0xd8_79a7]
    }),
    defineFamily({
      id: 'prism-glide-bird',
      realmId: 'twilight-valley',
      labelZh: '棱辉滑翔鸟',
      labelEn: 'Prism Glide Bird',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'large',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 2.0,
      geometryCode: 12,
      bodyLengthM: 4.2,
      bodyRadiusM: 0.50,
      appendageCount: 7,
      clusterCount: 1,
      wingStyle: 4,
      tailBend: -0.20,
      palette: [0x91_b9df, 0xf0_8fb9]
    }),
    defineFamily({
      id: 'spiral-script-finch',
      realmId: 'star-vault',
      labelZh: '旋文雀',
      labelEn: 'Spiral Script Finch',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'small-cluster',
      transitionPolicy: TRANSITION_POLICY.adjacentPreview,
      motionEnvelopeM: 1.0,
      geometryCode: 13,
      bodyLengthM: 1.7,
      bodyRadiusM: 0.24,
      appendageCount: 5,
      clusterCount: 3,
      wingStyle: 2,
      tailBend: 1.08,
      palette: [0x82_8ae4, 0xdb_c8ff]
    }),
    defineFamily({
      id: 'polyhedral-star-mite',
      realmId: 'star-vault',
      labelZh: '多面星螨',
      labelEn: 'Polyhedral Star Mite',
      sceneLayer: 'roadside',
      mapPriority: 0,
      scaleClass: 'medium',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 0.5,
      geometryCode: 14,
      bodyLengthM: 2.3,
      bodyRadiusM: 0.62,
      appendageCount: 8,
      clusterCount: 1,
      wingStyle: 5,
      tailBend: -0.74,
      palette: [0x6f_73c7, 0xf0_d36c]
    }),
    defineFamily({
      id: 'orbit-dust-shoal',
      realmId: 'star-vault',
      labelZh: '轨尘游群',
      labelEn: 'Orbit Dust Shoal',
      sceneLayer: 'air',
      mapPriority: 1,
      scaleClass: 'large',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 2.2,
      geometryCode: 15,
      bodyLengthM: 3.6,
      bodyRadiusM: 0.46,
      appendageCount: 6,
      clusterCount: 3,
      wingStyle: 0,
      tailBend: 0.68,
      palette: [0x9a_91d4, 0xe5_d3a1]
    }),
    defineFamily({
      id: 'ash-corvid-flock',
      realmId: 'eden-eye',
      labelZh: '灰烬鸦群',
      labelEn: 'Ash Corvid Flock',
      sceneLayer: 'air',
      mapPriority: 0,
      scaleClass: 'small-cluster',
      transitionPolicy: TRANSITION_POLICY.adjacentPreview,
      motionEnvelopeM: 1.4,
      geometryCode: 16,
      bodyLengthM: 1.9,
      bodyRadiusM: 0.30,
      appendageCount: 4,
      clusterCount: 3,
      wingStyle: 3,
      tailBend: -0.92,
      palette: [0x47_4148, 0xd4_6552]
    }),
    defineFamily({
      id: 'four-sail-storm-beast',
      realmId: 'eden-eye',
      labelZh: '四帆风暴兽',
      labelEn: 'Four Sail Storm Beast',
      sceneLayer: 'air',
      mapPriority: 1,
      scaleClass: 'large',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 2.6,
      geometryCode: 17,
      bodyLengthM: 5.2,
      bodyRadiusM: 0.82,
      appendageCount: 4,
      clusterCount: 1,
      wingStyle: 4,
      tailBend: 0.38,
      palette: [0x55_4b55, 0xf0_5b43]
    }),
    defineFamily({
      id: 'cracked-shell-drifter',
      realmId: 'eden-eye',
      labelZh: '裂壳漂游兽',
      labelEn: 'Cracked Shell Drifter',
      sceneLayer: 'roadside',
      mapPriority: 0,
      scaleClass: 'medium',
      transitionPolicy: TRANSITION_POLICY.currentOnly,
      motionEnvelopeM: 0.7,
      geometryCode: 18,
      bodyLengthM: 3.0,
      bodyRadiusM: 0.74,
      appendageCount: 7,
      clusterCount: 1,
      wingStyle: 1,
      tailBend: -1.14,
      palette: [0x68_5451, 0xff_7a53]
    })
  ]);

  const familiesById = new Map(CREATURE_CATALOG.map((definition) => [definition.id, definition]));
  const familiesByRealm = new Map(REALM_IDS.map((realmId) => [
    realmId,
    Object.freeze(CREATURE_CATALOG.filter((definition) => definition.realmId === realmId))
  ]));

  const CREATURE_VISUAL_CONTRACT = deepFreeze({
    version: 3,
    artDirection: {
      silhouetteLanguage: 'living-woven-cloth',
      faceLanguage: 'quiet-two-eye-spirit-mask',
      surfaceLanguage: 'matte-pigment-and-soft-memory-glow',
      spiritMasksPerVisibleMember: 1,
      maskEyesPerVisibleMember: 2,
      modernMechanicalPartCount: 0,
      singleMergedDrawGeometry: true
    },
    semanticRole: 'creature-ambient',
    presentationOnly: true,
    collisionRole: 'none',
    lightCount: 0,
    colliderCount: 0,
    routeWrites: 0,
    maximumMapRecordsPerRoot: 1,
    clusterMembersReceiveMapRecords: false,
    qualityBudgets: QUALITY_BUDGETS,
    maximumDrawGroupsPerFamily: 3,
    maximumMaterialsPerFamily: 3,
    poolInstancesPerFamily: 3,
    clearanceClasses: CLEARANCE_CLASSES,
    transition: {
      policy: TRANSITION_POLICY.adjacentPreview,
      previewLengthM: TRANSITION_PREVIEW_LENGTH_M,
      segmentLengthM: TRANSITION_PREVIEW_SEGMENT_LENGTH_M,
      segments: PREVIEW_SEGMENTS,
      allowedScaleClass: 'small-cluster',
      instanceRealmRemainsAuthoritative: true
    },
    spacing: {
      largeCenterM: 120,
      smallClusterM: 45
    },
    avoidance: {
      minimumForwardM: 120,
      velocityMultiplier: 2,
      readingWedgeMinimumForwardM: 160,
      readingWedgeVelocityMultiplier: 0.8,
      readingWedgeHalfAngleDegrees: 12
    },
    visibleIntersection: {
      policy: 'closed-components-with-hidden-attachment-seams-only',
      componentRangesStoredOnGeometry: true,
      maximumForbiddenTriangleCrossingsPerQuality: 0,
      minimumClusterMemberSurfaceGapM: 0.06,
      permittedAttachmentPairs: [
        'body-mask-same-member',
        'mask-eye-same-member',
        'body-appendage-primary-member',
        'body-tail-primary-member'
      ],
      separatedAppendageFamilyIds: [
        'moss-orb-skydrifter',
        'polyhedral-star-mite',
        'cracked-shell-drifter'
      ],
      clusterClearanceFamilyIds: [
        'windseed-swallow-flock',
        'bellwing-pollinator-flock',
        'leaf-skiff-bird',
        'spiral-script-finch',
        'orbit-dust-shoal',
        'ash-corvid-flock'
      ],
      appendageAxialSpreadRatio: {
        standard: 0.34,
        separated: 0.92
      }
    },
    pauseFreezesPresentation: true,
    reducedMotionDecorationsOnly: true,
    sealedTunnelVisibleRoots: 0,
    frameGeometryAllocations: 0,
    frameMaterialAllocations: 0,
    legacyReplacementAliases: {
      sky_manta: 'triwing-mist-sail',
      dark_dragon: 'four-sail-storm-beast'
    }
  });

  function describe(realmId, familyId) {
    const definition = familiesById.get(familyId);
    if (!REALM_IDS.includes(realmId)) throw new RangeError(`Unknown creature realm: ${realmId}`);
    if (!definition || definition.realmId !== realmId) {
      throw new RangeError(`Unknown creature family ${familyId} for realm ${realmId}`);
    }
    return definition;
  }

  /**
   * Validate ordered realm configuration. Creature lists are optional until the shared configuration is wired;
   * when supplied, they must exactly match this module's three-family authority for that realm.
   */
  function validateConfiguredZones(zones) {
    if (!Array.isArray(zones)) throw new TypeError('Creature configured zones must be an array.');
    if (zones.length !== REALM_IDS.length) {
      throw new RangeError(`Creature configuration requires exactly ${REALM_IDS.length} zones.`);
    }
    const seen = new Set();
    for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
      const zone = zones[zoneIndex];
      const expectedRealmId = REALM_IDS[zoneIndex];
      if (!zone || zone.id !== expectedRealmId) {
        throw new RangeError(`Creature configuration expected zone ${expectedRealmId} at index ${zoneIndex}.`);
      }
      if (seen.has(zone.id)) throw new RangeError(`Duplicate creature zone id: ${zone.id}`);
      seen.add(zone.id);
      if (zone.creatureFamilies !== undefined) {
        if (!Array.isArray(zone.creatureFamilies) || zone.creatureFamilies.length !== 3) {
          throw new RangeError(`${zone.id} must configure exactly three creature families.`);
        }
        const expected = familiesByRealm.get(zone.id).map(({ id }) => id);
        if (zone.creatureFamilies.some((id, index) => id !== expected[index])) {
          throw new RangeError(`${zone.id} creature family order does not match the frozen catalog.`);
        }
      }
    }
    return true;
  }

  function hashVisualSeed(value) {
    const source = String(value);
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

  function visualUnit(value) {
    let sample = hashVisualSeed(value) || 0x6d2b_79f5;
    sample = Math.imul(sample ^ sample >>> 15, sample | 1);
    sample ^= sample + Math.imul(sample ^ sample >>> 7, sample | 61);
    return ((sample ^ sample >>> 14) >>> 0) / 4_294_967_296;
  }

  function normalizeQualityId(value) {
    const rawId = typeof value === 'string' ? value : value?.id;
    const id = typeof rawId === 'string' ? rawId.toLowerCase() : rawId;
    if (id === 'mobile' || id === 'low') return 'low';
    if (id === 'desktop' || id === 'ultra' || id === 'high') return 'high';
    if (id === 'medium') return 'medium';
    throw new RangeError(`Unknown creature render quality: ${id}`);
  }

  function triangleCount(geometry) {
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    return Math.floor((index ? index.count : position.count) / 3);
  }

  /** Merge sealed components into one draw geometry while retaining ranges for real triangle-crossing audits. */
  function mergeClosedGeometries(THREE, components, metadata) {
    const positions = [];
    const indices = [];
    const componentRanges = [];
    let vertexOffset = 0;
    for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
      const component = components[componentIndex];
      const geometry = component.geometry || component;
      const position = geometry.getAttribute('position');
      const index = geometry.getIndex();
      const triangleStart = indices.length / 3;
      for (let vertex = 0; vertex < position.count; vertex++) {
        positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      }
      if (index) {
        for (let offset = 0; offset < index.count; offset++) {
          indices.push(vertexOffset + index.getX(offset));
        }
      } else {
        for (let vertex = 0; vertex < position.count; vertex++) indices.push(vertexOffset + vertex);
      }
      componentRanges.push(Object.freeze({
        componentIndex,
        kind: component.kind || 'unspecified',
        memberIndex: Number.isInteger(component.memberIndex) ? component.memberIndex : 0,
        partIndex: Number.isInteger(component.partIndex) ? component.partIndex : 0,
        vertexStart: vertexOffset,
        vertexCount: position.count,
        triangleStart,
        triangleCount: (indices.length / 3) - triangleStart
      }));
      vertexOffset += position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setIndex(indices);
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    merged.userData.neonV23 = {
      factory: 'creature-merged-closed-components',
      closedExpected: true,
      immutable: true,
      ...metadata,
      componentRanges: Object.freeze(componentRanges)
    };
    merged.userData.neonV23ImmutableTopology = true;
    for (const component of components) (component.geometry || component).dispose();
    return merged;
  }

  function wingOutline(style, length, radius, code) {
    const skew = (code % 5 - 2) * 0.035;
    const outlines = [
      [[0, -radius * 0.25], [length * 0.34, -radius * 0.54], [length, -radius * 0.12],
        [length * 0.70, radius * 0.20], [length * 0.22, radius * 0.48], [0, radius * 0.22]],
      [[0, -radius * 0.20], [length * 0.28, -radius * 0.68], [length * 0.62, -radius * 0.34],
        [length, 0], [length * 0.56, radius * 0.25], [length * 0.16, radius * 0.55]],
      [[0, -radius * 0.32], [length * 0.22, -radius * 0.50], [length * 0.48, -radius * 0.62],
        [length, -radius * 0.08], [length * 0.60, radius * 0.18], [length * 0.30, radius * 0.58],
        [0, radius * 0.28]],
      [[0, -radius * 0.18], [length * 0.36, -radius * 0.70], [length * 0.58, -radius * 0.20],
        [length, radius * 0.06], [length * 0.52, radius * 0.46], [length * 0.18, radius * 0.34]],
      [[0, -radius * 0.28], [length * 0.18, -radius * 0.62], [length * 0.52, -radius * 0.46],
        [length * 0.78, -radius * 0.12], [length, radius * 0.22], [length * 0.44, radius * 0.50],
        [length * 0.16, radius * 0.42]],
      [[0, -radius * 0.38], [length * 0.30, -radius * 0.58], [length * 0.72, -radius * 0.36],
        [length, 0], [length * 0.76, radius * 0.34], [length * 0.34, radius * 0.62],
        [0, radius * 0.30]]
    ];
    return outlines[style].map(([x, y], index) => [
      x * (1 + skew),
      y + Math.sin((index + 1) * (code + 2)) * radius * 0.035
    ]);
  }

  function qualityShape(qualityId) {
    if (qualityId === 'high') {
      return { radialSegments: 14, tubeSegments: 9, tubeSides: 7, appendageLimit: 8, bevel: true };
    }
    if (qualityId === 'medium') {
      return { radialSegments: 10, tubeSegments: 7, tubeSides: 6, appendageLimit: 6, bevel: true };
    }
    return { radialSegments: 7, tubeSegments: 5, tubeSides: 4, appendageLimit: 3, bevel: false };
  }

  /**
   * Build one quality variant from sealed authored components. The relief mask is part of the creature rather than
   * a billboard: it keeps the paired Sky-like eyes readable from Film angles without adding a light, draw call,
   * animation authority, or fragile coplanar decal.
   */
  function buildFamilyGeometry(THREE, modeling, definition, qualityId) {
    const recipe = definition.geometry;
    const detail = qualityShape(qualityId);
    const parts = [];
    const memberCount = qualityId === 'low'
      ? Math.min(recipe.clusterCount, 2)
      : recipe.clusterCount;
    const profileBias = recipe.geometryCode * 0.006;
    const appendageLength = recipe.bodyLengthM * (0.30 + recipe.geometryCode * 0.004);
    const primaryAppendageRadialReachM = recipe.bodyRadiusM * 0.62
      + Math.hypot(appendageLength * 1.05, recipe.bodyRadiusM * 0.72);
    for (let member = 0; member < memberCount; member++) {
      const memberScale = 1 - member * 0.12;
      const memberSide = member % 2 === 0 ? -1 : 1;
      // Secondary flock members sit beyond the complete primary appendage envelope. Their authored Y/Z stagger still
      // reads as a flock, while the explicit radial gap prevents a wing from passing through a neighbouring body.
      const secondaryMemberRadialReachM = recipe.bodyRadiusM
        * (1 + profileBias)
        * memberScale;
      const memberOffsetX = member > 0
        ? memberSide * (
            primaryAppendageRadialReachM
            + secondaryMemberRadialReachM
            + CREATURE_VISUAL_CONTRACT.visibleIntersection.minimumClusterMemberSurfaceGapM
          ) * (1 + (member - 1) * 0.12)
        : 0;
      const memberOffsetY = member > 0 ? recipe.bodyRadiusM * member * 0.42 : 0;
      const memberOffsetZ = member > 0 ? recipe.bodyLengthM * member * 0.24 : 0;
      const body = modeling.createRadialGeometry({
        THREE,
        axis: 'z',
        segments: detail.radialSegments,
        profile: [
          [-recipe.bodyLengthM * 0.50, recipe.bodyRadiusM * (0.42 + profileBias)],
          [-recipe.bodyLengthM * 0.28, recipe.bodyRadiusM * (0.82 - profileBias)],
          [0, recipe.bodyRadiusM * (1 + profileBias)],
          [recipe.bodyLengthM * 0.30, recipe.bodyRadiusM * (0.70 + profileBias)],
          [recipe.bodyLengthM * 0.50, recipe.bodyRadiusM * (0.28 + profileBias)]
        ]
      });
      body.scale(memberScale, memberScale, memberScale);
      body.translate(memberOffsetX, memberOffsetY, memberOffsetZ);
      parts.push({ geometry: body, kind: 'body', memberIndex: member, partIndex: 0 });

      const maskDepthM = Math.max(0.045, recipe.bodyRadiusM * 0.16) * memberScale;
      const maskRadiusM = recipe.bodyRadiusM * 0.48 * memberScale;
      const maskCenterZ = memberOffsetZ - recipe.bodyLengthM * 0.505 * memberScale;
      const mask = modeling.createRadialGeometry({
        THREE,
        axis: 'z',
        segments: Math.max(6, detail.radialSegments - 2),
        profile: [
          [-maskDepthM * 0.50, maskRadiusM * 0.72],
          [0, maskRadiusM],
          [maskDepthM * 0.50, maskRadiusM * 0.82]
        ]
      });
      mask.scale(0.82, 1.08, 1);
      mask.translate(memberOffsetX, memberOffsetY, maskCenterZ);
      parts.push({ geometry: mask, kind: 'mask', memberIndex: member, partIndex: 0 });

      const eyeRadiusM = Math.max(0.018, recipe.bodyRadiusM * 0.075) * memberScale;
      const eyeDepthM = Math.max(0.025, recipe.bodyRadiusM * 0.07) * memberScale;
      for (const eyeSide of [-1, 1]) {
        const eye = modeling.createRadialGeometry({
          THREE,
          axis: 'z',
          segments: Math.max(5, detail.radialSegments - 4),
          profile: [
            [-eyeDepthM * 0.50, eyeRadiusM * 0.52],
            [0, eyeRadiusM],
            [eyeDepthM * 0.50, eyeRadiusM * 0.62]
          ]
        });
        eye.scale(0.74, 1.18, 1);
        eye.translate(
          memberOffsetX + eyeSide * maskRadiusM * 0.30,
          memberOffsetY + maskRadiusM * 0.06,
          maskCenterZ - maskDepthM * 0.62
        );
        parts.push({ geometry: eye, kind: 'eye', memberIndex: member, partIndex: eyeSide });
      }
    }

    const appendageCount = Math.min(recipe.appendageCount, detail.appendageLimit);
    const appendageSpreadRatio = CREATURE_VISUAL_CONTRACT.visibleIntersection
      .separatedAppendageFamilyIds.includes(definition.id)
      ? CREATURE_VISUAL_CONTRACT.visibleIntersection.appendageAxialSpreadRatio.separated
      : CREATURE_VISUAL_CONTRACT.visibleIntersection.appendageAxialSpreadRatio.standard;
    const outline = wingOutline(
      recipe.wingStyle,
      appendageLength,
      recipe.bodyRadiusM,
      recipe.geometryCode
    );
    for (let appendage = 0; appendage < appendageCount; appendage++) {
      const fin = modeling.createExtrudedProfileGeometry({
        THREE,
        outline,
        depth: Math.max(0.05, recipe.bodyRadiusM * 0.18),
        bevel: detail.bevel ? Math.max(0.012, recipe.bodyRadiusM * 0.035) : 0,
        bevelSegments: 1
      });
      const angle = appendage / appendageCount * Math.PI * 2
        + recipe.geometryCode * 0.071;
      fin.rotateZ(angle);
      fin.rotateX((appendage % 2 === 0 ? 1 : -1) * recipe.geometryCode * 0.009);
      fin.translate(
        Math.cos(angle) * recipe.bodyRadiusM * 0.62,
        Math.sin(angle) * recipe.bodyRadiusM * 0.62,
        (appendage / Math.max(1, appendageCount - 1) - 0.5)
          * recipe.bodyLengthM
          * appendageSpreadRatio
      );
      parts.push({ geometry: fin, kind: 'appendage', memberIndex: 0, partIndex: appendage });
    }

    const tail = modeling.createTubeGeometry({
      THREE,
      points: [
        [0, 0, recipe.bodyLengthM * 0.38],
        [recipe.tailBend * recipe.bodyRadiusM * 0.28, recipe.bodyRadiusM * 0.10,
          recipe.bodyLengthM * 0.62],
        [recipe.tailBend * recipe.bodyRadiusM * 0.68, -recipe.bodyRadiusM * 0.14,
          recipe.bodyLengthM * 0.86],
        [recipe.tailBend * recipe.bodyRadiusM, recipe.bodyRadiusM * 0.06,
          recipe.bodyLengthM * (1.04 + recipe.geometryCode * 0.004)]
      ],
      radii: [
        recipe.bodyRadiusM * 0.24,
        recipe.bodyRadiusM * 0.18,
        recipe.bodyRadiusM * 0.11,
        recipe.bodyRadiusM * 0.06
      ],
      tubularSegments: detail.tubeSegments,
      radialSegments: detail.tubeSides
    });
    parts.push({ geometry: tail, kind: 'tail', memberIndex: 0, partIndex: 0 });

    const geometry = mergeClosedGeometries(THREE, parts, {
      familyId: definition.id,
      qualityId,
      geometryCode: recipe.geometryCode,
      artDirectionVersion: CREATURE_VISUAL_CONTRACT.version,
      spiritMaskCount: memberCount,
      maskEyeCount: memberCount * CREATURE_VISUAL_CONTRACT.artDirection.maskEyesPerVisibleMember,
      modernMechanicalPartCount: 0
    });
    const topology = deepFreeze(modeling.analyzeTopology(geometry));
    if (!topology.isClosed || topology.invalidCoordinates !== 0
      || topology.degenerateTriangles !== 0 || topology.nonManifoldEdges !== 0) {
      geometry.dispose();
      throw new Error(`Creature geometry failed closed topology for ${definition.id}/${qualityId}.`);
    }
    return { geometry, topology, triangles: triangleCount(geometry) };
  }

  function createFactory(options = {}) {
    const {
      THREE,
      modeling,
      qualityProfile = 'medium',
      zonesById,
      visualSeed,
      markMainVisual = modeling?.markMainVisual,
      tagBloom = () => {},
      markEffect = modeling?.markEffect
    } = options;
    if (!THREE?.Group || !THREE?.Mesh || !THREE?.BufferGeometry) {
      throw new TypeError('Creature factory requires THREE visual constructors.');
    }
    for (const method of [
      'createRadialGeometry',
      'createExtrudedProfileGeometry',
      'createTubeGeometry',
      'createMaterial',
      'analyzeTopology'
    ]) {
      if (typeof modeling?.[method] !== 'function') {
        throw new TypeError(`Creature factory requires modeling.${method}.`);
      }
    }
    if (typeof visualSeed !== 'string' || visualSeed.trim() === '') {
      throw new TypeError('Creature factory requires a non-empty independent visualSeed.');
    }
    if (markMainVisual !== undefined && typeof markMainVisual !== 'function') {
      throw new TypeError('Creature markMainVisual dependency must be callable.');
    }
    if (typeof tagBloom !== 'function') throw new TypeError('Creature tagBloom dependency must be callable.');
    if (markEffect !== undefined && typeof markEffect !== 'function') {
      throw new TypeError('Creature markEffect dependency must be callable.');
    }
    if (zonesById !== undefined) {
      const configuredZones = Array.isArray(zonesById)
        ? zonesById
        : REALM_IDS.map((id) => zonesById instanceof Map ? zonesById.get(id) : zonesById[id]);
      validateConfiguredZones(configuredZones);
    }

    let activeQualityId = normalizeQualityId(qualityProfile);
    let prewarmed = false;
    let disposed = false;
    let serial = 0;
    let geometryAllocations = 0;
    let materialAllocations = 0;
    const poolsByFamily = new Map(CREATURE_CATALOG.map(({ id }) => [id, []]));
    const activeRecords = new Set();
    const allRecords = [];
    const recordByRoot = new WeakMap();
    const sharedGeometryByFamily = new Map();
    const topologyRoots = [];
    const measuredByFamily = Object.create(null);
    const placementMetricsByFamily = Object.create(null);

    function createMaterial(definition, qualityId) {
      const color = definition.geometry.palette[0];
      const glow = definition.geometry.palette[1];
      const qualityGlow = qualityId === 'high' ? 0.20 : qualityId === 'medium' ? 0.14 : 0.08;
      materialAllocations++;
      return modeling.createMaterial({
        THREE,
        kind: 'organic',
        color,
        emissive: glow,
        emissiveIntensity: qualityGlow,
        roughness: 0.84,
        metalness: 0,
        clearcoat: 0.02,
        clearcoatRoughness: 0.86,
        seed: `${visualSeed}:creatures:${definition.realmId}:${definition.id}:${qualityId}`
      });
    }

    function materialBaseline(material) {
      const primitiveEntries = [];
      const copiedEntries = [];
      const arrayEntries = [];
      const referenceEntries = [];
      for (const key of Object.keys(material)) {
        if (key === 'uuid' || key === 'version' || key === 'userData'
          || key.startsWith('is')) continue;
        const value = material[key];
        if (value === null || ['boolean', 'number', 'string', 'undefined'].includes(typeof value)) {
          primitiveEntries.push([key, value]);
        } else if (Array.isArray(value)) {
          arrayEntries.push([key, value.slice()]);
        } else if (typeof value.clone === 'function' && typeof value.copy === 'function') {
          copiedEntries.push([key, value.clone()]);
        } else {
          // Texture, shader-definition, and clipping references are construction assets, not live authorities.
          referenceEntries.push([key, value]);
        }
      }
      return {
        primitiveEntries,
        copiedEntries,
        arrayEntries,
        referenceEntries,
        emissiveIntensity: material.emissiveIntensity
      };
    }

    function resetMaterial(material, baseline) {
      for (const [key, value] of baseline.primitiveEntries) material[key] = value;
      for (const [key, value] of baseline.copiedEntries) material[key]?.copy(value);
      for (const [key, values] of baseline.arrayEntries) {
        const target = material[key];
        if (Array.isArray(target)) {
          target.length = values.length;
          for (let index = 0; index < values.length; index++) target[index] = values[index];
        } else {
          material[key] = values;
        }
      }
      for (const [key, value] of baseline.referenceEntries) material[key] = value;
    }

    function buildRecord(definition, instanceIndex) {
      const root = new THREE.Group();
      root.name = `creature-${definition.id}-${instanceIndex}`;
      const motionPivot = new THREE.Group();
      motionPivot.name = `${root.name}-motion`;
      root.add(motionPivot);
      const variants = Object.create(null);
      const materials = [];
      const baselines = [];
      const familyGeometry = sharedGeometryByFamily.get(definition.id);
      for (const qualityId of QUALITY_IDS) {
        // Three.js Object3D cloning shares materials, so every pooled root receives a dedicated mutable clone.
        const material = familyGeometry[qualityId].templateMaterial.clone();
        materialAllocations++;
        const mesh = new THREE.Mesh(familyGeometry[qualityId].geometry, material);
        mesh.name = `${definition.id}-${qualityId}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = qualityId === activeQualityId;
        mesh.userData = {
          creatureFamilyId: definition.id,
          creatureRealmId: definition.realmId,
          creatureQualityId: qualityId,
          presentationOnly: true,
          collisionRole: 'none',
          lightCount: 0,
          artDirectionVersion: CREATURE_VISUAL_CONTRACT.version,
          spiritMaskCount: familyGeometry[qualityId].geometry.userData.neonV23.spiritMaskCount,
          maskEyeCount: familyGeometry[qualityId].geometry.userData.neonV23.maskEyeCount,
          modernMechanicalPartCount: 0,
          topology: familyGeometry[qualityId].topology
        };
        tagBloom(mesh);
        motionPivot.add(mesh);
        variants[qualityId] = mesh;
        materials.push(material);
        baselines.push(materialBaseline(material));
      }
      root.visible = false;
      root.userData = {
        creatureFamilyId: definition.id,
        creatureRealmId: definition.realmId,
        creatureZoneIndex: REALM_IDS.indexOf(definition.realmId),
        zoneIndex: REALM_IDS.indexOf(definition.realmId),
        visualZone: REALM_IDS.indexOf(definition.realmId),
        semanticRole: definition.semanticRole,
        sceneLayer: definition.sceneLayer,
        collisionRole: 'none',
        presentationOnly: true,
        lightCount: 0,
        mapRecordLimit: 1,
        clusterMembersReceiveMapRecords: false,
        artDirectionVersion: CREATURE_VISUAL_CONTRACT.version,
        silhouetteLanguage: CREATURE_VISUAL_CONTRACT.artDirection.silhouetteLanguage,
        modernMechanicalPartCount: 0,
        active: false
      };
      markMainVisual?.(root, {
        family: definition.id,
        zoneId: definition.realmId,
        creatureAmbient: true,
        collisionIndependent: true
      });
      const record = {
        root,
        motionPivot,
        variants,
        materials,
        baselines,
        definition,
        phase: 0,
        active: false,
        requestedVisible: false,
        serial: 0
      };
      recordByRoot.set(root, record);
      allRecords.push(record);
      return record;
    }

    /** Build every quality geometry and all pooled mutable materials before any instance is shown. */
    function prewarm() {
      if (disposed) throw new Error('Creature factory has been disposed.');
      if (prewarmed) return false;
      for (const definition of CREATURE_CATALOG) {
        const familyGeometry = Object.create(null);
        const measured = Object.create(null);
        for (const qualityId of QUALITY_IDS) {
          const built = buildFamilyGeometry(THREE, modeling, definition, qualityId);
          geometryAllocations++;
          const budget = QUALITY_BUDGETS[qualityId];
          if (built.triangles > budget.maximumTrianglesPerFamily) {
            built.geometry.dispose();
            throw new RangeError(
              `${definition.id}/${qualityId} exceeded ${budget.maximumTrianglesPerFamily} triangles.`
            );
          }
          familyGeometry[qualityId] = {
            ...built,
            templateMaterial: createMaterial(definition, qualityId)
          };
          measured[qualityId] = deepFreeze({
            triangles: built.triangles,
            drawGroups: 1,
            materials: 1,
            topology: built.topology
          });
        }
        sharedGeometryByFamily.set(definition.id, familyGeometry);
        measuredByFamily[definition.id] = deepFreeze(measured);
        let localMinY = Number.POSITIVE_INFINITY;
        let localMaxY = Number.NEGATIVE_INFINITY;
        let maximumAbsoluteX = 0;
        let maximumAbsoluteZ = 0;
        for (const qualityId of QUALITY_IDS) {
          const geometry = familyGeometry[qualityId].geometry;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const box = geometry.boundingBox;
          localMinY = Math.min(localMinY, box.min.y);
          localMaxY = Math.max(localMaxY, box.max.y);
          maximumAbsoluteX = Math.max(maximumAbsoluteX, Math.abs(box.min.x), Math.abs(box.max.x));
          maximumAbsoluteZ = Math.max(maximumAbsoluteZ, Math.abs(box.min.z), Math.abs(box.max.z));
        }
        placementMetricsByFamily[definition.id] = deepFreeze({
          horizontalRadiusM: Math.hypot(maximumAbsoluteX, maximumAbsoluteZ),
          localMinY,
          localMaxY,
          motionEnvelopeM: definition.motionEnvelopeM
        });
        for (let instanceIndex = 0;
          instanceIndex < CREATURE_VISUAL_CONTRACT.poolInstancesPerFamily;
          instanceIndex++) {
          const record = buildRecord(definition, instanceIndex);
          poolsByFamily.get(definition.id).push(record);
          if (instanceIndex === 0) topologyRoots.push(record.root);
        }
      }
      prewarmed = true;
      return true;
    }

    function previewSegment(distanceM) {
      if (!Number.isFinite(distanceM) || distanceM < 0 || distanceM > TRANSITION_PREVIEW_LENGTH_M) {
        throw new RangeError(
          `Creature transition preview distance must stay within 0..${TRANSITION_PREVIEW_LENGTH_M}m.`
        );
      }
      if (distanceM === TRANSITION_PREVIEW_LENGTH_M) {
        return PREVIEW_SEGMENTS[TRANSITION_PREVIEW_SEGMENT_COUNT - 1];
      }
      return PREVIEW_SEGMENTS[Math.floor(distanceM / TRANSITION_PREVIEW_SEGMENT_LENGTH_M)];
    }

    function validateTransition(definition, preview) {
      if (preview === undefined || preview === null) return null;
      if (definition.transitionPolicy !== TRANSITION_POLICY.adjacentPreview
        || definition.scaleClass !== 'small-cluster') {
        throw new RangeError(`${definition.id} may not preview an adjacent realm.`);
      }
      const fromIndex = REALM_IDS.indexOf(preview.fromRealmId);
      const targetIndex = REALM_IDS.indexOf(definition.realmId);
      if (fromIndex < 0) throw new RangeError(`Unknown transition source realm: ${preview.fromRealmId}`);
      const next = (fromIndex + 1) % REALM_IDS.length;
      const previous = (fromIndex - 1 + REALM_IDS.length) % REALM_IDS.length;
      if (targetIndex !== next && targetIndex !== previous) {
        throw new RangeError('Creature transition preview realms must be adjacent.');
      }
      const segment = previewSegment(preview.distanceFromBoundaryM);
      if (preview.segmentId !== undefined && preview.segmentId !== segment.id) {
        throw new RangeError(`Creature transition preview expected ${segment.id} segment.`);
      }
      return segment.id;
    }

    /**
     * Consume a read-only placement proof. The complete creature outline must satisfy one of the two
     * clearance alternatives, while forward readability and family spacing remain explicit certificates.
     */
    function validatePlacement(definition, placement) {
      if (!placement || placement.authority !== 'complete-road-capsule-query') {
        throw new TypeError('Creature acquisition requires a complete-road-capsule-query placement proof.');
      }
      if (placement.realmId !== definition.realmId) {
        throw new RangeError('Creature placement proof realm does not match the family realm.');
      }
      if (typeof placement.sealedTunnel !== 'boolean') {
        throw new TypeError('Creature placement proof must explicitly declare sealedTunnel.');
      }
      if (placement.sealedTunnel === true) {
        throw new RangeError('Creature roots are hidden in sealed tunnels.');
      }
      if (typeof placement.crossesRoad !== 'boolean') {
        throw new TypeError('Creature placement proof must explicitly declare crossesRoad.');
      }
      if (placement.crossesRoad === true) {
        if (!Number.isFinite(placement.completeLowerEdgeM)
          || !Number.isFinite(placement.maximumDeckHeightM)
          || placement.completeLowerEdgeM < placement.maximumDeckHeightM + 6) {
          throw new RangeError('Cross-road creature lower edge must clear the highest deck by 6m.');
        }
      } else if (!Number.isFinite(placement.completeHorizontalRoadCapsuleGapM)
        || placement.completeHorizontalRoadCapsuleGapM < 6) {
        throw new RangeError('Roadside creature outline must remain at least 6m from every road capsule.');
      }
      if (definition.scaleClass === 'large'
        && (!Number.isFinite(placement.centerSpacingM) || placement.centerSpacingM < 120)) {
        throw new RangeError('Large creature centers require at least 120m spacing.');
      }
      if (definition.scaleClass === 'small-cluster'
        && (!Number.isFinite(placement.clusterSpacingM) || placement.clusterSpacingM < 45)) {
        throw new RangeError('Small creature clusters require at least 45m spacing.');
      }
      const velocityMps = Number.isFinite(placement.velocityMps) ? Math.max(0, placement.velocityMps) : 0;
      const requiredForwardM = Math.max(120, 2 * velocityMps);
      if (!Number.isFinite(placement.forwardClearanceM)
        || placement.forwardClearanceM < requiredForwardM) {
        throw new RangeError(`Creature forward clearance must be at least ${requiredForwardM}m.`);
      }
      const wedgeDistanceM = Math.max(160, 0.8 * velocityMps);
      if (typeof placement.highContrastLowAltitude !== 'boolean') {
        throw new TypeError(
          'Creature placement proof must explicitly declare highContrastLowAltitude.'
        );
      }
      if (placement.highContrastLowAltitude === true
        && !Number.isFinite(placement.bearingDegrees)) {
        throw new TypeError('High-contrast creature placement requires a finite bearingDegrees.');
      }
      if (placement.highContrastLowAltitude === true
        && Math.abs(placement.bearingDegrees) <= 12
        && Number(placement.forwardClearanceM) <= wedgeDistanceM) {
        throw new RangeError('High-contrast low-altitude creature would obstruct the forward reading wedge.');
      }
      return { requiredForwardM, wedgeDistanceM };
    }

    /** Reset only module-owned decorative state; world-owned root placement and visibility are untouched. */
    function resetDecorations(record) {
      record.motionPivot.position.set(0, 0, 0);
      record.motionPivot.rotation.set(0, 0, 0);
      record.motionPivot.scale.set(1, 1, 1);
      for (let index = 0; index < record.materials.length; index++) {
        resetMaterial(record.materials[index], record.baselines[index]);
      }
      for (const qualityId of QUALITY_IDS) {
        record.variants[qualityId].visible = qualityId === activeQualityId;
      }
    }

    /** Pool lifecycle alone may clear the root pose before world placement is assigned or after it is released. */
    function resetPooledRecord(record) {
      resetDecorations(record);
      record.root.position.set(0, 0, 0);
      record.root.rotation.set(0, 0, 0);
      record.root.scale.set(1, 1, 1);
    }

    function activeVisibleCount(realmId) {
      let count = 0;
      for (const record of activeRecords) {
        if (record.definition.realmId === realmId && record.root.visible) count++;
      }
      return count;
    }

    /**
     * Acquire one prebuilt root. Seed affects presentation phase only; family, realm, route clearance,
     * zone index, and map ownership never derive from a random stream or a template's prior use.
     */
    function acquire({
      realmId,
      familyId,
      seed = 'default',
      zoneIndex,
      transitionPreview,
      placement
    } = {}) {
      if (disposed) throw new Error('Creature factory has been disposed.');
      if (!prewarmed) prewarm();
      const definition = describe(realmId, familyId);
      const authoritativeZoneIndex = REALM_IDS.indexOf(realmId);
      if (zoneIndex !== undefined && zoneIndex !== authoritativeZoneIndex) {
        throw new RangeError(`Creature ${familyId} requires zoneIndex ${authoritativeZoneIndex}.`);
      }
      const previewSegmentId = validateTransition(definition, transitionPreview);
      const clearance = validatePlacement(definition, placement);
      const cap = QUALITY_BUDGETS[activeQualityId].maximumVisibleRootsPerRealm;
      if (activeVisibleCount(realmId) >= cap) return null;
      const record = poolsByFamily.get(familyId).pop();
      if (!record) return null;
      resetPooledRecord(record);
      record.phase = visualUnit(
        `${visualSeed}:creatures:${realmId}:${familyId}:${String(seed)}:${serial}`
      ) * Math.PI * 2;
      record.active = true;
      record.requestedVisible = true;
      record.serial = serial++;
      record.root.visible = true;
      record.root.userData.creatureFamilyId = familyId;
      record.root.userData.creatureRealmId = realmId;
      record.root.userData.creatureZoneIndex = authoritativeZoneIndex;
      record.root.userData.zoneIndex = authoritativeZoneIndex;
      record.root.userData.visualZone = authoritativeZoneIndex;
      record.root.userData.transitionPreviewSegment = previewSegmentId;
      record.root.userData.requiredForwardClearanceM = clearance.requiredForwardM;
      record.root.userData.readingWedgeClearanceM = clearance.wedgeDistanceM;
      record.root.userData.presentationSeed = hashVisualSeed(
        `${visualSeed}:creatures:${realmId}:${familyId}:${String(seed)}`
      );
      record.root.userData.active = true;
      activeRecords.add(record);
      return record.root;
    }

    /** Update decorative motion without constructing geometry, materials, colors, vectors, or snapshots. */
    function update(root, frame = {}) {
      const record = recordByRoot.get(root);
      if (!record?.active || disposed) return false;
      if (frame.paused === true) return true;
      const reducedMotion = frame.reducedMotion === true;
      const timeSeconds = Number.isFinite(frame.timeSeconds) ? frame.timeSeconds : 0;
      if (reducedMotion) {
        record.motionPivot.position.y = 0;
        record.motionPivot.rotation.x = 0;
        record.motionPivot.rotation.y = 0;
        record.motionPivot.rotation.z = 0;
        for (let index = 0; index < record.materials.length; index++) {
          resetMaterial(record.materials[index], record.baselines[index]);
        }
        return true;
      }
      const amplitude = record.definition.motionEnvelopeM;
      const phase = record.phase;
      record.motionPivot.position.y = Math.sin(timeSeconds * 0.62 + phase) * amplitude * 0.18;
      record.motionPivot.rotation.x = Math.sin(timeSeconds * 0.44 + phase * 0.7) * 0.025;
      record.motionPivot.rotation.y = Math.sin(timeSeconds * 0.28 + phase * 1.3) * 0.035;
      record.motionPivot.rotation.z = Math.sin(timeSeconds * 0.76 + phase) * 0.045;
      const pulse = 0.92 + Math.sin(timeSeconds * 0.84 + phase) * 0.08;
      for (let index = 0; index < record.materials.length; index++) {
        const baseline = record.baselines[index];
        if (Number.isFinite(baseline.emissiveIntensity)) {
          record.materials[index].emissiveIntensity = baseline.emissiveIntensity * pulse;
        }
      }
      return true;
    }

    /** Restore the construction-time decorative baseline while retaining ownership of the active root. */
    function settle(root) {
      const record = recordByRoot.get(root);
      if (!record?.active || disposed) return false;
      resetDecorations(record);
      return true;
    }

    /** Return one root to its family pool with realm, pose, phase, material, and preview metadata cleared. */
    function release(root) {
      const record = recordByRoot.get(root);
      if (!record?.active || disposed) return false;
      activeRecords.delete(record);
      resetPooledRecord(record);
      record.phase = 0;
      record.active = false;
      record.requestedVisible = false;
      record.serial = 0;
      record.root.visible = false;
      record.root.userData.creatureRealmId = record.definition.realmId;
      record.root.userData.creatureZoneIndex = REALM_IDS.indexOf(record.definition.realmId);
      record.root.userData.zoneIndex = REALM_IDS.indexOf(record.definition.realmId);
      record.root.userData.visualZone = REALM_IDS.indexOf(record.definition.realmId);
      record.root.userData.transitionPreviewSegment = null;
      record.root.userData.requiredForwardClearanceM = null;
      record.root.userData.readingWedgeClearanceM = null;
      record.root.userData.presentationSeed = null;
      record.root.userData.active = false;
      poolsByFamily.get(record.definition.id).push(record);
      return true;
    }

    /** Switch reversible prebuilt variants and enforce the quality-specific visible-root cap. */
    function setRenderQuality(value) {
      if (disposed) return false;
      const nextQualityId = normalizeQualityId(value);
      if (!prewarmed) {
        activeQualityId = nextQualityId;
        return true;
      }
      const changed = nextQualityId !== activeQualityId;
      activeQualityId = nextQualityId;
      const visibleByRealm = Object.create(null);
      const cap = QUALITY_BUDGETS[activeQualityId].maximumVisibleRootsPerRealm;
      for (const record of allRecords) {
        for (const qualityId of QUALITY_IDS) {
          record.variants[qualityId].visible = qualityId === activeQualityId;
        }
      }
      for (const record of activeRecords) {
        const realmId = record.definition.realmId;
        const count = visibleByRealm[realmId] || 0;
        record.root.visible = record.requestedVisible && count < cap;
        if (record.root.visible) visibleByRealm[realmId] = count + 1;
      }
      return changed;
    }

    function getTopologyRoots() {
      if (!prewarmed) prewarm();
      return Object.freeze([...topologyRoots]);
    }

    /**
     * Return a read-only snapshot of the real roots that world may add and register before acquisition.
     * The frozen array does not freeze or transfer ownership of the live Three.js objects it references.
     */
    function getPoolRoots() {
      if (!prewarmed) {
        throw new Error('Creature pool roots require an explicit prewarm() before inspection.');
      }
      return Object.freeze(allRecords.map(({ root }) => root));
    }

    /** Return conservative local bounds measured across every switchable real geometry variant. */
    function getPlacementMetrics(realmId, familyId) {
      const definition = describe(realmId, familyId);
      if (!prewarmed) {
        throw new Error('Creature placement metrics require an explicit prewarm() before inspection.');
      }
      return placementMetricsByFamily[definition.id];
    }

    function getDiagnostics() {
      const activeByRealm = Object.create(null);
      const visibleByRealm = Object.create(null);
      let visibleTriangles = 0;
      for (const realmId of REALM_IDS) {
        activeByRealm[realmId] = 0;
        visibleByRealm[realmId] = 0;
      }
      for (const record of activeRecords) {
        activeByRealm[record.definition.realmId]++;
        if (record.root.visible) {
          visibleByRealm[record.definition.realmId]++;
          visibleTriangles += measuredByFamily[record.definition.id]?.[activeQualityId]?.triangles || 0;
        }
      }
      return deepFreeze({
        activeQualityId,
        prewarmed,
        disposed,
        familyCount: CREATURE_CATALOG.length,
        topologyRootCount: topologyRoots.length,
        pooledRootCount: allRecords.length,
        activeRootCount: activeRecords.size,
        activeByRealm,
        visibleByRealm,
        visibleTriangles,
        geometryAllocations,
        materialAllocations,
        frameGeometryAllocations: 0,
        frameMaterialAllocations: 0,
        sceneLights: 0,
        colliders: 0,
        measuredByFamily
      });
    }

    /** Dispose only factory-owned visual resources; this module never owns a scene or external map record. */
    function dispose() {
      if (disposed) return false;
      for (const record of activeRecords) {
        record.root.visible = false;
        record.active = false;
        record.root.userData.active = false;
      }
      activeRecords.clear();
      const materials = new Set();
      for (const record of allRecords) {
        for (const material of record.materials) materials.add(material);
      }
      for (const material of materials) material.dispose?.();
      for (const familyGeometry of sharedGeometryByFamily.values()) {
        for (const qualityId of QUALITY_IDS) {
          familyGeometry[qualityId].geometry.dispose();
          familyGeometry[qualityId].templateMaterial.dispose?.();
        }
      }
      disposed = true;
      return true;
    }

    return Object.freeze({
      prewarm,
      acquire,
      update,
      settle,
      release,
      setRenderQuality,
      getTopologyRoots,
      getPoolRoots,
      getPlacementMetrics,
      getDiagnostics,
      dispose
    });
  }

  return Object.freeze({
    CREATURE_VISUAL_CONTRACT,
    REALM_IDS,
    CREATURE_CATALOG,
    describe,
    validateConfiguredZones,
    createFactory
  });
})();
