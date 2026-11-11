-- u2giants/popdam3#804 task 4: an unchanged library is never rebuilt on age alone.
begin;
do $contracts$
declare
  v_old timestamptz := now() - interval '3 days';
  v_seen timestamptz;
begin
  perform public.refresh_style_guide_library_default_snapshot();
  update public.admin_config
     set value = jsonb_set(value, '{library-default-snapshot,refreshed_at}', to_jsonb(v_old))
   where key = 'STYLE_GUIDE_REFRESH_STATE';
  perform public.refresh_style_guide_library_default_snapshot();
  select (value -> 'library-default-snapshot' ->> 'refreshed_at')::timestamptz into v_seen
    from public.admin_config where key = 'STYLE_GUIDE_REFRESH_STATE';
  if v_seen is distinct from v_old then
    raise exception 'snapshot rebuilt with unchanged signatures (refreshed_at %)', v_seen;
  end if;

  update public.admin_config
     set value = jsonb_set(value, '{library-default-snapshot,primary_signature}', '"changed"')
   where key = 'STYLE_GUIDE_REFRESH_STATE';
  perform public.refresh_style_guide_library_default_snapshot();
  select (value -> 'library-default-snapshot' ->> 'refreshed_at')::timestamptz into v_seen
    from public.admin_config where key = 'STYLE_GUIDE_REFRESH_STATE';
  if v_seen is not distinct from v_old then
    raise exception 'snapshot not rebuilt after a signature change';
  end if;
end
$contracts$;
rollback;
