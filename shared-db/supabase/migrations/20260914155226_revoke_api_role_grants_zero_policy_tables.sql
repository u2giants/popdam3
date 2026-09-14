-- Issue #2662 (Part A) — revoke Data API role grants on four RLS-enabled, zero-policy tables.
-- Claim #2812; reserved version 20260914155226.
-- derived-from: none
--
-- This migration restates no earlier migration's body. It only removes two role
-- grants and re-asserts RLS, so it carries no base.
--
-- WHY
-- `public.ai_sentinel_cleanup_log`, `public.dam_search_documents`,
-- `public.dam_search_synonyms` and `public.scanner_ai_ignores` each have RLS
-- ENABLED with ZERO policies, yet carry full ALL (arwdDxtm) privilege for both
-- `anon` and `authenticated`. Today every Data API read and write from those two
-- roles is denied, but it is denied ONLY because an empty policy set denies all.
-- The grant is the real control surface and it is wide open: one permissive
-- policy added later for an unrelated reason would silently expose all four
-- tables — full SELECT/INSERT/UPDATE/DELETE — to every browser caller,
-- including anonymous ones.
--
-- Evidence: docs/verification/database-efficiency/20260910T002917Z/api-access-matrix.md
-- (finding 1), re-derived against production on 2026-09-11 with
-- `has_table_privilege` against `pg_class` — NOT `information_schema.role_table_grants`,
-- which silently returns a false negative for these roles and reports no grants at all.
--
-- BEHAVIOURAL IMPACT: none today.
-- `anon` and `authenticated` are already denied on all four tables by RLS, so
-- this migration removes a grant that is currently unusable: nothing that works
-- today stops working. `service_role` and `postgres` bypass RLS and keep their
-- privileges untouched, so every server-side writer is unaffected. That is not
-- an assumption — production edge logs for the 24 hours to 2026-09-11 show the
-- only live traffic to any of these four tables is five successful inserts into
-- `public.scanner_ai_ignores` from a Supabase Edge Function
-- (`Deno/SupabaseEdgeRuntime`, `supabase-js-deno`). Those succeed against an
-- RLS-enabled table with no policies, which is only possible by bypassing RLS,
-- i.e. on the service role. The other three tables saw no Data API traffic at all.
--
-- SCOPE: this migration deliberately does NOT touch the definer views and
-- materialized views in the same finding. Those can break live applications and
-- carry a business judgement that belongs to the owner; they remain open under
-- issue #2662 and are planned separately, not applied here.

-- `anon` and `authenticated` are named grantees, so revoking PUBLIC alone would
-- leave them in place. Revoke each explicitly and statically (no dynamic SQL).
REVOKE ALL ON TABLE public.ai_sentinel_cleanup_log FROM anon;
REVOKE ALL ON TABLE public.ai_sentinel_cleanup_log FROM authenticated;

REVOKE ALL ON TABLE public.dam_search_documents FROM anon;
REVOKE ALL ON TABLE public.dam_search_documents FROM authenticated;

REVOKE ALL ON TABLE public.dam_search_synonyms FROM anon;
REVOKE ALL ON TABLE public.dam_search_synonyms FROM authenticated;

REVOKE ALL ON TABLE public.scanner_ai_ignores FROM anon;
REVOKE ALL ON TABLE public.scanner_ai_ignores FROM authenticated;

-- Keep RLS enabled. It remains the second layer of defence and its empty policy
-- set continues to deny all. This migration removes the reliance on that empty
-- set being the ONLY control; it does not replace it.
ALTER TABLE public.ai_sentinel_cleanup_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dam_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dam_search_synonyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanner_ai_ignores ENABLE ROW LEVEL SECURITY;

-- Verification (read-only, run after apply):
--   SELECT c.relname,
--          has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
--          c.relrowsecurity,
--          c.relacl::text
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN ('ai_sentinel_cleanup_log', 'dam_search_documents',
--                        'dam_search_synonyms', 'scanner_ai_ignores');
-- Expected on all four rows: anon_select = false, auth_select = false,
-- relrowsecurity = true, and neither `anon` nor `authenticated` present in relacl.
