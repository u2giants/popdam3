import hashlib, json, re, subprocess, sys, unittest
from unittest import mock
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from production_owner_decision_evidence import SCHEMA, TARGET, artifact_for, gh, parse_comment, prove, verify_artifact

ONLY_BATCH=["20260813210000","20260813220000"]

def comment(data, **changes):
    body=f"```production-owner-decision\n{json.dumps(data,separators=(',',':'))}\n```"
    base={"user":{"login":"u2giants","id":55610577},"author_association":"OWNER","created_at":"2026-08-15T01:00:00Z","updated_at":"2026-08-15T01:00:00Z","node_id":"x","body":body}
    return {**base,**changes}

class Tests(unittest.TestCase):
    def setUp(self):
        self.data={"schema":SCHEMA,"approved":True,"main_sha":"a"*40,"ordered_allowlist":ONLY_BATCH,
          "accepted_risks":["expected_downtime"],"source_pr":924,"source_merge_sha":"b"*40,"target_workflow":TARGET}
    def test_exact_owner_ruling_is_accepted(self): self.assertEqual(parse_comment(comment(self.data)),self.data)
    def test_owner_accepted_as_organization_member(self):
        self.assertEqual(parse_comment(comment(self.data,author_association="MEMBER")),self.data)
    def test_different_member_refused(self):
        for c in [comment(self.data,user={"login":"someone","id":1234},author_association="MEMBER"),
                  comment(self.data,user={"login":"someone","id":1234},author_association="OWNER")]:
            with self.assertRaises(ValueError): parse_comment(c)
    def test_impostor_login_refused(self):
        # right login with the wrong or missing id (a renamed/reclaimed login), and right id under another login
        for user in [{"login":"u2giants","id":999},{"login":"u2giants"},{"login":"u2giants","id":"55610577"},
                     {"login":"U2giants","id":55610577},{"login":"impostor","id":55610577}]:
            with self.assertRaises(ValueError): parse_comment(comment(self.data,user=user,author_association="MEMBER"))
    def test_collaborator_or_none_association_refused_even_for_owner(self):
        for a in ["COLLABORATOR","CONTRIBUTOR","NONE",None]:
            with self.assertRaises(ValueError): parse_comment(comment(self.data,author_association=a))
    def test_invalid_owner_identity_config_fails_closed(self):
        import tempfile, os
        from production_owner_decision_evidence import load_owner_identity
        with tempfile.TemporaryDirectory() as d:
            for bad in ['{}','not json','{"schema":"shared-db-production-owner-identity/v1","login":"u2giants","user_id":55610577,"accepted_author_associations":["COLLABORATOR"]}']:
                p=os.path.join(d,"c.json"); open(p,"w").write(bad)
                with self.assertRaises(ValueError): load_owner_identity(p)
    def test_non_owner_edited_and_malformed_batch_fail(self):
        for c in [comment(self.data,user={"login":"someone"}),comment(self.data,updated_at="later"),
                  comment({**self.data,"ordered_allowlist":[]}),
                  comment({**self.data,"ordered_allowlist":["not-a-version"]}),
                  comment({**self.data,"ordered_allowlist":["20260813220000","20260813210000"]}),
                  comment({**self.data,"ordered_allowlist":["20260813210000","20260813210000"]})]:
            with self.assertRaises(ValueError): parse_comment(c)
    def test_any_exact_ordered_batch_is_accepted(self):
        single={**self.data,"ordered_allowlist":["20260816045120"],"accepted_risks":["material_access_change"],"source_pr":1059}
        self.assertEqual(parse_comment(comment(single)),single)
    def test_comment_requires_exact_machine_readable_fence(self):
        malformed=comment(self.data,body=json.dumps(self.data))
        with self.assertRaisesRegex(ValueError,"exact machine-readable form"):
            parse_comment(malformed)
    def test_comment_requires_exact_approved_schema(self):
        invalid=[
            {**self.data,"schema":"shared-db-production-owner-decision/v0"},
            {**self.data,"approved":False},
            {key:value for key,value in self.data.items() if key!="source_pr"},
            {**self.data,"unexpected":True},
        ]
        for data in invalid:
            with self.subTest(data=data):
                with self.assertRaisesRegex(ValueError,"schema is incomplete or not approved"):
                    parse_comment(comment(data))
    def test_comment_requires_known_nonempty_risks(self):
        for risks in ([],["unknown-risk"]):
            with self.subTest(risks=risks):
                with self.assertRaisesRegex(ValueError,"risks are missing or unknown"):
                    parse_comment(comment({**self.data,"accepted_risks":risks}))
    def test_comment_requires_production_target_workflow(self):
        with self.assertRaisesRegex(ValueError,"targets another workflow"):
            parse_comment(comment({**self.data,"target_workflow":".github/workflows/other.yml"}))
    def test_proof_rejects_comment_batch_that_differs_from_workflow_input(self):
        c=comment(self.data)
        def api(path): return c if "comments" in path else {"merged":True,"merge_commit_sha":"b"*40}
        with self.assertRaisesRegex(ValueError,"does not match exact main"):
            prove(7,"a"*40,["20260816045120"],924,api)
    def test_proof_binds_source_merge(self):
        c=comment(self.data)
        def api(path): return c if "comments" in path else {"merged":True,"merge_commit_sha":"b"*40}
        result=prove(7,"a"*40,ONLY_BATCH,924,api)
        self.assertEqual(result["commentId"],7)
        self.assertEqual(result["source_merge_sha"],"b"*40)

    def test_proof_rejects_unmerged_or_different_source_commit(self):
        c=comment(self.data)
        for pull_request in [
            {"merged":False,"merge_commit_sha":"b"*40},
            {"merged":True,"merge_commit_sha":"c"*40},
        ]:
            with self.subTest(pull_request=pull_request):
                def api(path): return c if "comments" in path else pull_request
                with self.assertRaisesRegex(ValueError,"source merge is not proved"):
                    prove(7,"a"*40,ONLY_BATCH,924,api)

    def test_artifact_must_equal_fresh_authenticated_owner_ruling(self):
        stored={"commentId":7,"commentBodySha256":"stored"}
        live={"commentId":7,"commentBodySha256":"changed"}
        with mock.patch("production_owner_decision_evidence.artifact_for",return_value=stored), \
             mock.patch("production_owner_decision_evidence.prove",return_value=live):
            with self.assertRaisesRegex(ValueError,"no longer matches immutable evidence"):
                verify_artifact(99,"sha256:"+"d"*64,"a"*40,ONLY_BATCH,924,lambda *_: None)

    def test_artifact_requires_exact_successful_workflow_run(self):
        expected={"status":"completed","conclusion":"success","event":"workflow_dispatch",
                  "path":".github/workflows/production-owner-decision-evidence.yml"}
        for key,bad in (("status","in_progress"),("conclusion","failure"),("event","push"),("path","other.yml")):
            def api(path, key=key, bad=bad): return {**expected,key:bad}
            with self.subTest(key=key):
                with self.assertRaisesRegex(ValueError,"exact successful workflow"):
                    artifact_for(7,"sha256:any",lambda *_: None,api)

    def test_artifact_requires_one_unexpired_digest_match(self):
        digest="sha256:"+"a"*64
        expected={"name":"production-owner-decision-7","digest":digest,"expired":False,"id":1}
        variants=([],[expected,expected],[{**expected,"digest":"sha256:"+"b"*64}],[{**expected,"expired":True}])
        run={"status":"completed","conclusion":"success","event":"workflow_dispatch",
             "path":".github/workflows/production-owner-decision-evidence.yml"}
        for artifacts in variants:
            def api(path, artifacts=artifacts): return {"artifacts":artifacts} if "artifacts" in path else run
            with self.subTest(artifacts=artifacts):
                with self.assertRaisesRegex(ValueError,"missing, expired, or has the wrong digest"):
                    artifact_for(7,digest,lambda *_: None,api)

    def test_artifact_download_bytes_must_match_digest(self):
        expected_bytes=b"expected archive bytes"
        digest="sha256:"+hashlib.sha256(expected_bytes).hexdigest()
        artifact={"name":"production-owner-decision-7","digest":digest,"expired":False,"id":1}
        run={"status":"completed","conclusion":"success","event":"workflow_dispatch",
             "path":".github/workflows/production-owner-decision-evidence.yml"}
        def api(path): return {"artifacts":[artifact]} if "artifacts" in path else run
        def download(_artifact_id,path): path.write_bytes(b"changed archive bytes")
        with self.assertRaisesRegex(ValueError,"artifact bytes changed"):
            artifact_for(7,digest,download,api)

    def test_github_read_retries_only_transient_transport_failures(self):
        responses=iter([
            subprocess.CompletedProcess([],1,"","HTTP 503: service unavailable"),
            subprocess.CompletedProcess([],1,"","secondary rate limit"),
            subprocess.CompletedProcess([],0,'{"ok":true}',""),
        ])
        sleeps=[]
        self.assertEqual(gh("endpoint",runner=lambda *a,**k: next(responses),sleep=sleeps.append),{"ok":True})
        self.assertEqual(sleeps,[1,2])

    def test_github_read_does_not_retry_permanent_absence(self):
        calls=[]
        def runner(*args,**kwargs):
            calls.append(1); return subprocess.CompletedProcess([],1,"","HTTP 404: Not Found")
        with self.assertRaisesRegex(ValueError,"HTTP 404"):
            gh("endpoint",runner=runner,sleep=lambda _: self.fail("permanent error slept"))
        self.assertEqual(len(calls),1)

    def test_github_read_exhaustion_is_bounded_and_reports_reason(self):
        calls=[]; sleeps=[]
        def runner(*args,**kwargs):
            calls.append(1); return subprocess.CompletedProcess([],1,"","HTTP 429: rate limit exceeded")
        with self.assertRaisesRegex(ValueError,"rate limit exceeded"):
            gh("endpoint",runner=runner,sleep=sleeps.append)
        self.assertEqual(len(calls),4)
        self.assertEqual(sleeps,[1,2,4])

    def test_production_jobs_have_least_privilege_for_live_owner_read(self):
        workflow=(Path(__file__).parents[1]/".github/workflows/shared-supabase-migrations.yml").read_text(encoding="utf-8")
        def permissions(job, next_job=None):
            block=workflow.split(f"  {job}:\n",1)[1]
            if next_job: block=block.split(f"  {next_job}:\n",1)[0]
            raw=block.split("    permissions:\n",1)[1].split("    env:\n",1)[0]
            return dict(re.findall(r"^      ([a-z-]+): (read|write)(?:\s+#.*)?$",raw,re.M))
        self.assertEqual(permissions("production-apply-review","production-apply"),{
            "contents":"read","actions":"read","checks":"read","issues":"read","pull-requests":"read"})
        self.assertEqual(permissions("production-apply"),{
            "contents":"write","actions":"read","checks":"read","issues":"write","pull-requests":"read",
            "statuses":"write"})

    def test_automatic_promotion_can_write_admission_commit_but_holds_no_database_secret(self):
        workflow=(Path(__file__).parents[1]/".github/workflows/shared-supabase-migrations.yml").read_text(encoding="utf-8")
        block=workflow.split("  automatic-production-promotion:\n",1)[1].split("  production-dry-run:\n",1)[0]
        raw=block.split("    permissions:\n",1)[1].split("    steps:\n",1)[0]
        self.assertEqual(dict(re.findall(r"^      ([a-z-]+): (read|write)$",raw,re.M)),{
            "contents":"write","actions":"write","checks":"read","issues":"read","pull-requests":"read"})
        self.assertNotIn("SUPABASE_DB_PASSWORD",block)
        self.assertNotIn("SUPABASE_ACCESS_TOKEN",block)
        self.assertIn("ENGINEER ACTION REQUIRED",block)

if __name__=="__main__": unittest.main()
