#!/usr/bin/env node
// Read-only evidence from production Coolify; never print raw API responses or secrets.
const BASE = 'https://coolify.tasarlayalim.com/api/v1';
const DOMAIN = 'https://taso.tasarlayalim.com';
const sha = /^[0-9a-f]{40}$/i, id = /^[a-zA-Z0-9_-]{5,64}$/;
const SERVICES = [
  ['taso-ui-prod', null], ['taso-core-prod', '/data'],
  ['taso-search-prod', null], ['taso-browser-prod', null],
  ['taso-speaker-prod', '/data'], ['taso-voice-prod', '/voices'],
];
export function finishedCommit(payload) {
  const rows = Array.isArray(payload) ? payload :
    Array.isArray(payload?.deployments) ? payload.deployments :
    Array.isArray(payload?.data) ? payload.data : [];
  const newest = rows.filter(r => r?.status === 'finished' && sha.test(r.commit ?? r.git_commit_sha ?? ''))
    .sort((a,b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
  return newest ? String(newest.commit ?? newest.git_commit_sha).toLowerCase() : 'UNKNOWN';
}
export function inventory(apps) {
  if (!Array.isArray(apps)) throw Error('INVALID_RESPONSE');
  const domainOwners = apps.filter(a => String(a?.fqdn ?? '').split(',').some(d => d.trim() === DOMAIN)).length;
  return {
    domain: domainOwners === 1 ? 'UNIQUE' : domainOwners === 0 ? 'MISSING' : 'CONFLICT',
    rows: SERVICES.map(([name, mount]) => {
      const found = apps.filter(a => a?.name === name);
      return {name, mount, uuid: found.length === 1 && id.test(found[0].uuid) ? found[0].uuid : null,
        match: found.length === 1 ? 'UNIQUE' : found.length ? 'AMBIGUOUS' : 'MISSING'};
    }),
  };
}
export function storageStatus(payload, mount) {
  if (!Array.isArray(payload?.persistent_storages)) return 'UNVERIFIABLE';
  return payload.persistent_storages.some(s => s?.mount_path === mount) ? 'PRESENT' : 'MISSING';
}
export function gatewayMetadata(payload) {
  if (!Array.isArray(payload)) return 'UNVERIFIABLE';
  const rows = payload.filter(x => x?.key === 'TASO_GATEWAY_SECRET' && x?.is_preview !== true);
  return rows.length === 1 ? 'KEY_PRESENT_VALUE_UNVERIFIED' : rows.length ? 'DUPLICATED' : 'MISSING';
}
function status(value) {
  if (value === 'running:healthy') return 'HEALTHY_REPORTED';
  if (value === 'running:unknown' || value === 'running') return 'RUNNING_UNKNOWN';
  if (value === 'running:unhealthy') return 'UNHEALTHY';
  if (typeof value === 'string' && (value.startsWith('exited:') || value === 'stopped')) return 'STOPPED';
  return 'UNKNOWN';
}
export async function collect(fetcher, token, main) {
  if (!token || !sha.test(main)) throw Error('INVALID_INPUT');
  async function get(path) {
    const response = await fetcher(BASE + '/' + path, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {authorization: 'Bearer ' + token, accept: 'application/json'},
    });
    if (!response.ok) throw Error('COOLIFY_GET_FAILED');
    return response.json();
  }
  const all = inventory(await get('applications'));
  const reports = [];
  for (const app of all.rows) {
    if (!app.uuid) {
      reports.push({name:app.name, match:app.match, state:'UNKNOWN', branch:'UNKNOWN',
        storage:app.mount ? 'UNVERIFIABLE' : 'N/A', lastFinishedCommit:'UNKNOWN'});
      continue;
    }
    const detail = await get('applications/' + app.uuid);
    const history = await get('deployments/applications/' + app.uuid + '?skip=0&take=25').catch(() => null);
    const storage = app.mount ? await get('applications/' + app.uuid + '/storages').catch(() => null) : null;
    reports.push({name:app.name, match:app.match, state:status(detail?.status),
      branch:detail?.git_branch === 'main' ? 'main' : 'OTHER_OR_UNKNOWN',
      storage:app.mount ? storageStatus(storage, app.mount) : 'N/A',
      lastFinishedCommit:finishedCommit(history)});
  }
  const gateway = {};
  for (const name of ['taso-core-prod','taso-ui-prod']) {
    const app = all.rows.find(x => x.name === name);
    const envs = app?.uuid ? await get('applications/' + app.uuid + '/envs').catch(() => null) : null;
    gateway[name] = gatewayMetadata(envs);
  }
  const backups = await get('s3-storages').catch(() => null);
  const offsite = !Array.isArray(backups) ? 'UNVERIFIABLE' :
    backups.some(x => x?.is_usable === true) ? 'USABLE_TARGET_ONLY' : 'NOT_USABLE';
  const current = reports.filter(x => x.name === 'taso-ui-prod' || x.name === 'taso-core-prod');
  const atHead = current.every(x => x.lastFinishedCommit === main.toLowerCase());
  // A finished deployment record does not prove which image currently runs.
  return {domain:all.domain, reports, gateway, offsite, atHead, decision:'NO_GO',
    reasons:['RUNTIME_IMAGE_UNVERIFIED','GATEWAY_EQUALITY_UNVERIFIED','BACKUP_RESTORE_UNVERIFIED',
      'AUTHENTICATED_ACCEPTANCE_UNVERIFIED',...(!atHead?['LAST_FINISHED_DEPLOYMENTS_NOT_MAIN']:[])]};
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const data = await collect(fetch, process.env.COOLIFY_API_TOKEN || '', process.env.GITHUB_SHA || '');
    console.log('coolify_readonly_evidence=COLLECTED domain_owner=' + data.domain);
    for (const r of data.reports) console.log('service=' + r.name + ' match=' + r.match +
      ' status=' + r.state + ' branch=' + r.branch + ' storage=' + r.storage +
      ' last_finished_deployment_sha=' + r.lastFinishedCommit);
    console.log('core_gateway=' + data.gateway['taso-core-prod']);
    console.log('ui_gateway=' + data.gateway['taso-ui-prod']);
    console.log('s3_backup_target=' + data.offsite);
    console.log('release_decision=' + data.decision + ' reasons=' + data.reasons.join(','));
  } catch {
    // Never print raw exceptions, tokens, response bodies or environment values.
    console.log('coolify_readonly_evidence=UNAVAILABLE');
    process.exitCode = 2;
  }
}
