#!/usr/bin/env python3
import http.server
import pathlib
import re
import subprocess
import threading
import unittest

DOCKERFILE = (pathlib.Path(__file__).resolve().parents[1] / "docker/taso-search/Dockerfile").read_text()
PROBE = re.search(r'^HEALTHCHECK .* CMD python3 -c "([^"]+)"$', DOCKERFILE, re.M)

class SearchHealthcheckTest(unittest.TestCase):
    def test_probe_is_bounded_and_loopback(self):
        self.assertIsNotNone(PROBE)
        self.assertIn('--timeout=5s', DOCKERFILE)
        self.assertIn('--start-period=30s', DOCKERFILE)
        self.assertIn('127.0.0.1:8080/', PROBE.group(1))

    def test_liveness_statuses(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            response = 200
            def do_GET(self):
                self.send_response(self.response if self.path == "/" else 404)
                self.end_headers()
            def log_message(self, *args): pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            command = PROBE.group(1).replace('127.0.0.1:8080/', f'127.0.0.1:{server.server_port}/')
            for status, expected in [(200, True), (204, True), (503, False)]:
                Handler.response = status
                result = subprocess.run(["python3", "-c", command], capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode == 0, expected, f"{status}: {result.stderr}")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

if __name__ == "__main__":
    unittest.main(verbosity=2)
