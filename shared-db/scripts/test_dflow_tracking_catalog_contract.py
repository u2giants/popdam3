import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import production_catalog_verification as verifier


VERSION = "20261024234538"
MIGRATION = ROOT / "supabase/migrations/20261024234538_dflow_prod_link_reland.sql"
EXPECTED_MIGRATION_SHA256 = "98210290dca92fbbf9b8a995c4bbc13e8bd6af22d88e6ff8eb75c73984640d04"


class DflowTrackingCatalogContractTests(unittest.TestCase):
    def test_sidecar_is_exactly_bound_to_canonical_migration(self):
        digest = hashlib.sha256(MIGRATION.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        self.assertEqual(digest, EXPECTED_MIGRATION_SHA256)
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            migration = repo / f"supabase/migrations/{VERSION}_dflow_prod_link_reland.sql"
            migration.parent.mkdir(parents=True)
            migration.write_bytes(MIGRATION.read_bytes())
            sidecar = repo / f"scripts/production-verification-sidecars/{VERSION}.json"
            sidecar.parent.mkdir(parents=True)
            sidecar.write_text(json.dumps({
                "schema_version": 1,
                "migration_version": VERSION,
                "migration_sha256": EXPECTED_MIGRATION_SHA256,
                "checks": [{
                    "id": "dflow_tracking_catalog",
                    "kind": "catalog_contract",
                    "contract": "dflow_tracking_catalog_v1",
                    "expected_count": 1,
                }],
            }) + "\n")
            loaded = verifier.load_behavior_sidecars(repo, {VERSION: migration}, [VERSION])
            self.assertEqual([item["id"] for item in loaded], ["dflow_tracking_catalog"])
            self.assertEqual(loaded[0]["migration_sha256"], EXPECTED_MIGRATION_SHA256)

    def test_missing_or_malformed_sidecar_is_rejected_when_present(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            (repo / "scripts/production-verification-sidecars").mkdir(parents=True)
            (repo / "supabase/migrations").mkdir(parents=True)
            migration = repo / "supabase/migrations/m.sql"
            migration.write_bytes(MIGRATION.read_bytes())
            # Sidecars are optional for historical allowlist entries; the
            # contract is enforced once this exact sidecar is present.
            self.assertEqual(verifier.load_behavior_sidecars(repo, {VERSION: migration}, [VERSION]), [])
            sidecar = repo / f"scripts/production-verification-sidecars/{VERSION}.json"
            sidecar.write_text("{ malformed\n")
            with self.assertRaises(verifier.GuardError):
                verifier.load_behavior_sidecars(repo, {VERSION: migration}, [VERSION])

    def test_contract_covers_view_shape_definition_and_access(self):
        sql = verifier.CATALOG_CONTRACTS["dflow_tracking_catalog_v1"]
        self.assertTrue(sql.lstrip().lower().startswith("select"))
        self.assertNotIn(";", sql)
        for fragment in (
            "pg_get_viewdef",
            "security_invoker=true",
            "prod_order_header_id_uidx",
            "designflow_prod_tracking_grants",
            "coldlion_history_tracking_read",
            "designflow_prod_tracking_runtime",
            "anon",
            "authenticated",
            "service_role",
            "prod_order_header_id:integer",
        ):
            self.assertIn(fragment, sql)
        objects = verifier.catalog_contract_objects(sql)
        self.assertIn("relation:dflow_prod.v_prod_order_sales_order_link", objects)
        self.assertIn("relation:dflow_prod.prod_order_header_id_uidx", objects)

    @unittest.skipUnless(os.environ.get("DFLOW_TRACKING_CATALOG_DOCKER") == "1", "set DFLOW_TRACKING_CATALOG_DOCKER=1 for disposable PostgreSQL fixture")
    def test_pg17_fixture_rejects_rls_policy_grant_and_definition_mutations(self):
        container = f"dflow-tracking-catalog-test-{uuid.uuid4().hex[:12]}"
        contract = verifier.CATALOG_CONTRACTS["dflow_tracking_catalog_v1"]

        bootstrap = """
create schema dflow_prod; create schema coldlion;
create role designflow_prod_tracking_grants nologin nosuperuser nocreatedb nocreaterole;
create role designflow_prod_tracking_runtime login password 'runtime';
create role designflow_prod_backend_runtime login password 'backend';
grant designflow_prod_tracking_grants to designflow_prod_tracking_runtime;
grant designflow_prod_tracking_grants to designflow_prod_backend_runtime;
create table dflow_prod."ProdOrderHeader" (id integer, "prodOrderNo" varchar, "prodReferenceNo" varchar, "companyCode" varchar, "prodOrderDate" varchar, "createdTime" timestamptz);
create table coldlion.order_history_line (sales_order_no bigint, po_number text, prod_reference_no text, customer_code text, fetched_at timestamptz, company_code text, created_time timestamptz, start_date date, cancel_date date);
create table coldlion.prod_history_line (prod_order_no bigint, prod_reference_no text, cust_po_number text, customer_code text, fetched_at timestamptz, company_code text);
alter table coldlion.order_history_line enable row level security;
alter table coldlion.prod_history_line enable row level security;
create index order_history_sales_idx on coldlion.order_history_line (sales_order_no);
create index prod_history_order_idx on coldlion.prod_history_line (prod_order_no);
create role anon; create role authenticated; create role service_role;
"""

        def run(args, *, input_text=None):
            return subprocess.run(args, input=input_text, text=True, capture_output=True, check=True)

        def psql(sql):
            return run(["docker", "exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "postgres"], input_text=sql).stdout.strip()

        run(["docker", "run", "--name", container, "-e", "POSTGRES_PASSWORD=localtest", "-d", "postgres:17"])
        try:
            for _ in range(30):
                if subprocess.run(["docker", "exec", container, "pg_isready", "-U", "postgres"], capture_output=True).returncode == 0:
                    break
                subprocess.run(["sleep", "1"], check=True)
            else:
                self.fail("disposable PostgreSQL fixture did not become ready")
            psql(bootstrap)
            psql(MIGRATION.read_text())

            def passed():
                return psql(contract).splitlines()[-1] == "t"

            self.assertTrue(passed())
            psql("alter table coldlion.order_history_line disable row level security;")
            self.assertFalse(passed())
            psql("alter table coldlion.order_history_line enable row level security;")
            psql("drop policy coldlion_history_tracking_read on coldlion.order_history_line; create policy coldlion_history_tracking_read on coldlion.order_history_line for select to designflow_prod_tracking_grants using (false);")
            self.assertFalse(passed())
            psql("drop policy coldlion_history_tracking_read on coldlion.order_history_line; create policy coldlion_history_tracking_read on coldlion.order_history_line for select to designflow_prod_tracking_grants using (true);")
            psql("grant select on coldlion.order_history_line to designflow_prod_tracking_grants with grant option;")
            self.assertFalse(passed())
            psql("revoke all on coldlion.order_history_line from designflow_prod_tracking_grants; grant select on coldlion.order_history_line to designflow_prod_tracking_grants;")
            psql('drop index dflow_prod.prod_order_header_id_uidx; create index prod_order_header_id_uidx on dflow_prod."ProdOrderHeader"(id);')
            self.assertFalse(passed())
            psql('drop index dflow_prod.prod_order_header_id_uidx;')
            psql(MIGRATION.read_text())
            self.assertTrue(passed())
            source = MIGRATION.read_text()
            body = source.split("create or replace view dflow_prod.v_prod_order_sales_order_link", 1)[1].split("comment on view", 1)[0]
            psql("create or replace view dflow_prod.v_prod_order_sales_order_link" + body.replace("interval '300 days'", "interval '301 days'", 1))
            self.assertFalse(passed())
            psql(MIGRATION.read_text())
            self.assertTrue(passed())
        finally:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True, check=False)


if __name__ == "__main__":
    unittest.main()
