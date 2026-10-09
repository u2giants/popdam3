#!/usr/bin/env python3
"""Source-bound, reviewed refresh of application OrderList rows, without DDL.

Uses the canonical importer's pure source parser. Its historical first-import CLI
and pinned workbook are deliberately left intact. This is a separate refresh.
"""
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'qsllyeztdwjgirsysgai'
SOURCE_ID = '1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk'
TABLES = ('plm.production_order', 'plm.production_order_line',
          'plm.production_order_source_ref', 'plm.production_order_line_source_ref')
SPEC = importlib.util.spec_from_file_location('source_import',ROOT/'shared-db/scripts/import-order-list-xlsx.py')
m = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = m
SPEC.loader.exec_module(m)
ORDER_FIELDS=(*m.ORDER_COLUMNS,'company_id','factory_id')


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()


def normalized(value):
    return ('' if value is None else str(value)).strip().casefold()


def source_rows(path):
    rows=json.loads(path.read_text())
    if len(rows)!=12925 or any(len(r)!=48 for r in rows):
        raise ValueError('Source range must be exactly Order!A1:AV12925')
    for index,expected in {0:'PO Status',1:'Import',13:'Customer',14:'Assortment',15:'Style#',20:'Quantity',21:'Case'}.items():
        if expected not in rows[0][index]:
            raise ValueError('Source header contract changed')
    return [m.SourceRow(sheet_row=i,values=tuple(row)) for i,row in enumerate(rows[1:],2)]


def merged_payload(old,desired,metadata,columns):
    result={key:desired.get(key) for key in columns}
    prior=(old or {}).get('metadata') or {}
    result['metadata']={**prior,**metadata}
    if old and 'order_list_snapshot' in prior:
        result['metadata']['original_order_list_snapshot']=prior.get('original_order_list_snapshot',prior['order_list_snapshot'])
    if old and 'sku' in columns and normalized(old['sku'])==normalized(desired.get('sku')):
        # Preserve an established item link and its decision; the sheet has no
        # authority to turn a confirmed product relationship into a weaker guess.
        if old.get('item_id'):
            result['item_id']=old['item_id']
            result['master_data_match_status']=old['master_data_match_status']
    return result




def resolve_case_only_header_conflicts(plan,rows):
    source={row.sheet_row:row for row in rows}
    fields={m.COL_COMPANY:'ordering_company',m.COL_ORDER_VENDOR:'order_vendor_name',
            m.COL_VENDOR_ID:'vendor_id_raw',m.COL_CUSTOMER:'customer_name'}
    for order in plan.orders:
        if not order.quarantined:continue
        remaining=[]
        for reason in order.quarantine_reasons:
            column=reason.split(':')[-1]
            values=[source[i].text(column) for i in order.sheet_rows]
            values=[v for v in values if v is not None]
            if len({normalized(v) for v in values})!=1:
                remaining.append(reason);continue
            if column==m.COL_PO_STATUS:order.payload['status']=values[0]
            else:order.metadata[fields[column]]=values[0]
        order.quarantine_reasons=remaining
        if not remaining:
            order.quarantined=False
            plan.counters['quarantined_orders']-=1
            plan.counters['quarantined_rows']-=len(order.sheet_rows)


def order_payload(old,order):
    result=merged_payload(old,order.payload,order.metadata,ORDER_FIELDS)
    prior=(old or {}).get('metadata') or {}
    same_customer=normalized(prior.get('customer_name'))==normalized(order.metadata.get('customer_name'))
    old_vendor=prior.get('vendor_id_raw') or prior.get('order_vendor_name')
    new_vendor=order.metadata.get('vendor_id_raw') or order.metadata.get('order_vendor_name')
    result['company_id']=old.get('company_id') if old and same_customer else None
    result['factory_id']=old.get('factory_id') if old and normalized(old_vendor)==normalized(new_vendor) else None
    return result


def changed_fields(desired,current):
    comparable=dict(current)
    for field in ('quantity_ordered','order_depth_inches','case_pack','cases_reported'):
        if comparable.get(field) is not None:
            comparable[field]=Decimal(str(comparable[field]))
    return m.payload_differs(desired,comparable)


def overlap_key(row):
    # A matching business tuple is a candidate, not permission to merge orders.
    fields=(row.get('customer_po_number'),row.get('sku'),row.get('quantity_ordered'))
    if any(v is None or not str(v).strip() for v in fields):
        return None
    quantity=Decimal(str(fields[2]))
    if not quantity.is_finite():return None
    return normalized(fields[0]),normalized(fields[1]),str(quantity.normalize())


def prove(conn):
    if (conn.info.host!='aws-1-us-east-1.pooler.supabase.com' or
        conn.info.user!='postgres.'+TARGET or conn.info.port!=5432 or
        conn.execute('select current_database()').fetchone()[0]!='postgres'):
        raise ValueError('Production connection mismatch')


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--source',type=Path,required=True)
    p.add_argument('--expected-sha256',required=True)
    p.add_argument('--password-file',type=Path,required=True)
    p.add_argument('--recovery-dir',type=Path,required=True)
    p.add_argument('--apply',action='store_true')
    p.add_argument('--reviewer-approval',type=Path)
    args=p.parse_args()
    if hashlib.sha256(args.source.read_bytes()).hexdigest()!=args.expected_sha256:
        raise ValueError('Source checksum mismatch')
    rows=source_rows(args.source)
    args.recovery_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    if args.recovery_dir.stat().st_mode & 0o077:
        raise ValueError('Recovery directory is not private')
    import psycopg
    from psycopg.types.json import Jsonb
    conn=psycopg.connect(host='aws-1-us-east-1.pooler.supabase.com',port=5432,
        user='postgres.'+TARGET,dbname='postgres',password=args.password_file.read_text().rstrip('\r\n'),connect_timeout=15)
    try:
        conn.isolation_level=psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only=not args.apply
        if args.apply:
            if not args.reviewer_approval:raise ValueError('Independent review required')
            subprocess.run(['ai-task-gates','check','--before','database','--reviewer-approval',str(args.reviewer_approval)],cwd=ROOT,check=True)
            # Acquire table locks before the first SELECT establishes the
            # repeatable-read snapshot. A try-lock prevents reversed lock order
            # from deadlocking the legacy first-import routine.
            conn.execute('lock table '+', '.join(TABLES)+' in exclusive mode')
            if not conn.execute('select pg_try_advisory_xact_lock(852000727)').fetchone()[0]:
                raise ValueError('Another OrderList import is active')
        prove(conn)
        before={table:conn.execute('select to_jsonb(t) from '+table+' t order by id').fetchall() for table in TABLES}
        records={table:{r[0]['id']:r[0] for r in data} for table,data in before.items()}
        catalog=m.load_master_data_catalog(conn)
        # Duplicate tracker rows pointing to the same item do not create a tie.
        for key,ids in list(catalog.rows.items()):
            items={catalog.item_ids.get(rowid) for rowid in ids}
            if len(items)==1 and None not in items:catalog.rows[key]=[ids[0]]
        source_plan=m.build_plan(rows,catalog)
        resolve_case_only_header_conflicts(source_plan,rows)
        orders=records[TABLES[0]];lines=records[TABLES[1]]
        orefs={r['source_id']:r['production_order_id'] for r in records[TABLES[2]].values() if r['source_system']==m.SOURCE_SYSTEM}
        lrefs={r['source_id']:r['production_order_line_id'] for r in records[TABLES[3]].values() if r['source_system']==m.SOURCE_SYSTEM}
        cold_refs={r['production_order_line_id'] for r in records[TABLES[3]].values() if r['source_system']=='coldlion'}
        cold={key:lines[key] for key in cold_refs}
        cold_index=defaultdict(list)
        for row in cold.values():
            key=overlap_key(row)
            if key:cold_index[key].append(row['id'])
        desired_orders={};desired_lines={};held=[]
        for order in source_plan.writable_orders():
            old=orders.get(orefs.get(order.source_id))
            desired_orders[order.source_id]=order_payload(old,order)
        for line in source_plan.writable_lines():
            old=lines.get(lrefs.get(line.source_id))
            if old and old['id'] in cold_refs:
                held.append({'source_id':line.source_id,'reason':'shared_coldlion_line'});continue
            if old is None and overlap_key(line.payload) in cold_index:
                held.append({'source_id':line.source_id,'reason':'new_cross_source_overlap','coldlion_ids':cold_index[overlap_key(line.payload)]});continue
            desired_lines[line.source_id]={'order_source_id':line.order_source_id,'payload':merged_payload(old,line.payload,line.metadata,m.LINE_COLUMNS)}
        changes={'orders_inserted':0,'orders_updated':0,'lines_inserted':0,'lines_updated':0}
        for sid,payload in desired_orders.items():
            old=orders.get(orefs.get(sid));changes['orders_inserted' if old is None else 'orders_updated']+=int(old is None or bool(changed_fields(payload,old)))
        for sid,entry in desired_lines.items():
            old=lines.get(lrefs.get(sid));payload=entry['payload']
            moved=old is not None and old['production_order_id']!=orefs.get(entry['order_source_id'])
            changes['lines_inserted' if old is None else 'lines_updated']+=int(old is None or moved or bool(changed_fields(payload,old)))
        plan={'target':TARGET,'source_workbook_id':SOURCE_ID,'source_sha256':args.expected_sha256,
            'database_digest':digest(before),'catalog_digest':digest({'rows':sorted((list(k),v) for k,v in catalog.rows.items()),'item_ids':catalog.item_ids}),
            'desired_digest':digest([desired_orders,desired_lines]),'source_counts':source_plan.counters,
            'held_new_lines':len(held),'changes':changes}
        plan_file=args.recovery_dir/'plan.json';recovery=args.recovery_dir/'preimages.json'
        if not args.apply:
            if plan_file.exists():raise ValueError('Recovery evidence already exists')
            recovery.write_text(json.dumps(before,default=str));plan_file.write_text(json.dumps(plan,indent=2))
            (args.recovery_dir/'withheld-source.json').write_text(json.dumps({'orders':[vars(o) for o in source_plan.orders if o.quarantined],'rows':[vars(r) for r in source_plan.rejected_rows],'new_overlaps':held},default=str))
            conn.rollback();print(json.dumps(plan));return
        if not recovery.exists() or digest(json.loads(recovery.read_text()))!=digest(before) or json.loads(plan_file.read_text())!=plan:
            raise ValueError('Reviewed source, database, catalog, or recovery changed')
        prove(conn)
        oidmap=dict(orefs);new_order_values=[];new_order_refs=[];order_updates=[]
        for sid,payload in desired_orders.items():
            old=orders.get(orefs.get(sid))
            vals=m.PostgresGateway._bind(payload,ORDER_FIELDS)
            if old is None:
                oidmap[sid]=str(uuid.uuid4());new_order_values.append([oidmap[sid],*vals]);new_order_refs.append([oidmap[sid],m.SOURCE_SYSTEM,sid,True])
            elif changed_fields(payload,old):order_updates.append([*vals,old['id']])
        new_line_values=[];new_line_refs=[];line_updates=[];expected_line_ids={}
        for sid,entry in desired_lines.items():
            payload=entry['payload'];old=lines.get(lrefs.get(sid));parent=oidmap[entry['order_source_id']]
            vals=m.PostgresGateway._bind(payload,m.LINE_COLUMNS)
            if old is None:
                lid=str(uuid.uuid4());new_line_values.append([lid,parent,*vals]);new_line_refs.append([lid,m.SOURCE_SYSTEM,sid,True]);expected_line_ids[sid]=lid
            else:
                expected_line_ids[sid]=old['id']
                if old['production_order_id']!=parent or changed_fields(payload,old):line_updates.append([parent,*vals,old['id']])
        with conn.cursor() as cur:
            for table,columns,values in [(TABLES[0],('id',*ORDER_FIELDS),new_order_values),(TABLES[2],('production_order_id','source_system','source_id','is_primary'),new_order_refs),(TABLES[1],('id','production_order_id',*m.LINE_COLUMNS),new_line_values),(TABLES[3],('production_order_line_id','source_system','source_id','is_primary'),new_line_refs)]:
                if values:cur.executemany('insert into '+table+' ('+', '.join(columns)+') values ('+', '.join(['%s']*len(columns))+')',values)
            if order_updates:cur.executemany('update '+TABLES[0]+' set '+', '.join(c+'=%s' for c in ORDER_FIELDS)+', updated_at=now() where id=%s',order_updates)
            if line_updates:cur.executemany('update '+TABLES[1]+' set production_order_id=%s, '+', '.join(c+'=%s' for c in m.LINE_COLUMNS)+', updated_at=now() where id=%s',line_updates)
        after_orders={r[0]['id']:r[0] for r in conn.execute('select to_jsonb(t) from '+TABLES[0]+' t').fetchall()}
        after_lines={r[0]['id']:r[0] for r in conn.execute('select to_jsonb(t) from '+TABLES[1]+' t').fetchall()}
        if any(after_lines[key]!=value for key,value in cold.items()):raise ValueError('ColdLion line changed')
        if any(after_orders[key]!=orders[key] for key in {r['production_order_id'] for r in cold.values()}):raise ValueError('ColdLion header changed')
        if len(after_lines)!=len(lines)+changes['lines_inserted']:raise ValueError('Line count mismatch')
        if len(after_orders)!=len(orders)+changes['orders_inserted']:raise ValueError('Order count mismatch')
        for sid,entry in desired_lines.items():
            actual=after_lines[expected_line_ids[sid]]
            if changed_fields(entry['payload'],actual) or actual['production_order_id']!=oidmap[entry['order_source_id']]:raise ValueError('Source line verification failed')
        for sid,payload in desired_orders.items():
            if changed_fields(payload,after_orders[oidmap[sid]]):raise ValueError('Source header verification failed')
        conn.commit();(args.recovery_dir/'result.json').write_text(json.dumps(plan,indent=2));print(json.dumps({'applied':changes,'held_new_lines':len(held),'coldlion_preserved':len(cold)}))
    finally:conn.close()


if __name__=='__main__':
    os.umask(0o077)
    main()
