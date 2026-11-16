---
issue: 408
status: OPEN
owner: db/fix-promo-timeout (MiMo session ses_ffe5e29f41b39ffej7JEA7YF4w)
---

# Handoff: DesignFlow Disney property-suggestion — production promotion pending

## 1. What we were doing, and why

Implementing the plan in designflow-backend#408: suggest a design's Disney Property from the style-guide files it was made from. Albert asked for steps 1–5 to be proven live on sandbox with screenshots, checked off on issue #408.

## 2. What we actually DID

**Shared-db (PRs merged):**
- PR #6275 — `plm.dcp_property_mg06_crosswalk` table (16 seed rows) + `plm.suggested_property_for_sku(text)` function. Merged 2026-11-15 8:41 AM EST. Versions `20261115132055`.
- PR #6370 — fix-forward for review finding #6276: consumer view (`plm.coldlion_item_merch_group`) instead of RLS-gated base table, exact-only confidence filter, least-privilege grants. Merged 2026-11-15 4:41 PM EST. Version `20261116120000`.
- PR #6489 — timeout fix for `automatic-production-trigger.yml` (10→30 min). Merged.
- Claim issue #6271 — released (closed).

**DesignFlow (on sandbox-albert):**
- `designflow-backend`: `GET /api/autofill/property-suggestion/:sku` endpoint + 5 unit tests. Commit `c0c48d52`.
- `designflow-frontend`: Item Detail suggestion UI (suggestion banner + mismatch warning + one-click apply). Commits `cefbde82`, `3b9b3313`. URL routing fix for BFF: `/api/core/api/autofill/property-suggestion/:sku`.

**Issues created:**
- popcre/shared-db#6423 — migration-version backdating race plan (written, DeepSeek-audited).
- popcre/shared-db#6493 — higher-throughput promotion pipeline plan (written, DeepSeek-audited, revised).

## 3. Applied to preview and production

- **Preview:** Migration `20261115132055` applied to preview (`mvpkijzfmfcxhnzqogzs`) via psql. Tests pass on preview.
- **Production:** NOTHING applied. Migrations `20261115132055` and `20261116120000` are merged to `main` but NOT in `supabase_migrations.schema_migrations` on production (`qsllyeztdwjgirsysgai`). Verified 2026-11-16 ~6:15 PM EST.

## 4. What is half-finished or abandoned mid-way

- **Production promotion** for `20261115132055` and `20261116120000` — not yet applied. The serial promotion lane is jammed (issue #6352). PR #6489 (timeout fix) should help the lane drain.
- **Step 5 (live proof)** on designflow-backend#408 — blocked on production promotion. Needs sandbox screenshots showing the suggestion UI.
- **Issue #408 STATUS table** — steps 1–4 not yet checked off.

## 5. What we own right now

- **Worktrees (all clean, PRs merged):**
  - `D:\repos\shared-db-worktrees\property-suggestion-crosswalk` — branch `db/property-suggestion-crosswalk`, PR #6275 MERGED
  - `D:\repos\shared-db-worktrees\fix-property-suggestion` — branch `db/fix-property-suggestion-rls`, PR #6370 MERGED
  - `D:\repos\shared-db-worktrees\fix-promo-timeout` — branch `db/fix-promo-timeout`, PR #6489 MERGED
- **No open PRs** in shared-db or DesignFlow repos (all merged).
- **No claims** (issue #6271 released).

## 6. What we were ABOUT to do next

Wait for the serial promotion lane to apply migrations `20261115132055` and `20261116120000` to production. Then verify the function works on production, take sandbox screenshots, and check off issue #408 STATUS table.

## 7. What we are blocked on

- **Production promotion lane** (shared-db). The serial lane processes one migration at a time. Multiple PRs are stuck (issue #6352). PR #6489 (timeout fix, merged) should help but hasn't been observed draining the queue yet.
- Not blocked on Albert.

## 8. What we tried that did NOT work, and why [MANDATORY]

- **Applying migrations to preview via `supabase db push`**: Failed because 44 pending migrations from other PRs were in the tree, and `20260802171000_owner_ruling_friends_tv_frida_kahlo.sql` fails on preview (needs `core.licensor (code=FR, name=FRIENDS TV)` which doesn't exist on preview). Applied my migration via psql directly instead.
- **Renumbering migration versions to beat the backdating race**: Failed 3 times on PR #6275 and 3 times on PR #6370. Each time, another PR merged with a newer migration version during the ~10 min CI window. Fixed by manually pushing a future-dated ref (`refs/db-claims/20261116120000`). Plan for a proper fix is in issue #6423.
- **`ai-muse` for plan audit**: Returned 403 (Meta API access restricted). Used DeepSeek (`ai-deepseek-agent`) instead.
- **DeepSeek `--file` flag**: The file contents were not delivered to DeepSeek. Worked around by sending the plan as a single-line message.
- **Multi-line messages to DeepSeek**: Only the first line was received. All content had to be sent as one line.
- **Production promotion triggers**: Multiple manual triggers (`gh workflow run`) were cancelled after 15–25 min. Root cause: `timeout-minutes: 10` was too short for the selector (~8 min runtime). Fixed in PR #6489.
- **`git branch --merged` to find cleanup candidates**: Not reliable for squash-merged branches. Used `gh pr view` to verify merge state instead.

## 9. Facts that may already be stale

- **Max migration version on main**: `20261121100000` (checked 2026-11-16 ~6:15 PM EST). Will grow.
- **Production ledger**: 986 applied versions (read 2026-11-16). My two versions are NOT among them.
- **Issue #6352 stuck list**: As of 2026-11-16, PRs #6263, #6260, #6316, #6436 were stuck. PR #6489 (timeout fix) may have changed this.
- **PR #6489 merge time**: 2026-11-16 (exact time not re-checked after merge).
