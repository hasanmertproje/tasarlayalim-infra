import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { navigateTaso } from './navigation';

type Project = { id: string; name: string; slug: string; repository: string };
type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  riskLevel?: 'READ' | 'WRITE' | 'HIGH_IMPACT';
  updatedAt?: string;
  execution?: {
    progressPercent?: number;
    currentAction?: string;
    activeAgentRole?: string;
    previewUrl?: string;
    checkState?: string;
    blockedReason?: string;
    pullRequestUrl?: string;
  };
};
type OpsProject = { projectId: string; activeMissions: number; waitingApproval: number; failedMissions: number; lastActivityAt?: string };
type Activity = { id: string; projectId: string; projectName: string; objective: string; missionStatus: string; message: string; createdAt: string };
type OpsAgent = { id: string; label: string; status: 'ready' | 'busy' | 'degraded' | 'unconfigured'; detail: string; missionId?: string; projectId?: string; role?: string; progress?: number };
type OperationsSnapshot = { generatedAt: string; projects: OpsProject[]; agents: OpsAgent[]; activity: Activity[] };
type Health = { ok?: boolean; version?: string; gateway?: string; state?: string; executor?: { read?: boolean; write?: boolean; deploy?: boolean } };
type Risk = 'READ' | 'WRITE' | 'HIGH_IMPACT';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const ACTIVE = new Set(['queued', 'planning', 'running', 'testing', 'waiting_approval', 'preview_ready']);

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); if (body?.error) detail = body.error; } catch { /* noop */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function relative(value?: string) {
  if (!value) return '—';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return '—';
  const min = Math.max(0, Math.floor(delta / 60000));
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} sa önce`;
  return new Date(value).toLocaleDateString('tr-TR');
}

function missionLabel(status?: string) {
  const labels: Record<string, string> = {
    queued: 'Kuyrukta', planning: 'Planlanıyor', running: 'Çalışıyor', testing: 'Doğrulanıyor',
    waiting_approval: 'Onay bekliyor', preview_ready: 'Preview hazır', completed: 'Tamamlandı',
    failed: 'Hata', cancelled: 'İptal edildi',
  };
  return status ? labels[status] ?? status : 'Aktif mission yok';
}

export default function CommandCenterV21() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [ops, setOps] = useState<OperationsSnapshot | null>(null);
  const [health, setHealth] = useState<Health>({});
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [command, setCommand] = useState('');
  const [risk, setRisk] = useState<Risk>('WRITE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoaded(false);
    try {
      const [projectPayload, missionPayload, operationsPayload, healthPayload] = await Promise.all([
        json<{ projects: Project[] }>('/v1/projects'),
        json<{ missions: Mission[] }>('/v1/missions'),
        json<{ operations: OperationsSnapshot }>('/v1/operations?limit=12'),
        json<Health>('/health'),
      ]);
      setProjects(projectPayload.projects ?? []);
      setMissions(missionPayload.missions ?? []);
      setOps(operationsPayload.operations ?? null);
      setHealth(healthPayload ?? {});
      setSelectedProjectId((current) => current || operationsPayload.operations?.projects.find((p) => p.activeMissions > 0)?.projectId || projectPayload.projects?.[0]?.id || '');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];
  const projectMissions = useMemo(() => missions.filter((m) => m.projectId === selectedProject?.id), [missions, selectedProject?.id]);
  const activeMission = useMemo(() => [...projectMissions].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).find((m) => ACTIVE.has(m.status)), [projectMissions]);
  const pendingApprovals = useMemo(() => missions.filter((m) => m.status === 'waiting_approval'), [missions]);
  const activeAgents = ops?.agents.filter((a) => a.status === 'busy') ?? [];
  const degradedAgents = ops?.agents.filter((a) => a.status === 'degraded' || a.status === 'unconfigured') ?? [];
  const progress = Math.max(0, Math.min(100, activeMission?.execution?.progressPercent ?? 0));
  const currentProjectOps = ops?.projects.find((p) => p.projectId === selectedProject?.id);
  const systemState = !loaded ? 'checking' : error ? 'down' : health.ok ? (degradedAgents.length ? 'degraded' : 'healthy') : 'unknown';
  const systemLabel = systemState === 'healthy' ? 'Sağlıklı' : systemState === 'degraded' ? 'Kısıtlı' : systemState === 'down' ? 'Erişilemiyor' : systemState === 'checking' ? 'Kontrol ediliyor' : 'Bilinmiyor';

  async function createMission(event: FormEvent) {
    event.preventDefault();
    const objective = command.trim();
    if (!objective || !selectedProject || busy) return;
    setBusy(true);
    try {
      await json('/v1/missions', { method: 'POST', body: JSON.stringify({ projectId: selectedProject.id, objective, riskLevel: risk, dataClass: 'private_code' }) });
      setCommand('');
      await refresh(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cc21-shell" aria-label="Taso ana kontrol merkezi">
      <div className="cc21-ambient cc21-ambient-a" />
      <div className="cc21-ambient cc21-ambient-b" />

      <header className="cc21-header">
        <div className="cc21-heading">
          <span>TASO · AI OPERATIONS</span>
          <h1>Kontrol Merkezi</h1>
          <p>Sistemin durumu, aktif iş ve senden beklenen karar tek ekranda.</p>
        </div>
        <div className={`cc21-health is-${systemState}`}>
          <i />
          <div><span>SİSTEM</span><strong>{systemLabel}</strong><small>{health.version ? `Core v${health.version}` : error || 'Gerçek zamanlı durum'}</small></div>
          <button type="button" onClick={() => void refresh()} aria-label="Durumu yenile">↻</button>
        </div>
      </header>

      {error && <div className="cc21-error" role="alert"><strong>Bağlantı sorunu</strong><span>{error}</span></div>}

      <div className="cc21-project-strip">
        <div><span>AKTİF PROJE</span><strong>{selectedProject?.name ?? 'Proje yok'}</strong><small>{selectedProject?.repository ?? 'Bir proje seç veya oluştur.'}</small></div>
        <select value={selectedProject?.id ?? ''} onChange={(e) => setSelectedProjectId(e.target.value)} aria-label="Aktif proje seç">
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </div>

      <div className="cc21-grid">
        <article className="cc21-focus">
          <div className="cc21-card-head"><span>ŞİMDİ</span><button type="button" onClick={() => navigateTaso('Tasks')}>Missionları aç ↗</button></div>
          {activeMission ? (
            <>
              <div className="cc21-mission-title"><div><small>{missionLabel(activeMission.status)}</small><h2>{activeMission.objective}</h2></div><strong>{progress}%</strong></div>
              <div className="cc21-progress"><i style={{ width: `${progress}%` }} /></div>
              <div className="cc21-now-grid">
                <div><span>AKTİF ADIM</span><strong>{activeMission.execution?.currentAction || missionLabel(activeMission.status)}</strong></div>
                <div><span>AGENT / ROL</span><strong>{activeMission.execution?.activeAgentRole || activeAgents.find((a) => a.missionId === activeMission.id)?.role || 'Atanmadı'}</strong></div>
                <div><span>SON GÜNCELLEME</span><strong>{relative(activeMission.updatedAt)}</strong></div>
                <div><span>RİSK</span><strong>{activeMission.riskLevel || 'Bilinmiyor'}</strong></div>
              </div>
              {(activeMission.execution?.blockedReason || activeMission.execution?.previewUrl) && <div className="cc21-context-line">{activeMission.execution?.blockedReason ? `Bloke: ${activeMission.execution.blockedReason}` : `Preview hazır: ${activeMission.execution?.previewUrl}`}</div>}
            </>
          ) : (
            <div className="cc21-empty"><strong>Aktif mission yok</strong><p>Taso şu anda bu proje için yürütme yapmıyor.</p></div>
          )}
        </article>

        <aside className="cc21-decision">
          <div className="cc21-card-head"><span>KARAR GEREKTİREN</span><button type="button" onClick={() => navigateTaso('Approvals')}>Tümü ↗</button></div>
          <strong className="cc21-decision-count">{pendingApprovals.length}</strong>
          <p>{pendingApprovals.length ? 'işlem senden açık onay bekliyor.' : 'Şu anda senden beklenen onay yok.'}</p>
          {pendingApprovals.slice(0, 2).map((mission) => <button className="cc21-approval-row" key={mission.id} type="button" onClick={() => navigateTaso('Approvals')}><span>{mission.riskLevel || 'WRITE'}</span><strong>{mission.objective}</strong><i>→</i></button>)}
        </aside>

        <article className="cc21-command">
          <div className="cc21-card-head"><span>TASO'YA GÖREV VER</span><small>Chat ≠ Mission</small></div>
          <form onSubmit={createMission}>
            <textarea value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ne yapmamı istiyorsun? Örn. preview sürümünü mobil ve masaüstünde kontrol et, sorunları düzelt." rows={4} />
            <div className="cc21-command-footer">
              <label>Risk<select value={risk} onChange={(e) => setRisk(e.target.value as Risk)}><option value="READ">READ</option><option value="WRITE">WRITE</option><option value="HIGH_IMPACT">HIGH IMPACT</option></select></label>
              <button type="submit" disabled={!command.trim() || busy || !selectedProject}>{busy ? 'Oluşturuluyor…' : 'Mission oluştur ↗'}</button>
            </div>
          </form>
        </article>

        <article className="cc21-pulse">
          <div className="cc21-card-head"><span>OPERASYON NABZI</span><button type="button" onClick={() => navigateTaso('Monitoring')}>İzleme ↗</button></div>
          <div className="cc21-pulse-grid">
            <div><strong>{ops?.projects.reduce((sum, p) => sum + p.activeMissions, 0) ?? '—'}</strong><span>aktif mission</span></div>
            <div><strong>{activeAgents.length}</strong><span>çalışan agent</span></div>
            <div><strong>{currentProjectOps?.failedMissions ?? '—'}</strong><span>proje hatası</span></div>
            <div><strong>{degradedAgents.length}</strong><span>kısıtlı servis</span></div>
          </div>
          <div className="cc21-activity">
            {(ops?.activity ?? []).slice(0, 4).map((item) => <div key={item.id}><i className={`state-${item.missionStatus}`} /><div><strong>{item.message}</strong><span>{item.projectName} · {relative(item.createdAt)}</span></div></div>)}
            {!ops?.activity?.length && <p>Henüz operasyon aktivitesi yok.</p>}
          </div>
        </article>
      </div>
    </section>
  );
}
