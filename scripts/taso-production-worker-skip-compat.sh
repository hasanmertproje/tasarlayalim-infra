#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
set +x

# Thin entry point for the production compatibility chain. The Search guard is applied
# by scripts/taso-production-ui-retry-compat.sh inside its new_browser block, and
# Browser keeps its own deploy_browser_for_release guard, so this wrapper no longer
# patches the deployment plan itself and avoids breaking the ui-retry patch chain.
exec bash scripts/taso-production-ui-retry-compat.sh
