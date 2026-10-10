import { useEffect, useMemo, useState } from 'react';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  updatedAt: string;
  execution?: {
    branch?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    previewUrl?: string;
    productionUrl?: string;
    checkState?: 'success' | 'failed' | 'pending' | 'missing';
    progressPercent?: number;
    currentAction?: string;
    runtimeRepairAttempts?: number;
    maxRuntimeRepairAttempts?: number;
    functionalChecksPlanned?: number;
    functionalChecksPassed?: number;
    artifacts?: Array<{ id: string; type: string; label: string; url?: string; summary?: string; createdAt: string }>;
  };
};

type Project = { id: string; name: string; slug: string; repository: string };
type AgentItem = { id: string; label: string; status: 'ready' | 'busy' | 'degraded' | 'unconfigured'; detail: string; activeMissions?: number; progress?: number };
type ActivityItem = { id: string; projectName: string; objective: string; missionStatus: string; type: string; message: string; createdAt: string };
type Operations = { generatedAt: string; agents: AgentItem[]; activity: ActivityItem[] };
type CoreHealth = { ok?: boolean; service?: string; version?: string; gateway?: string; state?: string; executor?: { read?: boolean; write?: boolean; deploy?: boolean } };

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function shortSha(value?: string) {
  return value ? value.slice(0, 8) : '—';
}

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusTone(value?: string) {
  if (!value) return 'neutral';
  if (['success', 'completed', 'preview_ready', 'ready'].includes(value)) return 'ok';
  if (['failed', 'degraded'].includes(value)) return 'bad';
  if (['pending', 'planning', 'running', 'testing', 'busy', 'queued'].includes(value)) return 'warn';
  return 'neutral';
}

export default function OperationsCenterV10({ mode }: { mode: 'deployments' | 'monitoring' }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [operations, setOperations] = useState<Operations>({ generatedAt: '', agents: [], activity: [] });
  const [health, setHealth] = useState<CoreHealth>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [missionsPayload, projectsPayload, operationsPayload, healthPayload] = await Promise.all([
        request<{ missions: Mission[] }>('/v1/missions'),
        request<{ projects: Project[] }>('/v1/projects'),
        request<{ operations: Operations }>('/v1/operations?limit=50'),
        request<CoreHealth>('/health'),
      ]);
      setMissions(missionsPayload.missions ?? []);
      setProjects(projectsPayload.projects ?? []);
      setOperations(operationsPayload.operations ?? { generatedAt: '', agents: [], activity: [] });
      setHealth(healthPayload);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 12_000);
    return () => window.clearInterval(timer);
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const deploymentMissions = useMemo(() => missions
    .filter((mission) => mission.execution?.previewUrl || mission.execution?.productionUrl || mission.execution?.pullRequestUrl || mission.execution?.commitSha)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [missions]);
  const recentArtifacts = useMemo(() => missions.flatMap((mission) => (mission.execution?.artifacts ?? []).map((artifact) => ({ mission, artifact })))
    .sort((a, b) => b.artifact.createdAt.localeCompare(a.artifact.createdAt))
    .slice(0, 18), [missions]);

  return (
    <section className="oc10-shell" aria-label={mode === 'deployments' ? 'Deployments' : 'Monitoring'}>
      <header className="oc10-header">
        <div>
          <span className="oc10-eyebrow">TASO / {mode === 'deployments' ? 'DELIVERY CONTROL' : 'SYSTEM HEALTH'}</span>
          <h1>{mode === 'deployments' ? 'Deployments' : 'Monitoring'}</h1>
          <p>{mode === 'deployments'
            ? 'PR, commit, CI, preview ve functional acceptance zincirinin gerçek durumu.'
            : 'Executor, agentlar, brokerlar ve canlı operasyon akışının gerçek sağlık görünümü.'}</p>
        </div>
        <button type="button" className="oc10-refresh" onClick={() => void refresh()} disabled={loading}>↻ Yenile</button>
      </header>

      {error && <div className="oc10-alert">Core bağlantısı: {error}</div>}

      {mode === 'deployments' ? (
        <div className="oc10-layout">
          <main className="oc10-main">
            <div className="oc10-section-head"><h2>Delivery pipeline</h2><span>{deploymentMissions.length} kayıt</span></div>
            <div className="oc10-deploy-list">
              {deploymentMissions.length === 0 && <div className="oc10-empty">Henüz gerçek PR / preview / deployment çıktısı yok.</div>}
              {deploymentMissions.map((mission) => {
                const project = projectById.get(mission.projectId);
                const functional = mission.execution?.functionalChecksPlanned
                  ? `${mission.execution.functionalChecksPassed ?? 0}/${mission.execution.functionalChecksPlanned}`
                  : '—';
                return (
                  <article className="oc10-deploy" key={mission.id}>
                    <div className="oc10-deploy-top">
                      <div><span>{project?.name ?? mission.projectId}</span><h3>{mission.objective}</h3></div>
                      <span className={`oc10-state ${statusTone(mission.status)}`}>{mission.status}</span>
                    </div>
                    <div className="oc10-pipeline">
                      <div><small>BRANCH</small><b>{mission.execution?.branch ?? '—'}</b></div>
                      <div><small>COMMIT</small><b>{shortSha(mission.execution?.commitSha)}</b></div>
                      <div><small>CI</small><b className={statusTone(mission.execution?.checkState)}>{mission.execution?.checkState ?? '—'}</b></div>
                      <div><small>FUNCTIONAL</small><b>{functional}</b></div>
                    </div>
                    <div className="oc10-actions">
                      {mission.execution?.pullRequestUrl && <a href={mission.execution.pullRequestUrl} target="_blank" rel="noreferrer">PR #{mission.execution.pullRequestNumber ?? ''} ↗</a>}
                      {mission.execution?.previewUrl && <a href={mission.execution.previewUrl} target="_blank" rel="noreferrer">Preview ↗</a>}
                      {mission.execution?.productionUrl && <a href={mission.execution.productionUrl} target="_blank" rel="noreferrer">Production ↗</a>}
                      <span>{formatTime(mission.updatedAt)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </main>

          <aside className="oc10-side">
            <div className="oc10-section-head"><h2>Artifacts</h2><span>son {recentArtifacts.length}</span></div>
            <div className="oc10-artifacts">
              {recentArtifacts.length === 0 && <div className="oc10-empty">Artifact yok.</div>}
              {recentArtifacts.map(({ mission, artifact }) => (
                <article key={artifact.id}>
                  <span>{artifact.type}</span>
                  <b>{artifact.label}</b>
                  <p>{artifact.summary ?? mission.objective}</p>
                  <small>{formatTime(artifact.createdAt)}</small>
                </article>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <div className="oc10-layout monitoring">
          <main className="oc10-main">
            <div className="oc10-health-grid">
              <article><span>CORE</span><b className={health.ok ? 'ok' : 'bad'}>{health.ok ? 'ONLINE' : 'UNKNOWN'}</b><small>{health.service ?? 'taso-core'} · {health.version ?? '—'}</small></article>
              <article><span>STATE</span><b>{health.state ?? '—'}</b><small>Gateway: {health.gateway ?? '—'}</small></article>
              <article><span>READ / WRITE</span><b className={health.executor?.read && health.executor?.write ? 'ok' : 'warn'}>{health.executor?.read ? 'R' : '—'} / {health.executor?.write ? 'W' : '—'}</b><small>Deterministic executor readiness</small></article>
              <article><span>DEPLOY</span><b className={health.executor?.deploy ? 'ok' : 'warn'}>{health.executor?.deploy ? 'READY' : 'NOT READY'}</b><small>Deployment capability</small></article>
            </div>

            <div className="oc10-section-head"><h2>Agent & broker health</h2><span>{operations.agents.length} birim</span></div>
            <div className="oc10-agent-grid">
              {operations.agents.map((agent) => (
                <article key={agent.id}>
                  <div><span className={`oc10-dot ${agent.status}`} /><b>{agent.label}</b></div>
                  <span className={`oc10-state ${statusTone(agent.status)}`}>{agent.status}</span>
                  <p>{agent.detail}</p>
                  {typeof agent.progress === 'number' && <div className="oc10-progress"><i style={{ width: `${Math.max(0, Math.min(100, agent.progress))}%` }} /></div>}
                </article>
              ))}
            </div>
          </main>

          <aside className="oc10-side">
            <div className="oc10-section-head"><h2>Live activity</h2><span>{formatTime(operations.generatedAt)}</span></div>
            <div className="oc10-activity">
              {operations.activity.length === 0 && <div className="oc10-empty">Henüz activity kaydı yok.</div>}
              {operations.activity.slice(0, 30).map((item) => (
                <article key={item.id}>
                  <time>{formatTime(item.createdAt)}</time>
                  <b>{item.projectName}</b>
                  <p>{item.message}</p>
                  <small>{item.type} · {item.missionStatus}</small>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
