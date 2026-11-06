"""#5608/#5899: explicit line endings without changing historical default output."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parent/'verify/migration_body_md5.py'

class BodyHashTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'20261105061627_fixture.sql'
        self.bodies=['\nselect 1;\n',"\nselect 'é';\n"]
        self.path.write_bytes(("select $$"+self.bodies[0]+"$$; select $other$"+self.bodies[1]+"$other$;").encode())

    def run_cli(self,*args):
        return subprocess.run([sys.executable,str(SCRIPT),*args,str(self.path)],capture_output=True,text=True,check=True).stdout

    def expected(self,ending,both=False):
        lines=[]
        for body in self.bodies:
            encoded=(body if ending=='lf' else body.replace('\n','\r\n')).encode()
            parts=['20261105061627']+([ending.upper()] if both else [])+[hashlib.md5(encoded).hexdigest(),str(len(encoded)),repr(body[:60])]
            lines.append(' '.join(parts)+'\n')
        return lines

    def test_default_is_byte_for_byte_legacy_crlf_for_all_bodies(self):
        self.assertEqual(self.run_cli(),''.join(self.expected('crlf')))
        self.assertEqual(self.run_cli('--line-endings','crlf'),self.run_cli())

    def test_lf_uses_exact_utf8_byte_lengths(self):
        self.assertEqual(self.run_cli('--line-endings','lf'),''.join(self.expected('lf')))
        self.assertNotEqual(self.run_cli('--line-endings','lf'),self.run_cli())

    def test_both_is_labelled_and_preserves_body_order(self):
        lf,crlf=self.expected('lf',True),self.expected('crlf',True)
        self.assertEqual(self.run_cli('--line-endings','both'),''.join(a+b for a,b in zip(lf,crlf)))

    def test_crlf_source_normalizes_once_for_each_selected_mode(self):
        expected={mode:self.run_cli('--line-endings',mode) for mode in ['lf','crlf','both']}
        self.path.write_bytes(self.path.read_bytes().replace(b'\n',b'\r\n'))
        for mode in expected:self.assertEqual(self.run_cli('--line-endings',mode),expected[mode])

    def test_multiple_files_and_no_body_sentinel_remain_visible(self):
        empty=Path(self.temp.name)/'20261106161310_empty.sql';empty.write_text('select 1;')
        result=subprocess.run([sys.executable,str(SCRIPT),str(self.path),str(empty)],capture_output=True,text=True,check=True)
        self.assertEqual(result.stdout,''.join(self.expected('crlf'))+'20261106161310 - 0 <no dollar-quoted body in this file>\n')
        result=subprocess.run([sys.executable,str(SCRIPT),'--line-endings','both',str(empty)],capture_output=True,text=True,check=True)
        self.assertEqual(result.stdout,'20261106161310 LF - 0 <no dollar-quoted body in this file>\n20261106161310 CRLF - 0 <no dollar-quoted body in this file>\n')

    def test_no_args_and_invalid_choice_fail_loudly(self):
        result=subprocess.run([sys.executable,str(SCRIPT)],capture_output=True,text=True)
        self.assertEqual(result.returncode,2);self.assertIn('READ-ONLY',result.stderr)
        result=subprocess.run([sys.executable,str(SCRIPT),'--line-endings','invalid',str(self.path)],capture_output=True,text=True)
        self.assertEqual(result.returncode,2);self.assertIn('invalid choice',result.stderr)

if __name__=='__main__':unittest.main()
