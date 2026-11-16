import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import sandbox_prod_drift_check as d


def snap(**kw):
    s = {k: {} for k in d.QUERIES}
    s.update(kw)
    return s


class Drift(unittest.TestCase):
    def test_equal_is_clean(self):
        a = snap(relation={"plm.x": "r"})
        self.assertEqual(d.compare(a, a, {}), {})

    def test_missing_and_changed_reported_sandbox_only_ignored(self):
        prod = snap(relation={"plm.x": "r", "plm.y": "r"}, function={"plm.f()": "h1"})
        sb = snap(relation={"plm.x": "r", "plm.only_sb": "r"}, function={"plm.f()": "h2"})
        out = d.compare(prod, sb, {})
        self.assertEqual(out, {"missing relation": ["plm.y"], "changed function": ["plm.f()"]})

    def test_allowlist_schema_and_pattern(self):
        prod = snap(relation={"dam.a": "r", "plm.keep": "r", "plm.skip_me": "r"})
        out = d.compare(prod, snap(), {"ignore_schemas": ["dam"], "ignore_patterns": ["relation:plm.skip_*"]})
        self.assertEqual(out, {"missing relation": ["plm.keep"]})

    def test_render(self):
        self.assertIn("No drift", d.render({}))
        self.assertIn("missing relation: 1", d.render({"missing relation": ["plm.y"]}))


if __name__ == "__main__":
    unittest.main()
