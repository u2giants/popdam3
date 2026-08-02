# The blocked migrations — a decision brief for Albert

**Date:** 2026-08-02
**Written for:** Albert Hazan, owner. No programming knowledge assumed.
**Written by:** sub-agent `hardblock-archaeology`, dispatched by the shared-db coordinator.
**Status:** READ-ONLY investigation. No database was changed. No migration was written.
The block list was not touched — unblocking is your decision, not mine.
**Do not answer this document to me.** The coordinator will put the question to you.

**Which database I looked at:** before every single query I asked the tool which
project it was pointed at. It answered `https://qsllyeztdwjgirsysgai.supabase.co`
every time — that is **production**, the live database. Every statement I ran was a
read (`select`). I made no change of any kind, to production or to preview.

---

## A note on words

A **migration** is a numbered file of database instructions. Running it is called
*applying* it. Once applied, the database records its number in a ledger, so it is
never run twice. The numbers look like `20260726180000` — that is just a timestamp,
`2026-07-26 18:00:00`, used as a name. Files are always applied oldest-number-first.

A migration can do two different kinds of thing, and the difference matters a lot below:

- **Install capability** — create a new table, or teach the database a new
  procedure. Nothing about your existing data changes. Think of it as installing an
  appliance in the kitchen but not cooking anything.
- **Change data or permissions** — actually move, edit, or restrict something people
  use today. Think of it as cooking, or as changing the locks.

---

## 1. The headline

### 1.1 There are SIX blocked migrations, not four

Every document written about this so far — including yesterday's design review, the
promotion manifest, and my own instructions — says there are **four** blocked
migrations. I read the actual block list in the program that enforces it
(`scripts/production_migration_guard.py`, lines 16–23). **It contains six.**

```
20260726030000     20260726031000     20260726032000
20260726180000     20260726190000     20260726200000
```

This is not a discrepancy that hurts you, and I want to be clear about why, because it
would be easy to alarm you unnecessarily. **The last two are already applied to
production** — I confirmed this by reading the production ledger directly. Blocking
something that has already run has no effect; the safety program refuses
already-applied files anyway, for a separate reason. So in practical terms the four
everyone talks about are the four that matter. But the record was wrong, and it is
now corrected.

### 1.2 The reason for the block IS written down — the design doc was wrong to say it isn't

Yesterday's design review states: *"Why they were blocked in the first place is not
recorded anywhere I could find"* (`docs/production-migration-lane-design-20260802.md`,
line 552). **That statement is incorrect.** I found the rationale in three separate
places, quoted in full in section 3 below. That agent looked and did not find it;
I looked and did find it. I want that stated plainly rather than smoothed over,
because the entire premise of my assignment was "nobody knows why." Somebody did.

The recorded reason, in one sentence: **they were never blocked because anyone thought
they were dangerous. They were blocked because they belong to the ColdLion cutover,
and the ColdLion cutover was waiting on your approval.** The block was a fence around
work in progress, not a quarantine around something broken.

### 1.3 They are all "install the appliance," not "cook the meal"

I checked every one of the four for instructions that **change your existing business
records** when the file runs. **There are none — zero, in all four.** Every
record-changing instruction in those files sits *inside* a procedure that has to be
deliberately called afterwards, by a person, with an approval code. I verified this
mechanically rather than by reading prose: searching all four files for a
record-changing instruction written at the outermost level returned **0 matches in all
four files.**

**One important qualification, added after independent review.** These files *do*
change **permissions** — who is allowed to run which procedure. `20260726032000` is
nothing but permission changes, and the other three contain some too. I originally
wrote "no data *or permissions*" here, which was simply wrong and contradicted my own
table below. The permission changes all concern **procedures that do not exist on
production yet and are created by these same files** — I confirmed on production that
none of them are present today — so no permission anyone currently has is taken away
or given. But "nothing changes at all" would be an overstatement, and you should not
be given one.

---

## 2. What each one does, in business terms

| # | Number | Short name | What it does | Changes existing data? |
|---|---|---|---|---|
| 1 | `20260726030000` | Phase 4 — approved linking | Teaches the database *how* to attach the 542 hand-approved ColdLion licensor/property records to your existing master records. Refuses to run for any set other than the exact approved 542 (it checks a fingerprint, a count of 542, and 271 distinct targets). | **No** |
| 2 | `20260726031000` | Phase 4 — bug fix to #1 | Fixes a real bug found in #1 during rehearsal: a safety check silently passed when it was handed empty input instead of rejecting it. Three lines changed. Meaningless without #1. | **No** |
| 3 | `20260726032000` | Phase 4 — lock the browser out | Security tightening. The hosting platform had automatically handed *web-browser-level* accounts permission to run the new write procedures from #1. This takes that permission away, leaving only trusted server-side callers. Meaningless without #1. | **No** |
| 4 | `20260726180000` | Phase 6 — side-by-side comparison | Builds the machinery that runs ColdLion and DesignFlow side by side every day and records whether they agree, so you can *see* ColdLion is trustworthy before switching to it. Creates the comparison log, the alert log, and the health check. Explicitly marked "additive only." | **No** |
| — | `20260726190000` | Master Data lockdown | **Already on production.** Restricted who could edit the Styles / Master Data grid. | n/a |
| — | `20260726200000` | Undo of the lockdown | **Already on production.** Reversed #190000 because it locked all 33 ordinary users out of a screen they need. | n/a |

**Note #3 is a safety improvement, not a risk.** It is on the block list only because
it makes no sense on its own — it revokes a permission on a procedure that would not
exist yet.

---

## 3. Why each was blocked — the evidence

### 3.1 The four ColdLion ones: blocked pending your approval

**Evidence A — the pull request that created the block list.** PR #259, "ci: block
unsafe production migration pushes," merged 2026-07-27 as commit `b3a1637`. Its
description lists the safety rules it was adding, one of which reads verbatim:

> "ColdLion Phase 4/6 and the unsafe Master Data restriction are always blocked"

**Evidence B — the migration triage document**, `docs/migration-backlog-triage-2026-07-27.md`,
written the same day. It gives a per-file verdict. Verbatim, the "Why" column:

> `20260726030000` — **HOLD** — "Explicitly prohibited on production until sign-off."
> `20260726031000` — **HOLD** — "Same gate; follows Phase 4."
> `20260726032000` — **HOLD** — "Security tightening that only makes sense once Phase 4 exists."
> `20260726180000` — **HOLD** — "Same gate."

And immediately below, under the heading *"What unblocks the six ColdLion files"*:

> "They are on hold by design (AGENTS §6.1 and
> `plan_coldlion_licensor_property_accelerated_cutover.md`)."

**Evidence C — the operating manual**, `AGENTS.md` §6.1:

> "The existing production prohibition remains in force until that plan's preview
> rehearsal, readiness, and explicit production-approval gates pass."

**Verdict: the rationale is recorded, consistent across three independent sources, and
it is a process gate, not a technical objection.** Nobody ever wrote down a defect,
a data-loss risk, or a failed test as the reason. The reason is *"Albert has not
approved the ColdLion cutover yet."*

### 3.2 The two Master Data ones: blocked so nobody re-applies a known mistake

These two have the richest written rationale in the entire repository, and it is
written inside the migration files themselves.

`20260726190000` restricted editing of the Styles / Master Data grid to admins and a
couple of specialist roles. Its own successor, `20260726200000`, explains verbatim
why that was wrong:

> "That was WRONG: every signed-in PopDAM user is supposed to edit Master Data — it is
> the entire purpose of the Styles grid at dam.designflow.app/styles. The restriction
> locked all 33 plain 'user' accounts out of the feature."
>
> "The permissive policy is DELIBERATE. Do not 'harden' it again."

The same file records *why* the earlier session was fooled: the edit-history table was
empty, which looked like "nobody uses this screen," but was actually because the
history feature was new.

This rule is also written into `AGENTS.md` §0.4: *"Master Data (style tracker) editing
is OPEN to every signed-in user — by design."*

**Verdict: fully recorded, and the block is correct and should stay.** It exists to
stop a future session re-running the lockdown.

**I verified production is in the right state.** Reading the live permission rules on
`public.style_tracker_rows` on production right now: inserting and updating are open to
any signed-in user (`true`), reading is open, deleting is admin-only. That is exactly
the intended final state. The lockdown and its undo cancelled out cleanly.

### 3.3 Answering the coordinator's specific question about these two

I was asked to probe whether production is sitting in a half-finished "Phase 6" state
because `20260726190000` and `20260726200000` are applied while the Phase 6 work is not.

**It is not, and the premise contains a trap worth naming.** Those two numbers sit next
to `20260726180000` purely because someone did that work later the same day. They have
**nothing to do with ColdLion or Phase 6** — they are about who may edit the Styles
grid in PopDAM, a completely different part of the business. The adjacency of the
numbers is a coincidence of the clock.

Production is not partially promoted. It is correct.

---

## 4. The technical blocker — and I confirmed it independently

Yesterday's design review made a serious claim: the 14-migration ColdLion batch
**cannot be applied at all**, and attempting it would leave production half-finished.
I was asked to check that claim rather than take it on trust. **I checked it against
the live production database, and it is correct.**

The chain of reasoning, in plain terms:

1. Two of the fourteen approved migrations (`20260727221500` and `20260728134500`)
   need two storage tables to already exist — the comparison log and the alert log.
2. Those two tables are created by `20260726180000` — which is blocked.
3. So on production, those tables do not exist.

**My own verification, run against production today:**

```
plm.taxonomy_sync_alert            -> does not exist
plm.taxonomy_parallel_observation  -> does not exist
plm.taxonomy_circuit_breaker       -> does not exist
plm.record_taxonomy_sync_alert     -> 0 copies found
production ledger: 359 entries, newest 20260731230000
```

4. The batch is applied one file at a time. Files 1 and 2 would succeed. **File 3 would
   fail**, because it tries to point at a table that is not there.
5. Each file is committed as it succeeds. There is **no undo for the batch.** You would
   be left with two files applied and twelve not — a state nobody has planned for.

**I agree with the design review's finding, and I confirmed the evidence myself rather
than repeating theirs.** I checked the two logs *and* the procedure, using a method
that cannot be fooled by looking up the wrong name.

---

## 5. The contradiction between two earlier reports — who is right

Two agents disagreed about `docs/coldlion-production-migration-manifest-20260731.md`
§3.4. One "independently confirmed it CORRECT." Yesterday's design review called it
"incomplete and unsafe to promote from." I was asked to settle it.

**Both are right, about different things, and the design review is the one that matters.**

The manifest's §3.4 claim is that the ColdLion files do not depend on any of the nine
unrelated pending migrations. **That claim is true.** The agent who confirmed it
confirmed a true statement. It checked whether the files mention each other's *numbers*.

But that check cannot see the failure in section 4, because `20260727221500` never
mentions `20260726180000` by number. It just uses a table that migration happens to
create. Two files can be fatally dependent without ever naming one another — the way
a recipe can require an oven without the word "oven" appearing in the ingredients list.

**So: the manifest is correct in what it asserts, and unsafe to promote from, because
what it asserts is not the thing that has to be true.** Not a false statement — an
insufficient one. The design review is right that it must not be used as a go-ahead.
The manifest should carry a correction notice; I have not added one, as that file
belongs to another agent's work.

---

## 6. Your decision

### These are TWO decisions, not one — please keep them apart

Independent review flagged that I had bundled them, and it was right to. They are:

- **Decision 1 — remove the four from the block list?** This is paperwork. It *permits*
  them to be included in some future batch. **By itself it changes nothing on
  production.** Nothing is applied, nothing runs, no data moves.
- **Decision 2 — authorise an actual production run of the eighteen files?** This is a
  real production change, on a scheduled window, after a full rehearsal passes.

Removing the block does **not** cause the eighteen to be applied. Somebody still has to
list all eighteen by hand and run them deliberately. **Saying yes to Decision 1 is not
saying yes to Decision 2.** The options below are about Decision 1.

### Option A — Unblock all four (**my recommendation**), then rehearse before any apply

**What it means:** the four become eligible again, so an eighteen-file batch that can
actually complete becomes possible to assemble.

**What changes on production the moment you say yes:** **nothing.** Not one instruction
runs.

**What would change when the eighteen are later applied:** new tables and new
procedures appear, and permissions are set on those brand-new procedures. **No existing
record is edited, no permission anyone holds today is altered, no screen behaves
differently, and no user notices anything.** The 542-link run is a *separate*, later,
deliberate step that someone has to trigger with an approval code — installing these
files does not perform it, and the machinery physically refuses any set other than the
exact approved 542.

**What could go wrong:** the batch could still fail partway for some reason nobody has
found yet. The protection against that is a full rehearsal on the copy database first,
which the design review already specifies. **Do not authorise the production run until
that rehearsal passes end to end.** That is the real gate; unblocking is just paperwork.

**One more trap worth knowing:** if someone unblocks the four but then runs the *old*
fourteen-file list by mistake, it still fails on file 3 and still half-finishes.
Unblocking removes the fence; it does not fix the list. The list must be rebuilt to
eighteen.

**Cost to undo:** low but not zero. Because the migrations only add things, undoing
means dropping the new tables and procedures — a hand-written reversal, but a clean one,
with no risk to existing data. There is no automatic undo button; there never is.

### Option B — Unblock only `20260726180000` (Phase 6)

Technically sufficient — it is the one that creates the two missing tables. But it
leaves the Phase 4 trio blocked for no stated reason (the recorded reason covers all
four identically), and Phase 4 is what the whole ColdLion effort is for. **I do not
recommend it**: it fixes the symptom while keeping a fence that no longer means
anything, and the next session will have to re-litigate this.

### Option C — Leave all four blocked

**What happens:** the ColdLion licensor/property cutover **pauses here indefinitely**.
Step 8 cannot proceed. The fourteen-file batch stays un-promotable. Everything built
across phases 2A, 4, 6, 7 and 7A — already built, already rehearsed on the copy
database — stays unused. Nothing breaks; nothing progresses.

**To be clear, this is a pause and not a shutdown.** Nothing is deleted or lost, and
the same decision can be made later on the same evidence. But the pause has no natural
end date, and that work has been sitting idle since 26 July.

**This is a legitimate choice** if you have decided ColdLion is not worth continuing
right now. It is not a legitimate *default* — leaving it blocked by inaction costs the
same as deciding to stop, without the benefit of having decided.

### Whichever you choose — one housekeeping item

The block list is six bare numbers with no explanation next to them. That is exactly
why this document had to be written. Whatever you decide, the list should carry a
one-line reason per entry, so the two Master Data ones (**block permanently — a known
mistake**) are never confused with the four ColdLion ones (**block pending approval**).
Those are opposite kinds of block sitting in the same list. That change belongs to
another agent; I have only flagged it.

---

## 7. Clearly labelled: what is fact and what is my judgement

**Recorded fact, quoted with its source above:**
- The block list has six entries, not four.
- The recorded reason for the four ColdLion blocks is "pending owner sign-off" — PR
  #259, the triage document, and `AGENTS.md` §6.1, all agreeing.
- The recorded reason for the two Master Data blocks is "this was a mistake, do not
  repeat it" — written in the migration files and `AGENTS.md` §0.4.
- No document anywhere records a technical defect as the reason for blocking **the four
  ColdLion migrations**. (Corrected after review: this is *not* true of the two Master
  Data ones — those are blocked precisely *because* of a recorded defect, as §3.2 shows.
  My original wording said "any block," which was wrong.)

**Verified by me against the live production database today:**
- The two tables and the procedure are absent; the ledger holds 359 entries.
- `20260726190000` and `20260726200000` are applied; the other four are not.
- Production's Styles-grid permissions are in the correct open state.
- None of the four files contains a data-changing instruction at the outermost level.

**My inference, clearly marked as inference, not record:**
- *I infer* that the four were blocked as a group by workstream, not individually
  assessed, because all four carry the same one-line reason and one of them
  (`20260726032000`) is a security *improvement* that nobody would block on its merits.
- *I infer* that unblocking is low-risk, from the fact that the files contain no
  outermost-level data changes. This is a strong inference — I verified it mechanically
  — but it is still an inference about behaviour from a reading of code, and the
  rehearsal on the copy database is what would turn it into proof.

**What I did not do:** I did not change the block list, did not change any database,
did not run any migration, did not merge anything, and did not propose restoring the
442 deleted intake rows (ruled intended and correct, `AGENTS.md` §6.3).

---

## 8. Independent review — Grok 4.5

An earlier draft of this document was reviewed by **Grok 4.5** (`grok 0.2.111`) in a
read-only run (`--allow Read --allow Grep --deny Edit --deny Bash --no-subagents
--no-memory --disable-web-search`), asked adversarially whether any claim is
overstated, whether inference is properly separated from record, whether the
partial-apply conclusion is sound, and — most importantly — **whether a
non-programmer could make a wrong decision from it.**

Grok has previously contradicted itself between drafts in this repository, so only its
final answer is reported, and **I re-verified every finding against the actual code
before accepting it.** Where I checked and it was right, I fixed the document.

**Its bottom line, verbatim:**

> "The dossier is **substantively useful and mostly accurate**… It is **not safe as a
> sole decision instrument** without correction of the permission / 'zero effect'
> language and without splitting **unblock** from **promote**."

| # | Grok's finding (verbatim excerpt) | Verified? | My position |
|---|---|---|---|
| 1 | "HARD_BLOCKED really has six entries… Four pending ColdLion + two already-applied Master Data. Correct." | Yes | **Agree.** No change. |
| 2 | "'No outermost row DML in the four' is verified true (zero top-level INSERT/UPDATE/DELETE in those files)." | Yes — it re-ran the check independently | **Agree.** The central claim survives review. |
| 3 | "§1.3 claim of zero 'data **or permissions**' changes is **false**. `20260726032000` is pure GRANT/REVOKE; #1 and #4 also change privileges at apply time." | **Yes** — I confirmed 21 top-level grant/revoke statements across the three files | **AGREE — real error, mine.** It contradicted my own table. §1.3 rewritten, with the mitigating fact (the affected procedures do not exist on production, verified) stated but not used to wave the point away. |
| 4 | "Option A's 'no permission is changed' is wrong… Highest-risk false reassurance for a non-programmer." | Yes — same evidence | **AGREE.** The most important catch in the review. Option A rewritten. |
| 5 | "'Touch not a single existing record' is only fair if limited to apply-time business rows." | Yes | **Agree.** Scoped explicitly. |
| 6 | "#1 is understated as pure install: it drops/replaces existing sync function signatures." | **Yes** — lines 673–674 drop the two-argument sync procedures | **AGREE on the fact; PARTLY DISAGREE on the weight.** I checked production: those procedures **do not exist there**, so the drop does nothing. Within the eighteen-file batch they are created minutes earlier by the same batch. No pre-existing production object is affected either way. Recorded, not treated as a risk to Albert. |
| 7 | "§7 fact 'no technical defect reason for any block' is wrong for Master Data." | Yes — my own §3.2 disproves it | **AGREE — real error, mine.** Corrected and the correction labelled. |
| 8 | "ColdLion process-gate rationale **is** recorded… Design doc's 'not recorded anywhere' was incorrect; dossier is right to correct it." | Yes | **Agree.** Independent confirmation of this document's main historical finding. |
| 9 | "42P01 conclusion is SQL-sound… 14-set aborts at **file 3**… No batch undo." | Yes — it traced the same two files | **Agree**, and this is now a third independent confirmation (design review, my production probe, Grok's file trace). |
| 10 | "Option A conflates 'unblock denylist' with 'promote 18 to production.' A non-programmer can approve the title and skip the hedge." | Judgement | **AGREE.** Genuinely dangerous packaging. Split into two explicitly separated decisions. |
| 11 | "Option C 'stops permanently' overstates a temporary process hold as terminal shutdown." | Judgement | **AGREE.** Reworded to "pauses indefinitely," with the honest note that the pause has no end date. |
| 12 | "Unblocking does not auto-compose the 18-file allowlist; a post-unblock 14-file run still partially promotes and aborts." | Yes — the guard only *permits*, it does not assemble | **AGREE.** Added to Option A as an explicit trap. |
| 13 | "Production live probes in §7… are **not re-verified in this review**; treat as claimed evidence." | n/a | **AGREE and endorse the caution.** Grok was denied database and shell access by design, so it *could* not check. My probes are reproducible: they are plain reads, listed in §4, against `qsllyeztdwjgirsysgai`. |
| 14 | "Prefer a decision frame of **(A′) unblock the four ColdLion versions so a closed 18-file batch can be rehearsed**, with **explicit non-authorization of production apply**… Keep Master Data pair hard-blocked permanently with reasons in the list." | Judgement | **AGREE, adopted wholesale.** This is now Option A. |

**Net:** fourteen findings, **none rejected as wrong**. Three (3, 4, 7) were factual
errors of mine and are corrected. Three (10, 11, 12) were framing faults that could
genuinely have produced a wrong owner decision, and are fixed. One (6) I accept as fact
but downgrade in weight, with the production evidence for doing so recorded. The rest
confirm the document. **Grok's core criticism — that I had merged "unblock" and
"promote" into one recommendation — was correct and was the right thing to catch.**
