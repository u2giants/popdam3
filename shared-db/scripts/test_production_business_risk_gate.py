import hashlib
import inspect
import json
import re
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import api_field, api_list, api_object, api_sublist, authored_merge, exact_main, ProvedTarget, tracked_paths_at, PREVIEW_PRODUCER_PATHS, PREVIEW_RUNTIME_DATA_DIRS, PREVIEW_RUNTIME_DATA_EXEMPTIONS, PRODUCTION_PROJECT_REF, RISK_TEXT, PREVIEW_WORKFLOW, RiskGateError, canonical_sha256, classify_sql, decide_business_risk, gh_json, is_pinned_historical_disney_source, load_activation, prove_activation, prove_applied_commit_is_main_line, preview_applied_commit, prove_governed_historical_supersession, prove_historical_original_apply_runs, prove_preview, prove_preview_migration_contents, prove_preview_producer_matches_main, prove_pr_and_checks, REQUIRED_CHECKS, GOVERNED_HISTORICAL_SUPERSESSION


def tree_ref(endpoint):
    """The commit a `/git/trees/` endpoint asks about -- AFTER checking the query.

    THE QUERY STRING IS PART OF THE CONTRACT. Every tree stub in this file used
    to do `.split("?")[0]` and throw the query away, so deleting `recursive=1`
    from the production URL left the whole suite green while GitHub would have
    returned only top-level directory names. Every producer path would then be
    "absent from both trees", the skip rule would fire ten times, and the pin
    would return success having compared nothing (#1213 round 8, finding 1).
    This helper refuses instead, so that mutation turns the suite red -- the same
    reason `test_compare_url_argument_order_is_asserted` reads the compare URL.
    """
    ref, _, query = endpoint.partition("?")
    ref = ref.split("/git/trees/", 1)[1]
    if "recursive=1" not in query:
        raise AssertionError(
            f"the tree read must be recursive; a top-level-only listing makes every "
            f"producer path look absent. Got: {endpoint}"
        )
    return ref


PREVIEW_PROJECT_REF = "mvpkijzfmfcxhnzqogzs"
DEAD_PREVIEW_PROJECT_REF = "rjyboqwcdzcocqgmsyel"


class ProductionBusinessRiskGateTests(unittest.TestCase):
    def test_risk_gate_sources_have_no_invalid_escape_sequences(self):
        """Compile both risk-gate sources with Python's own warning detector."""
        scripts_dir = Path(__file__).parent
        for name in ("production_business_risk_gate.py", Path(__file__).name):
            source = (scripts_dir / name).read_text(encoding="utf-8")
            with self.subTest(name=name), warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", SyntaxWarning)
                compile(source, name, "exec")
                invalid_escapes = [item for item in caught if item.category is SyntaxWarning]
                self.assertEqual(invalid_escapes, [], f"invalid escape sequences found in {name}: {invalid_escapes}")

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
        """The CLAIM lane's digest-shape guard, one operand at a time.

        #1213 round 9, the author's per-condition hunt. This test used a bare
        `assertRaises(RiskGateError)`, and that alone made TWO of the guard's
        three conditions deletable with the suite green:

          * drop `not isinstance(recorded, str)` and compare `str(recorded)`
            instead -- "manifest missing version" still refuses, because the
            string "None" is not 64 hex characters. Same colour, different guard.
          * drop the 64-hex operand -- "manifest digest malformed" (`"nope"`) is
            a `str`, so it sails past and is refused one line later by the byte
            comparison, with a message claiming preview REHEARSED DIFFERENT BYTES
            when the truth is that the manifest never carried a digest.

        A bare assertRaises cannot tell those apart, so the message is pinned per
        case, and the case-sensitivity of the hex class gets its own case: an
        uppercase digest is the shape a hand-written manifest takes, and it must
        not be normalised into acceptance.
        """
        version = "20260814000000"
        for name, mutate, message in (
            ("missing manifest",
             lambda t: t.pop("migration-content-manifest.json"),
             "missing a valid content manifest"),
            ("manifest is not JSON",
             lambda t: t.__setitem__("migration-content-manifest.json", "not json"),
             "missing a valid content manifest"),
            ("manifest not an object",
             lambda t: t.__setitem__("migration-content-manifest.json", "[]"),
             "content manifest is not an object"),
            ("manifest missing version",
             lambda t: t.__setitem__("migration-content-manifest.json", "{}"),
             "has no usable digest"),
            ("digest is null",
             lambda t: t.__setitem__("migration-content-manifest.json",
                                     json.dumps({version: None})),
             "has no usable digest"),
            ("digest is a number",
             lambda t: t.__setitem__("migration-content-manifest.json",
                                     json.dumps({version: 12345})),
             "has no usable digest"),
            ("digest malformed",
             lambda t: t.__setitem__("migration-content-manifest.json",
                                     json.dumps({version: "nope"})),
             "has no usable digest"),
            ("digest too short",
             lambda t: t.__setitem__("migration-content-manifest.json",
                                     json.dumps({version: "abc123"})),
             "has no usable digest"),
            ("digest uppercase hex",
             lambda t: t.__setitem__("migration-content-manifest.json",
                                     json.dumps({version: "A" * 64})),
             "has no usable digest"),
            ("digest 64 non-hex characters",
             lambda t: t.__setitem__("migration-content-manifest.json",
                                     json.dumps({version: "z" * 64})),
             "has no usable digest"),
        ):
            temp, root, fixture_version, _, texts = self.plain_preview_fixture()
            self.assertEqual(fixture_version, version)
            with self.subTest(name=name), temp, self.assertRaisesRegex(RiskGateError, message):
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

    def apply_artifact(self, commit, digest="sha256:" + "d" * 64, artifact_id=9, run_id=7):
        return {
            "id": artifact_id, "name": f"preview-migration-apply-{commit}",
            "digest": digest, "expired": False, "workflow_run": {"id": run_id},
        }

    def prove_preview_args(self, **overrides):
        args = dict(
            run_id=7, digest="sha256:" + "c" * 64, pr_head="a" * 40, main_sha="d" * 40,
            source_pr=1, allowlist=["20260814000000"],
            preview_project_ref=PREVIEW_PROJECT_REF, merge_commit_sha="b" * 40,
            repo_root=Path.cwd(),
        )
        args.update(overrides)
        return args

    def test_rehearsal_borrowed_from_another_pull_request_is_rejected(self):
        """Neither a commit of the source PR, nor a commit exact main contains."""
        foreign = "f" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": foreign, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        api = self.preview_api(
            run, [{"sha": "1" * 40}], {}, [self.apply_artifact(foreign)],
            # A rehearsal from an unrelated branch: main does not contain it.
            compare={"status": "diverged", "ahead_by": 2, "behind_by": 3},
        )
        with self.assertRaisesRegex(RiskGateError, "not contained in the history of exact main"):
            prove_preview(
                **self.prove_preview_args(api=api),
                downloader=lambda *_: self.fail("foreign rehearsal must not download"),
            )

    def test_unreadable_source_pr_commits_fail_closed(self):
        foreign = "f" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": foreign, "path": ".github/workflows/shared-supabase-migrations.yml",
        }

        def api(endpoint):
            if endpoint.endswith("commits?per_page=100"):
                raise RuntimeError("GitHub 503")
            if endpoint.endswith("artifacts?per_page=100"):
                return {"artifacts": [self.apply_artifact(foreign)]}
            return run

        with self.assertRaisesRegex(RiskGateError, "unreadable"):
            prove_preview(
                **self.prove_preview_args(api=api),
                downloader=lambda *_: self.fail("must not download"),
            )

    def preview_api(self, run, commits, blobs, artifacts=None, compare=None, seen=None):
        """Fake API covering run, PR commits, producer blobs, trees, artifacts, compare.

        THE TREE AND THE BLOBS COME FROM ONE SOURCE. `blobs` is keyed by
        (path, ref), so a path a test did not state for a ref is absent from
        that ref's tree AND raises from `/contents/`. A helper whose tree and
        whose blob reads could disagree is a helper that cannot express the
        repository (#1213 round 7, finding 1).
        """
        def api(endpoint):
            if seen is not None:
                seen.append(endpoint)
            if endpoint.endswith("commits?per_page=100"):
                return commits
            if "/git/trees/" in endpoint:
                ref = tree_ref(endpoint)
                return {"truncated": False,
                        "tree": [{"path": p} for (p, r) in blobs if r == ref]}
            if "/compare/" in endpoint:
                if compare is None:
                    raise RuntimeError("compare not stubbed")
                return compare
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
                **self.prove_preview_args(
                    pr_head=head, main_sha=main,
                    api=self.preview_api(
                        run, [{"sha": c1}, {"sha": head}], blobs, [self.apply_artifact(c1)]
                    ),
                ),
                downloader=lambda *_: self.fail("doctored producer must not download"),
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
        with self.assertRaisesRegex(RiskGateError, "pinned digest"):
            prove_preview(
                **self.prove_preview_args(
                    pr_head=head, main_sha=main,
                    api=self.preview_api(
                        run, [{"sha": c1}, {"sha": head}], blobs, [self.apply_artifact(c1)]
                    ),
                ),
                downloader=lambda *_: self.fail("digest mismatch must not download"),
            )

    def test_unreadable_producer_file_fails_closed(self):
        """A producer file that BOTH trees list but GitHub will not hand over.

        Absence is now proved from the tree, so this test states a file that is
        present on both sides and unreadable anyway. Skipping it would be
        exactly the fail-open the producer pin exists to prevent.
        """
        c1, head, main = "1" * 40, "2" * 40, "3" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": c1, "path": ".github/workflows/shared-supabase-migrations.yml",
        }

        def api(endpoint):
            if endpoint.endswith("artifacts?per_page=100"):
                return {"artifacts": [self.apply_artifact(c1)]}
            if endpoint.endswith("commits?per_page=100"):
                return [{"sha": c1}]
            if "/git/trees/" in endpoint:
                tree_ref(endpoint)
                return {"truncated": False,
                        "tree": [{"path": p} for p in PREVIEW_PRODUCER_PATHS]}
            if "/contents/" in endpoint:
                raise RuntimeError("GitHub 500")
            return run

        with self.assertRaisesRegex(RiskGateError, "is unreadable at"):
            prove_preview(
                **self.prove_preview_args(pr_head=head, main_sha=main, api=api),
                downloader=lambda *_: self.fail("must not download"),
            )

    def test_the_source_pull_request_shape_and_checks_are_enforced(self):
        """Three more guards this PR's mutation sweep found untested.

        `prove_pr_and_checks` is the gate's first read of the promotion pull
        request. An unmerged PR, a PR with no exact head SHA, and a PR whose
        required exact-head checks are not all green must each refuse. All three
        conditions could be replaced with `if False:` without turning the offline
        suite red.
        """
        main = "3" * 40
        head = "1" * 40
        green = {"check_runs": [{"name": n, "conclusion": "success"} for n in REQUIRED_CHECKS]}

        def api_for(pr, checks):
            def api(endpoint):
                return checks if "check-runs" in endpoint else pr
            return api

        with self.assertRaisesRegex(RiskGateError, "source PR is not merged"):
            prove_pr_and_checks(
                1, main, ["20260814000000"],
                api_for({"merged": False, "merge_commit_sha": main,
                         "head": {"sha": head}}, green), Path.cwd(),
            )
        with self.assertRaisesRegex(RiskGateError, "source PR has no exact head"):
            prove_pr_and_checks(
                1, main, ["20260814000000"],
                api_for({"merged": True, "merge_commit_sha": main,
                         "head": {"sha": "not-a-sha"}}, green), Path.cwd(),
            )
        temp, root, real_main, merge_sha = self.historical_repo()
        with temp, self.assertRaisesRegex(
            RiskGateError, "required exact-head checks are not successful"
        ):
            prove_pr_and_checks(
                1, real_main, ["20260814000000"],
                api_for({"merged": True, "merge_commit_sha": merge_sha,
                         "head": {"sha": head}}, {"check_runs": []}), root,
            )

    # ------------------------------------------------------------------
    # Issue #1218: a well-formed GitHub response of an unexpected SHAPE must
    # produce a NAMED ::error:: refusal, not a raw traceback.
    #
    # `api(...).get("check_runs", [])` raised AttributeError when the endpoint
    # returned a JSON list, and `pr["merge_commit_sha"]` raised KeyError when the
    # key was absent. Neither type is in main()'s except tuple, so the last gate
    # before a production write died with a traceback. It stayed fail-closed, but
    # a traceback names nothing, and an operator reading one concludes the gate is
    # broken and reaches for a workaround.
    # ------------------------------------------------------------------

    def test_an_array_where_an_object_was_expected_refuses_by_endpoint_name(self):
        with self.assertRaisesRegex(RiskGateError, r"returned a list, not an object, for repos/x/pulls/1"):
            api_object(lambda _: [], "repos/x/pulls/1")

    def test_an_object_where_an_array_was_expected_refuses_by_endpoint_name(self):
        with self.assertRaisesRegex(RiskGateError, r"returned a dict, not an array, for repos/x/commits"):
            api_list(lambda _: {}, "repos/x/commits")

    def test_a_missing_required_field_names_the_endpoint_and_the_field(self):
        with self.assertRaisesRegex(RiskGateError, r"the repos/x/pulls/1 payload had no merge_commit_sha"):
            api_field({}, "merge_commit_sha", "repos/x/pulls/1")

    def test_a_required_field_of_the_wrong_type_names_what_was_wrong(self):
        with self.assertRaisesRegex(RiskGateError, r"had a str for check_runs, not an array"):
            api_sublist({"check_runs": "oops"}, "check_runs", "repos/x/checks")

    def test_null_is_still_a_present_field_and_is_not_reported_missing(self):
        # `merge_commit_sha: null` is GitHub saying "not merged", which the caller
        # must handle as a merge refusal -- NOT as a malformed payload. Conflating
        # the two would give an operator the wrong thing to go and look at.
        self.assertIsNone(api_field({"merge_commit_sha": None}, "merge_commit_sha", "e"))

    def test_a_pull_request_payload_that_is_a_list_refuses_instead_of_crashing(self):
        main = "3" * 40

        def api(endpoint):
            return [] if "check-runs" not in endpoint else {"check_runs": []}

        with self.assertRaisesRegex(RiskGateError, "not an object"):
            prove_pr_and_checks(1, main, ["20260814000000"], api, Path.cwd())

    def test_a_pull_request_payload_missing_merge_commit_sha_refuses_by_name(self):
        main = "3" * 40

        def api(endpoint):
            if "check-runs" in endpoint:
                return {"check_runs": []}
            return {"merged": True, "head": {"sha": "1" * 40}}

        with self.assertRaisesRegex(RiskGateError, "had no merge_commit_sha"):
            prove_pr_and_checks(1, main, ["20260814000000"], api, Path.cwd())

    def test_a_check_runs_payload_that_is_a_list_refuses_instead_of_crashing(self):
        main = "3" * 40
        head = "1" * 40
        temp, root, real_main, merge_sha = self.historical_repo()

        def api(endpoint):
            if "check-runs" in endpoint:
                return []
            return {"merged": True, "merge_commit_sha": merge_sha, "head": {"sha": head}}

        with temp, self.assertRaisesRegex(RiskGateError, "not an object"):
            prove_pr_and_checks(1, real_main, ["20260814000000"], api, root)

    def test_a_pull_request_head_that_is_not_an_object_refuses_rather_than_crashing(self):
        main = "3" * 40

        def api(endpoint):
            if "check-runs" in endpoint:
                return {"check_runs": []}
            return {"merged": True, "merge_commit_sha": main, "head": "not-an-object"}

        with self.assertRaisesRegex(RiskGateError, "source PR has no exact head"):
            prove_pr_and_checks(1, main, ["20260814000000"], api, Path.cwd())

    def test_the_sql_classifier_refuses_an_absent_or_ambiguous_migration(self):
        """The classifier must never silently classify nothing.

        A version with no file on exact main, or with two, is not a migration it
        can read; returning an empty risk list would understate the risk of the
        promotion. Deleting this guard changed no test.
        """
        temp = tempfile.TemporaryDirectory()
        with temp:
            root = Path(temp.name)
            (root / "supabase/migrations").mkdir(parents=True)
            with self.assertRaisesRegex(RiskGateError, "expected one migration for .*, found 0"):
                classify_sql(root, ["20260814000000"])
            for suffix in ("a", "b"):
                (root / f"supabase/migrations/20260814000000_{suffix}.sql").write_text("select 1;\n", encoding="utf-8")
            with self.assertRaisesRegex(RiskGateError, "expected one migration for .*, found 2"):
                classify_sql(root, ["20260814000000"])

    def test_the_tree_read_is_recursive(self):
        """The tree URL is pinned, exactly as the compare URL is.

        `recursive=1` is what makes `/git/trees/` list `scripts/...` instead of
        just `scripts`. Without it every `PREVIEW_PRODUCER_PATHS` entry is absent
        from BOTH trees, the "absent from both -> skip" rule fires for all of
        them, and `prove_preview_producer_matches_main` returns success having
        compared nothing (#1213 round 8, finding 1). Nothing else in the suite
        looked at this URL, so that mutation was invisible.
        """
        seen = []
        tracked_paths_at(
            "1" * 40,
            lambda endpoint: (seen.append(endpoint) or {"truncated": False, "tree": []}),
        )
        self.assertEqual(
            seen, [f"repos/u2giants/shared-db/git/trees/{'1' * 40}?recursive=1"]
        )

    def test_a_producer_pin_that_compared_nothing_is_refused(self):
        """Zero byte comparisons is never an honest pass.

        Two different commits always share at least one producer file, so a walk
        that skipped all ten did not observe two honest trees -- it observed a
        tree listing that lied about what the commits contain, which is what a
        non-recursive read returns. Success here would mean the promoted bytes
        were never pinned to any producing code at all.
        """
        ref, main = "1" * 40, "3" * 40
        with self.assertRaisesRegex(RiskGateError, "without a single producer file"):
            prove_preview_producer_matches_main(
                ref, exact_main(main), main,
                self.preview_api({}, [], {}, []),
            )

    def test_an_unreadable_or_truncated_tree_fails_closed(self):
        """Absence must be a FACT, never an inference from a failed read.

        If the tree read itself fails, or GitHub truncates the listing, a path
        missing from what came back is not evidence that the commit lacks it.
        Either way the gate refuses rather than skipping the comparison.
        """
        ref, main = "1" * 40, "3" * 40
        with self.assertRaisesRegex(RiskGateError, "file tree of .* is unreadable"):
            tracked_paths_at(ref, lambda endpoint: (_ for _ in ()).throw(RuntimeError("503")))
        # BOTH operands of `not isinstance(tree, dict) or not isinstance(tree.get("tree"), list)`.
        # The second had a case; the first did not, so a response that is not an
        # object at all -- a list, a string, null -- would have reached
        # `tree.get` and raised AttributeError rather than refusing with a
        # message (#1213 round 9, author's per-condition hunt).
        for payload in ([], "not a tree", None, 12345):
            with self.subTest(payload=payload), self.assertRaisesRegex(
                RiskGateError, "file tree of .* is unreadable"
            ):
                tracked_paths_at(ref, lambda endpoint, p=payload: p)
        with self.assertRaisesRegex(RiskGateError, "file tree of .* is unreadable"):
            tracked_paths_at(ref, lambda endpoint: {"tree": "not-a-list"})
        with self.assertRaisesRegex(RiskGateError, "truncated"):
            tracked_paths_at(ref, lambda endpoint: {"truncated": True, "tree": []})
        self.assertEqual(
            tracked_paths_at(main, lambda endpoint: {"truncated": False,
                                                     "tree": [{"path": "a"}, {"nope": 1}]}),
            frozenset({"a"}),
        )

    # ------------------------------------------------------------------
    # POST-MERGE REHEARSAL PROVENANCE AND INSTANCE BINDING (#1208)
    # ------------------------------------------------------------------
    def test_compare_url_argument_order_is_asserted(self):
        """PR #1194 review point 3.

        The old stub never inspected the compare URL, so swapping the arguments
        left every provenance test green while inverting the meaning of the
        check in production. This test reads the URL.
        """
        applied, main = "1" * 40, "3" * 40
        seen = []
        prove_applied_commit_is_main_line(
            applied, main,
            self.preview_api({}, [], {}, [], compare={"status": "ahead", "behind_by": 0}, seen=seen),
        )
        self.assertEqual(seen, [f"repos/u2giants/shared-db/compare/{applied}...{main}"])

    def test_descendant_of_main_is_refused(self):
        """Inverting the compare arguments would make this pass. It must not.

        A commit that is a DESCENDANT of main is unmerged code. Compared in the
        correct order it reports `behind`, never `ahead`.
        """
        with self.assertRaisesRegex(RiskGateError, "not contained in the history of exact main"):
            prove_applied_commit_is_main_line(
                "1" * 40, "3" * 40,
                self.preview_api({}, [], {}, [], compare={"status": "behind", "behind_by": 0}),
            )

    def test_main_line_ancestry_accepts_ahead_and_identical_only_at_behind_zero(self):
        for status in ("ahead", "identical"):
            with self.subTest(status=status):
                prove_applied_commit_is_main_line(
                    "1" * 40, "3" * 40,
                    self.preview_api({}, [], {}, [], compare={"status": status, "behind_by": 0}),
                )
        for compare in (
            {"status": "ahead", "behind_by": 2},
            {"status": "diverged", "behind_by": 0},
            {"status": "ahead"},
            None,
            "not-an-object",
        ):
            with self.subTest(compare=compare), self.assertRaisesRegex(RiskGateError, "unreadable|not contained"):
                prove_applied_commit_is_main_line(
                    "1" * 40, "3" * 40, lambda _e, c=compare: c,
                )

    def test_unreadable_ancestry_fails_closed(self):
        def api(_endpoint):
            raise RuntimeError("GitHub 503")

        with self.assertRaisesRegex(RiskGateError, "ancestry is unreadable"):
            prove_applied_commit_is_main_line("1" * 40, "3" * 40, api)

    def test_applied_commit_comes_from_the_artifact_name_not_the_run_head(self):
        """PR #1194 review point 1.

        A post-merge rehearsal dispatched with `--ref main` has a run head that
        is the workflow-file ref. The commit it actually checked out and applied
        from is the one in the artifact name.
        """
        applied = "7" * 40
        artifact, commit = preview_applied_commit(
            {"artifacts": [self.apply_artifact(applied)]}, 7
        )
        self.assertEqual(commit, applied)
        self.assertEqual(artifact["id"], 9)

    def test_missing_or_ambiguous_apply_artifact_fails_closed(self):
        for label, payload in (
            ("none", {"artifacts": []}),
            ("dry-run only", {"artifacts": [{"name": "preview-migration-dry-run-" + "7" * 40}]}),
            ("two", {"artifacts": [self.apply_artifact("7" * 40), self.apply_artifact("8" * 40, artifact_id=10)]}),
            ("unreadable", {"artifacts": "nope"}),
        ):
            with self.subTest(label), self.assertRaisesRegex(RiskGateError, "unreadable|exactly one preview-migration-apply"):
                preview_applied_commit(payload, 7)

    def preview_evidence_zip(self, path, version, manifest_digest, instance):
        ledger_before = json.dumps([{"remote": "20260801000000"}])
        ledger_after = json.dumps([{"remote": "20260801000000"}, {"remote": version}])
        payload = {
            "preview-ledger-before.txt": ledger_before,
            "preview-ledger-after.txt": ledger_after,
            "preview-dry-run.txt": f"Applying migration {version}_exact.sql...",
            "preview-apply.txt": f"Applying migration {version}_exact.sql...",
            "migration-content-manifest.json": json.dumps({version: manifest_digest}),
        }
        if instance is not None:
            payload["preview-instance.json"] = json.dumps(instance)
        with zipfile.ZipFile(path, "w") as archive:
            for name, text in payload.items():
                archive.writestr(name, text)
        return "sha256:" + hashlib.sha256(Path(path).read_bytes()).hexdigest()

    def run_full_prove_preview(
        self, *, instance, applied=None, main=None, preview_ref=PREVIEW_PROJECT_REF,
        run_head=None, source_pr=1, merge_commit_sha="b" * 40,
    ):
        """End to end through download, so the instance binding is really read."""
        applied = applied or "1" * 40
        main = main or "3" * 40
        # The real post-merge dispatch is `--ref main`, so the workflow that
        # EXECUTES is main's own. Tests that forge it override this.
        run_head = run_head or main
        temp, root, version, digest, _ = self.plain_preview_fixture()
        with temp:
            zip_dir = tempfile.TemporaryDirectory()
            with zip_dir:
                zip_path = Path(zip_dir.name, "evidence.zip")
                artifact_digest = self.preview_evidence_zip(zip_path, version, digest, instance)
                blobs = {}
                for path in PREVIEW_PRODUCER_PATHS:
                    blobs[(path, main)] = "honest-" + path
                    blobs[(path, applied)] = "honest-" + path
                    blobs.setdefault((path, run_head), "honest-" + path)
                run = {
                    "status": "completed", "conclusion": "success",
                    "event": "workflow_dispatch", "head_sha": run_head,
                    "path": ".github/workflows/shared-supabase-migrations.yml",
                }
                api = self.preview_api(
                    run, [{"sha": "a" * 40}], blobs,
                    [self.apply_artifact(applied, digest=artifact_digest)],
                    compare={"status": "ahead", "behind_by": 0},
                )
                prove_preview(
                    run_id=7, digest=artifact_digest, pr_head="a" * 40, main_sha=main,
                    source_pr=source_pr, allowlist=[version], preview_project_ref=preview_ref,
                    merge_commit_sha=merge_commit_sha, api=api, repo_root=root,
                    downloader=lambda _id, dest: Path(dest).write_bytes(zip_path.read_bytes()),
                )

    def honest_instance(self, applied="1" * 40, project_ref=PREVIEW_PROJECT_REF):
        return {
            "schema": "shared-db-preview-instance-binding/v1",
            "rehearsalMode": "merged-main-rehearsal",
            "appliedCommit": applied,
            "previewProjectRef": project_ref,
            "runId": 7,
            "allowlist": ["20260814000000"],
            "sourcePr": 1,
            "mergeCommitSha": "b" * 40,
        }

    def test_post_merge_main_line_rehearsal_is_accepted_end_to_end(self):
        """The whole point of #1208: a merged, main-line rehearsal promotes."""
        self.run_full_prove_preview(instance=self.honest_instance())

    def test_forged_dispatch_ref_cannot_fabricate_a_main_line_rehearsal(self):
        """#1213 review, finding 1. The forge the artifact-name pin alone allowed.

        An attacker pushes branch `evil` whose workflow checks out current main
        (so `git rev-parse HEAD` IS main), skips the apply, hand-writes matching
        ledgers, apply log, content manifest and preview-instance.json, and
        uploads them as `preview-migration-apply-<main-sha>`. They then dispatch
        the workflow with `--ref evil`.

        Everything INSIDE the artifact is consistent, and the applied commit
        equals main, so a pin aimed only at the artifact name compares nothing
        and lets it through. Production would then apply for real versions that
        never touched preview.

        Only `run["head_sha"]` -- the ref GitHub read the workflow FILE from,
        which no part of the artifact can restate -- exposes it.
        """
        main, evil = "3" * 40, "e" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": evil, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        blobs = {}
        for path in PREVIEW_PRODUCER_PATHS:
            blobs[(path, main)] = "honest-" + path
            blobs[(path, evil)] = "honest-" + path
        # The one file the forger had to change: the workflow that runs.
        blobs[(PREVIEW_WORKFLOW, evil)] = "doctored-workflow"
        digest = "sha256:" + "c" * 64
        with self.assertRaisesRegex(RiskGateError, "different .* than exact main"):
            prove_preview(
                **self.prove_preview_args(
                    pr_head="a" * 40, main_sha=main,
                    api=self.preview_api(
                        run, [{"sha": "a" * 40}], blobs,
                        # Named after main, and the digest MATCHES, so nothing
                        # later in the gate would have stopped it either.
                        [self.apply_artifact(main, digest=digest)],
                        compare={"status": "identical", "behind_by": 0},
                    ),
                ),
                downloader=lambda *_: self.fail("forged dispatch ref must not reach download"),
            )

    def test_run_without_a_readable_head_sha_fails_closed(self):
        main = "3" * 40
        for head in (None, "", "not-a-sha", 123):
            run = {
                "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
                "head_sha": head, "path": ".github/workflows/shared-supabase-migrations.yml",
            }
            with self.subTest(head=head), self.assertRaisesRegex(
                RiskGateError, "commit whose workflow executed"
            ):
                prove_preview(
                    **self.prove_preview_args(
                        pr_head="a" * 40, main_sha=main,
                        api=self.preview_api(
                            run, [{"sha": "a" * 40}], {}, [self.apply_artifact(main)],
                            compare={"status": "identical", "behind_by": 0},
                        ),
                    ),
                    downloader=lambda *_: self.fail("must not download"),
                )

    def test_rehearsal_of_another_merged_pull_request_is_refused(self):
        """#1213 review, finding 2. `sourcePr` was written but never read."""
        instance = self.honest_instance()
        instance["sourcePr"] = 999
        with self.assertRaisesRegex(ValueError, "not the pull request being promoted"):
            self.run_full_prove_preview(instance=instance, source_pr=1)

    def test_rehearsal_naming_another_merge_commit_is_refused(self):
        instance = self.honest_instance()
        instance["mergeCommitSha"] = "f" * 40
        with self.assertRaisesRegex(ValueError, "not the merge commit"):
            self.run_full_prove_preview(instance=instance, merge_commit_sha="b" * 40)

    def test_merged_main_rehearsal_missing_its_pull_request_fields_is_refused(self):
        for field in ("sourcePr", "mergeCommitSha"):
            instance = self.honest_instance()
            del instance[field]
            with self.subTest(field=field), self.assertRaisesRegex(
                ValueError, "not the pull request being promoted|not the merge commit"
            ):
                self.run_full_prove_preview(instance=instance)

    def test_preview_evidence_without_an_instance_binding_is_refused(self):
        """PR #1194 review point 4. Deleting the binding must break this."""
        with self.assertRaisesRegex(ValueError, "carries no instance binding"):
            self.run_full_prove_preview(instance=None)

    def test_rebuilt_preview_cannot_inherit_the_deleted_previews_proof(self):
        """A rehearsal against rjyboqwcdzcocqgmsyel is not proof about mvpkijzfmfcxhnzqogzs."""
        with self.assertRaisesRegex(ValueError, "never inherits the proof"):
            self.run_full_prove_preview(
                instance=self.honest_instance(project_ref=DEAD_PREVIEW_PROJECT_REF)
            )

    def test_instance_binding_must_name_the_commit_in_the_artifact_name(self):
        with self.assertRaisesRegex(ValueError, "names applied commit"):
            self.run_full_prove_preview(instance=self.honest_instance(applied="c" * 40))

    def test_expected_preview_ref_is_never_defaulted_and_never_production(self):
        with self.assertRaisesRegex(ValueError, "never treated as a default"):
            self.run_full_prove_preview(instance=self.honest_instance(), preview_ref="")
        with self.assertRaisesRegex(ValueError, "is the PRODUCTION project ref"):
            self.run_full_prove_preview(
                instance=self.honest_instance(project_ref=PRODUCTION_PROJECT_REF),
                preview_ref=PRODUCTION_PROJECT_REF,
            )

    def test_instance_binding_writer_is_a_pinned_preview_producer(self):
        self.assertIn("scripts/preview_instance_binding.py", PREVIEW_PRODUCER_PATHS)

    def test_every_verification_sidecar_is_an_individually_pinned_producer(self):
        repo_root = Path(__file__).resolve().parents[1]
        actual = {
            path.relative_to(repo_root).as_posix()
            for path in (repo_root / "scripts/production-verification-sidecars").glob("*.json")
        }
        pinned = {path for path in PREVIEW_PRODUCER_PATHS if path.startswith("scripts/production-verification-sidecars/")}
        self.assertEqual(actual, pinned)

    PREVIEW_JOB_EXCLUSIONS = (
        # These run ONLY in the production-apply jobs, which check out exact main
        # and prove HEAD == origin/main before executing. They are not part of
        # the preview evidence-producing surface.
        "scripts/production_business_risk_gate.py",
        "scripts/production_apply_review_evidence.py",
        "scripts/production_catalog_verification.py",
        # Runtime data directory named by the verifier, not executable code.
        # Every reviewed JSON file beneath it is pinned individually because
        # GitHub's Contents API does not expose a directory as a blob.
        "scripts/production-verification-sidecars",
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

    # ---- runtime-READ data files (the class the closure walk cannot see) ----
    #
    # The closure walk follows what the preview job EXECUTES. A file that is only
    # READ at runtime -- by the Supabase CLI, by `jq`, by `psql` -- never appears
    # in it. `supabase/config.toml` was exactly that file: the CLI reads it on
    # every `link`, `migration list` and `db push` the preview job runs, and it
    # was pinned by neither commit and covered by no test. The two tests below
    # close that class, from both directions.

    @staticmethod
    def uncommented(text):
        """Lines with whole-line `#` / `//` comments dropped.

        Deliberately conservative: only lines whose FIRST non-blank character
        starts a comment are removed. A path named inside a comment is prose, not
        a read; a path named in code is a read until someone proves otherwise.
        """
        out = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith("//"):
                continue
            out.append(line)
        return "\n".join(out)

    def test_preview_producer_paths_cover_runtime_read_data_files(self):
        """Every data file under the preview job's data surface is pinned or explained.

        Driven by the FILESYSTEM, not by a hand-written list, so a data file added
        later cannot slip in silently: it fails this test until someone either
        pins it in PREVIEW_PRODUCER_PATHS or writes down, here, why it cannot
        shape preview evidence. That written reason is the artifact a reader who
        does not trust the author can check.
        """
        repo_root = Path(__file__).resolve().parents[1]
        pinned = set(PREVIEW_PRODUCER_PATHS)

        # The specific file this test exists for. Named explicitly so a future
        # edit that drops it from the tuple fails here with the reason attached,
        # not with a generic diff.
        self.assertIn(
            "supabase/config.toml", pinned,
            "the Supabase CLI reads supabase/config.toml on every preview link, "
            "migration list and db push; unpinned, a pre-merge claim-lane rehearsal "
            "could alter CLI behaviour between rehearsal and promotion",
        )

        # An exemption must describe something that exists, and must not also be
        # pinned -- a path that is both is a contradiction a reader cannot resolve.
        for key, reason in PREVIEW_RUNTIME_DATA_EXEMPTIONS.items():
            exempt_path = repo_root / key
            if not exempt_path.exists():
                # Tool-owned runtime directories are intentionally absent in a
                # clean checkout. Their exemption stays checkable only while the
                # repository still ignores a representative child path.
                ignored = subprocess.run(
                    ["git", "check-ignore", "-q", f"{key}/project-ref"],
                    cwd=repo_root,
                    check=False,
                ).returncode == 0
                self.assertTrue(
                    ignored,
                    f"stale runtime-read exemption: {key} neither exists nor has "
                    "a repository ignore rule. Delete the entry rather than "
                    "leaving a reason nobody can check.",
                )
            self.assertNotIn(
                key, pinned,
                f"{key} is both pinned and exempted; one of the two is wrong",
            )
            # A one-word "n/a" is not a reason. The bar is a sentence a reviewer
            # can disagree with.
            self.assertGreaterEqual(
                len(reason), 120,
                f"runtime-read exemption for {key} is too thin to check: {reason!r}",
            )

        unexplained = []
        for directory in PREVIEW_RUNTIME_DATA_DIRS:
            base = repo_root / directory
            self.assertTrue(base.is_dir(), f"declared data surface missing: {directory}")
            for path in sorted(base.rglob("*")):
                if not path.is_file():
                    continue
                rel = path.relative_to(repo_root).as_posix()
                if rel in pinned or rel in PREVIEW_RUNTIME_DATA_EXEMPTIONS:
                    continue
                # A directory-level exemption covers everything beneath it.
                if any(
                    rel.startswith(f"{key}/") for key in PREVIEW_RUNTIME_DATA_EXEMPTIONS
                ):
                    continue
                unexplained.append(rel)
        self.assertEqual(
            unexplained, [],
            "these files live on the preview job's data surface but are neither "
            "pinned in PREVIEW_PRODUCER_PATHS nor given a written reason in "
            f"PREVIEW_RUNTIME_DATA_EXEMPTIONS: {unexplained}. If a tool in the "
            "preview job can read it, pin it. If it cannot, say why, in words a "
            "reader can check.",
        )

    def test_supabase_cli_machine_state_is_explicitly_exempted(self):
        reason = PREVIEW_RUNTIME_DATA_EXEMPTIONS.get("supabase/.temp", "")
        self.assertIn("machine-specific", reason)
        self.assertGreaterEqual(len(reason), 120)

    @staticmethod
    def repository_paths_named_in(text, repo_root):
        """Repository files a body names, in every spelling the workflow uses.

        THREE SPELLINGS, not one. The first version of this scanner matched only
        a bare relative path, so `$GITHUB_WORKSPACE/types/database.types.ts`,
        `./config/x.json` and a slash-less root file all slipped past it -- and a
        mutation proving the scanner "bites" only bites in the one spelling it
        happens to use. The runner-temp prefixes must still NOT match: a copy
        under `$RUNNER_TEMP` is not the checkout.
        """
        found = set()
        # 1. explicit workspace-rooted reads, which is how the heredocs spell it.
        for match in re.findall(
            r"\$(?:GITHUB_WORKSPACE|\{GITHUB_WORKSPACE\})/([A-Za-z0-9_.\-/]+)", text
        ):
            found.add(match.rstrip("."))
        # 2. `./`-prefixed and bare relative paths.
        for match in re.findall(r"(?<![\w./$-])\.?/?((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+)", text):
            found.add(match.rstrip("."))
        # 3. slash-less repository-ROOT files (`AGENTS.md`, a stray `seed.sql`).
        for match in re.findall(r"(?<![\w./$-])([A-Za-z0-9_-]+\.[A-Za-z0-9]+)(?![\w/])", text):
            found.add(match.rstrip("."))
        return {rel for rel in found if (repo_root / rel).is_file()}

    @staticmethod
    def repository_dirs_named_in(text, repo_root):
        """Top-level repository DIRECTORIES a body names as a whole literal.

        THE GAP THIS CLOSES (#1213 review, round 5, finding 3). The path scanner
        above keeps whole-literal paths only, which is right for a read spelled
        `open("config/foo.json")` and useless against a read the producer BUILDS:
        `Path("policy") / "routing.json"` and `os.path.join("policy",
        "routing.json")` emit `"policy"` and `"routing.json"` as two separate
        literals. Neither trips the path scanner -- `"policy"` has no extension,
        and `"routing.json"` only matches if that name exists at the repository
        root -- so a whole data directory one step outside the declared surface
        was invisible to a test that claimed to cover it.

        A producer that names a top-level directory of this repository at all is
        therefore reported. That is deliberately blunter than "names it AND then
        reads a child": the child half is exactly the half a constructed path can
        hide, so requiring it would put the hole back.
        """
        # EXACT CASE. `(repo_root / name).is_dir()` is case-INSENSITIVE on
        # Windows and macOS, so the bare word `Supabase` in a shell message
        # resolved to the `supabase` directory and reported a read nobody made.
        # The real directory names are listed once and matched exactly instead.
        real = {entry.name for entry in repo_root.iterdir() if entry.is_dir()}
        found = set()
        for match in re.findall(r"(?<![\w./$-])([A-Za-z0-9_-]+)(?![\w/.])", text):
            if match in real:
                found.add(match)
        return found

    @staticmethod
    def scannable_text(path, body):
        """Reduce a body to the parts where a repository READ can actually appear.

        Blunt comment-stripping is not enough, because these scripts explain
        themselves at length: `AGENTS.md`, `HANDOFF.md` and `docs/*.md` appear in
        docstrings AND inside prose sentences in error messages. Deleting every
        string literal instead would delete the real reads too, since a path a
        script opens IS a string literal.

        So a Python body is tokenised and reduced to string literals whose WHOLE
        content is a path -- `"config/atomic-migration-allowlist.json"` survives,
        `"see docs/foo.md section 3"` does not, and a docstring never survives.
        That is the shape a read has and the shape a citation does not.

        A JavaScript body is treated the same way, for the same reason: a read
        there is `path.join(root, 'AGENTS.md')` -- a whole-literal path -- while a
        citation is a sentence that happens to contain one.
        """
        if path.suffix in {".mjs", ".js"}:
            literals = re.findall(r"'([^'\n]*)'|\"([^\"\n]*)\"|`([^`\n]*)`", body)
            return "\n".join(
                value.strip()
                for group in literals for value in group
                if value and re.fullmatch(r"[A-Za-z0-9_.\-/]+", value.strip())
            )
        if path.suffix != ".py":
            text = re.sub(r"/\*.*?\*/", " ", body, flags=re.S)
            return ProductionBusinessRiskGateTests.uncommented(text)
        import ast
        literals = []
        try:
            tree = ast.parse(body)
        except SyntaxError:  # pragma: no cover - a syntax error fails elsewhere
            return ""
        docstrings = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                first = (node.body or [None])[0]
                if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                        and isinstance(first.value.value, str):
                    docstrings.add(id(first.value))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                    and id(node) not in docstrings:
                value = node.value.strip()
                if re.fullmatch(r"[A-Za-z0-9_.\-/]+", value):
                    literals.append(value)
        return "\n".join(literals)

    def test_preview_runtime_data_dirs_are_the_only_data_surface(self):
        """PREVIEW_RUNTIME_DATA_DIRS must be exhaustive, not merely declared.

        The two walks below it are each bounded by that tuple: the inward walk
        only descends `supabase/` and `config/`, and the outward walk only sees
        what the JOB TEXT spells out. So a data file at `policy/routing.json`, at
        `types/`, or at the repository root, read at runtime by a PINNED producer
        through a path the producer constructs, escapes both -- one directory
        over from where `supabase/config.toml` was found.

        This closes that gap from the third direction: it reads the executed
        closure's own source, plus the job text, and fails on a reference to any
        repository file outside the declared data surface (the closure's own
        scripts and workflows excepted -- those are pinned by blob, not by
        directory).
        """
        repo_root = Path(__file__).resolve().parents[1]
        closure = self.executed_closure()
        bodies = [self.uncommented(self.preview_job_text())]
        for rel in sorted(closure):
            path = repo_root / rel
            if path.is_file():
                bodies.append(self.scannable_text(path, path.read_text(encoding="utf-8", errors="ignore")))
        # Code directories, not DATA directories: files here are pinned
        # individually in PREVIEW_PRODUCER_PATHS and walked by the closure test,
        # so they are not part of the data-surface question.
        code_dirs = {"scripts", ".github"}
        declared = set(PREVIEW_RUNTIME_DATA_DIRS) | code_dirs
        undeclared = set()
        for body in bodies:
            for rel in self.repository_paths_named_in(body, repo_root):
                top = rel.split("/")[0]
                if "/" not in rel:
                    undeclared.add(rel)          # a repository-ROOT data file
                elif top not in declared:
                    undeclared.add(rel)
            # CONSTRUCTED READS. A producer that assembles its own path never
            # emits the whole path as one literal, so the directory half is the
            # only half a scanner can see. See repository_dirs_named_in.
            for directory in self.repository_dirs_named_in(body, repo_root):
                if directory not in declared \
                        and directory not in PREVIEW_RUNTIME_DATA_EXEMPTIONS:
                    undeclared.add(directory)
        # The scan must be matching something, or this test passes vacuously.
        self.assertTrue(
            any(
                rel.startswith("supabase/") or rel.startswith("config/")
                for body in bodies
                for rel in self.repository_paths_named_in(body, repo_root)
            ),
            "the data-surface scan matched no declared-surface file; the pattern has rotted",
        )
        self.assertEqual(
            sorted(undeclared - set(PREVIEW_PRODUCER_PATHS)), [],
            "the preview job or a script it executes names these repository files, which "
            f"lie OUTSIDE PREVIEW_RUNTIME_DATA_DIRS {PREVIEW_RUNTIME_DATA_DIRS}: "
            f"{sorted(undeclared - set(PREVIEW_PRODUCER_PATHS))}. Either the tuple is no "
            "longer exhaustive -- widen it and re-run the walks -- or the file must be "
            "pinned in PREVIEW_PRODUCER_PATHS.",
        )

    # ------------------------------------------------------------------
    # EXEMPTION VERIFICATION REGISTRY (#1213 round 9, finding 2).
    #
    # A written reason is a CLAIM. Until something asserts it, it is a claim the
    # code is free to contradict silently. Three of the five exemptions were
    # verified by test_preview_job_reads_no_repository_file_outside_the_pinned_
    # surface, which finds them by searching their reason text for the exact
    # phrase "Never read by the preview job". The other two -- `docs` and
    # `supabase/migrations` -- are worded differently and were therefore verified
    # by NOTHING, and no test noticed, because a phrase FILTER reports nothing
    # about what it skipped.
    #
    # The two registries below close that class, not just the `docs` instance:
    # every exemption key must appear in exactly one of them, each named test
    # must exist, and each named test must name its key literally. A new
    # exemption cannot opt out of verification by being phrased unusually -- it
    # fails test_every_runtime_data_exemption_is_verified_somewhere until someone
    # either words it with the phrase or writes it a test.
    PHRASE_VERIFIED_EXEMPTIONS = frozenset({
        "config/blocker-ledger",
        "supabase/tests",
        "supabase/ci-bootstrap",
        "config/production-risk-policy-activation.json",
        # Issue #1366 Step 4. All three are static text: two document a field
        # contract that hand-rolled code in scripts/agent-work-contract.mjs
        # actually enforces, and the third is a pull-request-workflow flag whose
        # worst outcome is failing or passing a check a human sees. Each reason
        # opens with the exact phrase this registry verifies.
        "config/agent-work-contract.schema.json",
        "config/agent-completion-report.schema.json",
        "config/agent-work-contract-activation.json",
    })
    NAMED_TEST_VERIFIED_EXEMPTIONS = {
        "docs": "test_the_docs_exemption_is_verified_against_every_producer_that_names_it",
        "supabase/migrations": "test_the_payload_exemption_is_byte_bound_on_every_lane",
        "supabase/.temp": "test_supabase_cli_machine_state_is_explicitly_exempted",
    }

    def test_every_runtime_data_exemption_is_verified_somewhere(self):
        """No exemption may escape verification by being worded unusually."""
        keys = set(PREVIEW_RUNTIME_DATA_EXEMPTIONS)
        covered = self.PHRASE_VERIFIED_EXEMPTIONS | set(self.NAMED_TEST_VERIFIED_EXEMPTIONS)
        self.assertEqual(
            sorted(keys - covered), [],
            "these runtime-read exemptions carry a written reason that NOTHING "
            f"asserts: {sorted(keys - covered)}. Either word the reason 'Never "
            "read by the preview job', which "
            "test_preview_job_reads_no_repository_file_outside_the_pinned_surface "
            "enforces, or write a test that checks the reason you did give and "
            "register it in NAMED_TEST_VERIFIED_EXEMPTIONS.",
        )
        self.assertEqual(
            sorted(covered - keys), [],
            f"stale exemption-verification registration: {sorted(covered - keys)} is "
            "no longer an exemption. Delete the entry rather than leaving a test "
            "registered against nothing.",
        )
        self.assertEqual(
            sorted(self.PHRASE_VERIFIED_EXEMPTIONS & set(self.NAMED_TEST_VERIFIED_EXEMPTIONS)),
            [],
            "an exemption is registered in both registries; one of the two is wrong",
        )
        for key, test_name in self.NAMED_TEST_VERIFIED_EXEMPTIONS.items():
            method = getattr(type(self), test_name, None)
            self.assertTrue(
                callable(method),
                f"{key} is registered as verified by {test_name}, which does not exist",
            )
            # A REGISTRATION POINTING AT AN UNRELATED TEST IS A RUBBER STAMP.
            # The named test must at least name the key it claims to verify.
            self.assertIn(
                key, inspect.getsource(method),
                f"{test_name} is registered as the verifier for {key} but never "
                f"names it; the registration asserts nothing",
            )

    # EVERY PLACE A PRODUCER NAMES `docs`, CLASSIFIED (#1213 round 9, finding 2).
    #
    # The docs exemption claims docs is NAMED by a producer but never OPENED by
    # one. An inventory is what makes that checkable: a NE\w naming site fails
    # this test until someone classifies it deliberately, whatever shape it takes
    # -- including the shapes a line-by-line read detector cannot see, such as
    # `const d = "docs"` on one line and `readFileSync(path\.join(d, x))` on
    # another. The first of those two lines is a new site and reddens the count.
    #
    #   git-pathspec    -- passed to git after `--`, so GIT decides which files
    #                      exist there; the process never opens one.
    #   message-citation -- named inside a string a human reads, in a raised
    #                      error or a printed line. Nothing is opened.
    DOCS_NAMING_SITES = {
        ("scripts/manage-migration-author-lanes.mjs", "git-pathspec"): 2,
        # Added for issue #1812. The budget constants on line 46 of
        # manage-migration-author-lanes.mjs carry a trailing comment citing
        # docs/verification/reviewer-assignment-api-budget-2026-08-28.md, where
        # the 9 + 13 = 22 derivation is written out. Classified deliberately, as
        # this test asks: it is a CITATION in a comment and opens nothing. The
        # file is never read, joined into a path, required, or passed to git.
        # `uncommented()` strips whole-line comments but not a trailing `//`,
        # which is why a comment reaches this inventory at all -- that is the
        # tooth working, not a gap: a reader cannot tell a cited path from an
        # opened one without looking, so every new mention is made to argue for
        # itself. If this citation ever becomes a read, this entry must go and
        # docs must be pinned in PREVIEW_PRODUCER_PATHS instead.
        ("scripts/manage-migration-author-lanes.mjs", "message-citation"): 1,
        ("scripts/production_migration_guard.py", "message-citation"): 1,
    }

    def test_the_docs_exemption_is_verified_against_every_producer_that_names_it(self):
        """#1213 round 9, finding 2. `docs` claims to be NAMED but never OPENED.

        The claim is true today. scripts/manage-migration-author-lanes.mjs passes
        the string `docs` to `git grep -l` and to `git add` as a PATHSPEC, after
        the `--` separator, and scripts/production_migration_guard.py cites a docs
        filename inside a GuardError message. Neither opens a file. Nothing
        checked that, because the reason is worded differently from the "Never
        read by the preview job" phrase the surface test filters on, and a filter
        reports nothing about what it skipped.

        A later readFileSync of a docs file, or a path.join("docs", name), would
        have stayed green: `docs` is already in the exemption map, so the
        constructed-read walk skips it and the inward walk treats everything
        beneath an exempted directory as exempt.

        Two teeth, because either alone is escapable:

        1. NO READ SHAPE may appear on a line that names docs.
        2. THE INVENTORY of naming sites must match DOCS_NAMING_SITES exactly.
           A read assembled across two lines defeats tooth 1 but not tooth 2:
           the line that first names `docs` is a new site.
        """
        repo_root = Path(__file__).resolve().parents[1]
        # A read, in either language, in the shapes a producer would actually use.
        read_shapes = re.compile(
            r"\breadFileSync|readFile|readdir|readdirSync|createReadStream|"
            r"open|read_text|read_bytes|glob|rglob|iterdir|require|import|"
            r"path\.join|Path\(|os\.path"
        )
        pathspec_shape = re.compile(r"\bexecFileSync\b.*['\"]git['\"].*['\"]--['\"]")
        found = {}
        sites = []
        for rel in sorted(self.executed_closure()):
            path = repo_root / rel
            if not path.is_file():
                continue
            body = self.uncommented(path.read_text(encoding="utf-8", errors="ignore"))
            for number, line in enumerate(body.splitlines(), start=1):
                if not re.search(r"(?<![\w./-])docs(?![\w-])", line):
                    continue
                sites.append((rel, number, line.strip()))
                self.assertIsNone(
                    read_shapes.search(line),
                    f"{rel}:{number} names `docs` next to a read: {line.strip()!r}. "
                    f"The docs entry in PREVIEW_RUNTIME_DATA_EXEMPTIONS claims no "
                    f"docs file is ever read into the preview job's behaviour. Pin "
                    f"docs in PREVIEW_PRODUCER_PATHS or rewrite the reason -- do "
                    f"not leave a reason the code contradicts.",
                )
                kind = "git-pathspec" if pathspec_shape.search(line) else "message-citation"
                found[(rel, kind)] = found.get((rel, kind), 0) + 1
        self.assertEqual(
            found, dict(self.DOCS_NAMING_SITES),
            "the inventory of places a preview producer names `docs` changed:\n"
            f"  expected {dict(self.DOCS_NAMING_SITES)}\n"
            f"  found    {found}\n"
            f"  sites    {sites}\n"
            "Classify the new site deliberately. If it opens a docs file -- even "
            "through a path assembled across several lines -- the docs exemption "
            "is false and docs must be pinned in PREVIEW_PRODUCER_PATHS.",
        )

    def test_the_payload_exemption_is_byte_bound_on_every_lane(self):
        """`supabase/migrations` is exempted as THE PAYLOAD, not as unread.

        It is the one exemption that cannot be pinned to exact main: on the
        pre-merge claim lane the pull-request head legitimately carries migration
        files main does not have yet. Its reason therefore claims something
        stronger instead -- that the bytes are bound on EVERY lane. This drives
        both lanes and fails if either binding stops refusing amended bytes.

        Registered in NAMED_TEST_VERIFIED_EXEMPTIONS because its reason cannot
        carry the "Never read by the preview job" phrase: the preview job reads
        supabase/migrations constantly. That is the entire point of it.
        """
        self.assertIn("supabase/migrations", PREVIEW_RUNTIME_DATA_EXEMPTIONS)
        self.assertNotIn("supabase/migrations", PREVIEW_PRODUCER_PATHS)

        # Lane 1 -- claim and merged-main: the promoted run's own content
        # manifest versus the file on exact main.
        temp, root, version, _, texts = self.plain_preview_fixture()
        with temp:
            (root / f"supabase/migrations/{version}_exact.sql").write_bytes(
                b"drop table plm.item;\n"
            )
            with self.assertRaisesRegex(RiskGateError, "different bytes than exact main"):
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

        # Lane 2 -- historical recovery, which writes nothing and so has no
        # manifest of its own: the digest recorded by the run that ORIGINALLY
        # applied the version, versus the file on exact main.
        with self.assertRaisesRegex(RiskGateError, "different bytes than exact main"):
            self.run_historical_prove_preview(
                rehearsed_body="select 1;\n", main_body="drop table core.customer;\n"
            )

    def test_preview_job_reads_no_repository_file_outside_the_pinned_surface(self):
        """The other direction: nothing the workflow names escapes the pin.

        The test above walks the data directories inward. This one walks the
        preview job's own text outward, so a NEW step that reads a repository
        file from some third location -- `types/`, `apps/`, `docs/` -- fails here
        instead of quietly widening the evidence-producing surface. Only paths
        that actually resolve to a file in this repository are considered, which
        drops action references such as `supabase/setup-cli@v1`.
        """
        repo_root = Path(__file__).resolve().parents[1]
        job = self.uncommented(self.preview_job_text())
        # A repo-relative path is one NOT preceded by another path character, so
        # `$RUNNER_TEMP/bounded-preview/supabase/migrations` -- a runner-temp copy,
        # not the checkout -- is correctly not treated as a repository read.
        referenced = self.repository_paths_named_in(job, repo_root)
        # THE EXEMPTION IS ABOUT THE PREVIEW JOB, WHICH IS NOT THE JOB YAML.
        # Asserting the "never read" premise against the workflow text alone let
        # a PINNED SCRIPT start reading `supabase/tests/foo.sql` while both this
        # test and the inward walk stayed green -- the inward walk treats
        # everything under an exempted directory as exempt, and the job text
        # never mentions the script's own reads (#1213 review, round 5, finding
        # 3). The closure's scannable text is added, so a read that moves into a
        # script is still a read by the preview job.
        executed = set(referenced)
        for rel in sorted(self.executed_closure()):
            path = repo_root / rel
            if path.is_file():
                executed |= self.repository_paths_named_in(
                    self.scannable_text(
                        path, path.read_text(encoding="utf-8", errors="ignore")
                    ),
                    repo_root,
                )
        # Guard against the scan silently matching nothing, which would make this
        # test pass through an unasserted condition -- a defect in itself.
        self.assertIn(
            "scripts/production_migration_guard.py", referenced,
            "the preview-job path scan matched nothing recognisable; the pattern "
            "has rotted and this test is no longer checking anything",
        )
        # ONLY the payload is whitelisted. Whitelisting the other three
        # exemptions would let a future step that DOES read one of them leave
        # this test green while falsifying the written reason -- exactly the
        # failure the registry exists to catch. Their premise is asserted
        # instead, immediately below, the way PREVIEW_JOB_EXCLUSIONS already is.
        allowed = set(PREVIEW_PRODUCER_PATHS) | set(self.PREVIEW_JOB_EXCLUSIONS) | {PREVIEW_WORKFLOW}
        allowed.add("supabase/migrations")
        # WHICH EXEMPTIONS THIS TEST ACTUALLY VERIFIED. The loop below used to
        # `continue` past any reason worded differently, so an exemption could opt
        # OUT of verification simply by not containing the magic phrase -- which
        # is exactly what `docs` did (#1213 round 9, finding 2). Recording the
        # keys it covers turns the phrase from a filter into an accounted-for
        # branch, and `test_every_runtime_data_exemption_is_verified_somewhere`
        # fails on any key that neither this loop nor a named test covers.
        phrase_verified = set()
        for key, reason in PREVIEW_RUNTIME_DATA_EXEMPTIONS.items():
            if "Never read by the preview job" not in reason:
                continue
            phrase_verified.add(key)
            self.assertNotIn(
                key, executed,
                f"{key} is exempted because it is 'Never read by the preview job', "
                f"but the preview job or a script it executes now names it. Pin it in "
                f"PREVIEW_PRODUCER_PATHS or rewrite the reason -- do not leave a reason "
                f"the code contradicts.",
            )
            for rel in sorted(executed):
                self.assertFalse(
                    rel.startswith(f"{key}/"),
                    f"{key} is exempted as never read by the preview job, but the job "
                    f"or a script it executes now names {rel} beneath it",
                )
        self.assertEqual(
            phrase_verified, self.PHRASE_VERIFIED_EXEMPTIONS,
            "the set of exemptions carrying the 'Never read by the preview job' "
            "phrase changed. Update PHRASE_VERIFIED_EXEMPTIONS and make sure the "
            "moved key is still verified by something.",
        )
        escaped = sorted(
            rel for rel in referenced
            if rel not in allowed and not rel.startswith("supabase/migrations/")
        )
        self.assertEqual(
            escaped, [],
            "the preview job names these repository files, but they are neither "
            f"pinned nor explained: {escaped}. Anything the preview job reads can "
            "shape its evidence.",
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
        forged = "b" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": forged, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        api = self.preview_api(
            run, [{"sha": "a" * 40}], {}, [self.apply_artifact(forged)],
            compare={"status": "diverged", "ahead_by": 1, "behind_by": 1},
        )
        with self.assertRaisesRegex(RiskGateError, "not contained in the history of exact main"):
            prove_preview(
                **self.prove_preview_args(api=api),
                downloader=lambda *_: self.fail("forged run must not download"),
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
            if "/git/trees/" in endpoint:
                tree_ref(endpoint)
                return {"truncated": False,
                        "tree": [{"path": p} for p in PREVIEW_PRODUCER_PATHS]}
            if "/contents/" in endpoint:
                # Producer files identical at the run head and at main, so this
                # test still exercises the digest check it is named for.
                return {"sha": "identical-producer-blob"}
            return run

        with self.assertRaisesRegex(RiskGateError, "pinned digest"):
            prove_preview(
                **self.prove_preview_args(pr_head=head, main_sha="b" * 40, api=api),
                downloader=lambda *_: self.fail("wrong digest must not download"),
            )

        artifact["digest"] = "sha256:" + "c" * 64
        artifact["workflow_run"] = {"id": 8}
        with self.assertRaisesRegex(RiskGateError, "another run"):
            prove_preview(
                **self.prove_preview_args(pr_head=head, main_sha="b" * 40, api=api),
                downloader=lambda *_: self.fail("wrong run must not download"),
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
        # The ordinary apply path must stay excluded on BOTH historical forms.
        # A batch authored across several PRs supplies a per-version source map
        # and no single source PR, so a condition testing only the single-PR
        # input would let the real apply run during a no-write recovery.
        self.assertIn(
            "inputs.mode == 'apply' && (inputs.historical_preview_source_pr == '' "
            "&& inputs.historical_preview_source_pr_map == '')", text)
        for guarded in ("historical_preview_source_pr == ''", "historical_preview_source_pr_map == ''"):
            self.assertIn(guarded, text)

    def historical_v2_api(self, main, versions, authored=None):
        authored = authored or {pr: v for v, pr in versions.items()}
        def api(endpoint):
            if endpoint.endswith("commits?per_page=100"):
                return [{"sha": main}]
            if "/contents/" in endpoint:
                return {"sha": "identical-producer-blob"}
            if "/pulls/" in endpoint and "/files" in endpoint:
                pr = int(endpoint.split("/pulls/")[1].split("/")[0])
                version = authored.get(pr)
                return [] if version is None else [
                    {"filename": f"supabase/migrations/{version}_release_a.sql", "status": "added"}]
            if "/pulls/" in endpoint:
                return {"merged": True, "merge_commit_sha": main}
            return {}
        return api

    def test_gate_rejects_a_v2_record_whose_map_names_the_wrong_pull_request(self):
        """A forged map must not pass just because it lives in a pinned artifact.

        The map is attacker-influenced: it arrives inside the preview artifact.
        The gate re-derives from it, so the protection is that re-derivation
        FAILS for a mapping that does not match real authorship.
        """
        from historical_preview_recovery import verify as verify_historical
        versions = {"20260814130000": 984, "20260814193402": 992}
        main = "e" * 40
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "supabase/migrations").mkdir(parents=True)
            for version in versions:
                (root / f"supabase/migrations/{version}_release_a.sql").write_text("select 1;", encoding="utf-8")
            subprocess.run(["git", "init"], cwd=root, check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["git", "config", "user.email", "x@y"], cwd=root)
            subprocess.run(["git", "config", "user.name", "x"], cwd=root)
            subprocess.run(["git", "add", "."], cwd=root)
            subprocess.run(["git", "commit", "-m", "x"], cwd=root, check=True, stdout=subprocess.DEVNULL)
            real = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            api = self.historical_v2_api(real, versions)
            # Honest map re-derives cleanly.
            runs = "20260814130000:9001,20260814193402:9002"
            honest = verify_historical(None, real, ",".join(sorted(versions)), root, api,
                                       source_map="20260814130000:984,20260814193402:992",
                                       original_run_map=runs)
            self.assertEqual(honest["schema"], "shared-db-historical-preview-source/v4")
            # Swapping the PRs is refused, so a forged record cannot re-derive.
            with self.assertRaisesRegex(ValueError, "did not author"):
                verify_historical(None, real, ",".join(sorted(versions)), root, api,
                                  source_map="20260814130000:992,20260814193402:984",
                                  original_run_map=runs)

    # ---- the historical-recovery byte binding (review round 4, finding 1) ----
    #
    # A recovery run writes nothing, so for a long time this lane waived byte
    # equality entirely: it proved authorship and ledger presence, and the
    # sequence "rehearse harmless bytes A, amend the file to destructive bytes B,
    # merge, recover proof, promote B" walked straight through the last gate
    # before a production write. The record must now name the run that ORIGINALLY
    # applied each version, and the gate reads that run's own manifest.

    HISTORICAL_VERSION = "20260814130000"

    def historical_repo(self, body="select 1;\n", migration_files="one"):
        """A real git repo, because the recovery proof shells out to git.

        TWO commits, and the distinction matters: the FIRST is the merge commit
        that landed the migration, the SECOND is today's exact main. They were
        the same commit until the #1213 round-6 review, which left every
        "pinned to the merge commit" test unable to tell that pin apart from
        "pinned to today's main".
        """
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / "supabase/migrations").mkdir(parents=True)
        # HOW MANY FILES CARRY THIS VERSION. The gate refuses zero (the version
        # is not on exact main at all) and refuses two or more (which of them did
        # preview rehearse?). This fixture hardcoded exactly one, so neither half
        # of `len(matches) != 1` could be driven and the guard could be deleted
        # with the suite green (#1213 round 9, author's hunt).
        if migration_files != "none":
            (root / f"supabase/migrations/{self.HISTORICAL_VERSION}_release_a.sql").write_bytes(
                body.encode("utf-8")
            )
        if migration_files == "two":
            (root / f"supabase/migrations/{self.HISTORICAL_VERSION}_release_b.sql").write_bytes(
                body.encode("utf-8")
            )
        # Git needs SOMETHING to commit when the migration is absent.
        (root / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "init"], cwd=root, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "config", "user.email", "x@y"], cwd=root)
        subprocess.run(["git", "config", "user.name", "x"], cwd=root)
        subprocess.run(["git", "add", "."], cwd=root)
        subprocess.run(["git", "commit", "-m", "x"], cwd=root, check=True, stdout=subprocess.DEVNULL)
        merge_sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        (root / "later.txt").write_text("main moved on\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=root)
        subprocess.run(["git", "commit", "-m", "later"], cwd=root, check=True,
                       stdout=subprocess.DEVNULL)
        main = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        return temp, root, main, merge_sha

    def historical_zip(self, path, *, main, record, version, record_json=None):
        """The RECOVERY run's evidence: no write, so the ledger must not move."""
        ledger = json.dumps([{"remote": "20260801000000"}, {"remote": version}])
        payload = {
            "preview-ledger-before.txt": ledger,
            "preview-ledger-after.txt": ledger,
            "preview-dry-run.txt": f"HISTORICAL PREVIEW PROOF\n{version}_release_a.sql\n",
            "preview-apply.txt": f"HISTORICAL PREVIEW PROOF\n{version}_release_a.sql\n",
            "historical-preview-source.json":
                record_json if record_json is not None else json.dumps(record),
            "preview-instance.json": json.dumps({
                "schema": "shared-db-preview-instance-binding/v1",
                "rehearsalMode": "historical-recovery", "appliedCommit": main,
                "previewProjectRef": PREVIEW_PROJECT_REF, "runId": 7,
                "allowlist": [version],
            }),
        }
        with zipfile.ZipFile(path, "w") as archive:
            for name, text in payload.items():
                archive.writestr(name, text)
        return "sha256:" + hashlib.sha256(Path(path).read_bytes()).hexdigest()

    def original_run_zip(self, path, *, version, digest, applied=True, recovery=False,
                         instance=None, manifest_json=None):
        """The ORIGINAL apply run's evidence: it really moved preview's ledger.

        `manifest_json` replaces `migration-content-manifest.json` wholesale, so
        a test can produce a run whose manifest has no usable digest for the
        version. Without it that guard was unreachable: the manifest was always
        `json.dumps({version: digest})` and `digest` was always a real sha256 hex
        string, so `not isinstance(recorded, str) or not re.fullmatch(64 hex)`
        could be deleted with the suite green (#1213 round 9, author's hunt).
        """
        before = json.dumps([{"remote": "20260801000000"}])
        after = json.dumps(
            [{"remote": "20260801000000"}] + ([{"remote": version}] if applied else [])
        )
        payload = {
            "preview-ledger-before.txt": before,
            "preview-ledger-after.txt": after,
            "preview-dry-run.txt": f"Applying migration {version}_release_a.sql...",
            "preview-apply.txt": f"Applying migration {version}_release_a.sql...",
            "migration-content-manifest.json": (
                json.dumps({version: digest}) if manifest_json is None else manifest_json
            ),
        }
        if recovery:
            payload["historical-preview-source.json"] = json.dumps({"schema": "x"})
        if instance is not None:
            payload["preview-instance.json"] = instance
        with zipfile.ZipFile(path, "w") as archive:
            for name, text in payload.items():
                archive.writestr(name, text)

    def run_historical_prove_preview(
        self, *, rehearsed_body="select 1;\n", main_body="select 1;\n",
        original_run=555, record_runs="default", original_applied=True,
        original_is_recovery=False, original_conclusion="success",
        original_head_sha="default", original_head_in_history=True,
        original_head_blobs=None, original_run_blobs=None, original_instance=None,
        merge_commit_blobs=None, merge_absent_paths=(), original_absent_paths=(),
        original_commit_in_pr=True, original_commit_in_history=True,
        run_shape=None, original_run_shape=None, original_manifest_json=None,
        migration_files="one", corrupt_download=False, record_extra=None,
        record_json=None, recovery_applied_commit=None, original_binding_overrides=None,
        merge_is_ancestor_of_original_head=True,
    ):
        """End to end through prove_preview, downloads and all.

        `rehearsed_body` is what the ORIGINAL run recorded a digest for;
        `main_body` is what exact main carries now. Equal in the honest case,
        different in the attack.

        THE ORIGINAL RUN HAS TWO COMMITS, and the last four arguments exist so a
        test can drive them apart, which the first version of this helper could
        not: it always set `head_sha` equal to the artifact-name commit and always
        listed that commit as a commit of the source PR, so no forged dispatch was
        reachable through this path at all (#1213 review, round 5, finding 1).

        * `original_head_sha` -- the ref the ORIGINAL dispatch was aimed at.
        * `original_head_in_history` -- whether exact main contains it.
        * `original_head_blobs` -- producer blobs at the DISPATCH REF only, so a
          doctored workflow at an otherwise honest-looking ref can be expressed.
        * `original_run_blobs` -- producer blobs at BOTH of the original run's
          commits, i.e. an old run that is internally consistent but carries
          producer files today's main no longer has. A pin aimed at today's main
          fails on this; a pin aimed at the authoring merge commit passes it only
          when `merge_commit_blobs` carries the same values.
        * `merge_commit_blobs` -- producer blobs at the MERGE COMMIT that landed
          the version, separated from every other ref so a test can state which
          commit the pin is really aimed at. The round-5 helper could not: it
          defaulted every blob to one value and used one commit for the merge
          commit and for main, so "pinned to each other" and "pinned to the merge
          commit" were indistinguishable (#1213 round 6, finding 1).
        * `original_commit_in_pr` -- whether the ARTIFACT-NAME commit is listed
          as a commit of the source pull request. The round-7 helper hardcoded it
          into `pr_commits`, so `original_commit` could never be made foreign and
          deleting the `prove_applied_commit_is_main_line` guard on it changed no
          test at all -- the twin guard on `run_head` was tested, this one was
          not (#1213 round 8, finding 2). Set it False to forge an artifact named
          `preview-migration-apply-<unrelated-sha>`.
        * `run_shape` -- overrides for the RECOVERY run's own shape (status,
          conclusion, event, path). The four-key loop that rejects a run of the
          wrong shape had no test at all before #1213 round 8: this helper always
          produced a perfect run and no other test reached `prove_preview` with a
          working evidence chain.
        * `original_run_shape` -- the same, for the ORIGINAL APPLY run. The
          round-8 helper could set only `original_conclusion`, so three of that
          loop's four keys -- `status`, `event` and `path` -- could be deleted
          from `expected`, or made tautologies, with the whole suite still green
          (#1213 round 9, finding 1). Without an enforceable `path` and `event`
          the gate accepts a run of some OTHER workflow, dispatched or pushed,
          that never executed the preview job at all: an attacker's second
          workflow can write a ledger delta and a content manifest matching exact
          main from a commit already on the authoring pull request, so `head_sha`,
          the artifact-name commit and the producer pin all pass honestly. A
          per-guard mutation sweep cannot see this -- replacing the whole `if`
          with `if False:` still fails the conclusion case -- so each key needs
          its own raising test.
        * `original_manifest_json` -- the raw content manifest the ORIGINAL run
          wrote, for a run whose manifest names no usable digest for the version.
        * `migration_files` -- "one" (honest), "none" (the version is not on exact
          main at all) or "two" (two files carry the same version, so which one
          preview rehearsed is unanswerable).
        * `corrupt_download` -- the downloaded recovery artifact's bytes no longer
          hash to the pinned digest. The API-reported digest is checked in a
          separate line that IS tested; this is the second, post-download check.
        * `record_extra` -- extra keys merged into the historical record so it can
          no longer equal what `verify_historical_preview` re-derives.
        * `record_json` -- the raw `historical-preview-source.json` text, for a
          record that is not even an object, or whose `sourcePrMap` is not one.
        * `recovery_applied_commit` -- the commit the RECOVERY run's artifact
          names. A no-write recovery proves nothing by applying, so it must have
          run at exact main.
        * `original_commit_in_history` -- whether exact main contains that same
          artifact-name commit. False plus `original_commit_in_pr=False` is a
          forged artifact named after a commit belonging to nothing.
        * `original_instance` -- the raw `preview-instance.json` that run wrote,
          or None for a run whose producer code predates instance binding.
        * `merge_absent_paths` / `original_absent_paths` -- producer files that
          do NOT exist at the merge commit / at the original run's commits.
          `scripts/preview_instance_binding.py` really is absent at the merge
          commits of #984, #992 and #1126, and #984/#992 additionally predate
          `scripts/atomic_migration_apply.py`,
          `scripts/historical_preview_recovery.py` and
          `config/atomic-migration-allowlist.json` (verified with `gh api`).
        """
        version = self.HISTORICAL_VERSION
        temp, root, main, merge_sha = self.historical_repo(main_body, migration_files)
        with temp:
            rehearsed_digest = hashlib.sha256(rehearsed_body.encode("utf-8")).hexdigest()
            record = {
                "schema": "shared-db-historical-preview-source/v3",
                "sourcePr": 984, "sourceMergeSha": merge_sha, "mainSha": main,
                "allowlist": [version],
                "originalApplyRuns": {version: original_run}
                if record_runs == "default" else record_runs,
            }
            record.update(record_extra or {})
            if original_instance == "valid-merged-main-binding":
                binding = {
                    "schema": "shared-db-preview-instance-binding/v1",
                    "rehearsalMode": "merged-main-rehearsal",
                    "appliedCommit": "a" * 40,
                    "previewProjectRef": PREVIEW_PROJECT_REF,
                    "runId": original_run,
                    "allowlist": [version],
                    "sourcePr": 984,
                    "mergeCommitSha": merge_sha,
                }
                binding.update(original_binding_overrides or {})
                original_instance = json.dumps(binding)
            zips = tempfile.TemporaryDirectory()
            with zips:
                recovery_path = Path(zips.name, "recovery.zip")
                artifact_digest = self.historical_zip(
                    recovery_path, main=main, record=record, version=version,
                    record_json=record_json,
                )
                original_path = Path(zips.name, "original.zip")
                self.original_run_zip(
                    original_path, version=version, digest=rehearsed_digest,
                    applied=original_applied, recovery=original_is_recovery,
                    instance=original_instance, manifest_json=original_manifest_json,
                )
                original_commit = "a" * 40
                original_head = (
                    original_commit if original_head_sha == "default" else original_head_sha
                )
                pr_commits = [{"sha": main}]
                if original_commit_in_pr:
                    pr_commits.append({"sha": original_commit})
                elif original_head not in (None, original_commit):
                    # The DISPATCH REF stays legitimate so the refusal under test
                    # can only come from the artifact-name commit. Without this
                    # the twin `run_head` guard would raise the identical message
                    # and deleting either one would leave the test green.
                    pr_commits.append({"sha": original_head})

                def producer_tree(ref):
                    """Which producer files that commit's tree actually holds.

                    `PREVIEW_PRODUCER_PATHS` is TODAY's list. A commit from last
                    year does not carry a file added this year, and the two
                    `*_absent_paths` arguments are how a test says so.
                    """
                    if ref == merge_sha:
                        absent = set(merge_absent_paths)
                    elif ref in (original_head, original_commit):
                        absent = set(original_absent_paths)
                    else:
                        absent = set()
                    return [p for p in PREVIEW_PRODUCER_PATHS if p not in absent]

                def api(endpoint):
                    if endpoint == f"repos/u2giants/shared-db/actions/runs/{original_run}":
                        # `__replace__` returns a NON-DICT payload, which no
                        # amount of key overriding can express.
                        if original_run_shape and "__replace__" in original_run_shape:
                            return original_run_shape["__replace__"]
                        run = {"status": "completed", "conclusion": original_conclusion,
                               "event": "workflow_dispatch", "path": PREVIEW_WORKFLOW,
                               **(original_run_shape or {})}
                        if original_head is not None:
                            run["head_sha"] = original_head
                        return run
                    if endpoint.endswith(f"runs/{original_run}/artifacts?per_page=100"):
                        return {"artifacts": [self.apply_artifact(
                            original_commit, artifact_id=99, run_id=original_run)]}
                    if endpoint == "repos/u2giants/shared-db/actions/runs/7":
                        if run_shape and "__replace__" in run_shape:
                            return run_shape["__replace__"]
                        return {"status": "completed", "conclusion": "success",
                                "event": "workflow_dispatch", "head_sha": main,
                                "path": PREVIEW_WORKFLOW, **(run_shape or {})}
                    if endpoint.endswith("runs/7/artifacts?per_page=100"):
                        return {"artifacts": [self.apply_artifact(
                            recovery_applied_commit or main, digest=artifact_digest)]}
                    if endpoint.endswith("commits?per_page=100"):
                        return pr_commits
                    if "/git/trees/" in endpoint:
                        ref = tree_ref(endpoint)
                        return {"truncated": False,
                                "tree": [{"path": p} for p in producer_tree(ref)]}
                    if "/contents/" in endpoint:
                        path, ref = endpoint.split("/contents/", 1)[1].split("?ref=")
                        # RAISE ON A PATH THAT IS NOT IN THAT TREE, exactly as
                        # GitHub 404s and exactly as `preview_api` already did.
                        # The round-6 version of this stub answered
                        # "identical-producer-blob" for EVERY path including
                        # files that did not exist, which is why three mutation
                        # runs could not see that the recovery lane refused
                        # every honest old recovery (#1213 round 7, finding 1).
                        if path not in producer_tree(ref):
                            raise RuntimeError("no such content")
                        if merge_commit_blobs and ref == merge_sha:
                            return {"sha": merge_commit_blobs.get(
                                path, "identical-producer-blob")}
                        if original_head_blobs and ref == original_head:
                            return {"sha": original_head_blobs.get(
                                path, "identical-producer-blob")}
                        if original_run_blobs and ref in (original_head, original_commit):
                            return {"sha": original_run_blobs.get(
                                path, "identical-producer-blob")}
                        return {"sha": "identical-producer-blob"}
                    if "/pulls/" in endpoint and "/files" in endpoint:
                        return [{"filename":
                                 f"supabase/migrations/{version}_release_a.sql",
                                 "status": "added"}]
                    if "/pulls/" in endpoint:
                        return {"merged": True, "merge_commit_sha": merge_sha}
                    if "/compare/" in endpoint:
                        comparison = endpoint.split("/compare/", 1)[1]
                        base, head = comparison.split("...", 1)
                        if (
                            base == merge_sha and head == original_head
                            and not merge_is_ancestor_of_original_head
                        ):
                            return {"status": "diverged", "behind_by": 3}
                        if base == original_commit and not original_commit_in_history:
                            return {"status": "diverged", "behind_by": 3}
                        if base == original_head and not original_head_in_history:
                            return {"status": "diverged", "behind_by": 3}
                        return {"status": "identical", "behind_by": 0}
                    return {}

                # WHAT WAS DOWNLOADED, so a test can assert a refusal happened
                # BEFORE the original run's artifact was ever fetched. A guard
                # that only refuses after reading the attacker's bytes has
                # already trusted them once.
                self.downloaded = []

                def downloader(artifact_id, dest):
                    self.downloaded.append(artifact_id)
                    source = original_path if artifact_id == 99 else recovery_path
                    raw = source.read_bytes()
                    if corrupt_download and artifact_id != 99:
                        raw = raw + b"tampered"
                    Path(dest).write_bytes(raw)

                prove_preview(
                    run_id=7, digest=artifact_digest, pr_head=main, main_sha=main,
                    source_pr=984, allowlist=[version],
                    preview_project_ref=PREVIEW_PROJECT_REF, merge_commit_sha=main,
                    api=api, repo_root=root, downloader=downloader,
                )

    def test_the_preview_runs_own_shape_is_checked(self):
        """Found by this PR's own mutation sweep, not by review.

        `prove_preview` opens with a four-key loop rejecting a run that is not a
        completed, successful, `workflow_dispatch` run of the preview workflow.
        Replacing that condition with `if False:` left the entire offline suite
        green: every other test that reaches this function is refused further
        down, and no test ever handed it a run of the wrong shape with an
        otherwise working evidence chain. The twin loop in
        `prove_historical_original_apply_runs` was tested; this one was not.
        """
        for key, value in (
            ("status", "in_progress"), ("conclusion", "failure"),
            ("event", "push"), ("path", ".github/workflows/something-else.yml"),
        ):
            with self.subTest(key=key), self.assertRaisesRegex(
                RiskGateError, f"preview run has wrong {key}"
            ):
                self.run_historical_prove_preview(run_shape={key: value})

    def test_downloaded_preview_bytes_must_hash_to_the_pinned_digest(self):
        """The SECOND digest check, on the bytes rather than on GitHub's claim.

        The first compares the artifact digest GitHub reports against the pinned
        one and is tested. This one re-hashes what actually arrived, which is the
        only line that survives a lying or compromised download path -- and it
        had no test until this PR's mutation sweep found it.
        """
        with self.assertRaisesRegex(
            RiskGateError, "downloaded preview artifact bytes do not match the pinned digest"
        ):
            self.run_historical_prove_preview(corrupt_download=True)

    def test_an_unreadable_historical_record_is_refused(self):
        """A record that is not an object at all."""
        with self.assertRaisesRegex(RiskGateError, "historical preview source proof is unreadable"):
            self.run_historical_prove_preview(record_json="[]")

    def test_an_unreadable_historical_source_map_is_refused(self):
        """`sourcePrMap` present but not a usable object.

        Both the `is not None` branch selector and the shape check under it
        survived mutation: nothing drove this helper down the v4 map branch with
        a broken map.
        """
        for label, raw in (
            ("map is not an object", '{"schema": "shared-db-historical-preview-source/v3", '
             '"sourcePrMap": "nope", "originalApplyRuns": {"20260814130000": 555}}'),
            ("map is empty", '{"schema": "shared-db-historical-preview-source/v3", '
             '"sourcePrMap": {}, "originalApplyRuns": {"20260814130000": 555}}'),
        ):
            with self.subTest(label), self.assertRaisesRegex(
                RiskGateError, "historical preview source map is unreadable"
            ):
                self.run_historical_prove_preview(record_json=raw)

    def test_a_record_that_does_not_match_the_re_derivation_is_refused(self):
        """The whole-record equality check, mutation-proved.

        `verify_historical_preview` re-derives the record from live GitHub state
        and main. Anything the promoter added, removed or altered makes the two
        unequal. Every existing test drove a field the re-derivation itself
        reproduces, so the comparison could be deleted without turning any test
        red.
        """
        with self.assertRaisesRegex(
            RiskGateError, "does not match current governed evidence"
        ):
            self.run_historical_prove_preview(record_extra={"extra": "not re-derived"})

    def test_a_recovery_run_that_did_not_run_at_exact_main_is_refused(self):
        """A no-write recovery proves nothing by applying, so it must be at main."""
        with self.assertRaisesRegex(RiskGateError, "preview run has wrong head_sha"):
            self.run_historical_prove_preview(recovery_applied_commit="a" * 40)

    def test_historical_recovery_is_accepted_when_preview_ran_the_promoted_bytes(self):
        """The honest case still promotes: same bytes rehearsed and merged."""
        self.run_historical_prove_preview()

    def test_historical_recovery_of_amended_bytes_is_refused(self):
        """THE ATTACK. Rehearse A on preview, amend the file to B, merge, recover.

        Every other historical check passes: the file is on exact main, the proof
        names it, both ledgers hold it, the source PR added it, the applied commit
        IS exact main. Only the byte comparison against the ORIGINAL apply run
        catches it -- and production would otherwise have applied bytes preview
        never executed.
        """
        with self.assertRaisesRegex(RiskGateError, "different bytes than exact main"):
            self.run_historical_prove_preview(
                rehearsed_body="select 1;\n", main_body="drop table core.customer;\n"
            )

    def test_historical_recovery_without_an_original_run_map_is_refused(self):
        """The pre-#1213 record shape, and any record that simply omits it."""
        for runs in ({}, None, "not-a-map"):
            with self.subTest(runs=runs), self.assertRaisesRegex(
                RiskGateError, "does not name the original apply run"
            ):
                self.run_historical_prove_preview(record_runs=runs)

    def test_original_run_that_did_not_move_the_ledger_is_refused(self):
        """Naming a run that merely MENTIONED the version proves nothing."""
        with self.assertRaisesRegex(RiskGateError, "did not apply"):
            self.run_historical_prove_preview(original_applied=False)

    def test_a_recovery_may_not_cite_another_recovery(self):
        """Otherwise recoveries could cite recoveries forever, touching no byte."""
        with self.assertRaisesRegex(RiskGateError, "itself a historical recovery"):
            self.run_historical_prove_preview(original_is_recovery=True)

    def test_original_run_must_have_succeeded(self):
        with self.assertRaisesRegex(RiskGateError, "has wrong conclusion"):
            self.run_historical_prove_preview(original_conclusion="failure")

    def test_the_original_apply_runs_own_shape_is_checked_on_every_key(self):
        """#1213 review, round 9, finding 1 -- the TENTH instance, and the first
        one that lives INSIDE a guard rather than being a whole guard.

        `prove_historical_original_apply_runs` opens with a four-key loop
        requiring the named original apply run to be a completed, successful,
        `workflow_dispatch` run of the PREVIEW WORKFLOW. Only `conclusion` had a
        test (`test_original_run_must_have_succeeded`, above): the helper had no
        way to vary `status`, `event` or `path`, so those three keys could be
        deleted from `expected`, or rewritten as tautologies, and all 664 tests
        stayed green.

        WHY THE MUTATION SWEEP SCORED THIS GUARD AS TESTED. The sweep replaces a
        whole raising `if` with `if False:`. Doing that here reddens the
        conclusion test, so the loop counted as covered while three quarters of
        it was not. The sweep's granularity is the guard; this defect is one
        condition inside one. That makes the sweep's 41 survivors a FLOOR, not a
        ceiling.

        THE FORGE THAT `path` AND `event` ARE THE ONLY THING STOPPING. Author a
        SECOND workflow -- not `shared-supabase-migrations.yml` -- that writes
        `preview-ledger-before.txt` and `preview-ledger-after.txt` showing the
        version appearing, plus a `migration-content-manifest.json` whose digest
        equals exact main, and no `historical-preview-source.json`. Run it, by
        `push` or by a different `workflow_dispatch`, from a commit ALREADY on the
        authoring pull request. Every other check then passes honestly: `head_sha`
        and the artifact-name commit are both PR commits, and the producer pin
        compares the REAL preview workflow file at that commit, which the attacker
        never touched. Name that run in `originalApplyRuns` and production applies
        bytes preview's genuine job never ran.

        The refusal must also come BEFORE the download, or the gate has already
        read the attacker's artifact once before deciding not to trust it.
        """
        for key, value in (
            ("status", "in_progress"), ("conclusion", "failure"),
            ("event", "push"), ("path", ".github/workflows/something-else.yml"),
        ):
            with self.subTest(key=key), self.assertRaisesRegex(
                RiskGateError, f"original apply run 555 for .* has wrong {key}"
            ):
                self.run_historical_prove_preview(original_run_shape={key: value})
            self.assertNotIn(
                99, self.downloaded,
                f"the original apply run's artifact was downloaded despite a wrong "
                f"{key}; the shape check must refuse before any of its bytes are read",
            )

    def test_an_original_run_whose_manifest_has_no_usable_digest_is_refused(self):
        """#1213 round 9, the author's own per-condition hunt.

        The historical lane's byte binding is this comparison and nothing else:
        the digest the ORIGINAL run recorded, against the bytes on exact main.
        The guard immediately before it requires that recorded value to BE a
        digest -- a 64-character lowercase hex string -- and neither of its two
        operands had a test, because `original_run_zip` always wrote
        `{version: <a real sha256>}` and offered no way to write anything else.

        Both operands matter, and for different reasons. A manifest with no entry
        for the version, or a null one, would otherwise reach the comparison as
        `None != <main's digest>` and refuse with a message claiming preview
        rehearsed DIFFERENT BYTES, when the truth is that the run recorded no
        bytes at all. A manifest whose value is a short or uppercase string is
        the more dangerous half: it is the shape a hand-written manifest takes,
        and a guard that accepts it is one `.lower()` away from comparing
        attacker-chosen text.
        """
        # The message is PINNED per case, not accepted as an alternation. A loose
        # alternation is the same defect one level up: it cannot tell the guard
        # under test from the guard before it, which is exactly how the instance
        # binding's source_pr type check became deletable (see
        # test_merged_main_binding_is_never_accepted_unbound).
        for label, manifest, message in (
            # Refused one guard earlier, by the manifest reader itself. Listed
            # here so the ordering is recorded rather than assumed.
            ("manifest is not an object", "[]",
             "content manifest is not an object"),
            ("manifest is not JSON at all", "not json",
             "missing a valid content manifest"),
            # These reach the digest-shape guard, which is the one under test.
            ("manifest omits the version", "{}", "no usable digest"),
            ("digest is null", json.dumps({self.HISTORICAL_VERSION: None}),
             "no usable digest"),
            ("digest is a number", json.dumps({self.HISTORICAL_VERSION: 12345}),
             "no usable digest"),
            ("digest is too short", json.dumps({self.HISTORICAL_VERSION: "abc123"}),
             "no usable digest"),
            ("digest is uppercase hex", json.dumps({self.HISTORICAL_VERSION: "A" * 64}),
             "no usable digest"),
            ("digest is 64 non-hex characters", json.dumps({self.HISTORICAL_VERSION: "z" * 64}),
             "no usable digest"),
        ):
            with self.subTest(label), self.assertRaisesRegex(RiskGateError, message):
                self.run_historical_prove_preview(original_manifest_json=manifest)

    @staticmethod
    def write_empty_atomic_policy(root):
        """`prove_preview_migration_contents` reads this before the file walk."""
        (root / "config").mkdir(exist_ok=True)
        (root / "config/atomic-migration-allowlist.json").write_text(
            '{"schema_version":1,"migrations":{}}', encoding="utf-8"
        )

    def test_a_version_absent_or_duplicated_on_exact_main_is_refused(self):
        """The other half of the same hunt: `len(matches) != 1`, both directions.

        `historical_repo` wrote exactly one migration file and had no parameter
        to write none or two, so this guard could be deleted with the whole suite
        green. Zero files means the promoted version is not on exact main at all
        and there is nothing to compare the rehearsed digest against. Two files
        sharing one version means the question "which bytes did preview rehearse"
        has no answer, and picking either one would be a guess presented as proof.
        """
        # DRIVEN DIRECTLY, and the reason is recorded rather than hidden. Through
        # the whole `prove_preview` path both cases are refused EARLIER, by
        # `prove_pr_authored` inside the re-derivation ("source PR 984 did not
        # author the exact migration ..."), because a version with no file on
        # main cannot be shown to have been added by the source pull request.
        # That is genuine defence in depth -- but it also means the guard below
        # is unreachable end to end, so calling it "tested" on the strength of
        # the earlier refusal would be exactly the error this round is about.
        # It is therefore exercised where it lives.
        for label, files in (("absent from exact main", "none"), ("duplicated", "two")):
            temp, root, main, merge_sha = self.historical_repo(migration_files=files)
            self.write_empty_atomic_policy(root)
            with temp, self.subTest(label), self.assertRaisesRegex(
                RiskGateError, "absent or ambiguous on exact main"
            ):
                prove_preview_migration_contents(
                    texts={
                        "preview-dry-run.txt": "",
                        "preview-apply.txt": "",
                        "migration-content-manifest.json": "{}",
                    },
                    allowlist=[self.HISTORICAL_VERSION], repo_root=root,
                    before_versions=set(), after_versions={self.HISTORICAL_VERSION},
                    historical=False,
                )
        # And the honest single-file case still gets PAST this guard, or both
        # cases above would pass through a fixture that is broken for some other
        # reason.
        temp, root, main, merge_sha = self.historical_repo()
        self.write_empty_atomic_policy(root)
        with temp, self.assertRaisesRegex(RiskGateError, "no usable digest"):
            prove_preview_migration_contents(
                texts={
                    "preview-dry-run.txt": f"Applying migration {self.HISTORICAL_VERSION}_release_a.sql...",
                    "preview-apply.txt": f"Applying migration {self.HISTORICAL_VERSION}_release_a.sql...",
                    "migration-content-manifest.json": "{}",
                },
                allowlist=[self.HISTORICAL_VERSION], repo_root=root,
                before_versions=set(), after_versions={self.HISTORICAL_VERSION},
                historical=False,
            )

    def test_a_run_payload_that_is_not_an_object_is_refused_on_both_shape_loops(self):
        """The `not isinstance(run, dict)` operand of each four-key shape loop.

        Both loops read `if not isinstance(run, dict) or run.get(key) != value`.
        The four KEYS now have their own cases; the isinstance operand did not,
        because both helpers always returned a dict. A GitHub API that answers a
        list, a string or null must refuse, not raise AttributeError on the way
        past -- an unhandled exception is not a refusal and does not carry the
        message an operator needs.
        """
        for payload in ([], "not a run", None, 12345):
            with self.subTest(payload=payload), self.assertRaises(RiskGateError):
                self.run_historical_prove_preview(original_run_shape={"__replace__": payload})
            with self.subTest(payload=payload, which="recovery"), self.assertRaises(RiskGateError):
                self.run_historical_prove_preview(run_shape={"__replace__": payload})

    def test_forged_dispatch_ref_cannot_fabricate_a_historical_original_run(self):
        """#1213 review, round 5, finding 1. The exact twin of
        `test_forged_dispatch_ref_cannot_fabricate_a_main_line_rehearsal`, on the
        recovery lane -- the lane that supplies the BYTES.

        THE FORGE. Preview honestly holds the version from an apply of bytes A.
        The file on main was later amended to bytes B. An attacker pushes branch
        `evil` whose copy of the workflow performs no database write and instead
        hand-writes `preview-ledger-before.txt` without the version,
        `preview-ledger-after.txt` with it, and a `migration-content-manifest.json`
        mapping the version to the sha256 of B on exact main, with no
        `historical-preview-source.json`. They dispatch it at `--ref evil`, name
        the upload `preview-migration-apply-<any commit of the authoring PR>`,
        then recover and promote.

        Every other check in `prove_historical_original_apply_runs` passes: the
        run is a successful dispatch of this workflow, it carries exactly one
        unexpired apply artifact, it is not itself a recovery, its ledger gains
        the version, and the digest it recorded equals exact main. Production
        would apply B; preview ran A.

        Only `head_sha` -- the ref GitHub read the workflow FILE from, which no
        part of the artifact can restate -- exposes it.
        """
        with self.assertRaisesRegex(RiskGateError, "not contained in the history of exact main"):
            self.run_historical_prove_preview(
                original_head_sha="e" * 40, original_head_in_history=False
            )

    def test_a_foreign_artifact_name_commit_is_refused_before_any_download(self):
        """The artifact-name commit gets the same ancestry guard as `head_sha`.

        `preview-migration-apply-<sha>` is a STRING the job chose. If that sha is
        neither a commit of the source pull request nor an ancestor of exact
        main, it belongs to nothing this repository merged, and the bytes behind
        it were never reviewed. Until #1213 round 8 the helper hardcoded the
        artifact-name commit into the PR's commit list, so deleting the
        `prove_applied_commit_is_main_line` call that guards it changed no test
        (#1213 round 8, finding 2). The dispatch ref is kept legitimate here so
        the refusal can only come from the guard under test, and the download
        must never happen.
        """
        with self.assertRaisesRegex(RiskGateError, "not contained in the history of exact main"):
            self.run_historical_prove_preview(
                original_head_sha="b" * 40,
                original_commit_in_pr=False, original_commit_in_history=False,
            )

    def test_original_run_whose_workflow_differs_from_the_merge_commit_is_refused(self):
        """The subtler half of the same forge: a dispatch ref that IS in main's
        history, carrying a doctored workflow.

        Main-line containment alone would accept this -- an ancestor of main is
        ancestor code, and nothing about ancestry says the workflow that ran is
        the workflow that landed. The producer pin does, by comparing the
        dispatch ref against the merge commit of the pull request that authored
        the version. Round 5 compared it against the run's own checkout instead,
        which the attacker also chooses (#1213 round 6, finding 1).
        """
        with self.assertRaisesRegex(RiskGateError, "different .* than the merge commit"):
            self.run_historical_prove_preview(
                original_head_sha="b" * 40,
                original_head_blobs={PREVIEW_WORKFLOW: "doctored-workflow"},
            )

    def test_1769_post_merge_original_run_survives_unrelated_producer_drift(self):
        """Regression for #1769 / version 20260828232207 / run 33308168016.

        The source PR merged at 2b68e7e2, then the mandated post-merge rehearsal
        ran from later main 75a6e35e after an unrelated change altered
        production_migration_guard.py. The fresh governed recovery was valid,
        but the final gate still compared every original producer to the earlier
        source merge and made the capability impossible. A fully bound,
        first-attempt merged-main rehearsal on a descendant main commit is the
        narrow accepted shape; all unbound/doctored cases above remain refusals.
        """
        self.run_historical_prove_preview(
            original_run=33308168016,
            original_run_shape={"run_attempt": 1},
            original_instance="valid-merged-main-binding",
            original_run_blobs={
                "scripts/production_migration_guard.py": "later-main-producer",
            },
        )

    def test_post_merge_producer_drift_without_every_binding_still_refuses(self):
        for key, value in (
            ("run_attempt", 2),
            ("run_attempt", True),
            ("previewProjectRef", PRODUCTION_PROJECT_REF),
            ("sourcePr", 985),
            ("runId", 556),
            ("allowlist", ["20260828232207"]),
            ("mergeCommitSha", "f" * 40),
            ("schema", "shared-db-preview-instance-binding/v2"),
            ("rehearsalMode", "claim-preview"),
            ("appliedCommit", "b" * 40),
        ):
            with self.subTest(key=key), self.assertRaisesRegex(
                RiskGateError, "different scripts/production_migration_guard.py"
            ):
                self.run_historical_prove_preview(
                    original_run_shape={"run_attempt": value if key == "run_attempt" else 1},
                    original_instance="valid-merged-main-binding",
                    original_binding_overrides={} if key == "run_attempt" else {key: value},
                    original_run_blobs={
                        "scripts/production_migration_guard.py": "later-main-producer",
                    },
                )

    def test_post_merge_producer_drift_requires_both_mainline_ancestries(self):
        cases = (
            {"original_head_in_history": False},
            {"merge_is_ancestor_of_original_head": False},
        )
        for kwargs in cases:
            with self.subTest(**kwargs), self.assertRaises(RiskGateError):
                self.run_historical_prove_preview(
                    original_run_shape={"run_attempt": 1},
                    original_instance="valid-merged-main-binding",
                    original_run_blobs={
                        "scripts/production_migration_guard.py": "later-main-producer",
                    },
                    **kwargs,
                )

    def test_post_merge_producer_drift_requires_one_execution_commit(self):
        with self.assertRaisesRegex(
            RiskGateError, "different scripts/production_migration_guard.py"
        ):
            self.run_historical_prove_preview(
                original_head_sha="b" * 40,
                original_run_shape={"run_attempt": 1},
                original_instance="valid-merged-main-binding",
                original_run_blobs={
                    "scripts/production_migration_guard.py": "later-main-producer",
                },
            )

    def test_original_run_without_a_readable_head_sha_is_refused(self):
        """An unreadable dispatch ref is a missing pin, never a passed one."""
        for head in (None, "", "abc", "z" * 40, 12345):
            with self.subTest(head=head), self.assertRaisesRegex(
                RiskGateError, "does not name the commit whose workflow executed"
            ):
                self.run_historical_prove_preview(original_head_sha=head)

    def test_an_honest_old_original_run_still_recovers(self):
        """THE REASON THE PIN IS AIMED AT THE AUTHORING MERGE COMMIT, not today's main.

        This original run was dispatched at one commit of the authoring pull
        request and checked out another, and BOTH carry the producer files that
        the merge commit carries -- which are NOT the ones today's main carries.
        Pinning it to today's main would refuse it, and with it every Sample
        Tracking recovery this lane exists for, so this test fails if anyone
        tightens it that way.

        As written before the #1213 round-6 review this test proved the opposite
        of its name: the helper used one commit for the merge commit and for
        main, and defaulted every blob to one value, so it was itself the shape
        of the forge -- one pull-request commit on both pins, nothing compared.
        """
        old = "the-workflow-as-it-was-then"
        self.run_historical_prove_preview(
            original_head_sha="b" * 40,
            original_run_blobs={PREVIEW_WORKFLOW: old},
            merge_commit_blobs={PREVIEW_WORKFLOW: old},
        )

    def test_original_run_at_a_pr_commit_that_differs_from_the_merge_commit_is_refused(self):
        """#1213 review, round 6, finding 1. THE FORGE ROUND 5 LEFT OPEN.

        Round 5 pinned the original run's two commits TO EACH OTHER, so one
        attacker-chosen commit used for both compared nothing at all. This
        repository squash-merges, so every commit ever pushed to a pull request
        stays in `GET /pulls/{n}/commits` forever -- after the branch is deleted,
        and available to be dispatched again after the merge by recreating a
        branch at it.

        THE FORGE. Honestly apply bytes A through the ordinary claim lane so
        preview's ledger holds the version. Amend the file to destructive bytes
        B. Push commit `D` whose copy of the workflow skips the database write
        and hand-writes both ledgers and a content manifest naming the sha256 of
        B. Dispatch at `D`, so `head_sha` is `D`, and name the upload
        `preview-migration-apply-<D>`. Restore the honest workflow in a later
        commit, merge, then recover naming that run.

        Both pins are `D`. Every other check passes. Production applies B while
        preview ran A. Only a pin to a commit the promoter cannot choose -- the
        MERGE COMMIT, already proved merged and an ancestor of exact main --
        exposes it, and that is what this test holds in place.
        """
        with self.assertRaisesRegex(RiskGateError, "different .* than the merge commit"):
            self.run_historical_prove_preview(
                original_run_blobs={PREVIEW_WORKFLOW: "doctored-workflow-at-one-pr-commit"},
            )

    def test_one_commit_used_for_both_original_pins_is_not_self_evidence(self):
        """The same forge stated as the no-op it exploited.

        `original_head_sha` defaults to the artifact-name commit, so this run has
        ONE commit on both pins -- the exact shape round 5 accepted. It is
        refused now because neither pin is compared against the other any more.
        """
        with self.assertRaisesRegex(RiskGateError, "different .* than the merge commit"):
            self.run_historical_prove_preview(
                original_run_blobs={"scripts/atomic_migration_apply.py": "doctored-apply"},
            )

    def test_a_recovery_record_without_a_usable_merge_commit_is_refused(self):
        """No merge commit, no pin. It must fail closed, never skip the pin."""
        temp, root, main, merge_sha = self.historical_repo()
        with temp:
            for bad in (None, "", "not-a-sha", 12345):
                with self.subTest(bad=bad), self.assertRaisesRegex(
                    RiskGateError, "no usable source merge commit"
                ):
                    record = {"sourcePr": 984, "sourceMergeSha": bad,
                              "originalApplyRuns": {self.HISTORICAL_VERSION: 555}}
                    prove_historical_original_apply_runs(
                        record=record, allowlist=[self.HISTORICAL_VERSION], repo_root=root,
                        main_sha=main, api=lambda endpoint: self.fail(
                            "an unusable merge commit must be refused before any API call"
                        ), downloader=lambda *_: None,
                    )

    def test_producer_comparison_validates_its_target_instead_of_trusting_a_flag(self):
        """The honour-system boolean, replaced by something the function checks.

        Round 7 of the #1213 review: `target_is_proved=True` asserted that the
        second argument was exact main or a proved merge commit, and checked
        neither, so a later caller could pass two equal attacker-chosen commits
        and skip every blob read. The target is TAGGED now and this function
        re-derives the tag:

        * `exact-main` must literally be the main SHA being promoted.
        * `authored-merge` must be contained in the history of that main SHA.

        Identity is accepted only AFTER that validation, so the commit standing
        in for the comparison is one the gate proved, not one the promoter
        picked.
        """
        sha, main = "a" * 40, "3" * 40
        never = lambda endpoint: self.fail("no read for a target that never validates")

        # An untagged / unknown tag is refused outright.
        with self.assertRaisesRegex(RiskGateError, "untagged target"):
            prove_preview_producer_matches_main(
                sha, ProvedTarget("promoter-says-so", sha), main, never,
                what="original apply run 555 dispatched at " + sha,
            )
        # A malformed target commit is refused before any read.
        for bad in (None, "", "not-a-sha", 12345, "A" * 40):
            with self.subTest(bad=bad), self.assertRaisesRegex(RiskGateError, "malformed target"):
                prove_preview_producer_matches_main(
                    sha, ProvedTarget("exact-main", bad), main, never,
                    what="original apply run 555 dispatched at " + sha,
                )
        # THE FORGE THE BOOLEAN ALLOWED: two equal attacker-chosen commits.
        # Tagged exact-main, it is not the main being promoted.
        with self.assertRaisesRegex(RiskGateError, "is not the exact main"):
            prove_preview_producer_matches_main(
                sha, exact_main(sha), main, never,
                what="original apply run 555 dispatched at " + sha,
            )
        # Tagged authored-merge, it is not in main's history.
        with self.assertRaisesRegex(RiskGateError, "not contained in the history of exact main"):
            prove_preview_producer_matches_main(
                sha, authored_merge(sha), main,
                lambda endpoint: {"status": "diverged", "behind_by": 4},
                what="original apply run 555 dispatched at " + sha,
            )
        # And the ancestry read is the ordered compare, not a swapped one.
        seen = []

        def ancestry(endpoint):
            seen.append(endpoint)
            return {"status": "ahead", "behind_by": 0}

        prove_preview_producer_matches_main(
            sha, authored_merge(sha), main, ancestry,
            what="original apply run 555 dispatched at " + sha,
        )
        self.assertEqual(seen, [f"repos/u2giants/shared-db/compare/{sha}...{main}"])
        # A validated exact-main target still short-circuits on identity.
        prove_preview_producer_matches_main(
            main, exact_main(main), main,
            lambda endpoint: self.fail("no blob is read for an identity compare"),
            what="preview run dispatched at " + main,
        )

    def test_a_producer_added_after_the_merge_commit_still_recovers(self):
        """THE HIGH FROM ROUND 7, stated as the recovery it killed.

        `scripts/preview_instance_binding.py` was added by this pull request and
        does not exist at the merge commits of #984, #992 or #1126 -- confirmed
        with real `gh api` reads. #984 and #992 additionally predate
        `scripts/atomic_migration_apply.py`,
        `scripts/historical_preview_recovery.py` and
        `config/atomic-migration-allowlist.json`. Walking TODAY's producer list
        at those commits 404s on the first of them and refuses the recovery
        before a single digest is read -- 100% of the recoveries this lane
        exists for. A path absent from BOTH trees is skipped now: neither run
        could have executed a file that does not exist.
        """
        absent = (
            "scripts/preview_instance_binding.py",
            "scripts/atomic_migration_apply.py",
            "scripts/historical_preview_recovery.py",
            "config/atomic-migration-allowlist.json",
        )
        self.run_historical_prove_preview(
            merge_absent_paths=absent, original_absent_paths=absent,
        )

    def test_a_producer_present_at_the_merge_and_absent_at_the_original_run_is_refused(self):
        """Skipping two absences is safe. Skipping ONE is not.

        A run that did not carry the apply script the merge commit carries did
        not execute the machinery that landed. Both directions refuse.
        """
        path = "scripts/atomic_migration_apply.py"
        with self.assertRaisesRegex(RiskGateError, f"{path} absent where .* has it present"):
            self.run_historical_prove_preview(original_absent_paths=(path,))
        with self.assertRaisesRegex(RiskGateError, f"{path} present where .* has it absent"):
            self.run_historical_prove_preview(merge_absent_paths=(path,))

    def test_a_doctored_producer_that_exists_at_both_commits_is_still_compared(self):
        """The skip must not become a hiding place.

        Absent on both sides is skipped; present on both sides is compared byte
        for byte, even when other producers are being skipped around it.
        """
        with self.assertRaisesRegex(RiskGateError, "different .* than the merge commit"):
            self.run_historical_prove_preview(
                merge_absent_paths=("scripts/preview_instance_binding.py",),
                original_absent_paths=("scripts/preview_instance_binding.py",),
                original_run_blobs={PREVIEW_WORKFLOW: "doctored-workflow"},
            )

    def test_original_run_bound_to_the_production_project_is_refused(self):
        """Evidence of a PRODUCTION write is never a preview rehearsal, at any age."""
        with self.assertRaisesRegex(RiskGateError, "performed against the PRODUCTION project"):
            self.run_historical_prove_preview(
                original_instance=json.dumps({
                    "schema": "shared-db-preview-instance-binding/v1",
                    "previewProjectRef": "qsllyeztdwjgirsysgai",
                })
            )

    def test_original_run_with_an_unreadable_instance_binding_is_refused(self):
        with self.assertRaisesRegex(RiskGateError, "unreadable preview instance binding"):
            self.run_historical_prove_preview(original_instance="{not json")

    def test_original_run_against_the_deleted_preview_is_still_accepted(self):
        """THE DECISION, PINNED SO IT CANNOT BE CHANGED SILENTLY (#1213 round 5).

        Preview `rjyboqwcdzcocqgmsyel` was deleted and rebuilt as
        `mvpkijzfmfcxhnzqogzs` on 2026-08-18. EVERY original apply run that exists
        therefore ran against the predecessor instance, so requiring the original
        run to bind to the current `PREVIEW_PROJECT_REF` would refuse one hundred
        percent of the recoveries this lane was built for, including the stranded
        Sample Tracking merges. It is deliberately not required.

        The residual is written down in `prove_historical_original_apply_runs`
        and in AGENTS.md: the ledger half of this lane may be satisfied by one
        database and the byte half by another. If that trade is ever reversed,
        this test is where the reversal is declared.
        """
        self.run_historical_prove_preview(
            original_instance=json.dumps({
                "schema": "shared-db-preview-instance-binding/v1",
                "previewProjectRef": "rjyboqwcdzcocqgmsyel",
            })
        )

    def test_workflow_refuses_both_historical_forms_at_once(self):
        """Two inputs describing one batch, one silently unused, is not a state
        a production gate should run in."""
        workflow = (Path(__file__).resolve().parents[1] / PREVIEW_WORKFLOW).read_text(encoding="utf-8")
        self.assertIn("REFUSED: name historical_preview_source_pr OR historical_preview_source_pr_map, not both.", workflow)

    def test_post_merge_rehearsal_accepts_a_multi_pr_bounded_batch(self):
        """AGENTS.md 6.5 mandates ship sets no single PR authored. The rehearsal
        lane must therefore accept a version:pr map, and every condition keyed on
        the merged form must name BOTH inputs or a map-authored rehearsal checks
        out the wrong ref and never proves its source."""
        workflow = (Path(__file__).resolve().parents[1] / PREVIEW_WORKFLOW).read_text(encoding="utf-8")
        self.assertIn("merged_preview_source_pr_map:", workflow)
        self.assertIn("REFUSED: name merged_preview_source_pr OR merged_preview_source_pr_map, not both.", workflow)
        self.assertIn("--version-pr-map", workflow)
        for line in workflow.splitlines():
            if "inputs.merged_preview_source_pr" not in line:
                continue
            if "description:" in line or line.strip().endswith(":"):
                continue
            if "==" in line or "!=" in line:
                self.assertIn("merged_preview_source_pr_map", line,
                              f"merged rehearsal condition tests only the single-PR input: {line.strip()}")

    def test_every_historical_condition_tests_both_forms(self):
        """Not substring presence: each historical-keyed condition must name BOTH
        inputs, or a map-authored recovery slips into the real apply path."""
        workflow = (Path(__file__).resolve().parents[1] / PREVIEW_WORKFLOW).read_text(encoding="utf-8")
        for line in workflow.splitlines():
            if "historical_preview_source_pr" not in line:
                continue
            if "description:" in line or line.strip().endswith(":"):
                continue
            if "==" in line or "!=" in line:
                self.assertIn("historical_preview_source_pr_map", line,
                              f"historical condition tests only the single-PR input: {line.strip()}")

    def classify(self, body):
        from production_business_risk_gate import classify_sql
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "supabase/migrations").mkdir(parents=True)
            (root / "supabase/migrations/20260814000000_x.sql").write_text(body, encoding="utf-8")
            return classify_sql(root, ["20260814000000"])

    def test_creating_new_tables_is_not_reported_as_losing_production_data(self):
        """The false alarm that turned the owner-decision block into a rubber stamp.

        Every clause here is ordinary idempotent table creation. None of it touches
        existing data, and the classifier used to report data loss AND downtime for
        all of it. That is what was being escalated to a non-programmer for sign-off.
        """
        sql = "; ".join([
            "CREATE TABLE IF NOT EXISTS dflow.a (id bigint PRIMARY KEY, b_fk integer REFERENCES dflow.b(id) ON UPDATE CASCADE ON DELETE RESTRICT)",
            "CREATE INDEX IF NOT EXISTS a_idx ON dflow.a (id)",
            "DROP TRIGGER IF EXISTS t ON dflow.a",
            "CREATE TRIGGER t BEFORE UPDATE ON dflow.a FOR EACH ROW EXECUTE FUNCTION dflow.f()",
        ]) + ";"
        reasons = self.classify(sql)
        self.assertNotIn(RISK_TEXT["permanent_data_rewrite_or_loss"], reasons)
        self.assertNotIn(RISK_TEXT["expected_downtime"], reasons)

    def test_a_function_body_does_not_make_the_migration_destructive(self):
        """A trigger body describes runtime behaviour, not the apply-time effect."""
        sql = ("CREATE OR REPLACE FUNCTION dflow.f() RETURNS trigger LANGUAGE plpgsql AS $$ "
               "BEGIN UPDATE dflow.a SET id = id; DELETE FROM dflow.b; RETURN NEW; END; $$;")
        self.assertNotIn(RISK_TEXT["permanent_data_rewrite_or_loss"], self.classify(sql))

    def test_genuinely_destructive_statements_are_still_reported(self):
        """Narrowing must not blind it. These are real and must still be seen."""
        for body, risk in [
            ("DROP TABLE dflow.a;", "permanent_data_rewrite_or_loss"),
            ("TRUNCATE dflow.a;", "permanent_data_rewrite_or_loss"),
            ("DELETE FROM dflow.a WHERE id > 0;", "permanent_data_rewrite_or_loss"),
            ("UPDATE dflow.a SET id = 1;", "permanent_data_rewrite_or_loss"),
            ("ALTER TABLE dflow.a ADD COLUMN c text;", "expected_downtime"),
            ("LOCK TABLE dflow.a IN SHARE MODE;", "expected_downtime"),
            ("CREATE UNIQUE INDEX a_u ON dflow.a (id);", "expected_downtime"),
            ("GRANT SELECT ON dflow.a TO authenticated;", "material_access_change"),
        ]:
            with self.subTest(body=body):
                self.assertIn(RISK_TEXT[risk], self.classify(body))

    def test_disclosed_risks_no_longer_block_promotion(self):
        """Owner ruling 2026-08-18: derived risks are DISCLOSED in the evidence,
        not used to demand a signature from someone who cannot evaluate them."""
        decision = decide_business_risk(
            [RISK_TEXT["material_access_change"]], recovery_proven=True, review_approved=True)
        self.assertFalse(decision["automaticPromotionAllowed"])
        self.assertEqual(decision["ownerDecisionReasons"], [RISK_TEXT["material_access_change"]])

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


class GovernedHistoricalSupersessionTests(unittest.TestCase):
    def exercise(self, *, mutate=None, changed_version=False):
        case = GOVERNED_HISTORICAL_SUPERSESSION
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "supabase/migrations"
            migrations.mkdir(parents=True)
            migration = migrations / f"{case['version']}_clear_domain.sql"
            migration.write_text("select 1;\n", encoding="utf-8")
            statement = ["select 1"]
            base = {
                "schema": "shared-db-preview-ledger-orphan-reconciliation/v1",
                "issue": 1615, "claim": 1636, "source_pr": 1637,
                "orphan_version": case["original_version"],
                "replacement_version": case["version"],
                "preview_run_id": case["original_run_id"],
                "preview_artifact_id": case["original_artifact_id"],
                "preview_artifact_digest": case["original_artifact_digest"],
                "main_sha": case["reconciliation_head"],
                "governance": {
                    "case_mode": "byte_identical_rename",
                    "orphan_sha256": canonical_sha256(migration),
                    "replacement_sha256": canonical_sha256(migration),
                },
            }
            old = [{"version": case["original_version"], "name": "x", "statements": statement}]
            new = [{"version": case["version"], "name": "x", "statements": statement}]
            check = {**base, "mode": "check", "before": old, "after": old}
            applied = {**base, "mode": "apply", "before": old, "after": new}
            if mutate:
                mutate(check, applied)
            archive = root / "fixture.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("reconciliation-check.json", json.dumps(check))
                z.writestr("reconciliation-apply.json", json.dumps(applied))
            fixture_digest = "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest()
            saved = case["reconciliation_artifact_digest"]
            case["reconciliation_artifact_digest"] = fixture_digest
            try:
                def api(endpoint):
                    if endpoint.endswith("/pulls/1644"):
                        return {"merged": True, "merge_commit_sha": case["reconciliation_head"]}
                    if "/compare/" in endpoint:
                        return {"status": "ahead", "behind_by": 0}
                    if endpoint.endswith(f"/actions/runs/{case['reconciliation_run_id']}"):
                        return {"status": "completed", "conclusion": "success",
                                "event": "workflow_dispatch", "head_sha": case["reconciliation_head"],
                                "path": ".github/workflows/preview-ledger-orphan-reconciliation.yml"}
                    if endpoint.endswith("/artifacts?per_page=100"):
                        return {"artifacts": [{"id": case["reconciliation_artifact_id"],
                            "digest": fixture_digest, "expired": False,
                            "name": f"preview-ledger-orphan-reconciliation-{case['original_version']}",
                            "workflow_run": {"id": case["reconciliation_run_id"]}}]}
                    raise AssertionError(endpoint)
                def downloader(_artifact_id, destination):
                    Path(destination).write_bytes(archive.read_bytes())
                return prove_governed_historical_supersession(
                    version="20260827095754" if changed_version else case["version"],
                    source_pr=case["source_pr"], run_id=case["original_run_id"],
                    original_commit=case["original_commit"],
                    original_artifact={"id": case["original_artifact_id"],
                                       "digest": case["original_artifact_digest"]},
                    repo_root=root, main_sha="f" * 40, api=api, downloader=downloader,
                )
            finally:
                case["reconciliation_artifact_digest"] = saved

    def test_exact_governed_rename_is_accepted(self):
        self.assertEqual(self.exercise(), "20260827031236")

    def test_exception_is_not_generalised_to_another_version(self):
        self.assertIsNone(self.exercise(changed_version=True))

    def test_statement_change_is_refused(self):
        with self.assertRaisesRegex(RiskGateError, "statement-identical rename"):
            self.exercise(mutate=lambda _check, applied: applied["after"][0].update(
                statements=["select 2"]
            ))


if __name__ == "__main__":
    unittest.main()
