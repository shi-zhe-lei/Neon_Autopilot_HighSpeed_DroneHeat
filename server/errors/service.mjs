/** Fail a launchd operation with the target and cause instead of hiding an incomplete service transition. */
export class LanServiceError extends Error {
  constructor(message, options = undefined) {
    super(message, options);
    this.name = 'LanServiceError';
    this.code = 'LAN_SERVICE_ERROR';
  }
}
