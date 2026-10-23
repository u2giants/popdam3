-- Issue #4210: the search prewarm job exists, runs, and is not callable by browser roles.
begin;
do $contracts$
begin
  perform public.prewarm_style_guide_search();
  if not exists (select 1 from cron.job where jobname = 'prewarm-style-guide-search'
                  and schedule = '*/5 * * * *'
                  and command like '%public.prewarm_style_guide_search()%') then
    raise exception 'prewarm cron job missing or changed';
  end if;
  if has_function_privilege('authenticated', 'public.prewarm_style_guide_search()', 'execute')
     or has_function_privilege('anon', 'public.prewarm_style_guide_search()', 'execute') then
    raise exception 'prewarm must not be callable by browser roles';
  end if;
end
$contracts$;
rollback;
