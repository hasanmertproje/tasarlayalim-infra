import type { FastifyInstance } from 'fastify';
import { PersonalizationStore, TASO_CONVERSATION_MODES, TASO_PROFANITY_POLICIES, type TasoPersonality } from './personalization-store.js';

function header(request:any,name:string){ const value=request.headers?.[name]; return typeof value==='string'?value.trim():''; }
function userContext(request:any){ return { userId:header(request,'x-taso-user-id')||'user_owner', userName:header(request,'x-taso-user-name')||undefined }; }
function canWriteSettings(request:any){ const permission=header(request,'x-taso-permission'); return permission==='settings.write' || permission===''; }

export function registerPersonalizationRoutes(app:FastifyInstance,store:PersonalizationStore){
  app.get('/v1/personalization',async(request)=>{
    const {userId,userName}=userContext(request);
    return { profile:store.getUser(userId,userName), company:store.getCompany(), defaults:store.getDefaults(), modes:TASO_CONVERSATION_MODES, profanityPolicies:TASO_PROFANITY_POLICIES };
  });
  app.patch<{Body:{preferredName?:string;about?:string;relationshipStyle?:string;mode?:any;personality?:Partial<TasoPersonality>}}>('/v1/personalization',async(request,reply)=>{
    const {userId,userName}=userContext(request);
    try{
      const body=request.body??{};
      const current=store.getUser(userId,userName);
      return {profile:store.updateUser(userId,{
        preferredName:body.preferredName,
        about:body.about,
        relationshipStyle:body.relationshipStyle,
        mode:body.mode,
        personality:body.personality?{...current.personality,...body.personality}:current.personality,
      },userName)};
    }catch(error){return reply.code(400).send({error:(error as Error).message})}
  });
  app.get('/v1/personalization/company',async()=>({company:store.getCompany()}));
  app.patch<{Body:{companyName?:string;creatorName?:string;founderName?:string;assistantOrigin?:string;trustedFacts?:string[]}}>('/v1/personalization/company',async(request,reply)=>{
    if(!canWriteSettings(request))return reply.code(403).send({error:'settings.write permission is required.'});
    try{return {company:store.updateCompany(request.body??{})}}catch(error){return reply.code(400).send({error:(error as Error).message})}
  });
  app.patch<{Body:Partial<TasoPersonality>}>('/v1/personalization/defaults',async(request,reply)=>{
    if(!canWriteSettings(request))return reply.code(403).send({error:'settings.write permission is required.'});
    try{return {defaults:store.updateDefaults(request.body??{})}}catch(error){return reply.code(400).send({error:(error as Error).message})}
  });
}
