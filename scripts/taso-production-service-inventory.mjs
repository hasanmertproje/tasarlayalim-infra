#!/usr/bin/env node
// Non-mutating, non-secret Coolify production service inventory.
const base = 'https://coolify.tasarlayalim.com/api/v1';
export const services = [
  {name:'taso-ui-prod',mount:null},
  {name:'taso-core-prod',mount:'/data'},
  {name:'taso-search-prod',mount:null},
  {name:'taso-browser-prod',mount:null},
  {name:'taso-speaker-prod',mount:'/data'},
  {name:'taso-voice-prod',mount:'/voices'},
];
const safe = value => typeof value === 'string' && /^[A-Za-z0-9_:./-]{1,80}$/.test(value) ? value : 'UNKNOWN';
const validId = s => typeof s==='string' && /^[A-Za-z0-9_-]{5,64}$/.test(s);
async function request(url, f, token) {
  const response = await f(url,{
    method:'GET',
    headers: {authorization:'Bearer '+token,accept:'application/json'},
    signal:AbortSignal.timeout(20000),
    redirect:'error',
  });
  if(!response.ok)throw Error('coolify_api_status='+response.status);
  return response.json();
}
export async function inventory(f, token) {
  if(!token)throw Error('COOLIFY_API_TOKEN missing');
  const all=await request(base+'/applications',f,token);
  if(!Array.isArray(all))throw Error('Invalid applications list');
  const ownerCount=all.filter(a=>String(a?.fqdn??'').split(',').some(d=>d.trim()==='https://taso.tasarlayalim.com')).length;
  const rows=[];
  for(const service of services) {
    const match=all.filter(a=>a?.name===service.name);
    if(match.length!==1 || !validId(match[0].uuid)){
      rows.push({name:service.name,state:match.length===0?'NOT_FOUND':'AMBIGUOUS',branch:'UNKNOWN',storage:service.mount?'UNKNOWN':'N/A'});
      continue;
    }
    const uuid=match[0].uuid;
    const [detail,storage]=await Promise.all([
      request(base+'/applications/'+uuid,f,token),
      service.mount?request(base+'/applications/'+uuid+'/storages',f,token):Promise.resolve(null),
    ]);
    const mounts=storage?.persistent_storages;
    rows.push({
      name:service.name,
      state:safe(detail.status),
      branch:safe(detail.git_branch),
      storage:service.mount?(Array.isArray(mounts)&&mounts.some(x=>x?.mount_path===service.mount)?'PRESENT':'MISSING'):'N/A',
    });
  }
  return {domainOwner:ownerCount===1?'UNIQUE':ownerCount===0?'MISSING':'CONFLICT',rows};
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const data=await inventory(fetch,process.env.COOLIFY_API_TOKEN||'');
    console.log('domain_ownership='+data.domainOwner);
    console.log('| Production app | Coolify state | Branch | Persistent mount |');
    console.log('|---|---|---|---|');
    for(const a of data.rows)console.log('| '+a.name+' | '+a.state+' | '+a.branch+' | '+a.storage+' |');
    if(data.domainOwner!=='UNIQUE' || data.rows.some(x=>x.state==='NOT_FOUND'||x.state==='AMBIGUOUS'||x.storage==='MISSING'))process.exitCode=1;
  }catch(e){
    // Never print secret-bearing API response bodies or environment values.
    console.log('coolify_production_inventory=UNAVAILABLE');
    process.exitCode=2;
  }
}
