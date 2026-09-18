#!/usr/bin/env node
/** Deterministic physical-lighting regression contract / 确定性真实光影回归合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Resolve production lighting dependencies from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = globalThis;
require(path.join(PROJECT_ROOT, 'src/weather/Neon_Autopilot_V23_HighSpeed_DroneHeat.weather.js'));
const THREE = require(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'));
const lighting = require(path.join(
  PROJECT_ROOT,
  'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.lighting.js'
));

const {
  PHYSICAL_LIGHTING_CONTRACT,
  LIGHTING_PRESENTATION_TIERS,
  ZONE_LIGHTING,
  deriveLightingState,
  createPhysicalLightingRig
} = lighting;
const weatherEntries = Object.entries(globalThis.NeonV23Weather.types);
const environments = Object.freeze([
  Object.freeze({ id: 'open', covered: false, underpassBlend: 0, tunnelKind: null }),
  Object.freeze({ id: 'bridge', covered: false, underpassBlend: 1, tunnelKind: null }),
  Object.freeze({ id: 'mountain', covered: true, underpassBlend: 0.72, tunnelKind: 'mountain-tunnel' }),
  Object.freeze({ id: 'underground', covered: true, underpassBlend: 1, tunnelKind: 'underground-tunnel' })
]);
const views = Object.freeze([0, 1, 2, 3]);

function assertInBounds(value, bounds, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  assert.ok(value >= bounds[0] && value <= bounds[1], `${label}=${value} is outside ${bounds.join('..')}`);
}

function withoutSignature(state) {
  const { illuminationSignature: _signature, ...copy } = state;
  return copy;
}

/** Execute the shipped r160 cache unchanged; stub only GPU filtering so cache ownership remains real. */
function createPinnedPmremCacheProbe() {
  const vendorSource = readFileSync(path.join(PROJECT_ROOT, 'vendor/three-0.160.0.min.js'), 'utf8');
  const start = vendorSource.indexOf('function qr(t){let e=new WeakMap,n=null;');
  const end = vendorSource.indexOf('function Yr(t){', start);
  assert.ok(start > 0 && end > start, 'the pinned vendor cache changed; review its actual cache contract');
  const targets = [];
  let generatorDisposals = 0;
  class CountedPmremGenerator {
    fromEquirectangular(source) {
      const target = {
        texture: { pixels: Float32Array.from(source.image.data), generation: targets.length + 1 },
        disposeCount: 0,
        dispose() { this.disposeCount++; }
      };
      targets.push(target);
      return target;
    }

    dispose() { generatorDisposals++; }
  }
  const createCache = new Function('Hr', 'E', 'w', 'b', 'T', `return (${vendorSource.slice(start, end)});`)(
    CountedPmremGenerator,
    THREE.EquirectangularReflectionMapping,
    THREE.EquirectangularRefractionMapping,
    THREE.CubeReflectionMapping,
    THREE.CubeRefractionMapping
  );
  return { cache: createCache({}), targets, get generatorDisposals() { return generatorDisposals; } };
}

/** Keep the test renderer intentionally GPU-free; production Three owns every light, texture, and event. */
function createHandoffRig(initialRenderQualityId = 'high') {
  const scene = new THREE.Scene();
  const rig = createPhysicalLightingRig({
    THREE,
    renderer: { shadowMap: { enabled: false, type: -1, autoUpdate: false } },
    scene,
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
    initialRenderQualityId
  });
  const spots = [];
  rig.group.traverse((object) => { if (object.isSpotLight) spots.push(object); });
  return { rig, scene, spots };
}

test('the shipped r160 PMREM cache refreshes enclosure HDR once per signature and releases every replaced target', () => {
  // Demonstrate the actual failure first: the vendor ignores both update flags after caching this DataTexture.
  const staleProbe = createPinnedPmremCacheProbe();
  const source = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  const stale = staleProbe.cache.get(source);
  source.image.data[0] = 0.1;
  source.needsUpdate = true;
  source.needsPMREMUpdate = true;
  assert.equal(staleProbe.cache.get(source), stale);
  assert.equal(stale.pixels[0], 1);
  source.dispose();
  staleProbe.cache.dispose();
  assert.equal(staleProbe.targets[0].disposeCount, 1);

  for (const quality of ['low', 'medium', 'high']) {
    const probe = createPinnedPmremCacheProbe();
    const { rig, scene, spots } = createHandoffRig(quality);
    const shared = { zoneIndex: 3, weather: globalThis.NeonV23Weather.types.clear.profile, dtSeconds: 1 / 60 };
    rig.update({ ...shared, covered: false, underpassBlend: 0 });
    const initialTexture = rig.environmentTexture;
    const outdoor = probe.cache.get(scene.environment);
    assert.equal(initialTexture.type, THREE.FloatType);
    assert.equal(initialTexture.colorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(initialTexture.minFilter, THREE.LinearFilter);
    assert.equal(initialTexture.magFilter, THREE.LinearFilter);
    assert.equal(initialTexture.image.width, 64);
    assert.equal(initialTexture.image.height, 32);
    assert.equal(initialTexture.isRenderTargetTexture, false);
    assert.ok(Math.max(...outdoor.pixels) > 1, 'HDR highlights must not be clipped to display white');
    assert.equal(spots.length, 6);
    assert.equal(spots.filter((spot) => spot.castShadow).length, 2);
    if (quality !== 'high') assert.ok(spots.every((spot) => !spot.visible));
    const invalidations = rig.getDiagnostics().environmentCacheInvalidationCount;
    const indoorsInput = { ...shared, covered: true, underpassBlend: 1, tunnelKind: 'underground-tunnel' };
    rig.update(indoorsInput);
    const indoors = probe.cache.get(scene.environment);
    assert.equal(rig.environmentTexture, initialTexture, 'source identity and authored Float storage remain stable');
    assert.notEqual(indoors, outdoor, `${quality} must replace stale filtered illumination`);
    assert.deepEqual(indoors.pixels, initialTexture.image.data);
    assert.notDeepEqual(indoors.pixels, outdoor.pixels);
    assert.equal(probe.targets[0].disposeCount, 1);
    assert.equal(rig.getDiagnostics().environmentCacheInvalidationCount, invalidations + 1);
    for (let frame = 0; frame < 120; frame++) {
      rig.update(indoorsInput);
      assert.equal(probe.cache.get(scene.environment), indoors);
    }
    assert.equal(probe.targets.length, 2, 'stable frames must not refilter the HDR source');
    for (let transition = 0; transition < 20; transition++) {
      rig.update({ ...indoorsInput, underpassBlend: transition % 2 ? 1 : 0.2 });
      probe.cache.get(scene.environment);
      assert.equal(probe.targets.filter((target) => target.disposeCount === 0).length, 1);
      assert.ok(probe.targets.every((target) => target.disposeCount <= 1));
    }
    const finalTargetCount = probe.targets.length;
    rig.setEnabled(false);
    rig.update({ ...shared, covered: false, underpassBlend: 0 });
    assert.equal(probe.targets.length, finalTargetCount);
    rig.setEnabled(true);
    assert.deepEqual(probe.cache.get(scene.environment).pixels, outdoor.pixels);
    assert.equal(rig.dispose(), true);
    assert.equal(rig.dispose(), false);
    assert.ok(probe.targets.every((target) => target.disposeCount === 1));
    assert.equal(scene.environment, null);
    probe.cache.dispose();
    assert.equal(probe.generatorDisposals, 1);
  }
});

test('fixed-pool tunnel handoffs have equal elapsed-time illumination at 30, 60, and 120 Hz', () => {
  const fixture = (id, x, edge = 'a', profile = 'a-profile') => ({
    id, coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: { x, y: 6, z: 0 }, tileLocalPosition: { x, y: 6, z: 0 },
    direction: { x: 0, y: -1, z: 0 }, color: 0xff_d5a0, intensity: 1_400, distance: 30,
    kind: 'tunnel-ceiling-fixture', edge, edgeS: 100, profile, powerMode: 'constant-on'
  });
  for (const identityCut of [false, true]) {
    const fixtures = identityCut
      ? [...Array.from({ length: 6 }, (_, i) => fixture(`a-${i}`, i * 6)),
          ...Array.from({ length: 6 }, (_, i) => fixture(`b-${i}`, 500 + i * 6, 'b', 'b-profile'))]
      : Array.from({ length: 7 }, (_, i) => fixture(`a-${i}`, i * 20));
    const input = {
      zoneIndex: 4, covered: true, underpassBlend: 1, tunnelKind: 'underground-tunnel',
      routeEdgeId: 'a', routeEdgeS: 100, tunnelProfileId: 'a-profile',
      anchor: { x: 0, y: 1, z: 0 }, renderOrigin: { x: 0, y: 0, z: 0 },
      fixtureSelectionMode: identityCut ? 'camera-visual' : undefined, fixtureEmitters: fixtures
    };
    const snapshots = [];
    for (const hz of [30, 60, 120]) {
      const { rig, spots } = createHandoffRig();
      rig.update({ ...input, fixtureSelectionAnchor: { x: 0, y: 6, z: 0 }, dtSeconds: 0 });
      const moved = { ...input, fixtureSelectionAnchor: { x: identityCut ? 500 : 120, y: 6, z: 0 } };
      const timeline = [];
      for (let frame = 1; frame <= hz / 3; frame++) {
        rig.update({ ...moved, dtSeconds: 1 / hz });
        const diagnostics = rig.getDiagnostics();
        assert.ok(new Set(diagnostics.activeTunnelSpotIdentityKeys).size <= 1, 'crossing profiles must never mix');
        if (frame % (hz / 30) === 0) timeline.push({
          positions: spots.map((spot) => spot.position.toArray()),
          powers: spots.map((spot) => spot.intensity),
          ids: diagnostics.activeTunnelSpotEmitterIds
        });
        if (frame === hz / 30) {
          const beforePause = spots.map((spot) => spot.intensity);
          for (let pausedFrame = 0; pausedFrame < 20; pausedFrame++) rig.update({ ...moved, dtSeconds: 0 });
          assert.deepEqual(spots.map((spot) => spot.intensity), beforePause, 'paused renders may not advance fades');
        }
      }
      snapshots.push(timeline);
      // A fresh cut and immediate reversal must remain bound to real positions in one exact profile group.
      rig.update({ ...input, fixtureSelectionAnchor: { x: 0, y: 6, z: 0 }, dtSeconds: 1 / hz });
      const reversingPowers = spots.map((spot) => spot.intensity);
      rig.update({ ...moved, dtSeconds: 0 });
      if (identityCut) assert.deepEqual(spots.map((spot) => spot.intensity), reversingPowers);
      assert.ok(new Set(rig.getDiagnostics().activeTunnelSpotIdentityKeys).size <= 1);
      rig.dispose();
    }
    for (const timeline of snapshots.slice(1)) {
      for (let index = 0; index < timeline.length; index++) {
        assert.deepEqual(timeline[index].positions, snapshots[0][index].positions);
        assert.deepEqual(timeline[index].ids, snapshots[0][index].ids);
        timeline[index].powers.forEach((power, slot) => {
          assert.ok(Math.abs(power - snapshots[0][index].powers[slot]) < 0.000_001,
            `${identityCut ? 'identity' : 'seventh-fixture'} handoff differs at sample ${index}, slot ${slot}`);
        });
      }
    }
    const { rig, spots } = createHandoffRig();
    rig.update({ ...input, fixtureSelectionAnchor: { x: 0, y: 6, z: 0 }, dtSeconds: 0 });
    rig.update({ ...input, fixtureSelectionAnchor: { x: identityCut ? 500 : 120, y: 6, z: 0 }, dtSeconds: 1 / 3 });
    const finalSnapshot = snapshots[0].at(-1);
    assert.deepEqual(spots.map((spot) => spot.position.toArray()), finalSnapshot.positions);
    spots.forEach((spot, slot) => assert.ok(Math.abs(spot.intensity - finalSnapshot.powers[slot]) < 0.000_001));
    rig.dispose();
  }
});

test('scene-scoped tunnel uniforms compensate the actual global lighting once and retain ownership through toggles', () => {
  const { rig, scene } = createHandoffRig('high');
  const second = createHandoffRig('high');
  const uniforms = scene.userData.neonV23TunnelLightingUniforms;
  const originalEntries = Object.values(uniforms);
  assert.notEqual(uniforms, second.scene.userData.neonV23TunnelLightingUniforms);
  assert.deepEqual(originalEntries.map((entry) => entry.value), [1, 1, 1]);
  const plainInput = {
    zoneIndex: 0,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    dtSeconds: 0
  };
  rig.update(plainInput);
  const values = Object.values(uniforms).map((entry) => entry.value);
  assert.ok(Math.abs(values[0] - 0.14) < 0.000_001);
  assert.ok(Math.abs(values[1] - 0.07) < 0.000_001);
  assert.ok(Math.abs(values[2] - 0.012) < 0.000_001);
  assert.deepEqual(Object.values(second.scene.userData.neonV23TunnelLightingUniforms).map((entry) => entry.value), [1, 1, 1]);
  for (const quality of ['low', 'medium', 'high']) {
    rig.setRenderQuality(quality);
    for (const [weatherId, weatherType] of weatherEntries) {
      const input = { ...plainInput, zoneIndex: 4, weather: weatherType.profile, lightningPulse: 0.6 };
      const enclosed = rig.update(input);
      const outdoor = deriveLightingState({ ...input, covered: false, underpassBlend: 0, tunnelKind: null });
      const tier = LIGHTING_PRESENTATION_TIERS[quality];
      const bounded = (value, bounds) => Math.max(bounds[0], Math.min(bounds[1], value));
      const ratio = (actual, baseline) => baseline > 0 ? Math.min(1, actual / baseline) : 1;
      const expectedAmbient = ratio(
        bounded(enclosed.ambientIntensity * tier.ambientMultiplier, PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity),
        bounded(outdoor.ambientIntensity * tier.ambientMultiplier, PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity)
      );
      const expectedDirectional = Math.min(
        ratio(
          bounded(enclosed.sunIntensity * tier.sunMultiplier, PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity),
          bounded(outdoor.sunIntensity * tier.sunMultiplier, PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity)
        ),
        ratio(enclosed.moonIntensity, outdoor.moonIntensity),
        ratio(enclosed.lightningIntensity, outdoor.lightningIntensity)
      );
      assert.ok(Math.abs(uniforms.neonV23GlobalAmbientTransmission.value - expectedAmbient) < 0.000_001,
        `${quality}/${weatherId}: snow, lightning and floors must remain in the ambient ratio`);
      assert.ok(Math.abs(uniforms.neonV23GlobalDirectionalTransmission.value - expectedDirectional) < 0.000_001);
      assert.ok(Math.abs(uniforms.neonV23GlobalEnvironmentTransmission.value
        - enclosed.environmentIntensity / outdoor.environmentIntensity) < 0.000_001);
      assert.equal(scene.userData.neonV23TunnelLightingUniforms, uniforms);
      Object.values(uniforms).forEach((entry, index) => assert.equal(entry, originalEntries[index]));
    }
  }
  const cachedState = rig.update({ ...plainInput, underpassBlend: 0.75 });
  const cachedRefreshes = rig.getDiagnostics().environmentRefreshCount;
  const cachedTransmission = uniforms.neonV23GlobalEnvironmentTransmission.value;
  const nearbyState = rig.update({ ...plainInput, underpassBlend: 0.750_001 });
  assert.notEqual(nearbyState.environmentIntensity, cachedState.environmentIntensity);
  assert.equal(rig.getDiagnostics().environmentRefreshCount, cachedRefreshes);
  assert.equal(uniforms.neonV23GlobalEnvironmentTransmission.value, cachedTransmission,
    'a quantized PMREM source must publish its baked attenuation, not a newer unrendered target');
  rig.setEnabled(false);
  assert.deepEqual(Object.values(uniforms).map((entry) => entry.value), [1, 1, 1]);
  rig.update(plainInput);
  assert.deepEqual(Object.values(uniforms).map((entry) => entry.value), [1, 1, 1]);
  rig.setEnabled(true);
  assert.ok(uniforms.neonV23GlobalDirectionalTransmission.value < 0.02);
  rig.dispose();
  assert.equal(Object.hasOwn(scene.userData, 'neonV23TunnelLightingUniforms'), false);
  second.rig.dispose();

  const previous = { callerOwned: true };
  const previousScene = new THREE.Scene();
  previousScene.userData.neonV23TunnelLightingUniforms = previous;
  const makeRig = () => createPhysicalLightingRig({
    THREE, scene: previousScene, renderer: { shadowMap: {} }, camera: new THREE.PerspectiveCamera()
  });
  const restoreRig = makeRig();
  assert.notEqual(previousScene.userData.neonV23TunnelLightingUniforms, previous);
  restoreRig.dispose();
  assert.equal(previousScene.userData.neonV23TunnelLightingUniforms, previous);
  const replacedRig = makeRig();
  const replacement = { replacementOwned: true };
  previousScene.userData.neonV23TunnelLightingUniforms = replacement;
  replacedRig.dispose();
  assert.equal(previousScene.userData.neonV23TunnelLightingUniforms, replacement);
});

test('physical lighting contract is deeply frozen and owns the full-quality renderer path', () => {
  assert.equal(Object.isFrozen(PHYSICAL_LIGHTING_CONTRACT), true);
  assert.equal(Object.isFrozen(PHYSICAL_LIGHTING_CONTRACT.shadow), true);
  assert.equal(Object.isFrozen(PHYSICAL_LIGHTING_CONTRACT.toggle), true);
  assert.equal(Object.isFrozen(PHYSICAL_LIGHTING_CONTRACT.lights), true);
  assert.equal(Object.isFrozen(PHYSICAL_LIGHTING_CONTRACT.invariants), true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.mode, 'physical-hdr-shadowed');
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.version, 13);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.visualOnly, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.realmCount, 6);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.shadow.primaryMapSize, 4_096);
  assert.deepEqual(PHYSICAL_LIGHTING_CONTRACT.shadow.supportedMapSizes, [512, 1_024, 2_048, 4_096, 8_192]);
  assert.deepEqual(PHYSICAL_LIGHTING_CONTRACT.shadow.typePreference, ['VSMShadowMap', 'PCFSoftShadowMap']);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.renderer.outputColorSpace, 'srgb');
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.renderer.toneMapping, 'aces-filmic');
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.renderer.useLegacyLights, false);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.environment.needsPMREMUpdate, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.environment.cacheInvalidation, 'source-dispose-on-signature-change');
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.toggle.defaultEnabled, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.toggle.disabledMode, 'flat-ambient-no-projected-shadows');
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.toggle.disablesHdrEnvironment, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.toggle.disablesShadowMaps, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.inverseSquareDecay, 2);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelSpotCount, 6);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelShadowSpotCount, 2);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.localShadowPrewarmUpdateCount, 2);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPhysicalSelectionDistanceM, 112);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelDynamicDetailFadeM, 24);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelCameraIdentityHysteresisM, 24);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelSpotHandoffReferenceRate, 0.34);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelSpotHandoffReferenceHz, 60);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelSpotHandoffsUseElapsedTime, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassEnclosureMaximum, 0.32);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureStartBlend, 0.68);
  assert.deepEqual(PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassDarkSunIntensityRange, [0.85, 2.4]);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassSolarDominanceRatio, 0.32);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureRoadDistanceM, 6);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.fixtureReachMarginM, 2);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM, 240);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.noCameraFollowingGuideLights, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.openUnderpassesRetainSkyIllumination, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.openUnderpassFixturesNeedShadeAndDarkness, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.sunDominatesOpenUnderpassFixtures, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.fixtureRecordsMustReachTheViewpointOrVisibleApproach, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.fixtureRecordsMustMatchTheActiveRoute, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelFixturesPrewarmAhead, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelFixturesStayAuthoredAndConstant, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelFixtureSelectionUsesRouteAndViewpointDistance, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.fixtureSelectionAnchorDefaultsToLightingAnchor, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.filmFixtureIdentityUsesNearestExactAuthoredRoute, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelSpotHandoffsFadeWithinTheFixedPool, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelIdentityHandoffsFadeBeforeSlotReuse, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.constantOnFixturePowerIgnoresProximity, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.residentTunnelIrradianceHasNoDistanceGate, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelFixtureFallbackProhibited, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.tunnelPortalsTransitionContinuously, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.hdrEnvironmentTracksEnclosure, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.dynamicLocalFixtureLightsAreHighOnly, true);
  assert.equal(PHYSICAL_LIGHTING_CONTRACT.invariants.noFpsDrivenQualityDowngrade, true);
  assert.equal(Object.isFrozen(LIGHTING_PRESENTATION_TIERS), true);
  assert.equal(LIGHTING_PRESENTATION_TIERS.low.exposureMultiplier, 1);
  assert.equal(LIGHTING_PRESENTATION_TIERS.medium.hdrRadianceMultiplier, 1);
  assert.equal(LIGHTING_PRESENTATION_TIERS.low.bakeEnvironmentIntensity, true);
  assert.equal(LIGHTING_PRESENTATION_TIERS.medium.bakeEnvironmentIntensity, true);
  assert.equal(LIGHTING_PRESENTATION_TIERS.low.dynamicLocalFixtureLights, false);
  assert.equal(LIGHTING_PRESENTATION_TIERS.medium.dynamicLocalFixtureLights, false);
  assert.ok(LIGHTING_PRESENTATION_TIERS.high.exposureMultiplier < 1);
  assert.ok(LIGHTING_PRESENTATION_TIERS.high.ambientMultiplier < 1);
  assert.ok(LIGHTING_PRESENTATION_TIERS.high.hdrRadianceMultiplier < 1);
  assert.equal(LIGHTING_PRESENTATION_TIERS.high.bakeEnvironmentIntensity, true);
  assert.equal(LIGHTING_PRESENTATION_TIERS.high.dynamicLocalFixtureLights, true);
  assert.equal(ZONE_LIGHTING.length, 6);
  assert.equal(new Set(ZONE_LIGHTING.map((zone) => zone.id)).size, 6);
});

test('all 1,440 realm/weather/enclosure/view combinations are finite, bounded, immutable, and view independent', () => {
  assert.equal(weatherEntries.length, 15);
  let combinationCount = 0;
  for (let zoneIndex = 0; zoneIndex < ZONE_LIGHTING.length; zoneIndex++) {
    for (const [weatherId, weatherType] of weatherEntries) {
      for (const environment of environments) {
        const states = views.map((viewMode) => deriveLightingState({
          zoneIndex,
          weather: weatherType.profile,
          ...environment,
          viewMode,
          lightningPulse: weatherType.profile.lightning ? 0.72 : 0,
          reducedMotion: false
        }));
        combinationCount += states.length;
        for (const state of states) {
          assert.equal(Object.isFrozen(state), true);
          assert.equal(Object.isFrozen(state.sunColor), true);
          assert.equal(state.visualOnly, true);
          assert.equal(state.zoneIndex, zoneIndex);
          assert.equal(typeof state.illuminationSignature, 'string');
          assert.ok(state.illuminationSignature.length > 8);
          assertInBounds(state.sunIntensity, PHYSICAL_LIGHTING_CONTRACT.bounds.sunIntensity, `${weatherId}.sun`);
          assertInBounds(state.moonIntensity, PHYSICAL_LIGHTING_CONTRACT.bounds.moonIntensity, `${weatherId}.moon`);
          assertInBounds(state.lightningIntensity, PHYSICAL_LIGHTING_CONTRACT.bounds.lightningIntensity, `${weatherId}.lightning`);
          assertInBounds(state.ambientIntensity, PHYSICAL_LIGHTING_CONTRACT.bounds.ambientIntensity, `${weatherId}.ambient`);
          assertInBounds(state.tunnelFixtureIntensity, PHYSICAL_LIGHTING_CONTRACT.bounds.tunnelFixtureIntensity, `${weatherId}.tunnel`);
          assertInBounds(state.exposure, PHYSICAL_LIGHTING_CONTRACT.bounds.exposure, `${weatherId}.exposure`);
          assertInBounds(state.environmentIntensity, PHYSICAL_LIGHTING_CONTRACT.bounds.environmentIntensity, `${weatherId}.environment`);
          assertInBounds(state.directTransmission, PHYSICAL_LIGHTING_CONTRACT.bounds.directTransmission, `${weatherId}.transmission`);
          for (const [label, color] of Object.entries({
            sun: state.sunColor,
            ambient: state.ambientColor,
            moon: state.moonColor,
            lightning: state.lightningColor,
            tunnel: state.tunnelColor
          })) {
            assert.equal(color.length, 3, `${label} color must have three channels`);
            color.forEach((channel) => assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 4));
          }
        }
        for (const state of states.slice(1)) {
          assert.deepEqual(withoutSignature(state), withoutSignature(states[0]));
          assert.equal(state.illuminationSignature, states[0].illuminationSignature);
        }
      }
    }
  }
  assert.equal(combinationCount, 6 * 15 * 4 * 4);
});

test('cloud and dust attenuate celestial light while deep tunnels replace it with real fixture light', () => {
  const clearOpen = deriveLightingState({
    zoneIndex: 1,
    weather: { cloudCover: 0, cloudDarkness: 0, dust: 0, visibility: 1 }
  });
  const cloudyOpen = deriveLightingState({
    zoneIndex: 1,
    weather: { cloudCover: 0.8, cloudDarkness: 0.55, dust: 0, visibility: 0.7 }
  });
  const dustyOpen = deriveLightingState({
    zoneIndex: 1,
    weather: { cloudCover: 0.1, cloudDarkness: 0.25, dust: 0.9, visibility: 0.25 }
  });
  const openBridge = deriveLightingState({
    zoneIndex: 1,
    weather: { cloudCover: 0.8, cloudDarkness: 0.55, visibility: 0.7 },
    covered: false,
    underpassBlend: 1,
    tunnelKind: null
  });
  const mountain = deriveLightingState({
    zoneIndex: 1,
    weather: { cloudCover: 0.8, cloudDarkness: 0.55, visibility: 0.7 },
    covered: true,
    underpassBlend: 0.72,
    tunnelKind: 'mountain-tunnel'
  });
  const underground = deriveLightingState({
    zoneIndex: 1,
    weather: { cloudCover: 0.8, cloudDarkness: 0.55, visibility: 0.7 },
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel'
  });

  assert.ok(cloudyOpen.directTransmission < clearOpen.directTransmission);
  assert.ok(dustyOpen.directTransmission < clearOpen.directTransmission);
  assert.ok(cloudyOpen.sunIntensity < clearOpen.sunIntensity);
  assert.ok(dustyOpen.sunIntensity < clearOpen.sunIntensity);
  assert.equal(openBridge.coveredRoute, false);
  assert.equal(openBridge.deepTunnel, 0);
  assert.equal(openBridge.directTransmission, cloudyOpen.directTransmission);
  assert.equal(openBridge.sunIntensity, cloudyOpen.sunIntensity);
  assert.equal(openBridge.ambientIntensity, cloudyOpen.ambientIntensity);
  assert.equal(openBridge.environmentIntensity, cloudyOpen.environmentIntensity);
  assert.equal(openBridge.exposure, cloudyOpen.exposure);
  assert.ok(openBridge.enclosure <= PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassEnclosureMaximum);
  assert.ok(openBridge.openUnderpassFixtureActivation > 0, 'dark bridge shade may request authored lamps');
  assert.ok(openBridge.tunnelFixtureIntensity > 0, 'dark bridge shade retains a bounded fixture ramp');
  assert.ok(openBridge.openUnderpassFixtureIlluminanceBudget < openBridge.sunIntensity);
  assert.ok(mountain.directTransmission < cloudyOpen.directTransmission);
  assert.ok(underground.directTransmission < mountain.directTransmission);
  assert.ok(mountain.tunnelFixtureIntensity > cloudyOpen.tunnelFixtureIntensity);
  assert.ok(underground.tunnelFixtureIntensity > mountain.tunnelFixtureIntensity);
  assert.equal('guideIntensity' in underground, false);
});

test('sealed tunnel portals blend continuously from outdoor light instead of popping at entry', () => {
  const input = {
    zoneIndex: 1,
    weather: globalThis.NeonV23Weather.types.clear.profile
  };
  const outdoor = deriveLightingState({ ...input, covered: false, underpassBlend: 0 });
  const portalStates = Array.from({ length: 101 }, (_, index) => deriveLightingState({
    ...input,
    covered: true,
    underpassBlend: index / 100,
    tunnelKind: 'underground-tunnel'
  }));
  const boundary = portalStates[0];

  for (const key of [
    'sunIntensity',
    'moonIntensity',
    'lightningIntensity',
    'ambientIntensity',
    'exposure',
    'environmentIntensity',
    'outdoorEnvironmentIntensity',
    'environmentSunIntensity',
    'directTransmission'
  ]) {
    assert.equal(boundary[key], outdoor[key], `${key} must stay continuous at the portal boundary`);
  }
  assert.equal(boundary.tunnelFixtureIntensity, 0);
  assert.equal(boundary.environmentSignature, outdoor.environmentSignature);

  const epsilonEntry = deriveLightingState({
    ...input,
    covered: true,
    underpassBlend: 0.001,
    tunnelKind: 'underground-tunnel'
  });
  assert.ok(Math.abs(epsilonEntry.sunIntensity - boundary.sunIntensity) < 0.001);
  assert.ok(Math.abs(epsilonEntry.environmentIntensity - boundary.environmentIntensity) < 0.001);
  assert.ok(Math.abs(epsilonEntry.exposure - boundary.exposure) < 0.001);
  assert.ok(epsilonEntry.tunnelFixtureIntensity < 1);

  for (let index = 1; index < portalStates.length; index++) {
    const previous = portalStates[index - 1];
    const current = portalStates[index];
    assert.ok(current.sunIntensity <= previous.sunIntensity + 0.000_001);
    assert.ok(current.environmentIntensity <= previous.environmentIntensity + 0.000_001);
    assert.ok(current.exposure <= previous.exposure + 0.000_001);
    assert.ok(current.tunnelFixtureIntensity + 0.000_001 >= previous.tunnelFixtureIntensity);
    assert.equal(current.environmentSignature, outdoor.environmentSignature);
  }
  assert.ok(portalStates.at(-1).sunIntensity < outdoor.sunIntensity);
  assert.ok(portalStates.at(-1).tunnelFixtureIntensity > 0);
});

test('forward tunnel preview prelights fixtures without changing outdoor celestial or HDR state', () => {
  const input = {
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.cloudy.profile,
    covered: false,
    underpassBlend: 0
  };
  const outdoor = deriveLightingState(input);
  const previewStates = [40, 180, PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM]
    .map((previewTunnelDistanceM) => deriveLightingState({
      ...input,
      previewTunnelKind: 'underground-tunnel',
      previewTunnelDistanceM
    }));
  const preview = previewStates[1];

  assert.equal(preview.coveredRoute, false);
  assert.equal(preview.tunnelApproachActivation, 1);
  assert.ok(preview.previewTunnelFixtureIntensity > 0);
  assert.equal(preview.tunnelFixtureIntensity, outdoor.tunnelFixtureIntensity);
  for (const state of previewStates) {
    assert.equal(state.tunnelApproachActivation, 1);
    assert.equal(state.previewTunnelFixtureIntensity, preview.previewTunnelFixtureIntensity);
  }

  for (const key of [
    'sunIntensity',
    'moonIntensity',
    'lightningIntensity',
    'ambientIntensity',
    'exposure',
    'environmentIntensity',
    'outdoorEnvironmentIntensity',
    'environmentSunIntensity',
    'environmentSignature',
    'directTransmission'
  ]) {
    assert.equal(preview[key], outdoor[key], `${key} must retain the outdoor result during preview`);
  }
});

test('open-underpass fixtures require central shade and weak sunlight while keeping the sun dominant', () => {
  const clearDayBridge = deriveLightingState({
    zoneIndex: 1,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: false,
    underpassBlend: 1
  });
  const darkBridgeEdge = deriveLightingState({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.thunderstorm.profile,
    covered: false,
    underpassBlend: PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassFixtureStartBlend
  });
  const darkBridgeMiddle = deriveLightingState({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.thunderstorm.profile,
    covered: false,
    underpassBlend: 0.84
  });
  const darkBridgeCentre = deriveLightingState({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.thunderstorm.profile,
    covered: false,
    underpassBlend: 1
  });

  assert.equal(clearDayBridge.openUnderpassShade, 1);
  assert.equal(clearDayBridge.openUnderpassDarkness, 0);
  assert.equal(clearDayBridge.openUnderpassFixtureActivation, 0);
  assert.equal(clearDayBridge.tunnelFixtureIntensity, 0);
  assert.equal(clearDayBridge.openUnderpassFixtureIlluminanceBudget, 0);
  assert.equal(darkBridgeEdge.openUnderpassShade, 0);
  assert.equal(darkBridgeEdge.openUnderpassFixtureActivation, 0);
  assert.equal(darkBridgeEdge.tunnelFixtureIntensity, 0);
  assert.ok(darkBridgeMiddle.openUnderpassFixtureActivation > 0);
  assert.ok(darkBridgeMiddle.openUnderpassFixtureActivation < darkBridgeCentre.openUnderpassFixtureActivation);
  assert.ok(darkBridgeMiddle.tunnelFixtureIntensity < darkBridgeCentre.tunnelFixtureIntensity);
  assert.ok(
    darkBridgeCentre.openUnderpassFixtureIlluminanceBudget
      <= darkBridgeCentre.sunIntensity * PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassSolarDominanceRatio
  );
  assert.ok(darkBridgeCentre.openUnderpassFixtureIlluminanceBudget < darkBridgeCentre.sunIntensity);
});

test('realm transitions interpolate every authored light channel without a boundary pop', () => {
  const left = deriveLightingState({ zoneIndex: 0, nextZoneIndex: 1, zoneBlend: 0 });
  const middle = deriveLightingState({ zoneIndex: 0, nextZoneIndex: 1, zoneBlend: 0.5 });
  const right = deriveLightingState({ zoneIndex: 0, nextZoneIndex: 1, zoneBlend: 1 });
  assert.equal(left.zoneId, ZONE_LIGHTING[0].id);
  assert.equal(right.zoneId, `${ZONE_LIGHTING[0].id}->${ZONE_LIGHTING[1].id}`);
  assert.equal(middle.zoneBlend, 0.5);
  assert.ok(middle.sunIntensity > Math.min(left.sunIntensity, right.sunIntensity));
  assert.ok(middle.sunIntensity < Math.max(left.sunIntensity, right.sunIntensity));
  middle.sunDirection.forEach((value) => assert.ok(Number.isFinite(value)));
  assert.ok(Math.abs(Math.hypot(...middle.sunDirection) - 1) <= 0.000_001);
});

test('lightning is explicit and deterministic while reduced motion retains a bounded weak return', () => {
  const input = {
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.thunderstorm.profile,
    lightningPulse: 0.83,
    covered: false,
    underpassBlend: 0
  };
  const first = deriveLightingState(input);
  const repeat = deriveLightingState(input);
  const noPulse = deriveLightingState({ ...input, lightningPulse: 0 });
  const reduced = deriveLightingState({ ...input, reducedMotion: true });
  assert.deepEqual(first, repeat);
  assert.ok(first.lightningIntensity > 0);
  assert.equal(noPulse.lightningIntensity, 0);
  assert.ok(reduced.lightningIntensity > 0);
  assert.ok(reduced.lightningIntensity < first.lightningIntensity);
  assert.ok(reduced.exposure <= PHYSICAL_LIGHTING_CONTRACT.bounds.exposure[1]);
});

test('Three r160 rig installs HDR physical rendering, actual inverse-square lights, and quantized shadows', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  camera.position.set(4.23, 3.17, 8.91);
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene,
    camera,
    initialRenderQualityId: 'high'
  });

  assert.equal(Object.isFrozen(rig), true);
  assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(rig.getDiagnostics().useLegacyLights, false);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.ok([THREE.VSMShadowMap, THREE.PCFSoftShadowMap].includes(renderer.shadowMap.type));
  assert.equal(scene.environment, rig.environmentTexture);
  assert.equal(rig.environmentTexture.isDataTexture, true);
  assert.equal(rig.environmentTexture.type, THREE.FloatType);
  assert.equal(rig.environmentTexture.mapping, THREE.EquirectangularReflectionMapping);
  assert.equal(rig.environmentTexture.needsPMREMUpdate, true);
  assert.equal(rig.environmentTexture.image.width, 64);
  assert.equal(rig.environmentTexture.image.height, 32);
  assert.ok(Math.max(...rig.environmentTexture.image.data) > 1, 'HDR environment must retain radiance above display white');

  const lights = [];
  rig.group.traverse((object) => {
    if (object.isLight) lights.push(object);
  });
  assert.equal(lights.filter((light) => light.isDirectionalLight).length, 3);
  assert.equal(lights.filter((light) => light.isHemisphereLight).length, 1);
  assert.equal(lights.filter((light) => light.isSpotLight).length, 6);
  assert.equal(lights.filter((light) => light.isPointLight).length, 0);
  assert.equal(lights.filter((light) => light.isPointLight || light.isSpotLight).every((light) => light.decay === 2), true);
  assert.equal(lights.filter((light) => light.isSpotLight && light.castShadow).length, 2);
  assert.equal(lights.filter((light) => light.isSpotLight && !light.castShadow).length, 4);
  assert.equal(lights.filter((light) => light.castShadow).length, 5);
  assert.equal(lights.find((light) => light.name.endsWith('.Sun')).shadow.mapSize.x, 4_096);
  assert.equal(
    lights.filter((light) => light.isSpotLight && light.castShadow)
      .every((light) => light.shadow.mapSize.x === 2_048),
    true
  );
  assert.equal(
    lights.filter((light) => light.isSpotLight).every((light) => light.visible && light.intensity === 0),
    true,
    'startup keeps zero-intensity tunnel spots render-visible so the first off-clock render allocates shadow maps'
  );
  assert.equal(rig.getDiagnostics().localShadowPrewarmUpdatesRemaining, 1);
  assert.equal(rig.getDiagnostics().localShadowPrewarmScheduledCount, 1);

  const beforeViewSwitch = rig.update({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.thunderstorm.profile,
    lightningPulse: 0.7,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    anchor: { x: 12.345, y: 2.789, z: -45.678 },
    forward: { x: 0.22, y: 0, z: -0.98 },
    up: { x: 0, y: 1, z: 0 },
    viewMode: 0
  });
  const diagnosticsBefore = rig.getDiagnostics();
  assert.equal(diagnosticsBefore.localShadowPrewarmUpdatesRemaining, 0);
  assert.equal(diagnosticsBefore.localShadowPrewarmScheduledCount, 2);
  const afterViewSwitch = rig.update({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.thunderstorm.profile,
    lightningPulse: 0.7,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    anchor: { x: 12.345, y: 2.789, z: -45.678 },
    forward: { x: 0.22, y: 0, z: -0.98 },
    up: { x: 0, y: 1, z: 0 },
    viewMode: 3
  });
  const diagnosticsAfter = rig.getDiagnostics();

  assert.equal(beforeViewSwitch.illuminationSignature, afterViewSwitch.illuminationSignature);
  assert.equal(diagnosticsBefore.illuminationSignature, diagnosticsAfter.illuminationSignature);
  assert.equal(diagnosticsAfter.shadowMapEnabled, true);
  assert.equal(diagnosticsAfter.primaryShadowMapSize, 4_096);
  assert.equal(diagnosticsAfter.localShadowMapSize, 2_048);
  assert.equal('guideShadowMapSize' in diagnosticsAfter, false);
  assert.equal(diagnosticsAfter.realLightCount, 10);
  assert.equal(diagnosticsAfter.shadowLightCount, 5);
  assert.equal(diagnosticsAfter.tunnelShadowSpotCount, 2);
  assert.equal(diagnosticsAfter.activeTunnelLightCount, 0);
  assert.equal(diagnosticsAfter.fixtureEmitterMode, 'inactive');
  assert.equal(diagnosticsAfter.tunnelFallbackActivationCount, 0);
  assert.equal(diagnosticsAfter.cameraFollowingGuideLightCount, 0);
  assert.equal(diagnosticsAfter.inverseSquareLocalLightCount, diagnosticsAfter.physicalLocalLightCount);
  assert.equal(diagnosticsAfter.environmentIsDataTexture, true);
  assert.equal(diagnosticsAfter.environmentMapping, 'equirectangular-reflection');
  assert.equal(diagnosticsAfter.environmentFloatType, true);
  assert.ok(diagnosticsAfter.shadowAnchorErrorM <= diagnosticsAfter.shadowTexelWorldSizeM * Math.sqrt(3) * 0.5 + 0.000_001);
  diagnosticsAfter.shadowAnchor.forEach((coordinate) => {
    const gridUnits = coordinate / diagnosticsAfter.shadowTexelWorldSizeM;
    assert.ok(Math.abs(gridUnits - Math.round(gridUnits)) <= 0.000_001);
  });
  assert.equal(Object.isFrozen(diagnosticsAfter), true);

  const fixtureRecords = Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze({
    id: `fixture-${index}`,
    coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: Object.freeze({ x: 102 + index * 4, y: 6, z: -210 - index * 8 }),
    tileLocalPosition: Object.freeze({ x: 2 + index * 4, y: 6, z: -10 - index * 8 }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
    color: 0xff_d5a0,
    intensity: 1_400,
    distance: 30,
    kind: 'tunnel-ceiling-fixture',
    edge: 'tunnel-edge',
    edgeS: 100 + index * 8,
    profile: 'tunnel-profile',
    powerMode: 'constant-on'
  })));
  rig.update({
    zoneIndex: 4,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeId: 'tunnel-edge',
    routeEdgeS: 100,
    tunnelProfileId: 'tunnel-profile',
    anchor: { x: 2, y: 1, z: -10 },
    renderOrigin: { x: 100, y: 0, z: -200 },
    fixtureEmitters: fixtureRecords
  });
  const fixtureDiagnostics = rig.getDiagnostics();
  const tunnelLights = lights.filter((light) => light.isSpotLight);
  assert.equal(fixtureDiagnostics.tunnelEmitterMode, 'authored-fixture-records');
  assert.equal(fixtureDiagnostics.fixtureEmitterMode, 'authored-fixture-records');
  assert.equal(fixtureDiagnostics.availableFixtureEmitterRecordCount, 6);
  assert.equal(fixtureDiagnostics.eligibleFixtureEmitterRecordCount, 6);
  assert.equal(fixtureDiagnostics.reachableFixtureEmitterRecordCount, 6);
  assert.equal(fixtureDiagnostics.matchedFixtureEmitterRecordCount, 6);
  assert.equal(fixtureDiagnostics.availableTunnelEmitterRecordCount, 6);
  assert.equal(fixtureDiagnostics.matchedTunnelEmitterRecordCount, 6);
  assert.equal(fixtureDiagnostics.requestedFixtureRouteEdgeId, 'tunnel-edge');
  assert.equal(fixtureDiagnostics.requestedTunnelProfileId, 'tunnel-profile');
  assert.deepEqual(fixtureDiagnostics.activeTunnelEmitterIds, fixtureRecords.map((record) => record.id));
  assert.deepEqual(fixtureDiagnostics.activeFixtureEmitterIds, fixtureRecords.map((record) => record.id));
  assert.ok(fixtureDiagnostics.nearestAvailableFixtureDistanceM < fixtureRecords[0].distance);
  assert.equal(
    fixtureDiagnostics.nearestMatchedFixtureDistanceM,
    fixtureDiagnostics.nearestAvailableFixtureDistanceM
  );
  assert.equal(fixtureDiagnostics.tunnelFixtureAlignmentMaximumErrorM, 0);
  tunnelLights.forEach((light, index) => {
    assert.equal(light.position.x, fixtureRecords[index].absolutePosition.x - 100);
    assert.equal(light.position.y, fixtureRecords[index].absolutePosition.y);
    assert.equal(light.position.z, fixtureRecords[index].absolutePosition.z + 200);
    assert.equal(light.distance, fixtureRecords[index].distance);
    assert.equal(
      light.intensity,
      fixtureRecords[index].intensity,
      'a constant-on authored tunnel fixture must not brighten as the player approaches'
    );
  });

  const bridgeFixtureRecords = Object.freeze(fixtureRecords.map((record, index) => Object.freeze({
    ...record,
    id: `bridge-fixture-${index}`,
    kind: 'bridge-soffit-fixture',
    edge: 'bridge-edge',
    profile: null,
    intensity: 1_100,
    distance: 26,
    absolutePosition: Object.freeze({ x: 101 + index * 3, y: 6, z: -209 - index * 2 })
  })));
  const mixedFixtureRecords = Object.freeze([...bridgeFixtureRecords, ...fixtureRecords]);
  rig.update({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.cloudy.profile,
    covered: false,
    underpassBlend: 1,
    tunnelKind: null,
    routeEdgeId: 'bridge-edge',
    anchor: { x: 2, y: 1, z: -10 },
    renderOrigin: { x: 100, y: 0, z: -200 },
    fixtureEmitters: mixedFixtureRecords
  });
  const bridgeKindSelection = rig.getDiagnostics();
  assert.equal(bridgeKindSelection.availableFixtureEmitterRecordCount, 12);
  assert.equal(bridgeKindSelection.eligibleFixtureEmitterRecordCount, 6);
  assert.deepEqual(bridgeKindSelection.activeFixtureEmitterIds, bridgeFixtureRecords.map((record) => record.id));
  assert.equal(bridgeKindSelection.activeTunnelLightCount, 6);
  assert.ok(bridgeKindSelection.openUnderpassFixtureActivation > 0);
  assert.ok(
    bridgeKindSelection.estimatedOpenFixtureRoadIlluminance
      <= bridgeKindSelection.openUnderpassFixtureIlluminanceBudget + 0.000_001
  );
  assert.ok(
    bridgeKindSelection.openFixtureToSunRatio
      <= PHYSICAL_LIGHTING_CONTRACT.lights.openUnderpassSolarDominanceRatio + 0.000_001
  );
  assert.ok(bridgeKindSelection.openFixtureToSunRatio < 1);
  assert.equal(tunnelLights.every((light) => light.intensity < 1_100), true);

  rig.update({
    zoneIndex: 1,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: false,
    underpassBlend: 1,
    tunnelKind: null,
    routeEdgeId: 'bridge-edge',
    anchor: { x: 2, y: 1, z: -10 },
    renderOrigin: { x: 100, y: 0, z: -200 },
    fixtureEmitters: mixedFixtureRecords
  });
  const sunlitBridgeSelection = rig.getDiagnostics();
  assert.equal(sunlitBridgeSelection.fixtureEmitterMode, 'inactive');
  assert.equal(sunlitBridgeSelection.eligibleFixtureEmitterRecordCount, 0);
  assert.equal(sunlitBridgeSelection.activeTunnelLightCount, 0);
  assert.equal(sunlitBridgeSelection.openUnderpassFixtureActivation, 0);
  assert.equal(sunlitBridgeSelection.estimatedOpenFixtureRoadIlluminance, 0);

  rig.update({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.cloudy.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeId: 'tunnel-edge',
    routeEdgeS: 100,
    tunnelProfileId: 'tunnel-profile',
    anchor: { x: 2, y: 1, z: -10 },
    renderOrigin: { x: 100, y: 0, z: -200 },
    fixtureEmitters: mixedFixtureRecords
  });
  const tunnelKindSelection = rig.getDiagnostics();
  assert.equal(tunnelKindSelection.availableFixtureEmitterRecordCount, 12);
  assert.equal(tunnelKindSelection.eligibleFixtureEmitterRecordCount, 6);
  assert.deepEqual(tunnelKindSelection.activeFixtureEmitterIds, fixtureRecords.map((record) => record.id));

  const unreachableBridgeFixtureRecords = Object.freeze(bridgeFixtureRecords.map((record, index) => Object.freeze({
    ...record,
    id: `far-bridge-fixture-${index}`,
    absolutePosition: Object.freeze({ x: 602 + index * 4, y: 6, z: -710 - index * 8 })
  })));
  rig.update({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.cloudy.profile,
    covered: false,
    underpassBlend: 1,
    tunnelKind: null,
    routeEdgeId: 'bridge-edge',
    anchor: { x: 2, y: 1, z: -10 },
    renderOrigin: { x: 100, y: 0, z: -200 },
    fixtureEmitters: unreachableBridgeFixtureRecords
  });
  const openBridgeWithFarFixtures = rig.getDiagnostics();
  assert.equal(openBridgeWithFarFixtures.fixtureEmitterMode, 'inactive');
  assert.equal(openBridgeWithFarFixtures.eligibleFixtureEmitterRecordCount, 6);
  assert.equal(openBridgeWithFarFixtures.reachableFixtureEmitterRecordCount, 0);
  assert.equal(openBridgeWithFarFixtures.matchedFixtureEmitterRecordCount, 0);
  assert.equal(openBridgeWithFarFixtures.activeTunnelLightCount, 0);
  assert.ok(openBridgeWithFarFixtures.nearestAvailableFixtureDistanceM > 400);

  const unreachableTunnelFixtureRecords = Object.freeze(fixtureRecords.map((record, index) => Object.freeze({
    ...record,
    id: `far-tunnel-fixture-${index}`,
    absolutePosition: Object.freeze({ x: 602 + index * 4, y: 6, z: -710 - index * 8 })
  })));
  rig.update({
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.cloudy.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeId: 'tunnel-edge',
    routeEdgeS: 100,
    tunnelProfileId: 'tunnel-profile',
    anchor: { x: 2, y: 1, z: -10 },
    renderOrigin: { x: 100, y: 0, z: -200 },
    fixtureEmitters: unreachableTunnelFixtureRecords
  });
  const sealedTunnelWithFarFixtures = rig.getDiagnostics();
  assert.equal(sealedTunnelWithFarFixtures.fixtureEmitterMode, 'inactive');
  assert.equal(sealedTunnelWithFarFixtures.eligibleFixtureEmitterRecordCount, 6);
  assert.equal(sealedTunnelWithFarFixtures.matchedFixtureEmitterRecordCount, 0);
  assert.equal(sealedTunnelWithFarFixtures.activeTunnelLightCount, 0);
  assert.equal(sealedTunnelWithFarFixtures.tunnelFallbackActivationCount, 0);

  assert.equal(rig.dispose(), true);
  assert.equal(rig.dispose(), false);
  assert.equal(scene.children.includes(rig.group), false);
  assert.notEqual(scene.environment, rig.environmentTexture);
  assert.equal(renderer.outputColorSpace, 'legacy-output');
  assert.equal(renderer.shadowMap.enabled, false);
});

test('dynamic tunnel spots scan, prewarm, bind, and retain local shadow resources only in High', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
    initialRenderQualityId: 'medium'
  });
  const tunnelLights = [];
  rig.group.traverse((object) => {
    if (object.isSpotLight) tunnelLights.push(object);
  });
  const makeFixtures = (prefix) => Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze({
    id: `${prefix}-${index}`,
    coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: Object.freeze({ x: index * 5, y: 6, z: -20 - index * 7 }),
    tileLocalPosition: Object.freeze({ x: index * 5, y: 6, z: -20 - index * 7 }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
    color: 0xff_d5a0,
    intensity: 1_400,
    distance: 30,
    kind: 'tunnel-ceiling-fixture',
    edge: `${prefix}-edge`,
    edgeS: 100 + index * 8,
    profile: `${prefix}-profile`,
    powerMode: 'constant-on'
  })));
  const oldFixtures = makeFixtures('old');
  const newFixtures = makeFixtures('new');
  const makeInput = (prefix, fixtureEmitters) => ({
    zoneIndex: 4,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeId: `${prefix}-edge`,
    routeEdgeS: 100,
    tunnelProfileId: `${prefix}-profile`,
    anchor: { x: 0, y: 1, z: 0 },
    renderOrigin: { x: 0, y: 0, z: 0 },
    fixtureEmitters
  });
  const assertDynamicDetailOff = (diagnostics) => {
    assert.equal(diagnostics.dynamicLocalFixtureLightsEnabled, false);
    assert.equal(diagnostics.scannedFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.availableFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.eligibleFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.reachableFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.matchedFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.activeTunnelLightCount, 0);
    assert.equal(diagnostics.activeTunnelShadowLightCount, 0);
    assert.equal(diagnostics.localShadowPrewarmUpdatesRemaining, 0);
    assert.equal(diagnostics.localShadowPrewarmScheduledCount, 0);
    assert.deepEqual(diagnostics.activeFixtureEmitterIds, []);
    assert.deepEqual(diagnostics.activeTunnelSpotEmitterIds, []);
    assert.equal(tunnelLights.every((light) => !light.visible && light.intensity === 0), true);
  };

  // Low/Medium must return before even reading the emitter array, not merely discard it after matching work.
  let mediumEmitterReadCount = 0;
  const mediumInput = makeInput('old', oldFixtures);
  Object.defineProperty(mediumInput, 'fixtureEmitters', {
    enumerable: true,
    get() {
      mediumEmitterReadCount++;
      return oldFixtures;
    }
  });
  rig.update(mediumInput);
  assert.equal(mediumEmitterReadCount, 0);
  assertDynamicDetailOff(rig.getDiagnostics());

  rig.setRenderQuality('low');
  rig.update(makeInput('old', oldFixtures));
  assertDynamicDetailOff(rig.getDiagnostics());

  const highResult = rig.setRenderQuality('high');
  assert.equal(highResult.dynamicLocalFixtureLights, true);
  assert.equal(rig.getDiagnostics().localShadowPrewarmUpdatesRemaining, 2);
  rig.update(makeInput('old', oldFixtures));
  let highDiagnostics = rig.getDiagnostics();
  assert.equal(highDiagnostics.dynamicLocalFixtureLightsEnabled, true);
  assert.equal(highDiagnostics.scannedFixtureEmitterRecordCount, 6);
  assert.equal(highDiagnostics.matchedFixtureEmitterRecordCount, 6);
  assert.equal(highDiagnostics.activeTunnelLightCount, 6);
  assert.equal(highDiagnostics.activeTunnelShadowLightCount, 2);
  assert.equal(highDiagnostics.localShadowPrewarmUpdatesRemaining, 1);
  assert.equal(highDiagnostics.localShadowPrewarmScheduledCount, 1);
  assert.deepEqual(highDiagnostics.activeFixtureEmitterIds, oldFixtures.map(({ id }) => id));
  rig.update(makeInput('old', oldFixtures));
  highDiagnostics = rig.getDiagnostics();
  assert.equal(highDiagnostics.localShadowPrewarmUpdatesRemaining, 0);
  assert.equal(highDiagnostics.localShadowPrewarmScheduledCount, 2);

  let disposedLocalTargets = 0;
  for (const light of tunnelLights) {
    light.shadow.map = { dispose: () => { disposedLocalTargets++; } };
    light.shadow.mapPass = { dispose: () => { disposedLocalTargets++; } };
  }
  // No shadow-size change is requested here: quality ownership alone must synchronously release local targets.
  const mediumResult = rig.setRenderQuality('medium');
  assert.equal(mediumResult.dynamicLocalFixtureLights, false);
  assert.equal(disposedLocalTargets, tunnelLights.length * 2);
  for (const light of tunnelLights) {
    assert.equal(light.shadow.map, null);
    assert.equal(light.shadow.mapPass, null);
  }
  assertDynamicDetailOff(rig.getDiagnostics());
  rig.update(makeInput('old', oldFixtures));
  assertDynamicDetailOff(rig.getDiagnostics());

  rig.setRenderQuality('high');
  assert.equal(rig.getDiagnostics().localShadowPrewarmUpdatesRemaining, 2);
  rig.update(makeInput('new', newFixtures));
  const restoredHigh = rig.getDiagnostics();
  assert.equal(restoredHigh.scannedFixtureEmitterRecordCount, 6);
  assert.equal(restoredHigh.matchedFixtureEmitterRecordCount, 6);
  assert.equal(restoredHigh.activeTunnelShadowLightCount, 2);
  assert.deepEqual(restoredHigh.activeFixtureEmitterIds, newFixtures.map(({ id }) => id));
  assert.equal(restoredHigh.activeFixtureEmitterIds.some((id) => id.startsWith('old-')), false);
  assert.equal(restoredHigh.cameraFixtureIdentityHandoffCount, 0);
  assert.equal(restoredHigh.tunnelSpotHandoffCount, 0);
  assert.equal(rig.dispose(), true);
});

test('tunnel preview requires matching route, profile, route reach, and physical world reach', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene,
    camera,
    initialRenderQualityId: 'high'
  });
  const makeFixture = ({ id, edge = 'preview-edge', profile = 'underground-preview', edgeS, x, z }) => Object.freeze({
    id,
    coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: Object.freeze({ x, y: 6, z }),
    tileLocalPosition: Object.freeze({ x, y: 6, z }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
    color: 0xff_d5a0,
    intensity: 1_400,
    distance: 30,
    kind: 'tunnel-ceiling-fixture',
    edge,
    edgeS,
    profile,
    powerMode: 'constant-on'
  });
  const matchingFixtures = Object.freeze([
    makeFixture({ id: 'matching-192', edgeS: 192, x: 18, z: -26 }),
    makeFixture({ id: 'matching-200', edgeS: 200, x: 26, z: -34 }),
    makeFixture({ id: 'matching-208', edgeS: 208, x: 34, z: -42 }),
    makeFixture({ id: 'matching-216', edgeS: 216, x: 42, z: -50 }),
    makeFixture({ id: 'matching-224', edgeS: 224, x: 50, z: -58 }),
    makeFixture({ id: 'matching-232', edgeS: 232, x: 58, z: -66 })
  ]);
  const reachRejectedFixtures = Object.freeze([
    makeFixture({ id: 'route-only-world-far', edgeS: 204, x: 300, z: 0 }),
    makeFixture({ id: 'world-only-route-far', edgeS: 480, x: 24, z: -28 })
  ]);
  const rejectedFixtures = Object.freeze([
    makeFixture({ id: 'wrong-route', edge: 'other-edge', edgeS: 200, x: 2, z: -2 }),
    makeFixture({ id: 'wrong-profile', profile: 'mountain-preview', edgeS: 200, x: 3, z: -3 })
  ]);

  const previewInput = {
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.cloudy.profile,
    covered: false,
    underpassBlend: 0,
    previewTunnelKind: 'underground-tunnel',
    previewTunnelDistanceM: 180,
    previewRouteEdgeId: 'preview-edge',
    previewRouteEdgeS: 200,
    previewTunnelProfileId: 'underground-preview',
    routeEdgeId: 'current-open-edge',
    routeEdgeS: 12,
    anchor: { x: 0, y: 1, z: 0 },
    renderOrigin: { x: 0, y: 0, z: 0 },
    fixtureEmitters: Object.freeze([
      ...matchingFixtures,
      ...reachRejectedFixtures,
      ...rejectedFixtures
    ])
  };
  rig.update(previewInput);
  const diagnostics = rig.getDiagnostics();

  assert.equal(diagnostics.tunnelEmitterMode, 'authored-fixture-preview');
  assert.equal(diagnostics.fixtureEmitterMode, 'authored-fixture-preview');
  assert.equal(diagnostics.requestedFixtureRouteEdgeId, 'preview-edge');
  assert.equal(diagnostics.requestedFixtureRouteEdgeS, 200);
  assert.equal(diagnostics.requestedTunnelProfileId, 'underground-preview');
  assert.equal(diagnostics.availableFixtureEmitterRecordCount, 10);
  assert.equal(diagnostics.eligibleFixtureEmitterRecordCount, 8);
  assert.equal(diagnostics.reachableFixtureEmitterRecordCount, 6);
  assert.equal(diagnostics.matchedFixtureEmitterRecordCount, 6);
  const expectedMatchingIds = [...matchingFixtures]
    .sort((left, right) => (
      left.absolutePosition.x ** 2 + (left.absolutePosition.y - 1) ** 2 + left.absolutePosition.z ** 2
      - right.absolutePosition.x ** 2 - (right.absolutePosition.y - 1) ** 2 - right.absolutePosition.z ** 2
    ))
    .map((record) => record.id);
  assert.deepEqual(diagnostics.activeFixtureEmitterIds, expectedMatchingIds);
  assert.equal(diagnostics.activeFixtureEmitterIds.includes('wrong-route'), false);
  assert.equal(diagnostics.activeFixtureEmitterIds.includes('wrong-profile'), false);
  assert.equal(diagnostics.activeFixtureEmitterIds.includes('route-only-world-far'), false);
  assert.equal(diagnostics.activeFixtureEmitterIds.includes('world-only-route-far'), false);
  assert.ok(
    diagnostics.nearestMatchedFixtureDistanceM
      <= PHYSICAL_LIGHTING_CONTRACT.lights.tunnelPreviewMaximumDistanceM
  );
  assert.equal(diagnostics.activeTunnelLightCount, 6);
  assert.equal(diagnostics.tunnelFallbackActivationCount, 0);
  assert.equal(diagnostics.tunnelApproachActivation, 1);
  assert.deepEqual(diagnostics.fixtureSelectionAnchor, [0, 1, 0]);

  const tunnelLights = [];
  rig.group.traverse((object) => {
    if (object.isSpotLight) tunnelLights.push(object);
  });
  for (const previewTunnelDistanceM of [40, 180, 240]) {
    rig.update({ ...previewInput, previewTunnelDistanceM });
    tunnelLights.forEach((light) => {
      assert.equal(
        light.intensity,
        1_400,
        'constant-on fixture power changed with approach distance'
      );
    });
  }

  const filmViewpoint = { x: 60, y: 1, z: -68 };
  rig.update({ ...previewInput, fixtureSelectionAnchor: filmViewpoint });
  const filmDiagnostics = rig.getDiagnostics();
  const expectedFilmIds = [...matchingFixtures]
    .sort((left, right) => {
      const squaredDistance = (record) => (
        (record.absolutePosition.x - filmViewpoint.x) ** 2
        + (record.absolutePosition.y - filmViewpoint.y) ** 2
        + (record.absolutePosition.z - filmViewpoint.z) ** 2
      );
      return squaredDistance(left) - squaredDistance(right);
    })
    .map((record) => record.id);
  assert.deepEqual(filmDiagnostics.fixtureSelectionAnchor, [60, 1, -68]);
  assert.deepEqual(filmDiagnostics.activeFixtureEmitterIds, expectedFilmIds);

  assert.equal(rig.dispose(), true);
});

test('tunnel dynamic detail fades across the old 144 metre cutoff and hands a seventh fixture over in-place', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const createRig = () => createPhysicalLightingRig({
    THREE,
    renderer: { ...renderer, shadowMap: { ...renderer.shadowMap } },
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
    initialRenderQualityId: 'high'
  });
  const makeFixture = (id, x, edgeS) => Object.freeze({
    id,
    coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: Object.freeze({ x, y: 6, z: 0 }),
    tileLocalPosition: Object.freeze({ x, y: 6, z: 0 }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
    color: 0xff_d5a0,
    intensity: 1_400,
    distance: 30,
    kind: 'tunnel-ceiling-fixture',
    edge: 'handoff-edge',
    edgeS,
    profile: 'handoff-profile',
    powerMode: 'constant-on'
  });
  const sharedInput = {
    zoneIndex: 4,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeId: 'handoff-edge',
    routeEdgeS: 130,
    tunnelProfileId: 'handoff-profile',
    anchor: { x: 0, y: 1, z: 0 },
    renderOrigin: { x: 0, y: 0, z: 0 }
  };

  const cutoffRig = createRig();
  const cutoffFixture = Object.freeze([makeFixture('cutoff-fixture', 0, 130)]);
  cutoffRig.update({
    ...sharedInput,
    fixtureSelectionAnchor: { x: -144, y: 6, z: 0 },
    fixtureEmitters: cutoffFixture
  });
  const cutoffLight = [];
  cutoffRig.group.traverse((object) => {
    if (object.isSpotLight) cutoffLight.push(object);
  });
  assert.equal(cutoffLight[0].intensity, 1_400);
  cutoffRig.update({
    ...sharedInput,
    fixtureSelectionAnchor: { x: -144.1, y: 6, z: 0 },
    fixtureEmitters: cutoffFixture
  });
  assert.ok(cutoffLight[0].intensity > 1_399, '144.1m still caused the old one-frame blackout');
  assert.equal(cutoffRig.getDiagnostics().activeTunnelLightCount, 1);
  cutoffRig.dispose();

  const handoffRig = createRig();
  const fixtures = Object.freeze(Array.from(
    { length: 7 },
    (_, index) => makeFixture(`handoff-${index}`, index * 20, 100 + index * 10)
  ));
  handoffRig.update({
    ...sharedInput,
    fixtureSelectionAnchor: { x: 0, y: 6, z: 0 },
    fixtureEmitters: fixtures
  });
  const before = handoffRig.getDiagnostics();
  assert.deepEqual(before.activeTunnelSpotEmitterIds, [
    'handoff-0', 'handoff-1', 'handoff-2', 'handoff-3', 'handoff-4', 'handoff-5'
  ]);
  handoffRig.update({
    ...sharedInput,
    fixtureSelectionAnchor: { x: 120, y: 6, z: 0 },
    fixtureEmitters: fixtures
  });
  const during = handoffRig.getDiagnostics();
  assert.equal(during.activeFixtureEmitterIds.includes('handoff-6'), true);
  assert.equal(during.activeTunnelSpotEmitterIds.includes('handoff-0'), true);
  assert.equal(during.activeTunnelSpotEmitterIds.includes('handoff-6'), false);
  assert.equal(during.tunnelSpotPendingEmitterCount, 1);
  assert.equal(during.tunnelSpotHandoffCount, 1);
  for (let frame = 0; frame < 3; frame++) {
    handoffRig.update({
      ...sharedInput,
      fixtureSelectionAnchor: { x: 120, y: 6, z: 0 },
      fixtureEmitters: fixtures
    });
  }
  const after = handoffRig.getDiagnostics();
  assert.equal(after.activeTunnelSpotEmitterIds.includes('handoff-0'), false);
  assert.equal(after.activeTunnelSpotEmitterIds.includes('handoff-6'), true);
  assert.equal(after.tunnelSpotCount, 6);
  assert.equal(after.tunnelShadowSpotCount, 2);
  handoffRig.dispose();
});

test('Film cross-identity changes fade old exact emitters before reusing the fixed six slots', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
    initialRenderQualityId: 'high'
  });
  const makeFixture = ({ id, edge, profile, edgeS, x }) => Object.freeze({
    id,
    coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: Object.freeze({ x, y: 6, z: -20 }),
    tileLocalPosition: Object.freeze({ x, y: 6, z: -20 }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
    color: 0xff_d5a0,
    intensity: 1_400,
    distance: 30,
    kind: 'tunnel-ceiling-fixture',
    edge,
    edgeS,
    profile,
    powerMode: 'constant-on'
  });
  const playerFixtures = Array.from({ length: 6 }, (_, index) => makeFixture({
    id: `player-${index}`,
    edge: 'player-edge',
    profile: 'player-profile',
    edgeS: 100 + index * 8,
    x: index * 6
  }));
  const filmFixtures = Array.from({ length: 6 }, (_, index) => makeFixture({
    id: `film-${index}`,
    edge: 'film-edge',
    profile: 'film-profile',
    edgeS: 400 + index * 8,
    x: 500 + index * 6
  }));
  const fixtureEmitters = Object.freeze([...playerFixtures, ...filmFixtures]);
  const filmInput = {
    zoneIndex: 4,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeId: 'player-edge',
    routeEdgeS: 100,
    tunnelProfileId: 'player-profile',
    anchor: { x: 0, y: 1, z: -20 },
    fixtureSelectionMode: 'camera-visual',
    renderOrigin: { x: 0, y: 0, z: 0 },
    fixtureEmitters
  };
  rig.update({ ...filmInput, fixtureSelectionAnchor: { x: 0, y: 6, z: -20 } });
  const initialDiagnostics = rig.getDiagnostics();
  assert.equal(initialDiagnostics.requestedFixtureRouteEdgeId, 'player-edge');
  assert.equal(
    initialDiagnostics.activeTunnelSpotEmitterIds.every((id) => id.startsWith('player-')),
    true
  );
  const tunnelLights = [];
  rig.group.traverse((object) => {
    if (object.isSpotLight) tunnelLights.push(object);
  });
  const initialPositions = tunnelLights.map((light) => light.position.toArray());
  assert.equal(tunnelLights.every((light) => light.intensity === 1_400), true);

  rig.update({ ...filmInput, fixtureSelectionAnchor: { x: 500, y: 6, z: -20 } });
  const transitionDiagnostics = rig.getDiagnostics();
  assert.equal(transitionDiagnostics.fixtureSelectionIdentitySource, 'camera-authored-route');
  assert.equal(transitionDiagnostics.fixtureEmitterMode, 'authored-fixture-camera-route');
  assert.equal(transitionDiagnostics.requestedFixtureRouteEdgeId, 'film-edge');
  assert.equal(transitionDiagnostics.requestedTunnelProfileId, 'film-profile');
  assert.equal(
    transitionDiagnostics.activeFixtureEmitterIds.every((id) => id.startsWith('film-')),
    true
  );
  assert.equal(
    transitionDiagnostics.activeTunnelSpotEmitterIds.every((id) => id.startsWith('player-')),
    true,
    'old exact group must remain bound while it fades'
  );
  assert.equal(
    transitionDiagnostics.activeTunnelSpotIdentityKeys.every(
      (key) => key === 'player-edge\u0000player-profile'
    ),
    true
  );
  assert.equal(transitionDiagnostics.tunnelIdentityTransitionPending, true);
  assert.equal(transitionDiagnostics.tunnelSpotPendingEmitterCount, 6);
  assert.equal(transitionDiagnostics.tunnelSpotHandoffCount, 6);
  assert.deepEqual(tunnelLights.map((light) => light.position.toArray()), initialPositions);
  assert.equal(
    tunnelLights.every((light) => light.intensity > 0 && light.intensity < 1_400),
    true,
    'identity cut teleported a new full-power light into a reused slot'
  );

  rig.update({ ...filmInput, fixtureSelectionAnchor: { x: 500, y: 6, z: -20 } });
  assert.deepEqual(tunnelLights.map((light) => light.position.toArray()), initialPositions);
  assert.ok(tunnelLights.every((light) => Math.abs(light.intensity / 1_400 - 0.32) < 0.000_001));
  rig.update({ ...filmInput, fixtureSelectionAnchor: { x: 500, y: 6, z: -20 } });
  // The linear fade reaches zero inside the third reference frame. Only the remaining fraction of that frame
  // may illuminate the new group; the old update-count implementation instead inserted two artificial dark frames.
  assert.equal(rig.getDiagnostics().activeTunnelSpotEmitterIds.every((id) => id.startsWith('film-')), true);
  assert.ok(tunnelLights.every((light) => light.intensity > 0 && light.intensity < 140));
  assert.notDeepEqual(
    tunnelLights.map((light) => light.position.toArray()),
    initialPositions,
    'a slot may move only after its outgoing light has reached zero'
  );

  rig.update({ ...filmInput, fixtureSelectionAnchor: { x: 500, y: 6, z: -20 } });
  const fadedInDiagnostics = rig.getDiagnostics();
  assert.equal(fadedInDiagnostics.activeTunnelSpotEmitterIds.length, 6);
  assert.equal(
    tunnelLights.every((light) => light.intensity > 0 && light.intensity < 1_400),
    true
  );

  for (let frame = 0; frame < 20; frame++) {
    rig.update({ ...filmInput, fixtureSelectionAnchor: { x: 500, y: 6, z: -20 } });
  }
  const settledDiagnostics = rig.getDiagnostics();
  assert.equal(settledDiagnostics.activeTunnelSpotEmitterIds.length, 6);
  assert.equal(
    settledDiagnostics.activeTunnelSpotEmitterIds.every((id) => id.startsWith('film-')),
    true
  );
  assert.equal(
    settledDiagnostics.activeTunnelSpotIdentityKeys.every(
      (key) => key === 'film-edge\u0000film-profile'
    ),
    true
  );
  assert.equal(settledDiagnostics.tunnelIdentityTransitionPending, false);
  assert.equal(settledDiagnostics.activeTunnelLightCount, 6);
  assert.equal(settledDiagnostics.tunnelSpotCount, 6);
  assert.equal(settledDiagnostics.tunnelShadowSpotCount, 2);
  assert.equal(tunnelLights.every((light) => light.intensity > 1_399), true);
  assert.equal(rig.dispose(), true);
});

test('covered tunnels fail closed without exact edge and profile identity instead of spawning fallback lights', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
    initialRenderQualityId: 'high'
  });
  const fixture = Object.freeze({
    id: 'strict-tunnel-fixture',
    coordinateMode: 'absolute-world-and-tile-local',
    absolutePosition: Object.freeze({ x: 12, y: 6, z: -18 }),
    tileLocalPosition: Object.freeze({ x: 12, y: 6, z: -18 }),
    direction: Object.freeze({ x: 0, y: -1, z: 0 }),
    color: 0xff_d5a0,
    intensity: 1_400,
    distance: 30,
    kind: 'tunnel-ceiling-fixture',
    edge: 'strict-edge',
    edgeS: 100,
    profile: 'strict-profile',
    powerMode: 'constant-on'
  });
  const sharedInput = {
    zoneIndex: 4,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel',
    routeEdgeS: 100,
    anchor: { x: 0, y: 1, z: 0 },
    renderOrigin: { x: 0, y: 0, z: 0 },
    fixtureEmitters: Object.freeze([fixture])
  };

  for (const incompleteIdentity of [
    { tunnelProfileId: 'strict-profile' },
    { routeEdgeId: 'strict-edge' }
  ]) {
    rig.update({ ...sharedInput, ...incompleteIdentity });
    const diagnostics = rig.getDiagnostics();
    assert.equal(diagnostics.fixtureEmitterMode, 'inactive');
    assert.equal(diagnostics.eligibleFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.matchedFixtureEmitterRecordCount, 0);
    assert.equal(diagnostics.activeTunnelLightCount, 0);
    assert.equal(diagnostics.tunnelFallbackActivationCount, 0);
  }

  rig.update({
    ...sharedInput,
    routeEdgeId: 'strict-edge',
    tunnelProfileId: 'strict-profile'
  });
  const completeIdentity = rig.getDiagnostics();
  assert.equal(completeIdentity.fixtureEmitterMode, 'authored-fixture-records');
  assert.deepEqual(completeIdentity.activeFixtureEmitterIds, [fixture.id]);
  assert.equal(completeIdentity.activeTunnelLightCount, 1);
  assert.equal(completeIdentity.tunnelFallbackActivationCount, 0);
  assert.equal(rig.dispose(), true);
});

test('every render tier bakes enclosure intensity into HDR and refreshes the environment through a portal', () => {
  const tierInputs = Object.freeze({
    low: Object.freeze({ primary: 1_024, local: 512 }),
    medium: Object.freeze({ primary: 2_048, local: 1_024 }),
    high: Object.freeze({
      sunShadowMapSize: 4_096,
      secondaryDirectionalShadowMapSize: 4_096,
      localShadowMapSize: 2_048
    })
  });

  for (const renderQualityId of Object.keys(tierInputs)) {
    const renderer = {
      outputColorSpace: 'legacy-output',
      toneMapping: -1,
      toneMappingExposure: 0.8,
      capabilities: { maxTextureSize: 4_096 },
      shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
    };
    const rig = createPhysicalLightingRig({
      THREE,
      renderer,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
      initialRenderQualityId: renderQualityId
    });
    rig.setRenderQuality(renderQualityId, tierInputs[renderQualityId]);
    const sharedInput = {
      zoneIndex: 3,
      weather: globalThis.NeonV23Weather.types['heavy-rain'].profile,
      lightningPulse: 0
    };
    const outdoorState = rig.update({
      ...sharedInput,
      covered: false,
      underpassBlend: 0,
      tunnelKind: null
    });
    const outdoorDiagnostics = rig.getDiagnostics();
    const outdoorRadiance = Array.from(rig.environmentTexture.image.data);

    const enclosedState = rig.update({
      ...sharedInput,
      covered: true,
      underpassBlend: 1,
      tunnelKind: 'underground-tunnel'
    });
    const enclosedDiagnostics = rig.getDiagnostics();

    assert.equal(enclosedDiagnostics.environmentIntensityBakedIntoHdr, true, renderQualityId);
    assert.equal(enclosedDiagnostics.hdrEnvironmentTracksEnclosure, true, renderQualityId);
    assert.ok(enclosedState.environmentIntensity < outdoorState.environmentIntensity, renderQualityId);
    assert.ok(
      enclosedDiagnostics.environmentRefreshCount > outdoorDiagnostics.environmentRefreshCount,
      `${renderQualityId} must rebuild HDR radiance when enclosure energy changes`
    );
    assert.notEqual(
      enclosedDiagnostics.effectiveEnvironmentSignature,
      outdoorDiagnostics.effectiveEnvironmentSignature,
      renderQualityId
    );
    assert.notDeepEqual(
      Array.from(rig.environmentTexture.image.data),
      outdoorRadiance,
      `${renderQualityId} must not retain outdoor PMREM source radiance in a deep tunnel`
    );
    assert.equal(rig.dispose(), true);
  }
});

test('moving through enclosure changes local illumination and HDR radiance continuously', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  const rig = createPhysicalLightingRig({ THREE, renderer, scene, camera });
  const sharedInput = {
    zoneIndex: 3,
    weather: globalThis.NeonV23Weather.types['heavy-rain'].profile,
    lightningPulse: 0,
    tunnelKind: 'underground-tunnel'
  };
  const outdoorState = rig.update({
    ...sharedInput,
    covered: false,
    tunnelKind: null,
    underpassBlend: 0
  });
  const outdoorDiagnostics = rig.getDiagnostics();
  const outdoorTextureVersion = rig.environmentTexture.version;

  let enclosedState = outdoorState;
  let previousEnvironmentIntensity = outdoorState.environmentIntensity;
  let previousEnvironmentRefreshCount = outdoorDiagnostics.environmentRefreshCount;
  for (const underpassBlend of [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1]) {
    enclosedState = rig.update({
      ...sharedInput,
      covered: true,
      underpassBlend
    });
    const diagnostics = rig.getDiagnostics();
    assert.equal(diagnostics.environmentSignature, outdoorDiagnostics.environmentSignature);
    assert.ok(enclosedState.environmentIntensity <= previousEnvironmentIntensity + 0.000_001);
    assert.ok(diagnostics.environmentRefreshCount >= previousEnvironmentRefreshCount);
    assert.equal(diagnostics.environmentNeedsPMREMUpdate, true);
    assert.equal(diagnostics.hdrEnvironmentTracksEnclosure, true);
    previousEnvironmentIntensity = enclosedState.environmentIntensity;
    previousEnvironmentRefreshCount = diagnostics.environmentRefreshCount;
  }

  const enclosedDiagnostics = rig.getDiagnostics();
  assert.ok(enclosedState.sunIntensity < outdoorState.sunIntensity);
  assert.ok(enclosedState.environmentIntensity < outdoorState.environmentIntensity);
  assert.ok(enclosedState.exposure < outdoorState.exposure);
  assert.notEqual(enclosedState.illuminationSignature, outdoorState.illuminationSignature);
  assert.ok(enclosedDiagnostics.environmentRefreshCount > outdoorDiagnostics.environmentRefreshCount);
  assert.ok(rig.environmentTexture.version > outdoorTextureVersion);
  assert.equal(rig.dispose(), true);
});

test('shadow buffers resize across all render tiers without rebuilding lights or reallocating on a no-op', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene,
    camera,
    initialShadowMapSizes: { primary: 2_048, local: 1_024 }
  });
  const shadowLights = [];
  rig.group.traverse((object) => {
    if (object.isLight && object.castShadow) shadowLights.push(object);
  });
  const lightNames = shadowLights.map((light) => light.name);
  const initial = rig.getDiagnostics();
  assert.equal(initial.primaryShadowMapSize, 2_048);
  assert.equal(initial.localShadowMapSize, 1_024);
  assert.equal(initial.shadowMapResizeCount, 0);

  let disposedTargets = 0;
  for (const light of shadowLights) {
    light.shadow.map = { dispose: () => { disposedTargets++; } };
    light.shadow.mapPass = { dispose: () => { disposedTargets++; } };
  }
  const lowResize = rig.setShadowMapSizes({ primary: 1_024, local: 512 });
  assert.deepEqual(lowResize.requested, { sun: 1_024, secondaryDirectional: 1_024, local: 512 });
  assert.deepEqual(lowResize.effective, { sun: 1_024, secondaryDirectional: 1_024, local: 512 });
  assert.equal(lowResize.fallbackApplied, false);
  const low = rig.getDiagnostics();
  assert.equal(disposedTargets, shadowLights.length * 2);
  assert.equal(low.primaryShadowMapSize, 1_024);
  assert.equal(low.secondaryDirectionalShadowMapSize, 1_024);
  assert.equal(low.localShadowMapSize, 512);
  assert.equal(low.shadowMapResizeCount, 1);
  assert.equal(low.shadowTexelWorldSizeM, PHYSICAL_LIGHTING_CONTRACT.shadow.primarySpanM / 1_024);
  assert.deepEqual(shadowLights.map((light) => light.name), lightNames);

  rig.setShadowMapSizes({ primary: 1_024, local: 512 });
  assert.equal(rig.getDiagnostics().shadowMapResizeCount, 1, 'same-tier resize must be allocation-free');
  rig.setShadowMapSizes({ primary: 4_096, local: 2_048 });
  const high = rig.getDiagnostics();
  assert.equal(high.primaryShadowMapSize, 4_096);
  assert.equal(high.secondaryDirectionalShadowMapSize, 4_096);
  assert.equal(high.localShadowMapSize, 2_048);
  assert.equal(high.shadowMapResizeCount, 2);
  assert.throws(
    () => rig.setShadowMapSizes({ primary: 3_000, local: 1_024 }),
    /supported power-of-two contract/
  );
  assert.equal(rig.dispose(), true);
});

test('High requests 8K/4K/4K shadows and reports a safe 4K capability fallback without changing its tier', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    capabilities: { maxTextureSize: 4_096 },
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000),
    initialRenderQualityId: 'high',
    initialShadowMapSizes: { sun: 8_192, secondaryDirectional: 4_096, local: 4_096 }
  });
  const diagnostics = rig.getDiagnostics();

  assert.equal(diagnostics.renderQualityId, 'high');
  assert.equal(diagnostics.requestedSunShadowMapSize, 8_192);
  assert.equal(diagnostics.requestedSecondaryDirectionalShadowMapSize, 4_096);
  assert.equal(diagnostics.requestedLocalShadowMapSize, 4_096);
  assert.equal(diagnostics.effectiveSunShadowMapSize, 4_096);
  assert.equal(diagnostics.effectiveSecondaryDirectionalShadowMapSize, 4_096);
  assert.equal(diagnostics.effectiveLocalShadowMapSize, 4_096);
  assert.equal(diagnostics.shadowCapabilityFallbackApplied, true);
  assert.equal(diagnostics.maxTextureSize, 4_096);
  assert.equal(diagnostics.shadowType, 'PCFSoftShadowMap');
  assert.equal(diagnostics.primaryShadowSpanM, LIGHTING_PRESENTATION_TIERS.high.primarySpanM);
  assert.equal(diagnostics.adaptiveDownscale, false);
  assert.equal(rig.dispose(), true);
});

test('quality contrast transforms are reversible while every tier bakes its authored environment strength', () => {
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    capabilities: { maxTextureSize: 8_192 },
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const scene = new THREE.Scene();
  const rig = createPhysicalLightingRig({
    THREE,
    renderer,
    scene,
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000)
  });
  const input = {
    zoneIndex: 2,
    weather: globalThis.NeonV23Weather.types.clear.profile,
    covered: false,
    underpassBlend: 0
  };
  const authoredState = rig.update(input);
  const mediumBefore = rig.getDiagnostics();
  const mediumHdr = Array.from(rig.environmentTexture.image.data);
  assert.equal(mediumBefore.exposure, authoredState.exposure);
  assert.equal(mediumBefore.ambientIntensity, authoredState.ambientIntensity);
  assert.equal(mediumBefore.sunIntensity, authoredState.sunIntensity);
  assert.equal(mediumBefore.environmentIntensityBakedIntoHdr, true);

  const highResult = rig.setRenderQuality('high', {
    sunShadowMapSize: 8_192,
    secondaryDirectionalShadowMapSize: 4_096,
    localShadowMapSize: 4_096
  });
  const highOutdoor = rig.update(input);
  const highDiagnostics = rig.getDiagnostics();
  assert.equal(highResult.id, 'high');
  assert.equal(highResult.shadow.fallbackApplied, false);
  assert.deepEqual(highResult.shadow.effective, { sun: 8_192, secondaryDirectional: 4_096, local: 4_096 });
  assert.ok(highDiagnostics.exposure < highOutdoor.exposure);
  assert.ok(highDiagnostics.ambientIntensity < highOutdoor.ambientIntensity);
  assert.ok(highDiagnostics.sunIntensity >= highOutdoor.sunIntensity);
  assert.equal(highDiagnostics.environmentIntensityBakedIntoHdr, true);
  assert.equal(highDiagnostics.shadowType, 'PCFSoftShadowMap');
  const highOutdoorRefreshCount = highDiagnostics.environmentRefreshCount;

  rig.update({
    ...input,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel'
  });
  const highEnclosed = rig.getDiagnostics();
  assert.ok(highEnclosed.environmentRefreshCount > highOutdoorRefreshCount);
  assert.notEqual(highEnclosed.effectiveEnvironmentSignature, highDiagnostics.effectiveEnvironmentSignature);

  rig.setRenderQuality('medium', { primary: 2_048, local: 1_024 });
  const restoredState = rig.update(input);
  const restored = rig.getDiagnostics();
  assert.equal(restored.renderQualityId, 'medium');
  assert.equal(restored.shadowType, 'VSMShadowMap');
  assert.equal(restored.primaryShadowSpanM, PHYSICAL_LIGHTING_CONTRACT.shadow.primarySpanM);
  assert.equal(restored.exposure, restoredState.exposure);
  assert.equal(restored.ambientIntensity, restoredState.ambientIntensity);
  assert.equal(restored.sunIntensity, restoredState.sunIntensity);
  assert.equal(restored.environmentIntensityBakedIntoHdr, true);
  assert.deepEqual(Array.from(rig.environmentTexture.image.data), mediumHdr);

  rig.setRenderQuality('low', { primary: 1_024, local: 512 });
  const lowState = rig.update(input);
  const low = rig.getDiagnostics();
  assert.equal(low.exposure, lowState.exposure);
  assert.equal(low.ambientIntensity, lowState.ambientIntensity);
  assert.equal(low.sunIntensity, lowState.sunIntensity);
  assert.equal(low.environmentIntensityBakedIntoHdr, true);
  assert.equal(low.primaryShadowSpanM, PHYSICAL_LIGHTING_CONTRACT.shadow.primarySpanM);
  assert.equal(rig.dispose(), true);
});

test('lighting module contains no gameplay authority, random source, or hidden performance downgrade path', () => {
  const source = readFileSync(
    path.join(PROJECT_ROOT, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.lighting.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /Math\.random|localStorage|sessionStorage/);
  assert.doesNotMatch(
    source,
    /\b(?:state|input)\.(?:speed|distance|lives|score|routeCursor|pathPlan|collision|autopilot)\s*=/i
  );
  assert.doesNotMatch(source, /qualityProfile|quality\s*===?\s*['"]mobile['"]|devicePixelRatio/);
  assert.doesNotMatch(source, /PhysicalLighting\.Guide|guidePoints|new THREE\.PointLight/);
  assert.match(source, /visualOnly:\s*true/);
  assert.match(source, /primaryMapSize:\s*4_096/);
  assert.doesNotMatch(source, /^\s*renderer\.useLegacyLights/m);
  assert.match(source, /texture\.needsPMREMUpdate = true/);
  assert.match(source, /PHYSICAL_LIGHTING_CONTRACT\.lights\.inverseSquareDecay/);
  assert.match(source, /tunnelShadowSpotCount:\s*2/);
  assert.match(source, /tunnelPhysicalSelectionDistanceM:\s*112/);
  assert.doesNotMatch(source, /route-relative-fallback/);
  assert.doesNotMatch(source, /state\.sunIntensity\s*\*\s*state\.directTransmission/);
});

test('player toggle disables physical lights, HDR work, and projected shadows, then restores current authored state', () => {
  const previousEnvironment = { name: 'previous-environment' };
  const renderer = {
    outputColorSpace: 'legacy-output',
    toneMapping: -1,
    toneMappingExposure: 0.8,
    shadowMap: { enabled: false, type: -1, autoUpdate: false, needsUpdate: false }
  };
  const scene = new THREE.Scene();
  scene.environment = previousEnvironment;
  scene.environmentIntensity = 0.73;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
  const rig = createPhysicalLightingRig({ THREE, renderer, scene, camera });
  const initial = rig.getDiagnostics();

  assert.equal(initial.enabled, true);
  assert.equal(initial.presentationMode, PHYSICAL_LIGHTING_CONTRACT.mode);
  assert.equal(initial.toggleCount, 0);
  assert.equal(initial.fallbackLightActive, false);
  assert.equal(initial.environmentActive, true);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(rig.group.visible, true);
  assert.equal(rig.fallbackAmbient.visible, false);

  assert.equal(rig.setEnabled(false), false);
  const disabledTextureVersion = rig.environmentTexture.version;
  const disabledState = rig.update({
    zoneIndex: 5,
    weather: globalThis.NeonV23Weather.types.sandstorm.profile,
    covered: true,
    underpassBlend: 1,
    tunnelKind: 'underground-tunnel'
  });
  const disabled = rig.getDiagnostics();

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.presentationMode, PHYSICAL_LIGHTING_CONTRACT.toggle.disabledMode);
  assert.equal(disabled.toggleCount, 1);
  assert.equal(disabled.fallbackLightActive, true);
  assert.equal(disabled.environmentActive, false);
  assert.equal(disabled.activeRealLightCount, 0);
  assert.equal(disabled.activeShadowLightCount, 0);
  assert.equal(disabled.activeTunnelLightCount, 0);
  assert.equal(disabled.cameraFollowingGuideLightCount, 0);
  assert.equal(disabled.sunIntensity, 0);
  assert.equal(disabled.moonIntensity, 0);
  assert.equal(disabled.lightningIntensity, 0);
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(renderer.shadowMap.autoUpdate, false);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  assert.equal(renderer.toneMappingExposure, 1);
  assert.equal(scene.environment, previousEnvironment);
  assert.equal(scene.environmentIntensity, 0.73);
  assert.equal(rig.group.visible, false);
  assert.equal(rig.fallbackAmbient.visible, true);
  assert.equal(rig.environmentTexture.version, disabledTextureVersion, 'disabled updates must skip unused HDR refreshes');

  assert.equal(rig.setEnabled(true), true);
  const restored = rig.getDiagnostics();
  assert.equal(restored.enabled, true);
  assert.equal(restored.presentationMode, PHYSICAL_LIGHTING_CONTRACT.mode);
  assert.equal(restored.toggleCount, 2);
  assert.equal(restored.fallbackLightActive, false);
  assert.equal(restored.environmentActive, true);
  assert.equal(restored.illuminationSignature, disabledState.illuminationSignature);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(renderer.toneMappingExposure, disabledState.exposure);
  assert.equal(scene.environment, rig.environmentTexture);
  assert.equal(scene.environmentIntensity, 1);
  assert.equal(rig.group.visible, true);
  assert.equal(rig.fallbackAmbient.visible, false);
  assert.ok(rig.environmentTexture.version > disabledTextureVersion, 'reenabling must refresh the current HDR state');

  assert.equal(rig.dispose(), true);
  assert.equal(scene.environment, previousEnvironment);
  assert.equal(scene.environmentIntensity, 0.73);
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(renderer.shadowMap.autoUpdate, false);
});

test('rig rejects missing dependencies and Three versions outside the pinned r160 contract', () => {
  assert.throws(() => createPhysicalLightingRig(), /requires THREE r160/);
  assert.throws(() => createPhysicalLightingRig({ THREE, renderer: {}, scene: {}, camera: {} }), /incomplete renderer/);
  assert.throws(() => createPhysicalLightingRig({
    THREE: { ...THREE, REVISION: '159' },
    renderer: { shadowMap: {} },
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera()
  }), /requires Three\.js r160/);
});
