-- Issue #4429; claim #4676; reserved version 20261023141625.
-- Wrap the complete request-constant has_app_access(auth.uid(), 'styleguides') call
-- in 4 style-guide read policies. Named arguments and enum overload preserved.
-- catalog-verification: policies only (ALTER POLICY expressions); no new relations.

set local search_path = public, pg_catalog;

do $rls4429_before$
declare
  v_count int;
  r record;
begin
  if (select provolatile from pg_proc where oid = 'public.has_app_access(uuid,public.app_name)'::regprocedure) <> 's' then
    raise exception 'public.has_app_access(uuid,public.app_name) must be STABLE';
  end if;

  select count(*) into v_count
  from pg_policies
  where (schemaname, tablename, policyname) in (
    ('public','style_guide_file_tags','style_guide_file_tags_read'),
    ('public','style_guide_tag_aliases','style_guide_tag_aliases_read'),
    ('public','style_guide_tagging_state','style_guide_tagging_state_read'),
    ('public','style_guide_tags','style_guide_tags_read')
  );
  if v_count <> 4 then
    raise exception 'expected 4 target style-guide policies, found %', v_count;
  end if;

  for r in
    select policyname, tablename, qual, with_check
    from pg_policies
    where (schemaname, tablename, policyname) in (
      ('public','style_guide_file_tags','style_guide_file_tags_read'),
      ('public','style_guide_tag_aliases','style_guide_tag_aliases_read'),
      ('public','style_guide_tagging_state','style_guide_tagging_state_read'),
      ('public','style_guide_tags','style_guide_tags_read')
    )
  loop
    if r.qual is distinct from 'has_app_access(_user_id => auth.uid(), _app => ''styleguides''::app_name)' then
      raise exception 'policy %.% qual drifted: %', r.tablename, r.policyname, r.qual;
    end if;
    if r.with_check is not null then
      raise exception 'policy %.% with_check should be null, got: %', r.tablename, r.policyname, r.with_check;
    end if;
  end loop;
end
$rls4429_before$;

ALTER POLICY "style_guide_file_tags_read" ON "public"."style_guide_file_tags"
  USING (( SELECT has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

ALTER POLICY "style_guide_tag_aliases_read" ON "public"."style_guide_tag_aliases"
  USING (( SELECT has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

ALTER POLICY "style_guide_tagging_state_read" ON "public"."style_guide_tagging_state"
  USING (( SELECT has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

ALTER POLICY "style_guide_tags_read" ON "public"."style_guide_tags"
  USING (( SELECT has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

do $rls4429_after$
declare
  v_count int;
  r record;
begin
  select count(*) into v_count
  from pg_policies
  where (schemaname, tablename, policyname) in (
    ('public','style_guide_file_tags','style_guide_file_tags_read'),
    ('public','style_guide_tag_aliases','style_guide_tag_aliases_read'),
    ('public','style_guide_tagging_state','style_guide_tagging_state_read'),
    ('public','style_guide_tags','style_guide_tags_read')
  )
  and qual like '%( SELECT has_app_access(%';
  if v_count <> 4 then
    raise exception 'after-guard: expected 4 wrapped style-guide policies, found %', v_count;
  end if;

  for r in
    select policyname, tablename, qual, with_check
    from pg_policies
    where (schemaname, tablename, policyname) in (
      ('public','style_guide_file_tags','style_guide_file_tags_read'),
      ('public','style_guide_tag_aliases','style_guide_tag_aliases_read'),
      ('public','style_guide_tagging_state','style_guide_tagging_state_read'),
      ('public','style_guide_tags','style_guide_tags_read')
    )
  loop
    if r.qual is null or position('( SELECT has_app_access(' in r.qual) = 0 then
      raise exception 'policy %.% qual not wrapped: %', r.tablename, r.policyname, r.qual;
    end if;
    if r.with_check is not null then
      raise exception 'policy %.% with_check should remain null, got: %', r.tablename, r.policyname, r.with_check;
    end if;
  end loop;
end
$rls4429_after$;
