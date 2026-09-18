const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Resolve production code and audited media from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = {
  atob(value) {
    return Buffer.from(value, 'base64').toString('binary');
  }
};
const documentListeners = new Map();

function listenerCapture(options) {
  return options === true || options?.capture === true;
}

global.document = {
  visibilityState: 'visible',
  addEventListener(type, listener, options) {
    const bucket = documentListeners.get(type) || [];
    if (!bucket.some((entry) => entry.listener === listener && entry.capture === listenerCapture(options))) {
      bucket.push({ listener, capture: listenerCapture(options) });
      documentListeners.set(type, bucket);
    }
  },
  removeEventListener(type, listener, options) {
    const bucket = documentListeners.get(type) || [];
    const capture = listenerCapture(options);
    documentListeners.set(type, bucket.filter((entry) => entry.listener !== listener || entry.capture !== capture));
  }
};

function dispatchDocumentEvent(type, event) {
  for (const entry of [...(documentListeners.get(type) || [])]) entry.listener({ ...event, type });
}

function documentListenerCount(type) {
  return (documentListeners.get(type) || []).length;
}

function createFakeScheduler(startMs = 0) {
  let nowMs = startMs;
  let nextHandle = 1;
  const timers = new Map();

  return {
    now() {
      return nowMs;
    },
    setTimeout(callback, delayMs = 0) {
      const handle = nextHandle++;
      timers.set(handle, {
        callback,
        dueMs: nowMs + Math.max(0, Number(delayMs) || 0)
      });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    async advanceBy(deltaMs) {
      assert.ok(Number.isFinite(deltaMs) && deltaMs >= 0, 'Fake scheduler time must advance monotonically');
      const targetMs = nowMs + deltaMs;
      while (true) {
        let dueHandle = null;
        let dueTimer = null;
        for (const [handle, timer] of timers) {
          if (timer.dueMs > targetMs) continue;
          if (!dueTimer || timer.dueMs < dueTimer.dueMs || (timer.dueMs === dueTimer.dueMs && handle < dueHandle)) {
            dueHandle = handle;
            dueTimer = timer;
          }
        }
        if (!dueTimer) break;
        nowMs = dueTimer.dueMs;
        timers.delete(dueHandle);
        await dueTimer.callback();
        await Promise.resolve();
      }
      nowMs = targetMs;
      await Promise.resolve();
    },
    get pendingTimerCount() {
      return timers.size;
    }
  };
}

require(path.join(
  PROJECT_ROOT,
  'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.effect-assets.js'
));
require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.audio.js'));

const audioModule = global.window.NeonV23Audio;
const effectAssetModule = global.window.NeonV23EffectAssets;
assert.ok(audioModule, 'Audio module did not publish its browser contract');
assert.equal(effectAssetModule.version, 'V23-effect-assets-1');
assert.equal(effectAssetModule.releaseGeneration, '23-ipad-road-residency-253');
assert.equal(audioModule.version, 'V23-audio-13');
assert.equal(audioModule.EFFECT_ASSET_RELEASE_GENERATION, '23-ipad-road-residency-253');
assert.equal(audioModule.PROPULSION_PROFILE, 'authoritative-core-drive-v5');
assert.equal(audioModule.PROPULSION_GAIN_SCALE, 0.55);
assert.deepEqual(audioModule.LUGGING_AUDIO_CONTRACT, {
  maximumCorePitchReduction: 0.22,
  maximumHarmonicRatioReduction: 0.12,
  maximumCutoffReduction: 0.52,
  minimumCutoffHz: 820,
  maximumCoreGainReduction: 0.08,
  maximumHarmonicGainReduction: 0.30,
  maximumResonanceGain: 0.34
});
assert.deepEqual(audioModule.RAIN_ACOUSTIC_CONTRACT, {
  version: 2,
  profile: 'raw-intensity-three-band-with-tunnel-transmission',
  quietCurveExponent: 1.18,
  lightToSteadyStart: 0.22,
  lightToSteadyEnd: 0.48,
  steadyToHeavyStart: 0.72,
  steadyToHeavyEnd: 0.92,
  mountainTunnelTransmission: 0.18,
  undergroundTunnelTransmission: 0.10,
  defaultSealedTunnelTransmission: 0.10,
  maximumCombinedGain: 0.011_5,
  maximumRainAndWindGain: 0.022,
  maximumWeatherGain: 0.032
});
assert.throws(
  () => audioModule.createController({ scheduler: {}, storage: null }),
  /must provide now\(\), setTimeout\(\), and clearTimeout\(\)/,
  'Injected schedulers must implement the complete deterministic timing contract'
);

const interactionTarget = ({
  guide = false,
  musicLibrary = false,
  weatherPicker = false,
  qualityPicker = false,
  manualWeather = false,
  updateNotice = false,
  gameplay = false
} = {}) => ({
  closest(selector) {
    if (selector === '#guideOverlay') return guide ? this : null;
    if (selector === '#musicLibraryOverlay') return musicLibrary ? this : null;
    if (selector === '#updateNotice') return updateNotice ? this : null;
    if (selector === '#weatherModePicker') return weatherPicker ? this : null;
    if (selector === '#qualityModePicker') return qualityPicker ? this : null;
    if (selector === '#manualWeatherTestPanel') return manualWeather ? this : null;
    return gameplay ? this : null;
  }
});
assert.equal(audioModule.shouldUnlockForInteraction({
  type: 'pointerdown',
  isTrusted: true,
  target: interactionTarget({ guide: true })
}), false, 'Opening the guide must not allocate or download audio');
assert.equal(audioModule.shouldUnlockForInteraction({
  type: 'pointerdown',
  isTrusted: true,
  target: interactionTarget({ musicLibrary: true })
}), false, 'Browsing the music library must not allocate the effects graph');
assert.equal(audioModule.shouldUnlockForInteraction({
  type: 'pointerdown',
  isTrusted: true,
  target: interactionTarget({ gameplay: true })
}), true, 'A trusted gameplay control must unlock audio');
assert.equal(audioModule.shouldUnlockForInteraction({
  type: 'keydown',
  code: 'KeyW',
  isTrusted: true,
  target: interactionTarget()
}), true, 'A trusted driving key must unlock audio');
assert.equal(audioModule.shouldUnlockForInteraction({
  type: 'keydown',
  code: 'KeyP',
  isTrusted: true,
  target: interactionTarget()
}), true, 'Semantic mode shortcuts must unlock in time to play their distinct cue');
for (const code of ['KeyQ', 'KeyE', 'KeyT']) {
  assert.equal(audioModule.shouldUnlockForInteraction({
    type: 'keydown',
    code,
    isTrusted: true,
    target: interactionTarget()
  }), true, `${code} transmission input must unlock audio as a trusted gameplay command`);
}
assert.equal(audioModule.shouldUnlockForInteraction({
  type: 'keydown',
  code: 'ArrowRight',
  isTrusted: true,
  target: interactionTarget({ weatherPicker: true })
}), false, 'Native weather-radio navigation must not be mistaken for gameplay audio intent');
for (const [surface, target] of [
  ['quality picker', interactionTarget({ qualityPicker: true })],
  ['manual-weather picker', interactionTarget({ manualWeather: true })],
  ['update notice', interactionTarget({ updateNotice: true })]
]) {
  assert.equal(audioModule.shouldUnlockForInteraction({
    type: 'keydown',
    code: 'Space',
    isTrusted: true,
    target
  }), false, `${surface} navigation must not prewarm a non-gameplay audio path`);
}

const manifestEntries = Object.entries(audioModule.ASSET_MANIFEST);
assert.equal(manifestEntries.length, 9, 'Unexpected effects manifest size');
assert.equal(audioModule.ASSET_MANIFEST.engine, undefined, 'Legacy engine loop must not enter the clean mix');
assert.equal(audioModule.ASSET_MANIFEST.thruster, undefined, 'Legacy thruster loop must not enter the clean mix');
for (const [key, descriptor] of manifestEntries) {
  const assetPath = path.join(PROJECT_ROOT, descriptor.url);
  assert.ok(fs.existsSync(assetPath), `Missing ${key} asset: ${descriptor.url}`);
  assert.ok(fs.statSync(assetPath).size > 0, `Empty ${key} asset: ${descriptor.url}`);
  const dataUrl = effectAssetModule.dataUrls[key];
  assert.ok(dataUrl.startsWith('data:audio/ogg;base64,'), `Missing exact inline payload for ${key}`);
  assert.deepEqual(
    Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
    fs.readFileSync(assetPath),
    `Inline ${key} bytes must remain identical to the redistributed OGG master`
  );
}
const assetConsumers = new Set(
  Object.values(audioModule.EVENT_DEFINITIONS)
    .map((definition) => definition.asset)
    .filter(Boolean)
);
assert.deepEqual(
  [...assetConsumers].sort(),
  manifestEntries.map(([key]) => key).sort(),
  'Every shipped effects file must be consumed by at least one semantic event'
);
for (const [eventName, definition] of Object.entries(audioModule.EVENT_DEFINITIONS)) {
  assert.ok(
    definition.asset || definition.synthesis,
    `${eventName} must declare an audible asset or synthesis path`
  );
}
const runtimeSource = fs.readFileSync(
  path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
  'utf8'
);
const audioSource = fs.readFileSync(
  path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.audio.js'),
  'utf8'
);
assert.match(
  audioSource,
  /weatherRainTunnelFilter\.type = 'lowpass';[\s\S]*?surfaceNoiseSource\.connect\(weatherRainTunnelFilter\)/,
  'Tunnel rain must reuse the persistent weather source through a low-pass return'
);
const updateConsumerSource = audioSource.slice(
  audioSource.indexOf('function update(input = {})'),
  audioSource.indexOf('function onTrustedInteraction(event)')
);
for (const eventName of Object.keys(audioModule.EVENT_DEFINITIONS)) {
  assert.ok(
    runtimeSource.includes(`'${eventName}'`) || updateConsumerSource.includes(`'${eventName}'`),
    `${eventName} must have a concrete runtime or manual-control consumer`
  );
}

const inactive = audioModule.deriveMix({ running: false, speed: 300, throttle: 1, brake: 1, underpassBlend: 1 });
assert.equal(inactive.activity, 0);
assert.equal(inactive.musicGain, 0);
assert.equal(inactive.driveCoreGain, 0);
assert.equal(inactive.driveHarmonicGain, 0);
assert.equal(inactive.airflowGain, 0);
assert.equal(inactive.brakeGain, 0);
assert.equal(inactive.tunnelReturnGain, 0);
assert.equal(inactive.waterSprayGain, 0);
assert.equal(inactive.snowCompressionGain, 0);
assert.equal(inactive.snowCrunchGain, 0);
assert.equal(inactive.weatherRainLightGain, 0);
assert.equal(inactive.weatherRainSteadyGain, 0);
assert.equal(inactive.weatherRainHeavyGain, 0);
assert.equal(inactive.weatherRainDirectGain, 0);
assert.equal(inactive.weatherRainTunnelGain, 0);
assert.equal(inactive.weatherRainGain, 0);
assert.equal(inactive.weatherWindGain, 0);
assert.equal(inactive.weatherHailGain, 0);
assert.equal(inactive.weatherDustGain, 0);
assert.equal(inactive.weatherCombinedGain, 0);

const cruise = audioModule.deriveMix({
  running: true,
  speed: 0,
  coreSpool: 0.2,
  coreRpm: 3_840,
  thrustNormalized: 0.2,
  brake: 0,
  underpassBlend: 0
});
const highPower = audioModule.deriveMix({
  running: true,
  speed: 0,
  coreSpool: 1,
  coreRpm: 12_000,
  thrustNormalized: 1,
  brake: 0,
  underpassBlend: 0
});
const highSpeed = audioModule.deriveMix({
  running: true,
  speed: 160 / 3.6,
  coreSpool: 1,
  coreRpm: 12_000,
  thrustNormalized: 1,
  brake: 0,
  underpassBlend: 0
});
const upgradedCore = audioModule.deriveMix({
  running: true,
  speed: 0,
  coreSpool: 1,
  coreRpm: 15_000,
  thrustNormalized: 1,
  brake: 0,
  underpassBlend: 0
});
const braking = audioModule.deriveMix({
  running: true,
  speed: 160 / 3.6,
  coreSpool: 0.7,
  coreRpm: 8_940,
  thrustNormalized: 0,
  brake: 1,
  underpassBlend: 0
});
const tunnel = audioModule.deriveMix({
  running: true,
  speed: 160 / 3.6,
  coreSpool: 0.5,
  coreRpm: 6_900,
  thrustNormalized: 0.5,
  brake: 0,
  underpassBlend: 1
});
const unloadedZeroThrust = audioModule.deriveMix({
  running: true,
  speed: 7 / 3.6,
  coreSpool: 1,
  coreRpm: 13_962,
  thrustNormalized: 0,
  gearTorqueAvailability: 0,
  gearLuggingSeverity: 1,
  gearLoadNormalized: 0,
  gearLugging: true,
  gearStalled: true
});
const stalledUnderLoad = audioModule.deriveMix({
  running: true,
  speed: 7 / 3.6,
  coreSpool: 1,
  coreRpm: 13_962,
  thrustNormalized: 0,
  gearTorqueAvailability: 0,
  gearLuggingSeverity: 1,
  gearLoadNormalized: 1,
  gearLugging: true,
  gearStalled: true
});
assert.ok(highPower.driveCoreFrequencyHz > cruise.driveCoreFrequencyHz, 'Electric drive pitch must follow core RPM');
assert.ok(highPower.driveCoreGain > cruise.driveCoreGain, 'Electric drive level must follow core spool and thrust');
assert.ok(highPower.driveHarmonicGain > cruise.driveHarmonicGain, 'Drive harmonic must follow core spool and thrust');
assert.ok(
  Math.abs(upgradedCore.rpmMix - (15_000 - 1_800) / (12_000 - 1_800)) < 0.000_000_001,
  'The entire candle-upgraded RPM interval must remain audible'
);
assert.ok(
  upgradedCore.driveCoreFrequencyHz > highPower.driveCoreFrequencyHz,
  'Candle-upgraded RPM above 12,000 must continue raising electric-drive pitch'
);
assert.ok(
  upgradedCore.driveCutoffHz > highPower.driveCutoffHz,
  'Candle-upgraded RPM above 12,000 must not flatten at the former audio ceiling'
);
assert.ok(cruise.driveCoreFrequencyHz >= 96, 'Cruise core must stay above the legacy tractor-like low fundamental');
assert.equal(cruise.airflowGain, 0, 'Rest must not carry a permanent airflow noise floor');
for (const field of [
  'driveCoreGain',
  'driveHarmonicGain',
  'driveCoreFrequencyHz',
  'driveHarmonicFrequencyHz',
  'driveCutoffHz',
  'driveResonanceQ'
]) {
  assert.equal(
    highSpeed[field],
    highPower[field],
    `${field} must remain independent of vehicle speed when authoritative core state is unchanged`
  );
}
assert.equal(highSpeed.coreSpool, 1);
assert.equal(highSpeed.coreRpm, 12_000);
assert.equal(highSpeed.thrustNormalized, 1);
assert.ok(highSpeed.airflowGain > highPower.airflowGain, 'Band-limited airflow must follow high speed');
const partialCore = audioModule.deriveMix({
  running: true,
  speed: 160 / 3.6,
  throttle: 1,
  coreSpool: 0.25
});
assert.equal(partialCore.coreSpool, 0.25);
assert.equal(partialCore.thrustNormalized, 0, 'Raw throttle must not fill a missing authoritative thrust field');
assert.ok(
  partialCore.driveCoreGain < highSpeed.driveCoreGain,
  'A legacy throttle demand must not override a published core state'
);
assert.ok(highSpeed.airflowHighpassHz > 1_000, 'Airflow must reject low-frequency rumble');
assert.ok(highSpeed.airflowLowpassHz < 8_000, 'Airflow must reject unbounded high-frequency hiss');
assert.ok(
  highSpeed.driveCoreGain + highSpeed.driveHarmonicGain + highSpeed.airflowGain
    < highSpeed.musicGain * 0.4,
  'Continuous propulsion must remain clearly beneath the themed score at contract speed'
);
assert.ok(braking.brakeGain > 0, 'Braking must publish a continuous brake layer');
assert.ok(tunnel.tunnelReturnGain > 0, 'Covered roads must publish a tunnel return');
assert.ok(tunnel.musicCutoffHz < highSpeed.musicCutoffHz, 'Tunnel mix must filter the background track');
assert.equal(stalledUnderLoad.gearTorqueAvailability, 0);
assert.equal(stalledUnderLoad.gearLuggingSeverity, 1);
assert.equal(stalledUnderLoad.gearLoadNormalized, 1);
assert.equal(stalledUnderLoad.luggingAudioMix, 1);
assert.equal(stalledUnderLoad.gearLugging, 1);
assert.equal(stalledUnderLoad.gearStalled, 1);
assert.ok(
  stalledUnderLoad.driveCoreFrequencyHz < unloadedZeroThrust.driveCoreFrequencyHz,
  'A stalled high gear under load must lower the existing propulsion fundamental'
);
assert.ok(
  stalledUnderLoad.driveHarmonicFrequencyHz / stalledUnderLoad.driveCoreFrequencyHz
    < unloadedZeroThrust.driveHarmonicFrequencyHz / unloadedZeroThrust.driveCoreFrequencyHz,
  'Lugging must compact the harmonic interval instead of adding a high warning tone'
);
assert.ok(
  stalledUnderLoad.driveCutoffHz < unloadedZeroThrust.driveCutoffHz * 0.55,
  'A stalled load must audibly darken the persistent propulsion filter'
);
assert.ok(
  stalledUnderLoad.driveCoreGain <= unloadedZeroThrust.driveCoreGain
    && stalledUnderLoad.driveHarmonicGain < unloadedZeroThrust.driveHarmonicGain,
  'Lugging may reshape the continuous engine bed but must not become louder than normal propulsion'
);
assert.ok(stalledUnderLoad.driveResonanceQ > unloadedZeroThrust.driveResonanceQ);
assert.equal(
  audioModule.EVENT_DEFINITIONS.lugging,
  undefined,
  'Sustained lugging must not allocate or repeat a semantic warning voice'
);
for (const value of Object.values(highSpeed)) assert.ok(Number.isFinite(value), 'Mix targets must stay finite');

const frozenWaterInput = Object.freeze({
  running: true,
  speed: 20,
  waterContact: 0.85,
  snowContact: 0,
  slushContact: 0,
  contactIntensity: 0.72
});
const frozenWaterSnapshot = JSON.stringify(frozenWaterInput);
const waterSurface = audioModule.deriveMix(frozenWaterInput);
const fasterWaterSurface = audioModule.deriveMix({
  ...frozenWaterInput,
  speed: 120 / 3.6
});
const snowSurface = audioModule.deriveMix({
  running: true,
  speed: 20,
  waterContact: 0,
  snowContact: 0.85,
  slushContact: 0,
  contactIntensity: 0.72
});
const slushSurface = audioModule.deriveMix({
  running: true,
  speed: 20,
  waterContact: 0,
  snowContact: 0,
  slushContact: 0.85,
  contactIntensity: 0.72
});
const stationaryWater = audioModule.deriveMix({
  running: true,
  speed: 0,
  waterContact: 1,
  contactIntensity: 1
});
const saturatedSurface = audioModule.deriveMix({
  running: true,
  speed: Number.POSITIVE_INFINITY,
  waterContact: Number.POSITIVE_INFINITY,
  snowContact: Number.POSITIVE_INFINITY,
  slushContact: Number.POSITIVE_INFINITY,
  contactIntensity: Number.POSITIVE_INFINITY
});

assert.equal(JSON.stringify(frozenWaterInput), frozenWaterSnapshot, 'deriveMix must not mutate contact state');
assert.ok(waterSurface.waterSprayGain > 0, 'Standing-water contact must publish continuous spray');
assert.equal(waterSurface.snowCompressionGain, 0, 'Clear water must not invent snow compression');
assert.equal(waterSurface.snowCrunchGain, 0, 'Clear water must not invent snow crunch');
assert.ok(
  fasterWaterSurface.waterSprayGain > waterSurface.waterSprayGain,
  'Water spray energy must rise with surface speed'
);
assert.ok(snowSurface.snowCompressionGain > 0, 'Snow contact must publish a compression body');
assert.ok(snowSurface.snowCrunchGain > 0, 'Snow contact must publish a dry crunch layer');
assert.equal(snowSurface.waterSprayGain, 0, 'Dry snow must not invent water spray');
assert.ok(slushSurface.waterSprayGain > 0, 'Slush must retain a fluid spray component');
assert.ok(slushSurface.snowCompressionGain > 0, 'Slush must retain packed-snow compression');
assert.ok(
  slushSurface.snowCrunchGain < snowSurface.snowCrunchGain,
  'Slush must damp brittle snow crunch relative to dry snow'
);
assert.ok(
  slushSurface.waterSprayLowpassHz < waterSurface.waterSprayLowpassHz,
  'Slush must darken the spray spectrum relative to clear water'
);
assert.equal(stationaryWater.waterSprayGain, 0, 'Contact at rest must not create continuous spray');
assert.ok(saturatedSurface.waterSprayGain <= 0.046, 'Water spray gain must remain bounded');
assert.ok(saturatedSurface.snowCompressionGain <= 0.030, 'Snow compression gain must remain bounded');
assert.ok(saturatedSurface.snowCrunchGain <= 0.027, 'Snow crunch gain must remain bounded');
assert.ok(
  saturatedSurface.waterSprayHighpassHz >= 300
    && saturatedSurface.waterSprayHighpassHz <= 1_600,
  'Water high-pass target must remain bounded'
);
assert.ok(
  saturatedSurface.waterSprayLowpassHz >= 2_100
    && saturatedSurface.waterSprayLowpassHz <= 7_000,
  'Water low-pass target must remain bounded'
);
assert.ok(
  saturatedSurface.snowCompressionFrequencyHz >= 270
    && saturatedSurface.snowCompressionFrequencyHz <= 1_080,
  'Snow compression filter target must remain bounded'
);
assert.ok(
  saturatedSurface.snowCrunchHighpassHz < saturatedSurface.snowCrunchLowpassHz,
  'Snow crunch band must retain valid filter ordering'
);
for (const value of Object.values(saturatedSurface)) {
  assert.ok(Number.isFinite(value), 'Extreme contact input must still produce finite mix targets');
}

const lightRain = audioModule.deriveMix({
  running: true,
  weatherExposure: 1,
  weatherRain: 0.2
});
const steadyRain = audioModule.deriveMix({
  running: true,
  weatherExposure: 1,
  weatherRain: 0.68
});
const heavyRain = audioModule.deriveMix({
  running: true,
  weatherExposure: 1,
  weatherRain: 1
});
const halfShelteredHeavyRain = audioModule.deriveMix({
  running: true,
  weatherExposure: 0.5,
  weatherTunnelSealed: true,
  weatherTunnelKind: 'mountain-tunnel',
  weatherTunnelShelter: 0.5,
  weatherRain: 1
});
const fullyShelteredHeavyRain = audioModule.deriveMix({
  running: true,
  weatherExposure: 0,
  weatherTunnelSealed: true,
  weatherTunnelKind: 'mountain-tunnel',
  weatherTunnelShelter: 1,
  weatherRain: 1
});
const undergroundHeavyRain = audioModule.deriveMix({
  running: true,
  weatherExposure: 0,
  weatherTunnelSealed: true,
  weatherTunnelKind: 'underground-tunnel',
  weatherTunnelShelter: 1,
  weatherRain: 1
});
const bridgeHeavyRain = audioModule.deriveMix({
  running: true,
  underpassBlend: 1,
  weatherExposure: 1,
  weatherTunnelSealed: false,
  weatherTunnelKind: null,
  weatherTunnelShelter: 0,
  weatherRain: 1
});
assert.equal(lightRain.weatherRainTierIndex, 1);
assert.equal(steadyRain.weatherRainTierIndex, 2);
assert.equal(heavyRain.weatherRainTierIndex, 3);
assert.equal(lightRain.weatherRainLightWeight, 1);
assert.equal(lightRain.weatherRainSteadyWeight, 0);
assert.equal(lightRain.weatherRainHeavyWeight, 0);
assert.equal(steadyRain.weatherRainLightWeight, 0);
assert.equal(steadyRain.weatherRainSteadyWeight, 1);
assert.equal(steadyRain.weatherRainHeavyWeight, 0);
assert.equal(heavyRain.weatherRainLightWeight, 0);
assert.equal(heavyRain.weatherRainSteadyWeight, 0);
assert.equal(heavyRain.weatherRainHeavyWeight, 1);
assert.ok(
  lightRain.weatherRainGain < steadyRain.weatherRainGain
    && steadyRain.weatherRainGain < heavyRain.weatherRainGain,
  'Rain amount must raise the bounded rain envelope monotonically'
);
assert.ok(
  lightRain.weatherRainGain <= heavyRain.weatherRainGain * 0.16,
  'Light rain must remain substantially quieter than a downpour'
);
assert.ok(
  heavyRain.weatherRainGain <= audioModule.RAIN_ACOUSTIC_CONTRACT.maximumCombinedGain
);
for (const mix of [lightRain, steadyRain, heavyRain]) {
  assert.ok(
    Math.abs(
      mix.weatherRainLightGain
        + mix.weatherRainSteadyGain
        + mix.weatherRainHeavyGain
        + mix.weatherRainTunnelGain
        - mix.weatherRainGain
    ) < 0.000_000_000_001,
    'Rain branch gains must sum to the published bounded rain target'
  );
}
assert.ok(
  lightRain.weatherRainLightFrequencyHz > steadyRain.weatherRainSteadyFrequencyHz
    && steadyRain.weatherRainSteadyFrequencyHz > heavyRain.weatherRainHeavyFrequencyHz,
  'Light, steady, and heavy rain must occupy progressively lower spectral bodies'
);
assert.equal(halfShelteredHeavyRain.weatherRainIntensity, heavyRain.weatherRainIntensity);
assert.equal(halfShelteredHeavyRain.weatherRainTierIndex, heavyRain.weatherRainTierIndex);
assert.equal(halfShelteredHeavyRain.weatherRainHeavyWeight, heavyRain.weatherRainHeavyWeight);
assert.equal(
  halfShelteredHeavyRain.weatherRainHeavyFrequencyHz,
  heavyRain.weatherRainHeavyFrequencyHz,
  'Tunnel exposure must not reclassify the outdoor rain profile'
);
assert.ok(
  Math.abs(halfShelteredHeavyRain.weatherRainGain - heavyRain.weatherRainGain * 0.59)
    < 0.000_000_000_001,
  'Mountain-tunnel shelter must crossfade continuously from direct rain to an 18% dark return'
);
assert.equal(fullyShelteredHeavyRain.weatherRainTierIndex, heavyRain.weatherRainTierIndex);
assert.equal(fullyShelteredHeavyRain.weatherRainLightGain, 0);
assert.equal(fullyShelteredHeavyRain.weatherRainSteadyGain, 0);
assert.equal(fullyShelteredHeavyRain.weatherRainHeavyGain, 0);
assert.equal(fullyShelteredHeavyRain.weatherRainDirectGain, 0);
assert.ok(
  Math.abs(fullyShelteredHeavyRain.weatherRainTunnelGain - heavyRain.weatherRainGain * 0.18)
    < 0.000_000_000_001
);
assert.ok(
  Math.abs(undergroundHeavyRain.weatherRainTunnelGain - heavyRain.weatherRainGain * 0.10)
    < 0.000_000_000_001
);
assert.ok(
  fullyShelteredHeavyRain.weatherRainGain > undergroundHeavyRain.weatherRainGain
    && undergroundHeavyRain.weatherRainGain > 0,
  'Mountain and underground tunnels must retain distinct non-zero outside-rain transmission'
);
assert.ok(
  fullyShelteredHeavyRain.weatherRainTunnelFrequencyHz
    > undergroundHeavyRain.weatherRainTunnelFrequencyHz,
  'Underground rain transmission must be darker than the mountain-tunnel return'
);
assert.equal(bridgeHeavyRain.weatherRainGain, heavyRain.weatherRainGain);
assert.equal(bridgeHeavyRain.weatherRainDirectGain, heavyRain.weatherRainDirectGain);
assert.equal(bridgeHeavyRain.weatherRainTunnelGain, 0);

let previousMountainGain = heavyRain.weatherRainGain;
for (let step = 1; step <= 100; step++) {
  const shelter = step / 100;
  const tunnelMix = audioModule.deriveMix({
    running: true,
    weatherExposure: 1 - shelter,
    weatherTunnelSealed: true,
    weatherTunnelKind: 'mountain-tunnel',
    weatherTunnelShelter: shelter,
    weatherRain: 1
  });
  assert.ok(tunnelMix.weatherRainGain <= previousMountainGain + 0.000_000_000_001);
  assert.ok(tunnelMix.weatherRainGain >= fullyShelteredHeavyRain.weatherRainGain);
  assert.equal(tunnelMix.weatherRainTierIndex, heavyRain.weatherRainTierIndex);
  previousMountainGain = tunnelMix.weatherRainGain;
}

const exposedStorm = audioModule.deriveMix({
  running: true,
  speed: 100,
  weatherExposure: 1,
  weatherRain: 1,
  weatherWind: 0.8,
  weatherGust: 0.9,
  weatherHail: 0.7,
  weatherDust: 0.6,
  weatherSnow: 0.5
});
const shelteredStorm = audioModule.deriveMix({
  running: true,
  speed: 100,
  weatherExposure: 0,
  weatherTunnelSealed: true,
  weatherTunnelKind: 'underground-tunnel',
  weatherTunnelShelter: 1,
  weatherRain: 1,
  weatherWind: 1,
  weatherGust: 1,
  weatherHail: 1,
  weatherDust: 1,
  weatherSnow: 1
});
assert.ok(exposedStorm.weatherRainGain > 0, 'Exposed rain must own an audible continuous bed');
assert.ok(exposedStorm.weatherWindGain > 0, 'Exposed wind and snow must own an audible continuous bed');
assert.ok(exposedStorm.weatherHailGain > 0, 'Exposed hail must own a distinct filtered bed');
assert.ok(exposedStorm.weatherDustGain > 0, 'Exposed dust must own a distinct low-frequency bed');
assert.equal(shelteredStorm.weatherRainLightGain, 0);
assert.equal(shelteredStorm.weatherRainSteadyGain, 0);
assert.equal(shelteredStorm.weatherRainHeavyGain, 0);
assert.equal(shelteredStorm.weatherRainDirectGain, 0);
assert.ok(shelteredStorm.weatherRainTunnelGain > 0);
assert.equal(shelteredStorm.weatherRainGain, shelteredStorm.weatherRainTunnelGain);
assert.equal(shelteredStorm.weatherWindGain, 0);
assert.equal(shelteredStorm.weatherHailGain, 0);
assert.equal(shelteredStorm.weatherDustGain, 0);
assert.equal(shelteredStorm.weatherCombinedGain, shelteredStorm.weatherRainGain);
assert.ok(exposedStorm.weatherRainGain <= 0.011_5);
assert.ok(exposedStorm.weatherWindGain <= 0.020);
assert.ok(exposedStorm.weatherHailGain <= 0.015);
assert.ok(exposedStorm.weatherDustGain <= 0.017);
assert.ok(exposedStorm.weatherRainWindGain <= 0.022);
assert.ok(exposedStorm.weatherCombinedGain <= 0.032);
assert.ok(exposedStorm.weatherGainScale < 1, 'Extreme mixed weather must enter shared headroom');

(async () => {
  const stored = new Map();
  const unsupportedScheduler = createFakeScheduler();
  const controller = audioModule.createController({
    scheduler: unsupportedScheduler,
    storage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); }
    }
  });
  assert.equal(controller.supported, false, 'Node fixture must exercise the unsupported-browser contract');
  assert.equal(controller.getDiagnostics().contextState, 'unsupported');
  await controller.setEnabled(false);
  assert.equal(stored.get(audioModule.STORAGE_KEY), 'off');
  assert.equal(controller.getDiagnostics().masterGainTarget, 0);
  await controller.setEnabled(true, { trusted: true, reason: 'test' });
  assert.equal(stored.get(audioModule.STORAGE_KEY), 'on');
  assert.equal(controller.getDiagnostics().contextCreateCount, 0);
  await controller.destroy();

  class FakeAudioParam {
    constructor(value = 0) {
      this.value = value;
    }

    cancelAndHoldAtTime() {}

    cancelScheduledValues() {}

    setValueAtTime(value) {
      this.value = value;
    }

    setTargetAtTime(value) {
      this.value = value;
    }

    exponentialRampToValueAtTime(value) {
      this.value = value;
    }
  }

  class FakeAudioNode {
    connect(target) {
      this.target = target;
      return target;
    }

    disconnect() {
      this.disconnectCount = (this.disconnectCount || 0) + 1;
      this.target = null;
    }
  }

  class FakeSourceNode extends FakeAudioNode {
    constructor() {
      super();
      this.loop = false;
      this.buffer = null;
      this.playbackRate = new FakeAudioParam(1);
      this.onended = null;
      this.stopCallCount = 0;
      this.lastStopAt = null;
    }

    start() {
      if (!this.loop) queueMicrotask(() => this.onended?.());
    }

    stop(stopAt) {
      this.stopCallCount++;
      this.lastStopAt = stopAt;
      if (FakeSourceNode.holdScheduledEnd && Number.isFinite(stopAt) && stopAt > 0) return;
      queueMicrotask(() => this.onended?.());
    }
  }
  FakeSourceNode.holdScheduledEnd = false;

  class FakeOscillatorNode extends FakeSourceNode {
    constructor() {
      super();
      this.frequency = new FakeAudioParam(440);
      this.type = 'sine';
    }

    start() {}

    stop(stopAt) {
      super.stop(stopAt);
    }
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.destination = new FakeAudioNode();
      this.decodeCount = 0;
      this.resumeCount = 0;
      this.suspendCount = 0;
      this.oscillatorCreateCount = 0;
      this.bufferCreateCount = 0;
      this.bufferSourceCount = 0;
      this.bufferSources = [];
      this.oscillators = [];
      this.gainNodes = [];
      this.filterNodes = [];
      FakeAudioContext.instances.push(this);
    }

    createDynamicsCompressor() {
      return Object.assign(new FakeAudioNode(), {
        threshold: new FakeAudioParam(),
        knee: new FakeAudioParam(),
        ratio: new FakeAudioParam(),
        attack: new FakeAudioParam(),
        release: new FakeAudioParam()
      });
    }

    createGain() {
      const node = Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() });
      this.gainNodes.push(node);
      return node;
    }

    createBiquadFilter() {
      const node = Object.assign(new FakeAudioNode(), {
        type: 'lowpass',
        frequency: new FakeAudioParam(),
        Q: new FakeAudioParam()
      });
      this.filterNodes.push(node);
      return node;
    }

    createOscillator() {
      this.oscillatorCreateCount++;
      const oscillator = new FakeOscillatorNode();
      this.oscillators.push(oscillator);
      return oscillator;
    }

    createBuffer(_channels, frameCount) {
      this.bufferCreateCount++;
      const channel = new Float32Array(frameCount);
      return { getChannelData: () => channel };
    }

    createBufferSource() {
      this.bufferSourceCount++;
      const source = new FakeSourceNode();
      this.bufferSources.push(source);
      return source;
    }

    createDelay() {
      return Object.assign(new FakeAudioNode(), { delayTime: new FakeAudioParam() });
    }

    async decodeAudioData(encoded) {
      this.decodeCount++;
      if (FakeAudioContext.decodeHook) return FakeAudioContext.decodeHook(encoded, this);
      if (FakeAudioContext.decodeGate) await FakeAudioContext.decodeGate;
      return { duration: 1 };
    }

    async resume() {
      this.resumeCount++;
      const gate = FakeAudioContext.resumeGate;
      if (gate) await gate;
      this.state = 'running';
    }

    async suspend() {
      this.suspendCount++;
      this.state = 'suspended';
    }

    async close() {
      this.state = 'closed';
    }
  }

  FakeAudioContext.instances = [];
  FakeAudioContext.decodeGate = null;
  FakeAudioContext.decodeHook = null;
  FakeAudioContext.resumeGate = null;

  function createDeferred() {
    let resolve;
    const promise = new Promise((promiseResolve) => {
      resolve = promiseResolve;
    });
    return { promise, resolve };
  }

  async function settleMicrotasks(turns = 6) {
    for (let index = 0; index < turns; index++) await Promise.resolve();
  }

  async function waitUntil(predicate, scheduler, message) {
    const deadline = scheduler.now() + 500;
    while (!predicate()) {
      if (scheduler.now() >= deadline) assert.fail(message);
      await scheduler.advanceBy(1);
    }
  }

  const originalAudioContext = global.window.AudioContext;
  const originalLocation = global.window.location;
  const originalFetch = global.fetch;
  let fetchCount = 0;
  const fetchedUrls = [];
  let supportedLifecycle = null;

  try {
    global.window.AudioContext = FakeAudioContext;
    global.fetch = async (url) => {
      fetchCount++;
      fetchedUrls.push(String(url));
      return {
        ok: true,
        async arrayBuffer() {
          return new ArrayBuffer(8);
        }
      };
    };

    const supportedStorage = new Map();
    const supportedScheduler = createFakeScheduler();
    const supportedController = audioModule.createController({
      scheduler: supportedScheduler,
      storage: {
        getItem(key) { return supportedStorage.get(key) ?? null; },
        setItem(key, value) { supportedStorage.set(key, value); }
      }
    });

    assert.equal(supportedController.supported, true);
    assert.equal(await supportedController.unlock('untrusted-test', false), false);
    assert.equal(supportedController.getDiagnostics().contextCreateCount, 0);
    assert.equal(FakeAudioContext.instances.length, 0);

    assert.equal(await supportedController.unlock('trusted-test', true), true);
    await waitUntil(
      () => supportedController.getDiagnostics().assetsLoaded === manifestEntries.length,
      supportedScheduler,
      'Audio assets did not finish decoding'
    );

    let supportedDiagnostics = supportedController.getDiagnostics();
    const firstContext = FakeAudioContext.instances[0];
    assert.equal(FakeAudioContext.instances.length, 1);
    assert.equal(supportedDiagnostics.contextCreateCount, 1);
    assert.equal(supportedDiagnostics.contextState, 'running');
    assert.equal(supportedDiagnostics.assetsLoaded, manifestEntries.length);
    assert.equal(supportedDiagnostics.assetErrors, 0);
    assert.equal(firstContext.decodeCount, manifestEntries.length);
    assert.equal(fetchCount, manifestEntries.length);
    assert.ok(
      fetchedUrls.every((url) => url.endsWith('?v=23-ipad-road-residency-253')),
      'HTTP effect requests must share the production release cache generation'
    );
    assert.equal(supportedDiagnostics.musicActive, false);
    assert.equal(supportedDiagnostics.musicStatus, 'delegated-library');
    assert.equal(supportedDiagnostics.musicTransport, 'music-library-controller');
    assert.equal(supportedDiagnostics.directFileMusicFallback, false);
    assert.equal(supportedDiagnostics.engineActive, true);
    assert.equal(supportedDiagnostics.propulsionProfile, audioModule.PROPULSION_PROFILE);
    assert.equal(supportedDiagnostics.propulsionGainScale, 0.55);
    assert.equal(supportedDiagnostics.mixReferenceSpeedKmh, 160);
    assert.equal(supportedDiagnostics.airflowStartSpeedKmh, 50);
    assert.equal(supportedDiagnostics.surfaceReferenceSpeedKmh, 120);
    assert.equal(supportedDiagnostics.legacyPropulsionLoopsLoaded, false);
    assert.equal(firstContext.bufferCreateCount, 1, 'All continuous noise layers must share one deterministic buffer');
    assert.equal(
      firstContext.bufferSourceCount,
      3,
      'Airflow, brake, and surface contact must each own one persistent looping source'
    );

    const persistentBufferSourceCount = firstContext.bufferSourceCount;
    const persistentGainCount = firstContext.gainNodes.length;
    const persistentFilterCount = firstContext.filterNodes.length;
    for (let index = 0; index < 120; index++) {
      const rainProgress = index <= 60 ? index / 60 : (120 - index) / 60;
      supportedController.update({
        running: true,
        speed: 35 + index,
        throttle: 0,
        brake: 0,
        waterContact: index % 3 === 0 ? 0.9 : 0,
        snowContact: index % 3 === 1 ? 0.9 : 0,
        slushContact: index % 3 === 2 ? 0.9 : 0,
        contactIntensity: 0.75,
        weatherExposure: 1,
        weatherRain: rainProgress,
        weatherWind: 0.5,
        weatherGust: 0.4
      });
    }
    const automatedSurfaceMix = supportedController.update({
      running: true,
      speed: 72,
      throttle: 0,
      brake: 0,
      waterContact: 0.2,
      snowContact: 0.3,
      slushContact: 0.8,
      contactIntensity: 0.86,
      weatherExposure: 0.75,
      weatherTunnelSealed: true,
      weatherTunnelKind: 'mountain-tunnel',
      weatherTunnelShelter: 0.25,
      weatherRain: 0.9,
      weatherWind: 0.7,
      weatherGust: 0.6,
      weatherHail: 0.5,
      weatherDust: 0.4,
      weatherSnow: 0.3
    });
    assert.equal(
      firstContext.bufferSourceCount,
      persistentBufferSourceCount,
      'Per-frame contact updates must not allocate buffer sources'
    );
    assert.equal(
      firstContext.gainNodes.length,
      persistentGainCount,
      'Per-frame contact updates must not allocate gain nodes'
    );
    assert.equal(
      firstContext.filterNodes.length,
      persistentFilterCount,
      'Per-frame contact updates must not allocate filter nodes'
    );
    assert.equal(
      Object.keys(supportedDiagnostics.eventRequests).length,
      0,
      'Continuous surface contact must not synthesize gameplay event storms'
    );
    for (const gainTarget of [
      automatedSurfaceMix.waterSprayGain,
      automatedSurfaceMix.snowCompressionGain,
      automatedSurfaceMix.snowCrunchGain,
      automatedSurfaceMix.weatherRainLightGain,
      automatedSurfaceMix.weatherRainSteadyGain,
      automatedSurfaceMix.weatherRainHeavyGain,
      automatedSurfaceMix.weatherRainTunnelGain,
      automatedSurfaceMix.weatherWindGain,
      automatedSurfaceMix.weatherHailGain,
      automatedSurfaceMix.weatherDustGain
    ]) {
      assert.ok(
        firstContext.gainNodes.some((node) => node.gain.value === gainTarget),
        'Surface gain target must be applied through persistent AudioParam automation'
      );
    }
    for (const filterTarget of [
      automatedSurfaceMix.waterSprayHighpassHz,
      automatedSurfaceMix.waterSprayLowpassHz,
      automatedSurfaceMix.snowCompressionFrequencyHz,
      automatedSurfaceMix.snowCrunchHighpassHz,
      automatedSurfaceMix.snowCrunchLowpassHz,
      automatedSurfaceMix.weatherRainLightFrequencyHz,
      automatedSurfaceMix.weatherRainSteadyFrequencyHz,
      automatedSurfaceMix.weatherRainHeavyFrequencyHz,
      automatedSurfaceMix.weatherRainTunnelFrequencyHz,
      automatedSurfaceMix.weatherWindFrequencyHz,
      automatedSurfaceMix.weatherHailFrequencyHz,
      automatedSurfaceMix.weatherDustLowpassHz
    ]) {
      assert.ok(
        firstContext.filterNodes.some((node) => node.frequency.value === filterTarget),
        'Surface filter target must be applied through persistent AudioParam automation'
      );
    }
    for (const resonanceTarget of [
      automatedSurfaceMix.weatherRainLightResonanceQ,
      automatedSurfaceMix.weatherRainSteadyResonanceQ,
      automatedSurfaceMix.weatherRainHeavyResonanceQ,
      automatedSurfaceMix.weatherRainTunnelResonanceQ
    ]) {
      assert.ok(
        firstContext.filterNodes.some((node) => node.Q.value === resonanceTarget),
        'Every rain tier must automate its persistent filter resonance'
      );
    }
    supportedDiagnostics = supportedController.getDiagnostics();
    assert.equal(
      supportedDiagnostics.rainAcousticProfile,
      'raw-intensity-three-band-with-tunnel-transmission'
    );
    assert.equal(supportedDiagnostics.weatherRainIntensity, 0.9);
    assert.equal(supportedDiagnostics.weatherRainExposure, 0.75);
    assert.equal(supportedDiagnostics.weatherRainTier, 'heavy');
    assert.equal(
      supportedDiagnostics.weatherRainTunnelGain,
      automatedSurfaceMix.weatherRainTunnelGain
    );
    assert.equal(supportedDiagnostics.weatherRainGain, automatedSurfaceMix.weatherRainGain);
    assert.equal(supportedDiagnostics.weatherCombinedGain, automatedSurfaceMix.weatherCombinedGain);
    assert.ok(supportedDiagnostics.weatherCombinedGain <= 0.032);

    const persistentOscillatorCount = firstContext.oscillatorCreateCount;
    const luggingControllerMix = supportedController.update({
      running: true,
      speed: 7 / 3.6,
      coreSpool: 1,
      coreRpm: 13_962,
      thrustNormalized: 0,
      gearTorqueAvailability: 0,
      gearLuggingSeverity: 1,
      gearLoadNormalized: 1,
      gearLugging: true,
      gearStalled: true
    });
    supportedDiagnostics = supportedController.getDiagnostics();
    assert.equal(luggingControllerMix.luggingAudioMix, 1);
    assert.equal(supportedDiagnostics.gearTorqueAvailability, 0);
    assert.equal(supportedDiagnostics.gearLuggingSeverity, 1);
    assert.equal(supportedDiagnostics.gearLoadNormalized, 1);
    assert.equal(supportedDiagnostics.gearLugging, true);
    assert.equal(supportedDiagnostics.gearStalled, true);
    assert.equal(supportedDiagnostics.luggingAudioMix, 1);
    assert.equal(firstContext.oscillatorCreateCount, persistentOscillatorCount);
    assert.equal(firstContext.bufferSourceCount, persistentBufferSourceCount);
    assert.equal(firstContext.gainNodes.length, persistentGainCount);
    assert.equal(firstContext.filterNodes.length, persistentFilterCount);
    assert.equal(
      Object.keys(supportedDiagnostics.eventRequests).length,
      0,
      'Lugging must reshape the persistent graph without requesting a warning event'
    );

    const manualControlBase = {
      running: true,
      speed: 72,
      controlLeft: false,
      controlRight: false,
      controlThrottle: false,
      controlBrake: false
    };
    supportedController.update(manualControlBase);
    await supportedScheduler.advanceBy(500);
    supportedController.update({ ...manualControlBase, controlLeft: true });
    supportedController.update({ ...manualControlBase, controlLeft: true });
    supportedController.update(manualControlBase);
    await supportedScheduler.advanceBy(500);
    supportedController.update({ ...manualControlBase, controlRight: true });
    supportedController.update(manualControlBase);
    await supportedScheduler.advanceBy(500);
    supportedController.update({ ...manualControlBase, controlThrottle: true });
    supportedController.update(manualControlBase);
    await supportedScheduler.advanceBy(500);
    supportedController.update({ ...manualControlBase, controlBrake: true });
    supportedDiagnostics = supportedController.getDiagnostics();
    assert.equal(supportedDiagnostics.eventCounts['steer-left'], 1);
    assert.equal(supportedDiagnostics.eventCounts['steer-right'], 1);
    assert.equal(supportedDiagnostics.eventCounts.accelerate, 1);
    assert.equal(supportedDiagnostics.eventCounts.brake, 1);

    for (const eventName of Object.keys(audioModule.EVENT_DEFINITIONS)) {
      await supportedScheduler.advanceBy(5_000);
      assert.equal(
        supportedController.play(eventName),
        true,
        `${eventName} must reach a real decoded or synthesized voice`
      );
    }
    assert.throws(
      () => supportedController.play('undeclared-event'),
      /Unknown V23 audio event/,
      'Unknown runtime event names must fail loudly instead of hiding behind a fallback beep'
    );
    supportedDiagnostics = supportedController.getDiagnostics();
    for (const eventName of Object.keys(audioModule.EVENT_DEFINITIONS)) {
      assert.ok(supportedDiagnostics.eventCounts[eventName] >= 1, `${eventName} must be audibly exercised`);
    }

    assert.equal(supportedController.play('button'), true);
    assert.equal(supportedController.play('button'), false, 'Cooldown must reject the same-tick duplicate');
    await supportedScheduler.advanceBy(44);
    assert.equal(supportedController.play('button'), false, 'Cooldown must remain active before 45ms');
    await supportedScheduler.advanceBy(1);
    assert.equal(supportedController.play('button'), true, 'Cooldown must expire at 45ms of scheduler time');

    await supportedScheduler.advanceBy(5_000);
    FakeSourceNode.holdScheduledEnd = true;
    const thunderBufferSourceBaseline = firstContext.bufferSources.length;
    const thunderOscillatorBaseline = firstContext.oscillators.length;
    assert.equal(supportedController.play('thunder-far'), true);
    let thunderDiagnostics = supportedController.getDiagnostics();
    const scheduledThunderSources = [
      ...firstContext.bufferSources.slice(thunderBufferSourceBaseline),
      ...firstContext.oscillators.slice(thunderOscillatorBaseline)
    ];
    assert.equal(scheduledThunderSources.length, 3);
    assert.equal(thunderDiagnostics.transientVoiceCount, 3);
    assert.equal(thunderDiagnostics.liveVoices, 3);
    document.visibilityState = 'hidden';
    dispatchDocumentEvent('visibilitychange', {});
    thunderDiagnostics = supportedController.getDiagnostics();
    assert.equal(thunderDiagnostics.transientVoiceCount, 0);
    assert.equal(thunderDiagnostics.liveVoices, 0);
    assert.equal(thunderDiagnostics.cancelledTransientVoices, 3);
    assert.equal(thunderDiagnostics.lastTransientVoiceCancelReason, 'document-hidden');
    assert.ok(
      scheduledThunderSources.every((source) => source.stopCallCount === 2),
      'Hidden lifecycle must replace each scheduled thunder stop with an immediate cancellation'
    );
    await supportedScheduler.advanceBy(140);
    assert.equal(firstContext.state, 'suspended');
    document.visibilityState = 'visible';
    dispatchDocumentEvent('visibilitychange', {});
    await waitUntil(
      () => (
        firstContext.state === 'running'
        && supportedController.getDiagnostics().masterGainTarget === 1
      ),
      supportedScheduler,
      'Visible document did not resume after transient cancellation'
    );
    assert.equal(supportedController.getDiagnostics().transientVoiceCount, 0);
    assert.equal(firstContext.bufferSources.length, thunderBufferSourceBaseline + 2);
    assert.equal(firstContext.oscillators.length, thunderOscillatorBaseline + 1);
    FakeSourceNode.holdScheduledEnd = false;

    await supportedController.setEnabled(false);
    assert.equal(supportedStorage.get(audioModule.STORAGE_KEY), 'off');
    assert.equal(supportedController.getDiagnostics().masterGainTarget, 0);
    // Production leaves exactly 140ms for the switch sound and master fade before suspending the graph.
    await supportedScheduler.advanceBy(139);
    assert.equal(supportedController.getDiagnostics().contextState, 'running');
    await supportedScheduler.advanceBy(1);
    assert.equal(supportedController.getDiagnostics().contextState, 'suspended');

    await supportedController.setEnabled(true, { trusted: true, reason: 'reenable-test' });
    supportedDiagnostics = supportedController.getDiagnostics();
    assert.equal(supportedStorage.get(audioModule.STORAGE_KEY), 'on');
    assert.equal(supportedDiagnostics.contextState, 'running');
    assert.equal(supportedDiagnostics.contextCreateCount, 1);
    assert.equal(FakeAudioContext.instances.length, 1);
    assert.ok(supportedDiagnostics.graphReuseCount >= 1, 'Re-enabling must reuse the existing graph');
    supportedLifecycle = {
      contexts: FakeAudioContext.instances.length,
      decodedAssets: firstContext.decodeCount,
      graphReuseCount: supportedDiagnostics.graphReuseCount,
      persistentNoiseBuffers: firstContext.bufferCreateCount,
      persistentNoiseSources: persistentBufferSourceCount
    };
    await supportedController.destroy();
    assert.equal(firstContext.state, 'closed');

    const httpFetch = global.fetch;
    global.window.location = { protocol: 'file:' };
    global.fetch = async () => {
      assert.fail('Direct-file exact effect transport must not call fetch()');
    };
    const directFileScheduler = createFakeScheduler();
    const directFileController = audioModule.createController({
      scheduler: directFileScheduler,
      storage: null
    });
    assert.equal(await directFileController.unlock('trusted-direct-file', true), true);
    await waitUntil(
      () => directFileController.getDiagnostics().assetsLoaded === manifestEntries.length,
      directFileScheduler,
      'Direct-file exact effects did not finish decoding'
    );
    const directFileContext = FakeAudioContext.instances.at(-1);
    let directFileDiagnostics = directFileController.getDiagnostics();
    assert.equal(directFileDiagnostics.assetTransport, 'inline-exact-file');
    assert.equal(directFileDiagnostics.inlineAssetCount, manifestEntries.length);
    assert.equal(directFileDiagnostics.inlineAssetFallbacks, 0);
    assert.equal(directFileDiagnostics.assetErrors, 0);
    const directFileBufferBaseline = directFileContext.bufferSourceCount;
    const directFileOscillatorBaseline = directFileContext.oscillatorCreateCount;
    assert.equal(directFileController.play('jump'), true);
    directFileDiagnostics = directFileController.getDiagnostics();
    assert.equal(directFileDiagnostics.eventCounts.jump, 1);
    assert.equal(directFileContext.bufferSourceCount, directFileBufferBaseline + 1);
    assert.equal(
      directFileContext.oscillatorCreateCount,
      directFileOscillatorBaseline,
      'Direct-file gameplay must decode the production OGG instead of selecting synthesis'
    );
    await directFileController.destroy();
    if (originalLocation === undefined) delete global.window.location;
    else global.window.location = originalLocation;
    global.fetch = httpFetch;

    global.fetch = async () => {
      throw new Error('simulated HTTP transport failure');
    };
    const inlineFallbackScheduler = createFakeScheduler();
    const inlineFallbackController = audioModule.createController({
      scheduler: inlineFallbackScheduler,
      storage: null
    });
    assert.equal(await inlineFallbackController.unlock('trusted-inline-fallback', true), true);
    await waitUntil(
      () => inlineFallbackController.getDiagnostics().assetsLoaded === manifestEntries.length,
      inlineFallbackScheduler,
      'Exact inline fallback did not recover failed HTTP effect loads'
    );
    const inlineFallbackDiagnostics = inlineFallbackController.getDiagnostics();
    assert.equal(inlineFallbackDiagnostics.assetTransport, 'fetch-http-with-inline-fallback');
    assert.equal(inlineFallbackDiagnostics.inlineAssetFallbacks, manifestEntries.length);
    assert.equal(inlineFallbackDiagnostics.inlineAssetCount, manifestEntries.length);
    assert.equal(inlineFallbackDiagnostics.assetErrors, 0);
    assert.equal(inlineFallbackDiagnostics.synthesizedAssetFallbacks, 0);
    await inlineFallbackController.destroy();
    global.fetch = httpFetch;

    FakeAudioContext.decodeHook = async (encoded) => {
      if (encoded.byteLength === 8) throw new Error('simulated corrupt HTTP 200 payload');
      return { duration: 1 };
    };
    const corruptHttpScheduler = createFakeScheduler();
    const corruptHttpController = audioModule.createController({
      scheduler: corruptHttpScheduler,
      storage: null
    });
    assert.equal(await corruptHttpController.unlock('trusted-corrupt-http', true), true);
    await waitUntil(
      () => corruptHttpController.getDiagnostics().assetsLoaded === manifestEntries.length,
      corruptHttpScheduler,
      'Exact inline assets did not recover corrupt HTTP 200 payloads'
    );
    const corruptHttpContext = FakeAudioContext.instances.at(-1);
    const corruptHttpDiagnostics = corruptHttpController.getDiagnostics();
    assert.equal(corruptHttpContext.decodeCount, manifestEntries.length * 2);
    assert.equal(corruptHttpDiagnostics.assetTransport, 'fetch-http-with-inline-fallback');
    assert.equal(corruptHttpDiagnostics.inlineAssetFallbacks, manifestEntries.length);
    assert.equal(corruptHttpDiagnostics.inlineAssetCount, manifestEntries.length);
    assert.equal(corruptHttpDiagnostics.assetErrors, 0);
    await corruptHttpController.destroy();
    FakeAudioContext.decodeHook = null;

    const storedOffStorage = new Map([[audioModule.STORAGE_KEY, 'off']]);
    const storedOffScheduler = createFakeScheduler();
    const storedOffController = audioModule.createController({
      scheduler: storedOffScheduler,
      storage: {
        getItem(key) { return storedOffStorage.get(key) ?? null; },
        setItem(key, value) { storedOffStorage.set(key, value); }
      }
    });
    assert.equal(storedOffController.enabled, false);
    assert.equal(await storedOffController.unlock('stored-off-test', true), false);
    assert.equal(storedOffController.getDiagnostics().contextCreateCount, 0);
    assert.equal(FakeAudioContext.instances.length, 4);
    await storedOffController.destroy();

    const disableDuringResumeGate = createDeferred();
    FakeAudioContext.resumeGate = disableDuringResumeGate.promise;
    const disableDuringResumeScheduler = createFakeScheduler();
    const disableDuringResumeController = audioModule.createController({
      scheduler: disableDuringResumeScheduler,
      storage: null
    });
    const disableDuringResumeUnlock = disableDuringResumeController.unlock(
      'trusted-disable-during-resume',
      true
    );
    const disableDuringResumeContext = FakeAudioContext.instances.at(-1);
    await waitUntil(
      () => disableDuringResumeContext.resumeCount === 1,
      disableDuringResumeScheduler,
      'Disable-during-resume fixture did not enter AudioContext.resume()'
    );
    await disableDuringResumeController.setEnabled(false);
    disableDuringResumeGate.resolve();
    FakeAudioContext.resumeGate = null;
    assert.equal(await disableDuringResumeUnlock, false);
    const disableDuringResumeDiagnostics = disableDuringResumeController.getDiagnostics();
    assert.equal(disableDuringResumeController.enabled, false);
    assert.equal(disableDuringResumeDiagnostics.unlockSuccessCount, 0);
    assert.equal(disableDuringResumeDiagnostics.masterGainTarget, 0);
    assert.equal(disableDuringResumeDiagnostics.contextState, 'suspended');
    assert.equal(disableDuringResumeContext.suspendCount, 1);
    await disableDuringResumeController.destroy();

    const visibilityRaceScheduler = createFakeScheduler();
    const visibilityRaceController = audioModule.createController({
      scheduler: visibilityRaceScheduler,
      storage: null
    });
    assert.equal(await visibilityRaceController.unlock('trusted-visibility-race', true), true);
    const visibilityRaceContext = FakeAudioContext.instances.at(-1);
    document.visibilityState = 'hidden';
    dispatchDocumentEvent('visibilitychange', {});
    await visibilityRaceScheduler.advanceBy(140);
    assert.equal(visibilityRaceContext.state, 'suspended');
    const visibilityResumeGate = createDeferred();
    FakeAudioContext.resumeGate = visibilityResumeGate.promise;
    document.visibilityState = 'visible';
    dispatchDocumentEvent('visibilitychange', {});
    await waitUntil(
      () => visibilityRaceContext.resumeCount >= 2,
      visibilityRaceScheduler,
      'Visibility fixture did not begin its delayed resume'
    );
    document.visibilityState = 'hidden';
    dispatchDocumentEvent('visibilitychange', {});
    visibilityResumeGate.resolve();
    FakeAudioContext.resumeGate = null;
    await waitUntil(
      () => visibilityRaceContext.state === 'suspended' && visibilityRaceContext.suspendCount >= 2,
      visibilityRaceScheduler,
      'A stale visibility resume reopened audio after the document became hidden'
    );
    const visibilityRaceDiagnostics = visibilityRaceController.getDiagnostics();
    assert.equal(visibilityRaceDiagnostics.masterGainTarget, 0);
    assert.equal(visibilityRaceDiagnostics.contextState, 'suspended');
    await visibilityRaceController.destroy();
    document.visibilityState = 'visible';

    const delayedDecode = createDeferred();
    FakeAudioContext.decodeGate = delayedDecode.promise;
    const parityScheduler = createFakeScheduler();
    const parityController = audioModule.createController({
      scheduler: parityScheduler,
      storage: null
    });
    assert.equal(await parityController.unlock('trusted-delayed-decode', true), true);
    const parityContext = FakeAudioContext.instances.at(-1);
    await waitUntil(
      () => parityContext.decodeCount === manifestEntries.length,
      parityScheduler,
      'Delayed parity fixture did not reach every decoder'
    );
    const persistentSourceBaseline = parityContext.bufferSourceCount;
    const persistentOscillatorBaseline = parityContext.oscillatorCreateCount;
    assert.equal(parityController.getDiagnostics().assetsLoaded, 0);
    assert.equal(parityController.play('jump'), true, 'The semantic cue must be accepted while its OGG decodes');
    assert.equal(parityController.play('jump'), false, 'One pending cooldown group must not accumulate a replay storm');
    let parityDiagnostics = parityController.getDiagnostics();
    assert.equal(parityDiagnostics.eventRequests.jump, 2);
    assert.equal(parityDiagnostics.eventCounts.jump, undefined);
    assert.equal(parityDiagnostics.deferredEventCount, 1);
    assert.equal(parityDiagnostics.deferredEventRequests, 1);
    assert.equal(parityDiagnostics.synthesizedAssetFallbacks, 0);
    assert.equal(
      parityContext.bufferSourceCount,
      persistentSourceBaseline,
      'A pending sample must not start a transient buffer before decoding'
    );
    assert.equal(
      parityContext.oscillatorCreateCount,
      persistentOscillatorBaseline,
      'A pending sample must not change timbre by starting its synthesized fallback'
    );

    delayedDecode.resolve();
    FakeAudioContext.decodeGate = null;
    await waitUntil(
      () => parityController.getDiagnostics().assetsLoaded === manifestEntries.length,
      parityScheduler,
      'Deferred production samples did not finish decoding'
    );
    parityDiagnostics = parityController.getDiagnostics();
    assert.equal(parityDiagnostics.eventCounts.jump, 1);
    assert.equal(parityDiagnostics.deferredEventCount, 0);
    assert.equal(parityDiagnostics.synthesizedAssetFallbacks, 0);
    assert.equal(
      parityContext.bufferSourceCount,
      persistentSourceBaseline + 1,
      'The deferred cue must use the same decoded OGG as later gameplay'
    );
    assert.equal(
      parityContext.oscillatorCreateCount,
      persistentOscillatorBaseline,
      'Decoded completion must not retain the temporary synthesized timbre'
    );
    await parityController.destroy();

    const hiddenDecode = createDeferred();
    FakeAudioContext.decodeGate = hiddenDecode.promise;
    const hiddenDecodeScheduler = createFakeScheduler();
    const hiddenDecodeController = audioModule.createController({
      scheduler: hiddenDecodeScheduler,
      storage: null
    });
    assert.equal(await hiddenDecodeController.unlock('trusted-hidden-decode', true), true);
    const hiddenDecodeContext = FakeAudioContext.instances.at(-1);
    await waitUntil(
      () => hiddenDecodeContext.decodeCount === manifestEntries.length,
      hiddenDecodeScheduler,
      'Hidden-decode fixture did not reach every decoder'
    );
    const hiddenBufferBaseline = hiddenDecodeContext.bufferSourceCount;
    const hiddenOscillatorBaseline = hiddenDecodeContext.oscillatorCreateCount;
    assert.equal(hiddenDecodeController.play('jump'), true);
    document.visibilityState = 'hidden';
    dispatchDocumentEvent('visibilitychange', {});
    hiddenDecode.resolve();
    FakeAudioContext.decodeGate = null;
    await waitUntil(
      () => hiddenDecodeController.getDiagnostics().assetsLoaded === manifestEntries.length,
      hiddenDecodeScheduler,
      'Hidden production samples did not finish decoding'
    );
    let hiddenDecodeDiagnostics = hiddenDecodeController.getDiagnostics();
    assert.equal(hiddenDecodeDiagnostics.eventCounts.jump, undefined);
    assert.equal(hiddenDecodeDiagnostics.deferredEventCount, 0);
    assert.equal(hiddenDecodeDiagnostics.deferredEventDrops, 1);
    assert.equal(hiddenDecodeDiagnostics.lastDeferredEventDropReason, 'document-hidden');
    assert.equal(hiddenDecodeContext.bufferSourceCount, hiddenBufferBaseline);
    assert.equal(hiddenDecodeContext.oscillatorCreateCount, hiddenOscillatorBaseline);
    await hiddenDecodeScheduler.advanceBy(140);
    assert.equal(hiddenDecodeContext.state, 'suspended');
    document.visibilityState = 'visible';
    dispatchDocumentEvent('visibilitychange', {});
    await waitUntil(
      () => hiddenDecodeContext.state === 'running',
      hiddenDecodeScheduler,
      'Visible document did not resume after the hidden-decode fixture'
    );
    hiddenDecodeDiagnostics = hiddenDecodeController.getDiagnostics();
    assert.equal(hiddenDecodeDiagnostics.eventCounts.jump, undefined);
    assert.equal(hiddenDecodeContext.bufferSourceCount, hiddenBufferBaseline);
    assert.equal(hiddenDecodeContext.oscillatorCreateCount, hiddenOscillatorBaseline);
    await hiddenDecodeController.destroy();

    const staleDecode = createDeferred();
    FakeAudioContext.decodeGate = staleDecode.promise;
    const staleDecodeScheduler = createFakeScheduler();
    const staleDecodeController = audioModule.createController({
      scheduler: staleDecodeScheduler,
      storage: null
    });
    assert.equal(await staleDecodeController.unlock('trusted-stale-decode', true), true);
    const staleDecodeContext = FakeAudioContext.instances.at(-1);
    await waitUntil(
      () => staleDecodeContext.decodeCount === manifestEntries.length,
      staleDecodeScheduler,
      'Stale-decode fixture did not reach every decoder'
    );
    const staleBufferBaseline = staleDecodeContext.bufferSourceCount;
    const staleOscillatorBaseline = staleDecodeContext.oscillatorCreateCount;
    assert.equal(staleDecodeController.play('jump'), true);
    await staleDecodeScheduler.advanceBy(1_001);
    let staleDecodeDiagnostics = staleDecodeController.getDiagnostics();
    assert.equal(staleDecodeDiagnostics.deferredEventCount, 0);
    assert.equal(staleDecodeDiagnostics.deferredEventDrops, 1);
    assert.equal(staleDecodeDiagnostics.lastDeferredEventDropReason, 'expired');
    assert.equal(staleDecodeController.play('jump'), true);
    assert.equal(staleDecodeController.clearDeferredEvents('game-reset'), 1);
    assert.equal(staleDecodeController.clearDeferredEvents('game-reset'), 0);
    staleDecodeDiagnostics = staleDecodeController.getDiagnostics();
    assert.equal(staleDecodeDiagnostics.deferredEventDrops, 2);
    assert.equal(staleDecodeDiagnostics.lastDeferredEventDropReason, 'game-reset');
    staleDecode.resolve();
    FakeAudioContext.decodeGate = null;
    await waitUntil(
      () => staleDecodeController.getDiagnostics().assetsLoaded === manifestEntries.length,
      staleDecodeScheduler,
      'Cleared lifecycle samples did not finish decoding'
    );
    staleDecodeDiagnostics = staleDecodeController.getDiagnostics();
    assert.equal(staleDecodeDiagnostics.eventCounts.jump, undefined);
    assert.equal(staleDecodeContext.bufferSourceCount, staleBufferBaseline);
    assert.equal(staleDecodeContext.oscillatorCreateCount, staleOscillatorBaseline);
    await staleDecodeController.destroy();

    global.fetch = async (url) => {
      fetchCount++;
      if (String(url).includes('assets/audio/phaseJump3.ogg')) {
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        async arrayBuffer() {
          return new ArrayBuffer(8);
        }
      };
    };
    const failedAssetScheduler = createFakeScheduler();
    const failedAssetController = audioModule.createController({
      scheduler: failedAssetScheduler,
      storage: null,
      inlineAssetDataUrls: {}
    });
    const originalWarn = console.warn;
    try {
      console.warn = () => {};
      assert.equal(await failedAssetController.unlock('trusted-partial-failure', true), true);
      await waitUntil(
        () => {
          const diagnostics = failedAssetController.getDiagnostics();
          return diagnostics.assetsLoaded + diagnostics.assetErrors === manifestEntries.length;
        },
        failedAssetScheduler,
        'Partial-failure fixture did not settle every asset'
      );
    } finally {
      console.warn = originalWarn;
    }
    const failedAssetContext = FakeAudioContext.instances.at(-1);
    const failedAssetOscillatorBaseline = failedAssetContext.oscillatorCreateCount;
    assert.equal(failedAssetController.play('jump'), true);
    const failedAssetDiagnostics = failedAssetController.getDiagnostics();
    assert.equal(failedAssetDiagnostics.assetsLoaded, manifestEntries.length - 1);
    assert.deepEqual(failedAssetDiagnostics.assetErrorKeys, ['jump']);
    assert.equal(failedAssetDiagnostics.synthesizedAssetFallbacks, 1);
    assert.equal(failedAssetDiagnostics.eventCounts.jump, 1);
    assert.equal(
      failedAssetContext.oscillatorCreateCount,
      failedAssetOscillatorBaseline + 1,
      'Synthesis must remain available after the matching delivered file definitively fails'
    );
    await failedAssetController.destroy();

    const fatalStorage = new Map();
    const fatalScheduler = createFakeScheduler();
    const fatalController = audioModule.createController({
      scheduler: fatalScheduler,
      storage: {
        getItem(key) { return fatalStorage.get(key) ?? null; },
        setItem(key, value) { fatalStorage.set(key, value); }
      }
    });
    assert.equal(documentListenerCount('pointerdown'), 1);
    assert.equal(documentListenerCount('keydown'), 1);
    assert.equal(documentListenerCount('click'), 1);
    const fatalContextCount = FakeAudioContext.instances.length;
    const fatalFetchCount = fetchCount;
    await fatalController.destroy();
    assert.equal(documentListenerCount('pointerdown'), 0, 'Fatal destroy must remove capture-phase pointer unlock');
    assert.equal(documentListenerCount('keydown'), 0, 'Fatal destroy must remove capture-phase keyboard unlock');
    assert.equal(documentListenerCount('click'), 0, 'Fatal destroy must remove capture-phase click unlock');

    // A trusted gesture and every resource-producing public call remain inert after terminal shutdown.
    dispatchDocumentEvent('pointerdown', {
      isTrusted: true,
      target: interactionTarget({ gameplay: true })
    });
    dispatchDocumentEvent('keydown', {
      code: 'KeyW',
      isTrusted: true,
      target: interactionTarget()
    });
    dispatchDocumentEvent('click', {
      isTrusted: true,
      target: interactionTarget({ gameplay: true })
    });
    assert.equal(await fatalController.unlock('post-fatal-trusted', true), false);
    assert.equal(await fatalController.setEnabled(true, { trusted: true, reason: 'post-fatal-toggle' }), false);
    assert.equal(fatalController.update({ running: true, speed: 300, throttle: 1 }), false);
    assert.equal(fatalController.play('button'), false);
    assert.equal(await fatalController.destroy(), true, 'Repeated destroy must be idempotent');
    const fatalDiagnostics = fatalController.getDiagnostics();
    assert.equal(fatalController.enabled, false);
    assert.equal(fatalDiagnostics.disposed, true);
    assert.equal(fatalDiagnostics.unlockArmed, false);
    assert.equal(fatalDiagnostics.contextCreateCount, 0);
    assert.equal(fatalDiagnostics.unlockAttemptCount, 0);
    assert.equal(fatalDiagnostics.eventRequests.button, undefined);
    assert.equal(FakeAudioContext.instances.length, fatalContextCount, 'Post-fatal calls must not create a context');
    assert.equal(fetchCount, fatalFetchCount, 'Post-fatal calls must not fetch audio assets');
    assert.equal(fatalStorage.size, 0, 'Fatal shutdown must not overwrite the persisted user preference');
    assert.equal(fatalScheduler.pendingTimerCount, 0, 'Fatal shutdown must leave no delayed audio work');
  } finally {
    FakeAudioContext.decodeGate = null;
    FakeAudioContext.decodeHook = null;
    FakeAudioContext.resumeGate = null;
    FakeSourceNode.holdScheduledEnd = false;
    document.visibilityState = 'visible';
    if (originalAudioContext === undefined) delete global.window.AudioContext;
    else global.window.AudioContext = originalAudioContext;
    if (originalLocation === undefined) delete global.window.location;
    else global.window.location = originalLocation;
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
  }

  console.log(JSON.stringify({
    ok: true,
    version: audioModule.version,
    assets: manifestEntries.length,
    storageKey: audioModule.STORAGE_KEY,
    propulsionProfile: audioModule.PROPULSION_PROFILE,
    tunnelReturnGain: tunnel.tunnelReturnGain,
    highSpeedDriveCoreFrequencyHz: highSpeed.driveCoreFrequencyHz,
    highSpeedAirflowGain: highSpeed.airflowGain,
    saturatedWaterSprayGain: saturatedSurface.waterSprayGain,
    saturatedSnowCompressionGain: saturatedSurface.snowCompressionGain,
    saturatedSnowCrunchGain: saturatedSurface.snowCrunchGain,
    supportedLifecycle
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
