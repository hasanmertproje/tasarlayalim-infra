#!/usr/bin/env node
// One-shot, in-place release of only TASO Core and UI. No env or volume updates.
// The GitHub Actions runner holds the Coolify token; never log raw API responses.
const BASE = 'https://coolify.tasarlayalim.com/api/v1';
const PUBLIC = 'https://taso.tasarlayalim.com';
const REPO = 'hasanmertproje/tasarlayalim-infra';
const SHA = /^[a-f0-9]{40}$/i;
const UUID = /^[a-zA-Z0-9_-]{5,64}$/;
const EXPECTED = Object.freeze({'taso-core-prod':'/taso','taso-ui-prod':'/taso-ui'});
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));

export function identify(apps) {
  if (!Array.isArray(apps)) throw Error('APP_INVENTORY_UNAVAILABLE');
  const result = {};
  for (const [name, base] of Object.entries(EXPECTED)) {
    const matches=apps.filter(a=>a?.name===name);
    if (matches.length!==1 || !UUID.test(matches[0].uuid||'')) throw Error(name+'_IDENTITY_AMBIGUOUS');
    result[name]={uuid:matches[0].uuid,base};
  }
  const owners=apps.filter(a=>String(a?.fqdn||'').split(',').map(x=>x.trim()).includes(PUBLIC));
  if(owners.length!==1 || owners[0].uuid!==result['taso-ui-prod'].uuid) throw Error('DOMAIN_NOT_UNIQUE_UI');
  return result;
}
export function verifyDetail(detail,name,base) {
  if (detail?.name!==name || detail?.git_branch!=='main' || detail?.git_repository!==REPO ||
      detail?.base_directory!==base || detail?.environment_id!==2) throw Error(name+'_SOURCE_IDENTITY_MISMATCH');
  if (detail?.status!=='running:healthy') throw Error(name+'_NOT_HEALTHY_PREDEPLOY');
  return true;
}
export function verifyMount(mounts) {
  if (!Array.isArray(mounts?.persistent_storages) ||
      mounts.persistent_storages.filter(s=>s?.mount_path==='/data').length!==1)
    throw Error('CORE_DATA_VOLUME_NOT_UNIQUE');
  return true;
}
export function verifyHistory(input,name) {
  const rows=Array.isArray(input)?input:Array.isArray(input?.deployments)?input.deployments:null;
  if (!rows) throw Error(name+'_DEPLOYMENT_HISTORY_UNVERIFIABLE');
  if(rows.some(r=>['queued','pending','in_progress','running'].includes(r?.status)))
    throw Error(name+'_DEPLOYMENT_ALREADY_ACTIVE');
  if(!rows.some(r=>r?.status==='finished' && SHA.test(r?.commit||r?.git_commit_sha||'')))
    throw Error(name+'_NO_PREVIOUS_RELEASE');
  return true;
}
export function verifySession(session) {
  if(session?.configured!==true || session?.authenticated!==false)
    throw Error('OWNER_SESSION_BOUNDARY_NOT_VERIFIED');
  return true;
}
export function queuedDeployment(data, uuid) {
  const entries=data?.deployments;
  if(!Array.isArray(entries)) throw Error('DEPLOYMENT_NOT_QUEUED');
  const matches=entries.filter(x=>x?.resource_uuid===uuid && UUID.test(x?.deployment_uuid||''));
  if(matches.length!==1) throw Error('DEPLOYMENT_NOT_QUEUED');
  return matches[0].deployment_uuid;
}
export async function run({request=fetch, token, sha, pause=wait, log=console.log}={}) {
  if(!token || !SHA.test(sha||'')) throw Error('RELEASE_AUTH_OR_SHA_UNAVAILABLE');
  const access=async (method,path)=>{
    const response=await request(BASE+'/'+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if(!response.ok) throw Error('COOLIFY_'+method+'_HTTP_'+response.status);
    return await response.json();
  };
  const external=async path=>request(PUBLIC+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});
  const target=identify(await access('GET','applications'));
  for(const [name,item] of Object.entries(target)) {
    verifyDetail(await access('GET','applications/'+item.uuid),name,item.base);
    verifyHistory(await access('GET','deployments/applications/'+item.uuid+'?skip=0&take=25'),name);
  }
  verifyMount(await access('GET','applications/'+target['taso-core-prod'].uuid+'/storages'));
  const sessionBefore=await external('/api/auth/session');
  if(!sessionBefore.ok) throw Error('SESSION_PREFLIGHT_HTTP_'+sessionBefore.status);
  verifySession(await sessionBefore.json());
  const oldHtml=await external('/');
  const previousHtml=oldHtml.ok?await oldHtml.text():'';
  const oldAsset=previousHtml.match(/\/assets\/[^"' ]+\.js/)?.[0]||'UNKNOWN';
  log('taso_live_recovery=PRECHECK_PASSED core_volume=PRESENT owner_auth=CONFIGURED production_mutations=NONE');
  const deploy=async name=>{
    const item=target[name];
    // Sole production mutation: deploy the existing app at main, without env or volume writes.
    const reply=await access('POST','deploy?uuid='+encodeURIComponent(item.uuid)+'&force=true');
    const deploymentId=queuedDeployment(reply,item.uuid);
    log('deployment_queued='+name+' sha_target='+sha);
    let details;
    for(let attempt=0;attempt<225;attempt++) {
      await pause(12000);
      details=await access('GET','deployments/'+deploymentId);
      if(['failed','cancelled','cancelled-by-user'].includes(details?.status))
        throw Error(name+'_DEPLOYMENT_'+String(details.status).toUpperCase());
      if(details?.status==='finished') break;
      if(attempt===224) throw Error(name+'_DEPLOYMENT_TIMEOUT');
    }
    if(details?.status!=='finished') throw Error(name+'_DEPLOYMENT_NOT_FINISHED');
    if(String(details?.commit||'').toLowerCase()!==sha.toLowerCase())
      throw Error(name+'_DEPLOYED_SHA_MISMATCH');
    for(let i=0;i<35;i++) {
      const state=await access('GET','applications/'+item.uuid);
      if(state?.status==='running:healthy') {
        log('deployment_finished='+name+' commit='+sha+' coolify_status=HEALTHY');
        return;
      }
      if(i===34)throw Error(name+'_HEALTH_STABILIZATION_TIMEOUT');
      await pause(12000);
    }
  };
  // New UI container health requires Core's /gateway/health: Core must deploy first.
  await deploy('taso-core-prod');
  const gateway=await external('/api/gateway/health');
  if(gateway.status!==200) throw Error('CORE_UPDATED_BUT_GATEWAY_HTTP_'+gateway.status);
  log('gateway_health_after_core=HTTP_200');
  await deploy('taso-ui-prod');
  const coreHealth=await external('/api/health');
  const gateHealth=await external('/api/gateway/health');
  const sessionAfter=await external('/api/auth/session');
  const main=await external('/');
  if(coreHealth.status!==200 || gateHealth.status!==200 || sessionAfter.status!==200 || main.status!==200)
    throw Error('POSTDEPLOY_PUBLIC_ROUTE_FAILED');
  verifySession(await sessionAfter.json());
  const newHtml=await main.text();
  const newAsset=newHtml.match(/\/assets\/[^"' ]+\.js/)?.[0]||'UNKNOWN';
  if(newAsset==='UNKNOWN' || newAsset===oldAsset) throw Error('UI_ASSET_NOT_CHANGED_OR_UNVERIFIABLE');
  log('taso_live_recovery=SUCCESS public_gateway=HTTP_200 public_core=HTTP_200 owner_auth=CONFIGURED ui_asset_changed=true main_sha='+sha);
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  try { await run({token:process.env.COOLIFY_API_TOKEN,sha:process.env.GITHUB_SHA}); }
  catch(e) { console.error('taso_live_recovery=FAILED reason='+
    (e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)?e.message:'UNKNOWN'));process.exitCode=1; }
}
