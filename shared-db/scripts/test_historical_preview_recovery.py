import subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from historical_preview_recovery import verify

class Tests(unittest.TestCase):
    def test_source_pr_must_contain_every_exact_migration(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); subprocess.run(["git","init"],cwd=root,check=True,stdout=subprocess.DEVNULL)
            subprocess.run(["git","config","user.email","x@y"],cwd=root);subprocess.run(["git","config","user.name","x"],cwd=root)
            p=root/"supabase/migrations";p.mkdir(parents=True);(p/"20260813210000_a.sql").write_text("select 1;")
            subprocess.run(["git","add","."],cwd=root);subprocess.run(["git","commit","-m","x"],cwd=root,check=True,stdout=subprocess.DEVNULL)
            sha=subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip()
            def api(path):
                return {"merged":True,"merge_commit_sha":sha} if "/pulls/924" in path and "/files" not in path else [{"filename":"supabase/migrations/20260813210000_a.sql","status":"added"}]
            result=verify(924,sha,"20260813210000",root,api)
            self.assertEqual(result["allowlist"],["20260813210000"])
            with self.assertRaisesRegex(ValueError,"did not author"):
                verify(924,sha,"20260813210000,20260813220000",root,api)
            def edited_api(path):
                return {"merged":True,"merge_commit_sha":sha} if "/files" not in path else [{"filename":"supabase/migrations/20260813210000_a.sql","status":"modified"}]
            with self.assertRaisesRegex(ValueError,"did not author"):
                verify(924,sha,"20260813210000",root,edited_api)

if __name__=="__main__": unittest.main()
