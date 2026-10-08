import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { getRealtimeVoiceStatus, type RealtimeVoiceStatus } from './RealtimeVoiceClient';
import { useTasoNavigation } from './navigation';

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
  if (/ahmet|tolga|mert|kerem|emre|kaan|hakan|cem|barış|baris|male|erkek/i.test(voice.name)) score += 6;
  return score;
}

export default function VoiceIdentitySettings() {
  const [screen] = useTasoNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [realtime, setRealtime] = useState<RealtimeVoiceStatus>();
  const [testState, setTestState] = useState<'idle' | 'speaking' | 'ok' | 'error'>('idle');
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<VoiceProfile>(() => ({
    voiceName: localStorage.getItem('taso-voice-name') ?? '',
    rate: storedNumber('taso-voice-rate', 0.88),
    pitch: storedNumber('taso-voice-pitch', 0.78),
    volume: storedNumber('taso-voice-volume', 1),
    preset: (localStorage.getItem('taso-voice-preset') as VoiceProfile['preset']) || 'signature',
  }));

  useEffect(() => {
    setTarget(document.querySelector('.main-area'));
  }, []);

  useEffect(() => {
    if (screen !== 'Settings') return;
    void getRealtimeVoiceStatus().then(setRealtime).catch(() => setRealtime(undefined));
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

  const engineLabel = realtime?.ready ? 'Realtime Neural' : 'Cihaz TTS';
  const engineDetail = realtime?.ready
    ? `${realtime.model} · ${realtime.voice} · WebRTC`
    : realtime
      ? `Fallback aktif · Realtime ${realtime.enabled ? 'açık' : 'kapalı'} · Paid gate ${realtime.paidAllowed ? 'açık' : 'kapalı'}`
      : 'Realtime durumu doğrulanamadı; cihaz TTS kullanılacak.';

  const selectedVoice = useMemo(() => voices.find((voice) => voice.name === profile.voiceName), [voices, profile.voiceName]);

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
    setSaved(true);
    window.dispatchEvent(new CustomEvent('taso:voice-profile-saved', { detail: profile }));
  }

  function test() {
    if (!('speechSynthesis' in window)) {
      setTestState('error');
      return;
    }
    setTestState('idle');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('Taso hazır. Sistemler normal. Seni dinliyorum.');
    utterance.lang = 'tr-TR';
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.volume = profile.volume;
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onstart = () => setTestState('speaking');
    utterance.onend = () => setTestState('ok');
    utterance.onerror = () => setTestState('error');
    window.speechSynthesis.resume();
    window.setTimeout(() => window.speechSynthesis.speak(utterance), 90);
  }

  if (screen !== 'Settings' || !target) return null;

  return createPortal(
    <section className="voice-identity-v2" aria-label="Taso Voice Identity">
      <header className="voice-identity-head">
        <div><span>TASO VOICE IDENTITY</span><h2>Ses ve karakter</h2><p>Cihaz TTS ile neural/realtime motor ayrıdır. Bu panel aktif motoru dürüstçe gösterir ve cihaz fallback profilini yönetir.</p></div>
        <div className={realtime?.ready ? 'voice-engine ready' : 'voice-engine fallback'}><small>AKTİF MOTOR</small><strong>{engineLabel}</strong><span>{engineDetail}</span></div>
      </header>

      <div className="voice-preset-grid" role="group" aria-label="Taso ses profilleri">
        <button className={profile.preset === 'signature' ? 'active' : ''} onClick={() => applyPreset('signature')}><strong>Taso Signature</strong><span>Tok · kontrollü · dengeli</span></button>
        <button className={profile.preset === 'operations' ? 'active' : ''} onClick={() => applyPreset('operations')}><strong>Operasyon</strong><span>Daha ağır · daha derin</span></button>
        <button className={profile.preset === 'natural' ? 'active' : ''} onClick={() => applyPreset('natural')}><strong>Doğal</strong><span>Günlük İstanbul Türkçesi</span></button>
        <button className={profile.preset === 'night' ? 'active' : ''} onClick={() => applyPreset('night')}><strong>Gece</strong><span>Düşük seviye · sakin</span></button>
      </div>

      <div className="voice-settings-grid-v2">
        <article>
          <label><span>Türkçe cihaz sesi</span><select value={profile.voiceName} onChange={(event) => { setProfile((current) => ({ ...current, voiceName: event.target.value })); setSaved(false); }}>{voices.length ? voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>) : <option value="">tr-TR ses bulunamadı</option>}</select></label>
          <small className="voice-source-note">{selectedVoice ? `${selectedVoice.localService ? 'Yerel' : 'Ağ'} ses · ${selectedVoice.lang}` : 'Cihazın Türkçe ses motoru kullanılır.'}</small>
        </article>
        <article className="voice-sliders-v2">
          <label><span>Konuşma hızı <b>{profile.rate.toFixed(2)}</b></span><input type="range" min="0.72" max="1.12" step="0.01" value={profile.rate} onChange={(event) => { setProfile((current) => ({ ...current, rate: Number(event.target.value) })); setSaved(false); }} /></label>
          <label><span>Ses tonu <b>{profile.pitch.toFixed(2)}</b></span><input type="range" min="0.65" max="1.10" step="0.01" value={profile.pitch} onChange={(event) => { setProfile((current) => ({ ...current, pitch: Number(event.target.value) })); setSaved(false); }} /></label>
          <label><span>Ses seviyesi <b>{Math.round(profile.volume * 100)}%</b></span><input type="range" min="0.30" max="1" step="0.05" value={profile.volume} onChange={(event) => { setProfile((current) => ({ ...current, volume: Number(event.target.value) })); setSaved(false); }} /></label>
        </article>
      </div>

      <div className="voice-engine-facts">
        <div><span>Realtime enabled</span><strong>{realtime?.enabled ? 'YES' : 'NO'}</strong></div>
        <div><span>Paid allowed</span><strong>{realtime?.paidAllowed ? 'YES' : 'NO'}</strong></div>
        <div><span>Provider configured</span><strong>{realtime?.configured ? 'YES' : 'NO'}</strong></div>
        <div><span>Realtime ready</span><strong>{realtime?.ready ? 'YES' : 'NO'}</strong></div>
      </div>

      <footer className="voice-settings-actions-v2">
        <button type="button" onClick={test}>{testState === 'speaking' ? 'Konuşuyor…' : 'Sesi test et'}</button>
        <button type="button" className="primary" onClick={save}>{saved ? 'Kaydedildi' : 'Profili kaydet'}</button>
        <span className={testState === 'error' ? 'error' : ''}>{testState === 'ok' ? 'Cihaz TTS testi duyuldu.' : testState === 'error' ? 'Cihaz TTS sesi başlatılamadı.' : 'Kaydedilen profil Command Center’a döndüğünde kullanılır.'}</span>
      </footer>
    </section>,
    target,
  );
}