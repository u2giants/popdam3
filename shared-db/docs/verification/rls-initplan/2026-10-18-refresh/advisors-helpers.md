# Fresh advisor identities and transitive helper

Read-only baseline evidence for #4426. October 18, 2026 EDT. No repair or live acceptance is claimed.

```json
{
  "advisors": [
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.assets\\` has a row level security policy \\`Admins can insert assets\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "assets",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_assets_Admins can insert assets",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.assets\\` has a row level security policy \\`Admins can update assets\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "assets",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_assets_Admins can update assets",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.licensors\\` has a row level security policy \\`Admin write licensors\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "licensors",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_licensors_Admin write licensors",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.properties\\` has a row level security policy \\`Admin write properties\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "properties",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_properties_Admin write properties",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.characters\\` has a row level security policy \\`Admin write characters\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "characters",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_characters_Admin write characters",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.product_categories\\` has a row level security policy \\`Admin write product_categories\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "product_categories",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_product_categories_Admin write product_categories",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.product_types\\` has a row level security policy \\`Admin write product_types\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "product_types",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_product_types_Admin write product_types",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.product_subtypes\\` has a row level security policy \\`Admin write product_subtypes\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "product_subtypes",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_product_subtypes_Admin write product_subtypes",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.asset_characters\\` has a row level security policy \\`Admin write asset_characters\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "asset_characters",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_asset_characters_Admin write asset_characters",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.processing_queue\\` has a row level security policy \\`Admin manage processing_queue\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "processing_queue",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_processing_queue_Admin manage processing_queue",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.render_queue\\` has a row level security policy \\`Admin manage render_queue\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "render_queue",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_render_queue_Admin manage render_queue",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.agent_registrations\\` has a row level security policy \\`Admin manage agent_registrations\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "agent_registrations",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_agent_registrations_Admin manage agent_registrations",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.profiles\\` has a row level security policy \\`Users read own profile\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "profiles",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_profiles_Users read own profile",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.profiles\\` has a row level security policy \\`Users update own profile\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "profiles",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_profiles_Users update own profile",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.profiles\\` has a row level security policy \\`Admins read all profiles\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "profiles",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_profiles_Admins read all profiles",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.user_roles\\` has a row level security policy \\`Admins manage user_roles\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "user_roles",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_user_roles_Admins manage user_roles",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.invitations\\` has a row level security policy \\`Admin manage invitations\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "invitations",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_invitations_Admin manage invitations",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.admin_config\\` has a row level security policy \\`Admin write admin_config\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "admin_config",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_admin_config_Admin write admin_config",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.admin_config\\` has a row level security policy \\`Admin update admin_config\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "admin_config",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_admin_config_Admin update admin_config",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.admin_config\\` has a row level security policy \\`Admin delete admin_config\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "admin_config",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_admin_config_Admin delete admin_config",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_groups\\` has a row level security policy \\`Admins can manage style_groups\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_groups",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_groups_Admins can manage style_groups",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.agent_pairings\\` has a row level security policy \\`Admin manage agent_pairings\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "agent_pairings",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_agent_pairings_Admin manage agent_pairings",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.tiff_optimization_queue\\` has a row level security policy \\`Admin manage tiff_optimization_queue\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "tiff_optimization_queue",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_tiff_optimization_queue_Admin manage tiff_optimization_queue",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.erp_sync_runs\\` has a row level security policy \\`Admin manage erp_sync_runs\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "erp_sync_runs",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_erp_sync_runs_Admin manage erp_sync_runs",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`archive.erp_items_raw\\` has a row level security policy \\`Admin manage erp_items_raw\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "archive",
        "name": "erp_items_raw",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_archive_erp_items_raw_Admin manage erp_items_raw",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`archive.erp_items_current\\` has a row level security policy \\`Admin manage erp_items_current\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "archive",
        "name": "erp_items_current",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_archive_erp_items_current_Admin manage erp_items_current",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.product_category_predictions\\` has a row level security policy \\`Admin manage product_category_predictions\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "product_category_predictions",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_product_category_predictions_Admin manage product_category_predictions",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.erp_enrichment_log\\` has a row level security policy \\`Admin manage erp_enrichment_log\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "erp_enrichment_log",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_erp_enrichment_log_Admin manage erp_enrichment_log",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.asset_tags\\` has a row level security policy \\`Admin manage asset_tags\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "asset_tags",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_asset_tags_Admin manage asset_tags",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.hygiene_findings\\` has a row level security policy \\`Admin manage hygiene_findings\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "hygiene_findings",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_hygiene_findings_Admin manage hygiene_findings",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_crawl_runs\\` has a row level security policy \\`admin full access style_guide_crawl_runs\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_crawl_runs",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_crawl_runs_admin full access style_guide_crawl_runs",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_files\\` has a row level security policy \\`admin full access style_guide_files\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_files",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_files_admin full access style_guide_files",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.pdf_text_samples\\` has a row level security policy \\`admin full access pdf_text_samples\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "pdf_text_samples",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_pdf_text_samples_admin full access pdf_text_samples",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.app_access\\` has a row level security policy \\`Users read own app_access\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "app_access",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_app_access_Users read own app_access",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.app_access\\` has a row level security policy \\`Admins manage app_access\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "app_access",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_app_access_Admins manage app_access",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_render_queue\\` has a row level security policy \\`Admin manage style_guide_render_queue\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_render_queue",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_render_queue_Admin manage style_guide_render_queue",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.helper_devices\\` has a row level security policy \\`users see own devices\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "helper_devices",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_helper_devices_users see own devices",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.helper_devices\\` has a row level security policy \\`users insert own devices\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "helper_devices",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_helper_devices_users insert own devices",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.helper_devices\\` has a row level security policy \\`users update own devices\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "helper_devices",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_helper_devices_users update own devices",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.helper_tokens\\` has a row level security policy \\`users see own tokens\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "helper_tokens",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_helper_tokens_users see own tokens",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.helper_tokens\\` has a row level security policy \\`users insert own tokens\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "helper_tokens",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_helper_tokens_users insert own tokens",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.asset_checkouts\\` has a row level security policy \\`users insert own checkouts\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "asset_checkouts",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_asset_checkouts_users insert own checkouts",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.asset_checkouts\\` has a row level security policy \\`users update own checkouts\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "asset_checkouts",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_asset_checkouts_users update own checkouts",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.prod_order_sync_runs\\` has a row level security policy \\`Admins manage prod_order_sync_runs\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "prod_order_sync_runs",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_prod_order_sync_runs_Admins manage prod_order_sync_runs",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.prod_order_headers_raw\\` has a row level security policy \\`Admins manage prod_order_headers_raw\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "prod_order_headers_raw",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_prod_order_headers_raw_Admins manage prod_order_headers_raw",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.prod_order_headers_current\\` has a row level security policy \\`Admins manage prod_order_headers_current\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "prod_order_headers_current",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_prod_order_headers_current_Admins manage prod_order_headers_current",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.ai_tag_bakeoff_runs\\` has a row level security policy \\`Admin read ai tag bakeoff runs\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "ai_tag_bakeoff_runs",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_ai_tag_bakeoff_runs_Admin read ai tag bakeoff runs",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.ai_tag_bakeoff_runs\\` has a row level security policy \\`Admin manage ai tag bakeoff runs\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "ai_tag_bakeoff_runs",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_ai_tag_bakeoff_runs_Admin manage ai tag bakeoff runs",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.ai_tag_bakeoff_results\\` has a row level security policy \\`Admin read ai tag bakeoff results\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "ai_tag_bakeoff_results",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_ai_tag_bakeoff_results_Admin read ai tag bakeoff results",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.ai_tag_bakeoff_results\\` has a row level security policy \\`Admin manage ai tag bakeoff results\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "ai_tag_bakeoff_results",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_ai_tag_bakeoff_results_Admin manage ai tag bakeoff results",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.ai_tag_bakeoff_reviews\\` has a row level security policy \\`Admin read ai tag bakeoff reviews\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "ai_tag_bakeoff_reviews",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_ai_tag_bakeoff_reviews_Admin read ai tag bakeoff reviews",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.ai_tag_bakeoff_reviews\\` has a row level security policy \\`Admin manage ai tag bakeoff reviews\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "ai_tag_bakeoff_reviews",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_ai_tag_bakeoff_reviews_Admin manage ai tag bakeoff reviews",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_tags\\` has a row level security policy \\`style_guide_tags_read\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_tags",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_tags_style_guide_tags_read",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_tag_aliases\\` has a row level security policy \\`style_guide_tag_aliases_read\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_tag_aliases",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_tag_aliases_style_guide_tag_aliases_read",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_file_tags\\` has a row level security policy \\`style_guide_file_tags_read\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_file_tags",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_file_tags_style_guide_file_tags_read",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_guide_tagging_state\\` has a row level security policy \\`style_guide_tagging_state_read\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_guide_tagging_state",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_guide_tagging_state_style_guide_tagging_state_read",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`core.packaging_type\\` has a row level security policy \\`shared_read\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "core",
        "name": "packaging_type",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_core_packaging_type_shared_read",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`core.packaging_type\\` has a row level security policy \\`admin_or_packaging_manager_write\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "core",
        "name": "packaging_type",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_core_packaging_type_admin_or_packaging_manager_write",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_tracker_user_views\\` has a row level security policy \\`Users update their own style tracker views\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_tracker_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_tracker_user_views_Users update their own style tracker views",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_tracker_rows\\` has a row level security policy \\`Admins delete style tracker rows\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_tracker_rows",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_tracker_rows_Admins delete style tracker rows",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_tracker_user_views\\` has a row level security policy \\`Users read their own style tracker views\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_tracker_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_tracker_user_views_Users read their own style tracker views",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_tracker_user_views\\` has a row level security policy \\`Users insert their own style tracker views\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_tracker_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_tracker_user_views_Users insert their own style tracker views",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.admin_config\\` has a row level security policy \\`Admin read all admin_config\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "admin_config",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_admin_config_Admin read all admin_config",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.order_list_user_views\\` has a row level security policy \\`order_list_user_views_owner_select\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "order_list_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_order_list_user_views_order_list_user_views_owner_select",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.order_list_user_views\\` has a row level security policy \\`order_list_user_views_owner_insert\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "order_list_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_order_list_user_views_order_list_user_views_owner_insert",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.order_list_user_views\\` has a row level security policy \\`order_list_user_views_owner_update\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "order_list_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_order_list_user_views_order_list_user_views_owner_update",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.order_list_user_views\\` has a row level security policy \\`order_list_user_views_owner_delete\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "order_list_user_views",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_order_list_user_views_order_list_user_views_owner_delete",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`plm.legacy_erp_item_identity\\` has a row level security policy \\`legacy_erp_item_identity_admin_read\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "plm",
        "name": "legacy_erp_item_identity",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_plm_legacy_erp_item_identity_legacy_erp_item_identity_admin_read",
      "observed_at": "2026-10-18T15:35:35.657Z"
    },
    {
      "name": "auth_rls_initplan",
      "title": "Auth RLS Initialization Plan",
      "level": "WARN",
      "facing": "EXTERNAL",
      "categories": [
        "PERFORMANCE"
      ],
      "description": "Detects if calls to \\`current_setting()\\` and \\`auth.<function>()\\` in RLS policies are being unnecessarily re-evaluated for each row",
      "detail": "Table \\`public.style_group_tags\\` has a row level security policy \\`Admin manage style_group_tags\\` that re-evaluates current_setting() or auth.<function>() for each row. This produces suboptimal query performance at scale. Resolve the issue by replacing \\`auth.<function>()\\` with \\`(select auth.<function>())\\`. See [docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) for more info.",
      "remediation": "https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan",
      "metadata": {
        "schema": "public",
        "name": "style_group_tags",
        "type": "table"
      },
      "cache_key": "auth_rls_init_plan_public_style_group_tags_Admin manage style_group_tags",
      "observed_at": "2026-10-18T15:35:35.657Z"
    }
  ],
  "extra_helpers": [
    {
      "oid": 101416,
      "identity": "app.jwt_role_names()",
      "provolatile": "s",
      "prosecdef": false,
      "proconfig": null,
      "proacl": "{=X/postgres,postgres=X/postgres,service_role=X/postgres}",
      "definition": "CREATE OR REPLACE FUNCTION app.jwt_role_names()\n RETURNS text[]\n LANGUAGE sql\n STABLE\nAS $function$\n  select coalesce(\n    array(\n      select lower(value::text)\n      from jsonb_array_elements_text(\n        coalesce(\n          nullif(auth.jwt() -> 'app_metadata' -> 'roles', 'null'::jsonb),\n          '[]'::jsonb\n        )\n      ) as value\n    ),\n    array[]::text[]\n  );\n$function$\n"
    }
  ]
}
```
