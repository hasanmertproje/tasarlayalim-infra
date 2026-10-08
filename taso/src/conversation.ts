import { createId, nowIso, type RiskLevel } from './domain.js';

export type ConversationIntent =
  | 'CHAT'
  | 'QUESTION'
  | 'STATUS'
  | 'PLAN'
  | 'READ_REQUEST'
  | 'WRITE_REQUEST'
  | 'OPERATE_REQUEST'
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
    return { intent: 'APPROVAL_RESPONSE', executionRequested: true, confidence: 0.96 };
  }
  if (/\b(iptal|durdur|cancel|vazgeç)\b/i.test(value)) {
    return { intent: 'CANCEL', executionRequested: true, confidence: 0.94 };
  }
  if (/\b(production|prod|canlıya al|yayına al|deploy et|sil|drop|yetki|permission|secret|credential)\b/i.test(value)) {
    return { intent: 'HIGH_IMPACT_REQUEST', executionRequested: true, suggestedRisk: 'HIGH_IMPACT', confidence: 0.94 };
  }
  if (/\b(ben yatıyorum|ben çıkıyorum|dönene kadar|sabaha kadar|night shift|otonom|autonomous)\b/i.test(value)) {
    return { intent: 'AUTONOMOUS_SESSION', executionRequested: true, suggestedRisk: 'WRITE', confidence: 0.93 };
  }
  if (/\b(düzelt|geliştir|ekle|uygula|kodla|oluştur|refactor|değiştir|fix|implement|build)\b/i.test(value)) {
    return { intent: 'WRITE_REQUEST', executionRequested: true, suggestedRisk: 'WRITE', confidence: 0.9 };
  }
  if (/\b(incele|analiz et|araştır|kontrol et|neden|bul|tespit et|review|analyze|inspect)\b/i.test(value)) {
    return { intent: 'READ_REQUEST', executionRequested: true, suggestedRisk: 'READ', confidence: 0.86 };
  }
  if (/\b(ne yapıyorsun|durum ne|son durum|ne oldu|status|hangi aşama)\b/i.test(value)) {
    return { intent: 'STATUS', executionRequested: false, confidence: 0.91 };
  }
  if (/\b(plan|nasıl yaparız|nasıl ilerleriz|yol haritası)\b/i.test(value)) {
    return { intent: 'PLAN', executionRequested: false, confidence: 0.82 };
  }
  if (/\b(workspace|projeye geç|projesine geç)\b/i.test(value)) {
    return { intent: 'WORKSPACE_SWITCH', executionRequested: false, confidence: 0.72 };
  }
  if (/[?？]$/.test(text.trim()) || /\b(ne|neden|nasıl|hangi|kim|nerede|kaç)\b/i.test(value)) {
    return { intent: 'QUESTION', executionRequested: false, confidence: 0.7 };
  }
  return { intent: 'CHAT', executionRequested: false, confidence: 0.64 };
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
