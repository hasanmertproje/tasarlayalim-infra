import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../scripts/taso-production-deploy.sh',import.meta.url),'utf8');
const from=source.indexOf('is_unusable_production_secret()');
const to=source.indexOf('browserkey="$(reuse',from);
assert.ok(from>0&&to>from,'secret preservation guard must precede worker bootstrap');
const block=source.slice(from,to);

function fixture({existing=true,gateway='',authkey=''}) {
  const script = [
    'set -Eeuo pipefail',
    'cf=fixture',
    'core_preexisting=' + (existing?'true':'false'),
    'reuse() { case "$2" in TASO_GATEWAY_SECRET) printf "%s" "$FIXTURE_GATEWAY";; TASO_AUTH_ENCRYPTION_KEY) printf "%s" "$FIXTURE_AUTH";; esac; }',
    'openssl() { printf "%s" "generated-fixture"; }',
    block,
    'printf "OK:%s:%s" "$gateway" "$authkey"',
  ].join('\n');
  return spawnSync('bash',['-c',script],{encoding:'utf8',timeout:3000,
    env:{...process.env,FIXTURE_GATEWAY:gateway,FIXTURE_AUTH:authkey}});
}
test('existing Core without readable gateway refuses key generation',()=>{
  const r=fixture({gateway:'',authkey:'already-configured'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/refusing automatic rotation/);
  assert.ok(!r.stdout.includes('generated-fixture'));
});
test('existing Core without readable encryption key refuses key generation',()=>{
  const r=fixture({gateway:'already-configured',authkey:''});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/refusing automatic rotation/);
  assert.ok(!r.stdout.includes('generated-fixture'));
});
test('masked gateway and encrypted auth entries never become effective secrets',()=>{
  for(const masked of ['********','masked','[hidden]','<hidden>','redacted','   ']){
    const r=fixture({gateway:masked,authkey:'already-configured'});
    assert.notEqual(r.status,0);
    assert.ok(!r.stdout.includes('OK:'));
  }
});
test('existing valid Core secrets are preserved without regeneration',()=>{
  const r=fixture({gateway:'gateway-fixture',authkey:'encryption-fixture'});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout,'OK:gateway-fixture:encryption-fixture');
});
test('first-ever Core can bootstrap new generated secrets',()=>{
  const r=fixture({existing:false,gateway:'',authkey:''});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout,'OK:generated-fixture:generated-fixture');
});
