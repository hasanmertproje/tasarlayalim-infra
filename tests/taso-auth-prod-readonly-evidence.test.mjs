import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../scripts/taso-auth-prod-readonly-evidence.mjs';
test('classifies decryption failure without returning raw log secrets',()=>{
 const input=[
  '{"time":1793178900000,"level":50,"err":{"message":"Unsupported state or unable to authenticate data"},"private":"do-not-publish-this-secret"}',
  '2026-10-28T07:15:02Z auth.trusted_device_persist_failed EACCES /data/taso-auth-security.json',
  '2026-10-28T07:15:03Z /auth/2fa/verify 500',
 ].join('\n');
 const s=analyze(input);
 assert.equal(s.summary.totp_decrypt,1);
 assert.equal(s.summary.security_storage,1);
 assert.equal(s.summary.auth_verify,1);
 assert.equal(s.summary.server_500,1);
 assert.equal(s.windowCounts.security_storage,1);
 assert.equal(s.rows,3);
 assert.doesNotMatch(JSON.stringify(s),/do-not-publish-this-secret|\/data\/taso-auth-security\.json/);
});
test('empty log and non-auth errors report no false positive',()=>{
 const s=analyze('2026-10-28T07:15:03Z normal request complete');
 assert.equal(s.summary.totp_decrypt,0);
 assert.equal(s.summary.security_storage,0);
 assert.equal(s.summary.auth_verify,0);
 assert.equal(s.summary.server_500,0);
});
