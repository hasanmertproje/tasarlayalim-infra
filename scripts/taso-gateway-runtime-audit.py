#!/usr/bin/env python3
"""Read-only TASO production gateway alignment audit; never print secrets.

Run on the Docker host. Reads container environment and nginx's effective
substituted configuration in memory, without printing either raw response.
Does not mutate Coolify, Docker, secrets, volumes, or containers.
"""
import json
import re
import subprocess
import sys

CORE = "taso-core-prod"
UI = "taso-ui-prod"
KEY = "TASO_GATEWAY_SECRET"
HEADER = re.compile(r'^\s*proxy_set_header\s+X-Taso-Gateway\s+("[^"]*"|[^;]+)\s*;', re.I | re.M)


def _capture(args):
    proc = subprocess.run(args, capture_output=True, text=True, check=False, timeout=20)
    if proc.returncode:
        raise RuntimeError("container inspection failed")
    return proc.stdout


def env_values(entries, name=KEY):
    values = []
    for item in entries:
        key, sep, value = item.partition("=")
        if sep and key == name:
            values.append(value)
    return values


def audit(core_values, ui_values, effective_nginx):
    # Never return secret values: callers may safely print this result.
    core_present = len(core_values) == 1 and bool(core_values[0].strip())
    ui_present = len(ui_values) == 1 and bool(ui_values[0].strip())
    matches = core_present and ui_present and core_values[0] == ui_values[0]
    headers = [h.strip().strip('"') for h in HEADER.findall(effective_nginx)]
    nginx_ok = core_present and len(headers) == 3 and all(h == core_values[0] for h in headers)
    return {
        "core_gateway_env": "PRESENT" if core_present else "MISSING_OR_DUPLICATED",
        "ui_gateway_env": "PRESENT" if ui_present else "MISSING_OR_DUPLICATED",
        "runtime_env_alignment": "MATCH" if matches else "MISMATCH",
        "nginx_gateway_headers": len(headers),
        "effective_nginx_alignment": "MATCH" if nginx_ok else "MISMATCH",
        "gateway_ready": "YES" if matches and nginx_ok else "NO",
    }


def main():
    try:
        core = json.loads(_capture(["docker", "inspect", "--format", "{{json .Config.Env}}", CORE]))
        ui = json.loads(_capture(["docker", "inspect", "--format", "{{json .Config.Env}}", UI]))
        nginx = _capture(["docker", "exec", UI, "cat", "/etc/nginx/conf.d/default.conf"])
        result = audit(env_values(core), env_values(ui), nginx)
    except (ValueError, RuntimeError, FileNotFoundError, subprocess.TimeoutExpired):
        print("gateway_audit=UNAVAILABLE")
        return 3
    for key, value in result.items():
        print(f"{key}={value}")
    return 0 if result["gateway_ready"] == "YES" else 2


if __name__ == "__main__":
    sys.exit(main())
