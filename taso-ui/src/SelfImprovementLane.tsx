import { FormEvent, useEffect, useMemo, useState } from 'react';

type SelfImprovementMission = {
  missionId: string;
  projectId: string;
  projectName: string;
  objective: string;
  status: string;
  updatedAt: string;
  blockedReason?: string;
};

type ProjectSummary = {
  projectId: string;
  slug: string;
  name: string;
};

type OperationsSnapshot = {
  generatedAt: string;
  projects: ProjectSummary[];
  selfImprovement: {
    detection: 'objective-keywords';
    missions: SelfImprovementMission[];
  };
};

type MissionResponse = {
  mission: {
    id: string;
    status: string;
    approvalRequired?: boolean;
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

function missionLabel(status: string) {
  const labels: Record<string, string> = {
    waiting_approval: 'ONAY BEKLİYOR',
    queued: 'KUYRUKTA',
    planning: 'PLANLIYOR',
    running: 'ÇALIŞIYOR',
    testing: 'TEST EDİYOR',
    preview_ready: 'PREVIEW HAZIR',
    completed: 'TAMAMLANDI',
    failed: 'HATA',
    cancelled: 'İPTAL',
  };
  return labels[status] ?? status.toUpperCase();
}

export default function SelfImprovementLane() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>();
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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
    try {
      const payload = await requestJson<{ operations?: OperationsSnapshot }>('/v1/operations?limit=10');
      if (!payload.operations) throw new Error('Operations snapshot missing.');
      setSnapshot(payload.operations);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const project = useMemo(
    () => snapshot?.projects.find((item) => item.slug === 'taso-self-improvement'),
    [snapshot],
  );
  const missions = snapshot?.selfImprovement.missions.slice(0, 8) ?? [];
  const waitingCount = missions.filter((mission) => mission.status === 'waiting_approval').length;

  async function createProposal(event: FormEvent) {
    event.preventDefault();
    const requested = objective.trim();
    if (!project) {
      setError('Taso Self-Improvement workspace bulunamadı.');
      return;
    }
    if (requested.length < 8) {
      setError('Self-improvement önerisini biraz daha açık yaz.');
      return;
    }

    setBusy('create');
    try {
      const fullObjective = /^taso\s+self[-\s]?improvement/i.test(requested)
        ? requested
        : `Taso Self-Improvement: ${requested}`;
      const payload = await requestJson<MissionResponse>('/v1/missions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.projectId,
          objective: fullObjective,
          riskLevel: 'HIGH_IMPACT',
          dataClass: 'private_code',
          autonomous: {
            enabled: true,
            maxRetries: 2,
            previewRequired: true,
            production: 'ask',
            destructive: 'deny',
            paidAi: false,
            notifications: 'important_only',
          },
        }),
      });
      if (payload.mission.status !== 'waiting_approval' || !payload.mission.approvalRequired) {
        throw new Error('Safety invariant failed: self-improvement proposal did not enter approval queue.');
      }
      setObjective('');
      await refresh();
    } catch (cause) {
      setError(`Öneri oluşturulamadı: ${(cause as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function action(missionId: string, verb: 'approve' | 'cancel' | 'retry') {
    setBusy(missionId);
    try {
      const payload = await requestJson<MissionResponse>(`/v1/missions/${missionId}/${verb}`, { method: 'POST' });
      if (verb === 'retry' && payload.mission.status !== 'waiting_approval') {
        throw new Error('Safety invariant failed: retry did not return to approval queue.');
      }
      await refresh();
    } catch (cause) {
      setError(`Self-improvement aksiyonu başarısız: ${(cause as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className={`self-improve-shell ${open ? 'open' : ''}`}>
      <button className="self-improve-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="self-improve-panel">
        <span className="self-improve-mark">↗</span>
        <span>SELF IMPROVE</span>
        {waitingCount > 0 && <b>{waitingCount}</b>}
      </button>

      {open && (
        <aside id="self-improve-panel" className="self-improve-panel" aria-label="Taso Self Improvement Control">
          <header className="self-improve-header">
            <div><span>GUARDED EVOLUTION</span><strong>Self‑Improvement</strong><small>Her kod değişikliği insan onayı ister.</small></div>
            <button type="button" onClick={() => setOpen(false)}>×</button>
          </header>

          {error && <div className="self-improve-error">{error}</div>}

          <section className="self-improve-policy">
            <div><span>01</span><p>Öneri HIGH_IMPACT mission olarak oluşturulur.</p></div>
            <div><span>02</span><p>Operator onayı olmadan executor çalışmaz.</p></div>
            <div><span>03</span><p>Failed retry eski onayı kullanmaz; tekrar onay ister.</p></div>
          </section>

          <form className="self-improve-form" onSubmit={createProposal}>
            <label>Yeni geliştirme önerisi<textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Örn. Taso mission timeline içindeki retry nedenlerini daha anlaşılır hale getir." maxLength={1000} /></label>
            <div><small>{project ? `${project.name} • ${project.projectId}` : 'Self-improvement workspace bekleniyor…'}</small><button type="submit" disabled={!project || busy === 'create'}>{busy === 'create' ? 'Oluşturuluyor…' : 'Onaya gönder'}</button></div>
          </form>

          <section className="self-improve-list">
            <div className="self-improve-list-head"><span>SELF-IMPROVEMENT MISSIONS</span><small>{missions.length} recent</small></div>
            {missions.map((mission) => (
              <article className={`self-improve-mission state-${mission.status}`} key={mission.missionId}>
                <div className="self-improve-mission-head"><span className="self-improve-status-dot" /><div><strong>{mission.objective}</strong><small>{missionLabel(mission.status)} • {formatTime(mission.updatedAt)}</small></div></div>
                {mission.blockedReason && <p className="self-improve-blocked">{mission.blockedReason}</p>}
                <div className="self-improve-actions">
                  {mission.status === 'waiting_approval' && <><button className="approve" type="button" disabled={busy === mission.missionId} onClick={() => void action(mission.missionId, 'approve')}>Onayla ve kuyruğa al</button><button className="reject" type="button" disabled={busy === mission.missionId} onClick={() => void action(mission.missionId, 'cancel')}>Reddet</button></>}
                  {mission.status === 'failed' && <button className="retry" type="button" disabled={busy === mission.missionId} onClick={() => void action(mission.missionId, 'retry')}>Yeniden onaya al</button>}
                  {!['waiting_approval', 'failed'].includes(mission.status) && <span>{missionLabel(mission.status)}</span>}
                </div>
              </article>
            ))}
            {snapshot && missions.length === 0 && <div className="self-improve-empty">Henüz self-improvement mission yok.</div>}
          </section>
        </aside>
      )}
    </div>
  );
}
