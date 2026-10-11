import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAi, wantsWebSearch, webSearchQuery } from '../src/conversation-ai.js';
import { ProviderRouter } from '../src/provider-router.js';
import type { Project } from '../src/domain.js';

test('Turkish current questions are researched without matching unrelated substrings',()=>{
 for(const text of ['Bugün hava durumu nasıl?','Güncel haberler neler?','İnternetten araştır','Şu an dolar kaç TL?','Bursa hava nasıl?','Şurada şu anda ne olmuş?','İstanbul son dakika haberler','Dün gece ne olmuş araştır','Şu an dolar kaç TL?'])assert.equal(wantsWebSearch(text),true,text);
 for(const text of ['Güncelleme yap','Bu kodu anlat','Merhaba','Hey emo şu anda nasılsın'])assert.equal(wantsWebSearch(text),false,text);
});
test('natural research instructions are removed from provider query without deleting the topic',()=>{
 assert.equal(webSearchQuery('OpenAI resmi sitesini webde ara ve kaynakla yanıtla.'),'OpenAI resmi sitesini');
 assert.equal(webSearchQuery('Bursa hava nasıl?'),'Bursa hava nasıl');
 assert.equal(webSearchQuery('internetten araştır'),'internetten araştır');
 assert.equal(webSearchQuery('Search the web OpenAI official site'),'OpenAI official site');
});
test('explicit research reports an unconfigured search service even without an AI provider',async()=>{
 const old=process.env.TASO_SEARCH_ENDPOINT;delete process.env.TASO_SEARCH_ENDPOINT;
 try{const ai=new ConversationAi(new ProviderRouter([]));const result=await ai.reply({name:'Test',repository:'test/repo'} as Project,[],'Türkiye hakkında kaynak bul',{webSearch:true});assert.match(result,/arama servisi henüz bağlı değil/)}finally{if(old===undefined)delete process.env.TASO_SEARCH_ENDPOINT;else process.env.TASO_SEARCH_ENDPOINT=old}
});
test('research sources reach the AI and provider errors are not silently treated as successful research',async()=>{
 const keys=['TASO_SEARCH_ENDPOINT','TASO_PROVIDER_NVIDIA_BASE_URL','TASO_PROVIDER_NVIDIA_API_KEY','TASO_PROVIDER_NVIDIA_MODEL'];const old=keys.map(key=>process.env[key]);const originalFetch=globalThis.fetch;
 process.env.TASO_SEARCH_ENDPOINT='https://search.example.test/search';process.env.TASO_PROVIDER_NVIDIA_BASE_URL='https://ai.example.test/v1';process.env.TASO_PROVIDER_NVIDIA_API_KEY='test';process.env.TASO_PROVIDER_NVIDIA_MODEL='test';
 try{let captured='';let searchUrl='';globalThis.fetch=async(url,init)=>{if(String(url).includes('search.example.test')){searchUrl=String(url);return new Response(JSON.stringify({results:[{title:'Kaynak',url:'https://example.test/source',content:'Doğrulanacak bilgi'}]}),{status:200})}captured=String(init?.body);return new Response(JSON.stringify({choices:[{message:{content:'Kaynaklı yanıt'}}]}),{status:200})};
  const ai=new ConversationAi(new ProviderRouter([{id:'nvidia',displayName:'Test',enabled:true,costClass:'free',strength:85,latency:55,allowedDataClasses:['private_code']} ]));
  const result=await ai.replyDetailed({name:'Test',repository:'test/repo'} as Project,[],'OpenAI resmi sitesini webde ara ve kaynakla yanıtla.',{webSearch:true});
  assert.equal(result.content,'Kaynaklı yanıt');assert.equal(result.mode,'ai');assert.deepEqual(result.sources,[{title:'Kaynak',url:'https://example.test/source'}]);assert.match(captured,/example.test\/source/);assert.match(captured,/güvenilmeyen veri/);const query=new URL(searchUrl).searchParams.get('q')??'';assert.equal(query,'OpenAI resmi sitesini');assert.doesNotMatch(query,/kaynakla yanıtla/);
  globalThis.fetch=async()=>new Response('unavailable',{status:503});assert.match(await ai.reply({name:'Test'} as Project,[],'Farklı sorgu iki',{webSearch:true}),/tamamlanamadı/);
 }finally{globalThis.fetch=originalFetch;keys.forEach((key,index)=>{if(old[index]===undefined)delete process.env[key];else process.env[key]=old[index]})}
});
