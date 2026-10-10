import { lookup } from 'node:dns/promises';
import net from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';
import type { FastifyInstance } from 'fastify';

export type ResearchSearchResult = { title: string; url: string; snippet?: string; engine?: string };
export type ResearchDocument = { url:string; finalUrl:string; status:number; contentType:string; title?:string; text:string; fetchedAt:string; cached:boolean };
type CacheEntry<T> = { expiresAt:number; value:T };
const cache=new Map<string,CacheEntry<unknown>>();
const DEFAULT_TTL_MS=5*60_000, MAX_CACHE_ENTRIES=100, MAX_BYTES=2*1024*1024, REQUEST_TIMEOUT_MS=12_000, MAX_REDIRECTS=3;
function cacheGet<T>(key:string){const item=cache.get(key);if(!item)return undefined;if(item.expiresAt<=Date.now()){cache.delete(key);return undefined}return item.value as T}
function cacheSet<T>(key:string,value:T,ttlMs=DEFAULT_TTL_MS){if(cache.size>=MAX_CACHE_ENTRIES){const first=cache.keys().next().value as string|undefined;if(first)cache.delete(first)}cache.set(key,{expiresAt:Date.now()+ttlMs,value})}
function decodeEntities(value:string){return value.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number(n)))}
export function htmlToText(html:string){const titleMatch=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);const title=titleMatch?decodeEntities(titleMatch[1]!.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()):undefined;const text=decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim());return{title,text}}
const deniedIPv4:[string,number][]=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]];
const deniedIPv6:[string,number][]=[['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32],['2001::',23],['2002::',16]];
function ipv4Number(address:string){return address.split('.').reduce((value,part)=>(value<<8n)|BigInt(part),0n)}
function ipv6Number(address:string){let value=address.toLowerCase();if(value.includes('.')){const lastColon=value.lastIndexOf(':');const octets=value.slice(lastColon+1).split('.').map(Number);value=value.slice(0,lastColon+1)+((octets[0]!<<8)|octets[1]!).toString(16)+':'+((octets[2]!<<8)|octets[3]!).toString(16)}const halves=value.split('::');if(halves.length>2)throw new Error('Invalid IPv6 address.');const left=halves[0]?halves[0]!.split(':'):[];const right=halves.length===2&&halves[1]?halves[1]!.split(':'):[];const missing=8-left.length-right.length;if(halves.length===1&&missing!==0||halves.length===2&&missing<1)throw new Error('Invalid IPv6 address.');return[...left,...Array(missing).fill('0'),...right].reduce((result,part)=>(result<<16n)|BigInt('0x'+part),0n)}
function containsSubnet(address:bigint,subnet:bigint,prefix:number,bits:number){const shift=BigInt(bits-prefix);return address>>shift===subnet>>shift}
export function isPrivateAddress(address:string){const family=net.isIP(address);if(family===4){const value=ipv4Number(address);return deniedIPv4.some(([network,prefix])=>containsSubnet(value,ipv4Number(network),prefix,32))}if(family===6){const value=ipv6Number(address);if(value>>32n===0xffffn||value>>32n===BigInt('0x64ff9b000000000000000000'))return true;return deniedIPv6.some(([network,prefix])=>containsSubnet(value,ipv6Number(network),prefix,128))}return true}
function parseHttpUrl(input:string){let url:URL;try{url=new URL(input)}catch{throw new Error('Geçerli bir URL gerekli.')}if(!['http:','https:'].includes(url.protocol))throw new Error('Yalnızca HTTP/HTTPS URL desteklenir.');if(url.username||url.password)throw new Error('URL içinde kimlik bilgisi kullanılamaz.');return url}
async function resolvePublicAddresses(hostname:string){const lower=hostname.toLowerCase();const host=lower.startsWith('[')&&lower.endsWith(']')?lower.slice(1,-1):lower;const family=net.isIP(host);const records=family?[{address:host,family}]:await lookup(host,{all:true,verbatim:true});if(!records.length||records.some(record=>isPrivateAddress(record.address)))throw new Error('Özel/yerel ağ hedefleri engellendi.');return records}
async function assertPublicUrl(input:string){const url=parseHttpUrl(input);await resolvePublicAddresses(url.hostname);return url}
function publicLookup(hostname:string,options:any,callback:(error:Error|null,address:any,family?:number)=>void){resolvePublicAddresses(hostname).then(records=>{if(options?.all)callback(null,records);else{const family=typeof options==='number'?options:options?.family||0;const record=records.find(item=>!family||item.family===family);if(!record)callback(new Error('Target hostname did not resolve to a public address.'),'',0);else callback(null,record.address,record.family)}}).catch(error=>callback(error instanceof Error?error:new Error('Target hostname resolution failed.'),'',0))}
function requestPinned(url:URL,signal:AbortSignal,headers:Record<string,string>){return new Promise<http.IncomingMessage>((resolve,reject)=>{const transport=url.protocol==='https:'?https:http;const request=transport.request(url,{method:'GET',headers,signal,lookup:publicLookup as any},resolve);request.on('error',reject);request.end()})}
async function responseText(response:http.IncomingMessage,maxBytes:number){const chunks:Buffer[]=[];let size=0;for await(const chunk of response){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>maxBytes){response.destroy();throw new Error('Kaynak boyutu güvenlik sınırını aşıyor.')}chunks.push(bytes)}return Buffer.concat(chunks).toString('utf8')}

export async function fetchPublic(urlInput:string):Promise<ResearchDocument>{
  const key=`fetch:${urlInput}`;
  const cached=cacheGet<ResearchDocument>(key);
  if(cached)return{...cached,cached:true};
  let current=await assertPublicUrl(urlInput);
  for(let redirect=0;redirect<=MAX_REDIRECTS;redirect++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    try{
      const response=await requestPinned(current,controller.signal,{'user-agent':'TasoResearch/1.0 (+public-web-read)',accept:'text/html,text/plain,application/json;q=0.8,*/*;q=0.2'});
      if([301,302,303,307,308].includes(response.statusCode||0)){
        const location=response.headers.location;
        if(!location)throw new Error('Yönlendirme hedefi bulunamadı.');
        current=await assertPublicUrl(new URL(location,current).toString());
        response.resume();
        continue;
      }
      const contentLength=Number(response.headers['content-length']||0);
      if(contentLength>MAX_BYTES){response.destroy();throw new Error('Kaynak boyutu güvenlik sınırını aşıyor.')}
      const contentType=String(response.headers['content-type']||'application/octet-stream');
      const normalizedType=contentType.toLowerCase();
      if(!(normalizedType.startsWith('text/')||['application/json','application/xml','application/xhtml+xml'].some(type=>normalizedType.includes(type)))){response.destroy();throw new Error('Desteklenmeyen içerik türü: '+contentType)}
      const raw=await responseText(response,MAX_BYTES);
      const parsed=/html|xhtml/i.test(contentType)?htmlToText(raw):{title:undefined,text:raw.trim()};
      const result:ResearchDocument={url:urlInput,finalUrl:current.toString(),status:response.statusCode||0,contentType,title:parsed.title,text:parsed.text.slice(0,120_000),fetchedAt:new Date().toISOString(),cached:false};
      if(result.status>=200&&result.status<300)cacheSet(key,result);
      return result;
    }finally{clearTimeout(timer)}
  }
  throw new Error('Çok fazla yönlendirme.');
}

export async function searchWeb(query:string,limit=8):Promise<ResearchSearchResult[]>{const endpoint=process.env.TASO_SEARCH_ENDPOINT?.trim();if(!endpoint)throw new Error('Web search provider yapılandırılmadı. TASO_SEARCH_ENDPOINT gerekli.');const base=parseHttpUrl(endpoint);base.searchParams.set('q',query);base.searchParams.set('format','json');const safeLimit=Math.max(1,Math.min(20,Math.floor(limit||8)));const key=`search:${base.toString()}:${safeLimit}`;const cached=cacheGet<ResearchSearchResult[]>(key);if(cached)return cached;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);try{const response=await fetch(base,{signal:controller.signal,headers:{accept:'application/json','user-agent':'TasoResearch/1.0'}});if(!response.ok)throw new Error(`Search provider HTTP ${response.status}.`);const payload=await response.json() as {results?:Array<{title?:string;url?:string;content?:string;engine?:string}>};const results=(payload.results??[]).filter(i=>i.url&&i.title).slice(0,safeLimit).map(i=>({title:i.title!,url:i.url!,snippet:i.content?.slice(0,1000),engine:i.engine}));cacheSet(key,results,2*60_000);return results}finally{clearTimeout(timer)}}

export function researchStatus(){return{fetchReady:true,searchReady:Boolean(process.env.TASO_SEARCH_ENDPOINT?.trim()),searchProvider:process.env.TASO_SEARCH_ENDPOINT?.trim()?'configured-endpoint':'not-configured',deterministic:true,providerBrain:false}}

export function registerWebResearchRoutes(app:FastifyInstance){app.get('/v1/research/status',async()=>({research:researchStatus()}));app.post<{Body:{url?:string}}>('/v1/research/fetch',async(request,reply)=>{const url=request.body?.url?.trim();if(!url)return reply.code(400).send({error:'url gerekli.'});try{return{document:await fetchPublic(url)}}catch(error){return reply.code(400).send({error:(error as Error).message})}});app.post<{Body:{query?:string;limit?:number}}>('/v1/research/search',async(request,reply)=>{const query=request.body?.query?.trim();if(!query)return reply.code(400).send({error:'query gerekli.'});try{return{query,results:await searchWeb(query,request.body?.limit)}}catch(error){const message=(error as Error).message;return reply.code(message.includes('yapılandırılmadı')?503:400).send({error:message})}})}
