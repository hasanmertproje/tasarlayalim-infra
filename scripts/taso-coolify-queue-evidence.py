#!/usr/bin/env python3
"""Offline, read-only classifier for redacted Coolify deployment history."""
import json
import sys
from collections import Counter

ACTIVE = {"queued", "in progress", "in_progress", "running", "pending"}

def summarize(payload):
    if not isinstance(payload, list):
        raise ValueError("expected list")
    records = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("invalid record")
        state = str(item.get("status", "")).strip().lower()
        trigger = str(item.get("trigger", "")).strip().lower()
        app = str(item.get("application", "")).strip()
        if state not in ACTIVE | {"finished", "failed", "cancelled", "canceled"}:
            raise ValueError("unknown state")
        if trigger not in {"api", "webhook", "manual", "unknown"}:
            raise ValueError("unknown trigger")
        if not app or len(app) > 120:
            raise ValueError("missing application")
        records.append((app, state, trigger))
    counts = Counter((a,s) for a,s,t in records)
    active = {}
    for app, state, trigger in records:
        if state in ACTIVE:
            active.setdefault(app, []).append(trigger)
    return {
        "records": len(records),
        "active_app_count": len(active),
        "backlog_apps": len([a for a,ts in active.items() if len(ts)>1]),
        "api_webhook_collision_apps": sum("api" in ts and "webhook" in ts for ts in active.values()),
        "queued_count": sum(s=="queued" for _,s,_ in records),
        "in_progress_count": sum(s in {"in progress","in_progress","running"} for _,s,_ in records),
    }

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit("usage: python3 scripts/taso-coolify-queue-evidence.py REDACTED_JSON")
    try:
        with open(sys.argv[1], encoding="utf8") as f: result=summarize(json.load(f))
    except (OSError, ValueError, TypeError):
        sys.exit("queue_evidence=INVALID")
    print("queue_evidence=ANALYZED_NOT_PLATFORM_VERIFIED")
    for k,v in result.items(): print(f"{k}={v}")
    if result["backlog_apps"]: sys.exit(2)
