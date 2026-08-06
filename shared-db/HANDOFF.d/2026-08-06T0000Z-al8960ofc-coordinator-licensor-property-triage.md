# HANDOFF — coordinator session, 2026-08-06, machine `al8960ofc`

**Session:** `bcc4eefe` — one coordinator, six sub-agents, all work delegated.
**Repo:** `u2giants/shared-db`. **Docs only.** No migration was written, no code changed, no
production write was made.
**Written by:** the `session-docs-update` sub-agent of that session.

> **Read `AGENTS.md` §6.10 first.** It carries the five owner rulings and the measured numbers in
> their permanent home. This file carries what is *unfinished*.

---

## 0. If you read nothing else

1. **GitHub issue #453 is still OPEN** — `COORDINATOR ACTIVE — session bcc4eefe — al8960ofc`. It is
   the coordinator marker. It could not be closed because github.com is unreachable from this
   machine. **Close it.** Until it is closed, another session may believe a coordinator is live.
2. **Four local branches are unpushed.** Nothing from 2026-08-06 is on GitHub. See §2.
3. **github.com is firewall-blocked outbound from `al8960ofc`.** DNS resolves; TCP 443, port 22 and
   `ssh.github.com:443` all time out. Google and npm are reachable, so it is a **targeted** block,
   not an internet outage. Escalated to Albert to raise with the IT manager; expect ~12 hours before
   anything moves. **Do not retry in a loop and do not attempt to push** until you have proven
   connectivity with a single check.

---

## 1. Background — why this session existed

The shared master-data feed that populates `core.licensor` / `core.property` in Supabase from
DesignFlow **silently drops rows**. Supabase holds 26 licensors / 256 properties / 256 parent edges;
DesignFlow holds 82 / 614 / 503. Roughly half the tree never arrives, **by design**: the feed drops
inactive properties, unparented properties, and childless licensors.

Albert ruled on 2026-08-06 that **"the feed should not drop anything"**, and that the fix is a
**licensor/property triage page in DB Data Admin** where he repairs what the feed finds, rather than
the feed discarding it. He also ruled the ordering: **stop the loss first**, before settling how an
ownerless property should be stored.

All five rulings, the full measured findings table, and three corrections to prior repo statements
are recorded in **`AGENTS.md` §6.10 / §6.10-A / §6.10-B**. They are not repeated here.

---

## 2. Current state — four unpushed local branches

All exist only in `C:\repos\shared-db`. **None is on GitHub.** Push all four and open PRs once the
firewall clears.

| Branch | Commit(s) | Contents |
|---|---|---|
| `docs/stale-sweep-and-laura-round3-20260806` | `1f7da17` | Laura round-3 licensing answers recorded as settled; the two owner rulings on Coco and code-uniqueness; a stale sweep of `HANDOFF.md`, `COORDINATOR_INTAKE.md`, `coordinator_take_over.md`, `fix_characters_style_guides.md` and one `docs/` file |
| `docs/licensor-property-cutover-plan-20260806` | `50dc0b4`, `1c5712b` | `docs/licensor-property-cloudsql-cutover-plan-20260806.md` — 824 lines, dependency graph, 6 phases, a folded-in Grok 4.5 independent review including one rejected finding |
| `docs/licensor-property-triage-page-20260806` | `29644f7` | `docs/licensor-property-triage-page-requirement-20260806.md` — the requirement for ruling 4 |
| `docs/session-docs-update-20260806` | this commit | Based on the stale-sweep branch. `AGENTS.md` §6.10, plan-file note, two `docs/` corrections, this handoff |

**Merge order matters:** `docs/session-docs-update-20260806` is based on
`docs/stale-sweep-and-laura-round3-20260806` and contains its commit. Land the stale-sweep branch
first, or land the session-docs branch and let it carry both. The other two branches are independent
(new files only) and will not conflict.

Per the repo rule, `shared-db` uses branch + PR and the AI merges its own PRs.

---

## 3. What is still open

### 3.1 Blocked on the network

- **Close issue #453.** One `gh issue close 453` once GitHub is reachable.
- **Push the four branches and open PRs.** Nothing else about them is unresolved.

### 3.2 Blocked on Albert — two decisions he owes

- **The 14 Coca-Cola items.** `core.property` holds one `CC` row named `COCO` under licensor `ZZ`
  (DTR - NO LICENSE). All 14 items filed there are **Coca-Cola merchandise by description**. Seven
  items under licensor `DY` (Disney) + property `CC` are genuinely Coco. The real COCA COLA licensor
  exists but is **INACTIVE with zero items**. Ask him: *should the 14 items move to the COCA COLA
  licensor, and should that licensor be reactivated?* Do not decide this for him and do not write a
  migration first.
- **How to store an ownerless property** — nullable FK, a holding licensor, or a quarantine table.
  He has already ruled **stop the loss first**, which favours shipping quarantine/triage before the
  model is settled. Frame the question that way.

### 3.3 Engineering work, not blocked on anyone

- **Fix the licensor scoping in `tools/validate-licensing-answers.mjs` BEFORE the feed is repaired.**
  The property lookup (~lines 86–92) runs `where p.code = any($1)` with no licensor scope; it selects
  the licensor name and discards it, using only `r.code`. It is safe *only* against today's crippled
  256-row copy where each code appears once. Repair the feed first and it will bind rows to the wrong
  licensor **silently** — the worst class of bug in this repo. Same ordering principle as
  `AGENTS.md` §6.9. Re-verify the line numbers; they drift.
- **Measure the real code-collision number.** A figure of *"241 of 322 property codes (75%) under
  more than one licensor"* has been quoted but is recorded **nowhere** in the repo and was **not**
  reproduced. A sub-agent was measuring it when this session ended and did not report back.
  **Do not state 75% as fact.** Re-measure and record the number with its query.
- **Build the triage page.** Requirement:
  `docs/licensor-property-triage-page-requirement-20260806.md`. It lives in **this** repo at
  `apps/db-data-admin/`, not in DesignFlow, despite serving `data-dev.designflow.app`. Only the feed
  **endpoint** change is DesignFlow work.

### 3.4 Security follow-up — needs Albert's approval, do not act unilaterally

- The read-only Cloud SQL credential (1Password `vibe_coding` item `tcaf3o3u2cx52g6ivvczxbhola`,
  user `albert_read_only`, instance `creatiflow-database`, SELECT only) had **its password emailed in
  plaintext on 2026-08-04**. It should be **rotated after the migration reading work is finished**,
  with Albert's approval. Standing rule: never rotate an existing credential without approval.
- A GCP service-account key was created this session for
  `sa-supabase-planning-proxy@lithe-breaker-323913.iam.gserviceaccount.com` (role
  `roles/cloudsql.client` **only**) and stored in 1Password `vibe_coding`, item
  `zjrrpl4yyotjbrfu56zayaj63i`. The local key file was securely deleted. Nothing outstanding — recorded
  so nobody creates a second one.

---

## 4. What we tried that did NOT work — do not repeat

- **Pushing to GitHub, in any form.** HTTPS 443, SSH 22, and `ssh.github.com:443` all time out from
  `al8960ofc`. `gh` fails for the same reason. DNS resolves fine, which makes it look like a transient
  failure — it is not. Do not burn a session retrying. Prove it with **one** check
  (`curl -m 5 https://github.com` or `gh auth status`) and stop if it fails.
- **Reasoning about licensor/property by code alone.** The coordinator held the assumption that
  property codes are globally unique for part of this session. It is **wrong**, Albert corrected it,
  and it is baked into a committed tool (§3.3). Any plan phrased as *"re-parent CC to Disney"* is
  built on that wrong model — name the `(licensor_id, code)` row instead.
- **Trusting `ingest.sync_run` status as proof of freshness.** All 15 runs recorded **"succeeded"**
  while the parent data sat 29 days stale (every `core.property` row carries `updated_at` =
  2026-07-08, the day the PLM sync died). The 502 is invisible in the ledger. Verify freshness from
  the data, never from the ledger.
- **Trusting cited line numbers and endpoint names in the handover docs.** Blocker 8 named a **READ**
  endpoint as the writer for the whole session-chain before anyone checked. The real writer is
  `PATCH /api/admin/updateMerchGroup` (`designflow-backend/routes/admin.router.js:87`) and its real
  defect is that it is **type-blind**. Re-verify every cited line before acting on it.

---

## 5. Verification evidence for what this docs pass claims

Checked against the working tree on 2026-08-06, not from memory:

- `tools/validate-licensing-answers.mjs` — the `where p.code = any($1)` query and the discarded
  `l.name as licensor` were read directly. **Confirmed.**
- `supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql` lines
  71–72 — `alter column licensor_id set not null`. **Confirmed**; it is not from `20260621150815`.
- `docs/dflow-parent-logic-and-curation-home-20260803.md` — the `2026-05-07 14:36:55` snapshot claim
  is present at the cited place. **Confirmed present**; the corrected value (2026-06-26) was measured
  live and could **not** be re-verified in this docs-only pass. Flagged as such in the doc.
- `apps/db-data-admin/` exists in this repo. **Confirmed.**
- `docs/licensor-property-parent-child-design-20260802.md` already documents
  `unique nulls not distinct (licensor_id, code)`. **Confirmed** — the schema was right; the sessions
  were not.
- **Could NOT be verified in this pass** (all require database or network access, both out of scope
  for a docs-only task): every row count, the `CC` item breakdown, the 29-day staleness, the empty
  `core.character` / `plm.item`, the 499-of-503 figure, the ~77% item-numbering rate, the state of
  issue #453, and `designflow-backend/routes/admin.router.js:87` (a different repo). They are recorded
  as **session findings measured live read-only**, attributed and dated, not as repo-verified facts.
  The 75% collision figure is recorded as **UNVERIFIED** everywhere it appears.

---

## 6. Completeness self-audit (required by `session-docs-update`)

Reread as if this conversation never happened.

**Q1 — could a brand-new developer with no project knowledge pick this up without skipping a beat?**
Yes. §0 gives the three things that block everything else; §1 gives the problem in plain terms without
requiring the reader to have seen the session; §2 names every branch, commit and merge-order
constraint; §3 gives every open item with who it is blocked on.

**Q2 — detailed enough to continue as well as the session could?** Yes. The one piece of knowledge
that lives only in a session's head — *why you must fix the resolver before repairing the feed* — is
written out with the mechanism (§3.3), not just the instruction. The failed approaches (§4) are the
other half of that, including the wrong model the coordinator itself held.

**Q3 — is every relevant detail present: background, goals, state, failures, decisions, constraints,
risks, next actions, verification?** Yes. Background §1, decisions and constraints in `AGENTS.md` §6.10
(linked, not duplicated, per the no-duplication rule), state §2, open work and blockers §3, failures
§4, verification and explicit non-verification §5. **Named gaps, deliberately left open rather than
guessed:** the true code-collision number, Albert's two pending decisions, and the ~12-hour network
wait. Each is labelled with what it is blocked on, so "open" never reads as "nobody got to it".

**Delete this file when:** issue #453 is closed, all four branches are merged, the resolver scoping is
fixed, and Albert's two decisions are recorded. Presence of this file means OPEN.
