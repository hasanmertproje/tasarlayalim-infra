import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { browserVoiceRuntime } from './BrowserVoiceRuntime';
import { getRealtimeVoiceStatus, type RealtimeVoiceStatus } from './RealtimeVoiceClient';
import { useTasoNavigation } from './navigation';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type LocalVoice = { id: string; label: string; gender: 'male' | 'female' | 'neutral'; locale: string; license: string; character?: string };
type LocalVoiceStatus = {
  configured: boolean;
  ready: boolean;
  loading?: boolean;
  provider: string;
  engine?: string;
  model?: string;
  device?: string;
  steps?: number;
  license?: string;
  voices: LocalVoice[];
  error?: string;
};

type VoiceProfile = {
  voiceName: string;
  rate: number;
  pitch: number;
  volume: number;
  preset: 'signature' | 'operations' | 'natural' | 'night';
};

const PRESETS: Record<VoiceProfile['preset'], Omit<VoiceProfile, 'voiceName' | 'preset'>> = {
  signature: { rate: 0.88, pitch: 0.78, volume: 1 },
  operations: { rate: 0.84, pitch: 0.72, volume: 1 },
  natural: { rate: 0.96, pitch: 0.96, volume: 1 },
  night: { rate: 0.82, pitch: 0.76, volume: 0.72 },
};

function storedNumber(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function scoreVoice(voice: SpeechSynthesisVoice) {
  let score = 0;
  if (/^tr-TR$/i.test(voice.lang)) score += 20;
  else if (/^tr/i.test(voice.lang)) score += 10;
  if (/google|microsoft|samsung/i.test(voice.name)) score += 4;
  return score;
}

async function getLocalVoiceStatus() {
  const response = await fetch(`${API_URL}/v1/voice/local`, { headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`Local voice status HTTP ${response.status}`);
  const payload = await response.json() as { local: LocalVoiceStatus };
  return payload.local;
}

export default function VoiceIdentitySettings() {
  const [screen] = useTasoNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [realtime, setRealtime] = useState<RealtimeVoiceStatus>();
  const [localVoice, setLocalVoice] = useState<LocalVoiceStatus>();
  const [neuralVoiceId, setNeuralVoiceId] = useState(() => localStorage.getItem('taso-neural-voice-id') ?? '');
  const [testState, setTestState] = useState<'idle' | 'speaking' | 'ok' | 'error'>('idle');
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<VoiceProfile>(() => ({
    voiceName: localStorage.getItem('taso-voice-name') ?? '',
    rate: storedNumber('taso-voice-rate', 0.88),
    pitch: storedNumber('taso-voice-pitch', 0.78),
    volume: storedNumber('taso-voice-volume', 1),
    preset: (localStorage.getItem('taso-voice-preset') as VoiceProfile['preset']) || 'signature',
  }));

  useEffect(() => { setTarget(document.querySelector('.main-area')); }, []);

  useEffect(() => {
    if (screen !== 'Settings') return;
    void Promise.allSettled([getRealtimeVoiceStatus(), getLocalVoiceStatus()]).then(([realtimeResult, localResult]) => {
      setRealtime(realtimeResult.status === 'fulfilled' ? realtimeResult.value : undefined);
      const local = localResult.status === 'fulfilled' ? localResult.value : undefined;
      setLocalVoice(local);
      if (local?.voices?.length) {
        setNeuralVoiceId((current) => {
          if (current && local.voices.some((voice) => voice.id === current)) return current;
          return local.voices[0].id;
        });
      }
    });
  }, [screen]);

  useEffect(() => {
    if (screen !== 'Settings' || localVoice?.ready) return;
    const timer = window.setInterval(() => {
      void getLocalVoiceStatus().then((local) => {
        setLocalVoice(local);
        if (local.voices.length) {
          setNeuralVoiceId((current) => current && local.voices.some((voice) => voice.id === current) ? current : local.voices[0].id);
        }
      }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [screen, localVoice?.ready]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices().filter((voice) => /^tr(?:-|_)/i.test(voice.lang));
      const sorted = [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a));
      setVoices(sorted);
      setProfile((current) => {
        if (current.voiceName && sorted.some((voice) => voice.name === current.voiceName)) return current;
        return sorted[0] ? { ...current, voiceName: sorted[0].name } : current;
      });
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const selectedVoice = useMemo(() => voices.find((voice) => voice.name === profile.voiceName), [voices, profile.voiceName]);
  const selectedNeuralVoice = useMemo(() => localVoice?.voices.find((voice) => voice.id === neuralVoiceId), [localVoice, neuralVoiceId]);
  const localVoicesAvailable = Boolean(localVoice?.voices.length);
  const localReady = Boolean(localVoice?.ready && localVoicesAvailable);
  const localState = !localVoice?.configured
    ? 'OFF'
    : localReady
      ? 'READY'
      : localVoice.loading
        ? 'MODEL LOADING'
        : localVoice.error
          ? 'MODEL ERROR'
          : localVoicesAvailable
            ? 'MODEL NOT READY'
            : 'NO VOICES';
  const liveIsGemini = realtime?.provider === 'gemini-live';
  const engineLabel = realtime?.ready ? (liveIsGemini ? 'Gemini Live' : 'Realtime Neural') : localReady ? 'Taso Local Neural' : 'Cihaz TTS';
  const engineDetail = realtime?.ready
    ? `${realtime.model} · ${realtime.voice} · ${realtime.transport === 'websocket' ? 'WebSocket' : 'WebRTC'}${liveIsGemini ? ' · ephemeral token' : ''}`
    : localReady
      ? `${localVoice?.engine ?? 'local'} · ${selectedNeuralVoice?.label ?? 'voice'} · API ücreti yok`
      : localVoice?.configured
        ? localVoice.loading
          ? `${localVoice.model ?? 'FreyaTTS'} modeli yükleniyor · ${localVoice.device ?? 'cpu'}`
          : localVoice.error
            ? `Local neural model hatası: ${localVoice.error.slice(0, 180)}`
            : `${localVoice.voices.length} voice hazır; model henüz READY değil.`
        : 'Local neural servis bağlı değil; cihaz TTS yalnız manuel fallback olarak kullanılmalı.';

  function applyPreset(preset: VoiceProfile['preset']) {
    setProfile((current) => ({ ...current, ...PRESETS[preset], preset }));
    setSaved(false);
  }

  function save() {
    localStorage.setItem('taso-voice-name', profile.voiceName);
    localStorage.setItem('taso-voice-rate', String(profile.rate));
    localStorage.setItem('taso-voice-pitch', String(profile.pitch));
    localStorage.setItem('taso-voice-volume', String(profile.volume));
    localStorage.setItem('taso-voice-preset', profile.preset);
    localStorage.setItem('taso-voice-replies', 'true');
    if (neuralVoiceId) localStorage.setItem('taso-neural-voice-id', neuralVoiceId);
    setSaved(true);
    window.dispatchEvent(new CustomEvent('taso:voice-profile-saved', { detail: { ...profile, neuralVoiceId } }));
  }

  async function test() {
    setTestState('speaking');
    if (neuralVoiceId) localStorage.setItem('taso-neural-voice-id', neuralVoiceId);
    const result = await browserVoiceRuntime.speak('Taso hazır. Sistemler normal. Seni dinliyorum.', {
      profile: { voiceName: profile.voiceName, rate: profile.rate, pitch: profile.pitch, volume: profile.volume, lang: 'tr-TR' },
      voices,
    });
    setTestState(result.started && result.completed ? 'ok' : 'error');
  }

  if (screen !== 'Settings' || !target) return null;

  return createPortal(
    <section className="voice-identity-v2" aria-label="Taso Voice Identity">
      <header className="voice-identity-head">
        <div><span>TASO VOICE IDENTITY</span><h2>Ses ve karakter</h2><p>Canlı konuşmada hazırsa Gemini Live primary motordur. Local neural Freya ayrı ve manuel fallback olarak kalır; cihaz TTS canlı oturumda sessizce devreye girmez.</p></div>
        <div className={(realtime?.ready || localReady) ? 'voice-engine ready' : 'voice-engine fallback'}><small>AKTİF MOTOR</small><strong>{engineLabel}</strong><span>{engineDetail}</span></div>
      </header>

      <div className="voice-preset-grid" role="group" aria-label="Taso konuşma profilleri">
        <button className={profile.preset === 'signature' ? 'active' : ''} onClick={() => applyPreset('signature')}><strong>Taso Signature</strong><span>Tok · kontrollü · dengeli</span></button>
        <button className={profile.preset === 'operations' ? 'active' : ''} onClick={() => applyPreset('operations')}><strong>Operasyon</strong><span>Daha ağır · daha kontrollü</span></button>
        <button className={profile.preset === 'natural' ? 'active' : ''} onClick={() => applyPreset('natural')}><strong>Doğal</strong><span>Günlük İstanbul Türkçesi</span></button>
        <button className={profile.preset === 'night' ? 'active' : ''} onClick={() => applyPreset('night')}><strong>Gece</strong><span>Düşük seviye · sakin</span></button>
      </div>

      <div className="voice-settings-grid-v2">
        <article>
          <label><span>Taso local neural sesi</span><select value={neuralVoiceId} onChange={(event) => { setNeuralVoiceId(event.target.value); setSaved(false); }} disabled={!localVoicesAvailable}>{localVoicesAvailable ? localVoice!.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.gender === 'male' ? '♂' : voice.gender === 'female' ? '♀' : '◆'} {voice.label} · {voice.locale}</option>) : <option value="">Neural voice bulunamadı</option>}</select></label>
          <small className="voice-source-note">{selectedNeuralVoice ? `${selectedNeuralVoice.gender.toUpperCase()} · ${selectedNeuralVoice.license} · ${selectedNeuralVoice.character ?? 'signature'}` : 'Freya Voice Lab adayları gerçek dinleme ile etiketlenir.'}</small>
          <label><span>Cihaz TTS (manuel fallback)</span><select value={profile.voiceName} onChange={(event) => { setProfile((current) => ({ ...current, voiceName: event.target.value })); setSaved(false); }}>{voices.length ? voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>) : <option value="">tr-TR ses bulunamadı</option>}</select></label>
          <small className="voice-source-note">{selectedVoice ? `${selectedVoice.localService ? 'Yerel' : 'Ağ'} fallback · ${selectedVoice.lang}` : 'Gemini Live oturumunda otomatik devreye girmez.'}</small>
        </article>
        <article className="voice-sliders-v2">
          <label><span>Konuşma hızı <b>{profile.rate.toFixed(2)}</b></span><input type="range" min="0.72" max="1.12" step="0.01" value={profile.rate} onChange={(event) => { setProfile((current) => ({ ...current, rate: Number(event.target.value) })); setSaved(false); }} /></label>
          <label><span>Fallback ses tonu <b>{profile.pitch.toFixed(2)}</b></span><input type="range" min="0.65" max="1.10" step="0.01" value={profile.pitch} onChange={(event) => { setProfile((current) => ({ ...current, pitch: Number(event.target.value) })); setSaved(false); }} /></label>
          <label><span>Ses seviyesi <b>{Math.round(profile.volume * 100)}%</b></span><input type="range" min="0.30" max="1" step="0.05" value={profile.volume} onChange={(event) => { setProfile((current) => ({ ...current, volume: Number(event.target.value) })); setSaved(false); }} /></label>
        </article>
      </div>

      <div className="voice-engine-facts">
        <div><span>Live provider</span><strong>{realtime?.provider === 'gemini-live' ? 'GEMINI' : realtime?.provider === 'openai-realtime' ? 'OPENAI' : '—'}</strong></div>
        <div><span>Live auth</span><strong>{realtime?.ephemeralTokens ? 'EPHEMERAL' : realtime?.configured ? 'SERVER' : '—'}</strong></div>
        <div><span>Live ready</span><strong>{realtime?.ready ? 'YES' : 'NO'}</strong></div>
        <div><span>Live model</span><strong>{realtime?.model ?? '—'}</strong></div>
        <div><span>Local neural</span><strong>{localState}</strong></div>
        <div><span>Local voices</span><strong>{localVoice?.voices.length ?? 0}</strong></div>
        <div><span>Local model</span><strong>{localVoice?.model ?? localVoice?.engine ?? '—'}</strong></div>
        <div><span>Device</span><strong>{localVoice?.device?.toUpperCase() ?? '—'}</strong></div>
      </div>

      <footer className="voice-settings-actions-v2">
        <button type="button" onClick={() => void test()}>{testState === 'speaking' ? 'Konuşuyor…' : 'Local sesi test et'}</button>
        <button type="button" className="primary" onClick={save}>{saved ? 'Kaydedildi' : 'Profili kaydet'}</button>
        <span className={testState === 'error' ? 'error' : ''}>{testState === 'ok' ? 'Local neural ses testi tamamlandı.' : testState === 'error' ? 'Local neural ve manuel cihaz sesi başlatılamadı.' : localVoice?.error ? `Neural hata: ${localVoice.error.slice(0, 180)}` : realtime?.ready ? `${engineLabel} canlı konuşma düğmesinden test edilir.` : 'Local neural motor hazırsa bu düğme onu test eder.'}</span>
      </footer>
    </section>,
    target,
  );
}
