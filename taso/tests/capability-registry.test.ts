import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilitySummary, listCapabilities } from '../src/capability-registry.js';

test('capability registry exposes URL read separately from optional general search',()=>{
 const oldSearch=process.env.TASO_SEARCH_ENDPOINT;delete process.env.TASO_SEARCH_ENDPOINT;
 try{const caps=listCapabilities();assert.equal(caps.find(c=>c.id==='web-fetch')?.state,'ready');assert.equal(caps.find(c=>c.id==='web-search')?.state,'not-configured');assert.equal(caps.some(c=>/gemini|openai|nvidia/i.test(`${c.id} ${c.label}`)),false)}finally{if(oldSearch===undefined)delete process.env.TASO_SEARCH_ENDPOINT;else process.env.TASO_SEARCH_ENDPOINT=oldSearch}
});

test('optional capabilities never block core readiness summary',()=>{const summary=capabilitySummary();assert.equal(summary.coreReady,true);assert.deepEqual(summary.coreBlocking,[])});
