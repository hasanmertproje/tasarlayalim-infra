# Coolify deployment UUID diagnostics (read-only)

## Symptom and evidence boundary

Urgent Preview returned a deployment UUID from POST /api/v1/deploy, followed by repeated HTTP 404 "Deployment not found" from GET /api/v1/deployments/{uuid}. Six retries did not fix PR #179's actual preview, so eventual consistency alone is **not established**.

Coolify's documented endpoints are POST /api/v1/deploy?uuid=<application-id>, GET /api/v1/deployments/{deployment-id} and GET /api/v1/deployments (running-only list). Coolify upstream issue #8925 reported a similar per-UUID lookup bug on a particular version, but the TASO server version and provenance are unverified; don't attribute this incident without direct evidence.

## Safe read-only investigation

1. Determine deployed Coolify version and check the reverse-proxy and Coolify application logs with authorized read-only access (no token values, response bodies, or environment variable dumps).
2. Run the diagnostics command in a trusted environment with **existing** read-only Coolify token configuration:

   `COOLIFY_BASE_URL=https://coolify.tasarlayalim.com COOLIFY_API_TOKEN=<from-secret-store> python3 scripts/taso-coolify-deployment-diagnostic.py <deployment-uuid>`

3. Compare exact deployment_uuid with the POST response. Record HTTP classification and timestamp only.
4. If `lookup_404_but_visible_in_running_list`, investigate Coolify version and team-scoped GET behavior, not the application health endpoint.
5. If `lookup_404_not_in_running_list_inconclusive`, investigate queue ingestion, team scope, transient execution, cancellation, and platform database before attributing cause. Running-only list absence is not proof of no deployment.
6. If 401/403, verify token's required scope without printing or rotating its value. TLS errors are separate from HTTP 404: capture generic connection failure and verify CA/handshake through approved tooling.
7. Do not redeploy production, restart Coolify, prune the Docker daemon, clear volumes, or change credentials as part of diagnosis.

## Preview isolation and concurrency design gate

The workflow currently uses a global `taso-urgent-preview` concurrency group with `cancel-in-progress: true` and a **shared** `taso-urgent.demo.tasarlayalim.com` domain, app names, Core data volume and mutable Git branch mapping. Simply changing the concurrency group to PR-scoped would be **unsafe**: unrelated PRs could mutate the same preview resources concurrently.

The coordinated fix must first ensure distinct, bounded PR-specific app names, storage mounts, internal aliases, hostname, and cleanup lifecycle with exact ownership checks. Only then change the concurrency group to `taso-urgent-preview-${{ github.event.pull_request.number }}`. Preview cleanup must only delete resources with an exact PR ownership tag after safety checks and should never delete shared or production resources. This is not implemented by the current diagnostic tool.

## Acceptance

- GitHub unit tests classify 200, 401/403, mismatched UUID and 404/list divergence without reaching Coolify.
- Platform root cause remains **UNVERIFIED** until real Coolify read-only evidence is captured.
- No success can be inferred from image build, a queued deployment, an HTTP 404 retry, or an unverified worker status.
- Use explicit authorization for any production-impacting operation; this runbook requires none.
