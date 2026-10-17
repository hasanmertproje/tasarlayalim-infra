import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const wrapper=readFileSync(new URL('../scripts/taso-production-bootstrap.sh',import.meta.url),'utf8');
const blocks=[...wrapper.matchAll(/'''(S3_UUID="\$\(jq -r [\s\S]*?)'''/g)];
assert.equal(blocks.length,2,'S3 bootstrap patch must contain exactly old and new preflight blocks');
const effective=blocks[1][1];
assert.ok(effective.includes('S3_UUID=') && effective.includes('exit 1'));
const line=effective.split('\n').find(x=>x.startsWith('S3_UUID='));
assert.ok(line);

function check(s3) {
  const safePreflight=effective.replace(line,'S3_UUID="$FIXTURE_S3"');
  return spawnSync('bash',['-c','set -Eeuo pipefail\n'+safePreflight+'\nprintf "SAFE_PREFLIGHT_OK"'],
    {encoding:'utf8',timeout:3000,env:{...process.env,FIXTURE_S3:s3}});
}
test('missing S3 blocks all production mutations',()=>{
  const r=check('');
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/No usable S3 backup target/);
  assert.ok(!r.stdout.includes('SAFE_PREFLIGHT_OK'));
});
test('usable S3 may pass initial target preflight but never proves backup restore',()=>{
  const r=check('fixture-s3-id');
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/SAFE_PREFLIGHT_OK/);
});
test('production wrapper may not silently schedule local-only backups',()=>{
  assert.ok(!wrapper.includes('save_s3:false'),'must not allow local-only production backup fallback');
  assert.ok(!wrapper.includes('This first production bootstrap will keep daily local backups'));
});
