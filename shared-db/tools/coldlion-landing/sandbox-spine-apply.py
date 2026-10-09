#!/usr/bin/env python3
# Issue #3869: build the ONE-TRANSACTION apply that brings the DesignFlow SANDBOX
# (xupnyeifmpsacrqahwwm, system_identifier 7678069749886157684) coldlion schema to the
# canonical landing shape. Never for shared production or preview.
#
#   python3 tools/coldlion-landing/sandbox-spine-apply.py rehearse|apply OUT.sql
#   psql -X -f OUT.sql          # with PG* pointing at the sandbox
#
# Why a script and not designflow-sandbox-migrations.yml: that route applies only versions
# authored by one source PR, in ascending order, and its general lane hard-blocks
# 20260903200951; this batch must run 20261009191951 FIRST (it frees the names the landing
# migrations create) and replays landing migrations authored by many earlier PRs. Every
# ledger row it writes is for a migration the same transaction executes, with the file's
# exact text (sha256-checked); 20261009170724, already in the sandbox ledger, is re-executed
# (idempotent) so plm.v_prod_order_sales_order_link binds to the new tables. Run it outside
# 05:00-06:00 UTC (the nightly sandbox sync); the loaders also refuse a non-canonical shape.
import hashlib,os,sys,glob
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','supabase','migrations')
D=os.path.normpath(D)
mode=sys.argv[1]  # rehearse|apply
assert mode in ('rehearse','apply')
OUT=sys.argv[2]
V=['20261009191951','20260818232639','20260825023430','20260825225510','20260902054548','20260903200951','20260905014719','20260905024139','20260905104449','20260905104825','20260905105038','20260905142150','20260909194231','20260916001944','20260928211543','20260929093750','20260930212107','20261001122410','20261005025111','20261005044103','20261006004845']
out=['\\set ON_ERROR_STOP 1','set client_min_messages=notice;','begin;',
"do $p$ begin",
"  if (select system_identifier from pg_control_system()) <> 7678069749886157684 then raise exception 'WRONG TARGET: not the DesignFlow sandbox'; end if;",
"  if current_database() <> 'postgres' then raise exception 'unexpected database'; end if;",
"  if to_regtype('ingest.sync_status') is null then raise exception 'prerequisite missing: ingest.sync_status'; end if;",
"  if to_regprocedure('app.set_updated_at()') is null then raise exception 'prerequisite missing: app.set_updated_at()'; end if;",
"  if to_regclass('plm.erp_customer') is null then raise exception 'prerequisite missing: plm.erp_customer'; end if;",
"  if to_regclass('plm.\"ProdOrderHeader\"') is null then raise exception 'prerequisite missing: plm.ProdOrderHeader'; end if;",
"  if to_regclass('plm.v_prod_order_sales_order_link') is null then raise exception 'prerequisite missing: plm.v_prod_order_sales_order_link'; end if;",
"  if not exists (select 1 from supabase_migrations.schema_migrations where version='20261009170724') then raise exception '20261009170724 not in ledger'; end if;",
"  if exists (select 1 from supabase_migrations.schema_migrations where version = any(array[%s])) then raise exception 'a version in this batch is already in the ledger'; end if;" % ','.join("'%s'"%v for v in V),
"  raise notice 'TARGET PROOF OK: system_identifier=%, ledger=% rows', (select system_identifier from pg_control_system()), (select count(*) from supabase_migrations.schema_migrations);",
"end $p$;"]
man=[]
for v in V:
    f=glob.glob(f'{D}/{v}_*.sql'); assert len(f)==1,v; f=f[0]
    name=os.path.basename(f)[15:-4]; body=open(f,encoding='utf8').read()
    h=hashlib.sha256(body.encode()).hexdigest(); man.append(f'{v} {name} {h}')
    tag='$m%s$'%v
    assert tag not in body
    out.append(f"\\echo applying {v}")
    out.append(f"\\i {f}")
    out.append(f"insert into supabase_migrations.schema_migrations(version, name, statements) values ('{v}', '{name}', array[{tag}{body}{tag}]);")
    out.append(f"do $c$ begin if encode(sha256(convert_to((select statements[1] from supabase_migrations.schema_migrations where version='{v}'),'UTF8')),'hex') <> '{h}' then raise exception 'ledger text for {v} differs from the file'; end if; end $c$;")
f=glob.glob(f'{D}/20261009170724_*.sql')[0]
out.append("\\echo re-asserting 20261009170724 (already in the ledger) on the new tables")
out.append(f"\\i {f}")
out.append("""do $post$ begin
  if to_regclass('coldlion_sandbox_copy_20260929.order_history_line') is null then raise exception 'copy not set aside'; end if;
  if (select count(*) from coldlion_sandbox_copy_20260929.order_history_line) <> 116123 then raise exception 'copy row count changed'; end if;
  if not exists (select 1 from pg_attribute where attrelid='coldlion.order_history_line'::regclass and attname='id') then raise exception 'canonical order_history_line missing'; end if;
  if not exists (select 1 from pg_attribute where attrelid='coldlion.order_history_line'::regclass and attname='created_time') then raise exception 'stamp columns missing'; end if;
  if to_regclass('coldlion.history_page_ledger') is null then raise exception 'page ledger missing'; end if;
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid=d.objid join pg_class c on c.oid=d.refobjid
             where r.ev_class='plm.v_prod_order_sales_order_link'::regclass and c.relnamespace='coldlion_sandbox_copy_20260929'::regnamespace)
    then raise exception 'link view still reads the set-aside copy'; end if;
  raise notice 'POST-CHECK OK: ledger=%% rows', (select count(*) from supabase_migrations.schema_migrations);
end $post$;""".replace('%%','%'))
out.append('rollback;' if mode=='rehearse' else 'commit;')
open(OUT,'w').write('\n'.join(out)+'\n')
print('\n'.join(man))
