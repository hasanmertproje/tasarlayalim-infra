import { useEffect, useMemo, useState } from 'react';

type AgentStatus = 'ready' | 'busy' | 'degraded' | 'unconfigured';

type AgentItem = {
  id: string;
  label: string;
  status: AgentStatus;
  detail: string;
  activeMissions?: number;
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

export default function AgentOpsDock() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/v1/operations?limit=30`, {
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json() as { operations?: OperationsSnapshot };
      if (!payload.operations) throw new Error('Operations snapshot missing.');
      setSnapshot(payload.operations);
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

          {error && <div className="agent-ops-error">Core operations okunamadı: {error}</div>}

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
            <div className="agent-ops-section-head"><span>WORKSPACE EXECUTION</span><small>mission completion</small></div>
            <div className="agent-project-list">
              {(snapshot?.projects ?? []).map((project) => (
                <article className="agent-project-row" key={project.projectId}>
                  <div className="agent-project-title"><strong>{project.name}</strong><span>{project.missionCompletionPercent}%</span></div>
                  <div className="agent-progress-track"><i style={{ width: `${project.missionCompletionPercent}%` }} /></div>
                  <div className="agent-project-meta">
                    <span>{project.deliveredMissions}/{project.totalMissions} delivered</span>
                    <span>{project.activeMissions} active</span>
                    <span>{project.waitingApproval} approval</span>
                    <span className={project.failedMissions ? 'danger' : ''}>{project.failedMissions} failed</span>
                  </div>
                </article>
              ))}
              {snapshot && snapshot.projects.length === 0 && <div className="agent-ops-empty">Workspace yok.</div>}
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
