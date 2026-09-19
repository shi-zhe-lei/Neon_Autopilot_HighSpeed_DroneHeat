import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Resolve the production weather module from the project root, independent of test cwd.
const PROJECT_ROOT = new URL('../../', import.meta.url);
const source = readFileSync(
  new URL('src/weather/Neon_Autopilot_HighSpeed_DroneHeat.weather.js', PROJECT_ROOT),
  'utf8'
);
const context = vm.createContext({ window: {} });
vm.runInContext(source, context, { filename: 'Neon_Autopilot_HighSpeed_DroneHeat.weather.js' });
const weather = context.window.NeonWeather;
const zones = Array.from({ length: 6 }, (_, index) => ({ id: `zone-${index}` }));
const worldContract = { zoneLength: 18_000, blendSpan: 480 };

function createController(options = {}) {
  return weather.createController({ zones, worldContract, seed: 23_001, ...options });
}

function createInput(zoneIndex, skyElapsedSeconds, extra = {}) {
  const localDistance = Number.isFinite(extra.localDistance) ? extra.localDistance : 120;
  return {
    zoneState: {
      index: zoneIndex,
      nextIndex: (zoneIndex + 1) % zones.length,
      localDistance
    },
    routeDistance: zoneIndex * worldContract.zoneLength + localDistance,
    skyElapsedSeconds,
    speedMps: 32,
    lockedZone: false,
    ...extra
  };
}

function sampleAt(controller, zoneIndex, skyElapsedSeconds, extra = {}) {
  return controller.sample(
    createInput(zoneIndex, skyElapsedSeconds, extra),
    controller.createSnapshot()
  );
}

function lifecycleSignature(snapshot) {
  return {
    currentId: snapshot.currentId,
    nextId: snapshot.nextId,
    phase: snapshot.phase,
    blend: snapshot.blend,
    rawBlend: snapshot.rawBlend,
    nextChangeSeconds: snapshot.nextChangeSeconds,
    segmentRemainingSeconds: snapshot.segmentRemainingSeconds,
    segmentSerial: snapshot.segmentSerial,
    motionTimeSeconds: snapshot.motionTimeSeconds,
    cloudCover: snapshot.cloudCover,
    rain: snapshot.rain,
    snow: snapshot.snow,
    hail: snapshot.hail,
    dust: snapshot.dust
  };
}

test('weather contracts and pacing are deeply immutable and include every requested severe system', () => {
  assert.ok(Object.isFrozen(weather.types));
  assert.ok(Object.isFrozen(weather.transitionGraph));
  assert.ok(Object.isFrozen(weather.weatherModes));
  assert.ok(Object.isFrozen(weather.modePatterns));
  assert.ok(Object.isFrozen(weather.zonePatterns));
  assert.ok(Object.isFrozen(weather.climateContracts));
  assert.ok(Object.isFrozen(weather.weatherPacing));
  assert.ok(Object.isFrozen(weather.weatherPacing.byType));
  for (const id of ['rain', 'snow', 'hail', 'sandstorm']) {
    assert.ok(weather.types[id], `missing weather type ${id}`);
    assert.ok(Object.isFrozen(weather.types[id]));
    assert.ok(Object.isFrozen(weather.types[id].profile));
    assert.ok(Object.isFrozen(weather.weatherPacing.byType[id]));
  }
  assert.deepEqual(Object.keys(weather.weatherModes), ['dry', 'severe', 'mixed']);
  assert.equal(weather.modePatterns.mixed, weather.zonePatterns);
  for (const [modeId, patterns] of Object.entries(weather.modePatterns)) {
    assert.ok(Object.isFrozen(weather.weatherModes[modeId]));
    assert.ok(Object.isFrozen(patterns));
    assert.equal(patterns.length, zones.length);
    assert.ok(patterns.every((pattern) => Object.isFrozen(pattern)));
  }
});

test('sealed tunnels continuously restore realm visibility while open roads retain outdoor weather', () => {
  const contract = weather.TUNNEL_WEATHER_SHELTER_CONTRACT;
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.blockedTunnelKinds), true);
  assert.deepEqual([...contract.blockedTunnelKinds], ['mountain-tunnel', 'underground-tunnel']);
  assert.equal(contract.precipitation, 'local-zero-with-outdoor-weather-state-retained');
  assert.equal(contract.visibility, 'realm-baseline-at-full-enclosure');
  assert.equal(contract.visualOnly, true);

  const blizzard = weather.types.blizzard.profile;
  const blizzardOutdoor = weather.resolveOpenAirVisibility(blizzard);
  const open = weather.resolveTunnelAtmosphere(blizzard, {
    covered: false,
    tunnelKind: null,
    underpassBlend: 1
  });
  assert.equal(open.sealedTunnel, false);
  assert.equal(open.exposure, 1);
  assert.equal(open.fog, blizzard.fog);
  assert.equal(open.profileVisibility, blizzard.visibility);
  assert.ok(Math.abs(open.visibility - blizzardOutdoor.outdoorVisibility) <= 0.000_000_000_001);
  assert.equal(open.snowCover, blizzard.snowCover);

  const portal = weather.resolveTunnelAtmosphere(blizzard, {
    covered: true,
    tunnelKind: 'mountain-tunnel',
    underpassBlend: 0.5
  });
  assert.equal(portal.shelter, 0.5);
  assert.equal(portal.exposure, 0.5);
  assert.equal(portal.fog, blizzard.fog * 0.5);
  assert.equal(portal.visibility, 1 - (1 - blizzardOutdoor.outdoorVisibility) * 0.5);

  for (const tunnelKind of ['mountain-tunnel', 'underground-tunnel', 'future-covered-route']) {
    const deep = weather.resolveTunnelAtmosphere(blizzard, {
      covered: true,
      tunnelKind,
      underpassBlend: 1
    });
    assert.equal(deep.sealedTunnel, true);
    assert.equal(deep.shelter, 1);
    assert.equal(deep.exposure, 0);
    assert.equal(deep.fog, 0);
    assert.equal(deep.visibility, 1);
    assert.equal(deep.cloudDarkness, 0);
    assert.equal(deep.dust, 0);
    assert.equal(deep.snow, 0);
    assert.equal(deep.snowCover, 0);
    assert.equal(deep.lightning, 0);
  }

  const missingBlend = weather.resolveTunnelAtmosphere(blizzard, {
    covered: true,
    tunnelKind: 'mountain-tunnel'
  });
  assert.equal(missingBlend.shelter, 1);
  assert.equal(missingBlend.visibility, 1);
  assert.equal(Object.isFrozen(missingBlend), true);
});

test('fog and dust continuously compound open-air extinction without creating a finite fog volume', () => {
  const contract = weather.OPEN_AIR_VISIBILITY_CONTRACT;
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(contract.version, 1);
  assert.equal(contract.mode, 'profile-visibility-with-aerosol-extinction');
  assert.equal(contract.minimumVisibilityScale, 0.10);
  assert.equal(contract.fogNearMaximumM, 18);
  assert.equal(contract.fogNearMinimumM, 4);
  assert.equal(contract.presentationOnly, true);

  const clear = weather.resolveOpenAirVisibility(weather.types.clear.profile);
  assert.equal(clear.profileVisibility, 1);
  assert.equal(clear.aerosolExtinction, 0);
  assert.equal(clear.outdoorVisibility, 1);
  assert.equal(clear.fogNearCapActive, false);

  for (const weatherId of [
    'mist',
    'heavy-rain',
    'thunderstorm',
    'hail',
    'blizzard',
    'haze',
    'dust-haze',
    'blowing-dust',
    'sandstorm'
  ]) {
    const profile = weather.types[weatherId].profile;
    const resolved = weather.resolveOpenAirVisibility(profile);
    assert.ok(
      resolved.outdoorVisibility < profile.visibility,
      `${weatherId} aerosols did not reduce authored visibility`
    );
    assert.ok(resolved.outdoorVisibility >= contract.minimumVisibilityScale);
    assert.ok(resolved.aerosolExtinction > 0);
    assert.equal(resolved.fogNearCapActive, true);
    assert.ok(resolved.fogNearCapM >= contract.fogNearMinimumM);
    assert.ok(resolved.fogNearCapM <= contract.fogNearMaximumM);
  }

  const sandstorm = weather.resolveOpenAirVisibility(weather.types.sandstorm.profile);
  assert.equal(sandstorm.outdoorVisibility, contract.minimumVisibilityScale);
  assert.ok(sandstorm.fogNearCapM < 6);
  assert.equal(Object.isFrozen(sandstorm), true);
});

test('every climate goal follows the common-sense buffer graph', () => {
  for (const [modeId, patterns] of Object.entries(weather.modePatterns)) {
    for (let zoneIndex = 0; zoneIndex < patterns.length; zoneIndex++) {
      const pattern = patterns[zoneIndex];
      const allowed = new Set(weather.climateContracts[zoneIndex].allowed);
      for (let index = 0; index < pattern.length; index++) {
        const sourceId = pattern[index].id;
        const targetId = pattern[(index + 1) % pattern.length].id;
        assert.ok(allowed.has(sourceId), `${sourceId} is invalid in ${modeId} zone ${zoneIndex}`);
        if (sourceId !== targetId) {
          assert.ok(
            weather.transitionGraph[sourceId].includes(targetId),
            `${sourceId} -> ${targetId} bypasses a ${modeId} buffer state`
          );
        }
      }
    }
  }
  assert.ok(!weather.transitionGraph.clear.includes('hail'));
  assert.ok(!weather.transitionGraph.clear.includes('snow'));
  assert.ok(!weather.transitionGraph.rain.includes('sandstorm'));
  assert.deepEqual([...weather.transitionGraph.hail], ['thunderstorm']);
  assert.deepEqual([...weather.transitionGraph.sandstorm], ['blowing-dust']);
});

test('dry, severe, and mixed modes constrain goals without bypassing the shared lifecycle', () => {
  const dryIds = new Set();
  const severeIds = new Set();
  for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
    const dryController = createController({ mode: 'dry' });
    const severeController = createController({ mode: 'severe' });
    for (let seconds = 0; seconds <= 1_500; seconds += 5) {
      const dry = sampleAt(dryController, zoneIndex, seconds, { lockedZone: true });
      const severe = sampleAt(severeController, zoneIndex, seconds, { lockedZone: true });
      dryIds.add(dry.currentId);
      dryIds.add(dry.nextId);
      severeIds.add(severe.currentId);
      severeIds.add(severe.nextId);
      assert.equal(dry.modeId, 'dry');
      assert.equal(dry.rain, 0);
      assert.equal(dry.snow, 0);
      assert.equal(dry.hail, 0);
      assert.ok(dry.dust <= weather.types.haze.profile.dust);
      assert.ok(!['dust-haze', 'blowing-dust', 'sandstorm'].includes(dry.currentId));
      assert.ok(!['dust-haze', 'blowing-dust', 'sandstorm'].includes(dry.nextId));
    }
  }
  assert.deepEqual(
    [...dryIds].sort(),
    ['clear', 'cloudy', 'haze', 'mist', 'partly-cloudy']
  );
  for (const id of ['rain', 'heavy-rain', 'thunderstorm', 'hail', 'snow', 'blizzard', 'sandstorm']) {
    assert.ok(severeIds.has(id), `severe mode never reached ${id}`);
  }

  const implicitMixed = createController();
  const explicitMixed = createController({ mode: 'mixed' });
  for (const seconds of [0, 65, 120, 240, 420, 720]) {
    assert.deepEqual(
      lifecycleSignature(sampleAt(implicitMixed, 2, seconds, { lockedZone: true })),
      lifecycleSignature(sampleAt(explicitMixed, 2, seconds, { lockedZone: true }))
    );
  }
  assert.throws(() => createController({ mode: 'unknown' }), /Unknown weather mode unknown/);
});

test('six climates make rain, hail, snow, blizzard, and sandstorm deterministically reachable', () => {
  const seenByZone = weather.zonePatterns.map(() => new Set());
  for (let zoneIndex = 0; zoneIndex < weather.zonePatterns.length; zoneIndex++) {
    const controller = createController();
    for (let seconds = 0; seconds <= 1_200; seconds += 5) {
      const snapshot = sampleAt(controller, zoneIndex, seconds, { lockedZone: true });
      seenByZone[zoneIndex].add(snapshot.currentId);
      seenByZone[zoneIndex].add(snapshot.nextId);
    }
  }
  assert.ok(seenByZone[0].has('rain'));
  assert.ok(seenByZone[1].has('hail'));
  assert.ok(seenByZone[2].has('heavy-rain'));
  assert.ok(seenByZone[3].has('snow'));
  assert.ok(seenByZone[3].has('blizzard'));
  assert.ok(seenByZone[5].has('sandstorm'));
});

test('weather holds and smootherstep transitions remain slow regardless of flight speed', () => {
  for (const [id, pacing] of Object.entries(weather.weatherPacing.byType)) {
    const minimumHold = id === 'hail' ? 20 : id === 'blizzard' ? 45 : 60;
    assert.ok(pacing.holdSeconds >= minimumHold, `${id} hold is too short`);
    assert.ok(
      pacing.transitionSeconds >= weather.weatherPacing.minimumTransitionSeconds,
      `${id} transition is too short`
    );
  }

  const slowController = createController();
  const fastController = createController();
  const slowInput = createInput(1, 65, { routeDistance: 680, speedMps: 32, lockedZone: true });
  const fastInput = createInput(1, 65, { routeDistance: 68_000, speedMps: 300, lockedZone: true });
  const slow = slowController.sample(slowInput, slowController.createSnapshot());
  const fast = fastController.sample(fastInput, fastController.createSnapshot());
  assert.deepEqual(lifecycleSignature(fast), lifecycleSignature(slow));

  const slowForecast = slowController.forecast(slowInput, slowController.createForecast());
  const fastForecast = fastController.forecast(fastInput, fastController.createForecast());
  assert.equal(fastForecast.nextChangeEtaSeconds, slowForecast.nextChangeEtaSeconds);
  assert.equal(fastForecast.expectedDurationSeconds, slowForecast.expectedDurationSeconds);
});

test('all profile channels are finite and continuous at hold and segment boundaries', () => {
  const fields = weather.PROFILE_FIELDS;
  const epsilonSeconds = 0.000_1;
  for (const [modeId, patterns] of Object.entries(weather.modePatterns)) {
    for (let zoneIndex = 0; zoneIndex < patterns.length; zoneIndex++) {
      const controller = createController({ mode: modeId });
      const firstId = patterns[zoneIndex][0].id;
      const pacing = weather.weatherPacing.byType[firstId];
      const holdBoundary = pacing.holdSeconds;
      const segmentBoundary = pacing.holdSeconds + pacing.transitionSeconds;
      const samples = [
        [
          sampleAt(controller, zoneIndex, holdBoundary - epsilonSeconds, { lockedZone: true }),
          sampleAt(controller, zoneIndex, holdBoundary + epsilonSeconds, { lockedZone: true })
        ],
        [
          sampleAt(controller, zoneIndex, segmentBoundary - epsilonSeconds, { lockedZone: true }),
          sampleAt(controller, zoneIndex, segmentBoundary + epsilonSeconds, { lockedZone: true })
        ]
      ];
      for (const [before, after] of samples) {
        for (const field of fields) {
          assert.ok(Number.isFinite(before[field]), `${field} before boundary is not finite`);
          assert.ok(Number.isFinite(after[field]), `${field} after boundary is not finite`);
          assert.ok(before[field] >= 0 && before[field] <= 1);
          assert.ok(after[field] >= 0 && after[field] <= 1);
          assert.ok(
            Math.abs(after[field] - before[field]) < 0.001,
            `${field} jumped in ${modeId} zone ${zoneIndex}`
          );
        }
      }
    }
  }

  assert.equal(weather.smootherstep(-1), 0);
  assert.equal(weather.smootherstep(0), 0);
  assert.equal(weather.smootherstep(1), 1);
  assert.equal(weather.smootherstep(2), 1);
  const epsilon = 0.000_1;
  assert.ok(weather.smootherstep(epsilon) / epsilon < 0.001);
  assert.ok((1 - weather.smootherstep(1 - epsilon)) / epsilon < 0.001);
});

test('crossing realms cannot reset or accelerate an active weather stage', () => {
  const controller = createController();
  const beforeCrossing = sampleAt(controller, 0, 40, { routeDistance: 500 });
  const afterCrossing = sampleAt(controller, 5, 40, { routeDistance: 50_000, speedMps: 300 });
  assert.deepEqual(lifecycleSignature(afterCrossing), lifecycleSignature(beforeCrossing));
  assert.equal(beforeCrossing.zoneIndex, 0);
  assert.equal(afterCrossing.zoneIndex, 5);
  assert.equal(afterCrossing.stageClimateZoneIndex, beforeCrossing.stageClimateZoneIndex);

  const oneSecondLater = sampleAt(controller, 5, 41, { routeDistance: 50_300, speedMps: 300 });
  assert.equal(oneSecondLater.currentId, beforeCrossing.currentId);
  assert.equal(oneSecondLater.nextId, beforeCrossing.nextId);
  assert.equal(oneSecondLater.segmentSerial, beforeCrossing.segmentSerial);
});

test('forecast and rendering share one time schedule and pause freezes both', () => {
  const controller = createController();
  const input = createInput(1, 65, { speedMps: 54, lockedZone: true });
  const snapshot = controller.sample(input, controller.createSnapshot());
  const first = controller.forecast(input, controller.createForecast());
  const second = controller.forecast({ ...input, speedMps: 300, routeDistance: 80_000 }, controller.createForecast());
  assert.equal(first.currentId, snapshot.currentId);
  assert.equal(first.nextId, snapshot.nextId);
  assert.equal(snapshot.modeId, 'mixed');
  assert.equal(first.modeId, snapshot.modeId);
  assert.equal(first.modeName, snapshot.modeName);
  assert.equal(first.blend, snapshot.blend);
  assert.equal(first.nextChangeEtaSeconds, snapshot.segmentRemainingSeconds);
  assert.equal(first.expectedDurationSeconds, weather.weatherPacing.byType[snapshot.nextId].holdSeconds);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.ok(first.items[1].etaSeconds >= first.items[0].etaSeconds);
  assert.ok(first.items[2].etaSeconds >= first.items[1].etaSeconds);

  const pausedAgain = controller.sample(input, controller.createSnapshot());
  assert.deepEqual(lifecycleSignature(pausedAgain), lifecycleSignature(snapshot));
  const later = controller.sample({ ...input, skyElapsedSeconds: 66 }, controller.createSnapshot());
  assert.notEqual(later.motionTimeSeconds, snapshot.motionTimeSeconds);
  assert.notEqual(later.blend, snapshot.blend);
});

test('reset deterministically reproduces the slow lifecycle', () => {
  const controller = createController();
  const times = [0, 65, 120, 240, 420];
  const firstRun = times.map((seconds) => lifecycleSignature(sampleAt(controller, 3, seconds, { lockedZone: true })));
  controller.reset();
  const secondRun = times.map((seconds) => lifecycleSignature(sampleAt(controller, 3, seconds, { lockedZone: true })));
  assert.deepEqual(secondRun, firstRun);
});

test('setMode commits one deterministic run lifecycle and reset preserves that mode', () => {
  const controller = createController();
  sampleAt(controller, 2, 420, { lockedZone: true });
  assert.equal(controller.setMode('dry'), true);
  assert.equal(controller.setMode('dry'), false);
  const times = [0, 65, 120, 240, 420];
  const firstDryRun = times.map((seconds) => lifecycleSignature(
    sampleAt(controller, 4, seconds, { lockedZone: true })
  ));
  assert.equal(sampleAt(controller, 4, 420, { lockedZone: true }).modeId, 'dry');
  assert.equal(controller.getDiagnostics().modeId, 'dry');
  controller.reset();
  const secondDryRun = times.map((seconds) => lifecycleSignature(
    sampleAt(controller, 4, seconds, { lockedZone: true })
  ));
  assert.deepEqual(secondDryRun, firstDryRun);
  assert.equal(controller.setMode('severe'), true);
  assert.equal(sampleAt(controller, 3, 0, { lockedZone: true }).currentId, 'snow');
  assert.throws(() => controller.setMode('unknown'), /Unknown weather mode unknown/);
});

test('cloud amount follows weather instead of treating dust obscuration as storm cloud', () => {
  assert.ok(weather.types.clear.profile.cloudCover < weather.types['partly-cloudy'].profile.cloudCover);
  assert.ok(weather.types['partly-cloudy'].profile.cloudCover < weather.types.cloudy.profile.cloudCover);
  assert.ok(weather.types.flurry.profile.cloudCover >= 0.85);
  assert.ok(weather.types.rain.profile.cloudCover >= 0.95);
  assert.ok(weather.types.snow.profile.cloudCover >= 0.95);
  assert.equal(weather.types['heavy-rain'].profile.cloudCover, 1);
  assert.equal(weather.types.blizzard.profile.cloudCover, 1);
  assert.equal(weather.types.hail.profile.cloudCover, 1);
  assert.equal(weather.types.thunderstorm.profile.cloudCover, 1);
  assert.ok(weather.types.sandstorm.profile.cloudCover < weather.types.cloudy.profile.cloudCover);
  assert.equal(weather.types.sandstorm.profile.dust, 1);
});

test('visual audit locks expose each requested effect without changing lifecycle authority', () => {
  for (const id of ['rain', 'snow', 'hail', 'sandstorm']) {
    const controller = createController({ forcedType: id, mode: 'dry' });
    const snapshot = sampleAt(controller, 0, 120);
    assert.equal(snapshot.currentId, id);
    assert.equal(snapshot.nextId, id);
    assert.equal(snapshot.phase, 'forced');
    assert.equal(snapshot.forced, true);
    assert.equal(snapshot.modeId, 'dry');
    assert.equal(controller.getDiagnostics().forcedType, id);
    assert.equal(snapshot.skyGroundPaired, true);
    assert.ok(snapshot.rain > 0 || snapshot.snow > 0 || snapshot.hail > 0 || snapshot.dust > 0);
  }
});

test('manual test override switches immediately and releases back to the unchanged natural clock', () => {
  const controller = createController();
  const reference = createController();
  sampleAt(controller, 2, 20, { lockedZone: true });

  assert.equal(controller.setForcedType('thunderstorm'), true);
  assert.equal(controller.setForcedType('thunderstorm'), false);
  const thunderstorm = sampleAt(controller, 2, 120, { lockedZone: true });
  assert.equal(thunderstorm.currentId, 'thunderstorm');
  assert.equal(thunderstorm.nextId, 'thunderstorm');
  assert.equal(thunderstorm.phase, 'forced');
  assert.equal(thunderstorm.forced, true);
  assert.equal(controller.getDiagnostics().forcedType, 'thunderstorm');

  assert.equal(controller.setForcedType('snow'), true);
  const snow = sampleAt(controller, 2, 180, { lockedZone: true });
  assert.equal(snow.currentId, 'snow');
  assert.equal(snow.snow, weather.types.snow.profile.snow);

  assert.equal(controller.setForcedType(null), true);
  const resumed = sampleAt(controller, 2, 240, { lockedZone: true });
  const expected = sampleAt(reference, 2, 240, { lockedZone: true });
  assert.equal(resumed.forced, false);
  assert.equal(controller.getDiagnostics().forcedType, null);
  assert.deepEqual(lifecycleSignature(resumed), lifecycleSignature(expected));
  assert.throws(() => controller.setForcedType('unknown'), /Unknown forced weather type unknown/);
});
