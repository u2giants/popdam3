import json, sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from production_owner_decision_evidence import ONLY_BATCH, SCHEMA, TARGET, parse_comment, prove

def comment(data, **changes):
    body=f"```production-owner-decision\n{json.dumps(data,separators=(',',':'))}\n```"
    base={"user":{"login":"u2giants"},"author_association":"OWNER","created_at":"2026-08-15T01:00:00Z","updated_at":"2026-08-15T01:00:00Z","node_id":"x","body":body}
    return {**base,**changes}

class Tests(unittest.TestCase):
    def setUp(self):
        self.data={"schema":SCHEMA,"approved":True,"main_sha":"a"*40,"ordered_allowlist":ONLY_BATCH,
          "accepted_risks":["expected_downtime"],"source_pr":924,"source_merge_sha":"b"*40,"target_workflow":TARGET}
    def test_exact_owner_ruling_is_accepted(self): self.assertEqual(parse_comment(comment(self.data)),self.data)
    def test_non_owner_edited_and_other_batch_fail(self):
        for c in [comment(self.data,user={"login":"someone"}),comment(self.data,updated_at="later"),comment({**self.data,"ordered_allowlist":["20260813210000"]})]:
            with self.assertRaises(ValueError): parse_comment(c)
    def test_proof_binds_source_merge(self):
        c=comment(self.data)
        def api(path): return c if "comments" in path else {"merged":True,"merge_commit_sha":"b"*40}
        result=prove(7,"a"*40,ONLY_BATCH,924,api)
        self.assertEqual(result["commentId"],7)
        self.assertEqual(result["source_merge_sha"],"b"*40)

if __name__=="__main__": unittest.main()
