import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderQuotaLedger, type AiUsageKey } from '../src/provider-quota-ledger.js';
const a:AiUsageKey={provider:'nvidia',model:'test',userId:'u1',projectId:'p1',missionId:'m1'};
test('synchronous reservations cannot oversubscribe request or token quota',()=>{
 const ledger=new ProviderQuotaLedger({requestsPerWindow:2,tokensPerWindow:100,windowMs:1000});
 const first=ledger.reserve(a,60,0);assert.ok(first);
 assert.equal(ledger.reserve(a,60,0),undefined);
 const second=ledger.reserve(a,40,0);assert.ok(second);
 assert.equal(ledger.reserve(a,1,0),undefined);
 ledger.settle(first!,20);ledger.settle(second!,30);
 assert.equal(ledger.snapshot(a)?.consumedTokens,100);
});
test('missing usage charges reservation in full, invalid estimates are rejected',()=>{
 const ledger=new ProviderQuotaLedger({requestsPerWindow:2,tokensPerWindow:100,windowMs:100});
 assert.equal(ledger.reserve(a,0,0),undefined);
 const id=ledger.reserve(a,90,0);assert.ok(id);
 ledger.settle(id!);
 assert.equal(ledger.snapshot(a)?.consumedTokens,90);
 assert.equal(ledger.reserve(a,11,0),undefined);
});
test('scope isolation, immutable snapshots and safe reset',()=>{
 const ledger=new ProviderQuotaLedger({requestsPerWindow:1,tokensPerWindow:100,windowMs:10});
 const first=ledger.reserve(a,20,0);assert.ok(first);
 assert.equal(ledger.reserve(a,20,11),undefined); // unsettled reservation
 ledger.settle(first!,20);
 const next=ledger.reserve(a,30,11);assert.ok(next);
 const b={...a,missionId:'m2'};
 assert.ok(ledger.reserve(b,30,11));
 const snap=ledger.snapshot(a)!;snap.consumedTokens=999;
 assert.equal(ledger.snapshot(a)?.consumedTokens,0);
});
test('reject invalid quotas and duplicate settlement',()=>{
 assert.throws(()=>new ProviderQuotaLedger({requestsPerWindow:0,tokensPerWindow:1,windowMs:1}));
 const ledger=new ProviderQuotaLedger({requestsPerWindow:1,tokensPerWindow:10,windowMs:10});
 const id=ledger.reserve(a,5,0)!;ledger.settle(id,0);
 assert.throws(()=>ledger.settle(id,0));
});
