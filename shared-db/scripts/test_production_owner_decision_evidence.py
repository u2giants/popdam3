import json, re, subprocess, sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from production_owner_decision_evidence import SCHEMA, TARGET, gh, parse_comment, prove

ONLY_BATCH=["20260813210000","20260813220000"]

def comment(data, **changes):
    body=f"```production-owner-decision\n{json.dumps(data,separators=(',',':'))}\n```"
    base={"user":{"login":"u2giants"},"author_association":"OWNER","created_at":"2026-08-15T01:00:00Z","updated_at":"2026-08-15T01:00:00Z","node_id":"x","body":body}
    return {**base,**changes}

class Tests(unittest.TestCase):
    def setUp(self):
        self.data={"schema":SCHEMA,"approved":True,"main_sha":"a"*40,"ordered_allowlist":ONLY_BATCH,
          "accepted_risks":["expected_downtime"],"source_pr":924,"source_merge_sha":"b"*40,"target_workflow":TARGET}
    def test_exact_owner_ruling_is_accepted(self): self.assertEqual(parse_comment(comment(self.data)),self.data)
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
            return dict(re.findall(r"^      ([a-z-]+): (read|write)$",raw,re.M))
        self.assertEqual(permissions("production-apply-review","production-apply"),{
            "contents":"read","actions":"read","checks":"read","issues":"read","pull-requests":"read"})
        self.assertEqual(permissions("production-apply"),{
            "contents":"write","actions":"read","checks":"read","issues":"read","pull-requests":"read"})

if __name__=="__main__": unittest.main()
