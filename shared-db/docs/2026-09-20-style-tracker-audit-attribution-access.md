# Styles audit attribution access investigation

Investigation date: 2026-09-20. Resolves the provisional concern in [issue 3327](https://github.com/popcre/shared-db/issues/3327) (non-orchestrator investigation), originating from [issue 2662](https://github.com/popcre/shared-db/issues/2662) (bounded structural work).

## Finding

The authenticated audit projection deliberately includes actor attribution. No access outside that intended audience was demonstrated. Mirroring the narrower direct-profile policy through `security_invoker` would change existing behavior, not transparently fix a demonstrated authorization defect. No schema change is recommended by this investigation.

This report records the established contract and evidence; it does not introduce a new business rule or claim fresh authenticated browser verification.

## Applied contract

[PR 326](https://github.com/popcre/shared-db/pull/326), merged on 2026-07-29 as `35e8dee6caee4e7fab362fd9d694b7cdacfd4fce`, deliberately revoked anonymous access while retaining the authenticated audit projection, including staff email addresses. Its [migration](https://github.com/popcre/shared-db/blob/35e8dee6caee4e7fab362fd9d694b7cdacfd4fce/supabase/migrations/20260729210000_close_anon_read_leaks_in_public.sql) explicitly rejected invoker semantics because other actors' profile information would disappear for ordinary signed-in readers. The PR distinguishes an app-tested future refactor from the anonymous-access security repair it delivered.

The earlier [audit migration](../supabase/migrations/20260708183000_masterdata_audit_log.sql) created user-visible audit history with authenticated reads and the profile projection. The [reconciliation migration](../supabase/migrations/20260710135600_reconcile_style_tracker_tables.sql) preserves the same view shape. All three versions were present in the production migration ledger during this investigation.

The settled [Styles editing rule](business-rules/master-data-access.md) grants all signed-in POP users Styles editing. That rule alone does not authorize every profile read; the specifically preserved audit projection above supplies the relevant implementation contract.

## Current effective access

Production target `qsllyeztdwjgirsysgai` and `supabase_read_only_user` identity were verified before catalog inspection. The catalog showed:

- `public.style_tracker_audit_log_with_user` is owned by `postgres`, with default definer semantics and a left join to `public.profiles`.
- `authenticated` has schema usage and view SELECT; `anon` has no view SELECT. `service_role` retains SELECT.
- The underlying audit table has RLS enabled and an authenticated SELECT policy using `true`.
- Direct profile-table reads have RLS limiting ordinary readers to their own profile, with an additional administrator policy. The audit projection intentionally differs from this direct-table boundary.
- The projected email comes from the joined profile. The actor label falls back from nonempty name to nonempty email, then actor UUID, then `System`.

The read-only ledger comparison used the existing repository comparison and classification implementation with versions retrieved through the approved read-only connection. It found 703 main versions and 676 applied versions, with no applied-only version. Three unrelated versions were actionable pending work: `20260911212849`, `20260914061331`, and `20260917112129`. This was not a globally clean ledger, and no absent audit implementation was inferred from it.

## Current consumer and consequence of an invoker change

The freshly fetched PopDAM main was `c49ee360175fb84a3382802b0f327879423f44f2`. Its [route](https://github.com/u2giants/popdam3/blob/c49ee360175fb84a3382802b0f327879423f44f2/src/App.tsx) places `/styles` under [ProtectedRoute](https://github.com/u2giants/popdam3/blob/c49ee360175fb84a3382802b0f327879423f44f2/src/components/ProtectedRoute.tsx), which requires a signed-in user. No separate audit administrator gate appears in this path.

[StylesPage](https://github.com/u2giants/popdam3/blob/c49ee360175fb84a3382802b0f327879423f44f2/src/pages/StylesPage.tsx) reads this view at line 523, filtered by style row and spreadsheet column, ordered by time and limited to 50 entries. At line 2183 it renders the actor label. The label/email types already allow null. Email is present in the selected API projection but has no separate rendering in this component. [The application documentation](https://github.com/u2giants/popdam3/blob/c49ee360175fb84a3382802b0f327879423f44f2/docs/MASTER_DATA.md) describes opening cell audit history.

Existing grants would technically permit an invoker view. The left join would preserve authenticated audit rows, but another actor's hidden profile would make the existing label expression fall back to that actor's UUID. Event preservation and null-safe rendering therefore do not establish unchanged business behavior: readable attribution would be lost for ordinary readers. No grant expansion or permission-tightening migration was authored.

## Limits

This investigation used source, migration history, production catalog permissions and policies, and current application code. It did not write production data, impersonate users, or run a new authenticated browser journey. PR 326's historical authenticated audit probe returned zero audit rows and is not treated as a populated cross-user fixture. No claim is made about arbitrary profile fields, other master-data projections, or every authenticated account's organization-membership lifecycle.

The provisional report in issue 3327 is retained as history and corrected by this evidence. Any future attribution-policy change needs its own explicit requirements and app-level tests; this investigation does not authorize one.
