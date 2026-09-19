import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { selectLanBinding } from './lan-machine.mjs';
import { isClientAllowed, isHostAllowed, parseServerConfig } from './lan-static-server.mjs';

const route = (interfaceName, gateway) => `   route to: default\n    gateway: ${gateway}\n  interface: ${interfaceName}\n`;
const address = (host, netmask = '255.255.255.0') => ({
  address: host,
  family: 'IPv4',
  internal: false,
  netmask
});

describe('portable LAN binding', () => {
  test('derives the active private subnet and gateway block from a relocated computer', () => {
    const binding = selectLanBinding(route('en7', '10.42.7.1'), {
      en7: [address('10.42.7.83')]
    });
    assert.deepEqual(binding, {
      gateway: '10.42.7.1',
      host: '10.42.7.83',
      interfaceName: 'en7',
      network: '10.42.7.0/24'
    });
    const config = parseServerConfig({}, {
      deniedClients: binding.gateway,
      host: binding.host,
      network: binding.network,
      port: 8_088
    });
    assert.equal(isClientAllowed('10.42.7.1', config), false);
    assert.equal(isClientAllowed('10.42.7.90', config), true);
    assert.equal(isClientAllowed('10.42.8.90', config), false);
    assert.equal(isHostAllowed('10.42.7.83:8088', config), true);
    assert.equal(isHostAllowed('10.42.7.90:8088', config), false);
  });

  test('selects the IPv4 alias sharing the gateway and accepts Wi-Fi hardware names', () => {
    const binding = selectLanBinding(route('en0', '172.20.5.1'), {
      en0: [address('192.168.8.15'), address('172.20.5.25')]
    });
    assert.equal(binding.host, '172.20.5.25');
    assert.equal(binding.network, '172.20.5.0/24');
  });

  test('rejects VPN, public, broad, and ambiguous routes before listening', () => {
    assert.throws(() => selectLanBinding(route('utun3', '10.0.0.1'), {
      utun3: [address('10.0.0.3')]
    }), /physical en\*/);
    assert.throws(() => selectLanBinding(route('en0', '203.0.113.1'), {
      en0: [address('203.0.113.7')]
    }), /private IPv4/);
    assert.throws(() => selectLanBinding(route('en0', '10.0.0.1'), {
      en0: [address('10.0.0.7', '255.0.0.0')]
    }), /Expected one private IPv4/);
    assert.throws(() => selectLanBinding(route('en0', '192.168.1.1'), {
      en0: [address('192.168.1.10'), address('192.168.1.11')]
    }), /Expected one private IPv4/);
  });
});
