import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAi } from '../src/conversation-ai.js';
import { ProviderRouter, type ProviderDescriptor } from '../src/provider-router.js';
import type { Project } from '../src/domain.js';

const ids = ['NVIDIA', 'GROQ', 'OPENAI'] as const;
function setup() {
  const keys = ids.flatMap(id => [`TASO_PROVIDER_${id}_BASE_URL`, `TASO_PROVIDER_${id}_API_KEY`, `TASO_PROVIDER_${id}_MODEL`]);
  const previous = keys.map(key => process.env[key]);
  for (const id of ids) {
    process.env[`TASO_PROVIDER_${id}_BASE_URL`] = `https://${id.toLowerCase()}.example.test/v1`;
    process.env[`TASO_PROVIDER_${id}_API_KEY`] = 'mock-key';
    process.env[`TASO_PROVIDER_${id}_MODEL`] = 'mock-model';
  }
  const providers:ProviderDescriptor[] = ids.map((id,index) => ({
    id:id.toLowerCase(),displayName:id,enabled:true,
    costClass:id==='OPENAI'?'paid':'free',strength:100-index,latency:90,
    allowedDataClasses:id==='GROQ'?['public']:['private_code'],
  }));
  return {providers,restore:()=>keys.forEach((key,index)=>{
    if(previous[index]===undefined) delete process.env[key];
    else process.env[key]=previous[index];
  })};
}
const project={name:'Test Workspace',repository:'test/repo'} as Project;

test('conversation fails over after upstream 503 without disclosing private context to public-only or paid providers',async()=>{
  const {providers,restore}=setup();const originalFetch=globalThis.fetch;
  const calls:string[]=[];
  try {
    globalThis.fetch=async(input)=>{
      calls.push(String(input));
      if(calls.length===1) return new Response('untrusted details',{status:503});
      return new Response(JSON.stringify({choices:[{message:{content:'Safe answer'}}]}),{status:200});
    };
    // Groq is public-only; OpenAI is paid. Neither should be called.
    const ai=new ConversationAi(new ProviderRouter(providers));
    await assert.rejects(ai.reply(project,[],'Explain this code'),/All policy-approved conversation providers failed: nvidia: HTTP 503/);
    assert.deepEqual(calls,['https://nvidia.example.test/v1/chat/completions']);
  } finally {globalThis.fetch=originalFetch;restore();}
});

test('conversation switches to next eligible free provider on error and returns AI evidence',async()=>{
  const {providers,restore}=setup();const originalFetch=globalThis.fetch;const calls:string[]=[];
  try {
    providers[1]!.allowedDataClasses=['private_code'];
    globalThis.fetch=async(input)=>{
      calls.push(String(input));
      if(calls.length===1)return new Response('bad upstream',{status:502});
      return new Response(JSON.stringify({choices:[{message:{content:'Fallback answer'}}]}),{status:200});
    };
    const result=await new ConversationAi(new ProviderRouter(providers)).replyDetailed(project,[],'Explain this code');
    assert.equal(result.content,'Fallback answer');assert.equal(result.mode,'ai');
    assert.deepEqual(calls,['https://nvidia.example.test/v1/chat/completions','https://groq.example.test/v1/chat/completions']);
  } finally {globalThis.fetch=originalFetch;restore();}
});
