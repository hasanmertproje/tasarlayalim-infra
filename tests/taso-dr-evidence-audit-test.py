import importlib.util
import pathlib
import unittest
path=pathlib.Path(__file__).resolve().parents[1]/"scripts/taso-dr-evidence-audit.py"
spec=importlib.util.spec_from_file_location("audit",path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class EvidenceTests(unittest.TestCase):
    def test_empty_is_incomplete(self):
        ok,issues=mod.audit({"components":{}})
        self.assertFalse(ok)
        self.assertIn("postgresql:missing",issues)
    def test_missing_evidence_rejected(self):
        rows={k:{"status":"verified"} for k in mod.REQUIRED}
        ok,issues=mod.audit({"components":rows})
        self.assertFalse(ok)
        self.assertIn("postgresql:missing_evidence",issues)
    def test_full_verified_with_references(self):
        rows={k:{"status":"verified","evidence_ref":"approved-ticket","checked_at":"2026-10-13"} for k in mod.REQUIRED}
        self.assertEqual(mod.audit({"components":rows}),(True,[]))
    def test_unverified_not_success(self):
        rows={k:{"status":"verified","evidence_ref":"ticket","checked_at":"2026-10-13"} for k in mod.REQUIRED}
        rows["offsite_copy"]={"status":"unverified"}
        self.assertFalse(mod.audit({"components":rows})[0])

if __name__=="__main__":
    unittest.main(verbosity=2)
