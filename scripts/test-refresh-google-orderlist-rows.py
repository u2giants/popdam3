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
unittest.main()
