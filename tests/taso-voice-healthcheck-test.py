#!/usr/bin/env python3
"""Exercise the Docker healthcheck against an isolated loopback HTTP server."""
import http.server
import pathlib
import re
import subprocess
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCKERFILE = (ROOT / "docker/taso-voice/Dockerfile").read_text(encoding="utf-8")
MATCH = re.search(r'^HEALTHCHECK .* CMD python -c "([^"]+)"$', DOCKERFILE, re.M)


class HealthCheckTests(unittest.TestCase):
    def test_liveness_http_contract(self):
        self.assertIsNotNone(MATCH, "Voice Dockerfile must define Python liveness probe")
        self.assertIn("--start-period=", DOCKERFILE)
        self.assertIn("--timeout=", DOCKERFILE)

        class Handler(http.server.BaseHTTPRequestHandler):
            response_code = 200
            def do_GET(self):
                if self.path != "/health":
                    self.send_response(404)
                else:
                    self.send_response(self.response_code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ready":false,"loading":true}')
            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            command = MATCH.group(1).replace(
                "127.0.0.1:8000", f"127.0.0.1:{server.server_port}"
            )
            self.assertNotEqual(command, MATCH.group(1), "Expected loopback port substitution")
            Handler.response_code = 200
            ok = subprocess.run(["python3", "-c", command], capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stderr)
            Handler.response_code = 503
            bad = subprocess.run(["python3", "-c", command], capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0, "Unhealthy HTTP response must fail")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
