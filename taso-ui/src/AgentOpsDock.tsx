import { FormEvent, useEffect, useMemo, useState } from 'react';

type AgentStatus = 'ready' | 'busy' | 'degraded' | 'unconfigured';
type MilestoneStatus = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

type AgentItem = {
  id: string;
  label: string;
  status: AgentStatus;
  detail: string;
  activeMissions?: number;
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

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

export default function AgentOpsDock() {
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

  async function refresh() {
    setLoading(true);
    try {
      const payload = await requestJson<{ operations?: OperationsSnapshot }>('/v1/operations?limit=30');
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
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const overall = useMemo(() => {
    if (!snapshot) return 'offline';
    if (snapshot.agents.some((agent) => agent.status === 'degraded')) return 'degraded';
    if (snapshot.agents.some((agent) => agent.status === 'busy')) return 'busy';
    return 'ready';
  }, [snapshot]);

  const activity = snapshot?.activity.slice(0, 12) ?? [];
  const improvement = snapshot?.selfImprovement.missions.slice(0, 8) ?? [];
  const selectedProject = snapshot?.projects.find((project) => project.projectId === selectedProjectId) ?? snapshot?.projects[0];

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
    <div className={`agent-ops-shell ${open ? 'open' : ''}`}>
      <button
        type="button"
        className={`agent-ops-toggle state-${overall}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="agent-ops-panel"
      >
        <span className="agent-ops-pulse" />
        <span>AGENT OPS</span>
        {snapshot && <b>{snapshot.agents.filter((agent) => agent.status === 'busy').length || '•'}</b>}
      </button>

      {open && (
        <aside id="agent-ops-panel" className="agent-ops-panel" aria-label="Taso Agent Operations">
          <header className="agent-ops-header">
            <div>
              <span>TASO RUNTIME</span>
              <strong>Agent Operations</strong>
              <small>{snapshot ? `SYNC ${formatTime(snapshot.generatedAt)}` : 'SYNCING'}</small>
            </div>
            <div className="agent-ops-actions">
              <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : '↻'}</button>
              <button type="button" onClick={() => setOpen(false)}>×</button>
            </div>
          </header>

          {error && <div className="agent-ops-error">{error}</div>}

          <section className="agent-ops-section">
            <div className="agent-ops-section-head"><span>RUNTIME AGENTS</span><small>Core verified</small></div>
            <div className="agent-ops-agent-grid">
              {(snapshot?.agents ?? []).map((agent) => (
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

          <section className="agent-ops-section">
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
                  </article>
                );
              })}
              {snapshot && snapshot.projects.length === 0 && <div className="agent-ops-empty">Workspace yok.</div>}
            </div>
          </section>

          <section className="agent-ops-section milestone-control-section">
            <div className="agent-ops-section-head"><span>MILESTONE CONTROL</span><small>weighted progress</small></div>
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

          <section className="agent-ops-section">
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
                    <span className={project.failedMissions ? 'danger' : ''}>{project.failedMissions} failed</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="agent-ops-section">
            <div className="agent-ops-section-head"><span>SELF IMPROVEMENT</span><small>deterministic detection</small></div>
            <div className="agent-improvement-list">
              {improvement.map((mission) => (
                <article key={mission.missionId} className={`agent-improvement-row state-${mission.status}`}>
                  <span className="agent-runtime-dot" />
                  <div>
                    <strong>{mission.objective}</strong>
                    <p>{mission.projectName} • {mission.status.toUpperCase()} • {formatTime(mission.updatedAt)}</p>
                    {mission.blockedReason && <small>{mission.blockedReason}</small>}
                  </div>
                </article>
              ))}
              {snapshot && improvement.length === 0 && <div className="agent-ops-empty">Taso self-improvement mission bulunamadı.</div>}
            </div>
          </section>

          <section className="agent-ops-section activity-section">
            <div className="agent-ops-section-head"><span>LIVE ACTIVITY</span><small>{activity.length} recent</small></div>
            <div className="agent-activity-list">
              {activity.map((item) => (
                <article key={item.id} className={`agent-activity-row state-${item.missionStatus}`}>
                  <span className="agent-runtime-dot" />
                  <div>
                    <strong>{item.projectName} • {item.type.replace('mission.', '')}</strong>
                    <p>{item.message}</p>
                    <small>{item.objective} • {formatTime(item.createdAt)}</small>
                  </div>
                </article>
              ))}
              {snapshot && activity.length === 0 && <div className="agent-ops-empty">Henüz mission event yok.</div>}
            </div>
          </section>
        </aside>
      )}
    </div>
  );
}
