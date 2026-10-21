import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useTasoNavigation } from './navigation';
import type { RealtimeVoiceStatus } from './RealtimeVoiceClient';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type HealthState = {
  ok?: boolean;
  service?: string;
  version?: string;
  gateway?: string;
  state?: string;
  conversation?: { configured?: boolean; provider?: string; model?: string };
  executor?: { read?: boolean; write?: boolean; deploy?: boolean };
};

type ExecutorState = {
  readyForRead?: boolean;
  readyForWrite?: boolean;
  readyForDeploy?: boolean;
  planningTimeoutMs?: number;
  activeMissionIds?: string[];
  ai?: { configured?: boolean; model?: string; privateCode?: boolean };
  github?: { configured?: boolean };
  coolify?: { configured?: boolean; projects?: string[] };
};

type OperationsState = {
  agents?: Array<{ id?: string; label?: string; state?: string }>;
  activity?: unknown[];
  projects?: unknown[];
};

type Snapshot = {
  health: HealthState;
  executor: ExecutorState;
  operations?: OperationsState;
  realtime?: RealtimeVoiceStatus;
  generatedAt: string;
};

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) detail = payload.error;
    } catch {
      // Preserve HTTP detail.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function boolLabel(value?: boolean) {
  return value ? 'READY' : 'UNAVAILABLE';
}

function voicePreference(key: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

export default function TruthSurfaces() {
  const [screen] = useTasoNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const active = screen === 'Monitoring' || screen === 'Settings' || screen === 'Deployments' || screen === 'Infrastructure';

  useEffect(() => {
    setTarget(document.querySelector('.main-area'));
  }, []);

  async function refresh() {
    if (!active) return;
    setLoading(true);
    try {
      const [health, executorPayload, operationsPayload, realtimePayload] = await Promise.all([
        api<HealthState>('/health'),
        api<{ executor: ExecutorState }>('/v1/executor'),
        api<OperationsState>('/v1/operations').catch(() => undefined),
        api<{ realtime: RealtimeVoiceStatus }>('/v1/voice/realtime').catch(() => undefined),
      ]);
      setSnapshot({
        health,
        executor: executorPayload.executor ?? {},
        operations: operationsPayload,
        realtime: realtimePayload?.realtime,
        generatedAt: new Date().toISOString(),
      });
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [active, screen]);

  const executor = snapshot?.executor ?? {};
  const health = snapshot?.health ?? {};
  const realtime = snapshot?.realtime;
  const readyAgents = useMemo(() => snapshot?.operations?.agents?.filter((agent) => /ready|online/i.test(agent.state ?? '')).length ?? 0, [snapshot]);

  if (!target || !active) return null;

  if (screen === 'Infrastructure') {
    return createPortal(
      <section className="truth-surface monitoring-truth infrastructure-truth" aria-label="TASO Infrastructure">
        <header className="truth-header">
          <div><span>PLATFORM INFRASTRUCTURE</span><h2>Altyapı durumu</h2><p>Bu ekran Core health ve executor capability sözleşmelerinden okunan durumu gösterir. Sunucu kaynak ölçümleri ve sağlayıcı servislerinin canlı health endpoint'leri yoksa tahmin edilmez.</p></div>
          <div className="truth-actions"><small>{snapshot ? `SYNC ${formatTime(snapshot.generatedAt)}` : 'SYNCING'}</small><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : '↻ Yenile'}</button></div>
        </header>
        {error && <div role="alert" className="truth-error">Altyapı snapshot'ı okunamadı: {error}</div>}
        <div className="truth-summary-grid">
          <article className={health.ok ? 'ready' : 'unavailable'}><span>CORE API</span><strong>{health.ok ? 'ONLINE' : 'UNAVAILABLE'}</strong><small>{health.service ?? 'taso-core'} {health.version ? `v${health.version}` : ''}</small></article>
          <article className={health.gateway === 'configured' ? 'ready' : 'unavailable'}><span>GATEWAY</span><strong>{health.gateway?.toUpperCase() ?? 'UNKNOWN'}</strong><small>Authenticated UI → Core</small></article>
          <article className={health.state === 'persistent' ? 'ready' : 'guarded'}><span>STATE STORE</span><strong>{health.state?.toUpperCase() ?? 'UNKNOWN'}</strong><small>Reported persistence mode</small></article>
          <article className={executor.coolify?.configured ? 'ready' : 'unavailable'}><span>COOLIFY BROKER</span><strong>{executor.coolify?.configured ? 'CONFIGURED' : 'UNAVAILABLE'}</strong><small>Configuration, not deployment health</small></article>
        </div>
        <div className="truth-layout">
          <article className="truth-panel">
            <div className="truth-panel-head"><span>EXECUTION CAPABILITIES</span><small>Core-reported</small></div>
            <div className="truth-capability-grid three">
              <div className={executor.readyForRead ? 'ready' : 'unavailable'}><span>READ</span><strong>{boolLabel(executor.readyForRead)}</strong></div>
              <div className={executor.readyForWrite ? 'ready' : 'unavailable'}><span>WRITE</span><strong>{boolLabel(executor.readyForWrite)}</strong></div>
              <div className={executor.readyForDeploy ? 'ready' : 'unavailable'}><span>DEPLOY</span><strong>{boolLabel(executor.readyForDeploy)}</strong></div>
            </div>
            <div className="truth-facts">
              <div><span>GitHub broker</span><strong>{executor.github?.configured ? 'CONFIGURED' : 'MISSING'}</strong></div>
              <div><span>AI runtime</span><strong>{executor.ai?.configured ? 'CONFIGURED' : 'MISSING'}</strong></div>
              <div><span>Active missions</span><strong>{executor.activeMissionIds?.length ?? '—'}</strong></div>
              <div><span>Planning deadline</span><strong>{executor.planningTimeoutMs ? `${Math.round(executor.planningTimeoutMs / 1000)}s` : '—'}</strong></div>
            </div>
          </article>
          <article className="truth-panel">
            <div className="truth-panel-head"><span>AGENT & ACTIVITY SNAPSHOT</span><small>operations API</small></div>
            <div className="truth-facts">
              <div><span>Reported agents</span><strong>{snapshot?.operations?.agents?.length ?? '—'}</strong></div>
              <div><span>Ready / online agents</span><strong>{snapshot?.operations ? readyAgents : '—'}</strong></div>
              <div><span>Recent activity records</span><strong>{snapshot?.operations?.activity?.length ?? '—'}</strong></div>
              <div><span>Project records</span><strong>{snapshot?.operations?.projects?.length ?? '—'}</strong></div>
            </div>
            <p className="truth-boundary">Bu sayılar Core operations cevabından gelir. CPU, RAM, disk, uptime veya servis başına canlı health ölçümü bu API tarafından sunulmadığından gösterilmez.</p>
          </article>
        </div>
        <div className="truth-boundary">Güvenlik sınırı: Bu ekran yalnızca gözlem yapar; deploy, restart, secret görüntüleme veya production değişikliği tetiklemez. READY durumu canlı dağıtımın başarılı olduğunu kanıtlamaz.</div>
      </section>,
      target,
    );
  }

  if (screen === 'Deployments') {
    return createPortal(
      <section className="truth-surface deployment-truth" aria-label="Deployment runtime truth">
        <header className="truth-header compact">
          <div><span>RUNTIME TRUTH</span><h2>Deployment readiness</h2><p>Readiness yalnız teknik broker kullanılabilirliğini gösterir. Production yetkisi ve canlı deploy sonucu ayrı doğrulanır.</p></div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : '↻ Yenile'}</button>
        </header>
        {error && <div className="truth-error">Runtime snapshot okunamadı: {error}</div>}
        <div className="truth-capability-grid">
          <article className={executor.readyForRead ? 'ready' : 'unavailable'}><span>READ</span><strong>{boolLabel(executor.readyForRead)}</strong><small>Planner + GitHub read path</small></article>
          <article className={executor.readyForWrite ? 'ready' : 'unavailable'}><span>WRITE</span><strong>{boolLabel(executor.readyForWrite)}</strong><small>Guarded repository write path</small></article>
          <article className={executor.readyForDeploy ? 'ready' : 'unavailable'}><span>DEPLOY</span><strong>{boolLabel(executor.readyForDeploy)}</strong><small>Coolify broker availability</small></article>
          <article className="guarded"><span>PRODUCTION</span><strong>HUMAN GATED</strong><small>HIGH_IMPACT approval remains mandatory</small></article>
        </div>
        <div className="truth-boundary">DEPLOY READY ≠ production authorization ≠ live verification. Main/CI başarısı tek başına production deploy kanıtı değildir.</div>
      </section>,
      target,
    );
  }

  if (screen === 'Monitoring') {
    return createPortal(
      <section className="truth-surface monitoring-truth" aria-label="Taso Monitoring">
        <header className="truth-header">
          <div><span>TASO RUNTIME</span><h2>Monitoring</h2><p>Yalnız Core tarafından gerçekten ölçülebilen ve döndürülen durumlar gösterilir. CPU, RAM, disk veya uptime verisi Core tarafından sağlanmadığı için uydurulmaz.</p></div>
          <div className="truth-actions"><small>{snapshot ? `SYNC ${formatTime(snapshot.generatedAt)}` : 'SYNCING'}</small><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : '↻ Yenile'}</button></div>
        </header>
        {error && <div className="truth-error">Core monitoring snapshot okunamadı: {error}</div>}
        <div className="truth-summary-grid">
          <article className={health.ok ? 'ready' : 'unavailable'}><span>CORE</span><strong>{health.ok ? 'ONLINE' : 'UNAVAILABLE'}</strong><small>{health.service ?? 'taso-core'} {health.version ? `v${health.version}` : ''}</small></article>
          <article className={health.gateway === 'configured' ? 'ready' : 'unavailable'}><span>GATEWAY</span><strong>{health.gateway?.toUpperCase() ?? 'UNKNOWN'}</strong><small>Browser → nginx → Core</small></article>
          <article className={health.state === 'persistent' ? 'ready' : 'guarded'}><span>STATE</span><strong>{health.state?.toUpperCase() ?? 'UNKNOWN'}</strong><small>Core persistence mode</small></article>
          <article><span>ACTIVE MISSIONS</span><strong>{executor.activeMissionIds?.length ?? 0}</strong><small>Executor snapshot</small></article>
        </div>
        <div className="truth-layout">
          <article className="truth-panel">
            <div className="truth-panel-head"><span>EXECUTION PLANE</span><small>verified readiness</small></div>
            <div className="truth-capability-grid three">
              <div className={executor.readyForRead ? 'ready' : 'unavailable'}><span>READ</span><strong>{boolLabel(executor.readyForRead)}</strong></div>
              <div className={executor.readyForWrite ? 'ready' : 'unavailable'}><span>WRITE</span><strong>{boolLabel(executor.readyForWrite)}</strong></div>
              <div className={executor.readyForDeploy ? 'ready' : 'unavailable'}><span>DEPLOY</span><strong>{boolLabel(executor.readyForDeploy)}</strong></div>
            </div>
            <div className="truth-facts">
              <div><span>GitHub broker</span><strong>{executor.github?.configured ? 'CONFIGURED' : 'MISSING'}</strong></div>
              <div><span>Coolify broker</span><strong>{executor.coolify?.configured ? 'CONFIGURED' : 'MISSING'}</strong></div>
              <div><span>AI runtime</span><strong>{executor.ai?.configured ? 'CONFIGURED' : 'MISSING'}</strong></div>
              <div><span>Planning deadline</span><strong>{executor.planningTimeoutMs ? `${Math.round(executor.planningTimeoutMs / 1000)}s` : '—'}</strong></div>
            </div>
          </article>
          <article className="truth-panel">
            <div className="truth-panel-head"><span>VOICE PLANE</span><small>runtime status</small></div>
            <div className="voice-truth-card">
              <span className={realtime?.ready ? 'truth-dot ready' : 'truth-dot'} />
              <div><strong>{realtime?.ready ? 'Realtime ready' : 'Browser fallback'}</strong><p>{realtime ? `${realtime.provider} · ${realtime.transport} · ${realtime.model}` : 'Realtime status doğrulanamadı.'}</p></div>
              <b>{realtime?.ready ? 'READY' : realtime?.fallback?.toUpperCase() ?? 'UNKNOWN'}</b>
            </div>
            <div className="truth-facts">
              <div><span>Realtime enabled</span><strong>{realtime?.enabled ? 'YES' : 'NO'}</strong></div>
              <div><span>Paid allowed</span><strong>{realtime?.paidAllowed ? 'YES' : 'NO'}</strong></div>
              <div><span>Configured</span><strong>{realtime?.configured ? 'YES' : 'NO'}</strong></div>
              <div><span>Ready agents</span><strong>{readyAgents}</strong></div>
            </div>
          </article>
        </div>
      </section>,
      target,
    );
  }

  return createPortal(
    <section className="truth-surface settings-truth" aria-label="Taso Settings">
      <header className="truth-header">
        <div><span>TASO POLICY</span><h2>Settings</h2><p>Bu yüzey yalnız gerçekten uygulanabilen veya doğrulanabilen ayarları gösterir. Persisted Core settings API olmadığı için sahte toggle üretilmez.</p></div>
        <div className="truth-actions"><small>{snapshot ? `SYNC ${formatTime(snapshot.generatedAt)}` : 'SYNCING'}</small><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : '↻ Yenile'}</button></div>
      </header>
      {error && <div className="truth-error">Settings runtime snapshot okunamadı: {error}</div>}
      <div className="settings-truth-grid">
        <article className="truth-panel">
          <div className="truth-panel-head"><span>CORE POLICY</span><small>read-only runtime</small></div>
          <div className="settings-policy-list">
            <div><span>State store</span><strong>{health.state?.toUpperCase() ?? 'UNKNOWN'}</strong><small>Runtime persistence mode</small></div>
            <div><span>Conversation AI</span><strong>{health.conversation?.configured ? 'CONFIGURED' : 'FALLBACK'}</strong><small>{health.conversation?.provider ?? 'deterministic'} {health.conversation?.model ?? ''}</small></div>
            <div><span>Private-code AI</span><strong>{executor.ai?.privateCode ? 'ALLOWED' : 'NOT VERIFIED'}</strong><small>Router policy reported by Core</small></div>
            <div><span>Production actions</span><strong>HUMAN GATED</strong><small>HIGH_IMPACT approval remains mandatory</small></div>
          </div>
        </article>
        <article className="truth-panel">
          <div className="truth-panel-head"><span>VOICE POLICY</span><small>runtime + local preference</small></div>
          <div className="settings-policy-list">
            <div><span>Realtime engine</span><strong>{realtime?.ready ? 'READY' : 'OFF / FALLBACK'}</strong><small>{realtime ? `${realtime.model} · ${realtime.voice}` : 'Status unavailable'}</small></div>
            <div><span>Paid realtime</span><strong>{realtime?.paidAllowed ? 'ALLOWED' : 'BLOCKED'}</strong><small>Server-side policy gate</small></div>
            <div><span>Browser TTS</span><strong>{voicePreference('taso-voice-replies', 'true') === 'false' ? 'OFF' : 'ON'}</strong><small>Local browser preference</small></div>
            <div><span>Signature rate / pitch / volume</span><strong>{voicePreference('taso-voice-rate', '0.92')} / {voicePreference('taso-voice-pitch', '0.86')} / {voicePreference('taso-voice-volume', '1')}</strong><small>Local browser preference</small></div>
          </div>
        </article>
      </div>
      <div className="truth-boundary">Core tarafında persisted settings endpoint’i eklenene kadar bu ekran backend ayarı varmış gibi davranmaz. Değiştirilebilir policy kontrolleri ayrı milestone’da gerçek persistence ile açılacak.</div>
    </section>,
    target,
  );
}
