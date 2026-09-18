/* Execute the authored HUD projectors against counted DOM surfaces; no browser or gameplay loop is replaced. */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const source = readFileSync(path.join(root, 'src/runtime/Neon_Autopilot_V23_HighSpeed_DroneHeat.js'), 'utf8');
const gameplay = require(path.join(root, 'src/gameplay/Neon_Autopilot_V23_HighSpeed_DroneHeat.gameplay-core.js'));
const { MESSAGES } = require(path.join(root, 'src/ui/Neon_Autopilot_V23_HighSpeed_DroneHeat.i18n.js'));

/** Keep cache declarations and their real functions together so each fixture gets an independent lifecycle. */
function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing HUD section: ${startMarker}`);
  return source.slice(start, end);
}

/** Extract the real scalar dial/authority helpers without executing the browser's startup side effects. */
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing helper ${name}`);
  const body = source.indexOf('{', source.indexOf(') {', start));
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated helper ${name}`);
}

/** Count writes and translations even when a browser would coalesce unchanged attribute values internally. */
function createFixture() {
  const writes = [];
  const translations = [];
  const formats = [];
  const elements = {};
  function element(name) {
    let text = '';
    const attributes = new Map();
    const styles = new Map();
    const result = {
      hidden: false,
      dataset: new Proxy({}, {
        set(target, key, value) {
          writes.push([name, 'dataset', key, String(value)]);
          target[key] = String(value);
          return true;
        }
      }),
      style: {
        getPropertyValue(key) { return styles.get(key) || ''; },
        setProperty(key, value) { writes.push([name, 'style', key, value]); styles.set(key, value); }
      },
      classList: { toggle(key, active) { writes.push([name, 'class', key, active]); } },
      getAttribute(key) { return attributes.get(key) ?? null; },
      setAttribute(key, value) { writes.push([name, 'attribute', key, String(value)]); attributes.set(key, String(value)); },
      get textContent() { return text; },
      set textContent(value) { writes.push([name, 'text', '', String(value)]); text = String(value); }
    };
    elements[name] = result;
    return result;
  }
  const i18n = { language: 'zh-CN' };
  const state = {
    speed: 80 / 3.6, running: true, paused: false, gameOver: false, autoPilot: false,
    manualJumpIndicatorUntil: 0, autoJumpIndicatorUntil: 0, autoJumpIntent: false,
    resolvedSteerInput: 0, autoBrake: false, jumpPlatformFlightActive: false,
    airTimeDisplayUntil: 0, airTime: 0, lastFlightAirTime: 0,
    handling: { maximumRpm: gameplay.PROPULSION_CORE_CONTRACT.maximumRpm, spoolUpRatePerSecond: 0.2 },
    propulsionCoreRpm: 2_000, propulsionCoreState: 'thrust', propulsionThrustNormalized: 0.4,
    longitudinalNetAccelerationMps2: 1.2, idleCreepConnected: true, idleCreepActive: false,
    idleCreepThrustNormalized: 0, gearTorqueAvailability: 1, gearRpmCouplingNormalized: 0.2,
    luggingSeverity: 0, gearLugging: false, gearStalled: false, recommendedRecoveryGear: 1,
    recoveryShiftCount: 0, driveGear: 2, driveTransmissionMode: 'manual'
  };
  const keys = { left: false, right: false, throttle: false, jump: false, brake: false };
  const dependencies = {
    state, keys, i18n,
    propulsionCoreContract: gameplay.PROPULSION_CORE_CONTRACT,
    speedToKmh: (value) => value * 3.6,
    fairAutopilotContractSpeed: gameplay.LONGITUDINAL_DYNAMICS_CONTRACT.cruiseTargetSpeedMps,
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    uiNumber(value, options) {
      formats.push([value, i18n.language]);
      return new Intl.NumberFormat(i18n.language === 'en' ? 'en-US' : 'zh-CN', options).format(value);
    },
    uiText(key, parameters = {}) {
      translations.push([key, i18n.language]);
      const message = MESSAGES[i18n.language][key];
      assert.equal(typeof message, 'string', `Missing production translation ${key}`);
      return message.replace(/\{(\w+)\}/g, (_, name) => String(parameters[name]));
    }
  };
  for (const name of [
    'hudPrimaryBodyEl', 'speedValueEl', 'mobileGlanceSpeedEl', 'mobileFlightSpeedEl', 'speedEl',
    'speedometerStatusEl', 'speedometerNeedleEl', 'speedometerValueArcEl', 'speedometerEl',
    'propulsionCoreEl', 'propulsionCoreRpmFillEl', 'propulsionCoreRpmNeedleEl', 'propulsionCoreStateEl',
    'propulsionCoreRpmValueEl', 'propulsionThrustValueEl', 'propulsionAccelerationValueEl',
    'propulsionCoreRpmMeterEl', 'keyTracker', 'keyTrackerMode'
  ]) dependencies[name] = element(name);
  dependencies.keyTrackerInputs = Object.keys(keys).map((key) => [key, element(`key-${key}`)]);
  const productionSections = [
    section('const speedometerContract = Object.freeze(', '/** Map every non-negative speed'),
    functionSource('speedometerProgressForKmh'),
    functionSource('resolveSpeedometerDialPresentation'),
    'const speedometerDialPresentationScratch = {};',
    functionSource('automaticDrivingAuthorityActive'),
    section("let displayedKeyTrackerSignature = '';", 'const SURFACE_CONTACT_KEYS'),
    section("let displayedSpeedTextSignature = '';", 'const propulsionCoreStateIds'),
    section('const propulsionCoreStateIds = Object.freeze(', 'let displayedHandlingCandleCount')
  ].join('\n');
  const projectors = new Function('dependencies', `
    const { ${Object.keys(dependencies).join(', ')} } = dependencies;
    ${productionSections}
    return { updateSpeedometer, updatePropulsionCoreMeter, updateKeyTracker, resolveSpeedometerDialPresentation };
  `)(dependencies);
  return {
    ...projectors, state, keys, i18n, elements, writes, translations, formats,
    clearCounts() { writes.length = 0; translations.length = 0; formats.length = 0; },
    frame(now = 0) {
      projectors.updateSpeedometer();
      projectors.updatePropulsionCoreMeter();
      projectors.updateKeyTracker(now);
    }
  };
}

test('600 stable visible HUD frames perform zero repeated DOM writes or translations', () => {
  const fixture = createFixture();
  fixture.frame();
  assert.ok(fixture.writes.length > 0);
  const stateBefore = structuredClone(fixture.state);
  fixture.clearCounts();
  for (let frame = 1; frame <= 600; frame++) fixture.frame(frame * 1_000 / 60);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.translations.length, 0);
  assert.equal(fixture.formats.length, 0);
  assert.deepEqual(fixture.state, stateBefore, 'HUD projection mutated gameplay authority');
});

test('hidden detailed meters defer work while mobile speed remains current and expansion restores this frame', () => {
  const fixture = createFixture();
  fixture.frame();
  fixture.elements.hudPrimaryBodyEl.hidden = true;
  const priorNeedle = fixture.elements.speedometerNeedleEl.getAttribute('transform');
  const priorRpm = fixture.elements.propulsionCoreRpmValueEl.textContent;
  fixture.clearCounts();
  for (let frame = 1; frame <= 600; frame++) {
    fixture.state.speed = (80 + frame * 0.1) / 3.6;
    fixture.state.propulsionCoreRpm = 2_000 + frame;
    fixture.frame(frame * 1_000 / 60);
  }
  assert.equal(fixture.elements.mobileGlanceSpeedEl.textContent, '140');
  assert.equal(fixture.elements.mobileFlightSpeedEl.textContent, '140');
  assert.equal(fixture.elements.speedValueEl.textContent, '140');
  assert.equal(fixture.elements.speedometerNeedleEl.getAttribute('transform'), priorNeedle);
  assert.equal(fixture.elements.propulsionCoreRpmValueEl.textContent, priorRpm);
  assert.equal(fixture.writes.some(([name]) => name.startsWith('propulsion')), false);
  assert.equal(fixture.writes.some(([name]) => /speedometer(?:Needle|ValueArc)/.test(name)), false);
  fixture.elements.hudPrimaryBodyEl.hidden = false;
  fixture.frame(10_001);
  assert.equal(fixture.elements.propulsionCoreRpmValueEl.textContent, '2,600');
  assert.equal(
    fixture.elements.speedometerNeedleEl.getAttribute('transform'),
    fixture.resolveSpeedometerDialPresentation(140).needleTransform
  );
});

test('visible analog motion updates every changed RAF while unchanged rounded speed avoids Intl work', () => {
  const fixture = createFixture();
  fixture.state.speed = 80.1 / 3.6;
  fixture.updateSpeedometer();
  fixture.clearCounts();
  for (let frame = 1; frame <= 120; frame++) {
    const speed = 80.1 + frame * 0.001;
    fixture.state.speed = speed / 3.6;
    fixture.updateSpeedometer();
    const expected = fixture.resolveSpeedometerDialPresentation(speed);
    assert.equal(fixture.elements.speedometerNeedleEl.getAttribute('transform'), expected.needleTransform);
    assert.equal(fixture.elements.speedometerValueArcEl.getAttribute('d'), expected.arcPath);
  }
  assert.equal(fixture.writes.filter(([name, kind]) => name === 'speedometerNeedleEl' && kind === 'attribute').length, 120);
  assert.equal(fixture.formats.length, 0);
  assert.equal(fixture.translations.length, 0);
  fixture.state.speed = 119.99 / 3.6;
  fixture.updateSpeedometer();
  const belowAria = fixture.elements.speedEl.getAttribute('aria-label');
  fixture.state.speed = 120.01 / 3.6;
  fixture.updateSpeedometer();
  assert.equal(fixture.elements.speedValueEl.textContent, '120');
  assert.equal(fixture.elements.speedometerEl.dataset.speedState, 'over-target');
  assert.notEqual(fixture.elements.speedEl.getAttribute('aria-label'), belowAria);
});

test('visible propulsion progress follows every packet and gear changes remain immediate at constant RPM', () => {
  const fixture = createFixture();
  fixture.updatePropulsionCoreMeter();
  fixture.clearCounts();
  for (let frame = 1; frame <= 120; frame++) {
    fixture.state.propulsionCoreRpm = 2_000 + frame * 0.02;
    fixture.updatePropulsionCoreMeter();
    const expectedProgress = (
      (fixture.state.propulsionCoreRpm - gameplay.PROPULSION_CORE_CONTRACT.idleRpm)
      / (fixture.state.handling.maximumRpm - gameplay.PROPULSION_CORE_CONTRACT.idleRpm)
    ).toFixed(6);
    assert.equal(
      fixture.elements.propulsionCoreEl.style.getPropertyValue('--propulsion-rpm-progress'),
      expectedProgress
    );
  }
  assert.equal(fixture.writes.filter(([name, kind]) => name === 'propulsionCoreEl' && kind === 'style').length, 120);
  fixture.state.gearStalled = true;
  fixture.state.driveGear = 3;
  fixture.state.propulsionCoreState = 'stalled';
  fixture.updatePropulsionCoreMeter();
  assert.equal(fixture.elements.propulsionCoreEl.dataset.gearStalled, 'true');
  assert.equal(fixture.elements.propulsionCoreEl.dataset.driveGear, '3');
  assert.equal(fixture.elements.propulsionCoreEl.dataset.propulsionState, 'stalled');
});

test('language changes refresh cached digital, propulsion, and input descriptions immediately', () => {
  const fixture = createFixture();
  fixture.keys.jump = true;
  fixture.frame();
  const previous = [
    fixture.elements.speedEl.getAttribute('aria-label'),
    fixture.elements.propulsionCoreStateEl.textContent,
    fixture.elements.keyTracker.getAttribute('aria-label')
  ];
  fixture.i18n.language = 'en';
  fixture.clearCounts();
  fixture.frame(16);
  assert.ok(fixture.formats.length > 0 && fixture.translations.length > 0);
  assert.notEqual(fixture.elements.speedEl.getAttribute('aria-label'), previous[0]);
  assert.notEqual(fixture.elements.propulsionCoreStateEl.textContent, previous[1]);
  assert.notEqual(fixture.elements.keyTracker.getAttribute('aria-label'), previous[2]);
  fixture.clearCounts();
  fixture.frame(32);
  assert.equal(fixture.writes.length, 0);
});

test('input taps, mixed autopilot takeover, hold expiry and visible airtime hundredths commit without throttling', () => {
  const fixture = createFixture();
  fixture.frame(0);
  fixture.keys.left = true;
  fixture.updateKeyTracker(1);
  assert.equal(fixture.elements['key-left'].dataset.inputSource, 'manual');
  fixture.keys.left = false;
  fixture.state.autoPilot = true;
  fixture.state.resolvedSteerInput = -0.3;
  fixture.keys.throttle = true;
  fixture.updateKeyTracker(2);
  assert.equal(fixture.elements['key-left'].dataset.inputSource, 'auto');
  assert.equal(fixture.elements.keyTracker.dataset.inputSource, 'mixed');
  fixture.state.manualJumpIndicatorUntil = 180;
  fixture.updateKeyTracker(179);
  assert.equal(fixture.elements['key-jump'].dataset.inputSource, 'manual');
  fixture.updateKeyTracker(180);
  assert.equal(fixture.elements['key-jump'].dataset.inputSource, 'idle');
  fixture.state.autoJumpIndicatorUntil = 200;
  fixture.updateKeyTracker(199);
  assert.equal(fixture.elements['key-jump'].dataset.inputSource, 'auto');
  fixture.updateKeyTracker(200);
  assert.equal(fixture.elements['key-jump'].dataset.inputSource, 'idle');
  fixture.state.jumpPlatformFlightActive = true;
  fixture.state.airTime = 1.234;
  fixture.updateKeyTracker(201);
  assert.equal(fixture.elements.keyTrackerMode.textContent, '1.23s');
  fixture.clearCounts();
  fixture.state.airTime = 1.234_5;
  fixture.updateKeyTracker(202);
  assert.equal(fixture.writes.length, 0);
  fixture.state.airTime = 1.236;
  fixture.updateKeyTracker(203);
  assert.equal(fixture.elements.keyTrackerMode.textContent, '1.24s');
  fixture.state.jumpPlatformFlightActive = false;
  fixture.state.lastFlightAirTime = 1.236;
  fixture.state.airTimeDisplayUntil = 300;
  fixture.updateKeyTracker(299);
  assert.equal(fixture.elements.keyTracker.dataset.airTime, '1.24');
  fixture.updateKeyTracker(300);
  assert.equal(fixture.elements.keyTracker.dataset.airTime, '');
  fixture.state.paused = true;
  fixture.updateKeyTracker(301);
  assert.equal(fixture.elements['key-left'].dataset.inputSource, 'idle');
  fixture.state.autoPilot = false;
  fixture.updateKeyTracker(302);
  assert.equal(fixture.elements.keyTracker.dataset.mode, 'manual');
});
