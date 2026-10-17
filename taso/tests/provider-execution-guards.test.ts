import assert from 'node:assert/strict';
import test from 'node:test';
import { executeProviderRequest, ProviderExecutionError } from '../src/provider-execution-guards.js';
test('503 and 429 can recover within a bounded attempt budget',async()=>{
 let calls=0;
 const value=await executeProviderRequest(async()=>{
   calls++;
   if(calls===1)return {status:503};
   return {value:'recovered'};
 },{baseDelayMs:1,maxDelayMs:1,maxAttempts:2});
 assert.equal(value,'recovered');assert.equal(calls,2);
});
test('permanent 401 does not retry or leak response content',async()=>{
 let calls=0;
 await assert.rejects(executeProviderRequest(async()=>{calls++;return {status:401}},{maxAttempts:5}), (e:unknown)=>{
   assert.ok(e instanceof ProviderExecutionError);
   assert.equal(e.category,'permanent');assert.equal(e.status,401);return true;
 });
 assert.equal(calls,1);
});
test('429 exhausts a strict retry budget',async()=>{
 let calls=0;
 await assert.rejects(executeProviderRequest(async()=>{calls++;return {status:429}},{maxAttempts:2,baseDelayMs:1,maxDelayMs:1}),/exhausted/);
 assert.equal(calls,2);
});
test('caller cancellation stops pending backoff without another API attempt',async()=>{
 const abort=new AbortController();let calls=0;
 await assert.rejects(executeProviderRequest(async()=>{
   calls++;abort.abort();return {status:503};
 },{signal:abort.signal,maxAttempts:5}),/aborted/);
 assert.equal(calls,1);
});
test('transport exception is sanitized and bounded',async()=>{
 let calls=0;
 await assert.rejects(executeProviderRequest(async()=>{calls++;throw new Error('secret upstream payload')},{maxAttempts:2,baseDelayMs:1,maxDelayMs:1}),e=>{
   assert.doesNotMatch(String(e),/secret upstream payload/);return true;
 });
 assert.equal(calls,2);
});
