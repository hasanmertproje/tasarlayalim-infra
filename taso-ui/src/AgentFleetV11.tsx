import { useEffect, useMemo, useState } from 'react';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type Project = { id: string; name: string; slug: string; repository: string };
type MissionStep = { id: string; title: string; specialist: string; status: string; targetPaths: string[]; progress: number; attempts?: number; maxAttempts?: number };
type AgentRun = {
  id: string;
  label: string;
  role?: string;
  specialist?: string;
  stepId?: string;
  status: string;
  action: string;
  progress: number;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  detail?: string;
  error?: string;
};
type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  updatedAt: string;
  execution?: {
    progressPercent?: number;
    currentAction?: string;
    activeAgentRole?: string;
    retryCount?: number;
    workPlan?: MissionStep[];
    agentRuns?: AgentRun[];
    branch?: string;
    commitSha?: string;
    checkState?: string;
    previewUrl?: string;
    functionalChecksPlanned?: number;
    functionalChecksPassed?: number;
  };
};
type OperationsAgent = {
  id: string;
  label: string;
  status: 'ready' | 'busy' | 'degraded' | 'unconfigured';
  detail: string;
  activeMissions?: number;
  missionId?: string;
  projectId?: string;
  role?: string;
  progress?: number;
  startedAt?: string;
};
type Activity = { id: string; missionId: string; projectId: string; projectName: string; missionStatus: string; type: string; message: string; createdAt: string };
type Operations = { generatedAt: string; agents: OperationsAgent[]; activity: Activity[] };

type FleetRow = {
  id: string;
  label: string;
  role?: string;
  specialist?: string;
  status: string;
  action: string;
  progress: number;
  mission: Mission;
  project?: Project;
  step?: MissionStep;
  startedAt?: string;
  updatedAt?: string;
  detail?: string;
  error?: string;
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function rel(value?: string) {
  if (!value) return '—';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (sec < 60) return `${sec}sn`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}dk`;
  return `${Math.floor(min / 60)}sa`;
}

function tone(status: string) {
  if (['running', 'busy'].includes(status)) return 'busy';
  if (['completed', 'ready'].includes(status)) return 'ok';
  if (['failed', 'degraded'].includes(status)) return 'bad';
  if (['queued', 'planning', 'testing'].includes(status)) return 'wait';
  return 'muted';
}

function specialistLabel(value?: string) {
  const map: Record<string, string> = {
    frontend: 'Frontend', backend: 'Backend', database: 'Database', security: 'Security', qa: 'QA', devops: 'DevOps',
    generalist: 'Generalist', scout: 'Scout', architect: 'Architect', builder: 'Builder', verifier: 'Verifier', release: 'Release',
    'repository-publisher': 'Publisher',
  };
  return value ? map[value] ?? value : '—';
}

export default function AgentFleetV11() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [operations, setOperations] = useState<Operations>({ generatedAt: '', agents: [], activity: [] });
  const [selectedRunId, setSelectedRunId] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [missionsPayload, projectsPayload, operationsPayload] = await Promise.all([
        request<{ missions: Mission[] }>('/v1/missions'),
        request<{ projects: Project[] }>('/v1/projects'),
        request<{ operations: Operations }>('/v1/operations?limit=60'),
      ]);
      setMissions(missionsPayload.missions ?? []);
      setProjects(projectsPayload.projects ?? []);
      setOperations(operationsPayload.operations ?? { generatedAt: '', agents: [], activity: [] });
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const fleet = useMemo<FleetRow[]>(() => missions.flatMap((mission) => {
    const steps = mission.execution?.workPlan ?? [];
    return (mission.execution?.agentRuns ?? []).map((run) => ({
      id: run.id,
      label: run.label,
      role: run.role,
      specialist: run.specialist,
      status: run.status,
      action: run.action,
      progress: run.progress,
      mission,
      project: projectById.get(mission.projectId),
      step: run.stepId ? steps.find((step) => step.id === run.stepId) : undefined,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      detail: run.detail,
      error: run.error,
    }));
  }).sort((a, b) => {
    const rank = (status: string) => status === 'running' ? 0 : status === 'queued' ? 1 : status === 'failed' ? 2 : 3;
    return rank(a.status) - rank(b.status) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  }), [missions, projectById]);

  const running = fleet.filter((item) => item.status === 'running');
  const failed = fleet.filter((item) => item.status === 'failed');
  const completed = fleet.filter((item) => item.status === 'completed');
  const selected = fleet.find((item) => item.id === selectedRunId) ?? running[0] ?? fleet[0];
  const systemAgents = operations.agents.filter((agent) => !agent.id.startsWith('worker:'));

  useEffect(() => {
    if (!selectedRunId && (running[0] ?? fleet[0])) setSelectedRunId((running[0] ?? fleet[0]).id);
    if (selectedRunId && !fleet.some((item) => item.id === selectedRunId)) setSelectedRunId((running[0] ?? fleet[0])?.id ?? '');
  }, [fleet, running, selectedRunId]);

  return (
    <section className="af11-shell" aria-label="Agent Fleet">
      <header className="af11-header">
        <div>
          <span>AI OPERATIONS / AGENT FLEET</span>
          <h1>Agent operasyon merkezi</h1>
          <p>Mission → agent → step → dosya zincirini gerçek execution state üzerinden canlı izle.</p>
        </div>
        <div className="af11-live"><i className={error ? 'bad' : 'ok'} /><div><strong>{error ? 'Core erişilemiyor' : 'Live fleet'}</strong><small>2.5 sn state refresh</small></div></div>
      </header>

      <div className="af11-metrics">
        <article><span>RUNNING</span><strong>{running.length}</strong><small>aktif worker</small></article>
        <article><span>FAILED</span><strong className={failed.length ? 'bad' : ''}>{failed.length}</strong><small>inceleme gerekli</small></article>
        <article><span>COMPLETED</span><strong>{completed.length}</strong><small>agent run</small></article>
        <article><span>SYSTEM</span><strong>{systemAgents.filter((agent) => agent.status === 'ready').length}/{systemAgents.length}</strong><small>hazır broker/engine</small></article>
      </div>

      <div className="af11-layout">
        <aside className="af11-fleet-list">
          <div className="af11-section-title"><span>FLEET</span><b>{fleet.length} run</b></div>
          <div className="af11-scroll">
            {fleet.map((item) => (
              <button type="button" key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => setSelectedRunId(item.id)}>
                <i className={`af11-dot ${tone(item.status)}`} />
                <div><strong>{item.label}</strong><span>{item.project?.name ?? item.mission.projectId} · {specialistLabel(item.specialist ?? item.role)}</span><small>{item.action}</small></div>
                <em>{item.progress}%</em>
              </button>
            ))}
            {!fleet.length && <div className="af11-empty">Henüz agent run oluşmadı.</div>}
          </div>
        </aside>

        <main className="af11-main">
          {!selected ? <div className="af11-empty large">Bir agent çalıştığında canlı detay burada görünecek.</div> : <>
            <section className="af11-focus">
              <div className="af11-focus-head">
                <div><span>{selected.project?.name ?? selected.mission.projectId}</span><h2>{selected.label}</h2><p>{specialistLabel(selected.specialist ?? selected.role)} · {selected.status} · {rel(selected.startedAt)} önce başladı</p></div>
                <b className={`af11-state ${tone(selected.status)}`}>{selected.status}</b>
              </div>
              <div className="af11-action"><span>ŞU ANKİ EYLEM</span><strong>{selected.action}</strong>{selected.detail && <p>{selected.detail}</p>}</div>
              <div className="af11-progress"><i style={{ width: `${Math.max(0, Math.min(100, selected.progress))}%` }} /></div>
              <div className="af11-focus-grid">
                <div><span>MISSION</span><strong>{selected.mission.objective}</strong></div>
                <div><span>STEP</span><strong>{selected.step?.title ?? 'Mission-level agent'}</strong></div>
                <div><span>AKTİF DOSYA</span><strong>{selected.step?.targetPaths?.[0] ?? '—'}</strong><small>{selected.step?.targetPaths?.length ? `${selected.step.targetPaths.length} target path` : 'Path yok'}</small></div>
                <div><span>ATTEMPT</span><strong>{selected.step ? `${selected.step.attempts ?? 0}/${selected.step.maxAttempts ?? '—'}` : `mission retry ${selected.mission.execution?.retryCount ?? 0}`}</strong></div>
              </div>
              {selected.error && <div className="af11-error">{selected.error}</div>}
            </section>

            <section className="af11-pipeline">
              <div><span>MISSION</span><b>{selected.mission.status}</b></div>
              <div><span>BRANCH</span><b>{selected.mission.execution?.branch ?? '—'}</b></div>
              <div><span>COMMIT</span><b>{selected.mission.execution?.commitSha?.slice(0, 8) ?? '—'}</b></div>
              <div><span>CI</span><b>{selected.mission.execution?.checkState ?? '—'}</b></div>
              <div><span>VERIFY</span><b>{selected.mission.execution?.functionalChecksPlanned ? `${selected.mission.execution.functionalChecksPassed ?? 0}/${selected.mission.execution.functionalChecksPlanned}` : '—'}</b></div>
            </section>

            <section className="af11-workgraph">
              <div className="af11-section-title"><span>MISSION WORK GRAPH</span><b>{selected.mission.execution?.workPlan?.length ?? 0} step</b></div>
              <div className="af11-steps">
                {(selected.mission.execution?.workPlan ?? []).map((step, index) => (
                  <article key={step.id} className={step.id === selected.step?.id ? 'active' : ''}>
                    <em>{String(index + 1).padStart(2, '0')}</em>
                    <div><span>{specialistLabel(step.specialist)} · {step.status}</span><strong>{step.title}</strong><small>{step.targetPaths.slice(0, 3).join(' · ') || 'path yok'}</small></div>
                    <b>{step.progress}%</b>
                  </article>
                ))}
                {!selected.mission.execution?.workPlan?.length && <div className="af11-empty compact">Work graph henüz yok.</div>}
              </div>
            </section>
          </>}
        </main>

        <aside className="af11-side">
          <section>
            <div className="af11-section-title"><span>SYSTEM AGENTS</span><b>{systemAgents.length}</b></div>
            <div className="af11-system-list">
              {systemAgents.map((agent) => <article key={agent.id}><i className={`af11-dot ${tone(agent.status)}`} /><div><strong>{agent.label}</strong><p>{agent.detail}</p></div><span>{agent.status}</span></article>)}
            </div>
          </section>

          <section>
            <div className="af11-section-title"><span>LIVE ACTIVITY</span><b>{operations.activity.length}</b></div>
            <div className="af11-activity">
              {operations.activity.slice(0, 24).map((item) => <article key={item.id}><time>{rel(item.createdAt)}</time><div><strong>{item.projectName}</strong><p>{item.message}</p><small>{item.type} · {item.missionStatus}</small></div></article>)}
              {!operations.activity.length && <div className="af11-empty compact">Activity yok.</div>}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
