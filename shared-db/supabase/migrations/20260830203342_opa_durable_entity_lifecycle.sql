-- Issue #1883: presence-only Disney OPA entity lifecycle. No source rows are included.

alter table plm.opa_property
  add column status text not null default 'active',
  add column first_withdrawn_at timestamptz,
  add column withdrawn_at timestamptz,
  add constraint opa_property_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  add constraint opa_property_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null)),
  add constraint opa_property_withdrawal_order_chk
    check (withdrawn_at is null or (first_withdrawn_at is not null and first_withdrawn_at <= withdrawn_at));

alter table plm.opa_character
  add column status text not null default 'active',
  add column first_withdrawn_at timestamptz,
  add column withdrawn_at timestamptz,
  add constraint opa_character_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  add constraint opa_character_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null)),
  add constraint opa_character_withdrawal_order_chk
    check (withdrawn_at is null or (first_withdrawn_at is not null and first_withdrawn_at <= withdrawn_at));

create index idx_opa_property_lifecycle_status
  on plm.opa_property (status, last_seen_at);
create index idx_opa_character_lifecycle_status
  on plm.opa_character (status, last_seen_at);

create function plm.enforce_opa_entity_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.first_withdrawn_at is not null
     and new.first_withdrawn_at is distinct from old.first_withdrawn_at then
    raise exception 'OPA lifecycle refused: %.% row already records its first withdrawal; history cannot be replaced or erased.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  -- The guarded OPA sync updates last_seen_at on every source sighting, including an
  -- unchanged hash. That existing legal writer therefore reactivates a returning entity
  -- without needing a competing loader path.
  if old.status = 'withdrawn' and new.last_seen_at > old.last_seen_at then
    new.status := 'active';
    new.withdrawn_at := null;
  end if;

  if new.status = 'withdrawn' and old.status is distinct from 'withdrawn'
     and new.first_withdrawn_at is null then
    new.first_withdrawn_at := new.withdrawn_at;
  end if;

  return new;
end;
$$;

create trigger trg_opa_property_lifecycle
  before update of status, first_withdrawn_at, withdrawn_at, last_seen_at
  on plm.opa_property
  for each row execute function plm.enforce_opa_entity_lifecycle();

create trigger trg_opa_character_lifecycle
  before update of status, first_withdrawn_at, withdrawn_at, last_seen_at
  on plm.opa_character
  for each row execute function plm.enforce_opa_entity_lifecycle();

comment on column plm.opa_property.status is
  'Presence lifecycle only: active or withdrawn. This does not describe canonical resolution.';
comment on column plm.opa_property.withdrawn_at is
  'Current withdrawal time; cleared when a later source sighting reactivates the property.';
comment on column plm.opa_property.first_withdrawn_at is
  'Immutable first confirmed withdrawal time, retained across every reactivation.';
comment on column plm.opa_character.status is
  'Presence lifecycle only: active or withdrawn. This does not describe canonical resolution.';
comment on column plm.opa_character.withdrawn_at is
  'Current withdrawal time; cleared when a later source sighting reactivates the character.';
comment on column plm.opa_character.first_withdrawn_at is
  'Immutable first confirmed withdrawal time, retained across every reactivation.';

revoke all on function plm.enforce_opa_entity_lifecycle() from public, anon, authenticated;
grant execute on function plm.enforce_opa_entity_lifecycle() to service_role;

do $verify$
declare
  v_table text;
  v_columns integer;
  v_checks integer;
begin
  foreach v_table in array array['opa_property', 'opa_character'] loop
    select count(*) into v_columns
    from pg_catalog.pg_attribute
    where attrelid = format('plm.%I', v_table)::regclass
      and attname in ('status', 'first_withdrawn_at', 'withdrawn_at')
      and not attisdropped;

    if v_columns <> 3 then
      raise exception 'verify: %.% lifecycle columns are incomplete', 'plm', v_table;
    end if;

    select count(*) into v_checks
    from pg_catalog.pg_constraint
    where conrelid = format('plm.%I', v_table)::regclass
      and contype = 'c'
      and convalidated
      and conname in (
        v_table || '_lifecycle_status_chk',
        v_table || '_withdrawn_at_chk',
        v_table || '_withdrawal_order_chk'
      );

    if v_checks <> 3 then
      raise exception 'verify: %.% lifecycle constraints are incomplete', 'plm', v_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef ad
        on ad.adrelid = a.attrelid and ad.adnum = a.attnum
      where a.attrelid = format('plm.%I', v_table)::regclass
        and a.attname = 'status'
        and (a.attnotnull is false or pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) is distinct from '''active''::text')
    ) then
      raise exception 'verify: %.% status default or nullability is wrong', 'plm', v_table;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_indexes
      where schemaname = 'plm'
        and tablename = v_table
        and indexname = 'idx_' || v_table || '_lifecycle_status'
    ) then
      raise exception 'verify: %.% lifecycle index is missing', 'plm', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_trigger t
      where t.tgrelid = format('plm.%I', v_table)::regclass
        and t.tgname = 'trg_' || v_table || '_lifecycle'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
        and t.tgfoid = 'plm.enforce_opa_entity_lifecycle()'::regprocedure
    ) then
      raise exception 'verify: %.% lifecycle trigger is missing, disabled, or miswired', 'plm', v_table;
    end if;
  end loop;

  if pg_catalog.pg_get_functiondef('plm.enforce_opa_entity_lifecycle()'::regprocedure)
       not like '%new.last_seen_at > old.last_seen_at%' then
    raise exception 'verify: OPA source-sighting reactivation is not installed';
  end if;
end
$verify$;
