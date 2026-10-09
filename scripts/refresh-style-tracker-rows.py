#!/usr/bin/env python3
"""Reviewed, atomic Google style-tracker row refresh. No schema or core writes.

Run without --apply to produce a source-bound plan and protected recovery preimages.
Apply requires the exact reviewed plan, unchanged database fingerprint, and a gate.
"""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from collections import defaultdict

FIELDS = ('source_workbook_id', 'source_sheet', 'source_row_number', 'tracker_type',
          'sku', 'group_id', 'description', 'customer', 'designer', 'commissioned',
          'upc', 'customer_sku', 'licensor', 'license_status', 'royalty',
          'concept_status', 'pre_production_status', 'production_status',
          'default_vendor', 'discontinued', 'notes', 'row_data')
TABLES = ('public.style_tracker_rows', 'plm.style_tracker_item_bridge',
          'public.style_tracker_audit_log', 'plm.style_tracker_value_resolution',
          'public.style_tracker_user_views')
TARGET = 'qsllyeztdwjgirsysgai'
ROOT = Path(__file__).resolve().parents[1]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str,
                                    separators=(',', ':')).encode()).hexdigest()


def read_rows(tsv):
    result = []
    with tsv.open(encoding='utf-8', newline='') as handle:
        raw_rows = list(csv.reader(handle, delimiter='\t'))
    for row in raw_rows:
        if len(row) != len(FIELDS):
            raise ValueError('Refusing wrong source column count')
        row = [None if x == '\\N' else x for x in row]
        row[2] = int(row[2])
        row[19] = row[19] == 'true'
        row[21] = json.loads(row[21])
        result.append(dict(zip(FIELDS, row)))
    if len({(r['source_sheet'], r['source_row_number']) for r in result}) != len(result):
        raise ValueError('Duplicate source row references')
    if any(r['source_workbook_id'] != '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
           or (r['source_sheet'], r['tracker_type']) not in
           {('License.Style', 'licensed'), ('Generic.Style', 'generic')} for r in result):
        raise ValueError('Unexpected workbook or tab')
    if not all(any(r['source_sheet'] == tab for r in result)
               for tab in ('License.Style', 'Generic.Style')):
        raise ValueError('Missing required tab')
    return result


def snapshot(conn):
    return {table: conn.execute('select to_jsonb(t) from ' + table +
                                ' t order by id').fetchall() for table in TABLES}


def prove(conn):
    if (conn.info.host != 'aws-1-us-east-1.pooler.supabase.com' or
            conn.info.user != 'postgres.' + TARGET or conn.info.port != 5432):
        raise ValueError('Connection target mismatch')
    if conn.execute('select current_database()').fetchone()[0] != 'postgres':
        raise ValueError('Database mismatch')



def normalize(value):
    return str(value or '').strip().casefold()


def identity_matches(old_rows, new_rows):
    """Retain IDs only for a unique SKU or uniquely identical source content.

    A moved duplicate SKU with changed content has no provable identity: retain
    its recovery image, remove its old identity, and insert the source record.
    """
    old_groups, new_groups = defaultdict(list), defaultdict(list)
    for row in old_rows:
        old_groups[(row['source_sheet'], normalize(row['sku']))].append(row)
    for index, row in enumerate(new_rows):
        new_groups[(row['source_sheet'], normalize(row['sku']))].append((index,row))
    matches = {}
    for key, group in new_groups.items():
        prior = old_groups.get(key, [])
        if key[1] and len(prior) == len(group) == 1:
            matches[group[0][0]] = prior[0]
            continue
        old_content, new_content = defaultdict(list), defaultdict(list)
        for row in prior:
            old_content[digest({f:row[f] for f in FIELDS if f != 'source_row_number'})].append(row)
        for index,row in group:
            new_content[digest({f:row[f] for f in FIELDS if f != 'source_row_number'})].append(index)
        for signature, indexes in new_content.items():
            candidates = old_content.get(signature, [])
            if len(indexes) == len(candidates) == 1:
                matches[indexes[0]] = candidates[0]
    return matches


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--workbook', type=Path, required=True)
    p.add_argument('--expected-sha256', required=True)
    p.add_argument('--recovery-dir', type=Path, required=True)
    p.add_argument('--password-file', type=Path, required=True)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--reviewer-approval', type=Path)
    args = p.parse_args()
    if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != args.expected_sha256:
        raise ValueError('Workbook checksum mismatch')
    args.recovery_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if args.recovery_dir.stat().st_mode & 0o077:
        raise ValueError('Recovery directory must be private')
    converted = args.recovery_dir / 'source.tsv'
    conversion = subprocess.run([sys.executable, str(ROOT / 'scripts/import-style-tracker-xlsx.py'),
                    str(args.workbook), str(converted)], capture_output=True,text=True)
    if conversion.returncode:
        raise ValueError('Workbook converter refused: '+conversion.stderr[-1500:])
    rows = read_rows(converted)
    import psycopg
    from psycopg.types.json import Jsonb
    conn = psycopg.connect(host='aws-1-us-east-1.pooler.supabase.com', port=5432,
                           user='postgres.' + TARGET, dbname='postgres',
                           password=args.password_file.read_text().rstrip("\r\n"), connect_timeout=15)
    try:
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only = not args.apply
        if args.apply:
            if not args.reviewer_approval:
                raise ValueError('Apply requires independent review')
            subprocess.run(['ai-task-gates', 'check', '--before', 'database',
                            '--reviewer-approval', str(args.reviewer_approval)],
                           cwd=ROOT, check=True)
            # Do not establish a repeatable-read snapshot while waiting for
            # a competing writer: lock tables before the first SELECT.
            conn.execute('lock table '+', '.join(TABLES)+' in exclusive mode')
            if not conn.execute('select pg_try_advisory_xact_lock(852000728)').fetchone()[0]:
                raise ValueError('Another Master Data refresh is active')
        prove(conn)
        before = snapshot(conn)
        old_rows = [r[0] for r in before[TABLES[0]]]
        matches = identity_matches(old_rows, rows)
        plan = {'retained_ids':len(matches), 'removed_ids':len(old_rows)-len(matches),
                'target': TARGET, 'workbook_sha256': args.expected_sha256,
                'source_digest': digest(rows), 'database_digest': digest(before),
                'before': len(before[TABLES[0]]), 'after': len(rows),
                'counts': {tab: sum(r['source_sheet'] == tab for r in rows)
                           for tab in ('License.Style', 'Generic.Style')}}
        plan_file = args.recovery_dir / 'plan.json'
        if not args.apply:
            if plan_file.exists():
                raise ValueError('Never overwrite recovery evidence')
            (args.recovery_dir / 'preimages.json').write_text(json.dumps(before, default=str))
            plan_file.write_text(json.dumps(plan, indent=2))
            conn.rollback()
            print(json.dumps(plan))
            return
        recovery_file = args.recovery_dir / 'preimages.json'
        if not recovery_file.exists() or digest(json.loads(recovery_file.read_text())) != digest(json.loads(json.dumps(before,default=str))):
            raise ValueError('Recovery evidence missing or altered')
        if json.loads(plan_file.read_text()) != plan:
            raise ValueError('Source or database changed since review; apply refused')
        prove(conn)
        retained = {r['id'] for r in matches.values()}
        removed = [r['id'] for r in old_rows if r['id'] not in retained]
        n = conn.execute('delete from public.style_tracker_rows where id = any(%s::uuid[])', (removed,)).rowcount
        if n != plan['removed_ids']:
            raise ValueError('Unexpected deletion count')
        # Moving source positions must not conflict with still-occupied positions.
        # Temporary negative positions are never committed or visible to readers.
        if retained:
            conn.execute('update public.style_tracker_rows set source_row_number = -source_row_number where id = any(%s::uuid[])', (list(retained),))
        columns = ', '.join(FIELDS)
        marks = ', '.join(['%s'] * len(FIELDS))
        with conn.cursor() as cur:
            for index,row in enumerate(rows):
                values = tuple(Jsonb(row[f]) if f == 'row_data' else row[f] for f in FIELDS)
                old = matches.get(index)
                if old is None:
                    cur.execute('insert into public.style_tracker_rows ('+columns+') values ('+marks+')',values)
                else:
                    customer_id = old.get('customer_id') if normalize(row['customer']) == normalize(old['customer']) else None
                    cur.execute('update public.style_tracker_rows set '+', '.join(f+'=%s' for f in FIELDS)+', customer_id=%s where id=%s',values+(customer_id,old['id']))
        bridge = conn.execute('select * from public.refresh_style_tracker_item_bridge()').fetchall()
        # Preserve curated relationships only while their source business field
        # is unchanged. No lookup rows or canonical Item Master rows are written.
        bridges = {r[0]['style_tracker_row_id']:r[0] for r in before[TABLES[1]]}
        with conn.cursor() as cur:
            for index,old in matches.items():
                prior = bridges.get(old['id'])
                if not prior:
                    continue
                source = rows[index]
                relationships = {'sku':('erp_item_id','style_group_id','plm_item_id'),
                                 'customer':('company_id',),
                                 'designer':('creative_designer_id',),
                                 'default_vendor':('factory_id',),
                                 'licensor':('public_licensor_id','core_licensor_id')}
                patch = {}
                for field, columns_for_field in relationships.items():
                    if normalize(source[field]) == normalize(old[field]):
                        for column in columns_for_field:
                            if prior.get(column) is not None:
                                patch[column] = prior[column]
                if patch:
                    cur.execute('update plm.style_tracker_item_bridge set '+', '.join(column+'=%s' for column in patch)+' where style_tracker_row_id=%s', tuple(patch.values())+(old['id'],))
        actual = conn.execute('select '+columns+' from public.style_tracker_rows order by source_sheet,source_row_number').fetchall()
        observed = [dict(zip(FIELDS,r)) for r in actual]
        if digest(observed) != digest(sorted(rows,key=lambda r:(r['source_sheet'],r['source_row_number']))):
            raise ValueError('Post-load source equality failed')
        if conn.execute('select count(*) from plm.style_tracker_item_bridge').fetchone()[0] != len(rows):
            raise ValueError('Bridge count mismatch')
        if snapshot(conn)[TABLES[-1]] != before[TABLES[-1]]:
            raise ValueError('Saved views changed')
        conn.commit()
        (args.recovery_dir/'result.json').write_text(json.dumps({'plan':plan,'bridge':bridge,'source_equality':True},default=str))
        print(json.dumps({'before':plan['before'],'removed_ids':n,'retained_ids':len(matches),'after':len(rows),'source_equality':True}))
    finally:
        conn.close()


if __name__ == '__main__':
    os.umask(0o077)
    main()
