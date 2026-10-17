# TASO gateway recovery — 2026-10-17

## Incident classification

Operator observed `Unauthorized gateway.` at https://taso.tasarlayalim.com.
The **exact** response text originates in `taso/src/server.ts` on the
`/v1/*` gateway guard when `X-Taso-Gateway` differs from the Core secret.
The `taso-ui/nginx.conf` template injects the UI runtime value in that header.
This is a **suspected** Core/UI runtime mismatch or routing problem, not proven
by the public error alone.

Source CI previously verified a matching secret on ephemeral test containers.
That does not prove the current production containers use the same values.

## Read-only operator evidence (no secrets exposed)

From an authorized VPS shell on the Docker host, run a reviewed copy of:

```bash
python3 scripts/taso-gateway-runtime-audit.py
```

It checks:
- Unique/nonempty Core and UI runtime `TASO_GATEWAY_SECRET` environment values.
- Equality of the **running** Core and UI environment values.
- All three substituted Nginx `X-Taso-Gateway` headers, compared to Core.
- **It never prints values, hashes, container environment contents or Nginx config.**
- Exit 0: configuration alignment verified, **not** end-to-end public auth success.
  Exit 2: mismatch/missing config. Exit 3: unable to inspect.

Then separately check public HTTP status codes without credentials:

```bash
curl -sS -o /dev/null -w 'root=%{http_code}\n' https://taso.tasarlayalim.com/
curl -sS -o /dev/null -w 'ui_health=%{http_code}\n' https://taso.tasarlayalim.com/health
curl -sS -o /dev/null -w 'core_health=%{http_code}\n' https://taso.tasarlayalim.com/api/health
```

On releases containing the new Core route and UI healthcheck, also check
`/api/gateway/health` for HTTP 200. A 401 establishes an internal gateway
mismatch without needing to reveal the secret. The new endpoint is **not**
present on previously deployed images until a successful release.

## Safe recovery order

1. Confirm the unique Coolify owner of the production domain is `taso-ui-prod`.
2. Capture available disk, Core/UI Docker health, current image/commit metadata,
   and a verified off-site backup/rollback plan.
3. Run the read-only audit. Treat mismatched **effective Nginx config** separately
   from mismatched Docker runtime environment.
4. Restore the UI's gateway configuration **to match the authoritative Core
   secret**, with explicit production approval, without printing it to logs,
   terminal scrollback, chat, or CI. Never solve this by disabling the Core guard.
5. Prefer isolated UI restart/redeploy only after preserving production Core
   data and verifying the secret's at-rest-key dependencies. Changing the Core
   gateway secret can affect TOTP encryption when no separate auth key exists.
6. Verify `/health`, `/api/health`, `/api/gateway/health`, unauthenticated
   session state, authenticated project access, existing 2FA, and rollback.
7. Keep previously disabled Voice production and preview services off until
   their own capacity, consent, and functional acceptance is recorded.

## Deployment safety

Do not force-recreate production containers, rotate keys, delete volumes, run
`docker system prune`, bypass 2FA, or bulk-clear Redis deployment records.
The 2026-10-17 Redis queue snapshot had zero ready/reserved/delayed on `high`
and `default`. Coolify's deployment table had only historical `finished`,
`failed`, and `cancelled-by-user` rows. This did not verify that a *new*
deployment UUID lookup or preview cycle works.

`TASO_GATEWAY_SECRET` must never appear in browser Javascript, diagnostics
output, repository commits, or user-visible logs.
