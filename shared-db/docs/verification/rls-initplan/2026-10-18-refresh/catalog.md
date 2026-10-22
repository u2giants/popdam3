# Fresh production catalog for #4426

Read-only snapshot from verified production API qsllyeztdwjgirsysgai.supabase.co, October 18, 2026 EDT. No row data fetched. All targeted policy expressions, overlapping policies, grants, RLS flags and helper identities follow. Snapshot is evidence, not custody or write authorization.

```json
{
  "grants": null,
  "helpers": [
    {
      "acl": "{=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}",
      "oid": "16542",
      "config": null,
      "identity": "auth.uid()",
      "definition": "CREATE OR REPLACE FUNCTION auth.uid()\n RETURNS uuid\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.sub', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')\n  )::uuid\n$function$\n",
      "volatility": "s",
      "security_definer": false
    },
    {
      "acl": "{=X/supabase_auth_admin,postgres=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}",
      "oid": "16714",
      "config": null,
      "identity": "auth.jwt()",
      "definition": "CREATE OR REPLACE FUNCTION auth.jwt()\n RETURNS jsonb\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n    coalesce(\n        nullif(current_setting('request.jwt.claim', true), ''),\n        nullif(current_setting('request.jwt.claims', true), '')\n    )::jsonb\n$function$\n",
      "volatility": "s",
      "security_definer": false
    },
    {
      "acl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
      "oid": "17973",
      "config": [
        "search_path=public"
      ],
      "identity": "has_role(uuid,app_role)",
      "definition": "CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  SELECT EXISTS (\n    SELECT 1 FROM public.user_roles\n    WHERE user_id = _user_id AND role = _role\n  )\n$function$\n",
      "volatility": "s",
      "security_definer": true
    },
    {
      "acl": "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
      "oid": "18627",
      "config": [
        "search_path=public"
      ],
      "identity": "has_app_access(uuid,app_name)",
      "definition": "CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid, _app app_name)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  SELECT EXISTS (\n    SELECT 1 FROM public.app_access\n    WHERE user_id = _user_id AND app = _app\n  )\n$function$\n",
      "volatility": "s",
      "security_definer": true
    },
    {
      "acl": "{=X/postgres,postgres=X/postgres,service_role=X/postgres}",
      "oid": "101873",
      "config": [
        "search_path=app, public"
      ],
      "identity": "app.current_profile_id()",
      "definition": "CREATE OR REPLACE FUNCTION app.current_profile_id()\n RETURNS uuid\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'app', 'public'\nAS $function$\n  select p.id\n  from app.profile p\n  where p.auth_user_id = auth.uid()\n    and p.status = 'active'\n  limit 1;\n$function$\n",
      "volatility": "s",
      "security_definer": true
    },
    {
      "acl": "{=X/postgres,postgres=X/postgres,service_role=X/postgres}",
      "oid": "101874",
      "config": [
        "search_path=app, public"
      ],
      "identity": "app.has_role(app.app_role)",
      "definition": "CREATE OR REPLACE FUNCTION app.has_role(required_role app.app_role)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'app', 'public'\nAS $function$\n  select exists (\n    select 1\n    from app.user_role ur\n    join app.role r on r.id = ur.role_id\n    where ur.profile_id = app.current_profile_id()\n      and r.slug = required_role\n      and ur.revoked_at is null\n  )\n  or lower(required_role::text) = any(app.jwt_role_names());\n$function$\n",
      "volatility": "s",
      "security_definer": true
    },
    {
      "acl": "{=X/postgres,postgres=X/postgres,service_role=X/postgres}",
      "oid": "101875",
      "config": [
        "search_path=app, public"
      ],
      "identity": "app.has_any_role(app.app_role[])",
      "definition": "CREATE OR REPLACE FUNCTION app.has_any_role(required_roles app.app_role[])\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'app', 'public'\nAS $function$\n  select exists (\n    select 1\n    from unnest(required_roles) as required_role\n    where app.has_role(required_role)\n  );\n$function$\n",
      "volatility": "s",
      "security_definer": true
    }
  ],
  "table_metadata": [
    {
      "acl": "{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_group_tags",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "asset_tags",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "user_roles",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "render_queue",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "ai_tag_bakeoff_runs",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_tagging_state",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "characters",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_tags",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "helper_devices",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "processing_queue",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "invitations",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_file_tags",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "agent_registrations",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_crawl_runs",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "erp_items_raw",
      "schema": "archive",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "agent_pairings",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "hygiene_findings",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "app_access",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "asset_characters",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_groups",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=arwd/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "packaging_type",
      "schema": "core",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "product_types",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "product_subtypes",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "order_list_user_views",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_files",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "tiff_optimization_queue",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "profiles",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "prod_order_headers_current",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "helper_tokens",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "assets",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_tag_aliases",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "prod_order_sync_runs",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "admin_config",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_tracker_rows",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "ai_tag_bakeoff_reviews",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_tracker_user_views",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "asset_checkouts",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwd/postgres,authenticated=r/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "legacy_erp_item_identity",
      "schema": "plm",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "prod_order_headers_raw",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "erp_enrichment_log",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "licensors",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "ai_tag_bakeoff_results",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "style_guide_render_queue",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "pdf_text_samples",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "properties",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "product_categories",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "erp_items_current",
      "schema": "archive",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "erp_sync_runs",
      "schema": "public",
      "force_rls": false
    },
    {
      "acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}",
      "rls": true,
      "owner": "postgres",
      "table": "product_category_predictions",
      "schema": "public",
      "force_rls": false
    }
  ],
  "target_policies": [
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "assets",
      "permissive": "PERMISSIVE",
      "policyname": "Admins can insert assets",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "871431f621554a775f436516af6ab4fd"
    },
    {
      "cmd": "UPDATE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "assets",
      "permissive": "PERMISSIVE",
      "policyname": "Admins can update assets",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "licensors",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write licensors",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "properties",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write properties",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "characters",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write characters",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_categories",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write product_categories",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_types",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write product_types",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_subtypes",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write product_subtypes",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_characters",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write asset_characters",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "processing_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage processing_queue",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "render_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage render_queue",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "agent_registrations",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage agent_registrations",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Users read own profile",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Users update own profile",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Admins read all profiles",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "user_roles",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage user_roles",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "invitations",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage invitations",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write admin_config",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "871431f621554a775f436516af6ab4fd"
    },
    {
      "cmd": "UPDATE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin update admin_config",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "DELETE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin delete admin_config",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "style_groups",
      "permissive": "PERMISSIVE",
      "policyname": "Admins can manage style_groups",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "agent_pairings",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage agent_pairings",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "tiff_optimization_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage tiff_optimization_queue",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_sync_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_sync_runs",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_items_raw",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_items_raw",
      "schemaname": "archive",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_items_current",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_items_current",
      "schemaname": "archive",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_category_predictions",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage product_category_predictions",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_enrichment_log",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_enrichment_log",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_tags",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage asset_tags",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "hygiene_findings",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage hygiene_findings",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_crawl_runs",
      "permissive": "PERMISSIVE",
      "policyname": "admin full access style_guide_crawl_runs",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_files",
      "permissive": "PERMISSIVE",
      "policyname": "admin full access style_guide_files",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "pdf_text_samples",
      "permissive": "PERMISSIVE",
      "policyname": "admin full access pdf_text_samples",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "app_access",
      "permissive": "PERMISSIVE",
      "policyname": "Users read own app_access",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "app_access",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage app_access",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_render_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage style_guide_render_queue",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "helper_devices",
      "permissive": "PERMISSIVE",
      "policyname": "users see own devices",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "helper_devices",
      "permissive": "PERMISSIVE",
      "policyname": "users insert own devices",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "f2ddbc79e24daf371a14e31c92b8402a"
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "helper_devices",
      "permissive": "PERMISSIVE",
      "policyname": "users update own devices",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "helper_tokens",
      "permissive": "PERMISSIVE",
      "policyname": "users see own tokens",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "helper_tokens",
      "permissive": "PERMISSIVE",
      "policyname": "users insert own tokens",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "f2ddbc79e24daf371a14e31c92b8402a"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "asset_checkouts",
      "permissive": "PERMISSIVE",
      "policyname": "users insert own checkouts",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "f2ddbc79e24daf371a14e31c92b8402a"
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "asset_checkouts",
      "permissive": "PERMISSIVE",
      "policyname": "users update own checkouts",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "prod_order_sync_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage prod_order_sync_runs",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "prod_order_headers_raw",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage prod_order_headers_raw",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "prod_order_headers_current",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage prod_order_headers_current",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read ai tag bakeoff runs",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage ai tag bakeoff runs",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_results",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read ai tag bakeoff results",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_results",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage ai tag bakeoff results",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_reviews",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read ai tag bakeoff reviews",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_reviews",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage ai tag bakeoff reviews",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_tags",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_tags_read",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "de14c144b20a57fee5fdc64715b8fbe8"
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_tag_aliases",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_tag_aliases_read",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "de14c144b20a57fee5fdc64715b8fbe8"
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_file_tags",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_file_tags_read",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "de14c144b20a57fee5fdc64715b8fbe8"
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_tagging_state",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_tagging_state_read",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "de14c144b20a57fee5fdc64715b8fbe8"
    },
    {
      "cmd": "SELECT",
      "qual": "(app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]) OR (lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)) = '<email-exception>'::text))",
      "roles": [
        "authenticated"
      ],
      "tablename": "packaging_type",
      "permissive": "PERMISSIVE",
      "policyname": "shared_read",
      "schemaname": "core",
      "with_check": null,
      "fingerprint": "45d24670c2b7fafaa8ca260a815d6816"
    },
    {
      "cmd": "ALL",
      "qual": "(app.has_role('administrator'::app.app_role) OR (lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)) = '<email-exception>'::text))",
      "roles": [
        "authenticated"
      ],
      "tablename": "packaging_type",
      "permissive": "PERMISSIVE",
      "policyname": "admin_or_packaging_manager_write",
      "schemaname": "core",
      "with_check": "(app.has_role('administrator'::app.app_role) OR (lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)) = '<email-exception>'::text))",
      "fingerprint": "a556e6008929e6a569439150eae95676"
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "Users update their own style tracker views",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "7ea2326acd7022f54ccb7566a1d93f26"
    },
    {
      "cmd": "DELETE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_rows",
      "permissive": "PERMISSIVE",
      "policyname": "Admins delete style tracker rows",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "Users read their own style tracker views",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "Users insert their own style tracker views",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "f2ddbc79e24daf371a14e31c92b8402a"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read all admin_config",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_select",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_insert",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "f2ddbc79e24daf371a14e31c92b8402a"
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_update",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())",
      "fingerprint": "7ea2326acd7022f54ccb7566a1d93f26"
    },
    {
      "cmd": "DELETE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_delete",
      "schemaname": "public",
      "with_check": null,
      "fingerprint": "5eebdfba311617743b110b29a41f23a0"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "legacy_erp_item_identity",
      "permissive": "PERMISSIVE",
      "policyname": "legacy_erp_item_identity_admin_read",
      "schemaname": "plm",
      "with_check": null,
      "fingerprint": "aa60da9c00892d94ae69ce1095686ecf"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_group_tags",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage style_group_tags",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)",
      "fingerprint": "b46d9c3b7c1d4143bf5128b497368d12"
    }
  ],
  "all_overlapping_policies": [
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_group_tags",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage style_group_tags",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_group_tags",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read style_group_tags",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_tags",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage asset_tags",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_tags",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read asset_tags",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "user_roles",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage user_roles",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "render_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage render_queue",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage ai tag bakeoff runs",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read ai tag bakeoff runs",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_tagging_state",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_tagging_state_read",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "characters",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write characters",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "characters",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read characters",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_tags",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_tags_read",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "helper_devices",
      "permissive": "PERMISSIVE",
      "policyname": "users insert own devices",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "helper_devices",
      "permissive": "PERMISSIVE",
      "policyname": "users see own devices",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "helper_devices",
      "permissive": "PERMISSIVE",
      "policyname": "users update own devices",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "processing_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage processing_queue",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "invitations",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage invitations",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_file_tags",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_file_tags_read",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "agent_registrations",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage agent_registrations",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "agent_registrations",
      "permissive": "PERMISSIVE",
      "policyname": "authenticated users can read agent_registrations",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_crawl_runs",
      "permissive": "PERMISSIVE",
      "policyname": "admin full access style_guide_crawl_runs",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_crawl_runs",
      "permissive": "PERMISSIVE",
      "policyname": "authenticated read style_guide_crawl_runs",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_items_raw",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_items_raw",
      "schemaname": "archive",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "agent_pairings",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage agent_pairings",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "hygiene_findings",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage hygiene_findings",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "app_access",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage app_access",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "app_access",
      "permissive": "PERMISSIVE",
      "policyname": "Users read own app_access",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_characters",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write asset_characters",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_characters",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read asset_characters",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "style_groups",
      "permissive": "PERMISSIVE",
      "policyname": "Admins can manage style_groups",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_groups",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated users can read style_groups",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "(app.has_role('administrator'::app.app_role) OR (lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)) = '<email-exception>'::text))",
      "roles": [
        "authenticated"
      ],
      "tablename": "packaging_type",
      "permissive": "PERMISSIVE",
      "policyname": "admin_or_packaging_manager_write",
      "schemaname": "core",
      "with_check": "(app.has_role('administrator'::app.app_role) OR (lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)) = '<email-exception>'::text))"
    },
    {
      "cmd": "SELECT",
      "qual": "(app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]) OR (lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)) = '<email-exception>'::text))",
      "roles": [
        "authenticated"
      ],
      "tablename": "packaging_type",
      "permissive": "PERMISSIVE",
      "policyname": "shared_read",
      "schemaname": "core",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_types",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write product_types",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_types",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read product_types",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_subtypes",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write product_subtypes",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_subtypes",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read product_subtypes",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "DELETE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_delete",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_insert",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_select",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "order_list_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "order_list_user_views_owner_update",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_files",
      "permissive": "PERMISSIVE",
      "policyname": "admin full access style_guide_files",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_files",
      "permissive": "PERMISSIVE",
      "policyname": "authenticated read style_guide_files",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "tiff_optimization_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage tiff_optimization_queue",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Admins read all profiles",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Users read own profile",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "profiles",
      "permissive": "PERMISSIVE",
      "policyname": "Users update own profile",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "prod_order_headers_current",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage prod_order_headers_current",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "prod_order_headers_current",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated users can read prod_order_headers_current",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "true",
      "roles": [
        "service_role"
      ],
      "tablename": "prod_order_headers_current",
      "permissive": "PERMISSIVE",
      "policyname": "Service role manages prod_order_headers_current",
      "schemaname": "public",
      "with_check": "true"
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "helper_tokens",
      "permissive": "PERMISSIVE",
      "policyname": "users insert own tokens",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "helper_tokens",
      "permissive": "PERMISSIVE",
      "policyname": "users see own tokens",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "assets",
      "permissive": "PERMISSIVE",
      "policyname": "Admins can insert assets",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "UPDATE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "assets",
      "permissive": "PERMISSIVE",
      "policyname": "Admins can update assets",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "(is_deleted = false)",
      "roles": [
        "authenticated"
      ],
      "tablename": "assets",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated users can read visible assets",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_app_access(_user_id => auth.uid(), _app => 'styleguides'::app_name)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_tag_aliases",
      "permissive": "PERMISSIVE",
      "policyname": "style_guide_tag_aliases_read",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "prod_order_sync_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage prod_order_sync_runs",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "ALL",
      "qual": "true",
      "roles": [
        "service_role"
      ],
      "tablename": "prod_order_sync_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Service role manages prod_order_sync_runs",
      "schemaname": "public",
      "with_check": "true"
    },
    {
      "cmd": "DELETE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin delete admin_config",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read all admin_config",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin update admin_config",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write admin_config",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "(key !~* '(pass|secret|token|key|cred|pwd)'::text)",
      "roles": [
        "authenticated"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read non-secret admin_config",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "(key = 'SCAN_REQUEST'::text)",
      "roles": [
        "anon"
      ],
      "tablename": "admin_config",
      "permissive": "PERMISSIVE",
      "policyname": "anon can read SCAN_REQUEST for Realtime watcher",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "DELETE",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_rows",
      "permissive": "PERMISSIVE",
      "policyname": "Admins delete style tracker rows",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_rows",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated users insert style tracker rows",
      "schemaname": "public",
      "with_check": "true"
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_rows",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated users read style tracker rows",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_rows",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated users update style tracker rows",
      "schemaname": "public",
      "with_check": "true"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_reviews",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage ai tag bakeoff reviews",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_reviews",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read ai tag bakeoff reviews",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "Users insert their own style tracker views",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "SELECT",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "Users read their own style tracker views",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_tracker_user_views",
      "permissive": "PERMISSIVE",
      "policyname": "Users update their own style tracker views",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "asset_checkouts",
      "permissive": "PERMISSIVE",
      "policyname": "authenticated users see all checkouts",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "INSERT",
      "qual": null,
      "roles": [
        "public"
      ],
      "tablename": "asset_checkouts",
      "permissive": "PERMISSIVE",
      "policyname": "users insert own checkouts",
      "schemaname": "public",
      "with_check": "(user_id = auth.uid())"
    },
    {
      "cmd": "UPDATE",
      "qual": "(user_id = auth.uid())",
      "roles": [
        "public"
      ],
      "tablename": "asset_checkouts",
      "permissive": "PERMISSIVE",
      "policyname": "users update own checkouts",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "legacy_erp_item_identity",
      "permissive": "PERMISSIVE",
      "policyname": "legacy_erp_item_identity_admin_read",
      "schemaname": "plm",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "prod_order_headers_raw",
      "permissive": "PERMISSIVE",
      "policyname": "Admins manage prod_order_headers_raw",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "ALL",
      "qual": "true",
      "roles": [
        "service_role"
      ],
      "tablename": "prod_order_headers_raw",
      "permissive": "PERMISSIVE",
      "policyname": "Service role manages prod_order_headers_raw",
      "schemaname": "public",
      "with_check": "true"
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_enrichment_log",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_enrichment_log",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "licensors",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write licensors",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "licensors",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read licensors",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_results",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage ai tag bakeoff results",
      "schemaname": "public",
      "with_check": "has_role(auth.uid(), 'admin'::app_role)"
    },
    {
      "cmd": "SELECT",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "public"
      ],
      "tablename": "ai_tag_bakeoff_results",
      "permissive": "PERMISSIVE",
      "policyname": "Admin read ai tag bakeoff results",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "style_guide_render_queue",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage style_guide_render_queue",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "pdf_text_samples",
      "permissive": "PERMISSIVE",
      "policyname": "admin full access pdf_text_samples",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "properties",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write properties",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "properties",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read properties",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_categories",
      "permissive": "PERMISSIVE",
      "policyname": "Admin write product_categories",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "SELECT",
      "qual": "true",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_categories",
      "permissive": "PERMISSIVE",
      "policyname": "Authenticated read product_categories",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_items_current",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_items_current",
      "schemaname": "archive",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "erp_sync_runs",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage erp_sync_runs",
      "schemaname": "public",
      "with_check": null
    },
    {
      "cmd": "ALL",
      "qual": "has_role(auth.uid(), 'admin'::app_role)",
      "roles": [
        "authenticated"
      ],
      "tablename": "product_category_predictions",
      "permissive": "PERMISSIVE",
      "policyname": "Admin manage product_category_predictions",
      "schemaname": "public",
      "with_check": null
    }
  ]
}
```
