import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { navigateTaso } from './navigation';

type Project = {
  id: string;
  slug: string;
  name: string;
  repository: string;
};

type AgentRun = {
  id: string;
  label: string;
  role?: string;
  status: string;
  action?: string;
  detail?: string;
  progress?: number;
  startedAt?: string;
  updatedAt?: string;
};

type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  riskLevel?: 'READ' | 'WRITE' | 'HIGH_IMPACT';
  updatedAt?: string;
  approvalRequired?: boolean;
  execution?: {
    progressPercent?: number;
    currentAction?: string;
    activeAgentRole?: string;
    branch?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    previewUrl?: string;
    checkState?: string;
    blockedReason?: string;
    functionalChecksPlanned?: number;
    functionalChecksPassed?: number;
    lastFunctionalFailureSummary?: string;
    retryCount?: number;
    agentRuns?: AgentRun[];
  };
};

type OperationsProject = {
  projectId: string;
  slug: string;
  name: string;
  totalMissions: number;
  activeMissions: number;
  deliveredMissions: number;
  failedMissions: number;
  waitingApproval: number;
  retryingMissions: number;
  missionCompletionPercent: number;
  terminalSuccessPercent: number | null;
  lastActivityAt?: string;
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

type Activity = {
  id: string;
  missionId: string;
  projectId: string;
  projectName: string;
  objective: string;
  missionStatus: string;
  type: string;
  message: string;
  createdAt: string;
};

type OperationsSnapshot = {
  generatedAt: string;
  agents: OperationsAgent[];
  projects: OperationsProject[];
  activity: Activity[];
};

type Health = {
  ok?: boolean;
  service?: string;
  version?: string;
};

type Executor = {
  readyForRead?: boolean;
  readyForWrite?: boolean;
  readyForDeploy?: boolean;
};

type RiskLevel = 'READ' | 'WRITE' | 'HIGH_IMPACT';
type LoadState = 'loading' | 'ready' | 'error';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const activeMissionStates = new Set(['queued', 'planning', 'running', 'testing', 'waiting_approval']);

function formatRelative(value?: string) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa önce`;
  return new Date(value).toLocaleDateString('tr-TR');
}

function compactSha(value?: string) {
  return value ? value.slice(0, 8) : '—';
}

function stateLabel(value?: string) {
  const labels: Record<string, string> = {
    queued: 'Kuyrukta',
    planning: 'Planlanıyor',
    running: 'Çalışıyor',
    testing: 'Doğrulanıyor',
    waiting_approval: 'Onay bekliyor',
    preview_ready: 'Preview hazır',
    completed: 'Tamamlandı',
    failed: 'Hata',
    cancelled: 'İptal',
    ready: 'Hazır',
    busy: 'Meşgul',
    degraded: 'Kısıtlı',
    unconfigured: 'Yapılandırılmadı',
  };
  return value ? labels[value] ?? value : 'Bilinmiyor';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') detail = body.error;
    } catch {
      // HTTP detail is enough.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function Stage({ label, state, active }: { label: string; state: 'done' | 'active' | 'idle' | 'error'; active?: boolean }) {
  return (
    <div className={`cc8-stage cc8-stage-${state}${active ? ' is-current' : ''}`}>
      <span className="cc8-stage-node" />
      <span>{label}</span>
    </div>
  );
}

export default function CommandCenterV8() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [health, setHealth] = useState<Health>({});
  const [executor, setExecutor] = useState<Executor>({});
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [command, setCommand] = useState('');
  const [risk, setRisk] = useState<RiskLevel>('WRITE');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setState('loading');
    try {
      const [operationsPayload, projectsPayload, missionsPayload, healthPayload, executorPayload] = await Promise.all([
        requestJson<{ operations?: OperationsSnapshot }>('/v1/operations?limit=48'),
        requestJson<{ projects: Project[] }>('/v1/projects'),
        requestJson<{ missions: Mission[] }>('/v1/missions'),
        requestJson<Health>('/health'),
        requestJson<{ executor?: Executor }>('/v1/executor'),
      ]);
      if (!operationsPayload.operations) throw new Error('Operations snapshot bulunamadı.');
      setSnapshot(operationsPayload.operations);
      setProjects(projectsPayload.projects ?? []);
      setMissions(missionsPayload.missions ?? []);
      setHealth(healthPayload);
      setExecutor(executorPayload.executor ?? {});
      setSelectedProjectId((current) => {
        if (current && projectsPayload.projects?.some((project) => project.id === current)) return current;
        const activeProject = operationsPayload.operations?.projects.find((project) => project.activeMissions > 0);
        return activeProject?.projectId ?? projectsPayload.projects?.[0]?.id ?? '';
      });
      setState('ready');
      setError('');
    } catch (cause) {
      setState('error');
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let timer = window.setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, 4000);
    const onVisibility = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );

  const projectMissions = useMemo(
    () => missions.filter((mission) => mission.projectId === selectedProject?.id),
    [missions, selectedProject?.id],
  );

  const focusMission = useMemo(() => {
    const selected = projectMissions.find((mission) => mission.id === selectedMissionId);
    if (selected) return selected;
    return [...projectMissions]
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .find((mission) => activeMissionStates.has(mission.status))
      ?? [...projectMissions].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
  }, [projectMissions, selectedMissionId]);

  const projectOps = snapshot?.projects.find((project) => project.projectId === selectedProject?.id);
  const liveAgents = snapshot?.agents.filter((agent) => agent.status === 'busy') ?? [];
  const degradedAgents = snapshot?.agents.filter((agent) => agent.status === 'degraded' || agent.status === 'unconfigured') ?? [];
  const pendingApprovals = missions.filter((mission) => mission.status === 'waiting_approval');
  const activeMissionCount = snapshot?.projects.reduce((sum, project) => sum + project.activeMissions, 0) ?? 0;
  const focusProgress = Math.max(0, Math.min(100, focusMission?.execution?.progressPercent ?? 0));
  const functionalPlanned = focusMission?.execution?.functionalChecksPlanned ?? 0;
  const functionalPassed = focusMission?.execution?.functionalChecksPassed ?? 0;
  const currentAgent = focusMission?.execution?.agentRuns?.find((run) => run.status === 'running');

  const chainStages = useMemo(() => {
    if (!focusMission) return [] as Array<{ label: string; state: 'done' | 'active' | 'idle' | 'error' }>;
    const status = focusMission.status;
    const failed = status === 'failed';
    const hasCommit = Boolean(focusMission.execution?.commitSha);
    const hasPreview = Boolean(focusMission.execution?.previewUrl);
    const verificationDone = functionalPlanned > 0 && functionalPassed >= functionalPlanned;
    return [
      { label: 'MISSION', state: 'done' as const },
      { label: 'AGENT', state: currentAgent ? 'active' as const : focusProgress > 0 ? 'done' as const : 'idle' as const },
      { label: 'COMMIT', state: hasCommit ? 'done' as const : currentAgent ? 'active' as const : 'idle' as const },
      { label: 'CI', state: failed ? 'error' as const : focusMission.execution?.checkState === 'success' ? 'done' as const : hasCommit ? 'active' as const : 'idle' as const },
      { label: 'PREVIEW', state: hasPreview ? 'done' as const : focusMission.execution?.checkState === 'success' ? 'active' as const : 'idle' as const },
      { label: 'VERIFY', state: verificationDone ? 'done' as const : hasPreview ? 'active' as const : 'idle' as const },
      { label: 'READY', state: ['preview_ready', 'completed'].includes(status) ? 'done' as const : failed ? 'error' as const : 'idle' as const },
    ];
  }, [currentAgent, focusMission, focusProgress, functionalPassed, functionalPlanned]);

  async function createMission(event: FormEvent) {
    event.preventDefault();
    const objective = command.trim();
    if (!objective || !selectedProject || submitting) return;
    setSubmitting(true);
    try {
      const payload = await requestJson<{ mission: Mission }>('/v1/missions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedProject.id,
          objective,
          riskLevel: risk,
          dataClass: 'private_code',
        }),
      });
      setCommand('');
      setSelectedMissionId(payload.mission.id);
      await refresh(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function openMission(missionId: string) {
    setSelectedMissionId(missionId);
    window.dispatchEvent(new CustomEvent('taso:open-mission', { detail: { missionId } }));
  }

  return (
    <section className="cc8-shell" aria-label="Taso Command Center">
      <header className="cc8-topbar">
        <div>
          <span className="cc8-eyebrow">AI ENGINEERING COMMAND CENTER</span>
          <h1>Taso <b>Operations</b></h1>
        </div>
        <div className="cc8-top-status" aria-live="polite">
          <span className={`cc8-health-dot ${health.ok ? 'is-ok' : 'is-bad'}`} />
          <div><strong>{health.ok ? 'Sistem çevrimiçi' : 'Sistem doğrulanamadı'}</strong><small>{health.version ? `Core v${health.version}` : state === 'loading' ? 'Senkronize ediliyor' : 'Core durumu'}</small></div>
          <button type="button" onClick={() => void refresh()} disabled={state === 'loading'}>Yenile</button>
        </div>
      </header>

      {error && <div className="cc8-alert" role="alert"><strong>Command Center</strong><span>{error}</span></div>}

      <div className="cc8-project-bar">
        <div className="cc8-project-label"><span>AKTİF PROJE</span><strong>{selectedProject?.name ?? 'Proje yok'}</strong></div>
        <div className="cc8-project-tabs" role="list" aria-label="Projeler">
          {projects.map((project) => (
            <button key={project.id} type="button" className={project.id === selectedProject?.id ? 'is-active' : ''} onClick={() => { setSelectedProjectId(project.id); setSelectedMissionId(''); }}>
              <span />{project.name}
            </button>
          ))}
          {!projects.length && <em>Henüz proje yok</em>}
        </div>
      </div>

      <div className="cc8-layout">
        <main className="cc8-primary">
          <article className="cc8-mission-deck">
            <div className="cc8-deck-head">
              <div>
                <span className="cc8-eyebrow">MISSION CONTROL</span>
                <h2>{focusMission?.objective ?? 'Aktif görev bulunmuyor'}</h2>
                <p>{focusMission ? `${focusMission.id} · ${stateLabel(focusMission.status)}` : 'Yeni bir görev verdiğinde yürütme zinciri burada canlı görünecek.'}</p>
              </div>
              {focusMission && <span className={`cc8-status cc8-status-${focusMission.status}`}>{stateLabel(focusMission.status)}</span>}
            </div>

            <div className="cc8-progress-zone">
              <div className="cc8-progress-ring" style={{ '--cc8-progress': `${focusProgress * 3.6}deg` } as React.CSSProperties}>
                <div><strong>{focusProgress}%</strong><span>ilerleme</span></div>
              </div>
              <div className="cc8-current-action">
                <span>ŞU AN</span>
                <strong>{focusMission?.execution?.currentAction ?? (focusMission ? stateLabel(focusMission.status) : 'Beklemede')}</strong>
                <p>{currentAgent ? `${currentAgent.label}${currentAgent.role ? ` · ${currentAgent.role}` : ''}` : focusMission?.execution?.activeAgentRole ? `Aktif rol: ${focusMission.execution.activeAgentRole}` : 'Çalışan specialist agent yok.'}</p>
                {focusMission?.execution?.blockedReason && <div className="cc8-blocker">Bloke: {focusMission.execution.blockedReason}</div>}
              </div>
              <div className="cc8-truth-grid">
                <div><span>Commit</span><strong>{compactSha(focusMission?.execution?.commitSha)}</strong></div>
                <div><span>CI</span><strong>{focusMission?.execution?.checkState ? stateLabel(focusMission.execution.checkState) : '—'}</strong></div>
                <div><span>Retry</span><strong>{focusMission?.execution?.retryCount ?? 0}</strong></div>
                <div><span>Doğrulama</span><strong>{functionalPlanned ? `${functionalPassed}/${functionalPlanned}` : '—'}</strong></div>
              </div>
            </div>

            <div className="cc8-chain" aria-label="Execution zinciri">
              {chainStages.length ? chainStages.map((stage) => <Stage key={stage.label} label={stage.label} state={stage.state} active={stage.state === 'active'} />) : <span className="cc8-empty-inline">Mission seçildiğinde zincir burada oluşacak.</span>}
            </div>

            <form className="cc8-command" onSubmit={createMission}>
              <div className="cc8-command-mark">T</div>
              <label>
                <span className="sr-only">Taso görevi</span>
                <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={selectedProject ? `${selectedProject.name} için Taso'ya görev ver…` : 'Önce bir proje oluştur…'} disabled={!selectedProject || submitting} />
              </label>
              <select value={risk} onChange={(event) => setRisk(event.target.value as RiskLevel)} aria-label="Risk seviyesi">
                <option value="READ">READ</option>
                <option value="WRITE">WRITE</option>
                <option value="HIGH_IMPACT">HIGH IMPACT</option>
              </select>
              <button type="submit" disabled={!command.trim() || !selectedProject || submitting}>{submitting ? 'Gönderiliyor…' : 'Gönder'}</button>
            </form>
          </article>

          <div className="cc8-lower-grid">
            <article className="cc8-surface cc8-activity">
              <div className="cc8-section-head"><div><span>CANLI AKIŞ</span><strong>Son operasyonlar</strong></div><small>{snapshot?.activity.length ?? 0} kayıt</small></div>
              <div className="cc8-feed">
                {snapshot?.activity.filter((item) => !selectedProject || item.projectId === selectedProject.id).slice(0, 14).map((item) => (
                  <button type="button" key={item.id} className="cc8-feed-row" onClick={() => openMission(item.missionId)}>
                    <span className={`cc8-event-dot cc8-event-${item.missionStatus}`} />
                    <div><strong>{item.message}</strong><p>{item.projectName} · {item.type}</p></div>
                    <time>{formatRelative(item.createdAt)}</time>
                  </button>
                ))}
                {state === 'ready' && !snapshot?.activity.length && <div className="cc8-empty">Henüz gerçek operasyon kaydı yok.</div>}
                {state === 'loading' && <div className="cc8-empty">Operasyonlar yükleniyor…</div>}
              </div>
            </article>

            <article className="cc8-surface cc8-project-health">
              <div className="cc8-section-head"><div><span>PROJE DURUMU</span><strong>{selectedProject?.name ?? '—'}</strong></div><button type="button" onClick={() => navigateTaso('Projects')}>Projeler →</button></div>
              <div className="cc8-project-stats">
                <div><span>Aktif görev</span><strong>{projectOps?.activeMissions ?? 0}</strong></div>
                <div><span>Teslim</span><strong>{projectOps?.deliveredMissions ?? 0}</strong></div>
                <div><span>Hata</span><strong>{projectOps?.failedMissions ?? 0}</strong></div>
                <div><span>Onay</span><strong>{projectOps?.waitingApproval ?? 0}</strong></div>
              </div>
              <div className="cc8-project-meter"><div><span>Mission tamamlanma</span><strong>{projectOps?.missionCompletionPercent ?? 0}%</strong></div><progress value={projectOps?.missionCompletionPercent ?? 0} max={100} /></div>
              <div className="cc8-repo-line"><span>Repository</span><strong>{selectedProject?.repository ?? '—'}</strong></div>
              <div className="cc8-repo-line"><span>Son activity</span><strong>{formatRelative(projectOps?.lastActivityAt)}</strong></div>
            </article>
          </div>
        </main>

        <aside className="cc8-rail">
          <article className="cc8-surface">
            <div className="cc8-section-head"><div><span>AGENT FLEET</span><strong>{liveAgents.length} aktif</strong></div><button type="button" onClick={() => navigateTaso('AI Agents')}>Tümü →</button></div>
            <div className="cc8-agent-list">
              {(snapshot?.agents ?? []).slice(0, 8).map((agent) => (
                <button type="button" className="cc8-agent" key={agent.id} onClick={() => agent.missionId && openMission(agent.missionId)} disabled={!agent.missionId}>
                  <span className={`cc8-agent-signal cc8-agent-${agent.status}`} />
                  <div><strong>{agent.label}</strong><p>{agent.detail}</p></div>
                  <small>{agent.progress != null ? `${agent.progress}%` : stateLabel(agent.status)}</small>
                </button>
              ))}
              {state === 'ready' && !snapshot?.agents.length && <div className="cc8-empty">Agent durumu yok.</div>}
            </div>
          </article>

          <article className="cc8-surface cc8-system">
            <div className="cc8-section-head"><div><span>SYSTEM HEALTH</span><strong>Gerçek durum</strong></div></div>
            <div className="cc8-health-row"><span className={health.ok ? 'is-ok' : 'is-bad'} /><div><strong>Taso Core</strong><small>{health.ok ? 'Çevrimiçi' : 'Doğrulanamadı'}</small></div></div>
            <div className="cc8-health-row"><span className={executor.readyForRead && executor.readyForWrite ? 'is-ok' : 'is-warn'} /><div><strong>Executor</strong><small>{executor.readyForRead && executor.readyForWrite ? 'Read / write hazır' : 'Kısıtlı'}</small></div></div>
            <div className="cc8-health-row"><span className={degradedAgents.length ? 'is-warn' : 'is-ok'} /><div><strong>Agent altyapısı</strong><small>{degradedAgents.length ? `${degradedAgents.length} bileşen dikkat istiyor` : 'Hazır'}</small></div></div>
            <div className="cc8-health-row"><span className={executor.readyForDeploy ? 'is-ok' : 'is-warn'} /><div><strong>Deploy executor</strong><small>{executor.readyForDeploy ? 'Hazır' : 'Hazır değil / doğrulanmadı'}</small></div></div>
          </article>

          <article className="cc8-surface cc8-approvals">
            <div className="cc8-section-head"><div><span>APPROVALS</span><strong>{pendingApprovals.length} bekliyor</strong></div><button type="button" onClick={() => navigateTaso('Approvals')}>Aç →</button></div>
            {pendingApprovals.slice(0, 3).map((mission) => (
              <button type="button" key={mission.id} className="cc8-approval" onClick={() => openMission(mission.id)}>
                <span>HIGH IMPACT</span><strong>{mission.objective}</strong><small>{mission.id}</small>
              </button>
            ))}
            {!pendingApprovals.length && <div className="cc8-empty compact">Onay kuyruğu temiz.</div>}
          </article>

          <div className="cc8-summary-strip">
            <div><span>Aktif mission</span><strong>{activeMissionCount}</strong></div>
            <div><span>Canlı agent</span><strong>{liveAgents.length}</strong></div>
            <div><span>Proje</span><strong>{projects.length}</strong></div>
          </div>
        </aside>
      </div>
    </section>
  );
}
