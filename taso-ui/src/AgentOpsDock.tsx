import { FormEvent, useEffect, useMemo, useState } from 'react';

type AgentStatus = 'ready' | 'busy' | 'degraded' | 'unconfigured';
type MilestoneStatus = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
type AgentOpsMode = 'dock' | 'page';

type AgentItem = {
  id: string;
  label: string;
  status: AgentStatus;
  detail: string;
  activeMissions?: number;
  missionId?: string;
  projectId?: string;
  role?: 'scout' | 'architect' | 'builder' | 'verifier' | 'release';
  progress?: number;
  startedAt?: string;
};

type ProjectMilestone = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  weight: number;
  progress: number;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type MilestoneProgress = {
  configured: boolean;
  percent: number | null;
  total: number;
  completed: number;
  blocked: number;
  active: number;
  cancelled: number;
  totalWeight: number;
};

type ProjectSummary = {
  projectId: string;
  slug: string;
  name: string;
  totalMissions: number;
  activeMissions: number;
  deliveredMissions: number;
  failedMissions: number;
  cancelledMissions: number;
  waitingApproval: number;
  retryingMissions: number;
  missionCompletionPercent: number;
  terminalSuccessPercent: number | null;
  milestoneProgress: MilestoneProgress;
  milestones: ProjectMilestone[];
  lastActivityAt?: string;
};

type ActivityItem = {
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

type SelfImprovementItem = {
  missionId: string;
  projectId: string;
  projectName: string;
  objective: string;
  status: string;
  updatedAt: string;
  blockedReason?: string;
};

type OperationsSnapshot = {
  generatedAt: string;
  agents: AgentItem[];
  projects: ProjectSummary[];
  activity: ActivityItem[];
  selfImprovement: {
    detection: 'objective-keywords';
    missions: SelfImprovementItem[];
  };
};

type AgentOpsDockProps = {
  mode?: AgentOpsMode;
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusLabel(status: AgentStatus) {
  const labels: Record<AgentStatus, string> = {
    ready: 'READY',
    busy: 'BUSY',
    degraded: 'DEGRADED',
    unconfigured: 'UNCONFIGURED',
  };
  return labels[status];
}

function milestoneStatusLabel(status: MilestoneStatus) {
  const labels: Record<MilestoneStatus, string> = {
    planned: 'PLANLANDI',
    in_progress: 'DEVAM EDİYOR',
    blocked: 'BLOKE',
    completed: 'TAMAMLANDI',
    cancelled: 'İPTAL',
  };
  return labels[status];
}

function openMission(missionId: string) {
  window.dispatchEvent(new CustomEvent('taso:open-mission', { detail: { missionId } }));
}

export default function AgentOpsDock({ mode = 'dock' }: AgentOpsDockProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newMilestone, setNewMilestone] = useState({ title: '', weight: 1 });
  const [progressDrafts, setProgressDrafts] = useState<Record<string, number>>({});
  const [mutationBusy, setMutationBusy] = useState('');

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (payload?.error) detail = payload.error;
      } catch {
        // Keep HTTP detail.
      }
      throw new Error(detail);
    }
    return response.json() as Promise<T>;
  }

  async function refresh(background = false) {
    if (!background) setLoading(true);
    try {
      const payload = await requestJson<{ operations?: OperationsSnapshot }>(`/v1/operations?limit=${mode === 'page' ? 80 : 40}`);
      if (!payload.operations) throw new Error('Operations snapshot missing.');
      setSnapshot(payload.operations);
      setSelectedProjectId((current) => payload.operations?.projects.some((project) => project.projectId === current)
        ? current
        : payload.operations?.projects[0]?.projectId ?? '');
      setProgressDrafts((current) => {
        const next = { ...current };
        for (const project of payload.operations?.projects ?? []) {
          for (const milestone of project.milestones) {
            if (next[milestone.id] === undefined) next[milestone.id] = milestone.progress;
          }
        }
        return next;
      });
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (!background) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 2_000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const overall = useMemo(() => {
    if (!snapshot) return 'offline';
    if (snapshot.agents.some((agent) => agent.status === 'degraded')) return 'degraded';
    if (snapshot.agents.some((agent) => agent.status === 'busy')) return 'busy';
    return 'ready';
  }, [snapshot]);

  const activity = snapshot?.activity.slice(0, mode === 'page' ? 40 : 16) ?? [];
  const improvement = snapshot?.selfImprovement.missions.slice(0, mode === 'page' ? 16 : 8) ?? [];
  const selectedProject = snapshot?.projects.find((project) => project.projectId === selectedProjectId) ?? snapshot?.projects[0];
  const visible = mode === 'page' || open;
  const liveWorkers = snapshot?.agents.filter((agent) => agent.id.startsWith('worker:')) ?? [];
  const platformAgents = snapshot?.agents.filter((agent) => !agent.id.startsWith('worker:')) ?? [];
  const readyAgents = platformAgents.filter((agent) => agent.status === 'ready').length;
  const busyAgents = snapshot?.agents.filter((agent) => agent.status === 'busy').length ?? 0;
  const degradedAgents = platformAgents.filter((agent) => agent.status === 'degraded').length;
  const activeMissions = snapshot?.projects.reduce((sum, project) => sum + project.activeMissions, 0) ?? 0;
  const failedMissions = snapshot?.projects.reduce((sum, project) => sum + project.failedMissions, 0) ?? 0;
  const waitingApprovals = snapshot?.projects.reduce((sum, project) => sum + project.waitingApproval, 0) ?? 0;

  async function createMilestone(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject || !newMilestone.title.trim()) return;
    setMutationBusy('create');
    try {
      await requestJson(`/v1/projects/${selectedProject.projectId}/milestones`, {
        method: 'POST',
        body: JSON.stringify({ title: newMilestone.title.trim(), weight: newMilestone.weight, status: 'planned' }),
      });
      setNewMilestone({ title: '', weight: 1 });
      await refresh();
    } catch (cause) {
      setError(`Milestone oluşturulamadı: ${(cause as Error).message}`);
    } finally {
      setMutationBusy('');
    }
  }

  async function updateMilestone(milestone: ProjectMilestone, patch: Partial<Pick<ProjectMilestone, 'status' | 'progress' | 'weight' | 'title'>>) {
    setMutationBusy(milestone.id);
    try {
      await requestJson(`/v1/projects/${milestone.projectId}/milestones/${milestone.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await refresh();
    } catch (cause) {
      setError(`Milestone güncellenemedi: ${(cause as Error).message}`);
    } finally {
      setMutationBusy('');
    }
  }

  return (
    <div className={`agent-ops-shell mode-${mode} ${visible ? 'open' : ''}`}>
      {mode === 'dock' && (
        <button
          type="button"
          className={`agent-ops-toggle state-${overall}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="agent-ops-panel"
        >
          <span className="agent-ops-pulse" />
          <span>AGENT OPS</span>
          {snapshot && <b>{busyAgents || '•'}</b>}
        </button>
      )}

      {visible && (
        <aside id="agent-ops-panel" className="agent-ops-panel" aria-label="Taso Agent Operations">
          <header className="agent-ops-header">
            <div>
              <span>TASO RUNTIME</span>
              <strong>{mode === 'page' ? 'Agent Operations Center' : 'Agent Operations'}</strong>
              <small>{snapshot ? `LIVE ${formatTime(snapshot.generatedAt)} · 2s` : 'SYNCING'}</small>
            </div>
            <div className="agent-ops-actions">
              <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Agent Operations verisini yenile">{loading ? '…' : '↻'}</button>
              {mode === 'dock' && <button type="button" onClick={() => setOpen(false)} aria-label="Agent Operations panelini kapat">×</button>}
            </div>
          </header>

          {error && <div className="agent-ops-error">{error}</div>}

          {mode === 'page' && (
            <section className="agent-ops-summary" aria-label="Agent Operations özeti">
              <article><span>LIVE WORKERS</span><strong>{liveWorkers.length}</strong><small>{liveWorkers.length ? 'mission-scoped agents executing' : 'idle'}</small></article>
              <article><span>ACTIVE MISSIONS</span><strong>{activeMissions}</strong><small>Core mission state</small></article>
              <article><span>APPROVAL QUEUE</span><strong>{waitingApprovals}</strong><small>Human-gated actions</small></article>
              <article><span>FAILED MISSIONS</span><strong>{failedMissions}</strong><small>Needs review / retry</small></article>
            </section>
          )}

          <div className={mode === 'page' ? 'agent-ops-content-grid' : undefined}>
            <section className="agent-ops-section runtime-section">
              <div className="agent-ops-section-head"><span>LIVE MISSION AGENTS</span><small>actual execution state</small></div>
              <div className="agent-ops-agent-grid">
                {liveWorkers.map((agent) => (
                  <article className={`agent-runtime-card status-${agent.status}`} key={agent.id} onClick={() => agent.missionId && openMission(agent.missionId)}>
                    <div className="agent-runtime-top"><span className="agent-runtime-dot" /><b>{statusLabel(agent.status)}</b></div>
                    <strong>{agent.label}</strong>
                    <p>{agent.detail}</p>
                    {agent.progress !== undefined && (
                      <>
                        <div className="agent-progress-track mission-progress"><i style={{ width: `${agent.progress}%` }} /></div>
                        <small>{agent.role?.toUpperCase()} · %{agent.progress} · {formatTime(agent.startedAt)}</small>
                      </>
                    )}
                  </article>
                ))}
                {snapshot && liveWorkers.length === 0 && <div className="agent-ops-empty">Şu anda çalışan mission agent yok.</div>}
              </div>
            </section>

            <section className="agent-ops-section runtime-section">
              <div className="agent-ops-section-head"><span>PLATFORM RUNTIME</span><small>{readyAgents} ready · {degradedAgents} degraded</small></div>
              <div className="agent-ops-agent-grid">
                {platformAgents.map((agent) => (
                  <article className={`agent-runtime-card status-${agent.status}`} key={agent.id}>
                    <div className="agent-runtime-top"><span className="agent-runtime-dot" /><b>{statusLabel(agent.status)}</b></div>
                    <strong>{agent.label}</strong>
                    <p>{agent.detail}</p>
                    {agent.activeMissions !== undefined && <small>{agent.activeMissions} aktif mission</small>}
                  </article>
                ))}
                {!snapshot && !error && <div className="agent-ops-empty">Runtime snapshot yükleniyor…</div>}
              </div>
            </section>

            <section className="agent-ops-section project-progress-section">
              <div className="agent-ops-section-head"><span>PROJECT PROGRESS</span><small>explicit milestones</small></div>
              <div className="agent-project-list">
                {(snapshot?.projects ?? []).map((project) => {
                  const percent = project.milestoneProgress.percent;
                  return (
                    <article className="agent-project-row" key={project.projectId}>
                      <div className="agent-project-title">
                        <strong>{project.name}</strong>
                        <span>{percent === null ? 'PLAN YOK' : `${percent}%`}</span>
                      </div>
                      <div className={`agent-progress-track ${percent === null ? 'unconfigured' : ''}`}>
                        {percent !== null && <i style={{ width: `${percent}%` }} />}
                      </div>
                      <div className="agent-project-meta">
                        <span>{project.milestoneProgress.completed}/{project.milestoneProgress.total} milestone</span>
                        <span>{project.milestoneProgress.active} active</span>
                        <span className={project.milestoneProgress.blocked ? 'danger' : ''}>{project.milestoneProgress.blocked} blocked</span>
                        <span>missions: {project.missionCompletionPercent}% delivered</span>
                      </div>
                      <small className="agent-project-last">Son aktivite {formatTime(project.lastActivityAt)}</small>
                    </article>
                  );
                })}
                {snapshot && snapshot.projects.length === 0 && <div className="agent-ops-empty">Workspace yok.</div>}
              </div>
            </section>

            <section className="agent-ops-section milestone-control-section full-milestone-section">
              <div className="agent-ops-section-head"><span>MILESTONE CONTROL</span><small>weighted project progress</small></div>
              {snapshot?.projects.length ? (
                <>
                  <select className="milestone-project-select" value={selectedProject?.projectId ?? ''} onChange={(event) => setSelectedProjectId(event.target.value)}>
                    {snapshot.projects.map((project) => <option value={project.projectId} key={project.projectId}>{project.name}</option>)}
                  </select>
                  <form className="milestone-create-form" onSubmit={createMilestone}>
                    <input value={newMilestone.title} onChange={(event) => setNewMilestone((value) => ({ ...value, title: event.target.value }))} placeholder="Yeni milestone adı" maxLength={120} />
                    <label>Ağırlık<input type="number" min="1" max="100" value={newMilestone.weight} onChange={(event) => setNewMilestone((value) => ({ ...value, weight: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }))} /></label>
                    <button type="submit" disabled={mutationBusy === 'create' || !newMilestone.title.trim()}>{mutationBusy === 'create' ? '…' : '+ Ekle'}</button>
                  </form>
                  <div className="milestone-summary-line">
                    <strong>{selectedProject?.milestoneProgress.percent === null ? 'Plan tanımlı değil' : `%${selectedProject?.milestoneProgress.percent} proje ilerlemesi`}</strong>
                    <span>{selectedProject?.milestoneProgress.total ?? 0} milestone • toplam ağırlık {selectedProject?.milestoneProgress.totalWeight ?? 0}</span>
                  </div>
                  <div className="milestone-list">
                    {(selectedProject?.milestones ?? []).map((milestone) => {
                      const editableProgress = milestone.status === 'in_progress' || milestone.status === 'blocked';
                      return (
                        <article className={`milestone-row state-${milestone.status}`} key={milestone.id}>
                          <div className="milestone-row-head">
                            <div><strong>{milestone.title}</strong><small>Ağırlık {milestone.weight} • {milestoneStatusLabel(milestone.status)}</small></div>
                            <b>{milestone.progress}%</b>
                          </div>
                          <div className="milestone-row-controls">
                            <select value={milestone.status} disabled={mutationBusy === milestone.id} onChange={(event) => void updateMilestone(milestone, { status: event.target.value as MilestoneStatus })}>
                              <option value="planned">Planlandı</option>
                              <option value="in_progress">Devam ediyor</option>
                              <option value="blocked">Bloke</option>
                              <option value="completed">Tamamlandı</option>
                              <option value="cancelled">İptal</option>
                            </select>
                            <input
                              type="number"
                              min="0"
                              max="99"
                              disabled={!editableProgress || mutationBusy === milestone.id}
                              value={progressDrafts[milestone.id] ?? milestone.progress}
                              onChange={(event) => setProgressDrafts((current) => ({ ...current, [milestone.id]: Math.max(0, Math.min(99, Number(event.target.value) || 0)) }))}
                              aria-label={`${milestone.title} ilerleme yüzdesi`}
                            />
                            <button type="button" disabled={!editableProgress || mutationBusy === milestone.id} onClick={() => void updateMilestone(milestone, { progress: progressDrafts[milestone.id] ?? milestone.progress })}>{mutationBusy === milestone.id ? '…' : 'Kaydet'}</button>
                          </div>
                        </article>
                      );
                    })}
                    {selectedProject && selectedProject.milestones.length === 0 && <div className="agent-ops-empty">Bu workspace için milestone planı henüz yok.</div>}
                  </div>
                </>
              ) : <div className="agent-ops-empty">Milestone eklemek için önce workspace oluştur.</div>}
            </section>

            <section className="agent-ops-section mission-execution-section">
              <div className="agent-ops-section-head"><span>MISSION EXECUTION</span><small>delivery telemetry</small></div>
              <div className="agent-project-list compact-mission-progress">
                {(snapshot?.projects ?? []).map((project) => (
                  <article className="agent-project-row" key={project.projectId}>
                    <div className="agent-project-title"><strong>{project.name}</strong><span>{project.missionCompletionPercent}%</span></div>
                    <div className="agent-progress-track mission-progress"><i style={{ width: `${project.missionCompletionPercent}%` }} /></div>
                    <div className="agent-project-meta">
                      <span>{project.deliveredMissions}/{project.totalMissions} delivered</span>
                      <span>{project.activeMissions} active</span>
                      <span>{project.waitingApproval} approval</span>
                      <span>{project.retryingMissions} retrying</span>
                      <span className={project.failedMissions ? 'danger' : ''}>{project.failedMissions} failed</span>
                      {project.terminalSuccessPercent !== null && <span>{project.terminalSuccessPercent}% terminal success</span>}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="agent-ops-section improvement-section">
              <div className="agent-ops-section-head"><span>SELF IMPROVEMENT</span><small>{snapshot?.selfImprovement.detection ?? 'objective-keywords'}</small></div>
              <div className="agent-improvement-list">
                {improvement.map((mission) => (
                  <button type="button" onClick={() => openMission(mission.missionId)} key={mission.missionId} className={`agent-improvement-row agent-action-row state-${mission.status}`}>
                    <span className="agent-runtime-dot" />
                    <div>
                      <strong>{mission.objective}</strong>
                      <p>{mission.projectName} • {mission.status.toUpperCase()} • {formatTime(mission.updatedAt)}</p>
                      {mission.blockedReason && <small>{mission.blockedReason}</small>}
                      <em>Mission detayını aç →</em>
                    </div>
                  </button>
                ))}
                {snapshot && improvement.length === 0 && <div className="agent-ops-empty">Taso self-improvement mission bulunamadı.</div>}
              </div>
            </section>

            <section className="agent-ops-section activity-section">
              <div className="agent-ops-section-head"><span>LIVE ACTIVITY</span><small>{activity.length} recent events</small></div>
              <div className="agent-activity-list">
                {activity.map((item) => (
                  <button type="button" onClick={() => openMission(item.missionId)} key={item.id} className={`agent-activity-row agent-action-row state-${item.missionStatus}`}>
                    <span className="agent-runtime-dot" />
                    <div>
                      <strong>{item.projectName} • {item.type.replace('mission.', '').replace('agent.', 'agent ')}</strong>
                      <p>{item.message}</p>
                      <small>{item.objective} • {formatTime(item.createdAt)}</small>
                      <em>Mission detayını aç →</em>
                    </div>
                  </button>
                ))}
                {snapshot && activity.length === 0 && <div className="agent-ops-empty">Henüz mission event yok.</div>}
              </div>
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}
