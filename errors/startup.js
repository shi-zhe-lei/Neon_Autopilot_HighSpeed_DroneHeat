/*
 * V23 startup and storage error boundary.
 * V23 启动与存储错误边界。
 */
(() => {
  'use strict';

  class NeonV23StartupError extends Error {
    constructor(message, options = {}) {
      super(message, options.cause ? { cause: options.cause } : undefined);
      this.name = 'NeonV23StartupError';
      this.code = options.code || 'startup-failure';
    }
  }

  class NeonV23DependencyError extends NeonV23StartupError {
    constructor(message, options = {}) {
      super(message, { ...options, code: options.code || 'dependency-unavailable' });
      this.name = 'NeonV23DependencyError';
    }
  }

  class NeonV23RenderingError extends NeonV23StartupError {
    constructor(message, options = {}) {
      super(message, { ...options, code: options.code || 'rendering-unavailable' });
      this.name = 'NeonV23RenderingError';
    }
  }

  class NeonV23StorageError extends NeonV23StartupError {
    constructor(message, options = {}) {
      super(message, { ...options, code: options.code || 'storage-unavailable' });
      this.name = 'NeonV23StorageError';
    }
  }

  const UPDATE_NOTICE_SCHEMA_VERSION = 1;
  const UPDATE_NOTICE_MAX_LEASE_MS = 6 * 60 * 60 * 1_000;
  const UPDATE_NOTICE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
  const UPDATE_NOTICE_DEBUG_LEASE_MS = 10 * 60 * 1_000;
  const STRICT_UTC_TIMESTAMP_PATTERN = /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
  const UPDATE_NOTICE_FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  const diagnostics = {
    storageReadFailures: 0,
    storageWriteFailures: 0,
    fatalErrorCount: 0,
    lastStorageError: null,
    lastFatalError: null,
    updateMarkerSource: 'unread',
    updateMarkerReason: 'unread',
    updateNoticeShownCount: 0,
    updateNoticeContinueCount: 0,
    updateNoticeReloadCount: 0,
    updateNoticeFatalSupersedeCount: 0,
    updateNoticeActive: false,
    updateRuntimeReady: false,
    updateContinueAvailable: false
  };
  let fatalHandler = null;
  let fatalPresented = false;
  let updateNoticeActive = false;
  let updateRuntimeReady = false;
  let updateContinueHandler = null;
  let updateReturnFocus = null;
  const updateBackgroundInertStates = new Map();
  const fatalBackgroundInertStates = new Map();

  function errorMessage(error) {
    return String(error?.message || error || 'Unknown startup failure');
  }

  /**
   * Retain browser source metadata only when the caller supplied a real value; absent metadata keeps the legacy
   * three-field diagnostics contract intact. 仅在存在真实来源信息时扩展诊断，避免用伪造位置污染旧契约。
   */
  function fatalSourceMetadata(error, options = {}) {
    const metadata = {};
    const filename = [options.filename, error?.fileName, error?.filename]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    const line = [options.line, options.lineno, error?.lineNumber, error?.line]
      .find((value) => Number.isFinite(value) && value > 0);
    const column = [options.column, options.colno, error?.columnNumber, error?.column]
      .find((value) => Number.isFinite(value) && value > 0);
    const stack = [options.stack, error?.stack]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    if (filename) metadata.filename = filename;
    if (Number.isFinite(line)) metadata.line = line;
    if (Number.isFinite(column)) metadata.column = column;
    if (stack) metadata.stack = stack;
    return metadata;
  }

  /** Keep the visible recovery details copyable so file:// failures retain their only actionable source evidence. */
  function fatalDetailsText(code, error, metadata) {
    const lines = [`${code}: ${errorMessage(error)}`];
    if (metadata.filename) lines.push(`filename: ${metadata.filename}`);
    if (Number.isFinite(metadata.line)) lines.push(`line: ${metadata.line}`);
    if (Number.isFinite(metadata.column)) lines.push(`column: ${metadata.column}`);
    if (metadata.stack) lines.push(`stack:\n${metadata.stack}`);
    return lines.join('\n');
  }

  /** Bind early-startup copy to stable keys so the later i18n bootstrap can reapply it in either language. */
  function writeLocalizedText(element, key, parameters, fallback) {
    if (!element) return;
    const normalizedParameters = parameters && typeof parameters === 'object' ? parameters : {};
    element.setAttribute('data-i18n', key);
    if (Object.keys(normalizedParameters).length > 0) {
      element.setAttribute('data-i18n-params', JSON.stringify(normalizedParameters));
    } else {
      element.removeAttribute?.('data-i18n-params');
    }
    const i18n = window.NeonV23I18n;
    element.textContent = typeof i18n?.t === 'function'
      ? i18n.t(key, normalizedParameters, { fallback })
      : fallback;
  }

  /** Custom runtime copy may already be localized; translate known catalog sources without claiming a stable key. */
  function writeLocalizedSource(element, source) {
    if (!element) return;
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    const i18n = window.NeonV23I18n;
    element.textContent = typeof i18n?.translateSource === 'function'
      ? i18n.translateSource(source)
      : String(source ?? '');
  }

  function classifyMessage(error) {
    const message = errorMessage(error);
    if (error?.code === 'file-script-opaque-error') {
      return Object.freeze({
        key: 'error.windowsLocalFile',
        fallback: 'Windows 浏览器隔离了直接打开的本地脚本，真实错误无法可靠读取。请在游戏目录双击“启动Windows本地游戏.cmd”；启动器会先检查文件完整性，再仅在本机打开游戏。'
      });
    }
    if (/webgl|context|renderer/i.test(message)) {
      return Object.freeze({
        key: 'error.webgl',
        fallback: '浏览器无法创建网页三维图形环境。请开启硬件加速、更新浏览器或更换支持网页三维图形的设备后重试。'
      });
    }
    if (/three|dependency|module/i.test(message)) {
      return Object.freeze({
        key: 'error.dependency',
        fallback: '游戏核心依赖未能加载。请确认游戏目录完整，然后重新加载页面。'
      });
    }
    return Object.freeze({
      key: 'error.initialization',
      fallback: '游戏初始化未完成。请重新加载页面；若问题持续，请检查浏览器图形能力和游戏文件完整性。'
    });
  }

  function inactiveUpdateState(reason, status = {}) {
    return Object.freeze({
      active: false,
      source: 'release-marker',
      reason,
      noticeId: typeof status.noticeId === 'string' ? status.noticeId : null,
      issuedAt: typeof status.issuedAt === 'string' ? status.issuedAt : null,
      expiresAt: typeof status.expiresAt === 'string' ? status.expiresAt : null
    });
  }

  /** Parse only real calendar instants with an explicit UTC suffix so every player resolves one identical lease. */
  function parseStrictUtcTimestamp(value) {
    const match = typeof value === 'string' ? STRICT_UTC_TIMESTAMP_PATTERN.exec(value) : null;
    if (!match) return Number.NaN;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return Number.NaN;
    const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > maximumDay) return Number.NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  /**
   * Accept only a bounded UTC update lease so malformed or abandoned markers never trap players indefinitely.
   * 仅接受有界 UTC 更新租约，畸形或遗留标记不得无限期阻塞玩家。
   */
  function resolveUpdateNoticeStatus(status, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    if (options.debugForced === true) {
      return Object.freeze({
        active: true,
        source: 'model-debug',
        reason: 'debug-forced',
        noticeId: 'model-debug-update-notice',
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + UPDATE_NOTICE_DEBUG_LEASE_MS).toISOString()
      });
    }
    if (!status || typeof status !== 'object' || Array.isArray(status)) {
      return inactiveUpdateState('missing-marker');
    }
    if (status.schemaVersion !== UPDATE_NOTICE_SCHEMA_VERSION) {
      return inactiveUpdateState('unsupported-schema', status);
    }
    if (status.state === 'stable') return inactiveUpdateState('stable', status);
    if (status.state !== 'updating') return inactiveUpdateState('invalid-state', status);
    if (typeof status.noticeId !== 'string' || status.noticeId.trim().length === 0) {
      return inactiveUpdateState('invalid-notice-id', status);
    }
    const issuedAtMs = parseStrictUtcTimestamp(status.issuedAt);
    const expiresAtMs = parseStrictUtcTimestamp(status.expiresAt);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
      return inactiveUpdateState('invalid-timestamps', status);
    }
    if (issuedAtMs > nowMs + UPDATE_NOTICE_CLOCK_SKEW_MS) {
      return inactiveUpdateState('future-lease', status);
    }
    if (expiresAtMs <= nowMs) return inactiveUpdateState('expired-lease', status);
    const durationMs = expiresAtMs - issuedAtMs;
    if (durationMs <= 0 || durationMs > UPDATE_NOTICE_MAX_LEASE_MS) {
      return inactiveUpdateState('invalid-lease-duration', status);
    }
    return Object.freeze({
      active: true,
      source: 'release-marker',
      reason: 'active-lease',
      noticeId: status.noticeId.trim(),
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
  }

  /** Parse the inert JSON marker without adding a file:// fetch or a pre-boundary executable dependency. */
  function readUpdateNoticeStatus() {
    let status = null;
    let parseReason = null;
    try {
      const source = document.getElementById('releaseStatus')?.textContent || '';
      status = source.trim() ? JSON.parse(source) : null;
    } catch (_error) {
      parseReason = 'malformed-json';
    }
    let debugForced = false;
    try {
      const params = new URLSearchParams(window.location?.search || '');
      debugForced = params.get('modelDebug') === '1' && params.get('updateNotice') === '1';
    } catch (_error) {
      // URL parsing is optional; a broken audit query must not turn a stable release into maintenance mode.
    }
    const resolved = resolveUpdateNoticeStatus(status, { debugForced });
    diagnostics.updateMarkerSource = resolved.source;
    diagnostics.updateMarkerReason = parseReason || resolved.reason;
    return parseReason && !debugForced ? inactiveUpdateState(parseReason) : resolved;
  }

  /** Make the update dialog the only interactive subtree while retaining each background node's prior inert state. */
  function lockUpdateBackground(root) {
    const children = Array.from(document.body?.children || []);
    for (const node of children) {
      if (node === root || node.id === 'startupError' || node.tagName === 'SCRIPT') continue;
      if (!updateBackgroundInertStates.has(node)) updateBackgroundInertStates.set(node, Boolean(node.inert));
      node.inert = true;
    }
  }

  function restoreUpdateBackground() {
    for (const [node, wasInert] of updateBackgroundInertStates) {
      if (node?.isConnected !== false) node.inert = wasInert;
    }
    updateBackgroundInertStates.clear();
  }

  /** Fatal recovery is terminal for this document, so every sibling stays inert until Reload replaces the page. */
  function lockFatalBackground(root) {
    const children = Array.from(document.body?.children || []);
    for (const node of children) {
      if (node === root || node.tagName === 'SCRIPT') continue;
      if (!fatalBackgroundInertStates.has(node)) fatalBackgroundInertStates.set(node, Boolean(node.inert));
      node.inert = true;
    }
  }

  function updateFocusableElements(root) {
    return Array.from(root?.querySelectorAll?.(UPDATE_NOTICE_FOCUSABLE_SELECTOR) || []).filter((node) => (
      !node.hidden && !node.disabled
    ));
  }

  /** Show the warning immediately, but withhold continuation until main publishes a successful first-frame boundary. */
  function showUpdateNotice(status) {
    const root = document.getElementById('updateNotice');
    if (!root || fatalPresented || !status?.active || updateNoticeActive) return false;
    const continueButton = document.getElementById('updateContinueBtn');
    const reloadButton = document.getElementById('updateReloadBtn');
    const state = document.getElementById('updateNoticeStatus');
    const details = document.getElementById('updateNoticeDetails');
    updateReturnFocus = document.activeElement;
    updateNoticeActive = true;
    diagnostics.updateNoticeActive = true;
    diagnostics.updateContinueAvailable = false;
    diagnostics.updateNoticeShownCount++;
    if (continueButton) continueButton.disabled = true;
    writeLocalizedText(state, 'update.checking', {}, '正在确认游戏是否可以正常运行……');
    const detailKey = status.source === 'model-debug'
      ? 'update.details.modelDebug'
      : 'update.details.releaseMarker';
    const detailFallback = status.source === 'model-debug'
      ? `调试模式：${status.noticeId} · 有效至 ${status.expiresAt}`
      : `版本标记：${status.noticeId} · 有效至 ${status.expiresAt}`;
    writeLocalizedText(details, detailKey, {
      noticeId: status.noticeId,
      expiresAt: status.expiresAt
    }, detailFallback);
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    document.body?.classList?.add('update-notice-open');
    document.getElementById('overlay')?.setAttribute('aria-hidden', 'true');
    lockUpdateBackground(root);
    requestAnimationFrame(() => (updateRuntimeReady ? continueButton : reloadButton)?.focus({ preventScroll: true }));
    return true;
  }

  function hideUpdateNotice(options = {}) {
    const root = document.getElementById('updateNotice');
    const continueButton = document.getElementById('updateContinueBtn');
    const wasActive = updateNoticeActive;
    updateNoticeActive = false;
    diagnostics.updateNoticeActive = false;
    diagnostics.updateContinueAvailable = false;
    if (continueButton) continueButton.disabled = true;
    if (root) {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
    }
    document.body?.classList?.remove('update-notice-open');
    restoreUpdateBackground();
    const overlay = document.getElementById('overlay');
    if (!fatalPresented && overlay) {
      overlay.setAttribute('aria-hidden', overlay.style?.display === 'none' ? 'true' : 'false');
    }
    if (options.restoreFocus && !fatalPresented) {
      const focusTarget = updateReturnFocus && updateReturnFocus.isConnected !== false
        ? updateReturnFocus
        : document.getElementById('startBtn');
      requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    }
    return wasActive;
  }

  /** Fatal recovery atomically removes the reversible notice and permanently disables its continue control. */
  function supersedeUpdateNoticeForFatal() {
    const wasActive = updateNoticeActive;
    hideUpdateNotice({ restoreFocus: false });
    updateContinueHandler = null;
    if (wasActive) diagnostics.updateNoticeFatalSupersedeCount++;
  }

  /** Main calls this only after dependency checks, shader compilation, first render, and initial animation setup succeed. */
  function markRuntimeReady() {
    if (fatalPresented) return false;
    updateRuntimeReady = true;
    diagnostics.updateRuntimeReady = true;
    if (!updateNoticeActive) return true;
    const continueButton = document.getElementById('updateContinueBtn');
    const state = document.getElementById('updateNoticeStatus');
    if (continueButton) continueButton.disabled = false;
    writeLocalizedText(
      state,
      'update.ready',
      {},
      '运行检查已通过。你可以继续进入开始页，或重新加载以获取最新文件。'
    );
    diagnostics.updateContinueAvailable = true;
    requestAnimationFrame(() => continueButton?.focus({ preventScroll: true }));
    return true;
  }

  function isUpdateNoticeActive() {
    return updateNoticeActive && !fatalPresented;
  }

  /** Autostart fixtures may defer their explicit launch until the player accepts the active update notice. */
  function registerUpdateContinueHandler(handler) {
    if (typeof handler !== 'function') throw new TypeError('Update continue handler must be a function');
    updateContinueHandler = handler;
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      if (updateContinueHandler === handler) updateContinueHandler = null;
      return true;
    };
  }

  function continueAfterUpdate() {
    const continueButton = document.getElementById('updateContinueBtn');
    if (fatalPresented || !updateNoticeActive || !updateRuntimeReady || continueButton?.disabled) return false;
    const handler = updateContinueHandler;
    hideUpdateNotice({ restoreFocus: false });
    diagnostics.updateNoticeContinueCount++;
    let handlerOwnsFocus = false;
    try {
      handlerOwnsFocus = handler?.() === true;
    } catch (error) {
      handleFatal(error, {
        code: 'update-continue-failed',
        message: '继续游戏时发生错误，已切换为安全恢复模式。请重新加载页面。'
      });
      return false;
    }
    if (!handlerOwnsFocus) {
      const focusTarget = document.getElementById('startBtn') || updateReturnFocus;
      requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    }
    return true;
  }

  function handleUpdateNoticeKeydown(event) {
    if (!updateNoticeActive) return;
    event.stopPropagation();
    if (event.code === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.code !== 'Tab') return;
    const focusable = updateFocusableElements(document.getElementById('updateNotice'));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  /** Keep early-startup and runtime fatal recovery on the same single-action focus contract. */
  function handleFatalRecoveryKeydown(event) {
    if (!fatalPresented) return;
    event.stopPropagation();
    if (event.code === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.code !== 'Tab') return;
    const focusable = updateFocusableElements(document.getElementById('startupError'));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const activeIndex = focusable.indexOf(document.activeElement);
    if (activeIndex < 0 || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  /** Inert handles native focus; this capture guard also rejects synthetic gameplay events during the update decision. */
  function blockUpdateInteraction(event) {
    if (!updateNoticeActive || fatalPresented) return;
    const insideNotice = Boolean(event.target?.closest?.('#updateNotice'));
    if (insideNotice) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** The startup boundary itself must isolate early failures before main can register its runtime guard. */
  function blockFatalInteraction(event) {
    if (!fatalPresented) return;
    const insideRecovery = Boolean(event.target?.closest?.('#startupError'));
    if (insideRecovery) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /**
   * Replace the inert launch card with one focusable recovery surface.
   * 用一个可聚焦的恢复界面替换无法操作的假启动页。
   */
  function showError(error, options = {}) {
    fatalPresented = true;
    supersedeUpdateNoticeForFatal();
    const root = document.getElementById('startupError');
    if (!root) return false;
    const title = document.getElementById('startupErrorTitle');
    const message = document.getElementById('startupErrorMessage');
    const details = document.getElementById('startupErrorDetails');
    const retryButton = document.getElementById('startupRetryBtn');
    const normalized = error instanceof Error
      ? error
      : new NeonV23StartupError(errorMessage(error), { code: options.code });
    const code = options.code || normalized.code || 'startup-failure';

    diagnostics.fatalErrorCount++;
    const sourceMetadata = fatalSourceMetadata(error, options);
    diagnostics.lastFatalError = Object.freeze({
      code,
      name: normalized.name || 'Error',
      message: errorMessage(normalized),
      ...sourceMetadata
    });
    if (options.title) writeLocalizedSource(title, options.title);
    else writeLocalizedText(title, 'error.title', {}, '游戏暂时无法启动');
    if (options.message) {
      writeLocalizedSource(message, options.message);
    } else {
      const classified = classifyMessage(normalized);
      writeLocalizedText(message, classified.key, {}, classified.fallback);
    }
    if (details) details.textContent = fatalDetailsText(code, normalized, sourceMetadata);
    // Fatal recovery supersedes both reversible entry surfaces, including failures raised before main registers.
    const startupLoading = document.getElementById('startupLoading');
    if (startupLoading) {
      startupLoading.hidden = true;
      startupLoading.inert = true;
      startupLoading.setAttribute('aria-hidden', 'true');
      startupLoading.setAttribute('aria-busy', 'false');
    }
    const launchOverlay = document.getElementById('overlay');
    if (launchOverlay) {
      launchOverlay.hidden = true;
      launchOverlay.inert = true;
      launchOverlay.style.display = 'none';
      launchOverlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('startup-loading-open', 'launch-overlay-open');
    document.body.classList.add('startup-failed');
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    lockFatalBackground(root);
    requestAnimationFrame(() => (retryButton || title)?.focus({ preventScroll: true }));
    return true;
  }

  function readFiniteNonNegativeNumber(key, fallback = 0) {
    try {
      const value = Number(window.localStorage?.getItem?.(key));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (error) {
      diagnostics.storageReadFailures++;
      diagnostics.lastStorageError = errorMessage(error);
      console.warn('[V23 storage] Unable to read persistent data; session play remains available.', error);
      return fallback;
    }
  }

  /** Read one persisted string without letting denied browser storage block startup or language selection. */
  function readString(key, fallback = '') {
    try {
      const value = window.localStorage?.getItem?.(key);
      return typeof value === 'string' ? value : fallback;
    } catch (error) {
      diagnostics.storageReadFailures++;
      diagnostics.lastStorageError = errorMessage(error);
      console.warn('[V23 storage] Unable to read persistent data; session play remains available.', error);
      return fallback;
    }
  }

  function writeString(key, value) {
    try {
      window.localStorage?.setItem?.(key, String(value));
      return true;
    } catch (error) {
      diagnostics.storageWriteFailures++;
      diagnostics.lastStorageError = errorMessage(error);
      console.warn('[V23 storage] Unable to persist data; the current result remains visible.', error);
      return false;
    }
  }

  function getDiagnostics() {
    return Object.freeze({ ...diagnostics });
  }

  /**
   * Register the runtime-owned fatal boundary after initialization has enough state to stop safely.
   * 初始化早期没有处理器时，启动模块仍直接展示恢复界面。
   */
  function registerFatalHandler(handler) {
    if (typeof handler !== 'function') throw new TypeError('Fatal handler must be a function');
    fatalHandler = handler;
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      if (fatalHandler === handler) fatalHandler = null;
      return true;
    };
  }

  /** Delegate only after main has registered its stop contract; otherwise initialization owns direct recovery. */
  function handleFatal(error, options = {}) {
    if (!fatalHandler) return showError(error, options);
    try {
      const handled = fatalHandler(error, options);
      return handled === false ? showError(error, options) : true;
    } catch (handlerError) {
      console.error('[V23 startup] Fatal handler failed; falling back to the startup recovery surface.', handlerError);
      return showError(error, options);
    }
  }

  /**
   * Recover actionable identity from local-file failures without pretending Edge's sanitized 0/0 is a source line.
   * Windows Edge treats external file:// scripts as opaque origins, so the supported launcher uses loopback HTTP.
   */
  function normalizeGlobalErrorEvent(event) {
    const resourceTarget = event?.target?.tagName === 'SCRIPT' ? event.target : null;
    const activeScriptSource = resourceTarget?.src || document.currentScript?.src || '';
    if (resourceTarget) {
      return Object.freeze({
        error: new NeonV23DependencyError(
          `Script resource failed to load: ${activeScriptSource || 'unknown local script'}`,
          { code: 'script-resource-load-failed' }
        ),
        options: activeScriptSource ? { filename: activeScriptSource } : {}
      });
    }

    const sanitizedFileScriptError = window.location?.protocol === 'file:'
      && !event?.error
      && /^Script error\.?$/i.test(String(event?.message || '').trim());
    if (sanitizedFileScriptError) {
      return Object.freeze({
        error: new NeonV23StartupError(
          'Windows local-file script failure was hidden by browser origin isolation; use 启动Windows本地游戏.cmd.',
          { code: 'file-script-opaque-error' }
        ),
        options: activeScriptSource ? { filename: activeScriptSource } : {}
      });
    }

    const options = {};
    if (typeof event?.filename === 'string' && event.filename) options.filename = event.filename;
    if (Number.isFinite(event?.lineno) && event.lineno > 0) options.line = event.lineno;
    if (Number.isFinite(event?.colno) && event.colno > 0) options.column = event.colno;
    return Object.freeze({
      error: event?.error || new NeonV23StartupError(event?.message || 'Uncaught startup error'),
      options
    });
  }

  window.addEventListener('error', (event) => {
    const normalized = normalizeGlobalErrorEvent(event);
    const error = normalized.error;
    const normalizedBoundaryCode = error?.code === 'file-script-opaque-error'
      || error?.code === 'script-resource-load-failed'
      ? error.code
      : null;
    handleFatal(error, {
      ...(fatalHandler ? { code: normalizedBoundaryCode || 'runtime-uncaught-error' } : {}),
      ...normalized.options
    });
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    handleFatal(
      event.reason || new NeonV23StartupError('Unhandled startup rejection'),
      fatalHandler ? { code: 'runtime-unhandled-rejection' } : {}
    );
  });
  document.getElementById('updateNotice')?.addEventListener('keydown', handleUpdateNoticeKeydown);
  document.getElementById('startupError')?.addEventListener('keydown', handleFatalRecoveryKeydown);
  document.getElementById('updateContinueBtn')?.addEventListener('click', continueAfterUpdate);
  document.getElementById('updateReloadBtn')?.addEventListener('click', () => {
    diagnostics.updateNoticeReloadCount++;
    window.location.reload();
  });
  for (const eventType of [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'touchstart',
    'touchend',
    'click',
    'keydown',
    'keyup'
  ]) {
    document.addEventListener(eventType, blockUpdateInteraction, { capture: true, passive: false });
    document.addEventListener(eventType, blockFatalInteraction, { capture: true, passive: false });
  }
  document.getElementById('startupRetryBtn')?.addEventListener('click', () => window.location.reload());

  window.NeonV23Errors = Object.freeze({
    NeonV23StartupError,
    NeonV23DependencyError,
    NeonV23RenderingError,
    NeonV23StorageError
  });
  window.NeonV23Startup = Object.freeze({
    showError,
    registerFatalHandler,
    registerUpdateContinueHandler,
    markRuntimeReady,
    isUpdateNoticeActive,
    resolveUpdateNoticeStatus,
    readFiniteNonNegativeNumber,
    readString,
    writeString,
    getDiagnostics
  });
  const initialUpdateStatus = readUpdateNoticeStatus();
  if (initialUpdateStatus.active) showUpdateNotice(initialUpdateStatus);
})();
