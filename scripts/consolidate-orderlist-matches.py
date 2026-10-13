#!/usr/bin/env python3
"""Consolidate business-confirmed Google Order lines into existing ColdLion lines.

Dry-run is the default. The reviewed dry-run plan pins every input and scoped
preimage; apply accepts that exact plan and refuses to rebuild it.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'qsllyeztdwjgirsysgai'
ADVISORY_LOCK = 852000727
DECISION = 'Same order — use Google details'
LINE_TABLE = 'plm.production_order_line'
ORDER_TABLE = 'plm.production_order'
LINE_REF_TABLE = 'plm.production_order_line_source_ref'
ORDER_REF_TABLE = 'plm.production_order_source_ref'
SNAPSHOT_TABLE = 'dam.production_order_snapshot'
TRACKING_TABLE = 'dam.order_tracking_ext'
TABLES = (ORDER_TABLE, LINE_TABLE, ORDER_REF_TABLE, LINE_REF_TABLE, SNAPSHOT_TABLE, TRACKING_TABLE)
PROTECTED_LINE_FIELDS = {
    'quantity_ordered', 'item_id', 'line_number', 'master_data_match_status',
    'source_system', 'source_id', 'unit_cost', 'quantity_shipped', 'status',
    'production_order_id', 'created_at', 'updated_at', 'id',
}
GOOGLE_EVIDENCE_METADATA_KEYS = {
    'order_list_source', 'raw_evidence', 'order_list_snapshot',
    'contractual_sample_reorder_raw', 'invalid_line_values',
}
SPEC = importlib.util.spec_from_file_location('source_import', ROOT/'shared-db/scripts/import-order-list-xlsx.py')
m = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = m
SPEC.loader.exec_module(m)
REFRESH_SPEC = importlib.util.spec_from_file_location('google_refresh', ROOT/'scripts/refresh-google-orderlist-rows.py')
refresh = importlib.util.module_from_spec(REFRESH_SPEC)
sys.modules[REFRESH_SPEC.name] = refresh
REFRESH_SPEC.loader.exec_module(refresh)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canon(value) -> str:
    return json.dumps(value, sort_keys=True, default=str, separators=(',', ':'))


def digest(value) -> str:
    return hashlib.sha256(canon(value).encode()).hexdigest()


def need_sha(path: Path, expected: str, label: str) -> None:
    actual = sha(path)
    if actual.lower() != expected.lower():
        raise ValueError(f'{label} checksum mismatch')


def load_bindings(path: Path) -> dict:
    packet = json.loads(path.read_text())
    if packet.get('schema') != 'canonical-coldlion-binding-packet-v1':
        raise ValueError('Unsupported binding packet schema')
    rows = packet.get('rows')
    if not isinstance(rows, list) or not rows:
        raise ValueError('Binding packet has no rows')
    byrow = {}
    for entry in rows:
        row = entry.get('returned_excel_row')
        if not isinstance(row, int) or row in byrow:
            raise ValueError('Duplicate or invalid returned workbook row binding')
        if not isinstance(entry.get('google_physical_row'),int):
            raise ValueError('Invalid Google source row binding')
        byrow[row] = entry
        cold = entry.get('original_cold_binding') or {}
        google = entry.get('original_google_binding') or {}
        if not all(cold.get(k) for k in ('cold_line_uuid', 'line_source_id', 'component_source_hash')):
            raise ValueError('Incomplete ColdLion line binding')
        if not all(google.get(k) for k in ('google_line_source_id', 'google_parent_source_id')):
            raise ValueError('Incomplete Google line binding')
    if len(byrow) != len(rows):
        raise ValueError('Binding rows are not unique')
    return packet


def returned_decisions(path: Path) -> dict[int, dict]:
    from openpyxl import load_workbook
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        if 'Potential overlaps' not in book.sheetnames:
            raise ValueError('Returned workbook has no Potential overlaps sheet')
        sheet = book['Potential overlaps']
        headers = [str(x or '').strip() for x in next(sheet.iter_rows(min_row=1, max_row=1, values_only=True))]
        indexes = {name: i for i, name in enumerate(headers)}
        required = ('Google row', 'Google customer PO', 'Google style number', "Yuchen's decision", 'Yuchen’s notes / corrected values')
        if any(h not in indexes for h in required):
            raise ValueError('Returned workbook headers changed')
        output = {}
        for excel_row, values in enumerate(sheet.iter_rows(min_row=2, values_only=True),2):
            if not values or values[indexes['Google row']] is None:
                continue
            google_row = int(values[indexes['Google row']])
            output[excel_row] = {
                'google_row':google_row,
                'decision': str(values[indexes["Yuchen's decision"]] or '').strip(),
                'notes': str(values[indexes['Yuchen’s notes / corrected values']] or '').strip(),
                'customer_po': values[indexes['Google customer PO']],
                'sku': values[indexes['Google style number']],
            }
        return output
    finally:
        book.close()


def planned_source(source_path: Path):
    rows = refresh.source_rows(source_path)
    plan = m.build_plan(rows, m.MasterDataCatalog())
    refresh.resolve_case_only_header_conflicts(plan, rows)
    by_source = defaultdict(list)
    for line in plan.writable_lines():
        by_source[line.source_id].append(line)
    return rows, plan, by_source


def quantity_note(note: str) -> Decimal:
    number=r'(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?'
    matches=re.findall(r'\bQuantity\s+('+number+r')(?=$|[\s;:!?)]|,(?!\d)|\.(?!\d))',note)
    if len(matches)!=1:
        raise ValueError('Each approved row note must contain exactly one explicit Quantity N declaration')
    try:
        value = Decimal(matches[0].replace(',',''))
    except InvalidOperation as exc:
        raise ValueError('Invalid quantity note') from exc
    if not value.is_finite():
        raise ValueError('Invalid quantity note')
    return value


def verify_approved_decision(binding_decision: str, workbook_decision: str,
                             binding_note: str, workbook_note: str) -> Decimal:
    if binding_decision != DECISION or workbook_decision != DECISION:
        raise ValueError('A bound row does not have the exact approved decision')
    if str(binding_note).strip() != str(workbook_note).strip():
        raise ValueError('Returned notes differ from the frozen decision binding')
    return quantity_note(workbook_note)


def make_bindings(packet: dict, decisions: dict[int, dict], rows, by_source):
    source_by_row = {row.sheet_row: row for row in rows}
    if set(decisions) != {entry['returned_excel_row'] for entry in packet['rows']}:
        raise ValueError('Decision rows do not exactly match the frozen binding packet')
    prepared = []
    for entry in packet['rows']:
        physical = entry['google_physical_row']
        decision = decisions[entry['returned_excel_row']]
        if decision.get('google_row')!=physical:
            raise ValueError('Returned workbook row points to a different Google source row')
        qty = verify_approved_decision(entry.get('decision',''),decision.get('decision',''),
                                       entry.get('notes',''),decision.get('notes',''))
        src = source_by_row.get(physical)
        if src is None:
            raise ValueError('Bound Google source row is absent from current source')
        if not str(decision.get('customer_po') or '').strip() or not str(decision.get('sku') or '').strip():
            raise ValueError('Bound Google customer PO and SKU must both be populated')
        line_sid = entry['original_google_binding']['google_line_source_id']
        candidates = by_source.get(line_sid, [])
        if len(candidates) != 1:
            raise ValueError('Bound Google source identity is not a unique current parser line')
        line = candidates[0]
        if line.sheet_row != physical:
            raise ValueError('Google source row identity changed')
        if src.cell('N') != decision.get('customer_po'):
            raise ValueError('Google customer PO changed from returned decision workbook')
        if refresh.normalized(line.payload.get('customer_po_number')) != refresh.normalized(decision.get('customer_po')):
            raise ValueError('Parsed Google customer PO does not match returned answer')
        if m.normalize_sku(line.payload.get('sku')) != m.normalize_sku(decision.get('sku')):
            raise ValueError('Google SKU changed from returned decision workbook')
        prepared.append({
            'google_physical_row': physical,
            'google_line_source_id': line_sid,
            'google_parent_source_id': line.order_source_id,
            'google_payload': deepcopy(line.payload),
            'google_metadata': deepcopy(line.metadata),
            'google_customer_po': decision.get('customer_po'),
            'google_sku': decision.get('sku'),
            'verified_quantity': str(qty),
            'cold': deepcopy(entry['original_cold_binding']),
            'google': deepcopy(entry['original_google_binding']),
        })
    return prepared


def cold_google_patch(old: dict, item: dict, google_parent_id: str) -> dict:
    """Create a minimal safe line update while retaining ColdLion identity."""
    cold = deepcopy(old)
    if m.normalize_sku(cold.get('sku')) != m.normalize_sku(item['google_sku']):
        raise ValueError('Current Google SKU no longer matches the bound ColdLion line')
    if str(cold.get('customer_po_number') or '').strip() != str(item['google_customer_po'] or '').strip():
        raise ValueError('Current Google customer PO no longer matches the bound ColdLion line')
    current_qty = cold.get('quantity_ordered')
    if current_qty is None or Decimal(str(current_qty)) != Decimal(item['verified_quantity']):
        raise ValueError('Quantity note does not match existing ColdLion quantity')
    google = item['google_payload']
    for field in m.LINE_COLUMNS:
        if field in PROTECTED_LINE_FIELDS or field == 'metadata':
            continue
        if field in google:
            cold[field] = deepcopy(google[field])
    cold['production_order_id'] = google_parent_id
    oldmeta = deepcopy(old.get('metadata') or {})
    incoming = {key:deepcopy(value) for key,value in (item['google_metadata'] or {}).items()
                if key in GOOGLE_EVIDENCE_METADATA_KEYS}
    for key, value in incoming.items():
        if key not in oldmeta:
            oldmeta[key] = value
        elif oldmeta[key] != value:
            archive = oldmeta.get('google_orderlist_reconciliation')
            if not isinstance(archive, dict):
                archive = {'preserved_cold_value': archive}
                oldmeta['google_orderlist_reconciliation'] = archive
            prior = archive.setdefault('preserved_google_metadata', {})
            if not isinstance(prior, dict):
                prior = {'preserved_prior_value': prior}
                archive['preserved_google_metadata'] = prior
            prior[key] = value
    oldmeta['google_orderlist_reconciliation'] = {
        **(oldmeta.get('google_orderlist_reconciliation') or {}),
        'google_source_id': item['google_line_source_id'],
        'google_parent_source_id': item['google_parent_source_id'],
        'verified_quantity': item['verified_quantity'],
    }
    cold['metadata'] = oldmeta
    return cold


def transfer_ref(ref: dict, cold_id: str) -> dict:
    moved = deepcopy(ref)
    moved['production_order_line_id'] = cold_id
    return moved


def validate_duplicate_refs(expected_ref: dict, refs: list[dict]) -> None:
    if len(refs) != 1 or refs[0].get('id') != expected_ref.get('id'):
        raise ValueError('Google duplicate has unexpected source references')


def validate_no_duplicate_snapshots(duplicate_ids: set[str], snapshots: list[dict]) -> None:
    if any(row.get('production_order_line_id') in duplicate_ids for row in snapshots):
        raise ValueError('Snapshot references a Google duplicate line')


def validate_google_duplicate(row: dict, item: dict, expected_parent: str) -> None:
    if m.normalize_sku(row.get('sku')) != m.normalize_sku(item['google_sku']):
        raise ValueError('Google duplicate SKU differs from its bound source row')
    google_po=str(item['google_payload'].get('customer_po_number') or '').strip()
    if str(row.get('customer_po_number') or '').strip()!=google_po:
        raise ValueError('Google duplicate customer PO differs from its bound source row')
    if row.get('production_order_id')!=expected_parent:
        raise ValueError('Google duplicate line is under a different parent than its source binding')
    evidence=(row.get('metadata') or {}).get('order_list_source')
    if isinstance(evidence,dict) and evidence.get('sheet_row') not in (None,item['google_physical_row']):
        raise ValueError('Google duplicate source row evidence changed')


def validate_legacy_google_identity(row: dict, source_id: str) -> None:
    if row.get('source_system') not in (None,m.SOURCE_SYSTEM) or row.get('source_id') not in (None,source_id):
        raise ValueError('Google duplicate source identity changed')


def missing_ref_uuid(source_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL,'popdam-orderlist-google-line-ref:'+source_id))


def verify_reviewed_inputs(current_plan, saved_plan, current_preimages, saved_preimages) -> None:
    if digest(current_plan) != digest(saved_plan) or digest(current_preimages) != digest(saved_preimages):
        raise ValueError('Inputs, live preimages, or reviewed plan changed')


def scoped_primary_keys(rows: list[dict], column: str) -> list[str]:
    values=[row.get(column) for row in rows]
    if any(value is None for value in values) or len(set(values))!=len(values):
        raise ValueError('Scoped preimage primary-key contract changed')
    return sorted(values)


def source_id_set(rows: list[dict]) -> set[str]:
    values=[row.get('source_id') for row in rows]
    if any(value is None or not str(value).strip() for value in values):
        raise ValueError('Scoped source-reference identity is incomplete')
    return {str(value) for value in values}


def verify_fk_contract(rows: list[dict]) -> None:
    expected = {
        (LINE_REF_TABLE, ('production_order_line_id',), LINE_TABLE, ('id',), 'c'),
        (SNAPSHOT_TABLE, ('production_order_line_id',), LINE_TABLE, ('id',), 'n'),
    }
    actual = {(r['child_table'], tuple(r['child_columns']), r['parent_table'], tuple(r['parent_columns']), r['delete_rule']) for r in rows}
    if actual != expected:
        raise ValueError('Production line foreign-key contract changed')


def expected_fks_sql(conn):
    return [dict(zip(('child_table','child_columns','parent_table','parent_columns','delete_rule'), row)) for row in conn.execute("""
      select cn.nspname||'.'||c.relname,
             array(select a.attname from unnest(con.conkey) with ordinality k(attnum,ord)
                   join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum order by k.ord),
             pn.nspname||'.'||p.relname,
             array(select a.attname from unnest(con.confkey) with ordinality k(attnum,ord)
                   join pg_attribute a on a.attrelid=p.oid and a.attnum=k.attnum order by k.ord),
             con.confdeltype::text
      from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace cn on cn.oid=c.relnamespace
      join pg_class p on p.oid=con.confrelid join pg_namespace pn on pn.oid=p.relnamespace
      where con.contype='f' and con.confrelid='plm.production_order_line'::regclass
    """).fetchall()]


def private_write(path: Path, value) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(value, sort_keys=True, indent=2, default=str))
        handle.flush()
        os.fsync(handle.fileno())


def cli():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--source-sha256', required=True)
    p.add_argument('--decisions-workbook', type=Path, required=True)
    p.add_argument('--decisions-sha256', required=True)
    p.add_argument('--bindings', type=Path, required=True)
    p.add_argument('--bindings-sha256', required=True)
    p.add_argument('--password-file', type=Path, required=True)
    p.add_argument('--recovery-dir', type=Path, required=True)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--reviewer-approval', type=Path)
    return p.parse_args()


SAFE_GUARD_MESSAGES = frozenset({
    'Unsupported binding packet schema','Binding packet has no rows',
    'Duplicate or invalid returned workbook row binding','Invalid Google source row binding',
    'Incomplete ColdLion line binding','Incomplete Google line binding','Binding rows are not unique',
    'Returned workbook has no Potential overlaps sheet','Returned workbook headers changed',
    'Each approved row note must contain exactly one explicit Quantity N declaration','Invalid quantity note',
    'A bound row does not have the exact approved decision','Returned notes differ from the frozen decision binding',
    'Decision rows do not exactly match the frozen binding packet','Returned workbook row points to a different Google source row',
    'Bound Google source row is absent from current source','Bound Google customer PO and SKU must both be populated',
    'Bound Google source identity is not a unique current parser line','Google source row identity changed',
    'Google customer PO changed from returned decision workbook','Parsed Google customer PO does not match returned answer',
    'Google SKU changed from returned decision workbook','Current Google SKU no longer matches the bound ColdLion line',
    'Current Google customer PO no longer matches the bound ColdLion line','Quantity note does not match existing ColdLion quantity',
    'Google duplicate has unexpected source references','Snapshot references a Google duplicate line',
    'Google duplicate SKU differs from its bound source row','Google duplicate customer PO differs from its bound source row',
    'Google duplicate line is under a different parent than its source binding',
    'Google duplicate source row evidence changed','Google duplicate source identity changed',
    'Inputs, live preimages, or reviewed plan changed','Scoped preimage primary-key contract changed',
    'Scoped source-reference identity is incomplete','ColdLion line source-reference identity set changed',
    'ColdLion parent source-reference identity set changed',
    'Production line foreign-key contract changed','Password file permissions must be private',
    'Recovery directory permissions must be private','Apply requires exact reviewer approval report',
    'Reviewed dry-run plan and preimages are required','Another OrderList import is active',
    'Recovery evidence already exists; use a new empty directory','A bound ColdLion line is missing',
    'Multiple answers target one ColdLion line','Bound ColdLion line is absent',
    'ColdLion parent header changed from its frozen binding','ColdLion source identity changed',
    'ColdLion component fingerprint changed','ColdLion line source reference changed',
    'Google source identity has duplicate source references','Google line reference points to missing canonical line',
    'Bound Google parent header is missing','Out-of-scope Google duplicate line appears in preimages',
    'Google parent source identity is ambiguous','Unexpected number of Google duplicate lines deleted',
    'Consolidated ColdLion line disappeared','ColdLion line was not moved to the bound Google header',
    'Merged line evidence did not persist','Protected ColdLion line field changed',
    'Google-owned field did not persist','Google source reference did not map to its ColdLion line',
    'Transferred Google source reference changed outside its line owner',
    'Inserted Google source reference does not match its deterministic plan',
    'Google duplicate rows remain after consolidation','Unexpected snapshot appeared on a Google duplicate line',
    'Header, header-reference, or tracking evidence changed','ColdLion source references changed',
    'ColdLion source identity or history field changed','Consolidation changed an unexpected number of records',
})


def safe_failure(exc: Exception) -> tuple[str, str | None]:
    message=str(exc)
    if type(exc) is ValueError and (message in SAFE_GUARD_MESSAGES or
            message in {'Source checksum mismatch','Decision workbook checksum mismatch','Bindings checksum mismatch'}):
        code='guard_'+re.sub(r'[^a-z0-9]+','_',message.lower()).strip('_')
        return code,message
    return 'failure_'+type(exc).__name__.lower(),None


def write_failure_receipt(directory: Path, code: str, message: str | None) -> None:
    try:
        if not directory.is_dir() or directory.stat().st_mode & 0o077:
            return
        path=directory/'failure-receipt.json'
        receipt={'schema':'orderlist-consolidation-failure-v1','error_code':code}
        if message is not None:
            receipt['static_guard_message']=message
        with path.open('x') as handle:
            json.dump(receipt,handle,sort_keys=True,indent=2)
        path.chmod(0o600)
    except Exception:
        pass


def execute(args):
    for path, expected, label in ((args.source,args.source_sha256,'Source'),
                                  (args.decisions_workbook,args.decisions_sha256,'Decision workbook'),
                                  (args.bindings,args.bindings_sha256,'Bindings')):
        need_sha(path, expected, label)
    if args.password_file.stat().st_mode & 0o077:
        raise ValueError('Password file permissions must be private')
    if not args.recovery_dir.exists():
        args.recovery_dir.mkdir(parents=True, mode=0o700)
    if args.recovery_dir.stat().st_mode & 0o077:
        raise ValueError('Recovery directory permissions must be private')
    plan_path = args.recovery_dir/'consolidation-plan.json'
    preimage_path = args.recovery_dir/'preimages.json'
    if args.apply:
        if not args.reviewer_approval:
            raise ValueError('Apply requires exact reviewer approval report')
        if not plan_path.exists() or not preimage_path.exists():
            raise ValueError('Reviewed dry-run plan and preimages are required')
        subprocess.run(['ai-task-gates','check','--before','database','--reviewer-approval',str(args.reviewer_approval)],cwd=ROOT,check=True)
    packet = load_bindings(args.bindings)
    decisions = returned_decisions(args.decisions_workbook)
    rows, parsed, by_source = planned_source(args.source)
    bound = make_bindings(packet, decisions, rows, by_source)
    import psycopg
    conn = psycopg.connect(host='aws-1-us-east-1.pooler.supabase.com',port=5432,
        user='postgres.'+TARGET,dbname='postgres',password=args.password_file.read_text().rstrip('\r\n'),connect_timeout=15)
    try:
        conn.isolation_level=psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only=not args.apply
        conn.execute("set local statement_timeout='8s'")
        conn.execute("set local lock_timeout='2s'")
        if args.apply:
            # Match existing importer lock order, then lock dependent evidence tables.
            conn.execute('lock table '+', '.join(TABLES)+' in exclusive mode')
            if not conn.execute('select pg_try_advisory_xact_lock(%s)',(ADVISORY_LOCK,)).fetchone()[0]:
                raise ValueError('Another OrderList import is active')
        refresh.prove(conn)
        verify_fk_contract(expected_fks_sql(conn))
        pre = capture_preimages(conn, bound)
        plan = build_plan(args, packet, decisions, bound, pre)
        if not args.apply:
            if plan_path.exists() or preimage_path.exists():
                raise ValueError('Recovery evidence already exists; use a new empty directory')
            private_write(preimage_path, pre)
            private_write(plan_path, plan)
            conn.rollback()
            print(json.dumps({'mode':'dry-run','bound_lines':len(bound),'duplicate_lines':plan['counts']['duplicates'],'missing_line_refs':plan['counts']['missing_google_refs'],'plan_sha256':digest(plan)}))
            return
        saved_plan=json.loads(plan_path.read_text())
        saved_pre=json.loads(preimage_path.read_text())
        verify_reviewed_inputs(plan,saved_plan,pre,saved_pre)
        apply_plan(conn, plan, pre)
        conn.commit()
        print(json.dumps({'mode':'applied','consolidated':len(bound),'deleted_duplicates':plan['counts']['duplicates'],'inserted_refs':plan['counts']['missing_google_refs']}))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    os.umask(0o077)
    args=cli()
    try:
        execute(args)
    except Exception as exc:
        code,message=safe_failure(exc)
        write_failure_receipt(args.recovery_dir,code,message)
        print(json.dumps({'error_code':code}),file=sys.stderr)
        raise SystemExit(1) from None


def capture_preimages(conn, bound):
    cold_ids=sorted({b['cold']['cold_line_uuid'] for b in bound})
    google_sids=sorted({b['google_line_source_id'] for b in bound})
    cold_source_ids=sorted({b['cold']['line_source_id'] for b in bound})
    cold_rows=conn.execute('select to_jsonb(t) from '+LINE_TABLE+' t where id = any(%s) order by id',(cold_ids,)).fetchall()
    google_refs=conn.execute('select to_jsonb(t) from '+LINE_REF_TABLE+' t where source_system=%s and source_id=any(%s) order by id',(m.SOURCE_SYSTEM,google_sids)).fetchall()
    cold_refs=conn.execute('select to_jsonb(t) from '+LINE_REF_TABLE+' t where production_order_line_id=any(%s) or (source_system=%s and source_id=any(%s)) order by id',(cold_ids,'coldlion',cold_source_ids)).fetchall()
    if len(cold_rows)!=len(cold_ids):
        raise ValueError('A bound ColdLion line is missing')
    cold_by={r[0]['id']:r[0] for r in cold_rows}
    google_ref_rows=[r[0] for r in google_refs]
    duplicate_ids=sorted({r['production_order_line_id'] for r in google_ref_rows})
    duplicate_rows=conn.execute('select to_jsonb(t) from '+LINE_TABLE+' t where id=any(%s) order by id',(duplicate_ids,)).fetchall() if duplicate_ids else []
    duplicate_by={r[0]['id']:r[0] for r in duplicate_rows}
    duplicate_refs=conn.execute('select to_jsonb(t) from '+LINE_REF_TABLE+' t where production_order_line_id=any(%s) order by id',(duplicate_ids,)).fetchall() if duplicate_ids else []
    all_line_ids=sorted(set(cold_ids)|set(duplicate_ids))
    snapshots=conn.execute('select to_jsonb(t) from '+SNAPSHOT_TABLE+' t where production_order_line_id=any(%s) order by id',(all_line_ids,)).fetchall() if all_line_ids else []
    google_parent_sids=sorted({b['google_parent_source_id'] for b in bound})
    google_parent_refs=conn.execute('select to_jsonb(t) from '+ORDER_REF_TABLE+' t where source_system=%s and source_id=any(%s) order by id',(m.SOURCE_SYSTEM,google_parent_sids)).fetchall()
    parent_ids=sorted({r['production_order_id'] for r in cold_by.values()}|{r['production_order_id'] for r in duplicate_by.values()}|{r[0]['production_order_id'] for r in google_parent_refs})
    orders=conn.execute('select to_jsonb(t) from '+ORDER_TABLE+' t where id=any(%s) order by id',(parent_ids,)).fetchall() if parent_ids else []
    order_refs=conn.execute('select to_jsonb(t) from '+ORDER_REF_TABLE+' t where production_order_id=any(%s) order by id',(parent_ids,)).fetchall() if parent_ids else []
    tracking=conn.execute('select to_jsonb(t) from '+TRACKING_TABLE+' t where order_id=any(%s) order by order_id',(parent_ids,)).fetchall() if parent_ids else []
    return {'cold_lines':[r[0] for r in cold_rows], 'google_refs':google_ref_rows,
        'cold_refs':[r[0] for r in cold_refs], 'duplicate_lines':[r[0] for r in duplicate_rows],
        'duplicate_refs':[r[0] for r in duplicate_refs], 'snapshots':[r[0] for r in snapshots],
        'orders':[r[0] for r in orders], 'order_refs':[r[0] for r in order_refs],
        'google_parent_refs':[r[0] for r in google_parent_refs],
        'tracking':[r[0] for r in tracking], 'counts':{t:conn.execute('select count(*) from '+t).fetchone()[0] for t in TABLES}}


def build_plan(args, packet, decisions, bound, pre):
    cold={r['id']:r for r in pre['cold_lines']}
    coldrefs_by_sid=defaultdict(list)
    coldrefs_by_line=defaultdict(list)
    for ref in pre['cold_refs']:
        coldrefs_by_sid[ref['source_id']].append(ref)
        coldrefs_by_line[ref['production_order_line_id']].append(ref)
    googlerefs_by_sid=defaultdict(list)
    for ref in pre['google_refs']: googlerefs_by_sid[ref['source_id']].append(ref)
    orders={r['id']:r for r in pre['orders']}
    dup={r['id']:r for r in pre['duplicate_lines']}
    duprefs=defaultdict(list)
    for ref in pre['duplicate_refs']:duprefs[ref['production_order_line_id']].append(ref)
    entries=[]
    seen_cold=set(); duplicate_ids=set()
    for item in bound:
        cold_id=item['cold']['cold_line_uuid']; sid=item['google_line_source_id']
        if cold_id in seen_cold: raise ValueError('Multiple answers target one ColdLion line')
        seen_cold.add(cold_id)
        current=cold.get(cold_id)
        if not current: raise ValueError('Bound ColdLion line is absent')
        if current.get('production_order_id') != item['cold']['cold_parent_uuid']:
            raise ValueError('ColdLion parent header changed from its frozen binding')
        if current.get('source_system')!='coldlion' or current.get('source_id')!=item['cold']['line_source_id']:
            raise ValueError('ColdLion source identity changed')
        if current.get('metadata',{}).get('component_source_hash') != item['cold']['component_source_hash']:
            raise ValueError('ColdLion component fingerprint changed')
        cold_matches=coldrefs_by_sid.get(item['cold']['line_source_id'],[])
        if len(cold_matches)!=1 or cold_matches[0].get('production_order_line_id')!=cold_id or cold_matches[0].get('source_system')!='coldlion':
            raise ValueError('ColdLion line source reference changed')
        if source_id_set(coldrefs_by_line.get(cold_id,[])) != set(item['cold']['cold_line_source_ref_ids']):
            raise ValueError('ColdLion line source-reference identity set changed')
        cold_parent_refs=[r for r in pre['order_refs'] if r['production_order_id']==item['cold']['cold_parent_uuid']]
        if source_id_set(cold_parent_refs) != set(item['cold']['cold_parent_source_ref_ids']):
            raise ValueError('ColdLion parent source-reference identity set changed')
        google_matches=googlerefs_by_sid.get(sid,[])
        if len(google_matches)>1: raise ValueError('Google source identity has duplicate source references')
        gr=google_matches[0] if google_matches else None
        if gr:
            gid=gr['production_order_line_id']
            duplicate=dup.get(gid)
            if not duplicate: raise ValueError('Google line reference points to missing canonical line')
            validate_legacy_google_identity(duplicate,sid)
            validate_duplicate_refs(gr,duprefs[gid])
            duplicate_ids.add(gid)
            google_parent=orders.get(_parent_uuid(item['google_parent_source_id'],pre))
            if not google_parent: raise ValueError('Bound Google parent header is missing')
            gidparent=google_parent['id']
            validate_google_duplicate(duplicate,item,gidparent)
        else:
            gid=None
            gidparent=_parent_uuid(item['google_parent_source_id'],pre)
            if not gidparent or gidparent not in orders: raise ValueError('Bound Google parent header is missing')
        patched=cold_google_patch(current,item,gidparent)
        entry={'cold_id':cold_id,'cold_before':current,'cold_after':patched,'google_source_id':sid,
               'google_parent_id':gidparent,'google_line_ref':gr,'duplicate_id':gid,
               'duplicate_before':dup.get(gid) if gid else None}
        entries.append(entry)
    if len(duplicate_ids)!=len(pre['duplicate_lines']):
        raise ValueError('Out-of-scope Google duplicate line appears in preimages')
    validate_no_duplicate_snapshots(duplicate_ids,pre['snapshots'])
    return {'schema':'orderlist-match-consolidation-plan-v1','target':TARGET,
        'source_sha256':args.source_sha256,'decisions_sha256':args.decisions_sha256,
        'bindings_sha256':args.bindings_sha256,'binding_digest':digest(packet),
        'decision_digest':digest(decisions),'preimage_digest':digest(pre),
        'counts':{'bound':len(entries),'duplicates':len(duplicate_ids),'missing_google_refs':sum(e['google_line_ref'] is None for e in entries)},
        'entries':entries,'scope_counts':pre['counts'],'expected_parent_map':sorted((e['cold_id'],e['google_parent_id']) for e in entries)}


def _parent_uuid(source_id, pre):
    matches=[ref['production_order_id'] for ref in pre.get('google_parent_refs',[])
             if ref.get('source_system')==m.SOURCE_SYSTEM and ref.get('source_id')==source_id]
    if len(matches)>1:
        raise ValueError('Google parent source identity is ambiguous')
    return matches[0] if matches else None


def apply_plan(conn, plan, pre):
    """Apply a previously pinned plan inside the caller's transaction."""
    from psycopg.types.json import Jsonb
    entries=plan['entries']
    ref_updates=[]; ref_inserts=[]; line_updates=[]; delete_ids=[]
    for e in entries:
        cold=e['cold_after']
        update_fields=[f for f in m.LINE_COLUMNS if f not in PROTECTED_LINE_FIELDS]
        values=[Jsonb(cold.get(f),dumps=lambda value: json.dumps(value,default=str,separators=(',',':'))) if f=='metadata' else cold.get(f) for f in update_fields]
        line_updates.append((e['google_parent_id'],*values,e['cold_id']))
        if e['google_line_ref']:
            ref_updates.append((e['cold_id'],e['google_line_ref']['id']))
        else:
            ref_id=missing_ref_uuid(e['google_source_id'])
            ref_inserts.append((ref_id,e['cold_id'],'google_order_list',e['google_source_id'],True,{}))
        if e['duplicate_id']: delete_ids.append(e['duplicate_id'])
    with conn.cursor() as cur:
        if line_updates:
            update_fields=[f for f in m.LINE_COLUMNS if f not in PROTECTED_LINE_FIELDS]
            cur.executemany('update '+LINE_TABLE+' set production_order_id=%s, '+', '.join(f+'=%s' for f in update_fields)+', updated_at=now() where id=%s',line_updates)
        if ref_updates:
            cur.executemany('update '+LINE_REF_TABLE+' set production_order_line_id=%s where id=%s',ref_updates)
        if ref_inserts:
            cur.executemany('insert into '+LINE_REF_TABLE+' (id,production_order_line_id,source_system,source_id,is_primary,metadata) values (%s,%s,%s,%s,%s,%s)',[(a,b,c,d,e,psycopg_json(f)) for a,b,c,d,e,f in ref_inserts])
        if delete_ids:
            cur.execute('delete from '+LINE_TABLE+' where id=any(%s)',(delete_ids,))
            if cur.rowcount!=len(delete_ids): raise ValueError('Unexpected number of Google duplicate lines deleted')
    # Verify all target mappings and unchanged surrounding evidence before commit.
    for e in entries:
        actual=conn.execute('select to_jsonb(t) from '+LINE_TABLE+' t where id=%s',(e['cold_id'],)).fetchone()
        if not actual: raise ValueError('Consolidated ColdLion line disappeared')
        row=actual[0]
        if row['production_order_id']!=e['google_parent_id']:
            raise ValueError('ColdLion line was not moved to the bound Google header')
        for field in m.LINE_COLUMNS:
            if field=='metadata':
                if m.canonical(row[field])!=m.canonical(e['cold_after'][field]): raise ValueError('Merged line evidence did not persist')
            elif field in PROTECTED_LINE_FIELDS:
                if m.canonical(row.get(field))!=m.canonical(e['cold_before'].get(field)): raise ValueError('Protected ColdLion line field changed')
            elif m.canonical(row.get(field))!=m.canonical(e['cold_after'].get(field)): raise ValueError('Google-owned field did not persist')
    for e in entries:
        refs=conn.execute('select to_jsonb(t) from '+LINE_REF_TABLE+' t where source_system=%s and source_id=%s',('google_order_list',e['google_source_id'])).fetchall()
        if len(refs)!=1 or refs[0][0]['production_order_line_id']!=e['cold_id']:
            raise ValueError('Google source reference did not map to its ColdLion line')
        actual_ref=refs[0][0]
        if e['google_line_ref']:
            expected_ref=transfer_ref(e['google_line_ref'],e['cold_id'])
            for field in ('id','production_order_line_id','source_system','source_id','is_primary','metadata'):
                if m.canonical(actual_ref.get(field))!=m.canonical(expected_ref.get(field)):
                    raise ValueError('Transferred Google source reference changed outside its line owner')
        elif (actual_ref['id']!=missing_ref_uuid(e['google_source_id']) or
              actual_ref.get('is_primary') is not True or actual_ref.get('metadata')!={}):
            raise ValueError('Inserted Google source reference does not match its deterministic plan')
    if delete_ids and conn.execute('select count(*) from '+LINE_TABLE+' where id=any(%s)',(delete_ids,)).fetchone()[0]:
        raise ValueError('Google duplicate rows remain after consolidation')
    if delete_ids and conn.execute('select count(*) from '+SNAPSHOT_TABLE+' where production_order_line_id=any(%s)',(delete_ids,)).fetchone()[0]:
        raise ValueError('Unexpected snapshot appeared on a Google duplicate line')
    for table,key,pk in ((ORDER_TABLE,'orders','id'),(ORDER_REF_TABLE,'order_refs','id'),(TRACKING_TABLE,'tracking','order_id')):
        ids=scoped_primary_keys(pre[key],pk)
        actual=[r[0] for r in conn.execute('select to_jsonb(t) from '+table+' t where '+pk+'=any(%s) order by '+pk,(ids,)).fetchall()] if ids else []
        if actual!=pre[key]: raise ValueError('Header, header-reference, or tracking evidence changed')
    cold_ref_ids=sorted(r['id'] for r in pre['cold_refs'])
    actual_cold_refs=[r[0] for r in conn.execute('select to_jsonb(t) from '+LINE_REF_TABLE+' t where id=any(%s) order by id',(cold_ref_ids,)).fetchall()] if cold_ref_ids else []
    if actual_cold_refs!=pre['cold_refs']:
        raise ValueError('ColdLion source references changed')
    for e in entries:
        actual=conn.execute('select to_jsonb(t) from '+LINE_TABLE+' t where id=%s',(e['cold_id'],)).fetchone()[0]
        for field in ('source_system','source_id','line_number','unit_cost','quantity_shipped','status'):
            if m.canonical(actual.get(field))!=m.canonical(e['cold_before'].get(field)):
                raise ValueError('ColdLion source identity or history field changed')
    expected_counts=dict(pre['counts'])
    expected_counts[LINE_TABLE]-=len(delete_ids)
    expected_counts[LINE_REF_TABLE]+=plan['counts']['missing_google_refs']
    for table, expected in expected_counts.items():
        if conn.execute('select count(*) from '+table).fetchone()[0]!=expected:
            raise ValueError('Consolidation changed an unexpected number of records')


def psycopg_json(value):
    from psycopg.types.json import Jsonb
    return Jsonb(value)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error':'consolidation stopped','kind':type(exc).__name__}),file=sys.stderr)
        raise SystemExit(1) from None
