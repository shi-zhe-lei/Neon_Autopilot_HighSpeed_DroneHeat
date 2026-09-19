/*
 * Neon recoverable minimap rendering errors.
 * Neon 可恢复小地图渲染错误。
 */
(() => {
  'use strict';

  const recoverablePhases = new Set([
    'unknown',
    'presentation',
    'frame-render',
    'frame-buffer-allocation',
    'world-buffer-allocation',
    'world-cache-render'
  ]);

  /**
   * Identify frame-local failures that may be retried without changing route or gameplay authority.
   * Persistent failures are still escalated by the runtime after a bounded retry budget.
   */
  class NeonMinimapRecoverableError extends Error {
    constructor(message, options = {}) {
      super(
        message,
        Object.prototype.hasOwnProperty.call(options, 'cause') ? { cause: options.cause } : undefined
      );
      this.name = 'NeonMinimapRecoverableError';
      this.code = options.code || 'minimap-frame-failure';
      this.phase = options.phase || 'unknown';
      this.recoverable = true;
    }
  }

  function isRecoverable(error) {
    const hasTrustedShape = error?.name === 'NeonMinimapRecoverableError'
      && error?.recoverable === true
      && typeof error?.code === 'string'
      && error.code.startsWith('minimap-')
      && recoverablePhases.has(error?.phase);
    return hasTrustedShape;
  }

  window.NeonMinimapErrors = Object.freeze({
    NeonMinimapRecoverableError,
    isRecoverable
  });
})();
