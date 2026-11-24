-- derived-from: 20261029162652
-- Work issue #7026. Make the existing RFQ style-number partial index eligible.
-- Match the installed view so preview and production retain their RFQ schema
-- bindings, existing output columns and grants.

do $migration$
declare
  current_definition text := pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass);
  old_filter constant text := $old$((upper(TRIM(BOTH FROM i."rfqItem_style_number")) = upper(TRIM(BOTH FROM (r.row_data ->> 'rfq_code'::text)))) AND (NULLIF(TRIM(BOTH FROM (r.row_data ->> 'rfq_code'::text)), ''::text) IS NOT NULL) AND (i."rfqItem_rfq_group" IS NOT NULL))$old$;
  index_predicate constant text := $needle$(NULLIF(TRIM(BOTH FROM i."rfqItem_style_number"), ''::text) IS NOT NULL)$needle$;
  new_filter text := left(old_filter, -1) || ' AND ' || index_predicate || ')';
begin
  -- Equality to a nonblank tracker code already implies a nonblank RFQ style
  -- number. Spell it out so PostgreSQL can prove the partial index predicate.
  if array_length(string_to_array(current_definition, old_filter), 1) is distinct from 2
     or strpos(current_definition, index_predicate) <> 0 then
    raise exception 'Unexpected RFQ filter in public.style_tracker_rows_with_bridge';
  end if;

  if 2 <> (
    select count(distinct acl.grantee)
    from pg_class relation
    cross join lateral aclexplode(relation.relacl) acl
    where relation.oid = 'public.style_tracker_rows_with_bridge'::regclass
      and acl.grantor = relation.relowner
      and acl.privilege_type = 'SELECT'
      and pg_get_userbyid(acl.grantee) in ('authenticated', 'service_role')
  ) then
    raise exception 'Unexpected Master Data view read grants';
  end if;

  execute 'CREATE OR REPLACE VIEW public.style_tracker_rows_with_bridge AS '
    || replace(current_definition, old_filter, new_filter);

  if strpos(pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass), index_predicate) = 0 then
    raise exception 'RFQ index predicate was not installed';
  end if;
end;
$migration$;

-- Reassert and verify the existing app read grants.
grant select on public.style_tracker_rows_with_bridge to authenticated, service_role;
