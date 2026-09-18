import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const PROJECT_ROOT = new URL('../../', import.meta.url);
const moduleUrl = new URL(
  'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.region-scenery.js',
  PROJECT_ROOT
);
const source = readFileSync(moduleUrl, 'utf8');
const configSource = readFileSync(
  new URL('src/config/Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js', PROJECT_ROOT),
  'utf8'
);
const context = vm.createContext({ window: {} });
vm.runInContext(source, context, {
  filename: 'Neon_Autopilot_V23_HighSpeed_DroneHeat.region-scenery.js'
});
const scenery = context.window.NeonV23RegionScenery;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}

function configuredZones() {
  return scenery.REGION_IDS.map((id, index) => ({
    id,
    landmarkFamilies: [
      `baseline-${index}-landmark-a`,
      `baseline-${index}-landmark-b`,
      `baseline-${index}-landmark-c`
    ],
    atmosphere: {
      environmentFamilies: [
        `baseline-${index}-environment-a`,
        `baseline-${index}-environment-b`
      ]
    }
  }));
}

function createAdapter({
  triangleDelta = 0,
  drawGroupDelta = 0,
  sceneLights = 0,
  colliders = 0,
  mapEntities = 0,
  gameplayWrites = 0,
  navigationWrites = 0,
  frameAssetAllocations = 0,
  horizontalRadiusM = null,
  motionEnvelopeM = 0,
  randomSamples = null,
  plans = null
} = {}) {
  return {
    instantiateTemplate({ definition, renderPlan, context: buildContext }) {
      randomSamples?.push([
        definition.id,
        buildContext.random(),
        buildContext.random(),
        buildContext.random()
      ]);
      plans?.push(renderPlan);
      const triangles = buildContext.qualityKey === 'mobile'
        ? definition.budget.mobileTriangles
        : definition.budget.desktopTriangles;
      return {
        object: { userData: {} },
        metrics: {
          triangles: triangles + triangleDelta,
          drawGroups: definition.budget.drawGroups + drawGroupDelta,
          sceneLights,
          colliders,
          mapEntities,
          gameplayWrites,
          navigationWrites,
          frameAssetAllocations,
          horizontalRadiusM: horizontalRadiusM ?? definition.recipe.radiusM,
          motionEnvelopeM
        }
      };
    }
  };
}

test('publishes the exact ordered six-region taxonomy with 48 unique bilingual families', () => {
  assert.deepEqual(plain(scenery.REGION_IDS), [
    'dawn-isle',
    'prairie-garden',
    'rainforest-glow',
    'twilight-valley',
    'star-vault',
    'eden-eye'
  ]);
  assert.equal(scenery.familyCatalog.length, 48);
  assert.equal(new Set(scenery.familyCatalog.map(({ id }) => id)).size, 48);

  for (const realmId of scenery.REGION_IDS) {
    const families = scenery.getRegionFamilies(realmId);
    assert.equal(families.length, 8);
    assert.equal(families.filter(({ category }) => category === 'landmark').length, 3);
    assert.equal(families.filter(({ category }) => category === 'environment').length, 5);
    for (const definition of families) {
      assert.match(definition.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.match(definition.labelZh, /[\u3400-\u9fff]/u);
      assert.match(definition.labelEn, /^[A-Z][A-Za-z ]+$/);
      assert.equal(definition.realmId, realmId);
      assert.equal(scenery.getFamily(definition.id), definition);
    }
  }
});

test('deep-freezes public contracts, classifications, recipes, labels, and budgets', () => {
  assertDeepFrozen(scenery.REGION_SCENERY_CONTRACT);
  assertDeepFrozen(scenery.REGION_IDS);
  assertDeepFrozen(scenery.familyCatalog);
  for (const realmId of scenery.REGION_IDS) {
    assertDeepFrozen(scenery.getRegionFamilies(realmId));
  }
});

test('locks the V2 monumental pilgrimage language into every family blueprint', () => {
  const contract = scenery.REGION_SCENERY_CONTRACT;
  assert.equal(contract.version, 2);
  assert.equal(contract.artDirection, 'original-ethereal-pilgrimage-v2');
  assert.deepEqual(plain(contract.sceneLanguage), {
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
  assert.deepEqual(plain(contract.blueprintLanguageRoles), [
    'monumental-readable-profile',
    'mass-void-mass',
    'cloth-banner-or-petal',
    'abstract-spirit-mask',
    'candle-star-memory',
    'carved-relief-and-inlay',
    'foreground-midground-horizon',
    'realm-specific-material-weather-botany'
  ]);
  assert.deepEqual(plain(contract.realmSceneProfiles), {
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
  assert.deepEqual(
    plain(contract.invariants.familyBlueprintLanguageRoles),
    plain(contract.blueprintLanguageRoles)
  );
  assert.equal(contract.invariants.modernScienceFictionElementsAllowed, false);
  assert.equal(contract.invariants.specificAssetCopiesAllowed, false);
  assert.equal(contract.inspirationBoundary.copiesSpecificThirdPartyAssets, false);
  assert.equal(contract.inspirationBoundary.copiesSpecificThirdPartyCharacters, false);
  assert.equal(contract.inspirationBoundary.copiesSpecificThirdPartyArchitecture, false);

  for (const definition of scenery.familyCatalog) {
    assert.equal(definition.recipe.sceneLanguage, contract.sceneLanguage);
    assert.deepEqual(
      plain(definition.recipe.languageRoles),
      plain(contract.blueprintLanguageRoles)
    );
    assert.equal(
      definition.recipe.negativeSpaceRatio,
      Math.max(definition.recipe.openness, contract.sceneLanguage.minimumNegativeSpaceRatio)
    );
    assert.deepEqual(
      plain(definition.realmSceneProfile),
      plain(contract.realmSceneProfiles[definition.realmId])
    );
    assert.doesNotMatch(
      [definition.id, definition.labelEn, definition.recipe.pattern, ...definition.motifs].join(' '),
      /(?:lens|tracer|circuit|neon|industrial|turbine)/i
    );
  }
  assert.equal(
    new Set(Object.values(contract.realmSceneProfiles).map((profile) => JSON.stringify(profile))).size,
    6
  );
});

test('adds exactly one original ground scene and one original air scene to every realm', () => {
  const expected = {
    'dawn-isle': ['firstlight-petal-waystones', 'sunmist-memory-sails'],
    'prairie-garden': ['meadow-mask-bloom-rings', 'cloudbanner-star-drift'],
    'rainforest-glow': ['rainveil-candle-root-court', 'canopy-petal-memory-drift'],
    'twilight-valley': ['rosewind-mask-snowfield', 'sunset-banner-starstream'],
    'star-vault': ['quiet-mask-candle-steps', 'memory-petal-orbits'],
    'eden-eye': ['ember-memory-waystones', 'stormtorn-petal-banners']
  };
  const additions = scenery.REGION_SCENERY_CONTRACT.v2EnvironmentAdditionsByRegion;
  assert.deepEqual(plain(additions), expected);
  assert.equal(new Set(Object.values(expected).flat()).size, 12);

  for (const realmId of scenery.REGION_IDS) {
    const definitions = additions[realmId].map((familyId) => scenery.getFamily(familyId));
    assert.ok(definitions.every(({ realmId: actualRealmId }) => actualRealmId === realmId));
    assert.ok(definitions.every(({ category }) => category === 'environment'));
    assert.equal(definitions.filter(({ placementBand }) => placementBand === 'air-far').length, 1);
    assert.equal(
      definitions.filter(({ placementBand }) => placementBand.startsWith('ground-')).length,
      1
    );
    assert.ok(definitions.every(({ lightCount }) => lightCount === 0));
    assert.ok(definitions.every(({ collisionAuthority }) => collisionAuthority === 'none'));
  }
});

test('locks clearance classes, transition policy, and presentation-only ownership', () => {
  const contract = scenery.REGION_SCENERY_CONTRACT;
  assert.equal(contract.invariants.presentationOnly, true);
  assert.equal(contract.invariants.collisionAuthority, 'none');
  assert.equal(contract.invariants.clearanceAuthority, 'complete-road-capsule-query');
  assert.equal(
    contract.invariants.clearanceRadiusMode,
    'horizontal-radius-plus-motion-envelope'
  );
  assert.equal(
    contract.invariants.peerClearanceAuthority,
    'same-side-visible-bounding-circles'
  );
  assert.equal(contract.invariants.originFallbackAllowed, false);
  assert.equal(contract.invariants.radiusShrinkFallbackAllowed, false);
  assert.equal(contract.invariants.transitionLandmarksAllowed, false);
  assert.equal(contract.invariants.sceneLights, 0);
  assert.equal(contract.invariants.colliders, 0);
  assert.equal(contract.invariants.frameAssetAllocations, 0);

  for (const definition of scenery.familyCatalog) {
    const clearance = contract.clearanceClasses[definition.clearanceClass];
    assert.ok(clearance);
    assert.equal(clearance.category, definition.category);
    assert.ok(clearance.placementBands.includes(definition.placementBand));
    assert.equal(clearance.requiresCompleteRoadCapsuleQuery, true);
    assert.equal(clearance.forbidsDrivingCorridorCrossing, true);
    assert.equal(clearance.minimumPeerEdgeGapM, 4);
    assert.equal(
      clearance.minimumRoadGapM,
      definition.category === 'landmark' ? 6 : 3
    );
    assert.equal(
      clearance.minimumDeckClearanceM,
      definition.placementBand === 'air-far' ? 8 : 0
    );
    assert.equal(definition.presentationOnly, true);
    assert.equal(definition.collisionAuthority, 'none');
    assert.equal(definition.lightCount, 0);
    assert.equal(definition.gameplayWrites, 0);
    assert.equal(definition.navigationWrites, 0);
    assert.equal(definition.mapEntityLimitPerLiveGroup, 1);
    assert.equal(definition.collisionRole, 'none');
    assert.equal(definition.horizontalRadiusM, null);
    assert.equal(definition.motionEnvelopeM, null);
    assert.equal(
      definition.transitionPolicy,
      definition.transitionEligible ? 'adjacent-72m-allowed' : 'current-realm-only'
    );
    if (definition.transitionEligible) assert.equal(definition.category, 'environment');
    if (definition.category === 'landmark') assert.equal(definition.transitionEligible, false);
  }
  for (const realmId of scenery.REGION_IDS) {
    assert.ok(
      scenery.getRegionFamilies(realmId).some(
        ({ category, transitionEligible }) => category === 'environment' && transitionEligible
      )
    );
  }
});

test('separates once-per-realm major landmarks from repeatable environment clusters', () => {
  const generation = scenery.REGION_SCENERY_CONTRACT.generationBudget;
  assert.deepEqual(plain(generation.majorStationsM), [390, 1_290, 2_190]);
  assert.equal(generation.realmLengthM, 2_700);
  assert.equal(generation.minimumMajorStationIntervalM, 900);
  assert.equal(generation.authoredMajorStationIntervalM, 900);
  assert.equal(generation.environmentMotifLengthM, 280);
  assert.equal(generation.maximumVisibleNewMajors, 1);
  assert.equal(generation.maximumVisibleNewEnvironments, 5);
  assert.equal(scenery.REGION_SCENERY_CONTRACT.invariants.maximumVisibleNewEnvironments, 5);
  assert.deepEqual(
    plain(generation.majorSilhouetteRangeM),
    { near: 700, far: 1_500 }
  );
  assert.equal(generation.majorDetailEnterDistanceM, 260);
  assert.equal(generation.majorDetailExitDistanceM, 340);
  assert.deepEqual(plain(generation.presentationDistanceM), {
    playerForwardMajorSurfaceM: 1_800,
    playerForwardOtherSurfaceM: 1_440,
    playerRearSurfaceM: 480,
    cameraPrewarmPlaneMarginM: 320,
    cameraRetentionPlaneMarginM: 480,
    cameraMinimumGraceMs: 1_800,
    cameraExpandedPlaneCount: 6
  });
  assert.equal(
    scenery.REGION_SCENERY_CONTRACT.invariants.presentationDistanceAuthority,
    'forward-prewarm-rear-retention-six-plane-film-hysteresis'
  );
  assert.deepEqual(plain(scenery.REGION_SCENERY_CONTRACT.visibilityBands), [
    'silhouette-and-detail',
    'detail-hysteresis-260m-in-340m-out',
    'standard'
  ]);
  assert.deepEqual(
    plain(generation.majorSilhouetteWidthRangeM),
    { minimum: 16, maximum: 60 }
  );

  for (const realmId of scenery.REGION_IDS) {
    const definitions = scenery.getRegionFamilies(realmId);
    const majors = definitions.filter(({ category }) => category === 'landmark');
    const environments = definitions.filter(({ category }) => category === 'environment');
    const stations = majors.map(({ preferredStationM }) => preferredStationM);
    assert.deepEqual(plain(stations), [390, 1_290, 2_190]);
    assert.equal(new Set(stations).size, 3);
    for (let index = 1; index < stations.length; index++) {
      assert.ok(stations[index] - stations[index - 1] >= 900);
    }
    for (const definition of majors) {
      assert.equal(definition.semanticRole, 'landmark-major');
      assert.equal(
        definition.sceneLayer,
        scenery.REGION_SCENERY_CONTRACT.placementBandSceneLayer[definition.placementBand]
      );
      assert.equal(definition.motifRepeat, false);
      assert.equal(definition.mapPriority, 3);
      assert.equal(definition.transitionPolicy, 'current-realm-only');
      assert.equal(definition.transitionEligible, false);
      assert.ok(definition.silhouetteWidthM >= 16 && definition.silhouetteWidthM <= 60);
      assert.deepEqual(
        plain(definition.silhouetteRevealRangeM),
        { near: 700, far: 1_500 }
      );
      assert.deepEqual(
        plain(definition.detailVisibilityHysteresisM),
        { enter: 260, exit: 340 }
      );
    }
    for (const definition of environments) {
      assert.equal(definition.semanticRole, 'environment-cluster');
      assert.equal(
        definition.sceneLayer,
        scenery.REGION_SCENERY_CONTRACT.placementBandSceneLayer[definition.placementBand]
      );
      assert.equal(definition.motifRepeat, true);
      assert.notEqual(definition.mapPriority, 3);
      assert.ok(definition.mapPriority === 0 || definition.mapPriority === 1);
      assert.equal(
        definition.transitionPolicy,
        definition.transitionEligible ? 'adjacent-72m-allowed' : 'current-realm-only'
      );
      assert.equal(definition.preferredStationM, null);
      assert.equal(definition.silhouetteWidthM, null);
      assert.equal(definition.silhouetteRevealRangeM, null);
      assert.equal(definition.detailVisibilityHysteresisM, null);
    }
  }
});

test('reserves an optional external ambient-candlelight category without implementing it', () => {
  const contract = scenery.REGION_SCENERY_CONTRACT;
  assert.ok(contract.categoryIds.includes('ambient-candlelight'));
  const slot = contract.externalCategorySlots['ambient-candlelight'];
  assert.ok(slot);
  assert.equal(slot.optional, true);
  assert.equal(slot.provider, 'external-task');
  assert.equal(slot.expectedFamiliesPerRegion, 1);
  assert.equal(slot.clearanceClass, 'ambient-candlelight-ground');
  assert.deepEqual(plain(slot.allowedSceneLayers), ['roadside', 'terrain']);
  assert.equal(slot.mapPriority, 0);
  assert.equal(slot.collisionRole, 'none');
  assert.equal(slot.pickupRole, 'none');
  assert.equal(slot.presentationOnly, true);
  const clearance = contract.clearanceClasses[slot.clearanceClass];
  assert.equal(clearance.minimumRoadGapM, 3);
  assert.equal(clearance.minimumPeerEdgeGapM, 4);
  assert.equal(scenery.familyCatalog.some(({ category }) => category === 'ambient-candlelight'), false);
});

test('derives every scene layer from the unified project placement mapping', () => {
  const contract = scenery.REGION_SCENERY_CONTRACT;
  assert.deepEqual(
    plain(contract.allowedSceneLayers),
    ['horizon', 'terrain', 'roadside', 'air', 'route']
  );
  assert.deepEqual(
    plain(contract.placementBandSceneLayer),
    {
      'ground-mid': 'roadside',
      'ground-far': 'terrain',
      'air-far': 'horizon'
    }
  );
  assert.equal('majorSceneLayer' in contract.invariants, false);
  assert.equal('environmentSceneLayer' in contract.invariants, false);
  for (const definition of scenery.familyCatalog) {
    assert.equal(
      definition.sceneLayer,
      contract.placementBandSceneLayer[definition.placementBand]
    );
    assert.ok(contract.allowedSceneLayers.includes(definition.sceneLayer));
  }
  assert.doesNotMatch(source, /realm-(?:major|environment|ambient)/);
});

test('derives transition policy only from the frozen transitionEligible boolean', () => {
  const contract = scenery.REGION_SCENERY_CONTRACT;
  assert.equal(contract.invariants.transitionPolicyAuthority, 'transitionEligible-boolean');
  assert.deepEqual(
    plain(contract.transitionPolicyByEligibility),
    {
      true: 'adjacent-72m-allowed',
      false: 'current-realm-only'
    }
  );
  for (const definition of scenery.familyCatalog) {
    const expected = contract.transitionPolicyByEligibility[String(definition.transitionEligible)];
    assert.equal(definition.transitionPolicy, expected);
  }
});

test('keeps every authored and active-region generation budget below the frozen hard caps', () => {
  const generation = scenery.REGION_SCENERY_CONTRACT.generationBudget;
  assert.equal(generation.addedFamilyCount, 48);
  assert.equal(generation.familiesPerRegion, 8);
  assert.equal(generation.landmarksPerRegion, 3);
  assert.equal(generation.environmentsPerRegion, 5);
  assert.equal(generation.addedPooledGroups, 48);
  assert.deepEqual(plain(generation.totalPooledGroups), { desktop: 90, mobile: 84 });
  assert.deepEqual(
    plain(generation.maximumTrianglesPerFamily),
    { desktop: 5_000, mobile: 1_800 }
  );
  assert.deepEqual(
    plain(generation.maximumTrianglesPerActiveRegion),
    { desktop: 32_000, mobile: 11_200 }
  );
  assert.equal(generation.maximumDrawGroupsPerFamily, 3);
  assert.equal(generation.maximumSceneLightsPerFamily, 0);
  assert.equal(generation.maximumCollidersPerFamily, 0);
  assert.equal(generation.maximumMapEntitiesPerLiveGroup, 1);
  assert.equal(generation.maximumFrameAssetAllocations, 0);
  assert.deepEqual(
    plain(generation.visibleBudget),
    { desktopTriangles: 18_300, mobileTriangles: 6_300, drawGroups: 18 }
  );

  for (const realmId of scenery.REGION_IDS) {
    const definitions = scenery.getRegionFamilies(realmId);
    const desktopTriangles = definitions.reduce(
      (sum, definition) => sum + definition.budget.desktopTriangles,
      0
    );
    const mobileTriangles = definitions.reduce(
      (sum, definition) => sum + definition.budget.mobileTriangles,
      0
    );
    assert.equal(
      desktopTriangles,
      scenery.REGION_SCENERY_CONTRACT.authoredBudgetByRegion[realmId].desktopTriangles
    );
    assert.equal(
      mobileTriangles,
      scenery.REGION_SCENERY_CONTRACT.authoredBudgetByRegion[realmId].mobileTriangles
    );
    assert.deepEqual(
      plain(scenery.REGION_SCENERY_CONTRACT.authoredBudgetByRegion[realmId]),
      { desktopTriangles: 25_900, mobileTriangles: 8_900, drawGroups: 24 }
    );
    assert.ok(desktopTriangles <= generation.maximumTrianglesPerActiveRegion.desktop);
    assert.ok(mobileTriangles <= generation.maximumTrianglesPerActiveRegion.mobile);
    for (const definition of definitions) {
      assert.ok(
        definition.budget.desktopTriangles <= generation.maximumTrianglesPerFamily.desktop
      );
      assert.ok(
        definition.budget.mobileTriangles <= generation.maximumTrianglesPerFamily.mobile
      );
      assert.ok(definition.budget.drawGroups <= generation.maximumDrawGroupsPerFamily);
    }
  }
});

test('validates the complete ordered 30-family baseline configuration and rejects drift', () => {
  const configuredContext = vm.createContext({ window: {} });
  vm.runInContext(configSource, configuredContext, {
    filename: 'Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js'
  });
  const actualZones = configuredContext.window.NeonV23Config.zones;
  assert.equal(scenery.validateConfiguredZones(actualZones), true);
  assert.equal(
    actualZones.reduce(
      (sum, zone) => sum + zone.landmarkFamilies.length
        + zone.atmosphere.environmentFamilies.length,
      0
    ),
    30
  );

  const valid = configuredZones();
  assert.equal(scenery.validateConfiguredZones(valid), true);
  assert.throws(() => scenery.validateConfiguredZones(), /configured zones array/);
  assert.throws(() => scenery.validateConfiguredZones(valid.slice(0, 5)), /exactly 6 configured zones/);

  const swapped = configuredZones();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.throws(() => scenery.validateConfiguredZones(swapped), /expected zone dawn-isle/);

  const missingLandmark = configuredZones();
  missingLandmark[2].landmarkFamilies.pop();
  assert.throws(() => scenery.validateConfiguredZones(missingLandmark), /three baseline landmarks/);

  const missingEnvironment = configuredZones();
  missingEnvironment[3].atmosphere.environmentFamilies.pop();
  assert.throws(() => scenery.validateConfiguredZones(missingEnvironment), /two baseline environments/);

  const duplicate = configuredZones();
  duplicate[5].landmarkFamilies[0] = duplicate[0].landmarkFamilies[0];
  assert.throws(() => scenery.validateConfiguredZones(duplicate), /not globally unique/);

  const extensionCollision = configuredZones();
  extensionCollision[0].landmarkFamilies[0] = scenery.familyCatalog[0].id;
  assert.throws(() => scenery.validateConfiguredZones(extensionCollision), /not globally unique/);
  assert.throws(() => scenery.getRegionFamilies('unknown-realm'), /Unknown region-scenery realm/);
  assert.throws(() => scenery.getFamily('unknown-family'), /Unknown region-scenery family/);
});

test('builds exactly 3+5 templates with frozen three-group plans and isolated deterministic RNG', () => {
  const firstSamples = [];
  const secondSamples = [];
  const plans = [];
  const first = scenery.createRegionTemplates({
    realmId: 'dawn-isle',
    zoneIndex: 0,
    qualityProfile: { id: 'high' },
    seed: 'region-unit-seed',
    primitives: createAdapter({ randomSamples: firstSamples, plans })
  });
  const second = scenery.createRegionTemplates({
    realmId: 'dawn-isle',
    zoneIndex: 0,
    qualityProfile: { id: 'high' },
    seed: 'region-unit-seed',
    primitives: createAdapter({ randomSamples: secondSamples })
  });

  assert.equal(first.landmarks.length, 3);
  assert.equal(first.environments.length, 5);
  assert.equal(first.diagnostics.familyCount, 8);
  assert.equal(first.diagnostics.landmarkCount, 3);
  assert.equal(first.diagnostics.environmentCount, 5);
  assert.equal(first.diagnostics.sceneLights, 0);
  assert.equal(first.diagnostics.colliders, 0);
  assert.equal(first.diagnostics.mapEntities, 0);
  assert.equal(first.diagnostics.frameAssetAllocations, 0);
  assert.deepEqual(firstSamples, secondSamples);
  assert.notDeepEqual(firstSamples[0].slice(1), firstSamples[1].slice(1));

  for (const plan of plans) {
    assertDeepFrozen(plan);
    assert.equal(plan.groups.length, 3);
    assert.ok(plan.groups.every(({ parts }) => parts.length > 0));
  }
  for (const entry of [...first.landmarks, ...first.environments]) {
    assert.equal(entry.object.userData.regionSceneryFamilyId, entry.definition.id);
    assert.equal(entry.object.userData.regionSceneryRealmId, 'dawn-isle');
    assert.equal(entry.object.userData.presentationOnly, true);
    assert.equal(entry.object.userData.collisionAuthority, 'none');
    assert.equal(entry.object.userData.collisionRole, 'none');
    assert.equal(entry.object.userData.semanticRole, entry.definition.semanticRole);
    assert.equal(entry.object.userData.sceneLayer, entry.definition.sceneLayer);
    assert.equal(entry.object.userData.motifRepeat, entry.definition.motifRepeat);
    assert.equal(entry.object.userData.mapPriority, entry.definition.mapPriority);
    assert.equal(entry.object.userData.horizontalRadiusM, entry.definition.recipe.radiusM);
    assert.equal(entry.object.userData.motionEnvelopeM, 0);
    assert.equal(entry.measuredFamily.horizontalRadiusM, entry.definition.recipe.radiusM);
    assert.equal(entry.measuredFamily.motionEnvelopeM, 0);
  }
  assert.ok(first.diagnostics.maximumHorizontalRadiusM > 0);
  assert.equal(first.diagnostics.maximumMotionEnvelopeM, 0);
  assert.equal(second.diagnostics.triangles, first.diagnostics.triangles);
});

test('builds renderer-neutral plans for all 48 families in every realm and quality', () => {
  const catalogIds = new Set(scenery.familyCatalog.map(({ id }) => id));
  const allPartKinds = new Set();
  for (const qualityId of ['high', 'mobile']) {
    const builtIds = new Set();
    for (const [zoneIndex, realmId] of scenery.REGION_IDS.entries()) {
      const plans = [];
      const result = scenery.createRegionTemplates({
        realmId,
        zoneIndex,
        qualityProfile: { id: qualityId },
        seed: `all-family-plan-${qualityId}`,
        primitives: createAdapter({ plans })
      });
      assert.equal(plans.length, 8);
      assert.equal(result.diagnostics.familyCount, 8);
      assert.equal(result.diagnostics.qualityKey, qualityId === 'mobile' ? 'mobile' : 'desktop');
      for (const plan of plans) {
        builtIds.add(plan.familyId);
        assert.equal(plan.qualityKey, result.diagnostics.qualityKey);
        assert.equal(plan.groups.length, 3);
        assert.ok(plan.groups.every(({ parts }) => parts.length > 0));
        const definition = scenery.getFamily(plan.familyId);
        assert.equal(plan.sceneLanguage, definition.recipe.sceneLanguage);
        assert.equal(plan.realmSceneProfile, definition.realmSceneProfile);
        assert.deepEqual(
          plain(plan.languageRoles),
          plain(scenery.REGION_SCENERY_CONTRACT.blueprintLanguageRoles)
        );
        const parts = plan.groups.flatMap(({ parts: groupParts }) => groupParts);
        const partKinds = new Set(parts.map(({ kind }) => kind));
        for (const partKind of partKinds) {
          allPartKinds.add(partKind);
          assert.doesNotMatch(partKind, /(?:lens|tracer|circuit|neon|industrial|turbine)/i);
        }
        const realizedLanguageRoles = new Set(
          parts.flatMap(({ languageRoles = [] }) => languageRoles)
        );
        assert.ok(partKinds.has('woven-sail-canopy-petals'));
        assert.ok(partKinds.has('open-oculus-ring'));
        assert.ok(partKinds.has('memory-slab-fan'));
        assert.ok(partKinds.has('archive-script-inlays'));
        for (const languageRole of scenery.REGION_SCENERY_CONTRACT.blueprintLanguageRoles) {
          assert.ok(realizedLanguageRoles.has(languageRole));
        }
        assert.ok(parts.every(({ openness }) => openness === definition.recipe.negativeSpaceRatio));
        const wovenPetals = parts.filter(({ kind }) => kind === 'woven-sail-canopy-petals');
        assert.ok(wovenPetals.length >= 1);
        assert.ok(wovenPetals.every((part) => (
          part.surfaceLanguage === 'woven-cloth-petal'
          && part.clothFoldRatio === 0.16
          && part.edgeTaperRatio === 0.34
          && Number.isInteger(part.petalCount)
          && part.petalCount >= 2
        )));
        assert.equal(
          Math.max(...parts.map(({ heightM }) => heightM)),
          definition.recipe.heightM
            * scenery.REGION_SCENERY_CONTRACT.sceneLanguage.silhouetteHeightScale
        );
        for (const group of plan.groups) {
          const expectedVisibilityBand = definition.semanticRole === 'landmark-major'
            ? group.materialRole === 'base'
              ? 'silhouette-and-detail'
              : 'detail-hysteresis-260m-in-340m-out'
            : 'standard';
          assert.equal(group.visibilityBand, expectedVisibilityBand);
          assert.ok(
            scenery.REGION_SCENERY_CONTRACT.visibilityBands.includes(group.visibilityBand)
          );
        }
        assertDeepFrozen(plan);
      }
    }
    assert.equal(builtIds.size, 48);
    assert.deepEqual([...builtIds].sort(), [...catalogIds].sort());
  }
  assert.equal(
    scenery.REGION_SCENERY_CONTRACT.invariants.visibilityBandsAddDrawGroups,
    false
  );
  assert.ok(allPartKinds.has('wind-memory-threads'));
  assert.ok(allPartKinds.has('recessed-candle-star-carving'));
  assert.ok(allPartKinds.has('woven-sail-canopy-petals'));
  assert.equal(scenery.getFamily('sunset-pilgrim-wind-ring').labelEn, 'Sunset Pilgrim Wind Ring');
  assert.throws(() => scenery.getFamily(['sunset', 'aerodrome', 'ring'].join('-')), /Unknown/);
  assert.equal(source.includes(['sail', 'canopy', 'panels'].join('-')), false);
  assert.equal(source.includes(['detail-within', 2 * 110, 'm'].join('-')), false);
  assert.equal(source.includes(['flow', 'tracer', 'bundle'].join('-')), false);
  assert.equal(source.includes(['recessed', 'light', 'lens'].join('-')), false);
});

test('rejects invalid build inputs, budget overruns, lights, colliders, writes, and frame allocation', () => {
  const base = {
    realmId: 'eden-eye',
    zoneIndex: 5,
    qualityProfile: { id: 'mobile' },
    seed: 'budget-gate',
    primitives: createAdapter()
  };
  assert.throws(
    () => scenery.createRegionTemplates({ ...base, zoneIndex: 4 }),
    /expected zoneIndex 5/
  );
  assert.throws(
    () => scenery.createRegionTemplates({ ...base, qualityProfile: { id: 'medium' } }),
    /high\/desktop or mobile/
  );
  assert.throws(
    () => scenery.createRegionTemplates({ ...base, seed: '' }),
    /non-empty independent visual seed/
  );
  assert.throws(
    () => scenery.createRegionTemplates({ ...base, primitives: {} }),
    /primitives\.instantiateTemplate/
  );
  assert.throws(
    () => scenery.createRegionTemplates({
      ...base,
      primitives: createAdapter({ triangleDelta: 1 })
    }),
    /exceeded its triangle budget/
  );
  assert.throws(
    () => scenery.createRegionTemplates({
      ...base,
      primitives: createAdapter({ drawGroupDelta: 1 })
    }),
    /exceeded its draw-group budget/
  );
  assert.throws(
    () => scenery.createRegionTemplates({
      ...base,
      primitives: createAdapter({ horizontalRadiusM: 0 })
    }),
    /finite positive horizontalRadiusM/
  );
  assert.throws(
    () => scenery.createRegionTemplates({
      ...base,
      primitives: createAdapter({ motionEnvelopeM: -1 })
    }),
    /finite non-negative motionEnvelopeM/
  );
  for (const violation of [
    { sceneLights: 1 },
    { colliders: 1 },
    { mapEntities: 1 },
    { gameplayWrites: 1 },
    { navigationWrites: 1 },
    { frameAssetAllocations: 1 }
  ]) {
    assert.throws(
      () => scenery.createRegionTemplates({
        ...base,
        primitives: createAdapter(violation)
      }),
      /illegally reported/
    );
  }
});

test('keeps large JavaScript numeric literals visibly separated in source', () => {
  for (const literal of ['5_000', '1_800', '1_500', '1_440', '32_000', '11_200', '2_700', '2_190', '1_290', '18_300', '6_300', '4_600', '3_800', '3_300', '2_600', '1_600', '1_300', '1_100', '4_294_967_296']) {
    assert.ok(source.includes(literal), `missing separated numeric literal ${literal}`);
  }
  assert.equal(source.includes('3_200'), false);
  assert.doesNotMatch(source, /\b(?:5000|1800|1500|1440|32000|11200|2700|2190|1290|25900|18300|8900|6300|4600|3800|3300|3200|2600|1600|1300|1100|4294967296)\b/);
});
