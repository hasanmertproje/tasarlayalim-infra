#!/usr/bin/env bash
set -euo pipefail
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/bin"
cat > "$workspace/bin/df" <<'MOCK'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
case "${TEST_DF_MODE:-ok}" in
  ok) printf '/dev/test 10000000 4500000 5500000 45%% /\n' ;;
  full) printf '/dev/test 10000000 9300000 700000 93%% /\n' ;;
  low) printf '/dev/test 10000000 8500000 1500000 85%% /\n' ;;
  invalid) printf '/dev/test unusable metric data xx%% /\n' ;;
esac
MOCK
chmod +x "$workspace/bin/df"
base="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DF_MODE=ok PATH="$workspace/bin:$PATH" TASO_CAPACITY_MAX_PERCENT=90 TASO_CAPACITY_MIN_FREE_MB=2048 bash "$base/taso-capacity-guard.sh" | grep -q 'PASS:'
if TEST_DF_MODE=full PATH="$workspace/bin:$PATH" TASO_CAPACITY_MAX_PERCENT=90 bash "$base/taso-capacity-guard.sh" >/dev/null 2>&1; then
  echo 'FAIL: full disk was accepted' >&2; exit 1
fi
if TEST_DF_MODE=low PATH="$workspace/bin:$PATH" TASO_CAPACITY_MIN_FREE_MB=2048 bash "$base/taso-capacity-guard.sh" >/dev/null 2>&1; then
  echo 'FAIL: low remaining free space was accepted' >&2; exit 1
fi
if TEST_DF_MODE=invalid PATH="$workspace/bin:$PATH" bash "$base/taso-capacity-guard.sh" >/dev/null 2>&1; then
  echo 'FAIL: invalid metrics were accepted' >&2; exit 1
fi
echo 'PASS: capacity guard blocks full, low-free and invalid filesystems'
