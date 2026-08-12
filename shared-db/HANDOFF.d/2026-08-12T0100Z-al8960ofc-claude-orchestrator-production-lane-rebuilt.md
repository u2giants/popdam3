# Orchestrator handover — session `fcc2a1` — the production lane was rebuilt, and B3 is reviewed but not applied

- **Machine:** al8960ofc
- **Agent:** Claude (Opus 5), orchestrator session `fcc2a1`
- **Marker issue:** #793 (`orchestrator-marker`)
- **Written:** 2026-08-12T0100Z
- **Status:** OPEN

---

## 0. Read this first if you have never seen this repo

`u2giants/shared-db` is the **only** place the shared Supabase database
(`qsllyeztdwjgirsysgai`) is allowed to change. Every other application — PopDAM,
PopCRM, PopPIM, DesignFlow, the monitor — reads that database and may inspect its
schema freely, but none of them may alter it. Changes are authored here as
numbered SQL files in `supabase/migrations/`, reviewed in a pull request, and
then *promoted* to production by a GitHub Actions workflow behind a manual gate.

The repo runs **one orchestrator session at a time**. The orchestrator does no
work itself: it dispatches each task to a sub-agent in its own git worktree, reads
the report, verifies it against the artefact, and merges. This session was that
orchestrator. It dispatched **eighteen** sub-agents. This file is the record of
all of them.

Three vocabulary items you will meet constantly:

- **Batch / `B<n>`** — a named group of migrations promoted together. The full
  definitions live in `docs/production-promotion-app-tolerance-contract.md`.
  B1, B2 and B5 are fully applied to production. B3 is next.
- **The ledger** — the table `supabase_migrations.schema_migrations` on
  production. One row per applied migration version. It is the ONLY authority on
  what is live.
- **The guard** — `scripts/production_migration_guard.py`, which validates the
  allowlist of versions a promotion run is permitted to apply.

---

## 1. Coordination state — every number below was re-checked at 2026-08-12T0056Z

| Fact | Value | How it was checked |
|---|---|---|
| `origin/main` tip | `9645709a4b52e4848434b3ab3afda90e69505117` | `git fetch --all --no-prune; git rev-parse origin/main` |
| Migration files on `main` | **434** `.sql` files | `ls supabase/migrations/*.sql \| wc -l` |
| Highest migration version in the repo | `20260812010000` | `ls supabase/migrations \| sort \| tail -1` |
| Production ledger — applied | **381** | live `select count(*) from supabase_migrations.schema_migrations` |
| Production ledger — **highest applied** | **`20260810180000`** | same query, `max(version)` |
| Unapplied, total | **53** (434 − 381) | arithmetic on the two rows above |
| Open PRs | **#807** (ready), **#804** (draft) | `gh pr list --state open` |
| Open `db-claim` | **#795** | `gh issue list` |
| Open marker | **#793** | `gh issue list --label orchestrator-marker` |
| Registered worktrees | **21** | `git worktree list` |

### ⚠️ THE TRAP THAT CAUGHT THIS SESSION MORE THAN ANY OTHER

**The production ledger is applied OUT OF ORDER. Never reason from the
high-water mark. Use per-version set membership, every single time.**

Proven live at 2026-08-12T0056Z, three independent numbers:

- The highest applied version is `20260810180000`.
- **426** migration files sort *below* `20260810180000`.
- Only **380** ledger rows sort below it.

Therefore **46 unapplied migrations sort BELOW the highest applied version.**

Anything that reasons "everything up to the max is applied" — a script, a
checklist, a mental model, a report from a sub-agent — is wrong by 46 migrations.
The correct question is never "is this version below the max?" It is always "is
this exact version present as a row in the ledger?" Write it as a set-membership
query and nothing else.

### Preview `rjyboqwcdzcocqgmsyel` — NOT clean, and NOT fully known

Do not treat preview as a blank rehearsal surface. Known to be applied there:

- `20260807030000`
- `20260810070000`
- `20260810080000`
- `20260811030000`
- plus the five PopCRM cursor objects from #782 / PR #801

**Preview's true full contents were never established this session.** Nobody
enumerated it end to end. Two mechanical facts you need before you try:

1. **The Supabase MCP is bound to PRODUCTION.** Every MCP query in this session,
   including the ledger counts above, hit production. To read preview you must
   use the Supabase CLI against the preview project ref, not the MCP.
2. **The #782 sub-agent reset preview three times** during its work — it dropped
   its five objects and its ledger row and re-applied, each time. Those were only
   objects it owned under claim #795, so no other workstream was damaged. It is
   recorded here anyway because preview is a **shared** resource holding a
   production data clone, and an undisclosed write there is how the next
   rehearsal gets a silently false result.

### Merge order this session — nine PRs, verified against `gh pr view`

In merge order: **#800** `38cc674` → **#799** `22bc85d` → **#803** `4645191` →
**#794** `eaacaa5` → **#802** `5d7de93` → **#801** `326c25e` → **#806** `9645709`.
**#798** (`685ebf6`) and **#791** (`37fec74`) merged earlier in the session.

### Open PRs

- **#807** — `docs(review): batch B3 production apply review — CONCERNS`. Branch
  `review/b3-production-apply`, one file, `.ai/reviews/20260811-batch-b3-production-apply.md`.
  Docs-only, MERGEABLE. **This is the review evidence the B3 apply must cite**, so
  the closeout merges it.
- **#804** — DRAFT, `fix/790-noop-do-block-accept`. **Deliberately parked.** See
  §4. Do NOT merge it and do NOT resume patching it.

### Owner decisions made this session — treat these as settled

1. **NBCU `plm.nbcu_right` gets NO term or territory columns.** Owner's words:
   *"that's not data that's relevant to these tables."* Recorded on issue #732.
2. **B5 was approved and applied to production.**
3. **The promotion sequence runs batch by batch, with a gate click for each.**
   Not one big run.
4. **The paid model review is removed. shared-db code review happens in Claude
   Code.** Implemented in PR #806.
5. **Do not investigate whether PopDAM shares the `ANTHROPIC_API_KEY`.** Owner
   explicitly declined. See §7.

---

## 2. What was done, agent by agent

Each block below was checked against the artefact — the merged diff or the PR —
not against what the agent said about itself.

### Agent 1: B5 staging (read-only)
- **Asked to do:** determine whether batch B5 is safe to apply to production.
- **Actually did:** derived B5's four versions — `20260802140000`,
  `20260802141000`, `20260802150000`, `20260802160000` — proved all four
  unapplied by two independent methods, confirmed the batch is function-only
  (no table or data changes), returned GO.
- **Found:** B5 is **NON-atomic** and is absent from `ATOMIC_BATCHES` in the
  guard, so the guard would happily accept a *partial* B5 allowlist. The only
  legal resting point inside B5 is after `20260802160000`.
- **PR / branch:** none — read-only.
- **Worktree:** finished.
- **Deliberately did NOT do:** apply anything. Staging and applying were split on
  purpose so the GO decision had a second pair of eyes.

### Agent 2: B5 apply
- **Asked to do:** apply the four approved B5 versions to production.
- **Actually did:** applied all four. Ledger moved **377 → 381**.
- **Found / proved:** three independent proofs, not one — per-version set
  membership in the ledger; four new rows in `pg_proc`; and hand-read ACLs
  confirming `public_has_execute = false` on each new function.
- **PR / branch:** none — this was a workflow run, not a code change.
- **Worktree:** finished.
- **Deliberately did NOT do:** the §7.1 application smoke test, and the
  non-administrator acknowledgement test. Both need things a sub-agent must not
  have: real application logins, and a `service_role` write. **Both remain
  outstanding** — see issue in §6.

### Agent 3: four status questions (read-only)
- **Asked to do:** answer four standing questions about landing-schema status.
- **Found:** the NBCU, Paramount and DCP landing schemas are **merged into `main`
  but exist on NO database** — not production, not preview. Merged is not applied.
- **Worktree:** finished. **Deliberately did NOT** apply any of them.

### Agent 4: #790 catalog verifier → PR #794 (`eaacaa5`)
- **Asked to do:** make `production_catalog_verification.py` read
  privilege-shaped migrations and assert their end state.
- **Actually did:** delivered the `PUBLIC` normalization fix only.
- **Found:** a **key-case mismatch on `PUBLIC`** that caused a *failed revoke to
  be read as green*. Found by reproduction, not by reading the diff.
- **Deliberately did NOT do:** the `do`-block accept path. That was **split out to
  draft PR #804 by orchestrator ruling** after three successive security bypasses.
  See §4.

### Agent 5: #788 leftover review → PR #800 (`38cc674`)
- **Asked to do:** review the four unbatched leftover migrations.
- **Actually did:** a comment-only change to
  `20260811070000_nbcu_asset_ip_family_relationship.sql`. Adjudicated four
  CONCERNS: three were not real, one was.
- **Found, and this is the important part:** it **REFUSED to write a false no-op
  declaration on `20260807030000`.** That file's body is a single `do $coco$`
  block — exactly the shape the no-op check rejects — so any declaration claiming
  otherwise would have been a lie committed to the repo. **This was the correct
  call.** Do not overturn it.

### Agent 6: B10 contract → PR #802 (`5d7de93`)
- **Actually did:** defined batch B10 — six migrations, four parts (B10a–d), and
  the edge that forbids B10 before B9 — in
  `docs/production-promotion-app-tolerance-contract.md`.
- **Worth copying:** it found and **picked up its predecessor's 253-line
  uncommitted draft** in `.claude/worktrees/b10-contract` rather than starting
  over. Check for one before you restart any workstream.

### Agent 7: #782 PopCRM cursor → PR #801 (`326c25e`)
- **Actually did:** migration `20260812010000_crm_worker_delta_cursor.sql` plus
  `supabase/tests/crm_worker_delta_cursor_contracts.sql`. Preview-proven.
- **Found:** the `advanced_at = now()` cursor bug — it reported forward progress a
  stuck worker had not actually made. Found by reproduction.
- **Also:** it **corrected two comments in its own new code** that claimed
  protections which do not exist. `SET ROLE` leaves `session_user = postgres`, and
  the live `pgrst.db_schemas` **does** include `crm`. A comment asserting a
  protection you have not tested is a future incident.
- **Open item:** claim issue **#795 is still open** even though its work merged.
  Closed as part of this closeout.

### Agent 8: guard co-presence → PR #798 (`685ebf6`)
- **Actually did:** made the co-presence rule ledger-aware so B9 can ship. Filed
  follow-up issue **#796**. Unblocked B9.

### Agent 9: review / merge agent
- **Actually did:** merged seven PRs; opened issue **#805**.
- **Found three real bugs — all by reproduction, none visible in a diff.**

### Agents 10–12: NBCU / Disney / Paramount instruction gatherers (read-only)
- Consolidated what the three licensor scrape sessions had already written. No
  new scraping. No code. **Deliberately did NOT** re-scrape any portal.

### Agent 13: scrape-answer reconciliation → PR #799 (`22bc85d`)
- Produced `docs/licensor-source-shape-decisions-20260811.md`, the record that
  settles the suspected #757 conflict and writes down the delete rule (§3).

### Agent 14: licensor batch pre-flight (read-only)
- Produced the B7/B9 run plan and found the guard deadlock that #798 then fixed.

### Agent 15: B3 stage and run
- **Actually did:** staged B3 fully. **Production UNCHANGED at 381** — it was
  blocked at the model-review step, which never produced a verdict (§4).
- **Its staging is proven and reusable.** The exact allowlist string, verbatim:

  ```
  20260729230000,20260729234500,20260729235500,20260730000500,20260731150000,20260731153000,20260731163000,20260731180000,20260731190000,20260731200000
  ```

### Agent 16: model review fix → PR #803 (`4645191`)
- Chunked the batch so the review could run. Also fixed #737's UA-less `urllib`
  POST — but inside `scripts/production_apply_model_review.py`, **the very file
  #806 then deleted**. The fix is gone with the file.

### Agent 17: remove the paid review → PR #806 (`9645709`)
- Removed `production_apply_model_review.py` and its test; added
  `production_apply_review_reference.py` and its test; updated `AGENTS.md`, the
  contract, the workflow and the guard test. The lane now requires a
  **`review_reference`** instead of calling a paid model.

### Agent 18: B3 review → PR #807, OPEN
- Verdict **CONCERNS**. Merged as part of this closeout so the eventual B3 apply
  can cite it. Substance is in §6, issue 1.

---

## 3. Findings that must not be lost

### 3.1 "A batch cannot leapfrog another" was FALSE — and is now corrected

The contract used to claim a batch is necessarily a contiguous version-ordered
slice because `supabase db push` applies in version order and so "cannot
leapfrog". **That is wrong**, and the production lane does not work that way.

`prepare()` computes `keep = remote | set(allowlist)` and then **deletes every
migration file outside that set**. Version order constrains only what survives
the filter. Measured:

- **75 of 133 unapplied migrations can each be allowlisted ALONE** and pass both
  guards.
- `20260810180000` passes with **126 earlier unapplied migrations still pending** —
  and indeed it is now the highest applied version with 46 unapplied below it.
- `validate_candidates` contains **no ordering check at all**.

**Batch order is POLICY, not mechanism.** Only two edges are mechanically
enforced anywhere:

1. **B4 needs `core.normalize_popsg_property_observation`** from
   `20260731150000`.
2. **`20260810080000` asserts exactly 16 SELECT and 15 INSERT grants**, which
   `20260811070000`'s 17th NBCU table would break.

The correction is written into
`docs/production-promotion-app-tolerance-contract.md` (§5A.5 and the summary at
~line 1130), superseding the old claim in place rather than erasing it.

### 3.2 Absence from a scrape must NEVER cause a delete

All three licensor scrape sessions independently confirmed they **cannot
distinguish "deleted at source" from "missed by this scrape"**, and no field
exists in any of the three feeds to tell them apart. Verified across all
**nineteen** licensor migrations: zero violations today. Now written down in
`docs/licensor-source-shape-decisions-20260811.md` so it stays that way.

### 3.3 NOT KNOWN is not NO

Disney and Paramount could **not** confirm identifier stability or uniqueness.
The schema must stay **permissive** wherever they are unsure. Do not add a unique
constraint on the strength of "it looks unique in the sample".

### 3.4 Three real bugs, all found by REPRODUCTION

None of these would have surfaced from reading a diff:

1. The `PUBLIC` key-case mismatch that read a **failed revoke as green**.
2. Two successive no-op-check **bypasses**.
3. The `advanced_at = now()` cursor bug reporting progress a stuck worker had
   not made.

**Run the thing. A code-trace is not a verification.**

### 3.5 Two red X's were infrastructure flakes

Both were `actions/checkout` TLS failures that never reached a test. Before you
act on a red check, look at the run's **`head_sha`** AND at **what actually
failed**. A red X on a stale SHA, or in a step before the tests, is not a result.

---

## 4. MANDATORY — what we tried that did NOT work

### 4.1 Patching the `do`-block no-op accept path. Three rounds, three bypasses.

The goal was to let `production_catalog_verification.py` accept a `do` block as a
declared no-op. Each patch was defeated, each time by something one token further
along than the last:

1. **Statements after the first `;`** in a payload.
2. **`execute <static literal> || <anything>`** — the literal satisfies the
   check, the concatenation carries the payload.
3. **`update pg_class set relacl = ...`** — a *privilege* change wearing a data
   statement's clothes. No deny-list catches this, because it is syntactically a
   plain `UPDATE` on a table.

**Ruling: STOP patching the deny-list.** A deny-list over arbitrary PL/pgSQL is
not a winnable game. **PR #804 must first argue for a narrow ALLOW-list** — an
explicit set of permitted statement shapes — before another line is written. Do
not resume patching. If you find yourself writing a fourth deny rule, you have
missed this section.

### 4.2 The paid model review — the whole thing

It produced **one substantive verdict in its entire life**, and that verdict was
never independently confirmed. Then it **blocked B3 completely**:

`max_tokens` caps thinking tokens **plus** output text. At 4000 the model spent
the entire budget thinking and returned **no text block at all**. The extractor
kept only content of `type == "text"` and therefore got `""`. Six identical
failures in a row. PR #803 fixed it by chunking; PR #806 then **deleted the whole
mechanism** by owner decision. The account also ran out of credit mid-session.

Two transferable lessons: `max_tokens` is a *total* budget including thinking; and
an extractor that filters by content type must fail **loudly** when it filters
everything away, never return `""`.

### 4.3 `--allocate-version` on the collision script does not work

It exits **2** and never reserved anything. Every version this session was
assigned **manually by the orchestrator**. Do not trust the flag.

### 4.4 Codex is broken on this machine

Repeatedly: *"the Windows sandbox helper is missing"*. GLM worked, but **GLM had
no execution tool** — its reviews were code-traces, not verification.

**Do not record "independently reviewed" when the reviewer could not run
anything.** Say "code-traced by GLM, not executed". Given §3.4, the distinction
is the whole ballgame.

### 4.5 A false no-op declaration on `20260807030000` was attempted, and refused

Correctly. Its body is one `do $coco$` block — exactly the shape the check
rejects. There is no honest declaration to write. See §6 issue 6.

---

## 5. What is outstanding

Every item below has its own open GitHub issue, opened as part of this closeout
and labelled `db-work`. This file holds the detail; the issues hold the pointer.
That direction is deliberate — never duplicate the detail into an issue, because
duplicated detail drifts.

1. **[needs-albert] B3 is reviewed CONCERNS and awaits a fix-first decision.**
2. Run the promotion sequence **B3 → B4 → B6 → B7 → B8 → B9, then B10a–d.**
3. **[needs-albert] B5's two outstanding verification steps.**
4. **NBCU has no supersede path.**
5. **Disney: `dam.style_guide_file.style_guide_id` FK, and the OPA selector columns.**
6. **`20260807030000` will hard-fail a correct apply in B7.**
7. **Carry forward #737 item 4** — the `urllib` User-Agent sweep.
8. **[needs-albert] Three Paramount titles appear in the public repo.**
9. **[needs-albert] Paramount `PMT_PORTAL_GLOBAL_ASSET_COUNT`.**
10. **[needs-albert] The Paramount capture is incomplete.**
11. **Preview and production have drifted.**
12. **B10c is atomic by declaration but enforced by nothing.**

---

## 6. Detail behind the outstanding items

### 6.1 B3 — reviewed CONCERNS, fix-first recommended [needs-albert]

Verdict lives in PR **#807**, file
`.ai/reviews/20260811-batch-b3-production-apply.md`.

**The orchestrator recommends fixing the TRUNCATE grant BEFORE applying B3.**
The batch grants `service_role` the TRUNCATE privilege on four tables. Three of
them are **append-only**, and their append-only property is defended **only by
row-level triggers**. **TRUNCATE fires no row triggers.** So the grant hands
`service_role` a one-statement path straight through the only defence those
tables have.

The scale of the change is worth seeing plainly: `service_role` currently holds
TRUNCATE on **zero** tables in those schemas. This grant is not an extension of an
existing posture; it creates one.

The **three null-permissive guards in `20260731150000`** are a lesser matter and
can be fixed forward. The pattern is `if not ( … or auth.role() = … )`, which
never fires when `auth.role()` is NULL — as it is inside a migration. They are
**not reachable from a browser session** and `anon` cannot execute them, so the
exposure is bounded.

**B3's proven allowlist string, verbatim:**

```
20260729230000,20260729234500,20260729235500,20260730000500,20260731150000,20260731153000,20260731163000,20260731180000,20260731190000,20260731200000
```

### 6.2 The promotion sequence

**B3 → B4 → B6 → B7 → B8 → B9, then B10a–d.** Owner approved running it batch by
batch with a **gate click for each**. Note that the lane changed under you this
session: after #806 it requires a **`review_reference`**, and the review itself is
now performed **in Claude Code**, not by a paid API call.

### 6.3 B5's two outstanding verification steps [needs-albert]

The §7.1 application smoke test, and acknowledging one taxonomy alert as a
**NON-administrator**. Both need application logins or a `service_role` write.

**Why this matters more than it looks:** B5 exists in the first place because a
guard once installed perfectly cleanly and then never fired. "It applied without
error" is precisely the evidence that failed last time.

### 6.4 NBCU has no supersede path

NBCU captures are full replacements, and §3.2 forbids treating absence as
deletion — so today there is no way to retire a row that really did go away. A
design exists in PR #799's document **for NBCU only**. Disney and Paramount
re-capture semantics are **NOT KNOWN**, so do not generalise it to them.

### 6.5 Disney — two forward migrations

- A **nullable** `style_guide_id` FK on `dam.style_guide_file`. That table is
  shared and **PopDAM reads it**, so the column must be nullable and additive.
- The **OPA selector columns**: `regionName`, `templateId`, `workflowId` — issue
  **#582**.

Both must be **new forward migrations**. OPA's batch **B7 is ATOMIC**, so its
existing files cannot be edited.

### 6.6 `20260807030000` blocks B7

No derivable target and no legal no-op declaration (§4.5). It will **hard-fail a
correct apply** in B7. B7 is blocked until #804 lands a design or another remedy
is chosen.

### 6.7 #737 item 4 — never done

Sweep `scripts/` and `.github/` for any other `urllib` caller with **no
User-Agent**. Items 1–3 of #737 died with the file #806 deleted; item 4 is
independent of it and was never carried out.

### 6.8 Three Paramount titles in the public repo [needs-albert]

`docs/licensor-source-shape-decisions-20260811.md`, around **line 95**, names
Garfield, Invader Zim and The Garfield Movie — while the same document claims no
licensor title is reproduced.

**Nothing new is exposed:** those three titles are already in `main` from the
Coldlion exports. The problem is that the **blanket claim is inaccurate**, and an
inaccurate blanket claim is what stops the next reader checking. Two options:
correct the claim, or remove the three names.

### 6.9 Paramount `PMT_PORTAL_GLOBAL_ASSET_COUNT` [needs-albert]

Blocks the **data load only**; no schema impact. **Do not sum the brand facets** to
derive it — **223 assets carry two brands** and would be double-counted.

### 6.10 The Paramount capture is incomplete [needs-albert]

Garfield, Invader Zim and The Garfield Movie were **never captured** — roughly
**8,076 assets**. The owner has already reassigned the re-scrape. This is the
database-side note only; do not start scraping.

### 6.11 Preview and production have drifted

Four licensor migrations on preview, one on production. Preview's true state was
never fully established (§1). Establish it with the **CLI**, not the MCP.

### 6.12 B10c is atomic by declaration only

The contract declares B10c atomic; **nothing in the guard enforces it**. Relates
to issue **#784**.

---

## 7. Secrets

**Swept — the session, the diff, and untracked files. Nothing new to store.**

One thing to record, as an **owner decision** rather than an oversight: the repo
secret **`ANTHROPIC_API_KEY`** (added 2026-08-11T18:32Z) now has **zero
consumers** after PR #806 deleted the only script that read it.

**Do NOT delete it and do NOT rotate it.** The owner explicitly declined to
investigate whether PopDAM shares the underlying key, so the blast radius of
touching it is unknown by choice.

No credential value appears in any file, commit, issue or report from this
session. Credentials are referenced by 1Password item ID only.

---

## 8. Worktrees and things deliberately left

**21 registered worktrees** at 2026-08-12T0056Z — far fewer than the ~55 an
earlier note feared. Issue **#682** tracks the standing cleanup backlog; add to it
rather than opening duplicates.

**Nothing was deleted during this closeout.** The deletion rules are narrow on
purpose: a worktree is never removed if it is dirty, locked, or held by a live
process, because uncommitted work in a worktree is the only copy of that work.
`.claude/worktrees/b10-contract` held a **253-line uncommitted draft** earlier in
this very session, and an agent found and used it.

Deliberately left, each one a **decision**:

- **Draft PR #804** (`fix/790-noop-do-block-accept`) — parked pending the design
  ruling in §4.1. **Do not resume patching the deny-list.**
- **`.claude/worktrees/issue-727-design`** — **LIVE.** Holds the #727 order-list
  import design. **Do not delete.**
- **`.ai/reviews/*.md`** — second-opinion reports kept as review evidence. These
  are **tracked in git**, not stray untracked files; PR #807 adds another.
- **`C:\tmp\wt794`** — on disk, **deregistered from git**, possibly held by a hung
  Codex process. Reported, not force-deleted.

---

## 9. Facts here that may already be stale

Assume everything below has moved and re-derive it from `git` / `gh` / a live
query. Do not rank documents against each other; re-measure.

- Every SHA, every count, every PR and issue state in this file.
- `origin/main` (`9645709…`) — may have moved.
- The ledger count (**381**) and the highest applied version
  (`20260810180000`) — the very next promotion run changes both.
- **Preview's true contents** — never fully established, and the least
  trustworthy claim in this document.
- The worktree list.

**The rule that outlives every number above:** the ledger is applied out of
order. Ask "is this exact version a row?", never "is it below the max?".
