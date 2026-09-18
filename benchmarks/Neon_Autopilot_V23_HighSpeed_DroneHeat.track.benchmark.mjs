#!/usr/bin/env node
/**
 * Informational wall-clock benchmark for the production cloverleaf geometry batch.
 * This script has no pass/fail threshold and is intentionally excluded from the
 * deterministic Node regression gate; compare results only on like-for-like hosts.
 */
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(benchmarkDirectory, '..');
const require = createRequire(import.meta.url);
const MINIMUM_NODE_MAJOR = 20;
const WARMUP_RUNS = 5;
const SAMPLE_RUNS = 20;
const BUILD_SLICE_BUDGET_MS = 4;
const MAX_BUILD_STEPS = 1_000_000;
const BYTES_PER_GIBIBYTE = 1_073_741_824;

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < MINIMUM_NODE_MAJOR) {
  throw new Error(`Node.js ${MINIMUM_NODE_MAJOR}+ is required; current version is ${process.versions.node}`);
}

globalThis.window = globalThis;
const originalConsoleWarn = console.warn;
let THREE;
try {
  // Three.js prints a CommonJS deprecation notice that would corrupt the JSON report.
  console.warn = () => {};
  THREE = require(join(projectDirectory, 'vendor/three-0.160.0.min.js'));
} finally {
  console.warn = originalConsoleWarn;
}
globalThis.THREE = THREE;
require(join(projectDirectory, 'src/rendering/Neon_Autopilot_V23_HighSpeed_DroneHeat.modeling.js'));
require(join(projectDirectory, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.track.js'));
require(join(projectDirectory, 'src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf.js'));

const track = globalThis.NeonV23Track;
const cloverleafVisuals = globalThis.NeonV23CloverleafVisuals;
if (!track?.graph || typeof cloverleafVisuals?.createGeometryBatchAuditJob !== 'function') {
  throw new Error('V23 track or cloverleaf geometry benchmark contract did not load');
}

/** Drain one fresh production batch and dispose GPU-facing wrappers after recording its timing metrics. */
function measureBuild() {
  const job = cloverleafVisuals.createGeometryBatchAuditJob({
    THREE,
    track,
    qualityProfile: Object.freeze({ id: 'mobile' })
  });
  const startedAt = performance.now();
  let stepCount = 0;
  while (!job.step(BUILD_SLICE_BUDGET_MS)) {
    stepCount++;
    // This corruption guard prevents an infinite CLI hang; it is not a performance target.
    if (stepCount > MAX_BUILD_STEPS) throw new Error('Cloverleaf benchmark build did not complete');
  }
  const totalBuildMs = performance.now() - startedAt;
  const batch = job.finish();
  const sample = Object.freeze({
    totalBuildMs,
    maximumSliceMs: batch.metrics.maximumSliceMs,
    sliceOverrunCount: batch.metrics.sliceOverrunCount,
    stepCount
  });
  batch.roadShellGeometry?.dispose();
  batch.staticLineGeometry?.dispose();
  batch.decorativeLaneGeometry?.dispose();
  return sample;
}

/** Nearest-rank percentiles keep the reported P50/P95 definition stable across Node versions. */
function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  const rounded = (value) => Number(value.toFixed(3));
  return Object.freeze({
    minimum: rounded(sorted[0]),
    p50: rounded(percentile(0.50)),
    p95: rounded(percentile(0.95)),
    maximum: rounded(sorted.at(-1))
  });
}

for (let index = 0; index < WARMUP_RUNS; index++) measureBuild();
const samples = [];
for (let index = 0; index < SAMPLE_RUNS; index++) samples.push(measureBuild());

const cpuList = cpus();
const report = Object.freeze({
  benchmark: 'v23-cloverleaf-geometry-batch',
  gate: 'informational-only',
  baseline: Object.freeze({
    node: process.versions.node,
    v8: process.versions.v8,
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpu: cpuList[0]?.model || 'unknown',
    logicalCpuCount: cpuList.length,
    totalMemoryGiB: Number((totalmem() / BYTES_PER_GIBIBYTE).toFixed(2))
  }),
  config: Object.freeze({
    warmupRuns: WARMUP_RUNS,
    sampleRuns: SAMPLE_RUNS,
    qualityProfile: 'mobile',
    sliceBudgetMs: BUILD_SLICE_BUDGET_MS,
    maximumBuildStepsSafetyGuard: MAX_BUILD_STEPS,
    percentileMethod: 'nearest-rank'
  }),
  results: Object.freeze({
    totalBuildMs: summarize(samples.map((sample) => sample.totalBuildMs)),
    maximumSliceMs: summarize(samples.map((sample) => sample.maximumSliceMs)),
    stepCount: summarize(samples.map((sample) => sample.stepCount)),
    sliceOverrunCount: Object.freeze({
      total: samples.reduce((sum, sample) => sum + sample.sliceOverrunCount, 0),
      maximumPerRun: Math.max(...samples.map((sample) => sample.sliceOverrunCount))
    })
  })
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
