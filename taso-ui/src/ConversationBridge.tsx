import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

type Project = { id: string; name: string; slug: string };
type RiskLevel = 'READ' | 'WRITE' | 'HIGH_IMPACT';
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
  riskLevel: RiskLevel;
  dataClass: 'public' | 'private_code' | 'sensitive';
};
type ConversationResponse = {
  decision: { intent: string; executionRequested: boolean; suggestedRisk?: RiskLevel; confidence: number };
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  suggestedMission?: SuggestedMission;
  conversation?: { configured?: boolean; provider?: string; model?: string };
};
type Mission = { id: string; status: string; objective: string };
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'unsupported';

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
      // Preserve HTTP detail.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export default function ConversationBridge() {
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
  const recognitionRef = useRef<any>(null);

  const activeProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);

  useEffect(() => {
    const syncTarget = () => setTarget(document.querySelector('.taso-panel'));
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.getElementById('root')!, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void request<{ projects: Project[] }>('/v1/projects').then((payload) => {
      setProjects(payload.projects ?? []);
      setProjectId((current) => current || payload.projects?.[0]?.id || '');
    }).catch((cause) => setError((cause as Error).message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const activeTab = document.querySelector<HTMLButtonElement>('.project-tab.active');
      const name = activeTab?.textContent?.trim();
      if (!name) return;
      const match = projects.find((project) => project.name === name);
      if (match && match.id !== projectId) {
        setProjectId(match.id);
        setLastUser('');
        setLastReply('');
        setDecision(undefined);
        setSuggestedMission(undefined);
        setCreatedMission(undefined);
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [projects, projectId]);

  useEffect(() => {
    localStorage.setItem('taso-voice-replies', String(voiceReplies));
  }, [voiceReplies]);

  useEffect(() => {
    if (!target) return;
    target.classList.toggle('conversation-listening', voiceState === 'listening');
    target.classList.toggle('conversation-thinking', voiceState === 'thinking');
    target.classList.toggle('conversation-speaking', voiceState === 'speaking');
    return () => {
      target.classList.remove('conversation-listening', 'conversation-thinking', 'conversation-speaking');
    };
  }, [target, voiceState]);

  useEffect(() => {
    const interceptMobileTaso = (event: Event) => {
      const origin = event.target as Element | null;
      const button = origin?.closest?.('.mobile-nav .mobile-taso');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      startVoice();
    };
    document.addEventListener('click', interceptMobileTaso, true);
    return () => document.removeEventListener('click', interceptMobileTaso, true);
  }, [voiceState, busy, projectId]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  function speak(text: string) {
    if (!voiceReplies || !('speechSynthesis' in window) || !text.trim()) {
      setVoiceState('idle');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = 1;
    utterance.onstart = () => setVoiceState('speaking');
    utterance.onend = () => setVoiceState('idle');
    utterance.onerror = () => setVoiceState('error');
    window.speechSynthesis.speak(utterance);
  }

  async function sendConversation(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !projectId || busy) return;
    setBusy(true);
    setError('');
    setCreatedMission(undefined);
    setSuggestedMission(undefined);
    setLastUser(trimmed);
    setVoiceState('thinking');
    try {
      const payload = await request<ConversationResponse>('/v1/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({ projectId, text: trimmed }),
      });
      setDecision(payload.decision);
      setSuggestedMission(payload.suggestedMission);
      setLastReply(payload.assistantMessage.content);
      if (payload.conversation?.model) setProvider(`${payload.conversation.provider ?? 'AI'} · ${payload.conversation.model}`);
      speak(payload.assistantMessage.content);
    } catch (cause) {
      setVoiceState('error');
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendConversation(text);
  }

  function startVoice() {
    if (busy) return;
    if (voiceState === 'listening') {
      recognitionRef.current?.stop?.();
      setVoiceState('idle');
      return;
    }
    if (voiceState === 'speaking' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setVoiceState('idle');
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceState('unsupported');
      setError('Bu tarayıcı konuşma tanımayı desteklemiyor.');
      return;
    }
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
        recognition.stop();
        setInput('');
        void sendConversation(finalText.trim());
      }
    };
    recognition.onerror = (event: any) => {
      const code = event.error ?? 'unknown';
      if (code !== 'aborted' && code !== 'no-speech') setError(`Sesli giriş hatası: ${code}`);
      setVoiceState(code === 'aborted' || code === 'no-speech' ? 'idle' : 'error');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceState((current) => current === 'listening' ? 'idle' : current);
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

  if (!target) return null;

  return createPortal(
    <section className={`conversation-bridge voice-${voiceState}`} aria-label="Taso conversation">
      {(lastReply || busy) && (
        <div className="conversation-response" aria-live="polite">
          <div className="conversation-response-head"><span>TASO</span><small>{busy ? 'Düşünüyor…' : provider}</small></div>
          {lastUser && <small className="conversation-user-line">Sen: {lastUser}</small>}
          <p>{busy ? 'Yanıt hazırlanıyor…' : lastReply}</p>
        </div>
      )}

      {decision && <div className="conversation-decision"><span>{decision.intent}</span><small>{decision.executionRequested ? 'Mission önerisi · otomatik başlamaz' : 'Sohbet · mission yok'}</small></div>}

      {suggestedMission && (
        <div className="conversation-mission-proposal">
          <div><span>MISSION ÖNERİSİ · {suggestedMission.riskLevel}</span><strong>{suggestedMission.objective}</strong><small>Sen onaylamadan repository/CI/deploy işlemi başlamaz.</small></div>
          <button type="button" onClick={() => void createSuggestedMission()} disabled={busy}>Mission oluştur</button>
        </div>
      )}

      {createdMission && <div className="conversation-created">Mission oluşturuldu · {createdMission.status} · {createdMission.id}</div>}
      {error && <div className="conversation-error">{error}</div>}

      <form className="conversation-composer" onSubmit={submit}>
        <button type="button" className={voiceState === 'listening' ? 'conversation-mic listening' : 'conversation-mic'} onClick={startVoice} aria-label="Taso ile konuş">🎙</button>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`${activeProject?.name ?? 'Workspace'} için Taso'ya yaz veya konuş…`} disabled={busy || !projectId} />
        <button className="conversation-send" type="submit" disabled={busy || !projectId || !input.trim()} aria-label="Gönder">➤</button>
      </form>
      <div className="conversation-meta"><span>Chat ≠ Mission</span><button type="button" onClick={() => setVoiceReplies((value) => !value)}>TTS {voiceReplies ? 'Açık' : 'Kapalı'}</button><span>{voiceState === 'listening' ? 'Dinliyor' : voiceState === 'thinking' ? 'Düşünüyor' : voiceState === 'speaking' ? 'Konuşuyor' : 'Hazır'}</span></div>
    </section>,
    target,
  );
}
