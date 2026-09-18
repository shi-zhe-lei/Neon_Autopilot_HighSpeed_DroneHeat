/* V23 whole-page fullscreen control / V23 整页全屏控制。 */
window.NeonV23Fullscreen = (() => {
  'use strict';

  const notice = document.getElementById('fullscreenNotice');
  const target = document.documentElement;
  const i18n = window.NeonV23I18n;
  const legacyButton = document.getElementById('fullscreenBtn');
  const controlButtons = [
    ...new Set([
      ...Array.from(document.querySelectorAll?.('[data-fullscreen-toggle]') || []),
      legacyButton
    ].filter(Boolean))
  ];
  const controls = controlButtons.map((button) => Object.freeze({
    button,
    state: button.querySelector?.('[data-fullscreen-state]')
      || (button === legacyButton ? document.getElementById('fullscreenBtnState') : null)
  }));
  let noticeTimer = null;
  let toggleInFlight = null;
  let currentToggleAttempt = null;

  /** Resolve presentation copy at the final DOM boundary; fullscreen capability state stays language-neutral. */
  function uiText(key, fallback = key, params = {}) {
    return i18n?.t?.(key, params, { fallback })
      || i18n?.translateSource?.(fallback, params)
      || fallback;
  }

  function activeElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function supported() {
    const requestAvailable = Boolean(target.requestFullscreen || target.webkitRequestFullscreen);
    // A defined capability boolean is authoritative; an exposed method may still be blocked by Permissions Policy.
    if (typeof document.fullscreenEnabled === 'boolean') {
      return document.fullscreenEnabled && requestAvailable;
    }
    if (typeof document.webkitFullscreenEnabled === 'boolean') {
      return document.webkitFullscreenEnabled && requestAvailable;
    }
    return requestAvailable;
  }

  /** Preserve each authored control shell while supporting minimal hosts that expose only a plain button. */
  function setButtonState(control, stateKey, stateFallback, buttonKey, buttonFallback) {
    if (control.state) control.state.textContent = uiText(stateKey, stateFallback);
    else control.button.textContent = uiText(buttonKey, buttonFallback);
  }

  function showNotice(messageKey, fallback = messageKey) {
    if (!notice) return;
    clearTimeout(noticeTimer);
    notice.dataset.i18nSource = messageKey;
    notice.dataset.i18nFallback = fallback;
    notice.textContent = uiText(messageKey, fallback);
    notice.hidden = false;
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 4_000);
  }

  /** Keep visual, spoken, and pressed state synchronized when the user exits with Esc or browser chrome. */
  function sync() {
    const available = supported();
    const active = available && Boolean(activeElement());
    for (const control of controls) {
      const { button } = control;
      button.disabled = !available;
      button.classList?.toggle('is-on', active);
      button.setAttribute('aria-pressed', String(active));
      if (!available) {
        button.setAttribute(
          'aria-label',
          uiText('hud.fullscreen.unsupportedAria', '当前浏览器不支持全屏显示')
        );
        setButtonState(
          control,
          'common.unavailable',
          '不可用',
          'hud.fullscreen.unsupportedFallback',
          '不支持全屏'
        );
      } else if (active) {
        button.setAttribute('aria-label', uiText('hud.fullscreen.exitAria', '退出全屏显示'));
        setButtonState(
          control,
          'common.exit',
          '退出',
          'hud.fullscreen.exitFallback',
          '退出全屏'
        );
      } else {
        button.setAttribute('aria-label', uiText('hud.fullscreen.enterAria', '进入全屏显示'));
        setButtonState(
          control,
          'common.enter',
          '进入',
          'hud.fullscreen.enterFallback',
          '全屏显示'
        );
      }
    }
    return active;
  }

  function clearControlErrors() {
    for (const { button } of controls) delete button.dataset.fullscreenError;
  }

  /** Publish one failed attempt to every projection without turning this optional UI capability into gameplay state. */
  function reportFailure(error, messageKey, fallback, attempt = currentToggleAttempt) {
    if (attempt?.failureReported) return false;
    if (attempt) attempt.failureReported = true;
    const errorMessage = String(error?.message || error);
    for (const { button } of controls) button.dataset.fullscreenError = errorMessage;
    showNotice(messageKey, fallback);
    sync();
    return true;
  }

  /** Execute one whole-page transition; callers share this promise while native state is settling. */
  async function performToggle() {
    if (!supported()) throw new Error('Fullscreen API is unavailable in this browser');
    if (activeElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (!exit) throw new Error('Fullscreen exit API is unavailable in this browser');
      await exit.call(document);
    } else {
      const request = target.requestFullscreen || target.webkitRequestFullscreen;
      if (!request) throw new Error('Fullscreen request API is unavailable in this browser');
      await request.call(target);
    }
    clearControlErrors();
    return sync();
  }

  /** Deduplicate rapid activations from either synchronized control before the browser publishes its new state. */
  function toggle() {
    if (toggleInFlight) return toggleInFlight;
    const attempt = { failureReported: false };
    currentToggleAttempt = attempt;
    const operation = performToggle();
    toggleInFlight = operation;
    operation.then(
      () => {
        if (toggleInFlight === operation) toggleInFlight = null;
        if (currentToggleAttempt === attempt) currentToggleAttempt = null;
      },
      (error) => {
        reportFailure(
          error,
          'hud.fullscreen.denied',
          '浏览器拒绝了全屏请求；游戏仍可在当前窗口继续运行。',
          attempt
        );
        if (toggleInFlight === operation) toggleInFlight = null;
      }
    );
    return operation;
  }

  if (controls.length > 0) {
    const onControlClick = () => {
      // A second control activated during the same native transition must not attach another request or rejection path.
      if (toggleInFlight) return;
      toggle().catch((error) => {
        console.error('[V23 fullscreen] Toggle failed.', error);
      });
    };
    for (const { button } of controls) button.addEventListener('click', onControlClick);
    const onFullscreenError = () => {
      const attempt = currentToggleAttempt || { failureReported: false };
      if (!currentToggleAttempt) currentToggleAttempt = attempt;
      reportFailure(
        new Error('Fullscreen request was rejected'),
        'hud.fullscreen.policyDenied',
        '当前页面策略不允许全屏；请在浏览器设置中允许后重试。',
        attempt
      );
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    document.addEventListener('fullscreenerror', onFullscreenError);
    document.addEventListener('webkitfullscreenerror', onFullscreenError);
    i18n?.subscribe?.(() => {
      sync();
      if (notice && !notice.hidden && notice.dataset.i18nSource) {
        notice.textContent = uiText(
          notice.dataset.i18nSource,
          notice.dataset.i18nFallback || notice.dataset.i18nSource
        );
      }
    });
    sync();
  }

  return Object.freeze({ activeElement, supported, sync, toggle, showNotice });
})();
