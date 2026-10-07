#!/usr/bin/env sh
set -eu

URL="${1:-http://127.0.0.1}"

if command -v curl >/dev/null 2>&1; then
  curl -fsS "$URL" >/dev/null
elif command -v wget >/dev/null 2>&1; then
  wget -qO- "$URL" >/dev/null
else
  echo "Neither curl nor wget is available" >&2
  exit 2
fi

echo "HEALTHCHECK PASS: $URL"
