#!/bin/sh
set -eu

STATUS="${1:-unknown}"
TITLE="${TITLE:-Tasarlayalim CI}"
MESSAGE="${MESSAGE:-Status: ${STATUS}}"

if [ -z "${NTFY_BASE_URL:-}" ] || [ -z "${NTFY_TOPIC:-}" ] || [ -z "${NTFY_TOKEN:-}" ]; then
  echo "ntfy notification skipped: required secrets are not configured"
  exit 0
fi

BASE_URL="${NTFY_BASE_URL%/}"
TOPIC="${NTFY_TOPIC#/}"
URL="${BASE_URL}/${TOPIC}"

case "$STATUS" in
  success)
    TAGS="white_check_mark"
    PRIORITY="3"
    ;;
  failure)
    TAGS="x,warning"
    PRIORITY="5"
    ;;
  cancelled)
    TAGS="warning"
    PRIORITY="4"
    ;;
  started|in_progress)
    TAGS="hourglass_flowing_sand"
    PRIORITY="2"
    ;;
  *)
    TAGS="information_source"
    PRIORITY="3"
    ;;
esac

CLICK_URL=""
if [ -n "${GITHUB_SERVER_URL:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  CLICK_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
fi

set -- \
  -fsS \
  --retry 3 \
  --retry-all-errors \
  --connect-timeout 5 \
  --max-time 15 \
  -H "Authorization: Bearer ${NTFY_TOKEN}" \
  -H "Title: ${TITLE}" \
  -H "Tags: ${TAGS}" \
  -H "Priority: ${PRIORITY}"

if [ -n "$CLICK_URL" ]; then
  set -- "$@" -H "Click: ${CLICK_URL}"
fi

curl "$@" --data-binary "$MESSAGE" "$URL" >/dev/null

echo "ntfy notification sent: ${STATUS}"
