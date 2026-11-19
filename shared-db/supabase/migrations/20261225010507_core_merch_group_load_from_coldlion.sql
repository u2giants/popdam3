-- =====================================================================================
-- popcre/shared-db#4706 (parent #4248): load canonical core.merch_group from the live
-- ColdLion feed coldlion.merch_group_detail, preserving DesignFlow's current IDs from
-- dflow_prod."merchGroup".
--
-- Source rulings: owner-rulings part 1 §6.3 "Coldlion ERP data is canonical"; #6194
-- (2026-11-12) "filled from coldlion via the established path"; #4706 correction: match
-- on the full identity, hold ambiguous or unmatched records for review. The frozen copy
-- core."merchGroup_retired_20261115" is NOT read.
--
-- Full identity = company + division + merch type + category + code. The feed is unique
-- on exactly these five (20260909194231); code + type alone repeats across categories.
--
-- Hierarchy (unique (parent_id, code) holds at every level):
--   L1 division (code = division_code)
--   L2 merch type within division (code = mg_type_code)
--   L3 category within type (code = mg_category)
--   L4 value (code = mg_code, name = mg_desc or code)
-- Every row's metadata.source = 'coldlion.merch_group_detail' (rollback key).
--
-- DesignFlow IDs: metadata.dflow_mg_id is set on an L4 row only when exactly one
-- DesignFlow row matches that feed row on full identity (each DesignFlow row can match
-- at most one feed row because the feed is unique on the identity). Every other
-- DesignFlow ID is held in core.merch_group_review_hold:
--   'ambiguous' = several DesignFlow IDs share one feed identity
--   'unmatched' = no feed row has that identity (incl. retired EP001, no division)
-- Nothing is guessed. Re-runnable: every insert is on-conflict-do-nothing.
-- When either source table is absent (ephemeral CI database) the load is skipped.
-- =====================================================================================

create unique index if not exists merch_group_source_identity_uidx
  on core.merch_group ((metadata->>'source_identity'))
  where metadata ? 'source_identity';

create unique index if not exists merch_group_dflow_mg_id_uidx
  on core.merch_group (((metadata->>'dflow_mg_id')::integer))
  where metadata ? 'dflow_mg_id';

create table if not exists core.merch_group_review_hold (
  dflow_mg_id integer primary key,
  reason text not null check (reason in ('unmatched', 'ambiguous')),
  candidate_merch_group_id uuid references core.merch_group (id) on delete set null,
  shared_with_count integer not null default 0 check (shared_with_count >= 0),
  created_at timestamptz not null default now(),
  constraint merch_group_review_hold_ambiguous_has_candidate
    check ((reason = 'ambiguous') = (candidate_merch_group_id is not null))
);

comment on table core.merch_group_review_hold is
  'DesignFlow merch-group IDs not attached to core.merch_group because they do not match exactly one ColdLion identity (#4706). Review queue; resolve by attaching or retiring.';

alter table core.merch_group_review_hold enable row level security;
revoke all on core.merch_group_review_hold from public, anon, authenticated;
grant select, insert, update, delete on core.merch_group_review_hold to service_role;

do $load$
declare
  v_feed bigint;
  v_l4 bigint;
  v_df bigint;
  v_attached bigint;
  v_held bigint;
begin
  if to_regclass('coldlion.merch_group_detail') is null
     or to_regclass('dflow_prod."merchGroup"') is null then
    raise notice '#4706: source tables absent; load skipped';
    return;
  end if;

  -- L1 divisions
  insert into core.merch_group (parent_id, code, name, level, metadata)
  select distinct null::uuid, f.division_code, f.division_code, 1,
         jsonb_build_object('source', 'coldlion.merch_group_detail',
                            'source_identity', 'L1|' || f.division_code)
  from coldlion.merch_group_detail f
  on conflict do nothing;

  -- L2 types
  insert into core.merch_group (parent_id, code, name, level, metadata)
  select distinct p.id, f.mg_type_code, f.mg_type_code, 2,
         jsonb_build_object('source', 'coldlion.merch_group_detail',
                            'source_identity', 'L2|' || f.division_code || '|' || f.mg_type_code)
  from coldlion.merch_group_detail f
  join core.merch_group p on p.metadata->>'source_identity' = 'L1|' || f.division_code
  on conflict do nothing;

  -- L3 categories
  insert into core.merch_group (parent_id, code, name, level, metadata)
  select distinct p.id, f.mg_category, f.mg_category, 3,
         jsonb_build_object('source', 'coldlion.merch_group_detail',
                            'source_identity', 'L3|' || f.division_code || '|' || f.mg_type_code
                                               || '|' || f.mg_category)
  from coldlion.merch_group_detail f
  join core.merch_group p
    on p.metadata->>'source_identity' = 'L2|' || f.division_code || '|' || f.mg_type_code
  on conflict do nothing;

  -- L4 values, with a DesignFlow ID only on a unique full-identity match
  with m as (
    select f.company_code, f.division_code, f.mg_type_code, f.mg_category, f.mg_code,
           count(d.mg_id) as n, min(d.mg_id) as only_id
    from coldlion.merch_group_detail f
    left join dflow_prod."merchGroup" d
      on d."companyCode_fk" = f.company_code and d."divisionCode_fk" = f.division_code
     and d."mgTypeCode" = f.mg_type_code and d.mg_code = f.mg_code
     and d."mgCategory" is not distinct from f.mg_category
    group by 1, 2, 3, 4, 5
  )
  insert into core.merch_group (parent_id, code, name, level, metadata)
  select p.id, f.mg_code, coalesce(nullif(btrim(f.mg_desc), ''), f.mg_code), 4,
         jsonb_strip_nulls(jsonb_build_object(
           'source', 'coldlion.merch_group_detail',
           'source_identity', 'L4|' || f.company_code || '|' || f.division_code || '|'
                              || f.mg_type_code || '|' || f.mg_category || '|' || f.mg_code,
           'company_code', f.company_code,
           'division_code', f.division_code,
           'mg_type_code', f.mg_type_code,
           'mg_category', f.mg_category,
           'active', f.active,
           'dflow_mg_id', case when m.n = 1 then m.only_id end))
  from coldlion.merch_group_detail f
  join m using (company_code, division_code, mg_type_code, mg_category, mg_code)
  join core.merch_group p
    on p.metadata->>'source_identity' = 'L3|' || f.division_code || '|' || f.mg_type_code
                                        || '|' || f.mg_category
  on conflict do nothing;

  -- Hold every DesignFlow ID not attached
  insert into core.merch_group_review_hold (dflow_mg_id, reason, candidate_merch_group_id, shared_with_count)
  select d.mg_id,
         case when c.id is null then 'unmatched' else 'ambiguous' end,
         c.id,
         case when c.id is null then 0
              else (count(*) over (partition by c.id))::integer - 1 end
  from dflow_prod."merchGroup" d
  left join core.merch_group c
    on c.level = 4
   and c.metadata->>'source_identity' = 'L4|' || d."companyCode_fk" || '|' || d."divisionCode_fk"
       || '|' || d."mgTypeCode" || '|' || d."mgCategory" || '|' || d.mg_code
  where not exists (
    select 1 from core.merch_group a
    where a.metadata ? 'dflow_mg_id' and (a.metadata->>'dflow_mg_id')::integer = d.mg_id)
  on conflict (dflow_mg_id) do nothing;

  -- Assertions
  select count(*) into v_feed from coldlion.merch_group_detail;
  select count(*) into v_l4 from core.merch_group
    where level = 4 and metadata->>'source' = 'coldlion.merch_group_detail';
  select count(*) into v_df from dflow_prod."merchGroup";
  select count(*) into v_attached from core.merch_group where metadata ? 'dflow_mg_id';
  select count(*) into v_held from core.merch_group_review_hold;

  if v_l4 <> v_feed then
    raise exception '#4706: L4 rows % <> feed rows %', v_l4, v_feed;
  end if;
  if v_attached + v_held <> v_df then
    raise exception '#4706: attached % + held % <> DesignFlow IDs %', v_attached, v_held, v_df;
  end if;
  if exists (select 1 from core.merch_group c
             where c.metadata ? 'dflow_mg_id'
               and not exists (select 1 from dflow_prod."merchGroup" d
                               where d.mg_id = (c.metadata->>'dflow_mg_id')::integer)) then
    raise exception '#4706: attached DesignFlow ID missing from dflow_prod';
  end if;
  raise notice '#4706: L4 %, attached %, held %', v_l4, v_attached, v_held;
end
$load$;
