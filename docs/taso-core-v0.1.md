# Taso Core v0.1

Taso is the AI-native project operator for Tasarlayalım Dev Cloud.

The goal is not a chat bot. The goal is a project-scoped autonomous mission system where the user can say:

> Finish this project professionally, ask me only when a critical approval is required, and send me a working demo when it is ready.

## Core rules

1. Every project is a separate workspace and security boundary.
2. Existing projects default to `preserve_existing`; Taso must inspect and continue the real architecture instead of rewriting it without approval.
3. New projects default to `professional_best_fit`; technology is selected for maintainability and requirements, not novelty.
4. Autonomous missions may code, test, retry, open branches, create previews, and report results without repeated user interaction.
5. HIGH_IMPACT operations always require explicit approval.
6. Destructive operations are denied by default.
7. Paid AI is OFF by default.
8. AI providers are interchangeable. Taso Core must not depend on one vendor.
9. External providers are `public` data only until an operator explicitly certifies them for `private_code` or `sensitive` data.
10. Raw provider keys, root credentials, Docker socket access, and cross-project filesystem access are forbidden to agents.

## Mission lifecycle

`queued -> planning -> running -> testing -> preview_ready -> completed`

Possible side states:

- `waiting_approval`
- `failed`
- `cancelled`

A future runtime worker will consume queued missions, create an isolated sandbox, select a provider chain, execute the plan, retry low-risk failures, run CI/QA, and produce a preview URL.

## Autonomous mission defaults

- autonomous mode: enabled
- retry budget: 5
- preview: required
- production: ask
- destructive changes: deny
- paid AI: disabled
- notifications: important only

## Multi-provider router

Initial provider slots:

- NVIDIA NIM
- Groq
- Google Gemini
- Cloudflare Workers AI
- Azure AI
- OpenAI

A provider is enabled only when its secret is configured. Provider secrets are never returned by the API.

Routing currently considers:

- data classification
- free/credit/paid cost class
- operator permission for paid AI
- provider strength
- latency preference

`Free First + Privacy Guard` is the default behavior.

## Provider data certification

External providers default to:

`public`

An operator may explicitly widen a provider after reviewing its current privacy/retention terms:

```env
TASO_PROVIDER_NVIDIA_DATA=public,private_code
```

This is intentionally manual. Taso must never infer that a provider is safe for customer code simply because an API key exists.

## Zero-trust agent design

Future agent workers must run in ephemeral, project-scoped containers.

They must not receive:

- `/var/run/docker.sock`
- root SSH credentials
- production database root credentials
- raw GitHub/Coolify/provider tokens
- another project's workspace

Privileged actions go through typed Taso Tool Broker operations, for example:

- `github.createBranch`
- `github.commitFiles`
- `github.openPullRequest`
- `coolify.createPreview`
- `coolify.deployProduction` (approval required)
- `notify.send`

## Exfiltration defense roadmap

The runtime security gateway will add:

- outbound domain allowlists
- DLP scanning for secrets before egress
- canary credentials to detect exfiltration attempts
- prompt-injection boundary between trusted policy and untrusted repository/web content
- per-task audit logs
- automatic sandbox kill on security violation

## Existing project continuation

When an existing repository is onboarded, a future discovery worker will generate a project manifest containing at minimum:

- language/framework
- architecture pattern
- dependency manager
- database/migrations
- build/test commands
- deployment model
- known project constraints

The generated manifest becomes the baseline for later missions such as "continue Maria Çiçek".

## API in v0.1

- `GET /health`
- `GET /v1/providers`
- `GET /v1/projects`
- `POST /v1/projects`
- `GET /v1/missions`
- `POST /v1/missions`
- `GET /v1/missions/:id`
- `POST /v1/missions/:id/approve`
- `POST /v1/missions/:id/cancel`

v0.1 is the policy/routing/mission foundation. It does **not** yet execute coding agents. Agent execution, persistence, Tool Broker, project discovery, preview orchestration, voice, and the Jarvis-style UI are subsequent milestones.
