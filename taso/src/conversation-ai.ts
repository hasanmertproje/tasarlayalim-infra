import type { Project } from './domain.js';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

function firstConfiguredProvider() {
  const ids = ['NVIDIA', 'GROQ', 'OPENAI'];
  for (const id of ids) {
    const prefix = `TASO_PROVIDER_${id}`;
    const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim();
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
    const model = process.env[`${prefix}_MODEL`]?.trim();
    if (baseUrl && apiKey && model) return { id: id.toLowerCase(), baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
  }
  return undefined;
}

export class ConversationAi {
  private readonly provider = firstConfiguredProvider();

  status() {
    return this.provider ? { configured: true, provider: this.provider.id, model: this.provider.model } : { configured: false };
  }

  async reply(project: Project, turns: ConversationTurn[], input: string): Promise<string> {
    if (!this.provider) throw new Error('No conversational AI provider is configured.');
    const response = await fetch(`${this.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.provider.model,
        temperature: 0.35,
        messages: [
          { role: 'system', content: `You are Taso, the AI operations partner for Tasarlayalım. Reply naturally in Turkish. Conversation mode never pretends work was executed. Active workspace: ${project.name}. Repository: ${project.repository}.` },
          ...turns.slice(-16),
          { role: 'user', content: input },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Conversation provider failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Conversation provider returned an empty response.');
    return content;
  }
}
