import type { CostClass, DataClass } from './domain.js';

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  enabled: boolean;
  costClass: CostClass;
  strength: number;
  latency: number;
  allowedDataClasses: DataClass[];
}

export interface RouteRequest {
  dataClass: DataClass;
  paidAi: boolean;
  preferFree?: boolean;
}

const rankDataClass: Record<DataClass, number> = {
  public: 0,
  private_code: 1,
  sensitive: 2,
};

function allowsData(provider: ProviderDescriptor, dataClass: DataClass): boolean {
  return provider.allowedDataClasses.some(
    (allowed) => rankDataClass[allowed] >= rankDataClass[dataClass],
  );
}

function parseAllowedData(value: string | undefined): DataClass[] {
  if (!value) return ['public'];
  const allowed = new Set<DataClass>();
  for (const token of value.split(',').map((item) => item.trim())) {
    if (token === 'public' || token === 'private_code' || token === 'sensitive') {
      allowed.add(token);
    }
  }
  return allowed.size ? [...allowed] : ['public'];
}

function externalProvider(
  id: string,
  displayName: string,
  envKey: string,
  costClass: CostClass,
  strength: number,
  latency: number,
): ProviderDescriptor {
  return {
    id,
    displayName,
    enabled: Boolean(process.env[`TASO_PROVIDER_${id.toUpperCase().replace(/-/g, '_')}_API_KEY`] || process.env[envKey]),
    costClass,
    strength,
    latency,
    // Zero-trust default: external providers may see only public data until an
    // operator explicitly certifies a broader class with TASO_PROVIDER_<ID>_DATA.
    allowedDataClasses: parseAllowedData(
      process.env[`TASO_PROVIDER_${id.toUpperCase()}_DATA`],
    ),
  };
}

export function defaultProviders(): ProviderDescriptor[] {
  return [
    externalProvider('nvidia', 'NVIDIA NIM', 'NVIDIA_API_KEY', 'free', 85, 55),
    externalProvider('groq', 'Groq', 'GROQ_API_KEY', 'free', 72, 90),
    externalProvider('gemini', 'Google Gemini', 'GEMINI_API_KEY', 'free', 80, 65),
    externalProvider('cloudflare', 'Cloudflare Workers AI', 'CLOUDFLARE_API_TOKEN', 'free', 60, 80),
    externalProvider('azure', 'Azure AI', 'AZURE_AI_API_KEY', 'credit', 88, 55),
    externalProvider('openai', 'OpenAI', 'OPENAI_API_KEY', 'paid', 95, 70),
    {
      id: 'mock-local',
      displayName: 'Local Mock Provider',
      enabled: process.env.TASO_ALLOW_MOCK_PROVIDER === 'true',
      costClass: 'free',
      strength: 1,
      latency: 100,
      allowedDataClasses: ['sensitive'],
    },
  ];
}

export class ProviderRouter {
  constructor(private readonly providers: ProviderDescriptor[]) {}

  route(request: RouteRequest): ProviderDescriptor[] {
    const eligible = this.providers.filter((provider) => {
      if (!provider.enabled) return false;
      if (!allowsData(provider, request.dataClass)) return false;
      if (!request.paidAi && provider.costClass === 'paid') return false;
      return true;
    });

    const preferFree = request.preferFree ?? true;

    return eligible.sort((a, b) => {
      if (preferFree && a.costClass !== b.costClass) {
        const weight: Record<CostClass, number> = { free: 0, credit: 1, paid: 2 };
        return weight[a.costClass] - weight[b.costClass];
      }
      if (b.strength !== a.strength) return b.strength - a.strength;
      return b.latency - a.latency;
    });
  }

  safeSummary(): ProviderDescriptor[] {
    return this.providers.map((provider) => ({ ...provider }));
  }
}
