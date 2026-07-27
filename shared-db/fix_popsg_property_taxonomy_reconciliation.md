# PopSG Property taxonomy reconciliation — unified bounded plan

**Status:** PLAN ONLY — no schema, data, application, or production changes are
authorized by this document.
**Written:** 2026-07-26
**Independent review:** revised 2026-07-26 after an exact-model
`claude-opus-5` read-only review; all Critical/High findings incorporated
**Business owner / approval authority:** Albert Hazan
**Canonical database repository:** `u2giants/shared-db`
(`/worksp/shared-db`)
**Consumer application:** `u2giants/popdam3` (`/worksp/popdam`)
**Preview Supabase project:** `rjyboqwcdzcocqgmsyel`
**Production Supabase project:** `qsllyeztdwjgirsysgai`

---

## 1. Purpose and unification decision

This is the **single formal execution plan** for reconciling PopSG folder-derived
Property values with the shared canonical Property catalogue.

Before this document, the required knowledge was split between:

1. `fix_coldlion_licensor_property_cutover.md`, which governs how ColdLion source
   rows relate to stable `core.licensor` / `core.property` records; and
2. `docs/style-guides-characters-and-royalties.md`, which defines what a Property
   means, how style guides relate to Properties, the Disney Classics `CP` rule,
   and the no-code rule.

Those documents remain authoritative for their respective architecture and
source-cutover subjects. This plan **does not copy or replace them**. It unifies
their decisions into one bounded PopSG workstream, with explicit phases,
artifacts, approval gates, implementation ownership, rollout, rollback, and
verification.

Future sessions working on PopSG Property matching should start here, then open
the two upstream authority documents only for deeper context. If an upstream
rule changes, update that authority first and then update this plan's executable
interpretation.

## 2. Application and problem statement

PopSG is the style-guide library served by the PopDAM codebase at
`https://sg.designflow.app`. Agents crawl the NAS style-guide share into
`public.style_guide_files`. The crawler currently derives
`licensor_name`, `property_folder`, and `style_guide_folder` from path segments.
Those fields are observations about folder names, not proof that the folder is a
canonical Licensor or Property.

The deterministic file-tag pipeline resolves observed values against the shared
catalogue in `core.licensor` and `core.property`, then writes accepted
relationships to `public.style_guide_file_tags`. Its Property alias list in
`apps/worker/src/handlers/popsg-tags.ts` is currently empty.

The current worker is **not yet Licensor-scoped for Property matching**:
`buildPopSGTaxonomyLookups` builds one global normalized-value map per facet and
`resolvePopSGField` receives no Licensor argument. The roughly 50,927 raw
Property fields that resolved in the 2026-07-26 rebuild were therefore produced
under global exact matching. Moving to Licensor-first matching is an intentional
safety correction, but it may remove previously accepted automatic Property
tags. That signed delta must be inventoried, explained, approved, and gated; a
coverage decrease is never allowed to disappear inside the general unresolved
count.

Licensor resolution also currently depends on eight hard-coded worker aliases:
`NBC Universal → NBC`, `Marvel Style Guide → Marvel`,
`One Piece → TOEI - ONE PIECE`, `Peanuts → Peanuts Worldwide`,
`Sesame Workshop → Sesame Street`, and
`Paramount/Nickelodeon/Viacom → Viacom Multi`. These are load-bearing inputs to
Property parent selection, not incidental cleanup. PSG-0/1 must measure and
review their blast radius before any Property decision is made effective.

The production rebuild completed on 2026-07-26:

| Measure | Verified production result |
|---|---:|
| Active PopSG files processed | 216,417 |
| Files with a raw Property value | 216,201 |
| Raw Property fields unresolved | 165,274 |
| Raw Property unresolved rate | 76.44% |
| Deterministic failures | 0 |
| Canonical `core.property` rows at the measured baseline | 256 |

These numbers describe **file occurrences**, not distinct Property candidates.
A frequently repeated folder can account for thousands of files. The first
deliverable is therefore a distinct-value inventory grouped by resolved
Licensor and normalized raw Property value.

The business objective is not “make the unresolved counter equal zero at any
cost.” The objective is:

- every observed Property value receives a defensible, reviewable disposition;
- only genuine canonical Properties produce Property tags;
- deliberate non-Properties and no-code titles remain visibly untagged;
- no fuzzy guess silently creates or links business master data;
- the same decision is applied consistently to every matching file.

## 3. Non-negotiable taxonomy rules

These rules are already decided and must not be reopened during implementation:

1. **Canonical identity lives in `core.property`.** PopSG folder text is
   evidence, never authority.
2. **Every canonical Property has exactly one canonical Licensor parent.**
   `core.property.licensor_id` is the authority. Never infer the parent from a
   globally unique-looking code or folder depth.
3. **Resolve the Licensor first, then resolve the Property within that
   Licensor.** A Property decision may never cross the canonical parent edge.
4. **Exact, normalized matching is allowed. Fuzzy automatic matching is not.**
   Fuzzy matching can be shown as review evidence but can never approve or write
   a mapping.
5. **A style guide is not a Property.** Collection names, style-guide names,
   seasons, folders such as “In Development,” and customer/program structure
   must not be promoted into `core.property`.
6. **The canonical Property list follows ColdLion-coded business Properties.**
   Merely being licensed for a title is insufficient.
7. **Disney Classics use the existing `CP — CLASSIC PROPERTIES` Property only
   under the owner rule in
   `docs/style-guides-characters-and-royalties.md` §5A.0.** That authority owns
   the title examples and interpretation. “Titles like them” is not permission
   for similarity matching: every title not already on an owner-approved
   Classics list needs explicit owner confirmation.
8. **No code means no invented Property.** The exact rule and examples live in
   `docs/style-guides-characters-and-royalties.md` §5A.0; this plan merely
   enforces the result that an unapproved/no-code title stays untagged.
9. **Canonical creation is separately owner-gated.** ColdLion Phase 5 is
   currently `NOT NEEDED / BLOCKED`, with zero approved creates and a documented
   candidate set. This plan cannot reopen it implicitly.
10. **Manual tags and rejected automatic tags are preserved during rebuilds.**

## 4. Scope

### In scope

- Inventory every distinct normalized `property_folder` observed on active
  PopSG files, separated by whether canonical Licensor resolution succeeded.
- Show occurrence count, representative paths, current tag result, canonical
  candidates, ColdLion/DesignFlow evidence, and ambiguity flags.
- Assign every distinct observed value one controlled disposition.
- Add a durable, auditable resolution mechanism instead of growing a hard-coded
  worker array.
- Build an administrator reconciliation surface under PopSG Settings.
- Apply approved mappings deterministically and rebuild affected files.
- Report both mapping coverage and intentionally-untagged coverage.

### Out of scope

- Changing the meaning of Property, Licensor, Character, or Style Guide.
- Completing or bypassing ColdLion cutover Phases 6–8.
- Creating canonical rows without a separately approved re-entry into the
  ColdLion Phase 5 gate.
- Fuzzy automatic linking.
- Reorganizing NAS folders.
- Moving `public.style_guide_files` to `dam.style_guide_file`.
- Character/style-guide catalogue migration.
- AI or vision-based Property assignment.
- Reclassifying PopDAM `assets`; this workstream is for PopSG
  `style_guide_files`.
- Reconciling unresolved Licensor observations. They are measured and routed,
  but Property mapping cannot proceed until the parent Licensor is resolved.
- Historical inactive files. The measured execution population is the 216,417
  active files, not all 279,783 rows; if a file is later reactivated, it must
  inherit the existing tuple decision deterministically or enter the review
  queue without requiring a new mass review.

## 5. Controlled disposition vocabulary

Every active observation must first enter either `licensor_unresolved` or a
distinct tuple `(canonical_licensor_id, normalized_observed_value)`. Every
resolved-Licensor tuple must end in exactly one of these states:

| Disposition | Meaning | Produces a Property tag? | Approval |
|---|---|---:|---|
| `licensor_unresolved` | Parent Licensor did not resolve, so Property reconciliation is unsafe and out of scope | No | Routed to a separate Licensor queue |
| `exact_existing` | Current normalized name/code already resolves to the correct canonical Property | Yes | Automatic, contract-tested |
| `alias_existing` | A true spelling, abbreviation, punctuation, or historical-name variant maps to an existing Property under the same Licensor | Yes | Human approval |
| `classics_cp` | A confirmed Disney Classic maps to the existing `CP` Property | Yes | Human approval against the standing rule |
| `non_property` | Folder text is structural, a collection/style-guide name, workflow stage, customer/program, junk, or canary | No | Human approval |
| `licensed_no_code` | Real licensed title, but no approved ColdLion Property code exists | No | Human approval; revisit only when a code exists |
| `canonical_create_candidate` | Evidence suggests a legitimate new coded Property | No until separate create approval | Albert + ColdLion Phase 5 re-entry |
| `ambiguous` | More than one defensible canonical candidate or conflicting parent evidence | No | Must remain open |
| `deferred` | Insufficient evidence; deliberately postponed | No | Human decision |

`canonical_create_candidate`, `ambiguous`, `deferred`, and
`licensor_unresolved` are not completion shortcuts. They remain visible work.
A batch reaches 100% **classification coverage** when every observation has one
state. **Terminal settlement rate** is a separate reported measure and has no
artificial 100% target.

## 6. Proposed durable data model

The implementation phase must create new timestamped migrations in canonical
`/worksp/shared-db`; this plan itself creates none.

### 6.1 Shared alias truth

Add a shared canonical alias table, provisionally
`core.property_alias`, only for aliases certified as true across applications:

- `id`
- `property_id` → `core.property(id)`
- `licensor_id` → `core.licensor(id)`
- `alias`
- `normalized_alias`
- provenance/source
- notes/evidence
- approval identity and timestamp
- created/updated timestamps

Required constraints:

- uniqueness is scoped to `(licensor_id, normalized_alias)`;
- `normalized_alias` is a generated value produced by the one canonical
  normalizer defined in §6.4, not separately entered text;
- the alias row's `licensor_id` must equal the linked Property's
  `core.property.licensor_id`;
- blank aliases are forbidden;
- an alias identical to the canonical name/code is rejected as redundant;
- a PopSG folder artifact cannot be inserted into shared alias truth;
- normal browser roles receive no direct write grant; RLS and SQL grants must
  independently enforce read-only access;
- pending proposals and approved writes use separately named guarded RPCs, with
  explicit `REVOKE`/`GRANT` statements and contract tests for every caller role.
  Provisional names are `public.propose_popsg_property_resolution(...)` for
  pending app-owned proposals and
  `public.activate_popsg_property_decision_batch(...)` for exact-hash owner
  activation. Any shared-alias promotion uses a separately named
  `public.promote_property_alias_batch(...)`; do not overload one RPC across
  these authority levels.

If implementation evidence proves an existing canonical alias table now covers
this contract, reuse it rather than create a duplicate.

**Routing rule:** every proposed alias defaults to the app-owned table in §6.2.
Promotion into `core.property_alias` requires an explicit cross-app
certification in Albert's hash-approved batch stating that the value is a true
business alias—not a PopSG path/folder convention—and a contract test proving
the same alias is valid outside PopSG. PopSG administrators may propose a shared
alias but cannot certify or activate it.

### 6.2 PopSG-specific resolution decisions

Add an app-owned decision table, provisionally
`dam.popsg_property_resolution`, for observations that are meaningful only to
PopSG paths:

- resolved canonical Licensor ID;
- raw and normalized observed value;
- disposition from §5;
- optional canonical Property ID;
- occurrence count and evidence snapshot metadata;
- review notes;
- reviewed/approved identity and timestamps;
- active/superseded status.

Use this table for `non_property`, `licensed_no_code`, ambiguous/deferred review,
and every PopSG-only mapping decision, including provisional aliases that lack
cross-app certification. Do not pollute `core.property_alias` with folder
structure.

Because `dam` is intentionally not exposed through PostgREST, access must use
the established public `SECURITY DEFINER` RPC / admin API pattern. Do not add
`dam` to `pgrst.db_schemas`.

### 6.3 Approval, audit, and immutability

Administrator UI actions create **pending proposals only**. They never become
effective merely because the caller holds an administrator role. Albert is the
business approval authority: a frozen decision batch becomes effective only
through a guarded activation RPC that verifies the exact owner-approved hash,
the unchanged proposal rows, and the caller's authorization. Any edit after
approval invalidates the hash and returns the proposal to pending.

Every decision change must retain:

- old and new disposition;
- old and new target Property;
- reviewer;
- reason;
- timestamp;
- evidence snapshot/run ID.

Implement append-only decision revisions plus a current-row pointer. Never
overwrite or delete decision history silently.

### 6.4 One normalization contract

Define one versioned Property-observation normalization contract and use it
byte-for-byte in:

- the read-only extractor and proposal engine;
- generated database normalization columns and uniqueness checks;
- the PopDAM worker resolver; and
- preview/production verification queries.

The contract must deliberately specify Unicode NFKC, case folding, whitespace,
ampersands, apostrophes, hyphens, and punctuation behavior. Use
`core.customer_alias` as the table-shape precedent, but do not copy its simpler
normalizer if it differs from `normalizePopSGTag`. A shared fixture corpus must
prove SQL-side and TypeScript-side parity and prove that two database-distinct
strings cannot collapse nondeterministically in the worker.

## 7. Workstream and phase gates

Each PSG phase is a fresh-session handoff boundary. Before leaving a phase, the
implementing session must update the dated evidence README and `HANDOFF.md` with
the exact artifact hashes, failures, decisions, current ColdLion status,
forward impact on every later PSG phase, and the next entry command/gate. A
later phase must re-read those artifacts rather than rely on chat context.

### PSG-0 — authority freeze, safety preflight, and rollback baseline

1. Read this plan, `AGENTS.md`,
   `fix_coldlion_licensor_property_cutover.md`, and
   `docs/style-guides-characters-and-royalties.md`.
2. Confirm the current ColdLion phase. No canonical creates or source cutover
   may proceed while its gates forbid them.
3. Check `gh pr list`, branches, migrations, and `git status` in shared-db.
4. Confirm PopDAM and shared-db checkouts have no overlapping in-flight work.
5. Record production counts and hashes without writing data.
6. Record all eight hard-coded `LICENSOR_ALIASES`, their occurrence counts,
   affected Property observations, current resolved parent, and accepted
   Property-tag blast radius. Record the current empty `PROPERTY_ALIASES`
   separately.
7. Export and hash the production baseline for every accepted/manual/rejected
   Property row in `public.style_guide_file_tags`, including immutable sets of
   manual and rejected relationship IDs. Name the files and reproduction
   commands in the evidence README. This snapshot must be re-taken immediately
   before the production rebuild.
8. Define the versioned normalization contract and shared SQL/TypeScript fixture
   corpus from §6.4 before inventory code is written.

**Deliverable:** dated PSG-0 README under
`docs/verification/popsg-property-reconciliation-YYYYMMDD/`.

**Gate:** authority documents, database refs, current canonical counts, rebuild
run ID, tag snapshots/hashes, hard-coded Licensor aliases, normalization
fixtures, and production state are recorded; zero database writes occurred.

### PSG-1 — complete read-only observation and at-risk inventory

Create a reproducible extractor that produces:

- a 2×2 population matrix:
  `(Licensor resolved/unresolved) × (Property resolved/unresolved)`;
- one `licensor_unresolved` row per normalized observation whose parent failed;
- one row per `(resolved_licensor_id, normalized_observed_value)` otherwise;
- raw variants and total active-file count;
- representative paths and filenames, bounded to avoid sensitive bulk exports;
- current canonical exact-name/code result;
- existing alias result;
- candidate Properties under the same Licensor;
- ColdLion code/source evidence;
- DesignFlow comparison evidence while that lane remains active;
- whether the value appears to be a collection/style-guide/workflow folder;
- whether a current accepted Property tag exists;
- whether the current global matcher would resolve but the proposed
  Licensor-scoped matcher would not;
- whether the Licensor came from one of the eight hard-coded aliases, with the
  alias and affected-file count;
- cross-parent or ambiguity flags.

Required artifacts:

- `inventory.csv`
- `summary.json`
- `top-unresolved.csv`
- `candidate-evidence.csv`
- `currently-tagged-at-risk.csv`
- `licensor-alias-blast-radius.csv`
- `licensor-property-resolution-matrix.json`
- `source-hashes.json`
- `README.md` explaining every field and reproduction command.

Never commit full file paths if they contain sensitive customer/project detail;
store bounded/redacted examples and aggregate counts.

**Gate:** inventory file counts reconcile exactly to a newly measured
production baseline (any delta from 2026-07-26 is explained), every active file
occurrence is represented exactly once, unresolved Licensors are excluded from
Property proposals, and every currently accepted tag that would be removed by
parent scoping appears in `currently-tagged-at-risk.csv`.

### PSG-2 — deterministic proposal engine

Generate proposals in this strict order:

1. exact normalized canonical name under resolved Licensor;
2. exact canonical code under resolved Licensor;
3. already-approved alias under resolved Licensor;
4. owner-approved Disney Classics list → `CP` candidates;
5. structural/non-Property pattern candidates;
6. no-code candidates backed by the documented rule;
7. separately listed create candidates with ColdLion code and explicit parent
   evidence;
8. ambiguous/deferred.

The proposal engine may calculate fuzzy similarity only as a reviewer hint.
Fuzzy score must never select a target or change a disposition.

**Deliverable:** a frozen, hashe…3250 tokens truncated… ownership, and sequencing

- PSG-0 through PSG-4 are parallel-safe with ColdLion only because they are
  evidence, proposal, UI, and approval preparation with no schema activation or
  rebuild effect.
- PSG-5 preview migration/rebuild requires a checkpoint recorded in
  `fix_coldlion_licensor_property_phase6_handoff.md` plus Albert's explicit
  sign-off that ColdLion §9.4 comparison/health evidence will not be perturbed.
  Re-read that handoff's moving status header immediately before the checkpoint.
- PSG-6 production application/rebuild must not overlap ColdLion Phase 7's
  production source-cutover window. One schema change is in flight at a time.
- Do not create or activate canonical Properties while the ColdLion plan forbids
  Phase 5 re-entry.
- Character and shared style-guide catalogue migration is separate. Do not make
  this plan depend on moving the 279k file inventory into another schema.
- PopDAM’s working checkout may contain concurrent edits. Use an isolated
  worktree for implementation if the main checkout is dirty; never stash or
  reset another session’s work.

| Work | Implementation owner | Approval / release owner |
|---|---|---|
| PSG-0/1 evidence extractor and snapshots | PopDAM engineer/session, read-only | Albert accepts evidence scope |
| PSG-2 proposals | PopDAM engineer/session | Albert accepts vocabulary/batch |
| PSG-3 UI and app API | PopDAM repo | Albert remains activation authority |
| Shared schema, grants, RLS, RPCs | Canonical shared-db branch/PR | AI merges after preview; Albert approves production batch |
| Worker resolution and rebuild logic | PopDAM worker | Albert approves signed behavior delta |
| PSG-5 preview apply/rebuild | Shared-db + PopDAM owners | Albert signs ColdLion checkpoint |
| PSG-6 production schema/app/rebuild | Shared-db + PopDAM owners | Albert names exact production window/batch |
| PSG-7 acceptance | Implementing session | Albert accepts business evidence |

## 12. Exact next actions

1. Obtain Albert's confirmation of the §14 plan-entry checklist; this accepts
   the plan and evidence work only, not any proposal batch, migration, or
   production change.
   **Pass when:** the acceptance is recorded verbatim with date.
2. Create the PSG-0 evidence directory and record current repo/PR/migration
   state, newly measured production metrics, tag snapshots, hard-coded Licensor
   aliases, and normalization fixtures.
   **Pass when:** the README names both Supabase refs, current ColdLion phase,
   canonical counts, hashes, and zero-database-write evidence.
3. Implement the read-only PSG-1 inventory extractor with tests.
   **Pass when:** aggregate occurrence counts reconcile to the dated production
   telemetry, the 2×2 matrix balances, at-risk tags are enumerated, and every
   active observation appears once.
4. Generate the frozen PSG-2 proposal set and review summary.
   **Pass when:** every row has exactly one proposed disposition, create
   candidates are diffed against ColdLion's set, the hash is reproducible, and
   cross-parent proposals equal zero.
5. Present the proposal summary to Albert before designing migration DDL around
   assumptions.
   **Pass when:** Albert approves the disposition vocabulary and the first
   bounded decision batch.
6. Only then build pending-proposal UI under PSG-3. Do not author/activate schema
   or mapping writes until the approval, normalization, ColdLion coordination,
   and PSG-5 entry gates are satisfied.

## 13. Open decisions and risks

1. **Alias storage name/shape:** `core.property_alias` is recommended, but
   implementation must first prove no existing canonical alias contract now
   serves the need.
2. **Decision-table schema:** `dam.popsg_property_resolution` is recommended;
   exact RPC/API shape remains implementation work.
3. **First review-batch size:** decide after PSG-1 distribution is known.
   Prefer the smallest batch that covers most file occurrences without mixing
   ambiguous cases.
4. **No-code lifecycle:** the trigger for revisiting a `licensed_no_code`
   decision must be a new approved ColdLion code or explicit owner ruling, not
   elapsed time.
5. **Canonical create candidates:** prior ruling is zero creates. Any re-entry
   is a separate production-sensitive decision.
6. **Folder drift:** new paths will introduce new observations after closeout.
   The reconciliation UI and metrics must support an ongoing small review queue,
   not assume the catalogue is permanently finished.
7. **Existing Licensor aliases:** Albert must decide whether each of the eight
   hard-coded mappings migrates to a durable approved contract or remains code
   with explicit sign-off. The three-to-one Viacom mapping needs particular
   scrutiny.
8. **Licensor-unresolved ownership:** PSG reports and routes these rows, but a
   separate bounded Licensor reconciliation must resolve the parent before
   Property mapping can proceed.
9. **DesignFlow evidence expiry:** keep collecting it while ColdLion Phase 6/7
   requires comparison. Retire the requirement only when ColdLion Phase 8's
   explicit DesignFlow deprecation gate is complete.

---

## 14. Plan acceptance checklist

This plan is ready to enter PSG-0 only when Albert confirms:

- this is the single PopSG Property reconciliation execution plan;
- the upstream ColdLion and style-guide architecture documents remain
  authoritative references rather than duplicated plans;
- the disposition vocabulary is acceptable;
- no canonical Property creation is implied;
- implementation begins with read-only inventory and proposals, not schema or
  production writes.

---

## 15. PSG-0 completion record — 2026-07-26

**Status:** COMPLETE. Stop at the fresh-session boundary before PSG-1.

Albert approved the §14 checklist on 2026-07-26. The dated evidence package is:

[`docs/verification/popsg-property-reconciliation-20260726/`](docs/verification/popsg-property-reconciliation-20260726/README.md)

New read-only production measurements exactly reproduce the plan baseline:

- 216,417 active files;
- 216,201 active files with a raw Property value;
- 165,274 raw Property values unresolved by the current global exact-name behavior;
- 76.4446% unresolved;
- 26 canonical Licensors and 256 canonical Properties;
- completed deterministic run `37lo38wrj6d`;
- zero deterministic failures.

The package freezes 111,011 accepted Property relationships and the complete manual/rejected
relationship-ID sets. Both immutable sets are currently empty. All eight hard-coded Licensor
aliases are measured with their resolved parent, occurrence distribution, affected raw Property
values, and accepted-tag blast radius. `PROPERTY_ALIASES=[]` is frozen separately.

Normalization contract `popsg-property-observation-v1` and its fixture corpus are frozen as
PSG-0 specification evidence. They do not authorize SQL or application implementation.

The live ColdLion checkpoint still reads Phase 6 **IN PROGRESS** on preview. The latest non-drill
observation passed all comparison gates; later failures in the evidence are marked forced-failure
drills. Production has zero ColdLion Licensor/Property mirror rows and no Phase 6 comparison
object. PSG-0 did not alter any schedule, observation, alert, migration, database row, or PopDAM
file.

PSG-1 entry instructions are in the dated README. PSG-1 must remain read-only, must enumerate the
complete parent-scoped accepted-tag delta, must exclude unresolved Licensors from Property
proposals, and must stop before PSG-2.

---

## 16. PSG-1 completion record — 2026-07-27

**Status:** COMPLETE. Stop before PSG-2.

The reproducible read-only extractor and dated evidence package are:

- [`scripts/popsg-property-psg1-inventory.cjs`](scripts/popsg-property-psg1-inventory.cjs)
- [`scripts/popsg-property-psg1-inventory.test.cjs`](scripts/popsg-property-psg1-inventory.test.cjs)
- [`docs/verification/popsg-property-reconciliation-20260727-psg1/`](docs/verification/popsg-property-reconciliation-20260727-psg1/README.md)

The production and preview reads ran in PostgreSQL-enforced `REPEATABLE READ READ ONLY`
transactions and ended with `ROLLBACK`. PSG-1 made no database write, migration, canonical
creation, rebuild, deployment, proposal, fuzzy automatic mapping, or PopDAM UI/code change.

The dated production population remains 216,417 active files. Every file occurrence appears
exactly once in the required current-behavior matrix:

| Licensor | Current global Property | Active files |
|---|---|---:|
| Resolved | Resolved | 50,927 |
| Resolved | Unresolved | 165,489 |
| Unresolved | Resolved | 0 |
| Unresolved | Unresolved | 1 |

The inventory contains 372 normalized observation rows: 371 with a resolved canonical Licensor
and one `licensor_unresolved` row. The unresolved Licensor row has no candidate Property and is
marked ineligible for proposals. Parent-scoped exact canonical name/code matching resolves
44,331 file occurrences across 51 inventory rows.

The signed `currently-tagged-at-risk.csv` enumerates 6,961 accepted current global exact-name
relationships that parent scoping would remove. Every one is a cross-parent global match. Its
SHA-256 is `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.
This is evidence only. No removal is approved.

All eight hard-coded Licensor aliases remain load-bearing inputs. Their occurrence and accepted
relationship counts reproduce PSG-0. None of the 6,961 at-risk relationships comes from an
alias-resolved Licensor observation.

The moving ColdLion checkpoint remains Phase 6 **IN PROGRESS** on preview. Counts remain 26/256
canonical and 44/516 mirror. The latest non-drill observation
`16373e68-6f72-43ad-8219-7c999799675d` passes every gate with zero unexplained differences.
The later failed observation is still the marked forced-failure drill. Production remains
untouched by ColdLion Phase 6.

PSG-2 is not authorized by this completion record. A fresh PSG-2 session must start from the
dated PSG-1 README, verify its hashes, recheck the moving ColdLion status, and treat the 6,961-row
signed delta as an immutable input.

---

## 17. PSG-2 proposal record — 2026-07-27

**Status:** DRAFT INCOMPLETE. Second Grok review PASS with no Critical, High, or Medium findings.
Stopped at Albert's exact-hash owner gate. Stop before PSG-3.

The reproducible proposal engine, tests, and frozen evidence package are:

- [`scripts/popsg-property-psg2-proposals.cjs`](scripts/popsg-property-psg2-proposals.cjs)
- [`scripts/popsg-property-psg2-proposals.test.cjs`](scripts/popsg-property-psg2-proposals.test.cjs)
- [`docs/verification/popsg-property-reconciliation-20260727-psg2/`](docs/verification/popsg-property-reconciliation-20260727-psg2/README.md)

All eight PSG-1 artifact Git blobs match `source-hashes.json`. Windows CRLF checkout conversion
explains why direct working-tree hashes differ; the generator canonicalizes CRLF to LF before
verifying immutable inputs. The 6,961-row at-risk input remains byte-identical to the signed Git
blob and has SHA-256
`f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6`.

The complete 372-row proposal ledger covers all 216,417 active file occurrences exactly once:

| Proposed disposition | Distinct rows | Active files |
|---|---:|---:|
| `exact_existing` | 51 | 44,331 |
| `non_property` | 36 | 20,309 |
| `canonical_create_candidate` | 2 | 293 |
| `ambiguous` | 43 | 33,416 |
| `deferred` | 239 | 118,067 |
| `licensor_unresolved` | 1 | 1 |
| `alias_existing` | 0 | 0 |
| `classics_cp` | 0 | 0 |
| `licensed_no_code` | 0 | 0 |

There are zero cross-parent proposals, zero fuzzy-selected targets, zero unresolved-Licensor
Property proposals, and zero effective/activated decisions. Every proposal now has
`owner_activation_required=true`; `classification_automatic` is a separate evidence field, not
activation authority. Fifty rows matched a canonical name under the resolved Licensor; one
matched a canonical code. Every target is independently checked against the authoritative
Property→Licensor edge, receives its canonical code and parent ID, and fails closed if the edge,
parent, name, or code proof is missing. Fifteen blank observations and 21 PSG-1
structural-pattern rows are human-review `non_property` candidates.

Two exact PopSG observations overlap the existing ColdLion Phase 5 candidate ledger:
`CHEERS` / `CHR` and `THE EXORCIST` / `EX`. They are routed to the existing Phase 5 re-entry
mechanism. No second candidate ledger or canonical row was created. The resolved PopSG Licensor is
evidence only; ColdLion supplies no parent and Phase 5 still has zero approved creates.
Phase 5 matching is exact normalized **name only**. Bare codes are metadata and cannot nominate a
create candidate.

No inventory observation exactly matched the owner-list text for Disney Classics or documented
no-code titles. In particular, `the lion king` affects 521 files but does not byte-normalize to the
approved-list text `lion king`; it remains open rather than receiving an inferred `CP` mapping.
It also has multiple same-parent PSG-1 reviewer candidates, so its exact disposition is
`ambiguous`, not merely a Classics exact-text miss.

The complete proposal ledger SHA-256 is
`cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4`.
The bounded owner-batch index SHA-256 is
`78afa12f5edf4ac56f00d8fad592b6c6c2bcb128730ed5c837ad29270931976d`.
The recommended first bounded decision is `batch-01-exact-existing`, 51 rows / 44,331 files,
SHA-256 `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
Approval of that hash does not approve non-Property rows, canonical creates, any of the 6,961
at-risk removals, schema, rebuild, or production.
The owner index has a dedicated non-approvable `batch-06-at-risk-observation` row pointing to the
signed PSG-1 file and SHA-256. It cannot be treated as a removal batch.

Current-state preflight found one unrelated docs-only PR (#238), no duplicate migration versions,
shared-db clean/current at the phase start, and PopDAM clean before its shared-db mirror
fast-forward. ColdLion Phase 6 remains **IN PROGRESS** on preview. Accelerated readiness Steps
1–10 remain open and Phase 7 remains forbidden.

Forward-impact audit after rereading PSG-3 through PSG-7:

- PSG-3 must show the frozen queues separately and route the two create candidates to ColdLion
  Phase 5; it must show `the lion king` as ambiguous and separate automatic classification from
  owner activation.
- PSG-4 must bind any approval to an exact unchanged batch hash.
- PSG-5 has no approved at-risk removal subset yet, must treat `batch-06` as non-approvable, and
  still must resolve all eight hard-coded Licensor aliases.
- PSG-1 recorded the PopDAM worker with raw CRLF bytes. The current canonical LF hash differs only
  by line-ending encoding and reconstructs the frozen raw hash exactly. PSG-5 must rebaseline if
  the worker behavior hash changes.
- PSG-6 remains blocked by the moving ColdLion checkpoint, owner sign-off, and a named production
  window.
- PSG-7 must report the zero alias/Classics/no-code proposal categories honestly.
- No later phase's schema, sequencing, rollback, or production safety rule otherwise changed.

PSG-2 made no database query or write, migration, canonical creation, rebuild, deployment,
proposal activation, fuzzy automatic mapping, or PopDAM UI/code change.

**Review result:** second Grok review passed. Residual non-blocking notes are intentional gates:
every row still requires owner activation, PSG-2 remains incomplete until Albert names an exact
batch hash, and PSG-3 remains forbidden.

**Owner gate:** Albert must approve or reject an exact batch ID and SHA-256. Do not start PSG-3
or infer approval from the review pass.

---

## 18. PSG-3 implementation record — 2026-07-27

**Status:** pending-only UI shell deployed and healthy. Stop before PSG-4.

Albert explicitly approved only `batch-01-exact-existing`, 51 rows / 44,331 files, SHA-256
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.
The durable bounded record is
[`docs/verification/popsg-property-reconciliation-20260727-psg3/approval.json`](docs/verification/popsg-property-reconciliation-20260727-psg3/approval.json).
It does not approve batch 02, canonical creates, 6,961 at-risk removals, schema, migrations,
database writes, activation, rebuilds, deployment, production, or PSG-4.

PSG-3 resolves the UI-versus-schema boundary with a safe non-writing fixture/data adapter. The
real PopSG Settings → File Tags → Property reconciliation component reads all 372 frozen PSG-2
rows, displays five business queues and required evidence/filters, and lets an administrator
prepare only valid same-parent rows from the exact approved batch. Pending rows live in browser
memory only and export as stable JSON with a hash. Viewer/designer preparation is denied. No
activation action or backend adapter exists.

This phase authored no SQL, migration, RLS, RPC, database API, database write, rebuild, canonical
create, or tag removal. PSG-5 still owns any future schema-backed contract and its real RLS/RPC
proof after separate authority exists.

Unit, fixture, role, component, and no-write contract tests pass (19). The full PopDAM suite passes
(93 tests across 22 files). The production build passes.
Seven real-browser screenshots prove the administrator flow, cross-Licensor lock, designer lock,
open Lion King row, locked ColdLion candidates, owner hash, exclusions, and export surface. Full
evidence and source hashes are in
[`docs/verification/popsg-property-reconciliation-20260727-psg3/`](docs/verification/popsg-property-reconciliation-20260727-psg3/README.md).

The first Grok review required corrections for phase status, ambiguity handling, mixed-Licensor
export, signed-key enforcement, security tests, hidden rows, and related medium findings. The
second review then found a stale prepare-dialog screenshot and three low-risk hardening gaps.
The screenshot now starts from an empty set on Winnie the Pooh / 6,887 files. Both preparation
and export enforce membership in the signed 51-key set, parent-proof text renders only for an
equal Licensor parent, and starting a pending set immediately locks rows from other Licensors.
All corrections are implemented and locally verified. The final Grok follow-up returned PASS with
no Critical, High, or Medium findings.

Albert then approved commit/push/deployment of the pending-only UI. PopDAM `main` contains
`e72ec107` (UI), `8d8ce361` (direct test dependency), and `b4bf454b` (Bun lock regeneration).
CI run `30263977784` and publish/deploy run `30264180552` passed. The healthy Coolify container
ran the exact published digest
`sha256:a850c64f3a5ead1c26f5a20b405e1bb22697507516e333c10b628b26721a6684`;
both DAM and PopSG returned HTTP 200.

The first CI attempt failed because Bun did not install `@testing-library/dom` indirectly. Adding
the direct dependency fixed ownership. A partial hand edit of `bun.lock` then failed because it
lacked Bun's package record; regenerating with CI's Bun 1.3.14 fixed the frozen lock.

**PSG-4 boundary clarification:** ColdLion Phase 6 does not block PSG-4 decision-package work.
PSG-4 remains non-writing: no mapping activation, database write, migration, rebuild, canonical
create, or deployment. The RLS/RPC/persistence/preview proof named by the full PSG-3 gate is owned
by PSG-5 and remains a separately authorized PSG-5 obligation. Starting PSG-4 still requires
Albert's explicit current-chat instruction.

The moving ColdLion accelerated plan still has Steps 1–10 open and production Phase 7 forbidden.
Stop before PSG-4 until Albert explicitly starts it.

