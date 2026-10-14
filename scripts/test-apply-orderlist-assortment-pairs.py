import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("a20", Path(__file__).with_name("apply-orderlist-assortment-pairs.py"))
a20 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a20)


def entry(i):
    return {"target_po": "D1", "customer_po": "c", "coldlion_so": "COLDLION-SO-1", "sku": f"s{i}", "quantity": "1",
            "google_source_id": f"order:row:{i}", "set": {"start_ship_date": "2026-10-20", "start_ship_raw": "10/20/2026",
            "cancel_date": "2026-10-20", "cancel_raw": "10/20/2026", "cargo_forecast_date": "2026-10-13"}}


class PlanTests(unittest.TestCase):
    def write(self, plan):
        f = tempfile.NamedTemporaryFile("wb", delete=False, suffix=".json"); raw = json.dumps(plan).encode(); f.write(raw); f.close()
        return Path(f.name), hashlib.sha256(raw).hexdigest()

    def test_exact_plan_loads(self):
        path, sha = self.write({"schema": a20.PLAN_SCHEMA, "entries": [entry(i) for i in range(20)]})
        self.assertEqual(len(a20.load_plan(path, sha)["entries"]), 20)

    def test_refusals(self):
        bad = [
            {"schema": a20.PLAN_SCHEMA, "entries": [entry(i) for i in range(19)]},
            {"schema": "x", "entries": [entry(i) for i in range(20)]},
            {"schema": a20.PLAN_SCHEMA, "entries": [entry(0)] * 20},
            {"schema": a20.PLAN_SCHEMA, "entries": [dict(entry(i), extra=1) for i in range(20)]},
            {"schema": a20.PLAN_SCHEMA, "entries": [dict(entry(i), set=dict(entry(i)["set"], cancel_date="10/20")) for i in range(20)]},
        ]
        for plan in bad:
            path, sha = self.write(plan)
            with self.assertRaises((a20.Refused, ValueError)):
                a20.load_plan(path, sha)
        path, _ = self.write({"schema": a20.PLAN_SCHEMA, "entries": [entry(i) for i in range(20)]})
        with self.assertRaisesRegex(a20.Refused, "checksum"):
            a20.load_plan(path, "0" * 64)

    def test_google_ref_uuid_matches_consolidation_identity(self):
        spec2 = importlib.util.spec_from_file_location("c", Path(__file__).with_name("consolidate-orderlist-matches.py"))
        self.assertEqual(a20.google_ref_uuid("order:row:12456"),
                         str(__import__("uuid").uuid5(__import__("uuid").NAMESPACE_URL, "popdam-orderlist-google-line-ref:order:row:12456")))


if __name__ == "__main__":
    unittest.main()
