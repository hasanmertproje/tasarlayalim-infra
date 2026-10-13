import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';

const base = process.env.TASO_VISUAL_BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => sessionStorage.setItem('taso-default-landing-applied','1'));

function totp(secret) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
 let bits=0, acc=0, out=[];
 for(const char of secret.toUpperCase().replace(/[^A-Z2-7]/g,'')) {
  acc=(acc<<5)|alphabet.indexOf(char);bits+=5;
  if(bits>=8){out.push((acc>>>(bits-8))&255);bits-=8}
 }
 const counter=Buffer.alloc(8);
 counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',Buffer.from(out)).update(counter).digest();
 const offset=digest[digest.length-1]&15;
 const value=((digest[offset]&127)<<24)|((digest[offset+1]&255)<<16)|((digest[offset+2]&255)<<8)|(digest[offset+3]&255);
 return String(value%1000000).padStart(6,'0');
}
async function api(path,options={}) {
 return page.evaluate(async ({path,options})=>{
  const response=await fetch('/api'+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  let data;try{data=await response.json()}catch{data={}}
  return {status:response.status,data};
 },{path,options});
}
try {
 await page.goto(base,{waitUntil:'networkidle'});
 const login=await api('/auth/login',{method:'POST',body:JSON.stringify({email:'owner@ci.local',password:'ci-password'})});
 if(login.data.requiresTwoFactorSetup){
  const result=await api('/auth/2fa/setup/confirm',{method:'POST',body:JSON.stringify({challengeId:login.data.challengeId,code:totp(login.data.secret),deviceName:'Lifecycle acceptance'})});
  if(!result.data.authenticated)throw Error('CI owner 2FA setup failed');
 }else if(!login.data.authenticated)throw Error('CI owner login failed');
 const create=await api('/v1/projects',{method:'POST',body:JSON.stringify({name:'Lifecycle Acceptance',slug:'lifecycle-test-project',repository:'example/lifecycle-test-project',isExisting:true})});
 if(create.status!==201)throw Error('Project create failed: '+create.status);
 const id=create.data.project.id;
 const pending=await api('/v1/missions',{method:'POST',body:JSON.stringify({projectId:id,objective:'Human approval test',riskLevel:'HIGH_IMPACT',dataClass:'private_code'})});
 if(pending.status!==201||pending.data.mission.status!=='waiting_approval')throw Error('Expected approval-pending mission');
 const blocked=await api('/v1/projects/'+id+'/lifecycle',{method:'POST',body:JSON.stringify({action:'archive'})});
 if(blocked.status!==409)throw Error('Archive must reject pending missions');
 const cancelled=await api('/v1/missions/'+pending.data.mission.id+'/cancel',{method:'POST'});
 if(cancelled.status!==200)throw Error('Failed to cancel test mission');
 await page.goto(base+'/?screen=Projects',{waitUntil:'networkidle'});
 const shell=page.locator('.pc9-shell');
 await shell.waitFor({state:'visible',timeout:10000});
 await shell.locator('.pc9-project-list .pc9-list-scroll button').filter({hasText:'Lifecycle Acceptance'}).click();
 await shell.locator('.pc9-hero').getByRole('button',{name:'Arşivle'}).click();
 const archived=await api('/v1/projects');
 if(archived.data.projects.find(p=>p.id===id)?.lifecycleStatus!=='archived')throw Error('Archive did not persist');
 const inactiveMission=await api('/v1/missions',{method:'POST',body:JSON.stringify({projectId:id,objective:'Must not run',riskLevel:'READ',dataClass:'public'})});
 if(inactiveMission.status===201)throw Error('Inactive project accepted new mission');
 const row=shell.locator('.pc9-lifecycle-row').filter({hasText:'Lifecycle Acceptance'});
 page.once('dialog',dialog=>dialog.accept());
 await row.getByRole('button',{name:'Çöpe taşı'}).click();
 const trashed=await api('/v1/projects');
 if(trashed.data.projects.find(p=>p.id===id)?.lifecycleStatus!=='trashed')throw Error('Trash did not persist');
 await page.goto(base+'/?screen=Projects',{waitUntil:'networkidle'});
 const restore=page.locator('.pc9-lifecycle-row').filter({hasText:'Lifecycle Acceptance'});
 await restore.getByRole('button',{name:'Geri yükle'}).click();
 const restored=await api('/v1/projects');
 const current=restored.data.projects.find(p=>p.id===id);
 if(current?.lifecycleStatus!=='active'||current.repository!=='example/lifecycle-test-project')throw Error('Restore lost project data');
 console.log('PASS: authenticated project archive, trash, restore, mission guard and data retention');
}finally{await browser.close()}
