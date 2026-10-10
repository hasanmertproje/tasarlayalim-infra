import assert from 'node:assert/strict';
import test from 'node:test';
import { htmlToText, isPrivateAddress } from '../src/web-research.js';

test('htmlToText removes executable markup and keeps readable text', () => {
  const parsed = htmlToText('<html><head><title>Taso &amp; Web</title><style>.x{}</style></head><body><h1>Başlık</h1><script>alert(1)</script><p>Metin &amp; detay</p></body></html>');
  assert.equal(parsed.title, 'Taso & Web');
  assert.match(parsed.text, /Başlık/);
  assert.match(parsed.text, /Metin & detay/);
  assert.doesNotMatch(parsed.text, /alert/);
});

test('private and loopback network addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.4.2', '192.168.1.2', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});
