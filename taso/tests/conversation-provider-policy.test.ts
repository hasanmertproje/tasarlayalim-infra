import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAi } from '../src/conversation-ai.js';
import { ProviderRouter, type ProviderDescriptor } from '../src/provider-router.js';

function withNvidiaRuntime() {
  const keys = ['TASO_PROVIDER_NVIDIA_BASE_URL', 'TASO_PROVIDER_NVIDIA_API_KEY', 'TASO_PROVIDER_NVIDIA_MODEL'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.TASO_PROVIDER_NVIDIA_BASE_URL = 'https://example.invalid/v1';
  process.env.TASO_PROVIDER_NVIDIA_API_KEY = 'test-key';
  process.env.TASO_PROVIDER_NVIDIA_MODEL = 'test-model';
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function descriptor(allowedDataClasses: ProviderDescriptor['allowedDataClasses']): ProviderDescriptor {
  return {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    enabled: true,
    costClass: 'free',
    strength: 85,
    latency: 55,
    allowedDataClasses,
  };
}

test('conversation AI refuses provider not approved for private workspace context', () => {
  const restore = withNvidiaRuntime();
  try {
    const ai = new ConversationAi(new ProviderRouter([descriptor(['public'])]));
    assert.equal(ai.status().configured, false);
  } finally {
    restore();
  }
});

test('conversation AI accepts a runtime provider explicitly approved for private code', () => {
  const restore = withNvidiaRuntime();
  try {
    const ai = new ConversationAi(new ProviderRouter([descriptor(['public', 'private_code'])]));
    const status = ai.status();
    assert.equal(status.configured, true);
    assert.equal(status.provider, 'nvidia');
    assert.equal(status.model, 'test-model');
  } finally {
    restore();
  }
});

test('conversation retries only transient inference errors and uses another private-code-approved provider',async()=>{
 const env=['TASO_PROVIDER_NVIDIA_BASE_URL','TASO_PROVIDER_NVIDIA_API_KEY','TASO_PROVIDER_NVIDIA_MODEL','TASO_PROVIDER_GROQ_BASE_URL','TASO_PROVIDER_GROQ_API_KEY','TASO_PROVIDER_GROQ_MODEL'];
 const old=env.map(k=>process.env[k]);const fetchOriginal=globalThis.fetch;
 process.env.TASO_PROVIDER_NVIDIA_BASE_URL='https://nvidia.invalid/v1';
 process.env.TASO_PROVIDER_NVIDIA_API_KEY='unit-key-1';process.env.TASO_PROVIDER_NVIDIA_MODEL='nvidia-mock';
 process.env.TASO_PROVIDER_GROQ_BASE_URL='https://groq.invalid/v1';
 process.env.TASO_PROVIDER_GROQ_API_KEY='unit-key-2';process.env.TASO_PROVIDER_GROQ_MODEL='groq-mock';
 try{
  const calls:string[]=[];
  globalThis.fetch=async(url,options)=>{calls.push(String(url));const body=JSON.parse(String(options?.body));
   if(String(url).includes('nvidia.invalid')){assert.equal(body.model,'nvidia-mock');return new Response('busy',{status:503})}
   assert.equal(body.model,'groq-mock');
   return new Response(JSON.stringify({choices:[{message:{content:'Policy-approved response'}}]}),{status:200});
  };
  const ai=new ConversationAi(new ProviderRouter([
   descriptor(['private_code']),{id:'groq',displayName:'Groq',enabled:true,costClass:'free',strength:72,latency:90,allowedDataClasses:['public','private_code']}
  ]));
  const result=await ai.replyDetailed({name:'QA project',repository:'taso/test'} as never,[],'Basit bir açıklama yaz');
  assert.equal(result.mode,'ai');assert.equal(result.content,'Policy-approved response');
  assert.equal(calls.length,2);assert.match(calls[0]||'',/nvidia/);assert.match(calls[1]||'',/groq/);
  assert.equal(ai.status().lastFailure,undefined);
 }finally{globalThis.fetch=fetchOriginal;env.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]})}
});

test('bounded 429 retry succeeds, 403 is permanent, and failure evidence has no credentials',async()=>{
 const restore=withNvidiaRuntime();const original=globalThis.fetch;
 try{
  let count=0;
  globalThis.fetch=async()=>{count++;return count===1?new Response('rate limit',{status:429}):
   new Response(JSON.stringify({choices:[{message:{content:'Gerçek yanıt'}}]}),{status:200})};
  const ai=new ConversationAi(new ProviderRouter([descriptor(['private_code'])]));
  const response=await ai.replyDetailed({name:'QA',repository:'test/repo'} as never,[],'Bir soruya cevap ver');
  assert.equal(response.mode,'ai');assert.equal(count,2);
  let deniedCount=0;globalThis.fetch=async()=>{deniedCount++;return new Response('forbidden',{status:403})};
  await assert.rejects(ai.replyDetailed({name:'QA',repository:'test/repo'} as never,[],'Farklı bir soru sor'),/HTTP_403/);
  assert.equal(deniedCount,1);
  assert.equal(ai.status().lastFailure?.code,'HTTP_403');
  assert.doesNotMatch(JSON.stringify(ai.status()),/test-key/);
 }finally{globalThis.fetch=original;restore()}
});
