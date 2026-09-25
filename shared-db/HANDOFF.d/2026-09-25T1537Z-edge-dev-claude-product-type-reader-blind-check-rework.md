---
issue: 3024
status: OPEN
owner: claude chat 8200fc94-7b9f-4bf4-a88d-14aace57a23c on edge-dev
---

# Product-type reader — Phase A failed its blind check; rework before acceptance

Issue popcre/shared-db#3024 is **non-orchestrator work** (repository code only; it changes no
database structure). Plan: [`plan_product_type_reader.md`](../plan_product_type_reader.md).

## 0. ⚠️ Decisions only the owner can make

Put this whole list to Albert in ONE message before starting work.

**Blocking (blocks the Faux Book part of step 4 rework, and therefore step 5):**

1. **Is a "faux book" a Faux Book or a Storage Box?** Items described as book-shaped boxes (a box
   that looks like a stack of books, with a lid or storage inside) were relabelled Faux Book by
   the implementing session (97 labels). The independent blind check disagreed on 37 of them and
   called them Storage Box. **Recommendation: Faux Book** when the description says "faux book"
   or "book box", because that is the name the merchandise team uses for the product line; a
   storage box that does not look like a book stays Storage Box. One word answers it.

**Not part of this work, nobody else is on it:** none.

**Already settled — do NOT re-ask:**
- 2026-09-2x (recorded in the reader README): descriptions explicitly mixing different products are
  unreadable ("mixed products"); a single product with accessories is not a mix.
- 2026-09-25 (this session): 482 "can't tell" answers from the blind labeller are allowed — they
  are the labeller abstaining, not the reader being wrong. Not an owner question.
- Albert asked for acceptance to be debated with an independent reviewer rather than judged by
  him. Step 5's "named reviewer" is therefore an independent AI blind check plus AI adjudication
  (design below), with Albert answering only business-meaning questions like item 1.
- 2026-09-16: the value is stored on `plm.item`, never on `coldlion.item_header`.

## 1. What this application is

`shared-db` is the single source of truth for the shared Supabase database used by POP
Creations' apps (CRM, DAM, PIM, DesignFlow PLM). #3024 builds a deterministic
**product-type reader**: given an item description from the ColdLion ERP catalog, it says what
the product is (type, construction, material, treatment, status). Phase A makes it correct on
the whole live catalog (code only, no database writes). Phase B (steps 6–9) stores the value on
`plm.item`. Code: `tools/product_type_reader/` (read its `README.md` "Reproduce evaluation").

## 2. What this session set out to do

Carry Phase A through step 5 (owner acceptance). Albert, being non-technical, asked that
acceptance be decided by debate with an independent reviewer. DeepSeek and I agreed the
existing proof was not enough — the answer key was AI-proposed and checked only by the session
that wrote the reader — so we ran an independent blind check.

## 3. Current state

- PR #3446 (merged, merge `7e839b11`) landed the reader, evaluator and reports.
  `evaluate.py --strict` passes: 0 wrong, 0 uncovered, 0 errors against the snapshot corpus
  (SHA `2dc8fd0e…`, 17,627 distinct descriptions, 18,985 rows; labels SHA `bd7741…`).
- **Blind check: FAILED.** 71 confirmed wrong answers after adjudication:
  - **34 genuine reader errors** in the ~400-item stratified random sample.
  - **37 Faux Book vs Storage Box** disagreements — a definition question (§0 item 1).
- Private evidence: `u2giants/licensor-source-data` PR #94 (blind check package, merged) and PR
  #85 (answer-key package). Aggregate summary posted as a comment on #3024.
- ⚠️ **The plan's STATUS table still says step 4 is "done". That is now false** — the gold set
  itself was shown wrong in places. The next session must change step 4 to "⚠️ reopened
  2026-09-25 — blind check found 34 reader errors + 37 Faux Book disputes (see this handoff)" in
  its first PR (the plan is a rulebook file, so that PR takes the guarded code path, not the
  documents-only one; that is why this docs-only handoff PR did not edit it).
- Steps 5, 6, 8, 9 open; step 7 done (#3036, orchestrator work, columns exist).
- Nothing uncommitted. This handoff is the only file in its PR.

## 4. What did NOT work

- DeepSeek `--review` mode failed with "invalid terminal verdict"; plain `send`/`reply` worked.
- Inline PowerShell strings to the DeepSeek wrapper got truncated; use `--file`.
- A sub-agent proposed asking Albert whether 482 "can't tell" answers are acceptable — wrong,
  that is a technical judgement; resolved here (allowed).
- Trusting `--strict` alone: it proves the reader matches the answer key, not that the key is
  right. That is exactly what the blind check exposed.

## 5. Key findings

- Blind check design (agreed with DeepSeek): a fresh AI labels, blind to reader output, (a) a
  stratified random sample of ~400, (b) every Faux Book correction, (c) all 1,108 unreadable
  rows; a separate AI adjudicates each disagreement; **pass = zero confirmed reader errors**.
- Unreadable rows held up; the failures are in readable rows and in one definition.
- Licensed catalog wording must never enter this public repo, issues, logs or outside
  models beyond what the private package already governs.

## 6. Exact next steps

1. Put §0 to Albert in one message. Gate: a one-word Faux Book answer, recorded in the plan §8.
2. Update the plan STATUS (step 4 reopened) in its own PR. Gate: merged on `main`.
3. Fix the 34 reader errors (list is in the private PR #94 package): patterns, ordering,
   abbreviations, each with a synthetic unit test. Correct the gold labels where the adjudicator
   showed the key was wrong. Apply Albert's Faux Book ruling to all affected labels.
   Gate: `evaluate.py --strict` exits 0 (command in the reader README).
4. Re-run the blind check with a **fresh** random sample (new seed, new labeller session).
   Gate: zero confirmed reader errors after adjudication.
5. Step 5: publish the private acceptance summary; post the acceptance comment on #3024.
6. **Drift check (required):** after step 5, re-read plan steps 6–9 through the plan end and §10–§13;
   report on #3024 anything this rework changed for them (new labels, a changed product list,
   rules version, the evaluate command). Then start step 6 only in a fresh session.

## 7. Constraints and gotchas

- Phase A makes **no database writes**. Read-only catalog export is allowed (§0.0-A).
- Work only in your own worktree off `origin/main`; branch + PR; merge it yourself.
- Never use any privileged Postgres password; use the approved read-only route.
- The accuracy claim is snapshot-bound; a changed catalog changes the SHA and needs a new
  `--live-recheck` file and labels for new rows.
- Sign GitHub posts `Posted by Claude chat <session id> on <machine>`. Times in EST.

## 8. Access

GitHub `gh` (u2giants) for both repos; DeepSeek via `ai-deepseek-agent`; secrets only in
1Password vault `vibe_coding`. Private evidence: `u2giants/licensor-source-data`,
`product-type-reader/`.

## 9. Open questions and risks

- Faux Book definition (§0) — open 2026-09-25.
- Fixing 34 errors may shift other rows; the fresh-sample re-check guards against overfitting.
- Owned elsewhere: ai-devops#744 (reviewer health-check timeout), held by this chat, untouched.

Self-audit (2026-09-25): all four questions yes — newcomer path §1–§3, §6; failures §4; owner
decisions swept into §0 (only Faux Book).

Posted by Claude chat 8200fc94-7b9f-4bf4-a88d-14aace57a23c on edge-dev
