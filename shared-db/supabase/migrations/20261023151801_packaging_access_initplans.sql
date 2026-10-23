-- Issue #4430; claim #4681; reserved version 20261023151801.
-- Wrap only qualified constant helper subexpressions in 2 packaging policies.
-- Role predicates, OR branches and email exception behavior preserved exactly.
-- catalog-verification: policies only (ALTER POLICY expressions); no new relations.

set local search_path = core, app, auth, public, pg_catalog;

do $rls4430_before$
declare
  v_count int;
  r record;
begin
  if (select provolatile from pg_proc where oid = 'app.has_role(app.app_role)'::regprocedure) <> 's' then
    raise exception 'app.has_role(app.app_role) must be STABLE';
  end if;
  if (select provolatile from pg_proc where oid = 'app.has_any_role(app.app_role[])'::regprocedure) <> 's' then
    raise exception 'app.has_any_role(app.app_role[]) must be STABLE';
  end if;

  select count(*) into v_count
  from pg_policies
  where (schemaname, tablename, policyname) in (
    ('core','packaging_type','admin_or_packaging_manager_write'),
    ('core','packaging_type','shared_read')
  );
  if v_count <> 2 then
    raise exception 'expected 2 target packaging policies, found %', v_count;
  end if;

  for r in
    select policyname, qual, with_check
    from pg_policies
    where (schemaname, tablename, policyname) in (
      ('core','packaging_type','admin_or_packaging_manager_write'),
      ('core','packaging_type','shared_read')
    )
  loop
    if r.policyname = 'admin_or_packaging_manager_write' then
      if r.qual is distinct from '(has_role(''administrator''::app_role) OR (lower(COALESCE((jwt() ->> ''email''::text), ''''::text)) = ''apinilla@popcre.com''::text))' then
        raise exception 'policy %.% qual drifted: %', r.policyname, 'packaging_type', r.qual;
      end if;
      if r.with_check is distinct from r.qual then
        raise exception 'policy %.% with_check drifted from qual', r.policyname, 'packaging_type';
      end if;
    else
      if r.qual is distinct from '(has_role(''administrator''::app_role) OR has_any_role(ARRAY[''sales''::app_role, ''licensing''::app_role, ''designer''::app_role, ''viewer''::app_role, ''vendor''::app_role]) OR (lower(COALESCE((jwt() ->> ''email''::text), ''''::text)) = ''apinilla@popcre.com''::text))' then
        raise exception 'policy %.% qual drifted: %', r.policyname, 'packaging_type', r.qual;
      end if;
      if r.with_check is not null then
        raise exception 'policy %.% with_check should be null, got: %', r.policyname, 'packaging_type', r.with_check;
      end if;
    end if;
  end loop;
end
$rls4430_before$;

ALTER POLICY "admin_or_packaging_manager_write" ON "core"."packaging_type"
  USING ((( SELECT has_role('administrator'::app_role) AS has_role) OR (lower(COALESCE((jwt() ->> 'email'::text), ''::text)) = 'apinilla@popcre.com'::text)))
  WITH CHECK ((( SELECT has_role('administrator'::app_role) AS has_role) OR (lower(COALESCE((jwt() ->> 'email'::text), ''::text)) = 'apinilla@popcre.com'::text)));

ALTER POLICY "shared_read" ON "core"."packaging_type"
  USING ((( SELECT has_role('administrator'::app_role) AS has_role) OR ( SELECT has_any_role(ARRAY['sales'::app_role, 'licensing'::app_role, 'designer'::app_role, 'viewer'::app_role, 'vendor'::app_role]) AS has_any_role) OR (lower(COALESCE((jwt() ->> 'email'::text), ''::text)) = 'apinilla@popcre.com'::text)));

do $rls4430_after$
declare
  v_count int;
  r record;
begin
  select count(*) into v_count
  from pg_policies
  where (schemaname, tablename, policyname) in (
    ('core','packaging_type','admin_or_packaging_manager_write'),
    ('core','packaging_type','shared_read')
  )
  and (qual like '%( SELECT has_role(%' or qual like '%( SELECT has_any_role(%');
  if v_count <> 2 then
    raise exception 'after-guard: expected 2 wrapped packaging policies, found %', v_count;
  end if;

  for r in
    select policyname, qual, with_check
    from pg_policies
    where (schemaname, tablename, policyname) in (
      ('core','packaging_type','admin_or_packaging_manager_write'),
      ('core','packaging_type','shared_read')
    )
  loop
    if r.qual is null or position('( SELECT has_role(' in r.qual) = 0 then
      raise exception 'policy %.% qual missing wrapped has_role: %', r.policyname, 'packaging_type', r.qual;
    end if;
    if r.policyname = 'shared_read' and position('( SELECT has_any_role(' in r.qual) = 0 then
      raise exception 'policy %.% qual missing wrapped has_any_role: %', r.policyname, 'packaging_type', r.qual;
    end if;
    if position('apinilla@popcre.com' in coalesce(r.qual,'') || coalesce(r.with_check,'')) = 0 then
      raise exception 'policy %.% lost the email exception', r.policyname, 'packaging_type';
    end if;
    if r.policyname = 'admin_or_packaging_manager_write' and (r.with_check is null or position('( SELECT has_role(' in r.with_check) = 0) then
      raise exception 'policy admin_or_packaging_manager_write with_check not wrapped';
    end if;
    if r.policyname = 'shared_read' and r.with_check is not null then
      raise exception 'policy shared_read with_check should remain null';
    end if;
  end loop;
end
$rls4430_after$;
