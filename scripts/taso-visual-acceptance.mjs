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


async function mobileDockAcceptance(){
 for(const viewport of [{width:360,height:740},{width:390,height:844}]){
  const context=await browser.newContext({viewport});
  const page=await context.newPage();
  await authenticate(page);
  await page.goto(base,{waitUntil:'networkidle'});
  const metrics=await page.evaluate(()=>{
   const nav=document.querySelector('.taso-mobile-dock');
   if(!nav)return {missing:true};
   const rect=nav.getBoundingClientRect();
   const buttons=[...nav.querySelectorAll('button')];
   const targets=buttons.map(button=>{
    const r=button.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {width:r.width,height:r.height,visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
      clickable:hit===button||button.contains(hit)};
   });
   return {missing:false,display:getComputedStyle(nav).display,scrollWidth:document.documentElement.scrollWidth,
     dockVisible:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,
     dockHeight:rect.height,bodyBottomPadding:parseFloat(getComputedStyle(document.body).paddingBottom)||0,targets};
  });
  if(metrics.missing||metrics.display==='none'||!metrics.dockVisible)throw new Error('Mobile dock missing or clipped at '+viewport.width);
  if(metrics.scrollWidth>viewport.width+2)throw new Error('Horizontal overflow at '+viewport.width);
  if(metrics.targets.length<4||metrics.targets.some(t=>t.width<36||t.height<40||!t.visible||!t.clickable))throw new Error('Mobile dock touch targets inaccessible at '+viewport.width);
  if(metrics.bodyBottomPadding<metrics.dockHeight)throw new Error('Mobile content bottom padding insufficient at '+viewport.width);
  results.push({name:'mobile-dock-'+viewport.width,metrics});
  await page.screenshot({path:out+'/mobile-dock-'+viewport.width+'.png',fullPage:true});
  await context.close();
 }
}


async function projectLifecycleAcceptance(){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const page=await context.newPage();
 await authenticate(page);
 const name='Lifecycle QA Project';
 const create=await page.evaluate(async()=>{
  const response=await fetch('/api/v1/projects',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({slug:'lifecycle-ci-project',name:'Lifecycle QA Project',repository:'example/lifecycle-ci-project',isExisting:true})});
  return {status:response.status,body:await response.json()};
 });
 if(create.status!==201||!create.body.project?.id)throw new Error('Lifecycle project creation failed');
 const projectId=create.body.project.id;
 const firstMission=await page.evaluate(async id=>{
  const response=await fetch('/api/v1/missions',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({projectId:id,objective:'Review lifecycle status',riskLevel:'HIGH_IMPACT',dataClass:'private_code'})});
  return {status:response.status,body:await response.json()};
 },projectId);
 if(firstMission.status!==201||firstMission.body.mission?.status!=='waiting_approval')throw new Error('Expected pending approval mission');
 const blocked=await page.evaluate(async id=>{
  const response=await fetch('/api/v1/projects/'+id+'/lifecycle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'archive'})});
  return response.status;
 },projectId);
 if(blocked!==409)throw new Error('Project with pending mission could be archived');
 const cancel=await page.evaluate(async id=>{
  const response=await fetch('/api/v1/missions/'+id+'/cancel',{method:'POST'});
  return response.status;
 },firstMission.body.mission.id);
 if(cancel!==200)throw new Error('Cancellation of pending mission failed');
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('.main-nav').getByRole('button',{name:/Projects/}).click();
 const card=page.locator('.project-lifecycle-card').filter({hasText:name});
 await card.waitFor({state:'visible'});
 await card.getByRole('button',{name:'Arşivle'}).click();
 const archive=page.locator('.project-lifecycle-row').filter({hasText:name});
 await archive.getByRole('button',{name:'Çöpe taşı'}).click();
 const trashStatus=await page.evaluate(async id=>{
  const response=await fetch('/api/v1/projects');
  const result=await response.json();
  return result.projects.find(project=>project.id===id)?.lifecycleStatus;
 },projectId);
 if(trashStatus!=='trashed')throw new Error('Project not persisted in trash');
 await page.reload({waitUntil:'networkidle'});
 await page.locator('.main-nav').getByRole('button',{name:/Projects/}).click();
 const trashed=page.locator('.project-lifecycle-row').filter({hasText:name});
 await trashed.getByRole('button',{name:'Geri yükle'}).click();
 const restored=await page.evaluate(async id=>{
  const response=await fetch('/api/v1/projects');
  const result=await response.json();
  return result.projects.find(project=>project.id===id);
 },projectId);
 if(restored?.lifecycleStatus!=='active'||restored?.repository!=='example/lifecycle-ci-project')throw new Error('Restore lost identity or data');
 results.push({name:'project-lifecycle-archive-trash-restore',nonDestructive:true,activeMissionGuard:true});
 await context.close();
}

const screens=[undefined,'Projects','Tasks','Approvals','Deployments','Monitoring','AI Agents','Knowledge','Integrations','Notifications','Settings'];
for(const viewport of[{width:390,height:844},{width:1440,height:1000}])for(const theme of['dark','light'])for(const screen of screens)await shot({viewport,theme,screen});
await voiceCoreAcceptance();
await markdownSecurityAcceptance();
await mobileDockAcceptance();
await projectLifecycleAcceptance();
writeFileSync(`${out}/report.json`,JSON.stringify({generatedAt:new Date().toISOString(),screens:screens.map(v=>v||'Dashboard'),results},null,2));
await browser.close();
