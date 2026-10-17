import assert from 'node:assert/strict';
import test from 'node:test';
import { inventory, services } from '../scripts/taso-production-service-inventory.mjs';

function mock({duplicate=false,missingMount=false}={}){
  const all=services.map((s,i)=>({name:s.name,uuid:'runtime_app_'+(i+1),fqdn:s.name==='taso-ui-prod'?'https://taso.tasarlayalim.com':''}));
  if(duplicate)all.push({name:'stray',uuid:'stray_app_11',fqdn:'https://taso.tasarlayalim.com'});
  const requests=[];
  const f=async (u,init)=>{
    requests.push({url:u,method:init.method,auth:init.headers.authorization});
    const tail=u.split('/').slice(-2);
    let body;
    if(u.endsWith('/applications'))body=all;
    else if(u.endsWith('/storages'))body={persistent_storages:missingMount?[]:[{mount_path:'/data'},{mount_path:'/voices'}]};
    else body={status:'running:healthy',git_branch:'main'};
    return {ok:true,json:async()=>body};
  };
  return {f,requests};
}
test('inventory reads only known service metadata and expected mounts',async()=>{
  const x=mock();
  const data=await inventory(x.f,'fixture-only-token');
  assert.equal(data.domainOwner,'UNIQUE');
  assert.equal(data.rows.length,services.length);
  assert.equal(data.rows.find(x=>x.name==='taso-core-prod')?.storage,'PRESENT');
  assert.ok(x.requests.every(x=>x.method==='GET'&&x.auth==='Bearer fixture-only-token'));
  assert.ok(!JSON.stringify(data).includes('fixture-only-token'));
});
test('foreign production domain ownership is detected, never auto-reassigned',async()=>{
  const x=mock({duplicate:true});
  const data=await inventory(x.f,'token');
  assert.equal(data.domainOwner,'CONFLICT');
});
test('missing mounted storage fails closed',async()=>{
  const x=mock({missingMount:true});
  const data=await inventory(x.f,'token');
  assert.equal(data.rows.find(x=>x.name==='taso-core-prod')?.storage,'MISSING');
});
test('absent token is refused without requests',async()=>{
  const x=mock();
  await assert.rejects(inventory(x.f,''),/COOLIFY_API_TOKEN missing/);
  assert.equal(x.requests.length,0);
});
