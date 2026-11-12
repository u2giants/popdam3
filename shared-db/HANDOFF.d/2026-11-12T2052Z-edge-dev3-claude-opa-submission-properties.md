---
issue: 2541
status: BLOCKED
owner: claude/edge-dev3 session bd88e001 (OPA submission properties)
---

# Handoff: Disney OPA submission properties in `core.property` (2026-11-12, 3:52 PM EST)

## 0. Business decisions only the owner can make

Put all of these to Albert in **one** message before starting work.

**Blocking**
1. **May the signed Disney contract be used to decide which studio (Disney, Marvel or Star Wars) an OPA property belongs to?** Albert asked at 2:49 PM EST "what are you using the contract for?", and the contract-based change (PR #6184) was closed in response. He has not cleared it since. It blocks placing "Standard Characters" and 12 others. *Recommendation:* yes. The contract only chooses the studio grouping; names stay exactly as Disney's site writes them.
2. **For the 917 OPA properties no contract clause names, should they all go under Disney (OPA files Marvel under Disney too), or stay unplaced?** *Recommendation:* leave them unplaced until a designer actually needs one. Ruling 2026-08-31 says the contract decides Disney vs Marvel, and OPA cannot tell them apart.

**Already settled — do not re-ask**
- 2026-10-26: "properties scraped from the submissions sites are 100% canonical" ([owner-rulings §6.31](https://github.com/popcre/shared-db/blob/main/docs/owner-rulings.md#631-owner-ruling-scraped-submission-properties-are-100-canonical-albert-hazan-2026-10-26)).
- 2026-11-12, 2:53 PM EST: a site property becomes *active* only if POP decides to use it. Unused ones are inactive.
- 2026-11-12, ~3:03 PM EST: the 493 site-only properties created today **stay** in `core.property` as `potential`.
- 2026-08-31: the signed contract schedule decides Disney vs Marvel ([licensing-master-data.md](https://github.com/popcre/shared-db/blob/main/docs/business-rules/licensing-master-data.md)).
- ColdLion MG06 is Albert's curated list. Never rename it from the scrape.

## 1. What this is

POP Creations (licensed home décor) is building an AI that fills licensor submission forms, Disney OPA first. Every property a designer picks must match an OPA option **exactly**. `core.property` in the shared Supabase database (production ref `qsllyeztdwjgirsysgai`) is the shared property list. `plm.opa_property` holds the scraped OPA properties (1,524 rows). Licensors: `core.licensor` codes DY (Disney), MV (Marvel), SW (Star Wars).

## 2. Goal this session

Find out why OPA properties "Minnie", "Preschool CG Mickey (& Friends)" and "Standard Characters" never became `core.property` rows, repair the step, and verify the result.

## 3. Current state (verified in production, 2026-11-12, ~2:40 PM EST)

- **Merged and live:** [PR #6154](https://github.com/popcre/shared-db/pull/6154), migration [20261112173641](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261112173641_curated_opa_submission_properties.sql). For the 515 OPA properties whose studio review (`plm.opa_property_studio_resolution`, status `canonical`) placed them, it reuses or creates a `core.property` row. Each gets one `core.taxonomy_source_ref` (`source_system='disney_opa'`) and one `plm.source_resolution` matched decision. Production proof: 515 refs, 515 matched resolutions; "Minnie" and "Preschool CG Mickey (& Friends)" exist as DY `potential` rows. 493 rows are new and code-less.
- **Verification sidecar merged:** [PR #6165](https://github.com/popcre/shared-db/pull/6165) (`scripts/production-verification-sidecars/20261112173641.json`, exact counts 515/515).
- **Side effect still in production:** migration 20261112173641 **renamed 21 existing coded rows** to their OPA spelling, e.g. `MICKEY MOUSE`→`Mickey Mouse`, `SPIDER MAN`→`Spider-Man`, `SW`'s none. The previous name is kept in `metadata->'submission_canonical'->>'previous_name'`. The restore (PR #6187) was **cancelled**, because live ColdLion already uses the OPA spellings (see §5). Leave the renames as they are.
- **Not done:** "Standard Characters" (OPA id 361) and 929 others are still unplaced (`resolution_status` `unresolved` or `ambiguous_crossover`). [PR #6184](https://github.com/popcre/shared-db/pull/6184) (closed, not merged) contains the contract-based placement of 13 ids: 361, 1159071163, 1159124989, 130, 1159109249, 536, 1118, 1159141309, 380, 1159128413, 1159088182, 1034, 1159137990. Each is backed by a Disney-section clause of contract K2557. Its branch `db/2541-opa-contract-placement` still exists. Reuse it only after §0 item 1 is answered, and re-reserve the migration version (20261112194322 was never applied).
- Nothing uncommitted.

## 4. What did not work

- **Contract matching by substring** wrongly hit character mentions (Big Bad Wolf, Jessie, Witch inside other clauses). Only exact franchise-title matches are valid, which is how the 13 ids were chosen.
- **The automatic fixer's PR #6164** edited the already-merged migration. That is refused; fix forward with a sidecar instead. It was closed.
- **Production promotion was held** by review finding #6162 until it closed. A manual run of `automatic-production-trigger.yml` then dispatched it.
- **Trusting `core."merchGroup"` / old `core.property` names as "what ColdLion has"** was wrong: both are frozen since June 2026 (see issue [#6194](https://github.com/popcre/shared-db/issues/6194)). Live ColdLion is `coldlion.merch_group_detail` (mg_type_code '06').

## 5. Key findings

- Root cause: ruling 6.31 was applied only to Paramount ([20261026150931](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261026150931_curated_vm_trackerplus_submission_properties.sql)). The #5079 scrape promotion created OPA *characters* only.
- Live ColdLion active DY/MV/SW MG06 names (51) all match OPA names exactly.
- OPA branch (`plm.opa_property_scope_membership.branch_code`) is `disney` for Marvel too, so it is useless for Disney vs Marvel.
- The contract schedule CSV is private: `u2giants/licensor-source-data` → `disney-dcpvault/derived/contract-k2557-property-schedule.csv` (148 clauses: disney 96, marvel 30, star_wars 22). The studio audit is `disney-opa/studio-resolution/opa-property-studio-resolution-audit.csv`.
- Writes to `core.property` need a `plm.licensing_write_authorization` row (`licensing_review_create` for inserts with status `potential`, `scrape_consolidation` for renames). `plm.opa_property` resolution columns are immutable; use `plm.set_source_resolution`.

## 6. Next steps

1. Ask §0 in one message. *Done when Albert answers.*
2. If item 1 is yes: rebuild PR #6184's migration on a fresh version from current main, add a sidecar (expected 528/528) and its registry entry, and land it through the merge queue. *Done when the production query `select 1 from core.property p join core.licensor l on l.id=p.licensor_id where l.code='DY' and p.name='Standard Characters'` returns a row.*
3. Apply item 2's answer the same way.
4. Delete this file when #2541's OPA part is finished.

## 7. Constraints

Claim objects on #2541 before writing. Fix forward and never edit a merged migration. Migrations need a production verification sidecar when they are a single `do` block. Production changes land only via the merge queue plus automatic promotion. No licensed names in public files.

## 8. Access

Supabase MCP is bound to **production** (prove it with `get_project_url` before every write). `gh` is authenticated as u2giants. The private repo is cloned at the owner's `~/repos/licensor-source-data`.

## 9. Risks

- The 21 renamed rows: ColdLion matches them, but any app that compared old uppercase names will now differ. Not observed.
- Coordinator session `local_a42eb110` pushed to redo PR #6184 without Albert's word. Don't.

Self-audit: §0 holds both owner decisions; failures are in §4; next steps have gates (§6); all references are GitHub URLs or repo-relative private paths.
