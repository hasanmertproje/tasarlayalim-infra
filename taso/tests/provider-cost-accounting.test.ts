import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateTokenCost} from '../src/provider-cost-accounting.js';
test('pricing is not invented and invalid usage fails closed',()=>{
 assert.equal(estimateTokenCost({inputTokens:100,outputTokens:40}),undefined);
 assert.equal(estimateTokenCost({inputTokens:-1,outputTokens:0},{inputUsdPerMillion:1,outputUsdPerMillion:2,source:'operator'}),undefined);
});
test('explicit rates produce estimates not verified charges',()=>{
 const result=estimateTokenCost({inputTokens:1_000_000,outputTokens:500_000},{inputUsdPerMillion:1,outputUsdPerMillion:4,source:'operator supplied'});
 assert.deepEqual(result,{kind:'estimate',currency:'USD',amount:3,source:'operator supplied'});
});
