# TASO Disaster Recovery — evidence and safe recovery checklist

**This is a readiness checklist, not a verified production restore.** RPO and RTO are *unmeasured*, not promises.

## Critical recovery boundaries

| Component | Required artifacts | Evidence still required |
|---|---|---|
| Core JSON state | Versioned archive, SHA256 and metadata | Freshness, integrity, isolated restore |
| Coolify config | Exported/secured service configuration, app mappings, encrypted secrets | Independent encrypted off-host copy and restore documentation |
| PostgreSQL | Consistent pg_dump/physical backup and role/extension configuration | Check version compatibility, isolated restore, application connection |
| Critical volumes | Speaker data, Core state, auth/identity and other mounted app volumes | Inventory and point-in-time backup verification |
| Off-site copy | Rclone target, encrypted remote object, checksum and metadata | Read remote content and compare bytes; CI mocks are insufficient |
| Isolated restore | Ephemeral disposable host or container with no production routes | Full dependency smoke test, measured time and integrity |

## Procedure (requires authorized operators)

1. Capture host, Docker and database versions, architecture, critical mounts, backup timestamp and checksum **without logging secrets**.
2. Verify off-site object independently with `scripts/taso-offsite-backup-verify.sh`, only on an authorized read-only replica/host. Never assume remote backups exist merely because rclone is configured.
3. Stage encrypted backup into isolated storage. Keep test environment on separate Docker network and use disposable volumes; do not connect to production database.
4. Validate snapshot schema and checksum with `scripts/taso-backup-verify.sh`. Use `scripts/taso-restore.sh` without `--apply` for dry-run inspection.
5. Restore database/volumes only to disposable infrastructure with approved, isolated credentials. Validate schema migrations, database roles and consistency.
6. Capture actual elapsed recovery duration and latest accepted data timestamp; only then compute evidence-based RTO/RPO.
7. Remove disposable test resources only after exact ownership verification and explicit confirmation that production identifiers are absent. **Never** automate production volume deletion.
8. Record evidence in a redacted JSON manifest using the keys in `docs/taso-dr-evidence-template.json` and run `python3 scripts/taso-dr-evidence-audit.py <manifest.json>`.

## Failure and alert thresholds

- Missing or malformed evidence is FAIL/INCOMPLETE; do not infer readiness.
- A checksum mismatch, missing critical volume, absent PostgreSQL dump or unrecoverable Coolify configuration blocks production DR acceptance.
- Use read-only filesystem and database stats to observe disk/volume pressure. Alert on sustained growth with cooldown/deduplication, not repeated alerts per polling cycle.
- Avoid printing backup bodies, passwords, connection strings, database dumps or live application environment variables.

## Recovery objective status

RPO: **unverified** (requires last recoverable backup timestamp and restore verification). RTO: **unverified** (requires timed end-to-end isolated drill). Target values are not established by this document.

No production restore should occur without approved change control, Core drain/stop and rollback plan.
