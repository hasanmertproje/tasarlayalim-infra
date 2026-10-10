import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicAddress, parseTarget } from './security.mjs';

test('rejects loopback, private, link-local, and reserved IPv4 ranges', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1']) {
    assert.throws(() => assertPublicAddress(address), address);
  }
});

test('rejects loopback, unique-local, link-local, and reserved IPv6 ranges', () => {
  for (const address of ['::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe', '::']) {
    assert.throws(() => assertPublicAddress(address), address);
  }
});

test('allows a public address', () => {
  assert.doesNotThrow(() => assertPublicAddress('1.1.1.1'));
});

test('allows only allowlisted HTTP(S) hostnames without credentials', () => {
  const hosts = new Set(['tasarlayalim.com']);
  assert.equal(parseTarget('https://tasarlayalim.com/', hosts).hostname, 'tasarlayalim.com');
  assert.throws(() => parseTarget('http://127.0.0.1/', hosts), /IP address/);
  assert.throws(() => parseTarget('http://not-allowed.example/', hosts), /allowlisted/);
  assert.throws(() => parseTarget('https://user:pass@tasarlayalim.com/', hosts), /credentials/);
});
