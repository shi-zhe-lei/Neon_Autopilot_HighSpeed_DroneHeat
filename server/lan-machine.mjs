/** Discover a single private hardware LAN route before the HTTP server opens a socket. */
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

import { LanServerConfigurationError } from './errors/configuration.mjs';

function ipv4Value(address) {
  if (typeof address !== 'string') return null;
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) return null;
  const bytes = parts.map(Number);
  if (bytes.some((byte) => byte > 255)) return null;
  return bytes.reduce((value, byte) => ((value * 256) + byte) >>> 0, 0);
}

function ipv4Text(value) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function isPrivateAddress(value) {
  return (value >>> 24) === 10
    || (value >>> 20) === 0xac1
    || (value >>> 16) === 0xc0a8;
}

function networkMask(netmask) {
  const value = ipv4Value(netmask);
  if (value === null) return null;
  let prefix = 0;
  let foundZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if ((value >>> bit) & 1) {
      if (foundZero) return null;
      prefix += 1;
    } else {
      foundZero = true;
    }
  }
  return { prefix, value };
}

/** Select the default hardware interface and its actual IPv4 subnet; reject VPN, public, and broad routes. */
export function selectLanBinding(routeText, interfaces) {
  const interfaceName = /^\s*interface:\s*(\S+)\s*$/m.exec(routeText)?.[1];
  const gateway = /^\s*gateway:\s*(\S+)\s*$/m.exec(routeText)?.[1];
  const gatewayValue = ipv4Value(gateway);
  if (!/^en\d+$/.test(interfaceName ?? '')) {
    throw new LanServerConfigurationError('Default route must use a physical en* LAN or Wi-Fi interface.');
  }
  if (gatewayValue === null || !isPrivateAddress(gatewayValue)) {
    throw new LanServerConfigurationError('Default gateway must be a private IPv4 address.');
  }

  const candidates = (interfaces[interfaceName] ?? []).filter((entry) => {
    if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4)) return false;
    const hostValue = ipv4Value(entry.address);
    const mask = networkMask(entry.netmask);
    return hostValue !== null
      && isPrivateAddress(hostValue)
      && mask !== null
      && mask.prefix >= 16
      && mask.prefix <= 30
      && ((hostValue & mask.value) >>> 0) === ((gatewayValue & mask.value) >>> 0)
      && hostValue !== gatewayValue;
  });
  if (candidates.length !== 1) {
    throw new LanServerConfigurationError(
      `Expected one private IPv4 address on ${interfaceName} sharing the default gateway subnet.`
    );
  }

  const host = candidates[0].address;
  const mask = networkMask(candidates[0].netmask);
  const baseValue = (ipv4Value(host) & mask.value) >>> 0;
  const broadcastValue = (baseValue | (~mask.value >>> 0)) >>> 0;
  if (ipv4Value(host) === baseValue || ipv4Value(host) === broadcastValue) {
    throw new LanServerConfigurationError('LAN host cannot be the network or broadcast address.');
  }
  return Object.freeze({
    gateway,
    host,
    interfaceName,
    network: `${ipv4Text(baseValue)}/${mask.prefix}`
  });
}

/** Read macOS routing state at each launch so copied projects and DHCP changes use this computer's network. */
export function discoverMacLanBinding(environment = process.env) {
  if (process.platform !== 'darwin') {
    throw new LanServerConfigurationError('Automatic LAN discovery requires macOS.');
  }
  const preferred = environment.NEON_LAN_INTERFACE;
  if (preferred !== undefined && !/^en\d+$/.test(preferred)) {
    throw new LanServerConfigurationError('NEON_LAN_INTERFACE must name a physical en* interface.');
  }
  const arguments_ = ['-n', 'get', ...(preferred ? ['-ifscope', preferred] : []), 'default'];
  let routeText;
  try {
    routeText = execFileSync('/sbin/route', arguments_, { encoding: 'utf8' });
  } catch (error) {
    throw new LanServerConfigurationError('Unable to read the default LAN route.', { cause: error });
  }
  return selectLanBinding(routeText, networkInterfaces());
}
