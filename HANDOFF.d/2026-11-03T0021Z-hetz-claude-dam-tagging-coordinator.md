# Handoff — PopDAM search and AI tagging: coordinator for all open work

Replaces the earlier `spiderman-coir` handoff. State checked 2026-11-02, 7:20 PM EST. Re-check every item before acting.

## 1. Goal
Albert wants PopDAM text search and AI tags to be trustworthy: "spiderman coir" returns Spider-Man door mats, and characters are never guessed. The successor session is **only a coordinator**. It starts one linked sub-session per task below, relays results, and does no task work itself.

## 2. Done and live (do not redo)
- Search: coir mapped to coir mat, near-best picture cutoff, fast anchor: [popdam3#577](https://github.com/u2giants/popdam3/pull/577)–[#584](https://github.com/u2giants/popdam3/pull/584), [shared-db#5003](https://github.com/popcre/shared-db/pull/5003).
- Wrong Spider-Man links removed with a backup; tagger offers only licensed characters: [#585](https://github.com/u2giants/popdam3/pull/585), [#593](https://github.com/u2giants/popdam3/pull/593).
- Order system decides licensing: [#595](https://github.com/u2giants/popdam3/pull/595), [#597](https://github.com/u2giants/popdam3/pull/597). All 5 rescanned products were reported correct.
- Tagger speed: 8 at once, about 720 files an hour. 20 at once overloaded saves.
- 500-file trial finished. Wrong old characters gone; 163 of 330 files with a property got no character (96 had no links to choose from, such as Peanuts, Sonic, Star Wars; 67 had links but got none, including Mickey).
- 2 DC items now read Warner Bros; the 10-day idle takeover rule merged in shared-db at 4:46 PM EST.
- Production password change finished. Hosting panel key: session decided not to rotate (sent once, encrypted, refused, never published).
- Nov 1 slowdown: general overload, cause unprovable, no batching ([note](https://github.com/popcre/shared-db/issues/5079#issuecomment-6581148230)).

## 3. Open tasks — one sub-session each
**A. Character load, then re-run 163 files (most urgent).** [shared-db#5512](https://github.com/popcre/shared-db/pull/5512) merged 6:42 PM EST but migration `20261102225602` was **not in production** at 7:20 PM EST (12,656 characters). The queue was taking about an hour per change. Wait for it, using the repo's bounded waiters. Then re-run the 163 files and report before/after character counts, wrong characters, and the count of odd-looking names. Investigate the 67 files that had links but got none. Known risk: closing another team's review finding may have left the test database missing some links. Continue from the [cleanup session](#local_a7ab3d18-98cb-4351-8ad4-dfdcc776984b)'s context if useful.

**B. Full tagging run (about 110,500 files, about 6.5 days) — do not start until A is reported to Albert and he says go.** The coordinator holds this as a gate; then one sub-session runs it at 8 at once.

**C. "spiderman coir" falling back to rougher search when busy.** The first try was once slow enough that the app fell back. Not fixed, not retested since. Done when the exact query in the live app stays on the main search under normal load, showing the Spider-Man mats (15 groups when last checked), and style-group search still works. Statement timeout is 8 s; never add extra full-search calls.

**D. Audit leftover Spider-Man text and old wrong labels.** 9,244 descriptions and 15,679 tags mention Spider-Man; nobody knows how many are wrong. Old wrong labels for other characters also remain until files are retagged. Decide what run B will overwrite and clean only what it won't. Also settle a number conflict: the change record says 9,823 links removed, a session report said about 32,500. Tell Albert the correct number. Back up before removing anything.

**E. Database closeout check on this machine (hetz).** It still fails here with `lease-free claim owner signature is missing or ambiguous`. The fix ([ai-devops#2306](https://github.com/popcre/ai-devops/pull/2306)) was installed only on edge-dev3. Install it through the protected updater and prove pass/fail behaviour. See [ai-devops#2172](https://github.com/popcre/ai-devops/issues/2172).

**F. Lane-lock extraction follow-up.** In popcre/shared-db, stage C2 of #2172 retired author lanes and left this follow-up with no ticket. Check whether the lock code still sits in the retired tooling. If extraction is useful, open one issue, change, merge, and prove with a real migration run. If not, record why on #2172 and stop.

## 4. Watch only (owned elsewhere)
DesignFlow ruling-search change, [shared-db#5188](https://github.com/popcre/shared-db/issues/5188): owned by its own session, not live at 4:41 PM EST. Report only; start nothing.

## 5. Tried and failed
- Probing with the full search call: timeouts ([#577](https://github.com/u2giants/popdam3/pull/577)).
- Resubmitting the character load as a rename: the queue skipped it, costing hours. It needed a removal plus a new file.
- Accepting review flaws in the load: Albert's coordinator rejected it; odd names and "verified" Peanuts/Sonic were fixed in #5512.

## 6. Rules
Follow `AGENTS.md`. PopDAM needs no reviewer; shared-db changes go through popcre/shared-db claim-first. Character and licensor data come from licensing records, never guesses. Keep Albert's replies in his standard format; ask him only business questions.

## 7. Risks
Do not restart a tagging run while the nightly grouping job runs; they can't run together. Heavy database jobs can slow search.

## 8. Done when
A–F are finished with live proof, B has Albert's decision, and each sub-session has closed.

## 9. Ownership
This session and its sub-sessions were told to stop on handover. Verify each with its closeout check.
