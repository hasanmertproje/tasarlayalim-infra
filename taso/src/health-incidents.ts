import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';

export type HealthState = 'Healthy' | 'Degraded' | 'Unavailable' | 'Unknown' | 'Not configured';
export type IncidentSeverity = 'info' | 'warning' | 'critical';
export type IncidentState = 'open' | 'acknowledged' | 'resolved';

export type HealthComponent = {
  id: string;
  label: string;
  state: HealthState;
  summary: string;
  checkedAt: string;
};

export type Incident = {
  id: string;
  source: string;
  severity: IncidentSeverity;
  state: IncidentState;
  title: string;
  summary: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
};

type IncidentSnapshot = { incidents: Incident[] };

function nowIso() { return new Date().toISOString(); }
function incidentFile() {
  return process.env.TASO_INCIDENT_FILE?.trim()
    || (process.env.NODE_ENV === 'production' ? '/data/taso-incidents.json' : undefined);
}
function fingerprint(source: string, title: string) {
  return createHash('sha256').update(`${source}\n${title}`).digest('hex');
}
function newId() { return `incident_${randomBytes(10).toString('hex')}`; }

async function probeHttp(url: string, timeoutMs = 2500): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function collectHealthMatrix(): Promise<HealthComponent[]> {
  const checkedAt = nowIso();
  const components: HealthComponent[] = [];
  const push = (id: string, label: string, state: HealthState, summary: string) => components.push({ id, label, state, summary, checkedAt });

  push('core', 'Core', 'Healthy', 'Core process is serving the health request.');

  const gateway = process.env.TASO_GATEWAY_SECRET?.trim();
  push('auth', 'Auth', process.env.TASO_OWNER_EMAIL?.trim() && (process.env.TASO_OWNER_PASSWORD_HASH?.trim() || process.env.TASO_OWNER_PASSWORD?.trim())
    ? 'Healthy' : 'Not configured', 'Application authentication configuration.');
  push('storage', 'Storage', process.env.TASO_STATE_FILE?.trim() || process.env.NODE_ENV === 'production'
    ? 'Healthy' : 'Unknown', process.env.TASO_STATE_FILE?.trim() || process.env.NODE_ENV === 'production' ? 'Persistent state path configured.' : 'Running without an explicit persistent state path.');
  push('gateway', 'Gateway', gateway ? 'Healthy' : process.env.NODE_ENV === 'production' ? 'Unavailable' : 'Not configured', gateway ? 'Gateway secret configured.' : 'Gateway secret is missing.');

  const browserUrl = process.env.TASO_BROWSER_WORKER_URL?.trim().replace(/\/$/, '');
  const browserSecret = process.env.TASO_BROWSER_WORKER_SECRET?.trim();
  if (!browserUrl || !browserSecret) push('browser-worker', 'Browser Worker', 'Not configured', 'Browser worker URL or secret is missing.');
  else {
    const probe = await probeHttp(`${browserUrl}/health`);
    push('browser-worker', 'Browser Worker', probe.ok ? 'Healthy' : 'Unavailable', probe.ok ? `Worker responded HTTP ${probe.status}.` : `Worker probe failed: ${probe.error || probe.status || 'unknown'}.`);
  }

  const searchEndpoint = process.env.TASO_SEARCH_ENDPOINT?.trim();
  push('web-research', 'Web Research', searchEndpoint ? 'Healthy' : 'Not configured', searchEndpoint ? 'Search endpoint configured.' : 'Search endpoint is not configured.');
  push('notifications', 'Notifications', process.env.NTFY_BASE_URL?.trim() && process.env.NTFY_TOPIC?.trim() ? 'Healthy' : 'Not configured', 'Notification transport configuration.');
  push('backup', 'Backup', process.env.TASO_BACKUP_DIR?.trim() ? 'Healthy' : 'Unknown', process.env.TASO_BACKUP_DIR?.trim() ? 'Backup directory configured.' : 'Backup directory is not explicitly configured.');

  return components;
}

export class IncidentStore {
  private readonly filePath = incidentFile();
  private snapshot: IncidentSnapshot;

  constructor() { this.snapshot = this.load(); }

  list() { return this.snapshot.incidents.map((incident) => ({ ...incident })); }

  reconcile(components: HealthComponent[]) {
    const now = nowIso();
    const activeFingerprints = new Set<string>();
    for (const component of components) {
      if (!['Degraded', 'Unavailable'].includes(component.state)) continue;
      const title = `${component.label} ${component.state}`;
      const fp = fingerprint(component.id, title);
      activeFingerprints.add(fp);
      const existing = this.snapshot.incidents.find((incident) => incident.fingerprint === fp && incident.state !== 'resolved');
      const severity: IncidentSeverity = component.state === 'Unavailable' ? 'critical' : 'warning';
      if (existing) {
        existing.lastSeenAt = now;
        existing.summary = component.summary;
        existing.severity = severity;
      } else {
        this.snapshot.incidents.unshift({
          id: newId(), source: component.id, severity, state: 'open', title, summary: component.summary,
          fingerprint: fp, firstSeenAt: now, lastSeenAt: now,
        });
      }
    }
    for (const incident of this.snapshot.incidents) {
      if (incident.state === 'resolved') continue;
      if (activeFingerprints.has(incident.fingerprint)) continue;
      if (!components.some((component) => component.id === incident.source)) continue;
      incident.state = 'resolved';
      incident.resolvedAt = now;
      incident.lastSeenAt = now;
    }
    this.snapshot.incidents = this.snapshot.incidents.slice(0, 250);
    this.persist();
    return this.list();
  }

  acknowledge(id: string) {
    const incident = this.snapshot.incidents.find((entry) => entry.id === id);
    if (!incident) return undefined;
    if (incident.state === 'open') {
      incident.state = 'acknowledged';
      incident.acknowledgedAt = nowIso();
      incident.lastSeenAt = incident.acknowledgedAt;
      this.persist();
    }
    return { ...incident };
  }

  private load(): IncidentSnapshot {
    if (!this.filePath) return { incidents: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<IncidentSnapshot>;
      return { incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { incidents: [] };
      throw new Error(`Taso incident state could not be loaded: ${(error as Error).message}`);
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.filePath);
  }
}

export function registerHealthIncidentRoutes(app: FastifyInstance) {
  const incidents = new IncidentStore();
  app.get('/v1/system/health', async () => {
    const components = await collectHealthMatrix();
    const states = components.map((component) => component.state);
    const overall: HealthState = states.includes('Unavailable') ? 'Unavailable'
      : states.includes('Degraded') ? 'Degraded'
        : states.every((state) => state === 'Healthy') ? 'Healthy' : 'Unknown';
    incidents.reconcile(components);
    return { overall, generatedAt: nowIso(), components };
  });
  app.get('/v1/incidents', async () => ({ incidents: incidents.list() }));
  app.post<{ Params: { id: string } }>('/v1/incidents/:id/acknowledge', async (request, reply) => {
    const incident = incidents.acknowledge(request.params.id);
    if (!incident) return reply.code(404).send({ error: 'Incident not found.' });
    return { incident };
  });
}
