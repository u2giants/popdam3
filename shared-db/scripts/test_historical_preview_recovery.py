import subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from historical_preview_recovery import (
    SCHEMA_V3, SCHEMA_V4, parse_original_run_map, parse_source_map, parse_versions,
    prove_pr_authored, verify,
)

# The original-run map is mandatory: without it a recovery waives byte
# equality entirely. Every call below therefore supplies one.
RUNS = {"20260813210000": "20260813210000:5001"}

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
            result=verify(924,sha,"20260813210000",root,api,original_run_map=RUNS["20260813210000"])
            self.assertEqual(result["allowlist"],["20260813210000"])
            self.assertEqual(result["schema"],SCHEMA_V3)
            with self.assertRaisesRegex(ValueError,"did not author"):
                verify(924,sha,"20260813210000,20260813220000",root,api,
                       original_run_map=RUNS["20260813210000"] + ",20260813220000:5002")
            def edited_api(path):
                return {"merged":True,"merge_commit_sha":sha} if "/files" not in path else [{"filename":"supabase/migrations/20260813210000_a.sql","status":"modified"}]
            with self.assertRaisesRegex(ValueError,"did not author"):
                verify(924,sha,"20260813210000",root,edited_api,original_run_map=RUNS["20260813210000"])


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

    def rendered_runs(self):
        return ",".join(f"{v}:{9000 + i}" for i, v in enumerate(sorted(self.VERSIONS)))

    def rendered(self):
        return ",".join(f"{v}:{pr}" for v, pr in sorted(self.VERSIONS.items()))

    def test_three_pull_requests_each_prove_their_own_migration(self):
        t, root, sha = self.build()
        with t:
            result = verify(None, sha, ",".join(sorted(self.VERSIONS)), root,
                            self.api_for(sha), source_map=self.rendered(),
                            original_run_map=self.rendered_runs())
            self.assertEqual(result["schema"], SCHEMA_V4)
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
                       self.api_for(sha), source_map=swapped,
                       original_run_map=self.rendered_runs())

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
                    verify(None, sha, allow, root, self.api_for(sha), source_map=bad,
                       original_run_map=self.rendered_runs())

    def test_malformed_map_entries_are_refused(self):
        t, root, sha = self.build()
        with t:
            allow = ",".join(sorted(self.VERSIONS))
            for bad in ("984", "20260814130000", "20260814130000:", ":984",
                        "2026081413000:984", "20260814130000:abc"):
                with self.subTest(entry=bad), self.assertRaises(ValueError):
                    verify(None, sha, allow, root, self.api_for(sha), source_map=bad,
                       original_run_map=self.rendered_runs())

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
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root, api, source_map=self.rendered(),
                       original_run_map=self.rendered_runs())

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
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root, api, source_map=self.rendered(),
                       original_run_map=self.rendered_runs())

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
                verify(None, sha, ",".join(sorted(self.VERSIONS)), root, api, source_map=self.rendered(),
                       original_run_map=self.rendered_runs())

    def test_single_pr_form_still_works_and_keeps_its_schema(self):
        """v1 callers must be untouched, so existing evidence stays verifiable."""
        t, root, sha = self.build()
        with t:
            def api(path):
                if "/files" not in path:
                    return {"merged": True, "merge_commit_sha": sha}
                return [{"filename": f"supabase/migrations/{v}_release_a.sql", "status": "added"}
                        for v in self.VERSIONS]
            result = verify(984, sha, ",".join(sorted(self.VERSIONS)), root, api,
                            original_run_map=self.rendered_runs())
            self.assertEqual(result["schema"], SCHEMA_V3)
            self.assertEqual(result["sourcePr"], 984)
            self.assertNotIn("sourcePrMap", result)




class PerConditionParserTests(unittest.TestCase):
    """Every condition of every multi-condition guard in this module, alone.

    THE SHAPE THIS EXISTS TO KILL (#1213 round 9, the author's own hunt). The
    round-9 review found a four-key loop in the production gate where only ONE
    key had a test, and noted that a per-GUARD mutation sweep cannot see that: a
    guard counts as covered the moment any one of its conditions reddens the
    suite. So this module's guards were re-checked one CONDITION at a time, and
    three of them had no negative test at all:

      * `parse_versions` -- none of its three conditions;
      * `parse_original_run_map` -- none of its FIVE, in either test file. The
        module docstring calls `--original-run-map` "not a label -- it is the
        proof", and every one of its refusal paths was unexercised;
      * `prove_pr_authored` -- the merged-but-malformed-merge_commit_sha half of
        a two-operand guard. The shared `api_for` helper hardcodes a good SHA, so
        that half needed its own closure.

    Each case below drives ONE condition. Deleting any single operand from any of
    these guards must redden this file.
    """

    def test_parse_versions_refuses_each_bad_shape_separately(self):
        for label, raw in (
            ("empty", ""),
            ("blank separators only", " , , "),
            ("out of order", "20260813220000,20260813210000"),
            ("duplicated", "20260813210000,20260813210000"),
            ("not fourteen digits", "2026081321000"),
            ("not digits at all", "not-a-version"),
        ):
            with self.subTest(label), self.assertRaisesRegex(
                ValueError, "unique, ordered 14-digit versions"
            ):
                parse_versions(raw)
        # The honest shape still parses, or every case above passes vacuously.
        self.assertEqual(
            parse_versions(" 20260813210000 , 20260813220000 "),
            ["20260813210000", "20260813220000"],
        )

    def test_parse_original_run_map_refuses_each_bad_shape_separately(self):
        versions = ["20260813210000", "20260813220000"]
        one = ["20260813210000"]
        for label, raw, vs, message in (
            ("entry is not version:run", "20260813210000", one,
             "entries must be version:run-id"),
            ("run id is not a number", "20260813210000:abc", one,
             "entries must be version:run-id"),
            ("version is not fourteen digits", "2026081321:5001", one,
             "entries must be version:run-id"),
            ("same version named twice", "20260813210000:5001,20260813210000:5002", one,
             "names 20260813210000 more than once"),
            ("run id zero", "20260813210000:0", one,
             "non-positive run id for 20260813210000"),
            ("map missing a version", "20260813210000:5001", versions,
             "must name exactly the allowlisted versions"),
            ("map names an extra version", "20260813210000:5001,20260813220000:5002", one,
             "must name exactly the allowlisted versions"),
            ("map absent entirely", "", one,
             "must name exactly the allowlisted versions"),
            ("map is None", None, one,
             "must name exactly the allowlisted versions"),
        ):
            with self.subTest(label), self.assertRaisesRegex(ValueError, message):
                parse_original_run_map(raw, vs)
        self.assertEqual(
            parse_original_run_map("20260813210000:5001,20260813220000:5002", versions),
            {"20260813210000": 5001, "20260813220000": 5002},
        )

    def test_parse_source_map_refuses_a_run_id_shaped_entry_and_covers_exactly(self):
        """The twin parser, so the two cannot drift apart unnoticed."""
        one = ["20260813210000"]
        for label, raw, message in (
            ("entry is not version:pr", "20260813210000", "entries must be version:pull-request"),
            ("same version twice", "20260813210000:1,20260813210000:2", "more than once"),
            ("missing a version", "", "exactly the allowlisted versions"),
        ):
            with self.subTest(label), self.assertRaisesRegex(ValueError, message):
                parse_source_map(raw, one)
        self.assertEqual(parse_source_map("20260813210000:984", one), {"20260813210000": 984})

    def test_a_merged_pull_request_without_a_usable_merge_commit_is_refused(self):
        """The OTHER operand of `pr.get("merged") is not True or not <40 hex>`.

        `test_unmerged_pull_request_in_the_map_is_refused` drives the first half.
        The shared `api_for` helper hardcodes a real SHA, so the second half --
        merged is True but `merge_commit_sha` is missing or malformed -- had no
        test and no way to be expressed through it. Without this the operand can
        be deleted and `git merge-base --is-ancestor` is handed whatever the API
        returned, including None.
        """
        for label, sha in (
            ("no merge commit at all", None),
            ("empty merge commit", ""),
            ("not a sha", "not-a-sha"),
            ("too short", "abc123"),
            ("uppercase, which git would resolve but the regex must not accept", "A" * 40),
        ):
            def api(path, sha=sha):
                if "/files" in path:
                    return []
                return {"merged": True, "merge_commit_sha": sha}
            with self.subTest(label), self.assertRaisesRegex(ValueError, "is not merged"):
                prove_pr_authored(924, "b" * 40, ["20260813210000"], Path("."), api)


class CommandLineTests(unittest.TestCase):
    """The two mutually-exclusive-argument guards in `__main__`.

    Neither had a test: both existing suites import `verify` directly, so the
    entry point's own refusals were never executed. A recovery invoked with
    neither source argument, or with both, must die with exit 2 rather than
    reach `verify` with an ambiguous provenance claim.
    """

    SCRIPT = str(Path(__file__).parent / "historical_preview_recovery.py")

    def run_cli(self, *extra):
        with tempfile.TemporaryDirectory() as t:
            return subprocess.run(
                [sys.executable, self.SCRIPT,
                 "--original-run-map", "20260813210000:5001",
                 "--main-sha", "b" * 40,
                 "--allowlist", "20260813210000",
                 "--output", str(Path(t, "out.json")), *extra],
                capture_output=True, text=True,
            )

    def test_neither_source_pr_nor_source_map_is_refused(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 2)
        self.assertIn("needs --source-pr or --source-map", result.stdout + result.stderr)

    def test_both_source_pr_and_source_map_is_refused(self):
        result = self.run_cli("--source-pr", "984", "--source-map", "20260813210000:984")
        self.assertEqual(result.returncode, 2)
        self.assertIn("not both", result.stdout + result.stderr)


if __name__=="__main__": unittest.main()
