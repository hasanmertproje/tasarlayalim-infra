import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / "scripts/taso-gateway-runtime-audit.py"
spec = importlib.util.spec_from_file_location("gateway_audit", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def effective(value):
    return "\n".join(
        'proxy_set_header X-Taso-Gateway "' + value + '";'
        for _ in range(3)
    )


class GatewayAuditTests(unittest.TestCase):
    def test_valid_runtime_alignment(self):
        state = module.audit(["sample-gateway"], ["sample-gateway"], effective("sample-gateway"))
        self.assertEqual(state["gateway_ready"], "YES")
        self.assertEqual(state["effective_nginx_alignment"], "MATCH")

    def test_ui_mismatch_cannot_look_healthy(self):
        state = module.audit(["sample-gateway"], ["different"], effective("different"))
        self.assertEqual(state["gateway_ready"], "NO")
        self.assertEqual(state["runtime_env_alignment"], "MISMATCH")
        self.assertNotIn("sample-gateway", str(state))
        self.assertNotIn("different", str(state))

    def test_effective_config_stale_even_if_env_matches(self):
        state = module.audit(["sample-gateway"], ["sample-gateway"], effective("old-secret"))
        self.assertEqual(state["gateway_ready"], "NO")
        self.assertEqual(state["effective_nginx_alignment"], "MISMATCH")

    def test_missing_duplicate_and_unexpanded_secrets(self):
        self.assertEqual(module.env_values(["A=1", "TASO_GATEWAY_SECRET=x", "A=2"]), ["x"])
        self.assertEqual(module.audit([], [], effective(""))["gateway_ready"], "NO")
        self.assertEqual(module.audit(["x", "y"], ["x"], effective("x"))["gateway_ready"], "NO")
        self.assertEqual(module.audit(["x"], ["x"], effective("$"+"{TASO_GATEWAY_SECRET}"))["gateway_ready"], "NO")

    def test_requires_all_three_nginx_headers(self):
        state = module.audit(["a"], ["a"], 'proxy_set_header X-Taso-Gateway "a";')
        self.assertEqual(state["nginx_gateway_headers"], 1)
        self.assertEqual(state["gateway_ready"], "NO")


if __name__ == "__main__":
    unittest.main()
