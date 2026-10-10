# Taso V32 Production Wiring

This runbook connects the already-implemented optional Taso capabilities without changing Provider Brain or auto-deploying production.

## Services

- `taso-browser` — Browser Operator / Visual QA, internal port `3100`.
- `taso-search` — SearxNG-compatible general web search, internal port `8080`.
- `taso-speaker` — privacy-bounded speaker recognition, internal port `3200`; conversational identity only and never authorization.

Use `deploy/taso-aux-services.compose.yml` or equivalent Coolify services. Keep these services internal; do not publish them publicly unless an explicit reverse-proxy/auth design is added.

## Required shared secrets

Generate independent long random values for:

- `TASO_BROWSER_WORKER_SECRET`
- `TASO_SPEAKER_SERVICE_SECRET`

Never reuse `TASO_GATEWAY_SECRET` for either service.

## Browser worker

Worker environment:

```env
PORT=3100
TASO_BROWSER_WORKER_SECRET=<browser-secret>
TASO_BROWSER_ALLOWED_HOSTS=taso-v2.demo.tasarlayalim.com,<preview-hosts>
```

Taso Core environment:

```env
TASO_BROWSER_WORKER_URL=http://taso-browser:3100
TASO_BROWSER_WORKER_SECRET=<same-browser-secret>
```

Only add hosts Taso is explicitly allowed to inspect. Do not use a wildcard allowlist.

## General web search

Taso Core environment:

```env
TASO_SEARCH_ENDPOINT=http://taso-search:8080/search
```

URL reading remains independent from general search. Search results are treated as untrusted web content.

## Speaker recognition

Speaker service environment:

```env
PORT=3200
TASO_SPEAKER_SERVICE_SECRET=<speaker-secret>
TASO_SPEAKER_DATA_DIR=/data
```

Persist `/data` using a volume.

Taso Core environment:

```env
TASO_SPEAKER_SERVICE_URL=http://taso-speaker:3200
TASO_SPEAKER_SERVICE_SECRET=<same-speaker-secret>
TASO_SPEAKER_CONFIDENCE_MIN=0.82
```

Speaker recognition is only a personalization/conversation signal. It must never grant roles, permissions, approvals, deploy authority, production access, or bypass TOTP/session checks.

## Coolify wiring order

1. Create/deploy `taso-search` as an internal service.
2. Create/deploy `taso-browser` as an internal service with its dedicated secret and strict allowed-host list.
3. Create/deploy `taso-speaker` with a persistent `/data` volume and its dedicated secret.
4. Add the corresponding internal URLs and shared secrets to Taso Core.
5. Redeploy Taso Core only after the three auxiliary services are healthy.
6. Run `node scripts/taso-production-preflight.mjs` from an environment that can reach the same internal URLs.
7. Verify Taso capability/health endpoints before any production action.
8. Production deploy remains an explicit approval-gated action; this runbook does not authorize it.

## Acceptance gates

Do not call production wiring complete until all are true:

- Web search returns a real JSON response through `TASO_SEARCH_ENDPOINT`.
- Browser worker `/health` is reachable with its configured secret.
- Speaker `/health` is reachable with its configured secret and `/data` is persistent.
- Taso Core reports optional capabilities truthfully without downgrading healthy core readiness.
- Website/fullstack preview verification produces real browser/visual evidence.
- Mobile + desktop, dark + light Browser CI remains green.
- No provider branding leaks into primary UI.
- Provider Brain remains frozen.

## Preflight

Export the five Core-facing variables and run:

```bash
node scripts/taso-production-preflight.mjs
```

The script exits non-zero when any required environment variable is missing or an auxiliary service probe fails.
