import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('customs_loader',Path(__file__).resolve().parents[1]/'tools'/'load-customs-benchmark.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)

class PreservationTests(unittest.TestCase):
    def fixture(self,root):
        master=root/'master.xlsx';master.write_bytes(b'original spreadsheet bytes')
        source=root/'source';(source/'intelligence_20261101').mkdir(parents=True)
        data={k:[] for k in loader.SECTIONS}
        data['summary']={'master_sha256':loader.sha(master.read_bytes())}
        data['matches']=[{'style':'EXAMPLE-1','status':'Historical link candidate','hts':'0000.00.0000','extra':{'preserve':['all','unknown','fields']}},{'style':'EXAMPLE-2','status':'Packet-level candidate','hts':'0000.00.0000'},{'style':'EXAMPLE-3','status':'Clock component exclusion'}]
        data['suggestions']=[{'style':'EXAMPLE-4','reason':'family inference only'}]
        (source/'intelligence_20261101/intelligence.json').write_text(json.dumps(data))
        (source/'packet.pdf').write_bytes(b'%PDF\x00\xff\noriginal bytes')
        return source,master,data
    def test_preserves_bytes_unknown_context_and_exclusions(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source,master,data=self.fixture(root)
            ident,manifest,files,stored,rows=loader.inventory(source,master)
            self.assertEqual(stored,data)
            self.assertEqual(rows[0]['original_record']['extra'],data['matches'][0]['extra'])
            self.assertEqual([r['exact_historical_candidate'] for r in rows],[True,False,False,False])
            self.assertTrue(all(not r['current_law_verified'] for r in rows))
            self.assertEqual(len(manifest),3)
            self.assertEqual(ident,loader.inventory(source,master)[0])
            (source/'packet.pdf').write_bytes(b'changed')
            self.assertNotEqual(ident,loader.inventory(source,master)[0])
    def test_refuses_changed_master_and_symlink(self):
        with tempfile.TemporaryDirectory() as t:
            source,master,data=self.fixture(Path(t));master.write_bytes(b'changed')
            with self.assertRaises(ValueError):loader.inventory(source,master)
            master.write_bytes(b'original spreadsheet bytes');(source/'link').symlink_to(master)
            with self.assertRaises(ValueError):loader.inventory(source,master)
    def test_optimized_python_still_refuses_absent_dataset(self):
        script = f"""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('loader',{str(Path('tools/load-customs-benchmark.py').resolve())!r})
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
loader.inventory=lambda *args:('dataset',[],[],{{}},[])
loader.ObjectStore=lambda:object()
class EmptyDatabase:
    def __init__(self,*args):pass
    def query(self,*args):return []
loader.Database=EmptyDatabase
loader.run(SimpleNamespace(root='',master='',apply=False,archive_only=False,expected_ref='',project_ref_file=''))
"""
        result=subprocess.run([sys.executable,'-O','-c',script],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('ValueError: Dataset absent',result.stderr)
        self.assertNotIn('all_row_context_verified',result.stdout)

    def test_wrong_target_stops_before_api(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'project-ref';path.write_text('wrong')
            db=object.__new__(loader.Database);db.ref='expected';db.ref_file=path
            db.api=lambda *a,**k:self.fail('Wrong target reached API')
            with self.assertRaises(ValueError):db.query('select 1',write=True)

if __name__=='__main__':unittest.main()
