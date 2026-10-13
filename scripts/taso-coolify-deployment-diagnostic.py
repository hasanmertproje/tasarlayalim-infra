#!/usr/bin/env python3
"""Read-only Coolify deployment lookup diagnostic. No deployment mutations."""
from __future__ import annotations
import json
import os
import re
import sys
import urllib.error
import urllib.request

def fetch(base: str, token: str, path: str) -> tuple[int, object | None]:
    req = urllib.request.Request(base.rstrip("/") + "/api/v1/" + path, headers={
        "Authorization": "Bearer " + token, "Accept": "application/json",
    }, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RuntimeError("Coolify connection/TLS failure (details intentionally suppressed)") from None

def diagnose(base: str, token: str, uuid: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9-]{8,100}", uuid):
        raise ValueError("invalid deployment UUID")
    status, detail = fetch(base, token, "deployments/" + uuid)
    if status == 200:
        if not isinstance(detail, dict) or detail.get("deployment_uuid") != uuid:
            return "lookup_contract_mismatch"
        return "lookup_ok"
    if status in (401, 403):
        return "lookup_auth_or_team_scope_denied"
    if status != 404:
        return "lookup_http_error_" + str(status)
    list_status, rows = fetch(base, token, "deployments")
    if list_status in (401, 403):
        return "list_auth_or_team_scope_denied"
    if list_status != 200 or not isinstance(rows, list):
        return "list_unavailable_or_invalid"
    if any(isinstance(row, dict) and row.get("deployment_uuid") == uuid for row in rows):
        return "lookup_404_but_visible_in_running_list"
    # /deployments lists *running* deployments, not a full audit trail.
    return "lookup_404_not_in_running_list_inconclusive"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/taso-coolify-deployment-diagnostic.py DEPLOYMENT_UUID")
    base = os.environ.get("COOLIFY_BASE_URL", "")
    token = os.environ.get("COOLIFY_API_TOKEN", "")
    if not base.startswith("https://") or not token:
        sys.exit("ERROR: HTTPS COOLIFY_BASE_URL and COOLIFY_API_TOKEN are required")
    try:
        result = diagnose(base, token, sys.argv[1])
        print("coolify_deployment_diagnostic=" + result)
        sys.exit(0 if result == "lookup_ok" else 1)
    except (ValueError, RuntimeError) as error:
        sys.exit("ERROR: " + str(error))
