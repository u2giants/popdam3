"""Offline activation-candidate tests. Active policy must remain empty."""
import json
from pathlib import Path
import unittest
import prepare_index_maintenance_activation as prepare
import nontransactional_index_maintenance as maintenance


class ActivationCandidateTests(unittest.TestCase):
    def test_exact_full_precision_objects_and_budgets(self):
        value=prepare.prepare(111,222)
        entry=maintenance.operation(value['policy'],value['operation_id'])
        self.assertEqual(entry['work_issue'],5616)
        self.assertEqual(entry['source_pr'],111);self.assertEqual(entry['claim_issue'],222)
        self.assertEqual(entry['definition_sha256'],maintenance.digest(maintenance.normalized_definition(value['definition'],maintenance.INDEX)))
        self.assertEqual(len(value['expected_writes']),4)
        self.assertIn('table public.style_guide_search_documents',value['expected_writes'])
        self.assertIn('(embedding vector_cosine_ops)',value['definition'])
        self.assertNotIn('halfvec',value['definition'])
        self.assertEqual((entry['statement_timeout_ms'],entry['total_timeout_s'],entry['lock_timeout_ms'],entry['swap_timeout_ms']),(900000,1800,500,2500))
    def test_missing_or_placeholder_ownership_numbers_refuse(self):
        for pr,claim in [(0,1),(1,0),(-1,1),(1,-1),(True,2)]:
            with self.subTest(pr=pr,claim=claim),self.assertRaises(maintenance.Refusal):prepare.prepare(pr,claim)
    def test_generation_never_changes_active_policy(self):
        path=Path(__file__).resolve().parents[1]/'config/nontransactional-index-maintenance.json'
        before=path.read_bytes();prepare.prepare(111,222)
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(json.loads(before)['schema_version'],1)


if __name__=='__main__':unittest.main()
