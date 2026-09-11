-- Issue #2331 — publish public.style_tracker_rows for DAM Styles realtime edits.
--
-- WHY
-- ---
-- Issue #810's live two-tab DAM Styles verification proved an edit saves (PATCH 204)
-- but never reaches a second open tab. Production catalog inspection showed
-- public.style_tracker_rows is absent from every pg_publication_tables row, so no
-- `postgres_changes` subscription can ever receive its updates.
--
-- SCOPE
-- -----
-- Add ONLY public.style_tracker_rows to the EXISTING supabase_realtime publication.
-- Nothing about the table, its RLS policies, its grants, its indexes or its replica
-- identity changes here. §0.4 of AGENTS.md is untouched: Master Data writes stay open
-- to every signed-in user, and this migration neither widens nor narrows that.
--
-- Replica identity is deliberately NOT changed. The table has a primary key
-- (style_tracker_rows_pkey on id), so the DEFAULT replica identity already carries the
-- key that `postgres_changes` needs to deliver INSERT/UPDATE/DELETE payloads. Setting
-- REPLICA IDENTITY FULL would be a behaviour change outside this claim and would grow
-- the WAL for a hot, frequently-edited table.
--
-- The `if exists (select 1 from pg_publication ...)` guard follows the established
-- pattern in 20260621151155_api_rls_realtime.sql: the supabase_realtime publication is
-- created by the Supabase platform, not by this migration history, so a replay against
-- a database that has no realtime stack must be a clean no-op rather than an error.
-- The membership test makes the add idempotent, so a re-apply cannot raise
-- `relation "style_tracker_rows" is already member of publication`.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication absent; skipping style_tracker_rows publication membership.';
    return;
  end if;

  if to_regclass('public.style_tracker_rows') is null then
    raise notice 'public.style_tracker_rows absent; skipping publication membership.';
    return;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'style_tracker_rows'
  ) then
    raise notice 'public.style_tracker_rows is already published by supabase_realtime; nothing to do.';
    return;
  end if;

  execute 'alter publication supabase_realtime add table public.style_tracker_rows';
end $$;
