import importlib.util
import pathlib
import unittest
p=pathlib.Path(__file__).resolve().parents[1]/"scripts/taso-coolify-queue-evidence.py"
s=importlib.util.spec_from_file_location("queue",p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class QueueTests(unittest.TestCase):
    def test_api_webhook_overlap(self):
        result=m.summarize([{"application":"urgent-core","status":"In progress","trigger":"Webhook"},{"application":"urgent-core","status":"Queued","trigger":"API"}])
        self.assertEqual(result["api_webhook_collision_apps"],1)
        self.assertEqual(result["backlog_apps"],1)
    def test_different_apps_not_same_backlog(self):
        result=m.summarize([{"application":"a","status":"queued","trigger":"api"},{"application":"b","status":"queued","trigger":"webhook"}])
        self.assertEqual(result["backlog_apps"],0)
    def test_completed_no_backlog(self):
        result=m.summarize([{"application":"urgent-core","status":"finished","trigger":"api"},{"application":"urgent-core","status":"queued","trigger":"webhook"}])
        self.assertEqual(result["backlog_apps"],0)
    def test_reject_untrusted_state(self):
        with self.assertRaises(ValueError): m.summarize([{"application":"x","status":"raw-secret","trigger":"api"}])
if __name__=="__main__": unittest.main(verbosity=2)
