import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mission, Project } from '../src/domain.js';
import { deriveMissionIntentProfile } from '../src/mission-intelligence.js';
import { missionNeedsVisualQa, verifyMissionVisualPreview } from '../src/mission-visual-verifier.js';

const project:Project={id:'project_visual',slug:'visual',name:'Visual Site',repository:'example/visual',isExisting:true,defaultBranch:'main',technology:{stackMode:'preserve',architecture:'preserve_existing'},createdAt:'2026-10-10T00:00:00.000Z'};
function mission(objective:string):Mission{return{id:`mission_${Math.random()}`,projectId:project.id,objective,riskLevel:'WRITE',dataClass:'private_code',status:'testing',providerChain:[],autonomous:{enabled:true,maxRetries:2,previewRequired:true,production:'ask',destructive:'deny',paidAi:false,notifications:'important_only'},approvalRequired:false,execution:{intentProfile:deriveMissionIntentProfile(project,objective)},createdAt:'2026-10-10T00:00:00.000Z',updatedAt:'2026-10-10T00:00:00.000Z'}}

test('website/fullstack missions require visual QA evidence',()=>{assert.equal(missionNeedsVisualQa(mission('Mobil responsive landing page tasarla')),true);assert.equal(missionNeedsVisualQa(mission('Backend API endpoint ekle')),false)});

test('website mission fails closed when browser worker is not configured',async()=>{
 const oldUrl=process.env.TASO_BROWSER_WORKER_URL,oldSecret=process.env.TASO_BROWSER_WORKER_SECRET;delete process.env.TASO_BROWSER_WORKER_URL;delete process.env.TASO_BROWSER_WORKER_SECRET;
 try{const result=await verifyMissionVisualPreview(project,mission('Website mobil tasarımını geliştir'),'https://preview.example.test');assert.equal(result.required,true);assert.equal(result.configured,false);assert.equal(result.passed,false);assert.match(result.summary,/requires Browser Operator visual QA/i)}finally{if(oldUrl===undefined)delete process.env.TASO_BROWSER_WORKER_URL;else process.env.TASO_BROWSER_WORKER_URL=oldUrl;if(oldSecret===undefined)delete process.env.TASO_BROWSER_WORKER_SECRET;else process.env.TASO_BROWSER_WORKER_SECRET=oldSecret}
});

test('backend-only mission does not invent a browser requirement',async()=>{const result=await verifyMissionVisualPreview(project,mission('Backend API endpoint ekle'),'https://preview.example.test');assert.equal(result.required,false);assert.equal(result.passed,true)});
