"""Lossless #5609 private baseline proposal; never source activation."""
import copy
from decimal import Decimal
import hashlib
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('baseline',Path(__file__).with_name('prepare_assets_trigger_baseline.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class BaselineTests(unittest.TestCase):
    def candidate(self):
        return {'observed_at':'2026-11-06T09:52:54.996313-05:00','statement_stats_reset':'2026-11-05T13:40:56.41864-05:00','postmaster_started_at':'2026-11-05T13:46:38.291291-05:00','database_stats_reset':None,'statement_dealloc':'87','tables':[{'relname':'assets','relid':'17809','n_tup_upd':'383529'},{'relname':'dam_search_documents','relid':'713489','n_tup_upd':'280730'}], 'family':[{'userid':'16486','dbid':'5','toplevel':True,'queryid':'-9223372036854775808','stats_since':'2026-11-06T09:00:00.123456-05:00','query_md5':'a'*32,'calls':'9007199254740993','total_exec_time':'123456789.123456789','wal_bytes':'18446744073709551615'}]}

    def test_exact_large_integer_decimal_epoch_and_timezone(self):
        c=self.candidate();count,digest,values,_=m.prepare(c)
        row='(16486,5,t,-9223372036854775808,1793973600.123456,'+'a'*32+',9007199254740993,123456789.123456789,18446744073709551615)'
        self.assertEqual(digest,hashlib.md5(row.encode()).hexdigest())
        self.assertIn('9007199254740993::bigint',values)
        c['family'][0]['stats_since']='2026-11-06T14:00:00.123456+00:00'
        self.assertEqual(m.prepare(c)[1],digest)

    def test_reordering_stable_and_duplicate_incomplete_malformed_fail(self):
        c=self.candidate();other=copy.deepcopy(c['family'][0]);other['queryid']='9223372036854775807';c['family'].append(other)
        digest=m.prepare(c)[1];c['family'].reverse();self.assertEqual(m.prepare(c)[1],digest)
        for mutation in ['duplicate','missing','float','nan','future','empty']:
            bad=self.candidate()
            if mutation=='duplicate':bad['family']*=2
            elif mutation=='missing':del bad['family'][0]['query_md5']
            elif mutation=='float':bad['family'][0]['total_exec_time']=1.25
            elif mutation=='nan':bad['family'][0]['total_exec_time']='NaN'
            elif mutation=='future':bad['family'][0]['stats_since']='2027-01-01T00:00:00Z'
            else:bad['family']=[]
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):m.prepare(bad)

    def test_float_roundtrip_does_not_falsely_regress(self):
        raw='41122.3862929999'
        self.assertEqual(Decimal(str(float(raw))),Decimal(raw))
        self.assertLess(Decimal('41122.3862929998'),Decimal(raw))
        source=(Path(__file__).resolve().parent.parent/'.github/live-proofs/5609.sql').read_text()
        self.assertIn('total_exec_time::text::numeric',source)
        self.assertIn('q.total_exec_time>=f.total_exec_time',source)

    def test_proposal_requires_independent_hash_and_leaves_template_unchanged(self):
        c=self.candidate();template=Path(__file__).resolve().parent.parent/'.github/live-proofs/5609.sql';original=template.read_text();source='with baseline as(select '+','.join('null::'+typ+' as '+name for name,typ in [('observed_at','timestamptz'),('statement_stats_reset','timestamptz'),('database_stats_reset','timestamptz'),('postmaster_started_at','timestamptz'),('statement_dealloc','bigint'),('family_entry_count','bigint'),('family_vector_md5','text'),('asset_relid','oid'),('document_relid','oid'),('asset_updates','bigint'),('document_updates','bigint')])+'), baseline_family as(\n -- UNSET: populate\n select null where false\n), query_stats as (select 1) select 1;'
        with self.assertRaises(ValueError):m.proposed(c,source,'0'*32)
        proposed=m.proposed(c,source,m.prepare(c)[1])
        self.assertIn('17809::oid as asset_relid',proposed)
        self.assertIn('713489::oid as document_relid',proposed)
        self.assertIn('1::bigint as family_entry_count',proposed)
        self.assertNotIn('where false',proposed)
        self.assertEqual(original,template.read_text())

if __name__=='__main__':unittest.main()
