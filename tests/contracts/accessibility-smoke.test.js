#!/usr/bin/env node
/* Static accessibility contracts that complement real-browser reflow checks / 补充真实浏览器回流检查的静态无障碍合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Resolve authored UI contracts from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = join(__dirname, '../..');
const css = readFileSync(
  join(PROJECT_ROOT, 'styles/Neon_Autopilot_V23_HighSpeed_DroneHeat.css'),
  'utf8'
);
const html = readFileSync(join(PROJECT_ROOT, 'Neon_Autopilot_V23_HighSpeed_DroneHeat.html'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}

// Collect every responsive/state override so a later breakpoint cannot silently reintroduce an obstructive guide.
function ruleBodies(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))]
    .map((match) => match[1]);
}

function numericPropertyValues(selector, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ruleBodies(selector).flatMap((body) => (
    [...body.matchAll(new RegExp(`${escapedProperty}:\\s*([\\d.]+)`, 'g'))]
      .map((match) => Number(match[1]))
  ));
}

function styleRulesContaining(selectorFragment) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => rule.selector.includes(selectorFragment));
}

/** Match one complete simple selector token without treating `.hud-primary` as the `.hud` root. */
function selectorContainsToken(selector, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s>+~])${escaped}(?![-_a-zA-Z0-9])`).test(selector);
}

function rgbaFromRule(selector) {
  const match = ruleBody(selector).match(/color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(match, `${selector} must publish an explicit rgba text color`);
  return match.slice(1).map(Number);
}

function composite([red, green, blue, alpha], background) {
  return [red, green, blue].map((channel, index) => channel * alpha + background[index] * (1 - alpha));
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const brighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (brighter + 0.05) / (darker + 0.05);
}

function elementMarkup(tagName, id, source = html) {
  const match = source.match(new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/${tagName}>`));
  assert.ok(match, `missing ${tagName}#${id}`);
  return match[0];
}

/** Extract complete CSS at-rule bodies so nested selector braces cannot truncate reduced-motion audits. */
function atRuleBodies(marker) {
  const bodies = [];
  let searchFrom = 0;
  while (searchFrom < css.length) {
    const markerAt = css.indexOf(marker, searchFrom);
    if (markerAt < 0) break;
    const bodyStart = css.indexOf('{', markerAt + marker.length);
    assert.notEqual(bodyStart, -1, `missing body for ${marker}`);
    let depth = 0;
    let bodyEnd = -1;
    for (let index = bodyStart; index < css.length; index++) {
      if (css[index] === '{') depth++;
      else if (css[index] === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = index;
          break;
        }
      }
    }
    assert.notEqual(bodyEnd, -1, `unterminated body for ${marker}`);
    bodies.push(css.slice(bodyStart + 1, bodyEnd));
    searchFrom = bodyEnd + 1;
  }
  return bodies;
}

test('guide auxiliary text clears normal-text contrast and size contracts', () => {
  const shellBackground = [15, 20, 28];
  const statBackground = composite([255, 255, 255, 0.035], shellBackground);
  const cases = [
    ['.guide-stat-grid small', statBackground],
    ['.guide-footer p', shellBackground],
    ['.guide-world-grid p', statBackground],
    ['.guide-feature-list p', statBackground],
    ['.guide-shortcuts', shellBackground]
  ];
  for (const [selector, background] of cases) {
    const body = ruleBody(selector);
    const fontSize = Number(body.match(/font-size:\s*(\d+)px/)?.[1]);
    const foreground = composite(rgbaFromRule(selector), background);
    assert.ok(fontSize >= 11, `${selector} must stay at least 11px`);
    assert.ok(contrastRatio(foreground, background) >= 4.5, `${selector} must clear 4.5:1 contrast`);
  }
  for (const selector of [
    '.guide-eyebrow',
    '.guide-header p:last-of-type',
    '.guide-section-heading p',
    '.guide-feature-list p',
    '.guide-callout',
    '.guide-rules li'
  ]) {
    const declarations = [...css.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`, 'g'))];
    const lastFontSize = Number(declarations.at(-1)?.[1].match(/font-size:\s*(\d+)px/)?.[1]);
    assert.ok(lastFontSize >= 10, `${selector} must not collapse below 10px in short landscape`);
  }
});

test('guide and driving controls retain focus, live-region, and accessible-name hooks', () => {
  const guideShell = ruleBody('.guide-shell');
  assert.match(css, /\.guide-panel:focus-visible\s*\{/);
  assert.match(guideShell, /touch-action:\s*pan-x pan-y pinch-zoom;/);
  assert.match(guideShell, /user-select:\s*text;/);
  assert.match(html, /id="guideBtn"[^>]*aria-expanded="false"/);
  assert.match(html, /id="guideOverlay"[^>]*data-guide-contract-version="18"[^>]*data-guide-view="essential"/);
  assert.deepEqual(
    [...html.matchAll(/<button class="guide-tab"[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]),
    ['操作', '导航', '目标与规则', '天气与世界']
  );
  assert.match(html, /class="guide-tabs" role="tablist"[^>]*aria-orientation="vertical"/);
  assert.match(html, /class="guide-header-meta" aria-hidden="true"/);
  assert.doesNotMatch(html, /class="guide-footer-sync"/);
  assert.match(html, /id="guideContext"[^>]*aria-label="当前航程与阅读范围"[^>]*data-i18n-aria-label="guide\.context\.aria"/);
  assert.match(html, /id="guideContextCompact"[^>]*data-i18n-ignore/);
  assert.match(html, /class="guide-view-switch" role="group"[^>]*data-i18n-aria-label="guide\.view\.aria"/);
  assert.match(html, /id="guideEssentialViewBtn"[^>]*aria-pressed="true"/);
  assert.match(html, /id="guideAllViewBtn"[^>]*aria-pressed="false"/);
  assert.match(html, /class="guide-chapter-nav" role="group"[^>]*data-i18n-aria-label="guide\.footer\.navigationAria"/);
  assert.match(html, /id="guidePreviousChapterBtn"[^>]*type="button"/);
  assert.match(html, /id="guideNextChapterBtn"[^>]*type="button"/);
  assert.match(html, /id="guideCloseBtn"[^>]*aria-label="关闭玩法详情并返回上一界面"/);
  assert.match(html, /id="guideBackBtn"[\s\S]*?返回上一界面<\/button>/);
  assert.match(css, /\.guide-overlay \[data-guide-feature\]\[hidden\]\s*\{\s*display:\s*none !important;/);
  for (const selector of ['.guide-view-option', '.guide-chapter-step', '.guide-back']) {
    assert.match(ruleBody(selector), /min-height:\s*44px;/, `${selector} must remain a 44px target`);
  }
  assert.match(css, /\.guide-view-option:focus-visible,[\s\S]*?\.guide-chapter-step:focus-visible,[\s\S]*?\.guide-back:focus-visible/);
  assert.match(
    css,
    /@media \(forced-colors: active\)[\s\S]*?\.guide-tab\[aria-selected="true"\],[\s\S]*?\.guide-view-option\[aria-pressed="true"\][\s\S]*?border:\s*2px solid Highlight;/
  );
  assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="leftBtn"[^>]*aria-label="按住向左移动"/);
  assert.match(html, /id="jumpBtn"[^>]*aria-label="起飞"/);
  assert.match(html, /id="rightBtn"[^>]*aria-label="按住向右移动"/);
  assert.match(html, /class="weather-forecast"[^>]*aria-labelledby="weatherForecastTitle"/);
  assert.match(html, /id="weatherAnnouncement"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="weatherCurrentIcon"[^>]*aria-hidden="true"/);
  assert.match(css, /\.weather-forecast\s*\{[\s\S]*?pointer-events:\s*none;/);
});

test('live flight surfaces suppress native selection and long-press UI without disabling guide reading', () => {
  const suppressedProperties = [
    /(?:^|[;\n])\s*-webkit-user-select:\s*none\s*;/,
    /(?:^|[;\n])\s*user-select:\s*none\s*;/,
    /(?:^|[;\n])\s*-webkit-touch-callout:\s*none\s*;/
  ];
  const suppressionTargets = [
    { label: '.hud', tokens: ['.hud'] },
    { label: '#controls', tokens: ['#controls'] },
    { label: '[data-flight-deck-control]', tokens: ['[data-flight-deck-control]'] }
  ];
  assert.match(html, /class="controls" id="controls"/);
  for (const { label, tokens } of suppressionTargets) {
    const suppressionRule = tokens.flatMap(styleRulesContaining).find((rule) => (
      tokens.some((token) => selectorContainsToken(rule.selector, token))
      && suppressedProperties.every((pattern) => pattern.test(rule.body))
    ));
    assert.ok(
      suppressionRule,
      `${label} must suppress text selection and the native long-press callout during live flight`
    );
  }

  for (const selector of ['.guide-shell', '.guide-panel']) {
    const body = ruleBody(selector);
    assert.match(body, /user-select:\s*text;/, `${selector} must keep readable text selectable`);
    assert.match(
      body,
      /touch-action:\s*pan-x pan-y pinch-zoom;/,
      `${selector} must retain scrolling and pinch zoom`
    );
    assert.doesNotMatch(
      body,
      /-webkit-touch-callout:\s*none;/,
      `${selector} must not inherit the live-flight long-press suppression contract`
    );
  }
});

test('live flight-deck controls leave keyboard focus to driving while modal controls remain native', () => {
  const flightDeckControlIds = [
    'audioBtn',
    'musicLibraryBtn',
    'hudPrimaryDisclosure',
    'autoPilotBtn',
    'speedModeBtn',
    'gearDownBtn',
    'gearUpBtn',
    'transmissionModeBtn',
    'viewBtn',
    'cinematicBtn',
    'pauseBtn',
    'lightingBtn',
    'fullscreenBtn',
    'navigationDisclosure',
    'mobileTelemetryBtn',
    'mobileUtilityBtn',
    'mobileAudioBtn',
    'mobileMusicBtn',
    'mobileLightingBtn',
    'mobileCinematicBtn',
    'mobileFullscreenBtn',
    'mobileAutoPilotBtn',
    'mobileSpeedModeBtn',
    'mobileGearDownBtn',
    'mobileGearUpBtn',
    'mobileTransmissionModeBtn',
    'mobileViewBtn',
    'mobilePauseBtn',
    'mobileNavigationBtn',
    'leftBtn',
    'jumpBtn',
    'rightBtn',
    'throttleBtn',
    'brakeBtn'
  ];
  assert.equal((html.match(/\bdata-flight-deck-control\b/g) || []).length, flightDeckControlIds.length);
  for (const id of flightDeckControlIds) {
    const openingTag = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] || '';
    assert.ok(openingTag, `missing live flight-deck button ${id}`);
    assert.match(openingTag, /\btype="button"/);
    assert.match(openingTag, /\bdata-flight-deck-control\b/);
    assert.match(openingTag, /\btabindex="-1"/);
    if (id === 'gearDownBtn' || id === 'mobileGearDownBtn') {
      assert.match(openingTag, /\bdisabled\b/, 'Gear 1 must expose an unavailable initial downshift');
    } else {
      assert.doesNotMatch(openingTag, /\bdisabled\b|\baria-hidden="true"/);
    }
  }
  for (const id of [
    'launchFullscreenBtn',
    'startBtn',
    'pauseRestartBtn',
    'guideBtn',
    'guideCloseBtn',
    'musicLibraryCloseBtn',
    'musicPreviousBtn',
    'pauseRestartCancelBtn',
    'updateContinueBtn',
    'startupRetryBtn'
  ]) {
    const openingTag = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] || '';
    assert.ok(openingTag, `missing modal or recovery button ${id}`);
    assert.doesNotMatch(openingTag, /\bdata-flight-deck-control\b|\btabindex="-1"/);
  }
});

test('flight-deck HUD exposes seven structured controls with explicit state hooks', () => {
  // Bound the action deck by its stable adjacent component instead of presentation-only comments owned by the minimap.
  const groupStart = html.indexOf('<div class="hud-actions"');
  const minimapStart = html.indexOf('<section class="minimap-panel"', groupStart);
  assert.ok(groupStart >= 0 && minimapStart > groupStart, 'missing structured HUD action group');
  const groupMarkup = html.slice(groupStart, minimapStart);
  assert.match(
    groupMarkup,
    /^<div class="hud-actions" id="controlDock" role="group" aria-label="飞行快捷操作" data-i18n-aria-label="hud\.mobile\.controlDockAria"[^>]*>/
  );
  const expectedControls = [
    ['autoPilotBtn', 'autoPilotBtnState'],
    ['speedModeBtn', 'speedModeBtnState'],
    ['viewBtn', 'viewBtnState'],
    ['cinematicBtn', 'cinematicBtnState'],
    ['pauseBtn', 'pauseBtnState'],
    ['lightingBtn', 'lightingBtnState'],
    ['fullscreenBtn', 'fullscreenBtnState']
  ];
  assert.deepEqual(
    [...groupMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]),
    expectedControls.map(([buttonId]) => buttonId)
  );
  assert.doesNotMatch(groupMarkup, /hud-view-cluster/);
  assert.match(
    groupMarkup,
    /id="viewBtn"[\s\S]*?<\/button>\s*<button class="hud-toggle hud-cinematic-toggle" id="cinematicBtn"/,
    'View and Film must be direct adjacent grid targets rather than a height-growing nested stack'
  );
  for (const [buttonId, stateId] of expectedControls) {
    const markup = elementMarkup('button', buttonId, groupMarkup);
    assert.match(markup, /type="button"/);
    assert.match(markup, /class="hud-toggle-symbol" aria-hidden="true">[\s\S]*?<svg viewBox="0 0 24 24">/);
    assert.match(markup, /class="hud-toggle-copy"/);
    assert.match(markup, /class="hud-toggle-label"/);
    assert.match(markup, /class="hud-toggle-meta"/);
    assert.match(markup, new RegExp(`id="${stateId}"`));
  }
  const autopilotButtonMarkup = elementMarkup('button', 'autoPilotBtn', groupMarkup);
  assert.match(
    autopilotButtonMarkup,
    /aria-pressed="false"[^>]*aria-controls="autoPanel"[^>]*aria-keyshortcuts="P"/
  );
  assert.doesNotMatch(autopilotButtonMarkup, /\baria-expanded=/);
  assert.match(elementMarkup('button', 'speedModeBtn', groupMarkup), /aria-pressed="false"[^>]*aria-keyshortcuts="M"[^>]*aria-label="满油门保持已关闭；P 关闭时由 W 控制油门，点击开启"[^>]*data-automatic-throttle-enabled="false"[^>]*data-automatic-throttle-preference-enabled="false"[^>]*data-longitudinal-authority="player"/);
  assert.match(elementMarkup('button', 'viewBtn', groupMarkup), /aria-label="当前追尾视角，按 C 切换视角"[^>]*aria-keyshortcuts="C"/);
  assert.match(elementMarkup('button', 'cinematicBtn', groupMarkup), /aria-pressed="false"[^>]*aria-keyshortcuts="F"[^>]*aria-label="电影模式已关闭，点击开启"/);
  assert.match(elementMarkup('button', 'mobileCinematicBtn'), /aria-pressed="false"[^>]*aria-label="电影模式已关闭，点击开启"/);
  assert.match(elementMarkup('button', 'pauseBtn', groupMarkup), /aria-pressed="false"[^>]*aria-keyshortcuts="O"[^>]*aria-label="游戏运行中，点击暂停"/);
  assert.match(elementMarkup('button', 'lightingBtn', groupMarkup), /aria-pressed="true"[^>]*aria-label="真实光影已开启，点击关闭"[^>]*data-lighting-enabled="true"/);
  assert.match(elementMarkup('button', 'fullscreenBtn', groupMarkup), /aria-pressed="false"[^>]*aria-label="进入全屏显示"[^>]*data-testid="fullscreen-toggle"/);
  assert.match(
    ruleBodies('.hud-actions').at(-1),
    /grid-template-columns:\s*repeat\(4,\s*minmax\(44px,\s*1fr\)\);/,
    'the final cascade authority must retain four columns for the seven direct controls'
  );
  assert.match(ruleBody('.hud-actions #pauseBtn'), /grid-column:\s*span 2;/);
  const standardDesktopActionFit = atRuleBodies(
    '@media (min-width: 921px) and (min-height: 1080px)'
  ).at(-1);
  assert.match(
    standardDesktopActionFit,
    /html:not\(\[data-mobile-cockpit="true"\]\):not\(\[data-cinematic-camera="on"\]\)[\s\S]*?\.hud-actions \.hud-toggle\s*\{[\s\S]*?grid-template-columns:\s*22px minmax\(0,\s*1fr\);[\s\S]*?gap:\s*4px;[\s\S]*?padding-inline:\s*4px;/,
    'standard desktop must reserve complete copy width inside each four-column command target'
  );
  assert.match(
    standardDesktopActionFit,
    /\.hud-actions \.hud-toggle-meta b\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;/
  );
  assert.match(
    standardDesktopActionFit,
    /\.hud-actions \.hud-toggle-meta kbd\s*\{[\s\S]*?flex:\s*0 0 auto;/
  );
  const laptopHeightCommandRail = atRuleBodies(
    '@media (min-width: 921px) and (min-height: 561px) and (max-height: 1079px) and (orientation: landscape)'
  ).find((body) => /\.hud-navigation \.auto-panel/.test(body));
  assert.match(
    laptopHeightCommandRail,
    /\.hud-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hud-navigation \.auto-panel\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*auto;/,
    'laptop-height desktop must keep the complete command and Autopilot rails inside the compact tactical column'
  );
  assert.match(ruleBody('.hud-toggle'), /display:\s*grid;/);
  assert.match(ruleBody('.hud-toggle'), /grid-template-columns:\s*28px minmax\(0,\s*1fr\);/);
  assert.match(css, /\.hud-toggle-symbol\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(css, /\.hud-toggle-copy\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(css, /\.hud-toggle-meta\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(
    ruleBody('html[data-mobile-cockpit="true"] .hud-actions .hud-toggle-meta'),
    /display:\s*flex;/,
    'Mobile controls must retain their visible short state text'
  );
  assert.match(
    ruleBody('html[data-mobile-cockpit="true"] .hud-actions .hud-toggle-meta kbd'),
    /display:\s*none;/,
    'Mobile controls may hide only the redundant keycap'
  );
});

test('mobile cockpit owns a purpose-built glance deck with explicit optional drawers', () => {
  const disclosureContracts = [
    ['hudPrimaryDisclosure', 'hudPrimaryBody'],
    ['navigationDisclosure', 'navigationBody']
  ];
  for (const [buttonId, controlledIds] of disclosureContracts) {
    const markup = elementMarkup('button', buttonId);
    assert.match(markup, /\btype="button"/);
    assert.match(markup, new RegExp(`\\baria-controls="${controlledIds}"`));
    assert.match(markup, /\baria-expanded="false"/);
    assert.match(markup, /\baria-label="[^"]+"/);
  }

  for (const [regionId, bodyId] of [
    ['hudPrimary', 'hudPrimaryBody'],
    ['hudNavigation', 'navigationBody']
  ]) {
    const regionTag = html.match(new RegExp(`<div\\b[^>]*\\bid="${regionId}"[^>]*>`))?.[0] || '';
    const bodyTag = html.match(new RegExp(`<div\\b[^>]*\\bid="${bodyId}"[^>]*>`))?.[0] || '';
    assert.match(regionTag, /\bdata-mobile-expanded="false"/);
    assert.match(regionTag, /\brole="region"/);
    assert.doesNotMatch(
      bodyTag,
      /\s(?:hidden|inert)(?:\s|>)/,
      `${bodyId} must remain statically visible until runtime applies the mobile presentation`
    );
  }

  const mobileDeckTag = html.match(/<section\b[^>]*\bid="mobileFlightHud"[^>]*>/)?.[0] || '';
  assert.match(mobileDeckTag, /\brole="region"/);
  assert.match(mobileDeckTag, /\baria-label="手机飞行仪表"/);
  assert.match(mobileDeckTag, /\bhidden\b/);
  assert.match(mobileDeckTag, /\binert\b/);
  assert.match(mobileDeckTag, /\baria-hidden="true"/);

  const mobileDeckMarkup = elementMarkup('section', 'mobileFlightHud');
  assert.deepEqual(
    [...mobileDeckMarkup.matchAll(/<strong id="(mobileFlight(?:Speed|Score|Candlelight|Lives))"/g)]
      .map((match) => match[1]),
    ['mobileFlightSpeed', 'mobileFlightScore', 'mobileFlightCandlelight', 'mobileFlightLives']
  );
  for (const [buttonId, controlsId] of [
    ['mobileTelemetryBtn', 'hudPrimaryBody'],
    ['mobileUtilityBtn', 'mobileUtilityDrawer'],
    ['mobileAutoPilotBtn', 'mobileAutopilotCapsule'],
    ['mobileNavigationBtn', 'navigationBody']
  ]) {
    const markup = elementMarkup('button', buttonId, mobileDeckMarkup);
    assert.match(markup, new RegExp(`\\baria-controls="${controlsId}"`));
    assert.match(markup, /\bdata-flight-deck-control\b/);
    assert.match(markup, /\btabindex="-1"/);
  }

  for (const id of ['mobileUtilityDrawer', 'mobileAutopilotCapsule']) {
    const openingTag = mobileDeckMarkup.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || '';
    assert.match(openingTag, /\bhidden\b/, `${id} must reserve no inactive layout`);
    assert.match(openingTag, /\binert\b/, `${id} must leave the interaction tree while inactive`);
    assert.match(openingTag, /\baria-hidden="true"/, `${id} must leave the accessibility tree while inactive`);
  }
  const mobileUtilityMarkup = elementMarkup('div', 'mobileUtilityDrawer', mobileDeckMarkup);
  assert.deepEqual(
    [...mobileUtilityMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]),
    [
      'mobileAudioBtn',
      'mobileMusicBtn',
      'mobileLightingBtn',
      'mobileCinematicBtn',
      'mobileFullscreenBtn'
    ]
  );

  const glanceMarkup = elementMarkup('div', 'mobileGlanceStrip');
  assert.match(
    glanceMarkup,
    /^<div class="mobile-glance-strip" id="mobileGlanceStrip" role="group" aria-label="关键飞行信息" data-i18n-aria-label="hud\.mobile\.glanceAria">/
  );
  assert.deepEqual(
    [...glanceMarkup.matchAll(/<strong id="([^"]+)"/g)].map((match) => match[1]),
    ['mobileGlanceSpeed', 'mobileGlanceScore', 'mobileGlanceCandlelight', 'mobileGlanceLives']
  );
  assert.match(
    glanceMarkup,
    /id="mobileGlanceCandlelightMetric" data-handling-level="base"/
  );
  assert.match(
    glanceMarkup,
    /id="mobileGlanceLifeMetric" data-life-state="healthy"/
  );
  assert.match(
    html,
    /id="controls"[^>]*role="group"[^>]*aria-label="触控驾驶"[^>]*data-i18n-aria-label="hud\.mobile\.touchControlsAria"/
  );
});

test('mobile flight deck keeps safe-area targets and distinct phone, landscape, and iPad geometry', () => {
  const rootTokens = ruleBody(':root');
  for (const [token, edge] of [
    ['--safe-top', 'top'],
    ['--safe-right', 'right'],
    ['--safe-bottom', 'bottom'],
    ['--safe-left', 'left']
  ]) {
    assert.match(rootTokens, new RegExp(`${token}:\\s*env\\(safe-area-inset-${edge},\\s*0px\\);`));
  }

  const mobileRoot = ruleBodies('html[data-mobile-cockpit="true"]')
    .find((body) => /--mobile-vh:\s*100vh;/.test(body));
  assert.ok(mobileRoot, 'missing dynamic-viewport mobile root');
  assert.match(mobileRoot, /--mobile-vh:\s*100vh;/);
  assert.match(mobileRoot, /--mobile-detail-max-height:[\s\S]*?var\(--mobile-vh\)[\s\S]*?var\(--safe-top\)[\s\S]*?var\(--safe-bottom\)/);
  assert.match(
    css,
    /@supports \(height:\s*100dvh\)\s*\{\s*html\[data-mobile-cockpit="true"\]\s*\{\s*--mobile-vh:\s*100dvh;/
  );
  const flightDeckStart = css.indexOf('Mobile Flight Deck V2 is a separate glance-and-command surface');
  const flightDeckEnd = css.indexOf('Mobile cockpit v2 / 移动驾驶舱 v2', flightDeckStart);
  assert.ok(flightDeckStart >= 0 && flightDeckEnd > flightDeckStart, 'missing bounded mobile flight deck');
  const flightDeckCss = css.slice(flightDeckStart, flightDeckEnd);
  assert.match(flightDeckCss, /\.mobile-flight-hud,\s*\.mobile-flight-hud\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(
    flightDeckCss,
    /html\[data-mobile-cockpit="true"\] \.mobile-flight-hud:not\(\[hidden\]\)\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*12;/
  );
  const flightHead = ruleBody('html[data-mobile-cockpit="true"] .mobile-flight-head');
  for (const edge of ['top', 'right', 'left']) {
    assert.match(flightHead, new RegExp(`var\\(--safe-${edge}\\)`));
  }
  for (const selector of [
    'html[data-mobile-cockpit="true"] .mobile-utility-toggle',
    'html[data-mobile-cockpit="true"] .mobile-utility-action',
    'html[data-mobile-cockpit="true"] .mobile-flight-action'
  ]) {
    const target = ruleBody(selector);
    assert.match(target, /min-width:\s*44px;/);
    assert.match(target, /min-height:\s*44px;/);
  }
  const finalPhoneUtilityDrawer = ruleBodies(
    'html[data-mobile-cockpit="true"] .mobile-flight-hud .mobile-utility-drawer'
  )[0] || '';
  assert.match(finalPhoneUtilityDrawer, /grid-template-columns:\s*repeat\(5,\s*44px\);/);
  assert.match(finalPhoneUtilityDrawer, /width:\s*258px;/);
  assert.match(
    ruleBody('html[data-mobile-cockpit="true"] .mobile-route-cue'),
    /height:\s*50px;/
  );
  const routeCopyLeaves = [
    ruleBody('html[data-mobile-cockpit="true"] .mobile-route-copy small'),
    styleRulesContaining('.mobile-route-copy strong')
      .find((rule) => rule.selector.includes('.mobile-route-copy em'))?.body || ''
  ];
  for (const routeCopy of routeCopyLeaves) {
    assert.match(routeCopy, /overflow:\s*hidden;/);
    assert.match(routeCopy, /text-overflow:\s*ellipsis;/);
    assert.match(routeCopy, /white-space:\s*nowrap;/);
  }
  assert.match(
    ruleBody('html[data-mobile-cockpit="true"] .mobile-autopilot-capsule[hidden]'),
    /display:\s*none;/
  );
  assert.match(
    flightDeckCss,
    /html\[data-mobile-cockpit="true"\] :is\([\s\S]*?\.hud-navigation \.auto-panel[\s\S]*?\)\s*\{\s*display:\s*none !important;/
  );
  assert.match(
    flightDeckCss,
    /html\[data-mobile-cockpit="true"\] \.speed-limit-alert\s*\{\s*display:\s*none !important;/
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\]\[data-touch-capable="false"\] \.controls\s*\{[\s\S]*?display:\s*block !important;[\s\S]*?pointer-events:\s*none;/
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\]\[data-touch-capable="false"\] \.controls > \.touch-btn\s*\{\s*display:\s*none !important;/
  );
  const touchTarget = ruleBody('html[data-mobile-cockpit="true"] .touch-btn');
  assert.match(touchTarget, /min-width:\s*44px;/);
  assert.match(touchTarget, /min-height:\s*44px;/);

  const mobileStart = css.indexOf('Mobile cockpit v2 / 移动驾驶舱 v2');
  assert.ok(mobileStart >= 0, 'missing bounded mobile cockpit stylesheet');
  const mobileCss = css.slice(mobileStart);
  const phoneLandscapeStart = mobileCss.indexOf('@media (orientation: landscape)');
  const ipadPortraitStart = mobileCss.indexOf('@media (min-width: 700px) and (min-height: 700px)');
  const ipadLandscapeStart = mobileCss.indexOf(
    '@media (min-width: 700px) and (min-height: 700px) and (orientation: landscape)'
  );
  assert.ok(phoneLandscapeStart >= 0, 'missing phone landscape breakpoint');
  assert.ok(ipadPortraitStart > phoneLandscapeStart, 'missing iPad portrait/tablet breakpoint');
  assert.ok(ipadLandscapeStart > ipadPortraitStart, 'missing iPad landscape override');

  const phoneLandscape = mobileCss.slice(phoneLandscapeStart, ipadPortraitStart);
  assert.match(phoneLandscape, /--mobile-primary-shell-width:\s*clamp\(190px,\s*24vw,\s*230px\);/);
  const ipadPortrait = mobileCss.slice(ipadPortraitStart, ipadLandscapeStart);
  assert.match(ipadPortrait, /--mobile-primary-shell-width:\s*clamp\(270px,\s*34vw,\s*310px\);/);
  assert.match(ipadPortrait, /--mobile-control-size:\s*clamp\(80px,\s*10vmin,\s*88px\);/);
  const ipadLandscape = mobileCss.slice(ipadLandscapeStart);
  assert.match(ipadLandscape, /--mobile-primary-shell-width:\s*clamp\(270px,\s*25vw,\s*300px\);/);
  assert.match(ipadLandscape, /--mobile-navigation-shell-width:\s*clamp\(310px,\s*29vw,\s*350px\);/);

  const flightDeckLandscape = atRuleBodies(
    '@media (max-height: 699px) and (orientation: landscape)'
  ).find((body) => body.includes('.mobile-flight-hud:not([hidden])'));
  assert.ok(flightDeckLandscape, 'missing dedicated phone landscape flight-deck layout');
  const mobileControlLandscape = atRuleBodies(
    '@media (max-height: 699px) and (orientation: landscape)'
  ).findLast((body) => body.includes('--mobile-control-size'));
  assert.ok(mobileControlLandscape, 'missing final phone landscape driving-control contract');
  assert.match(
    mobileControlLandscape,
    /--mobile-control-size:\s*clamp\(52px,\s*13vh,\s*60px\);/
  );
  assert.match(
    flightDeckLandscape,
    /\.mobile-flight-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*44px\);[\s\S]*?grid-template-rows:\s*44px;/
  );
  const narrowLandscapeUtilities = mobileControlLandscape;
  assert.ok(narrowLandscapeUtilities, 'missing narrow-landscape utility matrix');
  assert.match(
    narrowLandscapeUtilities,
    /\.mobile-flight-hud \.mobile-utility-drawer\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*44px\);[\s\S]*?width:\s*144px;/
  );
  assert.match(
    flightDeckLandscape,
    /\.mobile-route-cue\s*\{[\s\S]*?min-width:\s*160px;[\s\S]*?min-height:\s*44px;/
  );
  const ultraShortLandscape = atRuleBodies(
    '@media (min-width: 520px) and (max-width: 699px) and (max-height: 379px) and (orientation: landscape)'
  ).find((body) => body.includes('--mobile-extreme-left-bay'));
  assert.ok(ultraShortLandscape, 'missing ultra-short landscape split-bay authority');
  assert.match(ultraShortLandscape, /--mobile-control-size:\s*44px;/);
  assert.match(ultraShortLandscape, /--mobile-extreme-left-bay:\s*clamp\(236px,\s*44vw,\s*280px\);/);
  assert.match(
    ultraShortLandscape,
    /:is\(#leftBtn, #rightBtn, #jumpBtn, #throttleBtn, #brakeBtn\)[\s\S]*?bottom:\s*var\(--mobile-control-bottom-offset\);/
  );
  assert.match(
    ultraShortLandscape,
    /\.mobile-transmission-selector\s*\{[\s\S]*?var\(--mobile-extreme-left-bay\)[\s\S]*?grid-template-rows:\s*44px 20px 18px;[\s\S]*?width:\s*auto;/
  );

  const ipadFlightDeck = atRuleBodies('@media (min-width: 700px) and (min-height: 700px)')
    .findLast((body) => body.includes('--mobile-flight-action-size:'));
  assert.ok(ipadFlightDeck, 'missing final iPad flight-deck authority');
  assert.match(ipadFlightDeck, /--mobile-control-size:\s*clamp\(80px,\s*10vmin,\s*88px\);/);
  assert.match(ipadFlightDeck, /--mobile-flight-action-size:\s*clamp\(56px,\s*7\.2vmin,\s*60px\);/);
  const ipadUtilityAuthority = atRuleBodies('@media (min-width: 700px) and (min-height: 700px)')
    .findLast((body) => body.includes('.mobile-flight-hud .mobile-utility-drawer'));
  assert.ok(ipadUtilityAuthority, 'missing final iPad five-cell utility drawer authority');
  assert.match(
    ipadUtilityAuthority,
    /\.mobile-flight-hud \.mobile-utility-drawer\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*var\(--mobile-flight-action-size\)\);[\s\S]*?width:\s*calc\([\s\S]*?var\(--mobile-flight-action-gap\)[\s\S]*?\+ 14px[\s\S]*?\);/
  );
  assert.match(
    ipadUtilityAuthority,
    /--mobile-route-top:[\s\S]*?var\(--mobile-flight-top-offset\)[\s\S]*?var\(--mobile-flight-head-height\)[\s\S]*?\+ 12px\);/,
    'compact tablet landscape must retain the below-head route rail'
  );
  assert.match(
    ipadFlightDeck,
    /\.mobile-flight-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*var\(--mobile-flight-action-size\)\);/
  );
  assert.match(
    ipadFlightDeck,
    /\.mobile-route-cue\s*\{[\s\S]*?width:\s*clamp\(300px,\s*32vw,\s*360px\);[\s\S]*?height:\s*64px;/
  );
  assert.match(
    ipadFlightDeck,
    /\.mobile-route-cue\s*\{[\s\S]*?top:\s*max\(224px,\s*calc\(var\(--safe-top\)\s*\+\s*208px\)\);/,
    'iPad portrait guidance must retain its dedicated below-head slot'
  );
  const ipadLandscapeFlightDeck = atRuleBodies(
    '@media (min-width: 1024px) and (min-height: 700px) and (orientation: landscape)'
  ).find((body) => body.includes('--mobile-route-top'));
  assert.ok(ipadLandscapeFlightDeck, 'missing final iPad landscape flight-deck authority');
  assert.match(
    ipadLandscapeFlightDeck,
    /--mobile-route-top:\s*var\(--mobile-flight-top-offset\);/,
    'iPad landscape guidance must share the safe-area top rail'
  );
  const ipadTransmissionBottomDock = atRuleBodies(
    '@media (min-width: 700px) and (min-height: 700px)'
  ).findLast((body) => body.includes('--mobile-transmission-bottom-offset'));
  assert.ok(ipadTransmissionBottomDock, 'missing final dual-axis touch-tablet transmission bottom dock');
  assert.match(
    ipadTransmissionBottomDock,
    /html\[data-mobile-cockpit="true"\]\[data-touch-capable="true"\]\s*\{[\s\S]*?--mobile-transmission-bottom-offset:\s*var\(--mobile-control-bottom-offset\);/
  );
  assert.match(
    ipadTransmissionBottomDock,
    /html\[data-mobile-cockpit="true"\]\[data-touch-capable="true"\] \.mobile-transmission-selector\s*\{[\s\S]*?right:\s*auto;[\s\S]*?bottom:\s*var\(--mobile-transmission-bottom-offset\);[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\);/
  );
  const tabletBottomDockStart = css.indexOf('Tablet bottom-dock / iPad 底部换挡器');
  const automaticCompactStart = css.indexOf('AT compact gearbox / AT 紧凑换挡器');
  assert.ok(
    tabletBottomDockStart > css.indexOf('Final responsive-HUD authority')
      && tabletBottomDockStart < automaticCompactStart,
    'the iPad bottom dock must follow responsive geometry while leaving the media-free AT grid last'
  );
  const phoneShortLandscapeTransmission = atRuleBodies(
    '@media (max-height: 699px) and (orientation: landscape)'
  ).findLast((body) => body.includes('.mobile-transmission-selector'));
  assert.ok(phoneShortLandscapeTransmission, 'missing phone short-landscape transmission split bay');
  assert.match(
    phoneShortLandscapeTransmission,
    /\.mobile-transmission-selector\s*\{[\s\S]*?right:\s*auto;[\s\S]*?bottom:\s*var\(--mobile-control-bottom-offset\);[\s\S]*?left:\s*calc\([\s\S]*?transform:\s*none;/,
    'the dual-axis tablet dock must not replace the phone short-landscape split bay'
  );
  assert.match(
    ipadFlightDeck,
    /data-utilities-expanded="true"[\s\S]*?transform:\s*none;/
  );
  assert.doesNotMatch(
    css,
    /data-utilities-expanded="true"[^{}]*\{[^{}]*transform:\s*translate(?:X|Y|3d)?\(/,
    'opening utilities must not move the route or autopilot anchors'
  );

  for (const selector of [
    'html[data-mobile-cockpit="true"] #leftBtn',
    'html[data-mobile-cockpit="true"] #brakeBtn'
  ]) {
    const body = ruleBody(selector);
    assert.match(body, /var\(--safe-(?:top|right|bottom|left)\)/);
  }
});

test('HUD uses zoned Liquid Glass envelopes with fixed-map-safe ancestors and accessible fallbacks', () => {
  const liquidStart = css.indexOf('Live Liquid Glass uses one analytical material per screen region');
  const liquidEnd = css.indexOf('/* The legacy compact rule', liquidStart);
  assert.ok(liquidStart >= 0 && liquidEnd > liquidStart, 'missing bounded Liquid Glass material section');
  const liquidCss = css.slice(liquidStart, liquidEnd);
  const localZoneTokens = [
    '--hud-zone-surface-rgb',
    '--hud-zone-strong-rgb',
    '--hud-zone-control-rgb',
    '--hud-zone-control-hover-rgb',
    '--hud-zone-control-active-rgb',
    '--hud-zone-control-mobile-rgb',
    '--hud-zone-edge-rgb',
    '--hud-zone-edge-strong-rgb',
    '--hud-zone-surface-alpha',
    '--hud-zone-strong-alpha',
    '--hud-zone-control-alpha',
    '--hud-zone-cell-alpha',
    '--hud-zone-edge-alpha',
    '--hud-zone-highlight-alpha',
    '--hud-zone-shadow-alpha',
    '--hud-zone-copy-backing-alpha'
  ];

  assert.match(html, /<meta name="color-scheme" content="dark light"\s*\/>/);
  assert.match(html, /<html[^>]*data-hud-contrast="on-light"/);
  const zoneHostContracts = [
    ['hud-primary', /<div\b[^>]*class="hud-wing hud-primary"[^>]*>/, 'left'],
    ['steerInstrument', /<div\b[^>]*id="steerInstrument"[^>]*>/, 'position'],
    ['hud-navigation', /<div\b[^>]*class="hud-wing hud-navigation"[^>]*>/, 'right'],
    ['keyTracker', /<aside\b[^>]*id="keyTracker"[^>]*>/, 'input'],
    ['desktopCompass', /<aside\b[^>]*id="desktopCompass"[^>]*>/, 'compass'],
    ['controls', /<div\b[^>]*id="controls"[^>]*>/, 'input']
  ];
  for (const [hostName, hostPattern, zoneName] of zoneHostContracts) {
    const hostTag = html.match(hostPattern)?.[0];
    assert.ok(hostTag, `missing HUD zone host ${hostName}`);
    assert.match(hostTag, new RegExp(`data-hud-zone="${zoneName}"`));
    assert.match(hostTag, /data-hud-contrast="on-light"/);
  }

  const localZoneTokenBody = ruleBody('[data-hud-zone]');
  for (const token of localZoneTokens) {
    assert.match(
      localZoneTokenBody,
      new RegExp(`(?:^|\\n)\\s*${token}:\\s*[^;]+;`),
      `missing local adaptive glass token ${token}`
    );
  }
  assert.match(
    localZoneTokenBody,
    /--cockpit-surface:\s*rgba\(var\(--hud-zone-surface-rgb\),\s*var\(--hud-zone-surface-alpha\)\);/
  );
  assert.match(
    localZoneTokenBody,
    /--cockpit-control:\s*rgba\(var\(--hud-zone-control-rgb\),\s*var\(--hud-zone-control-alpha\)\);/
  );
  assert.match(
    localZoneTokenBody,
    /--cockpit-edge-strong:\s*rgba\(var\(--hud-zone-edge-strong-rgb\),\s*calc\(var\(--hud-zone-edge-alpha\) \+ 0\.18\)\);/
  );
  assert.match(
    localZoneTokenBody,
    /--cockpit-inset:\s*rgba\(var\(--hud-zone-strong-rgb\),\s*calc\(var\(--hud-zone-surface-alpha\) - 0\.14\)\);/
  );
  for (const mode of ['on-light', 'on-dark']) {
    const selector = `[data-hud-zone][data-hud-contrast="${mode}"]`;
    const declarations = [...ruleBody(selector).matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)]
      .map((match) => match[1]);
    assert.ok(declarations.length > 0, `${selector} must publish local safety tokens`);
    assert.ok(
      declarations.every((property) => property.startsWith('--')),
      `${selector} may only change custom-property tokens`
    );
  }
  assert.doesNotMatch(css, /@media \(prefers-color-scheme:/);

  const fixedMapAncestorRule = css.match(
    /\.hud\s*,\s*\.hud-wing\s*,\s*\.hud-primary\s*,\s*\.hud-navigation\s*\{([^}]+)\}/
  );
  assert.ok(fixedMapAncestorRule, 'missing the shared fixed-map ancestor safety rule');
  const fixedMapAncestorSafety = new Map([
    ['-webkit-backdrop-filter', 'none'],
    ['backdrop-filter', 'none'],
    ['filter', 'none'],
    ['transform', 'none'],
    ['translate', 'none'],
    ['rotate', 'none'],
    ['scale', 'none'],
    ['perspective', 'none'],
    ['contain', 'none'],
    ['will-change', 'auto'],
    ['content-visibility', 'visible'],
    ['container-type', 'normal']
  ]);
  for (const [property, expectedValue] of fixedMapAncestorSafety) {
    assert.match(
      fixedMapAncestorRule[1],
      new RegExp(`(?:^|\\n)\\s*${property}:\\s*${expectedValue};`),
      `.hud/.hud-wing/.hud-primary/.hud-navigation must keep ${property}: ${expectedValue}`
    );
  }

  assert.match(
    liquidCss,
    /\.hud-primary\s*\{[\s\S]*?filter:\s*none;[\s\S]*?transform:\s*none;[\s\S]*?perspective:\s*none;[\s\S]*?contain:\s*none;/
  );
  assert.match(
    liquidCss,
    /\.hud-primary::before\s*\{[\s\S]*?border:\s*1px solid var\(--cockpit-edge\);[\s\S]*?background-color:\s*var\(--cockpit-surface\);[\s\S]*?backdrop-filter:\s*blur\(18px\) saturate\(1\.28\) brightness\(1\.04\);/
  );
  assert.match(
    liquidCss,
    /\.hud-actions \.hud-toggle\s*\{[\s\S]*?rgba\(var\(--hud-zone-control-active-rgb\),\s*var\(--hud-zone-copy-backing-alpha\)\);/
  );
  assert.match(
    liquidCss,
    /\.hud-primary \.metric\s*\{[\s\S]*?rgba\(var\(--hud-zone-strong-rgb\),\s*var\(--hud-zone-cell-alpha\)\);/
  );
  assert.match(
    liquidCss,
    /\.hud-actions\s*\{[\s\S]*?border:\s*1px solid var\(--cockpit-edge\);[\s\S]*?background-color:\s*var\(--cockpit-surface\);[\s\S]*?backdrop-filter:\s*blur\(16px\) saturate\(1\.24\) brightness\(1\.035\);/
  );
  assert.match(
    liquidCss,
    /\.hud-actions\s*\{[\s\S]*?transform:\s*translate3d\(0,\s*0,\s*0\);[\s\S]*?transform 420ms cubic-bezier\(0\.16,\s*1,\s*0\.30,\s*1\);/,
    'the command deck must settle through one compositor-only upward slide'
  );
  assert.match(
    liquidCss,
    /body\.startup-loading-open > \.hud \.hud-actions,\s*body\.launch-overlay-open > \.hud \.hud-actions\s*\{[^}]*transform:\s*translate3d\(0,\s*clamp\(16px,\s*2\.4vh,\s*26px\),\s*0\);/,
    'loading, launch, and pause surfaces must hold the command deck below its live position'
  );
  assert.match(
    liquidCss,
    /\.hud-actions \.hud-toggle\s*\{[\s\S]*?var\(--hud-zone-copy-backing-alpha\)[\s\S]*?backdrop-filter:\s*none;[\s\S]*?box-shadow:\s*none;/
  );
  assert.match(
    liquidCss,
    /\.hud-primary \.metric\s*\{[\s\S]*?var\(--hud-zone-cell-alpha\)[\s\S]*?backdrop-filter:\s*none;/
  );
  assert.match(
    liquidCss,
    /\.minimap-panel\s*\{[\s\S]*?var\(--cockpit-surface-strong\)[\s\S]*?backdrop-filter:\s*none;/
  );
  for (const selector of [
    '.minimap-guidance',
    '.key-tracker',
    '.desktop-compass-readout',
    '.touch-btn'
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      liquidCss,
      new RegExp(`${escapedSelector}\\s*\\{[^}]*--hud-zone-copy-backing-alpha`),
      `${selector} must use the bounded local copy backing`
    );
  }
  for (const selector of [
    '.hud-primary .metric.score-metric',
    '.hud-primary .steer-instrument'
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      liquidCss,
      new RegExp(`${escapedSelector}\\s*\\{[^}]*--hud-zone-cell-alpha`),
      `${selector} must share the standard telemetry cell depth`
    );
  }
  assert.match(
    liquidCss,
    /\.hud-primary \.weather-timing,\s*\.hud-primary \.surface-contact-status,\s*\.hud-primary \.badge\s*\{[^}]*--hud-zone-cell-alpha/,
    'weather detail and identity cells must share the standard telemetry cell depth'
  );
  assert.doesNotMatch(
    liquidCss,
    /\.hud-primary \.metric\.score-metric\s*\{[^}]*--hud-zone-copy-backing-alpha/,
    'score must not restore an isolated near-black plate'
  );
  assert.doesNotMatch(
    liquidCss,
    /\.hud-primary \.steer-instrument\s*\{[^}]*--hud-zone-copy-backing-alpha/,
    'lateral position must not restore an isolated near-black plate'
  );
  const compactStart = liquidCss.indexOf('/* Compact wings retain one thin outer envelope');
  const compactEnd = liquidCss.indexOf('@media (max-height: 560px)', compactStart);
  assert.ok(compactStart >= 0 && compactEnd > compactStart, 'missing bounded compact HUD material section');
  const compactCss = liquidCss.slice(compactStart, compactEnd);
  assert.match(
    compactCss,
    /\.hud-primary \.metric:not\(\.speedometer-metric\)\s*\{[^}]*background:\s*transparent;/,
    'compact telemetry must flatten score together with its peers'
  );
  assert.match(
    compactCss,
    /\.hud-primary \.steer-instrument,\s*\.hud-primary \.weather-timing,\s*\.hud-primary \.surface-contact-status,\s*\.hud-primary \.badge\s*\{[^}]*background:\s*transparent;/,
    'compact secondary telemetry must not regain isolated black plates'
  );
  assert.match(css, /--hud-glass-surface-alpha:\s*0\.68;/);
  assert.match(css, /--hud-glass-strong-alpha:\s*0\.76;/);
  assert.match(css, /--hud-glass-control-alpha:\s*0\.63;/);
  assert.match(
    ruleBody('[data-hud-zone][data-hud-contrast="on-light"]'),
    /--hud-zone-surface-alpha:\s*calc\(var\(--hud-glass-surface-alpha\) \+ 0\.05\);/
  );
  assert.match(
    ruleBody('[data-hud-zone][data-hud-contrast="on-dark"]'),
    /--hud-zone-surface-alpha:\s*calc\(var\(--hud-glass-surface-alpha\) - 0\.03\);/
  );
  assert.match(css, /@media \(prefers-reduced-transparency:\s*reduce\)[\s\S]*?\.hud-primary::before,[\s\S]*?\.hud-actions\s*\{[\s\S]*?background:\s*var\(--cockpit-solid\);[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.hud-actions\s*\{[\s\S]*?transform:\s*none !important;[\s\S]*?transition:\s*none !important;/,
    'Reduced Motion must present the command deck at its final position immediately'
  );
  assert.match(css, /@supports not[\s\S]*?\.hud-primary::before,[\s\S]*?\.hud-actions\s*\{[\s\S]*?background:\s*var\(--cockpit-solid\);[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(css, /@media \(forced-colors:\s*active\)[\s\S]*?\.hud-primary::before\s*\{\s*display:\s*none;/);
  assert.match(css, /@media \(prefers-contrast:\s*more\)[\s\S]*?outline:\s*2px solid/);
  assert.match(css, /button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\);/);

});

test('wide touch tablets dock driving controls to both safe edges without enabling desktop controls', () => {
  assert.match(ruleBody('.controls'), /display:\s*none;/);
  const wideTouchStart = css.indexOf('@media (hover: none) and (min-width: 921px)');
  const followingNarrowPortrait = css.indexOf(
    '@media (max-width: 360px) and (orientation: portrait)',
    wideTouchStart
  );
  const shortLandscapeStart = css.indexOf(
    '@media (max-height: 560px) and (orientation: landscape)',
    wideTouchStart
  );
  assert.ok(wideTouchStart >= 0, 'missing wide touch-tablet media query');
  assert.ok(followingNarrowPortrait > wideTouchStart, 'wide touch-tablet rule must be bounded');
  assert.ok(shortLandscapeStart > wideTouchStart, 'short landscape must retain its later override');
  const wideTouchRule = css.slice(wideTouchStart, followingNarrowPortrait);
  assert.match(wideTouchRule, /left:\s*max\(10px,\s*calc\(var\(--safe-left\) \+ 8px\)\);/);
  assert.match(wideTouchRule, /right:\s*max\(10px,\s*calc\(var\(--safe-right\) \+ 8px\)\);/);
  assert.match(wideTouchRule, /width:\s*auto;/);
  assert.match(wideTouchRule, /transform:\s*none;/);
  assert.doesNotMatch(wideTouchRule, /display:/);
});

test('lateral position is a centred labelled meter with explicit left, zero, and right references', () => {
  const meterStart = html.indexOf('<div class="steer-instrument"');
  const meterEnd = html.indexOf('<!-- Forecast and rendering share one pausable weather clock', meterStart);
  assert.ok(meterStart >= 0 && meterEnd > meterStart, 'missing bounded lateral-position meter');
  const meterMarkup = html.slice(meterStart, meterEnd);
  assert.match(meterMarkup, /data-hud-zone="position"[^>]*role="meter"/);
  assert.match(meterMarkup, /aria-labelledby="steerInstrumentLabel"/);
  assert.match(meterMarkup, /aria-valuemin="-100"[^>]*aria-valuemax="100"[^>]*aria-valuenow="0"/);
  assert.match(meterMarkup, /id="steerInstrumentLabel"[^>]*data-i18n="hud\.lateralPosition"/);
  assert.match(meterMarkup, /class="steer-tick steer-tick-left"/);
  assert.match(meterMarkup, /class="steer-tick steer-tick-center"/);
  assert.match(meterMarkup, /class="steer-tick steer-tick-right"/);
  assert.match(meterMarkup, /class="steer-marker" id="steerMarker"/);
  assert.match(ruleBody('.steer-marker'), /left:\s*50%;/);
  assert.match(ruleBody('.steer-marker'), /transition:\s*left 120ms linear;/);
  assert.match(ruleBody('.steer-tick-center'), /left:\s*50%;/);
});

test('autopilot command HUD keeps 10 Hz telemetry quiet and preserves responsive authority detail', () => {
  const panelStart = html.indexOf('<div class="auto-panel" id="autoPanel"');
  const announcementStart = html.indexOf(
    '<p class="sr-only" id="autoAuthorityAnnouncement"',
    panelStart
  );
  assert.ok(panelStart >= 0 && announcementStart > panelStart, 'missing bounded autopilot HUD');
  const panelMarkup = html.slice(panelStart, announcementStart);
  assert.match(
    panelMarkup,
    /^<div class="auto-panel" id="autoPanel" role="region" aria-labelledby="autoPanelTitle" aria-describedby="autoAuthoritySummary"[^>]*>\s*<div class="auto-panel-reveal">/
  );
  assert.doesNotMatch(
    panelMarkup,
    /\baria-live=/,
    'Continuously refreshed autopilot telemetry must not be a live region'
  );
  assert.match(
    panelMarkup,
    /class="auto-panel-link" aria-hidden="true"/
  );
  assert.match(
    panelMarkup,
    /class="auto-panel-eyebrow" data-i18n="autopilot\.panelEyebrow">航迹控制<\/small>/
  );

  const hierarchyMarkers = [
    'class="auto-panel-head"',
    'class="auto-authority-overview"',
    'class="auto-status-grid"',
    'class="auto-bar" id="autoRiskMeter"'
  ];
  const hierarchyOffsets = hierarchyMarkers.map((marker) => panelMarkup.indexOf(marker));
  assert.ok(
    hierarchyOffsets.every((offset) => offset >= 0),
    'autopilot HUD must retain every information layer'
  );
  assert.deepEqual(
    hierarchyOffsets,
    [...hierarchyOffsets].sort((left, right) => left - right),
    'autopilot HUD must keep heading, overview, details, then meter order'
  );

  assert.deepEqual(
    [...panelMarkup.matchAll(/class="auto-status-item (auto-status-[^"]+)"/g)]
      .map((match) => match[1]),
    [
      'auto-status-lateral',
      'auto-status-longitudinal',
      'auto-status-brake',
      'auto-status-threat'
    ],
    'the four detail rails must retain distinct controller and hazard semantics'
  );
  const thresholdMarkup = panelMarkup.match(
    /<span class="auto-bar-thresholds" aria-hidden="true">([\s\S]*?)<\/span>/
  )?.[1] || '';
  assert.equal((thresholdMarkup.match(/<i><\/i>/g) || []).length, 3);
  for (const [index, threshold] of [30, 58, 82].entries()) {
    assert.match(
      css,
      new RegExp(`\\.auto-bar-thresholds i:nth-child\\(${index + 1}\\) \\{ left: ${threshold}%; \\}`)
    );
  }

  const requiredIds = [
    'autoIntentText',
    'autoRiskLabel',
    'autoRiskText',
    'autoLateralAuthorityText',
    'autoLongitudinalAuthorityText',
    'autoBrakeText',
    'autoNextObstacleText',
    'autoRiskMeter',
    'autoRiskFill',
    'autoAuthoritySummary',
    'autoAuthorityAnnouncement'
  ];
  for (const id of requiredIds) {
    assert.equal(
      (html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length,
      1,
      `${id} must have exactly one static owner`
    );
  }
  assert.doesNotMatch(html, /\bid="auto(?:Goal|Target)Text"/);

  const staticBindings = [
    ['autoPanelTitle', 'autopilot.panelTitle'],
    ['autoIntentText', 'autopilot.intent.manualHold'],
    ['autoRiskLabel', 'autopilot.risk.clear'],
    ['autoLateralAuthorityText', 'autopilot.authority.manual'],
    ['autoLongitudinalAuthorityText', 'autopilot.longitudinal.manual'],
    ['autoBrakeText', 'autopilot.brake.standby'],
    ['autoNextObstacleText', 'autopilot.threat.none'],
    ['autoAuthoritySummary', 'autopilot.authoritySummary.initial']
  ];
  for (const [id, key] of staticBindings) {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || '';
    assert.match(tag, new RegExp(`\\bdata-i18n="${key.replaceAll('.', '\\.')}"`));
  }

  const meterTag = html.match(/<div class="auto-bar" id="autoRiskMeter"[^>]*>/)?.[0] || '';
  assert.match(meterTag, /\brole="meter"/);
  assert.match(meterTag, /\bdata-i18n-aria-label="autopilot\.riskMeterAria"/);
  assert.match(
    meterTag,
    /\baria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="0"/
  );
  assert.match(meterTag, /\bdata-i18n-aria-valuetext="autopilot\.risk\.initialAria"/);
  assert.match(panelMarkup, /id="autoRiskFill" aria-hidden="true"/);
  assert.match(
    panelMarkup,
    /id="autoAuthoritySummary"[^>]*data-i18n-aria-label="autopilot\.authoritySummary\.initialAria"/
  );

  const announcementTag = html.match(
    /<p class="sr-only" id="autoAuthorityAnnouncement"[^>]*>/
  )?.[0] || '';
  assert.match(announcementTag, /\brole="status"/);
  assert.match(announcementTag, /\baria-live="polite"/);
  assert.match(announcementTag, /\baria-atomic="true"/);

  const closedPanel = ruleBody('.auto-panel');
  assert.match(closedPanel, /display:\s*grid;/);
  assert.match(closedPanel, /grid-template-rows:\s*0fr;/);
  assert.match(closedPanel, /overflow:\s*hidden;/);
  assert.match(closedPanel, /visibility:\s*hidden;/);
  assert.doesNotMatch(
    closedPanel,
    /grid-template-rows\s+[^,;]+(?:,|;)/,
    'the refined entrance must not animate layout rows'
  );
  assert.match(closedPanel, /transform 0\.46s cubic-bezier/);
  assert.match(closedPanel, /visibility 0s linear 0\.46s/);
  const reveal = ruleBody('.auto-panel-reveal');
  assert.match(reveal, /min-height:\s*0;/);
  assert.match(reveal, /overflow:\s*hidden;/);
  assert.match(reveal, /transform:\s*translateY\(-7px\);/);
  const openPanel = ruleBody('.auto-panel.is-on');
  assert.match(openPanel, /grid-template-rows:\s*1fr;/);
  assert.match(openPanel, /visibility:\s*visible;/);
  assert.match(openPanel, /transform:\s*translateY\(0\) scale\(1\);/);
  assert.match(css, /\.auto-panel\.is-on \.auto-panel-reveal\s*\{[\s\S]*?transform:\s*translateY\(0\);/);

  const entranceStart = css.indexOf(
    '/* The named entrance survives hidden-to-visible synchronization while touching compositor-only properties. */'
  );
  const entranceEnd = css.indexOf('.auto-panel-head {', entranceStart);
  assert.ok(entranceStart >= 0 && entranceEnd > entranceStart, 'missing bounded autopilot entrance');
  const entranceCss = css.slice(entranceStart, entranceEnd);
  assert.doesNotMatch(
    entranceCss,
    /\.(?:hud(?:-wing|-navigation)?|minimap(?:-panel|-viewport|-canvas)|navigation-body)\b/i,
    'autopilot entrance selectors must never touch map or fixed-position ancestors'
  );
  assert.doesNotMatch(
    entranceCss,
    /\b(?:backdrop-filter|filter|contain|perspective|will-change)\s*:/,
    'autopilot entrance must not animate a containing-block or filter property'
  );

  const entranceBindings = [
    ['.auto-panel.is-on:not([hidden])', 'auto-panel-liquid-enter'],
    ['.auto-panel.is-on:not([hidden])::before', 'auto-panel-liquid-rim'],
    ['.auto-panel.is-on:not([hidden])::after', 'auto-panel-liquid-sweep'],
    ['.auto-panel.is-on:not([hidden]) .auto-panel-reveal', 'auto-panel-content-settle']
  ];
  for (const [selector, animationName] of entranceBindings) {
    assert.match(
      ruleBody(selector),
      new RegExp(`animation:\\s*${animationName}\\b`),
      `${selector} must own ${animationName}`
    );
  }
  for (const animationName of entranceBindings.map(([, name]) => name)) {
    const keyframeBodies = atRuleBodies(`@keyframes ${animationName}`);
    assert.equal(keyframeBodies.length, 1, `${animationName} must have one named owner`);
    const properties = [
      ...keyframeBodies[0].matchAll(/(?:^|[;{])\s*([\w-]+)\s*:/g)
    ].map((match) => match[1]);
    assert.ok(properties.includes('opacity'), `${animationName} must animate opacity`);
    assert.ok(properties.includes('transform'), `${animationName} must animate transform`);
    assert.ok(
      properties.every((property) => property === 'opacity' || property === 'transform'),
      `${animationName} may animate only opacity and transform`
    );
  }

  const mobileCapsuleTag = html.match(
    /<section\b[^>]*\bid="mobileAutopilotCapsule"[^>]*>/
  )?.[0] || '';
  assert.match(mobileCapsuleTag, /\bhidden\b/);
  assert.match(mobileCapsuleTag, /\binert\b/);
  assert.match(mobileCapsuleTag, /\baria-hidden="true"/);
  assert.match(
    ruleBody('html[data-mobile-cockpit="true"] .mobile-autopilot-capsule[hidden]'),
    /display:\s*none;/,
    'manual and automatic-throttle-only flight must reserve no autopilot status row'
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\] :is\([\s\S]*?\.hud-navigation \.auto-panel[\s\S]*?\)\s*\{\s*display:\s*none !important;/,
    'the desktop command panel must never leak into the mobile flight deck'
  );
  const capsule = ruleBody('html[data-mobile-cockpit="true"] .mobile-autopilot-capsule');
  assert.match(capsule, /position:\s*absolute;/);
  assert.match(capsule, /pointer-events:\s*none;/);
  assert.match(capsule, /grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/);
  assert.match(capsule, /transform:\s*none;/);

  const reducedMotionRules = atRuleBodies('@media (prefers-reduced-motion: reduce)').join('\n');
  assert.match(
    reducedMotionRules,
    /\.auto-panel,[\s\S]*?\.auto-panel::before,[\s\S]*?\.auto-panel::after,[\s\S]*?\.auto-panel-reveal,[\s\S]*?\.auto-bar-fill\s*\{[\s\S]*?transition:\s*none !important;[\s\S]*?animation:\s*none !important;/
  );
  assert.match(
    reducedMotionRules,
    /\.mobile-route-cue,[\s\S]*?\.mobile-autopilot-capsule,[\s\S]*?body > \.mobile-flight-hud\s*\{[\s\S]*?transition:\s*none !important;/
  );

  const noFilterRules = atRuleBodies(
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'
  ).join('\n');
  const reducedTransparencyRules = atRuleBodies(
    '@media (prefers-reduced-transparency: reduce)'
  ).join('\n');
  for (const [name, fallbackRules] of [
    ['missing backdrop-filter', noFilterRules],
    ['reduced transparency', reducedTransparencyRules]
  ]) {
    assert.match(
      fallbackRules,
      /\.auto-panel\.is-on\s*\{[\s\S]*?background:\s*var\(--cockpit-solid\);[\s\S]*?-webkit-backdrop-filter:\s*none;[\s\S]*?backdrop-filter:\s*none;/,
      `${name} must give the command panel a solid surface`
    );
    assert.match(
      fallbackRules,
      /\.auto-panel::after\s*\{\s*display:\s*none;\s*\}/,
      `${name} must remove the decorative liquid sweep`
    );
  }

  const forcedColorRules = atRuleBodies('@media (forced-colors: active)').join('\n');
  assert.match(
    forcedColorRules,
    /\.auto-panel,[\s\S]*?border-color:\s*CanvasText;[\s\S]*?background:\s*Canvas;[\s\S]*?color:\s*CanvasText;[\s\S]*?backdrop-filter:\s*none;/
  );
  assert.match(
    forcedColorRules,
    /\.auto-panel::before,[\s\S]*?\.auto-panel::after,[\s\S]*?\.auto-panel-link\s*\{[\s\S]*?display:\s*none;[\s\S]*?animation:\s*none !important;/
  );
  assert.match(
    forcedColorRules,
    /\.auto-status-item::before,[\s\S]*?\.auto-bar-fill\s*\{[\s\S]*?background:\s*Highlight;[\s\S]*?box-shadow:\s*none;/
  );
  for (const riskLevel of ['clear', 'guarded', 'elevated', 'critical']) {
    assert.match(css, new RegExp(`\\.auto-panel\\[data-risk-level="${riskLevel}"\\]`));
  }
  assert.match(css, /\.auto-panel\[data-lateral-authority="manual-takeover"\] #autoLateralAuthorityText/);
  assert.match(css, /\.auto-panel\[data-longitudinal-authority="cruise"\] #autoLongitudinalAuthorityText/);
  assert.match(css, /\.auto-panel\[data-brake-mode="manual"\] #autoBrakeText/);
  assert.match(css, /\.auto-panel\[data-brake-mode="curve"\] #autoBrakeText/);
  assert.match(
    css,
    /\.auto-panel:is\(\[data-brake-mode="obstacle"\], \[data-brake-mode="opposing-boundary"\]\) #autoBrakeText/
  );
});

test('tactical minimap keeps one atomic visual surface and one quiet accessible heading owner', () => {
  const mapStart = html.indexOf('<section class="minimap-panel"');
  const mapEnd = html.indexOf('</section>', mapStart);
  assert.ok(mapStart >= 0 && mapEnd > mapStart, 'missing tactical minimap region');
  const mapMarkup = html.slice(mapStart, mapEnd + '</section>'.length);

  assert.match(mapMarkup, /data-map-mode="standard"[^>]*data-orientation="heading-up"[^>]*data-threat-level="clear"/);
  assert.match(mapMarkup, /aria-labelledby="minimapTitle"[^>]*aria-describedby="minimapLegendHelp minimapStatus"/);
  assert.deepEqual(
    [...mapMarkup.matchAll(/<canvas\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((match) => match[1]),
    ['minimapCanvas', 'minimapCanvasStandby']
  );
  assert.equal((mapMarkup.match(/\bclass="minimap-canvas is-presented"/g) || []).length, 1);
  assert.equal((mapMarkup.match(/\bdata-presented="true"/g) || []).length, 1);
  assert.equal((mapMarkup.match(/\bdata-presented="false"/g) || []).length, 1);
  assert.equal((mapMarkup.match(/<canvas\b[^>]*aria-hidden="true"/g) || []).length, 2);
  for (const canvasTag of mapMarkup.match(/<canvas\b[^>]*>/g) || []) {
    assert.doesNotMatch(canvasTag, /\btabindex=/);
    assert.doesNotMatch(canvasTag, /\brole=/);
  }

  const canvasRule = ruleBody('.minimap-canvas');
  assert.match(canvasRule, /position:\s*absolute;/);
  assert.match(canvasRule, /opacity:\s*0;/);
  assert.match(canvasRule, /visibility:\s*hidden;/);
  assert.doesNotMatch(canvasRule, /transition:/);
  const presentedRule = ruleBody('.minimap-canvas.is-presented');
  assert.match(presentedRule, /opacity:\s*1;/);
  assert.match(presentedRule, /visibility:\s*visible;/);

  assert.match(mapMarkup, /id="minimapModeText">局部导航<\/b>/);
  assert.match(mapMarkup, /id="minimapOrientationText">航向朝上<\/span>/);
  assert.match(mapMarkup, /id="minimapInstructionText">保持路线<\/strong>/);
  assert.match(mapMarkup, /id="minimapGuidanceMeta">路线保持<\/span>/);
  assert.match(mapMarkup, /class="minimap-legend" aria-hidden="true">[\s\S]*?已选[\s\S]*?候选[\s\S]*?障碍[\s\S]*?烛光[\s\S]*?船流/);
  for (const id of [
    'minimapModeText',
    'minimapOrientationText',
    'minimapInstructionIcon',
    'minimapInstructionText',
    'minimapGuidanceMeta',
    'minimapHeadingStatus',
    'minimapStatus'
  ]) {
    assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, `${id} must have one owner`);
  }

  const legendHelp = mapMarkup.match(/<p\b[^>]*\bid="minimapLegendHelp"[^>]*>[\s\S]*?<\/p>/)?.[0] || '';
  assert.match(legendHelp, /金白实线[\s\S]*金色虚线[\s\S]*红色[\s\S]*蓝色[\s\S]*灰蓝箭头[\s\S]*隧道或下层道路/);
  assert.doesNotMatch(legendHelp, /aria-live=/);

  const headingTag = mapMarkup.match(/<p\b[^>]*\bid="minimapHeadingStatus"[^>]*>/)?.[0] || '';
  assert.match(headingTag, /role="img"/);
  assert.match(headingTag, /aria-label="实时航向 000 度，北"/);
  assert.doesNotMatch(headingTag, /aria-live=/);
  const statusTag = mapMarkup.match(/<p\b[^>]*\bid="minimapStatus"[^>]*>/)?.[0] || '';
  assert.match(statusTag, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);

  const compassTag = html.match(/<aside\b[^>]*\bid="desktopCompass"[^>]*>/)?.[0] || '';
  assert.match(compassTag, /aria-hidden="true"/);
  assert.match(compassTag, /\binert\b/);
  assert.doesNotMatch(compassTag, /\brole=/);
  assert.doesNotMatch(compassTag, /\baria-label=/);

  const minimapErrorsIndex = html.indexOf('<script src="errors/minimap.js');
  const mapModuleIndex = html.indexOf('<script src="src/navigation/Neon_Autopilot_V23_HighSpeed_DroneHeat.cloverleaf-map.js');
  const runtimeIndex = html.indexOf('<script src="src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js');
  assert.ok(minimapErrorsIndex >= 0
    && minimapErrorsIndex < mapModuleIndex
    && mapModuleIndex < runtimeIndex,
  'minimap error classification must load before the renderer and runtime');
});

test('music library is a labelled modal with explicit modes, status, and 44px controls', () => {
  assert.match(html, /id="musicLibraryBtn"[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*aria-controls="musicLibraryOverlay"[^>]*aria-expanded="false"/);
  assert.match(html, /id="musicLibraryOverlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="musicLibraryTitle"[^>]*aria-describedby="musicLibraryDescription musicThemeContract"[^>]*hidden/);
  assert.match(html, /id="musicLibraryCloseBtn"[^>]*type="button"[^>]*aria-label="关闭背景音乐库"/);
  assert.match(html, /id="musicLibraryStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  const modeButtons = [...html.matchAll(/<button type="button" data-music-mode="(adaptive|sequential|shuffle|manual)" aria-pressed="(true|false)">/g)];
  assert.deepEqual(modeButtons.map((match) => match[1]), ['adaptive', 'sequential', 'shuffle', 'manual']);
  assert.equal(modeButtons.filter((match) => match[2] === 'true').length, 1);
  assert.match(css, /\.music-library-overlay\s*\{[\s\S]*?touch-action:\s*pan-x pan-y pinch-zoom;/);
  assert.match(css, /\.music-library-overlay\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /\.music-library-close\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  assert.match(css, /\.music-transport button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
});

test('FPS readout stays visible, labelled, non-live, and color-independent', () => {
  assert.match(html, /class="metric fps-metric"[^>]*aria-label="实时帧率"/);
  const fpsTag = html.match(/<strong\b[^>]*\bid="fpsDisplay"[^>]*>/)?.[0] || '';
  assert.match(fpsTag, /data-fps-level="pending"/);
  assert.match(fpsTag, /data-fps-label="采样中"/);
  assert.match(fpsTag, /aria-label="等待首次采样"/);
  assert.doesNotMatch(fpsTag, /aria-live=/);
  assert.match(css, /\.metric\.fps-metric\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?display:\s*flex;/);
  for (const level of ['pending', 'smooth', 'watch', 'low', 'critical']) {
    assert.match(css, new RegExp(`#fpsDisplay\\[data-fps-level="${level}"\\]\\s*\\{[^}]*color:`));
  }
  assert.match(css, /#fpsDisplay::before\s*\{[\s\S]*?content:\s*attr\(data-fps-label\);/);
});

test('hood collision guide stays inert, centre-transparent, and low-occlusion until active hood flight', () => {
  const guideTag = html.match(/<div\b[^>]*\bid="hoodCollisionGuide"[^>]*>/)?.[0] || '';
  assert.match(guideTag, /\bclass="[^"]*\bhood-collision-guide\b[^"]*"/);
  assert.match(guideTag, /\bdata-guide-alert="clear"/);
  assert.match(guideTag, /\bdata-guide-debug="false"/);
  assert.match(guideTag, /\bhidden\b/);
  assert.match(guideTag, /\baria-hidden="true"/);
  assert.doesNotMatch(guideTag, /\brole=/);
  assert.doesNotMatch(guideTag, /\btabindex=/);
  const guideRule = ruleBody('.hood-collision-guide');
  assert.match(guideRule, /pointer-events:\s*none;/);
  assert.doesNotMatch(guideRule, /\bbackground(?:-[\w-]+)?:/);
  assert.match(css, /\.hood-collision-guide\[hidden\]\s*\{\s*display:\s*none;/);
  for (const id of [
    'hoodCollisionGuideUnderlay',
    'hoodCollisionGuideRails',
    'hoodCollisionGuideVolume',
    'hoodCollisionGuideFront',
    'hoodCollisionGuideSweep',
    'hoodCollisionGuideAxis',
    'hoodCollisionGuideNearRange',
    'hoodCollisionGuideFarRange',
    'hoodCollisionGuideWidth',
    'hoodCollisionGuideDimensions',
    'hoodCollisionGuideProjection'
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }

  assert.match(
    ruleBody('.hood-collision-guide-svg path'),
    /\bfill:\s*none;/,
    'Every guide path must keep the central camera image transparent'
  );
  assert.doesNotMatch(
    css,
    /\.hood-collision-guide(?:::before|::after)\s*\{/,
    'The full-viewport guide may not gain a filled pseudo-element'
  );

  const labelRules = ruleBodies('.hood-collision-guide-label');
  assert.ok(labelRules.length > 0, 'missing hood collision guide label rules');
  for (const body of labelRules) {
    assert.doesNotMatch(body, /\bbackground(?:-[\w-]+)?:/);
    assert.doesNotMatch(body, /\bborder(?:-[\w-]+)?:/);
    assert.doesNotMatch(body, /\bmin-width:/);
    assert.doesNotMatch(body, /\b(?:display:\s*grid|grid(?:-[\w-]+)?:)/);
    assert.doesNotMatch(body, /\b(?:-webkit-)?backdrop-filter:/);
    assert.doesNotMatch(body, /\bbox-shadow:/);
  }
  assert.match(
    ruleBody('html[data-mobile-cockpit="true"] .hood-collision-guide-label'),
    /\bdisplay:\s*none;/,
    'Touch controls already provide spatial references, so mobile must not add a text plate'
  );

  const rangeRule = ruleBody('.hood-collision-guide-range');
  assert.match(rangeRule, /\bdisplay:\s*none;/);
  assert.match(
    ruleBody('.hood-collision-guide[data-guide-debug="true"] .hood-collision-guide-range'),
    /\bdisplay:\s*block;/,
    'Range pills may return only in explicit model diagnostics'
  );
  const visibleRangeRules = styleRulesContaining('.hood-collision-guide-range')
    .filter((rule) => /\bdisplay:\s*(?!none\b)[\w-]+;/.test(rule.body));
  assert.ok(visibleRangeRules.length > 0, 'Debug mode must retain reviewable range calibration');
  assert.ok(
    visibleRangeRules.every((rule) => (
      rule.selector.includes('.hood-collision-guide[data-guide-debug="true"]')
    )),
    `Range pills escaped debug-only visibility: ${visibleRangeRules.map((rule) => rule.selector).join(', ')}`
  );

  const underlayRule = ruleBody('.hood-collision-guide-underlay');
  const underlayWidth = Number(
    underlayRule.match(/\bstroke-width:\s*([\d.]+);/)?.[1]
  );
  const underlayAlpha = Number(
    underlayRule.match(/\bstroke:\s*rgba\([^)]*,\s*([\d.]+)\);/)?.[1]
  );
  assert.ok(
    Number.isFinite(underlayWidth) && underlayWidth <= 3.5,
    `Hood underlay exceeds the 3.5px budget: ${underlayWidth}`
  );
  assert.ok(
    Number.isFinite(underlayAlpha) && underlayAlpha <= 0.55,
    `Hood underlay exceeds the 0.55 alpha budget: ${underlayAlpha}`
  );

  for (const selector of [
    '.hood-collision-guide-rails',
    '.hood-collision-guide-volume',
    '.hood-collision-guide-front',
    '.hood-collision-guide-sweep',
    '.hood-collision-guide-axis'
  ]) {
    const strokeWidths = numericPropertyValues(selector, 'stroke-width');
    assert.ok(strokeWidths.length > 0, `${selector} must publish a visible line weight`);
    assert.ok(
      strokeWidths.every((strokeWidth) => strokeWidth <= 2.5),
      `${selector} exceeds the low-occlusion 2.5px line budget: ${strokeWidths.join(', ')}`
    );
  }

  assert.doesNotMatch(
    css,
    /\.hood-collision-guide(?:-[\w-]+)?\s*\{[^}]*(?:animation|transition):/,
    'Collision guidance must remain calm and cannot pulse or blink while driving'
  );
});

test('damage feedback is assertive once, centre-clear, mobile-visible, and reduced-motion safe', () => {
  const impactTag = html.match(
    /<div\b[^>]*\bid="damageImpactFeedback"[^>]*><\/div>/
  )?.[0] || '';
  assert.match(impactTag, /\bclass="[^"]*\bdamage-impact-feedback\b[^"]*"/);
  assert.match(impactTag, /\bdata-active="false"/);
  assert.match(impactTag, /\baria-hidden="true"/);
  assert.doesNotMatch(impactTag, /\b(?:role|tabindex|aria-live)=/);

  const announcementTag = html.match(
    /<p\b[^>]*\bid="damageAnnouncement"[^>]*><\/p>/
  )?.[0] || '';
  assert.match(announcementTag, /\bclass="[^"]*\bsr-only\b[^"]*"/);
  assert.match(announcementTag, /\brole="status"/);
  assert.match(announcementTag, /\baria-live="assertive"/);
  assert.match(announcementTag, /\baria-atomic="true"/);
  assert.equal(
    (html.match(/\baria-live="assertive"/g) || []).length,
    1,
    'Accepted damage must own one assertive channel instead of several competing announcements'
  );

  const lifeMetric = elementMarkup('div', 'lifeMetric');
  const lifeMetricTag = lifeMetric.match(/<div\b[^>]*\bid="lifeMetric"[^>]*>/)?.[0] || '';
  assert.match(lifeMetricTag, /\bdata-damage-impact="false"/);
  assert.match(lifeMetricTag, /\bdata-invincible="false"/);
  assert.match(
    lifeMetric,
    /class="life-protection" aria-hidden="true">[\s\S]*?data-i18n="hud\.damage\.shield"/
  );

  const mobileLifeMetric = elementMarkup('span', 'mobileGlanceLifeMetric');
  const mobileLifeTag = mobileLifeMetric.match(
    /<span\b[^>]*\bid="mobileGlanceLifeMetric"[^>]*>/
  )?.[0] || '';
  assert.match(mobileLifeTag, /\bdata-damage-impact="false"/);
  assert.match(mobileLifeTag, /\bdata-invincible="false"/);
  assert.match(
    mobileLifeMetric,
    /class="mobile-life-shield"[^>]*aria-hidden="true"/,
    'The always-visible mobile life glance must retain a non-colour protection cue while details are folded'
  );
  assert.doesNotMatch(mobileLifeMetric, /\baria-live=/);

  const impactRule = ruleBody('.damage-impact-feedback');
  assert.match(impactRule, /position:\s*fixed;/);
  assert.match(impactRule, /inset:\s*0;/);
  assert.match(impactRule, /pointer-events:\s*none;/);
  assert.match(
    impactRule,
    /background:[\s\S]*?radial-gradient\([\s\S]*?transparent\s+0\s+(?:[2-6]\d)%[\s\S]*?rgba\(/,
    'The collision wash must keep the driving centre transparent and place colour at the viewport edge'
  );
  assert.match(
    css,
    /\.damage-impact-feedback\[data-active="true"\]\s*\{/,
    'The decorative viewport layer must activate only for an accepted damage event'
  );
  assert.match(
    css,
    /\.life-metric\[data-damage-impact="true"\]/,
    'The primary life card must receive an explicit accepted-impact cue'
  );
  assert.match(
    css,
    /\.life-metric\[data-invincible="true"\][\s\S]*?\.life-protection/,
    'The desktop life card must retain a steady protection cue after the impact ends'
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\] \.mobile-glance-life\[data-damage-impact="true"\]/,
    'A folded mobile cockpit must still expose the accepted-impact state'
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\] \.mobile-glance-life\[data-invincible="true"\][\s\S]*?\.mobile-life-shield/,
    'A folded mobile cockpit must still expose the steady protection state'
  );
  assert.match(ruleBody('html[data-mobile-cockpit="true"] .mobile-life-shield'), /position:\s*absolute;/);
  assert.match(
    html,
    /class="life-protection"\s+aria-hidden="true"[\s\S]*?id="lifeProtectionTime"/,
    'The visual countdown must remain quiet after the one accepted-impact announcement'
  );
  assert.match(
    css,
    /\.life-protection-glyph\s*\{[\s\S]*?conic-gradient\([\s\S]*?--life-protection-progress/,
    'Desktop protection must expose remaining time through a compact circular meter'
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\] \.mobile-life-shield\s*\{[\s\S]*?conic-gradient\([\s\S]*?--life-protection-progress/,
    'Folded mobile protection must use the same authoritative circular progress'
  );
  assert.match(html, /id="hoodCollisionGuide"[^>]*data-invincible="false"/);
  assert.match(
    css,
    /\.hood-collision-guide\[data-invincible="true"\] \.hood-collision-guide-front/,
    'Hood protection must reuse the centre-clear collider brackets instead of adding a lens-adjacent shell'
  );

  const reducedMotion = atRuleBodies('@media (prefers-reduced-motion: reduce)').join('\n');
  for (const selector of [
    '.damage-impact-feedback',
    '.life-metric[data-damage-impact="true"]',
    '.life-protection',
    '.mobile-glance-life[data-damage-impact="true"]',
    '.mobile-life-shield'
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      reducedMotion,
      new RegExp(`${escapedSelector}[\\s\\S]*?animation:\\s*none(?:\\s*!important)?;`),
      `${selector} must not flash or pulse when reduced motion is requested`
    );
  }
  assert.doesNotMatch(
    reducedMotion,
    /(?:damage-impact-feedback|life-protection|mobile-life-shield)[\s\S]*?animation-iteration-count:\s*infinite/,
    'Damage and protection cues cannot loop under reduced motion'
  );

  const forcedColors = atRuleBodies('@media (forced-colors: active)').join('\n');
  assert.match(forcedColors, /\.life-protection/);
  assert.match(forcedColors, /\.mobile-life-shield/);
  assert.match(forcedColors, /hood-collision-guide\[data-invincible="true"\]/);
});

test('life and candle instruments expose independent semantic state contracts', () => {
  const lifeMetric = elementMarkup('div', 'lifeMetric');
  const lifeMetricTag = lifeMetric.match(/<div\b[^>]*\bid="lifeMetric"[^>]*>/)?.[0] || '';
  assert.match(lifeMetricTag, /\bclass="[^"]*\blife-metric\b[^"]*"/);
  assert.match(lifeMetricTag, /\bdata-life-state="healthy"/);
  assert.match(lifeMetricTag, /\bdata-life-count="3"/);

  const livesTag = lifeMetric.match(/<strong\b[^>]*\bid="lives"[^>]*>/)?.[0] || '';
  assert.match(livesTag, /\baria-label="3 \/ 3 生命"/);
  assert.doesNotMatch(livesTag, /\baria-live=/);
  const heartsTag = lifeMetric.match(/<span\b[^>]*\bid="livesHearts"[^>]*>/)?.[0] || '';
  assert.match(heartsTag, /\baria-hidden="true"/);

  const lifeSlots = [...lifeMetric.matchAll(
    /<(?:span|i)\b([^>]*\bclass="[^"]*\blife-slot\b[^"]*"[^>]*)>/g
  )].map((match) => match[1]);
  assert.equal(lifeSlots.length, 3, 'Life HUD must keep exactly three stable visual slots');
  assert.deepEqual(
    lifeSlots.map((attributes) => attributes.match(/\bdata-life-slot="([123])"/)?.[1]),
    ['1', '2', '3']
  );
  assert.ok(
    lifeSlots.every((attributes) => /\bdata-life-active="true"/.test(attributes)),
    'All three initial life slots must be active'
  );
  const lifeIntegrityRail = lifeMetric.match(
    /<span\b[^>]*\bclass="[^"]*\blife-integrity-rail\b[^"]*"[^>]*>([\s\S]*?)<\/span>/
  )?.[1] || '';
  assert.equal(
    (lifeIntegrityRail.match(/<i\b/g) || []).length,
    3,
    'Lives must expose a discrete three-segment integrity rail'
  );

  const handlingMetricTag = html.match(/<div\b[^>]*\bid="handlingMetric"[^>]*>/)?.[0] || '';
  assert.match(handlingMetricTag, /\bdata-handling-level="base"/);
  assert.match(handlingMetricTag, /\bdata-handling-progress="0\.000000"/);
  assert.doesNotMatch(handlingMetricTag, /\bdata-life-(?:state|count)=/);
  assert.doesNotMatch(lifeMetricTag, /\bdata-handling-level=/);

  const mobileCandleMetric = elementMarkup('span', 'mobileGlanceCandlelightMetric');
  const mobileCandleTag = mobileCandleMetric.match(
    /<span\b[^>]*\bid="mobileGlanceCandlelightMetric"[^>]*>/
  )?.[0] || '';
  assert.match(mobileCandleTag, /\bdata-handling-level="base"/);
  assert.match(mobileCandleTag, /\bdata-handling-progress="0\.000000"/);
  assert.equal(
    (mobileCandleMetric.match(/<b\b/g) || []).length,
    1,
    'Mobile candlelight must expose one continuous growth rail'
  );

  const mobileLifeMetric = elementMarkup('span', 'mobileGlanceLifeMetric');
  const mobileLifeTag = mobileLifeMetric.match(
    /<span\b[^>]*\bid="mobileGlanceLifeMetric"[^>]*>/
  )?.[0] || '';
  assert.match(mobileLifeTag, /\bdata-life-state="healthy"/);
  assert.equal(
    (mobileLifeMetric.match(/<b\b/g) || []).length,
    3,
    'Mobile lives must expose three discrete integrity segments'
  );

  assert.match(ruleBody('.hud-primary .life-metric'), /--life-tone:/);
  for (const state of ['wounded', 'critical', 'depleted']) {
    assert.match(
      css,
      new RegExp(`\\.life-metric\\[data-life-state="${state}"\\]`),
      `Life HUD must publish a ${state} style`
    );
  }
  for (const level of ['responsive', 'agile', 'elite']) {
    assert.match(
      css,
      new RegExp(`\\.handling-metric\\[data-handling-level="${level}"\\]`),
      `Candle HUD must preserve its independent ${level} style`
    );
  }
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\] \.mobile-candle-rail > b\s*\{[^}]*transform:\s*scaleX\(var\(--mobile-candle-progress\)\);/
  );
  assert.match(
    css,
    /\.life-metric\[data-life-count="3"\] \.life-integrity-rail > i,[\s\S]*?\.life-metric\[data-life-count="1"\] \.life-integrity-rail > i:first-child\s*\{/
  );
  assert.match(
    css,
    /\.mobile-glance-life\[data-life-state="healthy"\] \.mobile-life-rail > b,[\s\S]*?\.mobile-glance-life\[data-life-state="critical"\] \.mobile-life-rail > b:first-child\s*\{/
  );

  /*
   * Cross-family selectors and fallbacks make inherited custom properties silently couple the two cards.
   * Strip comments, then audit every declaration block so future compact/high-contrast rules stay isolated too.
   */
  const semanticCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of semanticCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const body = match[2];
    const ownsLife = /(?:\.life-metric|\.life-slot|\.life-integrity-rail|\.mobile-glance-life|\.mobile-life-rail|#lives)\b/i.test(selector);
    const ownsCandle = /(?:\.handling-metric|\.handling-gauge|#handlingFill|#handlingValue|#expCount|\.mobile-glance-candlelight|\.mobile-candle-rail)\b/i.test(selector);
    assert.equal(
      ownsLife && ownsCandle,
      false,
      `Lives and candlelight cannot share a selector: ${selector}`
    );
    if (ownsLife) {
      assert.doesNotMatch(
        body,
        /--(?:candle|mobile-candle|handling)-/i,
        `Life-owned declarations cannot consume candle variables: ${selector}`
      );
    }
    if (ownsCandle) {
      assert.doesNotMatch(
        body,
        /--(?:life|mobile-life)-/i,
        `Candle-owned declarations cannot consume life variables: ${selector}`
      );
    }
  }

  const reducedMotion = [...css.matchAll(
    /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g
  )].map((match) => match[1]).join('\n');
  assert.match(reducedMotion, /\.life-integrity-rail > i/);
  assert.match(reducedMotion, /\.handling-metric #handlingFill/);
  assert.match(reducedMotion, /\.mobile-life-rail > b/);
  assert.match(reducedMotion, /\.mobile-candle-rail > b/);
});

test('candle growth meter separates count and capability while sharing one non-live progress contract', () => {
  assert.match(html, /id="handlingMetric"[^>]*data-handling-level="base"/);
  assert.match(html, /class="handling-stat handling-candle">[\s\S]*?<small>烛光<\/small>[\s\S]*?<strong id="expCount">0<\/strong>/);
  assert.match(html, /class="handling-stat handling-control">[\s\S]*?<small id="handlingLabel">成长<\/small>[\s\S]*?<strong id="handlingValue">55\.0%<\/strong>/);
  assert.doesNotMatch(html, /id="handlingLabel">烛光 \/ 操控<\/small>/);
  const meterTag = html.match(/<div\b[^>]*\bid="handlingGauge"[^>]*>/)?.[0] || '';
  assert.match(meterTag, /role="meter"/);
  assert.match(meterTag, /aria-labelledby="handlingLabel"/);
  assert.doesNotMatch(meterTag, /aria-labelledby="[^"]*handlingValue/);
  assert.match(meterTag, /aria-describedby="handlingHelp"/);
  assert.match(meterTag, /aria-valuemin="55"/);
  assert.match(meterTag, /aria-valuemax="100"/);
  assert.match(meterTag, /aria-valuenow="55\.0"/);
  assert.match(meterTag, /aria-valuetext="已收集 0 份烛光，成长能力 55\.0%"/);
  assert.doesNotMatch(meterTag, /aria-live=/);
  assert.match(html, /id="handlingFill"[^>]*aria-hidden="true"/);
  assert.match(html, /id="handlingHelp">收集烛光会以递减增益让飞船由暖金渐变至紫青，并提升横向操控、推进核心转速上限与升转速度；手动驾驶与自动领航共享同一成长能力。<\/p>/);
  const handlingRule = ruleBody('.metric.handling-metric');
  assert.match(handlingRule, /grid-column:\s*1 \/ 3;/);
  assert.match(handlingRule, /grid-row:\s*3;/);
  assert.match(handlingRule, /display:\s*grid;/);
  assert.match(ruleBody('.handling-summary'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(ruleBody('.handling-stat'), /display:\s*flex;/);
  assert.match(css, /#handlingValue\s*\{[^}]*color:\s*var\(--candle-capability-tone\);/);
  assert.match(css, /#handlingFill\s*\{[\s\S]*?transform:\s*scaleX\(0\.55\);/);
});

test('desktop and touch transmission decks expose independent MT/AT controls and exact working ranges', () => {
  const desktopGroup = html.match(/<div\b[^>]*\bid="transmissionSelector"[^>]*>/)?.[0] || '';
  const mobileGroup = html.match(/<div\b[^>]*\bid="mobileTransmissionSelector"[^>]*>/)?.[0] || '';
  assert.match(desktopGroup, /role="group"[^>]*aria-labelledby="gearSelectorLabel"[^>]*aria-describedby="gearHelp"/);
  assert.match(mobileGroup, /role="group"[^>]*aria-labelledby="mobileGearSelectorLabel"[^>]*aria-describedby="mobileGearHelp"/);
  for (const groupTag of [desktopGroup, mobileGroup]) {
    assert.match(groupTag, /data-current-gear="1"/);
    assert.match(groupTag, /data-transmission-mode="manual"/);
    assert.match(groupTag, /data-lugging="false"/);
    assert.match(groupTag, /data-stalled="false"/);
  }

  for (const [indicatorId, downId, upId] of [
    ['gearIndicator', 'gearDownBtn', 'gearUpBtn'],
    ['mobileGearIndicator', 'mobileGearDownBtn', 'mobileGearUpBtn']
  ]) {
    const indicatorTag = html.match(
      new RegExp('<output\\b[^>]*\\bid="' + indicatorId + '"[^>]*>')
    )?.[0] || '';
    assert.match(indicatorTag, /role="status"/);
    assert.match(indicatorTag, /aria-live="polite"/);
    assert.match(indicatorTag, /aria-atomic="true"/);
    assert.match(indicatorTag, /data-gear="1"/);
    assert.match(indicatorTag, /data-shift-state="engaged"/);
    assert.match(indicatorTag, /\bdata-i18n-ignore\b/);

    const downMarkup = elementMarkup('button', downId);
    const upMarkup = elementMarkup('button', upId);
    assert.match(downMarkup, /data-i18n-aria-label="gear\.downAria"/);
    assert.match(upMarkup, /data-i18n-aria-label="gear\.upAria"/);
    assert.match(downMarkup, /\bdisabled\b/);
    assert.doesNotMatch(upMarkup, /\bdisabled\b/);
  }

  assert.match(elementMarkup('button', 'gearDownBtn'), /aria-keyshortcuts="Q"/);
  assert.match(elementMarkup('button', 'gearUpBtn'), /aria-keyshortcuts="E"/);
  for (const [buttonId, stateId, ariaKey] of [
    ['transmissionModeBtn', 'transmissionModeState', 'gear.mode.manualAria'],
    ['mobileTransmissionModeBtn', 'mobileTransmissionModeState', 'gear.mode.mobileManualAria']
  ]) {
    const modeButton = elementMarkup('button', buttonId);
    assert.match(modeButton, /aria-pressed="false"/);
    assert.match(modeButton, /data-transmission-mode="manual"/);
    assert.match(modeButton, new RegExp(`data-i18n-aria-label="${ariaKey.replaceAll('.', '\\.')}"`));
    assert.match(html, new RegExp(`id="${stateId}"[^>]*>MT (?:手动|Manual)<`));
  }
  assert.match(elementMarkup('button', 'transmissionModeBtn'), /aria-keyshortcuts="T"/);

  for (const [rangeId, expected] of [
    ['gearOperatingRange', '1挡 · 推荐 0–90 · E→2 ≥70'],
    ['mobileGearOperatingRange', '1挡 · 推荐 0–90 · E→2 ≥70']
  ]) {
    const rangeTag = html.match(new RegExp(`<span\\b[^>]*\\bid="${rangeId}"[^>]*>`))?.[0] || '';
    assert.match(rangeTag, /\bdata-i18n-ignore\b/);
    assert.doesNotMatch(rangeTag, /aria-live=/);
    assert.match(html, new RegExp(`id="${rangeId}"[^>]*>${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  }
  assert.equal((html.match(/data-i18n-aria-label="gear\.rangeBandsAria"/g) || []).length, 2);
  assert.equal((html.match(/data-gear-band="1"/g) || []).length, 2);
  assert.equal((html.match(/data-gear-band="2"/g) || []).length, 2);
  assert.equal((html.match(/data-gear-band="3"/g) || []).length, 2);

  for (const state of ['engaged', 'shifting', 'rejected', 'lugging', 'stalled']) {
    assert.match(css, new RegExp('\\.gear-indicator\\[data-shift-state="' + state + '"\\]'));
    assert.match(css, new RegExp('\\.mobile-gear-indicator\\[data-shift-state="' + state + '"\\]'));
  }
  assert.match(css, /\.gear-shift-button:disabled,[\s\S]*?\.mobile-gear-shift-button:disabled/);
  assert.match(css, /\.gear-shift-button:focus-visible,[\s\S]*?\.mobile-gear-shift-button:focus-visible/);
  assert.match(
    css,
    /\.gear-shift-button\[hidden\],[\s\S]*?\.mobile-gear-shift-button\[hidden\]\s*\{\s*display:\s*none !important;/,
    'the authored grid display must not override semantic AT hiding'
  );
  assert.match(
    ruleBody('.transmission-selector[data-transmission-mode="automatic"]'),
    /grid-template-columns:\s*auto minmax\(36px,\s*auto\);/,
    'desktop AT must reclaim both manual 22px shift columns'
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\]\[data-drive-transmission-mode="automatic"\]\s*\{\s*--mobile-transmission-block-size:\s*96px;/,
    'the root authority must reclaim 32px from the portrait detail clearance under AT'
  );

  const mobileSelectorRule = ruleBody(
    'html[data-mobile-cockpit="true"][data-touch-capable="true"] .mobile-transmission-selector'
  );
  assert.match(mobileSelectorRule, /left:\s*50%;/);
  assert.match(mobileSelectorRule, /grid-template-columns:\s*44px minmax\(48px,\s*auto\) 44px;/);
  assert.match(mobileSelectorRule, /grid-template-rows:\s*44px 44px 20px;/);
  assert.match(mobileSelectorRule, /width:\s*min\(184px,/);
  assert.match(mobileSelectorRule, /height:\s*auto;/);
  const automaticMobileRule = styleRulesContaining(
    '.mobile-transmission-selector[data-transmission-mode="automatic"]'
  ).find((rule) => rule.selector.includes('[data-touch-capable="true"]'));
  assert.ok(automaticMobileRule, 'missing the all-layout mobile AT compact-grid authority');
  assert.match(automaticMobileRule.body, /grid-template-columns:\s*44px minmax\(72px,\s*1fr\);/);
  assert.match(automaticMobileRule.body, /grid-template-rows:\s*34px 20px 20px;/);
  assert.ok(
    css.indexOf('AT compact gearbox / AT \u7d27\u51d1\u6362\u6321\u5668') > css.lastIndexOf('@media'),
    'the AT compact grid must follow every phone, short-landscape, and iPad override'
  );
  const automaticMobileChildRule = (childClass) => styleRulesContaining(
    '.mobile-transmission-selector[data-transmission-mode="automatic"]'
  ).find((rule) => rule.selector.includes(childClass));
  const automaticModePlacement = automaticMobileChildRule('.mobile-transmission-mode-toggle');
  const automaticIndicatorPlacement = automaticMobileChildRule('.mobile-gear-indicator');
  const automaticRangePlacement = automaticMobileChildRule('.mobile-gear-operating-range');
  const automaticBandsPlacement = automaticMobileChildRule('.mobile-gear-range-bands');
  for (const [label, rule] of [
    ['mode', automaticModePlacement],
    ['indicator', automaticIndicatorPlacement],
    ['range', automaticRangePlacement],
    ['bands', automaticBandsPlacement]
  ]) assert.ok(rule, `missing mobile AT ${label} placement`);
  assert.match(automaticModePlacement.body, /grid-column:\s*1;[\s\S]*?grid-row:\s*1 \/ 3;/);
  assert.match(automaticIndicatorPlacement.body, /grid-column:\s*2;[\s\S]*?grid-row:\s*1;/);
  assert.match(automaticRangePlacement.body, /grid-column:\s*2;[\s\S]*?grid-row:\s*2;/);
  assert.match(automaticBandsPlacement.body, /grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*3;/);
  const mobileShiftTarget = ruleBody('html[data-mobile-cockpit="true"] .mobile-gear-shift-button');
  assert.match(mobileShiftTarget, /min-width:\s*44px;/);
  assert.match(mobileShiftTarget, /min-height:\s*44px;/);
  const mobileModeTarget = ruleBody('html[data-mobile-cockpit="true"] .mobile-transmission-mode-toggle');
  assert.match(mobileModeTarget, /min-width:\s*44px;/);
  assert.match(mobileModeTarget, /min-height:\s*44px;/);
  assert.match(css, /\.transmission-range-panel\[data-lugging="true"\] \.gear-operating-range,/);
  assert.match(css, /\.mobile-transmission-selector\[data-lugging="true"\] \.mobile-gear-operating-range/);
  assert.match(css, /\.transmission-selector\[data-stalled="true"\] \.gear-indicator,/);
  assert.match(css, /\.mobile-transmission-selector\[data-stalled="true"\] \.mobile-gear-indicator/);
  assert.match(css, /\.metric\.speedometer-metric:has\(\.transmission-selector\[data-lugging="true"\]\)/);
  assert.match(css, /\.metric\.speedometer-metric:has\(\.transmission-selector\[data-stalled="true"\]\)/);
  assert.match(css, /#transmissionSelector\[data-lugging="true"\] #gearDownBtn:not\(:disabled\)/);
  assert.match(css, /#transmissionSelector\[data-stalled="true"\] #gearDownBtn:not\(:disabled\)/);
  assert.match(css, /#mobileTransmissionSelector\[data-lugging="true"\] #mobileGearDownBtn:not\(:disabled\)/);
  assert.match(css, /#mobileTransmissionSelector\[data-stalled="true"\] #mobileGearDownBtn:not\(:disabled\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.transmission-mode-toggle,[\s\S]*?\.mobile-transmission-mode-toggle[\s\S]*?transition:\s*none !important;/);
  const drivetrainReducedMotion = atRuleBodies('@media (prefers-reduced-motion: reduce)')
    .find((body) => body.includes('data-alert-kind="stalled"')) || '';
  assert.match(drivetrainReducedMotion, /data-alert-kind="lugging"/);
  assert.match(drivetrainReducedMotion, /animation:\s*none !important;/);
  assert.match(drivetrainReducedMotion, /transition:\s*none !important;/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.transmission-mode-toggle,[\s\S]*?\.mobile-transmission-mode-toggle/);
  const drivetrainForcedColors = atRuleBodies('@media (forced-colors: active)')
    .find((body) => body.includes('data-alert-kind="stalled"')) || '';
  assert.match(drivetrainForcedColors, /data-alert-kind="lugging"[\s\S]*?border:\s*2px dashed Highlight;/);
  assert.match(drivetrainForcedColors, /data-alert-kind="stalled"[\s\S]*?border:\s*3px double Mark;/);
});

test('central speed guidance can become one steady high-gear safety alert', () => {
  const alertTag = html.match(/<div\b[^>]*\bid="speedLimitAlert"[^>]*>/)?.[0] || '';
  assert.match(alertTag, /data-alert-kind="speed"/);
  assert.match(alertTag, /role="status"/);
  assert.match(alertTag, /aria-live="polite"/);
  assert.match(alertTag, /aria-atomic="true"/);
  assert.match(alertTag, /\bhidden\b/);
  assert.match(alertTag, /\binert\b/);
  assert.match(
    html,
    /<small id="speedLimitAlertLabel">前方限速<\/small>/
  );
  for (const kind of ['lugging', 'stalled']) {
    const selector = `.speed-limit-alert[data-alert-kind="${kind}"]`;
    const stateRules = styleRulesContaining(selector);
    assert.ok(stateRules.some((rule) => /border-color:/.test(rule.body)));
    assert.ok(stateRules.some((rule) => /background:/.test(rule.body)));
    assert.ok(stateRules.some((rule) => /box-shadow:/.test(rule.body)));
  }
  const safetyAlertShell = [
    '.speed-limit-alert[data-alert-kind="lugging"]',
    '.speed-limit-alert[data-alert-kind="stalled"]'
  ];
  assert.ok(
    styleRulesContaining('.speed-limit-alert[data-alert-kind="lugging"]')
      .some((rule) => safetyAlertShell.every((selector) => rule.selector.includes(selector))
        && /animation:\s*none;/.test(rule.body)),
    'lugging and stalled alerts must share a non-flashing steady-state contract'
  );
  assert.match(
    css,
    /html\[data-mobile-cockpit="true"\] \.speed-limit-alert\[data-alert-kind="lugging"\],[\s\S]*?data-alert-kind="stalled"\][\s\S]*?display:\s*grid !important;/
  );
  assert.match(css, /\.mobile-route-cue\[data-alert-kind="lugging"\]/);
  assert.match(css, /\.mobile-route-cue\[data-alert-kind="stalled"\]/);
  assert.ok(
    ruleBodies('.speed-limit-alert[hidden]').some((body) => /display:\s*none !important;/.test(body)),
    'the safety presentation must not override its hidden and inert lifecycle on mobile'
  );
});

test('speedometer is the full-width primary instrument with one exact digital reading', () => {
  assert.match(html, /id="speedometer"[^>]*data-testid="speedometer"[^>]*role="group"[^>]*aria-labelledby="speedometerLabel speed"[^>]*aria-describedby="speedometerScaleHelp"/);
  assert.match(html, /id="speedometer"[^>]*data-target-kmh="120"[^>]*data-target-progress="0\.790000"[^>]*data-scale-mode="segmented-target"/);
  assert.match(html, /<svg class="speedometer-dial"[^>]*preserveAspectRatio="xMidYMid meet"[^>]*aria-hidden="true">/);
  assert.match(html, /id="speedometerValueArc"[^>]*d="M 10 52"/);
  assert.match(html, /class="speedometer-target-tick"[^>]*d="M 95\.927 22\.580 L 89\.606 27\.484"/);
  assert.match(html, /id="speedometerNeedle"[^>]*x2="58"[^>]*y2="4"[^>]*transform="rotate\(-90 58 52\)"/);
  assert.match(html, /id="speed"[^>]*aria-label="0 km\/h"/);
  assert.match(html, /id="speedValue">0<\/span>/);
  assert.match(html, /id="speedometerTarget">120<\/b>/);
  assert.match(html, /id="speedometerScaleHelp">金色刻度标记 P 领航的 120 km\/h 普通巡航参考；P 关闭且 M 开启时持续满油门，不受该参考限制；数字始终显示真实速度。<\/p>/);
  assert.doesNotMatch(html, /id="speed"[^>]*aria-live=/);
  const speedometerRule = ruleBody('.metric.speedometer-metric');
  assert.match(speedometerRule, /grid-column:\s*1 \/ -1;/);
  assert.match(speedometerRule, /grid-row:\s*1;/);
  assert.match(speedometerRule, /min-height:\s*92px;/);
  assert.match(css, /\.speedometer-value-arc\s*\{[\s\S]*?stroke-linecap:\s*butt;/);
  assert.match(css, /\.speedometer-value-arc\s*\{[^}]*filter:\s*none;/);
  assert.match(css, /\.speedometer-needle\s*\{[^}]*filter:\s*none;/);
  assert.doesNotMatch(ruleBody('.speedometer-value-arc'), /stroke-dasharray/);
  assert.match(css, /\.speedometer-ticks \.speedometer-target-tick\s*\{[\s\S]*?stroke:\s*rgba\(217, 200, 139, 0\.94\);/);
  assert.match(css, /\.metric strong\.speedometer-readout\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
});

test('propulsion CORE stays inside the speedometer with one non-live RPM contract', () => {
  const coreTag = html.match(/<div\b[^>]*\bid="propulsionCore"[^>]*>/)?.[0] || '';
  assert.match(coreTag, /data-propulsion-state="idle"/);
  assert.match(coreTag, /role="group"/);
  assert.match(coreTag, /aria-labelledby="propulsionCoreLabel"/);
  assert.match(coreTag, /aria-describedby="propulsionCoreHelp"/);
  assert.doesNotMatch(coreTag, /aria-live=/);

  const meterTag = html.match(/<div\b[^>]*\bid="propulsionCoreRpmMeter"[^>]*>/)?.[0] || '';
  assert.match(meterTag, /role="meter"/);
  assert.match(meterTag, /aria-labelledby="propulsionCoreLabel propulsionCoreRpmLabel"/);
  assert.match(meterTag, /aria-describedby="propulsionCoreHelp"/);
  assert.match(meterTag, /aria-valuemin="1800"/);
  assert.match(meterTag, /aria-valuemax="12000"/);
  assert.match(meterTag, /aria-valuenow="1800"/);
  assert.match(meterTag, /aria-valuetext="推进核心转速 1,800 转\/分"/);
  assert.doesNotMatch(meterTag, /aria-live=/);

  assert.match(html, /id="propulsionCoreRpmFill"[^>]*aria-hidden="true"/);
  assert.match(html, /id="propulsionCoreRpmNeedle"[^>]*aria-hidden="true"/);
  assert.match(html, /id="propulsionCoreRpmValue">1,800<\/span>/);
  assert.match(html, /id="propulsionThrustValue">0%<\/b>/);
  assert.match(html, /id="propulsionAccelerationValue">\+0\.0<\/span><em>m\/s²<\/em>/);
  assert.match(html, /id="propulsionCoreHelp"[^>]*data-i18n="hud\.propulsion\.help"/);

  const speedometerBodyIndex = html.indexOf('<div class="speedometer-body">');
  const coreIndex = html.indexOf('id="propulsionCore"');
  const speedometerHelpIndex = html.indexOf('id="speedometerScaleHelp"');
  assert.ok(
    speedometerBodyIndex >= 0
      && speedometerBodyIndex < coreIndex
      && coreIndex < speedometerHelpIndex,
    'propulsion CORE must remain inside the existing speedometer body instead of adding a HUD-grid row'
  );
  assert.doesNotMatch(html.slice(coreIndex, speedometerHelpIndex), /aria-live=/);

  const speedometerBodyRule = ruleBody('.speedometer-body');
  assert.match(
    speedometerBodyRule,
    /grid-template-columns:\s*minmax\(82px,\s*1fr\)\s+minmax\(80px,\s*auto\)\s+minmax\(118px,\s*0\.9fr\);/
  );
  assert.match(ruleBody('.propulsion-core'), /display:\s*grid;/);
  assert.match(ruleBody('.propulsion-core[data-propulsion-state="lugging"]'), /--propulsion-core-tone:\s*#ffd078;/);
  assert.match(ruleBody('.propulsion-core[data-propulsion-state="stalled"]'), /--propulsion-core-tone:\s*#ff9a68;/);
  assert.match(
    ruleBody('.propulsion-core[data-propulsion-state="creep"]'),
    /--propulsion-core-tone:\s*var\(--lime\);/
  );
  assert.match(ruleBody('.propulsion-core-rpm-meter'), /position:\s*relative;[\s\S]*?height:\s*7px;/);
  const coreRules = [...css.matchAll(/\.propulsion-core\s*\{([^}]+)\}/g)].map((match) => match[1]);
  assert.ok(
    coreRules.some((body) => (
      /grid-column:\s*1 \/ -1;/.test(body)
        && /grid-row:\s*2;/.test(body)
        && /border-top:\s*1px solid var\(--cockpit-edge-soft\);/.test(body)
    )),
    'compact propulsion telemetry must wrap inside the speedometer body'
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?#propulsionCoreRpmFill,[\s\S]*?#propulsionCoreRpmNeedle[\s\S]*?transition:\s*none !important;/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.propulsion-core-rpm-meter[\s\S]*?#propulsionCoreRpmFill,[\s\S]*?#propulsionCoreRpmNeedle[\s\S]*?background:\s*Highlight;/);
});

test('launch weather classification uses three native radios with visible state and focus', () => {
  assert.match(html, /<fieldset[^>]*id="weatherModePicker"[^>]*aria-describedby="weatherModeHelp"/);
  assert.match(html, /<legend>天气分类 <small>选择本局<\/small><\/legend>/);
  const radios = [...html.matchAll(/<input\s+id="weatherMode(?:Dry|Severe|Mixed)"\s+type="radio"\s+name="weatherMode"\s+value="(dry|severe|mixed)"(\s+checked)?>/g)];
  assert.equal(radios.length, 3);
  assert.deepEqual(radios.map((match) => match[1]), ['dry', 'severe', 'mixed']);
  assert.equal(radios.filter((match) => Boolean(match[2])).length, 1);
  assert.equal(radios.find((match) => Boolean(match[2]))?.[1], 'mixed');
  for (const suffix of ['Dry', 'Severe', 'Mixed']) {
    assert.match(html, new RegExp(`<label[^>]*for="weatherMode${suffix}"`));
  }
  assert.match(html, /id="weatherModeHelp"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(css, /\.weather-mode-option\s*\{[\s\S]*?min-height:\s*68px;/);
  assert.match(css, /\.weather-mode-option:has\(input:checked\)\s*\{/);
  assert.match(css, /\.weather-mode-option:has\(input:focus-visible\)\s*\{[\s\S]*?outline:/);
  assert.match(css, /\.weather-mode-picker:disabled \.weather-mode-option\s*\{/);
});

test('render quality uses one labelled 44px native selector with medium as the default', () => {
  assert.match(html, /id="qualityModePicker"[^>]*data-testid="quality-mode-picker"/);
  assert.match(html, /<label for="qualityModeSelect">[\s\S]*?渲染画质[\s\S]*?开局或暂停时可切换/);
  const options = [...html.matchAll(/<option value="(low|medium|high)"( selected)?>/g)];
  assert.deepEqual(options.map((match) => match[1]), ['low', 'medium', 'high']);
  assert.equal(options.filter((match) => Boolean(match[2])).length, 1);
  assert.equal(options.find((match) => Boolean(match[2]))?.[1], 'medium');
  assert.match(html, /id="qualityModeSelect"[^>]*aria-describedby="qualityModeHelp"/);
  assert.match(html, /id="qualityModeHelp"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(css, /\.quality-mode-picker select\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /\.quality-mode-picker select:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(css, /\.quality-mode-picker select:disabled\s*\{/);
  assert.match(
    css,
    /@media \(max-width:\s*340px\) and \(max-height:\s*620px\) and \(orientation:\s*portrait\)\s*\{[\s\S]*?#overlay \.quality-mode-picker\s*\{\s*display:\s*block;/
  );
});

test('manual weather test mode is default-hidden and remains labelled when explicitly enabled', () => {
  assert.match(html, /<fieldset[^>]*id="manualWeatherTestPanel"[^>]*aria-describedby="manualWeatherTestStatus"[^>]*hidden>/);
  assert.match(html, /<legend><span>人工天气测试<\/span><small>纯视觉<\/small><\/legend>/);
  assert.match(html, /id="manualWeatherSelect"[^>]*aria-label="人工测试即时天气"/);
  assert.match(html, /<option value="">自动生命周期<\/option>/);
  assert.match(html, /id="manualWeatherTestStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(css, /\.manual-weather-test\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(css, /\.manual-weather-test\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /\.manual-weather-test select:focus-visible\s*\{[\s\S]*?outline:/);
});

test('startup loading is an honest polite readiness boundary on every viewport and access mode', () => {
  const loadingMarkup = elementMarkup('section', 'startupLoading');
  const loadingTag = loadingMarkup.match(/^<section\b[^>]*>/)?.[0] || '';
  const statusMarkup = elementMarkup('p', 'startupLoadingStatus', loadingMarkup);
  const statusTag = statusMarkup.match(/^<p\b[^>]*>/)?.[0] || '';
  const progressMarkup = elementMarkup('div', 'startupLoadingProgress', loadingMarkup);
  const progressTag = progressMarkup.match(/^<div\b[^>]*>/)?.[0] || '';
  const tipMarkup = elementMarkup('aside', 'startupLoadingTip', loadingMarkup);
  const tipTag = tipMarkup.match(/^<aside\b[^>]*>/)?.[0] || '';
  const launchTag = html.match(/<div class="overlay" id="overlay"[^>]*>/)?.[0] || '';

  assert.match(html, /<body class="startup-loading-open"[^>]*>/);
  assert.match(loadingTag, /\bdata-loading-stage="modules"/);
  assert.doesNotMatch(loadingTag, /\brole="status"|\baria-live=|\baria-atomic=/);
  assert.match(loadingTag, /\baria-busy="true"/);
  assert.match(loadingTag, /\baria-labelledby="startupLoadingTitle"/);
  assert.match(loadingTag, /\baria-describedby="startupLoadingNote"/);
  assert.match(statusTag, /\brole="status"/);
  assert.match(statusTag, /\baria-live="polite"/);
  assert.match(statusTag, /\baria-atomic="true"/);
  assert.match(progressTag, /\brole="progressbar"/);
  assert.match(progressTag, /\bdata-i18n-aria-label="startup\.loading\.progressAria"/);
  assert.match(progressTag, /\baria-valuetext="正在载入飞行系统与场景模块……"/);
  assert.doesNotMatch(progressTag, /\baria-value(?:now|min|max)=/);
  assert.match(tipTag, /\bdata-tip-id="steering"/);
  assert.match(tipTag, /\brole="note"/);
  assert.match(tipTag, /\baria-live="off"/);
  assert.doesNotMatch(tipMarkup, /\btabindex=|<(?:button|a)\b/);
  assert.equal(
    [...progressMarkup.matchAll(/<i><\/i>/g)].length,
    5,
    'The five visual checkpoints must map to measured startup work rather than a numeric guess'
  );
  assert.doesNotMatch(loadingMarkup, /\d+\s*%|预计[^<]*(?:秒|分钟)/u);

  assert.match(launchTag, /\baria-hidden="true"/);
  assert.match(launchTag, /\bhidden\b/);
  assert.match(launchTag, /\binert\b/);
  assert.match(launchTag, /\bstyle="display:none"/);
  assert.doesNotMatch(html.match(/<body\b[^>]*>/)?.[0] || '', /\blaunch-overlay-open\b/);

  const loadingLayer = ruleBody('.startup-loading');
  const loadingCard = ruleBody('.startup-loading-card');
  const loadingZ = Number(loadingLayer.match(/z-index:\s*(\d+)/)?.[1]);
  const confirmationZ = Number(ruleBody('.pause-restart-confirmation').match(/z-index:\s*(\d+)/)?.[1]);
  const updateZ = Number(ruleBody('.update-notice').match(/z-index:\s*(\d+)/)?.[1]);
  const fatalZ = Number(ruleBody('.startup-error').match(/z-index:\s*(\d+)/)?.[1]);
  assert.deepEqual([confirmationZ, loadingZ, updateZ, fatalZ], [12, 80, 90, 100]);
  assert.match(loadingLayer, /position:\s*fixed;/);
  assert.match(loadingLayer, /min-height:\s*100vh;[\s\S]*?min-height:\s*100dvh;/);
  for (const safeEdge of ['top', 'right', 'bottom', 'left']) {
    assert.match(loadingLayer, new RegExp(`var\\(--safe-${safeEdge}\\)`));
  }
  assert.match(loadingLayer, /pointer-events:\s*none;/);
  assert.match(loadingLayer, /touch-action:\s*none;/);
  assert.match(loadingCard, /width:\s*min\(560px,\s*100%\);/);
  assert.doesNotMatch(
    `${loadingLayer}\n${loadingCard}`,
    /backdrop-filter:/,
    'Startup must not add GPU blur work before the graphics readiness boundary'
  );

  const compactPortrait = atRuleBodies('@media (max-width: 420px)').join('\n');
  assert.match(compactPortrait, /\.startup-loading\s*\{[\s\S]*?var\(--safe-top\)/);
  assert.match(compactPortrait, /\.startup-loading-card\s*\{[\s\S]*?padding:\s*30px 22px;/);
  assert.match(compactPortrait, /\.startup-loading-tip\s*\{[\s\S]*?min-height:/);
  const shortLandscape = atRuleBodies(
    '@media (max-height: 560px) and (orientation: landscape)'
  ).join('\n');
  assert.match(shortLandscape, /\.startup-loading\s*\{[\s\S]*?var\(--safe-left\)/);
  assert.match(
    shortLandscape,
    /\.startup-loading-card\s*\{[\s\S]*?grid-template-columns:\s*74px minmax\(0,\s*1fr\);/
  );
  assert.match(shortLandscape, /\.startup-loading-tip\s*\{[\s\S]*?min-height:/);

  const reducedMotion = atRuleBodies('@media (prefers-reduced-motion: reduce)').join('\n');
  assert.match(
    reducedMotion,
    /\.startup-loading-orbit i,[\s\S]*?\.startup-loading-progress i::after[\s\S]*?animation:\s*none !important;[\s\S]*?transition:\s*none !important;/
  );
  assert.match(reducedMotion, /\.startup-loading-tip,[\s\S]*?transition:\s*none !important;/);
  const forcedColors = atRuleBodies('@media (forced-colors: active)').join('\n');
  assert.match(
    forcedColors,
    /\.startup-loading,[\s\S]*?\.startup-loading-card[\s\S]*?color:\s*CanvasText;[\s\S]*?background:\s*Canvas;/
  );
  assert.match(
    forcedColors,
    /\.startup-loading-progress i::after,[\s\S]*?\.startup-loading-orbit i[\s\S]*?background:\s*Highlight;/
  );
  assert.match(
    forcedColors,
    /\.startup-loading-tip,[\s\S]*?color:\s*CanvasText;[\s\S]*?background:\s*Canvas;/
  );
});

test('paused restart confirmation keeps the safe action first and remains below recovery surfaces', () => {
  const dialog = elementMarkup('section', 'pauseRestartConfirmation');
  assert.match(
    dialog,
    /role="alertdialog"[^>]*aria-modal="true"[^>]*aria-labelledby="pauseRestartConfirmationTitle"[^>]*aria-describedby="pauseRestartConfirmationDescription"[^>]*aria-hidden="true"[^>]*hidden/
  );
  assert.ok(dialog.indexOf('id="pauseRestartCancelBtn"') < dialog.indexOf('id="pauseRestartConfirmBtn"'));
  assert.match(dialog, /id="pauseRestartCancelBtn"[^>]*type="button"/);
  assert.match(dialog, /id="pauseRestartConfirmBtn"[^>]*type="button"/);
  assert.match(
    html,
    /id="pauseRestartBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="pauseRestartConfirmation"[^>]*aria-expanded="false"/
  );
  const confirmationLayer = ruleBody('.pause-restart-confirmation');
  const confirmationActions = ruleBody('.pause-restart-confirmation-actions button');
  const confirmationZ = Number(confirmationLayer.match(/z-index:\s*(\d+)/)?.[1]);
  const updateZ = Number(ruleBody('.update-notice').match(/z-index:\s*(\d+)/)?.[1]);
  const fatalZ = Number(ruleBody('.startup-error').match(/z-index:\s*(\d+)/)?.[1]);
  assert.equal(confirmationZ, 12);
  assert.ok(confirmationZ < updateZ && updateZ < fatalZ);
  assert.match(confirmationLayer, /touch-action:\s*pan-x pan-y pinch-zoom;/);
  assert.match(ruleBody('.pause-restart-confirmation-card'), /max-height:[\s\S]*?overflow:\s*auto;/);
  assert.match(confirmationActions, /min-height:\s*48px;/);
  assert.match(css, /\.pause-restart-confirmation button:focus-visible\s*\{[\s\S]*?outline:\s*3px/);
  assert.match(css, /@media \(max-width:\s*480px\)\s*\{[\s\S]*?\.pause-restart-confirmation-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('update notice remains a reversible accessible dialog below fatal recovery', () => {
  assert.match(html, /id="releaseStatus"[^>]*type="application\/json"/);
  assert.match(html, /id="updateNotice"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="updateNoticeTitle"[^>]*aria-describedby="updateNoticeMessage updateNoticeStatus"[^>]*aria-hidden="true"[^>]*hidden/);
  assert.match(html, /id="updateNoticeStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="updateContinueBtn"[^>]*type="button"[^>]*disabled/);
  assert.match(html, /id="updateReloadBtn"[^>]*type="button"/);
  assert.match(css, /\.update-notice\s*\{[\s\S]*?z-index:\s*90;[\s\S]*?touch-action:\s*pan-x pan-y pinch-zoom;/);
  assert.match(css, /\.update-notice-card\s*\{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow:\s*auto;/);
  assert.match(css, /\.startup-error\s*\{[\s\S]*?z-index:\s*100;/);
  assert.match(css, /\.update-notice button:focus-visible/);
});
