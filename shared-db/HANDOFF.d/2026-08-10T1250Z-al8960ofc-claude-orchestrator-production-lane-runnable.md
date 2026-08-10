# Orchestrator handover — session 52cd0e78 — al8960ofc — 2026-08-10T12:50Z

**Marker issue:** #660 (closed by this handover).
**One-line summary:** the five-PR Guard B deadlock is cleared, eleven migrations are on `main`, the production apply lane is runnable for the first time, and four licensor production plans exist and have been debated to convergence with DeepSeek. **Nothing has been applied to production. Nothing.**

---

## 0. READ THIS FIRST — the hard gate

> **The canary migration `20260810140000` MAY go through the production apply lane with issue #611 open. That is exactly what a canary is for.**
> **NO licensor batch may go until `scripts/experiment_611_db_push_atomicity.sh` has actually been RUN, on the pinned Supabase CLI version 2.105.0.**

#611 is: does `db push` write a migration's SQL and its ledger row in ONE transaction? **Unsettled.** The experiment is written, reviewed and committed; it needs ~20 minutes on a machine with Docker. This machine (al8960ofc) had none.

Do not reason your way past this. During review on 2026-08-09/10 a reviewer asserted it as settled fact, was challenged, and retracted — dropping its own confidence from 85% to 30%. Careful reasoning is not sufficient evidence here; running it is.

The two bad outcomes, concretely:
- **SQL without ledger row** → a re-run hits duplicate-object errors, and may strand a CREATE without its security fix.
- **Ledger row without SQL** → `validate_candidates` permanently refuses that version, and preflight starts trusting objects that do not exist. Requires manual ledger surgery.

This is stated as a HARD GATE in `AGENTS.md` §5.1-A, with a pointer stub at the top of §5.1 so a session following the promotion recipe cannot miss it (PR #673, merged `de8ab8b`).

---

## 1. Ground truth, stamped

Everything below re-derived at **2026-08-10T12:48Z**. Per this repo's own rule, treat it as stale within the hour and re-derive.

| Fact | Value |
|---|---|
| `origin/main` tip | `de8ab8bd73abbc20edd2d840cacd4a3fba929578` (was `ca2eea2` at 12:48Z; PR #673 merged after) |
| Max migration version | `20260810140000_production_lane_canary.sql` |
| Open PRs | **none** — verified at handover |
| Open `db-claim` issues | **none** |
| Production ref | `qsllyeztdwjgirsysgai` — **untouched this session** |
| Preview ref | `rjyboqwcdzcocqgmsyel` |
| Production migrations behind | **~61** (33 below head, 28 above). NOT 44 and NOT 47 — those figures circulated earlier today and are wrong. Three independent agents converged on 61. **Re-derive before acting.** |
| Preview server version | PostgreSQL **17.6** — so `MAINTAIN` exists and is granted by `grant all` |

### Preview state — NOT clean, and never has been

Preview holds a full production data clone plus, at handover: the Disney OPA mirror (~10,261 rows loaded 2026-08-09), the issue-#597 Phase 1 objects, and **twelve** migration versions applied this session and now merged (`20260810010000`–`20260810130000`, plus `20260810140000` is on `main` but was NOT applied to preview — it is the canary and is meant to be applied by the lane).

Ledger row count on preview moved 418 → 422 (nine unmerged at session start) and then to 423 with `20260810130000`. Nothing was reset, cleaned or dropped.

---

## 2. What this session actually did

Merged to `main`, in order:

| PR | Merge commit | What |
|---|---|---|
| #661 | — | ColdLion key rotation ask withdrawn (docs) |
| #662 | — | Rulebook contradictions resolved |
| #663 | `cbeda42` | **The five-way combined merge** — eleven migrations, five workstreams |
| #668 | `6a63af1` | Warner chunked capture protocol + the missing loader |
| #667 | `ca2eea2` | **The production apply lane made runnable** |

The eleven migrations in `cbeda42`, by exact 14-digit version: `20260810010000`, `020000`, `030000`, `050000`, `060000`, `070000`, `080000`, `090000`, `100000`, `110000`, `120000`. All eleven applied and behaviour-proven on preview before the merge.

Then `20260810130000` (Warner capture protocol, #668) and `20260810140000` (canary, #667).

### The deadlock, and how it was cleared

Guard B compares each PR's added versions against the **live tip** of `origin/main`. Five open PRs each added versions; merging any one raised main's newest above another's lowest, stranding it. **No permutation of the five worked.** Branch protection is `strict: true` AND `enforce_admins: true` — no bypass.

Fix: one integration branch off `main`, plain `--no-ff` merge of all five, one PR. In a single merge, main's newest is still `20260809170500`, so all versions sort above it. All four merges were clean — the five branches shared **no files at all**, so the `CREATE OR REPLACE` three-way-merge trap never fired.

**Do not retarget PRs to stack them.** A stacked base makes Guard B compare against the stack tip and it fails identically.

The merge agent proved (rather than reasoned) that merging four and leaving NBCU for last would have stranded NBCU — and that the reverse order fails too. Folding NBCU in as a fifth branch was the only route.

---

## 3. Every sub-agent, separately

### Agent: startup summarizer (read-only)
- **Asked:** summarise the two 2026-08-09/10 handovers and `HANDOFF.md` BACKLOG.
- **Did:** full report with line anchors; flagged 10 contradictions without resolving them.
- **Worktree:** none. Finished.
- **Deliberately did NOT:** resolve any contradiction — by design, so the orchestrator re-derived each from `git`/`gh`.

### Agent: ColdLion ruling (PR #661, merged)
- **Asked:** implement Albert's ruling that he does not control ColdLion and cannot rotate the exposed key; strike the ask from living docs.
- **Did:** dated ruling block in `docs/coldlion-erp-api-reference.md` and at the top of `HANDOFF.md`; closed #642 as **withdrawn, not completed**. Checked eight other ColdLion issues; none asked him to act on the credential, so none were touched.
- **Found:** #517 (Cloud SQL password) is a *different* credential, outside the ruling. Albert later closed it separately by direct instruction.
- **Worktree:** `coldlion-key-ruling` — finished, safe to clean.
- **Deliberately did NOT:** touch `HANDOFF.d/` (write-once), and did NOT scrub the security record. **The ask is withdrawn; the exposure remains a recorded fact.** Do not erase it and do not re-raise it.

### Agent: rulebook contradictions (PR #662, merged)
- **Asked:** resolve #657 and advise on #654.
- **Did:** corrected `AGENTS.md`'s "domain-ownership not yet built" (built 2026-08-05, is a required context, verified green); disambiguated two CI checks; fixed a stale `COORDINATOR_INTAKE.md` reference.
- **Found:** the previous session's premise on the intake file was **wrong**. The file is already a correct pointer and its guard is live and required. `HANDOFF.md`'s "the CI check was deleted" is TRUE but names `backlog-queue-sync`, removed in `534b20f` — NOT the intake guard. **Reading it the other way leads straight to deleting a file a required check demands exists**, which would fail every PR in the repo. The rulebook now says "retired means pointer-plus-guard, never deleted".
- **Proved** the guard fires: made an oversized draft fail, trimmed it, watched it pass.
- **Worktree:** `rulebook-657` — finished, safe to clean.
- **Deliberately did NOT:** fix cosmetic `a orchestrator` grammar artefacts; edit `HANDOFF.md` (owned by another agent that cycle).
- **On #654:** premise is out of date. `scripts/check-skill-drift.mjs` already exists; its gap is that it SKIPS in CI because `u2giants/ai-devops` is not on disk there. ~10 lines to close (second checkout + `AI_DEVOPS_DIR`). Recommends a **nightly job that opens an issue, not a required PR context** — the drift is slow-moving and does not arrive with a PR.

### Agent: preview prover (Warner + Paramount)
- **Asked:** apply and prove `20260810030000` (Warner, never applied anywhere) and `20260810090000` (Paramount fix) on preview.
- **Did:** applied both via `psql --single-transaction` with the ledger row in the same transaction. Verified 48 Warner objects by catalog; exercised 9 loader behaviour cases in rolled-back transactions; proved Paramount's TRUNCATE revoke went 23/23 → 0/23 with a live `permission denied`.
- **Found:** settled the six-vs-seven preview count dispute (**seven** before it started). Established the server is **PostgreSQL 17.6**, so `MAINTAIN` is in play — which nobody had checked.
- **Verdicts:** Warner PROVEN WITH DEFECTS; Paramount PROVEN.
- **Worktree:** used `issue-588` / `issue-623` — finished.
- **Deliberately did NOT:** author any fix migration; merge anything; touch production.

### Agent: merge deadlock (PR #663, merged as `cbeda42`)
- **Asked:** clear the five-PR deadlock.
- **Did:** built `integration/combined-20260810`; five clean merges; closed the five source PRs with reversible supersession comments; created the `pii-guard-allow` label (**the workflow documented it but nobody had ever created it**).
- **Found, by simulation not argument:** merging four and leaving #634 last **strands #634**, and the reverse order fails too. Reported its own first test method as invalid before giving the second result.
- **The three seams** only visible in the combined diff — see §5.
- **Worktree:** `combined-20260810` — finished, safe to clean.
- **Deliberately did NOT:** merge; close any claim; delete any branch. **All five source branches remain on the remote** — #663 is not the only copy.

### Agent: independent review of #663
- **Used:** Codex `gpt-5.6-sol`, effort **medium** (header read and confirmed).
- **Found three HIGH items**, all verified against source: Warner's `service_role` retained the COMPLETE unmitigated `plm` default; Warner's RLS was `using (true)`; and `api.dam_order_list` was effectively a SECURITY DEFINER view whose own comment claimed the opposite.
- **Caught a false precedent:** Warner's comment claimed parity with `plm.opa_property_character`, which had been FALSE since `20260807190000` replaced that policy with a role gate and called the loose version a HIGH finding.
- **Deliberately did NOT:** upgrade any unverified claim. Flagged `MAINTAIN` as UNVERIFIED because confirming it needed a database call it was forbidden.

### Agent: hardening `20260810110000`
- **Did:** revoked `UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` from `service_role` on the 8 `wb_*` tables (kept SELECT, INSERT); replaced `using (true)` with the OPA role gate; set `security_invoker = true` on `api.dam_order_list`.
- **Found:** the pre-fix view returned 0 rows only because `plm.production_order` is empty on preview. **It would have leaked `core.customer` (864 rows), `core.factory` and `plm.item` to any authenticated reader the moment orders landed.** A timing accident, not a safe design.
- **Reported honestly** that a test could not be written as specified (Supabase's `postgres` is not superuser, so `SET SESSION AUTHORIZATION` fails) and split it into three that genuinely can fail, writing the limitation into the test file. Refused to create a persistent login role on shared preview to work around it. **That refusal was correct.**

### Agent: hardening `20260810120000`
- **Did:** corrected the false read-gate claim on all 8 tables; revoked `INSERT`; strengthened four weak tests.
- **Found and PROVED on preview:** `app.has_app_access` is **role-independent** — it checks only for a non-revoked `app.app_access` row and ignores roles entirely. So **a vendor or viewer with `plm` app access CAN read all Warner tables.** The previous migration's comment said they were excluded. It built the vendor principal and watched it read the row.
- **The new test asserts the TRUE behaviour**, not the comment's wish, across 9 principals × 8 tables. If someone later narrows the predicate, that test fails and forces the comment to be revisited with it.
- **The predicate itself was NOT changed** — it is a pre-existing house pattern copied from `20260807190000` and exists elsewhere. Changing the access model is a business decision, not a merge-time one.

### Agent: production apply lane (PR #667, merged as `ca2eea2`)
- **Asked:** build it ONCE for all four licensors.
- **Did:** fixed the `strip_sql` lexer defect; added one-directional co-presence rules; built the `apply` path; moved `production-dry-run` off the `production` environment (#646); wrote and committed the #611 experiment. Tests 41 → **82**.
- **Found:** the lexer defect produces **30 phantom references across 23 migration files**. It fires ONLY on small bounded allowlists — exactly what bounded promotion is.
- **CORRECTED MY BRIEF:** I told it NBCU `20260810070000` was blocked by the same lexer bug. It checked, found a **genuine foreign key** onto `core.style_guide` instead, and turned that case into a **positive control** — a test asserting it still fails, so a future permissive fix breaks loudly.
- **Did not guess #611.** No Docker available; wrote the experiment, committed it, said plainly it is unsettled.
- **Worktree:** `prod-apply-660` — finished.

### Agent: Warner capture protocol + loader (PR #668, merged as `6a63af1`)
- **Did:** `20260810130000` — `plm.wb_capture` + `begin/load_chunk/finalize/fail`, modelled on Paramount's protocol. Plus `tools/sync-warner-starlabs.mjs`, the loader that did not exist.
- **DISPROVED MY BRIEF'S PREMISE:** I said the files were too large for one request. It **measured** both transports. There is **no hard body ceiling** — a single 62 MB request succeeded on both the Postgres wire and PostgREST. Only time degrades, superlinearly, above ~32 MB. Chunking is still right (bounded transactions, resumability, per-chunk integrity) but **not for the stated reason**, and it wrote that correction into the migration header so nobody re-derives the false claim.
- **Chunk size:** 25,000 rows or 12 MB, whichever binds first. The database enforces the same ceiling independently so the two sides cannot drift.
- **Proved:** the real 147,537-row / 62 MB `assets.csv` streamed in 8 chunks with G8 asserting the pinned totals; corrupted, dropped and re-used chunks all refused; identical resend is an idempotent no-op; abandoned capture cleanable. **Residue after rollback: 0 rows.** Both loader refusals fired against the real dirty checkout and a wrong ref.
- **Deliberately did NOT:** edit the eight shipped `sync_wb_*` functions (fix-forward rule); build a re-pinning mechanism (documented only, in `docs/warner-starlabs-repinning-policy.md`).

### Agents: four licensor production plans (Disney, Paramount, NBCU, Warner)
Each wrote a plan, committed to it in writing, then debated it with **DeepSeek v4 Pro** to convergence. Outcomes in §6. All four are planning-only: no code, no migrations, no database calls.

---

## 4. What is waiting on Albert

Two things, both real blockers on licensor data, neither blocking the lane work.

1. **NBCU: the 75-versus-57 rule.** One source file has 75 lines; the spec claims 57. There is no written rule to reconcile them and nobody may guess. He needs a line census by shape (counts only, no NBCU names leaving the private repo) and lettered options. Issue filed with `needs-albert`.
2. **Paramount: the portal asset count.** The loader refuses to start without a portal-wide total observed by eye at `stillsarchive.paramount.com`. A scrape cannot produce it — the capture only ever saw one account's authorised slice. **It is frozen permanently at finalize and cannot be corrected**, and it must be observed the same day as the load. Needs a person with the login. Issue filed with `needs-albert`.

**Closed by his direct instruction this session:** #642 (ColdLion key) and #517 (Cloud SQL password). Both closed as **withdrawn asks with the security record kept**. Do not re-raise either. If a credential is later found actively abused, that is new information and a new issue.

---

## 5. The three seams — only visible because five workstreams merged together

Recorded because no individual PR review could have caught them.

1. **One root cause, three different responses, root cause survives all three.** `plm` carries a standing `alter default privileges ... grant all on tables to service_role` which fires at CREATE TABLE, before any GRANT in a migration runs — so a narrower GRANT is a **no-op**. Paramount revoked `truncate, trigger`; NBCU revoked `update, delete, truncate`; Warner revoked nothing. None changed the schema default. **Do not write the general fix (#649) assuming a uniform baseline** — it is uneven in three directions (`MAINTAIN`, `TRIGGER`, `REFERENCES`). See #664: **39 tables carry an unintended `MAINTAIN` grant.**
2. **Merge-atomic is not promotion-atomic.** These nine are one merge, but §5.1 promotion is bounded and takes subsets. Sorted by version the workstreams interleave, so three create-then-fix pairs have unrelated migrations between them. This is now enforced mechanically by the one-directional co-presence rules in `parse_allowlist`. See #612.
3. **Three different read postures landed the same night.** Paramount gates on roles; Warner admits anyone with `plm` app access (documented and deliberate, see `20260810120000`); NBCU grants no authenticated read at all.

---

## 6. The four licensor plans — status and headline findings

Full plans are in the debate agents' reports; the actionable summary:

- **Disney** — closest. Five migrations (`20260807170000`, `170100`, `180000`, `190000`, `200000`), all additive, nothing reads them yet. **Can be promoted independently** — verified by measurement, not argument. DeepSeek argued the opposite and conceded: preview (the only tested environment) already HAS these five, so promoting them moves production **toward** the tested baseline; holding them back protects the untested state. Blocked only by the lane. Should be customer #2 after the canary.
- **Paramount** — two migrations (`20260810020000`, `20260810090000`), both already on `main`. Blocked by the lane and by the eyeball count. Never carried real data anywhere.
- **NBCU** — two migrations (`20260810070000`, `20260810080000`). Blocked by the lane AND by the 75/57 ruling. **Also unresolved: `plm` is not PostgREST-exposed** (`pgrst.db_schemas` per `AGENTS.md` §8.1), so if the private loader uses supabase-js it cannot write these tables or call the functions at all. That is Gate 0 of its plan and nobody has checked it. The schema has **no correction path by design** — a bad completed load cannot be edited away, only superseded by a later capture.
- **Warner** — largest. Six migrations in its closure: `20260810010000`, `030000`, `060000`, `100000`, `110000`, `120000`. Note `110000` also alters `api.dam_order_list`, created by `010000` — a combined-scope migration that would have failed on the day if promoted as "the three Warner files". ~594,000 rows, ~150 MB. Capture protocol and loader now exist (this session). Remaining: the re-pinning authorisation procedure is documented but not built.

---

## 7. Open at handover, and worktrees

**No PRs were left open.** The §5.1-A wording hardening (turning the #611 gate from advice into a HARD GATE, with a pointer stub added at the top of §5.1 so a session following the promotion recipe cannot miss it) merged as PR #673. Verified: zero open PRs at handover.

**Untracked files:** `.ai/deepseek-sessions/` — created by the DeepSeek debates. **Scanned: no credential values.** It matches `.gitignore:28`, so it is deliberately ignored, not a mystery. Leave it or delete it; either is fine.

**Worktrees — 19 exist and this is well over any reasonable threshold.** Finished and safe to clean (this session's): `coldlion-key-ruling`, `rulebook-657`, `combined-20260810`, `hardening-663`, `prod-apply-660`, `warner-666`, plus the five source worktrees `issue-588`, `issue-607`, `issue-613`, `issue-623`, `nbcu-step3` (their PRs are superseded-and-closed, their commits are in `cbeda42`, and their **branches must be kept**).

Pre-existing and NOT mine to judge: `agents-md-ruling`, `csv-findings`, `handover-8b3f21c4`, `handover-addendum`, `merch-taxonomy-doc`, `pii-forward`, `prod-lane`, `resolver-gaps`.

**I deliberately cleaned none of them.** Use the `cleanup-worktree` skill; never improvise a forced removal, and never remove one that is dirty, locked, or held by a live process.

---

## 8. What we tried that did NOT work — MANDATORY

- **Merging the five PRs in any order.** No permutation exists. Proved, not assumed. Do not try again.
- **Stacking the PRs on each other.** Explicitly excluded: a stacked base makes Guard B compare against the stack tip and it fails identically.
- **Re-issuing the DDL under fresh version numbers** to dodge Guard B. Forbidden — all those versions are already applied to preview, so renaming orphans ledger rows.
- **`supabase db push` against preview.** Does not work here: preview's ledger holds versions whose files exist on no branch, so the CLI aborts with "Remote migration versions not found in local migrations directory". Every apply this session used `psql --single-transaction -v ON_ERROR_STOP=1` with the ledger row inserted in the same transaction.
- **Injecting `CHECK_SQL_MAIN_NEWEST` to test Guard B.** Invalid — it leaves `base_versions_file` empty, disabling the "only versions this branch ADDS matter" filter, so it flags all 400-odd historical migrations. Build a faithful simulation with a real ref instead.
- **`SET SESSION AUTHORIZATION` to test as a non-postgres user.** Impossible from this connection: Supabase's `postgres` login role is not a superuser (`rolsuper = f`). `service_role` is NOLOGIN, `supabase_admin`'s password is not in the vault, and neither `dblink` nor `pg_background` is installed. Closing this properly needs the `authenticator` role's password.
- **A SYMMETRIC co-presence rule.** Looked obviously correct and would have been a trap: `validate_candidates` refuses any allowlist containing an already-applied version, so after a run dies between a create and its fix, the ONLY legal recovery is the fix ALONE — which a symmetric rule would REFUSE, forcing an operator to edit the safety guard under pressure while production sat insecure. **The rules are one-directional on purpose.**
- **`gh run rerun` to pick up a new label.** Replays the stale payload with `PR_LABELS: []`. Close and reopen the PR instead — that fires `reopened` with a fresh payload.
- **Assuming a red CI check is current.** A guard can scan files its workflow's `paths:` filter does not watch, so a correct fix triggers no re-run and the old red X remains. Always open the run and check which SHA it ran against.
- **Trusting `check-dispatch-collision.mjs` to catch a version collision.** It compares OBJECT names. Two migrations sharing a version but no objects pass cleanly. See #670.

---

## 9. Facts I believe that may already be stale

- Every SHA, count and PR state in §1 — stamped 12:48Z, and this repo's own rule is that they go stale within the hour.
- **"~61 migrations behind"** — re-derived by three agents from git plus documents, **never from a live production read.** No agent this session made a production database call. Gate 0 of every licensor plan exists to close this.
- **The production ledger's 361 rows and head `20260802194100`** — quoted from `docs/verification/production-apply-set-and-rehearsal-20260809.md` dated 2026-08-09. A reconstruction matched it exactly, which is strong, but it is not a live read.
- **Whether `20260727230000` is on production** — matters for NBCU's foreign key onto `core.style_guide`. Unverified.
- **Whether the `api` schema is present on production** — created by `20260621150714_foundation.sql`, far below the head, but 33 missing migrations sort below the head so presence cannot be assumed. Matters for Warner.
- **Whether the capture files still match their pinned counts.** Taken from the contract doc, not from the private repo. **Live near-miss:** `links-property-character.csv` has a staged deletion in a local checkout; reading a working copy instead of the pinned commit silently loads ZERO links with no error. The new loader is designed so this cannot happen — it reads via `git show <commit>:` and refuses a dirty tree — but any other consumer is still exposed.
- **`verify_dry_run` has never executed successfully.** It is coupled to Supabase CLI 2.105.0 output wording. If it fails, suspect the parser before the migrations.

---

## 10. Do not let these enter circulation

- **"10,000 misattributed properties" does not exist.** It is a conflation of 9,973 PopDAM asset rows with a comparison nobody has run. Carried forward verbatim from the previous handover because it keeps resurfacing.
- **"44 migrations behind" and "47 migrations behind"** are both wrong. It is ~61.
- **"The files are too large to send in one request"** is disproved by measurement. 62 MB went through fine.
- **"Preview is clean."** It never has been.

---

## 11. Process findings worth acting on

- **#670 — no mechanical check covers migration-version allocation across branches.** A real near-miss this session: two agents were both handed `20260810130000`. Guard A sees one branch; the cross-PR check and the dispatch gate both compare objects, not versions. Caught only because the orchestrator read an open PR's file list. Until an atomic reservation exists, **every dispatch brief authorising a migration must state its version explicitly**, and the orchestrator must diff open PR file lists before merge.
- **#669 — a claim issue without the fenced ` ```db-claim ` block makes the collision gate exit UNKNOWN and refuse everything**, with no pointer to the offending issue. Exit 2 is correctly fail-closed; the problem is diagnosability and how easy a malformed claim is to create.
- **The second-opinion skills share a `brief.txt` filename.** A concurrent agent overwrote another's brief mid-flight tonight and DeepSeek answered about the wrong licensor entirely. Use uniquely named brief files. If the reply is about a topic you did not ask about, discard and re-run.
- **`ai-deepseek-agent` crashes printing its own reply on this machine** (`UnicodeEncodeError`, cp1252). Workaround: `PYTHONIOENCODING=utf-8`. One-line fix in `ai-devops`.

---

## 12. Secrets sweep and docs pass

**Secrets sweep: DONE. Nothing new to store.** Scanned the session, the diffs and the untracked files. `.ai/deepseek-sessions/*.json` contains no credential values (checked for `sbp_`, JWT, and connection-string patterns) and is gitignored. No credential value was written into any file, commit, report or chat this session. Credentials used were referenced by 1Password item ID only, from vault `vibe_coding`, fetched serially.

**Docs pass: done, and narrow by design.** `AGENTS.md` was corrected twice this session (the domain-ownership contradiction and the intake-retirement wording, PR #662; then §5.1-A for the lane, PR #667). A third PR hardening the #611 gate wording was dispatched at handover. Nothing else outside this file is now wrong. Two supersessions were recorded rather than rewritten: the ColdLion ruling, and the Warner read-gate claim.
