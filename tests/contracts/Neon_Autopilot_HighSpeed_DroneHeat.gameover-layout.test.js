#!/usr/bin/env node
/* Static ownership and syntax contracts for the isolated real-runtime game-over browser audit. */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = join(__dirname, '../..');
const RUNTIME_PATH = join(
  PROJECT_ROOT,
  'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'
);
const FIXTURE_PATH = join(
  PROJECT_ROOT,
  'tests/browser/Neon_Autopilot_HighSpeed_DroneHeat.gameover-layout-test.html'
);
const runtime = readFileSync(RUNTIME_PATH, 'utf8');
const fixture = readFileSync(FIXTURE_PATH, 'utf8');

function occurrenceCount(source, token) {
  return source.split(token).length - 1;
}

test('modelDebug exposes one narrow game-over presentation hook backed only by endGame', () => {
  assert.equal(occurrenceCount(runtime, 'presentGameOverForLayoutAudit'), 1);
  const publicDiagnosticsIndex = runtime.indexOf('const publicDiagnostics = {}');
  const modelDebugIndex = runtime.indexOf('if (launchOptions.modelDebug) {', publicDiagnosticsIndex);
  const testHooksIndex = runtime.indexOf("Object.defineProperty(publicDiagnostics, 'testHooks'", modelDebugIndex);
  const hookIndex = runtime.indexOf('presentGameOverForLayoutAudit()', testHooksIndex);
  const publicSealIndex = runtime.indexOf('window.NeonDiagnostics = Object.freeze(publicDiagnostics)', hookIndex);
  assert.ok(publicDiagnosticsIndex >= 0, 'missing public diagnostic surface');
  assert.ok(modelDebugIndex > publicDiagnosticsIndex, 'test hooks must remain behind modelDebug');
  assert.ok(testHooksIndex > modelDebugIndex, 'missing modelDebug testHooks property');
  assert.ok(hookIndex > testHooksIndex, 'game-over audit hook must stay inside testHooks');
  assert.ok(publicSealIndex > hookIndex, 'game-over audit hook must be installed before diagnostics are sealed');

  const hookBody = runtime.match(
    /presentGameOverForLayoutAudit\(\)\s*\{([\s\S]*?)\n\s*\},/
  )?.[1];
  assert.ok(hookBody, 'missing game-over audit hook body');
  assert.equal(
    hookBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim(),
    'return endGame();',
    'the layout hook must delegate exclusively to the real terminal boundary'
  );
  assert.match(
    runtime.slice(testHooksIndex, hookIndex),
    /production boundary keeps rating sealing, input\/audio release, and overlay synchronization authoritative/,
    'the narrow authority boundary needs an intent-level contract comment'
  );
});

test('modelDebug guardrail audit uses the real protected damage authority', () => {
  assert.equal(occurrenceCount(runtime, 'acceptGuardrailDamageForLayoutAudit'), 1);
  const hookBody = runtime.match(
    /acceptGuardrailDamageForLayoutAudit\(\)\s*\{([\s\S]*?)\n\s*\},/
  )?.[1];
  assert.ok(hookBody, 'missing guardrail rating audit hook');
  assert.equal(
    hookBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim(),
    'return takeCurveGuardrailDamage();'
  );
  assert.doesNotMatch(
    hookBody,
    /state\.|invincibleTimer|damageAcceptedThisRenderFrame|endGame\(/,
    'the audit hook may not bypass protection, mutate rating counters, or force the terminal boundary'
  );
});

test('standalone game-over fixture owns the complete phone and iPad orientation matrix', () => {
  for (const viewport of ['440x956', '844x390', '820x1180', '1180x820']) {
    assert.match(fixture, new RegExp(`'${viewport}'`), `missing ${viewport}`);
  }
  assert.match(
    fixture,
    /const requiredCases = Object\.freeze\(\['440x956', '844x390', '820x1180', '1180x820'\]\)/
  );
  assert.match(fixture, /const fixtureVersion = 'neon-ipad-road-residency-253';/);
  assert.match(fixture, /modelDebug=1&cache=253&fixtureVersion=\$\{fixtureVersion\}/);
  assert.match(fixture, /Object\.hasOwn\(cases, requestedCase\)/);
  assert.doesNotMatch(fixture, /layout-test\.html/);
});

test('fixture starts the real run before requesting the real game-over boundary', () => {
  const startIndex = fixture.indexOf('startButton.click();');
  const successfulFrameIndex = fixture.indexOf("'the first successful gameplay frame'", startIndex);
  const hookLookupIndex = fixture.indexOf(
    'win.NeonDiagnostics?.testHooks?.presentGameOverForLayoutAudit',
    successfulFrameIndex
  );
  const hookCallIndex = fixture.indexOf('const endGameAccepted = endGameHook();', hookLookupIndex);
  assert.ok(startIndex >= 0, 'fixture must activate the authored start action');
  assert.ok(successfulFrameIndex > startIndex, 'fixture must await the first successful gameplay frame');
  assert.ok(hookLookupIndex > successfulFrameIndex, 'fixture must resolve the narrow hook after launch');
  assert.ok(hookCallIndex > hookLookupIndex, 'fixture must invoke the narrow hook after resolving it');
  assert.doesNotMatch(fixture, /NeonDiagnostics(?:\?|)\.state/);
  assert.match(fixture, /params\.get\('damage'\) === 'guardrail'/);
  assert.match(fixture, /acceptGuardrailDamageForLayoutAudit/);
  assert.match(fixture, /invulnerability-rejects-immediate-guardrail-repeat/);
  assert.match(fixture, /protection\?\.invulnerable === false/);
});

test('fixture asserts game-over semantics, containment, evidence scrolling, and readable orientations', () => {
  for (const checkName of [
    'game-over-mode-is-authoritative-and-modal',
    'game-over-card-and-actions-stay-inside-the-viewport',
    'rating-and-five-axis-radar-are-rendered',
    'guardrail-life-loss-is-labelled-on-the-sealed-safety-rating',
    'portrait-and-landscape-essential-copy-remains-readable',
    'page-card-and-modal-have-zero-overflow',
    'only-the-rating-evidence-surface-may-scroll',
    'radar-and-final-rating-evidence-are-reachable-without-moving-actions'
  ]) {
    assert.match(fixture, new RegExp(`'${checkName}'`), `missing browser check ${checkName}`);
  }
  assert.match(
    fixture,
    /#overlay\[data-overlay-mode="gameover"\] \.launch-grid/
  );
  assert.match(fixture, /declaredScrollOwners\.every\(\(element\) => element === evidenceScroll\)/);
  assert.match(fixture, /activeScrollOwners\.every\(\(element\) => element === evidenceScroll\)/);
  assert.match(fixture, /documentElement\.scrollWidth/);
  assert.match(fixture, /documentElement\.scrollHeight/);
  assert.match(fixture, /dataset\.gameOverLayoutAuditReady = 'true'/);
  assert.match(fixture, /dataset\.gameOverLayoutAuditResult = JSON\.stringify\(output\)/);
});

test('every standalone fixture inline script parses as JavaScript', () => {
  const inlineScripts = [...fixture.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]))
    .map((match) => match[2]);
  assert.equal(inlineScripts.length, 1, 'fixture should own one self-contained inline harness');
  for (const source of inlineScripts) {
    assert.doesNotThrow(() => new Function(source));
  }
});
