# Re-pinning the Warner STARLABS baseline counts

**Status: this document DESCRIBES a procedure. It does not implement one, and nothing in
this repository implements one today.** It was written alongside migration
`20260810130000` (the chunked capture protocol) so that the next person to hit the wall
finds a considered answer instead of inventing one under time pressure. Implementing it
requires its own dispatch and its own owner decision.

---

## 1. The wall you have just hit

The eight shipped loaders in
[`supabase/migrations/20260810030000_warner_starlabs_source_landing.sql`](../supabase/migrations/20260810030000_warner_starlabs_source_landing.sql)
refuse a snapshot dated `2026-08-07` unless it carries exactly these counts:

| Source file | Mirror | Seen | Landed |
|---|---|---:|---:|
| `franchise-properties.csv` | `plm.wb_franchise_property` | 341 | 341 |
| `style-guides.csv` | `plm.wb_style_guide` | 2,310 | 2,304 |
| `characters.csv` | `plm.wb_character` | 4,301 | 4,299 |
| `assets.csv` | `plm.wb_asset` | 147,537 | 147,537 |
| `links-asset-style-guide.csv` | `plm.wb_asset_style_guide` | 147,484 | 147,484 |
| `links-asset-franchise-property.csv` | `plm.wb_asset_franchise_property` | 335,946 | 335,946 |
| `links-asset-character.csv` | `plm.wb_asset_character` | 51,036 | 51,036 |
| `links-property-character.csv` | `plm.wb_property_character` | 4,158 | 4,158 |

These were verified against private-source commit `9092c51a`. A fresh scrape with any
other count for the same date is rejected.

**This is the guard working, not the guard failing.** A truncated scrape, a half-finished
crawl, a file read from a dirty working tree and a genuine Warner change all produce the
same symptom — a different number — and G8 is the only thing in the system that refuses to
treat the first three as if they were the fourth.

---

## 2. TWO DIFFERENT PROBLEMS. DO NOT CONFLATE THEM.

This is the single most important section of this document. G8 and G9 look similar,
are adjacent in the code, and are not the same kind of thing at all.

### G8 — the pinned baseline. A hard-coded constant.

```sql
if v_captured = date '2026-08-07'
   and (v_seen <> 341 or v_landed <> 341) then
  raise exception '...';
end if;
```

* The numbers are **literals compiled into the function body**.
* A caller **cannot** change them, widen them, or pass around them. There is no parameter.
* Changing them therefore **requires a new migration**, authored, reviewed, merged and
  applied — a permanent, attributable, greppable artefact in git history.
* It is scoped to **one date**. A snapshot with a genuinely different `captured_at` is not
  held to these numbers at all; only G9 applies to it.

**G8 is not a rate limit or a tolerance. It is an assertion that one specific, named
capture is byte-identical to the one that was verified.** The correct response to a G8
failure is almost always "re-read from the pinned commit", not "change the number".

### G9 — the shrink band. A caller-supplied parameter.

```sql
p_max_shrink_fraction numeric default 0.10
...
'Re-extract, or pass a wider p_max_shrink_fraction deliberately.'
```

* It is an **argument**, defaulting to 10%.
* Any caller with EXECUTE on the loader can pass `0.99` — or `1.0`, which disables it
  entirely — in a single call, leaving **no artefact anywhere** except a database log line.
* **Its own error message invites exactly that**: "pass a wider `p_max_shrink_fraction`
  deliberately". That sentence is doing a lot of work. It is written for the case where a
  human has looked at the portal, confirmed Warner really did remove a third of the
  library, and is recording an informed decision. Nothing in the code distinguishes that
  human from an agent that hit an error and widened the number until it stopped erroring.

**So the two failure modes are opposite.** G8's risk is that re-pinning is *too easy to
justify* — you write a migration saying "the numbers changed", and nobody can tell from the
migration whether you verified anything. G9's risk is that bypassing is *too easy to do* —
one parameter, no record.

A proposal that "fixes the pinned-count problem" by making G8 a parameter like G9 has not
solved the problem. It has deleted the guard and moved the failure into the class that
leaves no evidence. **Do not do that.**

---

## 3. How re-pinning would work

### 3.1 What must be true before anyone touches a number

Re-pinning is a claim that **Warner's library genuinely changed**. That claim has to be
supported by evidence that a truncated scrape could not have produced. In order:

1. **The new capture is clean and pinned.** `git status --porcelain` empty in the private
   source checkout, `HEAD` at the commit being pinned, every CSV read via
   `git show <commit>:warner-bros/<file>`. `tools/sync-warner-starlabs.mjs` already
   enforces all three and refuses otherwise; run its **dry run** and use its printed
   per-file counts, which are derived the same way the loader derives them.
2. **All eight files are present at that commit.** A missing file is the failure mode this
   whole design exists to stop — `links-property-character.csv` had a staged deletion in a
   live checkout, and a directory-listing loader would have loaded zero of its 4,158 links
   and reported success. The hard-coded file list in the loader turns that into an error.
3. **The direction and size of every change is explained, per file.** Not "counts moved" —
   which populations grew, which shrank, by how much, and why. A capture where seven files
   are stable and one collapses by 40% is a failed crawl of one page, not a Warner change.
4. **The portal was observed independently of the scrape.** Someone logged into STARLABS
   and confirmed the change is visible there. A scrape cannot corroborate itself.
5. **The scrape ran to completion with no recorded failures.** A crawl that ended early
   produces a smaller, internally consistent, entirely plausible file.

If any of 1–5 cannot be answered, the answer is **re-scrape**, not re-pin.

### 3.2 The mechanism

Because G8 is a compiled constant, re-pinning is a **new migration** and can be nothing
else. Concretely:

* A new `YYYYMMDDHHMMSS_wb_repin_baseline_<date>.sql` that `create or replace`s only the
  affected `plm.sync_wb_<entity>` functions.
* **Add a new dated arm; do not edit the existing one.** The guard is already written as
  "if this claims to be the 2026-08-07 capture, it must match these numbers". A second
  capture gets a second arm for its own date. Deleting the 2026-08-07 arm would mean the
  old, verified snapshot could be re-loaded later with any counts at all.
* The migration body must carry the evidence from §3.1 as comments: the new pinned commit,
  the per-file before/after counts, the direction of each change, and who observed the
  portal. A re-pinning migration whose comment is "updated counts" is not reviewable and
  should be rejected on that ground alone.
* It follows the ordinary `shared-db` route: branch, PR, `scripts/check-sql.sh`, preview
  apply, verification, merge, and only then a production window.

### 3.3 Who authorises it

**The repository owner (Albert Hazan), explicitly, per re-pin.** Not an agent, and not an
agent's judgement that the evidence "looks fine".

This follows the existing rule rather than inventing one. `AGENTS.md` §1 reserves anything
hard to undo for the owner, and §6.4 rules that curated data outranks an import and that an
importer which cannot tell curated from empty **must abstain, not guess**. Re-pinning is
the same shape: it is a decision that a difference between our record and a source is the
source's truth. That is an owner call.

What an agent may do without asking: run the scrape, run the dry run, produce the
per-file comparison, and write the draft migration with its evidence block. What an agent
may not do: merge it, apply it, or decide the evidence is sufficient.

The ask put to the owner should be one plain question with the numbers in it — "Warner's
character list went from 4,301 to 4,190; the portal shows the same drop; may I re-pin?" —
never "the load is failing, may I update the guard?".

### 3.4 Why this does not become a rubber stamp

The honest answer is that **no procedure can make a re-pin un-rubber-stampable**, because
the person approving it is relying on evidence someone else gathered. What the design can
do is make a rubber stamp *expensive and visible* rather than free and silent. Four
properties do that, and any replacement proposal should be judged on whether it keeps them:

1. **Re-pinning costs a migration.** It cannot be done in passing, mid-incident, by a
   caller. It is a reviewed artefact with an author and a date, permanently in git.
2. **The old pin survives.** Adding a dated arm rather than editing one means every past
   verified capture stays verifiable forever. Re-pinning adds a fact; it never removes one.
3. **The evidence lives next to the change.** The comment block in the migration is what a
   reviewer reads. An empty evidence block is a reviewable defect in a way that a widened
   number alone is not.
4. **The number never becomes a parameter.** The moment G8 is passed in by the caller, all
   three properties above evaporate simultaneously. This is the specific mistake to
   refuse.

The residual risk — an owner approving a re-pin without reading the evidence — is
deliberately left unmitigated. Mitigating it would mean an agent overriding the owner,
which is not a safety property.

### 3.5 The separate, unaddressed problem: G9 leaves no trace

Everything above concerns G8. **G9's bypass is still a single parameter with no artefact,
and this document does not fix it.** It is recorded here because a session that solves the
G8 problem will be tempted to declare the whole area handled.

If it is ever addressed, the shape that would fit this codebase is to make a widened band
*recorded* rather than *forbidden* — the loaders already have the plumbing for it, since
they return `rows_seen`/`rows_landed`/`rows_missing`, and `plm.wb_capture.loader_report`
now stores that return row verbatim for every capture that goes through the chunked
protocol. Persisting the `p_max_shrink_fraction` actually used, alongside that report,
would turn an invisible override into a queryable one without blocking the legitimate case
the error message was written for.

That is a suggestion, not a plan. It is out of scope for the dispatch that produced this
document and has not been designed, costed or approved.

---

## 4. Related

* `supabase/migrations/20260810030000_warner_starlabs_source_landing.sql` — the eight
  mirrors, the eight loaders, and guards G1–G9.
* `supabase/migrations/20260810130000_wb_chunked_capture_protocol.sql` — the chunked
  capture protocol, which streams a snapshot but deliberately does **not** weaken any
  loader guard: finalize hands the loader a complete snapshot and G1–G9 all run.
* `tools/sync-warner-starlabs.mjs` — the loader program; its dry run is the supported way
  to produce per-file counts for a re-pin comparison.
* `docs/licensor-portal-scrape-source-schema-20260807.md` — the source contract.
* `AGENTS.md` §1 (owner authority), §4 (migration rules), §6.4 (curated beats imported;
  an importer that cannot tell must abstain).
