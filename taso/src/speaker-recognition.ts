import type { FastifyInstance } from 'fastify';
import { currentRequestIdentity } from './request-context.js';

const MAX_AUDIO_BASE64=2_800_000;
function base(){return (process.env.TASO_SPEAKER_SERVICE_URL||'').trim().replace(/\/$/,'')}
function secret(){return (process.env.TASO_SPEAKER_SERVICE_SECRET||'').trim()}
function confidenceFloor(){const n=Number(process.env.TASO_SPEAKER_CONFIDENCE_MIN||0.82);return Number.isFinite(n)?Math.max(.5,Math.min(.99,n)):.82}
function configured(){return Boolean(base()&&secret())}
async function call(path:string,body:unknown){
  const response=await fetch(`${base()}${path}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${secret()}`},body:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});
  const payload=await response.json().catch(()=>({error:`Speaker service HTTP ${response.status}`}));
  if(!response.ok)throw new Error(String((payload as any)?.error||`Speaker service HTTP ${response.status}`));
  return payload as any;
}
function validateAudio(audioBase64:unknown,mime:unknown){
  if(typeof audioBase64!=='string'||!audioBase64.trim())throw new Error('audioBase64 gerekli.');
  if(audioBase64.length>MAX_AUDIO_BASE64)throw new Error('Ses örneği boyut sınırını aşıyor.');
  const safeMime=typeof mime==='string'?mime.trim().slice(0,80):'audio/webm';
  if(!/^audio\/(webm|wav|ogg|mpeg|mp4|x-m4a)/i.test(safeMime))throw new Error('Desteklenmeyen ses biçimi.');
  return{audioBase64,mime:safeMime};
}

export function speakerRecognitionStatus(){return{configured:configured(),ready:configured(),confidenceMinimum:confidenceFloor(),authority:'conversational_only',securityNote:'Speaker recognition personalizes conversation only. It never grants auth, approval, deploy, secret or role authority.'}}

export function registerSpeakerRecognitionRoutes(app:FastifyInstance){
  app.get('/v1/speaker/status',async()=>speakerRecognitionStatus());
  app.post<{Body:{audioBase64?:string;mime?:string;label?:string}}>('/v1/speaker/enroll',async(request,reply)=>{
    if(!configured())return reply.code(503).send({error:'Speaker recognition service is not configured.'});
    const identity=currentRequestIdentity();if(!identity.userId)return reply.code(401).send({error:'Authenticated user identity is required.'});
    try{const audio=validateAudio(request.body?.audioBase64,request.body?.mime);const result=await call('/enroll',{userId:identity.userId,label:(request.body?.label||identity.userName||'Taso user').slice(0,80),...audio});return{enrolled:true,userId:identity.userId,voiceProfileId:result.voiceProfileId||result.id||undefined,authority:'conversational_only'}}catch(error){return reply.code(400).send({error:(error as Error).message})}
  });
  app.post<{Body:{audioBase64?:string;mime?:string}}>('/v1/speaker/identify',async(request,reply)=>{
    if(!configured())return reply.code(503).send({error:'Speaker recognition service is not configured.'});
    try{const audio=validateAudio(request.body?.audioBase64,request.body?.mime);const result=await call('/identify',{...audio,limit:3});const confidence=Number(result.confidence||0);const matched=Boolean(result.userId)&&confidence>=confidenceFloor();return{matched,userId:matched?String(result.userId):undefined,label:matched&&result.label?String(result.label).slice(0,80):undefined,confidence:Number.isFinite(confidence)?confidence:0,threshold:confidenceFloor(),authority:'conversational_only'}}catch(error){return reply.code(400).send({error:(error as Error).message})}
  });
}
