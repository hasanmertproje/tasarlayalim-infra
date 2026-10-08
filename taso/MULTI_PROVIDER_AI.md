# Multi-provider AI runtime

Taso routes each mission through the ordered `providerChain` produced by the cost-aware `ProviderRouter`. The executor tries eligible configured providers in that order and falls back when a provider returns an API, transport, timeout, or empty-response failure.

Provider secrets stay server-side. For provider id `nvidia`, configure:

- `TASO_PROVIDER_NVIDIA_BASE_URL`
- `TASO_PROVIDER_NVIDIA_API_KEY`
- `TASO_PROVIDER_NVIDIA_MODEL`
- `TASO_PROVIDER_NVIDIA_DATA=public,private_code` (only after the operator approves that provider for private code)

The same convention applies to `GROQ`, `GEMINI`, `CLOUDFLARE`, `AZURE`, and `OPENAI`.

Do not expose these values to Taso UI. The executor readiness endpoint returns provider id/model/capability metadata only, never credentials.

The old `TASO_AI_BASE_URL/API_KEY/MODEL` variables remain a temporary single-provider compatibility fallback and can be removed after the live instance migrates.

Paid providers are still excluded from a mission unless its autonomous policy permits paid AI. Data-class restrictions are enforced both while routing and immediately before a provider call.
