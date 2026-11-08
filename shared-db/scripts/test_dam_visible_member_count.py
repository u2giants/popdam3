"""Offline source safeguards for the #5938 member-count migration."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'supabase/migrations/20261108190600_dam_search_visible_member_count.sql').read_text()


class MemberCountContracts(unittest.TestCase):
    def test_predecessor_fingerprint_is_reproducible(self):
        predecessor = next((ROOT / 'supabase/migrations').glob('20261106161604*.sql')).read_text()
        body = predecessor.split('AS $function$')[1].split('$function$;')[0]
        guard = SOURCE.split('do $guard$')[1]
        self.assertEqual(re.findall(r"[a-f0-9]{32}", guard)[0], hashlib.md5(body.encode()).hexdigest())
        installed_body = SOURCE.split('AS $function$')[1].split('$function$;')[0]
        self.assertEqual(re.findall(r"[a-f0-9]{32}", guard)[1], hashlib.md5(installed_body.encode()).hexdigest())

    def test_installed_contract_matches_body_and_security(self):
        body = SOURCE.split('AS $function$')[1].split('$function$;')[0]
        guard = SOURCE.split('do $guard$')[2]
        self.assertIn(hashlib.md5(body.encode()).hexdigest(), guard)
        for clause in ["pg_get_userbyid(p.proowner)='postgres'", 'p.prosecdef', "p.provolatile='s'", 'p.proretset', 'pg_get_function_arguments', 'pg_get_function_result', 'p.proconfig=', 'p.proacl::text=']:
            self.assertIn(clause, guard)

    def test_boolean_helper_reuses_count_predicate(self):
        helper = SOURCE.split('create or replace function public.dam_default_visible_member(')[1].split('$f$;')[0]
        self.assertIn('public.dam_default_visible_member_count(p_document_type, p_asset_id, p_style_group_id, p_min_date) > 0', helper)
        self.assertNotIn('from public.assets', helper)

    def test_member_branch_and_sweep_remain_fail_closed(self):
        self.assertIn('bool_and(d.default_visible_member_count is not null)', SOURCE)
        self.assertIn('and coalesce((select all_current from default_flag_state), true)', SOURCE)
        self.assertIn('or (coalesce((select all_counts_current from default_flag_state), true)', SOURCE)
        self.assertEqual(SOURCE.count('d.default_visible_member_count is null'), 2)
        contract = (ROOT / 'supabase/tests/dam_search_exact_total_contracts.sql').read_text()
        for token in ['generate_series(1, 1001)', "array['style_group']", "'current', 'filtered', 'null', 'stale', 'swept', 'below_cap'", 'result.has_more is distinct from false', 'result.total_count is distinct from 1::bigint', 'result.facets']:
            self.assertIn(token, contract)


if __name__ == '__main__':
    unittest.main()
