import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Resolve authored contracts from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = new URL('../../', import.meta.url);
const source = readFileSync(
  new URL('src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js', PROJECT_ROOT),
  'utf8'
);
const worldSource = readFileSync(
  new URL('src/world/Neon_Autopilot_HighSpeed_DroneHeat.world.js', PROJECT_ROOT),
  'utf8'
);
const weatherSource = readFileSync(
  new URL('src/weather/Neon_Autopilot_HighSpeed_DroneHeat.weather.js', PROJECT_ROOT),
  'utf8'
);
const surfaceWeatherSource = readFileSync(
  new URL('src/weather/Neon_Autopilot_HighSpeed_DroneHeat.surface-weather.js', PROJECT_ROOT),
  'utf8'
);
const lightingSource = readFileSync(
  new URL('src/rendering/Neon_Autopilot_HighSpeed_DroneHeat.lighting.js', PROJECT_ROOT),
  'utf8'
);
const cloverleafSource = readFileSync(
  new URL('src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf.js', PROJECT_ROOT),
  'utf8'
);
const cloverleafTilePoolSource = readFileSync(
  new URL('src/navigation/Neon_Autopilot_HighSpeed_DroneHeat.cloverleaf-tiles.js', PROJECT_ROOT),
  'utf8'
);
const shipSource = readFileSync(
  new URL('src/entities/Neon_Autopilot_HighSpeed_DroneHeat.ship.js', PROJECT_ROOT),
  'utf8'
);
const configSource = readFileSync(
  new URL('src/config/Neon_Autopilot_HighSpeed_DroneHeat.config.js', PROJECT_ROOT),
  'utf8'
);
const require = createRequire(import.meta.url);
const { MESSAGES: I18N_MESSAGES } = require(fileURLToPath(
  new URL('src/ui/Neon_Autopilot_HighSpeed_DroneHeat.i18n.js', PROJECT_ROOT)
));
const I18N_SOURCE_KEYS = new Map();
for (const catalog of Object.values(I18N_MESSAGES)) {
  for (const [key, value] of Object.entries(catalog)) {
    if (!value.includes('{') && !I18N_SOURCE_KEYS.has(value)) I18N_SOURCE_KEYS.set(value, key);
  }
}
let testLanguage = 'zh-CN';

function testInterpolate(template, parameters = {}) {
  return String(template).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => (
    Object.hasOwn(parameters, name) ? String(parameters[name]) : token
  ));
}

function uiText(key, parameters = {}, fallback = key) {
  return testInterpolate(I18N_MESSAGES[testLanguage][key] ?? fallback, parameters);
}

function uiSource(value, parameters = {}) {
  const sourceValue = String(value ?? '');
  const key = I18N_SOURCE_KEYS.get(sourceValue);
  return key ? uiText(key, parameters) : testInterpolate(sourceValue, parameters);
}

function uiNumber(value, options = {}) {
  return new Intl.NumberFormat(testLanguage === 'zh-CN' ? 'zh-CN' : 'en-US', options).format(Number(value));
}

function uiMeters(value, options = {}) {
  return uiText('common.meters', { value: uiNumber(value, options) });
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

/** Isolate one authored function so adjacent presentation projectors cannot make cross-write checks pass or fail. */
function functionSource(functionName) {
  const signature = `function ${functionName}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${functionName}`);
  // Match the complete parameter list first because destructured defaults may contain braces before the body.
  const parameterStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < source.length; index++) {
    if (source[index] === '(') parameterDepth++;
    else if (source[index] === ')') {
      parameterDepth--;
      if (parameterDepth === 0) {
        parameterEnd = index;
        break;
      }
    }
  }
  assert.notEqual(parameterEnd, -1, `unterminated function parameters: ${functionName}`);
  const bodyStart = source.indexOf('{', parameterEnd + 1);
  assert.notEqual(bodyStart, -1, `missing function body: ${functionName}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function body: ${functionName}`);
}

test('main runtime uses categorized startup and safe storage boundaries', () => {
  assert.match(source, /NeonDependencyError/);
  assert.match(source, /NeonRenderingError/);
  assert.match(source, /startup\.readFiniteNonNegativeNumber\('cc-curve-best', 0\)/);
  assert.match(source, /startup\.writeString\('cc-curve-best', finalScore\)/);
  assert.doesNotMatch(source, /\blocalStorage\b/);
});

test('idle creep fails closed at startup and remains independently observable through HUD and diagnostics', () => {
  assert.match(
    source,
    /const idleCreepBootstrapContract = window\.NeonGameplayCore\s*\?\.IDLE_CREEP_CONTRACT;/
  );
  const dependency = sourceBetween(
    'const idleCreepContract = requireDependency(',
    'const driveGearContract = requireDependency('
  );
  assert.match(dependency, /gameplayCore\.IDLE_CREEP_CONTRACT/);
  assert.match(dependency, /typeof gameplayCore\.resolveIdleCreepThrustNormalized === 'function'/);
  assert.match(
    dependency,
    /gameplayCore\.PROPULSION_CORE_CONTRACT\?\.idleCreep\s*=== gameplayCore\.IDLE_CREEP_CONTRACT/
  );
  assert.match(dependency, /'Neon first-gear idle-creep contract'/);
  assert.match(source, /idleCreepContract === idleCreepBootstrapContract/);

  assert.match(
    source,
    /propulsionThrustNormalized:\s*0,\s*idleCreepEnabled:\s*false,\s*idleCreepConnected:\s*false,\s*idleCreepActive:\s*false,\s*idleCreepThrustNormalized:\s*0,/
  );
  const reset = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  assert.match(
    reset,
    /state\.propulsionThrustNormalized = 0;\s*state\.idleCreepEnabled = false;\s*state\.idleCreepConnected = false;\s*state\.idleCreepActive = false;\s*state\.idleCreepThrustNormalized = 0;/
  );

  const longitudinal = sourceBetween(
    'function updateLongitudinalControl(dt)',
    'const autoPlannerTargetHz'
  );
  assert.match(longitudinal, /idleCreepEnabled:\s*state\.grounded/);
  assert.match(longitudinal, /grounded:\s*state\.grounded/);
  for (const field of [
    'idleCreepEnabled',
    'idleCreepConnected',
    'idleCreepActive',
    'idleCreepThrustNormalized'
  ]) {
    assert.match(
      longitudinal,
      new RegExp(`state\\.${field} = propulsionStep\\.${field}`),
      `${field} must be copied from the authoritative core instead of inferred from throttle or speed`
    );
  }

  const propulsionState = functionSource('resolvePropulsionCoreState');
  assert.match(propulsionState, /if \(state\.idleCreepActive\) return 'creep'/);
  const propulsionMeter = sourceBetween(
    'const propulsionCoreStateIds = Object.freeze([',
    'let displayedHandlingCandleCount'
  );
  assert.match(propulsionMeter, /'idle',\s*'creep',/);
  assert.match(propulsionMeter, /propulsionCoreEl\.dataset\.idleCreepConnected = String\(state\.idleCreepConnected\)/);
  assert.match(propulsionMeter, /propulsionCoreEl\.dataset\.idleCreepActive = String\(state\.idleCreepActive\)/);
  assert.match(
    propulsionMeter,
    /propulsionCoreEl\.dataset\.idleCreepThrustNormalized\s*=\s*state\.idleCreepThrustNormalized\.toFixed\(6\)/
  );

  assert.match(source, /idleCreepContract,\s*idleCreepEnabled:\s*state\.idleCreepEnabled/);
  assert.match(source, /idleCreepConnected:\s*state\.idleCreepConnected/);
  assert.match(source, /idleCreepActive:\s*state\.idleCreepActive/);
  assert.match(source, /idleCreepThrustNormalized:\s*state\.idleCreepThrustNormalized/);
  assert.match(source, /shipExhaustEnergy:\s*state\.shipExhaustEnergy/);
  assert.match(
    source,
    /shipExhaustEnergy:\s*Number\(state\.shipExhaustEnergy\.toFixed\(3\)\)/
  );
});

test('runtime language changes re-project every dynamic surface without mutating gameplay authority', () => {
  assert.match(source, /const i18n = requireDependency\(window\.NeonI18n, 'Neon i18n module'\)/);
  assert.match(source, /typeof i18n\.t === 'function'/);
  assert.match(source, /typeof i18n\.translateSource === 'function'/);
  assert.match(source, /typeof i18n\.formatNumber === 'function'/);
  assert.match(source, /typeof i18n\.subscribe === 'function'/);
  assert.match(source, /function uiMeters\(value, options = \{\}\)/);
  assert.match(source, /function uiKilometersPerHour\(value, options = \{\}\)/);
  assert.match(source, /unsubscribeLanguageChange = i18n\.subscribe\(syncLocalizedRuntimePresentation\)/);

  const languageSync = functionSource('syncLocalizedRuntimePresentation');
  for (const call of [
    'syncLaunchOverlayPresentation',
    'syncManualWeatherOptions',
    'syncManualWeatherTestPanel',
    'syncWeatherModePicker',
    'syncRenderQualityPicker',
    'populateMusicTrackList',
    'syncMusicLibrary',
    'syncAudioButton',
    'syncPauseButtonPresentation',
    'syncLightingButtonPresentation',
    'syncMobileCockpitPresentation',
    'syncAutoPilotButtonPresentation',
    'syncAutomaticThrottleButtonPresentation',
    'syncDriveTransmissionModeButtonPresentation',
    'syncGearControlPresentation',
    'applyViewButtonText',
    'syncDesktopCompassPresentation',
    'updateHud',
    'publishFpsDisplay'
  ]) {
    assert.match(languageSync, new RegExp(`${call}\\(`));
  }
  assert.match(languageSync, /state\.lastCrashReason === 'off-road-landing'/);
  assert.match(languageSync, /'launch\.offRoadCrashStatus'/);
  assert.match(languageSync, /displayedHandlingCandleCount = -1/);
  assert.match(languageSync, /displayedLives = -1/);
  assert.match(languageSync, /lastWeatherAnnouncementKey = ''/);
  assert.match(languageSync, /minimapLastStatus = ''/);
  assert.match(languageSync, /minimapNeedsDraw = true/);
  assert.doesNotMatch(
    languageSync,
    /\b(?:toggleAudio|toggleLighting|toggleAutoPilot|toggleAutomaticThrottle|toggleDriveTransmissionMode|applyRenderQuality|setForcedType|setMode)\(/
  );
  assert.doesNotMatch(
    languageSync,
    /state\.(?:speed|distance|lives|score|routeCursor|pathPlan|autoPilot|manualThrottleMode|driveTransmissionMode)\s*=/
  );

  const dispose = sourceBetween(
    'function disposePresentationResources()',
    "window.addEventListener('pagehide'"
  );
  assert.match(dispose, /unsubscribeLanguageChange\?\.\(\)/);
  assert.match(dispose, /unsubscribeLanguageChange = null/);

  const guidance = sourceBetween(
    'function updateDecisionGuidance(',
    'function graphTransitionGate('
  );
  assert.match(guidance, /decisionGuidance\.exitNumber = movement\?\.exitNumber/);
  assert.match(guidance, /decisionGuidance\.routeType === 'mountain-tunnel'/);
  assert.doesNotMatch(guidance, /exec\(decisionGuidance\.label\)|match\(decisionGuidance\.label\)/);

  assert.match(source, /const MINIMAP_EDGE_FAMILY_KEY = Object\.freeze/);
  assert.match(source, /road: localizedEdgeFamily\(edge\?\.family\)/);
  assert.doesNotMatch(source, /位于\$\{edge\?\.family/);
  assert.doesNotMatch(source, /fillText\(station\.label|fillText\(label,/);
  assert.match(source, /fillText\(uiSource\(station\.label\)/);
  assert.match(source, /fillText\(uiSource\(label\)/);
  assert.match(source, /uiMeters\(minimapLookAhead\)/);
});

test('mobile cockpit activation and disclosures remain presentation-only across touch hardware and viewport changes', () => {
  assert.match(
    source,
    /const mobileCockpitHardwareQuery = window\.matchMedia\('\(any-pointer: coarse\), \(pointer: coarse\)'\)/
  );
  assert.match(
    source,
    /const mobileCockpitViewportQuery = window\.matchMedia\(\s*'\(max-width: 920px\), \(max-height: 560px\) and \(orientation: landscape\)'\s*\)/
  );

  const activation = functionSource('shouldUseMobileCockpit');
  assert.match(
    activation,
    /const touchCapable = navigator\.maxTouchPoints > 0 \|\| mobileCockpitHardwareQuery\.matches/
  );
  assert.match(
    activation,
    /document\.documentElement\.dataset\.touchCapable = String\(touchCapable\)/
  );
  assert.match(activation, /if \(mobileCockpitViewportQuery\.matches\) return true/);
  assert.match(
    activation,
    /const viewportWidth = viewportPresentation\.width;[\s\S]*?const viewportHeight = viewportPresentation\.height;[\s\S]*?touchCapable[\s\S]*?Math\.max\(viewportWidth, viewportHeight\) <= 1_366[\s\S]*?Math\.min\(viewportWidth, viewportHeight\) <= 1_200/
  );

  const visibility = functionSource('setMobileCockpitContentVisibility');
  assert.match(
    visibility,
    /element\.hidden = !visible;\s*element\.toggleAttribute\('inert', !visible\);\s*element\.setAttribute\('aria-hidden', String\(!visible\)\);/
  );

  const sync = functionSource('syncMobileCockpitPresentation');
  assert.match(
    sync,
    /const compactSingleDrawer = active[\s\S]*?Math\.min\(viewportPresentation\.width, viewportPresentation\.height\) < 700/
  );
  assert.match(sync, /mobileCockpitState\.lastExpandedSection === 'navigation'/);
  assert.match(sync, /mobileCockpitState\.primaryExpanded = false/);
  assert.match(sync, /mobileCockpitState\.navigationExpanded = false/);
  assert.match(sync, /const primaryVisible = !active \|\| mobileCockpitState\.primaryExpanded/);
  assert.match(sync, /const navigationVisible = !active \|\| mobileCockpitState\.navigationExpanded/);
  assert.match(
    sync,
    /const autoPanelVisible = !active && state\.autoPilot/
  );
  assert.match(sync, /const mobileAutopilotVisible = active && state\.autoPilot/);
  assert.match(
    sync,
    /document\.documentElement\.dataset\.mobileAutopilotVisible = String\(mobileAutopilotVisible\)/
  );
  for (const [element, visibleState] of [
    ['mobileFlightHudEl', 'active'],
    ['hudPrimaryBodyEl', 'primaryVisible'],
    ['navigationBodyEl', 'navigationVisible'],
    ['autoPanel', 'autoPanelVisible'],
    ['mobileAutopilotCapsule', 'mobileAutopilotVisible']
  ]) {
    assert.match(
      sync,
      new RegExp(`setMobileCockpitContentVisibility\\(${element}, ${visibleState}\\)`)
    );
  }
  assert.match(
    sync,
    /element\.hidden = active && !navigationVisible;\s*element\.toggleAttribute\('inert', active && !navigationVisible\);/
  );
  assert.match(
    sync,
    /hudPrimaryDisclosureEl\.setAttribute\('aria-expanded', String\(primaryVisible\)\)/
  );
  assert.match(
    sync,
    /navigationDisclosureEl\.setAttribute\('aria-expanded', String\(navigationVisible\)\)/
  );
  assert.match(
    sync,
    /mobileTelemetryBtn\.setAttribute\('aria-expanded', String\(active && primaryVisible\)\)/
  );
  assert.match(
    sync,
    /mobileNavigationBtn\.setAttribute\('aria-expanded', String\(active && navigationVisible\)\)/
  );
  assert.match(sync, /mobileTelemetryBtn\.toggleAttribute\('inert', mobileUtilitiesVisible\)/);
  assert.match(
    sync,
    /mobileTelemetryBtn\.setAttribute\('aria-hidden', String\(mobileUtilitiesVisible\)\)/
  );
  assert.match(sync, /if \(wasNavigationHidden && navigationVisible\) queueExpandedMinimapResize\(\)/);
  assert.doesNotMatch(sync, /autoPilotBtn\.setAttribute\('aria-expanded'/);
  assert.match(
    source,
    /const mobileCockpitAdvancedActionEls = Object\.freeze\(\[\s*lightingBtn,\s*fullscreenBtn\s*\]\)/
  );
  assert.doesNotMatch(
    sourceBetween('const mobileCockpitAdvancedActionEls', '/**\n   * Touch capability'),
    /\bspeedModeBtn\b/,
    'automatic throttle must remain reachable while mobile route details are folded'
  );

  const toggle = functionSource('toggleMobileCockpitSection');
  assert.match(toggle, /if \(!mobileCockpitState\.active\) return/);
  assert.match(
    toggle,
    /if \(\s*nextExpanded\s*&& Math\.min\(viewportPresentation\.width, viewportPresentation\.height\) < 700\s*\)/
  );
  assert.match(toggle, /if \(nextExpanded\) mobileCockpitState\.lastExpandedSection = sectionName/);
  assert.match(toggle, /mobileCockpitState\.navigationExpanded = false/);
  assert.match(toggle, /mobileCockpitState\.primaryExpanded = false/);
  assert.match(toggle, /syncMobileCockpitPresentation\(\)/);
  const utilityToggle = functionSource('toggleMobileUtilities');
  assert.match(utilityToggle, /mobileCockpitState\.utilitiesExpanded = nextExpanded/);
  assert.match(
    utilityToggle,
    /if \(nextExpanded\) \{\s*mobileCockpitState\.primaryExpanded = false;\s*mobileCockpitState\.navigationExpanded = false;/
  );
  assert.match(utilityToggle, /syncMobileCockpitPresentation\(\)/);
  assert.match(
    functionSource('toggleAutoPilot'),
    /syncAutoPilotButtonPresentation\(\);\s*syncAutomaticThrottleButtonPresentation\(\);\s*syncMobileCockpitPresentation\(\);/
  );

  for (const projector of [activation, visibility, sync, toggle]) {
    assert.doesNotMatch(
      projector,
      /state\.(?:speed|distance|lives|score|routeCursor|pathPlan|autoPilot|manualThrottleMode)\s*=/,
      'mobile folding must never write gameplay authority'
    );
  }

  const disclosureListeners = sourceBetween(
    "hudPrimaryDisclosureEl.addEventListener('click'",
    "window.addEventListener('resize'"
  );
  assert.match(disclosureListeners, /toggleMobileCockpitSection\('primary'\)/);
  assert.match(disclosureListeners, /toggleMobileCockpitSection\('navigation'\)/);
  assert.match(
    disclosureListeners,
    /mobileTelemetryBtn\.addEventListener\('click',[\s\S]*?toggleMobileCockpitSection\('primary'\)/
  );
  assert.match(
    disclosureListeners,
    /mobileNavigationBtn\.addEventListener\('click',[\s\S]*?toggleMobileCockpitSection\('navigation'\)/
  );
  assert.match(
    disclosureListeners,
    /mobileUtilityBtn\.addEventListener\('click',[\s\S]*?toggleMobileUtilities\(\)/
  );
  assert.match(
    disclosureListeners,
    /for \(const mediaQuery of \[mobileCockpitHardwareQuery, mobileCockpitViewportQuery\]\)/
  );
  assert.match(disclosureListeners, /mediaQuery\.addEventListener\('change', viewportMediaChangeHandler\)/);
  assert.match(disclosureListeners, /mediaQuery\.addListener\(viewportMediaChangeHandler\)/);
  const sharedActionListeners = sourceBetween(
    "autoPilotBtn.addEventListener('click'",
    'const semanticAudioButtonSelector'
  );
  for (const [desktopButton, mobileButton, action] of [
    ['autoPilotBtn', 'mobileAutoPilotBtn', 'toggleAutoPilot'],
    ['speedModeBtn', 'mobileSpeedModeBtn', 'toggleAutomaticThrottle'],
    ['transmissionModeBtn', 'mobileTransmissionModeBtn', 'toggleDriveTransmissionMode'],
    ['viewBtn', 'mobileViewBtn', 'cycleViewMode'],
    ['pauseBtn', 'mobilePauseBtn', 'setPaused'],
    ['lightingBtn', 'mobileLightingBtn', 'toggleLighting']
  ]) {
    assert.match(
      sharedActionListeners,
      new RegExp(`${desktopButton}\\.addEventListener\\('click',[\\s\\S]*?${action}\\(\\)`)
    );
    assert.match(
      sharedActionListeners,
      new RegExp(`${mobileButton}\\.addEventListener\\('click',[\\s\\S]*?${action}\\(\\)`)
    );
  }
  assert.match(sharedActionListeners, /audioBtn\.addEventListener\('click', \(event\) => toggleAudio\(event\)\)/);
  assert.match(sharedActionListeners, /mobileAudioBtn\.addEventListener\('click', \(event\) => toggleAudio\(event\)\)/);
  assert.match(sharedActionListeners, /mobileMusicBtn\.addEventListener\('click', openMusicLibrary\)/);
  const resizeCommit = functionSource('commitViewportPresentation');
  assert.match(resizeCommit, /syncMobileCockpitPresentation\(\)/);
  assert.match(
    source,
    /window\.addEventListener\('resize', \(\) => queueViewportPresentationSync\('window-resize'\)\)/
  );
  assert.match(
    source,
    /syncHoodCollisionGuidePresentation\(\);\s*syncMobileCockpitPresentation\(\);\s*toggleDriveTransmissionMode\(driveTransmissionDefaultMode\);\s*applyViewButtonText\(\);\s*syncCinematicButtonPresentation\(\);\s*toggleAutomaticThrottle\(automaticThrottleDefaultEnabled\);/
  );
});

test('autopilot command HUD reports independent authority, stable risk bands, and truthful brake evidence', () => {
  const resolver = new Function(
    `'use strict';
${functionSource('resolveAutopilotRiskLevel')}
${functionSource('resolveAutopilotBrakeMode')}
${functionSource('autopilotBrakeTranslationKey')}
${functionSource('resolveAutopilotCommandPresentation')}
return { resolveAutopilotRiskLevel, resolveAutopilotCommandPresentation };`
  )();
  const risk = resolver.resolveAutopilotRiskLevel;
  assert.equal(risk(0.29, 'clear'), 'clear');
  assert.equal(risk(0.30, 'clear'), 'guarded');
  assert.equal(risk(0.21, 'guarded'), 'guarded');
  assert.equal(risk(0.19, 'guarded'), 'clear');
  assert.equal(risk(0.58, 'guarded'), 'elevated');
  assert.equal(risk(0.45, 'elevated'), 'elevated');
  assert.equal(risk(0.43, 'elevated'), 'guarded');
  assert.equal(risk(0.82, 'elevated'), 'critical');
  assert.equal(risk(0.69, 'critical'), 'critical');
  assert.equal(risk(0.67, 'critical'), 'elevated');

  const flightState = {
    autoPilot: false,
    manualThrottleMode: true,
    cameraCinematicActive: false,
    manualBrake: false,
    autoBrake: false,
    autoBrakeReason: 'none',
    autoGoal: 'lane',
    autoThreat: 0.96,
    autoNextObstacleDistance: 75,
    autoObstacleBrakeDistanceM: null,
    autoObstacleBrakeTtcSeconds: null,
    speed: 50
  };
  const controls = { left: false, right: false, brake: false };
  const out = {};
  resolver.resolveAutopilotCommandPresentation(flightState, controls, 'clear', out);
  assert.equal(out.intentKey, 'autopilot.intent.manualHold');
  assert.equal(out.risk, 0);
  assert.equal(out.riskLevel, 'clear');
  assert.equal(out.lateralAuthority, 'manual');
  assert.equal(out.longitudinalAuthority, 'manual');
  assert.equal(out.threatDistanceM, null, 'disabled autopilot must not publish stale planner threats');

  flightState.manualThrottleMode = false;
  resolver.resolveAutopilotCommandPresentation(flightState, controls, 'clear', out);
  assert.equal(out.longitudinalAuthority, 'full-throttle');

  flightState.autoPilot = true;
  flightState.manualThrottleMode = true;
  flightState.autoGoal = 'pickup';
  flightState.autoThreat = 0.31;
  resolver.resolveAutopilotCommandPresentation(flightState, controls, 'clear', out);
  assert.equal(out.intentKey, 'autopilot.intent.collectCandlelight');
  assert.equal(out.riskLevel, 'guarded');
  assert.equal(out.lateralAuthority, 'autopilot');
  assert.equal(out.longitudinalAuthority, 'autopilot');
  assert.equal(out.threatDistanceM, 75);
  assert.equal(out.threatTtcSeconds, 1.5);

  flightState.manualThrottleMode = false;
  resolver.resolveAutopilotCommandPresentation(flightState, controls, out.riskLevel, out);
  assert.equal(
    out.longitudinalAuthority,
    'autopilot',
    'P must keep the same longitudinal owner under either stored M preference'
  );

  controls.left = true;
  resolver.resolveAutopilotCommandPresentation(flightState, controls, out.riskLevel, out);
  assert.equal(out.lateralAuthority, 'manual-takeover');
  assert.equal(out.lateralAuthorityKey, 'autopilot.authority.manualTakeover');
  controls.left = false;

  flightState.autoBrake = true;
  flightState.autoBrakeReason = 'obstacle';
  flightState.autoObstacleBrakeDistanceM = 42;
  flightState.autoObstacleBrakeTtcSeconds = 0.7;
  flightState.autoThreat = 0.12;
  resolver.resolveAutopilotCommandPresentation(flightState, controls, 'guarded', out);
  assert.equal(out.intentKey, 'autopilot.intent.avoidThreat');
  assert.equal(out.risk, 0.88);
  assert.equal(out.riskLevel, 'critical');
  assert.equal(out.brakeMode, 'obstacle');
  assert.equal(out.brakeKey, 'autopilot.brake.obstacle');
  assert.equal(out.threatDistanceM, 42);
  assert.equal(out.threatTtcSeconds, 0.7);

  flightState.manualBrake = true;
  resolver.resolveAutopilotCommandPresentation(flightState, controls, 'critical', out);
  assert.equal(out.brakeMode, 'manual', 'manual brake must remain the visible final authority');
  assert.equal(out.brakeKey, 'autopilot.brake.manual');

  const publisher = functionSource('publishAutopilotCommandHud');
  for (const dataset of [
    'autoPilot',
    'riskLevel',
    'lateralAuthority',
    'longitudinalAuthority',
    'brakeMode'
  ]) {
    assert.match(publisher, new RegExp(`autoPanel\\.dataset\\.${dataset}`));
  }
  assert.match(publisher, /autoRiskMeter\.setAttribute\('aria-valuenow'/);
  assert.match(publisher, /autoRiskMeter\.setAttribute\(\s*'aria-valuetext'/);
  assert.match(publisher, /mobileAutopilotMode\.textContent = modeText/);
  assert.match(publisher, /mobileAutopilotIntent\.textContent = intentText/);
  assert.match(publisher, /mobileAutopilotPriority\.textContent = mobilePriorityText/);
  assert.match(publisher, /mobileAutopilotCapsule\.dataset\.riskLevel = presentation\.riskLevel/);
  assert.match(publisher, /mobileAutopilotCapsule\.dataset\.brakeMode = presentation\.brakeMode/);
  assert.match(publisher, /lastAutopilotAuthoritySignature[\s\S]*?autoAuthorityAnnouncement\.textContent/);
  assert.doesNotMatch(publisher, /state\.(?:speed|lives|distance|autoPilot|manualThrottleMode)\s*=/);
});

test('classified candlelight and obstacle factories preserve gameplay authority and pooled root contracts', () => {
  assert.match(source, /requireDependency\(\s*window\.NeonCandlelight,\s*'Neon candlelight presentation module'/);
  assert.match(source, /requireDependency\(\s*window\.NeonObstacles,\s*'Neon obstacle presentation module'/);
  assert.match(source, /candlelightPresentation\.validateZones\(zones\)/);
  assert.match(source, /obstaclePresentation\.validateConfiguredZones\(zones\)/);
  assert.match(source, /visualSeed: String\(visualSeed\)/);
  assert.match(source, /obstacleVisualFactory\.prewarm\(/);
  assert.match(source, /candlelightVisualFactory\.prewarm\(/);
  assert.match(source, /obstacleStaticPerFamily: 48/);
  assert.match(source, /obstacleDynamicPerFamily: 24/);
  assert.match(source, /collectiblePerFamily: 96/);
  assert.match(source, /const OBSTACLE_GROUP_MAXIMUM_VISUAL_ROOTS = 3/);
  assert.match(
    source,
    /obstacleVisualFactory\.availableCount\([\s\S]*?obstaclePresentationFamilyId\(zoneIndex, family\)[\s\S]*?\) >= requiredRootCount/
  );
  assert.match(
    source,
    /NeonWorld\.createDecorationLayer\(\{[\s\S]*?visualSeed: String\(visualSeed\),[\s\S]*?isReducedMotionEnabled/
  );
  assert.match(source, /motionKind: presentationDefinition\.motionKind/);
  assert.match(source, /x: width \* 0\.52,\s*y: height \* 0\.52,\s*z: depth \* 0\.52/);
  assert.match(source, /Only the transparent collision-free cue enters selective Bloom/);
  assert.match(source, /const usesClassifiedObstacleVisual = obj\.mesh\.userData\.neonObstacle !== undefined/);
  assert.match(source, /obj\.mesh\.rotation\.set\(0, 0, 0\);\s*obj\.mesh\.scale\.set\(1, 1, 1\)/);
  assert.match(source, /candlelightVisualFactory\.update\(item\.mesh, \{\s*nowMs: now,\s*reducedMotion: false/);
  assert.match(source, /entity\.presentationZoneIndex,\s*entity\.presentationFamilyIndex,[\s\S]*?entity\.half\.hx \/ 0\.52/);
  const obstacleSpawnSource = sourceBetween('function spawnObstacle(', '\n\n  function spawnPickup');
  const obstacleSpawnCapacityIndex = obstacleSpawnSource.indexOf(
    'obstacleVisualCapacityAvailable(zoneIndex, family, OBSTACLE_GROUP_MAXIMUM_VISUAL_ROOTS)'
  );
  const obstacleSpawnAcquireIndex = obstacleSpawnSource.indexOf(
    'const mesh = acquireObstacleVisual(zoneIndex, family, motionKind, width, height, depth)'
  );
  assert.ok(obstacleSpawnCapacityIndex >= 0 && obstacleSpawnCapacityIndex < obstacleSpawnAcquireIndex);
  assert.match(obstacleSpawnSource, /state\.obstaclePoolSuppressedSpawnCount\+\+;\s*return false/);
  const opposingPrewarmSource = sourceBetween(
    'function prewarmOpposingObstacle(',
    '\n\n  /** Clone one accepted candle event'
  );
  assert.match(
    opposingPrewarmSource,
    /obstacleVisualCapacityAvailable\([\s\S]*?1[\s\S]*?state\.obstaclePoolSuppressedOpposingPrewarmCount\+\+;\s*return false/
  );
  const forkExpansionSource = sourceBetween(
    'function expandDynamicObstacleAtStraightFork(',
    '\n\n  function sampleEntityPathFrame'
  );
  assert.match(forkExpansionSource, /const additionalRootCount = Math\.max\(0, placements\.length - 1\)/);
  assert.match(
    forkExpansionSource,
    /obstacleVisualCapacityAvailable\([\s\S]*?additionalRootCount[\s\S]*?state\.obstaclePoolSuppressedExpansionCount\+\+;\s*return 0/
  );
  assert.match(source, /obstaclePoolSuppressedSpawnCount: state\.obstaclePoolSuppressedSpawnCount/);
  assert.match(source, /obstaclePoolSuppressedExpansionCount: state\.obstaclePoolSuppressedExpansionCount/);
  assert.match(
    source,
    /obstaclePoolSuppressedOpposingPrewarmCount: state\.obstaclePoolSuppressedOpposingPrewarmCount/
  );
  assert.doesNotMatch(
    sourceBetween('function expandDynamicObstacleAtStraightFork', 'function sampleEntityPathFrame'),
    /entity\.mesh\.scale\.(?:x|y|z)|entity\.mesh\.material|entity\.mesh\.userData\.family/
  );
  assert.match(source, /Math\.max\(\s*180,\s*speed \* 3\.2,/);
  assert.match(source, /const minAhead = Math\.max\(180, speed \* 1\.6,/);
  assert.match(source, /obstacleVisualFactory\.dispose\(\)/);
  assert.match(source, /candlelightVisualFactory\.dispose\(\)/);
});

test('cloverleaf diagnostics publish active visible and resident reserved draw groups separately', () => {
  assert.match(
    source,
    /cloverleafVisualDrawGroups: cloverleafVisualDiagnostics\.drawGroupCount \?\? 0/
  );
  assert.match(
    source,
    /cloverleafVisualReservedDrawGroups: cloverleafVisualDiagnostics\.reservedDrawGroupCount \?\? 0/
  );
  assert.match(
    cloverleafTilePoolSource,
    /if \(active\) \{[\s\S]*?totals\.drawGroupCount = Math\.max\(totals\.drawGroupCount, visual\.drawGroupCount \|\| 0\);[\s\S]*?\}/
  );
  assert.match(
    cloverleafTilePoolSource,
    /totals\.reservedDrawGroupCount = Math\.max\([\s\S]*?visual\.reservedDrawGroupCount \|\| 0[\s\S]*?\);/
  );
  assert.match(cloverleafTilePoolSource, /drawGroupCount: 0,\s*reservedDrawGroupCount: 0,/);
});

test('road warm-build promotion and recovery remain bounded and visible through the map/runtime contract', () => {
  assert.match(cloverleafTilePoolSource, /const CRITICAL_BUILD_MAX_STEPS_PER_SLICE = 12;/);
  assert.match(cloverleafTilePoolSource, /const WARM_BUILD_MAX_RETRY_ATTEMPTS = 2;/);
  assert.match(cloverleafTilePoolSource, /const WARM_BUILD_RETRY_BASE_DELAY_MS = 32;/);
  assert.match(
    cloverleafTilePoolSource,
    /const SCHEDULING_HANDLE = Symbol\('cloverleaf-warmup-scheduling'\);/
  );
  assert.match(cloverleafTilePoolSource, /function promoteActiveWarmBuild\(target\)/);
  assert.match(
    cloverleafTilePoolSource,
    /activeWarmBuild\.buildSource = 'critical';[\s\S]*?warmBuildPriorityPromotionCount\+\+;/
  );
  assert.match(
    cloverleafTilePoolSource,
    /cancelIdle\(warmupHandle\);[\s\S]*?warmupTicket = null;[\s\S]*?requestCritical\(callback\)/
  );
  assert.match(
    cloverleafTilePoolSource,
    /const scheduleTicket = \{[\s\S]*?generation: warmupGeneration,[\s\S]*?handle: SCHEDULING_HANDLE,[\s\S]*?warmupTicket = scheduleTicket;[\s\S]*?warmupHandle = SCHEDULING_HANDLE;/
  );
  assert.match(
    cloverleafTilePoolSource,
    /callbackTicket\.generation !== warmupGeneration[\s\S]*?warmupTicket !== callbackTicket[\s\S]*?warmupHandle !== callbackTicket\.handle/
  );
  assert.match(
    cloverleafTilePoolSource,
    /retryTicket\.generation !== warmupGeneration[\s\S]*?warmBuildRetryTicket !== retryTicket[\s\S]*?warmBuildRetryHandle !== retryTicket\.handle/
  );
  assert.match(
    cloverleafTilePoolSource,
    /warmupTicket === scheduleTicket[\s\S]*?warmupHandle === SCHEDULING_HANDLE[\s\S]*?scheduleTicket\.handle = handle;[\s\S]*?warmupHandle = handle;/
  );
  assert.match(
    cloverleafTilePoolSource,
    /warmBuildRetryTicket === retryTicket[\s\S]*?warmBuildRetryHandle === SCHEDULING_HANDLE[\s\S]*?retryTicket\.handle = handle;[\s\S]*?warmBuildRetryHandle = handle;/
  );
  assert.match(
    cloverleafTilePoolSource,
    /function invalidateWarmupWork\(\) \{\s*warmupGeneration\+\+;\s*latestWarmupContext = null;/
  );
  assert.match(
    cloverleafTilePoolSource,
    /stepsThisSlice < CRITICAL_BUILD_MAX_STEPS_PER_SLICE[\s\S]*?now\(\) - sliceStartedAt\) < 4/
  );
  assert.match(cloverleafTilePoolSource, /function recoverWarmupFailure\(error\)/);
  assert.match(cloverleafTilePoolSource, /pendingWarmBuildRetry = \{[\s\S]*?retryDelayMs/);
  assert.match(cloverleafTilePoolSource, /warmBuildRetryExhaustedCount\+\+;/);
  assert.match(cloverleafTilePoolSource, /throw firstError;/);
  for (const diagnostic of [
    'warmBuildPriorityPromotionCount',
    'warmBuildFailureCount',
    'warmBuildRetryCount',
    'warmBuildRecoveryCount',
    'warmBuildRetryExhaustedCount',
    'warmBuildRetryPending',
    'lastWarmBuildFailure',
    'roadPresentationDegraded',
    'roadPresentationDegradationReason',
    'currentRoadBuildProtected'
  ]) {
    assert.match(cloverleafTilePoolSource, new RegExp(`${diagnostic},|${diagnostic}:`));
  }
  assert.match(
    cloverleafTilePoolSource,
    /presentationDegraded: Boolean\(fallbackRecord\)[\s\S]*?presentationDegradationReason:/
  );
  assert.match(cloverleafTilePoolSource, /'current-road-resident-missing'/);
  assert.match(source, /cloverleafVisuals\.getActiveMapGraph\?\.\(playerFrame,/);
  assert.match(source, /cloverleafMapRouteFallbackCount:/);
  assert.match(source, /cloverleafMapRouteFallbackActive:/);
});

test('jump-platform landing authority pins the target during preflight and both physical roads in flight', () => {
  const pinCollector = sourceBetween(
    'function collectPinnedRoadVisualTileTokens()',
    '\n\n  function updateTrackNetworkVisuals'
  );
  assert.match(
    pinCollector,
    /if \(state\.grounded\) \{[\s\S]*?add\(state\.jumpPlatformLandingPreflight\?\.landingTileToken\)[\s\S]*?\} else \{[\s\S]*?add\(state\.lastTakeoff\?\.tileToken\)[\s\S]*?add\(state\.lastTakeoff\?\.landingTileToken\)/
  );
  assert.match(pinCollector, /add\(state\.opposingVariantReadinessGate\?\.tileToken\)/);
  const trackVisualUpdate = sourceBetween(
    'function updateTrackNetworkVisuals(now)',
    '\n\n  requireDependency(window.NeonShip'
  );
  assert.match(trackVisualUpdate, /pinnedTileTokens: collectPinnedRoadVisualTileTokens\(\)/);
  assert.match(trackVisualUpdate, /visibilityOrigin: roadTileVisibilityOrigin/);
  assert.match(trackVisualUpdate, /graphRenderOrigin\.x[\s\S]*?camera\.position\.x/);
  assert.match(
    source,
    /cloverleafVisualPinnedTiles: cloverleafVisualDiagnostics\.pinnedVisibleTokens\?\.length \?\? 0/
  );
  assert.match(source, /cloverleafVisualContinuityHeldTiles:/);
  const manualTakeoff = sourceBetween('function launchVertical(', 'function releaseFromJumpPlatform(');
  assert.match(manualTakeoff, /tileToken: takeoffEdge\?\.tileToken \|\| null/);
  const landingTokenCollector = functionSource('collectAirborneLandingTileTokens');
  const authoredTargetAt = landingTokenCollector.indexOf('add(state.lastTakeoff?.landingTileToken)');
  const movingPreviousAt = landingTokenCollector.indexOf(
    'track.getEdge?.(state.previousRouteCursor?.edgeId)'
  );
  assert.ok(
    authoredTargetAt >= 0 && authoredTargetAt < movingPreviousAt,
    'collision must consume the preflight-authored destination before adding moving cursor neighbours'
  );
  assert.match(cloverleafTilePoolSource, /pinnedTileTokens/);
  assert.match(cloverleafTilePoolSource, /pinnedVisibleTokens/);
  assert.match(cloverleafTilePoolSource, /const PREWARM_REVEAL_DISTANCE = 2_400;/);
  assert.match(cloverleafTilePoolSource, /const PREWARM_RELEASE_DISTANCE = 2_800;/);
  assert.match(cloverleafTilePoolSource, /const PREVIOUS_TILE_RELEASE_DISTANCE = 2_800;/);
  assert.match(cloverleafTilePoolSource, /const DEFAULT_MAP_VISIBILITY_DISTANCE = 2_200;/);
  assert.match(
    cloverleafTilePoolSource,
    /activeTokens\.includes\(warmRecord\.token\)[\s\S]*?warmDistanceM <= PREWARM_RELEASE_DISTANCE/
  );
  assert.match(cloverleafTilePoolSource, /cameraRetainedPreviousTokens/);
  const pinPriority = cloverleafTilePoolSource.indexOf(
    'for (const token of Array.isArray(pinnedTileTokens) ? pinnedTileTokens : [])'
  );
  const carryOverPriority = cloverleafTilePoolSource.indexOf(
    'if (carryOverRecord) addDesiredTile(carryOverTile)'
  );
  const nextTilePriority = cloverleafTilePoolSource.indexOf(
    'if (nextTile && (nextRecord || (!stagedTileBuildsEnabled && initialUpdate)))'
  );
  assert.ok(pinPriority >= 0 && pinPriority < carryOverPriority);
  assert.ok(carryOverPriority < nextTilePriority);
});

test('jump-platform release waits for one rendered visual-and-collision handshake before mutating flight state', () => {
  assert.match(source, /jumpPlatformLandingPreflight: null/);
  assert.match(source, /jumpPlatformLandingReadinessBlockCount: 0/);
  assert.match(source, /jumpPlatformLandingReadinessLastStatus: null/);
  for (const diagnostic of [
    'jumpLandingSourceTileToken',
    'jumpLandingTargetTileToken',
    'jumpLandingTargetSignature',
    'jumpLandingVisualReady',
    'jumpLandingCollisionReady',
    'jumpLandingPresentedReady',
    'jumpLandingReady',
    'jumpLandingStatus',
    'jumpLandingBlockedCount'
  ]) {
    assert.match(source, new RegExp(`${diagnostic}:`), `missing jump readiness diagnostic ${diagnostic}`);
  }

  const preflight = functionSource('preflightOpposingLandingVariant');
  assert.match(preflight, /cloverleafVisuals\.requestOpposingRouteVariantPreflight\(/);
  assert.match(preflight, /if \(!requested\?\.landingTileToken\) return null/);
  assert.match(preflight, /const next = Object\.freeze\(\{[\s\S]*?\.\.\.requested,[\s\S]*?sourceEdgeId/);
  assert.match(preflight, /previous\?\.landingTileToken !== next\.landingTileToken/);
  assert.match(preflight, /previous\?\.landingTileSignature !== next\.landingTileSignature/);
  for (const field of ['visualReady', 'collisionReady', 'presentedReady']) {
    assert.match(preflight, new RegExp(`next\\.${field} === true`));
  }
  assert.match(preflight, /next\.landingSurfaceReady === true/);
  assert.match(preflight, /state\.jumpPlatformLandingPreflight = next/);

  const readiness = functionSource('jumpPlatformLandingSurfaceReady');
  assert.match(readiness, /if \(preflight\?\.sourceEdgeId !== sourceEdgeId\) return false/);
  assert.match(readiness, /state\.jumpPlatformLandingEncounterArmed === true/);
  assert.match(readiness, /preflight\.landingSurfaceReady === true/);

  const surfaceSampler = functionSource('sampleGameplaySurfaceAhead');
  assert.match(
    surfaceSampler,
    /platformSupport[\s\S]*?jumpPlatformLandingSurfaceReady\(frame\.edgeId\)[\s\S]*?!encounterKeepsFlatRoadSupport/
  );
  assert.doesNotMatch(surfaceSampler, /cameraCinematic/);

  const updateVertical = functionSource('updateVerticalPhysics');
  const corridorAt = updateVertical.indexOf('routeEdge?.jumpPlatforms?.length');
  const corridorPreflightAt = updateVertical.indexOf('preflightOpposingLandingVariant(routeId)', corridorAt);
  const surfaceSampleAt = updateVertical.indexOf('sampleGameplaySurfaceAhead(0, surfaceScratch)');
  const lipAt = updateVertical.indexOf('track.crossedJumpPlatformLip(');
  assert.ok(
    corridorAt >= 0
      && corridorPreflightAt > corridorAt
      && corridorPreflightAt < surfaceSampleAt
      && surfaceSampleAt < lipAt,
    'a platform corridor must request destination readiness before support sampling or lip release'
  );
  const blockedGuardAt = updateVertical.indexOf('landingPreflight?.landingSurfaceReady !== true');
  const encounterGuardAt = updateVertical.indexOf(
    '!jumpPlatformLandingSurfaceReady(crossedPlatform.edgeId)',
    blockedGuardAt
  );
  const blockedCounterAt = updateVertical.indexOf(
    'state.jumpPlatformLandingReadinessBlockCount++',
    blockedGuardAt
  );
  const blockedStatusAt = updateVertical.indexOf(
    "state.jumpPlatformLandingReadinessLastStatus = landingPreflight?.status || 'landing-surface-unavailable'",
    blockedGuardAt
  );
  const blockedReturnAt = updateVertical.indexOf('return;', blockedStatusAt);
  assert.ok(
    blockedGuardAt >= 0
      && encounterGuardAt > blockedGuardAt
      && blockedCounterAt > encounterGuardAt
      && blockedStatusAt > blockedCounterAt
      && blockedReturnAt > blockedStatusAt,
    'an unready or unarmed platform encounter must publish one blocked result and return on ground'
  );
  assert.doesNotMatch(
    updateVertical.slice(0, updateVertical.indexOf('const platformSupport = track.sampleJumpPlatformSupport(')),
    /state\.(?:grounded|lastTakeoff|lastJumpPlatformId|jumpPlatformFlightActive)\s*=/
  );
  const releaseCallAt = updateVertical.indexOf('const released = releaseFromJumpPlatform(');
  const releaseFailureAt = updateVertical.indexOf('if (!released)', releaseCallAt);
  const remainderSweepAt = updateVertical.indexOf('gameplayCore.sweptVerticalContact({', releaseCallAt);
  assert.ok(
    releaseCallAt >= 0 && releaseFailureAt > releaseCallAt && remainderSweepAt > releaseFailureAt,
    'a rejected release must return before the airborne remainder sweep begins'
  );
  assert.doesNotMatch(updateVertical, /state\.lastJumpPlatformId\s*=/);

  const release = functionSource('releaseFromJumpPlatform');
  const releaseReadinessAt = release.indexOf(
    'if (landingPreflight?.landingSurfaceReady !== true) return false;'
  );
  const airborneMutationAt = release.indexOf('state.grounded = false;');
  assert.ok(
    releaseReadinessAt >= 0 && releaseReadinessAt < airborneMutationAt,
    'release readiness must be checked before grounded or any later flight state changes'
  );
  const preReadinessRelease = release.slice(0, releaseReadinessAt);
  assert.doesNotMatch(
    preReadinessRelease,
    /state\.(?:grounded|verticalVelocity|flightSource|jumpPlatformFlightActive|takeoffCount|jumpPlatformTakeoffCount|lastTakeoff|lastJumpPlatformId)\s*(?:=|\+\+)/
  );
  assert.match(release, /landingTileToken: landingPreflight\.landingTileToken/);
  assert.match(release, /landingTileSignature: landingPreflight\.landingTileSignature \|\| null/);
  assert.match(release, /state\.lastTakeoff = flightMetadata/);

  const renderFrame = functionSource('renderPresentationFrame');
  const postRenderAt = renderFrame.indexOf('postProcessingPipeline.render()');
  const fallbackRenderAt = renderFrame.indexOf('renderer.render(scene, camera)');
  const markPresentedAt = renderFrame.indexOf('cloverleafVisuals?.markPresented?.()');
  assert.ok(
    postRenderAt >= 0 && fallbackRenderAt > postRenderAt && markPresentedAt > fallbackRenderAt,
    'tile presentation may be acknowledged only after either real renderer path succeeds'
  );
});

test('platform landing, real off-road failure, and reset release the destination handshake exactly at lifecycle boundaries', () => {
  const cleanupPattern = /state\.jumpPlatformLandingPreflight = null/;
  const crash = functionSource('crashFromOffRoadLanding');
  const crashCleanupAt = crash.search(cleanupPattern);
  const crashEndAt = crash.indexOf('endGame();');
  assert.ok(
    crashCleanupAt >= 0 && crashCleanupAt < crashEndAt,
    'a terminal road miss must release its target presentation lease before ending the run'
  );

  const applyVertical = functionSource('applySweptVerticalResult');
  const physicalQueryAt = applyVertical.indexOf('resolveAirborneLandingSupport(');
  const physicalMissAt = applyVertical.indexOf('if (!landingSupport.hit)', physicalQueryAt);
  const physicalMissCrashAt = applyVertical.indexOf('crashFromOffRoadLanding(', physicalMissAt);
  const adoptionAt = applyVertical.indexOf('adoptAirborneLandingRoute(', physicalQueryAt);
  assert.ok(
    physicalQueryAt >= 0
      && physicalMissAt > physicalQueryAt
      && physicalMissCrashAt > physicalMissAt
      && physicalMissCrashAt < adoptionAt,
    'a genuine geometric miss must crash before any route adoption can invent pavement'
  );
  const successfulLandingAt = applyVertical.indexOf(
    'recordResolvedFlight(landingAirTime, true, state.jumpPlatformFlightActive)'
  );
  const successfulCleanupAt = applyVertical.indexOf(
    'state.jumpPlatformLandingPreflight = null;',
    successfulLandingAt
  );
  const successfulReturnAt = applyVertical.indexOf('return;', successfulCleanupAt);
  assert.ok(
    successfulLandingAt >= 0
      && successfulCleanupAt > successfulLandingAt
      && successfulReturnAt > successfulCleanupAt,
    'a safe landing must release the flight target before leaving its authoritative landing branch'
  );

  const reset = functionSource('resetGame');
  assert.match(reset, cleanupPattern);
  assert.match(reset, /state\.jumpPlatformLandingReadinessBlockCount = 0/);
  assert.match(reset, /state\.jumpPlatformLandingReadinessLastStatus = null/);
});

test('startup publishes the usable launch surface atomically after route, shader, frame, and loop readiness', () => {
  assert.match(source, /typeof startup\.markRuntimeReady === 'function'/);
  assert.match(source, /const updateNoticeDefersAutostart = launchOptions\.autostart && startup\.isUpdateNoticeActive\(\)/);
  assert.match(source, /if \(launchOptions\.autostart && !updateNoticeDefersAutostart\)/);
  assert.match(source, /startup\.registerUpdateContinueHandler\(\(\) => \{/);
  const loadingStages = sourceBetween(
    'const startupLoadingStages = Object.freeze([',
    'let startupLoadingStageIndex = 0;'
  );
  const loadingStageUpdate = functionSource('setStartupLoadingStage');
  const publishReady = functionSource('publishRuntimeReadyLaunchSurface');
  const startupFinish = sourceBetween(
    'async function finishRuntimeStartup()',
    '/** Poll only the lightweight tile-ready flag'
  );
  const trackAt = startupFinish.indexOf('updateTrackNetworkVisuals(now)');
  const decorationAt = startupFinish.indexOf('updateDecoration(now, lastPhysicalLightingState)');
  const shieldPrepareAt = startupFinish.indexOf('prepareInvulnerabilityShieldCompilation()');
  const compileAsyncAt = startupFinish.indexOf('await renderer.compileAsync(scene, camera)');
  const compileFallbackAt = startupFinish.indexOf('renderer.compile(scene, camera)');
  const shieldResetAt = startupFinish.indexOf('resetInvulnerabilityShieldPresentation();');
  const renderAt = startupFinish.indexOf('renderPresentationFrame()');
  const runnableAuditAt = startupFinish.indexOf("program?.diagnostics?.runnable === false");
  const animateAt = startupFinish.indexOf('animate()');
  const publishAt = startupFinish.indexOf('publishRuntimeReadyLaunchSurface()');
  assert.match(source, /renderer\.debug\.onShaderError = throwShaderProgramError/);
  assert.match(source, /webgl-shader-program-failed/);
  assert.match(source, /setLaunchCommitControlsLocked\(true\)/);
  for (const stage of ['modules', 'world', 'routes', 'graphics', 'first-frame', 'complete']) {
    assert.match(loadingStages, new RegExp(`id: '${stage}'`), `missing startup milestone ${stage}`);
  }
  assert.match(
    loadingStageUpdate,
    /if \(nextIndex < startupLoadingStageIndex \|\| nextIndex < 0\) return false/
  );
  assert.match(loadingStageUpdate, /startupLoadingEl\.dataset\.loadingStage = stage\.id/);
  assert.match(loadingStageUpdate, /startupLoadingStatusEl\.dataset\.i18n = stage\.key/);
  assert.match(loadingStageUpdate, /startupLoadingProgressEl\.setAttribute\('aria-valuetext', text\)/);
  assert.match(
    sourceBetween('function waitForInitialTrackNetwork()', 'waitForInitialTrackNetwork();'),
    /if \(!updateTrackNetworkVisuals\(performance\.now\(\)\)\)[\s\S]*?requestAnimationFrame\(waitForInitialTrackNetwork\)/
  );
  assert.ok(trackAt >= 0);
  assert.ok(trackAt < decorationAt);
  assert.ok(decorationAt < shieldPrepareAt);
  assert.ok(shieldPrepareAt < compileAsyncAt);
  assert.ok(compileAsyncAt < compileFallbackAt);
  assert.ok(compileFallbackAt < shieldResetAt);
  assert.ok(shieldResetAt < renderAt);
  assert.match(
    startupFinish,
    /prepareInvulnerabilityShieldCompilation\(\);[\s\S]*?try \{[\s\S]*?renderer\.compileAsync[\s\S]*?\} finally \{\s*resetInvulnerabilityShieldPresentation\(\);\s*\}/
  );
  assert.ok(renderAt < runnableAuditAt);
  assert.ok(runnableAuditAt < animateAt);
  assert.ok(animateAt < publishAt);
  const markReadyAt = publishReady.indexOf('startup.markRuntimeReady()');
  const runtimeReadyAt = publishReady.indexOf('runtimeStartupReady = true');
  const unlockAt = publishReady.indexOf('setLaunchCommitControlsLocked(false)');
  const revealAt = publishReady.indexOf('setLaunchOverlayVisible(true)');
  const completeAt = publishReady.indexOf("setStartupLoadingStage('complete')");
  const loaderBusyAt = publishReady.indexOf("startupLoadingEl.setAttribute('aria-busy', 'false')");
  const loaderHiddenAt = publishReady.indexOf('startupLoadingEl.hidden = true');
  const bodyReleaseAt = publishReady.indexOf("document.body.classList.remove('startup-loading-open')");
  assert.ok(markReadyAt >= 0);
  assert.ok(markReadyAt < runtimeReadyAt);
  assert.ok(runtimeReadyAt < unlockAt);
  assert.ok(unlockAt < revealAt);
  assert.ok(revealAt < completeAt);
  assert.ok(completeAt < loaderBusyAt);
  assert.ok(loaderBusyAt < loaderHiddenAt);
  assert.ok(loaderHiddenAt < bodyReleaseAt);
  assert.match(publishReady, /startupLoadingEl\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(publishReady, /startupLoadingEl\.inert = true/);
  assert.match(publishReady, /requestAnimationFrame\(\(\) => startBtn\.focus\(\{ preventScroll: true \}\)\)/);
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  assert.match(keydown, /startup\.isUpdateNoticeActive\(\)/);
});

test('startup rejects launch, reset, and held flight inputs until the atomic ready publication', () => {
  const overlayVisibility = functionSource('setLaunchOverlayVisible');
  const interactionIsolation = functionSource('reconcileInteractionIsolation');
  const controlLock = functionSource('setLaunchCommitControlsLocked');
  const resetGame = functionSource('resetGame');
  const startAction = sourceBetween(
    "startBtn.addEventListener('click'",
    "pauseRestartBtn.addEventListener('click'"
  );
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  const keyup = sourceBetween("window.addEventListener('keyup'", "window.addEventListener('blur'");
  const startupFinish = functionSource('finishRuntimeStartup');

  assert.match(overlayVisibility, /const shouldShow = Boolean\(visible && runtimeStartupReady\)/);
  assert.match(
    interactionIsolation,
    /const startupLoadingActive = isStartupLoadingActive\(\) \|\| !runtimeStartupReady/
  );
  assert.match(
    interactionIsolation,
    /node\.inert = startupLoadingActive \|\| launchVisible \|\| auxiliaryModalOpen/
  );
  assert.match(
    interactionIsolation,
    /overlay\.inert = startupLoadingActive \|\| !launchVisible \|\| auxiliaryModalOpen/
  );
  assert.match(controlLock, /const controlsLocked = Boolean\(locked \|\| !runtimeStartupReady\)/);
  assert.match(
    resetGame,
    /if \(\(!runtimeStartupReady && !allowDuringStartup\) \|\| fatalRuntimeLocked\)/
  );
  assert.ok(
    resetGame.indexOf('!runtimeStartupReady && !allowDuringStartup')
      < resetGame.indexOf('beginLaunchCommit(commitReason)')
  );
  assert.ok(startAction.indexOf('!runtimeStartupReady') < startAction.indexOf('resetGame()'));
  assert.ok(startAction.indexOf('startBtn.disabled') < startAction.indexOf('resetGame()'));
  assert.match(startAction, /startBtn\.getAttribute\('aria-disabled'\) === 'true'/);
  assert.doesNotMatch(startAction, /allowDuringStartup/);
  assert.ok(keydown.indexOf('if (!runtimeStartupReady)') < keydown.indexOf("e.code === 'ArrowLeft'"));
  assert.ok(keyup.indexOf('if (!runtimeStartupReady)') < keyup.indexOf("e.code === 'ArrowLeft'"));
  assert.match(
    startupFinish,
    /launchOptions\.autostart && !updateNoticeDefersAutostart[\s\S]*?resetGame\(\{ allowDuringStartup: true \}\)/
  );
  assert.equal(
    (source.match(/resetGame\(\{ allowDuringStartup: true \}\)/g) || []).length,
    1,
    'only the internal pre-ready autostart fixture may bypass the reset guard'
  );
});

test('launch weather selection commits only at a new run and never leaks native radio keys into flight', () => {
  assert.match(source, /weatherMode: requestedWeatherMode[\s\S]*?: 'mixed'/);
  assert.match(source, /mode: launchOptions\.weatherMode/);
  assert.match(source, /function selectedWeatherModeId\(\)[\s\S]*?weatherModes\.mixed\.id/);
  assert.equal((source.match(/weatherController\.setMode\(/g) || []).length, 1);

  const resetGame = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  const acquireAt = resetGame.indexOf('beginLaunchCommit(commitReason)');
  const commitAt = resetGame.indexOf('commitWeatherModeForRun()');
  const resetAt = resetGame.indexOf('weatherController.reset()');
  const firstModeSampleAt = resetGame.indexOf('weatherController.sample({');
  assert.ok(acquireAt >= 0);
  assert.ok(commitAt >= 0);
  assert.ok(acquireAt < commitAt);
  assert.ok(commitAt < resetAt);
  assert.ok(resetAt < firstModeSampleAt);
  assert.doesNotMatch(resetGame, /completeLaunchCommitAfterSuccessfulFrame/);

  const animate = sourceBetween('function animate()', "startBtn.addEventListener('click'");
  const presentedFrameAt = animate.indexOf('renderPresentationFrame()');
  const revealAt = animate.indexOf('completeLaunchCommitAfterSuccessfulFrame()');
  assert.ok(presentedFrameAt >= 0);
  assert.ok(presentedFrameAt < revealAt);

  const pickerChange = sourceBetween(
    "weatherModePicker.addEventListener('change'",
    "guideBtn.addEventListener('click'"
  );
  assert.match(pickerChange, /if \(state\.running && !state\.gameOver\)/);
  assert.match(pickerChange, /syncWeatherModePicker\(\)/);
  assert.doesNotMatch(pickerChange, /setMode|resetGame|weatherController\.reset/);

  const pause = sourceBetween(
    'function setPaused(force)',
    '/** Toggle the shared persisted preference'
  );
  const gameOver = sourceBetween('function endGame()', 'function jump(');
  assert.match(pause, /syncWeatherModePicker\(\)/);
  assert.doesNotMatch(pause, /commitWeatherModeForRun|weatherController\.setMode/);
  assert.match(gameOver, /syncWeatherModePicker\(\)/);

  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  const keyup = sourceBetween("window.addEventListener('keyup'", "window.addEventListener('blur'");
  assert.ok(keydown.indexOf('ownsSettingsNavigation(e.target)') < keydown.indexOf("e.code === 'ArrowLeft'"));
  assert.ok(keyup.indexOf('ownsSettingsNavigation(e.target)') < keyup.indexOf("e.code === 'ArrowLeft'"));
  assert.match(source, /weatherModeSelected: \{ enumerable: true/);
  assert.match(source, /weatherModeActive: \{ enumerable: true/);
  assert.match(source, /weatherForecastMode: weatherForecastSnapshot\.modeId/);
});

test('explicit manualTest=1 mode changes only the shared visual weather controller at runtime', () => {
  assert.match(source, /manualTest: launchParams\.get\('manualTest'\) === '1'/);
  assert.match(source, /classList\.toggle\('manual-weather-test-enabled', launchOptions\.manualTest\)/);
  assert.match(source, /manualWeatherTestPanel\.hidden = !launchOptions\.manualTest/);
  assert.match(source, /manualWeatherSelect\.disabled = !launchOptions\.manualTest/);
  assert.match(source, /for \(const type of Object\.values\(weather\.types\)\)/);
  assert.match(source, /#weatherModePicker, #qualityModePicker, #manualWeatherTestPanel/);
  assert.equal((source.match(/weatherController\.setForcedType\(/g) || []).length, 1);
  assert.match(source, /manualWeatherSelect\.addEventListener\('change', applyManualWeatherTestSelection\)/);
  assert.match(source, /manualTestMode: \{ enumerable: true/);
  assert.match(source, /manualWeatherOverride: \{/);
  assert.match(source, /manualWeatherVisualOnly: true/);

  const applySelection = sourceBetween(
    'function applyManualWeatherTestSelection()',
    '/** Publish pending versus run-locked mode state'
  );
  assert.match(applySelection, /if \(!launchOptions\.manualTest \|\| fatalRuntimeLocked\)/);
  assert.match(applySelection, /setForcedType\(manualWeatherSelect\.value \|\| null\)/);
  assert.match(applySelection, /updateZone\(performance\.now\(\)\)/);
  assert.match(applySelection, /updateWeatherForecast\(\)/);
  assert.doesNotMatch(
    applySelection,
    /state\.(?:speed|distance|lives|score|routeCursor|pathPlan|autoPilot)\s*=/
  );

  assert.match(weatherSource, /function setForcedType\(typeId\)/);
  assert.match(weatherSource, /activeForcedWeather = normalizedTypeId/);
  assert.match(weatherSource, /forcedType: activeForcedWeather/);
});

test('renderer failures stop the loop and context loss uses the recovery surface', () => {
  assert.match(source, /webglcontextlost/);
  assert.match(source, /function stopForRenderingFailure/);
  assert.match(source, /startup\.showError\(error/);
  assert.match(source, /webgl-first-frame-failed/);
  assert.match(source, /window\.cancelAnimationFrame\(animationFrameId\)/);
});

test('renderer budget applies at startup and resize while debug audits can reset only frame diagnostics', () => {
  // Startup and quality commit/rollback use the current snapshot; viewport commits resolve one measured successor.
  assert.equal((source.match(/renderer\.setPixelRatio\(rendererPixelRatio\(\)\)/g) || []).length, 3);
  assert.match(
    functionSource('commitViewportPresentation'),
    /const nextPixelRatio = rendererPixelRatio\(nextViewport\)[\s\S]*?if \(pixelRatioChanged\) renderer\.setPixelRatio\(nextPixelRatio\)/
  );
  assert.match(source, /modeling\.resolveRendererPixelRatio\(\{/);
  assert.doesNotMatch(source, /fps[\s\S]{0,120}(?:activeRenderQuality|applyRenderQuality|setPixelRatio)/i);
  assert.match(source, /resetFrameDiagnostics\(\) \{\s*resetFrameDiagnosticsWindow\(\);\s*return true;/);
  assert.match(source, /frameSampleCount: diagnostics\.frameSampleCount/);
  assert.match(source, /rendererBufferPixels: renderer\.domElement\.width \* renderer\.domElement\.height/);
});

test('one viewport coordinator owns CSS camera renderer post-processing HUD and map sizing', () => {
  const measure = functionSource('measureViewportPresentation');
  assert.match(measure, /const appBounds = app\.getBoundingClientRect\(\)/);
  assert.match(measure, /const visualViewport = window\.visualViewport/);
  assert.match(measure, /dpr: currentViewportDevicePixelRatio\(\)/);

  const syncCss = functionSource('syncViewportCssContract');
  for (const cssVariable of [
    '--mobile-vh',
    '--visual-viewport-width',
    '--visual-viewport-height',
    '--visual-viewport-offset-left',
    '--visual-viewport-offset-top'
  ]) {
    assert.match(syncCss, new RegExp(`setProperty\\('${cssVariable}'`));
  }

  const commit = functionSource('commitViewportPresentation');
  assert.match(commit, /const nextViewport = measureViewportPresentation\(\)/);
  assert.match(commit, /syncViewportCssContract\(nextViewport\)/);
  assert.match(commit, /camera\.aspect = nextViewport\.width \/ nextViewport\.height/);
  assert.match(commit, /rendererPixelRatio\(nextViewport\)/);
  assert.match(commit, /renderer\.setSize\(nextViewport\.width, nextViewport\.height, false\)/);
  assert.match(
    commit,
    /postProcessingPipeline\.setSize\(\s*nextViewport\.width,\s*nextViewport\.height,\s*renderer\.getPixelRatio\(\)/
  );
  assert.match(commit, /if \(sizeChanged \|\| pixelRatioChanged\)/);
  assert.match(commit, /syncMobileCockpitPresentation\(\)/);
  assert.match(commit, /sizeChanged \|\| visualSizeChanged/);

  const queue = functionSource('queueViewportPresentationSync');
  assert.match(queue, /if \(viewportPresentationFrameId !== null \|\| fatalRuntimeLocked\) return false/);
  assert.equal((queue.match(/window\.requestAnimationFrame/g) || []).length, 1);
  for (const marker of [
    "'window-resize'",
    "'orientation-change'",
    "'visual-viewport-resize'",
    "'visual-viewport-scroll'",
    "'app-resize-observer'",
    "'device-pixel-ratio'"
  ]) assert.match(source, new RegExp(marker));
  assert.match(source, /viewportPresentationSyncCount/);
  assert.match(source, /viewportDevicePixelRatio/);
});

test('low, medium, and high render quality switch only presentation buffers at launch or pause', () => {
  assert.match(source, /constructionQuality: requestedQuality === 'high' \|\| requestedQuality === 'mobile'/);
  assert.match(source, /renderQuality: requestedQuality === 'mobile'[\s\S]*?\['low', 'medium', 'high'\]\.includes/);
  assert.match(source, /const initialRenderQualityId = launchOptions\.renderQuality \|\| renderQualityContract\.defaultId/);
  assert.match(source, /qualityModeSelect\.value = activeRenderQuality\.id/);
  assert.match(source, /pixelRatioCap: activeRenderQuality\.pixelRatioCap/);
  assert.match(source, /maxRenderPixels: activeRenderQuality\.maxRenderPixels/);
  assert.match(source, /initialShadowMapSizes: \{[\s\S]*?activeRenderQuality\.sunShadowMapSize[\s\S]*?activeRenderQuality\.secondaryDirectionalShadowMapSize[\s\S]*?activeRenderQuality\.localShadowMapSize/);

  const applyQuality = sourceBetween(
    'function applyRenderQuality(requestedId, source =',
    'document.documentElement.dataset.renderQuality = activeRenderQuality.id'
  );
  assert.match(applyQuality, /if \(!renderQualityChangeAllowed\(\)\)/);
  assert.match(applyQuality, /physicalLightingRig\.setRenderQuality\(nextProfile\.id, nextProfile\)/);
  assert.match(applyQuality, /renderer\.setPixelRatio\(rendererPixelRatio\(\)\)/);
  assert.match(applyQuality, /postProcessingPipeline\.setEnabled\(nextProfile\.postProcessingEnabled === true\)/);
  assert.match(applyQuality, /cloverleafVisuals\?\.setRenderQuality\?\.\(nextProfile\.id\)/);
  assert.match(applyQuality, /shipVisuals\?\.setRenderQuality\?\.\(nextProfile\.id\)/);
  assert.match(applyQuality, /decorationLayer\?\.setRenderQuality\?\.\(nextProfile\.id\)/);
  assert.doesNotMatch(applyQuality, /updateTrackNetworkVisuals|initializeRouteCursor|clearRuntime|spawnObstacle|spawnPickup/);
  assert.doesNotMatch(
    applyQuality,
    /state\.(?:speed|distance|score|lives|lateral|routeCursor|pathPlan|gameplayElapsedSeconds)\s*=/
  );

  const pause = sourceBetween('function setPaused(force)', '/** Toggle the shared persisted preference');
  const gameOver = sourceBetween('function endGame()', 'function jump(');
  const resetGame = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  assert.match(pause, /syncRenderQualityPicker\(\)/);
  assert.match(gameOver, /syncRenderQualityPicker\(\)/);
  assert.match(resetGame, /syncRenderQualityPicker\(\)/);
  assert.match(source, /qualityModeSelect\.addEventListener\('change'/);
  assert.match(source, /quality: qualityProfile/);
  assert.match(source, /renderQualitySelectorDisabled: qualityModeSelect\.disabled/);
  assert.match(source, /renderQuality: \{[\s\S]*?get: \(\) => \{/);
  assert.match(source, /constructionQuality: \{ enumerable: true/);
});

test('one physical-lighting rig owns HDR rendering, real shadows, and reachable covered-route fixtures', () => {
  assert.match(source, /requireDependency\(window\.NeonLighting, 'Neon physical lighting module'\)/);
  assert.match(source, /const lightingBtn = document\.getElementById\('lightingBtn'\)/);
  assert.match(source, /requireDependency\(lightingBtn, 'Neon lighting toggle'\)/);
  assert.match(source, /lighting\.createPhysicalLightingRig\(\{/);
  assert.match(source, /physicalLightingRig\.setEnabled\(requestedEnabled\)/);
  assert.doesNotMatch(source, /setPhysicalLightingEnabled\(enabled\)/);
  const lightingPresentation = functionSource('syncLightingButtonPresentation');
  assert.match(
    lightingPresentation,
    /for \(const button of \[lightingBtn, mobileLightingBtn\]\)/
  );
  assert.match(lightingPresentation, /button\.setAttribute\('aria-pressed', String\(enabled\)\)/);
  assert.match(lightingPresentation, /button\.dataset\.lightingEnabled = String\(enabled\)/);
  assert.match(source, /lightingBtn\.addEventListener\('click', \(\) => toggleLighting\(\)\)/);
  const lightingToggle = functionSource('toggleLighting');
  assert.doesNotMatch(lightingToggle, /state\.[A-Za-z0-9_]+\s*=/);
  assert.doesNotMatch(source, /renderer\.shadowMap\.enabled = false/);
  for (const legacyName of ['ambient', 'sun', 'roadLight', 'sideLight', 'rearLight']) {
    assert.doesNotMatch(source, new RegExp(`const ${legacyName} = new THREE\\.(?:Hemisphere|Directional|Point)Light`));
  }
  const animateLoop = sourceBetween('function animate()', "startBtn.addEventListener('click'");
  const cameraAt = animateLoop.indexOf('updateCamera(simulationFrameDt)');
  const lightingAt = animateLoop.indexOf('updatePhysicalLighting(');
  const surfaceWeatherAt = animateLoop.indexOf('updateSurfaceWeather(surfaceContactFrameScratch)');
  const decorationAt = animateLoop.indexOf('updateDecoration(now');
  const renderAt = animateLoop.indexOf('renderPresentationFrame()');
  assert.ok(cameraAt >= 0 && cameraAt < lightingAt);
  assert.ok(lightingAt < surfaceWeatherAt && surfaceWeatherAt < decorationAt);
  assert.ok(decorationAt < renderAt);
  assert.match(source, /const disabledDynamicLocalFixtureEmitters = Object\.freeze\(\[\]\);/);
  assert.match(source, /dynamicLocalFixtureLightsProfileEnabled\s*=\s*activeRenderQuality\.dynamicLocalFixtureLights === true/);
  assert.match(source, /getActiveCoveredRouteLightEmitters/);
  assert.match(
    source,
    /const fixtureEmitters = dynamicLocalFixtureLightsProfileEnabled\s*\? \(cloverleafVisuals\?\.getActiveCoveredRouteLightEmitters\?\.\(\)/
  );
  assert.match(source, /: disabledDynamicLocalFixtureEmitters;/);
  assert.match(source, /fixtureEmitters,/);
  assert.match(source, /fixtureSelectionAnchor: camera\.position,/);
  assert.match(source, /routeEdgeId: state\.routeCursor\?\.edgeId \|\| playerFrameScratch\.edgeId \|\| null/);
  assert.match(source, /tunnelProfileId: playerFrameScratch\.tunnelProfileId \|\| null/);
  assert.match(source, /lightingFixtureEmitterMode: lightingDiagnostics\.fixtureEmitterMode/);
  assert.match(source, /lightingRequestedFixtureRouteEdgeId:/);
  assert.match(source, /lightingRequestedTunnelProfileId:/);
  assert.match(source, /lightingReachableFixtureEmitterRecordCount:/);
  assert.match(source, /lightingNearestMatchedFixtureDistanceM:/);
  assert.match(source, /lightingTunnelEmitterMode: lightingDiagnostics\.tunnelEmitterMode/);
  assert.match(source, /lightingTunnelFixtureAlignmentMaximumErrorM:/);
  assert.match(source, /lightingActiveTunnelEmitterIds: lightingDiagnostics\.activeTunnelEmitterIds/);
  assert.match(source, /renderQualityDynamicLocalFixtureLights:/);
  assert.match(
    source,
    /renderQualityDynamicLocalFixtureLightsRigEnabled:\s*lightingDiagnostics\.dynamicLocalFixtureLightsEnabled === true/
  );
  assert.match(source, /renderQualityDynamicLocalFixtureEmitterRecordCount:/);
  assert.match(source, /lightingEnabled: lightingDiagnostics\.enabled/);
  assert.match(source, /lightingCameraFollowingGuideLightCount: lightingDiagnostics\.cameraFollowingGuideLightCount/);
  assert.match(source, /lightingPlayerLocalLightCount: window\.NeonShip\.SKY_CAPE_ART_CONTRACT\.roadProjectingLocalLightCount/);
  assert.match(source, /lightingActivePlayerLocalLightCount: 0/);
  assert.match(source, /physicalMoonLight\.position\.x - physicalMoonTarget\.position\.x/);
  assert.match(source, /lightingOpaqueMainVisualShadowViolationCount/);
  assert.match(lightingSource, /mode: 'physical-hdr-shadowed'/);
  assert.doesNotMatch(lightingSource, /^\s*renderer\.useLegacyLights/m);
  assert.match(lightingSource, /renderer\.shadowMap\.enabled = true/);
  assert.match(lightingSource, /function setEnabled\(enabled\)/);
  assert.match(lightingSource, /fallbackAmbient\.visible = !lightingEnabled/);
  assert.match(lightingSource, /texture\.needsPMREMUpdate = true/);
  assert.match(lightingSource, /'authored-fixture-records'/);
  assert.doesNotMatch(lightingSource, /PhysicalLighting\.Guide|guidePoints|new THREE\.PointLight/);
  assert.doesNotMatch(lightingSource, /qualityProfile|devicePixelRatio/);
});

test('visible FPS reuses the one-second renderer audit and publishes a critical tier without another frame loop', () => {
  assert.match(source, /const fpsDisplayEl = document\.getElementById\('fpsDisplay'\)/);
  assert.match(source, /requireDependency\(fpsDisplayEl, 'Neon FPS display'\)/);
  const fpsDisplay = sourceBetween('function publishFpsDisplay()', '/** Collect each shared main-visual geometry');
  assert.match(fpsDisplay, /Math\.round\(diagnostics\.fps\)/);
  assert.match(fpsDisplay, /roundedFps >= 55[\s\S]*?\? 'smooth'[\s\S]*?: roundedFps >= 30 \? 'watch' : roundedFps >= 20 \? 'low' : 'critical'/);
  for (const key of ['smooth', 'watch', 'low', 'critical']) {
    assert.match(fpsDisplay, new RegExp(`uiText\\('hud\\.frameRate\\.${key}'\\)`));
  }
  assert.match(fpsDisplay, /const formattedFps = uiNumber\(roundedFps\)/);
  assert.match(fpsDisplay, /fpsDisplayEl\.textContent = uiText\('common\.framesPerSecond', \{ value: formattedFps \}\)/);
  assert.match(fpsDisplay, /fpsDisplayEl\.dataset\.fpsLevel = level/);
  assert.match(fpsDisplay, /fpsDisplayEl\.dataset\.fpsLabel = levelLabel/);
  assert.match(fpsDisplay, /uiText\('hud\.frameRate\.valueAria', \{ fps: formattedFps, state: levelLabel \}\)/);

  const framePublication = sourceBetween(
    'const diagnosticElapsed = now - diagnosticWindowStart',
    'if (launchOptions.modelDebug && !diagnosticTopologyCaptured'
  );
  const sampleAt = framePublication.indexOf('diagnostics.fps = diagnosticFrameCount * 1_000 / diagnosticElapsed');
  const displayAt = framePublication.indexOf('publishFpsDisplay()');
  const diagnosticsAt = framePublication.indexOf('publishDiagnostics()');
  assert.ok(sampleAt >= 0);
  assert.ok(sampleAt < displayAt);
  assert.ok(displayAt < diagnosticsAt);
  assert.equal((framePublication.match(/publishFpsDisplay\(\)/g) || []).length, 1);
  const languageSync = functionSource('syncLocalizedRuntimePresentation');
  assert.equal((languageSync.match(/publishFpsDisplay\(\)/g) || []).length, 1);
});

test('speedometer uses a reviewable road, target, and overspeed scale without capping digital output', () => {
  assert.match(source, /roadScaleKmh: 80/);
  assert.match(source, /roadScaleDialProgress: 0\.58/);
  assert.match(source, /targetKmh: Math\.round\(speedToKmh\(fairAutopilotContractSpeed\)\)/);
  assert.match(source, /targetDialProgress: 0\.79/);
  assert.match(source, /overspeedCompressionKmh: 48/);
  assert.match(source, /dialCenterX: 58/);
  assert.match(source, /dialCenterY: 52/);
  assert.match(source, /dialRadius: 48/);
  assert.match(source, /minimumNeedleDegrees: -90/);
  assert.match(source, /maximumNeedleDegrees: 90/);
  assert.match(source, /digitalReadoutUnbounded: true/);
  assert.match(source, /needleContinuesAboveTarget: true/);
  assert.match(source, /overspeedUsesContinuousCompression: true/);
  assert.match(source, /analogueIndicatorsShareEndpoint: true/);
  assert.match(source, /valueArcUsesPartialPath: true/);
  assert.doesNotMatch(source, /needleClampsAtTargetOnly/);
  assert.match(source, /requireDependency\([\s\S]*?'Neon speedometer'/);
  assert.match(source, /speedometer: \{ enumerable: true, get: \(\) => speedometerContract \}/);

  const progressHelperMatch = source.match(
    /function speedometerProgressForKmh\(speedKmh\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(progressHelperMatch, 'missing production speedometer progress helper');
  const progressForKmh = new Function(
    'speedometerContract',
    `'use strict'; ${progressHelperMatch[0]}; return speedometerProgressForKmh;`
  )({
    minimumKmh: 0,
    roadScaleKmh: 80,
    roadScaleDialProgress: 0.58,
    targetKmh: 120,
    targetDialProgress: 0.79,
    overspeedCompressionKmh: 48
  });
  const roadReferenceProgress = progressForKmh(80);
  const targetProgress = progressForKmh(120);
  const firstOverspeedProgress = progressForKmh(140);
  const doubleTargetProgress = progressForKmh(240);
  const extremeOverspeedProgress = progressForKmh(1_200);
  assert.equal(progressForKmh(-1), 0);
  assert.equal(progressForKmh(Number.NaN), 0);
  assert.equal(progressForKmh(40), 0.29);
  assert.equal(roadReferenceProgress, 0.58);
  assert.equal(targetProgress, 0.79);
  assert.ok(firstOverspeedProgress > targetProgress && firstOverspeedProgress < 1);
  assert.ok(doubleTargetProgress > firstOverspeedProgress && doubleTargetProgress < 1);
  assert.ok(extremeOverspeedProgress > doubleTargetProgress && extremeOverspeedProgress < 1);
  assert.equal(progressForKmh(Number.POSITIVE_INFINITY), 1);

  const dialHelperMatch = source.match(
    /function resolveSpeedometerDialPresentation\(speedKmh, target = \{\}\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(dialHelperMatch, 'missing production speedometer dial presentation helper');
  const speedometerContract = {
    minimumKmh: 0,
    roadScaleKmh: 80,
    roadScaleDialProgress: 0.58,
    targetKmh: 120,
    targetDialProgress: 0.79,
    overspeedCompressionKmh: 48,
    dialCenterX: 58,
    dialCenterY: 52,
    dialRadius: 48,
    minimumNeedleDegrees: -90,
    maximumNeedleDegrees: 90
  };
  const resolveDialPresentation = new Function(
    'speedometerContract',
    `'use strict'; ${progressHelperMatch[0]}; ${dialHelperMatch[0]}; return resolveSpeedometerDialPresentation;`
  )(speedometerContract);
  const alignmentCases = [
    { speedKmh: 40, progress: 0.29, degrees: -37.800000000000004, x: 28.580461424657138, y: 14.072559405966857 },
    { speedKmh: 80, progress: 0.58, degrees: 14.399999999999991, x: 69.93711458391303, y: 5.508008265825708 },
    { speedKmh: 100, progress: 0.685, degrees: 33.30000000000001, x: 84.35309526391033, y: 11.881246654323036 },
    { speedKmh: 120, progress: 0.79, degrees: 52.20000000000002, x: 95.92744059403314, y: 22.580461424657134 },
    { speedKmh: 140, progress: 0.851764705882353, degrees: 63.317647058823525, x: 100.88846732221188, y: 30.445896660924088 },
    { speedKmh: 160, progress: 0.8854545454545455, degrees: 69.38181818181818, x: 102.92549621383633, y: 35.09734370163737 },
    { speedKmh: 240, progress: 0.9400000000000001, degrees: 79.20000000000002, x: 105.14978803497706, y: 43.00569689988522 },
    { speedKmh: 1_200, progress: 0.9910638297872341, degrees: 88.39148936170213, x: 105.9810859153605, y: 50.65263428023601 }
  ];
  for (const expected of alignmentCases) {
    const presentation = resolveDialPresentation(expected.speedKmh);
    assert.ok(Math.abs(presentation.progress - expected.progress) <= 0.000_000_000_001);
    assert.ok(Math.abs(presentation.needleDegrees - expected.degrees) <= 0.000_000_001);
    assert.ok(Math.abs(presentation.arcEndX - expected.x) <= 0.000_000_001);
    assert.ok(Math.abs(presentation.arcEndY - expected.y) <= 0.000_000_001);
    const needleRadians = presentation.needleDegrees * Math.PI / 180;
    const transformedNeedleTipX = speedometerContract.dialCenterX
      + Math.sin(needleRadians) * speedometerContract.dialRadius;
    const transformedNeedleTipY = speedometerContract.dialCenterY
      - Math.cos(needleRadians) * speedometerContract.dialRadius;
    assert.ok(Math.abs(presentation.arcEndX - transformedNeedleTipX) <= 0.000_000_001);
    assert.ok(Math.abs(presentation.arcEndY - transformedNeedleTipY) <= 0.000_000_001);
    assert.equal(
      presentation.needleTransform,
      `rotate(${expected.degrees.toFixed(3)} 58 52)`
    );
    assert.match(presentation.arcPath, /^M 10 52 A 48 48 0 0 1 -?\d+\.\d{3} -?\d+\.\d{3}$/);
  }

  const speedometer = sourceBetween('function updateSpeedometer()', 'function updateHud(now)');
  assert.match(speedometer, /const speedKmh = speedToKmh\(state\.speed\)/);
  assert.match(speedometer, /resolveSpeedometerDialPresentation\([\s\S]*?speedometerDialPresentationScratch/);
  assert.match(speedometer, /const dialProgress = dialPresentation\.progress/);
  assert.match(speedometer, /const needleDegrees = dialPresentation\.needleDegrees/);
  assert.doesNotMatch(speedometer, /clamp\(speedKmh \/ speedometerContract\.targetKmh/);
  assert.match(speedometer, /const formattedSpeedNumber = uiNumber\(roundedSpeedKmh\)/);
  assert.match(speedometer, /speedValueEl\.textContent = formattedSpeedNumber/);
  assert.match(speedometer, /uiText\('hud\.speedometer\.valueAria', \{ speed: formattedSpeedNumber \}\)/);
  assert.match(speedometer, /\$\{uiText\('hud\.speedometer\.valueAria'[\s\S]*?\} · \$\{statusText\}/);
  assert.match(speedometer, /speedometerNeedleEl\.setAttribute\('transform', dialPresentation\.needleTransform\)/);
  assert.match(speedometer, /speedometerValueArcEl\.setAttribute\('d', dialPresentation\.arcPath\)/);
  assert.doesNotMatch(speedometer, /strokeDasharray|stroke-dasharray/);
  assert.match(speedometer, /speedometerEl\.dataset\.overTarget = String\(overTarget\)/);
  assert.match(speedometer, /speedometerEl\.dataset\.displayKmh = String\(roundedSpeedKmh\)/);
  assert.match(speedometer, /speedometerEl\.dataset\.targetProgress = speedometerContract\.targetDialProgress\.toFixed\(6\)/);
  assert.match(speedometer, /speedometerEl\.dataset\.scaleMode = overTarget \? 'compressed-overspeed' : 'segmented-target'/);
  assert.match(speedometer, /speedometerEl\.dataset\.analogueMode = 'shared-endpoint-path'/);
  assert.match(source, /sampleSpeedometerPresentation\(speedKmh\)/);
  assert.match(source, /speedometerNeedleContinuesAboveTarget: speedometerContract\.needleContinuesAboveTarget/);
  assert.match(source, /speedometerOverspeedUsesContinuousCompression:/);
  assert.doesNotMatch(speedometer, /state\.(?:speed|distance|lives|score|routeCursor|pathPlan)\s*=/);

  const hud = sourceBetween('function updateHud(now)', 'const fairnessProfileAtTerminal');
  assert.equal((hud.match(/updateSpeedometer\(\)/g) || []).length, 1);
  assert.doesNotMatch(hud, /speedEl\.textContent/);
});

test('candle progression drives one shared handling, propulsion, color, and HUD profile', () => {
  assert.match(source, /const candleHandlingContract = requireDependency\(/);
  assert.match(source, /handling: gameplayCore\.resolveCandleHandling\(0, \{\}\)/);
  assert.match(source, /function syncCandleHandling\(\)/);
  assert.match(source, /sampleHandlingProfile\(candleCount\)/);
  assert.doesNotMatch(source, /set(?:Candle|Exp|Handling)(?:Count|Profile)/);

  const kinematics = sourceBetween('function getPlayerKinematics(speed)', 'function getAutoKinematics(speed)');
  assert.match(
    kinematics,
    /baseMaximumLateralSpeed \* state\.handling\.lateralSpeedMultiplier \* surfaceLateralSpeed/
  );
  assert.match(
    kinematics,
    /baseMaximumLateralAcceleration[\s\S]*?state\.handling\.lateralAccelerationMultiplier[\s\S]*?\* surfaceLateralAcceleration/
  );
  assert.match(
    kinematics,
    /dragRate: baseDragRate \* state\.handling\.dragMultiplier \* surfaceLateralDrag/
  );
  assert.doesNotMatch(kinematics, /state\.(?:speed|distance|lives|score|routeCursor|pathPlan)\s*=/);
  assert.match(source, /function getAutoKinematics\(speed\) \{\s*return getPlayerKinematics\(speed\);\s*\}/);

  const reset = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  assert.match(reset, /state\.expCount = 0;\s*state\.expStreak = 0;\s*syncCandleHandling\(\);/);
  const pickup = sourceBetween('function collectPickupAtIndex(index)', '/**\n   \* Resolve the logical contact timeline');
  assert.match(pickup, /state\.expCount \+= 1;\s*state\.expStreak = Math\.min\(99, state\.expStreak \+ 1\);\s*syncCandleHandling\(\);/);
  assert.match(pickup, /candidate\.id !== item\.id/);
  assert.doesNotMatch(pickup, /state\.(?:speed|propulsionCoreRpm)\s*=/);

  const longitudinal = sourceBetween(
    'function updateLongitudinalControl(dt)',
    'const autoPlannerTargetHz'
  );
  assert.match(longitudinal, /maximumRpm:\s*state\.handling\.maximumRpm/);
  assert.match(
    longitudinal,
    /spoolUpRatePerSecond:\s*state\.handling\.spoolUpRatePerSecond/
  );

  const meter = functionSource('updateHandlingMeter');
  assert.match(meter, /displayedHandlingCandleCount === state\.handling\.candleCount/);
  assert.match(meter, /const formattedCandleCount = uiNumber\(state\.handling\.candleCount\)/);
  assert.match(meter, /handlingFillEl\.style\.transform = `scaleX\(/);
  assert.match(meter, /handlingGaugeEl\.setAttribute\('aria-valuenow'/);
  assert.match(meter, /uiText\('hud\.handling\.valueAria', \{[\s\S]*?count: formattedCandleCount,[\s\S]*?value: displayText/);
  assert.doesNotMatch(meter, /state\.(?:speed|distance|lives|score|routeCursor|pathPlan|expCount)\s*=/);
  const hud = sourceBetween('function updateHud(now)', 'const fairnessProfileAtTerminal');
  assert.equal((hud.match(/updateHandlingMeter\(\)/g) || []).length, 1);
  const propulsionMeter = sourceBetween(
    'function updatePropulsionCoreMeter()',
    'let displayedHandlingCandleCount'
  );
  assert.match(propulsionMeter, /maximumRpm[\s\S]*?state\.handling\.maximumRpm/);
  assert.match(
    propulsionMeter,
    /propulsionCoreRpmMeterEl\.setAttribute\('aria-valuemax', String\(roundedMaximumRpm\)\)/
  );
  assert.match(propulsionMeter, /state\.handling\.spoolUpRatePerSecond/);

  for (const marker of [
    'handlingProgress:',
    'handlingDisplayPercent:',
    'handlingLateralAccelerationMultiplier:',
    'handlingLateralSpeedMultiplier:',
    'handlingDragMultiplier:',
    'handlingMaximumRpm:',
    'handlingSpoolUpRatePerSecond:',
    'handlingColorProgress:',
    'shipCandleColorProgress:',
    'handlingSharedAuthority:',
    'handlingMeterMatchesPhysics:',
    'propulsionMeterMaximumMatchesProfile:'
  ]) {
    assert.match(source, new RegExp(marker));
  }
});

test('life and candle HUD projectors own disjoint semantic state', () => {
  assert.match(source, /const lifeMetricEl = document\.getElementById\('lifeMetric'\)/);
  assert.match(
    source,
    /const lifeSlotEls = \[\.\.\.document\.querySelectorAll\('#livesHearts \.life-slot\[data-life-slot\]'\)\]/
  );

  const lifeMeter = functionSource('updateLifeMeter');
  assert.match(lifeMeter, /displayedLives === state\.lives/);
  assert.match(
    lifeMeter,
    /const visibleLives = clamp\(Math\.trunc\(Number\(state\.lives\) \|\| 0\), 0, 3\)/
  );
  assert.match(
    lifeMeter,
    /const lifeState = visibleLives >= 3[\s\S]*?\? 'healthy'[\s\S]*?: visibleLives === 2[\s\S]*?\? 'wounded'[\s\S]*?: visibleLives === 1 \? 'critical' : 'depleted'/
  );
  assert.match(lifeMeter, /lifeMetricEl\.dataset\.lifeState = lifeState/);
  assert.match(lifeMeter, /lifeMetricEl\.dataset\.lifeCount = String\(visibleLives\)/);
  assert.match(
    lifeMeter,
    /for \(let index = 0; index < lifeSlotEls\.length; index\+\+\)[\s\S]*?lifeSlotEls\[index\]\.dataset\.lifeActive = String\(index < visibleLives\)/
  );
  assert.doesNotMatch(
    lifeMeter,
    /\b(?:handlingMetricEl|handlingValueEl|handlingGaugeEl|handlingFillEl|expCountEl|mobileGlanceCandlelightEl|mobileGlanceCandlelightMetricEl)\b/
  );

  const handlingMeter = functionSource('updateHandlingMeter');
  assert.match(handlingMeter, /handlingMetricEl\.dataset\.handlingLevel\s*=\s*level/);
  assert.match(
    handlingMeter,
    /state\.handling\.progress <= 0[\s\S]*?\? 'base'[\s\S]*?: state\.handling\.progress < 0\.30[\s\S]*?\? 'responsive'[\s\S]*?: state\.handling\.progress < 0\.70 \? 'agile' : 'elite'/
  );
  assert.match(
    handlingMeter,
    /const handlingProgressText = state\.handling\.progress\.toFixed\(6\)/
  );
  assert.match(
    handlingMeter,
    /mobileGlanceCandlelightMetricEl\.style\.setProperty\(\s*'--mobile-candle-progress',\s*handlingProgressText\s*\)/
  );
  assert.match(
    handlingMeter,
    /mobileGlanceCandlelightMetricEl\.dataset\.handlingProgress = handlingProgressText/
  );
  assert.doesNotMatch(
    handlingMeter,
    /\b(?:lifeMetricEl|lifeSlotEls|livesEl|livesHeartsEl|livesCountEl|mobileGlanceLivesEl|mobileGlanceLifeMetricEl)\b/
  );

  const hud = sourceBetween('function updateHud(now)', 'const fairnessProfileAtTerminal');
  assert.equal((hud.match(/updateLifeMeter\(\)/g) || []).length, 1);
  assert.equal((hud.match(/updateHandlingMeter\(\)/g) || []).length, 1);
  assert.doesNotMatch(hud, /lifeMetricEl\.dataset|handlingMetricEl\.dataset/);
});

test('ordinary damage shares one active-gameplay protection gate and one render-frame latch', () => {
  assert.match(
    source,
    /const damageProtectionContract = requireDependency\([\s\S]*?gameplayCore\.DAMAGE_PROTECTION_CONTRACT[\s\S]*?typeof gameplayCore\.advanceDamageInvulnerability === 'function'[\s\S]*?typeof gameplayCore\.canAcceptOrdinaryDamage === 'function'/
  );
  assert.match(source, /damageAcceptedThisRenderFrame:\s*false/);
  assert.match(source, /damageFeedbackSerial:\s*0/);
  assert.match(source, /damageBlockedCount:\s*0/);
  assert.match(source, /guardrailDamageCount:\s*0/);

  const guardrailDamage = functionSource('takeCurveGuardrailDamage');
  assert.match(guardrailDamage, /return takeDamage\(-1, 'guardrail'\)/);
  assert.doesNotMatch(
    guardrailDamage,
    /state\.(?:lives|invincibleTimer|lastDamage|damageCount)\s*=|recordTrackEvent|playAudio/,
    'Guardrail damage must not bypass the unified ordinary-damage authority'
  );

  const damage = functionSource('takeDamage');
  const activeGuardAt = damage.indexOf(
    'if (!state.running || state.gameOver || state.paused) return false;'
  );
  const protectionGateAt = damage.indexOf('gameplayCore.canAcceptOrdinaryDamage(');
  const latchAt = damage.indexOf('state.damageAcceptedThisRenderFrame = true;');
  const timerAt = damage.indexOf(
    'state.invincibleTimer = damageProtectionContract.invulnerabilitySeconds;'
  );
  const damageCountAt = damage.indexOf('state.damageCount++;');
  const guardrailDamageCountAt = damage.indexOf(
    "if (source === 'guardrail') state.guardrailDamageCount++;"
  );
  const lifeAt = damage.indexOf('state.lives = Math.max(0, state.lives - 1);');
  assert.ok(activeGuardAt >= 0);
  assert.ok(activeGuardAt < protectionGateAt);
  assert.ok(protectionGateAt < latchAt);
  assert.ok(latchAt < timerAt);
  assert.ok(timerAt < damageCountAt);
  assert.ok(damageCountAt < guardrailDamageCountAt);
  assert.ok(guardrailDamageCountAt < lifeAt);
  assert.match(
    damage,
    /if \(!gameplayCore\.canAcceptOrdinaryDamage\([\s\S]*?state\.damageBlockedCount\+\+;[\s\S]*?return false;/
  );
  assert.match(damage, /state\.damageFeedbackSerial\+\+;/);
  assert.equal(
    (damage.match(/state\.guardrailDamageCount\+\+;/g) || []).length,
    1,
    'an accepted guardrail life loss must commit exactly one labelled rating event'
  );
  assert.match(
    damage,
    /state\.damageFeedbackPresentationRemainingSeconds\s*=\s*damageProtectionContract\.impactFeedbackSeconds/
  );
  assert.match(
    damage,
    /damageAnnouncementEl\.textContent = state\.lives > 0[\s\S]*?uiText\('hud\.damage\.announcement'[\s\S]*?uiText\('hud\.damage\.depletedAnnouncement'\)/
  );
  assert.match(damage, /if \(state\.lives <= 0\) endGame\(\);[\s\S]*?return true;/);
  assert.match(damage, /const postImpactSpeed = gameplayCore\.resolveImpactSpeed\(/);
  assert.match(damage, /state\.speed = postImpactSpeed/);
  assert.match(damage, /state\.lastDamage\.postImpactSpeed = postImpactSpeed/);

  assert.equal(
    (source.match(/state\.lives\s*=/g) || []).length,
    2,
    'Only reset and the unified ordinary-damage authority may assign lives'
  );
  const gameplayStep = functionSource('advanceGameplayStep');
  assert.match(
    gameplayStep,
    /state\.invincibleTimer = gameplayCore\.advanceDamageInvulnerability\(\s*state\.invincibleTimer,\s*dt\s*\)/
  );
  assert.doesNotMatch(
    gameplayStep,
    /state\.invincibleTimer = Math\.max\(0,\s*state\.invincibleTimer - dt\)/,
    'Runtime must consume the shared active-gameplay timer helper'
  );

  const presentationFrame = functionSource('renderPresentationFrame');
  const pipelineRenderAt = presentationFrame.indexOf('postProcessingPipeline.render()');
  const directRenderAt = presentationFrame.indexOf('renderer.render(scene, camera)');
  assert.ok(pipelineRenderAt >= 0);
  assert.ok(directRenderAt > pipelineRenderAt);

  const animate = functionSource('animate');
  const presentationCallAt = animate.indexOf('renderPresentationFrame();');
  const frameLatchResetAt = animate.indexOf('state.damageAcceptedThisRenderFrame = false;');
  const diagnosticsAt = animate.indexOf('diagnosticFrameCount++;');
  assert.ok(presentationCallAt >= 0);
  assert.ok(
    frameLatchResetAt > presentationCallAt && diagnosticsAt > frameLatchResetAt,
    'The frame latch may clear only after renderPresentationFrame returns successfully'
  );
  assert.equal(
    (source.match(/state\.damageAcceptedThisRenderFrame = false;/g) || []).length,
    2,
    'Only a new-run reset and a successfully presented frame may release the damage latch'
  );

  assert.doesNotMatch(
    animate.slice(0, animate.indexOf('gameplayCore.consumeBoundedElapsedTime(')),
    /damageAcceptedThisRenderFrame\s*=\s*false/,
    'Catch-up substeps must retain the previous accepted-damage latch until presentation succeeds'
  );
  assert.match(
    animate,
    /if \(state\.running && !state\.gameOver && !state\.paused\)[\s\S]*?gameplayCore\.consumeBoundedElapsedTime\(/
  );

  assert.match(
    gameplayStep,
    /if \(!state\.running \|\| state\.gameOver \|\| state\.paused\) return;/,
    'A terminal hit must stop all later catch-up substeps in the same render frame'
  );
  assert.match(gameplayStep, /updatePlayer\(dt, now\);[\s\S]*?if \(!state\.gameOver\) updateEntities\(dt, now\);/);

  const reset = functionSource('resetGame');
  for (const resetAssignment of [
    'state.damageBlockedCount = 0;',
    'state.damageFeedbackSerial = 0;',
    'state.damageFeedbackPresentationRemainingSeconds = 0;',
    'state.damageAcceptedThisRenderFrame = false;',
    'state.invincibleTimer = 0;'
  ]) {
    assert.match(reset, new RegExp(resetAssignment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(reset, /resetDamageFeedbackPresentation\(\)/);

  const shieldPresentation = functionSource('updateDamageProtectionPresentation');
  assert.match(
    shieldPresentation,
    /updateInvulnerabilityShieldPresentation\(\{[\s\S]*?remainingSeconds:\s*state\.lives > 0 && !state\.gameOver \? state\.invincibleTimer : 0,[\s\S]*?totalSeconds:\s*damageProtectionContract\.invulnerabilitySeconds,[\s\S]*?impactFeedbackSeconds:\s*damageProtectionContract\.impactFeedbackSeconds/
  );
  assert.match(shieldPresentation, /reducedMotion:\s*reducedMotionEnabled/);
  assert.match(shieldPresentation, /frozen:\s*!state\.running \|\| state\.paused \|\| state\.gameOver/);
  assert.match(
    shieldPresentation,
    /!state\.cameraCinematicActive && state\.viewMode === cameraViewHood[\s\S]*?'hood'[\s\S]*?!state\.cameraCinematicActive && state\.viewMode === cameraViewTop \? 'top' : 'external'/
  );
  assert.doesNotMatch(
    shieldPresentation,
    /state\.(?:lives|invincibleTimer|speed|distance|lateral)\s*=|shield\.material|shield\.rotation|\bnew\s+/,
    'Runtime shield projection cannot mutate authority or assume the ship ward is one Mesh'
  );

  const resetPresentation = functionSource('resetDamageFeedbackPresentation');
  assert.match(resetPresentation, /resetInvulnerabilityShieldPresentation\(\)/);
  assert.match(resetPresentation, /lifeProtectionTimeEl\.textContent = '';/);
  assert.match(resetPresentation, /hoodCollisionGuideEl\.dataset\.invincible = 'false';/);

  const damageFeedback = functionSource('updateDamageFeedbackPresentation');
  assert.match(
    damageFeedback,
    /const protectionProgress = protectedNow[\s\S]*?state\.invincibleTimer \/ damageProtectionContract\.invulnerabilitySeconds/
  );
  assert.equal(
    (damageFeedback.match(/--life-protection-progress/g) || []).length,
    3,
    'Desktop, legacy compact, and purpose-built mobile shield meters must consume the same authoritative progress'
  );
  assert.match(damageFeedback, /--hood-shield-progress/);
  assert.match(damageFeedback, /lifeProtectionTimeEl\.textContent = protectionSecondsText/);
  assert.match(
    source,
    /const damageProtectionCountdownCeilingSeconds = Math\.max\([\s\S]*?Math\.round\(damageProtectionContract\.invulnerabilitySeconds \* 10\) \/ 10/
  );
  assert.match(
    damageFeedback,
    /Math\.min\([\s\S]*?damageProtectionCountdownCeilingSeconds,[\s\S]*?Math\.max\(0\.1, Math\.ceil\(state\.invincibleTimer \* 10\) \/ 10\)/,
    'The quiet countdown must never exceed the displayed protection contract or fall to 0.0s while active'
  );

  assert.doesNotMatch(
    source,
    /player\.visible\s*=[^;]*Math\.floor\(/,
    'Invulnerability presentation must not blink the complete craft'
  );
  assert.doesNotMatch(
    source,
    /Math\.floor\(now \* 0\.018\) % 2/,
    'The former high-frequency visibility blink must not return'
  );
});

test('purpose-built mobile HUD mirrors the exact formatted primary speed, score, candle, and life values', () => {
  for (const [bindingName, elementId] of [
    ['mobileGlanceSpeedEl', 'mobileGlanceSpeed'],
    ['mobileGlanceScoreEl', 'mobileGlanceScore'],
    ['mobileGlanceCandlelightEl', 'mobileGlanceCandlelight'],
    ['mobileGlanceLivesEl', 'mobileGlanceLives'],
    ['mobileFlightSpeedEl', 'mobileFlightSpeed'],
    ['mobileFlightScoreEl', 'mobileFlightScore'],
    ['mobileFlightCandlelightEl', 'mobileFlightCandlelight'],
    ['mobileFlightLivesEl', 'mobileFlightLives']
  ]) {
    assert.match(
      source,
      new RegExp(`const ${bindingName} = document\\.getElementById\\('${elementId}'\\)`)
    );
  }

  const speedometer = functionSource('updateSpeedometer');
  assert.match(speedometer, /const formattedSpeedNumber = uiNumber\(roundedSpeedKmh\)/);
  assert.match(speedometer, /speedValueEl\.textContent = formattedSpeedNumber/);
  assert.match(speedometer, /mobileGlanceSpeedEl\.textContent = formattedSpeedNumber/);
  assert.match(speedometer, /mobileFlightSpeedEl\.textContent = formattedSpeedNumber/);

  const handlingMeter = functionSource('updateHandlingMeter');
  assert.match(handlingMeter, /const formattedCandleCount = uiNumber\(state\.handling\.candleCount\)/);
  assert.match(handlingMeter, /expCountEl\.textContent = formattedCandleCount/);
  assert.match(handlingMeter, /mobileGlanceCandlelightEl\.textContent = formattedCandleCount/);
  assert.match(handlingMeter, /mobileFlightCandlelightEl\.textContent = formattedCandleCount/);
  assert.match(handlingMeter, /mobileGlanceCandlelightMetricEl\.dataset\.handlingLevel = level/);
  assert.match(handlingMeter, /mobileFlightCandleMetricEl\.dataset\.handlingLevel = level/);

  const lifeMeter = functionSource('updateLifeMeter');
  assert.match(
    lifeMeter,
    /const formattedLifeCount = `\$\{uiNumber\(visibleLives\)\}\/\$\{uiNumber\(3\)\}`/
  );
  assert.match(lifeMeter, /livesCountEl\.textContent = formattedLifeCount/);
  assert.match(lifeMeter, /mobileGlanceLivesEl\.textContent = formattedLifeCount/);
  assert.match(lifeMeter, /mobileFlightLivesEl\.textContent = formattedLifeCount/);
  assert.match(lifeMeter, /mobileGlanceLifeMetricEl\.dataset\.lifeState = lifeState/);
  assert.match(lifeMeter, /mobileFlightLifeMetricEl\.dataset\.lifeState = lifeState/);

  const hud = functionSource('updateHud');
  assert.match(hud, /const formattedScore = uiNumber\(Math\.floor\(state\.score\)\)/);
  assert.match(hud, /scoreEl\.textContent = formattedScore/);
  assert.match(hud, /mobileGlanceScoreEl\.textContent = formattedScore/);
  assert.match(hud, /mobileFlightScoreEl\.textContent = formattedScore/);

  for (const projector of [speedometer, handlingMeter, lifeMeter, hud]) {
    assert.doesNotMatch(
      projector,
      /state\.(?:speed|distance|lives|score|routeCursor|pathPlan|expCount)\s*=/,
      'glance mirrors must not become a second gameplay authority'
    );
  }
});

test('P alone owns automatic longitudinal control while P-off M selects uncapped full throttle', () => {
  assert.match(source, /const automaticThrottleDefaultEnabled = false;/);
  assert.match(source, /manualThrottleMode: !automaticThrottleDefaultEnabled/);

  const authority = functionSource('longitudinalAuthorityMode');
  assert.match(authority, /if \(state\.autoPilot\) return 'autopilot'/);
  assert.match(authority, /return state\.manualThrottleMode \? 'player' : 'full-throttle'/);
  assert.doesNotMatch(authority, /cameraCinematic|cinematic/);
  const effectiveAutomaticThrottle = functionSource('automaticThrottleEffectivelyEnabled');
  assert.match(effectiveAutomaticThrottle, /return automaticDrivingAuthorityActive\(\) \|\| !state\.manualThrottleMode/);

  const longitudinalControl = sourceBetween(
    'function updateLongitudinalControl(dt)',
    'const autoPlannerTargetHz'
  );
  assert.match(longitudinalControl, /const authority = longitudinalAuthorityMode\(\)/);
  assert.match(
    longitudinalControl,
    /state\.manualAccelerating = authority === 'player' && keys\.throttle && !keys\.brake/
  );
  assert.match(
    longitudinalControl,
    /state\.throttleCommand = braking[\s\S]*?\? 0[\s\S]*?: authority === 'player'[\s\S]*?\? \(state\.manualAccelerating \? 1 : 0\)[\s\S]*?: authority === 'full-throttle'[\s\S]*?\? 1[\s\S]*?: resolveAutopilotThrottleCommand\(propulsionGear\)/
  );
  assert.match(
    longitudinalControl,
    /const obstacleBraking = Boolean\(\s*automaticDrivingAuthorityActive\(\)\s*&& state\.autoObstacleBrakeRequest\s*\)/
  );
  assert.doesNotMatch(longitudinalControl, /state\.manualThrottleMode/);
  assert.doesNotMatch(longitudinalControl, /gameplayCore\.resolveAutomaticThrottleCommand\(/);
  const autopilotThrottle = functionSource('resolveAutopilotThrottleCommand');
  assert.match(autopilotThrottle, /gameplayCore\.resolveAutomaticThrottleCommand\(/);
  assert.doesNotMatch(autopilotThrottle, /manualThrottleMode/);
  assert.match(longitudinalControl, /gameplayCore\.resolvePropulsionCoreStep\(/);
  assert.match(longitudinalControl, /propulsionStep\.averageAccelerationMps2/);
  assert.match(longitudinalControl, /gameplayCore\.resolveLongitudinalDynamicsStep\(/);
  assert.match(longitudinalControl, /state\.passiveResistanceMps2 = longitudinalStep\.passiveResistanceMps2/);
  assert.match(longitudinalControl, /state\.speed = state\.opposingVariantBoundaryStopped \? 0 : integratedSpeed/);
  assert.doesNotMatch(longitudinalControl, /state\.speed\s*\+=\s*normalAcceleration\s*\*\s*dt/);

  const presentation = sourceBetween(
    'function syncAutomaticThrottleButtonPresentation()',
    'function toggleAutomaticThrottle(force)'
  );
  const toggle = sourceBetween(
    'function toggleAutomaticThrottle(force)',
    'function takeCurveGuardrailDamage()'
  );
  assert.match(toggle, /const automaticThrottleEnabled = typeof force === 'boolean'/);
  assert.match(toggle, /state\.manualThrottleMode = !automaticThrottleEnabled/);
  assert.match(toggle, /if \(state\.manualThrottleMode && !state\.autoPilot\)/);
  assert.match(toggle, /syncAutomaticThrottleButtonPresentation\(\)/);
  assert.match(presentation, /const automaticThrottlePreferenceEnabled = !state\.manualThrottleMode/);
  assert.match(presentation, /const automaticThrottleEnabled = automaticThrottleEffectivelyEnabled\(\)/);
  assert.match(presentation, /classList\.toggle\('is-on', automaticThrottleEnabled\)/);
  assert.match(presentation, /setAttribute\('aria-pressed', String\(automaticThrottlePreferenceEnabled\)\)/);
  assert.match(presentation, /dataset\.automaticThrottleEnabled = String\(automaticThrottleEnabled\)/);
  assert.match(
    presentation,
    /dataset\.automaticThrottlePreferenceEnabled = String\([\s\S]*?automaticThrottlePreferenceEnabled[\s\S]*?\)/
  );
  assert.match(presentation, /dataset\.longitudinalAuthority = longitudinalAuthorityMode\(\)/);
  assert.match(presentation, /uiText\('hud\.throttle\.autopilotOwned'\)/);
  assert.match(presentation, /uiText\('hud\.throttle\.fullThrottle'\)/);
  assert.match(presentation, /uiText\('hud\.throttle\.onAria'\)[\s\S]*?uiText\('hud\.throttle\.offAria'\)/);
  assert.match(toggle, /return automaticThrottleEnabled/);

  const reset = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  assert.match(reset, /reset preserves the player's explicit in-page choice/);
  assert.doesNotMatch(reset, /state\.manualThrottleMode\s*=/);
  assert.match(source, /toggleAutomaticThrottle\(automaticThrottleDefaultEnabled\)/);
  assert.match(source, /speedModeBtn\.addEventListener\('click', \(\) => toggleAutomaticThrottle\(\)\)/);
  assert.match(source, /e\.code === 'KeyM' && !e\.repeat\) toggleAutomaticThrottle\(\)/);
  assert.doesNotMatch(source, /toggleManualThrottleMode/);
  assert.match(source, /automaticThrottleDefaultEnabled: \{ enumerable: true/);
  assert.match(
    source,
    /automaticThrottleEnabled: \{ enumerable: true, get: \(\) => automaticThrottleEffectivelyEnabled\(\) \}/
  );
  assert.match(source, /automaticThrottlePreferenceEnabled: \{[\s\S]*?get: \(\) => !state\.manualThrottleMode/);
  assert.match(source, /longitudinalAuthority: \{[\s\S]*?get: \(\) => longitudinalAuthorityMode\(\)/);
});

test('T switches independent transmission authority without rewriting throttle, speed, gear, or an accepted shift', () => {
  assert.match(source, /const driveTransmissionDefaultMode = driveTransmissionBootstrapContract\?\.defaultMode \?\? 'manual'/);
  assert.match(source, /driveTransmissionMode: driveTransmissionDefaultMode/);

  const presentation = functionSource('syncDriveTransmissionModeButtonPresentation');
  assert.match(presentation, /const transmissionAutomatic = automaticTransmissionEnabled\(\)/);
  assert.match(presentation, /transmissionModeBtn\.classList\.toggle\('is-on', transmissionAutomatic\)/);
  assert.match(presentation, /transmissionModeBtn\.setAttribute\('aria-pressed', String\(transmissionAutomatic\)\)/);
  assert.match(presentation, /transmissionModeBtn\.dataset\.transmissionMode = state\.driveTransmissionMode/);
  assert.match(presentation, /mobileTransmissionModeBtn\.classList\.toggle\('is-on', transmissionAutomatic\)/);
  assert.match(presentation, /mobileTransmissionModeBtn\.setAttribute\('aria-pressed', String\(transmissionAutomatic\)\)/);
  assert.match(presentation, /mobileTransmissionModeBtn\.dataset\.transmissionMode = state\.driveTransmissionMode/);

  const toggleSource = functionSource('toggleDriveTransmissionMode');
  assert.match(toggleSource, /state\.driveTransmissionMode = requestedMode/);
  assert.match(toggleSource, /state\.gearShiftRejectReason = null/);
  assert.match(toggleSource, /state\.gearShiftRejectPresentationUntil = 0/);
  assert.match(toggleSource, /syncDriveTransmissionModeButtonPresentation\(\)/);
  assert.match(toggleSource, /syncGearControlPresentation\(\)/);
  assert.doesNotMatch(
    toggleSource,
    /state\.(?:manualThrottleMode|speed|driveGear|pendingDriveGear|gearShiftRemainingSeconds)\s*=/
  );

  assert.match(
    source,
    /transmissionModeBtn\.addEventListener\('click', \(\) => toggleDriveTransmissionMode\(\)\)/
  );
  assert.match(
    source,
    /mobileTransmissionModeBtn\.addEventListener\('click', \(\) => toggleDriveTransmissionMode\(\)\)/
  );
  assert.match(source, /e\.code === 'KeyT' && !e\.repeat\) toggleDriveTransmissionMode\(\)/);
  assert.match(
    functionSource('syncLocalizedRuntimePresentation'),
    /syncDriveTransmissionModeButtonPresentation\(\);\s*syncGearControlPresentation\(\);/
  );
  assert.match(source, /toggleDriveTransmissionMode\(driveTransmissionDefaultMode\)/);

  const reset = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  assert.doesNotMatch(reset, /state\.driveTransmissionMode\s*=/);

  const driveTransmissionContract = {
    automaticMode: 'automatic',
    manualMode: 'manual'
  };
  const state = {
    driveTransmissionMode: 'manual',
    manualThrottleMode: false,
    speed: 44.25,
    driveGear: 2,
    pendingDriveGear: 3,
    gearShiftRemainingSeconds: 0.18,
    gearShiftRejectReason: 'underspeed',
    gearShiftRejectPresentationUntil: 12_345,
    lastGearShiftRejectReason: 'underspeed'
  };
  let modePresentationSyncCount = 0;
  let gearPresentationSyncCount = 0;
  const toggleDriveTransmissionMode = new Function(
    'state',
    'fatalRuntimeLocked',
    'driveTransmissionContract',
    'gameplayCore',
    'automaticTransmissionEnabled',
    'syncDriveTransmissionModeButtonPresentation',
    'syncGearControlPresentation',
    `'use strict';\n${toggleSource}\nreturn toggleDriveTransmissionMode;`
  )(
    state,
    false,
    driveTransmissionContract,
    {
      resolveDriveTransmissionMode(mode, fallbackMode) {
        return mode === 'automatic' || mode === 'manual' ? mode : fallbackMode;
      }
    },
    () => state.driveTransmissionMode === driveTransmissionContract.automaticMode,
    () => { modePresentationSyncCount++; },
    () => { gearPresentationSyncCount++; }
  );
  const protectedState = () => ({
    manualThrottleMode: state.manualThrottleMode,
    speed: state.speed,
    driveGear: state.driveGear,
    pendingDriveGear: state.pendingDriveGear,
    gearShiftRemainingSeconds: state.gearShiftRemainingSeconds
  });
  const before = protectedState();

  assert.equal(toggleDriveTransmissionMode(), true);
  assert.equal(state.driveTransmissionMode, 'automatic');
  assert.deepEqual(protectedState(), before);
  assert.equal(state.gearShiftRejectReason, null);
  assert.equal(state.gearShiftRejectPresentationUntil, 0);
  assert.equal(state.lastGearShiftRejectReason, 'underspeed');
  assert.equal(modePresentationSyncCount, 1);
  assert.equal(gearPresentationSyncCount, 1);

  assert.equal(toggleDriveTransmissionMode(false), false);
  assert.equal(state.driveTransmissionMode, 'manual');
  assert.deepEqual(protectedState(), before);
  assert.equal(modePresentationSyncCount, 2);
  assert.equal(gearPresentationSyncCount, 2);
});

test('themed music consumes presentation state only and shares one trusted master-toggle boundary', () => {
  assert.match(source, /requireDependency\(window\.NeonMusicLibrary, 'Neon music library module'\)/);
  assert.match(source, /requireDependency\(window\.NeonMusicPlayer, 'Neon music player module'\)/);
  assert.match(
    source,
    /const modelDebugPreferenceStorage = launchOptions\.modelDebug[\s\S]*?getItem\(key\) \{ return startup\.readString\(key, ''\); \}[\s\S]*?setItem\(\) \{\}[\s\S]*?NeonAudio\.createController\([\s\S]*?storage: modelDebugPreferenceStorage[\s\S]*?NeonMusicPlayer\.createController\([\s\S]*?storage: modelDebugPreferenceStorage/,
    'modelDebug listening must read player opening preferences without persisting effect or score auditions'
  );
  assert.doesNotMatch(source, /launchOptions\.modelDebug \? \{ storage: null \}/);
  const musicUpdate = sourceBetween(
    '// Music consumes the shared realm',
    'updateTrackNetworkVisuals(now);'
  );
  assert.match(musicUpdate, /music\.update\(\{/);
  assert.match(musicUpdate, /realmIndex: state\.skyZoneIndex/);
  assert.match(musicUpdate, /realmProgress: state\.skyRealmProgress/);
  assert.match(musicUpdate, /musicGain: audioMix\?\.musicGain \?\? 0/);
  assert.match(musicUpdate, /previewing: isMusicLibraryOpen\(\)/);
  assert.doesNotMatch(
    musicUpdate,
    /state\.(?:speed|distance|lives|score|routeCursor|pathPlan|autoPilot)\s*=/
  );

  const toggle = sourceBetween('async function toggleAudio(event)', 'function toggleAutoPilot(');
  const effectsAt = toggle.indexOf('audio.setEnabled(turningOn, metadata)');
  const musicAt = toggle.indexOf('music.setEnabled(turningOn, metadata)');
  const awaitAt = toggle.indexOf('await Promise.all([effectsPromise, musicPromise])');
  assert.ok(effectsAt >= 0);
  assert.ok(effectsAt < musicAt);
  assert.ok(musicAt < awaitAt);
  assert.match(toggle, /if \(!turningOn\) playAudio\('sound-off'\)/);
  assert.match(toggle, /if \(turningOn\) playAudio\('sound-on'\)/);
});

test('semantic controls, weather, and lightning each own a non-stacked audio path', () => {
  const reset = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  assert.match(reset, /audio\.clearDeferredEvents\('game-reset'\)/);
  assert.match(reset, /playAudio\(commitReason === 'restart' \? 'restart' : 'start'\)/);
  const gameOver = sourceBetween('function endGame()', 'function jump(');
  assert.match(gameOver, /audio\.clearDeferredEvents\('game-over'\)/);
  const pause = sourceBetween('function setPaused(force)', 'function takeCurveGuardrailDamage()');
  assert.match(pause, /audio\.clearDeferredEvents\(nextPaused \? 'game-paused' : 'game-resumed'\)/);

  const lighting = sourceBetween('function toggleLighting(force)', 'function toggleAutoPilot(');
  assert.match(lighting, /enabled !== currentEnabled/);
  assert.match(lighting, /playAudio\(enabled \? 'lighting-on' : 'lighting-off'\)/);
  const autopilot = sourceBetween('function toggleAutoPilot(', 'function syncAutomaticThrottleButtonPresentation()');
  assert.match(autopilot, /state\.autoPilot !== previousAutoPilot/);
  assert.match(autopilot, /playAudio\(state\.autoPilot \? 'autopilot-on' : 'autopilot-off'\)/);
  const automaticThrottle = sourceBetween('function toggleAutomaticThrottle(force)', 'function takeCurveGuardrailDamage()');
  assert.match(automaticThrottle, /automaticThrottleEnabled !== previousAutomaticThrottleEnabled/);
  assert.match(
    automaticThrottle,
    /playAudio\(automaticThrottleEnabled \? 'auto-throttle-on' : 'auto-throttle-off'\)/
  );
  const view = sourceBetween('function cycleViewMode()', 'const cameraNearFrame');
  assert.match(view, /playAudio\('view-change'\)/);

  const zone = sourceBetween('function updateZone(now)', 'const viewModeNames');
  assert.match(zone, /const lightningEnvelope = lightningClusterEnvelope\(weatherState\)/);
  assert.match(zone, /audibleLightningPulse >= 0\.52 && previousAudibleLightningPulse < 0\.52/);
  assert.match(zone, /const thunderEventName = thunderEventNames\[thunderVariantSerial % thunderEventNames\.length\]/);
  assert.match(zone, /if \(playAudio\(thunderEventName\)\) thunderVariantSerial\+\+/);
  assert.match(source, /\['thunder-near', 'thunder-mid', 'thunder-far'\]/);

  const animateAudio = sourceBetween(
    '// Audio consumes the already-smoothed propulsion',
    'updateTrail(now);'
  );
  for (const binding of [
    'controlLeft: keys.left',
    'controlRight: keys.right',
    'controlThrottle: keys.throttle',
    'controlBrake: keys.brake',
    'weatherExposure: state.weatherAtmosphereExposure',
    'weatherTunnelSealed: state.weatherTunnelSealed',
    'weatherTunnelKind: state.weatherTunnelKind',
    'weatherTunnelShelter: state.weatherTunnelShelter',
    'weatherRain: state.weather?.rain',
    'weatherWind: state.weather?.wind',
    'weatherGust: state.weather?.gust',
    'weatherHail: state.weather?.hail',
    'weatherDust: state.weather?.dust',
    'weatherSnow: state.weather?.snow'
  ]) {
    assert.ok(animateAudio.includes(binding), `missing audio state binding ${binding}`);
  }

  const genericFeedback = sourceBetween(
    'const semanticAudioButtonSelector =',
    "window.addEventListener('keydown'"
  );
  for (const controlId of [
    '#startBtn',
    '#pauseRestartConfirmBtn',
    '#audioBtn',
    '#autoPilotBtn',
    '#speedModeBtn',
    '#viewBtn',
    '#pauseBtn',
    '#lightingBtn',
    '#controls .touch-btn'
  ]) {
    assert.ok(genericFeedback.includes(controlId), `${controlId} must opt out of generic click stacking`);
  }
  assert.equal(
    (genericFeedback.match(/!button\.matches\(semanticAudioButtonSelector\)/g) || []).length,
    2
  );
});

test('every registered fatal runtime error stops authority before one recovery presentation', () => {
  const fatalStop = sourceBetween('function stopForFatalError(', '/** Wrap WebGL failures');
  const filmReleaseAt = fatalStop.indexOf("setCinematicCamera(false, reason, { announce: false, audio: false })");
  const fatalLockAt = fatalStop.indexOf('fatalRuntimeLocked = true');
  const cancelFrameAt = fatalStop.indexOf('window.cancelAnimationFrame(animationFrameId)');
  const releaseInputsAt = fatalStop.indexOf('releaseAllInputs(reason)');
  const stopStateAt = fatalStop.indexOf('state.running = false');
  const destroyLoopAt = fatalStop.indexOf("for (const [label, controller] of [['effects', audio], ['music', music]])");
  const destroyAt = fatalStop.indexOf('controller.destroy()');
  const showErrorAt = fatalStop.indexOf('startup.showError(error');
  assert.ok(filmReleaseAt >= 0 && filmReleaseAt < fatalLockAt);
  assert.doesNotMatch(fatalStop, /releaseCinematicDrivingAuthority/);
  assert.ok(fatalLockAt < cancelFrameAt);
  assert.ok(cancelFrameAt < releaseInputsAt);
  assert.ok(releaseInputsAt < stopStateAt);
  assert.ok(stopStateAt < destroyLoopAt);
  assert.ok(destroyLoopAt < destroyAt);
  assert.ok(destroyAt < showErrorAt);
  assert.match(fatalStop, /destroyResult\?\.catch\?\./);
  assert.match(source, /startup\.registerFatalHandler\(\(error, options = \{\}\) => stopForFatalError/);
});

test('fatal shutdown retires only the Film camera before lock without changing P, M, T, or gear', () => {
  const fatalStopSource = functionSource('stopForFatalError');
  const lockAt = fatalStopSource.indexOf('fatalRuntimeLocked = true');
  const filmReleaseAt = fatalStopSource.indexOf(
    "setCinematicCamera(false, reason, { announce: false, audio: false })"
  );
  const fallbackViewAt = fatalStopSource.indexOf('state.viewMode = clamp(');
  const fallbackFilmAt = fatalStopSource.indexOf('state.cameraCinematicActive = false');
  assert.ok(filmReleaseAt >= 0 && filmReleaseAt < lockAt);
  assert.ok(fallbackViewAt > filmReleaseAt && fallbackViewAt < lockAt);
  assert.ok(fallbackFilmAt > fallbackViewAt && fallbackFilmAt < lockAt);
  assert.doesNotMatch(
    fatalStopSource,
    /state\.(?:autoPilot|manualThrottleMode|driveTransmissionMode|driveGear|pendingDriveGear)\s*=/
  );
  assert.doesNotMatch(
    fatalStopSource,
    /cameraCinematic(?:DrivingAuthorityCaptured|PreviousManualThrottleMode|PreviousTransmissionMode|JumpMode|JumpDistanceM)|cinematicSafetyBrakeRemainingSeconds/
  );
});

test('the complete animation frame preserves the original runtime error for fatal recovery', () => {
  const animateSource = sourceBetween('function animate()', "startBtn.addEventListener('click'");
  const frameTryAt = animateSource.indexOf('try {');
  const frameRequestAt = animateSource.indexOf('requestAnimationFrame(animate)');
  const successfulFrameAt = animateSource.indexOf('completeLaunchCommitAfterSuccessfulFrame()');
  const frameCatchAt = animateSource.lastIndexOf('} catch (cause) {');
  assert.ok(frameTryAt >= 0 && frameTryAt < frameRequestAt);
  assert.ok(frameRequestAt < successfulFrameAt);
  assert.ok(successfulFrameAt < frameCatchAt);
  assert.match(
    animateSource.slice(frameCatchAt),
    /stopForFatalError\(cause,\s*\{\s*reason: 'runtime-frame-failure',[\s\S]*?'runtime-frame-failure'/
  );

  const originalError = new Error('route cursor escaped its adopted itinerary');
  const fatalStops = [];
  const animate = new Function(
    'fatalRuntimeLocked',
    'requestAnimationFrame',
    'stopForFatalError',
    `'use strict';\n${animateSource}\nreturn animate;`
  )(
    false,
    () => { throw originalError; },
    (error, options) => fatalStops.push({ error, options })
  );
  animate();
  assert.deepEqual(fatalStops, [{
    error: originalError,
    options: {
      reason: 'runtime-frame-failure',
      code: 'runtime-frame-failure'
    }
  }]);
});

test('fatal lock denies restart, shortcuts, touch controls, and button audio while preserving retry', () => {
  const fatalStop = sourceBetween('function stopForFatalError(', '/** Wrap WebGL failures');
  const resetGame = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  const holdButton = sourceBetween('function holdButton(', "holdButton(document.getElementById('leftBtn')");
  const eventLock = sourceBetween('function blockFatalInteraction(', "renderer.domElement.addEventListener('webglcontextlost'");
  assert.match(fatalStop, /fatalRuntimeLocked = true/);
  assert.ok(resetGame.indexOf('if (fatalRuntimeLocked)') < resetGame.indexOf('state.running = true'));
  assert.ok(keydown.indexOf('if (fatalRuntimeLocked)') < keydown.indexOf("e.code === 'Space'"));
  assert.ok(keydown.indexOf('if (fatalRuntimeLocked)') < keydown.indexOf("e.code === 'KeyR'"));
  assert.match(source, /startBtn\.addEventListener\('click', \(\) => \{\s*if \(fatalRuntimeLocked \|\| pendingLaunchCommit/);
  assert.match(source, /pauseRestartBtn\.addEventListener\('click', \(\) => \{\s*if \(fatalRuntimeLocked \|\| pendingLaunchCommit/);
  assert.match(source, /function playAudio\(name\) \{\s*if \(fatalRuntimeLocked\) return false;/);
  assert.match(holdButton, /addEventListener\('pointerdown',[\s\S]*?if \(fatalRuntimeLocked\) return;/);
  assert.match(holdButton, /addEventListener\('click',[\s\S]*?if \(fatalRuntimeLocked\) return;/);
  assert.match(eventLock, /closest\('#startupError'\)/);
  assert.match(eventLock, /event\.stopImmediatePropagation\(\)/);
  assert.equal((source.match(/audio\.play\(/g) || []).length, 1, 'All audio requests must pass playAudio');
});

test('launch isolation unlocks only after a committed frame and nested dialogs recompute prior state', () => {
  const isolation = sourceBetween(
    'function reconcileInteractionIsolation()',
    '/** Keep the visual launch layer'
  );
  const setVisible = sourceBetween(
    'function setLaunchOverlayVisible(visible)',
    'function setLaunchCommitControlsLocked'
  );
  const settle = sourceBetween(
    'function completeLaunchCommitAfterSuccessfulFrame()',
    'function isUsableFocusTarget'
  );
  const closeGuide = sourceBetween('function closeGuide(', '/** Arrow keys operate');
  const closeMusic = sourceBetween('function closeMusicLibrary(', '/** Trap keyboard focus');
  const closeRestartConfirmation = sourceBetween(
    'function closePauseRestartConfirmation(',
    '/** Keep every key inside the destructive confirmation'
  );

  assert.match(isolation, /isPauseRestartConfirmationOpen\(\)/);
  assert.match(
    isolation,
    /const startupLoadingActive = isStartupLoadingActive\(\) \|\| !runtimeStartupReady/
  );
  assert.match(
    isolation,
    /node\.inert = startupLoadingActive \|\| launchVisible \|\| auxiliaryModalOpen/
  );
  assert.match(
    isolation,
    /overlay\.inert = startupLoadingActive \|\| !launchVisible \|\| auxiliaryModalOpen/
  );
  assert.match(
    isolation,
    /String\(startupLoadingActive \|\| !launchVisible \|\| auxiliaryModalOpen\)/
  );
  assert.match(
    isolation,
    /runtimeStartupReady && !startupLoadingActive && launchVisible/
  );
  assert.match(setVisible, /reconcileInteractionIsolation\(\)/);
  assert.match(settle, /setLaunchOverlayVisible\(false\)/);
  assert.match(closeGuide, /reconcileInteractionIsolation\(\)/);
  assert.match(closeMusic, /reconcileInteractionIsolation\(\)/);
  assert.match(closeRestartConfirmation, /reconcileInteractionIsolation\(\)/);
  assert.doesNotMatch(closeGuide, /\.inert = false/);
  assert.doesNotMatch(closeMusic, /\.inert = false/);
  assert.doesNotMatch(closeRestartConfirmation, /\.inert = false/);
});

test('paused-run restart confirmation blocks bypasses and preserves cancellation state', () => {
  const open = sourceBetween(
    'function openPauseRestartConfirmation()',
    '/** Close without touching paused gameplay'
  );
  const close = sourceBetween(
    'function closePauseRestartConfirmation(',
    '/** Keep every key inside the destructive confirmation'
  );
  const confirmationKeydown = sourceBetween(
    'function handlePauseRestartConfirmationKeydown(event)',
    '/** The confirm button is the only paused-surface path'
  );
  const confirm = sourceBetween(
    'function confirmPauseRestart()',
    'function selectGuideTab('
  );
  const fatalStop = sourceBetween('function stopForFatalError(', '/** Wrap WebGL failures');
  const resetGame = sourceBetween(
    'function resetGame({ allowDuringStartup = false } = {})',
    'function endGame()'
  );
  const pause = sourceBetween('function setPaused(force)', 'function resetFrameDiagnosticsWindow()');
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");

  assert.match(open, /startup\.isUpdateNoticeActive\(\)/);
  assert.match(open, /!state\.running[\s\S]*?!state\.paused[\s\S]*?state\.gameOver/);
  assert.match(open, /pauseRestartConfirmation\.hidden = false/);
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
  assert.match(fatalStop, /closePauseRestartConfirmation\(false\)/);
  assert.match(resetGame, /if \(isPauseRestartConfirmationOpen\(\)\) return false/);
  assert.match(pause, /if \(!nextPaused && isPauseRestartConfirmationOpen\(\)\) return false/);
  assert.ok(keydown.indexOf('if (isPauseRestartConfirmationOpen())')
    < keydown.indexOf('if (isGuideOpen())'));
});

test('public diagnostics exclude live state and debug hooks stay narrow', () => {
  const diagnosticsBlock = sourceBetween('const diagnostics = {', 'let diagnosticWindowStart');
  assert.doesNotMatch(diagnosticsBlock, /\n\s*state\s*[,}]/);
  assert.match(source, /if \(launchOptions\.modelDebug\) \{[\s\S]*?getStateSnapshot/);
  assert.match(source, /window\.NeonDiagnostics = Object\.freeze\(publicDiagnostics\)/);
  assert.doesNotMatch(source, /NeonDiagnostics\.state/);
});

test('minimap committed views rebuild PathPlan metadata and disable itinerary extension', () => {
  const helperSource = sourceBetween(
    'function createMinimapPathPlanView(',
    '/** Expose only edges whose physical portal has been crossed'
  );
  const createView = new Function(
    'track',
    `'use strict';\n${helperSource}\nreturn createMinimapPathPlanView;`
  )({
    getEdge(edgeId) {
      return { length: { approach: 1_080, interchange: 550, outbound: 760 }[edgeId] };
    }
  });
  const fullPlan = {
    id: 'itinerary:test',
    itinerary: true,
    edgeIds: ['approach', 'interchange', 'outbound'],
    edgeIndexById: new Map([['approach', 0], ['interchange', 1], ['outbound', 2]]),
    cumulativeLengths: [0, 1_080, 1_630],
    length: 2_390
  };
  const view = createView(fullPlan, ['approach']);
  assert.equal(view.itinerary, false);
  assert.deepEqual(view.edgeIds, ['approach']);
  assert.deepEqual([...view.edgeIndexById], [['approach', 0]]);
  assert.deepEqual(view.cumulativeLengths, [0]);
  assert.equal(view.length, 1_080);

  const committedPlanSource = sourceBetween(
    '/** Expose only edges whose physical portal has been crossed',
    '/** Mirror the exact current/future visual graphs'
  );
  assert.equal((committedPlanSource.match(/createMinimapPathPlanView\(/g) || []).length, 2);
  assert.doesNotMatch(committedPlanSource, /committedMinimapPlanCache = \{\s*\.\.\.state\.pathPlan/);
});

test('minimap runtime wires distinct visible and standby canvases through both atomic presentation paths', () => {
  assert.match(source, /const minimapCanvas = document\.getElementById\('minimapCanvas'\)/);
  assert.match(source, /const minimapStandbyCanvas = document\.getElementById\('minimapCanvasStandby'\)/);
  const creationSource = sourceBetween('const cloverleafMap =', 'if (cloverleafMap) {');
  assert.match(
    creationSource,
    /minimapCanvas[\s\S]*?minimapStandbyCanvas[\s\S]*?minimapFactory\.create\(\{[\s\S]*?canvas: minimapCanvas,[\s\S]*?standbyCanvas: minimapStandbyCanvas/
  );
  assert.match(
    creationSource,
    /const legacyMinimapPresenter = !cloverleafMap[\s\S]*?minimapFrameCanvas !== minimapCanvas[\s\S]*?minimapFactory\.createAtomicPresenter\(\{[\s\S]*?canvas: minimapCanvas,[\s\S]*?standbyCanvas: minimapStandbyCanvas/
  );
  assert.doesNotMatch(creationSource, /standbyCanvas:\s*minimapCanvas\b/);
});

test('minimap reduced-motion changes re-enter the bounded frame loop instead of presenting from a settler', () => {
  const settlerSource = sourceBetween(
    'if (cloverleafMap) {',
    'const minimapGraphPlayerFrame = {}'
  );
  assert.match(settlerSource, /registerReducedMotionSettler\(\(\) => \{/);
  assert.match(settlerSource, /minimapNeedsDraw = true/);
  assert.doesNotMatch(settlerSource, /cloverleafMap\.syncMotionPreference\(\)/);
  assert.doesNotMatch(settlerSource, /cloverleafMap\.update\(/);
});

test('minimap accessible obstacle announcements use stable distance buckets', () => {
  const bucketSource = sourceBetween(
    'function minimapAccessibleDistanceBucket(distance)',
    'function minimapModeLabel(mode)'
  );
  const resolveBucket = new Function(
    `'use strict';\n${bucketSource}\nreturn minimapAccessibleDistanceBucket;`
  )();
  assert.equal(resolveBucket(Number.POSITIVE_INFINITY), null);
  assert.equal(resolveBucket(-15), 0);
  assert.equal(resolveBucket(6), 10);
  assert.equal(resolveBucket(119), 125);
  assert.equal(resolveBucket(224), 200);
  assert.equal(resolveBucket(476), 500);
  assert.equal(resolveBucket(549), 500);
  assert.equal(resolveBucket(551), 600);

  const statusSource = sourceBetween(
    'function updateMinimapStatus(',
    'function nearestMinimapObstacleDistance()'
  );
  const modeSource = sourceBetween('function minimapModeLabel(mode)', 'function minimapGuidanceArrow(kind)');
  assert.match(statusSource, /const obstacleBucket = minimapAccessibleDistanceBucket\(nearestObstacleDistance\)/);
  assert.match(statusSource, /uiText\('navigation\.statusRoadDetail'/);
  assert.match(statusSource, /uiText\('navigation\.obstacleDistance'/);
  assert.match(statusSource, /road: localizedEdgeFamily\(edge\?\.family\)/);
  assert.doesNotMatch(statusSource, /edge\?\.family \|\|/);
  assert.doesNotMatch(statusSource, /前方障碍\$\{Math\.round\(nearestObstacleDistance\)\}米/);

  const minimapPanel = { dataset: { mapMode: 'overview' } };
  const minimapRouteText = { textContent: '' };
  const minimapStatus = { textContent: '' };
  const minimapDiagnostics = { graph: { pickupDrawCount: 3 } };
  const state = {
    routeCursor: { edgeId: 'edge:active' },
    pathPlan: { kind: 'left', movementId: 'north-left' },
    roadDetailProgress: 1,
    autoPilot: true,
    activeDecisionNodeId: 'decision:north'
  };
  const updateStatus = new Function(
    'cloverleafMap',
    'state',
    'track',
    'minimapPanel',
    'minimapRouteText',
    'minimapStatus',
    'minimapDiagnostics',
    'minimapAccessibleDistanceBucket',
    'uiText',
    'uiSource',
    'uiNumber',
    'uiMeters',
    'automaticDrivingAuthorityActive',
    `'use strict';
    let minimapLastStatus = '';
    ${modeSource}
    ${statusSource}
    return updateMinimapStatus;`
  )(
    {},
    state,
    {
      getEdge: () => ({ family: 'loop-ramp', layer: 'upper', id: 'edge:active' }),
      getMovement: () => ({ routeType: 'mountain-tunnel', exitPort: 'north' })
    },
    minimapPanel,
    minimapRouteText,
    minimapStatus,
    minimapDiagnostics,
    resolveBucket,
    uiText,
    uiSource,
    uiNumber,
    uiMeters,
    () => state.autoPilot
  );
  testLanguage = 'zh-CN';
  updateStatus(74);
  assert.equal(
    minimapRouteText.textContent,
    '2A 山体隧道 · 北',
    'target road-detail progress changed status before that mode was presented'
  );
  minimapPanel.dataset.mapMode = 'road-detail';
  state.roadDetailProgress = 0;
  updateStatus(74);
  assert.equal(
    minimapRouteText.textContent,
    '巡航细节 · 障碍 74 米 · 烛光 3',
    'presented road-detail mode did not remain authoritative during its exit transition'
  );
  testLanguage = 'en';
  updateStatus(74);
  assert.equal(minimapRouteText.textContent, 'Cruise detail · Hazard 74 m · candlelight 3');
  assert.doesNotMatch(minimapStatus.textContent, /[\u3400-\u9fff]/u);
  testLanguage = 'zh-CN';
});

test('minimap presentation commits mode, orientation, threat, guidance, and status as one payload', () => {
  const modeSource = sourceBetween('function minimapModeLabel(mode)', 'function minimapGuidanceArrow(kind)');
  const arrowSource = sourceBetween('function minimapGuidanceArrow(kind)', '/** A recoverable frame may retry twice');
  const mobileTextSource = functionSource('commitMobileRouteText');
  const mobileCueSource = functionSource('syncMobileRouteNavigationCue');
  const commitSource = sourceBetween(
    '/** Commit every visible/readable map field',
    'function nearestMinimapObstacleDistance()'
  );
  const element = () => ({
    textContent: '',
    classList: {
      values: new Map(),
      toggle(name, value) {
        this.values.set(name, value);
      }
    }
  });
  const minimapPanel = { dataset: {} };
  const minimapModeText = element();
  const minimapOrientationText = element();
  const minimapInstructionIcon = element();
  const minimapInstructionText = element();
  const minimapGuidanceMeta = element();
  const mobileNavigationBtn = { dataset: { alertLevel: 'none' } };
  const mobileRouteIcon = element();
  const mobileRouteLabel = element();
  const mobileRouteInstruction = element();
  const mobileRouteMeta = element();
  const cloverleafExitText = element();
  const cloverleafSplitDistanceText = element();
  const cloverleafBrakeStateText = element();
  const minimapState = {
    manualBrake: false,
    autoBrake: false,
    autoBrakeReason: 'none',
    pathPlan: { kind: 'straight' }
  };
  const minimapKeys = { brake: false };
  const minimapHeadingStatus = {
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
  };
  const statusCalls = [];
  const commit = new Function(
    'minimapPanel',
    'minimapModeText',
    'minimapOrientationText',
    'minimapInstructionIcon',
    'minimapInstructionText',
    'minimapGuidanceMeta',
    'cloverleafExitText',
    'cloverleafSplitDistanceText',
    'cloverleafBrakeStateText',
    'minimapHeadingStatus',
    'pendingMinimapHeadingNumber',
    'pendingMinimapHeadingDirectionKey',
    'pendingMinimapMode',
    'state',
    'keys',
    'updateMinimapStatus',
    'uiText',
    'uiSource',
    'uiNumber',
    'uiMeters',
    'mobileNavigationBtn',
    'mobileRouteIcon',
    'mobileRouteLabel',
    'mobileRouteInstruction',
    'mobileRouteMeta',
    `'use strict';
${functionSource('resolveAutopilotBrakeMode')}
${functionSource('autopilotBrakeTranslationKey')}
${modeSource}
${arrowSource}
${mobileTextSource}
${mobileCueSource}
${commitSource}
return commitMinimapPresentation;`
  )(
    minimapPanel,
    minimapModeText,
    minimapOrientationText,
    minimapInstructionIcon,
    minimapInstructionText,
    minimapGuidanceMeta,
    cloverleafExitText,
    cloverleafSplitDistanceText,
    cloverleafBrakeStateText,
    minimapHeadingStatus,
    84,
    'direction.e',
    'standard',
    minimapState,
    minimapKeys,
    (nearest) => statusCalls.push(nearest),
    uiText,
    uiSource,
    uiNumber,
    uiMeters,
    mobileNavigationBtn,
    mobileRouteIcon,
    mobileRouteLabel,
    mobileRouteInstruction,
    mobileRouteMeta
  );

  testLanguage = 'zh-CN';
  commit(
    { mapMode: 'overview', northUp: true },
    {
      braking: false,
      nearestObstacleDistance: 74,
      kind: 'curve-left',
      label: '',
      routeType: 'mountain-tunnel',
      exitPort: 'north',
      distanceM: 73
    },
    74
  );
  assert.deepEqual(minimapPanel.dataset, {
    mapMode: 'overview',
    orientation: 'north-up',
    threatLevel: 'warning'
  });
  assert.equal(minimapModeText.textContent, '立交总览');
  assert.equal(minimapOrientationText.textContent, '北向朝上');
  assert.equal(minimapInstructionIcon.textContent, '↖');
  assert.equal(minimapInstructionText.textContent, '2A 山体隧道 · 北');
  assert.equal(minimapGuidanceMeta.textContent, '前方 73 米');
  assert.equal(mobileRouteIcon.textContent, '↖');
  assert.equal(mobileRouteInstruction.textContent, '2A 山体隧道 · 北');
  assert.equal(mobileRouteMeta.textContent, '前方 73 米');
  assert.equal(cloverleafExitText.textContent, '2A 山体隧道 · 北');
  assert.equal(cloverleafSplitDistanceText.textContent, '73 米');
  assert.equal(cloverleafBrakeStateText.classList.values.get('is-braking'), false);
  assert.equal(minimapHeadingStatus.attributes.get('aria-label'), '实时航向 084 度，东');
  assert.deepEqual(statusCalls, [74]);

  testLanguage = 'en';
  commit(
    { mapMode: 'overview', northUp: true },
    {
      braking: false,
      nearestObstacleDistance: 74,
      kind: 'curve-left',
      label: '',
      routeType: 'mountain-tunnel',
      exitPort: 'north',
      distanceM: 73
    },
    74
  );
  assert.equal(minimapModeText.textContent, 'Interchange overview');
  assert.equal(minimapOrientationText.textContent, 'North up');
  assert.equal(minimapInstructionText.textContent, '2A mountain tunnel · North');
  assert.equal(minimapGuidanceMeta.textContent, '73 m ahead');
  assert.equal(cloverleafExitText.textContent, '2A mountain tunnel · North');
  assert.equal(cloverleafSplitDistanceText.textContent, '73 m');
  assert.equal(minimapHeadingStatus.attributes.get('aria-label'), 'Live heading 084 degrees, East');
  assert.doesNotMatch([
    minimapModeText.textContent,
    minimapOrientationText.textContent,
    minimapInstructionText.textContent,
    minimapGuidanceMeta.textContent,
    cloverleafExitText.textContent,
    minimapHeadingStatus.attributes.get('aria-label')
  ].join(' '), /[\u3400-\u9fff]/u);

  minimapState.autoBrake = true;
  minimapState.autoBrakeReason = 'obstacle';
  commit(
    { mapMode: 'guided', northUp: false },
    {
      braking: true,
      nearestObstacleDistance: 180,
      kind: 'return',
      label: '',
      routeType: 'surface',
      exitPort: 'south'
    },
    180
  );
  assert.equal(minimapPanel.dataset.mapMode, 'guided');
  assert.equal(minimapPanel.dataset.orientation, 'heading-up');
  assert.equal(minimapPanel.dataset.threatLevel, 'danger');
  assert.equal(minimapInstructionIcon.textContent, '↩');
  assert.equal(cloverleafBrakeStateText.classList.values.get('is-braking'), true);
  assert.equal(cloverleafBrakeStateText.textContent, 'Automatic obstacle braking');
  assert.equal(minimapHeadingStatus.attributes.get('aria-label'), 'Live heading 084 degrees, East');
  assert.deepEqual(statusCalls, [74, 74, 180]);
  testLanguage = 'zh-CN';

  const updateSource = sourceBetween('function updateMinimap(now)', 'function updateSpeedLimitAlert()');
  const compassUpdateSource = sourceBetween(
    'function updateDesktopCompass(playerFrame)',
    '/** Match the CSS-computed external instrument'
  );
  assert.match(compassUpdateSource, /pendingMinimapHeadingNumber = headingNumber/);
  assert.match(compassUpdateSource, /pendingMinimapHeadingDirectionKey = directionKey/);
  assert.doesNotMatch(compassUpdateSource, /minimapHeadingStatus/);
  assert.match(
    source,
    /desktopCompassPlacement[\s\S]*viewport-left-safe-bay[\s\S]*desktopCompassState\.placement/
  );
  assert.match(source, /desktopCompassLeftInsetPx:\s*Number\(\(desktopCompassRect\?\.left \|\| 0\)/);
  const graphUpdateAt = updateSource.indexOf('graphDiagnostics = cloverleafMap.update({');
  const graphCatchAt = updateSource.indexOf('} catch (error) {', graphUpdateAt);
  const failureSnapshotAt = updateSource.indexOf('cloverleafMap.getDiagnostics()', graphCatchAt);
  const recoveryReturnAt = updateSource.indexOf('recordMinimapRecoverableFailure(error);', graphCatchAt);
  const graphCommitAt = updateSource.indexOf(
    'commitMinimapPresentation(graphDiagnostics, navigation, nearestObstacleDistance);',
    recoveryReturnAt
  );
  assert.ok(graphUpdateAt >= 0 && graphUpdateAt < graphCatchAt);
  assert.ok(graphCatchAt < failureSnapshotAt && failureSnapshotAt < recoveryReturnAt);
  assert.ok(recoveryReturnAt < graphCommitAt);
  assert.equal(
    (source.match(/commitMinimapPresentation\(/g) || []).length,
    3,
    'one definition plus graph and legacy successful-frame commits are expected'
  );
});

test('mobile speed-limit warning replaces the front route cue while desktop keeps a separate alert', () => {
  const mobileTextSource = functionSource('commitMobileRouteText');
  const alertSource = functionSource('updateSpeedLimitAlert');
  assert.match(alertSource, /const mobileAlertVisible = visible && mobileCockpitState\.active/);
  assert.match(alertSource, /const desktopAlertVisible = visible && !mobileCockpitState\.active/);
  assert.match(alertSource, /speedLimitAlertEl\.hidden = !desktopAlertVisible/);
  assert.match(alertSource, /speedLimitAlertEl\.toggleAttribute\('inert', !desktopAlertVisible\)/);
  assert.match(alertSource, /mobileNavigationBtn\.dataset\.alertLevel = alertLevel/);
  assert.match(alertSource, /commitMobileRouteText\(mobileRouteIcon, '!'\)/);
  assert.match(alertSource, /commitMobileRouteText\(\s*mobileRouteAnnouncement,/);
  assert.match(alertSource, /syncMobileRouteNavigationCue\(\)/);
  assert.match(mobileTextSource, /element\.textContent !== value/);

  const makeElement = () => ({
    hidden: false,
    textContent: '',
    dataset: { alertLevel: 'none' },
    attributes: new Map(),
    classes: new Map(),
    toggleAttribute(name, force) {
      if (force) this.attributes.set(name, '');
      else this.attributes.delete(name);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    classList: {
      values: new Map(),
      toggle(name, force) {
        this.values.set(name, Boolean(force));
      },
      remove(...names) {
        for (const name of names) this.values.set(name, false);
      }
    }
  });
  const state = {
    autoCurveSpeedLimit: 100,
    autoCurveDistance: 120,
    speed: 130,
    running: true,
    gameOver: false,
    paused: false
  };
  const mobileCockpitState = { active: true };
  const speedLimitAlertEl = makeElement();
  const speedLimitAlertLabelEl = makeElement();
  const cloverleafSuggestedSpeedText = makeElement();
  const mobileNavigationBtn = makeElement();
  const mobileRouteIcon = makeElement();
  const mobileRouteLabel = makeElement();
  const mobileRouteInstruction = makeElement();
  const mobileRouteMeta = makeElement();
  const mobileRouteAnnouncement = makeElement();
  let restoredRouteCueCount = 0;
  const updateAlert = new Function(
    'state',
    'mobileCockpitState',
    'speedLimitAlertEl',
    'speedLimitAlertLabelEl',
    'cloverleafSuggestedSpeedText',
    'mobileNavigationBtn',
    'mobileRouteIcon',
    'mobileRouteLabel',
    'mobileRouteInstruction',
    'mobileRouteMeta',
    'mobileRouteAnnouncement',
    'syncMobileRouteNavigationCue',
    'clamp',
    'minimumDriveSpeed',
    'formatSpeedKmh',
    'uiMeters',
    'uiText',
    `'use strict';
let lastMobileSpeedLimitAnnouncementSignature = '';
${mobileTextSource}
${alertSource}
return updateSpeedLimitAlert;`
  )(
    state,
    mobileCockpitState,
    speedLimitAlertEl,
    speedLimitAlertLabelEl,
    cloverleafSuggestedSpeedText,
    mobileNavigationBtn,
    mobileRouteIcon,
    mobileRouteLabel,
    mobileRouteInstruction,
    mobileRouteMeta,
    mobileRouteAnnouncement,
    () => { restoredRouteCueCount++; },
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    40,
    (value) => `${value} km/h`,
    (value) => `${value} m`,
    (key) => key === 'navigation.speedLimitAhead' ? '前方限速' : key
  );

  updateAlert();
  assert.equal(speedLimitAlertEl.hidden, true, 'desktop alert must have zero ownership on mobile');
  assert.equal(speedLimitAlertEl.attributes.has('inert'), true);
  assert.equal(speedLimitAlertEl.attributes.get('aria-hidden'), 'true');
  assert.equal(mobileNavigationBtn.dataset.alertLevel, 'danger');
  assert.equal(mobileRouteIcon.textContent, '!');
  assert.equal(mobileRouteLabel.textContent, '前方限速');
  assert.equal(mobileRouteInstruction.textContent, '100 km/h');
  assert.equal(mobileRouteMeta.textContent, '120 m');
  assert.equal(mobileRouteAnnouncement.textContent, '前方限速 · 100 km/h · 120 m');
  assert.equal(restoredRouteCueCount, 0);

  mobileRouteAnnouncement.textContent = 'unchanged-live-region';
  updateAlert();
  assert.equal(
    mobileRouteAnnouncement.textContent,
    'unchanged-live-region',
    'an unchanged mobile limit must not retrigger the live announcement'
  );

  mobileCockpitState.active = false;
  updateAlert();
  assert.equal(speedLimitAlertEl.hidden, false);
  assert.equal(speedLimitAlertEl.attributes.has('inert'), false);
  assert.equal(speedLimitAlertEl.attributes.get('aria-hidden'), 'false');
  assert.equal(mobileNavigationBtn.dataset.alertLevel, 'none');
  assert.equal(mobileRouteAnnouncement.textContent, '');
  assert.equal(restoredRouteCueCount, 1);

  mobileCockpitState.active = true;
  state.running = false;
  updateAlert();
  assert.equal(speedLimitAlertEl.hidden, true);
  assert.equal(mobileNavigationBtn.dataset.alertLevel, 'none');
  assert.equal(restoredRouteCueCount, 2);
});

test('minimap recoverable failures retry twice, escalate the third consecutive frame, and reset after success', () => {
  const recoverySource = sourceBetween(
    '/** A recoverable frame may retry twice',
    'function updateMinimapStatus('
  );
  const diagnostics = {
    recoverableFailureCount: 0,
    consecutiveRecoverableFailures: 0,
    recoveredSequenceCount: 0,
    recoveryEscalationCount: 0,
    lastRecoveryCode: null,
    lastRecoveryPhase: null
  };
  const recovery = new Function(
    'window',
    'minimapDiagnostics',
    'minimapConsecutiveFailureLimit',
    'stopForFatalError',
    'uiText',
    `'use strict';
    let minimapNeedsDraw = false;
    ${recoverySource}
    return {
      recordMinimapRecoverableFailure,
      commitMinimapRecoverySuccess,
      needsDraw: () => minimapNeedsDraw
    };`
  )(
    { NeonMinimapErrors: { isRecoverable: (error) => error?.recoverable === true } },
    diagnostics,
    3,
    (fatalError, options) => {
      fatalStops.push({ fatalError, options });
      return true;
    },
    uiText
  );
  const fatalStops = [];
  const error = Object.assign(new Error('transient map frame'), {
    recoverable: true,
    code: 'minimap-frame-render-failed',
    phase: 'frame-render'
  });
  assert.equal(recovery.recordMinimapRecoverableFailure(error), true);
  assert.equal(recovery.recordMinimapRecoverableFailure(error), true);
  assert.equal(recovery.needsDraw(), true);
  assert.equal(diagnostics.recoverableFailureCount, 2);
  assert.equal(diagnostics.consecutiveRecoverableFailures, 2);
  assert.equal(recovery.recordMinimapRecoverableFailure(error), false);
  assert.equal(diagnostics.recoverableFailureCount, 3);
  assert.equal(diagnostics.consecutiveRecoverableFailures, 3);
  assert.equal(diagnostics.recoveryEscalationCount, 1);
  assert.equal(diagnostics.lastRecoveryCode, 'minimap-frame-render-failed');
  assert.equal(diagnostics.lastRecoveryPhase, 'frame-render');
  assert.equal(fatalStops.length, 1);
  assert.equal(fatalStops[0].fatalError, error);
  assert.equal(fatalStops[0].options.reason, 'minimap-recovery-exhausted');

  diagnostics.consecutiveRecoverableFailures = 2;
  recovery.commitMinimapRecoverySuccess();
  assert.equal(diagnostics.consecutiveRecoverableFailures, 0);
  assert.equal(diagnostics.recoveredSequenceCount, 1);
  recovery.commitMinimapRecoverySuccess();
  assert.equal(diagnostics.recoveredSequenceCount, 1);

  const fatalContractError = new Error('fatal map contract');
  assert.equal(recovery.recordMinimapRecoverableFailure(fatalContractError), false);
  assert.equal(fatalStops.length, 2);
  assert.equal(fatalStops[1].fatalError, fatalContractError);
  assert.equal(fatalStops[1].options.reason, 'minimap-fatal-error');

  const animateSource = sourceBetween('function animate()', "startBtn.addEventListener('click'");
  const minimapUpdateAt = animateSource.indexOf('updateMinimap(now);');
  const fatalReturnAt = animateSource.indexOf('if (fatalRuntimeLocked) return;', minimapUpdateAt);
  const presentationAt = animateSource.indexOf('renderPresentationFrame();', minimapUpdateAt);
  assert.ok(minimapUpdateAt >= 0 && minimapUpdateAt < fatalReturnAt);
  assert.ok(fatalReturnAt < presentationAt);
});

test('minimap presentation owners dispose once and debug fault injection stays model-debug-only', () => {
  const disposeSource = sourceBetween(
    'function disposePresentationResources()',
    "window.addEventListener('pagehide'"
  );
  assert.match(disposeSource, /if \(presentationResourcesDisposed\) return false;/);
  assert.match(disposeSource, /presentationResourcesDisposed = true;/);
  assert.ok(disposeSource.indexOf('cloverleafMap?.destroy?.()') < disposeSource.indexOf('renderer.dispose()'));
  assert.ok(disposeSource.indexOf('legacyMinimapPresenter?.destroy?.()') < disposeSource.indexOf('renderer.dispose()'));
  assert.match(source, /if \(!event\.persisted\) disposePresentationResources\(\)/);

  const debugSource = sourceBetween(
    'if (launchOptions.modelDebug) {',
    'window.NeonDiagnostics = Object.freeze(publicDiagnostics)'
  );
  assert.match(
    debugSource,
    /debugFailNextMinimapFrame\(phase = 'presentation'\) \{\s*return cloverleafMap\?\.debugFailNextFrame\?\.\(phase\) === true;\s*\}/
  );
  assert.equal((source.match(/debugFailNextMinimapFrame/g) || []).length, 1);
});

test('desktop non-interchange and straight-fork maps keep the actual road-detail projection and live pickup information', () => {
  const statusSource = sourceBetween(
    'function updateMinimapStatus(',
    'function nearestMinimapObstacleDistance()'
  );
  assert.match(statusSource, /visiblePickupCount = Math\.max\(0, Math\.trunc\(minimapDiagnostics\.graph\?\.pickupDrawCount \|\| 0\)\)/);
  assert.match(statusSource, /uiText\('navigation\.roadDetailStatus', \{/);
  assert.match(statusSource, /pickupCount: uiNumber\(visiblePickupCount\)/);
  assert.match(statusSource, /uiText\('navigation\.statusRoadDetail', \{/);
  assert.match(statusSource, /road: localizedEdgeFamily\(edge\?\.family\)/);
  assert.doesNotMatch(statusSource, /edge\?\.family \|\|/);

  const modeSource = sourceBetween(
    'function updateCloverleafMapMode(now)',
    '/** Render a camera-independent route map'
  );
  assert.doesNotMatch(modeSource, /getUpcomingDecisions|nextDistance|afterExitDistance/);
  assert.match(modeSource, /edge\.interchangeClearZone === true/);
  assert.match(modeSource, /edge\.family !== 'approach'/);
  assert.doesNotMatch(modeSource, /\['approach', 'recovery', 'launch', 'launch-fork'\]/);
  assert.doesNotMatch(modeSource, /straight-fork-approach|straight-fork-branch/);
  assert.match(modeSource, /const shouldExpand = insideInterchange/);
  assert.match(modeSource, /const shouldShowRoadDetail = Boolean\(edge\) && !insideInterchange/);
  assert.match(modeSource, /const shouldSuperExpand = shouldShowRoadDetail/);
  assert.match(modeSource, /const shouldGuide = shouldExpand &&/);
  assert.doesNotMatch(modeSource, /routeSignedCurvature|runtimeKind === 'recovery'/);
  assert.match(modeSource, /const roadDetailWasActive = state\.roadDetailProgress > 0\.5/);
  assert.match(modeSource, /shouldSuperExpand !== state\.minimapSuperExpanded/);
  assert.match(modeSource, /shouldShowRoadDetail !== roadDetailWasActive/);
  assert.match(modeSource, /state\.cloverleafMapModeChangedAt = now/);
  assert.match(modeSource, /classList\.toggle\('is-super-expanded', shouldSuperExpand\)/);
  assert.match(modeSource, /classList\.toggle\('is-road-detail', shouldShowRoadDetail\)/);
  assert.match(modeSource, /state\.cloverleafOverviewProgress = shouldExpand \? 1 : 0/);
  assert.match(modeSource, /state\.cloverleafGuidedProgress = shouldGuide \? 1 : 0/);
  assert.match(modeSource, /state\.roadDetailProgress = shouldShowRoadDetail \? 1 : 0/);
});

test('spawn success counters are owned by their timer channels', () => {
  const obstacleSpawner = sourceBetween('function spawnObstacle(', 'function spawnPickup(');
  const pickupSpawner = sourceBetween('function spawnPickup(', "requireDependency(window.NeonWorld");
  assert.doesNotMatch(obstacleSpawner, /SpawnObjects\+\+/);
  assert.doesNotMatch(pickupSpawner, /SpawnObjects\+\+/);
  assert.equal((source.match(/state\.obstacleSpawnObjects\+\+/g) || []).length, 2);
  assert.equal((source.match(/state\.trafficSpawnObjects\+\+/g) || []).length, 2);
  assert.equal((source.match(/state\.pickupSpawnObjects\+\+/g) || []).length, 1);
});

test('accepted spawns deterministically prewarm the destination-owned opposing carriageway', () => {
  const placement = sourceBetween(
    'function opposingPrewarmPlacementForEntity(',
    '/** Clone one accepted hazard event'
  );
  const obstaclePrewarm = sourceBetween(
    'function prewarmOpposingObstacle(',
    '/** Clone one accepted candle event'
  );
  const pickupPrewarm = sourceBetween(
    'function prewarmOpposingPickup(',
    '/**\n   * Expand a moving traffic group'
  );
  const obstacleSpawner = sourceBetween('function spawnObstacle(', 'function spawnPickup(');
  const pickupSpawner = sourceBetween('function spawnPickup(', "requireDependency(window.NeonWorld");

  assert.match(placement, /const previewPlan = opposingPrewarmPlanForTile\(tile\)/);
  assert.match(placement, /candidate\.index === \(sourceTile\?\.index \?\? -1\) \+ 1/);
  assert.match(placement, /const proxyEdgeId = opposingRecovery\?\.proxyEdgeId/);
  assert.match(placement, /const crossoverEdgeId = opposingRecovery\?\.crossoverEdgeId/);
  assert.match(placement, /opposingRecovery\?\.stabilizationLength/);
  assert.match(
    placement,
    /opposingPrewarmCandidateSegments\[1\]\.endS = crossoverLandingLength/
  );
  assert.match(placement, /motionGate: Object\.freeze\(\{/);
  assert.match(placement, /edgeId: crossoverEdgeId/);
  assert.match(placement, /maximumEdgeS: crossoverLandingLength/);
  assert.match(placement, /const cursor = nearestOpposingPrewarmCursor\(/);
  assert.match(placement, /edgeId: cursor\.edgeId/);
  assert.match(placement, /edgeS: cursor\.edgeS/);
  assert.match(placement, /lateral: -\(entity\.lateral \|\| 0\)/);
  assert.match(placement, /sourceEdge\?\.family === 'opposing-recovery-proxy'/);
  assert.match(placement, /sourceEdge\?\.family === 'opposing-crossover'/);
  assert.doesNotMatch(placement, /\bruntimeRandom\(|\brand\(|createRng|spawnEventSerial\+\+/);

  for (const prewarm of [obstaclePrewarm, pickupPrewarm]) {
    assert.match(prewarm, /bindEntityToCursor\(entity, placement\.cursor, placement\.pathPlan\)/);
    assert.match(prewarm, /_opposingPrewarmed: true/);
    assert.match(prewarm, /_retainedOffRouteAfterCommit: true/);
    assert.match(prewarm, /_collisionEntryTime: Number\.POSITIVE_INFINITY/);
    assert.doesNotMatch(
      prewarm,
      /\bruntimeRandom\(|\brand\(|createRng|SpawnObjects\+\+|state\.(?:score|expCount)\s*[+\-]?=/
    );
  }
  assert.match(
    obstaclePrewarm,
    /trafficGroupId: 2_000_000_000 \+ \+\+state\.opposingPrewarmTrafficGroupSerial/
  );
  assert.match(obstaclePrewarm, /_opposingPrewarmMotionGate: placement\.motionGate/);
  assert.match(obstaclePrewarm, /_opposingPrewarmMotionReleased: false/);
  assert.match(
    pickupPrewarm,
    /id: 1_000_000_000 \+ \+\+state\.opposingPrewarmPickupSerial/
  );
  assert.doesNotMatch(obstaclePrewarm, /\+\+state\.trafficGroupSerial/);
  assert.doesNotMatch(pickupPrewarm, /\+\+state\.pickupSerial/);
  assert.equal((obstacleSpawner.match(/prewarmOpposingObstacle\(obj\)/g) || []).length, 1);
  assert.equal((pickupSpawner.match(/prewarmOpposingPickup\(item, variant\)/g) || []).length, 1);

  const entityUpdates = sourceBetween('function updateEntities(', '// Zone blending is a per-frame hot path');
  assert.match(entityUpdates, /if \(routesCompatible\(obj\.routeId, obj\.s, obj\)\)/);
  assert.match(entityUpdates, /if \(routesCompatible\(item\.routeId, item\.s, item\)\)/);
  assert.match(source, /opposingPrewarmedActiveObstacleCount: obstacles\.reduce/);
  assert.match(source, /opposingPrewarmedActivePickupCount: pickups\.reduce/);
});

test('opposing prewarm projection covers the full proxy and 1080m crossover alias with one seam owner', () => {
  const projectionSource = sourceBetween(
    'function nearestOpposingPrewarmCursor(',
    '/**\n   * Prepare one destination-owned opposing itinerary'
  );
  const edgeOrigins = {
    proxy: 0,
    crossover: 100
  };
  const track = {
    sampleEdge(edgeId, edgeS, lateral, out) {
      out.x = edgeOrigins[edgeId] + edgeS;
      out.z = 0;
      return out;
    }
  };
  const nearestCursor = new Function(
    'track',
    'clamp',
    `'use strict';\n${projectionSource}\nreturn nearestOpposingPrewarmCursor;`
  )(
    track,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
  );
  const candidates = [
    { edgeId: 'proxy', startS: 0, endS: 100 },
    { edgeId: 'crossover', startS: 0, endS: 1_080 }
  ];

  const proxy = nearestCursor({ x: 40, z: 24 }, candidates, 64, {});
  assert.equal(proxy.edgeId, 'proxy');
  assert.equal(proxy.edgeS, 40);

  const extension = nearestCursor({ x: 640, z: 24 }, candidates, 64, {});
  assert.equal(extension.edgeId, 'crossover');
  assert.equal(extension.edgeS, 540);

  const seam = nearestCursor({ x: 100, z: 24 }, candidates, 64, {});
  assert.equal(seam.edgeId, 'proxy', 'the preceding proxy must own an exact equal-distance seam tie');
  assert.equal(seam.edgeS, 100);
  assert.equal(
    nearestCursor({ x: 640, z: 65 }, candidates, 64, {}),
    null,
    'a source event beyond the physical 64m opposing carriageway envelope must not clamp onto it'
  );
});

test('unadopted opposing movers brake at the authored stabilization gate and resume after adoption', () => {
  const motionSource = sourceBetween(
    'const OPPOSING_PREWARM_HOLD_DECELERATION_MPS2',
    'function obstacleTimeToReach('
  );
  const edgeOrigins = {
    proxy: 0,
    crossover: 240
  };
  const track = {
    distanceAlongPath(cursor, target) {
      const from = edgeOrigins[cursor.edgeId] + cursor.edgeS;
      const to = edgeOrigins[target.edgeId] + target.edgeS;
      return to - from;
    }
  };
  const motion = new Function(
    'track',
    'entityEdgeId',
    `'use strict';
${motionSource}
return { opposingPrewarmMotionRemaining, resolveOpposingPrewarmLongitudinalStep };`
  )(track, (entity) => entity.edgeId);
  const entity = {
    edgeId: 'proxy',
    edgeS: 100,
    pathPlan: { id: 'preview-plan' },
    _opposingPrewarmed: true,
    _opposingPrewarmMotionReleased: false,
    _opposingPrewarmMotionGate: {
      edgeId: 'crossover',
      maximumEdgeS: 1_080
    }
  };

  assert.equal(motion.opposingPrewarmMotionRemaining(entity), 1_220);
  assert.equal(
    motion.resolveOpposingPrewarmLongitudinalStep(entity, 0.3, 18, 1 / 60),
    0.3,
    'traffic must retain its ordinary motion throughout the visible proxy and most of the stabilization alias'
  );

  entity.edgeId = 'crossover';
  entity.edgeS = 1_070;
  const brakingStep = motion.resolveOpposingPrewarmLongitudinalStep(entity, 0.3, 18, 1 / 60);
  assert.ok(brakingStep > 0 && brakingStep < 0.3, 'arrival must decelerate before the visible-road boundary');

  entity.edgeS = 1_078;
  assert.equal(
    motion.resolveOpposingPrewarmLongitudinalStep(entity, 20, 20, 1),
    2,
    'one long frame must clamp exactly to the authored boundary instead of entering the hidden crossover'
  );
  entity.edgeS = 1_080;
  assert.equal(motion.resolveOpposingPrewarmLongitudinalStep(entity, 0.3, 18, 1 / 60), 0);

  entity._opposingPrewarmMotionReleased = true;
  assert.equal(
    motion.resolveOpposingPrewarmLongitudinalStep(entity, 0.3, 18, 1 / 60),
    0.3,
    'the same adopted mover must immediately recover its untouched authored velocity'
  );
  assert.equal(
    motion.resolveOpposingPrewarmLongitudinalStep(
      { _opposingPrewarmed: false },
      0.3,
      18,
      1 / 60
    ),
    0.3,
    'ordinary main-road traffic must remain outside the preview hold contract'
  );
  assert.equal(
    motion.resolveOpposingPrewarmLongitudinalStep(
      {
        edgeId: 'proxy',
        edgeS: 10,
        pathPlan: entity.pathPlan,
        _opposingPrewarmed: true,
        _opposingPrewarmMotionReleased: false
      },
      0.3,
      18,
      1 / 60
    ),
    0,
    'missing placement metadata must fail closed before an unrendered road can be entered'
  );

  const obstacleMotion = sourceBetween('function updateObstacleMotion(', 'function localZFromS(');
  assert.match(
    obstacleMotion,
    /resolveOpposingPrewarmLongitudinalStep\(\s*obj,\s*ordinaryLongitudinalStep,\s*longitudinalVelocity,\s*dt\s*\)/
  );
  assert.match(obstacleMotion, /obj\.s \+= longitudinalStep/);
});

test('opposing prewarm plan failures propagate without caching an empty destination road', () => {
  const planSource = sourceBetween(
    'function opposingPrewarmPlanForTile(',
    '/**\n   * Resolve the nearest gameplay alias'
  );
  const state = {
    pathPlan: { id: 'plan:one', itineraryKinds: ['straight'] },
    routeChoices: Object.freeze({}),
    opposingPrewarmFailureCount: 0
  };
  const launchOptions = { cloverleafMove: 'straight' };
  const cache = new Map();
  let prepareCount = 0;
  const originalError = new Error('authored topology failure');
  const track = {
    prepareOpposingRecoveryPathPlan() {
      prepareCount++;
      throw originalError;
    }
  };
  const getPlan = new Function(
    'track',
    'state',
    'launchOptions',
    'opposingPrewarmPlansByTileToken',
    `'use strict';
let opposingPrewarmPlanOwner = null;
${planSource}
return opposingPrewarmPlanForTile;`
  )(track, state, launchOptions, cache);
  const tile = { token: 'tile:1:s' };

  assert.throws(
    () => getPlan(tile),
    (error) => error === originalError,
    'the original topology error identity must reach the outer runtime-frame boundary'
  );
  assert.equal(state.opposingPrewarmFailureCount, 1);
  assert.equal(cache.size, 0);

  const validPlan = { id: 'opposing:valid' };
  track.prepareOpposingRecoveryPathPlan = () => {
    prepareCount++;
    return validPlan;
  };
  assert.equal(getPlan(tile), validPlan);
  assert.equal(getPlan(tile), validPlan);
  assert.equal(prepareCount, 2, 'only a valid plan may become the reusable tile cache entry');

  state.pathPlan = { id: 'plan:two', itineraryKinds: ['straight'] };
  track.prepareOpposingRecoveryPathPlan = () => {
    prepareCount++;
    return null;
  };
  assert.throws(() => getPlan(tile), /Opposing prewarm plan invariant failed/);
  assert.equal(state.opposingPrewarmFailureCount, 2);
  assert.equal(cache.size, 0, 'a null result must never become a permanent empty-road cache hit');
});

test('unadopted opposing prewarm entities cannot perturb main-road spawn layout', () => {
  const participationSource = sourceBetween(
    'function entityParticipatesInSpawnLayout(',
    'function chooseObstacleLateral('
  );
  let reachable = false;
  const participates = new Function(
    'entityReachableOnCurrentPlan',
    `'use strict';\n${participationSource}\nreturn entityParticipatesInSpawnLayout;`
  )(() => reachable);

  assert.equal(
    participates({ _opposingPrewarmed: false }),
    true,
    'ordinary uncommitted fork entities must retain their established spawn-layout semantics'
  );
  assert.equal(participates({ _opposingPrewarmed: true }), false);
  reachable = true;
  assert.equal(
    participates({ _opposingPrewarmed: true }),
    true,
    'the same physical copy must participate naturally after its edge enters the adopted PathPlan'
  );

  const obstacleChoice = sourceBetween('function chooseObstacleLateral(', 'function choosePickupLateral(');
  const pickupChoice = sourceBetween('function choosePickupLateral(', '/** Create topology-distinct');
  assert.equal(
    (obstacleChoice.match(/entityParticipatesInSpawnLayout\(obj\)/g) || []).length,
    2,
    'both obstacle gap and same-lane pressure scans must exclude an unreachable prewarm copy'
  );
  assert.equal(
    (pickupChoice.match(/entityParticipatesInSpawnLayout\((?:obj|item)\)/g) || []).length,
    2,
    'pickup obstacle clearance and candle chaining must exclude an unreachable prewarm copy'
  );
});

test('route commits preserve props on unselected fork roads without granting gameplay authority', () => {
  const preservation = sourceBetween(
    'function preserveTrafficAfterGraphCommit(',
    'function commitGraphDecision('
  );
  assert.match(preservation, /entity\._retainedOffRouteAfterCommit = true/);
  assert.match(preservation, /entity\._collisionEntryTime = Number\.POSITIVE_INFINITY/);
  assert.match(preservation, /entity\.pathPlan = state\.pathPlan/);
  assert.match(preservation, /for \(const entity of obstacles\) preserveEntity\(entity\)/);
  assert.match(preservation, /for \(const entity of pickups\) preserveEntity\(entity\)/);
  assert.doesNotMatch(preservation, /releaseObstacleVisual|releaseObstacleShadow|releasePickupVisual/);
  assert.doesNotMatch(preservation, /\.splice\(|scene\.remove/);
  assert.equal((source.match(/preserveTrafficAfterGraphCommit\(/g) || []).length, 2);

  const selectedPlan = { id: 'selected-plan' };
  const alternatePlan = { id: 'alternate-plan' };
  const makePair = (kind) => [
    {
      kind,
      trafficDecisionId: 'fork-1',
      trafficMovementId: 'left',
      pathPlan: { id: 'stale-selected-plan' },
      _collisionEntryTime: 0.25
    },
    {
      kind,
      trafficDecisionId: 'fork-1',
      trafficMovementId: 'right',
      pathPlan: alternatePlan,
      _collisionEntryTime: 0.50
    }
  ];
  const obstacles = makePair('obstacle');
  const pickups = makePair('pickup');
  const preserveTraffic = new Function(
    'obstacles',
    'pickups',
    'state',
    `'use strict';\n${preservation}\nreturn preserveTrafficAfterGraphCommit;`
  )(obstacles, pickups, { pathPlan: selectedPlan });
  preserveTraffic('fork-1', 'left');
  for (const pair of [obstacles, pickups]) {
    assert.equal(pair.length, 2, 'route commit must not remove either physical-road prop');
    assert.equal(pair[0].pathPlan, selectedPlan);
    assert.equal(pair[0].trafficDecisionId, null);
    assert.equal(pair[0].trafficMovementId, null);
    assert.equal(pair[0]._retainedOffRouteAfterCommit, false);
    assert.equal(pair[1].pathPlan, alternatePlan);
    assert.equal(pair[1].trafficDecisionId, 'fork-1');
    assert.equal(pair[1].trafficMovementId, 'right');
    assert.equal(pair[1]._retainedOffRouteAfterCommit, true);
    assert.equal(pair[1]._collisionEntryTime, Number.POSITIVE_INFINITY);
  }

  const entityUpdates = sourceBetween('function updateEntities(', '// Zone blending is a per-frame hot path');
  assert.match(entityUpdates, /if \(routesCompatible\(obj\.routeId, obj\.s, obj\)\)/);
  assert.match(entityUpdates, /if \(routesCompatible\(item\.routeId, item\.s, item\)\)/);
  assert.match(entityUpdates, /if \(z > 28\)[\s\S]*?releaseObstacleVisual/);
  assert.match(entityUpdates, /if \(z > 26\)[\s\S]*?releasePickupVisual/);
  const clearanceLifecycle = sourceBetween(
    'function entityInterchangeClearanceKey(',
    'function entityReachableOnCurrentPlan('
  );
  assert.match(clearanceLifecycle, /const entityPathPlan = entity\?\.pathPlan \|\| state\.pathPlan/);
  assert.match(clearanceLifecycle, /pathPlan: entity\.pathPlan \|\| state\.pathPlan/);
  assert.match(source, /branchCommitDeletesUnselectedEntities: false/);
  assert.match(source, /retainedOffRouteObstacleCount: obstacles\.reduce/);
  assert.match(source, /retainedOffRoutePickupCount: pickups\.reduce/);
});

test('airborne route adoption preserves every prop while transferring only shared-edge authority', () => {
  const preservation = sourceBetween(
    'function preserveTrafficAfterAirborneRouteAdoption(',
    'function commitGraphDecision('
  );
  assert.match(preservation, /const nextEdgeIds = new Set\(nextPathPlan\?\.edgeIds \|\| \[\]\)/);
  assert.match(preservation, /entity\.pathPlan = nextPathPlan/);
  assert.match(preservation, /if \(!entity\.pathPlan\) entity\.pathPlan = previousPathPlan/);
  assert.match(preservation, /entity\._retainedOffRouteAfterCommit = true/);
  assert.match(preservation, /entity\._collisionEntryTime = Number\.POSITIVE_INFINITY/);
  assert.doesNotMatch(
    preservation,
    /(?:releaseObstacleVisual|releaseObstacleShadow|releasePickupVisual|scene\.remove|\.splice\(|SpawnObjects\+\+|state\.(?:score|expCount)\s*[+\-]?=)/
  );

  const previousPlan = { id: 'departed-plan', edgeIds: ['edge:departed'] };
  const nextPlan = { id: 'adopted-plan', edgeIds: ['edge:shared', 'edge:return'] };
  const staleAlternatePlan = { id: 'stale-alternate-plan', edgeIds: ['edge:alternate'] };
  const makeEntity = (edgeId, pathPlan) => ({
    edgeId,
    edgeS: 318.25,
    lateral: -1.75,
    pathPlan,
    id: `pickup:${edgeId}`,
    trafficGroupId: `traffic:${edgeId}`,
    phase: 1.125,
    _opposingPrewarmed: true,
    trafficDecisionId: 'decision:old',
    trafficMovementId: 'movement:old',
    _retainedOffRouteAfterCommit: false,
    _collisionEntryTime: 0.25,
    _interchangeClearanceKey: 'stale-key',
    _interchangeClearanceResult: true
  });
  const obstacles = [
    makeEntity('edge:shared', previousPlan),
    makeEntity('edge:departed', staleAlternatePlan)
  ];
  const selectedMotionGate = Object.freeze({ edgeId: 'edge:return', maximumEdgeS: 1_080 });
  const departedMotionGate = Object.freeze({ edgeId: 'edge:departed', maximumEdgeS: 1_080 });
  obstacles[0]._opposingPrewarmMotionGate = selectedMotionGate;
  obstacles[0]._opposingPrewarmMotionReleased = false;
  obstacles[1]._opposingPrewarmMotionGate = departedMotionGate;
  obstacles[1]._opposingPrewarmMotionReleased = false;
  const pickups = [
    makeEntity('edge:return', previousPlan),
    makeEntity('edge:alternate', null)
  ];
  const authorityCounters = {
    obstacleSpawnObjects: 17,
    trafficSpawnObjects: 19,
    pickupSpawnObjects: 23,
    score: 2_500,
    expCount: 31
  };
  const countersBefore = structuredClone(authorityCounters);
  const physicalIdentityBefore = [obstacles[0], pickups[0]].map((entity) => ({
    edgeId: entity.edgeId,
    edgeS: entity.edgeS,
    lateral: entity.lateral,
    id: entity.id,
    trafficGroupId: entity.trafficGroupId,
    phase: entity.phase,
    opposingPrewarmed: entity._opposingPrewarmed
  }));
  const preserveTraffic = new Function(
    'obstacles',
    'pickups',
    'entityEdgeId',
    'state',
    `'use strict';\n${preservation}\nreturn preserveTrafficAfterAirborneRouteAdoption;`
  )(obstacles, pickups, (entity) => entity.edgeId, authorityCounters);

  preserveTraffic(previousPlan, nextPlan);

  assert.equal(obstacles.length, 2);
  assert.equal(pickups.length, 2);
  for (const entity of [obstacles[0], pickups[0]]) {
    assert.equal(entity.pathPlan, nextPlan);
    assert.equal(entity.trafficDecisionId, null);
    assert.equal(entity.trafficMovementId, null);
    assert.equal(entity._retainedOffRouteAfterCommit, false);
    assert.equal(entity._interchangeClearanceKey, null);
    assert.equal(entity._interchangeClearanceResult, null);
  }
  assert.equal(obstacles[0]._opposingPrewarmMotionGate, selectedMotionGate);
  assert.equal(
    obstacles[0]._opposingPrewarmMotionReleased,
    true,
    'route adoption must release the same physical mover without regenerating it'
  );
  assert.deepEqual(
    [obstacles[0], pickups[0]].map((entity) => ({
      edgeId: entity.edgeId,
      edgeS: entity.edgeS,
      lateral: entity.lateral,
      id: entity.id,
      trafficGroupId: entity.trafficGroupId,
      phase: entity.phase,
      opposingPrewarmed: entity._opposingPrewarmed
    })),
    physicalIdentityBefore,
    'landing adoption may transfer PathPlan authority but must retain opposing prop identity, pose, and RNG results'
  );
  assert.equal(obstacles[1].pathPlan, staleAlternatePlan);
  assert.equal(obstacles[1]._opposingPrewarmMotionGate, departedMotionGate);
  assert.equal(obstacles[1]._opposingPrewarmMotionReleased, false);
  assert.equal(pickups[1].pathPlan, previousPlan);
  for (const entity of [obstacles[1], pickups[1]]) {
    assert.equal(entity._retainedOffRouteAfterCommit, true);
    assert.equal(entity._collisionEntryTime, Number.POSITIVE_INFINITY);
    assert.equal(entity._interchangeClearanceKey, null);
    assert.equal(entity._interchangeClearanceResult, null);
  }
  assert.deepEqual(authorityCounters, countersBefore);
});

test('opposing landing preflights before the lip, rejects invisible adoption, and stops only at a closed boundary', () => {
  const preflight = functionSource('preflightOpposingLandingVariant');
  const platformRelease = functionSource('releaseFromJumpPlatform');
  assert.match(preflight, /cloverleafVisuals\.requestOpposingRouteVariantPreflight\(/);
  assert.doesNotMatch(
    preflight,
    /prepareOpposingRecoveryPathPlan|opposingPrewarmPlanForTile|ensureRouteVariantReadiness|activatePreparedVariant/
  );
  assert.match(preflight, /state\.opposingVariantReadinessPreflightCount\+\+/);
  assert.doesNotMatch(
    preflight,
    /state\.(?:speed|distance|pathPlan|routeCursor)\s*(?:=|\+=|-=|\*=|\/=)/
  );
  const updateVertical = functionSource('updateVerticalPhysics');
  assert.ok(
    updateVertical.indexOf('preflightOpposingLandingVariant(routeId)')
      < updateVertical.indexOf('track.crossedJumpPlatformLip('),
    'the corridor must enqueue its destination before the physical platform lip is evaluated'
  );
  assert.ok(
    platformRelease.indexOf('preflightOpposingLandingVariant(metadata.edgeId)')
      < platformRelease.indexOf('state.grounded = false;'),
    'the lip must synchronously revalidate its earlier handshake before publishing airborne authority'
  );

  const lipRequestStart = cloverleafTilePoolSource.indexOf(
    'function requestOpposingRouteVariantPreflight('
  );
  const lipRequestEnd = cloverleafTilePoolSource.indexOf(
    '/**\n     * Prepare a future resident',
    lipRequestStart
  );
  assert.ok(lipRequestStart >= 0 && lipRequestEnd > lipRequestStart);
  const lipRequest = cloverleafTilePoolSource.slice(lipRequestStart, lipRequestEnd);
  assert.doesNotMatch(
    lipRequest,
    /prepareOpposingRecoveryPathPlan|ensureRouteVariantReadiness|activatePreparedVariant|createRecoveryVariantJob/
  );
  assert.match(lipRequest, /pendingOpposingBypassPreflightTokens\.add\(destinationTile\.token\)/);
  const handshakeStart = cloverleafTilePoolSource.indexOf(
    'function opposingBypassPreflightHandshake('
  );
  const handshakeEnd = cloverleafTilePoolSource.indexOf(
    'function promotePendingOpposingBypassPreflights(',
    handshakeStart
  );
  assert.ok(handshakeStart >= 0 && handshakeEnd > handshakeStart);
  const handshake = cloverleafTilePoolSource.slice(handshakeStart, handshakeEnd);
  assert.match(handshake, /landingTileToken: tileToken/);
  assert.match(handshake, /landingTileSignature: preflight\.ordinaryExpectedSignature/);

  const opposingQueueStart = cloverleafTilePoolSource.indexOf(
    'function queueOpposingBypassVariant('
  );
  const opposingQueueEnd = cloverleafTilePoolSource.indexOf(
    'function queueRelevantOpposingBypassVariants(',
    opposingQueueStart
  );
  assert.ok(opposingQueueStart >= 0 && opposingQueueEnd > opposingQueueStart);
  const opposingQueue = cloverleafTilePoolSource.slice(opposingQueueStart, opposingQueueEnd);
  assert.match(opposingQueue, /priority: tile\.token === state\.token \? 0 : 1/);

  const adoption = sourceBetween(
    'function adoptAirborneLandingRoute(',
    'function recordResolvedFlight('
  );
  const readinessCallAt = adoption.indexOf(
    'cloverleafVisuals.ensureRouteVariantReadiness(nextPathPlan, exactCursor)'
  );
  const routeCommitAt = adoption.indexOf('state.pathPlan = nextPathPlan;');
  assert.ok(readinessCallAt >= 0 && readinessCallAt < routeCommitAt);
  assert.match(adoption, /relation === 'opposing-counterflow'/);
  assert.match(adoption, /return reject\('route-variant-readiness-unavailable', resolution\)/);
  const visibleLandingGuardAt = adoption.indexOf('!routeVariantReadiness?.landingSurfaceVisible');
  const pendingVariantGuardAt = adoption.indexOf('!routeVariantReadiness.ready');
  const invisibleLandingRejectAt = adoption.indexOf(
    "return reject('route-variant-landing-surface-unavailable', resolution)"
  );
  assert.ok(
    visibleLandingGuardAt >= 0
      && pendingVariantGuardAt > visibleLandingGuardAt
      && invisibleLandingRejectAt > pendingVariantGuardAt
      && invisibleLandingRejectAt < routeCommitAt,
    'landing-surface visibility must be unconditional; only stabilization fields may depend on pending status'
  );
  assert.match(adoption, /stableEdgeId/);
  assert.match(adoption, /stableUntilEdgeS/);
  assert.match(adoption, /opposingVariantGateDistance\(exactCursor, nextPathPlan, readinessGate\)/);
  assert.match(adoption, /state\.distance -= heldDistance/);
  assert.match(adoption, /state\.opposingVariantReadinessGate = readinessGate/);

  const gateDistanceSource = sourceBetween(
    'function opposingVariantGateDistance(',
    '/**\n   * Poll the pool'
  );
  const gateDistance = new Function(
    'track',
    `'use strict';\n${gateDistanceSource}\nreturn opposingVariantGateDistance;`
  )({
    getEdge(edgeId) {
      return {
        proxy: { length: 240 },
        crossover: { length: 5_760 }
      }[edgeId] || null;
    }
  });
  const pathPlan = { edgeIds: ['proxy', 'crossover', 'approach'] };
  const gate = { edgeId: 'crossover', maximumEdgeS: 1_080 };
  assert.equal(gateDistance({ edgeId: 'proxy', edgeS: 40 }, pathPlan, gate), 1_280);
  assert.equal(gateDistance({ edgeId: 'crossover', edgeS: 1_072 }, pathPlan, gate), 8);
  assert.equal(gateDistance({ edgeId: 'crossover', edgeS: 1_081 }, pathPlan, gate), 0);
  assert.equal(gateDistance({ edgeId: 'approach', edgeS: 0 }, pathPlan, gate), 0);

  const refreshSource = sourceBetween(
    'function refreshOpposingVariantReadinessGate(',
    '/**\n   * Give a pending visual variant'
  );
  const boundaryBrakeSource = sourceBetween(
    'function opposingVariantReadinessRequiresBoundaryBrake(',
    '/**\n   * Never advance collision authority'
  );
  const constraintSource = sourceBetween(
    'function constrainOpposingVariantDistance(',
    'function airborneRouteHeadingErrorDeg('
  );
  let readinessReady = false;
  const readinessEvents = [];
  const state = {
    speed: 120,
    pathPlan,
    routeCursor: { edgeId: 'proxy', edgeS: 40 },
    opposingVariantReadinessGate: null,
    opposingVariantReadinessReleaseCount: 0,
    opposingVariantReadinessHoldCount: 0,
    opposingVariantReadinessHeldMeters: 0,
    opposingVariantReadinessLastStatus: null
  };
  const createGate = () => ({
    tileToken: 'tile:destination',
    signature: 'variant:opposing',
    edgeId: 'crossover',
    maximumEdgeS: 1_080,
    status: 'critical-build-pending',
    holdCount: 0,
    heldMeters: 0
  });
  const readinessHelpers = new Function(
    'state',
    'track',
    'cloverleafVisuals',
    'recordTrackEvent',
    'sharedBrakeDeceleration',
    'gameplayCore',
    'normalAcceleration',
    'opposingVariantReadinessBoundaryMarginM',
    `'use strict';
${gateDistanceSource}
${refreshSource}
${boundaryBrakeSource}
${constraintSource}
return {
  opposingVariantReadinessRequiresBoundaryBrake,
  constrainOpposingVariantDistance
};`
  )(
    state,
    {
      getEdge(edgeId) {
        return {
          proxy: { length: 240 },
          crossover: { length: 5_760 }
        }[edgeId] || null;
      }
    },
    {
      ensureRouteVariantReadiness() {
        return {
          ready: readinessReady,
          status: readinessReady ? 'active' : 'critical-build-pending'
        };
      }
    },
    (type, details) => readinessEvents.push({ type, details }),
    52,
    { DEFAULT_MAX_RENDER_STEP_SECONDS: 0.045 },
    3.4,
    2
  );

  state.opposingVariantReadinessGate = createGate();
  assert.equal(readinessHelpers.opposingVariantReadinessRequiresBoundaryBrake(), false);
  assert.equal(state.opposingVariantReadinessGate.remainingDistanceM, 1_280);
  assert.ok(state.opposingVariantReadinessGate.brakeThresholdM < 146);
  assert.equal(state.opposingVariantReadinessGate.boundaryBraking, false);
  assert.equal(state.speed, 120, 'a pending variant far beyond the stopping envelope must preserve landing speed');

  state.routeCursor = { edgeId: 'crossover', edgeS: 950 };
  assert.equal(readinessHelpers.opposingVariantReadinessRequiresBoundaryBrake(), true);
  assert.equal(state.opposingVariantReadinessGate.remainingDistanceM, 130);
  assert.equal(state.opposingVariantReadinessGate.boundaryBraking, true);
  assert.equal(state.speed, 120, 'the brake predicate may command deceleration but may not teleport speed');

  readinessReady = true;
  assert.equal(readinessHelpers.opposingVariantReadinessRequiresBoundaryBrake(), false);
  assert.equal(state.opposingVariantReadinessGate, null);
  assert.equal(state.opposingVariantReadinessReleaseCount, 1);
  assert.equal(state.speed, 120);
  assert.equal(readinessEvents.at(-1)?.type, 'opposing-variant-readiness-released');

  readinessReady = false;
  state.routeCursor = { edgeId: 'crossover', edgeS: 1_000 };
  state.opposingVariantReadinessGate = createGate();
  assert.equal(readinessHelpers.constrainOpposingVariantDistance(20), 20);
  assert.equal(state.speed, 120);
  assert.equal(state.opposingVariantReadinessHoldCount, 0);
  assert.equal(readinessHelpers.constrainOpposingVariantDistance(80), 80);
  assert.equal(state.speed, 120, 'reaching the exact visible boundary must not discard momentum early');
  assert.equal(readinessHelpers.constrainOpposingVariantDistance(90), 80);
  assert.equal(state.speed, 0, 'only a request beyond unfinished geometry may stop at the closed boundary');
  assert.equal(state.opposingVariantBoundaryStopped, true);
  assert.equal(state.opposingVariantReadinessHoldCount, 1);
  assert.equal(state.opposingVariantReadinessHeldMeters, 10);

  readinessReady = true;
  assert.equal(readinessHelpers.constrainOpposingVariantDistance(0), 0);
  assert.equal(state.opposingVariantReadinessGate, null);
  assert.equal(state.speed, 0, 'readiness release must not restore minimum cruise speed');
  assert.equal(
    state.opposingVariantBoundaryStopped,
    true,
    'real propulsion must retain the recovery floor until it integrates through minimum drive speed'
  );

  state.speed = 120;
  state.opposingVariantBoundaryStopped = false;
  state.opposingVariantReadinessGate = createGate();
  assert.equal(readinessHelpers.constrainOpposingVariantDistance(90), 90);
  assert.equal(state.opposingVariantReadinessGate, null);
  assert.equal(state.speed, 120, 'a ready variant must release without a speed reset');

  const gameplayStep = sourceBetween('function advanceGameplayStep(', 'function animate()');
  assert.match(
    gameplayStep,
    /integrateLongitudinalDistance[\s\S]*?constrainOpposingVariantDistance\(integratedDistanceStep\)[\s\S]*?state\.distance \+= distanceStep/
  );
});

test('airborne route resolver invariant errors retain identity for the outer frame boundary', () => {
  const adoption = sourceBetween(
    'function adoptAirborneLandingRoute(',
    'function recordResolvedFlight('
  );
  assert.match(adoption, /const resolution = track\.resolveAirborneLandingRoute\(/);
  assert.doesNotMatch(adoption, /catch \(error\)/);
  assert.doesNotMatch(adoption, /stopForFatalError|fatalRuntimeLocked\s*=/);

  const originalError = new Error('cursor edge is not in rebuilt itinerary');
  const events = [];
  const state = {
    previousDistance: 100,
    distance: 112,
    pathPlan: { itineraryKinds: ['straight'] },
    routeCursor: { edgeId: 'edge:opposing' },
    previousRouteCursor: { edgeId: 'edge:launch' },
    routeChoices: Object.freeze({}),
    airborneRouteRelation: null,
    airborneRouteAdoptionFailureCount: 0,
    airborneRouteLastFailure: null,
    airborneRouteContinuityErrorM: 0,
    airborneRouteHeadingErrorDeg: 0
  };
  const adoptLandingRoute = new Function(
    'state',
    'clamp',
    'track',
    'launchOptions',
    'recordTrackEvent',
    `'use strict';\n${adoption}\nreturn adoptAirborneLandingRoute;`
  )(
    state,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    {
      resolveAirborneLandingRoute() {
        throw originalError;
      }
    },
    { cloverleafMove: 'straight' },
    (type, details) => events.push({ type, details })
  );

  assert.throws(
    () => adoptLandingRoute({
      routeRelation: 'opposing-visual-road',
      edgeId: 'edge:opposing'
    }, 0.5),
    (error) => error === originalError
  );
  assert.equal(state.airborneRouteAdoptionFailureCount, 0);
  assert.equal(state.airborneRouteLastFailure, null);
  assert.equal(events.length, 0);
});

test('graph hazard velocity stays forward-only across motion, TTC, and planner prediction', () => {
  const motion = sourceBetween('function obstacleLongitudinalVelocity(', 'function localZFromS(');
  assert.match(motion, /hasRouteGraphContract\(\) \? Math\.max\(0, velocity\) : velocity/);
  assert.equal((motion.match(/obstacleLongitudinalVelocity\(obj\)/g) || []).length, 4);
  assert.match(motion, /obj\.sVelocity = longitudinalVelocity/);
  assert.match(motion, /resolveObstacleLongitudinalStep\(\s*longitudinalVelocity/);
});

test('input lifecycle, one-shot keys, control capture, and reduced motion are wired', () => {
  const pauseRestartAction = sourceBetween(
    "pauseRestartBtn.addEventListener('click'",
    "pauseRestartCancelBtn.addEventListener('click'"
  );
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  for (const reason of [
    'game-reset',
    'game-over',
    'pause',
    'document-hidden',
    'page-hide',
    'window-blur',
    'pointer-cancel'
  ]) {
    assert.match(source, new RegExp(`releaseAllInputs\\('${reason}'`));
  }
  for (const code of ['KeyP', 'KeyC', 'KeyR']) {
    assert.match(source, new RegExp(`e\\.code === '${code}' && !e\\.repeat`));
  }
  assert.match(source, /\(e\.code === 'KeyO' \|\| e\.code === 'Escape'\) && !e\.repeat/);
  assert.match(pauseRestartAction, /!state\.running \|\| !state\.paused \|\| state\.gameOver/);
  assert.match(pauseRestartAction, /openPauseRestartConfirmation\(\)/);
  assert.doesNotMatch(pauseRestartAction, /resetGame\(\)/);
  assert.doesNotMatch(pauseRestartAction, /setPaused/);
  assert.match(
    keydown,
    /e\.code === 'KeyR'[\s\S]*?state\.gameOver[\s\S]*?resetGame\(\)[\s\S]*?e\.code === 'KeyR'[\s\S]*?state\.running && state\.paused[\s\S]*?openPauseRestartConfirmation\(\)/
  );
  assert.match(source, /setPointerCapture/);
  assert.match(source, /jumpButton\?\.addEventListener\('click'/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /renderer\.domElement\.tabIndex = 0/);
  assert.match(source, /startBtn\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /renderer\.domElement\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /trailLine\.visible = !reducedMotionEnabled/);
  assert.match(source, /updateShipLifeForm\(now, 1, reducedMotionEnabled, true, dt\)/);
  assert.match(
    source,
    /updateShipLifeForm\(now, 1, reducedMotionEnabled, false, presentationDt\)/
  );
  assert.match(source, /const speedFov = reducedMotionEnabled/);
  assert.match(source, /reducedMotion: reducedMotionEnabled/);
  assert.match(source, /const isReducedMotionEnabled = \(\) => reducedMotionEnabled/);
  assert.match(source, /isReducedMotionEnabled\s*\n\s*\}\);/);
  assert.match(source, /registerReducedMotionSettler\(syncWorldMotionPreference\)/);
  assert.doesNotMatch(
    sourceBetween('if (cloverleafMap) {', 'const minimapGraphPlayerFrame = {}'),
    /cloverleafMap\.syncMotionPreference\(\)/
  );

  const applyViewButton = sourceBetween('function applyViewButtonText()', 'function cycleViewMode()');
  assert.match(
    applyViewButton,
    /\[viewBtn, viewBtnState\],[\s\S]*?\[mobileViewBtn, mobileViewBtnState\]/
  );
  assert.match(applyViewButton, /button\.dataset\.viewMode = String\(state\.viewMode\)/);
  assert.match(applyViewButton, /button\.dataset\.viewName = viewName/);
  const cycleView = sourceBetween('function cycleViewMode()', 'const cameraNearFrame');
  assert.match(cycleView, /cancelCameraFreeLook\(reducedMotionEnabled, 'view-mode-change'\)/);
  assert.match(cycleView, /state\.cameraTransition = reducedMotionEnabled \? 0 : 1\.0/);
  assert.match(cycleView, /if \(reducedMotionEnabled\) settleReducedMotionCamera\(\)/);
  const cameraUpdate = sourceBetween('function updateCamera(dt)', 'const minimapLookBehind');
  assert.match(cameraUpdate, /cameraRigAnchor\.copy\(cameraRigAnchorTarget\)/);
  assert.doesNotMatch(cameraUpdate, /cameraRigAnchor\.lerp/);
  assert.match(cameraUpdate, /cameraPositionOffset\.copy\(cameraTargetPositionOffset\)/);
  assert.match(cameraUpdate, /cameraLookOffset\.copy\(cameraTargetLookOffset\)/);
  assert.match(cameraUpdate, /camera\.quaternion\.copy\(cameraQuaternionTarget\)/);
  assert.match(
    cameraUpdate,
    /camera\.fov = reducedMotionEnabled \|\| cinematicHardCutThisFrame \|\| cinematicMountedLock\s*\? targetFov/
  );
  assert.match(source, /registerReducedMotionSettler\(settleReducedMotionCamera\)/);

  const obstacleMotion = sourceBetween('function updateObstacleMotion(', 'function localZFromS(');
  const reducedObstacleBranch = obstacleMotion.indexOf('if (reducedMotionEnabled)');
  assert.ok(obstacleMotion.indexOf('obj.s += longitudinalStep') < reducedObstacleBranch);
  assert.ok(obstacleMotion.indexOf('obj.lateral = nextLat') < reducedObstacleBranch);
  assert.match(obstacleMotion, /settleObstacleDecorativeMotion\(obj\);\s*return;/);

  assert.match(source, /const dashPulse = reducedMotionEnabled \? 0\.82 :/);
  assert.match(source, /function settleMainDecorativeMotion\(\) \{\s*updateDashes\(performance\.now\(\)\)/);
  assert.doesNotMatch(source, /function updateRouteIndicator\(/);
  assert.doesNotMatch(source, /\brouteLine\b|\brouteGlowLine\b|\brouteDots\b|\brouteMarker\b/);
  assert.doesNotMatch(source, /navigation-target-halo/);

  const pickupLoop = sourceBetween(
    'for (let i = pickups.length - 1; i >= 0; i--) {\n      const item = pickups[i];\n      const previousCollisionState',
    '// Zone blending is a per-frame hot path'
  );
  assert.match(pickupLoop, /if \(reducedMotionEnabled\) \{\s*settlePickupDecorativeMotion/);
  assert.ok(
    pickupLoop.indexOf('settlePickupDecorativeMotion')
      < pickupLoop.indexOf('item._collisionEntryTime = Number.POSITIVE_INFINITY')
  );

  assert.match(worldSource, /const reducedMotion = Boolean\(isReducedMotionEnabled\(\)\)/);
  assert.match(worldSource, /const moonPulse = reducedMotion \? 1 :/);
  assert.match(worldSource, /const transitionYawSway = !reducedMotion && item\.userData\.transitionPreview/);
  assert.match(worldSource, /item\.rotation\.y = anchor\.yaw \+ item\.userData\.baseYaw \+ transitionYawSway/);
  assert.match(worldSource, /child\.rotation\.z = child\.userData\.mantaWing \* \(reducedMotion/);
  assert.match(worldSource, /darkDragonMotion: reducedMotion \? 'static-pose' : 'stable-forward-flight'/);
  assert.match(worldSource, /darkDragonForwardSpeedMps: reducedMotion \? 0 : DARK_DRAGON_FLIGHT_CONTRACT\.forwardSpeedMps/);
  assert.match(worldSource, /darkDragonLongitudinalSwayAmplitudeM:/);
  assert.match(worldSource, /darkDragonRootRollSwayRadians:/);
  assert.match(source, /worldDarkDragonMotion: state\.modelDebug\?\.world\?\.darkDragonMotion/);
  assert.match(source, /worldVisibleDarkDragonCount: state\.modelDebug\?\.world\?\.visibleDarkDragons/);
  assert.match(source, /worldDarkDragonForwardSpeedMps: state\.modelDebug\?\.world\?\.darkDragonForwardSpeedMps/);
  assert.match(source, /worldDarkDragonLateralSwayAmplitudeM:/);
  assert.match(source, /worldDarkDragonRootPitchSwayRadians:/);
  assert.match(
    worldSource,
    /function syncMotionPreference\(\)[\s\S]*?updateDecoration\(lastDecorationNow, lastPhysicalLightingState\)/
  );
  const cloudUpdateStart = worldSource.indexOf('function updateCloudInstances(');
  const cloudUpdateEnd = worldSource.indexOf(
    '\n    updateCloudInstances(\n      Number(state.skyElapsedSeconds)',
    cloudUpdateStart
  );
  const cloudUpdate = worldSource.slice(cloudUpdateStart, cloudUpdateEnd);
  assert.ok(cloudUpdateStart >= 0 && cloudUpdateEnd > cloudUpdateStart);
  assert.match(cloudUpdate, /reducedMotion === cloudLastMatrixReducedMotion/);
  assert.match(cloudUpdate, /if \(!reducedMotion\) cloudWindDistanceM \+=/);
  assert.match(cloudUpdate, /const lateralMeander = reducedMotion\s*\? 0/);
  assert.match(cloudUpdate, /const altitudeWave = reducedMotion \? 0/);
  assert.match(cloudUpdate, /const breath = reducedMotion\s*\? 1/);
  assert.match(cloudUpdate, /clusterX - renderOriginX/);
  assert.doesNotMatch(cloudUpdate, /state\.skyElapsedSeconds\s*=/);
  assert.match(worldSource, /updateCloudInstances\(Number\(state\.skyElapsedSeconds\) \|\| 0, graphOrigin, true, reducedMotion\)/);
});

test('live flight deck yields keyboard focus to the Canvas without weakening modal keyboard controls', () => {
  const targetResolver = functionSource('flightDeckControlFromTarget');
  const liveLayer = functionSource('isLiveGameplayInteractionLayer');
  const focusCanvas = functionSource('focusDrivingCanvas');
  const restoreModalFocus = functionSource('restoreAuxiliaryModalFocus');
  const nativeSpaceOwner = functionSource('ownsSpaceActivation');
  const focusin = sourceBetween(
    "document.addEventListener('focusin'",
    "window.addEventListener('keydown'"
  );
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  const keyup = sourceBetween("window.addEventListener('keyup'", "window.addEventListener('blur'");
  const holdButton = sourceBetween('function holdButton(', "holdButton(document.getElementById('leftBtn')");

  assert.match(source, /document\.querySelectorAll\('\[data-flight-deck-control\]'\)/);
  assert.match(source, /for \(const control of flightDeckControls\) control\.tabIndex = -1/);
  assert.match(targetResolver, /target\.closest\('\[data-flight-deck-control\]'\)/);
  assert.match(nativeSpaceOwner, /if \(flightDeckControlFromTarget\(target\)\) return false/);
  for (const boundary of [
    'runtimeStartupReady',
    '!fatalRuntimeLocked',
    '!startup.isUpdateNoticeActive()',
    'state.running',
    '!state.paused',
    '!state.gameOver',
    '!pendingLaunchCommit',
    '!isLaunchOverlayVisible()',
    '!isGuideOpen()',
    '!isMusicLibraryOpen()',
    '!isPauseRestartConfirmationOpen()'
  ]) assert.ok(liveLayer.includes(boundary), `missing live-layer boundary ${boundary}`);
  assert.match(focusCanvas, /isUsableFocusTarget\(renderer\.domElement\)/);
  assert.match(focusCanvas, /renderer\.domElement\.focus\(\{ preventScroll: true \}\)/);
  assert.ok(
    restoreModalFocus.indexOf('if (focusDrivingCanvas()) return true')
      < restoreModalFocus.indexOf('preferred.focus'),
    'active-flight modal close must restore the Canvas before considering a HUD opener'
  );
  assert.match(focusin, /flightDeckControlFromTarget\(event\.target\)/);
  assert.match(focusin, /focusDrivingCanvas\(\)/);

  const liveKeyGateAt = keydown.indexOf(
    "if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'NumpadEnter')"
  );
  assert.ok(liveKeyGateAt > keydown.indexOf('if (isPauseRestartConfirmationOpen())'));
  assert.ok(liveKeyGateAt > keydown.indexOf('if (isGuideOpen())'));
  assert.ok(liveKeyGateAt > keydown.indexOf('if (isMusicLibraryOpen())'));
  assert.ok(liveKeyGateAt > keydown.indexOf('if (isLaunchOverlayVisible())'));
  const gameplayKeydown = keydown.slice(keydown.lastIndexOf('if (ownsSettingsNavigation(e.target)) return;'));
  assert.match(gameplayKeydown, /e\.preventDefault\(\);\s*focusDrivingCanvas\(\);\s*return;/);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    assert.match(gameplayKeydown, new RegExp(`e\\.code === '${code}'`));
  }
  assert.match(gameplayKeydown, /if \(directionalKey\) e\.preventDefault\(\)/);
  assert.match(gameplayKeydown, /flightDeckControlFromTarget\(e\.target\)[\s\S]*?directionalKey \|\| e\.code === 'Space'/);
  assert.match(gameplayKeydown, /if \(e\.code === 'Space'\) \{\s*e\.preventDefault\(\)/);
  assert.doesNotMatch(gameplayKeydown, /ownsSpaceActivation/);
  assert.match(keyup, /e\.code === 'Tab' \|\| e\.code === 'Enter' \|\| e\.code === 'NumpadEnter'/);
  assert.match(keyup, /e\.code === 'ArrowLeft'[\s\S]*?e\.code === 'Space'[\s\S]*?e\.preventDefault\(\)/);
  assert.doesNotMatch(holdButton, /addEventListener\('key(?:down|up)'/);
  assert.match(holdButton, /event\.detail !== 0/);
});

test('100km/h perception calibration restores road-relative optic flow without scaling gameplay distance', () => {
  const contractSource = sourceBetween(
    'const cameraSpeedPerceptionContract = Object.freeze(',
    'const undergroundCameraContract'
  );
  const contractLiteral = contractSource.match(/Object\.freeze\((\{[\s\S]*\})\);/);
  assert.ok(contractLiteral, 'Camera speed-perception contract must remain a literal, reviewable configuration');
  const contract = Function(`'use strict'; return (${contractLiteral[1]});`)();
  assert.equal(contract.referenceSpeedKmh, 100);
  assert.equal(contract.chaseFovDegrees, 70);
  assert.equal(contract.closeFovDegrees, 68);
  assert.equal(contract.speedFovStartKmh, 20);
  assert.equal(contract.maximumSpeedFovGainDegrees, 7.5);
  assert.equal(contract.speedFovFullKmh, 160);
  assert.equal(contract.chaseLookAheadM, 28);
  assert.equal(contract.framingSpeedStartKmh, 100);
  assert.equal(contract.framingSpeedFullKmh, 160);
  assert.equal(contract.topHeightBaseM, 20);
  assert.equal(contract.topHeightMaximumSpeedGainM, 2.5);
  assert.equal(contract.topHeightSpeedGainSeconds, 0.008);
  assert.equal(contract.topBehindBaseM, 11);
  assert.equal(contract.topBehindMaximumSpeedGainM, 2.5);
  assert.equal(contract.topBehindSpeedGainSeconds, 0.008);
  assert.equal(contract.topLookAheadBaseM, 20);
  assert.equal(contract.topLookAheadMaximumSpeedGainM, 10);
  assert.equal(contract.topLookAheadSpeedGainSeconds, 0.05);
  assert.equal(contract.topShipCruiseScale, 0.30);
  assert.equal(contract.topCameraCruiseScale, 0);
  assert.equal(contract.topFovDegrees, 70);
  assert.equal(contract.hoodEyeHeightM, 2.05);
  assert.equal(contract.hoodForwardOffsetM, 1.32);
  assert.equal(contract.hoodNoseForwardExtentM, 1.18);
  assert.ok(
    contract.hoodForwardOffsetM > contract.hoodNoseForwardExtentM,
    'The hood eye must remain ahead of the authored nose extent'
  );
  assert.equal(contract.hoodLookHeightM, 1.25);
  assert.equal(contract.hoodLookAheadBaseM, 46);
  assert.equal(contract.hoodLookAheadMaximumSpeedGainM, 30);
  assert.equal(contract.hoodFovDegrees, 65);
  assert.equal(contract.portraitAspectStart, 0.78);
  assert.equal(contract.portraitAspectFull, 0.46);
  assert.equal(contract.portraitChaseBehindMaximumScale, 1.32);
  assert.equal(contract.portraitChaseHeightMaximumScale, 1.06);
  assert.equal(contract.portraitCloseBehindMaximumScale, 1.60);
  assert.equal(contract.portraitCloseLookAheadMinimumScale, 0.78);
  assert.equal(contract.portraitTopHeightMaximumScale, 1.18);
  assert.equal(contract.portraitTopBehindMaximumScale, 1.12);
  assert.equal(contract.portraitTopHeightMaximumM, 26);
  assert.equal(contract.portraitChaseFovGainDegrees, 4);
  assert.equal(contract.portraitCloseFovGainDegrees, 5);
  assert.equal(contract.portraitTopFovGainDegrees, 5);
  assert.equal(contract.portraitHoodFovGainDegrees, 7);
  assert.equal(contract.portraitCoveredFovGainDegrees, 4);
  assert.equal(contract.portraitFovMaximumDegrees, 84);

  // Portrait framing is a touch-camera presentation rule, not a narrow-window desktop rule. The smooth aspect
  // envelope fully serves phone portrait, fades to a minor iPad adjustment, and vanishes in phone landscape.
  const smootherStep01 = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const portraitBlendFor = ({ width, height, touchCameraPresentationCapable }) => {
    if (!touchCameraPresentationCapable) return 0;
    const aspectRange = contract.portraitAspectStart - contract.portraitAspectFull;
    return smootherStep01((contract.portraitAspectStart - width / height) / aspectRange);
  };
  const phonePortraitBlend = portraitBlendFor({
    width: 390,
    height: 844,
    touchCameraPresentationCapable: true
  });
  const phoneLandscapeBlend = portraitBlendFor({
    width: 844,
    height: 390,
    touchCameraPresentationCapable: true
  });
  const finePointerPortraitBlend = portraitBlendFor({
    width: 390,
    height: 844,
    touchCameraPresentationCapable: false
  });
  const classicIpadPortraitBlend = portraitBlendFor({
    width: 768,
    height: 1_024,
    touchCameraPresentationCapable: true
  });
  const smallIpadAirPortraitBlend = portraitBlendFor({
    width: 820,
    height: 1_180,
    touchCameraPresentationCapable: true
  });
  assert.ok(phonePortraitBlend > 0.999, '390 x 844 touch portrait must receive the complete framing correction');
  assert.equal(phoneLandscapeBlend, 0, 'phone landscape already has sufficient horizontal sightline');
  assert.equal(finePointerPortraitBlend, 0, 'a narrow fine-pointer desktop window must retain desktop optics');
  assert.ok(classicIpadPortraitBlend < 0.01, '4:3 iPad portrait must receive only a negligible correction');
  assert.ok(smallIpadAirPortraitBlend < 0.13, 'small iPad Air portrait must remain a modest correction');
  const portraitPresentationAt = (blend) => ({
    chaseHeightScale: 1 + (contract.portraitChaseHeightMaximumScale - 1) * blend,
    chaseBehindScale: 1 + (contract.portraitChaseBehindMaximumScale - 1) * blend,
    closeBehindScale: 1 + (contract.portraitCloseBehindMaximumScale - 1) * blend,
    closeLookAheadScale: 1 + (contract.portraitCloseLookAheadMinimumScale - 1) * blend,
    topHeightScale: 1 + (contract.portraitTopHeightMaximumScale - 1) * blend,
    topBehindScale: 1 + (contract.portraitTopBehindMaximumScale - 1) * blend,
    chaseFovGainDegrees: contract.portraitChaseFovGainDegrees * blend,
    closeFovGainDegrees: contract.portraitCloseFovGainDegrees * blend,
    topFovGainDegrees: contract.portraitTopFovGainDegrees * blend,
    hoodFovGainDegrees: contract.portraitHoodFovGainDegrees * blend,
    coveredFovGainDegrees: contract.portraitCoveredFovGainDegrees * blend
  });
  const unchangedDesktopPresentation = portraitPresentationAt(0);
  assert.deepEqual(
    portraitPresentationAt(phoneLandscapeBlend),
    unchangedDesktopPresentation,
    'touch landscape must preserve every desktop camera target exactly'
  );
  assert.deepEqual(
    portraitPresentationAt(finePointerPortraitBlend),
    unchangedDesktopPresentation,
    'fine-pointer portrait must preserve every desktop camera target exactly'
  );

  const referenceSpeedMps = contract.referenceSpeedKmh / 3.6;
  const chaseHeightM = (7.2 + Math.min(1.2, referenceSpeedMps * 0.012))
    * contract.chaseHeightScale;
  const chaseBehindM = (17.2 + Math.min(3.8, referenceSpeedMps * 0.035))
    * contract.chaseBehindScale;
  const closeHeightM = (3.65 + Math.min(0.75, referenceSpeedMps * 0.006))
    * contract.closeHeightScale;
  const closeBehindM = (8.25 + Math.min(1.9, referenceSpeedMps * 0.018))
    * contract.closeBehindScale;
  const closeLookAheadM = contract.closeLookAheadBaseM + Math.min(
    contract.closeLookAheadMaximumSpeedGainM,
    referenceSpeedMps * contract.closeLookAheadSpeedGainSeconds
  );
  const topHeightM = contract.topHeightBaseM + Math.min(
    contract.topHeightMaximumSpeedGainM,
    referenceSpeedMps * contract.topHeightSpeedGainSeconds
  );
  const topBehindM = contract.topBehindBaseM + Math.min(
    contract.topBehindMaximumSpeedGainM,
    referenceSpeedMps * contract.topBehindSpeedGainSeconds
  );
  const topLookAheadM = contract.topLookAheadBaseM + Math.min(
    contract.topLookAheadMaximumSpeedGainM,
    referenceSpeedMps * contract.topLookAheadSpeedGainSeconds
  );
  const referenceFovDegrees = contract.chaseFovDegrees + Math.pow(
    (contract.referenceSpeedKmh - contract.speedFovStartKmh)
      / (contract.speedFovFullKmh - contract.speedFovStartKmh),
    contract.speedFovExponent
  ) * contract.maximumSpeedFovGainDegrees;
  assert.ok(Math.abs(chaseHeightM - 3.69) <= 0.01, '100km/h chase height must stay near 3.69m');
  assert.ok(Math.abs(chaseBehindM - 8.18) <= 0.01, '100km/h chase trailing distance must stay near 8.18m');
  assert.ok(Math.abs(referenceFovDegrees - 74.80) <= 0.01, '100km/h target FOV must stay near 74.80°');
  assert.ok(closeHeightM < chaseHeightM, 'Close view must remain lower than chase view');
  assert.ok(closeBehindM < chaseBehindM, 'Close view must remain nearer than chase view');
  assert.ok(closeLookAheadM < contract.chaseLookAheadM, 'Close view must retain a shorter road sightline');
  assert.ok(Math.abs(topHeightM - 20.222_222) <= 0.000_001);
  assert.ok(Math.abs(topBehindM - 11.222_222) <= 0.000_001);
  assert.ok(Math.abs(topLookAheadM - 21.388_889) <= 0.000_001);

  const lerpNumber = (start, end, blend) => start + (end - start) * blend;
  const verticalToHorizontalFovDegrees = (verticalFovDegrees, aspect) => (
    2 * Math.atan(Math.tan(verticalFovDegrees * Math.PI / 360) * aspect) * 180 / Math.PI
  );
  const angularSpanDegrees = (spanM, distanceM) => (
    2 * Math.atan(spanM / (2 * distanceM)) * 180 / Math.PI
  );
  const capeArtContractLiteral = shipSource.match(
    /const SKY_CAPE_ART_CONTRACT = Object\.freeze\((\{[\s\S]*?\})\);/
  );
  assert.ok(capeArtContractLiteral, 'The authored cape span must remain available to camera-framing review');
  const capeArtContract = Function(`'use strict'; return (${capeArtContractLiteral[1]});`)();
  const phonePortraitAspect = 390 / 844;
  const phoneChaseBehindM = chaseBehindM * lerpNumber(
    1,
    contract.portraitChaseBehindMaximumScale,
    phonePortraitBlend
  );
  const phoneCloseBehindM = closeBehindM * lerpNumber(
    1,
    contract.portraitCloseBehindMaximumScale,
    phonePortraitBlend
  );
  const phoneTopHeightM = topHeightM * lerpNumber(
    1,
    contract.portraitTopHeightMaximumScale,
    phonePortraitBlend
  );
  const phoneTopBehindM = topBehindM * lerpNumber(
    1,
    contract.portraitTopBehindMaximumScale,
    phonePortraitBlend
  );
  const phoneChaseHorizontalFov = verticalToHorizontalFovDegrees(
    referenceFovDegrees + contract.portraitChaseFovGainDegrees * phonePortraitBlend,
    phonePortraitAspect
  );
  const phoneCloseHorizontalFov = verticalToHorizontalFovDegrees(
    contract.closeFovDegrees
      + (referenceFovDegrees - contract.chaseFovDegrees)
      + contract.portraitCloseFovGainDegrees * phonePortraitBlend,
    phonePortraitAspect
  );
  const phoneTopHorizontalFov = verticalToHorizontalFovDegrees(
    contract.topFovDegrees
      + (referenceFovDegrees - contract.chaseFovDegrees) * 0.34
      + contract.portraitTopFovGainDegrees * phonePortraitBlend,
    phonePortraitAspect
  );
  const phoneChaseCapeOccupancy = angularSpanDegrees(
    capeArtContract.healthySpanM,
    phoneChaseBehindM
  ) / phoneChaseHorizontalFov;
  const phoneCloseCapeOccupancy = angularSpanDegrees(
    capeArtContract.healthySpanM,
    phoneCloseBehindM
  ) / phoneCloseHorizontalFov;
  const phoneTopCapeOccupancy = angularSpanDegrees(
    capeArtContract.healthySpanM,
    phoneTopBehindM
  ) / phoneTopHorizontalFov;
  assert.ok(
    phoneChaseCapeOccupancy <= 0.67,
    'phone chase view must retain lateral road context around the complete 5.24m visual cape'
  );
  assert.ok(
    phoneCloseCapeOccupancy <= 0.74,
    'phone close view must keep the complete visual cape clear of the portrait edges'
  );
  assert.ok(
    phoneTopCapeOccupancy <= 0.60,
    'phone top view must preserve tactical road context around the complete visual cape'
  );
  assert.ok(phoneTopHeightM > topHeightM && phoneTopBehindM > topBehindM);
  assert.equal(
    lerpNumber(1, contract.portraitChaseBehindMaximumScale, finePointerPortraitBlend),
    1,
    'fine-pointer portrait must preserve the exact desktop chase distance'
  );
  assert.ok(
    lerpNumber(1, contract.portraitChaseBehindMaximumScale, smallIpadAirPortraitBlend) < 1.04,
    'small iPad Air chase framing must remain a minor adjustment'
  );
  const phoneReferenceCloseLookAheadM = closeLookAheadM * lerpNumber(
    1,
    contract.portraitCloseLookAheadMinimumScale,
    phonePortraitBlend
  );
  const phoneFairTargetCloseLookAheadM = (
    contract.closeLookAheadBaseM + contract.closeLookAheadMaximumSpeedGainM
  ) * lerpNumber(1, contract.portraitCloseLookAheadMinimumScale, phonePortraitBlend);
  assert.ok(phoneReferenceCloseLookAheadM >= 20, '100km/h phone close view must retain at least 20m preview');
  assert.ok(phoneFairTargetCloseLookAheadM >= 31, '160km/h phone close view must retain at least 31m preview');

  const maximumPortraitChaseFov = Math.min(
    contract.portraitFovMaximumDegrees,
    contract.chaseFovDegrees
      + contract.maximumSpeedFovGainDegrees
      + contract.throttleFovGainDegrees
      + contract.portraitChaseFovGainDegrees
  );
  assert.equal(maximumPortraitChaseFov, 82.2, 'phone portrait FOV must obey its audited projection cap');
  const fairTargetSpeedMps = 160 / 3.6;
  const fairTargetChaseHeightM = (
    7.2 + Math.min(1.2, fairTargetSpeedMps * 0.012)
  ) * contract.chaseHeightScale + contract.chaseMaximumSpeedHeightGainM;
  const fairTargetChaseBehindM = (
    17.2 + Math.min(3.8, fairTargetSpeedMps * 0.035)
  ) * contract.chaseBehindScale + contract.chaseMaximumSpeedBehindGainM;
  assert.ok(Math.abs(fairTargetChaseHeightM - 5.389_333) <= 0.01);
  assert.ok(Math.abs(fairTargetChaseBehindM - 12.44) <= 0.01);
  assert.equal(
    contract.chaseLookAheadM + contract.chaseMaximumSpeedLookAheadGainM,
    48,
    'The fair target must retain a safe forward preview'
  );

  const cameraUpdate = sourceBetween('function updateCamera(dt)', 'const minimapLookBehind');
  assert.match(
    source,
    /const touchCameraPresentationCapable = navigator\.maxTouchPoints > 0\s*\|\|\s*mobileCockpitHardwareQuery\.matches;/
  );
  assert.match(
    cameraUpdate,
    /const portraitFramingBlend = touchCameraPresentationCapable\s*\?\s*track\.smootherStep01\(/
  );
  assert.doesNotMatch(
    cameraUpdate,
    /mobileCockpitState\.active/,
    'responsive desktop HUD fallback must never opt a fine-pointer window into touch-camera optics'
  );
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.chaseHeightScale/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.chaseBehindScale/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.chaseLookAheadM/);
  assert.match(cameraUpdate, /const cameraSpeedKmh = speedToKmh\(state\.speed\)/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.speedFovStartKmh/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.speedFovFullKmh/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.speedFovExponent/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.maximumSpeedFovGainDegrees/);
  assert.doesNotMatch(cameraUpdate, /fairAutopilotContractSpeed - speedFovStart/);
  assert.match(cameraUpdate, /cameraRigAnchor\.copy\(cameraRigAnchorTarget\)/);
  assert.doesNotMatch(cameraUpdate, /cameraRigAnchor\.lerp/);
  assert.match(cameraUpdate, /state\.cameraActualBehindM/);
  assert.match(cameraUpdate, /state\.cameraTargetFov = targetFov/);
  assert.match(cameraUpdate, /cameraPositionBehind[\s\S]*portraitCloseBehindScale/);
  assert.match(cameraUpdate, /cameraSpeedPerceptionContract\.closeLookAheadBaseM[\s\S]*portraitCloseLookAheadScale/);
  assert.match(cameraUpdate, /portraitChaseHeightScale/);
  assert.match(cameraUpdate, /portraitChaseBehindScale/);
  assert.match(cameraUpdate, /portraitTopHeightScale/);
  assert.match(cameraUpdate, /portraitTopBehindScale/);
  assert.match(
    cameraUpdate,
    /Math\.min\(\s*portraitTopUnclampedHeightM,\s*cameraSpeedPerceptionContract\.portraitTopHeightMaximumM/
  );
  assert.match(cameraUpdate, /portraitOpenRoadFovGain/);
  assert.match(cameraUpdate, /portraitCoveredFovGain/);
  const closeCameraUpdate = cameraUpdate.slice(
    cameraUpdate.indexOf('if (state.viewMode === cameraViewClose) {'),
    cameraUpdate.indexOf('} else if (topViewActive) {')
  );
  assert.match(closeCameraUpdate, /cameraPositionBehind =[\s\S]*portraitCloseBehindScale/);
  assert.match(closeCameraUpdate, /cameraTargetLookAheadM =[\s\S]*portraitCloseLookAheadScale/);
  for (const fovGainField of [
    'portraitChaseFovGainDegrees',
    'portraitCloseFovGainDegrees',
    'portraitTopFovGainDegrees',
    'portraitHoodFovGainDegrees',
    'portraitCoveredFovGainDegrees'
  ]) {
    assert.match(
      cameraUpdate,
      new RegExp(`cameraSpeedPerceptionContract\\.${fovGainField}`),
      `missing touch-portrait FOV use ${fovGainField}`
    );
  }
  assert.match(
    cameraUpdate,
    /Math\.min\(\s*cameraSpeedPerceptionContract\.portraitFovMaximumDegrees,\s*lerp\(/
  );

  const portraitScaleAt = cameraUpdate.indexOf('const portraitChaseBehindScale');
  const tunnelTargetAt = cameraUpdate.indexOf('const tunnelCameraBehind');
  const tunnelHeightConvergenceAt = cameraUpdate.indexOf(
    'cameraPositionHeight = lerp(cameraPositionHeight, tunnelCameraHeight, undergroundTunnelBlend)'
  );
  const tunnelBehindConvergenceAt = cameraUpdate.indexOf(
    'cameraPositionBehind = lerp(cameraPositionBehind, tunnelCameraBehind, undergroundTunnelBlend)'
  );
  assert.ok(
    portraitScaleAt >= 0
      && tunnelTargetAt > portraitScaleAt
      && tunnelHeightConvergenceAt > tunnelTargetAt
      && tunnelBehindConvergenceAt > tunnelHeightConvergenceAt,
    'portrait open-road framing must converge into the authoritative tunnel rig before placement'
  );
  const undergroundContractSource = sourceBetween(
    'const undergroundCameraContract = Object.freeze(',
    'function applyViewButtonText()'
  );
  const undergroundContractLiteral = undergroundContractSource.match(/Object\.freeze\((\{[\s\S]*\})\);/);
  assert.ok(undergroundContractLiteral, 'Tunnel camera contract must remain a literal convergence target');
  const undergroundContract = Function(`'use strict'; return (${undergroundContractLiteral[1]});`)();
  assert.equal(
    lerpNumber(phoneChaseBehindM, undergroundContract.baseBehindM, 1),
    undergroundContract.baseBehindM,
    'full tunnel blend must erase portrait trailing-distance compensation'
  );
  assert.ok(
    Math.abs(
      lerpNumber(
        chaseHeightM * lerpNumber(1, contract.portraitChaseHeightMaximumScale, phonePortraitBlend),
        undergroundContract.baseHeightM,
        1
      ) - undergroundContract.baseHeightM
    ) <= Number.EPSILON,
    'full tunnel blend must erase portrait height compensation within floating-point precision'
  );
  const portraitCameraSection = cameraUpdate.slice(portraitScaleAt, tunnelBehindConvergenceAt);
  assert.doesNotMatch(portraitCameraSection, /player\.scale|colliderHalf|SURFACE_FOOTPRINT_CONTRACT/);
  assert.doesNotMatch(
    portraitCameraSection,
    /state\.(?:speed|distance|lives|score|lateral|altitude|verticalVelocity|routeCursor|pathPlan)\s*=/,
    'portrait correction must remain presentation-only'
  );
  assert.match(source, /cameraSpeedPerceptionReferenceKmh: cameraSpeedPerceptionContract\.referenceSpeedKmh/);
  assert.match(source, /cameraSpeedFovStartKmh: cameraSpeedPerceptionContract\.speedFovStartKmh/);
  assert.match(source, /cameraSpeedFovFullKmh: cameraSpeedPerceptionContract\.speedFovFullKmh/);
  assert.match(source, /cameraSpeedPerceptionChaseFovDegrees: cameraSpeedPerceptionContract\.chaseFovDegrees/);
  assert.match(source, /cameraPortraitCloseBehindMaximumScale: cameraSpeedPerceptionContract\.portraitCloseBehindMaximumScale/);
  assert.match(source, /cameraPortraitCloseLookAheadMinimumScale: cameraSpeedPerceptionContract\.portraitCloseLookAheadMinimumScale/);
  assert.match(
    source,
    /cameraPortraitTopHeightMaximumM:\s*cameraSpeedPerceptionContract\.portraitTopHeightMaximumM/
  );
  assert.match(source, /cameraPortraitTouchCapable: state\.cameraPortraitTouchCapable/);

  const roadContractLiteral = cloverleafSource.match(
    /const ROAD_SPEED_REFERENCE_CONTRACT = Object\.freeze\((\{[\s\S]*?\})\);/
  );
  assert.ok(roadContractLiteral, 'Graph roads must publish a reviewable world-fixed speed reference');
  const roadContract = Function(`'use strict'; return (${roadContractLiteral[1]});`)();
  assert.equal(roadContract.cadenceM, 9.2);
  assert.equal(roadContract.markLengthM, 4);
  assert.equal(roadContract.gapLengthM, 5.2);
  assert.equal(roadContract.worldFixed, true);
  assert.equal(roadContract.affectsGameplay, false);
  const referencePassesPerSecond = referenceSpeedMps / roadContract.cadenceM;
  const tenKmhPassesPerSecond = (10 / 3.6) / roadContract.cadenceM;
  assert.ok(Math.abs(referencePassesPerSecond - 3.019_324) <= 0.000_001);
  assert.ok(Math.abs(referencePassesPerSecond / tenKmhPassesPerSecond - 10) <= 0.000_001);
  const lineBuilder = cloverleafSource.slice(
    cloverleafSource.indexOf('function createEdgeLineAppendJob('),
    cloverleafSource.indexOf('function createDecorativeLaneGeometry(')
  );
  assert.match(lineBuilder, /ROAD_SPEED_REFERENCE_CONTRACT\.cadenceM/);
  assert.match(lineBuilder, /ROAD_SPEED_REFERENCE_CONTRACT\.markLengthM/);
  assert.match(lineBuilder, /ROAD_SPEED_REFERENCE_CONTRACT\.edgeInsetM/);
  assert.doesNotMatch(lineBuilder, /state\.|performance\.now|Date\.now|speedToKmh/);

  const animateLoop = sourceBetween('function advanceGameplayStep(dt, now)', "startBtn.addEventListener('click'");
  assert.match(
    animateLoop,
    /const integratedDistanceStep = gameplayCore\.integrateLongitudinalDistance\(previousSpeed, state\.speed, dt\);/
  );
  assert.match(
    animateLoop,
    /const distanceStep = constrainOpposingVariantDistance\(integratedDistanceStep\);/
  );
  assert.equal((animateLoop.match(/state\.distance \+= distanceStep/g) || []).length, 1);
  assert.doesNotMatch(animateLoop, /(?:integratedDistanceStep|distanceStep)\s*[*\/]=/);
  assert.match(animateLoop, /gameplayCore\.consumeBoundedElapsedTime\(/);
  assert.match(animateLoop, /rawFrameDt,[\s\S]*advanceGameplayStep,[\s\S]*now/);
  assert.doesNotMatch(animateLoop, /Math\.min\(clock\.getDelta\(\),\s*0\.045\)/);
});

test('tactical top and hood cameras follow authoritative route frames and remain presentation-only', () => {
  const viewModesSource = sourceBetween(
    'const viewModeNames = Object.freeze(',
    '// At the 100km/h reference'
  );
  const viewModesLiteral = viewModesSource.match(/Object\.freeze\((\[[\s\S]*\])\);/);
  assert.ok(viewModesLiteral, 'Camera view names must remain a frozen, reviewable sequence');
  const viewModes = Function(`'use strict'; return (${viewModesLiteral[1]});`)();
  assert.deepEqual(viewModes, ['追尾', '近距', '俯视', '车头']);
  assert.match(source, /const cameraViewHood = 3;/);
  assert.match(source, /const cameraViewModeCount = 4;/);

  const cameraUpdate = sourceBetween('function updateCamera(dt)', 'const minimapLookBehind');
  assert.ok(
    cameraUpdate.indexOf('const cinematicViewActive = state.cameraCinematicActive;')
      < cameraUpdate.indexOf('const routeAnchor ='),
    'cinematic authority must resolve before route-anchor and preview sampling'
  );
  assert.match(
    cameraUpdate,
    /const routeAnchor = hasRouteGraphContract\(\)\s*\? cinematicViewActive\s*\? sampleCinematicCommittedFrame\(0, 0, cameraRouteAnchorFrame\)\s*:\s*samplePlannedFrame\(0, 0, cameraRouteAnchorFrame\)/
  );
  assert.match(
    cameraUpdate,
    /const nearGuide = hasRouteGraphContract\(\)\s*\? cinematicViewActive\s*\? sampleCinematicCommittedFrame\(cameraNearDistance, 0, cameraNearFrame\)/
  );
  assert.match(
    cameraUpdate,
    /const farGuide = hasRouteGraphContract\(\)\s*\? cinematicViewActive\s*\? sampleCinematicCommittedFrame\(cameraFarDistance, 0, cameraFarFrame\)/
  );
  assert.match(
    cameraUpdate,
    /upcomingLowerCrossing = resolveCameraUpcomingLowerCrossing\(graphApproachDistance\)/
  );
  assert.match(
    sourceBetween('function resolveCameraUpcomingLowerCrossing(', '/** Queue one authored edit'),
    /const pathPlan = state\.cameraCinematicActive \? state\.pathPlan : navigationPathPlan\(\)/
  );
  assert.match(cameraUpdate, /const freeLookActive = cameraFreeLookPresentationActive\(\);/);
  assert.match(cameraUpdate, /const hoodViewActive = !cinematicViewActive && state\.viewMode === cameraViewHood/);
  assert.match(cameraUpdate, /const topViewActive = !cinematicViewActive && state\.viewMode === cameraViewTop/);
  const topCameraStart = cameraUpdate.indexOf('} else if (topViewActive) {');
  const hoodCameraStart = cameraUpdate.indexOf('} else if (hoodViewActive) {');
  assert.ok(
    topCameraStart >= 0 && hoodCameraStart > topCameraStart,
    'Top view must keep a dedicated tactical-camera branch'
  );
  const topCameraUpdate = cameraUpdate.slice(topCameraStart, hoodCameraStart);
  assert.match(topCameraUpdate, /cameraPositionSide = state\.lateral/);
  assert.match(topCameraUpdate, /portraitTopUnclampedHeightM =[\s\S]*portraitTopHeightScale/);
  assert.match(topCameraUpdate, /cameraPositionBehind =[\s\S]*portraitTopBehindScale/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topHeightBaseM/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topHeightMaximumSpeedGainM/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topHeightSpeedGainSeconds/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topBehindBaseM/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topBehindMaximumSpeedGainM/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topBehindSpeedGainSeconds/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topLookAheadBaseM/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topLookAheadMaximumSpeedGainM/);
  assert.match(topCameraUpdate, /cameraSpeedPerceptionContract\.topLookAheadSpeedGainSeconds/);
  assert.match(
    topCameraUpdate,
    /samplePlannedFrame\(cameraTargetLookAheadM, state\.lateral, cameraTopLookFrame\)/
  );
  assert.match(
    topCameraUpdate,
    /sampleTrackFrame\([\s\S]*state\.lateral,[\s\S]*cameraTopLookFrame/
  );
  assert.match(topCameraUpdate, /topLook\.x - routeAnchor\.x \+ topLook\.upX \* topLookHeightM/);
  assert.doesNotMatch(topCameraUpdate, /localPlayerSide/);
  assert.doesNotMatch(topCameraUpdate, /shake[XY]/);

  const chaseCameraStart = cameraUpdate.indexOf('} else {', hoodCameraStart);
  assert.ok(chaseCameraStart > hoodCameraStart, 'Hood view must keep a dedicated forward-camera branch');
  const hoodCameraUpdate = cameraUpdate.slice(hoodCameraStart, chaseCameraStart);
  assert.match(hoodCameraUpdate, /cameraPositionSide = state\.lateral/);
  assert.match(hoodCameraUpdate, /cameraPositionBehind = -cameraSpeedPerceptionContract\.hoodForwardOffsetM/);
  assert.match(hoodCameraUpdate, /samplePlannedFrame\(hoodLookAhead, state\.lateral, cameraHoodLookFrame\)/);
  assert.match(hoodCameraUpdate, /hoodLook\.x - routeAnchor\.x \+ hoodLook\.upX \* hoodLookHeight/);
  assert.doesNotMatch(hoodCameraUpdate, /localPlayerSide/);
  assert.doesNotMatch(
    hoodCameraUpdate,
    /portrait(?:Chase|Close|Top)(?:Height|Behind|LookAhead)Scale/,
    'hood camera position remains authored; only its projection FOV widens on touch portrait'
  );
  const chaseCameraUpdate = cameraUpdate.slice(chaseCameraStart, cameraUpdate.indexOf('// Open-road camera inertia'));
  assert.match(chaseCameraUpdate, /cameraPositionHeight =[\s\S]*portraitChaseHeightScale/);
  assert.match(chaseCameraUpdate, /cameraPositionBehind =[\s\S]*portraitChaseBehindScale/);
  assert.match(cameraUpdate, /hoodViewActive \? state\.lateral : clamp\(state\.lateral \* 0\.62/);
  assert.match(
    cameraUpdate,
    /topViewActive\s*\?\s*cameraSpeedPerceptionContract\.topCameraCruiseScale/
  );
  assert.match(cameraUpdate, /: hoodViewActive\s*\? 0\s*:\s*1\)/);
  assert.match(cameraUpdate, /hoodUnderpassFovDegrees/);
  assert.match(cameraUpdate, /hoodTunnelFovDegrees/);
  assert.match(cameraUpdate, /const hoodCameraLocked = hoodViewActive && state\.cameraTransition <= 0/);
  assert.match(
    cameraUpdate,
    /reducedMotionEnabled\s*\|\| hoodCameraLocked\s*\|\| cinematicHardCutThisFrame\s*\|\| cinematicWorldLockedPosition\s*\|\| cinematicMountedLock\s*\) \{\s*cameraPositionOffset\.copy/
  );
  assert.match(
    cameraUpdate,
    /if \(reducedMotionEnabled \|\| hoodCameraLocked \|\| cinematicHardCutThisFrame \|\| cinematicMountedLock\) \{\s*camera\.quaternion\.copy/
  );
  assert.match(cameraUpdate, /const actualCameraSide = \(camera\.position\.x - routeAnchor\.x\) \* rightX/);
  assert.match(
    cameraUpdate,
    /state\.cameraHoodLateralErrorM = Math\.abs\(actualCameraSide - state\.lateral\)/
  );
  assert.doesNotMatch(cameraUpdate, /state\.(?:speed|distance|lives|lateral|routeCursor|pathPlan)\s*=/);

  const shipPresentationUpdate = sourceBetween(
    'const shipCruiseMotionScale =',
    'const visualPlayerX ='
  );
  assert.match(
    shipPresentationUpdate,
    /state\.viewMode === cameraViewTop[\s\S]*cameraSpeedPerceptionContract\.topShipCruiseScale/
  );
  for (const field of [
    'activity',
    'shipLateralM',
    'shipLiftM',
    'shipYawRad',
    'shipRollRad',
    'shipPitchRad'
  ]) {
    assert.match(
      shipPresentationUpdate,
      new RegExp(`cruiseDynamics\\.${field} \\* shipCruiseMotionScale`)
    );
  }
  assert.match(
    shipPresentationUpdate,
    /\(\s*Math\.sin\(now \* 0\.006_1\)[\s\S]*Math\.sin\(now \* 0\.002_7 \+ 1\.40\)[\s\S]*\)\s*\*\s*shipCruiseMotionScale/
  );
  assert.match(
    shipPresentationUpdate,
    /state\.surfaceContact\.attitudeHeaveM \* surfaceAttitudeScale/
  );
  assert.doesNotMatch(
    shipPresentationUpdate,
    /state\.(?:speed|distance|lives|lateral|altitude|verticalVelocity|routeCursor|pathPlan)\s*=/
  );

  const cycleView = sourceBetween('function cycleViewMode()', 'const cameraNearFrame');
  assert.match(cycleView, /state\.viewMode = \(state\.viewMode \+ 1\) % viewModeNames\.length/);
  assert.match(source, /viewModeName: viewModeNames\[state\.viewMode\]/);
  assert.match(source, /viewModeCount: cameraViewModeCount/);
  assert.match(source, /cameraHoodActive: !state\.cameraCinematicActive && state\.viewMode === cameraViewHood/);
  assert.match(source, /cameraTopActive: !state\.cameraCinematicActive && state\.viewMode === cameraViewTop/);
  assert.match(source, /cameraTopShipCruiseScale: cameraSpeedPerceptionContract\.topShipCruiseScale/);
  assert.match(source, /cameraTopCameraCruiseScale: cameraSpeedPerceptionContract\.topCameraCruiseScale/);
  assert.match(source, /cameraTopLateralErrorM: 0/);
  assert.match(source, /cameraTopLateralErrorM: Number\(state\.cameraTopLateralErrorM\.toFixed\(6\)\)/);
  assert.match(source, /cameraHoodNoseClearanceM:/);
  assert.match(source, /cameraHoodLateralErrorM:/);
  assert.match(source, /cameraHoodPlayerDistanceM:/);
  assert.match(source, /cameraHoodSightlineM:/);
});

test('hood collision guide projects the authoritative player collider only during active hood flight', () => {
  assert.match(source, /const hoodCollisionGuideEl = document\.getElementById\('hoodCollisionGuide'\)/);
  assert.match(
    source,
    /requireDependency\(\s*hoodCollisionGuideEl[\s\S]*?'Neon hood collision guide'\s*\)/
  );

  const colliderHalfLiteral = shipSource.match(
    /const colliderHalf = Object\.freeze\(\{\s*hx:\s*([\d.]+),\s*hy:\s*([\d.]+),\s*hz:\s*([\d.]+)\s*\}\)/
  );
  assert.ok(colliderHalfLiteral, 'Ship collider half-extents must remain a reviewable literal contract');
  const colliderHalf = colliderHalfLiteral.slice(1).map(Number);
  assert.deepEqual(
    colliderHalf.map((halfExtent) => halfExtent * 2),
    [1.44, 1.16, 2.72],
    'Hood guidance must describe the real 1.44 × 1.16 × 2.72 m player collider'
  );

  const guideContract = sourceBetween(
    'const hoodCollisionGuideContract = Object.freeze(',
    'const surfaceWeatherModule = requireDependency('
  );
  assert.match(guideContract, /version:\s*'hood-collision-guide-v3'/);
  assert.match(guideContract, /visibility:\s*'hood-running-only'/);
  assert.match(guideContract, /presentation:\s*'quiet-corner-projection'/);
  assert.match(guideContract, /occlusionPolicy:\s*'center-transparent'/);
  assert.match(guideContract, /readoutPlacement:\s*'lower-edge'/);
  assert.match(guideContract, /threatSource:\s*'same-surface-route-space-contact-window'/);
  assert.match(guideContract, /solidFill:\s*false/);
  assert.match(guideContract, /previewCenterDistanceM:\s*14/);
  assert.match(guideContract, /sweepDistanceM:\s*44/);
  assert.match(
    guideContract,
    /warningTtcSeconds:\s*2\.5/,
    'The useful 2.5s warning horizon must survive the bounded predictor change'
  );
  assert.match(
    guideContract,
    /dangerTtcSeconds:\s*1\.2/,
    'The immediate 1.2s danger threshold must survive the bounded predictor change'
  );
  assert.match(
    source,
    /const HOOD_COLLISION_GUIDE_VERTICAL_PREDICTION_MODEL =\s*'bounded-committed-route-ballistic-v1'/
  );
  assert.match(
    source,
    /const HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES = 96/
  );
  assert.match(
    guideContract,
    /verticalPredictionModel:\s*HOOD_COLLISION_GUIDE_VERTICAL_PREDICTION_MODEL/
  );
  assert.match(
    guideContract,
    /maximumVerticalProbeCount:\s*HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES/
  );
  assert.match(guideContract, /widthM:\s*playerHalf\.hx \* 2/);
  assert.match(guideContract, /heightM:\s*playerHalf\.hy \* 2/);
  assert.match(guideContract, /lengthM:\s*playerHalf\.hz \* 2/);
  assert.doesNotMatch(
    guideContract,
    /\b(?:player\.(?:geometry|scale|userData)|setFromObject\(player\)|Box3\b)/
  );
  assert.match(source, /cameraHoodCollisionGuideVersion:\s*hoodCollisionGuideContract\.version/);
  assert.match(source, /cameraHoodCollisionGuidePresentation:\s*hoodCollisionGuideContract\.presentation/);
  assert.match(source, /cameraHoodCollisionGuideOcclusionPolicy:\s*hoodCollisionGuideContract\.occlusionPolicy/);
  assert.match(source, /cameraHoodCollisionGuideReadoutPlacement:\s*hoodCollisionGuideContract\.readoutPlacement/);
  assert.match(source, /cameraHoodCollisionGuideThreatSource:\s*hoodCollisionGuideContract\.threatSource/);
  assert.match(
    source,
    /cameraHoodCollisionGuideVerticalPredictionModel:\s*hoodCollisionGuideContract\.verticalPredictionModel/
  );
  assert.match(
    source,
    /cameraHoodCollisionGuideMaximumVerticalProbeCount:\s*hoodCollisionGuideContract\.maximumVerticalProbeCount/
  );
  assert.match(
    source,
    /cameraHoodCollisionGuideVerticalProbeCount:\s*hoodCollisionGuideDiagnostics\.verticalProbeCount/
  );
  assert.match(
    source,
    /cameraHoodCollisionGuideFutureLipLaunch:\s*hoodCollisionGuideDiagnostics\.futureLipLaunch/
  );
  assert.match(source, /cameraHoodCollisionGuideSolidFill:\s*hoodCollisionGuideContract\.solidFill/);
  assert.match(source, /cameraHoodCollisionGuideUnderlay:\s*true/);
  assert.match(
    source,
    /const hoodCollisionGuideWorldPoints = Array\.from\(\s*\{ length: 16 \}/
  );
  assert.match(
    source,
    /const hoodCollisionGuideProjectedPoints = new Float32Array\(32\)/
  );

  const committedRawFrame = functionSource('sampleCommittedHoodCollisionGuideRawFrame');
  assert.match(
    committedRawFrame,
    /const edgeIds = state\.pathPlan\.edgeIds/
  );
  assert.match(
    committedRawFrame,
    /while \(remainingM > edge\.length - edgeS \+ 0\.000_001\)/
  );
  assert.match(
    committedRawFrame,
    /if \(edgeIndex >= edgeIds\.length\) return null/,
    'Read-only prediction must fail closed at the materialized itinerary horizon'
  );
  assert.match(
    committedRawFrame,
    /return track\.sampleEdge\(\s*edgeId,\s*clamp\(edgeS \+ remainingM,\s*0,\s*edge\.length\),\s*lateral,\s*out\s*\)/
  );
  assert.doesNotMatch(
    committedRawFrame,
    /\b(?:samplePathFrame|extendPathPlan|ensurePathPlanCoverage)\s*\(/,
    'The raw HUD sampler may not call a cursor adapter that can append route tiles'
  );

  const immutableEdgeIds = ['edge-a'];
  let rawSampleEdgeCalls = 0;
  const sampleCommittedRawFrame = new Function(
    'hasRouteGraphContract',
    'state',
    'track',
    'clamp',
    `'use strict';\n${committedRawFrame}\nreturn sampleCommittedHoodCollisionGuideRawFrame;`
  )(
    () => true,
    {
      routeCursor: { edgeId: 'edge-a', edgeS: 90 },
      pathPlan: {
        edgeIds: immutableEdgeIds,
        edgeIndexById: new Map([['edge-a', 0]])
      }
    },
    {
      getEdge: () => ({ length: 100 }),
      sampleEdge: (edgeId, edgeS, lateral, out) => {
        rawSampleEdgeCalls++;
        return Object.assign(out, { edgeId, edgeS, lateral });
      }
    },
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
  );
  assert.equal(
    sampleCommittedRawFrame(11, 0, {}),
    null,
    'A probe beyond the current edge list must fail closed instead of extending it'
  );
  assert.equal(rawSampleEdgeCalls, 0);
  assert.deepEqual(immutableEdgeIds, ['edge-a']);
  assert.deepEqual(
    sampleCommittedRawFrame(9, 0.5, {}),
    { edgeId: 'edge-a', edgeS: 99, lateral: 0.5 }
  );
  assert.equal(rawSampleEdgeCalls, 1);

  const guideFrameSampler = functionSource('sampleHoodCollisionGuideFrame');
  assert.match(
    guideFrameSampler,
    /function sampleHoodCollisionGuideFrame\(distanceAheadM,\s*out,\s*lateral = state\.lateral\)/
  );
  assert.match(
    guideFrameSampler,
    /sampleCommittedHoodCollisionGuideRawFrame\(\s*distanceAheadM,\s*lateral,\s*out\s*\)/
  );
  assert.match(
    guideFrameSampler,
    /sampleTrackFrame\(\s*sampleDistance,\s*selectedRouteAt\(sampleDistance\),\s*lateral,\s*out\s*\)/
  );
  assert.doesNotMatch(
    guideFrameSampler,
    /\b(?:samplePathFrame|samplePlannedFrame|navigationPathPlan)\s*\(/
  );

  const guideFrameValidator = functionSource('isValidHoodCollisionGuideFrame');
  for (const field of ['x', 'y', 'z', 'rightX', 'rightY', 'rightZ']) {
    assert.match(
      guideFrameValidator,
      new RegExp(`Number\\.isFinite\\(frame\\.${field}\\)`),
      `Hood guidance must reject a non-finite route-frame ${field}`
    );
  }
  assert.match(
    guideFrameValidator,
    /Math\.hypot\(frame\.rightX,\s*frame\.rightY,\s*frame\.rightZ\)/
  );

  const guidePoint = functionSource('setHoodCollisionGuidePoint');
  assert.match(
    guidePoint,
    /hoodCollisionGuideWorldPoints\[index\]\.set\(\s*frame\.x \+ frame\.rightX \* sideM,\s*frame\.y \+ frame\.rightY \* sideM \+ heightM,\s*frame\.z \+ frame\.rightZ \* sideM\s*\)/
  );
  assert.doesNotMatch(guidePoint, /\b(?:upX|upZ)\b/);
  assert.doesNotMatch(
    guidePoint,
    /(?:frame\.(?:x|z)[^,\n]*heightM|heightM[^,\n]*frame\.(?:x|z))/
  );

  const cornerPath = functionSource('hoodCollisionGuideCornerPath');
  assert.match(cornerPath, /for \(let localIndex = 0; localIndex < 4; localIndex\+\+\)/);
  assert.match(cornerPath, /\(\(localIndex \+ 3\) % 4\)/);
  assert.match(cornerPath, /\(\(localIndex \+ 1\) % 4\)/);
  assert.match(cornerPath, /\* edgeFraction/);
  assert.match(
    cornerPath,
    /`M \$\{previousX\.toFixed\(1\)\} \$\{previousY\.toFixed\(1\)\} `[\s\S]*?`L \$\{currentX\.toFixed\(1\)\} \$\{currentY\.toFixed\(1\)\} `[\s\S]*?`L \$\{nextX\.toFixed\(1\)\} \$\{nextY\.toFixed\(1\)\}`/
  );
  assert.doesNotMatch(
    cornerPath,
    /(?:\s|`)Z(?:\s|`)/,
    'V3 corners must remain open so the central flight sightline cannot become a filled plate'
  );

  const contactTtc = functionSource('hoodCollisionGuideContactTtc');
  assert.match(
    contactTtc,
    /const centerGapM = longitudinalDistance - \(playerHalf\.hz \+ obj\.half\.hz\)/
  );
  assert.match(contactTtc, /if \(centerGapM <= 0\) return 0/);
  assert.match(
    contactTtc,
    /const relativeSpeedMps = speed - obstacleLongitudinalVelocity\(obj\)/
  );
  assert.match(
    contactTtc,
    /relativeSpeedMps > 0\s*\?\s*centerGapM \/ relativeSpeedMps\s*:\s*Number\.POSITIVE_INFINITY/
  );
  assert.doesNotMatch(
    contactTtc,
    /obstacleContactWindow|0\.42|\b6(?:\.0+)?\b/,
    'Hood TTC may not inherit planner padding or its service-speed dead zone'
  );
  const evaluateContactTtc = new Function(
    'playerHalf',
    'obstacleLongitudinalVelocity',
    `'use strict';\n${contactTtc}\nreturn hoodCollisionGuideContactTtc;`
  )(
    { hz: colliderHalf[2] },
    (obj) => obj.longitudinalVelocity
  );
  const ttcObstacle = {
    half: { hz: 0.64 },
    longitudinalVelocity: 5
  };
  assert.equal(
    evaluateContactTtc(ttcObstacle, 1.8, 10),
    0,
    'An already-overlapping longitudinal AABB must report immediate contact'
  );
  assert.equal(
    evaluateContactTtc(ttcObstacle, 4, 10),
    0.4,
    'A 2m physical gap closing at 5m/s must report a 0.4s TTC'
  );
  assert.equal(
    evaluateContactTtc({ ...ttcObstacle, longitudinalVelocity: 10 }, 4, 10),
    Number.POSITIVE_INFINITY,
    'A positive gap with no closing speed must not create a false warning'
  );

  const committedSupport = functionSource('sampleCommittedHoodCollisionGuideSupport');
  assert.match(
    committedSupport,
    /function sampleCommittedHoodCollisionGuideSupport\(distanceAheadM,\s*lateral,\s*out\)/
  );
  assert.match(
    committedSupport,
    /const frame = sampleCommittedHoodCollisionGuideRawFrame\(\s*distanceAheadM,\s*lateral,\s*out\s*\)/,
    'Graph support must use the non-extending committed-edge sampler'
  );
  assert.match(
    committedSupport,
    /const platforms = track\.getEdge\?\.\(frame\.edgeId\)\?\.jumpPlatforms/
  );
  assert.match(
    committedSupport,
    /frame\.edgeS < platform\.startS - 0\.000_001[\s\S]*?frame\.edgeS > platform\.lipS \+ 0\.000_001[\s\S]*?Math\.abs\(lateral - platform\.lateral\) \+ playerHalf\.hx[\s\S]*?> platform\.halfWidth \+ 0\.000_001/
  );
  assert.match(
    committedSupport,
    /out\.height \+= platform\.height \* progress/,
    'Grounded probes before the lip must retain the authored table support'
  );
  assert.doesNotMatch(
    committedSupport,
    /\b(?:samplePathFrame|sampleJumpPlatformSupport|sampleGameplaySurfaceAhead|navigationPathPlan)\s*\(/,
    'Grounded prediction may not invoke an extending or duplicate-sampling helper'
  );

  const verticalProfile = functionSource('sampleCommittedHoodCollisionGuideVerticalProfile');
  assert.match(
    verticalProfile,
    /function sampleCommittedHoodCollisionGuideVerticalProfile\(distanceM,\s*lateral,\s*out\)/
  );
  assert.match(
    verticalProfile,
    /sampleCommittedHoodCollisionGuideRawFrame\(\s*distanceM,\s*lateral,\s*out\s*\)/
  );
  assert.match(
    verticalProfile,
    /out\.hoodSurfaceY = Number\.isFinite\(frame\.y\) \? frame\.y : Number\(frame\.surfaceHeight\)/
  );
  assert.match(
    verticalProfile,
    /out\.hoodCeilingY = Number\.isFinite\(frame\.ceilingHeight\)\s*\? frame\.ceilingHeight\s*:\s*Number\.POSITIVE_INFINITY/
  );
  assert.doesNotMatch(
    verticalProfile,
    /\b(?:samplePathFrame|sampleGameplaySurfaceAhead|navigationPathPlan)\s*\(/
  );

  const predictedPlayerLateral = functionSource(
    'hoodCollisionGuidePredictedPlayerLateralAt'
  );
  assert.match(source, /const jumpPlatformAirborneLateralHalf = 42/);
  assert.match(
    predictedPlayerLateral,
    /state\.jumpPlatformFlightActive\s*&& !state\.grounded\s*&& sampleTimeSeconds < hoodCollisionGuideVerticalPrediction\.landingTimeSeconds/
  );
  assert.match(
    predictedPlayerLateral,
    /sampleTimeSeconds > hoodCollisionGuideVerticalPrediction\.launchTimeSeconds\s*&& sampleTimeSeconds < hoodCollisionGuideVerticalPrediction\.landingTimeSeconds/
  );
  assert.match(
    predictedPlayerLateral,
    /const lateralHalf = freePlatformFlight\s*\? jumpPlatformAirborneLateralHalf\s*:\s*activeRoadSafeHalf\(\)/
  );
  const lateralState = {
    lateral: 50,
    lateralVelocity: 0,
    jumpPlatformFlightActive: true,
    grounded: false
  };
  const lateralPrediction = {
    startsGrounded: false,
    launchTimeSeconds: Number.POSITIVE_INFINITY,
    landingTimeSeconds: 1
  };
  const predictedLateralAt = new Function(
    'deps',
    `'use strict';
    const {
      state,
      hoodCollisionGuideVerticalPrediction,
      jumpPlatformAirborneLateralHalf,
      activeRoadSafeHalf,
      clamp
    } = deps;
    ${predictedPlayerLateral}
    return hoodCollisionGuidePredictedPlayerLateralAt;`
  )({
    state: lateralState,
    hoodCollisionGuideVerticalPrediction: lateralPrediction,
    jumpPlatformAirborneLateralHalf: 42,
    activeRoadSafeHalf: () => 8,
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
  });
  assert.equal(
    predictedLateralAt(0.5),
    42,
    'An active platform flight must retain the full cross-median ±42m envelope before landing'
  );
  assert.equal(
    predictedLateralAt(1),
    8,
    'At the predicted landing instant the ordinary road boundary must resume'
  );
  lateralState.jumpPlatformFlightActive = false;
  lateralState.grounded = true;
  lateralPrediction.startsGrounded = true;
  lateralPrediction.launchTimeSeconds = 0.2;
  lateralPrediction.landingTimeSeconds = 0.8;
  assert.equal(predictedLateralAt(0.5), 42);
  assert.equal(predictedLateralAt(0.8), 8);

  const findFutureLaunch = functionSource('findCommittedHoodCollisionGuideLaunch');
  assert.match(findFutureLaunch, /const edgeIds = state\.pathPlan\.edgeIds/);
  assert.match(
    findFutureLaunch,
    /if \(!\(fromS < platform\.lipS && toS >= platform\.lipS\)\) continue/
  );
  assert.match(
    findFutureLaunch,
    /Math\.abs\(crossingLateral - platform\.lateral\) \+ playerHalf\.hx[\s\S]*?> platform\.halfWidth \+ 0\.000_001/
  );
  assert.match(
    findFutureLaunch,
    /sampleCommittedHoodCollisionGuideRawFrame\(\s*firstPlatformDistanceM,\s*firstPlatformLateral,\s*hoodCollisionGuideLaunchFrame\s*\)/
  );
  assert.match(
    findFutureLaunch,
    /out\.altitudeY = lipFrame\.y \+ firstPlatform\.height;\s*out\.velocityY = surfaceTangentVerticalVelocity\(speed,\s*firstPlatform\.grade\)/
  );
  assert.doesNotMatch(
    findFutureLaunch,
    /\b(?:samplePathFrame|sweptVerticalContact|navigationPathPlan)\s*\(/
  );

  const detectedLaunch = new Function(
    'deps',
    `'use strict';
    const {
      hasRouteGraphContract,
      state,
      track,
      clamp,
      hoodCollisionGuidePredictedPlayerLateralAt,
      playerHalf,
      sampleCommittedHoodCollisionGuideRawFrame,
      hoodCollisionGuideLaunchFrame,
      surfaceTangentVerticalVelocity
    } = deps;
    ${findFutureLaunch}
    return findCommittedHoodCollisionGuideLaunch;`
  )({
    hasRouteGraphContract: () => true,
    state: {
      routeCursor: { edgeId: 'launch-edge', edgeS: 0 },
      pathPlan: {
        edgeIds: ['launch-edge'],
        edgeIndexById: new Map([['launch-edge', 0]])
      }
    },
    track: {
      getEdge: () => ({
        length: 100,
        jumpPlatforms: [{
          lipS: 50,
          lateral: 0,
          halfWidth: 2,
          height: 4,
          grade: 0.2
        }]
      })
    },
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    hoodCollisionGuidePredictedPlayerLateralAt: () => 0,
    playerHalf: { hx: colliderHalf[0] },
    sampleCommittedHoodCollisionGuideRawFrame: (_distance, _lateral, out) => (
      Object.assign(out, { y: 0 })
    ),
    hoodCollisionGuideLaunchFrame: {},
    surfaceTangentVerticalVelocity: (speed, grade) => speed * grade
  })(60, 100, {});
  assert.deepEqual(detectedLaunch, {
    hit: true,
    distanceM: 50,
    timeSeconds: 0.5,
    altitudeY: 4,
    velocityY: 20,
    lateral: 0
  });

  const ceilingContactSource = functionSource('hoodCollisionGuideCeilingContactTime');
  const floorContactSource = functionSource('hoodCollisionGuideFloorContactTime');
  const clampNumber = (value, minimum, maximum) => (
    Math.max(minimum, Math.min(maximum, value))
  );
  const ceilingContactTime = new Function(
    'verticalGravity',
    'playerTopOffset',
    'ceilingContactMargin',
    'clamp',
    `'use strict';
    ${ceilingContactSource}
    return hoodCollisionGuideCeilingContactTime;`
  )(60, 1, 0.2, clampNumber);
  const floorContactTime = new Function(
    'verticalGravity',
    'clamp',
    `'use strict';
    ${floorContactSource}
    return hoodCollisionGuideFloorContactTime;`
  )(60, clampNumber);
  const ceilingHitSeconds = ceilingContactTime(0, 30, 5, 5, 1);
  const floorHitSeconds = floorContactTime(5, 0, 0, 0, 1);
  assert.ok(
    Number.isFinite(ceilingHitSeconds) && ceilingHitSeconds > 0 && ceilingHitSeconds < 1,
    'An active climb must detect a ceiling within the bounded interval'
  );
  assert.ok(
    Number.isFinite(floorHitSeconds) && floorHitSeconds > 0 && floorHitSeconds < 1,
    'An active ballistic fall must detect its floor within the bounded interval'
  );

  const prepareVerticalPrediction = functionSource(
    'prepareHoodCollisionGuideVerticalPrediction'
  );
  const insertVerticalProbeTime = functionSource(
    'insertHoodCollisionGuideVerticalProbeTime'
  );
  const insertCommittedVerticalStation = functionSource(
    'insertCommittedHoodCollisionGuideVerticalStation'
  );
  const buildVerticalProbeSchedule = functionSource(
    'buildCommittedHoodCollisionGuideVerticalProbeSchedule'
  );
  assert.match(
    source,
    /const hoodCollisionGuideVerticalAltitudes = new Float64Array\(\s*HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES\s*\)/
  );
  assert.match(
    source,
    /const hoodCollisionGuideVerticalProbeTimes = new Float64Array\(\s*HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES\s*\)/
  );
  assert.match(
    insertVerticalProbeTime,
    /if \(probeCount >= HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES\) return probeCount/
  );
  assert.match(
    buildVerticalProbeSchedule,
    /insertCommittedHoodCollisionGuideVerticalStation\(\s*edge\.length,/
  );
  assert.match(
    buildVerticalProbeSchedule,
    /tunnelProfile\.surfaceStartS \?\? tunnelProfile\.startS[\s\S]*?tunnelProfile\.surfaceEndS \?\? tunnelProfile\.endS/
  );
  assert.match(
    buildVerticalProbeSchedule,
    /crossing\.lowerSpanStartS[\s\S]*?crossing\.lowerSpanEndS/
  );
  const firstTopologyStationAt = buildVerticalProbeSchedule.indexOf(
    'insertCommittedHoodCollisionGuideVerticalStation('
  );
  const uniformFillAt = buildVerticalProbeSchedule.indexOf(
    'const uniformInteriorCount ='
  );
  assert.ok(
    firstTopologyStationAt >= 0
      && uniformFillAt > firstTopologyStationAt,
    'Edge, tunnel, and lower-crossing stations must reserve slots before uniform fill'
  );
  assert.match(
    buildVerticalProbeSchedule,
    /const targetProbeCount = Math\.min\(\s*HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES,\s*Math\.max\([\s\S]*?Math\.ceil\(flightDistanceM \/ HOOD_COLLISION_GUIDE_TARGET_PROBE_DISTANCE_M\) \+ 1,[\s\S]*?Math\.ceil\(\s*flightDurationSeconds \/ HOOD_COLLISION_GUIDE_TARGET_PROBE_SECONDS\s*\) \+ 1/
  );
  const createVerticalSchedule = (
    probeTimes,
    scheduleState,
    scheduleTrack,
    graphEnabled
  ) => new Function(
    'deps',
    `'use strict';
    const {
      hoodCollisionGuideVerticalProbeTimes,
      HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES,
      HOOD_COLLISION_GUIDE_TARGET_PROBE_DISTANCE_M,
      HOOD_COLLISION_GUIDE_TARGET_PROBE_SECONDS,
      hasRouteGraphContract,
      state,
      track
    } = deps;
    ${insertVerticalProbeTime}
    ${insertCommittedVerticalStation}
    ${buildVerticalProbeSchedule}
    return buildCommittedHoodCollisionGuideVerticalProbeSchedule;`
  )({
    hoodCollisionGuideVerticalProbeTimes: probeTimes,
    HOOD_COLLISION_GUIDE_MAX_VERTICAL_PROBES: 96,
    HOOD_COLLISION_GUIDE_TARGET_PROBE_DISTANCE_M: 3,
    HOOD_COLLISION_GUIDE_TARGET_PROBE_SECONDS: 1 / 60,
    hasRouteGraphContract: () => graphEnabled,
    state: scheduleState,
    track: scheduleTrack
  });
  const topologyProbeTimes = new Float64Array(96);
  const topologySchedule = createVerticalSchedule(
    topologyProbeTimes,
    {
      routeCursor: { edgeId: 'topology-a', edgeS: 0 },
      pathPlan: {
        edgeIds: ['topology-a', 'topology-b'],
        edgeIndexById: new Map([['topology-a', 0], ['topology-b', 1]])
      }
    },
    {
      graph: {
        crossings: [{
          lowerEdgeId: 'topology-a',
          lowerSpanStartS: 30,
          lowerSpanEndS: 40
        }]
      },
      getEdge: (edgeId) => edgeId === 'topology-a'
        ? {
            id: edgeId,
            length: 100,
            tunnelProfiles: [{ surfaceStartS: 20, surfaceEndS: 25 }]
          }
        : { id: edgeId, length: 100 }
    },
    true
  );
  const topologyProbeCount = topologySchedule(0, 120, 1.2, 100);
  assert.equal(topologyProbeCount, 73);
  for (const requiredTime of [0, 0.2, 0.25, 0.3, 0.4, 1, 1.2]) {
    assert.ok(
      topologyProbeTimes
        .subarray(0, topologyProbeCount)
        .some((timeSeconds) => Math.abs(timeSeconds - requiredTime) <= 0.000_001),
      `Probe schedule must retain topology time ${requiredTime}`
    );
  }
  for (let probeIndex = 1; probeIndex < topologyProbeCount; probeIndex++) {
    assert.ok(topologyProbeTimes[probeIndex] > topologyProbeTimes[probeIndex - 1]);
  }
  assert.ok(topologyProbeCount <= 96);
  assert.match(
    prepareVerticalPrediction,
    /const probeCount = buildCommittedHoodCollisionGuideVerticalProbeSchedule\(\s*flightStartDistanceM,\s*flightDistanceM,\s*flightDurationSeconds,\s*speed\s*\)/
  );
  assert.match(
    prepareVerticalPrediction,
    /const probeStepCount = probeCount - 1/
  );
  assert.match(
    prepareVerticalPrediction,
    /for \(let probeIndex = 1; probeIndex < probeCount; probeIndex\+\+\)/
  );
  assert.match(
    prepareVerticalPrediction,
    /const launch = findCommittedHoodCollisionGuideLaunch\([\s\S]*?if \(!launch\.hit\) \{[\s\S]*?prediction\.valid = true;[\s\S]*?return true;[\s\S]*?\}[\s\S]*?prediction\.launchTimeSeconds = launch\.timeSeconds/
  );
  assert.match(
    prepareVerticalPrediction,
    /hoodCollisionGuideCeilingContactTime\([\s\S]*?hoodCollisionGuideFloorContactTime\(/
  );
  assert.doesNotMatch(
    prepareVerticalPrediction,
    /\b(?:samplePathFrame|sweptVerticalContact|navigationPathPlan)\s*\(/
  );

  const predictionState = {
    grounded: false,
    altitude: 30,
    verticalVelocity: 5
  };
  const predictionRecord = {
    valid: false,
    startsGrounded: false,
    launchTimeSeconds: Number.POSITIVE_INFINITY,
    landingTimeSeconds: Number.POSITIVE_INFINITY,
    flightStartTimeSeconds: 0,
    flightDurationSeconds: 0,
    probeCount: 0,
    probeStepCount: 0
  };
  const predictionAltitudes = new Float64Array(96);
  const predictionProbeTimes = new Float64Array(96);
  const predictionSchedule = createVerticalSchedule(
    predictionProbeTimes,
    predictionState,
    {},
    false
  );
  let preparedLaunch = null;
  let ceilingProbeChecks = 0;
  let floorProbeChecks = 0;
  const preparePrediction = new Function(
    'deps',
    `'use strict';
    const {
      hoodCollisionGuideVerticalPrediction,
      state,
      findCommittedHoodCollisionGuideLaunch,
      hoodCollisionGuideLaunchScratch,
      hoodCollisionGuideVerticalAltitudes,
      hoodCollisionGuideVerticalProbeTimes,
      buildCommittedHoodCollisionGuideVerticalProbeSchedule,
      hoodCollisionGuidePredictedPlayerLateralAt,
      sampleCommittedHoodCollisionGuideVerticalProfile,
      hoodCollisionGuideVerticalProfileFrame,
      hoodCollisionGuideCeilingContactTime,
      hoodCollisionGuideFloorContactTime,
      verticalGravity
    } = deps;
    ${prepareVerticalPrediction}
    return prepareHoodCollisionGuideVerticalPrediction;`
  )({
    hoodCollisionGuideVerticalPrediction: predictionRecord,
    state: predictionState,
    findCommittedHoodCollisionGuideLaunch: (_distance, _speed, out) => Object.assign(
      out,
      preparedLaunch ?? {
        hit: false,
        distanceM: 0,
        timeSeconds: 0,
        altitudeY: 0,
        velocityY: 0,
        lateral: 0
      }
    ),
    hoodCollisionGuideLaunchScratch: {},
    hoodCollisionGuideVerticalAltitudes: predictionAltitudes,
    hoodCollisionGuideVerticalProbeTimes: predictionProbeTimes,
    buildCommittedHoodCollisionGuideVerticalProbeSchedule: predictionSchedule,
    hoodCollisionGuidePredictedPlayerLateralAt: () => 0,
    sampleCommittedHoodCollisionGuideVerticalProfile: (_distance, _lateral, out) => (
      Object.assign(out, {
        hoodSurfaceY: 0,
        hoodCeilingY: 1_000
      })
    ),
    hoodCollisionGuideVerticalProfileFrame: {},
    hoodCollisionGuideCeilingContactTime: () => {
      ceilingProbeChecks++;
      return Number.POSITIVE_INFINITY;
    },
    hoodCollisionGuideFloorContactTime: () => {
      floorProbeChecks++;
      return Number.POSITIVE_INFINITY;
    },
    verticalGravity: 60
  });
  assert.equal(preparePrediction(2.5, 100), true);
  assert.equal(
    predictionRecord.probeCount,
    96,
    'A long high-speed horizon must stay inside the fixed 96-probe budget'
  );
  assert.equal(predictionRecord.probeStepCount, 95);
  assert.equal(ceilingProbeChecks, 95);
  assert.equal(floorProbeChecks, 95);

  predictionState.grounded = true;
  predictionState.altitude = 0;
  predictionState.verticalVelocity = 0;
  preparedLaunch = detectedLaunch;
  ceilingProbeChecks = 0;
  floorProbeChecks = 0;
  assert.equal(preparePrediction(1, 100), true);
  assert.equal(predictionRecord.startsGrounded, true);
  assert.equal(predictionRecord.launchTimeSeconds, 0.5);
  assert.equal(predictionRecord.flightStartTimeSeconds, 0.5);
  assert.equal(predictionRecord.flightDurationSeconds, 0.5);
  assert.equal(predictionRecord.probeCount, 31);
  assert.equal(predictionRecord.probeStepCount, 30);
  assert.equal(predictionAltitudes[0], 4);
  assert.equal(ceilingProbeChecks, 30);
  assert.equal(floorProbeChecks, 30);

  const playerAltitudeSource = functionSource('hoodCollisionGuidePlayerAltitudeAt');
  assert.match(
    playerAltitudeSource,
    /prediction\.startsGrounded[\s\S]*?timeSeconds <= prediction\.launchTimeSeconds \+ 0\.000_001[\s\S]*?sampleCommittedHoodCollisionGuideSupport\(/
  );
  assert.match(
    playerAltitudeSource,
    /hoodCollisionGuideVerticalProbeTimes\[middleIndex\][\s\S]*?hoodCollisionGuideVerticalAltitudes\[lowerIndex\][\s\S]*?hoodCollisionGuideVerticalAltitudes\[upperIndex\]/
  );
  let supportProbeCalls = 0;
  const playerAltitudeAt = new Function(
    'deps',
    `'use strict';
    const {
      hoodCollisionGuideVerticalPrediction,
      sampleCommittedHoodCollisionGuideSupport,
      hoodCollisionGuidePlayerSurfaceFrame,
      hoodCollisionGuideVerticalAltitudes,
      hoodCollisionGuideVerticalProbeTimes,
      clamp,
      lerp
    } = deps;
    ${playerAltitudeSource}
    return hoodCollisionGuidePlayerAltitudeAt;`
  )({
    hoodCollisionGuideVerticalPrediction: predictionRecord,
    sampleCommittedHoodCollisionGuideSupport: () => {
      supportProbeCalls++;
      return { height: 2 };
    },
    hoodCollisionGuidePlayerSurfaceFrame: {},
    hoodCollisionGuideVerticalAltitudes: predictionAltitudes,
    hoodCollisionGuideVerticalProbeTimes: predictionProbeTimes,
    clamp: clampNumber,
    lerp: (start, end, amount) => start + (end - start) * amount
  });
  assert.equal(playerAltitudeAt(0.25, 100, 0), 2);
  const afterLipAltitude = playerAltitudeAt(0.75, 100, 0);
  assert.equal(supportProbeCalls, 1);
  assert.ok(
    Number.isFinite(afterLipAltitude) && afterLipAltitude > 2,
    'After crossing the future table lip, the HUD must read the airborne trajectory instead of road support'
  );

  const verticalOverlap = functionSource('hoodCollisionGuideHasVerticalOverlap');
  assert.match(
    verticalOverlap,
    /longitudinalDistance \+ obstacleLongitudinalVelocity\(obj\) \* ttcSeconds/
  );
  assert.doesNotMatch(
    verticalOverlap,
    /\b(?:samplePathFrame|sweptVerticalContact|sampleGameplaySurfaceAhead|navigationPathPlan)\s*\(/,
    'Per-obstacle overlap may only read the shared bounded player trajectory'
  );
  assert.match(
    verticalOverlap,
    /sampleHoodCollisionGuideFrame\(\s*obstacleDistanceAheadM,\s*hoodCollisionGuideObstacleSurfaceFrame,\s*predictedObstacleLateral\s*\)/
  );
  assert.match(
    verticalOverlap,
    /if \(!isValidHoodCollisionGuideFrame\(obstacleRouteFrame\)\) return false/
  );
  assert.match(
    verticalOverlap,
    /const obstacleSurfaceY = Number\.isFinite\(obstacleRouteFrame\.surfaceHeight\)\s*\? obstacleRouteFrame\.surfaceHeight\s*:\s*Number\(obstacleRouteFrame\.y\)/,
    'Obstacle height must prefer its centreline surfaceHeight before applying obj.y'
  );
  assert.match(
    verticalOverlap,
    /const obstacleCenterY = obstacleSurfaceY \+ Number\(obj\.y\)/
  );
  assert.doesNotMatch(
    verticalOverlap,
    /const obstacleSurfaceY = Number\.isFinite\(obstacleRouteFrame\.y\)\s*\?\s*obstacleRouteFrame\.y/,
    'A banked player-support frame.y may not displace a centreline obstacle'
  );
  assert.match(
    verticalOverlap,
    /const playerAltitudeY = hoodCollisionGuidePlayerAltitudeAt\(\s*ttcSeconds,\s*speed,\s*predictedPlayerLateral\s*\)/,
    'Every obstacle must read the one shared bounded player forecast'
  );
  assert.match(
    verticalOverlap,
    /Math\.abs\(obstacleCenterY - playerCenterY\) <= playerHalf\.hy \+ obj\.half\.hy/
  );
  assert.doesNotMatch(
    verticalOverlap,
    /entitySharesPlayerSurface|nearestMinimapObstacleDistance/
  );

  const threatCandidate = functionSource('writeHoodCollisionGuideCandidate');
  assert.match(
    threatCandidate,
    /routesCompatible\(obj\.routeId,\s*obj\.s,\s*obj\)/
  );
  assert.match(
    threatCandidate,
    /!graphMode\s*&& \(\s*!routesCompatible\(obj\.routeId,\s*obj\.s,\s*obj\)\s*\|\| !entitySharesPlayerSurface\(obj\)\s*\)/,
    'Only legacy candidates may invoke compatibility helpers with entity-side diagnostics'
  );
  assert.equal(
    (threatCandidate.match(/entitySharesPlayerSurface\(obj\)/g) || []).length,
    1,
    'Only the explicit legacy-mode branch may reject traffic by its current surface'
  );
  assert.match(
    threatCandidate,
    /graphDistance = track\.distanceAlongPath\(\s*state\.routeCursor,\s*hoodCollisionGuideEntityCursorScratch,\s*state\.pathPlan\s*\)/,
    'Graph distance must read the committed plan through caller-owned cursor scratch'
  );
  assert.match(
    threatCandidate,
    /graphMode\s*&& \(!Number\.isFinite\(graphDistance\) \|\| graphDistance < -6\)/,
    'The observational graph check must preserve the gameplay six-metre rear allowance'
  );
  assert.doesNotMatch(
    threatCandidate,
    /graphEntityDistance\(|predictedObstacleLateralOnRoute\(/,
    'Threat classification may not call helpers that publish entity rejection state'
  );
  assert.match(
    threatCandidate,
    /const longitudinalDistance = graphMode\s*\?\s*graphDistance\s*:\s*Number\(obj\.s\) - state\.distance/
  );
  assert.match(
    threatCandidate,
    /const ttcSeconds = hoodCollisionGuideContactTtc\(obj,\s*longitudinalDistance,\s*speed\)/
  );
  assert.match(
    threatCandidate,
    /ttcSeconds > hoodCollisionGuideContract\.warningTtcSeconds/
  );
  assert.match(
    threatCandidate,
    /obstacleLocalLateral = gameplayCore\.sampleObstacleLateral\(\s*lateralInput,\s*ttcSeconds\s*\)/
  );
  assert.match(
    threatCandidate,
    /const predictedObstacleLateral = graphMode\s*\?\s*obstacleLocalLateral\s*:\s*lateralRelativeToRoute\(/
  );
  assert.match(
    threatCandidate,
    /const predictedPlayerLateral = hoodCollisionGuidePredictedPlayerLateralAt\(ttcSeconds\)/
  );
  assert.match(
    threatCandidate,
    /Math\.abs\(predictedObstacleLateral - predictedPlayerLateral\)[\s\S]*?> playerHalf\.hx \+ obj\.half\.hx/
  );
  assert.match(
    threatCandidate,
    /out\.valid = true;\s*out\.ttcSeconds = ttcSeconds;\s*out\.longitudinalDistance = longitudinalDistance;\s*out\.predictedPlayerLateral = predictedPlayerLateral;\s*out\.predictedObstacleLateral = predictedObstacleLateral/
  );

  const threatClassifier = functionSource('classifyHoodCollisionGuideThreat');
  assert.match(threatClassifier, /const graphMode = hasRouteGraphContract\(\)/);
  assert.match(
    threatClassifier,
    /hoodCollisionGuideDiagnostics\.verticalProbeCount = 0;\s*hoodCollisionGuideDiagnostics\.futureLipLaunch = false/,
    'Empty, invalid, and failed candidate sets must clear stale bounded-prediction diagnostics'
  );
  assert.equal(
    (threatClassifier.match(/writeHoodCollisionGuideCandidate\(/g) || []).length,
    2,
    'Both allocation-free passes must use the same candidate filter'
  );
  assert.match(
    threatClassifier,
    /maximumCandidateTtcSeconds = Math\.max\(\s*maximumCandidateTtcSeconds,\s*candidate\.ttcSeconds\s*\);\s*candidateCount\+\+/
  );
  assert.match(
    threatClassifier,
    /candidateCount > 0\s*&& prepareHoodCollisionGuideVerticalPrediction\(maximumCandidateTtcSeconds,\s*speed\)/
  );
  assert.equal(
    (threatClassifier.match(/prepareHoodCollisionGuideVerticalPrediction\(/g) || []).length,
    1,
    'All obstacle candidates must share one bounded player trajectory'
  );
  assert.match(
    threatClassifier,
    /hoodCollisionGuideDiagnostics\.verticalProbeCount =\s*hoodCollisionGuideVerticalPrediction\.probeCount/
  );
  assert.match(
    threatClassifier,
    /hoodCollisionGuideDiagnostics\.futureLipLaunch =\s*hoodCollisionGuideVerticalPrediction\.startsGrounded\s*&& Number\.isFinite\(hoodCollisionGuideVerticalPrediction\.launchTimeSeconds\)/
  );
  assert.match(
    threatClassifier,
    /hoodCollisionGuideHasVerticalOverlap\(\s*obj,\s*candidate\.ttcSeconds,\s*candidate\.longitudinalDistance,\s*candidate\.predictedPlayerLateral,\s*candidate\.predictedObstacleLateral,\s*speed\s*\)/
  );
  assert.match(
    threatClassifier,
    /nearestTtcSeconds <= hoodCollisionGuideContract\.dangerTtcSeconds[\s\S]*?'danger'[\s\S]*?nearestTtcSeconds <= hoodCollisionGuideContract\.warningTtcSeconds[\s\S]*?'warning'[\s\S]*?'clear'/
  );
  assert.doesNotMatch(
    threatClassifier,
    /nearestMinimapObstacleDistance|autoNextObstacleDistance|obstacleContactWindow|new\s+|\.push\(/,
    'Hood warnings must use the shared physical contact window, never minimap or autopilot proximity'
  );
  const boundedThreatPredictionSource = [
    committedRawFrame,
    guideFrameSampler,
    committedSupport,
    verticalProfile,
    findFutureLaunch,
    prepareVerticalPrediction,
    playerAltitudeSource,
    threatCandidate,
    verticalOverlap,
    threatClassifier
  ].join('\n');
  assert.doesNotMatch(
    boundedThreatPredictionSource,
    /\b(?:samplePathFrame|sweptVerticalContact|navigationPathPlan)\s*\(/,
    'Hood threat prediction must remain bounded, read-only, and independent of live long-span sweep APIs'
  );

  const guideUpdate = functionSource('updateHoodCollisionGuide');
  assert.match(guideUpdate, /state\.viewMode !== cameraViewHood/);
  assert.match(guideUpdate, /\|\| !state\.running/);
  assert.match(guideUpdate, /\|\| state\.gameOver/);
  assert.match(guideUpdate, /\|\| isLaunchOverlayVisible\(\)/);
  assert.match(
    guideUpdate,
    /hideHoodCollisionGuide\('view-or-lifecycle-inactive'\);\s*return;/
  );
  assert.match(guideUpdate, /hoodCollisionGuideEl\.hidden = false/);
  assert.doesNotMatch(guideUpdate, /aria-hidden/);
  assert.match(
    guideUpdate,
    /if \(!isValidHoodCollisionGuideFrame\(centerFrame\)\) \{\s*hoodCollisionGuideDiagnostics\.volumeInvalidCount\+\+;\s*hideHoodCollisionGuide\('invalid-route-frame'\);\s*return;\s*\}/,
    'The normal guide must fail closed from its one mandatory 14m centre frame'
  );
  assert.match(
    guideUpdate,
    /let backFrame = null;\s*let frontFrame = null;\s*if \(launchOptions\.modelDebug\) \{\s*backFrame = sampleHoodCollisionGuideFrame\(\s*previewCenterM - playerHalf\.hz,\s*hoodCollisionGuideBackFrame\s*\);\s*frontFrame = sampleHoodCollisionGuideFrame\(\s*previewCenterM \+ playerHalf\.hz,\s*hoodCollisionGuideFrontFrame\s*\);[\s\S]*?!isValidHoodCollisionGuideFrame\(backFrame\)\s*\|\| !isValidHoodCollisionGuideFrame\(frontFrame\)[\s\S]*?hideHoodCollisionGuide\('invalid-debug-volume-frame'\);\s*return;[\s\S]*?\}\s*\}\s*let railsVisible/,
    'Back/front sampling and validation must remain inside the model-debug calibration branch'
  );
  const invalidRouteFrameAt = guideUpdate.indexOf(
    "hideHoodCollisionGuide('invalid-route-frame')"
  );
  const debugBackSampleAt = guideUpdate.indexOf(
    'backFrame = sampleHoodCollisionGuideFrame('
  );
  const centerGateAt = guideUpdate.indexOf(
    'setHoodCollisionGuideGate(centerFrame'
  );
  assert.ok(
    invalidRouteFrameAt >= 0
      && invalidRouteFrameAt < debugBackSampleAt
      && invalidRouteFrameAt < centerGateAt,
    'An invalid normal centre frame must fail closed before debug sampling or point construction'
  );

  assert.match(
    guideUpdate,
    /if \(launchOptions\.modelDebug\) \{\s*setHoodCollisionGuideGate\(backFrame,\s*0,\s*clearanceM\);\s*setHoodCollisionGuideGate\(frontFrame,\s*4,\s*clearanceM\);\s*\}\s*if \(railsVisible\) setHoodCollisionGuideGate\(sweepFrame,\s*8,\s*clearanceM\);\s*setHoodCollisionGuideGate\(centerFrame,\s*12,\s*clearanceM\)/,
    'Back/front gates must stay model-debug-only while normal play builds only centre and far gates'
  );
  assert.match(
    guideUpdate,
    /setHoodCollisionGuideGate\(centerFrame,\s*12,\s*clearanceM\)/
  );
  const debugProjectionAt = guideUpdate.indexOf('for (let index = 0; index < 8; index++)');
  const centerProjectionAt = guideUpdate.indexOf('for (let index = 12; index < 16; index++)');
  const farProjectionAt = guideUpdate.indexOf('for (let index = 8; index < 12; index++)');
  const volumePathAt = guideUpdate.indexOf("hoodCollisionGuideVolumeEl.setAttribute(");
  assert.ok(
    debugProjectionAt >= 0
      && debugProjectionAt < centerProjectionAt
      && centerProjectionAt < farProjectionAt,
    'Debug calibration projection must precede the normal centre and optional far-rail projection'
  );
  const debugProjection = guideUpdate.slice(debugProjectionAt, centerProjectionAt);
  assert.match(
    debugProjection,
    /hideHoodCollisionGuide\('debug-volume-outside-camera'\);\s*return;/
  );
  assert.match(
    guideUpdate,
    /if \(launchOptions\.modelDebug\) \{\s*for \(let index = 0; index < 8; index\+\+\) \{[\s\S]*?hideHoodCollisionGuide\('debug-volume-outside-camera'\);\s*return;[\s\S]*?\}\s*\}\s*for \(let index = 12; index < 16; index\+\+\)/,
    'Back/front point projection must be unreachable during normal play'
  );
  const centerProjection = guideUpdate.slice(centerProjectionAt, farProjectionAt);
  assert.match(
    centerProjection,
    /hideHoodCollisionGuide\('volume-outside-camera'\);\s*return;/
  );
  const farProjection = guideUpdate.slice(farProjectionAt, volumePathAt);
  assert.match(farProjection, /railsVisible = false/);
  assert.match(farProjection, /break;/);
  assert.doesNotMatch(farProjection, /hideHoodCollisionGuide\(/);
  assert.ok(
    farProjectionAt < volumePathAt,
    'A clipped far sweep may not prevent the valid near collider volume from being drawn'
  );
  assert.match(
    guideUpdate,
    /else \{\s*hoodCollisionGuideRailsEl\.setAttribute\('d', ''\);\s*hoodCollisionGuideSweepEl\.setAttribute\('d', ''\);\s*hoodCollisionGuideAxisEl\.setAttribute\('d', ''\);\s*\}/
  );
  assert.match(guideUpdate, /const backPath = hoodCollisionGuideCornerPath\(0,\s*0\.18\)/);
  assert.match(
    guideUpdate,
    /const debugFrontPath = hoodCollisionGuideCornerPath\(4,\s*0\.24\)/
  );
  assert.match(guideUpdate, /const centerPath = hoodCollisionGuideCornerPath\(12,\s*0\.24\)/);
  assert.match(
    guideUpdate,
    /const depthPath = `M \$\{hoodCollisionGuidePointText\(0\)\} L \$\{front0\} `\s*\+\s*`M \$\{hoodCollisionGuidePointText\(1\)\} L \$\{front1\} `\s*\+\s*`M \$\{hoodCollisionGuidePointText\(2\)\} L \$\{front2\} `\s*\+\s*`M \$\{hoodCollisionGuidePointText\(3\)\} L \$\{front3\}`/
  );
  assert.match(
    guideUpdate,
    /let volumePath = '';\s*if \(launchOptions\.modelDebug\) \{[\s\S]*?const backPath = hoodCollisionGuideCornerPath\(0,\s*0\.18\);[\s\S]*?const debugFrontPath = hoodCollisionGuideCornerPath\(4,\s*0\.24\);[\s\S]*?const depthPath =[\s\S]*?volumePath = `\$\{backPath\} \$\{debugFrontPath\} \$\{depthPath\}`;\s*\}/,
    'The full back/front/depth calibration volume must be built only in model debug'
  );
  assert.match(
    guideUpdate,
    /hoodCollisionGuideVolumeEl\.setAttribute\('d',\s*volumePath\);\s*hoodCollisionGuideFrontEl\.setAttribute\('d',\s*centerPath\)/,
    'Normal play must render the centre station while its debug volume path remains empty'
  );
  assert.equal(
    (guideUpdate.match(/\bvolumePath\s*=/g) || []).length,
    2,
    'Volume path may be initialized empty and assigned only once inside model debug'
  );
  assert.match(guideUpdate, /hoodCollisionGuideSweepEl\.setAttribute\('d', sweepPath\)/);
  assert.match(
    guideUpdate,
    /railsPath = `M \$\{center0\} L \$\{far0\} M \$\{center1\} L \$\{far1\}`/,
    'Normal Hood guidance must keep only the two lower rails from the 14m centre station'
  );
  assert.match(
    guideUpdate,
    /if \(launchOptions\.modelDebug\) \{\s*railsPath = `M \$\{front0\} L \$\{far0\} M \$\{front1\} L \$\{far1\} `\s*\+\s*`M \$\{front2\} L \$\{far2\} M \$\{front3\} L \$\{far3\}`;\s*sweepPath = `M \$\{far0\} L \$\{far1\} L \$\{far2\} L \$\{far3\} Z`;/,
    'Front-station rails and the sweep calibration rectangle must stay model-debug-only'
  );
  assert.match(
    guideUpdate,
    /if \(launchOptions\.modelDebug\) \{\s*const frontCenterX[\s\S]*?axisPath = `M \$\{frontCenterX\.toFixed\(1\)\} \$\{frontCenterY\.toFixed\(1\)\} `\s*\+\s*`L \$\{farCenterX\.toFixed\(1\)\} \$\{farCenterY\.toFixed\(1\)\}`;\s*\}/,
    'The centre axis must stay empty in normal play and exist only for model calibration'
  );
  assert.match(guideUpdate, /let sweepPath = '';\s*let axisPath = '';/);
  assert.equal(
    (guideUpdate.match(/\bsweepPath\s*=/g) || []).length,
    2,
    'Sweep path may be initialized empty and assigned only once inside model debug'
  );
  assert.equal(
    (guideUpdate.match(/\baxisPath\s*=/g) || []).length,
    2,
    'Axis path may be initialized empty and assigned only once inside model debug'
  );
  assert.match(
    guideUpdate,
    /hoodCollisionGuideUnderlayEl\.setAttribute\(\s*'d',\s*launchOptions\.modelDebug \? `\$\{volumePath\} \$\{centerPath\}`\.trim\(\) : centerPath\s*\)/,
    'Normal underlay must duplicate only the centre path while debug may add the calibration volume'
  );
  const underlayWrite = guideUpdate.match(
    /hoodCollisionGuideUnderlayEl\.setAttribute\([\s\S]*?\);/
  )?.[0] || '';
  assert.doesNotMatch(
    underlayWrite,
    /\$\{(?:railsPath|sweepPath|axisPath)\}/,
    'The dark contrast stroke may not duplicate long rails, sweep, or centre axis'
  );
  assert.doesNotMatch(
    guideUpdate,
    /--hood-guide-label-(?:x|y)/,
    'Runtime may not pin a text plate to the projected collider centre'
  );
  for (const position of ['near-x', 'near-y', 'far-x', 'far-y']) {
    assert.match(
      guideUpdate,
      new RegExp(`--hood-guide-${position}`),
      `Hood guide must publish the projected ${position} diagnostic coordinate`
    );
  }
  assert.match(
    guideUpdate,
    /const guideState = railsVisible \? 'projected' : 'volume-only'/
  );
  assert.match(guideUpdate, /const threat = classifyHoodCollisionGuideThreat\(\)/);
  assert.match(
    guideUpdate,
    /hoodCollisionGuideEl\.dataset\.guideAlert = threat\.alertState/
  );
  assert.match(
    guideUpdate,
    /hoodCollisionGuideDiagnostics\.alertState = threat\.alertState/
  );
  assert.match(
    guideUpdate,
    /hoodCollisionGuideDiagnostics\.alertTtcSeconds = threat\.ttcSeconds/
  );
  const volumeOnlyAt = guideUpdate.indexOf(
    "const guideState = railsVisible ? 'projected' : 'volume-only'"
  );
  const revealAt = guideUpdate.indexOf(
    'if (hoodCollisionGuideEl.hidden) hoodCollisionGuideEl.hidden = false'
  );
  assert.ok(
    volumePathAt < volumeOnlyAt && volumeOnlyAt < revealAt,
    'Far clipping must preserve and reveal the near collider as volume-only guidance'
  );

  const guideHide = functionSource('hideHoodCollisionGuide');
  assert.match(guideHide, /hoodCollisionGuideEl\.hidden = true/);
  assert.match(
    guideHide,
    /hoodCollisionGuideDiagnostics\.verticalProbeCount = 0;\s*hoodCollisionGuideDiagnostics\.futureLipLaunch = false/,
    'Hidden guidance may not retain stale probe or future-launch diagnostics'
  );
  assert.doesNotMatch(guideHide, /aria-hidden/);
  const guidePresentation = functionSource('syncHoodCollisionGuidePresentation');
  for (const [field, fullExtentM] of [
    ['widthM', 1.44],
    ['heightM', 1.16],
    ['lengthM', 2.72]
  ]) {
    assert.match(
      guidePresentation,
      new RegExp(`hoodCollisionGuideContract\\.${field}`),
      `Hood guide must present its authoritative ${fullExtentM} m ${field}`
    );
  }
  assert.doesNotMatch(
    guideUpdate,
    /\b(?:player\.(?:geometry|scale|userData)|setFromObject\(player\)|Box3\b)/
  );
  assert.doesNotMatch(
    guideUpdate,
    /autoNextObstacleDistance|nearestMinimapObstacleDistance/,
    'Manual Hood guidance must not borrow autopilot or minimap-only threat state'
  );
  assert.doesNotMatch(
    guideUpdate,
    /state\.(?:speed|distance|lives|lateral|altitude|routeCursor|pathPlan)\s*=/
  );
  for (const key of [
    'hud.hoodCollisionGuide.width',
    'hud.hoodCollisionGuide.dimensions',
    'hud.hoodCollisionGuide.projection',
    'hud.hoodCollisionGuide.range'
  ]) {
    assert.match(
      guidePresentation,
      new RegExp(key.replaceAll('.', '\\.')),
      `Hood guide must localize ${key}`
    );
  }
  assert.match(
    guidePresentation,
    /hoodCollisionGuideContract\.previewCenterDistanceM/
  );
  assert.match(
    guidePresentation,
    /hoodCollisionGuideContract\.sweepDistanceM/
  );

  const animateLoop = sourceBetween('function animate()', "startBtn.addEventListener('click'");
  const cameraAt = animateLoop.indexOf('updateCamera(simulationFrameDt)');
  const guideAt = animateLoop.indexOf('updateHoodCollisionGuide()');
  const renderAt = animateLoop.indexOf('renderPresentationFrame()');
  assert.ok(cameraAt >= 0 && cameraAt < guideAt, 'Hood guide must consume the committed camera frame');
  assert.ok(guideAt < renderAt, 'Hood guide must update before the presentation frame renders');
  assert.equal((animateLoop.match(/updateHoodCollisionGuide\(\)/g) || []).length, 1);
});

test('runtime delegates exhaust presentation to the authoritative propulsion packet without rewriting speed', () => {
  const playerUpdate = sourceBetween('function updatePlayer(dt, now)', 'function isDynamicObstacle');
  assert.match(playerUpdate, /updatePropulsionFeedback\(/);
  assert.match(playerUpdate, /coreSpool: state\.propulsionCoreSpool/);
  assert.match(playerUpdate, /coreRpm: state\.propulsionCoreRpm/);
  assert.match(playerUpdate, /thrustNormalized: state\.propulsionThrustNormalized/);
  assert.match(playerUpdate, /steeringActuator: state\.steeringActuator/);
  assert.match(playerUpdate, /state\.shipExhaustEnergy = propulsion\.exhaustEnergyNormalized/);
  assert.match(playerUpdate, /Ship owns every forward-exhaust, energy-ring, side-shell, and hardline write/);
  assert.doesNotMatch(playerUpdate, /const (?:flamePulse|exhaustSpeed|sideBaseRadius)/);
  assert.doesNotMatch(playerUpdate, /(?:flame|innerFlame|sideFlame)\.(?:scale|material)/);
  assert.doesNotMatch(playerUpdate, /state\.(?:speed|distance)\s*=/);
});

test('jump control maps one pointer or assistive zero-detail click to one action', () => {
  const helperSource = sourceBetween('function shouldActivateJumpButton(', 'const activateJumpButton =');
  const createHelper = new Function(`'use strict';\n${helperSource}\nreturn shouldActivateJumpButton;`);
  const shouldActivateJumpButton = createHelper();
  assert.equal(shouldActivateJumpButton({ type: 'pointerdown', detail: 0 }), true);
  assert.equal(shouldActivateJumpButton({ type: 'click', detail: 0 }), true);
  assert.equal(shouldActivateJumpButton({ type: 'click', detail: 1 }), false);
  assert.equal(shouldActivateJumpButton({ type: 'keydown', detail: 0 }), false);
  const jumpListeners = sourceBetween("jumpButton?.addEventListener('pointerdown'", "window.addEventListener('resize'");
  assert.doesNotMatch(jumpListeners, /addEventListener\('keydown'/);
  assert.equal((jumpListeners.match(/activateJumpButton\(event\)/g) || []).length, 2);
  const jumpFunction = sourceBetween('function jump(', '/** Keep the pause action');
  assert.match(
    jumpFunction,
    /if \(!state\.running \|\| state\.gameOver \|\| state\.paused \|\| !state\.grounded\) return false;/
  );
  assert.match(jumpFunction, /sampleGameplaySurfaceAhead\(0, surfaceScratch\)/);
  assert.match(jumpFunction, /manualJumpVerticalVelocity\(state\.speed, surfaceGrade\)/);
  assert.match(jumpFunction, /return launchVertical\('space', verticalVelocity,/);
  const keydown = sourceBetween("window.addEventListener('keydown'", "window.addEventListener('keyup'");
  assert.match(
    keydown,
    /if \(e\.code === 'Space'\) \{[\s\S]*?if \(!state\.running \|\| state\.gameOver\) resetGame\(\);[\s\S]*?else jump\(\);/
  );
  const touchActivation = sourceBetween('const activateJumpButton =', "jumpButton?.addEventListener('pointerdown'");
  assert.match(
    touchActivation,
    /if \(!state\.running \|\| state\.gameOver\) resetGame\(\);[\s\S]*?else jump\(\);/
  );
});

test('manual SPACE launches once from flat roads, structural grades, and physical platform support', () => {
  const createJumpFixture = new Function(
    'surface',
    `'use strict';
const manualJumpImpulse = Math.sqrt(2 * 9.81 * 4.6);
const verticalGravity = 9.81;
const fatalRuntimeLocked = false;
const surfaceScratch = {};
const events = [];
const state = {
  running: true,
  gameOver: false,
  paused: false,
  grounded: true,
  speed: 150 / 3.6,
  driveTransmissionMode: 'automatic',
  driveGear: 2,
  routeCursor: { edgeId: 'test-edge', edgeS: 480 },
  activeRouteId: 'test-edge',
  distance: 11_578,
  verticalVelocity: 0,
  flightSource: 'ground',
  jumpPlatformFlightActive: true,
  jumpPlatformExpectedAirTime: 2,
  airTime: 0,
  jumpTimer: 0,
  takeoffCount: 0,
  lastTakeoff: null
};
const track = {
  getEdge(edgeId) {
    return edgeId === 'test-edge' ? { tileToken: 'test-tile' } : null;
  }
};
function sampleGameplaySurfaceAhead(distanceAhead, out) {
  if (distanceAhead !== 0) throw new Error('manual launch must sample current support only');
  Object.assign(out, surface);
  return out;
}
function recordTrackEvent(type, details) {
  events.push({ type, details });
}
${functionSource('surfaceTangentVerticalVelocity')}
${functionSource('manualJumpVerticalVelocity')}
${functionSource('launchVertical')}
${functionSource('jump')}
const firstAccepted = jump();
const firstSnapshot = {
  grounded: state.grounded,
  verticalVelocity: state.verticalVelocity,
  flightSource: state.flightSource,
  jumpPlatformFlightActive: state.jumpPlatformFlightActive,
  jumpPlatformExpectedAirTime: state.jumpPlatformExpectedAirTime,
  takeoffCount: state.takeoffCount,
  lastTakeoff: { ...state.lastTakeoff },
  speed: state.speed,
  driveTransmissionMode: state.driveTransmissionMode,
  driveGear: state.driveGear
};
const secondAccepted = jump();
return { firstAccepted, secondAccepted, firstSnapshot, state, events, manualJumpImpulse };`
  );

  const cases = [
    { name: 'flat road', surface: { grade: 0, jumpPlatformId: null } },
    { name: 'three-percent structural grade', surface: { grade: 0.03, jumpPlatformId: null } },
    { name: 'physical platform plane', surface: { grade: 0.28, jumpPlatformId: 'platform-test' } }
  ];
  for (const fixtureCase of cases) {
    const result = createJumpFixture(fixtureCase.surface);
    const grade = fixtureCase.surface.grade;
    const expectedVelocity = (
      result.firstSnapshot.speed * grade + result.manualJumpImpulse
    ) / Math.hypot(1, grade);
    assert.equal(result.firstAccepted, true, `${fixtureCase.name} must accept the first player launch`);
    assert.equal(result.secondAccepted, false, `${fixtureCase.name} must reject a duplicate airborne launch`);
    assert.equal(result.firstSnapshot.grounded, false);
    assert.equal(result.firstSnapshot.flightSource, 'space');
    assert.ok(
      Math.abs(result.firstSnapshot.verticalVelocity - expectedVelocity) <= 0.000_000_001,
      `${fixtureCase.name} must preserve tangent motion and add the projected active impulse`
    );
    assert.equal(result.firstSnapshot.jumpPlatformFlightActive, false);
    assert.equal(result.firstSnapshot.jumpPlatformExpectedAirTime, 0);
    assert.equal(result.firstSnapshot.takeoffCount, 1);
    assert.equal(result.state.takeoffCount, 1);
    assert.equal(result.firstSnapshot.speed, 150 / 3.6);
    assert.equal(result.firstSnapshot.driveTransmissionMode, 'automatic');
    assert.equal(result.firstSnapshot.driveGear, 2);
    assert.equal(result.firstSnapshot.lastTakeoff.grade, grade);
    assert.equal(
      result.firstSnapshot.lastTakeoff.jumpPlatformId,
      fixtureCase.surface.jumpPlatformId
    );
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.events[0], {
      type: 'takeoff',
      details: {
        source: 'space',
        routeId: 'test-edge',
        verticalVelocity: Number(expectedVelocity.toFixed(4)),
        jumpPlatformId: fixtureCase.surface.jumpPlatformId
      }
    });
  }
});

test('jump-platform release keeps tangent momentum and remains distinct from manual SPACE', () => {
  const tangentSource = sourceBetween(
    'function surfaceTangentVerticalVelocity(',
    'function launchVertical('
  );
  const createTangentResolver = new Function(
    `'use strict';\n${tangentSource}\nreturn surfaceTangentVerticalVelocity;`
  );
  const resolveTangentVelocity = createTangentResolver();
  const lipGrade = 2 * 3.6 / 28;
  const expectedVelocity = 300 * lipGrade / Math.hypot(1, lipGrade);
  const expectedLowSpeedVelocity = 10 * lipGrade / Math.hypot(1, lipGrade);
  assert.ok(
    Math.abs(resolveTangentVelocity(300, lipGrade) - expectedVelocity) <= 0.000_000_001,
    'Platform release must retain the normalized surface-tangent vertical component'
  );
  assert.ok(resolveTangentVelocity(300, lipGrade) > 24, 'Platform release must not add an artificial cap');
  assert.ok(
    Math.abs(resolveTangentVelocity(10, lipGrade) - expectedLowSpeedVelocity) <= 0.000_000_001,
    'Low-speed platform release must retain the exact surface-tangent component'
  );
  assert.ok(
    expectedLowSpeedVelocity < 7.8,
    'Platform release must not add an artificial minimum impulse'
  );
  assert.equal(resolveTangentVelocity(Number.NaN, lipGrade), 0);
  assert.equal(resolveTangentVelocity(300, Number.NaN), 0);

  const airTimeSource = sourceBetween(
    'function jumpPlatformAirTime(',
    'function launchVertical('
  );
  const createAirTimeResolver = new Function(
    'verticalGravity',
    `'use strict';\n${airTimeSource}\nreturn jumpPlatformAirTime;`
  );
  const resolveAirTime = createAirTimeResolver(60);
  const expectedAirTime = (30 + Math.sqrt(30 * 30 + 2 * 60 * 4.5)) / 60;
  assert.ok(
    Math.abs(resolveAirTime(30, 4.5) - expectedAirTime) <= 0.000_000_001,
    'Predicted airtime must include the physical lip height above the base road'
  );
  assert.ok(resolveAirTime(30, 4.5) > resolveAirTime(30, 0));

  const releaseSource = sourceBetween(
    'function releaseFromJumpPlatform(',
    'const airborneLandingFrameScratch'
  );
  assert.match(releaseSource, /state\.flightSource = 'jump-platform-release'/);
  assert.match(releaseSource, /state\.jumpPlatformFlightActive = true/);
  assert.match(releaseSource, /state\.jumpPlatformExpectedAirTime =/);
  assert.match(releaseSource, /state\.jumpTimer = Math\.max\(0\.12, state\.jumpPlatformExpectedAirTime\)/);
  assert.match(releaseSource, /recordTrackEvent\('jump-platform-release'/);
  assert.doesNotMatch(releaseSource, /launchVertical|playAudio|autoJumpIndicator/);

  const trackEventSource = sourceBetween('function recordTrackEvent(', 'function zoneNumber(');
  assert.match(trackEventSource, /type === 'takeoff' && details\.source === 'space'/);
  assert.doesNotMatch(trackEventSource, /['"]jump-platform-release['"]\s*:\s*['"]jump['"]/);

  const planner = sourceBetween('const autoPilotPlanner = {', 'function markAutoPilotCollision()');
  assert.match(source, /function isAutopilotFollowingPassiveLaunchSurface\(\)/);
  assert.match(
    source,
    /return Boolean\(surfaceScratch\.jumpPlatformId\)[\s\S]*?Math\.abs\(surfaceScratch\.grade \|\| 0\) > 0\.002_5/
  );
  assert.match(planner, /if \(isAutopilotFollowingPassiveLaunchSurface\(\)\)/);
  assert.match(planner, /state\.autoJumpReason = '斜台随行';[\s\S]*?return false;/);
  const playerUpdate = sourceBetween('function updatePlayer(dt, now)', 'function isDynamicObstacle');
  assert.match(
    playerUpdate,
    /if \(isAutopilotFollowingPassiveLaunchSurface\(\)\) \{[\s\S]*?state\.autoJumpIntent = false;[\s\S]*?state\.autoJumpReason = '斜台随行';/
  );
  const jumpSource = sourceBetween('function jump(', '/** Keep the pause action');
  assert.doesNotMatch(jumpSource, /isAutopilotFollowingPassiveLaunchSurface/);
  assert.match(jumpSource, /manualJumpVerticalVelocity\(state\.speed, surfaceGrade\)/);
  assert.match(jumpSource, /jumpPlatformId: surfaceScratch\.jumpPlatformId \?\? null/);
  assert.match(playerUpdate, /const freePlatformFlight = state\.jumpPlatformFlightActive && !state\.grounded/);
  assert.match(playerUpdate, /-jumpPlatformAirborneLateralHalf/);
  assert.match(playerUpdate, /:\s*-roadSafeHalf;/);
  assert.match(playerUpdate, /:\s*roadSafeHalf;/);
  assert.doesNotMatch(playerUpdate, /supportCenter|supportedOffRoute|groundSupportCenterLateral/);
  const keyTracker = sourceBetween('function updateKeyTracker(now)', 'const SURFACE_CONTACT_KEYS');
  assert.match(keyTracker, /keys\.jump \|\| now < state\.manualJumpIndicatorUntil/);
  assert.match(keyTracker, /state\.autoJumpIntent \|\| now < state\.autoJumpIndicatorUntil/);
  assert.match(keyTracker, /state\.jumpPlatformFlightActive \|\| now < state\.airTimeDisplayUntil/);
  assert.match(keyTracker, /displayedPlatformAirTime\.toFixed\(2\)/);
});

test('HUD theme writes only changed CSS values', () => {
  const hudFunctions = sourceBetween('function setCssColorVar(', 'function clamp(');
  const writes = [];
  const documentMock = {
    documentElement: {
      style: {
        setProperty(name, value) { writes.push([name, value]); }
      }
    }
  };
  const colors = [
    { value: 'a', getHexString() { return this.value; } },
    { value: 'b', getHexString() { return this.value; } },
    { value: 'c', getHexString() { return this.value; } },
    { value: 'd', getHexString() { return this.value; } },
    { value: 'e', getHexString() { return this.value; } }
  ];
  const entries = colors.map((color, index) => [`--theme-${index}`, color]);
  const createUpdateHudTheme = new Function(
    'document',
    'appliedHudThemeValues',
    'hudThemeEntries',
    `'use strict';\n${hudFunctions}\nreturn updateHudTheme;`
  );
  const updateHudTheme = createUpdateHudTheme(documentMock, new Map(), entries);
  assert.equal(updateHudTheme(), true);
  assert.equal(writes.length, 5);
  assert.equal(updateHudTheme(), false);
  assert.equal(writes.length, 5);
  colors[2].value = 'changed';
  assert.equal(updateHudTheme(), true);
  assert.deepEqual(writes.at(-1), ['--theme-2', '#changed']);
  assert.equal(writes.length, 6);
});

test('lateral position HUD moves one centred pointer and publishes a signed meter value', () => {
  const helperSource = sourceBetween(
    'function resolveLateralPositionPresentation(',
    'const lateralPositionPresentationScratch'
  );
  const resolveLateralPositionPresentation = new Function(
    'clamp',
    `'use strict';\n${helperSource}\nreturn resolveLateralPositionPresentation;`
  )((value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)));
  assert.deepEqual(
    resolveLateralPositionPresentation(0, 12, {}),
    { normalized: 0, positionPercent: 50, magnitudePercent: 0, direction: 'center' }
  );
  assert.deepEqual(
    resolveLateralPositionPresentation(-6, 12, {}),
    { normalized: -0.5, positionPercent: 27, magnitudePercent: 50, direction: 'left' }
  );
  assert.deepEqual(
    resolveLateralPositionPresentation(18, 12, {}),
    { normalized: 1, positionPercent: 96, magnitudePercent: 100, direction: 'right' }
  );
  assert.match(source, /steerMarkerEl\.style\.left = steerPosition/);
  assert.doesNotMatch(source, /steer(?:Fill|Marker)El\.style\.width/);
  assert.match(source, /steerInstrumentEl\.setAttribute\(\s*'aria-valuenow'/);
  assert.match(source, /steerInstrumentEl\.setAttribute\('aria-valuetext', lateralValueText\)/);
});

test('zoned Liquid Glass adapts after physical lighting without framebuffer reads or threshold chatter', () => {
  const contractLiteral = source.match(
    /const hudReadabilityContract = Object\.freeze\((\{[\s\S]*?\})\);/
  );
  assert.ok(contractLiteral, 'missing HUD readability contract');
  const hudReadabilityContract = new Function(
    `'use strict'; return (${contractLiteral[1]});`
  )();
  const helperSource = sourceBetween(
    'function createHudContrastStability(',
    'function highSpeedSurvivalLevel('
  );
  const createHelpers = new Function(
    'clamp',
    'hudReadabilityContract',
    `'use strict';\n${helperSource}\nreturn {
      hudSceneLuminance,
      hudAcesLuminance,
      resolveHudContrastMode,
      resolveHudGlassPresentation,
      createHudContrastStability,
      createHudZoneState,
      settleHudContrastCandidate
    };`
  );
  const {
    hudSceneLuminance,
    hudAcesLuminance,
    resolveHudContrastMode,
    resolveHudGlassPresentation,
    createHudContrastStability,
    createHudZoneState,
    settleHudContrastCandidate
  } = createHelpers(
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    hudReadabilityContract
  );
  const config = new Function(
    'window',
    `'use strict';\n${configSource}\nreturn window.NeonConfig;`
  )({});
  const linearChannel = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const linearColor = (hex) => ({
    r: linearChannel((hex >> 16) & 0xff),
    g: linearChannel((hex >> 8) & 0xff),
    b: linearChannel(hex & 0xff)
  });
  const realmLuminances = config.zones.map((zone) => hudSceneLuminance(linearColor(zone.sky)));
  assert.equal(realmLuminances.length, 6);
  assert.ok(realmLuminances.every((value) => value >= 0 && value <= 1));
  assert.ok(hudAcesLuminance(0.12, 1.2) < hudAcesLuminance(0.62, 1.2));
  assert.equal(
    resolveHudContrastMode(0.08, 0, hudReadabilityContract.onLightMode),
    hudReadabilityContract.onDarkMode,
    'storm-darkened sky must select the dark-scene HUD'
  );
  assert.equal(
    resolveHudContrastMode(0.78, 0, hudReadabilityContract.onDarkMode),
    hudReadabilityContract.onLightMode,
    'snow glare must select the light-scene HUD'
  );
  assert.equal(
    resolveHudContrastMode(0.78, 0.72, hudReadabilityContract.onLightMode),
    hudReadabilityContract.onDarkMode,
    'enclosure must override a bright portal or flash sample'
  );
  assert.equal(
    resolveHudContrastMode(0.37, 0, hudReadabilityContract.onLightMode),
    hudReadabilityContract.onLightMode
  );
  assert.equal(
    resolveHudContrastMode(0.37, 0, hudReadabilityContract.onDarkMode),
    hudReadabilityContract.onDarkMode
  );
  const dwellState = createHudContrastStability(hudReadabilityContract.onLightMode);
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onDarkMode,
      0
    ),
    false
  );
  assert.equal(dwellState.candidateSince, 0);
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onDarkMode,
      239
    ),
    false
  );
  assert.equal(dwellState.mode, hudReadabilityContract.onLightMode);
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onDarkMode,
      240
    ),
    true
  );
  assert.equal(dwellState.mode, hudReadabilityContract.onDarkMode);
  assert.equal(dwellState.lastSwitchAt, 240);
  assert.equal(dwellState.switchCount, 1);
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onLightMode,
      300
    ),
    false
  );
  assert.equal(dwellState.candidateSince, 300);
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onLightMode,
      540
    ),
    false,
    'candidate dwell cannot bypass the minimum interval'
  );
  assert.equal(dwellState.candidateSince, 300);
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onLightMode,
      839
    ),
    false
  );
  assert.equal(
    settleHudContrastCandidate(
      dwellState,
      hudReadabilityContract.onLightMode,
      840
    ),
    true
  );
  assert.equal(dwellState.mode, hudReadabilityContract.onLightMode);
  assert.equal(dwellState.switchCount, 2);

  const rootStability = createHudContrastStability(hudReadabilityContract.onLightMode);
  const leftStability = createHudZoneState(hudReadabilityContract.onLightMode);
  const rightStability = createHudZoneState(hudReadabilityContract.onLightMode);
  settleHudContrastCandidate(leftStability, hudReadabilityContract.onDarkMode, 0);
  settleHudContrastCandidate(rightStability, hudReadabilityContract.onDarkMode, 100);
  assert.equal(
    settleHudContrastCandidate(leftStability, hudReadabilityContract.onDarkMode, 240),
    true
  );
  assert.equal(
    settleHudContrastCandidate(rightStability, hudReadabilityContract.onDarkMode, 240),
    false
  );
  assert.equal(rightStability.candidateSince, 100);
  assert.equal(
    settleHudContrastCandidate(rightStability, hudReadabilityContract.onDarkMode, 340),
    true
  );
  assert.equal(leftStability.switchCount, 1);
  assert.equal(rightStability.switchCount, 1);
  assert.deepEqual(rootStability, {
    mode: hudReadabilityContract.onLightMode,
    candidateMode: null,
    candidateSince: Number.NEGATIVE_INFINITY,
    lastSwitchAt: Number.NEGATIVE_INFINITY,
    switchCount: 0
  });
  const zoneNamesLiteral = source.match(
    /const hudReadabilityZoneNames = Object\.freeze\((\[[\s\S]*?\])\);/
  );
  assert.ok(zoneNamesLiteral, 'missing fixed HUD readability zone set');
  const zoneNames = new Function(`'use strict'; return (${zoneNamesLiteral[1]});`)();
  const independentZoneStates = Object.fromEntries(
    zoneNames.map((zoneName) => [
      zoneName,
      createHudZoneState(hudReadabilityContract.onLightMode)
    ])
  );
  assert.deepEqual(zoneNames, ['left', 'right', 'position', 'compass', 'input']);
  assert.equal(new Set(Object.values(independentZoneStates)).size, 5);
  const darkPresentation = resolveHudGlassPresentation(0.10, 18, [1, 0.72, 0.45]);
  const brightPresentation = resolveHudGlassPresentation(0.90, 82, [1, 0.72, 0.45]);
  assert.ok(Number(darkPresentation.surfaceAlpha) < Number(brightPresentation.surfaceAlpha));
  assert.ok(Number(darkPresentation.edgeAlpha) > Number(brightPresentation.edgeAlpha));
  assert.equal(darkPresentation.reflectionX, '20%');
  assert.equal(brightPresentation.reflectionX, '80%');
  assert.match(brightPresentation.reflectionRgb, /^\d+, \d+, \d+$/);
  assert.equal(hudReadabilityContract.sampleIntervalMs, 100);
  assert.equal(hudReadabilityContract.brightAttackMs, 140);
  assert.equal(hudReadabilityContract.darkReleaseMs, 520);
  assert.equal(hudReadabilityContract.candidateHoldMs, 240);
  assert.equal(hudReadabilityContract.minimumSwitchIntervalMs, 600);
  assert.equal(hudReadabilityContract.minimumTextContrastRatio, 4.5);
  assert.equal(hudReadabilityContract.authority, 'analytical-zoned-scene-lighting');
  const zoneUpdate = sourceBetween('function updateZone(now)', 'const viewModeNames');
  assert.doesNotMatch(zoneUpdate, /updateHudReadability\(now/);
  assert.match(zoneUpdate, /hudSceneBackdropColor\.copy\(scene\.background\)[\s\S]*?scene\.background\.lerp\(zoneColorScratch\.weatherFlash/);
  assert.match(source, /updateDecoration\(now, lastPhysicalLightingState\);\s*updateHudReadability\(now, lastPhysicalLightingState\);\s*updateHud\(now\);/);
  assert.doesNotMatch(source, /readPixels|readRenderTargetPixels|getImageData/);
  const zoneStateUpdate = sourceBetween(
    'const zonePresentations = Object.create(null);',
    'const zoneElements = ['
  );
  assert.match(zoneStateUpdate, /const zoneState = hudReadabilityState\.zoneStates\[zoneName\]/);
  assert.match(
    zoneStateUpdate,
    /resolveHudContrastMode\([\s\S]*?filteredZoneLuminance,[\s\S]*?enclosure,[\s\S]*?zoneState\.mode/
  );
  assert.match(
    zoneStateUpdate,
    /settleHudContrastCandidate\(zoneState, proposedMode, timestamp\)/
  );
  assert.match(zoneStateUpdate, /zonePresentations\[zoneName\] = \{ mode: zoneState\.mode, presentation \}/);
  assert.doesNotMatch(zoneStateUpdate, /hudReadabilityState\.mode/);
  assert.doesNotMatch(zoneStateUpdate, /zoneStates\[zoneName\]\s*=/);
  assert.match(source, /root\.dataset\.hudContrast = hudReadabilityState\.mode/);
  assert.match(source, /--hud-glass-surface-alpha/);
  assert.match(source, /--hud-glass-reflection-x/);
  assert.match(source, /hudContrastMode: hudReadabilityState\.mode/);
  assert.match(source, /hudSceneLuminance: Number\(hudReadabilityState\.sceneLuminance\.toFixed\(4\)\)/);
  assert.match(source, /hudContrastSwitchCount: hudReadabilityState\.switchCount/);
  assert.match(source, /hudGlassZoneCount: hudReadabilityZoneNames\.length/);
  for (const diagnosticField of [
    'candidateMode',
    'switchCount',
    'sampleSerial',
    'surfaceAlpha',
    'strongAlpha',
    'controlAlpha',
    'cellAlpha',
    'edgeAlpha',
    'highlightAlpha',
    'shadowAlpha',
    'reflectionRgb',
    'reflectionX',
    'signature'
  ]) {
    assert.match(
      source,
      new RegExp(`${diagnosticField}: zoneState\\.${diagnosticField}`),
      `missing zoned HUD diagnostic ${diagnosticField}`
    );
  }
  assert.match(
    source,
    /candidateSince: hudDiagnosticTimestamp\(zoneState\.candidateSince\)/
  );
  assert.match(
    source,
    /lastSwitchAt: hudDiagnosticTimestamp\(zoneState\.lastSwitchAt\)/
  );
});

test('zone hot path reuses color scratch objects', () => {
  const updateZone = sourceBetween('function updateZone(now)', 'const viewModeNames');
  assert.match(source, /const zoneColorScratch = Object\.freeze/);
  assert.doesNotMatch(updateZone, /new THREE\.Color/);
});

test('sky and ground consume one route-realm state for every scene transition', () => {
  const updateZone = sourceBetween('function updateZone(now)', 'const viewModeNames');
  const config = new Function(
    'window',
    `'use strict';\n${configSource}\nreturn window.NeonConfig;`
  )({});
  assert.equal(config.world.zoneLength, 2_700);
  assert.equal(config.world.blendSpan, 72);
  assert.equal(config.world.ordinaryRoadReferenceSpeedMps, 45);
  assert.equal(config.world.realmResidenceSecondsAtOrdinaryRoadReference, 60);
  assert.deepEqual(config.sceneVisibilityContract, {
    version: 1,
    cameraFarM: 1_600,
    minimumAuthoredRealmFogFarM: 720,
    maximumAuthoredRealmFogFarM: 1_200,
    terrainFogSafetyMarginRatio: 1.08,
    presentationOnly: true,
    affectsGameplay: false
  });
  assert.deepEqual(
    Array.from(config.zones, (zone) => zone.fogFar),
    [1_080, 1_200, 840, 1_080, 1_000, 720]
  );
  assert.match(source, /sceneVisibilityContractVersion: sceneVisibilityContract\.version/);
  assert.match(source, /sceneVisibilityCameraFarM: sceneVisibilityContract\.cameraFarM/);
  assert.match(
    source,
    /sceneVisibilityMinimumFogFarM: sceneVisibilityContract\.minimumAuthoredRealmFogFarM/
  );
  assert.match(
    source,
    /sceneVisibilityMaximumFogFarM: sceneVisibilityContract\.maximumAuthoredRealmFogFarM/
  );
  assert.equal(
    config.world.zoneLength / config.world.ordinaryRoadReferenceSpeedMps,
    config.world.realmResidenceSecondsAtOrdinaryRoadReference
  );
  assert.match(
    source,
    /const jumpGearEquilibriumSpeedMps = driveGearBootstrapContract[\s\S]*?equilibriumSpeedMps/
  );
  assert.match(
    source,
    /realmResidenceSecondsAtJumpGearEquilibrium:\s*worldContract\.zoneLength\s*\/\s*jumpGearEquilibriumSpeedMps/
  );
  assert.match(
    source,
    /transitionSecondsAtJumpGearEquilibrium:\s*worldContract\.blendSpan\s*\/\s*jumpGearEquilibriumSpeedMps/
  );
  assert.match(configSource, /scenePairingMode:\s*'shared-route-realm'/);
  assert.doesNotMatch(configSource, /skyPhaseSeconds|skyBlendSeconds/);
  assert.deepEqual(Array.from(config.zones, (zone) => [zone.id, zone.terrain.id, zone.terrain.pattern]), [
    ['dawn-isle', 'sunlit-ocean', 'ocean'],
    ['prairie-garden', 'flowering-grassland', 'grassland'],
    ['rainforest-glow', 'rainforest-wetland', 'wetland'],
    ['twilight-valley', 'twilight-tundra', 'tundra'],
    ['star-vault', 'astral-shallows', 'astral'],
    ['eden-eye', 'volcanic-badlands', 'volcanic']
  ]);
  assert.doesNotMatch(source, /skyStateAtElapsedSeconds|skyPhaseOffsetSeconds/);
  assert.equal((updateZone.match(/zoneStateAtS\(state\.distance\)/g) || []).length, 1);
  assert.match(updateZone, /const idx = sceneZoneState\.index/);
  assert.match(updateZone, /const nextIdx = sceneZoneState\.nextIndex/);
  assert.match(updateZone, /const rawBlend = sceneZoneState\.blend/);
  assert.match(updateZone, /const t = rawBlend \* rawBlend \* \(3 - 2 \* rawBlend\)/);
  assert.match(updateZone, /terrainTransitionBlend = t/);
  assert.match(updateZone, /state\.skyZoneIndex = idx/);
  assert.match(updateZone, /state\.skyBlend = t/);
  assert.match(source, /skyGroundZoneMatched: state\.skyZoneIndex === terrainCurrentZoneIndex/);
  assert.match(source, /sceneRealmLengthM: diagnostics\.scenePairing\.realmLengthM/);
  assert.match(worldSource, /const configuredWorld = window\.NeonConfig\?\.world/);
  assert.match(worldSource, /const SCENERY_MOTIF_LENGTH = 280/);
  assert.match(worldSource, /themedS >= stableRealmEnd/);
  assert.match(worldSource, /palette comes from the shared route realm selected by main/);
});

test('bridge supports sample the same absolute procedural terrain surface as rendered chunks', () => {
  const terrainUpdate = sourceBetween(
    'function updateTerrainGeometryChunks(currentZoneIndex, nextZoneIndex)',
    '\n  const roadMat ='
  );
  const terrainSampler = sourceBetween(
    'function sampleTerrainWorldHeight(worldX, worldZ)',
    '\n\n  /**\n   * Assign exactly one opaque template'
  );
  assert.match(terrainUpdate, /resolveTerrainWorldProjection\(terrainRenderProjectionScratch\)/);
  assert.match(terrainUpdate, /terrainLayerIndexForWorldCell\(/);
  assert.match(terrainSampler, /Math\.floor\(\(worldX \+ terrainChunkHalfSize\) \/ terrainChunkSize\)/);
  assert.match(terrainSampler, /terrainLocalPointForWorldCell\(/);
  assert.match(terrainSampler, /sampleTerrainChunkTriangulatedHeight\(/);
  assert.match(terrainSampler, /const reliefScale = 0\.88 \+ \(\(hash >>> 18\) & 0xff\) \/ 0xff \* 0\.24/);
  assert.match(terrainSampler, /terrainSurfaceElevation \+ localHeight \* reliefScale/);
  assert.doesNotMatch(
    terrainSampler,
    /terrainMapCells/,
    'off-screen bridge supports must not depend on the bounded visible terrain grid'
  );
  assert.match(source, /sampleTerrainHeight: sampleTerrainWorldHeight/);
  assert.match(
    cloverleafTilePoolSource,
    /\/\/ Preserve absolute-world coordinates[\s\S]*?sampleTerrainHeight,/
  );
  assert.match(cloverleafTilePoolSource, /sampleTerrainHeight must be a function/);
});

test('one weather snapshot drives visual atmosphere and bounded runtime-owned surface response', () => {
  const updateZone = sourceBetween('function updateZone(now)', 'const viewModeNames');
  const animateLoop = sourceBetween('function animate()', "startBtn.addEventListener('click'");
  const gameplayAndAnimate = sourceBetween(
    'function advanceGameplayStep(dt, now)',
    "startBtn.addEventListener('click'"
  );
  assert.match(source, /requireDependency\(window\.NeonWeather, 'Neon weather module'\)/);
  assert.match(source, /state\.weather = weatherController\.createSnapshot\(\)/);
  assert.equal((updateZone.match(/const sceneZoneState = zoneStateAtS\(state\.distance\)/g) || []).length, 1);
  assert.match(updateZone, /weatherController\.sample\(\{[\s\S]*?zoneState: sceneZoneState/);
  assert.match(updateZone, /routeDistance: state\.distance/);
  assert.match(updateZone, /skyElapsedSeconds: state\.skyElapsedSeconds/);
  assert.match(updateZone, /material\.color\.copy\(zoneColorScratch\.weatherSurface\)/);
  assert.match(source, /weatherController\.forecast\(\{[\s\S]*?weatherForecastSnapshot/);
  assert.doesNotMatch(source, /nextChangeDistanceM|expectedDurationM/);
  assert.match(source, /weatherForecastPanel\.dataset\.skyGroundPaired/);
  assert.match(gameplayAndAnimate, /state\.skyElapsedSeconds \+= dt/);
  assert.doesNotMatch(animateLoop, /weatherElapsedSeconds/);
  assert.match(weatherSource, /clock: 'pausable-sky-elapsed-seconds'/);
  assert.match(weatherSource, /speedIndependent: true/);
  assert.match(weatherSource, /minimumTransitionSeconds: 12/);
  assert.match(weatherSource, /advanceSchedule\(elapsedSeconds, zoneIndex\)/);
  assert.doesNotMatch(weatherSource, /nextChangeDistanceM|segmentRemainingDistanceM|\/ speedMps/);

  assert.match(worldSource, /const weatherState = state\.weather/);
  assert.match(worldSource, /weatherMotionClock: 'pausable-sky-elapsed-seconds'/);
  assert.match(worldSource, /weatherAnchorMode: 'absolute-world-periodic-volume'/);
  assert.match(worldSource, /weatherWorldAnchored: true/);
  assert.match(worldSource, /weatherPoolCount: 4/);
  assert.match(worldSource, /weatherSnowLayerCount: 2/);
  assert.match(worldSource, /weatherSnowTextureBranchCount: 6/);
  assert.match(worldSource, /Neon\.Weather\.Rain/);
  for (const pool of ['Snow', 'Hail', 'Dust']) {
    assert.match(worldSource, new RegExp(`createWeatherPointPool\\(\\s*'${pool}'`));
  }
  assert.match(worldSource, /coverageThreshold: \(coverageRank \+ 0\.5\) \/ cloudClustersPerLayer/);
  assert.match(
    worldSource,
    /cloudCoveragePresence\(\s*cloudLayerCovers\[layerIndex\],\s*cluster\.coverageThreshold\s*\)/
  );
  assert.match(worldSource, /const cloudGridColumns = mobile \? 4 : 8/);
  assert.match(worldSource, /const cloudGridRows = 6/);
  assert.match(worldSource, /const cloudClusterCount = cloudGridColumns \* cloudGridRows/);
  assert.match(worldSource, /const precipitationCloudMass = Math\.max\(weatherRain, weatherSnow, weatherHail\)/);
  assert.match(worldSource, /lerp\(1, 2\.50, precipitationCloudBlend\)/);
  assert.match(worldSource, /weatherSnow \* 6/);
  assert.match(worldSource, /layerHorizontalScale \* cloudPresenceScale/);
  assert.match(worldSource, /layerVerticalScale \* cloudPresenceScale/);
  assert.match(worldSource, /cloudPrecipitationMass = precipitationCloudMass/);
  assert.match(worldSource, /cloudVisibleEquivalentClusterCount = visibleEquivalentClusterCount/);
  for (const marker of [
    'weatherCloudLayerCount: worldClearanceReport.cloudLayerCount',
    'weatherCloudLayerIds: worldClearanceReport.cloudLayerIds',
    'weatherCloudLayerVisibleEquivalentClusters:',
    'weatherCloudLayerOpacities: worldClearanceReport.cloudLayerOpacities',
    'weatherCloudSharedGeometryCount: worldClearanceReport.cloudSharedGeometryCount',
    'weatherCloudLightingAuthority: worldClearanceReport.cloudLightingAuthority'
  ]) {
    assert.ok(source.includes(marker), `missing layered-cloud runtime diagnostic ${marker}`);
  }
  assert.match(worldSource, /- weatherAnchor\.worldX/);
  assert.match(worldSource, /- weatherAnchor\.worldY/);
  assert.match(worldSource, /- weatherAnchor\.worldZ/);
  assert.match(worldSource, /updateWeatherVolume\(reducedMotion, graphOrigin, currentSurfaceFrame \|\| weatherSurfaceFrameScratch\)/);
  assert.match(worldSource, /weatherSnowRelativeMotionM \+= referenceStep/);
  assert.match(worldSource, /resolveLocalRainShelter\(surfacePoint, rainShelterScratch\)/);
  assert.match(worldSource, /rainMaterial\.opacity = intensity \* 0\.82/);
  assert.doesNotMatch(
    worldSource.slice(
      worldSource.indexOf('function updateWeatherVolume('),
      worldSource.indexOf('function resolveZoneIndex(')
    ),
    /cameraUndergroundBlend/
  );
  assert.match(worldSource, /weatherVisualOnly: true/);
  assert.match(
    source,
    /const surfaceWeatherModule = requireDependency\([\s\S]*?window\.NeonSurfaceWeather[\s\S]*?'Neon surface weather module'\s*\)/
  );
  assert.match(source, /sampleSignedFrame: sampleSurfaceWeatherFrame/);
  assert.match(source, /getLightingState: \(\) => lastPhysicalLightingState/);
  assert.match(
    source,
    /updateCamera\(simulationFrameDt\);[\s\S]{0,420}?updateTerrainGeometryChunks\(terrainCurrentZoneIndex, terrainNextZoneIndex\);\s*updateTrackNetworkVisuals\(now\);[\s\S]{0,240}?updateTerrainTunnelCutouts\(\);\s*updatePhysicalLighting\(state\.running && !state\.paused && !state\.gameOver \? simulationFrameDt : 0\);[\s\S]{0,1200}?updateSurfaceWeather\(surfaceContactFrameScratch\);\s*updateDecoration\(now, lastPhysicalLightingState\);/
  );
  assert.match(source, /surfaceTint: zoneColorScratch\.weatherRoadSurface\.getHex\(\)/);
  assert.match(source, /snowCover: state\.weatherSurfaceSnowCover/);
  assert.match(cloverleafSource, /function setPalette\(\{ edge, accent, surfaceTint, wetness, snowCover \} = \{\}\)/);
  assert.match(cloverleafSource, /roadMaterial\.metalness = 0/);
  assert.match(cloverleafSource, /roadMaterial\.clearcoat = clamp\(/);
  assert.match(cloverleafSource, /roadMaterial\.clearcoatRoughness = clamp\(/);
  assert.doesNotMatch(cloverleafSource, /roadMaterial\.metalness\s*=\s*[^;]*normalizedWetness/);
  assert.match(surfaceWeatherSource, /clock: 'pausable-weather-motion-time'/);
  assert.match(surfaceWeatherSource, /layout: 'distance-bucketed-world-route'/);
  assert.match(surfaceWeatherSource, /exposure: 'open-sky-route-only'/);
  assert.match(surfaceWeatherSource, /authority: 'runtime-applies-bounded-surface-load'/);
  assert.match(surfaceWeatherSource, /gameplayWriteAuthority: 'runtime-only'/);
  assert.match(surfaceWeatherSource, /contactModel: 'swept-open-sky-pressure-footprint'/);
  assert.match(surfaceWeatherSource, /function allowsStandingWater\(frame = \{\}\)/);
  assert.match(surfaceWeatherSource, /entry\.standingWaterAllowed = allowsStandingWater\(waterFrame\)/);
  assert.match(surfaceWeatherSource, /if \(!entry\.standingWaterAllowed\) continue/);
  assert.doesNotMatch(
    surfaceWeatherSource,
    /diagnostics\.playerStandingWaterAllowed \? surfaceResponse\.water : 0/
  );
  assert.match(surfaceWeatherSource, /new THREE\.InstancedMesh\(puddleGeometry/);
  assert.match(surfaceWeatherSource, /'SnowPowder'/);
  assert.match(surfaceWeatherSource, /sampleGameplayContact\(contactFrame, contactResponse\)/);
  assert.match(source, /surfaceContactFrameScratch\.previousDistance = surfacePreviousDistance/);
  assert.match(source, /surfaceContactFrameScratch\.previousLateral = surfacePreviousLateral/);
  assert.match(source, /surfaceContactFrameScratch\.clearanceM = Math\.max/);
  assert.match(
    source,
    /const longitudinalStep = gameplayCore\.resolveLongitudinalDynamicsStep\(\{[\s\S]*?surfaceDecelerationMps2: surfaceDeceleration,[\s\S]*?surfaceGrade: state\.currentSurfaceGrade/
  );
  assert.match(
    source,
    /state\.passiveResistanceMps2 = longitudinalStep\.passiveResistanceMps2[\s\S]*?state\.gradeAccelerationMps2 = longitudinalStep\.gradeAccelerationMps2[\s\S]*?const integratedSpeed = longitudinalStep\.nextSpeedMps/
  );
  assert.doesNotMatch(surfaceWeatherSource, /Math\.random/);
  assert.doesNotMatch(surfaceWeatherSource, /state\.(?:speed|lives|distance|routeCursor)\s*=/);
  assert.doesNotMatch(weatherSource, /state\.(?:speed|lives|autoPilot|routeCursor|distance)\s*=/);
  assert.doesNotMatch(weatherSource, /Math\.random/);
});

test('snow powder, twin grooves, and ridges share one bounded swept-patch contact', () => {
  assert.match(surfaceWeatherSource, /const SNOW_POWDER_CONTACT_CONTRACT = Object\.freeze\(/);
  assert.match(surfaceWeatherSource, /const SHOULDER_SNOW_INTERACTION_CONTRACT = Object\.freeze\(/);
  assert.match(surfaceWeatherSource, /trigger: 'swept-pressure-footprint-open-sky-snow-patch'/);
  assert.match(surfaceWeatherSource, /layoutMode: 'paired-sampled-road-edge-banks'/);
  assert.match(surfaceWeatherSource, /function sampleEntryInterval\(sweep, entry, kind/);
  assert.match(surfaceWeatherSource, /entry\.snowLateral = snowLateral/);
  assert.match(surfaceWeatherSource, /entry\.snowHalfWidth = \(1\.4/);
  assert.match(
    surfaceWeatherSource,
    /entry\.snowAccumulationAllowed = allowsSnowAccumulation\(snowFrame\)/
  );
  assert.match(surfaceWeatherSource, /const interval = sampleEntryInterval\(sweep, entry, 'snow'\)/);
  assert.match(surfaceWeatherSource, /sampleEntryInterval\(sweep, entry, 'snow-bank'\)/);
  assert.match(surfaceWeatherSource, /resolveShoulderSnowInteraction\(/);
  assert.match(surfaceWeatherSource, /surfaceFootprint\.tailDownwashLocal\?\.left/);
  assert.match(surfaceWeatherSource, /surfaceFootprint\.tailDownwashLocal\?\.right/);
  assert.match(surfaceWeatherSource, /snowRidges/);
  assert.match(surfaceWeatherSource, /disturbSurfaceCell\(entry\.snowCell/);
  assert.match(surfaceWeatherSource, /particleLifeSeconds: Object\.freeze\(\{ minimum: 0\.28, maximum: 0\.72 \}\)/);
  assert.match(surfaceWeatherSource, /pool\.ages\[index\] \+= ageStep/);
  assert.match(surfaceWeatherSource, /maximumBurstsPerUpdate: 4/);
  for (const diagnostic of [
    'weatherSnowPowderContactRequired',
    'weatherSnowPowderContactThisUpdate',
    'weatherSnowPowderMaximumLifeSeconds',
    'weatherSnowPowderLastEmissionMotionTime',
    'weatherLiveSnowParticleCount',
    'weatherSnowPatchCrossingCount',
    'weatherSnowPowderBurstLimitCount',
    'weatherSnowBankContactThisUpdate',
    'weatherSnowBankInteractionCount',
    'weatherDisturbedSnowBankCellCount',
    'weatherSnowBankPowderBurstCount',
    'weatherSweptSnowBankHitCount'
  ]) {
    assert.ok(source.includes(diagnostic), `missing snow-powder runtime diagnostic ${diagnostic}`);
  }
});

test('sealed tunnels block settled snow and restore realm-baseline visibility from a fresh route frame', () => {
  const updateZone = sourceBetween('function updateZone(now)', 'const physicalLightingAnchor');
  assert.match(weatherSource, /TUNNEL_WEATHER_SHELTER_CONTRACT/);
  assert.match(weatherSource, /OPEN_AIR_VISIBILITY_CONTRACT/);
  assert.match(weatherSource, /function resolveOpenAirVisibility\(weather = \{\}, out = null\)/);
  assert.match(weatherSource, /function isSealedTunnelFrame\(routeFrame = \{\}\)/);
  assert.match(
    weatherSource,
    /function resolveTunnelAtmosphere\(weather = \{\}, routeFrame = \{\}, out = null\)/
  );
  assert.match(
    updateZone,
    /sampleSurfaceWeatherFrame\(\s*0,\s*state\.lateral,\s*weatherShelterFrameScratch/
  );
  assert.doesNotMatch(updateZone, /resolveTunnelAtmosphere\([\s\S]*?playerFrameScratch/);
  assert.match(updateZone, /weather\.resolveTunnelAtmosphere\(/);
  assert.match(updateZone, /scene\.fog\.near = realmFogNearM/);
  assert.match(updateZone, /scene\.fog\.far = realmFogFarM/);
  assert.match(updateZone, /scene\.fog\.near \*= lerp\(1, 0\.56, tunnelAtmosphere\.fog\)/);
  assert.match(updateZone, /const weatherFogNearCapM = tunnelAtmosphere\.fogNearCapActive/);
  assert.match(updateZone, /scene\.fog\.near = Math\.min\(scene\.fog\.near, weatherFogNearCapM\)/);
  assert.match(
    updateZone,
    /weather\.OPEN_AIR_VISIBILITY_CONTRACT\.minimumVisibilityScale,[\s\S]*?tunnelAtmosphere\.visibility/
  );
  assert.doesNotMatch(updateZone, /Math\.max\(0\.18, tunnelAtmosphere\.visibility\)/);
  assert.match(updateZone, /state\.weatherSurfaceSnowCover = tunnelAtmosphere\.snowCover/);
  assert.match(updateZone, /roadMat\.color\.copy\(zoneColorScratch\.weatherRoadSurface\)/);
  assert.match(worldSource, /const rainShelter = resolveLocalRainShelter\(surfacePoint, rainShelterScratch\)/);
  assert.match(worldSource, /const exposure = rainShelter\.localExposure/);
  assert.match(surfaceWeatherSource, /function allowsSnowAccumulation\(frame = \{\}\)/);
  assert.match(
    surfaceWeatherSource,
    /entry\.snowAccumulationAllowed = allowsSnowAccumulation\(snowFrame\)/
  );
  assert.match(
    surfaceWeatherSource,
    /bankEntry\.snowAccumulationAllowed = allowsSnowAccumulation\(bankFrame\)/
  );
  assert.match(surfaceWeatherSource, /if \(!allowsSnowAccumulation\(frame\)\)/);
  for (const diagnostic of [
    'weatherTunnelVisibilityNormalized',
    'weatherVisibilityContractVersion',
    'weatherAerosolExtinction',
    'weatherOutdoorVisibility',
    'weatherFogNearCapM',
    'weatherEffectiveFogNearM',
    'weatherEffectiveFogFarM',
    'weatherViewVolumeContractVersion',
    'weatherCoverageViolationCount',
    'weatherHailUsesDepthBands',
    'weatherDustUsesDepthBands',
    'weatherAdditionalDrawGroups',
    'weatherPlayerSnowAccumulationAllowed',
    'weatherCoveredSnowPatchVisibleCount',
    'weatherCoveredSnowBankVisibleCount',
    'weatherCoveredSnowInteractionViolations',
    'weatherSnowPowderVisible'
  ]) {
    assert.ok(source.includes(diagnostic), `missing tunnel-weather runtime diagnostic ${diagnostic}`);
  }
});

test('moving road route indicator remains absent while world-fixed guidance stays authored', () => {
  assert.doesNotMatch(source, /function updateRouteIndicator\(/);
  assert.doesNotMatch(source, /\brouteLine\b|\brouteGlowLine\b|\brouteDots\b|\brouteMarker\b/);
  assert.doesNotMatch(source, /routeTargetColorScratch|routeGlowColorScratch|routeIndicatorPositionScratch/);
  assert.match(cloverleafSource, /const ROAD_SPEED_REFERENCE_CONTRACT = Object\.freeze\(/);
  assert.match(cloverleafSource, /const ROAD_ARROW_DIRECTION_CONTRACT = Object\.freeze\(/);
});

test('3D road arrows map the authored tip to the positive route tangent and publish violations', () => {
  assert.match(cloverleafSource, /const ROAD_ARROW_DIRECTION_CONTRACT = Object\.freeze\(/);
  assert.match(cloverleafSource,
    /geometryPitchRadians: Math\.PI \* 0\.5[\s\S]*?localForwardAxis: Object\.freeze\(\{ x: 0, y: 0, z: -1 \}\)/);
  assert.match(cloverleafSource,
    /arrowGeometry\.rotateX\(ROAD_ARROW_DIRECTION_CONTRACT\.geometryPitchRadians\)/);
  assert.doesNotMatch(cloverleafSource, /arrowGeometry\.rotateX\(-Math\.PI \* 0\.5\)/);
  assert.match(cloverleafSource,
    /const forwardDot = clamp\(arrowForward\.dot\(arrowTangent\), -1, 1\)/);
  assert.match(cloverleafSource,
    /forwardDot < ROAD_ARROW_DIRECTION_CONTRACT\.minimumForwardDot/);
  assert.match(source, /cloverleafVisualRoadArrowMinimumForwardDot:/);
  assert.match(source, /cloverleafVisualRoadArrowDirectionViolations:/);
});

test('one gameplay snapshot feeds emergency, plan, and guardian stages', () => {
  const planner = sourceBetween('const autoPilotPlanner = {', 'function markAutoPilotCollision()');
  const updatePlayer = sourceBetween('function updatePlayer(dt, now)', 'function updateEntities(dt, now)');
  assert.equal((planner.match(/this\.buildContext\(/g) || []).length, 1);
  assert.equal((planner.match(/this\.perceive\(/g) || []).length, 1);
  assert.equal((updatePlayer.match(/beginGameplayFrame\(dt\)/g) || []).length, 1);
  assert.match(updatePlayer, /autoPilotEmergencyGuard\(autoPlannerFrame\)/);
  assert.match(updatePlayer, /resolveAutoSteer\(autoPlannerFrame\)/);
  assert.doesNotMatch(sourceBetween('plan(frame)', 'emergencyGuard(frame)'), /buildContext\(|perceive\(/);
  assert.doesNotMatch(sourceBetween('emergencyGuard(frame)', 'guardianSteer(baseSteer, frame)'), /buildContext\(|perceive\(/);
  assert.doesNotMatch(sourceBetween('guardianSteer(baseSteer, frame)', '\n  };'), /buildContext\(|perceive\(/);
});

test('curve control covers production movement kinds and mirrors outward acceleration numerically', () => {
  const createCurveHelpers = new Function(
    'clamp',
    'autoCurveLateralAcceleration',
    `'use strict';\n${functionSource('movementRequiresCurveControl')}\n`
      + `${functionSource('curveOutwardAccelerationFor')}\n`
      + 'return { movementRequiresCurveControl, curveOutwardAccelerationFor };'
  );
  const helpers = createCurveHelpers(
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    52
  );

  for (const kind of [
    'left',
    'right',
    'direct-right',
    'collector',
    'loop-left',
    'direct-ramp',
    'straight-fork-left',
    'straight-fork-right',
    'opposing-return-flyover',
    'transfer-turn',
    'directional-connector'
  ]) {
    assert.equal(helpers.movementRequiresCurveControl(kind), true, `${kind} must retain curve control`);
  }
  for (const kind of ['through', 'straight', 'mainline', 'trunk', null, '']) {
    assert.equal(helpers.movementRequiresCurveControl(kind), false, `${kind} must remain a straight-through opt-out`);
  }

  assert.equal(helpers.curveOutwardAccelerationFor(100, 0.01), -48);
  assert.equal(helpers.curveOutwardAccelerationFor(100, -0.01), 48);
  assert.equal(helpers.curveOutwardAccelerationFor(10, 0.01), 0);
  assert.equal(helpers.curveOutwardAccelerationFor(100, 0), 0);
});

test('half-plane portal targets and reach distances remain finite and symmetric', () => {
  const state = {
    lateral: 0.2,
    lateralVelocity: 0,
    speed: 300,
    steeringActuator: 0
  };
  const createGateHelpers = new Function(
    'track',
    'activeRoadSafeHalf',
    'clamp',
    'state',
    'getPlayerKinematics',
    'steeringActuatorContract',
    `'use strict';\n${functionSource('graphGateTarget')}\n`
      + `${functionSource('graphGateReachDistance')}\n`
      + 'return { graphGateTarget, graphGateReachDistance };'
  );
  const helpers = createGateHelpers(
    {},
    () => 7.62,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    state,
    () => ({ maxLatAccel: 20 }),
    { reverseRatePerSecond: 8.6, engageRatePerSecond: 5.4 }
  );
  const rightGate = { min: 0, max: Number.POSITIVE_INFINITY };
  const leftGate = { min: Number.NEGATIVE_INFINITY, max: 0 };

  assert.equal(helpers.graphGateTarget(rightGate), 0.8);
  const rightReach = helpers.graphGateReachDistance(rightGate);
  state.lateral = -0.2;
  assert.equal(helpers.graphGateTarget(leftGate), -0.8);
  const leftReach = helpers.graphGateReachDistance(leftGate);
  assert.ok(Number.isFinite(rightReach));
  assert.ok(Number.isFinite(leftReach));
  assert.ok(Math.abs(rightReach - leftReach) < 0.000_000_001);

  state.lateral = 2;
  assert.ok(
    Math.abs(
      helpers.graphGateTarget({ min: 1.6, max: Number.POSITIVE_INFINITY }) - 2.4
    ) < 0.000_000_001
  );
  assert.ok(Number.isFinite(
    helpers.graphGateReachDistance({ min: 1.6, max: Number.POSITIVE_INFINITY })
  ));

  const decision = {
    id: 'decision',
    distance: 0,
    transitions: [{ id: 'right', entryGate: rightGate }]
  };
  Object.assign(state, {
    lateral: 2,
    lateralVelocity: 2,
    lockedTransitionId: 'right',
    activeDecisionNodeId: 'decision',
    routeDecisionQueue: [decision]
  });
  const createGateEnforcer = new Function(
    'state',
    'track',
    'hasRouteGraphContract',
    'graphDecisionId',
    'graphDecisionTransitions',
    'graphTransitionId',
    'graphTransitionGate',
    'graphDecisionDistance',
    'graphGateReachDistance',
    'graphGateTarget',
    'getPlayerKinematics',
    'steeringActuatorContract',
    `'use strict';\n${functionSource('enforceAutoForkPhysicalInput')}\n`
      + 'return enforceAutoForkPhysicalInput;'
  );
  const enforceGate = createGateEnforcer(
    state,
    {},
    () => true,
    (candidate) => candidate.id,
    (candidate) => candidate.transitions,
    (candidate) => candidate.id,
    (candidate) => candidate.entryGate,
    (candidate) => candidate.distance,
    helpers.graphGateReachDistance,
    helpers.graphGateTarget,
    () => ({ maxLatAccel: 20 }),
    { reverseRatePerSecond: 8.6, engageRatePerSecond: 5.4 }
  );
  assert.equal(
    enforceGate(0),
    -1,
    'an outward drift inside a right half-plane must steer back toward its finite shallow target'
  );
});

test('locked-route steering constrains the plan before Guardian makes the final safety decision', () => {
  const calls = [];
  const createResolver = new Function(
    'state',
    'computeAutoSteer',
    'enforceAutoForkPhysicalInput',
    'guardianSteerOverride',
    'automaticDrivingAuthorityActive',
    `'use strict';\n${functionSource('resolveAutoSteer')}\nreturn resolveAutoSteer;`
  );
  const resolveAutoSteer = createResolver(
    { autoPilot: true },
    () => {
      calls.push('plan');
      return 0;
    },
    (steer) => {
      calls.push(`fork:${steer}`);
      return 1;
    },
    (steer) => {
      calls.push(`guardian:${steer}`);
      return -1;
    },
    () => true
  );

  assert.equal(resolveAutoSteer({}), -1);
  assert.deepEqual(calls, ['plan', 'fork:0', 'guardian:1']);
  const updatePlayer = functionSource('updatePlayer');
  assert.match(updatePlayer, /const steerCommand = manualSteer !== 0 \? manualSteer : autoSteer/);
});

test('Guardian command, virtual steer, and escape side derive from its final target', () => {
  const state = {
    lateral: 0,
    lateralVelocity: 0,
    speed: 100,
    autoTarget: 0,
    autoLastSafeTarget: 0,
    autoEscapeSide: 0,
    autoVirtualSteer: 0
  };
  const createGuardianHelpers = new Function(
    'state',
    'activeRoadSafeHalf',
    'clamp',
    'getPlayerKinematics',
    'getAutoHalfWidth',
    `'use strict';\n${functionSource('digitalSteerFromTarget')}\n`
      + `${functionSource('commitGuardianTarget')}\n`
      + 'return { commitGuardianTarget };'
  );
  const helpers = createGuardianHelpers(
    state,
    () => 7.62,
    (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    () => ({ maxLatAccel: 20 }),
    () => 7
  );

  assert.equal(helpers.commitGuardianTarget(-3), -1);
  assert.deepEqual(
    [state.autoTarget, state.autoLastSafeTarget, state.autoEscapeSide, state.autoVirtualSteer],
    [-3, -3, -1, -1]
  );
  assert.equal(helpers.commitGuardianTarget(3), 1);
  assert.deepEqual(
    [state.autoTarget, state.autoLastSafeTarget, state.autoEscapeSide, state.autoVirtualSteer],
    [3, 3, 1, 1]
  );

  const guardian = sourceBetween('guardianSteer(baseSteer, frame)', '\n  };');
  assert.equal((guardian.match(/return commitGuardianTarget\(finalTarget\)/g) || []).length, 2);
  assert.doesNotMatch(guardian, /state\.autoVirtualSteer = (?:dir|bestDir)/);
  assert.doesNotMatch(guardian, /return (?:dir|bestDir);/);
});

test('planner cadence is bounded while slow frames retain full planning', () => {
  const helpersSource = sourceBetween('const autoPlannerTargetHz = 30;', 'const autoPilotPlanner = {');
  const createHelpers = new Function(
    `'use strict';\n${helpersSource}\nreturn {\n`
      + '  autoPlannerIntervalSeconds,\n'
      + '  autoPlannerMaximumHoldSeconds,\n'
      + '  resetAutoPlannerCadence,\n'
      + '  advanceAutoPlannerCadence,\n'
      + '  commitAutoPlannerCadence\n'
      + '};'
  );
  const helpers = createHelpers();
  const cadence = {};
  helpers.resetAutoPlannerCadence(cadence);
  assert.equal(helpers.advanceAutoPlannerCadence(cadence, 1 / 60), true, 'takeover must plan immediately');
  helpers.commitAutoPlannerCadence(cadence);
  assert.equal(helpers.advanceAutoPlannerCadence(cadence, 1 / 60), false);
  assert.equal(helpers.advanceAutoPlannerCadence(cadence, 1 / 60), true, '60Hz rendering must plan every second frame');
  helpers.commitAutoPlannerCadence(cadence);
  assert.equal(helpers.advanceAutoPlannerCadence(cadence, 0.045), true, 'a capped slow frame must never skip planning');
  cadence.elapsedSeconds = 0;
  cadence.forcePlan = false;
  helpers.advanceAutoPlannerCadence(cadence, 10);
  assert.equal(cadence.elapsedSeconds, helpers.autoPlannerMaximumHoldSeconds);
  assert.ok(helpers.autoPlannerMaximumHoldSeconds > helpers.autoPlannerIntervalSeconds);

  for (const renderHz of [60, 75, 100, 120, 144]) {
    const fixedCadence = {};
    helpers.resetAutoPlannerCadence(fixedCadence);
    let planCount = 0;
    let maximumHoldSeconds = 0;
    const frameDt = 1 / renderHz;
    const frameCount = renderHz * 10;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      if (!helpers.advanceAutoPlannerCadence(fixedCadence, frameDt)) continue;
      maximumHoldSeconds = Math.max(maximumHoldSeconds, fixedCadence.elapsedSeconds);
      planCount++;
      helpers.commitAutoPlannerCadence(fixedCadence);
    }
    assert.ok(
      Math.abs(planCount - 300) <= 1,
      `${renderHz}Hz rendering produced ${planCount} plans instead of a stable 30Hz cadence`
    );
    assert.ok(
      maximumHoldSeconds <= helpers.autoPlannerIntervalSeconds + frameDt + 0.000_000_001,
      `${renderHz}Hz rendering exceeded the bounded planner hold interval`
    );
  }

  const slowCadence = {};
  helpers.resetAutoPlannerCadence(slowCadence);
  for (let frameIndex = 0; frameIndex < 100; frameIndex++) {
    assert.equal(helpers.advanceAutoPlannerCadence(slowCadence, 0.045), true);
    helpers.commitAutoPlannerCadence(slowCadence);
  }
});

test('rollout TypedArray scratch is bounded and selected trajectories survive overwrite', () => {
  const helpersSource = sourceBetween('const autoPlannerTargetHz = 30;', 'const autoPilotPlanner = {');
  const createHelpers = new Function(
    `'use strict';\n${helpersSource}\nreturn {\n`
      + '  autoPlannerMaximumRolloutSteps,\n'
      + '  autoPlannerTrajectorySampleCapacity,\n'
      + '  createAutoPlannerTrajectoryScratch,\n'
      + '  copyAutoPlannerTrajectory\n'
      + '};'
  );
  const helpers = createHelpers();
  const candidate = helpers.createAutoPlannerTrajectoryScratch();
  const selected = helpers.createAutoPlannerTrajectoryScratch();
  assert.ok(candidate.xs instanceof Float64Array);
  assert.ok(candidate.vs instanceof Float64Array);
  assert.ok(candidate.us instanceof Float64Array);
  assert.equal(candidate.xs.length, helpers.autoPlannerTrajectorySampleCapacity);
  assert.equal(candidate.us.length, helpers.autoPlannerMaximumRolloutSteps);

  candidate.sampleCount = 3;
  candidate.controlCount = 2;
  candidate.xs.set([1, 2, 3]);
  candidate.vs.set([4, 5, 6]);
  candidate.us.set([-1, 1]);
  Object.assign(candidate, {
    target: 3,
    baseCost: 7,
    cost: 8,
    collision: 0.25,
    minGap: 1.5,
    hard: true,
    near: true,
    severeEvidenceForwardM: 44,
    severeEvidenceTtcSeconds: 0.44,
    severeEvidenceReason: 'hard-obstacle',
    reward: 9,
    bestPickupId: 10
  });
  helpers.copyAutoPlannerTrajectory(candidate, selected);
  candidate.xs[1] = 99;
  candidate.us[0] = 0;
  candidate.cost = -1;
  assert.deepEqual(Array.from(selected.xs.slice(0, 3)), [1, 2, 3]);
  assert.deepEqual(Array.from(selected.us.slice(0, 2)), [-1, 1]);
  assert.equal(selected.cost, 8);
  assert.equal(selected.bestPickupId, 10);
  assert.equal(selected.severeEvidenceForwardM, 44);
  assert.equal(selected.severeEvidenceTtcSeconds, 0.44);
  assert.equal(selected.severeEvidenceReason, 'hard-obstacle');

  const rollout = sourceBetween('rollout(ctx, target, trajectory)', 'sample(ctx, arr, t, sampleCount)');
  assert.doesNotMatch(rollout, /const (?:xs|vs|us) = \[/);
  assert.doesNotMatch(rollout, /\.(?:push|subarray)\(/);
  assert.match(source, /candidateTrajectory: createAutoPlannerTrajectoryScratch\(\)/);
  assert.match(source, /primaryTrajectory: createAutoPlannerTrajectoryScratch\(\)/);
  assert.match(source, /survivalTrajectory: createAutoPlannerTrajectoryScratch\(\)/);
});

test('planner hot path preserves player-authoritative physics and damage contracts', () => {
  const planner = sourceBetween('const autoPilotPlanner = {', 'function markAutoPilotCollision()');
  assert.doesNotMatch(planner, /state\.(?:speed|lives|invincibleTimer)\s*=/);
  assert.doesNotMatch(planner, /(?:obstacles|pickups)\.(?:splice|pop|push)\(/);
  assert.match(planner, /digitalSteerFromTarget/);
  assert.match(planner, /guardianSteer\(baseSteer, frame\)/);
  assert.match(source, /const steerCommand = manualSteer !== 0 \? manualSteer : autoSteer/);
  assert.match(source, /gameplayCore\.advanceSteeringActuator\(/);
  assert.match(source, /integratePlayerLateralStep\(dt, steeringStep\.averageActuator\)/);
});

test('vertical contact chronology and constrained frame-end state share one runtime authority', () => {
  const sampler = sourceBetween(
    'function sampleSweptVerticalProfile(',
    'function predictedJumpYAfter('
  );
  const applyResult = sourceBetween(
    'function applySweptVerticalResult(',
    '/** Integrates the vertical rigid-body state'
  );
  const updateVertical = sourceBetween(
    '/** Integrates the vertical rigid-body state',
    'function digitalSteerFromTarget('
  );

  assert.match(
    sampler,
    /verticalSweepFrameFractionStart \+ verticalSweepFrameFractionSpan \* fraction/
  );
  for (const field of [
    'endAltitude',
    'endVelocity',
    'endSurface',
    'endCeiling',
    'endGrounded',
    'endGroundedFraction',
    'endImpactVelocity'
  ]) {
    assert.match(applyResult, new RegExp(`verticalContact\\.${field}`));
  }
  assert.equal(
    (updateVertical.match(/gameplayCore\.sweptVerticalContact\(\{/g) || []).length,
    2,
    'Platform remainders and ordinary airborne frames must share the core sweep'
  );
  assert.match(
    updateVertical,
    /startDistance:\s*lipDistance[\s\S]*?endDistance:\s*sweepDistance[\s\S]*?duration:\s*remainingDt/
  );
  assert.ok(
    updateVertical.indexOf('releaseFromJumpPlatform(tangentVy')
      < updateVertical.indexOf('gameplayCore.sweptVerticalContact({'),
    'The platform must establish its passive surface release before sweeping the remaining frame'
  );
  assert.doesNotMatch(updateVertical, /launchVertical\('jump-platform'/);
  assert.match(updateVertical, /startVelocity:\s*tangentVy/);
  assert.doesNotMatch(
    updateVertical,
    /state\.altitude = surfaceScratch\.height \+ tangentVy \* remainingDt/
  );
  assert.match(applyResult, /resolveAirborneLandingSupport\(/);
  assert.match(applyResult, /crashFromOffRoadLanding\(/);
  assert.ok(
    applyResult.indexOf('resolveAirborneLandingSupport(')
      < applyResult.indexOf('state.grounded = true'),
    'Real-road support must be resolved before the landing becomes authoritative'
  );
  const offRoadCrash = sourceBetween(
    'function crashFromOffRoadLanding(',
    '/**\n   * Apply one core sweep'
  );
  assert.match(offRoadCrash, /recordTrackEvent\('off-road-crash'/);
  assert.match(offRoadCrash, /endGame\(\);/);
  const gameOver = sourceBetween('function endGame()', 'function jump(');
  assert.match(gameOver, /state\.lastCrashReason === 'off-road-landing'/);
  assert.match(gameOver, /'launch\.offRoadCrashStatus'/);
  assert.match(source, /const playerTopOffset = coveredClearanceContract\.maximumCoveredTopOffsetM;/);
  assert.match(source, /const ceilingContactMargin = 0\.05;/);
});

test('grounded visual roll derives its complete footprint from the ship clearance contract', () => {
  const coveredClearanceLiteral = shipSource.match(
    /const COVERED_CLEARANCE_CONTRACT = Object\.freeze\((\{[\s\S]*?\})\);/
  );
  assert.ok(coveredClearanceLiteral, 'The covered-clearance footprint must remain reviewable');
  const contract = Function(`'use strict'; return (${coveredClearanceLiteral[1]});`)();
  assert.equal(contract.mainVisualHalfWidthM, 2.62);
  assert.equal(contract.mainVisualMinimumYM, 0.206_8);
  assert.match(
    source,
    /const groundedShipMinimumVisualY = coveredClearanceContract\.mainVisualMinimumYM;/
  );
  assert.match(
    source,
    /const groundedShipVisualHalfWidth = coveredClearanceContract\.mainVisualHalfWidthM;/
  );
  assert.doesNotMatch(source, /groundedShipVisualHalfWidth\s*=\s*2\.34/);
  assert.match(
    source,
    /Math\.atan2\([\s\S]*?groundedShipMinimumVisualY[\s\S]*?groundedShipVisualHalfWidth/
  );
});
