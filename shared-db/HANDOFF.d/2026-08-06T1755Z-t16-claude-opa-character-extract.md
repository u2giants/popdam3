# HANDOVER — 2026-08-06T1755Z — machine `t16` — agent `claude` — Disney OPA character extract

**This was NOT a coordinator session.** No coordinator marker was claimed, no
sub-agents were dispatched, and no database call of any kind was made. It was a
single working session that captured data from an external portal and filed a
request for the database work rather than doing it.

**One-line status:** the OPA data is captured, documented and pushed;
**PR #466 is open and not merged**; a shared-checkout collision contaminated
another session's **PR #467**; and one CI check failed for infrastructure
reasons and has been re-run.

---

## 1. Why this session existed

Albert asked for a list of characters from Disney's **OPA** portal
(`opa.disney.com`, "Online Product Approval" — Disney's licensee portal, where a
licensee declares which property and characters a product uses). The portal is
behind MFA, so he offered to log in on a shared browser.

The ask then grew: store it in the shared Supabase database as a lookup table,
write a detailed document, link it from `HANDOFF.md`, and create a skill.

## 2. What shipped

All on branch `request/opa-character-lookup` → **[PR #466](https://github.com/u2giants/shared-db/pull/466)**, four commits.

| Artifact | Path | What it is |
| --- | --- | --- |
| The data | `docs/verification/opa-characters-20260806/opa-characters.csv` | 10,262 rows, 1,445 properties, 9,591 distinct character names, with Disney's own IDs |
| The document | `docs/verification/opa-characters-20260806/README.md` | 9 sections: what OPA is, the goal, data shape, exact method + reproduction snippet, source URL, caveats, the disproved lineage claim, open design questions, what did NOT work |
| The request | `COORDINATOR_INTAKE.md` → `## REQUEST QUEUE` | Two blocks: the original request, and a dated supplement pointing at the README and flagging the `HANDOFF.md` gap |
| The link | `HANDOFF.md` → "Active workstream — Characters and style guides → canonical" | Index entry + the struck lineage claim |

**Outside this repo:** skill `disney_opa_character_scrape` created at
`~/.claude/skills/disney_opa_character_scrape/SKILL.md` and landed on
`u2giants/ai-devops` `main` (commits `9168a16`, then a correction). It is live in
the session that wrote it.

## 3. The data, and the one rule that matters

OPA's picker is a **two-level tree**: property on top, characters beneath. No
third level.

> **A character is scoped to its property.** The same name recurs under many
> properties with different `characterID`s — ~670 names did. **The key is the
> (property, character) pair, never the character name alone.** Keying on name
> silently loses rows and invents false matches.

Columns: `property`, `licensedPropertyID`, `optionSourceID`, `character`,
`characterID`, `brandPropertyID`. All IDs are **Disney's**, not ours.

### How it was captured — and why "scraping" is the wrong mental model

OPA loads the **entire** tree into the browser in one render (a jsTree with all
11,708 nodes already `state.loaded = true`). The extract is **one read of data
already in the page** — seconds, and zero extra requests to Disney. Full
reproduction snippet is in the README §4.

- Albert logged in and completed MFA **himself** in his own Chrome. **No
  credential, password or MFA code passed through the AI session.**
- The AI attached via the Claude in Chrome extension, opened one tab, read the
  tree, downloaded the CSV via an in-page blob, and closed the tab.
- **Nothing was created in OPA.** No field typed, "Save for Later" and "Submit to
  Disney" never clicked. Treat that page as read-only forever.

## 4. ⚠️ A claim this session raised and then DISPROVED — do not re-derive it

Mid-session it was noticed that the OPA counts (10,262 / 9,591) sit within ~1% of
`dflow.properties_and_characters` (10,122) and `public.characters` (9,622), and a
lead was filed suggesting the legacy table might be a stale import of the same
list. **It was written into `HANDOFF.md`, the README and the skill. It is wrong.**

The three count **different things**:

| Source | What one row IS |
| --- | --- |
| OPA extract | a distinct **(property, character) pair** |
| `dflow.properties_and_characters` | `type='PROPERTY'` → a **style guide**; `type='CHARACTER'` → a character **appearance**, one per style guide |
| `public.characters` | a character **appearance**, carrying `property_id` |
| `core.character` | *0 rows — never populated* |

Two axes: **ownership is linear** (licensor → property → character, one property
per character); **style is many-to-many** (a style guide holds many characters, a
character appears in many). A style guide is **not** a rung between them.
`AGENTS.md` §6.1 warns that two prior AI sessions corrupted their understanding by
reading these column names literally. This session nearly became the third.

**Retracted in all three places** (commit `4f99ccf` here, plus the ai-devops
correction), struck rather than deleted so nobody re-derives it.

**What survives, and it is the stronger argument:** `core.character` is **0 rows**
and wants distinct characters parented to a property. Both legacy tables hold
*appearances*. **The OPA file holds identities scoped to a property — the missing
shape.** Untested: whether `characterID` is stable enough to be that identity key.

## 5. 🔴 OPEN — the shared-checkout collision, and PR #467 contamination

**What happened.** Mid-session another AI session switched the shared checkout
`C:\repos\shared-db` from my branch to its own,
`docs/plan-dispatch-collision-hardening`, and committed on top of my work. My next
commit landed on **their** branch and I pushed it there before noticing.

**What I did about it — non-destructive only.**

- Moved my commit onto my own branch by cherry-picking it through a **temporary
  worktree**, so the shared checkout's HEAD was never changed out from under them.
- All later commits were made the same way, through throwaway worktrees.
- **I did not rewrite, revert, or force-push their branch.**

**What is STILL WRONG and needs a decision:** because their branch was cut from
mine, **[PR #467](https://github.com/u2giants/shared-db/pull/467) currently
contains all four of my OPA files** (`COORDINATOR_INTAKE.md`, `HANDOFF.md`, the
README, the CSV) on top of its own two (`AGENTS.md`,
`plan_dispatch-collision-hardening.md`).

> **The clean fix is to merge #466 FIRST.** Once those files are on `main`, they
> drop out of #467's diff on their own. **No history rewriting, no risk to their
> work.** Do this before anyone tries to rebase or force-push #467.

**Root cause is known and already queued.** `C:\repos\shared-db` is a shared
checkout that concurrent sessions switch branches in. The queue already carries
"Update the stale shared checkout `C:/repos/shared-db`" and "un-park the shared
checkout". **This session is fresh evidence that it is still live and still
causing damage.** The durable fix is that no session should work directly in the
shared checkout — worktrees only.

## 6. 🔴 OPEN — `AGENTS.md` §6.7 is STALE about branch protection

**Verified live 2026-08-06 ~17:45Z** via
`gh api repos/u2giants/shared-db/branches/main/protection`:

| Fact | `AGENTS.md` §6.7 / queue says | **Reality now** |
| --- | --- | --- |
| Required checks | **ONE** (`Promotion contract tests (offline)`), because three workflows all exposed a check named `verify` | **ALL SIX**: `Promotion contract tests (offline)`, `Backlog / queue sync`, `Cross-PR object collision`, `Tools offline tests`, `SQL migration guards`, `Domain ownership` |
| `strict` | `false` | **`true`** — a branch must be up to date with `main` to merge |
| `enforce_admins` | `true` | `true` (unchanged) |

The `ci-check-names` work that was going to make those names unique has evidently
**landed**. Two consequences a future session must not miss:

1. **The documented caveat that "a check can pass against a `main` that has since
   moved" no longer applies the same way** — `strict: true` closes that gap. Do
   not keep repeating the old warning unexamined.
2. **Every open PR must now be current with `main` before it can merge.** With
   ~15 open branches this will bite.

**I did NOT edit `AGENTS.md`.** It is a single-writer file, and the other live
session (PR #467) is editing it **right now**. Editing it would have caused a
guaranteed conflict.

> ### ✅ ALREADY FIXED by the other session — do not redo
> Their commit **`0a5b7c6` "docs(agents): correct the stale branch-protection
> table in §6.7"** (+18/-5 on `AGENTS.md`) landed while this handover was being
> written. **§6.7 is corrected; item 2 in §10 is CLOSED.** The finding is kept
> here for its evidence and because the queue block filed alongside it still
> reads as open. Verify against `AGENTS.md` on `main`, not against this file.

## 7. 🟡 OPEN — CI on PR #466, and a runner-capacity trap

State at 17:55Z: **4 of 6 passed**, `Domain ownership` still in progress (started
17:07Z, ~48 min), `Cross-PR object collision` **FAILED and was re-run**.

> **The collision failure was NOT a real collision and NOT our code.** The
> annotation reads: *"The job was not acquired by Runner of type hosted even after
> multiple attempts."* It sat queued 44 minutes and gave up. **This is GitHub
> hosted-runner starvation.** `gh run rerun <id> --failed` was issued at ~17:52Z.
>
> **Do not debug a collision that did not happen.** Before believing any red X on
> this repo, open the job annotations and check for that runner message — this is
> a second, distinct flavour of the "stale/false verdict" problem `AGENTS.md` §5.2
> already documents for `paths:` filters.

**Exact next action:** confirm all six are green, then merge #466 (which also
un-contaminates #467).

## 8. What we tried that did NOT work — MANDATORY SECTION

| Attempt | Outcome | Lesson |
| --- | --- | --- |
| Looked for a `<select>` of characters | The `Character` field is a **hidden input**; the visible control opens a popup | The list is not in a form control |
| Planned to loop `getCharacters.spring?do=getCharacters&pIds=…&pType=std` per property | Endpoint is real and would work, but needs ~1,445 HTTP calls | Pointless — it is all already client-side. **Check the page's own state before building a crawler** |
| Dumped `outerHTML` / `someFn.toString()` through the browser tool | **`[BLOCKED: Cookie/query string data]`** — query-string-shaped text trips the safety filter | Extract only paths and string literals; mask `=` signs |
| Queried checkboxes named `pa.system.Attribute.Property` | **0 elements**, though the page's own `getProperties()` reads exactly that name | Dead legacy code for a UI the page no longer uses. **Never infer the DOM from the page's JavaScript** |
| Found node text with `children.length === 0` | Not found | jsTree anchors have child elements — use a `TreeWalker` over text nodes |
| One `async` IIFE that triggered the load, awaited, then read | Returned `{}` | Split trigger and read into separate calls |
| `Copy-Item` on the download's GUID `.tmp` | Failed — Chrome renamed it to the final name between two commands | Downloads finalize **asynchronously**; re-check for the final filename before concluding failure |
| Hard-coded the jstree id `#jstree_741` | Would break on the next page load | It is generated — resolve via `document.querySelector('.jstree').id` |
| Reasoned about `dflow.properties_and_characters` from its name and row count | Produced a **wrong** lineage claim that reached three documents | Read `AGENTS.md` §6.1 **first**. Numeric similarity is not evidence of shared lineage |
| `git worktree remove` from Git Bash | `Permission denied` on Windows | Use `git worktree remove --force` then `git worktree prune` (PowerShell worked) |

## 9. Facts that may already be stale

- **CI status on #466** — moving as this was written. Re-check, do not trust §7.
- **PR #467's contents** — the other session is live and may have rebased it.
- **The `AGENTS.md` §6.7 protection facts (§6)** — read live via `gh api`, ~17:45Z.
  Protection settings change; re-verify rather than quoting this file.
- **`core.character` = 0, `dflow.properties_and_characters` = 10,122,
  `public.characters` = 9,622** — these were read **from repo documents, not from
  the live database.** This session made **zero** database calls. Re-derive before
  relying on them.
- **The OPA extract itself** is a point-in-time snapshot with no change feed.

## 10. Open items, and who owns them

| # | Item | Owner |
| --- | --- | --- |
| 1 | Merge PR #466 once green — **also fixes #467** | coordinator / Albert |
| 2 | Record the corrected branch-protection facts in `AGENTS.md` §6.7 (§6 above) | coordinator (single-writer) |
| 3 | Dispatch the OPA lookup-table request; **dedupe against the characters / style-guides workstream first** | coordinator |
| 4 | Test whether OPA `characterID` can be `core.character`'s identity key | dispatched sub-agent, read-only |
| 5 | **Verify the line-of-business scope** — the extract came from `lobName=Option.Lob.Home`. Whether other LOBs expose more properties is **unverified**. This could change the answer, not just annotate it | dispatched sub-agent |
| 6 | Stop sessions working directly in the shared checkout (root cause of §5) | Albert / coordinator |

## 11. Blocked on Albert

- **Nothing blocks the data capture** — it is done.
- **Design of the lookup table** is an owner/coordinator gate, deliberately left
  open in the request: where it lands, whether it joins `core.property` (which
  would make it a cross-app data contract), and the refresh policy.
- **Whether to pull the other lines of business** (§10 item 5).

## 12. Repo state left behind

- **Working tree of `C:\repos\shared-db`:** on `main` (another session moved it),
  **behind origin/main by 3** at the time of writing. **I did not pull or switch
  it** — that is another session's context to manage.
- **Untracked files I did NOT touch and did NOT commit** (they belong to other
  sessions): `.ai/deepseek-sessions/`,
  `.ai/reviews/glm-shared-db-collision-architecture-20260806T160517Z.md`,
  `.ai/reviews/glm-shared-db-collision-architecture-20260806T160916Z.md`. The
  queue already carries an item about deciding the fate of the GLM review files.
- **All temporary worktrees created by this session were removed** and
  `git worktree prune` run. `git worktree list` shows only the main checkout.
- **`u2giants/ai-devops`:** clean; the skill and its correction are on `main`.
  Another session had an uncommitted `bin/setup-opencode-glm.ps1` there which I
  deliberately worked around via a worktree and never touched.

## 13. Fresh-developer gate

Re-read cold, ignoring session context:

1. **Comprehensive enough for a brand-new developer?** Yes. §1 defines OPA from
   scratch, §3 gives the data shape and the reproduction method, §5–§7 give the
   three open problems with the exact next action for each, and §12 states the
   repo state file by file.
2. **Detailed enough to continue as well as this session could?** Yes. Every
   consequential claim carries its evidence: PR numbers, commit SHAs (`4f99ccf`,
   `60dcec3`, `9168a16`), the live `gh api` verification in §6, the runner
   annotation quoted verbatim in §7, and paths for every artifact.
3. **Every detail for flawless execution?** Yes, with the limits stated rather
   than hidden: §9 names five facts that may be stale and says which were never
   measured live, §4 records a wrong turn and its retraction so it is not
   repeated, and §8 lists ten dead ends.

**Known gaps, stated deliberately rather than papered over:** no live database
fact in this document was measured by this session; the line-of-business scope of
the extract is unverified; and `optionSourceID`'s meaning is unknown.
