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

**Deliverable:** a frozen, hashed proposal set plus tests proving deterministic
ordering, parent scoping, and no cross-Licensor matches.

Diff every `canonical_create_candidate` against the ColdLion Phase 5 candidate
set in
`docs/verification/coldlion-licensor-property-phase3-20260725/`. Route overlaps
back through the existing ColdLion Phase 5 re-entry mechanism rather than
creating a second candidate ledger.

**Gate:** zero automatically proposed cross-parent mappings; every inventory row
has exactly one proposed disposition; no database writes.

### PSG-3 — administrator reconciliation UI and pending proposals

Build **PopSG Settings → File Tags → Property reconciliation** with:

- summary cards for file occurrences and distinct observed values;
- queues for “needs review,” “intentionally untagged,” “mapped,” and
  “create approval required”;
- filters by Licensor, disposition, occurrence count, and ambiguity;
- representative path evidence;
- canonical candidate name/code/status/parent;
- actions:
  - map as alias to an existing Property;
  - apply Classics → `CP`;
  - mark non-Property;
  - mark licensed/no-code;
  - defer;
  - nominate as canonical-create candidate;
- mandatory notes for non-obvious/manual decisions;
- preview of affected file count before approval;
- no bulk approval across mixed Licensors or mixed dispositions;
- export of the frozen decision set and hash.

Every action above creates or updates a **pending** proposal. The UI must not
offer an administrator-only “approve” action that activates master-data
mappings. It may show the owner-approved hash and activation state, but only
the guarded owner-approval workflow in PSG-4 can make a decision effective.

The UI must loudly distinguish:

- **unreviewed** — human work remains;
- **intentionally untagged** — reviewed and correct;
- **mapped** — will produce a canonical tag;
- **create candidate** — blocked on separate master-data approval.

**Gate:** role/RLS/RPC tests pass; viewer/designer cannot propose or activate;
administrator can create only valid same-parent pending proposals and cannot
activate them; only the owner-hash activation path can make them effective;
real browser screenshots prove the complete workflow on preview.

### PSG-4 — owner decision batch and activation authority

Review proposals in descending file-impact order, but approve at the **distinct
value** level.

Albert receives one business-readable decision package:

- mappings to existing Properties;
- Disney Classics → `CP`;
- intentional non-Properties;
- licensed/no-code titles;
- canonical-create candidates;
- ambiguous/deferred remainder;
- files affected by each decision;
- immutable proposal hash.

Approval is explicit and bounded to that hash. Editing any proposal after
approval invalidates the hash and requires reapproval.

**Gate:** every approved row has disposition, reason, parent evidence, reviewer,
and timestamp. Canonical creates remain zero unless separately named and
approved.

### PSG-5 — preview implementation and rebuild

1. Create shared-db migration(s) for the approved alias/decision contracts.
2. Run `scripts/check-sql.sh`.
3. Apply to preview first.
4. Update the PopDAM worker to load:
   - canonical Property name/code;
   - approved `core.property_alias` rows;
   - PopSG-specific terminal decisions;
   - all scoped by resolved canonical Licensor.
5. Remove reliance on the hard-coded empty `PROPERTY_ALIASES` array.
6. Resolve the future of all eight hard-coded `LICENSOR_ALIASES`: migrate them
   into an approved contract or retain each one only with recorded owner
   sign-off and tests. Do not leave their authority implicit.
7. Preserve manual/rejected tags.
8. Run unit/contract/RLS/RPC tests.
9. Run a full deterministic rebuild on preview.

Required preview assertions:

- zero failed files;
- zero cross-parent Property tags;
- exact/alias/CP decisions produce the approved Property IDs;
- non-Property and licensed/no-code decisions produce no Property tag;
- ambiguous/deferred/create-candidate values produce no Property tag;
- manual and rejected tags are unchanged;
- every accepted tag removed by Licensor scoping equals an approved row in the
  signed `currently-tagged-at-risk.csv` delta; unexplained loss is zero;
- actual accepted-tag delta equals the owner-approved expected signed delta;
- rerun is idempotent;
- “actionable unresolved” counts equal only ambiguous, deferred, and
  create-candidate rows.

**Gate:** application behavior is visually verified on preview and Albert
confirms the decision summary matches the approved batch.

**End-of-phase drift check:** before closing PSG-5, re-read PSG-6 and PSG-7 through the end of
this plan. Record anything PSG-5 changed or discovered that affects their assumptions,
sequencing, identifiers, safety gates, verification, rollback, or owner approvals. Update this
plan and the fresh-session handoff before stopping if any downstream instruction has drifted.

### PSG-6 — shared-db PR, production schema, app rollout, and rebuild

Order is mandatory:

1. Shared-db branch → PR → checks → preview proof → AI merge.
2. Let the shared-db mirror sync to consumer repos.
3. Re-read the moving status header in
   `fix_coldlion_licensor_property_phase6_handoff.md`. Record the required
   ColdLion checkpoint and Albert's sign-off that PSG-6 cannot perturb §9.4.
4. Obtain a fresh owner-approved production window naming the exact shared-db
   migrations.
5. Use a physically bounded production migration runner if unrelated migrations
   remain pending. Never use unrestricted `--include-all`.
6. Apply the database contracts to production **before** deploying application
   code that requires them. Verify actual tables, generated normalization,
   functions, SQL grants, and policies—not just the migration ledger.
7. Commit/deploy the tested PopDAM worker/UI changes to PopDAM `main`, then
   verify Railway and frontend SHAs for their respective code paths. If a
   backwards-compatible feature flag/fallback is deliberately chosen instead,
   its schema-absence test must pass and the flag must remain off until step 6
   is verified.
8. Re-take and hash the accepted/manual/rejected production tag snapshot from
   PSG-0. Abort if the immutable manual/rejected baseline cannot be reproduced.
9. Run a production no-write comparison of current global behavior versus the
   approved Licensor-scoped behavior. Abort unless its signed accepted-tag delta
   exactly equals the owner-approved expectation from PSG-4.
10. Launch “Rebuild all deterministic tags.”

**Gate:** ColdLion checkpoint/sign-off is recorded; production dry run lists
only approved migrations; production schema exists before dependent app
deployment; tag baselines and approved signed delta match; deployed app SHA is
verified; the rebuild is durably running before the browser session ends.

### PSG-7 — production acceptance and closeout

Verify after the rebuild:

- operation status `completed`;
- zero failures;
- accepted Property tags have a canonical Property and correct parent Licensor;
- no cross-parent relationships;
- every approved high-impact mapping has representative live examples;
- Disney Classics resolve to `CP`;
- structural/non-Property values remain without a Property tag;
- licensed/no-code examples remain without a Property tag;
- actionable unresolved distinct values match the approved remainder exactly;
- intentionally-untagged counts are reported separately;
- old and new coverage metrics are recorded;
- no manual/rejected relationship changed;
- accepted-tag additions and removals equal the approved signed delta exactly,
  with zero unexplained loss;
- the pre-rebuild and post-rebuild snapshots and hashes are preserved.

Update the relevant PopDAM and shared-db docs, write a comprehensive handoff if
anything remains, and preserve the dated evidence directory.

**Completion definition:** classification coverage is 100%; terminal settlement
rate and open categories are reported honestly; every approved mapping is live;
all remaining untagged values are intentionally untagged,
`licensor_unresolved`, or explicitly open; and no invalid or unexplained-lost
Property tag was introduced.

## 8. Metrics that must not be conflated

The UI and evidence must report all of these separately:

| Metric | Meaning |
|---|---|
| File-occurrence mapping coverage | Files whose observed Property produced a canonical tag |
| Classification coverage | Unique normalized observations assigned exactly one disposition, including open/out-of-scope states |
| Terminal settlement rate | Classified observations in an effective mapped or intentionally-untagged terminal state; report only, no 100% target |
| Actionable unresolved | Ambiguous, deferred, or create-candidate observations still requiring action |
| Parent unresolved | Observations blocked because the Licensor did not resolve |
| Intentionally untagged | Reviewed non-Property or licensed/no-code observations |
| Property precision audit | Sampled/contract-proven tags that point to the correct canonical Property |
| Licensor precision audit | Sampled Licensor resolutions, including every hard-coded/unreviewed-alias source |
| Structural cross-parent violations | Constraint-enforced; must be zero, but does not prove the Licensor itself was factually resolved correctly |
| Accepted-tag signed delta | Added and removed accepted Property tags versus the pre-rebuild snapshot, partitioned into approved and unexplained |
| Processing failures | Technical failures, separate from taxonomy decisions |

The targets are **100% classification coverage, zero structural cross-parent
violations, zero unexplained accepted-tag loss, and zero unexplained actionable
unresolved values**. Terminal settlement rate and file-occurrence tag coverage
are reported without a forced 100% target.

## 9. Test matrix

At minimum, include:

1. Canonical name match under the correct Licensor.
2. Canonical code match under the correct Licensor.
3. Same text under a different Licensor does not match.
4. Approved alias matches only its scoped Licensor.
5. Disney Classic maps to `CP`.
6. No-code title stays untagged.
7. Collection/style-guide/workflow folder stays untagged.
8. Ambiguous candidate stays untagged and visible.
9. Cross-entity code collision never matches.
10. Inactive/lapsed canonical status is displayed and does not silently activate.
11. Manual tag survives rebuild.
12. Rejected automatic tag survives rebuild.
13. Rebuild rerun is idempotent.
14. Viewer/designer approval is denied.
15. Administrator action is audited.
16. Changed path/fingerprint requeues only the affected file.
17. Full rebuild produces zero processing failures.
18. Current global exact match that is invalid under Licensor scoping is removed
    only when present in the approved signed delta.
19. Worker fails closed—or a deliberately implemented compatibility fallback
    is proven—when the alias table/RPC is absent.
20. SQL and TypeScript normalizers return byte-identical keys for every shared
    fixture, including NFKC, ampersand, apostrophe, hyphen, punctuation, and
    multi-space cases.
21. Alias RPC rejects blank/redundant aliases and
    `alias.licensor_id != property.licensor_id`.
22. Shared-alias promotion rejects PopSG-only folder artifacts without explicit
    cross-app certification and owner-approved hash.
23. An approved alias fails closed if its target Property is inactivated or
    reparented; it never silently retargets.
24. Wrong Licensor resolution remains visible even when the selected Property
    structurally shares that parent.
25. Administrator may create pending proposals but cannot activate them.
26. Only the exact unchanged owner-approved hash activates decisions.
27. Concurrent deterministic rebuild acquisition is rejected.
28. An interrupted rebuild resumes from the preserved cursor without
    duplicating or losing work.
29. A reactivated historical file inherits the current tuple decision or
    enters review deterministically.

## 10. Rollback and failure handling

- Alias/decision records must be deactivatable or supersedable; never erase
  audit history.
- A bad mapping rollback deactivates the decision and rebuilds only affected
  files when possible.
- Before every production rebuild, preserve the named accepted/manual/rejected
  tag export and hashes. Rollback uses that evidence to identify the exact
  affected files and relationships; “rebuild affected files” is not a recovery
  plan without this snapshot.
- Do not delete canonical Properties as a rollback for a PopSG mapping.
- Never rewrite an applied migration.
- If a rebuild fails, preserve its cursor, run ID, failure samples, and last
  successful cursor; resume only after the root cause is fixed.
- Any cross-parent tag is a release blocker: stop the rebuild, deactivate the
  offending decision, repair, retest in preview, then resume.
- Authentication failure is not permission to use dashboard SQL or embed
  secrets. Repair the canonical Supabase/1Password path.

## 11. Dependencies, ownership, and sequencing

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

---

## 19. PSG-4 owner decision record — 2026-07-28

**Status:** COMPLETE. Stop before PSG-5.

Albert approved PSG-4 package
`e4ad02fd19491cef12a9a78204e7fca457c0ebefcc5197099e30cd39a64e0f68`
after GLM 5.2 independently returned `APPROVE` with zero Critical or High findings.
The package is bound to the unchanged Batch 01 source SHA-256
`f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`.

The bounded approval covers only 51 `exact_existing`, same-parent decisions affecting
44,331 active files. All 51 rows have a disposition, reason, parent proof, evidence reviewer,
and review timestamp. The owner approval record is
[`docs/verification/popsg-property-reconciliation-20260728-psg4/owner-approval.json`](docs/verification/popsg-property-reconciliation-20260728-psg4/owner-approval.json).

This approval does not cover Batch 02, canonical creates, the 6,961 at-risk removals,
ambiguous/deferred rows, schema, migrations, RLS, RPCs, database writes, mapping activation,
tag rebuilds, deployment, production, or PSG-5. No database was accessed or changed. No
mapping became effective.

PSG-5 remains a separate fresh-session phase requiring explicit owner authorization. It must
recheck the current ColdLion checkpoint before any preview work and must preserve every exclusion
above.

---

## 20. PSG-5 entry record — stopped before schema work — 2026-07-29

**Status:** BLOCKED before any schema/preview change. No migration authored. No branch created.
Stop before PSG-5 implementation; re-enter after the collision below is resolved.

Albert authorized PSG-5 on 2026-07-29 (recorded in `HANDOFF.md` → "PopSG Property reconciliation
PSG-4 APPROVED" fresh-session update). This session re-read this plan end to end, `HANDOFF.md`'s
newest PSG section, and `AGENTS.md` before starting.

### ColdLion checkpoint recorded before preview work (rule §7/§11)

Read from `plan_coldlion_licensor_property_accelerated_cutover.md` STATUS table, current as of
2026-07-29:

- Steps 0–6 are complete or preview-proven. Step 7 (production change package) is complete but
  **not applied** — production still has zero ColdLion Licensor/Property mirror rows.
- **Step 7A (build the real recurring production feed) is OPEN, explicitly blocked by another
  schema workstream**: open PR #300 (`add incremental ClickUp task import`) and a **duplicate
  migration timestamp `20260728160000`** shared by
  `20260728160000_clickup_incremental_task_import.sql` (already on `main`, via commit `8a7197f`)
  and `20260728160000_popdam_user_tables_foreign_keys.sql` (already on `main`, via commit
  `0b8425b`). PR #300's own branch copy of the ClickUp migration now shows `gh pr view 300` as
  `CONFLICTING` against `main` — the collision is real and already landed in two places with the
  same version key, exactly the AGENTS.md §4 rule-5 failure mode (whichever ledger row wins,
  the other migration silently never runs).
- Steps 8–10 (production approval, cutover, monitoring) remain open/blocked behind Step 7A.
- The plan explicitly states "**Step 7A must not overlap PopSG PSG-6**" — this governs the
  future production PSG-6 phase, not the preview-only PSG-5 phase itself.

### Why this session stopped before any schema change

A second, independent agent is concurrently working in this same `shared-db` checkout (isolated
in its own worktree) on ColdLion Step 7A, whose first required action is exactly "first
resolve/serialize open PR #300 and the duplicate `20260728160000` migration timestamp." That is
an in-flight schema-affecting workstream touching `supabase/migrations/`, the same directory
PSG-5 §6 requires new timestamped migrations in (`core.property_alias`,
`dam.popsg_property_resolution`, and the guarded RPCs).

Per the one-schema-change-in-flight rule (`AGENTS.md` §4 rule 1) and this session's explicit
instruction to stop rather than silently resolve a detected collision, **this session did not
create a PSG-5 migration, branch, or preview change**. `git fetch --all`, `git branch -r`, and
`gh pr list --state open` were re-run before starting; open PRs were #307 (docs-only,
`docs/local-replay-unsupported`), #300 (the conflicting ClickUp migration above), and #238
(docs-only, unrelated). No PSG-5 branch existed yet from any other session.

### Preserved PSG-4 limits (unchanged)

Only `batch-01-exact-existing` (51 `exact_existing`, same-parent decisions / 44,331 active files,
SHA-256 `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e`) is approved. Batch 02,
canonical creates, the 6,961-row `currently-tagged-at-risk.csv` removals, ambiguous rows
(including `the lion king`), deferred rows, CHEERS/THE EXORCIST (routed to ColdLion Phase 5), and
all eight hard-coded `LICENSOR_ALIASES` remain unapproved/unresolved. None of these were
activated, written, or perturbed this session.

### Forward-impact reread of PSG-6 and PSG-7 (required before closing PSG-5)

- **PSG-6** still correctly requires re-reading the moving status header in
  `fix_coldlion_licensor_property_phase6_handoff.md` (last updated 2026-07-28, still current) and
  Albert's sign-off that PSG-6 cannot perturb cutover-plan §9.4. No drift found in that
  requirement. PSG-6's own gate ("production dry run lists only approved migrations") now has a
  concrete, named example of what must NOT happen: the duplicate `20260728160000` timestamp
  proves a bounded-checkout dry run must be re-verified object-by-object, not by ledger row count
  alone, before any future PSG-6 production apply.
  New drift to record: PSG-6 step 5 says "physically bounded production migration runner if
  unrelated migrations remain pending" — the ClickUp/foreign-keys collision is exactly this kind
  of unrelated pending migration and must be resolved (by Step 7A's owning session) before a
  PSG-6 bounded checkout can safely enumerate "only its own" migrations.
- **PSG-7** acceptance criteria are unchanged; no drift found.
- No other later-phase assumption, sequencing, rollback, or production-safety rule drifted.

### Exact next steps

1. Confirm (fresh `gh pr list` / `git branch -r`) that the Step 7A session has resolved PR #300
   and the duplicate `20260728160000` timestamp, or that it has explicitly serialized/ceded the
   schema-change slot.
   **Pass when:** `ls supabase/migrations | cut -c1-14 | sort | uniq -d` prints nothing on
   `origin/main` and no open PR carries an unresolved schema change.
2. Only then create the PSG-5 branch, author the `core.property_alias` /
   `dam.popsg_property_resolution` migrations restricted to `batch-01-exact-existing`, and run
   `scripts/check-sql.sh` and a preview dry run.
3. Continue PSG-5 exactly as specified in §7 "PSG-5 — preview implementation and rebuild" above,
   including resolving all eight `LICENSOR_ALIASES` and taking a fresh worker behavior baseline.
4. Stop at the PSG-6 production approval gate; do not begin PSG-6.

### Access and environment

No secret was read or created. Neither Supabase project (preview `rjyboqwcdzcocqgmsyel` or
production `qsllyeztdwjgirsysgai`) was accessed or written to. This session ran in an isolated
git worktree (`.claude/worktrees/agent-adc3dd20d3ac74d92`) fast-forwarded to `origin/main`
(`fa890ae`); it made no push and created no branch.

---

## 21. PSG-5 second entry record — non-schema work complete, schema slot still occupied — 2026-07-31

**Status:** PSG-5 NOT STARTED as an implementation phase. All PSG-5 *non-schema* preparation is
complete and recorded below. **No migration authored, no branch carrying SQL, no preview access,
no database read or write, no secret read.** Stop here and re-enter when the schema slot is free.

This record supersedes §20's *blocking reason* (that blocker is resolved) but preserves every
approval limit §20 recorded. §20 remains valid history.

### 21.1 What changed since §20

The §20 blocker — the duplicate migration version `20260728160000` — **is resolved.**
PR #322 deleted the never-applied ClickUp copy; `20260728160000_popdam_user_tables_foreign_keys.sql`
correctly keeps the version because the production ledger row belongs to it. Verified on the
current `origin/main` tip `75066fe`:

```text
ls supabase/migrations | cut -c1-14 | sort | uniq -d   → prints nothing
```

§20's forward-drift note that "the ClickUp/foreign-keys collision must be resolved before a PSG-6
bounded checkout can safely enumerate its own migrations" is therefore **now discharged**. The
underlying lesson it recorded is retained and restated in §21.10: a bounded production dry run must
be verified object-by-object (`to_regclass`, `pg_proc`, `pg_policy`), never by ledger row alone.

### 21.2 ColdLion checkpoint recorded before any preview work (required by §7 and §11)

Read 2026-07-31 from `plan_coldlion_licensor_property_accelerated_cutover.md` STATUS table at
`origin/main` `75066fe`, **cross-checked against live PR state** because the STATUS table lags:

| Item | Recorded state |
|---|---|
| Steps 0–6 | Complete or preview-proven |
| Step 7 (production change package) | Complete but **not applied**; production still holds zero ColdLion Licensor/Property mirror rows |
| Step 7A (recurring production feed) | STATUS table still reads "⬜ Open, blocked by another schema workstream" and names the now-stale PR #311/#314 context. **Ground truth: Step 7A is built and is in open PR #331** (`codex/coldlion-step7a-recurring-production-feed`), `MERGEABLE`, carrying four migrations already applied to preview |
| Steps 8–10 (production approval, cutover, monitoring) | Open / blocked pending Albert's approval. No production write has occurred |
| ColdLion Phase 7 (production source cutover) | Not started. §11's "PSG-6 must not overlap ColdLion Phase 7" is therefore not yet triggered |

The four Step 7A migrations in PR #331, all preview-applied and all sorting after `main`'s current
maximum `20260729210000`:

```text
20260729230000_coldlion_licensor_property_recurring_promotion.sql
20260729234500_coldlion_recurring_promotion_collision_rule_fix.sql
20260729235500_coldlion_recurring_promotion_ambiguous_column_fix.sql
20260730000500_coldlion_recurring_promotion_absence_detection_fix.sql
```

**Note for the next session:** Step 7A is a *preview* workstream. It does not by itself forbid
PSG-5 (which is also preview-only). What forbids PSG-5 right now is the separate
one-schema-change-in-flight rule in §21.3.

### 21.3 Why this session again stopped before schema work

`AGENTS.md` §4 rule 1 permits **one schema change in flight at a time**. PR #331 is open and holds
four migrations that are **already applied to the shared preview branch but not merged to `main`**.
That is precisely the persistent-preview-ledger hazard `AGENTS.md` §4 rule 1 describes: a second
workstream pushing to preview now would interleave two unmerged rehearsals in one ledger, and a
`main`-based checkout could no longer dry-run cleanly against preview.

Authoring the PSG-5 migrations would also require choosing 14-digit versions **now** that must
still satisfy CI Guard B **at PR-open time** — and `main`'s maximum version will jump from
`20260729210000` to `20260730000500` the moment PR #331 merges. Timestamps chosen today would be
stale-by-construction. This is a second, independent reason to defer authoring.

Accordingly this session authored **no SQL and no migration**, took **no preview action**, and read
**no credential**. The schema slot was left to PR #331.

### 21.4 PSG-5 non-schema work that IS complete (re-verified 2026-07-31)

Every frozen input PSG-5 depends on was independently re-hashed from the current checkout. The
Windows CRLF caveat recorded in §17 still applies: hash the LF-canonical bytes
(`tr -d '\r' < FILE | sha256sum`), not the working-tree bytes.

| Artifact | LF-canonical SHA-256 | Matches frozen value |
|---|---|---|
| `docs/verification/…-psg2/batch-01-exact-existing.csv` | `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e` | ✅ PSG-4 approved source |
| `docs/verification/…-psg2/proposals.csv` (372-row ledger) | `cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4` | ✅ §17 |
| `docs/verification/…-psg1/currently-tagged-at-risk.csv` (6,961 rows) | `f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6` | ✅ §16 — **evidence only, NOT approval** |

Reproducible tests re-run and passing on the current tip:

```text
node scripts/popsg-property-psg4-decision-package.test.cjs
  → PSG-4 decision package: PASS
    source=f59118aa…643e  package=e4ad02fd…0f68
    rows=51 active_files=44331 parent_edges=51/51 exclusions=11 approval=recorded

node scripts/popsg-property-psg2-proposals.test.cjs
  → PSG-2 proposal tests passed
```

Batch 01 shape re-derived directly from the CSV (independent of the generator):

- 51 data rows, `sum(active_file_count) = 44,331` — exactly the approved scope;
- `currently_tagged_at_risk = false` on **all 51** rows;
- `cross_parent_proposal = false` on **all 51** rows.

Batch 01 rows by resolved canonical Licensor:

| Licensor | Rows |
|---|---:|
| NBC | 19 |
| WARNER BROS | 12 |
| DISNEY | 10 |
| VIACOM MULTI | 6 |
| SEGA / MARVEL / COCA COLA / AARDMAN ANIMATIONS | 1 each |

### 21.5 NEW finding — the eight hard-coded Licensor aliases are load-bearing for a third of Batch 01

§7 PSG-5 step 6 ("resolve the future of all eight hard-coded `LICENSOR_ALIASES`") has always read
like an independent tidy-up task. It is not. Cross-referencing the Batch 01 rows against
`docs/verification/…-psg1/licensor-alias-blast-radius.csv` shows:

**26 of the 51 approved rows — 15,816 of the 44,331 approved files (35.7%) — resolve under a
canonical Licensor that the hard-coded alias list feeds** (NBC 19 rows, VIACOM MULTI 6, MARVEL 1).

Therefore the alias decision is a **prerequisite** for activating Batch 01 correctly, not a
follow-up. If an alias is retired or re-pointed after activation, those 26 decisions silently
change parent. PSG-5 must settle the aliases **before** the preview rebuild, and the rebuild
assertions must include a parent-stability check for these 26 rows specifically.

Second new finding from the same file: **two of the eight aliases are dead.** `Nickelodeon` and
`Viacom` both measure 0 active files, 0 Property observations, and 0 accepted relationships; the
entire three-to-one Viacom mapping's blast radius comes from `Paramount` alone (9,052 active files,
5,524 accepted relationships). §13 open decision 7 says "the three-to-one Viacom mapping needs
particular scrutiny" — the scrutiny result is that it is effectively a one-to-one
`Paramount → Viacom Multi` mapping plus two no-op entries. That materially simplifies the owner
decision Albert must make.

### 21.6 NEW constraint — the 2026-07-29 `public`-schema lockdown changes PSG-5's DDL

`AGENTS.md` §10.2 records a behaviour change that landed on **both preview and production on
2026-07-29**, *after* §6.1 of this plan was written. An event trigger,
`lock_down_new_public_function_execute_trg`, fires on every `CREATE FUNCTION` / `CREATE PROCEDURE`
in schema `public` and immediately revokes EXECUTE from **PUBLIC and `anon`**; the `public` default
privileges no longer grant EXECUTE to `anon`/`authenticated` either.

§6.1 and §6.2 require exactly such functions in `public` — the plan's provisional
`public.propose_popsg_property_resolution(...)`,
`public.activate_popsg_property_decision_batch(...)`, and
`public.promote_property_alias_batch(...)`, plus the `SECURITY DEFINER` bridge §6.2 mandates
because `dam` is deliberately not exposed through PostgREST (`AGENTS.md` §8.1).

**Consequence for the PSG-5 migration author:** every one of those functions is reachable by
nobody except `postgres` and `service_role` unless the migration states its grants explicitly, and
because `create or replace` re-reports the `CREATE FUNCTION` tag, any later patch re-strips `anon`.
Each function must therefore end with an explicit block, and §9 test 14
("viewer/designer approval is denied") must be proven against the *granted* state, not the default:

```sql
revoke execute on function public.<fn>(...) from public, anon, authenticated;
grant  execute on function public.<fn>(...) to service_role;   -- and/or authenticated
```

The same section also warns that **views ignore RLS unless created with `security_invoker = true`**.
If PSG-5 adds any reporting view over `core.property_alias` or `dam.popsg_property_resolution`,
it must set `security_invoker = true` or revoke `anon`/PUBLIC explicitly, and verify with the anon
key. This does not change any PSG-5 decision or approval limit — it changes the DDL that must be
written, and it is a silent failure mode if forgotten.

### 21.7 NEW constraint — preview is no longer a clean baseline

§7 PSG-5 step 9 ("run a full deterministic rebuild on preview") and its required assertions were
written assuming preview approximated production. As of 2026-07-31 preview additionally holds:

- the four Step 7A ColdLion migrations of PR #331 (applied, unmerged);
- rows in `pim.product` and `ingest.sync_run` from two ClickUp importer runs;
- 180 rows in `plm.coldlion_promotion_quarantine`.

None of these touch `public.style_guide_files` or `public.style_guide_file_tags`, so the PopSG
signed-delta arithmetic is not corrupted. **But the PSG-5 pre-rebuild snapshot must be taken from
preview at the moment of the rebuild** — it must not reuse the 2026-07-26 production baseline in
§15, and the evidence README must state which project each number came from. Comparing a preview
rebuild against a production baseline would manufacture a false delta.

### 21.8 CI Guard B — new versioning rule affecting PSG-5 and PSG-6

CI now **rejects any migration whose 14-digit version sorts earlier than `main`'s newest.** Two
consequences:

1. **PSG-5:** pick migration timestamps at the moment the PR is opened, verifying with
   `ls supabase/migrations | cut -c1-14 | sort | tail -3`. Today that maximum is `20260729210000`;
   it becomes `20260730000500` when PR #331 merges.
2. **If Guard B ever flags a migration already applied to preview, do NOT rename it.** Renaming
   re-applies the DDL under a new version and orphans the original ledger row. Keep the applied
   version and land a corrective forward migration on top.

### 21.9 Preserved PSG-4 limits (unchanged, re-verified)

Only `batch-01-exact-existing` — 51 same-parent `exact_existing` decisions / 44,331 active files,
SHA-256 `f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e` — is approved.

**Still NOT approved and NOT activated:** Batch 02 (`non_property`), canonical creates, the
**6,961-row `currently-tagged-at-risk.csv` removals** (evidence only — `batch-06` is explicitly
non-approvable), all `ambiguous` rows **including `the lion king`** (521 files, locked),
all `deferred` rows, and `CHEERS` / `THE EXORCIST` (routed to the ColdLion Phase 5 gate, which
still has zero approved creates). Nothing in this session activated, wrote, or perturbed any of
these.

### 21.10 Forward-impact reread of PSG-6 and PSG-7 through plan end

- **PSG-6 step 5 (bounded production runner):** §20's ClickUp-collision blocker is discharged
  (§21.1). The bounded-checkout recipe in `AGENTS.md` §5.1 remains correct, including its
  correction that you delete only the *pending* files you are not promoting, never the applied
  ones. Object-level verification (`pg_constraint`/`pg_proc`/`pg_policy`/`to_regclass`) remains
  mandatory over ledger-row counting.
- **PSG-6 step 3 (ColdLion checkpoint):** unchanged in requirement, but the checkpoint it must read
  has moved — Step 7A is now built and in PR #331, and Steps 8–10 await Albert. PSG-6 must re-read
  it again; the value recorded in §20 is stale.
- **PSG-6 step 6 (schema before app deploy):** now additionally constrained by §21.6 — verifying
  "SQL grants and policies, not just the migration ledger" is no longer optional prudence, because
  the `public` lockdown trigger can silently leave a function ungranted and its failures are
  `raise warning` only, visible in the Postgres log and nowhere else.
- **PSG-6 §11 overlap rule:** ColdLion Phase 7 has not started, so the no-overlap rule is not yet
  triggered — but Steps 8–10 could start at any time once Albert approves, so PSG-6 must re-check.
- **PSG-7:** acceptance criteria unchanged. One addition: §21.5 means PSG-7's Licensor precision
  audit must explicitly cover the 26 alias-dependent Batch 01 rows rather than sampling generally.
- No other later-phase assumption, sequencing, identifier, rollback, or production-safety rule
  drifted.

### 21.11 Exact next steps

1. Confirm PR #331 has merged: `gh pr view 331 --json state,mergedAt`.
   **Pass when:** `state` is `MERGED`, and `gh pr list` shows no other open PR carrying a
   migration. Docs-only PRs do not occupy the slot.
2. Re-read the ColdLion STATUS table again — it is a moving target and §21.2 will be stale.
   **Pass when:** the new PSG-5 evidence README names the then-current Step 7A/8 state.
3. Re-check the version floor (`ls supabase/migrations | cut -c1-14 | sort | tail -3`) and only
   then author the `core.property_alias` and `dam.popsg_property_resolution` migrations, restricted
   to `batch-01-exact-existing`, with the explicit grants required by §21.6.
   **Pass when:** `scripts/check-sql.sh` passes and `supabase db push --dry-run --linked` against
   `rjyboqwcdzcocqgmsyel` lists **only** those files.
4. Settle the eight `LICENSOR_ALIASES` **before** the preview rebuild, using §21.5 — two are dead
   no-ops and the Viacom mapping is effectively one-to-one.
   **Pass when:** each alias is either migrated into an approved contract or retained with recorded
   owner sign-off plus a test, and the 26 alias-dependent Batch 01 rows have a parent-stability
   assertion.
5. Take the pre-rebuild snapshot **from preview** per §21.7, then run the rebuild and prove all of
   §7's required preview assertions, above all **zero unexplained accepted-tag loss**.
   **Pass when:** the accepted-tag signed delta equals the owner-approved expectation and the
   unexplained partition is zero.
6. Stop at the PSG-6 production-approval gate. Do not begin PSG-6.

### 21.12 Access and environment

No secret was read or created. **Neither Supabase project was contacted** — preview
`rjyboqwcdzcocqgmsyel` and production `qsllyeztdwjgirsysgai` were both untouched, and no Supabase
MCP tool was called (those tools are bound to production in these sessions). This session ran in an
isolated git worktree at `origin/main` tip `75066fe`. Its only change is documentation.

---

## 22. PSG-5 preview implementation record — contracts applied and proven — 2026-07-31

**Status:** PSG-5 database contracts COMPLETE and proven on preview. **PSG-5 as a whole is NOT
complete** — it is stopped at an owner gate (section 22.6) and at the PopDAM worker boundary
(section 22.7). **PSG-6 not started. Production untouched.**

Supersedes section 21's blocking status. Section 21's four findings all carried into the
implementation and all four proved load-bearing; section 21 remains valid history.

### 22.1 The slot opened

ColdLion Step 7A PR #331 merged as `0798c095a84dbd6bb80465ce1981a1a63cd80218`. Its four migrations
are on `main`, raising the version floor to `20260730000500`. This session then owned the
one-schema-change-in-flight slot.

### 22.2 What was applied to preview

Two migrations, applied to `rjyboqwcdzcocqgmsyel` **only**. Each was preceded by a `--dry-run` that
listed exactly one file — its own — and by re-reading `supabase/.temp/project-ref`.

| Migration | Purpose |
|---|---|
| `20260731150000_popsg_property_resolution_contracts.sql` | The section 6.1/6.2/6.3/6.4 contracts |
| `20260731153000_popsg_property_alias_redundancy_trigger_fix.sql` | Corrective fix for the bug in section 22.5 |

Objects created (verified with `to_regclass` / `pg_proc` / `pg_constraint`, **never by ledger row**):

- `core.normalize_popsg_property_observation(text)` — the single canonical normalizer, an exact SQL
  implementation of the frozen `popsg-property-observation-v1` contract.
- `core.property_alias` — shared alias truth, **0 rows**.
- `dam.popsg_property_resolution` — append-only PopSG decisions, **0 rows**.
- `public.propose_popsg_property_resolution(...)`, `public.activate_popsg_property_decision_batch(...)`,
  `public.promote_property_alias_batch(...)` — three separately named RPCs at three authority
  levels, as section 6.1 requires.
- `core.reject_redundant_property_alias()`, `dam.enforce_popsg_resolution_append_only()` triggers.
- **`core.property (id, licensor_id)` unique index** — see the note in section 22.4; this is the one
  change touching a pre-existing shared table.

**No canonical Property was created, no mapping activated, no tag written or removed, and no
decision row seeded.** Both new tables are empty on preview.

### 22.3 How the four required properties are proven

`supabase/tests/popsg_property_resolution_contracts.sql` — 27 assertions, all passing against
preview, wrapped in `begin … rollback` so it leaves nothing behind.

| Required property | Assertions |
|---|---|
| Exact same-parent behaviour | B1–B7: same-parent decision accepted; cross-parent decision refused by the composite FK; identical alias text under two Licensors both accepted; duplicate normalized alias refused within one Licensor; alias parent mismatch refused; tagging dispositions must carry a target and non-tagging ones must not; `ambiguous` carries none |
| Role limits | C1–C7: one active decision per tuple; activation must name actor and time; activation refuses a wrong row count and an unapproved hash; both tables carry **zero non-SELECT policies**; `authenticated` holds **no INSERT/UPDATE/DELETE**; uncertified shared-alias promotion refused |
| Manual/rejected preservation, zero silent loss | D1–D4: decision rows cannot be deleted; active decision content is immutable; supersede preserves the row; superseded rows are retained |
| The lockdown did not orphan the RPCs | E1–E6: `authenticated` and `service_role` really can EXECUTE all three RPCs; `anon` can execute none and cannot read alias truth |
| Normalizer parity | A: **all 21 frozen fixtures reproduce byte-for-byte**, plus NULL-in/NULL-out |

### 22.4 Design decisions worth knowing before changing any of this

- **The cross-parent guard is structural, not application logic.** A CHECK cannot read another
  table, so both tables carry a composite FK `(property_id, licensor_id) → core.property (id,
  licensor_id)`. That required adding a unique index on `core.property (id, licensor_id)`. It is
  purely additive and can never fail (`id` is already the primary key), but it **is** a change to a
  shared `core` table and PSG-6 must promote it in the same bounded set. The payoff: plan rule 3 —
  a Property decision may never cross the canonical parent edge — is now enforced by Postgres and
  survives any application bug, any future worker, and any direct `service_role` write.
- **`MATCH SIMPLE` makes the guard skip NULL targets automatically**, which is exactly right: the
  non-tagging dispositions have `property_id IS NULL` and must not be constrained.
- **Neither table has a write policy for `authenticated` at all.** Section 6.1 requires RLS and
  GRANTs to enforce read-only *independently*, so writes go only through the SECURITY DEFINER RPCs.
  An administrator cannot write shared alias truth directly.
- **The normalizer is `IMMUTABLE`** because generated columns depend on it. It must stay
  collation- and locale-independent. Changing its body silently rebaselines every stored
  `normalized_alias` / `normalized_observed_value`; that is a re-freeze of the contract, not a patch.
- **Activation checks the hash AND the expected row count.** "51 rows" is half of what Albert
  approved; a batch that no longer has exactly 51 pending rows under the approved hash is not the
  approved batch. Activation also takes an advisory lock so two callers cannot both pass the check.

### 22.5 The bug the tests caught (record this — it is a whole class)

The first apply passed `check-sql.sh`, applied cleanly, and reported success. Test case **F3 then
failed: every redundant alias was being accepted.**

Root cause: `core.reject_redundant_property_alias()` is a **BEFORE** row trigger that read
`new.normalized_alias`. That column is `GENERATED ALWAYS … STORED`, and Postgres computes generated
columns **after** all BEFORE-row triggers run. So the value was always NULL, `NULL IN (...)`
evaluated to NULL, the guard never fired, and nothing raised an error.

**This is a silent failure of exactly the shape AGENTS.md section 10.2 warns about** — the object
existed, was attached, and looked correct. Only a behavioural test could reveal it.

Fixed forward in `20260731153000` by computing from `new.alias` directly. The applied
`20260731150000` was **not** edited (AGENTS.md section 4 rule 4).

**Generalised rule for this repo: never read a generated column inside a BEFORE trigger.** Compute
it from the source column using the same function the generated column uses.

### 22.6 OWNER GATE — the eight Licensor aliases are NOT resolved, and must not be resolved by an AI

Plan section 7 step 6 and section 13 decision 7 require settling all eight hard-coded
`LICENSOR_ALIASES`. Section 21.5 established this is a **prerequisite**: 26 of the 51 approved rows
(15,816 of 44,331 files, 35.7%) sit under a Licensor the alias list feeds.

Re-derived from the frozen PSG-1 `licensor-alias-blast-radius.csv` (production measurement; preview
holds no comparable PopSG population, so this frozen evidence is the authority — it was **not**
re-measured live, and no session should claim otherwise):

| Alias | Resolves to | Active files | Accepted relationships | At-risk |
|---|---|---:|---:|---:|
| NBC Universal | NBC | 25,731 | 14,931 | 0 |
| Marvel Style Guide | Marvel | 14,636 | 7,474 | 0 |
| One Piece | TOEI - ONE PIECE | 8,383 | 2,471 | 0 |
| Peanuts | Peanuts Worldwide | 3,509 | 3,705 | 0 |
| Sesame Workshop | Sesame Street | 1,630 | 77 | 0 |
| Paramount | Viacom Multi | 9,052 | 5,524 | 0 |
| **Nickelodeon** | Viacom Multi | **0** | **0** | 0 |
| **Viacom** | Viacom Multi | **0** | **0** | 0 |

**Which canonical Licensor is correct for each alias is a business judgement about POP's licensing
relationships. It is Albert's call and an AI session must not make it.** The evidence and the
options are presented; nothing was decided, and no alias was migrated, retired, or re-pointed.

Albert's decision, per alias, is between:

- **(a) migrate it into a durable approved contract** — the mechanism now exists; a
  `core.licensor_alias` table mirroring `core.property_alias` would be a small additive migration; or
- **(b) retain it in worker code with recorded owner sign-off plus a test**, per plan section 7 step 6.

Two facts that narrow the decision without making it:

1. **`Nickelodeon` and `Viacom` are dead** — zero files, zero relationships. Whatever is decided for
   the live six, these two are no-ops today. Retiring them changes no current behaviour.
2. Consequently the "three-to-one Viacom mapping" that section 13 decision 7 flagged for particular
   scrutiny **is effectively one-to-one**: `Paramount → Viacom Multi` carries all 9,052 files and
   5,524 relationships by itself.

**Until Albert decides, the preview rebuild must not run**, because a later alias change would
silently re-parent 26 of his 51 approved decisions.

### 22.7 What remains in PSG-5, and where it lives

The database half of PSG-5 is done. The rest is **PopDAM worker code in `u2giants/popdam3`, not
this repository**, and is therefore untouched here:

- worker loads canonical name/code + `core.property_alias` + `dam.popsg_property_resolution`,
  all scoped by resolved canonical Licensor (plan section 7 step 4);
- remove reliance on the frozen-empty `PROPERTY_ALIASES` array (step 5);
- prove `normalizePopSGTag` is byte-identical to `core.normalize_popsg_property_observation`
  against the same 21 fixtures (plan test 20 — the SQL side is now proven; the parity assertion
  needs both);
- preserve manual/rejected tags (step 7);
- full deterministic rebuild on preview with the pre-rebuild snapshot taken **from preview at
  rebuild time** (step 9 and section 21.7).

Seeding and activating the 51 approved decisions is deliberately **not** baked into the migration.
It is a data step performed through `activate_popsg_property_decision_batch()` with the exact
approved hash, so activation stays auditable and the migration stays reusable for production.

### 22.8 Residual risk honestly stated

The normalizer's steps 1–2 (NFKC, then the lowercase→uppercase boundary insertion) run before
lowercasing, so an exotic character whose case-folding differs between PostgreSQL `lower()` and
JavaScript `String.prototype.toLowerCase()` — Turkish dotted `İ`, German `ß` — could in principle
diverge. **The frozen 21-fixture corpus does not cover those**, and every non-ASCII character is
stripped by step 6 anyway, so no known input diverges. This is recorded as a known limit, not a
proven equivalence: PSG-5's worker-side parity test should add those cases to the corpus.

### 22.9 Preview baseline changes (relay to other sessions)

Preview `rjyboqwcdzcocqgmsyel` gained exactly: migrations `20260731150000` and `20260731153000`;
tables `core.property_alias` and `dam.popsg_property_resolution` (**both empty**); the normalizer
and two trigger functions; three `public` RPCs; and a unique index on `core.property (id,
licensor_id)`. The contract-test suite ran inside a transaction and **rolled back**, so it left no
rows. **No existing table's data was read, modified, or deleted.** ColdLion's audit/quarantine
tables and the ClickUp importer rows were not touched.

**Operational fact worth keeping:** the preview branch's pooler is
**`aws-0-us-east-1.pooler.supabase.com`** (user `postgres.rjyboqwcdzcocqgmsyel`, port 5432).
AGENTS.md section 9 documents `aws-1-us-east-1` for *production*; that host rejects the preview
tenant with `FATAL: (ENOTFOUND) tenant/user … not found`. Preview is a Supabase **branch**, so it
also does not appear in `supabase projects list`.

### 22.10 Forward-impact reread of PSG-6 and PSG-7 (required before closing PSG-5)

- **PSG-6 step 5 (bounded production runner):** must promote **both** `20260731150000` and
  `20260731153000`, in that order, in the same bounded set. Promoting only the first ships the
  silently-broken redundancy trigger from section 22.5.
- **PSG-6 step 6 (verify objects, not the ledger):** now has a concrete worked example. Section 22.5
  proves an object can exist, be attached, and still do nothing. **Re-run
  `supabase/tests/popsg_property_resolution_contracts.sql` against production after the apply** —
  it is rollback-safe and is the only thing that would catch a repeat.
- **PSG-6 gate additions:** the section 22.6 owner decision on the eight aliases is now a hard
  blocker for PSG-6 as well as for the PSG-5 rebuild, because it can re-parent 26 approved rows.
- **PSG-6 also inherits a `core.*` change** (the new unique index) — the first time this workstream
  touches a pre-existing shared table. It is additive and cannot fail, but it must be named in the
  production window request rather than smuggled in as an implementation detail.
- **PSG-7:** acceptance criteria unchanged. Additions: its Licensor precision audit must explicitly
  cover the 26 alias-dependent Batch 01 rows (section 21.5), and it should assert the two empty
  tables became non-empty **only** through the audited activation path.
- No other later-phase assumption, sequencing, identifier, rollback, or production-safety rule
  drifted.

### 22.11 Exact next steps

1. **Put the section 22.6 alias table in front of Albert and get a per-alias decision.**
   **Pass when:** each of the eight has a recorded (a)/(b) ruling. Do not proceed without it.
2. Implement the PopDAM worker changes in `u2giants/popdam3` (section 22.7), including the
   byte-parity test against `core.normalize_popsg_property_observation`.
   **Pass when:** all 21 fixtures agree across SQL and TypeScript, plus the section 22.8 additions.
3. Seed the 51 approved decisions as `pending` under batch id `batch-01-exact-existing` and hash
   `f59118aa…643e`, then activate via `activate_popsg_property_decision_batch(..., 51)`.
   **Pass when:** it returns exactly 51 and a deliberate wrong-count call is refused.
4. Take the pre-rebuild snapshot **from preview**, rebuild, and prove every section 7 assertion,
   above all **zero unexplained accepted-tag loss**.
5. **Stop at the PSG-6 production-approval gate.**

### 22.12 Access and environment

The Supabase PAT and the preview DB password were read from 1Password vault `vibe_coding`
(serially, never in parallel) and used only to authenticate the CLI and psql. **No secret value was
written to any file, doc, or commit.** Production `qsllyeztdwjgirsysgai` was never linked, queried,
or pushed to, and no Supabase MCP tool was called at any point.
