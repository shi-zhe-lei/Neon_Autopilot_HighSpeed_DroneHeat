const assert = require('node:assert/strict');
const path = require('node:path');

// Resolve the production UI module from the project root, independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(
  PROJECT_ROOT,
  'src/ui/Neon_Autopilot_HighSpeed_DroneHeat.fullscreen.js'
);

function createElement(id, dataset = {}) {
  const listeners = new Map();
  const classes = new Set();
  return {
    id,
    disabled: false,
    hidden: true,
    textContent: '',
    dataset: { ...dataset },
    fullscreenState: null,
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      }
    },
    attributes: new Map(),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    querySelector(selector) {
      return selector === '[data-fullscreen-state]' ? this.fullscreenState : null;
    },
    listenerCount(type) {
      return listeners.get(type)?.length || 0;
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener({ target: this, ...event });
    },
    click() {
      if (!this.disabled) this.dispatch('click');
    }
  };
}

const CATALOGS = Object.freeze({
  'zh-CN': Object.freeze({
    'common.unavailable': '不可用',
    'common.enter': '进入',
    'common.exit': '退出',
    'hud.fullscreen.unsupportedAria': '当前浏览器不支持全屏显示',
    'hud.fullscreen.unsupportedFallback': '不支持全屏',
    'hud.fullscreen.enterAria': '进入全屏显示',
    'hud.fullscreen.exitAria': '退出全屏显示',
    'hud.fullscreen.enterFallback': '全屏显示',
    'hud.fullscreen.exitFallback': '退出全屏',
    'hud.fullscreen.denied': '浏览器拒绝了全屏请求；游戏仍可在当前窗口继续运行。',
    'hud.fullscreen.policyDenied': '当前页面策略不允许全屏；请在浏览器设置中允许后重试。'
  }),
  en: Object.freeze({
    'common.unavailable': 'Unavailable',
    'common.enter': 'Enter',
    'common.exit': 'Exit',
    'hud.fullscreen.unsupportedAria': 'Fullscreen is unavailable in this browser',
    'hud.fullscreen.unsupportedFallback': 'No fullscreen',
    'hud.fullscreen.enterAria': 'Enter fullscreen',
    'hud.fullscreen.exitAria': 'Exit fullscreen',
    'hud.fullscreen.enterFallback': 'Fullscreen',
    'hud.fullscreen.exitFallback': 'Exit fullscreen',
    'hud.fullscreen.denied': 'The browser denied the fullscreen request. The game can continue in this window.',
    'hud.fullscreen.policyDenied': 'This page policy blocks fullscreen. Allow it in browser settings and try again.'
  })
});

function createI18n() {
  let language = 'zh-CN';
  const subscribers = [];
  return {
    get subscribeCount() {
      return subscribers.length;
    },
    t(key, parameters = {}, options = {}) {
      return CATALOGS[language][key] || options.fallback || key;
    },
    translateSource(source) {
      return source;
    },
    subscribe(listener) {
      subscribers.push(listener);
      return () => {};
    },
    setLanguage(nextLanguage) {
      language = nextLanguage;
      for (const subscriber of subscribers) subscriber({ language });
    }
  };
}

function createFixture({ fullscreenEnabled = true } = {}) {
  const hudButton = createElement('fullscreenBtn', { fullscreenToggle: '' });
  const hudState = createElement('fullscreenBtnState', { fullscreenState: '' });
  hudButton.fullscreenState = hudState;
  const launchButton = createElement('launchFullscreenBtn', { fullscreenToggle: '' });
  const launchState = createElement('launchFullscreenBtnState', { fullscreenState: '' });
  launchButton.fullscreenState = launchState;
  const notice = createElement('fullscreenNotice');
  const documentListeners = new Map();
  const i18n = createI18n();
  let requestCalls = 0;
  let exitCalls = 0;
  let requestImplementation = async () => {
    documentObject.fullscreenElement = documentObject.documentElement;
    documentObject.dispatch('fullscreenchange');
  };
  let exitImplementation = async () => {
    documentObject.fullscreenElement = null;
    documentObject.dispatch('fullscreenchange');
  };
  const documentObject = {
    fullscreenEnabled,
    fullscreenElement: null,
    documentElement: {
      requestFullscreen() {
        requestCalls++;
        return requestImplementation();
      }
    },
    exitFullscreen() {
      exitCalls++;
      return exitImplementation();
    },
    querySelectorAll(selector) {
      return selector === '[data-fullscreen-toggle]' ? [hudButton, launchButton] : [];
    },
    getElementById(id) {
      return {
        fullscreenBtn: hudButton,
        fullscreenBtnState: hudState,
        fullscreenNotice: notice
      }[id] || null;
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of documentListeners.get(type) || []) listener({ type, ...event });
    }
  };
  return {
    document: documentObject,
    i18n,
    hudButton,
    hudState,
    launchButton,
    launchState,
    notice,
    get requestCalls() {
      return requestCalls;
    },
    get exitCalls() {
      return exitCalls;
    },
    documentListenerCount(type) {
      return documentListeners.get(type)?.length || 0;
    },
    setRequestImplementation(implementation) {
      requestImplementation = implementation;
    },
    setExitImplementation(implementation) {
      exitImplementation = implementation;
    }
  };
}

function loadModule(fixture) {
  global.document = fixture.document;
  global.window = { NeonI18n: fixture.i18n };
  delete require.cache[require.resolve(MODULE_PATH)];
  require(MODULE_PATH);
  return global.window.NeonFullscreen;
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function assertControlState(fixture, {
  disabled,
  pressed,
  state,
  ariaLabel,
  active
}) {
  for (const [button, stateElement] of [
    [fixture.hudButton, fixture.hudState],
    [fixture.launchButton, fixture.launchState]
  ]) {
    assert.equal(button.disabled, disabled);
    assert.equal(button.attributes.get('aria-pressed'), pressed);
    assert.equal(button.attributes.get('aria-label'), ariaLabel);
    assert.equal(button.classList.contains('is-on'), active);
    assert.equal(stateElement.textContent, state);
  }
}

async function main() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalConsoleError = console.error;
  let timerSerial = 0;
  global.setTimeout = () => ++timerSerial;
  global.clearTimeout = () => {};

  try {
    const fixture = createFixture();
    const fullscreen = loadModule(fixture);
    assert.ok(fullscreen, 'Fullscreen module did not publish its browser contract');
    assert.equal(fullscreen.supported(), true);
    assert.equal(fixture.hudButton.listenerCount('click'), 1);
    assert.equal(fixture.launchButton.listenerCount('click'), 1);
    for (const eventType of [
      'fullscreenchange',
      'webkitfullscreenchange',
      'fullscreenerror',
      'webkitfullscreenerror'
    ]) {
      assert.equal(fixture.documentListenerCount(eventType), 1, `${eventType} must bind once`);
    }
    assert.equal(fixture.i18n.subscribeCount, 1, 'Fullscreen must own one i18n subscription');
    assertControlState(fixture, {
      disabled: false,
      pressed: 'false',
      state: '进入',
      ariaLabel: '进入全屏显示',
      active: false
    });

    let resolveFirstRequest;
    fixture.setRequestImplementation(() => new Promise((resolve) => {
      resolveFirstRequest = () => {
        fixture.document.fullscreenElement = fixture.document.documentElement;
        fixture.document.dispatch('fullscreenchange');
        resolve();
      };
    }));
    fixture.hudButton.click();
    fixture.launchButton.click();
    assert.equal(fixture.requestCalls, 1, 'Both controls must share one in-flight native request');
    resolveFirstRequest();
    await settlePromises();
    assertControlState(fixture, {
      disabled: false,
      pressed: 'true',
      state: '退出',
      ariaLabel: '退出全屏显示',
      active: true
    });

    fixture.document.fullscreenElement = null;
    fixture.document.dispatch('fullscreenchange');
    assertControlState(fixture, {
      disabled: false,
      pressed: 'false',
      state: '进入',
      ariaLabel: '进入全屏显示',
      active: false
    });

    fixture.setRequestImplementation(async () => {
      fixture.document.fullscreenElement = fixture.document.documentElement;
      fixture.document.dispatch('webkitfullscreenchange');
    });
    fixture.launchButton.click();
    await settlePromises();
    assert.equal(fixture.requestCalls, 2);
    fixture.i18n.setLanguage('en');
    assertControlState(fixture, {
      disabled: false,
      pressed: 'true',
      state: 'Exit',
      ariaLabel: 'Exit fullscreen',
      active: true
    });

    fixture.hudButton.click();
    await settlePromises();
    assert.equal(fixture.exitCalls, 1);
    assertControlState(fixture, {
      disabled: false,
      pressed: 'false',
      state: 'Enter',
      ariaLabel: 'Enter fullscreen',
      active: false
    });

    let loggedRejections = 0;
    console.error = () => {
      loggedRejections++;
    };
    fixture.setRequestImplementation(async () => {
      throw new Error('permission denied');
    });
    fixture.launchButton.click();
    await settlePromises();
    assert.equal(loggedRejections, 1);
    assert.equal(fixture.notice.hidden, false);
    assert.equal(
      fixture.notice.textContent,
      'The browser denied the fullscreen request. The game can continue in this window.'
    );
    for (const button of [fixture.hudButton, fixture.launchButton]) {
      assert.equal(button.dataset.fullscreenError, 'permission denied');
    }
    fixture.document.dispatch('fullscreenerror');
    assert.equal(
      fixture.notice.textContent,
      'The browser denied the fullscreen request. The game can continue in this window.',
      'The native error event and rejected promise must report one failed attempt'
    );
    fixture.i18n.setLanguage('zh-CN');
    assert.equal(
      fixture.notice.textContent,
      '浏览器拒绝了全屏请求；游戏仍可在当前窗口继续运行。'
    );

    fixture.setRequestImplementation(async () => {
      fixture.document.fullscreenElement = fixture.document.documentElement;
      fixture.document.dispatch('fullscreenchange');
    });
    fixture.hudButton.click();
    await settlePromises();
    fixture.document.fullscreenElement = null;
    fixture.document.dispatch('fullscreenchange');
    fixture.document.dispatch('webkitfullscreenerror');
    assert.equal(
      fixture.notice.textContent,
      '当前页面策略不允许全屏；请在浏览器设置中允许后重试。'
    );
    for (const button of [fixture.hudButton, fixture.launchButton]) {
      assert.equal(button.dataset.fullscreenError, 'Fullscreen request was rejected');
    }

    const unsupportedFixture = createFixture({ fullscreenEnabled: false });
    const unsupported = loadModule(unsupportedFixture);
    assert.equal(
      unsupported.supported(),
      false,
      'An authoritative false capability must override exposed methods'
    );
    assertControlState(unsupportedFixture, {
      disabled: true,
      pressed: 'false',
      state: '不可用',
      ariaLabel: '当前浏览器不支持全屏显示',
      active: false
    });
    unsupportedFixture.hudButton.click();
    unsupportedFixture.launchButton.click();
    assert.equal(unsupportedFixture.requestCalls, 0);
    assert.equal(unsupportedFixture.i18n.subscribeCount, 1);
    assert.equal(unsupportedFixture.documentListenerCount('fullscreenerror'), 1);
    unsupported.showNotice('fullscreen denied');
    assert.equal(unsupportedFixture.notice.hidden, false);
    assert.equal(unsupportedFixture.notice.textContent, 'fullscreen denied');

    console.log(JSON.stringify({
      ok: true,
      dualControlSynchronization: true,
      inFlightDeduplication: true,
      externalExitSynchronization: true,
      bilingualProjection: true,
      authoritativeCapabilityBoolean: true,
      rejectionProjection: true
    }));
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    console.error = originalConsoleError;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
