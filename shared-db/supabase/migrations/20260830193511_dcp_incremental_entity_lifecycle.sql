-- Issue #1880: durable presence lifecycle for DCP assets and style guides.
-- This migration changes structure only. It does not load licensed rows and it does not
-- infer withdrawal from any existing or incomplete crawl.

alter table plm.dcp_asset
  add column lifecycle_status text not null default 'active',
  add column first_withdrawn_at timestamptz null,
  add column withdrawn_at timestamptz null,
  add constraint dcp_asset_lifecycle_status_chk
    check (lifecycle_status in ('active', 'withdrawn')),
  add constraint dcp_asset_withdrawal_state_chk
    check ((lifecycle_status = 'withdrawn') = (withdrawn_at is not null)),
  add constraint dcp_asset_first_withdrawal_chk
    check (
      (withdrawn_at is null or first_withdrawn_at is not null)
      and (withdrawn_at is null or first_withdrawn_at <= withdrawn_at)
    );

alter table plm.dcp_style_guide
  add column lifecycle_status text not null default 'active',
  add column first_withdrawn_at timestamptz null,
  add column withdrawn_at timestamptz null,
  add constraint dcp_style_guide_lifecycle_status_chk
    check (lifecycle_status in ('active', 'withdrawn')),
  add constraint dcp_style_guide_withdrawal_state_chk
    check ((lifecycle_status = 'withdrawn') = (withdrawn_at is not null)),
  add constraint dcp_style_guide_first_withdrawal_chk
    check (
      (withdrawn_at is null or first_withdrawn_at is not null)
      and (withdrawn_at is null or first_withdrawn_at <= withdrawn_at)
    );

create index idx_dcp_asset_lifecycle_status
  on plm.dcp_asset (lifecycle_status, last_seen_crawl_id);
create index idx_dcp_style_guide_lifecycle_status
  on plm.dcp_style_guide (lifecycle_status, last_seen_crawl_id);

alter table plm.dcp_crawl
  add column run_kind text not null default 'full',
  add column baseline_crawl_id uuid null
    references plm.dcp_crawl(crawl_id) on delete restrict,
  add column baseline_required_status text generated always as (
    case when baseline_crawl_id is null then null else 'complete'::text end
  ) stored,
  add column assets_added_count integer null,
  add column assets_withdrawn_count integer null,
  add column assets_reactivated_count integer null,
  add column style_guides_added_count integer null,
  add column style_guides_withdrawn_count integer null,
  add column style_guides_reactivated_count integer null,
  add constraint dcp_crawl_run_kind_chk
    check (run_kind in ('full', 'incremental')),
  add constraint dcp_crawl_baseline_shape_chk
    check (
      (run_kind = 'full' and baseline_crawl_id is null)
      or (run_kind = 'incremental' and baseline_crawl_id is not null)
    ),
  add constraint dcp_crawl_delta_counts_chk
    check (
      (assets_added_count is null or assets_added_count >= 0)
      and (assets_withdrawn_count is null or assets_withdrawn_count >= 0)
      and (assets_reactivated_count is null or assets_reactivated_count >= 0)
      and (style_guides_added_count is null or style_guides_added_count >= 0)
      and (style_guides_withdrawn_count is null or style_guides_withdrawn_count >= 0)
      and (style_guides_reactivated_count is null or style_guides_reactivated_count >= 0)
    ),
  add constraint dcp_crawl_full_has_no_delta_chk
    check (
      run_kind <> 'full'
      or num_nonnulls(
        assets_added_count, assets_withdrawn_count, assets_reactivated_count,
        style_guides_added_count, style_guides_withdrawn_count,
        style_guides_reactivated_count
      ) = 0
    ),
  add constraint dcp_crawl_complete_incremental_delta_chk
    check (
      status <> 'complete'
      or run_kind <> 'incremental'
      or num_nonnulls(
        assets_added_count, assets_withdrawn_count, assets_reactivated_count,
        style_guides_added_count, style_guides_withdrawn_count,
        style_guides_reactivated_count
      ) = 6
    ),
  add constraint dcp_crawl_identity_status_uk
    unique (crawl_id, status),
  add constraint dcp_crawl_complete_baseline_fk
    foreign key (baseline_crawl_id, baseline_required_status)
    references plm.dcp_crawl(crawl_id, status)
    on update restrict on delete restrict;

create index idx_dcp_crawl_baseline
  on plm.dcp_crawl (baseline_crawl_id)
  where baseline_crawl_id is not null;

create or replace function plm.validate_dcp_incremental_baseline()
returns trigger
language plpgsql
set search_path = pg_catalog, plm
as $$
declare
  v_baseline_status text;
begin
  if tg_table_name in ('dcp_asset', 'dcp_style_guide') then
    if old.first_withdrawn_at is not null
       and new.first_withdrawn_at is distinct from old.first_withdrawn_at then
      raise exception 'DCP Vault refused: %.% row % already records its first withdrawal '
        'at %; first history cannot be replaced or erased.',
        tg_table_schema, tg_table_name, old.id, old.first_withdrawn_at
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_table_name <> 'dcp_crawl' then
    raise exception 'plm.validate_dcp_incremental_baseline is attached to unknown table %.%.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'complete'
     and new.status is distinct from 'complete' then
    if exists (
      select 1
      from plm.dcp_crawl c
      where c.baseline_crawl_id = old.crawl_id
        and c.crawl_id <> old.crawl_id
    ) then
      raise exception 'DCP Vault refused: complete crawl % is an active incremental '
        'baseline and cannot be changed to %.', old.crawl_id, new.status
        using errcode = 'P0001';
    end if;
  end if;

  if new.run_kind = 'full' then
    if new.baseline_crawl_id is not null then
      raise exception 'DCP Vault refused: a full crawl cannot name a baseline crawl.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.baseline_crawl_id is null then
    raise exception 'DCP Vault refused: an incremental crawl requires a complete baseline.'
      using errcode = 'P0001';
  end if;
  if new.baseline_crawl_id = new.crawl_id then
    raise exception 'DCP Vault refused: a crawl cannot use itself as its baseline.'
      using errcode = 'P0001';
  end if;
  select status into v_baseline_status
  from plm.dcp_crawl
  where crawl_id = new.baseline_crawl_id;

  if v_baseline_status is distinct from 'complete' then
    raise exception 'DCP Vault refused: baseline crawl % is %, not complete. Failed, partial, '
      'planned, and running crawls cannot authorize presence-based withdrawal.',
      new.baseline_crawl_id, coalesce(v_baseline_status, '<missing>')
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_dcp_incremental_baseline
  before insert or update of run_kind, baseline_crawl_id, status
  on plm.dcp_crawl
  for each row execute function plm.validate_dcp_incremental_baseline();

create trigger trg_dcp_asset_first_withdrawal
  before update of first_withdrawn_at
  on plm.dcp_asset
  for each row execute function plm.validate_dcp_incremental_baseline();

create trigger trg_dcp_style_guide_first_withdrawal
  before update of first_withdrawn_at
  on plm.dcp_style_guide
  for each row execute function plm.validate_dcp_incremental_baseline();

comment on function plm.validate_dcp_incremental_baseline() is
'Refuses an incremental DCP crawl unless it names a different crawl already frozen as '
'complete, and refuses to downgrade a complete crawl while an incremental crawl cites it. '
'A composite foreign key binds every baseline reference to status complete, so concurrent '
'changes cannot commit an invalid baseline. A failed or partial crawl can never authorize mass withdrawal. '
'The same guarded trigger function preserves an entity''s first withdrawal timestamp once set.';

comment on column plm.dcp_asset.first_withdrawn_at is
'First presence-based withdrawal time. Retained after reactivation; never inferred from an incomplete crawl.';
comment on column plm.dcp_asset.withdrawn_at is
'Current withdrawal time. NULL exactly when lifecycle_status is active.';
comment on column plm.dcp_style_guide.first_withdrawn_at is
'First presence-based withdrawal time. Retained after reactivation; never inferred from an incomplete crawl.';
comment on column plm.dcp_style_guide.withdrawn_at is
'Current withdrawal time. NULL exactly when lifecycle_status is active.';
comment on column plm.dcp_crawl.baseline_crawl_id is
'Complete crawl used as the presence baseline for an incremental run. Never points to failed or partial evidence.';
