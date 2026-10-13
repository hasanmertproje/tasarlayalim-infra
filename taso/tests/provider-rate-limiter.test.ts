import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderRateLimiter } from '../src/provider-rate-limiter.js';
test('provider-wide concurrent reservations cannot exceed RPM or token budget',async()=>{
 const limiter=new ProviderRateLimiter({requests:3,tokens:100,windowMs:1000});
 const accepted=await Promise.all(Array.from({length:20},async()=>limiter.admit('nvidia',25,0)));
 assert.equal(accepted.filter(x=>x.allowed).length,3);
 assert.equal(limiter.snapshot('nvidia')?.tokens,75);
 assert.equal(limiter.admit('nvidia',1,5).retryAfterMs,995);
});
test('different providers are isolated and window resets',()=>{
 const limiter=new ProviderRateLimiter({requests:1,tokens:20,windowMs:10});
 assert.equal(limiter.admit('nvidia',20,0).allowed,true);
 assert.equal(limiter.admit('nvidia',1,0).allowed,false);
 assert.equal(limiter.admit('groq',1,0).allowed,true);
 assert.equal(limiter.admit('nvidia',1,10).allowed,true);
});
test('invalid and oversized token estimates fail closed',()=>{
 const limiter=new ProviderRateLimiter({requests:3,tokens:10,windowMs:10});
 assert.equal(limiter.admit('nvidia',11,0).allowed,false);
 assert.equal(limiter.admit('nvidia',NaN,0).allowed,false);
 assert.equal(limiter.admit('',1,0).allowed,false);
 assert.throws(()=>new ProviderRateLimiter({requests:0,tokens:1,windowMs:1}));
});
