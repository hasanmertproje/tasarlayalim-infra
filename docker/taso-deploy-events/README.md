# Taso Coolify deployment event bridge

Separate, isolated service; it does not change Taso Core, Gemini Live, or the UI.

## Coolify setup

Create a **new Dockerfile application** with base directory `/docker/taso-deploy-events`, Dockerfile `Dockerfile`, port `8080`, and a dedicated HTTPS domain. Its Watch Paths should be `docker/taso-deploy-events/**`. Do not point this at the old V1 resources.

For automatic deployments from GitHub App pushes, also set **Advanced > Deployment > Auto deploy** to **Deploy on push (webhooks)**. Watch Paths only filter incoming Git provider deployment events; they do not independently trigger a deployment when Auto deploy is set to manual.

Set server-side environment variables (never paste secrets into chat or commit them):

- `COOLIFY_EVENT_SECRET`: cryptographically random, URL-safe string of at least 32 characters.
- `NTFY_BASE_URL`: HTTPS ntfy server URL.
- `NTFY_TOPIC`: existing publish topic.
- `NTFY_TOKEN`: ntfy publish-only token.
- `DEPLOY_SERVICES_JSON`: JSON map of **exact Coolify application UUIDs** to fixed, trusted health URLs and optional dashboard URLs, for example:
  `{"taso-command-center-v2":{"uuid":"<actual-uuid>","healthUrl":"https://<actual-ui-host>/health","dashboardUrl":"https://<actual-coolify-app-url>"},"taso-core-v2":{"uuid":"<actual-core-uuid>","healthUrl":"https://<actual-ui-host>/api/health"}}`

Do not guess UUIDs or health URLs. The `/health` UI endpoint checks nginx only; `/api/health` checks Core through the gateway. The service uses configured URLs exclusively, never the webhook-supplied `fqdn` or `deployment_url`. Add voice/ntfy only when their actual health URLs and UUIDs are verified.

In **Coolify > Notifications > Webhook**, set the endpoint to `https://<bridge-domain>/events/<COOLIFY_EVENT_SECRET>`, enable it, and select **Deployment Success** and **Deployment Failure**. Coolify does not sign these events. The unguessable HTTPS path is the authentication boundary; protect it like a token, do not log it or share screenshots of the full URL.

The bridge publishes to ntfy through the official JSON publish API. User-visible Turkish text stays in the UTF-8 JSON body rather than custom HTTP headers, avoiding Node/Undici ByteString limitations. Bearer authentication remains in the `Authorization` header.

## Self-deployment notification

The bridge does **not** depend on receiving its own Coolify `deployment_success` webhook to announce its own rollout. During a rolling update, that callback can race with the old/new container switch. Instead, every newly started bridge container waits briefly, checks its own local `/health`, and publishes one startup result to ntfy using the same JSON publish path. `SOURCE_COMMIT` is included in the message when Coolify provides it. If the self webhook also arrives after the startup notification, it is treated as a duplicate; if startup publishing fails, the webhook path can still act as a fallback.

This means `YAYIN TAMAMLANDI · taso-deploy-events` proves that the new bridge container started and passed its local health probe. It is intentionally not a cryptographic attestation that Coolify finished every outer routing step.

## Semantics and limits

- Only configured exact UUID allowlisted production applications plus the bridge's own Coolify-injected resource UUID are processed; PR previews are ignored.
- For normal applications, success requires a Coolify success event **and** a successful configured HTTPS health probe. It does not prove that the deployed commit equals a specific main SHA; version attestation remains future work.
- For the bridge itself, startup notification is authoritative for the new container because self-webhook delivery can race with rolling replacement.
- Failure and failed health probes send MAX priority. Successful, healthy deploy sends normal priority.
- ntfy publishing is retried up to three attempts for transient delivery failures; successful publishes are logged with safe event/service/health/message-id metadata. Secrets and tokens are never logged.
- Deduplication is in-memory per deployment UUID/event for 24h; restarting this bridge clears the cache. Persistent dedupe and retry queues are future improvements.
- Coolify does not reliably retry non-2xx responses. A failed ntfy delivery is logged and returns HTTP 502 on webhook delivery, but requires operational monitoring/manual retry. No false success notification is emitted.
- Coolify's test event is intentionally ignored and cannot verify actual deployment notification delivery.
- Watch Paths control automatic Git deploys only, not manual deploys.
