import {chromium} from 'playwright';
import {createHmac} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.TASO_VISUAL_BASE_URL||'http://127.0.0.1:4173';
const output=process.env.TASO_VISUAL_OUTPUT||'visual-evidence';
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const observations=[];
function base32Decode(input){const alpha='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0;const result=[];for(const c of input.toUpperCase().replace(/[^A-Z2-7]/g,'')){value=(value<<5)|alpha.indexOf(c);bits+=5;if(bits>=8){result.push((value>>>(bits-8))&255);bits-=8}}return Buffer.from(result)}
function totp(secret){const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const d=createHmac('sha1',base32Decode(secret)).update(buf).digest();const offset=d[d.length-1]&15;return String(((((d[offset]&127)<<24)|((d[offset+1]&255)<<16)|((d[offset+2]&255)<<8)|(d[offset+3]&255)))%1e6).padStart(6,'0')}
async function login(target, enrolledSecret){
 await target.goto(base,{waitUntil:'networkidle'});
 const response=await target.evaluate(async()=>{
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@ci.local',password:'ci-password'})});
  const b=await r.json().catch(()=>({}));return {status:r.status,body:b};
 });
 const data=response.body;
 if(response.status!==200)throw Error('Studio login HTTP '+response.status+' step=credentials');
 if(data.authenticated)return {secret:enrolledSecret||'',flow:'trusted-session'};
 if(data.requiresTwoFactorSetup&&data.secret&&data.challengeId){
  const done=await target.evaluate(async({challengeId,code})=>{
   const r=await fetch('/api/auth/2fa/setup/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,code,deviceName:'Studio CI'})});
   return {status:r.status,authenticated:Boolean((await r.json().catch(()=>({}))).authenticated)};
  },{challengeId:data.challengeId,code:totp(data.secret)});
  if(done.status!==200||!done.authenticated)throw Error('Studio TOTP setup failed step=setup http='+done.status);
  return {secret:data.secret,flow:'new-enrollment'};
 }
 if(data.requiresTwoFactor&&data.challengeId){
  if(!enrolledSecret)throw Error('Studio TOTP verification requires isolated enrolled fixture; step=verify secret=not-available');
  const done=await target.evaluate(async({challengeId,code})=>{
   const r=await fetch('/api/auth/2fa/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,code,deviceName:'Studio CI second session'})});
   return {status:r.status,authenticated:Boolean((await r.json().catch(()=>({}))).authenticated)};
  },{challengeId:data.challengeId,code:totp(enrolledSecret)});
  if(done.status!==200||!done.authenticated)throw Error('Studio TOTP existing enrollment verify failed step=verify http='+done.status);
  return {secret:enrolledSecret,flow:'existing-enrollment'};
 }
 throw Error('Studio login unexpected auth contract step=credentials http='+response.status+
  ' setup='+Boolean(data.requiresTwoFactorSetup)+' verify='+Boolean(data.requiresTwoFactor));
}

try{
 const first=await login(page);
 if(first.flow!=='new-enrollment')throw Error('Fresh isolated Studio fixture did not enroll TOTP');
 const secondContext=await browser.newContext({viewport:{width:390,height:844}});
 try {
  const secondPage=await secondContext.newPage();
  const second=await login(secondPage,first.secret);
  if(second.flow!=='existing-enrollment')throw Error('Existing Studio TOTP verification branch was not exercised');
  const status=await secondPage.evaluate(async()=>{
   const r=await fetch('/api/auth/session',{credentials:'same-origin'});const b=await r.json();
   return {http:r.status,authenticated:b.authenticated};
  });
  if(status.http!==200||status.authenticated!==true)throw Error('Existing TOTP session did not authenticate');
  observations.push({step:'TOTP setup and existing-account verify',status:'passed'});
 }finally{await secondContext.close()}
 await page.goto(base+'/?screen=Studio',{waitUntil:'networkidle'});
 await page.locator('.taso-studio').waitFor({state:'visible',timeout:15000});
 await page.locator('.studio-empty button').click();
 await page.locator('.studio-page-list button').first().waitFor({state:'visible'});
 const projectId=await page.locator('.studio-context select').inputValue();
 const orig=await page.evaluate(id=>fetch('/api/v1/projects/'+encodeURIComponent(id)+'/studio').then(r=>r.json()),projectId);
 if(orig.document?.version!==1)throw Error('Studio create not persisted in Core');
 page.once('dialog',dialog=>dialog.accept('Ürünler'));
 await page.locator('.studio-panel__title button').filter({hasText:'Ekle'}).first().click();
 await page.locator('.studio-page-list button').filter({hasText:'Ürünler'}).waitFor();
 await page.locator('.studio-tools__insert button').filter({hasText:'Başlık'}).click();
 await page.locator('.studio-fields textarea').fill('Gerçek Studio • İlk Sürüm');
 await page.locator('.studio-fields input[type="color"]').first().fill('#ffffff');
 await page.locator('.studio-history__save input').fill('Ürünler ilk sürüm');
 await page.locator('.studio-history__save button').click();
 await page.locator('.studio-revisions strong').filter({hasText:'Ürünler ilk sürüm'}).waitFor();
 let saved=await page.evaluate(id=>fetch('/api/v1/projects/'+encodeURIComponent(id)+'/studio').then(r=>r.json()),projectId);
 if(saved.document?.pages?.length!==2||saved.document?.revisions?.length!==1)throw Error('Studio page/revision not persisted');
 if(saved.document.pages[1]?.nodes?.[0]?.text!=='Gerçek Studio • İlk Sürüm')throw Error('Studio text not persisted');
 observations.push({step:'Core persisted document and revision',projectId,version:saved.document.version});
 await page.screenshot({path:output+'/studio-editor-1440.png',fullPage:true});
 await page.locator('.studio-fields textarea').fill('İkinci sürüm');
 await page.locator('.studio-topbar__actions button').filter({hasText:'Değişiklikleri kaydet'}).click();
 await page.getByText('Değişiklikler Core üzerinde kaydedildi.').waitFor();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('.studio-revisions button').filter({hasText:'Geri yükle'}).first().click();
 // Restoring a revision deliberately clears the selection. Re-select the persisted node.
 await page.locator('.studio-tree-item').filter({hasText:'Gerçek Studio • İlk Sürüm'}).first().click();
 await page.waitForFunction(()=>document.querySelector('.studio-fields textarea')?.value==='Gerçek Studio • İlk Sürüm',{},{timeout:15000});
 const restored=await page.evaluate(id=>fetch('/api/v1/projects/'+encodeURIComponent(id)+'/studio').then(r=>r.json()),projectId);
 if(restored.document.pages[1]?.nodes[0]?.text!=='Gerçek Studio • İlk Sürüm')throw Error('Core Studio restore did not persist correct version');
 await page.locator('.studio-code-toggle').click();
 const html=await page.locator('.studio-source').innerText();
 if(!html.includes('Gerçek Studio • İlk Sürüm')||!html.includes('<h2'))throw Error('Code / model mismatch');
 const after=await page.evaluate(id=>fetch('/api/v1/projects/'+encodeURIComponent(id)+'/studio').then(r=>r.json()),projectId);
 if(after.document.pages[1].nodes[0].text!=='Gerçek Studio • İlk Sürüm')throw Error('Restore did not persist in Core');
 observations.push({step:'HTML-model consistency and persisted restore',version:after.document.version});
 // V2 canonical tree: create a section, add a nested paragraph, and drag the
 // existing heading into that section. Test actual Core persistence, not just DOM.
 await page.locator('.studio-tools__insert button').filter({hasText:'Bölüm'}).click();
 await page.locator('.studio-tools__insert button').filter({hasText:'Metin'}).click();
 const rootHandles=page.locator('.studio-tree-row > .studio-tree-handle');
 if(await rootHandles.count()!==3)throw Error('Studio V2 layer tree must have heading, section and nested text');
 await rootHandles.first().dragTo(page.locator('.studio-tree-row').filter({hasText:'Bölüm'}).first());
 await page.locator('.studio-topbar__actions button').filter({hasText:'Değişiklikleri kaydet'}).click();
 await page.getByText('Değişiklikler Core üzerinde kaydedildi.').waitFor();
 const nested=await page.evaluate(id=>fetch('/api/v1/projects/'+encodeURIComponent(id)+'/studio').then(r=>r.json()),projectId);
 const root=nested.document.pages[1].nodes;
 if(root.length!==1||root[0].kind!=='section'||root[0].children.length!==2||
   root[0].children[0].kind!=='text'||root[0].children[1].text!=='Gerçek Studio • İlk Sürüm')
   throw Error('Studio V2 drag tree shape mismatch: '+root.map(n=>n.kind+'('+n.children.map(c=>c.kind).join(',')+')').join('|'));
 observations.push({step:'V2 desktop drag and nested Core persistence',version:nested.document.version});
 // Export is generated from the saved, authorized Core page, not from unsaved UI draft.
 const exportUrl='/api/v1/projects/'+encodeURIComponent(projectId)+'/studio/pages/'+encodeURIComponent(nested.document.pages[1].id)+'/export.html';
 const serverHtml=await page.evaluate(async url=>{
   const r=await fetch(url,{credentials:'same-origin'});
   return {status:r.status,type:r.headers.get('content-type'),html:await r.text()};
 },exportUrl);
 if(serverHtml.status!==200||!serverHtml.type.includes('text/html'))throw Error('Studio Core HTML exporter route failed');
 const source=await page.locator('.studio-source').textContent();
 if(source?.trim()!==serverHtml.html.trim())throw Error('Persisted Core HTML != editor code preview');
 const waiting=page.waitForEvent('download');
 await page.getByRole('button',{name:/HTML indir/}).click();
 const download=await waiting;
 if(!download.suggestedFilename().endsWith('.html'))throw Error('Studio downloaded wrong file format');
 observations.push({step:'Studio source matches authoritative Core HTML and downloads',download:download.suggestedFilename()});


 for(const width of [320,360,390,430,768,1024,1440,1920]){
  await page.setViewportSize({width,height:width<=430?844:1000});
  await page.locator('.studio-tools__view button').filter({hasText:'Mobil'}).click();
  if(width<=820){
   await page.locator('.studio-mobile-tabs button').filter({hasText:'Özellikler'}).click();
   await page.locator('.studio-fields textarea').waitFor({state:'visible'});
   await page.locator('.studio-mobile-tabs button').filter({hasText:'Tuval'}).click();
  }
  const sizes=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,nav:document.querySelector('.studio-mobile-tabs')?.getBoundingClientRect()?.toJSON()}));
  if(sizes.scrollWidth>width+2)throw Error('Studio horizontal overflow at '+width+': '+sizes.scrollWidth);
  await page.screenshot({path:output+'/studio-mobile-artboard-'+width+'.png',fullPage:true});
  observations.push({step:'responsive viewport',width,scrollWidth:sizes.scrollWidth});
 }
 const attacker=await page.evaluate(async id=>{
  const r=await fetch('/api/v1/projects/'+encodeURIComponent(id)+'/studio',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:1,pages:[]})});
  return r.status;
 },projectId);
 if(attacker!==409)throw Error('Core failed to reject stale Studio write');
 observations.push({step:'Stale mutation rejected',http:attacker});
 writeFileSync(output+'/studio-report.json',JSON.stringify({passed:true,observations},null,2));
}finally{await context.close();await browser.close()}
