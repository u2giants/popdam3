#!/usr/bin/env python3
"""Synthetic tests for conservative production-date matching and plan guards."""
from __future__ import annotations

from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name('orderlist-production-date-plan.py')
SPEC = importlib.util.spec_from_file_location('production_date_plan', SCRIPT)
planmod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(planmod)


def base_capture():
    header = {
        'id': 'header-1', 'production_order_number': 'D-100', 'order_date': None,
        'metadata': {'customer_name': ' Acme Customer ', 'vendor_id_raw': ' vendor-1 '},
    }
    line = {
        'id': 'line-1', 'production_order_id': 'header-1', 'sku': 'STYLE-1',
        'customer_po_number': 'CPO-9',
    }
    common = {
        'company_code': 'EDGEHOME', 'prod_order_no': 555, 'prod_line_seq': 1,
        'prod_reference_no': 'D-100', 'cust_po_number': 'CPO-9',
        'customer_code': 'CUST-1',
        'customer_desc': 'ACME CUSTOMER', 'vendor_code': 'VENDOR-1',
        'item_no': 'STYLE-1', 'short_item_no': None, 'warehouse_sku': None,
        'sales_order_no': 987, 'sales_order_link_present': True,
        'retention_identity_ambiguous': False, 'retention_ordering_ambiguous': False,
        'partition_ambiguous': False,
    }
    issued = {**common, 'id': 'src-iss', 'stage_code': 'ISS',
              'prod_order_date': '2024-03-04', 'source_observed_at': '2026-10-13T14:00:00Z',
              'line_source_hash': 'a' * 64}
    received = {**common, 'id': 'src-rec', 'stage_code': 'REC',
                'cust_po_number': None, 'prod_order_date': '2024-03-04',
                'source_observed_at': '2026-10-13T14:01:00Z', 'line_source_hash': 'b' * 64}
    return {
        'schema': planmod.CAPTURE_SCHEMA,
        'captured_at': '2026-10-13T14:02:00Z',
        'latest_source_observation_at': '2026-10-13T14:01:00Z',
        'source_digest': 'f' * 64,
        'repository_head': '1' * 40,
        'headers': [header], 'lines': [line], 'line_source_refs': [],
        'held_header_ids': [], 'prod_history_rows': [issued, received],
        'customer_identity_rows': [], 'customer_identity_snapshot_complete': True,
        'customer_identity_snapshot_row_limit': planmod.CUSTOMER_IDENTITY_SNAPSHOT_LIMIT,
    }


class ProductionDatePlannerTests(unittest.TestCase):
    def test_exact_source_identity_proposes_only_order_date(self):
        capture = base_capture()
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 1)
        proposal = result['proposals'][0]
        self.assertEqual(proposal['date'], '2024-03-04')
        self.assertIsNone(proposal['header_preimage']['order_date'])
        self.assertEqual(proposal['source_partition'], ['EDGEHOME', '555'])
        self.assertEqual(proposal['match_route'], 'exact_customer_name')
        self.assertEqual(proposal['source_row_preimages'], capture['prod_history_rows'])
        self.assertEqual(proposal['source_line_source_refs'], [])

    def test_exact_sales_order_source_ref_is_second_customer_route(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'unmapped legacy customer alias'
        capture['line_source_refs'] = [{
            'id': 'ref-1', 'production_order_line_id': 'line-1',
            'source_system': 'coldlion',
            'source_id': 'coldlion:so:987:line:1:component:1',
        }]
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 1)
        self.assertEqual(result['proposals'][0]['match_route'], 'coldlion_sales_order_reference')
        self.assertEqual(result['proposals'][0]['source_line_source_refs'], capture['line_source_refs'])

    def test_explicit_erp_customer_bridge_allows_exact_google_alias(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'Acme Retail Alias'
        capture['prod_history_rows'][0]['customer_desc'] = 'Legacy ERP customer label'
        capture['prod_history_rows'][1]['customer_desc'] = 'Legacy ERP customer label'
        capture['customer_identity_rows'] = [{
            'company_code': 'EDGEHOME', 'customer_code': 'CUST-1',
            'customer_id': 'customer-1', 'canonical_name': 'Acme Incorporated',
            'display_name': 'Acme Retail Alias', 'routing_aliases': ['ACME STORE'],
            'normalized_name': 'acme incorporated', 'erp_updated_at': '2026-10-12T12:00:00Z',
            'customer_updated_at': '2026-10-12T13:00:00Z',
        }]
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 1)
        self.assertEqual(result['proposals'][0]['match_route'], 'erp_customer_bridge')
        self.assertEqual(result['proposals'][0]['identity_scope_customer_identity_preimages'],
                         capture['customer_identity_rows'])

    def test_customer_bridge_requires_every_issued_code_and_one_customer(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'Acme Retail Alias'
        capture['prod_history_rows'][0]['customer_desc'] = 'Legacy ERP customer label'
        capture['prod_history_rows'][1]['customer_desc'] = 'Legacy ERP customer label'
        mapping = {
            'company_code': 'EDGEHOME', 'customer_code': 'CUST-1', 'customer_id': 'customer-1',
            'canonical_name': 'Acme Incorporated', 'display_name': 'Acme Retail Alias',
            'routing_aliases': [], 'normalized_name': 'acme incorporated',
            'erp_updated_at': '2026-10-12T12:00:00Z', 'customer_updated_at': '2026-10-12T13:00:00Z',
        }
        capture['customer_identity_rows'] = []
        self.assertEqual(planmod.build_plan(capture)['counts']['proposed'], 0)
        second_code = deepcopy(capture['prod_history_rows'][0])
        second_code.update(id='src-iss-second-code', customer_code='CUST-2',
                           source_observed_at='2026-10-13T14:00:30Z', line_source_hash='c' * 64)
        capture['prod_history_rows'].append(second_code)
        capture['customer_identity_rows'] = [mapping]
        self.assertEqual(planmod.build_plan(capture)['counts']['proposed'], 0)
        capture['customer_identity_rows'].append({**mapping, 'customer_code': 'CUST-2', 'customer_id': 'customer-2'})
        self.assertEqual(planmod.build_plan(capture)['counts']['proposed'], 0)

    def test_customer_bridge_rejects_alias_collision_across_customer_ids(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'Acme Retail Alias'
        capture['prod_history_rows'][0]['customer_desc'] = 'Legacy ERP customer label'
        capture['prod_history_rows'][1]['customer_desc'] = 'Legacy ERP customer label'
        base_mapping = {
            'canonical_name': None, 'routing_aliases': [], 'normalized_name': None,
            'erp_updated_at': '2026-10-12T12:00:00Z',
            'customer_updated_at': '2026-10-12T13:00:00Z',
        }
        capture['customer_identity_rows'] = [
            {**base_mapping, 'company_code': 'EDGEHOME', 'customer_code': 'CUST-1',
             'customer_id': 'customer-1', 'display_name': 'Acme Retail Alias'},
            {**base_mapping, 'company_code': 'OTHERCO', 'customer_code': 'CUST-9',
             'customer_id': 'customer-2', 'display_name': 'Acme Retail Alias'},
        ]
        self.assertEqual(planmod.build_plan(capture)['counts']['proposed'], 0)

    def test_unrelated_alias_owner_for_same_customer_id_is_safe_and_frozen(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'Acme Retail Alias'
        capture['prod_history_rows'][0]['customer_desc'] = 'Legacy ERP customer label'
        capture['prod_history_rows'][1]['customer_desc'] = 'Legacy ERP customer label'
        base_mapping = {
            'canonical_name': 'Acme Incorporated', 'routing_aliases': [],
            'normalized_name': 'acme incorporated',
            'erp_updated_at': '2026-10-12T12:00:00Z',
            'customer_updated_at': '2026-10-12T13:00:00Z',
        }
        capture['customer_identity_rows'] = [
            {**base_mapping, 'company_code': 'EDGEHOME', 'customer_code': 'CUST-1',
             'customer_id': 'customer-1', 'display_name': 'Acme Retail Alias'},
            {**base_mapping, 'company_code': 'OTHERCO', 'customer_code': 'CUST-9',
             'customer_id': 'customer-1', 'display_name': 'Acme Retail Alias'},
        ]
        proposal = planmod.build_plan(capture)['proposals'][0]
        self.assertEqual(proposal['match_route'], 'erp_customer_bridge')
        self.assertEqual(len(proposal['identity_scope_customer_identity_preimages']), 2)
        self.assertEqual({row['customer_code'] for row in proposal['identity_scope_customer_identity_preimages']},
                         {'CUST-1', 'CUST-9'})

    def test_customer_bridge_capture_requires_exact_join_projection(self):
        capture = base_capture()
        capture['customer_identity_rows'] = [{'company_code': 'EDGEHOME', 'customer_code': 'CUST-1'}]
        with self.assertRaisesRegex(ValueError, 'projection is incomplete'):
            planmod.build_plan(capture)

    def test_incomplete_customer_bridge_snapshot_cannot_authorize_alias_match(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'Acme Retail Alias'
        capture['prod_history_rows'][0]['customer_desc'] = 'Legacy ERP customer label'
        capture['prod_history_rows'][1]['customer_desc'] = 'Legacy ERP customer label'
        capture['customer_identity_snapshot_complete'] = False
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)
        self.assertIn('customer_identity_unverified', {row['reason'] for row in result['unresolved']})

    def test_source_ref_mismatch_is_a_contradiction_not_fallback(self):
        capture = base_capture()
        capture['line_source_refs'] = [{
            'id': 'ref-1', 'production_order_line_id': 'line-1',
            'source_system': 'coldlion', 'source_id': 'coldlion:so:123:line:1:component:1',
        }]
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)
        self.assertIn('coldlion_source_ref_contradiction', {x['reason'] for x in result['unresolved']})

    def test_reused_production_number_with_two_source_orders_stays_unresolved(self):
        capture = base_capture()
        second = deepcopy(capture['prod_history_rows'][0])
        second.update(id='src-iss-second-order', prod_order_no=556,
                      source_observed_at='2026-10-13T14:00:30Z', line_source_hash='c' * 64)
        capture['prod_history_rows'].append(second)
        capture['latest_source_observation_at'] = '2026-10-13T14:01:00Z'
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)
        self.assertIn('multiple_source_orders_match', {x['reason'] for x in result['unresolved']})

    def test_matched_partition_identity_scope_does_not_leak_from_later_company(self):
        capture = base_capture()
        selected_mapping = {
            'company_code': 'EDGEHOME', 'customer_code': 'CUST-1',
            'customer_id': 'customer-1', 'canonical_name': 'Acme Customer',
            'display_name': 'Acme Customer', 'routing_aliases': [],
            'normalized_name': 'acme customer', 'erp_updated_at': '2026-10-12T12:00:00Z',
            'customer_updated_at': '2026-10-12T13:00:00Z',
        }
        other_mapping = {
            'company_code': 'OTHERCO', 'customer_code': 'CUST-9',
            'customer_id': 'customer-9', 'canonical_name': 'Other Customer',
            'display_name': 'Other Customer', 'routing_aliases': [],
            'normalized_name': 'other customer', 'erp_updated_at': '2026-10-12T12:00:00Z',
            'customer_updated_at': '2026-10-12T13:00:00Z',
        }
        capture['customer_identity_rows'] = [selected_mapping, other_mapping]
        later_company_order = deepcopy(capture['prod_history_rows'][0])
        later_company_order.update(
            id='src-other-company', company_code='OTHERCO', prod_order_no=555,
            prod_reference_no='D-200', customer_code='CUST-9',
            cust_po_number='CPO-OTHER', customer_desc='Other Customer',
            vendor_code='OTHER-VENDOR', item_no='OTHER-STYLE',
            source_observed_at='2026-10-13T14:03:00Z', line_source_hash='c' * 64)
        capture['prod_history_rows'].append(later_company_order)
        capture['captured_at'] = '2026-10-13T14:04:00Z'
        capture['latest_source_observation_at'] = '2026-10-13T14:03:00Z'

        proposal = planmod.build_plan(capture)['proposals'][0]
        self.assertEqual(proposal['source_partition'], ['EDGEHOME', '555'])
        self.assertEqual(proposal['customer_identity_scope_pairs'], [['EDGEHOME', 'CUST-1']])
        self.assertEqual(proposal['identity_scope_customer_identity_preimages'], [selected_mapping])

    def test_reused_d_across_distinct_customer_vendor_partitions_uses_full_identity(self):
        capture = base_capture()
        second = deepcopy(capture['prod_history_rows'][0])
        second.update(id='src-iss-reused-d', prod_order_no=556, prod_reference_no='D-100',
                      cust_po_number='CPO-OTHER', customer_desc='Other Customer',
                      vendor_code='VENDOR-OTHER', item_no='STYLE-OTHER',
                      source_observed_at='2026-10-13T14:00:30Z', line_source_hash='c' * 64)
        capture['prod_history_rows'].append(second)
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 1)
        self.assertEqual(result['proposals'][0]['source_partition'], ['EDGEHOME', '555'])
        self.assertEqual(result['counts']['unresolved'], 0)

    def test_plan_pins_every_source_row_sharing_the_production_reference(self):
        capture = base_capture()
        other_company = deepcopy(capture['prod_history_rows'][0])
        other_company.update(id='src-other-company', company_code='OTHERCO',
                             prod_order_no=999, source_observed_at='2026-10-13T14:00:30Z',
                             line_source_hash='c' * 64)
        capture['prod_history_rows'].append(other_company)
        result = planmod.build_plan(capture)
        proposal = result['proposals'][0]
        self.assertEqual(len(proposal['source_row_preimages']), 2)
        self.assertEqual(len(proposal['identity_scope_source_preimages']), 3)
        self.assertEqual({row['id'] for row in proposal['identity_scope_source_preimages']},
                         {'src-iss', 'src-rec', 'src-other-company'})

    def test_reused_d_can_match_two_distinct_headers_without_merging_them(self):
        capture = base_capture()
        capture['headers'].append({
            'id': 'header-2', 'production_order_number': 'D-100', 'order_date': None,
            'metadata': {'customer_name': 'Other Customer', 'vendor_id_raw': 'VENDOR-OTHER'},
        })
        capture['lines'].append({
            'id': 'line-2', 'production_order_id': 'header-2', 'sku': 'STYLE-OTHER',
            'customer_po_number': 'CPO-OTHER',
        })
        second = deepcopy(capture['prod_history_rows'][0])
        second.update(id='src-iss-reused-d', prod_order_no=556,
                      cust_po_number='CPO-OTHER', customer_desc='Other Customer',
                      vendor_code='VENDOR-OTHER', item_no='STYLE-OTHER',
                      prod_order_date='2025-03-04', source_observed_at='2026-10-13T14:00:30Z',
                      line_source_hash='c' * 64)
        capture['prod_history_rows'].append(second)
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 2)
        self.assertEqual({p['header_id'] for p in result['proposals']}, {'header-1', 'header-2'})
        self.assertEqual({p['date'] for p in result['proposals']}, {'2024-03-04', '2025-03-04'})

    def test_line_scoped_po_and_style_must_match_exactly(self):
        for field, wrong in (('customer_po_number', 'CPO-X'), ('sku', 'STYLE-X')):
            with self.subTest(field=field):
                capture = base_capture()
                capture['lines'][0][field] = wrong
                result = planmod.build_plan(capture)
                self.assertEqual(result['counts']['proposed'], 0)

    def test_vendor_and_customer_identity_are_not_fuzzy(self):
        capture = base_capture()
        capture['headers'][0]['metadata']['vendor_id_raw'] = 'VENDOR-2'
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)

    def test_mixed_customer_names_with_same_d_number_stay_ambiguous_even_with_refs(self):
        capture = base_capture()
        capture['line_source_refs'] = [{
            'id': 'ref-1', 'production_order_line_id': 'line-1',
            'source_system': 'coldlion',
            'source_id': 'coldlion:so:987:line:1:component:1',
        }]
        second = deepcopy(capture['prod_history_rows'][0])
        second.update(id='src-iss-other-customer', prod_line_seq=2, item_no='STYLE-OTHER',
                      customer_desc='another customer', source_observed_at='2026-10-13T14:00:30Z',
                      line_source_hash='c' * 64)
        capture['prod_history_rows'].append(second)
        capture['latest_source_observation_at'] = '2026-10-13T14:01:00Z'
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)
        self.assertIn('issued_customer_identity_conflict', {x['reason'] for x in result['unresolved']})
        capture = base_capture()
        capture['headers'][0]['metadata']['customer_name'] = 'a different business'
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)

    def test_date_drift_sentinel_and_ambiguous_partition_are_rejected(self):
        changes = (
            lambda c: c['prod_history_rows'][1].update(prod_order_date='2024-03-05'),
            lambda c: c['prod_history_rows'][1].update(prod_order_date='1900-01-01'),
            lambda c: c['prod_history_rows'][0].update(retention_identity_ambiguous=True),
        )
        for mutate in changes:
            with self.subTest(mutate=mutate):
                capture = base_capture()
                mutate(capture)
                result = planmod.build_plan(capture)
                self.assertEqual(result['counts']['proposed'], 0)

    def test_conflicting_date_in_an_older_source_version_blocks_match(self):
        capture = base_capture()
        older = deepcopy(capture['prod_history_rows'][0])
        older.update(id='src-iss-older-version', prod_order_date='2024-03-03',
                     source_observed_at='2026-10-12T14:00:00Z', line_source_hash='d' * 64)
        capture['prod_history_rows'].append(older)
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)
        self.assertIn('source_date_drift', {x['reason'] for x in result['unresolved']})

    def test_same_date_source_versions_do_not_duplicate_line_identity(self):
        capture = base_capture()
        newer = deepcopy(capture['prod_history_rows'][0])
        newer.update(id='src-iss-new-version', source_observed_at='2026-10-13T14:00:30Z',
                     line_source_hash='e' * 64)
        capture['prod_history_rows'].append(newer)
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 1)

    def test_held_and_nonblank_orders_are_never_proposed(self):
        capture = base_capture()
        capture['held_header_ids'] = ['header-1']
        self.assertEqual(planmod.build_plan(capture)['counts']['proposed'], 0)
        capture = base_capture()
        capture['headers'][0]['order_date'] = '2020-02-03'
        self.assertEqual(planmod.build_plan(capture)['counts']['proposed'], 0)

    def test_duplicate_target_identity_blocks_date(self):
        capture = base_capture()
        capture['headers'].append({**deepcopy(capture['headers'][0]), 'id': 'header-2'})
        capture['lines'].append({**deepcopy(capture['lines'][0]), 'id': 'line-2',
                                 'production_order_id': 'header-2'})
        result = planmod.build_plan(capture)
        self.assertEqual(result['counts']['proposed'], 0)
        self.assertIn('duplicate_target_identity', {x['reason'] for x in result['unresolved']})

    def test_capture_freshness_must_be_explicit_and_true(self):
        capture = base_capture()
        capture['latest_source_observation_at'] = '2026-10-13T13:59:00Z'
        with self.assertRaisesRegex(ValueError, 'Latest source observation'):
            planmod.build_plan(capture)
        capture = base_capture()
        capture['captured_at'] = '2026-10-13T13:59:00Z'
        with self.assertRaisesRegex(ValueError, 'later than the capture'):
            planmod.build_plan(capture)


if __name__ == '__main__':
    unittest.main()
