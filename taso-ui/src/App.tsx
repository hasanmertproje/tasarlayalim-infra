import { FormEvent, useEffect, useMemo, useState } from 'react';

type Project = {
  id: string;
  slug: string;
  name: string;
  repository: string;
  isExisting?: boolean;
};

type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  riskLevel?: 'READ' | 'WRITE' | 'HIGH_IMPACT';
  createdAt?: string;
};

type ApiStatus = 'checking' | 'online' | 'offline';

const API_URL = (import.meta.env.VITE_TASO_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const fallbackProjects: Project[] = [
  { id: 'reksa', slug: 'reksa-reklam', name: 'Reksa Reklam', repository: 'reksareklam' },
  { id: 'maria', slug: 'maria-cicek', name: 'Maria Çiçek', repository: 'mariacicek' },
  { id: 'growth', slug: 'growth-os', name: 'Growth OS', repository: 'growth-os' },
  { id: 'yoncali', slug: 'yoncali-dogan-apart', name: 'Yoncalı Doğan Apart', repository: 'dogan-apart' },
];

const fallbackMissions: Mission[] = [
  {
    id: 'RKS-0142',
    projectId: 'reksa',
    objective: 'Premium hero redesign',
    status: 'running',
    riskLevel: 'WRITE',
  },
  {
    id: 'MRC-0087',
    projectId: 'maria',
    objective: 'Mobil checkout akışını doğrula',
    status: 'waiting_approval',
    riskLevel: 'HIGH_IMPACT',
  },
];

const navItems = ['Command Center', 'Projects', 'Tasks', 'Approvals', 'Deployments', 'Notifications', 'Infrastructure'];

function stateLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'QUEUED',
    planning: 'PLANNING',
    running: 'EXECUTING',
    testing: 'TESTING',
    preview_ready: 'PREVIEW READY',
    waiting_approval: 'APPROVAL',
    completed: 'COMPLETED',
    failed: 'ERROR',
  };
  return labels[status] ?? status.toUpperCase();
}

function shortRepo(repository: string) {
  return repository.split('/').pop() ?? repository;
}

function Icon({ name }: { name: 'grid' | 'mic' | 'send' | 'shield' | 'git' | 'bell' | 'server' }) {
  const paths = {
    grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
    mic: <path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v3M9 21h6" />,
    send: <path d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13" />,
    shield: <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Zm-3 9 2 2 4-5" />,
    git: <path d="M7 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v7a2 2 0 1 0 2 2V9l6 6m2-4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />,
    bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />,
    server: <path d="M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01M11 8h6M11 16h6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function TasoOrb({ mode }: { mode: string }) {
  return (
    <div className={`orb-shell orb-${mode}`} role="img" aria-label={`Taso durumu: ${stateLabel(mode)}`}>
      <div className="orb-ring orb-ring-a" />
      <div className="orb-ring orb-ring-b" />
      <div className="orb-core">
        <span className="orb-mark">T</span>
      </div>
      <span className="orb-dot dot-a" />
      <span className="orb-dot dot-b" />
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>(fallbackProjects);
  const [missions, setMissions] = useState<Mission[]>(fallbackMissions);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [activeProjectId, setActiveProjectId] = useState('reksa');
  const [command, setCommand] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [activeNav, setActiveNav] = useState('Command Center');
  const [lastAction, setLastAction] = useState('Taso hazır. Bir proje seçip görev verebilirsin.');

  useEffect(() => {
    if (!API_URL) {
      setApiStatus('offline');
      return;
    }

    let cancelled = false;
    Promise.all([
      fetch(`${API_URL}/health`).then((response) => {
        if (!response.ok) throw new Error('health failed');
        return response.json();
      }),
      fetch(`${API_URL}/v1/projects`).then((response) => response.json()),
      fetch(`${API_URL}/v1/missions`).then((response) => response.json()),
    ])
      .then(([, projectResponse, missionResponse]) => {
        if (cancelled) return;
        if (Array.isArray(projectResponse.projects) && projectResponse.projects.length > 0) {
          setProjects(projectResponse.projects);
          setActiveProjectId(projectResponse.projects[0].id);
        }
        if (Array.isArray(missionResponse.missions)) setMissions(missionResponse.missions);
        setApiStatus('online');
      })
      .catch(() => {
        if (!cancelled) setApiStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  );

  const projectMissions = useMemo(
    () => missions.filter((mission) => mission.projectId === activeProject?.id),
    [missions, activeProject?.id],
  );

  const orbMode = isListening ? 'listening' : projectMissions[0]?.status ?? 'idle';

  async function submitCommand(event: FormEvent) {
    event.preventDefault();
    const objective = command.trim();
    if (!objective || !activeProject) return;

    setLastAction(`“${objective}” görevi ${activeProject.name} workspace'ine hazırlanıyor.`);
    setCommand('');

    if (!API_URL || apiStatus !== 'online') {
      const demoMission: Mission = {
        id: `${activeProject.slug.slice(0, 3).toUpperCase()}-${String(Date.now()).slice(-4)}`,
        projectId: activeProject.id,
        objective,
        status: 'planning',
        riskLevel: 'WRITE',
      };
      setMissions((current) => [demoMission, ...current]);
      setLastAction('Demo modunda mission oluşturuldu. API bağlandığında gerçek Taso Core kullanılacak.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/v1/missions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          objective,
          riskLevel: 'WRITE',
          dataClass: 'private_code',
        }),
      });
      if (!response.ok) throw new Error('mission create failed');
      const payload = await response.json();
      setMissions((current) => [payload.mission, ...current.filter((mission) => mission.id !== payload.mission.id)]);
      setLastAction(`Mission ${payload.mission.id} Taso Core'a gönderildi.`);
    } catch {
      setLastAction('Mission gönderilemedi. Taso Core bağlantısını kontrol et.');
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-glyph">T</div>
          <div>
            <strong>TASO</strong>
            <span>DEV CLOUD</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Ana navigasyon">
          {navItems.map((item, index) => (
            <button
              className={activeNav === item ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveNav(item)}
              key={item}
              type="button"
            >
              <span className="nav-index">0{index + 1}</span>
              <span>{item}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="system-mini">
            <span className={`status-dot ${apiStatus}`} />
            <div>
              <strong>Taso Core</strong>
              <small>{apiStatus === 'online' ? 'Connected' : apiStatus === 'checking' ? 'Checking…' : 'Demo mode'}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">TASARLAYALIM / AI OPERATIONS</span>
            <h1>{activeNav}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" type="button" aria-label="Bildirimler"><Icon name="bell" /></button>
            <div className="operator-chip"><span>HM</span><div><strong>Operator</strong><small>Admin</small></div></div>
          </div>
        </header>

        <section className="project-strip" aria-label="Proje seçici">
          <div className="project-switcher-label">ACTIVE WORKSPACE</div>
          <div className="project-tabs">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setActiveProjectId(project.id)}
                className={project.id === activeProject?.id ? 'project-tab active' : 'project-tab'}
              >
                <span className="project-signal" />
                {project.name}
              </button>
            ))}
          </div>
        </section>

        <section className="command-grid">
          <article className="taso-panel panel">
            <div className="panel-kicker"><span className="live-dot" /> TASO ONLINE</div>
            <div className="orb-stage">
              <TasoOrb mode={orbMode} />
              <div className="orb-copy">
                <span>{stateLabel(orbMode)}</span>
                <h2>{isListening ? 'Seni dinliyorum.' : 'Ne inşa ediyoruz?'}</h2>
                <p>{lastAction}</p>
              </div>
            </div>

            <form className="command-composer" onSubmit={submitCommand}>
              <button
                type="button"
                className={isListening ? 'voice-button listening' : 'voice-button'}
                onClick={() => {
                  setIsListening((value) => !value);
                  setLastAction(isListening ? 'Sesli oturum kapatıldı.' : `${activeProject?.name ?? 'Proje'} için dinliyorum…`);
                }}
                aria-pressed={isListening}
                aria-label="Taso ile konuş"
              >
                <Icon name="mic" />
              </button>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={`${activeProject?.name ?? 'Proje'} için Taso'ya görev ver…`}
                aria-label="Taso görevi"
              />
              <button className="send-button" type="submit" aria-label="Gönder"><Icon name="send" /></button>
            </form>
            <div className="command-hints"><span>↵ Gönder</span><span>🎙 Hold to talk — M2</span><span>Project isolated</span></div>
          </article>

          <aside className="mission-rail">
            <article className="panel context-panel">
              <div className="section-head"><span>WORKSPACE</span><small>isolated context</small></div>
              <h3>{activeProject?.name}</h3>
              <div className="meta-row"><Icon name="git" /><div><span>Repository</span><strong>{shortRepo(activeProject?.repository ?? '—')}</strong></div></div>
              <div className="meta-row"><Icon name="shield" /><div><span>Policy</span><strong>Preserve existing</strong></div></div>
              <div className="meta-row"><Icon name="server" /><div><span>Environment</span><strong>Preview protected</strong></div></div>
            </article>

            <article className="panel approval-panel">
              <div className="section-head"><span>APPROVALS</span><small>1 pending</small></div>
              <div className="approval-glow" />
              <strong>Production deploy</strong>
              <p>Maria Çiçek • MRC-0087</p>
              <div className="risk-line"><span>HIGH IMPACT</span><b>Human approval</b></div>
              <button type="button" className="ghost-button">Review request →</button>
            </article>
          </aside>
        </section>

        <section className="lower-grid">
          <article className="panel tasks-panel">
            <div className="section-head"><span>ACTIVE MISSIONS</span><small>{missions.length} total</small></div>
            <div className="task-list">
              {(projectMissions.length ? projectMissions : missions.slice(0, 3)).map((mission) => (
                <div className="task-row" key={mission.id}>
                  <div className={`task-state state-${mission.status}`}><span /></div>
                  <div className="task-main"><strong>{mission.objective}</strong><span>{mission.id} • {stateLabel(mission.status)}</span></div>
                  <div className="task-risk">{mission.riskLevel ?? 'WRITE'}</div>
                  <button type="button" className="task-open">↗</button>
                </div>
              ))}
            </div>
          </article>

          <article className="panel systems-panel">
            <div className="section-head"><span>SYSTEMS</span><small>live status</small></div>
            <div className="systems-grid">
              {[
                ['GitHub', 'Connected'],
                ['Coolify', 'Ready'],
                ['CI', 'Healthy'],
                ['ntfy', 'Online'],
              ].map(([name, status]) => (
                <div className="system-card" key={name}><span className="system-pulse" /><div><strong>{name}</strong><small>{status}</small></div></div>
              ))}
            </div>
          </article>
        </section>

        <footer className="status-footer">
          <span>PROJECT CONTEXT: <b>{activeProject?.slug}</b></span>
          <span>SECURITY: <b>PROJECT-SCOPED</b></span>
          <span>TASO UI v0.1</span>
        </footer>
      </main>

      <nav className="mobile-nav" aria-label="Mobil navigasyon">
        <button className="active" type="button"><Icon name="grid" /><span>Home</span></button>
        <button type="button"><Icon name="git" /><span>Projects</span></button>
        <button className="mobile-taso" type="button" onClick={() => setIsListening((value) => !value)}><Icon name="mic" /></button>
        <button type="button"><Icon name="shield" /><span>Approve</span></button>
        <button type="button"><Icon name="bell" /><span>Alerts</span></button>
      </nav>
    </div>
  );
}
