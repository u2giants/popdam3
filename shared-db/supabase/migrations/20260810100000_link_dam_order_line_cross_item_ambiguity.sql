-- =====================================================================================
-- PopDAM OrderList — forward fix 2: link_dam_order_line missed CROSS-ITEM ambiguity.
--
-- Issue:  u2giants/shared-db#613 (object claim #624)
-- Fixes:  public.link_dam_order_line, created in 20260810010000 (applied on preview,
--         therefore never edited -- this is a new forward migration).
-- Found by: independent review of PR #635.
--
-- THE BUG
-- -------
-- The candidate count in 20260810010000 was scoped by `b.plm_item_id = p_item_id`:
--
--     where b.plm_item_id  = p_item_id
--       and b.tracker_type = v_type
--       and nullif(btrim(lower(r.sku)), '') = v_sku_norm
--
-- That asks "does THIS item have exactly one matching bridge row?". It never asks the
-- question that actually matters: "does this SKU, in this catalog, resolve to exactly
-- one ITEM?"
--
-- Failure scenario. SKU `ABC123` appears on two Master Data rows bridged to two
-- DIFFERENT items, A and B. A caller passes item A with status 'matched'. The count
-- comes back 1, the guard passes, and the line is stamped `matched` against a product
-- that was chosen arbitrarily by the caller. That is exactly the 449-case ambiguity
-- population the whole feature exists to keep visible, and it is the one shape the
-- narrow count cannot see. The original file's own comment promised that two candidates
-- must fail; the code did not implement its comment.
--
-- The original test missed it because the fixture bridged both duplicate Master Data
-- rows to the SAME item -- the one ambiguity shape the narrow count does catch.
--
-- DOES THIS SHAPE EXIST IN LIVE DATA? NOT YET.
-- --------------------------------------------
-- Measured read-only on preview rjyboqwcdzcocqgmsyel, 2026-08-09:
--   plm.style_tracker_item_bridge rows                     15,533
--   ...of those, rows with a non-null plm_item_id                0
--   plm.item rows                                                0
--   sku+type pairs resolving to >1 distinct item                 0
-- So the defect is latent TODAY only because the bridge has not been repointed yet.
-- The moment fix_schema_for_api.md Phase 4 populates plm_item_id, the 70 duplicate
-- licensed SKUs and 5 duplicate generic SKUs recorded in the Phase 0 profile become
-- live cross-item ties. Fixing it before that lands is the whole point.
--
-- 'matched' VS 'manual' -- THE READING TAKEN HERE, AND WHY
-- --------------------------------------------------------
-- These two statuses are NOT the same act and must not share one rule.
--
--   'matched' = the machine resolved it. Owner decision 5 is "exact unique auto-match".
--               A genuine cross-item tie has no unique answer, so an automatic link is
--               REFUSED. This is the strict rule the original comment promised.
--
--   'manual'  = a human resolved it. The plan's own UI design requires this path to
--               exist: Step 3.2 specifies a `MasterDataLinkDialog` "for exact eligible
--               candidates and manual selection" (plural candidates), and Section 1
--               requires ambiguous matches to be "visible and reviewable". Under the
--               strict rule those 449 ambiguous rows could never be resolved by anyone,
--               which contradicts the goal the plan says wins over any step.
--
-- So a human MAY break a genuine tie, but never arbitrarily: the chosen item must still
-- be a member of the eligible candidate set for that exact normalized SKU in that exact
-- licensed/generic catalog. An item that is not eligible is refused for BOTH statuses.
-- When a human breaks a tie, the tie is recorded on the line
-- (`metadata.link_candidate_item_count`) so the decision stays auditable rather than
-- looking identical to an unambiguous link.
--
-- Nothing else about the function changes: still SECURITY DEFINER, still search_path
-- pinned, still revoked from public and anon, still no delete path, still trim +
-- case-fold normalization and nothing fuzzy.
-- =====================================================================================

begin;

create or replace function public.link_dam_order_line(
  p_line_id      uuid,
  p_item_id      uuid,
  p_match_status text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_actor       uuid := auth.uid();
  v_sku_norm    text;
  v_type        text;
  v_item_count  integer;
  v_is_eligible boolean;
begin
  if v_actor is null then
    raise exception 'link_dam_order_line: authentication required' using errcode = '42501';
  end if;

  select pol.sku_normalized, pol.source_style_type
    into v_sku_norm, v_type
  from plm.production_order_line pol
  where pol.id = p_line_id;

  if not found then
    raise exception 'link_dam_order_line: line % not found', p_line_id using errcode = 'P0002';
  end if;

  -- Unlinking. Allowed, but the row must then say so honestly.
  if p_item_id is null then
    if p_match_status not in ('unmatched', 'ambiguous', 'not_applicable') then
      raise exception 'link_dam_order_line: clearing the item requires match status unmatched, ambiguous or not_applicable, got %', p_match_status
        using errcode = '23514';
    end if;
    update plm.production_order_line
       set item_id = null,
           master_data_match_status = p_match_status,
           metadata = metadata || jsonb_build_object(
             'last_relinked_by', v_actor,
             'last_relinked_at', now(),
             'link_candidate_item_count', null),
           updated_at = now()
     where id = p_line_id;
    return p_line_id;
  end if;

  if p_match_status not in ('matched', 'manual') then
    raise exception 'link_dam_order_line: setting an item requires match status matched or manual, got %', p_match_status
      using errcode = '23514';
  end if;

  if v_sku_norm is null then
    raise exception 'link_dam_order_line: line % has no SKU, so no product can be resolved for it', p_line_id
      using errcode = '23514';
  end if;

  if v_type is null then
    raise exception 'link_dam_order_line: line % has no licensed/generic discriminator, so the eligible Master Data catalog is unknown', p_line_id
      using errcode = '23514';
  end if;

  if not exists (select 1 from plm.item where id = p_item_id) then
    raise exception 'link_dam_order_line: item % does not exist', p_item_id using errcode = 'P0002';
  end if;

  -- THE CORRECTED RESOLUTION. Count DISTINCT ITEMS, with no predicate on p_item_id, so
  -- a SKU that resolves to two different products is visible as the tie it is. Trim +
  -- case-fold only; nothing fuzzy.
  select count(distinct b.plm_item_id),
         bool_or(b.plm_item_id = p_item_id)
    into v_item_count, v_is_eligible
  from plm.style_tracker_item_bridge b
  join public.style_tracker_rows r on r.id = b.style_tracker_row_id
  where b.plm_item_id is not null
    and b.tracker_type = v_type
    and nullif(btrim(lower(r.sku)), '') = v_sku_norm;

  if v_item_count = 0 then
    raise exception 'link_dam_order_line: SKU % does not resolve to any item through the % Master Data catalog', v_sku_norm, v_type
      using errcode = '23514';
  end if;

  -- Eligibility is checked for BOTH statuses. A human may break a tie; nobody may
  -- attach an item this SKU does not resolve to at all.
  if not coalesce(v_is_eligible, false) then
    raise exception 'link_dam_order_line: item % is not one of the % item(s) that SKU % resolves to in the % Master Data catalog', p_item_id, v_item_count, v_sku_norm, v_type
      using errcode = '23514';
  end if;

  -- A genuine cross-item tie is never resolved automatically.
  if v_item_count > 1 and p_match_status = 'matched' then
    raise exception 'link_dam_order_line: SKU % resolves to % different items in the % Master Data catalog; an automatic match must not pick one -- review it and relink with match status manual', v_sku_norm, v_item_count, v_type
      using errcode = '23514';
  end if;

  update plm.production_order_line
     set item_id = p_item_id,
         master_data_match_status = p_match_status,
         metadata = metadata || jsonb_build_object(
           'last_relinked_by', v_actor,
           'last_relinked_at', now(),
           -- Recorded so a human tie-break never looks identical to an unambiguous link.
           'link_candidate_item_count', v_item_count),
         updated_at = now()
   where id = p_line_id;

  return p_line_id;
end;
$$;

revoke all on function public.link_dam_order_line(uuid, uuid, text) from public, anon;
grant execute on function public.link_dam_order_line(uuid, uuid, text) to authenticated, service_role;

comment on function public.link_dam_order_line(uuid, uuid, text) is
  'The only path to plm.production_order_line.item_id. The SKU plus the licensed/generic catalog must resolve to exactly ONE item for match status matched; a human may break a genuine cross-item tie with match status manual, but only to an item the SKU actually resolves to, and the tie is recorded in metadata.link_candidate_item_count. Never fuzzy.';

commit;
