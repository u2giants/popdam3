import hashlib
import json
import re
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import PREVIEW_PRODUCER_PATHS, PREVIEW_WORKFLOW, RiskGateError, canonical_sha256, classify_sql, decide_business_risk, gh_json, is_pinned_historical_disney_source, load_activation, prove_activation, prove_preview, prove_preview_migration_contents


class ProductionBusinessRiskGateTests(unittest.TestCase):
    def test_live_owner_comment_read_retries_transient_failure(self):
        responses=iter([
            subprocess.CompletedProcess([],1,"","HTTP 503: unavailable"),
            subprocess.CompletedProcess([],0,'{"author_association":"OWNER"}',""),
        ])
        sleeps=[]
        result=gh_json("repos/u2giants/shared-db/issues/comments/7",
            runner=lambda *a,**k: next(responses),sleep=sleeps.append)
        self.assertEqual(result,{"author_association":"OWNER"})
        self.assertEqual(sleeps,[1])

    def test_non_comment_evidence_read_never_retries(self):
        calls=[]
        def runner(*args,**kwargs):
            calls.append(1); return subprocess.CompletedProcess([],1,"","HTTP 503: unavailable")
        with self.assertRaisesRegex(RiskGateError,"HTTP 503"):
            gh_json("repos/u2giants/shared-db/pulls/1108",runner=runner,
                sleep=lambda _: self.fail("non-comment read slept"))
        self.assertEqual(len(calls),1)

    def test_live_owner_comment_permanent_absence_never_retries(self):
        calls=[]
        def runner(*args,**kwargs):
            calls.append(1); return subprocess.CompletedProcess([],1,"","HTTP 404: Not Found")
        with self.assertRaisesRegex(RiskGateError,"HTTP 404"):
            gh_json("repos/u2giants/shared-db/issues/comments/7",runner=runner,
                sleep=lambda _: self.fail("permanent absence slept"))
        self.assertEqual(len(calls),1)

    def atomic_preview_fixture(self):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        migrations = root / "supabase/migrations"
        migrations.mkdir(parents=True)
        config = root / "config"
        config.mkdir()
        version = "20260816110750"
        filename = migrations / f"{version}_safe_forward.sql"
        filename.write_text("lock table plm.bridge in share mode;\n", encoding="utf-8")
        digest = canonical_sha256(filename)
        (config / "atomic-migration-allowlist.json").write_text(json.dumps({
            "schema_version": 1,
            "migrations": {version: {"sha256": digest, "targets": ["preview", "production"]}},
        }), encoding="utf-8")
        preflight = f"ATOMIC PREFLIGHT OK: target=preview version={version} sha256={digest} statements=8"
        texts = {
            "preview-dry-run.txt": preflight + "\n",
            "preview-apply.txt": preflight + "\n" + f"ATOMIC APPLY OK: target=preview version={version} ledger_row=1 statements=8\n",
            "migration-content-manifest.json": json.dumps({version: digest}),
        }
        return temp, root, version, digest, texts

    def test_atomic_preview_proof_binds_version_hash_manifest_apply_and_ledger_delta(self):
        temp, root, version, _, texts = self.atomic_preview_fixture()
        with temp:
            prove_preview_migration_contents(
                texts=texts, allowlist=[version], repo_root=root,
                before_versions={"20260801000000"},
                after_versions={"20260801000000", version}, historical=False,
            )

    def test_atomic_preview_proof_rejects_wrong_version_hash_filename_and_incomplete_proof(self):
        mutations = {
            "wrong version": lambda t, v, d: t.__setitem__("preview-apply.txt", t["preview-apply.txt"].replace(v, "20260816110751")),
            "wrong hash": lambda t, v, d: t.__setitem__("preview-dry-run.txt", t["preview-dry-run.txt"].replace(d, "f" * 64)),
            "wrong manifest": lambda t, v, d: t.__setitem__("migration-content-manifest.json", json.dumps({v: "e" * 64})),
            "missing apply": lambda t, v, d: t.__setitem__("preview-apply.txt", t["preview-apply.txt"].splitlines()[0] + "\n"),
            "forged extra line": lambda t, v, d: t.__setitem__("preview-dry-run.txt", t["preview-dry-run.txt"] + "trust me\n"),
        }
        for name, mutate in mutations.items():
            temp, root, version, digest, texts = self.atomic_preview_fixture()
            with self.subTest(name=name), temp, self.assertRaises(RiskGateError):
                mutate(texts, version, digest)
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

    def test_legacy_preview_proof_still_rejects_wrong_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "supabase/migrations"
            migrations.mkdir(parents=True)
            (root / "config").mkdir()
            (root / "config/atomic-migration-allowlist.json").write_text(
                '{"schema_version":1,"migrations":{}}', encoding="utf-8"
            )
            version = "20260814000000"
            (migrations / f"{version}_exact.sql").write_text("select 1;", encoding="utf-8")
            texts = {
                "preview-dry-run.txt": f"Applying migration {version}_wrong.sql...",
                "preview-apply.txt": f"Applying migration {version}_wrong.sql...",
            }
            with self.assertRaisesRegex(RiskGateError, "exact migration"):
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

    def plain_preview_fixture(self, body="select 1;\n"):
        """A NON-atomic migration plus a rehearsal manifest that matches its bytes."""
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        migrations = root / "supabase/migrations"
        migrations.mkdir(parents=True)
        (root / "config").mkdir()
        (root / "config/atomic-migration-allowlist.json").write_text(
            '{"schema_version":1,"migrations":{}}', encoding="utf-8"
        )
        version = "20260814000000"
        filename = migrations / f"{version}_exact.sql"
        filename.write_bytes(body.encode("utf-8"))
        digest = hashlib.sha256(filename.read_bytes()).hexdigest()
        texts = {
            "preview-dry-run.txt": f"Applying migration {version}_exact.sql...",
            "preview-apply.txt": f"Applying migration {version}_exact.sql...",
            "migration-content-manifest.json": json.dumps({version: digest}),
        }
        return temp, root, version, digest, texts

    def test_types_only_follow_up_commit_does_not_invalidate_a_matching_rehearsal(self):
        """The exact regression this change exists for.

        A rehearsal ran, then a generated-types commit moved the PR head. No SQL
        moved, so the rehearsal is still true and must be accepted.
        """
        temp, root, version, _, texts = self.plain_preview_fixture()
        with temp:
            prove_preview_migration_contents(
                texts=texts, allowlist=[version], repo_root=root,
                before_versions={"20260801000000"},
                after_versions={"20260801000000", version}, historical=False,
            )

    def test_same_filename_with_different_bytes_on_main_is_rejected(self):
        """The hole the old filename-only check left open on this path."""
        temp, root, version, _, texts = self.plain_preview_fixture()
        with temp:
            rewritten = root / f"supabase/migrations/{version}_exact.sql"
            rewritten.write_bytes(b"drop table plm.item;\n")
            with self.assertRaisesRegex(RiskGateError, "different bytes than exact main"):
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

    def test_non_atomic_proof_requires_a_usable_content_manifest(self):
        for name, mutate in {
            "missing manifest": lambda t: t.pop("migration-content-manifest.json"),
            "manifest not an object": lambda t: t.__setitem__("migration-content-manifest.json", "[]"),
            "manifest missing version": lambda t: t.__setitem__("migration-content-manifest.json", "{}"),
            "manifest digest malformed": lambda t: t.__setitem__(
                "migration-content-manifest.json", json.dumps({"20260814000000": "nope"})
            ),
        }.items():
            temp, root, version, _, texts = self.plain_preview_fixture()
            with self.subTest(name=name), temp, self.assertRaises(RiskGateError):
                mutate(texts)
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

    def test_crlf_migration_still_matches_its_raw_byte_manifest(self):
        """canonical_sha256 normalises CRLF; the manifest does not.

        Comparing the two would reject every CRLF migration on a Windows-authored
        branch, so the gate must digest raw bytes on both sides.
        """
        temp, root, version, _, texts = self.plain_preview_fixture(body="select 1;\r\n")
        with temp:
            prove_preview_migration_contents(
                texts=texts, allowlist=[version], repo_root=root,
                before_versions=set(), after_versions={version}, historical=False,
            )

    def test_rehearsal_borrowed_from_another_pull_request_is_rejected(self):
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": "f" * 40, "path": ".github/workflows/shared-supabase-migrations.yml",
        }

        def api(endpoint):
            # The other PR's commits, none of which is this run's head.
            return [{"sha": "1" * 40}] if endpoint.endswith("commits?per_page=100") else run

        with self.assertRaisesRegex(RiskGateError, "does not belong to the source pull request"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head="a" * 40,
                main_sha="d" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("foreign rehearsal must not download"),
                repo_root=Path.cwd(),
            )

    def test_unreadable_source_pr_commits_fail_closed(self):
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": "f" * 40, "path": ".github/workflows/shared-supabase-migrations.yml",
        }

        def api(endpoint):
            if endpoint.endswith("commits?per_page=100"):
                raise RuntimeError("GitHub 503")
            return run

        with self.assertRaisesRegex(RiskGateError, "unreadable"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head="a" * 40,
                main_sha="d" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("must not download"), repo_root=Path.cwd(),
            )

    def preview_api(self, run, commits, blobs, artifacts=None):
        """Fake API covering run, PR commits, producer blobs and artifacts."""
        def api(endpoint):
            if endpoint.endswith("commits?per_page=100"):
                return commits
            if "/contents/" in endpoint:
                path, ref = endpoint.split("/contents/", 1)[1].split("?ref=")
                if (path, ref) in blobs:
                    return {"sha": blobs[(path, ref)]}
                raise RuntimeError("no such content")
            if endpoint.endswith("artifacts?per_page=100"):
                return {"artifacts": artifacts or []}
            return run
        return api

    def test_doctored_producer_commit_cannot_self_attest_a_rehearsal(self):
        """The forgery the exact-head rule used to prevent.

        A branch author pushes C1 carrying a doctored preview workflow that
        fabricates the ledger texts, apply logs and content manifest, dispatches
        preview at C1, then pushes C2 restoring the honest file. The reviewed net
        diff is clean and C1 is a real commit of the PR, so provenance alone
        accepts it. Only pinning the producing code to exact main refuses it.
        """
        c1, head, main = "1" * 40, "2" * 40, "3" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": c1, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        blobs = {}
        for path in PREVIEW_PRODUCER_PATHS:
            blobs[(path, main)] = "honest-" + path
            blobs[(path, c1)] = "honest-" + path
        # C1 carries a doctored workflow; everything else is identical.
        blobs[(PREVIEW_WORKFLOW, c1)] = "doctored-workflow"

        with self.assertRaisesRegex(RiskGateError, "different .* than exact main"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head, main_sha=main,
                source_pr=1, allowlist=["20260814000000"],
                api=self.preview_api(run, [{"sha": c1}, {"sha": head}], blobs),
                downloader=lambda *_: self.fail("doctored producer must not download"),
                repo_root=Path.cwd(),
            )

    def test_honest_earlier_commit_with_matching_producer_is_accepted_to_download(self):
        """The legitimate case: a types-only follow-up moved the head.

        The rehearsal ran at an earlier commit whose producing code matches exact
        main, so it must survive provenance and reach artifact checking. Proven by
        the failure being the DIGEST check, which is strictly later.
        """
        c1, head, main = "1" * 40, "2" * 40, "3" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": c1, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        blobs = {}
        for path in PREVIEW_PRODUCER_PATHS:
            blobs[(path, main)] = "honest-" + path
            blobs[(path, c1)] = "honest-" + path
        artifact = {
            "id": 9, "name": f"preview-migration-apply-{c1}",
            "digest": "sha256:" + "d" * 64, "expired": False, "workflow_run": {"id": 7},
        }
        with self.assertRaisesRegex(RiskGateError, "pinned digest"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head, main_sha=main,
                source_pr=1, allowlist=["20260814000000"],
                api=self.preview_api(run, [{"sha": c1}, {"sha": head}], blobs, [artifact]),
                downloader=lambda *_: self.fail("digest mismatch must not download"),
                repo_root=Path.cwd(),
            )

    def test_unreadable_producer_file_fails_closed(self):
        c1, head, main = "1" * 40, "2" * 40, "3" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": c1, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        with self.assertRaisesRegex(RiskGateError, "unreadable"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head, main_sha=main,
                source_pr=1, allowlist=["20260814000000"],
                api=self.preview_api(run, [{"sha": c1}], {}),
                downloader=lambda *_: self.fail("must not download"), repo_root=Path.cwd(),
            )

    PREVIEW_JOB_EXCLUSIONS = (
        # These run ONLY in the production-apply jobs, which check out exact main
        # and prove HEAD == origin/main before executing. They are not part of
        # the preview evidence-producing surface.
        "scripts/production_business_risk_gate.py",
        "scripts/production_apply_review_evidence.py",
        "scripts/production_catalog_verification.py",
        # Validate-only job, which produces no evidence.
        # Validate-only job. It produces no evidence, runs on a separate runner,
        # and a forged artifact under the preview name would collide with the
        # preview job's upload and fail the run. Confirmed by independent review.
        "scripts/check-sql.sh",
        "scripts/check-sql.test.mjs",
        # Invoked only by check-sql.sh, so validate-only for the same reason.
        "scripts/historical-migration-restorations.mjs",
    )

    def preview_job_text(self):
        """Just the preview job, so validate-only steps cannot mask a real gap."""
        workflow = (Path(__file__).resolve().parents[1] / PREVIEW_WORKFLOW).read_text(encoding="utf-8")
        start = workflow.index("\n  preview:")
        rest = workflow[start + 1:]
        nxt = re.search(r"\n  [a-zA-Z][\w-]*:\n", rest)
        return rest[: nxt.start()] if nxt else rest

    @staticmethod
    def scripts_invoked_on(line, roots):
        """Repo paths invoked on ONE line by node/python/bash.

        Line-at-a-time on purpose: it keeps the pattern free of newline handling
        and still catches `node --test x`, `python -m y`, quoted paths, and
        `$GITHUB_WORKSPACE/`-prefixed paths, which are the shapes that previously
        slipped past a stricter pattern.
        """
        interpreted = re.search(r"\b(?:node|python|python3|bash|sh|source)\b", line)
        # child_process spawns name the script as a plain string argument, with
        # the interpreter supplied as process.execPath rather than by name.
        spawned = re.search(r"\b(?:execFileSync|execSync|spawnSync|spawn|execFile)\b", line)
        if not interpreted and not spawned:
            return []
        return [m.rstrip(".") for m in re.findall(rf"({roots}/[A-Za-z0-9_.-]+)", line)]

    @staticmethod
    def local_imports(root, body):
        """Sibling modules a body pulls in, for BOTH languages.

        JS was covered from the start. Python was not, and the preview job's
        heredocs already use `from production_migration_guard import ...`. That
        was covered only by coincidence -- the same module happens to be invoked
        by name elsewhere -- so a future helper imported but never invoked would
        have executed unpinned with this test green. That is precisely the defect
        class that reopened the forgery path twice.
        """
        found = [f"scripts/{name}" for name in re.findall(r"from\s+['\"]\./([A-Za-z0-9_.-]+)['\"]", body)]
        for name in re.findall(r"^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)", body, re.M):
            if (root / "scripts" / f"{name}.py").is_file():
                found.append(f"scripts/{name}.py")
        return found

    def executed_closure(self):
        """Every repo script the preview job can execute, including imports.

        Enumerating this by hand is what failed twice: the forgery path was
        reopened at hop two and again at hop three, because a pinned entry point
        statically imports another module whose body runs first. So the closure is
        WALKED, not listed. Invocation shapes are matched loosely on purpose --
        `node --test x`, `python -m y`, and quoted/`$GITHUB_WORKSPACE`-prefixed
        paths must all be seen.
        """
        root = Path(__file__).resolve().parents[1]
        text = self.preview_job_text()
        found = set()
        for line in text.splitlines():
            found.update(self.scripts_invoked_on(line, r"(?:scripts|config)"))
        seen, queue = set(), list(found)
        while queue:
            rel = queue.pop()
            if rel in seen:
                continue
            seen.add(rel)
            path = root / rel
            if not path.is_file():
                continue
            body = path.read_text(encoding="utf-8", errors="ignore")
            queue.extend(self.local_imports(root, body))
            for line in body.splitlines():
                queue.extend(self.scripts_invoked_on(line, "scripts"))
        # Heredocs in the workflow import sibling modules directly rather than
        # invoking them, so the job text is walked for imports too.
        queue.extend(self.local_imports(root, text))
        while queue:
            rel = queue.pop()
            if rel not in seen:
                seen.add(rel)
        return seen

    def test_preview_producer_paths_cover_the_whole_executed_closure(self):
        """The list must not be able to fall silently behind reality.

        Independent review reopened the forgery path twice here: once because a
        script that runs before evidence production was unpinned, and once because
        a PINNED script imported an unpinned one. Anything executing at the
        dispatched ref can rewrite the workspace copies of the pinned files, and
        the gate compares COMMITTED blobs, so it cannot see that. One unpinned
        executed file breaks custody for every pinned one.

        So this walks the closure instead of trusting a hand-written list.
        """
        closure = self.executed_closure()
        self.assertIn("scripts/manage-migration-author-lanes.mjs", closure,
                      "closure walk missed a known preview-job script; the parser has rotted")
        self.assertIn("scripts/check-pr-object-collisions.mjs", closure,
                      "closure walk did not follow imports; that is the hop-three defect")
        # The exclusion list is a hand-written bypass of the walk, so its premise
        # must itself be checked. Every exclusion claims "this does not run in the
        # preview job". If one ever does, the walk would stay green while the
        # script stayed unpinned -- reopening the exact forgery path this test
        # exists to close. Assert the premise instead of trusting the comment.
        job_text = self.preview_job_text()
        for excluded in self.PREVIEW_JOB_EXCLUSIONS:
            for line in job_text.splitlines():
                self.assertNotIn(
                    excluded, self.scripts_invoked_on(line, "scripts"),
                    f"{excluded} is excluded as not-preview-job, but the preview job "
                    f"now invokes it; pin it in PREVIEW_PRODUCER_PATHS instead",
                )
        unpinned = sorted(closure - set(PREVIEW_PRODUCER_PATHS) - set(self.PREVIEW_JOB_EXCLUSIONS))
        self.assertEqual(
            unpinned, [],
            f"these execute in the preview job (directly or via import) but are not "
            f"pinned in PREVIEW_PRODUCER_PATHS: {unpinned}",
        )

    def test_every_pinned_producer_path_exists(self):
        """A typo in the tuple would silently pin nothing but fail closed later."""
        repo_root = Path(__file__).resolve().parents[1]
        for path in PREVIEW_PRODUCER_PATHS:
            self.assertTrue((repo_root / path).is_file(), f"pinned producer path missing: {path}")

    def test_preview_ledger_delta_rejects_extra_additions_removals_and_prior_version(self):
        cases = [
            ({"old"}, {"old", "20260816110750", "extra"}),
            ({"old"}, {"20260816110750"}),
            ({"20260816110750"}, {"20260816110750"}),
        ]
        for before, after in cases:
            temp, root, version, _, texts = self.atomic_preview_fixture()
            with self.subTest(before=before, after=after), temp, self.assertRaisesRegex(RiskGateError, "delta"):
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=before, after_versions=after, historical=False,
                )
    def test_inactive_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            path.write_text('{"active":false,"schema_version":"shared-db-production-risk-activation/v1"}\n')
            data = load_activation(path)
            with self.assertRaisesRegex(RiskGateError, "old exact owner-approval rule"):
                prove_activation(data, main_sha="a" * 40, api=lambda _: {}, repo_root=Path(temp))

    def test_forged_activation_booleans_and_prose_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            path.write_text(json.dumps({"active": True, "evidence": "trust me"}))
            with self.assertRaisesRegex(RiskGateError, "forged or incomplete"):
                load_activation(path)

    def test_installed_skill_hash_must_equal_canonical(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            data = {
                "active": True, "schema_version": "shared-db-production-risk-activation/v2",
                "shared_db_pr": 1021, "shared_db_merge_sha": "a" * 40,
                "ai_devops_pr": 24, "ai_devops_merge_sha": "b" * 40,
                "skill_hashes": {
                    "SKILL.md": {"canonical": "c" * 64, "codex_installed": "d" * 64, "claude_installed": "c" * 64},
                    "references/operating-manual.md": {"canonical": "e" * 64, "codex_installed": "e" * 64, "claude_installed": "e" * 64},
                    "agents/openai.yaml": {"canonical": "f" * 64, "codex_installed": "f" * 64, "claude_installed": "f" * 64},
                },
                "forward_test_path": "docs/verification/issue-1039-production-risk-activation-forward-proof.md",
                "forward_test_sha256": "a" * 64,
            }
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(RiskGateError, "does not match"):
                load_activation(path)

    def test_static_analysis_is_conservative(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "supabase/migrations"
            migrations.mkdir(parents=True)
            (migrations / "20260814000000_safe.sql").write_text("create table core.safe(id bigint); insert into core.safe values (1);")
            self.assertEqual(classify_sql(root, ["20260814000000"]), [])
            (migrations / "20260814000001_risky.sql").write_text("alter table core.safe add column x text; revoke select on core.safe from anon;")
            reasons = classify_sql(root, ["20260814000001"])
            self.assertIn("users may be interrupted", reasons)
            self.assertIn("access or permissions materially change", reasons)

    def test_synthetic_low_risk_and_all_five_risk_classes_fail_closed(self):
        self.assertEqual(
            decide_business_risk([], recovery_proven=True, review_approved=True),
            {"automaticPromotionAllowed": True, "ownerDecisionReasons": []},
        )
        cases = [
            (["existing production data may be lost or permanently altered"], True, True),
            (["users may be interrupted"], True, True),
            (["access or permissions materially change"], True, True),
            ([], False, True),
            ([], True, False),
        ]
        for sql_reasons, recovery, review in cases:
            with self.subTest(sql_reasons=sql_reasons, recovery=recovery, review=review):
                result = decide_business_risk(sql_reasons, recovery_proven=recovery, review_approved=review)
                self.assertFalse(result["automaticPromotionAllowed"])
                self.assertEqual(len(result["ownerDecisionReasons"]), 1)

    def test_forged_preview_claim_is_rejected_before_download(self):
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": "b" * 40, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        def api(endpoint):
            return [{"sha": "a" * 40}] if endpoint.endswith("commits?per_page=100") else run

        with self.assertRaisesRegex(RiskGateError, "does not belong to the source pull request"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head="a" * 40,
                main_sha="d" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("forged run must not download"), repo_root=Path.cwd(),
            )

    def test_preview_artifact_must_match_pinned_run_and_digest_before_download(self):
        head = "a" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": head, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        artifact = {
            "id": 9,
            "name": f"preview-migration-apply-{head}",
            "digest": "sha256:" + "d" * 64,
            "expired": False,
            "workflow_run": {"id": 7},
        }

        def api(endpoint):
            if endpoint.endswith("artifacts?per_page=100"):
                return {"artifacts": [artifact]}
            if endpoint.endswith("commits?per_page=100"):
                return [{"sha": head}]
            if "/contents/" in endpoint:
                # Producer files identical at the run head and at main, so this
                # test still exercises the digest check it is named for.
                return {"sha": "identical-producer-blob"}
            return run

        with self.assertRaisesRegex(RiskGateError, "pinned digest"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head,
                main_sha="b" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("wrong digest must not download"), repo_root=Path.cwd(),
            )

        artifact["digest"] = "sha256:" + "c" * 64
        artifact["workflow_run"] = {"id": 8}
        with self.assertRaisesRegex(RiskGateError, "another run"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head,
                main_sha="b" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("wrong run must not download"), repo_root=Path.cwd(),
            )

    def test_production_workflow_enforces_gate_twice_and_keeps_old_boundary(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/shared-supabase-migrations.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertEqual(text.count("python scripts/production_business_risk_gate.py"), 2)
        self.assertIn("environment: production", text)
        self.assertGreaterEqual(text.count("config/production-risk-policy-activation.json"), 2)

    def test_historical_preview_recovery_proves_existing_ledger_without_writing(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/shared-supabase-migrations.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("Recover proof for migrations already present on preview", text)
        self.assertIn("HISTORICAL PREVIEW PROOF: already applied; no database write performed", text)
        self.assertIn("REFUSED: historical preview recovery is missing ledger versions", text)
        self.assertIn("inputs.mode == 'apply' && inputs.historical_preview_source_pr == ''", text)

    def test_legacy_author_check_waiver_is_exactly_pinned(self):
        args = [924, "5135b668d87c1639281c506ae75fde75211b7019", "96bf385aa5c0f703ec98f5730249f586964f5142", ["20260813210000", "20260813220000"]]
        self.assertTrue(is_pinned_historical_disney_source(*args))
        for changed in [
            [925, *args[1:]],
            [args[0], "a" * 40, *args[2:]],
            [*args[:2], "b" * 40, args[3]],
            [*args[:3], ["20260813210000"]],
        ]:
            self.assertFalse(is_pinned_historical_disney_source(*changed))


if __name__ == "__main__":
    unittest.main()
