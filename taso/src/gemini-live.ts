import { tasoCharacterInstructions } from './taso-character.js';

function explicitlyDisabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'false';
}

export interface GeminiLiveStatus {
  provider: 'gemini-live';
  transport: 'websocket';
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  model: string;
  voice: string;
  fallback: 'local-neural-manual';
  ephemeralTokens: true;
}

export interface GeminiLiveContext {
  projectId: string;
  workspaceName?: string;
}

export class GeminiLiveRuntime {
  private readonly apiKey = process.env.TASO_GEMINI_API_KEY?.trim();
  private readonly model = process.env.TASO_GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
  private readonly voice = process.env.TASO_GEMINI_LIVE_VOICE?.trim() || 'Charon';
  private readonly enabled = !explicitlyDisabled(process.env.TASO_GEMINI_LIVE_ENABLED);
  private readonly baseUrl = (process.env.TASO_GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

  status(): GeminiLiveStatus {
    const configured = Boolean(this.apiKey);
    return {
      provider: 'gemini-live',
      transport: 'websocket',
      enabled: this.enabled,
      configured,
      ready: this.enabled && configured,
      model: this.model,
      voice: this.voice,
      fallback: 'local-neural-manual',
      ephemeralTokens: true,
    };
  }

  instructions(context: GeminiLiveContext) {
    return [
      tasoCharacterInstructions(),
      'Bu oturum Taso Live konuşma modudur. Doğal, kısa ve gecikmesiz konuş.',
      'CHAT ile MISSION kesin olarak ayrıdır. Sohbeti veya durum sorusunu mission yapma.',
      'Repository, kod, CI, deploy, ödeme, secret, yetki, silme veya production işlemi yapma. Bu oturumda yürütme tool yetkin yoktur.',
      'Sistem/Core/agent/mission durumu sorulursa doğrulanmamış değer uydurma. Yalnız sağlanan runtime tool sonucuna dayan.',
      'Kullanıcı yürütme isteyen bir talep verirse yalnız anladığını söyle; işlemin ayrı Mission Engine onayı gerektirdiğini belirt.',
      'Secret, credential, token veya ham private repository içeriği isteme ve tekrarlama.',
      'Başka workspace verisini kullanma veya sızdırma.',
      `Aktif workspace kimliği: ${context.projectId}`,
      context.workspaceName ? `Aktif workspace adı: ${context.workspaceName}` : 'Aktif workspace adı sağlanmadı.',
    ].join('\n');
  }

  async createEphemeralToken(context: GeminiLiveContext) {
    const status = this.status();
    if (!status.enabled) throw new Error('Gemini Live is disabled.');
    if (!this.apiKey) throw new Error('TASO_GEMINI_API_KEY is not configured.');
    if (!context.projectId.trim()) throw new Error('projectId is required.');

    const now = Date.now();
    const expireTime = new Date(now + 30 * 60_000).toISOString();
    const newSessionExpireTime = new Date(now + 60_000).toISOString();
    const response = await fetch(`${this.baseUrl}/v1beta/auth_tokens`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: `models/${this.model}`,
          config: {
            responseModalities: ['AUDIO'],
            sessionResumption: {},
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const raw = await response.text();
    if (!response.ok) throw new Error(`Gemini ephemeral token failed with HTTP ${response.status}: ${raw.slice(0, 320)}`);
    let payload: { name?: string };
    try { payload = JSON.parse(raw) as { name?: string }; }
    catch { throw new Error('Gemini ephemeral token response was not valid JSON.'); }
    if (!payload.name) throw new Error('Gemini ephemeral token response did not include a token name.');

    return {
      token: payload.name,
      model: this.model,
      voice: this.voice,
      instructions: this.instructions(context),
      expireTime,
      newSessionExpireTime,
    };
  }
}
