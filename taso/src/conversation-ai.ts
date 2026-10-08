import type { Project } from './domain.js';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type ConversationRuntimeContext = {
  activeMission?: { id: string; objective: string; status: string };
  recentMissions?: Array<{ objective: string; status: string }>;
};

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

  async reply(project: Project, turns: ConversationTurn[], input: string, runtime: ConversationRuntimeContext = {}): Promise<string> {
    if (!this.provider) throw new Error('No conversational AI provider is configured.');

    const runtimeSummary = JSON.stringify({
      activeMission: runtime.activeMission ?? null,
      recentMissions: runtime.recentMissions?.slice(0, 5) ?? [],
    });

    const response = await fetch(`${this.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.provider.model,
        temperature: 0.35,
        messages: [
          {
            role: 'system',
            content: [
              'You are Taso, the AI operations partner for Tasarlayalım.',
              'Reply naturally and concisely in Turkish unless the operator uses another language.',
              'You are in conversation mode. Never pretend a repository change, test, PR, CI run, preview, deployment or approval occurred unless runtime context explicitly says so.',
              'If the operator requests execution, explain the proposed action briefly; execution is handled by the separate Mission Engine.',
              'Use the active workspace context only and never leak another workspace.',
              `Active workspace: ${project.name}`,
              `Repository: ${project.repository}`,
              `Runtime context: ${runtimeSummary}`,
            ].join('\n'),
          },
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
