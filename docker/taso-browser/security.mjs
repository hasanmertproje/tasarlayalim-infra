import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const denied = new BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) denied.addSubnet(subnet, prefix, 'ipv4');
for (const [subnet, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['::ffff:0:0', 96], ['64:ff9b::', 96], ['2001:db8::', 32], ['2001::', 23], ['2002::', 16],
]) denied.addSubnet(subnet, prefix, 'ipv6');

export function assertPublicAddress(address) {
  const family = isIP(address);
  if (!family || denied.check(address, family === 4 ? 'ipv4' : 'ipv6')) {
    throw new Error('Private, reserved, or invalid network address is not allowed.');
  }
}

export function parseTarget(raw, allowHosts) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https targets are allowed.');
  if (url.username || url.password) throw new Error('URL credentials are not allowed.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) throw new Error('IP address targets are not allowed.');
  if (!allowHosts.has(host)) throw new Error('Host is not allowlisted.');
  return url;
}

export async function validateTarget(raw, allowHosts) {
  const url = parseTarget(raw, allowHosts);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Target hostname did not resolve.');
  for (const record of addresses) assertPublicAddress(record.address);
  return url;
}
