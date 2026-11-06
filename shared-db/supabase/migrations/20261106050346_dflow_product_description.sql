-- derived-from: none
-- Issue #5020 (claim #5772): Core Product Type storage for DesignFlow —
-- SANDBOX HALF of the matched pair (schema `dflow`, project
-- xupnyeifmpsacrqahwwm: sandbox / dev / staging all point here).
-- Work issue popcre/designflow-item-master#150; plan plan_core-product-type.md
-- (branch sandbox-albert). Owner answers (Albert Hazan, 2026-10-29) are Settled
-- in docs/business-rules/merchandise-and-product-taxonomy.md.
--
-- The production half is the paired version 20261029054534 (schema
-- `dflow_prod`, project qsllyeztdwjgirsysgai). The pair exists because the
-- production project ALSO carries a stale `dflow` schema, so schema-existence
-- conditioning inside one file cannot be both correct and static; each half is
-- fail-loud about the project it must never run on, and each project's lane
-- allowlists only its own half.
--
-- Objects (this file): dflow.mg_combination_description (+_history),
-- dflow.item_product_description (+_history), functions
-- dflow.product_description_row_audit() and
-- dflow.item_product_description_protect_human_override(), three triggers,
-- four indexes. No grants: the sandbox item service runs as the postgres
-- pooler admin (verified live 2026-10-29) and there are no grant roles on this
-- project; ownership covers everything.
--
-- Key shapes verified live 2026-10-29: itemHeader PK item_id_pk integer;
-- core."merchGroup" PK mg_id integer; udf_merchgroup0N_id integer.
--
-- Human override contract: a session may create, change, clear,
-- re-attribute or DELETE a human override only after
-- set_config('app.product_description.human','on',true) in the same
-- transaction (the item-master PATCH does this; the value must be exactly
-- 'on'). Bulk/refresh connections never set it, so the trigger fires for them
-- on insert, update and delete alike.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / drop-if-exists; re-apply is a
-- no-op. Rollback: drop trigger item_product_description_write_guard on
-- dflow.item_product_description and trigger product_description_audit on both
-- tables, drop function dflow.item_product_description_protect_human_override,
-- drop function dflow.product_description_row_audit, drop table
-- dflow.item_product_description_history, dflow.item_product_description,
-- dflow.mg_combination_description_history, dflow.mg_combination_description.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#5020/20261106050346 self-check: schema dflow_prod exists here — this is the production project; the paired dflow_prod version applies there, never this one'
      using errcode = 'feature_not_supported';
  end if;
end $$;

do $$
begin
  if to_regnamespace('dflow') is null then
    raise exception '#5020/20261106050346 self-check: schema dflow is missing — wrong database for the sandbox half'
      using errcode = 'feature_not_supported';
  end if;
  if to_regclass('core."merchGroup"') is null then
    raise exception '#5020/20261106050346 self-check: core."merchGroup" is missing — cannot create the combination FKs'
      using errcode = 'feature_not_supported';
  end if;
  if to_regclass('dflow."itemHeader"') is null then
    raise exception '#5020/20261106050346 self-check: dflow."itemHeader" is missing — wrong database'
      using errcode = 'feature_not_supported';
  end if;
end $$;

-- Combination table: one row per MG01+MG02+MG03 with its verified state and provenance.
create table if not exists dflow.mg_combination_description (
  id bigint generated always as identity primary key,
  mg01_id integer not null references core."merchGroup"(mg_id),
  mg02_id integer not null references core."merchGroup"(mg_id),
  mg03_id integer not null references core."merchGroup"(mg_id),
  description text,
  status text not null default 'pending'
    constraint mg_combination_description_status_check
    check (status in ('published','failed','pending','review')),
  item_count integer,
  verified_count integer,
  verified_rate numeric(5,4),
  source_desc_sha256 text,
  engine_version text,
  run_id text,
  generated_at timestamptz not null default now(),
  constraint mg_combination_description_unique
    unique (mg01_id, mg02_id, mg03_id)
);

create table if not exists dflow.mg_combination_description_history (
  history_id bigint generated always as identity primary key,
  history_at timestamptz not null default now(),
  like dflow.mg_combination_description including defaults
);

-- Per-item copy: description, provenance and the never-machine-overwritten flag.
create table if not exists dflow.item_product_description (
  item_fk integer primary key
    references dflow."itemHeader"(item_id_pk) on delete cascade,
  combination_fk bigint references dflow.mg_combination_description(id),
  description text,
  source text
    constraint item_product_description_source_check
    check (source in ('combination','human')),
  verified boolean,
  verify_score numeric(4,3),
  is_human_override boolean not null default false,
  override_user_fk integer,
  override_at timestamptz,
  run_id text,
  computed_at timestamptz not null default now(),
  constraint item_product_description_override_source_check
    check (not is_human_override or source = 'human')
);

create table if not exists dflow.item_product_description_history (
  history_id bigint generated always as identity primary key,
  history_at timestamptz not null default now(),
  like dflow.item_product_description including defaults
);

-- Audit: every UPDATE/DELETE copies the OLD row into the matching history table.
-- The column list is derived from pg_attribute (not information_schema) so the
-- audit never depends on the invoking role's column visibility.
create or replace function dflow.product_description_row_audit() returns trigger as $fn$
declare
  cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into cols
  from pg_attribute a
  where a.attrelid = tg_relid
    and a.attnum > 0
    and not a.attisdropped;
  execute format('insert into %I.%I (%s) select $1.*',
    tg_table_schema, tg_table_name || '_history', cols)
    using old;
  return null;
end
$fn$ language plpgsql;

drop trigger if exists product_description_audit on dflow.mg_combination_description;
create trigger product_description_audit
  after update or delete on dflow.mg_combination_description
  for each row execute function dflow.product_description_row_audit();

drop trigger if exists product_description_audit on dflow.item_product_description;
create trigger product_description_audit
  after update or delete on dflow.item_product_description
  for each row execute function dflow.product_description_row_audit();

-- Guard: a human override is never created, changed, cleared, re-attributed or
-- deleted by a machine connection. Only a session that set
-- app.product_description.human to exactly 'on' (case-insensitive) inside the
-- transaction may do any of those. Any other value — including 'off', 'false',
-- '0' or an unset variable — is a machine session and is refused.
create or replace function dflow.item_product_description_protect_human_override() returns trigger as $fn$
declare
  human boolean := lower(coalesce(current_setting('app.product_description.human', true), '')) = 'on';
begin
  if tg_op = 'INSERT' then
    if new.is_human_override and not human then
      raise exception 'item_product_description % claims a human override; only a human session may create one (set app.product_description.human = on in the transaction)',
        new.item_fk using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.is_human_override and not human then
      raise exception 'item_product_description % carries a human override; only a human session may delete it (set app.product_description.human = on in the transaction)',
        old.item_fk using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if not human and (
    (old.is_human_override or new.is_human_override)
    and (
      new.description is distinct from old.description
      or new.is_human_override is distinct from old.is_human_override
      or (old.is_human_override
          and (new.override_user_fk is distinct from old.override_user_fk
               or new.override_at is distinct from old.override_at))
    )
  ) then
    raise exception 'item_product_description % carries or claims a human override; only a human session may change, clear or re-attribute it (set app.product_description.human = on in the transaction)',
      old.item_fk using errcode = 'check_violation';
  end if;
  return new;
end
$fn$ language plpgsql;

drop trigger if exists item_product_description_write_guard on dflow.item_product_description;
create trigger item_product_description_write_guard
  before insert or update or delete on dflow.item_product_description
  for each row execute function dflow.item_product_description_protect_human_override();

-- Review list and run-scoped rollback support on the live tables (the
-- history tables are append-only audit copies and carry no run_id index).
create index if not exists item_product_description_combination_idx
  on dflow.item_product_description (combination_fk);

create index if not exists item_product_description_review_idx
  on dflow.item_product_description (item_fk) where description is null;

create index if not exists item_product_description_run_idx
  on dflow.item_product_description (run_id);

create index if not exists mg_combination_description_run_idx
  on dflow.mg_combination_description (run_id);
