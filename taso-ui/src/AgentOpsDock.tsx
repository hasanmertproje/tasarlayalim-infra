import { useEffect, useMemo, useState } from 'react';

type AgentStatus = 'ready' | 'busy' | 'degraded' | 'unconfigured';
type AgentOpsMode = 'dock' | 'page';

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

type AgentOpsDockProps = {
  mode?: AgentOpsMode;
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

export default function AgentOpsDock({ mode = 'dock' }: AgentOpsDockProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/v1/operations?limit=${mode === 'page' ? 60 : 30}`, {
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
  }, [mode]);

  const overall = useMemo(() => {
    if (!snapshot) return error ? 'offline' : 'offline';
    if (snapshot.agents.some((agent) => agent.status === 'degraded')) return 'degraded';
    if (snapshot.agents.some((agent) => agent.status === 'busy')) return 'busy';
    return 'ready';
  }, [snapshot, error]);

  const activity = snapshot?.activity.slice(0, mode === 'page' ? 30 : 12) ?? [];
  const improvement = snapshot?.selfImprovement.missions.slice(0, mode === 'page' ? 16 : 8) ?? [];
  const visible = mode === 'page' || open;
  const readyAgents = snapshot?.agents.filter((agent) => agent.status === 'ready').length ?? 0;
  const busyAgents = snapshot?.agents.filter((agent) => agent.status === 'busy').length ?? 0;
  const degradedAgents = snapshot?.agents.filter((agent) => agent.status === 'degraded').length ?? 0;
  const activeMissions = snapshot?.projects.reduce((sum, project) => sum + project.activeMissions, 0) ?? 0;
  const failedMissions = snapshot?.projects.reduce((sum, project) => sum + project.failedMissions, 0) ?? 0;
  const waitingApprovals = snapshot?.projects.reduce((sum, project) => sum + project.waitingApproval, 0) ?? 0;

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
              <small>{snapshot ? `SYNC ${formatTime(snapshot.generatedAt)}` : 'SYNCING'}</small>
            </div>
            <div className="agent-ops-actions">
              <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Agent Operations verisini yenile">{loading ? '…' : '↻'}</button>
              {mode === 'dock' && <button type="button" onClick={() => setOpen(false)} aria-label="Agent Operations panelini kapat">×</button>}
            </div>
          </header>

          {error && <div className="agent-ops-error">Core operations okunamadı: {error}</div>}

          {mode === 'page' && (
            <section className="agent-ops-summary" aria-label="Agent Operations özeti">
              <article><span>READY AGENTS</span><strong>{readyAgents}</strong><small>{busyAgents} busy • {degradedAgents} degraded</small></article>
              <article><span>ACTIVE MISSIONS</span><strong>{activeMissions}</strong><small>Core mission state</small></article>
              <article><span>APPROVAL QUEUE</span><strong>{waitingApprovals}</strong><small>Human-gated actions</small></article>
              <article><span>FAILED MISSIONS</span><strong>{failedMissions}</strong><small>Needs review / retry</small></article>
            </section>
          )}

          <div className={mode === 'page' ? 'agent-ops-content-grid' : undefined}>
            <section className="agent-ops-section runtime-section">
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

            <section className="agent-ops-section workspace-section">
              <div className="agent-ops-section-head"><span>WORKSPACE EXECUTION</span><small>mission delivery — not project estimate</small></div>
              <div className="agent-project-list">
                {(snapshot?.projects ?? []).map((project) => (
                  <article className="agent-project-row" key={project.projectId}>
                    <div className="agent-project-title"><strong>{project.name}</strong><span>{project.missionCompletionPercent}%</span></div>
                    <div className="agent-progress-track"><i style={{ width: `${project.missionCompletionPercent}%` }} /></div>
                    <div className="agent-project-meta">
                      <span>{project.deliveredMissions}/{project.totalMissions} delivered</span>
                      <span>{project.activeMissions} active</span>
                      <span>{project.waitingApproval} approval</span>
                      <span>{project.retryingMissions} retrying</span>
                      <span className={project.failedMissions ? 'danger' : ''}>{project.failedMissions} failed</span>
                      {project.terminalSuccessPercent !== null && <span>{project.terminalSuccessPercent}% terminal success</span>}
                    </div>
                    <small className="agent-project-last">Last activity {formatTime(project.lastActivityAt)}</small>
                  </article>
                ))}
                {snapshot && snapshot.projects.length === 0 && <div className="agent-ops-empty">Workspace yok.</div>}
              </div>
            </section>

            <section className="agent-ops-section improvement-section">
              <div className="agent-ops-section-head"><span>SELF IMPROVEMENT</span><small>{snapshot?.selfImprovement.detection ?? 'objective-keywords'}</small></div>
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
              <div className="agent-ops-section-head"><span>LIVE ACTIVITY</span><small>{activity.length} recent events</small></div>
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
          </div>
        </aside>
      )}
    </div>
  );
}
