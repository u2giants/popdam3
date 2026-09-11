-- Contracts for 20260905063701_style_tracker_rows_realtime_publication.sql (issue #2331).
--
-- What is being pinned:
--   1. public.style_tracker_rows exists and still has its primary key, because DEFAULT
--      replica identity is what makes the publication usable without REPLICA IDENTITY FULL.
--   2. Where the supabase_realtime publication exists, public.style_tracker_rows is a
--      member of it.
--   3. The migration changed nothing else about the table: RLS is still enabled and the
--      open INSERT/UPDATE policies of AGENTS.md §0.4 are still present.
--
-- The publication itself is created by the Supabase platform rather than by this
-- repository's migration history, so an environment without a realtime stack is reported
-- as an explicit skip. Every other assertion is unconditional and fails closed.

begin;

do $contracts$
declare
  v_publication_exists boolean;
  v_published boolean;
  v_has_pk boolean;
  v_rls_enabled boolean;
  v_insert_policies integer;
  v_update_policies integer;
begin
  if to_regclass('public.style_tracker_rows') is null then
    raise exception 'CONTRACT: public.style_tracker_rows is missing; issue #2331 published a table that no longer exists.';
  end if;

  select exists (
    select 1
    from pg_constraint
    where conrelid = 'public.style_tracker_rows'::regclass
      and contype = 'p'
  ) into v_has_pk;

  if v_has_pk is distinct from true then
    raise exception 'CONTRACT: public.style_tracker_rows has no primary key, so DEFAULT replica identity cannot carry a key for postgres_changes. Issue #2331 relies on that primary key instead of REPLICA IDENTITY FULL.';
  end if;

  select relrowsecurity
    into v_rls_enabled
  from pg_class
  where oid = 'public.style_tracker_rows'::regclass;

  if v_rls_enabled is distinct from true then
    raise exception 'CONTRACT: row-level security is no longer enabled on public.style_tracker_rows; publishing the table must not have altered its security behaviour.';
  end if;

  select count(*) filter (where cmd = 'INSERT'),
         count(*) filter (where cmd = 'UPDATE')
    into v_insert_policies, v_update_policies
  from pg_policies
  where schemaname = 'public'
    and tablename = 'style_tracker_rows';

  if v_insert_policies < 1 or v_update_policies < 1 then
    raise exception 'CONTRACT: public.style_tracker_rows lost its INSERT or UPDATE policy (insert=%, update=%). AGENTS.md 0.4 keeps Master Data writes open to every signed-in user.',
      v_insert_policies, v_update_policies;
  end if;

  select exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    into v_publication_exists;

  if not v_publication_exists then
    raise notice 'SKIP: the supabase_realtime publication does not exist in this database, so publication membership cannot be asserted here. It is verified on preview and production.';
    return;
  end if;

  select exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'style_tracker_rows'
  ) into v_published;

  if v_published is distinct from true then
    raise exception 'CONTRACT: public.style_tracker_rows is not a member of the supabase_realtime publication, so no postgres_changes subscription can receive DAM Styles edits (issue #2331).';
  end if;

  raise notice 'OK: public.style_tracker_rows is published by supabase_realtime with its primary key, RLS and open write policies intact.';
end $contracts$;

-- Positive control: the membership predicate used above must be able to answer "no".
-- A checker that cannot fail is not evidence (see the repository's own guard-truth rules).
do $control$
declare
  v_false_positive boolean;
begin
  select exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'style_tracker_rows_this_table_does_not_exist'
  ) into v_false_positive;

  if v_false_positive then
    raise exception 'CONTROL: the publication-membership predicate reports a table that cannot exist as published; the check above proves nothing.';
  end if;

  raise notice 'OK: publication-membership predicate returns false for an absent table.';
end $control$;

rollback;
