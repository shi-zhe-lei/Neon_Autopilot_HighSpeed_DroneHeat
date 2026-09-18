'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

// Resolve production audio modules from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = {
  atob(value) {
    return Buffer.from(value, 'base64').toString('binary');
  }
};

require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.music-library.js'));
require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.music-rhythm.js'));

const library = global.window.NeonV23MusicLibrary;
const rhythm = global.window.NeonV23MusicRhythm;

test('all audited tracks expose valid source-bound five-band rhythm profiles', () => {
  const validation = rhythm.validateProfiles();
  assert.equal(rhythm.version, 'V23-music-rhythm-4');
  assert.deepEqual(validation.failures, []);
  assert.equal(validation.ok, true);
  assert.equal(validation.loudnessAligned, true);
  assert.equal(validation.trackCount, library.TRACKS.length);
  assert.equal(validation.sampleRateHz, 12);
  assert.equal(rhythm.SAMPLE_RATE_HZ, 12);
  assert.equal(rhythm.ANALYSIS_SAMPLE_RATE_HZ, 22_050);
  assert.equal(rhythm.ANALYSIS_FILTER_ORDER, 2);
  assert.equal(rhythm.PROFILE_ENCODING, 'five-band-u4-three-byte-v2');
  assert.deepEqual(rhythm.BAND_RANGES_HZ, [
    [40, 180],
    [180, 500],
    [500, 1_500],
    [1_500, 4_000],
    [4_000, 11_000]
  ]);

  for (const track of library.TRACKS) {
    const profile = rhythm.PROFILE_BY_TRACK_ID[track.id];
    assert.equal(profile.sourceSha256, track.sha256);
    assert.equal(profile.frameCount, Math.ceil(profile.durationSeconds * rhythm.SAMPLE_RATE_HZ));
  }
});

test('offline loudness measurements preserve master, crossfade, and in-realm limits', () => {
  assert.deepEqual(rhythm.LOUDNESS_CONTRACT, {
    id: 'ebu-r128-scene-master-v1',
    analysisStandard: 'ITU-R-BS.1770 / EBU-R128 via ffmpeg-loudnorm',
    targetIntegratedLufs: -20,
    targetToleranceLu: 0.15,
    maximumTruePeakDbtp: -2,
    maximumCrossfadeTruePeakDbtp: -1,
    equalPowerCrossfadeReserveDb: 3,
    maximumInRealmDeltaLu: 0.15
  });
  assert.equal(
    rhythm.LOUDNESS_CONTRACT.maximumInRealmDeltaLu,
    library.THEME_CONTRACT.maximumInRealmLoudnessDeltaLu
  );

  for (const track of library.TRACKS) {
    const profile = rhythm.PROFILE_BY_TRACK_ID[track.id];
    const loudnessError = Math.abs(
      profile.integratedLufs - rhythm.LOUDNESS_CONTRACT.targetIntegratedLufs
    );
    assert.ok(
      loudnessError <= rhythm.LOUDNESS_CONTRACT.targetToleranceLu,
      `${track.id} must remain within -20 ±0.15 LUFS`
    );
    assert.ok(
      profile.truePeakDbtp <= rhythm.LOUDNESS_CONTRACT.maximumTruePeakDbtp,
      `${track.id} master true peak must remain within contract`
    );

    const effectiveLufs = profile.integratedLufs + track.mixGainDb;
    const realmRange = library.REALM_SCORE_CONTRACTS[track.realmId].targetEffectiveLufsRange;
    assert.ok(
      effectiveLufs >= realmRange[0] && effectiveLufs <= realmRange[1],
      `${track.id} presentation loudness must remain inside its realm range`
    );

    const crossfadeTruePeakDbtp = profile.truePeakDbtp
      + track.mixGainDb
      + rhythm.LOUDNESS_CONTRACT.equalPowerCrossfadeReserveDb;
    assert.ok(
      crossfadeTruePeakDbtp <= rhythm.LOUDNESS_CONTRACT.maximumCrossfadeTruePeakDbtp,
      `${track.id} crossfade peak must retain equal-power headroom`
    );
  }

  for (const [realmId, realmTracks] of Object.entries(library.TRACKS_BY_REALM)) {
    const effectiveLoudness = realmTracks.map((track) => (
      rhythm.PROFILE_BY_TRACK_ID[track.id].integratedLufs + track.mixGainDb
    ));
    const inRealmDeltaLu = Math.max(...effectiveLoudness) - Math.min(...effectiveLoudness);
    assert.ok(
      inRealmDeltaLu <= rhythm.LOUDNESS_CONTRACT.maximumInRealmDeltaLu,
      `${realmId} chapters must remain within the in-realm loudness delta`
    );
  }
});

test('timeline samples remain normalized and vary with every score', () => {
  const bands = new Float32Array(5);
  for (const track of library.TRACKS) {
    const signatures = new Set();
    const profile = rhythm.PROFILE_BY_TRACK_ID[track.id];
    const stride = Math.max(1, Math.floor(profile.frameCount / 120));
    for (let frame = 0; frame < profile.frameCount; frame += stride) {
      assert.equal(rhythm.sampleInto(track.id, frame / rhythm.SAMPLE_RATE_HZ, bands), true);
      for (const band of bands) {
        assert.ok(band >= 0 && band <= 1);
        assert.ok(Math.abs(band * 15 - Math.round(band * 15)) < 0.000_001);
      }
      signatures.add(Array.from(bands).join(','));
    }
    assert.ok(signatures.size > 10, `${track.id} must contain real temporal variation`);
  }

  bands.fill(1);
  assert.equal(rhythm.sampleInto('missing-track', 1, bands), false);
  assert.deepEqual(Array.from(bands), [0, 0, 0, 0, 0]);
});
