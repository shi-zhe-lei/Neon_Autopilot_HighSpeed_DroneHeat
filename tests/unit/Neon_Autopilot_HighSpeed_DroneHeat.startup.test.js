const assert = require('node:assert/strict');
const path = require('node:path');

// Resolve the root-level startup error boundary independent of test cwd.
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function createClassList(...initialValues) {
  const values = new Set(initialValues);
  return {
    add(...tokens) {
      for (const token of tokens) values.add(token);
    },
    remove(...tokens) {
      for (const token of tokens) values.delete(token);
    },
    contains(token) {
      return values.has(token);
    },
    toggle(token, force) {
      const shouldAdd = force === undefined ? !values.has(token) : Boolean(force);
      if (shouldAdd) values.add(token);
      else values.delete(token);
      return shouldAdd;
    }
  };
}

function createElement() {
  const listeners = new Map();
  return {
    hidden: true,
    disabled: false,
    inert: false,
    style: {},
    textContent: '',
    attributes: new Map(),
    classList: createClassList(),
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { listeners.get(type)?.(); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    focus() { this.focused = true; }
  };
}

const startupLoadingElement = createElement();
startupLoadingElement.hidden = false;
startupLoadingElement.setAttribute('aria-hidden', 'false');
startupLoadingElement.setAttribute('aria-busy', 'true');
const launchOverlayElement = createElement();
launchOverlayElement.hidden = false;
launchOverlayElement.setAttribute('aria-hidden', 'false');

const elements = new Map([
  ['startupLoading', startupLoadingElement],
  ['startupError', createElement()],
  ['startupErrorTitle', createElement()],
  ['startupErrorMessage', createElement()],
  ['startupErrorDetails', createElement()],
  ['startupRetryBtn', createElement()],
  ['overlay', launchOverlayElement]
]);
let reloadCount = 0;
const windowListeners = new Map();
const bodyClassList = createClassList('startup-loading-open', 'launch-overlay-open');

global.requestAnimationFrame = (callback) => callback();
global.document = {
  body: {
    children: [...elements.values()],
    classList: bodyClassList
  },
  addEventListener() {},
  getElementById(id) { return elements.get(id) || null; }
};
global.window = {
  localStorage: {
    getItem() { return '42'; },
    setItem() {}
  },
  location: { protocol: 'file:', search: '', reload() { reloadCount++; } },
  addEventListener(type, listener) { windowListeners.set(type, listener); }
};

require(path.join(PROJECT_ROOT, 'errors/startup.js'));

const startup = global.window.NeonStartup;
const errors = global.window.NeonErrors;
assert.ok(startup, 'Startup boundary did not publish its browser contract');
assert.ok(errors.NeonRenderingError.prototype instanceof errors.NeonStartupError);
assert.equal(startup.readFiniteNonNegativeNumber('score', 0), 42);
assert.equal(startup.readString('language', 'zh-CN'), '42');
assert.equal(startup.writeString('score', 72), true);

windowListeners.get('error')?.({ error: new Error('early initialization failure') });
assert.equal(
  startup.getDiagnostics().fatalErrorCount,
  1,
  'Initialization errors must still show the recovery surface before main registers a fatal handler'
);
assert.equal(
  startup.getDiagnostics().lastFatalError.code,
  'startup-failure',
  'The early global boundary must retain startup-failure semantics before runtime owns fatal stops'
);
assert.equal(startupLoadingElement.hidden, true);
assert.equal(startupLoadingElement.inert, true);
assert.equal(startupLoadingElement.attributes.get('aria-hidden'), 'true');
assert.equal(startupLoadingElement.attributes.get('aria-busy'), 'false');
assert.equal(launchOverlayElement.hidden, true);
assert.equal(launchOverlayElement.inert, true);
assert.equal(launchOverlayElement.style.display, 'none');
assert.equal(launchOverlayElement.attributes.get('aria-hidden'), 'true');
assert.equal(bodyClassList.contains('startup-loading-open'), false);
assert.equal(bodyClassList.contains('launch-overlay-open'), false);
assert.equal(bodyClassList.contains('startup-failed'), true);

global.window.localStorage.getItem = () => {
  throw new Error('storage denied');
};
global.window.localStorage.setItem = () => {
  throw new Error('storage denied');
};
assert.equal(startup.readFiniteNonNegativeNumber('score', 7), 7);
assert.equal(startup.readString('language', 'zh-CN'), 'zh-CN');
assert.equal(startup.writeString('score', 72), false);

startup.showError({ message: 'metadata-free failure' }, { code: 'metadata-free' });
assert.deepEqual(
  Object.keys(startup.getDiagnostics().lastFatalError),
  ['code', 'name', 'message'],
  'Missing source metadata must not change the legacy diagnostics shape'
);

startup.showError(new errors.NeonRenderingError('Error creating WebGL context'));
assert.equal(elements.get('startupError').hidden, false);
assert.equal(elements.get('startupError').attributes.get('aria-hidden'), 'false');
assert.match(elements.get('startupErrorMessage').textContent, /网页三维图形环境/);
assert.match(elements.get('startupErrorDetails').textContent, /rendering-unavailable/);
assert.equal(elements.get('startupRetryBtn').focused, true);

const delegatedFatalEvents = [];
const unregisterFatalHandler = startup.registerFatalHandler((error, options) => {
  delegatedFatalEvents.push({ error, options });
  return true;
});
const runtimeError = new Error('runtime failure');
runtimeError.stack = 'Error: runtime failure\n    at advanceRouteProgress (runtime.js:3:14)';
windowListeners.get('error')?.({
  error: runtimeError,
  filename: 'runtime.js',
  lineno: 3,
  colno: 14
});
windowListeners.get('unhandledrejection')?.({
  reason: new Error('runtime rejection')
});
windowListeners.get('error')?.({
  error: null,
  message: 'Script error.',
  filename: '',
  lineno: 0,
  colno: 0
});
windowListeners.get('error')?.({
  target: {
    tagName: 'SCRIPT',
    src: 'file:///D:/Gary/src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'
  }
});
assert.equal(delegatedFatalEvents[0]?.error.message, 'runtime failure');
assert.deepEqual(delegatedFatalEvents[0]?.options, {
  code: 'runtime-uncaught-error',
  filename: 'runtime.js',
  line: 3,
  column: 14
});
assert.equal(delegatedFatalEvents[1]?.error.message, 'runtime rejection');
assert.equal(delegatedFatalEvents[1]?.options.code, 'runtime-unhandled-rejection');
assert.equal(delegatedFatalEvents[2]?.error.code, 'file-script-opaque-error');
assert.deepEqual(
  delegatedFatalEvents[2]?.options,
  { code: 'file-script-opaque-error' },
  'Sanitized file errors must not publish the browser sentinel line 0 / column 0'
);
assert.equal(delegatedFatalEvents[3]?.error.code, 'script-resource-load-failed');
assert.deepEqual(delegatedFatalEvents[3]?.options, {
  code: 'script-resource-load-failed',
  filename: 'file:///D:/Gary/src/runtime/Neon_Autopilot_HighSpeed_DroneHeat.js'
});
assert.equal(
  startup.getDiagnostics().fatalErrorCount,
  3,
  'A registered runtime handler owns stop and presentation without a duplicate startup showError call'
);
assert.equal(unregisterFatalHandler(), true);
assert.equal(unregisterFatalHandler(), false);

const sourceError = new Error('route cursor invariant failed');
sourceError.stack = 'Error: route cursor invariant failed\n    at advanceCursor (track.js:4:21)';
startup.showError(sourceError, {
  code: 'runtime-frame-failure',
  filename: 'track.js',
  line: 4,
  column: 21
});
assert.deepEqual(startup.getDiagnostics().lastFatalError, {
  code: 'runtime-frame-failure',
  name: 'Error',
  message: 'route cursor invariant failed',
  filename: 'track.js',
  line: 4,
  column: 21,
  stack: sourceError.stack
});
assert.match(elements.get('startupErrorDetails').textContent, /filename: track\.js/);
assert.match(elements.get('startupErrorDetails').textContent, /line: 4/);
assert.match(elements.get('startupErrorDetails').textContent, /column: 21/);
assert.match(elements.get('startupErrorDetails').textContent, /stack:\nError: route cursor invariant failed/);

elements.get('startupRetryBtn').dispatch('click');
assert.equal(reloadCount, 1);
const finalDiagnostics = startup.getDiagnostics();
assert.deepEqual({
  storageReadFailures: finalDiagnostics.storageReadFailures,
  storageWriteFailures: finalDiagnostics.storageWriteFailures,
  fatalErrorCount: finalDiagnostics.fatalErrorCount,
  lastStorageError: finalDiagnostics.lastStorageError,
  lastFatalError: finalDiagnostics.lastFatalError
}, {
  storageReadFailures: 2,
  storageWriteFailures: 1,
  fatalErrorCount: 4,
  lastStorageError: 'storage denied',
  lastFatalError: {
    code: 'runtime-frame-failure',
    name: 'Error',
    message: 'route cursor invariant failed',
    filename: 'track.js',
    line: 4,
    column: 21,
    stack: sourceError.stack
  }
});
assert.equal(finalDiagnostics.updateMarkerReason, 'missing-marker');
assert.equal(finalDiagnostics.updateNoticeActive, false);
assert.equal(finalDiagnostics.updateContinueAvailable, false);

console.log(JSON.stringify({
  ok: true,
  storageFallback: true,
  renderingRecovery: true,
  retryCount: reloadCount
}));
