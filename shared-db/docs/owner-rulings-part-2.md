---
summary: Owner rulings verbatim, part 2 of 4: §6.6–§6.14 (10 sections); section list is in owner-rulings.md.
kind: living
status: current
read-when: a citation of AGENTS.md §6.6–§6.14 or the owner ruling text in that range
---

# Owner rulings and standing decisions (AGENTS.md section 6) — part 2 of 4

> Moved **verbatim** from [`owner-rulings.md`](owner-rulings.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

### 6.6 OWNER RULING — DB Data Admin is the home for licensor→property parentage (Albert Hazan, 2026-08-03) — this REVERSES the previous stance

> "DB Data Admin screen should be where we monitor and establish the licensor→property parent-child
> relationship. It sits in designflow now but we all agreed it should not be only in 1 particular
> application."
> — Albert Hazan, 2026-08-03

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not treat it as
an AI's preference, and do not weaken it.**

**This is a REVERSAL. The repository currently says the opposite in two places, and both are now
superseded by this section:**

| Where it still says the opposite | Exact text | Status |
| --- | --- | --- |
| `supabase/migrations/20260722170000_db_data_admin_single_record_updates.sql` (the `-- Refused here:` comment) | `-- Refused here: name/code (source vocabulary), is_potential (trigger-owned), PLM status (…), aliases, source refs, related Customer, Licensor/Property, merge, bulk, deletion.` | **Applied migration — DO NOT EDIT IT.** |
| `apps/db-data-admin/src/LicensorTree.tsx` (orphan panel copy) | "The relationship is DesignFlow-owned; do not repair it here." | Superseded; correct by a FORWARD change when the curation path is built. |

Both were verified verbatim against the tree on 2026-08-03. Near-identical "the edge is
DesignFlow-owned" wording also appears in `20260722203000_db_data_admin_licensor_property_tree.sql`,
in `20260727154500_db_data_admin_bounded_production_forward.sql`,
and in `apps/db-data-admin/tests/browser/grid.spec.ts`. All of it is superseded as
**policy**; the migrations remain accurate as **history**.

**The never-edit-an-applied-migration rule still wins.** `20260722170000` is applied. An applied
migration never re-runs, so editing its text changes **nothing** in the database and desynchronises
the file from the ledger (§4 rule 4). **Leave it alone.** `AGENTS.md` — this section — is the
governing statement of policy. The application copy in `LicensorTree.tsx` and the behaviour it
describes are corrected by a **forward** change, authored when the curation path is actually built,
never by rewriting history.

**The rule.**

1. **DB Data Admin (`apps/db-data-admin/`, `https://data.designflow.app`) is the home for both
   MONITORING and ESTABLISHING the licensor→property parent-child relationship.** "Refused here" no
   longer describes the intended product; it describes the state of the code before this ruling.
   **"The home" means the cross-application curation surface, NOT an exclusive owner.** Albert's
   objection is to the capability living inside one *line-of-business application* (DesignFlow);
   DB Data Admin is the shared administrative surface over `core.*` that every app's data flows
   through, which is why it is the answer rather than a second lock-in. The authority that matters
   is the **curated data in `core.*`**, which any app may read; DB Data Admin is where a human
   establishes it. Do not read this section as a licence to forbid some future second curation
   surface, and do not read it as permission to leave the capability in DesignFlow.
2. **The relationship is no longer DesignFlow-owned.** Any doc, comment, UI string, or agent
   assumption that says "DesignFlow is the single writer of `core.property.licensor_id`, repair it
   there" is stale from 2026-08-03 onward.
   **This deposes DesignFlow as the OWNER, not as today's mechanism.** Until the DB Data Admin
   curation path actually ships, DesignFlow PLM remains the **interim writer of record** and a
   parentage repair made there is legitimate. Do not disable, block, or "clean up" the DesignFlow
   path on the strength of this ruling — that would leave no repair path at all (see rule 4).
3. **This does not by itself authorise a write path.** It sets the destination. The actual editing
   capability is new work: it needs a bounded write contract in the shape of §6.1/§4.2 (whitelisted
   typed parameters, optimistic concurrency, audit rows, the existing
   `app.db_data_admin_feature_gate`), plus durability so the PLM importer cannot revert it — see the
   related rulings below. **Do not ship a raw editable `licensor_id` column in the grid.**
   **The refusal in `20260722170000` is executable, not merely documentary.** That migration's
   comment records a refusal the shipped write contract actually enforces, so DB Data Admin will
   *reject* a parentage write today no matter what this section says. That is correct and expected
   — policy moved first, capability follows. **A rejection from that contract is NOT a bug to route
   around**, and it must never be routed around with direct SQL, a service-role write, or an ad-hoc
   session (§6.4-C forbids that last one outright). It is removed only by the forward migration that
   builds the new bounded contract.
4. **Until that path ships, here is the ONLY compliant way to repair a wrong parent** — stated
   explicitly because three rules read together otherwise appear to forbid every route. In order of
   preference: **(a)** fix it in DesignFlow PLM, still the interim writer per rule 2, and let it
   flow through; **(b)** if it cannot be fixed upstream, author it as a **shared-db migration** in
   this repo — branch, PR, preview first, §5 checklist — recording the human decision, and where the
   decision is the owner's, record it in `core.taxonomy_owner_ruling` too. A migration that encodes a
   named human's decision **is** hand curation, and is exactly what §6.5's removal work does for
   property `FK`; it is not the "inferred from product data" thing that is banned. What is never
   permitted is **(c)** an ad-hoc session typing the fix straight into Master Data. Note the
   durability caveat in rule 5 applies to (a) and (b) alike on production.
5. **Durability is not yet in force on production, and §6.5 deliberately holds the fix.**
   `20260802170000` — the migration that stops `plm.import_master_data` force-setting
   `core.property.licensor_id` — is merged but **held from production by §6.5** until the FR removal
   work ships. So on production today, any parentage set by any route is still reverted on the next
   successful PLM master-data sync. Two consequences: **do not treat "we have a durability
   migration" as "curated parentage is durable"** when scoping the DB Data Admin write path — the
   write path must not be enabled on production before `20260802170000` is applied there; and do not
   try to unblock it by promoting `20260802170000` early, which §6.5 forbids. (The lane has not
   succeeded since 2026-07-08 — see §6.4 — which is currently masking the problem, not fixing it.)

**How this sits with the related standing rulings.**

- **Parentage is HAND-CURATED, never inferred.** Albert ruled on 2026-08-03 that the
  property→licensor parent link must live in a curated Supabase table — which today **is
  `core.property.licensor_id`**, the existing canonical column; the ruling requires that it be set
  by hand, not that a new table be invented, and no session should design one on the strength of
  this wording — and must **never** be derived
  from product data. Item/style co-occurrence is an **audit tool only** — it may flag a suspicious
  parent for a human to look at; it may never set one. A curation *screen* is exactly what a
  hand-curated link requires, so the hand-curation ruling and this section point the same way.
  (Recorded in the
  orchestrator intake as ruling 4.)
- **`dflow.*` is being retired; `core.*` becomes the source of truth for all applications.**
  Under the controlling 2026-08-16 architecture as clarified on 2026-08-19, ColdLion supplies
  canonical Licensor names, uncovered ColdLion-only Property truth, and Property Active/Inactive.
  Authorized licensor scrapes supply Property identity, ownership and source-published relationships
  inside their coverage. The stale DesignFlow pull supplies neither.
  **§6.6 is the direct consequence of this.** If `core.*` serves every app, the surface on which
  humans curate `core.*` must not be locked inside one application — which is precisely Albert's
  "it should not be only in 1 particular application". Building further curation into DesignFlow
  would deepen a dependency the plan of record removes.
- **§6.4 protects the result.** Curated parentage set in DB Data Admin is exactly the kind of
  deliberate human decision an import may never revert or re-parent. Note that
  `plm.import_master_data` on production **still force-sets `core.property.licensor_id` on every
  matched row** (§6.4), so until `20260802170000` is applied to production, parentage curated
  anywhere — DB Data Admin included — is not durable there.

**Controlling answer, clarified 2026-08-19:** ColdLion owns official Licensor names. The applicable
authorized licensor scrape wins for Property spelling and ownership inside its coverage. For a
ColdLion-only Property under a Licensor with no scrape data, ColdLion's Property name and owning
Licensor are canonical. ColdLion also decides whether a Property is Active or Inactive. DesignFlow
has no authority. See the central licensing architecture document.

### 6.7 OWNER RULING — branch protection on `main` is ON, and CI guards are no longer advisory (Albert Hazan, 2026-08-04)

> ### ⛔ READ THIS FIRST — two owner rulings on 2026-08-07 that change everything below
>
> **(1) `u2giants/shared-db` is PUBLIC, and it stays public.** It was made private at
> ~15:10 UTC on 2026-08-07 and **public again at ~16:5x UTC the same day, on Albert's
> explicit and twice-repeated instruction.** Do **not** make it private again, and do not
> re-raise the question.
>
> **(2) OWNER RULING — the Disney OPA property/character extract is NOT sensitive
> (Albert Hazan, 2026-08-07).** `docs/verification/opa-characters-20260806/opa-characters.csv`
> — 10,262 rows of Disney property and character names with Disney's own IDs — may stay in
> this public repository. Albert was told plainly, twice, that making the repo public
> republishes that file and that it had never been moved to `licensor-source-data`. He
> ruled: *"that data is not sensitive."* **He owns the Disney licensee relationship and
> this is his call to make. It is settled.**
>
> **What this supersedes.** Request **R-SEC-1** — in the retired `COORDINATOR_INTAKE.md` queue,
> readable only in history via
> `git show 360b85b3eec79c5f498cf9e669350737db27e6ab:COORDINATOR_INTAKE.md` — asks for that
> CSV to be moved out and scrubbed from git history before the repo can go public. **Its
> premise is overruled.** Parts (a) and (b) — move the file, leave a pointer — are now
> optional tidying, not a blocker. Part (c), the git-history rewrite, is **cancelled**;
> do not rewrite this repository's history for that reason. Part (d) is done.
> The private repo `u2giants/licensor-source-data` exists and holds only a README.
>
> **Why this is written here and not only in the queue.** A future session reading R-SEC-1
> on its own would make the repo private again, which silently destroys branch protection
> (see the note below). This ruling is the stop.
>
> **⚠️ The trap that caused it, worth keeping.** Going private **silently removed all
> branch protection**, because a private repository on this account's plan cannot have it.
> `gh api …/branches/main/protection` returned `403 "Upgrade to GitHub Pro or make this
> repository public"` and `…/branches/main` reported `protected: false`. Nobody noticed for
> about two hours. Protection was **restored in full** at 2026-08-07 after the repo went
> public again, and read back live to the exact table below. **Visibility and protection
> are coupled on this plan. Never change one without checking the other.**

Albert turned branch protection **ON** for `main` on 2026-08-04. This is a standing decision, ruled
by the owner. **It is settled — do not re-ask it, do not treat it as an AI's preference, and do not
weaken it.**

**The verified fact, not a claim.** Read back live and **RE-DERIVED on 2026-08-12** (previous
re-derivation 2026-08-06 16:00 UTC) with:

```bash
gh api repos/u2giants/shared-db/branches/main/protection
```

The 2026-08-14 read matched every row below exactly, including `Migration author lease`,
`Migration guarded merge authorization`, and **not** `Backlog / queue sync`; `strict: true`, `enforce_admins: true`,
`allow_force_pushes: false`, `allow_deletions: false`. **The table is accurate as of that date —
and you must still run the command rather than trust it.**

| Setting | Value |
| --- | --- |
| `required_status_checks.contexts` | `["Promotion contract tests (offline)", "Cross-PR object collision", "Tools offline tests", "SQL migration guards", "Domain ownership", "Intake pointer guard", "Handoff contract", "Migration author lease", "Migration guarded merge authorization"]` (**nine**) |
| `required_status_checks.strict` | **`false` as of 2026-08-19** (issue #1286). The `true` recorded here on 2026-08-06 is superseded history — see the note below. |
| `enforce_admins.enabled` | **`true`** |
| `allow_force_pushes.enabled` | `false` |
| `allow_deletions.enabled` | `false` |

> **SUPERSEDED AS CURRENT STATE — read this first (2026-08-19, issue #1286).** `strict` is
> **`false`** today, by Albert's later explicit ruling, and the table row above is history, not
> instruction. Requiring every branch to be up to date restarted the full check suite on every
> open branch after every unrelated merge, costing roughly **50 minutes a day**. Albert weighed
> that against the risk and turned it off deliberately. **It is not drift. Do not "fix" it, and
> do not restore strict mode on the strength of the 2026-08-06 paragraph below.** Only issue
> #1286 governs whether it is ever reconsidered, against the measured criterion recorded there.
>
> **What replaced the protection strict mode was providing.** The sibling-collision hole is real,
> and it is now closed at the merge point rather than by forcing every branch current:
> `.github/workflows/guarded-migration-merge.yml` re-runs collision and lease validation on a head
> that already contains current `main`, while holding the merge lock, and its context
> `Migration guarded merge authorization` is required. A pull request with no migrations is
> auto-authorized by `.github/workflows/migration-author-lease.yml`. So a colliding pair can no
> longer both merge, and unrelated PRs no longer restart everything. The header comments in
> `pr-object-collision.yml` and `check-pr-object-collisions.mjs` were corrected on 2026-08-23
> (issue #1366) because their old wording is what made a later plan propose reversing this ruling.
>
> **The 2026-08-06 history, preserved exactly as recorded then:**
>
> > **`strict` was turned ON on 2026-08-06, by the owner's explicit instruction.** It had
> > been `false`, which left a real hole: `.github/workflows/pr-object-collision.yml` says in
> > its own header that it cannot re-run when a *sibling* PR appears later, so the last
> > member of a colliding set must be re-checked — and *"require branches to be up to date
> > before merging"* is what forces that. With `strict: false`, two PRs could both pass every
> > check and both merge, silently erasing one another. That is the 2026-07-31 four-way
> > incident's exact mechanism. **Do not turn it back off.**
>
> ⚠️ **This table was stale for two days once already** — it read `strict: false` and four
> contexts after both had changed. A reviewing model (Grok 4.5, 2026-08-06) read it and
> concluded a *correct* document was wrong.
>
> **STANDING INSTRUCTION: never quote this table as fact. Run the `gh api` command above and
> quote the live output**, in any issue, handover, review, or PR description that turns on
> branch protection — and re-read it back whenever you change protection, stamping the new date
> here. This follows §4.3 (point at the live reading, never at a number). Prose asserting mutable
> state goes stale; the command does not. One row is an **owner ruling you may never weaken to
> make a check pass**: `enforce_admins` stays `true`. `strict` is governed by the later issue
> #1286 ruling above and is `false` on purpose.

**The rule.**

1. **CI guards on this repository are no longer advisory.** Merging through a red *required* check
   is now **mechanically impossible**, including for admins — `enforce_admins` is `true`, so there
   is no "orchestrator override". The event that motivated this ruling was real: on 2026-08-03 PR
   #431 was merged through a **red** `verify` check (run `30846938009`, job `91797438635`). That
   route is closed.
2. **`main` cannot be force-pushed or deleted.** Any recovery plan that assumes a rewrite of `main`
   is invalid. Fix forward.
3. **Branch protection must not be removed or weakened without an explicit, per-change owner
   instruction naming the setting.** "Unblock the merge", "CI is stuck", "fix the pipeline", or a
   deadline is **not** approval. If a required check is wrong, fix the check — never the protection.
   This mirrors the standing production-infrastructure rule: an AI session does not relax a control
   in order to get past it.
4. **Every PR to `main` — including a docs-only PR — must now pass all SIX required contexts
   before it is mergeable:** `Promotion contract tests (offline)`, `Cross-PR object collision`,
   `Tools offline tests`, `SQL migration guards`, `Domain ownership`, `Intake pointer guard`.
   *(Corrected 2026-08-07. This line said FOUR and listed four for days after there were six —
   re-derive the list with `gh api`, never from this sentence. `Backlog / queue sync` was
   removed and `Intake pointer guard` added on 2026-08-07 by owner instruction naming both.)* Confirm with `gh pr checks` before reporting
   a PR as ready, and check the run's `head_sha` — a green tick can be a **stale verdict from an
   older commit**. A green PR page is not the same as a satisfied required context.

**PATH FILTERING — where it still applies, and where this document was wrong.**
*(Corrected 2026-08-09, plan item F. This paragraph previously said BOTH database-touching
workflows were `paths:`-filtered and that neither could ever be required. That was stale, and
it discouraged the migrations-lane hardening it should have invited. Re-derive from the
workflow files, never from this sentence.)*

The mechanic is real: a `paths:`-filtered workflow reports **NO check at all** on a PR that
misses its paths, GitHub treats a required context that never reports as *pending forever*, and
making such a workflow required would **deadlock every unrelated PR**.

Measured live on 2026-08-09:

- `.github/workflows/shared-supabase-migrations.yml` is **NOT** path-filtered. Its `on:` block
  (`:4-9`) carries a comment saying the omission is deliberate, for exactly this reason. Its
  cheap `validate` job (`SQL migration guards`) runs on **every** pull request and is **already
  one of the six required contexts**. The expensive `preview` and `production-dry-run` jobs are
  gated on `workflow_dispatch`, not on paths.
- `.github/workflows/db-data-admin.yml` **IS** path-filtered (`:5-12`, `:15-22`) and therefore
  cannot itself become a required context. This does **not** leave domain ownership unguarded:
  the required `Domain ownership` context comes from the separate, unfiltered
  `.github/workflows/domain-ownership.yml` (`:26`).

**What is still honestly true.** The migrations lane's *cheap, static* guards block a merge; its
*expensive* jobs — the ones that talk to a real database — run only on `workflow_dispatch` and so
cannot block a merge. Do not let "protection is on" stand in for "a bad migration cannot be
merged": static SQL checks pass on a migration that is destructive at runtime. But do **not**
repeat the retired claim that path filtering makes hardening this lane impossible. It does not.

### 6.8 OWNER RULING — the six HARD_BLOCKED ColdLion migrations are NOT unblocked individually (Albert Hazan, 2026-08-04)

This is a standing **DO-NOT**, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference, and do not read it narrowly.**

**What is forbidden.** Unblocking any `HARD_BLOCKED` ColdLion migration **on its own** — one at a
time, a few at a time, or "just the safe ones". There is no size of subset that makes it allowed.

**What is permitted — one event, carrying all three parts together.** Any unblocking ships bundled
with:

1. **its negative test that proves the guard actually FIRES** (the backlog **B7** standard — an
   assertion that the guard *rejects* the bad input, not merely that the happy path passes); **and**
2. **a whole-batch pre-flight check that proves the ENTIRE promotion batch can run end to end** —
   not that the individual migration applies.

**Why, so a future session does not "helpfully" unblock one.** The production promotion lane
currently **ABORTS AT FILE 3 OF 14** — found by agent `prod-lane-design`, PR #403. A migration
unblocked on its own would therefore be handed to a lane that stops a third of the way through, and
production would be left **PARTIALLY PROMOTED**: some ColdLion migrations applied, the rest not,
with no undo (production changes here are forward-only). A half-applied taxonomy batch is worse than
an un-promoted one, because it looks finished. The pre-flight requirement exists precisely to catch
that before the first irreversible write, not after it.

**The count is SIX, not four — correct any document that says four.** Agent `hardblock-archaeology`
(PR #407) found **six** `HARD_BLOCKED` entries and confirmed the **42P01 (undefined table)** chain
behind them. Older docs say four. **A promotion list built from the old count ships a partial fix**
— which is the exact failure this ruling exists to prevent. Confirm the real scope live before
acting; do not inherit either number on trust.

### 6.9 OWNER RULING — the 33 unmatched ColdLion property codes are NOT admitted before the resolver is fixed (Albert Hazan, 2026-08-04)

> ### ⛔ SUPERSEDED 2026-08-20 — the codes ARE now admitted.
> Albert Hazan, 2026-08-20: **admit all 66 unmatched ColdLion property codes**, including the 51
> still marked active. The objection preserved below — that ColdLion has no licence-expiry flag, so
> admitting them resurrects lapsed licences — is answered by **owning the flag ourselves** rather
> than refusing the rows. `core.property.status` already accepts `inactive`.
>
> **The pairing is not optional:** the DB Data Admin application must gain a control to mark a
> property inactive on our side ([issue #1322](https://github.com/u2giants/shared-db/issues/1322)).
> Admitting without it recreates exactly the risk this ruling was protecting against.
>
> The original text is kept below as the reasoning, not as the current rule.

> "Fix the attachment logic first, then admit the codes."
> — Albert Hazan, 2026-08-04

This is a standing **DO-NOT**, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference, and do not reorder it.**

**The rule.**

1. **The 33 unmatched ColdLion property codes must NOT be admitted until the status-blind resolver
   is fixed first.** The order is not negotiable and is not a preference about sequencing
   convenience: the resolver is what decides which status each admitted code lands on, so admitting
   first means admitting **against the wrong statuses**, and every one of those rows then has to be
   found and corrected by hand.
2. **In that order, in ONE reviewed change — never the admission alone.** A PR that only admits the
   codes is out of compliance with this ruling even if the resolver fix is "planned next". The fix
   and the admission are reviewed together so the reviewer can see the codes land against a resolver
   that is already correct.
3. **When they are admitted, they go in as `potential`, NOT `inactive`.** This is Kimi's
   recommendation and it is **already accepted** — it is not open for re-litigation. Marking an
   unmatched code `inactive` silently hides what may be a real, live property; `potential` says
   truthfully that it exists and has not yet been reconciled.

**Relationship to the 2026-08-16 licensing architecture.** The admission moment still follows rule
3: a reviewed create-new row starts `potential`, never `inactive` or `active` by default. After its
ColdLion identity is durably mapped and a complete guarded membership cycle proves it is present,
the newer settled rule permits the separate status function to make it `active`. Thus "Potential at
admission" remains in force; it does not mean "stay Potential after successful mapping forever."

**A count caveat, stated so nobody launders it into a fact.** The figure was **66** at the
2026-07-31 handover and is recorded as **33** now. That reduction has **not** been independently
re-verified. Re-derive the real count at the time of the work; do not build the admission list from
this section's number.

### 6.10 OWNER RULINGS — the licensor/property model, and "the feed should not drop anything" (Albert Hazan, 2026-08-06)

Five rulings, all given the same day, all **settled**. Do not re-ask them, do not treat them as an
AI's preference, and do not reorder ruling 5.

**1. Coco IS a Disney license.** This closes the long-open question of whether `Coco` sitting under a
"NO LICENSE" licensor was deliberate. It was not. Detail and the resulting open technical question
live in [`fix_characters_style_guides.md`](../fix_characters_style_guides.md).

**2. The CODE alone is meaningless — the DESCRIPTION decides the licensor.**

> "If the CC is connected to a description that says Coco, it's Disney. If it says Coca Cola, it's
> under the Coca Cola licensor."
> — Albert Hazan, 2026-08-06

Never resolve a licensor from a property/item code by itself. Read the description that travels with
the row.

**3. Licensor → Property is parent-child, and property codes are NOT globally unique.** The same code
may exist under many licensors. `core.property` is keyed `(licensor_id, code)`
(`20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`, and see
[`docs/licensor-property-parent-child-design-20260802.md`](../docs/licensor-property-parent-child-design-20260802.md) §2.1).

> **This corrected a wrong assumption the orchestrator held on 2026-08-06, and that assumption is
> baked into at least one committed tool.** `tools/validate-licensing-answers.mjs` (the property
> lookup) resolves a property with `where p.code = any($1)` — no licensor scope.
> It selects the licensor name and then discards it; only `r.code` is used. It is safe **only**
> because today's `core.property` copy is crippled (256 rows, one row per code). **Repairing the feed
> before fixing that query would introduce silent wrong-licensor binding.** Fix the scoping FIRST.
> This is the same ordering principle as §6.9.
>
> Phrases like *"re-parent CC to Disney"* are not meaningful instructions and must not be planned in
> those words — say which `(licensor_id, code)` row you mean.

**4. "The feed should not drop anything."** The master-data feed must stop silently discarding rows.
There must be a **licensor/property triage page in DB Data Admin** (the app that serves
`data-dev.designflow.app`) where Albert fixes the problems the feed finds, instead of the feed
throwing them away. Requirement:
`docs/licensor-property-triage-page-requirement-20260806.md` (added 2026-08-06 on branch
`docs/licensor-property-triage-page-20260806`).

**5. STOP THE DATA LOSS FIRST — ordering ruling.** Asked whether to settle the storage question for
an ownerless property (nullable FK vs. a holding licensor vs. a quarantine table) before shipping, or
to stop the loss first, Albert chose **stop the loss first**. Ship quarantine/triage before settling
the model.

#### 6.10-A What was measured on 2026-08-06 (production `qsllyeztdwjgirsysgai`, read-only)

Recorded so nobody re-measures it, and so nobody quotes the one number that is **not** verified.

| Finding | Value |
|---|---|
| Supabase `core.*` vs DesignFlow | 26 licensors / 256 properties / 256 parent edges **vs** 82 / 614 / 503 |
| Why roughly half the tree never arrives | **By design** — the feed drops inactive properties, unparented properties, and childless licensors. This is the loss ruling 4 forbids |
| Parent data staleness | Every property row carries the same `updated_at`, **2026-07-08** — the day the PLM sync died. **29 days stale** as of 2026-08-06 |
| Sync ledger | All 15 sync runs recorded **"succeeded"**. The 502 is invisible in the ledger — never trust `sync_run` status as proof of freshness |
| Unparented properties in DesignFlow | 111, of which 51 active — VERIFIED live, matches the docs |
| `core.character` | **EMPTY on production** (0 rows) |
| `plm.item` | **EMPTY** (0 rows) — the modeled item master was built and never populated |
| `public.erp_items_current` vs `plm."itemHeader"` | 17,703 vs 19,563 rows; **14 items exist only in `plm."itemHeader"`** |
| The `CC` case | `core.property` holds one `CC` row named `COCO` under licensor `ZZ` (DTR - NO LICENSE). All **14** items filed there are Coca-Cola merchandise **by description**. Seven items under licensor `DY` (Disney) + property `CC` are genuinely Coco. The real COCA COLA licensor exists but is **INACTIVE with zero items** |
| Item numbering | `AAA00LLPP00` — chars 6-7 licensor, 8-9 property — holds for **~77%** of items |
| Parent edges pointing at a non-active licensor | **499 of 503.** Nobody knows what "inactive" means in this data — do not infer it |
| ⚠️ "241 of 322 property codes (75%) under more than one licensor" | **UNVERIFIED.** This figure has been quoted verbally but is recorded **nowhere** in the repo and was not reproduced on 2026-08-06. **Do not state 75% as fact.** Re-measure before using it |

#### 6.10-B Three corrections to statements already in this repo (2026-08-06)

1. **DB Data Admin lives in THIS repo**, at `apps/db-data-admin/`, despite serving a
   `designflow.app` hostname. Only the feed **endpoint** change is DesignFlow work. (Verified: the
   directory exists here.)
2. **The `NOT NULL` on `core.property.licensor_id` came from
   `20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql` lines 71–72**, not from the
   original `20260621150815` migration. (Verified against the file.)
3. **Blocker 8 was mis-stated across the handover docs.** The endpoint they cite is a **READ**
   endpoint. The real writer is `PATCH /api/admin/updateMerchGroup`
   (`designflow-backend/routes/admin.router.js:87`), and its real defect is that it is **type-blind**.
   Detail: `docs/licensor-property-cloudsql-cutover-plan-20260806.md` (branch
   `docs/licensor-property-cutover-plan-20260806`).

### 6.11 `DY` and `DS` are ONE company — the Disney licensor has two spellings (added 2026-08-07)

**`DY` in `core.licensor` is the canonical Disney licensor code. `DS` in the legacy
`public.licensors` table is the RETIRED spelling of the SAME COMPANY. They must never be treated as
two companies, and no session should re-open the question.**

This is not an inference. `supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
— merged and **already applied to production** — hard-codes the mapping in its own SQL:

```sql
case legacy.external_id
  when 'DS' then 'DY'
  when 'WWE' then 'WW'
  else legacy.external_id
end
```

That migration aborts loudly if any legacy licensor fails to map, and it did not abort. **136,697
`public.assets` rows and 10,618 `public.style_groups` rows were rewritten onto canonical
`core.licensor` UUIDs on that basis.** Current production data depends on `DS` = `DY` being right.

The full census — every Disney-related row in both licensor lists, the per-licensor child counts, the
4,048 `plm.style_tracker_item_bridge` rows that already carry the `DY` and `DS` UUIDs *on the same
row*, and the read/write map per application — is in
[`docs/verification/disney-licensor-identity-20260807/README.md`](../docs/verification/disney-licensor-identity-20260807/README.md).
**Read it there; do not duplicate or re-measure those numbers here.**

**The same shape exists for WWE, and nobody has documented it.** `public.licensors` spells it `WWE`;
`core.licensor` spells it `WW`. Identical class of duplicate, mapped by the same `case` expression
above, still undocumented and unfixed. Treat it the same way: one company, two spellings, `WW`
canonical.

**What this section does NOT authorise.** It is paperwork, not surgery (Albert chose "Option 2" of
that document on 2026-08-07). Retiring `public.licensors`, moving the ~500 legacy property records,
or re-parenting MARVEL and STAR WARS under DISNEY are all explicitly **out of scope and declined** —
ColdLion pays royalties off Marvel and Star Wars being separate licensors.

### 6.12 CORRECTION to §6.6 rule 5 — there is NO parentage-durability migration (added 2026-08-07)

**§6.6 rule 5 above says `20260802170000` is "the migration that stops `plm.import_master_data`
force-setting `core.property.licensor_id`". That sentence is WRONG.** Verified against the file on
2026-08-07; its own header block says the opposite:

> "The property UPDATE still sets `licensor_id = parent_core_licensor_id`. Whether our curated
> parentage should outrank DesignFlow PLM's is an owner decision nobody has made."

`20260802170000` preserves curated **`status` only**. **No parentage-durability migration exists
anywhere in this repository — not merged, not held.** So promoting `20260802170000` would not make
curated parentage durable, and §6.5's hold is not what is blocking durability. Any curated
`core.property.licensor_id` — set by DB Data Admin, by DesignFlow, or by a migration — is reverted by
the next **successful** `plm.import_master_data()` run.

The exposure is currently **dormant, not fixed**: the PLM master-data lane has not succeeded since
2026-07-08 (§6.4, §6.10-A), which is why every `core.property` row still carries that `updated_at`.
**Parentage durability must be built before the lane is repaired**, or every curated parent edge
silently reverts the moment it comes back. Do not treat "we have a durability migration" as "curated
parentage is durable".

### 6.13 OWNER RULINGS — Paramount landing tables and sub-licensors (Albert Hazan, 2026-08-07)

> ### ⚠️ TWO OF THESE FIVE RULINGS CHANGED ON 2026-08-09 — read this before quoting any of them
>
> **Owner ruling, Albert Hazan, 2026-08-09** (recorded by orchestrator session `8b3f21c4`,
> marker issue [#622](https://github.com/u2giants/shared-db/issues/622)):
>
> | Ruling | Status as of 2026-08-09 |
> | --- | --- |
> | 1 — per-licensor landing tables | **STANDS UNCHANGED** |
> | 2 — "release 1 is FIVE tables, not fifteen" | **SUPERSEDED.** The five-table cap is **lifted**. |
> | 3 — authorized-title count closed at 26 | **STANDS UNCHANGED** |
> | 4 — "build waits for the second Paramount recon" | **SUPERSEDED.** The hold is **RELEASED**; its condition was met. |
> | 5 — sub-licensors stay flat | **STANDS UNCHANGED** |
>
> The original text of rulings 2 and 4 is kept below, marked, because sessions have been
> quoting it. Do not act on the struck parts. The replacements are in §6.13-A.

Five rulings, all made on the evening of 2026-08-07, **two of them since superseded** (see the box
above and §6.13-A). Full record with the reasoning and the
costs: [`docs/verification/owner-rulings-20260807/README.md`](../docs/verification/owner-rulings-20260807/README.md).
Read that file before acting on any of them.

1. **Per-licensor landing tables, not one shared table.** Each licensor's raw scrape data gets its
   own `plm.*` tables. No shared multi-licensor landing table with a discriminator column. A shared
   table would force Disney's hard `CHECK`s to be softened for a licensor they have nothing to do
   with, and the importer's shrink-band guard counts rows in its own table — unscoped, a
   **completely truncated Paramount extract would pass by being measured against Disney's ~10,262
   rows**. Silent wrong answer, not a loud one.

2. ~~**Paramount release 1 is FIVE tables, not fifteen.**~~ **SUPERSEDED 2026-08-09 — see §6.13-A.1.**
   Original text, kept because it has been quoted:
   ~~Ships `plm.pmt_capture`, `pmt_property`,
   `pmt_character`, `pmt_property_character`, `pmt_asset`, plus importer, RLS/grants, one `api` view
   and contract tests. Eleven further tables, four views and the collection trigger are deferred —
   they model structure no capture has proven. **Known consequence: release 1 loads assets that
   connect to nothing.** It can answer which characters a property owns, but not which asset shows a
   character.~~

3. **The Paramount authorized-title list is 26, and the count is CLOSED.** The removed `902010`
   entry was a duplicate. Do not re-open it and do not hunt for a 27th title. The *"Viacom Multi
   (Paramount) — 27 codes"* section of
   [`docs/coldlion-unmatched-properties-by-licensor-20260731.md`](../docs/coldlion-unmatched-properties-by-licensor-20260731.md)
   is a **different population** (unmatched ColdLion property codes) — do not reconcile the two.

4. ~~**Build waits for the second Paramount recon.**~~ **SUPERSEDED 2026-08-09 — the hold is
   RELEASED; see §6.13-A.2.** Original text, kept because it has been quoted:
   ~~The five tables are designed, reviewed, revised
   and approved, but implementation is **held** until a targeted second recon returns. Each of its
   four open questions can move a primary key, and a wrong key with rows already in it costs a
   migration **plus** a data repair. Do not start the migration because "the design is approved".~~

5. **Sub-licensors stay FLAT.** ColdLion produced 19 new `- DESPERATE` records (5 licensors, 14
   properties). Desperate is a **sub-licensor, not the brand owner**: POP reports sales to Desperate,
   who files royalty reports upward to the real owner. FanCreations is the same shape for NCAA and
   NFL. `core.licensor` will **NOT** model this; Desperate is stored as an ordinary licensor.
   **Consequence, invisible in the data: any report answering "who is the licensor" for those 14
   properties returns Desperate, not the ultimate brand owner.** Also: `ANHEUSER BUSCH - DESPERATE`
   and the existing `potential` `Anheuser Busch` record are **NOT duplicates** — brand owner vs
   sub-licensed route. A future dedupe pass must not merge them.

### 6.13-A OWNER RULING — the Paramount five-table cap is lifted and the build hold is released (Albert Hazan, 2026-08-09)

Recorded by orchestrator session `8b3f21c4`, marker issue
[#622](https://github.com/u2giants/shared-db/issues/622). This supersedes **parts** of §6.13:
rulings 2 and 4 only. Rulings 1, 3 and 5 stand unchanged and are not reopened by this.

**Evidence anchor for everything below.** The completed second Paramount capture lives in the
**private** repo `u2giants/licensor-source-data`, branch `codex/paramount-creative-library-20260807`,
HEAD **`f340f74a`**, with its manifest. `u2giants/shared-db` is **public**: the counts and the
structural shapes below are cleared for publication; Paramount titles, property names, entity names,
source IDs, asset IDs and filenames are **not** and must never be committed here.

#### 6.13-A.1 — Ruling 2 is superseded: the full landing schema is approved

The **five-table cap is lifted.** Approved for build: the full **21-table** landing schema specified
in GitHub issue [#623](https://github.com/u2giants/shared-db/issues/623), **plus two further tables
the orchestrator approved the same day** — `plm.pmt_capture_expectation` and
`plm.pmt_shrink_override`.

**Why the original reason no longer holds.** Ruling 2 deferred sixteen tables because they
"model structure no capture has proven". The completed capture proves all sixteen. **Every one now
has a nonzero proven row count; none would land empty.** Counts from the capture at `f340f74a`
(258 batches, 25,790 asset records):

| Table | Proven rows | Table | Proven rows |
| --- | ---: | --- | ---: |
| `plm.pmt_capture_batch` | 258 | `plm.pmt_asset_collection` | 27,880 |
| `plm.pmt_authorized_title` | 26 | `plm.pmt_asset_brand` | 25,983 |
| `plm.pmt_authorized_title_property` | 38 | `plm.pmt_property_character` | 52 |
| `plm.pmt_franchise` | 18 | `plm.pmt_property_collection` | 426 |
| `plm.pmt_collection` | 426 | `plm.pmt_property_franchise_evidence` | 51 |
| `plm.pmt_brand` | 7 | `plm.pmt_authorized_property_asset` | 25,858 |
| `plm.pmt_asset` | 25,790 | `plm.pmt_relationship_anomaly` | 4 |
| `plm.pmt_asset_property` | 26,451 | `plm.pmt_property_capture_log` | 33 |
| `plm.pmt_asset_franchise` | 25,116 | `plm.pmt_property` | 60 |
| `plm.pmt_asset_character` | 8,558 | | |

**The original caution was honoured, not overridden.** Two things ruling 2 deferred are
deliberately **still not built**:

- **`plm.pmt_franchise_property` is NOT created.** The capture proves Paramount publishes **no
  direct property-to-franchise pair**. The approved build lands
  `plm.pmt_property_franchise_evidence` instead, hard-checked so it can never present itself as a
  direct relationship.
- **There is NO collection trigger.** Collections are exposed as style guides through a
  **read-only view over one table**, so the two vocabularies cannot drift apart.

**What is no longer true.** Ruling 2's "known consequence — release 1 loads assets that connect to
nothing" is **void**. The approved build ships the asset link tables, so the database can answer
*"which asset shows this character?"* from day one.

#### 6.13-A.2 — Ruling 4 is superseded: the build hold is RELEASED

The hold's condition **has been met**. All four questions the second recon had to answer are
answered, verified against the capture at `f340f74a`:

1. **The property field's full-metadata descriptor is `PROGRAM_ID`.** Exactly **seven** metadata
   field descriptors exist across all 258 batches and 25,790 asset records.
2. **Collections carry a real hidden identifier, not just a display label.** 426 collections, 426
   distinct numeric source IDs, one name each. The ID comes from a `source_id` **attribute on the
   cascade element** — it is not parsed out of a label — and the ID-to-name mapping is proven
   **1:1 across all 25,790 assets**.
3. **No character identifier recurs across more than one property.** 52 explicit property-character
   pairs, 52 distinct character identifiers, **zero** overlap. **This is the question that could
   have moved the `plm.pmt_character` primary key. It confirms the approved design rather than
   changing it.**
4. **The combined property-character value is a structured value, not a delimited string.** It
   carries `raw_value`, `display_value`, and an `elements` array of **exactly two** elements, each
   with `key`, `source_id` and `display_value`. **Four** assets are missing the second element's
   source ID — precisely the **4 preserved anomalies** in the manifest, which is why
   `plm.pmt_relationship_anomaly` shows 4 rows above.

Because no answer moved a key, the "wrong key with rows already in it" risk that justified the hold
did not materialise. Building is now the correct action.

### 6.14 OWNER RULING — this repository is PUBLIC; no personal identifiers in anything you write from now on (Albert Hazan, 2026-08-09)

`u2giants/shared-db` is a **public** GitHub repository. Every file, commit message, PR
description, issue comment and CI log is world-readable, permanently and without warning.

**The forward rule — applies to everything you author from 2026-08-09 onward:**

Never write a person's **email address, full name, phone number, home or personal address,
or any other personal identifier** into:

- any file in this repository (migrations, docs, plans, tests, tooling, fixtures, JSON artifacts);
- any commit message;
- any pull-request title or description;
- any GitHub issue or comment;
- any CI job name, step name, or log line.

**Refer to people by their `app.profile` UUID only.** That is the existing precedent in this
repo and it is unambiguous, stable, and discloses nothing. If a human reader genuinely needs
to know *who* a UUID is, that mapping lives in the database, not in a public file.

If a verification artifact would otherwise embed contact data (a JSON baseline dump, a diff
of a vendor or roster table, a test fixture copied from real rows), **do not commit it**.
Commit row counts, checksums, and UUID-keyed diffs instead.

**What is NOT covered by this rule.** Personal names that are *the data itself* — for example
the designer roster seeded into `core.person`, where the name is the business value being
stored — are legitimate schema content and stay. The rule is about *incidental* disclosure:
identifying a person in a comment, a doc sentence, a commit message, or a debugging note,
where a UUID would have done the same job.

**The already-committed occurrences STAY. Do not "fix" them.**

By owner ruling of 2026-08-09, migrations already merged to `main` that contain personal data
are **left exactly as they are**. This is a *known, accepted exposure*, not an oversight, and
not a task waiting for a volunteer. Two reasons, both hard:

1. **They are applied migrations.** The ledger keys on the version string, so an edited file
   will never re-run — editing changes nothing in any database and desynchronises the file
   from the ledger. One of them is also inside the pending production promotion set, where
   changing a single byte is far more dangerous than the disclosure itself.
2. **History rewriting was explicitly rejected by the owner.** No `filter-repo`, no
   `filter-branch`, no BFG, no force-push. Do not propose it again. The old copies exist in
   the public history regardless; scrubbing the tip would not recall them.

The two files, named here so nobody "discovers" them later and opens a well-meaning PR:

- `supabase/migrations/20260726210000_popdam_access_reconcile_legacy_gmail_and_designer_grants.sql`
  — a UUID followed by a comment naming a live work email address.
- `supabase/migrations/20260809170500_db_data_admin_product_depth_mutations.sql`
  — a person's full name in the header comment.

Both are **untouchable**. If you believe you have found a reason to edit either one, you have
not; re-read this section and stop.

**Wider standing exposure (recorded 2026-08-09, no action taken).** A repo-wide sweep on this
date found personal data far beyond those two migrations: several hundred third-party vendor
contact records (email, phone, address) inside a committed verification baseline under
`docs/verification/`, plus work email addresses in a dozen older docs, incident write-ups and
migrations. All of it predates this rule and all of it is already public. It is listed here so
future sessions know the sweep was done and the result was consciously accepted, not missed.
Removing any of it from the working tree does not remove it from history, so removal buys
nothing and costs review risk. **Do not start a cleanup pass without a fresh owner ruling.**
