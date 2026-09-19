/* Neon world contract. Keep theme data isolated from gameplay state, collision, and autopilot decisions. */
window.NeonConfig = (() => {
  'use strict';

  // One route-realm state owns each paired sky/ground scene. The 45m/s ordinary-road reference keeps each 2.7km
  // realm coherent for 60s; the manual jump stage may cross it faster and is reported separately by diagnostics.
  const world = Object.freeze({
    zoneLength: 2_700,
    blendSpan: 72,
    ordinaryRoadReferenceSpeedMps: 45,
    realmResidenceSecondsAtOrdinaryRoadReference: 60,
    scenePairingMode: 'shared-route-realm'
  });

  /*
   * Scene visibility is a presentation contract shared by the camera, realm fog, terrain residency, and distant
   * scenery. The longer envelope gives large landmarks enough time to establish a silhouette before their close
   * detail appears; weather may still shorten effective visibility, but no gameplay or route range reads it.
   */
  const sceneVisibilityContract = Object.freeze({
    version: 1,
    cameraFarM: 1_600,
    minimumAuthoredRealmFogFarM: 720,
    maximumAuthoredRealmFogFarM: 1_200,
    terrainFogSafetyMarginRatio: 1.08,
    presentationOnly: true,
    affectsGameplay: false
  });

  // These launch-only construction profiles size immutable geometry, particles, and pools. Their historical raster and
  // shadow fields remain compatibility metadata for older fixtures; the live renderer reads renderQualityProfiles only.
  const qualityProfiles = Object.freeze({
    high: Object.freeze({
      id: 'high',
      terrainSegments: 32,
      radialSegments: 24,
      tubularSegments: 32,
      bevelSegments: 3,
      particleScale: 1,
      farDensity: 1,
      lodDistance: 440,
      shadowMapSize: 4_096,
      pixelRatioCap: 2,
      maxRenderPixels: 5_200_000
    }),
    mobile: Object.freeze({
      id: 'mobile',
      terrainSegments: 14,
      radialSegments: 12,
      tubularSegments: 18,
      bevelSegments: 1,
      particleScale: 0.42,
      farDensity: 0.46,
      lodDistance: 250,
      shadowMapSize: 2_048,
      pixelRatioCap: 1.5,
      maxRenderPixels: 2_400_000
    })
  });

  // Player-selectable render quality stays separate from construction quality: switching during pause may resize
  // raster and shadow buffers, but it must never rebuild roads or change obstacle visibility, collision, or routing.
  const renderQualityContract = Object.freeze({
    version: 3,
    defaultId: 'medium',
    ids: Object.freeze(['low', 'medium', 'high']),
    changePolicy: 'launch-or-paused',
    dynamicChannels: Object.freeze([
      'renderer-resolution',
      'directional-shadow-maps',
      'local-shadow-map',
      'texture-anisotropy',
      'high-only-post-processing',
      'high-only-material-presentation',
      'high-only-dynamic-local-fixture-lights'
    ]),
    invariants: Object.freeze({
      presentationOnly: true,
      stableWorldGeometry: true,
      stableGameplayVisibility: true,
      dynamicLocalFixtureLightsAreHighOnly: true,
      activeRunRequiresPause: true,
      noPersistentPreference: true
    })
  });

  const renderQualityProfiles = Object.freeze({
    low: Object.freeze({
      id: 'low',
      name: '低质量',
      description: '较低渲染分辨率与阴影精度；隧道静态照明持续常亮，不启用动态局部聚光与阴影，优先保持移动端流畅。',
      pixelRatioCap: 1,
      maxRenderPixels: 1_300_000,
      primaryShadowMapSize: 1_024,
      sunShadowMapSize: 1_024,
      secondaryDirectionalShadowMapSize: 1_024,
      localShadowMapSize: 512,
      maximumAnisotropy: false,
      msaaSamples: 0,
      ambientOcclusion: false,
      bloom: false,
      postProcessingEnabled: false,
      // False preserves continuously authored fixture surfaces while skipping emitter collection and the reusable
      // local spot/shadow pool; it is a performance contract, not a tunnel-light power switch.
      dynamicLocalFixtureLights: false,
      adaptiveDownscale: false
    }),
    medium: Object.freeze({
      id: 'medium',
      name: '中质量',
      description: '平衡清晰度与性能；隧道静态照明持续常亮，不启用动态局部聚光与阴影，适合作为默认选择。',
      pixelRatioCap: 1.5,
      maxRenderPixels: 2_800_000,
      primaryShadowMapSize: 2_048,
      sunShadowMapSize: 2_048,
      secondaryDirectionalShadowMapSize: 2_048,
      localShadowMapSize: 1_024,
      maximumAnisotropy: false,
      msaaSamples: 0,
      ambientOcclusion: false,
      bloom: false,
      postProcessingEnabled: false,
      // Medium shares Low's static irradiance path so selecting the default tier cannot activate mobile local lights.
      dynamicLocalFixtureLights: false,
      adaptiveDownscale: false
    }),
    high: Object.freeze({
      id: 'high',
      name: '高质量',
      description: '电脑超高画质渲染、超精细主太阳阴影与高档专属后处理，并启用 6 盏动态隧道聚光（其中 2 盏投影），优先画面细节。',
      pixelRatioCap: 3,
      maxRenderPixels: 24_000_000,
      // The runtime publishes requested and effective sizes separately; devices below 8K fall back without
      // changing the selected High tier or introducing an FPS-driven downgrade path.
      primaryShadowMapSize: 8_192,
      sunShadowMapSize: 8_192,
      secondaryDirectionalShadowMapSize: 4_096,
      localShadowMapSize: 4_096,
      maximumAnisotropy: 'renderer-maximum',
      msaaSamples: 4,
      ambientOcclusion: 'depth-gtao-compatible',
      bloom: 'explicit-emissive-only',
      postProcessingEnabled: true,
      // Authored fixtures remain visibly powered in every tier; only High submits their nearby records to the
      // six-light physical-detail pool, avoiding per-frame aggregation and shadow work on mobile-class devices.
      dynamicLocalFixtureLights: true,
      adaptiveDownscale: false
    })
  });

  /**
   * Freezes nested zone contracts and retains the original flat lighting keys consumed by the Neon main
   * loop. New model factories should read palette/roadStyle/terrain/families; legacy aliases prevent gameplay drift.
   */
  function defineZone({
    id,
    name,
    palette,
    roadStyle,
    terrain,
    landmarkFamilies,
    obstacleFamilies,
    pickupStyle,
    atmosphere,
    lighting
  }) {
    const frozenPalette = Object.freeze({ ...palette });
    const frozenRoadStyle = Object.freeze({ ...roadStyle });
    const frozenTerrain = Object.freeze({ ...terrain });
    const frozenLandmarks = Object.freeze([...landmarkFamilies]);
    const frozenObstacles = Object.freeze({
      static: Object.freeze([...obstacleFamilies.static]),
      dynamic: Object.freeze([...obstacleFamilies.dynamic])
    });
    const frozenPickupStyle = Object.freeze({
      ...pickupStyle,
      families: Object.freeze([...pickupStyle.families])
    });
    const frozenAtmosphere = Object.freeze({
      ...atmosphere,
      environmentFamilies: Object.freeze([...atmosphere.environmentFamilies]),
      particles: Object.freeze([...atmosphere.particles]),
      farScenery: Object.freeze([...atmosphere.farScenery])
    });
    return Object.freeze({
      id,
      name,
      palette: frozenPalette,
      roadStyle: frozenRoadStyle,
      terrain: frozenTerrain,
      landmarkFamilies: frozenLandmarks,
      obstacleFamilies: frozenObstacles,
      pickupStyle: frozenPickupStyle,
      atmosphere: frozenAtmosphere,
      // Flat aliases remain the stable interface for the existing fog, light, road, and HUD interpolation.
      sky: frozenPalette.sky,
      fog: frozenPalette.fog,
      floor: frozenPalette.ground,
      road: frozenPalette.road,
      roadEmissive: frozenPalette.roadEmissive,
      edge: frozenPalette.edge,
      accent: frozenPalette.accent,
      second: frozenPalette.secondary,
      sun: frozenPalette.sun,
      ...lighting
    });
  }

  // Water, wet stone, ice, astral dust, and volcanic rock remain dielectric natural materials. Their visual
  // distinction comes from roughness, relief, and reflected sky—not the metallic shortcut used by sci-fi scenery.
  const SKY_TERRAIN_DIELECTRIC_METALNESS = 0;

  const zones = Object.freeze([
    defineZone({
      id: 'dawn-isle',
      name: '晨岛云海',
      palette: {
        sky: 0xf7_dca2,
        fog: 0xf2_c99a,
        ground: 0xc9_e4da,
        road: 0xd7_b77a,
        roadEmissive: 0x8f_6735,
        edge: 0xff_e5a8,
        accent: 0x9f_e7df,
        secondary: 0xff_b58f,
        sun: 0xff_f2c8,
        structure: 0xb8_8a57,
        surface: 0xd8_bf8b,
        organic: 0xc7_dac9,
        glow: 0xff_e5a8,
        hazard: 0xc5_7659,
        glass: 0xb9_f5ec
      },
      roadStyle: {
        id: 'sunray-terrace',
        edgeProfile: 'wind-scallop',
        insetPattern: 'dawn-rays',
        shellProfile: 'sandstone-terrace',
        thickness: 0.48,
        bevel: 0.12
      },
      terrain: {
        id: 'sunlit-ocean',
        pattern: 'ocean',
        base: 0x2f_7894,
        detail: 0x78_c4d1,
        accent: 0xe8_f6ef,
        relief: 0.32,
        featureDensity: 0.72,
        roughness: 0.34,
        metalness: SKY_TERRAIN_DIELECTRIC_METALNESS
      },
      landmarkFamilies: ['wind-eroded-island', 'sandstone-sanctuary', 'arched-wind-gate'],
      obstacleFamilies: {
        static: ['sandstone-fin', 'sealed-ruin-buttress', 'wind-carved-monolith'],
        dynamic: ['sweeping-wind-arch', 'migrating-cloud-sentinel']
      },
      pickupStyle: {
        id: 'dawn-candle',
        families: ['winged-flame-vessel', 'sun-petal-lantern'],
        core: 'warm-gold',
        trail: 'morning-dust'
      },
      atmosphere: {
        id: 'morning-cloud-sea',
        environmentFamilies: ['cloud-sea-stair', 'wind-ripple-bank'],
        particles: ['morning-dust', 'soft-cloud-mote'],
        farScenery: ['layered-cloud-island', 'distant-sun-portal'],
        wind: 0.34,
        density: 0.72
      },
      lighting: {
        exposure: 1.34,
        fogNear: 18,
        fogFar: 1_080,
        daylight: 0.74,
        starOpacity: 0.16,
        floorOpacity: 0.88,
        ambientIntensity: 1.70,
        sunIntensity: 3.35,
        roadGlow: 0.26
      }
    }),
    defineZone({
      id: 'prairie-garden',
      name: '云野花庭',
      palette: {
        sky: 0xa7_dac5,
        fog: 0xb8_e6d4,
        ground: 0x8e_c7a5,
        road: 0xb9_cb89,
        roadEmissive: 0x6f_8e55,
        edge: 0xf7_f4b9,
        accent: 0xa6_d7ff,
        secondary: 0xff_d884,
        sun: 0xff_efc3,
        structure: 0xb6_a77c,
        surface: 0x9f_c286,
        organic: 0x78_b98d,
        glow: 0xf7_f4b9,
        hazard: 0xbf_7c68,
        glass: 0xb8_efff
      },
      roadStyle: {
        id: 'meadow-vineway',
        edgeProfile: 'petal-lobe',
        insetPattern: 'woven-vines',
        shellProfile: 'grassland-shelf',
        thickness: 0.44,
        bevel: 0.10
      },
      terrain: {
        id: 'flowering-grassland',
        pattern: 'grassland',
        base: 0x55_965c,
        detail: 0x8d_c979,
        accent: 0xf5_de89,
        relief: 0.46,
        featureDensity: 1,
        roughness: 0.98,
        metalness: SKY_TERRAIN_DIELECTRIC_METALNESS
      },
      landmarkFamilies: ['meadow-floating-island', 'bell-tower-courtyard', 'flower-terrace'],
      obstacleFamilies: {
        static: ['blooming-stone-fan', 'vine-wrapped-bell', 'terraced-garden-wall'],
        dynamic: ['swaying-vine-bridge', 'butterfly-petal-guardian']
      },
      pickupStyle: {
        id: 'prairie-candle',
        families: ['bellflower-flame', 'butterfly-lantern'],
        core: 'pollen-gold',
        trail: 'flower-pollen'
      },
      atmosphere: {
        id: 'flowering-prairie',
        environmentFamilies: ['vine-bridge', 'flowering-cloud-bank'],
        particles: ['butterfly-spark', 'flower-pollen'],
        farScenery: ['bell-tower-range', 'meadow-island-chain'],
        wind: 0.22,
        density: 0.84
      },
      lighting: {
        exposure: 1.28,
        fogNear: 20,
        fogFar: 1_200,
        daylight: 0.86,
        starOpacity: 0.08,
        floorOpacity: 0.92,
        ambientIntensity: 1.82,
        sunIntensity: 3.10,
        roadGlow: 0.22
      }
    }),
    defineZone({
      id: 'rainforest-glow',
      name: '雨林幽光',
      palette: {
        sky: 0x4c_7f88,
        fog: 0x74_a6a6,
        ground: 0x4b_7f68,
        road: 0x7d_8f66,
        roadEmissive: 0x2e_5b4e,
        edge: 0xb8_ef91,
        accent: 0x9f_e7df,
        secondary: 0xff_e5a8,
        sun: 0xd9_fff0,
        structure: 0x61_6757,
        surface: 0x5f_806d,
        organic: 0x3f_735d,
        glow: 0x9f_e7df,
        hazard: 0xb5_665a,
        glass: 0x76_d7cb
      },
      roadStyle: {
        id: 'rootwater-causeway',
        edgeProfile: 'interlocking-root',
        insetPattern: 'rain-channel',
        shellProfile: 'mossy-ruin-slab',
        thickness: 0.56,
        bevel: 0.14
      },
      terrain: {
        id: 'rainforest-wetland',
        pattern: 'wetland',
        base: 0x22_513f,
        detail: 0x53_805d,
        accent: 0x70_b9aa,
        relief: 0.24,
        featureDensity: 0.86,
        roughness: 0.86,
        metalness: SKY_TERRAIN_DIELECTRIC_METALNESS
      },
      landmarkFamilies: ['giant-root-cathedral', 'layered-canopy', 'broken-bridge-ruin'],
      obstacleFamilies: {
        static: ['root-knot-bulwark', 'sealed-bridge-ruin', 'canopy-drop-pillar'],
        dynamic: ['swinging-root-lattice', 'rain-orbit-sentinel']
      },
      pickupStyle: {
        id: 'rainforest-candle',
        families: ['firefly-pod', 'waterdrop-flame'],
        core: 'teal-gold',
        trail: 'firefly-glimmer'
      },
      atmosphere: {
        id: 'luminous-rain',
        environmentFamilies: ['luminous-pool', 'firefly-reeds'],
        particles: ['rain-streak', 'firefly-glimmer'],
        farScenery: ['layered-canopy-wall', 'mist-bridge-silhouette'],
        wind: 0.46,
        density: 0.92
      },
      lighting: {
        exposure: 1.20,
        fogNear: 12,
        fogFar: 840,
        daylight: 0.42,
        starOpacity: 0.34,
        floorOpacity: 0.84,
        ambientIntensity: 1.48,
        sunIntensity: 2.35,
        roadGlow: 0.34
      }
    }),
    defineZone({
      id: 'twilight-valley',
      name: '霞谷暮光',
      palette: {
        sky: 0xf0_9b7e,
        fog: 0xd7_8fa6,
        ground: 0xa9_89a6,
        road: 0xc5_7d72,
        roadEmissive: 0x8c_4b4f,
        edge: 0xff_d884,
        accent: 0xbd_a7ff,
        secondary: 0x9f_e7df,
        sun: 0xff_d6a1,
        structure: 0x8d_7899,
        surface: 0xc1_9ab4,
        organic: 0xd6_a58d,
        glow: 0xff_d884,
        hazard: 0xcf_5e70,
        glass: 0xb9_d9ff
      },
      roadStyle: {
        id: 'racing-ice-ribbon',
        edgeProfile: 'blade-fin',
        insetPattern: 'woven-wind-memory',
        shellProfile: 'streamlined-ice',
        thickness: 0.40,
        bevel: 0.16
      },
      terrain: {
        id: 'twilight-tundra',
        pattern: 'tundra',
        base: 0x9f_bfca,
        detail: 0xe1_eee9,
        accent: 0xce_879f,
        relief: 0.40,
        featureDensity: 0.68,
        roughness: 0.76,
        metalness: SKY_TERRAIN_DIELECTRIC_METALNESS
      },
      landmarkFamilies: ['ice-carved-canyon', 'twilight-pilgrim-terraces', 'racing-triumphal-arch'],
      obstacleFamilies: {
        static: ['ice-blade-cluster', 'pilgrim-terrace-pier', 'racing-banner-buttress'],
        dynamic: ['gliding-ice-veil', 'orbiting-memory-ribbon']
      },
      pickupStyle: {
        id: 'twilight-candle',
        families: ['racing-comet-flame', 'ice-feather-lantern'],
        core: 'sunset-gold',
        trail: 'snow-ribbon'
      },
      atmosphere: {
        id: 'sunset-race',
        environmentFamilies: ['ice-ribbon', 'snow-fan'],
        particles: ['snow-dust', 'racing-ribbon'],
        farScenery: ['canyon-pilgrim-terraces', 'sunset-arch-chain'],
        wind: 0.68,
        density: 0.64
      },
      lighting: {
        exposure: 1.30,
        fogNear: 16,
        fogFar: 1_080,
        daylight: 0.66,
        starOpacity: 0.26,
        floorOpacity: 0.86,
        ambientIntensity: 1.62,
        sunIntensity: 3.45,
        roadGlow: 0.30
      }
    }),
    defineZone({
      id: 'star-vault',
      name: '禁阁星穹',
      palette: {
        sky: 0x2e_355e,
        fog: 0x4b_5478,
        ground: 0x4b_506d,
        road: 0x6b_6584,
        roadEmissive: 0x42_3f69,
        edge: 0xbd_a7ff,
        accent: 0xff_e5a8,
        secondary: 0x9f_e7df,
        sun: 0xf2_e8ff,
        structure: 0x5c_5879,
        surface: 0x68_6784,
        organic: 0x6d_7fa0,
        glow: 0xbd_a7ff,
        hazard: 0xb0_647d,
        glass: 0xa7_b5ff
      },
      roadStyle: {
        id: 'constellation-orbit',
        edgeProfile: 'star-step',
        insetPattern: 'constellation-grid',
        shellProfile: 'astral-platform',
        thickness: 0.52,
        bevel: 0.10
      },
      terrain: {
        id: 'astral-shallows',
        pattern: 'astral',
        base: 0x20_274c,
        detail: 0x62_6897,
        accent: 0xda_bff4,
        relief: 0.30,
        featureDensity: 0.78,
        roughness: 0.58,
        metalness: SKY_TERRAIN_DIELECTRIC_METALNESS
      },
      landmarkFamilies: ['floating-library', 'spiral-observatory', 'constellation-platform'],
      obstacleFamilies: {
        static: ['sealed-book-arc', 'astrolabe-buttress', 'constellation-pillar'],
        dynamic: ['circling-constellation-arch', 'ascending-memory-archive']
      },
      pickupStyle: {
        id: 'vault-candle',
        families: ['constellation-flame', 'astrolabe-lantern'],
        core: 'violet-gold',
        trail: 'star-script'
      },
      atmosphere: {
        id: 'astral-library',
        environmentFamilies: ['floating-book-constellation', 'ascending-memory-court'],
        particles: ['star-script', 'orbit-dust'],
        farScenery: ['library-spire-field', 'constellation-lattice'],
        wind: 0.12,
        density: 0.70
      },
      lighting: {
        exposure: 1.24,
        fogNear: 14,
        fogFar: 1_000,
        daylight: 0.18,
        starOpacity: 0.74,
        floorOpacity: 0.82,
        ambientIntensity: 1.38,
        sunIntensity: 2.70,
        roadGlow: 0.48
      }
    }),
    defineZone({
      id: 'eden-eye',
      name: '伊甸风眼',
      palette: {
        sky: 0x34_2737,
        fog: 0x67_4951,
        ground: 0x55_464c,
        road: 0x82_5c58,
        roadEmissive: 0x5a_2b36,
        edge: 0xff_b58f,
        accent: 0xf0_6e76,
        secondary: 0xff_e5a8,
        sun: 0xff_cab0,
        structure: 0x50_4149,
        surface: 0x65_5054,
        organic: 0x76_3e4d,
        glow: 0xf0_6e76,
        hazard: 0xe4_354d,
        glass: 0xd9_5264
      },
      roadStyle: {
        id: 'storm-fracture',
        edgeProfile: 'blackstone-spine',
        insetPattern: 'sealed-red-fissure',
        shellProfile: 'wind-eroded-ridge',
        thickness: 0.62,
        bevel: 0.18
      },
      terrain: {
        id: 'volcanic-badlands',
        pattern: 'volcanic',
        base: 0x2c_2529,
        detail: 0x58_3b41,
        accent: 0xe1_4052,
        relief: 0.58,
        featureDensity: 0.82,
        roughness: 0.94,
        metalness: SKY_TERRAIN_DIELECTRIC_METALNESS
      },
      landmarkFamilies: ['blackstone-ridge', 'red-crystal-vein', 'broken-guardian-statue'],
      obstacleFamilies: {
        static: ['sealed-fracture-slab', 'red-crystal-crown', 'storm-carved-idol'],
        dynamic: ['ash-storm-veil', 'orbiting-shard-guardian']
      },
      pickupStyle: {
        id: 'eden-candle',
        families: ['shielded-ember-flame', 'fractured-wing-lantern'],
        core: 'ember-gold',
        trail: 'ash-spark'
      },
      atmosphere: {
        id: 'ash-storm-eye',
        environmentFamilies: ['ash-vortex', 'storm-fangs'],
        particles: ['ash-storm', 'red-crystal-spark'],
        farScenery: ['black-ridge-wall', 'storm-eye-silhouette'],
        wind: 0.94,
        density: 1
      },
      lighting: {
        exposure: 1.18,
        fogNear: 10,
        fogFar: 720,
        daylight: 0.24,
        starOpacity: 0.44,
        floorOpacity: 0.86,
        ambientIntensity: 1.24,
        sunIntensity: 2.85,
        roadGlow: 0.42
      }
    })
  ]);

  const authoredRealmFogDistancesM = zones.map((zone) => Number(zone.fogFar));
  if (Math.min(...authoredRealmFogDistancesM) !== sceneVisibilityContract.minimumAuthoredRealmFogFarM
    || Math.max(...authoredRealmFogDistancesM) !== sceneVisibilityContract.maximumAuthoredRealmFogFarM
    || sceneVisibilityContract.cameraFarM <= sceneVisibilityContract.maximumAuthoredRealmFogFarM) {
    throw new RangeError('Neon realm fog distances must stay inside the shared scene-visibility envelope');
  }

  return Object.freeze({
    world,
    sceneVisibilityContract,
    qualityProfiles,
    renderQualityContract,
    renderQualityProfiles,
    zones
  });
})();
