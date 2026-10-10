import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneStore } from '../src/control-plane-store.js';

test('control plane persists bounded browser policy, project access, emergency and audit',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taso-control-plane-'));const old=process.env.TASO_CONTROL_PLANE_FILE;process.env.TASO_CONTROL_PLANE_FILE=join(dir,'control.json');
 try{
  const store=new ControlPlaneStore();
  assert.equal(store.getSnapshot().policies.browserMaxRepairCycles,3);
  const policy=store.updatePolicies({browserMaxRepairCycles:99,agentMaxRetries:99,retentionDays:1});
  assert.equal(policy.browserMaxRepairCycles,5);assert.equal(policy.agentMaxRetries,5);assert.equal(policy.retentionDays,7);
  const access=store.setProjectAccess({userId:'user_a',projectId:'project_a',environments:['dev','prod','invalid'],read:true,write:true,deploy:true});
  assert.deepEqual(access.environments,['dev','prod']);assert.equal(access.deploy,true);
  const emergency=store.updateEmergency({writesDisabled:true,productionDeployDisabled:true},'user_owner');
  assert.equal(emergency.writesDisabled,true);assert.equal(emergency.updatedBy,'user_owner');
  store.appendAudit({actorId:'user_owner',type:'emergency.updated',highImpact:true});
  const reloaded=new ControlPlaneStore();
  assert.equal(reloaded.getSnapshot().projectAccess.length,1);assert.equal(reloaded.getSnapshot().audit[0]?.type,'emergency.updated');assert.equal(reloaded.getSnapshot().emergency.productionDeployDisabled,true);
 }finally{if(old===undefined)delete process.env.TASO_CONTROL_PLANE_FILE;else process.env.TASO_CONTROL_PLANE_FILE=old;rmSync(dir,{recursive:true,force:true})}
});

test('branding rejects scriptable image types and supports favicon PNG',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taso-branding-'));const old=process.env.TASO_CONTROL_PLANE_FILE;process.env.TASO_CONTROL_PLANE_FILE=join(dir,'control.json');
 try{const store=new ControlPlaneStore();assert.throws(()=>store.updateBranding({iconDataUrl:'data:image/svg+xml;base64,PHN2Zz4='}),/PNG or WebP/);const branding=store.updateBranding({faviconDataUrl:'data:image/png;base64,AA==',animationPreset:'minimal'});assert.equal(branding.animationPreset,'minimal');assert.match(branding.faviconDataUrl??'',/^data:image\/png/)}finally{if(old===undefined)delete process.env.TASO_CONTROL_PLANE_FILE;else process.env.TASO_CONTROL_PLANE_FILE=old;rmSync(dir,{recursive:true,force:true})}
});
