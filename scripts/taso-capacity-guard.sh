#!/usr/bin/env bash
# Read-only capacity gate. Non-zero if configured headroom is unsafe.
set -euo pipefail
target="${TASO_CAPACITY_PATH:-/}"
max_usage="${TASO_CAPACITY_MAX_PERCENT:-90}"
min_free_mb="${TASO_CAPACITY_MIN_FREE_MB:-2048}"
for number in "$max_usage" "$min_free_mb"; do
  if ! [[ "$number" =~ ^[0-9]+$ ]]; then
    echo "ERROR: capacity thresholds must be non-negative integers" >&2
    exit 2
  fi
done
if ((max_usage > 100)); then
  echo "ERROR: TASO_CAPACITY_MAX_PERCENT must be at most 100" >&2
  exit 2
fi
if ! test -d "$target"; then
  echo "ERROR: capacity path is not a directory: $target" >&2
  exit 2
fi
metrics="$(df -Pk -- "$target" | awk 'NR==2 {gsub(/%/,"",$5); print $2, $3, $4, $5}')"
read -r total used free percent <<< "$metrics"
for number in "$total" "$used" "$free" "$percent"; do
  if ! [[ "$number" =~ ^[0-9]+$ ]]; then
    echo "ERROR: capacity probe returned invalid filesystem metrics" >&2
    exit 2
  fi
done
free_mb=$((free / 1024))
echo "capacity path=$target usage=${percent}% free=${free_mb}MiB max_usage=${max_usage}% min_free=${min_free_mb}MiB"
if ((percent >= max_usage || free_mb < min_free_mb)); then
  echo "FAIL: disk capacity below safe deployment headroom; no cleanup is performed" >&2
  exit 1
fi
echo "PASS: sufficient disk headroom"
