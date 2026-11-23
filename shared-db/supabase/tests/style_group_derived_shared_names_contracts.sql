-- popcre/shared-db#6997 (N1): style-group licensor/property/customer names are
-- derived from the linked core records.
--
-- HOW IT IS RUN
--   .github/workflows/database-contract-tests.yml executes every supabase/tests/*.sql
--   against a THROWAWAY local Supabase stack inside `begin; ... rollback;`.
-- Every value here is invented (ZZTEST codes/names).

-- Canonical licensing writes need a single-use, exact-column, transaction-bound
-- authorization (app.enforce_licensing_write_authority). Synthetic, this
-- transaction only.
create function pg_temp.n1_auth(p_table regclass, p_cols text[]) returns void
language sql as $f$
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), p_table, 'canonical_merge', gen_random_uuid(), repeat('c',64),
          'n1-contract-test', p_cols, clock_timestamp() + interval '5 minutes');
$f$;

do $$
declare
  v_lic uuid;
  v_lic2 uuid;
  v_prop uuid;
  v_cust uuid;
  v_sg uuid;
  r record;
begin
  perform pg_temp.n1_auth('core.licensor', array['name','code','status']);
  insert into core.licensor (name, code) values ('ZZTEST Licensor', 'Z9') returning id into v_lic;
  perform pg_temp.n1_auth('core.licensor', array['name','code','status']);
  insert into core.licensor (name, code) values ('ZZTEST Other', 'Z8') returning id into v_lic2;
  perform pg_temp.n1_auth('core.property', array['licensor_id','name','code','status']);
  insert into core.property (licensor_id, name, code) values (v_lic, 'ZZTEST Property', 'ZP') returning id into v_prop;
  insert into core.customer (name, display_name) values ('ZZTEST Cust Inc', 'ZZTEST Cust') returning id into v_cust;

  -- 1. Insert: copied names are ignored and derived from the ids.
  insert into public.style_groups (sku, folder_path, licensor_id, licensor_name, licensor_code,
                                   property_id, property_name, property_code, customer_id, customer)
  values ('ZZTEST-SKU-1', '/zztest/1', v_lic, 'WRONG', 'XX', v_prop, 'WRONG', 'XX', v_cust, 'WRONG')
  returning id into v_sg;
  select * into r from public.style_groups where id = v_sg;
  if r.licensor_name <> 'ZZTEST Licensor' or r.licensor_code <> 'Z9'
     or r.property_name <> 'ZZTEST Property' or r.property_code <> 'ZP'
     or r.customer <> 'ZZTEST Cust' then
    raise exception 'N1-1: insert did not derive names: % % % % %',
      r.licensor_name, r.licensor_code, r.property_name, r.property_code, r.customer;
  end if;

  -- 2. Writing a name directly is reset to the shared name.
  update public.style_groups set property_name = 'STALE' where id = v_sg;
  if (select property_name from public.style_groups where id = v_sg) <> 'ZZTEST Property' then
    raise exception 'N1-2: direct name write was not reset';
  end if;

  -- 3. Id change re-derives.
  update public.style_groups set licensor_id = v_lic2 where id = v_sg;
  select * into r from public.style_groups where id = v_sg;
  if r.licensor_name <> 'ZZTEST Other' or r.licensor_code <> 'Z8' then
    raise exception 'N1-3: id change did not re-derive: % %', r.licensor_name, r.licensor_code;
  end if;

  -- 4. Upstream renames propagate.
  perform pg_temp.n1_auth('core.licensor', array['name','code']);
  update core.licensor set name = 'ZZTEST Other Renamed', code = 'Z7' where id = v_lic2;
  perform pg_temp.n1_auth('core.property', array['name']);
  update core.property set name = 'ZZTEST Property Renamed' where id = v_prop;
  update core.customer set display_name = 'ZZTEST Cust Renamed' where id = v_cust;
  select * into r from public.style_groups where id = v_sg;
  if r.licensor_name <> 'ZZTEST Other Renamed' or r.licensor_code <> 'Z7'
     or r.property_name <> 'ZZTEST Property Renamed'
     or r.customer <> 'ZZTEST Cust Renamed' then
    raise exception 'N1-4: upstream rename did not propagate: % % % %',
      r.licensor_name, r.licensor_code, r.property_name, r.customer;
  end if;

  -- 5. Rows without ids keep their text.
  insert into public.style_groups (sku, folder_path, licensor_name, property_name, customer)
  values ('ZZTEST-SKU-2', '/zztest/2', 'Free Text Lic', 'Free Text Prop', 'Free Text Cust')
  returning id into v_sg;
  select * into r from public.style_groups where id = v_sg;
  if r.licensor_name <> 'Free Text Lic' or r.property_name <> 'Free Text Prop'
     or r.customer <> 'Free Text Cust' then
    raise exception 'N1-5: id-less row text was changed';
  end if;
end $$;
