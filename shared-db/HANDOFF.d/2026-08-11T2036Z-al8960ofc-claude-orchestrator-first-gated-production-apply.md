# Orchestrator handover — session `shared-db-orchestrator-1067a1` (RESUMED ROUND), al8960ofc, 2026-08-11

**This is the SECOND handover from one session.** The first
(`HANDOFF.d/2026-08-11T1850Z-al8960ofc-claude-orchestrator-production-lane-made-real.md`,
PR #786) closed the session cleanly at 18:50Z. The owner then gave further instructions in
the same conversation, so the session was **resumed under a new marker (#789)** rather than
started fresh.

**Read the 18:50Z file FIRST.** It carries the full picture: how the production lane was
three faults deep, the environment map, the twelve sub-agent blocks, and eight things that
did not work. **This file appends only what happened after 18:50Z. It does not replace it.**

**One-sentence summary:** the first gated production apply in this repo's history ran, the
migration is verified live, and its job shows a red X that is a false negative.

---

## 0. Facts, re-derived at write time — RE-DERIVE THEM AGAIN

Checked **2026-08-11T20:36Z**. Per `AGENTS.md` §4.3 these are **snapshots**, not truth.

```bash
git fetch --all --no-prune
git rev-parse origin/main
git ls-tree origin/main --name-only supabase/migrations/ | wc -l
gh pr list --repo u2giants/shared-db --state open
gh issue list --repo u2giants/shared-db --label db-work --state open
gh issue list --repo u2giants/shared-db --label db-claim --state open
```

| Fact | Value | Checked |
|---|---|---|
| `origin/main` tip | `f4727bdcf3951e85e3ef571b8b15e952c599a1d5` | 20:36Z |
| Migration files on main | 433 | 20:36Z |
| Max migration version | `20260811070000` | 20:36Z |
| Duplicate versions | **none** | 20:36Z |
| Open PRs | **0** | 20:36Z |
| Open `db-claim` locks | **0** | 20:36Z |
| Open `db-work` issues | 115 | 20:36Z |
| Open `needs-albert` issues | 23 | 20:36Z |
| Orchestrator marker | **#789** — closed at the end of this handover | 20:36Z |

**Production `qsllyeztdwjgirsysgai`: 377 applied** (was 376), **56 unapplied** of 433.
**Preview `rjyboqwcdzcocqgmsyel`:** not re-read this round; last known CLEAN at 426 applied.
**Treat preview as UNKNOWN** — nothing in `git` can tell you, and hours have passed.

**MERGE FREEZE IS LIFTED.** It was in force only while run 31532843298 was pinned to a SHA.
That run has completed. Merging is safe again.

---

## 1. THE HEADLINE — the first gated production apply, and it worked

Migration **`20260810180000`** is **APPLIED to production and VERIFIED**. Run:
https://github.com/u2giants/shared-db/actions/runs/31532843298

**The job shows a red X. The apply succeeded.** Read §2 before reacting to it.

### How it was verified — two ways, because a ledger row is not proof
- **Ledger:** 376 → **377**, and `20260810180000` present by **per-version set membership**.
  Not by high-water mark — production's ledger is applied out of order, so a maximum proves
  nothing.
- **Behaviour, which outranks the ledger.** `pg_default_acl` for `(plm, postgres, 'r')` is now
  exactly `{service_role=arwd/postgres}`, **was `{service_role=arwdDxtm/postgres}`**. The
  uppercase **`D` (TRUNCATE) is gone**, with `x`, `t` and `m`. This matters because TRUNCATE
  **fires no row triggers** and walked past every immutability guard in the schema, and every
  new `plm` table was born holding it. B7, B8, B9 and B10 all create new `plm` tables and now
  inherit the narrowed default.
- The migration's own assertion fired and did **not** skip:
  `NOTICE: D2 OK: plm default privileges for tables are now {service_role=arwd/postgres}`.
  Sections A, B and D1 logged their expected WARNING skips (no `plm.pmt_*` / `plm.nbcu_*`
  tables exist in production yet) — the intended prevention path for #664/#649.

This was also **the first production apply ever to carry a real model verdict** beside the
owner's approval click. Everything before it was approved beside a green job that meant nothing.

### The gate chain that produced it
The owner added a fourth gate: *"Apply `20260810180000` if GLM 5.2 approves it."* GLM
returned **APPROVE WITH CONDITIONS**. A verifying agent then found **GLM's first condition
factually wrong** — it claimed later create-migrations might re-grant the removed bits, but
`20260810020000:1148` grants only `select, insert, update, delete` and `20260810070000:1148,1150`
are narrower still. GLM had guessed from a header comment instead of reading the files. Second
condition accepted as real but low risk. **Verify a reviewer's findings; do not relay them.**

---

## 2. ⚠️ THE RED X — do NOT "fix" it by softening the rule

The failure is in **Post-apply catalog verification**, which runs *after* a successful apply:

> the allowlisted migrations named no catalog object this lexer can read … it means THIS STEP
> PROVED NOTHING, so enforcing mode fails rather than letting a green tick stand in for
> evidence it never gathered.

Derived targets: tables 0, views 0, functions 0, rls_relations 0, seeded 0.

**Why:** the step derives targets with a conservative lexer over the migration text, and its
own printed caveat says objects named via **`alter default privileges`** (and `execute
format(...)`, quoted/mixed-case identifiers, search_path-relative names) are **"NOT listed and
NOT checked"**. This migration is `alter default privileges` plus conditional revokes. The
lexer honestly found nothing; enforcing mode honestly refused to show green.

**That behaviour is CORRECT.** It is the exact discipline this session was spent building,
after three stacked faults in the review lane were each hidden by a green tick earned by
nothing. **Do not turn off enforcement, add a bypass flag, or special-case a migration id.**
The fix is to teach the lexer to derive `pg_default_acl` / `relacl` / `proacl` targets so it
can actually verify this shape. Filed as **#790**.

**THIS WILL RECUR.** Every grant / revoke / privilege-only migration hits the same wall, and
several are queued in B3–B10. Each will fail a correct apply and force someone to tell a false
negative from a real one **under promotion pressure**, which is when mistakes get made. **Fix
#790 before the next promotions.**

Related blind spot named in the same caveat and worth its own attention: `acl_is_default = true`
means `proacl` is NULL, which **for a function is `EXECUTE` to `PUBLIC`** — the state a missing
revoke leaves behind, *not* "no grants". It reads as safe and is not.

---

## 3. Owner rulings this round

1. **"Apply `20260810180000` to production if GLM 5.2 approves it."** GLM approved; conditions
   discharged; staged; owner approved through the `environment: production` gate. **Done.**
2. **"Accept today's sheet"** — SUPERSEDES the earlier ruling that the 2026-08-09 export was
   authoritative. See §4; this one has a cost that has not yet been paid.
3. **Investigate the orphan `designflow` schema** (read-only). **Done** — see §5.
4. **"Delete the two dead Anthropic keys."** **Done** — see §6.
5. **Disregard the licensed workbook copies in `Downloads`.** Noted; no action taken.

---

## 4. ⚠️ #727 — the ruling reversed, and the work it requires is NOT DONE

The owner supplied `C:\Users\ahazan2\Downloads\OrderList.xlsx`
(10,679,199 bytes, modified 2026-08-11 16:16,
**SHA-256 `68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe`**)
and ruled **"accept today's sheet."** That file is **NOT** the approved 2026-08-09 export —
the hash differs from `4958b4b7…`. The mismatch was surfaced to the owner **before** any load
was attempted, and he chose to adopt the new source.

**Nothing has been imported. The re-profile was NOT dispatched.** All of this must land in a
PR **before** any import runs:

1. **New `APPROVED_SOURCE_SHA256`** in `scripts/import-order-list-xlsx.py` — the value above.
2. **A fresh Phase 0 profile** of the new workbook: row counts, column inventory, value domains.
3. **New baseline numbers for the eight conditional count assertions.** ⚠️ **This is the
   dangerous one.** Those assertions fire *only* when the workbook hash matches the approved
   constant. Change the hash without rebuilding them and they **silently stop asserting** — a
   green run that checked nothing. That is precisely the silent-failure shape this whole
   session was spent removing. **Do not change the hash without doing item 3 in the same PR.**

**Still unexplained: the sheet shrank by five rows (12,328 → 12,323).** The owner chose to
proceed without knowing why. **Whoever runs the re-profile should identify the five missing
rows** — the comparison is nearly free while both row sets are in hand.

**Unchanged constraints:** PREVIEW ONLY (`rjyboqwcdzcocqgmsyel`), never production — the
importer hard-depends on `20260810060000` (NULLS DISTINCT), which is on preview and **NOT on
production**; pointed at production, the second order insert dies on `duplicate key (null, null)`.
It creates **no database objects** (all DDL shipped in `20260810010000`, `20260810060000`,
`20260810100000`), so **no migration version and no collision claim are needed**. The checksum
stays a **hard gate** — it is being re-pointed, not relaxed. `matched` will read **0** because
`plm.item` is empty; the real signal is `resolution = unique`. The workbook is **licensed data**
— never commit it, never paste it into an issue.

---

## 5. #778 — the orphan schema is a duplicate, except for ONE row

Read-only investigation, owner-approved. Comment:
https://github.com/u2giants/shared-db/issues/778#issuecomment-5258440494

| Table | Rows | Same as Cloud SQL production? |
|---|---|---|
| `Factory` | 175 | same rows; production edited since |
| `Roles` | 5 | identical (md5) |
| `art_piece` | 1114 | subset of production's 1392 — **one exception** |
| `artists` | 14 | identical (md5) |
| `comments` | 13 | identical (md5) |
| `customers` | 57 | identical (md5) |
| `product_category` | 7 | identical (md5) |

- **The only unique datum in the entire schema is `art_piece.id = 790`** — one art record,
  deleted from production *after* this snapshot was taken. Everything else is accounted for.
- **Never written to after creation.** Zero updates, zero deletes, ever; inserts equal live
  rows. One bulk load, frozen. Newest content timestamp 2026-07-10 — a week before the
  startup-DDL pattern was retired.
- **Nothing reads it.** Last real scan 2026-07-14; the only recent activity is this audit.
- `art_piece` is **genuine business data**, not test or seed: 7 licensors, 53 properties,
  Feb–Jul 2026. It references 48 artist ids while its own `artists` table holds 14 rows,
  proving it is a partial copy lifted from a larger system.
- Supabase `dflow` is the **older** copy, not a safe home — the orphan is strictly newer in
  every comparison.

**⚠️ Name collision, restated because it has already misled plans:** `designflow` is *also*
the schema DesignFlow **production** uses — but on **Cloud SQL**, a different database. The
orphan is on **Supabase**. Unrelated despite the identical name.

**Next steps, in order, and BOTH need the owner:**
1. **Preserve `art_piece.id = 790`** somewhere durable. It is the only copy left.
2. Only then may the schema be dropped, and **only** on the owner naming the exact schema and
   the exact action. A drop is irreversible and is an explicit owner gate. **Nothing was touched.**

**UNPROVEN:** Cloud SQL `designflow_dev` and `designflow_sandbox` exist but are unreadable
with the current credential; their contents are unknown.

---

## 6. Secrets sweep — DONE

**The two revoked Anthropic keys are DELETED**, on the owner's explicit instruction. Both
re-verified **401** immediately before removal. Fields `anthropic` and
`anthropic_popdam_shared_supabase` removed from item `ai-provider-api-keys`
(`3onekcbg3dxnazpnt36d4yzfcq`, vault `vibe_coding`); field count 16 → 14. **The item itself was
not deleted or archived**, and no other provider field was touched (`openai`, `gemini`,
`deepseek`, `dashscope` and the `*_popdam_shared_supabase` variants all remain).

**Nothing referenced them at runtime.** The only hits in `C:\repos` are historical records:
`popdam3/fix_admin_config_secret_rotation.md` (a rotation log listing them as pre-rotation
backups) and the previous handoff file. That rotation-log pointer is now **stale** but is a
historical record, not config, so it was left alone.

A dated note was appended to the item recording what was removed, that both were verified
revoked first, that the live key lives in item `5uq6z66ibusmypkvnl276ta22e` field `credential`
and is installed as the `ANTHROPIC_API_KEY` repository secret, and that removal was on the
owner's instruction — so no future session wonders whether a credential went missing by accident.

**Untouched and confirmed:** item `5uq6z66ibusmypkvnl276ta22e` was never opened, and the
`ANTHROPIC_API_KEY` repository secret was not modified. **Nothing rotated.**

**No other secret surfaced this round. Swept, one deletion, nothing new stored.**

---

## 7. Per sub-agent — this round

### Agent: GLM reviewer of `20260810180000` (read-only)
- **Asked:** be the owner's fourth gate on a single production migration.
- **Did:** GLM 5.2 returned APPROVE WITH CONDITIONS; the agent verified both conditions itself.
- **Found:** **GLM's Condition 1 was factually wrong** (see §1). Verified live on production
  before the apply: `pg_default_acl` was exactly one row `{service_role=arwdDxtm/postgres}` owner
  `postgres`; `landing_tables` = 0; PostgreSQL **17.6**, so the `m` bit is real. Hand-checked
  D2's regex: after the narrowing the ACL reads `service_role=arwd/postgres`, and
  `service_role=[a-zA-Z]*[Dxtm]` finds no match because `[Dxtm]` is **case-sensitive** — the
  surviving lowercase `d` (DELETE) is not the uppercase `D` (TRUNCATE). So D2 asserts truthfully
  and **cannot pass vacuously**.
- **Deliberately did NOT:** apply anything, or accept GLM's conditions without checking.
- **Worktree:** none. Finished. Left an untracked report at
  `C:\repos\shared-db\.ai\reviews\glm-prod-apply-20260810180000-review-20260811T202140Z.md`.

### Agent: production apply stager
- **Asked:** stage the single-migration apply; **do not approve it.**
- **Did:** proved the target ref; pinned `f4727bdcf3951e85e3ef571b8b15e952c599a1d5`; confirmed
  no PR open (merge freeze); confirmed the migration unapplied **twice**, two different ways;
  ran the guard preflight (`PREFLIGHT OK: 1 migrations, no missing non-deferrable dependency`,
  exit 0); dispatched the run; stopped.
- **Deliberately did NOT:** approve, poll, or nudge the run. Correct — the reviewer gate is the
  owner's and an agent that can self-approve is a finding, not a convenience.
- **Worktree:** none. Finished.

### Agent: post-apply verifier (read-only)
- **Asked:** did it actually apply, or not.
- **Did:** **APPLIED**, proven by ledger membership *and* the live ACL (§1). Read the run log and
  separated the apply step's conclusion (success) from the verification step's (failure).
- **Found:** the red X is a **legitimate false negative**, and it **will recur** for every
  privilege-only migration.
- **Deliberately did NOT:** re-run the workflow, re-apply, or edit the verification step.
- **Worktree:** none. Finished.

### Agent: orphan schema investigator (read-only)
- **Asked:** does the orphan's data exist anywhere else.
- **Did:** §5. Reached Cloud SQL via the purpose-built `albert_read_only` credential.
- **Deliberately did NOT:** touch, drop or modify the schema; did not preserve row 790 (not
  authorised, and preservation is an owner decision).
- **Worktree:** none. Finished.

### Agent: 1Password key deletion
- **Asked:** delete the two dead Anthropic keys.
- **Did:** §6. Re-verified both dead first, and swept `C:\repos` for live references before
  removing anything.
- **Deliberately did NOT:** delete the parent item, rotate anything, or touch the live key.
- **Worktree:** none. Finished.

### Agent: #782 triage (read-only)
- **Asked:** triage an untriaged `HANDOVER:` issue that arrived after the session-start sweep.
- **Found:** it is a **REQUEST, not a handover** — nothing built, **no database touched**, no
  branch/PR/worktree/migration references it. App-side work is real and separate
  (`u2giants/popcrm-web` @ `5191d35`). Seven of nine required handover questions answered;
  **"what I tried that did NOT work" and "facts that may be stale" both absent.**
- **Verdict:** ready to dispatch. **⚠️ It orders a Kimi K3 review loop — do not let an agent
  hard-code a reviewer model.** A pinned model id that did not exist is exactly what this
  session spent hours fixing.
- **Worktree:** none. Finished.

---

## 8. What we tried that did NOT work — this round

1. **Assuming a red job means a failed apply.** It did not. **Always separate the apply step's
   conclusion from the post-apply verification's** before concluding anything about production.
2. **Trusting the reviewer.** GLM's Condition 1 was wrong on the facts, and it had guessed from
   a header comment rather than reading the two files it was reasoning about.
3. **Trusting a supplied file because it was supplied.** The workbook was fingerprinted before
   anything else and turned out not to be the approved export. **Hash first, always** — that one
   check is what turned a silent wrong-data load into an owner decision.
4. Carried forward from the 18:50Z file and still true: `ls supabase/migrations/` lies (the
   shared checkout is parked on `pr717b`); `gh pr merge --auto` is disabled on this repo;
   `gh pr update-branch` re-triggers every check, so budget a full CI cycle.

---

## 9. Outstanding — every item has an open issue

**Waiting on Albert (`needs-albert`):**
- **#778** — preserve `art_piece.id = 790`, then name the exact schema and action if he wants
  the orphan dropped.
- **#727** — the re-profile is unbudgeted work he should know about before it starts (§4).
- Plus the 23 open `needs-albert` issues inherited and unchanged, indexed imperfectly by #736
  (**#736 is stale and incomplete — do not rely on it**).

**Ready to dispatch, no decision needed:**
- **#790** — teach the catalog verifier to read privilege-only migrations. **Do this before the
  next promotions** (§2).
- **#788** — the four unbatched leftovers, still unreviewed. The first real model review already
  returned CONCERNS on `20260811070000`.
- **#784** — enforce §6 never-rest states for the non-atomic batches.
- **#785** — nothing proves the review model id is real until an apply fails on it.
- **#782** — the PopCRM Outlook cursor contract, triaged and ready.
- **#727** — the re-profile itself (§4).
- **#773 / #710** — batches B3–B10 minus the now-applied `20260810180000`.
- **#682** — 53 worktrees. A ready-to-paste prompt was given to the owner directly; it is not
  in the repo.

---

## 10. State left behind — every item is a decision

- **Open PRs: 0. Open `db-claim` locks: 0. Merge freeze: LIFTED.**
- **Preview: UNKNOWN.** Last known clean at 426 applied, hours ago. Re-read it before writing.
- **53 worktrees**, unchanged — deliberately not addressed, tracked as #682.
- **Untracked GLM review artifacts** remain, kept as review evidence:
  `.ai/reviews/glm-prod-apply-20260810180000-review-20260811T202140Z.md`,
  `glm-pr779-model-review-must-run-20260811T161653Z.md`,
  `glm-pr781-atomic-batches-guard-20260811T183741Z.md`,
  `glm-orderlist-727-idempotent-import-design-20260811T160024Z.md` (in `issue-727-design`),
  plus the pre-existing `glm-gate-611-atomicity-pg17-20260810T170046Z.md` and
  `.ai/deepseek-sessions/`. Keep or delete — not this session's call.
- **`issue-727-design` worktree is LIVE:** branch `docs/727-orderlist-import-design` (`824eee5`),
  pushed, **no PR**. Holds the #727 design. **Do not delete.**
- Licensed workbook copies remain in `C:\Users\ahazan2\Downloads\` — the owner explicitly said
  to disregard them.

**Docs pass:** nothing outside this handover is stale. The apply is recorded on #773; the
lexer gap is #790; the #727 reversal is recorded on #727 with the earlier ruling left intact
as the audit trail.

---

## 11. If you read only one thing

`20260810180000` is applied and production is consistent. **Do not re-run it, and do not react
to the red X by weakening the verification step** — fix **#790** instead, before the next
promotion, or the next person will be asked to tell a false negative from a real one while
under pressure to ship.

Then: `20260810180000` is only the first file of B10. **B5 is the recommended next batch**
(function-only, no DDL, no data, independent), then **B3 → B4** in that order, then B6, B7, B8,
and **B9 last**.
