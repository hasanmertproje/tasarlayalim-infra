import { useEffect, useMemo, useState } from 'react';

type Project = { id: string; name: string; repository: string };
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
  autonomous?: { production?: string; destructive?: string };
  execution?: {
    blockedReason?: string;
    currentAction?: string;
    branch?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    commitSha?: string;
    intentProfile?: {
      mode?: string;
      requiredSpecialists?: string[];
      constraints?: string[];
      acceptanceHints?: string[];
    };
  };
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch { /* keep HTTP error */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function relative(value?: string) {
  if (!value) return '—';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return value;
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes}dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa önce`;
  return new Date(value).toLocaleDateString('tr-TR');
}

function riskReason(mission: Mission) {
  if (mission.execution?.blockedReason) return mission.execution.blockedReason;
  if (mission.riskLevel === 'HIGH_IMPACT') return 'Bu mission yüksek etkili işlem içeriyor ve insan onayı olmadan yürütülmez.';
  if (mission.autonomous?.production === 'ask') return 'Production etkisi olabilecek işlem için açık operatör kararı gerekiyor.';
  return 'Bu mission policy gereği kullanıcı onayı bekliyor.';
}

export default function ApprovalCenterV9() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [missionPayload, projectPayload] = await Promise.all([
        requestJson<{ missions: Mission[] }>('/v1/missions'),
        requestJson<{ projects: Project[] }>('/v1/projects'),
      ]);
      setMissions(missionPayload.missions ?? []);
      setProjects(projectPayload.projects ?? []);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const pending = useMemo(() => missions.filter((mission) => mission.status === 'waiting_approval' || (mission.approvalRequired && !mission.approvedAt)), [missions]);
  const recentApproved = useMemo(() => missions.filter((mission) => mission.approvedAt).sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? '')).slice(0, 8), [missions]);
  const selected = pending.find((mission) => mission.id === selectedId) ?? pending[0];
  const project = projects.find((item) => item.id === selected?.projectId);

  useEffect(() => {
    if (!selectedId && pending[0]) setSelectedId(pending[0].id);
    if (selectedId && !pending.some((mission) => mission.id === selectedId)) setSelectedId(pending[0]?.id ?? '');
  }, [pending, selectedId]);

  async function act(mission: Mission, action: 'approve' | 'cancel') {
    setBusyId(mission.id);
    setError('');
    try {
      await requestJson(`/v1/missions/${mission.id}/${action}`, { method: 'POST' });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="ac9-shell" aria-label="Approval Center">
      <header className="ac9-topbar">
        <div><span className="ac9-kicker">HUMAN AUTHORITY</span><h1>Onay merkezi</h1><p>Yüksek etkili işlemler Taso tarafından sessizce geçilemez.</p></div>
        <div className="ac9-counter"><span>BEKLEYEN</span><strong>{pending.length}</strong></div>
      </header>

      {error && <div className="ac9-alert">{error}</div>}

      <div className="ac9-layout">
        <aside className="ac9-queue">
          <div className="ac9-section-head"><div><span>APPROVAL QUEUE</span><strong>Karar bekleyen işler</strong></div></div>
          <div className="ac9-queue-list">
            {pending.map((mission) => {
              const missionProject = projects.find((item) => item.id === mission.projectId);
              return <button type="button" key={mission.id} className={mission.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(mission.id)}>
                <i />
                <div><strong>{mission.objective}</strong><small>{missionProject?.name ?? mission.projectId} · {mission.riskLevel ?? '—'}</small></div>
                <span>{relative(mission.updatedAt)}</span>
              </button>;
            })}
            {!pending.length && <div className="ac9-empty">Şu anda onay bekleyen işlem yok.</div>}
          </div>
        </aside>

        <main className="ac9-main">
          {!selected ? <section className="ac9-clear"><div className="ac9-clear-mark">✓</div><h2>Onay kuyruğu temiz</h2><p>Taso şu anda senden yüksek riskli bir karar beklemiyor.</p></section> : <>
            <section className="ac9-decision">
              <div className="ac9-decision-head">
                <div><span>{project?.name ?? selected.projectId}</span><h2>{selected.objective}</h2><p>{selected.id}</p></div>
                <b>{selected.riskLevel ?? 'HIGH_IMPACT'}</b>
              </div>
              <div className="ac9-reason"><span>NEDEN DURDU?</span><strong>{riskReason(selected)}</strong></div>
              <div className="ac9-facts">
                <div><span>VERİ SINIFI</span><strong>{selected.dataClass ?? '—'}</strong></div>
                <div><span>BRANCH</span><strong>{selected.execution?.branch ?? 'Henüz yok'}</strong></div>
                <div><span>COMMIT</span><strong>{selected.execution?.commitSha?.slice(0, 9) ?? 'Henüz yok'}</strong></div>
                <div><span>PR</span><strong>{selected.execution?.pullRequestNumber ? `#${selected.execution.pullRequestNumber}` : 'Henüz yok'}</strong></div>
                <div><span>PRODUCTION</span><strong>{selected.autonomous?.production ?? 'ask'}</strong></div>
                <div><span>DESTRUCTIVE</span><strong>{selected.autonomous?.destructive ?? 'deny'}</strong></div>
              </div>
            </section>

            <div className="ac9-grid">
              <section className="ac9-surface">
                <div className="ac9-section-head"><div><span>TASO INTENT</span><strong>Görev nasıl anlaşıldı?</strong></div></div>
                <div className="ac9-intent">
                  <div><span>Mod</span><strong>{selected.execution?.intentProfile?.mode ?? 'Profil henüz oluşmadı'}</strong></div>
                  <div><span>Uzmanlıklar</span><strong>{selected.execution?.intentProfile?.requiredSpecialists?.join(', ') || '—'}</strong></div>
                </div>
                {(selected.execution?.intentProfile?.constraints ?? []).slice(0, 5).map((constraint) => <p className="ac9-rule" key={constraint}>{constraint}</p>)}
              </section>

              <section className="ac9-surface">
                <div className="ac9-section-head"><div><span>ACCEPTANCE</span><strong>Onay sonrası da geçerli şartlar</strong></div></div>
                <div className="ac9-acceptance">
                  {(selected.execution?.intentProfile?.acceptanceHints ?? []).slice(0, 6).map((hint) => <p key={hint}>{hint}</p>)}
                  {!(selected.execution?.intentProfile?.acceptanceHints?.length) && <div className="ac9-empty compact">Acceptance profili execution başlarken oluşturulacak.</div>}
                </div>
              </section>
            </div>

            <section className="ac9-actions">
              <div><span>OPERATOR DECISION</span><strong>Bu karar geri kalan yürütmenin kilidini açar.</strong><p>Onay vermek Taso’nun mevcut policy ve doğrulama kapılarını kaldırmaz.</p></div>
              <div className="ac9-action-buttons">
                <button type="button" className="deny" disabled={busyId === selected.id} onClick={() => void act(selected, 'cancel')}>İptal et</button>
                <button type="button" className="approve" disabled={busyId === selected.id} onClick={() => void act(selected, 'approve')}>{busyId === selected.id ? 'İşleniyor…' : 'Onayla ve yürüt'}</button>
              </div>
            </section>
          </>}
        </main>
      </div>

      <section className="ac9-history">
        <div className="ac9-section-head"><div><span>RECENT AUTHORITY</span><strong>Son verilen onaylar</strong></div></div>
        <div className="ac9-history-list">
          {recentApproved.map((mission) => <div key={mission.id}><i /><div><strong>{mission.objective}</strong><small>{projects.find((projectItem) => projectItem.id === mission.projectId)?.name ?? mission.projectId}</small></div><span>{relative(mission.approvedAt)}</span></div>)}
          {!recentApproved.length && <div className="ac9-empty compact">Henüz kayıtlı onay yok.</div>}
        </div>
      </section>
    </section>
  );
}
