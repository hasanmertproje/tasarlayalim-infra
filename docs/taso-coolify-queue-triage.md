# Coolify deployment queue P0 — evidence procedure (read only)

## Evidence as of 2026-10-13

Operator UI at Root Team / localhost / v2-preview shows 30 historical entries for taso-urgent-core, one In progress for 02h27m27s (commit 897b50d) without logs, and multiple queued entries with webhook and API triggers. Six unapplied configuration changes were observed earlier; localhost Ready and proxy Attention required are separate signals.

This establishes **a queue backlog and concurrent producer presence**, not that a specific UUID exists in the database, which worker holds the lock, or whether an API detail 404 is due to a Coolify version defect.

GitHub Urgent Preview previously finished Search deployment but failed on Core `GET /deployments/{uuid}` (HTTP 404). Distinguish queue acceptance (POST), database row visibility (GET), Docker container state, and external UI/TLS proxy independently.

## Read-only investigation checklist

1. Export **redacted** history entries with only `application`, `status`, `trigger`; omit secrets, URLs, IDs or user data. Run `python3 scripts/taso-coolify-queue-evidence.py history.json`. Exit 2 means multiple active/pending entries on an app; it does not authorize cancellation.
2. With approved Coolify API read-only access, compare exact queued UUID from POST result against GET /deployments/{uuid} and GET /deployments (running list only). Run existing `scripts/taso-coolify-deployment-diagnostic.py UUID` securely. 404 plus absence from a *running-only* list is inconclusive.
3. Verify Coolify server version, deployed container image digest, API token team scope, queue-worker/Redis logs and database deployment rows using authorized read-only credentials. Capture only timestamps, status, lookup result and anonymized identifier hashes. **No access to these sources has been established in this mission.**
4. Observe host Docker runtime using `docker ps --format` with service/status fields only and storage pressure using `df -h`; neither proves database deployment completion.
5. Compare API and Webhook sources. Both triggers on the same application indicate possible racing writers, **not** definitive simultaneous execution; confirm enqueue timestamps and scheduler locks first.
6. Check unapplied configuration changes before investigating build mismatch. Do not trigger Deploy again, restart Coolify, cancel queued work or prune Docker without approved incident procedure.
7. Treat proxy Attention required and TLS timeout separately from queue backlog and HTTP 404. These are different failure boundaries.

## Acceptance / required handoff

Record deployment ID lookup status, queue state, server version, worker log status, Redis/job state, database row status, Docker state and externally observed /health. Mark each **observed**, **inferred** or **unavailable**. A long In progress with no logs is an alert for a possibly stalled worker; it is not sufficient to assert a worker process failure.

Production recovery, queue drains, configuration application and worker restarts require separate operator approval.
