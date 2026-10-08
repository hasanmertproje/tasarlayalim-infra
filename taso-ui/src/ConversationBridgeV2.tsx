import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { browserVoiceRuntime } from './BrowserVoiceRuntime';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');
const DEFAULT_RATE = 0.92;
const DEFAULT_PITCH = 0.86;
const DEFAULT_VOLUME = 1;

type Project = { id: string; name: string; slug: string };
type RiskLevel = 'READ' | 'WRITE' | 'HIGH_IMPACT';
type ConversationMessage = { id: string; projectId: string; role: 'user' | 'assistant' | 'system'; content: string; intent?: string; createdAt: string };
type SuggestedMission = { objective: string; riskLevel: RiskLevel; dataClass: 'public' | 'private_code' | 'sensitive' };
type ConversationResponse = {
  decision: { intent: string; executionRequested: boolean; suggestedRisk?: RiskLevel; confidence: number };
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  suggestedMission?: SuggestedMission;
  conversation?: { configured?: boolean; provider?: string; model?: string };
};
type Mission = { id: string; status: string; objective: string };
type VoiceState = 'idle' | 'listening' | 'thinking' | 'starting' | 'speaking' | 'error' | 'unsupported';
type VoiceProfile = { voiceName: string; rate: number; pitch: number; volume: number };

function storedNumber(key: string, fallback: number) {
  const parsed = Number(localStorage.getItem(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function voiceScore(voice: SpeechSynthesisVoice) {
  let score = 0;
  if (/^tr-TR$/i.test(voice.lang)) score += 20;
  else if (/^tr/i.test(voice.lang)) score += 12;
  if (/microsoft|google|samsung/i.test(voice.name)) score += 5;
  if (/ahmet|tolga|mert|kerem|emre|kaan|hakan|cem|barış|baris|erkek|male/i.test(voice.name)) score += 8;
  if (voice.localService) score += 2;
  return score;
}

function chooseSignatureVoice(voices: SpeechSynthesisVoice[]) {
  return [...voices].sort((a, b) => voiceScore(b) - voiceScore(a))[0];
}

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
      // Keep HTTP detail.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export default function ConversationBridgeV2() {
  const [target, setTarget] = useState<Element | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastUser, setLastUser] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [decision, setDecision] = useState<ConversationResponse['decision']>();
  const [suggestedMission, setSuggestedMission] = useState<SuggestedMission>();
  const [createdMission, setCreatedMission] = useState<Mission>();
  const [provider, setProvider] = useState('AI');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceReplies, setVoiceReplies] = useState(() => localStorage.getItem('taso-voice-replies') !== 'false');
  const [liveSession, setLiveSession] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>(() => ({
    voiceName: localStorage.getItem('taso-voice-name') ?? '',
    rate: storedNumber('taso-voice-rate', DEFAULT_RATE),
    pitch: storedNumber('taso-voice-pitch', DEFAULT_PITCH),
    volume: storedNumber('taso-voice-volume', DEFAULT_VOLUME),
  }));

  const recognitionRef = useRef<any>(null);
  const liveSessionRef = useRef(false);
  const busyRef = useRef(false);
  const projectIdRef = useRef('');
  const voiceRepliesRef = useRef(voiceReplies);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const profileRef = useRef(voiceProfile);
  const restartTimerRef = useRef<number>();

  const activeProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);

  useEffect(() => { liveSessionRef.current = liveSession; }, [liveSession]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  useEffect(() => { voiceRepliesRef.current = voiceReplies; }, [voiceReplies]);
  useEffect(() => { voicesRef.current = voices; }, [voices]);
  useEffect(() => { profileRef.current = voiceProfile; }, [voiceProfile]);

  useEffect(() => {
    const sync = () => setTarget(document.querySelector('.taso-panel'));
    sync();
    const root = document.getElementById('root');
    const observer = root ? new MutationObserver(sync) : undefined;
    observer?.observe(root!, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    void request<{ projects: Project[] }>('/v1/projects').then((payload) => {
      setProjects(payload.projects ?? []);
      setProjectId((current) => current || payload.projects?.[0]?.id || '');
    }).catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const name = document.querySelector<HTMLButtonElement>('.project-tab.active')?.textContent?.trim();
      if (!name) return;
      const match = projects.find((project) => project.name === name);
      if (match && match.id !== projectIdRef.current) {
        stopVoiceSession();
        setProjectId(match.id);
        setLastUser('');
        setLastReply('');
        setDecision(undefined);
        setSuggestedMission(undefined);
        setCreatedMission(undefined);
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [projects]);

  useEffect(() => { localStorage.setItem('taso-voice-replies', String(voiceReplies)); }, [voiceReplies]);
  useEffect(() => {
    localStorage.setItem('taso-voice-name', voiceProfile.voiceName);
    localStorage.setItem('taso-voice-rate', String(voiceProfile.rate));
    localStorage.setItem('taso-voice-pitch', String(voiceProfile.pitch));
    localStorage.setItem('taso-voice-volume', String(voiceProfile.volume));
  }, [voiceProfile]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const turkish = window.speechSynthesis.getVoices().filter((voice) => /^tr(?:-|_)/i.test(voice.lang));
      setVoices(turkish);
      setVoiceProfile((current) => {
        if (current.voiceName && turkish.some((voice) => voice.name === current.voiceName)) return current;
        const signature = chooseSignatureVoice(turkish);
        return signature ? { ...current, voiceName: signature.name } : current;
      });
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (!target) return;
    const classes = ['conversation-listening', 'conversation-thinking', 'conversation-speaking', 'conversation-live', 'conversation-error'];
    classes.forEach((name) => target.classList.remove(name));
    if (voiceState === 'listening') target.classList.add('conversation-listening');
    if (voiceState === 'thinking' || voiceState === 'starting') target.classList.add('conversation-thinking');
    if (voiceState === 'speaking') target.classList.add('conversation-speaking');
    if (voiceState === 'error') target.classList.add('conversation-error');
    if (liveSession) target.classList.add('conversation-live');
    return () => classes.forEach((name) => target.classList.remove(name));
  }, [target, voiceState, liveSession]);

  useEffect(() => () => {
    liveSessionRef.current = false;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop?.();
    browserVoiceRuntime.cancel();
  }, []);

  function profile() {
    return { ...profileRef.current, lang: 'tr-TR' };
  }

  function scheduleListening(delay = 320) {
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      if (!liveSessionRef.current || busyRef.current || !projectIdRef.current || browserVoiceRuntime.isSpeaking()) return;
      beginRecognition();
    }, delay);
  }

  async function speak(text: string, resumeLive = liveSessionRef.current) {
    if (!voiceRepliesRef.current || !text.trim()) {
      setVoiceState('idle');
      if (resumeLive && liveSessionRef.current) scheduleListening();
      return true;
    }

    setError('');
    const result = await browserVoiceRuntime.speak(text, {
      profile: profile(),
      voices: voicesRef.current,
      onState: (state) => {
        if (state === 'starting') setVoiceState('starting');
        if (state === 'speaking') setVoiceState('speaking');
        if (state === 'idle') setVoiceState('idle');
        if (state === 'error') setVoiceState('error');
      },
    });

    if (!result.started) {
      setVoiceState('error');
      setError('Taso yanıtı hazır fakat cihaz TTS motoru sesi başlatmadı. Ses ayarlarından “Taso sesini test et” ile cihaz çıkışını doğrula.');
      return false;
    }

    setVoiceState('idle');
    if (resumeLive && liveSessionRef.current) scheduleListening(280);
    return true;
  }

  async function previewSignatureVoice() {
    if (busyRef.current || liveSessionRef.current) return;
    await browserVoiceRuntime.unlock();
    setError('');
    const ok = await speak('Merhaba. Ben Taso. Hazırım. Nasıl ilerliyoruz?', false);
    if (!ok) setSettingsOpen(true);
  }

  async function sendConversation(text: string, fromVoice = false) {
    const trimmed = text.trim();
    const activeProjectId = projectIdRef.current;
    if (!trimmed || !activeProjectId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setCreatedMission(undefined);
    setSuggestedMission(undefined);
    setLastUser(trimmed);
    setVoiceState('thinking');
    try {
      const payload = await request<ConversationResponse>('/v1/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProjectId, text: trimmed }),
      });
      setDecision(payload.decision);
      setSuggestedMission(payload.suggestedMission);
      setLastReply(payload.assistantMessage.content);
      if (payload.conversation?.model) setProvider(`${payload.conversation.provider ?? 'AI'} · ${payload.conversation.model}`);
      await speak(payload.assistantMessage.content, fromVoice || liveSessionRef.current);
    } catch (cause) {
      setVoiceState('error');
      setError((cause as Error).message);
      if (liveSessionRef.current) scheduleListening(700);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    await browserVoiceRuntime.unlock();
    setInput('');
    await sendConversation(text, false);
  }

  function beginRecognition() {
    if (busyRef.current || !projectIdRef.current || recognitionRef.current || browserVoiceRuntime.isSpeaking()) return;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      liveSessionRef.current = false;
      setLiveSession(false);
      setVoiceState('unsupported');
      setError('Bu tarayıcı canlı konuşma tanımayı desteklemiyor. Android Chrome veya uyumlu bir tarayıcı kullan.');
      return;
    }

    let finalReceived = false;
    const recognition = new Recognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceState('listening');
    recognition.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const part = event.results[index][0]?.transcript ?? '';
        if (event.results[index].isFinal) finalText += part;
        else interim += part;
      }
      setInput((finalText || interim).trim());
      if (finalText.trim()) {
        finalReceived = true;
        recognition.stop();
        setInput('');
        void sendConversation(finalText.trim(), true);
      }
    };
    recognition.onerror = (event: any) => {
      const code = event.error ?? 'unknown';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        stopVoiceSession();
        setVoiceState('error');
        setError('Mikrofon izni verilmedi. Canlı konuşma için mikrofon izni gerekli.');
        return;
      }
      if (code !== 'aborted' && code !== 'no-speech') setError(`Sesli giriş hatası: ${code}`);
      if (code !== 'aborted') setVoiceState(code === 'no-speech' ? 'idle' : 'error');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!finalReceived && liveSessionRef.current && !busyRef.current) {
        setVoiceState('idle');
        scheduleListening(300);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopVoiceSession() {
    liveSessionRef.current = false;
    setLiveSession(false);
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = undefined;
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    browserVoiceRuntime.cancel();
    setVoiceState('idle');
  }

  async function toggleVoiceSession() {
    if (liveSessionRef.current) {
      stopVoiceSession();
      return;
    }
    if (busyRef.current) return;
    await browserVoiceRuntime.unlock();
    setError('');
    liveSessionRef.current = true;
    setLiveSession(true);
    setVoiceState('idle');
    window.setTimeout(beginRecognition, 80);
  }

  function applySignaturePreset() {
    const signature = chooseSignatureVoice(voicesRef.current);
    setVoiceProfile({ voiceName: signature?.name ?? '', rate: DEFAULT_RATE, pitch: DEFAULT_PITCH, volume: DEFAULT_VOLUME });
  }

  async function createSuggestedMission() {
    if (!suggestedMission || !projectId || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = await request<{ mission: Mission }>('/v1/missions', {
        method: 'POST',
        body: JSON.stringify({ projectId, ...suggestedMission }),
      });
      setCreatedMission(payload.mission);
      setSuggestedMission(undefined);
      window.dispatchEvent(new CustomEvent('taso:mission-created', { detail: { mission: payload.mission, projectId } }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  const stateText = voiceState === 'listening' ? 'Dinliyor' : voiceState === 'thinking' ? 'Düşünüyor' : voiceState === 'starting' ? 'Ses başlatılıyor' : voiceState === 'speaking' ? 'Konuşuyor' : voiceState === 'error' ? 'Ses hatası' : 'Hazır';

  return createPortal(
    <section className={`conversation-bridge voice-${voiceState} ${liveSession ? 'live-session' : ''}`} aria-label="Taso konuşma">
      {(lastReply || busy) && (
        <div className="conversation-response" aria-live="polite">
          <div className="conversation-response-head"><span>TASO</span><small>{busy ? 'Düşünüyor…' : provider}</small></div>
          {lastUser && <small className="conversation-user-line">Sen: {lastUser}</small>}
          <p>{busy ? 'Yanıt hazırlanıyor…' : lastReply}</p>
        </div>
      )}

      {decision && <div className="conversation-decision"><span>{decision.intent}</span><small>{decision.executionRequested ? 'Mission önerisi · otomatik başlamaz' : 'Sohbet · mission yok'}</small></div>}
      {suggestedMission && <div className="conversation-mission-proposal"><div><span>MISSION ÖNERİSİ · {suggestedMission.riskLevel}</span><strong>{suggestedMission.objective}</strong><small>Sen onaylamadan repository/CI/deploy işlemi başlamaz.</small></div><button type="button" onClick={() => void createSuggestedMission()} disabled={busy}>Mission oluştur</button></div>}
      {createdMission && <div className="conversation-created">Mission oluşturuldu · {createdMission.status} · {createdMission.id}</div>}
      {error && <div className="conversation-error" role="alert">{error}</div>}

      <form className="conversation-composer" onSubmit={submit}>
        <button type="button" className={liveSession ? 'conversation-mic listening' : 'conversation-mic'} onClick={() => void toggleVoiceSession()} aria-label={liveSession ? 'Canlı konuşmayı kapat' : 'Taso ile canlı konuş'}>{liveSession ? '■' : '🎙'}</button>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`${activeProject?.name ?? 'Workspace'} için Taso'ya yaz veya konuş…`} disabled={busy || !projectId} />
        <button className="conversation-send" type="submit" disabled={busy || !projectId || !input.trim()} aria-label="Gönder">➤</button>
      </form>

      <div className="conversation-meta">
        <span>Chat ≠ Mission</span>
        <button type="button" className={liveSession ? 'active' : ''} onClick={() => void toggleVoiceSession()}>Canlı konuşma {liveSession ? 'Açık' : 'Kapalı'}</button>
        <button type="button" onClick={() => setVoiceReplies((value) => !value)}>TTS {voiceReplies ? 'Açık' : 'Kapalı'}</button>
        <button type="button" onClick={() => setSettingsOpen((value) => !value)}>Ses ayarları</button>
        <span>{stateText}</span>
      </div>

      {settingsOpen && (
        <div className="taso-voice-settings">
          <div className="taso-voice-settings-head"><div><span>TASO SIGNATURE</span><strong>İstanbul Türkçesi ses profili</strong></div><button type="button" onClick={applySignaturePreset}>Profili sıfırla</button></div>
          <label><span>Türkçe ses</span><select value={voiceProfile.voiceName} onChange={(event) => setVoiceProfile((current) => ({ ...current, voiceName: event.target.value }))} disabled={!voices.length}>{voices.length ? voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} · {voice.lang}</option>) : <option value="">Cihazda tr-TR ses bulunamadı</option>}</select></label>
          <label><span>Konuşma hızı <b>{voiceProfile.rate.toFixed(2)}</b></span><input type="range" min="0.72" max="1.16" step="0.01" value={voiceProfile.rate} onChange={(event) => setVoiceProfile((current) => ({ ...current, rate: Number(event.target.value) }))} /></label>
          <label><span>Ses tonu <b>{voiceProfile.pitch.toFixed(2)}</b></span><input type="range" min="0.65" max="1.15" step="0.01" value={voiceProfile.pitch} onChange={(event) => setVoiceProfile((current) => ({ ...current, pitch: Number(event.target.value) }))} /></label>
          <label><span>Ses seviyesi <b>{Math.round(voiceProfile.volume * 100)}%</b></span><input type="range" min="0.35" max="1" step="0.05" value={voiceProfile.volume} onChange={(event) => setVoiceProfile((current) => ({ ...current, volume: Number(event.target.value) }))} /></label>
          <div className="taso-voice-settings-actions"><button type="button" onClick={() => void previewSignatureVoice()} disabled={busy || liveSession}>Taso sesini test et</button><small>Test ancak tarayıcı TTS motoru gerçekten konuşmayı başlatırsa başarılı sayılır.</small></div>
        </div>
      )}
    </section>,
    target,
  );
}
