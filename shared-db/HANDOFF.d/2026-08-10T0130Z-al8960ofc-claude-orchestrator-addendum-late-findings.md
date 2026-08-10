> **THIS IS AN ADDENDUM. It is not a standalone handoff.**
> Read it **together with**, and **after**,
> [`HANDOFF.d/2026-08-10T0030Z-al8960ofc-claude-orchestrator-nine-agent-fan-out.md`](2026-08-10T0030Z-al8960ofc-claude-orchestrator-nine-agent-fan-out.md)
> (merged as PR #638). That file is the main handover for orchestrator session
> `8b3f21c4` (marker issue #622, machine `al8960ofc`). It is **write-once and must
> not be edited**. Everything below happened **after** it was written and merged,
> plus a short list of corrections to it (§8).
> Where this file and the main handover disagree, **this file is newer**.

# Addendum — orchestrator session 8b3f21c4, late findings (2026-08-10T0130Z)

---

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this **whole list to the owner in one message, before starting work.** Do not
meet them one at a time.

### Blocking / urgent — a live security exposure

| # | Decision needed | Recommendation | What it blocks |
|---|---|---|---|
| 0.1 | **Rotate the ColdLion API key.** It is hardcoded in a **public** GitHub repo (`u2giants/popdam3`) and has been for 167 days. It is the real, current key. | **Rotate — but only in the exact order in §1.** Rotating first, without the missing config row, silently breaks PopDAM's licensor/property naming. | Nothing technical, but the exposure grows every day. Highest priority in this document. |
| 0.2 | **The same key is also in a second public repo** (`u2giants/ai-devops`, four archived Codex transcripts). Cleaning `popdam3` alone does not clear the exposure. | Treat 0.1 and 0.2 as one job. | See 0.1. |
| 0.3 | **Four other API keys sit as plain text in PopDAM's `public.admin_config` table**, not in a vault: `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`. | Move them to 1Password / Supabase Vault as a follow-up job. Not as urgent as 0.1 (they are not in a public repo) but they are not protected either. | Nothing today. |

### A wrong guess is recoverable, but rework is wasteful

| # | Decision needed | Recommendation | What it blocks |
|---|---|---|---|
| 0.4 | **The vendor contact baseline.** `docs/verification/master-data-designflow-reference-cutover-20260807/baseline.json` holds **208 email addresses, 98 phone numbers and 98 postal addresses** belonging to third-party vendors, in a public repo. Deleting the file from the tree removes nothing from history, and two live migrations plus a taxonomy doc cite it as evidence. | Put it to the owner as its own decision. My recommendation: leave the file, and treat it the way §6.14 already treats the two migrations — a **known, accepted, recorded** exposure — unless he wants the whole repo made private. | Nothing today. It is an open exposure nobody has ruled on. |
| 0.5 | **Move the `production-dry-run` job off the `production` GitHub environment**, so the human approval gate guards only the real mutation. | Do it. §2 below is the second time in two days the gate itself caused the failure. | Every future production rehearsal. |
| 0.6 | **`core.property` `EX` under `WB`** — create it, and decide whether to fix the nine Exorcist rows now. The owner **deferred** these pending the merch-group answer. **That answer is now in (§4) and he has not come back to them.** | Re-raise both. Warner Bros for The Exorcist is curated human data; no feed will ever supply it (§4). | The Exorcist data fix. |
| 0.7 | **`can_admins_bypass`** — should repository admins be able to bypass branch protection on `u2giants/shared-db`? Still unanswered. | Narrower than it sounds: the only admin is `u2giants`, the owner himself (§8). Still worth a yes/no. | Nothing today. |

### Already settled — do NOT re-ask

- **2026-08-09 — the SKU is overruled.** The Exorcist is Warner Bros. SKU coding
  does not decide licensor attribution. (Owner: Albert Hazan.)
- **2026-08-09 — personal data.** "Remove it going forward and accept the old
  copies exist." Implemented in AGENTS.md §6.14 + the `PII forward guard` CI
  check (PR #639, merged).
- **2026-08-09 — Paramount rulings 2 and 4** were superseded; see merged PR #632.

---

## 1. 🚨 URGENT AND UNRESOLVED — the exposed ColdLion API key

**This is the highest-priority open item in this document. It is NOT rotated.**

### What is exposed

The ColdLion ERP API key is **hardcoded in source** in `u2giants/popdam3`, which
is a **PUBLIC** GitHub repository (verified with `gh repo view` — `PUBLIC`):

- `supabase/functions/_shared/coldlion.ts:4` — a `const HARDCODED_KEY = "…"`.
  *(The main handover and the original brief said line 5; the file says line 4.
  The repo wins.)*
- `supabase/functions/_shared/admin-handlers/coldlion-handlers.ts:21` — the same
  literal again.

It entered history in commit `89c82fac` on **2026-02-24** (verified:
`git -C C:\repos\popdam3 log -1 89c82fac` → `Tue Feb 24 17:28:57 2026`). That is
**167 days** on `origin/main` of a public repo as of 2026-08-09.

**It is the real, current key.** It was compared byte-for-byte against the
1Password `vibe_coding` item titled *"Coldlion ERP API key x5.coldlion.com"*
without either value being printed. They match.

**It is in a second public repo too.** `u2giants/ai-devops` (also verified
`PUBLIC`) contains it in four archived Codex transcripts under
`codex_chats/4837/sessions/`, dated 2026-06-04, 2026-06-10, 2026-06-11 and
2026-07-01. **Cleaning `popdam3` alone does not clear the exposure.**

### ⛔ NEVER PRINT THE KEY VALUE

Do not `grep` for it, echo it, paste it into a command, or quote it in a PR,
issue, commit message or CI log. One agent in this session put it into a `grep`
command and the value is now in that session's transcript. Do not repeat that.
Search for the *variable name* (`HARDCODED_KEY`, `COLDLION_API_KEY`) and pipe
through `cut -d: -f1-2` so only file and line come back.

### The part that makes rotation dangerous — it is not a fallback

Both files *look* safe: they read a `COLDLION_API_KEY` row out of PopDAM's
`public.admin_config` table first, and fall back to the hardcoded literal.

**There is no `COLDLION_API_KEY` row in `public.admin_config` — not on production,
not on preview. There never has been.** The lookup has always missed. The
"fallback" is the only code path that has ever run. A silent fallback hid a
missing configuration for five months.

So **rotating the key first would take PopDAM's ColdLion integration down**, and
it would go down *quietly*: `_shared/coldlion.ts` wraps its fetch in a
`try`/`catch` that returns `{}`, so a dead key makes `licensor_name` and
`property_name` go null while the scan still reports success.

### The required order of operations

1. **CREATE** the `COLDLION_API_KEY` row in PopDAM's `public.admin_config`.
   **Create, not update — it has never existed.** Put the *current* key in it and
   confirm PopDAM still resolves licensor and property names.
2. **Rotate** the key with ColdLion.
3. **Update** (a) the 1Password `vibe_coding` item *"Coldlion ERP API key
   x5.coldlion.com"*, (b) the PopDAM `admin_config` row from step 1, and (c) the
   `COLDLION_API_KEY` GitHub Actions secret on `u2giants/shared-db`.
4. **Remove** both hardcoded literals from `popdam3` and open a PR.

`shared-db` itself is the robust side and needs no code change: the workflows
already read the secret and **fail loudly** if it is absent —
`.github/workflows/coldlion-licensor-property-production.yml:225,289,300` (with
an explicit missing-secret check at `:231`) and
`.github/workflows/coldlion-licensor-property-phase6-parallel.yml:207` (missing-
secret check at `:211-212`). All four line numbers verified at `origin/main`
commit `6a71e2f`.

### Two more facts worth recording

- ColdLion is plain **HTTP**, not HTTPS —
  `popdam3/supabase/functions/_shared/coldlion.ts:3` is
  `const COLDLION_BASE = "http://x5.coldlion.com/EhpApi"`. The key crosses the
  wire unencrypted on every call, rotated or not.
- `shared-db`'s own plan document already forbids exactly this. In
  `docs/coldlion-direct-sync-and-taxonomy-plan.md`, the *Secret* row of the
  design table says the ColdLion `X-API-Key` lives in **Supabase Vault**:
  *"Never hard-coded, never in git."* PopDAM never followed it.

### Status

**NOT ROTATED.** The owner has been told and has not yet given the instruction.
Rotating an existing credential without his approval is forbidden by standing
rule 8. Do not rotate it on your own initiative — raise it as item 0.1.

---

## 2. The two failing workflow runs — both diagnosed, both EXPECTED, nothing mutated

Both are runs of the `Shared Supabase Migrations` workflow
(`.github/workflows/shared-supabase-migrations.yml`). Verified with `gh run view`.

### Run #333 — id `31342963264` — EXPECTED, harmless

- `workflow_dispatch` on branch `issue-588-warner-starlabs-source`, SHA
  `02597d85` (that is the current head of open PR #637).
- Failed in the `preview` job at the **`Apply preview`** step with
  `Remote migration versions not found in local migrations directory`, listing
  **seven** versions.
- **It aborted at the migration-history check, before any SQL ran.** Nothing was
  applied, nothing mutated.
- **Why it is expected:** five PRs are in flight and each has already applied its
  own migration to the shared preview database. Any single PR branch is therefore
  missing the other branches' migration files locally. This is the known merge
  deadlock described in the main handover, showing up as a red run.

### Run #332 — id `31342955746` — EXPECTED, and the more interesting one

- `workflow_dispatch` on `main`, requested SHA `4f26099`.
- Failed in the `production-dry-run` job at the **`Verify exact main commit`**
  step, with a bare `exit 1` and no message.
- **Cause: it sat on the `production` environment approval gate from 23:52Z to
  02:38Z — nearly three hours.** In that window two commits landed on `main`
  (`8a22946`, then `6a71e2f`), so by the time the gate released, `origin/main` no
  longer equalled the requested SHA `4f26099`. **The guard correctly refused.**
- **No Supabase call was made.** It failed at a `git` comparison.

### `main` is GREEN

The last 15 workflow runs on `main` are all `success` except #332. Two red runs in
the list are not a broken pipeline.

### ⚠️ THE OPERATIONAL LESSON (state it as a lesson, not a fact)

**A human approval gate that waits hours guarantees the run it gates goes stale.**
The gate defeats itself. Therefore:

- The production rehearsal must be **re-dispatched against the current `main` tip
  and approved within minutes**, not hours. Do not send the owner an approval link
  and walk away.
- This strengthens the already-recorded — and still unapproved — proposal to move
  `production-dry-run` off the `production` environment, so the approval gate
  guards only the actual mutation. See §0.5.

---

## 3. Owner rulings given after the main handover was written

All from Albert Hazan, 2026-08-09.

- **OVERRULE THE SKU.** The Exorcist is **Warner Bros**. SKU coding does not decide
  licensor attribution. (This is what §4 then tested against the ColdLion feed.)
- **PII: "remove it going forward and accept the old copies exist."** Implemented
  — see §5, PR #639.
- **Deliberately DEFERRED by the owner:** creating `core.property` `EX` under
  `WB`, and whether to fix the nine Exorcist rows now. He deferred both *pending
  the merch-group answer*. **That answer has now been given (§4). Both are still
  open and he has not returned to them.** Re-raise them (§0.6).

Still unanswered after this session: rotate the ColdLion key; the wider credential
hole; `can_admins_bypass`; the vendor contact baseline; moving the dry-run off the
production environment.

---

## 4. The merch-group answer — a clean negative that closes a line of inquiry

**The question the owner asked:** does the ColdLion merch-group feed carry the
*correct* licensor for The Exorcist, even though the SKU is wrong?

**The answer: it does not, and it structurally cannot.**

- **MG05** is a licensor **code-to-name dictionary**. **MG06** is a property
  **code-to-name dictionary**. **Neither carries any link between them.** MG05 for
  `NB` says "NBC". There is no merch-group record anywhere tying `EX` to any owner.
- `plm.erp_property` **has no `licensor_id` column at all.** Across 570 property
  and 44 licensor records, the complete set of JSON keys ColdLion has ever sent is:
  `companyCode, createdTime, createdUser, divisionCode, itemNoCode, mgCategory,
  mgCode, mgCode2, mgDesc, mgTypeCode, modTime, modUser`. **Zero** records carry
  `licensorCode`, `licensor`, `parentCode` or `mgParent`. `mgCategory` is empty on
  all 614.
- PopDAM slices `NB` out of the SKU (`popdam3/supabase/functions/_shared/sku-parser.ts`,
  the regex at ~line 147) and then asks ColdLion "what is `NB`?" (~line 171, the
  `licensor_name` lookup). MG05 answers that correctly. **PopDAM never asks — and
  cannot ask — who owns The Exorcist.**

**Consequences, and these are the parts to carry forward:**

1. The feed is **structurally incapable of disagreeing with the SKU**. So there is
   **no "how many differ" number**. The question has no denominator. Do not go
   looking for one.
2. **Warner Bros for The Exorcist must be recorded as curated human data** — the
   same route as the earlier Coco ruling. No feed carries it.
3. Both `EX` rows in the ColdLion mirror are `resolution_status = 'unresolved'`.
   The ColdLion lane has already flagged this property as needing a human.
4. **Production's ColdLion mirror is completely EMPTY.** `plm.merch_group_header`,
   `plm.erp_licensor` and `plm.erp_property` all have **0 rows on production**,
   versus 8 / 44 / 570 on preview. That lane has only ever run on preview. Anyone
   reasoning about "the ColdLion data" on production is reasoning about nothing.

---

## 5. Merged after the main handover

- **PR #638** — the main handover itself. Merged `2026-08-10T00:12Z` as `8a22946`.
- **PR #639** — merged `2026-08-10T00:25Z` as `6a71e2f`. Two things:
  - **`AGENTS.md` §6.14** (line 1501 at `6a71e2f`) — the forward-only personal-data
    rule. This repo is public; never write a person's email, full name, phone
    number or other personal identifier into any file, commit message, PR body,
    issue comment or CI log. Refer to people by `app.profile` UUID. Names that
    **are** the data (the `core.person` designer roster) are explicitly out of
    scope. The section also **names the two already-merged migrations** that
    contain such data and records that they **STAY** — a known, accepted exposure,
    so nobody "discovers" them later and opens a PR.
  - **A new CI check, `PII forward guard`** (`.github/workflows/pii-forward-guard.yml`).
    It scans **only the lines a PR ADDS**, computed from the merge base, so every
    pre-existing occurrence is invisible to it *by construction*. **Email-shape
    only** — names have no machine-detectable shape and a noisy guard gets ignored.
    Failure messages print **file, line and domain, never the value** (the CI log
    is public too). Escape hatch: the `pii-guard-allow` label. Nine negative-path
    self-tests run first in the same job.

### A much larger PII finding — UNRESOLVED, needs an owner decision

`docs/verification/master-data-designflow-reference-cutover-20260807/baseline.json`
contains **208 email addresses, 98 phone numbers and 98 postal addresses**. These
are **third-party VENDOR contacts**, in a public repo.

It was **deliberately not touched**, for two reasons:

1. Two live `20260809` migrations and `docs/merch-group-taxonomy-architecture.md`
   cite it as provenance. Deleting it breaks the evidence chain.
2. Removing it from the working tree removes **nothing** from git history.

Work email addresses also appear in roughly **12 further files and 8 further
migrations**. Recommendation on record: put the vendor baseline to the owner as
its own decision (§0.4).

---

## 6. Two deliverable files, rescued from the scratchpad into this PR

The owner asked for two prompts to hand to a PopDAM session. They existed **only**
in this session's ephemeral scratchpad, which does not survive. **This PR commits
both verbatim** — not rewritten, not shortened — under a new `docs/prompts/`
directory:

- **`docs/prompts/popdam-temporary-stop-writes-prompt.md`** — a **TEMPORARY**,
  clearly-labelled stop-the-bleeding change for `u2giants/popdam3`. It stops PopDAM
  overwriting `licensor_code`, `licensor_name`, `property_code`, `property_name` on
  `public.assets` on every scan. The key asymmetry it explains: those four **text**
  columns are rewritten on every scan (so any database correction is destroyed on
  the next pass), while the two **FK** columns `licensor_id` / `property_id` are
  null-only fill (so corrections there survive). Stop the text writes and the data
  becomes fixable; leave them running and every repair silently reverts. Named
  write sites: `_shared/sku-parser.ts:147` and `:168-178`,
  `agent-api/index.ts:923`, `_shared/admin-handlers/metadata-handlers.ts:157`.
- **`docs/prompts/popdam-stop-folder-derivation-prompt.md`** — the companion,
  covering the second wrong derivation path: reading the licensor out of a folder
  name at a fixed position in the asset path.

Neither file contains a secret or an email address (checked before copying).

---

## 7. Late agent work (after the main handover)

### PR #635 — PopDAM OrderList Step 1, the shared database contract (issue #613)

- Branch `issue-613-popdam-order-list`, head **`4dc893eb`**, CI green, **open**.
- The `link_dam_order_line` ambiguity gap is fixed in migration `20260810100000`:
  it now counts **distinct `plm_item_id`** with **no item predicate**.
- **The ruling the agent took, with orchestrator agreement:** automatic `matched`
  is **refused** on a cross-item tie, but a **human may break the tie** via
  `manual` — only to an item the SKU genuinely resolves to, and the tie is recorded
  in `metadata.link_candidate_item_count`. **Why:** the strict reading would make
  the 449 ambiguous rows permanently unresolvable by *anyone*, human included.
- Behaviour tests went **33 → 38**.
- Confirmed read-only that the cross-item shape **does not exist in live data
  yet**: `plm.style_tracker_item_bridge` has 15,533 rows but **0 with a non-null
  `plm_item_id`**, and `plm.item` has **0 rows**. It becomes live the moment
  `fix_schema_for_api.md` Phase 4 repoints the bridge — at which point there are
  **70 duplicate licensed SKUs and 5 duplicate generic**.

### PR #636 — Paramount Creative Library (issue #623)

- Branch `issue-623-pmt-creative-library`, head **`6ae0b2a0`**, CI green, **open**.
- **The find:** `service_role` held **TRUNCATE** on all 23 Paramount tables, and
  **TRUNCATE does not fire row triggers.** Every immutability trigger there is
  `BEFORE UPDATE OR DELETE FOR EACH ROW`, and a row-level trigger cannot carry the
  TRUNCATE bit. So the immutability guarantee stated in the table comments — and
  apparently proven by the contract tests — could have been erased **in one
  statement**, by the exact role the importer runs as.
- Fixed in migration `20260810090000`, which also moves the target guard ahead of
  the empty-chunk return and corrects eight `%L` format specifiers.
- ⚠️ **`20260810090000` is UNAPPLIED to any database.** It needs a preview apply
  before this PR can merge.

### PR #634 — NBCU Creative Asset Factory landing schema (issue #628)

- Branch `nbcu-step3`, head `f09e018c`, **open**.
- Migration `20260810080000` revokes the default-granted write privileges.
- Contract test D went from **70 passed / 17 failed** to **87 passed / 0 failed**.
  Whole suite: **160 passed, 0 failed**.

### Issue #640 — FILED, high priority

`u2giants/shared-db` issue **#640**, *"HIGH PRIORITY: reconcile the four licensor
source extracts against `core.property` and `core.licensor`"*, state OPEN. Filed on
the owner's instruction. **Nobody has ever run that comparison.**

The issue deliberately separates three figures that were being conflated:

1. the **9,973 PopDAM asset rows** whose licensor foreign key disagrees with their
   own licensor code;
2. **ColdLion carries no licensor↔property link at all** (§4);
3. the **scrapes have never been compared to anything**.

⚠️ **Do not let a "10,000 misattributed properties" figure enter circulation. It
does not exist.** It is a conflation of (1) and (3).

---

## 8. Corrections to the main handover

The main handover is write-once and stays as it is. These are the corrections.

1. **Preview holds SEVEN unmerged migrations, not six:** `20260810010000`,
   `20260810020000`, `20260810050000`, `20260810060000`, `20260810070000`,
   `20260810080000`, `20260810100000`.
   **`20260810030000` is NOT on preview** — the Warner STARLABS migration was never
   applied (its dispatch is run #333 in §2, which aborted at the history check).
   The seven figure matches the seven versions run #333 listed as missing.
2. **`main` has moved past `4f26099`.** Two further commits landed: `8a22946`
   (PR #638) and `6a71e2f` (PR #639). `origin/main` is at `6a71e2f` as of
   2026-08-10T0130Z. **Re-derive the tip before dispatching anything.**
3. **The only repository admin is `u2giants` — the owner himself.** Owner type
   `User`; the repo is public. So the `can_admins_bypass` question is narrower than
   it sounds. **The credential hole is not narrower**, because the `gh` CLI on this
   machine (`al8960ofc`) is authenticated *as him*, and therefore holds admin.

---

## 9. Everything we tried that did NOT work (additions to the main handover's list)

These are **new** dead ends from after the main handover. The main handover's own
list still applies; read both.

1. **Sending the owner an approval link and letting the run wait.** Run #332 sat on
   the `production` approval gate for nearly three hours. Two commits landed on
   `main` in that window and the SHA guard correctly refused the now-stale run.
   *Why it seemed reasonable:* the gate exists precisely so a human signs off, and
   humans are not instant. *Why it failed:* the guard compares the requested SHA
   against `origin/main` **at execution time, after the gate**, not at dispatch
   time. **A gate held for hours defeats itself.** Re-dispatch against the current
   tip and get approval within minutes — or move the dry-run off the production
   environment (§0.5).
2. **Telling an agent that preview held six migrations when it held seven.** The
   orchestrator passed a stale count. The agent caught it by checking the database
   itself rather than trusting the brief. *Lesson:* the migration set on preview
   changes every time any of the five open PRs applies; **never quote it from a
   handoff, always re-derive it.**
3. **Assuming the ColdLion merch-group feed could adjudicate the licensor.** Hours
   went into "does MG05 agree with the SKU?" before establishing that MG05 and MG06
   are two disconnected dictionaries with no link between them, and that
   `plm.erp_property` has no `licensor_id` column at all (§4). *Lesson:* check
   whether a data source **structurally can** answer a question before measuring
   how often it agrees.
4. **Reading the `admin_config` lookup in `popdam3/_shared/coldlion.ts` as proof
   the key was configured.** The code reads config first and falls back to the
   literal, which looks safe. The config row has never existed, so the "fallback"
   is the only path that has ever run (§1). *Lesson:* a fallback is not evidence
   that the primary path works — check for the row.
5. **`grep`-ing for the key value to confirm it matched 1Password.** That put the
   secret into a session transcript. Compare by hash or by variable name and line
   number instead; never by value (§1).

---

## 10. Exact next steps — the next session's first five actions

Do these in order.

1. **Put §0 to the owner in ONE message**, leading with the ColdLion key (0.1/0.2).
   *You'll know it worked when:* he answers, and in particular says yes or no to
   rotating the key. **Do not rotate it before he says so.**
2. **Re-derive the truth before touching anything.** Run
   `git fetch origin && git log --oneline -3 origin/main`, `gh pr list --state open`,
   and list the migrations actually present on preview. Do **not** trust the counts
   in any handoff, including this one.
   *You'll know it worked when:* you can name the current `main` SHA, the open PR
   numbers with their head SHAs, and the exact preview migration list.
3. **Apply `20260810090000` (PR #636) to preview.** It is the only unapplied
   migration among the open PRs and it fixes a real security hole (TRUNCATE on 23
   Paramount tables).
   *You'll know it worked when:* the preview apply succeeds and the Paramount
   contract tests still pass with `service_role` no longer holding TRUNCATE.
4. **Re-dispatch the production rehearsal against the current `main` tip and get it
   approved within minutes.** If the owner is not available right then, do not
   dispatch — wait.
   *You'll know it worked when:* the `production-dry-run` job clears the
   `Verify exact main commit` step instead of a bare `exit 1`.
5. **Work the merge deadlock** described in the main handover, now with the
   corrected seven-migration preview set from §8.1.
   *You'll know it worked when:* at least one of PRs #631, #634, #635, #636, #637
   merges to `main` with a green run.

---

## 11. Unassigned work — nobody is on these

| Item | Where it is written up |
|---|---|
| Rotate the ColdLion key, in the four-step order | §1 / §0.1 |
| Remove the key from `u2giants/ai-devops` archived transcripts | §1 / §0.2 |
| Move the four plaintext API keys out of PopDAM's `admin_config` | §0.3 |
| The vendor contact baseline decision (208 emails, 98 phones, 98 addresses) | §5 / §0.4 |
| Move `production-dry-run` off the `production` environment | §2 / §0.5 |
| Create `core.property` `EX` under `WB`; fix the nine Exorcist rows | §3 / §0.6 |
| Issue #640 — reconcile the four licensor extracts against `core.property` / `core.licensor` | §7 |
| Hand the two `docs/prompts/` files to a PopDAM session | §6 |
| Load the ColdLion mirror on **production** (it is empty: 0/0/0 rows) | §4 |

---

## 12. Access and environment (unchanged from the main handover unless noted)

- Machine `al8960ofc`, Windows 11, PowerShell 7 primary.
- Repo `u2giants/shared-db`, **public**. Branch + PR always; the orchestrator
  merges. `origin/main` at `6a71e2f`.
- `gh` CLI authenticated as `u2giants` — **that is the owner, and he is the sole
  repository admin.**
- Git identity confirmed this session: `git var GIT_COMMITTER_IDENT` →
  `Albert Hazan <u2giants@users.noreply.github.com>`.
- Secrets live in 1Password vault `vibe_coding`. Relevant item title: *"Coldlion
  ERP API key x5.coldlion.com"*. **Never write a secret value anywhere.**
- The Supabase MCP is read-only. Applies go through the GitHub workflow or the
  Management API query endpoint. The preview ledger is unreliable — verify against
  the database.
- **This addendum was written with no database calls at all.** Every database
  figure quoted here was reported by the sub-agent that measured it, and is
  attributed as such; re-verify before acting on any of them.
- Worktree used: `C:\repos\shared-db\.claude\worktrees\handover-addendum`, branch
  `handover-addendum`, cut from `origin/main`.

---

## 13. Self-audit

1. **Could a brand-new developer pick this up?** Yes. §1 gives the urgent item with
   file, line, repo, dates and the exact ordered remediation. §2 explains both red
   runs. §10 gives five ordered actions with verification gates. The pointer at the
   top prevents reading this without its parent.
2. **As effectively as I can right now?** Yes. The non-obvious things — the
   fallback that was never a fallback, the gate that stales its own run, MG05/MG06
   being disconnected dictionaries, TRUNCATE not firing row triggers, preview
   having seven not six migrations — are all written down in §1, §2, §4, §7, §8.
3. **Every relevant detail?** Yes: background (§1, §4), current state (§5, §7, §8),
   failures (§9), decisions (§0, §3), constraints (§12), next actions (§10),
   verification evidence (line numbers and SHAs verified against `origin/main` at
   `6a71e2f` with `gh` and `git`).
4. **Reading ONLY §0, would the owner see every decision he owes?** Yes — swept
   §1–§12 line by line. §1 → 0.1/0.2/0.3. §2 → 0.5. §3 → 0.6, 0.7. §5 → 0.4. §7's
   items are worker tasks, not owner decisions, and appear in §11. Nothing in §4,
   §6, §8, §9, §10, §12 requires his ruling.

**Corrections found while verifying against the live repo, where the brief was
wrong and the repo won:** the hardcoded key is at `coldlion.ts:4`, not `:5`; the
`shared-db` design document's Vault requirement is in the *Secret* row of the
design table in `docs/coldlion-direct-sync-and-taxonomy-plan.md`, cited here by
row rather than by a line number that will drift.
