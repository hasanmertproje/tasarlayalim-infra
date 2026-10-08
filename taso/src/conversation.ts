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
const includesAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

export function classifyConversationIntent(text: string): ConversationDecision {
  const value = normalize(text);
  if (!value) return { intent: 'UNKNOWN', executionRequested: false, confidence: 1 };

  if (/\b(onayla|onay ver|approve|kabul et)\b/i.test(value)) {
    return { intent: 'APPROVAL_RESPONSE', executionRequested: false, confidence: 0.96 };
  }
  if (/\b(iptal|durdur|cancel|vazgeç)\b/i.test(value)) {
    return { intent: 'CANCEL', executionRequested: false, confidence: 0.94 };
  }

  // High-impact classification requires an explicit action. Merely discussing production,
  // secrets, credentials or permissions is ordinary assistant conversation.
  if (
    /\b(canlıya al|yayına al|deploy et|production(?:'a|a)? deploy et|prod(?:'a|a)? deploy et|rollback yap)\b/i.test(value)
    || /\b(sil|kaldır|drop|rotate|değiştir|yenile)\b[^.?!]{0,48}\b(secret|credential|token|yetki|permission|repo|veri|database|table)\b/i.test(value)
    || /\b(secret|credential|token|yetki|permission)\b[^.?!]{0,48}\b(sil|kaldır|rotate|değiştir|yenile|ver|grant|revoke)\b/i.test(value)
  ) {
    return { intent: 'HIGH_IMPACT_REQUEST', executionRequested: true, suggestedRisk: 'HIGH_IMPACT', confidence: 0.95 };
  }

  if (includesAny(value, ['ben yatıyorum', 'ben çıkıyorum', 'dönene kadar', 'sabaha kadar', 'night shift', 'otonom çalış', 'autonomous session'])) {
    return { intent: 'AUTONOMOUS_SESSION', executionRequested: true, suggestedRisk: 'WRITE', confidence: 0.93 };
  }

  // Turkish verbs are often inflected (geliştirmeye, geliştirerek, üretsin, etc.).
  // Stem matching is more reliable here than JavaScript \b, which is ASCII-centric.
  if (includesAny(value, [
    'düzelt', 'geliştir', 'ekle', 'uygula', 'kodla', 'oluştur', 'refactor',
    'değiştir', 'fix', 'implement', 'build', 'hazırla', 'üret', 'başlat', 'başla', 'kur',
  ])) {
    return { intent: 'WRITE_REQUEST', executionRequested: true, suggestedRisk: 'WRITE', confidence: 0.9 };
  }

  // Read/research requests are normal assistant capabilities. They stay conversational and
  // may use read-only tools later, but they do not become missions by default.
  if (includesAny(value, [
    'incele', 'analiz et', 'araştır', 'kontrol et', 'nedenini bul', 'tespit et',
    'review', 'analyze', 'inspect', 'bak', 'karşılaştır', 'özetle',
  ])) {
    return { intent: 'READ_REQUEST', executionRequested: false, suggestedRisk: 'READ', confidence: 0.9 };
  }

  if (includesAny(value, ['ne yapıyorsun', 'durum ne', 'son durum', 'ne oldu', 'status', 'hangi aşama', 'sistem durumu', 'sistem ne durumda', 'sistem nasıl', 'core durumu', 'core ne durumda', 'servisler', 'agent durumu', 'agentlar', 'health'])) {
    return { intent: 'STATUS', executionRequested: false, confidence: 0.96 };
  }
  if (includesAny(value, ['plan', 'nasıl yaparız', 'nasıl ilerleriz', 'yol haritası', 'fikir ver', 'öneri ver'])) {
    return { intent: 'PLAN', executionRequested: false, confidence: 0.86 };
  }
  if (includesAny(value, ['workspace', 'projeye geç', 'projesine geç'])) {
    return { intent: 'WORKSPACE_SWITCH', executionRequested: false, confidence: 0.72 };
  }
  if (/[?？]$/.test(text.trim()) || includesAny(value, [' ne ', 'neden', 'nasıl', 'hangi', 'kim', 'nerede', 'kaç', 'nedir', ' mı', ' mi', ' mu', ' mü'])) {
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
