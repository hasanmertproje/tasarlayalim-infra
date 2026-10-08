import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { browserVoiceRuntime } from './BrowserVoiceRuntime';
import { getRealtimeVoiceStatus, type RealtimeVoiceStatus } from './RealtimeVoiceClient';
import { useTasoNavigation } from './navigation';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type LocalVoice = { id: string; label: string; gender: 'male' | 'female' | 'neutral'; locale: string; license: string; character?: string };
type LocalVoiceStatus = { configured: boolean; ready: boolean; provider: string; engine?: string; voices: LocalVoice[]; error?: string };

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
  const localReady = Boolean(localVoice?.ready && localVoice.voices.length);
  const engineLabel = realtime?.ready ? 'Realtime Neural' : localReady ? 'Taso Local Neural' : 'Cihaz TTS';
  const engineDetail = realtime?.ready
    ? `${realtime.model} · ${realtime.voice} · WebRTC`
    : localReady
      ? `${localVoice?.engine ?? 'local'} · ${selectedNeuralVoice?.label ?? 'voice pack'} · API ücreti yok`
      : localVoice?.configured
        ? 'Local voice servisi bağlı fakat production-cleared voice pack hazır değil.'
        : 'Local neural servis bağlı değil; cihaz TTS son fallback olarak kullanılıyor.';

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
        <div><span>TASO VOICE IDENTITY</span><h2>Ses ve karakter</h2><p>Taso önce self-hosted neural voice pack kullanır. Realtime hazır değilse local neural motor; o da hazır değilse cihaz TTS yalnız son fallback olur.</p></div>
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
          <label><span>Taso neural sesi</span><select value={neuralVoiceId} onChange={(event) => { setNeuralVoiceId(event.target.value); setSaved(false); }} disabled={!localReady}>{localReady ? localVoice!.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.gender === 'male' ? '♂' : voice.gender === 'female' ? '♀' : '◆'} {voice.label} · {voice.locale}</option>) : <option value="">Production-cleared voice pack yok</option>}</select></label>
          <small className="voice-source-note">{selectedNeuralVoice ? `${selectedNeuralVoice.gender.toUpperCase()} · ${selectedNeuralVoice.license} · ${selectedNeuralVoice.character ?? 'signature'}` : 'Erkek/kadın seçimi yalnız gerçek, lisanslı voice pack üzerinden açılır.'}</small>
          <label><span>Cihaz TTS fallback</span><select value={profile.voiceName} onChange={(event) => { setProfile((current) => ({ ...current, voiceName: event.target.value })); setSaved(false); }}>{voices.length ? voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>) : <option value="">tr-TR ses bulunamadı</option>}</select></label>
          <small className="voice-source-note">{selectedVoice ? `${selectedVoice.localService ? 'Yerel' : 'Ağ'} fallback · ${selectedVoice.lang}` : 'Yalnız neural motor kullanılamazsa devreye girer.'}</small>
        </article>
        <article className="voice-sliders-v2">
          <label><span>Konuşma hızı <b>{profile.rate.toFixed(2)}</b></span><input type="range" min="0.72" max="1.12" step="0.01" value={profile.rate} onChange={(event) => { setProfile((current) => ({ ...current, rate: Number(event.target.value) })); setSaved(false); }} /></label>
          <label><span>Fallback ses tonu <b>{profile.pitch.toFixed(2)}</b></span><input type="range" min="0.65" max="1.10" step="0.01" value={profile.pitch} onChange={(event) => { setProfile((current) => ({ ...current, pitch: Number(event.target.value) })); setSaved(false); }} /></label>
          <label><span>Ses seviyesi <b>{Math.round(profile.volume * 100)}%</b></span><input type="range" min="0.30" max="1" step="0.05" value={profile.volume} onChange={(event) => { setProfile((current) => ({ ...current, volume: Number(event.target.value) })); setSaved(false); }} /></label>
        </article>
      </div>

      <div className="voice-engine-facts">
        <div><span>Local neural</span><strong>{localReady ? 'READY' : localVoice?.configured ? 'NO PACK' : 'OFF'}</strong></div>
        <div><span>Local voices</span><strong>{localVoice?.voices.length ?? 0}</strong></div>
        <div><span>Realtime paid</span><strong>{realtime?.paidAllowed ? 'ALLOWED' : 'BLOCKED'}</strong></div>
        <div><span>Realtime ready</span><strong>{realtime?.ready ? 'YES' : 'NO'}</strong></div>
      </div>

      <footer className="voice-settings-actions-v2">
        <button type="button" onClick={() => void test()}>{testState === 'speaking' ? 'Konuşuyor…' : 'Taso sesini test et'}</button>
        <button type="button" className="primary" onClick={save}>{saved ? 'Kaydedildi' : 'Profili kaydet'}</button>
        <span className={testState === 'error' ? 'error' : ''}>{testState === 'ok' ? `${engineLabel} testi tamamlandı.` : testState === 'error' ? 'Neural ve cihaz fallback sesi başlatılamadı.' : 'Local neural motor varsa test önce onu kullanır.'}</span>
      </footer>
    </section>,
    target,
  );
}
