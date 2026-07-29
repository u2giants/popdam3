I've completed the review (read-only; no DB touched). Three Explore agents stalled on a watchdog timeout, so I ran all verification directly. The full report is saved to the plan file; here it is.

---

# Security review — `public` schema EXECUTE lockdown

**Scope:** `supabase/migrations/20260729120000_lock_down_public_security_definer_execute.sql` (merged `5e23389`) + `docs/security/public-schema-execute-audit.md`.

## Verdict: **PROMOTE WITH CHANGES**

The SQL is **correct, idempotent, transaction-safe, and already validated on preview** (assertions pass, anon probe fails as expected, `sync_clickup_tasks` → 401). The anon-EXECUTE lockdown is sound and all 13 `authenticated` revocations are well-founded — each function was granted `to service_role` only in its own migration, and the two "read" ones read tables that are themselves `service_role`-only, so no legitimate browser caller depended on them except through the bug being fixed.

It is **PROMOTE WITH CHANGES** rather than SAFE because: (1) promotion must be gated on a production audit — prod's object set is unverified and differs from preview; (2) it knowingly leaves an **anonymous WRITE** reachable (`upsert_style_tracker_value_resolution`), which needs a fast-follow, not backlog; (3) one defensive SQL hardening (`prokind` filter) and several doc inaccuracies should be cleaned up.

## Blocking issues

**B1 — Production object set is unverified (promotion gate).** `…sql:153-190` (§2), `197-238` (§3), `253-283` (§5). The "88/99" and "5 remain" figures are preview-only. Prod may hold SECURITY DEFINER callables preview lacks. *Fix:* run the §7 audit query (and the `authenticated` inverse) against **production** before promoting; dry-run the §2/§3 `select` (without `execute`) to preview the target set.

**B2 — §2 can abort the migration on a SECURITY DEFINER *procedure*.** `…sql:158-186` has no `p.prokind = 'f'` filter and no per-statement exception handler; same gap in the §5 assertion (`262-276`). A SECURITY DEFINER **procedure** in `public` that anon can reach → `revoke execute on function <proc>` raises *function does not exist* → whole migration rolls back. *Current exposure: none* — the 4 public procedures today (`reconcile_style_tracker_tables`, `reconcile_ai_tag_bakeoff`, `reconcile_dflow_baseline`, `apply_db_data_admin_bounded_forward`) are all INVOKER (verified: `language plpgsql`, no `security definer`), so `prosecdef` excludes them, consistent with the preview success. It's a latent trap. *Fix:* add `and p.prokind = 'f'` to §2 and §5; pre-flight `select proname from pg_proc … where nspname='public' and prokind='p' and prosecdef` is empty on prod.

**B3 — Anonymous WRITE left reachable.** `upsert_style_tracker_value_resolution` (`20260707171500_masterdata_designer_resolution.sql:202-274`, SECURITY DEFINER, granted `to anon,…` at `:385`) INSERT/UPDATEs `plm.style_tracker_value_resolution` and rewrites `plm.style_tracker_item_bridge` (sets `creative_designer_id`, flips `match_status` to `matched`/`verified`). An unauthenticated caller can force-link rows to arbitrary entities and mark them verified — **data tampering with no auth**. `refresh_style_tracker_item_bridge` (`:182-200`, anon at `:384`) lets anon trigger a full bridge rebuild. The migration's allowlist spares them by design; that's a defensible process choice but the EXECUTE hole is not "closed." *Fix:* separate follow-up migration revoking `anon` on both (plus N4), after tracing app-repo callers.

## Non-blocking issues

- **N1 — Trigger interpolates `object_identity` unquoted** (`…sql:116-119`). Not an injection vector (catalog-derived) and precedented by `rls_auto_enable` (`20260710135700…:655`), but a future oddly-named function would fail the revoke and be left unlocked with only a WARNING. §2 itself uses safer `%I`-quoting — the trigger is less careful. Add a periodic §7 re-audit as a regression alarm.
- **N2 — Trigger exception handler can mask a real failure** (`:121-126`). Right call for not breaking migrations (mirrors precedent), but the only signal is a PG log line. No CI/periodic check exists in the repo — add one.
- **N3 — Allowlist not durable across `CREATE OR REPLACE`** (`:91-98`, `171-178`). The trigger revokes `anon` on every `CREATE FUNCTION` tag, so a future body-patch of an allowlisted function strips its `anon` grant unless that migration re-grants. The doc protects `authenticated` from this but is silent on the `anon` side.
- **N4 — `search_style_tracker_link_candidates` is anon data-enumeration** (`20260710135700…:668+`, granted anon at `20260625153030…:249`). Read-only fuzzy search over `core.customer`/`licensor` returning IDs + names. Moderate info disclosure. Fold into B3.
- **N5 — `get_dam_material_facets` is in the allowlist but is SECURITY INVOKER** (`20260715214500…:19`). Harmless no-op (§2 filters `prosecdef`); drop or annotate it.
- **N6 — §3/§4 overlap on `public.sync_clickup_tasks`** is idempotent and correct; noted only for clarity.

## App-breakage risk — the 13 `authenticated` revocations

All 13 confirmed `to service_role` only (verbatim). Inference is **sound for all 13**.

| Function | Body | Grant | Risk |
|---|---|---|---|
| `advise_dam_search_query_indexes` | `index_advisor` diagnostic | service_role (`:860`) | Low |
| `claim_dam_search_embedding_documents` | SELECT pending docs (worker) | service_role (`:861`) | Low |
| `execute_readonly_query` | **not in repo** | n/a | Low (breakage); verify it exists in prod |
| `get_dam_search_embedding_status` | JSONB status counts | service_role (`:858`) | **Moderate — trace callers** (table is service_role-only at `:854`, so any auth caller rode the bug) |
| `get_dam_search_performance_stats` | `pg_stat_statements` | service_role (`:859`) | Low |
| `get_pdf_rich_extraction_hashes` | hashes for asset ids | service_role (`:66`) | **Low–Moderate — trace callers** |
| `mark_dam_search_embedding_error` | UPDATE (worker) | service_role (`:863`) | Low |
| `record_failed_sync_run` | INSERT sync_run | service_role (`:364`) | Low |
| `refresh_style_guide_file_tag_cache` | cache refresh, **trigger-invoked** | service_role (`:180`) | Low |
| `sync_clickup_tasks` | importer | service_role | Low |
| `sync_coldlion_vendors` | importer | service_role (`:363`) | Low |
| `upsert_dam_search_embedding` | UPDATE embedding | service_role (`:862`) | Low |
| `upsert_pdf_rich_extraction` | INSERT/UPDATE | service_role (`:67`) | Low |

**Verify before promote:** `get_dam_search_embedding_status` and `get_pdf_rich_extraction_hashes` — grep PopDAM for `rpc/` calls.

## Allowlist assessment

- **`has_role` / `has_app_access` — defensible.** Boolean self-role checks; needed because anon holds table SELECT and policies evaluate as anon. Calling as anon returns `false` — no leak.
- **`refresh_style_tracker_item_bridge` — not defensible** (B3).
- **`search_style_tracker_link_candidates` — not defensible** (N4).
- **`upsert_style_tracker_value_resolution` — not defensible; most exploitable** (B3).

## Gaps not addressed (mostly correctly out of scope)

1. **Other exposed schemas:** verified — the *only* explicit `grant execute … to anon` in the repo are the 4 public functions (3 style-tracker + facets). **Anon exposure is confined to `public`**; the default-ACL hole is public-specific and covered. ~50 functions stay `authenticated`-reachable across schemas (acknowledged, deferred).
2. **SECURITY INVOKER functions** in public: untouched (correct — caller runs under RLS).
3. **62-table anon SELECT:** separate intentional exposure; it's *why* `has_role`/`has_app_access` must stay anon-callable.
4. **`supabase_admin` default-ACL row:** can't be altered by `postgres`; rendered harmless by one-time revokes + the event trigger.
5. **Out-of-migration objects:** `execute_readonly_query`, the 2-arg `public.has_role`/`public.has_app_access`, and the `rls_auto_enable` *event-trigger registration* are absent from the migrations repo (only `rls_auto_enable`'s function body is in-repo). Coverage still holds (trigger fires on any new DDL), but several objects are unauditable from the repo.
6. **No regression test.** Add a scheduled §7 query.

## Production promotion checklist

**Before:** §7 audit + `authenticated` inverse against prod; dry-run §2/§3 `select`; empty `prokind='p' and prosecdef` check (B2); trace callers of the two DAM read functions.
**After:** §7 → only allowlist; anon-key `curl …/rpc/sync_clickup_tasks` → 401; watch app logs for `permission denied for function`; confirm `pg_event_trigger` row exists.

## Documentation accuracy

- **D1 — Mostly accurate and honest.** Root-cause, two patterns, "obvious fix insufficient" proof, and scope trade-offs are all correct. §8 guidance is exactly right.
- **D2 — "Five functions"** is right for SECURITY DEFINER, but `get_dam_material_facets` is also anon-reachable (INVOKER) — clarify "5 SECURITY DEFINER."
- **D3 — Migration allowlist (6 names) ≠ doc §5 (5).** Both correct in effect (facets is INVOKER), but the artifacts disagree. Reconcile.
- **D4 — "mirrors existing `rls_auto_enable()` event trigger"** is half-verifiable: the *function* is in-repo, but its event-trigger registration is **not** (the only `create event trigger` in the repo is the new one). Analogy holds; provenance overstated.
- **D5 — Unverifiable figures:** "237 policies," "62 tables," "88/99," and the `db_schemas` list aren't in the repo (`config.toml` has only `project_id`). I found ~163 `has_role(`/`has_app_access(` occurrences — same order of magnitude, not equal. Treat as preview-measured.

## Things the migration got right (verified)

- Root-cause fix + empirically-validated event-trigger backstop (the `=X/` PUBLIC default survives `ALTER DEFAULT PRIVILEGES` — trigger is the real guard).
- §2 revokes `public` **and** `anon` → closes both the 73 (no revoke) and 15 (revoke-from-public-only) patterns; `has_function_privilege('anon',…)` guard makes it idempotent.
- `pg_get_function_identity_arguments` + `format('public.%I(%s)',…)` correctly handle overloads and quote the name; the `extensions.vector(384)` arg interpolated cleanly (consistent with stated preview success).
- §3 only revokes `authenticated` where intent was service_role-only and re-asserts the grant; all 13 verified.
- Fail-safe assertions (§5, §6 incl. the trigger firing mid-transaction, and the `sync_clickup_tasks` triple-check) roll back the whole transaction on any miss.
- Genuinely idempotent; correctly refused to touch ~50 app-facing `authenticated` functions blind.

## Could not determine from the repo alone

- **`execute_readonly_query`** — referenced only in docs + this migration; **no migration defines it**. Couldn't verify its body, grants, or that it exists in prod. Migration handles it at runtime, so this is auditability, not a defect — confirm it exists and got locked.
- **2-arg `public.has_role(uid,role)` / `public.has_app_access(uid,app)`** — used pervasively in policies but not defined in any migration (in-repo versions are 1-arg `app.*`). Out-of-band bootstrap.
- **`rls_auto_enable` event-trigger registration** — function in-repo, wiring not (D4).
- **`db_schemas`, 62-table, 237-policy, 88/99 figures** — hosted/preview measurements (D5).
- **Whether prod matches preview** — the key unknown; gate on the §7 query (B1).

---

The complete report is also saved at `…\plans\role-you-are-sparkling-scott.md`. Note: this harness session does not expose `ExitPlanMode`/`AskUserQuestion`, so I'm delivering the report directly rather than via those tools — there is no implementation to approve, only the review above and the recommended pre-promotion changes (B1–B3) plus the doc reconciliation (D2–D4).
