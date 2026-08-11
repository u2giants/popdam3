# Orchestrator handover — session `shared-db-orchestrator-1067a1`, al8960ofc, 2026-08-11

**Read this whole file before you touch anything.** It is written for a developer who
walked in this morning knowing nothing about this repo, this database, or this session.

**One-sentence summary:** the production apply lane had a review step that could not
fail, calling a model that does not exist, guarding batches whose atomicity it did not
know about — all three are now fixed and merged, and the eight-batch production backlog
is unblocked for the first time.

---

## 0. Facts, re-derived at write time — RE-DERIVE THEM AGAIN BEFORE YOU ACT

Every number below was checked at **2026-08-11T18:47Z**. Per the new `AGENTS.md` §4.3
(added this session), these are **snapshots**, not truth. Re-run the commands.

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
| `origin/main` tip | `90166383bca10de71b297b4f0603998743353bb7` | 18:47Z |
| Migration files on main | 433 | 18:47Z |
| Max migration version | `20260811070000` | 18:47Z |
| Duplicate 14-digit versions | **none** | 18:47Z |
| Open PRs | **0** | 18:47Z |
| Open `db-claim` locks | **0** | 18:47Z |
| Open `db-work` issues | 116 | 18:47Z |
| Orchestrator marker | issue **#777** — closed at the end of this handover | 18:47Z |

**Production ledger (live read, 2026-08-11):** **376 applied / 57 unapplied** of 433.
The previous handover said 53. It was wrong by 4; arithmetic now closes exactly
(54 across batches B3–B10 + 4 unbatched leftovers + 1 retired + 2 held = 57).

**Preview `rjyboqwcdzcocqgmsyel`:** **CLEAN.** 426 applied, lagging main by 7 migrations.
**Zero** versions applied on preview that have no file on main — no foreign or unmerged
rehearsal is sitting on it. This is unusual and worth knowing: preview is almost never
clean, and the next session gets a real baseline. It will not stay that way.

---

## 1. ⚠️ THE TRAP THAT WILL MISLEAD YOU FIRST

**Production's migration ledger is applied OUT OF ORDER.** The maximum applied version
is `20260810140000`, yet **48 of the 57 unapplied versions sort BELOW it**. Four versions
leapfrogged everything: `20260731230000`, `20260802194000`, `20260802194100`, `20260810140000`.

**Consequence: the "max applied version" is meaningless on this database.** Reasoning
from the high-water mark will tell you 48 migrations are live when they are not. The only
valid test is per-version set membership. Any document you find that reasons from a
maximum is wrong, including older handovers.

**Second trap, cheaper but it already bit twice today:** never run
`ls supabase/migrations/`. The shared checkout `C:\repos\shared-db` is parked on a
different branch (`pr717b`), so `ls` silently reports the wrong branch's files. My own
session-start figure was wrong for exactly this reason. Always
`git ls-tree origin/main --name-only supabase/migrations/` after a fetch.

---

## 2. What this session shipped — 4 PRs, all merged

| PR | What | Merged |
|---|---|---|
| **#780** | `AGENTS.md` §4.3 — the new standing rule (below) | 16:25Z |
| **#779** | A skipped production apply model review now **fails the job** | 18:19Z |
| **#781** | The guard mechanically enforces the contract's **four atomic batches** | 18:4xZ |
| **#783** | The review's model id was not a real model — fixed and made configurable | 18:4xZ |

### PR #780 — the standing rule (owner instruction)
Albert: *"Create a standing rule that issues point at the live reading."* Added as
`AGENTS.md` §4.3, placed between §4.2 and §5 so a session meets it before it can trust a
stale number. In substance: **state the COMMAND that yields a figure, never the figure.**
Where a number must appear, stamp it with the time and source and mark it re-derivable.
It names both traps in §1 above.

### PR #779 — the review step could not fail
`scripts/production_apply_model_review.py` had **three `return 0` statements and zero
`return 1`**. No code path could exit non-zero. On top of that the workflow step carried
`continue-on-error: true`. **And a test in the repo actively asserted this shape** —
`test_the_model_review_is_advisory_and_cannot_block` required `continue-on-error: true`
to be present and `return 1` to be absent. The repo had locked the silent failure in.

Now: the **verdict stays advisory** (a model still cannot block or approve a production
write — CLEAR, CONCERNS and UNREADABLE all exit 0), but the review **running** is
mandatory. Missing key, empty allowlist, API failure after 3 retries, empty response, or
**truncated input** all exit non-zero, the job goes red, and `production-apply` never
reaches the approval gate (`needs:` with no `always()` — verified, no leak path).

The truncation case was found by the independent review and is the subtle one:
`collect_sql` used to stop at `MAX_SQL_CHARS = 400_000` with a bare `break`, so
migrations past the cut were invisible to the model and it could still answer CLEAR.
Three migrations in this repo are 161KB, 136KB and 123KB — a single batch crosses 400K
on its own. It now `fail()`s **before the API call**, naming every unsent migration.
Deliberately chosen over forcing CONCERNS, because CONCERNS still exits 0 and a green
job on a partial review is the very defect the PR existed to remove.

### PR #781 — batches that must move as one, now enforced
`docs/production-promotion-app-tolerance-contract.md` declares **B1, B3, B7 and B9**
atomic. `production_migration_guard.py` did not know that. An allowlist containing only
`20260810050000` (a B9 member) **passed the guard** while splitting the batch — the exact
shortcut that would have launched #729 early and rested production in the Warner window,
where confidential STARLABS data is readable by every authenticated account. A previous
agent spotted the shortcut, recognised it as guard-legal and contract-illegal, and
refused it. The next agent under launch pressure might not have.

Generalised the existing `BUNDLE_20260804` into an `ATOMIC_BATCHES` table rather than
adding a parallel system. **The check reads the production ledger on purpose** — required
membership is `members - already_applied`, so the only legal recovery allowlist after a
batch dies mid-run is not refused, which would otherwise force someone to edit the safety
guard at 2am while production sat exposed.

### PR #783 — the model did not exist
Once #779 made a non-running review fatal and the key was installed, the review ran for
the first time ever and returned **HTTP 404**. `MODEL = "claude-opus-4-5-20260514"` has
**never been a real model id**. It survived in the repo precisely because the review had
never run. Corrected to `claude-opus-4-5-20251101`, moved behind `SHARED_DB_REVIEW_MODEL`
(standing rule: AI model choices are configurable, never hard-coded), default keeps the
lane working unconfigured, and a 404 now names the id and says it is a CONFIGURATION
problem rather than a network one.

---

## 3. Owner rulings made this session — all four recorded on issues

1. **"Fix it first"** — the review step is fixed before any batch promotion. Done (#779, #783).
2. **The shared sandbox/production Supabase connection is an ACCIDENT**, not a cost
   decision. Recorded on #767. Audit found no damage.
3. **Conditional pre-approval for batches B3–B10:** *"Send them to Grok. If it approves
   and you approve, then I approve."* Recorded on #773 as a **three-gate chain**. See §5 —
   **this is not an approval to apply.**
4. **The approved 2026-08-09 OrderList export is authoritative** (12,328 rows, SHA-256
   `4958b4b7…`); the drifted live sheet (12,323 rows) is rejected. Recorded on #727.

---

## 4. THE HEADLINE FINDING — no production apply has ever been model-reviewed

Not one. Including **batch B2, promoted to production this morning**, which Albert
approved beside a green job that implied a review had happened. Three independent faults
stacked: the secret was never configured, the script could not fail, and the model id was
not real. Each hid the next.

This is the shape to watch for in this repo: **a guard that reads as strict and behaves as
permissive.** It has now appeared three times (this, the null-permissive privilege check,
the boot-DDL `console.warn`). When you find one, sweep for others — that sweep is what
found the truncation bug.

---

## 5. The production promotion — where it actually stands

**Batches B3 through B10 are reviewed, verified against live production, and ready to
propose. Nothing has been applied. Every batch is 0% applied; no batch is split.**

### The three-gate chain (owner's design, recorded on #773)
1. **Grok** reviewed all 8 batches → **approved every one, none unconditionally.** Only B5
   got a plain APPROVE.
2. **Orchestrator verification** — I checked every Grok finding against the real SQL.
   Verified true: B4 hard-depends on B3 (a generated column and CHECK constraint call
   `core.normalize_popsg_property_observation()`, created only in B3's `20260731150000` —
   a DDL-time abort, not a runtime one); B6's `20260804120000`/`20260804120100` are
   inseparable; B10's TRUNCATE story. Checked and **dismissed**: a suspected RLS-on-live-
   table problem in B7 — the table is created in the same migration.
   **Found by us, missed by Grok:** `20260810010000` validates three CHECK constraints on
   `plm.production_order_line`, a table that is **not new**, on an "empty today" assumption
   nobody had verified.
3. **Albert's per-run click** through the `environment: production` reviewer gate. **A
   conditional pre-approval given in chat is NOT a substitute and no session may treat it
   as one.**

### Preflight against live production — ALL CLEAR (run 2026-08-11)
- **B9's VALIDATE cannot abort.** `plm.production_order_line` has **0 rows**, and stronger:
  all three checked columns are created by that same migration with safe defaults
  (`master_data_match_status not null default 'not_applicable'`, `source_style_type` NULL,
  both allowed). A pre-existing row cannot carry a bad value in a column that did not exist.
- **Every hard-coded UUID resolves**, with the asserted codes and names: Disney
  `7d141a6f-…` (`DY`/`DISNEY`), COCO `5c03fc46-…` (`COCO`/`CC`), its current parent
  `80276015-…`, and the B9 designer profile `a88e8c06-…` (active). B7's other abort paths
  clear too.
- **No revoked admin grant would be silently re-activated** — `app.app_access` holds
  **0** `admin` rows, live or revoked.

### Recommended order (Grok and the verifying agent reached this independently)
1. **`20260810180000` alone, first.** Pure security correction — revokes privileges and
   narrows a schema default. Creates nothing, deletes nothing, takes no meaningful lock,
   depends on nothing unapplied. **B7, B8, B9 and B10 all create new `plm` tables, and
   until this lands each is born with TRUNCATE granted to `service_role`** — which fires
   no row triggers and walks past every immutability guard. B10 is not atomic, so a
   single-file allowlist for it is legal.
2. **B5** — safest full batch: function-only, no DDL, no data, independent.
3. **B3 → B4** as a pair, in that order (B4 aborts without B3).
4. Then B6, B7, B8, and **B9 last**.

### Before ANY apply
**Freeze merges to `main`.** The apply pins to an exact `origin/main` SHA and has already
refused two approved runs this week because main moved between staging and the click.

### Remaining conditions not yet cleared
- **The 4 unbatched leftovers** (`20260811030000`, `050000`, `060000`, `070000`) were
  **outside the review brief and nobody has reviewed them** — not Grok, not us.
- Decide whether B9's admin `app_access` grants are intended (4 new rows: 3 administrator-
  role profiles + 1 named designer maintainer).
- Do not activate `phase4_preview` taxonomy pins on production; name
  `plm.deployment_environment` after B6 lands. The migration correctly leaves activation empty.
- **A documentation defect in B10:** `20260810180000`'s header claims `20260810090000` and
  `20260810110000` "have been applied here." **Both are in B9 and unapplied.** The migration
  survives it (an "all absent → skip loudly" branch) but the comment will mislead the next reader.

---

## 6. Per sub-agent — 12 dispatched, all read-only or PR-only

### Agent: handover/backlog summarizer (no worktree, read-only)
- **Asked:** summarize `HANDOFF.md`, `HANDOFF.d/`, `AGENTS.md` §§4–6.7 and 8 issues, pinned to a SHA; flag contradictions, do not resolve them.
- **Did:** produced the critical path, the B1–B14 backlog dispositions, 13 owner gates, and 8 flagged contradictions with line anchors.
- **Found:** four backlog rows point at issues that are now CLOSED (#545, #547, #549, #550). #736 is **stale by ~14 hours and materially incomplete** as an owner-decision index — it misses #763, #768, #769, #774, #503, #696, #645. **Do not treat #736 as complete.**
- **Deliberately did NOT:** resolve any contradiction, or make a database call.
- **Worktree:** none. Finished.

### Agent: preview observer (read-only)
- **Asked:** what is sitting on preview.
- **Did:** proved target via Management API with the ref hardcoded in the URL; 426 applied, zero foreign versions.
- **Found:** **the Supabase MCP on this machine is bound to PRODUCTION** (`get_project_url` → `qsllyeztdwjgirsysgai`). It takes no project parameter. Also corrected my session-start migration maximum — the `ls`-vs-`git ls-tree` trap.
- **Deliberately did NOT:** use the MCP for any preview data.
- **Worktree:** none. Finished.

### Agent: DesignFlow environment mapper (read-only)
- **Asked:** which database does each DesignFlow environment actually connect to.
- **Did:** read deployed Cloud Run config and live schemas. **Production = Google Cloud SQL** `creatiflow-database` (POSTGRES_17, us-central1, private IP `10.75.208.4` over VPC connector `pop-connector`), schema `designflow`, 103 tables. **Sandbox/develop/staging = the PRODUCTION Supabase project** `qsllyeztdwjgirsysgai`, schema `dflow`, 113 tables, live writes.
- **Found:** "schemas vary" means the production Cloud SQL *instance* holds several DesignFlow-shaped schemas side by side (`designflow`, `designflow_dev` 103 tables and fully populated but abandoned, `designflow_sandbox`, `rfq_backoffice13_prod`, `public`); the *app* points at one. **A rehearsal against sandbox proves nothing about production** — different engine, network path, schema name and neighbours. Also: production Cloud SQL has a **public IP with 8 authorized networks**, one a developer workstation.
- **Deliberately did NOT:** change any Cloud Run service, env var, secret or trigger.
- **Worktree:** none. Finished.

### Agent: production ledger verifier (read-only, PRODUCTION)
- **Asked:** replace the handover's document claims with a live read.
- **Did:** 376 applied / 57 unapplied; **zero orphans** (everything live in production has a file on main); every batch 0% applied; the three retired/held versions correctly not applied.
- **Found:** the **out-of-order ledger** (§1) — the single most important finding for anyone reasoning about production. Also flagged a B3/B4 overlap **in the batch list it was given**.
- **Deliberately did NOT:** compare file *contents* against the ledger. The Supabase ledger stores no content hash, so "was an applied migration edited afterwards?" is **UNPROVEN by design**. Nobody has closed this.
- **Worktree:** none. Finished.

### Agent: dflow boot-DDL auditor (read-only, PRODUCTION)
- **Asked:** what has the boot DDL already done, and did it reach outside `dflow`.
- **Did:** enumerated `dflow` (108 tables, 5 views, 103 sequences, 6 functions, 3 triggers, 213 indexes) — **every object accounted for by a committed migration, zero unaccounted.**
- **Found:** the boot DDL **no longer exists** — removed by commit `ae86ffa`, 2026-07-17, reconciled by migration `20260717163500`, and a `forbid-shared-db-bypass.yml` CI guard now blocks its return. **Nothing outside `dflow` was ever touched:** the dangerous unset-`SCHEMA` path (prefix collapses, statements land in `public`) never fired, and **zero foreign keys cross the `dflow` boundary**. Residue: an orphan `designflow` schema on Supabase, 7 populated tables, ~1,100 rows — no migration creates it.
- **UNPROVEN, honestly stated:** Postgres cannot prove nothing was transiently altered and reverted before 2026-07-17. Every statement was `IF NOT EXISTS`/`ADD COLUMN` shaped, so none could drop or rewrite an object. Low risk, not zero.
- **Deliberately did NOT:** touch the orphan schema. Filed as **#778** for an owner decision.
- **Worktree:** none. Finished.

### Agent: Grok batch reviewer (read-only)
- **Asked:** drive Grok over B3–B10's real SQL; verify its findings; do not relay unchecked.
- **Did:** all 8 batches reviewed; findings verified against the SQL (§5).
- **Found:** the `plm.production_order_line` VALIDATE risk Grok missed; the B10 header documentation defect.
- **Cost overrun, flagged:** Grok billed **$2.32** against a $1.50 ceiling. Turn 2 billed $0.74, returned an **empty answer** (known Grok 0.2.112 resumed-session defect), and left a **stale lock** that blocked two retries until the dead process was killed.
- **Deliberately did NOT:** review the 4 unbatched leftovers (outside brief).
- **Worktree:** none. Finished.

### Agent: GLM — issues #614–#617 reconciliation (read-only)
- **Asked:** Albert assigned "#614 through #617"; #712 said they were wrong, so reconcile before rebuilding.
- **Did:** proved #712 correct. #614 already closed; **#615 closed** (obsolete 47-migration allowlist); **#616 closed** (never started; would have needed a full production `pg_dump` — a complete read of the personal data flagged in #645 — plus a paid temporary project); **#617 rewritten** then resolved.
- **Found:** #712's own figures were already stale again. This directly motivated the §4.3 rule.
- **Deliberately did NOT:** implement anything, or write to `.github/workflows/` (owned by another agent).
- **Worktree:** `issue-712-reconcile` — created and removed by the agent. Finished.

### Agent: GLM — issue #727 PopDAM OrderList design (design-only)
- **Asked:** design the idempotent import; declare the object list for the collision gate; do not write.
- **Did:** full design, committed at `docs/design/popdam-order-list-idempotent-import.md`, branch `docs/727-orderlist-import-design`, commit `824eee5`, pushed. **No PR opened.**
- **Found:** **the object list is EMPTY** — the importer creates or replaces no database objects; all its DDL shipped in merged migrations `20260810010000`, `20260810060000`, `20260810100000`. It is a row-writing loader, not a migration. **No migration version needs allocating and no collision gate applies.**
  Idempotency: natural key `(source_system='google_order_list', source_id)` derived deterministically from the physical sheet row; re-run resolves by source ref (missing → insert, identical → nothing, drifted → **counted and reported, never silently rewritten**); 500-row batches, one transaction each, all headers commit before any lines; the report **asserts** counts and `--verify-idempotency` runs apply twice and raises unless the second pass changes 0 rows.
- **Two traps for whoever runs it:** `matched` will read **0** because `plm.item` is empty — the real signal is `resolution = unique`. And it **hard-depends on `20260810060000`** (NULLS DISTINCT) or the second order insert dies on `duplicate key (null, null)`; that migration is on preview but **NOT on production**. **This importer must never be pointed at production.**
- **Deliberately did NOT:** pick a source, write any migration, or make any database write.
- **Worktree:** `issue-727-design` — **LIVE, branch unmerged, one untracked GLM artifact.** Do not delete.

### Agent: GLM — issue #729 launch readiness (read-only)
- **Asked:** what actually blocks the launch of **DB Data Admin**, the application that owns the hostname `data.designflow.app`.
- **Did:** posted a checklist. Live: `app.app_access` admin rows = **0**; `core.product_size`/`core.product_depth` **absent**; 16 `api.db_data_admin_*` functions present; `data.designflow.app` → `178.156.180.212`, **503**; `data-dev` → 200.
- **Found three things that change the picture:** (1) **the DNS blocker is not a DNS blocker** — the record already points at the Coolify VPS; the only owner click is attaching the fqdn to Coolify app `zeoy8qfjqffu8ym533cc7dl4`. (2) **#773's ordering constraint costs nothing** — `20260810050000` is data-only and sorts above all of B8, so version-ordered promotion satisfies it automatically. (3) **The dangerous gap:** `20260810050000` sits inside atomic B9 but the guard did not encode that, so a single-file allowlist would have passed. **It refused the shortcut** — that refusal is what produced PR #781.
- **Also:** the admin app reads **shared Supabase only**; zero of the 25 `db_data_admin_*` functions reference `dflow.`. Workflow run **31506619979** sits at `waiting` on Albert's environment review and **would fail anyway** — `COOLIFY_PROD_APP_UUID` is unset. `DataAdmin.tsx` renders **five** tabs unconditionally including Product Depth; docs saying "four tabs ship" are stale, and that tab is a visibly broken screen until B8 lands.
- **Unblock order:** freeze merges → B3, B4, B5, B6, B7 → **B8** → **B9** (carries the admin grants) → set `COOLIFY_PROD_APP_UUID` → approve the environment run → attach the fqdn. **No engineering work remains on this issue.**
- **Worktree:** `issue-729-launch` — clean, branch unmerged, no PR. Safe to retire once #729 closes.

### Agent: model-review fix (PR #779 — MERGED)
- **Asked:** make a skipped review fail the job; sweep for the same pattern.
- **Did:** §2 above. Also **settled a direct contradiction with another agent in its own favour** — the other had read a loud message on a green job as a failure. Then took a second pass for the truncation HIGH.
- **Died mid-task on a session limit** and, on resume, correctly reported that its fix had **not** landed: two commits pushed but the script left uncommitted and half-edited (`collect_sql` rewritten to return a tuple, caller not updated — the script was broken). It finished from the diff rather than from its own prior claim. **This is why the standing rule is "assess and report current state", never "carry on".**
- **Sweep result:** the one step-level `continue-on-error` in the repo is gone; **zero remain**. Found and read but did **not** fix (all legitimate, none on the production path): `set +e` in `coldlion-licensor-property-alert-monitor.yml:116`, `-phase6-parallel.yml:279,297`, `-production.yml:361`; `exit 0` in `-phase6-parallel.yml:256`, `-production.yml:320`, `sync.yml:90`; `|| true` in `database-contract-tests.yml:264,265,284,526` and `db-data-admin.yml:181,182`.
- **Deliberately did NOT:** fix the weak bypass test or the hard-coded model id in that PR. Both carried forward (#785).
- **Worktree:** `model-review` — clean, PR merged. **Safe to retire.**

### Agent: atomic-batch guard (PR #781 — MERGED)
- **Asked:** encode atomicity for B3, B7, B9.
- **Did:** covered **four** — B1, B3, B7, B9 — because it read the contract and found my brief understated it. Counts reconcile with §5: 11, 10, 6, 14.
- **Found:** **the B3/B4 overlap is NOT in the contract.** It exists only in the batch lists carried in issue text (#710, #773). The contract was right; the copies were wrong. **Corrected on both issues.** I had reported it to Albert as a blocker — it was not.
- **Also listed 10 prose-only contract rules with no mechanical check.** The largest: §9.2/#611 says no licensor batch may go until `experiment_611_db_push_atomicity.sh` has been RUN, with no gate at all. **#611 is CLOSED, which suggests it was done — but closed is not proof it ran. Verify before promoting.**
- **Constraint violation, harmless:** it worked in the orchestrator's own worktree rather than creating its own, contrary to its brief.
- **Worktree:** used the orchestrator's. PR merged.

### Agent: `ANTHROPIC_API_KEY` provisioning (issue #617 — CLOSED)
- **Asked:** find a key in 1Password and install it.
- **First run:** found only two Anthropic keys on item `ai-provider-api-keys` (`3onekcbg3dxnazpnt36d4yzfcq`) — **both revoked, both 401.** **Correctly refused to install a dead key**, because that swaps an honest "not configured" message for a misleading "broken API" one. Reported back rather than improvising.
- **Second run**, after Albert created a new key: vault `vibe_coding`, item **"Anthropic Claude API for shared-db"** `5uq6z66ibusmypkvnl276ta22e`, field `credential`. Validated `GET /v1/models` → **HTTP 200**. Installed at **repository scope** — correct, because `production-apply-review` deliberately carries no `environment:` (removed under #646 so Albert is not asked to approve twice), so an environment-scoped secret would be invisible to it.
- **Found the model-id 404** (§2, PR #783) by running the real script locally.
- **Deliberately did NOT:** edit code, or write the key value anywhere.
- **Worktree:** none. Finished.

### Agent: model-id fix (PR #783 — MERGED)
- **Asked:** correct the id and make it configurable.
- **Did:** §2. Test suite **335 passing** (was 326).
- **Honest about its own tests:** they cannot catch a dead id — the broken `claude-opus-4-5-20260514` passes every structural assertion. **Only a live call proves an id is real.** Recommended (did not build) a `max_tokens: 1` pre-flight probe or a weekly canary. Carried forward as **#785**.
- **Worktree:** `review-model-id` — clean, PR merged. **Safe to retire.**

---

## 7. What we tried that did NOT work — MANDATORY, read this before repeating it

1. **`ls supabase/migrations/` in the shared checkout.** Gave the wrong maximum version at
   session start and I reported it to Albert before an agent caught it. The checkout is
   parked on branch `pr717b`. **Always `git ls-tree origin/main`.**
2. **`gh pr merge --auto`.** Rejected: *"Auto merge is not allowed for this repository."*
   Use `gh pr checks --watch` then merge.
3. **Merging while `BEHIND`.** Branch protection has `strict: true` (owner-set 2026-08-06,
   must not be turned off). `gh pr update-branch` **re-triggers every check**, so budget
   another full CI cycle before the merge lands. Two PRs needed this.
4. **Believing a second-opinion model's numbers.** GLM claimed "eight tests would fail
   against the old code, four pass". The verifying agent actually ran them: **12 of 13
   fail, 1 passes.** GLM guessed. Its directional finding survived; its number did not.
   On PR #781 GLM did better — it explicitly refused to guess and said it had no shell.
5. **Grok on a large brief.** One turn billed $0.74, returned empty, and left a stale lock
   that blocked two retries until the dead process was killed. Keep briefs compact, code
   inline, one batch per call.
6. **Assuming a sub-agent's "done" means committed.** The #779 agent's fix was uncommitted
   and half-applied when it died. **Open the diff. A report is a claim; a commit is a fact.**
7. **Treating `HANDOFF.d/` as sortable by filename.** Two timestamp formats coexist; a text
   sort picks a July file. Parse the date. My brief to the summarizer named the wrong
   newest file and it corrected me.
8. **Trusting the batch lists in #710/#773.** They carried a B3/B4 overlap the contract did
   not have. **The contract file is the authority for batch membership. Never an issue body.**

---

## 8. Open owner decisions — what Albert still owes

Most urgent first. **#736 claims to index these and is incomplete** — it misses #763, #768,
#769, #774, #503, #696, #645. Do not rely on it.

1. **Approve production batches, one per run**, naming the exact project and action. The
   chain in §5 has cleared gates 1 and 2. **Recommend proposing `20260810180000` alone first.**
2. **Supply the approved 2026-08-09 OrderList export** (12,328 rows, SHA-256 `4958b4b7…`)
   where the import can reach it. The checksum is the gate — **do not relax it to make a
   near-match pass.** (#727)
3. **#778** — the orphan `designflow` schema: ~1,100 rows, nothing points at it. First step
   is read-only: does that data exist anywhere else? Nothing may be dropped without Albert
   naming the exact schema and action.
4. **#729** — attach the **DB Data Admin** fqdn to Coolify app `zeoy8qfjqffu8ym533cc7dl4`,
   and set `COOLIFY_PROD_APP_UUID`. Both come **after** B8 and B9.
5. Standing and inherited, untouched this session: #774, #769, #768, #711 (D2, D5, D6, D7),
   #732, #675, #645, #644, #643, #665, #618, #582, #551, #541, #539, #531, #516, #515, #503, #696.

**Unexplained and nobody chased it:** the OrderList sheet shrank by 5 rows. Albert's ruling
means we do not need the answer to proceed, but somebody should eventually find it.

---

## 9. State left behind — every item is a decision, not an oversight

**Worktrees: 53 total.** This is a known problem tracked as **#682** and was not addressed
this session — deliberately, because retiring 40+ worktrees belonging to dead sessions is
its own careful job and this session's context was spent on the production lane.

Of the ones this session touched:
- `model-review`, `review-model-id`, `agents-md-live-figures` — **clean, PRs merged, safe to
  retire** with the `cleanup-worktree` skill.
- `issue-727-design` — **LIVE.** Branch `docs/727-orderlist-import-design` (`824eee5`) is
  pushed but has **no PR**. Holds the #727 design. **Do not delete.** Next action: open a PR
  or fold it into the implementation.
- `issue-729-launch` — clean, unmerged, no PR. Retire once #729 closes.
- The orchestrator's own worktree was left on the guard branch by an agent that ignored its
  brief. Harmless; the PR merged.

**Untracked files, listed rather than committed** — all are GLM/second-opinion session
reports written by the `ai-glm` harness, kept as review evidence:
- `.ai/reviews/glm-pr779-model-review-must-run-20260811T161653Z.md`
- `.ai/reviews/glm-pr781-atomic-batches-guard-20260811T183741Z.md`
- `.ai/reviews/glm-orderlist-727-idempotent-import-design-20260811T160024Z.md` (in `issue-727-design`)
- `.ai/reviews/glm-gate-611-atomicity-pg17-20260810T170046Z.md` (pre-existing)
- `.ai/deepseek-sessions/` (pre-existing)

Next action: keep as evidence or delete. Not mine to decide.

**Licensed data on disk:** copies of the OrderList workbook remain in
`C:\Users\ahazan2\Downloads\` from a prior session. **Should be deleted** — licensed rows
must not sit outside their approved location.

---

## 10. Secrets sweep — DONE

**One new credential appeared this session and it is stored.** Albert created an Anthropic
API key and placed it in vault `vibe_coding` as item **"Anthropic Claude API for shared-db"**,
id `5uq6z66ibusmypkvnl276ta22e`, field `credential`. It is installed as the repository secret
`ANTHROPIC_API_KEY` on `u2giants/shared-db`. **No value appears in any file, commit, issue,
PR, log or chat**, and none was written by any agent.

**Also found, needs Albert's decision:** the two Anthropic keys on item `ai-provider-api-keys`
(`3onekcbg3dxnazpnt36d4yzfcq`, fields `anthropic` and `anthropic_popdam_shared_supabase`) are
**revoked** — both return 401. Dated 2026-06-22, sourced from the retired nas-mcp container.
They are dead weight and a trap for the next session. **Not deleted — rotating or removing an
existing credential needs approval.**

Nothing else surfaced: no token pasted into chat, no connection string in a scratch file, no
`.env` written. **Swept, one item stored, nothing else new.**

---

## 11. Documentation pass — DONE

- **`AGENTS.md` §4.3 added** (PR #780) — the owner's standing rule. Purely additive; the
  concurrent edit to the `ANTHROPIC_API_KEY` paragraph was **byte-verified identical**
  before and after (hash `1c1b2f41…`), and again after the #779 rebase (`fec78e2a…`).
- **`AGENTS.md:712`** corrected by PR #779 so it no longer claims a missing key makes the
  step "say so explicitly rather than skipping silently" — it now fails the job.
- **Issues corrected in place rather than rewritten:** #773 and #710 carry dated comments
  superseding their unapplied counts and their wrong B3/B4 membership. #712 carries its own
  correction. Originals left intact as the audit trail.
- **No rehearsal was voided this session** — no migration replaced a function that an
  earlier rehearsal validated.

**Nothing else outside this handover is now stale.**

---

## 12. If you read only one thing

The production lane was **three faults deep** and every one of them presented as working:
a review that could not fail, calling a model that does not exist, guarding batches whose
atomicity it did not know about. All three are fixed and merged. Nothing has been applied
to production.

**Your first act should not be to promote a batch.** It should be to re-derive §0, confirm
`experiment_611_db_push_atomicity.sh` was actually run (#611 is closed but that is not
proof), get the 4 unbatched leftovers reviewed, and only then propose `20260810180000`
alone to Albert.

---

## 13. LATE ADDITIONS — after the handover was first drafted

Three things landed after §0–§12 were written. They are appended rather than folded in, so
the record shows what was known when.

### 13.1 The review model is now `claude-opus-5` (PR #787, merged)
Albert asked why the lane used Opus 4.5 when Opus 5 exists. Fair, and nobody had chosen
4.5 — PR #783 corrected a **non-existent** id (`claude-opus-4-5-20260514`) to the nearest
working one and stopped there. An agent then called the live `/v1/models` and got, in order:
`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`,
`claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-haiku-4-5-20251001`,
`claude-sonnet-4-5-20250929`. Default is now `claude-opus-5`. `SHARED_DB_REVIEW_MODEL` override
untouched. Test suite **358 passing**.

**Two operational notes:** the review's response hit its token ceiling mid-sentence, so no
trailing `VERDICT:` line was emitted — the script correctly defaulted to CONCERNS and said so
out loud. **Raising `max_tokens` is a sensible follow-up.** And running the script on Windows
crashes on a Unicode arrow unless `PYTHONIOENCODING=utf-8` is set; CI runners are UTF-8, so the
lane is unaffected.

### 13.2 The first real review in this repo's history found real problems — issue #788
That live end-to-end run was against **`20260811070000`**, one of the four unbatched leftovers.
It returned **CONCERNS** with substantive findings: the batch depends on `plm.nbcu_*` tables no
file in it creates; the out-of-order apply would break two lower-versioned count gates; a
`CREATE OR REPLACE finalize_nbcu_capture` tightens the loader contract; and PG17-only `MAINTAIN`
syntax is used.

**This is signal about the leftovers as a group.** `20260811030000`, `050000`, `060000` and
`070000` are in no batch, in no allowlist, and were explicitly outside the Grok brief — **nobody
has reviewed them.** Filed as **#788**. Verify each finding against the real SQL before acting on
it or dismissing it; a model verdict is a claim, the code is the fact.

### 13.3 Issue #782 triaged — it is a REQUEST, not a handover
Filed after this session's start sweep, so it was untriaged until Albert spotted it. Verified
read-only: **nothing was built and no database was touched** — no branch, PR, worktree or
migration in this repo references it. App-side work is real and separate (`u2giants/popcrm-web`
@ `5191d35`).

It asks for a CRM-owned, service-role-only table plus narrow functions holding one opaque
Microsoft Graph delta link, so PopCRM's mail worker stops skipping mail during bursts. Preview
only, explicitly no production. **Verdict: ready to dispatch.** Seven of the nine required
handover questions are answered; **"what I tried that did NOT work" and "facts that may be
stale" are both absent.**

**⚠️ It orders a Kimi K3 review loop.** Do not let an agent hard-code that: a pinned model id
that did not exist is precisely what #783 and #787 spent today fixing. Confirm against the live
provider list and prefer a setting over a constant.

No conflict with anything in flight. Only soft overlap: its migration filename must be
timestamped **after** whatever the promotion batches stage.

### 13.4 Open issues filed this session
**#778** orphan `designflow` schema (needs Albert) · **#784** non-atomic never-rest states
unenforced · **#785** nothing proves the review model id is real · **#788** the four unreviewed
leftovers.
