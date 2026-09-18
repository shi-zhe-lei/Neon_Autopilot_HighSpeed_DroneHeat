#!/usr/bin/env node
/** Cinematic HUD projection contract / 电影视角 HUD 投影合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = join(__dirname, '../..');
const runtime = readFileSync(join(
  PROJECT_ROOT,
  'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'
), 'utf8');
const html = readFileSync(join(PROJECT_ROOT, 'Neon_Autopilot_V23_HighSpeed_DroneHeat.html'), 'utf8');
const css = readFileSync(join(
  PROJECT_ROOT,
  'styles/Neon_Autopilot_V23_HighSpeed_DroneHeat.css'
), 'utf8');
const { MESSAGES } = require(join(
  PROJECT_ROOT,
  'src/ui/Neon_Autopilot_V23_HighSpeed_DroneHeat.i18n.js'
));

function functionSource(functionName) {
  const start = runtime.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function: ${functionName}`);
  const bodyStart = runtime.indexOf('{', start);
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

test('desktop and touch film status stay inside existing edge controls', () => {
  assert.match(html, /id="cinematicBtn"[\s\S]*?id="cinematicBtnState"[\s\S]*?<\/button>/);
  const glance = html.match(/<button class="mobile-flight-glance"[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(glance, /id="mobileCinematicIndicator" hidden aria-hidden="true"/);
  assert.match(glance, /id="mobileCinematicStatusText">稳定构图<\/small>/);
  assert.doesNotMatch(glance, /mobileCinematicIndicator[^>]*data-flight-deck-control/);
  assert.doesNotMatch(html, /id="cinematicAnnouncement"|cinematic[^>]*(?:aria-live|role="status")/i);
  assert.match(css, /\.mobile-cinematic-indicator,[\s\S]*?\.mobile-cinematic-indicator\[hidden\]\s*\{\s*display:\s*none;/);
});

test('runtime projects shot names and only Reduced Motion as a neutral composition override', () => {
  const projection = functionSource('syncCinematicButtonPresentation');
  assert.match(projection, /state\.cameraCinematicShotId/);
  assert.match(projection, /state\.cameraCinematicCompositionOverride/);
  assert.match(projection, /state\.cameraCinematicCompositionReason/);
  assert.match(projection, /cinematic\.shot\.\$\{state\.cameraCinematicShotId\}/);
  assert.match(projection, /cinematic\.fallback\.\$\{fallbackReason\}/);
  assert.match(projection, /const detailText = compositionActive \? reasonText : shotText/);
  assert.match(projection, /cinematic\.buttonActiveAria', \{ detail: detailText \}/);
  assert.match(projection, /cinematicBtnState\.textContent = active \? detailText : stateText/);
  assert.match(projection, /mobileCinematicIndicator\.hidden = !active/);
  assert.match(projection, /mobileFlightHudEl\.dataset\.cinematicComposition = String\(compositionActive\)/);
  assert.doesNotMatch(projection, /Safety|safe tracking|cinematic\.hud\.safe/i);
  assert.doesNotMatch(projection, /aria-live|cinematic\.hud\.announcement/);
  assert.match(functionSource('updateHud'), /^function updateHud\(now\) \{\s*syncCinematicButtonPresentation\(\);/);
  assert.match(css, /\.mobile-cinematic-indicator\[data-composition="true"\]/);
  assert.doesNotMatch(css, /mobile-cinematic-indicator\[data-safety=/);
});

test('Chinese and English HUD catalogs name every authored lens distinctly', () => {
  const shotIds = [
    'stable',
    'lowRear',
    'roadSkim',
    'wide',
    'telephoto',
    'side',
    'oppositeSide',
    'rearClose',
    'crane',
    'high',
    'front',
    'flyby',
    'centerReveal',
    'noseMount',
    'tailMount',
    'wingMount',
    'tunnelWingMount',
    'tunnelEntrance',
    'tunnelCompression',
    'tunnelWallProfile',
    'tunnelAxialRush',
    'tunnelOppositeProfile',
    'tunnelExitReveal'
  ];
  for (const catalog of [MESSAGES['zh-CN'], MESSAGES.en]) {
    const labels = shotIds.map((shotId) => catalog[`cinematic.shot.${shotId}`]);
    assert.equal(labels.every((label) => typeof label === 'string' && label.length > 0), true);
    assert.equal(new Set(labels).size, shotIds.length, 'every lens needs a distinct HUD name');
  }
});

test('catalogs expose no gameplay-safety fallback vocabulary', () => {
  const removedReasons = [
    'covered-route',
    'damage-protection',
    'airborne-landing-visibility',
    'imminent-hazard',
    'high-speed-curve',
    'touch-conservative-framing',
    'safety-hold'
  ];
  for (const catalog of [MESSAGES['zh-CN'], MESSAGES.en]) {
    assert.ok(catalog['cinematic.hud.mode']);
    assert.match(catalog['cinematic.buttonActiveAria'], /\{detail\}/);
    assert.ok(catalog['cinematic.fallback.reduced-motion']);
    assert.ok(catalog['cinematic.fallback.unknown']);
    assert.equal(catalog['cinematic.hud.safe'], undefined);
    assert.equal(catalog['cinematic.shot.safe'], undefined);
    for (const reason of removedReasons) assert.equal(catalog[`cinematic.fallback.${reason}`], undefined);
  }
  assert.equal(MESSAGES['zh-CN']['cinematic.hud.mode'], '电影模式');
  assert.equal(MESSAGES.en['cinematic.hud.mode'], 'Film mode');
});

test('camera occlusion markers identify real HUD surfaces without reserving transparent viewport wrappers', () => {
  const markedIds = [
    'hudPrimary', 'hudNavigation', 'hudPrimaryBody', 'navigationBody', 'mobileTelemetryBtn',
    'mobileUtilityBtn', 'mobileUtilityDrawer', 'mobileNavigationBtn', 'mobileAutopilotCapsule',
    'keyTracker', 'desktopCompass', 'speedLimitAlert', 'mobileTransmissionSelector', 'controlDock', 'autoPanel',
    'leftBtn', 'rightBtn', 'jumpBtn', 'throttleBtn', 'brakeBtn'
  ];
  for (const id of markedIds) {
    const tag = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] || '';
    assert.match(tag, /\bdata-camera-hud-occluder\b/, `${id} is missing from the shared camera layout contract`);
  }
  for (const id of ['app', 'controls', 'mobileFlightHud']) {
    const tag = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] || '';
    assert.doesNotMatch(tag, /\bdata-camera-hud-occluder\b/, `${id} would reserve the entire transparent viewport`);
  }
  assert.match(html, /class="mobile-flight-actions"[^>]*data-camera-hud-occluder/);
  assert.match(html, /<section class="minimap-panel"[^>]*data-camera-hud-occluder/,
    'the fixed desktop map shell can overhang its narrower navigation anchor');
});

test('small desktop windows retain live gear controls while short landscape details leave a side-free corridor', () => {
  const keyboardSelector = 'html\\[data-mobile-cockpit="true"\\]\\[data-touch-capable="false"\\]';
  assert.match(css, new RegExp(`${keyboardSelector} \\.controls\\s*\\{[^}]*display: block !important;[^}]*pointer-events: none;`));
  assert.match(css, new RegExp(`${keyboardSelector} \\.controls > \\.touch-btn\\s*\\{\\s*display: none !important;`));
  assert.match(css, new RegExp(`${keyboardSelector} \\.mobile-transmission-selector\\s*\\{[^}]*right:[^}]*bottom: var\\(--mobile-control-bottom-offset\\);[^}]*left: auto;`));
  assert.match(css, /Small-window flight corridor[\s\S]*?\.navigation-body\s*\{[^}]*left: auto;[^}]*width: min\(300px, calc\(42vw/);
  const layout = readFileSync(join(
    PROJECT_ROOT, 'tests/browser/Neon_Autopilot_V23_HighSpeed_DroneHeat.hud-layout-test.html'
  ), 'utf8');
  for (const caseId of ['320x568', '390x844', '568x320', '700x390',
    '640x480-desktop', '800x450-desktop', '900x700-desktop', '768x1024', '1024x768', '1180x820']) {
    assert.ok(layout.includes(`id: '${caseId}'`), `missing real-CSS layout case ${caseId}`);
  }
  for (const state of ['folded-MT', 'folded-AT', 'map-MT', 'telemetry-MT', 'map-AT-Film', 'utilities']) {
    assert.ok(layout.includes(`id: '${state}'`), `missing responsive state ${state}`);
  }
  assert.match(layout, /\.getBoundingClientRect\(\)/);
  assert.match(layout, /target below 44px/);
  assert.match(layout, /gearbox unavailable/);
});

test('phone portrait details replace repeated summaries and reserve full score digits plus a usable flight band', () => {
  const portrait = css.slice(css.indexOf('Portrait detail shelf'), css.indexOf('Small-window flight corridor'));
  assert.match(html, /class="mobile-flight-value mobile-flight-score"[\s\S]*?id="mobileFlightScore"/);
  assert.match(portrait, /minmax\(58px, 1\.6fr\)/);
  assert.match(portrait, /\.mobile-flight-score strong\s*\{[^}]*overflow: visible;[^}]*text-overflow: clip;/);
  assert.match(portrait, /--mobile-portrait-detail-size: clamp\(100px, 16vh, 144px\)/);
  assert.match(portrait, /\[data-primary-expanded="true"\], \[data-navigation-expanded="true"\]/);
  assert.match(portrait, /max-height: var\(--mobile-portrait-detail-size\)/);
  assert.match(portrait, /\.mobile-route-cue\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(portrait, /:is\(\.mobile-route-copy, \.mobile-autopilot-capsule\)\s*\{\s*display: none;/);
  assert.match(portrait, /aspect-ratio: 16 \/ 9/);
  const layout = readFileSync(join(
    PROJECT_ROOT, 'tests/browser/Neon_Autopilot_V23_HighSpeed_DroneHeat.hud-layout-test.html'
  ), 'utf8');
  assert.match(layout, /textContent = '999,999'/);
  assert.match(layout, /score\.scrollWidth > score\.clientWidth/);
  assert.match(layout, /flightBottom - flightTop < 150/);
  assert.match(layout, /portrait flight band is occluded/);
});

test('compact numeric rows and scaled map previews preserve the flight budget across landscape and iPad', () => {
  const numeric = css.slice(css.indexOf('Compact numeric lanes'), css.indexOf('Tablet flight budget'));
  assert.match(numeric, /grid-template-columns: minmax\(0, 1fr\) minmax\(60px, 1fr\)/);
  assert.match(numeric, /grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(numeric, /padding: 20px 56px 3px 6px/);
  assert.match(numeric, /\.mobile-flight-value strong\s*\{[^}]*flex: 0 0 auto;[^}]*text-overflow: clip;/);
  assert.match(numeric, /\.mobile-cinematic-indicator:not\(\[hidden\]\)\s*\{[^}]*height: 14px;/);
  const tablet = css.slice(css.indexOf('Tablet flight budget'), css.indexOf('Small-window flight corridor'));
  assert.match(tablet, /--mobile-tablet-flight-reserve: max\(32vh, min\(332px, 42vh\)\)/);
  assert.match(tablet, /max-height: var\(--mobile-tablet-detail-budget\)/);
  assert.match(tablet, /var\(--mobile-live-control-clearance\) - var\(--mobile-tablet-flight-reserve\) - 12px/);
  assert.match(css, /The ultra-short details[\s\S]*?\.hud-primary-body,[\s\S]*?top: var\(--mobile-route-top\);[\s\S]*?max-height: var\(--mobile-route-block-size\);/);
  const layout = readFileSync(join(
    PROJECT_ROOT, 'tests/browser/Neon_Autopilot_V23_HighSpeed_DroneHeat.hud-layout-test.html'
  ), 'utf8');
  assert.match(layout, /map preview is cropped instead of scaled/);
  assert.match(layout, /map\.width \/ map\.height - 16 \/ 9/);
});
