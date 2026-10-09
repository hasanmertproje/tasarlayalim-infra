# Taso Notification Control Plane

Tasarlayalim Infra uses the self-hosted ntfy instance at `https://notify.demo.tasarlayalim.com` as an operational notification plane.

## Purpose

Notifications must answer three questions:

1. What happened?
2. Does the user need to act?
3. Where should the user go next?

Routine progress stays in CI/Taso activity surfaces. Push notifications are reserved for meaningful state transitions and required actions.

## Event classes

| Class | Meaning | Default priority |
| --- | --- | --- |
| `merge_ready` | PR validation passed and human merge is required | high |
| `urgent_fix` | validation/release failed and intervention is required | max |
| `waiting_approval` | HIGH_IMPACT action requires explicit human approval | high |
| `success` | important operation completed successfully | default |
| `in_progress` | informational progress event | low |

GitHub-originated notifications set `NTFY_SOURCE=GitHub` and a logical category such as `ci`, `merge`, or `release`. Taso/Core and deployment events can use their own source/category without mixing semantics.

## Current GitHub lifecycle

`PR -> CI -> MERGE HAZIR -> human merge -> main release gate`

A successful PR CI notification explicitly says **MERGE HAZIR** and links directly to the pull request. A failed PR CI notification says **ACIL DÜZELTME** and links to the failing GitHub Actions run.

A successful main CI run reports **RELEASE GATE GEÇTİ**. It must never claim that production was deployed. Deployment and live-health verification remain separate states.

## Planned deployment lifecycle

After Coolify resource-scoped deployment is configured:

`merge -> affected resource deploy -> health verification -> YAYIN BAŞARILI / MÜDAHALE GEREKİYOR`

Only affected resources should deploy:

- `taso-command-center-v2`: changes under `taso-ui/**`
- `taso-core-v2`: changes under `taso/**`
- `taso-voice`: changes under `docker/taso-voice/**`
- `ntfy`: should not redeploy for unrelated Taso application changes

Legacy `taso-command-center` and `taso-core` resources are not part of the active V2 runtime and should not auto-deploy once this is verified in Coolify.

## Security model

The ntfy server is configured with:

- `auth-file: /var/lib/ntfy/auth.db`
- `auth-default-access: deny-all`
- `enable-login: true`
- `require-login: true`

Anonymous read/write access must remain disabled.

## GitHub Actions secrets

Configure these repository secrets in GitHub. Do not commit their values.

- `NTFY_BASE_URL`
- `NTFY_TOPIC`
- `NTFY_TOKEN`

Missing notification configuration must not break CI.

## Token scope

Use a dedicated ntfy user/token for automation. Grant only the minimum publish access required. Do not reuse an admin token.

Never place the token in repository files, PR comments, chat messages, build logs, or Docker image layers.
