#!/usr/bin/env python3
"""Reviewed, atomic Google style-tracker row refresh. No schema or core writes.

Run without --apply to produce a source-bound plan and protected recovery preimages.
Apply requires the exact reviewed plan, unchanged database fingerprint, and a gate.
"""
import argparse
import csv
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

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
    for row in csv.reader(tsv.open(encoding='utf-8'), delimiter='\t'):
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
    subprocess.run([sys.executable, str(ROOT / 'scripts/import-style-tracker-xlsx.py'),
                    str(args.workbook), str(converted)], check=True, capture_output=True)
    rows = read_rows(converted)
    import psycopg
    from psycopg.types.json import Jsonb
    conn = psycopg.connect(host='aws-1-us-east-1.pooler.supabase.com', port=5432,
                           user='postgres.' + TARGET, dbname='postgres',
                           password=args.password_file.read_text(), connect_timeout=15)
    try:
        prove(conn)
        if args.apply:
            if not args.reviewer_approval:
                raise ValueError('Apply requires independent review')
            subprocess.run(['ai-task-gates', 'check', '--before', 'database',
                            '--reviewer-approval', str(args.reviewer_approval)],
                           cwd=ROOT, check=True)
            conn.execute('select pg_advisory_xact_lock(852000728)')
            conn.execute('lock table public.style_tracker_rows in exclusive mode')
        else:
            conn.execute('set transaction read only')
        before = snapshot(conn)
        plan = {'target': TARGET, 'workbook_sha256': args.expected_sha256,
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
        if json.loads(plan_file.read_text()) != plan:
            raise ValueError('Source or database changed since review; apply refused')
        prove(conn)
        n = conn.execute("delete from public.style_tracker_rows where source_sheet in ('License.Style','Generic.Style') and source_workbook_id=%s", ('1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214',)).rowcount
        if n != plan['before']:
            raise ValueError('Unexpected deletion count')
        columns = ', '.join(FIELDS)
        marks = ', '.join(['%s'] * len(FIELDS))
        with conn.cursor() as cur:
            cur.executemany('insert into public.style_tracker_rows ('+columns+') values ('+marks+')',
                            [tuple(Jsonb(r[f]) if f == 'row_data' else r[f] for f in FIELDS) for r in rows])
        bridge = conn.execute('select * from public.refresh_style_tracker_item_bridge()').fetchall()
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
        print(json.dumps({'before':n,'after':len(rows),'source_equality':True}))
    finally:
        conn.close()


if __name__ == '__main__':
    os.umask(0o077)
    main()
