import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PersonalizationStore } from '../src/personalization-store.js';

test('personalization persists mode, relationship and bounded personality values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taso-personalization-'));const previous=process.env.TASO_PERSONALIZATION_FILE;process.env.TASO_PERSONALIZATION_FILE=join(dir,'state.json');
 try{
  const store=new PersonalizationStore();
  const profile=store.updateUser('user_has',{preferredName:'Hasan',about:'Tasarlayalım kurucusu',relationshipStyle:'Kısa ve doğal konuş.',mode:'stress',personality:{warmth:120,directness:99,humor:18,technicalDepth:91,verbosity:14,formality:12,slang:64,profanity:'allowed'}});
  assert.equal(profile.preferredName,'Hasan');assert.equal(profile.mode,'stress');assert.equal(profile.personality.warmth,100);assert.equal(profile.personality.profanity,'allowed');
  const reloaded=new PersonalizationStore().getUser('user_has');assert.equal(reloaded.relationshipStyle,'Kısa ve doğal konuş.');assert.equal(reloaded.personality.directness,99);
  const context=new PersonalizationStore().buildConversationContext('user_has');assert.match(context.instructions,/Stres modundasın/i);assert.match(context.instructions,/Hasan/);
 }finally{if(previous===undefined)delete process.env.TASO_PERSONALIZATION_FILE;else process.env.TASO_PERSONALIZATION_FILE=previous;rmSync(dir,{recursive:true,force:true})}
});

test('trusted company identity is explicit and configurable without changing provider routing',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taso-company-'));const previous=process.env.TASO_PERSONALIZATION_FILE;process.env.TASO_PERSONALIZATION_FILE=join(dir,'state.json');
 try{
  const store=new PersonalizationStore();const defaults=store.getCompany();assert.equal(defaults.companyName,'Tasarlayalım');assert.equal(defaults.founderName,'Hasan');assert.match(defaults.trustedFacts.join(' '),/kurucusu Hasan/i);
  store.updateCompany({assistantOrigin:'Taso, Tasarlayalım ekibinin geliştirdiği dijital asistandır.',trustedFacts:['Tasarlayalım’ın kurucusu Hasan’dır.','Provider adları Taso kimliğinin parçası değildir.']});
  const reloaded=new PersonalizationStore().getCompany();assert.equal(reloaded.trustedFacts.length,2);assert.match(reloaded.assistantOrigin,/dijital asistandır/);
 }finally{if(previous===undefined)delete process.env.TASO_PERSONALIZATION_FILE;else process.env.TASO_PERSONALIZATION_FILE=previous;rmSync(dir,{recursive:true,force:true})}
});
