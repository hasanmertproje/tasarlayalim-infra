import http from 'node:http';

const secret = process.env.COOLIFY_EVENT_SECRET || '';
const ntfyBase = process.env.NTFY_BASE_URL || '';
const ntfyTopic = process.env.NTFY_TOPIC || '';
const ntfyToken = process.env.NTFY_TOKEN || '';
const port = Number(process.env.PORT || 8080);
const selfUuid = process.env.COOLIFY_RESOURCE_UUID || '';
const sourceCommit = process.env.SOURCE_COMMIT || '';
let selfStartupNotified = false;
let services;
try { services = JSON.parse(process.env.DEPLOY_SERVICES_JSON || '{}'); } catch { throw new Error('Invalid DEPLOY_SERVICES_JSON'); }
const startupChecks = {
  COOLIFY_EVENT_SECRET: secret ? (secret.length >= 32 ? 'ok' : 'too-short') : 'missing',
  NTFY_BASE_URL: ntfyBase ? 'ok' : 'missing',
  NTFY_TOPIC: ntfyTopic ? 'ok' : 'missing',
  NTFY_TOKEN: ntfyToken ? 'ok' : 'missing',
  DEPLOY_SERVICES_JSON: Object.keys(services).length ? 'ok' : 'empty',
};
if (Object.values(startupChecks).some(status => status !== 'ok')) {
  throw new Error('Startup configuration invalid: ' + Object.entries(startupChecks).map(([key, status]) => `${key}=${status}`).join(', '));
}
const seen = new Map();
const clean = () => { for (const [key, timestamp] of seen) if (Date.now() - timestamp > 86400000) seen.delete(key); };
function serviceFor(event) {
  if (!event.application_uuid || typeof event.application_uuid !== 'string') return null;
  if (selfUuid && event.application_uuid === selfUuid) {
    return { name: 'taso-deploy-events', uuid: selfUuid, localHealth: true };
  }
  const found = Object.entries(services).find(([, v]) => v && v.uuid === event.application_uuid);
  return found ? { name: found[0], ...found[1] } : null;
}
async function healthcheck(service) {
  if (service.localHealth) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        if (response.ok) return true;
      } catch {}
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  }
  if (!service.healthUrl) return false;
  const u = new URL(service.healthUrl);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (response.ok) return true;
    } catch {}
    if (attempt < 1) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}
async function publish(status, title, message, link) {
  const url = new URL(ntfyBase.replace(/\/$/, '') + '/');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ntfy must use credential-free HTTPS URL');
  const payload = {
    topic: ntfyTopic,
    title,
    message,
    priority: status === 'failed' ? 5 : 3,
    tags: [status === 'failed' ? 'rotating_light' : 'white_check_mark'],
  };
  if (link && link.startsWith('https://')) payload.click = link;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + ntfyToken,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error('ntfy rejected request: HTTP ' + response.status + (responseText ? ' ' + responseText.slice(0, 200) : ''));
      let result;
      try { result = JSON.parse(responseText); } catch { throw new Error('ntfy returned invalid JSON'); }
      if (!result?.id) throw new Error('ntfy did not return a message id');
      return result.id;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}
async function notifySelfStartup() {
  const service = { name: 'taso-deploy-events', localHealth: true };
  const healthy = await healthcheck(service);
  const shortCommit = sourceCommit ? sourceCommit.slice(0, 8) : 'unknown';
  const failed = !healthy;
  const title = failed ? 'MÜDAHALE GEREKİYOR · taso-deploy-events' : 'YAYIN TAMAMLANDI · taso-deploy-events';
  const message = failed
    ? `Yeni bridge container ayağa kalktı ancak lokal sağlık kontrolü geçmedi. Commit: ${shortCommit}`
    : `Yeni bridge container sağlıklı ayağa kalktı. Commit: ${shortCommit}`;
  try {
    const ntfyId = await publish(failed ? 'failed' : 'success', title, message);
    selfStartupNotified = true;
    console.log(`self-startup notified healthy=${healthy} source_commit=${shortCommit} ntfy_id=${ntfyId}`);
  } catch (error) {
    console.error(`self-startup notification failed healthy=${healthy} source_commit=${shortCommit}:`, error.message);
  }
}
async function processEvent(event) {
  if (!event || !['deployment_success', 'deployment_failed'].includes(event.event)) {
    console.log(`deploy-event ignored reason=ignored_event event=${event?.event || 'missing'}`);
    return { accepted: false, reason: 'ignored_event' };
  }
  if (event.pull_request_id != null) {
    console.log(`deploy-event ignored reason=preview event=${event.event}`);
    return { accepted: false, reason: 'preview_ignored' };
  }
  const service = serviceFor(event);
  if (!service || !event.deployment_uuid || typeof event.deployment_uuid !== 'string') {
    console.log(`deploy-event ignored reason=unknown_resource event=${event.event} application_uuid=${event.application_uuid || 'missing'} deployment_uuid=${typeof event.deployment_uuid === 'string' ? 'present' : 'missing'} self_uuid=${selfUuid ? 'present' : 'missing'} self_match=${Boolean(selfUuid && event.application_uuid === selfUuid)}`);
    return { accepted: false, reason: 'unknown_resource' };
  }
  if (service.localHealth && selfStartupNotified) {
    console.log(`deploy-event duplicate reason=self_startup_already_notified event=${event.event} deployment_uuid=${event.deployment_uuid}`);
    return { accepted: true, duplicate: true, reason: 'self_startup_already_notified' };
  }
  clean();
  const key = event.event + ':' + event.application_uuid + ':' + event.deployment_uuid;
  if (seen.has(key)) {
    console.log(`deploy-event duplicate event=${event.event} service=${service.name} deployment_uuid=${event.deployment_uuid}`);
    return { accepted: true, duplicate: true };
  }
  const healthy = event.event === 'deployment_success' && await healthcheck(service);
  const failed = event.event === 'deployment_failed' || !healthy;
  const title = failed ? 'MÜDAHALE GEREKİYOR · ' + service.name : 'YAYIN TAMAMLANDI · ' + service.name;
  const message = failed
    ? (event.event === 'deployment_failed' ? 'Coolify deployment başarısız oldu.' : 'Coolify deployment tamamlandı ancak sağlık kontrolü geçmedi.')
    : 'Coolify deployment tamamlandı ve servis sağlık kontrolünü geçti.';
  const ntfyId = await publish(failed ? 'failed' : 'success', title, message, service.dashboardUrl);
  seen.set(key, Date.now());
  if (service.localHealth) selfStartupNotified = true;
  console.log(`deploy-event notified event=${event.event} service=${service.name} deployment_uuid=${event.deployment_uuid} healthy=${healthy} ntfy_id=${ntfyId}`);
  return { accepted: true, notified: true, healthy, ntfy_id: ntfyId };
}
const server = http.createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'taso-deploy-events' });
  if (req.method !== 'POST' || req.url !== '/events/' + secret) return send(404, { error: 'not_found' });
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: 'unsupported_media_type' });
  let data = '';
  try {
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 16384) return send(413, { error: 'too_large' });
    }
    const result = await processEvent(JSON.parse(data));
    return send(200, result);
  } catch (error) {
    console.error('deploy-event delivery failed:', error.message);
    return send(502, { error: 'delivery_failed' });
  }
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Taso deploy event bridge listening on ${port}; self_uuid=${selfUuid ? 'present' : 'missing'}; source_commit=${sourceCommit ? sourceCommit.slice(0, 8) : 'missing'}`);
  setTimeout(() => { void notifySelfStartup(); }, 8000);
});
