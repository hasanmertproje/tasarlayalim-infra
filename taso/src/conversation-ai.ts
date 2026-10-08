import type { DataClass, Project } from './domain.js';
import type { ProviderRouter } from './provider-router.js';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type ConversationRuntimeContext = {
  activeMission?: { id: string; objective: string; status: string };
  recentMissions?: Array<{ objective: string; status: string }>;
};

type RuntimeConversationProvider = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

function envPrefix(id: string) {
  return `TASO_PROVIDER_${id.toUpperCase().replace(/-/g, '_')}`;
}

function runtimeProvider(id: string): RuntimeConversationProvider | undefined {
  const prefix = envPrefix(id);
  const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim();
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return { id, baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
}

export class ConversationAi {
  constructor(private readonly router: ProviderRouter) {}

  private select(dataClass: DataClass = 'private_code') {
    const eligible = this.router.route({ dataClass, paidAi: false, preferFree: true });
    for (const provider of eligible) {
      const runtime = runtimeProvider(provider.id);
      if (runtime) return runtime;
    }
    return undefined;
  }

  status() {
    const provider = this.select('private_code');
    return provider
      ? { configured: true, provider: provider.id, model: provider.model, dataClass: 'private_code' as const }
      : { configured: false, dataClass: 'private_code' as const };
  }

  async reply(project: Project, turns: ConversationTurn[], input: string, runtime: ConversationRuntimeContext = {}): Promise<string> {
    const provider = this.select('private_code');
    if (!provider) throw new Error('No policy-approved conversational AI provider is configured for private workspace context.');

    const runtimeSummary = JSON.stringify({
      activeMission: runtime.activeMission ?? null,
      recentMissions: runtime.recentMissions?.slice(0, 5) ?? [],
    });

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.28,
        messages: [
          {
            role: 'system',
            content: [
              'Sen Taso’sun; Tasarlayalım’ın yapay zekâ operasyon asistanısın.',
              'Her zaman doğal, akıcı ve iyi İstanbul Türkçesiyle konuş. Kullanıcı başka dilde kelimeler kullansa bile yanıt dilin Türkçe kalsın; yalnız teknik terimleri gerektiğinde özgün biçimleriyle kullan.',
              'Taso’nun kişiliği sakin, tok, kontrollü, kendinden emin ve operasyon odaklıdır. Cümlelerin kısa, temiz ve ritmik olsun; gereksiz dolgu kullanma.',
              'Kullanıcıyla samimi ama ölçülü biçimde sen diliyle konuş. “Siz nasılsınız?”, “Nasıl yardımcı olabilirim?”, “Elbette!”, “Memnuniyetle!” gibi genel çağrı merkezi/asistan kalıplarını kullanma.',
              'Gündelik selamlaşmalarda bile operasyon karakterini koru. Uygunsa “Hazırım.”, “Seni dinliyorum.”, “Sistemler normal.”, “Kontrol ediyorum.” gibi kısa ve doğal ifadeler kullan; bunları mekanik biçimde her yanıta ekleme.',
              'Sesli okumaya uygun yaz: kısa cümleler, doğal noktalama ve gerektiğinde kısa duraklar kullan. Emoji, markdown başlığı, tablo, uzun madde listesi ve parantez içinde uzun açıklama kullanma.',
              'Teknik durum söylerken doğrulanmış olanı söyle; belirsizse bunu kısa ve net belirt. Olmayan ilerleme, deploy, CI, approval veya canlı durum uydurma.',
              'Kendine özgü Taso karakterini koru; herhangi bir kurgu karakterini, oyuncuyu veya gerçek kişiyi taklit etme.',
              'Normal sohbet, soru, durum konuşması ve planlama mission değildir.',
              'Kullanıcı yürütme isterse yapılacak işi kısa biçimde açıkla; gerçek yürütme ayrı Mission Engine onayıyla başlar.',
              'Yalnız aktif workspace bağlamını kullan; başka workspace bilgisini sızdırma.',
              `Aktif workspace: ${project.name}`,
              `Repository: ${project.repository}`,
              `Runtime bağlamı: ${runtimeSummary}`,
            ].join('\n'),
          },
          ...turns.slice(-16),
          { role: 'user', content: input },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) throw new Error(`Conversation provider failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Conversation provider returned an empty response.');
    return content;
  }
}