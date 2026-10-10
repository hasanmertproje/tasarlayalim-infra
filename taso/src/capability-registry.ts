import type { FastifyInstance } from 'fastify';
import { CoolifyTools } from './coolify-tools.js';
import { GitHubTools } from './github-tools.js';
import { researchStatus } from './web-research.js';
import { speakerRecognitionStatus } from './speaker-recognition.js';

export type CapabilityState='ready'|'limited'|'not-configured'|'unavailable';
export type TasoCapability={id:string;label:string;category:'research'|'browser'|'code'|'delivery'|'voice'|'identity';state:CapabilityState;requiredForCore:boolean;summary:string;authority:string[]};
function browserConfigured(){return Boolean(process.env.TASO_BROWSER_WORKER_URL?.trim()&&process.env.TASO_BROWSER_WORKER_SECRET?.trim())}
function voiceReady(){return Boolean(process.env.TASO_VOICE_REALTIME_ENABLED==='true'&&process.env.TASO_VOICE_REALTIME_PAID_ALLOWED==='true'&&process.env.TASO_VOICE_REALTIME_API_KEY?.trim())||Boolean(process.env.TASO_LOCAL_VOICE_URL?.trim())}
export function listCapabilities():TasoCapability[]{
 const research=researchStatus();const github=GitHubTools.fromEnv();const coolify=CoolifyTools.fromEnv();const speaker=speakerRecognitionStatus();const browser=browserConfigured();
 return[
  {id:'web-fetch',label:'Web Read',category:'research',state:research.fetchReady?'ready':'unavailable',requiredForCore:false,summary:research.fetchReady?'Public URL content can be read with SSRF protections.':'Public URL reader unavailable.',authority:['READ']},
  {id:'web-search',label:'Web Search',category:'research',state:research.searchReady?'ready':'not-configured',requiredForCore:false,summary:research.searchReady?'General web search is connected.':'General search needs TASO_SEARCH_ENDPOINT.',authority:['READ']},
  {id:'browser',label:'Browser Operator',category:'browser',state:browser?'ready':'not-configured',requiredForCore:false,summary:browser?'Browser worker is available for allowlisted targets.':'Browser worker URL/secret are not configured.',authority:['READ','DRAFT']},
  {id:'visual-qa',label:'Visual QA',category:'browser',state:browser?'ready':'not-configured',requiredForCore:false,summary:browser?'Desktop/mobile dark/light evidence can be captured.':'Visual QA needs Browser Operator.',authority:['READ']},
  {id:'github',label:'Repository Operations',category:'code',state:github?'ready':'not-configured',requiredForCore:false,summary:github?'Repository read/write and CI inspection are configured.':'Repository token is not configured.',authority:['READ','WRITE']},
  {id:'preview-deploy',label:'Preview Deployment',category:'delivery',state:coolify?'ready':'not-configured',requiredForCore:false,summary:coolify?'Preview deployment broker is configured.':'Deployment broker requires Coolify base URL, token and resource map.',authority:['DRAFT','WRITE']},
  {id:'production-deploy',label:'Production Deployment',category:'delivery',state:coolify?'limited':'not-configured',requiredForCore:false,summary:coolify?'Broker exists, but production always remains approval-gated.':'Deployment broker is not configured.',authority:['HIGH_IMPACT','APPROVAL_REQUIRED']},
  {id:'voice',label:'Taso Live',category:'voice',state:voiceReady()?'ready':'limited',requiredForCore:false,summary:voiceReady()?'A voice runtime is configured.':'Text conversation remains available; full voice runtime is limited.',authority:['CONVERSATION']},
  {id:'speaker-recognition',label:'Speaker Recognition',category:'identity',state:speaker.ready?'ready':'not-configured',requiredForCore:false,summary:speaker.ready?'Conversational speaker matching is configured.':'Optional speaker recognition service is not configured.',authority:['CONVERSATIONAL_IDENTITY_ONLY']},
 ];
}
export function capabilitySummary(){const capabilities=listCapabilities();const coreBlocking=capabilities.filter(c=>c.requiredForCore&&c.state!=='ready');return{coreReady:coreBlocking.length===0,coreBlocking:coreBlocking.map(c=>c.id),ready:capabilities.filter(c=>c.state==='ready').length,limited:capabilities.filter(c=>c.state!=='ready').length,capabilities};}
export function registerCapabilityRoutes(app:FastifyInstance){app.get('/v1/capabilities',async()=>capabilitySummary())}
