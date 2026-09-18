#!/usr/bin/env node
/* Launch-deck structure and state hooks / 启航控制台结构与状态钩子合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Resolve authored contracts from the project root so invocation cwd never changes the evidence.
const PROJECT_ROOT = join(__dirname, '../..');
const html = readFileSync(join(PROJECT_ROOT, 'Neon_Autopilot_V23_HighSpeed_DroneHeat.html'), 'utf8');
const css = readFileSync(
  join(PROJECT_ROOT, 'styles/Neon_Autopilot_V23_HighSpeed_DroneHeat.css'),
  'utf8'
);
const runtime = readFileSync(
  join(PROJECT_ROOT, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'),
  'utf8'
);
const i18n = readFileSync(
  join(PROJECT_ROOT, 'src/ui/Neon_Autopilot_V23_HighSpeed_DroneHeat.i18n.js'),
  'utf8'
);

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function indexInOrder(source, markers) {
  let prior = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker);
    assert.ok(current > prior, `${marker} must follow the prior launch block`);
    prior = current;
  }
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing bounded source block ${startMarker}`);
  return source.slice(start, end);
}

/**
 * Extract one authored brace block without depending on the declaration that follows it.
 * This keeps the runtime contract executable while allowing adjacent documentation to evolve.
 */
function sourceBlock(source, startMarker, fromIndex = 0) {
  const start = source.indexOf(startMarker, fromIndex);
  const openingBrace = source.indexOf('{', start + startMarker.length);
  assert.ok(start >= 0 && openingBrace > start, `missing source block ${startMarker}`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] !== '}') continue;
    depth--;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated source block ${startMarker}`);
}

const launchStart = html.indexOf('<div class="overlay" id="overlay"');
const launchEnd = html.indexOf('<!-- Stable feature IDs', launchStart);
assert.ok(launchStart >= 0 && launchEnd > launchStart, 'missing bounded launch surface');
const launchMarkup = html.slice(launchStart, launchEnd);
const launchActionsMarkup = launchMarkup.match(/<div class="launch-actions">[\s\S]*?<\/div>/)?.[0] || '';
const launchUtilitiesMarkup = launchMarkup.match(/<div class="launch-utilities">[\s\S]*?<\/div>/)?.[0] || '';
const startupLoadingStart = html.indexOf('<section class="startup-loading" id="startupLoading"');
const startupLoadingEnd = html.indexOf('<div id="app"', startupLoadingStart);
assert.ok(
  startupLoadingStart >= 0 && startupLoadingEnd > startupLoadingStart,
  'missing bounded startup loading surface'
);
const startupLoadingMarkup = html.slice(startupLoadingStart, startupLoadingEnd);

test('launch surface is pre-mounted once but remains hidden and inert until runtime readiness', () => {
  assert.equal(count(html, /\bid="overlay"/g), 1);
  assert.equal(count(html, /data-testid="intro-card"/g), 1);
  assert.match(
    launchMarkup,
    /id="overlay"[^>]*data-overlay-mode="launch"[^>]*data-overlay-phase="ready"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="launchTitle"[^>]*aria-describedby="status"/
  );
  assert.match(
    launchMarkup,
    /id="overlay"[^>]*aria-hidden="true"[^>]*hidden[^>]*inert[^>]*style="display:none"/
  );
  assert.match(launchMarkup, /class="launch-stage" aria-hidden="true"/);
  assert.match(
    launchMarkup,
    /id="startBtn"[^>]*type="button"[^>]*disabled[^>]*aria-disabled="true"[^>]*aria-busy="true"/
  );
  assert.match(launchMarkup, /id="weatherModePicker"[^>]*disabled/);
  assert.match(launchMarkup, /id="qualityModeSelect"[^>]*disabled/);
  assert.match(launchMarkup, /id="guideBtn"[^>]*disabled/);
  for (const id of [
    'launchTitle',
    'status',
    'launchModeLabel',
    'launchStatusCode',
    'weatherModePicker',
    'qualityModePicker',
    'launchFullscreenBtn',
    'launchFullscreenBtnState',
    'startBtn',
    'pauseRestartBtn',
    'guideBtn'
  ]) {
    assert.equal(count(html, new RegExp(`\\bid="${id}"`, 'g')), 1, `${id} must stay unique`);
  }
});

test('startup loader is the sole initially exposed status and promises an immediately usable launch screen', () => {
  for (const id of [
    'startupLoading',
    'startupLoadingTitle',
    'startupLoadingStatus',
    'startupLoadingProgress',
    'startupLoadingNote',
    'startupLoadingTip',
    'startupLoadingTipLabel',
    'startupLoadingTipText'
  ]) {
    assert.equal(count(html, new RegExp(`\\bid="${id}"`, 'g')), 1, `${id} must stay unique`);
  }
  assert.ok(startupLoadingStart < launchStart, 'the loading surface must precede the hidden launch dialog');
  const loadingTag = startupLoadingMarkup.match(/^<section\b[^>]*>/)?.[0] || '';
  const statusTag = startupLoadingMarkup.match(
    /<[^>]+\bid="startupLoadingStatus"[^>]*>/
  )?.[0] || '';
  const tipTag = startupLoadingMarkup.match(
    /<[^>]+\bid="startupLoadingTip"[^>]*>/
  )?.[0] || '';
  assert.match(
    loadingTag,
    /\bdata-loading-stage="modules"/
  );
  assert.match(loadingTag, /\baria-busy="true"/);
  assert.match(loadingTag, /\baria-labelledby="startupLoadingTitle"/);
  assert.match(loadingTag, /\baria-describedby="startupLoadingNote"/);
  assert.doesNotMatch(loadingTag, /\brole=|\baria-live=|\baria-atomic=/);
  assert.doesNotMatch(loadingTag, /\b(?:hidden|inert)\b/);
  assert.match(statusTag, /\brole="status"/);
  assert.match(statusTag, /\baria-live="polite"/);
  assert.match(statusTag, /\baria-atomic="true"/);
  assert.match(statusTag, /\bdata-i18n="startup\.loading\.modules"/);
  assert.match(tipTag, /\brole="note"/);
  assert.match(tipTag, /\baria-live="off"/);
  assert.match(tipTag, /\bdata-tip-id="steering"/);
  assert.doesNotMatch(startupLoadingMarkup, /\btabindex=|contenteditable|<(?:a|button|input|select|textarea)\b/);
  assert.match(
    startupLoadingMarkup,
    /id="startupLoadingTip"[\s\S]*?id="startupLoadingTipLabel"[^>]*data-i18n="startup\.loading\.tipLabel"[\s\S]*?id="startupLoadingTipText"[^>]*data-i18n="startup\.loading\.tip\.steering"/
  );
  assert.match(
    startupLoadingMarkup,
    /id="startupLoadingProgress"[^>]*role="progressbar"[^>]*data-i18n-aria-label="startup\.loading\.progressAria"[^>]*aria-valuetext=/
  );
  const progressMarkup = startupLoadingMarkup.match(
    /class="startup-loading-progress"[\s\S]*?<\/div>/
  )?.[0] || '';
  assert.equal(count(progressMarkup, /<i><\/i>/g), 5);
  assert.match(startupLoadingMarkup, /data-i18n="startup\.loading\.note"/);
});

test('startup readiness uses five measured checkpoints and publishes usable launch controls atomically', () => {
  const stages = sourceBetween(
    runtime,
    'const startupLoadingStages = Object.freeze([',
    'let startupLoadingStageIndex = 0;'
  );
  const stageSetter = sourceBetween(
    runtime,
    'function setStartupLoadingStage(stageId)',
    'function resolveLaunchOverlayMode()'
  );
  const publishReady = sourceBetween(
    runtime,
    'function publishRuntimeReadyLaunchSurface()',
    '/**\n   * Complete startup only after both opening route tiles'
  );
  const finishStartup = sourceBetween(
    runtime,
    'async function finishRuntimeStartup()',
    '/** Poll only the lightweight tile-ready flag'
  );
  const waitForRoutes = sourceBetween(
    runtime,
    'function waitForInitialTrackNetwork()',
    "setStartupLoadingStage('routes');"
  );
  const launchDependencies = sourceBetween(
    runtime,
    'requireDependency(\n    startupLoadingEl',
    "'V23 launch overlay controls'"
  );

  assert.match(
    runtime,
    /const startupLoadingTipEl = document\.getElementById\('startupLoadingTip'\)/
  );
  assert.match(
    runtime,
    /const startupLoadingTipTextEl = document\.getElementById\('startupLoadingTipText'\)/
  );
  assert.match(launchDependencies, /&& startupLoadingTipEl/);
  assert.match(launchDependencies, /&& startupLoadingTipTextEl/);
  assert.deepEqual(
    [...stages.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]),
    ['modules', 'world', 'routes', 'graphics', 'first-frame', 'complete']
  );
  assert.deepEqual(
    [...stages.matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1]),
    [
      'startup.loading.modules',
      'startup.loading.world',
      'startup.loading.routes',
      'startup.loading.graphics',
      'startup.loading.firstFrame',
      'startup.loading.complete'
    ]
  );
  assert.deepEqual(
    [...stages.matchAll(/tipId:\s*'([^']+)'/g)].map((match) => match[1]),
    ['steering', 'view', 'ramps', 'candlelight', 'damage', 'weather']
  );
  assert.deepEqual(
    [...stages.matchAll(/tipKey:\s*'([^']+)'/g)].map((match) => match[1]),
    [
      'startup.loading.tip.steering',
      'startup.loading.tip.view',
      'startup.loading.tip.ramps',
      'startup.loading.tip.candlelight',
      'startup.loading.tip.damage',
      'startup.loading.tip.weather'
    ]
  );
  assert.match(stageSetter, /nextIndex < startupLoadingStageIndex \|\| nextIndex < 0/);
  assert.match(stageSetter, /startupLoadingEl\.dataset\.loadingStage = stage\.id/);
  assert.match(stageSetter, /startupLoadingStatusEl\.dataset\.i18n = stage\.key/);
  assert.match(stageSetter, /startupLoadingStatusEl\.textContent = text/);
  assert.match(stageSetter, /startupLoadingProgressEl\.setAttribute\('aria-valuetext', text\)/);
  assert.match(stageSetter, /startupLoadingTipEl\.dataset\.tipId = stage\.tipId/);
  assert.match(stageSetter, /startupLoadingTipTextEl\.dataset\.i18n = stage\.tipKey/);
  assert.match(
    stageSetter,
    /startupLoadingTipTextEl\.textContent = (?:tipText|uiText\(stage\.tipKey\))/
  );
  assert.doesNotMatch(stageSetter, /aria-valuenow|%|style\.width/);
  assert.doesNotMatch(
    `${stages}\n${stageSetter}`,
    /setTimeout|setInterval|requestAnimationFrame|Math\.random/
  );
  assert.doesNotMatch(stageSetter, /runtimeStartupReady\s*=|markRuntimeReady\(/);
  assert.doesNotMatch(
    stageSetter,
    /startupLoading(?:Status|Progress)El[\s\S]{0,100}?stage\.tipKey|startupLoadingTipTextEl[\s\S]{0,100}?stage\.key/
  );
  assert.equal(count(runtime, /startupLoadingTipEl\.dataset\.tipId\s*=/g), 1);
  assert.equal(count(runtime, /startupLoadingTipTextEl\.dataset\.i18n\s*=/g), 1);
  assert.equal(count(runtime, /startupLoadingTipTextEl\.textContent\s*=/g), 1);

  assert.match(waitForRoutes, /if \(!updateTrackNetworkVisuals\(performance\.now\(\)\)\)/);
  assert.ok(
    waitForRoutes.indexOf('updateTrackNetworkVisuals(performance.now())')
      < waitForRoutes.indexOf('finishRuntimeStartup()'),
    'Graphics preparation must not begin until the opening route reports ready'
  );
  assert.ok(
    finishStartup.indexOf("setStartupLoadingStage('graphics')")
      < finishStartup.indexOf('prepareInvulnerabilityShieldCompilation()')
  );
  assert.ok(
    finishStartup.indexOf('prepareInvulnerabilityShieldCompilation()')
      < finishStartup.indexOf('renderer.compileAsync(scene, camera)')
  );
  assert.ok(
    finishStartup.indexOf('renderer.compileAsync(scene, camera)')
      < finishStartup.indexOf('resetInvulnerabilityShieldPresentation();')
  );
  assert.ok(
    finishStartup.indexOf('resetInvulnerabilityShieldPresentation();')
      < finishStartup.indexOf("setStartupLoadingStage('first-frame')")
  );
  assert.ok(
    finishStartup.indexOf("setStartupLoadingStage('first-frame')")
      < finishStartup.indexOf('renderPresentationFrame()')
  );
  assert.ok(
    finishStartup.indexOf('renderPresentationFrame()')
      < finishStartup.indexOf('publishRuntimeReadyLaunchSurface()')
  );

  assert.match(publishReady, /startup\.markRuntimeReady\(\) !== true/);
  assert.ok(
    publishReady.indexOf('setLaunchCommitControlsLocked(false)')
      < publishReady.indexOf('startupLoadingEl.hidden = true'),
    'Start controls must be usable before the loading surface is removed'
  );
  assert.ok(
    publishReady.indexOf('setLaunchOverlayVisible(true)')
      < publishReady.indexOf('startupLoadingEl.hidden = true'),
    'The launch surface must be mounted before the loading surface is removed'
  );
  assert.ok(
    publishReady.indexOf("setStartupLoadingStage('complete')")
      < publishReady.indexOf("startupLoadingEl.setAttribute('aria-busy', 'false')")
  );
  assert.ok(
    publishReady.indexOf("startupLoadingEl.setAttribute('aria-busy', 'false')")
      < publishReady.indexOf('startupLoadingEl.hidden = true')
  );
  assert.ok(
    publishReady.indexOf('startupLoadingEl.hidden = true')
      < publishReady.indexOf('reconcileInteractionIsolation()')
  );
  assert.ok(
    publishReady.indexOf('reconcileInteractionIsolation()')
      < publishReady.indexOf('startBtn.focus')
  );
});

test('startup tips reserve stable responsive geometry without becoming another progress animation', () => {
  const tipStart = css.indexOf('.startup-loading-tip {');
  const tipRule = sourceBlock(css, '.startup-loading-tip {');
  const tipLabelRule = sourceBlock(css, '.startup-loading-tip-label {');
  const tipTextRule = sourceBlock(css, '.startup-loading-tip-text {');
  const compactPortrait = sourceBlock(css, '@media (max-width: 420px)', tipStart);
  const shortLandscape = sourceBlock(
    css,
    '@media (max-height: 560px) and (orientation: landscape)',
    tipStart
  );
  const reducedMotion = sourceBlock(
    css,
    '@media (prefers-reduced-motion: reduce)',
    tipStart
  );
  const forcedColors = sourceBlock(css, '@media (forced-colors: active)', tipStart);

  assert.match(tipRule, /\bmin-height:\s*\d*\.?\d+(?:px|rem|em);/);
  assert.doesNotMatch(
    `${tipRule}\n${tipLabelRule}\n${tipTextRule}`,
    /\banimation:|\btransition:/
  );
  for (const [label, mediaBlock] of [
    ['compact portrait', compactPortrait],
    ['short landscape', shortLandscape],
    ['reduced motion', reducedMotion],
    ['forced colors', forcedColors]
  ]) {
    assert.match(
      mediaBlock,
      /\.startup-loading-tip\s*(?:,|\{)/,
      `${label} must explicitly retain the loading tip`
    );
  }
  assert.match(forcedColors, /\b(?:color|border-color):\s*CanvasText;/);
  assert.match(forcedColors, /\b(?:color|background):\s*Highlight;/);
});

test('startup markup isolates every gameplay and launch interaction owner before runtime initialization', () => {
  assert.match(html, /<body\b[^>]*\bclass="startup-loading-open"[^>]*>/);
  for (const [element, attribute, value] of [
    ['div', 'id', 'app'],
    ['div', 'class', 'hud'],
    ['aside', 'class', 'key-tracker'],
    ['aside', 'class', 'desktop-compass'],
    ['div', 'class', 'speed-limit-alert'],
    ['div', 'class', 'controls'],
    ['div', 'class', 'hint']
  ]) {
    // Startup isolation depends on the boolean attribute, not its order relative to layout/diagnostic markers.
    const tag = html.match(new RegExp(`<${element}\\b(?=[^>]*\\s${attribute}="${value}")[^>]*>`))?.[0];
    assert.ok(tag, `missing startup interaction owner: ${value}`);
    assert.match(tag, /\sinert(?=\s|\/?>)/, `${value} must start inert`);
  }
  assert.match(launchMarkup, /\bhidden\b/);
  assert.match(launchMarkup, /\binert\b/);
});

test('launch information architecture keeps briefing, configuration, and actions in a stable order', () => {
  indexInOrder(launchMarkup, [
    'class="launch-stage"',
    'class="panel launch-card"',
    'class="launch-header"',
    'class="launch-grid"',
    'class="launch-briefing"',
    'class="launch-config"',
    'class="launch-actions"',
    'class="launch-footer"'
  ]);
  assert.match(launchMarkup, /id="launchTitle"[\s\S]*?id="status"/);
  assert.match(launchMarkup, /class="launch-config"[\s\S]*?id="weatherModePicker"[\s\S]*?id="qualityModePicker"/);
  assert.match(
    launchMarkup,
    /class="launch-actions"[\s\S]*?id="startBtn"[\s\S]*?id="pauseRestartBtn"[\s\S]*?id="guideBtn"/
  );
  assert.equal(count(launchMarkup, /class="launch-point"/g), 3);
  assert.deepEqual(
    [...launchMarkup.matchAll(/class="launch-point-index"[^>]*>(\d{2})</g)].map((match) => match[1]),
    ['01', '02', '03']
  );
  assert.match(launchMarkup, /V23[\s\S]*?SKY[\s\S]*?DAWNFLIGHT/i);
});

test('game-over debrief exposes measured facts, five dimensions, and one scroll owner', () => {
  indexInOrder(launchMarkup, [
    'class="launch-config"',
    'class="flight-debrief"',
    'class="launch-actions"'
  ]);
  assert.match(
    launchMarkup,
    /class="flight-debrief"[^>]*id="flightDebrief"[^>]*aria-labelledby="flightDebriefTitle"[^>]*hidden/
  );
  for (const id of [
    'flightDebrief',
    'flightDebriefTitle',
    'flightRatingGrade',
    'flightRatingScore',
    'flightRatingDistance',
    'flightRatingDuration',
    'flightRatingAverageSpeed',
    'flightRatingMaximumSpeed',
    'flightRatingTotalAirTime',
    'flightRatingLongestAirTime',
    'flightRatingCandles',
    'flightRatingDamage',
    'flightRatingRadar',
    'flightRatingRadarTitle',
    'flightRatingRadarNote',
    'flightRatingRadarDescription',
    'flightRatingRadarData',
    'flightRatingRadarArea',
    'flightRatingWeaknessTitle',
    'flightRatingWeaknessAdvice'
  ]) {
    assert.equal(count(html, new RegExp(`\\bid="${id}"`, 'g')), 1, `${id} must stay unique`);
  }
  assert.deepEqual(
    [...launchMarkup.matchAll(/data-rating-dimension="([^"]+)"/g)].map((match) => match[1]),
    ['safety', 'pace', 'endurance', 'collection', 'airborne']
  );
  assert.equal(count(launchMarkup, /class="flight-rating-meter"/g), 5);
  assert.match(
    launchMarkup,
    /class="flight-rating-analysis"[\s\S]*?id="flightRatingRadar"[\s\S]*?class="flight-rating-dimensions"/
  );
  const radarMarkup = sourceBetween(
    launchMarkup,
    '<figure class="flight-rating-radar"',
    '</figure>'
  );
  const radarFigureTag = radarMarkup.match(/^<figure\b[^>]*>/)?.[0] || '';
  const radarSvgTag = radarMarkup.match(/<svg\b[^>]*>/)?.[0] || '';
  const radarGridMarkup = sourceBetween(
    radarMarkup,
    '<g class="flight-rating-radar-grid">',
    '</g>'
  );
  const radarAxesMarkup = sourceBetween(
    radarMarkup,
    '<g class="flight-rating-radar-axes">',
    '</g>'
  );
  assert.match(radarFigureTag, /\bid="flightRatingRadar"/);
  assert.match(radarFigureTag, /\brole="img"/);
  assert.match(
    radarFigureTag,
    /\baria-labelledby="flightRatingRadarTitle flightRatingRadarDescription"/
  );
  assert.match(radarSvgTag, /\baria-hidden="true"/);
  assert.match(radarSvgTag, /\bfocusable="false"/);
  assert.equal(count(radarGridMarkup, /<polygon\b/g), 4);
  assert.equal(count(radarAxesMarkup, /<line\b/g), 5);
  for (const points of [...radarGridMarkup.matchAll(/\bpoints="([^"]+)"/g)].map((match) => match[1])) {
    assert.equal(
      points.trim().split(/\s+/).length,
      5,
      'every reference ring must remain a five-sided polygon'
    );
  }
  assert.deepEqual(
    [...radarMarkup.matchAll(/data-rating-radar-point="([^"]+)"/g)].map((match) => match[1]),
    ['safety', 'pace', 'endurance', 'collection', 'airborne']
  );
  assert.deepEqual(
    [...radarMarkup.matchAll(/data-rating-radar-score="([^"]+)"/g)].map((match) => match[1]),
    ['safety', 'pace', 'endurance', 'collection', 'airborne']
  );
  assert.deepEqual(
    [...radarMarkup.matchAll(/data-rating-radar-axis="([^"]+)"/g)].map((match) => match[1]),
    ['safety', 'pace', 'endurance', 'collection', 'airborne']
  );
  assert.deepEqual(
    [...radarMarkup.matchAll(/data-rating-radar-segment="([^"]+)"/g)].map((match) => match[1]),
    [
      'safety:pace',
      'pace:endurance',
      'endurance:collection',
      'collection:airborne',
      'airborne:safety'
    ]
  );
  assert.equal(count(radarMarkup, /\bdata-rating-radar-point=/g), 5);
  assert.equal(count(radarMarkup, /\bdata-rating-radar-score=/g), 5);
  assert.equal(count(radarMarkup, /\bdata-rating-radar-segment=/g), 5);
  assert.match(radarMarkup, /id="flightRatingRadarData"[^>]*data-complete="false"/);
  assert.match(radarMarkup, /id="flightRatingRadarArea"[^>]*points=""/);
  assert.match(radarMarkup, /data-i18n="rating\.radar\.title"/);
  assert.match(radarMarkup, /data-i18n="rating\.radar\.note"/);
  assert.match(
    radarMarkup,
    /id="flightRatingRadarDescription"[^>]*data-i18n-ignore/
  );
  assert.match(
    css,
    /#overlay\[data-overlay-mode="gameover"\] \.launch-config\s*\{\s*display:\s*none;/
  );
  assert.match(
    css,
    /#overlay\[data-overlay-mode="gameover"\] \.flight-debrief:not\(\[hidden\]\)\s*\{\s*display:\s*block;/
  );
  assert.match(
    css,
    /#overlay\[data-overlay-mode="gameover"\] \.launch-grid\s*\{[\s\S]*?overflow-y:\s*auto;/
  );
  assert.ok(
    launchMarkup.indexOf('id="flightDebrief"') < launchMarkup.indexOf('class="launch-actions"'),
    'the actions must remain outside the debrief scroll owner'
  );
  for (const key of [
    'rating.title',
    'rating.fact.totalAirTime',
    'rating.fact.longestAirTime',
    'rating.fact.damage',
    'rating.value.damageWithGuardrail',
    'rating.evidence.safety.offRoad',
    'rating.evidence.safety.noDamage',
    'rating.evidence.safety.damage',
    'rating.dimension.safety',
    'rating.dimension.pace',
    'rating.dimension.endurance',
    'rating.dimension.collection',
    'rating.dimension.airborne',
    'rating.radar.title',
    'rating.radar.note',
    'rating.radar.summary',
    'rating.radar.invalid',
    'rating.method'
  ]) {
    assert.equal(
      count(i18n, new RegExp(`'${key.replaceAll('.', '\\.')}'\\s*:`, 'g')),
      2,
      `${key} must be bilingual`
    );
  }
});

test('rating radar keeps a two-column evidence layout with narrow and forced-color fallbacks', () => {
  const analysis = sourceBlock(css, '.flight-rating-analysis {');
  const ratingSectionStart = css.indexOf('.flight-rating-analysis {');
  const narrow = sourceBlock(css, '@media (max-width: 559px)', ratingSectionStart);
  const shortLandscape = sourceBlock(
    css,
    '@media (min-width: 560px) and (max-height: 560px) and (orientation: landscape)',
    ratingSectionStart
  );
  const forcedColors = sourceBlock(css, '@media (forced-colors: active)', ratingSectionStart);

  assert.match(analysis, /\bdisplay:\s*grid;/);
  assert.match(
    analysis,
    /grid-template-columns:\s*(?:minmax|clamp)\([^;]+\)\s+minmax\(0,\s*[^)]+\);/
  );
  assert.match(
    narrow,
    /\.flight-rating-analysis\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/
  );
  assert.match(
    shortLandscape,
    /\.flight-rating-analysis\s*\{[\s\S]*?grid-template-columns:\s*(?:minmax|clamp)\([^;]+\)\s+minmax\(0,\s*[^)]+\);/
  );
  for (const [label, selectorPattern] of [
    ['area', /(?:#flightRatingRadarArea|\.flight-rating-radar-area)/],
    ['line', /(?:\[data-rating-radar-segment\]|\.flight-rating-radar-data\s*>\s*line)/],
    ['point', /(?:\[data-rating-radar-point\]|\.flight-rating-radar-data\s*>\s*circle)/]
  ]) {
    assert.match(
      forcedColors,
      selectorPattern,
      `radar ${label} must remain visible in forced colors`
    );
  }
  assert.match(forcedColors, /\bfill:\s*Highlight;/);
  assert.match(forcedColors, /\bstroke:\s*(?:Highlight|CanvasText);/);
});

test('launch decorations stay non-interactive while native run controls remain authoritative', () => {
  for (const className of [
    'launch-stage',
    'launch-corner launch-corner-nw',
    'launch-corner launch-corner-se',
    'launch-ready-dot',
    'launch-status-code',
    'launch-footer'
  ]) {
    assert.match(
      launchMarkup,
      new RegExp(`class="${className}"[^>]*aria-hidden="true"`),
      `${className} must be hidden from assistive technology`
    );
  }
  assert.equal(count(launchMarkup, /type="radio" name="weatherMode"/g), 3);
  assert.equal(count(launchMarkup, /<select\b[^>]*id="qualityModeSelect"/g), 1);
  assert.equal(count(launchActionsMarkup, /<button\b/g), 3);
  assert.match(
    launchMarkup,
    /id="pauseRestartBtn"[^>]*type="button"[^>]*aria-keyshortcuts="R"[^>]*aria-haspopup="dialog"[^>]*aria-controls="pauseRestartConfirmation"[^>]*aria-expanded="false"[^>]*hidden/
  );
  assert.doesNotMatch(launchMarkup, /\bon(?:click|keydown|pointerdown)=/);
});

test('fullscreen is a shared 44px launch utility without entering the run-action hierarchy', () => {
  assert.ok(launchUtilitiesMarkup, 'missing bounded launch utility group');
  assert.equal(count(launchMarkup, /class="launch-utilities"/g), 1);
  assert.equal(count(launchUtilitiesMarkup, /<button\b/g), 2);
  indexInOrder(launchUtilitiesMarkup, [
    'data-language-toggle data-language-compact',
    'id="launchFullscreenBtn"'
  ]);
  assert.match(
    launchUtilitiesMarkup,
    /class="launch-fullscreen-toggle"[^>]*id="launchFullscreenBtn"[^>]*type="button"[^>]*data-fullscreen-toggle[^>]*aria-pressed="false"[^>]*aria-label="进入全屏显示"[^>]*data-testid="launch-fullscreen-toggle"/
  );
  assert.match(
    launchUtilitiesMarkup,
    /<svg[^>]*viewBox="0 0 24 24"[^>]*focusable="false"[^>]*aria-hidden="true"[\s\S]*?<span class="sr-only" id="launchFullscreenBtnState" data-fullscreen-state>进入<\/span>/
  );
  assert.equal(count(html, /\bdata-fullscreen-toggle\b/g), 3);
  assert.equal(count(html, /\bdata-fullscreen-state\b/g), 3);
  assert.match(
    html,
    /id="fullscreenBtn"[^>]*type="button"[^>]*data-fullscreen-toggle[^>]*aria-pressed="false"/
  );
  assert.match(html, /id="fullscreenBtnState"[^>]*data-fullscreen-state>进入<\/b>/);
  assert.match(
    html,
    /id="mobileFullscreenBtn"[^>]*type="button"[^>]*data-flight-deck-control[^>]*data-fullscreen-toggle[^>]*aria-pressed="false"/
  );
  assert.match(html, /id="mobileFullscreenBtnState"[^>]*data-fullscreen-state[^>]*>进入<\/small>/);
  assert.doesNotMatch(launchActionsMarkup, /data-fullscreen-toggle|launchFullscreenBtn/);
  assert.ok(
    launchMarkup.indexOf('class="launch-utilities"')
      < launchMarkup.indexOf('class="launch-header"'),
    'launch utilities must remain outside and before launch content'
  );

  assert.match(
    css,
    /\.language-toggle,\s*\.launch-fullscreen-toggle\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
  );
  assert.match(
    css,
    /\.launch-utilities\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*12px;[\s\S]*?right:\s*12px;[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*row;[\s\S]*?gap:\s*4px;/
  );
  assert.match(
    css,
    /@media \(max-width:\s*720px\) and \(orientation:\s*portrait\)\s*\{[\s\S]*?\.launch-utilities\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?gap:\s*2px;/
  );
  assert.match(
    css,
    /@media \(max-height:\s*560px\) and \(orientation:\s*landscape\)\s*\{[\s\S]*?\.launch-utilities\s*\{[\s\S]*?flex-direction:\s*row;[\s\S]*?gap:\s*4px;[\s\S]*?\.launch-header\s*\{\s*padding-right:\s*96px;/
  );
  assert.match(
    css,
    /\.language-toggle:focus-visible,\s*\.launch-fullscreen-toggle:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--cyan\);/
  );
  assert.match(
    css,
    /\.launch-fullscreen-toggle:disabled\s*\{[\s\S]*?opacity:\s*0\.46;[\s\S]*?cursor:\s*not-allowed;/
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.language-toggle,\s*\.launch-fullscreen-toggle\s*\{[\s\S]*?transition:\s*none;[\s\S]*?transform:\s*none;/
  );
  assert.match(
    css,
    /@media \(forced-colors:\s*active\)\s*\{\s*\.language-toggle,\s*\.launch-fullscreen-toggle\s*\{[\s\S]*?forced-color-adjust:\s*auto;[\s\S]*?\.launch-fullscreen-toggle:disabled\s*\{[\s\S]*?color:\s*GrayText;/
  );
  for (const mode of ['launch', 'pause', 'gameover']) {
    assert.doesNotMatch(
      css,
      new RegExp(`#overlay\\[data-overlay-mode="${mode}"\\][^{]*\\.launch-utilities\\s*\\{[^}]*display:\\s*none`)
    );
  }
});

test('pause remains centred in phone portrait and short landscape while launch alone may dock', () => {
  const launchDeckStart = css.indexOf('Launch Deck V2 is intentionally isolated');
  assert.ok(launchDeckStart >= 0, 'missing bounded launch-deck stylesheet');
  const phonePortrait = sourceBlock(
    css,
    '@media (max-width: 720px) and (orientation: portrait)',
    launchDeckStart
  );
  assert.match(phonePortrait, /#overlay\s*\{[\s\S]*?justify-content:\s*center;/);
  assert.match(
    phonePortrait,
    /#overlay\[data-overlay-mode="launch"\]\s*\{\s*align-items:\s*flex-end;\s*\}/
  );
  assert.match(
    phonePortrait,
    /#overlay\[data-overlay-mode="pause"\],\s*#overlay\[data-overlay-mode="gameover"\]\s*\{\s*align-items:\s*center;\s*\}/
  );
  assert.match(
    phonePortrait,
    /max-height:\s*calc\(100dvh - var\(--safe-top\) - var\(--safe-bottom\) - 24px\);/
  );

  const shortLandscape = sourceBlock(
    css,
    '@media (max-height: 560px) and (orientation: landscape)',
    launchDeckStart
  );
  assert.match(
    shortLandscape,
    /#overlay\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/
  );
  assert.match(
    shortLandscape,
    /max-height:\s*calc\(100dvh - var\(--safe-top\) - var\(--safe-bottom\) - 20px\);/
  );
});

test('compact language controls stay on modal surfaces and never enter the live HUD', () => {
  const hudStart = html.indexOf('<div class="hud"');
  const hudEnd = html.indexOf('<!-- Speed guidance', hudStart);
  assert.ok(hudStart >= 0 && hudEnd > hudStart, 'missing bounded HUD surface');
  const hudMarkup = html.slice(hudStart, hudEnd);

  assert.equal(count(html, /\bdata-language-toggle\b/g), 6);
  assert.equal(count(html, /\bdata-language-compact\b/g), 6);
  assert.doesNotMatch(hudMarkup, /data-language-toggle/);
  assert.doesNotMatch(html, /language-toggle-hud/);
  for (const surface of [
    'class="panel launch-card"',
    'class="guide-shell"',
    'class="music-library-shell"',
    'class="pause-restart-confirmation-card"',
    'class="update-notice-card"',
    'class="startup-error-card"'
  ]) {
    const start = html.indexOf(surface);
    assert.ok(start >= 0, `missing ${surface}`);
    assert.match(html.slice(start, start + 2_400), /data-language-toggle data-language-compact/);
  }
  assert.match(
    css,
    /\.language-toggle,\s*\.launch-fullscreen-toggle\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
  );
  assert.match(
    css,
    /\.language-toggle::before,\s*\.launch-fullscreen-toggle::before\s*\{[\s\S]*?inset:\s*8px 5px;/
  );
  assert.match(css, /font:\s*820 9px\/1/);
});

test('pause restart confirmation is a labelled sibling alertdialog with a safe default action', () => {
  assert.match(
    html,
    /class="pause-restart-confirmation"[^>]*id="pauseRestartConfirmation"[^>]*role="alertdialog"[^>]*aria-modal="true"[^>]*aria-labelledby="pauseRestartConfirmationTitle"[^>]*aria-describedby="pauseRestartConfirmationDescription"[^>]*aria-hidden="true"[^>]*hidden/
  );
  for (const id of [
    'pauseRestartConfirmation',
    'pauseRestartConfirmationTitle',
    'pauseRestartConfirmationDescription',
    'pauseRestartCancelBtn',
    'pauseRestartConfirmBtn'
  ]) {
    assert.equal(count(html, new RegExp(`\\bid="${id}"`, 'g')), 1, `${id} must stay unique`);
  }
  assert.match(
    html,
    /id="pauseRestartConfirmation"[\s\S]*?id="pauseRestartCancelBtn"[\s\S]*?id="pauseRestartConfirmBtn"/
  );
  assert.match(html, /id="pauseRestartConfirmationTitle"[^>]*data-i18n="launch\.restartConfirm\.title"/);
  assert.match(
    html,
    /id="pauseRestartConfirmationDescription"[^>]*data-i18n="launch\.restartConfirm\.description"/
  );
  for (const key of [
    'launch.action.pauseRestart',
    'launch.restartConfirm.eyebrow',
    'launch.restartConfirm.title',
    'launch.restartConfirm.description',
    'launch.restartConfirm.cancel',
    'launch.restartConfirm.confirm',
    'guide.feature.pauseRestart.title',
    'guide.feature.pauseRestart.body'
  ]) {
    assert.equal(count(i18n, new RegExp(`'${key.replaceAll('.', '\\.')}'\\s*:`, 'g')), 2, `${key} must be bilingual`);
  }
});

test('launch CSS and runtime expose desktop, compact, reduced-motion, and atomic phase contracts', () => {
  for (const selector of [
    '.startup-loading',
    '.startup-loading-card',
    '.startup-loading-progress',
    '.launch-stage',
    '.launch-card',
    '.launch-header',
    '.launch-grid',
    '.launch-briefing',
    '.launch-config',
    '.launch-actions',
    '.launch-restart',
    '.launch-footer'
  ]) {
    assert.match(css, new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`), `missing ${selector} rule`);
  }
  assert.match(css, /min-height:\s*100vh;[\s\S]*?min-height:\s*100dvh;/);
  assert.match(css, /@media\s*\(min-width:\s*1280px\)/);
  assert.match(css, /@media\s*\(min-width:\s*900px\)\s*and\s*\(max-width:\s*1279px\)/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)\s*and\s*\(orientation:\s*portrait\)/);
  assert.match(css, /@media\s*\(max-height:\s*560px\)\s*and\s*\(orientation:\s*landscape\)/);
  assert.match(css, /\.startup-loading\[hidden\],[\s\S]*?\.overlay\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important;/);
  assert.match(css, /body\.startup-loading-open > \.hud,[\s\S]*?pointer-events:\s*none\s*!important;/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)[\s\S]*?\.startup-loading-card/);
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.startup-loading-orbit i,[\s\S]*?animation:\s*none\s*!important;/
  );
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.launch-card/);
  assert.match(
    css,
    /#overlay \.launch-stage\s*\{\s*transition:\s*none\s*!important;\s*\}/,
    'reduced motion must retain the desktop stage centering transform'
  );
  assert.doesNotMatch(
    css,
    /#overlay \.launch-stage\s*,[\s\S]{0,220}?transform:\s*none\s*!important;/,
    'reduced motion must not remove the desktop stage centering transform'
  );

  assert.match(runtime, /function setStartupLoadingStage\(stageId\)/);
  assert.match(runtime, /function publishRuntimeReadyLaunchSurface\(\)/);
  assert.match(runtime, /function syncLaunchOverlayPresentation\(\)/);
  assert.match(runtime, /function beginLaunchCommit\(/);
  assert.match(runtime, /function completeLaunchCommitAfterSuccessfulFrame\(/);
  assert.match(runtime, /function abortLaunchCommit\(/);
  assert.match(runtime, /overlay\.dataset\.overlayMode/);
  assert.match(runtime, /overlay\.dataset\.overlayPhase/);
});

test('launch busy state, mode copy, and interruption paths preserve the single-frame commit boundary', () => {
  const lockControls = sourceBetween(
    runtime,
    'function setLaunchCommitControlsLocked(locked)',
    '/** Acquire the one launch token'
  );
  const presentation = sourceBetween(
    runtime,
    'function syncLaunchOverlayPresentation()',
    '/**\n   * Recompute isolation'
  );
  const settle = sourceBetween(
    runtime,
    'function completeLaunchCommitAfterSuccessfulFrame()',
    'function isUsableFocusTarget'
  );
  const fatalStop = sourceBetween(runtime, 'function stopForFatalError(', '/** Wrap WebGL failures');
  const endGame = sourceBetween(runtime, 'function endGame()', 'function jump(');
  const pause = sourceBetween(runtime, 'function setPaused(force)', 'function resetFrameDiagnosticsWindow()');
  const visibility = sourceBetween(
    runtime,
    "document.addEventListener('visibilitychange'",
    'let presentationResourcesDisposed'
  );

  assert.match(lockControls, /const controlsLocked = Boolean\(locked \|\| !runtimeStartupReady\)/);
  assert.match(lockControls, /startBtn\.disabled = controlsLocked/);
  assert.match(lockControls, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(lockControls, /removeAttribute\('aria-busy'\)/);
  assert.match(lockControls, /pauseRestartBtn\.disabled = controlsLocked/);
  assert.match(lockControls, /guideBtn\.disabled = controlsLocked/);
  assert.match(lockControls, /weatherModePicker\.disabled = true/);
  assert.match(lockControls, /qualityModeSelect\.disabled = true/);
  assert.match(presentation, /uiText\('launch\.mode\.launch'\)/);
  assert.match(presentation, /uiText\('launch\.mode\.pause'\)/);
  assert.match(presentation, /uiText\('launch\.mode\.gameover'\)/);
  assert.match(presentation, /uiText\('launch\.action\.again'\)/);
  assert.match(presentation, /pauseRestartBtn\.hidden = mode !== 'pause'/);
  assert.ok(settle.indexOf('fatalRuntimeLocked || !state.running || state.gameOver || state.paused')
    < settle.indexOf('setLaunchOverlayVisible(false)'));
  assert.match(fatalStop, /abortLaunchCommit\(reason\)/);
  assert.ok(endGame.indexOf("abortLaunchCommit('game-over')")
    < endGame.indexOf('setLaunchOverlayVisible(true)'));
  assert.ok(pause.indexOf("abortLaunchCommit('pause')")
    < pause.indexOf('setLaunchOverlayVisible(true)'));
  assert.match(visibility, /if \(shouldPause\) setPaused\(true\)/);
});

test('game-over rating seals run-wide airtime and redraws the frozen snapshot on language changes', () => {
  const presentation = sourceBetween(
    runtime,
    'function syncLaunchOverlayPresentation()',
    '/**\n   * Recompute isolation'
  );
  const flightResolution = sourceBetween(
    runtime,
    'function recordResolvedFlight(',
    '/** A platform miss'
  );
  const crash = sourceBetween(
    runtime,
    'function crashFromOffRoadLanding(',
    '/**\n   * Apply one core sweep'
  );
  const vertical = sourceBetween(
    runtime,
    'function applySweptVerticalResult(',
    '/** Integrates the vertical rigid-body state'
  );
  const render = sourceBetween(
    runtime,
    'function renderFlightDebrief(',
    '/**\n   * Include an unfinished in-air interval'
  );
  const safetyEvidence = sourceBetween(
    runtime,
    'function flightRatingEvidenceText(',
    'function resolveFlightRatingRadarPoint('
  );
  const snapshot = sourceBetween(
    runtime,
    'function createFlightRatingSnapshot()',
    'function endGame()'
  );
  const endGame = sourceBetween(runtime, 'function endGame()', 'function jump(');
  const reset = sourceBetween(
    runtime,
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  const localized = sourceBetween(
    runtime,
    'function syncLocalizedRuntimePresentation()',
    'applyViewButtonText();'
  );

  assert.match(flightResolution, /state\.totalAirTimeSeconds \+= resolvedAirTime/);
  assert.match(flightResolution, /state\.longestAirTimeSeconds = Math\.max/);
  assert.match(flightResolution, /state\.successfulPlatformAirTimeSeconds \+= resolvedAirTime/);
  assert.ok(
    crash.indexOf('recordResolvedFlight(landingAirTime, false, true)')
      < crash.indexOf("state.lastCrashReason = 'off-road-landing'")
  );
  assert.match(vertical, /recordResolvedFlight\(landingAirTime, true, state\.jumpPlatformFlightActive\)/);
  assert.match(snapshot, /state\.totalAirTimeSeconds \+ unresolvedAirTime/);
  assert.match(snapshot, /state\.platformAirTimeSeconds \+ unresolvedPlatformAirTime/);
  assert.match(snapshot, /gameplayCore\.resolveFlightRating\(/);
  assert.doesNotMatch(render, /resolveFlightRating\(/);
  assert.ok(
    endGame.indexOf('state.flightRatingSnapshot = createFlightRatingSnapshot()')
      < endGame.indexOf("abortLaunchCommit('game-over')")
  );
  assert.match(presentation, /renderFlightDebrief\(state\.flightRatingSnapshot\)/);
  assert.match(localized, /syncLaunchOverlayPresentation\(\)/);
  for (const field of [
    'maximumSpeedMps',
    'platformLandingCount',
    'totalAirTimeSeconds',
    'successfulAirTimeSeconds',
    'platformAirTimeSeconds',
    'successfulPlatformAirTimeSeconds',
    'longestAirTimeSeconds',
    'damageCount',
    'guardrailDamageCount',
    'flightRatingSnapshot'
  ]) {
    assert.match(reset, new RegExp(`state\\.${field} = `), `${field} must reset for a new run`);
  }
  assert.match(snapshot, /guardrailDamageCount:\s*state\.guardrailDamageCount/);
  assert.match(safetyEvidence, /metrics\.obstacleDamageCount/);
  assert.match(safetyEvidence, /metrics\.guardrailDamageCount/);
  assert.match(safetyEvidence, /metrics\.damageFreeSegmentKm/);
  assert.match(render, /metrics\.guardrailDamageCount/);
  assert.match(render, /rating\.value\.damageWithGuardrail/);
  assert.match(runtime, /airborneLandingQueryOptionsScratch\.pathPlan = state\.pathPlan/);
  assert.match(runtime, /state\.maximumSpeedMps = Math\.max\(state\.maximumSpeedMps, state\.speed\)/);
});

test('rating radar distinguishes missing evidence from zero and never recomputes the sealed report', () => {
  const pointResolver = sourceBlock(runtime, 'function resolveFlightRatingRadarPoint(');
  const radarRenderer = sourceBlock(
    runtime,
    'function renderFlightRatingRadar(report, dimensionById)'
  );
  const debriefRenderer = sourceBlock(runtime, 'function renderFlightDebrief(report)');
  const launchDependencies = sourceBetween(
    runtime,
    'requireDependency(\n    startupLoadingEl',
    "'V23 launch overlay controls'"
  );

  for (const elementName of [
    'flightRatingRadarEl',
    'flightRatingRadarNoteEl',
    'flightRatingRadarDescriptionEl',
    'flightRatingRadarDataEl',
    'flightRatingRadarAreaEl'
  ]) {
    assert.match(
      launchDependencies,
      new RegExp(`&& ${elementName}\\b`),
      `${elementName} must fail startup when the authored radar is incomplete`
    );
  }
  assert.match(
    launchDependencies,
    /flightRatingDimensionIds\.every\(\(dimensionId\) => \([\s\S]*?flightRatingRadarPointElements\[dimensionId\][\s\S]*?flightRatingRadarScoreElements\[dimensionId\]/
  );
  assert.match(
    launchDependencies,
    /flightRatingRadarSegmentElements\.every\(\((?:segment|\{\s*line\s*\})\) => Boolean\((?:segment\.)?line\)\)/
  );

  const unsafeCalls = /\bstate\b|gameplayCore\.resolveFlightRating\(|createFlightRatingSnapshot\(/;
  assert.doesNotMatch(pointResolver, unsafeCalls);
  assert.doesNotMatch(radarRenderer, unsafeCalls);
  const resolvePoint = Function(
    `"use strict";\n${pointResolver}\nreturn resolveFlightRatingRadarPoint;`
  )();
  const zeroPoints = Array.from({ length: 5 }, (_, axisIndex) => (
    resolvePoint(0, axisIndex)
  ));
  for (const point of zeroPoints) {
    assert.deepEqual(
      point,
      { valid: true, x: 110, y: 102 },
      'a measured zero must remain a valid center point'
    );
  }
  for (const [score, axisIndex] of [
    [null, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [-1, 0],
    [101, 0],
    [50, -1],
    [50, 5],
    [50, 1.5]
  ]) {
    assert.equal(
      resolvePoint(score, axisIndex).valid,
      false,
      `${String(score)} on axis ${axisIndex} must not become a drawable zero`
    );
  }
  for (let axisIndex = 0; axisIndex < 5; axisIndex++) {
    const endpoint = resolvePoint(100, axisIndex);
    assert.equal(endpoint.valid, true);
    assert.ok(
      Math.hypot(endpoint.x - 110, endpoint.y - 102) > 65.9,
      `axis ${axisIndex} must project a full score away from the center`
    );
  }

  const dimensionIds = ['safety', 'pace', 'endurance', 'collection', 'airborne'];
  const segmentIds = [
    ['safety', 'pace'],
    ['pace', 'endurance'],
    ['endurance', 'collection'],
    ['collection', 'airborne'],
    ['airborne', 'safety']
  ];
  const createFakeElement = () => ({
    dataset: {},
    attributes: new Map(),
    textContent: '',
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'data-grade') delete this.dataset.grade;
    }
  });
  const createRadarHarness = () => {
    const radar = createFakeElement();
    const note = createFakeElement();
    const description = createFakeElement();
    const data = createFakeElement();
    const area = createFakeElement();
    const points = Object.fromEntries(dimensionIds.map((id) => [id, createFakeElement()]));
    const scores = Object.fromEntries(dimensionIds.map((id) => [id, createFakeElement()]));
    const segments = segmentIds.map(([fromId, toId]) => ({
      fromId,
      toId,
      line: createFakeElement()
    }));
    const render = Function(
      'flightRatingDimensionIds',
      'flightRatingRadarEl',
      'flightRatingRadarNoteEl',
      'flightRatingRadarDescriptionEl',
      'flightRatingRadarDataEl',
      'flightRatingRadarAreaEl',
      'flightRatingRadarPointElements',
      'flightRatingRadarScoreElements',
      'flightRatingRadarSegmentElements',
      'uiText',
      'uiNumber',
      `"use strict";\n${pointResolver}\n${radarRenderer}\nreturn renderFlightRatingRadar;`
    )(
      Object.freeze([...dimensionIds]),
      radar,
      note,
      description,
      data,
      area,
      points,
      scores,
      segments,
      (key) => ({
        'rating.radar.invalid': 'INVALID',
        'rating.radar.note': 'NOTE',
        'rating.dimension.noSample': 'NO SAMPLE',
        'rating.radar.summary': 'SUMMARY'
      })[key] || key,
      (value) => String(value)
    );
    return { radar, note, description, data, area, points, scores, segments, render };
  };
  const gradeForScore = (score) => (
    score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D'
  );
  const createReport = (scoreById) => {
    const dimensions = Object.freeze(dimensionIds.map((id) => {
      const score = scoreById[id];
      return Object.freeze(score === null
        ? { id, available: false, score: null, grade: null }
        : { id, available: true, score, grade: gradeForScore(score) });
    }));
    const report = Object.freeze({ dimensions });
    return {
      report,
      dimensionById: Object.fromEntries(dimensions.map((dimension) => [dimension.id, dimension]))
    };
  };

  const partialHarness = createRadarHarness();
  const partial = createReport({
    safety: 75,
    pace: 82,
    endurance: 64,
    collection: null,
    airborne: 91
  });
  assert.equal(partialHarness.render(partial.report, partial.dimensionById), true);
  assert.equal(partialHarness.radar.dataset.radarState, 'partial');
  assert.equal(partialHarness.data.dataset.complete, 'false');
  assert.equal(partialHarness.area.attributes.get('points'), '');
  assert.equal(partialHarness.points.collection.dataset.available, 'false');
  assert.equal(partialHarness.scores.collection.textContent, 'NO SAMPLE');
  assert.deepEqual(
    partialHarness.segments.map(({ line }) => line.dataset.visible),
    ['true', 'true', 'false', 'false', 'true'],
    'only edges adjacent to measured endpoints may remain visible'
  );

  const zeroHarness = createRadarHarness();
  const measuredZero = createReport({
    safety: 75,
    pace: 82,
    endurance: 64,
    collection: 0,
    airborne: 91
  });
  assert.equal(zeroHarness.render(measuredZero.report, measuredZero.dimensionById), true);
  assert.equal(zeroHarness.radar.dataset.radarState, 'complete');
  assert.equal(zeroHarness.data.dataset.complete, 'true');
  assert.equal(zeroHarness.area.attributes.get('points').trim().split(/\s+/).length, 5);
  assert.equal(zeroHarness.points.collection.dataset.available, 'true');
  assert.equal(zeroHarness.points.collection.attributes.get('cx'), '110');
  assert.equal(zeroHarness.points.collection.attributes.get('cy'), '102');
  assert.equal(zeroHarness.scores.collection.textContent, '0');
  assert.ok(zeroHarness.segments.every(({ line }) => line.dataset.visible === 'true'));

  const invalidHarness = createRadarHarness();
  const malformed = createReport({
    safety: 75,
    pace: 82,
    endurance: 64.5,
    collection: 50,
    airborne: 91
  });
  assert.equal(invalidHarness.render(malformed.report, malformed.dimensionById), false);
  assert.equal(invalidHarness.radar.dataset.radarState, 'invalid');
  assert.equal(invalidHarness.area.attributes.get('points'), '');
  assert.equal(invalidHarness.note.textContent, 'INVALID');
  assert.equal(invalidHarness.description.textContent, 'INVALID');
  assert.ok(invalidHarness.segments.every(({ line }) => line.dataset.visible === 'false'));

  assert.match(radarRenderer, /flightRatingDimensionIds\.map\(/);
  assert.match(
    radarRenderer,
    /dimension\?\.available(?:\s*===\s*true)?\s*\?\s*dimension\.score\s*:\s*null/
  );
  assert.doesNotMatch(radarRenderer, /dimension\.score\s*(?:\?\?|\|\|)\s*0/);
  assert.match(
    radarRenderer,
    /resolveFlightRatingRadarPoint\(\s*score,\s*(?:axisIndex|index)\s*\)/
  );
  assert.match(
    radarRenderer,
    /(?:radarPoints|resolvedDimensions)\.every\(\((?:\{\s*point\s*\}|point)\) => point\.valid\)/
  );
  assert.match(radarRenderer, /flightRatingRadarDataEl\.dataset\.complete\s*=\s*String\(/);
  assert.match(
    radarRenderer,
    /flightRatingRadarAreaEl\.setAttribute\(\s*'points',[\s\S]*?\?[\s\S]*?:\s*''\s*\)/
  );
  assert.match(radarRenderer, /fromPoint\.valid\s*&&\s*toPoint\.valid/);
  assert.match(radarRenderer, /\bline\.dataset\.visible\s*=\s*String\(/);
  assert.match(radarRenderer, /\.dataset\.available\s*=\s*String\(point\.valid\)/);
  assert.match(radarRenderer, /uiText\('rating\.radar\.summary'/);
  assert.match(radarRenderer, /uiText\('rating\.radar\.invalid'\)/);
  assert.match(
    debriefRenderer,
    /const dimensionById = Object\.fromEntries\([\s\S]*?renderFlightRatingRadar\(report, dimensionById\)/
  );
});

test('pause restart opens one confirmation and only its confirm action may enter the new-run commit', () => {
  const action = sourceBetween(
    runtime,
    "pauseRestartBtn.addEventListener('click'",
    "pauseRestartCancelBtn.addEventListener('click'"
  );
  const open = sourceBetween(
    runtime,
    'function openPauseRestartConfirmation()',
    '/** Close without touching paused gameplay'
  );
  const close = sourceBetween(
    runtime,
    'function closePauseRestartConfirmation(',
    '/** Keep every key inside the destructive confirmation'
  );
  const confirmationKeydown = sourceBetween(
    runtime,
    'function handlePauseRestartConfirmationKeydown(event)',
    '/** The confirm button is the only paused-surface path'
  );
  const confirm = sourceBetween(
    runtime,
    'function confirmPauseRestart()',
    'function selectGuideTab('
  );
  const keydown = sourceBetween(
    runtime,
    "window.addEventListener('keydown'",
    "window.addEventListener('keyup'"
  );

  assert.match(action, /fatalRuntimeLocked \|\| pendingLaunchCommit/);
  assert.match(action, /!state\.running \|\| !state\.paused \|\| state\.gameOver/);
  assert.match(action, /openPauseRestartConfirmation\(\)/);
  assert.doesNotMatch(action, /resetGame\(\)/);
  assert.doesNotMatch(action, /setPaused/);
  assert.match(open, /startup\.isUpdateNoticeActive\(\)/);
  assert.match(open, /pauseRestartConfirmationReturnFocus = document\.activeElement/);
  assert.match(open, /pauseRestartCancelBtn\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(open, /resetGame|beginLaunchCommit|state\.[a-zA-Z]+\s*=/);
  assert.match(close, /pauseRestartConfirmation\.hidden = true/);
  assert.match(close, /restoreAuxiliaryModalFocus/);
  assert.doesNotMatch(close, /resetGame|setPaused|beginLaunchCommit/);
  assert.match(confirmationKeydown, /event\.stopPropagation\(\)/);
  assert.match(confirmationKeydown, /event\.code === 'Escape'/);
  assert.match(confirmationKeydown, /event\.code !== 'Tab'/);
  assert.match(confirm, /closePauseRestartConfirmation\(false\)[\s\S]*?const started = resetGame\(\)/);
  assert.match(confirm, /pendingLaunchCommit\.shouldFocusCanvas = true/);
  assert.doesNotMatch(confirm, /setPaused/);
  assert.match(
    keydown,
    /e\.code === 'KeyR'[\s\S]*?state\.gameOver[\s\S]*?resetGame\(\)[\s\S]*?e\.code === 'KeyR'[\s\S]*?state\.running && state\.paused[\s\S]*?openPauseRestartConfirmation\(\)/
  );
  assert.ok(keydown.indexOf('if (isPauseRestartConfirmationOpen())')
    < keydown.indexOf('if (isGuideOpen())'));
  assert.match(css, /#overlay\[data-overlay-mode="pause"\] \.launch-actions\s*\{[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.pause-restart-confirmation\s*\{[\s\S]*?z-index:\s*12;/);
  assert.match(css, /\.pause-restart-confirmation-actions button\s*\{[\s\S]*?min-height:\s*48px;/);
});

test('launch keyboard loop keeps one native radio stop and leaves arrow navigation authoritative', () => {
  const tabStops = sourceBetween(
    runtime,
    'function launchTabStops()',
    '/** The launch dialog remains'
  );
  const keydown = sourceBetween(
    runtime,
    'function handleLaunchOverlayKeydown(event)',
    '/** Restore the opener'
  );

  assert.match(tabStops, /const selectedRadios = new Map\(\)/);
  assert.match(tabStops, /node\.type !== 'radio'/);
  assert.match(tabStops, /!current \|\| node\.checked/);
  assert.match(tabStops, /selectedRadios\.get\(node\.name\) === node/);
  assert.ok(keydown.indexOf("if (event.code !== 'Tab') return")
    < keydown.indexOf('const focusable = launchTabStops()'));
  assert.match(keydown, /event\.shiftKey && document\.activeElement === first/);
  assert.match(keydown, /!event\.shiftKey && document\.activeElement === last/);
});
