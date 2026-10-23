-- Issue #4429 style-guide access InitPlan contracts.
-- LOCAL THROWAWAY DATABASE ONLY. Never execute against production.
do $rls4429_contracts$
declare
  v_unwrapped int;
begin
  select count(*) into v_unwrapped
  from pg_policies
  where (schemaname, tablename, policyname) in (
    ('public','style_guide_file_tags','style_guide_file_tags_read'),
    ('public','style_guide_tag_aliases','style_guide_tag_aliases_read'),
    ('public','style_guide_tagging_state','style_guide_tagging_state_read'),
    ('public','style_guide_tags','style_guide_tags_read')
  )
  and not (coalesce(qual, '') like '%( SELECT has_app_access(%');
  if v_unwrapped <> 0 then
    raise exception 'rls4429: % target policies lack the wrapped has_app_access form', v_unwrapped;
  end if;
end
$rls4429_contracts$;
