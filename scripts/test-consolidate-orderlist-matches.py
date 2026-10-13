#!/usr/bin/env python3
"""Synthetic safety tests for reviewed OrderList match consolidation."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from decimal import Decimal
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('consolidate_matches', HERE/'consolidate-orderlist-matches.py')
c = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(c)


def sample_line():
    return {
        'id':'line-a','production_order_id':'cold-header','sku':'ab-12','customer_po_number':'PO 77','quantity_ordered':12,
        'item_id':'item-a','line_number':7,'master_data_match_status':'matched',
        'source_system':'coldlion','source_id':'cold:line:a','unit_cost':'2.40',
        'quantity_shipped':3,'status':'open','metadata':{
            'component_source_hash':'fingerprint-a','item_match_proof':{'method':'exact'},
            'cold_namespace':{'keep':True},'source_snapshot':'cold-capture',
            'raw_evidence':{'cold':'prior'}},
        'order_person':'old','ship_to':'old address','updated_at':'old-time'}


class ConsolidationTests(unittest.TestCase):
    def test_private_write_creates_mode_0600_exclusive_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'private.json'
            c.private_write(path, {'value':'saved'})
            self.assertEqual(json.loads(path.read_text()), {'value':'saved'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_private_write_does_not_change_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'existing.json'
            path.write_text('original')
            with self.assertRaises(FileExistsError):
                c.private_write(path, {'value':'replacement'})
            self.assertEqual(path.read_text(), 'original')

    def test_private_write_refuses_dangling_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root/'target.json'
            link = root/'private.json'
            link.symlink_to(target)
            with self.assertRaises(FileExistsError):
                c.private_write(link, {'value':'must not follow link'})
            self.assertTrue(link.is_symlink())
            self.assertFalse(target.exists())

    def test_binding_packet_rejects_duplicate_returned_excel_row(self):
        row = {
            'returned_excel_row':2, 'google_physical_row':22,
            'original_cold_binding':{
                'cold_line_uuid':'cold-line','line_source_id':'cold-source',
                'component_source_hash':'cold-fingerprint'},
            'original_google_binding':{
                'google_line_source_id':'google-line',
                'google_parent_source_id':'google-parent'},
        }
        packet = {'schema':'canonical-coldlion-binding-packet-v1','rows':[row,row.copy()]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'bindings.json'
            path.write_text(json.dumps(packet))
            with self.assertRaisesRegex(ValueError,'Duplicate or invalid returned workbook row binding'):
                c.load_bindings(path)

    def test_database_identity_and_history_fields_never_enter_line_updates(self):
        database_managed = {'id', 'created_at', 'updated_at'}
        self.assertTrue(database_managed.isdisjoint(c.m.LINE_COLUMNS))
        # The parent is deliberately reassigned and verified separately; it
        # cannot also enter the importer-column protected-preimage loop.
        self.assertNotIn('production_order_id', c.m.LINE_COLUMNS)

        update_columns = [
            field for field in c.m.LINE_COLUMNS
            if field not in c.PROTECTED_LINE_FIELDS
        ]
        self.assertTrue(set(update_columns).issubset(set(c.m.LINE_COLUMNS)))
        self.assertTrue(database_managed.isdisjoint(update_columns))
        self.assertTrue(c.PROTECTED_LINE_FIELDS.isdisjoint(update_columns))

        old = sample_line()
        preserved_fields = (database_managed | c.PROTECTED_LINE_FIELDS) - {'production_order_id'}
        original = {field: old.get(field) for field in preserved_fields}
        item = {
            'google_sku':'AB-12', 'google_customer_po':'PO 77', 'verified_quantity':'12',
            'google_line_source_id':'order:row:22', 'google_parent_source_id':'order:po:77',
            'google_payload':{
                'sku':'AB-12', 'customer_po_number':'PO 77', 'quantity_ordered':12,
                'id':'google-id', 'created_at':'google-created', 'updated_at':'google-updated',
                'quantity_shipped':99, 'status':'closed', 'source_id':'google-source',
            },
            'google_metadata':{},
        }
        updated = c.cold_google_patch(old, item, 'google-header')
        self.assertEqual({field: updated.get(field) for field in original}, original)
        self.assertEqual(updated['production_order_id'], 'google-header')

    def test_make_bindings_rejects_changed_google_parent_with_same_po_and_sku(self):
        values = [None] * 48
        values[c.m.column_index('N')] = 'PO 77'
        source = c.m.SourceRow(sheet_row=22, values=tuple(values))
        source_id = 'order:row:22'
        parsed_line = SimpleNamespace(
            sheet_row=22,
            order_source_id='new-normalized-import-po',
            payload={'customer_po_number':'PO 77','sku':'AB-12'},
            metadata={},
        )
        self.assertEqual(source.cell('N'), parsed_line.payload['customer_po_number'])
        self.assertEqual(c.m.normalize_sku(parsed_line.payload['sku']), c.m.normalize_sku('AB-12'))
        packet = {'rows':[{
            'returned_excel_row':2,'google_physical_row':22,
            'decision':c.DECISION,'notes':'Quantity 12',
            'original_cold_binding':{},
            'original_google_binding':{
                'google_line_source_id':source_id,
                'google_parent_source_id':'old-normalized-import-po',
            },
        }]}
        decisions = {2:{
            'google_row':22,'decision':c.DECISION,'notes':'Quantity 12',
            'customer_po':'PO 77','sku':'AB-12',
        }}
        with self.assertRaisesRegex(ValueError,'Google parent source identity changed'):
            c.make_bindings(packet,decisions,[source],{source_id:[parsed_line]})

    def test_readback_comparison_matches_numeric_json_and_exact_metadata_writer_semantics(self):
        parsed, raw = c.m.parse_number('4')
        self.assertEqual(parsed, Decimal('4'))
        self.assertEqual(raw, '4')
        self.assertTrue(c.line_readback_equal('case_pack',4,parsed))
        self.assertTrue(c.line_readback_equal('order_depth_inches',4.5,Decimal('4.5')))
        self.assertFalse(c.line_readback_equal('cases_reported',5,Decimal('4')))
        self.assertTrue(c.line_readback_equal('case_pack',None,None))
        self.assertFalse(c.line_readback_equal('case_pack',None,Decimal('0')))
        self.assertFalse(c.line_readback_equal('case_pack','4',Decimal('4')))

        expected_metadata={'numeric_evidence':Decimal('4.0'),'raw_text':'4.0'}
        stored_metadata=json.loads(json.dumps(expected_metadata,default=str))
        self.assertEqual(stored_metadata['numeric_evidence'],'4.0')
        self.assertTrue(c.line_readback_equal('metadata',stored_metadata,expected_metadata))
        self.assertFalse(c.line_readback_equal('metadata',{'numeric_evidence':4,'raw_text':'4.0'},expected_metadata))

    def test_header_rebind_does_not_require_same_parent(self):
        old=sample_line()
        item={'google_sku':'AB-12','google_customer_po':'PO 77','verified_quantity':'12',
              'google_line_source_id':'order:row:22','google_parent_source_id':'order:po:77',
              'google_payload':{'sku':'AB-12','customer_po_number':'PO 77','quantity_ordered':None,
                                'order_person':'new','ship_to':'new address'},
              'google_metadata':{'order_list_source':{'row':22},'raw_evidence':{'source':'google'}}}
        result=c.cold_google_patch(old,item,'different-google-header')
        self.assertEqual(result['production_order_id'],'different-google-header')
        self.assertEqual(result['quantity_ordered'],12)
        self.assertEqual(result['order_person'],'new')

    def test_protected_cold_identity_and_metadata_survive(self):
        old=sample_line()
        item={'google_sku':'AB-12','google_customer_po':'PO 77','verified_quantity':'12',
              'google_line_source_id':'order:row:22','google_parent_source_id':'order:po:77',
              'google_payload':{'sku':'AB12','customer_po_number':'PO 77','quantity_ordered':12,
                                'item_id':'wrong','line_number':99,'master_data_match_status':'unmatched'},
              'google_metadata':{'cold_namespace':{'replace':True},'component_source_hash':'wrong',
                                 'item_match_proof':{'method':'weak'},'raw_evidence':{'cell':'value'},
                                 'master_data_resolution':'unmatched','item_link_pending_reason':'empty-catalog'}}
        result=c.cold_google_patch(old,item,'google-header')
        for key in ('id','item_id','line_number','master_data_match_status','source_system','source_id',
                    'unit_cost','quantity_shipped','status'):
            self.assertEqual(result[key],old[key])
        self.assertEqual(result['metadata']['component_source_hash'],'fingerprint-a')
        self.assertEqual(result['metadata']['item_match_proof'],{'method':'exact'})
        self.assertEqual(result['metadata']['cold_namespace'],{'keep':True})
        self.assertEqual(result['metadata']['raw_evidence'],{'cold':'prior'})
        self.assertEqual(result['metadata']['google_orderlist_reconciliation']['preserved_google_metadata']['raw_evidence'],{'cell':'value'})
        self.assertNotIn('master_data_resolution',result['metadata'])
        self.assertNotIn('item_link_pending_reason',result['metadata'])

    def test_source_changed_sku_fails_closed(self):
        old=sample_line()
        item={'google_sku':'different','google_customer_po':'PO 77','verified_quantity':'12',
              'google_line_source_id':'order:row:22','google_parent_source_id':'order:po:77',
              'google_payload':{},'google_metadata':{}}
        with self.assertRaisesRegex(ValueError,'SKU'):
            c.cold_google_patch(old,item,'header')

    def test_customer_po_and_quantity_must_still_match(self):
        item={'google_sku':'AB-12','google_customer_po':'PO changed','verified_quantity':'12',
              'google_line_source_id':'order:row:22','google_parent_source_id':'order:po:77',
              'google_payload':{},'google_metadata':{}}
        with self.assertRaisesRegex(ValueError,'customer PO'):
            c.cold_google_patch(sample_line(),item,'header')
        item['google_customer_po']='PO 77'; item['verified_quantity']='13'
        with self.assertRaisesRegex(ValueError,'Quantity'):
            c.cold_google_patch(sample_line(),item,'header')

    def test_duplicate_ref_transfers_same_ref_identity(self):
        ref={'id':'ref-a','production_order_line_id':'duplicate','source_system':'google_order_list',
             'source_id':'order:row:22','is_primary':True,'metadata':{'preserve':'yes'}}
        moved=c.transfer_ref(ref,'cold-line')
        self.assertEqual(moved['id'],ref['id'])
        self.assertEqual(moved['production_order_line_id'],'cold-line')
        self.assertEqual({k:v for k,v in moved.items() if k!='production_order_line_id'},
                         {k:v for k,v in ref.items() if k!='production_order_line_id'})
        c.validate_duplicate_refs(ref,[ref])
        with self.assertRaisesRegex(ValueError,'unexpected source references'):
            c.validate_duplicate_refs(ref,[ref,dict(ref,id='unexpected')])
        with self.assertRaisesRegex(ValueError,'unexpected source references'):
            c.validate_duplicate_refs(ref,[])

    def test_legacy_null_source_columns_use_google_ref_and_bound_source(self):
        row={'source_system':None,'source_id':None,'sku':'AB-12','customer_po_number':'PO 77',
             'production_order_id':'google-parent','metadata':{'order_list_source':{'sheet_row':22}}}
        item={'google_physical_row':22,'google_sku':'AB-12',
              'google_payload':{'customer_po_number':'PO 77'}}
        c.validate_legacy_google_identity(row,'order:row:22')
        c.validate_google_duplicate(row,item,'google-parent')
        c.validate_legacy_google_identity(dict(row,source_system=c.m.SOURCE_SYSTEM,source_id='order:row:22'),'order:row:22')
        with self.assertRaisesRegex(ValueError,'source identity changed'):
            c.validate_legacy_google_identity(dict(row,source_system='other'),'order:row:22')
        with self.assertRaisesRegex(ValueError,'source row evidence'):
            c.validate_google_duplicate(dict(row,metadata={'order_list_source':{'sheet_row':23}}),item,'google-parent')

    def test_missing_ref_has_deterministic_replay_identity(self):
        source_id='order:row:22'
        self.assertEqual(c.missing_ref_uuid(source_id),c.missing_ref_uuid(source_id))
        self.assertNotEqual(c.missing_ref_uuid(source_id),c.missing_ref_uuid('order:row:23'))

    def test_snapshot_and_foreign_key_contract_guards(self):
        expected=[
            {'child_table':c.LINE_REF_TABLE,'child_columns':['production_order_line_id'],'parent_table':c.LINE_TABLE,'parent_columns':['id'],'delete_rule':'c'},
            {'child_table':c.SNAPSHOT_TABLE,'child_columns':['production_order_line_id'],'parent_table':c.LINE_TABLE,'parent_columns':['id'],'delete_rule':'n'}]
        c.verify_fk_contract(expected)
        with self.assertRaisesRegex(ValueError,'foreign-key contract'):
            c.verify_fk_contract(expected+[dict(expected[0],child_table='other.refs')])
        c.validate_no_duplicate_snapshots({'duplicate-id'},[])
        with self.assertRaisesRegex(ValueError,'Snapshot references'):
            c.validate_no_duplicate_snapshots({'duplicate-id'},[{'production_order_line_id':'duplicate-id'}])

    def test_tracking_fixture_uses_order_id_primary_key(self):
        self.assertEqual(c.scoped_primary_keys([{'order_id':'header-a','tracking':'keep'}],'order_id'),['header-a'])
        with self.assertRaisesRegex(ValueError,'primary-key contract'):
            c.scoped_primary_keys([{'tracking':'missing-key'}],'order_id')

    def test_frozen_source_ref_lists_are_source_ids_not_row_uuids(self):
        refs=[{'id':'row-uuid-a','source_id':'coldlion:line:a'},
              {'id':'row-uuid-b','source_id':'coldlion:line:b'}]
        self.assertEqual(c.source_id_set(refs),{'coldlion:line:a','coldlion:line:b'})
        self.assertNotEqual(c.source_id_set(refs),{r['id'] for r in refs})
        with self.assertRaisesRegex(ValueError,'identity is incomplete'):
            c.source_id_set([{'id':'row-uuid-c','source_id':None}])

    def test_changed_input_plan_or_preimage_rejected(self):
        plan={'source_sha256':'a','decision_digest':'b'}
        pre={'line':{'quantity':12}}
        c.verify_reviewed_inputs(plan,dict(plan),pre,dict(pre))
        for altered_plan,altered_pre in ((dict(plan,source_sha256='changed'),pre),
                                        (plan,{'line':{'quantity':13}})):
            with self.assertRaisesRegex(ValueError,'reviewed plan changed'):
                c.verify_reviewed_inputs(altered_plan,plan,altered_pre,pre)

    def test_decision_and_single_quantity_note_are_exact(self):
        note='Order!N: Original context. Quantity 1,200.\nPlease use Google details for the rest.'
        q=c.verify_approved_decision(c.DECISION,c.DECISION,note,note)
        self.assertEqual(str(q),'1200')
        with self.assertRaisesRegex(ValueError,'exact approved decision'):
            c.verify_approved_decision('same order',c.DECISION,note,note)
        with self.assertRaisesRegex(ValueError,'exactly one explicit'):
            c.quantity_note('Quantity 12; and another Quantity 12')
        with self.assertRaisesRegex(ValueError,'exactly one explicit'):
            c.quantity_note('Quantity 1,2')
        self.assertEqual(str(c.quantity_note('Order!N: Quantity 12. Confirmed.')),'12')

    def test_source_checksum_rejects_altered_source(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'source.json'; file.write_text('source')
            with self.assertRaisesRegex(ValueError,'checksum mismatch'):
                c.need_sha(file,'0'*64,'Source')

    def test_failure_receipt_keeps_only_static_guard_detail_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); root.chmod(0o700)
            code,message=c.safe_failure(ValueError('ColdLion source identity changed'))
            c.write_failure_receipt(root,code,message)
            receipt=json.loads((root/'failure-receipt.json').read_text())
            self.assertEqual(receipt['static_guard_message'],'ColdLion source identity changed')
            self.assertEqual((root/'failure-receipt.json').stat().st_mode & 0o777,0o600)
            code,message=c.safe_failure(ValueError('licensed customer PO raw value'))
            self.assertEqual(message,None)
            self.assertTrue(code.startswith('failure_'))


if __name__=='__main__':
    unittest.main(verbosity=2)
