# ntfy notifications

Tasarlayalim Infra uses the self-hosted ntfy instance at `https://notify.demo.tasarlayalim.com` for operational notifications.

## Security model

The ntfy server is configured with:

- `auth-file: /var/lib/ntfy/auth.db`
- `auth-default-access: deny-all`
- `enable-login: true`
- `require-login: true`

Anonymous read/write access must remain disabled.

## GitHub Actions secrets

Configure these repository secrets in GitHub. Do not commit their values.

- `NTFY_BASE_URL` = `https://notify.demo.tasarlayalim.com`
- `NTFY_TOPIC` = the private CI topic name, for example `agent-ci`
- `NTFY_TOKEN` = an ntfy access token that can publish to that topic

The workflow intentionally skips notifications when any secret is absent, so missing notification configuration does not break CI.

## Notification behavior

The workflow sends:

- CI started
- CI success
- CI failure
- CI cancelled

Failure notifications use a higher ntfy priority. GitHub Actions run links are attached via the ntfy `Click` header.

## Token scope

Use a dedicated ntfy user/token for automation. Grant it only the minimum topic access required for publishing CI/deploy notifications. Do not reuse an admin token in GitHub Actions.

## Secret handling

Never paste the ntfy token into:

- repository files
- issue/PR comments
- chat messages
- build logs
- Docker image layers

Store the token only in GitHub Actions Secrets and, where needed, Coolify secret environment variables.
