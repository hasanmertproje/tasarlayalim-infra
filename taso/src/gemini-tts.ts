function explicitlyDisabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'false';
}

export interface GeminiTtsStatus {
  provider: 'gemini-tts';
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  model: string;
  voice: string;
  transport: 'https';
}

export interface GeminiTtsRequest {
  text: string;
  style?: string;
}

export class GeminiTtsRuntime {
  private readonly apiKey = process.env.TASO_GEMINI_API_KEY?.trim();
  private readonly enabled = !explicitlyDisabled(process.env.TASO_GEMINI_TTS_ENABLED);
  private readonly model = process.env.TASO_GEMINI_TTS_MODEL?.trim() || 'gemini-3.8-flash-lite-tts';
  private readonly voice = process.env.TASO_GEMINI_TTS_VOICE?.trim()
    || process.env.TASO_GEMINI_LIVE_VOICE?.trim()
    || 'Charon';
  private readonly baseUrl = (process.env.TASO_GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  private readonly defaultStyle = process.env.TASO_GEMINI_TTS_STYLE?.trim()
    || 'Tok, sakin, kontrollü ve doğal İstanbul Türkçesi. Kendinden emin, teknolojik ve ölçülü bir asistan tonu. Gereksiz dramatizasyon yok.';

  status(): GeminiTtsStatus {
    const configured = Boolean(this.apiKey);
    return {
      provider: 'gemini-tts',
      enabled: this.enabled,
      configured,
      ready: this.enabled && configured,
      model: this.model,
      voice: this.voice,
      transport: 'https',
    };
  }

  async synthesize(input: GeminiTtsRequest) {
    const status = this.status();
    if (!status.enabled) throw new Error('Gemini TTS is disabled.');
    if (!this.apiKey) throw new Error('TASO_GEMINI_API_KEY is not configured.');

    const text = input.text.trim();
    if (!text) throw new Error('text is required.');
    if (text.length > 6000) throw new Error('text exceeds the 6000 character TTS limit.');

    const response = await fetch(`${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text,
            speech_metadata: {
              style: input.style?.trim().slice(0, 320) || this.defaultStyle,
            },
          }],
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          responseFormat: {
            audio: {
              mimeType: 'AUDIO_WAV',
              sampleRate: 24000,
            },
          },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voice,
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini TTS failed with HTTP ${response.status}: ${raw.slice(0, 360)}`);
    }

    let payload: any;
    try { payload = JSON.parse(raw); }
    catch { throw new Error('Gemini TTS response was not valid JSON.'); }

    const part = payload?.candidates?.[0]?.content?.parts?.find((item: any) => typeof item?.inlineData?.data === 'string');
    const audioBase64 = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType || 'audio/wav';
    if (!audioBase64) throw new Error('Gemini TTS response did not include audio data.');

    return {
      audioBase64,
      mimeType,
      model: this.model,
      voice: this.voice,
    };
  }
}
