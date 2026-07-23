-- Step 11 merge-coverage follow-up for the stable DAM Customer UUIDs added by
-- 20260723183000. A canonical Customer merge must repoint every dependent FK
-- before deleting the loser.

do $$
declare
  v_definition text;
  v_anchor text :=
    '  update public.style_tracker_rows set customer_id = p_survivor where customer_id = p_loser;';
  v_replacement text :=
    '  update public.assets set customer_id = p_survivor where customer_id = p_loser;' || E'\n' ||
    '  update public.style_groups set customer_id = p_survivor where customer_id = p_loser;' || E'\n' ||
    v_anchor;
begin
  v_definition := pg_get_functiondef('core.merge_customer(uuid,uuid,boolean)'::regprocedure);
  if position(v_anchor in v_definition) = 0 then
    raise exception 'core.merge_customer changed: expected insertion anchor is absent';
  end if;
  if position('update public.assets set customer_id = p_survivor' in v_definition) > 0
     or position('update public.style_groups set customer_id = p_survivor' in v_definition) > 0 then
    raise exception 'core.merge_customer already covers the DAM Customer FKs';
  end if;
  execute replace(v_definition, v_anchor, v_replacement);
end
$$;

comment on function core.merge_customer(uuid,uuid,boolean) is
  'Canonical Customer merge. Covers every inventoried Customer FK, including stable public.assets/style_groups/style_tracker_rows Customer UUIDs, and fails closed on extension conflicts.';
