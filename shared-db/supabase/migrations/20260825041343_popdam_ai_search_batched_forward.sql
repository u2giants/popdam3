-- Short prerequisite A for the PopDAM scoped AI metadata/search recovery.
-- GitHub: u2giants/shared-db#1474, #1427; u2giants/popdam3#96, #97.
--
-- This migration intentionally does not reconcile rows or activate the final
-- contract. It commits the lock-requiring table shape first so the dependent
-- migration can run bounded DML without holding this ALTER TABLE lock. Until
-- that migration completes, the existing compatibility trigger remains active
-- and every new column is nullable: current PopDAM behavior is unchanged.
set statement_timeout = '10min';

alter table public.asset_tags
  add column if not exists category text,
  add column if not exists status text,
  add column if not exists confidence numeric,
  add column if not exists model text,
  add column if not exists evidence jsonb,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists updated_at timestamptz;

-- General keyset support for the dependent compatibility rebuild. Recovery B
-- uses this index across every asset_tags row, then drops it after the rebuild;
-- B retains the final active-only lookup index below.
create index if not exists asset_tags_forward_asset_id_idx
  on public.asset_tags(asset_id, id);

-- The final lookup index is empty in production until the dependent migration
-- promotes reconciled rows to active. Creating it here keeps index construction
-- out of the long reconciliation transaction.
create index if not exists asset_tags_active_asset_idx
  on public.asset_tags(asset_id, tag)
  where status = 'active';

-- This partial index makes each bounded normalization call seek only rows still
-- pending. Dead entries remain until the dependent transaction commits; the
-- index cheapens each keyset lookup but does not physically shrink mid-run.
-- Recovery B drops this pending-only accelerator after normalization completes.
create index if not exists asset_tags_pending_metadata_normalization_idx
  on public.asset_tags(id)
  where tag is distinct from btrim(tag)
     or source is distinct from btrim(source)
     or category is null
     or status is null
     or source is null
     or source = '';

do $$
declare
  v_contract_complete boolean :=
    to_regclass('public.style_group_tags') is not null
    and to_regclass('public.dam_search_documents') is not null
    and to_regprocedure('public.get_effective_asset_metadata(uuid)') is not null
    and to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is not null;
begin
  -- Production must retain its legacy compatibility trigger between A and B;
  -- preview already has the final replacement. Either state is safe, but
  -- having neither would silently stop assets.tags maintenance.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.asset_tags'::regclass
      and tgname in ('trg_sync_asset_tags', 'asset_tags_sync_assets_tags')
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception 'PopDAM prerequisite refuses asset_tags with no enabled compatibility trigger';
  end if;

  if not v_contract_complete then
    comment on column public.asset_tags.category is
      'PopDAM #1427 prerequisite A installed; reconciliation/final contract B is pending.';
  end if;
end $$;
