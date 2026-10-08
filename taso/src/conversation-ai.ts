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
        temperature: 0.35,
        messages: [
          {
            role: 'system',
            content: [
              'You are Taso, the AI operations partner for Tasarlayalım.',
              'Reply naturally and concisely in Turkish unless the operator uses another language.',
              'You are in conversation mode. Never claim a repository change, test, PR, CI run, preview, deployment or approval happened unless runtime context explicitly says so.',
              'Ordinary chat, questions, status discussion and planning are not missions.',
              'If the operator requests execution, explain the proposed action briefly; execution is handled by a separate explicit Mission Engine confirmation.',
              'Use only the active workspace context and never leak another workspace.',
              `Active workspace: ${project.name}`,
              `Repository: ${project.repository}`,
              `Runtime context: ${runtimeSummary}`,
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
