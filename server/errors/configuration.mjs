/**
 * Fail startup before opening a socket when the bind address, port, subnet, or static root weakens the LAN-only contract.
 */
export class LanServerConfigurationError extends Error {
  constructor(message, options = undefined) {
    super(message, options);
    this.name = 'LanServerConfigurationError';
    this.code = 'LAN_SERVER_CONFIGURATION_ERROR';
  }
}
