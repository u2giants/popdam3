# Handoff — ColdLion licensor/property Phase 4

## 1. What this application is

`u2giants/shared-db` owns the shared Supabase schema and data-integration contracts used by CRM,
DAM/PopSG, PM/PIM, DB Data Admin, and DesignFlow-adjacent workflows. Licensors and Properties are
stable canonical records in `core.licensor` and `core.property` (every property has exactly one
licensor via `core.property.licensor_id`). Phase 4 is **approved canonical linking**: it attaches
deterministic ColdLion provenance (`core.taxonomy_source_ref`) and typed mirror links
(`plm.erp_licensor.licensor_id` / `plm.erp_property.property_id`) for exactly the human-approved
mapping set. It does **not** create canonical rows, change canonical code/name/status/UUID/parent,
schedule anything, or deprecate DesignFlow.

## 2. What this session set out to do

Execute Phase 4 only against preview `rjyboqwcdzcocqgmsyel`: consume the owner-approved 542-row
mapping set (Albert Hazan, 2026-07-25, hash `1230f5a12d0f2a3029f1d3df17fc5b5f`) through additive
timestamped migrations implementing a guarded `link_approved` mode that cannot create canonical
rows, cannot mutate canonical fields, and cannot accept unapproved mappings; prove it with
rolled-back SQL contracts, Node tests, a preview rollback rehearsal, a committed apply, idempotent
re-runs, and before/after immutability evidence; then write dated verification + this handoff. No
production access, no Phase 5 creates, no schedule, no app deployment, no DesignFlow deprecation.

## 3. Current state (2026-07-26) — Phase 4 COMPLETE, PASS

- Branch: `codex/coldlion-licensor-property-phase4`. This session did not commit, push, open/merge a
  PR, or switch branches.
- Preview: `rjyboqwcdzcocqgmsyel`. Production `qsllyeztdwjgirsysgai` was never connected.
- **Approval:** Albert Hazan approved ONLY the 542 exact-compatible proposed mappings on 2026-07-25
  (38 licensor + 504 property mappings → 271 distinct canonical UUIDs: 19 licensor + 252 property).
  Frozen artifact:
  [`docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json`](docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json),
  hash `1230f5a12d0f2a3029f1d3df17fc5b5f`. Explicit exclusions recorded: NASA ×2 (pending), FRIDA
  KAHLO licensor ×2, ZAG ×2, 12 ColdLion-only properties, 10 canonical-only incl. FRIENDS TV, and
  all Phase 5 creates.
- **Migrations applied to preview (additive):**
  - `20260726030000_coldlion_licensor_property_phase4_link_approved.sql` — `link_approved`:
    ungranted deep-validation core `plm.link_coldlion_licensors_properties_core` (owner-only) +
    pinned wrapper `plm.link_coldlion_licensors_properties_approved` (service_role) rejecting every
    expected contract except hash `1230f5a1…`/count 542/distinct 271; 3-arg
    `plm/public.sync_coldlion_licensors_properties` dispatch; `mirror_only` preserved byte-identical.
  - `20260726031000_coldlion_licensor_property_phase4_null_shape_guard.sql` — `IS DISTINCT FROM`
    JSON shape guards (NULL `input.mappings` previously slipped past `<> 'array'` as UNKNOWN).
  - `20260726032000_coldlion_licensor_property_phase4_browser_execute_revoke.sql` — explicit
    anon/authenticated revokes; hosted-preview default privileges had granted browser roles EXECUTE
    and `REVOKE FROM PUBLIC` alone did not remove them. Core ungranted; entry points service_role-only.
- **Runs (preview `ingest.sync_run`, source `coldlion_licensors_properties_link_approved`):**
  - Rollback rehearsal `e6393a4e-db19-4426-9519-924c797ad888`: would insert/link 542; `ROLLBACK`
    restored 505 refs / 0 ColdLion links (atomicity proven).
  - Committed apply `875109b5-2ac9-41a9-8280-4c4a36f6b639`: **542 refs inserted, 542 mirror links
    set** (38 licensor + 504 property).
  - Idempotent re-runs `9dd0f675-30fc-4ff2-8010-9558bc075617` and
    `eb045c1b-85d5-4d0e-bb25-f86004e52f5a`: 0 inserted / 0 updated / 542 unchanged.
- **Immutability (before = after):** canonical 26 licensors / 256 properties; licensor UUID hash
  `590ea83ea6df1487fcfc1e18b3ef6a0d`; licensor status hash `d9b07759bf80ff227e2fa9bd635d2138`;
  property UUID hash `e0e6c36eb02bb2d320c0deaff7aa8f8c`; property status hash
  `f436d4acd79761fedbfc9b5796ac7bce`; parent-edge hash `7459f6826cc59468779e7ead33ec0edc`.
- **Provenance/links:** `core.taxonomy_source_ref` = **1047** (505 `designflow_plm` preserved + 542
  `coldlion`/`merchGroupDetails` added, slash composite `source_id`); mirror links 38 + 504
  (`manually_matched`, approver stamped); **zero excluded rows linked; zero canonical rows created**.
- **Local gates:** Phase 2 + Phase 4 rolled-back SQL contracts pass on preview; 63 Node tests pass;
  `scripts/check-sql.sh` passes.
- **Phase 5: ruled NOT NEEDED / BLOCKED** — zero canonical creates approved; no Phase 5 schema/data
  work may begin. Phase 6 parallel-run clock not started (latest scheduled `designflow_plm` success
  still 2026-07-08).

Evidence folder:
[`docs/verification/coldlion-licensor-property-phase4-20260725/`](docs/verification/coldlion-licensor-property-phase4-20260725/README.md)
(`README.md`, `approved-mapping.json`).

New tools (local/dry-run-default; no network in tests):
- `tools/run-coldlion-licensor-property-phase4.mjs` — link runner; recomputes + pins
  hash/count/distinct from the frozen file, requires target preview + approver Albert Hazan, refuses
  production targets, `--apply --linked` only, records durable failures, never prints secrets.
- `tools/run-coldlion-licensor-property-phase4.test.mjs` — 14 tests (exact input, tampering,
  NASA/extra/removed row, wrong target/hash/count/distinct/approver, SQL shape, target guards).

## 4. Failed paths and corrections (all closed before PASS)

1. **Kimi session slowness/timeouts** — work was split into bounded, separately verifiable slices.
2. **Grok review found test regressions** — the expected contract was caller-controlled, so a caller
   could self-authorize an unapproved payload. Fixed by splitting the function into the pinned
   wrapper (granted path; accepts only hash `1230f5a1…`/542/271) and the ungranted core (all deep
   validation/link logic; owner-only). Contracts updated; PASS.
3. **Stale broad Phase 2 fixture assertion** — `run1 expected 6 inserted` assumed a fresh database;
   on the long-lived preview the fixed fixture keys may pre-exist. `phase2_contracts` §1 now
   requires rows_seen/entity totals = 6 and inserted+updated+unchanged = 6 (idempotent re-run still
   0/0/6; importer behavior unchanged).
4. **NULL jsonb guard** — `jsonb_typeof(v_mappings) <> 'array'` evaluated UNKNOWN for missing
   `mappings`, skipping the documented rejection. Corrected by `20260726031000` (`IS DISTINCT FROM`).
5. **Explicit anon/auth default grants** — hosted preview granted browser roles EXECUTE on the new
   3-arg functions via default privileges; `REVOKE FROM PUBLIC` did not remove explicit grants.
   Corrected by `20260726032000`.
6. **One `DATABASE_URL` pooler prepared-statement failure** — a direct pooler attempt failed before
   writing any run (no partial work). The `--linked` Supabase CLI path worked and was used for apply.

## 5. Root causes and key findings

1. **Approval must be pinned in the database, not carried by the caller.** Any contract argument a
   caller can supply can authorize itself; the pinned wrapper makes the approved
   hash/count/distinct a server-side constant, and the ungranted core keeps deep logic unreachable
   except through the pin.
2. **NULL defeats `<>` guards.** Postgres three-valued logic turns `NULL <> 'array'` into UNKNOWN;
   every JSON shape guard that can see SQL NULL must use `IS DISTINCT FROM`.
3. **Hosted Supabase default privileges are explicit grants.** New functions can be executable by
   `anon`/`authenticated` even after `REVOKE ... FROM PUBLIC`; explicit per-role revokes (and a
   catalog assertion in contracts) are required.
4. **Long-lived preview breaks fresh-database assumptions in tests.** Fixed fixture keys may
   pre-exist; rolled-back contracts must assert accounting totals, not insert-only outcomes.
5. **`supabase db query --linked` is the reliable apply path on Windows** (no `psql`; one pooler
   prepared-statement failure via `DATABASE_URL` wrote nothing).

## 6. Exact next steps

1. **Phase 5: do NOT begin.** Ruled NOT NEEDED/BLOCKED — the owner approved zero creates. ZAG
   licensor, FRIDA KAHLO licensor, and the 12 ColdLion-only properties remain outside canonical
   unless Albert separately approves specific creates (each property then needs an approved
   `licensor_id` parent first).
2. **NASA stays pending.** Linking `NA`→`X-NASA` (preserving canonical code `X-NASA`) requires
   Albert's explicit approval (pending hash `2edf77b7ddd8d0405f93d020003b9540`); it is NOT part of
   the Phase 4 set.
3. **Phase 6 (parallel run)** is the next phase when the owner calls it: scheduled mirror-only
   ColdLion sync + continued DesignFlow sync + daily comparison + alerts, ≥14 days of evidence
   (cutover §Phase 6 and §9.4). The clock has not started; entry requires Phases 3–5 complete or
   explicitly not needed (satisfied: 3 complete, 4 complete, 5 ruled not needed) plus
   schedules/alerts tested.
4. **Promotion to production is a separate approved window** (AGENTS §5/§5.1): the three Phase 4
   migrations are preview-only; production promotion needs explicit owner approval and the
   bounded-temp-checkout protocol (never `--include-all`).
5. Start any later phase as a fresh session; reread `AGENTS.md`, this handoff, and the full cutover
   plan first.

## 7. Constraints and gotchas

- The pinned wrapper accepts exactly one expected contract: hash
  `1230f5a12d0f2a3029f1d3df17fc5b5f`, count 542, distinct 271. Anything else — including NASA,
  pending rows, or a trimmed/extended variant — raises before validation. The ungranted core is not
  callable by service_role/anon/authenticated/public.
- `link_approved` writes ONLY `core.taxonomy_source_ref` (`coldlion`/`merchGroupDetails`, composite
  `source_id`), typed mirror link columns (`manually_matched`), and `ingest.sync_run` accounting.
  It never creates/mutates canonical rows, status, names, codes, UUIDs, or parents, and never
  activates lapsed licenses.
- Idempotency: same-entity pre-existing refs are skipped (`ON CONFLICT DO NOTHING`); only NULL
  mirror link columns are written; committed re-runs report 0/0/542 and never churn `resolved_at`.
- Never match across entity types by code alone (`mgCode` is unique only within
  `(division, mgTypeCode)`). `FK`/`FR` are reused across licensor(05)/property(06).
- Preview DB access: Node `pg` from `C:\repos\oracle\node_modules` against the preview pooler, or
  `supabase db query --linked`; credentials from 1Password vault `vibe_coding`. Never print or
  commit secret values; never use production credentials/URLs.
- The runner and Node tests are fully local (no DB, no credentials, no network) except an explicit
  `--apply --linked` run against preview.

## 8. Access and environment

- Preview: `rjyboqwcdzcocqgmsyel` (branch `shared-db-schema-rehearsal`), pooler port 6543; linked
  CLI project ref confirmed preview before apply.
- Secrets: 1Password vault `vibe_coding` (Supabase CLI PAT; preview branch credentials). No secret
  value was printed or committed.
- Production credentials/URLs were not used; production was never connected.

## 9. Open questions and risks (all owned by Albert Hazan — none approved)

- **NASA cross-code link:** approve linking ColdLion `NA` → canonical `X-NASA` (preserve code)?
- **FRIENDS TV (FR) option 1/2/3:** remain curated/DesignFlow-only (recommended), map to a verified
  ColdLion key, or retire via approved lifecycle change?
- **Phase 5 creates (currently ruled NOT NEEDED):** does Albert want canonical records for ZAG
  licensor, FRIDA KAHLO licensor, or any of the 12 ColdLion-only properties (Shrek 5, Peanuts 75th,
  Cheers, The Exorcist, The Lost Boys, Supergirl Theatrical 2026)? Each property needs an approved
  parent first.
- **canonical-only review:** confirm the 5 `X-` licensors + 4 properties (ADT, OGW, RS, SFS) remain
  as-is.
- **Production promotion window:** when (if ever) should the three Phase 4 migrations be promoted
  per AGENTS §5.1?

## Forward-impact audit

Phase 4 changed later-phase inputs (new schema functions + provenance/link data on preview; no
canonical mutation, no schedule, no production change):

1. **Phase 5** is explicitly ruled NOT NEEDED/BLOCKED (zero creates approved); its candidate set
   remains the enumerated list (ZAG, FRIDA KAHLO licensor, 12 ColdLion-only properties).
2. **Phase 6** entry is partially satisfied (Phases 3–5 complete or ruled); its clock still
   requires scheduled ColdLion + DesignFlow runs — none exist yet.
3. **Phase 7/8 (production cutover/retirement):** ColdLion provenance now exists on preview for
   every approved row (1047 refs), so cutover comparisons can key on `coldlion`/`merchGroupDetails`
   composite `source_id`; production promotion is a separate approved window.
4. **Consumers** reading `core.taxonomy_source_ref` or the mirror resolution columns now see
   `coldlion` refs and `manually_matched` links on preview only; app smoke checks against preview
   were part of the Phase 4 gate and passed via the contract suites.
5. No Phase 6–8 assumption about field ownership changed: status/parent remain Supabase-owned.

## Handoff self-audit

Passed on 2026-07-26 after rereading this handoff without relying on chat context:

1. **Could a developer start the next phase with no questions? Yes.** Phase 5 is explicitly ruled
   NOT NEEDED with the enumerated candidate list; Phase 6 entry/clock conditions and the production
   promotion boundary are stated with exact section references (§6).
2. **Could that developer continue as effectively as this session? Yes.** §3 gives the migrations,
   run IDs, hashes, and totals; §4–§5 record every failure and its root cause; §7 lists the
   operational traps (pin, NULL guards, default grants, preview apply path).
3. **Everything tried and every failure explained? Yes.** §4 records all six failed paths and the
   corrections; the final state is PASS with run IDs.
4. **Every next step concrete and verifiable? Yes.** §6 orders the remaining decisions (NASA,
   FRIENDS TV, Phase 5 candidates, Phase 6 start, production window) with owners and gates.
5. **Every term/path/environment/constraint explained? Yes.** §§1, 3, 7, 8 define scope, preview
   identity, the pinned/ungranted architecture, access paths, and the no-production boundary; §9
   names the remaining owner decisions.

No gap remained after this audit. This handoff is comprehensive enough for a fresh developer to
execute Phase 6 preparation — or a separately approved NASA/Phase 5 decision — without this
conversation.
