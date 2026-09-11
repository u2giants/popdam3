-- #2662 batch 1: close cross-application reads through definer-semantics views.
-- A PopDAM viewer read every CRM customer through api.crm_account_list and
-- api.crm_customer_list, which carry no caller check. Both keep definer
-- semantics (the logo lookup reads an administrator-only import table, and
-- eight CRM profiles hold no role that core.customer RLS would admit), and gain
-- the same app.has_app_access('crm') gate api.crm_contact_list already applies.
-- CRM users (and administrators) see identical rows; other applications see none.
-- Both are pinned to definer semantics explicitly: flipping them to caller
-- semantics would silently empty them for those role-less CRM profiles.
-- The gate is false for a session with no user JWT (service_role key), so such
-- readers get zero rows; no service_role reader of either view is known.
-- The remaining four switch to caller semantics because what they read already
-- expresses the same audience, so results are identical for every caller:
--   api.crm_ingested_domain_list  -> crm.ingested_domain crm_read policy
--   api.crm_contact_segment_list  -> api.crm_contact_list, NOT base-table RLS:
--                                    it stays safe only while that view keeps
--                                    definer semantics and its CRM gate, which
--                                    the assertions below enforce
--   api.crm_contact_segment_counts-> api.crm_contact_segment_list (same coupling)
--   public.sg_archive_usage       -> public.sku_files_used ("authenticated read"),
--                                    public.style_guide_files ("authenticated read
--                                    style_guide_files", ci-bootstrap baseline) and
--                                    public.style_groups ("Authenticated users can
--                                    read style_groups", 20260729210000): each a
--                                    permissive SELECT policy to authenticated
--                                    using (true), plus the SELECT grant; the
--                                    assertions below refuse the flip otherwise
-- Columns, grants and comments are unchanged.
-- derived-from: 20260717125909

set local lock_timeout='2s';
set local statement_timeout='30s';

create or replace view api.crm_customer_list with (security_invoker = false) as
 SELECT c.id, c.name, c.domain,
    api.crm_customer_logo_url(c.metadata, logo.logo_url) AS logo_url,
    c.customer_status, c.chain_type, c.routing_aliases, c.so_patterns,
    c.company_type, c.status, c.primary_salesperson_profile_id,
    c.account_owner_profile_id, c.updated_at, c.is_potential, c.display_name
   FROM core.customer c
     LEFT JOIN LATERAL ( SELECT ci.logo_url FROM plm.customer_import ci
          WHERE ci.company_id = c.id AND NULLIF(ci.logo_url, ''::text) IS NOT NULL
          ORDER BY ci.updated_at DESC NULLS LAST, ci.imported_at DESC NULLS LAST
         LIMIT 1) logo ON true
  WHERE (SELECT app.has_app_access('crm'::app.app_name));

create or replace view api.crm_account_list with (security_invoker = false) as
 SELECT id, name, domain, customer_status, chain_type, routing_aliases, so_patterns,
    company_type, status, primary_salesperson_profile_id, account_owner_profile_id,
    updated_at, is_potential, display_name
   FROM core.customer c
  WHERE (SELECT app.has_app_access('crm'::app.app_name));

alter view api.crm_ingested_domain_list set (security_invoker = true);
alter view api.crm_contact_segment_list set (security_invoker = true);
alter view api.crm_contact_segment_counts set (security_invoker = true);
alter view public.sg_archive_usage set (security_invoker = true);

do $$
declare
  v_obj regclass;
begin
  foreach v_obj in array array[
    'api.crm_ingested_domain_list'::regclass, 'api.crm_contact_segment_list'::regclass,
    'api.crm_contact_segment_counts'::regclass, 'public.sg_archive_usage'::regclass]
  loop
    if not exists (select 1 from pg_class where oid = v_obj
                   and 'security_invoker=true' = any(coalesce(reloptions, '{}'))) then
      raise exception '#2662: % is not security_invoker', v_obj;
    end if;
  end loop;
  -- The two gated views, plus api.crm_contact_list that the segment views now
  -- rely on: definer semantics, the CRM gate present, and no OR that could widen it.
  foreach v_obj in array array[
    'api.crm_customer_list'::regclass, 'api.crm_account_list'::regclass,
    'api.crm_contact_list'::regclass]
  loop
    if pg_get_viewdef(v_obj, true) not ilike '%app.has_app_access(''crm''::app.app_name)%'
       or pg_get_viewdef(v_obj, true) ~* '\mor\M' then
      raise exception '#2662: % lost its CRM caller gate', v_obj;
    end if;
    if exists (select 1 from pg_class where oid = v_obj
               and 'security_invoker=true' = any(coalesce(reloptions, '{}'))) then
      raise exception '#2662: % must keep definer semantics', v_obj;
    end if;
  end loop;
  foreach v_obj in array array[
    'api.crm_customer_list'::regclass, 'api.crm_account_list'::regclass,
    'api.crm_ingested_domain_list'::regclass, 'api.crm_contact_segment_list'::regclass,
    'api.crm_contact_segment_counts'::regclass, 'public.sg_archive_usage'::regclass]
  loop
    if not has_table_privilege('authenticated', v_obj, 'SELECT')
       or has_table_privilege('anon', v_obj, 'SELECT') then
      raise exception '#2662: read grants changed on %', v_obj;
    end if;
  end loop;
  -- public.sg_archive_usage now reads its base tables as the caller, so every
  -- authenticated caller must keep both the grant and an open read policy.
  foreach v_obj in array array[
    'public.sku_files_used'::regclass, 'public.style_guide_files'::regclass,
    'public.style_groups'::regclass]
  loop
    if not has_table_privilege('authenticated', v_obj, 'SELECT')
       or not exists (
         select 1 from pg_policy pol
         where pol.polrelid = v_obj
           and pol.polpermissive
           and pol.polcmd in ('r', '*')
           and ('authenticated'::regrole::oid = any(pol.polroles) or 0::oid = any(pol.polroles))
           and pg_get_expr(pol.polqual, pol.polrelid) = 'true') then
      raise exception '#2662: authenticated callers cannot read all rows of %; sg_archive_usage must not switch to caller semantics', v_obj;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
