#!/usr/bin/env node
/* Update-lease and fatal-precedence contracts / 更新租约与致命优先级合同。 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Resolve the startup contract from the project root so test location and invocation cwd stay irrelevant.
const PROJECT_ROOT = join(__dirname, '../..');
const startupSource = readFileSync(join(PROJECT_ROOT, 'errors/startup.js'), 'utf8');

class FakeElement {
  constructor(id, ownerDocument, tagName = 'DIV') {
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.hidden = true;
    this.disabled = false;
    this.inert = false;
    this.isConnected = true;
    this.textContent = '';
    this.style = { display: '' };
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classNames = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classNames.add(name)),
      remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
      contains: (name) => this.classNames.has(name)
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, overrides = {}) {
    const event = {
      type,
      target: this,
      code: '',
      shiftKey: false,
      defaultPrevented: false,
      propagationStopped: false,
      immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; },
      ...overrides
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }

  closest(selector) {
    if (selector !== '#updateNotice' && selector !== '#startupError') return null;
    const targetId = selector.slice(1);
    let node = this;
    while (node) {
      if (node.id === targetId) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelectorAll() {
    const descendants = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.tagName === 'BUTTON') descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    return descendants;
  }
}

function createHarness(marker, search = '') {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const elements = new Map();
  const document = {
    activeElement: null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    getElementById(id) { return elements.get(id) || null; }
  };
  document.body = new FakeElement('body', document, 'BODY');

  const add = (id, tagName = 'DIV', parent = document.body) => {
    const element = new FakeElement(id, document, tagName);
    elements.set(id, element);
    parent?.appendChild(element);
    return element;
  };
  const releaseStatus = add('releaseStatus', 'SCRIPT', null);
  releaseStatus.textContent = JSON.stringify(marker);
  const app = add('app');
  const overlay = add('overlay');
  const startButton = add('startBtn', 'BUTTON', overlay);
  startButton.hidden = false;
  const updateNotice = add('updateNotice');
  const updateTitle = add('updateNoticeTitle', 'H2', updateNotice);
  const updateMessage = add('updateNoticeMessage', 'P', updateNotice);
  const updateStatus = add('updateNoticeStatus', 'P', updateNotice);
  const updateDetails = add('updateNoticeDetails', 'CODE', updateNotice);
  const updateContinue = add('updateContinueBtn', 'BUTTON', updateNotice);
  const updateReload = add('updateReloadBtn', 'BUTTON', updateNotice);
  updateContinue.disabled = true;
  updateContinue.hidden = false;
  updateReload.hidden = false;
  const startupError = add('startupError');
  add('startupErrorTitle', 'H2', startupError);
  add('startupErrorMessage', 'P', startupError);
  add('startupErrorDetails', 'CODE', startupError);
  const startupRetry = add('startupRetryBtn', 'BUTTON', startupError);
  startupRetry.hidden = false;

  let reloadCount = 0;
  const window = {
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { search, reload() { reloadCount++; } },
    addEventListener(type, listener) { windowListeners.set(type, listener); }
  };
  const context = vm.createContext({
    console,
    Date,
    Error,
    Map,
    Number,
    Object,
    TypeError,
    URLSearchParams,
    document,
    window,
    requestAnimationFrame(callback) { callback(); }
  });
  vm.runInContext(startupSource, context, { filename: 'errors/startup.js' });
  return {
    app,
    document,
    elements,
    get reloadCount() { return reloadCount; },
    overlay,
    startButton,
    startup: window.NeonStartup,
    startupError,
    startupRetry,
    updateContinue,
    updateNotice,
    updateReload,
    updateStatus,
    updateTitle,
    updateMessage,
    updateDetails,
    windowListeners
  };
}

function activeMarker(nowMs) {
  return {
    schemaVersion: 1,
    state: 'updating',
    noticeId: 'lease-test-123',
    issuedAt: new Date(nowMs - 60_000).toISOString(),
    expiresAt: new Date(nowMs + 60 * 60_000).toISOString()
  };
}

test('bounded release leases fail open for stale or malformed markers', () => {
  const nowMs = Date.parse('2026-07-18T11:00:00.000Z');
  const harness = createHarness({
    schemaVersion: 1,
    state: 'stable',
    noticeId: 'stable-123',
    issuedAt: null,
    expiresAt: null
  });
  const resolve = harness.startup.resolveUpdateNoticeStatus;
  assert.equal(resolve(activeMarker(nowMs), { nowMs }).active, true);
  assert.equal(resolve({ ...activeMarker(nowMs), expiresAt: new Date(nowMs - 1).toISOString() }, { nowMs }).reason, 'expired-lease');
  assert.equal(resolve({ ...activeMarker(nowMs), issuedAt: new Date(nowMs + 6 * 60_000).toISOString() }, { nowMs }).reason, 'future-lease');
  assert.equal(resolve({ ...activeMarker(nowMs), expiresAt: new Date(nowMs + 7 * 60 * 60_000).toISOString() }, { nowMs }).reason, 'invalid-lease-duration');
  assert.equal(resolve({ ...activeMarker(nowMs), issuedAt: '2026-07-18T10:59:00' }, { nowMs }).reason, 'invalid-timestamps');
  assert.equal(resolve({ ...activeMarker(nowMs), issuedAt: '2026-07-18T10:59:00+08:00' }, { nowMs }).reason, 'invalid-timestamps');
  assert.equal(resolve({ ...activeMarker(nowMs), issuedAt: '2026-02-30T10:59:00.000Z' }, { nowMs }).reason, 'invalid-timestamps');
  assert.equal(resolve({ schemaVersion: 1, state: 'unknown' }, { nowMs }).reason, 'invalid-state');
  assert.equal(resolve(null, { nowMs }).reason, 'missing-marker');
  assert.equal(resolve(null, { nowMs, debugForced: true }).source, 'model-debug');
});

test('successful first frame enables continue, traps focus, and restores the launch surface', () => {
  const harness = createHarness(activeMarker(Date.now()));
  assert.equal(harness.updateNotice.hidden, false);
  assert.equal(harness.updateNotice.getAttribute('aria-hidden'), 'false');
  assert.equal(harness.updateContinue.disabled, true);
  assert.equal(harness.document.activeElement, harness.updateReload);
  assert.equal(harness.app.inert, true);
  assert.equal(harness.overlay.inert, true);
  assert.equal(harness.overlay.getAttribute('aria-hidden'), 'true');

  assert.equal(harness.startup.markRuntimeReady(), true);
  assert.equal(harness.updateContinue.disabled, false);
  assert.equal(harness.document.activeElement, harness.updateContinue);
  harness.updateReload.focus();
  harness.updateNotice.dispatch('keydown', { code: 'Tab' });
  assert.equal(harness.document.activeElement, harness.updateContinue);
  harness.updateNotice.dispatch('keydown', { code: 'Tab', shiftKey: true });
  assert.equal(harness.document.activeElement, harness.updateReload);

  let continueHandlerCount = 0;
  harness.startup.registerUpdateContinueHandler(() => {
    continueHandlerCount++;
    return false;
  });
  harness.updateContinue.dispatch('click');
  assert.equal(continueHandlerCount, 1);
  assert.equal(harness.updateNotice.hidden, true);
  assert.equal(harness.startup.isUpdateNoticeActive(), false);
  assert.equal(harness.app.inert, false);
  assert.equal(harness.overlay.inert, false);
  assert.equal(harness.overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(harness.document.activeElement, harness.startButton);
  assert.equal(harness.startup.getDiagnostics().updateNoticeContinueCount, 1);
});

test('fatal recovery atomically removes and permanently disables the continue path', () => {
  const harness = createHarness(activeMarker(Date.now()));
  let continueHandlerCount = 0;
  harness.startup.registerUpdateContinueHandler(() => {
    continueHandlerCount++;
    return true;
  });
  harness.startup.markRuntimeReady();
  harness.startup.showError(new Error('renderer failed'), { code: 'rendering-unavailable' });

  assert.equal(harness.updateNotice.hidden, true);
  assert.equal(harness.updateContinue.disabled, true);
  assert.equal(harness.startupError.hidden, false);
  assert.equal(harness.startupError.getAttribute('aria-hidden'), 'false');
  assert.equal(harness.document.activeElement, harness.startupRetry);
  assert.equal(harness.app.inert, true);
  assert.equal(harness.overlay.inert, true);
  assert.equal(harness.updateNotice.inert, true);
  assert.equal(harness.startupError.inert, false);
  const forwardTab = harness.startupError.dispatch('keydown', { code: 'Tab' });
  assert.equal(forwardTab.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.startupRetry);
  const backwardTab = harness.startupError.dispatch('keydown', { code: 'Tab', shiftKey: true });
  assert.equal(backwardTab.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.startupRetry);
  assert.equal(harness.startup.isUpdateNoticeActive(), false);
  assert.equal(harness.startup.getDiagnostics().updateNoticeFatalSupersedeCount, 1);
  harness.updateContinue.dispatch('click');
  assert.equal(continueHandlerCount, 0);
});
