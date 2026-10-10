# Taso Recovery V1

This runbook covers the durable Taso Core snapshot only. It does not claim to back up external repositories, Coolify, DNS, provider accounts, or third-party services.

## Protected state

Production Core defaults to:

```text
/data/taso-state.json
```

The snapshot currently contains project registry, project manifests, milestones, project knowledge, missions (including execution checkpoints/artifacts/handoffs), mission events, and conversations.

Core writes this file using a temporary file followed by an atomic rename. `scripts/taso-backup.sh` copies the currently visible inode, validates the JSON schema, compresses it, generates SHA-256 integrity metadata, and can replicate the result off-server.

## Recovery objectives

Initial operational target:

- scheduled state backup: at least daily; hourly is preferred while Taso is actively changing
- local retention default: 14 days
- off-server copy: required for production
- restore drill: at least monthly and after material persistence/schema changes
- deletion of backup/state/production volume: HIGH IMPACT and requires explicit approval

These are operational targets, not guarantees. RPO/RTO must be measured from actual schedules and restore drills.

## Backup

```bash
TASO_STATE_FILE=/data/taso-state.json \
TASO_BACKUP_DIR=/backups/taso \
TASO_BACKUP_RETENTION_DAYS=14 \
./scripts/taso-backup.sh
```

The command prints the created `.json.gz` archive path. Sidecars:

- `.sha256` — integrity checksum
- `.meta` — timestamp, source path, host tag, archive name and checksum; no secrets

### Off-server replication

Install and configure `rclone` outside Git, then set a remote destination:

```bash
TASO_BACKUP_REMOTE='r2:taso-production/backups' ./scripts/taso-backup.sh
```

When `TASO_BACKUP_REMOTE` is configured, a missing/failing `rclone` transfer makes the backup command fail rather than falsely reporting off-server success.

Credentials must remain outside this repository.

## Verify

Every backup can be checked independently:

```bash
./scripts/taso-backup-verify.sh /backups/taso/taso-state-YYYYMMDDTHHMMSSZ-host.json.gz
```

Verification checks:

1. SHA-256 sidecar
2. gzip integrity
3. JSON parsing
4. required top-level state arrays

A file that merely exists is not considered a valid backup.

## Restore drill — safe default

A restore command is verify-only unless `--apply` is supplied:

```bash
./scripts/taso-restore.sh /backups/taso/taso-state-....json.gz
```

This does not modify production.

For a real restore:

1. Confirm incident scope and selected restore point.
2. Obtain explicit HIGH IMPACT production approval.
3. Stop or drain Taso Core so it cannot overwrite the restored state during replacement.
4. Verify the backup.
5. Apply with the explicit environment interlock:

```bash
TASO_RESTORE_APPROVED=YES \
TASO_STATE_FILE=/data/taso-state.json \
./scripts/taso-restore.sh --apply /backups/taso/taso-state-....json.gz
```

Before replacement the script creates a compressed `pre-restore-*` safety copy of the current state when one exists. The replacement itself is atomic.

6. Restart Core.
7. Verify health through the normal gateway.
8. Verify projects, missions, knowledge and at least one known durable checkpoint/mission history record.
9. Reopen traffic only after verification.

## Scheduling example

Schedule on the trusted host/container environment that can read the Core state and the configured off-server credentials. Example cron (hourly at minute 17):

```cron
17 * * * * TASO_STATE_FILE=/data/taso-state.json TASO_BACKUP_DIR=/backups/taso TASO_BACKUP_REMOTE='r2:taso-production/backups' /opt/taso/scripts/taso-backup.sh >>/var/log/taso-backup.log 2>&1
```

Do not commit actual remote credentials or tokens into cron files tracked by Git.

## Alerting

Backup command failure should be connected to the existing notification path (ntfy today) by the host scheduler/service manager. A success notification should only be emitted after local validation and, when configured, successful off-server replication.

## What V1 does not cover

- Git repositories: GitHub remains their authoritative source; separate repository export policy may be added later.
- Coolify configuration/database: requires its own platform backup/export procedure.
- application databases/storage belonging to projects managed by Taso: each project needs its own database/upload backup policy.
- DNS/domain/provider accounts: external-service recovery information belongs in project runbooks, not in the Taso Core snapshot.

## Drill evidence

For each restore drill, record outside the production snapshot:

- backup timestamp and checksum
- drill date
- restore target/environment
- verification results
- measured restore time
- gaps found and corrective action

A backup without a successful restore drill is incomplete.
