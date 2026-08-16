-- #853/#868: the content disambiguator must have a usable normalized lookup.

do $$
declare
  index_is_valid boolean;
  index_is_unconditional boolean;
  index_expression text;
  plan_line text;
  plan_text text := '';
begin
  select i.indisvalid and i.indisready,
         i.indpred is null,
         lower(regexp_replace(pg_get_expr(i.indexprs, i.indrelid), '\s+', '', 'g'))
  into index_is_valid, index_is_unconditional, index_expression
  from pg_index i
  where i.indexrelid = 'plm.item_upper_trim_item_number_idx'::regclass;

  if index_is_valid is distinct from true then
    raise exception 'normalized plm.item lookup index is not valid and ready';
  end if;

  if index_is_unconditional is distinct from true
     or index_expression not in (
       'upper(trim(bothfromitem_number))',
       'upper(btrim(item_number))'
     ) then
    raise exception 'normalized plm.item lookup index has the wrong expression or predicate';
  end if;

  perform set_config('enable_seqscan', 'off', true);
  for plan_line in
    execute $explain$
      explain (costs off)
      select id
      from plm.item
      where upper(trim(item_number)) = upper(trim('contract-probe'))
    $explain$
  loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;

  if plan_text not like '%item_upper_trim_item_number_idx%' then
    raise exception 'normalized content lookup does not plan through the required index';
  end if;
end;
$$;
