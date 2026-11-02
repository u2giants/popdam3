import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('apply-orderlist-source-corrections.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
L='00000000-0000-0000-0000-000000000001'
REF={'id':'r1','source_system':'coldlion','source_id':'coldlion:so:123:line:1:component:1','metadata':{'master_item_no':'PACK','sub_item_no':'RAW','sub_label_code':None}}
C={'version':1,'source_id':REF['source_id'],'original_sku':'RAW','canonical_sku':'CORRECT','original_customer_po':'PO','canonical_customer_po':'PO','evidence_ref':'issue636'}

def packet():
 return {'version':1,'project_ref':m.TARGET,'evidence_ref':'issue636','preimages':[{'line':{'id':L,'voided_at':None},'header':{'id':'h'},'refs':[copy.deepcopy(REF)]}],
  'operations':[{'kind':'coldlion_identity','line_id':L,'correction':copy.deepcopy(C)}]}

class PacketTests(unittest.TestCase):
 def test_exact_source_bound_packet_accepted(self):
  self.assertEqual(list(m.validate_manifest(packet())),[L])
 def test_other_project_missing_preimage_or_changed_source_ref_refused(self):
  for change in ['project','preimage','source']:
   p=packet()
   if change=='project':p['project_ref']='wrong'
   elif change=='preimage':p['preimages']=[]
   else:p['operations'][0]['correction']['source_id']='coldlion:so:999:line:1:component:1'
   with self.assertRaises(ValueError):m.validate_manifest(p)
 def test_duplicate_operation_and_extra_write_field_refused(self):
  p=packet();p['operations'].append(copy.deepcopy(p['operations'][0]))
  with self.assertRaises(ValueError):m.validate_manifest(p)
  p=packet();p['operations'][0]['correction']['quantity_ordered']=619
  with self.assertRaises(ValueError):m.validate_manifest(p)
 def test_supersession_cannot_void_a_google_consolidated_line(self):
  p=packet();p['operations']=[{'kind':'void_superseded','line_id':L,'reason':'source superseded','replacement_source_ids':['coldlion:new']}]
  p['preimages'][0]['refs'].append({'source_system':'google_order_list'})
  with self.assertRaisesRegex(ValueError,'unmerged'):m.validate_manifest(p)
 def test_changed_preimage_fails_before_any_write(self):
  class Cursor:
   def fetchone(self):return ({'id':L,'voided_at':'changed'},)
  class Connection:
   def execute(self,sql,args):
    self.assert_read(sql);return Cursor()
   def assert_read(self,sql):
    if not sql.startswith('select '):raise AssertionError('unexpected mutation')
  with self.assertRaisesRegex(ValueError,'preimage changed'):
   m.verify_preimages(Connection(),m.validate_manifest(packet()))
 def test_changed_source_cells_fail_before_any_write(self):
  class Cursor:
   def fetchall(self):return [('CHANGED','PO')]
  class Connection:
   def execute(self,sql,args):
    if not sql.startswith('with '):raise AssertionError('unexpected mutation')
    return Cursor()
  p=packet()
  with self.assertRaisesRegex(ValueError,'source cells changed'):
   m.verify_sources(Connection(),p,m.validate_manifest(p))

class CancellationTests(unittest.TestCase):
 def test_only_verified_full_source_cancellation_can_be_marked(self):
  p=packet();p['operations']=[{'kind':'mark_source_cancelled','line_id':L,'cancellation':{'version':1,'source_id':REF['source_id'],'line_qty':75,'line_cancelled_qty':75,'evidence_ref':'issue636'}}]
  self.assertEqual(list(m.validate_manifest(p)),[L])
  p['operations'][0]['cancellation']['line_cancelled_qty']=74
  with self.assertRaisesRegex(ValueError,'fully cancelled'):m.validate_manifest(p)
 def test_changed_cancellation_never_silently_reopens_history(self):
  p=packet();p['preimages'][0]['line'].update(sku='RAW',customer_po_number='PO')
  p['operations']=[{'kind':'mark_source_cancelled','line_id':L,'cancellation':{'version':1,'source_id':REF['source_id'],'line_qty':75,'line_cancelled_qty':75,'evidence_ref':'issue636'}}]
  class Cursor:
   def fetchall(self):return [('RAW','PO',75,0)]
  class Connection:
   def execute(self,sql,args):
    if not sql.startswith('with '):raise AssertionError('unexpected mutation')
    return Cursor()
  with self.assertRaisesRegex(ValueError,'cancellation changed'):
   m.verify_sources(Connection(),p,m.validate_manifest(p))
unittest.main()
