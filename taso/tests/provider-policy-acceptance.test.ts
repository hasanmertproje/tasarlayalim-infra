import assert from 'node:assert/strict';
import test from 'node:test';
import {ProviderRouter,type ProviderDescriptor} from '../src/provider-router.js';
const providers:ProviderDescriptor[]=[
 {id:'public-free',displayName:'public',enabled:true,costClass:'free',strength:100,latency:1,allowedDataClasses:['public']},
 {id:'private-free',displayName:'private',enabled:true,costClass:'free',strength:90,latency:1,allowedDataClasses:['private_code']},
 {id:'sensitive-paid',displayName:'paid',enabled:true,costClass:'paid',strength:110,latency:1,allowedDataClasses:['sensitive']},
 {id:'disabled',displayName:'disabled',enabled:false,costClass:'free',strength:120,latency:1,allowedDataClasses:['sensitive']},
];
test('private context never routes to public-only, disabled or paid provider without consent',()=>{
 const route=new ProviderRouter(providers).route({dataClass:'private_code',paidAi:false});
 assert.deepEqual(route.map(x=>x.id),['private-free']);
});
test('sensitive context has no eligible implicit free fallback',()=>{
 const route=new ProviderRouter(providers).route({dataClass:'sensitive',paidAi:false});
 assert.deepEqual(route,[]);
});
test('paid approval does not bypass data classification or enabled flag',()=>{
 const route=new ProviderRouter(providers).route({dataClass:'sensitive',paidAi:true});
 assert.deepEqual(route.map(x=>x.id),['sensitive-paid']);
 assert.equal(route.some(x=>x.id==='disabled'),false);
});
test('a public request may use free providers without authorizing paid usage',()=>{
 const route=new ProviderRouter(providers).route({dataClass:'public',paidAi:false});
 assert.equal(route.some(x=>x.costClass==='paid'),false);
 assert.equal(route[0]?.id,'public-free');
});
