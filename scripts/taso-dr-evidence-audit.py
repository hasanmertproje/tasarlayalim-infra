#!/usr/bin/env python3
"""Review a redacted DR evidence manifest without connecting to production."""
import json
import pathlib
import sys

REQUIRED = {
    "core_state", "coolify_config", "postgresql", "critical_volumes",
    "offsite_copy", "isolated_restore",
}
def audit(data):
    if not isinstance(data, dict) or not isinstance(data.get("components"), dict):
        return False, ["manifest_invalid"]
    issues = []
    for name in sorted(REQUIRED):
        item = data["components"].get(name)
        if not isinstance(item, dict):
            issues.append(name + ":missing")
            continue
        if item.get("status") not in ("verified", "unverified", "not_configured"):
            issues.append(name + ":invalid_status")
        if item.get("status") == "verified":
            if not item.get("evidence_ref") or not item.get("checked_at"):
                issues.append(name + ":missing_evidence")
    return not issues and all(data["components"][name]["status"] == "verified" for name in REQUIRED), issues

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: dr-evidence-audit.py MANIFEST.json")
    try:
        data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf8"))
        ok, issues = audit(data)
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("dr_evidence=FAIL manifest_unreadable_or_invalid")
    # Do not print operator references or secrets from the input document.
    print("dr_evidence=" + ("PASS" if ok else "INCOMPLETE"))
    for issue in issues:
        print("issue=" + issue)
    if not ok:
        sys.exit(1)
