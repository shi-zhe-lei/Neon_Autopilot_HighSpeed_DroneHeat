'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Resolve production audio and presentation sources from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = {
  atob(value) {
    return Buffer.from(value, 'base64').toString('binary');
  }
};
const documentListeners = new Map();
global.document = {
  visibilityState: 'visible',
  createElement() { return null; },
  addEventListener(type, listener) {
    const bucket = documentListeners.get(type) || [];
    bucket.push(listener);
    documentListeners.set(type, bucket);
  },
  removeEventListener(type, listener) {
    documentListeners.set(type, (documentListeners.get(type) || []).filter((candidate) => candidate !== listener));
  }
};

require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-library.js'));
require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-rhythm.js'));
require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-player.js'));

const playerModule = global.window.NeonMusicPlayer;
const library = global.window.NeonMusicLibrary;
const rhythm = global.window.NeonMusicRhythm;

/** Mirror the player's catalog mastering conversion for exact native-media volume assertions. */
function linearGain(decibels) {
  return Math.pow(10, decibels / 20);
}

class FakeClock {
  constructor() {
    this.timeMs = 0;
  }

  now() {
    return this.timeMs;
  }

  advance(deltaMs) {
    this.timeMs += deltaMs;
  }
}

class FakeMediaElement {
  constructor(url) {
    this.src = url;
    this.preload = '';
    this.playsInline = false;
    this.loop = false;
    this.volume = 1;
    this.paused = true;
    this.ended = false;
    this.playCount = 0;
    this.pauseCount = 0;
    this.loadCount = 0;
    this.currentTime = 0;
    this.onended = null;
    this.onerror = null;
  }

  play() {
    this.playCount++;
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }

  pause() {
    this.pauseCount++;
    this.paused = true;
  }

  finish() {
    this.ended = true;
    this.paused = true;
    this.onended?.();
  }

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }

  load() {
    this.loadCount++;
  }
}

/** Flush the native-media play promise and the controller continuation that commits its deck. */
async function settlePlayback() {
  await Promise.resolve();
  await Promise.resolve();
}

test('adaptive library stays allocation-free until trusted intent and crossfades realm tracks', async () => {
  const clock = new FakeClock();
  const storage = new Map();
  const elements = [];
  const controller = playerModule.createController({
    clock,
    storage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    mediaElementFactory(url) {
      const element = new FakeMediaElement(url);
      elements.push(element);
      return element;
    }
  });

  assert.equal(playerModule.version, 'Neon-music-player-8');
  assert.equal(controller.getDiagnostics().modeId, 'adaptive');
  controller.update({ realmIndex: 4, musicGain: 0, previewing: false });
  assert.equal(controller.getDiagnostics().desiredTrackId, 'vault-memories');
  assert.equal(elements.length, 0, 'presentation changes must not allocate media before play intent');
  assert.equal(await controller.unlock('untrusted', false), false);
  assert.equal(elements.length, 0);

  assert.equal(await controller.unlock('trusted-start', true), true);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].src, 'assets/audio/music_vault_memory_strings.ogg');
  assert.equal(elements[0].loop, false, 'adaptive playback must rotate through both tracks in its realm');
  const vaultTrack = library.TRACK_BY_ID['vault-memories'];
  const vaultProfile = rhythm.PROFILE_BY_TRACK_ID['vault-memories'];
  const unlockedDiagnostics = controller.getDiagnostics();
  assert.equal(unlockedDiagnostics.currentTrackId, 'vault-memories');
  assert.equal(unlockedDiagnostics.semanticContractId, 'sky-six-realm-semantics-v3');
  assert.equal(unlockedDiagnostics.semanticAligned, true);
  assert.equal(unlockedDiagnostics.licensingAligned, true);
  assert.equal(unlockedDiagnostics.loudnessContractId, 'ebu-r128-scene-master-v1');
  assert.equal(unlockedDiagnostics.loudnessAligned, true);
  assert.equal(unlockedDiagnostics.playerSignoffPending, true);
  assert.equal(unlockedDiagnostics.activeTrackIntegratedLufs, vaultProfile.integratedLufs);
  assert.equal(
    unlockedDiagnostics.activeTrackEffectiveLufs,
    vaultProfile.integratedLufs + vaultTrack.mixGainDb
  );
  assert.equal(unlockedDiagnostics.activeTrackTruePeakDbtp, vaultProfile.truePeakDbtp);
  assert.equal(
    unlockedDiagnostics.activeTrackCrossfadeWorstCaseDbtp,
    vaultProfile.truePeakDbtp
      + vaultTrack.mixGainDb
      + rhythm.LOUDNESS_CONTRACT.equalPowerCrossfadeReserveDb
  );

  controller.update({ realmIndex: 4, musicGain: 0, previewing: true });
  assert.equal(elements[0].volume, 0, 'new track starts silent at the crossfade boundary');
  clock.advance(800);
  controller.update({ realmIndex: 4, musicGain: 0, previewing: true });
  assert.ok(Math.abs(elements[0].volume - 0.17 * linearGain(-3) / Math.sqrt(2)) < 0.000_001);
  clock.advance(800);
  controller.update({ realmIndex: 4, musicGain: 0, previewing: true });
  assert.ok(Math.abs(elements[0].volume - 0.17 * linearGain(-3)) < 0.000_001);

  controller.update({ realmIndex: 5, musicGain: 0, previewing: true });
  await settlePlayback();
  assert.equal(elements.length, 2);
  assert.equal(elements[1].src, 'assets/audio/music_eden_last_light.ogg');
  assert.equal(controller.getDiagnostics().currentTrackId, 'eden-pilgrimage');
  assert.equal(controller.getDiagnostics().automaticSwitchCount, 1);
  clock.advance(800);
  controller.update({ realmIndex: 5, musicGain: 0, previewing: true });
  assert.ok(Math.abs(elements[0].volume - 0.17 * linearGain(-3) / Math.sqrt(2)) < 0.000_001);
  assert.ok(Math.abs(elements[1].volume - 0.17 * linearGain(-1) / Math.sqrt(2)) < 0.000_001);
  clock.advance(800);
  controller.update({ realmIndex: 5, musicGain: 0, previewing: true });
  assert.equal(elements[0].paused, true);
  assert.equal(elements[0].src, '');
  assert.ok(Math.abs(elements[1].volume - 0.17 * linearGain(-1)) < 0.000_001);
  controller.update({ realmIndex: 5, musicGain: 0.16, previewing: false });
  assert.ok(Math.abs(elements[1].volume - 0.16 * linearGain(-1)) < 0.000_001);
  controller.update({ realmIndex: 5, musicGain: 0, previewing: true });
  assert.ok(
    Math.abs(elements[1].volume - 0.16 * linearGain(-1)) < 0.000_001,
    'Paused preview must retain the most recent production flight gain instead of a private audition level'
  );
  assert.equal(controller.getDiagnostics().activeDeckCount, 1);

  await controller.destroy();
  assert.equal(elements[1].paused, true);
  assert.equal(elements[1].src, '');
  assert.equal(controller.getDiagnostics().disposed, true);
});

test('adaptive realm chapters and natural endings both consume the complete current-map playlist', async () => {
  const clock = new FakeClock();
  const elements = [];
  const controller = playerModule.createController({
    clock,
    storage: null,
    mediaElementFactory(url) {
      const element = new FakeMediaElement(url);
      elements.push(element);
      return element;
    }
  });

  controller.update({ realmIndex: 2, realmProgress: 0, musicGain: 0.17 });
  assert.equal(await controller.unlock('trusted-start', true), true);
  assert.equal(controller.getDiagnostics().currentTrackId, 'rainforest-shelter');

  controller.update({ realmIndex: 2, realmProgress: 0.6, musicGain: 0.17 });
  await settlePlayback();
  assert.equal(controller.getDiagnostics().currentTrackId, 'rainforest-growth');
  assert.equal(controller.getDiagnostics().realmChapterIndex, 1);
  assert.equal(controller.getDiagnostics().automaticSwitchCount, 1);

  elements.at(-1).finish();
  await settlePlayback();
  assert.equal(controller.getDiagnostics().currentTrackId, 'rainforest-shelter');
  assert.equal(controller.getDiagnostics().automaticSwitchCount, 2);
  controller.update({ realmIndex: 2, realmProgress: 0.6, musicGain: 0.17 });
  assert.equal(
    controller.getDiagnostics().currentTrackId,
    'rainforest-shelter',
    'a natural in-realm rotation must not be reverted on the next frame'
  );

  await controller.destroy();
});

test('source-derived timeline drives five live music bands without changing native playback', async () => {
  const clock = new FakeClock();
  const elements = [];
  const controller = playerModule.createController({
    clock,
    storage: null,
    mediaElementFactory(url) {
      const element = new FakeMediaElement(url);
      elements.push(element);
      return element;
    }
  });

  controller.update({ realmIndex: 0, musicGain: 0.17, previewing: false });
  assert.equal(elements.length, 0, 'browsing and presentation updates must remain allocation-free');

  assert.equal(await controller.unlock('trusted-start', true), true);
  clock.advance(1_600);
  controller.update({ realmIndex: 0, musicGain: 0.17, previewing: false });
  elements[0].currentTime = 2.24;
  clock.advance(17);
  const energetic = controller.getVisualization();
  assert.equal(energetic.live, true);
  assert.equal(energetic.status, 'profile-live');
  assert.equal(energetic.bands.length, 5);
  assert.ok(energetic.energy > 0.5);
  assert.ok(
    Math.abs(elements[0].volume - 0.17 * linearGain(-2)) < 0.000_001,
    'native media must retain audible gain authority'
  );
  assert.ok(
    Math.abs(controller.getDiagnostics().activeDeckVolume - 0.17 * linearGain(-2)) < 0.000_001
  );
  assert.equal(controller.getDiagnostics().analysisTransport, 'precomputed-five-band-envelope');
  assert.equal(controller.getDiagnostics().analysisContextState, 'not-required');

  elements[0].currentTime = 39;
  let quiet = energetic;
  for (let frame = 0; frame < 12; frame++) {
    clock.advance(17);
    quiet = controller.getVisualization();
  }
  assert.ok(quiet.energy < energetic.energy * 0.5, 'bar energy must release when the score profile becomes quiet');

  elements[0].currentTime = 2.24;
  clock.advance(17);
  const rebound = controller.getVisualization();
  assert.ok(rebound.energy > quiet.energy, 'bar energy must attack again at the next energetic score position');
  assert.ok(
    Math.abs(elements[0].volume - 0.17 * linearGain(-2)) < 0.000_001,
    'timeline sampling must not touch native volume'
  );
  await controller.destroy();
});

test('catalog mastering applies each six-realm presentation gain without changing source identity', async () => {
  const clock = new FakeClock();
  const elements = [];
  const controller = playerModule.createController({
    clock,
    storage: null,
    mediaElementFactory(url) {
      const element = new FakeMediaElement(url);
      elements.push(element);
      return element;
    }
  });
  const baseVolume = 0.2;
  const expectations = [
    ['dawn-awakening', 'assets/audio/music_dawn_first_light.ogg', -2],
    ['dawn-first-flight', 'assets/audio/music_dawn_cloudborne_dream.ogg', -2],
    ['prairie-meadow', 'assets/audio/music_prairie_meadow_harp.ogg', -1],
    ['prairie-companions', 'assets/audio/music_prairie_companion_flutes.ogg', -1],
    ['rainforest-shelter', 'assets/audio/music_rainforest_shelter.ogg', -2],
    ['rainforest-growth', 'assets/audio/music_rainforest_after_rain.ogg', -2],
    ['valley-flight', 'assets/audio/music_valley_flight.ogg', 0],
    ['valley-crescendo', 'assets/audio/music_valley_crescendo.ogg', 0],
    ['vault-memories', 'assets/audio/music_vault_memory_strings.ogg', -3],
    ['vault-stillness', 'assets/audio/music_vault_silent_bells.ogg', -3],
    ['eden-pilgrimage', 'assets/audio/music_eden_last_light.ogg', -1],
    ['eden-rebirth', 'assets/audio/music_eden_rebirth.ogg', -1]
  ];

  controller.update({ realmIndex: 0, musicGain: baseVolume, previewing: false });
  await controller.unlock('trusted-start', true);
  clock.advance(1_600);
  controller.update({ realmIndex: 0, musicGain: baseVolume, previewing: false });
  assert.ok(Math.abs(elements[0].volume - baseVolume * linearGain(-2)) < 0.000_001);

  for (const [trackId, expectedUrl, mixGainDb] of expectations) {
    await controller.selectTrack(trackId, { trusted: true });
    clock.advance(1_600);
    controller.update({ realmIndex: 0, musicGain: baseVolume, previewing: false });
    const expectedVolume = baseVolume * linearGain(mixGainDb);
    assert.equal(elements.at(-1).src, expectedUrl);
    assert.ok(Math.abs(elements.at(-1).volume - expectedVolume) < 0.000_001, trackId);
    const diagnostics = controller.getDiagnostics();
    const profile = rhythm.PROFILE_BY_TRACK_ID[trackId];
    assert.equal(diagnostics.activeTrackMixGainDb, mixGainDb);
    assert.ok(
      Math.abs(diagnostics.activeTrackLinearGain - linearGain(mixGainDb)) < 0.000_001,
      trackId
    );
    assert.equal(diagnostics.activeTrackIntegratedLufs, profile.integratedLufs);
    assert.equal(diagnostics.activeTrackEffectiveLufs, profile.integratedLufs + mixGainDb);
    assert.equal(diagnostics.activeTrackTruePeakDbtp, profile.truePeakDbtp);
    assert.equal(
      diagnostics.activeTrackCrossfadeWorstCaseDbtp,
      profile.truePeakDbtp + mixGainDb + rhythm.LOUDNESS_CONTRACT.equalPowerCrossfadeReserveDb
    );
  }

  await controller.destroy();
});

test('the library equalizer consumes live bands instead of a decorative timer', () => {
  const playerSource = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-player.js'),
    'utf8'
  );
  const mainSource = fs.readFileSync(
    path.join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'),
    'utf8'
  );
  const stylesheetSource = fs.readFileSync(
    path.join(PROJECT_ROOT, 'styles/Neon_Autopilot_HighSpeed_DroneHeat.css'),
    'utf8'
  );
  assert.match(playerSource, /rhythm\.sampleInto/);
  assert.doesNotMatch(playerSource, /AudioContext|captureStream|createMediaElementSource/);
  assert.match(mainSource, /music\.getVisualization\(\)/);
  assert.match(mainSource, /dataset\.rhythmSource =/);
  assert.match(stylesheetSource, /transform: scaleY\(var\(--music-meter-scale, 0\.72\)\)/);
  assert.doesNotMatch(stylesheetSource, /sky-score-pulse/);
});

test('manual, sequential, shuffle, persistence, master toggle, and terminal destroy share one controller', async () => {
  const clock = new FakeClock();
  const storage = new Map();
  const elements = [];
  const controller = playerModule.createController({
    clock,
    shuffleSeed: 2_301,
    storage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    mediaElementFactory(url) {
      const element = new FakeMediaElement(url);
      elements.push(element);
      return element;
    }
  });

  await controller.unlock('trusted-start', true);
  controller.update({ realmIndex: 0, musicGain: 0.17 });
  clock.advance(1_600);
  controller.update({ realmIndex: 0, musicGain: 0.17 });

  await controller.setMode('sequential', { trusted: true, reason: 'mode:sequential' });
  assert.equal(elements.at(-1).loop, false);
  elements.at(-1).finish();
  await settlePlayback();
  assert.equal(controller.getDiagnostics().currentTrackId, 'dawn-first-flight');
  assert.equal(controller.getDiagnostics().sequentialAdvanceCount, 1);

  await controller.setMode('shuffle', { trusted: true, reason: 'mode:shuffle' });
  const beforeShuffle = controller.getDiagnostics().currentTrackId;
  elements.at(-1).finish();
  await settlePlayback();
  assert.notEqual(controller.getDiagnostics().currentTrackId, beforeShuffle);
  assert.equal(controller.getDiagnostics().shuffleAdvanceCount, 1);

  await controller.selectTrack('rainforest-shelter', { trusted: true });
  assert.equal(controller.getDiagnostics().modeId, 'manual');
  assert.equal(controller.getDiagnostics().selectedTrackId, 'rainforest-shelter');
  assert.equal(storage.get(playerModule.MODE_STORAGE_KEY), 'manual');
  assert.equal(storage.get(playerModule.TRACK_STORAGE_KEY), 'rainforest-shelter');
  assert.equal(elements.at(-1).loop, true);

  await controller.next({ trusted: true });
  assert.equal(controller.getDiagnostics().currentTrackId, 'rainforest-growth');
  await controller.previous({ trusted: true });
  assert.equal(controller.getDiagnostics().currentTrackId, 'rainforest-shelter');

  await controller.setEnabled(false);
  assert.equal(controller.enabled, false);
  assert.equal(elements.every((element) => element.paused), true);
  const elementCountBeforeEnable = elements.length;
  assert.equal(await controller.setEnabled(true, { trusted: true, reason: 'master-toggle' }), true);
  assert.equal(elements.length, elementCountBeforeEnable, 're-enabling the same track must reuse its active deck');

  assert.throws(() => controller.setMode('unknown'), /Unknown music mode/);
  assert.throws(() => controller.selectTrack('unknown'), /Unknown music track/);
  await controller.destroy();
  const elementCountAfterDestroy = elements.length;
  assert.equal(await controller.unlock('post-fatal', true), false);
  assert.equal(await controller.selectTrack('dawn-awakening', { trusted: true }), false);
  assert.equal(elements.length, elementCountAfterDestroy, 'terminal destroy must prevent future media allocation');
});

test('a rejected native-media play releases its deck and reports one fail-soft themed-track error', async () => {
  const elements = [];
  const controller = playerModule.createController({
    storage: null,
    mediaElementFactory(url) {
      const element = new FakeMediaElement(url);
      element.play = () => {
        element.playCount++;
        return Promise.reject(new Error('fixture decode rejection'));
      };
      elements.push(element);
      return element;
    }
  });

  const originalWarn = console.warn;
  let unlockResult;
  try {
    console.warn = () => {};
    unlockResult = await controller.unlock('trusted-failure', true);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(unlockResult, false);
  const diagnostics = controller.getDiagnostics();
  assert.equal(elements.length, 1);
  assert.equal(elements[0].paused, true);
  assert.equal(elements[0].src, '');
  assert.equal(diagnostics.status, 'error');
  assert.equal(diagnostics.activeDeckCount, 0);
  assert.equal(diagnostics.currentTrackId, null);
  assert.deepEqual(diagnostics.failedTrackIds, ['dawn-awakening']);
  assert.match(diagnostics.lastError, /fixture decode rejection/);
  await controller.destroy();
});
