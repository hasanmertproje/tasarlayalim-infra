/** Read-only, redacted Coolify production auth evidence. Never print raw logs or environment values. */
import {pathToFileURL} from 'node:url';
import {request} from 'node:https';
const base='https://coolify.tasarlayalim.com/api/v1/';
const patterns={
  totp_decrypt:/unable to authenticate data|ERR_OSSL_EVP_BAD_DECRYPT|auth\.totp_decryption_unavailable|Unsupported state|bad decrypt|invalid auth(?:entication)? tag/i,
  security_storage:/auth\.(?:trusted_device_persist_failed|recovery_persist_failed)|EACCES|EPERM|ENOSPC|EROFS|permission denied|read.only file system|no space left on device/i,
  missing_state:/auth\.totp_missing|ENOENT|no such file or directory/i,
  auth_verify:/\/(?:api\/)?auth\/2fa\/verify/i,
  server_500:/(?:statusCode|status_code|status)"?\s*:\s*500|internal server error|\/(?:api\/)?auth\/2fa\/verify[^\n]{0,100}\b500\b/i,
};
function timestamp(line){
  try{
    const j=JSON.parse(line),v=j.time??j.timestamp??j.at;
    const n=typeof v==='number'?(v>1e12?v:v*1000):Date.parse(String(v??''));
    if(Number.isFinite(n))return n;
  }catch{}
  const found=line.match(/20\d\d-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?/);
  const n=found?Date.parse(found[0].replace(' ','T')):NaN;
  return Number.isFinite(n)?n:null;
}
export function analyze(logText){
  const summary=Object.fromEntries(Object.keys(patterns).map(k=>[k,0]));
  const windowCounts=Object.fromEntries(Object.keys(patterns).map(k=>[k,0]));
  const from=Date.parse('2026-10-28T07:05:00Z'),to=Date.parse('2026-10-28T07:35:00Z');
  let rows=0,timed=0,first=null,last=null;
  for(const line of logText.split(/\r?\n/)){
    if(!line.trim())continue;
    rows++;
    const ts=timestamp(line);
    if(ts!==null){timed++;first=first===null?ts:Math.min(first,ts);last=last===null?ts:Math.max(last,ts)}
    for(const [k,re] of Object.entries(patterns)){
      if(re.test(line)){summary[k]++;if(ts!==null&&ts>=from&&ts<=to)windowCounts[k]++}
    }
  }
  const iso=n=>n===null?'UNAVAILABLE':new Date(n).toISOString().slice(0,16)+'Z';
  return {rows,timestamped:timed,firstUTC:iso(first),lastUTC:iso(last),summary,windowCounts,windowUTC:'2026-10-28 07:05-07:35 UTC'};
}
// Fallback uses only the repository's preconfigured server IPv4. TLS hostname and
// certificate verification still target coolify.tasarlayalim.com. No redirects.
const pinnedAddress='45.74.243.96';
let pinned=false;
function getPinned(path,token){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;resolve(value)};
    const req=request({
      protocol:'https:',hostname:'coolify.tasarlayalim.com',port:443,
      path:'/api/v1/'+path,method:'GET',servername:'coolify.tasarlayalim.com',
      lookup:(hostname,options,done)=>done(null,pinnedAddress,4),
      rejectUnauthorized:true,timeout:18000,
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    },res=>{
      const code=res.statusCode||0;
      let data='',overflow=false;
      res.on('data',chunk=>{
        data+=String(chunk);
        if(data.length>14000000){overflow=true;req.destroy()}
      });
      res.on('end',()=>{
        if(overflow){finish({code:'RESPONSE_TOO_LARGE',data:null});return}
        if(code!==200){finish({code,data:null});return}
        try{finish({code,data:JSON.parse(data)})}
        catch{finish({code:'BAD_JSON',data:null})}
      });
    });
    req.on('timeout',()=>req.destroy());
    req.on('error',e=>{
      const c=String(e?.code||e?.name||'UNKNOWN').replace(/[^A-Z_]/gi,'').slice(0,35);
      finish({code:'PINNED_TLS_OR_NETWORK_'+c,data:null})
    });
    req.end();
  })
}
async function get(path,token){
  if(pinned)return getPinned(path,token);
  try{
    const res=await fetch(base+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!res.ok)return {code:res.status,data:null};
    return {code:res.status,data:await res.json().catch(()=>null)};
  }catch(e){
    const c=String(e?.cause?.code||e?.code||e?.name||'UNKNOWN').replace(/[^A-Z_]/gi,'').slice(0,35);
    console.log('dns_transport_failed='+c);
    const alternate=await getPinned(path,token);
    if(alternate.code===200){pinned=true;console.log('coolify_transport=PINNED_IPV4_WITH_TLS_HOSTNAME_VERIFICATION')}
    return alternate;
  }
}
export async function main(){
  const token=process.env.COOLIFY_API_TOKEN?.trim();
  if(!token){console.log('token=MISSING_REPOSITORY_SECRET');process.exitCode=2;return}
  const apps=await get('applications',token);
  if(apps.code!==200){console.log('applications_http='+apps.code);process.exitCode=2;return}
  const list=Array.isArray(apps.data)?apps.data:apps.data?.data;
  const found=Array.isArray(list)?list.filter(a=>a?.name==='taso-core-prod'):[];
  if(found.length!==1){console.log('app_match='+(found.length?'AMBIGUOUS':'NOT_FOUND'));process.exitCode=2;return}
  const uuid=found[0].uuid;
  if(typeof uuid!=='string'||!/^[a-z0-9]{16,64}$/i.test(uuid)){console.log('app_uuid=INVALID');process.exitCode=2;return}
  const detail=await get('applications/'+uuid,token);
  if(detail.code!==200||detail.data?.name!=='taso-core-prod'){console.log('app_identity=FAILED');process.exitCode=2;return}
  const id=Number(detail.data.environment_id);
  if(Number.isFinite(id)&&id!==2){console.log('environment=UNEXPECTED; aborting');process.exitCode=2;return}
  console.log('app=taso-core-prod');
  console.log('environment_id='+(Number.isFinite(id)?id:'UNKNOWN'));
  console.log('app_status='+String(detail.data.status||'UNKNOWN').replace(/[^a-zA-Z0-9:_-]/g,'').slice(0,50));
  const volumes=await get('applications/'+uuid+'/storages',token);
  if(volumes.code===200){
    const arr=volumes.data?.persistent_storages??volumes.data;
    console.log('data_mount='+(Array.isArray(arr)?(arr.some(a=>a?.mount_path==='/data')?'CONFIGURED':'NOT_FOUND'):'UNKNOWN'));
  }else console.log('storage_http='+volumes.code);
  const env=await get('applications/'+uuid+'/envs',token);
  if(env.code===200&&Array.isArray(env.data)){
    for(const name of ['TASO_AUTH_ENCRYPTION_KEY','TASO_AUTH_SECURITY_FILE','TASO_GATEWAY_SECRET'])console.log('env_'+name+'='+(env.data.some(e=>e?.key===name)?'CONFIGURED':'NOT_LISTED'));
  }else console.log('env_metadata_http='+env.code);
  const logs=await get('applications/'+uuid+'/logs?lines=12000&show_timestamps=true',token);
  console.log('runtime_logs_http='+logs.code);
  if(logs.code===403){console.log('logs=READ_SENSITIVE_SCOPE_REQUIRED');process.exitCode=3;return}
  if(logs.code!==200||typeof logs.data?.logs!=='string'){console.log('logs=NOT_ACCESSIBLE_OR_UNSUPPORTED');process.exitCode=3;return}
  const metrics=analyze(logs.data.logs);
  console.log('lines_scanned='+metrics.rows);
  console.log('timestamped_lines='+metrics.timestamped);
  console.log('first_utc='+metrics.firstUTC);
  console.log('last_utc='+metrics.lastUTC);
  console.log('target_incident_window_utc='+metrics.windowUTC);
  for(const [k,v] of Object.entries(metrics.summary))console.log('all_'+k+'='+v);
  for(const [k,v] of Object.entries(metrics.windowCounts))console.log('incident_'+k+'='+v);
  console.log('safety=READ_ONLY;raw_logs=NEVER_PRINTED;secret_values=NEVER_PRINTED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.log('diagnostic=FAILED_SAFELY');process.exitCode=4});
}
