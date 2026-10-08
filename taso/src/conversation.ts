import { createId, nowIso, type RiskLevel } from './domain.js';

export type ConversationIntent =
  | 'CHAT'
  | 'QUESTION'
  | 'STATUS'
  | 'PLAN'
  | 'READ_REQUEST'
  | 'WRITE_REQUEST'
  | 'AUTONOMOUS_SESSION'
  | 'HIGH_IMPACT_REQUEST'
  | 'APPROVAL_RESPONSE'
  | 'CANCEL'
  | 'WORKSPACE_SWITCH'
  | 'UNKNOWN';

export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  projectId: string;
  role: ConversationRole;
  content: string;
  intent?: ConversationIntent;
  createdAt: string;
  missionId?: string;
}

export interface ConversationDecision {
  intent: ConversationIntent;
  executionRequested: boolean;
  suggestedRisk?: RiskLevel;
  confidence: number;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase('tr-TR');

export function classifyConversationIntent(text: string): ConversationDecision {
  const value = normalize(text);
  if (!value) return { intent: 'UNKNOWN', executionRequested: false, confidence: 1 };

  if (/\b(onayla|onay ver|approve|kabul et)\b/i.test(value)) {
    return { intent: 'APPROVAL_RESPONSE', executionRequested: false, confidence: 0.96 };
  }
  if (/\b(iptal|durdur|cancel|vazgeç)\b/i.test(value)) {
    return { intent: 'CANCEL', executionRequested: false, confidence: 0.94 };
  }

  // HIGH_IMPACT is action-sensitive. Mentioning production, secrets or permissions in a question
  // must stay ordinary assistant conversation instead of becoming a mission proposal.
  if (/\b(canlıya al|yayına al|deploy et|production(?:'a|a)? deploy|prod(?:'a|a)? deploy|sil(?:me)?\s+(?:repo|veri|kayıt|dosya)|drop\s+(?:table|database)|yetki\s+(?:ver|kaldır|değiştir)|permission\s+(?:grant|revoke|change)|secret\s+(?:değiştir|sil|rotate)|credential\s+(?:değiştir|sil|rotate))\b/i.test(value)) {
    return { intent: 'HIGH_IMPACT_REQUEST', executionRequested: true, suggestedRisk: 'HIGH_IMPACT', confidence: 0.95 };
  }

  if (/\b(ben yatıyorum|ben çıkıyorum|dönene kadar|sabaha kadar|night shift|otonom çalış|autonomous session)\b/i.test(value)) {
    return { intent: 'AUTONOMOUS_SESSION', executionRequested: true, suggestedRisk: 'WRITE', confidence: 0.93 };
  }

  if (/\b(düzelt|geliştir|ekle|uygula|kodla|oluştur|refactor|değiştir|fix|implement|build|hazırla|üret|başlat|kur)\b/i.test(value)) {
    return { intent: 'WRITE_REQUEST', executionRequested: true, suggestedRisk: 'WRITE', confidence: 0.9 };
  }

  // Read/research requests are normal assistant capabilities. They should not create a mission
  // unless the user explicitly asks Taso to perform workspace execution.
  if (/\b(incele|analiz et|araştır|kontrol et|nedenini bul|tespit et|review|analyze|inspect|bak|karşılaştır|özetle)\b/i.test(value)) {
    return { intent: 'READ_REQUEST', executionRequested: false, suggestedRisk: 'READ', confidence: 0.9 };
  }

  if (/\b(ne yapıyorsun|durum ne|son durum|ne oldu|status|hangi aşama|sistem durumu|sistem ne durumda|sistem nasıl|core durumu|core ne durumda|servisler|agent durumu|agentlar|health)\b/i.test(value)) {
    return { intent: 'STATUS', executionRequested: false, confidence: 0.96 };
  }
  if (/\b(plan|nasıl yaparız|nasıl ilerleriz|yol haritası|fikir ver|öneri ver)\b/i.test(value)) {
    return { intent: 'PLAN', executionRequested: false, confidence: 0.86 };
  }
  if (/\b(workspace|projeye geç|projesine geç)\b/i.test(value)) {
    return { intent: 'WORKSPACE_SWITCH', executionRequested: false, confidence: 0.72 };
  }
  if (/[?？]$/.test(text.trim()) || /\b(ne|neden|nasıl|hangi|kim|nerede|kaç|nedir|mı|mi|mu|mü)\b/i.test(value)) {
    return { intent: 'QUESTION', executionRequested: false, confidence: 0.82 };
  }
  return { intent: 'CHAT', executionRequested: false, confidence: 0.92 };
}

export class ConversationStore {
  private readonly messages: ConversationMessage[];

  constructor(initial: ConversationMessage[] = [], private readonly onChange: () => void = () => {}) {
    this.messages = initial.map((message) => structuredClone(message));
  }

  list(projectId?: string): ConversationMessage[] {
    const values = projectId ? this.messages.filter((message) => message.projectId === projectId) : this.messages;
    return values.map((message) => structuredClone(message));
  }

  append(input: Omit<ConversationMessage, 'id' | 'createdAt'>): ConversationMessage {
    const message: ConversationMessage = {
      ...input,
      id: createId('message'),
      createdAt: nowIso(),
    };
    this.messages.push(message);
    this.onChange();
    return structuredClone(message);
  }
}
