import importlib.util
import pathlib
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1] / "scripts/taso-coolify-deployment-diagnostic.py"
spec = importlib.util.spec_from_file_location("diagnostic", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
    def check(self, calls, expected):
        with patch.object(mod, "fetch", side_effect=calls) as f:
            self.assertEqual(mod.diagnose("https://example.invalid", "secret", "abcdefghi123"), expected)
            self.assertEqual(f.call_count, len(calls))

    def test_lookup_ok(self):
        self.check([(200, {"deployment_uuid": "abcdefghi123"})], "lookup_ok")

    def test_lookup_404_visible_in_list(self):
        self.check([(404, None), (200, [{"deployment_uuid": "abcdefghi123"}])], "lookup_404_but_visible_in_running_list")

    def test_lookup_404_absent_not_definitive(self):
        self.check([(404, None), (200, [])], "lookup_404_not_in_running_list_inconclusive")

    def test_unauthorized(self):
        self.check([(403, None)], "lookup_auth_or_team_scope_denied")

    def test_mismatched_uuid_rejected(self):
        self.check([(200, {"deployment_uuid": "other"})], "lookup_contract_mismatch")

    def test_invalid_uuid_never_sent(self):
        with patch.object(mod, "fetch") as f:
            with self.assertRaises(ValueError):
                mod.diagnose("https://example.invalid", "secret", "../../secrets")
            f.assert_not_called()

if __name__ == "__main__":
    unittest.main(verbosity=2)
