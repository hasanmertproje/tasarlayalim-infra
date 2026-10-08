import { useEffect, useMemo, useState } from 'react';

type HealthState = {
  ok?: boolean;
  service?: string;
  version?: string;
  gateway?: string;
  state?: string;
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

type Provider = {
  id: string;
  displayName: string;
  enabled: boolean;
  costClass: 'free' | 'credit' | 'paid';
  strength: number;
  latency: number;
  allowedDataClasses: Array<'public' | 'private_code' | 'sensitive'>;
};

type IntegrationSnapshot = {
  health: HealthState;
  executor: ExecutorState;
  providers: Provider[];
  generatedAt: string;
};

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

function formatTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusClass(configured?: boolean) {
  return configured ? 'verified' : 'missing';
}

export default function IntegrationsCenter() {
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function api<T>(path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
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
    setLoading(true);
    try {
      const [health, executorPayload, providerPayload] = await Promise.all([
        api<HealthState>('/health'),
        api<{ executor: ExecutorState }>('/v1/executor'),
        api<{ providers: Provider[] }>('/v1/providers'),
      ]);
      setSnapshot({
        health,
        executor: executorPayload.executor ?? {},
        providers: providerPayload.providers ?? [],
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
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const enabledProviders = useMemo(() => snapshot?.providers.filter((provider) => provider.enabled) ?? [], [snapshot]);
  const privateProviders = useMemo(() => enabledProviders.filter((provider) => provider.allowedDataClasses.includes('private_code') || provider.allowedDataClasses.includes('sensitive')), [enabledProviders]);
  const executor = snapshot?.executor ?? {};
  const health = snapshot?.health ?? {};

  return (
    <section className="integrations-center" aria-label="Taso Integrations Center">
      <header className="integrations-hero">
        <div>
          <span>TASO TOOL PLANE</span>
          <h2>Integrations Center</h2>
          <p>Yalnız Core tarafından doğrulanabilen yapılandırmalar “configured” gösterilir. Secret değerleri hiçbir zaman tarayıcıya taşınmaz.</p>
        </div>
        <div className="integrations-hero-actions">
          <small>{snapshot ? `SYNC ${formatTime(snapshot.generatedAt)}` : 'SYNCING'}</small>
          <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '…' : '↻ Yenile'}</button>
        </div>
      </header>

      {error && <div className="integrations-error">Core integration snapshot okunamadı: {error}</div>}

      <div className="integration-summary-grid">
        <article className={`integration-summary-card ${statusClass(health.gateway === 'configured')}`}>
          <span>GATEWAY</span><strong>{health.gateway === 'configured' ? 'CONFIGURED' : 'MISSING'}</strong><small>Browser → nginx → Core</small>
        </article>
        <article className={`integration-summary-card ${statusClass(executor.github?.configured)}`}>
          <span>GITHUB BROKER</span><strong>{executor.github?.configured ? 'CONFIGURED' : 'MISSING'}</strong><small>Repository tool plane</small>
        </article>
        <article className={`integration-summary-card ${statusClass(executor.coolify?.configured)}`}>
          <span>COOLIFY BROKER</span><strong>{executor.coolify?.configured ? 'CONFIGURED' : 'MISSING'}</strong><small>Preview / production plane</small>
        </article>
        <article className={`integration-summary-card ${statusClass(executor.ai?.configured)}`}>
          <span>AI ROUTER</span><strong>{enabledProviders.length}</strong><small>{enabledProviders.length} enabled / {snapshot?.providers.length ?? 0} slots</small>
        </article>
      </div>

      <div className="integrations-layout">
        <article className="integration-panel capability-panel">
          <div className="integration-panel-head"><span>EXECUTION CAPABILITIES</span><small>runtime readiness</small></div>
          <div className="capability-grid">
            <div className={executor.readyForRead ? 'capability ready' : 'capability unavailable'}><span>READ</span><strong>{executor.readyForRead ? 'READY' : 'UNAVAILABLE'}</strong><small>Planner + GitHub read path</small></div>
            <div className={executor.readyForWrite ? 'capability ready' : 'capability unavailable'}><span>WRITE</span><strong>{executor.readyForWrite ? 'READY' : 'UNAVAILABLE'}</strong><small>Guarded repository write path</small></div>
            <div className={executor.readyForDeploy ? 'capability ready' : 'capability unavailable'}><span>DEPLOY</span><strong>{executor.readyForDeploy ? 'READY' : 'UNAVAILABLE'}</strong><small>Coolify broker availability</small></div>
          </div>
          <div className="integration-facts">
            <div><span>Core</span><strong>{health.service ?? 'taso-core'} {health.version ? `v${health.version}` : ''}</strong></div>
            <div><span>State</span><strong>{health.state?.toUpperCase() ?? 'UNKNOWN'}</strong></div>
            <div><span>Active missions</span><strong>{executor.activeMissionIds?.length ?? 0}</strong></div>
            <div><span>Planning deadline</span><strong>{executor.planningTimeoutMs ? `${Math.round(executor.planningTimeoutMs / 1000)}s` : '—'}</strong></div>
          </div>
        </article>

        <article className="integration-panel broker-panel">
          <div className="integration-panel-head"><span>BROKERS & BOUNDARIES</span><small>no secrets exposed</small></div>
          <div className="broker-list">
            <div className={`broker-row ${statusClass(executor.github?.configured)}`}><span className="broker-dot" /><div><strong>GitHub Tool Broker</strong><p>{executor.github?.configured ? 'Repository read/write configuration is present in Core runtime.' : 'GitHub runtime configuration is missing.'}</p></div><b>{executor.github?.configured ? 'CONFIGURED' : 'MISSING'}</b></div>
            <div className={`broker-row ${statusClass(executor.coolify?.configured)}`}><span className="broker-dot" /><div><strong>Coolify Tool Broker</strong><p>{executor.coolify?.configured ? `Deployment configuration present${executor.coolify.projects?.length ? ` • ${executor.coolify.projects.length} mapped workspace` : ''}.` : 'Coolify deployment configuration is missing.'}</p></div><b>{executor.coolify?.configured ? 'CONFIGURED' : 'MISSING'}</b></div>
            <div className={`broker-row ${statusClass(executor.ai?.configured)}`}><span className="broker-dot" /><div><strong>AI Provider Router</strong><p>{executor.ai?.configured ? `${enabledProviders.length} enabled provider slot • ${privateProviders.length} private-code eligible.` : 'No eligible AI runtime is configured.'}</p></div><b>{executor.ai?.configured ? 'CONFIGURED' : 'MISSING'}</b></div>
            <div className="broker-row external"><span className="broker-dot" /><div><strong>ntfy Notification Plane</strong><p>GitHub Actions secrets tarafından yönetilir. Core API secret veya bağlantı doğrulaması yayınlamadığı için UI bunu “connected” olarak iddia etmez.</p></div><b>CI-MANAGED</b></div>
          </div>
        </article>

        <article className="integration-panel provider-panel">
          <div className="integration-panel-head"><span>AI PROVIDER ROUTER</span><small>{snapshot?.providers.length ?? 0} declared slots</small></div>
          <div className="provider-matrix">
            {(snapshot?.providers ?? []).map((provider) => (
              <div className={`provider-matrix-row ${provider.enabled ? 'enabled' : 'disabled'}`} key={provider.id}>
                <span className="provider-matrix-dot" />
                <div className="provider-matrix-main"><strong>{provider.displayName}</strong><small>{provider.id}</small></div>
                <span className="provider-cost">{provider.costClass.toUpperCase()}</span>
                <span className="provider-data">{provider.allowedDataClasses.join(' • ')}</span>
                <span className="provider-score">S{provider.strength} / L{provider.latency}</span>
                <b>{provider.enabled ? 'ENABLED' : 'DISABLED'}</b>
              </div>
            ))}
            {snapshot && snapshot.providers.length === 0 && <div className="integration-empty">Provider slotu dönmedi.</div>}
          </div>
        </article>

        <article className="integration-panel trust-panel">
          <div className="integration-panel-head"><span>TRUST BOUNDARIES</span><small>operator rules</small></div>
          <div className="trust-list">
            <div><span>01</span><p>API key ve token değerleri UI’ya dönmez; yalnız yapılandırılmış/yapılandırılmamış bilgisi gösterilir.</p></div>
            <div><span>02</span><p>Provider veri sınıfı izinleri router tarafından uygulanır; private_code erişimi açıkça izin verilmeden varsayılmaz.</p></div>
            <div><span>03</span><p>DEPLOY readiness, production yetkisi değildir. HIGH_IMPACT insan onayı ve production policy ayrı kalır.</p></div>
            <div><span>04</span><p>External CI/ntfy durumu Core’dan doğrulanamıyorsa “healthy/connected” etiketi üretilmez.</p></div>
          </div>
        </article>
      </div>
    </section>
  );
}
