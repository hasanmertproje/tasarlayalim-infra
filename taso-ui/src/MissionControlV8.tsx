import { useEffect, useMemo, useState } from 'react';

type Project = { id: string; name: string; repository: string };
type MissionStep = {
  id: string;
  title: string;
  objective: string;
  specialist: string;
  status: string;
  dependsOn: string[];
  targetPaths: string[];
  progress: number;
  attempts?: number;
  maxAttempts?: number;
  outputSummary?: string;
  error?: string;
};
type AgentRun = {
  id: string;
  label: string;
  role?: string;
  specialist?: string;
  stepId?: string;
  status: string;
  action: string;
  progress: number;
  detail?: string;
};
type Artifact = { id: string; stepId?: string; type: string; label: string; path?: string; url?: string; summary?: string; createdAt: string };
type Handoff = { id: string; fromStepId: string; toStepId: string; summary: string; artifactIds: string[]; createdAt: string };
type MissionIntentProfile = {
  version: number;
  goal: string;
  mode: string;
  requiredSpecialists: string[];
  skillHints: string[];
  acceptanceHints: string[];
  constraints: string[];
  derivedAt: string;
};
type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  riskLevel?: string;
  dataClass?: string;
  approvalRequired?: boolean;
  approvedAt?: string;
  updatedAt?: string;
  execution?: {
    summary?: string;
    branch?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    previewUrl?: string;
    productionUrl?: string;
    checkState?: string;
    blockedReason?: string;
    progressPercent?: number;
    currentAction?: string;
    activeAgentRole?: string;
    intentProfile?: MissionIntentProfile;
    orchestrationSummary?: string;
    workPlan?: MissionStep[];
    artifacts?: Artifact[];
    handoffs?: Handoff[];
    agentRuns?: AgentRun[];
    retryCount?: number;
    ciRepairAttempts?: number;
    maxCiRepairAttempts?: number;
    runtimeRepairAttempts?: number;
    maxRuntimeRepairAttempts?: number;
    functionalChecksPlanned?: number;
    functionalChecksPassed?: number;
    lastFunctionalFailureSummary?: string;
    workspaceCheckpoint?: { completedStepIds: string[]; files: Array<{ path: string }>; updatedAt: string };
  };
};
type MissionEvent = { id?: string; type?: string; message?: string; createdAt?: string; metadata?: Record<string, unknown> };

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const activeStates = new Set(['queued', 'planning', 'running', 'testing', 'waiting_approval']);

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function label(value?: string) {
  const map: Record<string, string> = {
    queued: 'Kuyrukta', planning: 'Planlanıyor', running: 'Çalışıyor', testing: 'Doğrulanıyor',
    waiting_approval: 'Onay bekliyor', preview_ready: 'Preview hazır', completed: 'Tamamlandı',
    failed: 'Hata', cancelled: 'İptal', frontend: 'Frontend', backend: 'Backend', database: 'Veritabanı',
    security: 'Güvenlik', qa: 'QA', devops: 'DevOps', generalist: 'Generalist',
    website: 'Website', fullstack: 'Full-stack', infrastructure: 'Altyapı', general: 'Genel',
  };
  return value ? map[value] ?? value : '—';
}

function rel(value?: string) {
  if (!value) return '—';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return value;
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'az önce';
  if (min < 60) return `${min}dk önce`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}sa önce`;
  return new Date(value).toLocaleDateString('tr-TR');
}

export default function MissionControlV8() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [missionPayload, projectPayload] = await Promise.all([
        requestJson<{ missions: Mission[] }>('/v1/missions'),
        requestJson<{ projects: Project[] }>('/v1/projects'),
      ]);
      const next = missionPayload.missions ?? [];
      setMissions(next);
      setProjects(projectPayload.projects ?? []);
      setSelectedId((current) => current && next.some((mission) => mission.id === current)
        ? current
        : next.find((mission) => activeStates.has(mission.status))?.id ?? next[0]?.id ?? '');
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    const open = (event: Event) => {
      const missionId = (event as CustomEvent<{ missionId?: string }>).detail?.missionId;
      if (missionId) setSelectedId(missionId);
    };
    window.addEventListener('taso:open-mission', open);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('taso:open-mission', open);
    };
  }, []);

  const mission = useMemo(() => missions.find((item) => item.id === selectedId) ?? missions[0], [missions, selectedId]);
  const project = projects.find((item) => item.id === mission?.projectId);
  const execution = mission?.execution;
  const profile = execution?.intentProfile;
  const steps = execution?.workPlan ?? [];
  const artifacts = execution?.artifacts ?? [];
  const handoffs = execution?.handoffs ?? [];
  const runs = execution?.agentRuns ?? [];
  const activeRuns = runs.filter((run) => run.status === 'running');
  const activeStep = steps.find((step) => step.status === 'running');
  const progress = Math.max(0, Math.min(100, execution?.progressPercent ?? 0));
  const activeAgentName = activeRuns[0]?.label ?? execution?.activeAgentRole;

  useEffect(() => {
    if (!mission?.id) { setEvents([]); return; }
    requestJson<{ events: MissionEvent[] }>(`/v1/missions/${mission.id}/events`)
      .then((payload) => setEvents((payload.events ?? []).slice(-30).reverse()))
      .catch(() => setEvents([]));
  }, [mission?.id, mission?.updatedAt]);

  return (
    <section className="mc8-shell" aria-label="Mission Control">
      <header className="mc8-header">
        <div><span>MISSION CONTROL</span><h1>Yürütme merkezi</h1><p>Gerçek mission state, agent çalışması ve doğrulama zinciri.</p></div>
        <div className="mc8-live"><i className={error ? 'bad' : 'ok'} /><strong>{error ? 'Core erişilemiyor' : 'Canlı state'}</strong><small>3 sn yenileme</small></div>
      </header>

      <div className="mc8-grid">
        <aside className="mc8-list">
          <div className="mc8-list-head"><span>MISSIONS</span><strong>{missions.length}</strong></div>
          <div className="mc8-list-scroll">
            {missions.map((item) => (
              <button type="button" key={item.id} className={item.id === mission?.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
                <i className={`state-${item.status}`} />
                <div><strong>{item.objective}</strong><small>{projects.find((p) => p.id === item.projectId)?.name ?? item.projectId} · {label(item.status)}</small></div>
                <span>{item.execution?.progressPercent ?? 0}%</span>
              </button>
            ))}
            {!missions.length && <div className="mc8-empty">Henüz mission yok.</div>}
          </div>
        </aside>

        <main className="mc8-main">
          {!mission ? <div className="mc8-empty large">Bir mission oluştuğunda detayları burada göreceksin.</div> : <>
            <section className="mc8-hero">
              <div className="mc8-hero-top">
                <div><span>{project?.name ?? mission.projectId}</span><h2>{mission.objective}</h2><p>{mission.id} · son hareket {rel(mission.updatedAt)}</p></div>
                <b className={`mc8-status state-${mission.status}`}>{label(mission.status)}</b>
              </div>
              <div className="mc8-focus-row">
                <div className="mc8-percent"><strong>{progress}%</strong><span>MISSION</span></div>
                <div className="mc8-now"><span>ŞU AN</span><strong>{execution?.currentAction ?? label(mission.status)}</strong><p>{activeAgentName ? `Aktif agent: ${activeAgentName}` : 'Aktif agent yok'}</p></div>
                <div className="mc8-current-file"><span>AKTİF DOSYA KAPSAMI</span><strong>{activeStep?.targetPaths?.[0] ?? '—'}</strong><small>{activeStep?.targetPaths?.length ? `${activeStep.targetPaths.length} hedef path` : 'Aktif step path bildirmiyor'}</small></div>
              </div>
              <div className="mc8-progress"><i style={{ width: `${progress}%` }} /></div>
              {execution?.blockedReason && <div className="mc8-blocked">{execution.blockedReason}</div>}
            </section>

            <section className="mc8-truthbar">
              <div><span>BRANCH</span><strong>{execution?.branch ?? '—'}</strong></div>
              <div><span>COMMIT</span><strong>{execution?.commitSha?.slice(0, 9) ?? '—'}</strong></div>
              <div><span>CI</span><strong>{execution?.checkState ?? '—'}</strong></div>
              <div><span>PR</span><strong>{execution?.pullRequestNumber ? `#${execution.pullRequestNumber}` : '—'}</strong></div>
              <div><span>VERIFY</span><strong>{execution?.functionalChecksPlanned ? `${execution.functionalChecksPassed ?? 0}/${execution.functionalChecksPlanned}` : '—'}</strong></div>
              <div><span>RETRY</span><strong>{execution?.retryCount ?? 0}</strong></div>
            </section>

            {profile && <section className="mc8-surface mc8-intelligence">
              <div className="mc8-section-head"><div><span>MISSION INTELLIGENCE</span><strong>Taso görevi böyle anladı</strong></div><small>{label(profile.mode)} · {rel(profile.derivedAt)}</small></div>
              <div className="mc8-intelligence-grid">
                <div className="mc8-intel-goal"><span>AMAÇ</span><strong>{profile.goal}</strong></div>
                <div><span>UZMANLAR</span><div className="mc8-tags">{profile.requiredSpecialists.map((item) => <b key={item}>{label(item)}</b>)}</div></div>
                <div><span>SKILL İPUÇLARI</span><div className="mc8-tags">{profile.skillHints.length ? profile.skillHints.map((item) => <b key={item}>{item}</b>) : <em>Genel</em>}</div></div>
              </div>
              <div className="mc8-intel-lists">
                <div><span>KABUL KRİTERİ İPUÇLARI</span>{profile.acceptanceHints.map((item) => <p key={item}>• {item}</p>)}</div>
                <div><span>KORUNACAK SINIRLAR</span>{profile.constraints.map((item) => <p key={item}>• {item}</p>)}</div>
              </div>
            </section>}

            <div className="mc8-content-grid">
              <section className="mc8-surface mc8-steps">
                <div className="mc8-section-head"><div><span>WORK GRAPH</span><strong>{steps.length} step</strong></div><small>{execution?.orchestrationSummary ?? 'Work graph henüz oluşmadı.'}</small></div>
                <div className="mc8-step-stack">
                  {steps.map((step, index) => {
                    const run = runs.find((item) => item.stepId === step.id && item.status === 'running');
                    return <article key={step.id} className={`mc8-step state-${step.status}`}>
                      <div className="mc8-step-index">{String(index + 1).padStart(2, '0')}</div>
                      <div className="mc8-step-body">
                        <div><span>{label(step.specialist)} · {label(step.status)}</span><strong>{step.title}</strong></div>
                        <p>{run?.action ?? step.objective}</p>
                        <div className="mc8-step-progress"><i style={{ width: `${step.progress}%` }} /></div>
                        <div className="mc8-step-meta"><span>{step.targetPaths.length} path</span><span>{step.dependsOn.length} dependency</span><span>attempt {step.attempts ?? 0}/{step.maxAttempts ?? '—'}</span></div>
                        {step.targetPaths.length > 0 && <code>{step.targetPaths.slice(0, 5).join(' · ')}</code>}
                        {step.outputSummary && <small className="success">{step.outputSummary}</small>}
                        {step.error && <small className="failure">{step.error}</small>}
                      </div>
                    </article>;
                  })}
                  {!steps.length && <div className="mc8-empty">Mission work graph henüz oluşturulmadı.</div>}
                </div>
              </section>

              <aside className="mc8-side-stack">
                <section className="mc8-surface">
                  <div className="mc8-section-head"><div><span>AGENTS</span><strong>{runs.length} run</strong></div><small>{activeRuns.length} aktif</small></div>
                  <div className="mc8-agent-stack">
                    {runs.slice(-8).reverse().map((run) => <div key={run.id} className="mc8-agent"><i className={`state-${run.status}`} /><div><strong>{run.label}</strong><p>{run.action}</p></div><span>{run.progress}%</span></div>)}
                    {!runs.length && <div className="mc8-empty compact">Agent run yok.</div>}
                  </div>
                </section>

                <section className="mc8-surface">
                  <div className="mc8-section-head"><div><span>REPAIR & VERIFY</span><strong>Güvenlik zinciri</strong></div></div>
                  <div className="mc8-checks">
                    <div><span>CI self-heal</span><strong>{execution?.maxCiRepairAttempts ? `${execution.ciRepairAttempts ?? 0}/${execution.maxCiRepairAttempts}` : 'Kapalı / yok'}</strong></div>
                    <div><span>Runtime self-heal</span><strong>{execution?.maxRuntimeRepairAttempts ? `${execution.runtimeRepairAttempts ?? 0}/${execution.maxRuntimeRepairAttempts}` : 'Kapalı / yok'}</strong></div>
                    <div><span>Functional verify</span><strong>{execution?.functionalChecksPlanned ? `${execution.functionalChecksPassed ?? 0}/${execution.functionalChecksPlanned}` : 'Planlanmadı'}</strong></div>
                    <div><span>Checkpoint</span><strong>{execution?.workspaceCheckpoint ? `${execution.workspaceCheckpoint.completedStepIds.length}/${steps.length}` : '—'}</strong></div>
                  </div>
                  {execution?.lastFunctionalFailureSummary && <div className="mc8-warning">{execution.lastFunctionalFailureSummary}</div>}
                </section>

                <section className="mc8-surface">
                  <div className="mc8-section-head"><div><span>OUTPUT</span><strong>Artifact & handoff</strong></div></div>
                  <div className="mc8-output-line"><span>Artifacts</span><strong>{artifacts.length}</strong></div>
                  <div className="mc8-output-line"><span>Handoffs</span><strong>{handoffs.length}</strong></div>
                  <div className="mc8-output-line"><span>Checkpoint files</span><strong>{execution?.workspaceCheckpoint?.files.length ?? 0}</strong></div>
                  {execution?.pullRequestUrl && <a href={execution.pullRequestUrl} target="_blank" rel="noreferrer">Pull request ↗</a>}
                  {execution?.previewUrl && <a href={execution.previewUrl} target="_blank" rel="noreferrer">Preview ↗</a>}
                </section>
              </aside>
            </div>

            <section className="mc8-surface mc8-events">
              <div className="mc8-section-head"><div><span>LIVE EXECUTION</span><strong>Mission olay akışı</strong></div><small>{events.length} son kayıt</small></div>
              <div className="mc8-event-grid">
                {events.map((event, index) => <div className="mc8-event" key={event.id ?? index}><i /><div><strong>{event.message ?? event.type ?? 'event'}</strong><small>{event.type ?? 'event'}</small></div><time>{rel(event.createdAt)}</time></div>)}
                {!events.length && <div className="mc8-empty">Event kaydı yok.</div>}
              </div>
            </section>
          </>}
        </main>
      </div>
    </section>
  );
}