#!/usr/bin/env node
/** Cinematic edge-deck layout contract / 电影模式边缘仪表布局合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = join(__dirname, '../..');
const css = readFileSync(join(
  PROJECT_ROOT,
  'styles/Neon_Autopilot_HighSpeed_DroneHeat.css'
), 'utf8');
const html = readFileSync(join(PROJECT_ROOT, 'Neon_Autopilot_HighSpeed_DroneHeat.html'), 'utf8');
const runtime = readFileSync(join(
  PROJECT_ROOT,
  'src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'
), 'utf8');
const marker = 'Desktop film mode is an edge-mounted observation deck';
const markerIndex = css.indexOf(marker);
assert.notEqual(markerIndex, -1, 'missing desktop film-deck authority block');
const nextSectionMarker = 'One transmission presentation mirrors the authoritative gear packet';
const nextSectionIndex = css.indexOf(nextSectionMarker, markerIndex);
assert.notEqual(nextSectionIndex, -1, 'missing CSS boundary after desktop film-deck authority block');
// Film prohibitions apply only to the owned block; later independent UI may legitimately use centered positioning.
const filmCss = css.slice(markerIndex, nextSectionIndex);

/** Return one function body so adjacent presentation code cannot satisfy an input-authority assertion. */
function functionSource(functionName) {
  const signature = `function ${functionName}(`;
  const start = runtime.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${functionName}`);
  const bodyStart = runtime.indexOf('{', runtime.indexOf(')', start) + 1);
  let depth = 0;
  for (let index = bodyStart; index < runtime.length; index++) {
    if (runtime[index] === '{') depth++;
    else if (runtime[index] === '}') {
      depth--;
      if (depth === 0) return runtime.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function: ${functionName}`);
}

test('desktop film deck uses one readable monitor hero plus three secondary cards', () => {
  assert.match(
    filmCss,
    /html\[data-cinematic-camera="on"\]:not\(\[data-mobile-cockpit="true"\]\) \.hud\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*stretch;[\s\S]*?width:\s*min\(390px,[\s\S]*?gap:\s*10px;/
  );
  assert.match(
    filmCss,
    /\.hud > :is\([\s\S]*?\.hud-primary,[\s\S]*?\.hud-navigation[\s\S]*?\)\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/
  );
  assert.match(
    filmCss,
    /\.hud-navigation\s*\{[\s\S]*?height:\s*auto;[\s\S]*?padding:\s*0;[\s\S]*?overflow:\s*visible;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?pointer-events:\s*none;/
  );
  assert.match(
    filmCss,
    /\.hud-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.64fr\) minmax\(116px,\s*0\.78fr\);[\s\S]*?grid-template-rows:\s*repeat\(3,\s*minmax\(50px,\s*auto\)\);[\s\S]*?gap:\s*7px;/
  );
  assert.match(
    filmCss,
    /\.metric\.speedometer-metric\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1 \/ 4;[\s\S]*?grid-template-rows:\s*auto minmax\(56px,\s*1fr\) auto;[\s\S]*?min-height:\s*164px;/
  );
  for (const [className, row] of [
    ['score-metric', 1],
    ['handling-metric', 2],
    ['life-metric', 3]
  ]) {
    assert.match(
      filmCss,
      new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?grid-column:\\s*2;`
        + `[\\s\\S]*?grid-row:\\s*${row};`)
    );
  }
  assert.match(
    filmCss,
    /\.minimap-panel,[\s\S]*?\.auto-panel,[\s\S]*?\.key-tracker,[\s\S]*?\.desktop-compass\s*\{\s*display:\s*none;/
  );
  assert.match(
    filmCss,
    /\.transmission-range-panel\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0,\s*1fr\);[\s\S]*?min-height:\s*32px;[\s\S]*?border-radius:\s*9px;/
  );
  assert.match(
    filmCss,
    /\.speedometer-heading > span,[\s\S]*?\.speedometer-dial,[\s\S]*?\.propulsion-core,[\s\S]*?\.gear-range-bands\s*\{\s*display:\s*none;/
  );
  assert.doesNotMatch(
    filmCss,
    /(?:transmission-selector|transmission-range-panel|gear-operating-range)[^{}]*\{[^{}]*display:\s*none;/
  );
  assert.doesNotMatch(filmCss, /(?:letterbox|black-bar|top:\s*50%|left:\s*50%)/i);
});

test('film deck preserves the four live values and life protection semantics', () => {
  for (const id of [
    'speedValue',
    'score',
    'expCount',
    'lifeMetric',
    'livesHearts',
    'lifeProtectionTime'
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.match(
    filmCss,
    /\.hud-primary \.life-protection\s*\{[\s\S]*?position:\s*static;[\s\S]*?max-width:\s*100%;/
  );
  assert.match(
    css,
    /\.hud-primary \.life-metric\[data-damage-impact="true"\][\s\S]*?inset 7px 0 0 #ff405b/
  );
  assert.match(
    css,
    /\.life-metric\[data-invincible="true"\] \.life-protection\s*\{\s*display:\s*inline-flex;/
  );
  assert.match(
    filmCss,
    /\.hud-primary \.life-metric\[data-invincible="true"\]\s*\{[\s\S]*?border-left-color:\s*rgba\(159,\s*231,\s*223,\s*0\.92\);/
  );
  assert.match(
    filmCss,
    /\.hud-primary \.life-metric\[data-damage-impact="true"\]\s*\{[\s\S]*?inset 5px 0 0 #ff405b,/
  );
  assert.doesNotMatch(
    filmCss,
    /(?:speedometer-metric|score-metric|handling-metric|life-metric)[^{}]*\{[^{}]*display:\s*none;/
  );
});

test('film command deck gives driving ownership and utility controls separate rows', () => {
  assert.match(
    filmCss,
    /:where\(\.hud-actions\)\s*\{[\s\S]*?position:\s*static;[\s\S]*?width:\s*100%;[\s\S]*?grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);[\s\S]*?grid-template-rows:\s*auto auto;[\s\S]*?gap:\s*6px;[\s\S]*?padding:\s*7px;[\s\S]*?transform:\s*none;[\s\S]*?pointer-events:\s*auto;/
  );
  assert.match(
    filmCss,
    /\.hud-actions :is\(\s*#viewBtn,[\s\S]*?#lightingBtn\s*\)\s*\{\s*display:\s*none;/
  );
  assert.doesNotMatch(
    filmCss,
    /\.hud-actions :is\([^{}]*(?:#autoPilotBtn|#speedModeBtn)[^{}]*\)\s*\{\s*display:\s*none;/
  );
  for (const [id, column, row] of [
    ['autoPilotBtn', '1 / 3', 1],
    ['speedModeBtn', '3 / 5', 1],
    ['cinematicBtn', '5 / 7', 1],
    ['pauseBtn', '1 / 4', 2],
    ['fullscreenBtn', '4 / 7', 2]
  ]) {
    const control = html.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0] || '';
    assert.match(control, /data-flight-deck-control/);
    assert.match(control, /tabindex="-1"/);
    assert.doesNotMatch(control, /aria-live|role="status"/);
    assert.match(
      filmCss,
      new RegExp(`#${id}\\s*\\{[\\s\\S]*?grid-column:\\s*${column.replace('/', '\\/')};`
        + `[\\s\\S]*?grid-row:\\s*${row};`)
    );
  }
  assert.match(
    filmCss,
    /:is\(#pauseBtn, #fullscreenBtn\) \.hud-toggle-meta\s*\{\s*display:\s*flex;/
  );
  assert.doesNotMatch(html, /id="cinematicFilmDeck"|id="cinematicFilmOverlay"/);
});

test('short desktop film canvases preserve hierarchy instead of collapsing into one strip', () => {
  assert.match(
    filmCss,
    /@media \(max-height:\s*620px\) and \(min-width:\s*721px\)\s*\{[\s\S]*?\.hud\s*\{[\s\S]*?width:\s*min\(372px,[\s\S]*?gap:\s*6px;[\s\S]*?\.hud-grid\s*\{[\s\S]*?grid-template-rows:\s*repeat\(3,\s*43px\);[\s\S]*?\.metric\.speedometer-metric\s*\{[\s\S]*?min-height:\s*139px;/
  );
  assert.doesNotMatch(
    filmCss,
    /@media \(max-height:\s*620px\)[\s\S]*?grid-template-columns:\s*repeat\(5/
  );
});

test('Film keeps P, M, T, and driving live while Q/E visibility follows MT/AT authority', () => {
  for (const id of [
    'autoPilotBtn',
    'speedModeBtn',
    'transmissionSelector',
    'gearDownBtn',
    'gearIndicator',
    'gearUpBtn',
    'transmissionModeBtn',
    'gearOperatingRange',
    'mobileAutoPilotBtn',
    'mobileSpeedModeBtn',
    'mobileTransmissionSelector',
    'mobileGearDownBtn',
    'mobileGearIndicator',
    'mobileGearUpBtn',
    'mobileTransmissionModeBtn',
    'mobileGearOperatingRange'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="gear-range-bands"/);
  assert.match(html, /class="mobile-gear-range-bands"/);

  const autopilotPresentation = functionSource('syncAutoPilotButtonPresentation');
  assert.match(autopilotPresentation, /button\.disabled = false;/);
  assert.doesNotMatch(autopilotPresentation, /cameraCinematic/);

  const throttlePresentation = functionSource('syncAutomaticThrottleButtonPresentation');
  assert.match(throttlePresentation, /button\.disabled = false;/);
  assert.doesNotMatch(throttlePresentation, /cameraCinematic/);

  const transmissionPresentation = functionSource('syncDriveTransmissionModeButtonPresentation');
  assert.match(transmissionPresentation, /transmissionModeBtn\.disabled = false;/);
  assert.match(transmissionPresentation, /mobileTransmissionModeBtn\.disabled = false;/);
  assert.doesNotMatch(transmissionPresentation, /cameraCinematic/);

  const gearPresentation = functionSource('syncGearControlPresentation');
  assert.doesNotMatch(gearPresentation, /cameraCinematic/);
  assert.match(gearPresentation, /button\.hidden = transmissionAutomatic/);
  assert.match(gearPresentation, /button\.inert = transmissionAutomatic/);
  assert.match(gearPresentation, /button\.setAttribute\('aria-hidden', String\(transmissionAutomatic\)\)/);
  assert.match(gearPresentation, /button\.disabled = transmissionAutomatic/);

  const filmToggle = functionSource('setCinematicCamera');
  assert.doesNotMatch(
    filmToggle,
    /state\.(?:autoPilot|manualThrottleMode|driveTransmissionMode|driveGear|pendingDriveGear|speed|lateral|autoTarget|manualBrake|autoBrake|throttleCommand)\s*=/
  );
  assert.doesNotMatch(
    runtime,
    /cinematicSuppressedDrivingCodes|acquireCinematicDrivingAuthority|releaseCinematicDrivingAuthority/
  );

  const keydownStart = runtime.indexOf("window.addEventListener('keydown'");
  const keydownEnd = runtime.indexOf("window.addEventListener('keyup'", keydownStart);
  assert.ok(keydownStart >= 0 && keydownEnd > keydownStart);
  const keydownSource = runtime.slice(keydownStart, keydownEnd);
  assert.doesNotMatch(
    keydownSource,
    /cameraCinematicActive[\s\S]*?(?:preventDefault\(\)|return)/
  );
  for (const actuator of [
    'keys.left = true',
    'keys.right = true',
    'keys.throttle = true',
    'keys.brake = true',
    'jump();',
    'toggleAutomaticThrottle();',
    'toggleDriveTransmissionMode();',
    "requestDriveGear(state.driveGear - 1, 'keyboard-q')",
    "requestDriveGear(state.driveGear + 1, 'keyboard-e')",
    'toggleAutoPilot();'
  ]) assert.match(keydownSource, new RegExp(actuator.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(functionSource('holdButton'), /cameraCinematicActive/);
  const jumpButtonStart = runtime.indexOf('const activateJumpButton = (event) => {');
  const jumpButtonEnd = runtime.indexOf('};', jumpButtonStart);
  assert.ok(jumpButtonStart >= 0 && jumpButtonEnd > jumpButtonStart);
  assert.doesNotMatch(runtime.slice(jumpButtonStart, jumpButtonEnd), /cameraCinematicActive/);
});

test('phone and iPad film status remains clipped inside the existing left telemetry card', () => {
  const glance = html.match(/<button class="mobile-flight-glance"[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(glance, /id="mobileCinematicIndicator" hidden aria-hidden="true"/);
  assert.doesNotMatch(glance, /mobileCinematicIndicator[^>]*data-flight-deck-control/);
  assert.match(
    filmCss,
    /html\[data-mobile-cockpit="true"\]\[data-cinematic-camera="on"\] \.mobile-flight-glance\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?isolation:\s*isolate;/
  );
  assert.match(
    filmCss,
    /html\[data-mobile-cockpit="true"\]\[data-cinematic-camera="on"\] \.mobile-cinematic-indicator:not\(\[hidden\]\)\s*\{[\s\S]*?max-width:\s*calc\(100% - 61px\);/
  );
  assert.doesNotMatch(filmCss, /mobile-route-cue[^{}]*\{[^{}]*display:\s*none;/);
  assert.doesNotMatch(filmCss, /mobile-cinematic-indicator[^{}]*\{[^{}]*position:\s*fixed;/);
});
