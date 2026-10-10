import assert from 'node:assert/strict';
import test from 'node:test';
import { IdentityStore } from '../src/identity-store.js';
import { initializePreviewQa } from '../src/preview-qa.js';

test('QA bootstrap rejects production and never reactivates an existing account',()=>{
 const keys=['TASO_PREVIEW_QA_EMAIL','TASO_PREVIEW_QA_PASSWORD','TASO_PREVIEW_QA_EXPIRES_AT','TASO_DEPLOYMENT_ENV'];const before=keys.map(key=>process.env[key]);
 const identities=new IdentityStore();let stop=()=>{};
 try{
  process.env.TASO_PREVIEW_QA_EMAIL='qa@example.test';process.env.TASO_PREVIEW_QA_PASSWORD='x'.repeat(40);process.env.TASO_PREVIEW_QA_EXPIRES_AT=String(Date.now()+60_000);
  process.env.TASO_DEPLOYMENT_ENV='production';assert.throws(()=>initializePreviewQa(identities),/isolated preview/);assert.equal(identities.getUserByEmail('qa@example.test'),undefined);
  process.env.TASO_DEPLOYMENT_ENV='preview';stop=initializePreviewQa(identities);const user=identities.getUserByEmail('qa@example.test')!;assert.equal(user.owner,false);assert.equal(user.active,true);
  identities.updateUser(user.id,{active:false});initializePreviewQa(identities)();assert.equal(identities.getUserById(user.id)?.active,false);
 }finally{stop();keys.forEach((key,index)=>{if(before[index]===undefined)delete process.env[key];else process.env[key]=before[index]})}
});
