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

### 6.36 OWNER RULING — the signed contract places OPA Properties under Disney, Marvel or Star Wars; do not re-ask (Albert Hazan, 2026-08-31, reaffirmed 2026-11-12)

**Do not ask Albert this again.** On 2026-11-12, 4:07 PM EST, asked whether the signed Disney contract may decide which studio an OPA Property belongs to, Albert answered:

> "No, we decided this already. read the documentation to find out where and then record it in a more conspicuous place"

The decision is the 2026-08-31 ruling in [licensing-master-data.md, "OPA cannot separate Marvel from Disney"](business-rules/licensing-master-data.md#opa-cannot-separate-marvel-from-disney): the signed contract schedule (K2557) decides Disney versus Marvel, because OPA files Marvel under its `disney` branch. The 2026-09-05 ruling in the same file adds that OPA presence alone proves rights, but not studio.

**Effect.**
- An OPA Property named by an exact franchise-title clause of the contract is placed under that clause's studio. Character mentions inside another clause do not count.
- An OPA Property no clause names stays unplaced (no studio guess from OPA branch, names or source labels) until a clause, direct OPA Star Wars scope, or a separate owner ruling places it.
- Names stay exactly as the submissions site writes them (§6.31).
- Applied by issue #2541 (13 Properties, including Standard Characters).

### 6.37 OWNER RULING — core.property is ColdLion's Property list, filled daily from the landing (Albert Hazan, 2026-11-12)

Verbatim Albert, 2026-11-12 4:07 PM EST:

> "yes. all 3 should be filled from coldlion via the established path: coldlion to landing table, landing table to the table used by the apps."

Verbatim Albert, 2026-11-12 4:16 PM EST:

> "the long-term property list is settled and it's what's in coldlion right now + a few changes i will ask Jamielynn to make tomorrow"

**Effect.** `core.property` takes ColdLion MG06 codes, names and active/inactive status from `coldlion.merch_group_detail` every day (`plm.sync_core_property_from_coldlion`, migration `20261112232209`, issue #6194). Rows not in ColdLion are untouched and nothing is deleted. Where it conflicts with 6.31 on a ColdLion-coded row's name, ColdLion's name wins; the earlier name stays in the row's metadata.

### 6.38 OWNER RULING — Mickey Mouse, Minnie & Me and Standard Characters are separate properties; X-Men is X-Men Classic (Albert Hazan, 2026-11-13)

Verbatim Albert, 2026-11-13 2:19 PM EST, answering whether Disney OPA "Mickey Mouse" (372) and "Standard Characters" (361), and "X-Men" (640) and "X-Men Classic" (1107), are the same properties:

> "1) X-Men is the same property as X-Men Classic.
> 2) we went over this extensively, document it conspicuously: if a design has only mickey in it, it goes under 'Mickey Mouse' which sits under 'Mickey Mouse Family'. if a design has only Minnie in it, it goes under 'Minnie & Me' which sits under 'Mickey Mouse Family'. If a design has Mickey + anyone else in it, it goes under 'Standard Characters'"

**Effect.**
- **Mickey only → "Mickey Mouse" (under "Mickey Mouse Family"); Mickey plus anyone else → "Standard Characters".** These are separate properties; never merge them or link one to another's OPA property. **Minnie half superseded by 6.44 (2026-11-25): solo Minnie is "Minnie" > "Minnie & Me", not under "Mickey Mouse Family".**
- POP's `core.property` MM "Standard Characters" (nickname "Mickey Group") links to OPA 361, not OPA 372 (corrected in migration `20261113183820`, shared-db#6269).
- X-Men (OPA 640) and X-Men Classic are one property: POP's XM row keeps its OPA link. **Superseded for X-Men by 6.40 (2026-11-14) — see there; the submissions site scrape wins.**
- Do not re-ask. Applies to the #2541 placement repair on shared-db#6209.

### 6.39 OWNER RULING — No ColdLion Property values are inactivated now; Ilona and Laura decide later (Albert Hazan, 2026-11-13)

Verbatim Albert, 2026-11-13 4:01 PM EST, after a draft sheet for Jamielynn proposed turning off ColdLion MG06 (Property) values:

> "we're not going to inactivate any properties right now. we'll leave that to Ilona and Laura, and maybe revisit in 3 months. document that."

**Effect.**
- No AI session proposes, lists or performs inactivation of ColdLion Property (MG06) values. Do not put a "turn off" / "Inactivate" list for properties in any sheet for Jamielynn or anyone else.
- Whether a property should be turned off is Ilona's and Laura's (Licensing) call. Revisit no earlier than about 2027-02-13, and only if Albert or Licensing raises it.
- A property's use is judged by its items in ColdLion, never by licensor-submission counts (a new license such as STEAL A BRAINROT can have items but no submissions yet).
- Style moves between existing properties are unaffected.

### 6.40 OWNER RULING — the one-property X-Men half of 6.38 is dropped; the submissions site scrape wins (Albert Hazan, 2026-11-14)

Verbatim Albert, 2026-11-14, after being shown that the OPA submissions site scrape lists OPA 640 "X-Men" and OPA 1107 "X-Men Classic" as separate entries (separate licensedPropertyIDs and brandPropertyIDs), and being asked whether to treat OPA 640 as an alias of OPA 1107:

> "if it contradicts the submission site scrape drop my one-property X-Men ruling"
> "ask GitHub Support to delete the 15 dead runs"

**Effect.**
- The submissions site scrape is the identity source of truth. It lists OPA 640 and OPA 1107 as separate properties, so they ARE separate shared properties — the one-property X-Men half of 6.38 is dropped. The Mickey half of 6.38 (Mickey Mouse, Minnie & Me and Standard Characters are three separate properties) stands unchanged; the scrape agrees with it.
- Each OPA entry keeps its exact site spelling as its licensor-submission name. Never rename a shared `core.property` row to a different OPA entry's name (that is the error 20261113041225 made).
- The #2541 placement repair on shared-db#6209 creates the missing records and re-points the links accordingly (migration `20261115041745`).
- Also authorized 2026-11-14: file the GitHub Support request to purge the 15 GitHub-locked ghost workflow runs from the 2026-11-11 wedge (issue #6215).

### 6.41 OWNER RULING — core.licensor is the ColdLion MG05 list only; no hand-maintained licensor list (Albert Hazan, 2026-11-15)

Verbatim Albert, 2026-11-15 8:49 PM EST:

> "delete "our own system's licensor list" so no future session can use it. the only thing to be using is the canonical MG05 list we build from what comes in on the API"

**Effect** (issue #6440, migration `20261116124500`).
- The licensor list is ColdLion's MG05 (Licensor) list as it arrives from the API (`coldlion.merch_group_detail`, plus `dflow_prod."merchGroup"` divisions CW001/SP001). Nothing else is a licensor source.
- `core.licensor` stays only as the stable id table every app's foreign keys use. Its single writer is `plm.sync_core_licensor_from_coldlion` (nightly, before the property sync): one row per MG05 code; rows outside MG05 are set inactive, recoverably (`metadata.mg05_retired` keeps the old status), never deleted.
- A trigger refuses every other insert, rename, re-code, status change, delete or truncate. Never bypass it, never set `app.core_licensor_writer` by hand, and never load licensors from a spreadsheet, scrape, chat or memory. A missing or wrong licensor is fixed in ColdLion.
- An MG06 Property's licensor is its MG05 parent's code. Never create MG06 values.

### 6.42 OWNER RULING — ColdLion MG groups are division-specific; licensors come only from CW001/SP001 MG05 (Albert Hazan, 2026-11-16)

Verbatim Albert, 2026-11-16 7:44 AM EST:

> "art themes like Abstract and Animal are the MG05 values for division EH001. MG groups are specific to divisions."

**Effect** (issue #6463, migration `20261117020100`). Refines 6.41: the canonical licensor list is MG05 from the licensed divisions CW001 and SP001 only. Every merchandise-group read filters by division; an MG06 value's MG05 parent is resolved within its own division. EH001 art themes made licensors on 2026-11-16 (DF, RB) are retired as inactive, recoverably.

### 6.43 OWNER RULING — Mickey/Minnie: MM is Mickey alone, new code ME is Minnie alone, MMF is Mickey Group → Standard Characters (Albert Hazan, 2026-11-16)

Verbatim Albert ruling, 2026-11-16, as recorded by the coordinator handoff (issue #6208):

> "2026-11-16 (Mickey/Minnie): MM = Mickey alone ("Mickey Mouse"); new code ME = Minnie alone ("Minnie & Me"; avoid letters I/L; MN is Minions); MMF renamed "Mickey Group" in ColdLion and its licensor-site value is OPA "Standard Characters"."

**Effect.** Refines 6.38 with ColdLion codes. MG06 `MM` ("Mickey Mouse") is Mickey alone. New MG06 code `ME` ("Minnie & Me") is Minnie alone; codes avoid the letters I and L, and `MN` is already Minions. MG06 `MMF` is renamed "Mickey Group" in ColdLion (a ColdLion change, not a shared-db write) and maps to licensor-site value OPA "Standard Characters".

### 6.44 OWNER RULING — solo Minnie goes under "Minnie" > "Minnie & Me"; the "Mickey Mouse Family > Minnie & Me" placement is deleted (Albert Hazan, 2026-11-25)

Verbatim Albert, 2026-11-25 3:59 PM EST, asked whether solo Minnie art goes under "Mickey Mouse Family > Minnie & Me" (6.38) or "Minnie > Minnie & Me":

> "'Minnie > Minnie & Me'. delete the 'Mickey Mouse Family > Minnie & Me' decision."

**Effect.** Solo Minnie art (ColdLion MG06 `ME`) is submitted under the Disney OPA root property **"Minnie"**, character **"Minnie & Me"** — never under "Mickey Mouse Family". This replaces the Minnie half of 6.38 and the "under Mickey Mouse Family" wording of 6.43. Mickey alone ("Mickey Mouse Family" > "Mickey Mouse") and Mickey plus anyone ("Standard Characters") are unchanged. The database already carries this path (migration `20261204000500`); no data change.
