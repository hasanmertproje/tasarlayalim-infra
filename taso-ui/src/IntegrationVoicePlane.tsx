import { useEffect, useState } from 'react';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type Realtime = {
  provider?: string;
  transport?: string;
  enabled?: boolean;
  configured?: boolean;
  ready?: boolean;
  model?: string;
  voice?: string;
  fallback?: string;
  paidAllowed?: boolean;
  latencyMs?: number;
  bargeIn?: boolean;
};
type LocalVoice = { ready?: boolean; provider?: string; model?: string; voice?: string };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function status(value: boolean | undefined, configured?: boolean) {
  if (value) return 'READY';
  if (configured === false) return 'MISSING';
  return 'UNAVAILABLE';
}

export default function IntegrationVoicePlane() {
  const [realtime, setRealtime] = useState<Realtime>();
  const [local, setLocal] = useState<LocalVoice>();
  const [error, setError] = useState('');

  async function refresh() {
    const [rt, lv] = await Promise.all([
      api<{ realtime: Realtime }>('/v1/voice/realtime').catch(() => undefined),
      api<LocalVoice>('/v1/voice/local').catch(() => undefined),
    ]);
    setRealtime(rt?.realtime);
    setLocal(lv);
    setError(!rt && !lv ? 'Voice runtime endpoints did not report a status.' : '');
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="nova-integration-voice" aria-label="Voice integrations">
      <header><div><span>VOICE & NOTIFICATION PLANE</span><h3>Realtime integrations</h3></div><button type="button" onClick={() => void refresh()}>↻</button></header>
      {error && <div className="nova-integration-error">{error}</div>}
      <div className="nova-integration-voice-grid">
        <article className={realtime?.provider === 'gemini-live' && realtime.ready ? 'ready' : ''}>
          <span>GEMINI LIVE</span><strong>{realtime?.provider === 'gemini-live' ? status(realtime.ready, realtime.configured) : 'NOT ACTIVE'}</strong>
          <small>{realtime?.provider === 'gemini-live' ? `${realtime.model ?? 'model not reported'} · ${realtime.voice ?? 'voice not reported'}` : 'Provider is not the active realtime route.'}</small>
          <dl><div><dt>Transport</dt><dd>{realtime?.transport ?? 'not reported'}</dd></div><div><dt>Latency</dt><dd>{realtime?.latencyMs === undefined ? 'not reported' : `${realtime.latencyMs} ms`}</dd></div><div><dt>Barge-in</dt><dd>{realtime?.bargeIn === undefined ? 'not reported' : realtime.bargeIn ? 'enabled' : 'disabled'}</dd></div></dl>
        </article>
        <article className={local?.ready ? 'ready' : ''}>
          <span>LOCAL NEURAL VOICE</span><strong>{status(local?.ready)}</strong>
          <small>{local ? `${local.provider ?? 'local provider'} · ${local.voice ?? local.model ?? 'voice not reported'}` : 'Local neural runtime did not report status.'}</small>
          <dl><div><dt>Fallback</dt><dd>manual only</dd></div><div><dt>Auto device TTS</dt><dd>blocked</dd></div></dl>
        </article>
        <article>
          <span>DEVICE TTS</span><strong>MANUAL FALLBACK</strong>
          <small>Local browser preference; never presented as Gemini/Neural readiness.</small>
        </article>
        <article>
          <span>NTFY</span><strong>NOT REPORTED BY CORE</strong>
          <small>CI-managed integration. UI does not claim connected/healthy without a runtime endpoint.</small>
        </article>
      </div>
    </section>
  );
}
