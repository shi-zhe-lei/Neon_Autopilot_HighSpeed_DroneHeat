'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Resolve production catalog code and audited media from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(PROJECT_ROOT, 'src/config/Neon_Autopilot_V23_HighSpeed_DroneHeat.config.js'));
require(path.join(PROJECT_ROOT, 'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.music-library.js'));

const config = global.window.NeonV23Config;
const library = global.window.NeonV23MusicLibrary;

/** Hash the exact redistributed bytes so a silent asset replacement cannot inherit stale provenance. */
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('twelve immutable licensed instrumental cues satisfy the six-realm semantic contract', () => {
  assert.equal(library.version, 'V23-music-library-4');
  assert.equal(library.THEME_CONTRACT.id, 'sky-six-realm-semantics-v3');
  assert.deepEqual(library.THEME_CONTRACT.allowedLicenses, ['CC0-1.0', 'CC-BY-3.0']);
  assert.equal(library.THEME_CONTRACT.maximumAbsoluteMixGainDb, 3);
  assert.equal(library.THEME_CONTRACT.maximumInRealmLoudnessDeltaLu, 0.15);
  assert.equal(library.THEME_CONTRACT.masteringContractId, 'ebu-r128-scene-master-v1');
  assert.equal(library.THEME_CONTRACT.gameplayWrites, false);
  assert.equal(library.THEME_CONTRACT.minimumTracksPerRealm, 2);
  assert.equal(library.TRACKS.length, 12);
  assert.equal(Object.isFrozen(library.TRACKS), true);
  assert.deepEqual(library.REALM_IDS, config.zones.map((zone) => zone.id));
  assert.deepEqual(
    library.TRACKS.map((track) => track.id),
    [
      'dawn-awakening',
      'dawn-first-flight',
      'prairie-meadow',
      'prairie-companions',
      'rainforest-shelter',
      'rainforest-growth',
      'valley-flight',
      'valley-crescendo',
      'vault-memories',
      'vault-stillness',
      'eden-pilgrimage',
      'eden-rebirth'
    ]
  );
  for (const [realmIndex, zone] of config.zones.entries()) {
    const realmTracks = library.TRACKS_BY_REALM[zone.id];
    const realmContract = library.REALM_SCORE_CONTRACTS[zone.id];
    assert.equal(realmTracks.length, 2, `${zone.id} must ship two map scores`);
    assert.deepEqual(realmTracks.map((track) => track.realmTrackIndex), [0, 1]);
    assert.ok(realmTracks.every((track) => track.realmIndex === realmIndex));
    assert.ok(realmTracks.every((track) => track.realmName === zone.name));
    assert.deepEqual(realmTracks.map((track) => track.cueRole), realmContract.chapters.map((chapter) => chapter.role));
    assert.ok(realmTracks.every((track) => track.percussionDensity <= realmContract.maximumPercussionDensity));
    assert.deepEqual(library.TRACK_IDS_BY_REALM[zone.id], realmTracks.map((track) => track.id));
    assert.equal(library.TRACK_ID_BY_REALM[zone.id], realmTracks[0].id);
  }
  assert.deepEqual(
    Object.fromEntries(library.TRACKS.map((track) => [track.id, track.mixGainDb])),
    {
      'dawn-awakening': -2,
      'dawn-first-flight': -2,
      'prairie-meadow': -1,
      'prairie-companions': -1,
      'rainforest-shelter': -2,
      'rainforest-growth': -2,
      'valley-flight': 0,
      'valley-crescendo': 0,
      'vault-memories': -3,
      'vault-stillness': -3,
      'eden-pilgrimage': -1,
      'eden-rebirth': -1
    }
  );
  assert.deepEqual(library.validateThemeContract(), {
    ok: true,
    trackCount: 12,
    realmCount: 6,
    semanticAligned: true,
    licensingAligned: true,
    playerSignoffPending: true,
    failures: []
  });

  for (const track of library.TRACKS) {
    assert.equal(Object.isFrozen(track), true);
    assert.equal(Object.isFrozen(track.themeTags), true);
    assert.equal(Object.isFrozen(track.instrumentation), true);
    assert.equal(Object.isFrozen(track.semanticTokens), true);
    assert.ok(library.THEME_CONTRACT.allowedLicenses.includes(track.license));
    if (track.license === 'CC-BY-3.0') assert.ok(track.attribution.trim().length > 0);
    assert.equal(track.instrumental, true);
    assert.equal(track.loopStrategy, 'equal-power-crossfade');
    assert.ok(track.energy >= 0 && track.energy <= 1);
    assert.ok(track.durationSeconds >= 20);
    assert.equal(track.themeTags.length, 3);
    const assetPath = path.join(PROJECT_ROOT, track.url);
    assert.ok(fs.statSync(assetPath).size > 0, `${track.id} must ship a non-empty local asset`);
    assert.equal(sha256(assetPath), track.sha256, `${track.id} bytes must match the reviewed source record`);
  }
});

test('semantic and licensing validation rejects injectable cue-role, percussion, and attribution drift', () => {
  const replaceTrack = (trackId, patch) => library.TRACKS.map(
    (track) => track.id === trackId ? { ...track, ...patch } : track
  );

  const cueRoleResult = library.validateThemeContract(replaceTrack('dawn-awakening', {
    cueRole: 'crescendo'
  }));
  assert.equal(cueRoleResult.ok, false);
  assert.equal(cueRoleResult.semanticAligned, false);
  assert.equal(cueRoleResult.licensingAligned, true);
  assert.equal(cueRoleResult.playerSignoffPending, true);
  assert.ok(cueRoleResult.failures.includes('cue-role:dawn-awakening'));

  const percussionResult = library.validateThemeContract(replaceTrack('dawn-awakening', {
    percussionDensity: 0.01
  }));
  assert.equal(percussionResult.ok, false);
  assert.equal(percussionResult.semanticAligned, false);
  assert.equal(percussionResult.licensingAligned, true);
  assert.ok(percussionResult.failures.includes('percussion:dawn-awakening'));

  const attributionResult = library.validateThemeContract(replaceTrack('prairie-companions', {
    attribution: ''
  }));
  assert.equal(attributionResult.ok, false);
  assert.equal(attributionResult.semanticAligned, true);
  assert.equal(attributionResult.licensingAligned, false);
  assert.ok(attributionResult.failures.includes('attribution:prairie-companions'));
});

test('adaptive, sequential, and shuffle selectors never consume or mutate gameplay state', () => {
  for (let realmIndex = 0; realmIndex < config.zones.length; realmIndex++) {
    assert.equal(library.trackForRealmIndex(realmIndex), library.TRACKS[realmIndex * 2]);
    assert.equal(library.trackForRealmIndex(realmIndex, 1), library.TRACKS[realmIndex * 2 + 1]);
    assert.equal(library.trackForRealmProgress(realmIndex, 0), library.TRACKS[realmIndex * 2]);
    assert.equal(library.trackForRealmProgress(realmIndex, 0.5), library.TRACKS[realmIndex * 2 + 1]);
  }
  assert.equal(library.trackForRealmIndex(-1), library.TRACKS[0]);
  assert.equal(library.trackForRealmIndex(99), library.TRACKS[0]);
  assert.equal(library.adjacentRealmTrackId('dawn-awakening', -1), 'dawn-first-flight');
  assert.equal(library.adjacentRealmTrackId('dawn-first-flight', 1), 'dawn-awakening');
  assert.equal(library.adjacentTrackId('dawn-awakening', -1), 'eden-rebirth');
  assert.equal(library.adjacentTrackId('eden-rebirth', 1), 'dawn-awakening');

  for (let counter = 0; counter < 256; counter++) {
    const first = library.shuffledTrackId('vault-memories', counter, 2_301);
    const repeated = library.shuffledTrackId('vault-memories', counter, 2_301);
    assert.equal(first, repeated, 'music shuffle must be deterministic for its own seed and counter');
    assert.notEqual(first, 'vault-memories', 'shuffle must not immediately repeat the current track');
    assert.ok(library.TRACK_BY_ID[first]);
  }
});
