#!/usr/bin/env node
/*
 * Regenerate the hash-bound music visualization and loudness manifest from the redistributed masters.
 *
 * The five display bands use continuous second-order filters rather than a decorative timer. Integrated
 * loudness and true peak come from ffmpeg's ITU-R BS.1770 / EBU R128 loudnorm analysis. This developer tool
 * never runs in the browser and never changes audible playback.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TOOL_DIRECTORY, '..');
const LIBRARY_PATH = path.join(
  PROJECT_ROOT,
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-library.js'
);
const OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  'src/audio/Neon_Autopilot_HighSpeed_DroneHeat.music-rhythm.js'
);
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const SAMPLE_RATE_HZ = 12;
const ANALYSIS_SAMPLE_RATE_HZ = 22_050;
const ANALYSIS_FILTER_ORDER = 2;
const BAND_RANGES_HZ = Object.freeze([
  Object.freeze([40, 180]),
  Object.freeze([180, 500]),
  Object.freeze([500, 1_500]),
  Object.freeze([1_500, 4_000]),
  Object.freeze([4_000, 11_000])
]);

function runFfmpeg(argumentsList, options = {}) {
  const result = spawnSync(FFMPEG_PATH, argumentsList, {
    encoding: options.encoding,
    maxBuffer: 256 * 1_024 * 1_024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${String(result.stderr || '').trim()}`);
  }
  return result;
}

function loadLibrary() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(LIBRARY_PATH, 'utf8'), context, { filename: LIBRARY_PATH });
  return context.window.NeonMusicLibrary;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function decodeMonoFloat32(filePath) {
  const result = runFfmpeg([
    '-v', 'error',
    '-i', filePath,
    '-ac', '1',
    '-ar', String(ANALYSIS_SAMPLE_RATE_HZ),
    '-f', 'f32le',
    'pipe:1'
  ]);
  const samples = new Float32Array(
    result.stdout.buffer,
    result.stdout.byteOffset,
    Math.floor(result.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT)
  );
  return Float32Array.from(samples);
}

/** Build one stable constant-skirt band-pass filter for source-derived display energy. */
function createBandPass([lowHz, highHz]) {
  const centerHz = Math.sqrt(lowHz * highHz);
  const q = centerHz / (highHz - lowHz);
  const omega = 2 * Math.PI * centerHz / ANALYSIS_SAMPLE_RATE_HZ;
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b1 = 0;
  const b2 = -alpha / a0;
  const a1 = -2 * Math.cos(omega) / a0;
  const a2 = (1 - alpha) / a0;
  let input1 = 0;
  let input2 = 0;
  let output1 = 0;
  let output2 = 0;
  return {
    process(sample) {
      const output = b0 * sample + b1 * input1 + b2 * input2 - a1 * output1 - a2 * output2;
      input2 = input1;
      input1 = sample;
      output2 = output1;
      output1 = output;
      return output;
    }
  };
}

function percentile(sortedValues, proportion) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * proportion))
  );
  return sortedValues[index];
}

/** Convert filtered RMS frames into perceptually compressed four-bit display bands. */
function buildPackedEnvelope(samples) {
  const frameCount = Math.ceil(samples.length / ANALYSIS_SAMPLE_RATE_HZ * SAMPLE_RATE_HZ);
  const filters = BAND_RANGES_HZ.map(createBandPass);
  const rmsFrames = Array.from({ length: frameCount }, () => new Float64Array(BAND_RANGES_HZ.length));
  const squareSums = new Float64Array(BAND_RANGES_HZ.length);
  let frameIndex = 0;
  let frameStart = 0;
  let frameEnd = Math.min(
    samples.length,
    Math.floor((frameIndex + 1) * ANALYSIS_SAMPLE_RATE_HZ / SAMPLE_RATE_HZ)
  );

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
    for (let bandIndex = 0; bandIndex < filters.length; bandIndex++) {
      const filtered = filters[bandIndex].process(samples[sampleIndex]);
      squareSums[bandIndex] += filtered * filtered;
    }
    if (sampleIndex + 1 >= frameEnd) {
      const frameSampleCount = Math.max(1, frameEnd - frameStart);
      for (let bandIndex = 0; bandIndex < filters.length; bandIndex++) {
        rmsFrames[frameIndex][bandIndex] = Math.sqrt(squareSums[bandIndex] / frameSampleCount);
        squareSums[bandIndex] = 0;
      }
      frameIndex++;
      frameStart = frameEnd;
      frameEnd = Math.min(
        samples.length,
        Math.floor((frameIndex + 1) * ANALYSIS_SAMPLE_RATE_HZ / SAMPLE_RATE_HZ)
      );
    }
  }

  const floors = new Float64Array(BAND_RANGES_HZ.length);
  const ceilings = new Float64Array(BAND_RANGES_HZ.length);
  for (let bandIndex = 0; bandIndex < BAND_RANGES_HZ.length; bandIndex++) {
    const logged = rmsFrames
      .map((frame) => Math.log1p(frame[bandIndex] * 1_000))
      .sort((left, right) => left - right);
    floors[bandIndex] = percentile(logged, 0.1);
    ceilings[bandIndex] = percentile(logged, 0.95);
  }

  const packed = Buffer.alloc(frameCount * 3);
  for (let index = 0; index < frameCount; index++) {
    const values = new Uint8Array(BAND_RANGES_HZ.length);
    for (let bandIndex = 0; bandIndex < BAND_RANGES_HZ.length; bandIndex++) {
      const logged = Math.log1p(rmsFrames[index][bandIndex] * 1_000);
      const span = Math.max(0.000_001, ceilings[bandIndex] - floors[bandIndex]);
      const normalized = Math.max(0, Math.min(1, (logged - floors[bandIndex]) / span));
      values[bandIndex] = Math.round(Math.sqrt(normalized) * 15);
    }
    packed[index * 3] = values[0] << 4 | values[1];
    packed[index * 3 + 1] = values[2] << 4 | values[3];
    packed[index * 3 + 2] = values[4] << 4;
  }
  return { frameCount, packed };
}

function analyzeLoudness(filePath) {
  const result = runFfmpeg([
    '-hide_banner',
    '-nostats',
    '-i', filePath,
    '-af', 'loudnorm=I=-20:LRA=11:TP=-2:print_format=json',
    '-f', 'null',
    '-'
  ], { encoding: 'utf8' });
  const match = String(result.stderr).match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
  if (!match) throw new Error(`Unable to parse loudness analysis for ${filePath}`);
  const metrics = JSON.parse(match);
  return {
    integratedLufs: Number(metrics.input_i),
    truePeakDbtp: Number(metrics.input_tp),
    loudnessRangeLu: Number(metrics.input_lra)
  };
}

function formatInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
}

function formatDecimal(value, maximumFractionDigits = 6) {
  const [integerPart, fractionalPart = ''] = Number(value)
    .toFixed(maximumFractionDigits)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .split('.');
  if (!fractionalPart) return formatInteger(integerPart);
  const groupedFraction = fractionalPart.replace(/(\d{3})(?=\d)/g, '$1_');
  return `${formatInteger(integerPart)}.${groupedFraction}`;
}

function wrapBase64(value) {
  const chunks = value.match(/.{1,120}/g) || [''];
  return chunks.map((chunk, index) => (
    index === 0
      ? `'${chunk}'`
      : `        '${chunk}'`
  )).join(' +\n');
}

function renderModule(profiles) {
  const profileSource = profiles.map((profile) => `    '${profile.trackId}': Object.freeze({
      sourceSha256: '${profile.sourceSha256}',
      durationSeconds: ${formatDecimal(profile.durationSeconds)},
      frameCount: ${formatInteger(profile.frameCount)},
      integratedLufs: ${formatDecimal(profile.integratedLufs, 2)},
      truePeakDbtp: ${formatDecimal(profile.truePeakDbtp, 2)},
      loudnessRangeLu: ${formatDecimal(profile.loudnessRangeLu, 2)},
      packedBase64: ${wrapBase64(profile.packedBase64)}
    })`).join(',\n');

  return `/*
 * Neon score-synchronized rhythm and loudness profiles.
 *
 * The exact redistributed masters are decoded at 22_050 Hz. Continuous second-order filters reduce them
 * to source-derived five-band envelopes at 12 Hz, while ffmpeg loudnorm records ITU-R BS.1770 / EBU R128
 * loudness. Runtime follows native-media currentTime, so visualization never reroutes or changes playback.
 *
 * Generated by tools/generate-music-rhythm.mjs; do not hand-edit packed profile data.
 */
(() => {
  'use strict';

  const library = window.NeonMusicLibrary;
  if (!library) throw new Error('Neon music library dependency missing for rhythm profiles');

  const SAMPLE_RATE_HZ = ${formatInteger(SAMPLE_RATE_HZ)};
  const ANALYSIS_SAMPLE_RATE_HZ = ${formatInteger(ANALYSIS_SAMPLE_RATE_HZ)};
  const ANALYSIS_FILTER_ORDER = ${formatInteger(ANALYSIS_FILTER_ORDER)};
  const BAND_RANGES_HZ = Object.freeze([
    Object.freeze([40, 180]),
    Object.freeze([180, 500]),
    Object.freeze([500, 1_500]),
    Object.freeze([1_500, 4_000]),
    Object.freeze([4_000, 11_000])
  ]);
  const PROFILE_ENCODING = 'five-band-u4-three-byte-v2';
  const LOUDNESS_CONTRACT = Object.freeze({
    id: 'ebu-r128-scene-master-v1',
    analysisStandard: 'ITU-R-BS.1770 / EBU-R128 via ffmpeg-loudnorm',
    targetIntegratedLufs: -20,
    targetToleranceLu: 0.15,
    maximumTruePeakDbtp: -2,
    maximumCrossfadeTruePeakDbtp: -1,
    equalPowerCrossfadeReserveDb: 3,
    maximumInRealmDeltaLu: library.THEME_CONTRACT.maximumInRealmLoudnessDeltaLu
  });
  const PROFILE_BY_TRACK_ID = Object.freeze({
${profileSource}
  });
  const decodedProfiles = new Map();

  function decodeProfile(trackId) {
    if (decodedProfiles.has(trackId)) return decodedProfiles.get(trackId);
    const profile = PROFILE_BY_TRACK_ID[trackId];
    if (!profile) return null;
    const binary = window.atob(profile.packedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    decodedProfiles.set(trackId, bytes);
    return bytes;
  }

  /** Sample the exact score timeline into a reusable five-value output without allocating per frame. */
  function sampleInto(trackId, currentTimeSeconds, output) {
    if (!output || output.length < BAND_RANGES_HZ.length) return false;
    const profile = PROFILE_BY_TRACK_ID[trackId];
    const bytes = decodeProfile(trackId);
    if (!profile || !bytes) {
      output.fill?.(0);
      return false;
    }
    const finiteTime = Number.isFinite(currentTimeSeconds) ? Math.max(0, currentTimeSeconds) : 0;
    const frameIndex = Math.min(profile.frameCount - 1, Math.floor(finiteTime * SAMPLE_RATE_HZ));
    const offset = frameIndex * 3;
    output[0] = (bytes[offset] >> 4) / 15;
    output[1] = (bytes[offset] & 0x0f) / 15;
    output[2] = (bytes[offset + 1] >> 4) / 15;
    output[3] = (bytes[offset + 1] & 0x0f) / 15;
    output[4] = (bytes[offset + 2] >> 4) / 15;
    return true;
  }

  /** Validate packed profiles plus mastered and presentation loudness against the frozen semantic catalog. */
  function validateProfiles(
    candidateProfiles = PROFILE_BY_TRACK_ID,
    candidateTracks = library.TRACKS
  ) {
    const profiles = candidateProfiles && typeof candidateProfiles === 'object' ? candidateProfiles : {};
    const tracks = Array.isArray(candidateTracks) ? candidateTracks : [];
    const failures = [];
    const loudnessFailures = [];

    function failLoudness(message) {
      loudnessFailures.push(message);
      failures.push(message);
    }

    for (const track of tracks) {
      const profile = profiles[track.id];
      if (!profile) {
        failLoudness(\`missing:\${track.id}\`);
        continue;
      }
      if (profile.sourceSha256 !== track.sha256) failures.push(\`sha256:\${track.id}\`);
      if (Math.abs(profile.durationSeconds - track.durationSeconds) > 1 / SAMPLE_RATE_HZ) {
        failures.push(\`duration:\${track.id}\`);
      }
      if (profile.frameCount !== Math.ceil(profile.durationSeconds * SAMPLE_RATE_HZ)) {
        failures.push(\`frames:\${track.id}\`);
      }
      if (decodeProfile(track.id)?.length !== profile.frameCount * 3) failures.push(\`bytes:\${track.id}\`);
      if (Math.abs(profile.integratedLufs - LOUDNESS_CONTRACT.targetIntegratedLufs)
        > LOUDNESS_CONTRACT.targetToleranceLu) {
        failLoudness(\`integrated-lufs:\${track.id}\`);
      }
      if (profile.truePeakDbtp > LOUDNESS_CONTRACT.maximumTruePeakDbtp) {
        failLoudness(\`true-peak:\${track.id}\`);
      }
      const effectiveLufs = profile.integratedLufs + track.mixGainDb;
      const realmRange = library.REALM_SCORE_CONTRACTS[track.realmId]?.targetEffectiveLufsRange;
      if (!realmRange || effectiveLufs < realmRange[0] || effectiveLufs > realmRange[1]) {
        failLoudness(\`realm-loudness:\${track.id}\`);
      }
      const crossfadeTruePeak = profile.truePeakDbtp
        + track.mixGainDb
        + LOUDNESS_CONTRACT.equalPowerCrossfadeReserveDb;
      if (crossfadeTruePeak > LOUDNESS_CONTRACT.maximumCrossfadeTruePeakDbtp) {
        failLoudness(\`crossfade-peak:\${track.id}\`);
      }
    }

    for (const [realmId, realmTracks] of Object.entries(library.TRACKS_BY_REALM)) {
      const effectiveLoudness = realmTracks
        .map((track) => {
          const profile = profiles[track.id];
          return profile ? profile.integratedLufs + track.mixGainDb : null;
        })
        .filter(Number.isFinite);
      if (effectiveLoudness.length !== realmTracks.length
        || Math.max(...effectiveLoudness) - Math.min(...effectiveLoudness)
          > LOUDNESS_CONTRACT.maximumInRealmDeltaLu) {
        failLoudness(\`realm-delta:\${realmId}\`);
      }
    }

    if (Object.keys(profiles).length !== tracks.length) failures.push('track-count');
    return Object.freeze({
      ok: failures.length === 0,
      loudnessAligned: loudnessFailures.length === 0,
      trackCount: Object.keys(profiles).length,
      sampleRateHz: SAMPLE_RATE_HZ,
      failures: Object.freeze(failures)
    });
  }

  window.NeonMusicRhythm = Object.freeze({
    version: 'Neon-music-rhythm-4',
    SAMPLE_RATE_HZ,
    ANALYSIS_SAMPLE_RATE_HZ,
    ANALYSIS_FILTER_ORDER,
    BAND_RANGES_HZ,
    PROFILE_ENCODING,
    LOUDNESS_CONTRACT,
    PROFILE_BY_TRACK_ID,
    sampleInto,
    validateProfiles
  });
})();
`;
}

const library = loadLibrary();
const profiles = [];
for (const track of library.TRACKS) {
  const assetPath = path.join(PROJECT_ROOT, track.url);
  const actualSha256 = sha256(assetPath);
  if (actualSha256 !== track.sha256) {
    throw new Error(`Catalog hash mismatch for ${track.id}: ${actualSha256}`);
  }
  process.stderr.write(`Analyzing ${track.id}...\n`);
  const samples = decodeMonoFloat32(assetPath);
  const durationSeconds = samples.length / ANALYSIS_SAMPLE_RATE_HZ;
  const { frameCount, packed } = buildPackedEnvelope(samples);
  const loudness = analyzeLoudness(assetPath);
  profiles.push({
    trackId: track.id,
    sourceSha256: actualSha256,
    durationSeconds,
    frameCount,
    packedBase64: packed.toString('base64'),
    ...loudness
  });
}

fs.writeFileSync(OUTPUT_PATH, renderModule(profiles));
process.stderr.write(`Wrote ${OUTPUT_PATH}\n`);
