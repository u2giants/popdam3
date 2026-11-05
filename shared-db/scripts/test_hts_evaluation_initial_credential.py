"""Fixed-identity initial credential safety, using no live credentials."""
import sys
import os
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parent))
import atomic_migration_apply as atomic


class InitialCredentialTests(unittest.TestCase):
    secret = 'synthetic-test-password-64-characters-never-a-real-credential-00000'

    def execute(self, connection, secret=None):
        policy = {atomic.HTS_CREDENTIAL_VERSION: {'initial_credential_role': atomic.HTS_CREDENTIAL_ROLE}}
        with patch.object(atomic, 'read_policy', return_value=policy), patch.object(atomic, 'credential_connection', return_value=connection) as connect:
            atomic.initial_credential_apply({atomic.HTS_CREDENTIAL_ENV: self.secret if secret is None else secret},
                atomic.HTS_CREDENTIAL_VERSION, 'test', 'SELECT 1', ['SELECT 1'])
            return connect

    def connection(self, responses):
        conn = MagicMock(); cursor = conn.__enter__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = responses
        return conn, cursor

    def test_missing_secret_stops_before_connection(self):
        conn, _ = self.connection([])
        with self.assertRaisesRegex(atomic.Refusal, 'missing or invalid'):
            self.execute(conn, '')
        conn.__enter__.assert_not_called()

    def test_initial_secret_is_only_a_parameter_and_ledger_in_same_transaction(self):
        conn, cur = self.connection([(True,), None, (True,)])
        self.execute(conn)
        calls = cur.execute.call_args_list
        self.assertTrue(any('INSERT INTO supabase_migrations' in c.args[0] for c in calls))
        self.assertTrue(any('ALTER ROLE designflow_hts_evaluation_reader' in c.args[0] for c in calls))
        for c in calls:
            self.assertNotIn(self.secret, c.args[0])
        setter = [c for c in calls if "set_config('app.hts_evaluation_initial_password', %s" in c.args[0]][0]
        self.assertEqual(setter.args[1], (self.secret,))

    def test_password_bearing_failure_is_sanitized_and_transaction_exits_in_error(self):
        conn, cur = self.connection([(True,), None])
        cur.execute.side_effect = [None, None, None, None, RuntimeError(self.secret)]
        with self.assertRaises(atomic.Refusal) as caught:
            self.execute(conn)
        self.assertNotIn(self.secret, str(caught.exception))
        self.assertIsNotNone(conn.__exit__.call_args.args[0])
        self.assertFalse(any('INSERT INTO supabase_migrations' in c.args[0] for c in cur.execute.call_args_list))

    def test_logging_that_can_expose_values_refuses_before_credential_bind(self):
        conn, cur = self.connection([(False,)])
        with self.assertRaisesRegex(atomic.Refusal, 'logging'):
            self.execute(conn)
        self.assertFalse(any('set_config' in c.args[0] for c in cur.execute.call_args_list))

    def test_existing_password_is_authenticated_and_never_changed(self):
        conn, cur = self.connection([(True,), (True,), (atomic.HTS_CREDENTIAL_ROLE,), (True,)])
        self.execute(conn)
        self.assertFalse(any('ALTER ROLE' in c.args[0] or 'set_config' in c.args[0] for c in cur.execute.call_args_list))

    def test_existing_wrong_password_refuses_without_mutation_or_error_echo(self):
        conn, cur = self.connection([(True,), (True,)])
        policy = {atomic.HTS_CREDENTIAL_VERSION: {'initial_credential_role': atomic.HTS_CREDENTIAL_ROLE}}
        with patch.object(atomic, 'read_policy', return_value=policy), patch.object(atomic, 'credential_connection', side_effect=[conn,RuntimeError(self.secret)]):
            with self.assertRaises(atomic.Refusal) as caught:
                atomic.initial_credential_apply({atomic.HTS_CREDENTIAL_ENV:self.secret},atomic.HTS_CREDENTIAL_VERSION,'test','SELECT 1',['SELECT 1'])
        self.assertNotIn(self.secret,str(caught.exception))
        self.assertFalse(any(c.args[0]=='SELECT 1' for c in cur.execute.call_args_list))

    def test_proved_connection_environment_replaces_ambient_target_and_restores_it(self):
        captured=[]
        fake=SimpleNamespace(connect=lambda **kwargs:captured.append((dict(os.environ),kwargs)))
        env={'PGHOST':'proved-host','PGPORT':'6543','PGDATABASE':'proved-db','PGUSER':'operator.projectref','PGPASSWORD':'operator-synthetic',atomic.HTS_CREDENTIAL_ENV:self.secret}
        with patch.dict(os.environ,{'PGHOST':'ambient-wrong','PGHOSTADDR':'ambient-override','PGOPTIONS':'ambient-options'},clear=False),patch.dict(sys.modules,{'psycopg':fake}):
            atomic.credential_connection(env,reader=True)
            self.assertEqual(os.environ['PGHOST'],'ambient-wrong')
            self.assertEqual(os.environ['PGHOSTADDR'],'ambient-override')
        actual,kwargs=captured[0]
        self.assertEqual(actual['PGHOST'],'proved-host')
        self.assertEqual(actual['PGDATABASE'],'proved-db')
        self.assertEqual(actual['PGUSER'],atomic.HTS_CREDENTIAL_ROLE+'.projectref')
        self.assertEqual(actual['PGPASSWORD'],self.secret)
        self.assertNotIn('PGHOSTADDR',actual)
        self.assertNotIn('PGOPTIONS',actual)
        self.assertEqual(kwargs,{'connect_timeout':15})

    def test_unapproved_version_cannot_provision_any_role(self):
        with self.assertRaisesRegex(atomic.Refusal,'allowlist'):
            atomic.initial_credential_apply({},'29990101000000','test','SELECT 1',['SELECT 1'])

if __name__ == '__main__': unittest.main()
