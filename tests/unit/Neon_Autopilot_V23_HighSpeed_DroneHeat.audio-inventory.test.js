'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AUDIO_ROOT = path.join(PROJECT_ROOT, 'assets/audio');
global.window = {};

require(path.join(
  PROJECT_ROOT,
  'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.music-library.js'
));
require(path.join(
  PROJECT_ROOT,
  'src/audio/Neon_Autopilot_V23_HighSpeed_DroneHeat.audio.js'
));

const library = global.window.NeonV23MusicLibrary;
const audio = global.window.NeonV23Audio;

test('every shipped audio file has exactly one declared music or effects owner', () => {
  const shippedUrls = fs.readdirSync(AUDIO_ROOT)
    .filter((fileName) => /\.(?:mp3|ogg|wav)$/i.test(fileName))
    .map((fileName) => `assets/audio/${fileName}`)
    .sort();
  const declaredUrls = [
    ...library.TRACKS.map((track) => track.url),
    ...Object.values(audio.ASSET_MANIFEST).map((asset) => asset.url)
  ].sort();

  assert.equal(new Set(declaredUrls).size, declaredUrls.length, 'Audio owners must not alias one file');
  assert.deepEqual(
    shippedUrls,
    declaredUrls,
    'No audio file may ship without a runtime consumer, and no declaration may point at a missing file'
  );
  assert.equal(library.TRACKS.length, 12);
  assert.equal(Object.keys(audio.ASSET_MANIFEST).length, 9);
});
