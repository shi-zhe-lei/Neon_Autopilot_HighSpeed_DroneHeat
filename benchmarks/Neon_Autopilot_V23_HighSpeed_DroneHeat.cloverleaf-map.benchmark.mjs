#!/usr/bin/env node
/**
 * Informational benchmark for the production cloverleaf map on the Node Canvas fixture.
 * Timing never participates in verify-node; a killable Worker supplies the hang guard
 * that synchronous map code cannot provide from the measuring thread itself.
 */
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(benchmarkDirectory, '..');
const fixtureFile = 'tests/integration/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-map.test.js';
const MINIMUM_NODE_MAJOR = 20;
const WARMUP_RUNS = 5;
const SAMPLE_RUNS = 20;
const HANG_GUARD_MS = 60_000;
const BYTES_PER_GIBIBYTE = 1_073_741_824;
const REFERENCE_BUDGETS_MS = Object.freeze({
  'moving-640x360': 3,
  'steady-640x360': 3,
  'steady-400x225': 3,
  'steady-240x135': 2,
  'steady-160x108': 2
});

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < MINIMUM_NODE_MAJOR) {
  throw new Error(`Node.js ${MINIMUM_NODE_MAJOR}+ is required; current version is ${process.versions.node}`);
}

/** Run one complete set of production map updates while retaining each scenario's internal frame P95. */
function measureSample(collectMapDrawPerformanceSample) {
  const startedAt = performance.now();
  const sample = collectMapDrawPerformanceSample();
  const resolutionMetrics = Object.fromEntries(sample.resolutions.map((entry) => (
    [`steady-${entry.width}x${entry.height}`, entry.drawP95Ms]
  )));
  const scenarios = Object.freeze({
    'moving-640x360': sample.movingWorldCache.drawP95Ms,
    ...resolutionMetrics
  });
  for (const scenario of Object.keys(REFERENCE_BUDGETS_MS)) {
    if (!Number.isFinite(scenarios[scenario])) throw new Error(`Map benchmark omitted scenario ${scenario}`);
  }
  return Object.freeze({
    sampleWallMs: performance.now() - startedAt,
    scenarios
  });
}

/** Keep warmup and measured samples in one Worker so JIT state is representative and the parent can terminate hangs. */
function collectWorkerSamples() {
  const require = createRequire(import.meta.url);
  const fixture = require(join(projectDirectory, fixtureFile));
  if (typeof fixture.collectMapDrawPerformanceSample !== 'function') {
    throw new Error('Cloverleaf map benchmark fixture did not export its performance workload');
  }
  for (let index = 0; index < WARMUP_RUNS; index++) {
    measureSample(fixture.collectMapDrawPerformanceSample);
  }
  const samples = [];
  for (let index = 0; index < SAMPLE_RUNS; index++) {
    samples.push(measureSample(fixture.collectMapDrawPerformanceSample));
  }
  return Object.freeze(samples);
}

/** Nearest-rank percentiles make the P50/P95 definition explicit and stable across hosts. */
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

function runWorkerWithHangGuard() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: Object.freeze({ mode: 'measure-map' }) });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error(`Map benchmark exceeded its ${HANG_GUARD_MS}ms hang guard`));
    }, HANG_GUARD_MS);

    worker.once('message', (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message?.ok) resolve(message.samples);
      else reject(new Error(message?.message || 'Map benchmark Worker failed'));
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Map benchmark Worker exited with code ${code} before publishing results`));
    });
  });
}

if (!isMainThread) {
  if (workerData?.mode !== 'measure-map') throw new Error('Unknown map benchmark Worker mode');
  try {
    parentPort.postMessage({ ok: true, samples: collectWorkerSamples() });
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error?.message || String(error) });
  }
} else {
  const samples = await runWorkerWithHangGuard();
  const scenarioResults = Object.fromEntries(Object.entries(REFERENCE_BUDGETS_MS).map(([scenario, budgetMs]) => {
    const values = samples.map((sample) => sample.scenarios[scenario]);
    return [scenario, Object.freeze({
      ...summarize(values),
      referenceBudgetMs: budgetMs,
      samplesAboveReference: values.filter((value) => value > budgetMs).length
    })];
  }));
  const cpuList = cpus();
  const report = Object.freeze({
    benchmark: 'v23-cloverleaf-map-node-fixture',
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
      percentileMethod: 'nearest-rank',
      timer: 'performance.now',
      surface: 'deterministic-no-raster-canvas2d',
      hangGuardMs: HANG_GUARD_MS
    }),
    results: Object.freeze({
      sampleWallMs: summarize(samples.map((sample) => sample.sampleWallMs)),
      scenarios: Object.freeze(scenarioResults)
    })
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
