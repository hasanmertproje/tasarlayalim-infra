import http from 'node:http';

const secret = process.env.COOLIFY_EVENT_SECRET || '';
const ntfyBase = process.env.NTFY_BASE_URL || '';
const ntfyTopic = process.env.NTFY_TOPIC || '';
const ntfyToken = process.env.NTFY_TOKEN || '';
const port = Number(process.env.PORT || 8080);
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
  const found = Object.entries(services).find(([, v]) => v && v.uuid === event.application_uuid);
  return found ? { name: found[0], ...found[1] } : null;
}
async function healthcheck(service) {
  if (!service.healthUrl) return false;
  const u = new URL(service.healthUrl);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false;
  // Only operator-configured health URLs are requested; never follow redirects or use payload URLs.
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
  const url = new URL(ntfyBase.replace(/\/$/, '') + '/' + encodeURIComponent(ntfyTopic));
  if (url.protocol !== 'https:') throw new Error('ntfy must use HTTPS');
  const headers = {
    Authorization: 'Bearer ' + ntfyToken,
    Title: title,
    Priority: status === 'failed' ? '5' : '3',
    Tags: status === 'failed' ? 'rotating_light' : 'white_check_mark',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (link && link.startsWith('https://')) headers.Click = link;
  const response = await fetch(url, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('ntfy rejected request: HTTP ' + response.status);
  const result = await response.json();
  if (!result?.id) throw new Error('ntfy did not return a message id');
}
async function processEvent(event) {
  if (!event || !['deployment_success', 'deployment_failed'].includes(event.event)) return { accepted: false, reason: 'ignored_event' };
  if (event.pull_request_id != null) return { accepted: false, reason: 'preview_ignored' };
  const service = serviceFor(event);
  if (!service || !event.deployment_uuid || typeof event.deployment_uuid !== 'string') return { accepted: false, reason: 'unknown_resource' };
  clean();
  const key = event.event + ':' + event.application_uuid + ':' + event.deployment_uuid;
  if (seen.has(key)) return { accepted: true, duplicate: true };
  // A successful Coolify deployment alone does not establish that production is healthy.
  const healthy = event.event === 'deployment_success' && await healthcheck(service);
  const failed = event.event === 'deployment_failed' || !healthy;
  const title = failed ? 'MÜDAHALE GEREKİYOR · ' + service.name : 'YAYIN TAMAMLANDI · ' + service.name;
  const message = failed
    ? (event.event === 'deployment_failed' ? 'Coolify deployment başarısız oldu.' : 'Coolify deployment tamamlandı ancak sağlık kontrolü geçmedi.')
    : 'Coolify deployment tamamlandı ve servis sağlık kontrolünü geçti.';
  // Only operator-configured links, not untrusted webhook payload links.
  await publish(failed ? 'failed' : 'success', title, message, service.dashboardUrl);
  seen.set(key, Date.now());
  return { accepted: true, notified: true, healthy };
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
server.listen(port, '0.0.0.0', () => console.log('Taso deploy event bridge listening on', port));
