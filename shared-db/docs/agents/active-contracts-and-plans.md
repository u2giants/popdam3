# AGENTS.md — Historical classification pointer and active contracts and implementation plans

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## Historical item merchandise-group classification

Before interpreting `full_item_master.csv`, changing item-description parsing, or reporting historical MG match counts, read [`docs/item-description-mg-classification-process.md`](../../docs/item-description-mg-classification-process.md) and the completed [`plan_mg_taxonomy_three_axis_repair.md`](../../plan_mg_taxonomy_three_axis_repair.md). The implemented method separates MG01 physical form, MG02's family-specific subtype or material, and MG03 explicit embellishment. It validates newer codes independently at each depth, builds three independent post-May-13 maps, and matches historical items from three axes to two to one. Missing embellishment is unreadable, not plain; invalid child evidence never erases a valid parent; and a failed full-key match is never an MG01 failure. The older `plan_item_description_mg_taxonomy_repair.md` is retained as superseded history.

The guarded row-application work is planned in [`plan_historical_mg_reclassification_apply.md`](../../plan_historical_mg_reclassification_apply.md). Read its STATUS table first, then §9.1 and §9.2: §9.1 records the completed 2026-09-02 read-only Phase 0 re-run and its live counts, and §9.2 records an independent 2026-09-03 live re-verification that confirmed every gate-bearing count and flagged two §9.1 figures (the null-`div_code` historical count and the non-unique-item-number count) that did not reproduce and must be re-derived in Phase 1. It permits no preview or production write without a new explicit authorization, applies only complete live-qualified triplets in its first batch, keeps private artifacts out of this public repo, and leaves the May 14 cutoff in place until its exhaustive live-population gate passes.

## Active contracts and implementation plans

- **Bounded session handover (issue #2596):** [`plan_bounded_session_handover.md`](../../plan_bounded_session_handover.md). Read STATUS first. This is a proposed repository-maintenance plan, not activation of new closeout rules. PR #2592 already fixed the document/contract contradiction; remaining work is the complete fast document path, durable fenced ownership transfer, bounded reviewer lifecycle, and timed acceptance. No database or settings change is authorized by the plan.
- **Product-type reader (issue #3024):** [`plan_product_type_reader.md`](../../plan_product_type_reader.md). Read its STATUS table first. Hardens the item-description product-type reader to zero wrong answers on the full live catalog, then stores the value on `plm.item` (owner ruling 2026-09-16: never on `coldlion.item_header`).
- **Transfer `shared-db` to `popcre` and activate GitHub's native merge queue (issue #2530):** [`plan_shared_db_popcre_transfer_merge_queue.md`](../../plan_shared_db_popcre_transfer_merge_queue.md). Read its STATUS table first. This is repository-maintenance work outside the structure/schema orchestrator. It separates transfer compatibility, the owner-authorized repository move, settings/credential reconciliation, and queue activation so direct guarded merging remains available throughout. Do not cherry-pick closed PR #1950, weaken required checks, assume transfer-back is available, or invent a migration for acceptance proof.
- **Author-lane abandonment lifecycle (issue #2301):** [`plan_author_lane_abandonment_lifecycle.md`](../../plan_author_lane_abandonment_lifecycle.md). Read its STATUS table first. Repository-maintenance work outside the structure/schema orchestrator. It preserves every object/version claim while allowing evidence-backed capacity relinquishment, adds recovery-gated resume and immutable retirement tombstones, and forbids expiry-only release, ref deletion, automatic PR closure, or worktree mutation. Steps 1–5 have landed. **An expired lease is not an abandoned lane:** detect with the read-only `node scripts/manage-migration-author-lanes.mjs --abandonment-audit`, which cannot write on any code path and exits `0` clean, `2` expired, `3` unverifiable, with `3` outranking `2` — a run that could not read everything concludes nothing. The same report runs hourly as the `Author Lane Abandonment Audit` workflow, which holds only `read` scopes and files no issue and no comment; never call `--reconcile-flow` or any other mutating lane command from a scheduled job. Before any lane is touched, open an abandonment audit issue from `.github/ISSUE_TEMPLATE/author-lane-abandonment.md`, and fill in its required `abandonment-audit` fence: an absent or incomplete fence is read as no evidence at all, so no guarded command is suggested and a relinquish falls through to the ordinary-blocker path with none of the exact-tuple revalidation. Both guarded commands take `--claim-number <n>`, never a bare `--claim` (that is the boolean that claims a lane), and acting on abandonment evidence is refused without an explicit `--worktree-state`. **Authority boundary:** the orchestrator may retire work where the worktree is `clean`, or `absent` with its absence proven and its durable branch/PR evidence complete; Albert alone decides whether potentially recoverable `dirty` or `remote` uncommitted work may be abandoned. Both procedures — quarantine/recovery and terminal retirement — are written out in [`docs/agents/section-4-anti-collision-rules.md`](../../docs/agents/section-4-anti-collision-rules.md).
- **Database efficiency and Data API security program (issue #2209):** [`plan_database_efficiency_and_api_security.md`](../../plan_database_efficiency_and_api_security.md). Read its STATUS table first. It is the evidence-gated umbrella plan for Supabase advisor findings, expensive rebuilds, effective-tag churn, foreign-key/index review, RLS and privileged-API validation, maintenance statistics, and replication attribution. It authorizes no bulk fix: each structural change must be split into its own orchestrator issue, while application scheduling/batching changes remain with the owning application repo. The unused-index decision for four high-churn tables remains frozen under issue #1966 until its 2026-09-17 delta reading.
- PopDAM OrderList linked to Master Data: [`plan_popdam_order_list.md`](../../plan_popdam_order_list.md). Read its STATUS table first. Do not re-derive or re-plan completed steps.
- **Companywide business rules (read before interpreting business meaning):** start at [`docs/business-rules/application-map.md`](../../docs/business-rules/application-map.md). Licensing Master Data starts at [`docs/business-rules/licensing-master-data.md`](../../docs/business-rules/licensing-master-data.md); its detailed architecture remains in [`docs/core-master-data-consolidation-aim.md`](../../docs/core-master-data-consolidation-aim.md).
- **Licensing Master Data implementation:** [`plan_licensing_master_data_implementation.md`](../../plan_licensing_master_data_implementation.md). Read its STATUS table first and start at the named fresh-session step. It supersedes conflicting execution assumptions in older Character/Style Guide and ColdLion plans without deleting their historical evidence.
- **ColdLion — anything at all:** start at [`docs/coldlion.md`](../../docs/coldlion.md). It is a map, not a source. **Before asking ColdLion a question, or concluding a field is broken or unknown, read [`docs/coldlion-open-questions.md`](../../docs/coldlion-open-questions.md)** — twelve questions are already answered there, and on 2026-08-19 a session wasted an afternoon re-deriving one of them.
- **ColdLion `/vendors` field dispositions are SETTLED — never re-open them.** All 29 `/vendors` fields were ruled by the owner on 2026-08-19 in [`docs/coldlion-field-decisions-20260819.csv`](../../docs/coldlion-field-decisions-20260819.csv) (10 ingest, 19 **DECLINED**), and the ruling was **re-verified against the live feed on 2026-09-03** — the live field-name set is identical to the CSV's 29 rows. Vendor **addresses, `zipCode`, `state`, `email` and `phoneNo` are DECLINED**: not pending, not undisposed, and not an open owner decision. Issues #2180 and #2081 were written as though no vendors ruling existed and are wrong on that point. **`/seasons` is now ALSO SETTLED (owner ruling 2026-09-03): all eight currently-unstored fields — `seasonDesc`, `startDate`, `endDate`, `shipStartDate`, `shipEndDate`, `active`, `createdUser`, `modUser` — are DECLINED.** Nothing new goes into `coldlion.season`; the five stored columns (`company_code`, `division_code`, `season_code`, `created_time`, `mod_time`) are the complete approved projection. Not pending, not undisposed — **DECLINED**. Revisit only if ColdLion begins populating them.
- **⛔ ColdLion `/seasons` VENDOR DEFECT — NEVER use the unfiltered `/seasons` call. The other divisions' records are MISSING, not mislabelled.** A company-wide (unfiltered) `/seasons` query returns the **CW001 record in place of every other division's record entirely** — division code, description and all four audit stamps come from the CW001 row. **All 13 non-CW001 records (4 SP001, 1 EP001, 8 EH001) are ABSENT from the response.** The row *count* is right (21) but the row *content* is duplicated from CW001, byte-identical, as though the lookup were keyed on `seasonCode` alone and ignored division. **There is no workaround: you cannot re-derive the division code from elsewhere, because the data is not in the response at all.** Per-division queries return the correct records (CW001 = 8, SP001 = 4, EP001 = 1, EH001 = 8). **Any `/seasons` loader MUST query per division.** Nothing in the response envelope signals this, and paging is not involved (single page, 21 of 21, size 50). Confirmed against the live feed on 2026-09-03, re-verified three times, with a positive control that fires. This is a `/seasons` fault, not the API's general behaviour: unfiltered `/merchGroupHeaders` returns 37 rows correctly spanning all four division codes.
- **ColdLion landing-schema completion (issue #2081):** [`plan_coldlion_landing_schema_completion.md`](../../plan_coldlion_landing_schema_completion.md). Read its STATUS table first. It is the current execution plan after the 2026-09-02 production/API audit. The older [`docs/plan_coldlion-landing-phases-2-6.md`](../../docs/plan_coldlion-landing-phases-2-6.md) remains the owner-decision and historical evidence record, but its STATUS, history key, paging and field-count instructions are superseded. The owner's per-field decisions remain authority, supplemented by D14-D17 and a fresh live census where the API added fields.
- **Multi-agent database coordination hardening (issue #1366):** [`plan_multi_agent_database_coordination_hardening.md`](../../plan_multi_agent_database_coordination_hardening.md). Read its STATUS table first. This is repository-maintenance work outside the structure/schema orchestrator; do not route its implementation to that orchestrator or re-derive the completed research.
- **Reviewer-assignment GitHub API budget (issue #1767, complete):** [`plan_reviewer_assignment_api_budget.md`](../../plan_reviewer_assignment_api_budget.md). Read its STATUS table and verification link before investigating regressions; do not reimplement it or test scale by scanning live historical assignment refs. Slot 1 is capped at 19 requests, while mandatory slot 2 has a documented 22-request normal-path ceiling after PR #1813.
- **Reviewer lease capacity truth (issues #2058 and #1851):** [`plan_reviewer_lease_capacity_truth.md`](../../plan_reviewer_lease_capacity_truth.md). Read its STATUS table first — do not re-derive its root cause or re-plan its steps. Repository-maintenance work that authorizes **no** database change; implement it in a fresh isolated session outside the structure/schema orchestrator. It releases terminally failed reviewer slots without requiring a replacement draw, timestamps leases, adds a read-only capacity report, and makes the exhaustion refusal name its true cause. Never hand-delete a `refs/db-review-active/*` ref and never post a synthetic verdict to free capacity — both were considered and rejected, and both silently un-review a database change.
- **Orchestrator throughput Phase 2 (issue #1738):** [`plan_orchestrator_throughput_phase_2.md`](../../plan_orchestrator_throughput_phase_2.md). Read its STATUS table first. It uses the completed `shared-db.orch` transcript to separate protected claims from worker capacity, preserve content-addressed evidence across unrelated `main` movement, schedule shared-preview dependencies, and qualify routes before expensive gates. This is repository-maintenance work outside the structure/schema orchestrator.
  **No concurrency ceilings (owner ruling, 2026-09-16):** any number of migration authors may hold leases, any number of sub-agents may run, and one reviewer may run any number of reviews at once. The only admission controls are exact-object collision locks, unique migration version reservation, and the one-at-a-time preview apply, guarded merge, and production promotion lanes — those are safety isolation, not caps. Never reintroduce a count limit. Two physical limits remain and fail closed: the live-lease listing (`REVIEW_REF_ROW_LIMIT` and the GraphQL command size); the sanctioned response is `--reap-abandoned-review-leases --apply-recovery`, never a cap. The capacity report and start watch also refuse loudly past their per-lease read budget; that degrades reporting only, never draws.
  Phase 2 is active: protected claims never disappear when author capacity is relinquished; preview dependencies are waits, not successful checks. Before manual preview dispatch resolve the live marker, run `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch <issue>`, rerun the read-only selector/fresh-ledger check, and use only the matching instruction. Historical recovery is apply-only; historical dry-run proves nothing. `--repair-preview-ready <ready-id> --issue <n>` may repair only a v2-bound stale wrong digest; a corrupt live digest stops for owner decision without mutation. Reviewer reservations are per exact review, never per provider: one reviewer may run any number of reviews at once and there is no busy state or wait queue (issue #3130). The live orchestrator engine is always excluded: Codex cannot review a Codex-orchestrated change, and Claude cannot review a Claude-orchestrated change. Gemini 3.8 Flash High re-entered the active rotation on 2026-09-06 (PR #2438) after a recorded live re-qualification; Kimi K3 was unpaused on 2026-09-07 (PR #2483) but is paused again as of 2026-09-22 (issue #3423) and is not drawable; Codex GPT-5.6 Sol was retired from the rotation on 2026-09-06 (issue #2485) by owner instruction and is not drawable; DeepSeek V4.1 Flash (`deepseek-v4.1-flash`, read-only repository tools) entered the rotation on 2026-09-23 (issue #3468) while the text-only `deepseek-chat` stays retired. The gate this repo enforces before any reviewer runs is `reviewerExecutionPreflight`, which runs the wrapper's own `doctor` and refuses rather than report ready on a probe it never ran.
- **Making throughput guards tell the truth (hash-bound verification sidecars, typed catalog truth, regression corpus and causal blocker measures):** [`plan_orchestrator_throughput_guard_truth.md`](../../plan_orchestrator_throughput_guard_truth.md). Read its STATUS table first — do not re-derive its analysis or re-plan its steps. Repository-maintenance work that authorizes **no** database change; do not route it to the structure/schema orchestrator. It preserves every refusal while separating migration-file, ledger and live-catalog evidence so “not derivable” is never reported as “absent.”
- **Paramount capture validation after the 2026-08-24 preview rehearsal:** [`fix_Paramount_capture_against_preview.md`](../../fix_Paramount_capture_against_preview.md). **Complete — do not re-run it to make the document current.** The three required migrations and the JSON-null repair are on preview, and the full Paramount capture succeeded and was verified there. The JSON-null structural repair alone was later promoted to production under separate owner authorization (issue #1418). No production Paramount *data capture* has been authorized or performed; that remains a separate owner decision.
- OrderList source contract: [`docs/app-migration-notes/popdam-order-list.md`](../../docs/app-migration-notes/popdam-order-list.md), with formula detail in [`docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md`](../../docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md). Owner ruling: Google OrderList and future Coldlion rows are the same orders; `plm.item` is the ultimate item list. One canonical order/line must retain separate Google and Coldlion source refs.

This is the operating contract for **every AI session working on any app that
shares the Supabase database**: PM/PIM `poppim-web`, CRM `popcrm-web`, DAM
`popdam-web`, and the six `popcre/designflow-*` PLM repos. Read it before
touching code or the database. It exists to stop separate
AI sessions from breaking each other through the one database they all depend on.

> **The orchestrator takes ONLY database-SHAPE changes (§0.0-C) and curated Master
> Data loads. Nothing else is ever sent to it** — not proofs, monitoring, reports,
> tooling, scripts, docs, or repository maintenance, however small. The session
> that owns that outcome does it. When in doubt, it does not go to the orchestrator.
>
> **Started in `shared-db` and you are not the orchestrator?** Stop mutating the
> database. Hand over only unfinished shape work; keep everything else.
> This repo runs **one orchestrator session**, which dispatches structural work to
> sub-agents in isolated worktrees.
> **To find out who that is and where to send work, run
> `node scripts/check-orchestrator-marker.mjs --resolve` — §11c.** It is the only
> sanctioned source of a routing target. Never take one from conversation history,
> a `HANDOFF.d/` file, or a closed marker: that is how an authorized request was
> once delegated to an orchestrator session that had already closed.
> **Scope: STRUCTURE, not data (§0.0-B, owner ruling 2026-08-13).** This repo and its
> orchestrator govern the *shape* of the database — schema, tables, columns, views, functions,
> triggers, RLS, indexes, migrations. An application session changing its own *rows* does not
> belong here and must not open an issue for it. The one exception is curated Master Data
> under §6.4. **§0.0-C is the orchestrator's own admission test**: anything that fails the shape
> test is REJECTED (it belongs to another session) or FORKED to a fresh sub-agent — never worked
> in the orchestrator's own context window.
> **Any other session with a STRUCTURE change opens a GitHub issue and stops — with ONE
> exception (issue #3199 Phase B):** an additive change whose every named object lives in
> `{crm, pim, dam}` may instead take the **self-service additive lane** — declare
> `route: self-service-additive` in the issue's `db-work-scope`, claim the lane yourself
> (`--claim --admit-issue`), draw both reviewers yourself (`--assign-reviewer`), and dispatch the
> guarded merge yourself; the merge-time boundary classifier enforces the scope. Everything else
> (shared objects, other schemas, brand-new schemas) still hands over:
> `gh issue create --repo popcre/shared-db --label db-work --title "HANDOVER: …" --body-file <file>`.
> ⛔ **EVERY issue this repo receives carries the `db-work` label AND a `db-work-scope`
> block — no exceptions, including bug reports, tooling defects and CI complaints
> that feel unrelated to the queue.** `--label db-work` is not optional decoration and
> a body block is not a substitute for it: the orchestrator finds work by label, so an
> unlabelled issue is invisible no matter how well its body is written. That is not
> hypothetical — #1188, #1238, #1242, #1266 and #1268 all carried valid scope blocks and
> were still missed for weeks because nobody labelled them. If `gh issue create` fails
> and you retry, re-check the label on the issue you actually created. The queue audit
> (`--queue-audit`) now reads **every** open issue, prints `UNLABELLED ISSUES` and exits
> `2` until each one is labelled.
> ⚠️ **`COORDINATOR_INTAKE.md` is RETIRED** (2026-08-07) and is now a short pointer file.
> **It stays on disk on purpose — retired means "pointer plus guard", not "deleted".** The
> required check `Intake pointer guard` fails any PR that regrows a queue in it **and also fails
> if the file is missing**. Do not write into it and do not delete it; keep it under 40 lines and
> 4 KB. ⚠️ **Do not confuse it with `backlog-queue-sync`**, the deleted check `HANDOFF.md`'s
> `## BACKLOG` note refers to (removed in `534b20f`). Reading that note as "the intake guard is
> gone" leads straight to deleting a file a required check demands (issue #657).
>
> **The standing facts an incoming session needs — silent duplicate-version skips, the
> production-bound Supabase MCP, preview as a shared mutable resource, and the ban on
> background task chips — are now §12 of THIS file**, re-homed 2026-08-07 ahead of the
> queue file being retired. Skills:
> `shared-db-orchestrator` to run a orchestrator session, `shared-db-handover` to
> close one out.

> ## ⚠️ Before you conclude "this schema object does not exist"
>
> **The live catalog is NOT proof that work was never done.** It is proof of what is
> APPLIED. A migration that is merged to `main` but never applied is invisible in
> `information_schema` and looks exactly like work nobody ever wrote. On 2026-08-13 that
> is precisely what happened: 17 Disney landing tables were reported to the owner as
> "missing" when they existed as reviewed, merged SQL that had never been switched on
> (issue #892).
>
> **Always check the ledger against `main` before reporting a schema gap:**
>
>     SUPABASE_ACCESS_TOKEN=… node scripts/check-migration-ledger-drift.mjs --target production
>
> It reports both directions — merged-but-not-applied, and applied-but-not-on-`main`.
> Exit 0 = no actionable drift (retired/held versions remain listed), 1 = actionable
> drift, **2 = could not check, which is never "no drift"**. It also
> runs on every push to `main`, daily, and on demand: workflow `Migration Ledger Drift`
> ([`.github/workflows/migration-ledger-drift.yml`](../../.github/workflows/migration-ledger-drift.yml)).

> ## ⚠️ A structural migration returning to shared-db carries its live-proof probe
>
> When a structural outcome's `db-work-scope` says `application_return_to: popcre/shared-db`,
> its migration pull request must also commit `.github/live-proofs/<work_issue>.sql`: ONE
> read-only `SELECT`/`WITH` statement returning one row with a boolean column aliased `passed`.
> The `Shared DB Live Proof` workflow ([`.github/workflows/shared-db-live-proof.yml`](../../.github/workflows/shared-db-live-proof.yml))
> runs that committed file against production once it applies. The guarded migration merge runs
> `node scripts/check-live-proof-probe.mjs` and refuses the pull request (exit `2`) if the probe is
> absent from both the pull request and `main`, if the pull request deletes or renames it away, or
> if its shape cannot pass (#3127, #3147). Outcomes returning to an application repository prove
> themselves from that repository.

> ## ⚠️ Before you report that a scrape or loader "landed nothing"
>
> **An empty table is not proof that a capture never ran — it is proof that *that
> table* is empty.** Table names do not reliably tell you where a loader wrote. On
> 2026-08-13 a session counted `plm.dcp_property` and `plm.wb_property`, found both
> empty, and told the owner "Warner and Disney have landed zero rows". Disney had in
> fact landed **156,644 assets** in `plm.dcp_asset`, 2,967 style guides in
> `plm.dcp_style_guide` and 10,262 rows in `plm.opa_property_character`. The same
> session also understated Paramount and NBCU by roughly 230,000 rows, because it
> counted entity tables and ignored the asset tables entirely.
>
> **Never guess the table. Ask:**
>
>     select * from api.source_capture_inventory order by source_system, retained_row_count desc;
>
> The view separates retained evidence from current complete-capture coverage.
> `row_count` remains a compatibility alias for `retained_row_count`; neither is a
> current-coverage number. Use `latest_complete_row_count` with `count_basis`,
> `latest_complete_status`, and `count_note` when judging source coverage. A NULL
> latest-complete count means the exact count cannot be derived, not zero. Its
> `carries_resolution` column describes a table's shape and never indicates whether
> a scrape ran. Same discipline as the migration-ledger rule above: check the
> authoritative inventory before reporting an absence.
