I now have enough verified evidence to deliver the critique. I've confirmed: the pinned SHA exists (merge of PR #287) and contains the hardening migration (verified `dd12260` is an ancestor); the four-part production-authorization module is correctly wired into the write/compare/readiness runners and refuses `DATABASE_URL`; the ColdLion key self-resolves via `op read`; the runners require `--linked` to the exact production ref. I also found the executable gaps below.

---

# Independent review ΓÇö ColdLion Licensor/Property cutover plan

## Verdict: **PASS WITH CONDITIONS**

The engineering is sound and the data-safety design is genuinely strong. But the plan and the Step 8 approval request frame this as **switching the routine ColdLion feed and making ColdLion authoritative for codes/names/descriptions**, while the actual package delivers a **one-time, additive provenance link with no production feed, no production schedule, and no canonical-field authority**. Approving it on the current wording would authorize something other than what is described. It is approvable after reframing and a few small executability fixes ΓÇö none of which touch the migrations or the data.

---

## Critical

### C1 ΓÇö This is not a feed cutover; it is a one-time provenance link. The approval framing says otherwise.
**Evidence**
- Goal: `plan_coldlion_licensor_property_accelerated_cutover.md:40-43` ΓÇö "Move the routine Licensor and Property master-data feed from DesignFlow to ColdLion."
- Authority claim: `planΓÇª:268-269` (Decision 1) ΓÇö "ColdLion is canonical for Licensor/Property source identity **and descriptions**."
- Reality of the package: `docs/verification/coldlion-licensor-property-step7-production-package-20260728/README.md:431-442` (┬º8) ΓÇö it "does **not** enable any production schedule," "does **not** start Phase 7, or Phase 8"; `README.md:78-89` (┬º3) ΓÇö "**no production workflow exists**" and "If recurring production automation is built later, that becomes its own request."
- The modes actually run are `mirror_only` + `link_approved`; `link_approved` by contract "do **not** ΓÇª update canonical descriptive fields" (`fix_coldlion_licensor_property_cutover.md:556-565`, ┬º6.4).
- The package's own success criterion is that ColdLion changed **nothing** canonical ΓÇö `README.md:326-334` (┬º5) "Must NOT change ΓÇª canonical names and codes," and `README.md:193-194` captures `licensor_code_name_hash`/`property_code_name_hash` specifically to prove codes/names are unchanged.
- Production remains on DesignFlow: `docs/master-data-cutover-scoreboard.md:53-55` (Licensor/Property = "Production DesignFlow; preview ColdLion readiness"); the live production promoter is still the DesignFlow `plm.import_master_data` path (`docs/merch-group-taxonomy-architecture.md:383-399`).

**Business impact (plain English):** Albert may believe that after Step 9, production licensors/properties will be refreshed and corrected by ColdLion. They will not. The 542 ColdLion rows become dormant provenance frozen at the cutover moment; DesignFlow stays the only thing feeding production `core.*`. "ColdLion becomes authoritative for source identity, codes, names, and descriptions" is not delivered ΓÇö ColdLion becomes *mirrored and linked*, authoritative for **nothing** canonical.

**Correction:** Reframe Step 8 to approve exactly what the package does ΓÇö a one-time, bounded, additive link (mirror refresh + 542 `taxonomy_source_ref` rows + breaker schema). If a genuine live feed switch is the actual goal, **this package is insufficient** and must not be approved as that.

---

## High

### H1 ΓÇö Plan Steps 9.15 and 10 require production scheduling/monitoring that does not exist.
**Evidence:** `planΓÇª:595` (Step 9 item 15) "Enable the normal production schedule and hourly health monitoring"; `planΓÇª:605-627` (Step 10) "inspect the first scheduled ColdLion full snapshot and comparison." But the package creates none of this (`README.md:431-436`), the only schedules (`PHASE6_SCHEDULE_ENABLED`, the cron workflows) are **preview-only and refuse production** (`AGENTS.md` ┬º6.1; `tools/phase6-preview-guards.mjs`), and the alert monitor hard-refuses production (`fix_coldlion_licensor_property_phase6_handoff.md` / phase6 README ┬º4.7.6:314-323).

**Impact:** After the one-time apply there is **no recurring ColdLion refresh and no production health/alert/comparison**. An operator following Step 10 ("watch the first scheduled production cycle") has nothing to watch.

**Correction:** Strike the schedule/monitoring language from Steps 9.15/10 and replace it with: "No production automation is enabled; observability is limited to the in-window checks plus on-demand readiness re-runs," and name an owner/timeline for when production monitoring will be built ΓÇö or defer Step 8 until that workflow exists and is separately approved.

### H2 ΓÇö The package cannot be executed as written: `$PROD_DB_PASSWORD` is used but never set.
**Evidence:** `README.md:162` (┬º4.2) runs `supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"`, but the ┬º3A prerequisite table (`README.md:124-125`) only says the password is "needed for `supabase link`" and never exports it. The canonical flow does export it: `AGENTS.md:482-484`.

**Impact:** Run verbatim, `supabase link` uses an empty password. It fails **before any write** (safe), but the package is not "executable as written," and an operator scripting it breaks at the second command.

**Correction:** Insert before ┬º4.2 (Git Bash):
```
PROD_DB_PASSWORD="$(op read 'op://vibe_coding/Supabase DB Password - shared POP database/password')"; export PROD_DB_PASSWORD
```
Note `COLDLION_API_KEY` is **not** a gap ΓÇö the runner self-resolves via `op read` (`tools/sync-coldlion-licensors-properties.mjs:23-27`).

---

## Medium

### M1 ΓÇö Stale production inventory.
**Evidence:** The doc states production = 354 applied, highest `20260727213000`, 10 pending (`README.md:20-22`; phase6 README ┬º4A.2:514-519). Since the pinned SHA `fcca1f7` (PR #287), PRs #288ΓÇô#303 merged ΓÇö including `supabase/migrations/20260728160000_popdam_user_tables_foreign_keys.sql` (now on disk, almost certainly still pending on production). So the pending set has grown and/or the highest-applied has moved.

**Impact:** "Exactly 9 + 1 excluded" is a snapshot. The **pinned-SHA worktree shields the apply** (popdam is not in `fcca1f7`), but anyone who floats the checkout to `HEAD`/`origin/main` would pull extra pending migrations, and `--include-all` would then silently promote them.

**Correction:** Re-derive the production pending set read-only at the start of the Step 9 window (plan Step 9 item 1), confirm the bounded checkout still yields exactly the 10-file manifest, and add an explicit warning that HEAD has advanced and must not be used as the checkout base.

### M2 ΓÇö POSIX bash, not Windows PowerShell; required shell is unstated.
**Evidence:** ┬º4 uses `export`, `$VAR`, `rm`, `cd`, `test -f`, `grep -c "^    ('"`, `cat` (`README.md:135-164, 378-382`). On Windows, bare `bash` is WSL and `op_run`/process-substitution fail (`AGENTS.md:505-525`; merch-group doc ┬º11:698-709).

**Impact:** On this Windows machine the operator must run in **Git Bash**, not PowerShell and not WSL-bash. As written it does not run in PowerShell.

**Correction:** State at the top of ┬º4: "Run every command in Git Bash on Windows (not PowerShell, not WSL)."

### M3 ΓÇö Production observability gap (independent of H1, worth naming).
**Evidence:** No production detector/health/comparison/alert exists post-cutover (`README.md:431-436`); the breaker's known limitation is it "stops the *next* attempt" and cannot abort an in-flight write (`README.md:424-427`).

**Impact:** If canonical data drifts after cutover by any other process, nothing on production detects it; preview monitoring does not cover production.

**Correction:** Disclose this explicitly in Step 8 and state the intended monitoring owner/timeline, or accept (documented) on-demand-only monitoring until built.

---

## Low

- **L1 ΓÇö Stale Step 8 bullet:** `planΓÇª:556` still lists "schedule/variable to be enabled"; the package enables none. Remove it or replace with "no schedule or secret is enabled or created."
- **L2 ΓÇö Alert cadence unproven:** only a `workflow_dispatch` proved delivery; no unattended `schedule` run was observed (phase6 README ┬º4.7.6:339-358). Moot for a one-time cutover, but must be closed before any production schedule relies on it.
- **L3 ΓÇö Concurrency re-check:** add an explicit PopSG/in-flight check to plan Step 9 item 1. PopSG is currently at PSG-4 (prep only; PR #303), and `PSG-6 must not overlap Phase 7` (`AGENTS.md:379-386`) ΓÇö fine today, but confirm immediately before Step 9. The style-guide workstream migration is correctly excluded (`README.md:46-48`).
- **L4 ΓÇö Names/codes authority is structurally blocked:** even a future `promote_approved` can't cleanly make ColdLion authoritative for display names because Phase 0 never decided a separate source/display-name field and `core.licensor`/`core.property` have only `name` (`fix_coldlion_licensor_property_cutover.md:443-451`; merch-group doc ┬º5.2:406-423). Track as a Phase 8 prerequisite; don't let it read as done.

---

## What the plan gets right

- **Pinned-SHA bounded worktree** genuinely shields the apply from backlog drift; at `fcca1f7` the only non-ColdLion pending file is the style-guide migration, which ┬º4.1 removes ΓÇö so the bounded set is exactly the 10-file manifest (verified the hardening commit `dd12260` is an ancestor of the pinned SHA).
- **Four-part production authorization** (`tools/coldlion-production-authorization.mjs`) is clean: `--production` + `--production-authorized` + `--project-ref qsllyeztdwjgirsysgai` + `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true`, refuses `DATABASE_URL`, requires `--linked` to the exact ref, and prints an unmissable `authorized_target` banner.
- **Additive-only with strong integrity checks:** before/after hashes for UUID, status, parent-edge, and separately-hashed ColdLion vs DesignFlow source refs (catches a repoint); codes/names captured to prove they don't move.
- **Identity verifier** recomputes the frozen Phase 4 hash in SQL, both directions, 8 difference buckets all 0, and "counts alone never pass."
- **Circuit breaker** auto-trips from the detection path (the team openly corrected its own earlier false safety claim ΓÇö phase6 README ┬º4.8:391-419), with anti-disarm, DELETE/linked-INSERT gap closure, and a 9-trigger enforcement watchdog that readiness blocks on.
- **Rollback** is operational (no schema drop, no canonical delete), bound to the **exact frozen 542**, re-arms the breaker, and the SQL was **actually executed** on preview ΓÇö which is how it caught the `resolution_status` null bug.
- **Honest non-claims:** preview holds zero rows for `plm.item`/CRM/PM, recorded as "not exercised, not passed"; DAM screens not driven (no read-only role); the inactive-visibility rule wasn't genuinely exercised (no inactive licensors exist).
- **High-risk cases excluded:** NASA, FRIDA KAHLO (cross-entity), ZAG, ColdLion-only, canonical-only, and FRIENDS TV/`FR` are all outside the 542; lapsed-license resurrection is blocked by rule; the many-to-one division collapse is within the safe set (CW001+SP001 only).
- **No secret created** (the GitHub-secret request was correctly withdrawn); secrets referenced by name only.
- **Rehearsal harness** (`tools/rehearse-coldlion-cutover-sequence.mjs`) runs the entire ┬º4 sequence on preview (18/18) ΓÇö "run it, don't review it."

---

## Minimum safe approval wording

Use this **only after** C1 is reframed and H1/H2/M1/M2 are addressed. It deliberately names what the package does *not* do:

> "I, Albert Hazan, approve a **one-time, bounded, additive** production change on `qsllyeztdwjgirsysgai` consisting of exactly migrations `20260724060000`, `20260724061000`, `20260726030000`, `20260726031000`, `20260726032000`, `20260726180000`, `20260727221500`, `20260727223000`, `20260727224500`, and `20260728134500`, promoted from the pinned SHA `fcca1f7` via a detached worktree with **no other** pending migration (notably not `20260727230000_core_style_guide_axis.sql` and not any popdam/PopSG migration), never using `--include-all` against the full repo set; followed by a `mirror_only` ColdLion snapshot and the frozen-542 `link_approved` run in modes `mirror_only` and `link_approved` only. I understand this **does not** switch the routine production feed to ColdLion, **does not** make ColdLion authoritative for any canonical code/name/description, **does not** enable any production schedule or monitoring, and **does not** start Phase 7 (feed cutover) or Phase 8 (DesignFlow deprecation). DesignFlow remains the production source of parent/status and of canonical identity. Canonical UUIDs, statuses, parent edges, the 505 DesignFlow refs, names, and codes (26 licensors / 256 properties) must remain unchanged. Rollback is the documented operational withdrawal of exactly 542 links with no schema drop and no canonical delete. Execute in a single fresh session within the stated window; stop and return to me on any deviation."

---

## Go/no-go checklist (objective)

- [ ] **Reframed scope:** Step 8 request explicitly states one-time link, no production feed/schedule/monitoring, no canonical authority. (C1)
- [ ] **Steps 9.15/10 reconciled** with "no production schedule exists." (H1)
- [ ] **`PROD_DB_PASSWORD` export** present before ┬º4.2. (H2)
- [ ] **Shell stated** as Git Bash on Windows. (M2)
- [ ] **Production pending set re-derived** in-window; bounded checkout = exactly 10 files. (M1)
- [ ] Pinned SHA `fcca1f7` verified to contain `tools/coldlion-production-authorization.mjs`, the rehearsal tool, the rollback emitter, and all 10 migrations.
- [ ] Read-only 542-row identity pre-proof re-run in-window: 0 missing / 0 cross-typed / 0 code mismatch / 0 existing ColdLion refs.
- [ ] ┬º4.3 pre-hashes captured; DesignFlow ref hash/count must be identical afterward; only ColdLion ref count moves 0 ΓåÆ 542.
- [ ] DesignFlow PLM read-only smoke run **before** linking (┬º4.7) and **after** (┬º4.9) ΓÇö it is the only fully live app and was never exercised on preview.
- [ ] Breaker enforcement watchdog `all_enforced = true`, 9/9 triggers, after apply (┬º4.6).
- [ ] Rollback SQL reviewed (exactly 542 source ids, count guard) before any production run.
- [ ] PopSG confirmed not at PSG-5/6; no other shared schema change in flight (AGENTS ┬º4 rule 1, ┬º6.1).
- [ ] Production observability gap and its owner/timeline disclosed.

---

## Direct answer: Is this ready for Step 8 approval now?

**No ΓÇö not in its current wording.** It is safe, well-engineered work, but the approval would be premised on a feed switch and ColdLion authority that the package does not deliver (C1), and two execution steps assume production automation that does not exist (H1). It becomes ready for a **reframed** Step 8 once: (1) the request honestly describes a one-time additive provenance link with no production feed/schedule/monitoring; (2) Steps 9.15/10 are reconciled; (3) the `PROD_DB_PASSWORD` export and the Git-Bash requirement are added (H2/M2); and (4) the production pending inventory is re-derived (M1). None of these require touching the migrations or the data. If Albert's actual intent is a **live feed switch**, then this package is the wrong artifact and Step 8 should not be approved against it.

---

This was review-only. No repository file was read-for-write, edited, created, or deleted; no database, cloud service, or production system was contacted; the only commands run were read-only `git` inspection of local history.
