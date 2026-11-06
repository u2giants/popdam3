"""#5609: immutable failed-window receipt and read-only successor probe contracts.

--emit-fixture prints a VALUES-only PostgreSQL SELECT reusing the actual probe's
metadata predicates, for target-proved read-only execution; no DDL or business rows.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
PROBE = ROOT / '.github/live-proofs/5609.sql'
HISTORY = ROOT / 'docs/verification/issue-5609-trigger-acceptance/5609-original-failed-window.sql'
ORIGINAL_SHA = '4db994c5425617fe5c211f688b6d35dd520f2af5449ef80d7c7e0c96d6a0eb9f'


def fixture_sql():
    source = PROBE.read_text()
    block = source[source.index('), metadata_source as (') + 3:source.index('\nselect case')]
    block = block.replace('select a.id,a.modified_at', 'select a.case_label,a.expected_pass,a.id,a.modified_at')
    block = block.replace('public.style_groups', 'fixture_groups').replace('public.dam_search_documents', 'fixture_docs').replace('public.render_queue', 'fixture_render_queue')
    block = block.replace("d.document_type='asset' and d.entity_id=a.id", "d.document_type='asset' and d.entity_id=a.id and d.case_label=a.case_label")
    block = block.replace("rq.asset_id=a.id and rq.status='completed'", "rq.asset_id=a.id and rq.case_label=a.case_label and rq.status='completed'")
    block = block.replace('select count(*) as checked,', 'select case_label,expected_pass,count(*) as checked,')
    block = block.replace(' from metadata_checked\n)', ' from metadata_checked group by case_label,expected_pass\n)')
    core = {'file_type': 'pdf', 'asset_type': 'art', 'content_type': 'image/png',
            'item_description': 'synthetic item', 'group_ai_description': 'synthetic group',
            'product_material': ['paper'], 'product_dimensions': '1x1',
            'workflow_status': 'approved', 'is_licensed': True, 'licensor_name': 'synthetic licensor',
            'property_name': 'synthetic property', 'product_category': 'synthetic category',
            'thumbnail_url': 'https://example.invalid/fixture.png'}
    input_keys = ['version', 'model', 'image_transform', 'asset_id', 'thumbnail_url', 'source_modified_at', 'source_file_size', 'render_completed_at']
    cases = [('normal', True), ('lease_old_claimed_hash', True), ('retained_render', True), ('live_render', True), ('no_image', True), ('no_source_identity', True)]
    cases += [('core_mutate_' + key, False) for key in core]
    cases += [('core_missing_' + key, False) for key in core]
    cases += [('input_missing_' + key, False) for key in input_keys]
    cases += [(name, False) for name in ['unknown_key', 'input_null', 'input_missing', 'input_unknown_key', 'invalid_previous', 'invalid_render', 'invalid_render_offset', 'invalid_render_overflow', 'render_number', 'render_json_null', 'input_wrong_id', 'input_wrong_model', 'input_wrong_version', 'input_wrong_transform', 'input_wrong_thumbnail', 'input_wrong_modified', 'input_wrong_size', 'sha_wrong', 'metadata_null', 'newer_render', 'lease_missing_key', 'lease_missing_owner', 'lease_blank_owner', 'lease_missing_expiry', 'lease_infinite_expiry', 'lease_uppercase_hash', 'lease_short_hash', 'lease_json_null', 'lease_number', 'orphan_owner', 'orphan_expiry']]
    legacy_bad = ['indexed_equal','indexed_after','indexed_null','updated_equal','updated_after','updated_null','modified_after_indexed','modified_after_updated','render_after_indexed','render_after_updated','present_null','present_invalid','unknown','core_mutated']
    cases += [('completed_retained', True), ('legacy_completed_retained', True), ('legacy_unchanged', True), ('legacy_actual_lease', True), ('legacy_render_identity_null_modified', True)]
    cases += [('legacy_' + name, False) for name in legacy_bad]
    retained_good = ['completed_current_retained', 'error_current_retained', 'legacy_error_retained', 'no_image_completed_retained', 'no_image_error_retained']
    retained_bad = ['completed_hash_uppercase', 'completed_hash_short', 'completed_hash_json_null', 'completed_hash_number', 'completed_hash_orphan_owner', 'completed_hash_orphan_expiry', 'legacy_hash_uppercase', 'legacy_hash_json_null', 'no_image_hash_number']
    cases += [(name, True) for name in retained_good] + [(name, False) for name in retained_bad]
    values = ',\n'.join("('%s',%s)" % (name, str(expected).lower()) for name, expected in cases)
    core_json = json.dumps(core).replace("'", "''")
    edits = {'input_wrong_id': "to_jsonb('00000000-0000-0000-0000-000000000099'::text)", 'input_wrong_model': "to_jsonb('wrong-model'::text)", 'input_wrong_version': 'to_jsonb(2)', 'input_wrong_transform': "to_jsonb('cropped'::text)", 'input_wrong_thumbnail': "to_jsonb('https://example.invalid/wrong.png'::text)", 'input_wrong_modified': "to_jsonb('2025-01-01T00:00:00+00:00'::text)", 'input_wrong_size': 'to_jsonb(9999)'}
    keys = {'id': 'asset_id', 'model': 'model', 'version': 'version', 'transform': 'image_transform', 'thumbnail': 'thumbnail_url', 'modified': 'source_modified_at', 'size': 'source_file_size'}
    input_cases = ' '.join("when case_label='%s' then jsonb_set(input_base,array['%s'],%s)" % (name, keys[name.removeprefix('input_wrong_')], value) for name, value in edits.items())
    return f"""with fixture_cases(case_label,expected_pass) as (values {values}),
recent as (select c.*,md5(c.case_label)::uuid id,'00000000-0000-0000-0000-000000000001'::uuid style_group_id,
 case when c.case_label in ('no_source_identity','legacy_render_identity_null_modified') then null when c.case_label='legacy_modified_after_indexed' then '2026-11-04T13:00:00Z'::timestamptz when c.case_label='legacy_modified_after_updated' then '2026-11-04T11:00:00Z'::timestamptz else '2026-01-01T00:00:00Z'::timestamptz end modified_at,
 1000::bigint file_size,case when c.case_label like 'no_image%' then null else 'https://example.invalid/fixture.png' end thumbnail_url,
 'pdf'::text file_type,'art'::text asset_type,'image/png'::text content_type,array['paper']::text[] product_material,
 '1x1'::text product_dimensions,'approved'::text workflow_status,true is_licensed,'unused'::text licensor_name,
 'unused'::text property_name,'synthetic category'::text product_category from fixture_cases c),
fixture_groups as (select '00000000-0000-0000-0000-000000000001'::uuid id,'synthetic item'::text item_description,
 'synthetic group'::text group_ai_description,'synthetic licensor'::text licensor_name,'synthetic property'::text property_name),
fixture_render_queue as (select id asset_id,case_label,'completed'::text status,
 case when case_label='legacy_render_after_indexed' then '2026-11-04T13:00:00Z'::timestamptz when case_label='legacy_render_after_updated' then '2026-11-04T11:00:00Z'::timestamptz when case_label='newer_render' then '2026-01-03T00:00:00Z'::timestamptz else '2026-01-02T00:00:00Z'::timestamptz end completed_at
 from recent where case_label in ('live_render','newer_render','input_missing_render_completed_at','legacy_render_identity_null_modified','legacy_render_after_indexed','legacy_render_after_updated')),
fixture_inputs as (select a.*,'{core_json}'::jsonb core,
 jsonb_build_object('version',1,'model','google/siglip2-base-patch16-naflex','image_transform','uncropped-thumbnail',
 'asset_id',a.id,'thumbnail_url','https://example.invalid/fixture.png','source_modified_at','2026-01-01T00:00:00+00:00',
 'source_file_size',1000,'render_completed_at','2026-01-02T00:00:00+00:00') input_base from recent a),
fixture_input_edits as (select f.*,case
 when case_label like 'input_missing_%' then input_base-substr(case_label,15)
 when case_label='input_unknown_key' then input_base||'{{"extra":"unexpected"}}'::jsonb
 when case_label='invalid_previous' then input_base||'{{"invalid_previous":true}}'::jsonb
 when case_label='invalid_render' then input_base||'{{"render_completed_at":"invalid"}}'::jsonb
 when case_label='invalid_render_offset' then input_base||'{{"render_completed_at":"2026-01-01 00:00:00+99:99"}}'::jsonb
 when case_label='invalid_render_overflow' then input_base||'{{"render_completed_at":"999999999999-01-01"}}'::jsonb
 when case_label='render_number' then input_base||'{{"render_completed_at":123}}'::jsonb
 when case_label='render_json_null' then input_base||'{{"render_completed_at":null}}'::jsonb
 {input_cases} else input_base end input_edited from fixture_inputs f),
fixture_golden as (select f.*,core||jsonb_build_object('_embedding_input',input_edited||jsonb_build_object('sha256',
 encode(extensions.digest(input_edited::text,'sha256'),'hex'))) golden from fixture_input_edits f),
fixture_docs_raw as materialized (select 'asset'::text document_type,id entity_id,case_label,
 case when case_label='legacy_indexed_null' then null when case_label='legacy_indexed_equal' then '2026-11-05T12:30:57Z'::timestamptz when case_label='legacy_indexed_after' then '2026-11-05T12:30:58Z'::timestamptz when case_label like 'legacy_%' then '2026-11-04T12:00:00Z'::timestamptz else '2026-11-06T00:00:00Z'::timestamptz end indexed_at,
 case when case_label='legacy_updated_null' then null when case_label='legacy_updated_equal' then '2026-11-05T12:30:57Z'::timestamptz when case_label='legacy_updated_after' then '2026-11-05T12:30:58Z'::timestamptz when case_label in ('legacy_modified_after_updated','legacy_render_after_updated') then '2026-11-04T10:00:00Z'::timestamptz when case_label like 'legacy_%' then '2026-11-04T14:00:00Z'::timestamptz else '2026-11-06T00:00:00Z'::timestamptz end source_updated_at,
 case when case_label='legacy_present_null' then core||'{{"_embedding_input":null}}'::jsonb
 when case_label='legacy_present_invalid' then core||'{{"_embedding_input":{{}}}}'::jsonb
 when case_label='legacy_unknown' then core||'{{"unknown":true}}'::jsonb
 when case_label='legacy_core_mutated' then core||'{{"file_type":"wrong"}}'::jsonb
 when case_label in ('legacy_actual_lease','legacy_completed_retained') then core||jsonb_build_object('_embedding_lease_input_sha256',repeat('b',64))
 when case_label like 'legacy_%' then core
 when case_label like 'core_mutate_%' then jsonb_set(golden,array[substr(case_label,13)],'"mutated"'::jsonb)
 when case_label like 'core_missing_%' then golden-substr(case_label,14)
 when case_label='unknown_key' then golden||'{{"unreviewed":"extra"}}'::jsonb
 when case_label='input_null' then golden||'{{"_embedding_input":null}}'::jsonb
 when case_label='input_missing' then golden-'_embedding_input'
 when case_label='sha_wrong' then jsonb_set(golden,'{{_embedding_input,sha256}}','"wrong"'::jsonb)
 when case_label='metadata_null' then null
 when case_label='no_image' then golden-'thumbnail_url'-'_embedding_input'
 when case_label='no_source_identity' then golden-'_embedding_input'
 when case_label='lease_missing_key' then golden
 when case_label='lease_uppercase_hash' then golden||jsonb_build_object('_embedding_lease_input_sha256',repeat('A',64))
 when case_label='lease_short_hash' then golden||jsonb_build_object('_embedding_lease_input_sha256','abc')
 when case_label='lease_json_null' then golden||'{{"_embedding_lease_input_sha256":null}}'::jsonb
 when case_label='lease_number' then golden||'{{"_embedding_lease_input_sha256":123}}'::jsonb
 when case_label like 'lease_%' then golden||jsonb_build_object('_embedding_lease_input_sha256',repeat('b',64))
 else golden end metadata,
 case when (case_label like 'lease_%' and case_label<>'completed_retained' or case_label='legacy_actual_lease') then '00000000-0000-0000-0000-000000000002'::uuid end embedding_lease_token,
 case when case_label='lease_blank_owner' then ' ' when case_label='lease_missing_owner' then null
 when ((case_label like 'lease_%' and case_label<>'completed_retained' or case_label='legacy_actual_lease')) or case_label='orphan_owner' then 'synthetic-worker' end embedding_lease_owner,
 case when case_label='lease_missing_expiry' then null when case_label='lease_infinite_expiry' then 'infinity'::timestamptz
 when ((case_label like 'lease_%' and case_label<>'completed_retained' or case_label='legacy_actual_lease')) or case_label='orphan_expiry' then '2026-01-04T00:00:00Z'::timestamptz end embedding_lease_expires_at
 from fixture_golden),
fixture_docs as materialized (select document_type,entity_id,case_label,indexed_at,source_updated_at,
 case when case_label in ('completed_retained','completed_current_retained','error_current_retained','legacy_completed_retained','legacy_error_retained','no_image_completed_retained','no_image_error_retained','completed_hash_orphan_owner','completed_hash_orphan_expiry') then
  (case when case_label like 'no_image%' then metadata-'thumbnail_url'-'_embedding_input' else metadata end)||jsonb_build_object('_embedding_lease_input_sha256',repeat('b',64))
 when case_label in ('completed_hash_uppercase','legacy_hash_uppercase') then metadata||jsonb_build_object('_embedding_lease_input_sha256',repeat('A',64))
 when case_label='completed_hash_short' then metadata||jsonb_build_object('_embedding_lease_input_sha256','abc')
 when case_label in ('completed_hash_json_null','legacy_hash_json_null') then metadata||'{{"_embedding_lease_input_sha256":null}}'::jsonb
 when case_label in ('completed_hash_number','no_image_hash_number') then
  (case when case_label like 'no_image%' then metadata-'thumbnail_url'-'_embedding_input' else metadata end)||'{{"_embedding_lease_input_sha256":123}}'::jsonb
 else metadata end metadata,embedding_lease_token,
 case when case_label='completed_hash_orphan_owner' then 'synthetic-worker' else embedding_lease_owner end embedding_lease_owner,
 case when case_label='completed_hash_orphan_expiry' then '2026-01-04T00:00:00Z'::timestamptz else embedding_lease_expires_at end embedding_lease_expires_at
 from fixture_docs_raw),
{block}
select count(*) as cases,count(*) filter(where all_match=expected_pass) as correct,
 coalesce(jsonb_agg(case_label order by case_label) filter(where all_match is distinct from expected_pass),'[]'::jsonb) as failures
from current_metadata;
"""


def trigger_fixture_sql():
    source = PROBE.read_text()
    expected = source[source.index(" select * from (values", source.index('), expected as (')):source.index('), recent as (')]
    expected = expected.rsplit('\n', 1)[0] if expected.endswith('\n') else expected
    # Remove the closing expected CTE parenthesis; the caller supplies it.
    predicate = source[source.index("t.tgrelid=to_regclass('public.assets')"):source.index('))\n  and (select count(*) from pg_trigger')]
    predicate = predicate.replace("t.tgrelid=to_regclass('public.assets')", "t.table_name='public.assets'")
    predicate = predicate.replace('t.tgfoid=to_regprocedure(e.function_name)', 't.function_name=e.function_name')
    predicate = predicate.replace('pg_get_triggerdef(t.oid,false)', 't.definition')
    fixtures = json.loads((ROOT / 'supabase/tests/fixtures/5609/acceptance-trigger-prefixes.json').read_text())
    def literal(value):
        return "'" + str(value).replace("'", "''") + "'"
    rows = ',\n'.join('(' + ','.join([literal(x['name']), str(x['event_type']), literal(x['function_name']), literal(x['original_prefix']), literal(x['current_prefix'])]) + ')' for x in fixtures)
    mutations = ['disabled','enabled_null','internal','deferrable','deferred','arguments','attributes','predicate_null','wrong_function','wrong_event','wrong_relation','operator_mutated','member_mutated','and_mutated','definition_null','missing','extra']
    cases = ','.join("('%s',false)" % name for name in mutations)
    return f"""with expected as ({expected}),fixture_base(tgname,tgtype,function_name,original_prefix,current_prefix) as(values {rows}),
fixture_cases(case_label,expected_pass) as(values ('original',true),('current',true),{cases}),
fixture_triggers as (
 select c.case_label,b.tgname,
 case when c.case_label='wrong_event' and b.tgname='trg_auto_queue_render' then 5 else b.tgtype end tgtype,
 case when c.case_label='disabled' and b.tgname='trg_auto_queue_render' then 'D'
 when c.case_label='enabled_null' and b.tgname='trg_auto_queue_render' then null else 'O' end tgenabled,
 c.case_label='internal' and b.tgname='trg_auto_queue_render' tgisinternal,
 c.case_label='deferrable' and b.tgname='trg_auto_queue_render' tgdeferrable,
 c.case_label='deferred' and b.tgname='trg_auto_queue_render' tginitdeferred,
 case when c.case_label='arguments' and b.tgname='trg_auto_queue_render' then 1 else 0 end tgnargs,
 case when c.case_label='attributes' and b.tgname='trg_auto_queue_render' then '1'::int2vector else ''::int2vector end tgattr,
 case when c.case_label='predicate_null' and b.tgname='trg_auto_queue_render' then null when b.tgtype=17 then 'predicate' end tgqual,
 case when c.case_label='wrong_function' and b.tgname='trg_auto_queue_render' then 'public.other()' else b.function_name end function_name,
 case when c.case_label='wrong_relation' and b.tgname='trg_auto_queue_render' then 'public.other' else 'public.assets' end table_name,
 case when c.case_label='original' then b.original_prefix
 when c.case_label='operator_mutated' and b.tgname='trg_auto_queue_render' then replace(b.current_prefix,'IS DISTINCT FROM','=')
 when c.case_label='member_mutated' and b.tgname='trg_auto_queue_render' then replace(b.current_prefix,'old.filename','old.other')
 when c.case_label='and_mutated' and b.tgname='trg_auto_queue_render' then replace(b.current_prefix,' OR ',' AND ')
 when c.case_label='definition_null' and b.tgname='trg_auto_queue_render' then null else b.current_prefix end definition
 from fixture_cases c cross join fixture_base b
 where not(c.case_label='missing' and b.tgname='trg_auto_queue_render')
 union all select 'extra','extra',17,'O',false,false,false,0,''::int2vector,'predicate','public.auto_queue_render()','public.assets','extra'
),results as(
 select c.case_label,c.expected_pass,
 not exists(select from expected e where not exists(select from fixture_triggers t where t.case_label=c.case_label and {predicate}))
 and (select count(*) from fixture_triggers t where t.case_label=c.case_label and t.function_name in(select function_name from expected))=10
 and (select count(*) from fixture_triggers t where t.case_label=c.case_label and t.function_name in(select function_name from expected) and t.tgtype=17)=5
 and (select count(*) from fixture_triggers t where t.case_label=c.case_label and t.function_name in(select function_name from expected) and t.tgtype in(5,13))=5 as passed
 from fixture_cases c)
select count(*) cases,count(*) filter(where passed=expected_pass) correct,
 coalesce(jsonb_agg(case_label order by case_label) filter(where passed is distinct from expected_pass),'[]'::jsonb) failures from results;
"""


def family_fixture_sql():
    source = PROBE.read_text()
    proof = source[source.index('), family_proof as (')+3:source.index('), table_stats as (')]
    proof = proof.replace('from baseline b', 'from baseline b')
    cases = [('unchanged_identity',True),('new_entry',True),('new_other_role_db_top',True)]
    cases += [(name,False) for name in ['missing','duplicate_current','duplicate_baseline','changed_query','changed_since','calls_regress','time_regress','wal_regress','old_new_entry','null_since','null_hash','null_calls','nan_time','infinite_wal','incomplete_vector','wrong_digest','insufficient_calls','mean_at_ceiling','wal_at_ceiling','mean_over_ceiling','wal_over_ceiling','changed_asset_oid','changed_document_oid']]
    selects = []
    for name, expected in cases:
        base = "(1::oid,5::oid,true,42::bigint,'2026-11-06T14:00:00Z'::timestamptz,md5('synthetic'),100::bigint,1000::numeric,1000::numeric)"
        current = "(1::oid,5::oid,true,42::bigint,'2026-11-06T14:00:00Z'::timestamptz,md5('synthetic'),200::bigint,2000::numeric,2000::numeric)"
        substitutions = {'changed_query':("md5('synthetic')","md5('mutated')"),'changed_since':('14:00:00Z','14:30:00Z'),'calls_regress':('200::bigint','99::bigint'),'time_regress':('2000::numeric','999::numeric'),'wal_regress':('2000::numeric','999::numeric'),'null_since':("'2026-11-06T14:00:00Z'::timestamptz",'null::timestamptz'),'null_hash':("md5('synthetic')",'null::text'),'null_calls':('200::bigint','null::bigint'),'nan_time':('2000::numeric',"'NaN'::numeric"),'infinite_wal':('2000::numeric',"'Infinity'::numeric")}
        if name in substitutions:
            old,new=substitutions[name]
            current = current.replace(old,new,1) if name not in ('wal_regress','infinite_wal') else current[::-1].replace(old[::-1],new[::-1],1)[::-1]
        if name=='insufficient_calls':
            current=current.replace('200::bigint','199::bigint')
        if name.startswith('mean_'):
            value='(4876427.13620301::numeric/29804/2*100+1000'+('+1' if name=='mean_over_ceiling' else '')+')'
            current=current.replace('2000::numeric',value,1)
        if name.startswith('wal_'):
            value='(1778351890::numeric/30092/2*100+1000'+('+1' if name=='wal_over_ceiling' else '')+')'
            current=current[::-1].replace('2000::numeric'[::-1],value[::-1],1)[::-1]
        bases = base + (','+base if name=='duplicate_baseline' else '')
        currents = current + (','+current if name=='duplicate_current' else '')
        if name in ('new_entry','new_other_role_db_top','old_new_entry'):
            currents += ",("+("2::oid,6::oid,false" if name=='new_other_role_db_top' else "1::oid,5::oid,true")+",43::bigint,'2026-11-06T"+('14:00:00Z' if name=='old_new_entry' else '16:00:00Z')+"'::timestamptz,md5('new'),100::bigint,1000::numeric,1000::numeric)"
        cols='userid,dbid,toplevel,queryid,stats_since,query_md5,calls,total_exec_time,wal_bytes'
        selects.append("select '"+name+"' case_label,"+str(expected).lower()+" expected_pass,("+("17810" if name=="changed_asset_oid" else "17809")+"::oid=17809::oid and "+("713490" if name=="changed_document_oid" else "713489")+"::oid=713489::oid and p.valid and p.calls>=100 and p.total_exec_time/nullif(p.calls,0)<4876427.13620301::numeric/29804/2 and p.wal_bytes/nullif(p.calls,0)<1778351890::numeric/30092/2) valid from (with baseline_family("+cols+") as(values "+bases+"), query_stats("+cols+") as(select * from(values "+currents+")v where "+('false' if name=='missing' else 'true')+"), baseline as(select '2026-11-06T15:00:00Z'::timestamptz observed_at,"+('2' if name=='incomplete_vector' else '(select count(*) from baseline_family)')+" family_entry_count,"+("md5('wrong')" if name=='wrong_digest' else "(select md5(string_agg(row(userid,dbid,toplevel,queryid,extract(epoch from stats_since),query_md5,calls,total_exec_time,wal_bytes)::text,E'\\n' order by userid,dbid,toplevel,queryid)) from baseline_family)")+" family_vector_md5), "+proof+" ) select * from family_proof)p")
    return "with cases as("+' union all '.join(selects)+") select count(*) cases,count(*) filter(where valid=expected_pass) correct,coalesce(jsonb_agg(case_label) filter(where valid is distinct from expected_pass),'[]'::jsonb) failures from cases;"


class AcceptanceProbeTests(unittest.TestCase):
    def test_original_failed_window_bytes_are_preserved(self):
        self.assertEqual(hashlib.sha256(HISTORY.read_bytes()).hexdigest(), ORIGINAL_SHA)

    def test_successor_baseline_is_wholly_unset_or_completely_pinned(self):
        current, original = PROBE.read_text(), HISTORY.read_text()
        aliases = ['observed_at','statement_stats_reset','postmaster_started_at','statement_dealloc','family_entry_count','family_vector_md5','asset_relid','document_relid','asset_updates','document_updates']
        if 'null::timestamptz as observed_at' in current:
            for alias in aliases:
                self.assertRegex(current, r'null::\w+ as ' + alias + r'\b')
            self.assertIn('where false',current)
        else:
            for alias in aliases:
                self.assertNotRegex(current,r'null::\w+ as '+alias+r'\b')
            self.assertNotIn('where false',current)
            rows=re.findall(r"\(\d+::oid,\d+::oid,(?:true|false),-?\d+::bigint,'[^']+'::timestamptz,'[0-9a-f]{32}',\d+::bigint,[0-9.]+::numeric,[0-9.]+::numeric\)",current)
            count=int(re.search(r'(\d+)::bigint as family_entry_count',current)[1])
            self.assertGreater(count,0)
            self.assertEqual(len(rows),count)
            self.assertRegex(current,r"'[0-9a-f]{32}'::text as family_vector_md5")
            import importlib.util
            spec=importlib.util.spec_from_file_location('baseline',ROOT/'scripts/prepare_assets_trigger_baseline.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            parsed=[]
            pattern=r"\((\d+)::oid,(\d+)::oid,(true|false),(-?\d+)::bigint,'([^']+)'::timestamptz,'([0-9a-f]{32})',(\d+)::bigint,([0-9.]+)::numeric,([0-9.]+)::numeric\)"
            for row in re.findall(pattern,current):
                parsed.append(dict(zip(module.FIELDS,[row[0],row[1],row[2]=='true',*row[3:]])))
            opening=re.search(r"'([^']+)'::timestamptz as observed_at",current)[1]
            digest=re.search(r"'([0-9a-f]{32})'::text as family_vector_md5",current)[1]
            self.assertEqual(module.prepare({'family':parsed,'observed_at':opening})[:2],(count,digest))

            self.assertRegex(current,r'[1-9]\d*::oid as asset_relid')
            self.assertRegex(current,r'[1-9]\d*::oid as document_relid')
        for target in ['170.077045367033::numeric', '59888.980667756245::numeric', '(8829::numeric / 5050.846546::numeric)']:
            self.assertIn(target, current)
            self.assertIn(target, original)
        self.assertIn("interval '24 hours'", current)
        self.assertIn('f.calls>=100', current)
        self.assertIn('<b.pre_mean_ms*0.5', current)
        self.assertIn('<b.pre_wal_per_call*0.5', current)
        self.assertIn('<b.pre_document_updates_per_second', current)

    def test_only_reviewed_trigger_hash_variants_and_all_original_guards_remain(self):
        source = PROBE.read_text()
        rows = re.findall(r"\('(trg_\w+)','([^']+)',(\d+),array\[([^]]+)\]\)", source)
        self.assertEqual(len(rows), 10)
        self.assertEqual(sum(int(row[2]) == 17 for row in rows), 5)
        self.assertEqual(sum(len(re.findall(r"'[0-9a-f]{32}'", row[3])) for row in rows), 15)
        for guard in ["t.tgenabled='O'", 'not t.tgisinternal', 'not t.tgdeferrable', 'not t.tginitdeferred', 't.tgnargs=0', "t.tgattr=''::int2vector", '(t.tgqual is not null)=(e.event_type=17)', 't.tgfoid=to_regprocedure(e.function_name)', 't.tgtype=e.event_type', '=any(e.definition_md5s)', 'current_user=\'supabase_read_only_user\'', 'checked=3 and all_match']:
            self.assertIn(guard, source)
        self.assertNotIn("metadata-'_embedding_input'", source)
        self.assertNotIn("metadata - '_embedding_input'", source)

    def test_retained_prefixes_are_exact_hash_bound_and_only_parentheses_differ(self):
        fixtures = json.loads((ROOT / 'supabase/tests/fixtures/5609/acceptance-trigger-prefixes.json').read_text())
        self.assertEqual(len(fixtures), 10)
        source = PROBE.read_text()
        for row in fixtures:
            norm = lambda value: re.sub(r'[()\s]', '', value).lower()
            self.assertEqual(norm(row['original_prefix']), norm(row['current_prefix']))
            for prefix in [row['original_prefix'], row['current_prefix']]:
                self.assertIn(hashlib.md5(prefix.encode()).hexdigest(), source)
            self.assertNotRegex(row['current_prefix'], r'\bAND\b')

    def test_family_scope_identity_and_reset_guards(self):
        source = PROBE.read_text()
        current = source[source.index('), query_stats as ('):source.index('), family_proof as (')]
        self.assertIn('where query ilike', current)
        self.assertNotRegex(re.sub(r'--[^\n]*', '', current), r'(?i)\blimit\b|and userid|and dbid|and toplevel')
        for guard in ["b.asset_relid=to_regclass('public.assets')::oid", "b.document_relid=to_regclass('public.dam_search_documents')::oid", 'dealloc from extensions.pg_stat_statements_info)=b.statement_dealloc',
                      'q.stats_since=f.stats_since and q.query_md5=f.query_md5',
                      'q.stats_since<b.observed_at', 'having count(*)<>1',
                      '4876427.13620301::numeric/29804', '1778351890::numeric/30092']:
            self.assertIn(guard, source)

    def test_fixture_uses_actual_probe_predicates_and_is_values_only(self):
        fixture = fixture_sql()
        self.assertIn('from metadata_checked group by case_label,expected_pass', fixture)
        self.assertNotRegex(fixture, r'(?i)\b(public|dam)\.')
        self.assertNotRegex(fixture, r'(?im)^\s*(create|alter|drop|insert|update|delete|set|grant|revoke)\b')
        self.assertIn('lease_old_claimed_hash', fixture)


if __name__ == '__main__':
    if '--emit-family-fixture' in sys.argv:
        print(family_fixture_sql())
    elif '--emit-trigger-fixture' in sys.argv:
        print(trigger_fixture_sql())
    elif '--emit-fixture' in sys.argv:
        print(fixture_sql())
    else:
        unittest.main()
