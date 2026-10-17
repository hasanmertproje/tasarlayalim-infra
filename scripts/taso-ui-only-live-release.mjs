#!/usr/bin/env node
// One-time, existing-application UI-only release. Never modify Core or secret/volume settings.
// Reuse previously tested identity and auth preflight helpers rather than copying them.
import {
  identify, verifyDetail, verifyHistory, verifyMount, verifySession, queuedDeployment
} from './taso-core-ui-live-recover.mjs';

const API='https://coolify.tasarlayalim.com/api/v1';
const PUBLIC='https://taso.tasarlayalim.com';
const SHA=/^[0-9a-f]{40}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function asset(html) {
  return typeof html==='string' ? html.match(/\/assets\/[^"' <>]+\.js/)?.[0] : undefined;
}
export async function releaseUi({request=fetch,token,sha,pause=sleep,log=console.log}={}) {
  if(!token || !SHA.test(sha||'')) throw Error('RELEASE_IDENTITY_UNAVAILABLE');
  const api=async(method,path)=>{
    const response=await request(API+'/'+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if(!response.ok)throw Error('COOLIFY_'+method+'_HTTP_'+response.status);
    return response.json();
  };
  const publicGet=path=>request(PUBLIC+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});
  const apps=identify(await api('GET','applications'));
  const core=apps['taso-core-prod'], ui=apps['taso-ui-prod'];
  verifyDetail(await api('GET','applications/'+core.uuid),'taso-core-prod','/taso');
  verifyDetail(await api('GET','applications/'+ui.uuid),'taso-ui-prod','/taso-ui');
  verifyHistory(await api('GET','deployments/applications/'+core.uuid+'?skip=0&take=25'),'taso-core-prod');
  verifyHistory(await api('GET','deployments/applications/'+ui.uuid+'?skip=0&take=25'),'taso-ui-prod');
  verifyMount(await api('GET','applications/'+core.uuid+'/storages'));
  const [healthBefore,gatewayBefore,sessionBefore,htmlBefore]=await Promise.all([
    publicGet('/api/health'),publicGet('/api/gateway/health'),publicGet('/api/auth/session'),publicGet('/')]);
  if ([healthBefore,gatewayBefore,sessionBefore,htmlBefore].some(r=>r.status!==200))
    throw Error('EXISTING_LIVE_SYSTEM_UNHEALTHY');
  verifySession(await sessionBefore.json());
  const oldAsset=asset(await htmlBefore.text());
  if(!oldAsset)throw Error('PREVIOUS_UI_ASSET_UNVERIFIABLE');
  log('taso_ui_release=PRECHECK_PASSED core_unchanged=true gateway=HTTP_200 auth=CONFIGURED');
  const result=await api('POST','deploy?uuid='+encodeURIComponent(ui.uuid)+'&force=true');
  const deploymentId=queuedDeployment(result,ui.uuid);
  log('taso_ui_release=QUEUED target_commit='+sha);
  let finished=false;
  for(let i=0;i<225;i++){
    await pause(12000);
    const deployment=await api('GET','deployments/'+deploymentId);
    if(['failed','cancelled','cancelled-by-user'].includes(deployment?.status))
      throw Error('UI_DEPLOYMENT_'+deployment.status.toUpperCase().replaceAll('-','_'));
    if(deployment?.status==='finished'){
      const deployedSha=String(deployment.commit||deployment.git_commit_sha||'').toLowerCase();
      if(deployedSha!==sha.toLowerCase())throw Error('UI_DEPLOYED_SHA_MISMATCH');
      finished=true;
      break;
    }
  }
  if(!finished)throw Error('UI_DEPLOYMENT_TIMEOUT');
  let healthy=false;
  for(let i=0;i<35;i++){
    if((await api('GET','applications/'+ui.uuid))?.status==='running:healthy'){
      healthy=true;
      break;
    }
    await pause(12000);
  }
  if(!healthy)throw Error('UI_HEALTH_STABILIZATION_TIMEOUT');
  const [healthAfter,gatewayAfter,sessionAfter,htmlAfter]=await Promise.all([
    publicGet('/api/health'),publicGet('/api/gateway/health'),publicGet('/api/auth/session'),publicGet('/')]);
  if([healthAfter,gatewayAfter,sessionAfter,htmlAfter].some(r=>r.status!==200))
    throw Error('POSTDEPLOY_PUBLIC_HEALTH_FAILED');
  verifySession(await sessionAfter.json());
  const newAsset=asset(await htmlAfter.text());
  if(!newAsset || newAsset===oldAsset)throw Error('UI_BUILD_ASSET_UNCHANGED');
  log('taso_ui_release=SUCCESS commit='+sha+' ui_status=HEALTHY gateway=HTTP_200 new_ui_asset=true core_unchanged=true');
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    await releaseUi({token:process.env.COOLIFY_API_TOKEN,sha:process.env.GITHUB_SHA});
  }catch(e){
    const reason=e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)?e.message:'UNKNOWN';
    console.error('taso_ui_release=FAILED reason='+reason);
    process.exitCode=1;
  }
}
