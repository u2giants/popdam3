-- =====================================================================================
-- Issue #862 -- pin a non-mutable search_path on five SECURITY DEFINER functions.
--
-- THE DEFECT
--   These five functions are owned by `postgres` and run SECURITY DEFINER, but their
--   `pg_proc.proconfig` carries NO `search_path=` entry. A SECURITY DEFINER function
--   with a mutable search_path resolves every unqualified name using the CALLER's
--   search_path. Any role that can create an object in a schema that lands earlier in
--   that path can shadow a table or a built-in function the body relies on, and the
--   shadowed object then executes as `postgres`. That is privilege escalation.
--
--   Severity is capped today because `anon` cannot execute any of the five, but a
--   mutable path on a definer function is a latent hole, not a style complaint.
--
-- THE FIVE (verified against live pg_proc on 2026-08-13, before this migration):
--   public.bulk_insert_pdf_text_samples(jsonb)   prosecdef=t  proconfig=NULL
--   public.claim_pdf_backfill_batch(integer)     prosecdef=t  proconfig=NULL
--   public.count_pdf_backfill_remaining()        prosecdef=t  proconfig=NULL
--   public.find_ai_pdf_duplicates()              prosecdef=t  proconfig=NULL
--   public.get_ai_sentinel_stats()               prosecdef=t  proconfig=NULL
--   NO OVERLOADS EXIST for any of the five names, in any schema. Each name resolves to
--   exactly one function, so the five ALTERs below cover the whole surface. (An
--   `alter function` needs the full signature, and a missed overload would be silently
--   left unfixed -- which is why this was checked rather than assumed.)
--
-- WHY `alter function ... set search_path`, NOT `create or replace`
--   `alter function ... set` changes ONLY proconfig. The bodies, signatures, volatility,
--   owners, comments and grants are untouched, so there is no way for this migration to
--   accidentally ship a stale body over a newer one. All five have live consumers in
--   popdam3 and the smallest possible change is the correct one.
--
-- WHY `pg_catalog, public` -- AND WHY pg_catalog IS FIRST
--   Every object each body touches was enumerated from pg_proc.prosrc and resolved:
--
--     public.assets                       (table, public)
--     public.pdf_text_samples             (table, public)
--     public.ai_sentinel_cleanup_log      (table, public)
--     public.is_style_guide_source_pdf    (already schema-qualified in the bodies)
--     public.parse_pdf_files_used         (reached indirectly, see the trigger note)
--     types file_type / asset enums       (public)
--     jsonb_array_elements, now, count, coalesce, nullif, lower, regexp_replace,
--     jsonb_build_object, gen_random_uuid  (all pg_catalog)
--
--   NOTHING resolves to `extensions`, `auth`, `storage`, `app`, `core`, `plm` or any
--   other schema, so `pg_catalog, public` is sufficient and nothing had to be widened
--   or re-qualified.
--
--   pg_catalog is listed FIRST on purpose. Postgres implicitly searches pg_catalog
--   first anyway when it is not named, so this is not a behaviour change -- it is the
--   explicit form. Writing it first is what actually closes the escalation path being
--   fixed: with `public` ahead of pg_catalog, a role holding CREATE on public could
--   define e.g. `public.count(...)` or `public.now()` and have a definer function
--   owned by `postgres` call it. There is no name in these bodies that collides with
--   pg_catalog, so ordering costs nothing here and removes the shadowing class.
--
--   `pg_temp` is deliberately ABSENT. Including it in a definer function's path is the
--   textbook version of this same vulnerability.
--
-- THE ONE INDIRECT PATH, STATED PLAINLY (bulk_insert_pdf_text_samples)
--   Its INSERT into public.pdf_text_samples fires two triggers:
--     trg_dam_search_pdf_text_samples_refresh -> public.trg_refresh_dam_pdf_search_document
--        SECURITY DEFINER and ALREADY pinned (`search_path=public`); it calls
--        public.refresh_dam_search_asset_document schema-qualified. Unaffected by this
--        migration.
--     trg_pdf_text_samples_parse_files -> public.trg_fn_parse_pdf_files_used
--        SECURITY INVOKER with NO pinned path, and it calls `parse_pdf_files_used`
--        UNQUALIFIED. It therefore inherits whatever path is in effect at execution
--        time -- which, after this migration, is `pg_catalog, public` inside the RPC.
--        public.parse_pdf_files_used exists in `public`, so it still resolves.
--        (In the RPC's normal path this trigger returns early anyway: the function
--        sets app.skip_parse_pdf_trigger = '1'. `SET LOCAL` of a custom GUC is
--        unaffected by search_path.)
--   That trigger function is NOT touched here. It is SECURITY INVOKER, so it is not
--   the vulnerability class #862 is about, and re-pointing it belongs to its own claim.
--
-- SCOPE / SAFETY
--   Additive and idempotent. No table, column, view, policy, grant or body changes.
--   Re-running it is a no-op. There is no data change and nothing to reverse beyond
--   the inverse `alter function ... reset search_path`.
--
-- CONTRACT TESTS: supabase/tests/secdef_search_path_pdf_ai_contracts.sql -- which
--   asserts BOTH that proconfig is now pinned AND that all five still return correct
--   results afterwards, because the first alone only proves the ALTER ran.
-- =====================================================================================

alter function public.bulk_insert_pdf_text_samples(jsonb)  set search_path = pg_catalog, public;
alter function public.claim_pdf_backfill_batch(integer)    set search_path = pg_catalog, public;
alter function public.count_pdf_backfill_remaining()       set search_path = pg_catalog, public;
alter function public.find_ai_pdf_duplicates()             set search_path = pg_catalog, public;
alter function public.get_ai_sentinel_stats()              set search_path = pg_catalog, public;

-- Self-verification. "The migration applied" is a statement about the ledger, not about
-- the database, so assert the catalog fact here and fail the apply if it is not true.
do $$
declare
  v_missing text;
begin
  select string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
    into v_missing
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (
      'bulk_insert_pdf_text_samples',
      'claim_pdf_backfill_batch',
      'count_pdf_backfill_remaining',
      'find_ai_pdf_duplicates',
      'get_ai_sentinel_stats')
    and p.prosecdef
    and not coalesce(p.proconfig, '{}'::text[]) && array['search_path=pg_catalog, public'];

  if v_missing is not null then
    raise exception '20260813020000 FAILED: these SECURITY DEFINER function(s) still '
      'lack the pinned search_path pg_catalog, public: %. If an OVERLOAD appeared after '
      'this migration was written, it needs its own alter function line -- do not edit '
      'this applied file, add a later migration.', v_missing;
  end if;
end
$$;
