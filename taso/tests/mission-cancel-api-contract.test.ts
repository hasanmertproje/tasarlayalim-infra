import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../src/server.js';

test('cancel API distinguishes missing mission and idempotent cancelled mission', async () => {
  const app=buildServer();
  const headers=process.env.TASO_GATEWAY_SECRET?{'x-taso-gateway':process.env.TASO_GATEWAY_SECRET}:{};
  try {
    const missing=await app.inject({method:'POST',url:'/v1/missions/does-not-exist/cancel',headers,payload:{}});
    assert.equal(missing.statusCode,404);
    const slug='cancel-contract-'+randomUUID().slice(0,12);
    const created=await app.inject({method:'POST',url:'/v1/projects',headers,payload:{slug,name:'Cancel API contract',repository:'fixtures/cancel-contract',isExisting:true}});
    assert.equal(created.statusCode,201);
    const id=created.json().project.id;
    const missionResponse=await app.inject({method:'POST',url:'/v1/missions',headers,payload:{projectId:id,objective:'Require explicit approval',riskLevel:'HIGH_IMPACT',dataClass:'private_code'}});
    assert.equal(missionResponse.statusCode,201);
    const missionId=missionResponse.json().mission.id;
    const cancelled=await app.inject({method:'POST',url:`/v1/missions/${missionId}/cancel`,headers,payload:{}});
    assert.equal(cancelled.statusCode,200);
    assert.equal(cancelled.json().mission.status,'cancelled');
    const again=await app.inject({method:'POST',url:`/v1/missions/${missionId}/cancel`,headers,payload:{}});
    assert.equal(again.statusCode,200);
    assert.equal(again.json().mission.status,'cancelled');
  } finally {
    await app.close();
  }
});
