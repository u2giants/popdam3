import subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from historical_preview_recovery import SCHEMA_V1, SCHEMA_V2, verify

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
            self.assertEqual(result["schema"],SCHEMA_V1)
            with self.assertRaisesRegex(ValueError,"did not author"):
                verify(924,sha,"20260813210000,20260813220000",root,api)
            def edited_api(path):
                return {"merged":True,"merge_commit_sha":sha} if "/files" not in path else [{"filename":"supabase/migrations/20260813210000_a.sql","status":"modified"}]
            with self.assertRaisesRegex(ValueError,"did not author"):
                verify(924,sha,"20260813210000",root,edited_api)


class PerVersionSourceMapTests(unittest.TestCase):
    """A batch authored across SEVERAL pull requests.

    Sample Tracking Release A is the real case: 20260814130000 came from PR #984,
    20260814193402 from #992, and the reconciliation from #1126. A single-PR proof
    can never cover that, and the versions can never be re-rehearsed on preview
    because an applied version is refused. Each version must therefore be proven
    against its OWN pull request, to exactly the standard the single-PR proof used.
    """

    VERSIONS = {"20260814130000": 984, "20260814193402": 992, "20260818024441": 1126}

    def build(self):
        t = tempfile.TemporaryDirectory()
        root = Path(t.name)
        subprocess.run(["git","init"],cwd=root,check=True,stdout=subprocess.DEVNULL)
        subprocess.run(["git","config","user.email","x@y"],cwd=root)
        subprocess.run(["git","config","user.name","x"],cwd=root)
        migrations = root/"supabase/migrations"; migrations.mkdir(parents=True)
        for version in self.VERSIONS:
            (migrations/f"{version}_release_a.sql").write_text("select 1;")
        subprocess.run(["git","add","."],cwd=root)
        subprocess.run(["git","commit","-m","x"],cwd=root,check=True,stdout=subprocess.DEVNULL)
        sha = subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip()
        return t, root, sha

    def api_for(self, sha, authored=None):
        """Each PR reports having ADDED exactly its own migration."""
        authored = authored or {pr: v for v, pr in self.VERSIONS.items()}
        def api(path):
            pr = int(path.split("/pulls/")[1].split("/")[0].split("?")[0])
            if "/files" not in path:
                return {"merged": True, "merge_commit_sha": sha}
            version = authored.get(pr)
            if version is None:
                return []
            return [{"filename": f"supabase/migrations/{version}_release_a.sql", "status": "added"}]
        return api

    def rendered(self):
        return ",".join(f"{v}:{pr}" for v, pr in sorted(self.VERSIONS.items()))

    def test_three_pull_requests_each_prove_their_own_migration(self):
        t, root, sha = self.build()
        with t:
            result = verify(None, sha, ",".join(sorted(self.VERSIONS)), root,
                            self.api_for(sha), source_map=self.rendered())
            self.assertEqual(result["schema"], SCHEMA_V2)
            self.assertEqual(result["sourcePrMap"], self.VERSIONS)
            self.assertEqual(result["allowlist"], sorted(self.VERSIONS))
            self.assertEqual(set(result["sourceMergeShas"]), set(self.VERSIONS))

    def test_map_naming_the_wrong_pull_request_for_a_version_is_refused(self):
        """The forgery this must stop: borrowing a real, merged, unrelated PR."""
        t, root, sha = self.build()
        with t:
            swapped = self.rendered().replace("20260814130000:984", "20260814130000:992")
            with self.assertRaisesRegex(ValueError, "did not author"):
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root,
                       self.api_for(sha), source_map=swapped)

    def test_map_must_cover_the_batch_exactly(self):
        t, root, sha = self.build()
        with t:
            allow = ",".join(sorted(self.VERSIONS))
            for name, bad in {
                "missing a version": "20260814130000:984,20260814193402:992",
                "extra version": self.rendered() + ",20260901000000:1200",
                "duplicate version": self.rendered() + ",20260814130000:984",
            }.items():
                with self.subTest(name=name), self.assertRaises(ValueError):
                    verify(None, sha, allow, root, self.api_for(sha), source_map=bad)

    def test_malformed_map_entries_are_refused(self):
        t, root, sha = self.build()
        with t:
            allow = ",".join(sorted(self.VERSIONS))
            for bad in ("984", "20260814130000", "20260814130000:", ":984",
                        "2026081413000:984", "20260814130000:abc"):
                with self.subTest(entry=bad), self.assertRaises(ValueError):
                    verify(None, sha, allow, root, self.api_for(sha), source_map=bad)

    def test_unmerged_pull_request_in_the_map_is_refused(self):
        t, root, sha = self.build()
        with t:
            def api(path):
                pr = int(path.split("/pulls/")[1].split("/")[0].split("?")[0])
                if "/files" not in path:
                    return {"merged": pr != 992, "merge_commit_sha": sha}
                version = {v: k for k, v in self.VERSIONS.items()}.get(pr)
                return [{"filename": f"supabase/migrations/{version}_release_a.sql", "status": "added"}]
            with self.assertRaisesRegex(ValueError, "not merged"):
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root, api, source_map=self.rendered())

    def test_pull_request_not_ancestor_of_exact_main_is_refused(self):
        """A PR merged onto some other line of history must not count."""
        t, root, sha = self.build()
        with t:
            orphan = subprocess.check_output(
                ["git","commit-tree","-m","orphan", f"{sha}^{{tree}}"], cwd=root, text=True).strip()
            def api(path):
                if "/files" not in path:
                    return {"merged": True, "merge_commit_sha": orphan}
                pr = int(path.split("/pulls/")[1].split("/")[0].split("?")[0])
                version = {v: k for k, v in self.VERSIONS.items()}.get(pr)
                return [{"filename": f"supabase/migrations/{version}_release_a.sql", "status": "added"}]
            with self.assertRaises(subprocess.CalledProcessError):
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root, api, source_map=self.rendered())

    def test_a_modified_not_added_migration_is_refused(self):
        """Authorship means ADDED. A later edit must not masquerade as authorship."""
        t, root, sha = self.build()
        with t:
            def api(path):
                if "/files" not in path:
                    return {"merged": True, "merge_commit_sha": sha}
                pr = int(path.split("/pulls/")[1].split("/")[0].split("?")[0])
                version = {v: k for k, v in self.VERSIONS.items()}.get(pr)
                status = "modified" if pr == 1126 else "added"
                return [{"filename": f"supabase/migrations/{version}_release_a.sql", "status": status}]
            with self.assertRaisesRegex(ValueError, "did not author"):
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root, api, source_map=self.rendered())

    def test_single_pr_form_still_works_and_keeps_its_schema(self):
        """v1 callers must be untouched, so existing evidence stays verifiable."""
        t, root, sha = self.build()
        with t:
            def api(path):
                if "/files" not in path:
                    return {"merged": True, "merge_commit_sha": sha}
                return [{"filename": f"supabase/migrations/{v}_release_a.sql", "status": "added"}
                        for v in self.VERSIONS]
            result = verify(984, sha, ",".join(sorted(self.VERSIONS)), root, api)
            self.assertEqual(result["schema"], SCHEMA_V1)
            self.assertEqual(result["sourcePr"], 984)
            self.assertNotIn("sourcePrMap", result)


if __name__=="__main__": unittest.main()
