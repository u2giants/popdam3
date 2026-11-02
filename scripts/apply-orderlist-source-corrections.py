#!/usr/bin/env python3
"""Exact-source OrderList repair packet. Read-only dry run unless --apply.

Private manifests and recovery receipts must stay outside the repository.
This changes ordinary app row data, never schema or raw ColdLion observations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import uuid

TARGET = 'qsllyeztdwjgirsysgai'
KINDS = {'void_superseded', 'google_customer_po', 'coldlion_identity','mark_source_cancelled'}


def validate_manifest(plan):
    if plan.get('version') != 1 or plan.get('project_ref') != TARGET or not plan.get('evidence_ref'):
        raise ValueError('Exact production target and evidence reference are required')
    preimages = {str(uuid.UUID(x['line']['id'])): x for x in plan['preimages']}
    if len(preimages) != len(plan['preimages']):
        raise ValueError('Duplicate preimage identity')
    seen = set()
    for op in plan['operations']:
        key = (op['kind'], op['line_id'])
        if op['kind'] not in KINDS or op['line_id'] not in preimages or key in seen:
            raise ValueError('Operation has no unique exact preimage')
        seen.add(key)
        old = preimages[op['line_id']]
        refs = old['refs'] or []
        if op['kind'] == 'void_superseded':
            if not op.get('replacement_source_ids') or not op.get('reason') or old['line']['voided_at']:
                raise ValueError('Supersession requires active line, replacements and reason')
            if len([r for r in refs if r['source_system'] == 'coldlion']) != 1 or any(r['source_system'] != 'coldlion' for r in refs):
                raise ValueError('Only unmerged ColdLion source versions may be superseded')
        elif op['kind'] == 'google_customer_po':
            if not op.get('customer_po_number') or not op.get('source_id'):
                raise ValueError('Google correction requires exact source ID and replacement PO')
            if not any(r['source_system'] == 'google_order_list' and r['source_id'] == op['source_id'] for r in refs):
                raise ValueError('Google source reference mismatch')
        elif op['kind']=='mark_source_cancelled':
            c=op['cancellation']
            if (c.get('version')!=1 or not c.get('evidence_ref')
                    or not isinstance(c.get('line_qty'),(int,float)) or c['line_qty']<=0
                    or not isinstance(c.get('line_cancelled_qty'),(int,float)) or c['line_cancelled_qty']<c['line_qty']
                    or not any(r['source_system']=='coldlion' and r['source_id']==c.get('source_id') for r in refs)):
                raise ValueError('Cancellation requires exact source reference and fully cancelled source quantities')
        else:
            c = op['correction']
            required = {'version','source_id','original_sku','canonical_sku','original_customer_po','canonical_customer_po','evidence_ref'}
            if set(c) != required or c['version'] != 1 or not all(isinstance(c[k], str) and c[k].strip() for k in required - {'version'}):
                raise ValueError('ColdLion correction must bind exact original and corrected source cells')
            if not any(r['source_system'] == 'coldlion' and r['source_id'] == c['source_id'] for r in refs):
                raise ValueError('ColdLion source reference mismatch')
    return preimages


def target_proof(conn):
    if (conn.info.host != 'aws-1-us-east-1.pooler.supabase.com' or
            conn.info.user != 'postgres.' + TARGET or conn.info.port not in (5432,6543) or
            conn.execute('select current_database()').fetchone()[0] != 'postgres'):
        raise ValueError('Database target mismatch')


def verify_preimages(conn, preimages, lock=False):
    for key, expected in sorted(preimages.items()):
        line = conn.execute('select to_jsonb(l) from plm.production_order_line l where id=%s' + (' for update' if lock else ''), (key,)).fetchone()
        if not line or line[0] != expected['line']:
            raise ValueError('Line preimage changed; regenerate private manifest')
        header = conn.execute('select to_jsonb(h) from plm.production_order h where id=%s' + (' for update' if lock else ''), (expected['header']['id'],)).fetchone()
        if not header or header[0] != expected['header']:
            raise ValueError('Header preimage changed; regenerate private manifest')
        refs = conn.execute('select to_jsonb(r) from plm.production_order_line_source_ref r where production_order_line_id=%s order by id' + (' for update' if lock else ''), (key,)).fetchall()
        if [r[0] for r in refs] != sorted(expected['refs'] or [], key=lambda r:r['id']):
            raise ValueError('Source reference preimage changed; regenerate private manifest')


def source_identity(conn, ref, cancellation=False):
    parts=ref['source_id'].split(':')
    if len(parts)!=7 or parts[0:2]!=['coldlion','so'] or parts[3]!='line' or parts[5]!='component':
        raise ValueError('ColdLion source identity malformed')
    # Actual observation time chooses the winner. fetched_at is insert-only.
    cancellation_fields=',v.line_qty,v.line_cancelled_qty' if cancellation else ''
    return conn.execute(f'''with v as (
      select l.*,rank() over(partition by l.sales_order_no,l.sales_order_line_no
        order by r.started_at desc nulls last,l.last_seen_run desc) winner
      from coldlion.intake_order_line l left join coldlion.sync_run r on r.id=l.last_seen_run
      where l.sales_order_no=%s and l.sales_order_line_no=%s)
      select distinct coalesce(nullif(btrim(c.sub_item_no),''),v.master_item_no),v.po_number{cancellation_fields}
      from v join coldlion.intake_order_component c on c.line_id=v.id
      where winner=1 and v.division_code is distinct from 'EP001'
        and v.master_item_no=%s and nullif(c.sub_item_no,'') is not distinct from %s
        and nullif(c.sub_label_code,'') is not distinct from %s''',
      (int(parts[2]),int(parts[4]),ref['metadata'].get('master_item_no'),ref['metadata'].get('sub_item_no'),ref['metadata'].get('sub_label_code'))).fetchall()


def google_source_cells(snapshot):
    import importlib.util
    spec=importlib.util.spec_from_file_location('orderlist_refresh_packet',Path(__file__).with_name('refresh-google-orderlist-rows.py'))
    refresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(refresh)
    parsed=refresh.m.build_plan(refresh.source_rows(snapshot),refresh.m.MasterDataCatalog())
    return {line.source_id:{k:line.payload.get(k) for k in ('sku','customer_po_number')}
      for line in parsed.writable_lines()}


def verify_sources(conn, plan, preimages, google_snapshot=None):
    google_cells=google_source_cells(google_snapshot) if google_snapshot else {}
    google_digest=hashlib.sha256(google_snapshot.read_bytes()).hexdigest() if google_snapshot else None
    for op in plan['operations']:
        old=preimages[op['line_id']]
        if op['kind']=='google_customer_po':
            # The raw Google source must be separately captured before building the
            # manifest; bind its exact cell tuple and digest in the packet.
            source=op['source_cells']
            if source != {'sku':old['line']['sku'],'customer_po_number':old['line']['customer_po_number']}:
                raise ValueError('Google original cells differ from canonical preimage')
            if (not google_digest or google_digest!=op.get('source_snapshot_sha256')
                    or google_cells.get(op['source_id'])!=source):
                raise ValueError('Current Google source snapshot and exact cells required')
            continue
        ref=next(r for r in old['refs'] if r['source_system']=='coldlion')
        current=source_identity(conn,ref,cancellation=op['kind']=='mark_source_cancelled')
        if op['kind']=='mark_source_cancelled':
            c=op['cancellation']
            expected=(old['line']['sku'],old['line']['customer_po_number'],c['line_qty'],c['line_cancelled_qty'])
            if current != [expected]:
                raise ValueError('Source cancellation changed or ambiguous; held without changes')
        elif op['kind']=='coldlion_identity':
            c=op['correction']
            if current != [(c['original_sku'],c['original_customer_po'])]:
                raise ValueError('ColdLion correction source cells changed or ambiguous')
        else:
            if current:
                raise ValueError('Superseded source is present in current observation; held')
            for source_id in op['replacement_source_ids']:
                result=conn.execute('''select to_jsonb(r) from plm.production_order_line_source_ref r
                  join plm.production_order_line l on l.id=r.production_order_line_id
                  where r.source_system='coldlion' and r.source_id=%s and l.voided_at is null''',(source_id,)).fetchall()
                if len(result)!=1 or not source_identity(conn,result[0][0]):
                    raise ValueError('Current replacement source is absent or ambiguous')


def apply_operations(conn, plan, preimages):
    from psycopg.types.json import Jsonb
    for op in plan['operations']:
        target_proof(conn)
        old=preimages[op['line_id']]['line']
        if op['kind']=='void_superseded':
            conn.execute('''update plm.production_order_line set voided_at=now(),void_reason=%s,
              metadata=metadata || jsonb_build_object('orderlist_supersession',%s::jsonb),updated_at=now() where id=%s''',
              (op['reason'],Jsonb({'evidence_ref':plan['evidence_ref'],'replacement_source_ids':op['replacement_source_ids']}),op['line_id']))
        elif op['kind']=='google_customer_po':
            correction={'version':1,'source_id':op['source_id'],'original':op['source_cells'],
              'corrected':{'sku':old['sku'],'customer_po_number':op['customer_po_number']},'evidence_ref':plan['evidence_ref']}
            conn.execute('''update plm.production_order_line set customer_po_number=%s,
              metadata=metadata || jsonb_build_object('orderlist_google_correction',%s::jsonb),updated_at=now() where id=%s''',
              (op['customer_po_number'],Jsonb(correction),op['line_id']))
        elif op['kind']=='mark_source_cancelled':
            conn.execute("""update plm.production_order_line set status='cancelled',
              metadata=metadata || jsonb_build_object('orderlist_source_cancellation',%s::jsonb),
              updated_at=now() where id=%s""",(Jsonb(op['cancellation']),op['line_id']))
        else:
            conn.execute('''update plm.production_order_line_source_ref set metadata=metadata ||
              jsonb_build_object('orderlist_source_correction',%s::jsonb)
              where production_order_line_id=%s and source_system='coldlion' and source_id=%s''',
              (Jsonb(op['correction']),op['line_id'],op['correction']['source_id']))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--receipt',type=Path,required=True)
    p.add_argument('--apply',action='store_true')
    p.add_argument('--google-source-snapshot',type=Path)
    args=p.parse_args()
    if args.receipt.exists(): raise ValueError('Recovery receipt already exists')
    plan=json.loads(args.manifest.read_text());preimages=validate_manifest(plan)
    import psycopg
    with psycopg.connect(host='aws-1-us-east-1.pooler.supabase.com',port=5432,user='postgres.'+TARGET,
      dbname='postgres',password=os.environ['PGPASSWORD'],sslmode='require',
      options='-c statement_timeout=15000') as conn:
        conn.execute('set transaction isolation level serializable' if args.apply else 'set transaction read only')
        target_proof(conn);verify_preimages(conn,preimages,lock=args.apply);verify_sources(conn,plan,preimages,args.google_source_snapshot)
        receipt={'mode':'apply' if args.apply else 'read_only_dry_run','manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
          'recovery_preimages':plan['preimages'],'operations':plan['operations']}
        args.receipt.parent.mkdir(parents=True,exist_ok=True)
        with args.receipt.open('x') as f:
            os.chmod(args.receipt,0o600);json.dump(receipt,f,indent=2)
        if args.apply:apply_operations(conn,plan,preimages)
        else:conn.rollback()
    print('Verified exact correction packet; operations:',len(plan['operations']),'; mode:',receipt['mode'])

if __name__=='__main__':main()
