import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  dataClass?: 'public' | 'private_code' | 'sensitive';
  approvalRequired?: boolean;
  providerChain?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type MissionEvent = {
  id?: string;
  missionId?: string;
  type?: string;
  message?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

type Provider = {
  id?: string;
  name?: string;
  enabled?: boolean;
  paid?: boolean;
  dataClasses?: string[];
};

type CoreHealth = {
  ok?: boolean;
  service?: string;
  version?: string;
  gateway?: string;
};

type ApiStatus = 'checking' | 'online' | 'offline';
type RiskLevel = 'READ' | 'WRITE' | 'HIGH_IMPACT';
type Theme = 'dark' | 'light';
type NavItem = 'Command Center' | 'Projects' | 'Tasks' | 'Approvals' | 'Deployments' | 'Notifications' | 'Infrastructure';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const navItems: NavItem[] = ['Command Center', 'Projects', 'Tasks', 'Approvals', 'Deployments', 'Notifications', 'Infrastructure'];

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
    cancelled: 'CANCELLED',
    idle: 'READY',
    listening: 'LISTENING',
  };
  return labels[status] ?? status.toUpperCase();
}

function shortRepo(repository: string) {
  return repository.split('/').pop() ?? repository;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function Icon({ name }: { name: 'grid' | 'mic' | 'send' | 'shield' | 'git' | 'bell' | 'server' | 'refresh' | 'plus' | 'check' | 'x' | 'rocket' | 'list' }) {
  const paths = {
    grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
    mic: <path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v3M9 21h6" />,
    send: <path d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13" />,
    shield: <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Zm-3 9 2 2 4-5" />,
    git: <path d="M7 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v7a2 2 0 1 0 2 2V9l6 6m2-4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />,
    bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />,
    server: <path d="M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01M11 8h6M11 16h6" />,
    refresh: <path d="M20 6v5h-5M4 18v-5h5M18 9a7 7 0 0 0-12-2l-2 2M6 15a7 7 0 0 0 12 2l2-2" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    x: <path d="m6 6 12 12M18 6 6 18" />,
    rocket: <path d="M14 5c2-2 4-2 5-2 0 1 0 3-2 5l-4 4-5-5 4-4ZM8 11l-4 1-2 2 5 1m6 1 1 5 2-2 1-4M9 15l-3 3" />,
    list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function TasoOrb({ mode }: { mode: string }) {
  return (
    <div className={`orb-shell orb-${mode}`} role="img" aria-label={`Taso durumu: ${stateLabel(mode)}`}>
      <div className="orb-ring orb-ring-a" />
      <div className="orb-ring orb-ring-b" />
      <div className="orb-ring orb-ring-c" />
      <div className="orb-core"><span className="orb-mark">T</span></div>
      <span className="orb-dot dot-a" />
      <span className="orb-dot dot-b" />
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [health, setHealth] = useState<CoreHealth>({});
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [activeNav, setActiveNav] = useState<NavItem>('Command Center');
  const [command, setCommand] = useState('');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('WRITE');
  const [isListening, setIsListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('taso-theme') as Theme) || 'dark');
  const [notice, setNotice] = useState('Taso hazır. Bir workspace seçip görev verebilirsin.');
  const [error, setError] = useState('');
  const [newProject, setNewProject] = useState({ name: '', slug: '', repository: '', isExisting: true });
  const recognitionRef = useRef<any>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  );

  const selectedMission = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionId),
    [missions, selectedMissionId],
  );

  const projectMissions = useMemo(
    () => missions.filter((mission) => mission.projectId === activeProject?.id),
    [missions, activeProject?.id],
  );

  const pendingApprovals = useMemo(
    () => missions.filter((mission) => mission.status === 'waiting_approval'),
    [missions],
  );

  const deploymentRequests = useMemo(
    () => missions.filter((mission) => /deploy|yayın|production|prod/i.test(mission.objective)),
    [missions],
  );

  const orbMode = isListening ? 'listening' : projectMissions[0]?.status ?? 'idle';

  function speak(text: string) {
    if (!voiceReplies || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  function showError(message: string) {
    setError(message);
    window.setTimeout(() => setError(''), 7000);
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
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

  async function refreshData(silent = false) {
    if (!silent) setBusy(true);
    try {
      const [healthResponse, projectsResponse, missionsResponse, providersResponse] = await Promise.all([
        api<CoreHealth>('/health'),
        api<{ projects: Project[] }>('/v1/projects'),
        api<{ missions: Mission[] }>('/v1/missions'),
        api<{ providers: Provider[] }>('/v1/providers'),
      ]);
      setHealth(healthResponse);
      setProjects(projectsResponse.projects ?? []);
      setMissions(missionsResponse.missions ?? []);
      setProviders(providersResponse.providers ?? []);
      setApiStatus('online');
      setActiveProjectId((current) => current || projectsResponse.projects?.[0]?.id || '');
      setNotice('Taso Core senkronize. Workspace verileri güncel.');
    } catch (cause) {
      setApiStatus('offline');
      showError(`Taso Core bağlantısı kurulamadı: ${(cause as Error).message}`);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('taso-theme', theme);
  }, [theme]);

  useEffect(() => {
    void refreshData(true);
    const timer = window.setInterval(() => void refreshData(true), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedMissionId || apiStatus !== 'online') {
      setEvents([]);
      return;
    }
    api<{ events: MissionEvent[] }>(`/v1/missions/${selectedMissionId}/events`)
      .then((payload) => setEvents(payload.events ?? []))
      .catch(() => setEvents([]));
  }, [selectedMissionId, apiStatus]);

  async function createMission(objective: string, requestedRisk: RiskLevel = riskLevel) {
    if (!activeProject || apiStatus !== 'online') {
      showError('Taso Core çevrimdışı. Görev oluşturulmadı.');
      return;
    }
    setBusy(true);
    try {
      const payload = await api<{ mission: Mission }>('/v1/missions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: activeProject.id,
          objective,
          riskLevel: requestedRisk,
          dataClass: 'private_code',
        }),
      });
      setMissions((current) => [payload.mission, ...current.filter((mission) => mission.id !== payload.mission.id)]);
      setSelectedMissionId(payload.mission.id);
      const text = payload.mission.status === 'waiting_approval'
        ? 'Görev oluşturuldu. Yüksek etkili işlem olduğu için onayın bekleniyor.'
        : 'Görev Taso Core görev kuyruğuna alındı.';
      setNotice(text);
      return payload.mission;
    } catch (cause) {
      showError(`Görev oluşturulamadı: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault();
    const objective = command.trim();
    if (!objective) return;
    setCommand('');
    await createMission(objective);
  }

  async function approveMission(mission: Mission) {
    setBusy(true);
    try {
      const payload = await api<{ mission: Mission }>(`/v1/missions/${mission.id}/approve`, { method: 'POST' });
      setMissions((current) => current.map((item) => item.id === mission.id ? payload.mission : item));
      setNotice(`${mission.id} onaylandı ve kuyruğa alındı.`);
    } catch (cause) {
      showError(`Onay başarısız: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancelMission(mission: Mission) {
    setBusy(true);
    try {
      const payload = await api<{ mission: Mission }>(`/v1/missions/${mission.id}/cancel`, { method: 'POST' });
      setMissions((current) => current.map((item) => item.id === mission.id ? payload.mission : item));
      setNotice(`${mission.id} iptal edildi.`);
    } catch (cause) {
      showError(`İptal başarısız: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!newProject.name.trim() || !newProject.slug.trim() || !newProject.repository.trim()) return;
    setBusy(true);
    try {
      const payload = await api<{ project: Project }>('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: newProject.name.trim(),
          slug: newProject.slug.trim().toLowerCase().replace(/\s+/g, '-'),
          repository: newProject.repository.trim(),
          isExisting: newProject.isExisting,
        }),
      });
      setProjects((current) => [...current, payload.project]);
      setActiveProjectId(payload.project.id);
      setNewProject({ name: '', slug: '', repository: '', isExisting: true });
      setNotice(`${payload.project.name} workspace'i oluşturuldu.`);
    } catch (cause) {
      showError(`Workspace oluşturulamadı: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function startVoice() {
    if (isListening) {
      recognitionRef.current?.stop?.();
      setIsListening(false);
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      showError('Bu tarayıcı Web Speech Recognition desteklemiyor. Chrome/Edge ile deneyebilirsin.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setIsListening(true);
      setNotice(`${activeProject?.name ?? 'Workspace'} için seni dinliyorum…`);
    };
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setCommand(transcript.trim());
    };
    recognition.onerror = (event: any) => showError(`Sesli giriş hatası: ${event.error ?? 'bilinmeyen hata'}`);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  }

  function requestBrowserNotifications() {
    if (!('Notification' in window)) {
      showError('Bu tarayıcı yerel bildirimleri desteklemiyor.');
      return;
    }
    void Notification.requestPermission().then((permission) => {
      setNotice(permission === 'granted' ? 'Tarayıcı bildirimleri açıldı.' : 'Tarayıcı bildirim izni verilmedi.');
    });
  }

  function switchNav(item: NavItem) {
    setActiveNav(item);
    if (item === 'Approvals' && pendingApprovals[0]) setSelectedMissionId(pendingApprovals[0].id);
  }

  function ProjectSwitcher() {
    return (
      <section className="project-strip" aria-label="Proje seçici">
        <div className="project-switcher-label">ACTIVE WORKSPACE</div>
        <div className="project-tabs">
          {projects.map((project) => (
            <button key={project.id} type="button" onClick={() => setActiveProjectId(project.id)} className={project.id === activeProject?.id ? 'project-tab active' : 'project-tab'}>
              <span className="project-signal" />{project.name}
            </button>
          ))}
          {projects.length === 0 && <span className="empty-inline">Workspace bulunamadı</span>}
        </div>
      </section>
    );
  }

  function MissionTable({ items = missions }: { items?: Mission[] }) {
    if (!items.length) return <div className="empty-state"><strong>Henüz görev yok.</strong><span>Taso'ya ilk görevi vererek akışı başlat.</span></div>;
    return (
      <div className="data-list">
        {items.map((mission) => {
          const project = projects.find((item) => item.id === mission.projectId);
          return (
            <button className={selectedMissionId === mission.id ? 'data-row selected' : 'data-row'} type="button" key={mission.id} onClick={() => setSelectedMissionId(mission.id)}>
              <span className={`state-dot state-${mission.status}`} />
              <span className="data-main"><strong>{mission.objective}</strong><small>{project?.name ?? mission.projectId} • {mission.id}</small></span>
              <span className="badge">{mission.riskLevel ?? 'WRITE'}</span>
              <span className={`status-pill status-${mission.status}`}>{stateLabel(mission.status)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function MissionDetail() {
    if (!selectedMission) return <div className="empty-state"><strong>Görev seç.</strong><span>Detayları ve olay akışını burada göreceksin.</span></div>;
    return (
      <div className="detail-stack">
        <div className="detail-head"><div><span>MISSION</span><h3>{selectedMission.objective}</h3><p>{selectedMission.id}</p></div><span className={`status-pill status-${selectedMission.status}`}>{stateLabel(selectedMission.status)}</span></div>
        <div className="metric-grid compact">
          <div><span>Risk</span><strong>{selectedMission.riskLevel ?? '—'}</strong></div>
          <div><span>Data</span><strong>{selectedMission.dataClass ?? '—'}</strong></div>
          <div><span>Created</span><strong>{formatDate(selectedMission.createdAt)}</strong></div>
          <div><span>Providers</span><strong>{selectedMission.providerChain?.join(' → ') || '—'}</strong></div>
        </div>
        <div className="detail-actions">
          {selectedMission.status === 'waiting_approval' && <button className="primary-button" type="button" onClick={() => void approveMission(selectedMission)}><Icon name="check" /> Onayla</button>}
          {selectedMission.status !== 'cancelled' && selectedMission.status !== 'completed' && <button className="danger-button" type="button" onClick={() => void cancelMission(selectedMission)}><Icon name="x" /> İptal</button>}
        </div>
        <div className="timeline">
          <div className="section-head"><span>MISSION TIMELINE</span><small>{events.length} event</small></div>
          {events.length ? events.map((event, index) => <div className="timeline-item" key={event.id ?? `${event.type}-${index}`}><span /><div><strong>{event.type ?? 'event'}</strong><p>{event.message ?? '—'}</p><small>{formatDate(event.createdAt)}</small></div></div>) : <p className="muted-copy">Bu görev için olay kaydı henüz yok veya yüklenemedi.</p>}
        </div>
      </div>
    );
  }

  function CommandCenter() {
    return (
      <>
        <ProjectSwitcher />
        <section className="command-grid">
          <article className="taso-panel panel">
            <div className="panel-kicker"><span className={`live-dot ${apiStatus}`} /> {apiStatus === 'online' ? 'TASO ONLINE' : apiStatus === 'checking' ? 'CONNECTING' : 'TASO OFFLINE'}</div>
            <div className="orb-stage">
              <TasoOrb mode={orbMode} />
              <div className="orb-copy"><span>{stateLabel(orbMode)}</span><h2>{isListening ? 'Seni dinliyorum.' : 'Ne inşa ediyoruz?'}</h2><p>{notice}</p></div>
            </div>
            <form className="command-composer" onSubmit={submitCommand}>
              <button type="button" className={isListening ? 'voice-button listening' : 'voice-button'} onClick={startVoice} aria-pressed={isListening} aria-label="Taso ile konuş"><Icon name="mic" /></button>
              <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={`${activeProject?.name ?? 'Workspace'} için Taso'ya görev ver…`} aria-label="Taso görevi" disabled={apiStatus !== 'online'} />
              <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as RiskLevel)} aria-label="Risk seviyesi"><option value="READ">READ</option><option value="WRITE">WRITE</option><option value="HIGH_IMPACT">HIGH IMPACT</option></select>
              <button className="send-button" type="submit" aria-label="Gönder" disabled={apiStatus !== 'online' || busy}><Icon name="send" /></button>
            </form>
            <div className="command-hints"><span>↵ Gönder</span><span>🎙 Türkçe sesli giriş</span><button type="button" onClick={() => setVoiceReplies((value) => !value)}>Sesli yanıt: {voiceReplies ? 'Açık' : 'Kapalı'}</button><span>Project isolated</span></div>
          </article>
          <aside className="mission-rail">
            <article className="panel context-panel">
              <div className="section-head"><span>WORKSPACE</span><small>isolated context</small></div>
              <h3>{activeProject?.name ?? 'Workspace yok'}</h3>
              <div className="meta-row"><Icon name="git" /><div><span>Repository</span><strong>{shortRepo(activeProject?.repository ?? '—')}</strong></div></div>
              <div className="meta-row"><Icon name="shield" /><div><span>Policy</span><strong>{activeProject?.isExisting === false ? 'Best-fit architecture' : 'Preserve existing'}</strong></div></div>
              <div className="meta-row"><Icon name="server" /><div><span>Core</span><strong>{apiStatus === 'online' ? `v${health.version ?? '?'}` : 'Offline'}</strong></div></div>
            </article>
            <article className="panel approval-panel">
              <div className="section-head"><span>APPROVALS</span><small>{pendingApprovals.length} pending</small></div>
              {pendingApprovals[0] ? <><div className="approval-glow" /><strong>{pendingApprovals[0].objective}</strong><p>{projects.find((item) => item.id === pendingApprovals[0].projectId)?.name ?? pendingApprovals[0].projectId} • {pendingApprovals[0].id}</p><div className="risk-line"><span>HIGH IMPACT</span><b>Human approval</b></div><button type="button" className="ghost-button" onClick={() => switchNav('Approvals')}>İncele →</button></> : <div className="empty-mini">Bekleyen onay yok.</div>}
            </article>
          </aside>
        </section>
        <section className="lower-grid">
          <article className="panel tasks-panel"><div className="section-head"><span>ACTIVE MISSIONS</span><small>{projectMissions.length} workspace</small></div><MissionTable items={projectMissions.slice(0, 4)} /></article>
          <article className="panel systems-panel"><div className="section-head"><span>SYSTEMS</span><small>verified state</small></div><div className="systems-grid"><div className="system-card"><span className={`system-pulse ${apiStatus}`} /><div><strong>Taso Core</strong><small>{apiStatus === 'online' ? 'Connected' : 'Unavailable'}</small></div></div><div className="system-card"><span className="system-pulse neutral" /><div><strong>GitHub</strong><small>CI managed externally</small></div></div><div className="system-card"><span className="system-pulse neutral" /><div><strong>Coolify</strong><small>Deploy managed externally</small></div></div><div className="system-card"><span className="system-pulse neutral" /><div><strong>ntfy</strong><small>CI notification channel</small></div></div></div></article>
        </section>
      </>
    );
  }

  function ProjectsScreen() {
    return <><ProjectSwitcher /><section className="screen-grid two"><article className="panel screen-panel"><div className="section-head"><span>WORKSPACES</span><small>{projects.length} isolated</small></div><div className="project-cards">{projects.map((project) => <button type="button" className={project.id === activeProject?.id ? 'project-card active' : 'project-card'} key={project.id} onClick={() => setActiveProjectId(project.id)}><div><span className="project-signal" /><strong>{project.name}</strong></div><p>{project.repository}</p><small>{project.isExisting === false ? 'NEW / BEST-FIT' : 'EXISTING / PRESERVE'}</small></button>)}</div></article><article className="panel screen-panel"><div className="section-head"><span>NEW WORKSPACE</span><small>project scoped</small></div><form className="stack-form" onSubmit={createProject}><label>Proje adı<input value={newProject.name} onChange={(e) => setNewProject((v) => ({ ...v, name: e.target.value }))} placeholder="Örn. Reksa Reklam" /></label><label>Slug<input value={newProject.slug} onChange={(e) => setNewProject((v) => ({ ...v, slug: e.target.value }))} placeholder="reksa-reklam" /></label><label>Repository / logical id<input value={newProject.repository} onChange={(e) => setNewProject((v) => ({ ...v, repository: e.target.value }))} placeholder="owner/repo veya repo adı" /></label><label className="check-line"><input type="checkbox" checked={newProject.isExisting} onChange={(e) => setNewProject((v) => ({ ...v, isExisting: e.target.checked }))} /> Mevcut projeyi koru</label><button className="primary-button" type="submit" disabled={busy || apiStatus !== 'online'}><Icon name="plus" /> Workspace oluştur</button></form><p className="callout">Repository alanı şu an proje bağlamı tanımlayıcısıdır; GitHub Tool Broker bağlantısı ayrı yürütme katmanında yapılacak.</p></article></section></>;
  }

  function TasksScreen() {
    return <><ProjectSwitcher /><section className="screen-grid task-layout"><article className="panel screen-panel"><div className="section-head"><span>MISSIONS</span><small>{missions.length} total</small></div><MissionTable /></article><article className="panel screen-panel"><MissionDetail /></article></section></>;
  }

  function ApprovalsScreen() {
    return <section className="screen-grid task-layout"><article className="panel screen-panel"><div className="section-head"><span>HUMAN APPROVAL QUEUE</span><small>{pendingApprovals.length} pending</small></div>{pendingApprovals.length ? <div className="approval-list">{pendingApprovals.map((mission) => <div className="approval-card" key={mission.id}><div><span>HIGH IMPACT</span><strong>{mission.objective}</strong><p>{projects.find((project) => project.id === mission.projectId)?.name ?? mission.projectId} • {mission.id}</p></div><div className="approval-actions"><button className="primary-button" type="button" onClick={() => void approveMission(mission)}><Icon name="check" /> Onayla</button><button className="danger-button" type="button" onClick={() => void cancelMission(mission)}><Icon name="x" /> Reddet</button></div></div>)}</div> : <div className="empty-state"><strong>Onay kuyruğu temiz.</strong><span>HIGH_IMPACT görevler burada insan onayı bekler.</span></div>}</article><article className="panel screen-panel"><div className="section-head"><span>APPROVAL POLICY</span><small>guardrail</small></div><div className="policy-card"><Icon name="shield" /><h3>Yetki sende kalır.</h3><p>Production, yıkıcı veya yüksek etkili görevler otomatik onaylanmaz. Taso Core bunları beklemeye alır ve yalnızca sen onayladıktan sonra kuyruğa geçirir.</p></div></article></section>;
  }

  function DeploymentsScreen() {
    return <><ProjectSwitcher /><section className="screen-grid two"><article className="panel screen-panel deploy-hero"><div><span className="eyebrow">CONTROLLED RELEASE</span><h2>{activeProject?.name ?? 'Workspace'} için yayın isteği</h2><p>Bu buton gerçek production deploy'u doğrudan başlatmaz. HIGH_IMPACT bir deployment mission'ı oluşturur ve önce onay kuyruğuna gönderir.</p></div><button className="primary-button large" type="button" disabled={!activeProject || apiStatus !== 'online' || busy} onClick={() => void createMission(`Production deploy request: ${activeProject?.name}`, 'HIGH_IMPACT')}><Icon name="rocket" /> Deploy request oluştur</button></article><article className="panel screen-panel"><div className="section-head"><span>DEPLOYMENT MISSIONS</span><small>{deploymentRequests.length} tracked</small></div><MissionTable items={deploymentRequests} /></article></section><div className="callout wide">Gerçek GitHub değişikliği, agent runtime ve Coolify deployment executor henüz Taso Core'a bağlanmış değil. Bu ekran şu an güvenli request + approval akışını işletir; sahte deploy durumu göstermez.</div></>;
  }

  function NotificationsScreen() {
    const recent = missions.slice(0, 8);
    return <section className="screen-grid two"><article className="panel screen-panel"><div className="section-head"><span>ACTIVITY FEED</span><small>Core state</small></div><div className="notification-feed">{recent.length ? recent.map((mission) => <button type="button" key={mission.id} onClick={() => { setSelectedMissionId(mission.id); setActiveNav('Tasks'); }}><span className={`state-dot state-${mission.status}`} /><div><strong>{stateLabel(mission.status)} • {mission.objective}</strong><p>{projects.find((project) => project.id === mission.projectId)?.name ?? mission.projectId} • {formatDate(mission.updatedAt ?? mission.createdAt)}</p></div></button>) : <div className="empty-state"><strong>Aktivite yok.</strong></div>}</div></article><article className="panel screen-panel"><div className="section-head"><span>DELIVERY CHANNELS</span><small>operator alerts</small></div><div className="channel-card"><Icon name="bell" /><div><strong>Browser notifications</strong><p>Bu cihazda Taso paneli için yerel izin iste.</p></div><button className="ghost-button compact-button" type="button" onClick={requestBrowserNotifications}>İzin ver</button></div><div className="channel-card"><span className="channel-mark">N</span><div><strong>ntfy / agent-ci</strong><p>CI başlangıç ve sonuç bildirimleri GitHub Actions tarafından güvenli secret'larla gönderilir.</p></div><span className="badge">CI</span></div><div className="channel-card"><span className="channel-mark">T</span><div><strong>Taso voice</strong><p>Türkçe konuşma tanıma ve tarayıcı speech synthesis aktif.</p></div><button className="ghost-button compact-button" type="button" onClick={() => setVoiceReplies((value) => !value)}>{voiceReplies ? 'Açık' : 'Kapalı'}</button></div></article></section>;
  }

  function InfrastructureScreen() {
    return <section className="screen-stack"><div className="metric-grid"><div className="metric-card"><span>CORE</span><strong>{apiStatus === 'online' ? 'ONLINE' : 'OFFLINE'}</strong><small>{health.service ?? 'taso-core'} {health.version ? `v${health.version}` : ''}</small></div><div className="metric-card"><span>GATEWAY</span><strong>{health.gateway?.toUpperCase() ?? 'UNKNOWN'}</strong><small>Browser → nginx → Core</small></div><div className="metric-card"><span>WORKSPACES</span><strong>{projects.length}</strong><small>project-scoped</small></div><div className="metric-card"><span>MISSIONS</span><strong>{missions.length}</strong><small>{pendingApprovals.length} approval pending</small></div></div><section className="screen-grid two"><article className="panel screen-panel"><div className="section-head"><span>AI PROVIDER ROUTER</span><small>{providers.length} slots</small></div>{providers.length ? <div className="provider-list">{providers.map((provider, index) => <div className="provider-row" key={provider.id ?? index}><span className={provider.enabled === false ? 'provider-light offline' : 'provider-light'} /><div><strong>{provider.name ?? provider.id ?? `Provider ${index + 1}`}</strong><small>{provider.dataClasses?.join(', ') || 'policy scoped'}</small></div><span className="badge">{provider.paid ? 'PAID' : 'FREE/FLEX'}</span></div>)}</div> : <div className="empty-state"><strong>Provider özeti yok.</strong><span>Core provider endpoint'i boş döndü.</span></div>}</article><article className="panel screen-panel"><div className="section-head"><span>RUNTIME BOUNDARIES</span><small>verified / external</small></div><div className="boundary-list"><div><span className={`system-pulse ${apiStatus}`} /><strong>Taso Core API</strong><small>{apiStatus === 'online' ? 'Verified live' : 'Unavailable'}</small></div><div><span className="system-pulse neutral" /><strong>GitHub Actions</strong><small>External CI — status comes through ntfy/GitHub</small></div><div><span className="system-pulse neutral" /><strong>Coolify</strong><small>External deploy plane</small></div><div><span className="system-pulse neutral" /><strong>ntfy</strong><small>External notification plane</small></div></div><p className="callout">Taso UI sahte “healthy” işaretleri üretmez. Bu ekranda yalnız Core'dan doğruladığımız durum canlı gösterilir; dış sistemler entegrasyon düzlemi olarak işaretlenir.</p></article></section></section>;
  }

  function renderScreen() {
    switch (activeNav) {
      case 'Projects': return <ProjectsScreen />;
      case 'Tasks': return <TasksScreen />;
      case 'Approvals': return <ApprovalsScreen />;
      case 'Deployments': return <DeploymentsScreen />;
      case 'Notifications': return <NotificationsScreen />;
      case 'Infrastructure': return <InfrastructureScreen />;
      default: return <CommandCenter />;
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-glyph">T</div><div><strong>TASO</strong><span>DEV CLOUD</span></div></div>
        <nav className="main-nav" aria-label="Ana navigasyon">{navItems.map((item, index) => <button className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => switchNav(item)} key={item} type="button"><span className="nav-index">0{index + 1}</span><span>{item}</span></button>)}</nav>
        <div className="sidebar-footer"><div className="system-mini"><span className={`status-dot ${apiStatus}`} /><div><strong>Taso Core</strong><small>{apiStatus === 'online' ? 'Connected' : apiStatus === 'checking' ? 'Checking…' : 'Offline'}</small></div></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><span className="eyebrow">TASARLAYALIM / AI OPERATIONS</span><h1>{activeNav}</h1></div><div className="top-actions"><button className="theme-toggle" type="button" aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}><span>{theme === 'dark' ? '☀' : '☾'}</span><b>{theme === 'dark' ? 'Açık' : 'Koyu'}</b></button><button className={busy ? 'icon-button spinning' : 'icon-button'} type="button" aria-label="Yenile" onClick={() => void refreshData()} disabled={busy}><Icon name="refresh" /></button><button className="icon-button" type="button" aria-label="Bildirimler" onClick={() => switchNav('Notifications')}><Icon name="bell" /></button><div className="operator-chip"><span>HM</span><div><strong>Operator</strong><small>Admin</small></div></div></div></header>
        {error && <div className="error-banner"><strong>⚠ Taso</strong><span>{error}</span><button type="button" onClick={() => setError('')}>×</button></div>}
        {renderScreen()}
        <footer className="status-footer"><span>PROJECT CONTEXT: <b>{activeProject?.slug ?? 'none'}</b></span><span>SECURITY: <b>PROJECT-SCOPED</b></span><span>TASO UI v1.0</span></footer>
      </main>
      <nav className="mobile-nav" aria-label="Mobil navigasyon"><button className={activeNav === 'Command Center' ? 'active' : ''} type="button" onClick={() => switchNav('Command Center')}><Icon name="grid" /><span>Home</span></button><button className={activeNav === 'Projects' ? 'active' : ''} type="button" onClick={() => switchNav('Projects')}><Icon name="git" /><span>Projects</span></button><button className={isListening ? 'mobile-taso listening' : 'mobile-taso'} type="button" onClick={startVoice}><Icon name="mic" /></button><button className={activeNav === 'Approvals' ? 'active' : ''} type="button" onClick={() => switchNav('Approvals')}><Icon name="shield" /><span>Approve</span></button><button className={activeNav === 'Notifications' ? 'active' : ''} type="button" onClick={() => switchNav('Notifications')}><Icon name="bell" /><span>Alerts</span></button></nav>
    </div>
  );
}
