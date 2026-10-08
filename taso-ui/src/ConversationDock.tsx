import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type Project = { id: string; name: string; slug: string };
type ConversationMessage = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: string;
  createdAt: string;
};
type SuggestedMission = {
  objective: string;
  riskLevel: 'READ' | 'WRITE' | 'HIGH_IMPACT';
  dataClass: 'public' | 'private_code' | 'sensitive';
};
type ConversationResponse = {
  decision: { intent: string; executionRequested: boolean; suggestedRisk?: string; confidence: number };
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  suggestedMission?: SuggestedMission;
  conversation?: { configured?: boolean; provider?: string; model?: string };
};
type Mission = { id: string; status: string; objective: string; riskLevel?: string };
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'unsupported' | 'error';

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

function voiceStateLabel(state: VoiceState) {
  const labels: Record<VoiceState, string> = {
    idle: 'Hazır',
    listening: 'Dinliyor',
    thinking: 'Düşünüyor',
    speaking: 'Konuşuyor',
    unsupported: 'Desteklenmiyor',
    error: 'Ses hatası',
  };
  return labels[state];
}

export default function ConversationDock() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('AI');
  const [decision, setDecision] = useState<ConversationResponse['decision']>();
  const [suggestedMission, setSuggestedMission] = useState<SuggestedMission>();
  const [createdMission, setCreatedMission] = useState<Mission>();
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceReplies, setVoiceReplies] = useState(() => localStorage.getItem('taso-voice-replies') !== 'false');
  const [handsFree, setHandsFree] = useState(() => localStorage.getItem('taso-hands-free') === 'true');
  const recognitionRef = useRef<any>(null);
  const shouldRestartListeningRef = useRef(false);
  const speakingRef = useRef(false);

  const activeProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);
  const speechRecognitionSupported = typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const speechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  function publishVoiceState(next: VoiceState, transcript = interimTranscript) {
    setVoiceState(next);
    window.dispatchEvent(new CustomEvent('taso:conversation-state', { detail: { state: next, projectId, transcript } }));
  }

  async function loadProjects() {
    const payload = await request<{ projects: Project[] }>('/v1/projects');
    setProjects(payload.projects ?? []);
    setProjectId((current) => current || payload.projects?.[0]?.id || '');
  }

  async function loadMessages(id: string) {
    if (!id) return setMessages([]);
    const payload = await request<{ messages: ConversationMessage[] }>(`/v1/conversations?projectId=${encodeURIComponent(id)}`);
    setMessages(payload.messages ?? []);
  }

  useEffect(() => {
    void loadProjects().catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const activeTab = document.querySelector<HTMLButtonElement>('.project-tab.active');
      const name = activeTab?.textContent?.trim();
      if (!name) return;
      const match = projects.find((project) => project.name === name);
      if (match && match.id !== projectId) setProjectId(match.id);
    }, 350);
    return () => window.clearInterval(timer);
  }, [projects, projectId]);

  useEffect(() => {
    const node = rootRef.current;
    const target = document.querySelector('.taso-panel');
    if (!node || !target || target.contains(node)) return;
    target.appendChild(node);
  });

  useEffect(() => {
    localStorage.setItem('taso-voice-replies', String(voiceReplies));
  }, [voiceReplies]);

  useEffect(() => {
    localStorage.setItem('taso-hands-free', String(handsFree));
  }, [handsFree]);

  useEffect(() => {
    if (!projectId) return;
    setDecision(undefined);
    setSuggestedMission(undefined);
    setCreatedMission(undefined);
    setInterimTranscript('');
    shouldRestartListeningRef.current = false;
    recognitionRef.current?.stop?.();
    publishVoiceState('idle', '');
    void loadMessages(projectId).catch((cause) => setError((cause as Error).message));
  }, [projectId]);

  useEffect(() => () => {
    shouldRestartListeningRef.current = false;
    recognitionRef.current?.stop?.();
    if (speechSynthesisSupported) window.speechSynthesis.cancel();
  }, [speechSynthesisSupported]);

  function speakAssistant(text: string) {
    if (!voiceReplies || !speechSynthesisSupported || !text.trim()) {
      publishVoiceState('idle', '');
      if (handsFree && shouldRestartListeningRef.current) window.setTimeout(() => startVoice(true), 250);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      speakingRef.current = true;
      publishVoiceState('speaking', '');
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      publishVoiceState('error', '');
    };
    utterance.onend = () => {
      speakingRef.current = false;
      publishVoiceState('idle', '');
      if (handsFree && shouldRestartListeningRef.current) window.setTimeout(() => startVoice(true), 300);
    };
    window.speechSynthesis.speak(utterance);
  }

  async function sendConversation(text: string, source: 'text' | 'voice' = 'text') {
    const trimmed = text.trim();
    if (!trimmed || !projectId || busy) return;
    setBusy(true);
    setError('');
    setSuggestedMission(undefined);
    setCreatedMission(undefined);
    publishVoiceState('thinking', trimmed);
    try {
      const payload = await request<ConversationResponse>('/v1/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({ projectId, text: trimmed, source }),
      });
      setMessages((current) => [...current, payload.userMessage, payload.assistantMessage]);
      setDecision(payload.decision);
      setSuggestedMission(payload.suggestedMission);
      setInterimTranscript('');
      if (payload.conversation?.model) setProvider(`${payload.conversation.provider ?? 'AI'} · ${payload.conversation.model}`);
      if (voiceReplies) speakAssistant(payload.assistantMessage.content);
      else publishVoiceState('idle', '');
      window.dispatchEvent(new CustomEvent('taso:conversation-response', {
        detail: { projectId, decision: payload.decision, assistantMessage: payload.assistantMessage, suggestedMission: payload.suggestedMission },
      }));
    } catch (cause) {
      setError((cause as Error).message);
      publishVoiceState('error', '');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !projectId || busy) return;
    setInput('');
    await sendConversation(text, 'text');
  }

  function startVoice(restart = false) {
    if (!speechRecognitionSupported) {
      publishVoiceState('unsupported', '');
      setError('Bu tarayıcı konuşma tanımayı desteklemiyor. Android Chrome veya uyumlu bir tarayıcı kullan.');
      return;
    }
    if (!restart && (voiceState === 'listening' || voiceState === 'speaking')) {
      shouldRestartListeningRef.current = false;
      recognitionRef.current?.stop?.();
      if (speechSynthesisSupported) window.speechSynthesis.cancel();
      speakingRef.current = false;
      setInterimTranscript('');
      publishVoiceState('idle', '');
      return;
    }
    if (speakingRef.current && speechSynthesisSupported) window.speechSynthesis.cancel();
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      shouldRestartListeningRef.current = handsFree;
      setInterimTranscript('');
      publishVoiceState('listening', '');
    };
    recognition.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const part = event.results[index][0]?.transcript ?? '';
        if (event.results[index].isFinal) finalText += part;
        else interim += part;
      }
      const liveText = (finalText || interim).trim();
      setInterimTranscript(liveText);
      publishVoiceState('listening', liveText);
      if (finalText.trim()) {
        recognition.stop();
        void sendConversation(finalText.trim(), 'voice');
      }
    };
    recognition.onerror = (event: any) => {
      const code = event.error ?? 'unknown';
      if (code === 'aborted' || code === 'no-speech') {
        publishVoiceState('idle', '');
        return;
      }
      shouldRestartListeningRef.current = false;
      setError(`Sesli giriş hatası: ${code}`);
      publishVoiceState('error', '');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!busy && !speakingRef.current) publishVoiceState('idle', '');
    };
    recognitionRef.current = recognition;
    recognition.start();
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

  return (
    <div ref={rootRef} className={`conversation-v2 embedded voice-${voiceState}`}>
      <section className="conversation-v2-panel">
        <header>
          <div><span>CONVERSATION</span><strong>{activeProject?.name ?? 'Workspace'}</strong></div>
          <small>{provider}</small>
        </header>
        <div className={`conversation-v2-voice-state state-${voiceState}`} aria-live="polite">
          <div className="voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div><strong>{voiceStateLabel(voiceState)}</strong><small>{interimTranscript || (voiceState === 'listening' ? 'Konuşabilirsin…' : voiceState === 'thinking' ? 'Taso yanıt hazırlıyor…' : voiceState === 'speaking' ? 'Taso yanıt veriyor…' : 'Taso ile yaz veya konuş')}</small></div>
          <button type="button" className={voiceState === 'listening' || voiceState === 'speaking' ? 'voice-session-button active' : 'voice-session-button'} onClick={() => startVoice(false)} disabled={busy && voiceState !== 'speaking'} aria-label="Taso ile konuş">
            {voiceState === 'listening' || voiceState === 'speaking' ? '■' : '🎙'}
          </button>
        </div>
        <div className="conversation-v2-voice-options">
          <button type="button" className={voiceReplies ? 'active' : ''} onClick={() => setVoiceReplies((value) => !value)}>Sesli yanıt {voiceReplies ? 'Açık' : 'Kapalı'}</button>
          <button type="button" className={handsFree ? 'active' : ''} onClick={() => setHandsFree((value) => !value)}>Hands-free {handsFree ? 'Açık' : 'Kapalı'}</button>
          <span>Chat ≠ Mission</span>
        </div>
        <div className="conversation-v2-messages">
          {!messages.length && <div className="conversation-v2-empty"><strong>Taso hazır.</strong><span>Normal sohbet mission oluşturmaz. Yürütme gerektiren bir istek algılanırsa önce açık bir mission önerisi gösterilir.</span></div>}
          {messages.map((message) => <article key={message.id} className={`conversation-v2-message ${message.role}`}>
            <small>{message.role === 'user' ? 'SEN' : message.role === 'assistant' ? 'TASO' : 'SYSTEM'} {message.intent ? `· ${message.intent}` : ''}</small>
            <p>{message.content}</p>
          </article>)}
        </div>
        {decision && <div className="conversation-v2-decision"><span>{decision.intent}</span><small>{decision.executionRequested ? 'Yürütme isteği algılandı' : 'Sohbet · mission yok'} · {Math.round(decision.confidence * 100)}%</small></div>}
        {suggestedMission && <div className="conversation-v2-mission-card">
          <div><span>MISSION ÖNERİSİ</span><strong>{suggestedMission.riskLevel}</strong><p>{suggestedMission.objective}</p></div>
          <button type="button" onClick={() => void createSuggestedMission()} disabled={busy}>{busy ? '…' : 'Mission oluştur'}</button>
          <small>Bu butona basılmadan repository, branch, CI veya deploy işlemi başlamaz.</small>
        </div>}
        {createdMission && <div className="conversation-v2-created"><strong>Mission oluşturuldu</strong><span>{createdMission.status} · {createdMission.id}</span>{createdMission.status === 'waiting_approval' && <small>HIGH IMPACT: insan onayı bekleniyor.</small>}</div>}
        {error && <div className="conversation-v2-error">{error}</div>}
        <form onSubmit={submit}>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`${activeProject?.name ?? 'Workspace'} için Taso'ya yaz…`} disabled={busy || !projectId} />
          <button type="submit" disabled={busy || !projectId || !input.trim()}>{busy ? '…' : 'Gönder'}</button>
        </form>
        <footer>Tek konuşma yüzeyi · Project isolated · Explicit execution boundary · V2 Preview</footer>
      </section>
    </div>
  );
}
