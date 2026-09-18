import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Resolve authored world and runtime contracts from the project root, independent of test cwd.
const PROJECT_ROOT = new URL('../../', import.meta.url);
const require = createRequire(import.meta.url);
const worldSource = readFileSync(
  new URL('src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.world.js', PROJECT_ROOT),
  'utf8'
);
const mainSource = readFileSync(
  new URL('src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js', PROJECT_ROOT),
  'utf8'
);
const configSource = readFileSync(
  new URL('src/config/Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js', PROJECT_ROOT),
  'utf8'
);
const configContext = vm.createContext({ window: {} });
vm.runInContext(configSource, configContext, {
  filename: 'Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js'
});
const configuredZones = configContext.window.NeonV23Config.zones;
const context = vm.createContext({ window: {} });
vm.runInContext(worldSource, context, {
  filename: 'Neon_Autopilot_V23_HighSpeed_DroneHeat.world.js'
});
const world = context.window.NeonV23World;

/** Capture every mutable perspective-camera input that world presentation must treat as read-only. */
function cameraSnapshot(camera) {
  return {
    position: camera.position.toArray(),
    rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z, camera.rotation.order],
    quaternion: camera.quaternion.toArray(),
    scale: camera.scale.toArray(),
    up: camera.up.toArray(),
    fov: camera.fov,
    aspect: camera.aspect,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
    focus: camera.focus,
    filmGauge: camera.filmGauge,
    filmOffset: camera.filmOffset,
    matrix: camera.matrix.toArray(),
    matrixWorld: camera.matrixWorld.toArray(),
    matrixWorldInverse: camera.matrixWorldInverse.toArray(),
    projectionMatrix: camera.projectionMatrix.toArray(),
    projectionMatrixInverse: camera.projectionMatrixInverse.toArray()
  };
}

test('moon visuals follow the main physical-lighting direction without creating a duplicate light', () => {
  const contract = world.MOON_LIGHTING_CONTRACT;
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.version, 2);
  assert.equal(
    contract.visualLanguage,
    'distant-candle-moon-memory-star-ring-and-cloud-veils'
  );
  assert.equal(contract.directionAuthority, 'main-physical-lighting-rig');
  assert.equal(contract.targetAuthority, 'main-physical-lighting-rig');
  assert.equal(contract.stateDirectionKey, 'physicalMoonDirection');
  assert.equal(contract.residencyMode, 'prewarmed-camera-relative-physical-direction');
  assert.equal(contract.solidMoonMeshCount, 1);
  assert.equal(contract.softHaloSpriteCount, 1);
  assert.equal(contract.memoryStarPetalInstanceCount, 7);
  assert.equal(contract.memoryStarPetalDrawGroups, 1);
  assert.equal(contract.cloudVeilInstanceCount, 2);
  assert.equal(contract.cloudVeilDrawGroups, 1);
  assert.equal(contract.residentVisualObjectCount, 4);
  assert.equal(contract.createsLocalLightCount, 0);
  assert.equal(contract.createsDirectionalLight, false);
  assert.equal(contract.createsIndependentShadow, false);
  assert.deepEqual([...contract.fallbackVisualOffset], [-112, 88, -360]);

  const aligned = world.resolveMoonVisualOffset({ x: 1, y: 2, z: -3 });
  assert.equal(aligned.usesPhysicalDirection, true);
  const alignedLength = Math.hypot(aligned.x, aligned.y, aligned.z);
  assert.ok(Math.abs(aligned.x / alignedLength - 1 / Math.sqrt(14)) <= 0.000_000_001);
  assert.ok(Math.abs(aligned.y / alignedLength - 2 / Math.sqrt(14)) <= 0.000_000_001);
  assert.ok(Math.abs(aligned.z / alignedLength + 3 / Math.sqrt(14)) <= 0.000_000_001);

  const fallback = world.resolveMoonVisualOffset([0, 0, 0]);
  assert.deepEqual(
    { x: fallback.x, y: fallback.y, z: fallback.z, usesPhysicalDirection: fallback.usesPhysicalDirection },
    { x: -112, y: 88, z: -360, usesPhysicalDirection: false }
  );
  const moonBuildStart = worldSource.indexOf(
    '// A real sphere carries the distant candle-moon surface'
  );
  const moonBuildEnd = worldSource.indexOf(
    'const darkDragonBodyMaterial',
    moonBuildStart
  );
  assert.ok(moonBuildStart >= 0 && moonBuildEnd > moonBuildStart);
  const moonBuildSource = worldSource.slice(moonBuildStart, moonBuildEnd);
  assert.match(moonBuildSource, /new THREE\.SphereGeometry\(/);
  assert.equal((moonBuildSource.match(/new THREE\.Sprite\(/g) || []).length, 1);
  assert.equal((moonBuildSource.match(/new THREE\.InstancedMesh\(/g) || []).length, 2);
  assert.match(moonBuildSource, /closed_memory_star_petal/);
  assert.match(moonBuildSource, /closed_memory_cloud_veil/);
  assert.doesNotMatch(
    moonBuildSource,
    /new THREE\.(?:AmbientLight|DirectionalLight|HemisphereLight|PointLight|RectAreaLight|SpotLight)/
  );
  assert.doesNotMatch(worldSource, /new THREE\.DirectionalLight/);
  assert.match(worldSource, /resolveMoonVisualOffset\(state\.physicalMoonDirection, moonVisualOffset\)/);
  assert.match(worldSource, /moonVisual\.quaternion\.copy\(camera\.quaternion\)/);
  assert.match(worldSource, /moonVisualLightDirectionErrorRadians/);
});

test('opaque world visuals cast and receive shadows on every quality profile', () => {
  assert.match(worldSource, /mesh\.castShadow = allowsOpaqueShadow\(mesh\);/);
  assert.match(worldSource, /mesh\.receiveShadow = true;/);
  assert.doesNotMatch(worldSource, /castShadow = !mobile/);
  assert.doesNotMatch(worldSource, /castShadow = !mobile && !far/);
  assert.match(worldSource, /child\.castShadow = allowsOpaqueShadow\(child\);/);
});

test('fresh committed route shelter masks only local rain while open bridge exteriors remain visible', () => {
  const contract = world.LOCAL_RAIN_SHELTER_CONTRACT;
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.version, 1);
  assert.equal(contract.mode, 'fresh-route-local-mask-with-open-underpass-exterior');
  assert.equal(contract.innerRadiusM, 12);
  assert.equal(contract.outerRadiusM, 30);
  assert.equal(contract.exteriorExposure, 1);
  assert.equal(contract.cameraPreviewAffectsRain, false);
  assert.equal(contract.additionalDrawGroups, 0);

  const openRoad = world.resolveLocalRainShelter({
    covered: false,
    tunnelKind: null,
    underpassBlend: 0
  });
  const bridgeShade = world.resolveLocalRainShelter({
    covered: false,
    tunnelKind: null,
    underpassBlend: 1
  });
  const tunnelPortal = world.resolveLocalRainShelter({
    covered: true,
    tunnelKind: 'mountain-tunnel',
    underpassBlend: 0.5
  });
  const deepTunnel = world.resolveLocalRainShelter({
    covered: true,
    tunnelKind: 'underground-tunnel',
    underpassBlend: 1
  });
  assert.deepEqual(
    { local: openRoad.localExposure, distant: openRoad.distantExposure },
    { local: 1, distant: 1 }
  );
  assert.deepEqual(
    { local: bridgeShade.localExposure, distant: bridgeShade.distantExposure },
    { local: 0, distant: 1 }
  );
  assert.deepEqual(
    { local: tunnelPortal.localExposure, distant: tunnelPortal.distantExposure },
    { local: 0.5, distant: 0.5 }
  );
  assert.deepEqual(
    { local: deepTunnel.localExposure, distant: deepTunnel.distantExposure },
    { local: 0, distant: 0 }
  );
  assert.equal(Object.isFrozen(openRoad), true);

  assert.match(worldSource, /const weatherClassifier = window\.NeonV23Weather\?\.isSealedTunnelFrame;/);
  assert.match(worldSource, /resolveLocalRainShelter\(surfacePoint, rainShelterScratch\)/);
  assert.match(worldSource, /rainGeometry\.setDrawRange\(0, activeCount \* 2\);/);
  assert.match(worldSource, /rainMaterial\.opacity = intensity \* 0\.82;/);
  assert.match(worldSource, /uV23RainLocalExposure/);
  assert.match(worldSource, /uV23RainDistantExposure/);
  assert.match(worldSource, /length\(vV23RainLocalXZ\)/);
  assert.match(worldSource, /customProgramCacheKey = \(\) => 'v23-local-rain-shelter-v1'/);
  assert.doesNotMatch(
    worldSource.slice(
      worldSource.indexOf('function updateWeatherVolume('),
      worldSource.indexOf('function resolveZoneIndex(')
    ),
    /cameraUndergroundBlend/,
    'camera preview must never switch the committed-route rain mask'
  );
  assert.match(worldSource, /pool\.geometry\.setDrawRange\(0, renderedCount\);/);
  for (const marker of [
    "weatherShelterAuthority: 'fresh-committed-route-frame'",
    'weatherSealedTunnel: false',
    'weatherTunnelKind: null',
    'weatherRainCameraPreviewIgnored:',
    'weatherRainLocalExposure:',
    'weatherRainDistantExposure:'
  ]) {
    assert.ok(worldSource.includes(marker), `missing world tunnel-weather diagnostic ${marker}`);
  }
});

test('every finite weather family encloses Top view without adding pools or draw groups', () => {
  const viewContract = world.WEATHER_VIEW_VOLUME_CONTRACT;
  const contract = world.PRECIPITATION_DEPTH_CONTRACT;
  assert.ok(Object.isFrozen(viewContract));
  assert.ok(Object.isFrozen(viewContract.capacity));
  assert.ok(Object.isFrozen(viewContract.capacity.mobile));
  assert.ok(Object.isFrozen(viewContract.capacity.desktop));
  assert.equal(viewContract.version, 1);
  assert.equal(viewContract.mode, 'top-camera-enclosing-interleaved-weather-volume');
  assert.equal(viewContract.maximumSupportedCameraHeightAboveSurfaceM, 26);
  assert.equal(viewContract.maximumTopViewUpwardRayDeg, 14);
  assert.equal(viewContract.minimumGroundOverlapM, 10);
  assert.equal(viewContract.minimumCameraOverheadM, 10);
  assert.equal(viewContract.minimumCameraCenteredVerticalSpanM, 72);
  assert.equal(viewContract.hailUsesDepthBands, true);
  assert.equal(viewContract.dustUsesDepthBands, true);
  assert.equal(viewContract.poolCount, 4);
  assert.equal(viewContract.layerCount, 5);
  assert.equal(viewContract.additionalDrawGroups, 0);
  assert.equal(viewContract.preservesPoolCapacity, true);
  assert.equal(viewContract.presentationOnly, true);
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.version, 2);
  assert.equal(contract.mode, 'interleaved-near-mid-far-within-existing-pools');
  assert.equal(contract.anchorMode, 'absolute-world-periodic-volume');
  assert.equal(contract.rainDrawGroups, 1);
  assert.equal(contract.snowDrawGroups, 2);
  assert.equal(contract.hailDrawGroups, 1);
  assert.equal(contract.dustDrawGroups, 1);
  assert.equal(contract.preservesPoolCapacity, true);
  assert.equal(contract.presentationOnly, true);
  assert.deepEqual([...contract.bandNames], ['near', 'mid', 'far']);
  assert.ok(contract.spansM.desktop.far.horizontal * 0.5 >= 300);
  assert.ok(contract.spansM.mobile.far.horizontal * 0.5 >= 210);
  assert.ok(contract.spansM.desktop.far.horizontal > contract.spansM.desktop.mid.horizontal);
  assert.ok(contract.spansM.mobile.far.horizontal > contract.spansM.mobile.mid.horizontal);
  const topRaySlope = Math.tan(viewContract.maximumTopViewUpwardRayDeg * Math.PI / 180);
  for (const profile of [contract.spansM.mobile, contract.spansM.desktop]) {
    assert.ok(
      profile.near.vertical * 0.5 - viewContract.maximumSupportedCameraHeightAboveSurfaceM
        >= viewContract.minimumGroundOverlapM
    );
    for (const bandName of contract.bandNames) {
      const span = profile[bandName];
      assert.ok(span.vertical >= viewContract.minimumCameraCenteredVerticalSpanM);
      assert.ok(
        span.vertical * 0.5 - span.horizontal * 0.5 * topRaySlope
          >= viewContract.minimumCameraOverheadM,
        `${bandName} band does not enclose the Top-view upper ray`
      );
    }
  }

  const families = [
    {
      name: 'rain',
      family: 'rain',
      shares: [...contract.rainBandShares],
      capacities: [contract.capacity.mobile.rain, contract.capacity.desktop.rain],
      expectedDesktop: [252, 105, 63]
    },
    {
      name: 'snow',
      family: 'snow-base',
      shares: [...contract.snowBaseBandShares],
      capacities: [contract.capacity.mobile.snowBase, contract.capacity.desktop.snowBase],
      expectedDesktop: [0, 196, 84]
    },
    {
      name: 'hail',
      family: 'hail',
      shares: [...contract.rainBandShares],
      capacities: [viewContract.capacity.mobile.hail, viewContract.capacity.desktop.hail],
      expectedDesktop: [108, 45, 27]
    },
    {
      name: 'dust',
      family: 'dust',
      shares: [...contract.rainBandShares],
      capacities: [viewContract.capacity.mobile.dust, viewContract.capacity.desktop.dust],
      expectedDesktop: [216, 90, 54]
    }
  ];
  for (const { name, family, shares, capacities, expectedDesktop } of families) {
    for (const capacity of capacities) {
      const counts = [0, 0, 0];
      for (let index = 0; index < capacity; index++) {
        counts[world.precipitationDepthBandId(family, index)]++;
        const prefixLength = index + 1;
        for (let band = 0; band < counts.length; band++) {
          assert.ok(
            Math.abs(counts[band] - prefixLength * shares[band]) <= 1.000_000_001,
            `${name} prefix ${prefixLength} lost low-discrepancy band coverage`
          );
        }
      }
      if (capacity === capacities[1]) assert.deepEqual(counts, expectedDesktop);
    }
  }

  for (const marker of [
    'const rainDepthSeeds = createDepthWeatherSeeds',
    "depthFamily: 'snow-base'",
    "const hailPool = createWeatherPointPool",
    "const dustPool = createWeatherPointPool",
    'weatherHailUsesDepthBands: WEATHER_VIEW_VOLUME_CONTRACT.hailUsesDepthBands',
    'weatherDustUsesDepthBands: WEATHER_VIEW_VOLUME_CONTRACT.dustUsesDepthBands',
    'WEATHER_VIEW_VOLUME_CONTRACT.dustDenseGroundHeightM',
    'const depthBandName = PRECIPITATION_DEPTH_CONTRACT.bandNames[rainBandIds[index]]',
    'const horizontalSpanX = depthSpan?.horizontal || pool.spanX',
    'weatherPrecipitationDepthMode: PRECIPITATION_DEPTH_CONTRACT.mode',
    'weatherPoolCount: 4',
    'weatherLayerCount: 5',
    'weatherRainLayerCount: 1',
    'weatherSnowLayerCount: 2'
  ]) {
    assert.ok(worldSource.includes(marker), `missing precipitation-depth marker ${marker}`);
  }
  assert.match(worldSource, /phase \* depthSpan\.vertical - time \* fallSpeed - weatherAnchor\.worldY/);
  assert.match(worldSource, /rainSeeds\[seedOffset\][\s\S]*?- weatherAnchor\.worldX/);
  assert.match(worldSource, /rainSeeds\[seedOffset \+ 2\][\s\S]*?- weatherAnchor\.worldZ/);
  assert.match(worldSource, /'SnowNear'[\s\S]*?map: snowflakeTexture/);
  assert.match(
    worldSource,
    /'Hail'[\s\S]*?\{ depthFamily: 'rain' \}[\s\S]*?'Dust'[\s\S]*?\{ depthFamily: 'rain' \}/
  );
  assert.doesNotMatch(worldSource, /surfaceWorldY - weatherAnchor\.worldY - 2 \+ phase \* 24/);
});

test('legacy dark-dragon math remains pure while all legacy creature roots are disabled', () => {
  const contract = world.DARK_DRAGON_FLIGHT_CONTRACT;
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.forwardSpeedMps, 72);
  assert.equal(contract.cycleLengthM, 900);
  assert.ok(-contract.routeLeadBiasM > contract.visibleNearZMaxM);
  assert.ok(
    -(contract.cycleLengthM + contract.routeLeadBiasM) < contract.visibleFarZMinM
  );
  assert.equal(contract.headingMode, 'route-tangent');
  assert.equal(contract.articulationMode, 'symmetric-wingbeat');
  assert.equal(contract.longitudinalSwayAmplitudeM, 0);
  assert.equal(contract.lateralSwayAmplitudeM, 0);
  assert.equal(contract.verticalSwayAmplitudeM, 0);
  assert.equal(contract.rootYawSwayRadians, 0);
  assert.equal(contract.rootPitchSwayRadians, 0);
  assert.equal(contract.rootRollSwayRadians, 0);
  assert.equal(contract.presentationOnly, true);

  const startM = world.darkDragonRouteDistanceM(0, 0, 100);
  const afterOneSecondM = world.darkDragonRouteDistanceM(0, 1, 100);
  const afterOneSecondWithPlayerMotionM = world.darkDragonRouteDistanceM(32, 1, 100);
  assert.equal(afterOneSecondM - startM, contract.forwardSpeedMps);
  assert.equal(afterOneSecondWithPlayerMotionM, afterOneSecondM);
  assert.throws(
    () => world.darkDragonRouteDistanceM(Number.NaN, 1, 100),
    /requires finite route, time, and offset inputs/
  );
  assert.throws(
    () => world.darkDragonRouteDistanceM(0, -1, 100),
    /flight time cannot be negative/
  );

  const loopStart = worldSource.indexOf('// Dark dragons remain remote silhouettes');
  const rootEnd = worldSource.indexOf('// Cached rig references keep the silhouette stable', loopStart);
  const dragonRootMotion = worldSource.slice(loopStart, rootEnd);
  assert.ok(loopStart >= 0 && rootEnd > loopStart);
  assert.match(dragonRootMotion, /darkDragonRouteDistanceM\(/);
  assert.match(dragonRootMotion, /const lateral = dragon\.userData\.lateral;/);
  assert.match(dragonRootMotion, /dragon\.userData\.height,/);
  assert.match(dragonRootMotion, /dragon\.rotation\.y = graphFrame\?\.yaw \?\? -Math\.atan/);
  assert.match(dragonRootMotion, /dragon\.rotation\.x = 0;/);
  assert.match(dragonRootMotion, /dragon\.rotation\.z = 0;/);
  assert.doesNotMatch(dragonRootMotion, /Math\.sin/);
  const setupStart = worldSource.indexOf(
    'const darkDragonTemplate = LEGACY_CREATURES_ENABLED ? buildDarkDragonTemplate() : null'
  );
  const setupEnd = worldSource.indexOf('// Stars, dawn motes, snow and ash', setupStart);
  const dragonSetup = worldSource.slice(setupStart, setupEnd);
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  assert.match(dragonSetup, /const darkDragonCount = LEGACY_CREATURES_ENABLED \? \(mobile \? 1 : 2\) : 0;/);
  assert.doesNotMatch(dragonSetup, /userData\.(?:drift|speedWave|headingOffset)/);
  assert.match(
    worldSource,
    /const mantaTemplate = LEGACY_CREATURES_ENABLED \? buildMantaTemplate\(\) : null;/
  );
  assert.match(worldSource, /const mantaCount = LEGACY_CREATURES_ENABLED \? \(mobile \? 5 : 10\) : 0;/);
  assert.match(worldSource, /'disabled-replaced-by-creature-factory'/);
});

test('cloud presentation clearance contract is immutable and remains visual only', () => {
  const contract = world.CLOUD_PRESENTATION_CLEARANCE_CONTRACT;
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.roadVerticalClearanceM, 36);
  assert.equal(contract.sightlineStartM, 4);
  assert.equal(contract.sightlineLengthM, 320);
  assert.equal(contract.sightlineNearRadiusM, 7);
  assert.equal(contract.sightlineFarRadiusM, 18);
  assert.equal(contract.sightlineFeatherM, 16);
  assert.equal(contract.cameraBubbleOuterM, 24);
  assert.equal(contract.minimumScale, 0.001);
  assert.equal(contract.presentationOnly, true);
});

test('weather cloud layers partition the existing lobe budget under one weather and lighting authority', () => {
  const contract = world.CLOUD_WEATHER_LAYER_CONTRACT;
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.version, 2);
  assert.deepEqual([...contract.layerIds], ['high-wisp', 'mid-body', 'low-weather-deck']);
  assert.deepEqual(
    Array.from(contract.altitudeRangesM, (range) => Array.from(range)),
    [[68, 92], [48, 70], [30, 54]]
  );
  assert.ok(contract.altitudeRangesM.every((range) => Object.isFrozen(range)));
  assert.equal(contract.weatherAuthority, 'shared-weather-snapshot');
  assert.equal(contract.lightingAuthority, 'physical-lighting-state');
  assert.equal(contract.sharedGeometryCount, 1);
  assert.equal(contract.drawGroupBudget, 3);
  assert.equal(contract.instanceBudgetMode, 'partition-existing-lobes');
  assert.equal(
    contract.clusterVisualLanguage,
    'few-monumental-navigable-cloud-hills-walls-and-high-veils'
  );
  assert.deepEqual({ ...contract.clusterCount }, { mobile: 24, desktop: 48 });
  assert.deepEqual([...contract.lobesPerClusterRange], [2, 3]);
  assert.deepEqual([...contract.horizontalScaleRangeM], [28, 62]);
  assert.deepEqual([...contract.verticalScaleRangeM], [5, 22]);
  assert.equal(contract.minimumAuthoredWorldBottomM, 45);
  assert.equal(
    contract.undersideModel,
    'physical-normal-shadow-plus-high-quality-density-rolloff'
  );
  assert.equal(contract.projectedShadowMode, 'global-cloud-transmission');
  assert.equal(contract.visualOnly, true);

  assert.match(worldSource, /const layerIndex = index % cloudLayerCount;/);
  assert.match(worldSource, /CLOUD_WEATHER_LAYER_CONTRACT\.layerIds\.map\(\(layerId, layerIndex\) => \{/);
  assert.match(
    worldSource,
    /new THREE\.InstancedMesh\(\s*cloudGeometry,\s*cloudLayerMaterials\[layerIndex\],\s*cloudLayerLobeCapacities\[layerIndex\]/
  );
  assert.match(worldSource, /mesh\.castShadow = false;/);
  assert.match(worldSource, /mesh\.receiveShadow = true;/);
  assert.match(worldSource, /cloudSharedGeometryCount: CLOUD_WEATHER_LAYER_CONTRACT\.sharedGeometryCount/);
  assert.match(worldSource, /cloudShadowCasterCount: 0/);
  assert.match(worldSource, /role: 'closed_navigable_cloud_hill'/);
  assert.match(worldSource, /const cloudGridColumns = mobile \? 4 : 8;/);
  assert.match(worldSource, /const cloudGridRows = 6;/);
  assert.doesNotMatch(worldSource, /closed_cloud_tuft|cumulus silhouettes|cotton-ball/);
});

test('low weather cloud exists only for dense precipitating skies and excludes dust storms', () => {
  const resolve = world.resolveCloudLayerPresentation;
  const profiles = [
    { label: 'clear', weather: { cloudCover: 0.08 }, low: false },
    { label: 'dry overcast', weather: { cloudCover: 1 }, low: false },
    { label: 'sparse rain', weather: { cloudCover: 0.51, rain: 1 }, low: false },
    { label: 'dense rain', weather: { cloudCover: 0.88, rain: 0.9 }, low: true },
    { label: 'dense snow', weather: { cloudCover: 0.82, snow: 0.75 }, low: true },
    { label: 'dense hail', weather: { cloudCover: 0.94, hail: 0.68 }, low: true },
    { label: 'sandstorm', weather: { cloudCover: 0.96, dust: 1 }, low: false }
  ];

  for (const { label, weather, low } of profiles) {
    const presentation = resolve(weather);
    for (const key of ['high', 'middle', 'low', 'precipitation']) {
      assert.ok(Number.isFinite(presentation[key]), `${label}.${key} must be finite`);
      assert.ok(
        presentation[key] >= 0 && presentation[key] <= 1,
        `${label}.${key} must stay normalized`
      );
    }
    assert.equal(presentation.low > 0, low, `${label} low-deck eligibility drifted`);
  }

  const lightCloud = resolve({ cloudCover: 0.28 });
  const layeredCloud = resolve({ cloudCover: 0.78 });
  assert.ok(layeredCloud.high > lightCloud.high);
  assert.ok(layeredCloud.middle > lightCloud.middle);
});

test('severe-weather cloud bottoms receive only the upward lift required by the deck envelope', () => {
  assert.equal(world.requiredCloudLiftM(5, 45), 40);
  assert.equal(world.requiredCloudLiftM(48, 45), 0);

  const severeProfileBottomM = 30 - 24 - 12;
  const correctedBottomM = severeProfileBottomM
    + world.requiredCloudLiftM(severeProfileBottomM, 45);
  assert.equal(correctedBottomM, 45);
  assert.throws(
    () => world.requiredCloudLiftM(Number.NaN, 45),
    /requires finite bottom heights/
  );
  assert.throws(
    () => world.requiredCloudLiftM(5, Number.POSITIVE_INFINITY),
    /requires finite bottom heights/
  );
});

test('camera clearance yields central and nearby lobes while preserving peripheral cloud cover', () => {
  const forward = [0, 0, -1];
  const scaleAt = (relative, radiusM) => world.cloudSightlineScale(
    ...relative,
    ...forward,
    radiusM
  );

  assert.equal(scaleAt([0, 20, -120], 32), 0.001);
  assert.equal(scaleAt([0, 0, 0], 8), 0.001);
  assert.equal(scaleAt([90, 25, -120], 15), 1);
  assert.equal(scaleAt([0, 20, 100], 15), 1);
  assert.equal(scaleAt([0, 20, -400], 15), 1);
  assert.ok(scaleAt([27, 0, -120], 5) > 0.5);
  assert.ok(scaleAt([27, 0, -120], 5) < 1);
  assert.throws(
    () => world.cloudSightlineScale(0, 0, -20, 0, 0, 0, 4),
    /requires a non-zero camera direction/
  );
  assert.throws(
    () => world.cloudSightlineScale(0, 0, -20, 0, 0, -1, -1),
    /requires finite vectors and a non-negative radius/
  );
});

test('runtime refreshes camera and manual-weather safety inputs and publishes the visual-only audit', () => {
  for (const marker of [
    'camera.getWorldDirection(cloudCameraForward)',
    'camera.position.x === cloudLastMatrixCameraX',
    'cloudCameraForward.z === cloudLastMatrixForwardZ',
    'weatherCloudCover === cloudLastMatrixWeatherCover',
    'precipitationCloudMass === cloudLastMatrixPrecipitationMass',
    'cloudRoadClearanceViolationCount',
    'cloudViewAttenuatedLobeCount',
    'cloudCameraOcclusionProtection: true',
    'cloudClearanceVisualOnly: true'
  ]) {
    assert.ok(worldSource.includes(marker), `world runtime is missing ${marker}`);
  }
  for (const marker of [
    'cloudMinimumWorldBottomM',
    'cloudMinimumObservedBottomM',
    'cloudRoadClearanceViolationCount',
    'cloudViewAttenuatedLobeCount',
    'cloudCameraOcclusionProtection',
    'cloudClearanceVisualOnly',
    'renderQualityWorldHorizonLayerCount',
    'renderQualityWorldHorizonVisibleDrawGroupCount',
    'renderQualityWorldHorizonInstancedMeshCount',
    'renderQualityWorldHorizonMorphTargetCount',
    'renderQualityWorldHorizonProfileSignatureCount',
    'renderQualityWorldHorizonEmissiveViolationCount',
    'renderQualityWorldHorizonAnchorLagM',
    'renderQualityWorldHorizonMorphWeight',
    'renderQualityWorldHorizonAnchorMode'
  ]) {
    assert.ok(mainSource.includes(marker), `page diagnostics are missing ${marker}`);
  }
});

test('High Ultra environment is reversible, uses configured far scenery, and owns no gameplay authority', () => {
  const contract = world.WORLD_ULTRA_PRESENTATION_CONTRACT;
  assert.ok(Object.isFrozen(contract));
  assert.equal(contract.version, 4);
  assert.equal(contract.qualityId, 'high');
  assert.equal(contract.skyDomeRadiusM, 820);
  assert.equal(contract.horizonRadiusM, 640);
  assert.equal(contract.horizonSegments, 96);
  assert.equal(contract.horizonZoneCount, 6);
  assert.equal(contract.horizonDepthLayerCount, 3);
  assert.deepEqual([...contract.horizonLayerRadiiM], [468, 554, 640]);
  assert.deepEqual([...contract.horizonLayerWidthsM], [96, 112, 128]);
  assert.deepEqual([...contract.horizonOpenSkyRatioRange], [0.55, 0.75]);
  assert.deepEqual([...contract.horizonMonumentalCrestRangeM], [68, 132]);
  assert.equal(
    contract.horizonSilhouetteLanguage,
    'realm-monuments-cloud-mountains-open-pilgrimage-sky'
  );
  assert.equal(contract.horizonTrianglesPerZone, 1_728);
  assert.equal(contract.horizonMeshesPerZone, 1);
  assert.equal(contract.horizonInstancesPerZone, 0);
  assert.equal(contract.horizonMorphTargetsPerZone, 1);
  assert.equal(contract.horizonMaximumVisibleDrawGroups, 1);
  assert.equal(contract.horizonGeometryMode, 'deterministic-concentric-relief-bands');
  assert.equal(contract.horizonMaterialModel, 'opaque-physically-lit-standard');
  assert.equal(
    contract.horizonTransitionMode,
    'single-mesh-position-normal-morph-explicit-color-attribute'
  );
  assert.equal(
    contract.horizonColorTransitionMode,
    'webgl1-webgl2-next-color-attribute'
  );
  assert.equal(contract.horizonAnchorMode, 'bounded-world-space-parallax');
  assert.equal(contract.cameraContract, 'read-only-unchanged');
  assert.equal(contract.materialDetailMode, 'world-space-multiscale');
  assert.equal(contract.farSceneryAuthority, 'zone.atmosphere.farScenery');
  assert.equal(contract.lightingAuthority, 'main-physical-lighting-rig');
  assert.equal(contract.createsLightCount, 0);
  assert.equal(contract.registersMapEntityCount, 0);
  assert.equal(contract.reversible, true);
  assert.equal(contract.presentationOnly, true);

  const palettes = world.WORLD_ULTRA_SKY_PALETTES;
  assert.ok(Object.isFrozen(palettes));
  assert.equal(palettes.length, contract.horizonZoneCount);
  assert.equal(new Set(palettes.map((palette) => palette.zenith)).size, palettes.length);
  assert.ok(palettes.every((palette) => Object.isFrozen(palette)));

  const deterministicProfileA = world.createUltraHorizonProfile(
    0,
    ['layered-cloud-island', 'distant-sun-portal']
  );
  const deterministicProfileB = world.createUltraHorizonProfile(
    0,
    ['layered-cloud-island', 'distant-sun-portal']
  );
  assert.deepEqual(deterministicProfileB, deterministicProfileA);
  assert.equal(deterministicProfileA.layers.length, contract.horizonDepthLayerCount);
  assert.ok(
    deterministicProfileA.layers.every((layer) => layer.length === contract.horizonSegments)
  );
  assert.ok(
    deterministicProfileA.openSkyRatioTarget >= contract.horizonOpenSkyRatioRange[0]
      && deterministicProfileA.openSkyRatioTarget <= contract.horizonOpenSkyRatioRange[1]
  );
  const horizonCrests = deterministicProfileA.layers.flatMap(
    (layer) => layer.map(({ crestHeight }) => crestHeight)
  );
  assert.ok(Math.max(...horizonCrests) >= contract.horizonMonumentalCrestRangeM[0]);
  const openSkySamples = deterministicProfileA.layers[0].filter(
    ({ monumentPulse }) => monumentPulse < 0.05
  ).length / contract.horizonSegments;
  assert.ok(openSkySamples >= contract.horizonOpenSkyRatioRange[0]);
  assert.notDeepEqual(
    world.createUltraHorizonProfile(1, ['meadow-island', 'prairie-bell-tower']),
    deterministicProfileA,
    'complete far-scenery identities must produce a distinct realm profile'
  );

  for (const marker of [
    'function setRenderQuality(id)',
    'function getRenderQualityDiagnostics()',
    'function dispose()',
    'ultraSkyDome.visible = ultraEnabled',
    'uniform.value = ultraEnabled ? 1 : 0',
    'zones[zoneIndex]?.atmosphere?.farScenery',
    "mapIndependent: true",
    "materialDetailMode: 'world-space-multiscale'",
    'uV23UltraWorldDetail',
    'uV23UltraCloudDetail'
  ]) {
    assert.ok(worldSource.includes(marker), `Ultra world contract is missing ${marker}`);
  }
  const horizonBuildStart = worldSource.indexOf('function createUltraHorizonReliefGeometry(');
  const horizonBuildEnd = worldSource.indexOf(
    'let ultraHorizonAnchorWorldX',
    horizonBuildStart
  );
  assert.ok(
    horizonBuildStart >= 0 && horizonBuildEnd > horizonBuildStart,
    'Ultra horizon construction must remain a reviewable source boundary'
  );
  const horizonBuildSource = worldSource.slice(horizonBuildStart, horizonBuildEnd);
  assert.match(horizonBuildSource, /new THREE\.MeshStandardMaterial\(\{/);
  assert.match(horizonBuildSource, /emissive:\s*0x00_0000,/);
  assert.match(horizonBuildSource, /emissiveIntensity:\s*0,/);
  assert.match(horizonBuildSource, /transparent:\s*false,/);
  assert.match(horizonBuildSource, /depthWrite:\s*true,/);
  assert.match(
    horizonBuildSource,
    /setAttribute\('neonV23NextHorizonColor', nextAttribute\)/
  );
  assert.match(horizonBuildSource, /morphAttributes\[attributeName\]\s*=\s*\[nextAttribute\]/);
  assert.doesNotMatch(horizonBuildSource, /morphAttributes\.color/);
  assert.match(horizonBuildSource, /attribute vec3 neonV23NextHorizonColor;/);
  assert.match(horizonBuildSource, /uniform float neonV23HorizonColorBlend;/);
  assert.match(
    horizonBuildSource,
    /vColor\s*=\s*mix\(\s*vColor,\s*neonV23NextHorizonColor,\s*clamp\(neonV23HorizonColorBlend,\s*0\.0,\s*1\.0\)\s*\);/
  );
  assert.match(horizonBuildSource, /geometry\.computeVertexNormals\(\);/);
  assert.doesNotMatch(horizonBuildSource, /new THREE\.MeshBasicMaterial/);
  assert.doesNotMatch(horizonBuildSource, /new THREE\.InstancedMesh/);

  const horizonUpdateStart = worldSource.indexOf('function updateUltraEnvironment(');
  const horizonUpdateEnd = worldSource.indexOf(
    '// A real sphere carries the distant candle-moon surface',
    horizonUpdateStart
  );
  assert.ok(
    horizonUpdateStart >= 0 && horizonUpdateEnd > horizonUpdateStart,
    'Ultra horizon update must remain a reviewable source boundary'
  );
  const horizonUpdateSource = worldSource.slice(horizonUpdateStart, horizonUpdateEnd);
  assert.doesNotMatch(
    horizonUpdateSource,
    /camera\.(?:position|rotation|quaternion|scale|up)\.(?:set|copy|add|sub|multiply|lerp|apply)/
  );
  assert.doesNotMatch(
    horizonUpdateSource,
    /camera\.(?:fov|aspect|near|far|zoom|focus|filmGauge|filmOffset)\s*=/
  );
  assert.doesNotMatch(horizonUpdateSource, /camera\.(?:lookAt|updateProjectionMatrix)\(/);
  assert.doesNotMatch(worldSource, /WORLD_ULTRA_PRESENTATION_CONTRACT[\s\S]*?new THREE\.(?:PointLight|SpotLight|DirectionalLight)/);
});

test('classified region and creature integration contracts freeze exact pools and distance gates', () => {
  const baseline = world.BASELINE_SCENERY_PRESENTATION_CONTRACT;
  assert.ok(Object.isFrozen(baseline));
  assert.equal(baseline.version, 2);
  assert.equal(baseline.familyCount, 30);
  assert.equal(baseline.familiesPerRealm, 5);
  assert.equal(baseline.implementation, 'original-ethereal-pilgrimage-closed-surfaces');
  assert.equal(baseline.topologyAuthority, 'measured-closed-buffer-geometry');
  assert.equal(baseline.minimumFinisherDetailsPerFamily, 2);
  assert.equal(baseline.opaqueMetalnessMaximum, 0);
  assert.equal(baseline.glassMaterialsAllowed, false);
  assert.equal(baseline.industrialSurfaceLanguageAllowed, false);
  assert.deepEqual([...baseline.forbiddenVisibleVocabulary], [
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
  ]);
  const twilightZone = configuredZones.find(({ id }) => id === 'twilight-valley');
  assert.equal(twilightZone.roadStyle.insetPattern, 'woven-wind-memory');
  assert.deepEqual(
    Array.from(twilightZone.atmosphere.farScenery),
    ['canyon-pilgrim-terraces', 'sunset-arch-chain']
  );
  const forbiddenConfiguredVocabulary = new RegExp(
    `(?:^|[-_])(?:${baseline.forbiddenVisibleVocabulary.join('|')})(?:$|[-_])`,
    'i'
  );
  for (const zone of configuredZones) {
    const configuredVisualIdentities = [
      ...Object.entries(zone.roadStyle)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [`roadStyle.${key}`, value]),
      ...zone.atmosphere.farScenery.map((value) => ['atmosphere.farScenery', value])
    ];
    for (const [field, value] of configuredVisualIdentities) {
      assert.doesNotMatch(
        value,
        forbiddenConfiguredVocabulary,
        `${zone.id}.${field} exposes forbidden modern production vocabulary`
      );
    }
  }
  assert.doesNotMatch(configSource, /speed-chevron|canyon-grandstand/);
  assert.deepEqual([...baseline.organicReplacementRoles], [
    'memory_water_basin',
    'wind_memory_petal',
    'pilgrimage_step_terrace',
    'pilgrimage_cape_veil',
    'constellation_orbit_thread'
  ]);
  assert.equal(baseline.transitionMotionEnvelopeM, 0.22);
  assert.equal(baseline.realmDetailIds.length, 6);
  assert.equal(new Set(baseline.realmDetailIds).size, 6);

  const region = world.REGION_SCENERY_INTEGRATION_CONTRACT;
  assert.ok(Object.isFrozen(region));
  assert.equal(region.version, 2);
  assert.deepEqual([...region.majorStationsM], [390, 1_290, 2_190]);
  assert.equal(region.addedFamilies, 48);
  assert.equal(region.addedRoots, 48);
  assert.equal(region.familiesPerRegion, 8);
  assert.equal(region.landmarksPerRegion, 3);
  assert.equal(region.environmentsPerRegion, 5);
  assert.deepEqual([...region.environmentOffsetsM], [28, 84, 140, 196, 252]);
  assert.equal(region.desktopBaselineAndRegionRoots, 90);
  assert.equal(region.mobileBaselineAndRegionRoots, 84);
  assert.equal(region.majorRoadGapM, 6);
  assert.equal(region.environmentRoadGapM, 3);
  assert.equal(region.peerEdgeGapM, 4);
  assert.equal(region.outwardSearchAttempts, 42);
  assert.equal(region.outwardSearchStepM, 4);
  assert.equal(region.airDeckClearanceM, 8);
  assert.equal(region.forwardMajorSurfaceM, 1_800);
  assert.equal(region.forwardOtherSurfaceM, 1_440);
  assert.equal(region.rearSurfaceRetentionM, 480);
  assert.equal(
    region.cameraResidencyAuthority,
    'read-only-render-camera-frustum-with-graph-origin'
  );
  assert.equal(region.cameraPrewarmPlaneMarginM, 320);
  assert.equal(region.cameraRetentionPlaneMarginM, 480);
  assert.equal(region.cameraFarHysteresisM, 480);
  assert.equal(region.cameraPlaneHysteresisM, 480);
  assert.equal(region.cameraExpandedPlaneCount, 6);
  assert.equal(region.cameraMinimumGraceMs, 1_800);
  assert.equal(region.visibleRootRebindAuthority, 'hide-one-frame-before-anchor-rebind');
  assert.equal(region.detailEnterM, 260);
  assert.equal(region.detailExitM, 340);
  assert.equal(region.detailFadeSeconds, 0.36);
  assert.equal(region.detailVisibilityBand, 'detail-hysteresis-260m-in-340m-out');
  assert.equal(region.nearVisibilityAuthority, 'render-space-bounds');
  assert.equal(region.adapterMetricsAuthority, 'real-three-buffer-geometry');
  assert.equal(region.transitionPreviewAuthority, 'transitionEligible-boolean');
  assert.equal(region.transitionPreviewLengthM, 72);
  assert.equal(region.transitionPreviewSegmentLengthM, 24);
  assert.deepEqual([...region.transitionPreviewCenterOffsetsM], [12, 36, 60]);
  assert.equal(region.legacyCreaturesEnabled, false);

  const terrainContact = world.SCENERY_TERRAIN_CONTACT_CONTRACT;
  assert.ok(Object.isFrozen(terrainContact));
  assert.equal(terrainContact.version, 1);
  assert.equal(
    terrainContact.terrainHeightAuthority,
    'runtime-rendered-triangulated-terrain-absolute-world-xz'
  );
  assert.equal(terrainContact.roadFrameHeightMayGroundScenery, false);
  assert.equal(terrainContact.visibleBoundsAuthority, 'complete-visible-three-bounds');
  assert.equal(terrainContact.groundedRootMode, 'terrain-grounded-visible-minimum');
  assert.equal(
    terrainContact.instancedGroundMode,
    'terrain-grounded-per-instance-visible-minimum'
  );
  assert.equal(terrainContact.designedAirborneMode, 'designed-airborne-terrain-relative');
  assert.equal(terrainContact.groundedBaselineFamilies, 30);
  assert.equal(terrainContact.groundedRegionFamilies, 36);
  assert.equal(terrainContact.designedAirborneRegionFamilies, 12);
  assert.equal(terrainContact.ambientCandleClusters, 6);
  assert.equal(terrainContact.designedAirborneMinimumDeckClearanceM, 8);
  assert.equal(terrainContact.contactToleranceM, 0.001);
  assert.equal(terrainContact.ambientCandleGroundingAuthority, 'per-instance-base-lowest-point');
  assert.equal(terrainContact.ambientFlameSeamMinimumM, -0.016);
  assert.equal(terrainContact.ambientFlameSeamMaximumM, 0.032);
  assert.equal(terrainContact.zeroFrameAssetAllocations, true);
  assert.deepEqual([...terrainContact.designedAirborneRegionFamilyIds], [
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

  const cameraClearance = world.WORLD_CAMERA_CLEARANCE_ENVELOPE_CONTRACT;
  assert.ok(Object.isFrozen(cameraClearance));
  assert.equal(cameraClearance.version, 1);
  assert.equal(cameraClearance.mapContractVersion, 2);
  assert.equal(
    cameraClearance.authority,
    'presented-root-complete-visible-bounds-with-motion-envelope'
  );
  assert.deepEqual([...cameraClearance.exactVerticalFields], [
    'absoluteMinY',
    'absoluteMaxY',
    'centerY',
    'halfHeightM'
  ]);
  assert.deepEqual([...cameraClearance.conservativeVerticalFields], [
    'cameraClearanceMinY',
    'cameraClearanceMaxY',
    'cameraClearanceCenterY',
    'cameraClearanceHalfHeightM'
  ]);
  assert.equal(cameraClearance.includesBaseline, true);
  assert.equal(cameraClearance.includesRegion, true);
  assert.equal(cameraClearance.includesAmbientCandlelight, true);
  assert.equal(cameraClearance.includesCreatures, true);
  assert.equal(cameraClearance.mapCompatibilityRadiusFieldPreserved, true);
  assert.equal(cameraClearance.updateAuthority, 'same-frame-as-object-pose');
  assert.equal(cameraClearance.frameAllocations, 0);

  const creatures = world.CREATURE_WORLD_INTEGRATION_CONTRACT;
  assert.ok(Object.isFrozen(creatures));
  assert.equal(creatures.familyCount, 18);
  assert.equal(creatures.pooledRoots, 54);
  assert.equal(creatures.mapRecordsPerRoot, 1);
  assert.equal(creatures.roadGapM, 6);
  assert.equal(creatures.deckClearanceM, 6);
  assert.equal(creatures.largeSpacingM, 120);
  assert.equal(creatures.clusterSpacingM, 45);
  assert.equal(creatures.minimumForwardM, 240);
  assert.equal(creatures.forwardSeconds, 3.2);
  assert.equal(creatures.wedgeMinimumM, 160);
  assert.equal(creatures.wedgeSeconds, 0.8);
  assert.equal(creatures.wedgeHalfAngleDegrees, 12);
  assert.equal(creatures.spawnMinimumM, 960);
  assert.equal(creatures.spawnMaximumM, 1_320);
  assert.equal(creatures.rearSurfaceRetentionM, 320);
  assert.equal(creatures.rearCameraMarginM, 64);
  assert.equal(
    creatures.cameraResidencyAuthority,
    'read-only-render-camera-frustum-with-graph-origin'
  );
  assert.equal(creatures.cameraPrewarmPlaneMarginM, 320);
  assert.equal(creatures.cameraRetentionPlaneMarginM, 480);
  assert.equal(creatures.cameraFarHysteresisM, 480);
  assert.equal(creatures.cameraPlaneHysteresisM, 480);
  assert.equal(creatures.cameraExpandedPlaneCount, 6);
  assert.equal(creatures.cameraMinimumGraceMs, 1_800);
  assert.equal(
    creatures.activeLifecycleAuthority,
    'acquire-forward-retire-complete-bounds-behind-unless-camera-relevant'
  );
  assert.equal(creatures.adjacentPreviewPolicy, 'adjacent-realm-preview-72m');
  assert.equal(creatures.adjacentPreviewLengthM, 72);
  assert.equal(creatures.adjacentPreviewSegmentLengthM, 24);
  assert.deepEqual([...creatures.adjacentPreviewBoundaryOffsetsM], [60, 36, 12]);
  assert.equal(creatures.sealedTunnelVisibleRoots, 0);
  assert.equal(creatures.legacyMantaEnabled, false);
  assert.equal(creatures.legacyDragonEnabled, false);

  for (const marker of [
    'RegionScenery.validateConfiguredZones(zones)',
    'Creatures.validateConfiguredZones(zones)',
    'V23 creature preview must share the configured world transition length and segmentation.',
    'Candlelight.validateZones(zones)',
    'V23 world visualSeed must be a string.',
    'sampleRenderedTerrainHeight(out.x, out.z)',
    'sceneryRootYForTerrain(item, candidate.terrainY)',
    'alignAmbientCandleTerrainContact(',
    'root.userData.regionMeasuredDrawGroups !== renderPlan.groups.length',
    'definition.preferredStationM !== REGION_MAJOR_STATIONS_M[familyOrdinal]',
    'definition.motifRepeat !== true',
    'sampleAbsoluteSceneryAnchor(s, lateral, graphFrameScratch)',
    'minimumGap: requiredRoadGapM',
    'centerDistance += SCENERY_OUTWARD_SEARCH_STEP_M',
    'item.userData.transitionEligible === true',
    'detail-hysteresis-260m-in-340m-out',
    'wind-memory-threads',
    'recessed-candle-star-carving',
    'woven-sail-canopy-petals',
    'SCENERY_FORWARD_MAJOR_SURFACE_M',
    'SCENERY_FORWARD_OTHER_SURFACE_M',
    'cameraPrewarmFrustumScratch.intersectsSphere(sphere)',
    'cameraRetentionFrustumScratch.intersectsSphere(sphere)',
    "authority: 'complete-road-capsule-query'",
    'sealedTunnel: false',
    "crossesRoad: definition.sceneLayer === 'air'",
    'highContrastLowAltitude',
    'bearingDegrees',
    'candlelightFactory.dispose()',
    'creatureFactory.dispose()'
  ]) {
    assert.ok(worldSource.includes(marker), `missing classified-world integration marker ${marker}`);
  }
  assert.match(
    worldSource,
    /const previewOffset = REALM_TRANSITION_PREVIEW_CENTER_OFFSETS_M\[previewSlot\]/
  );
  assert.match(
    worldSource,
    /const distanceFromBoundaryM = CREATURE_ADJACENT_PREVIEW_BOUNDARY_OFFSETS_M\[previewSlot\]/
  );
  assert.doesNotMatch(
    worldSource,
    /regionPanel(?:PartKinds|Component)|part\.panelCount|sail-canopy-panels/
  );
  assert.match(worldSource, /function regionWovenPetalComponent\(/);
  assert.match(worldSource, /isWovenPetal \? 0\.045 : 0\.10/);
  assert.match(worldSource, /geometry\.rotateY\(-angle \+ Math\.PI \/ 2\)/);
  assert.match(
    worldSource,
    /\(index % 2 \? -1 : 1\)[\s\S]*?isWovenPetal \? Number\(part\.clothFoldRatio\) \|\| 0\.16/
  );
  assert.doesNotMatch(worldSource, /adjacent-realm-preview-480m|previewOffset = 80 \+|400 - slot\.instanceIndex/);
  assert.match(worldSource, /sceneLayer: object\.userData\.sceneLayer/);
  assert.match(worldSource, /semanticRole: object\.userData\.semanticRole/);
  assert.match(worldSource, /mapPriority: Number\.isInteger\(object\.userData\.mapPriority\)/);
  assert.match(worldSource, /if \(!object\?\.isObject3D \|\| mapEntityByObject\.has\(object\)\)/);
  const cacheAnchorStart = worldSource.indexOf('function cacheSceneryAnchor(');
  const cacheAnchorEnd = worldSource.indexOf('function releaseCreatureSlot(', cacheAnchorStart);
  assert.ok(cacheAnchorStart >= 0 && cacheAnchorEnd > cacheAnchorStart);
  const cacheAnchorSource = worldSource.slice(cacheAnchorStart, cacheAnchorEnd);
  assert.match(cacheAnchorSource, /roadClearanceQuery\(\{/);
  assert.doesNotMatch(
    cacheAnchorSource,
    /sceneryPeerClearance|acceptSceneryPeer/,
    'transient visible peers must never rewrite or invalidate a static road/deck anchor'
  );
  assert.match(worldSource, /sceneryFrameCandidates\.sort\(compareSceneryCandidates\)/);
  assert.match(worldSource, /if \(!acceptSceneryPeer\(item, anchor\)\) continue;/);
  assert.match(worldSource, /candidate\.active = playerRelevant \|\| candidate\.cameraRelevant;/);
  assert.match(worldSource, /\(!slot\.cameraRelevant && \(/);
  assert.match(worldSource, /cameraVisible !== right\.cameraVisible/);
  assert.match(worldSource, /cameraSurfaceDistanceM - right\.cameraSurfaceDistanceM/);

  const cameraScratchStart = worldSource.indexOf('const cameraViewMatrixScratch =');
  const cameraMeasureEnd = worldSource.indexOf(
    '/** Measure the actual root surface around the ship',
    cameraScratchStart
  );
  assert.ok(cameraScratchStart >= 0 && cameraMeasureEnd > cameraScratchStart);
  const cameraResidencySource = worldSource.slice(cameraScratchStart, cameraMeasureEnd);
  for (const retainedType of ['Matrix4', 'Frustum', 'Sphere', 'Vector3']) {
    assert.match(
      cameraResidencySource,
      new RegExp(`new THREE\\.${retainedType}`),
      `camera residency must preallocate its ${retainedType}`
    );
  }
  const cameraPerFrameStart = cameraResidencySource.indexOf('function prepareCameraResidencyFrame(');
  assert.ok(cameraPerFrameStart >= 0);
  assert.doesNotMatch(
    cameraResidencySource.slice(cameraPerFrameStart),
    /new THREE\./,
    'camera residency frame and per-root tests must remain allocation-free'
  );
  assert.match(
    cameraResidencySource,
    /for \(const plane of cameraPrewarmFrustumScratch\.planes\)/
  );
  assert.match(
    cameraResidencySource,
    /for \(const plane of cameraRetentionFrustumScratch\.planes\)/
  );
  assert.match(
    cameraResidencySource,
    /plane\.constant \+= CAMERA_RELEVANCE_PREWARM_PLANE_MARGIN_M/
  );
  assert.match(
    cameraResidencySource,
    /plane\.constant \+= CAMERA_RELEVANCE_RETENTION_PLANE_MARGIN_M/
  );
  assert.match(cameraResidencySource, /nowMs \+ CAMERA_RELEVANCE_MINIMUM_GRACE_MS/);
  assert.match(worldSource, /candidate\.wasVisibleAtFrameStart && item\.userData\.worldAnchor/);
});

test('real Three fixed-seed construction grounds every non-airborne root and publishes Film envelopes', () => {
  const THREE = require(fileURLToPath(new URL(
    'vendor/three-0.160.0.min.js',
    PROJECT_ROOT
  )));
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousInfo = console.info;
  const previousWarn = console.warn;
  const gradient = { addColorStop() {} };
  const canvasContext = new Proxy({
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    measureText: () => ({ width: 10 })
  }, {
    get(target, key) {
      return key in target ? target[key] : () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    }
  });
  let layer = null;
  try {
    global.document = {
      createElement: () => ({
        width: 1,
        height: 1,
        getContext: () => canvasContext
      })
    };
    global.window = {
      THREE,
      location: { search: '?modelDebug=1' },
      innerWidth: 1_440,
      innerHeight: 900,
      devicePixelRatio: 1,
      navigator: { userAgent: 'node-world-construction-test' }
    };
    for (const relativePath of [
      'src/config/Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js',
      'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js',
      'src/weather/Neon_Autopilot_V23_HighSpeed_DroneHeat.weather.js',
      'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.region-scenery.js',
      'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.creatures.js',
      'src/entities/Neon_Autopilot_V23_HighSpeed_DroneHeat.candlelight.js',
      'src/world/Neon_Autopilot_V23_HighSpeed_DroneHeat.world.js'
    ]) {
      require(fileURLToPath(new URL(relativePath, PROJECT_ROOT)));
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(17.25, 13.5, -29.75);
    camera.rotation.set(0.12, -0.31, 0.04);
    camera.up.set(0.02, 0.999, -0.03).normalize();
    camera.fov = 63;
    camera.aspect = 16 / 9;
    camera.near = 0.15;
    camera.far = 1_800;
    camera.zoom = 1.08;
    camera.focus = 9;
    camera.filmGauge = 36;
    camera.filmOffset = 0.4;
    camera.updateProjectionMatrix();
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const cameraBeforeWorldCreation = cameraSnapshot(camera);
    const state = {
      distance: 1_300,
      speed: 300,
      themeOffset: 0,
      skyZoneIndex: 0,
      skyBlend: 0.37,
      activeDaylight: 0.72,
      activeStarOpacity: 0.28,
      running: true,
      paused: false,
      weather: {
        rain: 1,
        snow: 0,
        hail: 0,
        dust: 0,
        wind: 0.4,
        gust: 0.2,
        motionTimeSeconds: 0
      }
    };
    let sealedTunnel = false;
    const terrainHeightAt = (worldX, worldZ) => 2.4
      + Math.sin(worldX * 0.031) * 0.7
      + Math.cos(worldZ * 0.007) * 0.9;
    const sampleCommitted = (s, lateral, out = {}) => Object.assign(out, {
      x: lateral,
      // Deliberately model an elevated road so a regression to frame.y cannot pass the terrain-contact audit.
      y: 48 + Math.sin(s * 0.001) * 3,
      surfaceHeight: 48 + Math.sin(s * 0.001) * 3,
      z: -s,
      rightX: 1,
      rightY: 0,
      rightZ: 0,
      tangentX: 0,
      tangentY: 0,
      tangentZ: -1,
      yaw: 0,
      tunnelKind: sealedTunnel ? 'mountain-tunnel' : null,
      covered: sealedTunnel,
      underpassBlend: sealedTunnel ? 1 : 0
    });
    console.info = () => {};
    console.warn = () => {};
    layer = global.window.NeonV23World.createDecorationLayer({
      THREE,
      scene,
      state,
      roadCenterAt: () => 0,
      roadSlopeAt: () => 0,
      localZFromS: (s) => state.distance - s,
      sampleWorldFrameAtDistance: (s, out = {}) => sampleCommitted(s, 0, out),
      sampleCommittedWorldFrameAtDistance: sampleCommitted,
      sampleTerrainHeight: terrainHeightAt,
      getWorldRenderOrigin: (out = {}) => Object.assign(out, {
        x: 0,
        y: 0,
        z: -state.distance
      }),
      camera,
      branchSeparation: 12,
      groundSceneryExclusionHalfWidth: 9,
      groundSceneryGap: 1.2,
      roadClearanceQuery: () => ({ clear: true, clearance: 8 }),
      maximumDeckHeight: 9,
      zones: global.window.NeonV23Config.zones,
      quality: 'high',
      renderQualityId: 'high',
      zoneAtS: (s) => ((Math.floor(s / 2_700) % 6) + 6) % 6,
      visualSeed: 'world-real-construction-test',
      isReducedMotionEnabled: () => false
    });
    assert.deepEqual(
      cameraSnapshot(camera),
      cameraBeforeWorldCreation,
      'World construction mutated the runtime-owned camera'
    );

    const moonContract = global.window.NeonV23World.MOON_LIGHTING_CONTRACT;
    const moonAnchor = scene.getObjectByName('V23.Sky.MoonAnchor');
    const moonVisual = scene.getObjectByName('V23.Sky.CandleMoonMemoryLayers');
    const moonDisc = scene.getObjectByName('V23.Sky.CandleMoonDisc');
    const moonHalo = scene.getObjectByName('V23.Sky.CandleMoonHalo');
    const moonStarPetals = scene.getObjectByName('V23.Sky.MemoryStarPetals');
    const moonCloudVeils = scene.getObjectByName('V23.Sky.MemoryCloudVeils');
    assert.ok(moonAnchor && moonVisual && moonDisc && moonHalo && moonStarPetals && moonCloudVeils);
    assert.equal(moonVisual.children.length, moonContract.residentVisualObjectCount);
    assert.equal(moonDisc.geometry.type, 'SphereGeometry');
    assert.equal(moonDisc.isSprite, undefined);
    assert.equal(moonHalo.isSprite, true);
    assert.equal(moonStarPetals.isInstancedMesh, true);
    assert.equal(moonStarPetals.count, moonContract.memoryStarPetalInstanceCount);
    assert.equal(moonCloudVeils.isInstancedMesh, true);
    assert.equal(moonCloudVeils.count, moonContract.cloudVeilInstanceCount);
    let moonLocalLightCount = 0;
    moonAnchor.traverse((object) => {
      if (object.isLight) moonLocalLightCount++;
    });
    assert.equal(moonLocalLightCount, moonContract.createsLocalLightCount);

    assert.equal(layer.clearanceReport.regionMajorRoots, 18);
    assert.equal(layer.clearanceReport.regionEnvironmentRoots, 30);
    assert.equal(layer.clearanceReport.regionAdapterDrawGroups, 144);
    assert.ok(layer.clearanceReport.regionAdapterTriangles > 0);
    assert.equal(layer.clearanceReport.regionAdapterPartKindCount, 33);
    assert.ok(layer.clearanceReport.regionAdapterPartKinds.includes('wind-memory-threads'));
    assert.ok(
      layer.clearanceReport.regionAdapterPartKinds.includes('recessed-candle-star-carving')
    );
    assert.ok(
      layer.clearanceReport.regionAdapterPartKinds.includes('woven-sail-canopy-petals')
    );
    assert.equal(layer.clearanceReport.ambientCandlelightRoots, 6);
    assert.equal(layer.clearanceReport.creaturePoolRoots, 54);
    assert.equal(layer.getMapEntities().entities.length, 150);
    assert.equal(layer.topologyReport.filter(({ isClosed }) => !isClosed).length, 0);
    const dormantLegacyScenery = scene.children.filter(({ userData }) => userData?.kind === 'zoneModel');
    assert.equal(dormantLegacyScenery.length, 42);
    assert.ok(
      dormantLegacyScenery.every(({ visible }) => visible === false),
      'unpositioned six-realm scenery must stay out of the first compile/render pass'
    );
    const baselineContract = global.window.NeonV23World.BASELINE_SCENERY_PRESENTATION_CONTRACT;
    const baselineFamilies = new Map();
    const baselineVisibleSemantics = [];
    const baselineVisibleRoles = new Set();
    const memoryWaterBasins = [];
    const windMemoryPetals = [];
    const pilgrimageSteps = [];
    const pilgrimageCapeVeils = [];
    for (const root of dormantLegacyScenery) {
      baselineFamilies.set(root.userData.zoneFamily, root);
      baselineVisibleSemantics.push(root.userData.zoneFamily);
      assert.equal(root.userData.baselineImplementationVersion, 2);
      assert.equal(
        root.userData.baselineImplementationContract,
        'original-ethereal-pilgrimage-closed-surfaces'
      );
      assert.ok(root.userData.baselineFinisherDetailCount >= 2);
      let measuredFinisherDetails = 0;
      root.traverse((object) => {
        if (!object.isMesh) return;
        const role = object.userData.neonV23?.role;
        if (typeof role === 'string') {
          baselineVisibleRoles.add(role);
          baselineVisibleSemantics.push(role);
        }
        if (role === 'memory_water_basin') memoryWaterBasins.push(object);
        if (role === 'wind_memory_petal') windMemoryPetals.push(object);
        if (role === 'pilgrimage_step_terrace') pilgrimageSteps.push(object);
        if (role === 'pilgrimage_cape_veil') pilgrimageCapeVeils.push(object);
        if (object.userData.baselineFinisherDetail) measuredFinisherDetails++;
        if (Number.isFinite(object.material?.metalness)) {
          assert.ok(object.material.metalness <= 0);
        }
        assert.notEqual(object.material?.userData?.neonV23?.kind, 'glass');
      });
      assert.equal(measuredFinisherDetails, root.userData.baselineFinisherDetailCount);
      assert.ok(root.userData.effectiveHorizontalRadiusM >= root.userData.horizontalRadius);
      assert.equal(
        root.userData.motionEnvelopeClearanceAuthority,
        'measured-horizontal-radius-plus-motion-envelope'
      );
    }
    assert.equal(baselineFamilies.size, 30);
    assert.ok(baselineFamilies.has('twilight-pilgrim-terraces'));
    assert.ok(baselineFamilies.has('ascending-memory-court'));
    const forbiddenBaselineVocabulary = new RegExp(
      baselineContract.forbiddenVisibleVocabulary.join('|'),
      'i'
    );
    assert.doesNotMatch(
      baselineVisibleSemantics.join(' '),
      forbiddenBaselineVocabulary,
      'baseline family/mesh semantics exposed a forbidden modern production term'
    );
    for (const role of baselineContract.organicReplacementRoles) {
      assert.ok(baselineVisibleRoles.has(role), `missing organic baseline replacement ${role}`);
    }
    assert.ok(memoryWaterBasins.length >= 1);
    assert.ok(memoryWaterBasins.every((mesh) => (
      mesh.userData.baselineOrganicProfile === 'returning-six-ring-memory-basin'
      && mesh.userData.baselineOrganicProfilePointCount === 6
    )));
    assert.ok(windMemoryPetals.length >= 2);
    assert.ok(windMemoryPetals.every((mesh) => (
      mesh.userData.baselineOrganicContour === 'soft-nine-point-wind-petal'
      && mesh.userData.baselineOrganicContourPointCount === 9
    )));
    assert.ok(pilgrimageSteps.length >= 4);
    assert.ok(pilgrimageSteps.every((mesh) => (
      mesh.userData.baselineOrganicContour === 'weathered-eight-point-pilgrimage-step'
      && mesh.userData.baselineOrganicContourPointCount === 8
    )));
    assert.ok(pilgrimageCapeVeils.length >= 1);
    assert.ok(pilgrimageCapeVeils.every((mesh) => (
      mesh.userData.baselineOrganicContour === 'soft-nine-point-pilgrimage-cape'
      && mesh.userData.baselineOrganicContourPointCount === 9
    )));
    const transitionBaselineRoots = dormantLegacyScenery.filter(
      ({ userData }) => userData.transitionPreview
    );
    assert.equal(transitionBaselineRoots.length, 6);
    assert.ok(transitionBaselineRoots.every(({ userData }) => (
      userData.motionEnvelopeM === 0.22
        && Math.abs(
          userData.effectiveHorizontalRadiusM - userData.horizontalRadius - 0.22
        ) <= 0.000_001
    )));

    const ultraContract = global.window.NeonV23World.WORLD_ULTRA_PRESENTATION_CONTRACT;
    const ultraHorizonGroups = scene.children
      .filter(({ name }) => /^V23\.World\.UltraHorizon\.\d+$/.test(name))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.equal(ultraHorizonGroups.length, ultraContract.horizonZoneCount);
    const ultraHorizonMeshes = [];
    const ultraHorizonIdentities = [];
    const ultraHorizonProfileSignatures = new Set();
    for (const [zoneIndex, group] of ultraHorizonGroups.entries()) {
      const meshes = [];
      let instancedMeshCount = 0;
      let lightCount = 0;
      group.traverse((object) => {
        if (object.isInstancedMesh) instancedMeshCount++;
        if (object.isMesh) meshes.push(object);
        if (object.isLight) lightCount++;
      });
      assert.equal(meshes.length, ultraContract.horizonMeshesPerZone);
      assert.equal(instancedMeshCount, ultraContract.horizonInstancesPerZone);
      assert.equal(lightCount, 0);

      const [mesh] = meshes;
      ultraHorizonMeshes.push(mesh);
      assert.equal(Boolean(mesh.isInstancedMesh), false);
      assert.equal(Array.isArray(mesh.material), false);
      assert.equal(mesh.material.isMeshStandardMaterial, true);
      assert.equal(mesh.material.emissive.getHex(), 0);
      assert.equal(Number(mesh.material.emissiveIntensity) || 0, 0);
      assert.equal(mesh.material.toneMapped, true);
      assert.equal(mesh.material.transparent, false);
      assert.equal(mesh.material.opacity, 1);
      assert.equal(mesh.material.depthWrite, true);
      assert.equal(mesh.castShadow, false);
      assert.equal(mesh.receiveShadow, true);
      assert.ok(mesh.geometry.groups.length <= 1);
      const colorBlendUniform = mesh.material.userData.neonV23HorizonColorBlend;
      assert.ok(colorBlendUniform);
      assert.equal(colorBlendUniform.value, 0);
      const webgl1Shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader
      };
      assert.doesNotThrow(() => {
        mesh.material.onBeforeCompile(webgl1Shader, {
          capabilities: { isWebGL2: false }
        });
      }, `zone ${zoneIndex} horizon shader injection failed on the WebGL1 path`);
      assert.strictEqual(
        webgl1Shader.uniforms.neonV23HorizonColorBlend,
        colorBlendUniform
      );
      assert.match(
        webgl1Shader.vertexShader,
        /attribute vec3 neonV23NextHorizonColor;/
      );
      assert.match(
        webgl1Shader.vertexShader,
        /uniform float neonV23HorizonColorBlend;/
      );
      assert.match(
        webgl1Shader.vertexShader,
        /vColor\s*=\s*mix\(\s*vColor,\s*neonV23NextHorizonColor,\s*clamp\(neonV23HorizonColorBlend,\s*0\.0,\s*1\.0\)\s*\);/
      );

      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      assert.ok(position);
      assert.ok(normal);
      assert.equal(normal.count, position.count);
      assert.equal(position.count / 3, ultraContract.horizonTrianglesPerZone);
      for (let normalIndex = 0; normalIndex < normal.count; normalIndex++) {
        const nx = normal.getX(normalIndex);
        const ny = normal.getY(normalIndex);
        const nz = normal.getZ(normalIndex);
        assert.ok(
          Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz),
          `zone ${zoneIndex} horizon normal ${normalIndex} is non-finite`
        );
        const normalLength = Math.hypot(nx, ny, nz);
        assert.ok(
          normalLength >= 0.999 && normalLength <= 1.001,
          `zone ${zoneIndex} horizon normal ${normalIndex} is not normalized`
        );
      }

      const metadata = mesh.geometry.userData.neonV23Horizon;
      assert.ok(metadata);
      assert.equal(metadata.segmentCount, ultraContract.horizonSegments);
      assert.equal(metadata.layerRanges.length, ultraContract.horizonDepthLayerCount);
      let expectedStartVertex = 0;
      let previousMinimumRadius = Number.NEGATIVE_INFINITY;
      let previousMaximumRadius = Number.NEGATIVE_INFINITY;
      for (const [layerIndex, range] of metadata.layerRanges.entries()) {
        assert.equal(range.layerIndex, layerIndex);
        assert.equal(range.startVertex, expectedStartVertex);
        assert.equal(
          range.vertexCount,
          ultraContract.horizonSegments * 3 * 2 * 3,
          `zone ${zoneIndex} layer ${layerIndex} lost its three continuous relief strips`
        );
        assert.ok(Number.isFinite(range.minimumRadius));
        assert.ok(Number.isFinite(range.maximumRadius));
        assert.ok(Number.isFinite(range.minimumY));
        assert.ok(Number.isFinite(range.maximumY));
        assert.ok(range.minimumRadius < range.maximumRadius);
        assert.ok(range.minimumY < range.maximumY);
        assert.ok(range.minimumRadius > previousMinimumRadius);
        assert.ok(range.maximumRadius > previousMaximumRadius);

        let measuredMinimumRadius = Number.POSITIVE_INFINITY;
        let measuredMaximumRadius = Number.NEGATIVE_INFINITY;
        let measuredMinimumY = Number.POSITIVE_INFINITY;
        let measuredMaximumY = Number.NEGATIVE_INFINITY;
        const endVertex = range.startVertex + range.vertexCount;
        for (let vertexIndex = range.startVertex; vertexIndex < endVertex; vertexIndex++) {
          const x = position.getX(vertexIndex);
          const y = position.getY(vertexIndex);
          const z = position.getZ(vertexIndex);
          assert.ok(
            Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
            `zone ${zoneIndex} layer ${layerIndex} contains a non-finite vertex`
          );
          const radius = Math.hypot(x, z);
          measuredMinimumRadius = Math.min(measuredMinimumRadius, radius);
          measuredMaximumRadius = Math.max(measuredMaximumRadius, radius);
          measuredMinimumY = Math.min(measuredMinimumY, y);
          measuredMaximumY = Math.max(measuredMaximumY, y);
        }
        assert.ok(Math.abs(measuredMinimumRadius - range.minimumRadius) <= 0.001);
        assert.ok(Math.abs(measuredMaximumRadius - range.maximumRadius) <= 0.001);
        assert.ok(Math.abs(measuredMinimumY - range.minimumY) <= 0.001);
        assert.ok(Math.abs(measuredMaximumY - range.maximumY) <= 0.001);
        assert.equal(
          range.profileSignature.split(':').length,
          ultraContract.horizonSegments
        );
        const quantizedProfile = range.profileSignature.split(':').map(Number);
        assert.ok(
          new Set(quantizedProfile).size >= Math.ceil(ultraContract.horizonSegments * 0.75),
          `zone ${zoneIndex} layer ${layerIndex} repeats too few crest heights`
        );
        for (let period = 1; period <= Math.floor(ultraContract.horizonSegments / 4); period++) {
          assert.ok(
            quantizedProfile.some((height, index) => (
              height !== quantizedProfile[(index + period) % quantizedProfile.length]
            )),
            `zone ${zoneIndex} layer ${layerIndex} repeats with a ${period}-segment period`
          );
        }
        assert.equal(ultraHorizonProfileSignatures.has(range.profileSignature), false);
        ultraHorizonProfileSignatures.add(range.profileSignature);
        expectedStartVertex = endVertex;
        previousMinimumRadius = range.minimumRadius;
        previousMaximumRadius = range.maximumRadius;
      }
      assert.equal(expectedStartVertex, position.count);
      ultraHorizonIdentities.push({
        group,
        mesh,
        geometry: mesh.geometry,
        material: mesh.material,
        position,
        normal,
        color: mesh.geometry.getAttribute('color'),
        nextColor: mesh.geometry.getAttribute('neonV23NextHorizonColor'),
        colorBlendUniform,
        webgl1Shader,
        positionArray: position.array
      });
    }
    assert.equal(
      ultraHorizonProfileSignatures.size,
      ultraContract.horizonZoneCount * ultraContract.horizonDepthLayerCount
    );
    const initialHorizonDiagnostics = layer.getRenderQualityDiagnostics();
    assert.equal(initialHorizonDiagnostics.activeQuality, 'high');
    assert.equal(initialHorizonDiagnostics.ultraEnabled, true);
    assert.equal(initialHorizonDiagnostics.horizonGroupCount, 6);
    assert.equal(initialHorizonDiagnostics.horizonResidentMeshCount, 6);
    assert.equal(initialHorizonDiagnostics.horizonInstancedMeshCount, 0);
    assert.equal(initialHorizonDiagnostics.horizonMorphTargetCount, 6);
    assert.equal(initialHorizonDiagnostics.horizonProfileSignatureCount, 18);
    assert.equal(initialHorizonDiagnostics.horizonEmissiveViolationCount, 0);
    assert.equal(initialHorizonDiagnostics.horizonVisibleDrawGroupCount, 0);

    for (const [index, identity] of ultraHorizonIdentities.entries()) {
      const nextIdentity = ultraHorizonIdentities[(index + 1) % ultraHorizonIdentities.length];
      assert.equal(identity.geometry.morphTargetsRelative, false);
      assert.strictEqual(identity.geometry.morphAttributes.position[0], nextIdentity.position);
      assert.strictEqual(identity.geometry.morphAttributes.normal[0], nextIdentity.normal);
      assert.equal(identity.geometry.morphAttributes.color, undefined);
      assert.strictEqual(identity.nextColor, nextIdentity.color);
      assert.equal(identity.mesh.morphTargetInfluences.length, 1);
      assert.equal(identity.mesh.morphTargetInfluences[0], 0);
      assert.equal(identity.colorBlendUniform.value, 0);
    }

    layer.updateDecoration(1_000, { sunIntensity: 2, ambientIntensity: 1 });
    assert.deepEqual(
      cameraSnapshot(camera),
      cameraBeforeWorldCreation,
      'World update mutated the runtime-owned camera'
    );
    let horizonDiagnostics = layer.getRenderQualityDiagnostics();
    assert.equal(horizonDiagnostics.visibleHorizonGroupCount, 1);
    assert.equal(
      horizonDiagnostics.horizonVisibleDrawGroupCount,
      ultraContract.horizonMaximumVisibleDrawGroups
    );
    assert.ok(Math.abs(horizonDiagnostics.horizonMorphWeight - state.skyBlend) <= 0.000_001);
    assert.equal(horizonDiagnostics.horizonWorldBaseY, 0);
    const visibleHorizonGroups = ultraHorizonGroups.filter(({ visible }) => visible);
    assert.equal(visibleHorizonGroups.length, 1);
    assert.ok(visibleHorizonGroups.every(({ position }) => position.y === 0));
    const activeHorizonMesh = visibleHorizonGroups[0].children.find(({ isMesh }) => isMesh);
    assert.ok(
      Math.abs(activeHorizonMesh.morphTargetInfluences[0] - state.skyBlend) <= 0.000_001
    );
    const activeHorizonIdentity = ultraHorizonIdentities.find(
      ({ mesh }) => mesh === activeHorizonMesh
    );
    assert.ok(activeHorizonIdentity);
    assert.equal(activeHorizonIdentity.colorBlendUniform.value, state.skyBlend);
    assert.equal(
      activeHorizonIdentity.webgl1Shader.uniforms.neonV23HorizonColorBlend.value,
      state.skyBlend
    );

    layer.setRenderQuality('low');
    horizonDiagnostics = layer.getRenderQualityDiagnostics();
    assert.equal(horizonDiagnostics.ultraEnabled, false);
    assert.equal(horizonDiagnostics.visibleHorizonGroupCount, 0);
    assert.equal(horizonDiagnostics.horizonVisibleDrawGroupCount, 0);
    assert.ok(ultraHorizonGroups.every(({ visible }) => visible === false));

    camera.position.y += 31;
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const elevatedCameraSnapshot = cameraSnapshot(camera);
    state.skyBlend = 0.73;
    layer.setRenderQuality('high');
    assert.deepEqual(
      cameraSnapshot(camera),
      elevatedCameraSnapshot,
      'High horizon restoration mutated the elevated runtime-owned camera'
    );
    horizonDiagnostics = layer.getRenderQualityDiagnostics();
    assert.equal(horizonDiagnostics.ultraEnabled, true);
    assert.equal(horizonDiagnostics.visibleHorizonGroupCount, 1);
    assert.ok(
      horizonDiagnostics.horizonVisibleDrawGroupCount
        <= ultraContract.horizonMaximumVisibleDrawGroups
    );
    assert.ok(Math.abs(horizonDiagnostics.horizonMorphWeight - state.skyBlend) <= 0.000_001);
    const restoredHorizonMesh = ultraHorizonGroups
      .find(({ visible }) => visible)
      ?.children.find(({ isMesh }) => isMesh);
    const restoredHorizonIdentity = ultraHorizonIdentities.find(
      ({ mesh }) => mesh === restoredHorizonMesh
    );
    assert.ok(restoredHorizonIdentity);
    assert.equal(restoredHorizonIdentity.mesh.morphTargetInfluences[0], state.skyBlend);
    assert.equal(restoredHorizonIdentity.colorBlendUniform.value, state.skyBlend);
    assert.equal(
      restoredHorizonIdentity.webgl1Shader.uniforms.neonV23HorizonColorBlend.value,
      state.skyBlend
    );
    assert.ok(
      ultraHorizonGroups.filter(({ visible }) => visible).every(({ position }) => position.y === 0),
      'Ultra horizon world Y followed the elevated camera'
    );
    for (const [index, identity] of ultraHorizonIdentities.entries()) {
      assert.strictEqual(ultraHorizonGroups[index], identity.group);
      assert.strictEqual(ultraHorizonMeshes[index], identity.mesh);
      assert.strictEqual(ultraHorizonMeshes[index].geometry, identity.geometry);
      assert.strictEqual(ultraHorizonMeshes[index].material, identity.material);
      assert.strictEqual(
        ultraHorizonMeshes[index].geometry.getAttribute('position'),
        identity.position
      );
      assert.strictEqual(
        ultraHorizonMeshes[index].geometry.getAttribute('position').array,
        identity.positionArray
      );
    }

    assert.ok(layer.clearanceReport.weatherRainDrawCount > 0);
    assert.equal(layer.clearanceReport.weatherRainLocalExposure, 1);
    assert.equal(layer.clearanceReport.weatherRainDistantExposure, 1);
    assert.ok(dormantLegacyScenery.some(({ visible }) => visible === true));
    assert.equal(
      layer.clearanceReport.creatureVisibleRoots,
      8,
      'Adjacent-realm roots must stay absent until the final 72m transition instead of previewing 480m early'
    );
    assert.ok(layer.clearanceReport.creatureMinimumForwardReadM >= 960);
    assert.ok(layer.clearanceReport.creatureMinimumDeckClearanceM >= 6);
    assert.ok(layer.clearanceReport.sceneryAnchorMinRoadGap >= 3);
    assert.ok(layer.clearanceReport.sceneryPeerMinimumGapM >= 4);

    const dawnAirRoot = scene.children
      .filter((object) => (
        object.userData?.active === true
        && object.userData?.creatureRealmId === 'dawn-isle'
        && object.userData?.sceneLayer === 'air'
      ))
      .sort((left, right) => (
        Math.abs(-left.position.z - 960) - Math.abs(-right.position.z - 960)
      ))[0];
    assert.ok(dawnAirRoot?.visible);
    const dawnAirPresentationSeed = dawnAirRoot.userData.presentationSeed;
    const dawnAirInitialZ = dawnAirRoot.position.z;
    const dawnAirAnchorS = state.distance - dawnAirInitialZ;
    assert.ok(Math.abs(-dawnAirInitialZ - 960) <= 1);
    const dawnAirMapRecord = layer.getMapEntities().entities.find((record) => (
      record.visible
      && record.category === 'creature-ambient'
      && record.family === dawnAirRoot.userData.creatureFamilyId
      && Math.abs(record.z + dawnAirAnchorS) <= 0.000_001
    ));
    assert.ok(dawnAirMapRecord);

    const environment = scene.children
      .filter((object) => (
        object.visible
        && object.userData?.semanticRole === 'environment-cluster'
        && object.userData?.regionSceneryRealmId === 'dawn-isle'
        && object.userData?.worldAnchor
      ))
      .sort((left, right) => (
        left.userData.worldAnchor.s - right.userData.worldAnchor.s
      ))[0];
    assert.ok(environment);
    const environmentAnchor = environment.userData.worldAnchor;
    const environmentAnchorS = environmentAnchor.s;
    const environmentMapRecord = layer.getMapEntities().entities.find((record) => (
      record.visible
      && record.category === 'environment'
      && Math.abs(record.x - environmentAnchor.x) <= 0.000_001
      && Math.abs(record.z - environmentAnchor.z) <= 0.000_001
    ));
    assert.ok(environmentMapRecord);
    const environmentMapAnchorPose = {
      x: environmentMapRecord.x,
      y: environmentMapRecord.y,
      z: environmentMapRecord.z,
      heading: environmentMapRecord.heading,
      anchorEpoch: environmentMapRecord.anchorEpoch
    };

    const major = scene.children.find((object) => (
      object.userData?.semanticRole === 'landmark-major'
      && object.userData?.preferredStationM === 2_190
      && object.userData?.regionSceneryRealmId === 'dawn-isle'
    ));
    assert.ok(major?.visible);
    const silhouette = major.children.find(
      ({ userData }) => userData.regionVisibilityBand === 'silhouette-and-detail'
    );
    const details = major.children.filter(
      ({ userData }) => userData.regionVisibilityBand === 'detail-hysteresis-260m-in-340m-out'
    );
    assert.equal(silhouette.visible, true);
    assert.ok(details.length >= 1);
    assert.ok(details.every(({ visible }) => visible === false));
    assert.equal(silhouette.material.fog, false);

    // Film may put the real camera beside a landmark while the player remains outside the 260/340m detail band.
    // Detail follows the nearest camera/ship surface with fading; root, map pose, route, and player stay unchanged.
    const defaultCameraPosition = camera.position.clone();
    const defaultCameraQuaternion = camera.quaternion.clone();
    const defaultCameraFar = camera.far;
    const majorAnchor = major.userData.worldAnchor;
    const majorCameraTarget = new THREE.Vector3(
      majorAnchor.x,
      majorAnchor.y + (major.userData.localMinY + major.userData.localMaxY) * 0.5,
      majorAnchor.z + state.distance
    );
    camera.position.set(
      majorCameraTarget.x,
      majorCameraTarget.y + 30,
      majorCameraTarget.z + 120
    );
    camera.lookAt(majorCameraTarget);
    // Runtime may publish renderer matrices later; residency must consume the settled live pose without changing it.
    const nearLandmarkPosition = camera.position.toArray();
    const nearLandmarkQuaternion = camera.quaternion.toArray();
    layer.updateDecoration(1_100, { sunIntensity: 2, ambientIntensity: 1 });
    assert.deepEqual(camera.position.toArray(), nearLandmarkPosition);
    assert.deepEqual(camera.quaternion.toArray(), nearLandmarkQuaternion);
    assert.equal(major.userData.worldAnchor, majorAnchor);
    assert.equal(major.visible, true);
    assert.ok(details.every(({ visible }) => visible === true));
    assert.ok(details.every(({ material }) => material.opacity > 0 && material.opacity < 1));
    assert.equal(major.userData.regionDetailEngaged, true);
    assert.ok(layer.clearanceReport.cameraRelevantSceneryRoots >= 1);

    camera.position.set(
      majorCameraTarget.x,
      majorCameraTarget.y + 30,
      majorCameraTarget.z + 420
    );
    camera.lookAt(majorCameraTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    layer.updateDecoration(1_200, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(major.userData.worldAnchor, majorAnchor);
    assert.equal(major.visible, true);
    assert.ok(details.every(({ visible }) => visible === false));
    assert.equal(major.userData.regionDetailEngaged, false);

    camera.position.copy(defaultCameraPosition);
    camera.quaternion.copy(defaultCameraQuaternion);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);

    // Forward readability proves acquisition only: a 300m/s root must keep the same world anchor as it approaches.
    state.distance += 50;
    layer.updateDecoration(1_500, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(dawnAirRoot.userData.active, true);
    assert.equal(dawnAirRoot.visible, true);
    assert.equal(dawnAirRoot.userData.presentationSeed, dawnAirPresentationSeed);
    assert.ok(Math.abs(dawnAirRoot.position.z - (dawnAirInitialZ + 50)) <= 0.000_001);
    assert.ok(Math.abs(state.distance - dawnAirRoot.position.z - dawnAirAnchorS) <= 0.000_001);
    assert.equal(dawnAirMapRecord.visible, true);
    assert.ok(Math.abs(dawnAirMapRecord.z + dawnAirAnchorS) <= 0.000_001);

    // Repeated environments retain one measured anchor through the old 92..110m disappearance window.
    state.distance = environmentAnchorS + 93;
    layer.updateDecoration(2_000, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, true);
    assert.equal(environment.userData.worldAnchor, environmentAnchor);

    state.distance = environmentAnchorS + 109;
    layer.updateDecoration(2_500, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, true);
    assert.equal(environment.userData.worldAnchor, environmentAnchor);

    // Non-zero lateral distance must not retire the physical root before the real 480m rear surface boundary.
    const environmentRadiusM = environment.userData.effectiveHorizontalRadiusM;
    const environmentSurfaceBoundaryBehindM = Math.sqrt(Math.max(
      0,
      (480 + environmentRadiusM) ** 2 - environment.position.x ** 2
    ));
    state.distance = environmentAnchorS + environmentSurfaceBoundaryBehindM - 0.1;
    layer.updateDecoration(2_600, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, true);
    assert.equal(environment.userData.worldAnchor, environmentAnchor);

    state.distance = environmentAnchorS + environmentSurfaceBoundaryBehindM + 0.1;
    const environmentCameraTarget = new THREE.Vector3(
      environmentAnchor.x,
      environmentAnchor.y
        + (environment.userData.localMinY + environment.userData.localMaxY) * 0.5,
      environmentAnchor.z + state.distance
    );
    camera.position.set(0, environmentCameraTarget.y + 24, 0);
    camera.lookAt(environmentCameraTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    layer.updateDecoration(2_700, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, true);
    assert.equal(environment.userData.worldAnchor, environmentAnchor);
    assert.ok(layer.clearanceReport.cameraRelevantSceneryRoots >= 1);
    assert.equal(environmentMapRecord.visible, true);
    assert.deepEqual({
      x: environmentMapRecord.x,
      y: environmentMapRecord.y,
      z: environmentMapRecord.z,
      heading: environmentMapRecord.heading,
      anchorEpoch: environmentMapRecord.anchorEpoch
    }, environmentMapAnchorPose);

    // Leaving the 480m six-plane retention volume preserves the old anchor for 1.8s. After grace expires, it first
    // hides for one complete frame and only then may the pool bind the next 280m motif.
    const environmentVerticalHalfM = Math.abs(
      environment.userData.localMaxY - environment.userData.localMinY
    ) * 0.5 + environment.userData.motionEnvelopeM;
    const environmentCameraRadiusM = Math.hypot(environmentRadiusM, environmentVerticalHalfM);
    camera.position.set(
      environmentCameraTarget.x,
      environmentCameraTarget.y,
      environmentCameraTarget.z + camera.far + environmentCameraRadiusM + 480 + 2
    );
    camera.lookAt(environmentCameraTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    layer.updateDecoration(2_750, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, true);
    assert.equal(environment.userData.worldAnchor, environmentAnchor);
    layer.updateDecoration(4_551, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, false);
    assert.equal(environment.userData.worldAnchor, environmentAnchor);
    assert.ok(layer.clearanceReport.visibleRootRebindDeferrals >= 1);
    layer.updateDecoration(4_552, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(environment.visible, true);
    assert.notEqual(environment.userData.worldAnchor, environmentAnchor);
    const environmentRebindAdvanceM = environment.userData.worldAnchor.s - environmentAnchorS;
    assert.ok(environmentRebindAdvanceM >= 280);
    assert.ok(Math.abs(environmentRebindAdvanceM % 280) <= 0.000_001);
    assert.equal(environmentMapRecord.visible, true);
    assert.notEqual(environmentMapRecord.z, environmentMapAnchorPose.z);
    camera.position.copy(defaultCameraPosition);
    camera.quaternion.copy(defaultCameraQuaternion);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);

    // Crossing the craft is not a lifecycle boundary; the complete root remains until its rear surface clears retention.
    state.distance = dawnAirAnchorS + 100;
    layer.updateDecoration(5_000, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(dawnAirRoot.userData.active, true);
    assert.equal(dawnAirRoot.visible, true);
    assert.equal(dawnAirRoot.userData.presentationSeed, dawnAirPresentationSeed);
    assert.ok(Math.abs(dawnAirRoot.position.z - 100) <= 0.000_001);
    assert.ok(Math.abs(state.distance - dawnAirRoot.position.z - dawnAirAnchorS) <= 0.000_001);
    assert.equal(dawnAirMapRecord.visible, true);
    assert.ok(Math.abs(dawnAirMapRecord.z + dawnAirAnchorS) <= 0.000_001);

    // Exercise both sides of the complete-bounds retirement boundary and reject a stale visible map pose.
    const dawnEffectiveRadiusM = dawnAirRoot.userData.effectiveHorizontalRadiusM;
    const dawnRetirementSurfaceM = 320 + 64 + dawnEffectiveRadiusM;
    const dawnRetirementBehindM = Math.sqrt(Math.max(
      0,
      dawnRetirementSurfaceM ** 2 - dawnAirRoot.position.x ** 2
    ));
    state.distance = dawnAirAnchorS + dawnRetirementBehindM - 0.1;
    layer.updateDecoration(5_200, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(dawnAirRoot.userData.active, true);
    assert.equal(dawnAirRoot.userData.presentationSeed, dawnAirPresentationSeed);
    assert.equal(dawnAirMapRecord.visible, true);
    assert.ok(Math.abs(dawnAirMapRecord.z + dawnAirAnchorS) <= 0.000_001);

    state.distance = dawnAirAnchorS + dawnRetirementBehindM + 0.1;
    const creatureVerticalHalfM = Math.abs(
      dawnAirRoot.userData.localMaxY - dawnAirRoot.userData.localMinY
    ) * 0.5 + dawnAirRoot.userData.motionEnvelopeM;
    const creatureCameraRadiusM = Math.hypot(
      dawnAirRoot.userData.effectiveHorizontalRadiusM,
      creatureVerticalHalfM
    );
    const creatureCameraTarget = new THREE.Vector3(
      dawnAirRoot.position.x,
      dawnAirRoot.position.y
        + (dawnAirRoot.userData.localMinY + dawnAirRoot.userData.localMaxY) * 0.5,
      state.distance - dawnAirAnchorS
    );
    camera.far = 100;
    camera.updateProjectionMatrix();
    camera.position.set(
      creatureCameraTarget.x,
      creatureCameraTarget.y,
      creatureCameraTarget.z + camera.far + creatureCameraRadiusM + 24
    );
    camera.lookAt(creatureCameraTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    layer.updateDecoration(5_300, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(dawnAirRoot.userData.active, true);
    assert.equal(dawnAirRoot.userData.presentationSeed, dawnAirPresentationSeed);
    assert.equal(dawnAirMapRecord.visible, true);
    assert.ok(layer.clearanceReport.cameraRelevantCreatureRoots >= 1);
    assert.ok(
      camera.position.distanceTo(creatureCameraTarget) - creatureCameraRadiusM > camera.far,
      '320m prewarm must acquire the root before its complete sphere enters the real far plane'
    );

    // Leaving prewarm but remaining inside the wider 480m volume retains the already acquired root.
    camera.position.z = creatureCameraTarget.z
      + camera.far + creatureCameraRadiusM + 320 + 2;
    camera.lookAt(creatureCameraTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    layer.updateDecoration(5_350, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(dawnAirRoot.userData.active, true);
    assert.equal(dawnAirRoot.userData.presentationSeed, dawnAirPresentationSeed);
    assert.equal(dawnAirMapRecord.visible, true);

    // The 1.8s temporal grace absorbs a Film cut beyond the complete retention volume.
    camera.position.z = creatureCameraTarget.z
      + camera.far + creatureCameraRadiusM + 480 + 2;
    camera.lookAt(creatureCameraTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    layer.updateDecoration(5_400, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(dawnAirRoot.userData.active, true);
    assert.equal(dawnAirRoot.userData.presentationSeed, dawnAirPresentationSeed);
    assert.equal(dawnAirMapRecord.visible, true);

    layer.updateDecoration(7_151, { sunIntensity: 2, ambientIntensity: 1 });
    assert.ok(
      dawnAirRoot.userData.active === false
      || dawnAirRoot.userData.presentationSeed !== dawnAirPresentationSeed
    );
    assert.ok(
      dawnAirMapRecord.visible === false
      || Math.abs(dawnAirMapRecord.z + dawnAirAnchorS) > 0.000_001
    );
    camera.far = defaultCameraFar;
    camera.updateProjectionMatrix();
    camera.position.copy(defaultCameraPosition);
    camera.quaternion.copy(defaultCameraQuaternion);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);

    // Keep the lifecycle audit monotonic: the shorter realm has already carried the last Dawn landmark behind us.
    layer.updateDecoration(7_300, { sunIntensity: 2, ambientIntensity: 1 });
    state.distance = 2_700;
    layer.updateDecoration(7_700, { sunIntensity: 2, ambientIntensity: 1 });
    assert.ok(layer.clearanceReport.creatureMinimumRoadGapM >= 6);

    const prairieRoadsideRoot = scene.children
      .filter((object) => (
        object.userData?.active === true
        && object.userData?.creatureRealmId === 'prairie-garden'
        && object.userData?.sceneLayer === 'roadside'
      ))
      .sort((left, right) => (
        Math.abs(-left.position.z - 960) - Math.abs(-right.position.z - 960)
      ))[0];
    assert.ok(prairieRoadsideRoot?.visible);
    const prairiePresentationSeed = prairieRoadsideRoot.userData.presentationSeed;
    const prairieInitialZ = prairieRoadsideRoot.position.z;
    const prairieAnchorS = state.distance - prairieInitialZ;
    const prairieMapRecord = layer.getMapEntities().entities.find((record) => (
      record.visible
      && record.category === 'creature-ambient'
      && record.family === prairieRoadsideRoot.userData.creatureFamilyId
      && Math.abs(record.z + prairieAnchorS) <= 0.000_001
    ));
    assert.ok(prairieMapRecord);

    state.distance += 100;
    layer.updateDecoration(8_200, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(prairieRoadsideRoot.userData.active, true);
    assert.equal(prairieRoadsideRoot.visible, true);
    assert.equal(prairieRoadsideRoot.userData.presentationSeed, prairiePresentationSeed);
    assert.ok(Math.abs(prairieRoadsideRoot.position.z - (prairieInitialZ + 100)) <= 0.000_001);
    assert.ok(Math.abs(state.distance - prairieRoadsideRoot.position.z - prairieAnchorS) <= 0.000_001);
    assert.equal(prairieMapRecord.visible, true);
    assert.ok(Math.abs(prairieMapRecord.z + prairieAnchorS) <= 0.000_001);

    sealedTunnel = true;
    layer.updateDecoration(8_700, { sunIntensity: 2, ambientIntensity: 1 });
    assert.equal(layer.clearanceReport.creatureVisibleRoots, 0);
    assert.ok(
      layer.clearanceReport.weatherRainDrawCount > 0,
      'deep tunnel shelter must not stop the shared outdoor rain simulation'
    );
    assert.equal(layer.clearanceReport.weatherRainLocalExposure, 0);
    assert.equal(layer.clearanceReport.weatherRainDistantExposure, 0);
    assert.equal(layer.clearanceReport.weatherRainActiveLayerCount, 1);

    layer.setRenderQuality('low');
    sealedTunnel = false;
    layer.updateDecoration(9_200, { sunIntensity: 2, ambientIntensity: 1 });
    assert.ok(layer.clearanceReport.creatureVisibleRoots <= 4);
    assert.ok(layer.getMapEntities().revision >= 20);

    // Walk all six deterministic realm windows plus every transition so each of the 42 baseline pool roots,
    // 48 classified roots, and six candle clusters binds at least one real terrain-certified absolute anchor.
    let terrainAuditNowMs = 10_000;
    for (let zoneIndex = 0; zoneIndex < 6; zoneIndex++) {
      state.skyZoneIndex = zoneIndex;
      state.distance = zoneIndex * 2_700 + 1;
      layer.updateDecoration(terrainAuditNowMs++, { sunIntensity: 2, ambientIntensity: 1 });
      layer.updateDecoration(terrainAuditNowMs++, { sunIntensity: 2, ambientIntensity: 1 });
      state.distance = zoneIndex * 2_700 + 2_620;
      layer.updateDecoration(terrainAuditNowMs++, { sunIntensity: 2, ambientIntensity: 1 });
      layer.updateDecoration(terrainAuditNowMs++, { sunIntensity: 2, ambientIntensity: 1 });
    }

    const terrainContract = global.window.NeonV23World.SCENERY_TERRAIN_CONTACT_CONTRACT;
    const baselineRoots = scene.children.filter(({ userData }) => userData?.kind === 'zoneModel');
    assert.equal(baselineRoots.length, 42);
    assert.equal(new Set(baselineRoots.map(({ userData }) => userData.zoneFamily)).size, 30);
    for (const root of baselineRoots) {
      const anchor = root.userData.worldAnchor;
      assert.ok(anchor, `${root.name} never received a fixed-seed terrain anchor`);
      assert.equal(root.userData.terrainContactMode, terrainContract.groundedRootMode);
      assert.equal(anchor.terrainContactMode, terrainContract.groundedRootMode);
      assert.ok(Math.abs(anchor.terrainY - terrainHeightAt(anchor.x, anchor.z)) <= 0.000_001);
      assert.ok(
        Math.abs(anchor.y + root.userData.localMinY - anchor.terrainY)
          <= terrainContract.contactToleranceM,
        `${root.name} is suspended above or buried below rendered terrain`
      );
      assert.ok(anchor.terrainY < 5, `${root.name} incorrectly inherited the elevated 48m road frame`);
    }

    const regionRoots = scene.children.filter(
      ({ userData }) => typeof userData?.regionSceneryFamilyId === 'string'
    );
    assert.equal(regionRoots.length, 48);
    const regionAirborneIds = new Set(terrainContract.designedAirborneRegionFamilyIds);
    let groundedRegionCount = 0;
    let designedAirborneRegionCount = 0;
    for (const root of regionRoots) {
      const familyId = root.userData.regionSceneryFamilyId;
      const anchor = root.userData.worldAnchor;
      assert.ok(anchor, `${familyId} never received a fixed-seed terrain anchor`);
      assert.ok(Math.abs(anchor.terrainY - terrainHeightAt(anchor.x, anchor.z)) <= 0.000_001);
      if (regionAirborneIds.has(familyId)) {
        designedAirborneRegionCount++;
        assert.equal(root.userData.placementBand, 'air-far');
        assert.equal(root.userData.terrainContactMode, terrainContract.designedAirborneMode);
        const completeLowerEdgeM = anchor.y + root.userData.localMinY
          - root.userData.motionEnvelopeM;
        assert.ok(
          completeLowerEdgeM
            >= Math.max(anchor.terrainY, 9) + terrainContract.designedAirborneMinimumDeckClearanceM
              - 0.000_1,
          `${familyId} lost its explicit terrain-relative airborne clearance`
        );
      } else {
        groundedRegionCount++;
        assert.notEqual(root.userData.placementBand, 'air-far');
        assert.equal(root.userData.terrainContactMode, terrainContract.groundedRootMode);
        assert.ok(
          Math.abs(anchor.y + root.userData.localMinY - anchor.terrainY)
            <= terrainContract.contactToleranceM,
          `${familyId} is a non-semantic floating or buried region root`
        );
      }
    }
    assert.equal(groundedRegionCount, terrainContract.groundedRegionFamilies);
    assert.equal(designedAirborneRegionCount, terrainContract.designedAirborneRegionFamilies);

    const ambientRoots = scene.children.filter(
      ({ userData }) => userData?.placementMode === 'ambient-environment'
    );
    assert.equal(ambientRoots.length, terrainContract.ambientCandleClusters);
    let auditedCandleInstances = 0;
    for (const root of ambientRoots) {
      const anchor = root.userData.worldAnchor;
      const contact = root.userData.terrainContactInstances;
      assert.ok(anchor && contact);
      assert.equal(root.userData.terrainContactMode, terrainContract.instancedGroundMode);
      assert.equal(root.userData.terrainContactSampleCount, contact.count);
      assert.ok(root.userData.terrainContactMaximumErrorM <= terrainContract.contactToleranceM);
      const cosine = Math.cos(anchor.yaw + root.userData.baseYaw);
      const sine = Math.sin(anchor.yaw + root.userData.baseYaw);
      for (let index = 0; index < contact.count; index++) {
        const offset = index * 16;
        const worldX = anchor.x + cosine * contact.localX[index] + sine * contact.localZ[index];
        const worldZ = anchor.z - sine * contact.localX[index] + cosine * contact.localZ[index];
        const baseBottomWorldY = anchor.y + contact.baseMatrix[offset + 13]
          + contact.baseBoundsMinY * contact.baseScaleY[index];
        const baseTopLocalY = contact.baseMatrix[offset + 13]
          + contact.baseBoundsMaxY * contact.baseScaleY[index];
        const flameBottomLocalY = contact.flameMatrix[offset + 13]
          + contact.flameBoundsMinY * contact.flameScaleY[index];
        const flameSeamM = flameBottomLocalY - baseTopLocalY;
        assert.ok(
          Math.abs(baseBottomWorldY - terrainHeightAt(worldX, worldZ))
            <= terrainContract.contactToleranceM,
          `${root.name} candle ${index} did not land on its own terrain sample`
        );
        assert.ok(flameSeamM >= terrainContract.ambientFlameSeamMinimumM - 0.000_001);
        assert.ok(flameSeamM <= terrainContract.ambientFlameSeamMaximumM + 0.000_001);
        auditedCandleInstances++;
      }
    }
    assert.equal(auditedCandleInstances, 44);
    assert.ok(layer.clearanceReport.terrainHeightSamples >= 42 + 48 + 6 + auditedCandleInstances);
    assert.ok(layer.clearanceReport.terrainMaximumContactErrorM <= terrainContract.contactToleranceM);
    assert.ok(
      layer.clearanceReport.ambientCandlelightMaximumContactErrorM
        <= terrainContract.contactToleranceM
    );
    assert.ok(
      layer.clearanceReport.ambientCandlelightMinimumFlameSeamM
        >= terrainContract.ambientFlameSeamMinimumM - 0.000_001
    );
    assert.ok(
      layer.clearanceReport.ambientCandlelightMaximumFlameSeamM
        <= terrainContract.ambientFlameSeamMaximumM + 0.000_001
    );

    const mapContract = layer.getMapEntities();
    assert.equal(mapContract.version, 2);
    assert.equal(mapContract.cameraClearanceEnvelopeVersion, 1);
    assert.equal(
      mapContract.cameraClearanceEnvelopeAuthority,
      'presented-root-complete-visible-bounds-with-motion-envelope'
    );
    const visibleMapRecords = mapContract.entities.filter(({ visible }) => visible);
    assert.ok(visibleMapRecords.length > 0);
    for (const record of visibleMapRecords) {
      for (const field of [
        'horizontalRadiusM',
        'geometryHorizontalRadiusM',
        'motionEnvelopeM',
        'absoluteMinY',
        'absoluteMaxY',
        'centerY',
        'halfHeightM',
        'cameraClearanceMinY',
        'cameraClearanceMaxY',
        'cameraClearanceCenterY',
        'cameraClearanceHalfHeightM'
      ]) {
        assert.ok(Number.isFinite(record[field]), `${record.id}.${field} is not finite`);
      }
      assert.equal(record.radiusM, record.horizontalRadiusM);
      assert.ok(record.horizontalRadiusM >= record.geometryHorizontalRadiusM);
      assert.ok(record.absoluteMinY <= record.absoluteMaxY);
      assert.ok(Math.abs(record.centerY - (record.absoluteMinY + record.absoluteMaxY) * 0.5) <= 0.000_001);
      assert.ok(Math.abs(record.halfHeightM - (record.absoluteMaxY - record.absoluteMinY) * 0.5) <= 0.000_001);
      assert.ok(record.cameraClearanceMinY <= record.absoluteMinY);
      assert.ok(record.cameraClearanceMaxY >= record.absoluteMaxY);
      assert.ok(record.cameraClearanceHalfHeightM >= record.halfHeightM);
    }

    assert.equal(layer.dispose(), true);
    assert.equal(layer.getRenderQualityDiagnostics().disposed, true);
    assert.equal(layer.dispose(), false);
  } finally {
    if (layer && !layer.getRenderQualityDiagnostics().disposed) layer.dispose();
    console.info = previousInfo;
    console.warn = previousWarn;
    global.window = previousWindow;
    global.document = previousDocument;
  }
});
