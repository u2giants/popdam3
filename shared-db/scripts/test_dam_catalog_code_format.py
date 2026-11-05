"""Exercise the real #5696 migration in an isolated, resource-bounded PostgreSQL."""
import json
import re
import selectors
import time
import os
import pathlib
import subprocess
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20261105144622_dam_catalog_code_format.sql"


def wait_line(stream,expected,timeout=3):
    selector=selectors.DefaultSelector();buffer=b'';deadline=time.monotonic()+timeout
    try:
        os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ)
        while b'\n' not in buffer:
            remaining=deadline-time.monotonic()
            if remaining<=0 or not selector.select(timeout=remaining):raise TimeoutError('owned lock readiness deadline expired')
            chunk=os.read(stream.fileno(),4096)
            if not chunk:raise RuntimeError('owned locker exited before readiness')
            buffer+=chunk
        if buffer.split(b'\n',1)[0].decode()!=expected:raise RuntimeError('unexpected owned locker readiness')
    finally:selector.close()


class NormalizerLiteralContract(unittest.TestCase):
    def test_lock_readiness_has_finite_deadline_without_output(self):
        reader,writer=os.pipe()
        try:
            with os.fdopen(reader,'rb') as stream:
                with self.assertRaises(TimeoutError):wait_line(stream,'lock-ready',.05)
        finally:os.close(writer)

    def test_every_migration_translate_literal_is_exact_ascii_mapping(self):
        pairs=re.findall(r"translate\([^,]+,\s*'([^']*)',\s*'([^']*)'",MIGRATION.read_text())
        self.assertEqual(len(pairs),3)
        for source,target in pairs:
            self.assertEqual(source,'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
            self.assertEqual(target,'A'*52+'9'*10)
            self.assertEqual(len(source),len(target))


@unittest.skipUnless(os.environ.get("DAM_CODE_FORMAT_DOCKER") == "1", "explicit isolated Docker drill required")
class CatalogCodeFormat(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = "vb-format-" + uuid.uuid4().hex[:12]
        subprocess.run(["docker", "run", "-d", "--network", "none", "--cpus", "1",
                        "--memory", "256m", "--name", cls.container,
                        "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"],
                       check=True, capture_output=True)
        cls.addClassCleanup(lambda: subprocess.run(["docker", "rm", "-f", cls.container], capture_output=True))
        subprocess.run(["docker", "exec", cls.container, "sh", "-c",
                        'until [ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres >/dev/null 2>&1; do sleep 0.1; done'],
                       check=True, timeout=20)
        cls.run_sql("""CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE ROLE service_role BYPASSRLS;
            CREATE TABLE public.style_groups(sku text PRIMARY KEY, payload text, folder_path text);
            ALTER TABLE public.style_groups ENABLE ROW LEVEL SECURITY;
            GRANT SELECT ON public.style_groups TO service_role;
            INSERT INTO public.style_groups(sku,payload) VALUES ('abc12defg34','fixture');
            INSERT INTO public.style_groups(sku,payload)
              SELECT 'ABC12DEFG'||lpad(n::text,6,'0'),repeat('x',200)
              FROM generate_series(1,10000) n;
        """)
        cls.security_before = cls.run_sql("SELECT json_build_array(relrowsecurity,relforcerowsecurity,relacl::text) FROM pg_class WHERE oid='public.style_groups'::regclass").stdout
        cls.run_sql(MIGRATION.read_text())

    @classmethod
    def run_sql(cls, text, success=True):
        result = subprocess.run(["docker", "exec", "-i", cls.container, "psql", "-X", "-At",
                                 "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
                                input=text, text=True, capture_output=True, timeout=20)
        if success and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def test_real_normalization_and_supported_length_boundaries(self):
        for sku in ["AbC12dEfG34", "A1BC234", "9AB12CDEF34", "A1" + "Z" * 62]:
            self.run_sql("INSERT INTO public.style_groups(sku,payload) VALUES ('" + sku + "','fixture') ON CONFLICT DO NOTHING")
            shape = "".join("9" if c.isdigit() else "A" for c in sku)
            result = self.run_sql("SET ROLE service_role; SELECT public.dam_catalog_code_format_exists('" + shape + "')")
            self.assertTrue(result.stdout.rstrip().endswith("t"))

    def test_real_miss_and_alternating_nonsense(self):
        for shape in ["AAA99AAAA9A", "A9A9A9A9"]:
            result = self.run_sql("SET ROLE service_role; SELECT public.dam_catalog_code_format_exists('" + shape + "')")
            self.assertTrue(result.stdout.rstrip().endswith("f"))

    def test_invalid_input_is_error_not_empty(self):
        for value in ["NULL", "''", "'AAAAAAA'", "'9999999'", "'AAA99'", "'A9.*AAAA'",
                      "'A9AAAAĀ'", "'A9" + "A" * 63 + "'"]:
            result = self.run_sql("SELECT public.dam_catalog_code_format_exists(" + value + ")", success=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Invalid complete code format", result.stderr)

    def test_untrusted_callers_cannot_execute(self):
        for role in ["anon", "authenticated"]:
            result = self.run_sql("SET ROLE " + role + "; SELECT public.dam_catalog_code_format_exists('AAA99AAAA99')", success=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("permission denied for function", result.stderr)
        result = self.run_sql("SELECT prosecdef FROM pg_proc WHERE oid='public.dam_catalog_code_format_exists(text)'::regprocedure")
        self.assertEqual(result.stdout.strip(), "f")

    def test_actual_bound_rpc_match_and_miss_use_index_without_forcing(self):
        decoder=json.JSONDecoder()
        for shape in ["AAA99AAAA99", "AAA99AAAA9A"]:
            # $1 is bound in the installed PL/pgSQL EXISTS. No planner flags.
            result=self.run_sql("LOAD 'auto_explain';SET client_min_messages=log;SET auto_explain.log_min_duration=0;SET auto_explain.log_nested_statements=on;SET auto_explain.log_analyze=on;SET auto_explain.log_format=json;SET ROLE service_role; SELECT public.dam_catalog_code_format_exists('"+shape+"')")
            plans=[]
            for match in re.finditer(r'\{',result.stderr):
                try:value,_=decoder.raw_decode(result.stderr[match.start():])
                except json.JSONDecodeError:continue
                if isinstance(value,dict) and 'Plan' in value:plans.append(value)
            nested=[p for p in plans if 'from public.style_groups g' in p.get('Query Text','').lower()]
            self.assertEqual(len(nested),1,result.stderr[-2000:])
            self.assertIn('idx_style_groups_code_format',json.dumps(nested))
            self.assertIn('= p_format',nested[0]['Query Text'])
            # PostgreSQL may naturally choose a custom plan with the bound value.
            # The nested Query Text proves this is the installed parameterized body.
            evidence=os.environ.get('DAM_CODE_FORMAT_EVIDENCE')
            if evidence:
                import hashlib
                path=evidence+('-match.json' if shape=='AAA99AAAA99' else '-miss.json')
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'w') as out:json.dump({'migration_sha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),'actual_installed_rpc_nested_plan':nested},out)

    def test_force_rls_preserves_existing_service_bypass_without_new_grants(self):
        result=self.run_sql("BEGIN;ALTER TABLE public.style_groups FORCE ROW LEVEL SECURITY;SET LOCAL ROLE service_role;SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user;SELECT public.dam_catalog_code_format_exists('AAA99AAAA99');ROLLBACK;")
        self.assertEqual([x for x in result.stdout.splitlines() if x in ['t','f']],['t','t'])
        after=self.run_sql("SELECT json_build_array(relrowsecurity,relforcerowsecurity,relacl::text) FROM pg_class WHERE oid='public.style_groups'::regclass").stdout
        self.assertEqual(after,self.security_before)

    def test_replay_refuses_preexisting_objects(self):
        result = self.run_sql(MIGRATION.read_text(), success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("target already exists", result.stderr)

    def test_table_acl_and_rls_are_unchanged(self):
        after = self.run_sql("SELECT json_build_array(relrowsecurity,relforcerowsecurity,relacl::text) FROM pg_class WHERE oid='public.style_groups'::regclass").stdout
        self.assertEqual(after, self.security_before)

    def test_installed_preview_contract(self):
        self.run_sql((ROOT / "supabase/tests/dam_catalog_code_format_contracts.sql").read_text())

    def test_preview_contract_refuses_wrong_index_expression_and_predicate(self):
        contract = (ROOT / "supabase/tests/dam_catalog_code_format_contracts.sql").read_text()
        for expression, predicate in [("lower(sku)", "sku IS NOT NULL"),
                                      ("translate(sku,'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999')", "sku IS NOT NULL")]:
            changed = "BEGIN; DROP INDEX public.idx_style_groups_code_format; CREATE INDEX idx_style_groups_code_format ON public.style_groups (" + expression + ") WHERE " + predicate + ";"
            result = self.run_sql(changed + contract, success=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("index expression/predicate changed", result.stderr)

    def test_preview_contract_refuses_owner_and_acl_drift(self):
        contract = (ROOT / "supabase/tests/dam_catalog_code_format_contracts.sql").read_text()
        for changed in ["CREATE ROLE format_owner; ALTER FUNCTION public.dam_catalog_code_format_exists(text) OWNER TO format_owner;",
                        "GRANT EXECUTE ON FUNCTION public.dam_catalog_code_format_exists(text) TO authenticated;"]:
            result = self.run_sql("BEGIN;" + changed + contract, success=False)
            self.assertNotEqual(result.returncode, 0)

    def test_existing_outer_statement_budget_cancels_a_blocked_reader(self):
        # This tests the REAL outer server deadline. A function-local SET alone
        # is deliberately not treated as a hard nested statement deadline.
        locker = subprocess.Popen(["docker", "exec", "-i", self.container, "psql", "-X", "-At",
                                   "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True)
        try:
            locker.stdin.write("BEGIN; LOCK public.style_groups IN ACCESS EXCLUSIVE MODE; SELECT 'lock-ready';\n")
            locker.stdin.flush()
            # Locker waits for our explicit rollback; no fixed sleep race.
            wait_line(locker.stdout,"lock-ready")
            result = self.run_sql("SET statement_timeout='1000ms'; SET ROLE service_role; SELECT public.dam_catalog_code_format_exists('AAA99AAAA99')", success=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("canceling statement due to statement timeout", result.stderr)
        finally:
            try:locker.stdin.write("ROLLBACK;\n");locker.stdin.flush()
            finally:locker.stdin.close()
            try:locker.wait(timeout=5)
            except subprocess.TimeoutExpired:locker.kill();locker.wait(timeout=2)
            locker.stdout.close()
            locker.stderr.close()


if __name__ == "__main__":
    unittest.main()
