-- #1090 Step 1.0: protect canonical licensing identity before consolidation.

create table plm.licensing_write_authorization (
  id uuid primary key default gen_random_uuid(),
  backend_pid integer not null,
  transaction_id bigint not null,
  target_table regclass not null check (target_table in ('core.licensor'::regclass, 'core.property'::regclass)),
  write_kind text not null check (write_kind in ('scrape_consolidation', 'licensing_review_create', 'coldlion_status', 'canonical_merge')),
  plan_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  actor text not null check (btrim(actor) <> ''),
  protected_columns text[] not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash)
);

create table plm.licensing_write_guard_audit (
  id bigint generated always as identity primary key,
  authorization_id uuid not null references plm.licensing_write_authorization(id) on delete restrict,
  target_table regclass not null,
  operation text not null,
  write_kind text not null,
  protected_columns text[] not null,
  plan_id uuid not null,
  plan_hash text not null,
  actor text not null,
  recorded_at timestamptz not null default clock_timestamp()
);

revoke all on plm.licensing_write_authorization, plm.licensing_write_guard_audit from public, anon, authenticated, service_role;

create or replace function app.enforce_licensing_write_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app, core, plm
as $$
declare
  v_changed text[] := '{}'::text[];
  v_auth plm.licensing_write_authorization%rowtype;
begin
  if tg_table_name = 'licensor' then
    if tg_op = 'INSERT' or new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if tg_op = 'INSERT' or new.code is distinct from old.code then v_changed := array_append(v_changed, 'code'); end if;
    if tg_op = 'INSERT' or new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
  elsif tg_table_name = 'property' then
    if tg_op = 'INSERT' or new.licensor_id is distinct from old.licensor_id then v_changed := array_append(v_changed, 'licensor_id'); end if;
    if tg_op = 'INSERT' or new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if tg_op = 'INSERT' or new.code is distinct from old.code then v_changed := array_append(v_changed, 'code'); end if;
    if tg_op = 'INSERT' or new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
  end if;
  if cardinality(v_changed) = 0 then return new; end if;

  select * into v_auth
  from plm.licensing_write_authorization a
  where a.backend_pid = pg_backend_pid()
    and a.transaction_id = txid_current()
    and a.target_table = tg_relid
    and a.expires_at > clock_timestamp()
    and a.consumed_at is null
    and a.protected_columns @> v_changed
    and v_changed @> a.protected_columns
  order by a.created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'licensing canonical write refused: no exact transaction-bound authorization for %.% columns %', tg_table_schema, tg_table_name, v_changed;
  end if;
  if v_auth.write_kind = 'coldlion_status' and (tg_table_name <> 'property' or v_changed <> array['status']::text[] or new.status not in ('active','inactive')) then
    raise exception 'coldlion_status authorization may change only Property status to active or inactive';
  end if;
  if v_auth.write_kind in ('scrape_consolidation','licensing_review_create') and tg_table_name = 'property' and tg_op = 'INSERT' and new.status <> 'potential' then
    raise exception '% authorization must create Property as potential', v_auth.write_kind;
  end if;
  if v_auth.write_kind = 'scrape_consolidation' and tg_table_name = 'property' and tg_op = 'UPDATE' and new.status is distinct from old.status then
    raise exception 'scrape_consolidation cannot change matched Property status';
  end if;

  insert into plm.licensing_write_guard_audit
    (authorization_id, target_table, operation, write_kind, protected_columns, plan_id, plan_hash, actor)
  values (v_auth.id, tg_relid, tg_op, v_auth.write_kind, v_changed, v_auth.plan_id, v_auth.plan_hash, v_auth.actor);
  update plm.licensing_write_authorization
  set consumed_at = clock_timestamp()
  where id = v_auth.id;
  return new;
end;
$$;

revoke all on function app.enforce_licensing_write_authority() from public;

create trigger licensor_licensing_write_guard before insert or update on core.licensor
for each row execute function app.enforce_licensing_write_authority();
create trigger property_licensing_write_guard before insert or update on core.property
for each row execute function app.enforce_licensing_write_authority();

create or replace function plm.import_master_data(licensors_payload jsonb, customers_payload jsonb)
returns table (sync_run_id uuid, licensors_seen integer, properties_seen integer, customers_seen integer, raw_records_upserted integer)
language plpgsql security definer set search_path = pg_catalog, plm as $$
begin
  raise exception 'retired by #1090 Step 1.0: DesignFlow import cannot write canonical licensing identity; customer-only behavior requires separate evidence and a narrow replacement';
end;
$$;

revoke all on function plm.import_master_data(jsonb,jsonb) from public, anon, authenticated, service_role;

create or replace function plm.promote_coldlion_source_owned(p_expected jsonb, p_client_plan jsonb default null, p_is_drill boolean default false)
returns table (sync_run_id uuid, mode text, source_rows integer, linked_rows integer, promotions integer, curated_name_changes integer, provenance_refreshes integer, unchanged_rows integer, quarantined_rows integer, protected_violations integer)
language plpgsql security definer set search_path = pg_catalog, plm as $$
begin raise exception 'retired until #1090 Step 4: ColdLion cannot write canonical licensing identity'; end;
$$;

create or replace function public.promote_coldlion_source_owned(p_expected jsonb, p_client_plan jsonb default null, p_is_drill boolean default false)
returns table (sync_run_id uuid, mode text, source_rows integer, linked_rows integer, promotions integer, curated_name_changes integer, provenance_refreshes integer, unchanged_rows integer, quarantined_rows integer, protected_violations integer)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin raise exception 'retired until #1090 Step 4: ColdLion cannot write canonical licensing identity'; end;
$$;

revoke all on function plm.promote_coldlion_source_owned(jsonb,jsonb,boolean) from public;
revoke all on function public.promote_coldlion_source_owned(jsonb,jsonb,boolean) from public, anon, authenticated, service_role;
