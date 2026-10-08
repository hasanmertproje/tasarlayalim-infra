import { FormEvent, useEffect, useMemo, useState } from 'react';

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
type SuggestedMission = { objective: string; riskLevel: 'READ' | 'WRITE' | 'HIGH_IMPACT'; dataClass: 'public' | 'private_code' | 'sensitive' };
type ConversationResponse = {
  decision: { intent: string; executionRequested: boolean; suggestedRisk?: string; confidence: number };
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  suggestedMission?: SuggestedMission;
  conversation?: { configured?: boolean; provider?: string; model?: string };
};
type Mission = { id: string; status: string; objective: string; riskLevel?: string };

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

export default function ConversationDock() {
  const [open, setOpen] = useState(false);
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

  const activeProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);

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
    if (!open) return;
    void loadProjects().catch((cause) => setError((cause as Error).message));
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    setDecision(undefined);
    setSuggestedMission(undefined);
    setCreatedMission(undefined);
    void loadMessages(projectId).catch((cause) => setError((cause as Error).message));
  }, [open, projectId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !projectId || busy) return;
    setBusy(true);
    setInput('');
    setError('');
    setSuggestedMission(undefined);
    setCreatedMission(undefined);
    try {
      const payload = await request<ConversationResponse>('/v1/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({ projectId, text }),
      });
      setMessages((current) => [...current, payload.userMessage, payload.assistantMessage]);
      setDecision(payload.decision);
      setSuggestedMission(payload.suggestedMission);
      if (payload.conversation?.model) setProvider(`${payload.conversation.provider ?? 'AI'} · ${payload.conversation.model}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
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
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={open ? 'conversation-v2 open' : 'conversation-v2'}>
      <button className="conversation-v2-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="conversation-v2-orb">T</span>
        <span><b>TASO CONVERSATION V2</b><small>{open ? 'Workspace sohbeti' : 'Taso ile konuş'}</small></span>
        <span>{open ? '×' : '↑'}</span>
      </button>
      {open && <section className="conversation-v2-panel">
        <header>
          <div><span>CONVERSATION</span><strong>{activeProject?.name ?? 'Workspace seç'}</strong></div>
          <small>{provider}</small>
        </header>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Conversation workspace">
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <div className="conversation-v2-messages">
          {!messages.length && <div className="conversation-v2-empty"><strong>Taso hazır.</strong><span>Normal sohbet mission oluşturmaz. Bir işlem istersen Taso bunu execution intent olarak ayırır.</span></div>}
          {messages.map((message) => <article key={message.id} className={`conversation-v2-message ${message.role}`}>
            <small>{message.role === 'user' ? 'SEN' : message.role === 'assistant' ? 'TASO' : 'SYSTEM'} {message.intent ? `· ${message.intent}` : ''}</small>
            <p>{message.content}</p>
          </article>)}
        </div>
        {decision && <div className="conversation-v2-decision"><span>{decision.intent}</span><small>{decision.executionRequested ? 'Yürütme isteği algılandı' : 'Sohbet · mission yok'} · {Math.round(decision.confidence * 100)}%</small></div>}
        {suggestedMission && <div className="conversation-v2-mission-card">
          <div><span>MISSION ÖNERİSİ</span><strong>{suggestedMission.riskLevel}</strong><p>{suggestedMission.objective}</p></div>
          <button type="button" onClick={() => void createSuggestedMission()} disabled={busy}>{busy ? '…' : 'Mission oluştur'}</button>
          <small>Bu buton açıkça yürütme başlatır. Sohbet tek başına repository işlemi yapmaz.</small>
        </div>}
        {createdMission && <div className="conversation-v2-created"><strong>Mission oluşturuldu</strong><span>{createdMission.status} · {createdMission.id}</span>{createdMission.status === 'waiting_approval' && <small>HIGH IMPACT: insan onayı bekleniyor.</small>}</div>}
        {error && <div className="conversation-v2-error">{error}</div>}
        <form onSubmit={submit}>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Taso'ya yaz…" disabled={busy || !projectId} />
          <button type="submit" disabled={busy || !projectId || !input.trim()}>{busy ? '…' : 'Gönder'}</button>
        </form>
        <footer>Chat ≠ Mission · Project isolated · Explicit execution boundary · V2 Preview</footer>
      </section>}
    </div>
  );
}
