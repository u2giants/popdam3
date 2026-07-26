# Handoff — ColdLion licensor/property Phase 3

## 1. What this application is

`u2giants/shared-db` owns the shared Supabase schema and data-integration contracts used by CRM,
DAM/PopSG, PM/PIM, DB Data Admin, and DesignFlow-adjacent workflows. Licensors and Properties are
stable canonical records in `core.licensor` and `core.property` (every property has exactly one
licensor via `core.property.licensor_id`). Phase 3 is **reconciliation and decisions only**: it
produces the row-level ruling ledger, typed dispositions, and the frozen Phase 4 mapping input. It
does **not** link, create, status-change, rename, reparent, schedule, or mutate any
canonical/source-reference data.

## 2. What this session set out to do

Execute Phase 3 only against preview `rjyboqwcdzcocqgmsyel`: satisfy the remaining entry gate with a
fresh trustworthy DesignFlow comparison snapshot, build a row-level ruling ledger with typed
dispositions and named human owners for every non-automatic decision, freeze + hash the Phase 4
approved-mapping input, carry forward the Phase 2B immutability baseline, and write dated
verification + this handoff. No production access, no canonical/source-reference mutation, no
schedule, no app deployment, no DesignFlow deprecation.

## 3. Current state (2026-07-25; UTC evidence 2026-07-26T02:06:51Z)

- Branch: `codex/coldlion-licensor-property-phase3`. This session did not commit, push, open/merge a
  PR, or switch branches.
- Preview: `rjyboqwcdzcocqgmsyel`. Production `qsllyeztdwjgirsysgai` was never connected.
- **Entry gate satisfied.** A fresh read-only DesignFlow `getLicensorsWithProperties` pull on
  2026-07-26T02:06:51Z returned HTTP 200 (DesignFlow recovered from its 2026-07-19 502 outage):
  37 licensor rows / 20 distinct codes, 468 property rows / 256 distinct codes, 468 parent edges,
  edge hash `151bc8cedc988f9ad3ddc5eba6036275`. Captured by
  `tools/coldlion-licensor-property-phase3-designflow-snapshot.mjs`. The snapshot was regenerated
  with the corrected API `title` mapping; `titles_complete=true`, with zero blank Licensor or
  Property names. Offline tests lock the title-first mapping and blank-title guard.
- **Parent-edge evidence: 256/256 canonical property parents agree** with the fresh DesignFlow edges
  (0 disagreements), recomputed locally in `parent-comparison.json`.
- **Ruling ledger:** 570 rows covering all 560 ColdLion source rows and all 282 canonical UUIDs
  (272 distinct matched via source + 10 canonical-only). Zero unexplained ambiguity; zero status
  differences.
- **Phase 4 approved-mapping input: FROZEN, EMPTY, and hashed.** Phase 3 recorded **no human
  approval**, so `approved_mappings = []`
  (`approved_mapping_hash = d41d8cd98f00b204e9800998ecf8427e`, md5 of the empty set). The 542
  exact-compatible matches are **proposed** (`auto_eligible`, `phase4-proposed-auto-mapping.csv`,
  hash `1230f5a12d0f2a3029f1d3df17fc5b5f` → 271 distinct canonical UUIDs). The 2 NASA rows are a
  pending link (`phase4-pending-link-mapping.csv`, hash `2edf77b7ddd8d0405f93d020003b9540`, owner
  Albert). 26 rows are not-linked (2 FRIDA KAHLO licensor, 2 ZAG, 12 ColdLion-only properties, 10
  canonical-only incl. FRIENDS TV).
- **Immutability:** Phase 3 writes nothing, so the Phase 2B baseline hashes are authoritative
  (`coverage-summary.json` → `phase2_baseline_carried_forward`). A one-off read-only preview
  re-measurement corroborates all 14 baseline checks unchanged (`immutability.json`, pass: true).
- Phase 3 validation test: 13/13 pass. Existing Phase 1/2A/runner tests: 1/1, 1/1, 34/34 pass.
  `scripts/check-sql.sh`: pass.
- DesignFlow remains enabled; the Phase 6 parallel-run clock has not started.

Evidence folder:
[`docs/verification/coldlion-licensor-property-phase3-20260725/`](docs/verification/coldlion-licensor-property-phase3-20260725/README.md)
(`README.md`, `coverage-summary.json`, `ruling-ledger-licensors.csv`, `ruling-ledger-properties.csv`,
`dispositions.csv`, `phase4-approved-mapping.json`, `phase4-proposed-auto-mapping.csv`,
`phase4-pending-link-mapping.csv`, `parent-edges.csv`, `parent-comparison.json`, `immutability.json`,
`designflow-fresh-snapshot.json`, `designflow-fresh-edges.json`, `review-findings.csv`).

New additive tools (read-only / local; no migration, no DB-function change):
- `tools/coldlion-licensor-property-phase3-designflow-snapshot.mjs` — read-only DesignFlow GET.
- `tools/generate-coldlion-licensor-property-phase3-report.mjs` — **deterministic, local** (no DB, no
  credentials) ruling-ledger + mapping + coverage generator.
- `tools/coldlion-licensor-property-phase3.test.mjs` — locks coverage, hash stability, no
  cross-entity matches, named owners, and the empty/blocked approved input.

## 4. Correction applied to an earlier Phase 3 draft

An earlier Phase 3 draft (a concurrent attempt) generated the ledger by connecting to preview and
declared the 542 exact-compatible matches `approved_automatic` / "Tier A ready to link," with Phase 4
"ready to start." That framing violates the cutover §15.3 Phase 3 exit contract and the delegation's
explicit rule: human decisions remain pending, so **the frozen approved input may be empty and Phase
4 must be stated as blocked** — no human approval was recorded. This session rebuilt the artifacts
**deterministically from the frozen Phase 2 CSVs** (no DB), corrected the ruling everywhere
(HANDOFF, cutover, Phase 2B handoff, README, this handoff), and replaced `phase4-mapping.{json,csv}`
with `phase4-approved-mapping.json` (empty approved) + `phase4-proposed-auto-mapping.csv` +
`phase4-pending-link-mapping.csv`. The content hashes (`1230f5a1…` proposed, `2edf77b7…` pending)
are identical to the earlier draft's, cross-checking that the frozen Phase 2 CSVs faithfully
represent live preview.

## 5. Root causes and key findings

1. **DesignFlow recovered.** The 2026-07-19 `getLicensorsWithProperties` HTTP 502 outage is over; the
   endpoint is healthy (HTTP 200, 18,727 ms) and returns the expected 37/20/468/256 shape.
2. **The Phase 2B ledger needed only a ruling layer, not re-derivation.** The mirror/canonical data
   was unchanged (immutability corroborated), so Phase 3 layered typed dispositions + owners + a
   Phase 4 mapping on top of the existing Phase 2 classification.
3. **The two dangerous collisions resolve cleanly by entity type.** `FK` and `FR` each appear as both
   a licensor and a property; the typed natural key keeps them separate: FRIDA KAHLO *licensor*
   quarantines while FRIDA KAHLO *property* auto-matches; FRIENDS TV *licensor* FR is preserved while
   ColdLion property FR (1ST ORDER TROOPER) auto-matches to canonical property FR.
4. **NASA is the only cross-code same-entity match** (ColdLion `NA` → canonical `X-NASA` by unique
   normalized name). It is an alias/rename candidate gated on Albert because the code differs; any
   link preserves canonical code `X-NASA`.
5. **The 30 conservative DB conflict findings reduce to one true blocker.** 14 of the 15 reused codes
   have an exact same-entity canonical match; only `FK`-as-licensor has no same-entity candidate.
6. **Phase 6 clock still not started.** The fresh pull is a one-off read-only API GET, not a
   scheduled `ingest.sync_run` refresh (latest scheduled `designflow_plm` success is still
   2026-07-08).

## 6. Exact next steps (Phase 4 — BLOCKED until human approval)

1. **Phase 4 cannot start until Albert approves the proposed mapping set**, moving the 542
   `auto_eligible` rows from `phase4-proposed-auto-mapping.csv` into `phase4-approved-mapping.json`'s
   `approved_mappings` (re-hashing the now-non-empty approved set), and records dispositions for the
   28 pending rows. Until then the approved input stays empty and Phase 4 stays blocked.
2. Start a fresh Phase 4 session; reread `AGENTS.md`, this handoff, and the full cutover plan. Gate:
   session states preview `rjyboqwcdzcocqgmsyel` and no production credential/URL is present.
3. Re-run `node tools/generate-coldlion-licensor-property-phase3-report.mjs`; expect identical mapping
   hashes and `coverage-summary.json` baseline carried forward unchanged.
4. Implement/extend `link_approved` to consume **only the approved rows**. Write ColdLion source refs
   with `source_id` = slash-joined `<companyCode>/<divisionCode>/<mgTypeCode>/<mgCode>` **beside** the
   505 existing DesignFlow refs; set each mirror row's `licensor_id`/`property_id`. Change no
   canonical code/name/status/parent and create no canonical rows.
5. (Only if Albert separately approves) link the NASA rows (`NA` → `X-NASA`), preserving code
   `X-NASA`.
6. Prove post-run: UUID set, row counts, status hash, parent-edge hash, and dependent-FK counts
   unchanged; ColdLion source refs now = approved count; DesignFlow refs still 505; 0 canonical
   creates; rollback of links rehearsed.
7. Explicitly rule Phase 5 yes/no from the not-linked list (FRIDA KAHLO licensor, ZAG, 12
   ColdLion-only properties).
8. Forward-impact audit before handoff.

Phase 4 must NOT link any row that is not in the approved set, and must not consume the Phase 5
candidates — those are not in the approved mapping.

## 7. Constraints and gotchas

- Never match across entity types by code alone (`mgCode` is unique only within
  `(division, mgTypeCode)`). `FK`/`FR`/`1P`/`CB`/… are reused across licensor(05)/property(06).
- Field ownership (plan §5.2): the NASA link preserves canonical code `X-NASA`; Phase 4 reports drift,
  never overwrites code/name. Status/parent are Supabase-owned and never touched by linking.
- Lapsed licenses (NASA, ZAG, FRIDA KAHLO) must never be activated/resurrected by source presence.
- Preview DB access (only if re-capturing `immutability.json` or re-deriving live): use Node `pg` from
  `C:\repos\oracle\node_modules` against the preview pooler; credentials from 1Password vault
  `vibe_coding`. Never print or commit secret values; never use production credentials/URLs.
- The report generator and validation test are fully local (no DB, no credentials, no network).

## 8. Access and environment

- Preview: `rjyboqwcdzcocqgmsyel` (branch `shared-db-schema-rehearsal`), pooler port 6543.
- Secrets: 1Password vault `vibe_coding` (preview DB fields; DesignFlow key at
  `op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key`). No secret value was printed or
  committed. The local generator/test need none of these.
- Production credentials/URLs were not used.

## 9. Open questions and risks (all owned by Albert Hazan — none approved)

- **Approve the proposed auto-mapping set (542)?** Required to unblock Phase 4 at all.
- **NASA cross-code link:** approve linking ColdLion `NA` → canonical `X-NASA` (preserve code)?
- **FRIENDS TV (FR) option 1/2/3:** remain curated/DesignFlow-only (recommended), map to a verified
  ColdLion key, or retire via approved lifecycle change?
- **Phase 5 creates:** does Albert want canonical records for ZAG licensor, FRIDA KAHLO licensor, or
  any of the 12 ColdLion-only properties (Shrek 5, Peanuts 75th, Cheers, The Exorcist, The Lost Boys,
  Supergirl Theatrical 2026)? Each property needs an approved parent first; if none, Phase 5 is
  explicitly "not needed."
- **canonical-only review:** confirm the 5 `X-` licensors + 4 properties (ADT, OGW, RS, SFS) remain
  as-is.

## Forward-impact audit

Phase 3 changed later-phase inputs only (no schema/key/permission/function/signature/encoding/schedule
change — only new read-only/local tools + evidence):

1. **Phase 4** has an exact frozen input that is **empty until a human approves** (proposed 542→271,
   hash `1230f5a1…`; pending NASA 2, hash `2edf77b7…`).
2. **Phase 5** candidates are a specific enumerated list (FRIDA KAHLO licensor, ZAG, 12 ColdLion-only
   properties), not an open "if found."
3. **Phase 6:** DesignFlow is healthy again, so its entry condition is satisfiable once scheduled
   refreshes exist; the 14-day clock still requires scheduled ColdLion + DesignFlow runs.
4. **FRIENDS TV** disposition is an owner decision that does not block Phase 4 and can settle before
   Phase 8.
5. No Phase 7/8 assumption changed.

These are reflected in the updated Phase 3/4 cold-start contracts in
[`fix_coldlion_licensor_property_cutover.md`](fix_coldlion_licensor_property_cutover.md).

## Handoff self-audit

Passed on 2026-07-25 after rereading this handoff without relying on chat context:

1. **Could a developer start Phase 4 with no questions? No — correctly blocked.** Phase 4 is gated on
   Albert's approval of the proposed mapping set and the 28 pending dispositions. Sections 3 and 6
   state this explicitly and give the empty approved input + hashes as evidence.
2. **Could that developer continue as effectively as this session? Yes.** Sections 3–6 give the frozen
   mapping + hashes, the reproducible local generator/test, the entity-typed collision resolution, the
   30→1 reduction, and the ordered Phase 4 steps gated on approval.
3. **Everything tried and every failure explained? Yes.** Section 4 records the correction of the
   earlier draft's `approved_automatic` framing; no canonical/source-reference data was mutated.
4. **Every next step concrete and verifiable? Yes.** Section 6 lists the approval gate first, then
   ordered Phase 4 actions with exact post-run hash/count expectations.
5. **Every term/path/environment/constraint explained? Yes.** Sections 1, 3, 7, 8 define Phase 3
   scope, preview identity, the local/no-DB generator, entity-typing, field ownership, and the
   no-production boundary. Section 9 names the remaining owner decisions.

No gap remained after this audit. This handoff is comprehensive enough for a fresh developer to
execute Phase 4 safely — starting with obtaining Albert's approval — without this conversation.
