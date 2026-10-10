import { useEffect, useMemo, useState } from 'react';
import { navigateTaso } from './navigation';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type Project = { id: string; name: string; repository?: string };
type Mission = {
  id: string;
  projectId: string;
  objective: string;
  status: string;
  riskLevel?: string;
  createdAt?: string;
  updatedAt?: string;
  execution?: { currentAction?: string; checkState?: string; progressPercent?: number };
};
type Activity = {
  id: string;
  missionId: string;
  projectId: string;
  projectName: string;
  missionStatus: string;
  type: string;
  message: string;
  createdAt: string;
};
type Operations = { generatedAt?: string; activity?: Activity[] };

type FeedItem = {
  id: string;
  missionId: string;
  projectId: string;
  projectName: string;
  status: string;
  type: string;
  title: string;
  detail: string;
  createdAt?: string;
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function relative(value?: string) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds} sn önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return new Date(value).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function tone(value: string) {
  if (/failed|error|degraded|blocked/i.test(value)) return 'bad';
  if (/waiting_approval|approval|high_impact/i.test(value)) return 'warn';
  if (/completed|success|ready|preview_ready/i.test(value)) return 'ok';
  if (/running|testing|planning|queued/i.test(value)) return 'busy';
  return 'muted';
}

export default function NotificationsCenterV12() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  async function refresh() {
    try {
      const [projectPayload, missionPayload, operationsPayload] = await Promise.all([
        request<{ projects: Project[] }>('/v1/projects'),
        request<{ missions: Mission[] }>('/v1/missions'),
        request<{ operations: Operations }>('/v1/operations?limit=80').catch(() => ({ operations: { activity: [] } })),
      ]);
      setProjects(projectPayload.projects ?? []);
      setMissions(missionPayload.missions ?? []);
      setActivity(operationsPayload.operations?.activity ?? []);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const feed = useMemo<FeedItem[]>(() => {
    const activityItems = activity.map((item) => ({
      id: `activity:${item.id}`,
      missionId: item.missionId,
      projectId: item.projectId,
      projectName: item.projectName || projectById.get(item.projectId)?.name || item.projectId,
      status: item.missionStatus,
      type: item.type,
      title: item.message,
      detail: `${item.type} · ${item.missionStatus}`,
      createdAt: item.createdAt,
    }));
    const coveredMissions = new Set(activityItems.map((item) => item.missionId));
    const missionItems = missions
      .filter((mission) => !coveredMissions.has(mission.id))
      .map((mission) => ({
        id: `mission:${mission.id}`,
        missionId: mission.id,
        projectId: mission.projectId,
        projectName: projectById.get(mission.projectId)?.name ?? mission.projectId,
        status: mission.status,
        type: 'mission_state',
        title: mission.objective,
        detail: mission.execution?.currentAction ?? mission.status,
        createdAt: mission.updatedAt ?? mission.createdAt,
      }));
    return [...activityItems, ...missionItems]
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 80);
  }, [activity, missions, projectById]);

  const counters = useMemo(() => ({
    critical: feed.filter((item) => tone(item.status) === 'bad').length,
    approvals: missions.filter((mission) => mission.status === 'waiting_approval').length,
    active: missions.filter((mission) => ['queued', 'planning', 'running', 'testing'].includes(mission.status)).length,
    total: feed.length,
  }), [feed, missions]);

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  }

  function openMission(missionId: string) {
    window.dispatchEvent(new CustomEvent('taso:open-mission', { detail: { missionId } }));
    navigateTaso('Tasks');
  }

  return (
    <section className="nc12-shell" aria-label="Notifications and alerts">
      <header className="nc12-header">
        <div><span>OPERATIONS SIGNALS</span><h1>Bildirimler ve uyarılar</h1><p>Mission ve operations state içinden doğrulanmış olaylar. Sahte alarm, CPU veya servis metriği üretilmez.</p></div>
        <div className="nc12-actions"><button type="button" onClick={() => void refresh()}>↻ Yenile</button><button type="button" className="primary" onClick={() => void requestNotifications()} disabled={permission === 'unsupported'}>{permission === 'granted' ? 'Tarayıcı izinli' : permission === 'denied' ? 'Tarayıcı engelli' : permission === 'unsupported' ? 'Desteklenmiyor' : 'Tarayıcı bildirimi'}</button></div>
      </header>

      {error && <div className="nc12-error">Operations feed okunamadı: {error}</div>}

      <div className="nc12-metrics">
        <article><span>CRITICAL</span><strong className={counters.critical ? 'bad' : ''}>{counters.critical}</strong><small>failed / degraded / blocked</small></article>
        <article><span>APPROVAL</span><strong className={counters.approvals ? 'warn' : ''}>{counters.approvals}</strong><small>insan onayı bekleyen</small></article>
        <article><span>ACTIVE</span><strong>{counters.active}</strong><small>queued → testing</small></article>
        <article><span>FEED</span><strong>{counters.total}</strong><small>doğrulanmış kayıt</small></article>
      </div>

      <div className="nc12-layout">
        <main className="nc12-feed-panel">
          <div className="nc12-section-head"><div><span>LIVE ACTIVITY</span><strong>Operasyon akışı</strong></div><small>5 sn yenileme</small></div>
          <div className="nc12-feed">
            {feed.map((item) => (
              <button type="button" key={item.id} onClick={() => openMission(item.missionId)}>
                <i className={`nc12-dot ${tone(item.status)}`} />
                <time>{relative(item.createdAt)}</time>
                <div><span>{item.projectName} · {item.type}</span><strong>{item.title}</strong><p>{item.detail}</p></div>
                <b>{item.status}</b>
              </button>
            ))}
            {!feed.length && <div className="nc12-empty">Henüz doğrulanmış activity kaydı yok.</div>}
          </div>
        </main>

        <aside className="nc12-side">
          <section>
            <div className="nc12-section-head"><div><span>DELIVERY</span><strong>Bildirim kanalları</strong></div></div>
            <div className="nc12-channel"><i className={permission === 'granted' ? 'ok' : 'muted'} /><div><strong>Browser Notifications</strong><p>{permission === 'granted' ? 'Bu tarayıcı izin verdi.' : permission === 'denied' ? 'Tarayıcı tarafından engellendi.' : permission === 'unsupported' ? 'Bu ortam Notification API sunmuyor.' : 'İzin henüz verilmedi.'}</p></div><span>{String(permission).toUpperCase()}</span></div>
            <div className="nc12-channel"><i className="ok" /><div><strong>In-app feed</strong><p>Core mission ve operations activity state üzerinden çalışır.</p></div><span>ACTIVE</span></div>
            <div className="nc12-channel"><i className="muted" /><div><strong>External delivery</strong><p>Yeni provider veya kanal burada uydurulmaz; backend entegrasyonu olduğunda görünür.</p></div><span>TRUTHFUL</span></div>
          </section>
          <section>
            <div className="nc12-section-head"><div><span>POLICY</span><strong>Signal kuralları</strong></div></div>
            <div className="nc12-policy"><span>HIGH IMPACT</span><strong>Onay kuyruğu kritik sinyaldir.</strong><p>Production veya yüksek etkili işlem kullanıcı onayı olmadan başarı olarak gösterilmez.</p></div>
            <div className="nc12-policy"><span>FAILURE</span><strong>Runtime state kaynaklıdır.</strong><p>Failed, degraded ve blocked durumları gerçek state olmadan üretilmez.</p></div>
          </section>
        </aside>
      </div>
    </section>
  );
}
