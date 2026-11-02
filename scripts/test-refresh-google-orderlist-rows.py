import importlib.util
from pathlib import Path
import unittest
sp=importlib.util.spec_from_file_location('refresh_orders',Path(__file__).with_name('refresh-google-orderlist-rows.py'))
s=importlib.util.module_from_spec(sp);sp.loader.exec_module(s)
class RefreshBoundaryTests(unittest.TestCase):
 def test_original_snapshot_and_manual_item_link_survive(self):
  old={'sku':' STYLE ','item_id':'confirmed','master_data_match_status':'manual','metadata':{'order_list_snapshot':{'description':'original'},'review':'kept'}}
  desired={'sku':'style','item_id':'weaker','master_data_match_status':'unmatched'}
  actual=s.merged_payload(old,desired,{'order_list_snapshot':{'description':'latest'}},s.m.LINE_COLUMNS)
  self.assertEqual(actual['item_id'],'confirmed');self.assertEqual(actual['master_data_match_status'],'manual')
  self.assertEqual(actual['metadata']['original_order_list_snapshot'],{'description':'original'});self.assertEqual(actual['metadata']['review'],'kept')
 def test_item_link_is_not_carried_to_a_different_style(self):
  old={'sku':'first','item_id':'first-id','metadata':{}}
  desired={'sku':'second','item_id':'second-id'}
  self.assertEqual(s.merged_payload(old,desired,{},s.m.LINE_COLUMNS)['item_id'],'second-id')
 def test_unknown_quantity_is_not_a_cross_source_key(self):
  self.assertIsNone(s.overlap_key({'sku':'style','customer_po_number':'PO','quantity_ordered':None}))
 def test_negative_and_zero_quantities_are_real_keys(self):
  for value in [-3,0]:self.assertEqual(s.overlap_key({'sku':'style','customer_po_number':'PO','quantity_ordered':value}),('po','style',str(value)))
 def test_source_identity_only_trims_and_casefolds(self):
  self.assertNotEqual(s.overlap_key({'sku':'A-B','customer_po_number':'PO','quantity_ordered':1}),s.overlap_key({'sku':'AB','customer_po_number':'PO','quantity_ordered':1}))
 def test_blank_quantity_matches_coldlion_po_and_style(self):
  self.assertEqual(s.blank_quantity_key({'sku':' CAC62DCJK01 ','customer_po_number':'62011483','quantity_ordered':None}),('62011483','cac62dcjk01'))
  self.assertIsNone(s.blank_quantity_key({'sku':'a','customer_po_number':'PO','quantity_ordered':5}))
  self.assertIsNone(s.blank_quantity_key({'sku':'','customer_po_number':'PO','quantity_ordered':None}))
 def test_wrong_connection_refused(self):
  from types import SimpleNamespace
  c=SimpleNamespace(info=SimpleNamespace(host='wrong',user='postgres.'+s.TARGET,port=5432))
  with self.assertRaises(ValueError):s.prove(c)
 def test_first_snapshot_is_not_replaced_on_second_refresh(self):
  old={'sku':'a','item_id':None,'metadata':{'order_list_snapshot':{'description':'previous'},'original_order_list_snapshot':{'description':'first'}}}
  actual=s.merged_payload(old,{'sku':'a'},{'order_list_snapshot':{'description':'now'}},s.m.LINE_COLUMNS)
  self.assertEqual(actual['metadata']['original_order_list_snapshot'],{'description':'first'})
 def test_decimal_database_json_has_same_quantity(self):
  from decimal import Decimal
  self.assertEqual(s.changed_fields({'quantity_ordered':Decimal('5.00')},{'quantity_ordered':5}),[])
  self.assertEqual(s.changed_fields({'quantity_ordered':Decimal('5.25')},{'quantity_ordered':5.25}),[])
 def test_quantity_scale_does_not_hide_overlap(self):
  from decimal import Decimal
  a={'sku':'style','customer_po_number':'PO','quantity_ordered':Decimal('10.000')}
  b=dict(a,quantity_ordered=10.0)
  self.assertEqual(s.overlap_key(a),s.overlap_key(b))
 def test_customer_link_survives_unchanged_source_name(self):
  from types import SimpleNamespace
  order=SimpleNamespace(payload={},metadata={'customer_name':' SAME '})
  old={'company_id':'known','factory_id':None,'metadata':{'customer_name':'same'}}
  self.assertEqual(s.order_payload(old,order)['company_id'],'known')
  order.metadata['customer_name']='different'
  self.assertIsNone(s.order_payload(old,order)['company_id'])
 def test_same_source_refresh_does_not_add_a_redundant_snapshot(self):
  snapshot={'description':'same'}
  old={'sku':'a','metadata':{'order_list_snapshot':snapshot}}
  actual=s.merged_payload(old,{'sku':'a'},{'order_list_snapshot':snapshot},s.m.LINE_COLUMNS)
  self.assertEqual(actual['metadata'],old['metadata'])
 def test_sheet_row_cannot_silently_replace_style_identity(self):
  from types import SimpleNamespace
  line=SimpleNamespace(payload={'sku':'changed'},source_id='order:row:2')
  with self.assertRaises(ValueError):s.assert_existing_identity({'sku':'original','production_order_id':'parent'},line,'parent')
 def test_sheet_row_cannot_silently_move_to_a_different_order(self):
  from types import SimpleNamespace
  line=SimpleNamespace(payload={'sku':'same'},source_id='order:row:2')
  with self.assertRaises(ValueError):s.assert_existing_identity({'sku':'same','production_order_id':'original'},line,'different')
 def test_unchanged_logical_identity_and_new_lines_remain_supported(self):
  from types import SimpleNamespace
  line=SimpleNamespace(payload={'sku':' SAME '},source_id='order:row:2')
  s.assert_existing_identity({'sku':'same','production_order_id':'parent'},line,'parent')
  s.assert_existing_identity(None,line,None)
 def test_only_placeholder_and_cancellation_parent_moves_are_allowed(self):
  from types import SimpleNamespace
  old={'sku':'a','production_order_id':'old'}
  line=SimpleNamespace(payload={'sku':'a'},source_id='order:row:7',sheet_row=7,order_source_id='order:po:d1-cancelled')
  s.assert_existing_identity(old,line,None,{'production_order_number':'D1'})
  s.assert_existing_identity(old,line,None,{'production_order_number':'GOOGLE-ROW-7'})
  for number in ['D2','GOOGLE-ROW-8']:
   with self.assertRaises(ValueError):s.assert_existing_identity(old,line,None,{'production_order_number':number})
  with self.assertRaises(ValueError):s.assert_existing_identity(old,line,None)
 def test_exact_google_correction_survives_replay(self):
  correction={'version':1,'source_id':'order:row:7','original':{'sku':'SKU','customer_po_number':'OLD'},'corrected':{'sku':'SKU','customer_po_number':'NEW'},'evidence_ref':'issue636'}
  old={'sku':'SKU','customer_po_number':'NEW','metadata':{'orderlist_google_correction':correction}}
  desired={'sku':'SKU','customer_po_number':'OLD'}
  for _ in range(2):
   result=s.merged_payload(old,desired,{},s.m.LINE_COLUMNS,'order:row:7')
   self.assertEqual(result['customer_po_number'],'NEW')
   old=result
  self.assertEqual(desired['customer_po_number'],'OLD')
 def test_google_correction_rejects_changed_source_and_other_source_id(self):
  correction={'version':1,'source_id':'order:row:7','original':{'sku':'SKU','customer_po_number':'OLD'},'corrected':{'sku':'SKU','customer_po_number':'NEW'},'evidence_ref':'issue636'}
  old={'sku':'SKU','customer_po_number':'NEW','metadata':{'orderlist_google_correction':correction}}
  for desired,sid in [({'sku':'SKU','customer_po_number':'CHANGED'},'order:row:7'),({'sku':'OTHER','customer_po_number':'OLD'},'order:row:7'),({'sku':'SKU','customer_po_number':'OLD'},'order:row:8')]:
   with self.assertRaisesRegex(ValueError,'held without changes'):
    s.merged_payload(old,desired,{},s.m.LINE_COLUMNS,sid)
 def test_google_correction_cannot_write_unrelated_fields(self):
  correction={'version':1,'source_id':'order:row:7','original':{'sku':'SKU','customer_po_number':'OLD'},'corrected':{'sku':'SKU','customer_po_number':'NEW','quantity_ordered':619},'evidence_ref':'issue636'}
  with self.assertRaisesRegex(ValueError,'held without changes'):
   s.merged_payload({'sku':'SKU','metadata':{'orderlist_google_correction':correction}},{'sku':'SKU','customer_po_number':'OLD'},{},s.m.LINE_COLUMNS,'order:row:7')
 def test_first_sku_correction_replays_with_its_current_item_link(self):
  from types import SimpleNamespace
  c={'version':1,'source_id':'order:row:7','original':{'sku':'RAW','customer_po_number':'PO'},'corrected':{'sku':'FIXED','customer_po_number':'PO'},'evidence_ref':'editor5403'}
  old={'sku':'FIXED','customer_po_number':'PO','production_order_id':'parent','item_id':'fixed-item','master_data_match_status':'manual','metadata':{'orderlist_google_correction':c}}
  line=SimpleNamespace(payload={'sku':'RAW','customer_po_number':'PO','item_id':'raw-item','master_data_match_status':'matched'},source_id='order:row:7')
  s.assert_existing_identity(old,line,'parent')
  result=s.merged_payload(old,line.payload,{},s.m.LINE_COLUMNS,line.source_id)
  self.assertEqual(result['sku'],'FIXED');self.assertEqual(result['item_id'],'fixed-item')
  self.assertEqual(result['master_data_match_status'],'manual')
 def test_repeated_sku_edits_keep_original_source_and_latest_correction(self):
  from types import SimpleNamespace
  c={'version':1,'source_id':'order:row:7','original':{'sku':'RAW','customer_po_number':'PO'},'corrected':{'sku':'SECOND-FIX','customer_po_number':'NEW-PO'},'evidence_ref':'editor5403'}
  old={'sku':'SECOND-FIX','customer_po_number':'NEW-PO','production_order_id':'parent','metadata':{'orderlist_google_correction':c}}
  line=SimpleNamespace(payload={'sku':'RAW','customer_po_number':'PO'},source_id='order:row:7')
  for _ in range(2):
   s.assert_existing_identity(old,line,'parent')
   result=s.merged_payload(old,line.payload,{},s.m.LINE_COLUMNS,line.source_id)
   self.assertEqual(result['sku'],'SECOND-FIX');self.assertEqual(result['customer_po_number'],'NEW-PO')
   self.assertEqual(result['metadata']['orderlist_google_correction']['original'],{'sku':'RAW','customer_po_number':'PO'})
   old={**old,**result}
 def test_sku_exception_never_accepts_wrong_source_changed_source_or_stale_endpoint(self):
  from types import SimpleNamespace
  c={'version':1,'source_id':'order:row:7','original':{'sku':'RAW','customer_po_number':'PO'},'corrected':{'sku':'FIXED','customer_po_number':'PO'},'evidence_ref':'editor5403'}
  old={'sku':'FIXED','customer_po_number':'PO','production_order_id':'parent','metadata':{'orderlist_google_correction':c}}
  for sku,po,sid in [('RAW','PO','order:row:8'),('OTHER','PO','order:row:7'),('RAW','CHANGED','order:row:7')]:
   line=SimpleNamespace(payload={'sku':sku,'customer_po_number':po},source_id=sid)
   with self.assertRaisesRegex(ValueError,'held without changes'):s.assert_existing_identity(old,line,'parent')
  line=SimpleNamespace(payload={'sku':'RAW','customer_po_number':'PO'},source_id='order:row:7')
  with self.assertRaisesRegex(ValueError,'held without changes'):s.assert_existing_identity({**old,'sku':'UNRECORDED-EDIT'},line,'parent')
 def test_valid_sku_correction_does_not_authorize_parent_move(self):
  from types import SimpleNamespace
  c={'version':1,'source_id':'order:row:7','original':{'sku':'RAW','customer_po_number':'PO'},'corrected':{'sku':'FIXED','customer_po_number':'PO'},'evidence_ref':'editor5403'}
  old={'sku':'FIXED','customer_po_number':'PO','production_order_id':'parent','metadata':{'orderlist_google_correction':c}}
  line=SimpleNamespace(payload={'sku':'RAW','customer_po_number':'PO'},source_id='order:row:7',sheet_row=7,order_source_id='order:po:unrelated')
  with self.assertRaisesRegex(ValueError,'identity changed'):s.assert_existing_identity(old,line,'different',{'production_order_number':'original'})
unittest.main()
