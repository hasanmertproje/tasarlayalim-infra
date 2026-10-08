import { createHash } from 'node:crypto';

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export interface VoiceRealtimeStatus {
  provider: 'openai-realtime';
  transport: 'webrtc';
  enabled: boolean;
  paidAllowed: boolean;
  configured: boolean;
  ready: boolean;
  model: string;
  voice: string;
  fallback: 'browser-stt-tts';
}

export interface VoiceWorkspaceContext {
  projectId: string;
  workspaceName?: string;
}

export class VoiceRealtimeRuntime {
  private readonly isEnabled = enabled(process.env.TASO_VOICE_REALTIME_ENABLED);
  private readonly paidAllowed = enabled(process.env.TASO_VOICE_REALTIME_PAID_ALLOWED);
  private readonly apiKey = process.env.TASO_VOICE_REALTIME_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  private readonly baseUrl = (process.env.TASO_VOICE_REALTIME_BASE_URL?.trim() || 'https://api.openai.com').replace(/\/$/, '');
  private readonly model = process.env.TASO_VOICE_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1-mini';
  private readonly voice = process.env.TASO_VOICE_REALTIME_VOICE?.trim() || 'marin';
  private readonly safetySalt = process.env.TASO_VOICE_SAFETY_SALT?.trim();

  status(): VoiceRealtimeStatus {
    const configured = Boolean(this.apiKey);
    return {
      provider: 'openai-realtime',
      transport: 'webrtc',
      enabled: this.isEnabled,
      paidAllowed: this.paidAllowed,
      configured,
      ready: this.isEnabled && this.paidAllowed && configured,
      model: this.model,
      voice: this.voice,
      fallback: 'browser-stt-tts',
    };
  }

  private safetyIdentifier(projectId: string) {
    if (!this.safetySalt) return undefined;
    return createHash('sha256').update(`${this.safetySalt}:${projectId}`).digest('hex');
  }

  private instructions(context: VoiceWorkspaceContext) {
    return [
      'Sen Taso\'sun; Tasarlayalım için çalışan canlı sesli operasyon asistanısın.',
      'Daima doğal, akıcı ve iyi İstanbul Türkçesiyle konuş. İngilizceye geçme; yalnız özel adları gerektiği kadar kullan.',
      'Ses karakterin sakin, tok, kontrollü, profesyonel ve kendinden emin olsun. Cümleleri kısa tut; robotik veya aşırı neşeli konuşma.',
      'Bu oturum konuşma modudur. CHAT ile MISSION kesin olarak ayrıdır.',
      'Repository, kod, test, PR, CI, deployment, silme, ödeme, rol/yetki veya production işlemi yapma. Bu oturumda hiçbir tool yetkin yoktur.',
      'Kullanıcı yürütme isteyen bir talep verirse isteği kısa biçimde anladığını söyle ve arayüzde ayrı mission önerisinin onaylanması gerektiğini belirt.',
      'Runtime bağlamında açıkça doğrulanmayan bir değişikliğin, testin, PR\'ın veya deployment\'ın gerçekleştiğini asla iddia etme.',
      'Başka workspace verisini kullanma veya sızdırma.',
      `Aktif workspace kimliği: ${context.projectId}`,
      context.workspaceName ? `Aktif workspace adı: ${context.workspaceName}` : 'Aktif workspace adı sağlanmadı.',
    ].join('\n');
  }

  async createSession(context: VoiceWorkspaceContext, sdp: string) {
    const status = this.status();
    if (!status.enabled) throw new Error('Realtime voice is disabled.');
    if (!status.paidAllowed) throw new Error('Paid realtime voice is not allowed by policy.');
    if (!this.apiKey) throw new Error('Realtime voice API key is not configured.');
    if (!context.projectId.trim()) throw new Error('projectId is required.');
    if (!sdp.trim() || sdp.length > 128_000) throw new Error('Invalid SDP offer.');

    const form = new FormData();
    form.set('sdp', sdp);
    form.set('session', JSON.stringify({
      type: 'realtime',
      model: this.model,
      instructions: this.instructions(context),
      audio: { output: { voice: this.voice } },
    }));

    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    const safetyIdentifier = this.safetyIdentifier(context.projectId);
    if (safetyIdentifier) headers['OpenAI-Safety-Identifier'] = safetyIdentifier;

    const response = await fetch(`${this.baseUrl}/v1/realtime/calls`, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const answerSdp = await response.text();
    if (!response.ok) {
      throw new Error(`Realtime voice provider failed with HTTP ${response.status}: ${answerSdp.slice(0, 300)}`);
    }

    return {
      sdp: answerSdp,
      provider: status.provider,
      model: status.model,
      voice: status.voice,
      transport: status.transport,
    };
  }
}
