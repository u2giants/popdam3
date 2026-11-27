-- Contract for #7184 (designflow-backend#278 step 4.3a): both HTS runtime roles read
-- hts_rag.hts_rag_ruling_links and can neither insert, update nor delete it.

-- Catalog: SELECT only, plus one select policy per runtime role.
do $links_runtime_catalog$
declare
  v_role text;
begin
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
    if not has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_links', 'SELECT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_links', 'INSERT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_links', 'DELETE')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_links', 'TRUNCATE')
       or has_any_column_privilege(v_role, 'hts_rag.hts_rag_ruling_links', 'UPDATE') then
      raise exception '% must only read hts_rag.hts_rag_ruling_links', v_role;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_links'
                    and cmd = 'SELECT' and roles = array[v_role::name] and qual = 'true') then
      raise exception '% has no select policy on hts_rag.hts_rag_ruling_links', v_role;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_links'
                and cmd <> 'SELECT' and v_role::name = any (roles)) then
      raise exception '% has a write policy on hts_rag.hts_rag_ruling_links', v_role;
    end if;
  end loop;
end
$links_runtime_catalog$;

-- Behaviour: a worker-written link is visible to each runtime role; every write is refused.
begin;
-- Test-only membership so the CI session can SET ROLE; rolled back with the transaction.
grant designflow_hts_alsand_worker, designflow_hts_prod_runtime, designflow_hts_alsand_runtime to postgres;
insert into hts_rag.hts_rag_rulings (ruling_number, full_text, full_text_hash, ruling_date, source_environment)
  values ('ZL7184', 'Ruling ZL7184 revokes ruling ZL7185.',
          encode(sha256(convert_to('Ruling ZL7184 revokes ruling ZL7185.', 'UTF8')), 'hex'),
          '2020-01-01', 'alsand');
set local role designflow_hts_alsand_worker;
insert into hts_rag.hts_rag_ruling_links (from_ruling, to_ruling, kind, link_source, source_environment)
  values ('ZL7184', 'ZL7185', 'revokes', 'text', 'alsand');
reset role;

set local role designflow_hts_prod_runtime;
do $links_prod_runtime$ begin
  if not exists (select 1 from hts_rag.hts_rag_ruling_links
                  where from_ruling = 'ZL7184' and to_ruling = 'ZL7185' and kind = 'revokes') then
    raise exception 'prod runtime cannot see the ruling link';
  end if;
  begin
    insert into hts_rag.hts_rag_ruling_links (from_ruling, to_ruling, kind, link_source, source_environment)
      values ('ZL7184', 'ZL7186', 'cites', 'text', 'production');
    raise exception 'prod runtime inserted a ruling link';
  exception when insufficient_privilege then null;
  end;
  begin
    update hts_rag.hts_rag_ruling_links set product_label = 'x' where from_ruling = 'ZL7184';
    raise exception 'prod runtime updated a ruling link';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from hts_rag.hts_rag_ruling_links where from_ruling = 'ZL7184';
    raise exception 'prod runtime deleted a ruling link';
  exception when insufficient_privilege then null;
  end;
end $links_prod_runtime$;
reset role;

set local role designflow_hts_alsand_runtime;
do $links_alsand_runtime$ begin
  if not exists (select 1 from hts_rag.hts_rag_ruling_links
                  where from_ruling = 'ZL7184' and to_ruling = 'ZL7185' and kind = 'revokes') then
    raise exception 'alsand runtime cannot see the ruling link';
  end if;
  begin
    insert into hts_rag.hts_rag_ruling_links (from_ruling, to_ruling, kind, link_source, source_environment)
      values ('ZL7184', 'ZL7186', 'cites', 'text', 'alsand');
    raise exception 'alsand runtime inserted a ruling link';
  exception when insufficient_privilege then null;
  end;
  begin
    update hts_rag.hts_rag_ruling_links set product_label = 'x' where from_ruling = 'ZL7184';
    raise exception 'alsand runtime updated a ruling link';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from hts_rag.hts_rag_ruling_links where from_ruling = 'ZL7184';
    raise exception 'alsand runtime deleted a ruling link';
  exception when insufficient_privilege then null;
  end;
end $links_alsand_runtime$;
reset role;
rollback;
