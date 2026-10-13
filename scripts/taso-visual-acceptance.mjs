import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const base=process.env.TASO_VISUAL_BASE_URL||'http://127.0.0.1:4173';
const out=process.env.TASO_VISUAL_OUTPUT||'visual-evidence';
mkdirSync(out,{recursive:true});

function base32Decode(input){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const clean=input.toUpperCase().replace(/[^A-Z2-7]/g,'');let bits=0,value=0;const bytes=[];for(const c of clean){const i=alphabet.indexOf(c);if(i<0)continue;value=(value<<5)|i;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8}}return Buffer.from(bytes)}
function totp(secret){const counter=BigInt(Math.floor(Date.now()/30000));const buf=Buffer.alloc(8);buf.writeBigUInt64BE(counter);const digest=createHmac('sha1',base32Decode(secret)).update(buf).digest();const offset=digest[digest.length-1]&15;const binary=((digest[offset]&127)<<24)|((digest[offset+1]&255)<<16)|((digest[offset+2]&255)<<8)|(digest[offset+3]&255);return String(binary%1_000_000).padStart(6,'0')}

const browser=await chromium.launch({headless:true});
const results=[];
let totpSecret='';

async function authenticate(page){
 await page.goto(base,{waitUntil:'networkidle'});
 const login=await page.evaluate(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@ci.local',password:'ci-password'})});return r.json()});
 if(login.authenticated)return;
 if(login.requiresTwoFactorSetup&&login.secret&&login.challengeId){
  totpSecret=login.secret;
  const code=totp(totpSecret);
  const enrolled=await page.evaluate(async({challengeId,code})=>{const r=await fetch('/api/auth/2fa/setup/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,code,deviceName:'Visual CI'})});return r.json()},{challengeId:login.challengeId,code});
  if(!enrolled.authenticated)throw new Error(`2FA enrollment failed: ${JSON.stringify(enrolled)}`);
  return;
 }
 if(login.requiresTwoFactor&&login.challengeId&&totpSecret){
  const code=totp(totpSecret);
  const verified=await page.evaluate(async({challengeId,code})=>{const r=await fetch('/api/auth/2fa/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,code,deviceName:'Visual CI'})});return r.json()},{challengeId:login.challengeId,code});
  if(!verified.authenticated)throw new Error(`2FA verify failed: ${JSON.stringify(verified)}`);
  return;
 }
 throw new Error(`Unexpected login flow: ${JSON.stringify(login)}`);
}

async function inspect(page,name){
 await page.waitForTimeout(650);
 const metrics=await page.evaluate(()=>{
  const visible=e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0};
  const clipped=[...document.querySelectorAll('*')].filter(e=>{if(!visible(e))return false;const s=getComputedStyle(e);if(!['fixed','sticky'].includes(s.position))return false;const r=e.getBoundingClientRect();return r.left<-2||r.right>innerWidth+2||r.top<-2||r.bottom>innerHeight+2}).slice(0,15).map(e=>({tag:e.tagName,className:e.className,rect:e.getBoundingClientRect().toJSON?.()}));
  const narrow=[...document.querySelectorAll('.truth-panel p,.integrations-center p,.broker-row p,.cp29-panel p')].filter(e=>visible(e)&&((e.textContent||'').trim().length>30)&&e.getBoundingClientRect().width<110).slice(0,15).map(e=>({text:(e.textContent||'').trim().slice(0,100),width:e.getBoundingClientRect().width}));
  const dock=document.querySelector('.taso-mobile-dock');const dockRect=dock&&visible(dock)?dock.getBoundingClientRect():null;
  const iconOffsets=dockRect?[...dock.querySelectorAll('button')].map(button=>{const icon=button.querySelector('.taso-nav-glyph svg,.taso-mobile-core,.taso-more-glyph');if(!icon)return 0;const b=button.getBoundingClientRect(),i=icon.getBoundingClientRect();return Math.abs((b.left+b.width/2)-(i.left+i.width/2))}):[];
  return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,selfImprove:Boolean(document.querySelector('.self-improve-shell')),floatingAgentOps:Boolean([...document.querySelectorAll('.agent-ops-shell.mode-dock')].some(visible)),bodyText:document.body.innerText.slice(0,40000),clipped,narrow,dockRect:dockRect?{left:dockRect.left,right:dockRect.right,bottom:dockRect.bottom}:null,maxIconOffset:Math.max(0,...iconOffsets)};
 });
 if(metrics.scrollWidth>metrics.width+2)throw new Error(`${name}: horizontal overflow ${metrics.scrollWidth}>${metrics.width}`);
 if(metrics.selfImprove)throw new Error(`${name}: Self Improve floating UI still mounted`);
 if(metrics.width<=820&&metrics.floatingAgentOps)throw new Error(`${name}: floating Agent Ops overlaps mobile surface`);
 if(metrics.clipped.length)throw new Error(`${name}: clipped fixed/sticky controls ${JSON.stringify(metrics.clipped)}`);
 if(metrics.narrow.length)throw new Error(`${name}: collapsed text columns ${JSON.stringify(metrics.narrow)}`);
 if(metrics.maxIconOffset>7)throw new Error(`${name}: bottom-nav icon alignment drift ${metrics.maxIconOffset.toFixed(1)}px`);
 if(/GEMINI LIVE|GEMINI-3\.8|AI PROVIDER ROUTER/i.test(metrics.bodyText))throw new Error(`${name}: provider branding leaked into primary UI`);
 results.push({name,...metrics,bodyText:undefined});
}

async function shot({viewport,theme,screen}){
 const context=await browser.newContext({viewport});
 const page=await context.newPage();
 await authenticate(page);
 await page.evaluate(themeValue=>{document.documentElement.dataset.theme=themeValue;localStorage.setItem('taso-theme',themeValue)},theme);
 const suffix=screen?`?screen=${encodeURIComponent(screen)}`:'';
 await page.goto(`${base}/${suffix}`,{waitUntil:'networkidle'});
 await inspect(page,`${screen||'Dashboard'}-${theme}-${viewport.width}`);
 const file=`${out}/${(screen||'dashboard').toLowerCase().replace(/\s+/g,'-')}-${theme}-${viewport.width}.png`;
 await page.screenshot({path:file,fullPage:true});
 await context.close();
}

async function voiceCoreAcceptance(){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();
 let conversationPosts=0;
 let missionPosts=0;
 let providerSessionPosts=0;
 let capturedBody;

 await page.addInitScript(()=>{
  localStorage.setItem('taso-voice-replies','false');
  class FakeSpeechRecognition{
   lang='';continuous=false;interimResults=false;maxAlternatives=1;onstart;onresult;onerror;onend;stopped=false;
   start(){this.stopped=false;window.__tasoVoiceRecognition=this;this.onstart?.()}
   stop(){if(this.stopped)return;this.stopped=true;queueMicrotask(()=>this.onend?.())}
  }
  window.SpeechRecognition=FakeSpeechRecognition;
  window.webkitSpeechRecognition=FakeSpeechRecognition;
 });
 page.on('request',request=>{
  const url=request.url();
  if(request.method()==='POST'&&/\/api\/v1\/missions(?:$|\?)/.test(url))missionPosts+=1;
  if(request.method()==='POST'&&/\/api\/v1\/voice\/(?:realtime\/session|gemini\/token|classify)(?:$|\?)/.test(url))providerSessionPosts+=1;
 });
 await page.route('**/api/v1/conversations/messages',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  conversationPosts+=1;
  capturedBody=route.request().postDataJSON();
  const now=new Date().toISOString();
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   decision:{intent:'question',executionRequested:false,confidence:.99},
   userMessage:{id:'voice-user-1',projectId:capturedBody.projectId,role:'user',content:capturedBody.text,createdAt:now},
   assistantMessage:{id:'voice-assistant-1',projectId:capturedBody.projectId,role:'assistant',content:'Core üzerinden kaynaklı yanıt.',replyMode:'ai',sources:[{title:'OpenAI',url:'https://openai.com/'}],createdAt:now},
  })});
 });

 await authenticate(page);
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('.dashboard-chat').waitFor({state:'visible'});
 await page.locator('.dashboard-chat input[type="checkbox"]').check();
 await page.locator('.dashboard-chat-mic').click();
 await page.waitForFunction(()=>Boolean(window.__tasoVoiceRecognition));

 await page.evaluate(()=>{const r=window.__tasoVoiceRecognition;r.onresult?.({resultIndex:0,results:Object.assign([{0:{transcript:'OpenAI resmi sitesini webde'},isFinal:false}],{length:1})})});
 await page.waitForFunction(()=>document.querySelector('#dashboard-question')?.value==='OpenAI resmi sitesini webde');
 if(conversationPosts!==0)throw new Error(`voice interim transcript performed ${conversationPosts} conversation POST(s)`);
 if(missionPosts!==0)throw new Error(`voice interim transcript performed ${missionPosts} mission POST(s)`);

 const finalText='OpenAI resmi sitesini webde ara ve kaynakla yanıtla.';
 await page.evaluate(text=>{const r=window.__tasoVoiceRecognition;const event={resultIndex:0,results:Object.assign([{0:{transcript:text},isFinal:true}],{length:1})};r.onresult?.(event);r.onresult?.(event)},finalText);
 await page.waitForFunction(()=>document.querySelectorAll('.dashboard-chat-messages .from-taso').length>0);
 await page.waitForTimeout(150);
 if(conversationPosts!==1)throw new Error(`one final transcript must produce exactly one Core conversation POST; observed ${conversationPosts}`);
 if(!capturedBody?.projectId)throw new Error('voice Core POST did not include projectId');
 if(capturedBody?.text!==finalText)throw new Error(`voice Core POST text mismatch: ${JSON.stringify(capturedBody?.text)}`);
 if(capturedBody?.webSearch!==true)throw new Error('voice Core POST did not preserve Web search selection');
 if(missionPosts!==0)throw new Error(`voice transcript created a Mission automatically (${missionPosts} POSTs)`);
 if(providerSessionPosts!==0)throw new Error(`voice transcript bypassed Core through a direct provider voice session (${providerSessionPosts} POSTs)`);
 const sourceCount=await page.locator('.chat-sources a').count();
 if(sourceCount!==1)throw new Error(`voice Core response sources were not rendered; observed ${sourceCount}`);
 const policy=await page.locator('.dashboard-chat').getAttribute('data-voice-policy');
 if(policy!=='core-conversation')throw new Error(`voice policy marker mismatch: ${policy}`);
 results.push({name:'Voice-Core-final-transcript',conversationPosts,missionPosts,providerSessionPosts,webSearch:capturedBody.webSearch,sourceCount});
 await page.screenshot({path:`${out}/voice-core-final-transcript-390.png`,fullPage:true});
 await context.close();
}


async function markdownSecurityAcceptance(){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();
 await authenticate(page);
 const scriptTag = '<' + 'script' + '>' + 'window.__tasoXss=1' + '</' + 'script' + '>';
 const invalidHref = 'java' + 'script:blocked';
 const messages = [
  {id:'markdown-user',role:'user',content:'Render test'},
  {id:'markdown-assistant',role:'assistant',content:[
   '# Başlık','**kalın** ve *italik*','- ilk','- ikinci','> alıntı',
   '`kod`','```js','const a = 1;','```',
   scriptTag,'[Güvensiz]('+invalidHref+')','[Güvenli](https://example.org/ok)'
  ].join(String.fromCharCode(10)),sources:[
    {title:'Güvenli kaynak',url:'https://example.org/source'},
    {title:'Güvensiz kaynak',url:invalidHref}
  ]}
 ];
 await page.route('**/api/v1/conversations?*',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({messages})});
 });
 for(const round of ['initial','reopen']){
  await page.goto(base,{waitUntil:'networkidle'});
  const box=page.locator('.dashboard-chat-messages .from-taso');
  await box.waitFor({state:'visible'});
  for(const [selector,count] of [['h3',1],['strong',1],['em',1],['li',2],['blockquote',1],['pre code',1]]){
   const actual=await box.locator(selector).count();
   if(actual!==count)throw new Error(round+': '+selector+' count '+actual+' != '+count);
  }
  if(await box.locator('script').count())throw new Error(round+': HTML was parsed as DOM');
  if(await page.evaluate(()=>window.__tasoXss)!==undefined)throw new Error(round+': active script');
  const hrefs=await box.locator('a').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')));
  if(hrefs.length!==2||hrefs.some(href=>!href||!['http:','https:'].includes(new URL(href).protocol)))throw new Error(round+': untrusted href');
  if(await box.locator('.markdown-unsafe-link').count()!==1)throw new Error(round+': invalid markdown link should be inert');
 }
 results.push({name:'Markdown-XSS-history',passes:2});
 await page.screenshot({path:`${out}/safe-markdown-390.png`,fullPage:true});
 await context.close();
}

const screens=[undefined,'Projects','Tasks','Approvals','Deployments','Monitoring','AI Agents','Knowledge','Integrations','Notifications','Settings'];
for(const viewport of[{width:390,height:844},{width:1440,height:1000}])for(const theme of['dark','light'])for(const screen of screens)await shot({viewport,theme,screen});
await voiceCoreAcceptance();
await markdownSecurityAcceptance();
writeFileSync(`${out}/report.json`,JSON.stringify({generatedAt:new Date().toISOString(),screens:screens.map(v=>v||'Dashboard'),results},null,2));
await browser.close();
