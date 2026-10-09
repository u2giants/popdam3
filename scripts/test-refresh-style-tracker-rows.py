import importlib.util
import tempfile
from pathlib import Path
import csv
import unittest

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('refresh-style-tracker-rows.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SourceBoundaryTests(unittest.TestCase):
    def row(self, tab, typ, number=3):
        return ['1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214', tab, str(number), typ] + ['\\N'] * 15 + ['false', '\\N', '{}']
    def read(self, rows):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'rows.tsv'
            with p.open('w') as f: csv.writer(f,delimiter='\t').writerows(rows)
            return module.read_rows(p)
    def test_duplicate_refs_refused(self):
        row=self.row('License.Style','licensed')
        with self.assertRaises(ValueError): self.read([row,row,self.row('Generic.Style','generic')])
    def test_partial_export_refused(self):
        with self.assertRaises(ValueError): self.read([self.row('License.Style','licensed')])
    def test_shifted_columns_refused(self):
        with self.assertRaises(ValueError): self.read([self.row('License.Style','licensed')[:-1]])
    def test_wrong_workbook_refused(self):
        row=self.row('License.Style','licensed');row[0]='wrong'
        with self.assertRaises(ValueError): self.read([row,self.row('Generic.Style','generic')])
    def test_typed_nulls_and_boolean_preserved(self):
        rows=self.read([self.row('License.Style','licensed'),self.row('Generic.Style','generic')])
        self.assertIsNone(rows[0]['sku']);self.assertIs(rows[0]['discontinued'],False)
        self.assertEqual(rows[0]['source_row_number'],3)
    def test_wrong_socket_refused(self):
        from types import SimpleNamespace
        for user,port in [('postgres.wrong',5432),('postgres.'+module.TARGET,6543)]:
            with self.assertRaises(ValueError): module.prove(SimpleNamespace(info=SimpleNamespace(host='aws-1-us-east-1.pooler.supabase.com',user=user,port=port)))

    def test_unique_sku_identity_survives_row_move_and_edit(self):
        old=dict(zip(module.FIELDS, self.row('License.Style','licensed')))
        old['sku']=' STYLE ';old['id']='stable';old['source_row_number']=3
        new=dict(old);new['sku']='style';new['source_row_number']=99;new['description']='changed'
        self.assertEqual(module.identity_matches([old],[new])[0]['id'],'stable')
    def test_changed_duplicate_sku_is_not_guessed(self):
        old=dict(zip(module.FIELDS,self.row('License.Style','licensed')))
        old.update(sku='same',id='first',source_row_number=3)
        second=dict(old,id='second',description='other')
        new=dict(old,description='changed')
        new2=dict(second,description='also changed')
        self.assertEqual(module.identity_matches([old,second],[new,new2]),{})
    def test_crlf_inside_source_cell_is_preserved(self):
        a=self.row('License.Style','licensed');a[6]='first\r\nsecond'
        rows=self.read([a,self.row('Generic.Style','generic')])
        self.assertEqual(rows[0]['description'],'first\r\nsecond')

unittest.main()
