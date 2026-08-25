-- Issue #679 -- Replacement for the unpromotable 20260814223552, DDL half only.
--
-- WHY THIS FILE EXISTS. 20260814223552 (issue #970, PR #1032) can never reach
-- production. Its authoring pull request merged UNREHEARSED on 2026-08-14T23:18Z --
-- the last preview dispatch that day ran at 22:43Z -- and its only preview apply
-- came ten days later, on a commit whose producer files differ from that pull
-- request's merge commit. The production business-risk gate therefore refuses its
-- byte binding (measured, run 32845346966), and it can never acquire a qualifying
-- rehearsal because preview already has it applied and an applied version never
-- re-applies. Owner authorization to replace it is recorded on issue #679,
-- 2026-08-25.
--
-- WHAT IT CARRIES, AND WHAT IT DELIBERATELY DOES NOT. 20260814223552 did two
-- separable things: it swapped api.pmt_style_guides to compute the Collection
-- vocabulary constant and dropped plm.pmt_collection.paramount_term (the DDL half),
-- and it rewrote plm.load_pmt_capture_chunk to stop writing that column (the loader
-- half). The loader half is ALREADY carried by the merged 20260825094455, which is
-- a full re-derivation of the repaired body above all three 2026-08-14 rewrites and
-- states in its own comment that it "ignores legacy paramount_term payload keys".
-- So this file touches the DDL only and never mentions the loader. Re-asserting the
-- loader here would overwrite 20260825094455's body with an older one on any target
-- that applies this file after it -- exactly the ordering trap issue #1459 documented.
--
-- REQUIRED PRODUCTION ORDER. The bounded window is exactly:
--   20260814193351 -> 20260814213043 -> 20260825094455 -> 20260825124200.
-- 20260814223552 is NOT in it and must never be promoted; this file replaces it.
--
-- IDEMPOTENT ON PURPOSE. Preview already carries 20260814223552, so preview already
-- has this exact end state and this file is a no-op there. Production does not, and
-- this file is what changes it. Both are correct end states and both are asserted by
-- the verification block at the bottom rather than assumed from which branch ran.
-- This is stated plainly because a preview rehearsal of this file proves the SQL is
-- valid and the end state holds -- it does not re-prove the column drop, which
-- preview performed on 2026-08-24 under the version this file replaces.
--
-- The vocabulary rule itself is unchanged and is not being re-decided here: Paramount
-- calls this source entity a Collection, POP presents it as a Style Guide, and that
-- mapping is a contract computed by the view, not captured row-level data.

drop view if exists api.pmt_style_guides;

create view api.pmt_style_guides
with (security_invoker = true) as
select
  cl.capture_id,
  cl.collection_source_id as style_guide_source_id,
  cl.collection_name      as style_guide_name,
  'Collection'::text      as paramount_term,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_collection pc
              join plm.pmt_property p
                on p.capture_id = pc.capture_id and p.property_source_id = pc.property_source_id
             where pc.capture_id = cl.capture_id
               and pc.collection_source_id = cl.collection_source_id),
           array[]::text[]) as property_names,
  (select count(*) from plm.pmt_asset_collection ac
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as asset_count,
  (select count(distinct ach.character_source_id)
     from plm.pmt_asset_collection ac
     join plm.pmt_asset_character ach
       on ach.capture_id = ac.capture_id and ach.asset_id = ac.asset_id
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as character_count,
  lc.completed_at as captured_at
from plm.pmt_collection cl
join api.pmt_latest_capture lc on lc.capture_id = cl.capture_id;

comment on view api.pmt_style_guides is
'Paramount Collections presented in POP business vocabulary as style guides. paramount_term is '
'the computed vocabulary constant Collection, not captured row-level source data. There is no '
'second source table: this reads plm.pmt_collection directly, so the two vocabularies cannot '
'drift into separate populations. character_count is distinct characters reached through the '
'style guide''s assets, which is why it is a count and not an array.';

-- A recreated view is a new object with default privileges. Re-pin its existing
-- posture without teaching the object-claim parser that the view is also a table.
do $$
begin
  execute 'revoke all on api.pmt_style_guides from public';
  execute 'revoke all on api.pmt_style_guides from anon';
  execute 'grant select on api.pmt_style_guides to authenticated, service_role';
end;
$$;

-- The one destructive statement. Guarded because preview already dropped this column
-- under 20260814223552. Production still has it, holding the single value Collection
-- on every row -- proved read-only immediately before this window: select distinct
-- paramount_term returned exactly one value across 538 rows, so nothing but the
-- constant the view now computes is destroyed here.
alter table plm.pmt_collection drop column if exists paramount_term;

comment on table plm.pmt_collection is
'The portal entity Paramount calls a Collection. POP presents the same rows as Style Guides '
'through api.pmt_style_guides. Collection is a vocabulary contract, not stored row-level source '
'data. There is deliberately no second style-guide source table or repeated vocabulary column.';

-- End-state verification. Definition and privilege only; it touches no captured data
-- and asserts the same result whether this file did the work or 20260814223552 did.
do $$
declare
  v_def text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'plm' and table_name = 'pmt_collection'
       and column_name = 'paramount_term'
  ) then
    raise exception 'pmt_collection.paramount_term survived the vocabulary replacement';
  end if;

  v_def := lower(pg_get_viewdef('api.pmt_style_guides'::regclass, true));
  if position('''collection''::text' in v_def) = 0
     or position('paramount_term' in v_def) = 0 then
    raise exception 'api.pmt_style_guides does not compute the Collection vocabulary constant';
  end if;

  if has_table_privilege('anon', 'api.pmt_style_guides', 'SELECT')
     or not has_table_privilege('authenticated', 'api.pmt_style_guides', 'SELECT')
     or not has_table_privilege('service_role', 'api.pmt_style_guides', 'SELECT') then
    raise exception 'api.pmt_style_guides grants are not the pinned posture';
  end if;

  raise notice 'Paramount Collection vocabulary end state verified';
end;
$$;
