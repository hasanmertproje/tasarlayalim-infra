import { useEffect, useRef, useState } from 'react';
import { GeminiLiveVoiceClient } from './GeminiLiveVoiceClient';
import {
  RealtimeVoiceClient,
  getRealtimeVoiceStatus,
  type RealtimeVoiceCallbacks,
  type RealtimeVoiceState,
  type RealtimeVoiceStatus,
  type VoiceMissionSuggestion,
} from './RealtimeVoiceClient';
import { navigateTaso } from './navigation';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type BrowserVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
type Project = { id: string; name: string };
type Mission = { id: string; status: string; objective: string };
type DisplayVoiceState = BrowserVoiceState | RealtimeVoiceState;
type LiveClient = Pick<RealtimeVoiceClient, 'connect' | 'interrupt' | 'setVolume' | 'stop'>;

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
      // Keep HTTP status detail.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function storedNumber(key: string, fallback: number) {
  const parsed = Number(localStorage.getItem(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function detectBrowserState(bridge: Element | null): BrowserVoiceState {
  if (!bridge) return 'idle';
  if (bridge.classList.contains('voice-listening')) return 'listening';
  if (bridge.classList.contains('voice-thinking')) return 'thinking';
  if (bridge.classList.contains('voice-speaking')) return 'speaking';
  if (bridge.classList.contains('voice-error')) return 'error';
  return 'idle';
}

function stateLabel(state: DisplayVoiceState) {
  if (state === 'connecting') return 'Bağlanıyorum';
  if (state === 'listening') return 'Seni dinliyorum';
  if (state === 'thinking') return 'Düşünüyorum';
  if (state === 'speaking') return 'Yanıtlıyorum';
  if (state === 'error') return 'Bağlantı hazır değil';
  return 'Hazırım';
}

function conversationMic() {
  return document.querySelector<HTMLButtonElement>('.conversation-bridge .conversation-mic');
}

export default function VoiceModeOverlay() {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserState, setBrowserState] = useState<BrowserVoiceState>('idle');
  const [browserHeard, setBrowserHeard] = useState('');
  const [browserReply, setBrowserReply] = useState('');

  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeVoiceStatus>();
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeVoiceState>('idle');
  const [realtimeHeard, setRealtimeHeard] = useState('');
  const [realtimeReply, setRealtimeReply] = useState('');
  const [realtimeError, setRealtimeError] = useState('');
  const [suggestedMission, setSuggestedMission] = useState<VoiceMissionSuggestion>();
  const [createdMission, setCreatedMission] = useState<Mission>();

  const clientRef = useRef<LiveClient | null>(null);
  const realtimeStatusRef = useRef<RealtimeVoiceStatus | undefined>(undefined);
  const realtimeActiveRef = useRef(false);
  const fallbackBypassRef = useRef(false);

  useEffect(() => { realtimeStatusRef.current = realtimeStatus; }, [realtimeStatus]);
  useEffect(() => { realtimeActiveRef.current = realtimeActive; }, [realtimeActive]);
  useEffect(() => () => clientRef.current?.stop(), []);

  function buildLiveClient(provider: RealtimeVoiceStatus['provider']): LiveClient {
    const callbacks: RealtimeVoiceCallbacks = {
      onState: setRealtimeState,
      onUserTranscript: (text) => setRealtimeHeard(text),
      onAssistantTranscript: (text) => setRealtimeReply(text),
      onMissionSuggestion: (suggestion) => {
        setSuggestedMission(suggestion);
        setCreatedMission(undefined);
      },
      onError: (message) => {
        setRealtimeError(message);
        setRealtimeState('error');
      },
      onConnected: () => {
        setRealtimeError('');
        setRealtimeState('listening');
      },
      onDisconnected: () => {
        if (!realtimeActiveRef.current) return;
        setRealtimeState('error');
        setRealtimeError((current) => current || 'Canlı ses oturumu kapandı. Tekrar bağlanabilirsin.');
      },
    };
    return provider === 'gemini-live'
      ? new GeminiLiveVoiceClient(callbacks)
      : new RealtimeVoiceClient(callbacks);
  }

  async function refreshRealtimeStatus() {
    try {
      const status = await getRealtimeVoiceStatus();
      realtimeStatusRef.current = status;
      setRealtimeStatus(status);
      return status;
    } catch {
      realtimeStatusRef.current = undefined;
      setRealtimeStatus(undefined);
      return undefined;
    }
  }

  useEffect(() => { void refreshRealtimeStatus(); }, []);

  useEffect(() => {
    const sync = () => {
      const bridge = document.querySelector('.conversation-bridge');
      const nextOpen = Boolean(bridge?.classList.contains('live-session'));
      setBrowserOpen(nextOpen);
      setBrowserState(detectBrowserState(bridge));

      const input = bridge?.querySelector<HTMLInputElement>('.conversation-composer input');
      const userLine = bridge?.querySelector('.conversation-user-line')?.textContent?.replace(/^Sen:\s*/i, '').trim() ?? '';
      const response = bridge?.querySelector('.conversation-response p')?.textContent?.trim() ?? '';
      setBrowserHeard(input?.value?.trim() || userLine);
      setBrowserReply(response === 'Yanıt hazırlanıyor…' ? '' : response);
    };

    sync();
    const root = document.getElementById('root');
    const observer = root ? new MutationObserver(sync) : undefined;
    observer?.observe(root!, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    const timer = window.setInterval(sync, 140);
    return () => {
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const open = realtimeActive || browserOpen;
  const state: DisplayVoiceState = realtimeActive ? realtimeState : browserState;
  const heard = realtimeActive ? realtimeHeard : browserHeard;
  const reply = realtimeActive ? realtimeReply : browserReply;

  useEffect(() => {
    document.body.classList.toggle('taso-voice-mode-open', open);
    return () => document.body.classList.remove('taso-voice-mode-open');
  }, [open]);

  async function resolveActiveProject() {
    const payload = await request<{ projects: Project[] }>('/v1/projects');
    const activeName = document.querySelector<HTMLButtonElement>('.project-tab.active')?.textContent?.trim();
    return payload.projects.find((project) => project.name === activeName) ?? payload.projects[0];
  }

  function navigateToCommandCenter() {
    if (document.querySelector('.conversation-bridge')) return true;
    navigateTaso('Command Center');
    return false;
  }

  function startBrowserFallback() {
    navigateToCommandCenter();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const mic = conversationMic();
      if (mic) {
        window.clearInterval(timer);
        fallbackBypassRef.current = true;
        mic.click();
        return;
      }
      if (attempts >= 40) window.clearInterval(timer);
    }, 50);
  }

  async function startRealtime() {
    if (realtimeActiveRef.current && realtimeState !== 'error') return;
    setRealtimeError('');
    setSuggestedMission(undefined);
    setCreatedMission(undefined);
    setRealtimeHeard('');
    setRealtimeReply('');
    realtimeActiveRef.current = true;
    setRealtimeActive(true);
    setRealtimeState('connecting');

    try {
      const [status, project] = await Promise.all([refreshRealtimeStatus(), resolveActiveProject()]);
      if (!status?.ready) throw new Error('Canlı neural voice hazır değil. Otomatik cihaz TTS fallback kapalı.');
      if (!project) throw new Error('Aktif workspace bulunamadı.');
      clientRef.current?.stop();
      const client = buildLiveClient(status.provider);
      clientRef.current = client;
      await client.connect({
        projectId: project.id,
        workspaceName: project.name,
        speed: storedNumber('taso-voice-rate', 0.95),
        volume: storedNumber('taso-voice-volume', 1),
      });
    } catch (error) {
      setRealtimeError((error as Error).message);
      setRealtimeState('error');
      // Keep the voice screen open. No silent Samsung/browser TTS fallback.
    }
  }

  function endRealtime() {
    realtimeActiveRef.current = false;
    setRealtimeActive(false);
    clientRef.current?.stop();
    clientRef.current = null;
    setRealtimeState('idle');
    setSuggestedMission(undefined);
    setRealtimeError('');
  }

  useEffect(() => {
    const interceptVoiceButton = (event: Event) => {
      const origin = event.target as Element | null;
      const mobileMic = origin?.closest?.('.mobile-nav .mobile-taso');
      const directMic = origin?.closest?.('.conversation-bridge .conversation-mic');
      if (!mobileMic && !directMic) return;

      if (fallbackBypassRef.current) {
        fallbackBypassRef.current = false;
        return;
      }

      if (realtimeStatusRef.current?.ready) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        navigateToCommandCenter();
        if (realtimeActiveRef.current) endRealtime();
        else void startRealtime();
        return;
      }

      if (mobileMic && !document.querySelector('.conversation-bridge')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        startBrowserFallback();
      }
    };

    window.addEventListener('click', interceptVoiceButton, true);
    return () => window.removeEventListener('click', interceptVoiceButton, true);
  }, [realtimeState]);

  function endSession() {
    if (realtimeActiveRef.current) { endRealtime(); return; }
    if (document.querySelector('.conversation-bridge.live-session')) conversationMic()?.click();
  }

  function interrupt() {
    if (realtimeActiveRef.current) { clientRef.current?.interrupt(); return; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const mic = conversationMic();
    if (!mic) return;
    if (document.querySelector('.conversation-bridge.live-session')) {
      mic.click();
      window.setTimeout(() => mic.click(), 110);
    } else mic.click();
  }

  function openVoiceSettings() {
    endSession();
    navigateToCommandCenter();
    window.setTimeout(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.conversation-meta button')].find((item) => item.textContent?.includes('Ses ayarları'));
      button?.click();
    }, 180);
  }

  async function createSuggestedMission() {
    if (!suggestedMission) return;
    try {
      const payload = await request<{ mission: Mission }>('/v1/missions', { method: 'POST', body: JSON.stringify(suggestedMission) });
      setCreatedMission(payload.mission);
      setSuggestedMission(undefined);
      window.dispatchEvent(new CustomEvent('taso:mission-created', { detail: { mission: payload.mission, projectId: suggestedMission.projectId } }));
    } catch (error) { setRealtimeError((error as Error).message); }
  }

  if (!open) return null;

  const engineLabel = realtimeActive
    ? realtimeStatus?.provider === 'gemini-live'
      ? `GEMINI LIVE · ${realtimeStatus.model}`
      : `NEURAL · ${realtimeStatus?.model ?? 'REALTIME'}`
    : 'LOCAL / CİHAZ';
  const interruptDisabled = realtimeActive ? state !== 'speaking' : state === 'thinking' || state === 'connecting';

  return (
    <section className={`taso-voice-mode state-${state} ${realtimeActive ? 'engine-realtime' : 'engine-browser'}`} aria-label="Taso canlı konuşma modu">
      <div className="taso-voice-mode-ambient ambient-a" /><div className="taso-voice-mode-ambient ambient-b" />
      <header className="taso-voice-mode-header"><div><span>TASO LIVE · {engineLabel}</span><strong>Canlı konuşma</strong></div><button type="button" onClick={openVoiceSettings}>Ses ayarları</button></header>
      <main className="taso-voice-mode-main">
        <div className="taso-voice-mode-orb" aria-hidden="true"><i /><i /><i /><div className="taso-voice-mode-core">T</div></div>
        <div className="taso-voice-mode-state"><span>{stateLabel(state)}</span><div className="taso-voice-wave"><i/><i/><i/><i/><i/><i/><i/></div></div>
        <div className="taso-voice-mode-transcript" aria-live="polite">
          {heard && <div className="heard"><span>SEN</span><p>{heard}</p></div>}
          {reply && <div className="reply"><span>TASO</span><p>{reply}</p></div>}
          {!heard && !reply && <p className="voice-mode-hint">{state === 'error' ? 'Bağlantı kapanmadı; hata burada tutuluyor. Tekrar bağlanmayı deneyebilirsin.' : 'Konuşmaya başlayabilirsin. Taso seni dinliyor.'}</p>}
        </div>
        {realtimeActive && suggestedMission && <div className="voice-mission-proposal"><div><span>MISSION ÖNERİSİ · {suggestedMission.riskLevel}</span><strong>{suggestedMission.objective}</strong><small>Sohbet bunu otomatik çalıştırmaz. Yalnız açık görev talebi ve bu onay ile mission oluşur.</small></div><button type="button" onClick={() => void createSuggestedMission()}>Mission oluştur</button></div>}
        {createdMission && <div className="voice-mission-created">Mission oluşturuldu · {createdMission.status} · {createdMission.id}</div>}
        {realtimeError && <div className="voice-realtime-error">{realtimeError}</div>}
      </main>
      <footer className="taso-voice-mode-controls"><button type="button" className="voice-interrupt" onClick={state === 'error' ? () => void startRealtime() : interrupt} disabled={state !== 'error' && interruptDisabled}><span>{state === 'error' ? 'Tekrar bağlan' : state === 'speaking' ? 'Sözünü kes' : realtimeActive ? 'Dinlemede' : 'Konuş'}</span></button><button type="button" className="voice-end" onClick={endSession} aria-label="Canlı konuşmayı bitir">■</button><div className="voice-mode-footnote">Sohbet · bilgi · plan ≠ Mission · Yalnız açık yürütme isteği görev olur</div></footer>
    </section>
  );
}
