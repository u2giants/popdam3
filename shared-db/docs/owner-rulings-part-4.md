---
summary: Owner rulings verbatim, part 4 of 4: §6.28–§6.35 (8 sections); section list is in owner-rulings.md.
kind: living
status: current
read-when: a citation of AGENTS.md §6.28–§6.35 or the owner ruling text in that range
---

# Owner rulings and standing decisions (AGENTS.md section 6) — part 4 of 4

> Moved **verbatim** from [`owner-rulings.md`](owner-rulings.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

### 6.28 OWNER RULING — no external reviewer for popcre/shared-db; skip merge-gate assignment when none are working (Albert Hazan, 2026-10-15 and 2026-10-16)

Verbatim from Albert's chat:

> "the new rules say this repo does not get reveiwers anymore" (2026-10-15)

> "if there are no reviewers currently working then skip the merge-gate assignment" (2026-10-16)

> "i allow one assignment to bootstrap that policy onto main" (2026-10-16)

**Effect.** For `popcre/shared-db` only: this repository has no working reviewers (standing premise from the 2026-10-15 quote), so the exact-head approval gate (`scripts/check-exact-head-approval.mjs`) skips the external reviewer APPROVE requirement. This is not a per-run liveness probe. This ruling does not by itself change `--assign-reviewer` (retired by #5409) drawing rules. The exemption is from the reviewer POOL only. Every other required check, the guarded merge lane, the merge lock, and a durable refusal already recorded at the head still bind. One assignment is authorized to bootstrap this policy onto main. The policy is the committed file `config/owner-no-reviewer-policy.json` (schema-1) so the decision is auditable and cannot be toggled by a pull-request author or environment variable. This retires the one-review minimum from §6.27 for this repository only; §6.27 remains the rule for every other repository.

Posted by MiMo chat 0ffe5ebedd0b70ffe on edge-dev

### 6.29 OWNER RULING — a stalled protected-source pull request loses its queue place after one hour (Albert Hazan, 2026-10-21)

Verbatim from Albert's chat (2026-10-21), answering whether the 24-hour stale-place window could be 30 minutes:

> "make it 1hr."

**Effect.** `STALE_PLACE_AFTER_MS` in `scripts/check-pr-source-collisions.mjs` is one hour. An earlier open pull request that edits a protected coordination source forfeits its place to a newer one only when all three conditions still hold: no activity for one hour, failing checks or a main conflict, and a dated `stale-place-nudge:` comment naming the newer pull request. Unreadable signals still mean no skip, and the earlier pull request reclaims its place automatically once refreshed and green. Nudges written with the old `inactive-24h` state still parse; new ones say `inactive-1h`.

Posted by Claude chat 745ea991-2041-4729-8860-ca595c6faf46 on edge-dev

### 6.30 OWNER RULING — the typed OWNER-OVERRIDE production confirmation is standing policy when reviewer tooling fails (Albert Hazan, 2026-10-22 and 2026-10-23)

Verbatim from Albert's chat:

> "don't do a second review for #4430" (2026-10-22, recorded in `plan_ci-speedup.md` §3 from the RLS InitPlan sessions)

> "yes, skip should exist because reviewer tooling keep failing over and over again and prevent us from doing anything." (2026-10-23, to ZCode)

**Effect.** The `OWNER-OVERRIDE <sha>` typed confirmation in `.github/workflows/shared-supabase-migrations.yml` (added 2026-10-22) is standing owner policy, not a one-day exception. When reviewer tooling is failing, skipped or undrawable, an AI dispatcher may confirm a production apply with exactly `OWNER-OVERRIDE <sha>`; the run skips only the automated business-risk gate and records `owner_override` evidence naming the owner, date, exact SHA and ordered allowlist. Every other production gate still binds: exact target pin, exclusive production lock, ordered allowlist, hard blocks, and post-apply live verification. Under §6.23 this is the owner accepting a business risk during a tooling outage, never the owner performing technical review; the automated gate returns the moment a reviewer is drawable. `docs/production-promotion-procedure.md` documents the dispatch procedure.

Posted by ZCode chat unknown on edge-dev

### 6.31 OWNER RULING — scraped submission Properties are 100% canonical (Albert Hazan, 2026-10-26)

Verbatim from Albert's chat (2026-10-26):

> "properties scraped from the submissions sites are 100% canonical. that should also have been well-documented. If these are not in a place you can easily find them, then the place you looked should link to them."

Also restated the same day: "it should be very very well-documented that Paramount=Viacom=Nickelodeon."

**Effect.** Every Property scraped from a Licensor's submission system is a canonical `core.property` under that Licensor, by its exact submission name. It is created if missing and never renamed to a Creative spelling. ColdLion MG06 codes map many-to-one onto submission Properties. Unmatched codes stay unmapped and preserved. Paramount, Viacom and Nickelodeon are the one `VM` Licensor (2026-09-06). Business statement and source locations: [licensing-master-data.md](business-rules/licensing-master-data.md#scraped-submission-properties-are-canonical).

Posted by Claude chat badbd459-aa8b-470f-8959-f31c4cf48e62 on edge-dev

### 6.32 OWNER RULING — on another reviewer error, merge and apply to production without a review (Albert Hazan, 2026-10-26)

Verbatim from Albert's chat (2026-10-26, to ZCode on hetz):

> "if you get another reviewer error, proceed to merge and apply to production without a review"

**Effect.** When governed reviewer machinery errors again (draw refusal, engine failure, or API outage blocking the draw — as on #4772/#4797), the dispatcher stops bounded retries and proceeds: merge the pull request on green CI with the owner override recorded, and confirm the production apply via the standing §6.30 `OWNER-OVERRIDE <sha>` typed confirmation with its evidence trail. This is the owner accepting business risk during a reviewer-tooling outage, never a substitute technical review; every other gate still binds (exact target pin, exclusive production lock, ordered allowlist, hard blocks, post-apply live verification), and the automated reviewer gate returns the moment a reviewer is drawable. A substantive reviewer VERDICT (e.g. REJECT findings) is not a reviewer error and still must be fixed and re-reviewed.

Posted by ZCode chat unknown on hetz

### 6.33 OWNER RULING — user administration lives in DesignFlow PLM (Albert Hazan, 2026-10-28)

Verbatim from Albert's chat (2026-10-28):

> "this should be pulled from the roles set in designflow plm. there should be one place that holds all the user data/permissions/roles. transfer over user settings in all apps (crm, Poppim, DAM) to designflow's. Keep user info in the settings of each app, but it's just a frontend to the true user permissions/roles functionality in dflow"

**Effect.** DesignFlow PLM is the single source of truth for user data, permissions, and roles across all POP applications (CRM, PopPIM, PopDAM/PopSG). Each app's Settings keeps its user card, but that card is only a frontend to DesignFlow's user administration — no application owns a separate role or permission authority. Login does not move: Microsoft SSO through Supabase Auth stays; this ruling is about who owns authorization data, not how anyone authenticates. Whatever DesignFlow's canonical model turns out to be, its authority must land in the shared rows row-level security already evaluates (`app.profile`, `app.user_role`, `app.app_access`) or every app's RLS breaks; *how* it lands there is the Phase-1 ownership contract recorded on the master issue. Master tracking issue: popcre/designflow-backend#250. Cutover plan (read its STATUS table first): u2giants/popdam3 `plan_user_permissions_designflow_cutover.md`. Business-map row: [application-map.md](business-rules/application-map.md).

Posted by MiMo chat unknown on edge-dev

### 6.34 OWNER RULING — DC and Harry Potter are properties under Warner Bros (Albert Hazan, 2026-11-01)

Verbatim from Albert, relayed from the PopDAM session (2026-11-01):

> "DC and Harry Potter were not left out. they used to (Wrongly) be listed as their own licensors. that was wrong, they are properties under Warner Bros, which is how it is now. document that everywhere it needs to be documented"

**Effect.** DC and Harry Potter are not licensors. Their Properties belong to `WB` WARNER BROS, and their Characters resolve through the Warner scrape. Migration `20261101153043` moves their `core.property` rows to `WB`.

Albert confirmed the move of existing rows, verbatim (2026-11-01): "Yes, move them".

**SKU codes stay.** `DC` and `HP` remain valid ColdLion codes and SKU characters 6-7. They resolve to `WB`; the two `core.licensor` rows stay `inactive` so those codes and old history still have a referent. Every prior row is archived in `archive.dc_hp_wb_repoint_20261101`.

Posted by Claude chat 8b15975b-42fa-4ebc-acab-6338808d482a on hetz

### 6.35 OWNER RULING — A claim idle for 10 days may be taken over (Albert Hazan, 2026-11-02)

Verbatim from Albert, relayed to the takeover session (2026-11-02):

> "If a session is idle for 10 days it obviously is not coming back. spin up a nested session to take it over"

**Effect.** A claim with no activity for 10 days does not need its old owner. A successor session first checks for unpublished work, then records the takeover on the claim, quoting this ruling, and releases it. Applied to claim #4723, which held up #5436 and #5079.

**Case notes (#5436).** Items absent from the ColdLion feed are not reached by the import, so a licensor move needs a live count of items left on the old licensor, and a direct fix for the remainder. A data-only migration can end its production run red at post-apply catalog verification although the rows changed: judge it by a live read of the rows and the ledger.
