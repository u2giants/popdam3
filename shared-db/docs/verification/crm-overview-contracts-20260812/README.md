# CRM Overview / Sidebar server-side contracts — Phase 7A

**Status:** PARITY-CORRECTED / PREVIEW REPROOF REQUIRED. Earlier preview results
are stale because the SQL changed after independent review.
**Migrations:** baseline `20260812130000_crm_overview_server_contracts.sql`,
then parity correction `20260812211000_crm_overview_exact_parity_corrections.sql`.
The baseline was already applied to preview and must never be rewritten.
**Branch:** `codex/crm-overview-server-contracts-7a`
**Scope:** Replace the CRM Sidebar + Overview browser-side counting
(`useCrmStatsQuery` in `popcrm-web/src/features/crm/queries.ts`, which fetches six
full domains plus the newest 500 emails and counts client-side) with
browser-safe server aggregate + bounded recent-row contracts in `shared-db`.

This document is the durable **display-contract inventory**: every value the CRM
Sidebar and Overview render, its source table, exact filter, the RPC that serves
it (failure boundary), and the maximum recent-row count. It is the source the
migration and tests are checked against.

> **Out of scope here:** the `popcrm-web` frontend rewrite that *consumes* these
> RPCs. That is a separate, app-repo change (commit-to-`main` workflow). Phase 7A
> delivers the server contracts, proves them on preview, and stops. The durable
> Outlook cursor contract (`20260812010000_crm_worker_delta_cursor.sql`) is
> production-live and **unrelated / untouched**.

---

## 1. Display-contract inventory

Filters are reproduced **exactly** from the CRM source so the server count equals
the current client count. "Display source" column = the CRM file + symbol.

### 1A. Aggregate counts (Sidebar badges + Overview KPI strip + charts)

| # | Displayed value | Display source | Server column / RPC | Source table(s) | Exact filter | Failure boundary |
|---|---|---|---|---|---|---|
| 1 | Customers (KPI) | `OverviewPage` `stats.customers` = `retailers.length` ← `fetchRetailers(-1)` = active segment | `crm_overview_counts.customers` | `core.customer` | `customer_status IN ('ACTIVE_CUSTOMER','POTENTIAL_CUSTOMER')` | `api.crm_overview_counts()` |
| 2 | Contacts (KPI) | `OverviewPage` `stats.contacts` = `buyers.length` ← `fetchBuyers(-1)` (client filter on `crm_contact_list`) | `crm_overview_counts.contacts` | `core.contact` ⨝ `core.contact_company` ⨝ `core.customer` | contact's **primary** company relationship (`contact_company` ordered `is_primary desc, id` limit 1) has `customer_status IN ('ACTIVE_CUSTOMER','POTENTIAL_CUSTOMER')` | `api.crm_overview_counts()` |
| 3 | Open programs (KPI) | `OverviewPage` `stats.openOpportunities` = `opportunities.filter(o => o.stage !== 'CLOSED').length` | `crm_overview_counts.open_opportunities` | `crm.opportunity` | `stage IS DISTINCT FROM 'CLOSED'` (null/unknown stage counts as open, matching JS `!==`) | `api.crm_overview_counts()` |
| 4 | Meetings (KPI) | `OverviewPage` `stats.meetings` = `meetings.length` | `crm_overview_counts.meetings` | `crm.meeting_note` | all rows | `api.crm_overview_counts()` |
| 5 | Open tasks (Sidebar badge + KPI) | `AppSidebar`/`OverviewPage` `tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELED').length` | `crm_overview_counts.open_tasks` | `crm.task` | `status IS DISTINCT FROM 'DONE' AND status IS DISTINCT FROM 'CANCELED'` (null counts as open) | `api.crm_overview_counts()` |
| 6 | Pending approvals (Sidebar badge + KPI) | `AppSidebar`/`OverviewPage` `approvals.filter(a => !isApprovalResolved(a.stage)).length` | `crm_overview_counts.pending_approvals` | `crm.licensor_approval_thread` | `is_approval_resolved(stage) = false`, i.e. `lower(coalesce(stage,'')) !~ '(approv|reject|declin|denied|complete|closed|signed)'` (null stage = pending) | `api.crm_overview_counts()` |
| 7 | Needs routing (Sidebar badge + KPI) | `AppSidebar`/`OverviewPage` over `fetchEmailMessages(-1)`, which caps input at 500 | `crm_overview_email_counts.needs_routing` | newest 500 `crm.email_message` rows ordered `received_at desc nulls last, id` | within that window: non-empty status not in `ROUTED/SKIPPED` | `api.crm_overview_email_counts()` |
| 8 | Email total ("X messages") | `OverviewPage` `stats.emails`; fetched array capped at 500 | `crm_overview_email_counts.total` | newest 500 `crm.email_message` rows | all rows in the capped window | `api.crm_overview_email_counts()` |
| 9 | Routing-health donut slices | `OverviewPage` over the capped fetched array | `crm_overview_email_counts.{routed,skipped,company_only,company_dept,unrouted,no_company,other}` | newest 500 `crm.email_message` rows | count each status; null/empty → `UNROUTED`; unknown → `other` | `api.crm_overview_email_counts()` |
| 10 | 12-week email volume series | `OverviewPage` `buildWeeklyVolume(emails)` over the capped fetched array | `crm_overview_email_volume(week_start, ingested, routed)` (≤12 rows) | newest 500 `crm.email_message` rows | adjacent rolling 7-day windows ending at one stable `statement_timestamp()` boundary | `api.crm_overview_email_volume(p_weeks)` |
| 11 | Pipeline distribution bars | `OverviewPage` `stageBars` over `OPPORTUNITY_STAGES` (null/empty bucketed to first stage) | `crm_overview_pipeline_stages(stage, count)` (8 rows) | `crm.opportunity` | per known stage; null/empty `stage` bucketed to `'DIRECTIVE_RECEIVED'` (mirrors `o.stage \|\| OPPORTUNITY_STAGES[0]`); unknown stages excluded from bars | `api.crm_overview_pipeline_stages()` |

### 1B. Bounded recent-row panels (Overview activity panels)

| # | Panel | Display source | Server RPC | Source table(s) | Filter | Order (deterministic, id tie-breaker) | Max rows | Rendered columns only |
|---|---|---|---|---|---|---|---|---|
| 12 | Needs routing | `OverviewPage` = newest-500 `emails.filter(needsRouting).slice(0,6)` | `api.crm_overview_recent_unrouted(p_limit)` | newest 500 `crm.email_message` rows | `needsRouting` after the 500-row cap | `received_at desc nulls last, id` | 6 (default) | `id, subject, sender, routing_status` |
| 13 | Recent meetings | `OverviewPage` `recentMeetings` = `meetings.slice(0,6)` | `api.crm_overview_recent_meetings(p_limit)` | `crm.meeting_note` ⨝ `core.customer` | all | `meeting_at desc nulls last, id` | 6 (default) | `id, name(title), company_id, company_name, date(meeting_at)` |
| 14 | Pending approvals | `OverviewPage` filters and slices the ordered `fetchApprovalThreads` result | `api.crm_overview_pending_approvals(p_limit)` | `crm.licensor_approval_thread` ⨝ `crm.opportunity` | `NOT is_approval_resolved(stage)` | `stage asc nulls last, submitted_date desc nulls last, id` | 6 (default) | `id, name, property_name, opportunity_id, opportunity_name, stage` |

**Rationale for the bounded-row orderings and limits.** Every panel is a "most
recent / most urgent" list, so each orders by its natural timestamp descending
with `id` ascending as the deterministic tie-breaker (matching the existing
`api.crm_email_routing_recent` convention). `p_limit` defaults to 6 (the slice
the UI takes today) and is clamped to `[1, 100]` server-side so a malformed call
cannot page the whole table. `pending_approvals` preserves the current browser
order: stage ascending, then submission date descending. The RPC adds `id` only
as a deterministic final tie-breaker. Email contracts first select the same
newest 500 messages returned by `fetchEmailMessages(-1)`, then count, bucket,
or filter that window.

## 2. Failure boundaries (why this many RPCs)

The current `useCrmStatsQuery` does `Promise.all` of six full-table fetches plus
one newest-500 email fetch, so
**any** one failure blanks **every** Sidebar badge and Overview KPI. The new
contracts isolate the historically slow domain (email — the reason
`crm_email_routing_recent` / `crm_email_routing_segment_counts` already exist)
and split bounded rows from counts, so a degraded group no longer blanks the rest:

- **People / pipeline / work counts** (`crm_overview_counts`) — one round trip for
  the six non-email scalar KPIs (customers, contacts, open programs, meetings,
  open tasks, pending approvals). All are indexed `COUNT`/filtered scans.
- **Email counts** (`crm_overview_email_counts`) — isolated: an email outage no
  longer blanks customer/contact/pipeline KPIs.
- **Pipeline stage breakdown** (`crm_overview_pipeline_stages`) — set-valued chart
  data, separate from the scalar `open_opportunities`.
- **Email 12-week volume** (`crm_overview_email_volume`) — a rolling-window
  aggregate, heavier than plain counts, kept off the counts fast path.
- **Three bounded recent-row panels** — each independently callable; one slow
  panel does not block the others or any count.

## 3. Authorization model

Every RPC is `security definer`, hard-gated on `app.has_app_access('crm')`. A
caller without CRM access (and not `administrator`) is **denied** with
`raise exception ... using errcode = 'insufficient_privilege'` (the
`crm_admin_user_list` precedent), not silently empty. Negative-authorization is
proved in the contract tests and on preview (§5).

## 4. Files

- Baseline migration, already rehearsed: `supabase/migrations/20260812130000_crm_overview_server_contracts.sql`
- Exact-parity correction awaiting preview: `supabase/migrations/20260812211000_crm_overview_exact_parity_corrections.sql`
- Offline contract + negative-auth tests: `tools/crm-overview-contracts.test.mjs`
- Stale first-rehearsal evidence, retained only as history until rerun:
  - `apply-evidence.md` — earlier bounded apply and object/grant capture
  - `explain-and-counts.md` — earlier counts and plans, invalid for corrected SQL
  - `access-control.md` — earlier runtime calls, requiring corrected-body rerun
  - `preview-verify-raw.txt` — earlier raw capture, marked stale

## 5. Preview result (STALE AFTER PARITY CORRECTION)

- The first rehearsal proved the earlier SQL. It predates the newest-500,
  rolling-window, and approval-order parity corrections.
- The evidence files are retained but marked stale. They do not approve the
  corrected SQL.
- Rerun the bounded preview apply, direct-vs-RPC fixtures, authorization calls,
  and affected EXPLAIN plans before restoring a preview-proven status.

**Not done:** corrected SQL preview reproof, then the `popcrm-web` frontend rewrite
that consumes these RPCs is a separate app-repo change; this PR ships only the
shared-db server contracts. Do not merge without owner approval, and do not
promote to production — Phase 7B stays blocked until this is approved, merged,
promoted, and vendor-synced.
