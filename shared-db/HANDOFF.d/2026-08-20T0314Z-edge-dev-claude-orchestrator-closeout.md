---
issue: 1225
status: OPEN
owner: claude-20260820-030000Z
---

# Orchestrator closeout — session `claude-20260820-030000Z` (edge-dev)

Marker: **#1293** (close it when you open yours). Predecessor marker #1229, already closed.
Ingested `HANDOFF.d/2026-08-20T0200Z-edge-dev-claude-orchestrator-closeout.md` sections 3, 6, 9.

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**Put this whole list to Albert in ONE message, before starting work. Do not trickle it out.**

### Nothing in this session's own work needs him

All three priorities he set were completed without a single owner decision. The
approval ritual stayed retired; no technical risk was put to him.

### Still waiting on him from earlier sessions — unchanged, NOT re-asked here

**#1291 is the live list and I did not touch it.** It carries three items: the queue
triage, the ColdLion phases 2-6 priority call, and two questions already answered.
Read #1291 rather than re-deriving them.

### One thing I would raise, outside this workstream — recommendation included

**The reviewer tooling is costing real money and real hours, and it is now measurable.**
Today all three active reviewers misreported their own results (§5.3). I lost roughly
forty minutes to it and destroyed one complete, correct review by acting on a wrapper's
status field. The substantive fixes are small and belong in `ai-devops` (#45 and the
three logged here).

**Recommendation:** authorise a short, focused pass on the four wrapper defects
(#1296, #1297, #1298, ai-devops#45) before the next big promotion batch, rather than
paying this tax on every review. **One word is enough: yes, or later.**
It blocks nothing today — every promotion this session still completed.

### Already settled — do NOT re-ask

| Settled | When | What |
|---|---|---|
| Reviewer roster | 2026-08-19 | Stop Kimi, restore GLM, use Muse, hold Gemini. **Implemented and merged today** (`cef67d6`). Done. |
| Owner sign-off on technical risk | 2026-08-18 | **RETIRED.** Never ask him to approve SQL risk. |
| Standing authorization | recorded on marker #1169 | Act without per-step approval. Evidence discipline unchanged. |
| Scrape data visible to Licensing | 2026-08-19 | **Now live in production.** This was #1288. |
| Withdrawn assets are marked, never deleted | 2026-08-19 | Basis of #1275. |
| `COORDINATOR_INTAKE.md` | 2026-08-07 | Retired and unwritten. Leave it that way. |

---

## 1. What this application is

`u2giants/shared-db` is the **governed source of truth for the structure** of a shared
Supabase Postgres database used by several POP Creations applications (DesignFlow PLM,
PopDAM, PopPIM, PopCRM and licensor-data ingestion).

- **Production database:** `qsllyeztdwjgirsysgai` — the real one. Never write to it outside
  the governed workflow.
- **Preview database:** `mvpkijzfmfcxhnzqogzs` — rehearsal only. Rebuilt 2026-08-18, which
  is why some evidence pinned to the *old* preview ref is permanently unusable.
- The repo holds SQL migrations in `supabase/migrations/`, one file per change, named with
  a 14-digit version. **The repo is FORWARD-ONLY:** a migration is never edited after it
  lands; a later migration supersedes it.
- Structure changes go: author on a branch → PR → independent review → rehearse on preview
  → guarded merge → promote to production through an evidence-gated GitHub workflow.
- **Ordinary application row data is NOT this repo's job.** Only structure.

**The orchestrator role** (this session) coordinates: it holds the map of claims, lanes,
PRs, preview state and promotions. Up to three migration authors at once; preview apply,
merge and production promotion are strictly one at a time.

---

## 2. What we set out to do, and why

Albert set three priorities plus routine lane refill:

1. **#1288** — promote `20260819151510`, the **Licensing read access** migration. His own
   owner ruling ("scrape data should be visible to Licensing department users"), merged and
   behaviourally proven, one governed step from production, and blocked only because its
   preview rehearsal predated PR #1265's workflow change.
2. **#1289** — promote `20260819212002`, the **Sesame Workshop landing**. Rehearsed, no
   blocker, previous session simply ran out of time.
3. **#1290** — make the **reviewer roster change** he decided on 2026-08-19.
4. Then refill the lanes from `--queue-audit`.

---

## 3. Current state — what is true right now

**`origin/main` = `918ba31`. Re-derive before trusting: main moved SIX times during this
session** (`ee8aaea` → `55f0eb7` → `b172cf3` → `29c84e8` → `9aa74ef` → `cef67d6` → `918ba31`).

- **Lanes: 0 of 3 occupied. No open `db-claim` issues. No expired claims.**
- **Working tree `C:/repos/shared-db` is on `main`, clean, nothing untracked.**
- **`node scripts/manage-migration-author-lanes.mjs --queue-audit` now reports
  `fullyAudited: true`** — zero unclassified, zero unlabelled, zero malformed. It was
  `false` at session start; §5.5 says what I fixed.
- Open PRs, **none of them mine**: **#1270** was merged by another session during this
  session; **#1269** (EP001 filter ruling) and **#1212** (`docs/slim-agents-handoff`) remain.
- Worktrees: `C:/repos/shared-db` (main, clean), `.claude/worktrees/docs-slimming`
  (PR #1212, **not mine**), `C:/repos/shared-db-worktrees/preview-provenance` (**not mine**).
  **Every temporary clone I created is deleted.**
- **Another session is actively working #778** (orphan `designflow` schema). It held the
  Grok per-repo review lock twice and starved me for ~15 minutes. Do not assume you are alone.

### Production `qsllyeztdwjgirsysgai` — TWO migrations applied this session

| Version | What | Evidence |
|---|---|---|
| `20260819151510` | Licensing read access — 28 tables, WildBrain + NBCU | apply run `32326682504` |
| `20260819212002` | Sesame Workshop (NetX) landing — 19 tables | apply run `32326991448` |

**Both verified by reading production's own `supabase migration list` INSIDE the apply run,
not the workflow's word.** Post-apply ledger lines, both columns populated:

```
20260819151510 | 20260819151510 | 2026-08-19 15:15:10
20260819212002 | 20260819212002 | 2026-08-19 21:20:02
```

**STILL NOT on production:** `20260818203751` (mgCategory), `20260819011639` (PopDAM lease),
`20260819151527` (FR authorization), `20260819151536` (superseded by `20260820004338`,
permanently unappliable — do not try).

### Preview `mvpkijzfmfcxhnzqogzs`

Unchanged by this session. **The historical-recovery lane performs NO database write**, so
the two recovery runs I made touched nothing. Preview is still missing four migrations
production has (`20260817124545`, `20260817150944`, `20260817225127`, `20260818174350`) —
tracked as **#901**, and it is why `20260819151527` still cannot be rehearsed.

### Merged this session

| PR | Commit | What |
|---|---|---|
| **#1295** | `cef67d6` | Reviewer roster: restore glm-5.3, pause kimi-k3, add muse. Two review rounds. |
| **#1300** | `918ba31` | `.gitignore` now covers `.ai-review/` in-repo, not only via machine-local `.git/info/exclude`. |

### Closed this session

**#1288**, **#1289**, **#1290**, **#1203** (superseded by #1290).

### Opened this session

**#1296**, **#1297**, **#1298** — all three are reviewer-tooling defects found by hitting them.

---

## 4. Everything that did NOT work — read this before repeating it

### 4.1 I aborted a live, correct review because I trusted a status field

`ai-glm show` reported `last_activity_at` identical to `created_at` for what looked like 25
minutes, `status: active`, and the wrapper had printed nothing. Every signal matched the
documented "session that never produced a turn" failure. **I aborted it.**

`ai-glm transcript` showed it had been working the whole time and working *well*: it had read
all 364 lines of the migration, confirmed the house predicate was character-identical to
Sega's at `20260819015333:1298`, confirmed no later migration alters those objects, and had
independently spotted the packet defect I later filed as #1296. It had not reached a verdict,
so **all of it was unusable and thrown away.**

**Rule, now filed as #1298: never judge a GLM session dead from `ai-glm show`. Read
`ai-glm transcript`.** More generally — *never record a reviewer failure from a wrapper's
summary or status field; read the raw provider stream.* A wrapper's status is a claim about
the provider, not an observation of it.

### 4.2 I claimed a fix that was false, and the reviewer caught it

PR #1295 originally asserted that a three-name rotation removes the `replaceFailedReviewer`
same-provider trap. **grok-4.6 returned REVISE with a High and proved it false:** the refuse
fires after `N-1` assignments since the failure for **any** `N`. Three names moves the
collision from one intervening assignment to two, and two is the *natural rest point of a
three-name parallel dispatch* (Grok takes a PR and holds its per-repo lock, GLM the next,
Muse the third, cursor lands on a multiple of three). Corrected; real fix is **#1297**.

**Lesson: a plausible-sounding safety property in a comment is a claim, and it needs the same
evidence as code.**

### 4.3 Pre-holding the workflow's own locks — cost two full cycles

I acquired `refs/db-coordination/preview` and later `refs/db-coordination/production` by hand
before dispatching the workflow. **The workflow acquires both itself.** Both runs died with
`REFUSED: refs/db-coordination/... is occupied`.

**No database write occurred either time** — both failed before touching anything. But each
cost a full cycle. **The lock is the workflow's to take. Stay out of its way.**

### 4.4 "Isolating" a review with a local-path clone does not isolate it

To avoid the packet collision I cloned the repo and checked out the exact PR head.
`git rev-parse HEAD` was right, the file content was right — and the wrapper **still built its
packet from `C:/repos/shared-db`**, because the clone's `origin` pointed there. The reviewer
was shown main while being asked about a PR branch.

**grok-4.6 returned Critical and refused to review**, naming the four ways the tree it saw was
the wrong one. **Nothing mechanical caught this.** Re-run from a clone of the **GitHub remote**
and the packet head was correct. Filed as #1296.

**Do not use `git clone <local-path>` to isolate a review. Clone from GitHub. And verify the
`evidence packet: ... (base X, head Y)` line the wrapper prints — the working tree agreeing
proves nothing.**

Also: `ai-review-sandbox ensure` echoes the path back unchanged in an ordinary clone. That is
documented behaviour, not a fault, but **it is not the safety net it looks like.**

### 4.5 Two reviewers in one checkout overwrite each other's evidence packet

Grok and GLM, started concurrently from `C:/repos/shared-db`, both wrote `.ai-review` and the
second landed on top of the first mid-review. `ai-grok-review`'s in-flight lock is
per-repository **for Grok only** — nothing stops a cross-wrapper collision. #1296.

### 4.6 A `VERDICT:` grep matched the echoed prompt, not a verdict

My wait loop fired early because the brief itself contains the string `VERDICT: APPROVE or
VERDICT: REVISE`. **Match `^VERDICT: (APPROVE|REVISE)` at line start**, and expect the prompt
to be echoed into the transcript.

### 4.7 Grok's per-repository lock starves you

Another session took the Grok lock twice, once within seconds of my attempt. There is no
queue. I released the production merge freeze rather than hold other sessions hostage while
blocked on reviewer capacity — **that was the right call and I would do it again**, at the
cost of one redone recovery run.

---

## 5. Root causes and key findings

### 5.1 The historical-recovery lane works, end to end, and is now proven

`20260819151510` was refused because its rehearsal predated PR #1265's workflow change, and it
could not be re-rehearsed (already in preview's ledger; a rehearsal runs once). **The refusal
was correct and was never argued with.** The stale evidence was *replaced*:

| Step | Run | Result |
|---|---|---|
| Read production's ledger directly | `32325033662` | `20260819151510` local-only; all six prerequisites applied |
| Historical recovery (no DB write) | `32326335248` at main `29c84e8` | success, digest `sha256:e6bdd0b8…` |
| Immutable review evidence, APPROVE | `32326420209` | digest `sha256:fdb47102…` |
| Production dry-run, full chain | `32326449124` | success |
| Production apply | `32326682504` | **success** |

The business-risk gate passed **twice** — pre-approval derivation and post-wait re-derivation.
**No guard, `if:` condition or artifact name was edited.**

**`20260818203751` (mgCategory) is the same shape. Route it the same way. It is the next
promotion to attempt.**

### 5.2 Check whether rehearsal evidence is stale before assuming it is

For Sesame I did **not** redo the rehearsal. One command decided it:

```bash
git diff 41b8f74b5fb7179e3d314b3b121eaba88b30d161 origin/main -- .github/workflows/shared-supabase-migrations.yml
```

**Empty** — so the workflow that produced its evidence is byte-identical to the one on main,
the original rehearsal (`32309958178`, digest `sha256:501f5161…`) was still valid, and the gate
accepted it. **Run this every time.** It is the difference between reusing evidence and paying
a full recovery cycle.

### 5.3 All three active reviewers misreport their results — each differently

| Reviewer | Failure mode |
|---|---|
| **grok-4.6** | Refuses to save its report on a **false** git-ignore negative (`git check-ignore` returns non-zero for a directory that does not exist yet, even with a matching rule). Output is stdout-only. |
| **muse-spark-1.2-contributor** | Returns **zero bytes**, does not appear in `ai-muse list`. The full 10 KB review is on disk under `.ai/reviews/`. |
| **glm-5.3** | `last_activity_at` does not move during a live turn (§4.1). |

**Grok saves nothing and prints; Muse prints nothing and saves; GLM does both but lies about
being alive.** No single check covers all three — which is exactly why the standing rule is
*read the raw provider stream*, not *check the wrapper's output*. It was load-bearing three
times today.

### 5.4 Apply-time cost: only statements that execute during apply count

Muse's Sesame review drew the distinction the promotion turned on. The heavy row counts a skim
would flag — `count(*)` at `20260819212002:1550`, the `EXECUTE format` loop at `:1588`, the
exclusion-honesty census at `:1807-1816` — are **inside the bodies of `begin_sesame_capture`
and `complete_sesame_capture`**. At apply time they are stored function source, not executed
code. `20260819151536` stranded because it violated this **at the top level**, not inside a
function. Both apply-time `DO` blocks here are catalogue-only.

### 5.5 What made `--queue-audit` report `fullyAudited: false`

Five separate causes, all now fixed:

- **#1298** — I created it without the `db-work` label. My own miss.
- **#1286** — had a valid scope block, no `db-work` label.
- **#1276** — had the label, no scope block. Added: `plm.sega_asset_property_inferred`, `api.source_capture_inventory`.
- **#1275** — had the label, no scope block, and needed **25 tables enumerated**. See §9.
- **#778** — malformed claim: `schema:designflow` with a **colon**. The parser wants
  `schema designflow` with a **space** (`CLAIM_KINDS` at `scripts/manage-migration-author-lanes.mjs:228`).
  One character. I fixed only the syntax and did not touch the substance, because another
  session owns that work.

### 5.6 glm-5.3's pause was a false diagnosis, now proven behaviourally

`ai-glm doctor` failed exactly one check — `health endpoint answers` — because the local
`opencode` server was not running. **`ai-glm server start` fixed it in about thirty seconds.**
It then produced the review that cleared #1288 for production. One stopped local process cost
a two-day reviewer outage.

---

## 6. Exact next steps

1. **Promote `20260818203751` (mgCategory) through the historical-recovery lane.** It is the
   same shape as #1288, which is now proven. Read §5.1 for the exact input set, and #1200 for
   why the pre-merge rehearsal stranded it. **Do NOT merge PR #1194 — a review showed it is
   the wrong fix and it is parked as a draft.**
   *You'll know it worked when:* production's own `supabase migration list`, read inside the
   apply run, shows `20260818203751 | 20260818203751`.

2. **Resolve #901 — preview is missing four migrations production has.** Until then
   `20260819151527` (FR authorization) cannot be rehearsed and the guard correctly refuses,
   naming the missing table.
   *You'll know it worked when:* a preview dry-run of `20260819151527` passes hard-guard preflight.

3. **#1199 / `20260819011639` (PopDAM lease) is blocked on the app team, not on us.** Do not
   burn a lane on it. Confirm the app side before touching it.

4. **Fix the reviewer wrappers — see §0 for the owner ask.** #1296 (packet isolation +
   Grok's false git-ignore negative), #1297 (skip the failed provider), #1298 (GLM liveness),
   ai-devops#45. Each is small; together they remove a tax paid on every single review.
   *You'll know #1297 worked when:* the test `N-1 intervening assignments still strand a
   replacement on the failed provider` **fails** — rewrite it to assert the skip, do not delete it.

5. **Refill lanes.** `--queue-audit` heads are **#1090**, **#1225**, **#1199**, all trackers.
   The genuinely dispatchable authoring work behind them is **#1283 / #1284 / #1239** — all
   three touch `api.source_capture_inventory` and should be ONE migration that re-derives the
   current body. **Re-derive from the CURRENT body on main, never from the migration that
   first created the view.**

6. **#1275 needs two design questions answered before it can be dispatched** — see §9. No lane
   required; it is a read-only decision.

7. **#678 / #679 / #680 / #681** — Disney, Paramount, NBCU, Warner promotions. Still open from
   an earlier session, still never started.

---

## 7. Constraints and gotchas in force

- **Preview is `mvpkijzfmfcxhnzqogzs`. Production is `qsllyeztdwjgirsysgai`. Prove the target
  immediately before every write, and quote the proof.**
- **Main moves constantly** — six times this session. Re-derive `origin/main` immediately
  before every dispatch, rehearsal input and promotion input.
- **Merge PRs in ascending migration-version order**, or pay a governed supersession per PR.
- **For any "what does the database currently do" question, read the CURRENT object definition
  across ALL migrations plus the production ledger** — never the migration that first created
  the object. This repo is forward-only. That mistake put a wrong decision in front of Albert
  on 2026-08-19.
- **A verify block inside a migration is production code.** Assert shape from the catalogue;
  count rows only inside your own tables. See §5.4.
- **Never accept a bare verdict as review evidence.** Require a coverage statement. If a
  wrapper's output looks truncated or absent, read the raw provider stream (§5.3).
- **Never pre-hold the preview or production coordination refs** (§4.3).
- **Do not run two reviewers concurrently from the same checkout**, and **do not clone from a
  local path to isolate one** (§4.4, §4.5).
- **The owner-decision approval ritual is RETIRED for technical sign-off.** Never ask Albert to
  sign off on technical risk.
- **Standing owner authorization:** act without per-step approval. Evidence discipline unchanged.
- **`COORDINATOR_INTAKE.md` stays retired and unwritten.**
- **A claim must declare EVERY object the SQL writes** — indexes and policies included.
- **`--replace-failed-reviewer` REFUSES when the PR is merged**, which is every production
  promotion. A failed reviewer on a promotion cannot be repaired through the tool.

---

## 8. Access and environment

- **Machine:** `edge-dev`, Windows, working copy `C:/repos/shared-db`.
- **Authenticated CLIs:** `gh` (GitHub), `supabase`, `gcloud`, `az`, `vercel`, `op`.
- **Git identity verified this session:** `Albert Hazan <u2giants@users.noreply.github.com>`.
- **Reviewer wrappers** in `C:/repos/ai-devops/bin/`: `ai-grok-review`, `ai-glm`, `ai-muse`,
  `ai-kimi`, `ai-qwen`, `ai-gemini`, `ai-review-sandbox`.
  - **`ai-glm` needs its local server up:** `ai-glm server start`, then `ai-glm doctor` should
    report zero FAIL. This is the #1298 trap.
  - Grok holds a **per-repository** in-flight lock at
    `~/.local/state/ai-devops/grok/locks/`. Check it before assuming Grok is available.
- **Active reviewer rotation as of `cef67d6`:** `grok-4.6`, `glm-5.3`, `muse-spark-1.2-contributor`.
  Retired: `qwen-3.8-max`, `glm-5.2`, `kimi-k3`.
- **Secrets:** 1Password vault `vibe_coding` only. **No secret value was written to any file,
  commit, issue or comment this session.** Serialize 1Password reads; never fan them out.

---

## 9. Open questions and risks

- **#1275 cannot be dispatched until two questions are answered** (2026-08-20). I enumerated
  25 tables into its `objects:` list from the migrations on main, but **three of seven licensor
  families have no table literally named "property" or "style guide"** and I guessed:
  WildBrain → `wildbrain_guide` (excluded `era`, `creative_group`); Peanuts → `peanuts_art_program`;
  Sesame → `sesame_brand`. **I also excluded every join table, every `*_capture` table, and
  Warner's `*_normalized` mirrors.** Whoever authors it must decide the join-table question
  explicitly rather than inherit my omission. Left `status: blocked` for exactly this reason.
- **#1275's premise is now stale and I flagged it on the issue** (2026-08-20): it says Sesame
  has no tables yet. **Sesame landed and reached production today.** Its own advice — that a
  new landing schema should carry lifecycle columns from the start — **was already missed once**.
  That guidance is now more urgent, not less.
- **Risk: `20260819151536` is permanently unappliable** and superseded by `20260820004338`.
  It must never ride along in a promotion allowlist. I verified this session's allowlists
  contained exactly one version each.
- **Risk: reviewer capacity is a single point of failure.** Grok's per-repo lock plus another
  active session starved me for ~15 minutes. Three names buys capacity, **not** freedom from
  the #1297 wraparound refuse.
- **Decision (2026-08-20): I released the production merge freeze while blocked on a reviewer**
  rather than hold other sessions' merges hostage. Cost: one redone recovery run, which writes
  nothing. I would do it again.
- **Decision (2026-08-20): I did NOT force a round-3 review on PR #1295** over one loose phrase
  Grok explicitly called "not a finding" (the comment says Muse "takes the slot kimi-k3's pause
  vacates"; strictly, restored glm-5.3 sits at that index and Muse is a new one). Prose accuracy
  did not justify another full review cycle. Recorded so nobody thinks it was missed.
- **Uncertain: whether #1283 / #1284 / #1239 should be one migration or three.** They all
  rewrite `api.source_capture_inventory`, so three separate PRs would each need to re-derive
  the others' body. **My recommendation is one migration.**

### Handoff files retired by this session

Deleted under the successor rule, both recoverable from git history at parent commit `918ba31`:

- **`HANDOFF.d/2026-08-19T0050Z-al8960ofc-claude-orchestrator-closeout.md`** — its issue
  **#1205 is CLOSED**. Every open obligation it named is carried on a live issue: **#1188**
  (dead preview ref), **#1200** (stranded mgCategory / PR #1194 is the wrong fix), **#1291**
  (Albert's queue triage; its **#1166** is closed).
- **`HANDOFF.d/2026-08-19T0810Z-edge-dev-claude-orchestrator-closeout.md`** — same workstream
  and same issue (#1225) as the 2026-08-20T0200Z file that superseded it. Its next steps 1, 2,
  3 and 5 are all now done (#1198 promoted, #1219 merged, #1221/#1222 merged, #1217 Peanuts
  landed and applied); steps 4, 6 and 7 are carried in the 0200Z file's §6 and in §6 above.

**`HANDOFF.d/2026-08-20T0200Z-edge-dev-claude-orchestrator-closeout.md` is KEPT** — its issue
#1225 is still open and three of its five promotions remain outstanding.

---

## 10. How to verify all of this yourself

```bash
gh issue view 1293 --repo u2giants/shared-db                       # this session's marker
node scripts/manage-migration-author-lanes.mjs --audit             # expect 0/3 lanes
node scripts/manage-migration-author-lanes.mjs --queue-audit       # expect fullyAudited: true
gh run view 32326682504 --repo u2giants/shared-db --log | grep 20260819151510
gh run view 32326991448 --repo u2giants/shared-db --log | grep 20260819212002
```

The last two print production's own ledger before and after each apply, read from production
itself — not the workflow's summary.

---

## 11. No sub-agents were dispatched

This session used **no sub-agents**. All work was done directly by the orchestrator. The only
delegated work was **independent review**, through the approved reviewer wrappers, and every
review is recorded verbatim on its issue or pull request:

- **grok-4.6** — PR #1295 rounds 1 and 2, and the refusal on the wrong-commit packet.
- **glm-5.3** — #1288 promotion review (APPROVE).
- **muse-spark-1.2-contributor** — #1289 promotion review (APPROVE).
