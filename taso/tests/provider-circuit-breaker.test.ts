import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderCircuitBreaker } from '../src/provider-circuit-breaker.js';
test('opens after threshold, isolates providers and gates half-open probes',()=>{
 const b=new ProviderCircuitBreaker(2,100);
 assert.equal(b.acquire('nvidia',0),true);b.complete('nvidia',false,0);
 b.complete('nvidia',false,1);
 assert.equal(b.snapshot('nvidia').state,'open');
 assert.equal(b.acquire('nvidia',20),false);
 assert.equal(b.acquire('groq',20),true);
 assert.equal(b.acquire('nvidia',101),true);
 assert.equal(b.acquire('nvidia',101),false);
 b.complete('nvidia',true,102);
 assert.equal(b.snapshot('nvidia').state,'closed');
 assert.equal(b.acquire('nvidia',103),true);
});
test('failed half-open probe reopens and extends cooldown',()=>{
 const b=new ProviderCircuitBreaker(1,10);
 b.complete('a',false,0);assert.equal(b.acquire('a',10),true);
 b.complete('a',false,10);assert.equal(b.acquire('a',19),false);
 assert.equal(b.acquire('a',20),true);
});
test('invalid configs fail closed and snapshots are copies',()=>{
 assert.throws(()=>new ProviderCircuitBreaker(0));
 const b=new ProviderCircuitBreaker();const snapshot=b.snapshot('a');
 snapshot.state='open';assert.equal(b.snapshot('a').state,'closed');
});
