import { useEffect, useMemo, useState } from 'react';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type MissionExecution = {
  summary?: string;
  branch?: string;
  commitSha?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  previewUrl?: string;
  productionUrl?: string;
  checkState?: 'success' | 'failed' | 'pending' | 'missing';
  blockedReason?: string;
  retryCount?: number;
  lastFailure?: string;
  nextRetryAt?: string;
};

type Mission = {
  id: string;
  objective: string;
  status: string;
  updatedAt?: string;
  autonomous?: { maxRetries?: number };
  execution?: MissionExecution;
};

type ExecutorState = {
  readyForRead?: boolean;
  readyForWrite?: boolean;
  readyForDeploy?: boolean;
  planningTimeoutMs?: number;
  ai?: { configured?: boolean; model?: string; privateCode?: boolean };
  github?: { configured?: boolean };
  coolify?: { configured?: boolean; projects?: string[] };
  activeMissionIds?: string[];
};

type Health = {
  version?: string;
  state?: string;
  executor?: { read?: boolean; write?: boolean; deploy?: boolean };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
      // keep http detail
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function Status({ on, label }: { on?: boolean; label: string }) {
  return <span className={on ? 'executor-chip ready' : 'executor-chip blocked'}><i />{label}</span>;
}

function stateLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'Kuyrukta', planning: 'Planlıyor', running: 'Çalışıyor', testing: 'CI kontrolü',
    preview_ready: 'Preview hazır', waiting_approval: 'Onay bekliyor', completed: 'Tamamlandı',
    failed: 'Hata', cancelled: 'İptal',
  };
  return labels[status] ?? status;
}

function formatRetryTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ExecutorDock() {
  const [open, setOpen] = useState(false);
  const [executor, setExecutor] = useState<ExecutorState>({});
  const [health, setHealth] = useState<Health>({});
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState('');

  async function refresh() {
    try {
      const [healthPayload, executorPayload, missionsPayload] = await Promise.all([
        request<Health>('/health'),
        request<{ executor: ExecutorState }>('/v1/executor'),
        request<{ missions: Mission[] }>('/v1/missions'),
      ]);
      setHealth(healthPayload);
      setExecutor(executorPayload.executor ?? {});
      setMissions(missionsPayload.missions ?? []);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCount = executor.activeMissionIds?.length ?? 0;
  const latest = useMemo(() => missions.slice(0, 6), [missions]);
  const ready = Boolean(executor.readyForRead && executor.readyForWrite);

  async function retry(mission: Mission) {
    setRetrying(mission.id);
    try {
      await request(`/v1/missions/${mission.id}/retry`, { method: 'POST' });
      await refresh();
    } catch (cause) {
      setError(`Retry: ${(cause as Error).message}`);
    } finally {
      setRetrying('');
    }
  }

  return (
    <div className={open ? 'executor-dock open' : 'executor-dock'}>
      <button type="button" className="executor-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={ready ? 'executor-orb ready' : 'executor-orb'}>T</span>
        <span><b>TASO EXECUTOR</b><small>{error ? 'Core erişilemiyor' : ready ? `${activeCount} aktif görev` : 'Kurulum bekliyor'}</small></span>
        <span className="executor-chevron">{open ? '×' : '↗'}</span>
      </button>

      {open && <section className="executor-panel" aria-label="Taso Executor">
        <header>
          <div><span>RUNTIME</span><strong>Executor Control</strong></div>
          <small>Core v{health.version ?? '?'} • {health.state ?? 'unknown'}{executor.planningTimeoutMs ? ` • plan ${Math.round(executor.planningTimeoutMs / 1000)}s` : ''}</small>
        </header>

        <div className="executor-readiness">
          <Status on={executor.ai?.configured} label={executor.ai?.model ? `AI · ${executor.ai.model}` : 'AI'} />
          <Status on={executor.github?.configured} label="GitHub" />
          <Status on={executor.coolify?.configured} label="Coolify" />
          <Status on={executor.ai?.privateCode} label="Private code" />
        </div>

        {error && <div className="executor-error">{error}</div>}

        <div className="executor-missions">
          <div className="executor-title"><span>SON GÖREVLER</span><small>{missions.length} toplam</small></div>
          {!latest.length && <p className="executor-empty">Henüz görev yok.</p>}
          {latest.map((mission) => {
            const retryCount = mission.execution?.retryCount ?? 0;
            const maxRetries = mission.autonomous?.maxRetries ?? 0;
            return <article key={mission.id} className={`executor-mission state-${mission.status}`}>
              <div className="executor-mission-head"><span className="executor-state-dot" /><div><strong>{mission.objective}</strong><small>{stateLabel(mission.status)}{retryCount ? ` • retry ${retryCount}/${maxRetries}` : ''}</small></div></div>
              {mission.execution?.summary && <p>{mission.execution.summary}</p>}
              {mission.execution?.blockedReason && <p className="executor-blocked">{mission.execution.blockedReason}</p>}
              {!mission.execution?.blockedReason && mission.execution?.lastFailure && <p className="executor-blocked">Son planlama hatası: {mission.execution.lastFailure}</p>}
              {mission.status === 'queued' && mission.execution?.nextRetryAt && <p>Otomatik tekrar deneme: {formatRetryTime(mission.execution.nextRetryAt)}</p>}
              <div className="executor-links">
                {mission.execution?.pullRequestUrl && <a href={mission.execution.pullRequestUrl} target="_blank" rel="noreferrer">PR #{mission.execution.pullRequestNumber ?? ''}</a>}
                {mission.execution?.previewUrl && <a href={mission.execution.previewUrl} target="_blank" rel="noreferrer">Preview</a>}
                {mission.execution?.productionUrl && <a href={mission.execution.productionUrl} target="_blank" rel="noreferrer">Production</a>}
                {mission.execution?.checkState && <span>CI: {mission.execution.checkState}</span>}
                {mission.status === 'failed' && <button type="button" onClick={() => void retry(mission)} disabled={retrying === mission.id}>{retrying === mission.id ? 'Retry…' : 'Retry'}</button>}
              </div>
            </article>;
          })}
        </div>

        {!ready && <div className="executor-note">Executor kodu hazır; AI ve GitHub runtime credentials eklenmeden görevler güvenli biçimde <b>failed</b> olur, sahte başarı üretilmez.</div>}
      </section>}
    </div>
  );
}
