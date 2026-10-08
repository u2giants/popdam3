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

unittest.main()
